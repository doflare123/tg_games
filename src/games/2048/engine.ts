export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const RULESET_2048 = '2048-v1';
export const MAX_2048_MOVES = 20000;
export const MAX_2048_CHUNK = 128;
export interface State2048 {
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
function spawn(state: State2048): void {
  const empty = state.board.flatMap((value, i) => (value === 0 ? [i] : []));
  const index = empty[Math.floor(random(state) * empty.length)];
  if (index !== undefined) state.board[index] = random(state) < 0.9 ? 2 : 4;
}
export function create2048(seed: number): State2048 {
  const state: State2048 = {
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
  state.board = next;
  state.score += gained;
  state.moves++;
  spawn(state);
  if (!canMove2048(state.board) || state.moves >= MAX_2048_MOVES) state.status = 'over';
  return true;
}
