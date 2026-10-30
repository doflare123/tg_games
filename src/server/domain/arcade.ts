import { createTetris, stepTetris } from '../../games/tetris/engine.ts';
import type { ReplayEvent } from '../../games/tetris/types.ts';
import {
  ACTIONS,
  MAX_ACTIONS_PER_TICK,
  MAX_CHUNK_TICKS,
  MAX_TICKS,
  MODES,
  RULESET,
} from '../../games/tetris/types.ts';
import {
  CATALOG,
  type LeaderboardView,
  type Player,
  type RunView,
} from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { groupId } from '../../shared/groups.ts';
import { cloneTetris } from '../../shared/validation.ts';
import type { GroupService } from './groups.ts';
import { type ArcadeRepository, finalStatus, runView, type StoredRun } from './repository.ts';
export interface Clock {
  now(): number;
  seed(): number;
}
export class ArcadeService {
  constructor(
    private readonly repository: ArcadeRepository,
    private readonly clock: Clock,
    private readonly groups?: GroupService,
  ) {}
  catalog() {
    return CATALOG;
  }
  async create(player: Player, input: unknown): Promise<RunView> {
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId))
      throw new AppError('BAD_INPUT', 'Некорректный ключ запроса');
    const mode = oneOf(data.mode, MODES);
    const id = `${player.id}:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) {
      if (existing.mode !== mode)
        throw new AppError('CONFLICT', 'Ключ запроса уже использован для другого режима');
      return runView(existing);
    }
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60_000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много новых партий. Подожди минуту.');
    const run: StoredRun = {
      id,
      mode,
      ruleset: RULESET,
      playerId: player.id,
      playerName: player.name,
      revision: 0,
      state: createTetris(this.clock.seed(), mode),
      status: 'active',
      createdAt: now,
      expiresAt: now + 1_860_000,
      lastSubmission: null,
      groupIds: (await this.groups?.snapshot(player)) ?? [],
      verifiedOrder: 0,
      verifiedAt: 0,
      socialProcessed: false,
    };
    const created = await this.repository.create(run);
    if (created.mode !== mode) throw new AppError('CONFLICT', 'Ключ запроса уже использован');
    return runView(created);
  }
  private async own(player: Player, input: unknown): Promise<StoredRun> {
    const id = text(object(input).runId, 1, 100);
    const run = await this.repository.get(id);
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    return run;
  }
  async get(player: Player, input: unknown): Promise<RunView> {
    return runView(await this.own(player, input));
  }
  async abandon(player: Player, input: unknown): Promise<RunView> {
    const run = await this.own(player, input);
    if (run.status !== 'active') return runView(run);
    const next = {
      ...run,
      status: 'abandoned' as const,
      revision: run.revision + 1,
      lastSubmission: null,
    };
    if (!(await this.repository.save(next, run.revision)))
      throw new AppError('CONFLICT', 'Партия обновилась');
    return runView(next);
  }
  async submit(player: Player, input: unknown): Promise<RunView> {
    const data = object(input);
    const revision = integer(data.revision, 0, MAX_TICKS);
    const untilTick = integer(data.untilTick, 1, MAX_TICKS);
    if (!Array.isArray(data.events) || data.events.length > MAX_CHUNK_TICKS * MAX_ACTIONS_PER_TICK)
      throw new AppError('BAD_INPUT', 'Слишком большая запись');
    const events: ReplayEvent[] = data.events.map((value) => {
      const event = object(value);
      return { tick: integer(event.tick, 1, MAX_TICKS), action: oneOf(event.action, ACTIONS) };
    });
    const receipt = JSON.stringify({ revision, untilTick, events });
    const run = await this.own(player, data);
    if (run.revision === revision + 1 && run.lastSubmission === receipt) return runView(run);
    if (run.revision !== revision) throw new AppError('CONFLICT', 'Версия партии изменилась');
    if (run.status !== 'active') throw new AppError('CONFLICT', 'Партия уже завершена');
    if (run.ruleset !== RULESET)
      throw new AppError('UNAVAILABLE', 'Эта версия правил больше не поддерживается');
    const now = this.clock.now();
    if (now > run.expiresAt) throw new AppError('EXPIRED', 'Время загрузки партии истекло');
    if (untilTick <= run.state.tick || untilTick - run.state.tick > MAX_CHUNK_TICKS)
      throw new AppError('BAD_INPUT', 'Недопустимая длина фрагмента');
    if (untilTick > Math.floor(((now - run.createdAt) * 60) / 1000) + 120)
      throw new AppError('BAD_INPUT', 'Запись опережает серверное время');
    let previous = run.state.tick;
    let atTick = 0;
    for (const event of events) {
      if (event.tick <= run.state.tick || event.tick > untilTick || event.tick < previous)
        throw new AppError('BAD_INPUT', 'Нарушен порядок событий');
      atTick = event.tick === previous ? atTick + 1 : 1;
      previous = event.tick;
      if (atTick > MAX_ACTIONS_PER_TICK)
        throw new AppError('BAD_INPUT', 'Слишком много действий за кадр');
    }
    const state = cloneTetris(run.state);
    let index = 0;
    while (state.tick < untilTick && state.status === 'playing') {
      const actions: ReplayEvent['action'][] = [];
      while (events[index]?.tick === state.tick + 1) {
        const event = events[index++];
        if (event) actions.push(event.action);
      }
      stepTetris(state, actions);
    }
    if (state.tick !== untilTick || index !== events.length)
      throw new AppError('BAD_INPUT', 'В записи есть действия после конца партии');
    const next: StoredRun = {
      ...run,
      state,
      status: finalStatus(state),
      revision: revision + 1,
      lastSubmission: receipt,
      verifiedAt: state.status !== 'playing' ? now : 0,
    };
    if (!(await this.repository.save(next, revision)))
      throw new AppError('CONFLICT', 'Фрагмент уже обработан другим запросом');
    return runView(next);
  }
  async leaderboard(player: Player, input: unknown): Promise<LeaderboardView> {
    const data = object(input);
    const mode = oneOf(data.mode, MODES);
    const period = oneOf(data.period, ['all', 'week']);
    const date = new Date(this.clock.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const scope: { groupId?: number } = {};
    if (data.groupId !== undefined) {
      const id = groupId(data.groupId);
      if (!this.groups) throw new AppError('UNAVAILABLE', 'Группы не подключены');
      await this.groups.access(player, id);
      scope.groupId = id;
    }
    return this.repository.leaderboard(
      player,
      mode,
      period,
      period === 'all' ? 0 : date.getTime(),
      scope,
    );
  }
}
