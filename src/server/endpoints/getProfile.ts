import { isAdmin } from '../domain/admin.ts';
import { admin, endpoint, flushNotifications } from '../platform/runtime.ts';
export default endpoint(async (player) => {
  try {
    await admin.observe(player);
  } catch {
    console.warn('analytics_visit_deferred');
  }
  await flushNotifications();
  return { ...player, isAdmin: isAdmin(player) };
});
