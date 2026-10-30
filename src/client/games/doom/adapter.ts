import { object } from '../../../shared/errors.ts';
import { type MobilePad, mountDoomPad } from '../../controls/mobile-pad.ts';
import { loadLocal, saveLocal } from '../../platform/storage.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import type { DoomCommand, DoomSave } from './protocol.ts';
export async function mountDoom(host: GameHost): Promise<GameAdapter> {
  const abort = new AbortController();
  let frame: HTMLIFrameElement | null = null;
  let hash = '';
  let ready = false;
  let disposed = false;
  const wrap = element('div', 'emulator-layout');
  const screen = element('div', 'doom-screen');
  const panel = element('aside', 'game-panel');
  const status = element(
    'p',
    'game-status',
    'Выбери свой WAD классического Doom. Файл обрабатывается на устройстве.',
  );
  panel.append(
    element('span', 'eyebrow', '03 / DOOM'),
    element('h2', '', 'До самого ада.'),
    element('span', 'pill', 'Свободная игра'),
  );
  const fileInput = element('input', 'file-input');
  fileInput.type = 'file';
  fileInput.accept = '.wad';
  fileInput.setAttribute('aria-label', 'Загрузить WAD Doom');
  const send = (message: DoomCommand, transfer: Transferable[] = []) =>
    frame?.contentWindow?.postMessage(message, location.origin, transfer);
  let pending: ArrayBuffer | null = null;
  let saves: DoomSave[] = [];
  const start = () => {
    if (ready && pending) {
      send({ type: 'doom:start', bytes: pending, saves }, [pending]);
      pending = null;
    }
  };
  window.addEventListener(
    'message',
    (event) => {
      if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
      try {
        const data = object(event.data);
        if (data.type === 'doom:ready') {
          ready = true;
          start();
        }
        if (data.type === 'doom:running')
          host.container.closest('dialog')?.scrollTo({ top: 0, behavior: 'instant' });
        if (data.type === 'doom:running')
          status.textContent =
            'Движок запущен. Enter — меню, Ctrl — огонь, Space — действие. Сохранения F2 / загрузка F3.';
        if (data.type === 'doom:error')
          status.textContent =
            typeof data.message === 'string' ? data.message : 'Не удалось запустить Doom';
        if (data.type === 'doom:saves' && Array.isArray(data.saves) && hash) {
          const next: DoomSave[] = [];
          for (const item of data.saves) {
            const save = object(item);
            if (
              typeof save.name === 'string' &&
              /^[a-zA-Z0-9_.-]+$/.test(save.name) &&
              save.bytes instanceof Uint8Array &&
              save.bytes.length <= 2_000_000
            )
              next.push({ name: save.name, bytes: save.bytes });
          }
          if (next.length <= 20) void saveLocal(`doom:${hash}`, next).catch(() => {});
        }
      } catch {
        /* ignore malformed iframe events */
      }
    },
    { signal: abort.signal },
  );
  fileInput.addEventListener(
    'change',
    () => {
      void (async () => {
        try {
          const file = fileInput.files?.[0];
          if (!file) return;
          if (file.size > 128 * 1024 * 1024) throw new Error('WAD слишком большой');
          const bytes = await file.arrayBuffer();
          if (disposed) return;
          const signature = String.fromCharCode(
            ...new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)),
          );
          if (signature !== 'IWAD')
            throw new Error('Нужен основной IWAD Doom. Дополнения PWAD пока не поддерживаются.');
          const response = await fetch('/engines/doom/manifest.json', { signal: abort.signal });
          if (!response.ok) throw new Error('Doom пока недоступен в этой сборке.');
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          hash = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
            '',
          );
          const saved = await loadLocal(`doom:${hash}`).catch(() => null);
          saves = [];
          if (Array.isArray(saved))
            for (const item of saved) {
              const s = object(item);
              if (
                typeof s.name === 'string' &&
                /^[a-zA-Z0-9_.-]+$/.test(s.name) &&
                s.bytes instanceof Uint8Array &&
                s.bytes.length <= 2_000_000
              )
                saves.push({ name: s.name, bytes: s.bytes });
            }
          if (disposed) return;
          frame?.remove();
          frame = element('iframe', 'doom-frame');
          frame.title = 'Doom';
          frame.allow = 'autoplay; fullscreen';
          frame.src = '/doom-runtime.html';
          ready = false;
          pending = bytes;
          screen.replaceChildren(frame);
          status.textContent = 'Запускаем классический движок…';
        } catch (error) {
          if (!disposed) status.textContent = errorMessage(error);
        }
      })();
    },
    { signal: abort.signal },
  );
  let pad: MobilePad | null = null;
  const release = () => pad?.release();
  const pause = () => {
    release();
    send({ type: 'doom:pause' });
  };
  panel.append(
    fileInput,
    button('Пауза', pause, 'button secondary'),
    button('Продолжить', () => send({ type: 'doom:resume' }), 'button secondary'),
    status,
    element(
      'p',
      'control-hint',
      'Стрелки — движение и поворот. Ctrl — огонь. Space — действие. Shift — бег. 1–7 — оружие. Tab — карта. Звук включается после нажатия на игровое поле.',
    ),
  );
  const display = element('div', 'doom-display');
  display.append(screen);
  wrap.append(display, panel);
  host.container.append(wrap);
  pad = mountDoomPad(display, (keyCode, pressed) => send({ type: 'doom:key', keyCode, pressed }));
  window.addEventListener(
    'blur',
    () => {
      if (document.activeElement !== frame) pause();
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: abort.signal },
  );
  return {
    pause,
    resume() {
      send({ type: 'doom:resume' });
    },
    dispose() {
      disposed = true;
      release();
      abort.abort();
      pad?.destroy();
      frame?.remove();
      pending = null;
      saves = [];
    },
  };
}
