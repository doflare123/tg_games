import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import type { TetrisMode } from '../src/games/tetris/types.ts';
import { ArcadeService } from '../src/server/domain/arcade.ts';
import { type GAME_COMMANDS, GameBotService } from '../src/server/domain/bot.ts';
import { GroupService } from '../src/server/domain/groups.ts';
import { MaintenanceService } from '../src/server/domain/maintenance.ts';
import { decodeManualResult } from '../src/server/domain/manual-result.ts';
import type { StoredRun } from '../src/server/domain/repository.ts';
import type { SendMessage, TelegramGateway } from '../src/server/domain/telegram.ts';
import { SqlManualResultRepository } from '../src/server/platform/sql-manual-results.ts';
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
    mode: TetrisMode = 'marathon',
  ): Promise<StoredRun> {
    const state = createTetris(1, mode);
    const run: StoredRun = {
      id,
      playerId: userId,
      playerName: `P${userId}`,
      mode,
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
    state.status = mode === 'sprint' ? 'won' : 'lost';
    if (mode === 'sprint') state.lines = 40;
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
  it('keeps the notification snapshot but includes earlier results of current group members', async () => {
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
    expect(group.entries.map((e) => e.runId)).toEqual(['global', 'group']);
  });
});
describe('historical results in a newly connected group', () => {
  it('discovers existing players, includes verified/manual bests, and imports silently without copying runs', async () => {
    const s = await setup();
    await s.verified('old-verified', 1, 500, [-100]);
    await s.verified('outsider', 3, 1000, []);
    await new SqlManualResultRepository(s.local.db).record(
      decodeManualResult({
        id: 'manual:past-result',
        player: { id: 2, name: 'P2' },
        mode: 'marathon',
        score: 600,
        lines: 60,
        ticks: null,
        groupIds: [-100],
        reason: 'Historical correction fixture',
        operator: 'Owner',
        approximate: true,
      }),
      s.now(),
    );
    const globalBefore = await s.arcade.leaderboard(s.player, { mode: 'marathon', period: 'all' });
    const membersC = new Set([1, 2]);
    const original = s.telegram.member;
    s.telegram.member = async (chat, user) =>
      chat === -200
        ? { active: user === 99 || membersC.has(user), admin: user === 99 || user === 1 }
        : original(chat, user);
    s.advance(1000);
    await s.bot.botMembership({
      chat: { id: -200, title: 'C', type: 'supergroup' },
      new_chat_member: { status: 'administrator' },
    });
    const imported = await s.local.repository.leaderboard(s.player, 'marathon', 'all', 0, {
      groupId: -200,
    });
    expect(imported.entries.map((e) => e.runId)).toEqual(['manual:past-result', 'old-verified']);
    expect((await s.groups.list(s.player)).map((g) => g.id)).toContain(-200);
    await s.groups.configure(s.player, { groupId: -200, enabled: true });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    expect(await s.arcade.leaderboard(s.player, { mode: 'marathon', period: 'all' })).toEqual(
      globalBefore,
    );
    expect((await s.local.repository.get('old-verified'))?.groupIds).toEqual([-100]);
    expect(await s.local.db.get('SELECT count(*) AS total FROM runs')).toEqual({ total: 2 });
    membersC.delete(1);
    s.advance(1000);
    await s.bot.membership({
      chat: { id: -200, type: 'supergroup' },
      date: s.now() / 1000,
      new_chat_member: { user: { id: 1 }, status: 'left' },
    });
    const afterLeave = await s.arcade.leaderboard(
      { id: 2, name: 'P2' },
      { mode: 'marathon', period: 'all', groupId: -200 },
    );
    expect(afterLeave.entries.map((e) => e.playerId)).toEqual([2]);
    expect(
      (
        await s.local.repository.leaderboard(s.player, 'marathon', 'all', 0, { groupId: -100 })
      ).entries.some((e) => e.playerId === 1),
    ).toBe(true);
    await expect(
      s.arcade.leaderboard(s.player, { mode: 'marathon', period: 'all', groupId: -200 }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('finds an existing group for a player who never used commands there', async () => {
    const s = await setup();
    await s.verified('past-global', 1, 400, []);
    await s.repository.upsertGroup({ id: -200, title: 'C', active: true, botAdmin: true });
    expect((await s.groups.list(s.player)).map((g) => g.id)).toContain(-200);
    const board = await s.arcade.leaderboard(s.player, {
      mode: 'marathon',
      period: 'all',
      groupId: -200,
    });
    expect(board.me?.runId).toBe('past-global');
    expect(board.membershipSync).toBe('complete');
  });
  it('bounds membership checks and resumes from durable membership rows', async () => {
    const s = await setup();
    for (let user = 10; user < 40; user++) {
      s.members.set(user, { active: true, admin: false });
      await s.verified(`past-${user}`, user, user, []);
    }
    await s.repository.upsertGroup({ id: -200, title: 'C', active: true, botAdmin: true });
    let calls = 0;
    const original = s.telegram.member;
    s.telegram.member = async (chat, user) => {
      if (chat === -200) calls++;
      return original(chat, user);
    };
    expect((await s.groups.synchronize(-200)).state).toBe('pending');
    expect(calls).toBe(24);
    expect((await s.groups.synchronize(-200)).state).toBe('complete');
    expect(calls).toBe(30);
    expect((await s.groups.synchronize(-200)).state).toBe('complete');
    expect(calls).toBe(30);
  });
  it('does not treat a Telegram outage as leaving or expose stale unconfirmed results', async () => {
    const s = await setup();
    await s.verified('mine', 1, 100, []);
    await s.verified('rival', 2, 200, []);
    await s.repository.upsertGroup({ id: -200, title: 'C', active: true, botAdmin: true });
    await s.repository.observeMember({ chatId: -200, userId: 2, active: true, updatedAt: s.now() });
    s.advance(16 * 60_000);
    const original = s.telegram.member;
    s.telegram.member = async (chat, user) => {
      if (chat === -200 && user === 2) throw new Error('API unavailable');
      return original(chat, user);
    };
    const partial = await s.arcade.leaderboard(s.player, {
      mode: 'marathon',
      period: 'all',
      groupId: -200,
    });
    expect(partial.membershipSync).toBe('failed');
    expect(partial.entries.map((e) => e.playerId)).toEqual([1]);
    expect(
      await s.local.db.get(
        'SELECT active FROM group_memberships WHERE group_id=-200 AND user_id=2',
      ),
    ).toEqual({ active: 1 });
    s.telegram.member = original;
    const recovered = await s.arcade.leaderboard(s.player, {
      mode: 'marathon',
      period: 'all',
      groupId: -200,
    });
    expect(recovered.membershipSync).toBe('complete');
    expect(recovered.entries.map((e) => e.playerId)).toEqual([2, 1]);
  });
});

describe('record announcements', () => {
  it.each([true, false])(
    'links a Sprint record to Sprint with main app enabled=%s',
    async (hasMainMiniApp) => {
      const s = await setup();
      s.telegram.me = async () => ({ id: 99, username: 'arcade_bot', hasMainMiniApp });
      await s.groups.configure(s.player, { groupId: -100, enabled: true });
      s.advance(1);
      await s.maintenance.result(
        await s.verified('sprint-record', 1, 1000, [-100], 6000, 'sprint'),
      );
      await s.maintenance.sweep();
      expect(s.sent[0]?.text).toContain('Sprint 40 линий');
      expect(s.sent[0]?.text).toContain('Хочешь побить рекорд?');
      expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
        text: '🎮 Побить рекорд',
        url: `https://t.me/arcade_bot?${hasMainMiniApp ? 'startapp' : 'start'}=game_tetris_sprint`,
      });
    },
  );

  it('announces first and improved group records even when a stronger global result exists', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    s.members.set(3, { active: false, admin: false });
    await s.repository.observeMember({
      chatId: -100,
      userId: 3,
      active: false,
      updatedAt: s.now(),
    });
    await s.verified('global-only', 3, 9999, []);
    const first = await s.verified('first-group', 1, 100);
    await s.maintenance.result(first);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.chat_id).toBe(-100);
    expect(s.sent[0]?.text).toContain('Первый рекорд группы');
    expect(s.sent[0]?.text).toContain('Хочешь побить рекорд? Заходи играть!');
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: '🎮 Побить рекорд',
      url: 'https://t.me/arcade_bot?startapp=game_tetris_marathon',
    });
    expect(
      (await s.arcade.leaderboard(s.player, { mode: 'marathon', period: 'all' })).me?.rank,
    ).toBe(2);
    s.advance(300001);
    await s.maintenance.result(await s.verified('improved-group', 1, 150));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('Улучшен рекорд группы');
    expect(s.sent[1]?.text).toContain('больше на 50 очков');
  });
  it('ignores personal improvement at the same non-leading group rank', async () => {
    const s = await setup();
    await s.verified('leader', 2, 300);
    await s.verified('old-second', 1, 100);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.maintenance.result(await s.verified('new-second', 1, 150));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });

  it('announces the first group record and later overtaking, once per run and within cooldown', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    const rival = await s.verified('rival', 2, 100);
    await s.maintenance.result(rival);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('Первый рекорд группы');
    s.advance(300001);
    const first = await s.verified('first', 1, 150);
    await s.maintenance.result(first);
    await s.maintenance.result(first);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('больше на 50 очков');
    expect(s.sent[1]?.text).toContain('№1');
    const sameRank = await s.verified('same-rank', 1, 200);
    await s.maintenance.result(sameRank);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
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
  it('does not announce when the player left the group', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('rival', 2, 100);
    await s.repository.processed('rival');
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
  it('opens Minesweeper directly and registers its game command', async () => {
    const s = await setup();
    await s.bot.message({ ...payload, text: '/game_minesweeper@arcade_bot' });
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: 'Играть',
      url: 'https://t.me/arcade_bot?startapp=game_minesweeper',
    });
    await s.bot.configure();
    expect(s.commands[0]?.commands.some((c) => c.command === 'game_minesweeper')).toBe(true);
  });
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
    for (let index = 0; index < 11; index++) {
      s.members.set(index + 10, { active: true, admin: false });
      await s.verified(`rival-${index}`, index + 10, 220 - index);
    }
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
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
