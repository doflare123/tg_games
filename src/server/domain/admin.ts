import type { Player } from '../../shared/contracts.ts';
import { AppError } from '../../shared/errors.ts';

const OWNER_ID = 930852883;
export function isAdmin(player: Player): boolean {
  return player.id === OWNER_ID;
}
export function requireAdmin(player: Player): void {
  if (!isAdmin(player)) throw new AppError('UNAUTHORIZED', 'Кабинет доступен только владельцу');
}
export const ADMIN_WEEK_MS = 7 * 86400000;
export function adminWeekStart(now: number): number {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.getTime();
}
