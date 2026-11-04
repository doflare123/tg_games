// Server-controlled release policy. Never derive this from request or browser data.
export function isDoodleRankedEnabled(): boolean {
  return true;
}
export const DOODLE_RANKED_CLOSED_MESSAGE =
  'Рейтинг Doodle Jump отключён. Доступна только свободная игра.';
