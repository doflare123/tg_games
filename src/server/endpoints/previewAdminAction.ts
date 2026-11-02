import { admin, endpoint } from '../platform/runtime.ts';
export default endpoint((player, input) => admin.preview(player, input));
