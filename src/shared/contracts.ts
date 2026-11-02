import type { Ruleset2048 } from '../games/2048/engine.ts';
import type { MineSize } from '../games/minesweeper/engine.ts';
import type { ReplayEvent, TetrisMode, TetrisState } from '../games/tetris/types.ts';
import type { Board2048, Moves2048, Run2048 } from './2048.ts';
import type {
  AdminAction,
  AdminMutation,
  AdminPage,
  AdminPreview,
  AdminStats,
  AdminTable,
} from './admin.ts';
import type { FlappyBoard, FlappyReplay, FlappyRun } from './flappy.ts';
import type { GroupView } from './groups.ts';
import type { MineLeaderboard, MineResult, MineResultInput } from './minesweeper.ts';
import type { SnakeBoard, SnakeReplay, SnakeRun } from './snake.ts';
export interface Player {
  id: number;
  name: string;
}
export interface GameInfo {
  id: 'tetris' | 'minesweeper' | '2048' | 'snake' | 'flappy' | 'mario' | 'doom';
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
  {
    id: 'minesweeper',
    title: 'Сапёр',
    subtitle: '9×9 · 16×16 · 30×16 — на время',
    available: true,
    ranked: true,
  },
  {
    id: '2048',
    title: '2048',
    subtitle: 'Объединяй плитки · набирай очки',
    available: true,
    ranked: true,
  },
  {
    id: 'snake',
    title: 'Змейка',
    subtitle: 'Собирай яблоки · выбирай размер поля',
    available: true,
    ranked: true,
  },
  {
    id: 'flappy',
    title: 'Flappy Bird',
    subtitle: 'Один взмах · ещё одна труба',
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
  source: 'verified' | 'manual';
  approximate: boolean;
  durationKnown: boolean;
  rank: number;
  playerId: number;
  name: string;
  score: number;
  ticks: number;
  lines: number;
  runId: string;
}
export interface LeaderboardView {
  membershipSync?: 'complete' | 'pending' | 'failed';
  mode: TetrisMode;
  period: Period;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}
export interface Endpoints {
  getAdminStats: { input: { weeks?: number }; output: AdminStats };
  getAdminRows: { input: { table: AdminTable; page: number; search: string }; output: AdminPage };
  previewAdminAction: { input: { action: AdminAction; target: string }; output: AdminPreview };
  applyAdminAction: { input: AdminMutation; output: { id: string } };
  createFlappyRun: { input: { requestId: string }; output: FlappyRun };
  getFlappyRun: { input: { runId: string }; output: FlappyRun };
  submitFlappyReplay: { input: FlappyReplay; output: FlappyRun };
  getFlappyLeaderboard: { input: { period: Period; groupId?: number }; output: FlappyBoard };
  createSnakeRun: { input: { requestId: string; size: number }; output: SnakeRun };
  getSnakeRun: { input: { runId: string }; output: SnakeRun };
  submitSnakeReplay: { input: SnakeReplay; output: SnakeRun };
  getSnakeLeaderboard: {
    input: { size: number; period: Period; groupId?: number };
    output: SnakeBoard;
  };
  create2048Run: { input: { requestId: string; ruleset?: Ruleset2048 }; output: Run2048 };
  get2048Run: { input: { runId: string }; output: Run2048 };
  submit2048Moves: { input: Moves2048; output: Run2048 };
  get2048Leaderboard: {
    input: { period: Period; ruleset?: Ruleset2048; groupId?: number };
    output: Board2048;
  };
  submitMineResult: {
    input: MineResultInput;
    output: MineResult;
  };
  getMineLeaderboard: {
    input: { size: MineSize; period: Period; groupId?: number };
    output: MineLeaderboard;
  };
  getCatalog: { input: Record<string, never>; output: readonly GameInfo[] };
  getProfile: { input: Record<string, never>; output: Player & { isAdmin: boolean } };
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
