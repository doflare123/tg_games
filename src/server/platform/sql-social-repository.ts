import { integer, object, oneOf, text } from '../../shared/errors.ts';
import type { GroupRecord, Membership } from '../../shared/groups.ts';
import { groupId } from '../../shared/groups.ts';
import type { ArcadeRepository } from '../domain/repository.ts';
import type { JobPayload, SocialJob, SocialRepository } from '../domain/social-repository.ts';
import type { SqlDatabase } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

function decodeGroup(value: unknown): GroupRecord {
  const r = object(value);
  return {
    id: groupId(r.id),
    title: text(r.title, 1, 256),
    active: r.active === 1,
    botAdmin: r.bot_admin === 1,
    notificationsEnabled: r.notifications_enabled === 1,
    notificationThreadId:
      r.notification_thread_id === null
        ? null
        : integer(r.notification_thread_id, 1, Number.MAX_SAFE_INTEGER),
    enabledAt: integer(r.enabled_at, 0, Number.MAX_SAFE_INTEGER),
    nextNotificationAt: integer(r.next_notification_at, 0, Number.MAX_SAFE_INTEGER),
  };
}
function decodeJob(value: unknown): SocialJob {
  const r = object(value);
  const p = object(JSON.parse(text(r.payload, 1, 20000)));
  oneOf(p.type, ['record']);
  const chatId = groupId(p.chatId);
  const payload: JobPayload = {
    type: 'record',
    game:
      p.game === undefined
        ? 'tetris'
        : oneOf(p.game, ['tetris', 'minesweeper', '2048', 'snake', 'flappy']),
    chatId,
    playerId: integer(p.playerId, 1, Number.MAX_SAFE_INTEGER),
    mode: text(p.mode, 1, 32),
    runId: text(p.runId, 1, 100),
    rank: integer(p.rank, 1, 10),
    text: text(p.text, 1, 4096),
  };
  return {
    id: text(r.id, 1, 200),
    payload,
    dueAt: integer(r.due_at, 0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(r.expires_at, 0, Number.MAX_SAFE_INTEGER),
    attempts: integer(r.attempts, 0, 100),
  };
}
export class SqlSocialRepository implements SocialRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly arcade: ArcadeRepository,
  ) {}
  async upsertGroup(group: { id: number; title: string; active: boolean; botAdmin: boolean }) {
    await this.db.run(
      `INSERT INTO groups(id,title,active,bot_admin,notifications_enabled,enabled_at,next_notification_at)
   VALUES(:id,:title,:active,:admin,0,0,0) ON CONFLICT(id) DO UPDATE SET title=excluded.title,active=excluded.active,bot_admin=excluded.bot_admin,
   notifications_enabled=CASE WHEN excluded.active=0 OR excluded.bot_admin=0 THEN 0 ELSE groups.notifications_enabled END`,
      {
        ':id': group.id,
        ':title': group.title,
        ':active': Number(group.active),
        ':admin': Number(group.botAdmin),
      },
    );
  }
  async group(id: number) {
    const row = await this.db.get('SELECT * FROM groups WHERE id=:id', { ':id': id });
    return row == null ? null : decodeGroup(row);
  }
  async activeGroupIds() {
    const rows = await this.db.all('SELECT id FROM groups WHERE active=1 ORDER BY id');
    if (!Array.isArray(rows)) throw new Error('Invalid group rows');
    return rows.map((row) => groupId(object(row).id));
  }
  async observeMember(member: Membership) {
    await this.db.run(
      `INSERT INTO group_memberships(id,group_id,user_id,active,updated_at) VALUES(:key,:group,:user,:active,:updated)
   ON CONFLICT(id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at WHERE excluded.updated_at>=group_memberships.updated_at`,
      {
        ':key': `${member.chatId}:${member.userId}`,
        ':group': member.chatId,
        ':user': member.userId,
        ':active': Number(member.active),
        ':updated': member.updatedAt,
      },
    );
  }
  async groupCandidates(userId: number) {
    const rows = await this.db.all(
      `SELECT g.* FROM groups g LEFT JOIN group_memberships m ON m.group_id=g.id AND m.user_id=:user WHERE g.active=1 AND g.bot_admin=1 ORDER BY CASE WHEN m.active=1 THEN 0 ELSE 1 END,g.id LIMIT 50`,
      { ':user': userId },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid group rows');
    return rows.map(decodeGroup);
  }
  async membersToRefresh(chatId: number, checkedSince: number, limit: number) {
    const rows = await this.db.all(
      `WITH players AS (
      SELECT player_id FROM runs WHERE status='verified' UNION SELECT player_id FROM manual_results
      UNION SELECT player_id FROM minesweeper_runs WHERE status='won'
      UNION SELECT player_id FROM puzzle2048_runs WHERE status='verified'
      UNION SELECT player_id FROM snake_runs WHERE status='verified'
      UNION SELECT player_id FROM flappy_runs WHERE status='verified'
    ) SELECT p.player_id FROM players p LEFT JOIN group_memberships m ON m.user_id=p.player_id AND m.group_id=:group
      WHERE m.updated_at IS NULL OR m.updated_at<:since
      ORDER BY CASE WHEN m.updated_at IS NULL THEN 0 ELSE 1 END,m.updated_at,p.player_id LIMIT :limit`,
      { ':group': chatId, ':since': checkedSince, ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid membership candidates');
    return rows.map((row) => integer(object(row).player_id, 1, Number.MAX_SAFE_INTEGER));
  }
  async notifications(chatId: number, enabled: boolean, now: number, threadId?: number | null) {
    await this.db.run(
      `UPDATE groups SET enabled_at=CASE WHEN notifications_enabled=0 AND :enabled=1 THEN :now ELSE enabled_at END,
       notifications_enabled=:enabled,
       notification_thread_id=CASE WHEN :set_thread=1 THEN :thread ELSE notification_thread_id END WHERE id=:id`,
      {
        ':id': chatId,
        ':enabled': Number(enabled),
        ':now': now,
        ':set_thread': Number(threadId !== undefined),
        ':thread': threadId ?? null,
      },
    );
  }
  async reserveAnnouncement(chatId: number, now: number, jobId: string) {
    const result = await this.db.run(
      `UPDATE groups SET next_notification_at=CASE WHEN last_notification_job=:job THEN next_notification_at ELSE :next END,last_notification_job=:job WHERE id=:id AND active=1 AND bot_admin=1 AND notifications_enabled=1 AND (next_notification_at<=:now OR last_notification_job=:job) RETURNING id`,
      { ':id': chatId, ':now': now, ':next': now + 300000, ':job': jobId },
    );
    return returnedRows(result).length === 1;
  }
  async enqueue(job: SocialJob) {
    await this.db.run(
      `INSERT INTO social_jobs(id,payload,status,due_at,expires_at,attempts,lease_until,error) VALUES(:id,:payload,'pending',:due,:expires,0,0,NULL) ON CONFLICT(id) DO NOTHING`,
      {
        ':id': job.id,
        ':payload': JSON.stringify(job.payload),
        ':due': job.dueAt,
        ':expires': job.expiresAt,
      },
    );
  }
  async claim(now: number) {
    const result = await this.db.run(
      `UPDATE social_jobs SET status='running',attempts=attempts+1,lease_until=:lease
    WHERE id=(SELECT id FROM social_jobs WHERE (status='pending' OR (status='running' AND lease_until<=:now)) AND due_at<=:now ORDER BY due_at,id LIMIT 1)
    RETURNING *`,
      { ':now': now, ':lease': now + 60000 },
    );
    const row = returnedRows(result)[0];
    return row === undefined ? null : decodeJob(row);
  }
  async complete(job: SocialJob, status: 'done' | 'expired' | 'suppressed', error?: string) {
    await this.db.run(
      "UPDATE social_jobs SET status=:status,lease_until=0,error=:error WHERE id=:id AND attempts=:attempt AND status='running'",
      { ':id': job.id, ':attempt': job.attempts, ':status': status, ':error': error ?? null },
    );
  }
  async retry(job: SocialJob, dueAt: number, error: string) {
    await this.db.run(
      `UPDATE social_jobs SET status='pending',due_at=:due,lease_until=0,error=:error WHERE id=:id AND attempts=:attempt AND status='running'`,
      { ':id': job.id, ':attempt': job.attempts, ':due': dueAt, ':error': error.slice(0, 300) },
    );
  }
  async recover2048Expired(now: number): Promise<number> {
    // Repair only jobs that never had a valid delivery window, within the last day.
    // Successful/suppressed jobs and ordinary expired jobs are never replayed.
    const result = await this.db.run(
      `UPDATE social_jobs SET status='pending',due_at=:now,
      expires_at=:expires,attempts=0,lease_until=0,error='Recovered invalid initial deadline'
      WHERE id IN (SELECT id FROM social_jobs WHERE status='expired' AND expires_at<due_at
        AND due_at>=:since AND json_extract(payload,'$.game')='2048' ORDER BY due_at LIMIT 3)
      RETURNING id`,
      { ':now': now, ':expires': now + 86400000, ':since': now - 86400000 },
    );
    return returnedRows(result).length;
  }
  async pendingResults(limit: number) {
    const rows = await this.db.all(
      `SELECT id FROM runs WHERE status='verified' AND social_processed=0 ORDER BY verified_order LIMIT :limit`,
      { ':limit': limit },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid pending results');
    const result = [];
    for (const row of rows) {
      const run = await this.arcade.get(text(object(row).id));
      if (run) result.push(run);
    }
    return result;
  }
  async processed(runId: string) {
    await this.db.run('UPDATE runs SET social_processed=1 WHERE id=:id', { ':id': runId });
  }
}
