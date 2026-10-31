import { MODES } from '../../games/tetris/types.ts';
import { AppError, object, oneOf } from '../../shared/errors.ts';
import { launchUrl } from '../../shared/launch.ts';
import type { GroupService } from './groups.ts';
import { recordNotification } from './record-notification.ts';
import type { ArcadeRepository, StoredRun } from './repository.ts';
import type { SocialJob, SocialRepository } from './social-repository.ts';
import type { TelegramGateway } from './telegram.ts';
export class MaintenanceService {
  constructor(
    private readonly repository: SocialRepository,
    private readonly arcade: ArcadeRepository,
    private readonly groups: GroupService,
    private readonly telegram: TelegramGateway,
    private readonly now: () => number,
  ) {}
  async result(run: StoredRun): Promise<void> {
    if (run.status !== 'verified' || run.socialProcessed) return;
    for (const groupId of run.groupIds) {
      const group = await this.repository.group(groupId);
      if (!group?.active || !group.notificationsEnabled || run.verifiedAt < group.enabledAt)
        continue;
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
  async sweep(limit = 12): Promise<{ processed: number }> {
    for (const run of await this.repository.pendingResults(3)) await this.result(run);
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const job = await this.repository.claim(this.now());
      if (!job) break;
      await this.execute(job);
      processed++;
    }
    return { processed };
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
      const board = await this.arcade.leaderboard(
        { id: payload.playerId, name: 'Игрок' },
        oneOf(payload.mode, MODES),
        'all',
        0,
        { groupId: payload.chatId, membershipCheckedSince: sync.checkedSince },
      );
      if (
        !board.me ||
        board.me.rank !== payload.rank ||
        board.me.runId !== payload.runId ||
        !(await this.repository.reserveAnnouncement(payload.chatId, now, job.id))
      ) {
        await this.repository.complete(job, 'suppressed', 'Cooldown or superseded record');
        return;
      }
      const me = await this.telegram.me();
      await this.telegram.send({
        chat_id: payload.chatId,
        text: `${payload.text}\n\nХочешь побить рекорд? Заходи играть!`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎮 Побить рекорд',
                url: launchUrl(
                  me.username,
                  `game_tetris_${payload.mode}`,
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
