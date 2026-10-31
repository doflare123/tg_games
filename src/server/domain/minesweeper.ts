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
  timing: { runningSince: number; pending: boolean };
  lastAction: string | null;
}
export interface MineRepository {
  get(id: string): Promise<StoredMineRun | null>;
  create(run: StoredMineRun): Promise<{ run: StoredMineRun; created: boolean }>;
  save(run: StoredMineRun, expectedRevision: number): Promise<boolean>;
  resumeTimer(run: StoredMineRun, runningSince: number): Promise<StoredMineRun | null>;
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
          ? Math.min(
              MINE_LIMIT_MS,
              run.elapsedMs + Math.max(0, this.clock.now() - run.timing.runningSince),
            )
          : run.elapsedMs,
    };
  }
  async create(player: Player, input: unknown): Promise<MineRunView> {
    const receivedAt = this.clock.now();
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
    if ((await this.repository.countRecent(player.id, receivedAt - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много партий. Подожди минуту.');
    const state = createMines(size, this.clock.seed(), firstCell, initialFlags);
    const { run, created } = await this.repository.create({
      id,
      playerId: player.id,
      playerName: player.name,
      ruleset: MINE_RULESET,
      revision: 0,
      state,
      firstCell,
      initialFlags,
      startedAt: receivedAt,
      elapsedMs: 0,
      timing: { runningSince: this.clock.now(), pending: true },
      lastAction: null,
    });
    if (!created) return this.createdView(run, size, firstCell, initialFlags);
    return this.complete(run);
  }
  private async complete(run: StoredMineRun): Promise<MineRunView> {
    if (run.state.status === 'playing') {
      // Resume after the board calculation and primary DB write. This small,
      // revision-guarded checkpoint is the only remaining timing overhead.
      const resumed = await this.repository.resumeTimer(run, this.clock.now());
      if (!resumed) {
        const latest = await this.repository.get(run.id);
        if (!latest) throw new AppError('NOT_FOUND', 'Партия не найдена');
        return this.view(latest);
      }
      run = resumed;
    }
    // The accepted move ends at request arrival, so its own processing cannot
    // inflate either a winning result or the time returned to the client.
    return { ...this.view(run), elapsedMs: run.elapsedMs };
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
    const receivedAt = this.clock.now();
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
    if (receivedAt - run.startedAt >= MINE_LIMIT_MS)
      throw new AppError('EXPIRED', 'Время партии истекло');
    const elapsedMs = run.elapsedMs + Math.max(0, receivedAt - run.timing.runningSince);
    const state: MineState = {
      ...run.state,
      cells: [...run.state.cells],
      revealed: [...run.state.revealed],
      flags: [...run.state.flags],
    };
    actMines(state, action, cell);
    const next = {
      ...run,
      state,
      elapsedMs,
      revision: revision + 1,
      lastAction: receipt,
      timing: { runningSince: this.clock.now(), pending: true },
    };
    if (!(await this.repository.save(next, revision)))
      throw new AppError('CONFLICT', 'Ход уже обработан другим запросом');
    return this.complete(next);
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
