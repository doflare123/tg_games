import {
  actMines,
  createMines,
  LEVELS,
  MINE_LIMIT_MS,
  type MineAction,
  type MineBoard,
  type MineSize,
  type MineState,
  mineBoard,
  SIZES,
} from '../../../games/minesweeper/engine.ts';
import type { MineResultInput } from '../../../shared/minesweeper.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage, formatMineTime } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import { mountMineInput } from './input.ts';
import { MineTimer } from './timer.ts';
import './minesweeper.css';

export function mountMinesweeper(host: GameHost, initialSize: MineSize = '9x9'): GameAdapter {
  const shell = element('section', 'minesweeper');
  const controls = element('div', 'mine-controls');
  const sizeSelect = element('select', 'select');
  sizeSelect.setAttribute('aria-label', 'Уровень сапёра');
  for (const size of SIZES) {
    const option = element('option', '', `${LEVELS[size].title} · ${LEVELS[size].mines} мин`);
    option.value = size;
    sizeSelect.append(option);
  }
  sizeSelect.value = initialSize;
  const rankedButton = button('Рейтинговая игра', () => reset(true), 'button primary');
  rankedButton.disabled = !hasApi;
  const practiceButton = button('Свободная игра', () => reset(false), 'button secondary');
  const restart = button('Новая партия', () => reset(ranked), 'button secondary');
  controls.append(sizeSelect, rankedButton, practiceButton, restart);
  const hud = element('div', 'mine-hud');
  const remaining = element('strong');
  const timer = element('time', 'mine-timer', '00:00.00');
  timer.setAttribute('aria-label', 'Время партии');
  hud.append(remaining, timer);
  const scroll = element('div', 'mine-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'Поле сапёра, большие поля можно прокручивать');
  const grid = element('div', 'mine-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Клетки сапёра');
  scroll.append(grid);
  const status = element('p', 'mine-status');
  status.setAttribute('role', 'status');
  const retry = button(
    'Повторить сохранение',
    () => {
      void send();
    },
    'button secondary',
  );
  retry.hidden = true;
  const rules = element(
    'p',
    'control-hint',
    'Открой все клетки без мин — и победа. Отмечать оставшиеся мины не обязательно. Первый ход и соседние клетки безопасны. Компьютер: ЛКМ — открыть, ПКМ или F — поставить/убрать флаг. Телефон: тап — открыть, удержание 0,5 с — поставить/убрать флаг. Нажатие на число открывает соседей, если вокруг достаточно флагов. Большие поля можно прокручивать.',
  );
  const rankingNote = element(
    'p',
    'control-hint',
    'Для каждого размера — отдельный рейтинг времени. В зачёт идут только победы. В рейтинговой игре нет ручной паузы. Лимит партии — 60 минут.',
  );
  shell.append(controls, hud, scroll, status, retry, rules, rankingNote);
  host.container.replaceChildren(shell);
  let size: MineSize = '9x9';
  let ranked = hasApi;
  let board: MineBoard;
  let local: MineState | null = null;
  let pending: MineResultInput | null = null;
  let saving = false;
  let saveMessage = '';
  let disposed = false;
  let epoch = 0;
  let requestId = '';
  let firstCell: number | null = null;
  const clock = new MineTimer();
  let cells: HTMLButtonElement[] = [];
  const input = mountMineInput(grid, {
    enabled: () => !disposed && board.status === 'playing',
    action: (cell, action) => {
      void play(cell, action);
    },
  });

  function elapsed(): number {
    return clock.elapsedMs();
  }
  function reset(nextRanked: boolean): void {
    input.reset();
    epoch++;
    ranked = nextRanked;
    size = SIZES.find((s) => s === sizeSelect.value) ?? '9x9';
    const { width, height } = LEVELS[size];
    local = null;
    pending = null;
    saving = false;
    saveMessage = '';
    firstCell = null;
    clock.reset();
    requestId = crypto.randomUUID();
    board = { size, status: 'playing', cells: Array<number>(width * height).fill(-2) };
    grid.style.gridTemplateColumns = `repeat(${width}, var(--mine-cell))`;
    grid.replaceChildren();
    cells = board.cells.map((_, cell) => {
      const node = element('button', 'mine-cell');
      node.type = 'button';
      node.dataset.cell = String(cell);
      node.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          void play(cell, 'flag');
        }
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -width, ArrowDown: width }[
          event.key
        ];
        if (offset !== undefined) {
          event.preventDefault();
          cells[cell + offset]?.focus();
        }
      });
      grid.append(node);
      return node;
    });
    rankedButton.setAttribute('aria-pressed', String(ranked));
    practiceButton.setAttribute('aria-pressed', String(!ranked));
    status.textContent = `${ranked ? 'Рейтинговая' : 'Свободная'} партия. Открой первую клетку.${!hasApi ? ' Рейтинг доступен внутри Telegram.' : ''}`;
    scroll.scrollTo(0, 0);
    render();
  }
  function render(): void {
    const { width, mines } = LEVELS[size];
    remaining.textContent = `⚑ ${mines - board.cells.filter((c) => c === -3).length}`;
    timer.textContent = formatMineTime(elapsed());
    cells.forEach((node, i) => {
      const value = board.cells[i] ?? -2;
      const disabled = board.status !== 'playing';
      if (node.dataset.value === String(value) && node.disabled === disabled) return;
      node.textContent = value === -3 ? '⚑' : value === -1 ? '✹' : value > 0 ? String(value) : '';
      node.className = `mine-cell ${value >= 0 ? 'revealed' : ''} ${value === -1 ? 'mine-hit' : ''}`;
      node.dataset.value = String(value);
      node.disabled = disabled;
      const description =
        value === -3
          ? 'флаг'
          : value === -2
            ? 'закрыто'
            : value === -1
              ? 'мина'
              : value === 0
                ? 'пусто'
                : `${value} мин рядом`;
      node.setAttribute(
        'aria-label',
        `Строка ${Math.floor(i / width) + 1}, столбец ${(i % width) + 1}: ${description}`,
      );
    });
    retry.hidden = saving || pending === null;
    if (board.status !== 'playing') {
      status.textContent =
        board.status === 'won'
          ? `Победа! ${formatMineTime(elapsed())}. ${ranked ? saveMessage : 'Свободная игра — без записи в рейтинг.'}`
          : 'Мина! Партия завершена. Попробуй ещё раз.';
    }
  }
  async function send(): Promise<void> {
    if (!pending || saving || disposed) return;
    const current = epoch;
    const result = pending;
    saving = true;
    saveMessage = 'Сохраняем результат…';
    render();
    try {
      await api.submitMine(result);
      if (disposed || current !== epoch) return;
      pending = null;
      saveMessage = 'Результат сохранён в рейтинг этого уровня.';
    } catch (error) {
      if (disposed || current !== epoch) return;
      saveMessage = `${errorMessage(error)} Повтори сохранение результата.`;
    } finally {
      if (!disposed && current === epoch) {
        saving = false;
        render();
      }
    }
  }
  function play(cell: number, action: MineAction): void {
    if (disposed || board.status !== 'playing') return;
    const actionAt = performance.now();
    const value = board.cells[cell] ?? -2;
    if (action === 'reveal' && value === -3) return;
    if (action === 'flag' && value >= 0) return;
    if (action === 'reveal' && value >= 0) action = 'chord';
    if (firstCell === null) {
      if (action === 'flag') {
        board.cells[cell] = value === -3 ? -2 : -3;
        render();
        return;
      }
      firstCell = cell;
      clock.start(actionAt);
    }
    if (clock.elapsedMs(actionAt) >= MINE_LIMIT_MS) {
      status.textContent = 'Время партии истекло. Начни новую партию.';
      return;
    }
    if (!local)
      local = createMines(
        size,
        crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
        firstCell,
        board.cells.flatMap((value, i) => (value === -3 ? [i] : [])),
      );
    else actMines(local, action, cell);
    board = mineBoard(local);
    if (board.status !== 'playing') clock.finish(actionAt);
    status.textContent = `${ranked ? 'Рейтинговая' : 'Свободная'} партия · открой все клетки без мин.`;
    if (board.status === 'won' && ranked) {
      pending = { requestId, size, elapsedMs: elapsed() };
      saveMessage = 'Сохраняем результат…';
    }
    render();
    if (pending) void send();
  }
  sizeSelect.addEventListener('change', () => reset(ranked));
  reset(ranked);
  const interval = setInterval(() => {
    timer.textContent = formatMineTime(elapsed());
  }, 50);
  return {
    pause() {},
    resume() {},
    dispose() {
      disposed = true;
      input.dispose();
      epoch++;
      clearInterval(interval);
      shell.remove();
    },
  };
}
