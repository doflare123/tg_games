import {
  DOOM_ASSET_PATH,
  DOOM_MAX_TICKS,
  DOOM_SKILLS,
  DOOM_WAD_SHA256,
  type DoomCommandSpan,
  doomCommands,
} from '../../../shared/doom.ts';
import type { DoomEngine } from '../../../shared/doom-engine.ts';
import { object, oneOf } from '../../../shared/errors.ts';
import { DOOM_KEYS, type DoomEvent } from './protocol.ts';

interface ModuleOptions {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  locateFile: (name: string) => string;
  print: (message: string) => void;
  printErr: (message: string) => void;
}
declare global {
  interface Window {
    createRankedDoomEngine?: (options: ModuleOptions) => Promise<DoomEngine>;
  }
}
const canvas = document.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Doom canvas missing');
const screen = canvas;
const send = (event: DoomEvent) => parent.postMessage(event, location.origin);
let engine: DoomEngine | null = null;
let started = false,
  paused = true,
  previous = 0,
  accumulator = 0,
  fromTick = 0;
let pending: DoomCommandSpan[] = [];
const keys = new Set<number>();
function flush() {
  if (!engine || pending.length === 0) return;
  send({
    type: 'doom:commands',
    fromTick,
    commands: pending,
    map: engine._arcade_get(2),
    activeTicks: engine._arcade_get(1),
    finished: engine._arcade_get(4) === 1 || engine._arcade_get(0) >= DOOM_MAX_TICKS,
  });
  pending = [];
  fromTick = engine._arcade_get(0);
}
function pause() {
  paused = true;
  keys.clear();
  flush();
  if (engine) send({ type: 'doom:paused', tick: engine._arcade_get(0) });
}
function key(code: number, pressed: boolean) {
  if (code === 27 && pressed) {
    pause();
    send({ type: 'doom:pause-request' });
    return;
  }
  if (pressed) keys.add(code);
  else keys.delete(code);
}
function mask() {
  const mapping = [
    [38, 1],
    [40, 2],
    [37, 4],
    [39, 8],
    [188, 16],
    [190, 32],
    [16, 64],
    [17, 128],
    [32, 256],
    [13, 128],
  ] as const;
  let value = 0;
  for (const [code, bit] of mapping) if (keys.has(code)) value |= bit;
  for (let weapon = 1; weapon <= 7; weapon++)
    if (keys.has(48 + weapon)) {
      value |= weapon << 9;
      break;
    }
  return value;
}
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!engine || paused) {
    previous = now;
    return;
  }
  const elapsed = now - previous;
  previous = now;
  if (elapsed > 1000) {
    pause();
    send({ type: 'doom:pause-request' });
    return;
  }
  accumulator += elapsed;
  while (accumulator >= 1000 / 35 && !paused) {
    accumulator -= 1000 / 35;
    const value = mask();
    engine._arcade_step(value);
    const tail = pending.at(-1);
    if (tail?.mask === value) tail.ticks++;
    else pending.push({ mask: value, ticks: 1 });
    if (engine._arcade_get(0) - fromTick >= 35 || engine._arcade_get(4)) flush();
    if (engine._arcade_get(4) || engine._arcade_get(0) >= DOOM_MAX_TICKS) {
      flush();
      paused = true;
    }
  }
  engine._arcade_draw();
}
async function start(data: Record<string, unknown>) {
  const skill = oneOf(data.skill, DOOM_SKILLS),
    commands = doomCommands(data.commands, DOOM_MAX_TICKS);
  started = true;
  const response = await fetch(DOOM_ASSET_PATH);
  if (!response.ok) throw new Error('Данные Freedoom ещё не установлены на сервере.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== DOOM_WAD_SHA256)
    throw new Error('Версия Freedoom не совпадает с правилами рейтинга.');
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/engines/doom/ranked-loader.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Движок Freedoom недоступен.'));
    document.head.append(script);
  });
  if (!window.createRankedDoomEngine) throw new Error('Движок Freedoom не установлен.');
  engine = await window.createRankedDoomEngine({
    canvas: screen,
    noInitialRun: true,
    locateFile: (name) => `/engines/doom/${name}`,
    print: () => {},
    printErr: () => {},
  });
  engine.FS.writeFile('/doom.wad', bytes);
  engine.callMain(['-iwad', '/doom.wad', '-warp', '1', '1', '-skill', skill]);
  let restored = 0;
  for (const span of commands)
    for (let i = 0; i < span.ticks; i++) {
      engine._arcade_step(span.mask);
      if (++restored % 350 === 0)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  fromTick = engine._arcade_get(0);
  // First GPU upload can be slow; finish it before starting the ranked clock.
  engine._arcade_draw();
  previous = performance.now();
  accumulator = 0;
  paused = false;
  send({ type: 'doom:running', tick: fromTick });
  screen.focus();
}
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent) return;
  void (async () => {
    try {
      const data = object(event.data);
      if (data.type === 'doom:start' && !started) await start(data);
      else if (
        data.type === 'doom:key' &&
        typeof data.keyCode === 'number' &&
        DOOM_KEYS.some((code) => code === data.keyCode) &&
        typeof data.pressed === 'boolean'
      )
        key(data.keyCode, data.pressed);
      else if (data.type === 'doom:pause') pause();
      else if (data.type === 'doom:resume' && engine && !engine._arcade_get(4)) {
        previous = performance.now();
        accumulator = 0;
        paused = false;
        screen.focus();
      }
    } catch (error) {
      pause();
      send({
        type: 'doom:error',
        message: error instanceof Error ? error.message : 'Не удалось запустить Freedoom',
      });
    }
  })();
});
for (const name of ['keydown', 'keyup'] as const)
  document.addEventListener(name, (event) => {
    if (DOOM_KEYS.some((code) => code === event.keyCode)) {
      event.preventDefault();
      if (!event.repeat) key(event.keyCode, name === 'keydown');
    }
  });
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    send({ type: 'doom:pause-request' });
  }
});
window.addEventListener('pagehide', flush);
requestAnimationFrame(frame);
send({ type: 'doom:ready' });
