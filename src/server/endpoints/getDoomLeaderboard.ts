import { doom } from '../platform/doom-runtime.ts';
import { endpoint } from '../platform/runtime.ts';
export default endpoint((player, input) => doom.leaderboard(player, input));
