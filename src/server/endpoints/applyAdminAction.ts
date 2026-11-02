import { admin, endpoint } from '../platform/runtime.ts';
export default endpoint((player, input) => admin.apply(player, input));
