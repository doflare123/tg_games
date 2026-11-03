export const BLOCK_RULESET = 'block-blast-v1';
export const BLOCK_SIZE = 8;
export const BLOCK_MAX_CHUNK = 24;
export interface BlockMove {
  slot: number;
  x: number;
  y: number;
}
export interface BlockState {
  board: number[];
  tray: (number | null)[];
  rng: number;
  score: number;
  moves: number;
  lines: number;
  clears: number;
  status: 'playing' | 'over';
}
// Each orientation is a separate piece: there is no rotation during play.
const PATTERNS = [
  ['1'],
  ['11'],
  ['1', '1'],
  ['111'],
  ['1', '1', '1'],
  ['1111'],
  ['1', '1', '1', '1'],
  ['11111'],
  ['1', '1', '1', '1', '1'],
  ['11', '11'],
  ['111', '111'],
  ['11', '11', '11'],
  ['111', '111', '111'],
  ['10', '11'],
  ['01', '11'],
  ['11', '10'],
  ['11', '01'],
  ['100', '100', '111'],
  ['001', '001', '111'],
  ['111', '100', '100'],
  ['111', '001', '001'],
  ['111', '010'],
  ['10', '11', '10'],
  ['010', '111'],
  ['01', '11', '01'],
  ['110', '011'],
  ['011', '110'],
  ['01', '11', '10'],
  ['10', '11', '01'],
];
export const BLOCK_SHAPES = PATTERNS.map((rows) => ({
  width: rows[0]?.length ?? 1,
  height: rows.length,
  cells: rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '1' ? [{ x, y }] : []))),
}));
export function canPlaceBlock(
  board: readonly number[],
  piece: number,
  x: number,
  y: number,
): boolean {
  const shape = BLOCK_SHAPES[piece];
  return (
    !!shape &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x + shape.width <= BLOCK_SIZE &&
    y + shape.height <= BLOCK_SIZE &&
    shape.cells.every((cell) => board[(y + cell.y) * BLOCK_SIZE + x + cell.x] === 0)
  );
}
export function blockPlacements(
  board: readonly number[],
  piece: number,
): { x: number; y: number }[] {
  const shape = BLOCK_SHAPES[piece];
  const result: { x: number; y: number }[] = [];
  if (!shape) return result;
  for (let y = 0; y <= BLOCK_SIZE - shape.height; y++)
    for (let x = 0; x <= BLOCK_SIZE - shape.width; x++)
      if (canPlaceBlock(board, piece, x, y)) result.push({ x, y });
  return result;
}
export function placeBlock(
  board: number[],
  piece: number,
  x: number,
  y: number,
): { lines: number; clear: boolean; cells: number[] } | null {
  if (!canPlaceBlock(board, piece, x, y)) return null;
  for (const cell of BLOCK_SHAPES[piece]?.cells ?? [])
    board[(y + cell.y) * BLOCK_SIZE + x + cell.x] = (piece % 6) + 1;
  const rows: number[] = [];
  const columns: number[] = [];
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (Array.from({ length: BLOCK_SIZE }, (_, j) => board[i * BLOCK_SIZE + j]).every(Boolean))
      rows.push(i);
    if (Array.from({ length: BLOCK_SIZE }, (_, j) => board[j * BLOCK_SIZE + i]).every(Boolean))
      columns.push(i);
  }
  const cells: number[] = [];
  // Detect both axes before clearing: intersections count as two lines, one cell.
  for (let i = 0; i < board.length; i++)
    if (rows.includes(Math.floor(i / BLOCK_SIZE)) || columns.includes(i % BLOCK_SIZE)) {
      board[i] = 0;
      cells.push(i);
    }
  return { lines: rows.length + columns.length, clear: board.every((cell) => cell === 0), cells };
}
function random(cursor: { rng: number }, max: number): number {
  cursor.rng = (Math.imul(cursor.rng, 1664525) + 1013904223) >>> 0;
  return Math.floor((cursor.rng / 0x100000000) * max);
}
/** Construct legal three-move witnesses, then prefer constrained, varied combinations.
 * This is bounded work, with no rejection loop or probabilistic solvability promise.
 * A single cell is the fallback: any stable board has an empty cell, and filling
 * its last empty cell necessarily clears a line, so three placements always exist.
 */
export function generateBlockTray(
  board: readonly number[],
  rng: number,
): {
  tray: number[];
  rng: number;
  solution: BlockMove[];
} {
  const cursor = { rng };
  const initial = BLOCK_SHAPES.map((_, piece) => blockPlacements(board, piece).length);
  let best: { tray: number[]; solution: BlockMove[]; difficulty: number } | undefined;
  for (let attempt = 0; attempt < 16; attempt++) {
    const simulated = [...board];
    const tray: number[] = [];
    const solution: BlockMove[] = [];
    let difficulty = 0;
    for (let slot = 0; slot < 3; slot++) {
      const options = BLOCK_SHAPES.map((_, piece) => ({
        piece,
        positions: blockPlacements(simulated, piece),
      })).filter((option) => option.piece !== 0 && option.positions.length > 0);
      const choice = options[random(cursor, options.length)] ?? {
        piece: 0,
        positions: blockPlacements(simulated, 0),
      };
      const position = choice.positions[random(cursor, choice.positions.length)];
      if (!position) throw new Error('Block Blast requires a stable board with an empty cell');
      const result = placeBlock(simulated, choice.piece, position.x, position.y);
      if (!result) throw new Error('Invalid generated placement');
      tray.push(choice.piece);
      solution.push({ slot, ...position });
      difficulty +=
        (initial[choice.piece] === 0 ? 100 : 12 / (initial[choice.piece] ?? 1)) +
        (BLOCK_SHAPES[choice.piece]?.cells.length ?? 1) +
        result.lines * 8;
    }
    difficulty += new Set(tray).size * 4;
    if (!best || difficulty > best.difficulty) best = { tray, solution, difficulty };
  }
  if (!best) throw new Error('Missing generated tray');
  // Hide the construction order; the witness is returned for independent verification.
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) {
    const j = random(cursor, i + 1);
    [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
  }
  return {
    tray: order.map((i) => best.tray[i] ?? 0),
    rng: cursor.rng,
    solution: best.solution.map((move) => ({ ...move, slot: order.indexOf(move.slot) })),
  };
}
export function createBlockBlast(seed: number): BlockState {
  const board = Array<number>(64).fill(0);
  const { tray, rng } = generateBlockTray(board, seed >>> 0);
  return { board, tray, rng, score: 0, moves: 0, lines: 0, clears: 0, status: 'playing' };
}
export function moveBlockBlast(state: BlockState, move: BlockMove): boolean {
  if (state.status !== 'playing' || !Number.isInteger(move.slot) || move.slot < 0 || move.slot > 2)
    return false;
  const piece = state.tray[move.slot];
  if (piece === null || piece === undefined) return false;
  const result = placeBlock(state.board, piece, move.x, move.y);
  if (!result) return false;
  // +1 per block, +10 × lines² per placement, +100 for an empty board.
  const points =
    (BLOCK_SHAPES[piece]?.cells.length ?? 0) + 10 * result.lines ** 2 + (result.clear ? 100 : 0);
  state.score += points;
  state.lines += result.lines;
  state.clears += Number(result.clear);
  state.moves++;
  state.tray[move.slot] = null;
  if (state.tray.every((piece) => piece === null)) {
    const next = generateBlockTray(state.board, state.rng);
    state.tray = next.tray;
    state.rng = next.rng;
  }
  if (
    !state.tray.some((piece) => piece !== null && blockPlacements(state.board, piece).length > 0) ||
    state.score > Number.MAX_SAFE_INTEGER - 10000 ||
    state.moves >= Number.MAX_SAFE_INTEGER - 1
  )
    state.status = 'over';
  return true;
}
