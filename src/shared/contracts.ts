import type { ReplayEvent, TetrisMode, TetrisState } from '../games/tetris/types.ts';
import type { GroupView } from './groups.ts';
export interface Player {
  id: number;
  name: string;
}
export interface GameInfo {
  id: 'tetris' | 'mario' | 'doom';
  title: string;
  subtitle: string;
  available: boolean;
  ranked: boolean;
}
export const CATALOG: readonly GameInfo[] = [
  {
    id: 'tetris',
    title: 'Тетрис',
    subtitle: 'Marathon · Sprint · Ultra',
    available: true,
    ranked: true,
  },
];
export type RunStatus = 'active' | 'verified' | 'unranked' | 'abandoned';
export interface RunView {
  id: string;
  mode: TetrisMode;
  revision: number;
  ruleset: string;
  state: TetrisState;
  status: RunStatus;
  createdAt: number;
  expiresAt: number;
}
export interface ReplayInput {
  runId: string;
  revision: number;
  untilTick: number;
  events: ReplayEvent[];
}
export type Period = 'all' | 'week';
export interface LeaderboardEntry {
  rank: number;
  playerId: number;
  name: string;
  score: number;
  ticks: number;
  lines: number;
  runId: string;
}
export interface LeaderboardView {
  mode: TetrisMode;
  period: Period;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}
export interface Endpoints {
  getCatalog: { input: Record<string, never>; output: readonly GameInfo[] };
  getProfile: { input: Record<string, never>; output: Player };
  createRun: { input: { requestId: string; mode: TetrisMode }; output: RunView };
  submitReplay: { input: ReplayInput; output: RunView };
  getRun: { input: { runId: string }; output: RunView };
  abandonRun: { input: { runId: string }; output: RunView };
  getGroups: { input: Record<string, never>; output: GroupView[] };
  setGroupNotifications: { input: { groupId: number; enabled: boolean }; output: GroupView };
  getLeaderboard: {
    input: { mode: TetrisMode; period: Period; groupId?: number };
    output: LeaderboardView;
  };
  probeRuntime: {
    input: Record<string, never>;
    output: { runtime: string; wasm: boolean; crypto: boolean; now: number };
  };
}
export type EndpointName = keyof Endpoints;
export type EndpointInput<K extends EndpointName> = Endpoints[K]['input'];
export type EndpointOutput<K extends EndpointName> = Endpoints[K]['output'];
