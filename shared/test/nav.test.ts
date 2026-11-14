import { describe, expect, it } from 'vitest';
import {
  beginStage,
  boundsContains,
  corridorClear,
  createRng,
  createSteer,
  rngInt,
  setTankMove,
  setWorldMove,
  shallowWay,
  solidInCircle,
  steerToward,
  structureContact,
  structuresInCircle,
  TICK_RATE,
  UNIT_TYPES,
  type PlayerInput,
  type Steer,
  type Unit,
  type World,
} from '../src/index';
import { holdFire, input, makeTestCity, makeTestWorld, parkUnits, placeKaiju, placeUnit, queryFor, run } from './helpers';

function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): void {
  run(world, ticks, [null, input(partial)]);
}

/**
 * One tick of the first squad's leader finding its way to (x, z) with `steerToward`, driven the
 * way the squad bot drives it (a tank by throttle and hull turn). Returns the steering answer.
 */
function navigate(world: World, x: number, z: number, tolerance: number, steer: Steer): Steer {
  const leader = world.units[world.squads[0].driven];
  steerToward(world, leader, x, z, tolerance, steer);
  const inp = input({ aimYaw: leader.control.aimYaw });
  if (steer.throttle > 0) {
    inp.aimYaw = Math.atan2(steer.dirX, steer.dirZ);
    if (UNIT_TYPES[leader.type].drive) setTankMove(inp, leader.yaw, steer.dirX, steer.dirZ, steer.throttle);
    else setWorldMove(inp, steer.dirX, steer.dirZ, steer.throttle);
  }
  run(world, 1, [null, inp]);
  return steer;
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
    const u = placeUnit(world, 0, 30, 0);
    const steer = createSteer();
    let west = 0;
    for (let t = 0; t < TICK_RATE * 40; t++) {
      if (navigate(world, 30, 100, 1.5, steer).arrived) break;
      expect(sunkIntoWall(world, u)).toBe(false);
      west = Math.min(west, u.x);
    }
    expect(Math.hypot(u.x - 30, u.z - 100)).toBeLessThan(2);
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
    const u = placeUnit(world, 0, 0, 0);
    const steer = createSteer();
    let waited = 0;
    for (let t = 0; t < TICK_RATE * 90; t++) {
      navigate(world, 0, 100, 1.5, steer);
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
    holdFire(world);
    const leader = world.units[0];
    const tx = leader.x < (b.minX + b.maxX) / 2 ? b.maxX - 60 : b.minX + 60;
    const tz = leader.z < (b.minZ + b.maxZ) / 2 ? b.maxZ - 100 : b.minZ + 100;
    const speed = UNIT_TYPES[leader.type].speed;
    const way = Math.abs(tx - leader.x) + Math.abs(tz - leader.z);
    const steer = createSteer();
    let usedRoads = false;
    let arrived = false;
    for (let ticks = 0; !arrived && ticks < ((way * 1.6) / speed + 20) * TICK_RATE; ticks++) {
      arrived = navigate(world, tx, tz, 1.5, steer).arrived;
      if (leader.nav.path.length > 0) {
        usedRoads = true;
        for (const p of leader.nav.path) expect(boundsContains(b, p.x, p.z, leader.radius - 0.5)).toBe(true);
      }
      expect(sunkIntoWall(world, leader)).toBe(false);
    }
    expect(usedRoads).toBe(true);
    expect(arrived).toBe(true);
  });

  it('gets a unit to crossroads anywhere in the real city at every level, its squad-mates in tow, clear of walls and inside the line', () => {
    for (const stage of [1, 2, 3] as const) {
      const world = makeTestWorld({ realCity: true, seed: 3 + stage, config: { anchor: 2 * stage } });
      if (stage > 1) beginStage(world, stage);
      const b = world.match.bounds;
      // Everybody holds fire, so nothing but the driving is going on.
      holdFire(world);
      lead(world, 1);
      const leader = world.units[0];
      const speed = UNIT_TYPES[leader.type].speed;
      const tolerance = stage === 1 ? 1.5 : 4;
      const nodes = world.city.roads.nodes.filter((n) => boundsContains(b, n.x, n.z, 20) && Math.hypot(n.x - leader.x, n.z - leader.z) < (stage === 1 ? 300 : 420));
      const rng = createRng(2024 + stage);
      const steer = createSteer();
      for (let trial = 0; trial < 4; trial++) {
        const goal = nodes[rngInt(rng, nodes.length)];
        const way = Math.abs(goal.x - leader.x) + Math.abs(goal.z - leader.z);
        const limit = Math.ceil(((way * 2.5) / speed + 30) * TICK_RATE);
        let arrived = false;
        for (let ticks = 0; !arrived && ticks < limit; ticks++) {
          arrived = navigate(world, goal.x, goal.z, tolerance, steer).arrived;
          if (ticks % 10 !== 0) continue;
          for (const u of world.units.slice(0, 4)) {
            expect(sunkIntoWall(world, u)).toBe(false);
            expect(boundsContains(b, u.x, u.z, u.radius - 1e-6)).toBe(true);
          }
        }
        expect(arrived, `stage ${stage}, trial ${trial}`).toBe(true);
      }
    }
  });
});
