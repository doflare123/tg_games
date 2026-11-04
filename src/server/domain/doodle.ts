import { createAdventure, stepAdventure } from '../../games/doodle/adventure.ts';
import {
  DOODLE_CHUNK,
  DOODLE_HZ,
  DOODLE_MAX_TICKS,
  stepDoodle,
} from '../../games/doodle/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import {
  DOODLE_RULESET,
  DOODLE_RULESETS,
  type DoodleBoard,
  type DoodleEvent,
  type DoodleRuleset,
  type DoodleRun,
  decodeDoodleRun,
  doodleDirection,
} from '../../shared/doodle.ts';
import { decodeAdventureEvent } from '../../shared/doodle-adventure.ts';
import { DOODLE_RANKED_CLOSED_MESSAGE, isDoodleRankedEnabled } from '../../shared/doodle-policy.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import type { Clock } from './arcade.ts';
import type { GroupService } from './groups.ts';
import { leaderboardScope } from './leaderboard-scope.ts';
export type StoredDoodle = DoodleRun & {
  playerId: number;
  playerName: string;
  lastSubmission: string | null;
  verifiedAt: number;
  verifiedOrder: number;
  socialProcessed: boolean;
};
export interface DoodleBoardScope {
  ruleset?: DoodleRuleset;
  groupId?: number;
  membershipCheckedSince?: number;
  maxResultOrder?: number;
}
export interface DoodleRepository {
  get(id: string): Promise<StoredDoodle | null>;
  create(run: StoredDoodle): Promise<StoredDoodle>;
  save(run: StoredDoodle, revision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    period: Period,
    since: number,
    scope?: DoodleBoardScope,
  ): Promise<DoodleBoard>;
  pendingResults(limit: number): Promise<StoredDoodle[]>;
  processed(id: string): Promise<void>;
}
export class DoodleService {
  constructor(
    private readonly repository: DoodleRepository,
    private readonly clock: Clock,
    private readonly groups?: GroupService,
  ) {}
  async create(player: Player, input: unknown): Promise<DoodleRun> {
    if (!isDoodleRankedEnabled()) throw new AppError('UNAVAILABLE', DOODLE_RANKED_CLOSED_MESSAGE);
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const id = `${player.id}:doodle:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) {
      return decodeDoodleRun(existing);
    }
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много партий. Подожди минуту.');
    return decodeDoodleRun(
      await this.repository.create({
        id,
        ruleset: DOODLE_RULESET,
        revision: 0,
        state: createAdventure(this.clock.seed()),
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
  private async own(player: Player, input: unknown): Promise<StoredDoodle> {
    const run = await this.repository.get(text(object(input).runId, 1, 100));
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    return run;
  }
  async get(player: Player, input: unknown): Promise<DoodleRun> {
    return decodeDoodleRun(await this.own(player, input));
  }
  async submit(player: Player, input: unknown): Promise<DoodleRun> {
    if (!isDoodleRankedEnabled()) throw new AppError('UNAVAILABLE', DOODLE_RANKED_CLOSED_MESSAGE);
    const data = object(input);
    const revision = integer(data.revision, 0, DOODLE_MAX_TICKS);
    const untilTick = integer(data.untilTick, 1, DOODLE_MAX_TICKS);
    const run = await this.own(player, data);
    if (!Array.isArray(data.events) || data.events.length > DOODLE_CHUNK)
      throw new AppError('BAD_INPUT', 'Некорректная запись управления');
    const events: DoodleEvent[] = data.events.map((value) => {
      if (run.ruleset === DOODLE_RULESET) return decodeAdventureEvent(value, untilTick);
      const event = object(value);
      return {
        tick: integer(event.tick, 0, untilTick - 1),
        direction: doodleDirection(event.direction),
      };
    });
    for (let i = 1; i < events.length; i++)
      if ((events[i]?.tick ?? 0) <= (events[i - 1]?.tick ?? 0))
        throw new AppError('BAD_INPUT', 'Неверный порядок управления');
    const receipt = JSON.stringify({ revision, untilTick, events });
    if (run.revision === revision + 1 && run.lastSubmission === receipt)
      return decodeDoodleRun(run);
    if (run.revision !== revision || run.status !== 'active')
      throw new AppError('CONFLICT', 'Партия уже обновлена');
    const now = this.clock.now();
    if (now > run.expiresAt) throw new AppError('EXPIRED', 'Время отправки партии истекло');
    const next = decodeDoodleRun(run);
    if (
      untilTick <= next.state.ticks ||
      untilTick - next.state.ticks > DOODLE_CHUNK ||
      events.some((event) => event.tick < next.state.ticks)
    )
      throw new AppError('BAD_INPUT', 'Некорректный диапазон записи');
    if ((untilTick * 1000) / DOODLE_HZ > now - run.createdAt + 1000)
      throw new AppError('BAD_INPUT', 'Запись опережает серверное время');
    let action = 0;
    while (next.state.ticks < untilTick) {
      const event = events[action];
      const direction = event?.tick === next.state.ticks ? event.direction : next.state.direction;
      if (event?.tick === next.state.ticks) action++;
      const stepped =
        next.ruleset === DOODLE_RULESET
          ? stepAdventure(next.state, {
              direction,
              shooting:
                event?.tick === next.state.ticks ? event.shooting === true : next.state.shooting,
              aim: event?.tick === next.state.ticks ? (event.aim ?? 0) : next.state.aim,
            })
          : stepDoodle(next.state, direction);
      if (!stepped) throw new AppError('BAD_INPUT', 'Недопустимое управление');
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
  async leaderboard(player: Player, input: unknown): Promise<DoodleBoard> {
    const data = object(input);
    const period = oneOf(data.period, ['all', 'week']);
    const ruleset =
      data.ruleset === undefined ? DOODLE_RULESET : oneOf(data.ruleset, DOODLE_RULESETS);
    const { scope, state } = await leaderboardScope(player, data.groupId, this.groups);
    const date = new Date(this.clock.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const board = await this.repository.leaderboard(
      player,
      period,
      period === 'all' ? 0 : date.getTime(),
      { ...scope, ruleset },
    );
    return { ...board, ...state };
  }
}
