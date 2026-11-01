import type { Direction } from '../../../games/2048/engine.ts';

export interface TileTravel2048 {
  from: number;
  to: number;
  value: number;
}
export interface Motion2048 {
  tiles: TileTravel2048[];
  merged: number[];
  spawned: number[];
}

// Presentation only: the authoritative engine has already committed the move.
export function trace2048Motion(
  before: readonly number[],
  after: readonly number[],
  direction: Direction,
): Motion2048 {
  const tiles: TileTravel2048[] = [];
  const merged: number[] = [];
  const occupied = new Set<number>();
  for (let line = 0; line < 4; line++) {
    const indices = Array.from({ length: 4 }, (_, offset) => {
      const position = direction === 'right' || direction === 'down' ? 3 - offset : offset;
      return direction === 'left' || direction === 'right'
        ? line * 4 + position
        : position * 4 + line;
    });
    const sources = indices.filter((index) => (before[index] ?? 0) !== 0);
    let slot = 0;
    for (let i = 0; i < sources.length; i++) {
      const from = sources[i];
      const to = indices[slot++];
      if (from === undefined || to === undefined) continue;
      const value = before[from] ?? 0;
      tiles.push({ from, to, value });
      occupied.add(to);
      const partner = sources[i + 1];
      if (partner !== undefined && before[partner] === value) {
        tiles.push({ from: partner, to, value });
        merged.push(to);
        i++;
      }
    }
  }
  return {
    tiles,
    merged,
    spawned: after.flatMap((value, index) => (value && !occupied.has(index) ? [index] : [])),
  };
}
