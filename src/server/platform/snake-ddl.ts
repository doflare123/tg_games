// Local database only. Production migrations use schema.ts explicitly.
export const SNAKE_DDL = `CREATE TABLE IF NOT EXISTS snake_runs (
  id TEXT PRIMARY KEY, player_id INTEGER NOT NULL, player_name TEXT NOT NULL,
  ruleset TEXT NOT NULL, size INTEGER NOT NULL, revision INTEGER NOT NULL,
  state_json TEXT NOT NULL, status TEXT NOT NULL, score INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_submission TEXT
);
CREATE INDEX IF NOT EXISTS snake_leaderboard ON snake_runs(ruleset,size,status,score,created_at);
CREATE INDEX IF NOT EXISTS snake_recent ON snake_runs(player_id,created_at);`;
// Leave historical results processed: enabling announcements must not replay old records.
export const SNAKE_SOCIAL_COLUMNS = {
  verified_at: 'INTEGER NOT NULL DEFAULT 0',
  verified_order: 'INTEGER NOT NULL DEFAULT 0',
  social_processed: 'INTEGER NOT NULL DEFAULT 1',
} as const;
export const SNAKE_SOCIAL_INDEXES = `
CREATE INDEX IF NOT EXISTS snake_verified_order ON snake_runs(verified_order);
CREATE INDEX IF NOT EXISTS snake_pending_social ON snake_runs(status,social_processed,verified_order);`;
