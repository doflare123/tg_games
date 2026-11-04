import { DOODLE_MAX_TICKS, type DoodleDirection } from './engine.ts';

export const ADVENTURE_WIDTH = 360;
export const ADVENTURE_HEIGHT = 540;
export const PLATFORM_HALF = 36000;
export const MONSTER_START_SCORE = 1500;
export const ADVENTURE_PLAYER_HEIGHT = 52000;
export const ADVENTURE_SHOT_INTERVAL = 18;
const MARGIN = 42000;
const WORLD = ADVENTURE_WIDTH * 1000;
export type PlatformKind = 'normal' | 'moving' | 'fragile' | 'spring' | 'trampoline' | 'vanishing';
export type PickupKind = 'jetpack' | 'wings' | 'shield';
export interface AdventurePlatform {
  id: number;
  x: number;
  y: number;
  kind: PlatformKind;
  phase: number;
  brokenAt: number | null;
  bouncedAt: number;
}
export interface Monster {
  id: number;
  x: number;
  y: number;
  kind: 'wing' | 'rotor' | 'spike';
  phase: number;
  hp: number;
  hitAt: number;
  deadAt: number | null;
}
export interface Pickup {
  id: number;
  x: number;
  y: number;
  kind: PickupKind;
}
export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
}
export interface DoodleEffect {
  id: number;
  x: number;
  y: number;
  tick: number;
  kind: 'bounce' | 'shot' | 'pop' | 'pickup' | 'break' | 'shield';
}
export interface AdventureState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  camera: number;
  highest: number;
  ticks: number;
  score: number;
  rng: number;
  direction: DoodleDirection;
  shooting: boolean;
  aim: number;
  status: 'playing' | 'over';
  reason: 'fall' | 'monster' | 'timeout' | null;
  platforms: AdventurePlatform[];
  monsters: Monster[];
  pickups: Pickup[];
  bullets: Bullet[];
  effects: DoodleEffect[];
  row: number;
  generatedY: number;
  routeX: number;
  routeSign: number;
  routeStreak: number;
  nextId: number;
  nextMonsterY: number;
  lastBounce: number;
  lastShot: number;
  kills: number;
  power: 'none' | 'jetpack' | 'wings';
  powerUntil: number;
  shieldUntil: number;
  invulnerableUntil: number;
}
export interface AdventureInput {
  direction: DoodleDirection;
  shooting?: boolean;
  aim?: number;
}

function random(state: AdventureState, range: number): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  // Use the high bits: the low LCG bits produced repeating platform patterns.
  return Math.floor((state.rng / 0x100000000) * range);
}
function wrap(x: number): number {
  return ((x % WORLD) + WORLD) % WORLD;
}
function reflect(x: number, margin = MARGIN): number {
  const span = WORLD - margin * 2;
  const offset = (((x - margin) % (2 * span)) + 2 * span) % (2 * span);
  return margin + (offset <= span ? offset : 2 * span - offset);
}
function distance(a: number, b: number): number {
  const delta = Math.abs(a - b);
  return Math.min(delta, WORLD - delta);
}
export function adventurePlatformX(platform: AdventurePlatform, tick: number): number {
  if (platform.kind !== 'moving') return platform.x;
  const phase = (tick + platform.phase) % 240;
  return reflect(platform.x + (phase < 120 ? phase - 60 : 180 - phase) * 650);
}
export function monsterX(monster: Monster, tick: number): number {
  if (monster.kind === 'spike') return monster.x;
  const phase = (tick + monster.phase) % 200;
  return reflect(monster.x + (phase < 100 ? phase - 50 : 150 - phase) * 900, 26000);
}
function effect(state: AdventureState, kind: DoodleEffect['kind'], x: number, y: number) {
  state.effects.push({ id: state.nextId++, x, y, tick: state.ticks, kind });
  if (state.effects.length > 32) state.effects.shift();
}
function platform(state: AdventureState, x: number, y: number, kind: PlatformKind) {
  state.platforms.push({
    id: state.nextId++,
    x,
    y,
    kind,
    phase: random(state, 240),
    brokenAt: null,
    bouncedAt: -100,
  });
}
export function adventureDifficulty(score: number) {
  const progress = Math.min(1, Math.max(0, Number.isFinite(score) ? score : 0) / 6000);
  return {
    minGap: 88000 + Math.round(progress * 22000),
    maxGap: 112000 + Math.round(progress * 33000),
    extraPlatformChance: 20 - Math.round(progress * 14),
    monsterGap: 1000000 - Math.round(progress * 300000),
    movingChance: 8 + Math.round(progress * 10),
    fragileChance: 8 + Math.round(progress * 12),
    vanishingChance: score >= 3000 ? Math.round(progress * 10) : 0,
  };
}
function generate(state: AdventureState): void {
  while (state.generatedY < state.camera + 690000) {
    state.row++;
    const difficulty = adventureDifficulty((state.generatedY - 50000) / 1000);
    state.generatedY +=
      difficulty.minGap + random(state, difficulty.maxGap - difficulty.minGap + 1);
    let next = MARGIN + random(state, WORLD - MARGIN * 2 + 1);
    for (let attempt = 0; attempt < 24; attempt++) {
      const sign = Math.sign(next - state.routeX);
      if (
        distance(next, state.routeX) >= 65000 &&
        distance(next, state.routeX) <= 158000 &&
        !(sign === state.routeSign && state.routeStreak >= 2)
      )
        break;
      next = MARGIN + random(state, WORLD - MARGIN * 2 + 1);
    }
    // A bounded fallback keeps every primary jump reachable even for unlucky seeds.
    if (
      distance(next, state.routeX) < 65000 ||
      distance(next, state.routeX) > 158000 ||
      (Math.sign(next - state.routeX) === state.routeSign && state.routeStreak >= 2)
    ) {
      const direction =
        state.routeStreak >= 2 ? -state.routeSign : state.routeX < WORLD / 2 ? 1 : -1;
      next = reflect(state.routeX + direction * 110000);
    }
    const sign = Math.sign(next - state.routeX);
    state.routeStreak = sign === state.routeSign ? state.routeStreak + 1 : 1;
    state.routeSign = sign;
    state.routeX = next;
    const roll = random(state, 100);
    let kind: PlatformKind =
      state.row < 4
        ? 'normal'
        : roll < difficulty.movingChance
          ? 'moving'
          : roll < difficulty.movingChance + difficulty.fragileChance
            ? 'fragile'
            : roll < difficulty.movingChance + difficulty.fragileChance + difficulty.vanishingChance
              ? 'vanishing'
              : 'normal';
    if (state.row % 14 === 5) kind = 'spring';
    if (state.row % 22 === 11) kind = 'trampoline';
    const hasPickup = state.row % 12 === 8;
    if (hasPickup) kind = 'normal';
    platform(state, next, state.generatedY, kind);
    // Secondary landing choices break up the single diagonal staircase.
    if (state.row === 1 || random(state, 100) < difficulty.extraPlatformChance) {
      const other =
        state.row === 1
          ? next < 180000
            ? 300000
            : 60000
          : next < 180000
            ? 236000 + random(state, 80000)
            : 44000 + random(state, 80000);
      if (Math.abs(other - next) >= 106000)
        platform(
          state,
          other,
          state.generatedY + random(state, 18000) - 9000,
          state.row > 4 && random(state, 100) < 20 ? 'fragile' : 'normal',
        );
    }
    if (hasPickup) {
      const cycle = Math.floor(state.row / 12) % 3;
      state.pickups.push({
        id: state.nextId++,
        x: next,
        y: state.generatedY + 25000,
        kind: cycle === 0 ? 'jetpack' : cycle === 1 ? 'shield' : 'wings',
      });
    }
    // Gate on the player's real height too: look-ahead generation must not put
    // monsters on the initial screen before the introductory section is finished.
    if (state.score >= MONSTER_START_SCORE && state.generatedY >= state.nextMonsterY) {
      const monsterRoll = random(state, 100);
      const monsterKind =
        state.score < 3000 || monsterRoll < 55
          ? 'wing'
          : state.score < 5000 || monsterRoll < 80
            ? 'rotor'
            : 'spike';
      const x = next < 180000 ? Math.min(320000, next + 120000) : Math.max(40000, next - 120000);
      state.monsters.push({
        id: state.nextId++,
        x,
        y: state.generatedY + 55000,
        kind: monsterKind,
        phase: random(state, 200),
        hp: monsterKind === 'rotor' ? 2 : 1,
        hitAt: -100,
        deadAt: null,
      });
      state.nextMonsterY = state.generatedY + 55000 + difficulty.monsterGap + random(state, 350001);
    }
  }
}
export function createAdventure(seed: number): AdventureState {
  const state: AdventureState = {
    x: 180000,
    y: 50000,
    vx: 0,
    vy: 11200,
    camera: 0,
    highest: 50000,
    ticks: 0,
    score: 0,
    rng: seed >>> 0,
    direction: 0,
    shooting: false,
    aim: 0,
    status: 'playing',
    reason: null,
    platforms: [],
    monsters: [],
    pickups: [],
    bullets: [],
    effects: [],
    row: 0,
    generatedY: 50000,
    routeX: 180000,
    routeSign: 0,
    routeStreak: 0,
    nextId: 1,
    nextMonsterY: (MONSTER_START_SCORE + 50) * 1000,
    lastBounce: -100,
    lastShot: -100,
    kills: 0,
    power: 'none',
    powerUntil: 0,
    shieldUntil: 0,
    invulnerableUntil: 0,
  };
  platform(state, 180000, 50000, 'normal');
  generate(state);
  return state;
}
function kill(state: AdventureState, monster: Monster) {
  monster.hp = 0;
  monster.deadAt = state.ticks;
  state.kills++;
  effect(state, 'pop', monsterX(monster, state.ticks), monster.y);
}
function bullets(state: AdventureState): void {
  for (const bullet of state.bullets) {
    const oldY = bullet.y;
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    for (const monster of state.monsters) {
      if (monster.deadAt !== null || Math.abs(bullet.x - monsterX(monster, state.ticks)) > 25000)
        continue;
      if (oldY > monster.y + 22000 || bullet.y < monster.y - 22000) continue;
      monster.hp--;
      monster.hitAt = state.ticks;
      bullet.bornAt = -1000;
      if (monster.hp <= 0) kill(state, monster);
      else effect(state, 'shot', bullet.x, monster.y);
      break;
    }
  }
  state.bullets = state.bullets.filter(
    (bullet) =>
      state.ticks - bullet.bornAt < 90 &&
      bullet.x > -16000 &&
      bullet.x < WORLD + 16000 &&
      bullet.y < state.camera + 640000,
  );
}
function collect(state: AdventureState): void {
  state.pickups = state.pickups.filter((pickup) => {
    if (
      distance(state.x, pickup.x) > 29000 ||
      pickup.y < state.y - 12000 ||
      pickup.y > state.y + 50000
    )
      return true;
    if (pickup.kind === 'shield') state.shieldUntil = state.ticks + 720;
    else {
      // A weaker pickup must not interrupt a stronger flight already in progress.
      if (pickup.kind === 'jetpack' || state.power !== 'jetpack' || state.powerUntil <= state.ticks)
        state.power = pickup.kind;
      state.powerUntil = Math.max(
        state.powerUntil,
        state.ticks + (state.power === 'jetpack' ? 180 : 240),
      );
      state.invulnerableUntil = state.powerUntil + 60;
    }
    effect(state, 'pickup', pickup.x, pickup.y);
    return false;
  });
}
function collideMonsters(state: AdventureState, oldY: number): void {
  for (const monster of state.monsters) {
    if (monster.deadAt !== null || distance(state.x, monsterX(monster, state.ticks)) > 29000)
      continue;
    const stomp = state.vy < 0 && oldY >= monster.y + 16000 && state.y <= monster.y + 16000;
    const overlaps = state.y < monster.y + 18000 && state.y + 34000 > monster.y - 18000;
    if (!stomp && !overlaps) continue;
    if (state.power !== 'none' && state.powerUntil > state.ticks) {
      kill(state, monster);
      continue;
    }
    if (stomp && monster.kind !== 'spike') {
      kill(state, monster);
      state.y = monster.y + 18000;
      state.vy = 11200;
      state.lastBounce = state.ticks;
      continue;
    }
    if (state.invulnerableUntil > state.ticks) continue;
    if (state.shieldUntil > state.ticks) {
      state.shieldUntil = 0;
      state.invulnerableUntil = state.ticks + 90;
      effect(state, 'shield', state.x, state.y + 22000);
    } else {
      state.status = 'over';
      state.reason = 'monster';
      return;
    }
  }
}
function pruneWorld(state: AdventureState): void {
  // A platform's landing surface leaves the world as soon as it crosses the
  // visible bottom edge. A below-screen buffer must never remain collidable.
  state.platforms = state.platforms.filter(
    (p) => p.y > state.camera && (p.brokenAt === null || state.ticks - p.brokenAt < 30),
  );
  state.monsters = state.monsters.filter(
    (m) => m.y + 22000 > state.camera && (m.deadAt === null || state.ticks - m.deadAt < 24),
  );
  state.pickups = state.pickups.filter((p) => p.y + 15000 > state.camera);
}
export function stepAdventure(state: AdventureState, input: AdventureInput): boolean {
  if (state.status !== 'playing') return false;
  pruneWorld(state);
  const direction = input.direction === -1 || input.direction === 1 ? input.direction : 0;
  state.direction = direction;
  state.shooting = input.shooting === true;
  state.aim =
    typeof input.aim === 'number' && Number.isFinite(input.aim)
      ? Math.max(-1000, Math.min(1000, Math.trunc(input.aim)))
      : 0;
  state.vx =
    direction === 0
      ? Math.trunc(state.vx * 0.78)
      : Math.max(-3900, Math.min(3900, state.vx + direction * 650));
  state.x = wrap(state.x + state.vx);
  const oldY = state.y;
  state.ticks++;
  if (state.power !== 'none' && state.ticks < state.powerUntil)
    state.vy = state.power === 'jetpack' ? 18000 : 10500;
  else {
    state.power = 'none';
    state.vy = Math.max(-12000, state.vy - 300);
  }
  state.y += state.vy;
  // End the fall before pickups, stomps or power-ups could rescue a character
  // that has already disappeared completely below the viewport.
  if (state.y + ADVENTURE_PLAYER_HEIGHT <= state.camera) {
    state.status = 'over';
    state.reason = 'fall';
    return true;
  }
  if (
    state.shooting &&
    state.ticks - state.lastShot >= ADVENTURE_SHOT_INTERVAL &&
    state.bullets.length < 8
  ) {
    const vx = state.aim * 6;
    state.bullets.push({
      id: state.nextId++,
      x: state.x,
      y: state.y + 39000,
      vx,
      vy: 14500 - Math.trunc(Math.abs(vx) / 3),
      bornAt: state.ticks,
    });
    state.lastShot = state.ticks;
    effect(state, 'shot', state.x, state.y + 39000);
  }
  bullets(state);
  collect(state);
  collideMonsters(state, oldY);
  if (state.status === 'playing' && state.vy < 0) {
    const landed = state.platforms
      .filter(
        (p) =>
          p.brokenAt === null &&
          oldY >= p.y &&
          state.y <= p.y &&
          distance(state.x, adventurePlatformX(p, state.ticks)) < PLATFORM_HALF + 12000,
      )
      .sort((a, b) => b.y - a.y)[0];
    if (landed) {
      state.y = landed.y;
      state.vy = landed.kind === 'trampoline' ? 21000 : landed.kind === 'spring' ? 15800 : 11200;
      landed.bouncedAt = state.lastBounce = state.ticks;
      if (landed.kind === 'fragile' || landed.kind === 'vanishing') {
        landed.brokenAt = state.ticks;
        effect(state, 'break', adventurePlatformX(landed, state.ticks), landed.y);
      }
      effect(state, 'bounce', state.x, state.y);
    }
  }
  state.highest = Math.max(state.highest, state.y);
  state.score = Math.floor((state.highest - 50000) / 1000);
  state.camera = Math.max(state.camera, state.y - 255000);
  pruneWorld(state);
  state.effects = state.effects.filter((e) => state.ticks - e.tick < 36);
  generate(state);
  if (
    state.status === 'playing' &&
    (state.y + ADVENTURE_PLAYER_HEIGHT <= state.camera || state.ticks >= DOODLE_MAX_TICKS)
  ) {
    state.status = 'over';
    state.reason = state.ticks >= DOODLE_MAX_TICKS ? 'timeout' : 'fall';
  }
  return true;
}
