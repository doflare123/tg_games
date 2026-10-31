import { expect, it } from 'vitest';
import { directions, KeyLatch } from '../src/client/controls/key-latch.ts';
import { launchUrl, parseLaunch } from '../src/shared/launch.ts';

it('keeps shared keys pressed until all pointers and sticks release them', () => {
  const events: Array<[number, boolean]> = [];
  const keys = new KeyLatch<number>((key, pressed) => events.push([key, pressed]));
  keys.set('move', [38, 16]);
  keys.set('fire', [17]);
  keys.set('second-fire', [17]);
  keys.set('fire', []);
  expect(events).toEqual([
    [38, true],
    [16, true],
    [17, true],
  ]);
  keys.set('second-fire', []);
  expect(events.at(-1)).toEqual([17, false]);
  keys.clear();
  expect(events.slice(-2)).toEqual([
    [38, false],
    [16, false],
  ]);
  keys.clear();
  expect(events).toHaveLength(6);
});
it('supports diagonals, dead zones and deterministic direct-game routing', () => {
  expect(directions(0.1, -0.1)).toEqual({ left: false, right: false, up: false, down: false });
  expect(directions(-0.8, 0.8)).toEqual({ left: true, right: false, up: true, down: false });
  expect(parseLaunch('game_doom')).toEqual({ view: 'catalog' });
  expect(parseLaunch('game_mario')).toEqual({ view: 'catalog' });
  expect(parseLaunch('game_tetris')).toEqual({ view: 'game', game: 'tetris' });
  expect(parseLaunch('game_minesweeper')).toEqual({ view: 'game', game: 'minesweeper' });
  expect(parseLaunch('game_tetris_sprint')).toEqual({
    view: 'game',
    game: 'tetris',
    mode: 'sprint',
  });
  expect(parseLaunch('game_tetris_ultra')).toEqual({ view: 'game', game: 'tetris', mode: 'ultra' });
  expect(parseLaunch('game_tetris_bad')).toEqual({ view: 'catalog' });
  expect(parseLaunch('board_-100001')).toEqual({ view: 'leaderboard', groupId: -100001 });
  expect(parseLaunch('board_10')).toEqual({ view: 'catalog' });
  expect(launchUrl('arcade_bot', 'game_doom')).toBe('https://t.me/arcade_bot?startapp=game_doom');
});
