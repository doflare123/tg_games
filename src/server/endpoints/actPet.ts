import { encodePetView } from '../../shared/tamagotchi.ts';
import { endpoint, tamagotchi } from '../platform/runtime.ts';
export default endpoint(async (player, input) => {
  const pet = await tamagotchi.act(player, input);
  return encodePetView(pet);
});
