import {
  create2048,
  DIRECTIONS,
  type Direction,
  MAX_2048_CHUNK,
  minimum2048Tile,
  move2048,
  RULESETS_2048,
  type Ruleset2048,
} from '../../../games/2048/engine.ts';
import { decodeRun2048, decodeState2048, type Run2048 } from '../../../shared/2048.ts';
import { object, oneOf, text } from '../../../shared/errors.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import { type Move2048Visual, Renderer2048 } from './renderer.ts';
import './game.css';

const SAVE_KEY = 'arcade:2048:v1';
let saveOwner: symbol | undefined;
export function mount2048(host: GameHost): GameAdapter {
  const owner = Symbol('2048 mount');
  saveOwner = owner;
  let state = create2048(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
  let run: Run2048 | null = null;
  let pending: Direction[] = [];
  let requestId: string | null = null;
  let finished = false;
  let busy = false;
  let failed = false;
  let disposed = false;
  let paused = false;
  let storageFailed = false;
  let touch: { id: number; x: number; y: number } | null = null;
  let pollUntil = Date.now() + 15 * 60000;
  const panel = element('section', 'puzzle2048');
  const toolbar = element('div', 'puzzle-toolbar');
  const ranked = button(
    'Рейтинговая партия',
    () => {
      void start(true);
    },
    'button primary',
  );
  ranked.disabled = !hasApi;
  const free = button(
    'Свободная партия',
    () => {
      void start(false);
    },
    'button secondary',
  );
  toolbar.append(ranked, free);
  const mode = element('p', 'puzzle-mode');
  const stats = element('div', 'puzzle-stats');
  const score = element('strong');
  const tile = element('span');
  stats.append(score, tile);
  const board = element('div', 'puzzle-grid');
  board.tabIndex = 0;
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'Поле 2048. Управление стрелками или WASD');
  const renderer = new Renderer2048(board);
  const status = element('p', 'puzzle-status');
  status.setAttribute('role', 'status');
  const actions = element('div', 'puzzle-toolbar');
  const finish = button(
    'Завершить и записать очки',
    () => {
      finished = true;
      save();
      void sync();
    },
    'button primary',
  );
  const retry = button(
    'Повторить отправку',
    () => {
      void recover();
    },
    'button secondary',
  );
  const leaveRanked = button(
    'Продолжить свободно',
    () => {
      if (busy) return;
      run = null;
      requestId = null;
      pending = [];
      failed = false;
      finished = state.status === 'over';
      status.textContent = 'Теперь это свободная партия. Текущий счёт не попадёт в рейтинг.';
      save();
      render();
    },
    'button secondary',
  );
  actions.append(finish, retry, leaveRanked);
  const pad = element('div', 'direction-pad');
  const moveButtons = DIRECTIONS.map((direction) => {
    const control = button(
      { left: '←', right: '→', up: '↑', down: '↓' }[direction],
      () => play(direction),
      `button secondary direction-${direction}`,
    );
    control.setAttribute(
      'aria-label',
      `Сдвинуть ${{ left: 'влево', right: 'вправо', up: 'вверх', down: 'вниз' }[direction]}`,
    );
    pad.append(control);
    return control;
  });
  const storageNote = element('p', 'control-hint');
  const ruleHint = element('p', 'control-hint');
  panel.append(
    toolbar,
    mode,
    stats,
    board,
    status,
    actions,
    pad,
    element(
      'p',
      'control-hint',
      'Стрелки / WASD или свайпы. Одинаковые плитки сливаются: 2 + 2 = 4 и +4 очка. После 2048 можно продолжать. Рейтинг — лучший счёт, очки партий не суммируются. Можно завершить партию и записать текущий счёт.',
    ),
    ruleHint,
    storageNote,
  );
  host.container.replaceChildren(panel);

  function save(): void {
    // A response from a closed screen must not overwrite a newer screen's moves.
    if (saveOwner !== owner) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state, run, pending, requestId, finished }));
    } catch {
      storageFailed = true;
    }
  }
  function render(move?: Move2048Visual): void {
    if (disposed) return;
    renderer.render(state.board, move);
    mode.textContent =
      run || requestId
        ? run?.status === 'verified'
          ? '● РЕЗУЛЬТАТ ЗАПИСАН'
          : '● РЕЙТИНГОВАЯ ПАРТИЯ'
        : '○ СВОБОДНАЯ ПАРТИЯ';
    score.textContent = `${state.score.toLocaleString('ru-RU')} очков`;
    tile.textContent = `Плитка ${Math.max(...state.board)} · ходов ${state.moves} · новые ${minimum2048Tile(state)}/${minimum2048Tile(state) * 2}`;
    const locked =
      busy || failed || finished || paused || state.status === 'over' || requestId !== null;
    for (const control of moveButtons) control.disabled = locked;
    finish.hidden = !run || run.status === 'verified';
    finish.disabled = locked;
    retry.hidden = !failed;
    retry.disabled = busy;
    leaveRanked.hidden = !requestId && (!run || run.status === 'verified');
    leaveRanked.disabled = busy;
    const unsettled = failed || requestId !== null || (run !== null && run.status !== 'verified');
    ranked.disabled = !hasApi || busy || unsettled;
    free.disabled = busy || unsettled;
    board.setAttribute('aria-disabled', String(locked));
    ruleHint.textContent =
      state.version === 1
        ? 'Классическая партия: новые плитки 2/4. Её рекорд сохранится в «Классика · старые рекорды». Новая партия начнётся с ростом плиток.'
        : `Без лимита ходов. После 8192 новые плитки — 4/8, после 16384 — 8/16. ${hasApi ? 'Рейтинговая партия действует 24 часа. Свободные партии не входят в рейтинг.' : 'Рейтинг доступен внутри Telegram.'}`;
    storageNote.textContent = storageFailed
      ? 'Не удалось сохранить на устройстве. Не закрывай страницу до отправки результата.'
      : 'Партия сохраняется на этом устройстве. Вернись в 2048, чтобы продолжить.';
  }
  async function start(isRanked: boolean): Promise<void> {
    if (busy || failed || (run !== null && run.status !== 'verified') || requestId) return;
    pending = [];
    finished = false;
    run = null;
    status.textContent = '';
    if (isRanked) {
      requestId = crypto.randomUUID();
      save();
      await recover();
    } else {
      state = create2048(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
      save();
      render();
      board.focus({ preventScroll: true });
    }
  }
  async function recover(): Promise<void> {
    if (busy || disposed) return;
    if (!requestId) {
      await sync();
      return;
    }
    busy = true;
    render();
    try {
      const created = await api.create2048(requestId);
      run = created;
      state = decodeState2048(created.state);
      requestId = null;
      failed = false;
      save();
      status.textContent = 'Соединяй плитки и набирай очки.';
    } catch (error) {
      failed = true;
      status.textContent = errorMessage(error);
    } finally {
      busy = false;
      render();
    }
  }
  async function sync(): Promise<void> {
    if (!run || busy || disposed) return;
    if (!pending.length && !finished) return;
    busy = true;
    status.textContent = 'Сохраняем партию…';
    render();
    try {
      const updated = await api.submit2048({
        runId: run.id,
        revision: run.revision,
        moves: [...pending],
        finish: finished,
      });
      run = updated;
      state = decodeState2048(updated.state);
      pending = [];
      finished = updated.status === 'verified';
      if (finished) pollUntil = Date.now() + 15 * 60000;
      failed = false;
      save();
      status.textContent = finished
        ? `Записано: ${state.score.toLocaleString('ru-RU')} очков. Смотри «Рекорды → 2048».`
        : 'Партия сохранена. Продолжай!';
    } catch (error) {
      failed = true;
      status.textContent = `${errorMessage(error)} Запись ходов сохранена, повтори отправку.`;
    } finally {
      busy = false;
      render();
    }
  }
  function play(direction: Direction): void {
    if (disposed || busy || paused || failed || finished || requestId) return;
    const before = [...state.board];
    if (!move2048(state, direction)) return;
    if (run) pending.push(direction);
    if (state.status === 'over') finished = true;
    save();
    status.textContent =
      state.status === 'over'
        ? 'Ходов больше нет. Партия завершена.'
        : Math.max(...state.board) >= 2048
          ? '2048 собрана! Продолжай увеличивать счёт.'
          : '';
    render({ before, direction });
    if (run && (pending.length >= MAX_2048_CHUNK || finished)) void sync();
  }
  function keydown(event: KeyboardEvent): void {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    const keys: Readonly<Record<string, Direction>> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      KeyA: 'left',
      KeyD: 'right',
      KeyW: 'up',
      KeyS: 'down',
    };
    const direction = keys[event.code];
    if (direction) {
      event.preventDefault();
      if (!event.repeat) play(direction);
    }
  }
  board.addEventListener('pointerdown', (event) => {
    if (touch || !event.isPrimary || event.button !== 0) return;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    board.setPointerCapture(event.pointerId);
  });
  board.addEventListener('pointerup', (event) => {
    if (touch?.id !== event.pointerId) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24)
      play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });
  board.addEventListener('pointercancel', () => {
    touch = null;
  });
  window.addEventListener('keydown', keydown);
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const snapshot = object(JSON.parse(raw));
      run = snapshot.run === null ? null : decodeRun2048(snapshot.run);
      if (run && !RULESETS_2048.includes(run.ruleset as Ruleset2048))
        throw new Error('Сохранение использует старую версию правил');
      if (
        !Array.isArray(snapshot.pending) ||
        snapshot.pending.length > MAX_2048_CHUNK ||
        typeof snapshot.finished !== 'boolean'
      )
        throw new Error('Повреждена запись ходов');
      pending = snapshot.pending.map((value) => oneOf(value, DIRECTIONS));
      requestId = snapshot.requestId === null ? null : text(snapshot.requestId, 16, 64);
      finished = snapshot.finished;
      state = run ? decodeState2048(run.state) : decodeState2048(snapshot.state);
      if (run)
        for (const direction of pending)
          if (!move2048(state, direction)) throw new Error('Повреждена запись ходов');
      if (requestId) void recover();
      else if (run && (pending.length || (finished && run.status !== 'verified'))) void sync();
    }
  } catch {
    run = null;
    pending = [];
    requestId = null;
    finished = false;
    state = create2048(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
    status.textContent = 'Не удалось восстановить сохранение. Начата свободная партия.';
  }
  render();
  // Keep delivery retries moving while the completed game's screen is open.
  const deliveryTimer = window.setInterval(() => {
    if (!disposed && !busy && run?.status === 'verified' && Date.now() < pollUntil)
      void api.get2048(run.id).catch(() => {});
  }, 30000);
  return {
    pause() {
      renderer.finish();
      paused = true;
      render();
    },
    resume() {
      paused = false;
      render();
    },
    dispose() {
      renderer.dispose();
      clearInterval(deliveryTimer);
      save();
      disposed = true;
      window.removeEventListener('keydown', keydown);
      panel.remove();
    },
  };
}
