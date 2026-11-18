// Local fixtures only; production schema changes remain an explicit operator action.
export const DOOM_DDL = `
CREATE TABLE IF NOT EXISTS doom_runs (
 id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,ruleset TEXT NOT NULL,
 skill TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,accepted_ticks INTEGER NOT NULL DEFAULT 0,
 verified_ticks INTEGER NOT NULL DEFAULT 0,continuous INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'active',
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,session_tick INTEGER NOT NULL DEFAULT 0,session_at INTEGER NOT NULL,
 breaks_json TEXT NOT NULL DEFAULT '[]',commands_json TEXT NOT NULL DEFAULT '[]',last_submission TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS doom_runs_player ON doom_runs(player_id,created_at);
CREATE INDEX IF NOT EXISTS doom_runs_pending ON doom_runs(status,retry_at,lease_until);
CREATE TABLE IF NOT EXISTS doom_results (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,ruleset TEXT NOT NULL,
 skill TEXT NOT NULL,target TEXT NOT NULL,category TEXT NOT NULL,ticks INTEGER NOT NULL,
 created_at INTEGER NOT NULL,verified_at INTEGER NOT NULL,verified_order INTEGER NOT NULL,social_processed INTEGER NOT NULL DEFAULT 0,
 start_tick INTEGER NOT NULL,end_tick INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS doom_results_board ON doom_results(ruleset,skill,target,category,ticks);
CREATE INDEX IF NOT EXISTS doom_results_social ON doom_results(social_processed,verified_order);
`;
