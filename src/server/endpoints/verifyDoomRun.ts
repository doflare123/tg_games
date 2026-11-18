import { doom } from '../platform/doom-runtime.ts';
import { endpoint, flushNotifications } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const run = await doom.verify(player, input);
  await flushNotifications();
  return run;
});
