import { LEGACY_2048_RULESET, RULESETS_2048 } from '../../games/2048/engine.ts';
import { SIZES } from '../../games/minesweeper/engine.ts';
import { MODES } from '../../games/tetris/types.ts';
import type { Player } from '../../shared/contracts.ts';
import { AppError, object, oneOf } from '../../shared/errors.ts';
import type { GroupRecord } from '../../shared/groups.ts';
import { launchUrl } from '../../shared/launch.ts';
import { snakeSize } from '../../shared/snake.ts';
import type { Repository2048, Stored2048 } from './2048.ts';
import { record2048Notification } from './2048-record-notification.ts';
import type { BlockRepository, StoredBlock } from './block-blast.ts';
import { blockBlastRecordNotification } from './block-blast-record-notification.ts';
import type { FlappyRepository, StoredFlappy } from './flappy.ts';
import { flappyRecordNotification } from './flappy-record-notification.ts';
import type { GroupService } from './groups.ts';
import { mineRecordNotification } from './mine-record-notification.ts';
import type { MineNotificationResult, MineRepository } from './minesweeper.ts';
import { recordNotification } from './record-notification.ts';
import type { ArcadeRepository, StoredRun } from './repository.ts';
import type { SnakeRepository, StoredSnake } from './snake.ts';
import { snakeRecordNotification } from './snake-record-notification.ts';
import type { SocialJob, SocialRepository } from './social-repository.ts';
import type { TelegramGateway } from './telegram.ts';
export class MaintenanceService {
  constructor(
    private readonly repository: SocialRepository,
    private readonly arcade: ArcadeRepository,
    private readonly groups: GroupService,
    private readonly telegram: TelegramGateway,
    private readonly now: () => number,
    private readonly mines?: MineRepository,
    private readonly puzzle2048?: Repository2048,
    private readonly snake?: SnakeRepository,
    private readonly flappy?: FlappyRepository,
    private readonly blockBlast?: BlockRepository,
  ) {}
  private async targetGroups(
    player: Player,
    completedAt: number,
    snapshot: number[] = [],
  ): Promise<GroupRecord[]> {
    const candidates = new Map(
      (await this.repository.groupCandidates(player.id)).map((group) => [group.id, group]),
    );
    for (const id of snapshot) {
      if (candidates.has(id)) continue;
      const group = await this.repository.group(id);
      if (group) candidates.set(id, group);
    }
    return [...candidates.values()].filter(
      (group) =>
        group.active &&
        group.botAdmin &&
        group.notificationsEnabled &&
        completedAt >= group.enabledAt,
    );
  }
  async result(run: StoredRun): Promise<void> {
    if (run.status !== 'verified' || run.socialProcessed) return;
    for (const group of await this.targetGroups(
      { id: run.playerId, name: run.playerName },
      run.verifiedAt,
      run.groupIds,
    )) {
      const groupId = group.id;
      try {
        await this.groups.access({ id: run.playerId, name: run.playerName }, groupId);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
        )
          continue;
        throw error;
      }
      const sync = await this.groups.synchronize(groupId);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; объявление отложено');
      const player = { id: run.playerId, name: run.playerName };
      const before = await this.arcade.leaderboard(player, run.mode, 'all', 0, {
        groupId,
        maxVerifiedOrder: run.verifiedOrder - 1,
        membershipCheckedSince: sync.checkedSince,
      });
      const after = await this.arcade.leaderboard(player, run.mode, 'all', 0, {
        groupId,
        maxVerifiedOrder: run.verifiedOrder,
        membershipCheckedSince: sync.checkedSince,
      });
      const message = recordNotification(run, before, after);
      if (message)
        await this.repository.enqueue({
          id: `record:${run.id}:${groupId}`,
          payload: {
            type: 'record',
            chatId: groupId,
            playerId: run.playerId,
            mode: run.mode,
            runId: run.id,
            rank: after.me?.rank ?? 1,
            text: message,
          },
          dueAt: this.now(),
          expiresAt: run.verifiedAt + 300000,
          attempts: 0,
        });
    }
    await this.repository.processed(run.id);
  }
  async mineResult(run: MineNotificationResult): Promise<void> {
    if (!this.mines || run.socialProcessed) return;
    const player = { id: run.playerId, name: run.playerName };
    for (const group of await this.targetGroups(player, run.createdAt)) {
      try {
        await this.groups.access(player, group.id);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
        )
          continue;
        throw error;
      }
      const sync = await this.groups.synchronize(group.id);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; объявление отложено');
      const scope = { groupId: group.id, membershipCheckedSince: sync.checkedSince };
      const before = await this.mines.leaderboard(player, run.size, 'all', 0, {
        ...scope,
        maxResultOrder: run.order - 1,
      });
      const after = await this.mines.leaderboard(player, run.size, 'all', 0, {
        ...scope,
        maxResultOrder: run.order,
      });
      const message = mineRecordNotification(run, before, after);
      if (message)
        await this.repository.enqueue({
          id: `record:${run.id}:${group.id}`,
          payload: {
            type: 'record',
            game: 'minesweeper',
            chatId: group.id,
            playerId: run.playerId,
            mode: run.size,
            runId: run.id,
            rank: after.me?.rank ?? 1,
            text: message,
          },
          dueAt: this.now(),
          expiresAt: run.createdAt + 300000,
          attempts: 0,
        });
    }
    await this.mines.processed(run.id);
  }
  async result2048(run: Stored2048): Promise<void> {
    if (!this.puzzle2048 || run.status !== 'verified' || run.socialProcessed) return;
    const player = { id: run.playerId, name: run.playerName };
    for (const group of await this.targetGroups(player, run.verifiedAt)) {
      try {
        await this.groups.access(player, group.id);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
        )
          continue;
        throw error;
      }
      const sync = await this.groups.synchronize(group.id);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; объявление отложено');
      const scope = {
        groupId: group.id,
        membershipCheckedSince: sync.checkedSince,
        ruleset: oneOf(run.ruleset, RULESETS_2048),
      };
      const before = await this.puzzle2048.leaderboard(player, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder - 1,
      });
      const after = await this.puzzle2048.leaderboard(player, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder,
      });
      const message = record2048Notification(run, before, after);
      if (message)
        await this.repository.enqueue({
          id: `record:${run.id}:${group.id}`,
          payload: {
            type: 'record',
            game: '2048',
            chatId: group.id,
            playerId: run.playerId,
            mode: run.ruleset,
            runId: run.id,
            rank: after.me?.rank ?? 1,
            text: message,
          },
          dueAt: this.now(),
          expiresAt: this.now() + 86400000,
          attempts: 0,
        });
    }
    await this.puzzle2048.processed(run.id);
  }
  async snakeResult(run: StoredSnake): Promise<void> {
    if (!this.snake || run.status !== 'verified' || run.socialProcessed) return;
    const player = { id: run.playerId, name: run.playerName };
    for (const group of await this.targetGroups(player, run.verifiedAt)) {
      try {
        await this.groups.access(player, group.id);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
        )
          continue;
        throw error;
      }
      const sync = await this.groups.synchronize(group.id);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; объявление отложено');
      const scope = { groupId: group.id, membershipCheckedSince: sync.checkedSince };
      const before = await this.snake.leaderboard(player, run.state.size, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder - 1,
      });
      const after = await this.snake.leaderboard(player, run.state.size, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder,
      });
      const message = snakeRecordNotification(run, before, after);
      if (message)
        await this.repository.enqueue({
          id: `record:${run.id}:${group.id}`,
          payload: {
            type: 'record',
            game: 'snake',
            chatId: group.id,
            playerId: run.playerId,
            mode: String(run.state.size),
            runId: run.id,
            rank: after.me?.rank ?? 1,
            text: message,
          },
          dueAt: this.now(),
          expiresAt: this.now() + 86400000,
          attempts: 0,
        });
    }
    await this.snake.processed(run.id);
  }
  async flappyResult(run: StoredFlappy): Promise<void> {
    if (!this.flappy || run.status !== 'verified' || run.socialProcessed) return;
    const player = { id: run.playerId, name: run.playerName };
    for (const group of await this.targetGroups(player, run.verifiedAt)) {
      try {
        await this.groups.access(player, group.id);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
        )
          continue;
        throw error;
      }
      const sync = await this.groups.synchronize(group.id);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; объявление отложено');
      const scope = { groupId: group.id, membershipCheckedSince: sync.checkedSince };
      const before = await this.flappy.leaderboard(player, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder - 1,
      });
      const after = await this.flappy.leaderboard(player, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder,
      });
      const message = flappyRecordNotification(run, before, after);
      if (message)
        await this.repository.enqueue({
          id: `record:${run.id}:${group.id}`,
          payload: {
            type: 'record',
            game: 'flappy',
            chatId: group.id,
            playerId: run.playerId,
            mode: 'classic',
            runId: run.id,
            rank: after.me?.rank ?? 1,
            text: message,
          },
          dueAt: this.now(),
          expiresAt: this.now() + 86400000,
          attempts: 0,
        });
    }
    await this.flappy.processed(run.id);
  }
  async blockBlastResult(run: StoredBlock): Promise<void> {
    if (!this.blockBlast || run.status !== 'verified' || run.socialProcessed) return;
    const player = { id: run.playerId, name: run.playerName };
    for (const group of await this.targetGroups(player, run.verifiedAt)) {
      try {
        await this.groups.access(player, group.id);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
        )
          continue;
        throw error;
      }
      const sync = await this.groups.synchronize(group.id);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; объявление отложено');
      const scope = { groupId: group.id, membershipCheckedSince: sync.checkedSince };
      const before = await this.blockBlast.leaderboard(player, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder - 1,
      });
      const after = await this.blockBlast.leaderboard(player, 'all', 0, {
        ...scope,
        maxResultOrder: run.verifiedOrder,
      });
      const message = blockBlastRecordNotification(run, before, after);
      if (message)
        await this.repository.enqueue({
          id: `record:${run.id}:${group.id}`,
          payload: {
            type: 'record',
            game: 'block-blast',
            chatId: group.id,
            playerId: run.playerId,
            mode: 'classic',
            runId: run.id,
            rank: after.me?.rank ?? 1,
            text: message,
          },
          dueAt: this.now(),
          expiresAt: this.now() + 86400000,
          attempts: 0,
        });
    }
    await this.blockBlast.processed(run.id);
  }
  async sweep(limit = 12): Promise<{ processed: number; deferred: number }> {
    await this.repository.recover2048Expired(this.now());
    let deferred = 0;
    for (const run of await this.repository.pendingResults(3)) {
      try {
        await this.result(run);
      } catch (error) {
        deferred++;
        console.warn(
          'record_generation_deferred',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    for (const run of (await this.mines?.pendingResults(3)) ?? []) {
      try {
        await this.mineResult(run);
      } catch (error) {
        deferred++;
        console.warn(
          'mine_record_generation_deferred',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    for (const run of (await this.puzzle2048?.pendingResults(3)) ?? []) {
      try {
        await this.result2048(run);
      } catch (error) {
        deferred++;
        console.warn(
          'puzzle2048_record_generation_deferred',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    for (const run of (await this.snake?.pendingResults(3)) ?? []) {
      try {
        await this.snakeResult(run);
      } catch (error) {
        deferred++;
        console.warn(
          'snake_record_generation_deferred',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    for (const run of (await this.flappy?.pendingResults(3)) ?? []) {
      try {
        await this.flappyResult(run);
      } catch (error) {
        deferred++;
        console.warn(
          'flappy_record_generation_deferred',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    for (const run of (await this.blockBlast?.pendingResults(3)) ?? []) {
      try {
        await this.blockBlastResult(run);
      } catch (error) {
        deferred++;
        console.warn(
          'blockBlast_record_generation_deferred',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const job = await this.repository.claim(this.now());
      if (!job) break;
      await this.execute(job);
      processed++;
    }
    return { processed, deferred };
  }
  private async execute(job: SocialJob): Promise<void> {
    const now = this.now();
    if (now > job.expiresAt || job.attempts > 5) {
      await this.repository.complete(job, 'expired');
      return;
    }
    try {
      const payload = job.payload;
      const group = await this.repository.group(payload.chatId);
      if (!group?.notificationsEnabled || !group.active) {
        await this.repository.complete(job, 'suppressed');
        return;
      }
      await this.groups.access({ id: payload.playerId, name: 'Игрок' }, payload.chatId);
      const sync = await this.groups.synchronize(payload.chatId);
      if (sync.state !== 'complete')
        throw new AppError('UNAVAILABLE', 'Обновляется состав группы; отправка отложена');
      const player = { id: payload.playerId, name: 'Игрок' };
      const scope = { groupId: payload.chatId, membershipCheckedSince: sync.checkedSince };
      if (payload.game === 'minesweeper' && !this.mines)
        throw new AppError('UNAVAILABLE', 'Рейтинг Сапёра недоступен');
      if (payload.game === '2048' && !this.puzzle2048)
        throw new AppError('UNAVAILABLE', 'Рейтинг 2048 недоступен');
      if (payload.game === 'snake' && !this.snake)
        throw new AppError('UNAVAILABLE', 'Рейтинг Змейки недоступен');
      if (payload.game === 'flappy' && !this.flappy)
        throw new AppError('UNAVAILABLE', 'Рейтинг Flappy Bird недоступен');
      if (payload.game === 'block-blast' && !this.blockBlast)
        throw new AppError('UNAVAILABLE', 'Рейтинг Block Blast недоступен');
      const board =
        payload.game === 'block-blast' && this.blockBlast
          ? await this.blockBlast.leaderboard(player, 'all', 0, scope)
          : payload.game === 'flappy' && this.flappy
            ? await this.flappy.leaderboard(player, 'all', 0, scope)
            : payload.game === 'snake' && this.snake
              ? await this.snake.leaderboard(
                  player,
                  snakeSize(Number(payload.mode)),
                  'all',
                  0,
                  scope,
                )
              : payload.game === '2048' && this.puzzle2048
                ? await this.puzzle2048.leaderboard(player, 'all', 0, {
                    ...scope,
                    ruleset:
                      payload.mode === 'classic'
                        ? LEGACY_2048_RULESET
                        : oneOf(payload.mode, RULESETS_2048),
                  })
                : payload.game === 'minesweeper' && this.mines
                  ? await this.mines.leaderboard(
                      player,
                      oneOf(payload.mode, SIZES),
                      'all',
                      0,
                      scope,
                    )
                  : await this.arcade.leaderboard(
                      { id: payload.playerId, name: 'Игрок' },
                      oneOf(payload.mode, MODES),
                      'all',
                      0,
                      scope,
                    );
      if (!board.me || board.me.rank !== payload.rank || board.me.runId !== payload.runId) {
        await this.repository.complete(job, 'suppressed', 'Superseded record');
        return;
      }
      if (!(await this.repository.reserveAnnouncement(payload.chatId, now, job.id))) {
        if (
          payload.game === '2048' ||
          payload.game === 'snake' ||
          payload.game === 'flappy' ||
          payload.game === 'block-blast'
        ) {
          const updated = await this.repository.group(payload.chatId);
          await this.repository.retry(
            job,
            Math.max(now + 1000, updated?.nextNotificationAt ?? now + 300000),
            'Group cooldown',
          );
        } else await this.repository.complete(job, 'suppressed', 'Cooldown');
        return;
      }
      const me = await this.telegram.me();
      await this.telegram.send({
        chat_id: payload.chatId,
        ...(group.notificationThreadId === null
          ? {}
          : { message_thread_id: group.notificationThreadId }),
        text: `${payload.text}\n\nХочешь побить рекорд? Заходи играть!`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎮 Побить рекорд',
                url: launchUrl(
                  me.username,
                  payload.game === 'block-blast'
                    ? 'game_block-blast'
                    : payload.game === 'flappy'
                      ? 'game_flappy'
                      : payload.game === 'snake'
                        ? `game_snake_${payload.mode}`
                        : payload.game === '2048'
                          ? 'game_2048'
                          : payload.game === 'minesweeper'
                            ? `game_minesweeper_${payload.mode}`
                            : `game_tetris_${payload.mode}`,
                  me.hasMainMiniApp ? 'startapp' : 'start',
                ),
              },
            ],
          ],
        },
      });
      await this.repository.complete(job, 'done');
    } catch (error) {
      let code = 0;
      let retryAfter = 0;
      if (error && typeof error === 'object') {
        const data = object(error);
        if (typeof data.code === 'number') code = data.code;
        if (data.parameters && typeof data.parameters === 'object') {
          const p = object(data.parameters);
          if (typeof p.retry_after === 'number') retryAfter = p.retry_after;
        }
      }
      if (code === 403 || (error instanceof AppError && error.code === 'UNAUTHORIZED')) {
        await this.repository.complete(job, 'suppressed', 'Access revoked');
        return;
      }
      await this.repository.retry(
        job,
        now + Math.max(retryAfter * 1000, Math.min(30000, 1000 * 2 ** job.attempts)),
        error instanceof Error ? error.message : 'Telegram request failed',
      );
    }
  }
}
