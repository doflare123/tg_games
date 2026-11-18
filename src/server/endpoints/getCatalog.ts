import { canAccessDoom } from '../../shared/doom-policy.ts';
import { isAdmin } from '../domain/admin.ts';
import { arcade, endpoint } from '../platform/runtime.ts';
export default endpoint((player) =>
  arcade.catalog().filter((game) => game.id !== 'doom' || canAccessDoom(isAdmin(player))),
);
