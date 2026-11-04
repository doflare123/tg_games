import { createAdventure, stepAdventure } from '../../../games/doodle/adventure.ts';
import {
  DOODLE_CHUNK,
  DOODLE_HZ,
  DOODLE_MAX_TICKS,
  type DoodleDirection,
} from '../../../games/doodle/engine.ts';
import { DOODLE_RULESET, type DoodleEvent } from '../../../shared/doodle.ts';
import { decodeAdventureEvent, decodeAdventureState } from '../../../shared/doodle-adventure.ts';
import { isDoodleRankedEnabled } from '../../../shared/doodle-policy.ts';
import { integer, object, text } from '../../../shared/errors.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import { type DoodlePhase, doodleRenderer } from './renderer.ts';
import { loadDoodleSprites } from './sprites.ts';
import { createDoodleTilt } from './tilt.ts';
import './doodle.css';

const BEST_KEY = 'arcade:doodle:best:v3';
const PENDING_KEY = 'arcade:doodle:pending:v3';
export async function mountDoodle(host: GameHost): Promise<GameAdapter> {
  const atlas = await loadDoodleSprites();
  const root = element('div', 'doodle-game');
  const toolbar = element('div', 'doodle-toolbar');
  const select = element('select', 'select');
  select.setAttribute('aria-label', 'Тип партии Doodle Jump');
  const canRank = hasApi && isDoodleRankedEnabled();
  for (const [value, label] of [
    ['ranked', 'Рейтинговая игра'],
    ['free', 'Свободная игра'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    option.disabled = value === 'ranked' && !canRank;
    select.append(option);
  }
  select.value = canRank ? 'ranked' : 'free';
  const mode = element('p', 'doodle-mode', 'Платформы · монстры · усиления');
  const field = element('div', 'doodle-field');
  const canvas = element('canvas', 'doodle-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Doodle Jump. Стрелки или A D — движение. Пробел, стрелка вверх, W или тап — выстрел. Escape — пауза.',
  );
  field.append(canvas);
  const message = element('p', 'doodle-message');
  message.setAttribute('role', 'status');
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
      message.textContent = 'Отправка отменена. Можно начать новую игру.';
      controls();
    },
    'button secondary',
  );
  const delivery = element('div', 'doodle-toolbar');
  delivery.append(retry, discard);
  const start = button(
    'Начать',
    () => {
      if (phase === 'paused') resume();
      else void begin();
    },
    'button doodle-start',
  );
  const pauseButton = button(
    'Пауза',
    () => {
      if (phase === 'paused') resume();
      else pause();
    },
    'button secondary doodle-pause',
  );
  const touchControls = element('div', 'doodle-controls');
  const left = element('button', 'button secondary', '←');
  left.type = 'button';
  left.setAttribute('aria-label', 'Двигаться влево');
  const right = element('button', 'button secondary', '→');
  right.type = 'button';
  right.setAttribute('aria-label', 'Двигаться вправо');
  const fire = element('button', 'button doodle-fire', '◎');
  fire.type = 'button';
  fire.setAttribute('aria-label', 'Стрелять');
  fire.append(element('span', '', 'ОГОНЬ'));
  touchControls.append(left, fire, right);
  const tiltControls = element('div', 'doodle-tilt-controls');
  const tiltButton = button(
    'Включить наклоны',
    () => {
      if (tilt.wanted) tilt.disable();
      else void tilt.enable();
    },
    'button secondary',
  );
  tiltButton.setAttribute('aria-pressed', 'false');
  const calibrate = button('Настроить центр', () => tilt.calibrate(), 'button secondary');
  const tiltStatus = element(
    'p',
    'doodle-tilt-status',
    'На телефоне можно играть наклонами или кнопками.',
  );
  tiltStatus.setAttribute('role', 'status');
  tiltControls.append(tiltButton, calibrate);
  toolbar.append(select, start, pauseButton);
  root.append(
    toolbar,
    mode,
    field,
    touchControls,
    tiltControls,
    tiltStatus,
    message,
    delivery,
    element(
      'p',
      'control-hint',
      '← → / A D — движение. Пробел / ↑ / W / тап — выстрел. С наклонами удерживай «Огонь». На крылатых монстров можно прыгать сверху; шипы опасны.',
    ),
    element(
      'p',
      'doodle-ranked-note',
      canRank
        ? 'В рейтинге учитываются завершённые партии с серверной проверкой. Пауза переводит партию в свободную игру.'
        : 'Рейтинговая игра доступна в Telegram.',
    ),
  );
  host.container.replaceChildren(root);
  const draw = doodleRenderer(canvas, atlas);
  let state = createAdventure(12345);
  let runId: string | null = null;
  let events: DoodleEvent[] = [];
  let pending = false,
    syncing = false,
    verified = false,
    sendFailed = false;
  let phase: DoodlePhase = 'ready';
  let starting = false,
    disposed = false,
    best = 0,
    frame = 0;
  let previous = performance.now(),
    accumulator = 0,
    diedAt = 0;
  let queuedShot = false,
    aim = 0;
  const keys = new Set<string>(),
    movement = new Map<number, DoodleDirection>(),
    firing = new Set<number>();
  const tilt = createDoodleTilt((status) => {
    tiltStatus.textContent = status.message;
    controls();
  });
  function clearInput() {
    keys.clear();
    movement.clear();
    firing.clear();
    queuedShot = false;
    aim = 0;
  }
  function direction(): DoodleDirection {
    const pointer = [...movement.values()].at(-1);
    if (pointer !== undefined) return pointer;
    const l = keys.has('ArrowLeft') || keys.has('KeyA'),
      r = keys.has('ArrowRight') || keys.has('KeyD');
    if (l || r) return l === r ? 0 : l ? -1 : 1;
    return tilt.direction();
  }
  function controls() {
    start.hidden = phase === 'playing';
    start.disabled = starting || pending || syncing;
    select.disabled = starting || pending || syncing || phase === 'playing' || phase === 'paused';
    delivery.hidden = !pending;
    retry.disabled = discard.disabled = syncing;
    start.textContent = phase === 'paused' ? 'Продолжить' : phase === 'over' ? 'Ещё раз' : 'Начать';
    pauseButton.disabled = phase !== 'playing' && phase !== 'paused';
    pauseButton.textContent = phase === 'paused' ? 'Продолжить' : 'Пауза';
    tiltButton.textContent = tilt.wanted ? 'Выключить наклоны' : 'Включить наклоны';
    tiltButton.setAttribute('aria-pressed', String(tilt.wanted));
    tiltButton.disabled = phase === 'playing' && !tilt.wanted;
    calibrate.hidden = !tilt.wanted;
    calibrate.disabled = tilt.status.phase !== 'on';
    fire.disabled = left.disabled = right.disabled = phase !== 'playing';
    root.dataset.phase = phase;
    root.dataset.ranked = String(runId !== null);
    root.dataset.verified = String(verified);
    mode.textContent = starting
      ? 'Создаём партию…'
      : pending
        ? 'Результат ждёт проверки'
        : verified
          ? 'Результат проверен и записан'
          : runId
            ? 'Рейтинговая партия'
            : phase === 'ready' && select.value === 'ranked'
              ? 'Рейтинговая игра'
              : 'Свободная игра';
  }
  select.addEventListener('change', controls);
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
      localStorage.setItem(PENDING_KEY, JSON.stringify({ runId, state, events }));
    } catch {
      message.textContent = 'Не закрывай игру до отправки: хранилище устройства недоступно.';
    }
  }
  async function sync() {
    if (!runId || syncing || disposed) return;
    const id = runId,
      target = state.ticks;
    syncing = true;
    controls();
    try {
      let accepted = await api.getDoodle(id);
      if (accepted.ruleset !== DOODLE_RULESET) throw new Error('Версия партии устарела');
      while (accepted.state.ticks < target && runId === id && !disposed) {
        const from = accepted.state.ticks,
          untilTick = Math.min(target, from + DOODLE_CHUNK);
        accepted = await api.submitDoodle({
          runId: id,
          revision: accepted.revision,
          untilTick,
          events: events.filter((e) => e.tick >= from && e.tick < untilTick),
        });
      }
      if (runId !== id || disposed) return;
      sendFailed = false;
      if (accepted.status === 'verified') {
        if (accepted.state.ticks !== state.ticks || accepted.state.score !== state.score)
          throw new Error('Сервер не подтвердил результат этой партии');
        pending = false;
        verified = true;
        runId = null;
        clearPending();
        message.textContent = `Результат проверен и записан: ${accepted.state.score}.`;
      }
    } catch (error) {
      if (!disposed && runId === id) {
        sendFailed = true;
        message.textContent = `${errorMessage(error)}. ${pending ? 'Партия сохранена для повторной отправки.' : 'Повторим отправку после игры.'}`;
      }
    } finally {
      syncing = false;
      if (!disposed) controls();
    }
    if (!disposed && pending && runId === id && state.ticks > target && !sendFailed) void sync();
  }
  async function begin() {
    if (disposed || starting || pending || syncing || (phase !== 'ready' && phase !== 'over'))
      return;
    starting = true;
    controls();
    try {
      const ranked = select.value === 'ranked';
      if (ranked && !canRank) throw new Error('Открой игру в Telegram для рейтинговой партии');
      const created = ranked ? await api.createDoodle(crypto.randomUUID()) : null;
      if (created && created.ruleset !== DOODLE_RULESET)
        throw new Error('Обнови игру для рейтинговой партии');
      await tilt.resume();
      if (disposed) return;
      runId = created?.id ?? null;
      state = created
        ? decodeAdventureState(created.state)
        : createAdventure(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
      events = [];
      verified = false;
      sendFailed = false;
      clearInput();
      tilt.calibrate();
      phase = 'playing';
      diedAt = 0;
      accumulator = 0;
      previous = performance.now();
      message.textContent = ranked
        ? 'Рейтинговая партия. Пауза или сворачивание переводят её в свободную игру.'
        : 'Джетпак поднимает вверх, пузырь защищает от одного столкновения. Касайся значков, чтобы подобрать усиление.';
      canvas.focus({ preventScroll: true });
      if (document.hidden || !document.hasFocus()) pause();
    } catch (error) {
      message.textContent = `${errorMessage(error)}. Повтори запуск или выбери свободную игру.`;
    } finally {
      starting = false;
      if (!disposed) controls();
    }
  }
  function pause() {
    if (phase !== 'playing') return;
    phase = 'paused';
    clearInput();
    tilt.suspend();
    const wasRanked = runId !== null;
    runId = null;
    events = [];
    message.textContent = wasRanked
      ? 'Пауза. Эта партия теперь свободная и не попадёт в рейтинг.'
      : 'Пауза. Нажми «Продолжить», когда будешь готов.';
    controls();
  }
  function resume() {
    if (phase !== 'paused' || disposed) return;
    phase = 'playing';
    void tilt.resume();
    clearInput();
    previous = performance.now();
    accumulator = 0;
    canvas.focus({ preventScroll: true });
    controls();
  }
  const abort = new AbortController();
  fire.addEventListener(
    'click',
    () => {
      if (phase === 'playing') {
        queuedShot = true;
        aim = 0;
      }
    },
    { signal: abort.signal },
  );
  for (const [node, fixed] of [
    [canvas, 0],
    [left, -1],
    [right, 1],
  ] as const) {
    const target: HTMLElement = node;
    const side = (event: PointerEvent): DoodleDirection =>
      fixed === 0
        ? event.clientX <
          canvas.getBoundingClientRect().left + canvas.getBoundingClientRect().width / 2
          ? -1
          : 1
        : fixed;
    target.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || phase !== 'playing') return;
        event.preventDefault();
        target.setPointerCapture(event.pointerId);
        if (node === canvas) {
          queuedShot = true;
          const box = canvas.getBoundingClientRect();
          const targetX = ((event.clientX - box.left) / box.width) * 360000;
          aim = Math.max(-1000, Math.min(1000, Math.trunc((targetX - state.x) / 120)));
          if (tilt.wanted) firing.add(event.pointerId);
        }
        if (fixed !== 0 || (event.pointerType === 'touch' && !tilt.wanted))
          movement.set(event.pointerId, side(event));
      },
      { signal: abort.signal },
    );
    target.addEventListener(
      'pointermove',
      (event) => {
        if (movement.has(event.pointerId)) movement.set(event.pointerId, side(event));
      },
      { signal: abort.signal },
    );
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      target.addEventListener(
        name,
        (event) => {
          movement.delete(event.pointerId);
          firing.delete(event.pointerId);
        },
        { signal: abort.signal },
      );
  }
  fire.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || phase !== 'playing') return;
      event.preventDefault();
      fire.setPointerCapture(event.pointerId);
      firing.add(event.pointerId);
      aim = 0;
      queuedShot = true;
    },
    { signal: abort.signal },
  );
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    fire.addEventListener(
      name,
      (event) => {
        firing.delete(event.pointerId);
      },
      { signal: abort.signal },
    );
  fire.addEventListener(
    'keydown',
    (event) => {
      if (event.code === 'Enter') {
        event.preventDefault();
        keys.add('Space');
        aim = 0;
      }
    },
    { signal: abort.signal },
  );
  fire.addEventListener(
    'keyup',
    (event) => {
      if (event.code === 'Enter') keys.delete('Space');
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.target instanceof Element && event.target.closest('select, input, a')) return;
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) {
        event.preventDefault();
        keys.add(event.code);
      } else if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) {
        if (
          event.target instanceof HTMLButtonElement &&
          event.target !== fire &&
          phase !== 'playing'
        )
          return;
        event.preventDefault();
        if (phase === 'playing') {
          keys.add(event.code);
          aim = 0;
        } else if (!event.repeat) {
          if (phase === 'paused') resume();
          else void begin();
        }
      } else if (event.code === 'Enter' && event.target === canvas && !event.repeat) {
        event.preventDefault();
        if (phase === 'paused') resume();
        else void begin();
      } else if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
        event.preventDefault();
        if (phase === 'paused') resume();
        else pause();
      }
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      keys.delete(event.code);
    },
    { signal: abort.signal },
  );
  window.addEventListener('blur', pause, { signal: abort.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: abort.signal },
  );
  function animate(now: number) {
    if (disposed) return;
    const elapsed = now - previous;
    previous = now;
    if (phase === 'playing' && elapsed > 1000) pause();
    if (phase === 'playing') {
      accumulator += Math.min(elapsed, 250);
      while (accumulator >= 1000 / DOODLE_HZ && phase === 'playing') {
        const shooting =
          queuedShot ||
          firing.size > 0 ||
          keys.has('Space') ||
          keys.has('ArrowUp') ||
          keys.has('KeyW');
        const input = { direction: direction(), shooting, aim };
        if (
          runId &&
          (input.direction !== state.direction || shooting !== state.shooting || aim !== state.aim)
        )
          events.push({ tick: state.ticks, ...input });
        stepAdventure(state, input);
        queuedShot = false;
        accumulator -= 1000 / DOODLE_HZ;
        if (state.status === 'over') {
          phase = 'over';
          diedAt = now;
          clearInput();
          tilt.suspend();
          best = Math.max(best, state.score);
          try {
            localStorage.setItem(BEST_KEY, String(best));
          } catch {
            /* Local only. */
          }
          message.textContent = `Высота: ${state.score}. Монстров сбито: ${state.kills}. Ещё попытку?`;
          if (runId) {
            persist();
            void sync();
          }
          controls();
        } else if (runId && state.ticks % 300 === 0 && !sendFailed) void sync();
      }
    }
    root.dataset.power = state.power;
    root.dataset.bullets = String(state.bullets.length);
    root.dataset.lastShot = String(state.lastShot);
    root.dataset.kills = String(state.kills);
    draw(state, phase, now, best, diedAt ? now - diedAt : 0, runId !== null, verified);
    frame = requestAnimationFrame(animate);
  }
  try {
    best = integer(Number(localStorage.getItem(BEST_KEY) ?? 0), 0, 1000000);
    localStorage.removeItem('arcade:doodle:pending:v1');
  } catch {
    /* Best effort. */
  }
  try {
    const saved = localStorage.getItem(PENDING_KEY);
    if (saved && canRank) {
      const data = object(JSON.parse(saved));
      const final = decodeAdventureState(data.state);
      if (
        final.status !== 'over' ||
        !Array.isArray(data.events) ||
        data.events.length > DOODLE_MAX_TICKS
      )
        throw new Error('Invalid saved game');
      events = data.events.map((e) => decodeAdventureEvent(e, final.ticks));
      for (let i = 1; i < events.length; i++)
        if ((events[i]?.tick ?? 0) <= (events[i - 1]?.tick ?? 0))
          throw new Error('Invalid saved controls');
      state = final;
      runId = text(data.runId, 1, 100);
      pending = true;
      phase = 'over';
      diedAt = performance.now() - 1000;
      best = Math.max(best, state.score);
      void sync();
    }
  } catch {
    clearPending();
    runId = null;
    pending = false;
  }
  const retryTimer = window.setInterval(() => {
    if (pending) void sync();
  }, 30000);
  controls();
  frame = requestAnimationFrame(animate);
  return {
    pause,
    resume,
    dispose() {
      disposed = true;
      abort.abort();
      tilt.dispose();
      clearInput();
      cancelAnimationFrame(frame);
      clearInterval(retryTimer);
      root.remove();
    },
  };
}
