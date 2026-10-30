import {
  ACTIONS,
  type Cell,
  HEIGHT,
  MODES,
  type PieceKind,
  type TetrisState,
  WIDTH,
} from '../games/tetris/types.ts';
import type { LeaderboardEntry, LeaderboardView, RunView } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';

const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('BAD_INPUT', 'Некорректный флаг');
  return value;
}
function kind(value: unknown): PieceKind {
  return oneOf(value, KINDS);
}
export function decodeTetris(value: unknown): TetrisState {
  const s = object(value);
  const p = object(s.active);
  if (!Array.isArray(s.board) || s.board.length !== HEIGHT)
    throw new AppError('BAD_INPUT', 'Некорректное поле');
  const board: Cell[][] = s.board.map((value) => {
    if (!Array.isArray(value) || value.length !== WIDTH)
      throw new AppError('BAD_INPUT', 'Некорректная строка поля');
    return value.map((cell) => (cell === null ? null : kind(cell)));
  });
  if (!Array.isArray(s.queue) || s.queue.length < 7 || s.queue.length > 14)
    throw new AppError('BAD_INPUT', 'Некорректная очередь');
  return {
    version: integer(s.version, 1, 1) as 1,
    mode: oneOf(s.mode, MODES),
    board,
    active: {
      kind: kind(p.kind),
      x: integer(p.x, -4, WIDTH),
      y: integer(p.y, 0, HEIGHT),
      rotation: integer(p.rotation, 0, 3),
    },
    queue: s.queue.map(kind),
    rng: integer(s.rng, 0, 0xffffffff),
    hold: s.hold === null ? null : kind(s.hold),
    canHold: bool(s.canHold),
    tick: integer(s.tick, 0, 108000),
    score: integer(s.score, 0, Number.MAX_SAFE_INTEGER),
    lines: integer(s.lines, 0, 100000),
    level: integer(s.level, 1, 10001),
    gravityTicks: integer(s.gravityTicks, 0, 60),
    lockTicks: integer(s.lockTicks, 0, 30),
    lockResets: integer(s.lockResets, 0, 15),
    combo: integer(s.combo, -1, 100000),
    backToBack: bool(s.backToBack),
    lastRotation: bool(s.lastRotation),
    status: oneOf(s.status, ['playing', 'won', 'lost']),
  };
}
export function decodeRun(value: unknown): RunView {
  const r = object(value);
  return {
    id: text(r.id, 1, 100),
    mode: oneOf(r.mode, MODES),
    revision: integer(r.revision, 0, 108001),
    ruleset: text(r.ruleset),
    state: decodeTetris(r.state),
    status: oneOf(r.status, ['active', 'verified', 'unranked', 'abandoned']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
}
export function decodeEntry(value: unknown): LeaderboardEntry {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    score: integer(r.score, 0, Number.MAX_SAFE_INTEGER),
    ticks: integer(r.ticks, 0, 108000),
    lines: integer(r.lines, 0, 100000),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeLeaderboard(value: unknown): LeaderboardView {
  const r = object(value);
  if (!Array.isArray(r.entries) || r.entries.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректный рейтинг');
  return {
    mode: oneOf(r.mode, MODES),
    period: oneOf(r.period, ['all', 'week']),
    entries: r.entries.map(decodeEntry),
    me: r.me === null ? null : decodeEntry(r.me),
  };
}
export function cloneTetris(s: TetrisState): TetrisState {
  return {
    ...s,
    active: { ...s.active },
    board: s.board.map((row) => [...row]),
    queue: [...s.queue],
  };
}
export function decodeReplayEvents(value: unknown) {
  if (!Array.isArray(value) || value.length > 432000)
    throw new AppError('BAD_INPUT', 'Некорректная запись');
  return value.map((item) => {
    const e = object(item);
    return { tick: integer(e.tick, 1, 108000), action: oneOf(e.action, ACTIONS) };
  });
}
