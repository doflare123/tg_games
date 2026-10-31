import { expect, it } from 'vitest';
import { MineTimer } from '../src/client/games/minesweeper/timer.ts';
import { MINE_LIMIT_MS } from '../src/games/minesweeper/engine.ts';

it('keeps thirty seconds at thirty seconds through repeated clicks and reads', () => {
  let now = 1000;
  const timer = new MineTimer(() => now);
  timer.start();
  now = 31000;
  for (let click = 0; click < 5; click++) {
    timer.start();
    for (let frame = 0; frame < 200; frame++) expect(timer.elapsedMs()).toBe(30000);
  }
  now += 15000;
  expect(timer.elapsedMs()).toBe(45000);
});

it('measures long idle intervals without relying on callback counts', () => {
  let now = 0;
  const timer = new MineTimer(() => now);
  expect(timer.elapsedMs()).toBe(0);
  timer.start();
  now = 125000;
  expect(timer.elapsedMs()).toBe(125000);
  now = 125000.95;
  expect(timer.elapsedMs()).toBe(125000);
});

it('freezes at the finishing click without counting calculations or result upload afterwards', () => {
  let now = 100;
  const timer = new MineTimer(() => now);
  timer.start();
  now = 30100;
  const finishingClick = now;
  now += 500;
  timer.finish(finishingClick);
  expect(timer.elapsedMs()).toBe(30000);
  now += 60000;
  timer.finish();
  timer.start();
  expect(timer.elapsedMs()).toBe(30000);
});

it('starts each new attempt from zero and ignores time before its first reveal', () => {
  let now = 1000;
  const timer = new MineTimer(() => now);
  timer.start();
  now = 31000;
  timer.finish();
  timer.reset();
  now = 90000;
  expect(timer.elapsedMs()).toBe(0);
  timer.start();
  now += 250;
  expect(timer.elapsedMs()).toBe(250);
});

it('caps the timer at the game limit and never returns a negative duration', () => {
  let now = 500;
  const timer = new MineTimer(() => now);
  timer.start();
  expect(timer.elapsedMs(499)).toBe(0);
  now += MINE_LIMIT_MS + 50000;
  expect(timer.elapsedMs()).toBe(MINE_LIMIT_MS);
});
