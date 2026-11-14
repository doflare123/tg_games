import { encodePetView } from '../../shared/tamagotchi.ts';
import { endpoint, flushNotifications, tamagotchi } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const pet = await tamagotchi.act(player, input);
  await flushNotifications();
  return encodePetView(pet);
});
