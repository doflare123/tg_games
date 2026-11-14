import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { blockPlacements, moveBlockBlast } from '../src/games/block-blast/engine.ts';
import {
  applyPetAction,
  newPet,
  petBalance,
  petCostProgress,
  refreshPet,
} from '../src/games/tamagotchi/engine.ts';
import { BlockService } from '../src/server/domain/block-blast.ts';
import { GroupService } from '../src/server/domain/groups.ts';
import { MaintenanceService } from '../src/server/domain/maintenance.ts';
import { TamagotchiService } from '../src/server/domain/tamagotchi.ts';
import type { SendMessage, TelegramGateway } from '../src/server/domain/telegram.ts';
import { SqlBlockRepository } from '../src/server/platform/sql-block-blast.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';
import { SqlPetRepository } from '../src/server/platform/sql-tamagotchi.ts';
import { parseLaunch } from '../src/shared/launch.ts';
import {
  decodePetMutation,
  decodePetState,
  decodePetView,
  emptyPetWallet,
  encodePetView,
  PET_DAY,
  PET_GAME_INFO,
  PET_GAMES,
  PET_SPECIES,
  type PetAction,
  type PetGame,
  type PetView,
  petDay,
  petLevel,
} from '../src/shared/tamagotchi.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
it('sends a Telegram-safe response without numeric object keys at any depth', async () => {
  const s = await setup();
  const view = await s.service.get(s.player);
  const wire = encodePetView(view);
  const checkBridge = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      for (const key of Object.keys(value))
        if (/^(0|[1-9][0-9]*)$/.test(key))
          throw new Error('Cannot convert: v8::Object key is not a string');
    }
    for (const entry of Object.values(value)) checkBridge(entry);
  };
  expect(() => checkBridge(view)).toThrow('v8::Object key');
  expect(() => checkBridge(wire)).not.toThrow();
  expect(wire.wallet.find((entry) => entry.game === '2048')).toEqual({
    game: '2048',
    sparks: 0,
    attempts: 0,
  });
  expect(decodePetView(JSON.parse(JSON.stringify(wire)))).toEqual(view);
  expect(() =>
    decodePetView({ ...wire, wallet: [wire.wallet[0], ...wire.wallet.slice(0, 4)] }),
  ).toThrow();
});
it('migrates saved pets without a species and validates the new choice', () => {
  const {
    species: _species,
    speciesChosen: _chosen,
    ...legacy
  } = newPet(1, Date.UTC(2026, 10, 14, 12));
  const decoded = decodePetState(legacy);
  expect(decoded.species).toBe('cat');
  expect(decoded.speciesChosen).toBe(false);
  expect(() => decodePetState({ ...legacy, species: 'dragon' })).toThrow();
  expect(() => decodePetState({ ...legacy, speciesChosen: 'true' })).toThrow();
  expect(() =>
    decodePetMutation({
      requestId: 'valid_request_123',
      revision: 0,
      action: { type: 'species', species: '<script>' },
    }),
  ).toThrow();
});
it.each(PET_SPECIES)(
  'persists the first %s choice and rejects any later animal change',
  async (species) => {
    const s = await setup();
    let view = await s.service.get(s.player);
    await s.activity('block-blast', 1000);
    view = await s.service.get(s.player);
    const before = view.state;
    const requestId = 'first_animal_choice_request';
    view = await s.act(view, { type: 'species', species }, requestId);
    const restored = await s.service.get(s.player);
    expect(restored.state.species).toBe(species);
    expect(restored.state.speciesChosen).toBe(true);
    expect(restored.state.xp).toBe(before.xp);
    expect(restored.state.spent).toEqual(before.spent);
    expect(restored.state.owned).toEqual(before.owned);
    expect(restored.state.needs).toEqual(before.needs);
    expect(restored.wallet['block-blast'].sparks).toBe(2);
    for (const other of PET_SPECIES) {
      await expect(s.act(view, { type: 'species', species: other })).rejects.toThrow(
        'Питомец уже выбран',
      );
    }
    expect(await s.act({ ...view, revision: 0 }, { type: 'species', species }, requestId)).toEqual(
      view,
    );
    expect((await s.service.get(s.player)).state.species).toBe(species);
  },
);
async function setup() {
  const local = localRepository();
  handles.push(local);
  await local.db.run(
    'CREATE TABLE ranking_blocks(player_id INTEGER PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL)',
  );
  let now = Date.UTC(2026, 10, 14, 12);
  let serial = 0;
  let deliveryFails = false;
  const members = new Set([1, 2]);
  const sent: SendMessage[] = [];
  const telegram: TelegramGateway = {
    async me() {
      return { id: 99, username: 'arcade_bot', hasMainMiniApp: true };
    },
    async member(_group, user) {
      return { active: members.has(user), admin: user === 1 };
    },
    async send(message) {
      if (deliveryFails) throw new Error('Temporary Telegram outage');
      sent.push(message);
      return { messageId: 1, ephemeralId: null, date: Math.floor(now / 1000) };
    },
    async edit() {},
    async commands() {},
    async sendMedia() {
      return { messageId: 1, ephemeralId: null, date: Math.floor(now / 1000) };
    },
  };
  const social = new SqlSocialRepository(local.db, local.repository);
  const groups = new GroupService(social, telegram, () => now);
  const repository = new SqlPetRepository(local.db);
  const service = new TamagotchiService(repository, () => now, groups);
  const maintenance = new MaintenanceService(
    social,
    local.repository,
    groups,
    telegram,
    () => now,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    repository,
  );
  const player = { id: 1, name: 'Игрок' };
  async function activity(
    game: PetGame,
    score = 1000,
    options: {
      player?: number;
      status?: string;
      progress?: number;
      createdAt?: number;
      ruleset?: string;
    } = {},
  ) {
    const id = `fixture:${++serial}`;
    const table = {
      'block-blast': 'block_blast_runs',
      tetris: 'runs',
      '2048': 'puzzle2048_runs',
      snake: 'snake_runs',
      flappy: 'flappy_runs',
    }[game];
    const ruleset =
      options.ruleset ??
      {
        'block-blast': 'block-blast-v1',
        tetris: 'tetris-arcade-v1',
        '2048': '2048-v2',
        snake: 'snake-v1',
        flappy: 'flappy-v1',
      }[game];
    const state = JSON.stringify({
      moves: options.progress ?? 100,
      ticks: options.progress ?? 1000,
    });
    const extra =
      game === 'tetris'
        ? ',mode,ticks,lines'
        : game === 'snake'
          ? ',size'
          : game === '2048'
            ? ',max_tile'
            : '';
    const values =
      game === 'tetris'
        ? ",'marathon',1000,1"
        : game === 'snake'
          ? ',16'
          : game === '2048'
            ? ',128'
            : '';
    await local.db.run(
      `INSERT INTO ${table}(id,player_id,player_name,ruleset,revision,state_json,status,score,created_at,expires_at,verified_at,verified_order,social_processed${extra})
      VALUES(:id,:player,'Fixture',:ruleset,1,:state,:status,:score,:created,:expires,:now,1,1${values})`,
      {
        ':id': id,
        ':player': options.player ?? 1,
        ':ruleset': ruleset,
        ':state': state,
        ':status': options.status ?? 'verified',
        ':score': score,
        ':created': options.createdAt ?? now,
        ':expires': now + PET_DAY,
        ':now': now,
      },
    );
    return id;
  }
  const act = (
    view: PetView,
    action: PetAction,
    requestId = `request_${String(++serial).padStart(16, '0')}`,
  ) => service.act(player, { requestId, revision: view.revision, action });
  return {
    ...local,
    social,
    groups,
    repository,
    service,
    maintenance,
    player,
    activity,
    act,
    sent,
    members,
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
    failDelivery(value: boolean) {
      deliveryFails = value;
    },
  };
}

it('creates a persistent personal pet and validates actions and navigation', async () => {
  const s = await setup();
  const first = await s.service.get(s.player);
  expect(await s.service.get(s.player)).toEqual(first);
  expect(first.state.wishes).toHaveLength(3);
  expect((await s.service.get({ id: 2, name: 'Другой' })).state.wishes).not.toEqual(
    first.state.wishes,
  );
  expect(() =>
    decodePetMutation({
      requestId: 'valid_request_123',
      revision: 0,
      action: { type: 'place', item: 'bed', room: 'living', x: -1, y: 0 },
    }),
  ).toThrow();
  expect(() =>
    decodePetMutation({
      requestId: 'valid_request_123',
      revision: 0,
      action: { type: 'rename', name: '\n' },
    }),
  ).toThrow();
  expect(parseLaunch('pet')).toEqual({ view: 'pet' });
  expect(parseLaunch('game_tamagotchi')).toEqual({ view: 'pet' });
});
it('earns only from eligible verified games after adoption, with separate balances and caps', async () => {
  const s = await setup();
  await s.service.get(s.player);
  for (const game of PET_GAMES) await s.activity(game, 1000);
  await s.activity('block-blast', 9000, { status: 'active' });
  await s.activity('block-blast', 9000, { status: 'unranked' });
  await s.activity('block-blast', 9000, { player: 2 });
  await s.activity('block-blast', 9000, { createdAt: s.now() - 1 });
  await s.activity('block-blast', 9000, { progress: 0 });
  await s.activity('block-blast', 9000, { ruleset: 'unknown' });
  let view = await s.service.get(s.player);
  expect(view.wallet['block-blast']).toEqual({ sparks: 2, attempts: 1 });
  expect(view.wallet.tetris).toEqual({ sparks: 0, attempts: 1 });
  expect(view.wallet['2048']).toEqual({ sparks: 0, attempts: 1 });
  expect(view.wallet.snake).toEqual({ sparks: 5, attempts: 1 });
  expect(view.wallet.flappy).toEqual({ sparks: 66, attempts: 1 });
  for (let i = 0; i < 8; i++) await s.activity('block-blast', 10000);
  view = await s.service.get(s.player);
  expect(view.wallet['block-blast']).toEqual({ sparks: 100, attempts: 5 });
  expect((await s.service.get(s.player)).wallet).toEqual(view.wallet);
  await s.db.run("INSERT INTO ranking_blocks VALUES(1,'moderation',1)");
  expect((await s.service.get(s.player)).wallet).toEqual(emptyPetWallet());
});
it.each([
  ['flappy', 15],
  ['snake', 200],
  ['tetris', 3000],
  ['block-blast', 500],
  ['2048', 3000],
] as const)(
  'converts %s scores at %i points per spark and keeps partial progress across runs',
  async (game, rate) => {
    const s = await setup();
    await s.service.get(s.player);
    expect(PET_GAME_INFO[game].unit).toBe(rate);
    await s.activity(game, rate - 1);
    expect((await s.service.get(s.player)).wallet[game]).toEqual({ sparks: 0, attempts: 1 });
    await s.activity(game, 1);
    expect((await s.service.get(s.player)).wallet[game]).toEqual({ sparks: 1, attempts: 2 });
    await s.activity(game, rate * 2);
    expect((await s.service.get(s.player)).wallet[game]).toEqual({ sparks: 3, attempts: 3 });
  },
);
it('counts a scoreless verified loss as an attempt but ignores instant empty starts', async () => {
  const s = await setup();
  await s.service.get(s.player);
  await s.activity('flappy', 0, { progress: 120 });
  await s.activity('flappy', 0, { progress: 119 });
  expect((await s.service.get(s.player)).wallet.flappy).toEqual({ sparks: 0, attempts: 1 });
});
it('credits a real server-replayed Block Blast finish without accepting client scores', async () => {
  const s = await setup();
  await s.service.get(s.player);
  const block = new BlockService(new SqlBlockRepository(s.db), { now: s.now, seed: () => 123 });
  const run = await block.create(s.player, { requestId: 'block_pet_fixture_123' });
  const moves = [];
  for (let i = 0; i < 6; i++) {
    let found = false;
    for (let slot = 0; slot < 3; slot++) {
      const shape = run.state.tray[slot];
      if (shape == null) continue;
      const placement = blockPlacements(run.state.board, shape)[0];
      if (!placement) continue;
      const move = { slot, ...placement };
      moves.push(move);
      expect(moveBlockBlast(run.state, move)).toBe(true);
      found = true;
      break;
    }
    if (!found) break;
  }
  const input = { runId: run.id, revision: 0, moves, finish: true, score: 999999 };
  const verified = await block.submit(s.player, input);
  expect(verified.status).toBe('verified');
  const before = await s.service.get(s.player);
  expect(before.wallet['block-blast']).toEqual({
    sparks: Math.floor(verified.state.score / 500),
    attempts: 1,
  });
  await block.submit(s.player, input);
  expect((await s.service.get(s.player)).wallet).toEqual(before.wallet);
});
it('atomically spends balances, deduplicates retries and rejects concurrent double spending', async () => {
  const s = await setup();
  let view = await s.service.get(s.player);
  await s.activity('block-blast', 5000);
  view = await s.service.get(s.player);
  const request = {
    requestId: 'one_purchase_request',
    revision: view.revision,
    action: { type: 'buy', item: 'banana' },
  };
  const purchased = await s.service.act(s.player, request);
  expect(purchased.wallet['block-blast'].sparks).toBe(0);
  expect(purchased.state.xp).toBe(0);
  expect(await s.service.act(s.player, request)).toEqual(purchased);
  await expect(
    s.service.act(s.player, { ...request, action: { type: 'buy', item: 'toast' } }),
  ).rejects.toThrow('Ключ');
  await s.activity('block-blast', 5000);
  view = await s.service.get(s.player);
  const results = await Promise.allSettled([
    s.act(view, { type: 'buy', item: 'banana' }),
    s.act(view, { type: 'buy', item: 'banana' }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await s.service.get(s.player)).wallet['block-blast'].sparks).toBe(0);
  const renamed = await s.act(await s.service.get(s.player), { type: 'rename', name: 'Листик' });
  expect((await s.service.act(s.player, request)).state.name).toBe(renamed.state.name);
});
it('enforces pool diversity and spends only the selected metric and pool', () => {
  const state = newPet(1, Date.UTC(2026, 10, 14, 12));
  const earned = emptyPetWallet();
  earned['block-blast'] = { sparks: 25, attempts: 5 };
  earned.snake.attempts = 5;
  expect(() =>
    applyPetAction(state, { type: 'buy', item: 'wardrobe' }, earned, state.bornAt),
  ).toThrow();
  earned.tetris.sparks = 1;
  const next = applyPetAction(state, { type: 'buy', item: 'wardrobe' }, earned, state.bornAt);
  expect(next.owned).toEqual(['wardrobe']);
  expect(next.spent.tetris.sparks).toBe(1);
  expect(next.spent['block-blast'].sparks).toBe(19);
  expect(petBalance(earned, next.spent).snake.attempts).toBe(5);
  expect(state.owned).toEqual([]);
  expect(
    petCostProgress(
      { metric: 'attempts', games: ['block-blast', 'tetris'], amount: 3, distinct: 2 },
      earned,
    ).ready,
  ).toBe(false);
});
it('lets failed attempts buy food and furniture without granting ranking points', () => {
  const state = newPet(1, Date.UTC(2026, 10, 14, 12));
  const earned = emptyPetWallet();
  earned.tetris.attempts = 4;
  earned.flappy.attempts = 4;
  const fed = applyPetAction(state, { type: 'buy', item: 'toast' }, earned, state.bornAt);
  const furnished = applyPetAction(fed, { type: 'buy', item: 'rug' }, earned, state.bornAt);
  expect(furnished.owned).toContain('rug');
  expect(furnished.xp).toBe(0);
  expect(furnished.needs.food).toBe(100);
});
it('claims personalized wishes once, unlocks rooms, persists daily goals and preserves progress after absence', async () => {
  const s = await setup();
  let view = await s.service.get(s.player);
  for (const game of PET_GAMES) for (let i = 0; i < 5; i++) await s.activity(game, 10000);
  view = await s.service.get(s.player);
  for (const wish of view.state.wishes)
    view = await s.act(view, { type: 'claim', wishId: wish.id });
  expect(view.state.xp).toBe(180);
  expect(petLevel(view.state.xp)).toBe(2);
  expect(view.state.streak).toBe(1);
  await expect(
    s.act(view, { type: 'claim', wishId: view.state.wishes[0]?.id ?? '' }),
  ).rejects.toThrow('уже');
  const oldWish = view.state.wishes[0]?.id ?? '';
  s.advance(PET_DAY);
  view = await s.service.get(s.player);
  expect(view.state.completed).toEqual([]);
  expect(view.state.wishes[0]?.id).not.toBe(oldWish);
  const wishes = view.state.wishes;
  for (const game of PET_GAMES) for (let i = 0; i < 5; i++) await s.activity(game, 10000);
  expect((await s.service.get(s.player)).state.wishes).toEqual(wishes);
  for (const wish of view.state.wishes)
    view = await s.act(view, { type: 'claim', wishId: wish.id });
  expect(view.state.streak).toBe(2);
  s.advance(30 * PET_DAY);
  view = await s.service.get(s.player);
  expect(view.state.xp).toBe(360);
  expect(Math.min(...Object.values(view.state.needs))).toBe(20);
  expect(view.state.owned.length).toBeGreaterThan(0);
});
it('validates furniture ownership, room unlocks, occupied cells and storage', () => {
  let state = newPet(1, Date.UTC(2026, 10, 14, 12));
  const earned = emptyPetWallet();
  state.owned = ['rug', 'wardrobe'];
  expect(() =>
    applyPetAction(
      state,
      { type: 'place', item: 'bed', room: 'living', x: 0, y: 0 },
      earned,
      state.bornAt,
    ),
  ).toThrow('Сначала');
  expect(() =>
    applyPetAction(
      state,
      { type: 'place', item: 'rug', room: 'bedroom', x: 0, y: 0 },
      earned,
      state.bornAt,
    ),
  ).toThrow('закрыта');
  state = applyPetAction(
    state,
    { type: 'place', item: 'rug', room: 'living', x: 0, y: 0 },
    earned,
    state.bornAt,
  );
  expect(() =>
    applyPetAction(
      state,
      { type: 'place', item: 'wardrobe', room: 'living', x: 0, y: 0 },
      earned,
      state.bornAt,
    ),
  ).toThrow('занято');
  state.xp = 180;
  state = applyPetAction(
    state,
    { type: 'place', item: 'rug', room: 'bedroom', x: 4, y: 2 },
    earned,
    state.bornAt,
  );
  expect(state.placements).toHaveLength(1);
  state = applyPetAction(state, { type: 'store', item: 'rug' }, earned, state.bornAt);
  expect(state.placements).toHaveLength(0);
  expect(state.owned).toContain('rug');
});
it('uses server time for day rollover, bounded need decay and free care cooldowns', () => {
  const now = Date.UTC(2026, 10, 14, 2);
  expect(petDay(now - 1)).toBe(petDay(now) - 1);
  const initial = newPet(1, now);
  const absent = refreshPet(initial, 1, emptyPetWallet(), now + 100 * PET_DAY);
  expect(absent.needs).toEqual({ food: 20, joy: 20, energy: 20, clean: 20 });
  const cared = applyPetAction(
    absent,
    { type: 'care', care: 'wash' },
    emptyPetWallet(),
    now + 100 * PET_DAY,
  );
  expect(cared.needs.clean).toBe(45);
  expect(cared.xp).toBe(0);
  expect(() =>
    applyPetAction(
      cared,
      { type: 'care', care: 'pet' },
      emptyPetWallet(),
      now + 100 * PET_DAY + 100,
    ),
  ).toThrow('15');
});
it('keeps identities isolated and ranks only server-earned care, respecting membership and moderation', async () => {
  const s = await setup();
  let view = await s.service.get(s.player);
  for (const game of PET_GAMES) for (let i = 0; i < 5; i++) await s.activity(game, 10000);
  view = await s.service.get(s.player);
  view = await s.act(view, { type: 'claim', wishId: view.state.wishes[0]?.id ?? '' });
  expect((await s.service.get({ id: 2, name: 'Other' })).state.xp).toBe(0);
  expect((await s.service.leaderboard(s.player, { period: 'all' })).me?.score).toBe(45);
  await s.social.upsertGroup({ id: -42, title: 'Group', active: true, botAdmin: true });
  expect((await s.service.leaderboard(s.player, { period: 'all', groupId: -42 })).me?.score).toBe(
    45,
  );
  s.members.delete(1);
  await expect(s.service.leaderboard(s.player, { period: 'all', groupId: -42 })).rejects.toThrow();
  await s.db.run("INSERT INTO ranking_blocks VALUES(1,'blocked',1)");
  expect((await s.service.leaderboard(s.player, { period: 'all' })).entries).toEqual([]);
});
it('does not create notifications for pet wishes, including groups with announcements enabled', async () => {
  const s = await setup();
  let view = await s.service.get(s.player);
  await s.social.upsertGroup({ id: -42, title: 'Group', active: true, botAdmin: true });
  await s.groups.configure(s.player, { groupId: -42, enabled: true, notificationThreadId: 77 });
  for (const game of PET_GAMES) {
    await s.activity(game, 10000);
    await s.activity(game, 10000);
  }
  view = await s.service.get(s.player);
  view = await s.act(view, { type: 'claim', wishId: view.state.wishes[0]?.id ?? '' });
  await s.maintenance.sweep(2);
  expect(s.sent).toHaveLength(0);
  view = await s.act(view, { type: 'claim', wishId: view.state.wishes[1]?.id ?? '' });
  await s.maintenance.sweep(2);
  expect(s.sent).toHaveLength(0);
  expect(await s.db.get('SELECT COUNT(*) AS total FROM social_jobs')).toEqual({ total: 0 });
  expect(await s.repository.pendingResults(10)).toEqual([]);
  expect((await s.service.leaderboard(s.player, { period: 'all' })).me?.score).toBe(120);
});
it('drains old pet events and suppresses previously queued or retried notifications before delivery', async () => {
  const s = await setup();
  let view = await s.service.get(s.player);
  await s.social.upsertGroup({ id: -42, title: 'Group', active: true, botAdmin: true });
  await s.groups.configure(s.player, { groupId: -42, enabled: true });
  for (const game of PET_GAMES) for (let i = 0; i < 5; i++) await s.activity(game, 10000);
  view = await s.service.get(s.player);
  view = await s.act(view, { type: 'claim', wishId: view.state.wishes[0]?.id ?? '' });
  await s.db.run(
    'UPDATE pet_events SET social_processed=0 WHERE player_id=1 AND revision=:revision',
    { ':revision': view.revision },
  );
  const event = (await s.repository.pendingResults(1))[0];
  if (!event) throw new Error('Missing fixture');
  await s.maintenance.petResult(event);
  await s.maintenance.petResult(event);
  expect(await s.db.get('SELECT COUNT(*) AS total FROM social_jobs')).toEqual({ total: 0 });
  expect(await s.repository.pendingResults(1)).toEqual([]);
  for (const id of ['old-pet-pending', 'old-pet-retry']) {
    await s.social.enqueue({
      id,
      payload: {
        type: 'record',
        game: 'tamagotchi',
        chatId: -42,
        playerId: 1,
        mode: 'care',
        runId: event.id,
        rank: 1,
        text: 'Old pet record',
      },
      dueAt: s.now(),
      expiresAt: s.now() + PET_DAY,
      attempts: 0,
    });
  }
  await s.db.run(
    "UPDATE social_jobs SET status='running',lease_until=0,attempts=2 WHERE id='old-pet-retry'",
  );
  await s.maintenance.sweep(2);
  expect(s.sent).toHaveLength(0);
  expect(await s.db.all('SELECT status,error FROM social_jobs ORDER BY id')).toEqual([
    { status: 'suppressed', error: 'Pet notifications disabled' },
    { status: 'suppressed', error: 'Pet notifications disabled' },
  ]);
  expect((await s.social.group(-42))?.nextNotificationAt).toBe(0);
});
