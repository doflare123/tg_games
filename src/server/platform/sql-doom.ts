import type { Period, Player } from '../../shared/contracts.ts';
import {
  DOOM_CATEGORIES,
  DOOM_MAX_TICKS,
  DOOM_RULESET,
  DOOM_SKILLS,
  DOOM_TARGETS,
  type DoomCategory,
  type DoomCommandSpan,
  type DoomSkill,
  type DoomTarget,
  decodeDoomBoard,
  decodeDoomRun,
  doomCommands,
} from '../../shared/doom.ts';
import { integer, object, oneOf, text } from '../../shared/errors.ts';
import type {
  DoomRepository,
  DoomResult,
  DoomScope,
  DoomVerification,
  StoredDoom,
} from '../domain/doom.ts';
import type { SqlDatabase } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

export class SqlDoomRepository implements DoomRepository {
  constructor(private readonly db: SqlDatabase) {}
  async get(id: string): Promise<StoredDoom | null> {
    const value = await this.db.get(
      'SELECT id,player_id,player_name,ruleset,skill,revision,accepted_ticks,verified_ticks,continuous,status,created_at,expires_at,session_tick,session_at,breaks_json,last_submission FROM doom_runs WHERE id=:id',
      { ':id': id },
    );
    if (value == null) return null;
    const r = object(value);
    const breaks: unknown = JSON.parse(text(r.breaks_json, 2, 2000000));
    if (!Array.isArray(breaks) || breaks.length > DOOM_MAX_TICKS)
      throw new Error('Invalid Doom interruptions');
    return {
      ...decodeDoomRun({
        id: r.id,
        ruleset: r.ruleset,
        skill: r.skill,
        revision: r.revision,
        acceptedTicks: r.accepted_ticks,
        verifiedTicks: r.verified_ticks,
        continuous: r.continuous === 1,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }),
      playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
      playerName: text(r.player_name, 1, 100),
      breaks: breaks.map((tick) => integer(tick, 0, DOOM_MAX_TICKS)),
      lastSubmission: r.last_submission === null ? null : text(r.last_submission, 1, 20000),
      sessionTick: integer(r.session_tick, 0, DOOM_MAX_TICKS),
      sessionAt: integer(r.session_at, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  async latest(playerId: number) {
    const row = await this.db.get(
      "SELECT id FROM doom_runs WHERE player_id=:player AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1",
      { ':player': playerId },
    );
    return row == null ? null : this.get(text(object(row).id, 1, 100));
  }
  async create(run: StoredDoom) {
    await this.db.run(
      'INSERT INTO doom_runs(id,player_id,player_name,ruleset,skill,created_at,expires_at,session_at) VALUES(:id,:player,:name,:ruleset,:skill,:created,:expires,:created) ON CONFLICT(id) DO NOTHING',
      {
        ':id': run.id,
        ':player': run.playerId,
        ':name': run.playerName,
        ':ruleset': run.ruleset,
        ':skill': run.skill,
        ':created': run.createdAt,
        ':expires': run.expiresAt,
      },
    );
    const stored = await this.get(run.id);
    if (!stored) throw new Error('Doom insert failed');
    return stored;
  }
  async countRecent(playerId: number, since: number) {
    return integer(
      object(
        await this.db.get(
          'SELECT COUNT(*) AS total FROM doom_runs WHERE player_id=:player AND created_at>=:since',
          { ':player': playerId, ':since': since },
        ),
      ).total,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }
  async commands(id: string, revision: number): Promise<DoomCommandSpan[]> {
    const row = await this.db.get('SELECT commands_json FROM doom_runs WHERE id=:id', {
      ':id': id,
    });
    if (row == null) throw new Error('Missing Doom recording');
    const chunks: unknown = JSON.parse(text(object(row).commands_json, 2, 8000000));
    if (!Array.isArray(chunks) || chunks.length < revision || chunks.length > DOOM_MAX_TICKS)
      throw new Error('Invalid Doom recording');
    return doomCommands(
      chunks.slice(0, revision).flatMap((chunk: unknown) => doomCommands(chunk)),
      DOOM_MAX_TICKS,
    );
  }
  async append(
    run: StoredDoom,
    revision: number,
    commands: DoomCommandSpan[],
    receipt: string,
    interruptions: number[],
  ): Promise<boolean> {
    return (
      returnedRows(
        await this.db.run(
          "UPDATE doom_runs SET commands_json=json_insert(commands_json,'$[#]',json(:commands)),revision=revision+1,accepted_ticks=:ticks,last_submission=:receipt,continuous=CASE WHEN json_array_length(:breaks)>0 THEN 0 ELSE continuous END,breaks_json=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(breaks_json) UNION SELECT value FROM json_each(:breaks))) WHERE id=:id AND revision=:revision AND status='active' RETURNING id",
          {
            ':commands': JSON.stringify(commands),
            ':ticks': run.acceptedTicks,
            ':receipt': receipt,
            ':breaks': JSON.stringify(interruptions),
            ':id': run.id,
            ':revision': revision,
          },
        ),
      ).length === 1
    );
  }
  async interrupt(id: string, now: number, atTick?: number) {
    await this.db.run(
      "UPDATE doom_runs SET continuous=0,breaks_json=CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(breaks_json) WHERE value=COALESCE(:tick,accepted_ticks)) THEN json_insert(breaks_json,'$[#]',COALESCE(:tick,accepted_ticks)) ELSE breaks_json END,session_tick=accepted_ticks,session_at=:now WHERE id=:id AND status='active'",
      { ':now': now, ':id': id, ':tick': atTick ?? null },
    );
  }
  async claim(id: string, now: number) {
    return (
      returnedRows(
        await this.db.run(
          "UPDATE doom_runs SET lease_until=:lease WHERE id=:id AND status='active' AND accepted_ticks>verified_ticks AND lease_until<=:now AND retry_at<=:now RETURNING id",
          { ':lease': now + 120000, ':now': now, ':id': id },
        ),
      ).length === 1
    );
  }
  async release(id: string, startedAt: number, now: number) {
    await this.db.run(
      'UPDATE doom_runs SET lease_until=0,retry_at=:retry WHERE id=:id AND lease_until=:lease',
      {
        ':retry': now + 15000,
        ':lease': startedAt + 120000,
        ':id': id,
      },
    );
  }
  async pending(limit: number, now: number) {
    const rows = await this.db.all(
      "SELECT id FROM doom_runs WHERE status='active' AND accepted_ticks>verified_ticks AND lease_until<=:now AND retry_at<=:now ORDER BY retry_at,created_at LIMIT :limit",
      { ':now': now, ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid Doom queue');
    return rows.map((row) => text(object(row).id, 1, 100));
  }
  async publish(run: StoredDoom, result: DoomVerification, now: number) {
    const add = async (
      target: DoomTarget,
      category: DoomCategory,
      ticks: number,
      startTick: number,
      endTick: number,
    ) => {
      if (ticks <= 0) return;
      await this.db.run(
        `INSERT INTO doom_results(id,run_id,player_id,player_name,ruleset,skill,target,category,ticks,created_at,verified_at,verified_order,social_processed,start_tick,end_tick)
      SELECT :result,id,player_id,player_name,ruleset,skill,:target,:category,:ticks,:created,:now,(SELECT COALESCE(MAX(verified_order),0)+1 FROM doom_results),0,:start,:end
      FROM doom_runs WHERE id=:id AND (:target<>'episode' OR continuous=1)
      AND NOT EXISTS(SELECT 1 FROM json_each(breaks_json) WHERE value>=:start AND value<:end)
      AND NOT EXISTS(SELECT 1 FROM ranking_blocks WHERE player_id=doom_runs.player_id)
      ON CONFLICT(id) DO NOTHING`,
        {
          ':result': `${run.id}:${target}:${category}`,
          ':target': target,
          ':category': category,
          ':ticks': ticks,
          ':created': run.createdAt,
          ':now': now,
          ':start': startTick,
          ':end': endTick,
          ':id': run.id,
        },
      );
    };
    for (const split of result.splits) {
      const target = oneOf(`E1M${split.map}`, DOOM_TARGETS);
      await add(target, 'any', split.ticks, split.startTick, split.endTick);
      if (split.max) await add(target, 'max', split.ticks, split.startTick, split.endTick);
    }
    if (result.complete) {
      const final = result.splits.at(-1);
      if (
        !final ||
        ![1, 2, 3, 4, 5, 6, 7, 8].every((map) => result.splits.some((split) => split.map === map))
      )
        throw new Error('Incomplete Doom episode route');
      await add('episode', 'any', final.totalTicks, 0, final.endTick);
      if (result.splits.length === 9 && result.splits.every((split) => split.max))
        await add('episode', 'max', final.totalTicks, 0, final.endTick);
    }
    await this.db.run(
      "UPDATE doom_runs SET verified_ticks=MAX(verified_ticks,:ticks),status=CASE WHEN :complete=1 THEN 'complete' ELSE status END WHERE id=:id",
      { ':ticks': result.ticks, ':complete': Number(result.complete), ':id': run.id },
    );
  }
  async leaderboard(
    player: Player,
    skill: DoomSkill,
    target: DoomTarget,
    category: DoomCategory,
    period: Period,
    since: number,
    scope: DoomScope = {},
  ) {
    const rows = await this.db.all(
      `WITH attempts AS (
      SELECT *,row_number() OVER(PARTITION BY player_id ORDER BY ticks,created_at,id) AS personal FROM doom_results
      WHERE ruleset=:ruleset AND skill=:skill AND target=:target AND category=:category AND created_at>=:since
      AND (:maxOrder IS NULL OR verified_order<=:maxOrder)
      AND NOT EXISTS(SELECT 1 FROM ranking_blocks WHERE player_id=doom_results.player_id)
      AND (:groupId IS NULL OR EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.group_id=:groupId AND gm.user_id=doom_results.player_id AND gm.active=1 AND gm.updated_at>=:membersSince))
    ), ranked AS (SELECT *,row_number() OVER(ORDER BY ticks,created_at,id) AS place FROM attempts WHERE personal=1)
    SELECT * FROM ranked WHERE place<=50 OR player_id=:player ORDER BY place`,
      {
        ':ruleset': DOOM_RULESET,
        ':skill': skill,
        ':target': target,
        ':category': category,
        ':since': since,
        ':maxOrder': scope.maxResultOrder ?? null,
        ':groupId': scope.groupId ?? null,
        ':membersSince': scope.membershipCheckedSince ?? 0,
        ':player': player.id,
      },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid Doom leaderboard');
    const entries = rows.map((value) => {
      const r = object(value);
      return {
        rank: r.place,
        playerId: r.player_id,
        name: r.player_name,
        ticks: r.ticks,
        runId: r.id,
      };
    });
    return decodeDoomBoard({
      skill,
      target,
      category,
      period,
      entries: entries.filter((entry) => typeof entry.rank === 'number' && entry.rank <= 50),
      me: entries.find((entry) => entry.playerId === player.id) ?? null,
    });
  }
  async pendingResults(limit: number): Promise<DoomResult[]> {
    const rows = await this.db.all(
      'SELECT * FROM doom_results WHERE social_processed=0 ORDER BY verified_order LIMIT :limit',
      { ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid Doom notification queue');
    return rows.map((value) => {
      const r = object(value);
      return {
        id: text(r.id, 1, 100),
        runId: text(r.run_id, 1, 100),
        playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
        playerName: text(r.player_name, 1, 100),
        skill: oneOf(r.skill, DOOM_SKILLS),
        target: oneOf(r.target, DOOM_TARGETS),
        category: oneOf(r.category, DOOM_CATEGORIES),
        ticks: integer(r.ticks, 1, DOOM_MAX_TICKS),
        createdAt: integer(r.created_at, 0, Number.MAX_SAFE_INTEGER),
        verifiedAt: integer(r.verified_at, 0, Number.MAX_SAFE_INTEGER),
        verifiedOrder: integer(r.verified_order, 1, Number.MAX_SAFE_INTEGER),
        socialProcessed: r.social_processed === 1,
        startTick: integer(r.start_tick, 0, DOOM_MAX_TICKS),
        endTick: integer(r.end_tick, 1, DOOM_MAX_TICKS),
      };
    });
  }
  async processed(id: string) {
    await this.db.run('UPDATE doom_results SET social_processed=1 WHERE id=:id', { ':id': id });
  }
}
