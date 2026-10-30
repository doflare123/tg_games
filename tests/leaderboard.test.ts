import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import { RULESET } from '../src/games/tetris/types.ts';
import type { StoredRun } from '../src/server/domain/repository.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});
it('ranks the best run per player, uses stable ties and filters the period', async () => {
  const local = localRepository();
  handles.push(local);
  async function insert(
    id: string,
    playerId: number,
    score: number,
    ticks: number,
    createdAt: number,
  ) {
    const state = createTetris(1, 'marathon');
    Object.assign(state, { score, tick: ticks, status: 'lost' });
    const run: StoredRun = {
      id,
      playerId,
      playerName: `Игрок ${playerId}`,
      mode: 'marathon',
      ruleset: RULESET,
      revision: 1,
      state,
      status: 'verified',
      createdAt,
      expiresAt: 999999,
      lastSubmission: null,
      groupIds: [],
      verifiedOrder: 0,
      verifiedAt: 0,
      socialProcessed: true,
    };
    await local.repository.create(run);
  }
  await insert('a', 1, 100, 60, 100);
  await insert('b', 1, 200, 120, 200);
  await insert('c', 2, 200, 60, 300);
  await insert('d', 3, 200, 60, 400);
  const board = await local.repository.leaderboard(
    { id: 1, name: 'Игрок 1' },
    'marathon',
    'all',
    0,
  );
  expect(board.entries.map((e) => e.runId)).toEqual(['c', 'd', 'b']);
  expect(board.me?.rank).toBe(3);
  const week = await local.repository.leaderboard(
    { id: 1, name: 'Игрок 1' },
    'marathon',
    'week',
    350,
  );
  expect(week.entries.map((e) => e.runId)).toEqual(['d']);
  expect(week.me).toBeNull();
});
it('returns a player’s position even outside the first fifty', async () => {
  const local = localRepository();
  handles.push(local);
  for (let i = 1; i <= 60; i++) {
    const state = createTetris(i, 'ultra');
    state.score = 100 - i;
    state.status = 'won';
    await local.repository.create({
      id: `r${i}`,
      playerId: i,
      playerName: `P${i}`,
      mode: 'ultra',
      ruleset: RULESET,
      revision: 1,
      state,
      status: 'verified',
      createdAt: i,
      expiresAt: 9999,
      lastSubmission: null,
      groupIds: [],
      verifiedOrder: 0,
      verifiedAt: 0,
      socialProcessed: true,
    });
  }
  const board = await local.repository.leaderboard({ id: 60, name: 'P60' }, 'ultra', 'all', 0);
  expect(board.entries).toHaveLength(50);
  expect(board.me?.rank).toBe(60);
});
