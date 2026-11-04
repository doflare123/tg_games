import type { SupportMedia } from './support-media.ts';
export const DELIVERY_STATES = [
  'pending',
  'running',
  'sent',
  'failed',
  'uncertain',
  'cancelled',
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export interface SupportThread {
  id: number;
  playerId: number;
  name: string;
  updatedAt: number;
  status: 'new' | 'waiting' | 'answered';
  closed: boolean;
  incomingOrder: number;
}
export interface SupportMessage {
  id: string;
  threadId?: number;
  playerId: number;
  direction: 'player' | 'owner';
  body: string;
  createdAt: number;
  delivery: DeliveryState;
  media?: SupportMedia;
}
export interface CommunicationJob {
  id: string;
  threadId?: number;
  kind: 'owner_inbox' | 'player_reply' | 'broadcast';
  playerId: number;
  chatId: number;
  body: string;
  attempts: number;
  expiresAt: number;
  media?: SupportMedia;
}
export interface CommunicationSession {
  mode: 'groups' | 'broadcast_text' | 'reply';
  id: string;
  selected: number[];
  playerId: number;
  threadId?: number;
  page: number;
  panelMessageId?: number;
}
export interface Broadcast {
  id: string;
  body: string;
  groupIds: number[];
  status: 'draft' | 'queued' | 'cancelled';
  createdAt: number;
}
export interface BroadcastGroup {
  id: number;
  title: string;
}
export interface CommunicationsRepository {
  receive(message: SupportMessage, name: string): Promise<boolean>;
  threads(page: number, closed?: boolean): Promise<SupportThread[]>;
  thread(playerId: number): Promise<SupportThread | null>;
  conversation(threadId: number): Promise<SupportThread | null>;
  markRead(threadId: number, throughOrder: number): Promise<void>;
  closeThread(threadId: number, closed: boolean): Promise<void>;
  history(playerId: number, page?: number, threadId?: number): Promise<SupportMessage[]>;
  recipientForReply(messageId: number): Promise<number | null>;
  threadForReply(messageId: number): Promise<SupportThread | null>;
  session(now: number): Promise<CommunicationSession | null>;
  setSession(session: CommunicationSession | null, now: number): Promise<void>;
  groups(): Promise<BroadcastGroup[]>;
  draft(broadcast: Broadcast): Promise<void>;
  broadcast(id: string): Promise<Broadcast | null>;
  confirm(id: string, now: number): Promise<void>;
  cancel(id: string): Promise<void>;
  claim(now: number, broadcastId?: string): Promise<CommunicationJob | null>;
  finish(
    job: CommunicationJob,
    status: DeliveryState,
    error?: string,
    telegramMessageId?: number,
  ): Promise<void>;
  retry(job: CommunicationJob, at: number, error: string, cooldown?: boolean): Promise<void>;
  deliverySummary(broadcastId?: string): Promise<{ status: DeliveryState; count: number }[]>;
  deliveryIssues(): Promise<{ id: string; chatId: number; status: DeliveryState; error: string }[]>;
  retryDelivery(id: string, now: number): Promise<void>;
}
