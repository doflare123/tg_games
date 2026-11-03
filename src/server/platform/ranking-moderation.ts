import { integer, object, oneOf, text } from '../../shared/errors.ts';
import type { SqlDatabase } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

const GAME_TABLES = {
  '2048': 'puzzle2048_runs',
  minesweeper: 'minesweeper_runs',
} as const;
const RANKED_TABLES = [
  ['puzzle2048_runs', 'verified'],
  ['minesweeper_runs', 'won'],
  ['runs', 'verified'],
  ['snake_runs', 'verified'],
  ['flappy_runs', 'verified'],
  ['block_blast_runs', 'verified'],
  ['manual_results', null],
] as const;

// Installed only by explicit operator action (CLI moderation or admin:install),
// never by build/check or a public endpoint. Local dev uses its own SQLite.
// SQLite enforces the block for deployed code, in-flight runs and manual corrections.
export const RANKING_BLOCK_DDL = [
  `CREATE TABLE IF NOT EXISTS ranking_blocks (
    player_id INTEGER PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL
  )`,
  ...RANKED_TABLES.flatMap(([table, status]) =>
    ['INSERT', 'UPDATE'].map(
      (event) => `CREATE TRIGGER IF NOT EXISTS ranking_block_${table}_${event.toLowerCase()}
      BEFORE ${event === 'UPDATE' && status ? 'UPDATE OF player_id,status' : event} ON ${table}
      WHEN ${status ? `NEW.status='${status}' AND ` : ''}EXISTS (
        SELECT 1 FROM ranking_blocks WHERE player_id=NEW.player_id
      ) BEGIN SELECT RAISE(ABORT,'RANKING_BLOCKED'); END`,
    ),
  ),
  ...['INSERT', 'UPDATE'].map(
    (event) => `CREATE TRIGGER IF NOT EXISTS ranking_block_notifications_${event.toLowerCase()}
    AFTER ${event} ON social_jobs
    WHEN NEW.status IN ('pending','running') AND EXISTS (
      SELECT 1 FROM ranking_blocks WHERE player_id=json_extract(NEW.payload,'$.playerId')
    ) BEGIN UPDATE social_jobs SET status='suppressed',lease_until=0,error='RANKING_BLOCKED'
      WHERE id=NEW.id; END`,
  ),
];

export function moderationRequest(input: unknown) {
  const data = object(input);
  const playerId = integer(data.playerId, 1, Number.MAX_SAFE_INTEGER);
  const expectedName = text(data.expectedName, 1, 100);
  const reason = text(data.reason, 1, 300);
  if (!Array.isArray(data.removeGames) || data.removeGames.length === 0)
    throw new Error('Specify games whose results should be removed');
  const removeGames = [
    ...new Set(data.removeGames.map((game) => oneOf(game, ['2048', 'minesweeper']))),
  ];
  return { playerId, expectedName, reason, removeGames };
}

export async function moderationSnapshot(db: SqlDatabase, input: unknown) {
  const request = moderationRequest(input);
  const parameters = { ':player': request.playerId };
  const records: Record<string, unknown[]> = {};
  for (const game of request.removeGames) {
    const rows = await db.all(
      `SELECT * FROM ${GAME_TABLES[game]} WHERE player_id=:player`,
      parameters,
    );
    if (!Array.isArray(rows)) throw new Error('Invalid moderation snapshot');
    if (rows.some((row) => object(row).player_name !== request.expectedName))
      throw new Error('Player name differs from the reviewed identity');
    records[game] = rows;
  }
  return {
    request,
    records,
    jobs: await db.all(
      "SELECT * FROM social_jobs WHERE json_extract(payload,'$.playerId')=:player",
      parameters,
    ),
  };
}

export async function blockRankingAndRemove(db: SqlDatabase, input: unknown, now: number) {
  const { request } = await moderationSnapshot(db, input);
  integer(now, 0, Number.MAX_SAFE_INTEGER);
  for (const statement of RANKING_BLOCK_DDL) await db.run(statement);
  const parameters = { ':player': request.playerId };
  await db.run(
    `INSERT INTO ranking_blocks(player_id,reason,created_at) VALUES(:player,:reason,:now)
    ON CONFLICT(player_id) DO NOTHING`,
    { ...parameters, ':reason': request.reason, ':now': now },
  );
  const suppressed = returnedRows(
    await db.run(
      `UPDATE social_jobs SET status='suppressed',lease_until=0,error='RANKING_BLOCKED'
      WHERE json_extract(payload,'$.playerId')=:player AND status IN ('pending','running')
      RETURNING id`,
      parameters,
    ),
  ).length;
  const removed: Record<string, number> = {};
  for (const game of request.removeGames) {
    removed[game] = returnedRows(
      await db.run(
        `DELETE FROM ${GAME_TABLES[game]} WHERE player_id=:player RETURNING id`,
        parameters,
      ),
    ).length;
  }
  return {
    playerId: request.playerId,
    removed,
    suppressed,
    block: await db.get('SELECT * FROM ranking_blocks WHERE player_id=:player', parameters),
    triggers: await db.all(
      "SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'ranking_block_%' ORDER BY name",
    ),
    remaining: await moderationSnapshot(db, input),
  };
}
