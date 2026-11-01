import { afterEach, describe, expect, it, vi } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { DIRECTIONS, type Direction, move2048 } from '../src/games/2048/engine.ts';
import { type MineSize, SIZES } from '../src/games/minesweeper/engine.ts';
import {
  createSnake,
  SNAKE_SIZES,
  SNAKE_STEP_MS,
  type SnakeDirection,
  stepSnake,
} from '../src/games/snake/engine.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import type { TetrisMode } from '../src/games/tetris/types.ts';
import { Service2048 } from '../src/server/domain/2048.ts';
import { ArcadeService } from '../src/server/domain/arcade.ts';
import { type GAME_COMMANDS, GameBotService } from '../src/server/domain/bot.ts';
import { GroupService } from '../src/server/domain/groups.ts';
import { MaintenanceService } from '../src/server/domain/maintenance.ts';
import { decodeManualResult } from '../src/server/domain/manual-result.ts';
import { MinesweeperService } from '../src/server/domain/minesweeper.ts';
import type { StoredRun } from '../src/server/domain/repository.ts';
import { SnakeService } from '../src/server/domain/snake.ts';
import type { SendMessage, TelegramGateway } from '../src/server/domain/telegram.ts';
import { Sql2048Repository } from '../src/server/platform/sql-2048.ts';
import { SqlManualResultRepository } from '../src/server/platform/sql-manual-results.ts';
import { SqlMineRepository } from '../src/server/platform/sql-minesweeper.ts';
import { SqlSnakeRepository } from '../src/server/platform/sql-snake.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';
import { AppError } from '../src/shared/errors.ts';
import { parseLaunch } from '../src/shared/launch.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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
  const mineRepository = new SqlMineRepository(local.db);
  const minesweeper = new MinesweeperService(mineRepository, { now: () => now });
  const puzzleRepository = new Sql2048Repository(local.db);
  const puzzle = new Service2048(puzzleRepository, { now: () => now, seed: () => 123 });
  const snakeRepository = new SqlSnakeRepository(local.db);
  let snakeSeed = 0;
  while (createSnake(12, snakeSeed).food !== 79) snakeSeed++;
  const snake = new SnakeService(snakeRepository, { now: () => now, seed: () => snakeSeed });
  const maintenance = new MaintenanceService(
    repository,
    local.repository,
    groups,
    telegram,
    () => now,
    mineRepository,
    puzzleRepository,
    snakeRepository,
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
    mineRepository,
    minesweeper,
    puzzleRepository,
    puzzle,
    snakeRepository,
    snake,
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

async function mineResult(
  s: Awaited<ReturnType<typeof setup>>,
  id: string,
  playerId: number,
  elapsedMs: number,
  size: MineSize = '9x9',
) {
  const result = await s.minesweeper.submit(
    { id: playerId, name: `P${playerId}` },
    {
      requestId: `notice_${id.padEnd(16, '_')}`,
      size,
      elapsedMs,
    },
  );
  const run = await s.mineRepository.getStored(result.id);
  if (!run) throw new Error('Missing mine result');
  return run;
}

async function puzzleResult(
  s: Awaited<ReturnType<typeof setup>>,
  id: string,
  playerId: number,
  score: number,
) {
  const created = await s.puzzle.create(
    { id: playerId, name: `P${playerId}` },
    { requestId: `puzzle_${id.padEnd(16, '_')}` },
  );
  const run = await s.puzzleRepository.get(created.id);
  if (!run) throw new Error('Missing puzzle fixture');
  await s.puzzleRepository.save(
    {
      ...run,
      status: 'verified',
      revision: 1,
      state: { ...run.state, score },
      verifiedAt: s.now(),
    },
    0,
  );
  const stored = await s.puzzleRepository.get(created.id);
  if (!stored) throw new Error('Missing puzzle result');
  return stored;
}

describe('2048 record announcements', () => {
  it('recovers a job that expired before it was enqueued, sends it once, and leaves normal expiry alone', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const run = await puzzleResult(s, 'broken-deadline', 1, 5000);
    await s.maintenance.result2048(run);
    const jobId = `record:${run.id}:-100`;
    await s.local.db.run(
      "UPDATE social_jobs SET status='expired',due_at=:due,expires_at=:expires WHERE id=:id",
      {
        ':id': jobId,
        ':due': s.now() + 20 * 60000,
        ':expires': run.verifiedAt + 300000,
      },
    );
    s.advance(20 * 60000);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(
      await s.local.db.get('SELECT status FROM social_jobs WHERE id=:id', { ':id': jobId }),
    ).toEqual({ status: 'done' });
    await s.local.db.run(
      "UPDATE social_jobs SET status='expired',due_at=:due,expires_at=:expires WHERE id=:id",
      { ':id': jobId, ':due': s.now() - 5000, ':expires': s.now() - 1000 },
    );
    expect(await s.repository.recover2048Expired(s.now())).toBe(0);
  });
  it('defers a 2048 record during another game’s cooldown and sends after five minutes', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.mineResult(await mineResult(s, 'cooldown-before-puzzle', 1, 10000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    const run = await puzzleResult(s, 'deferred-record', 1, 5000);
    await s.maintenance.result2048(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(
      await s.local.db.get('SELECT status,error FROM social_jobs WHERE id=:id', {
        ':id': `record:${run.id}:-100`,
      }),
    ).toEqual({ status: 'pending', error: 'Group cooldown' });
    s.advance(300001);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('2048 · 5000 очков');
  });
  it('keeps legacy results silent while opting an existing active game into new announcements on completion', async () => {
    const s = await setup();
    const created = await s.puzzle.create(s.player, { requestId: 'puzzle_legacy_1234567' });
    // Omitting the added columns uses exactly the defaults applied to pre-migration rows.
    await s.local.db.run(
      `INSERT INTO puzzle2048_runs
      (id,player_id,player_name,ruleset,revision,state_json,status,score,max_tile,created_at,expires_at,last_submission)
      SELECT 'legacy-result',2,'P2',ruleset,revision,state_json,'verified',0,max_tile,created_at,expires_at,last_submission
      FROM puzzle2048_runs WHERE id=:id`,
      { ':id': created.id },
    );
    expect((await s.puzzleRepository.get('legacy-result'))?.socialProcessed).toBe(true);
    expect(await s.puzzleRepository.pendingResults(3)).toEqual([]);
    await s.local.db.run('UPDATE puzzle2048_runs SET social_processed=1 WHERE id=:id', {
      ':id': created.id,
    });
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.puzzle.submit(s.player, { runId: created.id, revision: 0, moves: [], finish: true });
    expect((await s.puzzleRepository.get(created.id))?.socialProcessed).toBe(false);
    expect((await s.puzzleRepository.pendingResults(3)).map((r) => r.id)).toEqual([created.id]);
  });
  it('defers an incomplete membership check and does not announce results outside the group top ten', async () => {
    const s = await setup();
    for (let id = 2; id <= 12; id++) {
      s.members.set(id, { active: true, admin: false });
      await puzzleResult(s, `rival-${id}`, id, id * 100);
    }
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.result2048(await puzzleResult(s, 'outside-top', 1, 50));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    const winner = await puzzleResult(s, 'winner-after-outage', 1, 5000);
    s.advance(16 * 60_000);
    const member = s.telegram.member;
    s.telegram.member = async (chat, id) => {
      if (id === 2) throw new Error('Telegram outage');
      return member(chat, id);
    };
    await expect(s.maintenance.result2048(winner)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await s.puzzleRepository.get(winner.id))?.socialProcessed).toBe(false);
    expect(s.sent).toHaveLength(0);
    s.telegram.member = member;
    await s.maintenance.result2048(winner);
    await s.maintenance.sweep();
    // Delayed generation gets a valid delivery window after the outage.
    expect(s.sent).toHaveLength(1);
    expect((await s.puzzleRepository.get(winner.id))?.socialProcessed).toBe(true);
  });
  it('recovers a verified result from the replay service and announces it once with a 2048 link', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const initial = await s.puzzle.create(s.player, { requestId: 'puzzle_live_123456789' });
    const simulated = structuredClone(initial.state);
    const moves: Direction[] = [];
    for (let i = 0; i < 20; i++) {
      const direction = DIRECTIONS.find((d) => move2048(structuredClone(simulated), d));
      if (!direction) throw new Error('Missing move');
      moves.push(direction);
      move2048(simulated, direction);
    }
    s.advance(10);
    const input = { runId: initial.id, revision: 0, moves, finish: true };
    await s.puzzle.submit(s.player, input);
    const stored = await s.puzzleRepository.get(initial.id);
    expect(stored).toMatchObject({ verifiedAt: s.now(), verifiedOrder: 1, socialProcessed: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain(`2048 · ${simulated.score} очков`);
    expect(s.sent[0]?.text).toContain('Первый рекорд группы');
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: '🎮 Побить рекорд',
      url: 'https://t.me/arcade_bot?startapp=game_2048',
    });
    await s.puzzle.submit(s.player, input);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect((await s.puzzleRepository.get(initial.id))?.socialProcessed).toBe(true);
    expect(await s.puzzleRepository.pendingResults(3)).toEqual([]);
  });
  it('compares group scores, excludes outsiders, and announces leader improvements', async () => {
    const s = await setup();
    await puzzleResult(s, 'rival', 2, 1000);
    await puzzleResult(s, 'outsider', 3, 9000);
    s.members.set(3, { active: false, admin: false });
    await s.repository.observeMember({
      chatId: -100,
      userId: 3,
      active: false,
      updatedAt: s.now(),
    });
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.maintenance.result2048(await puzzleResult(s, 'winner', 1, 1500));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('P2');
    expect(s.sent[0]?.text).toContain('больше на 500 очков');
    expect((await s.puzzle.leaderboard(s.player, { period: 'all' })).me?.rank).toBe(2);
    s.advance(300001);
    await s.maintenance.result2048(await puzzleResult(s, 'improved', 1, 1700));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('Улучшен рекорд группы: больше на 200 очков');
  });
  it('ignores same-place personal improvements, tied leader scores and old results', async () => {
    const s = await setup();
    await puzzleResult(s, 'leader', 2, 10000);
    await puzzleResult(s, 'second', 1, 500);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    await s.maintenance.result2048(await puzzleResult(s, 'personal', 1, 900));
    await s.maintenance.result2048(await puzzleResult(s, 'tie', 2, 10000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('orders snapshots by completion, suppresses superseded records and shares the group cooldown', async () => {
    const s = await setup();
    const early = await s.puzzle.create(s.player, { requestId: 'puzzle_early_1234567' });
    await puzzleResult(s, 'rival', 2, 100);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const original = await s.puzzleRepository.get(early.id);
    if (!original) throw new Error('Missing fixture');
    await s.puzzleRepository.save(
      {
        ...original,
        status: 'verified',
        revision: 1,
        state: { ...original.state, score: 200 },
        verifiedAt: s.now(),
      },
      0,
    );
    const a = await s.puzzleRepository.get(early.id);
    if (!a) throw new Error('Missing result');
    expect(a.verifiedOrder).toBe(2);
    const before = await s.puzzleRepository.leaderboard(s.player, 'all', 0, {
      groupId: -100,
      maxResultOrder: a.verifiedOrder - 1,
    });
    expect(before.me).toBeNull();
    expect(before.entries[0]?.playerId).toBe(2);
    const b = await puzzleResult(s, 'new-winner', 3, 300);
    await s.maintenance.result2048(a);
    await s.maintenance.result2048(b);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('P3');
    await s.maintenance.mineResult(await mineResult(s, 'mine-cooldown', 1, 30000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    s.advance(300001);
    await s.maintenance.result2048(await puzzleResult(s, 'later', 1, 400));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
  });
  it('retries a Telegram failure, and rechecks membership before delivery', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.result2048(await puzzleResult(s, 'retry', 1, 100));
    const send = s.telegram.send;
    s.telegram.send = vi
      .fn()
      .mockRejectedValueOnce({ code: 429, parameters: { retry_after: 2 } })
      .mockImplementation(send);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    s.advance(2100);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    s.advance(300001);
    await s.maintenance.result2048(await puzzleResult(s, 'left', 1, 200));
    s.members.set(1, { active: false, admin: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
  });
  it('discovers old players in new groups without announcing their historical records', async () => {
    const s = await setup();
    await puzzleResult(s, 'old', 2, 500);
    await s.repository.upsertGroup({
      id: -200,
      title: 'Новая группа',
      active: true,
      botAdmin: true,
    });
    expect(await s.repository.membersToRefresh(-200, s.now() - 1000, 25)).toContain(2);
    await s.groups.synchronize(-200);
    expect(
      (await s.puzzleRepository.leaderboard(s.player, 'all', 0, { groupId: -200 })).entries[0]
        ?.playerId,
    ).toBe(2);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -200, enabled: true });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
});

async function snakeResult(
  s: Awaited<ReturnType<typeof setup>>,
  id: string,
  playerId: number,
  score: number,
  size = 16,
) {
  const created = await s.snake.create(
    { id: playerId, name: `P${playerId}` },
    { requestId: `snake_fixture_${id}`, size },
  );
  const original = await s.snakeRepository.get(created.id);
  if (!original) throw new Error('Missing snake fixture');
  await s.snakeRepository.save(
    {
      ...original,
      revision: 1,
      status: 'verified',
      state: { ...original.state, score, status: 'over' },
      verifiedAt: s.now(),
    },
    0,
  );
  const stored = await s.snakeRepository.get(created.id);
  if (!stored) throw new Error('Missing snake result');
  return stored;
}
describe('Snake record announcements', () => {
  it.each(SNAKE_SIZES)('announces size %i once and links to the same field', async (size) => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const run = await snakeResult(s, 'first', 1, 100, size);
    await s.maintenance.snakeResult(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain(`Змейка · ${size}×${size} · 100 очков`);
    expect(s.sent[0]?.text).toContain('Первый рекорд группы');
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: '🎮 Побить рекорд',
      url: `https://t.me/arcade_bot?startapp=game_snake_${size}`,
    });
    expect(parseLaunch(`game_snake_${size}`)).toEqual({
      view: 'game',
      game: 'snake',
      snakeSize: size,
    });
    await s.maintenance.snakeResult(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(await s.snakeRepository.pendingResults(3)).toEqual([]);
  });
  it('recovers an actual server-verified replay without announcing an unfinished game', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const created = await s.snake.create(s.player, {
      requestId: 'snake_real_replay_12345',
      size: 12,
    });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    const state = structuredClone(created.state);
    const directions: SnakeDirection[] = [];
    while (state.status === 'playing') {
      directions.push('right');
      stepSnake(state);
    }
    s.advance(directions.length * SNAKE_STEP_MS);
    const input = { runId: created.id, revision: 0, directions };
    await s.snake.submit(s.player, input);
    const stored = await s.snakeRepository.get(created.id);
    expect(stored).toMatchObject({ verifiedAt: s.now(), verifiedOrder: 1, socialProcessed: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('10 очков');
    await s.snake.submit(s.player, input);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
  });
  it('compares only group members, announces an overtake and a leader improvement', async () => {
    const s = await setup();
    await snakeResult(s, 'rival', 2, 100);
    await snakeResult(s, 'outsider', 3, 1000);
    s.members.set(3, { active: false, admin: false });
    await s.repository.observeMember({
      chatId: -100,
      userId: 3,
      active: false,
      updatedAt: s.now(),
    });
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const run = await snakeResult(s, 'winner', 1, 200);
    await s.maintenance.snakeResult(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('Обошёл(ла) P2: больше на 100 очков');
    expect((await s.snake.leaderboard(s.player, { size: 16, period: 'all' })).me?.rank).toBe(2);
    s.advance(300001);
    await s.maintenance.snakeResult(await snakeResult(s, 'improved', 1, 300));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('Улучшен рекорд группы: больше на 100 очков');
  });
  it('ignores zero scores, same-place personal improvements, ties and results before enabling', async () => {
    const s = await setup();
    await snakeResult(s, 'leader', 2, 1000);
    await snakeResult(s, 'second', 1, 100);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    await s.maintenance.snakeResult(await snakeResult(s, 'personal', 1, 200));
    await s.maintenance.snakeResult(await snakeResult(s, 'tie', 2, 1000));
    await s.maintenance.snakeResult(await snakeResult(s, 'zero', 3, 0, 12));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('shares the cross-game cooldown and delivers a deferred record after five minutes', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.mineResult(await mineResult(s, 'before-snake', 1, 10000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    const run = await snakeResult(s, 'cooldown', 1, 100);
    await s.maintenance.snakeResult(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(
      await s.local.db.get('SELECT status,error FROM social_jobs WHERE id=:id', {
        ':id': `record:${run.id}:-100`,
      }),
    ).toEqual({ status: 'pending', error: 'Group cooldown' });
    s.advance(300001);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('Змейка');
  });
  it('orders snapshots by completion and suppresses superseded records before sending', async () => {
    const s = await setup();
    const early = await s.snake.create(s.player, { requestId: 'snake_early_12345678', size: 16 });
    await snakeResult(s, 'later-start', 2, 100);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const original = await s.snakeRepository.get(early.id);
    if (!original) throw new Error('Missing fixture');
    await s.snakeRepository.save(
      {
        ...original,
        revision: 1,
        status: 'verified',
        state: { ...original.state, score: 200, status: 'over' },
        verifiedAt: s.now(),
      },
      0,
    );
    const a = await s.snakeRepository.get(early.id);
    if (!a) throw new Error('Missing result');
    expect(a.verifiedOrder).toBe(2);
    const before = await s.snakeRepository.leaderboard(s.player, 16, 'all', 0, {
      groupId: -100,
      maxResultOrder: 1,
    });
    expect(before.me).toBeNull();
    expect(before.entries[0]?.playerId).toBe(2);
    await s.maintenance.snakeResult(a);
    await s.maintenance.snakeResult(await snakeResult(s, 'new-winner', 3, 300));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('P3');
  });
  it('retries Telegram errors and suppresses delivery after a player leaves or notifications are disabled', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.snakeResult(await snakeResult(s, 'retry', 1, 100));
    const send = s.telegram.send;
    s.telegram.send = vi
      .fn()
      .mockRejectedValueOnce({ code: 429, parameters: { retry_after: 2 } })
      .mockImplementation(send);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    s.advance(2100);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    s.advance(300001);
    await s.maintenance.snakeResult(await snakeResult(s, 'left', 1, 200));
    s.members.set(1, { active: false, admin: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    s.members.set(1, { active: true, admin: true });
    await s.maintenance.snakeResult(await snakeResult(s, 'off', 1, 300));
    await s.groups.configure(s.player, { groupId: -100, enabled: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
  });
  it('keeps pre-migration records processed and opts existing active games in at completion', async () => {
    const s = await setup();
    const created = await s.snake.create(s.player, {
      requestId: 'snake_migration_12345',
      size: 16,
    });
    await s.local.db.run(
      `INSERT INTO snake_runs (id,player_id,player_name,ruleset,size,revision,state_json,status,score,created_at,expires_at,last_submission)
      SELECT 'snake-legacy',2,'P2',ruleset,size,revision,state_json,'verified',0,created_at,expires_at,last_submission FROM snake_runs WHERE id=:id`,
      { ':id': created.id },
    );
    expect((await s.snakeRepository.get('snake-legacy'))?.socialProcessed).toBe(true);
    expect(await s.snakeRepository.pendingResults(3)).toEqual([]);
    await s.local.db.run('UPDATE snake_runs SET social_processed=1 WHERE id=:id', {
      ':id': created.id,
    });
    const state = structuredClone(created.state);
    const directions: SnakeDirection[] = [];
    while (state.status === 'playing') {
      directions.push('right');
      stepSnake(state);
    }
    s.advance(directions.length * SNAKE_STEP_MS);
    await s.snake.submit(s.player, { runId: created.id, revision: 0, directions });
    expect((await s.snakeRepository.get(created.id))?.socialProcessed).toBe(false);
    expect((await s.snakeRepository.pendingResults(3)).map((r) => r.id)).toEqual([created.id]);
  });
  it('discovers snake-only players in new groups without broadcasting old records', async () => {
    const s = await setup();
    await snakeResult(s, 'history', 2, 100);
    await s.repository.upsertGroup({
      id: -200,
      title: 'Новая группа',
      active: true,
      botAdmin: true,
    });
    expect(await s.repository.membersToRefresh(-200, s.now() - 1000, 25)).toContain(2);
    await s.groups.synchronize(-200);
    expect(
      (await s.snakeRepository.leaderboard(s.player, 16, 'all', 0, { groupId: -200 })).entries[0]
        ?.playerId,
    ).toBe(2);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -200, enabled: true });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('defers incomplete membership verification and excludes records below the group top ten', async () => {
    const s = await setup();
    for (let id = 2; id <= 12; id++) {
      s.members.set(id, { active: true, admin: false });
      await snakeResult(s, `rival-${id}`, id, id * 10);
    }
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    await s.maintenance.snakeResult(await snakeResult(s, 'outside-top', 1, 10));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    const winner = await snakeResult(s, 'after-outage', 1, 500);
    s.advance(16 * 60000);
    const member = s.telegram.member;
    s.telegram.member = async (chat, id) => {
      if (id === 2) throw new Error('Telegram outage');
      return member(chat, id);
    };
    await expect(s.maintenance.snakeResult(winner)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await s.snakeRepository.get(winner.id))?.socialProcessed).toBe(false);
    s.telegram.member = member;
    for (let i = 0; i < 5; i++) await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
  });
});

describe('Minesweeper record announcements', () => {
  it.each(SIZES)('announces %s once and opens the matching difficulty', async (size) => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    const run = await mineResult(s, 'first', 1, 30000, size);
    expect((await s.mineRepository.pendingResults(3)).map((r) => r.id)).toEqual([run.id]);
    await s.maintenance.mineResult(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain(`Сапёр · ${size.replace('x', '×')}`);
    expect(s.sent[0]?.text).toContain('30,000 с');
    expect(s.sent[0]?.text).toContain('Первый рекорд группы');
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: '🎮 Побить рекорд',
      url: `https://t.me/arcade_bot?startapp=game_minesweeper_${size}`,
    });
    await s.maintenance.mineResult(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(await s.mineRepository.pendingResults(3)).toEqual([]);
    expect((await s.mineRepository.getStored(run.id))?.socialProcessed).toBe(true);
  });
  it('compares group times, ignores outsiders and announces a leader improving their record', async () => {
    const s = await setup();
    await mineResult(s, 'rival', 2, 45000);
    await mineResult(s, 'outsider', 3, 1000);
    s.members.set(3, { active: false, admin: false });
    await s.repository.observeMember({
      chatId: -100,
      userId: 3,
      active: false,
      updatedAt: s.now(),
    });
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.maintenance.mineResult(await mineResult(s, 'overtake', 1, 30000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('быстрее на 15,000 с');
    expect(s.sent[0]?.text).toContain('P2');
    expect(
      (await s.minesweeper.leaderboard(s.player, { size: '9x9', period: 'all' })).me?.rank,
    ).toBe(2);
    s.advance(300001);
    await s.maintenance.mineResult(await mineResult(s, 'improved', 1, 25000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]?.text).toContain('Улучшен рекорд группы');
    expect(s.sent[1]?.text).toContain('быстрее на 5,000 с');
  });
  it('does not announce personal improvements at the same non-leading rank', async () => {
    const s = await setup();
    await mineResult(s, 'leader', 2, 10000);
    await mineResult(s, 'second', 1, 50000);
    s.advance(1);
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.maintenance.mineResult(await mineResult(s, 'same-rank', 1, 30000));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('keeps chronological rank snapshots and suppresses superseded records', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await mineResult(s, 'rival', 2, 50000);
    const a = await mineResult(s, 'a', 1, 40000);
    const b = await mineResult(s, 'b', 3, 30000);
    const before = await s.mineRepository.leaderboard(s.player, '9x9', 'all', 0, {
      groupId: -100,
      maxResultOrder: a.order - 1,
    });
    const after = await s.mineRepository.leaderboard(s.player, '9x9', 'all', 0, {
      groupId: -100,
      maxResultOrder: a.order,
    });
    expect(before.me).toBeNull();
    expect(after.me?.rank).toBe(1);
    expect(after.entries.some((entry) => entry.playerId === 3)).toBe(false);
    await s.maintenance.mineResult(a);
    await s.maintenance.mineResult(b);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('P3');
    expect(s.sent[0]?.text).toContain('быстрее на 10,000 с');
  });
  it('recovers an unprocessed result after restart and retries Telegram rate limits', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await mineResult(s, 'pending', 1, 30000);
    const restarted = new MaintenanceService(
      s.repository,
      s.local.repository,
      s.groups,
      s.telegram,
      s.now,
      s.mineRepository,
    );
    const send = s.telegram.send;
    let attempts = 0;
    s.telegram.send = async (message) => {
      attempts++;
      if (attempts === 1)
        throw Object.assign(new Error('Rate limited'), {
          code: 429,
          parameters: { retry_after: 3 },
        });
      return send(message);
    };
    await restarted.sweep();
    expect(s.sent).toHaveLength(0);
    s.advance(3001);
    await restarted.sweep();
    expect(s.sent).toHaveLength(1);
  });
  it('leaves existing results without notification metadata silent', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    const run = await mineResult(s, 'legacy', 1, 30000);
    s.local.database
      .prepare(
        "UPDATE minesweeper_runs SET state_json=json_remove(state_json,'$.socialProcessed') WHERE id=?",
      )
      .run(run.id);
    expect((await s.mineRepository.getStored(run.id))?.socialProcessed).toBe(true);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('suppresses delivery after leaving the group or switching notifications off', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.maintenance.mineResult(await mineResult(s, 'queued', 1, 30000));
    s.members.set(1, { active: false, admin: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
    s.members.set(1, { active: true, admin: true });
    s.advance(1);
    await s.maintenance.mineResult(await mineResult(s, 'another', 1, 20000));
    await s.groups.configure(s.player, { groupId: -100, enabled: false });
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
});

describe('record announcement recovery', () => {
  it('announces a new Tetris record even if its start snapshot was empty', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.maintenance.result(await s.verified('empty-snapshot', 1, 200, []));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('Тетрис');
  });
  it('keeps processing other results when one record is temporarily unavailable', async () => {
    const s = await setup();
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    s.advance(1);
    await s.verified('unavailable', 1, 200, []);
    await mineResult(s, 'available', 2, 30000);
    const access = s.groups.access.bind(s.groups);
    vi.spyOn(s.groups, 'access').mockImplementation(async (player, id, admin) => {
      if (player.id === 1) throw new AppError('UNAVAILABLE', 'Temporary membership failure');
      return access(player, id, admin);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await s.maintenance.sweep()).deferred).toBe(1);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.text).toContain('Сапёр');
    expect((await s.local.repository.get('unavailable'))?.socialProcessed).toBe(false);
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
  it('opens 2048 directly and registers its game command', async () => {
    const s = await setup();
    await s.bot.message({ ...payload, text: '/game_2048@arcade_bot' });
    expect(s.sent[0]?.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: 'Играть',
      url: 'https://t.me/arcade_bot?startapp=game_2048',
    });
    await s.bot.configure();
    expect(s.commands[0]?.commands.some((c) => c.command === 'game_2048')).toBe(true);
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

describe('notification topics', () => {
  const payload = {
    text: '/game_notify_here@arcade_bot',
    chat: { id: -100, type: 'supergroup', title: 'Группа А' },
    from: { id: 1, first_name: 'P1' },
    is_topic_message: true,
    message_thread_id: 42,
    ephemeral_message_id: 7,
  };
  it('registers the command and saves the current topic with notifications enabled', async () => {
    const s = await setup();
    await s.bot.message(payload);
    // Read through a new repository instance to verify the destination is persisted in SQL.
    const reloaded = new SqlSocialRepository(s.local.db, s.local.repository);
    expect(await reloaded.group(-100)).toMatchObject({
      notificationsEnabled: true,
      notificationThreadId: 42,
      enabledAt: s.now(),
    });
    expect(s.sent[0]).toMatchObject({
      chat_id: -100,
      message_thread_id: 42,
      ephemeral_message_parameters: { receiver_user_id: 1 },
      reply_parameters: { ephemeral_message_id: 7 },
    });
    expect(s.sent[0]?.text).toContain('в этой теме');
    await s.bot.configure();
    expect(s.commands[0]?.commands).toContainEqual({
      command: 'game_notify_here',
      description: 'Слать рекорды в эту тему (админ)',
      is_ephemeral: true,
    });
  });
  it('rejects changes by a non-admin and ignores commands addressed to another bot', async () => {
    const s = await setup();
    await s.bot.message({ ...payload, from: { id: 2, first_name: 'P2' } });
    expect(s.sent[0]?.text).toContain('только администратор');
    expect(await s.repository.group(-100)).toMatchObject({
      notificationsEnabled: false,
      notificationThreadId: null,
    });
    await s.bot.message({ ...payload, text: '/game_notify_here@other_bot' });
    expect(s.sent).toHaveLength(1);
  });
  it('does not configure destinations in private chats or for departed members', async () => {
    const s = await setup();
    await s.bot.message({ ...payload, chat: { id: 1, type: 'private', title: 'P1' } });
    expect(s.sent[0]?.text).toContain('доступна в группе');
    expect(s.sent[0]?.message_thread_id).toBeUndefined();
    s.members.set(1, { active: false, admin: false });
    await s.bot.message(payload);
    expect(s.sent[1]?.text).toContain('больше не состоишь');
    expect((await s.repository.group(-100))?.notificationThreadId).toBeNull();
  });
  it.each([undefined, null, 0, -1, 1.5, '42', Number.MAX_SAFE_INTEGER + 1])(
    'rejects a malformed topic id %s without changing settings',
    async (message_thread_id) => {
      const s = await setup();
      await expect(s.bot.message({ ...payload, message_thread_id })).rejects.toMatchObject({
        code: 'BAD_INPUT',
      });
      expect(await s.repository.group(-100)).toMatchObject({
        notificationsEnabled: false,
        notificationThreadId: null,
      });
      expect(s.sent).toHaveLength(0);
    },
  );
  it('validates destination settings received through the group service', async () => {
    const s = await setup();
    await expect(
      s.groups.configure(s.player, {
        groupId: -100,
        enabled: true,
        notificationThreadId: '42',
      }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await s.repository.group(-100))?.notificationsEnabled).toBe(false);
  });
  it('preserves the topic through off/on, UI settings and bot membership refreshes', async () => {
    const s = await setup();
    await s.bot.message(payload);
    s.advance(1000);
    await s.bot.message({ ...payload, text: '/game_notify_off', message_thread_id: 99 });
    expect(await s.repository.group(-100)).toMatchObject({
      notificationsEnabled: false,
      notificationThreadId: 42,
    });
    await s.bot.message({ ...payload, text: '/game_notify_on', message_thread_id: 99 });
    await s.groups.configure(s.player, { groupId: -100, enabled: false });
    await s.groups.configure(s.player, { groupId: -100, enabled: true });
    const enabledAt = (await s.repository.group(-100))?.enabledAt;
    await s.bot.botMembership({
      chat: payload.chat,
      new_chat_member: { status: 'administrator' },
    });
    s.advance(1000);
    await s.bot.message({ ...payload, message_thread_id: 77 });
    expect(await s.repository.group(-100)).toMatchObject({
      notificationsEnabled: true,
      notificationThreadId: 77,
      enabledAt,
    });
  });
  it('can return to the general chat without mistaking an ordinary reply thread for a topic', async () => {
    const s = await setup();
    await s.bot.message(payload);
    await s.bot.message({ ...payload, is_topic_message: false, message_thread_id: 123 });
    expect((await s.repository.group(-100))?.notificationThreadId).toBeNull();
    expect(s.sent[1]?.message_thread_id).toBeUndefined();
    expect(s.sent[1]?.text).toContain('в общем чате');
    s.sent.length = 0;
    s.advance(1);
    await s.maintenance.result(await s.verified('general', 1, 100));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.message_thread_id).toBeUndefined();
  });
  it('routes queued records to the latest topic and keeps the shared cooldown and deduplication', async () => {
    const s = await setup();
    await s.bot.message(payload);
    s.advance(1);
    const run = await s.verified('topic-record', 1, 100);
    await s.maintenance.result(run);
    await s.bot.message({ ...payload, message_thread_id: 77 });
    s.sent.length = 0;
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ chat_id: -100, message_thread_id: 77 });
    expect(s.sent[0]?.ephemeral_message_parameters).toBeUndefined();
    await s.maintenance.result(run);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    await s.bot.message(payload);
    s.sent.length = 0;
    await s.maintenance.result(await s.verified('next-topic-record', 1, 200));
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(0);
  });
  it('uses the current topic on a 429 retry without falling back when a topic is unavailable', async () => {
    const s = await setup();
    await s.bot.message(payload);
    s.sent.length = 0;
    s.advance(1);
    await s.maintenance.result(await s.verified('retry-topic', 1, 100));
    const send = vi.spyOn(s.telegram, 'send');
    send.mockRejectedValueOnce(
      Object.assign(new Error('Rate limited'), { code: 429, parameters: { retry_after: 3 } }),
    );
    await s.maintenance.sweep();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].message_thread_id).toBe(42);
    await s.bot.message({ ...payload, message_thread_id: 77 });
    s.sent.length = 0;
    send.mockClear();
    send.mockRejectedValueOnce(Object.assign(new Error('Topic closed'), { code: 400 }));
    s.advance(4001);
    await s.maintenance.sweep();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].message_thread_id).toBe(77);
    expect(s.sent).toHaveLength(0);
    s.advance(8001);
    await s.maintenance.sweep();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]?.message_thread_id).toBe(77);
  });
  it('does not share destinations between groups', async () => {
    const s = await setup();
    await s.bot.message(payload);
    await s.repository.upsertGroup({ id: -200, title: 'B', active: true, botAdmin: true });
    expect((await s.repository.group(-200))?.notificationThreadId).toBeNull();
    await s.bot.message({ ...payload, chat: { ...payload.chat, id: -200 }, message_thread_id: 99 });
    expect((await s.repository.group(-100))?.notificationThreadId).toBe(42);
    expect((await s.repository.group(-200))?.notificationThreadId).toBe(99);
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
