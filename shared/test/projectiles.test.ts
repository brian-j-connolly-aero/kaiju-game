import { describe, expect, it } from 'vitest';
import {
  bitGet,
  CALLINS,
  COMBAT_RULES,
  DT,
  LIZARD,
  PROJECTILE_TYPES,
  spawnProjectile,
  stepProjectile,
  throwAngle,
  TICK_RATE,
  WEAPONS,
  type Projectile,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const GUN = WEAPONS.army_tank_gun;
const SHELL = PROJECTILE_TYPES.shell;

function arena(options: TestWorldOptions = {}): World {
  const world = makeTestWorld(options);
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  return world;
}

/** A tank shell fired by unit 4 (a human unit) from a point along a ground direction. */
function fireShell(world: World, x: number, z: number, dirX: number, dirZ: number, partial: Partial<Projectile> = {}): Projectile {
  const len = Math.hypot(dirX, dirZ);
  return spawnProjectile(world, {
    type: 'shell',
    flight: SHELL.flight,
    owner: 'unit',
    ownerId: 4,
    player: HUMAN_PLAYER,
    x,
    y: 2,
    z,
    vx: (dirX / len) * SHELL.speed,
    vy: 0,
    vz: (dirZ / len) * SHELL.speed,
    gravity: SHELL.gravity,
    ttl: SHELL.ttl,
    damage: GUN.damage,
    nerve: GUN.nerve,
    splash: GUN.splashRadius,
    structureDamage: GUN.structureDamage,
    cause: 'shell',
    volley: false,
    atWill: false,
    payload: null,
    ...partial,
  });
}

describe('projectile flight', () => {
  it('steps exactly along the parabola clients are told to use', () => {
    const p = { x: 1, y: 20, z: -3, vx: 12, vy: 9, vz: -7, gravity: COMBAT_RULES.gravity };
    for (let i = 0; i < 45; i++) stepProjectile(p, DT);
    const t = 45 * DT;
    expect(p.x).toBeCloseTo(1 + 12 * t, 9);
    expect(p.z).toBeCloseTo(-3 - 7 * t, 9);
    expect(p.y).toBeCloseTo(20 + 9 * t - 0.5 * COMBAT_RULES.gravity * t * t, 9);
    expect(p.vy).toBeCloseTo(9 - COMBAT_RULES.gravity * t, 9);
  });

  it('solves the throw angle so the arc lands on the target, and gives up at 45 degrees', () => {
    const g = COMBAT_RULES.gravity;
    for (const [d, dy, v] of [[20, -2, 25], [60, 0, 25], [150, -16, 45], [300, 40, 70]] as const) {
      const a = throwAngle(d, dy, v, g);
      const t = d / (v * Math.cos(a));
      expect(v * Math.sin(a) * t - 0.5 * g * t * t).toBeCloseTo(dy, 6);
      // The flat arc of the two possible ones.
      expect(a).toBeLessThan(Math.PI / 4);
    }
    expect(throwAngle(5000, 0, 25, g)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('announces a projectile once and ends it once', () => {
    const world = arena();
    const p = fireShell(world, 100, 100, 1, 0);
    expect(world.projectiles).toEqual([p]);
    expect(eventsOf(world.events, 'projectileSpawn')).toMatchObject([
      { id: p.id, projectile: 'shell', flight: 'flat', owner: 'unit', ownerId: 4, player: HUMAN_PLAYER, x: 100, y: 2, z: 100, vx: SHELL.speed, gravity: 0, volley: false },
    ]);
    // A flat shell keeps its height and speed, and expires in the air when nothing is in the way.
    run(world, TICK_RATE);
    expect(p.y).toBe(2);
    expect(p.x).toBeCloseTo(100 + SHELL.speed, 6);
    const short = fireShell(world, 100, 100, 0, 1, { ttl: 0.5 });
    const events = run(world, TICK_RATE);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ id: short.id, target: 'none', targetId: -1 }]);
    expect(world.projectiles).toEqual([p]);
    // Leaving the city ends it too.
    const all = run(world, TICK_RATE * Math.ceil(SHELL.ttl));
    expect(eventsOf(all, 'projectileHit')).toMatchObject([{ id: p.id, target: 'none' }]);
    expect(world.projectiles).toEqual([]);
  });
});

describe('projectile impacts', () => {
  it('hits the kaiju from the direction it flew in', () => {
    const world = arena();
    const k = world.kaijus[0];
    // Fired from behind the kaiju (it faces +Z), flying toward +Z.
    fireShell(world, 0, -60, 0, 1);
    const events = run(world, TICK_RATE);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'kaiju', targetId: 0, splash: GUN.splashRadius }]);
    expect(eventsOf(events, 'kaijuHit')).toMatchObject([{ kaiju: 0, facing: 'rear', cause: 'shell', by: HUMAN_PLAYER }]);
    expect(k.maxHp - k.hp).toBeCloseTo(GUN.damage * LIZARD.damage.normalMult * LIZARD.damage.rearMult, 9);
    expect(k.recentHits).toMatchObject([{ unit: 4 }]);
    expect(world.projectiles).toEqual([]);
  });

  it('carries on past a miss into whatever is behind: the backstop', () => {
    const world = arena({
      structures: [{ x: 10, z: 80, w: 20, d: 10, height: 12, hp: 1000, value: 100, cls: 'apartment' }],
      props: [{ kind: 'car_sedan', x: 10, z: 72 }],
    });
    const k = world.kaijus[0];
    // Aimed past the kaiju's side.
    fireShell(world, 10, -60, 0, 1);
    const events = run(world, TICK_RATE * 2);
    expect(k.hp).toBe(k.maxHp);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'structure', targetId: 0 }]);
    expect(eventsOf(events, 'projectileHit')[0].z).toBeCloseTo(75, 6);
    expect(1000 - world.structureHp[0]).toBe(GUN.structureDamage);
    // Collateral is the score: the human's miss moved the bar, and the car parked by the wall went with it.
    expect(world.players[HUMAN_PLAYER].tally.barPoints).toBeCloseTo((100 * GUN.structureDamage) / 1000 + 2, 6);
    expect(world.match.barPoints).toBeGreaterThan(0);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(world.kaijus[0].rage).toBe(0);
  });

  it('passes over friendly units: there is no friendly fire between humans', () => {
    const world = arena({ structures: [{ x: 100, z: 160, w: 20, d: 10, height: 12, hp: 1000 }] });
    const friend = placeUnit(world, 0, 100, 100);
    fireShell(world, 100, 60, 0, 1);
    const events = run(world, TICK_RATE * 2);
    expect(friend.hp).toBe(friend.maxHp);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'structure' }]);
  });

  it('splashes: a shell that lands beside the kaiju still reaches it, and wrecks what is around', () => {
    const arty = CALLINS.artillery;
    const world = arena({
      structures: [
        { x: 30 + arty.splashRadius - 2 + 5, z: 0, w: 10, d: 10, height: 10, hp: 5000 },
        { x: 30 - arty.splashRadius - 4 - 5, z: 40, w: 10, d: 10, height: 10, hp: 5000 },
      ],
      props: [{ kind: 'kiosk', x: 30, z: 5 }, { kind: 'kiosk', x: 30, z: -40 }],
    });
    const k = placeKaiju(world, 30 - arty.splashRadius - LIZARD.stages[0].bodyRadius + 1, 0, 0);
    // A shell falling straight down from off the map.
    spawnProjectile(world, {
      type: 'arty', flight: 'arc', owner: 'callin', ownerId: 1, player: HUMAN_PLAYER,
      x: 30, y: 60, z: 0, vx: 0, vy: -PROJECTILE_TYPES.arty.speed, vz: 0, gravity: PROJECTILE_TYPES.arty.gravity, ttl: 12,
      damage: arty.damage, nerve: arty.nerve, splash: arty.splashRadius, structureDamage: arty.structureDamage,
      cause: 'arty', volley: false, atWill: false, payload: null,
    });
    const events = run(world, TICK_RATE);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'ground', x: 30, y: 0, z: 0, splash: arty.splashRadius }]);
    // The kaiju is inside the splash. It faces +Z and the shell fell to its side: a flank hit.
    expect(eventsOf(events, 'kaijuHit')).toMatchObject([{ facing: 'flank', cause: 'arty' }]);
    expect(k.hp).toBeLessThan(k.maxHp);
    expect(k.nerve).toBeGreaterThan(0);
    // A call-in has no source unit, so it never makes crossfire.
    expect(k.recentHits).toEqual([]);
    expect(5000 - world.structureHp[0]).toBe(arty.structureDamage);
    expect(world.structureHp[1]).toBe(5000);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(bitGet(world.propAlive, 1)).toBe(true);
  });

  it('says so when a shot lands in the water', () => {
    const world = arena({ water: [[50, -50, 150, 50]] });
    fireShell(world, 100, 0, 0, 1, { vy: -30 });
    expect(eventsOf(run(world, 10), 'projectileHit')).toMatchObject([{ target: 'water', y: 0 }]);
  });

  it('never hits the kaiju that threw it, and does hit the units it lands among', () => {
    const world = arena();
    const k = world.kaijus[0];
    const u = placeUnit(world, 0, 0, 40);
    // Thrown from inside its own body, straight at a unit.
    spawnProjectile(world, {
      type: 'thrown', flight: 'thrown', owner: 'kaiju', ownerId: 0, player: KAIJU_PLAYER,
      x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 60, gravity: 0, ttl: 5,
      damage: 30, nerve: 20, splash: 0, structureDamage: 10, cause: 'thrown', volley: false, atWill: false,
      payload: { kind: 'wreck', wreck: 'car' },
    });
    const events = run(world, TICK_RATE);
    expect(k.hp).toBe(k.maxHp);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'unit', targetId: 0 }]);
    expect(u.maxHp - u.hp).toBe(30);
    expect(u.nerve).toBeGreaterThan(0);
    expect(world.players[KAIJU_PLAYER].tally.damageDealt).toBe(30);
  });
});
