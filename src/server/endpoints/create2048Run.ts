import { endpoint, puzzle2048 } from '../platform/runtime.ts';
export default endpoint((player, input) => puzzle2048.create(player, input));
