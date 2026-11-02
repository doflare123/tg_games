import { object, text } from '../../shared/errors.ts';
import { ADMIN_OPERATIONS } from './admin-definitions.ts';
import { RANKING_BLOCK_DDL } from './ranking-moderation.ts';
import type { SqlDatabase } from './sql-repository.ts';

export const ADMIN_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS admin_meta(id TEXT PRIMARY KEY,installed_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_visits(id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,day INTEGER NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS admin_visits_day ON admin_visits(day,player_id)`,
  `CREATE INDEX IF NOT EXISTS admin_visits_player ON admin_visits(player_id,first_seen)`,
  `CREATE TABLE IF NOT EXISTS admin_group_events(id INTEGER PRIMARY KEY AUTOINCREMENT,group_id INTEGER NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS admin_events_at ON admin_group_events(at,kind)`,
  `CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at)`,
];
export const ADMIN_TRIGGER_DDL = [
  ...Object.entries(ADMIN_OPERATIONS).map(
    ([action, definition]) =>
      `CREATE TRIGGER IF NOT EXISTS admin_action_${action} AFTER INSERT ON admin_audit WHEN NEW.action='${action}' BEGIN ${definition.statements} END`,
  ),
];
export const ADMIN_REQUIRED_TRIGGERS = [...ADMIN_TRIGGER_DDL, ...RANKING_BLOCK_DDL].flatMap(
  (sql) => {
    const name = /CREATE TRIGGER IF NOT EXISTS ([a-z_0-9]+)/.exec(sql)?.[1];
    return name ? [name] : [];
  },
);
// Explicit management migration only. Neither endpoint reads nor builds install DDL.
export async function installAdmin(db: SqlDatabase, now: number): Promise<void> {
  const rows = await db.all("SELECT name FROM sqlite_master WHERE type='trigger'");
  if (!Array.isArray(rows)) throw new Error('Invalid trigger inventory');
  const existing = new Set(rows.map((row) => text(object(row).name, 1, 200)));
  // Cloud SQLite classifies a no-op CREATE TRIGGER as a read statement and
  // rejects it through db.run. Skip it before issuing the write.
  for (const sql of [...ADMIN_SCHEMA_DDL, ...RANKING_BLOCK_DDL, ...ADMIN_TRIGGER_DDL]) {
    const trigger = /CREATE TRIGGER IF NOT EXISTS ([a-z_0-9]+)/.exec(sql)?.[1];
    if (trigger && existing.has(trigger)) continue;
    await db.run(sql);
    if (trigger) existing.add(trigger);
  }
  // Discard pre-release discovery triggers: discovery is not a Telegram join event.
  for (const name of ['admin_group_insert', 'admin_group_update']) {
    if (existing.has(name)) await db.run(`DROP TRIGGER ${name}`);
  }
  await db.run(
    "INSERT INTO admin_meta(id,installed_at) VALUES('v1',:now) ON CONFLICT(id) DO NOTHING",
    { ':now': now },
  );
}
