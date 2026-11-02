import type { Player } from '../../shared/contracts.ts';
import { AppError } from '../../shared/errors.ts';
import { type BoardScope, type GroupLeaderboardState, groupId } from '../../shared/groups.ts';
import type { GroupService } from './groups.ts';

export async function leaderboardScope(
  player: Player,
  value: unknown,
  groups?: GroupService,
): Promise<{ scope: BoardScope; state: GroupLeaderboardState }> {
  if (value === undefined) return { scope: {}, state: {} };
  const id = groupId(value);
  if (!groups) throw new AppError('UNAVAILABLE', 'Группы не подключены');
  await groups.access(player, id);
  const sync = await groups.synchronize(id);
  return {
    scope: { groupId: id, membershipCheckedSince: sync.checkedSince },
    state: { membershipSync: sync.state },
  };
}
