import {
  endpoint,
  flappy,
  flappyRepository,
  flushNotifications,
  maintenance,
} from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await flappy.submit(player, input);
  if (result.status === 'verified') {
    try {
      const run = await flappyRepository.get(result.id);
      if (run) await maintenance.flappyResult(run);
    } catch (error) {
      console.error(
        'flappy_record_delivery_deferred',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }
  await flushNotifications();
  return result;
});
