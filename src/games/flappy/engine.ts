export const FLAPPY_RULESET = 'flappy-v1';
export const FLAPPY_HZ = 60;
export const FLAPPY_MAX_TICKS = 36000;
export const FLAPPY_CHUNK = 600;
export const FLAPPY_WIDTH = 288;
export const FLAPPY_GROUND = 400;
export const FLAPPY_GAP = 104;
export const FLAPPY_BIRD_X = 80;
export const FLAPPY_SCALE = 1000;
export interface FlappyPipe {
  x: number;
  gapY: number;
  passed: boolean;
}
export interface FlappyState {
  y: number;
  velocity: number;
  ticks: number;
  lastFlap: number;
  score: number;
  rng: number;
  pipes: FlappyPipe[];
  status: 'playing' | 'over';
}
function gap(state: FlappyState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return 112 + (state.rng % 177);
}
export function createFlappy(seed: number): FlappyState {
  const state: FlappyState = {
    y: 220000,
    velocity: 0,
    ticks: 0,
    lastFlap: -4,
    score: 0,
    rng: seed >>> 0,
    pipes: [],
    status: 'playing',
  };
  for (let i = 0; i < 3; i++)
    state.pipes.push({ x: (360 + i * 144) * FLAPPY_SCALE, gapY: gap(state), passed: false });
  return state;
}
// Integer subpixels keep browser and server replay exactly identical.
// A replay action belongs to the tick BEFORE this step increments it.
export function stepFlappy(state: FlappyState, flap = false): boolean {
  if (state.status !== 'playing') return false;
  if (flap) {
    if (state.ticks - state.lastFlap < 4) return false;
    state.lastFlap = state.ticks;
    state.velocity = -4600;
  }
  state.velocity = Math.min(9000, state.velocity + 260);
  state.y += state.velocity;
  state.ticks++;
  for (const pipe of state.pipes) pipe.x -= 2200;
  const y = state.y / FLAPPY_SCALE;
  // The transparent perimeter of the 34×24 sprite is outside the hitbox.
  const collision = state.pipes.some((pipe) => {
    const x = pipe.x / FLAPPY_SCALE;
    return (
      FLAPPY_BIRD_X + 12 > x &&
      FLAPPY_BIRD_X - 12 < x + 52 &&
      (y - 9 < pipe.gapY - FLAPPY_GAP / 2 || y + 9 > pipe.gapY + FLAPPY_GAP / 2)
    );
  });
  if (y - 9 <= 0 || y + 9 >= FLAPPY_GROUND || collision) {
    state.status = 'over';
    return true;
  }
  for (const pipe of state.pipes) {
    if (!pipe.passed && pipe.x + 52000 < (FLAPPY_BIRD_X - 12) * FLAPPY_SCALE) {
      pipe.passed = true;
      state.score++;
    }
  }
  if ((state.pipes[0]?.x ?? 0) < -52000) {
    state.pipes.shift();
    state.pipes.push({
      x: (state.pipes.at(-1)?.x ?? 288000) + 144000,
      gapY: gap(state),
      passed: false,
    });
  }
  if (state.ticks >= FLAPPY_MAX_TICKS) state.status = 'over';
  return true;
}
