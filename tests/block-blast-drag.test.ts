import { describe, expect, it } from 'vitest';
import { blockDragOrigin } from '../src/client/games/block-blast/drag.ts';

describe('Block Blast drag response', () => {
  const start = { x: 180, y: 700 };
  const piece = { width: 120, height: 80, cellSize: 40 };

  it('keeps mouse movement centred and one-to-one', () => {
    expect(blockDragOrigin(start, { x: 320, y: 240 }, piece, false)).toEqual({ x: 260, y: 200 });
  });
  it('lifts the whole piece above a finger at pickup, including tall pieces', () => {
    for (const height of [40, 80, 200]) {
      const origin = blockDragOrigin(start, start, { ...piece, height }, true);
      expect(origin.y + height).toBeLessThanOrEqual(start.y - 40);
      expect(origin.x + piece.width / 2).toBe(start.x);
    }
  });
  it('moves upward 50% faster and grows the clearance above the finger', () => {
    const initial = blockDragOrigin(start, start, piece, true);
    const finger = { x: start.x, y: start.y - 80 };
    const moved = blockDragOrigin(start, finger, piece, true);
    expect(initial.y - moved.y).toBe(120);
    expect(finger.y - moved.y - piece.height).toBeGreaterThan(start.y - initial.y - piece.height);
  });
  it('reaches a distant row with less finger travel, with modest symmetric horizontal gain', () => {
    const initial = blockDragOrigin(start, start, piece, true);
    const moved = blockDragOrigin(start, { x: start.x + 50, y: start.y - 160 }, piece, true);
    expect(initial.y - moved.y).toBe(240);
    expect(moved.x - initial.x).toBe(60);
    expect(initial.x - blockDragOrigin(start, { x: start.x - 50, y: start.y }, piece, true).x).toBe(
      60,
    );
  });
  it('reverses without hysteresis and bounds the additional lift on long gestures', () => {
    const initial = blockDragOrigin(start, start, piece, true);
    for (const y of [680, 600, 400, 600, 680, 700]) {
      const pointer = { x: start.x, y };
      const actual = blockDragOrigin(start, pointer, piece, true);
      expect(pointer.y - actual.y - piece.height).toBeLessThanOrEqual(44 + 3 * piece.cellSize);
    }
    expect(blockDragOrigin(start, start, piece, true)).toEqual(initial);
    const below = blockDragOrigin(start, { x: start.x, y: start.y + 20 }, piece, true);
    expect(below.y - initial.y).toBe(20);
  });
  it('scales its gap for phone and tablet cells without covering the contact point', () => {
    for (const cellSize of [24, 36, 48, 80]) {
      const height = cellSize * 5;
      const origin = blockDragOrigin(start, start, { width: cellSize * 2, height, cellSize }, true);
      const gap = start.y - origin.y - height;
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(64);
    }
  });
});
