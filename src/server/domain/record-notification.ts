import type { LeaderboardView } from '../../shared/contracts.ts';
import type { StoredRun } from './repository.ts';

function time(ticks: number): string {
  return `${(ticks / 60).toFixed(2).replace('.', ',')} с`;
}
export function recordNotification(
  run: StoredRun,
  before: LeaderboardView,
  after: LeaderboardView,
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
  const mode =
    run.mode === 'sprint'
      ? 'Sprint 40 линий'
      : run.mode === 'ultra'
        ? 'Ultra 120 секунд'
        : 'Marathon';
  const value = run.mode === 'sprint' ? time(position.ticks) : `${position.score} очков`;
  const heading = `🏆 ${run.playerName} — №${position.rank} в группе!\nТетрис · ${mode}\n${value}.`;
  if (first) return `${heading}\nПервый рекорд группы!`;
  if (!rival) return null;
  let difference: string;
  if (run.mode === 'sprint')
    difference =
      position.ticks < rival.ticks
        ? `быстрее на ${time(rival.ticks - position.ticks)}`
        : 'по дополнительному показателю';
  else
    difference =
      position.score > rival.score
        ? `больше на ${position.score - rival.score} очков`
        : position.durationKnown && rival.durationKnown && position.ticks < rival.ticks
          ? `при равных очках быстрее на ${time(rival.ticks - position.ticks)}`
          : 'по дополнительному показателю';
  if (improvedLeader) return `${heading}\nУлучшен рекорд группы: ${difference}.`;
  return `${heading} Обошёл(ла) ${rival.name}: ${difference}.\nМесто: ${old ? old.rank : 'вне таблицы'} → ${position.rank}.`;
}
