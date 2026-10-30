export interface DoomSave {
  name: string;
  bytes: Uint8Array;
}
export type DoomCommand =
  | { type: 'doom:start'; bytes: ArrayBuffer; saves: DoomSave[] }
  | { type: 'doom:key'; keyCode: number; pressed: boolean }
  | { type: 'doom:pause' }
  | { type: 'doom:resume' };
export type DoomEvent =
  | { type: 'doom:ready' }
  | { type: 'doom:running' }
  | { type: 'doom:error'; message: string }
  | { type: 'doom:saves'; saves: DoomSave[] };
export const DOOM_KEYS = [
  13, 27, 32, 37, 38, 39, 40, 16, 17, 49, 50, 51, 52, 53, 54, 55, 56, 57, 113, 114, 115, 116, 117,
  118, 119, 120, 121, 9, 188, 190,
] as const;
