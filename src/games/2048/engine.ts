export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const LEGACY_2048_RULESET = '2048-v1';
export const RULESET_2048 = '2048-v2';
export const RULESETS_2048 = [LEGACY_2048_RULESET, RULESET_2048] as const;
export type Ruleset2048 = (typeof RULESETS_2048)[number];
export const MAX_2048_TILE = 2 ** 52;
export const MAX_2048_CHUNK = 128;
export interface State2048 {
  version: 1 | 2;
  board: number[];
  rng: number;
  score: number;
  moves: number;
  status: 'playing' | 'over';
}
function random(state: State2048): number {
  let x = state.rng || 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 0x100000000;
}
export function minimum2048Tile(state: State2048): number {
  return state.version === 1 ? 2 : Math.max(2, Math.max(...state.board) / 2048);
}
function spawn(state: State2048): void {
  const empty = state.board.flatMap((value, i) => (value === 0 ? [i] : []));
  const index = empty[Math.floor(random(state) * empty.length)];
  const minimum = minimum2048Tile(state);
  if (index !== undefined) state.board[index] = minimum * (random(state) < 0.9 ? 1 : 2);
}
export function create2048(seed: number, ruleset: Ruleset2048 = RULESET_2048): State2048 {
  const state: State2048 = {
    version: ruleset === LEGACY_2048_RULESET ? 1 : 2,
    board: Array<number>(16).fill(0),
    rng: seed >>> 0,
    score: 0,
    moves: 0,
    status: 'playing',
  };
  spawn(state);
  spawn(state);
  return state;
}
export function canMove2048(board: readonly number[]): boolean {
  return board.some(
    (value, i) =>
      value === 0 || (i % 4 < 3 && value === board[i + 1]) || (i < 12 && value === board[i + 4]),
  );
}
// Each input tile can merge once per move; a new tile appears only after a change.
export function move2048(state: State2048, direction: Direction): boolean {
  if (state.status !== 'playing') return false;
  const next = [...state.board];
  let gained = 0;
  for (let line = 0; line < 4; line++) {
    const indices = Array.from({ length: 4 }, (_, offset) => {
      const position = direction === 'right' || direction === 'down' ? 3 - offset : offset;
      return direction === 'left' || direction === 'right'
        ? line * 4 + position
        : position * 4 + line;
    });
    const values = indices.map((i) => state.board[i] ?? 0).filter((value) => value !== 0);
    const merged: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? 0;
      if (value === values[i + 1]) {
        merged.push(value * 2);
        gained += value * 2;
        i++;
      } else merged.push(value);
    }
    indices.forEach((index, i) => {
      next[index] = merged[i] ?? 0;
    });
  }
  if (next.every((value, i) => value === state.board[i])) return false;
  // Preserve an exact final result at the numeric representation boundary.
  // Ordinary games have no move-count limit.
  if (
    !Number.isSafeInteger(state.score + gained) ||
    state.moves >= Number.MAX_SAFE_INTEGER - 1 ||
    next.some((value) => value > MAX_2048_TILE)
  ) {
    state.status = 'over';
    return true;
  }
  state.board = next;
  state.score += gained;
  state.moves++;
  spawn(state);
  if (!canMove2048(state.board)) state.status = 'over';
  return true;
}
