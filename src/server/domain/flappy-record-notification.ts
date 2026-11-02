import type { FlappyBoard } from '../../shared/flappy.ts';
import type { StoredFlappy } from './flappy.ts';

export function flappyRecordNotification(
  run: StoredFlappy,
  before: FlappyBoard,
  after: FlappyBoard,
): string | null {
  const position = after.me;
  if (!position || position.runId !== run.id || position.rank > 10 || position.score <= 0)
    return null;
  const old = before.me;
  const first = before.entries.length === 0 && old === null && position.rank === 1;
  const improvedLeader = old?.rank === 1 && position.rank === 1 && position.score > old.score;
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
  const heading = `🏆 ${run.playerName} — №${position.rank} в группе!\nFlappy Bird · ${position.score} очков.`;
  if (first) return `${heading}\nПервый рекорд группы!`;
  if (!rival) return null;
  const difference =
    position.score > rival.score
      ? `больше на ${position.score - rival.score} очков`
      : 'при равных очках партия начата раньше';
  if (improvedLeader) return `${heading}\nУлучшен рекорд группы: ${difference}.`;
  return `${heading}\nОбошёл(ла) ${rival.name}: ${difference}.\nМесто: ${old ? old.rank : 'вне таблицы'} → ${position.rank}.`;
}
