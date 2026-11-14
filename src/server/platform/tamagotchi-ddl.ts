// Local SQLite only; the production declaration lives in schema.ts.
export const TAMAGOTCHI_DDL = `CREATE TABLE IF NOT EXISTS pet_events (
 event_order INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
 player_id INTEGER NOT NULL,player_name TEXT NOT NULL,revision INTEGER NOT NULL,
 request_id TEXT NOT NULL,receipt TEXT NOT NULL,state_json TEXT NOT NULL,
 score INTEGER NOT NULL,created_at INTEGER NOT NULL,social_processed INTEGER NOT NULL,
 UNIQUE(player_id,revision),UNIQUE(player_id,request_id)
);
CREATE INDEX IF NOT EXISTS pet_events_player ON pet_events(player_id,revision);
CREATE INDEX IF NOT EXISTS pet_events_board ON pet_events(score,created_at);
CREATE INDEX IF NOT EXISTS pet_events_social ON pet_events(social_processed,event_order);`;
