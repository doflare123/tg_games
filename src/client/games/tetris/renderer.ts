import { ghostPiece } from '../../../games/tetris/engine.ts';
import { cells } from '../../../games/tetris/pieces.ts';
import { type Cell, HIDDEN_ROWS, type TetrisState, WIDTH } from '../../../games/tetris/types.ts';

const COLORS: Record<Exclude<Cell, null>, string> = {
  I: '#6dd9ed',
  O: '#f5cf61',
  T: '#b89ae9',
  S: '#8ecd8e',
  Z: '#f0787e',
  J: '#7e9fe5',
  L: '#efa46e',
};
export function drawTetris(canvas: HTMLCanvasElement, state: TetrisState): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const size = canvas.width / WIDTH;
  c.fillStyle = '#101410';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = '#20281f';
  c.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x++) {
    c.beginPath();
    c.moveTo(x * size, 0);
    c.lineTo(x * size, canvas.height);
    c.stroke();
  }
  for (let y = 0; y <= 20; y++) {
    c.beginPath();
    c.moveTo(0, y * size);
    c.lineTo(canvas.width, y * size);
    c.stroke();
  }
  const block = (x: number, y: number, kind: Exclude<Cell, null>, ghost = false) => {
    if (y < HIDDEN_ROWS) return;
    c.globalAlpha = ghost ? 0.3 : 1;
    c.fillStyle = COLORS[kind];
    if (ghost) {
      c.strokeStyle = COLORS[kind];
      c.strokeRect(x * size + 3, (y - HIDDEN_ROWS) * size + 3, size - 6, size - 6);
    } else {
      c.fillRect(x * size + 1, (y - HIDDEN_ROWS) * size + 1, size - 2, size - 2);
      c.fillStyle = '#ffffff30';
      c.fillRect(x * size + 2, (y - HIDDEN_ROWS) * size + 2, size - 4, 3);
    }
    c.globalAlpha = 1;
  };
  state.board.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell) block(x, y, cell);
    });
  });
  if (state.status === 'playing') {
    for (const [x, y] of cells(ghostPiece(state))) block(x, y, state.active.kind, true);
    for (const [x, y] of cells(state.active)) block(x, y, state.active.kind);
  }
}
