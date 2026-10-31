import { afterEach, describe, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import {
  actMines,
  createMines,
  LEVELS,
  MINE_LIMIT_MS,
  type MineState,
  mineBoard,
  neighbors,
  SIZES,
} from '../src/games/minesweeper/engine.ts';
import { MinesweeperService } from '../src/server/domain/minesweeper.ts';
import { SqlMineRepository } from '../src/server/platform/sql-minesweeper.ts';
import { decodeMineLeaderboard, decodeMineResult } from '../src/shared/minesweeper.ts';

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
  it.each(SIZES)('finishes %s on the last safe cell without requiring mine flags', (size) => {
    for (const markedMines of [0, 3]) {
      const state = createMines(size, 42, 0);
      const last = state.cells.findIndex((value, i) => value > 0 && !state.revealed[i]);
      expect(last).toBeGreaterThanOrEqual(0);
      actMines(state, 'flag', last);
      const mines = state.cells.flatMap((value, i) => (value === -1 ? [i] : []));
      for (const cell of mines.slice(0, markedMines)) actMines(state, 'flag', cell);
      for (let cell = 0; cell < state.cells.length; cell++)
        if (cell !== last && state.cells[cell] !== -1) actMines(state, 'reveal', cell);
      expect(state.status).toBe('playing');
      actMines(state, 'flag', last);
      expect(state.status).toBe('playing');
      actMines(state, 'reveal', last);
      expect(state.status).toBe('won');
      expect(state.flags.filter(Boolean)).toHaveLength(LEVELS[size].mines);
      for (const cell of mines) expect(state.revealed[cell]).toBe(false);
      const board = mineBoard(state);
      expect(board.cells.filter((value) => value === -3)).toHaveLength(LEVELS[size].mines);
      expect(board.cells.some((value) => value === -1 || value === -2)).toBe(false);
    }
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
    expect(state.flags).toEqual(state.cells.map((value) => value === -1));
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
  const service = new MinesweeperService(repository, { now: () => now });
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
const result = { size: '9x9', elapsedMs: 12345, requestId: 'minesweeper_test_01' } as const;
describe('Minesweeper results and SQL rankings', () => {
  it.each(SIZES)(
    'records %s time with the endpoint player identity in its own category',
    async (size) => {
      const { service, database, player } = setup();
      const saved = await service.submit(player, {
        ...result,
        size,
        playerId: 999,
        playerName: 'Чужой',
      });
      expect(decodeMineResult(saved)).toEqual(saved);
      expect(saved.elapsedMs).toBe(12345);
      expect(saved.size).toBe(size);
      const row = database
        .prepare('SELECT player_id,player_name FROM minesweeper_runs WHERE id=?')
        .get(saved.id);
      expect(row).toEqual({ player_id: player.id, player_name: player.name });
      const board = await service.leaderboard(player, { size, period: 'all' });
      expect(decodeMineLeaderboard(board)).toEqual(board);
      expect(board.me).toMatchObject({ rank: 1, elapsedMs: 12345, playerId: player.id });
      for (const other of SIZES.filter((s) => s !== size))
        expect((await service.leaderboard(player, { size: other, period: 'all' })).entries).toEqual(
          [],
        );
    },
  );
  it('keeps results stable across retries, reloads and reused request keys', async () => {
    const { service, repository, database, player, advance } = setup();
    const saved = await service.submit(player, result);
    advance(5000);
    expect(await service.submit(player, result)).toEqual(saved);
    const restarted = new MinesweeperService(repository, { now: () => Date.UTC(2026, 10, 1) });
    expect(await restarted.submit(player, result)).toEqual(saved);
    expect(database.prepare('SELECT count(*) AS total FROM minesweeper_runs').get()?.total).toBe(1);
    await expect(service.submit(player, { ...result, elapsedMs: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(service.submit(player, { ...result, size: '16x16' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const other = await service.submit({ id: 99, name: 'Другой' }, result);
    expect(other.id).not.toBe(saved.id);
  });
  it('accepts valid duration bounds and rejects malformed sizes, times and request keys', async () => {
    const { service, player } = setup();
    for (const elapsedMs of [-1, MINE_LIMIT_MS + 1, 0.1, NaN, Infinity, '123', null])
      await expect(service.submit(player, { ...result, elapsedMs })).rejects.toMatchObject({
        code: 'BAD_INPUT',
      });
    for (const invalid of [
      { size: '8x8' },
      { requestId: '../bad-path-key__' },
      { requestId: 'short' },
    ])
      await expect(service.submit(player, { ...result, ...invalid })).rejects.toMatchObject({
        code: 'BAD_INPUT',
      });
    await expect(service.submit(player, null)).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect((await service.submit(player, { ...result, elapsedMs: 0 })).elapsedMs).toBe(0);
    expect(
      (
        await service.submit(player, {
          ...result,
          requestId: 'minesweeper_test_02',
          elapsedMs: MINE_LIMIT_MS,
        })
      ).elapsedMs,
    ).toBe(MINE_LIMIT_MS);
    await expect(
      service.leaderboard(player, { size: '9x9', period: 'month' }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });
  it('deduplicates concurrent submissions', async () => {
    const { service, database, player } = setup();
    const saved = await Promise.all([
      service.submit(player, result),
      service.submit(player, result),
    ]);
    expect(saved[0]).toEqual(saved[1]);
    expect(database.prepare('SELECT count(*) AS total FROM minesweeper_runs').get()?.total).toBe(1);
  });
  it('limits new result submissions without blocking retries of accepted results', async () => {
    const { service, player, advance } = setup();
    for (let i = 0; i < 10; i++)
      await service.submit(player, { ...result, requestId: `result_limit_test_${i}` });
    await expect(service.submit(player, result)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    expect(
      (await service.submit(player, { ...result, requestId: 'result_limit_test_0' })).elapsedMs,
    ).toBe(result.elapsedMs);
    advance(60001);
    expect((await service.submit(player, result)).elapsedMs).toBe(result.elapsedMs);
  });
  it('ranks personal bests, stable ties and week boundaries while preserving older results', async () => {
    const { service, repository, database, player } = setup();
    const monday = Date.UTC(2026, 9, 26);
    async function insert(id: string, playerId: number, elapsedMs: number, createdAt: number) {
      await repository.record({
        id,
        playerId,
        playerName: `P${playerId}`,
        size: '9x9',
        elapsedMs,
        createdAt,
      });
    }
    await insert('a', 1, 1000, monday);
    await insert('b', 1, 500, monday + 200);
    await insert('c', 2, 500, monday + 100);
    await insert('d', 3, 500, monday + 100);
    await insert('prior-week', 4, 1, monday - 1);
    database
      .prepare('UPDATE minesweeper_runs SET state_json=? WHERE id=?')
      .run(JSON.stringify(createMines('9x9', 42, 0)), 'c');
    expect(
      (await service.leaderboard(player, { size: '9x9', period: 'all' })).entries.map(
        (e) => e.runId,
      ),
    ).toEqual(['prior-week', 'c', 'd', 'b']);
    expect(
      (await service.leaderboard(player, { size: '9x9', period: 'week' })).entries.map(
        (e) => e.runId,
      ),
    ).toEqual(['c', 'd', 'b']);
    database.prepare("UPDATE minesweeper_runs SET status='lost' WHERE id='d'").run();
    expect(
      (await service.leaderboard(player, { size: '9x9', period: 'week' })).entries.map(
        (e) => e.runId,
      ),
    ).toEqual(['c', 'b']);
  });
  it('returns the player position beyond the first fifty', async () => {
    const { repository } = setup();
    for (let i = 1; i <= 60; i++)
      await repository.record({
        id: `r${i}`,
        playerId: i,
        playerName: `P${i}`,
        size: '30x16',
        elapsedMs: i * 1000,
        createdAt: i,
      });
    const board = await repository.leaderboard({ id: 60, name: 'P60' }, '30x16', 'all', 0);
    expect(board.entries).toHaveLength(50);
    expect(board.me?.rank).toBe(60);
    expect(board.entries.some((e) => e.playerId === 60)).toBe(false);
  });
});
