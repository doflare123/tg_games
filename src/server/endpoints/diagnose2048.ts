import { api, db, EndpointError } from 'sdk';
import { integer, object } from '../../shared/errors.ts';

// Read-only CLI diagnostics: no game data, memberships or delivery state are changed.
export default async function diagnose(_input: unknown, context: unknown) {
  const ctx = object(context);
  if (ctx.maintenance !== true || ctx.initData !== undefined)
    throw new EndpointError('Только служебный CLI-вызов', { code: 'UNAUTHORIZED' });
  const groupRows = await db.all('SELECT id FROM groups WHERE active=1 AND bot_admin=1 LIMIT 10');
  const players = await db.all(`SELECT DISTINCT player_id FROM (
    SELECT player_id FROM runs WHERE status='verified'
    UNION SELECT player_id FROM manual_results
    UNION SELECT player_id FROM minesweeper_runs WHERE status='won'
    UNION SELECT player_id FROM puzzle2048_runs WHERE status='verified'
  ) LIMIT 30`);
  if (!Array.isArray(groupRows) || !Array.isArray(players))
    throw new Error('Invalid diagnostic rows');
  const membership = [];
  for (const group of groupRows) {
    const chatId = integer(object(group).id, -Number.MAX_SAFE_INTEGER, -1);
    for (const player of players) {
      const playerId = integer(object(player).player_id, 1, Number.MAX_SAFE_INTEGER);
      try {
        const member = object(await api.getChatMember({ chat_id: chatId, user_id: playerId }));
        membership.push({ chatId, playerId, status: member.status });
      } catch (error) {
        membership.push({
          chatId,
          playerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return {
    now: Date.now(),
    membership,
    totals: await db.all(`SELECT status,COUNT(*) AS total,MAX(score) AS best,
      SUM(CASE WHEN social_processed=0 THEN 1 ELSE 0 END) AS pending
      FROM puzzle2048_runs GROUP BY status`),
    recent: await db.all(`SELECT id,player_id,ruleset,status,score,created_at,verified_at,
      verified_order,social_processed,json_extract(state_json,'$.moves') AS moves
      FROM puzzle2048_runs ORDER BY created_at DESC LIMIT 15`),
    groups: await db.all(`SELECT id,active,bot_admin,notifications_enabled,enabled_at,
      next_notification_at,last_notification_job FROM groups ORDER BY id LIMIT 20`),
    jobs: await db.all(`SELECT id,status,due_at,expires_at,attempts,error,
      json_extract(payload,'$.chatId') AS group_id,json_extract(payload,'$.runId') AS run_id
      FROM social_jobs WHERE json_extract(payload,'$.game')='2048' ORDER BY due_at DESC LIMIT 20`),
  };
}
