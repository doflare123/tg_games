import { object, text } from '../../shared/errors.ts';
import { OWNER_ID } from '../domain/admin.ts';
import type { SqlDatabase } from './sql-repository.ts';

export const SUPPORT_THREAD_COLUMNS = {
  read_order: 'INTEGER NOT NULL DEFAULT 0',
  closed: 'INTEGER NOT NULL DEFAULT 0',
};
// Message insertion order avoids timestamp ties and late delivery of an older reply.
export const SUPPORT_THREAD_SELECT = `SELECT t.*,CASE
  WHEN last_incoming_order>read_order THEN 'new'
  WHEN last_incoming_order>last_answer_order THEN 'waiting'
  ELSE 'answered' END AS thread_status FROM (
  SELECT s.*,COALESCE((SELECT MAX(m.rowid) FROM support_messages m
    WHERE m.thread_id=s.id AND m.direction='player'),0) AS last_incoming_order,
  COALESCE((SELECT MAX(m.rowid) FROM support_messages m JOIN communication_jobs j ON j.id=m.id
    WHERE m.thread_id=s.id AND m.direction='owner' AND j.status='sent'),0) AS last_answer_order
  FROM support_cases s) t`;

export const SUPPORT_THREAD_BACKFILL = `UPDATE support_threads SET read_order=COALESCE(
  (SELECT MAX(p.rowid) FROM support_messages p WHERE p.player_id=support_threads.player_id
    AND p.direction='player' AND p.rowid<(SELECT MAX(o.rowid) FROM support_messages o
      WHERE o.player_id=support_threads.player_id AND o.direction='owner')),0)`;

export const COMMUNICATION_SCHEMA = [
  // Retained as the source for idempotent upgrades of the old one-dialog-per-player schema.
  `CREATE TABLE IF NOT EXISTS support_threads(player_id INTEGER PRIMARY KEY,player_name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,read_order INTEGER NOT NULL DEFAULT 0,closed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS support_cases(id INTEGER PRIMARY KEY AUTOINCREMENT,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,read_order INTEGER NOT NULL DEFAULT 0,closed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS support_cases_active ON support_cases(player_id) WHERE closed=0`,
  `CREATE TABLE IF NOT EXISTS communication_attachments(id TEXT PRIMARY KEY,media_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_messages(id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,thread_id INTEGER,player_name TEXT NOT NULL DEFAULT 'Игрок',direction TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS support_messages_player ON support_messages(player_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS communication_sessions(actor_id INTEGER PRIMARY KEY,data_json TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broadcasts(id TEXT PRIMARY KEY,body TEXT NOT NULL,group_ids_json TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,confirmed_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS communication_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,player_id INTEGER NOT NULL,chat_id INTEGER NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,due_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,telegram_message_id INTEGER,error TEXT,created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS communication_jobs_due ON communication_jobs(status,due_at,lease_until)`,
  `CREATE INDEX IF NOT EXISTS communication_jobs_reply ON communication_jobs(chat_id,telegram_message_id)`,
];
export const SUPPORT_CASE_BACKFILL = [
  `INSERT INTO support_cases(id,player_id,player_name,created_at,updated_at,read_order,closed)
    SELECT player_id,player_id,player_name,created_at,updated_at,read_order,closed FROM support_threads
    WHERE 1 ON CONFLICT(id) DO NOTHING`,
  `UPDATE support_messages SET thread_id=player_id WHERE thread_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS support_messages_thread ON support_messages(thread_id)`,
];
export const COMMUNICATION_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS support_thread_activity BEFORE INSERT ON support_messages
    WHEN NEW.direction='owner' BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM support_cases
      WHERE id=NEW.thread_id AND player_id=NEW.player_id AND closed=0)
      THEN RAISE(ABORT,'Support case closed or missing') END;
  END`,
  `CREATE TRIGGER IF NOT EXISTS support_message_delivery AFTER INSERT ON support_messages BEGIN
    INSERT INTO support_cases(player_id,player_name,created_at,updated_at)
      SELECT NEW.player_id,NEW.player_name,NEW.created_at,NEW.created_at
      WHERE NEW.direction='player' AND NOT EXISTS(SELECT 1 FROM support_cases WHERE player_id=NEW.player_id AND closed=0);
    UPDATE support_messages SET thread_id=(SELECT id FROM support_cases WHERE player_id=NEW.player_id AND closed=0)
      WHERE id=NEW.id AND NEW.direction='player';
    UPDATE support_cases SET updated_at=MAX(updated_at,NEW.created_at),
      player_name=CASE WHEN NEW.direction='player' THEN NEW.player_name ELSE player_name END,
      read_order=CASE WHEN NEW.direction='owner' THEN MAX(read_order,COALESCE((SELECT MAX(rowid) FROM support_messages
        WHERE thread_id=support_cases.id AND direction='player' AND rowid<NEW.rowid),0)) ELSE read_order END
      WHERE id=(SELECT thread_id FROM support_messages WHERE id=NEW.id);
    INSERT INTO communication_jobs(id,kind,player_id,chat_id,body,status,due_at,expires_at,created_at)
    VALUES(NEW.id,CASE NEW.direction WHEN 'player' THEN 'owner_inbox' ELSE 'player_reply' END,NEW.player_id,
      CASE NEW.direction WHEN 'player' THEN ${OWNER_ID} ELSE NEW.player_id END,
      CASE NEW.direction WHEN 'player' THEN '✉️ Обращение от '||(SELECT player_name FROM support_cases WHERE id=(SELECT thread_id FROM support_messages WHERE id=NEW.id))||' · '||NEW.player_id||char(10)||char(10)||NEW.body ELSE 'Ответ владельца Arcade:'||char(10)||char(10)||NEW.body END,
      'pending',NEW.created_at,NEW.created_at+86400000,NEW.created_at);
  END`,
  `CREATE TRIGGER IF NOT EXISTS broadcast_delivery AFTER UPDATE OF status ON broadcasts
    WHEN NEW.status='queued' AND OLD.status='draft' BEGIN
    INSERT INTO communication_jobs(id,kind,player_id,chat_id,body,status,due_at,expires_at,created_at)
      SELECT 'broadcast:'||NEW.id||':'||g.id,'broadcast',0,g.id,NEW.body,'pending',NEW.confirmed_at,NEW.confirmed_at+86400000,NEW.confirmed_at
      FROM groups g WHERE g.active=1 AND g.id IN(SELECT value FROM json_each(NEW.group_ids_json));
  END`,
  `CREATE TRIGGER IF NOT EXISTS broadcast_cancel AFTER UPDATE OF status ON broadcasts
    WHEN NEW.status='cancelled' BEGIN
    UPDATE communication_jobs SET status='cancelled',lease_until=0,error='Cancelled by owner'
      WHERE kind='broadcast' AND id LIKE 'broadcast:'||NEW.id||':%' AND status IN ('pending','running');
  END`,
];
// Explicit operator migration; builds/tests only install this into local SQLite.
export async function installCommunications(db: SqlDatabase): Promise<void> {
  const rows = await db.all("SELECT name,sql FROM sqlite_master WHERE type='trigger'");
  if (!Array.isArray(rows)) throw new Error('Invalid trigger inventory');
  const existing = new Map(
    rows.map((row) => {
      const r = object(row);
      return [text(r.name, 1, 200), text(r.sql, 1, 30000)];
    }),
  );
  for (const sql of COMMUNICATION_SCHEMA) await db.run(sql);
  const columns = await db.all("SELECT name FROM pragma_table_info('support_threads')");
  if (!Array.isArray(columns)) throw new Error('Invalid support thread columns');
  const names = new Set(columns.map((row) => text(object(row).name, 1, 200)));
  for (const [name, definition] of Object.entries(SUPPORT_THREAD_COLUMNS)) {
    if (names.has(name)) continue;
    await db.run(`ALTER TABLE support_threads ADD COLUMN ${name} ${definition}`);
    if (name === 'read_order') await db.run(SUPPORT_THREAD_BACKFILL);
  }
  const messageColumns = await db.all("SELECT name FROM pragma_table_info('support_messages')");
  if (!Array.isArray(messageColumns)) throw new Error('Invalid support message columns');
  if (!messageColumns.some((row) => object(row).name === 'thread_id'))
    await db.run('ALTER TABLE support_messages ADD COLUMN thread_id INTEGER');
  if (!messageColumns.some((row) => object(row).name === 'player_name'))
    await db.run(
      "ALTER TABLE support_messages ADD COLUMN player_name TEXT NOT NULL DEFAULT 'Игрок'",
    );
  for (const sql of SUPPORT_CASE_BACKFILL) await db.run(sql);
  for (const sql of COMMUNICATION_TRIGGERS) {
    const trigger = /CREATE TRIGGER IF NOT EXISTS ([a-z_0-9]+)/.exec(sql)?.[1];
    if (trigger && existing.has(trigger)) {
      if (trigger !== 'support_thread_activity' && trigger !== 'support_message_delivery') continue;
      const normalize = (value: string) =>
        value.replace('IF NOT EXISTS ', '').replace(/\s+/g, ' ').trim();
      if (normalize(existing.get(trigger) ?? '') === normalize(sql)) continue;
      await db.run(`DROP TRIGGER ${trigger}`);
    }
    await db.run(sql);
  }
}
