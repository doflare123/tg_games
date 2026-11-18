import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOOM_WAD_SHA256 } from '../src/shared/doom.ts';
import { arcadeBridge, headlessPort } from './doom-engine-source.ts';

const revision = 'e257a09527062bfb986b6e5e0780839b6cbd5b71';
const upstream = resolve('.cache/doomgeneric/doomgeneric');
const work = resolve('.cache/doom-ranked');
const output = resolve('public/engines/doom');
const sdk = resolve('.cache/emsdk');
const git = spawnSync(
  'git',
  [
    '-c',
    `safe.directory=${resolve(upstream, '..').replaceAll('\\', '/')}`,
    '-C',
    upstream,
    'rev-parse',
    'HEAD',
  ],
  { encoding: 'utf8' },
);
if (git.status !== 0 || git.stdout.trim() !== revision) throw new Error('Unexpected Doom revision');
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(upstream))
  if (/\.(c|h)$/.test(name)) await copyFile(resolve(upstream, name), resolve(work, name));
const replace = async (name: string, pattern: RegExp, replacement: string) => {
  const path = resolve(work, name);
  const source = await readFile(path, 'utf8');
  if (!pattern.test(source)) throw new Error(`Doom patch no longer applies: ${name}`);
  await writeFile(path, source.replace(pattern, replacement));
};
await replace(
  'd_main.c',
  /void D_DoomLoop \(void\)\s*\{[\s\S]*?\n\}/,
  'void Arcade_LoopInit(void);\nvoid D_DoomLoop(void) { Arcade_LoopInit(); }',
);
await replace('d_main.c', /wipe = true;/, 'wipe = false;');
await replace('d_main.c', /NetUpdate \(\);/, '/* Input comes exclusively from arcade_step. */');
await replace(
  'g_game.c',
  /void G_DoCompleted \(void\)\s*\{/,
  'void Arcade_Complete(void);\nvoid G_DoCompleted(void) {\n Arcade_Complete();',
);
await replace(
  'doomgeneric_emscripten.c',
  /int main\(int argc, char \*\*argv\)[\s\S]*$/,
  'int main(int argc,char **argv) { doomgeneric_Create(argc,argv); return 0; }\n',
);
await writeFile(resolve(work, 'arcade_bridge.c'), arcadeBridge);
await writeFile(resolve(work, 'headless_port.c'), headlessPort);
const makefile = await readFile(resolve(upstream, 'Makefile.emscripten'), 'utf8');
const list = /^SRC_DOOM\s*=\s*(.+)$/m.exec(makefile)?.[1];
if (!list) throw new Error('Doom source list missing');
const files = list
  .trim()
  .split(/\s+/)
  .map((file) => file.replace(/\.o$/, '.c'));
const exports = '["_main","_arcade_step","_arcade_get","_arcade_split","_arcade_draw"]';
for (const headless of [false, true]) {
  const sources = headless
    ? files
        .filter(
          (file) =>
            !['doomgeneric_emscripten.c', 'i_sdlmusic.c', 'i_sdlsound.c', 'mus2mid.c'].includes(
              file,
            ),
        )
        .concat('headless_port.c')
    : files;
  const args = [
    ...sources,
    'arcade_bridge.c',
    '-O2',
    '-fwrapv',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]',
    `-sEXPORTED_FUNCTIONS=${exports}`,
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINVOKE_RUN=0',
    '-Wno-error=implicit-function-declaration',
    ...(headless
      ? ['-sENVIRONMENT=shell', '-sSINGLE_FILE=1', '-sWASM_ASYNC_COMPILATION=0']
      : [
          '-DFEATURE_SOUND',
          '-sUSE_SDL=2',
          '-sUSE_SDL_MIXER=2',
          '-sSDL2_MIXER_FORMATS=["mid"]',
          '-sENVIRONMENT=web',
        ]),
    '-o',
    resolve(output, headless ? 'verify.js' : 'play.js'),
  ];
  const response = resolve(work, headless ? 'verify.rsp' : 'play.rsp');
  await writeFile(
    resolve(work, headless ? 'source-verify.rsp' : 'source-play.rsp'),
    args
      .map((arg) =>
        JSON.stringify(
          arg === resolve(output, headless ? 'verify.js' : 'play.js')
            ? headless
              ? 'verify.js'
              : 'play.js'
            : arg,
        ),
      )
      .join('\n'),
  );
  await writeFile(response, args.map((arg) => JSON.stringify(arg)).join('\n'));
  const python =
    process.platform === 'win32' ? resolve(sdk, 'python/3.13.3_64bit/python.exe') : 'python3';
  const result = spawnSync(python, [resolve(sdk, 'upstream/emscripten/emcc.py'), `@${response}`], {
    cwd: work,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, EM_CONFIG: resolve(sdk, '.emscripten') },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Ranked Doom compilation failed');
}
const wad = await readFile(resolve('.cache/freedoom/freedoom-0.13.0/freedoom1.wad'));
const wadSha256 = createHash('sha256').update(wad).digest('hex');
if (wadSha256 !== DOOM_WAD_SHA256)
  throw new Error('Freedoom does not match the ranked content revision');
await writeFile(resolve(output, 'freedoom1.wad'), wad);
await copyFile(
  resolve('.cache/freedoom/freedoom-0.13.0/COPYING.txt'),
  resolve(output, 'FREEDOOM-LICENSE'),
);
await copyFile(resolve(upstream, '../LICENSE'), resolve(output, 'LICENSE'));
await copyFile(resolve(upstream, '../LICENSE'), resolve(work, 'LICENSE'));
await writeFile(
  resolve(work, 'BUILD.txt'),
  `Corresponding source for TG Games Doom engine, GPL-2.0-or-later.\nUpstream doomgeneric ${revision}; Emscripten 4.0.20.\nIn this directory run emcc @source-play.rsp and emcc @source-verify.rsp.\nClient: SDL2 + SDL_mixer. Verifier: no graphics/audio platform dependencies.\narcade_bridge.c and the patches to d_main.c, g_game.c and the Emscripten main adapt the original engine.\nNo IWAD is included in this source archive.\n`,
);
const archive = spawnSync(
  'tar',
  [
    '-czf',
    resolve(output, 'source.tar.gz'),
    '-C',
    work,
    ...(await readdir(work)).filter((name) => /\.(c|h)$/.test(name)),
    'LICENSE',
    'BUILD.txt',
    'source-play.rsp',
    'source-verify.rsp',
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (archive.error) throw archive.error;
if (archive.status !== 0) throw new Error('Could not package corresponding Doom source');
await writeFile(
  resolve(output, 'ranked-manifest.json'),
  JSON.stringify({ ruleset: 'freedoom-0.13.0-e1-v1', revision, wadSha256, tickRate: 35 }, null, 2),
);
await writeFile(
  resolve(output, 'ranked-loader.js'),
  "import createDoom from './play.js'; window.createRankedDoomEngine = createDoom;\n",
);
console.log(
  `Built Doom player + headless verifier; Freedoom SHA-256 ${wadSha256}. No deploy or migration.`,
);
