import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';
import { returnedRows } from '../src/server/platform/sql-write.ts';

const handles: ReturnType<typeof localRepository>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
it('upgrades legacy local group settings and persists a topic across reopenings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tg-games-topics-'));
  directories.push(directory);
  const file = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(file);
  try {
    legacy.exec(`CREATE TABLE groups(id INTEGER PRIMARY KEY,title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,bot_admin INTEGER NOT NULL DEFAULT 0,
      notifications_enabled INTEGER NOT NULL DEFAULT 0,enabled_at INTEGER NOT NULL DEFAULT 0,
      next_notification_at INTEGER NOT NULL DEFAULT 0,last_notification_job TEXT NOT NULL DEFAULT '');
      INSERT INTO groups VALUES(-42,'Legacy',1,1,1,123,456,'record:old');`);
  } finally {
    legacy.close();
  }
  const local = localRepository(file);
  handles.push(local);
  const social = new SqlSocialRepository(local.db, local.repository);
  expect(await local.db.get('SELECT * FROM groups WHERE id=-42')).toEqual({
    id: -42,
    title: 'Legacy',
    active: 1,
    bot_admin: 1,
    notifications_enabled: 1,
    enabled_at: 123,
    next_notification_at: 456,
    last_notification_job: 'record:old',
    notification_thread_id: null,
  });
  await social.notifications(-42, true, 999, 77);
  handles.pop();
  local.close();
  const reopened = localRepository(file);
  handles.push(reopened);
  expect(await new SqlSocialRepository(reopened.db, reopened.repository).group(-42)).toMatchObject({
    notificationsEnabled: true,
    notificationThreadId: 77,
    enabledAt: 123,
    nextNotificationAt: 456,
  });
});
it('rejects writes through read methods just like tgcloud, without changing data', async () => {
  const local = localRepository();
  handles.push(local);
  const sql = "INSERT INTO groups(id,title) VALUES(-42,'Probe') RETURNING id";
  await expect(local.db.get(sql)).rejects.toThrow();
  await expect(local.db.all(sql)).rejects.toThrow();
  expect(await local.db.get('SELECT count(*) AS total FROM groups')).toEqual({ total: 0 });
  // A rejected read must not leave the connection read-only.
  expect(returnedRows(await local.db.run(sql))).toEqual([{ id: -42 }]);
});
it('returns tgcloud write envelopes for RETURNING and an empty row list for a failed CAS', async () => {
  const local = localRepository();
  handles.push(local);
  const inserted = await local.db.run(
    "INSERT INTO groups(id,title) VALUES(-42,'Probe') RETURNING id",
  );
  expect(inserted).toMatchObject({ rowsAffected: 1, rows: [{ id: -42 }] });
  const missed = await local.db.run("UPDATE groups SET title='Changed' WHERE id=-43 RETURNING id");
  expect(missed).toMatchObject({ rowsAffected: 0, rows: [] });
});
