import { endpoint, groups } from '../platform/runtime.ts';
export default endpoint((player) => groups.list(player));
