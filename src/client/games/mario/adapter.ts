import { Browser, type EmulatorData } from 'jsnes';
import { object } from '../../../shared/errors.ts';
import { type MobilePad, mountMarioPad } from '../../controls/mobile-pad.ts';
import { loadLocal, saveLocal } from '../../platform/storage.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
export async function mountMario(host: GameHost): Promise<GameAdapter> {
  const abort = new AbortController();
  let browser: Browser | null = null;
  let hash = '';
  let disposed = false;
  const wrap = element('div', 'emulator-layout');
  const screen = element('div', 'nes-screen');
  const panel = element('aside', 'game-panel');
  const status = element(
    'p',
    'game-status',
    'Выбери свой ROM Super Mario Bros. для NES. Файл остаётся на устройстве.',
  );
  panel.append(
    element('span', 'eyebrow', '02 / SUPER MARIO BROS.'),
    element('h2', '', 'Восемь миров. Одна цель.'),
    element('span', 'pill', 'Свободная игра'),
  );
  const input = element('input', 'file-input');
  input.type = 'file';
  input.accept = '.nes';
  input.setAttribute('aria-label', 'Загрузить ROM Super Mario Bros.');
  let pad: MobilePad | null = null;
  const release = () => pad?.release();
  input.addEventListener(
    'change',
    () => {
      void (async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;
          if (file.size > 1024 * 1024) throw new Error('ROM слишком большой для Super Mario Bros.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (disposed) return;
          if (bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a)
            throw new Error('Нужен NES ROM в формате iNES');
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          hash = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
            '',
          );
          if (disposed) return;
          browser?.destroy();
          screen.replaceChildren();
          browser = new Browser({
            container: screen,
            onError: (error) => {
              status.textContent = error.message;
            },
          });
          browser.keyboard.setKeys({
            37: [1, 6, 'Left'],
            39: [1, 7, 'Right'],
            38: [1, 4, 'Up'],
            40: [1, 5, 'Down'],
            90: [1, 1, 'B'],
            88: [1, 0, 'A'],
            13: [1, 3, 'Start'],
            16: [1, 2, 'Select'],
          });
          browser.nes.loadROM(bytes);
          browser.start();
          browser.fitInParent();
          host.container.closest('dialog')?.scrollTo({ top: 0, behavior: 'instant' });
          status.textContent =
            'Нажми START. X / A — прыжок, Z / B — бег и огонь. Сохранения привязаны к этому ROM.';
        } catch (error) {
          status.textContent = errorMessage(error);
        }
      })();
    },
    { signal: abort.signal },
  );
  const pauseButton = button(
    'Пауза',
    () => {
      browser?.stop();
      release();
      status.textContent = 'Пауза';
    },
    'button secondary',
  );
  const playButton = button(
    'Продолжить',
    () => {
      browser?.start();
      status.textContent = 'Свободная игра';
    },
    'button secondary',
  );
  const saveButton = button(
    'Сохранить',
    () => {
      void (async () => {
        try {
          if (!browser || !hash) return;
          release();
          await saveLocal(`mario:${hash}`, browser.nes.toJSON());
          status.textContent = 'Сохранено на устройстве.';
        } catch (error) {
          status.textContent = errorMessage(error);
        }
      })();
    },
    'button secondary',
  );
  const loadButton = button(
    'Загрузить сохранение',
    () => {
      void (async () => {
        try {
          if (!browser || !hash) {
            status.textContent = 'Сначала выбери ROM.';
            return;
          }
          const value = await loadLocal(`mario:${hash}`);
          if (!value) {
            status.textContent = 'Для этого ROM ещё нет сохранения.';
            return;
          }
          const s = object(value);
          const snapshot: EmulatorData = {
            cpu: object(s.cpu),
            mmap: object(s.mmap),
            ppu: object(s.ppu),
            papu: object(s.papu),
          };
          browser.stop();
          release();
          browser.nes.fromJSON(snapshot);
          browser.start();
          status.textContent = 'Сохранение восстановлено.';
        } catch (error) {
          status.textContent = errorMessage(error);
        }
      })();
    },
    'button subtle',
  );
  panel.append(
    input,
    pauseButton,
    playButton,
    saveButton,
    loadButton,
    status,
    element(
      'p',
      'control-hint',
      'Клавиатура: стрелки · X = A · Z = B · Enter = Start · Shift = Select. Поддерживается геймпад.',
    ),
  );
  const display = element('div', 'nes-display');
  display.append(screen);
  wrap.append(display, panel);
  host.container.append(wrap);
  pad = mountMarioPad(display, (key, pressed) => {
    if (pressed) browser?.nes.buttonDown(1, key);
    else browser?.nes.buttonUp(1, key);
  });
  const pause = () => {
    browser?.stop();
    release();
  };
  window.addEventListener('blur', pause, { signal: abort.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: abort.signal },
  );
  window.addEventListener('resize', () => browser?.fitInParent(), { signal: abort.signal });
  return {
    pause,
    resume() {
      browser?.start();
    },
    dispose() {
      disposed = true;
      abort.abort();
      release();
      pad?.destroy();
      browser?.destroy();
    },
  };
}
