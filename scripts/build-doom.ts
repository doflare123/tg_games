import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const source = resolve(root, '.cache/doomgeneric/doomgeneric');
const sdk = resolve(root, '.cache/emsdk');
await access(resolve(source, 'Makefile.emscripten'));
const makefile = await readFile(resolve(source, 'Makefile.emscripten'), 'utf8');
const matches = /^SRC_DOOM\s*=\s*(.+)$/m.exec(makefile);
if (!matches?.[1]) throw new Error('Upstream source list not found');
const files = matches[1]
  .trim()
  .split(/\s+/)
  .map((name) => name.replace(/\.o$/, '.c'));
const git = spawnSync(
  'git',
  [
    '-c',
    `safe.directory=${resolve(source, '..').replaceAll('\\', '/')}`,
    '-C',
    source,
    'rev-parse',
    'HEAD',
  ],
  { encoding: 'utf8' },
);
if (git.status !== 0 || git.stdout.trim() !== 'e257a09527062bfb986b6e5e0780839b6cbd5b71')
  throw new Error('Doom source does not match the pinned revision');
const output = resolve(root, 'public/engines/doom');
await mkdir(output, { recursive: true });
const argumentsList = [
  ...files,
  '-O2',
  '-DFEATURE_SOUND',
  '-sUSE_SDL=2',
  '-sUSE_SDL_MIXER=2',
  '-sSDL2_MIXER_FORMATS=["mid"]',
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]',
  '-sEXPORTED_FUNCTIONS=["_main","_emscripten_pause_main_loop","_emscripten_resume_main_loop"]',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sINVOKE_RUN=0',
  '-sENVIRONMENT=web',
  '-Wno-error=implicit-function-declaration',
  '-o',
  resolve(output, 'doom.js'),
];
const responseFile = resolve(root, '.cache/doom-build.rsp');
await writeFile(responseFile, argumentsList.map((value) => JSON.stringify(value)).join('\n'));
const python =
  process.platform === 'win32' ? resolve(sdk, 'python/3.13.3_64bit/python.exe') : 'python3';
const result = spawnSync(
  python,
  [resolve(sdk, 'upstream/emscripten/emcc.py'), `@${responseFile}`],
  {
    cwd: source,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, EM_CONFIG: resolve(sdk, '.emscripten') },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Doom WASM compilation failed');
const wasm = await readFile(resolve(output, 'doom.wasm'));
await writeFile(
  resolve(output, 'manifest.json'),
  JSON.stringify(
    {
      engine: 'doomgeneric',
      revision: git.stdout.trim(),
      emscripten: '4.0.20',
      wasmSha256: createHash('sha256').update(wasm).digest('hex'),
      ranked: false,
    },
    null,
    2,
  ),
);
await copyFile(resolve(source, '../LICENSE'), resolve(output, 'LICENSE'));
await writeFile(
  resolve(output, 'loader.js'),
  "import createDoom from './doom.js'; window.createDoomEngine = createDoom;",
);
console.log('Doom engine built. Original game data is not included.');
