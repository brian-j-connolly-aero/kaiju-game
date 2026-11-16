/**
 * Throws on real ballistic arcs (round 4; sim/throwArc.ts): the arc the preview draws is the arc
 * flown, the error is the seed's alone, a lob goes over a building, and the spread lets a throw
 * hit a squad standing still five monster lengths away most of the time and less often farther.
 */

import { describe, expect, it } from 'vitest';
import {
  aimThrowAt,
  createThrowAim,
  createThrowFlight,
  createThrowLaunch,
  createThrowTrace,
  LIZARD,
  spawnProjectile,
  throwClearance,
  throwElevations,
  throwError,
  throwFlight,
  throwLaunch,
  traceThrow,
  type HeldObject,
  type SimEvent,
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
  /** Share of `n` throws, aimed by the bots' aim, that hit a squad standing still `d` meters away. */
  function hitRate(d: number, n: number): number {
    let hits = 0;
    let world = arena({}, 1);
    for (let i = 0; i < n; i++) {
      // A fresh match now and then (a match's clock runs out).
      if (i % 40 === 0) world = arena({}, 1 + i);
      placeKaiju(world, 0, 0, 0);
      const k = world.kaijus[0];
      const u = placeUnit(world, 0, 0, d);
      u.hp = u.maxHp = 1e6;
      const aim = createThrowAim();
      expect(aimThrowAt(world.cityQuery, k, throwFlight(k.kind, k.stage, CAR, createThrowFlight()), u.x, 0, u.z, 5, 0, aim)).toBe(true);
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
});
