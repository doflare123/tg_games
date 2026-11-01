import {
  endpoint,
  flushNotifications,
  maintenance,
  snake,
  snakeRepository,
} from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await snake.submit(player, input);
  if (result.status === 'verified') {
    try {
      const run = await snakeRepository.get(result.id);
      if (run) await maintenance.snakeResult(run);
    } catch (error) {
      console.error(
        'snake_record_delivery_deferred',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }
  await flushNotifications();
  return result;
});
