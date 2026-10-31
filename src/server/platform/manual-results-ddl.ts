export const MANUAL_RESULTS_DDL = `
CREATE TABLE IF NOT EXISTS manual_results (
 id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,mode TEXT NOT NULL,ruleset TEXT NOT NULL,
 score INTEGER NOT NULL,ticks INTEGER,lines INTEGER NOT NULL,group_ids_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,verified_order INTEGER NOT NULL,reason TEXT NOT NULL,operator TEXT NOT NULL,approximate INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS manual_results_leaderboard ON manual_results(mode,ruleset,score,ticks);
`;
// Both verified games and administrative corrections use the same atomic ordering.
export const NEXT_RESULT_ORDER = `(SELECT COALESCE(MAX(verified_order),0)+1 FROM (
 SELECT verified_order FROM runs UNION ALL SELECT verified_order FROM manual_results
))`;
