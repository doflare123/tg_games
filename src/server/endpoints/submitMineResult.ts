import { endpoint, maintenance, mineRepository, minesweeper } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const result = await minesweeper.submit(player, input);
  try {
    const run = await mineRepository.getStored(result.id);
    if (run) await maintenance.mineResult(run);
    await maintenance.sweep(3);
  } catch (error) {
    console.error(
      'mine_record_delivery_deferred',
      error instanceof Error ? error.message : 'unknown',
    );
  }
  return result;
});
