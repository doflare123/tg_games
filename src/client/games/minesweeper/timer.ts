import { MINE_LIMIT_MS } from '../../../games/minesweeper/engine.ts';

export class MineTimer {
  private startedAt: number | null = null;
  private finishedAt: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  start(at = this.now()): void {
    if (this.startedAt === null) this.startedAt = at;
  }

  finish(at = this.now()): void {
    if (this.startedAt !== null && this.finishedAt === null)
      this.finishedAt = Math.max(this.startedAt, at);
  }

  elapsedMs(at = this.now()): number {
    if (this.startedAt === null) return 0;
    return Math.min(
      MINE_LIMIT_MS,
      Math.max(0, Math.floor((this.finishedAt ?? at) - this.startedAt)),
    );
  }

  reset(): void {
    this.startedAt = null;
    this.finishedAt = null;
  }
}
