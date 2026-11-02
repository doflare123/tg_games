export const SNAKE_RULESET = 'snake-v1';
// Retain 12×12 for decoding historical runs; current arenas use SNAKE_PLAYABLE_SIZES.
export const SNAKE_SIZES = [12, 16, 20, 24] as const;
export const SNAKE_PLAYABLE_SIZES = [16, 20, 24] as const;
export const SNAKE_DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
export type SnakeDirection = (typeof SNAKE_DIRECTIONS)[number];
export const SNAKE_STEP_MS = 150;
export const SNAKE_MAX_TICKS = 24000;
export const SNAKE_CHUNK = 200;
export interface SnakeState {
  size: number;
  body: number[];
  direction: SnakeDirection;
  food: number | null;
  rng: number;
  ticks: number;
  score: number;
  status: 'playing' | 'over' | 'won';
}
export function opposite(a: SnakeDirection, b: SnakeDirection): boolean {
  return (SNAKE_DIRECTIONS.indexOf(a) + 2) % 4 === SNAKE_DIRECTIONS.indexOf(b);
}
function spawn(state: SnakeState): void {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  const occupied = new Set(state.body);
  const available = state.size * state.size - occupied.size;
  if (!available) {
    state.food = null;
    state.status = 'won';
    return;
  }
  let target = state.rng % available;
  for (let i = 0; i < state.size * state.size; i++) {
    if (!occupied.has(i) && target-- === 0) {
      state.food = i;
      return;
    }
  }
}
export function createSnake(size: number, seed: number): SnakeState {
  if (!(SNAKE_SIZES as readonly number[]).includes(size)) throw new Error('Invalid snake size');
  const center = Math.floor(size / 2) * size + Math.floor(size / 2);
  const state: SnakeState = {
    size,
    body: [center, center - 1, center - 2],
    direction: 'right',
    food: null,
    rng: seed >>> 0,
    ticks: 0,
    score: 0,
    status: 'playing',
  };
  spawn(state);
  return state;
}
export function stepSnake(state: SnakeState, direction: SnakeDirection = state.direction): boolean {
  if (state.status !== 'playing' || opposite(state.direction, direction)) return false;
  state.direction = direction;
  state.ticks++;
  const head = state.body[0];
  if (head === undefined) throw new Error('Missing snake head');
  const x = (head % state.size) + (direction === 'right' ? 1 : direction === 'left' ? -1 : 0);
  const y =
    Math.floor(head / state.size) + (direction === 'down' ? 1 : direction === 'up' ? -1 : 0);
  const next = y * state.size + x;
  const eating = next === state.food;
  const collisionBody = eating ? state.body : state.body.slice(0, -1);
  if (x < 0 || y < 0 || x >= state.size || y >= state.size || collisionBody.includes(next)) {
    state.status = 'over';
    return true;
  }
  state.body.unshift(next);
  if (eating) {
    state.score += 10;
    spawn(state);
  } else state.body.pop();
  if (state.ticks >= SNAKE_MAX_TICKS && state.status === 'playing') state.status = 'over';
  return true;
}
