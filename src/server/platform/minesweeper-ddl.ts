// Used only by the local SQLite adapter. Production schema is declared in schema.ts.
export const MINESWEEPER_DDL = `
CREATE TABLE IF NOT EXISTS minesweeper_runs (
  id TEXT PRIMARY KEY, player_id INTEGER NOT NULL, player_name TEXT NOT NULL,
  ruleset TEXT NOT NULL, size TEXT NOT NULL, revision INTEGER NOT NULL,
  state_json TEXT NOT NULL, status TEXT NOT NULL, first_cell INTEGER NOT NULL,
  started_at INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL, last_action TEXT
);
CREATE INDEX IF NOT EXISTS minesweeper_leaderboard
  ON minesweeper_runs(size,ruleset,status,elapsed_ms);
CREATE INDEX IF NOT EXISTS minesweeper_recent ON minesweeper_runs(player_id,started_at);
`;
