export const LEGACY_DOODLE_RULESET = 'doodle-v1';
export const DOODLE_RULESET = 'doodle-v2';
export const DOODLE_RULESETS = [LEGACY_DOODLE_RULESET, DOODLE_RULESET] as const;
export type DoodleRuleset = (typeof DOODLE_RULESETS)[number];
export const DOODLE_HZ = 60;
export const DOODLE_CHUNK = 600;
export const DOODLE_MAX_TICKS = 36000;
export const DOODLE_WIDTH = 360;
export const DOODLE_HEIGHT = 540;
export const DOODLE_SCALE = 1000;
// Include the outline and broken-platform rotation, not just the fill.
export const DOODLE_PLATFORM_MARGIN = 34000;
export type DoodleDirection = -1 | 0 | 1;
export interface DoodlePlatform {
  x: number;
  y: number;
  kind: 'normal' | 'moving' | 'fragile' | 'spring';
  phase: number;
  broken: boolean;
}
export interface DoodleState {
  ruleset: DoodleRuleset;
  x: number;
  y: number;
  vx: number;
  vy: number;
  camera: number;
  highest: number;
  generatedY: number;
  generatedX: number;
  ticks: number;
  direction: DoodleDirection;
  score: number;
  rng: number;
  platforms: DoodlePlatform[];
  status: 'playing' | 'over';
}
function random(state: DoodleState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng;
}
function wrap(x: number): number {
  return ((x % 360000) + 360000) % 360000;
}
function reflectPlatform(x: number): number {
  const span = DOODLE_WIDTH * DOODLE_SCALE - 2 * DOODLE_PLATFORM_MARGIN;
  const offset = (((x - DOODLE_PLATFORM_MARGIN) % (2 * span)) + 2 * span) % (2 * span);
  return DOODLE_PLATFORM_MARGIN + (offset <= span ? offset : 2 * span - offset);
}
export function doodlePlatformX(
  platform: DoodlePlatform,
  tick: number,
  ruleset: DoodleRuleset = DOODLE_RULESET,
): number {
  if (platform.kind !== 'moving') return platform.x;
  const phase = (tick + platform.phase) % 240;
  const x = platform.x + (phase < 120 ? phase - 60 : 180 - phase) * 600;
  return ruleset === LEGACY_DOODLE_RULESET ? wrap(x) : reflectPlatform(x);
}
function generate(state: DoodleState): void {
  while (state.generatedY < state.camera + 650000) {
    state.generatedY += 65000 + (random(state) % 35001);
    const x = state.generatedX + (random(state) % 140001) - 70000;
    state.generatedX = state.ruleset === LEGACY_DOODLE_RULESET ? wrap(x) : reflectPlatform(x);
    const roll = random(state) % 20;
    state.platforms.push({
      x: state.generatedX,
      y: state.generatedY,
      kind: roll === 0 ? 'spring' : roll < 3 ? 'fragile' : roll < 6 ? 'moving' : 'normal',
      phase: random(state) % 240,
      broken: false,
    });
  }
}
export function createDoodle(seed: number, ruleset: DoodleRuleset = DOODLE_RULESET): DoodleState {
  const state: DoodleState = {
    ruleset,
    x: 180000,
    y: 50000,
    vx: 0,
    vy: 10500,
    camera: 0,
    highest: 50000,
    generatedY: 50000,
    generatedX: 180000,
    ticks: 0,
    direction: 0,
    score: 0,
    rng: seed >>> 0,
    status: 'playing',
    platforms: [{ x: 180000, y: 50000, kind: 'normal', phase: 0, broken: false }],
  };
  generate(state);
  return state;
}
// Integer subpixels and fixed ticks are shared by browser and authoritative replay.
// World Y increases upward; only descending feet may land on a platform.
export function stepDoodle(
  state: DoodleState,
  direction: DoodleDirection = state.direction,
): boolean {
  if (state.status !== 'playing') return false;
  state.direction = direction;
  state.vx =
    direction === 0
      ? Math.trunc((state.vx * 3) / 4)
      : Math.max(-3600, Math.min(3600, state.vx + direction * 600));
  state.x = wrap(state.x + state.vx);
  const oldY = state.y;
  state.vy = Math.max(-12000, state.vy - 280);
  state.y += state.vy;
  state.ticks++;
  if (state.vy < 0) {
    const landed = state.platforms
      .filter((platform) => {
        const distance = Math.abs(state.x - doodlePlatformX(platform, state.ticks, state.ruleset));
        return (
          !platform.broken &&
          oldY >= platform.y &&
          state.y <= platform.y &&
          Math.min(distance, 360000 - distance) < 42000
        );
      })
      .sort((a, b) => b.y - a.y)[0];
    if (landed) {
      state.y = landed.y;
      state.vy = landed.kind === 'spring' ? 14000 : 10500;
      if (landed.kind === 'fragile') landed.broken = true;
    }
  }
  state.highest = Math.max(state.highest, state.y);
  state.score = Math.floor((state.highest - 50000) / 1000);
  state.camera = Math.max(state.camera, state.y - 270000);
  state.platforms = state.platforms.filter((platform) => platform.y >= state.camera - 80000);
  generate(state);
  if (state.y < state.camera - 50000 || state.ticks >= DOODLE_MAX_TICKS) state.status = 'over';
  return true;
}
