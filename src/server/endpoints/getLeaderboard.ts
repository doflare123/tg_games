import { arcade, endpoint } from '../platform/runtime.ts';
export default endpoint((player, input) => arcade.leaderboard(player, input));
