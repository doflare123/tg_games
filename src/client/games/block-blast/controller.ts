import {
  BLOCK_MAX_CHUNK,
  BLOCK_SHAPES,
  type BlockMove,
  blockPlacements,
  canPlaceBlock,
  createBlockBlast,
  moveBlockBlast,
  placeBlock,
} from '../../../games/block-blast/engine.ts';
import {
  type BlockRun,
  decodeBlockMove,
  decodeBlockRun,
  decodeBlockState,
} from '../../../shared/block-blast.ts';
import { object, text } from '../../../shared/errors.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import './game.css';

const SAVE_KEY = 'arcade:block-blast:v1';
let saveOwner: symbol | undefined;
export function mountBlockBlast(host: GameHost): GameAdapter {
  const owner = Symbol('Block Blast');
  saveOwner = owner;
  let state = createBlockBlast(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
  let run: BlockRun | null = null;
  let pending: BlockMove[] = [];
  let requestId: string | null = null;
  let finished = false;
  let busy = false;
  let failed = false;
  let paused = false;
  let disposed = false;
  let storageFailed = false;
  let selected = 0;
  let focusCell = 0;
  let pollUntil = 0;
  let drag: { id: number; startX: number; startY: number; moved: boolean; touch: boolean } | null =
    null;
  let preview: { x: number; y: number } | null = null;
  const panel = element('section', 'block-blast');
  const toolbar = element('div', 'blast-toolbar');
  const ranked = button(
    'Рейтинговая партия',
    () => {
      void start(true);
    },
    'button primary',
  );
  const free = button(
    'Свободная партия',
    () => {
      if (busy) return;
      if (run || requestId) {
        run = null;
        requestId = null;
        pending = [];
        failed = false;
        finished = state.status === 'over';
        status.textContent = 'Свободная партия. Текущий счёт не попадёт в рейтинг.';
        save();
        render();
      } else void start(false);
    },
    'button secondary',
  );
  toolbar.append(ranked, free);
  const mode = element('p', 'blast-mode');
  const stats = element('div', 'blast-stats');
  const score = element('strong');
  const detail = element('span');
  stats.append(score, detail);
  const board = element('div', 'blast-board');
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'Поле Block Blast 8 на 8');
  const cells = Array.from({ length: 64 }, (_, i) => {
    const cell = button('', () => play(i % 8, Math.floor(i / 8)), 'blast-cell');
    cell.tabIndex = i === 0 ? 0 : -1;
    board.append(cell);
    return cell;
  });
  const tray = element('div', 'blast-tray');
  const ghost = element('div', 'blast-mini blast-drag-ghost');
  ghost.hidden = true;
  ghost.setAttribute('aria-hidden', 'true');
  panel.append(ghost);
  tray.setAttribute('role', 'group');
  tray.setAttribute('aria-label', 'Три фигуры. Выбери фигуру, затем место на поле');
  const pieces = Array.from({ length: 3 }, (_, slot) => {
    const piece = button(
      '',
      () => {
        if (locked() || state.tray[slot] === null) return;
        selected = slot;
        preview = null;
        render();
      },
      'blast-piece',
    );
    piece.addEventListener('pointerdown', (event) => {
      if (locked() || !event.isPrimary || event.button !== 0 || state.tray[slot] === null) return;
      selected = slot;
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        touch: event.pointerType === 'touch',
      };
      piece.setPointerCapture(event.pointerId);
      render();
    });
    tray.append(piece);
    return piece;
  });
  const status = element('p', 'blast-status');
  status.setAttribute('role', 'status');
  const actions = element('div', 'blast-toolbar');
  const finish = button(
    'Завершить и записать очки',
    () => {
      if (locked()) return;
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
  actions.append(finish, retry);
  const storageNote = element('p', 'control-hint');
  panel.append(
    toolbar,
    mode,
    stats,
    board,
    tray,
    status,
    actions,
    element(
      'p',
      'control-hint',
      'Перетащи фигуру на поле или выбери её и нажми на клетку её верхнего левого угла. Клавиши 1–3 выбирают фигуру; стрелки и Enter — место. Вращения нет.',
    ),
    element(
      'p',
      'control-hint',
      'Каждая новая тройка имеет решение для всех трёх фигур, иногда через очистку линий. Порядок и место важны: ошибочным ходом можно перекрыть решение.',
    ),
    element(
      'p',
      'control-hint',
      '+1 за каждый блок. Линии за один ход: +10 × число линий². Пустое поле: ещё +100. Рейтинг — лучший счёт одной партии. Рейтинговая партия действует 24 часа.',
    ),
    storageNote,
  );
  host.container.replaceChildren(panel);
  function locked(): boolean {
    return (
      disposed ||
      busy ||
      failed ||
      paused ||
      finished ||
      requestId !== null ||
      state.status === 'over'
    );
  }
  function save(): void {
    if (saveOwner !== owner) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state, run, pending, requestId, finished }));
    } catch {
      storageFailed = true;
    }
  }
  function render(): void {
    if (disposed) return;
    score.textContent = `${state.score.toLocaleString('ru-RU')} очков`;
    detail.textContent = `${state.lines} линий · ${state.clears} чистых полей`;
    mode.textContent =
      run?.status === 'verified'
        ? '● РЕЗУЛЬТАТ ЗАПИСАН'
        : run || requestId
          ? '● РЕЙТИНГОВАЯ ПАРТИЯ'
          : '○ СВОБОДНАЯ ПАРТИЯ';
    const piece = state.tray[selected];
    const shape = piece === null || piece === undefined ? undefined : BLOCK_SHAPES[piece];
    const valid =
      preview &&
      piece !== null &&
      piece !== undefined &&
      canPlaceBlock(state.board, piece, preview.x, preview.y);
    const highlighted = new Set(
      shape && preview
        ? shape.cells.map((cell) => {
            const x = cell.x + (preview?.x ?? 0);
            const y = cell.y + (preview?.y ?? 0);
            return x >= 0 && x < 8 && y >= 0 && y < 8 ? y * 8 + x : -1;
          })
        : [],
    );
    const cleared =
      valid && preview && piece !== null && piece !== undefined
        ? (placeBlock([...state.board], piece, preview.x, preview.y)?.cells ?? [])
        : [];
    cells.forEach((cell, i) => {
      cell.dataset.color = String(state.board[i] ?? 0);
      cell.classList.toggle('blast-preview', highlighted.has(i));
      cell.classList.toggle('blast-invalid', highlighted.has(i) && !valid);
      cell.classList.toggle('blast-clear-preview', cleared.includes(i));
      cell.disabled = locked();
      cell.setAttribute(
        'aria-label',
        `Строка ${Math.floor(i / 8) + 1}, столбец ${(i % 8) + 1}${state.board[i] ? ', занято' : ', свободно'}`,
      );
    });
    pieces.forEach((control, slot) => {
      const id = state.tray[slot];
      const s = id === null || id === undefined ? undefined : BLOCK_SHAPES[id];
      control.disabled = locked() || !s;
      control.classList.toggle('selected', slot === selected && !!s);
      control.classList.toggle(
        'unavailable',
        !!s && id !== null && id !== undefined && !blockPlacements(state.board, id).length,
      );
      control.setAttribute('aria-pressed', String(slot === selected && !!s));
      control.setAttribute(
        'aria-label',
        s
          ? `Фигура ${slot + 1}, ${s.cells.length} блоков, ${s.width} на ${s.height}`
          : `Фигура ${slot + 1} поставлена`,
      );
      const mini = element('span', 'blast-mini');
      mini.style.gridTemplateColumns = `repeat(${s?.width ?? 1}, 1fr)`;
      mini.style.gridTemplateRows = `repeat(${s?.height ?? 1}, 1fr)`;
      mini.style.width = `${(s?.width ?? 1) * 15}px`;
      mini.style.height = `${(s?.height ?? 1) * 15}px`;
      if (s)
        for (const cell of s.cells) {
          const block = element('i');
          block.dataset.color = String(((id ?? 0) % 6) + 1);
          block.style.gridColumn = String(cell.x + 1);
          block.style.gridRow = String(cell.y + 1);
          mini.append(block);
        }
      control.replaceChildren(
        mini,
        element('span', 'blast-slot-label', s ? String(slot + 1).padStart(2, '0') : '✓'),
      );
    });
    ranked.disabled =
      !hasApi ||
      busy ||
      failed ||
      requestId !== null ||
      (run !== null && run.status !== 'verified');
    free.disabled = busy;
    free.textContent = run || requestId ? 'Продолжить свободно' : 'Новая свободная партия';
    finish.hidden = !run || run.status === 'verified';
    finish.disabled = locked();
    retry.hidden = !failed;
    retry.disabled = busy;
    storageNote.textContent = storageFailed
      ? 'Не удалось сохранить на устройстве. Оставь страницу открытой до отправки результата.'
      : 'Партия сохраняется на устройстве. Вернись в Block Blast, чтобы продолжить.';
  }
  async function start(isRanked: boolean): Promise<void> {
    if (busy || failed || requestId || (run && run.status !== 'verified')) return;
    pending = [];
    finished = false;
    run = null;
    selected = 0;
    preview = null;
    if (isRanked) {
      requestId = crypto.randomUUID();
      save();
      await recover();
    } else {
      state = createBlockBlast(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
      status.textContent = 'Расставь все три фигуры — появится новая тройка.';
      save();
      render();
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
      const created = await api.createBlock(requestId);
      run = created;
      state = decodeBlockState(created.state);
      requestId = null;
      failed = false;
      finished = created.status === 'verified';
      save();
      status.textContent = 'Планируй сразу три фигуры. У этой тройки есть решение.';
    } catch (error) {
      failed = true;
      status.textContent = errorMessage(error);
    } finally {
      busy = false;
      render();
    }
  }
  async function sync(): Promise<void> {
    if (!run || busy || disposed || run.status === 'verified' || (!pending.length && !finished))
      return;
    busy = true;
    render();
    try {
      const updated = await api.submitBlock({
        runId: run.id,
        revision: run.revision,
        moves: [...pending],
        finish: finished,
      });
      run = updated;
      state = decodeBlockState(updated.state);
      pending = [];
      finished = updated.status === 'verified';
      failed = false;
      save();
      if (finished) {
        pollUntil = Date.now() + 15 * 60000;
        status.textContent = `Записано: ${state.score.toLocaleString('ru-RU')} очков. Смотри «Рекорды → Block Blast».`;
      }
    } catch (error) {
      failed = true;
      status.textContent = `${errorMessage(error)} Ходы сохранены. Повтори отправку.`;
    } finally {
      busy = false;
      render();
    }
  }
  function play(x: number, y: number): void {
    if (locked()) return;
    const move = { slot: selected, x, y };
    const previousScore = state.score;
    const previousLines = state.lines;
    const previousClears = state.clears;
    if (!moveBlockBlast(state, move)) {
      status.textContent = 'Фигура здесь не помещается. Попробуй другое место или порядок.';
      return;
    }
    if (run) pending.push(move);
    selected = state.tray.findIndex((id) => id !== null);
    preview = null;
    finished = state.status === 'over';
    status.textContent = finished
      ? 'Ходов больше нет. Партия завершена.'
      : state.clears > previousClears
        ? `Чистое поле! +${state.score - previousScore}`
        : state.lines > previousLines
          ? `${state.lines - previousLines} линий! +${state.score - previousScore}`
          : `+${state.score - previousScore}`;
    board.classList.toggle('blast-celebrate', state.lines > previousLines);
    save();
    render();
    if (run && (pending.length >= BLOCK_MAX_CHUNK || finished)) void sync();
  }
  function pointermove(event: PointerEvent): void {
    if (drag?.id !== event.pointerId || locked()) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6 && !drag.moved)
      return;
    drag.moved = true;
    const rect = board.getBoundingClientRect();
    const unit = (rect.width - 16) / 8;
    const id = state.tray[selected];
    const shape = id === null || id === undefined ? undefined : BLOCK_SHAPES[id];
    if (!shape) return;
    ghost.hidden = false;
    ghost.style.width = `${shape.width * unit}px`;
    ghost.style.height = `${shape.height * unit}px`;
    ghost.style.gridTemplateColumns = `repeat(${shape.width}, 1fr)`;
    ghost.style.gridTemplateRows = `repeat(${shape.height}, 1fr)`;
    ghost.style.left = `${event.clientX - (shape.width * unit) / 2}px`;
    ghost.style.top = `${event.clientY - (drag.touch ? shape.height + 0.7 : shape.height / 2) * unit}px`;
    ghost.replaceChildren(
      ...shape.cells.map((cell) => {
        const block = element('i');
        block.dataset.color = String(((id ?? 0) % 6) + 1);
        block.style.gridColumn = String(cell.x + 1);
        block.style.gridRow = String(cell.y + 1);
        return block;
      }),
    );
    preview = {
      x: Math.round((event.clientX - rect.left - 8) / unit - shape.width / 2),
      y: Math.round(
        (event.clientY - rect.top - 8) / unit -
          (drag.touch ? shape.height + 0.7 : shape.height / 2),
      ),
    };
    render();
  }
  function pointerup(event: PointerEvent): void {
    if (drag?.id !== event.pointerId) return;
    const target = preview;
    const moved = drag.moved;
    drag = null;
    preview = null;
    ghost.hidden = true;
    if (moved && target) play(target.x, target.y);
    render();
  }
  function pointercancel(): void {
    drag = null;
    preview = null;
    ghost.hidden = true;
    render();
  }
  function keydown(event: KeyboardEvent): void {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if (/^[123]$/.test(event.key) && !locked()) {
      selected = Number(event.key) - 1;
      preview = null;
      render();
    }
    if (!cells.includes(document.activeElement as HTMLButtonElement)) return;
    focusCell = cells.indexOf(document.activeElement as HTMLButtonElement);
    const delta: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -8,
      ArrowDown: 8,
    };
    const d = delta[event.key];
    if (d !== undefined) {
      event.preventDefault();
      cells[focusCell]?.setAttribute('tabindex', '-1');
      focusCell = (focusCell + d + 64) % 64;
      cells[focusCell]?.setAttribute('tabindex', '0');
      cells[focusCell]?.focus();
    }
  }
  function visibility(): void {
    if (document.hidden) {
      save();
      if (run && pending.length && !failed) void sync();
    }
  }
  window.addEventListener('pointermove', pointermove);
  window.addEventListener('pointerup', pointerup);
  window.addEventListener('pointercancel', pointercancel);
  panel.addEventListener('keydown', keydown);
  document.addEventListener('visibilitychange', visibility);
  let restored = false;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const saved = object(JSON.parse(raw));
      run = saved.run === null ? null : decodeBlockRun(saved.run);
      if (
        !Array.isArray(saved.pending) ||
        saved.pending.length > BLOCK_MAX_CHUNK ||
        typeof saved.finished !== 'boolean'
      )
        throw new Error('Некорректное сохранение');
      pending = saved.pending.map(decodeBlockMove);
      finished = saved.finished;
      requestId = saved.requestId === null ? null : text(saved.requestId, 16, 64);
      state = run ? decodeBlockState(run.state) : decodeBlockState(saved.state);
      if (run)
        for (const move of pending)
          if (!moveBlockBlast(state, move)) throw new Error('Некорректные ходы');
      restored = true;
      selected = Math.max(
        0,
        state.tray.findIndex((id) => id !== null),
      );
      if (requestId) void recover();
      else if (run && (pending.length || (finished && run.status !== 'verified'))) void sync();
      else if (run?.status === 'verified') pollUntil = Date.now() + 15 * 60000;
    }
  } catch {
    run = null;
    pending = [];
    requestId = null;
    finished = false;
    state = createBlockBlast(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
    status.textContent = 'Сохранение повреждено. Начни новую партию.';
    restored = true;
  }
  render();
  if (!restored) {
    if (hasApi) void start(true);
    else {
      save();
      render();
    }
  }
  const deliveryTimer = window.setInterval(() => {
    if (!disposed && !busy && run?.status === 'verified' && Date.now() < pollUntil)
      void api.getBlock(run.id).catch(() => {});
  }, 30000);
  return {
    pause() {
      paused = true;
      pointercancel();
    },
    resume() {
      paused = false;
      render();
    },
    dispose() {
      save();
      disposed = true;
      clearInterval(deliveryTimer);
      window.removeEventListener('pointermove', pointermove);
      window.removeEventListener('pointerup', pointerup);
      window.removeEventListener('pointercancel', pointercancel);
      document.removeEventListener('visibilitychange', visibility);
      panel.remove();
    },
  };
}
