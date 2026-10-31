import { MINE_RULESET, type MineSize } from '../../games/minesweeper/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { integer, object, text } from '../../shared/errors.ts';
import {
  decodeMineLeaderboard,
  decodeMineResult,
  type MineLeaderboard,
  type MineResult,
} from '../../shared/minesweeper.ts';
import type {
  MineBoardScope,
  MineNotificationResult,
  MineRepository,
  StoredMineResult,
} from '../domain/minesweeper.ts';
import type { SqlDatabase } from './sql-repository.ts';

export class SqlMineRepository implements MineRepository {
  constructor(private readonly db: SqlDatabase) {}
  async getResult(id: string): Promise<MineResult | null> {
    const value = await this.db.get(
      "SELECT id,size,elapsed_ms FROM minesweeper_runs WHERE id=:id AND status='won' AND ruleset=:ruleset",
      { ':id': id, ':ruleset': MINE_RULESET },
    );
    if (value == null) return null;
    const r = object(value);
    return decodeMineResult({ id: r.id, size: r.size, elapsedMs: r.elapsed_ms });
  }
  async record(result: StoredMineResult): Promise<MineResult> {
    await this.db.run(
      `INSERT INTO minesweeper_runs
      (id,player_id,player_name,ruleset,size,revision,state_json,status,first_cell,started_at,elapsed_ms,last_action)
      VALUES (:id,:player,:name,:ruleset,:size,0,:state,'won',0,:created,:elapsed,NULL)
      ON CONFLICT(id) DO NOTHING`,
      {
        ':id': result.id,
        ':player': result.playerId,
        ':name': result.playerName,
        ':ruleset': MINE_RULESET,
        ':size': result.size,
        ':state': JSON.stringify({
          size: result.size,
          elapsedMs: result.elapsedMs,
          socialProcessed: false,
        }),
        ':created': result.createdAt,
        ':elapsed': result.elapsedMs,
      },
    );
    const stored = await this.getResult(result.id);
    if (!stored) throw new Error('Mine result insert failed');
    return stored;
  }
  async getStored(id: string): Promise<MineNotificationResult | null> {
    const value = await this.db.get(
      "SELECT rowid AS result_order,* FROM minesweeper_runs WHERE id=:id AND status='won'",
      { ':id': id },
    );
    if (value == null) return null;
    const row = object(value);
    const state = object(JSON.parse(text(row.state_json, 1, 20000)));
    const socialProcessed = state.socialProcessed === undefined ? true : state.socialProcessed;
    if (typeof socialProcessed !== 'boolean') throw new Error('Invalid notification state');
    return {
      ...decodeMineResult({ id: row.id, size: row.size, elapsedMs: row.elapsed_ms }),
      playerId: integer(row.player_id, 1, Number.MAX_SAFE_INTEGER),
      playerName: text(row.player_name, 1, 100),
      createdAt: integer(row.started_at, 0, Number.MAX_SAFE_INTEGER),
      order: integer(row.result_order, 1, Number.MAX_SAFE_INTEGER),
      socialProcessed,
    };
  }
  async pendingResults(limit: number): Promise<MineNotificationResult[]> {
    const rows = await this.db.all(
      "SELECT id FROM minesweeper_runs WHERE status='won' AND ruleset=:ruleset AND json_extract(state_json,'$.socialProcessed')=0 ORDER BY rowid LIMIT :limit",
      { ':ruleset': MINE_RULESET, ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid notification results');
    const results: MineNotificationResult[] = [];
    for (const value of rows) {
      const run = await this.getStored(text(object(value).id, 1, 100));
      if (run) results.push(run);
    }
    return results;
  }
  async processed(id: string): Promise<void> {
    await this.db.run(
      "UPDATE minesweeper_runs SET state_json=json_set(state_json,'$.socialProcessed',json('true')) WHERE id=:id",
      { ':id': id },
    );
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
    scope: MineBoardScope = {},
  ): Promise<MineLeaderboard> {
    const result = await this.db.all(
      `WITH results AS (
        SELECT rowid AS result_order,* FROM minesweeper_runs
        WHERE size=:size AND ruleset=:ruleset AND status='won' AND started_at>=:since
      ), attempts AS (
        SELECT *,row_number() OVER (
          PARTITION BY player_id ORDER BY elapsed_ms ASC,started_at ASC,id ASC
        ) AS personal FROM results
        WHERE (:maxOrder IS NULL OR result_order<=:maxOrder)
        AND (:groupId IS NULL OR EXISTS(SELECT 1 FROM group_memberships gm
          WHERE gm.group_id=:groupId AND gm.user_id=results.player_id
          AND gm.active=1 AND gm.updated_at>=:membersSince))
      ), ranked AS (
        SELECT *,row_number() OVER (ORDER BY elapsed_ms ASC,started_at ASC,id ASC) AS place
        FROM attempts WHERE personal=1
      ) SELECT * FROM ranked WHERE place<=50 OR player_id=:player ORDER BY place`,
      {
        ':size': size,
        ':ruleset': MINE_RULESET,
        ':since': since,
        ':player': player.id,
        ':maxOrder': scope.maxResultOrder ?? null,
        ':groupId': scope.groupId ?? null,
        ':membersSince': scope.membershipCheckedSince ?? 0,
      },
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
