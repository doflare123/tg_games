export const MODES = ['marathon', 'sprint', 'ultra'] as const;
export type TetrisMode = (typeof MODES)[number];
export const ACTIONS = [
  'left',
  'right',
  'softDrop',
  'hardDrop',
  'rotateCW',
  'rotateCCW',
  'hold',
] as const;
export type TetrisAction = (typeof ACTIONS)[number];
export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Cell = PieceKind | null;
export interface Piece {
  kind: PieceKind;
  x: number;
  y: number;
  rotation: number;
}
export interface ReplayEvent {
  tick: number;
  action: TetrisAction;
}
export interface TetrisState {
  version: 1;
  mode: TetrisMode;
  board: Cell[][];
  active: Piece;
  queue: PieceKind[];
  rng: number;
  hold: PieceKind | null;
  canHold: boolean;
  tick: number;
  score: number;
  lines: number;
  level: number;
  gravityTicks: number;
  lockTicks: number;
  lockResets: number;
  combo: number;
  backToBack: boolean;
  lastRotation: boolean;
  status: 'playing' | 'won' | 'lost';
}
export const RULESET = 'tetris-arcade-v1';
export const TICKS_PER_SECOND = 60;
export const WIDTH = 10;
export const HEIGHT = 22;
export const HIDDEN_ROWS = 2;
export const MAX_TICKS = 60 * 60 * 30;
export const ULTRA_TICKS = 60 * 120;
export const MAX_CHUNK_TICKS = 600;
export const MAX_ACTIONS_PER_TICK = 4;
