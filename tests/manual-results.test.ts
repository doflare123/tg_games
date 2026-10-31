import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import { decodeManualResult } from '../src/server/domain/manual-result.ts';
import { SqlManualResultRepository } from '../src/server/platform/sql-manual-results.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});
const input = {
  id: 'manual:test:recovery',
  player: { id: 8, name: 'Игрок' },
  mode: 'marathon',
  score: 43567,
  ticks: null,
  lines: 60,
  groupIds: [-100],
  reason: 'User-requested recovery; replay and duration unavailable',
  operator: 'Project owner',
  approximate: true,
};
it('keeps manual corrections auditable, idempotent and separate from verified runs', async () => {
  const local = localRepository();
  handles.push(local);
  const repository = new SqlManualResultRepository(local.db);
  const value = decodeManualResult(input);
  await local.db.run(
    'INSERT INTO group_memberships(id,group_id,user_id,active,updated_at) VALUES(:id,-100,8,1,100)',
    { ':id': '-100:8' },
  );
  await repository.record(value, 100);
  await repository.record(value, 200);
  await expect(repository.record({ ...value, score: 1 }, 300)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  const board = await local.repository.leaderboard(value.player, 'marathon', 'all', 0, {
    groupId: -100,
  });
  expect(board.me).toMatchObject({
    score: 43567,
    lines: 60,
    source: 'manual',
    approximate: true,
    durationKnown: false,
  });
  expect(await local.db.get('SELECT count(*) AS total FROM runs')).toEqual({ total: 0 });
  expect(await local.db.get('SELECT count(*) AS total FROM replay_chunks')).toEqual({ total: 0 });
  expect(await local.db.get('SELECT ticks,created_at,operator,reason FROM manual_results')).toEqual(
    { ticks: null, created_at: 100, operator: input.operator, reason: input.reason },
  );
  expect(
    (await local.repository.leaderboard(value.player, 'marathon', 'all', 0, { groupId: -101 })).me,
  ).toBeNull();
  expect((await local.repository.leaderboard(value.player, 'marathon', 'week', 101)).me).toBeNull();
});
it('ranks unknown duration conservatively and keeps one ordering across corrections and games', async () => {
  const local = localRepository();
  handles.push(local);
  const manual = decodeManualResult(input);
  await new SqlManualResultRepository(local.db).record(manual, 100);
  const state = createTetris(1, 'marathon');
  const run = {
    id: 'real-game',
    playerId: 9,
    playerName: 'Соперник',
    mode: 'marathon' as const,
    ruleset: 'tetris-arcade-v1',
    revision: 0,
    state,
    status: 'active' as const,
    createdAt: 200,
    expiresAt: 10000,
    lastSubmission: null,
    groupIds: [-100],
    verifiedOrder: 0,
    verifiedAt: 0,
    socialProcessed: true,
  };
  await local.repository.create(run);
  state.score = 43567;
  state.tick = 60;
  state.status = 'lost';
  await local.repository.save(
    { ...run, state, status: 'verified', revision: 1, verifiedAt: 300 },
    0,
  );
  const saved = await local.repository.get(run.id);
  expect(saved?.verifiedOrder).toBe(2);
  const board = await local.repository.leaderboard(manual.player, 'marathon', 'all', 0);
  expect(board.entries.map((entry) => entry.playerId)).toEqual([9, 8]);
  const before = await local.repository.leaderboard(manual.player, 'marathon', 'all', 0, {
    maxVerifiedOrder: 1,
  });
  expect(before.entries.map((entry) => entry.playerId)).toEqual([8]);
});
it('refuses a Sprint result without known time and malformed correction metadata', () => {
  expect(() => decodeManualResult({ ...input, mode: 'sprint' })).toThrow('точное время');
  expect(() => decodeManualResult({ ...input, operator: '' })).toThrow();
  expect(() => decodeManualResult({ ...input, id: 'ordinary-run' })).toThrow();
});
