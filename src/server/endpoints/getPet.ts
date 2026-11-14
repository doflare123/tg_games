import { encodePetView } from '../../shared/tamagotchi.ts';
import { endpoint, flushNotifications, tamagotchi } from '../platform/runtime.ts';
export default endpoint(async (player) => {
  const pet = await tamagotchi.get(player);
  await flushNotifications();
  return encodePetView(pet);
});
