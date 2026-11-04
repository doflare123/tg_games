import { CATALOG, type Player } from '../../shared/contracts.ts';
import { AppError, integer, object, text } from '../../shared/errors.ts';
import { launchUrl, parseLaunch } from '../../shared/launch.ts';
import { OWNER_ID } from './admin.ts';
import type { GroupService } from './groups.ts';
import type { SocialRepository } from './social-repository.ts';
import type { LaunchButton, TelegramCommand, TelegramGateway } from './telegram.ts';
export const GAME_COMMANDS: TelegramCommand[] = [
  ...CATALOG.filter((game) => game.available).map((game) => ({
    command: `game_${game.id.replaceAll('-', '_')}`,
    description: `Сразу открыть ${game.title}`,
    is_ephemeral: true,
  })),
  { command: 'game_top', description: 'Рейтинг этой группы', is_ephemeral: true },
  {
    command: 'game_notify_here',
    description: 'Слать рекорды в эту тему (админ)',
    is_ephemeral: true,
  },
  {
    command: 'game_notify_on',
    description: 'Включить объявления рекордов (админ)',
    is_ephemeral: true,
  },
  {
    command: 'game_notify_off',
    description: 'Выключить объявления рекордов (админ)',
    is_ephemeral: true,
  },
  { command: 'games', description: 'Каталог игр', is_ephemeral: true },
  {
    command: 'feedback',
    description: 'Предложить улучшение или написать владельцу',
    is_ephemeral: true,
  },
];
export class GameBotService {
  constructor(
    private readonly repository: SocialRepository,
    private readonly groups: GroupService,
    private readonly telegram: TelegramGateway,
    private readonly now: () => number,
    private readonly miniAppUrl: string,
  ) {}
  async configure(): Promise<void> {
    await this.telegram.commands(GAME_COMMANDS);
    for (const id of await this.repository.activeGroupIds())
      await this.telegram.commands(GAME_COMMANDS, id);
    if (this.telegram.privateCommands) {
      const commands = [
        { command: 'games', description: 'Открыть игры' },
        { command: 'feedback', description: 'Предложить улучшение или написать владельцу' },
      ];
      await this.telegram.privateCommands(commands);
      await this.telegram.commands(
        [...commands, { command: 'admin', description: 'Обращения и рассылки' }],
        OWNER_ID,
      );
    }
  }
  async message(payload: unknown, _context: unknown = {}): Promise<void> {
    const msg = object(payload);
    const body = typeof msg.text === 'string' ? msg.text.trim() : '';
    const match =
      /^\/(start|help|games|top|game_doom|game_mario|game_tetris|game_minesweeper|game_2048|game_snake|game_flappy|game_doodle|game_block_blast|game_top|game_notify_here|game_notify_on|game_notify_off)(?:@([a-zA-Z0-9_]+))?(?:\s|$)/.exec(
        body,
      );
    if (!match?.[1]) return;
    const me = await this.telegram.me();
    if (match[2] && match[2].toLowerCase() !== me.username.toLowerCase()) return;
    const chat = object(msg.chat);
    const chatId = integer(chat.id, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const user = object(msg.from);
    if (user.is_bot === true || msg.sender_chat) return;
    const player: Player = {
      id: integer(user.id, 1, Number.MAX_SAFE_INTEGER),
      name: text(user.first_name, 1, 128).slice(0, 100),
    };
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    if (!isGroup && chat.type !== 'private') return;
    // Ordinary reply threads are not forum topics and must not become a destination.
    const threadId =
      chat.type === 'supergroup' && msg.is_topic_message === true
        ? integer(msg.message_thread_id, 1, Number.MAX_SAFE_INTEGER)
        : null;
    if (isGroup) {
      const known = await this.repository.group(chatId);
      if (!known) {
        const member = await this.telegram.member(chatId, me.id);
        await this.repository.upsertGroup({
          id: chatId,
          title: text(chat.title, 1, 256),
          active: member.active,
          botAdmin: member.admin,
        });
      }
      await this.repository.observeMember({
        chatId,
        userId: player.id,
        active: true,
        updatedAt: this.now(),
      });
      // A command seen from the user is a discovery hint, never the authorization check.
    }
    const command = match[1];
    const game = CATALOG.find(
      (game) => game.available && command === `game_${game.id.replaceAll('-', '_')}`,
    );
    let target = game
      ? `game_${game.id}`
      : command === 'top' || command === 'game_top'
        ? isGroup
          ? `board_${chatId}`
          : 'leaderboard'
        : 'catalog';
    if (command === 'start') {
      const parameter = body.slice(match[0].length).trim().split(/\s/, 1)[0];
      if (parameter && parseLaunch(parameter).view !== 'catalog') target = parameter;
    }
    let response = 'Открыть Arcade';
    let message = 'Выбери игру и играй прямо в Telegram.';
    if (game) {
      response = 'Играть';
      message = `${game.title} — запуск игры`;
    }
    if (command === 'top' || command === 'game_top') {
      response = 'Открыть рейтинг';
      message = isGroup ? 'Рекорды этой группы и общий рейтинг.' : 'Общий рейтинг Arcade.';
    }
    if (
      command === 'game_notify_on' ||
      command === 'game_notify_off' ||
      command === 'game_notify_here'
    ) {
      if (!isGroup) {
        message = 'Эта настройка доступна в группе.';
        target = 'leaderboard';
      } else
        try {
          const group = await this.groups.configure(player, {
            groupId: chatId,
            enabled: command !== 'game_notify_off',
            ...(command === 'game_notify_here' ? { notificationThreadId: threadId } : {}),
          });
          message =
            command === 'game_notify_here'
              ? `Объявления о рекордах включены ${threadId === null ? 'в общем чате группы' : 'в этой теме'}. Не чаще одного сообщения за 5 минут.`
              : group.notificationsEnabled
                ? 'Объявления включены: первый рекорд группы, новый рекорд группы или обгон в её топ-10. Не чаще одного сообщения за 5 минут.'
                : 'Объявления о рекордах выключены.';
          target = `board_${chatId}`;
          response = 'Открыть рейтинг';
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          message = error.message;
          target = `board_${chatId}`;
          response = 'Открыть рейтинг';
        }
    }
    let button: LaunchButton;
    if (!isGroup) {
      button = { text: response, web_app: { url: `${this.miniAppUrl}?startapp=${target}` } };
    } else if (me.hasMainMiniApp) {
      button = { text: response, url: launchUrl(me.username, target) };
    } else {
      message +=
        '\nПрямой запуск в группе ещё настраивается. Пока открой игру через личный чат бота.';
      button = { text: 'Открыть в боте', url: launchUrl(me.username, target, 'start') };
    }
    const ephemeralId =
      typeof msg.ephemeral_message_id === 'number'
        ? integer(msg.ephemeral_message_id, 0, Number.MAX_SAFE_INTEGER)
        : null;
    // Never turn a failed private response into a public group message.
    await this.telegram.send({
      chat_id: chatId,
      ...(threadId === null ? {} : { message_thread_id: threadId }),
      text: message,
      ...(isGroup
        ? {
            ephemeral_message_parameters: { receiver_user_id: player.id },
            ...(ephemeralId !== null
              ? { reply_parameters: { ephemeral_message_id: ephemeralId } }
              : {}),
          }
        : {}),
      reply_markup: {
        inline_keyboard: [
          [button],
          [
            {
              text: 'Предложить улучшение / написать владельцу',
              url: launchUrl(me.username, 'feedback', 'start'),
            },
          ],
        ],
      },
    });
  }
  async botMembership(payload: unknown): Promise<void> {
    const update = object(payload);
    const chat = object(update.chat);
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const member = object(update.new_chat_member);
    const status = member.status;
    const active = status === 'administrator' || status === 'member' || status === 'creator';
    const id = integer(chat.id, -Number.MAX_SAFE_INTEGER, -1);
    await this.repository.upsertGroup({
      id,
      title: text(chat.title, 1, 256),
      active,
      botAdmin: status === 'administrator' || status === 'creator',
    });
    if (active) await this.telegram.commands(GAME_COMMANDS, id);
    if (status === 'administrator' || status === 'creator') await this.groups.synchronize(id);
  }
  async membership(payload: unknown): Promise<void> {
    const update = object(payload);
    const chat = object(update.chat);
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const member = object(update.new_chat_member);
    const user = object(member.user);
    if (user.is_bot === true) return;
    const active =
      member.status === 'member' ||
      member.status === 'administrator' ||
      member.status === 'creator' ||
      (member.status === 'restricted' && member.is_member === true);
    await this.repository.observeMember({
      chatId: integer(chat.id, -Number.MAX_SAFE_INTEGER, -1),
      userId: integer(user.id, 1, Number.MAX_SAFE_INTEGER),
      active,
      updatedAt: integer(update.date, 1, Number.MAX_SAFE_INTEGER) * 1000,
    });
  }
}
