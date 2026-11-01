import type { Board2048 } from '../../shared/2048.ts';
import type { Stored2048 } from './2048.ts';

export function record2048Notification(
  run: Stored2048,
  before: Board2048,
  after: Board2048,
): string | null {
  const position = after.me;
  if (!position || position.runId !== run.id || position.rank > 10) return null;
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
  const heading = `🏆 ${run.playerName} — №${position.rank} в группе!\n2048 · ${position.score} очков · плитка ${position.maxTile}.\n${run.state.version === 2 ? 'Режим: рост плиток.' : 'Режим: классика.'}`;
  if (first) return `${heading}\nПервый рекорд группы!`;
  if (!rival) return null;
  const difference =
    position.score > rival.score
      ? `больше на ${position.score - rival.score} очков`
      : 'при равных очках партия начата раньше';
  if (improvedLeader) return `${heading}\nУлучшен рекорд группы: ${difference}.`;
  return `${heading}\nОбошёл(ла) ${rival.name}: ${difference}.\nМесто: ${old ? old.rank : 'вне таблицы'} → ${position.rank}.`;
}
