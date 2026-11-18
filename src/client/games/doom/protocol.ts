import type { DoomCommandSpan, DoomSkill } from '../../../shared/doom.ts';
export type DoomCommand =
  | { type: 'doom:start'; skill: DoomSkill; commands: DoomCommandSpan[] }
  | { type: 'doom:key'; keyCode: number; pressed: boolean }
  | { type: 'doom:pause' }
  | { type: 'doom:resume' };
export type DoomEvent =
  | { type: 'doom:ready' }
  | { type: 'doom:running'; tick: number }
  | { type: 'doom:error'; message: string }
  | { type: 'doom:pause-request' }
  | { type: 'doom:paused'; tick: number }
  | {
      type: 'doom:commands';
      fromTick: number;
      commands: DoomCommandSpan[];
      map: number;
      activeTicks: number;
      finished: boolean;
    };
export const DOOM_KEYS = [
  13, 27, 32, 37, 38, 39, 40, 16, 17, 49, 50, 51, 52, 53, 54, 55, 9, 188, 190,
] as const;
