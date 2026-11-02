import { AppError, integer, object, oneOf, text } from './errors.ts';

export const ADMIN_TABLES = [
  'players',
  'groups',
  'runs',
  'puzzle2048_runs',
  'snake_runs',
  'flappy_runs',
  'minesweeper_runs',
  'manual_results',
  'group_memberships',
  'social_jobs',
  'ranking_blocks',
  'admin_visits',
  'admin_group_events',
  'admin_audit',
] as const;
export type AdminTable = (typeof ADMIN_TABLES)[number];
export const ADMIN_ACTIONS = [
  'disable_notifications',
  'cancel_job',
  'block_player',
  'unblock_player',
  'revoke_tetris',
  'revoke_2048',
  'revoke_snake',
  'revoke_flappy',
  'revoke_minesweeper',
  'remove_manual',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type AdminCell = string | number | null;
export interface AdminPage {
  table: AdminTable;
  page: number;
  hasMore: boolean;
  columns: string[];
  rows: Record<string, AdminCell>[];
}
export interface AdminPreview {
  action: AdminAction;
  target: string;
  before: string;
  after: string;
}
export interface AdminMutation extends AdminPreview {
  requestId: string;
  reason: string;
}
export interface AdminWeek {
  start: number;
  end: number;
  attempts: number;
  results: number;
  players: number;
  visitors: number;
  newVisitors: number;
  added: number;
  removed: number;
}
export interface AdminStats {
  now: number;
  trackingSince: number;
  weeks: AdminWeek[];
  previousMatched: AdminWeek;
  totals: {
    players: number;
    groups: number;
    activeGroups: number;
    blocked: number;
    pendingJobs: number;
  };
  games: { game: string; attempts: number; results: number; players: number }[];
}
export function adminListInput(value: unknown) {
  const r = object(value);
  return {
    table: oneOf(r.table, ADMIN_TABLES),
    page: integer(r.page ?? 0, 0, 4000),
    search: text(r.search ?? '', 0, 100).trim(),
  };
}
export function adminActionInput(value: unknown) {
  const r = object(value);
  return { action: oneOf(r.action, ADMIN_ACTIONS), target: text(r.target, 1, 200) };
}
export function adminMutationInput(value: unknown): AdminMutation {
  const r = object(value);
  const requestId = text(r.requestId, 16, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId))
    throw new AppError('BAD_INPUT', 'Некорректный ключ операции');
  const reason = text(r.reason, 3, 300).trim();
  if (reason.length < 3) throw new AppError('BAD_INPUT', 'Укажи причину изменения');
  return {
    ...adminActionInput(r),
    requestId,
    reason,
    before: text(r.before, 1, 20000),
    after: text(r.after, 1, 20000),
  };
}
function count(value: unknown): number {
  return integer(value, 0, Number.MAX_SAFE_INTEGER);
}
function week(value: unknown): AdminWeek {
  const r = object(value);
  return {
    start: count(r.start),
    end: count(r.end),
    attempts: count(r.attempts),
    results: count(r.results),
    players: count(r.players),
    visitors: count(r.visitors),
    newVisitors: count(r.newVisitors),
    added: count(r.added),
    removed: count(r.removed),
  };
}
export function decodeAdminStats(value: unknown): AdminStats {
  const r = object(value);
  const t = object(r.totals);
  if (
    !Array.isArray(r.weeks) ||
    r.weeks.length > 12 ||
    !Array.isArray(r.games) ||
    r.games.length > 8
  )
    throw new AppError('BAD_INPUT', 'Некорректная статистика');
  return {
    now: count(r.now),
    trackingSince: count(r.trackingSince),
    weeks: r.weeks.map(week),
    previousMatched: week(r.previousMatched),
    totals: {
      players: count(t.players),
      groups: count(t.groups),
      activeGroups: count(t.activeGroups),
      blocked: count(t.blocked),
      pendingJobs: count(t.pendingJobs),
    },
    games: r.games.map((value) => {
      const g = object(value);
      return {
        game: text(g.game, 1, 32),
        attempts: count(g.attempts),
        results: count(g.results),
        players: count(g.players),
      };
    }),
  };
}
export function decodeAdminPage(value: unknown): AdminPage {
  const r = object(value);
  if (
    !Array.isArray(r.columns) ||
    r.columns.length > 25 ||
    !Array.isArray(r.rows) ||
    r.rows.length > 25 ||
    typeof r.hasMore !== 'boolean'
  )
    throw new AppError('BAD_INPUT', 'Некорректная таблица');
  const columns = r.columns.map((c) => text(c, 1, 64));
  return {
    table: oneOf(r.table, ADMIN_TABLES),
    page: integer(r.page, 0, 4000),
    hasMore: r.hasMore,
    columns,
    rows: r.rows.map((value) => {
      const source = object(value);
      const row: Record<string, AdminCell> = {};
      for (const key of columns) {
        const cell = source[key];
        if (
          cell !== null &&
          typeof cell !== 'string' &&
          (typeof cell !== 'number' || !Number.isFinite(cell))
        )
          throw new AppError('BAD_INPUT', 'Некорректная ячейка');
        row[key] = cell;
      }
      return row;
    }),
  };
}
export function decodeAdminPreview(value: unknown): AdminPreview {
  const r = object(value);
  return {
    ...adminActionInput(r),
    before: text(r.before, 1, 20000),
    after: text(r.after, 1, 20000),
  };
}
