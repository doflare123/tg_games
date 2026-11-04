import { api } from 'sdk';
import { integer, object, oneOf, text } from '../../shared/errors.ts';
import type {
  MessageReference,
  SendMessage,
  TelegramCommand,
  TelegramGateway,
} from '../domain/telegram.ts';
import { MembershipUnavailableError } from '../domain/telegram.ts';
import { isUnavailableMembership } from './telegram-membership-error.ts';
export const telegramGateway: TelegramGateway = {
  async sendMedia(input): Promise<MessageReference> {
    const common = {
      chat_id: input.chat_id,
      caption: input.caption,
      ...(input.reply_markup ? { reply_markup: input.reply_markup } : {}),
    };
    const value =
      input.kind === 'photo'
        ? await api.sendPhoto({ ...common, photo: input.fileId })
        : await api.sendVideo({ ...common, video: input.fileId });
    const m = object(value);
    return {
      messageId: integer(m.message_id, 1, Number.MAX_SAFE_INTEGER),
      ephemeralId: null,
      date: integer(m.date, 1, Number.MAX_SAFE_INTEGER),
    };
  },
  async edit(input) {
    try {
      await api.editMessageText(input);
    } catch (error) {
      const data = error && typeof error === 'object' ? object(error) : {};
      // Repeated clicks may render the same selection. Telegram rejects that
      // as a 400 even though the requested message is already up to date.
      if (
        data.code === 400 &&
        typeof data.description === 'string' &&
        /^Bad Request: message is not modified(?::|$)/i.test(data.description)
      )
        return;
      throw error;
    }
  },
  async privateCommands(commands) {
    await api.setMyCommands({ commands, scope: { type: 'all_private_chats' } });
  },
  async answerCallback(id, message) {
    await api.answerCallbackQuery({ callback_query_id: id, ...(message ? { text: message } : {}) });
  },
  async me() {
    const me = object(await api.getMe());
    return {
      id: integer(me.id, 1, Number.MAX_SAFE_INTEGER),
      username: text(me.username, 1, 64),
      hasMainMiniApp: me.has_main_web_app === true,
    };
  },
  async member(chatId, userId) {
    let response: unknown;
    try {
      response = await api.getChatMember({ chat_id: chatId, user_id: userId });
    } catch (error) {
      if (isUnavailableMembership(error)) throw new MembershipUnavailableError();
      throw error;
    }
    const m = object(response);
    const status = oneOf(m.status, [
      'creator',
      'administrator',
      'member',
      'restricted',
      'left',
      'kicked',
    ]);
    if (status === 'restricted' && typeof m.is_member !== 'boolean')
      throw new Error('Invalid restricted membership');
    return {
      active:
        status === 'creator' ||
        status === 'administrator' ||
        status === 'member' ||
        (status === 'restricted' && m.is_member === true),
      admin: status === 'creator' || status === 'administrator',
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
