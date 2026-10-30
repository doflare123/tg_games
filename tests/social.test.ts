import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import { ArcadeService } from '../src/server/domain/arcade.ts';
import { type GAME_COMMANDS, GameBotService } from '../src/server/domain/bot.ts';
import { GroupService } from '../src/server/domain/groups.ts';
import { MaintenanceService } from '../src/server/domain/maintenance.ts';
import type { StoredRun } from '../src/server/domain/repository.ts';
import type { SendMessage, TelegramGateway } from '../src/server/domain/telegram.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});
async function setup() {
  const local = localRepository();
  handles.push(local);
  let now = Date.UTC(2026, 9, 30);
  const repository = new SqlSocialRepository(local.db, local.repository);
  const members = new Map<number, { active: boolean; admin: boolean }>([
    [1, { active: true, admin: true }],
    [2, { active: true, admin: false }],
    [3, { active: true, admin: false }],
  ]);
  const sent: SendMessage[] = [];
  let nextId = 100;
  const commands: Array<{ chatId?: number; commands: typeof GAME_COMMANDS }> = [];
  const telegram: TelegramGateway = {
    async me() {
      return { id: 99, username: 'arcade_bot', hasMainMiniApp: true };
    },
    async member(_group, user) {
      return user === 99
        ? { active: true, admin: true }
        : (members.get(user) ?? { active: false, admin: false });
    },
    async send(input) {
      sent.push(input);
      return { messageId: null, ephemeralId: nextId++, date: Math.floor(now / 1000) };
    },
    async commands(input, chatId) {
      commands.push({ ...(chatId === undefined ? {} : { chatId }), commands: input });
    },
  };
  await repository.upsertGroup({ id: -100, title: 'Группа А', active: true, botAdmin: true });
  for (const userId of [1, 2, 3])
    await repository.observeMember({ chatId: -100, userId, active: true, updatedAt: now });
  const groups = new GroupService(repository, telegram, () => now);
  const arcade = new ArcadeService(local.repository, { now: () => now, seed: () => 1 }, groups);
  const maintenance = new MaintenanceService(
    repository,
    local.repository,
    groups,
    telegram,
    () => now,
  );
  const bot = new GameBotService(repository, groups, telegram, () => now, 'https://arcade.test/');
  async function verified(
    id: string,
    userId: number,
    score: number,
    groupIds = [-100],
    ticks = 100,
  ): Promise<StoredRun> {
    const state = createTetris(1, 'marathon');
    const run: StoredRun = {
      id,
      playerId: userId,
      playerName: `P${userId}`,
      mode: 'marathon',
      ruleset: 'tetris-arcade-v1',
      revision: 0,
      state,
      status: 'active',
      createdAt: now,
      expiresAt: now + 100000,
      lastSubmission: null,
      groupIds,
      verifiedOrder: 0,
      verifiedAt: 0,
      socialProcessed: false,
    };
    await local.repository.create(run);
    state.score = score;
    state.tick = ticks;
    state.status = 'lost';
    await local.repository.save(
      { ...run, state, revision: 1, status: 'verified', verifiedAt: now },
      0,
    );
    const saved = await local.repository.get(id);
    if (!saved) throw new Error('Missing fixture');
    return saved;
  }
  return {
    local,
    repository,
    groups,
    arcade,
    maintenance,
    bot,
    telegram,
    members,
    sent,
    commands,
    verified,
    player: { id: 1, name: 'P1' },
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe('group access and board scope', () => {
  it('returns only known groups with freshly verified membership', async () => {
    const s = await setup();
    expect((await s.groups.list(s.player)).map((g) => g.id)).toEqual([-100]);
    s.members.set(1, { active: false, admin: false });
    expect(await s.groups.list(s.player)).toEqual([]);
    await expect(
      s.arcade.leaderboard(s.player, { mode: 'marathon', period: 'all', groupId: -100 }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('prevents a normal member changing notification settings', async () => {
    const s = await setup();
    await expect(
      s.groups.configure({ id: 2, name: 'P2' }, { groupId: -100, enabled: true }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await s.repository.group(-100))?.notificationsEnabled).toBe(false);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    expect((await s.repository.group(-100))?.notificationsEnabled).toBe(true);
  });
  it('freezes eligible groups at start and does not project old global records into groups', async () => {
    const s = await setup();
    const run = await s.arcade.create(s.player, {
      mode: 'marathon',
      requestId: '1234567890abcdef',
    });
    expect((await s.local.repository.get(run.id))?.groupIds).toEqual([-100]);
    await s.verified('global', 2, 900, []);
    await s.verified('group', 1, 100, [-100]);
    const global = await s.arcade.leaderboard(s.player, { mode: 'marathon', period: 'all' });
    const group = await s.arcade.leaderboard(s.player, {
      mode: 'marathon',
      period: 'all',
      groupId: -100,
    });
    expect(global.entries.map((e) => e.runId)).toEqual(['global', 'group']);
    expect(group.entries.map((e) => e.runId)).toEqual(['group']);
  });
});
describe('record announcements', () => {
  it('announces only overtaking into a better top-ten position, once per run', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    const rival = await s.verified('rival', 2, 100);
    await s.maintenance.result(rival);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    const first = await s.verified('first', 1, 150);
    await s.maintenance.result(first);
    await s.maintenance.result(first);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('больше на 50 очков');
    expect(s.sent[0]?.text).toContain('№1');
    const sameRank = await s.verified('same-rank', 1, 200);
    await s.maintenance.result(sameRank);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
  });
  it('keeps chronological rank snapshots if several results finalize before processing', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    const a = await s.verified('a', 1, 150);
    const b = await s.verified('b', 3, 200);
    expect(a.verifiedOrder).toBeLessThan(b.verifiedOrder);
    const before = await s.local.repository.leaderboard(s.player, 'marathon', 'all', 0, {
      groupId: -100,
      maxVerifiedOrder: a.verifiedOrder - 1,
    });
    const after = await s.local.repository.leaderboard(s.player, 'marathon', 'all', 0, {
      groupId: -100,
      maxVerifiedOrder: a.verifiedOrder,
    });
    expect(before.me).toBeNull();
    expect(after.me?.rank).toBe(1);
    expect(after.entries.some((e) => e.playerId === 3)).toBe(false);
  });
  it('suppresses messages when settings are disabled after enqueue', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    await s.maintenance.result(await s.verified('winner', 1, 150));
    await s.groups.configure(s.player, { groupId: -100, enabled: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('does not announce when no rival was overtaken or the player left the group', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    const winner = await s.verified('winner', 1, 150);
    s.members.set(1, { active: false, admin: false });
    await s.maintenance.result(winner);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('respects a per-group cooldown and recovers pending social effects after a process restart', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    await s.verified('winner', 1, 150);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    await s.verified('next', 3, 200);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    s.advance(300001);
    await s.verified('return', 2, 250);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
  });
});
describe('native private game commands', () => {
  const payload = {
    text: '/game_tetris@arcade_bot',
    chat: { id: -100, type: 'supergroup', title: 'Группа А' },
    from: { id: 1, first_name: 'P1' },
    date: 1793318400,
    message_id: 0,
    ephemeral_message_id: 7,
  };
  it('responds only to the caller with a direct game link without scheduling timed deletion', async () => {
    const s = await setup();
    await s.bot.message(payload, { update: { update_id: 1 } });
    expect(s.sent[0]?.ephemeral_message_parameters).toEqual({ receiver_user_id: 1 });
    expect(s.sent[0]?.reply_parameters).toEqual({ ephemeral_message_id: 7 });
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: 'Играть',
      url: 'https://t.me/arcade_bot?startapp=game_tetris',
    });
    await s.maintenance.sweep();
    expect(s.local.database.prepare('SELECT count(*) AS total FROM social_jobs').get()?.total).toBe(
      0,
    );
    s.advance(60000);
    await s.maintenance.sweep();
    expect(s.local.database.prepare('SELECT count(*) AS total FROM social_jobs').get()?.total).toBe(
      0,
    );
  });
  it('opens the hosted Mini App in private even without a configured Main Mini App', async () => {
    const s = await setup();
    s.telegram.me = async () => ({ id: 99, username: 'arcade_bot', hasMainMiniApp: false });
    await s.bot.message({
      text: '/start game_tetris',
      chat: { id: 1, type: 'private' },
      from: payload.from,
    });
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: 'Открыть Arcade',
      web_app: { url: 'https://arcade.test/?startapp=game_tetris' },
    });
    expect(s.sent[0]?.ephemeral_message_parameters).toBeUndefined();
  });
  it('uses a private bot deep link in groups until Main Mini App is enabled', async () => {
    const s = await setup();
    s.telegram.me = async () => ({ id: 99, username: 'arcade_bot', hasMainMiniApp: false });
    await s.bot.message({ ...payload, text: '/game_tetris' });
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: 'Открыть в боте',
      url: 'https://t.me/arcade_bot?start=game_tetris',
    });
    expect(s.sent[0]?.ephemeral_message_parameters).toEqual({ receiver_user_id: 1 });
  });
  it('ignores commands addressed to another bot and registers native ephemeral commands', async () => {
    const s = await setup();
    await s.bot.message({ ...payload, text: '/game_tetris@other_bot' });
    expect(s.sent).toHaveLength(0);
    await s.bot.configure();
    expect(s.commands[0]?.commands.every((c) => c.is_ephemeral)).toBe(true);
    expect(
      s.commands[0]?.commands.some((c) => c.command === 'game_doom' || c.command === 'game_mario'),
    ).toBe(false);
    expect(s.commands.some((entry) => entry.chatId === -100)).toBe(true);
  });
});

describe('delivery edge cases', () => {
  it('does not announce a result outside top ten and announces a later entry', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    for (let index = 0; index < 11; index++)
      await s.verified(`rival-${index}`, index + 10, 220 - index);
    const outside = await s.verified('outside', 1, 100);
    await s.maintenance.result(outside);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    const entry = await s.verified('entry', 1, 215);
    await s.maintenance.result(entry);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('12 →');
  });
  it('retries a 429 without losing the group cooldown reservation', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    await s.maintenance.result(await s.verified('winner', 1, 150));
    const original = s.telegram.send;
    let first = true;
    s.telegram.send = async (input) => {
      if (first) {
        first = false;
        throw Object.assign(new Error('Rate limited'), {
          code: 429,
          parameters: { retry_after: 3 },
        });
      }
      return original(input);
    };
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    s.advance(3001);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
  });
  it('does not publish a stale record after a long outage', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    const run = await s.verified('winner', 1, 150);
    s.advance(300001);
    await s.maintenance.result(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('does not fall back to a public response when private delivery fails', async () => {
    const s = await setup();
    let calls = 0;
    s.telegram.send = async () => {
      calls++;
      throw new Error('Ephemeral not supported');
    };
    await expect(
      s.bot.message({
        text: '/game_mario',
        chat: { id: -100, type: 'supergroup', title: 'Группа А' },
        from: { id: 1, first_name: 'P1' },
        date: 1793318400,
        ephemeral_message_id: 3,
        message_id: 0,
      }),
    ).rejects.toThrow('Ephemeral');
    expect(calls).toBe(1);
  });
});
