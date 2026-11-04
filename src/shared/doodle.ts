import type { AdventureState } from '../games/doodle/adventure.ts';
import {
  DOODLE_RULESETS as ARCHIVE_RULESETS,
  type DoodleRuleset as ArchiveRuleset,
  DOODLE_MAX_TICKS,
  type DoodleState,
  LEGACY_DOODLE_RULESET,
} from '../games/doodle/engine.ts';
import type { Period } from './contracts.ts';
import { decodeAdventureState } from './doodle-adventure.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';
import { decodeGroupLeaderboardState, type GroupLeaderboardState } from './groups.ts';
export const DOODLE_RULESET = 'doodle-v3';
export const DOODLE_RULESETS = [...ARCHIVE_RULESETS, DOODLE_RULESET] as const;
export type DoodleRuleset = (typeof DOODLE_RULESETS)[number];
export function doodleDirection(value: unknown): -1 | 0 | 1 {
  if (value === -1 || value === 0 || value === 1) return value;
  throw new AppError('BAD_INPUT', 'Некорректное направление');
}
interface DoodleRunBase {
  id: string;
  revision: number;
  status: 'active' | 'verified';
  createdAt: number;
  expiresAt: number;
}
export type DoodleRun = DoodleRunBase &
  (
    | { ruleset: ArchiveRuleset; state: DoodleState }
    | { ruleset: typeof DOODLE_RULESET; state: AdventureState }
  );
export interface DoodleEvent {
  tick: number;
  direction: -1 | 0 | 1;
  shooting?: boolean;
  aim?: number;
}
export interface DoodleReplay {
  runId: string;
  revision: number;
  untilTick: number;
  events: DoodleEvent[];
}
export interface DoodleEntry {
  rank: number;
  playerId: number;
  name: string;
  score: number;
  runId: string;
}
export interface DoodleBoard extends GroupLeaderboardState {
  period: Period;
  entries: DoodleEntry[];
  me: DoodleEntry | null;
}
export function decodeDoodleState(value: unknown): DoodleState {
  const r = object(value);
  if (!Array.isArray(r.platforms) || r.platforms.length < 1 || r.platforms.length > 24)
    throw new AppError('BAD_INPUT', 'Некорректные платформы');
  return {
    ruleset: r.ruleset === undefined ? LEGACY_DOODLE_RULESET : oneOf(r.ruleset, ARCHIVE_RULESETS),
    x: integer(r.x, 0, 359999),
    y: integer(r.y, -100000, 500000000),
    vx: integer(r.vx, -3600, 3600),
    vy: integer(r.vy, -12000, 14000),
    camera: integer(r.camera, 0, 500000000),
    highest: integer(r.highest, 50000, 500000000),
    generatedY: integer(r.generatedY, 50000, 500001000),
    generatedX: integer(r.generatedX, 0, 359999),
    direction: doodleDirection(r.direction),
    ticks: integer(r.ticks, 0, DOODLE_MAX_TICKS),
    score: integer(r.score, 0, 1000000),
    rng: integer(r.rng, 0, 0xffffffff),
    status: oneOf(r.status, ['playing', 'over']),
    platforms: r.platforms.map((value) => {
      const platform = object(value);
      if (typeof platform.broken !== 'boolean')
        throw new AppError('BAD_INPUT', 'Некорректная платформа');
      return {
        x: integer(platform.x, 0, 359999),
        y: integer(platform.y, 0, 500001000),
        kind: oneOf(platform.kind, ['normal', 'moving', 'fragile', 'spring']),
        phase: integer(platform.phase, 0, 239),
        broken: platform.broken,
      };
    }),
  };
}

export function decodeDoodleRun(value: unknown): DoodleRun {
  const r = object(value);
  const ruleset = oneOf(r.ruleset, DOODLE_RULESETS);
  const base = {
    id: text(r.id, 1, 100),
    revision: integer(r.revision, 0, DOODLE_MAX_TICKS),
    status: oneOf(r.status, ['active', 'verified']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
  if (ruleset === DOODLE_RULESET) return { ...base, ruleset, state: decodeAdventureState(r.state) };
  const state = decodeDoodleState(r.state);
  if (state.ruleset !== ruleset) throw new AppError('BAD_INPUT', 'Версия партии не совпадает');
  return { ...base, ruleset, state };
}
function entry(value: unknown): DoodleEntry {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    score: integer(r.score, 0, 1000000),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeDoodleBoard(value: unknown): DoodleBoard {
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
