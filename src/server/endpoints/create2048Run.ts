import { LEGACY_2048_RULESET } from '../../games/2048/engine.ts';
import { object } from '../../shared/errors.ts';
import { endpoint, flushNotifications, puzzle2048 } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const data = object(input);
  // Older open clients still use classic spawning and must receive matching runs.
  const result = await puzzle2048.create(player, {
    ...data,
    ruleset: data.ruleset ?? LEGACY_2048_RULESET,
  });
  await flushNotifications();
  return result;
});
