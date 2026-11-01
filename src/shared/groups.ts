import { integer, object, text } from './errors.ts';
export interface GroupView {
  id: number;
  title: string;
  notificationsEnabled: boolean;
  canManage: boolean;
}
export interface GroupRecord {
  id: number;
  title: string;
  active: boolean;
  botAdmin: boolean;
  notificationsEnabled: boolean;
  notificationThreadId: number | null;
  enabledAt: number;
  nextNotificationAt: number;
}
export interface Membership {
  chatId: number;
  userId: number;
  active: boolean;
  updatedAt: number;
}
export interface BoardScope {
  groupId?: number;
  maxVerifiedOrder?: number;
  membershipCheckedSince?: number;
}
export function groupId(value: unknown): number {
  return integer(value, -Number.MAX_SAFE_INTEGER, -1);
}
export function decodeGroup(value: unknown): GroupView {
  const g = object(value);
  if (typeof g.notificationsEnabled !== 'boolean' || typeof g.canManage !== 'boolean')
    throw new Error('Invalid group flags');
  return {
    id: groupId(g.id),
    title: text(g.title, 1, 256),
    notificationsEnabled: g.notificationsEnabled,
    canManage: g.canManage,
  };
}
