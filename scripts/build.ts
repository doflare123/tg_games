import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

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
for (const value of Object.values(result.metafile?.outputs ?? {})) {
  for (const imported of value.imports)
    if (imported.external && imported.path !== 'sdk' && !imported.path.startsWith('sdk/'))
      throw new Error(`Unsupported runtime import: ${imported.path}`);
}
await vite({ root, build: { outDir: 'dist/client', emptyOutDir: true } });
console.log('Built TypeScript → tgcloud modules + dist/client. No deploy or migration performed.');
