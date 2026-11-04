import type { Player } from '../../shared/contracts.ts';
import { AppError, integer, object, text } from '../../shared/errors.ts';
import { launchUrl } from '../../shared/launch.ts';
import { isAdmin, OWNER_ID } from './admin.ts';
import type {
  Broadcast,
  CommunicationSession,
  CommunicationsRepository,
} from './communications-repository.ts';
import type { SocialRepository } from './social-repository.ts';
import { type SupportMedia, supportBody, supportMedia } from './support-media.ts';
import type { LaunchButton, MessageReference, TelegramGateway } from './telegram.ts';

const action = (label: string, data: string): LaunchButton => ({
  text: label,
  callback_data: `com:${data}`,
});
const mainButtons = () => [
  [action('✉️ Обращения', 'inbox:0'), action('📣 Рассылка группам', 'new')],
  [action('Доставка сообщений', 'delivery')],
];
const back = () => [action('← В меню', 'home')];
const threadLabels = {
  new: '🟢 Новое, не просмотрено',
  waiting: '🟡 Ждёт ответа',
  answered: '🔴 Ответ доставлен',
};
function messageBody(value: unknown): string {
  const body = text(value, 1, 3000).trim();
  if (!body) throw new AppError('BAD_INPUT', 'Напиши текст сообщения');
  return body;
}
export class CommunicationsService {
  constructor(
    private readonly repository: CommunicationsRepository,
    private readonly social: SocialRepository,
    private readonly telegram: TelegramGateway,
    private readonly now: () => number,
  ) {}
  async links(player: Player) {
    const me = await this.telegram.me();
    return {
      feedback: launchUrl(me.username, 'feedback', 'start'),
      owner: isAdmin(player) ? launchUrl(me.username, 'inbox', 'start') : null,
      dialogBase: isAdmin(player) ? `https://t.me/${me.username}?start=dialog_` : null,
    };
  }
  private async send(chatId: number, body: string, keyboard: LaunchButton[][] = []) {
    return this.telegram.send({
      chat_id: chatId,
      text: body,
      ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }
  private async panel(
    body: string,
    keyboard: LaunchButton[][],
    messageId?: number,
  ): Promise<number | null> {
    if (messageId === undefined) return (await this.send(OWNER_ID, body, keyboard)).messageId;
    await this.telegram.edit({
      chat_id: OWNER_ID,
      message_id: messageId,
      text: body,
      reply_markup: { inline_keyboard: keyboard },
    });
    return messageId;
  }
  private async rememberPanel(
    session: CommunicationSession,
    messageId: number | null,
  ): Promise<void> {
    if (messageId !== null && session.panelMessageId !== messageId) {
      session.panelMessageId = messageId;
      await this.repository.setSession(session, this.now());
    }
  }
  private async home(messageId?: number) {
    await this.repository.setSession(null, this.now());
    return this.panel(
      'Общение с игроками\n\nОткрой обращение, чтобы ответить игроку. Рассылки отправляются после предпросмотра и подтверждения.',
      mainButtons(),
      messageId,
    );
  }
  private async inbox(page: number, messageId?: number, closed = false) {
    await this.repository.setSession(null, this.now());
    const threads = await this.repository.threads(page, closed);
    const list = closed ? 'archive' : 'inbox';
    const keyboard = threads
      .slice(0, 8)
      .map((thread) => [
        action(
          `${threadLabels[thread.status].slice(0, 2)} #${thread.id} · ${thread.name} · ${thread.playerId}`,
          `case:${thread.id}:0`,
        ),
      ]);
    const pages: LaunchButton[] = [];
    if (page > 0) pages.push(action('← Назад', `${list}:${page - 1}`));
    if (threads.length > 8) pages.push(action('Далее →', `${list}:${page + 1}`));
    if (pages.length) keyboard.push(pages);
    keyboard.push([
      action(
        closed ? '← Активные обращения' : '📁 Закрытые обращения',
        closed ? 'inbox:0' : 'archive:0',
      ),
    ]);
    keyboard.push(back());
    return this.panel(
      `${closed ? 'Закрытые обращения' : 'Активные обращения'}\n\n🟢 Новое · 🟡 Ждёт ответа · 🔴 Ответ доставлен\n\n${threads.length ? 'Выбери диалог с игроком.' : 'Здесь пока нет обращений.'}`,
      keyboard,
      messageId,
    );
  }
  private async showThread(threadId: number, messageId?: number, page = 0) {
    const thread = await this.repository.conversation(threadId);
    if (!thread) throw new AppError('NOT_FOUND', 'Диалог не найден');
    const history = await this.repository.history(thread.playerId, page, thread.id);
    const labels = {
      pending: 'в очереди',
      running: 'отправляется',
      sent: 'доставлено',
      failed: 'ошибка',
      uncertain: 'статус неизвестен',
      cancelled: 'отменено',
    };
    const body = history
      .slice(-10)
      .map(
        (m) =>
          `${m.direction === 'player' ? 'Игрок' : 'Ты'} · ${labels[m.delivery]}\n${m.body.slice(0, 240)}${m.body.length > 240 ? '…' : ''}`,
      )
      .join('\n\n');
    await this.repository.setSession(null, this.now());
    const keyboard: LaunchButton[][] = [];
    const pages: LaunchButton[] = [];
    if (history.length > 10) pages.push(action('← Раньше', `case:${thread.id}:${page + 1}`));
    if (page > 0) pages.push(action('Новее →', `case:${thread.id}:${page - 1}`));
    if (pages.length) keyboard.push(pages);
    if (!thread.closed) keyboard.push([action('Ответить игроку', `answer:${thread.id}`)]);
    keyboard.push(
      [
        action(
          thread.closed ? 'Открыть снова' : 'Закрыть обращение',
          `${thread.closed ? 'restore' : 'finish'}:${thread.id}`,
        ),
      ],
      [action('← Обращения', thread.closed ? 'archive:0' : 'inbox:0')],
      back(),
    );
    const panelId = await this.panel(
      `Обращение #${thread.id} · ${thread.name} · ${thread.playerId}\n${thread.closed ? '📁 Закрыто · ' : ''}${threadLabels[thread.status === 'new' ? 'waiting' : thread.status]}\nСообщения · страница ${page + 1}\n\n${body || 'Сообщений нет.'}`,
      keyboard,
      messageId,
    );
    await this.repository.markRead(thread.id, thread.incomingOrder);
    return panelId;
  }
  private async showGroups(session: CommunicationSession, messageId?: number) {
    const groups = await this.repository.groups();
    const keyboard = groups
      .slice(session.page * 8, session.page * 8 + 8)
      .map((group) => [
        action(
          `${session.selected.includes(group.id) ? '✓' : '○'} ${group.title.slice(0, 35)} · ${group.id}`,
          `toggle:${session.id}:${group.id}`,
        ),
      ]);
    keyboard.push([
      action('Выбрать все', `all:${session.id}`),
      action('Снять выбор', `none:${session.id}`),
    ]);
    const pages: LaunchButton[] = [];
    if (session.page > 0) pages.push(action('←', `page:${session.id}:${session.page - 1}`));
    if ((session.page + 1) * 8 < groups.length)
      pages.push(action('→', `page:${session.id}:${session.page + 1}`));
    if (pages.length) keyboard.push(pages);
    keyboard.push(
      [action(`Написать текст · ${session.selected.length} групп`, `compose:${session.id}`)],
      back(),
    );
    return this.panel(
      `Получатели рассылки\nВыбрано: ${session.selected.length}. Доступно активных групп: ${groups.length}.\nВыбери все группы или отметь нужные.`,
      keyboard,
      messageId,
    );
  }
  private async preview(draft: Broadcast, messageId?: number) {
    const groups = await this.repository.groups();
    const names = draft.groupIds
      .map((id) => `${groups.find((group) => group.id === id)?.title ?? 'Отключена'} (${id})`)
      .join(', ')
      .slice(0, 650);
    return this.panel(
      `Предпросмотр рассылки · ${draft.groupIds.length} групп\n${names}\n\n${draft.body}\n\nОтправить этот текст выбранным группам?`,
      [
        [action('Отправить', `confirm:${draft.id}`), action('Отменить', `cancel:${draft.id}`)],
        back(),
      ],
      messageId,
    );
  }
  private async delivery(messageId?: number) {
    await this.repository.setSession(null, this.now());
    const summary = await this.repository.deliverySummary();
    const labels = {
      pending: 'Ожидают',
      running: 'Отправляются',
      sent: 'Доставлены',
      failed: 'Ошибки',
      uncertain: 'Статус неизвестен',
      cancelled: 'Отменены',
    };
    const issues = await this.repository.deliveryIssues();
    return this.panel(
      `Доставка сообщений\n${summary.map((row) => `${labels[row.status]}: ${row.count}`).join('\n') || 'Отправок пока нет.'}\n\n${issues.map((job) => `${job.chatId}: ${labels[job.status]} — ${job.error.slice(0, 120)}`).join('\n')}\n\nОчередь обрабатывается при активности бота и приложения. Обновление тоже запускает обработку.`,
      [
        ...issues.map((job) => [action(`Повторить · ${job.chatId}`, `retry:${job.id}`)]),
        [action('Обновить доставки', 'delivery')],
        back(),
      ],
      messageId,
    );
  }
  async message(payload: unknown): Promise<boolean> {
    try {
      return await this.handleMessage(payload);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const msg = object(payload),
        chat = object(msg.chat),
        from = object(msg.from);
      if (chat.type !== 'private' || chat.id !== from.id || from.is_bot === true || msg.sender_chat)
        throw error;
      await this.send(integer(from.id, 1, Number.MAX_SAFE_INTEGER), error.message);
      return true;
    }
  }
  private async handleMessage(payload: unknown): Promise<boolean> {
    const msg = object(payload),
      chat = object(msg.chat);
    const body = typeof msg.text === 'string' ? msg.text.trim() : '';
    const group = chat.type === 'group' || chat.type === 'supergroup';
    const feedback = /^\/(?:feedback|suggest)(?:@([a-zA-Z0-9_]+))?(?:\s|$)/.exec(body);
    if (group) {
      if (!feedback) return false;
      const me = await this.telegram.me();
      if (feedback[1] && feedback[1].toLowerCase() !== me.username.toLowerCase()) return false;
      const from = object(msg.from);
      if (from.is_bot === true || msg.sender_chat) return false;
      await this.telegram.send({
        chat_id: integer(chat.id, -Number.MAX_SAFE_INTEGER, -1),
        text: 'Предложения и вопросы можно отправить владельцу в личном чате бота.',
        ephemeral_message_parameters: {
          receiver_user_id: integer(from.id, 1, Number.MAX_SAFE_INTEGER),
        },
        ...(msg.is_topic_message === true
          ? { message_thread_id: integer(msg.message_thread_id, 1, Number.MAX_SAFE_INTEGER) }
          : {}),
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Написать владельцу', url: launchUrl(me.username, 'feedback', 'start') }],
          ],
        },
      });
      return true;
    }
    if (chat.type !== 'private') return false;
    const from = object(msg.from);
    if (from.is_bot === true || msg.sender_chat) return false;
    const player = {
      id: integer(from.id, 1, Number.MAX_SAFE_INTEGER),
      name: text(from.first_name, 1, 128).slice(0, 100),
    };
    if (chat.id !== player.id) throw new AppError('UNAUTHORIZED', 'Неверный личный чат');
    const media = supportMedia(msg);
    const content = media === undefined ? body : supportBody(media);
    const command = /^\/(\w+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(body);
    if (command?.[2]) {
      const me = await this.telegram.me();
      if (command[2].toLowerCase() !== me.username.toLowerCase()) return false;
    }
    const start = command?.[1] === 'start' ? command[3]?.trim() : undefined;
    if (command?.[1] === 'feedback' || command?.[1] === 'suggest' || start === 'feedback') {
      const inline = command?.[1] !== 'start' ? command?.[3]?.trim() : undefined;
      if (inline && !isAdmin(player)) return this.receivePlayer(msg, player, inline);
      await this.send(
        player.id,
        'Напиши предложение, вопрос или сообщение для владельца Arcade. Можно приложить фото или видео с подписью. Ответ придёт сюда. Текст — до 3000 символов.',
      );
      return true;
    }
    if (isAdmin(player)) {
      if (command?.[1] === 'admin' || start === 'inbox') {
        await this.home();
        return true;
      }
      if (start === 'delivery') {
        await this.sweep(12);
        await this.delivery();
        return true;
      }
      const dialog = /^dialog_([1-9][0-9]{0,15})$/.exec(start ?? '');
      if (dialog?.[1]) {
        const thread = await this.repository.thread(
          integer(Number(dialog[1]), 1, Number.MAX_SAFE_INTEGER),
        );
        if (!thread) throw new AppError('NOT_FOUND', 'Диалог не найден');
        await this.showThread(thread.id);
        return true;
      }
      const conversation = /^case_([1-9][0-9]{0,15})$/.exec(start ?? '');
      if (conversation?.[1]) {
        await this.showThread(integer(Number(conversation[1]), 1, Number.MAX_SAFE_INTEGER));
        return true;
      }
      if (command?.[1] === 'cancel') {
        await this.home();
        return true;
      }
      if (command) return false;
      const session = await this.repository.session(this.now());
      const reply =
        msg.reply_to_message && typeof msg.reply_to_message === 'object'
          ? object(msg.reply_to_message)
          : null;
      const target =
        reply && typeof reply.message_id === 'number'
          ? await this.repository.threadForReply(
              integer(reply.message_id, 1, Number.MAX_SAFE_INTEGER),
            )
          : null;
      if (reply && target === null) {
        await this.repository.setSession(null, this.now());
        await this.panel(
          'Не удалось определить игрока по этому сообщению. Открой нужный диалог и нажми «Ответить».',
          mainButtons(),
          session?.panelMessageId,
        );
        return true;
      }
      if (target !== null || session?.mode === 'reply') {
        const thread =
          target ??
          (session?.threadId === undefined
            ? null
            : await this.repository.conversation(session.threadId));
        if (!thread) throw new AppError('NOT_FOUND', 'Диалог не найден');
        if (thread.closed)
          throw new AppError(
            'CONFLICT',
            'Обращение закрыто. Открой нужное обращение перед ответом.',
          );
        const playerId = thread.playerId;
        await this.repository.receive(
          {
            id: `out:${integer(msg.message_id, 1, Number.MAX_SAFE_INTEGER)}`,
            playerId,
            threadId: thread.id,
            direction: 'owner',
            body: messageBody(content),
            ...(media === undefined ? {} : { media }),
            createdAt: this.now(),
            delivery: 'pending',
          },
          thread.name,
        );
        const panelMessageId = await this.panel(
          `Ответ для ${thread.name} сохранён в очереди.`,
          [[action('Открыть диалог', `case:${thread.id}:0`)], back()],
          session?.panelMessageId,
        );
        await this.repository.setSession(
          {
            mode: 'reply',
            id: `s${panelMessageId ?? msg.message_id}`,
            selected: [],
            playerId,
            threadId: thread.id,
            page: 0,
            ...(panelMessageId === null ? {} : { panelMessageId }),
          },
          this.now(),
        );
        return true;
      }
      if (session?.mode === 'broadcast_text') {
        if (media !== undefined) {
          await this.panel(
            'Для рассылки сейчас нужен текст. Фото и видео доступны в переписке с игроками.',
            [back()],
            session.panelMessageId,
          );
          return true;
        }
        const draft: Broadcast = {
          id: `b${integer(msg.message_id, 1, Number.MAX_SAFE_INTEGER)}`,
          body: messageBody(body),
          groupIds: session.selected,
          status: 'draft',
          createdAt: this.now(),
        };
        await this.repository.draft(draft);
        await this.rememberPanel(session, await this.preview(draft, session.panelMessageId));
        return true;
      }
      await this.send(
        OWNER_ID,
        'Выбери диалог для ответа или создай рассылку. Также можно ответить прямо на сообщение с обращением.',
        mainButtons(),
      );
      return true;
    }
    if (command) return false;
    if (!content) {
      await this.send(
        player.id,
        'Пришли текст, фото или видео. Другие вложения пока не поддерживаются.',
      );
      return true;
    }
    return this.receivePlayer(msg, player, content, media);
  }
  private async receivePlayer(
    msg: Record<string, unknown>,
    player: Player,
    body: string,
    media?: SupportMedia,
  ): Promise<boolean> {
    const inserted = await this.repository.receive(
      {
        id: `in:${player.id}:${integer(msg.message_id, 1, Number.MAX_SAFE_INTEGER)}`,
        playerId: player.id,
        direction: 'player',
        body: messageBody(body),
        createdAt: this.now(),
        delivery: 'pending',
        ...(media === undefined ? {} : { media }),
      },
      player.name,
    );
    if (inserted)
      await this.send(player.id, 'Сообщение сохранено для владельца. Его ответ придёт в этот чат.');
    return true;
  }
  async callback(payload: unknown): Promise<void> {
    const cb = object(payload),
      from = object(cb.from),
      msg = object(cb.message),
      chat = object(msg.chat);
    const id = text(cb.id, 1, 128),
      data = text(cb.data, 1, 64);
    if (!data.startsWith('com:')) return;
    if (from.id !== OWNER_ID || chat.type !== 'private' || chat.id !== OWNER_ID) {
      await this.telegram.answerCallback?.(id, 'Эта кнопка доступна только владельцу.');
      return;
    }
    await this.telegram.answerCallback?.(id);
    const messageId = integer(msg.message_id, 1, Number.MAX_SAFE_INTEGER);
    // Incoming player messages remain intact, including their Telegram reply mapping.
    // Entering a menu from such a notification opens one separate reusable panel.
    const panelMessageId =
      (await this.repository.recipientForReply(messageId)) === null ? messageId : undefined;
    const value = data.slice(4);
    try {
      if (value === 'home') {
        await this.home(panelMessageId);
        return;
      }
      if (value === 'delivery') {
        await this.sweep(12);
        await this.delivery(panelMessageId);
        return;
      }
      if (value === 'new') {
        const session: CommunicationSession = {
          mode: 'groups',
          id: `s${integer(msg.message_id, 1, Number.MAX_SAFE_INTEGER)}`,
          selected: [],
          playerId: 0,
          page: 0,
          ...(panelMessageId === undefined ? {} : { panelMessageId }),
        };
        await this.repository.setSession(session, this.now());
        await this.rememberPanel(session, await this.showGroups(session, panelMessageId));
        return;
      }
      let match = /^(inbox|archive):(\d{1,4})$/.exec(value);
      if (match?.[2]) {
        await this.inbox(Number(match[2]), panelMessageId, match[1] === 'archive');
        return;
      }
      match = /^case:([1-9][0-9]{0,15}):(\d{1,4})$/.exec(value);
      if (match?.[1] && match[2]) {
        await this.showThread(
          integer(Number(match[1]), 1, Number.MAX_SAFE_INTEGER),
          panelMessageId,
          Number(match[2]),
        );
        return;
      }
      match = /^(close|reopen|thread|reply|finish|restore|answer):([1-9][0-9]{0,15})$/.exec(value);
      if (match?.[2]) {
        const targetId = integer(Number(match[2]), 1, Number.MAX_SAFE_INTEGER);
        const legacy = ['close', 'reopen', 'thread', 'reply'].includes(match[1] ?? '');
        const original = legacy ? await this.repository.threadForReply(messageId) : null;
        const migrated = legacy ? await this.repository.conversation(targetId) : null;
        const thread = legacy
          ? original?.playerId === targetId
            ? original
            : migrated?.playerId === targetId
              ? migrated
              : await this.repository.thread(targetId)
          : await this.repository.conversation(targetId);
        if (!thread) throw new AppError('NOT_FOUND', 'Диалог не найден');
        if (['close', 'reopen', 'finish', 'restore'].includes(match[1] ?? '')) {
          const closed = match[1] === 'close' || match[1] === 'finish';
          await this.repository.closeThread(thread.id, closed);
          await this.repository.setSession(null, this.now());
          if (closed) await this.inbox(0, panelMessageId);
          else await this.showThread(thread.id, panelMessageId);
          return;
        }
        if (match[1] === 'thread') {
          await this.showThread(thread.id, panelMessageId);
          return;
        }
        if (thread.closed)
          throw new AppError(
            'CONFLICT',
            'Обращение закрыто. Открой нужное обращение перед ответом.',
          );
        const playerId = thread.playerId;
        const replySession: CommunicationSession = {
          mode: 'reply',
          id: `s${messageId}`,
          selected: [],
          playerId,
          threadId: thread.id,
          page: 0,
          ...(panelMessageId === undefined ? {} : { panelMessageId }),
        };
        await this.repository.setSession(replySession, this.now());
        await this.rememberPanel(
          replySession,
          await this.panel(
            `Напиши ответ для ${thread.name} (${playerId}). Следующие текстовые сообщения уйдут этому игроку.`,
            [back()],
            panelMessageId,
          ),
        );
        return;
      }
      match = /^(confirm|cancel):(b\d{1,16})$/.exec(value);
      if (match?.[2]) {
        if (match[1] === 'cancel') {
          await this.repository.cancel(match[2]);
          await this.repository.setSession(null, this.now());
          await this.panel(
            'Неотправленные сообщения этой рассылки отменены.',
            mainButtons(),
            panelMessageId,
          );
          return;
        }
        await this.repository.confirm(match[2], this.now());
        await this.repository.setSession(null, this.now());
        await this.sweep(12, match[2]);
        const progress = await this.repository.deliverySummary(match[2]);
        const count = (...states: string[]) =>
          progress
            .filter((row) => states.includes(row.status))
            .reduce((sum, row) => sum + row.count, 0);
        await this.panel(
          `Рассылка запущена.\nОтправлено: ${count('sent')}. Ожидают: ${count('pending', 'running')}. Ошибки: ${count('failed', 'uncertain')}.\nЗдесь можно проверить доставку или отменить оставшиеся отправки.`,
          [
            [action('Доставка', 'delivery'), action('Остановить рассылку', `cancel:${match[2]}`)],
            back(),
          ],
          panelMessageId,
        );
        return;
      }
      match = /^(retry|resend):([a-zA-Z0-9:-]{1,50})$/.exec(value);
      if (match?.[2]) {
        if (match[1] === 'retry') {
          await this.repository.setSession(null, this.now());
          await this.panel(
            'Повторить доставку? Если исход прошлой отправки неизвестен, получатель может получить сообщение повторно.',
            [[action('Повторить отправку', `resend:${match[2]}`)], back()],
            panelMessageId,
          );
          return;
        }
        await this.repository.retryDelivery(match[2], this.now());
        await this.delivery(panelMessageId);
        return;
      }
      match = /^(all|none|toggle|page|compose):(s\d{1,16})(?::(-?\d{1,16}))?$/.exec(value);
      if (!match?.[2]) throw new AppError('BAD_INPUT', 'Неизвестная кнопка');
      const session = await this.repository.session(this.now());
      if (!session || session.id !== match[2] || session.mode !== 'groups')
        throw new AppError('CONFLICT', 'Этот выбор групп устарел. Создай новую рассылку.');
      const groups = await this.repository.groups();
      if (panelMessageId !== undefined) session.panelMessageId = panelMessageId;
      const eligible = new Set(groups.map((group) => group.id));
      session.selected = session.selected.filter((groupId) => eligible.has(groupId));
      if (match[1] === 'all') session.selected = groups.map((group) => group.id);
      if (match[1] === 'none') session.selected = [];
      if (match[1] === 'toggle') {
        const groupId = integer(Number(match[3]), -Number.MAX_SAFE_INTEGER, -1);
        if (!eligible.has(groupId)) throw new AppError('NOT_FOUND', 'Эта группа уже отключена');
        session.selected = session.selected.includes(groupId)
          ? session.selected.filter((id) => id !== groupId)
          : [...session.selected, groupId];
      }
      if (match[1] === 'page')
        session.page = integer(Number(match[3]), 0, Math.max(0, Math.ceil(groups.length / 8) - 1));
      if (match[1] === 'compose') {
        if (!session.selected.length)
          throw new AppError('BAD_INPUT', 'Сначала выбери хотя бы одну группу');
        session.mode = 'broadcast_text';
        await this.repository.setSession(session, this.now());
        await this.rememberPanel(
          session,
          await this.panel(
            `Выбрано ${session.selected.length} групп. Напиши текст рассылки (до 3000 символов). Затем покажу предпросмотр.`,
            [back()],
            panelMessageId,
          ),
        );
        return;
      }
      await this.repository.setSession(session, this.now());
      await this.rememberPanel(session, await this.showGroups(session, panelMessageId));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await this.panel(error.message, mainButtons(), panelMessageId);
    }
  }
  async sweep(limit = 3, broadcastId?: string): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const job = await this.repository.claim(this.now(), broadcastId);
      if (!job) break;
      processed++;
      if (this.now() > job.expiresAt || job.attempts > 8) {
        await this.repository.finish(job, 'failed', 'Delivery expired');
        continue;
      }
      try {
        let topic: number | null = null;
        if (job.kind === 'broadcast') {
          const group = await this.social.group(job.chatId);
          if (!group?.active) {
            await this.repository.finish(job, 'cancelled', 'Group disconnected');
            continue;
          }
          const me = await this.telegram.me();
          if (!(await this.telegram.member(job.chatId, me.id)).active) {
            await this.repository.finish(job, 'cancelled', 'Bot removed from group');
            continue;
          }
          topic = group.notificationThreadId;
        }
        const keyboard =
          job.kind === 'owner_inbox'
            ? [
                [
                  action('Ответить', `answer:${job.threadId}`),
                  action('Диалог', `case:${job.threadId}:0`),
                ],
              ]
            : [];
        let sent: MessageReference;
        if (job.media !== undefined) {
          if (job.kind === 'broadcast')
            throw new AppError('BAD_INPUT', 'Медиа-рассылки пока не поддерживаются');
          const thread =
            job.kind === 'owner_inbox' && job.threadId !== undefined
              ? await this.repository.conversation(job.threadId)
              : null;
          const mediaKeyboard =
            job.kind === 'owner_inbox'
              ? [
                  [
                    action(
                      `✉️ ${(thread?.name ?? 'Игрок').slice(0, 40)} · ${job.playerId}`,
                      `case:${job.threadId}:0`,
                    ),
                  ],
                  ...keyboard,
                ]
              : keyboard;
          sent = await this.telegram.sendMedia({
            chat_id: job.chatId,
            kind: job.media.kind,
            fileId: job.media.fileId,
            caption:
              job.media.caption ||
              (job.kind === 'owner_inbox'
                ? `Обращение от ${thread?.name ?? 'игрока'} · ${job.playerId}`
                : 'Ответ владельца Arcade'),
            ...(mediaKeyboard.length ? { reply_markup: { inline_keyboard: mediaKeyboard } } : {}),
          });
        } else
          sent = await this.telegram.send({
            chat_id: job.chatId,
            text: job.body,
            ...(topic === null ? {} : { message_thread_id: topic }),
            ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
          });
        await this.repository.finish(job, 'sent', undefined, sent.messageId ?? undefined);
      } catch (error) {
        const data = error && typeof error === 'object' ? object(error) : {};
        const code = typeof data.code === 'number' ? data.code : 0;
        const message = error instanceof Error ? error.message : 'Telegram request failed';
        if (code === 400 || code === 403) {
          await this.repository.finish(job, 'failed', message);
          continue;
        }
        if (code === 429 || code >= 500) {
          const params =
            data.parameters && typeof data.parameters === 'object' ? object(data.parameters) : {};
          const retry =
            typeof params.retry_after === 'number' && Number.isFinite(params.retry_after)
              ? Math.max(0, Math.min(params.retry_after, 86400)) * 1000
              : 0;
          await this.repository.retry(
            job,
            this.now() + Math.max(retry, Math.min(60000, 1000 * 2 ** job.attempts)),
            message,
          );
          continue;
        }
        await this.repository.finish(job, 'uncertain', message);
      }
    }
    return processed;
  }
}
