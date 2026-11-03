// Local database only. Live migrations are a separate operator action.
export const BLOCK_BLAST_DDL = `CREATE TABLE IF NOT EXISTS block_blast_runs (
 id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,ruleset TEXT NOT NULL,
 revision INTEGER NOT NULL,state_json TEXT NOT NULL,status TEXT NOT NULL,score INTEGER NOT NULL,
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_submission TEXT,
 verified_at INTEGER NOT NULL DEFAULT 0,verified_order INTEGER NOT NULL DEFAULT 0,social_processed INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS block_blast_leaderboard ON block_blast_runs(ruleset,status,score,created_at);
CREATE INDEX IF NOT EXISTS block_blast_recent ON block_blast_runs(player_id,created_at);
CREATE INDEX IF NOT EXISTS block_blast_verified_order ON block_blast_runs(verified_order);
CREATE INDEX IF NOT EXISTS block_blast_pending_social ON block_blast_runs(status,social_processed,verified_order);
`;
