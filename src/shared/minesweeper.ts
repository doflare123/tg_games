import {
  LEVELS,
  MINE_LIMIT_MS,
  type MineBoard,
  type MineSize,
  SIZES,
} from '../games/minesweeper/engine.ts';
import type { Period } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';

export interface MineRunView {
  id: string;
  revision: number;
  board: MineBoard;
  startedAt: number;
  elapsedMs: number;
}
export interface MineEntry {
  rank: number;
  playerId: number;
  name: string;
  elapsedMs: number;
  runId: string;
}
export interface MineLeaderboard {
  size: MineSize;
  period: Period;
  entries: MineEntry[];
  me: MineEntry | null;
}
export function decodeMineRun(value: unknown): MineRunView {
  const r = object(value);
  const b = object(r.board);
  const size = oneOf(b.size, SIZES);
  const { width, height } = LEVELS[size];
  if (!Array.isArray(b.cells) || b.cells.length !== width * height)
    throw new AppError('BAD_INPUT', 'Некорректное поле сапёра');
  return {
    id: text(r.id, 1, 100),
    revision: integer(r.revision, 0, 20000),
    board: {
      size,
      status: oneOf(b.status, ['playing', 'won', 'lost']),
      cells: b.cells.map((cell) => integer(cell, -3, 8)),
    },
    startedAt: integer(r.startedAt, 0, Number.MAX_SAFE_INTEGER),
    elapsedMs: integer(r.elapsedMs, 0, MINE_LIMIT_MS),
  };
}
function decodeMineEntry(value: unknown): MineEntry {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    elapsedMs: integer(r.elapsedMs, 0, MINE_LIMIT_MS),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeMineLeaderboard(value: unknown): MineLeaderboard {
  const r = object(value);
  if (!Array.isArray(r.entries) || r.entries.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректный рейтинг');
  return {
    size: oneOf(r.size, SIZES),
    period: oneOf(r.period, ['all', 'week']),
    entries: r.entries.map(decodeMineEntry),
    me: r.me === null ? null : decodeMineEntry(r.me),
  };
}
