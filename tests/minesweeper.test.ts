import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import {
  actMines,
  createMines,
  LEVELS,
  MINE_LIMIT_MS,
  MINE_RULESET,
  type MineState,
  mineBoard,
  neighbors,
  SIZES,
} from '../src/games/minesweeper/engine.ts';
import { MinesweeperService } from '../src/server/domain/minesweeper.ts';
import { SqlMineRepository } from '../src/server/platform/sql-minesweeper.ts';
import { decodeMineLeaderboard, decodeMineRun } from '../src/shared/minesweeper.ts';

describe('Minesweeper core', () => {
  it.each(SIZES)(
    'creates %s with exact mine counts, safe first clicks and deterministic adjacency',
    (size) => {
      const { width, height, mines } = LEVELS[size];
      for (const first of [0, width - 1, width * height - 1, Math.floor((width * height) / 2)]) {
        const state = createMines(size, 12345, first);
        expect(state).toEqual(createMines(size, 12345, first));
        expect(state.cells).toHaveLength(width * height);
        expect(state.cells.filter((value) => value === -1)).toHaveLength(mines);
        expect(state.cells[first]).toBe(0);
        expect(state.revealed[first]).toBe(true);
        for (const i of neighbors(size, first)) expect(state.cells[i]).not.toBe(-1);
        state.cells.forEach((value, i) => {
          if (value !== -1)
            expect(value).toBe(neighbors(size, i).filter((n) => state.cells[n] === -1).length);
          if (state.revealed[i] && value === 0)
            for (const n of neighbors(size, i)) expect(state.revealed[n]).toBe(true);
        });
        expect(state.status).toBe('playing');
      }
    },
  );
  it('does not wrap neighbors across row boundaries', () => {
    expect(neighbors('9x9', 0)).toEqual([1, 9, 10]);
    expect(neighbors('9x9', 8)).toEqual([7, 16, 17]);
  });
  it('toggles flags, blocks flagged reveals and wins only by opening all safe cells', () => {
    const state = createMines('9x9', 42, 0);
    const safe = state.cells.findIndex((value, i) => value !== -1 && !state.revealed[i]);
    actMines(state, 'flag', safe);
    actMines(state, 'reveal', safe);
    expect(state.revealed[safe]).toBe(false);
    expect(mineBoard(state).cells[safe]).toBe(-3);
    actMines(state, 'flag', safe);
    for (let i = 0; i < state.cells.length; i++)
      if (state.cells[i] !== -1) actMines(state, 'reveal', i);
    expect(state.status).toBe('won');
    expect(state.flags.some(Boolean)).toBe(false);
    const finished = structuredClone(state);
    actMines(state, 'flag', 1);
    expect(state).toEqual(finished);
  });
  function chordFixture(): { state: MineState; cell: number; around: number[] } {
    const state = createMines('9x9', 42, 0);
    const cell = state.cells.findIndex((v) => v > 0 && v < 3);
    state.revealed.fill(false);
    state.revealed[cell] = true;
    return { state, cell, around: neighbors(state.size, cell) };
  }
  it('opens neighbors with correct flags and loses with misplaced flags', () => {
    const { state, cell, around } = chordFixture();
    actMines(state, 'chord', cell);
    expect(state.revealed.filter(Boolean)).toHaveLength(1);
    for (const i of around) if (state.cells[i] === -1) actMines(state, 'flag', i);
    actMines(state, 'chord', cell);
    expect(state.status).not.toBe('lost');
    for (const i of around) if (state.cells[i] !== -1) expect(state.revealed[i]).toBe(true);
    const wrong = chordFixture();
    const safe = wrong.around.filter((i) => wrong.state.cells[i] !== -1);
    for (const i of safe.slice(0, wrong.state.cells[wrong.cell])) actMines(wrong.state, 'flag', i);
    actMines(wrong.state, 'chord', wrong.cell);
    expect(wrong.state.status).toBe('lost');
  });
  it('hides covered mine locations and rejects invalid cells', () => {
    const state = createMines('9x9', 42, 0);
    expect(mineBoard(state).cells.includes(-1)).toBe(false);
    for (const i of [-1, 81, 0.5, NaN]) expect(() => actMines(state, 'reveal', i)).toThrow();
    actMines(state, 'reveal', state.cells.indexOf(-1));
    expect(state.status).toBe('lost');
    expect(mineBoard(state).cells.filter((v) => v === -1)).toHaveLength(10);
  });
});

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
function setup() {
  const local = localRepository();
  handles.push(local);
  const repository = new SqlMineRepository(local.db);
  let now = Date.UTC(2026, 9, 31, 12);
  const service = new MinesweeperService(repository, { now: () => now, seed: () => 42 });
  return {
    database: local.database,
    repository,
    service,
    player: { id: 42, name: 'Игрок' },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const request = { size: '9x9', firstCell: 0, requestId: 'minesweeper_test_01' } as const;
describe('Authoritative Minesweeper runs and SQL rankings', () => {
  it('preserves flags placed before the first reveal, including across retries and subsequent moves', async () => {
    const { service, repository, player, advance } = setup();
    const input = { ...request, flags: [10, 1] };
    const run = await service.create(player, input);
    expect(run.board.cells[0]).toBe(0);
    expect(run.board.cells[1]).toBe(-3);
    expect(run.board.cells[10]).toBe(-3);
    expect((await repository.get(run.id))?.initialFlags).toEqual([1, 10]);
    expect(await service.create(player, { ...input, flags: [1, 10] })).toEqual(run);
    advance(1000);
    const unflagged = await service.move(player, {
      runId: run.id,
      revision: 0,
      action: 'flag',
      cell: 1,
    });
    expect(unflagged.board.cells[1]).toBe(-2);
    expect((await repository.get(run.id))?.initialFlags).toEqual([1, 10]);
    expect(await service.create(player, input)).toEqual(unflagged);
    await expect(service.create(player, { ...input, flags: [10] })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const opened = await service.move(player, {
      runId: run.id,
      revision: 1,
      action: 'reveal',
      cell: 1,
    });
    expect(opened.board.cells[1]).toBeGreaterThanOrEqual(0);
  });
  it('rejects malformed initial flags and reads legacy saved runs without initial flags', async () => {
    const { service, repository, player, database } = setup();
    for (const flags of [null, '1', [0], [1, 1], [-1], [81], [0.5], ['1']])
      await expect(service.create(player, { ...request, flags })).rejects.toMatchObject({
        code: 'BAD_INPUT',
      });
    const run = await service.create(player, request);
    database
      .prepare(
        "UPDATE minesweeper_runs SET state_json=json_remove(state_json,'$.initialFlags') WHERE id=?",
      )
      .run(run.id);
    const stored = await repository.get(run.id);
    expect(stored?.initialFlags).toEqual([]);
  });
  it.each(SIZES)(
    'verifies %s victory using server time and ignores forged result fields',
    async (size) => {
      const { service, repository, player, advance } = setup();
      let run = await service.create(player, { ...request, size, playerId: 999 });
      expect(decodeMineRun(run)).toEqual(run);
      expect(run.id.startsWith('42:mine:')).toBe(true);
      expect(JSON.stringify(run)).not.toMatch(/"seed"|"revealed"|"flags"/);
      expect(run.board.cells.includes(-1)).toBe(false);
      const stored = await repository.get(run.id);
      expect(stored).not.toBeNull();
      advance(12345);
      for (let cell = 0; cell < run.board.cells.length; cell++) {
        if (stored?.state.cells[cell] === -1 || (run.board.cells[cell] ?? 0) >= 0) continue;
        run = await service.move(player, {
          runId: run.id,
          revision: run.revision,
          cell,
          action: 'reveal',
          elapsedMs: 1,
          status: 'won',
        });
      }
      expect(run.board.status).toBe('won');
      expect(run.elapsedMs).toBe(12345);
      const board = await service.leaderboard(player, { size, period: 'all' });
      expect(decodeMineLeaderboard(board)).toEqual(board);
      expect(board.me).toMatchObject({ rank: 1, elapsedMs: 12345, playerId: 42 });
      for (const other of SIZES.filter((s) => s !== size))
        expect((await service.leaderboard(player, { size: other, period: 'all' })).entries).toEqual(
          [],
        );
    },
  );
  it('excludes active and lost runs and retries without changing final time', async () => {
    const { service, repository, player, advance } = setup();
    const run = await service.create(player, request);
    expect(await service.create(player, request)).toEqual(run);
    expect((await service.leaderboard(player, { size: '9x9', period: 'all' })).me).toBeNull();
    const stored = await repository.get(run.id);
    const input = {
      runId: run.id,
      revision: 0,
      action: 'reveal',
      cell: stored?.state.cells.indexOf(-1),
    };
    advance(2000);
    const lost = await service.move(player, input);
    expect(lost.board.status).toBe('lost');
    advance(5000);
    expect(await service.move(player, input)).toEqual(lost);
    expect((await service.leaderboard(player, { size: '9x9', period: 'all' })).me).toBeNull();
    await expect(service.move(player, { ...input, revision: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(service.create(player, { ...request, firstCell: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('validates input, ownership, revisions, expiry and the start rate', async () => {
    const { service, player, advance } = setup();
    const run = await service.create(player, request);
    const input = { runId: run.id, revision: 0, cell: 80, action: 'flag' };
    await expect(service.move({ id: 99, name: 'Чужой' }, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const invalid of [
      { action: 'win' },
      { cell: 81 },
      { cell: -1 },
      { cell: 0.5 },
      { revision: 1 },
      { revision: '0' },
    ])
      await expect(service.move(player, { ...input, ...invalid })).rejects.toBeInstanceOf(Error);
    for (const invalid of [{ size: '8x8' }, { firstCell: 81 }, { requestId: '../bad-path-key__' }])
      await expect(service.create(player, { ...request, ...invalid })).rejects.toMatchObject({
        code: 'BAD_INPUT',
      });
    await expect(
      service.leaderboard(player, { size: '9x9', period: 'month' }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
    for (let i = 1; i < 10; i++)
      await service.create(player, { ...request, requestId: `start_limit_test_${i}` });
    await expect(
      service.create(player, { ...request, requestId: 'start_limit_test_10' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    advance(MINE_LIMIT_MS);
    await expect(service.move(player, input)).rejects.toMatchObject({ code: 'EXPIRED' });
  });
  it('arbitrates concurrent moves and recovers retries after service restart', async () => {
    const { service, repository, player } = setup();
    const run = await service.create(player, request);
    const input = { runId: run.id, revision: 0, cell: 80, action: 'flag' };
    const results = await Promise.allSettled([
      service.move(player, input),
      service.move(player, input),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await repository.get(run.id))?.revision).toBe(1);
    const restarted = new MinesweeperService(repository, {
      now: () => run.startedAt + 1000,
      seed: () => 8,
    });
    expect((await restarted.move(player, input)).revision).toBe(1);
    await expect(restarted.move(player, { ...input, cell: 79 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('ranks personal best times with stable ties, week and ruleset filters, and own rank beyond 50', async () => {
    const { repository, player } = setup();
    const state = createMines('9x9', 42, 0);
    for (let i = 0; i < state.cells.length; i++)
      if (state.cells[i] !== -1) actMines(state, 'reveal', i);
    async function insert(
      id: string,
      playerId: number,
      elapsedMs: number,
      startedAt: number,
      ruleset = MINE_RULESET,
    ) {
      await repository.create({
        id,
        playerId,
        playerName: `P${playerId}`,
        ruleset,
        revision: 1,
        state,
        firstCell: 0,
        initialFlags: [],
        startedAt,
        elapsedMs,
        lastAction: null,
      });
    }
    await insert('a', 1, 1000, 100);
    await insert('b', 1, 500, 200);
    await insert('c', 2, 500, 150);
    await insert('d', 3, 500, 150);
    await insert('oldrules', 4, 1, 500, 'obsolete');
    expect(
      (await repository.leaderboard(player, '9x9', 'all', 0)).entries.map((e) => e.runId),
    ).toEqual(['c', 'd', 'b']);
    expect(
      (await repository.leaderboard(player, '9x9', 'week', 200)).entries.map((e) => e.runId),
    ).toEqual(['b']);
    for (let i = 10; i <= 70; i++) await insert(`r${i}`, i, i * 1000, 1000);
    const distant = await repository.leaderboard({ id: 70, name: 'P70' }, '9x9', 'all', 0);
    expect(distant.entries).toHaveLength(50);
    expect(distant.me?.rank).toBe(64);
    expect(distant.entries.some((e) => e.playerId === 70)).toBe(false);
    expect((await repository.leaderboard(player, '16x16', 'all', 0)).entries).toEqual([]);
  });
});
