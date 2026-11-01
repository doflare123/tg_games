import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { Service2048 } from '../src/server/domain/2048.ts';
import { MinesweeperService } from '../src/server/domain/minesweeper.ts';
import {
  blockRankingAndRemove,
  moderationRequest,
  moderationSnapshot,
} from '../src/server/platform/ranking-moderation.ts';
import { Sql2048Repository } from '../src/server/platform/sql-2048.ts';
import { SqlMineRepository } from '../src/server/platform/sql-minesweeper.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
const player = { id: 42, name: 'Вадим' };
const request = {
  playerId: player.id,
  expectedName: player.name,
  reason: 'Owner requested ranking block',
  removeGames: ['2048', 'minesweeper'],
};
function local() {
  const handle = localRepository();
  handles.push(handle);
  return handle;
}

it('removes every selected result, preserves other players and is safe to repeat', async () => {
  const { db } = local();
  const mines = new MinesweeperService(new SqlMineRepository(db), { now: () => 100 });
  const puzzle = new Service2048(new Sql2048Repository(db), { now: () => 100, seed: () => 123 });
  for (const who of [player, { id: 43, name: 'Другой игрок' }]) {
    for (let i = 0; i < 3; i++) {
      const requestId = `moderation-test-${i}`;
      await puzzle.create(who, { requestId });
      await mines.submit(who, { requestId, size: '9x9', elapsedMs: 1000 + i });
    }
  }
  const snapshot = await moderationSnapshot(db, request);
  expect(snapshot.records['2048']).toHaveLength(3);
  expect(snapshot.records.minesweeper).toHaveLength(3);
  const result = await blockRankingAndRemove(db, request, 200);
  expect(result.removed).toEqual({ '2048': 3, minesweeper: 3 });
  expect(result.remaining.records).toEqual({ '2048': [], minesweeper: [] });
  expect(await db.get('SELECT count(*) AS n FROM puzzle2048_runs WHERE player_id=43')).toEqual({
    n: 3,
  });
  expect(await db.get('SELECT count(*) AS n FROM minesweeper_runs WHERE player_id=43')).toEqual({
    n: 3,
  });
  expect((await blockRankingAndRemove(db, request, 300)).removed).toEqual({
    '2048': 0,
    minesweeper: 0,
  });
  expect(await db.get('SELECT created_at FROM ranking_blocks WHERE player_id=42')).toEqual({
    created_at: 200,
  });
  await expect(
    mines.submit(
      { ...player, name: 'Renamed' },
      {
        requestId: 'moderation-new-result',
        size: '9x9',
        elapsedMs: 500,
      },
    ),
  ).rejects.toThrow('RANKING_BLOCKED');
  const run = await puzzle.create(player, { requestId: 'moderation-new-game' });
  await expect(
    puzzle.submit(player, { runId: run.id, revision: 0, moves: [], finish: true }),
  ).rejects.toThrow('RANKING_BLOCKED');
  expect((await puzzle.leaderboard(player, { period: 'all' })).me).toBeNull();
});

it('blocks inserts and updates across all games, including manual corrections and old runs', async () => {
  const handle = local();
  const tables = [
    ['puzzle2048_runs', 'verified'],
    ['minesweeper_runs', 'won'],
    ['runs', 'verified'],
    ['snake_runs', 'verified'],
    ['manual_results', null],
  ] as const;
  // Seed complete SQL rows to exercise the database boundary independently of services.
  for (const [table] of tables) {
    const columns = handle.database.prepare(`PRAGMA table_info(${table})`).all();
    const names = columns.map((column) => String(column.name));
    const values = columns.map((column) => {
      const name = String(column.name);
      if (name === 'id') return `${table}-old`;
      if (name === 'player_id') return player.id;
      if (name === 'player_name') return player.name;
      if (name === 'status') return 'active';
      return column.type === 'INTEGER' ? 0 : '';
    });
    handle.database
      .prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`)
      .run(...values);
  }
  // Keep old runs so finalization of a game started before the block is checked.
  await blockRankingAndRemove(handle.db, { ...request, playerId: 99 }, 200);
  await handle.db.run("INSERT INTO ranking_blocks VALUES(42,'test',200)");
  for (const [table, ranked] of tables) {
    const columns = handle.database.prepare(`PRAGMA table_info(${table})`).all();
    const names = columns.map((column) => String(column.name));
    const select = names.map((name) =>
      name === 'id' ? "id||'-new'" : name === 'status' ? `'${ranked}'` : name,
    );
    await expect(
      handle.db.run(
        `INSERT INTO ${table}(${names.join(',')}) SELECT ${select.join(',')} FROM ${table}`,
      ),
    ).rejects.toThrow('RANKING_BLOCKED');
    await expect(
      handle.db.run(
        `UPDATE ${table} SET ${ranked ? `status='${ranked}'` : 'score=1'} WHERE player_id=42`,
      ),
    ).rejects.toThrow('RANKING_BLOCKED');
    if (ranked) {
      await handle.db.run(`UPDATE ${table} SET player_id=43,status='${ranked}' WHERE player_id=42`);
      await expect(
        handle.db.run(`UPDATE ${table} SET player_id=42 WHERE player_id=43`),
      ).rejects.toThrow('RANKING_BLOCKED');
    }
  }
});

it('suppresses queued notifications and prevents delayed retries from reviving them', async () => {
  const { db } = local();
  const job = (id: number) =>
    db.run(
      `INSERT INTO social_jobs
    (id,payload,status,due_at,expires_at,attempts,lease_until,error)
    VALUES(:id,:payload,'pending',1,1000,0,0,NULL)`,
      {
        ':id': `job-${id}`,
        ':payload': JSON.stringify({ playerId: id, game: '2048' }),
      },
    );
  await job(42);
  await job(43);
  expect((await blockRankingAndRemove(db, request, 200)).suppressed).toBe(1);
  await db.run("UPDATE social_jobs SET status='pending' WHERE id='job-42'");
  await db.run("DELETE FROM social_jobs WHERE id='job-42'");
  await job(42);
  expect(await db.get("SELECT status FROM social_jobs WHERE id='job-42'")).toEqual({
    status: 'suppressed',
  });
  expect(await db.get("SELECT status FROM social_jobs WHERE id='job-43'")).toEqual({
    status: 'pending',
  });
});

it('rejects invalid identities, SQL identifiers and a mismatched reviewed name before changes', async () => {
  expect(() => moderationRequest({ ...request, playerId: '42' })).toThrow();
  expect(() =>
    moderationRequest({ ...request, removeGames: ['runs; DELETE FROM runs'] }),
  ).toThrow();
  const { db } = local();
  await new Service2048(new Sql2048Repository(db), { now: () => 100, seed: () => 123 }).create(
    player,
    { requestId: 'moderation-identity' },
  );
  await expect(
    blockRankingAndRemove(db, { ...request, expectedName: 'Другой' }, 200),
  ).rejects.toThrow('identity');
  expect(
    await db.get("SELECT name FROM sqlite_master WHERE name='ranking_blocks'"),
  ).toBeUndefined();
  expect(await db.get('SELECT count(*) AS n FROM puzzle2048_runs')).toEqual({ n: 1 });
});
