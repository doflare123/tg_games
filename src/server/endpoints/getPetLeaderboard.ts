import { endpoint, tamagotchi } from '../platform/runtime.ts';
export default endpoint((player, input) => tamagotchi.leaderboard(player, input));
