import {
  createSnake,
  opposite,
  SNAKE_CHUNK,
  SNAKE_DIRECTIONS,
  SNAKE_MAX_TICKS,
  SNAKE_PLAYABLE_SIZES,
  SNAKE_STEP_MS,
  type SnakeDirection,
  stepSnake,
} from '../../../games/snake/engine.ts';
import { object, oneOf, text } from '../../../shared/errors.ts';
import { decodeSnakeState, type SnakeRun, snakeSize } from '../../../shared/snake.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import { snakeInput } from './input.ts';
import { snakeRenderer } from './renderer.ts';
import './snake.css';

const PENDING_KEY = 'arcade:snake:pending:v1';
export function mountSnake(host: GameHost, initialSize = 16): GameAdapter {
  initialSize = snakeSize(initialSize);
  const root = element('div', 'snake-game');
  const play = element('section', 'snake-play');
  let selectedSize = initialSize;
  const arenas = element('div', 'snake-arenas');
  arenas.setAttribute('role', 'group');
  arenas.setAttribute('aria-label', 'Арена змейки');
  const arenaButtons = SNAKE_PLAYABLE_SIZES.map((value) => {
    const control = button(`${value}×${value}`, () => selectArena(value), 'button secondary');
    control.dataset.size = String(value);
    arenas.append(control);
    return control;
  });
  const toolbar = element('div', 'snake-toolbar');
  const ranked = button(
    'Рейтинговая игра',
    () => {
      void begin(true);
    },
    'button primary',
  );
  const free = button(
    'Свободная игра',
    () => {
      void begin(false);
    },
    'button secondary',
  );
  toolbar.append(ranked, free);
  const stats = element('div', 'snake-stats');
  const score = element('strong', 'snake-score', '0');
  const scoreLabel = element('div');
  scoreLabel.append(element('span', 'eyebrow', 'ОЧКИ / +10 ЗА ЯБЛОКО'), score);
  const mode = element('p', 'control-hint', 'Выбери арену и тип партии.');
  stats.append(scoreLabel, mode);
  const field = element('div', 'snake-field');
  const canvas = element('canvas', 'snake-canvas');
  canvas.setAttribute('aria-label', 'Поле змейки. Управление стрелками, WASD или свайпами.');
  canvas.tabIndex = 0;
  const overlay = element('div', 'snake-overlay');
  const overlayTitle = element('strong', '', 'ВЫРАСТИ СВОЙ РЕКОРД.');
  const overlayText = element('span', '', 'Яблоко за яблоком. Только не кусай себя.');
  overlay.append(overlayTitle, overlayText);
  field.append(canvas, overlay);
  const message = element(
    'p',
    'snake-message',
    hasApi
      ? 'Сервер проверит движения и рассчитает результат.'
      : 'Рейтинговая игра доступна внутри Telegram.',
  );
  message.setAttribute('role', 'status');
  const actions = element('div', 'snake-actions');
  const pauseButton = button('Пауза', togglePause, 'button secondary');
  const retry = button(
    'Повторить отправку',
    () => {
      void sync();
    },
    'button secondary',
  );
  retry.hidden = true;
  const discard = button(
    'Не отправлять',
    () => {
      run = null;
      pending = false;
      clearPending();
      retry.hidden = discard.hidden = true;
      message.textContent = 'Отправка отменена. Можно начать новую игру.';
      controls();
    },
    'button secondary',
  );
  discard.hidden = true;
  actions.append(pauseButton, retry, discard);
  const bottom = element('div', 'snake-bottom');
  const pad = element('div', 'direction-pad');
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Управление змейкой');
  const moveButtons = SNAKE_DIRECTIONS.map((direction) => {
    const control = element(
      'button',
      `button secondary direction-${direction}`,
      { up: '↑', right: '→', down: '↓', left: '←' }[direction],
    );
    control.type = 'button';
    control.setAttribute(
      'aria-label',
      `Двигаться ${{ up: 'вверх', right: 'вправо', down: 'вниз', left: 'влево' }[direction]}`,
    );
    control.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      turn(direction);
    });
    control.addEventListener('click', (e) => {
      if (e.detail === 0) turn(direction);
    });
    pad.append(control);
    return control;
  });
  const hint = element(
    'p',
    'control-hint',
    'Стрелки на экране или свайпы. На компьютере: WASD / ← ↑ ↓ →. Пробел — пауза.',
  );
  bottom.append(pad, hint);
  play.append(arenas, toolbar, stats, field, actions, message, bottom);
  const aside = element('aside', 'snake-aside');
  aside.append(
    element('span', 'eyebrow', 'SNAKE / GARDEN CLUB'),
    element('h2', '', 'РАСТИ.\nНЕ СДАВАЙСЯ.'),
    element('p', 'snake-intro', 'Арены 16×16, 20×20 и 24×24. Десять очков за каждое яблоко.'),
  );
  root.append(play, aside);
  host.container.replaceChildren(root);
  let state = createSnake(initialSize, 12345);
  let previous: number[] = [...state.body];
  let run: SnakeRun | null = null;
  let directions: SnakeDirection[] = [];
  let queue: SnakeDirection[] = [];
  let playing = false;
  let paused = false;
  let disposed = false;
  let starting = false;
  let syncing = false;
  let pending = false;
  let started = false;
  let verified = false;
  let notificationRunId: string | null = null;
  let notificationUntil = 0;
  let nextNotificationPoll = 0;
  let lastStep = performance.now();
  let frame = 0;
  const draw = snakeRenderer(canvas);
  function controls() {
    const locked = playing || starting || syncing || pending;
    for (const control of arenaButtons) {
      control.disabled = locked;
      const selected = Number(control.dataset.size) === selectedSize;
      control.className = `button ${selected ? 'primary' : 'secondary'}`;
      control.setAttribute('aria-pressed', String(selected));
    }
    ranked.disabled = !hasApi || locked;
    free.disabled = locked;
    pauseButton.disabled = !playing;
    pauseButton.textContent = paused ? 'Продолжить' : 'Пауза';
    retry.disabled = discard.disabled = syncing;
    score.textContent = String(state.score);
    for (const control of moveButtons) control.disabled = !playing || paused;
    mode.textContent = pending
      ? 'Проверка результата'
      : verified
        ? 'Результат записан'
        : run
          ? 'Рейтинговая партия'
          : started
            ? 'Свободная партия'
            : 'Выбери арену и тип партии.';
    overlay.hidden = playing && !paused;
  }
  function clearPending() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* Storage is best effort. */
    }
  }
  function savePending() {
    if (!run || state.status === 'playing') return;
    pending = true;
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ runId: run.id, state, directions }));
    } catch {
      message.textContent = 'Не закрывай игру до отправки: хранилище устройства недоступно.';
    }
  }
  function selectArena(value: number) {
    if (playing || starting || syncing || pending) return;
    selectedSize = snakeSize(value);
    state = createSnake(selectedSize, 12345);
    previous = [...state.body];
    started = false;
    verified = false;
    overlayTitle.textContent = `${selectedSize}×${selectedSize}`;
    overlayText.textContent = 'Выбери рейтинговую или свободную игру.';
    controls();
  }
  async function begin(isRanked: boolean) {
    if (playing || starting || syncing || pending) return;
    starting = true;
    controls();
    message.textContent = isRanked ? 'Создаём рейтинговую партию…' : 'Собирай яблоки. Удачи!';
    try {
      run = isRanked ? await api.createSnake(crypto.randomUUID(), selectedSize) : null;
      if (disposed) return;
      state = run
        ? decodeSnakeState(run.state)
        : createSnake(selectedSize, crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
      started = true;
      verified = false;
      previous = [...state.body];
      directions = [];
      notificationRunId = null;
      queue = [];
      playing = true;
      paused = false;
      lastStep = performance.now();
      message.textContent = run
        ? 'Рейтинговая партия. Пауза или сворачивание переводят её в свободную игру.'
        : 'Свободная игра. Собирай яблоки!';
      canvas.focus({ preventScroll: true });
      if (document.hidden) pause();
    } catch (error) {
      message.textContent = `${errorMessage(error)}. Повтори запуск или нажми «Свободная игра».`;
    } finally {
      starting = false;
      if (!disposed) controls();
    }
  }
  async function sync() {
    if (!run || syncing || disposed) return;
    const id = run.id;
    const target = directions.length;
    syncing = true;
    controls();
    try {
      let accepted = await api.getSnake(id);
      while (accepted.state.ticks < target && !disposed && run?.id === id) {
        accepted = await api.submitSnake({
          runId: id,
          revision: accepted.revision,
          directions: directions.slice(
            accepted.state.ticks,
            Math.min(target, accepted.state.ticks + SNAKE_CHUNK),
          ),
        });
      }
      if (disposed || run?.id !== id) return;
      run = accepted;
      if (accepted.status === 'verified') {
        verified = true;
        notificationRunId = id;
        notificationUntil = Date.now() + 15 * 60000;
        nextNotificationPoll = Date.now() + 30000;
        pending = false;
        clearPending();
        message.textContent = `Результат проверен и записан: ${accepted.state.score} очков.`;
        retry.hidden = discard.hidden = true;
        run = null;
      } else if (pending) message.textContent = 'Завершаем отправку результата…';
    } catch (error) {
      if (!disposed && run?.id === id) {
        message.textContent = `${errorMessage(error)}. ${pending ? 'Результат ждёт отправки.' : 'Игра продолжается, отправку повторим.'}`;
        retry.hidden = false;
        discard.hidden = !pending;
      }
    } finally {
      syncing = false;
      if (!disposed) controls();
    }
    // The last step may have happened while a periodic upload was in progress.
    if (
      !disposed &&
      pending &&
      run?.id === id &&
      run.state.ticks < directions.length &&
      run.state.ticks >= target
    )
      void sync();
  }
  function pause() {
    if (!playing || paused) return;
    paused = true;
    queue = [];
    if (run) {
      run = null;
      message.textContent = 'Пауза. Эта партия теперь свободная и не попадёт в рейтинг.';
      retry.hidden = true;
    }
    overlayTitle.textContent = 'ПАУЗА';
    overlayText.textContent = 'Сад подождёт. Продолжи, когда будешь готов.';
    controls();
  }
  function resume() {
    if (!playing || !paused) return;
    paused = false;
    lastStep = performance.now();
    canvas.focus({ preventScroll: true });
    controls();
  }
  function togglePause() {
    if (paused) resume();
    else pause();
  }
  function turn(direction: SnakeDirection) {
    if (!playing || paused || queue.length >= 2) return;
    const last = queue[queue.length - 1] ?? state.direction;
    if (last !== direction && !opposite(last, direction)) queue.push(direction);
  }
  const stopInput = snakeInput(canvas, turn, togglePause);
  function animate(now: number) {
    if (disposed) return;
    if (playing && !paused && now - lastStep > 1500) pause();
    if (playing && !paused && now - lastStep >= SNAKE_STEP_MS) {
      previous = [...state.body];
      const direction = queue.shift() ?? state.direction;
      stepSnake(state, direction);
      directions.push(direction);
      lastStep += SNAKE_STEP_MS;
      score.textContent = String(state.score);
      if (state.status !== 'playing') {
        playing = false;
        overlayTitle.textContent = state.status === 'won' ? 'ВЕСЬ САД ТВОЙ!' : 'ЕЩЁ ОДНО ЯБЛОКО?';
        overlayText.textContent = `${state.score} очков · длина ${state.body.length}`;
        if (run) {
          savePending();
          message.textContent = 'Проверяем и записываем результат…';
          retry.hidden = false;
          void sync();
        } else message.textContent = 'Свободная партия завершена. Сыграем ещё?';
        controls();
      } else if (run && state.ticks % 64 === 0) void sync();
    }
    draw(
      state,
      previous,
      playing && !paused ? Math.min(1, (now - lastStep) / SNAKE_STEP_MS) : 1,
      now,
    );
    frame = requestAnimationFrame(animate);
  }
  const visibility = () => {
    if (document.hidden) pause();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', pause);
  try {
    const saved = localStorage.getItem(PENDING_KEY);
    if (saved && hasApi) {
      const data = object(JSON.parse(saved));
      const finalState = decodeSnakeState(data.state);
      if (
        finalState.status === 'playing' ||
        !Array.isArray(data.directions) ||
        data.directions.length !== finalState.ticks ||
        data.directions.length > SNAKE_MAX_TICKS
      )
        throw new Error('Invalid pending replay');
      directions = data.directions.map((v) => oneOf(v, SNAKE_DIRECTIONS));
      state = finalState;
      previous = [...state.body];
      pending = true;
      // getSnake supplies the authoritative checkpoint before submitting any stored input.
      run = {
        id: text(data.runId, 1, 100),
        ruleset: 'snake-v1',
        revision: 0,
        state: createSnake(state.size, 1),
        status: 'active',
        createdAt: 0,
        expiresAt: 0,
      };
      selectedSize = state.size;
      started = true;
      overlayTitle.textContent = 'РЕЗУЛЬТАТ ЖДЁТ ОТПРАВКИ';
      overlayText.textContent = `${state.score} очков`;
      retry.hidden = discard.hidden = false;
      void sync();
    }
  } catch {
    clearPending();
    pending = false;
    run = null;
  }
  controls();
  frame = requestAnimationFrame(animate);
  const retryTimer = window.setInterval(() => {
    if (pending) void sync();
    else if (
      notificationRunId &&
      Date.now() < notificationUntil &&
      Date.now() >= nextNotificationPoll
    ) {
      nextNotificationPoll = Date.now() + 30000;
      void api.getSnake(notificationRunId).catch(() => {
        /* The next poll retries queued notifications. */
      });
    }
  }, 15000);
  return {
    pause,
    resume,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      clearInterval(retryTimer);
      stopInput();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', pause);
      root.remove();
    },
  };
}
