import type { Period, Player } from '../../shared/contracts.ts';
import {
  DOOM_CATEGORIES,
  DOOM_MAX_TICKS,
  DOOM_RULESET,
  DOOM_SKILLS,
  DOOM_TARGETS,
  type DoomBoard,
  type DoomCategory,
  type DoomCommandSpan,
  type DoomProgress,
  type DoomRun,
  type DoomSkill,
  type DoomTarget,
  type DoomUpload,
  decodeDoomRun,
  doomCommands,
  doomTicks,
} from '../../shared/doom.ts';
import { canAccessDoom, DOOM_PRIVATE_MESSAGE } from '../../shared/doom-policy.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import type { BoardScope } from '../../shared/groups.ts';
import { isAdmin } from './admin.ts';
import type { GroupService } from './groups.ts';
import { leaderboardScope } from './leaderboard-scope.ts';

export interface StoredDoom extends DoomRun {
  playerId: number;
  playerName: string;
  breaks: number[];
  lastSubmission: string | null;
  sessionTick: number;
  sessionAt: number;
}
export interface DoomSplit {
  map: number;
  ticks: number;
  totalTicks: number;
  endTick: number;
  startTick: number;
  max: boolean;
}
export interface DoomVerification {
  ticks: number;
  complete: boolean;
  splits: DoomSplit[];
}
export interface DoomVerifier {
  verify(skill: DoomSkill, commands: readonly DoomCommandSpan[]): Promise<DoomVerification>;
}
export interface DoomResult {
  id: string;
  runId: string;
  playerId: number;
  playerName: string;
  skill: DoomSkill;
  target: DoomTarget;
  category: DoomCategory;
  ticks: number;
  createdAt: number;
  verifiedAt: number;
  verifiedOrder: number;
  socialProcessed: boolean;
  startTick: number;
  endTick: number;
}
export interface DoomScope extends BoardScope {
  maxResultOrder?: number;
}
export interface DoomRepository {
  get(id: string): Promise<StoredDoom | null>;
  latest(playerId: number): Promise<StoredDoom | null>;
  create(run: StoredDoom): Promise<StoredDoom>;
  countRecent(playerId: number, since: number): Promise<number>;
  commands(id: string, revision: number): Promise<DoomCommandSpan[]>;
  append(
    run: StoredDoom,
    revision: number,
    commands: DoomCommandSpan[],
    receipt: string,
    interruptions: number[],
  ): Promise<boolean>;
  interrupt(id: string, now: number, atTick?: number): Promise<void>;
  claim(id: string, now: number): Promise<boolean>;
  release(id: string, startedAt: number, now: number): Promise<void>;
  publish(run: StoredDoom, result: DoomVerification, now: number): Promise<void>;
  pending(limit: number, now: number): Promise<string[]>;
  leaderboard(
    player: Player,
    skill: DoomSkill,
    target: DoomTarget,
    category: DoomCategory,
    period: Period,
    since: number,
    scope?: DoomScope,
  ): Promise<DoomBoard>;
  pendingResults(limit: number): Promise<DoomResult[]>;
  processed(id: string): Promise<void>;
}
export class DoomService {
  constructor(
    private readonly repository: DoomRepository,
    private readonly verifier: DoomVerifier,
    private readonly now: () => number,
    private readonly groups?: GroupService,
  ) {}
  private access(player: Player): void {
    if (!canAccessDoom(isAdmin(player))) throw new AppError('UNAUTHORIZED', DOOM_PRIVATE_MESSAGE);
  }
  private async own(player: Player, input: unknown): Promise<StoredDoom> {
    this.access(player);
    const run = await this.repository.get(text(object(input).runId, 1, 100));
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Забег Doom не найден');
    return run;
  }
  async create(player: Player, input: unknown): Promise<DoomRun> {
    this.access(player);
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId))
      throw new AppError('BAD_INPUT', 'Некорректный ключ забега');
    const skill = oneOf(data.skill, DOOM_SKILLS);
    const id = `${player.id}:${requestId}`;
    const existing = await this.repository.get(id);
    if (existing) {
      if (existing.skill !== skill) throw new AppError('CONFLICT', 'Ключ уже использован');
      return decodeDoomRun(existing);
    }
    const now = this.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 5)
      throw new AppError('RATE_LIMIT', 'Слишком много забегов. Подожди минуту.');
    return decodeDoomRun(
      await this.repository.create({
        id,
        ruleset: DOOM_RULESET,
        skill,
        revision: 0,
        acceptedTicks: 0,
        verifiedTicks: 0,
        continuous: true,
        status: 'active',
        createdAt: now,
        expiresAt: now + 7 * 86400000,
        playerId: player.id,
        playerName: player.name,
        breaks: [],
        lastSubmission: null,
        sessionTick: 0,
        sessionAt: now,
      }),
    );
  }
  async progress(player: Player, input: unknown): Promise<DoomProgress | null> {
    this.access(player);
    const data = object(input);
    const run =
      data.runId === undefined
        ? await this.repository.latest(player.id)
        : await this.own(player, input);
    return run && run.expiresAt >= this.now()
      ? { run: decodeDoomRun(run), commands: await this.repository.commands(run.id, run.revision) }
      : null;
  }
  async interrupt(player: Player, input: unknown): Promise<DoomRun> {
    const run = await this.own(player, input);
    const tick = object(input).atTick;
    await this.repository.interrupt(
      run.id,
      this.now(),
      tick === undefined ? undefined : integer(tick, 0, run.acceptedTicks),
    );
    return decodeDoomRun((await this.repository.get(run.id)) ?? run);
  }
  async append(player: Player, input: unknown): Promise<DoomRun> {
    this.access(player);
    const data = object(input);
    const revision = integer(data.revision, 0, DOOM_MAX_TICKS);
    const commands = doomCommands(data.commands);
    const ticks = doomTicks(commands);
    if (!ticks) throw new AppError('BAD_INPUT', 'Пустая запись Doom');
    const rawInterruptions = data.interruptions ?? [];
    if (!Array.isArray(rawInterruptions) || rawInterruptions.length > 350)
      throw new AppError('BAD_INPUT', 'Слишком много перерывов');
    const interruptions = rawInterruptions.map((tick) => integer(tick, 0, DOOM_MAX_TICKS));
    const receipt = JSON.stringify({ revision, commands, interruptions } satisfies Omit<
      DoomUpload,
      'runId'
    >);
    const run = await this.own(player, input);
    if (run.revision === revision + 1 && run.lastSubmission === receipt) return decodeDoomRun(run);
    if (run.revision !== revision || run.status !== 'active')
      throw new AppError('CONFLICT', 'Запись Doom обновилась');
    const now = this.now();
    if (now > run.expiresAt) throw new AppError('EXPIRED', 'Срок отправки забега истёк');
    const acceptedTicks = run.acceptedTicks + ticks;
    if (
      acceptedTicks > DOOM_MAX_TICKS ||
      acceptedTicks - run.sessionTick > Math.floor(((now - run.sessionAt) * 35) / 1000) + 70
    )
      throw new AppError('BAD_INPUT', 'Запись опережает серверное время');
    const next = { ...run, revision: revision + 1, acceptedTicks, lastSubmission: receipt };
    if (interruptions.some((tick) => tick > acceptedTicks))
      throw new AppError('BAD_INPUT', 'Перерыв за пределами записи');
    if (!(await this.repository.append(next, revision, commands, receipt, interruptions)))
      throw new AppError('CONFLICT', 'Фрагмент уже принят другим запросом');
    return decodeDoomRun((await this.repository.get(run.id)) ?? next);
  }
  async verify(player: Player, input: unknown): Promise<DoomRun> {
    const run = await this.own(player, input);
    await this.process(run.id);
    return decodeDoomRun((await this.repository.get(run.id)) ?? run);
  }
  private async process(id: string): Promise<void> {
    const now = this.now();
    if (!(await this.repository.claim(id, now))) return;
    try {
      const run = await this.repository.get(id);
      if (!run || run.verifiedTicks >= run.acceptedTicks) return;
      const commands = await this.repository.commands(id, run.revision);
      if (doomTicks(commands) !== run.acceptedTicks)
        throw new AppError('UNAVAILABLE', 'Неполная серверная запись Doom');
      const result = await this.verifier.verify(run.skill, commands);
      if (result.ticks !== run.acceptedTicks)
        throw new AppError('BAD_INPUT', 'В записи есть команды после конца эпизода');
      await this.repository.publish(run, result, this.now());
    } finally {
      await this.repository.release(id, now, this.now());
    }
  }
  async sweep(): Promise<{ processed: number; deferred: number }> {
    let processed = 0,
      deferred = 0;
    for (const id of await this.repository.pending(1, this.now())) {
      try {
        await this.process(id);
        processed++;
      } catch {
        deferred++;
      }
    }
    return { processed, deferred };
  }
  async leaderboard(player: Player, input: unknown): Promise<DoomBoard> {
    this.access(player);
    const data = object(input);
    const skill = oneOf(data.skill, DOOM_SKILLS);
    const target = oneOf(data.target, DOOM_TARGETS);
    const category = oneOf(data.category, DOOM_CATEGORIES);
    const period = oneOf(data.period, ['all', 'week']);
    const date = new Date(this.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const { scope, state } = await leaderboardScope(player, data.groupId, this.groups);
    return {
      ...(await this.repository.leaderboard(
        player,
        skill,
        target,
        category,
        period,
        period === 'all' ? 0 : date.getTime(),
        scope,
      )),
      ...state,
    };
  }
}
