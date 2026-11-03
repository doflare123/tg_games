import {
  BLOCK_MAX_CHUNK,
  BLOCK_RULESET,
  createBlockBlast,
  moveBlockBlast,
} from '../../games/block-blast/engine.ts';
import type { BlockBoard, BlockRun } from '../../shared/block-blast.ts';
import { decodeBlockMove, decodeBlockState } from '../../shared/block-blast.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import type { Clock } from './arcade.ts';
import type { GroupService } from './groups.ts';
import { leaderboardScope } from './leaderboard-scope.ts';

export interface StoredBlock extends BlockRun {
  playerId: number;
  playerName: string;
  lastSubmission: string | null;
  verifiedAt: number;
  verifiedOrder: number;
  socialProcessed: boolean;
}
export interface BlockBoardScope {
  groupId?: number;
  membershipCheckedSince?: number;
  maxResultOrder?: number;
}
export interface BlockRepository {
  get(id: string): Promise<StoredBlock | null>;
  create(run: StoredBlock): Promise<StoredBlock>;
  save(run: StoredBlock, revision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    period: Period,
    since: number,
    scope?: BlockBoardScope,
  ): Promise<BlockBoard>;
  pendingResults(limit: number): Promise<StoredBlock[]>;
  processed(id: string): Promise<void>;
}
function view(run: StoredBlock): BlockRun {
  const { id, ruleset, revision, state, status, createdAt, expiresAt } = run;
  return { id, ruleset, revision, state: decodeBlockState(state), status, createdAt, expiresAt };
}
export class BlockService {
  constructor(
    private readonly repository: BlockRepository,
    private readonly clock: Clock,
    private readonly groups?: GroupService,
  ) {}
  async create(player: Player, input: unknown): Promise<BlockRun> {
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    const ruleset = BLOCK_RULESET;
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const id = `${player.id}:block-blast:${requestId}`;
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
        ruleset,
        revision: 0,
        state: createBlockBlast(this.clock.seed()),
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
  private async own(player: Player, input: unknown): Promise<StoredBlock> {
    const run = await this.repository.get(text(object(input).runId, 1, 100));
    if (!run || run.playerId !== player.id) throw new AppError('NOT_FOUND', 'Партия не найдена');
    return run;
  }
  async get(player: Player, input: unknown): Promise<BlockRun> {
    return view(await this.own(player, input));
  }
  async submit(player: Player, input: unknown): Promise<BlockRun> {
    const data = object(input);
    const revision = integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 2);
    if (
      !Array.isArray(data.moves) ||
      data.moves.length > BLOCK_MAX_CHUNK ||
      typeof data.finish !== 'boolean'
    )
      throw new AppError('BAD_INPUT', 'Некорректная запись ходов');
    const moves = data.moves.map(decodeBlockMove);
    const finish = data.finish;
    if (!moves.length && !finish) throw new AppError('BAD_INPUT', 'Пустая запись');
    const receipt = JSON.stringify({ revision, moves, finish });
    const run = await this.own(player, data);
    if (run.revision === revision + 1 && run.lastSubmission === receipt) return view(run);
    if (run.revision !== revision || run.status !== 'active')
      throw new AppError('CONFLICT', 'Партия уже обновлена или завершена');
    if (run.ruleset !== BLOCK_RULESET)
      throw new AppError('UNAVAILABLE', 'Версия правил больше не поддерживается');
    if (this.clock.now() > run.expiresAt)
      throw new AppError('EXPIRED', 'Срок партии истёк (24 часа)');
    const state = decodeBlockState(run.state);
    for (const move of moves)
      if (!moveBlockBlast(state, move)) throw new AppError('BAD_INPUT', 'Недопустимый ход');
    const next: StoredBlock = {
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
  async leaderboard(player: Player, input: unknown): Promise<BlockBoard> {
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
      {
        ...scope,
      },
    );
    return { ...board, ...state };
  }
}
