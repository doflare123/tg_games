import {
  createFlappy,
  FLAPPY_CHUNK,
  FLAPPY_HZ,
  FLAPPY_MAX_TICKS,
  FLAPPY_RULESET,
  stepFlappy,
} from '../../games/flappy/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { decodeFlappyRun, type FlappyBoard, type FlappyRun } from '../../shared/flappy.ts';
import type { Clock } from './arcade.ts';
import type { GroupService } from './groups.ts';
import { leaderboardScope } from './leaderboard-scope.ts';
export interface StoredFlappy extends FlappyRun {
  playerId: number;
  playerName: string;
  lastSubmission: string | null;
  verifiedAt: number;
  verifiedOrder: number;
  socialProcessed: boolean;
}
export interface FlappyBoardScope {
  groupId?: number;
  membershipCheckedSince?: number;
  maxResultOrder?: number;
}
export interface FlappyRepository {
  get(id: string): Promise<StoredFlappy | null>;
  create(run: StoredFlappy): Promise<StoredFlappy>;
  save(run: StoredFlappy, revision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    period: Period,
    since: number,
    scope?: FlappyBoardScope,
  ): Promise<FlappyBoard>;
  pendingResults(limit: number): Promise<StoredFlappy[]>;
  processed(id: string): Promise<void>;
}
export class FlappyService {
  constructor(
    private readonly repository: FlappyRepository,
    private readonly clock: Clock,
    private readonly groups?: GroupService,
  ) {}
  async create(player: Player, input: unknown): Promise<FlappyRun> {
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const id = `${player.id}:flappy:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) {
      return decodeFlappyRun(existing);
    }
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много партий. Подожди минуту.');
    return decodeFlappyRun(
      await this.repository.create({
        id,
        ruleset: FLAPPY_RULESET,
        revision: 0,
        state: createFlappy(this.clock.seed()),
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
  private async own(player: Player, input: unknown): Promise<StoredFlappy> {
    const run = await this.repository.get(text(object(input).runId, 1, 100));
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    return run;
  }
  async get(player: Player, input: unknown): Promise<FlappyRun> {
    return decodeFlappyRun(await this.own(player, input));
  }
  async submit(player: Player, input: unknown): Promise<FlappyRun> {
    const data = object(input);
    const revision = integer(data.revision, 0, FLAPPY_MAX_TICKS);
    const untilTick = integer(data.untilTick, 1, FLAPPY_MAX_TICKS);
    if (!Array.isArray(data.flaps) || data.flaps.length > FLAPPY_CHUNK / 4)
      throw new AppError('BAD_INPUT', 'Некорректная запись взмахов');
    const flaps = data.flaps.map((v) => integer(v, 0, untilTick - 1));
    for (let i = 1; i < flaps.length; i++)
      if ((flaps[i] ?? 0) - (flaps[i - 1] ?? 0) < 4)
        throw new AppError('BAD_INPUT', 'Неверный порядок взмахов');
    const receipt = JSON.stringify({ revision, untilTick, flaps });
    const run = await this.own(player, data);
    if (run.revision === revision + 1 && run.lastSubmission === receipt)
      return decodeFlappyRun(run);
    if (run.revision !== revision || run.status !== 'active')
      throw new AppError('CONFLICT', 'Партия уже обновлена');
    const now = this.clock.now();
    if (now > run.expiresAt) throw new AppError('EXPIRED', 'Время отправки партии истекло');
    const next = decodeFlappyRun(run);
    if (
      untilTick <= next.state.ticks ||
      untilTick - next.state.ticks > FLAPPY_CHUNK ||
      flaps.some((tick) => tick < next.state.ticks)
    )
      throw new AppError('BAD_INPUT', 'Некорректный диапазон записи');
    if ((untilTick * 1000) / FLAPPY_HZ > now - run.createdAt + 1000)
      throw new AppError('BAD_INPUT', 'Запись опережает серверное время');
    let action = 0;
    while (next.state.ticks < untilTick) {
      const flap = flaps[action] === next.state.ticks;
      if (flap) action++;
      if (!stepFlappy(next.state, flap)) throw new AppError('BAD_INPUT', 'Недопустимый взмах');
    }
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
  async leaderboard(player: Player, input: unknown): Promise<FlappyBoard> {
    const data = object(input);
    const period = oneOf(data.period, ['all', 'week']);
    const { scope, state } = await leaderboardScope(player, data.groupId, this.groups);
    const date = new Date(this.clock.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const board = await this.repository.leaderboard(
      player,
      period,
      period === 'all' ? 0 : date.getTime(),
      scope,
    );
    return { ...board, ...state };
  }
}
