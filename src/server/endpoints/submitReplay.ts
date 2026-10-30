import { arcade, endpoint, maintenance, repository } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await arcade.submit(player, input);
  if (result.status === 'verified')
    try {
      const run = await repository.get(result.id);
      if (run) await maintenance.result(run);
      await maintenance.sweep(3);
    } catch (error) {
      console.error('record_delivery_deferred', error instanceof Error ? error.message : 'unknown');
    }
  return result;
});
