import { describe, expect, it } from 'vitest';
import { collides, createTetris, stepTetris } from '../src/games/tetris/engine.ts';
import { cells } from '../src/games/tetris/pieces.ts';
import type { TetrisAction } from '../src/games/tetris/types.ts';
import { cloneTetris, decodeTetris } from '../src/shared/validation.ts';

describe('deterministic Tetris core', () => {
  it('uses complete seven-bags', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createTetris(seed, 'marathon');
      const sequence = [state.active.kind, ...state.queue];
      expect(new Set(sequence.slice(0, 7)).size).toBe(7);
      expect(new Set(sequence.slice(7, 14)).size).toBe(7);
    }
  });
  it('does not permit repeated hold before a lock', () => {
    const state = createTetris(43, 'marathon');
    const first = state.active.kind;
    stepTetris(state, ['hold']);
    const heldState = cloneTetris(state);
    stepTetris(state, ['hold']);
    expect(state.hold).toBe(first);
    expect(state.active.kind).toBe(heldState.active.kind);
    stepTetris(state, ['hardDrop']);
    expect(state.canHold).toBe(true);
  });
  it('clears a line, scores a perfect clear, and wins Sprint at 40 lines', () => {
    const state = createTetris(1, 'sprint');
    state.lines = 39;
    state.level = 4;
    state.board[21] = Array.from({ length: 10 }, (_, x) => (x >= 3 && x <= 6 ? null : 'J'));
    state.active = { kind: 'I', x: 3, y: 20, rotation: 0 };
    stepTetris(state, ['hardDrop']);
    expect(state.lines).toBe(40);
    expect(state.status).toBe('won');
    expect(state.score).toBe(8400);
  });
  it('clears four rows using the vertical I piece', () => {
    const state = createTetris(1, 'marathon');
    for (let y = 18; y < 22; y++)
      state.board[y] = Array.from({ length: 10 }, (_, x) => (x === 5 ? null : 'J'));
    state.active = { kind: 'I', x: 3, y: 18, rotation: 1 };
    stepTetris(state, ['hardDrop']);
    expect(state.lines).toBe(4);
    expect(state.score).toBe(2800);
  });
  it('keeps rotations inside the board with kicks', () => {
    const state = createTetris(1, 'marathon');
    state.active = { kind: 'I', x: -2, y: 3, rotation: 1 };
    expect(collides(state, state.active)).toBe(false);
    stepTetris(state, ['rotateCW']);
    expect(collides(state, state.active)).toBe(false);
    expect(cells(state.active).every(([x]) => x >= 0 && x < 10)).toBe(true);
  });
  it('ends Ultra on the exact fixed tick and ignores subsequent input', () => {
    const state = createTetris(1, 'ultra');
    state.tick = 7199;
    stepTetris(state);
    expect(state.status).toBe('won');
    expect(state.tick).toBe(7200);
    const end = cloneTetris(state);
    stepTetris(state, ['hardDrop']);
    expect(state).toEqual(end);
  });
  it('replays identically after serializing a checkpoint', () => {
    let a = createTetris(8192, 'marathon');
    const b = createTetris(8192, 'marathon');
    const actions: TetrisAction[][] = [
      ['left'],
      ['rotateCW'],
      ['right'],
      ['softDrop'],
      [],
      ['hardDrop'],
      ['hold'],
    ];
    for (let tick = 0; tick < 2000 && a.status === 'playing'; tick++) {
      const input = actions[tick % actions.length] ?? [];
      stepTetris(a, input);
      stepTetris(b, input);
      if (tick % 17 === 0) a = decodeTetris(JSON.parse(JSON.stringify(a)));
      expect(a).toEqual(b);
    }
  });
});
