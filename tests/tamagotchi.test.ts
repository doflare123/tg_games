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
it('upgrades starter layout without moving existing owned furniture or respawning stored starters', () => {
  const { starterPlacements: _old, ...legacy } = newPet(1, Date.UTC(2026, 10, 15, 12));
  legacy.owned = ['rug'];
  legacy.placements = [{ item: 'rug', room: 'living', x: 4, y: 2 }];
  const state = decodePetState(legacy);
  expect(state.placements).toEqual(legacy.placements);
  expect(state.starterPlacements).toHaveLength(8);
  expect(state.starterPlacements.filter((p) => !p.on).some((p) => p.x === 4 && p.y === 2)).toBe(
    false,
  );
  expect(decodePetState({ ...state, starterPlacements: [] }).starterPlacements).toEqual([]);
});
it('moves cabinet contents together, detaches accessories, and stores or restores starter items without rewards', () => {
  let state = newPet(1, Date.UTC(2026, 10, 15, 12));
  const initial = structuredClone(state);
  const act = (action: PetAction) => {
    state = applyPetAction(state, action, emptyPetWallet(), Date.UTC(2026, 10, 15, 12));
  };
  act({ type: 'place-starter', item: 'starter-console', room: 'living', x: 3, y: 2 });
  for (const item of ['starter-console', 'starter-radio', 'starter-pot']) {
    expect(state.starterPlacements.find((p) => p.item === item)).toMatchObject({
      room: 'living',
      x: 3,
      y: 2,
    });
  }
  act({ type: 'place-starter', item: 'starter-radio', room: 'living', x: 0, y: 0 });
  expect(state.starterPlacements.find((p) => p.item === 'starter-radio')?.on).toBeUndefined();
  act({ type: 'attach-starter', item: 'starter-radio' });
  expect(state.starterPlacements.find((p) => p.item === 'starter-radio')).toMatchObject({
    on: 'starter-console',
    x: 3,
    y: 2,
  });
  act({ type: 'store-starter', item: 'starter-console' });
  expect(
    state.starterPlacements.some((p) =>
      ['starter-console', 'starter-radio', 'starter-pot'].includes(p.item),
    ),
  ).toBe(false);
  expect(() => act({ type: 'attach-starter', item: 'starter-radio' })).toThrow(
    'Сначала поставь тумбу',
  );
  act({ type: 'place-starter', item: 'starter-console', room: 'living', x: 3, y: 2 });
  act({ type: 'attach-starter', item: 'starter-pot' });
  expect(state.xp).toBe(initial.xp);
  expect(state.spent).toEqual(initial.spent);
  expect(state.owned).toEqual(initial.owned);
  expect(state.needs).toEqual(initial.needs);
});
it('checks collisions between starter and purchased furniture, room access and invalid starter payloads', () => {
  const state = newPet(1, Date.UTC(2026, 10, 15, 12));
  state.owned = ['rug'];
  expect(() =>
    applyPetAction(
      state,
      { type: 'place', item: 'rug', room: 'living', x: 4, y: 2 },
      emptyPetWallet(),
      Date.UTC(2026, 10, 15, 12),
    ),
  ).toThrow('занято');
  expect(() =>
    applyPetAction(
      state,
      { type: 'place-starter', item: 'starter-chair', room: 'bedroom', x: 0, y: 0 },
      emptyPetWallet(),
      Date.UTC(2026, 10, 15, 12),
    ),
  ).toThrow('закрыта');
  state.placements = [{ item: 'rug', room: 'living', x: 0, y: 0 }];
  expect(() =>
    applyPetAction(
      state,
      { type: 'place-starter', item: 'starter-chair', room: 'living', x: 0, y: 0 },
      emptyPetWallet(),
      Date.UTC(2026, 10, 15, 12),
    ),
  ).toThrow('занято');
  for (const action of [
    { type: 'place-starter', item: 'sofa', room: 'living', x: 1, y: 1 },
    { type: 'place-starter', item: 'starter-console', room: 'living', x: 6, y: 1 },
    { type: 'attach-starter', item: 'starter-chair' },
  ])
    expect(() =>
      decodePetMutation({ requestId: 'starter_invalid_request', revision: 0, action }),
    ).toThrow();
  expect(() =>
    decodePetState({
      ...state,
      starterPlacements: [state.starterPlacements[0], state.starterPlacements[0]],
    }),
  ).toThrow();
});
it('persists starter moves with authoritative identity and idempotent retries', async () => {
  const s = await setup();
  const view = await s.service.get(s.player);
  const action: PetAction = {
    type: 'place-starter',
    item: 'starter-console',
    room: 'living',
    x: 3,
    y: 2,
  };
  const next = await s.act(view, action, 'starter_move_retry_request');
  expect(await s.act(view, action, 'starter_move_retry_request')).toEqual(next);
  expect((await s.service.get(s.player)).state.starterPlacements).toEqual(
    next.state.starterPlacements,
  );
  expect((await s.service.get({ id: 2, name: 'Other' })).state.starterPlacements).not.toEqual(
    next.state.starterPlacements,
  );
  expect(next.state.xp).toBe(0);
  expect(await s.db.get('SELECT COUNT(*) AS total FROM social_jobs')).toEqual({ total: 0 });
});
it('upgrades legacy attachments to distinct slots and rejects invalid surface relationships', () => {
  const state = newPet(1, Date.UTC(2026, 10, 15, 12));
  const legacy = {
    ...state,
    starterPlacements: state.starterPlacements.map(({ slot: _slot, ...p }) => p),
  };
  const decoded = decodePetState(legacy);
  expect(decoded.starterPlacements.find((p) => p.item === 'starter-radio')?.slot).toBe(0);
  expect(decoded.starterPlacements.find((p) => p.item === 'starter-pot')?.slot).toBe(1);
  expect(() =>
    decodePetState({
      ...state,
      starterPlacements: state.starterPlacements.map((p) =>
        p.item === 'starter-radio' ? { ...p, slot: null } : p,
      ),
    }),
  ).toThrow();
  expect(() =>
    decodePetState({
      ...state,
      starterPlacements: state.starterPlacements.map((p) =>
        p.item === 'starter-pot' ? { ...p, slot: 0 } : p,
      ),
    }),
  ).toThrow('занято');
  expect(() =>
    decodePetState({
      ...state,
      starterPlacements: state.starterPlacements.filter((p) => p.item !== 'starter-console'),
    }),
  ).toThrow('поверхность');
  for (const action of [
    { type: 'place-on-surface', item: 'starter-chair', surface: 'starter-table', slot: 0 },
    { type: 'place-on-surface', item: 'starter-pot', surface: 'sofa', slot: 0 },
    { type: 'place-on-surface', item: 'starter-pot', surface: 'starter-table', slot: -1 },
    { type: 'place-on-surface', item: 'starter-pot', surface: 'starter-table', slot: 2 },
  ])
    expect(() =>
      decodePetMutation({ requestId: 'invalid_surface_request', revision: 0, action }),
    ).toThrow();
});
it('checks surface capacity, object size, ownership and occupancy without replacing existing items', () => {
  const now = Date.UTC(2026, 10, 15, 12);
  let state = newPet(1, now);
  state.xp = 180;
  state.owned = ['wardrobe'];
  state.placements = [{ item: 'wardrobe', room: 'living', x: 0, y: 2 }];
  const act = (action: PetAction) => {
    state = applyPetAction(state, action, emptyPetWallet(), now);
  };
  expect(() =>
    act({ type: 'place-on-surface', item: 'lamp', surface: 'starter-table', slot: 0 }),
  ).toThrow('получи');
  expect(() =>
    act({ type: 'place-on-surface', item: 'starter-radio', surface: 'wardrobe', slot: 0 }),
  ).toThrow('не помещается');
  expect(() =>
    act({ type: 'place-on-surface', item: 'starter-pot', surface: 'wardrobe', slot: 1 }),
  ).toThrow('не помещается');
  act({ type: 'place-on-surface', item: 'starter-radio', surface: 'starter-table', slot: 0 });
  act({ type: 'place-on-surface', item: 'starter-pot', surface: 'starter-table', slot: 1 });
  const before = structuredClone(state);
  expect(() =>
    act({ type: 'place-on-surface', item: 'starter-books', surface: 'starter-table', slot: 0 }),
  ).toThrow('занято');
  expect(state).toEqual(before);
  act({ type: 'place-on-surface', item: 'starter-books', surface: 'wardrobe', slot: 0 });
  expect(decodePetState(state)).toEqual(state);
  act({ type: 'place-starter', item: 'starter-books', room: 'living', x: 0, y: 0 });
  expect(state.starterPlacements.find((p) => p.item === 'starter-books')?.on).toBeUndefined();
  expect(state.xp).toBe(180);
  expect(state.spent).toEqual(emptyPetWallet());
});
it('moves and stores starter and purchased surface contents together across rooms', () => {
  const now = Date.UTC(2026, 10, 15, 12);
  let state = newPet(1, now);
  state.xp = 180;
  state.owned = ['lamp', 'wardrobe'];
  state.placements = [{ item: 'wardrobe', room: 'living', x: 0, y: 2 }];
  const act = (action: PetAction) => {
    state = applyPetAction(state, action, emptyPetWallet(), now);
  };
  act({ type: 'place-on-surface', item: 'lamp', surface: 'starter-table', slot: 0 });
  act({ type: 'place-starter', item: 'starter-table', room: 'bedroom', x: 0, y: 0 });
  expect(state.placements.find((p) => p.item === 'lamp')).toMatchObject({
    room: 'bedroom',
    x: 0,
    y: 0,
    on: 'starter-table',
    slot: 0,
  });
  act({ type: 'store-starter', item: 'starter-table' });
  expect(state.placements.some((p) => p.item === 'lamp')).toBe(false);
  expect(state.owned).toContain('lamp');
  act({ type: 'place-on-surface', item: 'starter-books', surface: 'wardrobe', slot: 0 });
  act({ type: 'place', item: 'wardrobe', room: 'bedroom', x: 1, y: 0 });
  expect(state.starterPlacements.find((p) => p.item === 'starter-books')).toMatchObject({
    room: 'bedroom',
    x: 1,
    y: 0,
    on: 'wardrobe',
  });
  act({ type: 'store', item: 'wardrobe' });
  expect(state.starterPlacements.some((p) => p.item === 'starter-books')).toBe(false);
  expect(state.owned).toContain('wardrobe');
  expect(decodePetState(state)).toEqual(state);
});
it('reserves surface slots atomically and replays the winning request without duplication', async () => {
  const s = await setup();
  const before = await s.service.get(s.player);
  const requests = [
    {
      requestId: 'surface_race_pot_request',
      revision: before.revision,
      action: { type: 'place-on-surface', item: 'starter-pot', surface: 'starter-table', slot: 0 },
    },
    {
      requestId: 'surface_race_books_request',
      revision: before.revision,
      action: {
        type: 'place-on-surface',
        item: 'starter-books',
        surface: 'starter-table',
        slot: 0,
      },
    },
  ];
  const results = await Promise.allSettled(
    requests.map((request) => s.service.act(s.player, request)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const winner = results.findIndex((r) => r.status === 'fulfilled');
  const fresh = await s.service.get(s.player);
  expect(
    fresh.state.starterPlacements.filter((p) => p.on === 'starter-table' && p.slot === 0),
  ).toHaveLength(1);
  expect(await s.service.act(s.player, requests[winner])).toEqual(fresh);
  expect(fresh.state.xp).toBe(before.state.xp);
  expect(fresh.wallet).toEqual(before.wallet);
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
      { type: 'care', care: 'wash' },
      emptyPetWallet(),
      now + 100 * PET_DAY + 100,
    ),
  ).toThrow('15');
  const petted = applyPetAction(
    cared,
    { type: 'care', care: 'pet' },
    emptyPetWallet(),
    now + 100 * PET_DAY + 100,
  );
  const rested = applyPetAction(
    petted,
    { type: 'care', care: 'rest' },
    emptyPetWallet(),
    now + 100 * PET_DAY + 100,
  );
  expect(rested.needs).toEqual({ food: 20, joy: 32, energy: 45, clean: 45 });
  expect(rested.careAt).toEqual({
    wash: now + 100 * PET_DAY,
    pet: now + 100 * PET_DAY + 100,
    rest: now + 100 * PET_DAY + 100,
  });
  expect(rested.xp).toBe(0);
  expect(
    applyPetAction(
      rested,
      { type: 'care', care: 'wash' },
      emptyPetWallet(),
      now + 100 * PET_DAY + 15_000,
    ).needs.clean,
  ).toBe(70);
});
it('upgrades old care timestamps without coupling petting, washing and resting', () => {
  const { careAt: _times, ...legacy } = newPet(1, Date.UTC(2026, 10, 14, 12));
  legacy.lastCare = legacy.updatedAt;
  const restored = decodePetState(legacy);
  expect(restored.careAt).toEqual({ pet: 0, wash: 0, rest: 0 });
  expect(() =>
    applyPetAction(restored, { type: 'care', care: 'rest' }, emptyPetWallet(), legacy.updatedAt),
  ).not.toThrow();
  expect(() => decodePetState({ ...legacy, careAt: { pet: -1, wash: 0, rest: 0 } })).toThrow();
});
it('saves independent care with authoritative cooldowns and deduplicates a lost response', async () => {
  const s = await setup();
  let view = await s.service.get(s.player);
  const input = {
    requestId: 'care_retry_same_request',
    revision: view.revision,
    action: { type: 'care', care: 'pet' },
  };
  const petted = await s.service.act(s.player, input);
  view = await s.act(petted, { type: 'care', care: 'wash' });
  view = await s.act(view, { type: 'care', care: 'rest' });
  expect(view.revision).toBe(3);
  expect(view.state.careAt).toEqual({ pet: s.now(), wash: s.now(), rest: s.now() });
  expect(view.state.needs).toEqual({ food: 75, joy: 92, energy: 100, clean: 100 });
  expect(view.state.xp).toBe(0);
  expect(view.wallet).toEqual(emptyPetWallet());
  expect(await s.service.act(s.player, input)).toEqual(view);
  await expect(
    s.service.act(s.player, {
      requestId: 'care_forced_time_request',
      revision: view.revision,
      action: { type: 'care', care: 'pet', now: s.now() + PET_DAY },
    }),
  ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  expect((await s.service.get(s.player)).revision).toBe(3);
  s.advance(15_000);
  expect((await s.act(view, { type: 'care', care: 'pet' })).state.needs.joy).toBe(100);
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
