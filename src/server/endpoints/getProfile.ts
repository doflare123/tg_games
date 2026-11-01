import { endpoint, flushNotifications } from '../platform/runtime.ts';
export default endpoint(async (player) => {
  await flushNotifications();
  return player;
});
