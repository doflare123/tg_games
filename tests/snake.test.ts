import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { directionFromVector } from '../src/client/games/snake/input.ts';
import {
  createSnake,
  SNAKE_DIRECTIONS,
  SNAKE_MAX_TICKS,
  SNAKE_STEP_MS,
  type SnakeDirection,
  stepSnake,
} from '../src/games/snake/engine.ts';
import { SnakeService } from '../src/server/domain/snake.ts';
import { SqlSnakeRepository } from '../src/server/platform/sql-snake.ts';
import { parseLaunch } from '../src/shared/launch.ts';
import { decodeSnakeState } from '../src/shared/snake.ts';

describe('snake core and input', () => {
  it('starts deterministically, spawns off the body and supports direct launch', () => {
    for (const size of [12, 16, 20, 24]) {
      const state = createSnake(size, 123);
      expect(state).toEqual(createSnake(size, 123));
      expect(state.body).toHaveLength(3);
      expect(state.body).not.toContain(state.food);
    }
    expect(parseLaunch('game_snake')).toEqual({ view: 'game', game: 'snake' });
    expect(() => createSnake(13, 0)).toThrow();
    expect(() => decodeSnakeState({ ...createSnake(12, 1), body: [1, 1, 2] })).toThrow();
  });
  it('grows, scores, rejects reverse input and stops at a wall', () => {
    const state = createSnake(12, 0);
    const head = state.body[0] ?? 0;
    state.food = head + 1;
    const initial = structuredClone(state);
    expect(stepSnake(state, 'left')).toBe(false);
    expect(state).toEqual(initial);
    expect(stepSnake(state, 'right')).toBe(true);
    expect(state.score).toBe(10);
    expect(state.body).toHaveLength(4);
    expect(state.body).not.toContain(state.food);
    while (state.status === 'playing') stepSnake(state);
    expect(state.status).toBe('over');
    expect(stepSnake(state)).toBe(false);
  });
  it('permits moving into the vacating tail and detects a body collision', () => {
    const state = createSnake(12, 0);
    state.body = [13, 14, 26, 25];
    state.direction = 'left';
    state.food = 100;
    expect(stepSnake(state, 'down')).toBe(true);
    expect(state.status).toBe('playing');
    state.body = [13, 14, 26, 25, 37];
    state.direction = 'left';
    stepSnake(state, 'down');
    expect(state.status).toBe('over');
  });
  it('ends with a win on the final apple and caps duration', () => {
    const state = createSnake(12, 0);
    state.body = [0, ...Array.from({ length: 142 }, (_, i) => i + 2)];
    state.food = 1;
    state.direction = 'right';
    state.score = 1400;
    stepSnake(state);
    expect(state.status).toBe('won');
    expect(state.food).toBeNull();
    expect(state.score).toBe(1410);
    const timed = createSnake(12, 0);
    timed.ticks = SNAKE_MAX_TICKS - 1;
    stepSnake(timed);
    expect(timed.status).toBe('over');
  });
  it('maps swipes to the four axes with a deadzone', () => {
    expect(directionFromVector(4, 5)).toBeNull();
    expect([
      directionFromVector(0, -50),
      directionFromVector(50, 0),
      directionFromVector(0, 50),
      directionFromVector(-50, 0),
    ]).toEqual(SNAKE_DIRECTIONS);
  });
});

const databases: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const local = localRepository(':memory:');
  databases.push(local);
  const repository = new SqlSnakeRepository(local.db);
  let now = Date.UTC(2026, 10, 2, 12);
  let seed = 0;
  while (createSnake(12, seed).food !== 79) seed++;
  const service = new SnakeService(repository, { now: () => now, seed: () => seed });
  return {
    service,
    repository,
    db: local.db,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const player = { id: 1, name: '<Игрок>' };
const request = { requestId: 'snake-request-0001', size: 12 };
describe('authoritative snake ranking', () => {
  it('continues across bounded checkpoints with identical client and server state', async () => {
    const s = setup();
    let run = await s.service.create(player, request);
    const state = structuredClone(run.state);
    for (let chunk = 0; chunk < 3; chunk++) {
      const directions: SnakeDirection[] = [];
      for (let i = 0; i < 200; i++) {
        const head = state.body[0] ?? 0;
        const x = head % 12,
          y = Math.floor(head / 12);
        const direction: SnakeDirection =
          state.direction === 'right' && state.ticks === 0
            ? 'up'
            : state.direction === 'up' && y === 1
              ? 'left'
              : state.direction === 'left' && x === 1
                ? 'down'
                : state.direction === 'down' && y === 10
                  ? 'right'
                  : state.direction === 'right' && x === 10
                    ? 'up'
                    : state.direction;
        stepSnake(state, direction);
        directions.push(direction);
        expect(state.status).toBe('playing');
      }
      s.advance(200 * SNAKE_STEP_MS);
      const input = { runId: run.id, revision: run.revision, directions };
      run = await s.service.submit(player, input);
      expect(run.state).toEqual(state);
      expect(await s.service.submit(player, input)).toEqual(run);
    }
    expect(run.state.ticks).toBe(600);
    expect(run.revision).toBe(3);
    expect((await s.service.leaderboard(player, { size: 12, period: 'all' })).entries).toHaveLength(
      0,
    );
  });
  it('replays movement, ignores supplied score, retries idempotently and separates boards', async () => {
    const s = setup();
    const run = await s.service.create(player, request);
    expect(await s.service.create(player, request)).toEqual(run);
    await expect(s.service.create(player, { ...request, size: 16 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await s.service.leaderboard(player, { size: 12, period: 'all' })).entries).toHaveLength(
      0,
    );
    const directions: SnakeDirection[] = [];
    const state = structuredClone(run.state);
    while (state.status === 'playing') {
      directions.push('right');
      stepSnake(state);
    }
    s.advance(directions.length * SNAKE_STEP_MS);
    const input = { runId: run.id, revision: 0, directions, score: 999999 };
    const result = await s.service.submit(player, input);
    expect(result.status).toBe('verified');
    expect(result.state).toEqual(state);
    expect(state.score).toBe(10);
    expect(await s.service.submit(player, input)).toEqual(result);
    const board = await s.service.leaderboard(player, { size: 12, period: 'week' });
    expect(board.entries).toHaveLength(1);
    expect(board.me?.score).toBe(10);
    expect(board.me?.name).toBe(player.name);
    expect((await s.service.leaderboard(player, { size: 16, period: 'all' })).entries).toHaveLength(
      0,
    );
    s.advance(7 * 86400000);
    expect(
      (await s.service.leaderboard(player, { size: 12, period: 'week' })).entries,
    ).toHaveLength(0);
    expect((await s.service.leaderboard(player, { size: 12, period: 'all' })).entries).toHaveLength(
      1,
    );
  });
  it('rejects foreign owners, reverse moves, excessive chunks, early simulation and expired runs', async () => {
    const s = setup();
    const run = await s.service.create(player, request);
    await expect(s.service.get({ id: 2, name: 'Other' }, { runId: run.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const directions of [['left'], ['teleport'], Array(201).fill('right'), []]) {
      await expect(
        s.service.submit(player, { runId: run.id, revision: 0, directions }),
      ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    }
    await expect(
      s.service.submit(player, { runId: run.id, revision: 0, directions: Array(10).fill('right') }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await s.service.get(player, { runId: run.id })).revision).toBe(0);
    s.advance(7200001);
    await expect(
      s.service.submit(player, { runId: run.id, revision: 0, directions: ['right'] }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
  });
  it('uses compare-and-swap and rejects actions after death without committing a partial replay', async () => {
    const s = setup();
    const run = await s.service.create(player, request);
    s.advance(5000);
    const invalid = { runId: run.id, revision: 0, directions: Array(20).fill('right') };
    await expect(s.service.submit(player, invalid)).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await s.service.get(player, { runId: run.id })).state.ticks).toBe(0);
    const outcomes = await Promise.allSettled([
      s.service.submit(player, { runId: run.id, revision: 0, directions: ['right'] }),
      s.service.submit(player, { runId: run.id, revision: 0, directions: ['up'] }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await s.service.get(player, { runId: run.id })).revision).toBe(1);
  });
  it('keeps one best result per player and returns own rank outside the top 50', async () => {
    const s = setup();
    // Populate already-verified fixture rows through the adapter's CAS, not the public API.
    for (let i = 1; i <= 52; i++) {
      const owner = { id: i, name: `Player ${i}` };
      const run = await s.service.create(owner, request);
      const stored = await s.repository.get(run.id);
      if (!stored) throw new Error('Missing fixture');
      stored.state.score = i * 10;
      stored.state.status = 'over';
      stored.status = 'verified';
      stored.revision++;
      await s.repository.save(stored, 0);
    }
    const board = await s.service.leaderboard(player, { size: 12, period: 'all' });
    expect(board.entries).toHaveLength(50);
    expect(board.me?.rank).toBe(52);
    expect(board.entries[0]?.score).toBe(520);
    const another = await s.service.create(
      { id: 52, name: 'Player 52' },
      { ...request, requestId: 'snake-request-0002' },
    );
    const stored = await s.repository.get(another.id);
    if (!stored) throw new Error('Missing fixture');
    stored.state.score = 500;
    stored.state.status = 'over';
    stored.status = 'verified';
    stored.revision++;
    await s.repository.save(stored, 0);
    expect(
      (await s.service.leaderboard(player, { size: 12, period: 'all' })).entries.filter(
        (e) => e.playerId === 52,
      ),
    ).toHaveLength(1);
  });
  it('validates sizes and rate limits starts', async () => {
    const s = setup();
    await expect(s.service.create(player, { ...request, size: 13 })).rejects.toMatchObject({
      code: 'BAD_INPUT',
    });
    for (let i = 0; i < 10; i++)
      await s.service.create(player, {
        ...request,
        requestId: `snake-start-${String(i).padStart(8, '0')}`,
      });
    await expect(s.service.create(player, request)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });
});
