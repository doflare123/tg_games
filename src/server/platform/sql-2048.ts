import { RULESET_2048 } from '../../games/2048/engine.ts';
import { decodeBoard2048, decodeRun2048 } from '../../shared/2048.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { integer, object, text } from '../../shared/errors.ts';
import type { BoardScope2048, Repository2048, Stored2048 } from '../domain/2048.ts';
import type { SqlDatabase } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

export class Sql2048Repository implements Repository2048 {
  constructor(private readonly db: SqlDatabase) {}
  async get(id: string): Promise<Stored2048 | null> {
    const value = await this.db.get('SELECT * FROM puzzle2048_runs WHERE id=:id', { ':id': id });
    if (value == null) return null;
    const r = object(value);
    return {
      ...decodeRun2048({
        id: r.id,
        ruleset: r.ruleset,
        revision: r.revision,
        state: JSON.parse(text(r.state_json, 1, 10000)),
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }),
      playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
      playerName: text(r.player_name, 1, 100),
      lastSubmission: r.last_submission === null ? null : text(r.last_submission, 1, 10000),
      verifiedAt: integer(r.verified_at, 0, Number.MAX_SAFE_INTEGER),
      verifiedOrder: integer(r.verified_order, 0, Number.MAX_SAFE_INTEGER),
      socialProcessed: integer(r.social_processed, 0, 1) === 1,
    };
  }
  async create(run: Stored2048): Promise<Stored2048> {
    await this.db.run(
      `INSERT INTO puzzle2048_runs
      (id,player_id,player_name,ruleset,revision,state_json,status,score,max_tile,created_at,expires_at,last_submission,verified_at,verified_order,social_processed)
      VALUES (:id,:player,:name,:ruleset,0,:state,'active',0,:tile,:created,:expires,NULL,0,0,0) ON CONFLICT(id) DO NOTHING`,
      {
        ':id': run.id,
        ':player': run.playerId,
        ':name': run.playerName,
        ':ruleset': run.ruleset,
        ':state': JSON.stringify(run.state),
        ':tile': Math.max(...run.state.board),
        ':created': run.createdAt,
        ':expires': run.expiresAt,
      },
    );
    const stored = await this.get(run.id);
    if (!stored) throw new Error('2048 insert failed');
    return stored;
  }
  async save(run: Stored2048, revision: number): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE puzzle2048_runs SET revision=:next,state_json=:state,
      status=:status,score=:score,max_tile=:tile,last_submission=:receipt,verified_at=:verifiedAt,
      verified_order=CASE WHEN :status='verified' THEN (SELECT COALESCE(MAX(verified_order),0)+1 FROM puzzle2048_runs) ELSE verified_order END,
      social_processed=CASE WHEN :status='verified' THEN 0 ELSE social_processed END
      WHERE id=:id AND revision=:revision AND status='active' RETURNING id`,
      {
        ':next': run.revision,
        ':state': JSON.stringify(run.state),
        ':status': run.status,
        ':score': run.state.score,
        ':tile': Math.max(...run.state.board),
        ':receipt': run.lastSubmission,
        ':id': run.id,
        ':revision': revision,
        ':verifiedAt': run.verifiedAt,
      },
    );
    return returnedRows(result).length === 1;
  }
  async countRecent(playerId: number, since: number): Promise<number> {
    return integer(
      object(
        await this.db.get(
          'SELECT count(*) AS total FROM puzzle2048_runs WHERE player_id=:player AND created_at>=:since',
          {
            ':player': playerId,
            ':since': since,
          },
        ),
      ).total,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }
  async pendingResults(limit: number): Promise<Stored2048[]> {
    const rows = await this.db.all(
      "SELECT id FROM puzzle2048_runs WHERE status='verified' AND social_processed=0 ORDER BY verified_order LIMIT :limit",
      { ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid pending 2048 results');
    const results: Stored2048[] = [];
    for (const row of rows) {
      const run = await this.get(text(object(row).id, 1, 100));
      if (run) results.push(run);
    }
    return results;
  }
  async processed(id: string): Promise<void> {
    await this.db.run('UPDATE puzzle2048_runs SET social_processed=1 WHERE id=:id', { ':id': id });
  }
  async leaderboard(player: Player, period: Period, since: number, scope: BoardScope2048 = {}) {
    const rows = await this.db.all(
      `WITH attempts AS (
      SELECT *,row_number() OVER (PARTITION BY player_id ORDER BY score DESC,created_at ASC,id ASC) AS personal
      FROM puzzle2048_runs WHERE status='verified' AND ruleset=:ruleset AND created_at>=:since
      AND (:maxOrder IS NULL OR verified_order<=:maxOrder)
      AND (:groupId IS NULL OR EXISTS(SELECT 1 FROM group_memberships gm
        WHERE gm.group_id=:groupId AND gm.user_id=puzzle2048_runs.player_id
        AND gm.active=1 AND gm.updated_at>=:membersSince))
    ), ranked AS (
      SELECT *,row_number() OVER (ORDER BY score DESC,created_at ASC,id ASC) AS place FROM attempts WHERE personal=1
    ) SELECT * FROM ranked WHERE place<=50 OR player_id=:player ORDER BY place`,
      {
        ':ruleset': scope.ruleset ?? RULESET_2048,
        ':since': since,
        ':player': player.id,
        ':maxOrder': scope.maxResultOrder ?? null,
        ':groupId': scope.groupId ?? null,
        ':membersSince': scope.membershipCheckedSince ?? 0,
      },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid 2048 leaderboard');
    const entries = rows.map((value) => {
      const r = object(value);
      return {
        rank: r.place,
        playerId: r.player_id,
        name: r.player_name,
        score: r.score,
        maxTile: r.max_tile,
        runId: r.id,
      };
    });
    return decodeBoard2048({
      ruleset: scope.ruleset ?? RULESET_2048,
      period,
      entries: entries.filter((r) => typeof r.rank === 'number' && r.rank <= 50),
      me: entries.find((r) => r.playerId === player.id) ?? null,
    });
  }
}
