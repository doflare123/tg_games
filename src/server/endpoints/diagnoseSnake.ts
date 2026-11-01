import { db, EndpointError } from 'sdk';
import { SNAKE_RULESET, SNAKE_STEP_MS, stepSnake } from '../../games/snake/engine.ts';
import { object } from '../../shared/errors.ts';
import { decodeSnakeRun, decodeSnakeState } from '../../shared/snake.ts';
import { type SnakeRepository, SnakeService, type StoredSnake } from '../domain/snake.ts';
import { snakeRecordNotification } from '../domain/snake-record-notification.ts';
import { SqlSnakeRepository } from '../platform/sql-snake.ts';

// Read-only cloud smoke check. Game sessions below exist only in memory.
export default async function diagnose(_input: unknown, context: unknown) {
  const ctx = object(context);
  if (ctx.maintenance !== true || ctx.initData !== undefined)
    throw new EndpointError('Только служебный CLI-вызов', { code: 'UNAUTHORIZED' });
  const sql = new SqlSnakeRepository(db);
  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='snake_runs'",
  );
  if (!Array.isArray(tables) || tables.length !== 1) throw new Error('Snake table missing');
  const indexes = await db.all(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='snake_runs'",
  );
  const boards = [];
  for (const size of [12, 16, 20, 24]) {
    const board = await sql.leaderboard({ id: 1, name: 'Diagnostic' }, size, 'all', 0);
    boards.push({ size, entries: board.entries.length });
  }
  await sql.leaderboard({ id: 1, name: 'Diagnostic' }, 16, 'all', 0, {
    groupId: -1,
    membershipCheckedSince: Date.now(),
    maxResultOrder: 0,
  });
  const pending = await sql.pendingResults(3);
  const sessions = new Map<string, StoredSnake>();
  const clone = (run: StoredSnake): StoredSnake => ({ ...run, ...decodeSnakeRun(run) });
  let now = Date.now();
  const memory: SnakeRepository = {
    async get(id) {
      const run = sessions.get(id);
      return run ? clone(run) : null;
    },
    async create(run) {
      sessions.set(run.id, clone(run));
      return clone(run);
    },
    async save(run, revision) {
      if (sessions.get(run.id)?.revision !== revision) return false;
      sessions.set(run.id, clone(run));
      return true;
    },
    async countRecent() {
      return 0;
    },
    async pendingResults() {
      return [];
    },
    async processed() {},
    leaderboard: (...args) => sql.leaderboard(...args),
  };
  const service = new SnakeService(memory, { now: () => now, seed: () => 42 });
  const player = { id: 1, name: 'In-memory diagnostic' };
  const run = await service.create(player, { requestId: 'snake-cloud-readonly-test', size: 12 });
  const state = decodeSnakeState(run.state);
  const directions = [];
  while (state.status === 'playing') {
    directions.push(state.direction);
    stepSnake(state);
  }
  now += state.ticks * SNAKE_STEP_MS;
  const input = { runId: run.id, revision: 0, directions };
  const result = await service.submit(player, input);
  const retry = await service.submit(player, input);
  if (
    result.status !== 'verified' ||
    result.state.ticks !== state.ticks ||
    retry.revision !== result.revision
  )
    throw new Error('Cloud replay verification failed');
  let ownerRejected = false;
  try {
    await service.get({ id: 2, name: 'Other' }, { runId: run.id });
  } catch {
    ownerRejected = true;
  }
  if (!ownerRejected) throw new Error('Cloud owner check failed');
  const stored = sessions.get(run.id);
  if (!stored) throw new Error('Diagnostic session missing');
  const notification = snakeRecordNotification(
    stored,
    { size: 12, period: 'all', entries: [], me: null },
    {
      size: 12,
      period: 'all',
      entries: [],
      me: { rank: 1, playerId: 1, name: player.name, score: 10, runId: run.id },
    },
  );
  if (!notification?.includes('Змейка · 12×12')) throw new Error('Notification template failed');
  return {
    ruleset: SNAKE_RULESET,
    table: true,
    indexes,
    boards,
    replay: 'verified in memory',
    idempotency: true,
    ownerRejected,
    notifications: { groupQuery: true, pendingRead: true, pending: pending.length, template: true },
    liveDataChanged: false,
  };
}
