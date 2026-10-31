import type { MineLeaderboard } from '../../shared/minesweeper.ts';
import type { MineNotificationResult } from './minesweeper.ts';

function time(ms: number): string {
  return `${(ms / 1000).toFixed(3).replace('.', ',')} с`;
}
export function mineRecordNotification(
  run: MineNotificationResult,
  before: MineLeaderboard,
  after: MineLeaderboard,
): string | null {
  const position = after.me;
  if (!position || position.runId !== run.id || position.rank > 10) return null;
  const old = before.me;
  const first = before.entries.length === 0 && old === null && position.rank === 1;
  const improvedLeader = old?.rank === 1 && position.rank === 1;
  if (!first && !improvedLeader && old && position.rank >= old.rank) return null;
  const rival = improvedLeader
    ? old
    : before.entries.find(
        (entry) =>
          entry.playerId !== run.playerId &&
          entry.rank >= position.rank &&
          (!old || entry.rank < old.rank),
      );
  if (!first && !rival) return null;
  const heading = `🏆 ${run.playerName} — №${position.rank} в группе!\nСапёр · ${run.size.replace('x', '×')}\n${time(position.elapsedMs)}.`;
  if (first) return `${heading}\nПервый рекорд группы!`;
  if (!rival) return null;
  const difference =
    position.elapsedMs < rival.elapsedMs
      ? `быстрее на ${time(rival.elapsedMs - position.elapsedMs)}`
      : 'по дополнительному показателю';
  if (improvedLeader) return `${heading}\nУлучшен рекорд группы: ${difference}.`;
  return `${heading} Обошёл(ла) ${rival.name}: ${difference}.\nМесто: ${old ? old.rank : 'вне таблицы'} → ${position.rank}.`;
}
