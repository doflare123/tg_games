import { api, db, EndpointError } from 'sdk';
import { integer, object } from '../../shared/errors.ts';
import { MINI_APP_URL } from '../platform/mini-app-config.ts';

export default async function diagnose(_input: unknown, context: unknown) {
  const ctx = object(context);
  if (ctx.maintenance !== true || ctx.initData !== undefined)
    throw new EndpointError('Только служебный CLI-вызов', { code: 'UNAUTHORIZED' });
  const me = object(await api.getMe());
  const botId = integer(me.id, 1, Number.MAX_SAFE_INTEGER);
  const commands = await api.getMyCommands({ scope: { type: 'all_group_chats' } });
  const rows = await db.all('SELECT id,active,bot_admin FROM groups ORDER BY id LIMIT 10');
  if (!Array.isArray(rows)) throw new Error('Invalid group rows');
  const groups = [];
  for (const value of rows) {
    const row = object(value);
    const id = integer(row.id, -Number.MAX_SAFE_INTEGER, -1);
    try {
      const member = object(await api.getChatMember({ chat_id: id, user_id: botId }));
      groups.push({ id, storedAdmin: row.bot_admin === 1, currentStatus: member.status });
    } catch {
      groups.push({ id, storedAdmin: row.bot_admin === 1, currentStatus: 'unavailable' });
    }
  }
  return {
    botId,
    username: me.username,
    miniAppUrl: MINI_APP_URL,
    hasMainMiniApp: me.has_main_web_app === true,
    readsAllGroupMessages: me.can_read_all_group_messages === true,
    commands,
    groups,
  };
}
