import { communications, endpoint } from '../platform/runtime.ts';
export default endpoint((player) => communications.links(player));
