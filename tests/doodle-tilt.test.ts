import { describe, expect, it } from 'vitest';
import { screenTilt, TiltInput } from '../src/client/games/doodle/tilt-input.ts';

describe('Doodle Jump tilt input', () => {
  it('projects orientation onto screen horizontal in all four rotations', () => {
    expect(screenTilt(20, 10, 0)).toBeCloseTo(10);
    expect(screenTilt(20, 10, 90)).toBeCloseTo(20);
    expect(screenTilt(20, 10, 180)).toBeCloseTo(-10);
    expect(screenTilt(20, 10, 270)).toBeCloseTo(-20);
    expect(screenTilt(20, 10, -90)).toBeCloseTo(-20);
    for (const args of [
      [null, 0, 0],
      [0, NaN, 0],
      [181, 0, 0],
      [0, 91, 0],
      [0, 0, Infinity],
      ['0', 0, 0],
    ])
      expect(screenTilt(args[0], args[1], args[2])).toBeNull();
  });
  it('calibrates a comfortable neutral, filters jitter, and stops on stale data', () => {
    const input = new TiltInput();
    input.sample(15, 0);
    for (let i = 1; i <= 20; i++) input.sample(15 + (i % 2 ? 2 : -2), i * 40);
    expect(input.direction(800)).toBe(0);
    for (let i = 21; i <= 30; i++) input.sample(35, i * 40);
    expect(input.direction(1200)).toBe(1);
    expect(input.direction(1701)).toBe(0);
    input.sample(35, 1800);
    input.calibrate();
    expect(input.direction(1800)).toBe(0);
    for (let i = 1; i <= 8; i++) input.sample(15, 1800 + i * 40);
    expect(input.direction(2120)).toBe(-1);
    input.reset();
    expect(input.direction(2120)).toBe(0);
    input.sample(-25, 2200);
    expect(input.direction(2200)).toBe(0);
  });
  it('keeps the neutral stable across angle wrap and ignores invalid samples', () => {
    const input = new TiltInput();
    input.sample(179, 0);
    for (let i = 1; i <= 10; i++) input.sample(-179, i * 40);
    expect(input.direction(400)).toBe(0);
    input.sample(NaN, 410);
    input.sample(Infinity, 420);
    expect(input.direction(450)).toBe(0);
    for (let i = 11; i <= 20; i++) input.sample(-160, i * 40);
    expect(input.direction(800)).toBe(1);
  });
});
