import {
  type AdminPreview,
  type AdminStats,
  adminActionInput,
  adminListInput,
  adminMutationInput,
  decodeAdminPage,
  decodeAdminPreview,
  decodeAdminStats,
} from '../../shared/admin.ts';
import type { Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { ADMIN_WEEK_MS, adminWeekStart, requireAdmin } from '../domain/admin.ts';
import { ADMIN_REQUIRED_TRIGGERS } from './admin-ddl.ts';
import {
  ADMIN_ATTEMPTS,
  ADMIN_OPERATIONS,
  ADMIN_PLAYERS,
  ADMIN_VIEWS,
} from './admin-definitions.ts';
import type { SqlDatabase } from './sql-repository.ts';

export class SqlAdminRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => number,
  ) {}
  private async ready(player: Player): Promise<number> {
    requireAdmin(player);
    const schema = await this.db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_meta'",
    );
    if (schema == null)
      throw new AppError(
        'UNAVAILABLE',
        'Кабинет ещё не подготовлен. Нужна служебная миграция admin:install.',
      );
    const meta = await this.db.get("SELECT installed_at FROM admin_meta WHERE id='v1'");
    if (meta == null)
      throw new AppError(
        'UNAVAILABLE',
        'Подготовка кабинета не завершена. Нужна служебная миграция admin:install.',
      );
    const triggers = object(
      await this.db.get(
        `SELECT count(*) AS total FROM sqlite_master WHERE type='trigger' AND name IN (${ADMIN_REQUIRED_TRIGGERS.map((name) => `'${name}'`).join(',')})`,
      ),
    );
    if (triggers.total !== ADMIN_REQUIRED_TRIGGERS.length)
      throw new AppError(
        'UNAVAILABLE',
        'Защита изменений не установлена. Повтори служебную миграцию admin:install.',
      );
    return integer(object(meta).installed_at, 0, Number.MAX_SAFE_INTEGER);
  }
  async observe(player: Player): Promise<void> {
    const exists = await this.db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_meta'",
    );
    if (exists == null || (await this.db.get("SELECT id FROM admin_meta WHERE id='v1'")) == null)
      return;
    const now = this.now();
    const day = Math.floor(now / 86400000) * 86400000;
    await this.db.run(
      `INSERT INTO admin_visits(id,player_id,player_name,day,first_seen,last_seen) VALUES(:id,:player,:name,:day,:now,:now)
      ON CONFLICT(id) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen),player_name=excluded.player_name WHERE last_seen<=:now-300000 OR player_name<>:name`,
      {
        ':id': `${player.id}:${day}`,
        ':player': player.id,
        ':name': player.name,
        ':day': day,
        ':now': now,
      },
    );
  }
  async observeGroup(payload: unknown): Promise<void> {
    const update = object(payload);
    const chat = object(update.chat);
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const active = (value: unknown) => {
      const member = object(value);
      const status = oneOf(member.status, [
        'member',
        'administrator',
        'creator',
        'restricted',
        'left',
        'kicked',
      ]);
      if (status === 'restricted' && typeof member.is_member !== 'boolean')
        throw new AppError('BAD_INPUT', 'Некорректное участие бота');
      return (
        status === 'member' ||
        status === 'administrator' ||
        status === 'creator' ||
        (status === 'restricted' && member.is_member === true)
      );
    };
    const wasActive = active(update.old_chat_member);
    const isActive = active(update.new_chat_member);
    if (wasActive === isActive) return;
    const group = integer(chat.id, -Number.MAX_SAFE_INTEGER, -1);
    const at = integer(update.date, 0, Math.floor(Number.MAX_SAFE_INTEGER / 1000)) * 1000;
    const exists = await this.db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_meta'",
    );
    if (exists == null || (await this.db.get("SELECT id FROM admin_meta WHERE id='v1'")) == null)
      return;
    // Metrics count distinct groups in a period; Telegram event time deduplicates retries.
    await this.db.run(
      `INSERT INTO admin_group_events(group_id,kind,at) SELECT :group,:kind,:at WHERE NOT EXISTS(SELECT 1 FROM admin_group_events WHERE group_id=:group AND kind=:kind AND at=:at)`,
      { ':group': group, ':kind': isActive ? 'added' : 'removed', ':at': at },
    );
  }
  async stats(player: Player, input: unknown): Promise<AdminStats> {
    const trackingSince = await this.ready(player);
    const weeks = integer(object(input).weeks ?? 8, 4, 12);
    const now = this.now();
    const start = adminWeekStart(now);
    const windows = Array.from({ length: weeks }, (_, i) => [
      start - i * ADMIN_WEEK_MS,
      i === 0 ? now : start - (i - 1) * ADMIN_WEEK_MS,
    ]);
    windows.push([start - ADMIN_WEEK_MS, now - ADMIN_WEEK_MS]);
    // All window bounds come from the server clock; clients cannot supply SQL or dates.
    const rows =
      await this.db.all(`WITH attempts AS (${ADMIN_ATTEMPTS}), windows(position,start,end) AS (VALUES ${windows.map(([a, b], i) => `(${i},${a},${b})`).join(',')}), first_visits AS (SELECT player_id,min(first_seen) AS at FROM admin_visits GROUP BY player_id)
      SELECT start,end,
      (SELECT count(*) FROM attempts WHERE at>=start AND at<end) AS attempts,
      (SELECT count(*) FROM attempts WHERE at>=start AND at<end AND ranked=1) AS results,
      (SELECT count(DISTINCT player_id) FROM attempts WHERE at>=start AND at<end) AS players,
      (SELECT count(DISTINCT player_id) FROM admin_visits WHERE day>=CAST(start/86400000 AS INTEGER)*86400000 AND day<end AND first_seen<end) AS visitors,
      (SELECT count(*) FROM first_visits WHERE at>=start AND at<end) AS newVisitors,
      (SELECT count(DISTINCT group_id) FROM admin_group_events WHERE kind='added' AND at>=start AND at<end) AS added,
      (SELECT count(DISTINCT group_id) FROM admin_group_events WHERE kind='removed' AND at>=start AND at<end) AS removed FROM windows ORDER BY position`);
    if (!Array.isArray(rows) || rows.length !== weeks + 1)
      throw new Error('Invalid statistics windows');
    const totals = await this.db.get(
      `SELECT (SELECT count(*) FROM (${ADMIN_PLAYERS})) AS players,(SELECT count(*) FROM groups) AS groups,(SELECT count(*) FROM groups WHERE active=1) AS activeGroups,(SELECT count(*) FROM ranking_blocks) AS blocked,((SELECT count(*) FROM social_jobs WHERE status IN ('pending','running'))+(SELECT count(*) FROM communication_jobs WHERE status IN ('pending','running'))) AS pendingJobs`,
    );
    const games = await this.db.all(
      `WITH attempts AS (${ADMIN_ATTEMPTS}) SELECT game,count(*) AS attempts,sum(ranked) AS results,count(DISTINCT player_id) AS players FROM attempts WHERE at>=:start AND at<:now GROUP BY game ORDER BY attempts DESC,game`,
      { ':start': start, ':now': now },
    );
    return decodeAdminStats({
      now,
      trackingSince,
      weeks: rows.slice(0, weeks),
      previousMatched: rows[weeks],
      totals,
      games,
    });
  }
  async list(player: Player, input: unknown) {
    await this.ready(player);
    const { table, page, search } = adminListInput(input);
    const definition = ADMIN_VIEWS[table];
    const rows = await this.db.all(
      `SELECT ${definition.columns.join(',')} FROM ${definition.source} WHERE :search='' OR ${definition.columns.map((column) => `instr(lower(CAST(${column} AS TEXT)),lower(:search))>0`).join(' OR ')} ORDER BY ${definition.order} LIMIT 26 OFFSET :offset`,
      { ':search': search, ':offset': page * 25 },
    );
    if (!Array.isArray(rows)) throw new Error('Invalid table rows');
    return decodeAdminPage({
      table,
      page,
      hasMore: rows.length > 25,
      columns: definition.columns,
      rows: rows.slice(0, 25),
    });
  }
  async preview(player: Player, input: unknown): Promise<AdminPreview> {
    await this.ready(player);
    const request = adminActionInput(input);
    const spec = ADMIN_OPERATIONS[request.action];
    const row = await this.db.get(
      `SELECT ${spec.before} AS before,${spec.after} AS after FROM ${spec.table} WHERE CAST(${spec.key} AS TEXT)=:target AND (${spec.eligible})`,
      { ':target': request.target },
    );
    if (row == null)
      throw new AppError(
        'CONFLICT',
        'Запись изменилась или действие к ней неприменимо. Обнови таблицу.',
      );
    return decodeAdminPreview({ ...request, ...object(row) });
  }
  async apply(player: Player, input: unknown): Promise<{ id: string }> {
    await this.ready(player);
    const request = adminMutationInput(input);
    const spec = ADMIN_OPERATIONS[request.action];
    // One INSERT and its trigger are one SQLite transaction: mutation, notification
    // suppression and audit either all succeed or all roll back. The preview is a CAS.
    await this.db.run(
      `INSERT INTO admin_audit(id,actor_id,action,target,reason,created_at,before_json,after_json)
      SELECT :id,:actor,:action,:target,:reason,:now,${spec.before},${spec.after} FROM ${spec.table}
      WHERE CAST(${spec.key} AS TEXT)=:target AND (${spec.eligible}) AND ${spec.before}=:before AND ${spec.after}=:after
      ON CONFLICT(id) DO NOTHING`,
      {
        ':id': request.requestId,
        ':actor': player.id,
        ':action': request.action,
        ':target': request.target,
        ':reason': request.reason,
        ':now': this.now(),
        ':before': request.before,
        ':after': request.after,
      },
    );
    const result = await this.db.get('SELECT * FROM admin_audit WHERE id=:id', {
      ':id': request.requestId,
    });
    if (result == null)
      throw new AppError('CONFLICT', 'Запись изменилась. Заново открой предварительный просмотр.');
    const audit = object(result);
    if (
      audit.actor_id !== player.id ||
      audit.action !== request.action ||
      audit.target !== request.target ||
      audit.reason !== request.reason ||
      audit.before_json !== request.before ||
      audit.after_json !== request.after
    )
      throw new AppError('CONFLICT', 'Ключ операции уже использован');
    return { id: text(audit.id, 16, 64) };
  }
}
