import { type DoomBoard, doomTime } from '../../shared/doom.ts';
import type { DoomResult } from './doom.ts';
export function doomRecordNotification(
  result: DoomResult,
  before: DoomBoard,
  after: DoomBoard,
): string | null {
  const position = after.me;
  if (!position || position.runId !== result.id || position.rank > 10) return null;
  const old = before.me;
  const first = before.entries.length === 0 && old === null && position.rank === 1;
  const improved = old?.rank === 1 && position.rank === 1 && position.ticks < old.ticks;
  if (!first && !improved && old && position.rank >= old.rank) return null;
  const rival = improved
    ? old
    : before.entries.find(
        (entry) =>
          entry.playerId !== result.playerId &&
          entry.rank >= position.rank &&
          (!old || entry.rank < old.rank),
      );
  if (!first && !rival) return null;
  const heading = `🏆 ${result.playerName} — №${position.rank} в группе!\nFreedoom · ${result.target === 'episode' ? 'Первый эпизод' : result.target} · сложность ${result.skill} · ${result.category === 'any' ? 'На скорость' : '100% монстров и секретов'}\n${doomTime(position.ticks)}.`;
  if (first) return `${heading}\nПервый рекорд группы!`;
  return `${heading}\n${improved ? 'Улучшен рекорд группы' : `Обошёл(ла) ${rival?.name ?? ''}`}: быстрее на ${doomTime(Math.max(0, (rival?.ticks ?? position.ticks) - position.ticks))}.`;
}
