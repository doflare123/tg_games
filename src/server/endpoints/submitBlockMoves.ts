import {
  blockBlast,
  blockBlastRepository,
  endpoint,
  flushNotifications,
  maintenance,
} from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await blockBlast.submit(player, input);
  if (result.status === 'verified') {
    try {
      const run = await blockBlastRepository.get(result.id);
      if (run) await maintenance.blockBlastResult(run);
    } catch (error) {
      console.error(
        'blockBlast_record_delivery_deferred',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }
  // Drain retries even after generation fails and during the next game's chunks.
  await flushNotifications();
  return result;
});
