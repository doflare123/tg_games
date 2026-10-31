import type { TetrisMode } from '../../games/tetris/types.ts';
import { RULESET } from '../../games/tetris/types.ts';
import type { LeaderboardView, Period, Player } from '../../shared/contracts.ts';
import { integer, object, text } from '../../shared/errors.ts';
import type { BoardScope } from '../../shared/groups.ts';
import { decodeEntry, decodeRun } from '../../shared/validation.ts';
import type { ArcadeRepository, StoredRun } from '../domain/repository.ts';
import { NEXT_RESULT_ORDER } from './manual-results-ddl.ts';
import { returnedRows } from './sql-write.ts';
export type SqlValue = string | number | null;
export type SqlParameters = Record<string, SqlValue>;
export interface SqlDatabase {
  run(sql: string, parameters?: SqlParameters): Promise<unknown>;
  get(sql: string, parameters?: SqlParameters): Promise<unknown>;
  all(sql: string, parameters?: SqlParameters): Promise<unknown>;
}
function decodeStored(value: unknown): StoredRun {
  const r = object(value);
  const state: unknown = JSON.parse(text(r.state_json, 1, 100000));
  const view = decodeRun({
    id: r.id,
    mode: r.mode,
    revision: r.revision,
    ruleset: r.ruleset,
    state,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  });
  const ids: unknown = JSON.parse(typeof r.group_ids_json === 'string' ? r.group_ids_json : '[]');
  if (!Array.isArray(ids) || ids.length > 50) throw new Error('Invalid run group snapshot');
  return {
    ...view,
    groupIds: ids.map((value) => integer(value, -Number.MAX_SAFE_INTEGER, -1)),
    verifiedOrder: integer(r.verified_order, 0, Number.MAX_SAFE_INTEGER),
    verifiedAt: integer(r.verified_at, 0, Number.MAX_SAFE_INTEGER),
    socialProcessed: r.social_processed === 1,
    playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
    playerName: text(r.player_name, 1, 100),
    lastSubmission: r.last_submission === null ? null : text(r.last_submission, 1, 200000),
  };
}
function params(run: StoredRun): SqlParameters {
  return {
    ':id': run.id,
    ':playerId': run.playerId,
    ':playerName': run.playerName,
    ':mode': run.mode,
    ':ruleset': run.ruleset,
    ':revision': run.revision,
    ':status': run.status,
    ':state': JSON.stringify(run.state),
    ':score': run.state.score,
    ':ticks': run.state.tick,
    ':lines': run.state.lines,
    ':created': run.createdAt,
    ':expires': run.expiresAt,
    ':submission': run.lastSubmission,
    ':groups': JSON.stringify(run.groupIds),
    ':order': run.verifiedOrder,
    ':verifiedAt': run.verifiedAt,
    ':processed': Number(run.socialProcessed),
  };
}
export class SqlArcadeRepository implements ArcadeRepository {
  constructor(private readonly db: SqlDatabase) {}
  async create(run: StoredRun): Promise<StoredRun> {
    await this.db.run(
      `INSERT INTO runs (id,player_id,player_name,mode,ruleset,revision,status,state_json,score,ticks,lines,created_at,expires_at,last_submission,group_ids_json,verified_order,verified_at,social_processed)
      VALUES (:id,:playerId,:playerName,:mode,:ruleset,:revision,:status,:state,:score,:ticks,:lines,:created,:expires,:submission,:groups,:order,:verifiedAt,:processed)
      ON CONFLICT(id) DO NOTHING`,
      params(run),
    );
    const stored = await this.get(run.id);
    if (!stored) throw new Error('Run insert failed');
    return stored;
  }
  async get(id: string): Promise<StoredRun | null> {
    const value = await this.db.get('SELECT * FROM runs WHERE id=:id', { ':id': id });
    return value == null ? null : decodeStored(value);
  }
  async save(run: StoredRun, expectedRevision: number): Promise<boolean> {
    // Archive the previously accepted chunk before advancing. The newest chunk
    // stays atomically in runs.last_submission; an interrupted archive loses no input.
    await this.db.run(
      `INSERT INTO replay_chunks (id,run_id,revision,payload)
      SELECT id || ':' || revision,id,revision,last_submission FROM runs
      WHERE id=:id AND revision=:expected AND last_submission IS NOT NULL
      ON CONFLICT(id) DO NOTHING`,
      { ':id': run.id, ':expected': expectedRevision },
    );
    const updated = await this.db.run(
      `UPDATE runs SET revision=:revision,status=:status,state_json=:state,
      score=:score,ticks=:ticks,lines=:lines,last_submission=:submission,verified_at=:verifiedAt,
      verified_order=CASE WHEN :status='verified' THEN ${NEXT_RESULT_ORDER} ELSE verified_order END
      WHERE id=:id AND revision=:expected RETURNING id`,
      {
        ':id': run.id,
        ':revision': run.revision,
        ':status': run.status,
        ':state': JSON.stringify(run.state),
        ':score': run.state.score,
        ':ticks': run.state.tick,
        ':lines': run.state.lines,
        ':submission': run.lastSubmission,
        ':expected': expectedRevision,
        ':verifiedAt': run.verifiedAt,
      },
    );
    return returnedRows(updated).length === 1;
  }
  async countRecent(playerId: number, since: number): Promise<number> {
    const result = object(
      await this.db.get(
        'SELECT count(*) AS total FROM runs WHERE player_id=:id AND created_at>=:since',
        { ':id': playerId, ':since': since },
      ),
    );
    return integer(result.total, 0, Number.MAX_SAFE_INTEGER);
  }
  async leaderboard(
    player: Player,
    mode: TetrisMode,
    period: Period,
    since: number,
    scope: BoardScope = {},
  ): Promise<LeaderboardView> {
    // Only this enum-controlled expression is interpolated; all external data is bound.
    const order =
      mode === 'sprint'
        ? 'COALESCE(ticks,108001) ASC, score DESC'
        : 'score DESC, COALESCE(ticks,108001) ASC';
    const result = await this.db.all(
      `WITH results AS (
      SELECT id,player_id,player_name,mode,ruleset,score,ticks,lines,created_at,group_ids_json,verified_order,'verified' AS source,0 AS approximate
      FROM runs WHERE status='verified'
      UNION ALL
      SELECT id,player_id,player_name,mode,ruleset,score,ticks,lines,created_at,group_ids_json,verified_order,'manual' AS source,approximate FROM manual_results
    ), attempts AS (
      SELECT *,row_number() OVER (PARTITION BY player_id ORDER BY ${order},created_at ASC,id ASC) AS personal
      FROM results WHERE mode=:mode AND ruleset=:ruleset AND created_at>=:since
      AND (:groupId IS NULL OR EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.group_id=:groupId AND gm.user_id=results.player_id AND gm.active=1 AND gm.updated_at>=:membersSince))
      AND (:maxOrder IS NULL OR verified_order<=:maxOrder)
    ), ranked AS (
      SELECT *,row_number() OVER (ORDER BY ${order},created_at ASC,id ASC) AS place FROM attempts WHERE personal=1
    ) SELECT * FROM ranked WHERE place<=50 OR player_id=:player ORDER BY place`,
      {
        ':mode': mode,
        ':ruleset': RULESET,
        ':since': since,
        ':player': player.id,
        ':groupId': scope.groupId ?? null,
        ':membersSince': scope.membershipCheckedSince ?? 0,
        ':maxOrder': scope.maxVerifiedOrder ?? null,
      },
    );
    if (!Array.isArray(result)) throw new Error('Invalid database response');
    const entries = result.map((value) => {
      const r = object(value);
      return decodeEntry({
        rank: r.place,
        playerId: r.player_id,
        name: r.player_name,
        score: r.score,
        ticks: r.ticks ?? 0,
        durationKnown: r.ticks !== null,
        source: r.source,
        approximate: r.approximate === 1,
        lines: r.lines,
        runId: r.id,
      });
    });
    return {
      mode,
      period,
      entries: entries.filter((r) => r.rank <= 50),
      me: entries.find((r) => r.playerId === player.id) ?? null,
    };
  }
}
