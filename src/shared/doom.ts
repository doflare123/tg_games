import type { Period } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';
import { decodeGroupLeaderboardState, type GroupLeaderboardState } from './groups.ts';

export const DOOM_RULESET = 'freedoom-0.13.0-e1-v1';
export { DOOM_WAD_SHA256 } from './doom-content.ts';
export const DOOM_HZ = 35;
export const DOOM_MAX_TICKS = 35 * 60 * 120;
export const DOOM_CHUNK_TICKS = 350;
export const DOOM_ASSET_PATH = '/engines/doom/freedoom1.wad';
export const DOOM_SKILLS = ['1', '2', '3', '4'] as const;
export type DoomSkill = (typeof DOOM_SKILLS)[number];
export const DOOM_CATEGORIES = ['any', 'max'] as const;
export type DoomCategory = (typeof DOOM_CATEGORIES)[number];
export const DOOM_TARGETS = [
  'episode',
  'E1M1',
  'E1M2',
  'E1M3',
  'E1M4',
  'E1M5',
  'E1M6',
  'E1M7',
  'E1M8',
  'E1M9',
] as const;
export type DoomTarget = (typeof DOOM_TARGETS)[number];
export interface DoomCommandSpan {
  mask: number;
  ticks: number;
}
export interface DoomRun {
  id: string;
  ruleset: string;
  skill: DoomSkill;
  revision: number;
  acceptedTicks: number;
  verifiedTicks: number;
  continuous: boolean;
  status: 'active' | 'complete';
  createdAt: number;
  expiresAt: number;
}
export interface DoomProgress {
  run: DoomRun;
  commands: DoomCommandSpan[];
}
export interface DoomUpload {
  runId: string;
  revision: number;
  commands: DoomCommandSpan[];
  interruptions?: number[];
}
export interface DoomBoardInput {
  skill: DoomSkill;
  target: DoomTarget;
  category: DoomCategory;
  period: Period;
  groupId?: number;
}
export interface DoomEntry {
  rank: number;
  playerId: number;
  name: string;
  ticks: number;
  runId: string;
}
export interface DoomBoard extends GroupLeaderboardState {
  skill: DoomSkill;
  target: DoomTarget;
  category: DoomCategory;
  period: Period;
  entries: DoomEntry[];
  me: DoomEntry | null;
}
export function doomCommands(value: unknown, maxTicks = DOOM_CHUNK_TICKS): DoomCommandSpan[] {
  if (!Array.isArray(value) || value.length > maxTicks)
    throw new AppError('BAD_INPUT', 'Слишком большая запись Doom');
  let total = 0;
  return value.map((item) => {
    const span = object(item);
    const ticks = integer(span.ticks, 1, maxTicks);
    total += ticks;
    if (total > maxTicks) throw new AppError('BAD_INPUT', 'Слишком длинный фрагмент Doom');
    return { mask: integer(span.mask, 0, 4095), ticks };
  });
}
export function doomTicks(commands: readonly DoomCommandSpan[]): number {
  return commands.reduce((sum, span) => sum + span.ticks, 0);
}
export function doomSamePrefix(
  left: readonly DoomCommandSpan[],
  right: readonly DoomCommandSpan[],
  ticks: number,
): boolean {
  let a = 0,
    b = 0,
    offsetA = 0,
    offsetB = 0,
    checked = 0;
  while (checked < ticks) {
    const first = left[a],
      second = right[b];
    if (!first || !second || first.mask !== second.mask) return false;
    const step = Math.min(first.ticks - offsetA, second.ticks - offsetB, ticks - checked);
    if (step <= 0) return false;
    checked += step;
    offsetA += step;
    offsetB += step;
    if (offsetA === first.ticks) {
      a++;
      offsetA = 0;
    }
    if (offsetB === second.ticks) {
      b++;
      offsetB = 0;
    }
  }
  return true;
}
export function decodeDoomRun(value: unknown): DoomRun {
  const r = object(value);
  if (typeof r.continuous !== 'boolean')
    throw new AppError('BAD_INPUT', 'Некорректный прогресс Doom');
  const acceptedTicks = integer(r.acceptedTicks, 0, DOOM_MAX_TICKS);
  return {
    id: text(r.id, 1, 100),
    ruleset: oneOf(r.ruleset, [DOOM_RULESET]),
    skill: oneOf(r.skill, DOOM_SKILLS),
    revision: integer(r.revision, 0, DOOM_MAX_TICKS),
    acceptedTicks,
    verifiedTicks: integer(r.verifiedTicks, 0, acceptedTicks),
    continuous: r.continuous,
    status: oneOf(r.status, ['active', 'complete']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
}
export function decodeDoomProgress(value: unknown): DoomProgress {
  const p = object(value);
  const run = decodeDoomRun(p.run);
  const commands = doomCommands(p.commands, DOOM_MAX_TICKS);
  if (doomTicks(commands) !== run.acceptedTicks)
    throw new AppError('BAD_INPUT', 'Неполная запись Doom');
  return { run, commands };
}
export function decodeDoomBoard(value: unknown): DoomBoard {
  const b = object(value);
  const entry = (value: unknown): DoomEntry => {
    const e = object(value);
    return {
      rank: integer(e.rank, 1, Number.MAX_SAFE_INTEGER),
      playerId: integer(e.playerId, 1, Number.MAX_SAFE_INTEGER),
      name: text(e.name, 1, 100),
      ticks: integer(e.ticks, 1, DOOM_MAX_TICKS),
      runId: text(e.runId, 1, 100),
    };
  };
  if (!Array.isArray(b.entries) || b.entries.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректный рейтинг Doom');
  return {
    skill: oneOf(b.skill, DOOM_SKILLS),
    target: oneOf(b.target, DOOM_TARGETS),
    category: oneOf(b.category, DOOM_CATEGORIES),
    period: oneOf(b.period, ['all', 'week']),
    entries: b.entries.map(entry),
    me: b.me === null ? null : entry(b.me),
    ...decodeGroupLeaderboardState(b.membershipSync),
  };
}
export function doomTime(ticks: number): string {
  const seconds = ticks / DOOM_HZ;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
export function doomBoardMode(value: string) {
  const [skill, target, category, extra] = value.split(':');
  if (extra !== undefined) throw new AppError('BAD_INPUT', 'Некорректный режим Doom');
  return {
    skill: oneOf(skill, DOOM_SKILLS),
    target: oneOf(target, DOOM_TARGETS),
    category: oneOf(category, DOOM_CATEGORIES),
  };
}
