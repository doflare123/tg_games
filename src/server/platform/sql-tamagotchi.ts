import { RULESETS_2048 } from '../../games/2048/engine.ts';
import { BLOCK_RULESET } from '../../games/block-blast/engine.ts';
import { FLAPPY_RULESET } from '../../games/flappy/engine.ts';
import { SNAKE_RULESET } from '../../games/snake/engine.ts';
import { RULESET } from '../../games/tetris/types.ts';
import { decodeBlockBoard } from '../../shared/block-blast.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { integer, object, oneOf, text } from '../../shared/errors.ts';
import {
  decodePetState,
  emptyPetWallet,
  PET_DAY,
  PET_GAME_INFO,
  PET_GAMES,
} from '../../shared/tamagotchi.ts';
import type { BlockBoardScope } from '../domain/block-blast.ts';
import type { PetRepository, StoredPet } from '../domain/tamagotchi.ts';
import type { SqlDatabase } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

function decodeEvent(value: unknown): StoredPet {
  const r = object(value);
  return {
    id: text(r.id, 1, 100),
    playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
    playerName: text(r.player_name, 1, 100),
    revision: integer(r.revision, 0, Number.MAX_SAFE_INTEGER),
    requestId: text(r.request_id, 1, 64),
    receipt: text(r.receipt, 0, 2000),
    state: decodePetState(JSON.parse(text(r.state_json, 1, 20000))),
    createdAt: integer(r.created_at, 0, Number.MAX_SAFE_INTEGER),
    order: integer(r.event_order, 1, Number.MAX_SAFE_INTEGER),
    socialProcessed: integer(r.social_processed, 0, 1) === 1,
  };
}
export class SqlPetRepository implements PetRepository {
  constructor(private readonly db: SqlDatabase) {}
  async get(playerId: number): Promise<StoredPet | null> {
    const row = await this.db.get(
      'SELECT * FROM pet_events WHERE player_id=:player ORDER BY revision DESC LIMIT 1',
      { ':player': playerId },
    );
    return row == null ? null : decodeEvent(row);
  }
  async request(playerId: number, requestId: string): Promise<StoredPet | null> {
    const row = await this.db.get(
      'SELECT * FROM pet_events WHERE player_id=:player AND request_id=:request',
      { ':player': playerId, ':request': requestId },
    );
    return row == null ? null : decodeEvent(row);
  }
  async append(event: StoredPet, previous: number): Promise<boolean> {
    // State, debits, rewards, idempotency receipt and pending record are one atomic write.
    return (
      returnedRows(
        await this.db.run(
          `INSERT INTO pet_events
      (id,player_id,player_name,revision,request_id,receipt,state_json,score,created_at,social_processed)
      SELECT :id,:player,:name,:revision,:request,:receipt,:state,:score,:now,:processed
      WHERE COALESCE((SELECT MAX(revision) FROM pet_events WHERE player_id=:player),-1)=:previous
      ON CONFLICT DO NOTHING RETURNING id`,
          {
            ':id': event.id,
            ':player': event.playerId,
            ':name': event.playerName,
            ':revision': event.revision,
            ':request': event.requestId,
            ':receipt': event.receipt,
            ':state': JSON.stringify(event.state),
            ':score': event.state.xp,
            ':now': event.createdAt,
            ':processed': Number(event.socialProcessed),
            ':previous': previous,
          },
        ),
      ).length === 1
    );
  }
  async earned(playerId: number, since: number, until: number) {
    const rows = await this.db.all(
      `WITH activity AS (
      SELECT 'tetris' AS game,score,created_at,verified_at FROM runs
       WHERE player_id=:player AND status='verified' AND ruleset=:tetris AND ticks>=300
      UNION ALL SELECT 'block-blast',score,created_at,verified_at FROM block_blast_runs
       WHERE player_id=:player AND status='verified' AND ruleset=:block AND json_extract(state_json,'$.moves')>=3
      UNION ALL SELECT '2048',score,created_at,verified_at FROM puzzle2048_runs
       WHERE player_id=:player AND status='verified' AND ruleset IN (:puzzle1,:puzzle2) AND json_extract(state_json,'$.moves')>=10
      UNION ALL SELECT 'snake',score,created_at,verified_at FROM snake_runs
       WHERE player_id=:player AND status='verified' AND ruleset=:snake AND json_extract(state_json,'$.ticks')>=15
      UNION ALL SELECT 'flappy',score,created_at,verified_at FROM flappy_runs
       WHERE player_id=:player AND status='verified' AND ruleset=:flappy AND json_extract(state_json,'$.ticks')>=120
    ) SELECT game,CAST((verified_at-7200000)/:day AS INTEGER) AS day,
      SUM(MIN(score,1000000)) AS points,MIN(COUNT(*),5) AS attempts FROM activity
      WHERE created_at>=:since AND verified_at<=:until AND verified_at>=created_at
      AND NOT EXISTS(SELECT 1 FROM ranking_blocks WHERE player_id=:player)
      GROUP BY game,day`,
      {
        ':player': playerId,
        ':since': since,
        ':until': until,
        ':day': PET_DAY,
        ':tetris': RULESET,
        ':block': BLOCK_RULESET,
        ':puzzle1': RULESETS_2048[0],
        ':puzzle2': RULESETS_2048[1],
        ':snake': SNAKE_RULESET,
        ':flappy': FLAPPY_RULESET,
      },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid pet activity');
    const wallet = emptyPetWallet();
    for (const row of rows) {
      const r = object(row);
      const game = oneOf(r.game, PET_GAMES);
      wallet[game].sparks += Math.min(
        100,
        Math.floor(integer(r.points, 0, Number.MAX_SAFE_INTEGER) / PET_GAME_INFO[game].unit),
      );
      wallet[game].attempts += integer(r.attempts, 0, 5);
    }
    return wallet;
  }
  async leaderboard(player: Player, period: Period, since: number, scope: BlockBoardScope = {}) {
    const rows = await this.db.all(
      `WITH attempts AS (
      SELECT *,row_number() OVER(PARTITION BY player_id ORDER BY score DESC,event_order ASC) AS personal
      FROM pet_events WHERE score>0 AND created_at>=:since
      AND (:maxOrder IS NULL OR event_order<=:maxOrder)
      AND NOT EXISTS(SELECT 1 FROM ranking_blocks b WHERE b.player_id=pet_events.player_id)
      AND (:groupId IS NULL OR EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.group_id=:groupId
        AND gm.user_id=pet_events.player_id AND gm.active=1 AND gm.updated_at>=:membersSince))
    ),ranked AS (SELECT *,row_number() OVER(ORDER BY score DESC,event_order ASC) AS place FROM attempts WHERE personal=1)
    SELECT * FROM ranked WHERE place<=50 OR player_id=:player ORDER BY place`,
      {
        ':since': since,
        ':maxOrder': scope.maxResultOrder ?? null,
        ':groupId': scope.groupId ?? null,
        ':membersSince': scope.membershipCheckedSince ?? 0,
        ':player': player.id,
      },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid pet leaderboard');
    const entries = rows.map((value) => {
      const r = object(value);
      return {
        rank: r.place,
        playerId: r.player_id,
        name: r.player_name,
        score: r.score,
        runId: r.id,
      };
    });
    return decodeBlockBoard({
      period,
      entries: entries.filter((r) => typeof r.rank === 'number' && r.rank <= 50),
      me: entries.find((r) => r.playerId === player.id) ?? null,
    });
  }
  async pendingResults(limit: number): Promise<StoredPet[]> {
    const rows = await this.db.all(
      'SELECT * FROM pet_events WHERE social_processed=0 ORDER BY event_order LIMIT :limit',
      { ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid pending pet events');
    return rows.map(decodeEvent);
  }
  async processed(id: string): Promise<void> {
    await this.db.run('UPDATE pet_events SET social_processed=1 WHERE id=:id', { ':id': id });
  }
}
