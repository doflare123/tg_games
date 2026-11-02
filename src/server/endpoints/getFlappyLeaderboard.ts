import { endpoint, flappy, flushNotifications } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await flappy.leaderboard(player, input);
  await flushNotifications();
  return result;
});
