import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { stepTetris } from '../src/games/tetris/engine.ts';
import type { ReplayEvent } from '../src/games/tetris/types.ts';
import { ArcadeService } from '../src/server/domain/arcade.ts';
import { verifiedPlayer } from '../src/server/platform/context.ts';
import { cloneTetris } from '../src/shared/validation.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});
function setup() {
  const local = localRepository();
  handles.push(local);
  let now = Date.UTC(2026, 9, 30, 12);
  return {
    local,
    service: new ArcadeService(local.repository, { now: () => now, seed: () => 123 }),
    advance: (ms: number) => {
      now += ms;
    },
    player: { id: 8, name: 'Игрок' },
  };
}
const request = { mode: 'marathon', requestId: '0123456789abcdef' };
describe('authoritative sessions against SQLite', () => {
  it('creates idempotently without resetting progress and rejects different modes', async () => {
    const { service, player } = setup();
    const run = await service.create(player, request);
    expect(await service.create(player, request)).toEqual(run);
    await expect(service.create(player, { ...request, mode: 'sprint' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('does not expose or mutate another player’s run', async () => {
    const { service, player } = setup();
    const run = await service.create(player, request);
    for (const operation of [service.get.bind(service), service.abandon.bind(service)])
      await expect(operation({ id: 9, name: 'Другой' }, { runId: run.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
  });
  it('computes score from replay, verifies finish and inserts only one best record', async () => {
    const { service, player, advance } = setup();
    const run = await service.create(player, request);
    const state = cloneTetris(run.state);
    const events: ReplayEvent[] = [];
    while (state.status === 'playing' && state.tick < 600) {
      events.push({ tick: state.tick + 1, action: 'hardDrop' });
      stepTetris(state, ['hardDrop']);
    }
    advance(10000);
    const input = { runId: run.id, revision: 0, untilTick: state.tick, events, score: 999999999 };
    const result = await service.submit(player, input);
    expect(result.status).toBe('verified');
    expect(result.state.score).toBe(state.score);
    expect(await service.submit(player, input)).toEqual(result);
    const board = await service.leaderboard(player, { mode: 'marathon', period: 'all' });
    expect(board.entries).toHaveLength(1);
    expect(board.me?.score).toBe(state.score);
    expect(board.me?.score).not.toBe(999999999);
  });
  it('rejects time acceleration, reversed events and input floods', async () => {
    const { service, player, advance } = setup();
    const run = await service.create(player, request);
    const base = { runId: run.id, revision: 0, untilTick: 600, events: [] };
    await expect(service.submit(player, base)).rejects.toMatchObject({ code: 'BAD_INPUT' });
    advance(10000);
    await expect(
      service.submit(player, {
        ...base,
        events: [
          { tick: 2, action: 'left' },
          { tick: 1, action: 'left' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(
      service.submit(player, {
        ...base,
        events: Array.from({ length: 5 }, () => ({ tick: 1, action: 'left' })),
      }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await service.get(player, { runId: run.id })).revision).toBe(0);
  });
  it('rejects events after game over', async () => {
    const { service, player, advance } = setup();
    const run = await service.create(player, request);
    advance(10000);
    const events = Array.from({ length: 600 }, (_, tick) => ({
      tick: tick + 1,
      action: 'hardDrop',
    }));
    await expect(
      service.submit(player, { runId: run.id, revision: 0, untilTick: 600, events }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });
  it('arbitrates concurrent writes and retries accepted chunks safely', async () => {
    const { service, player, advance } = setup();
    const run = await service.create(player, request);
    advance(1000);
    const input = { runId: run.id, revision: 0, untilTick: 60, events: [] };
    const results = await Promise.allSettled([
      service.submit(player, input),
      service.submit(player, input),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const current = await service.get(player, { runId: run.id });
    expect(current.revision).toBe(1);
    expect((await service.submit(player, input)).revision).toBe(1);
    await expect(
      service.submit(player, { ...input, events: [{ tick: 1, action: 'left' }] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('archives accepted input before the next checkpoint and recovers after a new service instance', async () => {
    const { service, local, player, advance } = setup();
    const run = await service.create(player, request);
    advance(2000);
    await service.submit(player, { runId: run.id, revision: 0, untilTick: 60, events: [] });
    const restarted = new ArcadeService(local.repository, {
      now: () => run.createdAt + 2000,
      seed: () => 99,
    });
    const restored = await restarted.get(player, { runId: run.id });
    expect(restored.state.tick).toBe(60);
    await restarted.submit(player, { runId: run.id, revision: 1, untilTick: 120, events: [] });
    const chunks = local.database.prepare('SELECT * FROM replay_chunks').all();
    expect(chunks).toHaveLength(1);
    const latest = await local.repository.get(run.id);
    expect(latest?.lastSubmission).toContain('"revision":1');
  });
  it('does not rank abandoned runs and blocks expired uploads', async () => {
    const { service, player, advance } = setup();
    const run = await service.create(player, request);
    await service.abandon(player, { runId: run.id });
    expect(
      (await service.leaderboard(player, { mode: 'marathon', period: 'all' })).entries,
    ).toHaveLength(0);
    const second = await service.create(player, { ...request, requestId: '2222222222222222' });
    advance(1900000);
    await expect(
      service.submit(player, { runId: second.id, revision: 0, untilTick: 1, events: [] }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
  });
  it('takes identity from verified endpoint context and rejects missing users', () => {
    expect(
      verifiedPlayer({ initData: { user: { id: 42, first_name: 'Маша', last_name: 'Т.' } } }),
    ).toEqual({ id: 42, name: 'Маша Т.' });
    expect(() => verifiedPlayer({ initData: {} })).toThrow();
  });
});
