import { admin, endpoint } from '../platform/runtime.ts';
export default endpoint((player, input) => admin.stats(player, input));
