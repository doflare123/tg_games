import {
  create2048,
  DIRECTIONS,
  MAX_2048_CHUNK,
  move2048,
  RULESET_2048,
} from '../../games/2048/engine.ts';
import type { Board2048, Run2048 } from '../../shared/2048.ts';
import { decodeState2048 } from '../../shared/2048.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import type { Clock } from './arcade.ts';

export interface Stored2048 extends Run2048 {
  playerId: number;
  playerName: string;
  lastSubmission: string | null;
  verifiedAt: number;
  verifiedOrder: number;
  socialProcessed: boolean;
}
export interface BoardScope2048 {
  groupId?: number;
  membershipCheckedSince?: number;
  maxResultOrder?: number;
}
export interface Repository2048 {
  get(id: string): Promise<Stored2048 | null>;
  create(run: Stored2048): Promise<Stored2048>;
  save(run: Stored2048, revision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    period: Period,
    since: number,
    scope?: BoardScope2048,
  ): Promise<Board2048>;
  pendingResults(limit: number): Promise<Stored2048[]>;
  processed(id: string): Promise<void>;
}
function view(run: Stored2048): Run2048 {
  const { id, ruleset, revision, state, status, createdAt, expiresAt } = run;
  return { id, ruleset, revision, state: decodeState2048(state), status, createdAt, expiresAt };
}
export class Service2048 {
  constructor(
    private readonly repository: Repository2048,
    private readonly clock: Clock,
  ) {}
  async create(player: Player, input: unknown): Promise<Run2048> {
    const requestId = text(object(input).requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const id = `${player.id}:2048:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) return view(existing);
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много партий. Подожди минуту.');
    return view(
      await this.repository.create({
        id,
        playerId: player.id,
        playerName: player.name,
        ruleset: RULESET_2048,
        revision: 0,
        state: create2048(this.clock.seed()),
        status: 'active',
        createdAt: now,
        expiresAt: now + 86400000,
        lastSubmission: null,
        verifiedAt: 0,
        verifiedOrder: 0,
        socialProcessed: false,
      }),
    );
  }
  private async own(player: Player, input: unknown): Promise<Stored2048> {
    const run = await this.repository.get(text(object(input).runId, 1, 100));
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    return run;
  }
  async get(player: Player, input: unknown): Promise<Run2048> {
    return view(await this.own(player, input));
  }
  async submit(player: Player, input: unknown): Promise<Run2048> {
    const data = object(input);
    const revision = integer(data.revision, 0, 20000);
    if (
      !Array.isArray(data.moves) ||
      data.moves.length > MAX_2048_CHUNK ||
      typeof data.finish !== 'boolean'
    )
      throw new AppError('BAD_INPUT', 'Некорректная запись ходов');
    const moves = data.moves.map((value) => oneOf(value, DIRECTIONS));
    const finish = data.finish;
    if (!moves.length && !finish) throw new AppError('BAD_INPUT', 'Пустая запись');
    const receipt = JSON.stringify({ revision, moves, finish });
    const run = await this.own(player, data);
    if (run.revision === revision + 1 && run.lastSubmission === receipt) return view(run);
    if (run.revision !== revision || run.status !== 'active')
      throw new AppError('CONFLICT', 'Партия уже обновлена или завершена');
    if (run.ruleset !== RULESET_2048)
      throw new AppError('UNAVAILABLE', 'Версия правил больше не поддерживается');
    if (this.clock.now() > run.expiresAt)
      throw new AppError('EXPIRED', 'Срок партии истёк (24 часа)');
    const state = decodeState2048(run.state);
    for (const direction of moves)
      if (!move2048(state, direction)) throw new AppError('BAD_INPUT', 'Недопустимый ход');
    const next: Stored2048 = {
      ...run,
      state,
      revision: revision + 1,
      lastSubmission: receipt,
      status: finish || state.status === 'over' ? 'verified' : 'active',
      verifiedAt: finish || state.status === 'over' ? this.clock.now() : 0,
    };
    if (!(await this.repository.save(next, revision)))
      throw new AppError('CONFLICT', 'Партия обновлена другим запросом');
    return view(next);
  }
  async leaderboard(player: Player, input: unknown): Promise<Board2048> {
    const period = oneOf(object(input).period, ['all', 'week']);
    const date = new Date(this.clock.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return this.repository.leaderboard(player, period, period === 'all' ? 0 : date.getTime());
  }
}
