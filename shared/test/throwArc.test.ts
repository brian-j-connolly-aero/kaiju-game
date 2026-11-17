/**
 * Throws on real ballistic arcs (round 4; sim/throwArc.ts): the arc the preview draws is the arc
 * flown, the error is the seed's alone, a lob goes over a building, and the spread lets a throw
 * hit a squad standing still five monster lengths away most of the time and less often farther.
 * Round 5: the throw lands where the crosshair points (`aimThrowAtPoint` picks the arc), and the
 * landing ring drawn holds nearly every flat throw.
 */

import { describe, expect, it } from 'vitest';
import {
  aimThrowAt,
  aimThrowAtPoint,
  createLandingSpread,
  createPointThrowAim,
  createThrowAim,
  createThrowFlight,
  createThrowLaunch,
  createThrowTrace,
  landingSpread,
  LIZARD,
  spawnProjectile,
  throwClearance,
  throwElevations,
  throwError,
  throwFlight,
  throwLaunch,
  traceThrow,
  type HeldObject,
  type PointThrowAim,
  type SimEvent,
  type ThrowFlight,
  type ThrowTrace,
  type World,
} from '../src/index';
import { throwEffect } from '../src/sim/kaijuEffects';
import { eventsOf, holdFire, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run } from './helpers';

const A = LIZARD.actions.throw;
const CAR: HeldObject = { kind: 'prop', prop: 'car_sedan' };
/** The hatchling from snout to tail (the model: 2.6 m ahead of its middle, 3.5 m behind). */
const HATCHLING_LENGTH = 6.1;

function arena(structures: Parameters<typeof makeTestWorld>[0] = {}, seed = 7): World {
  const world = makeTestWorld({ ...structures, seed });
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  holdFire(world);
  return world;
}

/** Steps until no projectile is in the air; returns the events. */
function land(world: World): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < 900 && world.projectiles.length > 0; i++) events.push(...run(world, 1, [input()]));
  return events;
}

describe('the arc', () => {
  it('solves both elevations that carry a throw onto a point', () => {
    const g = A.gravity[0];
    const v = A.speed[0];
    for (const [d, dy] of [[20, -2], [45, 0], [60, 3]] as const) {
      const both = throwElevationsOrFail(d, dy, v, g);
      for (const e of both) {
        const t = d / (v * Math.cos(e));
        expect(v * Math.sin(e) * t - 0.5 * g * t * t).toBeCloseTo(dy, 6);
      }
      expect(both[0]).toBeLessThan(Math.PI / 4);
      expect(both[1]).toBeGreaterThan(Math.PI / 4);
    }
  });

  it('is flown exactly as it is traced: the projectile system and the preview agree', () => {
    const world = arena({ structures: [{ x: 6, z: 40, w: 10, d: 8, height: 12, hp: 1e6 }] });
    const k = world.kaijus[0];
    for (const pitch of [-0.2, 0, 0.15]) {
      k.aimPitch = pitch;
      k.aimYaw = 0.1;
      const launch = throwLaunch(k, throwFlight(k.kind, k.stage, CAR, createThrowFlight()), createThrowLaunch());
      const trace = traceThrow(world.cityQuery, launch, 0, createThrowTrace());
      spawnProjectile(world, {
        type: 'thrown',
        flight: 'thrown',
        owner: 'kaiju',
        ownerId: 0,
        player: KAIJU_PLAYER,
        x: launch.x,
        y: launch.y,
        z: launch.z,
        vx: launch.vx,
        vy: launch.vy,
        vz: launch.vz,
        gravity: launch.gravity,
        ttl: launch.ttl,
        damage: 0,
        nerve: 0,
        splash: 0,
        structureDamage: 0,
        cause: 'thrown',
        volley: false,
        atWill: false,
        payload: CAR,
      });
      const hit = eventsOf(land(world), 'projectileHit');
      expect(hit).toHaveLength(1);
      expect(hit[0].target).toBe(trace.end);
      expect(hit[0].x).toBeCloseTo(trace.x, 6);
      expect(hit[0].y).toBeCloseTo(trace.y, 6);
      expect(hit[0].z).toBeCloseTo(trace.z, 6);
    }
  });
});

/** throwElevations, failing the test when it finds no arc. */
function throwElevationsOrFail(d: number, dy: number, v: number, g: number): [number, number] {
  const both = throwElevations(d, dy, v, g);
  expect(both).not.toBeNull();
  return both ?? [0, 0];
}

describe('the error', () => {
  it('comes from the seed alone, and never strays outside the spread', () => {
    const flight = throwFlight('lizard', 1, CAR, createThrowFlight());
    const src = { kind: 'lizard' as const, stage: 1 as const, x: 0, z: 0, aimYaw: 0.3, aimPitch: 0.05 };
    const aimed = throwLaunch(src, flight, createThrowLaunch());
    const a = throwError(throwLaunch(src, flight, createThrowLaunch()), 12345);
    const b = throwError(throwLaunch(src, flight, createThrowLaunch()), 12345);
    const c = throwError(throwLaunch(src, flight, createThrowLaunch()), 12346);
    expect([a.vx, a.vy, a.vz]).toEqual([b.vx, b.vy, b.vz]);
    expect([a.vx, a.vy, a.vz]).not.toEqual([c.vx, c.vy, c.vz]);
    const most = flight.speed * Math.tan(flight.spread);
    for (let seed = 0; seed < 200; seed++) {
      const l = throwError(throwLaunch(src, flight, createThrowLaunch()), seed);
      expect(Math.hypot(l.vx - aimed.vx, l.vy - aimed.vy, l.vz - aimed.vz)).toBeLessThanOrEqual(most + 1e-9);
    }
  });

  it('is the same throw on every run of the same match', () => {
    const throwOnce = (): number[] => {
      const world = arena({}, 99);
      const k = world.kaijus[0];
      k.held = CAR;
      run(world, 13);
      throwEffect(world, k, LIZARD);
      const s = eventsOf(world.events, 'projectileSpawn')[0];
      return [s.vx, s.vy, s.vz];
    };
    expect(throwOnce()).toEqual(throwOnce());
  });
});

describe('lobbing', () => {
  it('goes over a building the low arc would hit, when aimed high', () => {
    // A house between the hatchling and a squad 40 m out.
    const world = arena({ structures: [{ x: 0, z: 11, w: 12, d: 6, height: 9, hp: 1e6 }] });
    const k = world.kaijus[0];
    const u = placeUnit(world, 0, 0, 40);
    u.hp = u.maxHp = 1e6;
    const flight = throwFlight(k.kind, k.stage, CAR, createThrowFlight());
    const aim = createThrowAim();
    // The low arc ends on the house.
    k.aimPitch = 0;
    const low = traceThrow(world.cityQuery, throwLaunch({ ...k, aimPitch: throwElevationsOrFail(40 - k.radius * 0.6, -2.2, flight.speed, flight.gravity)[0] - flight.lift }, flight, createThrowLaunch()), 0, createThrowTrace());
    expect(low.end).toBe('structure');
    // The bots' aim finds the lob over it.
    expect(aimThrowAt(world.cityQuery, k, flight, u.x, 0, u.z, 4, throwClearance(k), aim)).toBe(true);
    expect(aim.high).toBe(true);
    // Thrown that way (error and all), it flies over the house and comes down beyond it.
    k.held = CAR;
    k.aimYaw = aim.yaw;
    k.aimPitch = aim.pitch;
    throwEffect(world, k, LIZARD);
    const hit = eventsOf(land(world), 'projectileHit');
    expect(hit).toHaveLength(1);
    expect(hit[0].target).not.toBe('structure');
    expect(hit[0].z).toBeGreaterThan(14);
    expect(world.structureHp[0]).toBe(1e6);
  });
});

describe('the spread at range', () => {
  /**
   * Share of `n` throws that hit a squad standing still `d` meters away: aimed by the bots' aim,
   * or (`crosshair`) by the monster player's crosshair on the squad's feet.
   */
  function hitRate(d: number, n: number, crosshair = false): number {
    let hits = 0;
    let world = arena({}, 1);
    for (let i = 0; i < n; i++) {
      // A fresh match now and then (a match's clock runs out).
      if (i % 40 === 0) world = arena({}, 1 + i);
      placeKaiju(world, 0, 0, 0);
      const k = world.kaijus[0];
      const u = placeUnit(world, 0, 0, d);
      u.hp = u.maxHp = 1e6;
      const flight = throwFlight(k.kind, k.stage, CAR, createThrowFlight());
      const aim = createPointThrowAim();
      if (crosshair) {
        aimThrowAtPoint(world.cityQuery, k, flight, u.x, u.y, u.z, A.impactRadius[0] * 0.25, -1, LIZARD.headLeadMax, throwClearance(k), aim);
        expect(aim.reach).toBe('on');
      } else {
        expect(aimThrowAt(world.cityQuery, k, flight, u.x, 0, u.z, 5, 0, aim)).toBe(true);
      }
      k.held = CAR;
      k.aimYaw = aim.yaw;
      k.aimPitch = aim.pitch;
      throwEffect(world, k, LIZARD);
      land(world);
      if (u.hp < 1e6) hits++;
      run(world, 1 + (i % 3));
    }
    return hits / n;
  }

  it('hits a hatchling-sized squad standing still five monster lengths away most of the time, and far less often at ten', () => {
    const near = hitRate(5 * HATCHLING_LENGTH, 80);
    const far = hitRate(10 * HATCHLING_LENGTH, 80);
    expect(near).toBeGreaterThanOrEqual(0.65);
    expect(near).toBeLessThanOrEqual(0.92);
    expect(far).toBeLessThan(near - 0.25);
    expect(far).toBeGreaterThan(0);
  });

  it('hits it as often with the crosshair on its feet (round 5: the balance stays)', () => {
    const near = hitRate(5 * HATCHLING_LENGTH, 80, true);
    expect(near).toBeGreaterThanOrEqual(0.65);
    expect(near).toBeLessThanOrEqual(0.92);
  });

  it('lands inside the ring drawn nearly every time, flat throws too (round 5: one in four fell outside)', () => {
    const flight = throwFlight('lizard', 1, CAR, createThrowFlight());
    const world = arena();
    const k = world.kaijus[0];
    const aim = createThrowAim();
    expect(aimThrowAt(world.cityQuery, k, flight, 0, 0, 5 * HATCHLING_LENGTH, 1, 0, aim)).toBe(true);
    expect(aim.high).toBe(false);
    const src = { kind: k.kind, stage: k.stage, x: 0, z: 0, aimYaw: aim.yaw, aimPitch: aim.pitch };
    const launch = throwLaunch(src, flight, createThrowLaunch());
    const aimed = traceThrow(world.cityQuery, launch, 0, createThrowTrace());
    const ring = landingSpread(launch, aimed, createLandingSpread());
    const trace = createThrowTrace();
    let outside = 0;
    const n = 400;
    for (let seed = 0; seed < n; seed++) {
      traceThrow(world.cityQuery, throwError(throwLaunch(src, flight, createThrowLaunch()), 1000 + seed * 7919), 0, trace);
      const dx = trace.x - aimed.x;
      const dz = trace.z - aimed.z;
      const along = dx * ring.dirX + dz * ring.dirZ;
      const across = dx * ring.dirZ - dz * ring.dirX;
      if ((along / ring.along) ** 2 + (across / ring.across) ** 2 > 1) outside++;
    }
    expect(outside / n).toBeLessThanOrEqual(0.08);
  });
});

describe('aiming at the crosshair’s point (round 5)', () => {
  const TOLERANCE = A.impactRadius[0] * 0.25;

  /** The monster's throw at (tx, ty, tz) from the origin, facing +z, and the arc it flies. */
  function aimAt(world: World, tx: number, ty: number, tz: number, structure = -1, preferHigh = false): { aim: PointThrowAim; flight: ThrowFlight; trace: ThrowTrace } {
    const k = world.kaijus[0];
    const flight = throwFlight(k.kind, k.stage, CAR, createThrowFlight());
    const aim = aimThrowAtPoint(world.cityQuery, k, flight, tx, ty, tz, TOLERANCE, structure, LIZARD.headLeadMax, throwClearance(k), createPointThrowAim(), preferHigh);
    const launch = throwLaunch({ kind: k.kind, stage: k.stage, x: k.x, z: k.z, aimYaw: aim.yaw, aimPitch: aim.pitch }, flight, createThrowLaunch());
    const trace = traceThrow(world.cityQuery, launch, throwClearance(k), createThrowTrace());
    // The answer says where its arc comes down: exactly where the arc flown with its aim does.
    expect(Math.hypot(aim.x - trace.x, aim.y - trace.y, aim.z - trace.z)).toBeLessThan(1e-9);
    return { aim, flight, trace };
  }

  it('lands on open ground where the crosshair points, on the flat arc', () => {
    const { aim, trace } = aimAt(arena(), 6, 0, 24);
    expect(aim.reach).toBe('on');
    expect(aim.high).toBe(false);
    expect(trace.end).toBe('ground');
    expect(Math.hypot(trace.x - 6, trace.z - 24)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('lobs over a house in the way, and comes down beyond it', () => {
    const { aim, trace } = aimAt(arena({ structures: [{ x: 0, z: 11, w: 12, d: 6, height: 9, hp: 1e6 }] }), 0, 0, 30);
    expect(aim.reach).toBe('on');
    expect(aim.high).toBe(true);
    expect(trace.end).toBe('ground');
    expect(Math.hypot(trace.x, trace.z - 30)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('keeps the lob while it was the last choice and still gets there (no flicker), else takes the flat arc', () => {
    const world = arena();
    expect(aimAt(world, 0, 0, 30, -1, true).aim).toMatchObject({ reach: 'on', high: true });
    expect(aimAt(world, 0, 0, 30, -1, false).aim).toMatchObject({ reach: 'on', high: false });
  });

  it('lands on the roof the crosshair is on', () => {
    const world = arena({ structures: [{ x: 0, z: 30, w: 14, d: 14, height: 8, hp: 1e6 }] });
    const { aim, trace } = aimAt(world, 1, 8, 31, 0);
    expect(aim.reach).toBe('on');
    expect(trace.end).toBe('structure');
    expect(trace.structure).toBe(0);
    expect(trace.ny).toBeGreaterThan(0.5);
  });

  it('beyond reach, goes as far as any throw can that way, and says so', () => {
    const world = arena();
    const { aim, flight, trace } = aimAt(world, 0, 0, 200);
    expect(aim.reach).toBe('short');
    expect(trace.end).toBe('ground');
    const k = world.kaijus[0];
    const other = createThrowTrace();
    for (let pitch = -0.6; pitch <= 1.2; pitch += 0.05) {
      traceThrow(world.cityQuery, throwLaunch({ kind: k.kind, stage: k.stage, x: 0, z: 0, aimYaw: 0, aimPitch: pitch }, flight, createThrowLaunch()), 0, other);
      expect(other.z).toBeLessThanOrEqual(trace.z + 0.5);
    }
  });

  it('says when a house stands in the way of every arc', () => {
    // A tall block right in front: neither arc gets to the street behind it.
    const { aim } = aimAt(arena({ structures: [{ x: 0, z: 12, w: 30, d: 6, height: 60, hp: 1e6 }] }), 0, 0, 30);
    expect(aim.reach).toBe('blocked');
  });

  it('beside the monster, beyond the head’s turn: as far round as it turns, and says so', () => {
    const off = 80 * (Math.PI / 180);
    const { aim } = aimAt(arena(), Math.sin(off) * 25, 0, Math.cos(off) * 25);
    expect(aim.reach).toBe('close');
    expect(aim.yaw).toBeCloseTo(LIZARD.headLeadMax, 9);
  });
});
