import {
  actMines,
  createMines,
  LEVELS,
  MINE_ACTIONS,
  MINE_LIMIT_MS,
  MINE_RULESET,
  type MineSize,
  type MineState,
  mineBoard,
  SIZES,
} from '../../games/minesweeper/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import type { MineLeaderboard, MineRunView } from '../../shared/minesweeper.ts';
import type { Clock } from './arcade.ts';

export interface StoredMineRun {
  id: string;
  playerId: number;
  playerName: string;
  ruleset: string;
  revision: number;
  state: MineState;
  firstCell: number;
  initialFlags: number[];
  startedAt: number;
  elapsedMs: number;
  lastAction: string | null;
}
export interface MineRepository {
  get(id: string): Promise<StoredMineRun | null>;
  create(run: StoredMineRun): Promise<StoredMineRun>;
  save(run: StoredMineRun, expectedRevision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    size: MineSize,
    period: Period,
    since: number,
  ): Promise<MineLeaderboard>;
}
export class MinesweeperService {
  constructor(
    private readonly repository: MineRepository,
    private readonly clock: Clock,
  ) {}
  private view(run: StoredMineRun): MineRunView {
    return {
      id: run.id,
      revision: run.revision,
      board: mineBoard(run.state),
      startedAt: run.startedAt,
      elapsedMs:
        run.state.status === 'playing'
          ? Math.min(MINE_LIMIT_MS, Math.max(0, this.clock.now() - run.startedAt))
          : run.elapsedMs,
    };
  }
  async create(player: Player, input: unknown): Promise<MineRunView> {
    const data = object(input);
    const size = oneOf(data.size, SIZES);
    const { width, height } = LEVELS[size];
    const firstCell = integer(data.firstCell, 0, width * height - 1);
    const rawFlags = data.flags === undefined ? [] : data.flags;
    if (!Array.isArray(rawFlags) || rawFlags.length > width * height)
      throw new AppError('BAD_INPUT', 'Некорректные флаги');
    const initialFlags = rawFlags
      .map((value) => integer(value, 0, width * height - 1))
      .sort((a, b) => a - b);
    if (new Set(initialFlags).size !== initialFlags.length || initialFlags.includes(firstCell))
      throw new AppError('BAD_INPUT', 'Некорректные флаги');
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const id = `${player.id}:mine:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) return this.createdView(existing, size, firstCell, initialFlags);
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много партий. Подожди минуту.');
    const run = await this.repository.create({
      id,
      playerId: player.id,
      playerName: player.name,
      ruleset: MINE_RULESET,
      revision: 0,
      state: createMines(size, this.clock.seed(), firstCell, initialFlags),
      firstCell,
      initialFlags,
      startedAt: now,
      elapsedMs: 0,
      lastAction: null,
    });
    return this.createdView(run, size, firstCell, initialFlags);
  }
  private createdView(
    run: StoredMineRun,
    size: MineSize,
    firstCell: number,
    initialFlags: number[],
  ): MineRunView {
    if (
      run.state.size !== size ||
      run.firstCell !== firstCell ||
      run.initialFlags.length !== initialFlags.length ||
      run.initialFlags.some((cell, i) => cell !== initialFlags[i])
    )
      throw new AppError('CONFLICT', 'Ключ запроса уже использован для другого поля');
    return this.view(run);
  }
  async move(player: Player, input: unknown): Promise<MineRunView> {
    const data = object(input);
    const id = text(data.runId, 1, 100);
    const revision = integer(data.revision, 0, 19999);
    const action = oneOf(data.action, MINE_ACTIONS);
    const run = await this.repository.get(id);
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    const { width, height } = LEVELS[run.state.size];
    const cell = integer(data.cell, 0, width * height - 1);
    const receipt = JSON.stringify({ revision, action, cell });
    if (run.revision === revision + 1 && run.lastAction === receipt) return this.view(run);
    if (run.revision !== revision || run.state.status !== 'playing')
      throw new AppError('CONFLICT', 'Партия обновилась или завершена');
    if (run.ruleset !== MINE_RULESET) throw new AppError('UNAVAILABLE', 'Версия правил устарела');
    const elapsedMs = Math.max(0, this.clock.now() - run.startedAt);
    if (elapsedMs >= MINE_LIMIT_MS) throw new AppError('EXPIRED', 'Время партии истекло');
    const state: MineState = {
      ...run.state,
      cells: [...run.state.cells],
      revealed: [...run.state.revealed],
      flags: [...run.state.flags],
    };
    actMines(state, action, cell);
    const next = { ...run, state, elapsedMs, revision: revision + 1, lastAction: receipt };
    if (!(await this.repository.save(next, revision)))
      throw new AppError('CONFLICT', 'Ход уже обработан другим запросом');
    return this.view(next);
  }
  async leaderboard(player: Player, input: unknown): Promise<MineLeaderboard> {
    const data = object(input);
    const size = oneOf(data.size, SIZES);
    const period = oneOf(data.period, ['all', 'week']);
    const date = new Date(this.clock.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return this.repository.leaderboard(player, size, period, period === 'all' ? 0 : date.getTime());
  }
}
