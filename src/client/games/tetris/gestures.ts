import type { TetrisAction } from '../../../games/tetris/types.ts';
export interface GesturePoint {
  id: number;
  x: number;
  y: number;
  time: number;
}
interface Contact {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  startedAt: number;
  movedAt: number;
  step: number;
  remainder: number;
  axis: 'pending' | 'horizontal' | 'vertical';
  moved: boolean;
  holding: boolean;
  consumed: boolean;
}
export class TetrisGestures {
  private contact: Contact | null = null;
  private accelerating = false;
  constructor(
    private readonly action: (action: TetrisAction) => void,
    private readonly softDrop: (pressed: boolean) => void,
  ) {}
  get pointerId(): number | null {
    return this.contact?.id ?? null;
  }
  begin(point: GesturePoint, cellWidth: number): boolean {
    if (this.contact) return false;
    this.contact = {
      id: point.id,
      x: point.x,
      y: point.y,
      lastX: point.x,
      lastY: point.y,
      startedAt: point.time,
      movedAt: point.time,
      step: Math.max(12, cellWidth * 0.75),
      remainder: 0,
      axis: 'pending',
      moved: false,
      holding: false,
      consumed: false,
    };
    return true;
  }
  move(point: GesturePoint): void {
    const p = this.contact;
    if (!p || p.id !== point.id || p.consumed) return;
    const dx = point.x - p.x;
    const dy = point.y - p.y;
    const deltaX = point.x - p.lastX;
    if (Math.hypot(point.x - p.lastX, point.y - p.lastY) > 2) p.movedAt = point.time;
    p.lastX = point.x;
    p.lastY = point.y;
    if (Math.hypot(dx, dy) > 10) p.moved = true;
    const wasPending = p.axis === 'pending';
    if (p.axis === 'pending' && p.moved)
      p.axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
    if (p.axis === 'horizontal') {
      p.remainder += wasPending ? dx : deltaX;
      const steps = Math.trunc(p.remainder / p.step);
      p.remainder -= steps * p.step;
      for (let i = 0; i < Math.min(10, Math.abs(steps)); i++)
        this.action(steps > 0 ? 'right' : 'left');
    } else if (p.axis === 'vertical' && dy > 10) {
      if (!p.holding && point.time - p.startedAt <= 200 && dy >= Math.max(48, p.step * 2.5)) {
        p.consumed = true;
        this.accelerate(false);
        this.action('hardDrop');
      } else this.accelerate(true);
    }
  }
  update(time: number): void {
    const p = this.contact;
    if (p && !p.consumed && time - p.movedAt >= 220) {
      p.holding = true;
      this.accelerate(true);
    }
  }
  end(point: GesturePoint): void {
    if (this.contact?.id !== point.id) return;
    this.move(point);
    const p = this.contact;
    if (p && !p.consumed && !p.holding && !p.moved && point.time - p.startedAt < 220)
      this.action('rotateCW');
    this.cancel(point.id);
  }
  cancel(id?: number): void {
    if (id !== undefined && this.contact?.id !== id) return;
    this.contact = null;
    this.accelerate(false);
  }
  private accelerate(value: boolean): void {
    if (this.accelerating === value) return;
    this.accelerating = value;
    this.softDrop(value);
  }
}
