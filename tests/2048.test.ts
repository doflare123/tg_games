import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import {
  canMove2048,
  create2048,
  DIRECTIONS,
  type Direction,
  LEGACY_2048_RULESET,
  minimum2048Tile,
  move2048,
  RULESET_2048,
  type State2048,
} from '../src/games/2048/engine.ts';
import { Service2048 } from '../src/server/domain/2048.ts';
import { Sql2048Repository } from '../src/server/platform/sql-2048.ts';
import { decodeState2048 } from '../src/shared/2048.ts';
import { parseLaunch } from '../src/shared/launch.ts';

function state(board: number[]): State2048 {
  return { version: 2, board, score: 0, moves: 0, rng: 123, status: 'playing' };
}
function validMove(s: State2048): Direction {
  for (const direction of DIRECTIONS) if (move2048(structuredClone(s), direction)) return direction;
  throw new Error('No move');
}
describe('2048 core', () => {
  it('starts deterministically with exactly two tiles and no points', () => {
    const s = create2048(123);
    expect(s).toEqual(create2048(123));
    expect(s.board.filter(Boolean)).toHaveLength(2);
    expect(s.board.every((v) => v === 0 || v === 2 || v === 4)).toBe(true);
    expect(s.score).toBe(0);
  });
  it.each(DIRECTIONS)('merges once per tile in direction %s', (direction) => {
    const horizontal = direction === 'left' || direction === 'right';
    const board = Array<number>(16).fill(0);
    for (let i = 0; i < 4; i++) board[horizontal ? i : i * 4] = 2;
    const s = state(board);
    expect(move2048(s, direction)).toBe(true);
    const indices = horizontal
      ? direction === 'left'
        ? [0, 1]
        : [2, 3]
      : direction === 'up'
        ? [0, 4]
        : [8, 12];
    expect(indices.map((i) => s.board[i])).toEqual([4, 4]);
    expect(s.score).toBe(8);
    expect(s.moves).toBe(1);
    expect(s.board.filter(Boolean)).toHaveLength(3);
  });
  it('does not chain merge and does not change RNG or score on a no-op', () => {
    const s = state([2, 2, 4, 0, ...Array<number>(12).fill(0)]);
    move2048(s, 'left');
    expect(s.board.slice(0, 2)).toEqual([4, 4]);
    expect(s.score).toBe(4);
    const stable = state([2, 0, 0, 0, ...Array<number>(12).fill(0)]);
    const before = structuredClone(stable);
    expect(move2048(stable, 'left')).toBe(false);
    expect(stable).toEqual(before);
  });
  it('detects a blocked board and continues after 2048 and 20000 moves', () => {
    const blocked = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
    expect(canMove2048(blocked)).toBe(false);
    const s = state([1024, 1024, ...Array<number>(14).fill(0)]);
    move2048(s, 'left');
    expect(s.score).toBe(2048);
    expect(s.status).toBe('playing');
    s.moves = 19999;
    move2048(s, validMove(s));
    expect(s.status).toBe('playing');
    expect(s.moves).toBe(20000);
    expect(move2048(s, validMove(s))).toBe(true);
    expect(s.moves).toBe(20001);
  });
  it('validates saved tiles and supports the direct launch', () => {
    expect(() => decodeState2048({ ...create2048(1), board: Array(16).fill(3) })).toThrow();
    expect(decodeState2048({ ...create2048(1), moves: 20001 }).moves).toBe(20001);
    expect(parseLaunch('game_2048')).toEqual({ view: 'game', game: '2048' });
  });
  it('ends immediately when spawning the last tile leaves no legal moves', () => {
    const s = state([2, 2, 8, 16, 8, 16, 32, 64, 16, 32, 64, 128, 32, 64, 128, 256]);
    expect(move2048(s, 'left')).toBe(true);
    expect(s.status).toBe('over');
    expect(canMove2048(s.board)).toBe(false);
  });
  it.each([
    [4096, 2],
    [8192, 4],
    [16384, 8],
    [32768, 16],
  ])('grades spawns slowly at tile %i', (largest, minimum) => {
    const s = state([largest, ...Array<number>(15).fill(0)]);
    expect(minimum2048Tile(s)).toBe(minimum);
    move2048(s, 'right');
    expect(
      s.board.filter((v) => v && v !== largest).every((v) => v === minimum || v === minimum * 2),
    ).toBe(true);
    const classic = { ...state([largest, ...Array<number>(15).fill(0)]), version: 1 as const };
    expect(minimum2048Tile(classic)).toBe(2);
    move2048(classic, 'right');
    expect(classic.board.filter((v) => v && v !== largest).every((v) => v === 2 || v === 4)).toBe(
      true,
    );
  });
  it('keeps a precise result when the numeric representation is exhausted', () => {
    const s = state([2, 2, ...Array<number>(14).fill(0)]);
    s.score = Number.MAX_SAFE_INTEGER - 1;
    expect(move2048(s, 'left')).toBe(true);
    expect(s.status).toBe('over');
    expect(Number.isSafeInteger(s.score)).toBe(true);
    expect(decodeState2048(s)).toEqual(s);
  });
});

const locals: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const local of locals.splice(0)) local.close();
});
function setup() {
  const local = localRepository();
  locals.push(local);
  const repo = new Sql2048Repository(local.db);
  let now = Date.UTC(2026, 9, 31);
  return {
    ...local,
    repo,
    service: new Service2048(repo, { now: () => now, seed: () => 123 }),
    advance(ms: number) {
      now += ms;
    },
  };
}
const player = { id: 1, name: 'Игрок' };
describe('authoritative 2048 rankings', () => {
  it('keeps legacy saves and rankings separate and replays extended progressive games', async () => {
    const s = setup();
    const legacy = await s.service.create(player, {
      requestId: 'legacy_request_1234567',
      ruleset: LEGACY_2048_RULESET,
    });
    expect(legacy.state.version).toBe(1);
    const oldState = {
      board: [8192, ...Array<number>(15).fill(0)],
      rng: 123,
      score: 500,
      moves: 19999,
      status: 'playing',
    };
    await s.db.run('UPDATE puzzle2048_runs SET state_json=:state WHERE id=:id', {
      ':id': legacy.id,
      ':state': JSON.stringify(oldState),
    });
    const old = await s.service.submit(player, {
      runId: legacy.id,
      revision: 0,
      moves: ['right'],
      finish: true,
    });
    expect(old.state.version).toBe(1);
    expect(old.state.board.some((v) => v === 2 || v === 4)).toBe(true);
    expect((await s.service.leaderboard(player, { period: 'all' })).me).toBeNull();
    expect(
      (await s.service.leaderboard(player, { period: 'all', ruleset: LEGACY_2048_RULESET })).me
        ?.runId,
    ).toBe(legacy.id);
    const current = await s.service.create(player, { requestId: 'current_request_1234567' });
    expect(current.ruleset).toBe(RULESET_2048);
    const snapshot = {
      ...current.state,
      board: [8192, ...Array<number>(15).fill(0)],
      score: 500,
      moves: 20001,
    };
    await s.db.run('UPDATE puzzle2048_runs SET state_json=:state,revision=20001 WHERE id=:id', {
      ':id': current.id,
      ':state': JSON.stringify(snapshot),
    });
    const extended = await s.service.submit(player, {
      runId: current.id,
      revision: 20001,
      moves: ['right'],
      finish: true,
    });
    expect(extended.state.moves).toBe(20002);
    expect(extended.state.board.some((v) => v === 4 || v === 8)).toBe(true);
    expect((await s.service.leaderboard(player, { period: 'all' })).me?.runId).toBe(current.id);
    expect(
      (await s.service.leaderboard(player, { period: 'all', ruleset: LEGACY_2048_RULESET })).me
        ?.runId,
    ).toBe(legacy.id);
  });
  it('replays moves, ignores claimed scores and identities, retries idempotently and prevents post-finish changes', async () => {
    const s = setup();
    const initial = await s.service.create(player, {
      requestId: 'request_1234567890',
      playerId: 99,
    });
    expect(await s.service.create(player, { requestId: 'request_1234567890' })).toEqual(initial);
    const simulated = structuredClone(initial.state);
    const moves: Direction[] = [];
    for (let i = 0; i < 20; i++) {
      const direction = validMove(simulated);
      moves.push(direction);
      move2048(simulated, direction);
    }
    const input = {
      runId: initial.id,
      revision: 0,
      moves,
      finish: true,
      score: 999999999,
      playerId: 99,
    };
    const result = await s.service.submit(player, input);
    expect(result.state).toEqual(simulated);
    expect(result.status).toBe('verified');
    expect(await s.service.submit(player, input)).toEqual(result);
    await expect(s.service.submit(player, { ...input, revision: 1 })).rejects.toThrow();
    const board = await s.service.leaderboard(player, { period: 'all' });
    expect(board.me?.score).toBe(simulated.score);
    expect(board.me?.playerId).toBe(player.id);
    expect(board.entries).toHaveLength(1);
  });
  it('rejects foreign owners, invalid and oversized moves, stale revisions, expiry and excess starts', async () => {
    const s = setup();
    const run = await s.service.create(player, { requestId: 'request_1234567890' });
    const input = { runId: run.id, revision: 0, moves: [validMove(run.state)], finish: false };
    await expect(s.service.get({ id: 2, name: 'Другой' }, { runId: run.id })).rejects.toThrow();
    await expect(s.service.submit({ id: 2, name: 'Другой' }, input)).rejects.toThrow();
    await expect(
      s.service.submit(player, { ...input, moves: Array(129).fill('left') }),
    ).rejects.toThrow();
    await expect(s.service.submit(player, { ...input, moves: ['diagonal'] })).rejects.toThrow();
    await expect(s.service.submit(player, { ...input, finish: 'true' })).rejects.toThrow();
    await expect(s.service.submit(player, { ...input, moves: [] })).rejects.toThrow();
    await expect(s.service.submit(player, { ...input, revision: 3 })).rejects.toThrow();
    await expect(
      s.service.submit(player, { ...input, moves: ['left', 'left', 'left', 'left', 'left'] }),
    ).rejects.toThrow();
    expect((await s.service.get(player, { runId: run.id })).revision).toBe(0);
    for (let i = 1; i < 10; i++)
      await s.service.create(player, { requestId: `request_123456789${i}` });
    await expect(s.service.create(player, { requestId: 'request_123456789x' })).rejects.toThrow();
    s.advance(86400001);
    await expect(s.service.submit(player, input)).rejects.toThrow();
  });
  it('uses CAS for concurrent submissions and preserves accepted state', async () => {
    const s = setup();
    const run = await s.service.create(player, { requestId: 'request_1234567890' });
    const outcomes = await Promise.allSettled(
      [false, true].map((finish) =>
        s.service.submit(player, {
          runId: run.id,
          revision: 0,
          moves: [validMove(run.state)],
          finish,
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await s.repo.get(run.id))?.revision).toBe(1);
  });
  it('accepts sequential chunks, automatically records a finished game, and rejects old rules', async () => {
    const s = setup();
    let run = await s.service.create(player, { requestId: 'request_1234567890' });
    while (run.status === 'active') {
      const simulated = structuredClone(run.state);
      const moves: Direction[] = [];
      while (moves.length < 128 && simulated.status === 'playing') {
        const direction = validMove(simulated);
        moves.push(direction);
        move2048(simulated, direction);
      }
      run = await s.service.submit(player, {
        runId: run.id,
        revision: run.revision,
        moves,
        finish: false,
      });
      expect(run.state).toEqual(simulated);
    }
    expect(run.state.status).toBe('over');
    expect((await s.service.leaderboard(player, { period: 'all' })).me?.score).toBe(
      run.state.score,
    );
    const old = await s.service.create(player, { requestId: 'request_123456789x' });
    await s.db.run("UPDATE puzzle2048_runs SET ruleset='old' WHERE id=:id", { ':id': old.id });
    await expect(
      s.service.submit(player, { runId: old.id, revision: 0, moves: [], finish: true }),
    ).rejects.toThrow();
  });
  it('ranks one best attempt per player, breaks ties consistently and includes own position beyond top 50', async () => {
    const s = setup();
    // Seed SQL fixtures to exercise ranking independently from the engine verifier.
    for (let i = 1; i <= 55; i++) {
      const run = await s.service.create(
        { id: i, name: `Игрок ${i}` },
        { requestId: 'request_1234567890' },
      );
      await s.db.run("UPDATE puzzle2048_runs SET score=:score,status='verified' WHERE id=:id", {
        ':score': i * 100,
        ':id': run.id,
      });
    }
    const extra = await s.service.create(player, { requestId: 'request_123456789x' });
    await s.db.run("UPDATE puzzle2048_runs SET score=50,status='verified' WHERE id=:id", {
      ':id': extra.id,
    });
    const board = await s.service.leaderboard(player, { period: 'week' });
    expect(board.entries).toHaveLength(50);
    expect(board.entries[0]?.playerId).toBe(55);
    expect(board.me).toMatchObject({ rank: 55, score: 100 });
    await s.db.run('UPDATE puzzle2048_runs SET score=5500 WHERE player_id=54');
    expect(
      (await s.service.leaderboard(player, { period: 'all' })).entries
        .slice(0, 2)
        .map((r) => r.playerId),
    ).toEqual([54, 55]);
    s.advance(7 * 86400000);
    expect((await s.service.leaderboard(player, { period: 'week' })).entries).toHaveLength(0);
    expect((await s.service.leaderboard(player, { period: 'all' })).me?.rank).toBe(55);
  });
});
