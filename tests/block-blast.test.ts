import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import {
  BLOCK_MAX_CHUNK,
  BLOCK_SHAPES,
  type BlockMove,
  type BlockState,
  blockPlacements,
  canPlaceBlock,
  createBlockBlast,
  generateBlockTray,
  moveBlockBlast,
  placeBlock,
} from '../src/games/block-blast/engine.ts';
import { BlockService } from '../src/server/domain/block-blast.ts';
import { SqlBlockRepository } from '../src/server/platform/sql-block-blast.ts';
import { decodeBlockMove, decodeBlockState } from '../src/shared/block-blast.ts';
import { parseLaunch } from '../src/shared/launch.ts';

function firstMove(state: BlockState): BlockMove {
  for (let slot = 0; slot < 3; slot++) {
    const piece = state.tray[slot];
    if (piece === null || piece === undefined) continue;
    const p = blockPlacements(state.board, piece)[0];
    if (p) return { slot, ...p };
  }
  throw new Error('No legal move');
}
describe('Block Blast core and solvable deals', () => {
  it('starts deterministically, supports its direct link and validates untrusted states and coordinates', () => {
    const state = createBlockBlast(123);
    expect(state).toEqual(createBlockBlast(123));
    expect(state.board).toEqual(Array(64).fill(0));
    expect(state.tray).toHaveLength(3);
    expect(state.score).toBe(0);
    expect(parseLaunch('game_block-blast')).toEqual({ view: 'game', game: 'block-blast' });
    expect(decodeBlockState(state)).toEqual(state);
    for (const patch of [
      { board: Array(63).fill(0) },
      { board: Array(64).fill(7) },
      { tray: [0, 0, 999] },
      { rng: -1 },
      { score: 0.5 },
      { status: 'won' },
    ])
      expect(() => decodeBlockState({ ...state, ...patch })).toThrow();
    for (const bad of [
      { slot: 3, x: 0, y: 0 },
      { slot: 0, x: -1, y: 0 },
      { slot: 0, x: 0.5, y: 0 },
      null,
    ])
      expect(() => decodeBlockMove(bad)).toThrow();
  });
  it('rejects overlapping, out-of-bounds and reused placements without mutation', () => {
    const state = createBlockBlast(321);
    const before = structuredClone(state);
    for (const move of [
      { slot: 0, x: -1, y: 0 },
      { slot: 3, x: 0, y: 0 },
      { slot: 0, x: 8, y: 0 },
      { slot: 0, x: 0.1, y: 0 },
    ]) {
      expect(moveBlockBlast(state, move)).toBe(false);
      expect(state).toEqual(before);
    }
    expect(moveBlockBlast(state, { slot: 0, x: 0, y: 0 })).toBe(true);
    const after = structuredClone(state);
    expect(moveBlockBlast(state, { slot: 0, x: 0, y: 0 })).toBe(false);
    expect(moveBlockBlast(state, { slot: 1, x: 0, y: 0 })).toBe(false);
    expect(state).toEqual(after);
  });
  it('counts intersecting lines simultaneously and awards blocks, multi-line and all-clear points', () => {
    const state = createBlockBlast(1);
    for (let i = 1; i < 8; i++) {
      state.board[i] = 1;
      state.board[i * 8] = 2;
    }
    state.tray = [0, 9, 12];
    expect(moveBlockBlast(state, { slot: 0, x: 0, y: 0 })).toBe(true);
    expect(state.score).toBe(1 + 40 + 100);
    expect(state.lines).toBe(2);
    expect(state.clears).toBe(1);
    expect(state.board).toEqual(Array(64).fill(0));
    state.tray = [9, 0, 0];
    for (let y = 0; y < 2; y++) for (let x = 2; x < 8; x++) state.board[y * 8 + x] = 1;
    moveBlockBlast(state, { slot: 0, x: 0, y: 0 });
    expect(state.score).toBe(141 + 4 + 40 + 100);
    expect(state.lines).toBe(4);
  });
  it('independently replays all three witness moves on sparse, dense and adversarial stable boards', () => {
    let rng = 123456;
    for (let sample = 0; sample < 200; sample++) {
      const density = (sample % 10) / 10;
      const board = Array.from({ length: 64 }, () => {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        return rng / 0x100000000 < density ? 1 : 0;
      });
      // A diagonal of empty cells ensures no row/column is already complete,
      // including the worst case with just eight isolated single-cell holes.
      for (let i = 0; i < 8; i++) board[i * 8 + i] = 0;
      const before = [...board];
      const deal = generateBlockTray(board, rng);
      expect(board).toEqual(before);
      expect(deal).toEqual(generateBlockTray(board, rng));
      expect(new Set(deal.solution.map((m) => m.slot)).size).toBe(3);
      const simulated = [...board];
      for (const move of deal.solution) {
        const piece = deal.tray[move.slot];
        expect(piece).toBeDefined();
        expect(canPlaceBlock(simulated, piece ?? -1, move.x, move.y)).toBe(true);
        expect(placeBlock(simulated, piece ?? -1, move.x, move.y)).not.toBeNull();
      }
    }
  });
  it('often requires clearing to unlock another piece on a constrained board', () => {
    const board = Array<number>(64).fill(1);
    for (let i = 0; i < 8; i++) board[i * 8 + i] = 0;
    let dependentDeals = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const deal = generateBlockTray(board, seed);
      if (deal.tray.some((piece) => blockPlacements(board, piece).length === 0)) dependentDeals++;
    }
    expect(dependentDeals).toBeGreaterThanOrEqual(24);
  });
  it('refills only after all three pieces and ends after a bad placement blocks the remainder', () => {
    const state = createBlockBlast(123);
    const board = [...state.board];
    // Regenerate the initial deal from its original RNG for its independent witness.
    const deal = generateBlockTray(board, 123);
    const originalTray = [...state.tray];
    for (const move of deal.solution.slice(0, 2)) expect(moveBlockBlast(state, move)).toBe(true);
    expect(state.tray.filter((p) => p !== null)).toHaveLength(1);
    const last = deal.solution[2];
    if (!last) throw new Error('Missing move');
    expect(moveBlockBlast(state, last)).toBe(true);
    expect(state.tray.every((p) => p !== null)).toBe(true);
    expect(state.moves).toBe(3);
    expect(originalTray).toEqual(deal.tray);
    state.board = Array(64)
      .fill(0)
      .map((_, i) => (((i % 8) + Math.floor(i / 8)) % 2 === 0 ? 1 : 0));
    state.tray = [0, 9, null];
    expect(moveBlockBlast(state, { slot: 0, x: 1, y: 0 })).toBe(true);
    expect(state.status).toBe('over');
    expect(moveBlockBlast(state, { slot: 1, x: 0, y: 0 })).toBe(false);
  });
  it('all shapes fit the declared bounds and remain connected', () => {
    for (const shape of BLOCK_SHAPES) {
      const visited = new Set<string>();
      const queue = [shape.cells[0]];
      for (const cell of queue) {
        if (!cell || visited.has(`${cell.x},${cell.y}`)) continue;
        visited.add(`${cell.x},${cell.y}`);
        for (const neighbour of shape.cells)
          if (
            Math.abs(neighbour.x - cell.x) + Math.abs(neighbour.y - cell.y) === 1 &&
            !visited.has(`${neighbour.x},${neighbour.y}`)
          )
            queue.push(neighbour);
      }
      expect(visited.size).toBe(shape.cells.length);
      expect(Math.max(...shape.cells.map((c) => c.x)) + 1).toBe(shape.width);
      expect(Math.max(...shape.cells.map((c) => c.y)) + 1).toBe(shape.height);
    }
  });
});

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});
function setup() {
  const local = localRepository();
  handles.push(local);
  let now = Date.UTC(2026, 10, 3, 12);
  const repo = new SqlBlockRepository(local.db);
  return {
    ...local,
    repo,
    service: new BlockService(repo, { now: () => now, seed: () => 123 }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const player = { id: 1, name: 'Игрок' };
describe('authoritative Block Blast results', () => {
  it('replays moves, ignores forged scores/identity and retries the same receipt exactly once', async () => {
    const s = setup();
    const run = await s.service.create(player, { requestId: 'block_request_123456', playerId: 99 });
    expect(await s.service.create(player, { requestId: 'block_request_123456' })).toEqual(run);
    const simulated = structuredClone(run.state);
    const moves: BlockMove[] = [];
    for (let i = 0; i < 9 && simulated.status === 'playing'; i++) {
      const move = firstMove(simulated);
      moves.push(move);
      moveBlockBlast(simulated, move);
    }
    const input = {
      runId: run.id,
      revision: 0,
      moves,
      finish: true,
      score: 999999,
      state: { score: 999999 },
      playerId: 99,
    };
    const result = await s.service.submit(player, input);
    expect(result.state).toEqual(simulated);
    expect(result.status).toBe('verified');
    expect(await s.service.submit(player, input)).toEqual(result);
    expect((await s.repo.get(run.id))?.verifiedOrder).toBe(1);
    expect((await s.service.leaderboard(player, { period: 'all' })).me).toMatchObject({
      playerId: 1,
      score: simulated.score,
    });
    await expect(s.service.submit(player, { ...input, revision: 1 })).rejects.toThrow();
  });
  it('rejects foreign owners, invalid batches, stale revisions, expiry and excessive starts', async () => {
    const s = setup();
    const run = await s.service.create(player, { requestId: 'block_request_123456' });
    const input = { runId: run.id, revision: 0, moves: [firstMove(run.state)], finish: false };
    await expect(s.service.get({ id: 2, name: 'Другой' }, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(s.service.submit({ id: 2, name: 'Другой' }, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const patch of [
      { moves: [] },
      { moves: Array(BLOCK_MAX_CHUNK + 1).fill(input.moves[0]) },
      { moves: [{ slot: -1, x: 0, y: 0 }] },
      { moves: [input.moves[0], input.moves[0]] },
      { revision: 4 },
      { finish: 'true' },
    ])
      await expect(s.service.submit(player, { ...input, ...patch })).rejects.toThrow();
    expect((await s.repo.get(run.id))?.revision).toBe(0);
    for (let i = 1; i < 10; i++)
      await s.service.create(player, { requestId: `block_other_request_12345${i}` });
    await expect(
      s.service.create(player, { requestId: 'block_request_12345x' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    s.advance(86400001);
    await expect(s.service.submit(player, input)).rejects.toMatchObject({ code: 'EXPIRED' });
    await expect(
      s.service.leaderboard(player, { period: 'all', groupId: -100 }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('uses CAS for concurrent writes, resumes chunks and automatically verifies a lost game', async () => {
    const s = setup();
    let run = await s.service.create(player, { requestId: 'block_request_123456' });
    const outcomes = await Promise.allSettled(
      [false, true].map((finish) =>
        s.service.submit(player, {
          runId: run.id,
          revision: 0,
          moves: [firstMove(run.state)],
          finish,
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    run = await s.service.create(player, { requestId: 'block_request_123457' });
    for (let chunk = 0; chunk < 100 && run.status === 'active'; chunk++) {
      const simulated = structuredClone(run.state);
      const moves: BlockMove[] = [];
      while (moves.length < 6 && simulated.status === 'playing') {
        const move = firstMove(simulated);
        moves.push(move);
        moveBlockBlast(simulated, move);
      }
      run = await s.service.submit(player, {
        runId: run.id,
        revision: run.revision,
        moves,
        finish: false,
      });
      expect(run.state).toEqual(simulated);
      expect(await s.service.get(player, { runId: run.id })).toEqual(run);
    }
    expect(run.status).toBe('verified');
    expect(run.state.status).toBe('over');
    expect((await s.repo.pendingResults(10)).map((r) => r.id)).toContain(run.id);
  });
  it('ranks one best result per player, breaks ties by start time/id, includes own rank beyond 50 and filters weeks', async () => {
    const s = setup();
    for (let id = 1; id <= 55; id++) {
      const run = await s.service.create(
        { id, name: `P${id}` },
        { requestId: 'block_fixture_1234567' },
      );
      await s.db.run("UPDATE block_blast_runs SET status='verified',score=:score WHERE id=:id", {
        ':score': id * 100,
        ':id': run.id,
      });
    }
    const extra = await s.service.create(player, { requestId: 'block_fixture_1234568' });
    await s.db.run("UPDATE block_blast_runs SET status='verified',score=50 WHERE id=:id", {
      ':id': extra.id,
    });
    const board = await s.service.leaderboard(player, { period: 'all' });
    expect(board.entries).toHaveLength(50);
    expect(board.me).toMatchObject({ rank: 55, score: 100 });
    await s.db.run('UPDATE block_blast_runs SET score=5500 WHERE player_id=54');
    expect(
      (await s.service.leaderboard(player, { period: 'week' })).entries
        .slice(0, 2)
        .map((e) => e.playerId),
    ).toEqual([54, 55]);
    s.advance(7 * 86400000);
    expect((await s.service.leaderboard(player, { period: 'week' })).entries).toHaveLength(0);
    expect((await s.service.leaderboard(player, { period: 'all' })).entries).toHaveLength(50);
  });
});
