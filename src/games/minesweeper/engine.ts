export const SIZES = ['9x9', '16x16', '30x16'] as const;
export type MineSize = (typeof SIZES)[number];
export const LEVELS = {
  '9x9': { width: 9, height: 9, mines: 10, title: 'Новичок · 9×9' },
  '16x16': { width: 16, height: 16, mines: 40, title: 'Любитель · 16×16' },
  '30x16': { width: 30, height: 16, mines: 99, title: 'Эксперт · 30×16' },
} as const;
export const MINE_RULESET = 'minesweeper-v1';
export const MINE_LIMIT_MS = 3_600_000;
export const MINE_ACTIONS = ['reveal', 'flag', 'chord'] as const;
export type MineAction = (typeof MINE_ACTIONS)[number];
export type MineStatus = 'playing' | 'won' | 'lost';
export interface MineState {
  size: MineSize;
  // -1 = mine, 0..8 = adjacent mines.
  cells: number[];
  revealed: boolean[];
  flags: boolean[];
  status: MineStatus;
}
// Visible cells: -3 = flag, -2 = covered, -1 = mine, 0..8 = adjacent mines.
export interface MineBoard {
  size: MineSize;
  cells: number[];
  status: MineStatus;
}
export function neighbors(size: MineSize, cell: number): number[] {
  const { width, height } = LEVELS[size];
  const x = cell % width;
  const y = Math.floor(cell / width);
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
        result.push((y + dy) * width + x + dx);
  return result;
}
export function createMines(
  size: MineSize,
  seed: number,
  first: number,
  flags: readonly number[] = [],
): MineState {
  const { width, height, mines } = LEVELS[size];
  const total = width * height;
  if (!Number.isInteger(first) || first < 0 || first >= total) throw new Error('Invalid cell');
  if (flags.some((i) => !Number.isInteger(i) || i < 0 || i >= total) || flags.includes(first))
    throw new Error('Invalid initial flags');
  const flagged = new Set(flags);
  const safe = new Set([first, ...neighbors(size, first)]);
  const available = Array.from({ length: total }, (_, i) => i).filter((i) => !safe.has(i));
  let rng = seed >>> 0;
  for (let i = available.length - 1; i > 0; i--) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((rng / 0x100000000) * (i + 1));
    const a = available[i];
    const b = available[j];
    if (a !== undefined && b !== undefined) {
      available[i] = b;
      available[j] = a;
    }
  }
  const cells = Array<number>(total).fill(0);
  for (const i of available.slice(0, mines)) cells[i] = -1;
  for (let i = 0; i < total; i++)
    if (cells[i] !== -1) cells[i] = neighbors(size, i).filter((n) => cells[n] === -1).length;
  const state: MineState = {
    size,
    cells,
    revealed: Array<boolean>(total).fill(false),
    flags: Array.from({ length: total }, (_, i) => flagged.has(i)),
    status: 'playing',
  };
  actMines(state, 'reveal', first);
  return state;
}
export function actMines(state: MineState, action: MineAction, cell: number): void {
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length)
    throw new Error('Invalid cell');
  if (state.status !== 'playing') return;
  if (action === 'flag') {
    if (!state.revealed[cell]) state.flags[cell] = !state.flags[cell];
    return;
  }
  let pending = [cell];
  if (action === 'chord') {
    if (!state.revealed[cell] || (state.cells[cell] ?? 0) <= 0) return;
    const around = neighbors(state.size, cell);
    if (around.filter((i) => state.flags[i]).length !== state.cells[cell]) return;
    pending = around;
  }
  while (pending.length) {
    const i = pending.pop();
    if (i === undefined || state.revealed[i] || state.flags[i]) continue;
    state.revealed[i] = true;
    if (state.cells[i] === -1) {
      state.status = 'lost';
      return;
    }
    if (state.cells[i] === 0) pending.push(...neighbors(state.size, i));
  }
  if (state.cells.every((value, i) => value === -1 || state.revealed[i])) {
    state.status = 'won';
    state.flags = state.cells.map((value) => value === -1);
  }
}
export function mineBoard(state: MineState): MineBoard {
  return {
    size: state.size,
    status: state.status,
    cells: state.cells.map((value, i) =>
      state.revealed[i] || (state.status === 'lost' && value === -1)
        ? value
        : state.flags[i]
          ? -3
          : -2,
    ),
  };
}
