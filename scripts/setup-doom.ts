import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
await mkdir(resolve('.cache'), { recursive: true });
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
function run(command: string, args: string[], cwd = root): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${command}`);
}
if (!(await exists('.cache/emsdk')))
  run('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    '4.0.20',
    'https://github.com/emscripten-core/emsdk.git',
    '.cache/emsdk',
  ]);
if (!(await exists('.cache/doomgeneric'))) {
  run('git', ['clone', 'https://github.com/ozkl/doomgeneric.git', '.cache/doomgeneric']);
  run(
    'git',
    [
      '-c',
      `safe.directory=${resolve('.cache/doomgeneric').replaceAll('\\', '/')}`,
      'checkout',
      'e257a09527062bfb986b6e5e0780839b6cbd5b71',
    ],
    resolve('.cache/doomgeneric'),
  );
}
const python = process.platform === 'win32' ? 'python' : 'python3';
run(python, [resolve('.cache/emsdk/emsdk.py'), 'install', '4.0.20']);
run(python, [resolve('.cache/emsdk/emsdk.py'), 'activate', '4.0.20']);
console.log('Portable SDK installed inside .cache. Run npm run build:doom.');
