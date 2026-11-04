import { doodle, endpoint, flushNotifications } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await doodle.leaderboard(player, input);
  await flushNotifications();
  return result;
});
