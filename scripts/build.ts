import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { DOOM_WAD_SHA256 } from '../src/shared/doom-content.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'tgcloud');
if (relative(root, output) !== 'tgcloud') throw new Error('Unsafe generated output');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const entryPoints: Record<string, string> = {
  schema: resolve(root, 'src/server/platform/schema.ts'),
};
for (const directory of ['endpoints', 'handlers']) {
  for (const file of await readdir(resolve(root, 'src/server', directory))) {
    if (file.endsWith('.ts'))
      entryPoints[`${directory}/${file.slice(0, -3)}`] = resolve(
        root,
        'src/server',
        directory,
        file,
      );
  }
}
// A separate entry keeps the WASM engine and shared application runtime below
// the cloud's 1 MiB module limit without requiring dynamic imports there.
const doomEnginePath = resolve(
  root,
  existsSync(resolve(root, 'public/engines/doom/verify.js'))
    ? 'public/engines/doom/verify.js'
    : 'src/server/platform/doom-unavailable.ts',
);
entryPoints['lib/doom-engine'] = doomEnginePath;
const wadPath = resolve(root, 'public/engines/doom/freedoom1.wad');
if (existsSync(wadPath)) {
  const wad = await readFile(wadPath);
  if (createHash('sha256').update(wad).digest('hex') !== DOOM_WAD_SHA256)
    throw new Error('Server Doom data does not match the ranked content revision');
}
const result = await esbuild({
  entryPoints,
  outdir: output,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  external: ['sdk', 'sdk/*'],
  chunkNames: 'lib/[name]-[hash]',
  metafile: true,
  alias: {
    'doom-headless-engine': doomEnginePath,
  },
  plugins: [
    {
      name: 'no-node-in-cloud',
      setup(api) {
        api.onResolve({ filter: /^(node:|bun:)/ }, (args) => ({
          errors: [{ text: `Forbidden cloud import: ${args.path}` }],
        }));
      },
    },
  ],
});
const cloudOutputs = Object.values(result.metafile?.outputs ?? {});
// App content belongs in storage. A large module set can break live Mini App
// calls even when the management runner accepts the same sources.
if (cloudOutputs.reduce((total, value) => total + value.bytes, 0) > 2 * 1024 * 1024)
  throw new Error('Cloud application code exceeds the 2 MiB budget; move content to storage');
for (const value of cloudOutputs) {
  if (value.bytes > 1048576) throw new Error('Cloud module exceeds the 1 MiB limit');
  for (const imported of value.imports)
    if (imported.external && imported.path !== 'sdk' && !imported.path.startsWith('sdk/'))
      throw new Error(`Unsupported runtime import: ${imported.path}`);
}
await vite({ root, build: { outDir: 'dist/client', emptyOutDir: true } });
console.log('Built TypeScript → tgcloud modules + dist/client. No deploy or migration performed.');
