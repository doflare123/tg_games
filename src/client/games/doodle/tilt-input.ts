import type { DoodleDirection } from '../../../games/doodle/engine.ts';

// Browser angles are degrees; the Telegram adapter converts radians before calling this.
export function screenTilt(beta: unknown, gamma: unknown, angle: unknown): number | null {
  if (
    typeof beta !== 'number' ||
    !Number.isFinite(beta) ||
    Math.abs(beta) > 180 ||
    typeof gamma !== 'number' ||
    !Number.isFinite(gamma) ||
    Math.abs(gamma) > 90 ||
    typeof angle !== 'number' ||
    !Number.isFinite(angle) ||
    Math.abs(angle) > 360
  )
    return null;
  const radians = (angle * Math.PI) / 180;
  return gamma * Math.cos(radians) + beta * Math.sin(radians);
}

export class TiltInput {
  private neutral: number | null = null;
  private latest: number | null = null;
  private filtered = 0;
  private output: DoodleDirection = 0;
  private lastSample = -Infinity;

  sample(value: number, now: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(now)) return;
    this.latest = value;
    if (this.neutral === null) this.neutral = value;
    if (now - this.lastSample > 500) {
      this.filtered = 0;
      this.output = 0;
    }
    this.lastSample = now;
    const delta = ((value - this.neutral + 540) % 360) - 180;
    this.filtered += (delta - this.filtered) * 0.35;
    // Hysteresis avoids rapid left/right replay events from a hand held almost level.
    if (this.filtered > 6) this.output = 1;
    else if (this.filtered < -6) this.output = -1;
    else if (Math.abs(this.filtered) < 3) this.output = 0;
  }
  direction(now: number): DoodleDirection {
    return now - this.lastSample <= 500 ? this.output : 0;
  }
  calibrate(): void {
    this.neutral = this.latest;
    this.filtered = 0;
    this.output = 0;
  }
  reset(): void {
    this.neutral = this.latest = null;
    this.filtered = 0;
    this.output = 0;
    this.lastSample = -Infinity;
  }
}
