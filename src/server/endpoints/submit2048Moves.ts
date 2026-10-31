import { endpoint, maintenance, puzzle2048, puzzle2048Repository } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await puzzle2048.submit(player, input);
  if (result.status === 'verified') {
    try {
      const run = await puzzle2048Repository.get(result.id);
      if (run) await maintenance.result2048(run);
      await maintenance.sweep(3);
    } catch (error) {
      console.error(
        'puzzle2048_record_delivery_deferred',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }
  return result;
});
