import type { Direction } from '../../../games/2048/engine.ts';
import { element } from '../../ui/dom.ts';
import { trace2048Motion } from './motion.ts';

export interface Move2048Visual {
  before: readonly number[];
  direction: Direction;
}

function paintTile(cell: HTMLElement, value: number): void {
  cell.textContent = value ? (value < 1000000 ? String(value) : `2^${Math.log2(value)}`) : '';
  cell.dataset.level = String(value ? Math.min(11, Math.log2(value)) : 0);
  cell.dataset.wide = String(value >= 16384);
  cell.setAttribute('aria-label', value ? String(value) : 'Пусто');
}

export class Renderer2048 {
  private readonly cells = Array.from({ length: 16 }, () =>
    element('div', 'puzzle-number puzzle-tile'),
  );
  private readonly layer = element('div', 'puzzle-motion-layer');
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly animations = new Set<Animation>();
  private readonly resize: ResizeObserver;
  private values: number[] = [];
  private generation = 0;

  constructor(private readonly board: HTMLElement) {
    this.layer.setAttribute('aria-hidden', 'true');
    board.append(...this.cells, this.layer);
    this.reducedMotion.addEventListener('change', this.finish);
    let width = 0;
    let height = 0;
    this.resize = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size) return;
      if (width && (size.width !== width || size.height !== height)) this.finish();
      width = size.width;
      height = size.height;
    });
    this.resize.observe(board);
  }

  // Settle the committed board immediately when interrupted by input or navigation.
  readonly finish = (): void => {
    this.generation++;
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.layer.replaceChildren();
    for (const cell of this.cells) delete cell.dataset.moving;
  };

  render(values: readonly number[], move?: Move2048Visual): void {
    if (values.every((value, index) => value === this.values[index])) return;
    this.finish();
    this.values = [...values];
    this.cells.forEach((cell, index) => {
      paintTile(cell, values[index] ?? 0);
    });
    if (this.reducedMotion.matches || typeof this.board.animate !== 'function') return;
    if (!move) {
      values.forEach((value, index) => {
        if (value) this.pop(index, false);
      });
      return;
    }
    const motion = trace2048Motion(move.before, values, move.direction);
    const boardRect = this.board.getBoundingClientRect();
    const rectangles = this.cells.map((cell) => cell.getBoundingClientRect());
    const generation = this.generation;
    for (const cell of this.cells) cell.dataset.moving = 'true';
    const flights: Animation[] = [];
    for (const tile of motion.tiles) {
      const from = rectangles[tile.from];
      const to = rectangles[tile.to];
      if (!from || !to) continue;
      const visual = element('div', 'puzzle-number puzzle-flying');
      paintTile(visual, tile.value);
      visual.dataset.from = String(tile.from);
      visual.dataset.to = String(tile.to);
      visual.style.left = `${from.left - boardRect.left}px`;
      visual.style.top = `${from.top - boardRect.top}px`;
      visual.style.width = `${from.width}px`;
      visual.style.height = `${from.height}px`;
      this.layer.append(visual);
      const animation = visual.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` },
        ],
        { duration: 125, easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)', fill: 'forwards' },
      );
      this.animations.add(animation);
      flights.push(animation);
    }
    void Promise.all(flights.map((animation) => animation.finished))
      .then(() => {
        if (generation !== this.generation) return;
        this.finish();
        for (const index of motion.merged) this.pop(index, true);
        for (const index of motion.spawned) this.pop(index, false);
      })
      .catch(() => {
        /* Interrupted moves are settled by finish(). */
      });
  }

  private pop(index: number, merge: boolean): void {
    const cell = this.cells[index];
    if (!cell) return;
    const animation = cell.animate(
      merge
        ? [
            { transform: 'scale(1)' },
            { transform: 'scale(1.14)', offset: 0.42 },
            { transform: 'scale(1)' },
          ]
        : [
            { transform: 'scale(0.45)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1 },
          ],
      { duration: merge ? 180 : 150, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
    this.animations.add(animation);
    void animation.finished.then(() => this.animations.delete(animation)).catch(() => {});
  }

  dispose(): void {
    this.finish();
    this.resize.disconnect();
    this.reducedMotion.removeEventListener('change', this.finish);
  }
}
