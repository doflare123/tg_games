import { MODES, type TetrisMode } from '../../games/tetris/types.ts';
import type { Player } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { groupId } from '../../shared/groups.ts';
export interface ManualResult {
  id: string;
  player: Player;
  mode: TetrisMode;
  score: number;
  ticks: number | null;
  lines: number;
  groupIds: number[];
  reason: string;
  operator: string;
  approximate: boolean;
}
export function decodeManualResult(input: unknown): ManualResult {
  const data = object(input);
  const player = object(data.player);
  const mode = oneOf(data.mode, MODES);
  const ticks = data.ticks === null ? null : integer(data.ticks, 1, 108000);
  const lines = integer(data.lines, 0, 100000);
  if (mode === 'sprint' && (ticks === null || lines < 40))
    throw new AppError('BAD_INPUT', 'Для Sprint нужны точное время и минимум 40 линий');
  if (!Array.isArray(data.groupIds) || data.groupIds.length > 50)
    throw new AppError('BAD_INPUT', 'Некорректные группы корректировки');
  if (typeof data.approximate !== 'boolean')
    throw new AppError('BAD_INPUT', 'Укажи точность счёта');
  const id = text(data.id, 1, 100);
  if (!/^manual:[a-zA-Z0-9:_-]+$/.test(id))
    throw new AppError('BAD_INPUT', 'Некорректный id корректировки');
  return {
    id,
    player: { id: integer(player.id, 1, Number.MAX_SAFE_INTEGER), name: text(player.name, 1, 100) },
    mode,
    score: integer(data.score, 0, Number.MAX_SAFE_INTEGER),
    ticks,
    lines,
    groupIds: [...new Set(data.groupIds.map(groupId))].sort((a, b) => a - b),
    reason: text(data.reason, 10, 2000),
    operator: text(data.operator, 1, 200),
    approximate: data.approximate,
  };
}
