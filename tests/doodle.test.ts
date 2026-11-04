import { afterEach, describe, expect, it, vi } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { stepAdventure } from '../src/games/doodle/adventure.ts';
import {
  createDoodle,
  DOODLE_MAX_TICKS,
  DOODLE_PLATFORM_MARGIN,
  type DoodleDirection,
  doodlePlatformX,
  LEGACY_DOODLE_RULESET,
  stepDoodle,
} from '../src/games/doodle/engine.ts';
import { DoodleService } from '../src/server/domain/doodle.ts';
import { SqlDoodleRepository } from '../src/server/platform/sql-doodle.ts';
import {
  DOODLE_RULESET as CURRENT_RULESET,
  type DoodleEvent,
  decodeDoodleState,
} from '../src/shared/doodle.ts';
import { decodeAdventureState } from '../src/shared/doodle-adventure.ts';
import * as doodlePolicy from '../src/shared/doodle-policy.ts';
import { parseLaunch } from '../src/shared/launch.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of handles.splice(0)) db.close();
});
function setup() {
  vi.spyOn(doodlePolicy, 'isDoodleRankedEnabled').mockReturnValue(true);
  const local = localRepository();
  handles.push(local);
  const repository = new SqlDoodleRepository(local.db);
  let now = Date.UTC(2026, 10, 3, 12);
  return {
    repository,
    service: new DoodleService(repository, { now: () => now, seed: () => 123 }),
    advance(ms: number) {
      now += ms;
    },
  };
}
const player = { id: 1, name: 'Jumper' };
const request = { requestId: 'doodle-request-0001' };
describe('Doodle Jump deterministic physics', () => {
  it('keeps generated and moving platforms wholly inside the field without teleporting', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createDoodle(seed);
      // Exercise generation far above the initial screen, not only the first batch.
      for (let page = 0; page < 30; page++) {
        state.y = state.camera + 500000;
        state.vy = 0;
        stepDoodle(state);
        for (const platform of state.platforms) {
          expect(platform.x).toBeGreaterThanOrEqual(DOODLE_PLATFORM_MARGIN);
          expect(platform.x).toBeLessThanOrEqual(360000 - DOODLE_PLATFORM_MARGIN);
        }
      }
    }
    for (const x of [34000, 35000, 180000, 325000, 326000]) {
      for (const phase of [0, 119, 239]) {
        const platform = { x, y: 100000, kind: 'moving' as const, phase, broken: false };
        let previous = doodlePlatformX(platform, 0);
        for (let tick = 1; tick <= 480; tick++) {
          const position = doodlePlatformX(platform, tick);
          expect(position).toBeGreaterThanOrEqual(DOODLE_PLATFORM_MARGIN);
          expect(position).toBeLessThanOrEqual(360000 - DOODLE_PLATFORM_MARGIN);
          expect(Math.abs(position - previous)).toBeLessThanOrEqual(600);
          previous = position;
        }
      }
    }
    const edge = { x: 1000, y: 100000, kind: 'moving' as const, phase: 0, broken: false };
    expect(doodlePlatformX(edge, 0, LEGACY_DOODLE_RULESET)).toBe(325000);
    expect(doodlePlatformX(edge, 0)).toBe(103000);
  });
  it('reproduces seeded worlds and validates state throughout full simulations', () => {
    expect(parseLaunch('game_doodle')).toEqual({ view: 'game', game: 'doodle' });
    expect(createDoodle(123)).toEqual(createDoodle(123));
    expect(createDoodle(123).platforms).not.toEqual(createDoodle(124).platforms);
    for (let seed = 0; seed < 20; seed++) {
      const a = createDoodle(seed),
        b = createDoodle(seed);
      while (a.status === 'playing') {
        const input: DoodleDirection = a.ticks % 180 < 90 ? 1 : -1;
        stepDoodle(a, input);
        stepDoodle(b, input);
        expect(a).toEqual(b);
        expect(decodeDoodleState(a)).toEqual(a);
      }
      const dead = structuredClone(a);
      expect(stepDoodle(a, 1)).toBe(false);
      expect(a).toEqual(dead);
    }
    for (const state of [
      { ...createDoodle(1), x: NaN },
      { ...createDoodle(1), direction: 2 },
      { ...createDoodle(1), platforms: [] },
    ])
      expect(() => decodeDoodleState(state)).toThrow();
  });
  it('lands only while falling, springs higher, breaks fragile platforms and wraps horizontally', () => {
    for (const kind of ['normal', 'moving', 'spring', 'fragile'] as const) {
      const s = createDoodle(1);
      s.x = 180000;
      s.y = 101000;
      s.vy = -2000;
      s.platforms = [{ x: 180000, y: 100000, kind, phase: 59, broken: false }];
      stepDoodle(s);
      expect(s.y).toBe(100000);
      expect(s.vy).toBe(kind === 'spring' ? 14000 : 10500);
      expect(s.platforms[0]?.broken).toBe(kind === 'fragile');
      s.y = 99000;
      s.vy = 2000;
      stepDoodle(s);
      expect(s.vy).toBe(1720);
    }
    const s = createDoodle(1);
    s.x = 359000;
    s.vx = 3600;
    stepDoodle(s, 1);
    expect(s.x).toBe(2600);
    s.x = 1000;
    s.vx = -3600;
    stepDoodle(s, -1);
    expect(s.x).toBe(357400);
    s.ticks = DOODLE_MAX_TICKS - 1;
    stepDoodle(s);
    expect(s.status).toBe('over');
    const broken = createDoodle(1);
    broken.y = 101000;
    broken.vy = -2000;
    broken.platforms = [{ x: broken.x, y: 100000, kind: 'fragile', phase: 0, broken: true }];
    stepDoodle(broken);
    expect(broken.vy).toBeLessThan(0);
    broken.camera = 300000;
    broken.y = 240000;
    stepDoodle(broken);
    expect(broken.status).toBe('over');
  });
});
describe('Doodle Jump authoritative ranking', () => {
  it('replays checkpoints exactly, retries idempotently and computes height instead of trusting a claimed score', async () => {
    const s = setup();
    let run = await s.service.create(player, request);
    expect(await s.service.create(player, request)).toEqual(run);
    expect((await s.service.leaderboard(player, { period: 'all' })).entries).toEqual([]);
    const state = decodeAdventureState(run.state);
    let chunks = 0;
    while (state.status === 'playing') {
      const from = state.ticks;
      const events: DoodleEvent[] = [];
      while (state.status === 'playing' && state.ticks - from < 60) {
        const direction: DoodleDirection = state.ticks % 180 < 90 ? 1 : -1;
        const shooting = state.ticks % 90 < 60,
          aim = state.ticks % 120 < 60 ? -400 : 650;
        if (state.direction !== direction || state.shooting !== shooting || state.aim !== aim)
          events.push({ tick: state.ticks, direction, shooting, aim });
        stepAdventure(state, { direction, shooting, aim });
      }
      s.advance(Math.ceil(((state.ticks - from) * 1000) / 60));
      const input = {
        runId: run.id,
        revision: run.revision,
        untilTick: state.ticks,
        events,
        score: 999999,
      };
      run = await s.service.submit(player, input);
      expect(run.state).toEqual(state);
      expect(await s.service.submit(player, input)).toEqual(run);
      chunks++;
    }
    expect(chunks).toBeGreaterThan(1);
    expect(run.status).toBe('verified');
    expect(state.score).toBeGreaterThan(0);
    expect((await s.service.leaderboard(player, { period: 'week' })).me?.score).toBe(state.score);
    expect((await s.repository.pendingResults(3))[0]?.id).toBe(run.id);
    s.advance(7 * 86400000);
    expect((await s.service.leaderboard(player, { period: 'week' })).entries).toEqual([]);
    expect((await s.service.leaderboard(player, { period: 'all' })).entries).toHaveLength(1);
  });
  it('rejects foreign identity, invalid events, duplicate ticks, oversized chunks, early simulation and expired runs', async () => {
    const s = setup();
    const run = await s.service.create(player, request);
    const base = { runId: run.id, revision: 0, untilTick: 10, events: [] };
    await expect(s.service.get({ id: 2, name: 'Other' }, base)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(s.service.submit({ id: 2, name: 'Other' }, base)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const input of [
      { untilTick: 601 },
      { untilTick: 300 },
      { untilTick: 0 },
      { events: 'left' },
      { events: [{ tick: 0, direction: 2 }] },
      { events: [{ tick: 0, direction: '1' }] },
      { events: [{ tick: 0, direction: 1, shooting: 'true', aim: 0 }] },
      { events: [{ tick: 0, direction: 1, shooting: true, aim: 1001 }] },
      { events: [{ tick: 0, direction: 1, shooting: true, aim: 0.5 }] },
      { events: [{ tick: NaN, direction: 0 }] },
      { events: [{ tick: 10, direction: 1 }] },
      {
        events: [
          { tick: 1, direction: 1 },
          { tick: 1, direction: -1 },
        ],
      },
      {
        events: [
          { tick: 2, direction: 1 },
          { tick: 1, direction: -1 },
        ],
      },
      { events: Array.from({ length: 601 }, (_, tick) => ({ tick, direction: 1 })) },
    ])
      await expect(s.service.submit(player, { ...base, ...input })).rejects.toMatchObject({
        code: 'BAD_INPUT',
      });
    expect((await s.service.get(player, base)).revision).toBe(0);
    s.advance(7200001);
    await expect(s.service.submit(player, base)).rejects.toMatchObject({ code: 'EXPIRED' });
  });
  it('uses compare-and-swap and rejects stale or backward checkpoints', async () => {
    const s = setup();
    const run = await s.service.create(player, request);
    const base = { runId: run.id, revision: 0, untilTick: 1 };
    const results = await Promise.allSettled([
      s.service.submit(player, { ...base, events: [] }),
      s.service.submit(player, {
        ...base,
        events: [{ tick: 0, direction: 1, shooting: true, aim: 0 }],
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(
      s.service.submit(player, { ...base, untilTick: 2, events: [] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      s.service.submit(player, { ...base, revision: 1, events: [] }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(
      s.service.submit(player, {
        ...base,
        revision: 1,
        untilTick: 2,
        events: [{ tick: 0, direction: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });
  it('rejects simulation beyond death without committing any state', async () => {
    const s = setup();
    const run = await s.service.create(player, request);
    const state = decodeAdventureState(run.state);
    while (state.status === 'playing')
      stepAdventure(state, { direction: 1, shooting: true, aim: 0 });
    s.advance((state.ticks * 1000) / 60 + 1000);
    await expect(
      s.service.submit(player, {
        runId: run.id,
        revision: 0,
        untilTick: state.ticks + 1,
        events: [{ tick: 0, direction: 1, shooting: true, aim: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await s.service.get(player, { runId: run.id })).state.ticks).toBe(0);
  });
  it('finishes pre-update replays with v1 physics and keeps both ranking histories accessible', async () => {
    const s = setup();
    const created = await s.service.create(player, request);
    expect(created.ruleset).toBe(CURRENT_RULESET);
    const original = await s.repository.get(created.id);
    if (!original || original.ruleset !== CURRENT_RULESET) throw new Error('Missing run');
    const legacyState = createDoodle(123, LEGACY_DOODLE_RULESET);
    const { ruleset: _version, ...oldSerializedState } = legacyState;
    expect(decodeDoodleState(oldSerializedState).ruleset).toBe(LEGACY_DOODLE_RULESET);
    let legacy = await s.repository.create({
      ...original,
      id: 'legacy:doodle:fixture',
      ruleset: LEGACY_DOODLE_RULESET,
      state: decodeDoodleState(oldSerializedState),
    });
    while (legacyState.status === 'playing') {
      const from = legacyState.ticks;
      while (legacyState.status === 'playing' && legacyState.ticks - from < 100)
        stepDoodle(legacyState, 1);
      s.advance(Math.ceil(((legacyState.ticks - from) * 1000) / 60));
      const result = await s.service.submit(player, {
        runId: legacy.id,
        revision: legacy.revision,
        untilTick: legacyState.ticks,
        events: from === 0 ? [{ tick: 0, direction: 1 }] : [],
      });
      expect(result.state).toEqual(legacyState);
      const stored = await s.repository.get(result.id);
      if (!stored) throw new Error('Missing legacy run');
      legacy = stored;
    }
    expect((await s.service.leaderboard(player, { period: 'all' })).me).toBeNull();
    expect(
      (await s.service.leaderboard(player, { period: 'all', ruleset: LEGACY_DOODLE_RULESET })).me
        ?.runId,
    ).toBe(legacy.id);
    await s.repository.save(
      {
        ...original,
        revision: 1,
        status: 'verified',
        state: { ...original.state, score: 999, status: 'over', reason: 'fall' },
      },
      0,
    );
    expect((await s.service.leaderboard(player, { period: 'all' })).me?.runId).toBe(original.id);
    expect(
      (await s.service.leaderboard(player, { period: 'all', ruleset: LEGACY_DOODLE_RULESET })).me
        ?.runId,
    ).toBe(legacy.id);
  });
  it('limits starts and returns personal rank outside the top 50 with deterministic ties', async () => {
    const s = setup();
    for (let id = 1; id <= 52; id++) {
      const created = await s.service.create({ id, name: `P${id}` }, request);
      const stored = await s.repository.get(created.id);
      if (!stored || stored.ruleset !== CURRENT_RULESET) throw new Error('Missing run');
      await s.repository.save(
        {
          ...stored,
          revision: 1,
          status: 'verified',
          state: { ...stored.state, score: id, status: 'over', reason: 'fall' },
        },
        0,
      );
    }
    const board = await s.service.leaderboard(player, { period: 'all' });
    expect(board.entries).toHaveLength(50);
    expect(board.me?.rank).toBe(52);
    for (let i = 0; i < 9; i++)
      await s.service.create(player, { requestId: `doodle-limit-${String(i).padStart(8, '0')}` });
    await expect(
      s.service.create(player, { requestId: 'doodle-limit-overflow' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });
});

it('enables ranking by default and can close submissions while preserving archived results', async () => {
  const s = setup();
  const run = await s.service.create(player, request);
  const stored = await s.repository.get(run.id);
  if (!stored || stored.ruleset !== CURRENT_RULESET) throw new Error('Missing run');
  await s.repository.create({
    ...stored,
    id: 'legacy-closed-run',
    ruleset: LEGACY_DOODLE_RULESET,
    state: createDoodle(123, LEGACY_DOODLE_RULESET),
  });
  vi.restoreAllMocks();
  expect(doodlePolicy.isDoodleRankedEnabled()).toBe(true);
  vi.spyOn(doodlePolicy, 'isDoodleRankedEnabled').mockReturnValue(false);
  for (const requestId of [request.requestId, 'doodle-disabled-new-run'])
    await expect(s.service.create(player, { requestId })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: doodlePolicy.DOODLE_RANKED_CLOSED_MESSAGE,
    });
  for (const runId of [run.id, 'legacy-closed-run'])
    await expect(
      s.service.submit(player, { runId, revision: 0, untilTick: 1, events: [] }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect((await s.repository.get(run.id))?.revision).toBe(0);
  expect(await s.repository.get('1:doodle:doodle-disabled-new-run')).toBeNull();
  expect(await s.service.get(player, { runId: run.id })).toEqual(run);
  await s.repository.save(
    {
      ...stored,
      revision: 1,
      status: 'verified',
      state: { ...stored.state, score: 100, status: 'over', reason: 'fall' },
    },
    0,
  );
  expect((await s.service.leaderboard(player, { period: 'all' })).me?.score).toBe(100);
});
