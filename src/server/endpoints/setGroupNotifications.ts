import { endpoint, groups } from '../platform/runtime.ts';
export default endpoint((player, input) => groups.configure(player, input));
