import {
  doodle,
  doodleRepository,
  endpoint,
  flushNotifications,
  maintenance,
} from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await doodle.submit(player, input);
  if (result.status === 'verified') {
    try {
      const run = await doodleRepository.get(result.id);
      if (run) await maintenance.doodleResult(run);
    } catch (error) {
      console.error(
        'doodle_record_delivery_deferred',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }
  await flushNotifications();
  return result;
});
