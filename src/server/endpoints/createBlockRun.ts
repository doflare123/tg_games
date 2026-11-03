import { blockBlast, endpoint, flushNotifications } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await blockBlast.create(player, input);
  await flushNotifications();
  return result;
});
