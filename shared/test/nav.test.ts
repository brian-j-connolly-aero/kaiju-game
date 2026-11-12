import { describe, expect, it } from 'vitest';
import {
  beginStage,
  boundsContains,
  corridorClear,
  createRng,
  createSteer,
  rngRange,
  shallowWay,
  solidInCircle,
  steerToward,
  structureContact,
  structuresInCircle,
  TICK_RATE,
  UNIT_TYPES,
  type PlayerInput,
  type Unit,
  type World,
} from '../src/index';
import { holdFire, input, makeTestCity, makeTestWorld, parkUnits, placeKaiju, placeUnit, queryFor, run } from './helpers';

function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): void {
  run(world, ticks, [null, input(partial)]);
}

/** Sends the first squad's sub-units to a marker and returns the first of them. */
function send(world: World, x: number, z: number): Unit {
  lead(world, 1, { wheel: 'moveTo', marker: { x, z } });
  return world.units[1];
}

function sunkIntoWall(world: World, u: Unit): boolean {
  const ids: number[] = [];
  structuresInCircle(world.cityQuery, u.x, u.z, u.radius - 0.3, ids);
  return ids.some((id) => world.cityIndex.spassable[id] === 0 && structureContact(world.cityIndex, id, u.x, u.z, u.radius - 0.3));
}

describe('corridors: can a body of this width go straight from here to there', () => {
  const q = queryFor(
    makeTestCity({
      structures: [
        { x: 0, z: 50, w: 20, d: 10, height: 10 },
        { x: 100, z: 50, w: 16, d: 60, height: 8, passable: true },
      ],
    }),
  );

  it('is clear in the open and shut by a wall', () => {
    expect(corridorClear(q, -50, 0, -50, 100, 3)).toBe(true);
    expect(corridorClear(q, 0, 0, 0, 100, 3)).toBe(false);
    // Stopping short of the wall is fine; ending with the body inside it is not.
    expect(corridorClear(q, 0, 0, 0, 41, 3)).toBe(true);
    expect(corridorClear(q, 0, 0, 0, 43, 3)).toBe(false);
  });

  it('measures with the whole width of the body', () => {
    // The wall's east face is at x = 10. A line at x = 12 clears it for a thin body only.
    expect(corridorClear(q, 12, 0, 12, 100, 1)).toBe(true);
    expect(corridorClear(q, 12, 0, 12, 100, 3)).toBe(false);
    expect(corridorClear(q, 14, 0, 14, 100, 3)).toBe(true);
    // A troop of tanks (9 m radius) needs a lot more room.
    expect(corridorClear(q, 16, 0, 16, 100, 9)).toBe(false);
    expect(corridorClear(q, 20, 0, 20, 100, 9)).toBe(true);
  });

  it('goes over rubble and over a bridge deck', () => {
    expect(corridorClear(q, 100, 0, 100, 100, 4)).toBe(true);
    expect(solidInCircle(q, 100, 50, 4)).toBe(false);
    expect(solidInCircle(q, 0, 50, 4)).toBe(true);
    q.structureHp[0] = 0;
    expect(corridorClear(q, 0, 0, 0, 100, 3)).toBe(true);
    expect(solidInCircle(q, 0, 50, 4)).toBe(false);
  });
});

describe('water: a straight line may wade a river, not cross a bay', () => {
  const q = queryFor(
    makeTestCity({
      // A river 60 m wide with a bridge deck over it, and a bay 400 m across.
      water: [
        [-1000, 100, 1000, 160],
        [-1000, 400, 1000, 800],
      ],
      structures: [{ x: 300, z: 130, w: 16, d: 80, height: 8, passable: true }],
    }),
  );

  it('takes a line that wades no more than about a river, and not one across the bay', () => {
    expect(shallowWay(q, 0, 0, 0, 300)).toBe(true);
    // Diagonally over the river: still under the limit.
    expect(shallowWay(q, 0, 0, 100, 300)).toBe(true);
    expect(shallowWay(q, 0, 300, 0, 900)).toBe(false);
    // Along the shore, dry the whole way: fine however long.
    expect(shallowWay(q, -900, 300, 900, 300)).toBe(true);
    // Along the river on its bridge deck: the deck is dry.
    expect(shallowWay(q, 300, 92, 300, 168)).toBe(true);
    expect(shallowWay(q, 0, 105, 900, 105)).toBe(false);
  });

  it('does not set off straight across the bay, but wades the river', () => {
    const world = makeTestWorld({ water: [[-1000, 100, 1000, 160], [-1000, 400, 1000, 800]] });
    world.match.bounds = world.match.stageBounds[2];
    parkUnits(world);
    placeKaiju(world, -700, -700, 0);
    const steer = createSteer();
    const u = placeUnit(world, 1, 0, 0);
    steerToward(world, u, 0, 300, 2, steer);
    expect(u.nav.direct).toBe(true);
    const v = placeUnit(world, 2, 50, 300);
    steerToward(world, v, 50, 900, 2, steer);
    expect(v.nav.direct).toBe(false);
  });
});

describe('finding the way', () => {
  function field(structures: NonNullable<Parameters<typeof makeTestWorld>[0]>['structures']): World {
    const world = makeTestWorld({ structures });
    world.match.bounds = world.match.stageBounds[2];
    parkUnits(world);
    placeKaiju(world, -700, -700, 0);
    // Hold fire; only unit 1 matters in these tests.
    return world;
  }

  it('answers with a heading and a throttle, and eases off on arrival', () => {
    const world = field([]);
    const u = placeUnit(world, 1, 0, 0);
    const steer = createSteer();
    steerToward(world, u, 0, 100, 1, steer);
    expect(steer).toMatchObject({ dirX: 0, dirZ: 1, throttle: 1, arrived: false });
    // Inside the last stretch (speed x arriveSlowTime) the throttle comes down with the distance.
    u.z = 99;
    steerToward(world, u, 0, 100, 0.2, steer);
    expect(steer.throttle).toBeGreaterThan(0);
    expect(steer.throttle).toBeLessThan(0.5);
    u.z = 99.9;
    steerToward(world, u, 0, 100, 0.2, steer);
    expect(steer).toMatchObject({ throttle: 0, arrived: true });
  });

  it('walks round a wall with no roads to help, and takes the short way round', () => {
    // A wall 100 m wide; the unit and its goal are near its east end.
    const world = field([{ x: 0, z: 50, w: 100, d: 10, height: 10 }]);
    placeUnit(world, 0, 20, -10);
    placeUnit(world, 1, 30, 0);
    placeUnit(world, 2, 400, 400);
    placeUnit(world, 3, 420, 400);
    const u = send(world, 30, 100);
    let west = 0;
    for (let t = 0; t < TICK_RATE * 40; t++) {
      lead(world, 1);
      expect(sunkIntoWall(world, u)).toBe(false);
      west = Math.min(west, u.x);
      if (Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ) < 2) break;
    }
    expect(Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ)).toBeLessThan(2);
    expect(u.z).toBeGreaterThan(60);
    // It went round the east end (20 m away), not the west end (80 m away).
    expect(west).toBeGreaterThan(-10);
  });

  it('gives up for a while on a place it cannot get into, instead of grinding against the wall', () => {
    // A closed yard: four walls with no gap. The goal is inside, the unit outside.
    const world = field([
      { x: 0, z: 70, w: 60, d: 6, height: 10 },
      { x: 0, z: 130, w: 60, d: 6, height: 10 },
      { x: -27, z: 100, w: 6, d: 54, height: 10 },
      { x: 27, z: 100, w: 6, d: 54, height: 10 },
    ]);
    const u = placeUnit(world, 1, 0, 0);
    u.nav.hasHold = true;
    u.nav.holdX = 0;
    u.nav.holdZ = 100;
    u.nav.settled = false;
    world.squads[0].moveOrder = 'moveTo';
    let waited = 0;
    for (let t = 0; t < TICK_RATE * 90; t++) {
      lead(world, 1);
      expect(sunkIntoWall(world, u)).toBe(false);
      expect(Number.isFinite(u.x) && Number.isFinite(u.z)).toBe(true);
      if (u.nav.wait > 0) waited++;
    }
    // It never got in, and it spent part of the time standing by rather than pushing.
    expect(Math.abs(u.x) < 24 && Math.abs(u.z - 100) < 27).toBe(false);
    expect(waited).toBeGreaterThan(TICK_RATE * 2);
  });

  it('plans along the streets of the real city without ever leaving the quarantine line', () => {
    // Stage 1 squads deploy in the corners of a small square whose nearest crossroads may lie outside it.
    const world = makeTestWorld({ realCity: true, seed: 5 });
    const b = world.match.bounds;
    lead(world, 1, { wheel: 'holdCharge' });
    const leader = world.units[0];
    const tx = leader.x < (b.minX + b.maxX) / 2 ? b.maxX - 60 : b.minX + 60;
    const tz = leader.z < (b.minZ + b.maxZ) / 2 ? b.maxZ - 100 : b.minZ + 100;
    const u = send(world, tx, tz);
    const speed = UNIT_TYPES[u.type].speed;
    const way = Math.abs(u.nav.holdX - u.x) + Math.abs(u.nav.holdZ - u.z);
    let usedRoads = false;
    let ticks = 0;
    while (!u.rooted && ticks < ((way * 1.6) / speed + 20) * TICK_RATE) {
      lead(world, 1);
      ticks++;
      if (u.nav.path.length > 0) {
        usedRoads = true;
        for (const p of u.nav.path) expect(boundsContains(b, p.x, p.z, u.radius - 0.5)).toBe(true);
      }
      expect(sunkIntoWall(world, u)).toBe(false);
    }
    expect(usedRoads).toBe(true);
    expect(u.rooted).toBe(true);
    expect(Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ)).toBeLessThan(2);
  });

  it('gets every sub-unit to markers dropped anywhere in the real city, at every level', () => {
    const rng = createRng(2024);
    for (const stage of [1, 2, 3] as const) {
      const world = makeTestWorld({ realCity: true, seed: 3 + stage, config: { anchor: 2 * stage } });
      if (stage > 1) beginStage(world, stage);
      const b = world.match.bounds;
      // Everybody holds fire, so nothing but the driving is going on.
      holdFire(world);
      lead(world, 1);
      const units = [1, 2, 3].map((id) => world.units[id]);
      const speed = UNIT_TYPES[units[0].type].speed;
      for (let trial = 0; trial < 4; trial++) {
        // Anywhere: on a roof, in a back yard, in the river. Not too far, to keep the test short.
        const from = units[0];
        const reach = stage === 1 ? 300 : 420;
        const x = Math.min(b.maxX - 5, Math.max(b.minX + 5, from.x + rngRange(rng, -reach, reach)));
        const z = Math.min(b.maxZ - 5, Math.max(b.minZ + 5, from.z + rngRange(rng, -reach, reach)));
        lead(world, 1, { wheel: 'moveTo', marker: { x, z } });
        const way = Math.max(...units.map((u) => Math.abs(u.nav.holdX - u.x) + Math.abs(u.nav.holdZ - u.z)));
        const limit = Math.ceil(((way * 2.5) / speed + 30) * TICK_RATE);
        let ticks = 0;
        while (ticks < limit && units.some((u) => !u.rooted)) {
          lead(world, 10);
          ticks += 10;
          for (const u of units) {
            expect(sunkIntoWall(world, u)).toBe(false);
            expect(boundsContains(b, u.x, u.z, u.radius - 1e-6)).toBe(true);
          }
        }
        for (const u of units) {
          expect(u.rooted).toBe(true);
          expect(Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ)).toBeLessThan(2);
          // Hold points keep off each other and off the walls.
          expect(solidInCircle(world.cityQuery, u.nav.holdX, u.nav.holdZ, u.radius)).toBe(false);
        }
        expect(Math.hypot(units[0].x - units[1].x, units[0].z - units[1].z)).toBeGreaterThan(2 * units[0].radius);
      }
    }
  });
});
