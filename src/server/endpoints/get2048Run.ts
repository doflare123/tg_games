import { endpoint, flushNotifications, puzzle2048 } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await puzzle2048.get(player, input);
  await flushNotifications();
  return result;
});
