import { MINE_LIMIT_MS, type MineSize, SIZES } from '../../games/minesweeper/engine.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import type { MineLeaderboard, MineResult } from '../../shared/minesweeper.ts';

export interface StoredMineResult extends MineResult {
  playerId: number;
  playerName: string;
  createdAt: number;
}
export interface MineNotificationResult extends StoredMineResult {
  order: number;
  socialProcessed: boolean;
}
export interface MineBoardScope {
  groupId?: number;
  membershipCheckedSince?: number;
  maxResultOrder?: number;
}
export interface MineRepository {
  getResult(id: string): Promise<MineResult | null>;
  getStored(id: string): Promise<MineNotificationResult | null>;
  pendingResults(limit: number): Promise<MineNotificationResult[]>;
  processed(id: string): Promise<void>;
  record(result: StoredMineResult): Promise<MineResult>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    size: MineSize,
    period: Period,
    since: number,
    scope?: MineBoardScope,
  ): Promise<MineLeaderboard>;
}
export class MinesweeperService {
  constructor(
    private readonly repository: MineRepository,
    private readonly clock: { now(): number },
  ) {}
  async submit(player: Player, input: unknown): Promise<MineResult> {
    const data = object(input);
    const requestId = text(data.requestId, 16, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new AppError('BAD_INPUT', 'Некорректный ключ');
    const size = oneOf(data.size, SIZES);
    const elapsedMs = integer(data.elapsedMs, 0, MINE_LIMIT_MS);
    const id = `${player.id}:mine-result:${requestId}`;
    const existing = await this.repository.getResult(id);
    if (existing) return this.match(existing, size, elapsedMs);
    const now = this.clock.now();
    if ((await this.repository.countRecent(player.id, now - 60000)) >= 10)
      throw new AppError('RATE_LIMIT', 'Слишком много результатов. Подожди минуту.');
    const stored = await this.repository.record({
      id,
      size,
      elapsedMs,
      playerId: player.id,
      playerName: player.name,
      createdAt: now,
    });
    return this.match(stored, size, elapsedMs);
  }
  private match(result: MineResult, size: MineSize, elapsedMs: number): MineResult {
    if (result.size !== size || result.elapsedMs !== elapsedMs)
      throw new AppError('CONFLICT', 'Ключ результата уже использован');
    return result;
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
