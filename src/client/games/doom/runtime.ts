import { object } from '../../../shared/errors.ts';
import { DOOM_KEYS, type DoomEvent, type DoomSave } from './protocol.ts';

interface DoomModule {
  FS: {
    writeFile(path: string, bytes: Uint8Array): void;
    readFile(path: string): Uint8Array;
    readdir(path: string): string[];
    mkdir(path: string): void;
  };
  callMain(args: string[]): void;
  _emscripten_pause_main_loop(): void;
  _emscripten_resume_main_loop(): void;
}
interface ModuleOptions {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  locateFile: (name: string) => string;
  preRun: Array<(module: DoomModule) => void>;
  print: (message: string) => void;
  printErr: (message: string) => void;
  onAbort: (message: unknown) => void;
}
type Factory = (options: ModuleOptions) => Promise<DoomModule>;
declare global {
  interface Window {
    createDoomEngine?: Factory;
  }
}
async function loadFactory(): Promise<Factory> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/engines/doom/loader.js';
    script.onload = () => {
      if (window.createDoomEngine) resolve(window.createDoomEngine);
      else reject(new Error('Engine factory missing'));
    };
    script.onerror = () => reject(new Error('Не удалось загрузить движок Doom'));
    document.head.append(script);
  });
}
let module: DoomModule | null = null;
let started = false;
const canvas = document.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Doom canvas missing');
const send = (event: DoomEvent) => parent.postMessage(event, location.origin);
const save = () => {
  if (!module) return;
  try {
    const saves: DoomSave[] = module.FS.readdir('/saves')
      .filter((name) => /^[a-zA-Z0-9_.-]+\.dsg$/.test(name))
      .slice(0, 20)
      .map((name) => ({
        name,
        bytes: module?.FS.readFile(`/saves/${name}`).slice() ?? new Uint8Array(),
      }));
    if (saves.length) send({ type: 'doom:saves', saves });
  } catch {
    /* no save files yet */
  }
};
window.addEventListener('message', (event) => {
  void (async () => {
    if (event.origin !== location.origin || event.source !== parent) return;
    try {
      const data = object(event.data);
      if (data.type === 'doom:start' && !started) {
        if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > 128 * 1024 * 1024)
          throw new Error('Некорректный WAD');
        started = true;
        const bytes = new Uint8Array(data.bytes);
        const factory = await loadFactory();
        // The engine is a pinned, locally built Emscripten module, never user code.
        module = await factory({
          canvas,
          noInitialRun: true,
          locateFile: (name) => `/engines/doom/${name}`,
          preRun: [
            (runtime) => {
              runtime.FS.writeFile('/doom.wad', bytes);
              runtime.FS.mkdir('/saves');
              if (Array.isArray(data.saves))
                for (const item of data.saves) {
                  const s = object(item);
                  if (
                    typeof s.name === 'string' &&
                    /^[a-zA-Z0-9_.-]+\.dsg$/.test(s.name) &&
                    s.bytes instanceof Uint8Array
                  )
                    runtime.FS.writeFile(`/saves/${s.name}`, s.bytes);
                }
            },
          ],
          print: () => {},
          printErr: (message) => console.warn('doom', message),
          onAbort: () => send({ type: 'doom:error', message: 'Игровой движок остановился' }),
        });
        try {
          module.callMain([
            '-iwad',
            '/doom.wad',
            '-savedir',
            '/saves',
            '-config',
            '/saves/default.cfg',
          ]);
        } catch (error) {
          if (error !== 'unwind') throw error;
        }
        send({ type: 'doom:running' });
      } else if (
        data.type === 'doom:key' &&
        typeof data.keyCode === 'number' &&
        DOOM_KEYS.some((key) => key === data.keyCode) &&
        typeof data.pressed === 'boolean'
      ) {
        document.dispatchEvent(
          new KeyboardEvent(data.pressed ? 'keydown' : 'keyup', {
            keyCode: data.keyCode,
            which: data.keyCode,
            bubbles: true,
          }),
        );
      } else if (data.type === 'doom:pause') {
        save();
        module?._emscripten_pause_main_loop();
      } else if (data.type === 'doom:resume') module?._emscripten_resume_main_loop();
    } catch (error) {
      send({
        type: 'doom:error',
        message: error instanceof Error ? error.message : 'Не удалось запустить Doom',
      });
    }
  })();
});
window.setInterval(save, 3000);
window.addEventListener('pagehide', save);
send({ type: 'doom:ready' });
