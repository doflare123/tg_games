import type { AdminAction, AdminTable } from '../../shared/admin.ts';
import { SUPPORT_THREAD_SELECT } from './communications-ddl.ts';

export const ADMIN_RUNS = [
  ['runs', 'tetris', 'created_at', 'verified'],
  ['puzzle2048_runs', '2048', 'created_at', 'verified'],
  ['snake_runs', 'snake', 'created_at', 'verified'],
  ['flappy_runs', 'flappy', 'created_at', 'verified'],
  ['doodle_runs', 'doodle', 'created_at', 'verified'],
  ['block_blast_runs', 'block-blast', 'created_at', 'verified'],
  ['minesweeper_runs', 'minesweeper', 'started_at', 'won'],
] as const;
// Manual corrections are deliberately excluded from played-game metrics.
export const ADMIN_ATTEMPTS = ADMIN_RUNS.map(
  ([table, game, at, status]) =>
    `SELECT id,player_id,player_name,'${game}' AS game,${at} AS at,CASE WHEN status='${status}' THEN 1 ELSE 0 END AS ranked FROM ${table}`,
).join(' UNION ALL ');
export const ADMIN_PLAYERS = `SELECT player_id AS id,max(CASE WHEN recent=1 THEN player_name END) AS name,min(at) AS first_seen,max(last_seen) AS last_seen,sum(played) AS attempts FROM (SELECT *,row_number() OVER(PARTITION BY player_id ORDER BY last_seen DESC,player_name) AS recent FROM (SELECT player_id,player_name,at,at AS last_seen,1 AS played FROM (${ADMIN_ATTEMPTS}) UNION ALL SELECT player_id,player_name,first_seen,last_seen,0 FROM admin_visits UNION ALL SELECT player_id,player_name,created_at,created_at,0 FROM manual_results)) GROUP BY player_id`;
export interface TableDefinition {
  source: string;
  columns: string[];
  order: string;
}
const runColumns = ['id', 'player_id', 'player_name', 'status', 'score', 'ruleset', 'created_at'];
const recordJobColumns = [
  'id',
  'status',
  'due_at',
  'expires_at',
  'attempts',
  'lease_until',
  'error',
];
export const ADMIN_VIEWS: Record<AdminTable, TableDefinition> = {
  support_threads: {
    source: `(${SUPPORT_THREAD_SELECT})`,
    columns: [
      'id',
      'player_id',
      'player_name',
      'thread_status',
      'closed',
      'created_at',
      'updated_at',
    ],
    order: 'updated_at DESC,id DESC',
  },
  players: {
    source: `(${ADMIN_PLAYERS})`,
    columns: ['id', 'name', 'first_seen', 'last_seen', 'attempts'],
    order: 'last_seen DESC,id',
  },
  groups: {
    source: 'groups',
    columns: [
      'id',
      'title',
      'active',
      'bot_admin',
      'notifications_enabled',
      'notification_thread_id',
      'enabled_at',
      'next_notification_at',
    ],
    order: 'id',
  },
  runs: {
    source: 'runs',
    columns: [...runColumns, 'mode', 'ticks', 'lines'],
    order: 'created_at DESC,id',
  },
  puzzle2048_runs: {
    source: 'puzzle2048_runs',
    columns: [...runColumns, 'max_tile'],
    order: 'created_at DESC,id',
  },
  snake_runs: {
    source: 'snake_runs',
    columns: [...runColumns, 'size'],
    order: 'created_at DESC,id',
  },
  block_blast_runs: {
    source: 'block_blast_runs',
    columns: runColumns,
    order: 'created_at DESC,id',
  },
  flappy_runs: { source: 'flappy_runs', columns: runColumns, order: 'created_at DESC,id' },
  doodle_runs: { source: 'doodle_runs', columns: runColumns, order: 'created_at DESC,id' },
  minesweeper_runs: {
    source: 'minesweeper_runs',
    columns: ['id', 'player_id', 'player_name', 'status', 'size', 'elapsed_ms', 'started_at'],
    order: 'started_at DESC,id',
  },
  manual_results: {
    source: 'manual_results',
    columns: [
      'id',
      'player_id',
      'player_name',
      'mode',
      'ruleset',
      'group_ids_json',
      'verified_order',
      'score',
      'ticks',
      'lines',
      'reason',
      'operator',
      'approximate',
      'created_at',
    ],
    order: 'created_at DESC,id',
  },
  group_memberships: {
    source: `(SELECT *,CASE active WHEN -1 THEN 'unavailable' WHEN 1 THEN 'member' ELSE 'not_member' END AS membership_state FROM group_memberships)`,
    columns: ['id', 'group_id', 'user_id', 'active', 'membership_state', 'updated_at'],
    order: 'updated_at DESC,id',
  },
  social_jobs: {
    source: `(SELECT s.id,'records' AS queue,coalesce(json_extract(s.payload,'$.game'),'tetris') AS kind,
      json_extract(s.payload,'$.chatId') AS chat_id,g.title AS group_title,json_extract(s.payload,'$.text') AS message_text,
      s.status,s.due_at,s.expires_at,s.attempts,s.lease_until,s.error,NULL AS telegram_message_id
      FROM social_jobs s LEFT JOIN groups g ON g.id=json_extract(s.payload,'$.chatId')
      UNION ALL SELECT c.id,'communications' AS queue,c.kind,c.chat_id,g.title,c.body,
      c.status,c.due_at,c.expires_at,c.attempts,c.lease_until,c.error,c.telegram_message_id
      FROM communication_jobs c LEFT JOIN groups g ON g.id=c.chat_id)`,
    columns: [
      'id',
      'queue',
      'kind',
      'chat_id',
      'group_title',
      'message_text',
      ...recordJobColumns.slice(1),
      'telegram_message_id',
    ],
    order: 'due_at DESC,id',
  },
  ranking_blocks: {
    source: 'ranking_blocks',
    columns: ['player_id', 'reason', 'created_at'],
    order: 'created_at DESC,player_id',
  },
  admin_visits: {
    source: 'admin_visits',
    columns: ['id', 'player_id', 'player_name', 'day', 'first_seen', 'last_seen'],
    order: 'last_seen DESC,id',
  },
  admin_group_events: {
    source: 'admin_group_events',
    columns: ['id', 'group_id', 'kind', 'at'],
    order: 'at DESC,id',
  },
  admin_audit: {
    source: 'admin_audit',
    columns: [
      'id',
      'actor_id',
      'action',
      'target',
      'reason',
      'created_at',
      'before_json',
      'after_json',
    ],
    order: 'created_at DESC,id',
  },
};
export interface ActionDefinition {
  table: string;
  key: string;
  before: string;
  after: string;
  eligible: string;
  statements: string;
}
const json = (columns: string[]) => `json_object(${columns.map((c) => `'${c}',${c}`).join(',')})`;
function revoke(table: string, game: string, ranked: string): ActionDefinition {
  const columns = ADMIN_VIEWS[table as AdminTable].columns;
  return {
    table,
    key: 'id',
    before: json(columns),
    after: `json_object('status','unranked')`,
    eligible: `status='${ranked}'`,
    statements: `UPDATE ${table} SET status='unranked' WHERE id=NEW.target;
    UPDATE social_jobs SET status='suppressed',lease_until=0,error='ADMIN_REVOKED' WHERE status IN ('pending','running') AND json_extract(payload,'$.runId')=NEW.target AND coalesce(json_extract(payload,'$.game'),'tetris')='${game}';`,
  };
}
export const ADMIN_OPERATIONS: Record<AdminAction, ActionDefinition> = {
  disable_notifications: {
    table: 'groups',
    key: 'id',
    before: json(ADMIN_VIEWS.groups.columns),
    after: `json_object('notifications_enabled',0)`,
    eligible: 'notifications_enabled=1',
    statements: `UPDATE groups SET notifications_enabled=0 WHERE id=CAST(NEW.target AS INTEGER); UPDATE social_jobs SET status='suppressed',lease_until=0,error='ADMIN_DISABLED' WHERE status IN ('pending','running') AND json_extract(payload,'$.chatId')=CAST(NEW.target AS INTEGER);`,
  },
  cancel_job: {
    table: 'social_jobs',
    key: 'id',
    before: json(recordJobColumns),
    after: `json_object('status','suppressed')`,
    eligible: "status='pending'",
    statements: `UPDATE social_jobs SET status='suppressed',lease_until=0,error='ADMIN_CANCELLED' WHERE id=NEW.target;`,
  },
  block_player: {
    table: `(${ADMIN_PLAYERS})`,
    key: 'id',
    before: `json_object('player_id',id,'name',name)`,
    after: `json_object('blocked',1)`,
    eligible: 'NOT EXISTS(SELECT 1 FROM ranking_blocks WHERE player_id=id)',
    statements: `INSERT INTO ranking_blocks(player_id,reason,created_at) VALUES(CAST(NEW.target AS INTEGER),NEW.reason,NEW.created_at); UPDATE social_jobs SET status='suppressed',lease_until=0,error='RANKING_BLOCKED' WHERE status IN ('pending','running') AND json_extract(payload,'$.playerId')=CAST(NEW.target AS INTEGER);`,
  },
  unblock_player: {
    table: 'ranking_blocks',
    key: 'player_id',
    before: json(ADMIN_VIEWS.ranking_blocks.columns),
    after: `json_object('blocked',0)`,
    eligible: '1=1',
    statements: 'DELETE FROM ranking_blocks WHERE player_id=CAST(NEW.target AS INTEGER);',
  },
  revoke_tetris: revoke('runs', 'tetris', 'verified'),
  revoke_2048: revoke('puzzle2048_runs', '2048', 'verified'),
  revoke_snake: revoke('snake_runs', 'snake', 'verified'),
  revoke_flappy: revoke('flappy_runs', 'flappy', 'verified'),
  revoke_doodle: revoke('doodle_runs', 'doodle', 'verified'),
  revoke_block_blast: revoke('block_blast_runs', 'block-blast', 'verified'),
  revoke_minesweeper: revoke('minesweeper_runs', 'minesweeper', 'won'),
  remove_manual: {
    table: 'manual_results',
    key: 'id',
    before: json(ADMIN_VIEWS.manual_results.columns),
    after: `json_object('removed',1)`,
    eligible: '1=1',
    statements: `DELETE FROM manual_results WHERE id=NEW.target; UPDATE social_jobs SET status='suppressed',lease_until=0,error='ADMIN_REVOKED' WHERE status IN ('pending','running') AND json_extract(payload,'$.runId')=NEW.target;`,
  },
};
