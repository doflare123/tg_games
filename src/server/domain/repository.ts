import type { TetrisMode } from '../../games/tetris/types.ts';
import type {
  LeaderboardView,
  Period,
  Player,
  RunStatus,
  RunView,
} from '../../shared/contracts.ts';
import type { BoardScope } from '../../shared/groups.ts';
export interface StoredRun extends RunView {
  playerId: number;
  playerName: string;
  lastSubmission: string | null;
  groupIds: number[];
  verifiedOrder: number;
  verifiedAt: number;
  socialProcessed: boolean;
}
export interface ArcadeRepository {
  create(run: StoredRun): Promise<StoredRun>;
  get(id: string): Promise<StoredRun | null>;
  save(run: StoredRun, expectedRevision: number): Promise<boolean>;
  countRecent(playerId: number, since: number): Promise<number>;
  leaderboard(
    player: Player,
    mode: TetrisMode,
    period: Period,
    since: number,
    scope?: BoardScope,
  ): Promise<LeaderboardView>;
}
export function runView(run: StoredRun): RunView {
  return {
    id: run.id,
    mode: run.mode,
    revision: run.revision,
    ruleset: run.ruleset,
    state: run.state,
    status: run.status,
    createdAt: run.createdAt,
    expiresAt: run.expiresAt,
  };
}
export function finalStatus(state: StoredRun['state']): RunStatus {
  if (state.status === 'playing') return 'active';
  if (state.mode === 'sprint' && state.lines < 40) return 'unranked';
  return 'verified';
}
