import {
  type Direction,
  LEGACY_2048_RULESET,
  MAX_2048_TILE,
  RULESETS_2048,
  type Ruleset2048,
  type State2048,
} from '../games/2048/engine.ts';
import type { Period } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';
import { decodeGroupLeaderboardState, type GroupLeaderboardState } from './groups.ts';

export interface Run2048 {
  id: string;
  ruleset: string;
  revision: number;
  state: State2048;
  status: 'active' | 'verified';
  createdAt: number;
  expiresAt: number;
}
export interface Moves2048 {
  runId: string;
  revision: number;
  moves: Direction[];
  finish: boolean;
}
export interface Entry2048 {
  rank: number;
  playerId: number;
  name: string;
  score: number;
  maxTile: number;
  runId: string;
}
export interface Board2048 extends GroupLeaderboardState {
  ruleset: Ruleset2048;
  period: Period;
  entries: Entry2048[];
  me: Entry2048 | null;
}
export function decodeState2048(value: unknown): State2048 {
  const s = object(value);
  if (!Array.isArray(s.board) || s.board.length !== 16)
    throw new AppError('BAD_INPUT', 'Некорректное поле 2048');
  return {
    version: s.version === undefined ? 1 : (integer(s.version, 1, 2) as 1 | 2),
    board: s.board.map((value) => {
      const tile = integer(value, 0, MAX_2048_TILE);
      if (tile !== 0 && (tile < 2 || 2 ** Math.round(Math.log2(tile)) !== tile))
        throw new AppError('BAD_INPUT', 'Некорректная плитка');
      return tile;
    }),
    rng: integer(s.rng, 0, 0xffffffff),
    score: integer(s.score, 0, Number.MAX_SAFE_INTEGER),
    moves: integer(s.moves, 0, Number.MAX_SAFE_INTEGER - 1),
    status: oneOf(s.status, ['playing', 'over']),
  };
}
export function decodeRun2048(value: unknown): Run2048 {
  const r = object(value);
  return {
    id: text(r.id, 1, 100),
    ruleset: text(r.ruleset),
    revision: integer(r.revision, 0, Number.MAX_SAFE_INTEGER - 1),
    state: decodeState2048(r.state),
    status: oneOf(r.status, ['active', 'verified']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
}
function decodeEntry2048(value: unknown): Entry2048 {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    score: integer(r.score, 0, Number.MAX_SAFE_INTEGER),
    maxTile: integer(r.maxTile, 2, MAX_2048_TILE),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeBoard2048(value: unknown): Board2048 {
  const r = object(value);
  if (!Array.isArray(r.entries) || r.entries.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректный рейтинг');
  return {
    ruleset: r.ruleset === undefined ? LEGACY_2048_RULESET : oneOf(r.ruleset, RULESETS_2048),
    period: oneOf(r.period, ['all', 'week']),
    ...decodeGroupLeaderboardState(r.membershipSync),
    entries: r.entries.map(decodeEntry2048),
    me: r.me === null ? null : decodeEntry2048(r.me),
  };
}
