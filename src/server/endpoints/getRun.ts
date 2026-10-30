import { arcade, endpoint } from '../platform/runtime.ts';
export default endpoint((player, input) => arcade.get(player, input));
