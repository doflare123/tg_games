import { cells, kicks } from './pieces.ts';
import {
  HEIGHT,
  MAX_TICKS,
  type Piece,
  type PieceKind,
  type TetrisAction,
  type TetrisMode,
  type TetrisState,
  ULTRA_TICKS,
  WIDTH,
} from './types.ts';

const KINDS: PieceKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
function random(state: TetrisState): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let n = state.rng;
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}
function refill(state: TetrisState): void {
  while (state.queue.length < 7) {
    const bag = [...KINDS];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random(state) * (i + 1));
      const a = bag[i];
      const b = bag[j];
      if (a !== undefined && b !== undefined) {
        bag[i] = b;
        bag[j] = a;
      }
    }
    state.queue.push(...bag);
  }
}
export function collides(state: TetrisState, piece: Piece): boolean {
  return cells(piece).some(
    ([x, y]) => x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || state.board[y]?.[x] !== null,
  );
}
function spawn(state: TetrisState, held?: PieceKind): void {
  refill(state);
  const kind = held ?? state.queue.shift();
  if (!kind) throw new Error('Empty piece queue');
  state.active = { kind, x: 3, y: 0, rotation: 0 };
  state.gravityTicks = 0;
  state.lockTicks = 0;
  state.lockResets = 0;
  state.lastRotation = false;
  refill(state);
  if (collides(state, state.active)) state.status = 'lost';
}
export function createTetris(seed: number, mode: TetrisMode): TetrisState {
  const state: TetrisState = {
    version: 1,
    mode,
    board: Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => null)),
    active: { kind: 'T', x: 3, y: 0, rotation: 0 },
    queue: [],
    rng: seed >>> 0,
    hold: null,
    canHold: true,
    tick: 0,
    score: 0,
    lines: 0,
    level: 1,
    gravityTicks: 0,
    lockTicks: 0,
    lockResets: 0,
    combo: -1,
    backToBack: false,
    lastRotation: false,
    status: 'playing',
  };
  spawn(state);
  return state;
}
function move(state: TetrisState, dx: number, dy: number): boolean {
  const next = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
  if (collides(state, next)) return false;
  const grounded = collides(state, { ...state.active, y: state.active.y + 1 });
  state.active = next;
  state.lastRotation = false;
  if (dx !== 0 && grounded && state.lockResets < 15) {
    state.lockTicks = 0;
    state.lockResets++;
  }
  return true;
}
function rotate(state: TetrisState, direction: number): void {
  if (state.active.kind === 'O') return;
  const from = state.active.rotation;
  const to = (from + direction + 4) % 4;
  for (const [dx, dy] of kicks(state.active.kind, from, to)) {
    const next = { ...state.active, rotation: to, x: state.active.x + dx, y: state.active.y + dy };
    if (!collides(state, next)) {
      const grounded = collides(state, { ...state.active, y: state.active.y + 1 });
      state.active = next;
      state.lastRotation = true;
      if (grounded && state.lockResets < 15) {
        state.lockTicks = 0;
        state.lockResets++;
      }
      return;
    }
  }
}
function lock(state: TetrisState): void {
  const spin =
    state.active.kind === 'T' &&
    state.lastRotation &&
    [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ].filter(([dx = 0, dy = 0]) => {
      const x = state.active.x + dx;
      const y = state.active.y + dy;
      return x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || state.board[y]?.[x] !== null;
    }).length >= 3;
  for (const [x, y] of cells(state.active)) {
    const row = state.board[y];
    if (row) row[x] = state.active.kind;
  }
  const remaining = state.board.filter((row) => row.some((cell) => cell === null));
  const cleared = HEIGHT - remaining.length;
  state.board = [
    ...Array.from({ length: cleared }, () => Array.from({ length: WIDTH }, () => null)),
    ...remaining,
  ];
  const difficult = cleared > 0 && (cleared === 4 || spin);
  const base = spin
    ? ([400, 800, 1200, 1600][cleared] ?? 0)
    : ([0, 100, 300, 500, 800][cleared] ?? 0);
  state.score += Math.floor(base * state.level * (difficult && state.backToBack ? 1.5 : 1));
  if (cleared > 0) {
    state.combo++;
    state.score += 50 * Math.max(0, state.combo) * state.level;
    state.backToBack = difficult;
    if (state.board.every((row) => row.every((cell) => cell === null)))
      state.score += 2000 * state.level;
  } else state.combo = -1;
  state.lines += cleared;
  state.level = Math.floor(state.lines / 10) + 1;
  state.canHold = true;
  if (state.mode === 'sprint' && state.lines >= 40) state.status = 'won';
  else spawn(state);
}
export function stepTetris(state: TetrisState, actions: readonly TetrisAction[] = []): void {
  if (state.status !== 'playing') return;
  state.tick++;
  for (const action of actions) {
    if (state.status !== 'playing') break;
    switch (action) {
      case 'left':
        move(state, -1, 0);
        break;
      case 'right':
        move(state, 1, 0);
        break;
      case 'softDrop':
        if (move(state, 0, 1)) state.score++;
        break;
      case 'rotateCW':
        rotate(state, 1);
        break;
      case 'rotateCCW':
        rotate(state, -1);
        break;
      case 'hold':
        if (state.canHold) {
          const previous = state.hold;
          state.hold = state.active.kind;
          spawn(state, previous ?? undefined);
          state.canHold = false;
        }
        break;
      case 'hardDrop':
        while (move(state, 0, 1)) state.score += 2;
        lock(state);
        break;
    }
    // A hard drop ends this frame: remaining input cannot control the next piece.
    if (action === 'hardDrop') break;
  }
  if (state.status !== 'playing') return;
  state.gravityTicks++;
  const gravity = Math.max(
    1,
    Math.floor(60 * (0.8 - Math.min(0.7, (state.level - 1) * 0.007)) ** (state.level - 1)),
  );
  if (state.gravityTicks >= gravity) {
    state.gravityTicks = 0;
    move(state, 0, 1);
  }
  if (collides(state, { ...state.active, y: state.active.y + 1 })) {
    state.lockTicks++;
    if (state.lockTicks >= 30) lock(state);
  } else state.lockTicks = 0;
  if (
    state.status === 'playing' &&
    ((state.mode === 'ultra' && state.tick >= ULTRA_TICKS) || state.tick >= MAX_TICKS)
  )
    state.status = 'won';
}
export function ghostPiece(state: TetrisState): Piece {
  const ghost = { ...state.active };
  while (!collides(state, { ...ghost, y: ghost.y + 1 })) ghost.y++;
  return ghost;
}
