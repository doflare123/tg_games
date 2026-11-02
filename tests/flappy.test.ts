import { afterEach, describe, expect, it, vi } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import {
  createFlappy,
  FLAPPY_GAP,
  FLAPPY_MAX_TICKS,
  type FlappyState,
  stepFlappy,
} from '../src/games/flappy/engine.ts';
import { FlappyService } from '../src/server/domain/flappy.ts';
import { SqlFlappyRepository } from '../src/server/platform/sql-flappy.ts';
import { decodeFlappyState } from '../src/shared/flappy.ts';
import { parseLaunch } from '../src/shared/launch.ts';

const databases: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const local = localRepository();
  databases.push(local);
  const repository = new SqlFlappyRepository(local.db);
  let now = Date.UTC(2026, 10, 2, 12);
  const service = new FlappyService(repository, { now: () => now, seed: () => 123 });
  return {
    service,
    repository,
    advance(ms: number) {
      now += ms;
    },
  };
}
const player = { id: 1, name: 'Bird' };
const request = { requestId: 'flappy-request-0001' };
function pilot(state: FlappyState): boolean {
  const pipe = state.pipes.find((p) => p.x + 52000 > 68000);
  const target = pipe?.gapY ?? 220;
  return state.ticks - state.lastFlap >= 4 && state.y / 1000 > target + 12 && state.velocity >= 0;
}
describe('Flappy deterministic physics', () => {
  it('reproduces seeds, accepts taps at a fixed tick rate and stops at death', () => {
    expect(parseLaunch('game_flappy')).toEqual({ view: 'game', game: 'flappy' });
    const a = createFlappy(123),
      b = createFlappy(123);
    expect(a).toEqual(b);
    expect(a.pipes).not.toEqual(createFlappy(124).pipes);
    expect(stepFlappy(a, true)).toBe(true);
    expect(a.y).toBeLessThan(b.y);
    expect(stepFlappy(a, true)).toBe(false);
    while (a.status === 'playing') stepFlappy(a);
    const dead = structuredClone(a);
    expect(stepFlappy(a, true)).toBe(false);
    expect(a).toEqual(dead);
    expect(decodeFlappyState(a)).toEqual(a);
    expect(() => decodeFlappyState({ ...a, pipes: [{ x: 0 }] })).toThrow();
    expect(() => decodeFlappyState({ ...a, y: NaN })).toThrow();
  });
  it('scores a passed pipe only once, collides with pipes, ceiling and ground', () => {
    const state = createFlappy(1);
    const pipe = state.pipes[0];
    if (!pipe) throw Error('Missing pipe');
    pipe.x = 16000;
    pipe.gapY = 220;
    stepFlappy(state);
    expect(state.score).toBe(1);
    stepFlappy(state);
    expect(state.score).toBe(1);
    for (const y of [0, 400000]) {
      const edge = createFlappy(1);
      edge.y = y;
      stepFlappy(edge);
      expect(edge.status).toBe('over');
    }
    const hit = createFlappy(1);
    const obstacle = hit.pipes[0];
    if (!obstacle) throw Error('Missing pipe');
    obstacle.x = 80000;
    hit.y = (obstacle.gapY - FLAPPY_GAP / 2 - 12) * 1000;
    stepFlappy(hit);
    expect(hit.status).toBe('over');
    const limit = createFlappy(1);
    limit.ticks = FLAPPY_MAX_TICKS - 1;
    stepFlappy(limit);
    expect(limit.status).toBe('over');
  });
});
describe('Flappy authoritative ranking', () => {
  it('replays multiple checkpoints, records only finished games and ignores client scores', async () => {
    const s = setup();
    let run = await s.service.create(player, request);
    expect(await s.service.create(player, request)).toEqual(run);
    expect((await s.service.leaderboard(player, { period: 'all' })).entries).toEqual([]);
    const state = structuredClone(run.state);
    let chunks = 0;
    while (state.status === 'playing') {
      const start = state.ticks;
      const flaps: number[] = [];
      while (state.ticks - start < 100 && state.status === 'playing') {
        const flap = pilot(state);
        if (flap) flaps.push(state.ticks);
        stepFlappy(state, flap);
      }
      s.advance(Math.ceil(((state.ticks - start) * 1000) / 60) + 1);
      const input = {
        runId: run.id,
        revision: run.revision,
        untilTick: state.ticks,
        flaps,
        score: 999999,
      };
      run = await s.service.submit(player, input);
      expect(run.state).toEqual(state);
      expect(await s.service.submit(player, input)).toEqual(run);
      chunks++;
      // End an otherwise successful flight after several checkpoints.
      if (state.ticks > 800) {
        while (state.status === 'playing') {
          const tick = state.ticks;
          stepFlappy(state);
          s.advance(Math.ceil(1000 / 60) + 1);
          run = await s.service.submit(player, {
            runId: run.id,
            revision: run.revision,
            untilTick: tick + 1,
            flaps: [],
          });
        }
      }
    }
    expect(chunks).toBeGreaterThan(1);
    expect(state.score).toBeGreaterThan(0);
    expect(run.status).toBe('verified');
    expect((await s.service.leaderboard(player, { period: 'week' })).me?.score).toBe(state.score);
    s.advance(7 * 86400000);
    expect((await s.service.leaderboard(player, { period: 'week' })).entries).toEqual([]);
    expect((await s.service.leaderboard(player, { period: 'all' })).entries).toHaveLength(1);
  });
  it('rejects foreign ownership, malformed or too-fast replays, expired runs and input after death', async () => {
    const s = setup(),
      run = await s.service.create(player, request);
    await expect(s.service.get({ id: 2, name: 'Other' }, { runId: run.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      s.service.submit(
        { id: 2, name: 'Other' },
        { runId: run.id, revision: 0, untilTick: 1, flaps: [] },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const input of [
      { untilTick: 601, flaps: [] },
      { untilTick: 300, flaps: [] },
      { untilTick: 1, flaps: [NaN] },
      { untilTick: 10, flaps: [4, 0] },
      { untilTick: 10, flaps: [0, 0] },
      { untilTick: 10, flaps: [0, 2] },
      { untilTick: 10, flaps: [10] },
      { untilTick: 0, flaps: [] },
      { untilTick: 10, flaps: 'tap' },
    ])
      await expect(
        s.service.submit(player, { runId: run.id, revision: 0, ...input }),
      ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    s.advance(10000);
    await expect(
      s.service.submit(player, { runId: run.id, revision: 0, untilTick: 500, flaps: [] }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await s.service.get(player, { runId: run.id })).state.ticks).toBe(0);
    s.advance(7200000);
    await expect(
      s.service.submit(player, { runId: run.id, revision: 0, untilTick: 1, flaps: [] }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
  });
  it('uses compare-and-swap, enforces cross-chunk flap spacing and rejects stale revisions', async () => {
    const s = setup(),
      run = await s.service.create(player, request);
    const results = await Promise.allSettled([
      s.service.submit(player, { runId: run.id, revision: 0, untilTick: 1, flaps: [0] }),
      s.service.submit(player, { runId: run.id, revision: 0, untilTick: 1, flaps: [] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const stored = await s.service.get(player, { runId: run.id });
    expect(stored.revision).toBe(1);
    if (stored.state.lastFlap === 0)
      await expect(
        s.service.submit(player, { runId: run.id, revision: 1, untilTick: 2, flaps: [1] }),
      ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(
      s.service.submit(player, { runId: run.id, revision: 0, untilTick: 2, flaps: [] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('returns the best attempt per player and own place beyond the top 50; rate limits starts', async () => {
    const s = setup();
    for (let id = 1; id <= 52; id++) {
      const created = await s.service.create({ id, name: `P${id}` }, request);
      const stored = await s.repository.get(created.id);
      if (!stored) throw Error('Missing fixture');
      await s.repository.save(
        {
          ...stored,
          revision: 1,
          status: 'verified',
          state: { ...stored.state, score: id, status: 'over' },
        },
        0,
      );
    }
    const board = await s.service.leaderboard(player, { period: 'all' });
    expect(board.entries).toHaveLength(50);
    expect(board.me?.rank).toBe(52);
    const created = await s.service.create(player, { requestId: 'flappy-second-00001' });
    const stored = await s.repository.get(created.id);
    if (!stored) throw Error('Missing fixture');
    await s.repository.save(
      {
        ...stored,
        revision: 1,
        status: 'verified',
        state: { ...stored.state, score: 100, status: 'over' },
      },
      0,
    );
    expect((await s.service.leaderboard(player, { period: 'all' })).me?.rank).toBe(1);
    for (let i = 0; i < 8; i++)
      await s.service.create(player, { requestId: `flappy-request-${String(i).padStart(8, '0')}` });
    await expect(
      s.service.create(player, { requestId: 'flappy-limit-00001' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });
});
