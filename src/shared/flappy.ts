import { FLAPPY_MAX_TICKS, FLAPPY_RULESET, type FlappyState } from '../games/flappy/engine.ts';
import type { Period } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';
import { decodeGroupLeaderboardState, type GroupLeaderboardState } from './groups.ts';
export interface FlappyRun {
  id: string;
  ruleset: string;
  revision: number;
  state: FlappyState;
  status: 'active' | 'verified';
  createdAt: number;
  expiresAt: number;
}
export interface FlappyReplay {
  runId: string;
  revision: number;
  untilTick: number;
  flaps: number[];
}
export interface FlappyEntry {
  rank: number;
  playerId: number;
  name: string;
  score: number;
  runId: string;
}
export interface FlappyBoard extends GroupLeaderboardState {
  period: Period;
  entries: FlappyEntry[];
  me: FlappyEntry | null;
}
export function decodeFlappyState(value: unknown): FlappyState {
  const r = object(value);
  if (!Array.isArray(r.pipes) || r.pipes.length !== 3)
    throw new AppError('BAD_INPUT', 'Некорректные трубы');
  return {
    y: integer(r.y, -20000, 420000),
    velocity: integer(r.velocity, -4600, 9000),
    ticks: integer(r.ticks, 0, FLAPPY_MAX_TICKS),
    lastFlap: integer(r.lastFlap, -4, FLAPPY_MAX_TICKS),
    score: integer(r.score, 0, FLAPPY_MAX_TICKS),
    rng: integer(r.rng, 0, 0xffffffff),
    status: oneOf(r.status, ['playing', 'over']),
    pipes: r.pipes.map((value) => {
      const pipe = object(value);
      if (typeof pipe.passed !== 'boolean') throw new AppError('BAD_INPUT', 'Некорректная труба');
      return {
        x: integer(pipe.x, -55000, 700000),
        gapY: integer(pipe.gapY, 112, 288),
        passed: pipe.passed,
      };
    }),
  };
}
export function decodeFlappyRun(value: unknown): FlappyRun {
  const r = object(value);
  return {
    id: text(r.id, 1, 100),
    ruleset: oneOf(r.ruleset, [FLAPPY_RULESET]),
    revision: integer(r.revision, 0, FLAPPY_MAX_TICKS),
    state: decodeFlappyState(r.state),
    status: oneOf(r.status, ['active', 'verified']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
}
function entry(value: unknown): FlappyEntry {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    score: integer(r.score, 0, FLAPPY_MAX_TICKS),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeFlappyBoard(value: unknown): FlappyBoard {
  const r = object(value);
  if (!Array.isArray(r.entries) || r.entries.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректный рейтинг');
  return {
    period: oneOf(r.period, ['all', 'week']),
    ...decodeGroupLeaderboardState(r.membershipSync),
    entries: r.entries.map(entry),
    me: r.me === null ? null : entry(r.me),
  };
}
