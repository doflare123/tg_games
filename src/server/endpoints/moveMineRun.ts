import { endpoint, minesweeper } from '../platform/runtime.ts';
export default endpoint((player, input) => minesweeper.move(player, input));
