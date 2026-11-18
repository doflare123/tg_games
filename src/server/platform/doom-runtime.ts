import createDoom from 'doom-headless-engine';
import { DoomService } from '../domain/doom.ts';
import { serverDoomWad } from './doom-assets.ts';
import { WasmDoomVerifier } from './doom-verifier.ts';
import { doomRepository, groups } from './runtime.ts';

// Ordinary arcade endpoints never import the engine or compressed IWAD modules.
export const doom = new DoomService(
  doomRepository,
  new WasmDoomVerifier(serverDoomWad, createDoom),
  () => Date.now(),
  groups,
);
