import {
  createFlappy,
  FLAPPY_CHUNK,
  FLAPPY_HZ,
  FLAPPY_MAX_TICKS,
  stepFlappy,
} from '../../../games/flappy/engine.ts';
import { integer, object, text } from '../../../shared/errors.ts';
import { decodeFlappyState } from '../../../shared/flappy.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import { flappyAudio } from './audio.ts';
import { type FlappyPhase, flappyRenderer } from './renderer.ts';
import './flappy.css';

const PENDING_KEY = 'arcade:flappy:pending:v1';
const BEST_KEY = 'arcade:flappy:best:v1';
export async function mountFlappy(host: GameHost): Promise<GameAdapter> {
  const root = element('div', 'flappy-game');
  const toolbar = element('div', 'flappy-toolbar');
  const modeSelect = element('select', 'select');
  modeSelect.setAttribute('aria-label', 'Тип партии Flappy Bird');
  for (const [value, label] of [
    ['ranked', 'Рейтинговая игра'],
    ['free', 'Свободная игра'],
  ]) {
    const option = element('option', '', label);
    option.value = value ?? 'free';
    option.disabled = value === 'ranked' && !hasApi;
    modeSelect.append(option);
  }
  modeSelect.value = hasApi ? 'ranked' : 'free';
  let night = false;
  const theme = button(
    'Ночь',
    () => {
      night = !night;
      theme.textContent = night ? 'День' : 'Ночь';
      theme.setAttribute('aria-pressed', String(night));
    },
    'button secondary',
  );
  theme.setAttribute('aria-pressed', 'false');
  const audio = flappyAudio();
  const audioControls = element('div', 'flappy-audio');
  audioControls.setAttribute('role', 'group');
  audioControls.setAttribute('aria-label', 'Настройки звука');
  const sound = button(
    '🔊',
    () => {
      audio.toggleMuted();
      updateAudioControls();
    },
    'button secondary flappy-mute',
  );
  const volume = element('input', 'flappy-volume');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '1';
  volume.setAttribute('aria-label', 'Громкость');
  const volumeValue = element('output', 'flappy-volume-value');
  function updateAudioControls() {
    const action = audio.muted ? 'Включить звук' : 'Выключить звук';
    sound.textContent = audio.muted ? '🔇' : '🔊';
    sound.setAttribute('aria-label', action);
    sound.setAttribute('aria-pressed', String(!audio.muted));
    sound.title = action;
    volume.value = String(audio.volume);
    volume.setAttribute(
      'aria-valuetext',
      `${audio.volume}%${audio.muted ? ', звук выключен' : ''}`,
    );
    volumeValue.textContent = `${audio.volume}%`;
  }
  volume.addEventListener('input', () => {
    audio.setVolume(Number(volume.value));
    updateAudioControls();
  });
  updateAudioControls();
  audioControls.append(sound, volume, volumeValue);
  toolbar.append(modeSelect, theme, audioControls);
  const mode = element('p', 'flappy-mode');
  mode.setAttribute('role', 'status');
  const field = element('div', 'flappy-field');
  const canvas = element('canvas', 'flappy-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Flappy Bird. Тап, пробел или стрелка вверх — взмах. Escape — пауза.',
  );
  const restart = button(
    'OK',
    () => {
      if (phase === 'paused') resume();
      else returnToReady();
    },
    'flappy-pixel-button',
  );
  restart.setAttribute('aria-label', 'На главный экран');
  restart.hidden = true;
  field.append(canvas, restart);
  const message = element('p', 'flappy-message', 'Загружаем спрайты…');
  message.setAttribute('role', 'status');
  const actions = element('div', 'flappy-actions');
  const pauseButton = button('Пауза', togglePause, 'button secondary');
  const retry = button(
    'Повторить отправку',
    () => {
      void sync();
    },
    'button secondary',
  );
  const discard = button(
    'Не отправлять',
    () => {
      if (syncing) return;
      runId = null;
      pending = false;
      clearPending();
      message.textContent = 'Отправка отменена. Можно начать новый полёт.';
      controls();
    },
    'button secondary',
  );
  retry.hidden = discard.hidden = true;
  actions.append(pauseButton, retry, discard);
  root.append(
    toolbar,
    mode,
    field,
    actions,
    message,
    element(
      'p',
      'control-hint',
      'Тап / клик / пробел / ↑ — взмах. Esc — пауза. Одно очко за трубу.',
    ),
  );
  host.container.replaceChildren(root);
  const draw = await flappyRenderer(canvas);
  function playSound(name: string) {
    audio.play(name);
  }
  let state = createFlappy(12345);
  let phase: FlappyPhase = 'ready';
  let runId: string | null = null;
  let flaps: number[] = [];
  let queuedFlap = false;
  let starting = false;
  let syncing = false;
  let pending = false;
  let disposed = false;
  let verified = false;
  let sendFailed = false;
  let best = 0;
  let previousTime = performance.now();
  let accumulator = 0;
  let diedAt = 0;
  let notificationRun: string | null = null;
  let notificationUntil = 0;
  let frame = 0;
  function controls() {
    const busy = starting || pending || syncing;
    modeSelect.disabled = phase === 'playing' || phase === 'paused' || phase === 'dying' || busy;
    restart.hidden = phase !== 'over' && phase !== 'paused';
    restart.disabled = busy;
    restart.textContent = phase === 'paused' ? '▶' : 'OK';
    restart.setAttribute(
      'aria-label',
      phase === 'paused' ? 'Продолжить полёт' : 'На главный экран',
    );
    pauseButton.disabled = phase !== 'playing' && phase !== 'paused';
    pauseButton.textContent = phase === 'paused' ? 'Продолжить' : 'Пауза';
    retry.hidden = discard.hidden = !pending;
    retry.disabled = discard.disabled = syncing;
    mode.textContent = starting
      ? 'Создаём партию…'
      : pending
        ? 'Результат ждёт проверки'
        : verified
          ? 'Результат проверен и записан'
          : runId
            ? 'Рейтинговая партия'
            : phase === 'ready'
              ? modeSelect.value === 'ranked'
                ? 'Рейтинговая игра · нажми на поле'
                : 'Свободная игра · нажми на поле'
              : 'Свободная партия';
    root.dataset.phase = phase;
  }
  modeSelect.addEventListener('change', controls);
  function clearPending() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* Best effort. */
    }
  }
  function persist() {
    if (!runId || state.status !== 'over') return;
    pending = true;
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ runId, state, flaps }));
    } catch {
      message.textContent = 'Не закрывай игру до отправки: хранилище устройства недоступно.';
    }
  }
  function returnToReady() {
    if (disposed || starting || pending || syncing || phase !== 'over') return;
    state = createFlappy(12345);
    phase = 'ready';
    runId = null;
    flaps = [];
    queuedFlap = false;
    verified = false;
    sendFailed = false;
    diedAt = 0;
    accumulator = 0;
    previousTime = performance.now();
    message.textContent = 'Нажми на поле или пробел, чтобы начать полёт.';
    controls();
    canvas.focus({ preventScroll: true });
  }
  async function begin() {
    if (disposed || starting || pending || syncing || phase !== 'ready') return;
    starting = true;
    controls();
    try {
      const ranked = modeSelect.value === 'ranked';
      const created = ranked ? await api.createFlappy(crypto.randomUUID()) : null;
      if (disposed) return;
      runId = created?.id ?? null;
      state = created
        ? decodeFlappyState(created.state)
        : createFlappy(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
      flaps = [];
      notificationRun = null;
      queuedFlap = true;
      verified = false;
      sendFailed = false;
      phase = 'playing';
      diedAt = 0;
      accumulator = 0;
      previousTime = performance.now();
      message.textContent = ranked
        ? 'Пауза или сворачивание переводят полёт в свободную игру.'
        : 'Пролетай между трубами. Каждый взмах имеет значение.';
      canvas.focus({ preventScroll: true });
      if (document.hidden || !document.hasFocus()) pause();
    } catch (error) {
      message.textContent = `${errorMessage(error)}. Повтори запуск или выбери свободную игру.`;
    } finally {
      starting = false;
      if (!disposed) controls();
    }
  }
  async function sync() {
    if (!runId || syncing || disposed) return;
    const id = runId;
    const target = state.ticks;
    syncing = true;
    controls();
    try {
      let accepted = await api.getFlappy(id);
      while (accepted.state.ticks < target && runId === id && !disposed) {
        const untilTick = Math.min(target, accepted.state.ticks + FLAPPY_CHUNK);
        accepted = await api.submitFlappy({
          runId: id,
          revision: accepted.revision,
          untilTick,
          flaps: flaps.filter((tick) => tick >= accepted.state.ticks && tick < untilTick),
        });
      }
      if (runId !== id || disposed) return;
      sendFailed = false;
      if (accepted.status === 'verified') {
        pending = false;
        verified = true;
        notificationRun = id;
        notificationUntil = Date.now() + 15 * 60000;
        runId = null;
        clearPending();
        message.textContent = `Результат проверен и записан: ${accepted.state.score}.`;
      }
    } catch (error) {
      if (!disposed && runId === id) {
        sendFailed = true;
        message.textContent = `${errorMessage(error)}. ${pending ? 'Полёт сохранён для повторной отправки.' : 'Отправку повторим после полёта.'}`;
      }
    } finally {
      syncing = false;
      if (!disposed) controls();
    }
    if (!disposed && pending && runId === id && state.ticks > target && !sendFailed) void sync();
  }
  function pause() {
    if (phase !== 'playing') return;
    phase = 'paused';
    queuedFlap = false;
    runId = null;
    message.textContent = 'Пауза. Этот полёт теперь свободный и не попадёт в рейтинг.';
    controls();
  }
  function resume() {
    if (phase !== 'paused') return;
    phase = 'playing';
    previousTime = performance.now();
    accumulator = 0;
    canvas.focus({ preventScroll: true });
    controls();
  }
  function togglePause() {
    if (phase === 'paused') resume();
    else pause();
  }
  function flap() {
    if (phase === 'over') {
      returnToReady();
      return;
    }
    if (phase === 'ready') {
      void begin();
      return;
    }
    if (phase === 'paused') {
      resume();
      return;
    }
    if (phase === 'playing' && state.ticks - state.lastFlap >= 4) queuedFlap = true;
  }
  const pointer = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    flap();
  };
  const key = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest('button, select, input, a')) return;
    if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) flap();
    } else if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault();
      if (!event.repeat) togglePause();
    }
  };
  canvas.addEventListener('pointerdown', pointer);
  window.addEventListener('keydown', key);
  const visibility = () => {
    if (document.hidden) pause();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', pause);
  function animate(now: number) {
    if (disposed) return;
    const elapsed = now - previousTime;
    previousTime = now;
    if (phase === 'playing' && elapsed > 1000) pause();
    if (phase === 'playing') {
      accumulator += Math.min(elapsed, 250);
      while (accumulator >= 1000 / FLAPPY_HZ && phase === 'playing') {
        const action = queuedFlap && state.ticks - state.lastFlap >= 4;
        if (action) {
          flaps.push(state.ticks);
          playSound('wing');
        }
        queuedFlap = false;
        const oldScore = state.score;
        stepFlappy(state, action);
        accumulator -= 1000 / FLAPPY_HZ;
        if (state.score > oldScore) playSound('point');
        if (state.status === 'over') {
          phase = 'dying';
          diedAt = now;
          playSound('hit');
          best = Math.max(best, state.score);
          try {
            localStorage.setItem(BEST_KEY, String(best));
          } catch {
            /* Best effort. */
          }
          if (runId) {
            persist();
            void sync();
          } else message.textContent = `Свободный полёт завершён: ${state.score}. Ещё попытку?`;
          controls();
        } else if (runId && state.ticks % 300 === 0 && !sendFailed) void sync();
      }
    }
    if (phase === 'dying' && now - diedAt >= 700) {
      phase = 'over';
      playSound('die');
      controls();
    }
    draw(state, phase, now, best, night, diedAt ? now - diedAt : 0);
    frame = requestAnimationFrame(animate);
  }
  try {
    best = integer(Number(localStorage.getItem(BEST_KEY) ?? 0), 0, FLAPPY_MAX_TICKS);
  } catch {
    /* A corrupt local best does not affect ranked play. */
  }
  try {
    const saved = localStorage.getItem(PENDING_KEY);
    if (saved && hasApi) {
      const data = object(JSON.parse(saved));
      const final = decodeFlappyState(data.state);
      if (
        final.status !== 'over' ||
        !Array.isArray(data.flaps) ||
        data.flaps.length > FLAPPY_MAX_TICKS / 4
      )
        throw new Error('Invalid saved flight');
      flaps = data.flaps.map((value) => integer(value, 0, final.ticks - 1));
      for (let i = 1; i < flaps.length; i++)
        if ((flaps[i] ?? 0) - (flaps[i - 1] ?? 0) < 4) throw new Error('Invalid saved flaps');
      state = final;
      runId = text(data.runId, 1, 100);
      pending = true;
      phase = 'over';
      diedAt = performance.now() - 1000;
      best = Math.max(best, state.score);
      void sync();
    } else message.textContent = 'Нажми на поле или пробел, чтобы начать полёт.';
  } catch {
    clearPending();
    runId = null;
    pending = false;
  }
  const retryTimer = window.setInterval(() => {
    if (pending) void sync();
    else if (notificationRun && Date.now() < notificationUntil)
      void api.getFlappy(notificationRun).catch(() => {
        /* Retry at next poll. */
      });
  }, 30000);
  controls();
  frame = requestAnimationFrame(animate);
  return {
    pause,
    resume,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      clearInterval(retryTimer);
      canvas.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', pause);
      audio.dispose();
      root.remove();
    },
  };
}
