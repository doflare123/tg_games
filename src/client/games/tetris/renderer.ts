import { ghostPiece } from '../../../games/tetris/engine.ts';
import { cells } from '../../../games/tetris/pieces.ts';
import {
  type Cell,
  HIDDEN_ROWS,
  type PieceKind,
  type TetrisState,
  WIDTH,
} from '../../../games/tetris/types.ts';

const COLORS: Record<Exclude<Cell, null>, string> = {
  I: '#6dd9ed',
  O: '#f5cf61',
  T: '#b89ae9',
  S: '#8ecd8e',
  Z: '#f0787e',
  J: '#7e9fe5',
  L: '#efa46e',
};
const SHAPE_NAMES: Record<PieceKind, string> = {
  I: 'Прямая',
  O: 'Квадрат',
  T: 'Т-образная',
  S: 'Зигзаг вправо',
  Z: 'Зигзаг влево',
  J: 'Угол влево',
  L: 'Угол вправо',
};

export function drawPiecePreview(canvas: HTMLCanvasElement, kind: PieceKind | null): void {
  canvas.setAttribute('aria-label', kind ? SHAPE_NAMES[kind] : 'Пусто');
  const c = canvas.getContext('2d');
  if (!c) return;
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (!kind) {
    c.fillStyle = '#8e9e7d';
    c.fillRect(canvas.width / 2 - 8, canvas.height / 2 - 1, 16, 2);
    return;
  }
  const points = cells({ kind, x: 0, y: 0, rotation: 0 });
  const minX = Math.min(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const columns = Math.max(...points.map(([x]) => x)) - minX + 1;
  const rows = Math.max(...points.map(([, y]) => y)) - minY + 1;
  const size = Math.min(canvas.width / 5, canvas.height / 3);
  const left = (canvas.width - columns * size) / 2;
  const top = (canvas.height - rows * size) / 2;
  for (const [x, y] of points) {
    const px = left + (x - minX) * size;
    const py = top + (y - minY) * size;
    c.fillStyle = COLORS[kind];
    c.fillRect(px + 1, py + 1, size - 2, size - 2);
    c.fillStyle = '#ffffff30';
    c.fillRect(px + 2, py + 2, size - 4, 3);
  }
}

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
