import { encodePetView } from '../../shared/tamagotchi.ts';
import { endpoint, tamagotchi } from '../platform/runtime.ts';
export default endpoint(async (player) => {
  const pet = await tamagotchi.get(player);
  return encodePetView(pet);
});
