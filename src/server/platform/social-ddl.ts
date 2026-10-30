export const SOCIAL_DDL = `
CREATE INDEX IF NOT EXISTS runs_verified_order ON runs(verified_order);
CREATE INDEX IF NOT EXISTS runs_pending_social ON runs(status,social_processed,verified_order);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY,title TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,
 bot_admin INTEGER NOT NULL DEFAULT 0,notifications_enabled INTEGER NOT NULL DEFAULT 0,enabled_at INTEGER NOT NULL DEFAULT 0,
 next_notification_at INTEGER NOT NULL DEFAULT 0,last_notification_job TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS group_memberships(id TEXT PRIMARY KEY,group_id INTEGER NOT NULL,user_id INTEGER NOT NULL,active INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS memberships_user ON group_memberships(user_id,active);
CREATE INDEX IF NOT EXISTS memberships_group ON group_memberships(group_id);
CREATE TABLE IF NOT EXISTS social_jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,due_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL,lease_until INTEGER NOT NULL,error TEXT);
CREATE INDEX IF NOT EXISTS social_jobs_due ON social_jobs(status,due_at,lease_until);

`;
export const RUN_SOCIAL_COLUMNS = {
  group_ids_json: "TEXT NOT NULL DEFAULT '[]'",
  verified_order: 'INTEGER NOT NULL DEFAULT 0',
  verified_at: 'INTEGER NOT NULL DEFAULT 0',
  social_processed: 'INTEGER NOT NULL DEFAULT 1',
} as const;
