import {
  BLOCK_RULESET,
  BLOCK_SHAPES,
  type BlockMove,
  type BlockState,
} from '../games/block-blast/engine.ts';
import type { Period } from './contracts.ts';
import { AppError, integer, object, oneOf, text } from './errors.ts';
import { decodeGroupLeaderboardState, type GroupLeaderboardState } from './groups.ts';
export interface BlockRun {
  id: string;
  ruleset: string;
  revision: number;
  state: BlockState;
  status: 'active' | 'verified';
  createdAt: number;
  expiresAt: number;
}
export interface BlockMoves {
  runId: string;
  revision: number;
  moves: BlockMove[];
  finish: boolean;
}
export interface BlockEntry {
  rank: number;
  playerId: number;
  name: string;
  score: number;
  runId: string;
}
export interface BlockBoard extends GroupLeaderboardState {
  period: Period;
  entries: BlockEntry[];
  me: BlockEntry | null;
}
export function decodeBlockMove(value: unknown): BlockMove {
  const r = object(value);
  return { slot: integer(r.slot, 0, 2), x: integer(r.x, 0, 7), y: integer(r.y, 0, 7) };
}
export function decodeBlockState(value: unknown): BlockState {
  const r = object(value);
  if (
    !Array.isArray(r.board) ||
    r.board.length !== 64 ||
    !Array.isArray(r.tray) ||
    r.tray.length !== 3
  )
    throw new AppError('BAD_INPUT', 'Некорректное поле Block Blast');
  return {
    board: r.board.map((cell) => integer(cell, 0, 6)),
    tray: r.tray.map((piece) =>
      piece === null ? null : integer(piece, 0, BLOCK_SHAPES.length - 1),
    ),
    rng: integer(r.rng, 0, 0xffffffff),
    score: integer(r.score, 0, Number.MAX_SAFE_INTEGER),
    moves: integer(r.moves, 0, Number.MAX_SAFE_INTEGER - 1),
    lines: integer(r.lines, 0, Number.MAX_SAFE_INTEGER),
    clears: integer(r.clears, 0, Number.MAX_SAFE_INTEGER),
    status: oneOf(r.status, ['playing', 'over']),
  };
}
export function decodeBlockRun(value: unknown): BlockRun {
  const r = object(value);
  return {
    id: text(r.id, 1, 100),
    ruleset: oneOf(r.ruleset, [BLOCK_RULESET]),
    revision: integer(r.revision, 0, Number.MAX_SAFE_INTEGER - 1),
    state: decodeBlockState(r.state),
    status: oneOf(r.status, ['active', 'verified']),
    createdAt: integer(r.createdAt, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expiresAt, 0, Number.MAX_SAFE_INTEGER),
  };
}
function entry(value: unknown): BlockEntry {
  const r = object(value);
  return {
    rank: integer(r.rank, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.playerId, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.name, 1, 100),
    score: integer(r.score, 0, Number.MAX_SAFE_INTEGER),
    runId: text(r.runId, 1, 100),
  };
}
export function decodeBlockBoard(value: unknown): BlockBoard {
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
