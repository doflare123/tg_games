import {
  SNAKE_DIRECTIONS,
  SNAKE_MAX_TICKS,
  SNAKE_RULESET,
  SNAKE_SIZES,
  type SnakeDirection,
  type SnakeState,
} from '../games/snake/engine.ts';
import type { Period } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';
import { decodeGroupLeaderboardState, type GroupLeaderboardState } from './groups.ts';
export function snakeSize(value: unknown): number {
  const size = integer(value, 12, 24);
  if (!(SNAKE_SIZES as readonly number[]).includes(size))
    throw new AppError('BAD_INPUT', 'Неизвестный размер поля');
  return size;
}
export interface SnakeRun {
  id: string;
  ruleset: string;
  revision: number;
  state: SnakeState;
  status: 'active' | 'verified';
  createdAt: number;
  expiresAt: number;
}
export interface SnakeReplay {
  runId: string;
  revision: number;
  directions: SnakeDirection[];
}
export interface SnakeEntry {
  rank: number;
  playerId: number;
  name: string;
  score: number;
  runId: string;
}
export interface SnakeBoard extends GroupLeaderboardState {
  size: number;
  period: Period;
  entries: SnakeEntry[];
  me: SnakeEntry | null;
}
export function decodeSnakeState(value: unknown): SnakeState {
  const r = object(value);
  const size = snakeSize(r.size);
  if (!Array.isArray(r.body) || r.body.length < 3 || r.body.length > size * size)
    throw new AppError('BAD_INPUT', 'Некорректная змейка');
  const body = r.body.map((v) => integer(v, 0, size * size - 1));
  if (new Set(body).size !== body.length) throw new AppError('BAD_INPUT', 'Пересечение змейки');
  const food = r.food === null ? null : integer(r.food, 0, size * size - 1);
  if (food !== null && body.includes(food)) throw new AppError('BAD_INPUT', 'Еда внутри змейки');
  return {
    size,
    body,
    food,
    direction: oneOf(r.direction, SNAKE_DIRECTIONS),
    rng: integer(r.rng, 0, 0xffffffff),
    ticks: integer(r.ticks, 0, SNAKE_MAX_TICKS),
    score: integer(r.score, 0, (size * size - 3) * 10),
    status: oneOf(r.status, ['playing', 'over', 'won']),
  };
}
export function decodeSnakeRun(value: unknown): SnakeRun {
  const r = object(value);
  return {
    id: text(r.id, 1, 100),
    ruleset: oneOf(r.ruleset, [SNAKE_RULESET]),
    revision: integer(r.revision, 0, SNAKE_MAX_TICKS),
    state: decodeSnakeState(r.state),
    status: oneOf(r.status, ['active', 'verified']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
}
function entry(value: unknown): SnakeEntry {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    score: integer(r.score, 0, 5730),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeSnakeBoard(value: unknown): SnakeBoard {
  const r = object(value);
  if (!Array.isArray(r.entries) || r.entries.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректный рейтинг');
  return {
    size: snakeSize(r.size),
    period: oneOf(r.period, ['all', 'week']),
    ...decodeGroupLeaderboardState(r.membershipSync),
    entries: r.entries.map(entry),
    me: r.me === null ? null : entry(r.me),
  };
}
