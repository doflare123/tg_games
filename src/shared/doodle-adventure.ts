import type { AdventureState } from '../games/doodle/adventure.ts';
import { DOODLE_MAX_TICKS } from '../games/doodle/engine.ts';
import { AppError, integer, object, oneOf } from './errors.ts';

const WORLD_LIMIT = 1000000000;
function axis(value: unknown): -1 | 0 | 1 {
  if (value === -1 || value === 0 || value === 1) return value;
  throw new AppError('BAD_INPUT', 'Некорректное направление');
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('BAD_INPUT', 'Некорректная стрельба');
  return value;
}
function list(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max)
    throw new AppError('BAD_INPUT', 'Некорректные объекты Doodle Jump');
  return value.map(object);
}
const tick = (v: unknown) => integer(v, -100, DOODLE_MAX_TICKS + 1000);
const optionalTick = (v: unknown) => (v === null ? null : tick(v));
const x = (v: unknown) => integer(v, 0, 359999);
const y = (v: unknown) => integer(v, -100000, WORLD_LIMIT);
const id = (v: unknown) => integer(v, 1, 1000000);

export function decodeAdventureState(value: unknown): AdventureState {
  const r = object(value);
  const state: AdventureState = {
    x: x(r.x),
    y: y(r.y),
    vx: integer(r.vx, -3900, 3900),
    vy: integer(r.vy, -12000, 21000),
    camera: integer(r.camera, 0, WORLD_LIMIT),
    highest: integer(r.highest, 50000, WORLD_LIMIT),
    ticks: integer(r.ticks, 0, DOODLE_MAX_TICKS),
    score: integer(r.score, 0, 1000000),
    rng: integer(r.rng, 0, 0xffffffff),
    direction: axis(r.direction),
    shooting: bool(r.shooting),
    aim: integer(r.aim, -1000, 1000),
    status: oneOf(r.status, ['playing', 'over']),
    reason: r.reason === null ? null : oneOf(r.reason, ['fall', 'monster', 'timeout']),
    platforms: list(r.platforms, 35).map((p) => ({
      id: id(p.id),
      x: x(p.x),
      y: y(p.y),
      kind: oneOf(p.kind, ['normal', 'moving', 'fragile', 'spring', 'trampoline', 'vanishing']),
      phase: integer(p.phase, 0, 239),
      brokenAt: optionalTick(p.brokenAt),
      bouncedAt: tick(p.bouncedAt),
    })),
    monsters: list(r.monsters, 12).map((m) => ({
      id: id(m.id),
      x: x(m.x),
      y: y(m.y),
      kind: oneOf(m.kind, ['wing', 'rotor', 'spike']),
      phase: integer(m.phase, 0, 199),
      hp: integer(m.hp, 0, 2),
      hitAt: tick(m.hitAt),
      deadAt: optionalTick(m.deadAt),
    })),
    pickups: list(r.pickups, 5).map((p) => ({
      id: id(p.id),
      x: x(p.x),
      y: y(p.y),
      kind: oneOf(p.kind, ['jetpack', 'wings', 'shield']),
    })),
    bullets: list(r.bullets, 8).map((b) => ({
      id: id(b.id),
      x: integer(b.x, -16000, 376000),
      y: y(b.y),
      vx: integer(b.vx, -6000, 6000),
      vy: integer(b.vy, 12500, 14500),
      bornAt: tick(b.bornAt),
    })),
    effects: list(r.effects, 32).map((e) => ({
      id: id(e.id),
      x: x(e.x),
      y: y(e.y),
      tick: tick(e.tick),
      kind: oneOf(e.kind, ['bounce', 'shot', 'pop', 'pickup', 'break', 'shield']),
    })),
    row: integer(r.row, 0, 10000),
    generatedY: integer(r.generatedY, 50000, WORLD_LIMIT),
    routeX: x(r.routeX),
    routeSign: axis(r.routeSign),
    routeStreak: integer(r.routeStreak, 0, 10000),
    nextId: id(r.nextId),
    nextMonsterY: integer(r.nextMonsterY, 0, WORLD_LIMIT),
    lastBounce: tick(r.lastBounce),
    lastShot: tick(r.lastShot),
    kills: integer(r.kills, 0, 10000),
    power: oneOf(r.power, ['none', 'jetpack', 'wings']),
    powerUntil: tick(r.powerUntil),
    shieldUntil: tick(r.shieldUntil),
    invulnerableUntil: tick(r.invulnerableUntil),
  };
  if ((state.status === 'playing') !== (state.reason === null))
    throw new AppError('BAD_INPUT', 'Некорректное завершение партии');
  return state;
}

export function decodeAdventureEvent(value: unknown, untilTick: number) {
  const r = object(value);
  return {
    tick: integer(r.tick, 0, untilTick - 1),
    direction: axis(r.direction),
    shooting: bool(r.shooting),
    aim: integer(r.aim, -1000, 1000),
  };
}
