import { createTetris, stepTetris } from '../../../games/tetris/engine.ts';
import {
  MAX_CHUNK_TICKS,
  type ReplayEvent,
  type TetrisAction,
  type TetrisMode,
} from '../../../games/tetris/types.ts';
import type { RunView } from '../../../shared/contracts.ts';
import { object } from '../../../shared/errors.ts';
import {
  cloneTetris,
  decodeReplayEvents,
  decodeRun,
  decodeTetris,
} from '../../../shared/validation.ts';
import { api, hasApi } from '../../platform/api.ts';
import { loadLocal, saveLocal } from '../../platform/storage.ts';
import { button, element, errorMessage, formatTime } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import { TetrisAudio } from './audio.ts';
import { drawTetris } from './renderer.ts';
import { ReplayUploader } from './replay-uploader.ts';

export async function mountTetris(
  host: GameHost,
  initialMode: TetrisMode = 'marathon',
): Promise<GameAdapter> {
  const signal = new AbortController();
  const audio = new TetrisAudio();
  const uploader = new ReplayUploader(api.submit);
  const wrap = element('div', 'tetris-layout');
  const stage = element('div', 'tetris-stage');
  const canvas = element('canvas', 'tetris-canvas');
  canvas.width = 300;
  canvas.height = 600;
  canvas.setAttribute('aria-label', 'Игровое поле Тетриса');
  const compactHud = element('div', 'compact-hud');
  stage.append(compactHud, canvas);
  canvas.tabIndex = 0;
  const panel = element('aside', 'game-panel');
  panel.append(element('span', 'eyebrow', '01 / TETRIS'), element('h2', '', 'Собери порядок.'));
  const stats = element('div', 'game-stats');
  const score = element('strong', '', '0');
  const lines = element('strong', '', '0');
  const time = element('strong', '', '00:00.00');
  const next = element('strong', '', '—');
  const hold = element('strong', '', '—');
  for (const [label, node] of [
    ['ОЧКИ', score],
    ['ЛИНИИ', lines],
    ['ВРЕМЯ', time],
    ['ДАЛЬШЕ', next],
    ['HOLD', hold],
  ] as const) {
    const row = element('div', 'stat-row');
    row.append(element('span', '', label), node);
    stats.append(row);
  }
  const mode = element('select', 'select');
  mode.setAttribute('aria-label', 'Режим Тетриса');
  for (const [value, label] of [
    ['marathon', 'Marathon / очки'],
    ['sprint', 'Sprint / 40 линий'],
    ['ultra', 'Ultra / 2 минуты'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    mode.append(option);
  }
  const status = element('p', 'game-status', 'Выбери режим и начни партию.');
  let state = createTetris(1, 'marathon');
  let started = false;
  let paused = false;
  let disposed = false;
  let starting = false;
  let run: RunView | null = null;
  let events: ReplayEvent[] = [];
  let synchronizing = false;
  let generation = 0;
  let frame = 0;
  let previous = performance.now();
  let accumulator = 0;
  let lastSync = 0;
  let lastSave = 0;
  const pending: TetrisAction[] = [];
  const held = new Map<TetrisAction, number>();
  mode.value = initialMode;
  const selectedMode = () => mode.value as TetrisMode;
  let pendingCreate: { mode: TetrisMode; requestId: string } | null = null;
  const focusGame = () => {
    canvas.focus({ preventScroll: true });
    host.container.closest('dialog')?.scrollTo({ top: 0, behavior: 'instant' });
  };
  const persist = async () => {
    if (!started) return;
    if (run?.status === 'active')
      await saveLocal('tetris-ranked', { run, state: cloneTetris(state), events: [...events] });
    else if (!run) await saveLocal('tetris-practice', cloneTetris(state));
  };
  const setStatus = (message: string) => {
    status.textContent = message;
  };
  const render = () => {
    drawTetris(canvas, state);
    compactHud.textContent = `ОЧКИ ${state.score} / ЛИНИИ ${state.lines} / ${formatTime(state.tick)}`;
    score.textContent = state.score.toLocaleString('ru-RU');
    lines.textContent = String(state.lines);
    time.textContent = formatTime(state.tick);
    next.textContent = state.queue.slice(0, 5).join(' ');
    hold.textContent = state.hold ?? '—';
  };
  const clearInput = () => {
    pending.length = 0;
    held.clear();
  };
  async function sync(): Promise<void> {
    if (!run || synchronizing || disposed) return;
    synchronizing = true;
    const currentGeneration = generation;
    try {
      while (run && run.state.tick < state.tick && !disposed && generation === currentGeneration) {
        const activeRun = run;
        const untilTick = Math.min(activeRun.state.tick + MAX_CHUNK_TICKS, state.tick);
        const chunk = events.filter(
          (event) => event.tick > activeRun.state.tick && event.tick <= untilTick,
        );
        const result = await uploader.upload(activeRun, untilTick, chunk);
        if (disposed || generation !== currentGeneration) return;
        run = result;
        events = events.filter((event) => event.tick > result.state.tick);
        if (result.status === 'verified') {
          setStatus('Результат проверен. Рекорд учтён в рейтинге.');
          await saveLocal('tetris-ranked', null);
        } else if (result.status === 'unranked') {
          setStatus('Попытка проверена. Для Sprint нужно завершить 40 линий.');
          await saveLocal('tetris-ranked', null);
        } else setStatus('Рейтинговая партия · запись синхронизирована');
      }
      if (run?.status === 'active') await persist();
    } catch (error) {
      if (!disposed && generation === currentGeneration) {
        setStatus(`Запись ждёт отправки: ${errorMessage(error)}`);
        await persist().catch(() => {});
      }
    } finally {
      synchronizing = false;
    }
  }
  async function start(ranked: boolean): Promise<void> {
    if (starting || disposed) return;
    if (run?.status === 'active' && state.status !== 'playing' && run.state.tick < state.tick) {
      await sync();
      if (run?.status === 'active') {
        setStatus('Дождись отправки результата перед новой партией.');
        return;
      }
    }
    starting = true;
    paused = true;
    started = false;
    const previousRun = run;
    generation++;
    uploader.reset();
    run = null;
    clearInput();
    if (previousRun?.status === 'active') void api.abandon(previousRun.id).catch(() => {});
    try {
      audio.unlock();
      rankButton.disabled = true;
      freeButton.disabled = true;
      setStatus(ranked ? 'Создаём рейтинговую партию…' : 'Свободная игра');
      if (ranked && pendingCreate?.mode !== selectedMode())
        pendingCreate = { mode: selectedMode(), requestId: crypto.randomUUID() };
      const created =
        ranked && pendingCreate
          ? await api.create(pendingCreate.mode, pendingCreate.requestId)
          : null;
      pendingCreate = null;
      if (disposed) return;
      run = created;
      state = created
        ? cloneTetris(created.state)
        : createTetris(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1, selectedMode());
      events = [];
      started = true;
      paused = false;
      accumulator = 0;
      previous = performance.now();
      mode.disabled = true;
      setStatus(
        ranked
          ? 'Рейтинговая партия · пауза завершает попытку'
          : 'Свободная игра · сохранение на устройстве',
      );
      render();
      focusGame();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      starting = false;
      rankButton.disabled = !hasApi;
      freeButton.disabled = false;
    }
  }
  const rankButton = button(
    'Играть в рейтинг',
    () => {
      void start(true);
    },
    'button primary',
  );
  rankButton.disabled = !hasApi;
  const freeButton = button(
    'Свободная игра',
    () => {
      void start(false);
    },
    'button secondary',
  );
  async function stopRanked(): Promise<void> {
    const previousRun = run;
    run = null;
    generation++;
    uploader.reset();
    if (previousRun?.status === 'active') await api.abandon(previousRun.id).catch(() => {});
    await saveLocal('tetris-ranked', null).catch(() => {});
  }
  const pauseButton = button(
    'Пауза',
    () => {
      if (!started || state.status !== 'playing') return;
      if (run) {
        void stopRanked();
        setStatus('Рейтинговая попытка остановлена. Дальше — свободная игра.');
      }
      paused = !paused;
      clearInput();
      pauseButton.textContent = paused ? 'Продолжить' : 'Пауза';
      void persist().catch(() => {});
    },
    'button secondary',
  );
  const loadButton = button(
    'Продолжить сохранённую',
    () => {
      void (async () => {
        try {
          const saved = await loadLocal('tetris-practice');
          if (!saved) {
            setStatus('Сохранённой свободной партии пока нет.');
            return;
          }
          await stopRanked();
          if (disposed) return;
          state = decodeTetris(saved);
          mode.value = state.mode;
          events = [];
          started = true;
          paused = false;
          mode.disabled = true;
          accumulator = 0;
          previous = performance.now();
          setStatus('Свободная партия восстановлена.');
          render();
          focusGame();
        } catch (error) {
          setStatus(errorMessage(error));
        }
      })();
    },
    'button subtle',
  );
  const restoreRanked = button(
    'Восстановить рейтинговую',
    () => {
      void (async () => {
        if (starting) return;
        starting = true;
        try {
          const saved = await loadLocal('tetris-ranked');
          if (!saved) {
            setStatus('Незавершённой рейтинговой партии нет.');
            return;
          }
          const data = object(saved);
          const localRun = decodeRun(data.run);
          const localState = decodeTetris(data.state);
          const localEvents = decodeReplayEvents(data.events);
          const remote = await api.get(localRun.id);
          if (disposed) return;
          if (remote.status !== 'active') {
            setStatus('Эта рейтинговая попытка уже завершена.');
            return;
          }
          if (Date.now() > remote.expiresAt) {
            setStatus('Срок восстановления попытки истёк.');
            return;
          }
          state = cloneTetris(remote.state);
          const remaining = localEvents.filter((e) => e.tick > state.tick);
          let index = 0;
          while (state.tick < localState.tick && state.status === 'playing') {
            const actions: TetrisAction[] = [];
            while (remaining[index]?.tick === state.tick + 1) {
              const e = remaining[index++];
              if (e) actions.push(e.action);
            }
            stepTetris(state, actions);
          }
          generation++;
          uploader.reset();
          run = remote;
          events = remaining;
          started = true;
          paused = false;
          mode.value = state.mode;
          mode.disabled = true;
          previous = performance.now();
          accumulator = 0;
          clearInput();
          setStatus('Рейтинговая попытка восстановлена.');
          render();
          focusGame();
        } catch (error) {
          setStatus(errorMessage(error));
        } finally {
          starting = false;
        }
      })();
    },
    'button subtle',
  );
  restoreRanked.disabled = !hasApi;
  const soundButton = button(
    'Звук: вкл',
    () => {
      audio.enabled = !audio.enabled;
      soundButton.textContent = audio.enabled ? 'Звук: вкл' : 'Звук: выкл';
    },
    'button subtle',
  );
  panel.append(
    stats,
    mode,
    rankButton,
    freeButton,
    pauseButton,
    loadButton,
    restoreRanked,
    soundButton,
    status,
    element(
      'p',
      'control-hint',
      '← → движение · ↑ поворот · Z обратный поворот · ↓ спуск · пробел сброс · C hold',
    ),
  );
  const touch = element('div', 'touch-controls');
  const repeatable = new Set<TetrisAction>(['left', 'right', 'softDrop']);
  for (const [label, action] of [
    ['HOLD', 'hold'],
    ['↶', 'rotateCCW'],
    ['←', 'left'],
    ['↓', 'softDrop'],
    ['→', 'right'],
    ['↷', 'rotateCW'],
    ['DROP', 'hardDrop'],
  ] as const) {
    const key = button(label, () => {}, 'touch-key');
    key.setAttribute('aria-label', label);
    key.addEventListener(
      'pointerdown',
      (event) => {
        event.preventDefault();
        key.setPointerCapture(event.pointerId);
        pending.push(action);
        if (repeatable.has(action)) held.set(action, 0);
      },
      { signal: signal.signal },
    );
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      key.addEventListener(name, () => held.delete(action), { signal: signal.signal });
    touch.append(key);
  }
  stage.append(touch);
  wrap.append(stage, panel);
  host.container.append(wrap);
  const keyMap: Record<string, TetrisAction> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'softDrop',
    ArrowUp: 'rotateCW',
    KeyX: 'rotateCW',
    KeyZ: 'rotateCCW',
    Space: 'hardDrop',
    KeyC: 'hold',
  };
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement)
        return;
      const action = keyMap[event.code];
      if (!action) return;
      event.preventDefault();
      if (event.repeat) return;
      pending.push(action);
      if (repeatable.has(action)) held.set(action, 0);
    },
    { signal: signal.signal },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      const action = keyMap[event.code];
      if (action) {
        event.preventDefault();
        held.delete(action);
      }
    },
    { signal: signal.signal },
  );
  const pause = () => {
    clearInput();
    if (started) {
      paused = true;
      pauseButton.textContent = 'Продолжить';
      if (run) {
        void stopRanked();
        setStatus('Пауза завершила рейтинговую попытку. Можно продолжить свободно.');
      }
      void persist().catch(() => {});
    }
  };
  window.addEventListener('blur', pause, { signal: signal.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: signal.signal },
  );
  const animate = (now: number) => {
    if (disposed) return;
    const elapsed = Math.min(250, Math.max(0, now - previous));
    previous = now;
    if (started && !paused && state.status === 'playing') {
      accumulator += elapsed;
      while (accumulator >= 1000 / 60 && state.status === 'playing') {
        accumulator -= 1000 / 60;
        for (const [action, count] of held) {
          const nextCount = count + 1;
          held.set(action, nextCount);
          if (
            (action === 'softDrop' && nextCount % 2 === 0) ||
            (nextCount >= 10 && nextCount % 2 === 0)
          )
            pending.push(action);
        }
        const actions = pending.splice(0, 4);
        pending.length = 0;
        const before = state.lines;
        if (run) for (const action of actions) events.push({ tick: state.tick + 1, action });
        stepTetris(state, actions);
        if (state.lines > before) audio.play('clear');
        else if (actions.includes('hardDrop')) audio.play('drop');
        if (state.status !== 'playing') {
          audio.play('end');
          clearInput();
          mode.disabled = false;
          setStatus(run ? 'Партия завершена. Проверяем результат…' : 'Партия завершена. Ещё одну?');
        }
      }
      render();
    }
    if (now - lastSync > 2000) {
      lastSync = now;
      void sync();
    }
    if (now - lastSave > 2500) {
      lastSave = now;
      void persist().catch(() => {});
    }
    frame = requestAnimationFrame(animate);
  };
  render();
  frame = requestAnimationFrame(animate);
  return {
    pause,
    resume() {
      paused = false;
      previous = performance.now();
      pauseButton.textContent = 'Пауза';
    },
    dispose() {
      if (disposed) return;
      void persist().catch(() => {});
      disposed = true;
      generation++;
      uploader.reset();
      signal.abort();
      cancelAnimationFrame(frame);
      audio.dispose();
      clearInput();
    },
  };
}
