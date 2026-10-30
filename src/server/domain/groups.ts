import type { Player } from '../../shared/contracts.ts';
import { AppError, object } from '../../shared/errors.ts';
import { type GroupView, groupId } from '../../shared/groups.ts';
import type { SocialRepository } from './social-repository.ts';
import type { TelegramGateway } from './telegram.ts';
export class GroupService {
  constructor(
    readonly repository: SocialRepository,
    private readonly telegram: TelegramGateway,
    private readonly now: () => number,
  ) {}
  async access(player: Player, id: number, requireAdmin = false): Promise<GroupView> {
    const group = await this.repository.group(groupId(id));
    if (!group?.active) throw new AppError('NOT_FOUND', 'Группа не подключена к Arcade');
    if (!group.botAdmin)
      throw new AppError('UNAVAILABLE', 'Для группового рейтинга сделай бота администратором');
    let member: Awaited<ReturnType<TelegramGateway['member']>>;
    try {
      member = await this.telegram.member(id, player.id);
    } catch {
      throw new AppError('UNAVAILABLE', 'Не удалось проверить участие в группе');
    }
    await this.repository.observeMember({
      chatId: id,
      userId: player.id,
      active: member.active,
      updatedAt: this.now(),
    });
    if (!member.active) throw new AppError('UNAUTHORIZED', 'Ты больше не состоишь в этой группе');
    if (requireAdmin && !member.admin)
      throw new AppError('UNAUTHORIZED', 'Настройку меняет только администратор группы');
    return {
      id,
      title: group.title,
      notificationsEnabled: group.notificationsEnabled,
      canManage: member.admin,
    };
  }
  async list(player: Player): Promise<GroupView[]> {
    const groups = await this.repository.groupsFor(player.id);
    const result: GroupView[] = [];
    // Bound platform calls per invocation; no group names are returned before membership verification.
    for (let start = 0; start < groups.length; start += 4) {
      const batch = await Promise.all(
        groups.slice(start, start + 4).map(async (group) => {
          try {
            return await this.access(player, group.id);
          } catch (error) {
            if (
              error instanceof AppError &&
              (error.code === 'UNAUTHORIZED' || error.code === 'NOT_FOUND')
            )
              return null;
            throw error;
          }
        }),
      );
      for (const group of batch) if (group) result.push(group);
    }
    return result;
  }
  async snapshot(player: Player): Promise<number[]> {
    return (await this.list(player)).map((group) => group.id);
  }
  async configure(player: Player, input: unknown): Promise<GroupView> {
    const data = object(input);
    const id = groupId(data.groupId);
    if (typeof data.enabled !== 'boolean')
      throw new AppError('BAD_INPUT', 'Укажи, включать ли уведомления');
    await this.access(player, id, true);
    await this.repository.notifications(id, data.enabled, this.now());
    return this.access(player, id);
  }
}
