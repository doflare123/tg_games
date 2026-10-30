import type { ButtonKey } from 'jsnes';
import { create } from 'nipplejs';
import { element } from '../ui/dom.ts';
import { directions, KeyLatch } from './key-latch.ts';

interface Stick<K extends number> {
  label: string;
  map: (x: number, y: number) => K[];
}
interface Action<K extends number> {
  label: string;
  className?: string;
  keys: readonly K[] | (() => readonly K[]);
}
export interface MobilePad {
  release(): void;
  destroy(): void;
}
function mount<K extends number>(
  host: HTMLElement,
  kind: 'doom' | 'mario',
  emit: (key: K, pressed: boolean) => void,
  sticks: Stick<K>[],
  actions: Action<K>[],
  utilities: Action<K>[],
): MobilePad {
  const abort = new AbortController();
  const latch = new KeyLatch(emit);
  const pad = element('div', `mobile-gamepad ${kind}-gamepad`);
  pad.setAttribute('aria-label', kind === 'doom' ? 'Управление Doom' : 'Управление Mario');
  const area = element('div', 'pad-playing-area');
  const stickZones = sticks.map((stick, index) => {
    const zone = element('div', `joystick-zone stick-${index}`);
    zone.setAttribute('aria-label', stick.label);
    zone.setAttribute('role', 'application');
    zone.append(element('span', 'joystick-label', stick.label));
    area.append(zone);
    return zone;
  });
  const face = element('div', 'pad-face-buttons');
  const addAction = (action: Action<K>, parent: HTMLElement, index: string) => {
    const control = element('button', `pad-button ${action.className ?? ''}`, action.label);
    control.type = 'button';
    control.setAttribute('aria-label', action.label);
    control.addEventListener(
      'pointerdown',
      (event) => {
        event.preventDefault();
        control.setPointerCapture(event.pointerId);
        latch.set(
          `${index}:${event.pointerId}`,
          typeof action.keys === 'function' ? action.keys() : action.keys,
        );
      },
      { signal: abort.signal },
    );
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      control.addEventListener(name, (event) => latch.set(`${index}:${event.pointerId}`, []), {
        signal: abort.signal,
      });
    parent.append(control);
  };
  actions.forEach((action, index) => {
    addAction(action, face, `face-${index}`);
  });
  area.append(face);
  const toolbar = element('div', 'pad-utilities');
  utilities.forEach((action, index) => {
    addAction(action, toolbar, `tool-${index}`);
  });
  pad.append(area, toolbar);
  host.append(pad);
  const managers = sticks.map((stick, index) => {
    const zone = stickZones[index];
    if (!zone) throw new Error('Joystick zone missing');
    const manager = create({
      zone,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      size: 104,
      color: { front: '#e8e7d4', back: kind === 'doom' ? '#ad7756' : '#839b65' },
      restOpacity: 0.7,
      fadeTime: 100,
      threshold: 0.28,
      restJoystick: true,
    });
    manager.on('move', (event) =>
      latch.set(`stick-${index}`, stick.map(event.data.vector.x, event.data.vector.y)),
    );
    manager.on('end', () => latch.set(`stick-${index}`, []));
    return manager;
  });
  window.addEventListener('blur', () => latch.clear(), { signal: abort.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) latch.clear();
    },
    { signal: abort.signal },
  );
  return {
    release: () => latch.clear(),
    destroy() {
      latch.clear();
      abort.abort();
      for (const manager of managers) manager.destroy();
      pad.remove();
    },
  };
}
export function mountDoomPad(
  host: HTMLElement,
  emit: (key: number, pressed: boolean) => void,
): MobilePad {
  let weapon = 1;
  return mount(
    host,
    'doom',
    emit,
    [
      {
        label: 'Движение',
        map: (x, y) => {
          const d = directions(x, y);
          return [
            ...(d.left ? [188] : []),
            ...(d.right ? [190] : []),
            ...(d.up ? [38] : []),
            ...(d.down ? [40] : []),
            ...(Math.hypot(x, y) > 0.85 ? [16] : []),
          ];
        },
      },
      { label: 'Обзор', map: (x) => (x < -0.24 ? [37] : x > 0.24 ? [39] : []) },
    ],
    [
      { label: 'ОГОНЬ', className: 'fire-button', keys: [17] },
      { label: 'USE', className: 'use-button', keys: [32] },
    ],
    [
      { label: 'МЕНЮ', keys: [27] },
      { label: 'ENTER', keys: [13] },
      {
        label: 'ОРУЖИЕ',
        keys: () => {
          weapon = (weapon % 7) + 1;
          return [48 + weapon];
        },
      },
      { label: 'КАРТА', keys: [9] },
      { label: 'SAVE', keys: [113] },
      { label: 'LOAD', keys: [114] },
    ],
  );
}
export function mountMarioPad(
  host: HTMLElement,
  emit: (key: ButtonKey, pressed: boolean) => void,
): MobilePad {
  return mount<ButtonKey>(
    host,
    'mario',
    emit,
    [
      {
        label: 'Движение',
        map: (x, y) => {
          const d = directions(x, y);
          const keys: ButtonKey[] = [];
          if (d.left) keys.push(6);
          if (d.right) keys.push(7);
          if (d.up) keys.push(4);
          if (d.down) keys.push(5);
          return keys;
        },
      },
    ],
    [
      { label: 'B', className: 'nes-b', keys: [1] },
      { label: 'A', className: 'nes-a', keys: [0] },
    ],
    [
      { label: 'SELECT', keys: [2] },
      { label: 'START', keys: [3] },
    ],
  );
}
