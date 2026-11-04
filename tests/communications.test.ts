import { afterEach, expect, it, vi } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { OWNER_ID } from '../src/server/domain/admin.ts';
import { CommunicationsService } from '../src/server/domain/communications.ts';
import type {
  EditMessage,
  LaunchButton,
  SendMedia,
  SendMessage,
  TelegramGateway,
} from '../src/server/domain/telegram.ts';
import { installCommunications } from '../src/server/platform/communications-ddl.ts';
import { SqlCommunicationsRepository } from '../src/server/platform/sql-communications.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';

const handles: ReturnType<typeof localRepository>[] = [];
const callbackData = (button: LaunchButton | undefined) =>
  button && 'callback_data' in button ? button.callback_data : undefined;
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of handles.splice(0)) h.close();
});
async function setup() {
  const local = localRepository();
  handles.push(local);
  let now = 1800000000000,
    nextId = 500;
  const sent: (SendMessage & { messageId: number })[] = [];
  const edits: EditMessage[] = [];
  const mediaSent: (SendMedia & { messageId: number })[] = [];
  const telegram: TelegramGateway = {
    async me() {
      return { id: 99, username: 'arcade_test_bot', hasMainMiniApp: true };
    },
    async member() {
      return { active: true, admin: true };
    },
    async send(message) {
      const messageId = nextId++;
      sent.push({ ...message, messageId });
      return { messageId, ephemeralId: null, date: Math.floor(now / 1000) };
    },
    async edit(message) {
      edits.push(message);
    },
    async sendMedia(message) {
      const messageId = nextId++;
      mediaSent.push({ ...message, messageId });
      return { messageId, ephemeralId: null, date: Math.floor(now / 1000) };
    },
    async commands() {},
    async answerCallback() {},
  };
  const repository = new SqlCommunicationsRepository(local.db);
  const social = new SqlSocialRepository(local.db, local.repository);
  for (const [id, active, admin] of [
    [-100, true, true],
    [-200, true, false],
    [-300, false, false],
    [-400, true, true],
  ] as const)
    await social.upsertGroup({ id, title: `Группа ${id}`, active, botAdmin: admin });
  await social.notifications(-200, false, now, 42);
  await social.notifications(-400, true, now);
  const service = new CommunicationsService(repository, social, telegram, () => now);
  const message = (id: number, user: number, body: string, replyTo?: number) =>
    service.message({
      message_id: id,
      from: { id: user, first_name: `P${user}` },
      chat: { id: user, type: 'private' },
      text: body,
      ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
    });
  const callback = (data: string, messageId = 70, user = OWNER_ID) =>
    service.callback({
      id: `cb${messageId}`,
      data: `com:${data}`,
      from: { id: user },
      message: { message_id: messageId, chat: { id: user, type: 'private' } },
    });
  const draft = async (all = true) => {
    await callback('new');
    await callback(all ? 'all:s70' : 'toggle:s70:-100');
    await callback('compose:s70');
    await message(90, OWNER_ID, 'Новости Arcade');
  };
  return {
    local,
    repository,
    social,
    service,
    telegram,
    sent,
    edits,
    mediaSent,
    message,
    callback,
    draft,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it('tracks unread, viewed and successfully answered threads in the existing panel', async () => {
  const s = await setup();
  await s.message(1, 1, 'Баг');
  expect(await s.repository.thread(1)).toMatchObject({ status: 'new', closed: false });
  await s.callback('inbox:0');
  expect(s.edits.at(-1)?.reply_markup.inline_keyboard[0]?.[0]?.text).toContain('🟢');
  await s.callback('thread:1');
  expect(await s.repository.thread(1)).toMatchObject({ status: 'waiting' });
  await s.callback('inbox:0');
  expect(s.edits.at(-1)?.reply_markup.inline_keyboard[0]?.[0]?.text).toContain('🟡');
  await s.callback('reply:1');
  await s.message(2, OWNER_ID, 'Исправил');
  expect(await s.repository.thread(1)).toMatchObject({ status: 'waiting' });
  await s.service.sweep(12);
  expect(await s.repository.thread(1)).toMatchObject({ status: 'answered' });
  await s.callback('inbox:0');
  expect(s.edits.at(-1)?.reply_markup.inline_keyboard[0]?.[0]?.text).toContain('🔴');
  expect(s.edits.every((edit) => edit.message_id === 70)).toBe(true);
});
it('starts a separate case after closure and retains every archived conversation', async () => {
  const s = await setup();
  await s.message(1, 1, 'Первое');
  await s.callback('thread:1');
  await s.callback('close:1');
  expect(await s.repository.threads(0)).toHaveLength(0);
  expect(await s.repository.threads(0, true)).toHaveLength(1);
  await s.callback('archive:0');
  expect(s.edits.at(-1)?.text).toContain('Закрытые обращения');
  await s.callback('reopen:1');
  expect(await s.repository.thread(1)).toMatchObject({ closed: false });
  await s.callback('close:1');
  await s.message(1, 1, 'Первое');
  expect(await s.repository.thread(1)).toMatchObject({ closed: true });
  await s.message(2, 1, 'Ещё баг');
  expect(await s.repository.thread(1)).toMatchObject({ closed: false, status: 'new' });
  const current = await s.repository.thread(1);
  expect(current?.id).not.toBe(1);
  expect((await s.repository.history(1)).map((m) => m.body)).toEqual(['Ещё баг']);
  expect(await s.repository.threads(0, true)).toHaveLength(1);
  await s.callback('archive:0');
  expect(callbackData(s.edits.at(-1)?.reply_markup.inline_keyboard[0]?.[0])).toBe('com:case:1:0');
  await s.callback('case:1:0');
  expect(s.edits.at(-1)?.text).toContain('Первое');
  expect(s.edits.at(-1)?.text).not.toContain('Ещё баг');
  await s.callback('restore:1');
  expect(s.edits.at(-1)?.text).toContain('уже есть активное обращение');
  expect(await s.repository.conversation(1)).toMatchObject({ closed: true });
  await s.callback(`case:${current?.id}:0`);
  expect(s.edits.at(-1)?.text).toContain('Ещё баг');
  expect(s.edits.at(-1)?.text).not.toContain('Первое');
  await s.callback(`finish:${current?.id}`);
  await s.message(3, 1, 'Третье обращение');
  expect(await s.repository.threads(0, true)).toHaveLength(2);
  expect(await s.repository.threads(0)).toHaveLength(1);
  expect((await s.repository.history(1)).map((m) => m.body)).toEqual(['Третье обращение']);
});
it('keeps a concurrent incoming message unread and prevents closing an outdated thread', async () => {
  const s = await setup();
  await s.message(1, 1, 'Первое');
  const snapshot = await s.repository.thread(1);
  await s.message(2, 1, 'Новое в ту же миллисекунду');
  await s.repository.markRead(1, snapshot?.incomingOrder ?? 0);
  expect(await s.repository.thread(1)).toMatchObject({ status: 'new' });
  await s.callback('close:1');
  expect(s.edits.at(-1)?.text).toContain('Пришло новое сообщение');
  expect(await s.repository.thread(1)).toMatchObject({ closed: false });
  await s.callback('thread:1');
  await s.callback('close:1');
  expect(await s.repository.thread(1)).toMatchObject({ closed: true });
});
it('pins notifications, old reply buttons and persisted reply sessions to the original case', async () => {
  const s = await setup();
  await s.message(1, 42, 'Старый вопрос');
  const original = await s.repository.thread(42);
  if (!original) throw new Error('Missing original case');
  await s.service.sweep(12);
  const relay = s.sent.find((m) => m.chat_id === OWNER_ID);
  if (!relay) throw new Error('Missing relay');
  await s.callback(`case:${original.id}:0`);
  await s.callback(`answer:${original.id}`);
  await s.repository.closeThread(original.id, true);
  await s.message(2, 42, 'Новый вопрос');
  const current = await s.repository.thread(42);
  expect(current?.id).not.toBe(original.id);
  await s.message(3, OWNER_ID, 'Ответ из старого режима');
  expect(s.sent.at(-1)?.text).toContain('Обращение закрыто');
  await s.message(4, OWNER_ID, 'Ответ на старое уведомление', relay.messageId);
  expect(s.sent.at(-1)?.text).toContain('Обращение закрыто');
  await s.callback(`answer:${original.id}`, relay.messageId);
  expect(s.sent.at(-1)?.text).toContain('Обращение закрыто');
  await s.callback('reply:42', relay.messageId);
  expect(s.sent.at(-1)?.text).toContain('Обращение закрыто');
  expect(
    await s.local.db.get("SELECT count(*) AS n FROM support_messages WHERE direction='owner'"),
  ).toEqual({ n: 0 });
  await s.callback(`finish:${original.id}`);
  expect(await s.repository.thread(42)).toMatchObject({
    id: current?.id,
    closed: false,
    status: 'new',
  });
  await installCommunications(s.local.db);
  await s.service.sweep(12);
  const fresh = s.sent.find((m) => m.chat_id === OWNER_ID && m.text.includes('Новый вопрос'));
  expect(callbackData(fresh?.reply_markup?.inline_keyboard[0]?.[0])).toBe(
    `com:answer:${current?.id}`,
  );
  await s.callback(`answer:${current?.id}`);
  await s.message(5, OWNER_ID, 'Ответ на новый вопрос');
  await s.service.sweep(12);
  expect((await s.repository.history(42)).map((m) => m.body)).toEqual([
    'Новый вопрос',
    'Ответ на новый вопрос',
  ]);
  expect((await s.repository.history(42, 0, original.id)).map((m) => m.body)).toEqual([
    'Старый вопрос',
  ]);
  expect(await s.repository.conversation(original.id)).toMatchObject({ closed: true });
});
it('pages through the full archived history without mixing a newer case into it', async () => {
  const s = await setup();
  for (let id = 1; id <= 23; id++) {
    s.advance(61000);
    await s.message(id, 42, `[сообщение ${id}]`);
  }
  const original = await s.repository.thread(42);
  if (!original) throw new Error('Missing original case');
  await s.callback(`case:${original.id}:0`);
  await s.callback(`finish:${original.id}`);
  s.advance(61000);
  await s.message(24, 42, 'Другое обращение');
  for (const [page, first, last] of [
    [0, 14, 23],
    [1, 4, 13],
    [2, 1, 3],
  ] as const) {
    await s.callback(`case:${original.id}:${page}`);
    const panel = s.edits.at(-1);
    expect(panel?.text).not.toContain('Другое обращение');
    const displayed = [...(panel?.text ?? '').matchAll(/\[сообщение (\d+)\]/g)].map((match) =>
      Number(match[1]),
    );
    expect(displayed).toEqual(
      Array.from({ length: last - first + 1 }, (_, index) => first + index),
    );
    expect(
      panel?.reply_markup.inline_keyboard.flat().some((button) => button.text === '← Раньше'),
    ).toBe(page < 2);
    expect(
      panel?.reply_markup.inline_keyboard.flat().some((button) => button.text === 'Новее →'),
    ).toBe(page > 0);
    expect(
      panel?.reply_markup.inline_keyboard
        .flat()
        .some((button) => button.text === 'Ответить игроку'),
    ).toBe(false);
  }
  await s.message(25, OWNER_ID, `/start case_${original.id}`);
  expect(s.sent.at(-1)?.text).toContain(`Обращение #${original.id}`);
  expect(s.sent.at(-1)?.text).not.toContain('Другое обращение');
});
it('pages through multiple closed cases from the same player and preserves them on reinstall', async () => {
  const s = await setup();
  for (let id = 1; id <= 10; id++) {
    s.advance(61000);
    await s.message(id, 42, `Вопрос ${id}`);
    const thread = await s.repository.thread(42);
    if (!thread) throw new Error('Missing case');
    await s.callback(`case:${thread.id}:0`);
    await s.callback(`finish:${thread.id}`);
  }
  await installCommunications(s.local.db);
  await s.callback('archive:0');
  const firstPage = s.edits.at(-1)?.reply_markup.inline_keyboard.flat() ?? [];
  expect(firstPage.filter((button) => callbackData(button)?.startsWith('com:case:'))).toHaveLength(
    8,
  );
  expect(firstPage.some((button) => callbackData(button) === 'com:archive:1')).toBe(true);
  await s.callback('archive:1');
  const secondPage = s.edits.at(-1)?.reply_markup.inline_keyboard.flat() ?? [];
  expect(secondPage.filter((button) => callbackData(button)?.startsWith('com:case:'))).toHaveLength(
    2,
  );
  expect(await s.repository.threads(0)).toHaveLength(0);
  expect(await s.local.db.get('SELECT count(*) AS n FROM support_cases')).toEqual({ n: 10 });
});
it('does not create a new case for rejected intake and rolls back a case when queue insertion fails', async () => {
  const s = await setup();
  for (let id = 1; id <= 5; id++) await s.message(id, 42, `Вопрос ${id}`);
  const thread = await s.repository.thread(42);
  if (!thread) throw new Error('Missing case');
  await s.callback(`case:${thread.id}:0`);
  await s.callback(`finish:${thread.id}`);
  await s.message(6, 42, 'Сверх лимита');
  expect(s.sent.at(-1)?.text).toContain('пяти сообщений');
  expect(await s.repository.threads(0)).toHaveLength(0);
  expect(await s.repository.threads(0, true)).toHaveLength(1);
  s.advance(61000);
  await s.local.db.run(
    "CREATE TRIGGER reject_case_job BEFORE INSERT ON communication_jobs BEGIN SELECT RAISE(ABORT,'Test queue failure'); END",
  );
  await expect(s.message(6, 42, 'Сверх лимита')).rejects.toThrow('Test queue failure');
  expect(await s.repository.threads(0)).toHaveLength(0);
  expect(await s.repository.threads(0, true)).toHaveLength(1);
  await s.local.db.run('DROP TRIGGER reject_case_job');
  await s.message(6, 42, 'Сверх лимита');
  expect(await s.repository.threads(0)).toHaveLength(1);
  expect(await s.repository.threads(0, true)).toHaveLength(1);
});
it('does not mark a thread read when its panel could not be displayed', async () => {
  const s = await setup();
  await s.message(1, 1, 'Баг');
  vi.spyOn(s.telegram, 'edit').mockRejectedValue(new Error('Network failure'));
  await expect(s.callback('thread:1')).rejects.toThrow('Network failure');
  expect(await s.repository.thread(1)).toMatchObject({ status: 'new' });
});
it('does not treat a failed or late older reply as an answer to a newer report', async () => {
  const s = await setup();
  await s.message(1, 1, 'Баг');
  await s.service.sweep(12);
  await s.callback('reply:1');
  await s.message(2, OWNER_ID, 'Ответ');
  const job = await s.repository.claim(s.now());
  expect(job?.kind).toBe('player_reply');
  if (!job) throw new Error('Missing reply');
  await s.repository.finish(job, 'failed', 'Blocked');
  expect(await s.repository.thread(1)).toMatchObject({ status: 'waiting' });
  await s.message(3, 1, 'Новый вопрос');
  await s.repository.retryDelivery(job.id, s.now());
  await s.service.sweep(12);
  expect(await s.repository.thread(1)).toMatchObject({ status: 'new' });
  await s.callback('thread:1');
  expect(await s.repository.thread(1)).toMatchObject({ status: 'waiting' });
});
it('restricts closing and reopening threads to the owner', async () => {
  const s = await setup();
  await s.message(1, 1, 'Баг');
  await s.callback('thread:1');
  await s.callback('close:1', 70, 1);
  expect(await s.repository.thread(1)).toMatchObject({ closed: false });
  await s.callback('close:1');
  await s.callback('reopen:1', 70, 1);
  expect(await s.repository.thread(1)).toMatchObject({ closed: true });
});
it('upgrades legacy threads, preserves unread messages and supports repeated installation', async () => {
  const s = await setup();
  await s.message(1, 1, 'Первое');
  await s.callback('reply:1');
  await s.message(2, OWNER_ID, 'Ответ');
  await s.service.sweep(12);
  await s.message(3, 1, 'Новое');
  await s.local.db.run('DROP TRIGGER support_thread_activity');
  await s.local.db.run('DROP TRIGGER support_message_delivery');
  await s.local.db.run(
    'INSERT INTO support_threads SELECT player_id,player_name,created_at,updated_at,read_order,closed FROM support_cases',
  );
  await s.local.db.run('DROP TABLE support_cases');
  await s.local.db.run('DROP INDEX support_messages_thread');
  await s.local.db.run('ALTER TABLE support_messages DROP COLUMN thread_id');
  await s.local.db.run('ALTER TABLE support_messages DROP COLUMN player_name');
  await s.local.db.run('ALTER TABLE support_threads DROP COLUMN read_order');
  await s.local.db.run('ALTER TABLE support_threads DROP COLUMN closed');
  await installCommunications(s.local.db);
  expect(await s.repository.thread(1)).toMatchObject({ status: 'new', closed: false });
  expect(await s.repository.history(1)).toHaveLength(3);
  await s.callback('thread:1');
  await s.callback('close:1');
  await installCommunications(s.local.db);
  expect(await s.repository.thread(1)).toMatchObject({ status: 'waiting', closed: true });
});
it('migrates closed legacy dialogs and pending deliveries without reopening or duplicating them', async () => {
  const s = await setup();
  await s.message(1, 42, 'Прежняя история');
  const thread = await s.repository.thread(42);
  if (!thread) throw new Error('Missing case');
  await s.callback(`case:${thread.id}:0`);
  await s.callback(`finish:${thread.id}`);
  await s.local.db.run('DROP TRIGGER support_thread_activity');
  await s.local.db.run('DROP TRIGGER support_message_delivery');
  await s.local.db.run(
    'INSERT INTO support_threads SELECT player_id,player_name,created_at,updated_at,read_order,closed FROM support_cases',
  );
  await s.local.db.run('DROP TABLE support_cases');
  await s.local.db.run('UPDATE support_messages SET thread_id=NULL');
  await s.local.db.run(
    'CREATE TRIGGER support_thread_activity AFTER INSERT ON support_messages BEGIN UPDATE support_threads SET closed=0 WHERE player_id=NEW.player_id; END',
  );
  await s.local.db.run(
    'CREATE TRIGGER support_message_delivery AFTER INSERT ON support_messages BEGIN SELECT 1; END',
  );
  await s.message(2, 42, 'Новый вопрос');
  expect(s.sent.at(-1)?.text).toContain('ещё не подключены');
  await installCommunications(s.local.db);
  expect(await s.repository.conversation(42)).toMatchObject({ closed: true, status: 'waiting' });
  await s.message(2, 42, 'Новый вопрос');
  const current = await s.repository.thread(42);
  expect(current?.id).not.toBe(42);
  await s.message(1, 42, 'Прежняя история');
  await installCommunications(s.local.db);
  expect((await s.repository.history(42)).map((m) => m.body)).toEqual(['Новый вопрос']);
  expect((await s.repository.history(42, 0, 42)).map((m) => m.body)).toEqual(['Прежняя история']);
  expect(await s.repository.threads(0, true)).toHaveLength(1);
  await s.callback('thread:42');
  expect(s.edits.at(-1)?.text).toContain('Прежняя история');
  await s.service.sweep(12);
  const oldRelay = s.sent.find((m) => m.chat_id === OWNER_ID && m.text.includes('Прежняя история'));
  expect(callbackData(oldRelay?.reply_markup?.inline_keyboard[0]?.[1])).toBe('com:case:42:0');
  expect(await s.repository.threadForReply(oldRelay?.messageId ?? 0)).toMatchObject({
    id: 42,
    closed: true,
  });
  expect(await s.local.db.get('SELECT count(*) AS n FROM support_messages')).toEqual({ n: 2 });
  expect(await s.local.db.get('SELECT count(*) AS n FROM communication_jobs')).toEqual({ n: 2 });
});
it('stores incoming text and its relay atomically, ignores duplicate Telegram updates and preserves literal text', async () => {
  const s = await setup();
  await s.message(1, 1, 'Хочу <b>новую игру</b>');
  await s.message(1, 1, 'Хочу <b>новую игру</b>');
  expect(await s.repository.history(1)).toHaveLength(1);
  await s.service.sweep();
  await s.service.sweep();
  const relay = s.sent.filter((m) => m.chat_id === OWNER_ID);
  expect(relay).toHaveLength(1);
  expect(relay[0]?.text).toContain('<b>новую игру</b>');
  expect(relay[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
    text: 'Ответить',
    callback_data: 'com:answer:1',
  });
  expect(await s.repository.recipientForReply(relay[0]?.messageId ?? 0)).toBe(1);
});
it('routes the owners Telegram reply to the original player once', async () => {
  const s = await setup();
  await s.message(1, 1, 'Предложение');
  await s.service.sweep();
  const relay = s.sent.find((m) => m.chat_id === OWNER_ID);
  expect(relay).toBeDefined();
  await s.message(2, OWNER_ID, 'Спасибо, добавлю!', relay?.messageId);
  await s.message(2, OWNER_ID, 'Спасибо, добавлю!', relay?.messageId);
  await s.service.sweep();
  expect(
    s.sent.filter((m) => m.chat_id === 1 && m.text.includes('Спасибо, добавлю!')),
  ).toHaveLength(1);
  expect((await s.repository.history(1)).map((m) => m.direction)).toEqual(['player', 'owner']);
});
it('retains a selected dialog across service restart and refuses an unrelated reply target', async () => {
  const s = await setup();
  await s.message(1, 1, 'Привет');
  await s.callback('reply:1');
  const reloaded = new CommunicationsService(
    new SqlCommunicationsRepository(s.local.db),
    s.social,
    s.telegram,
    s.now,
  );
  await reloaded.message({
    message_id: 2,
    from: { id: OWNER_ID, first_name: 'Владелец' },
    chat: { id: OWNER_ID, type: 'private' },
    text: 'Ответ после перезапуска',
  });
  await s.message(3, OWNER_ID, 'Не отправляй это', 999999);
  expect((await s.repository.history(1)).map((m) => m.body)).toEqual([
    'Привет',
    'Ответ после перезапуска',
  ]);
  expect(s.edits.at(-1)?.text).toContain('Не удалось определить игрока');
});
it('allows only the owner to view dialogs and manage recipients or confirmation', async () => {
  const s = await setup();
  await s.message(1, 1, 'Привет');
  await s.callback('new', 70, 1);
  await s.callback('thread:1', 70, 1);
  await s.callback('confirm:b90', 70, 1);
  expect(await s.repository.session(s.now())).toBeNull();
  expect(await s.repository.broadcast('b90')).toBeNull();
  const links = await s.service.links({ id: 1, name: 'P1' });
  expect(links.owner).toBeNull();
  expect(links.dialogBase).toBeNull();
  expect((await s.service.links({ id: OWNER_ID, name: 'Owner' })).dialogBase).toContain(
    '?start=dialog_',
  );
});
it('does not ingest group chatter or bots and uses a private deep link for the group command', async () => {
  const s = await setup();
  const group = {
    message_id: 1,
    from: { id: 1, first_name: 'P1' },
    chat: { id: -100, type: 'supergroup' },
  };
  expect(await s.service.message({ ...group, text: 'Обычный разговор' })).toBe(false);
  expect(await s.service.message({ ...group, text: '/feedback@another_bot' })).toBe(false);
  expect(await s.service.message({ ...group, text: '/feedback' })).toBe(true);
  expect(s.sent[0]?.ephemeral_message_parameters?.receiver_user_id).toBe(1);
  expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toMatchObject({
    url: 'https://t.me/arcade_test_bot?start=feedback',
  });
  expect(await s.repository.threads(0)).toHaveLength(0);
  expect(
    await s.service.message({
      message_id: 2,
      from: { id: 1, is_bot: true },
      chat: { id: 1, type: 'private' },
      text: 'spam',
    }),
  ).toBe(false);
});
it('validates size, handles unsupported media and limits new incoming messages without blocking duplicate retries', async () => {
  const s = await setup();
  for (let id = 1; id <= 6; id++) await s.message(id, 1, `Идея ${id}`);
  expect(await s.repository.history(1)).toHaveLength(5);
  expect(s.sent.at(-1)?.text).toContain('пяти сообщений');
  await s.message(1, 1, 'Идея 1');
  expect(await s.repository.history(1)).toHaveLength(5);
  await s.message(7, 2, 'a'.repeat(3001));
  expect(await s.repository.thread(2)).toBeNull();
  await s.service.message({
    message_id: 8,
    from: { id: 2, first_name: 'P2' },
    chat: { id: 2, type: 'private' },
    document: {},
  });
  expect(s.sent.at(-1)?.text).toContain('Другие вложения');
});
it('rolls back intake if the durable relay cannot be queued', async () => {
  const s = await setup();
  await s.local.db.run(
    "CREATE TRIGGER fail_queue BEFORE INSERT ON communication_jobs BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END",
  );
  await expect(s.message(1, 1, 'Не потерять')).rejects.toThrow('TEST_FAILURE');
  expect(await s.local.db.get('SELECT count(*) AS n FROM support_messages')).toEqual({ n: 0 });
  expect(s.sent).toHaveLength(0);
});
it('freezes all active recipients regardless of record settings and sends only after explicit confirmation', async () => {
  const s = await setup();
  await s.draft();
  expect(await s.repository.deliverySummary()).toEqual([]);
  const preview = s.edits.at(-1);
  expect(preview?.text).toContain('3 групп');
  expect(preview?.text).toContain('Новости Arcade');
  await s.social.upsertGroup({
    id: -500,
    title: 'Добавлена после предпросмотра',
    active: true,
    botAdmin: true,
  });
  await s.callback('confirm:b90');
  await s.callback('confirm:b90');
  expect(await s.local.db.get('SELECT count(*) AS n FROM communication_jobs')).toEqual({ n: 3 });
  expect(
    s.sent
      .filter((m) => m.chat_id < 0)
      .map((m) => m.chat_id)
      .sort((a, b) => a - b),
  ).toEqual([-400, -200, -100]);
  await s.service.sweep(12);
  expect(s.sent.filter((m) => m.chat_id < 0)).toHaveLength(3);
  expect(s.sent.find((m) => m.chat_id === -200)?.message_thread_id).toBe(42);
  expect((await s.social.group(-200))?.notificationsEnabled).toBe(false);
});
it('edits the existing group selector for toggles, bulk selection, pagination and composition', async () => {
  const s = await setup();
  for (let id = 10; id < 20; id++)
    await s.social.upsertGroup({
      id: -id,
      title: `Дополнительная группа ${id}`,
      active: true,
      botAdmin: true,
    });
  await s.callback('new');
  expect(s.sent).toHaveLength(0);
  expect(s.edits.at(-1)).toMatchObject({ chat_id: OWNER_ID, message_id: 70 });
  expect(s.edits.at(-1)?.text).toContain('Выбрано: 0');
  await s.callback('toggle:s70:-100');
  expect(s.edits.at(-1)?.text).toContain('Выбрано: 1');
  await s.callback('toggle:s70:-100');
  expect(s.edits.at(-1)?.text).toContain('Выбрано: 0');
  await s.callback('all:s70');
  expect(s.edits.at(-1)?.text).toContain('Выбрано: 13');
  expect(s.edits.at(-1)?.reply_markup.inline_keyboard[0]?.[0]?.text).toMatch(/^✓/);
  await s.callback('page:s70:1');
  expect((await s.repository.session(s.now()))?.page).toBe(1);
  expect(s.edits.at(-1)?.reply_markup.inline_keyboard[0]?.[0]?.text).toMatch(/^✓/);
  await s.callback('none:s70');
  expect(s.edits.at(-1)?.text).toContain('Выбрано: 0');
  await s.callback('toggle:s70:-100');
  await s.callback('compose:s70');
  expect(s.edits.at(-1)?.text).toContain('Напиши текст рассылки');
  expect(s.edits.at(-1)?.reply_markup.inline_keyboard).toEqual([
    [{ text: '← В меню', callback_data: 'com:home' }],
  ]);
  expect(s.sent).toHaveLength(0);
  expect(
    s.edits.every((message) => message.chat_id === OWNER_ID && message.message_id === 70),
  ).toBe(true);
  expect(await s.repository.deliverySummary()).toEqual([]);
  await s.message(90, OWNER_ID, 'Проверка предпросмотра в той же панели');
  expect(s.sent).toHaveLength(0);
  expect(s.edits.at(-1)).toMatchObject({ message_id: 70 });
  expect(s.edits.at(-1)?.text).toContain('Предпросмотр рассылки');
});
it('edits an already existing selector whose message differs from its session id', async () => {
  const s = await setup();
  await s.callback('new', 70);
  await s.callback('toggle:s70:-100', 777);
  expect(s.edits.at(-1)).toMatchObject({ message_id: 777 });
  expect((await s.repository.session(s.now()))?.selected).toEqual([-100]);
  expect(s.sent).toHaveLength(0);
});
it('reuses one panel across the inbox, dialog, reply mode, delivery, retries, errors and home', async () => {
  const s = await setup();
  for (let user = 1; user <= 9; user++)
    await s.local.db.run(
      'INSERT INTO support_cases(player_id,player_name,created_at,updated_at) VALUES(:user,:name,:now,:now)',
      {
        ':user': user,
        ':name': `P${user}`,
        ':now': s.now(),
      },
    );
  for (const screen of [
    'home',
    'inbox:0',
    'inbox:1',
    'thread:1',
    'reply:1',
    'home',
    'delivery',
    'delivery',
    'retry:out:99',
    'resend:out:99',
    'thread:999',
    'home',
  ]) {
    await s.callback(screen, 70);
    expect(s.edits.at(-1)).toMatchObject({ chat_id: OWNER_ID, message_id: 70 });
    expect(s.sent).toHaveLength(0);
  }
  expect(await s.repository.session(s.now())).toBeNull();
});
it('updates the preview and confirmation or cancellation in the same panel', async () => {
  const s = await setup();
  await s.draft(false);
  expect(s.sent).toHaveLength(0);
  expect(s.edits.at(-1)).toMatchObject({ message_id: 70 });
  expect(s.edits.at(-1)?.text).toContain('Предпросмотр рассылки');
  await s.callback('confirm:b90');
  expect(s.edits.at(-1)?.text).toContain('Рассылка запущена');
  expect(s.edits.at(-1)?.text).toContain('Отправлено: 1');
  await s.callback('cancel:b90');
  expect(s.edits.at(-1)?.text).toContain('отменены');
  expect(s.sent.filter((message) => message.chat_id === OWNER_ID)).toHaveLength(0);
  expect(s.edits.every((message) => message.message_id === 70)).toBe(true);
});
it('keeps player notifications intact and uses a separate reusable reply panel after restart', async () => {
  const s = await setup();
  await s.message(1, 1, 'Исходное обращение');
  await s.service.sweep();
  const relay = s.sent.find((message) => message.chat_id === OWNER_ID);
  if (!relay) throw new Error('Missing incoming relay');
  const before = s.sent.length;
  await s.callback('reply:1', relay.messageId);
  expect(s.sent).toHaveLength(before + 1);
  const panel = s.sent.at(-1);
  if (!panel) throw new Error('Missing reply panel');
  expect((await s.repository.session(s.now()))?.panelMessageId).toBe(panel.messageId);
  const reloaded = new CommunicationsService(
    new SqlCommunicationsRepository(s.local.db),
    s.social,
    s.telegram,
    s.now,
  );
  await reloaded.message({
    message_id: 20,
    from: { id: OWNER_ID, first_name: 'Owner' },
    chat: { id: OWNER_ID, type: 'private' },
    text: 'Мой ответ',
  });
  expect(s.edits.at(-1)).toMatchObject({ message_id: panel.messageId });
  expect(s.sent).toHaveLength(before + 1);
  expect(s.edits.some((message) => message.message_id === relay.messageId)).toBe(false);
  expect(await s.repository.recipientForReply(relay.messageId)).toBe(1);
  await s.callback('home', panel.messageId);
  expect(s.edits.at(-1)).toMatchObject({ message_id: panel.messageId });
  expect(await s.repository.session(s.now())).toBeNull();
});
it('does not edit any panel for an unauthorized callback', async () => {
  const s = await setup();
  for (const screen of [
    'home',
    'inbox:0',
    'thread:1',
    'reply:1',
    'delivery',
    'confirm:b90',
    'cancel:b90',
    'retry:out:99',
    'resend:out:99',
  ])
    await s.callback(screen, 70, 1);
  expect(s.edits).toHaveLength(0);
  expect(s.sent).toHaveLength(0);
});
it('supports selective recipients, rejects stale buttons and ignores disconnected recipients at confirmation', async () => {
  const s = await setup();
  await s.draft(false);
  await s.social.upsertGroup({ id: -100, title: 'Отключена', active: false, botAdmin: false });
  await s.callback('confirm:b90');
  await s.service.sweep(12);
  expect(s.sent.filter((m) => m.chat_id < 0)).toHaveLength(0);
  await s.callback('new', 71);
  await s.callback('all:s70');
  expect((await s.repository.session(s.now()))?.selected).toEqual([]);
});
it('sends owner broadcasts immediately without changing the record announcement cooldown', async () => {
  const s = await setup();
  await s.draft();
  expect(await s.social.reserveAnnouncement(-400, s.now(), 'record:test')).toBe(true);
  const before = await s.social.group(-400);
  await s.callback('confirm:b90');
  expect(s.sent.filter((m) => m.chat_id === -400)).toHaveLength(1);
  expect(
    await s.local.db.get('SELECT status,attempts FROM communication_jobs WHERE chat_id=-400'),
  ).toEqual({ status: 'sent', attempts: 1 });
  expect((await s.social.group(-400))?.nextNotificationAt).toBe(before?.nextNotificationAt);
  expect(await s.social.reserveAnnouncement(-400, s.now(), 'record:another')).toBe(false);
});
it('prioritizes the confirmed campaign over unrelated pending support messages', async () => {
  const s = await setup();
  await s.message(1, 1, 'Сообщение для владельца');
  await s.draft(false);
  await s.callback('confirm:b90');
  expect(s.sent.filter((message) => message.chat_id === -100)).toHaveLength(1);
  expect(s.sent.filter((message) => message.chat_id === OWNER_ID)).toHaveLength(0);
  expect(
    await s.local.db.get("SELECT status FROM communication_jobs WHERE kind='owner_inbox'"),
  ).toEqual({ status: 'pending' });
});
it('releases legacy group cooldown jobs without reviving sent jobs or bypassing Telegram retry delays', async () => {
  const s = await setup();
  await s.draft();
  await s.repository.confirm('b90', s.now());
  await s.local.db.run(
    "UPDATE communication_jobs SET due_at=:future,error='Group cooldown' WHERE chat_id=-100",
    { ':future': s.now() + 300000 },
  );
  await s.local.db.run(
    "UPDATE communication_jobs SET status='sent',telegram_message_id=1000 WHERE chat_id=-200",
  );
  await s.local.db.run(
    "UPDATE communication_jobs SET due_at=:future,error='Too Many Requests' WHERE chat_id=-400",
    { ':future': s.now() + 30000 },
  );
  await s.service.sweep(12);
  expect(s.sent.filter((message) => message.chat_id < 0).map((message) => message.chat_id)).toEqual(
    [-100],
  );
  await s.service.sweep(12);
  expect(s.sent.filter((message) => message.chat_id < 0)).toHaveLength(1);
  s.advance(30000);
  await s.service.sweep(12);
  expect(s.sent.filter((message) => message.chat_id < 0).map((message) => message.chat_id)).toEqual(
    [-100, -400],
  );
});
it('cancels pending broadcasts and never revives a cancelled campaign through retry', async () => {
  const s = await setup();
  await s.draft(false);
  await s.repository.confirm('b90', s.now());
  const send = vi.spyOn(s.telegram, 'send').mockRejectedValueOnce(new Error('Connection lost'));
  await s.service.sweep();
  send.mockRestore();
  await s.callback('cancel:b90');
  await s.repository.retryDelivery('broadcast:b90:-100', s.now());
  await s.service.sweep();
  expect(s.sent.filter((m) => m.chat_id < 0)).toHaveLength(0);
  expect((await s.repository.broadcast('b90'))?.status).toBe('cancelled');
});
it('retries definite 429s after retry_after and continues past a blocked recipient', async () => {
  const s = await setup();
  await s.draft();
  await s.repository.confirm('b90', s.now());
  const original = s.telegram.send.bind(s.telegram);
  let limited = true;
  vi.spyOn(s.telegram, 'send').mockImplementation(async (message) => {
    if (message.chat_id === -100 && limited) {
      limited = false;
      throw { code: 429, parameters: { retry_after: 30 } };
    }
    if (message.chat_id === -200) throw { code: 403 };
    return original(message);
  });
  await s.service.sweep(12);
  expect(s.sent.filter((m) => m.chat_id < 0).map((m) => m.chat_id)).toEqual([-400]);
  s.advance(29999);
  await s.service.sweep();
  expect(s.sent.filter((m) => m.chat_id === -100)).toHaveLength(0);
  s.advance(1);
  await s.service.sweep();
  expect(s.sent.filter((m) => m.chat_id === -100)).toHaveLength(1);
  expect(await s.local.db.get('SELECT status FROM communication_jobs WHERE chat_id=-200')).toEqual({
    status: 'failed',
  });
});
it('requires an explicit retry when an interrupted send could already have reached Telegram', async () => {
  const s = await setup();
  await s.draft(false);
  await s.repository.confirm('b90', s.now());
  const job = await s.repository.claim(s.now());
  expect(job).not.toBeNull();
  s.advance(60001);
  await s.service.sweep();
  expect(await s.local.db.get('SELECT status FROM communication_jobs')).toEqual({
    status: 'uncertain',
  });
  expect(s.sent.filter((m) => m.chat_id < 0)).toHaveLength(0);
  await s.callback('retry:broadcast:b90:-100');
  expect(s.edits.at(-1)?.text).toContain('повторно');
  expect(await s.local.db.get('SELECT status FROM communication_jobs')).toEqual({
    status: 'uncertain',
  });
  await s.callback('resend:broadcast:b90:-100');
  await s.service.sweep();
  expect(s.sent.filter((m) => m.chat_id === -100)).toHaveLength(1);
});
it('does not allow an expired or cancelled preview to start a new campaign', async () => {
  const s = await setup();
  await s.draft(false);
  s.advance(86400001);
  await s.callback('confirm:b90');
  expect(await s.repository.deliverySummary()).toEqual([]);
  expect(s.edits.at(-1)?.text).toContain('истёк');
});
it('installs idempotently without no-op CREATE TRIGGER writes in cloud mode', async () => {
  const s = await setup();
  await installCommunications({
    ...s.local.db,
    run: async (sql, parameters) => {
      if (sql.startsWith('CREATE TRIGGER')) throw new Error('Write query looks like a read one');
      return s.local.db.run(sql, parameters);
    },
  });
});
it('does not acknowledge acceptance when the atomic queue triggers are missing', async () => {
  const s = await setup();
  await s.local.db.run('DROP TRIGGER support_message_delivery');
  await s.message(1, 1, 'Не терять сообщение');
  expect(s.sent.at(-1)?.text).toContain('ещё не подключены');
  expect(await s.local.db.get('SELECT count(*) AS n FROM support_messages')).toEqual({ n: 0 });
});
it.each(['photo', 'video'] as const)(
  'delivers a %s bug report with its complete caption and retains reply routing',
  async (kind) => {
    const s = await setup();
    const caption = 'Подробности бага '.repeat(60).slice(0, 1024);
    const msg = {
      message_id: 10,
      from: { id: 1, first_name: 'P1' },
      chat: { id: 1, type: 'private' },
      caption,
      ...(kind === 'photo'
        ? {
            photo: [
              { file_id: 'small_file', width: 10, height: 10 },
              { file_id: 'large_file', width: 1000, height: 1000 },
            ],
          }
        : { video: { file_id: 'video_file' } }),
    };
    await s.service.message(msg);
    await s.service.message(msg);
    const history = await s.repository.history(1);
    expect(history).toHaveLength(1);
    expect(history[0]?.media).toMatchObject({ kind, caption });
    await s.service.sweep();
    await s.service.sweep();
    expect(s.mediaSent).toHaveLength(1);
    expect(s.mediaSent[0]).toMatchObject({
      chat_id: OWNER_ID,
      kind,
      caption,
      fileId: kind === 'photo' ? 'large_file' : 'video_file',
    });
    expect(await s.repository.recipientForReply(s.mediaSent[0]?.messageId ?? 0)).toBe(1);
    await s.message(11, OWNER_ID, 'Вижу баг, спасибо', s.mediaSent[0]?.messageId);
    await s.service.sweep();
    expect(
      s.sent.filter((message) => message.chat_id === 1 && message.text.includes('Вижу баг')),
    ).toHaveLength(1);
  },
);
it.each(['photo', 'video'] as const)(
  'accepts %s without a caption and allows the owner to reply with media',
  async (kind) => {
    const s = await setup();
    const media =
      kind === 'photo'
        ? { photo: [{ file_id: 'photo_file', width: 800, height: 600 }] }
        : { video: { file_id: 'video_file' } };
    await s.service.message({
      message_id: 1,
      from: { id: 1, first_name: 'P1' },
      chat: { id: 1, type: 'private' },
      ...media,
    });
    await s.service.sweep();
    const relay = s.mediaSent[0];
    if (!relay) throw new Error('Missing media relay');
    expect(relay.caption).toContain('Обращение от P1');
    const edited = s.edits.length;
    await s.service.message({
      message_id: 2,
      from: { id: OWNER_ID, first_name: 'Owner' },
      chat: { id: OWNER_ID, type: 'private' },
      ...media,
      caption: 'Вот как должно работать',
      reply_to_message: { message_id: relay.messageId },
    });
    await s.service.sweep();
    expect(s.mediaSent[1]).toMatchObject({ chat_id: 1, kind, caption: 'Вот как должно работать' });
    expect(s.edits.slice(edited).some((message) => message.message_id === relay.messageId)).toBe(
      false,
    );
  },
);
it('accepts a ten-item album as one report for the rate limit and persists every attachment before delivery', async () => {
  const s = await setup();
  for (let id = 1; id <= 4; id++) await s.message(id, 1, `Идея ${id}`);
  for (let part = 0; part < 10; part++)
    await s.service.message({
      message_id: 10 + part,
      from: { id: 1, first_name: 'P1' },
      chat: { id: 1, type: 'private' },
      media_group_id: 'album_1',
      photo: [{ file_id: `part_${part}`, width: 800, height: 600 }],
    });
  expect(await s.local.db.get('SELECT count(*) AS n FROM support_messages')).toEqual({ n: 14 });
  expect(await s.local.db.get('SELECT count(*) AS n FROM communication_attachments')).toEqual({
    n: 10,
  });
  await s.message(30, 1, 'Сверх лимита');
  expect(await s.local.db.get('SELECT count(*) AS n FROM support_messages')).toEqual({ n: 14 });
  const reloaded = new CommunicationsService(
    new SqlCommunicationsRepository(s.local.db),
    s.social,
    s.telegram,
    s.now,
  );
  await reloaded.sweep(20);
  expect(s.mediaSent).toHaveLength(10);
});
it('does not accept a URL disguised as a file id or a changed attachment on an idempotent retry', async () => {
  const s = await setup();
  const msg = {
    message_id: 1,
    from: { id: 1, first_name: 'P1' },
    chat: { id: 1, type: 'private' },
  };
  await s.service.message({ ...msg, video: { file_id: 'https://example.com/movie.mp4' } });
  expect(await s.repository.thread(1)).toBeNull();
  await s.service.message({ ...msg, video: { file_id: 'original_file' } });
  await s.service.message({ ...msg, video: { file_id: 'different_file' } });
  await s.service.sweep();
  expect(s.mediaSent).toHaveLength(1);
  expect(s.mediaSent[0]?.fileId).toBe('original_file');
});
it('preserves a media job through a definite API failure and retries using the same file id', async () => {
  const s = await setup();
  await s.service.message({
    message_id: 1,
    from: { id: 1, first_name: 'P1' },
    chat: { id: 1, type: 'private' },
    video: { file_id: 'retry_video' },
  });
  const original = s.telegram.sendMedia.bind(s.telegram);
  let first = true;
  vi.spyOn(s.telegram, 'sendMedia').mockImplementation(async (input) => {
    if (first) {
      first = false;
      throw { code: 429, parameters: { retry_after: 5 } };
    }
    return original(input);
  });
  await s.service.sweep();
  expect(s.mediaSent).toHaveLength(0);
  s.advance(5000);
  await s.service.sweep();
  expect(s.mediaSent).toHaveLength(1);
  expect(s.mediaSent[0]?.fileId).toBe('retry_video');
});
it('does not accept media for a text-only group broadcast', async () => {
  const s = await setup();
  await s.callback('new');
  await s.callback('all:s70');
  await s.callback('compose:s70');
  await s.service.message({
    message_id: 2,
    from: { id: OWNER_ID, first_name: 'Owner' },
    chat: { id: OWNER_ID, type: 'private' },
    photo: [{ file_id: 'photo_file', width: 800, height: 600 }],
    caption: 'Новости',
  });
  expect(s.edits.at(-1)?.text).toContain('Для рассылки сейчас нужен текст');
  expect(await s.repository.broadcast('b2')).toBeNull();
  expect(s.mediaSent).toHaveLength(0);
});
