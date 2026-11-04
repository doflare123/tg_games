import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { groupId } from '../../shared/groups.ts';
import { OWNER_ID } from '../domain/admin.ts';
import {
  type Broadcast,
  type CommunicationJob,
  type CommunicationSession,
  type CommunicationsRepository,
  DELIVERY_STATES,
  type DeliveryState,
  type SupportMessage,
  type SupportThread,
} from '../domain/communications-repository.ts';
import { decodeSupportMedia } from '../domain/support-media.ts';
import { SUPPORT_THREAD_SELECT } from './communications-ddl.ts';
import type { SqlDatabase } from './sql-repository.ts';
import { returnedRows } from './sql-write.ts';

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid communication rows');
  return value.map(object);
}
function ids(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new AppError('BAD_INPUT', 'Слишком много получателей');
  return [...new Set(value.map(groupId))];
}
function broadcast(value: unknown): Broadcast {
  const r = object(value);
  return {
    id: text(r.id, 1, 40),
    body: text(r.body, 1, 3000),
    groupIds: ids(JSON.parse(text(r.group_ids_json, 2, 30000))),
    status: oneOf(r.status, ['draft', 'queued', 'cancelled']),
    createdAt: integer(r.created_at, 0, Number.MAX_SAFE_INTEGER),
  };
}
function thread(value: unknown): SupportThread {
  const r = object(value);
  return {
    id: integer(r.id, 1, Number.MAX_SAFE_INTEGER),
    playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
    name: text(r.player_name, 1, 100),
    updatedAt: integer(r.updated_at, 0, Number.MAX_SAFE_INTEGER),
    status: oneOf(r.thread_status, ['new', 'waiting', 'answered']),
    closed: integer(r.closed, 0, 1) === 1,
    incomingOrder: integer(r.last_incoming_order, 0, Number.MAX_SAFE_INTEGER),
  };
}
export class SqlCommunicationsRepository implements CommunicationsRepository {
  constructor(private readonly db: SqlDatabase) {}
  private async ready(): Promise<void> {
    const installed = rows(
      await this.db.all(
        "SELECT name FROM sqlite_master WHERE (type='trigger' AND name IN ('broadcast_delivery','broadcast_cancel')) OR (type='trigger' AND name IN ('support_message_delivery','support_thread_activity') AND sql LIKE '%support_cases%') OR (type='table' AND name='communication_attachments')",
      ),
    );
    if (installed.length !== 5)
      throw new AppError(
        'UNAVAILABLE',
        'Обращения и рассылки ещё не подключены владельцем. Попробуй позже.',
      );
  }
  async receive(message: SupportMessage, name: string): Promise<boolean> {
    await this.ready();
    const media = message.media === undefined ? undefined : decodeSupportMedia(message.media);
    const mediaJson = media === undefined ? null : JSON.stringify(media);
    const old = await this.db.get(
      'SELECT m.*,a.media_json FROM support_messages m LEFT JOIN communication_attachments a ON a.id=m.id WHERE m.id=:id',
      {
        ':id': message.id,
      },
    );
    if (old != null) {
      const r = object(old);
      if (
        r.player_id !== message.playerId ||
        r.direction !== message.direction ||
        (message.threadId !== undefined && r.thread_id !== message.threadId) ||
        r.body !== message.body ||
        (r.media_json ?? null) !== mediaJson
      )
        throw new AppError('CONFLICT', 'Сообщение с этим ключом уже существует');
      return false;
    }
    if (message.direction === 'owner') {
      const target =
        message.threadId === undefined ? null : await this.conversation(message.threadId);
      if (!target || target.playerId !== message.playerId || target.closed)
        throw new AppError('CONFLICT', 'Обращение закрыто. Открой нужное обращение перед ответом.');
    }
    // Metadata is durable before the atomic message + outbox INSERT. An interrupted
    // intake can leave only metadata, never an accepted message missing its media.
    if (mediaJson !== null) {
      await this.db.run(
        'INSERT INTO communication_attachments(id,media_json) VALUES(:id,:media) ON CONFLICT(id) DO NOTHING',
        { ':id': message.id, ':media': mediaJson },
      );
    }
    const savedMedia = await this.db.get(
      'SELECT media_json FROM communication_attachments WHERE id=:id',
      { ':id': message.id },
    );
    if ((savedMedia == null ? null : object(savedMedia).media_json) !== mediaJson)
      throw new AppError('CONFLICT', 'Вложение с этим ключом уже существует');
    const inserted = returnedRows(
      await this.db.run(
        `INSERT INTO support_messages(id,player_id,thread_id,player_name,direction,body,created_at)
      SELECT :id,:player,:thread,:name,:direction,:body,:now WHERE
      (:direction='owner' AND EXISTS(SELECT 1 FROM support_cases WHERE id=:thread AND player_id=:player AND closed=0)) OR (:direction='player' AND (
      (SELECT count(DISTINCT CASE WHEN json_extract(a.media_json,'$.albumId') IS NULL THEN 'message:'||m.id ELSE 'album:'||json_extract(a.media_json,'$.albumId') END)
        FROM support_messages m LEFT JOIN communication_attachments a ON a.id=m.id
        WHERE m.player_id=:player AND m.direction='player' AND m.created_at>:since)<5
      OR (:album IS NOT NULL AND EXISTS(SELECT 1 FROM support_messages m JOIN communication_attachments a ON a.id=m.id
        WHERE m.player_id=:player AND m.direction='player' AND m.created_at>:since AND json_extract(a.media_json,'$.albumId')=:album))))
      ON CONFLICT(id) DO NOTHING RETURNING id`,
        {
          ':id': message.id,
          ':player': message.playerId,
          ':thread': message.threadId ?? null,
          ':name': text(name, 1, 100),
          ':direction': message.direction,
          ':body': message.body,
          ':now': message.createdAt,
          ':since': message.createdAt - 60000,
          ':album': media?.albumId ?? null,
        },
      ),
    );
    if (!inserted.length) {
      const duplicate = await this.db.get('SELECT id FROM support_messages WHERE id=:id', {
        ':id': message.id,
      });
      if (duplicate != null) return false;
      if (message.direction === 'owner')
        throw new AppError('CONFLICT', 'Обращение закрыто. Открой нужное обращение перед ответом.');
      throw new AppError(
        'RATE_LIMIT',
        'Не больше пяти сообщений в минуту. Попробуй немного позже.',
      );
    }
    return true;
  }
  async threads(page: number, closed = false) {
    return rows(
      await this.db.all(
        `${SUPPORT_THREAD_SELECT} WHERE closed=:closed ORDER BY updated_at DESC,id DESC LIMIT 9 OFFSET :offset`,
        { ':offset': integer(page, 0, 9999) * 8, ':closed': closed ? 1 : 0 },
      ),
    ).map(thread);
  }
  async thread(playerId: number) {
    const row = await this.db.get(
      `${SUPPORT_THREAD_SELECT} WHERE player_id=:player ORDER BY closed,id DESC LIMIT 1`,
      {
        ':player': playerId,
      },
    );
    if (row == null) return null;
    return thread(row);
  }
  async conversation(threadId: number) {
    const row = await this.db.get(`${SUPPORT_THREAD_SELECT} WHERE id=:thread`, {
      ':thread': integer(threadId, 1, Number.MAX_SAFE_INTEGER),
    });
    return row == null ? null : thread(row);
  }
  async markRead(threadId: number, throughOrder: number) {
    await this.db.run(
      `UPDATE support_cases SET read_order=MAX(read_order,:through)
       WHERE id=:thread AND :through<=COALESCE((SELECT MAX(rowid) FROM support_messages
         WHERE thread_id=:thread AND direction='player'),0)`,
      { ':thread': threadId, ':through': integer(throughOrder, 0, Number.MAX_SAFE_INTEGER) },
    );
  }
  async closeThread(threadId: number, closed: boolean) {
    const updated = returnedRows(
      await this.db.run(
        `UPDATE support_cases SET closed=:closed WHERE id=:thread AND
        (:closed=1 OR NOT EXISTS(SELECT 1 FROM support_cases newer WHERE newer.player_id=support_cases.player_id AND newer.id!=support_cases.id AND newer.closed=0)) AND
        (:closed=0 OR read_order>=COALESCE((SELECT MAX(rowid) FROM support_messages
          WHERE thread_id=:thread AND direction='player'),0)) RETURNING id`,
        { ':thread': threadId, ':closed': closed ? 1 : 0 },
      ),
    );
    if (!updated.length)
      throw new AppError(
        'CONFLICT',
        closed
          ? 'Пришло новое сообщение. Открой диалог перед закрытием.'
          : 'У игрока уже есть активное обращение. Открой его в списке обращений.',
      );
  }
  async history(playerId: number, page = 0, threadId?: number): Promise<SupportMessage[]> {
    return rows(
      await this.db.all(
        `SELECT m.*,j.status,a.media_json FROM support_messages m JOIN communication_jobs j ON j.id=m.id
        LEFT JOIN communication_attachments a ON a.id=m.id
      WHERE m.player_id=:player AND m.thread_id=COALESCE(:thread,(SELECT id FROM support_cases WHERE player_id=:player ORDER BY closed,id DESC LIMIT 1))
      ORDER BY m.rowid DESC LIMIT 11 OFFSET :offset`,
        {
          ':player': playerId,
          ':thread': threadId ?? null,
          ':offset': integer(page, 0, 9999) * 10,
        },
      ),
    )
      .reverse()
      .map((r) => ({
        id: text(r.id, 1, 100),
        threadId: integer(r.thread_id, 1, Number.MAX_SAFE_INTEGER),
        playerId: integer(r.player_id, 1, Number.MAX_SAFE_INTEGER),
        direction: oneOf(r.direction, ['player', 'owner']),
        body: text(r.body, 1, 3000),
        createdAt: integer(r.created_at, 0, Number.MAX_SAFE_INTEGER),
        delivery: oneOf(r.status, DELIVERY_STATES),
        ...(r.media_json == null
          ? {}
          : { media: decodeSupportMedia(JSON.parse(text(r.media_json, 1, 5000))) }),
      }));
  }
  async recipientForReply(messageId: number) {
    const row = await this.db.get(
      "SELECT player_id FROM communication_jobs WHERE chat_id=:owner AND telegram_message_id=:id AND kind='owner_inbox' AND status='sent'",
      { ':owner': OWNER_ID, ':id': messageId },
    );
    return row == null ? null : integer(object(row).player_id, 1, Number.MAX_SAFE_INTEGER);
  }
  async threadForReply(messageId: number) {
    const row = await this.db.get(
      "SELECT m.thread_id FROM communication_jobs j JOIN support_messages m ON m.id=j.id WHERE j.chat_id=:owner AND j.telegram_message_id=:id AND j.kind='owner_inbox' AND j.status='sent'",
      { ':owner': OWNER_ID, ':id': messageId },
    );
    return row == null
      ? null
      : this.conversation(integer(object(row).thread_id, 1, Number.MAX_SAFE_INTEGER));
  }
  async session(now: number): Promise<CommunicationSession | null> {
    const row = await this.db.get(
      'SELECT data_json FROM communication_sessions WHERE actor_id=:owner AND updated_at>=:since',
      { ':owner': OWNER_ID, ':since': now - 86400000 },
    );
    if (row == null) return null;
    const s = object(JSON.parse(text(object(row).data_json, 1, 40000)));
    return {
      mode: oneOf(s.mode, ['groups', 'broadcast_text', 'reply']),
      id: text(s.id, 1, 40),
      selected: ids(s.selected),
      playerId: integer(s.playerId, 0, Number.MAX_SAFE_INTEGER),
      ...(s.threadId === undefined
        ? {}
        : { threadId: integer(s.threadId, 1, Number.MAX_SAFE_INTEGER) }),
      page: integer(s.page, 0, 10000),
      ...(s.panelMessageId === undefined
        ? {}
        : { panelMessageId: integer(s.panelMessageId, 1, Number.MAX_SAFE_INTEGER) }),
    };
  }
  async setSession(session: CommunicationSession | null, now: number) {
    if (session === null) {
      await this.db.run('DELETE FROM communication_sessions WHERE actor_id=:owner', {
        ':owner': OWNER_ID,
      });
      return;
    }
    await this.db.run(
      `INSERT INTO communication_sessions(actor_id,data_json,updated_at) VALUES(:owner,:data,:now)
      ON CONFLICT(actor_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`,
      { ':owner': OWNER_ID, ':data': JSON.stringify(session), ':now': now },
    );
  }
  async groups() {
    const result = rows(
      await this.db.all('SELECT id,title FROM groups WHERE active=1 ORDER BY title,id LIMIT 1001'),
    );
    if (result.length > 1000)
      throw new AppError('UNAVAILABLE', 'Выбор более 1000 групп пока недоступен');
    return result.map((r) => ({ id: groupId(r.id), title: text(r.title, 1, 256) }));
  }
  async draft(value: Broadcast) {
    await this.ready();
    await this.db.run(
      `INSERT INTO broadcasts(id,body,group_ids_json,status,created_at) VALUES(:id,:body,:groups,'draft',:now) ON CONFLICT(id) DO NOTHING`,
      {
        ':id': value.id,
        ':body': value.body,
        ':groups': JSON.stringify(value.groupIds),
        ':now': value.createdAt,
      },
    );
    const saved = await this.broadcast(value.id);
    if (
      !saved ||
      saved.body !== value.body ||
      JSON.stringify(saved.groupIds) !== JSON.stringify(value.groupIds)
    )
      throw new AppError('CONFLICT', 'Этот черновик уже содержит другой текст');
  }
  async broadcast(id: string) {
    const row = await this.db.get('SELECT * FROM broadcasts WHERE id=:id', { ':id': id });
    return row == null ? null : broadcast(row);
  }
  async confirm(id: string, now: number) {
    await this.ready();
    await this.db.run(
      "UPDATE broadcasts SET status='queued',confirmed_at=:now WHERE id=:id AND status='draft' AND created_at>=:since",
      { ':id': id, ':now': now, ':since': now - 86400000 },
    );
    const saved = await this.broadcast(id);
    if (saved?.status !== 'queued')
      throw new AppError('CONFLICT', 'Черновик отменён или истёк. Создай новый.');
  }
  async cancel(id: string) {
    await this.db.run(
      "UPDATE broadcasts SET status='cancelled' WHERE id=:id AND status IN ('draft','queued')",
      { ':id': id },
    );
  }
  async claim(now: number, broadcastId?: string): Promise<CommunicationJob | null> {
    // Release only the obsolete application cooldown; Telegram retry_after stays intact.
    await this.db.run(
      "UPDATE communication_jobs SET due_at=:now,error=NULL WHERE kind='broadcast' AND status='pending' AND error='Group cooldown' AND due_at>:now",
      { ':now': now },
    );
    // A worker lost after send may already have delivered the message. Never blindly resend.
    await this.db.run(
      "UPDATE communication_jobs SET status='uncertain',lease_until=0,error='Worker interrupted; check before retry' WHERE status='running' AND lease_until<=:now",
      { ':now': now },
    );
    const row = returnedRows(
      await this.db.run(
        `UPDATE communication_jobs SET status='running',attempts=attempts+1,lease_until=:lease
      WHERE id=(SELECT id FROM communication_jobs WHERE status='pending' AND due_at<=:now AND (:broadcast IS NULL OR (kind='broadcast' AND id LIKE 'broadcast:'||:broadcast||':%')) ORDER BY due_at,id LIMIT 1) RETURNING *`,
        { ':now': now, ':lease': now + 60000, ':broadcast': broadcastId ?? null },
      ),
    )[0];
    if (row === undefined) return null;
    const r = object(row);
    const attachment = await this.db.get(
      'SELECT media_json FROM communication_attachments WHERE id=:id',
      { ':id': text(r.id, 1, 100) },
    );
    const message = await this.db.get('SELECT thread_id FROM support_messages WHERE id=:id', {
      ':id': text(r.id, 1, 100),
    });
    return {
      id: text(r.id, 1, 100),
      ...(message == null
        ? {}
        : { threadId: integer(object(message).thread_id, 1, Number.MAX_SAFE_INTEGER) }),
      kind: oneOf(r.kind, ['owner_inbox', 'player_reply', 'broadcast']),
      playerId: integer(r.player_id, 0, Number.MAX_SAFE_INTEGER),
      chatId: integer(r.chat_id, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      body: text(r.body, 1, 4096),
      attempts: integer(r.attempts, 1, 100),
      expiresAt: integer(r.expires_at, 0, Number.MAX_SAFE_INTEGER),
      ...(attachment == null
        ? {}
        : { media: decodeSupportMedia(JSON.parse(text(object(attachment).media_json, 1, 5000))) }),
    };
  }
  async finish(
    job: CommunicationJob,
    status: DeliveryState,
    error?: string,
    telegramMessageId?: number,
  ) {
    await this.db.run(
      `UPDATE communication_jobs SET status=:status,lease_until=0,error=:error,telegram_message_id=:telegram
      WHERE id=:id AND status='running' AND attempts=:attempt`,
      {
        ':id': job.id,
        ':attempt': job.attempts,
        ':status': status,
        ':error': error?.slice(0, 300) ?? null,
        ':telegram': telegramMessageId ?? null,
      },
    );
  }
  async retry(job: CommunicationJob, at: number, error: string, cooldown = false) {
    await this.db.run(
      `UPDATE communication_jobs SET status='pending',lease_until=0,due_at=:at,error=:error,attempts=attempts-:cooldown
      WHERE id=:id AND status='running' AND attempts=:attempt`,
      {
        ':id': job.id,
        ':attempt': job.attempts,
        ':at': at,
        ':error': error.slice(0, 300),
        ':cooldown': Number(cooldown),
      },
    );
  }
  async deliverySummary(broadcastId?: string) {
    return rows(
      await this.db.all(
        "SELECT status,count(*) AS total FROM communication_jobs WHERE :broadcast IS NULL OR (kind='broadcast' AND id LIKE 'broadcast:'||:broadcast||':%') GROUP BY status",
        { ':broadcast': broadcastId ?? null },
      ),
    ).map((r) => ({
      status: oneOf(r.status, DELIVERY_STATES),
      count: integer(r.total, 0, Number.MAX_SAFE_INTEGER),
    }));
  }
  async deliveryIssues() {
    return rows(
      await this.db.all(
        "SELECT id,chat_id,status,error FROM communication_jobs WHERE status IN ('failed','uncertain') ORDER BY created_at DESC LIMIT 5",
      ),
    ).map((r) => ({
      id: text(r.id, 1, 100),
      chatId: integer(r.chat_id, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      status: oneOf(r.status, DELIVERY_STATES),
      error: typeof r.error === 'string' ? r.error : 'Ошибка доставки',
    }));
  }
  async retryDelivery(id: string, now: number) {
    await this.db.run(
      "UPDATE communication_jobs SET status='pending',due_at=:now,expires_at=:expires,attempts=0,lease_until=0,error=NULL WHERE id=:id AND status IN ('failed','uncertain') AND (kind<>'broadcast' OR EXISTS(SELECT 1 FROM broadcasts b WHERE communication_jobs.id='broadcast:'||b.id||':'||communication_jobs.chat_id AND b.status='queued'))",
      { ':id': id, ':now': now, ':expires': now + 86400000 },
    );
  }
}
