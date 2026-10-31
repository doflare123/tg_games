import { MODES, type TetrisMode } from '../games/tetris/types.ts';
import { CATALOG, type GameInfo } from './contracts.ts';
export type LaunchTarget =
  | { view: 'catalog' }
  | { view: 'game'; game: GameInfo['id']; mode?: TetrisMode }
  | { view: 'leaderboard'; groupId?: number };
export function parseLaunch(value: unknown): LaunchTarget {
  const mode = MODES.find((mode) => value === `game_tetris_${mode}`);
  if (mode && CATALOG.some((game) => game.id === 'tetris' && game.available))
    return { view: 'game', game: 'tetris', mode };
  const game = CATALOG.find((game) => game.available && value === `game_${game.id}`);
  if (game) return { view: 'game', game: game.id };
  if (value === 'leaderboard') return { view: 'leaderboard' };
  if (typeof value === 'string') {
    const match = /^board_(-[1-9][0-9]{0,15})$/.exec(value);
    if (match?.[1]) {
      const groupId = Number(match[1]);
      if (Number.isSafeInteger(groupId)) return { view: 'leaderboard', groupId };
    }
  }
  return { view: 'catalog' };
}
export function launchUrl(
  username: string,
  target: string,
  parameter: 'startapp' | 'start' = 'startapp',
): string {
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(username) || !/^[-a-zA-Z0-9_]{1,64}$/.test(target))
    throw new Error('Invalid Telegram deep link');
  return `https://t.me/${username}?${parameter}=${target}`;
}
