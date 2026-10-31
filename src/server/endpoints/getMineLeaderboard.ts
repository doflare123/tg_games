import { endpoint, minesweeper } from '../platform/runtime.ts';
export default endpoint((player, input) => minesweeper.leaderboard(player, input));
