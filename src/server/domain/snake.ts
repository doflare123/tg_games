import {
  createSnake,
  SNAKE_CHUNK,
  SNAKE_DIRECTIONS,
  SNAKE_RULESET,
  SNAKE_STEP_MS,
  stepSnake,
} from '../../games/snake/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { decodeSnakeRun, type SnakeBoard, type SnakeRun, snakeSize } from '../../shared/snake.ts';
import type { Clock } from './arcade.ts';
export interface StoredSnake extends SnakeRun {
  playerId: number;
  playerName: string;
  lastSubmission: string | null;
  verifiedAt: number;
  verifiedOrder: number;
  socialProcessed: boolean;
}
export interface SnakeBoardScope {
  groupId?: number;
  membershipCheckedSince?: number;
  maxResultOrder?: number;
}
export interface SnakeRepository {
  get(id: string): Promise<StoredSnake | null>;
  create(run: StoredSnake): Promise<StoredSnake>;
  save(run: StoredSnake, revision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    size: number,
    period: Period,
    since: number,
    scope?: SnakeBoardScope,
  ): Promise<SnakeBoard>;
  pendingResults(limit: number): Promise<StoredSnake[]>;
  processed(id: string): Promise<void>;
}
export class SnakeService {
  constructor(
    private readonly repository: SnakeRepository,
    private readonly clock: Clock,
  ) {}
  async create(player: Player, input: unknown): Promise<SnakeRun> {
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const size = snakeSize(data.size);
    const id = `${player.id}:snake:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) {
      if (existing.state.size !== size) throw new AppError('CONFLICT', 'Ключ уже использован');
      return decodeSnakeRun(existing);
    }
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много партий. Подожди минуту.');
    return decodeSnakeRun(
      await this.repository.create({
        id,
        ruleset: SNAKE_RULESET,
        revision: 0,
        state: createSnake(size, this.clock.seed()),
        status: 'active',
        createdAt: now,
        expiresAt: now + 7200000,
        playerId: player.id,
        playerName: player.name,
        lastSubmission: null,
        verifiedAt: 0,
        verifiedOrder: 0,
        socialProcessed: false,
      }),
    );
  }
  private async own(player: Player, input: unknown): Promise<StoredSnake> {
    const run = await this.repository.get(text(object(input).runId, 1, 100));
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    return run;
  }
  async get(player: Player, input: unknown): Promise<SnakeRun> {
    return decodeSnakeRun(await this.own(player, input));
  }
  async submit(player: Player, input: unknown): Promise<SnakeRun> {
    const data = object(input);
    const revision = integer(data.revision, 0, 24000);
    if (
      !Array.isArray(data.directions) ||
      !data.directions.length ||
      data.directions.length > SNAKE_CHUNK
    )
      throw new AppError('BAD_INPUT', 'Некорректная запись');
    const directions = data.directions.map((v) => oneOf(v, SNAKE_DIRECTIONS));
    const receipt = JSON.stringify({ revision, directions });
    const run = await this.own(player, data);
    if (run.revision === revision + 1 && run.lastSubmission === receipt) return decodeSnakeRun(run);
    if (run.revision !== revision || run.status !== 'active')
      throw new AppError('CONFLICT', 'Партия уже обновлена');
    const now = this.clock.now();
    if (now > run.expiresAt) throw new AppError('EXPIRED', 'Время отправки партии истекло');
    const next = decodeSnakeRun(run);
    if ((next.state.ticks + directions.length) * SNAKE_STEP_MS > now - run.createdAt + 1000)
      throw new AppError('BAD_INPUT', 'Запись опережает серверное время');
    for (const direction of directions)
      if (!stepSnake(next.state, direction)) throw new AppError('BAD_INPUT', 'Недопустимый ход');
    next.revision++;
    next.status = next.state.status === 'playing' ? 'active' : 'verified';
    if (
      !(await this.repository.save(
        {
          ...run,
          ...next,
          lastSubmission: receipt,
          verifiedAt: next.status === 'verified' ? now : 0,
        },
        revision,
      ))
    )
      throw new AppError('CONFLICT', 'Партия обновлена другим запросом');
    return next;
  }
  async leaderboard(player: Player, input: unknown): Promise<SnakeBoard> {
    const data = object(input);
    const size = snakeSize(data.size);
    const period = oneOf(data.period, ['all', 'week']);
    const date = new Date(this.clock.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return this.repository.leaderboard(player, size, period, period === 'all' ? 0 : date.getTime());
  }
}
