export const DDL_2048 = `
CREATE TABLE IF NOT EXISTS puzzle2048_runs (
 id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,ruleset TEXT NOT NULL,
 revision INTEGER NOT NULL,state_json TEXT NOT NULL,status TEXT NOT NULL,score INTEGER NOT NULL,
 max_tile INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_submission TEXT
);
CREATE INDEX IF NOT EXISTS puzzle2048_leaderboard ON puzzle2048_runs(status,ruleset,score,created_at);
CREATE INDEX IF NOT EXISTS puzzle2048_recent ON puzzle2048_runs(player_id,created_at);
`;
// Existing results stay processed; newly completed games opt into announcements.
export const SOCIAL_2048_COLUMNS = {
  verified_at: 'INTEGER NOT NULL DEFAULT 0',
  verified_order: 'INTEGER NOT NULL DEFAULT 0',
  social_processed: 'INTEGER NOT NULL DEFAULT 1',
} as const;
export const SOCIAL_2048_INDEXES = `
CREATE INDEX IF NOT EXISTS puzzle2048_verified_order ON puzzle2048_runs(verified_order);
CREATE INDEX IF NOT EXISTS puzzle2048_pending_social ON puzzle2048_runs(status,social_processed,verified_order);
`;
