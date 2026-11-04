import { describe, expect, it } from 'vitest';
import {
  type AdventurePlatform,
  type AdventureState,
  adventureDifficulty,
  adventurePlatformX,
  createAdventure,
  MONSTER_START_SCORE,
  type Monster,
  monsterX,
  stepAdventure,
} from '../src/games/doodle/adventure.ts';
import { DOODLE_MAX_TICKS } from '../src/games/doodle/engine.ts';
import { decodeAdventureState } from '../src/shared/doodle-adventure.ts';

function empty(): AdventureState {
  const s = createAdventure(123);
  s.x = 100000;
  s.y = 100000;
  s.vy = 0;
  s.platforms = [];
  s.monsters = [];
  s.pickups = [];
  s.generatedY = 1000000;
  return s;
}
function platform(kind: AdventurePlatform['kind']): AdventurePlatform {
  return { id: 1, x: 100000, y: 100000, kind, phase: 60, brokenAt: null, bouncedAt: -100 };
}
function monster(kind: Monster['kind'] = 'wing'): Monster {
  return {
    id: 9,
    x: 100000,
    y: 100000,
    kind,
    phase: 49,
    hp: kind === 'rotor' ? 2 : 1,
    hitAt: -100,
    deadAt: null,
  };
}
describe('Doodle free-play adventure', () => {
  it('generates varied reachable routes with multiple landing choices rather than a staircase', () => {
    let multiple = 0;
    for (let seed = 0; seed < 100; seed++) {
      const a = createAdventure(seed),
        b = createAdventure(seed);
      expect(a).toEqual(b);
      expect(decodeAdventureState(a)).toEqual(a);
      const primary: AdventurePlatform[] = [];
      for (const p of a.platforms) {
        expect(p.x).toBeGreaterThanOrEqual(42000);
        expect(p.x).toBeLessThanOrEqual(318000);
        if (!primary.length || p.y - (primary.at(-1)?.y ?? 0) > 50000) primary.push(p);
        else multiple++;
      }
      let sign = 0,
        streak = 0;
      for (let i = 1; i < primary.length; i++) {
        const before = primary[i - 1],
          next = primary[i];
        if (!before || !next) throw new Error('Missing route');
        const delta = Math.abs(next.x - before.x),
          distance = Math.min(delta, 360000 - delta);
        expect(distance).toBeGreaterThanOrEqual(65000);
        expect(distance).toBeLessThanOrEqual(158000);
        expect(next.y - before.y).toBeLessThanOrEqual(145000);
        const direction = Math.sign(next.x - before.x);
        streak = direction === sign ? streak + 1 : 1;
        sign = direction;
        expect(streak).toBeLessThanOrEqual(2);
      }
      expect(a.monsters).toEqual([]);
      expect(a.pickups.filter((p) => p.y <= 540000)).toEqual([]);
      expect(a.platforms.some((p) => p.kind === 'spring')).toBe(true);
    }
    expect(multiple).toBeGreaterThan(100);
    expect(multiple).toBeLessThan(300);
  });
  it('gradually reduces platform density while keeping every jump in reach', () => {
    const tiers = [0, 1000, 3000, 6000, 20000].map(adventureDifficulty);
    for (let i = 1; i < tiers.length; i++) {
      const before = tiers[i - 1],
        after = tiers[i];
      if (!before || !after) throw new Error('Missing tier');
      expect(after.minGap).toBeGreaterThanOrEqual(before.minGap);
      expect(after.maxGap).toBeGreaterThanOrEqual(before.maxGap);
      expect(after.maxGap).toBeLessThanOrEqual(145000);
      expect(after.extraPlatformChance).toBeLessThanOrEqual(before.extraPlatformChance);
    }
    let low = 0,
      high = 0;
    for (let seed = 0; seed < 100; seed++) {
      for (const altitude of [1000000, 10000000]) {
        const s = createAdventure(seed);
        s.platforms = [];
        s.monsters = [];
        s.pickups = [];
        s.row = 100;
        s.camera = altitude;
        s.y = altitude + 255000;
        s.highest = s.y;
        s.generatedY = altitude - 100000;
        s.power = 'jetpack';
        s.powerUntil = 100;
        stepAdventure(s, { direction: 0 });
        if (altitude === 1000000) low += s.platforms.length;
        else high += s.platforms.length;
      }
    }
    expect(high).toBeLessThan(low * 0.85);
  });
  it('keeps the opening monster-free and spaces later enemies far apart', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = createAdventure(seed);
      expect(s.monsters).toEqual([]);
      s.power = 'jetpack';
      s.powerUntil = 10000;
      const seen = new Map<number, number>();
      let firstScore = 0;
      while (s.score < 10000 && s.status === 'playing') {
        stepAdventure(s, { direction: 0 });
        if (s.score < MONSTER_START_SCORE) expect(s.monsters).toEqual([]);
        for (const enemy of s.monsters) {
          if (!firstScore) firstScore = s.score;
          seen.set(enemy.id, enemy.y);
        }
      }
      expect(firstScore).toBeGreaterThanOrEqual(MONSTER_START_SCORE);
      expect(seen.size).toBeGreaterThan(3);
      expect(seen.size).toBeLessThan(15);
      const positions = [...seen.values()].sort((a, b) => a - b);
      for (let i = 1; i < positions.length; i++)
        expect((positions[i] ?? 0) - (positions[i - 1] ?? 0)).toBeGreaterThanOrEqual(700000);
    }
  });
  it('keeps moving platforms and monsters inside the screen and continuous at their turnarounds', () => {
    for (const x of [42000, 180000, 318000]) {
      const p = { ...platform('moving'), x };
      const m = { ...monster('rotor'), x };
      let px = adventurePlatformX(p, 0),
        mx = monsterX(m, 0);
      for (let tick = 1; tick <= 480; tick++) {
        const nextP = adventurePlatformX(p, tick),
          nextM = monsterX(m, tick);
        expect(nextP).toBeGreaterThanOrEqual(42000);
        expect(nextP).toBeLessThanOrEqual(318000);
        expect(nextM).toBeGreaterThanOrEqual(26000);
        expect(nextM).toBeLessThanOrEqual(334000);
        expect(Math.abs(nextP - px)).toBeLessThanOrEqual(650);
        expect(Math.abs(nextM - mx)).toBeLessThanOrEqual(900);
        px = nextP;
        mx = nextM;
      }
    }
  });
  it('bounces, compresses springs and trampolines and makes fragile and vanishing platforms single-use', () => {
    for (const kind of [
      'normal',
      'moving',
      'spring',
      'trampoline',
      'fragile',
      'vanishing',
    ] as const) {
      const s = empty();
      s.y = 101000;
      s.vy = -2000;
      const p = platform(kind);
      s.platforms.push(p);
      stepAdventure(s, { direction: 0 });
      expect(s.y).toBe(100000);
      expect(s.vy).toBe(kind === 'trampoline' ? 21000 : kind === 'spring' ? 15800 : 11200);
      expect(p.bouncedAt).toBe(s.ticks);
      expect(s.effects.some((e) => e.kind === 'bounce')).toBe(true);
      if (kind === 'fragile' || kind === 'vanishing') {
        expect(p.brokenAt).toBe(s.ticks);
        s.y = 101000;
        s.vy = -2000;
        stepAdventure(s, { direction: 0 });
        expect(s.vy).toBeLessThan(0);
      }
    }
  });
  it('fires rate-limited projectiles, hits swept targets and requires two shots for armored rotors', () => {
    const s = empty();
    s.x = 40000;
    for (let i = 0; i < 5; i++) stepAdventure(s, { direction: 0, shooting: true });
    expect(s.lastShot).toBe(1);
    expect(s.bullets).toHaveLength(1);
    const target = { ...monster('rotor'), x: 180000, y: 180000, phase: 50 };
    s.monsters.push(target);
    for (let shot = 0; shot < 2; shot++) {
      s.bullets.push({
        id: 50 + shot,
        x: monsterX(target, s.ticks + 1),
        y: 150000,
        vx: 0,
        vy: 45000,
        bornAt: s.ticks,
      });
      stepAdventure(s, { direction: 0 });
      expect(target.hp).toBe(1 - shot);
    }
    expect(s.kills).toBe(1);
    expect(target.deadAt).not.toBeNull();
    expect(s.effects.some((e) => e.kind === 'pop')).toBe(true);
    stepAdventure(s, { direction: 0 });
    expect(s.kills).toBe(1);
  });
  it('spaces held shots by 300 milliseconds', () => {
    const s = empty();
    s.power = 'wings';
    s.powerUntil = 100;
    const shots: number[] = [];
    for (let tick = 0; tick < 45; tick++) {
      const before = s.lastShot;
      stepAdventure(s, { direction: 0, shooting: true });
      if (s.lastShot !== before) shots.push(s.lastShot);
    }
    expect(shots).toEqual([1, 19, 37]);
  });
  it('removes platforms at and below the viewport before they can bounce the player', () => {
    for (const kind of [
      'normal',
      'moving',
      'spring',
      'trampoline',
      'fragile',
      'vanishing',
    ] as const) {
      for (const surface of [199000, 200000]) {
        const s = empty();
        s.camera = 200000;
        s.y = 201000;
        s.vy = -3000;
        s.platforms.push({ ...platform(kind), y: surface });
        stepAdventure(s, { direction: 0 });
        expect(s.platforms).toEqual([]);
        expect(s.vy).toBeLessThan(0);
        while (s.status === 'playing') stepAdventure(s, { direction: 0 });
        expect(s.reason).toBe('fall');
      }
    }
  });
  it('keeps the last visible landing surface usable and deletes it immediately after scrolling past it', () => {
    const s = empty();
    s.camera = 200000;
    s.y = 202000;
    s.vy = -2000;
    s.platforms.push({ ...platform('normal'), y: 201000 });
    stepAdventure(s, { direction: 0 });
    expect(s.vy).toBe(11200);
    expect(s.y).toBe(201000);
    expect(s.platforms).toHaveLength(1);
    s.y = 456000;
    s.vy = 1000;
    stepAdventure(s, { direction: 0 });
    expect(s.camera).toBeGreaterThan(201000);
    expect(s.platforms).toEqual([]);
    s.y = s.camera + 1000;
    s.vy = -3000;
    stepAdventure(s, { direction: 0 });
    expect(s.vy).toBeLessThan(0);
  });
  it('ends a fully offscreen fall before collecting a booster or shooting', () => {
    const s = empty();
    s.camera = 200000;
    s.y = 148500;
    s.vy = -2000;
    s.pickups.push({ id: 1, x: s.x, y: 187000, kind: 'jetpack' });
    stepAdventure(s, { direction: 0, shooting: true });
    expect(s.status).toBe('over');
    expect(s.reason).toBe('fall');
    expect(s.power).toBe('none');
    expect(s.bullets).toEqual([]);
  });
  it('allows stomping flying monsters but makes side contact and spikes dangerous', () => {
    const stomp = empty();
    stomp.y = 120000;
    stomp.vy = -4000;
    stomp.monsters.push(monster());
    stepAdventure(stomp, { direction: 0 });
    expect(stomp.kills).toBe(1);
    expect(stomp.vy).toBe(11200);
    expect(stomp.status).toBe('playing');
    for (const kind of ['wing', 'spike'] as const) {
      const s = empty();
      s.monsters.push({ ...monster(kind), y: 120000 });
      stepAdventure(s, { direction: 0 });
      expect(s.status).toBe('over');
      expect(s.reason).toBe('monster');
    }
    const spike = empty();
    spike.y = 120000;
    spike.vy = -4000;
    spike.monsters.push(monster('spike'));
    stepAdventure(spike, { direction: 0 });
    expect(spike.status).toBe('over');
  });
  it('collects jetpacks and wings, flies for their duration and survives monsters while powered', () => {
    for (const kind of ['jetpack', 'wings'] as const) {
      const s = empty();
      s.pickups.push({ id: 1, x: s.x, y: s.y + 25000, kind });
      stepAdventure(s, { direction: 0 });
      expect(s.power).toBe(kind);
      expect(s.pickups).toHaveLength(0);
      s.monsters.push({ ...monster('spike'), y: s.y + 32000 });
      stepAdventure(s, { direction: 0 });
      expect(s.vy).toBe(kind === 'jetpack' ? 18000 : 10500);
      expect(s.kills).toBe(1);
      expect(s.status).toBe('playing');
      while (s.ticks < s.powerUntil) stepAdventure(s, { direction: 0 });
      expect(s.power).toBe('none');
      expect(s.invulnerableUntil).toBeGreaterThan(s.ticks);
    }
  });
  it('uses the shield for one collision and supplies a grace period instead of consuming it each frame', () => {
    const s = empty();
    s.pickups.push({ id: 1, x: s.x, y: s.y + 20000, kind: 'shield' });
    stepAdventure(s, { direction: 0 });
    expect(s.shieldUntil).toBeGreaterThan(s.ticks);
    s.monsters.push({ ...monster('spike'), y: s.y + 15000 });
    stepAdventure(s, { direction: 0 });
    expect(s.shieldUntil).toBe(0);
    expect(s.status).toBe('playing');
    stepAdventure(s, { direction: 0 });
    expect(s.status).toBe('playing');
    expect(s.effects.some((e) => e.kind === 'shield')).toBe(true);
  });
  it('bounds generated entities, bullets and effects during a long high-speed flight', () => {
    const s = createAdventure(7);
    s.power = 'jetpack';
    s.powerUntil = 10000;
    for (let tick = 0; tick < 3600; tick++) {
      stepAdventure(s, { direction: tick % 180 < 90 ? 1 : -1, shooting: true });
      if (tick % 60 === 0) {
        expect(decodeAdventureState(s)).toEqual(s);
        expect(s.platforms.length).toBeLessThan(35);
        expect(s.monsters.length).toBeLessThan(12);
        expect(s.pickups.length).toBeLessThan(5);
        expect(s.effects.length).toBeLessThanOrEqual(32);
        expect(s.bullets.length).toBeLessThanOrEqual(8);
      }
    }
    expect(s.score).toBeGreaterThan(50000);
    expect(s.status).toBe('playing');
  });
  it('ends on falling or timeout and freezes the completed game', () => {
    const s = empty();
    s.y = -60000;
    s.vy = -1000;
    stepAdventure(s, { direction: 0 });
    expect(s.reason).toBe('fall');
    const over = structuredClone(s);
    expect(stepAdventure(s, { direction: 1, shooting: true })).toBe(false);
    expect(s).toEqual(over);
    const limit = createAdventure(1);
    limit.ticks = DOODLE_MAX_TICKS - 1;
    stepAdventure(limit, { direction: 0 });
    expect(limit.reason).toBe('timeout');
  });
});
