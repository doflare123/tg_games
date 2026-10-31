import {
  LEVELS,
  MINE_LIMIT_MS,
  MINE_RULESET,
  type MineSize,
  SIZES,
} from '../../games/minesweeper/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { integer, object, oneOf, text } from '../../shared/errors.ts';
import { decodeMineLeaderboard, type MineLeaderboard } from '../../shared/minesweeper.ts';
import type { MineRepository, StoredMineRun } from '../domain/minesweeper.ts';
import type { SqlDatabase, SqlParameters } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

function decodeStored(value: unknown): StoredMineRun {
  const r = object(value);
  const state = object(JSON.parse(text(r.state_json, 1, 20000)));
  const size = oneOf(r.size, SIZES);
  const { width, height } = LEVELS[size];
  const total = width * height;
  function array(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length !== total) throw new Error('Invalid mine state');
    return value;
  }
  function bool(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Invalid mine flag');
    return value;
  }
  if (state.size !== size || state.status !== r.status) throw new Error('Invalid mine state');
  const initialFlags = state.initialFlags ?? [];
  if (!Array.isArray(initialFlags) || initialFlags.length > total)
    throw new Error('Invalid initial flags');
  return {
    id: text(r.id, 1, 100),
    playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
    playerName: text(r.player_name, 1, 100),
    ruleset: text(r.ruleset),
    revision: integer(r.revision, 0, 20000),
    state: {
      size,
      cells: array(state.cells).map((v) => integer(v, -1, 8)),
      revealed: array(state.revealed).map(bool),
      flags: array(state.flags).map(bool),
      status: oneOf(state.status, ['playing', 'won', 'lost']),
    },
    firstCell: integer(r.first_cell, 0, total - 1),
    initialFlags: initialFlags.map((cell) => integer(cell, 0, total - 1)),
    startedAt: integer(r.started_at, 0, Number.MAX_SAFE_INTEGER),
    elapsedMs: integer(r.elapsed_ms, 0, MINE_LIMIT_MS),
    lastAction: r.last_action === null ? null : text(r.last_action, 1, 200),
  };
}
function params(run: StoredMineRun): SqlParameters {
  return {
    ':id': run.id,
    ':player': run.playerId,
    ':name': run.playerName,
    ':ruleset': run.ruleset,
    ':size': run.state.size,
    ':revision': run.revision,
    ':state': JSON.stringify({ ...run.state, initialFlags: run.initialFlags }),
    ':status': run.state.status,
    ':first': run.firstCell,
    ':started': run.startedAt,
    ':elapsed': run.elapsedMs,
    ':action': run.lastAction,
  };
}
export class SqlMineRepository implements MineRepository {
  constructor(private readonly db: SqlDatabase) {}
  async get(id: string): Promise<StoredMineRun | null> {
    const value = await this.db.get('SELECT * FROM minesweeper_runs WHERE id=:id', { ':id': id });
    return value == null ? null : decodeStored(value);
  }
  async create(run: StoredMineRun): Promise<StoredMineRun> {
    await this.db.run(
      `INSERT INTO minesweeper_runs
      (id,player_id,player_name,ruleset,size,revision,state_json,status,first_cell,started_at,elapsed_ms,last_action)
      VALUES (:id,:player,:name,:ruleset,:size,:revision,:state,:status,:first,:started,:elapsed,:action)
      ON CONFLICT(id) DO NOTHING`,
      params(run),
    );
    const stored = await this.get(run.id);
    if (!stored) throw new Error('Mine run insert failed');
    return stored;
  }
  async save(run: StoredMineRun, expectedRevision: number): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE minesweeper_runs SET revision=:revision,state_json=:state,status=:status,
      elapsed_ms=:elapsed,last_action=:action WHERE id=:id AND revision=:expected RETURNING id`,
      {
        ':id': run.id,
        ':revision': run.revision,
        ':state': JSON.stringify({ ...run.state, initialFlags: run.initialFlags }),
        ':status': run.state.status,
        ':elapsed': run.elapsedMs,
        ':action': run.lastAction,
        ':expected': expectedRevision,
      },
    );
    return returnedRows(result).length === 1;
  }
  async countRecent(playerId: number, since: number): Promise<number> {
    const result = object(
      await this.db.get(
        'SELECT count(*) AS total FROM minesweeper_runs WHERE player_id=:player AND started_at>=:since',
        { ':player': playerId, ':since': since },
      ),
    );
    return integer(result.total, 0, Number.MAX_SAFE_INTEGER);
  }
  async leaderboard(
    player: Player,
    size: MineSize,
    period: Period,
    since: number,
  ): Promise<MineLeaderboard> {
    const result = await this.db.all(
      `WITH attempts AS (
        SELECT *,row_number() OVER (
          PARTITION BY player_id ORDER BY elapsed_ms ASC,started_at ASC,id ASC
        ) AS personal FROM minesweeper_runs
        WHERE size=:size AND ruleset=:ruleset AND status='won' AND started_at>=:since
      ), ranked AS (
        SELECT *,row_number() OVER (ORDER BY elapsed_ms ASC,started_at ASC,id ASC) AS place
        FROM attempts WHERE personal=1
      ) SELECT * FROM ranked WHERE place<=50 OR player_id=:player ORDER BY place`,
      { ':size': size, ':ruleset': MINE_RULESET, ':since': since, ':player': player.id },
    );
    if (!Array.isArray(result)) throw new Error('Invalid mine leaderboard');
    const entries = result.map((value) => {
      const r = object(value);
      return {
        rank: r.place,
        playerId: r.player_id,
        name: r.player_name,
        elapsedMs: r.elapsed_ms,
        runId: r.id,
      };
    });
    return decodeMineLeaderboard({
      size,
      period,
      entries: entries.slice(0, 50),
      me: entries.find((r) => r.playerId === player.id) ?? null,
    });
  }
}
