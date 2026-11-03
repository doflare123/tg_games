import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { Service2048 } from '../src/server/domain/2048.ts';
import { ADMIN_WEEK_MS, adminWeekStart } from '../src/server/domain/admin.ts';
import { ArcadeService } from '../src/server/domain/arcade.ts';
import { installAdmin } from '../src/server/platform/admin-ddl.ts';
import { verifiedPlayer } from '../src/server/platform/context.ts';
import { Sql2048Repository } from '../src/server/platform/sql-2048.ts';
import { SqlAdminRepository } from '../src/server/platform/sql-admin.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';
import { ADMIN_ACTIONS, ADMIN_TABLES, type AdminAction } from '../src/shared/admin.ts';
import { object } from '../src/shared/errors.ts';

const owner = { id: 930852883, name: 'Owner' };
const other = { id: 42, name: '<script>visitor</script>' };
const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
async function setup() {
  const local = localRepository();
  handles.push(local);
  let now = Date.UTC(2026, 10, 4, 12);
  await installAdmin(local.db, now - 2 * ADMIN_WEEK_MS);
  const admin = new SqlAdminRepository(local.db, () => now);
  const social = new SqlSocialRepository(local.db, local.repository);
  return {
    ...local,
    admin,
    social,
    setNow: (value: number) => {
      now = value;
    },
    now: () => now,
  };
}
async function mutation(
  admin: SqlAdminRepository,
  action: AdminAction,
  target: string,
  key = crypto.randomUUID(),
) {
  const preview = await admin.preview(owner, { action, target });
  return { ...preview, requestId: key, reason: 'Проверенная причина' };
}
it('checks verified identity before any SQL; body identity and maintenance flags grant no access', async () => {
  let queries = 0;
  const noDatabase = async () => {
    queries++;
    throw new Error('Unexpected SQL');
  };
  const admin = new SqlAdminRepository(
    { get: noDatabase, all: noDatabase, run: noDatabase },
    () => 1,
  );
  for (const operation of [
    () => admin.stats(other, { playerId: owner.id }),
    () => admin.list(other, { table: 'groups' }),
    () => admin.preview(other, { action: 'cancel_job' }),
    () => admin.apply(other, { actor_id: owner.id, maintenance: true }),
  ])
    await expect(operation()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(queries).toBe(0);
  expect(() => verifiedPlayer({ maintenance: true, user: owner })).toThrow();
  expect(() =>
    verifiedPlayer({ initData: { user: { id: String(owner.id), first_name: 'Owner' } } }),
  ).toThrow();
  expect(verifiedPlayer({ initData: { user: { id: owner.id, first_name: 'Owner' } } })).toEqual(
    owner,
  );
});
it('requires an explicit complete migration, remains readable before migration and installs idempotently', async () => {
  const local = localRepository();
  handles.push(local);
  const admin = new SqlAdminRepository(local.db, () => Date.UTC(2026, 10, 4));
  await admin.observe(owner);
  await expect(admin.stats(owner, {})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await installAdmin(local.db, 100);
  await installAdmin(local.db, 200);
  expect((await admin.stats(owner, {})).trackingSince).toBe(100);
  await local.db.run('DROP TRIGGER admin_action_cancel_job');
  await expect(admin.list(owner, { table: 'groups' })).rejects.toMatchObject({
    code: 'UNAVAILABLE',
  });
});
it('bounds and validates table browsing and returns no game state, replay or notification payload', async () => {
  const { admin, db } = await setup();
  for (let i = 0; i < 27; i++)
    await db.run('INSERT INTO groups(id,title) VALUES(:id,:name)', {
      ':id': -i - 1,
      ':name': i === 0 ? "O'Brien_%<img>" : `Group ${i}`,
    });
  const first = await admin.list(owner, { table: 'groups', page: 0, search: '' });
  expect(first.rows).toHaveLength(25);
  expect(first.hasMore).toBe(true);
  expect((await admin.list(owner, { table: 'groups', page: 1 })).rows).toHaveLength(2);
  expect(
    (await admin.list(owner, { table: 'groups', search: "O'Brien_%<img>" })).rows,
  ).toHaveLength(1);
  expect((await admin.list(owner, { table: 'groups', search: "' OR 1=1 --" })).rows).toHaveLength(
    0,
  );
  await expect(admin.list(owner, { table: 'groups; DELETE FROM runs' })).rejects.toThrow();
  await expect(admin.list(owner, { table: 'groups', page: -1 })).rejects.toThrow();
  await expect(admin.list(owner, { table: 'groups', page: 4001 })).rejects.toThrow();
  await expect(admin.list(owner, { table: 'groups', search: 'x'.repeat(101) })).rejects.toThrow();
  for (const table of ADMIN_TABLES) {
    const result = await admin.list(owner, { table });
    expect(result.columns).not.toContain('state_json');
    expect(result.columns).not.toContain('payload');
    expect(result.columns).not.toContain('last_submission');
  }
});
it('records visits once per day, deduplicates group status events and compares equal week intervals', async () => {
  const { admin, db, social, now, setNow } = await setup();
  const current = now();
  const start = adminWeekStart(current);
  await admin.observe(other);
  await admin.observe(other);
  await admin.observe(owner);
  const arcade = new ArcadeService(
    new (await import('../src/server/platform/sql-repository.ts')).SqlArcadeRepository(db),
    { now: () => now(), seed: () => 1 },
  );
  await arcade.create(other, { mode: 'marathon', requestId: 'current-week-attempt' });
  setNow(start - ADMIN_WEEK_MS + 1000);
  await admin.observe(other);
  await arcade.create(other, { mode: 'marathon', requestId: 'previous-early-attempt' });
  setNow(start - 1000);
  await arcade.create(other, { mode: 'marathon', requestId: 'previous-late-attempt' });
  setNow(current + 1);
  await social.upsertGroup({ id: -42, title: 'Group', active: true, botAdmin: true });
  await social.upsertGroup({ id: -42, title: 'Renamed', active: true, botAdmin: true });
  await social.upsertGroup({ id: -42, title: 'Renamed', active: false, botAdmin: false });
  expect(await db.get('SELECT count(*) AS total FROM admin_group_events')).toEqual({ total: 0 });
  const added = {
    chat: { id: -42, type: 'supergroup' },
    date: Math.floor(now() / 1000),
    old_chat_member: { status: 'left' },
    new_chat_member: { status: 'member' },
  };
  await admin.observeGroup(added);
  await admin.observeGroup(added);
  await admin.observeGroup({
    ...added,
    old_chat_member: { status: 'member' },
    new_chat_member: { status: 'administrator' },
  });
  await admin.observeGroup({
    ...added,
    old_chat_member: { status: 'member' },
    new_chat_member: { status: 'left' },
  });
  expect(await db.get('SELECT count(*) AS total FROM admin_group_events')).toEqual({ total: 2 });
  const stats = await admin.stats(owner, {});
  expect(stats.weeks[0]).toMatchObject({
    attempts: 1,
    players: 1,
    visitors: 2,
    newVisitors: 1,
    added: 1,
    removed: 1,
  });
  expect(stats.weeks[1]).toMatchObject({ attempts: 2, players: 1, visitors: 1 });
  expect(stats.previousMatched).toMatchObject({ attempts: 1, players: 1, visitors: 1 });
  expect(stats.totals).toMatchObject({ players: 2, groups: 1, activeGroups: 0 });
  expect(stats.games).toEqual([{ game: 'tetris', attempts: 1, results: 0, players: 1 }]);
  const players = await admin.list(owner, { table: 'players', search: String(other.id) });
  expect(players.rows[0]?.attempts).toBe(3); // Visits are not played games.
  expect(adminWeekStart(Date.UTC(2026, 10, 8, 23, 59))).toBe(Date.UTC(2026, 10, 2));
  expect(adminWeekStart(Date.UTC(2026, 10, 9))).toBe(Date.UTC(2026, 10, 9));
});
it('uses an atomic audited compare-and-swap, with idempotent retries and bound reasons', async () => {
  const { admin, db } = await setup();
  await db.run("INSERT INTO groups(id,title,notifications_enabled) VALUES(-42,'Group',1)");
  const request = await mutation(admin, 'disable_notifications', '-42');
  await db.run("UPDATE groups SET title='Changed' WHERE id=-42");
  await expect(admin.apply(owner, request)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await db.get('SELECT count(*) AS total FROM admin_audit')).toEqual({ total: 0 });
  const fresh = {
    ...(await mutation(admin, 'disable_notifications', '-42')),
    reason: "Owner's reason; DROP TABLE groups;",
  };
  const result = await admin.apply(owner, fresh);
  expect(await admin.apply(owner, fresh)).toEqual(result);
  expect(await db.get('SELECT notifications_enabled FROM groups WHERE id=-42')).toEqual({
    notifications_enabled: 0,
  });
  expect(await db.get('SELECT count(*) AS total FROM admin_audit')).toEqual({ total: 1 });
  expect(await db.get('SELECT actor_id,reason FROM admin_audit')).toEqual({
    actor_id: owner.id,
    reason: fresh.reason,
  });
  await expect(admin.apply(owner, { ...fresh, reason: 'Different reason' })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  await expect(
    admin.apply(owner, { ...fresh, requestId: crypto.randomUUID(), before: '{}' }),
  ).rejects.toThrow();
});
it('rolls the audit and modification back together when a trigger fails', async () => {
  const { admin, db } = await setup();
  await db.run("INSERT INTO groups(id,title,notifications_enabled) VALUES(-42,'Group',1)");
  const request = await mutation(admin, 'disable_notifications', '-42');
  await db.run(
    "CREATE TRIGGER reject_admin_change BEFORE UPDATE ON groups BEGIN SELECT RAISE(ABORT,'test failure'); END",
  );
  await expect(admin.apply(owner, request)).rejects.toThrow('test failure');
  expect(await db.get('SELECT notifications_enabled FROM groups WHERE id=-42')).toEqual({
    notifications_enabled: 1,
  });
  expect(await db.get('SELECT count(*) AS total FROM admin_audit')).toEqual({ total: 0 });
});
it('revokes every game without deleting attempts, suppresses its jobs and preserves unrelated records', async () => {
  const { admin, db, database } = await setup();
  const games = [
    ['runs', 'revoke_tetris', 'tetris', 'verified'],
    ['puzzle2048_runs', 'revoke_2048', '2048', 'verified'],
    ['snake_runs', 'revoke_snake', 'snake', 'verified'],
    ['flappy_runs', 'revoke_flappy', 'flappy', 'verified'],
    ['block_blast_runs', 'revoke_block_blast', 'block-blast', 'verified'],
    ['minesweeper_runs', 'revoke_minesweeper', 'minesweeper', 'won'],
    ['manual_results', 'remove_manual', 'tetris', null],
  ] as const;
  for (const [table, action, game, status] of games) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    const names = columns.map((c) => String(c.name));
    const values = columns.map((c) =>
      c.name === 'id'
        ? table
        : c.name === 'player_id'
          ? 42
          : c.name === 'player_name'
            ? 'Player'
            : c.name === 'status'
              ? status
              : c.type === 'INTEGER'
                ? 0
                : '',
    );
    database
      .prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`)
      .run(...values);
    await db.run("INSERT INTO social_jobs VALUES(:id,:payload,'pending',1,10000,0,0,NULL)", {
      ':id': `job-${table}`,
      ':payload': JSON.stringify({ runId: table, game, playerId: 42 }),
    });
    await admin.apply(owner, await mutation(admin, action, table));
    expect(
      await db.get('SELECT status FROM social_jobs WHERE id=:id', { ':id': `job-${table}` }),
    ).toEqual({ status: 'suppressed' });
    expect(await db.get(`SELECT count(*) AS total FROM ${table}`)).toEqual({
      total: table === 'manual_results' ? 0 : 1,
    });
    if (status) expect(await db.get(`SELECT status FROM ${table}`)).toEqual({ status: 'unranked' });
    await expect(admin.preview(owner, { action, target: table })).rejects.toThrow();
  }
  expect(await db.get('SELECT count(*) AS total FROM admin_audit')).toEqual({
    total: games.length,
  });
});
it('keeps revoked verified replay attempts terminal and out of leaderboards', async () => {
  const { admin, db, now } = await setup();
  const service = new Service2048(new Sql2048Repository(db), { now, seed: () => 123 });
  const run = await service.create(other, { requestId: 'revoked-verified-result' });
  await service.submit(other, { runId: run.id, revision: 0, moves: [], finish: true });
  await admin.apply(owner, await mutation(admin, 'revoke_2048', run.id));
  expect((await service.leaderboard(other, { period: 'all' })).me).toBeNull();
  await expect(
    service.submit(other, { runId: run.id, revision: 0, moves: [], finish: true }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await db.get('SELECT status FROM puzzle2048_runs')).toEqual({ status: 'unranked' });
});
it('blocks future ranking updates and suppresses queued notices, while unblock preserves audit and old results', async () => {
  const { admin, db, now } = await setup();
  await admin.observe(other);
  const service = new Service2048(new Sql2048Repository(db), { now, seed: () => 123 });
  const run = await service.create(other, { requestId: 'ranking-block-in-flight' });
  await admin.apply(owner, await mutation(admin, 'block_player', '42'));
  await expect(
    service.submit(other, { runId: run.id, revision: 0, moves: [], finish: true }),
  ).rejects.toThrow('RANKING_BLOCKED');
  await expect(admin.preview(owner, { action: 'block_player', target: '42' })).rejects.toThrow();
  await admin.apply(owner, await mutation(admin, 'unblock_player', '42'));
  expect(
    (await service.submit(other, { runId: run.id, revision: 0, moves: [], finish: true })).status,
  ).toBe('verified');
  expect(await db.get('SELECT count(*) AS total FROM admin_audit')).toEqual({ total: 2 });
});
it('never revives a suppressed job through a worker retry or completion after admin intervention', async () => {
  const { admin, db, social, now } = await setup();
  await social.upsertGroup({ id: -42, title: 'Group', active: true, botAdmin: true });
  await social.notifications(-42, true, now());
  await social.enqueue({
    id: 'queued-job',
    payload: {
      type: 'record',
      chatId: -42,
      playerId: 42,
      game: 'tetris',
      mode: 'marathon',
      runId: 'r',
      rank: 1,
      text: 'Record',
    },
    dueAt: now(),
    expiresAt: now() + 10000,
    attempts: 0,
  });
  const job = await social.claim(now());
  if (!job) throw new Error('Expected job');
  await admin.apply(owner, await mutation(admin, 'disable_notifications', '-42'));
  await social.retry(job, now(), 'Network failure');
  await social.complete(job, 'done');
  expect(await db.get("SELECT status FROM social_jobs WHERE id='queued-job'")).toEqual({
    status: 'suppressed',
  });
  expect(await social.claim(now())).toBeNull();
  const errors = await Promise.all(
    ADMIN_ACTIONS.map((action) =>
      admin.preview(other, { action, target: '42' }).catch((error) => object(error).code),
    ),
  );
  expect(errors.every((code) => code === 'UNAUTHORIZED')).toBe(true);
});

it('cancels only pending jobs, records the original fields and leaves other jobs alone', async () => {
  const { admin, db } = await setup();
  for (const [id, status] of [
    ['pending-one', 'pending'],
    ['running-one', 'running'],
    ['done-one', 'done'],
  ] as const)
    await db.run('INSERT INTO social_jobs VALUES(:id,:payload,:status,1,10000,0,0,NULL)', {
      ':id': id,
      ':payload': '{}',
      ':status': status,
    });
  const request = await mutation(admin, 'cancel_job', 'pending-one');
  await expect(admin.apply(owner, { ...request, reason: '   ' })).rejects.toMatchObject({
    code: 'BAD_INPUT',
  });
  await expect(admin.apply(owner, { ...request, after: '{}' })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  await admin.apply(owner, request);
  expect(await db.get("SELECT status,error FROM social_jobs WHERE id='pending-one'")).toEqual({
    status: 'suppressed',
    error: 'ADMIN_CANCELLED',
  });
  const rows = await admin.list(owner, { table: 'admin_audit' });
  expect(JSON.parse(String(rows.rows[0]?.before_json))).toMatchObject({
    id: 'pending-one',
    status: 'pending',
  });
  for (const target of ['running-one', 'done-one'])
    await expect(admin.preview(owner, { action: 'cancel_job', target })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  expect(await db.get("SELECT status FROM social_jobs WHERE id='running-one'")).toEqual({
    status: 'running',
  });
});

it('skips existing triggers when reinstalling, matching the cloud write/read distinction', async () => {
  const { db, now } = await setup();
  const rejectingNoop = {
    ...db,
    async run(
      sql: string,
      parameters?: import('../src/server/platform/sql-repository.ts').SqlParameters,
    ) {
      const trigger = /CREATE TRIGGER IF NOT EXISTS ([a-z_0-9]+)/.exec(sql)?.[1];
      if (
        trigger &&
        (await db.get("SELECT name FROM sqlite_master WHERE type='trigger' AND name=:name", {
          ':name': trigger,
        }))
      )
        throw new Error('Write query looks like a read one');
      if (sql.startsWith('DROP TRIGGER IF EXISTS')) throw new Error('No-op trigger drop');
      return db.run(sql, parameters);
    },
  };
  await installAdmin(rejectingNoop, now());
  const stats = await new SqlAdminRepository(rejectingNoop, now).stats(owner, {});
  expect(stats.weeks).toHaveLength(8);
});
