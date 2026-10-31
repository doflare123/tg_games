import { expect, it } from 'vitest';
import { TetrisGestures } from '../src/client/games/tetris/gestures.ts';
import type { TetrisAction } from '../src/games/tetris/types.ts';

function setup() {
  const actions: TetrisAction[] = [];
  const acceleration: boolean[] = [];
  const gestures = new TetrisGestures(
    (action) => actions.push(action),
    (down) => acceleration.push(down),
  );
  const p = (x: number, y: number, time: number, id = 1) => ({ id, x, y, time });
  return { gestures, actions, acceleration, p };
}
it('rotates once for a tap, tolerates jitter and does not rotate after a hold', () => {
  const { gestures: g, actions, acceleration, p } = setup();
  g.begin(p(100, 100, 0), 20);
  g.move(p(104, 103, 40));
  g.end(p(104, 103, 100));
  expect(actions).toEqual(['rotateCW']);
  g.begin(p(100, 100, 200), 20);
  g.update(420);
  g.end(p(100, 100, 600));
  expect(actions).toEqual(['rotateCW']);
  expect(acceleration).toEqual([true, false]);
});
it('drags across several columns and reverses without producing a tap or drop', () => {
  const { gestures: g, actions, p } = setup();
  g.begin(p(100, 100, 0), 20);
  g.move(p(160, 100, 50));
  g.move(p(130, 100, 100));
  g.end(p(130, 100, 150));
  expect(actions).toEqual(['right', 'right', 'right', 'right', 'left', 'left']);
});
it('keeps small initial moves and locks horizontal intention on diagonal movement', () => {
  const { gestures: g, actions, p } = setup();
  g.begin(p(100, 100, 0), 20);
  g.move(p(107, 100, 20));
  g.move(p(116, 100, 30));
  g.move(p(116, 180, 80));
  g.end(p(116, 180, 100));
  expect(actions).toEqual(['right']);
});
it('drops exactly one piece for a fast down swipe and consumes the rest of that contact', () => {
  const { gestures: g, actions, acceleration, p } = setup();
  g.begin(p(100, 100, 0), 20);
  g.move(p(101, 165, 70));
  g.move(p(101, 260, 100));
  g.update(500);
  g.end(p(101, 260, 550));
  expect(actions).toEqual(['hardDrop']);
  expect(acceleration).toEqual([]);
});
it('accelerates on a slow down drag and always releases on cancellation', () => {
  const { gestures: g, actions, acceleration, p } = setup();
  g.begin(p(100, 100, 0), 20);
  g.move(p(100, 160, 300));
  g.cancel(1);
  g.update(900);
  expect(actions).toEqual([]);
  expect(acceleration).toEqual([true, false]);
});
it('ignores a second finger and releases a hold on reset without rotating', () => {
  const { gestures: g, actions, acceleration, p } = setup();
  g.begin(p(100, 100, 0), 20);
  expect(g.begin(p(100, 100, 20, 2), 20)).toBe(false);
  g.update(220);
  g.end(p(120, 200, 250, 2));
  expect(g.pointerId).toBe(1);
  g.cancel();
  g.end(p(100, 100, 300));
  expect(g.pointerId).toBeNull();
  expect(actions).toEqual([]);
  expect(acceleration).toEqual([true, false]);
});
