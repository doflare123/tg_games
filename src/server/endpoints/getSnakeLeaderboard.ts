import { endpoint, flushNotifications, snake } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await snake.leaderboard(player, input);
  await flushNotifications();
  return result;
});
