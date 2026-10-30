import { api } from 'sdk';
import { integer, object, text } from '../../shared/errors.ts';
import type {
  MessageReference,
  SendMessage,
  TelegramCommand,
  TelegramGateway,
} from '../domain/telegram.ts';
export const telegramGateway: TelegramGateway = {
  async me() {
    const me = object(await api.getMe());
    return {
      id: integer(me.id, 1, Number.MAX_SAFE_INTEGER),
      username: text(me.username, 1, 64),
      hasMainMiniApp: me.has_main_web_app === true,
    };
  },
  async member(chatId, userId) {
    const m = object(await api.getChatMember({ chat_id: chatId, user_id: userId }));
    return {
      active:
        m.status === 'creator' ||
        m.status === 'administrator' ||
        m.status === 'member' ||
        (m.status === 'restricted' && m.is_member === true),
      admin: m.status === 'creator' || m.status === 'administrator',
    };
  },
  async send(input: SendMessage): Promise<MessageReference> {
    const m = object(await api.sendMessage(input));
    return {
      messageId:
        typeof m.message_id === 'number' && m.message_id > 0
          ? integer(m.message_id, 1, Number.MAX_SAFE_INTEGER)
          : null,
      ephemeralId:
        typeof m.ephemeral_message_id === 'number'
          ? integer(m.ephemeral_message_id, 0, Number.MAX_SAFE_INTEGER)
          : null,
      date: integer(m.date, 1, Number.MAX_SAFE_INTEGER),
    };
  },
  async commands(commands: TelegramCommand[], chatId?: number) {
    await api.setMyCommands({
      commands,
      scope: chatId === undefined ? { type: 'all_group_chats' } : { type: 'chat', chat_id: chatId },
    });
  },
};
