import type { GroupRecord, Membership } from '../../shared/groups.ts';
import type { StoredRun } from './repository.ts';
export interface JobPayload {
  type: 'record';
  game?: 'tetris' | 'minesweeper' | '2048' | 'snake';
  chatId: number;
  playerId: number;
  mode: string;
  runId: string;
  rank: number;
  text: string;
}
export interface SocialJob {
  id: string;
  payload: JobPayload;
  dueAt: number;
  expiresAt: number;
  attempts: number;
}
export interface SocialRepository {
  upsertGroup(group: {
    id: number;
    title: string;
    active: boolean;
    botAdmin: boolean;
  }): Promise<void>;
  group(id: number): Promise<GroupRecord | null>;
  activeGroupIds(): Promise<number[]>;
  observeMember(member: Membership): Promise<void>;
  groupCandidates(userId: number): Promise<GroupRecord[]>;
  membersToRefresh(chatId: number, checkedSince: number, limit: number): Promise<number[]>;
  notifications(chatId: number, enabled: boolean, now: number): Promise<void>;
  reserveAnnouncement(chatId: number, now: number, jobId: string): Promise<boolean>;
  enqueue(job: SocialJob): Promise<void>;
  claim(now: number): Promise<SocialJob | null>;
  complete(
    job: SocialJob,
    status: 'done' | 'expired' | 'suppressed',
    error?: string,
  ): Promise<void>;
  retry(job: SocialJob, dueAt: number, error: string): Promise<void>;
  recover2048Expired(now: number): Promise<number>;
  pendingResults(limit: number): Promise<StoredRun[]>;
  processed(runId: string): Promise<void>;
}
