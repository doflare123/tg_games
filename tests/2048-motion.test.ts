import { describe, expect, it } from 'vitest';
import { trace2048Motion } from '../src/client/games/2048/motion.ts';

describe('2048 motion mapping', () => {
  it('maps both source tiles into each merge without chain merging', () => {
    const before = [2, 2, 2, 2, ...Array<number>(12).fill(0)];
    const after = [4, 4, 0, 2, ...Array<number>(12).fill(0)];
    const snapshot = [...before];
    expect(trace2048Motion(before, after, 'left')).toEqual({
      tiles: [
        { from: 0, to: 0, value: 2 },
        { from: 1, to: 0, value: 2 },
        { from: 2, to: 1, value: 2 },
        { from: 3, to: 1, value: 2 },
      ],
      merged: [0, 1],
      spawned: [3],
    });
    expect(before).toEqual(snapshot);
  });
  it('keeps the original value visible during a slide into a larger tile', () => {
    const before = [2, 0, 2, 4, ...Array<number>(12).fill(0)];
    const after = [4, 4, 0, 0, 2, ...Array<number>(11).fill(0)];
    expect(trace2048Motion(before, after, 'left')).toEqual({
      tiles: [
        { from: 0, to: 0, value: 2 },
        { from: 2, to: 0, value: 2 },
        { from: 3, to: 1, value: 4 },
      ],
      merged: [0],
      spawned: [4],
    });
  });
  it.each([
    ['right', 0, 1, 3],
    ['up', 0, 4, 0],
    ['down', 0, 4, 12],
  ] as const)(
    'maps %s merges in the direction of travel',
    (direction, first, second, destination) => {
      const before = Array<number>(16).fill(0);
      before[first] = 8;
      before[second] = 8;
      const after = Array<number>(16).fill(0);
      after[destination] = 16;
      after[15] = 2;
      const motion = trace2048Motion(before, after, direction);
      expect(motion.tiles.map((tile) => tile.to)).toEqual([destination, destination]);
      expect(motion.merged).toEqual([destination]);
      expect(motion.spawned).toEqual([15]);
    },
  );
});
