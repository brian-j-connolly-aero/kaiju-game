/**
 * Rubble that stays and buildings that fall over (docs/ROADMAP.md, phase 2; DESIGN.md section 7,
 * "Rubble and falls"): a collapsed building is a mound that stops shots and sight up to its
 * height and slows units; a slender one may fall over on its side, crush what it lands on, and
 * lie there as a long mound.
 */

import { describe, expect, it } from 'vitest';
import {
  applyStructureDamage,
  castSegment,
  cityStateFromWire,
  createCityQuery,
  createMoveResult,
  decodeCityState,
  encodeCityState,
  FALL_RULES,
  fallenBox,
  createMoundBox,
  kaijuMoveParams,
  lineOfSight,
  moundHeightAt,
  RUBBLE_RULES,
  spawnProjectile,
  startStructureFall,
  stepMovement,
  TICK_RATE,
  UNIT_TYPES,
  unitMoveParams,
  DT,
  type Bounds,
  type MoveInput,
  type World,
} from '../src/index';
import { eventsOf, KAIJU_PLAYER, makeTestCity, makeTestWorld, parkUnits, placeKaiju, placeUnit, queryFor, run } from './helpers';

const BIG: Bounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
const eye = (x: number, y: number, z: number) => ({ x, y, z });

/** Brings a structure down where it stands (no fall), the way the city damage system leaves it. */
function collapse(world: World, id: number): void {
  world.structureHp[id] = 0;
  world.structureStage[id] = 3;
}

describe('rubble', () => {
  it('is a mound half as high as the building that stops shots and sight up to its height, and not a body', () => {
    // A 30 m block across the line between two points 200 m apart.
    const built = makeTestCity({ structures: [{ x: 0, z: 100, w: 20, d: 20, height: 30 }] });
    const q = queryFor(built);
    q.structureHp[0] = 0;
    const mound = Math.min(RUBBLE_RULES.maxHeight, 30 * RUBBLE_RULES.heightShare);
    expect(built.index.srubble[0]).toBe(mound);
    expect(moundHeightAt(q, 0, 100)).toBe(mound);
    expect(moundHeightAt(q, 0, 120)).toBe(0);
    // Shots and sight count it (up to its height); movement does not.
    expect(lineOfSight(q, eye(0, 2, 0), eye(0, 2, 200), true, true)).toBe(false);
    expect(lineOfSight(q, eye(0, mound + 1, 0), eye(0, mound + 1, 200), true, true)).toBe(true);
    expect(lineOfSight(q, eye(0, 2, 0), eye(0, 2, 200), true)).toBe(true);
    // Whoever stands on it sees and shoots over it.
    expect(lineOfSight(q, eye(0, 2, 100), eye(0, 2, 200), true, true)).toBe(true);
    expect(castSegment(q, eye(0, 2, 200), eye(0, 2, 100), undefined, -1, true, true)).toBe(true);
    // A tall building's mound is never taller than the cap.
    const tower = makeTestCity({ structures: [{ x: 0, z: 0, w: 30, d: 30, height: 200 }] });
    expect(tower.index.srubble[0]).toBe(RUBBLE_RULES.maxHeight);
    // A bridge deck leaves none.
    expect(makeTestCity({ structures: [{ x: 0, z: 0, w: 16, d: 60, height: 8, passable: true }] }).index.srubble[0]).toBe(0);
  });

  it('stops a shot that would have gone over the flat ground, and it lands on the mound', () => {
    const world = makeTestWorld({ structures: [{ x: 0, z: 100, w: 20, d: 20, height: 30 }] });
    parkUnits(world);
    placeKaiju(world, -500, -500, 0);
    collapse(world, 0);
    spawnProjectile(world, {
      type: 'shell', flight: 'flat', owner: 'unit', ownerId: 4, player: 2, x: 0, y: 2, z: 40, vx: 0, vy: 0, vz: 110, gravity: 0, ttl: 3,
      damage: 9.5, nerve: 5.4, splash: 5, structureDamage: 25, cause: 'shell', volley: false, atWill: false, payload: null,
    });
    const hits = eventsOf(run(world, TICK_RATE), 'projectileHit');
    expect(hits).toMatchObject([{ target: 'structure', targetId: 0 }]);
    expect(hits[0].z).toBeCloseTo(90, 3);
  });

  it('slows units to half speed while they cross it; the kaiju walks over it', () => {
    const built = makeTestCity({ structures: [{ x: 0, z: 60, w: 200, d: 40, height: 20 }] });
    const q = queryFor(built);
    q.structureHp[0] = 0;
    const def = UNIT_TYPES.army_rocket_infantry;
    const params = unitMoveParams(def, { alive: true, rooted: false }, BIG);
    const north: MoveInput = { moveX: 0, moveZ: 1, aimYaw: 0 };
    const result = createMoveResult();
    const body = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, radius: def.radius };
    let onMound = 0;
    for (let i = 0; i < 30 * 15; i++) {
      stepMovement(body, north, DT, q, params, result);
      if (body.z > 45 && body.z < 75) {
        expect(result.onMound).toBe(true);
        expect(Math.hypot(body.vx, body.vz)).toBeCloseTo(def.speed * RUBBLE_RULES.unitSpeedMult, 6);
        onMound++;
      }
    }
    expect(onMound).toBeGreaterThan(0);
    // Never blocked: it came out the far side at full speed again.
    expect(body.z).toBeGreaterThan(100);
    expect(Math.hypot(body.vx, body.vz)).toBeCloseTo(def.speed, 6);

    // The kaiju crosses at its own pace.
    const k = { kind: 'lizard' as const, stage: 2 as const, phase: 'idle' as const, action: 'none' as const, nerve: 0 };
    const kp = kaijuMoveParams(k, BIG);
    const big = { x: 0, z: 30, yaw: 0, vx: 0, vz: kp.topSpeed, radius: 8, aimYaw: 0 };
    stepMovement(big, north, DT, q, kp, result);
    expect(result.onMound).toBe(false);
    expect(Math.hypot(big.vx, big.vz)).toBeCloseTo(kp.topSpeed, 6);
  });
});

describe('buildings that fall over', () => {
  /**
   * A 40 m tower, 10 m on a side, with the kaiju south of it: it falls north, over a house and
   * onto a unit, and lies from z 5 to z 45, 10 m wide and 5 m high.
   */
  function fallField(): World {
    const world = makeTestWorld({
      structures: [
        { x: 0, z: 0, w: 10, d: 10, height: 40, hp: 2000, cls: 'tower' },
        { x: 0, z: 38, w: 8, d: 8, height: 6, hp: 500 },
        { x: 60, z: 30, w: 8, d: 8, height: 6, hp: 500 },
      ],
    });
    parkUnits(world);
    placeKaiju(world, 0, -40, 0);
    return world;
  }

  it('tips over away from the kaiju, lands two seconds later on what lies under it, and lies there as a long mound', () => {
    const world = fallField();
    const under = placeUnit(world, 4, 0, 25);
    const clear = placeUnit(world, 8, 30, 25);
    const fullHp = under.maxHp;

    // Knocked down by the kaiju, with no direction to the blow: it falls away from the kaiju.
    world.events = [];
    const top = startStructureFall(world, 0, 0, 0, KAIJU_PLAYER, 'swipe');
    const start = world.events;
    expect(top).not.toBeNull();
    expect(top!.x).toBeCloseTo(0, 6);
    expect(top!.z).toBeCloseTo(45, 6);
    expect(eventsOf(start, 'structureStage')).toMatchObject([{ id: 0, stage: 3, by: KAIJU_PLAYER, cause: 'swipe' }]);
    const falling = eventsOf(start, 'structureFall');
    expect(falling).toMatchObject([{ id: 0, phase: 'falling', side: 1, duration: FALL_RULES.time, by: KAIJU_PLAYER, cause: 'swipe' }]);
    expect(falling[0].yaw).toBeCloseTo(0, 9);
    expect([falling[0].x, falling[0].z, falling[0].topX, falling[0].topZ].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 5, 0, 45]);
    // Asked again, it keeps the fall it has.
    expect(startStructureFall(world, 0, 1, 0, KAIJU_PLAYER, 'swipe')).toEqual(top);

    // On its way down it is rubble where it stood; nothing has been hit yet.
    let events = run(world, Math.round(FALL_RULES.time * TICK_RATE) - 1);
    expect(eventsOf(events, 'structureFall')).toEqual([]);
    expect(under.hp).toBe(fullHp);
    expect(moundHeightAt(world.cityQuery, 0, 0)).toBeGreaterThan(0);

    // It lands: the unit under it is badly hurt, the house under it crushed, the one beside it untouched.
    events = run(world, 1);
    expect(eventsOf(events, 'structureFall')).toMatchObject([{ id: 0, phase: 'landed', side: 1, duration: 0 }]);
    const hit = eventsOf(events, 'unitHit').find((e) => e.unit === under.id);
    expect(hit).toMatchObject({ cause: 'fall' });
    expect(hit!.damage).toBeCloseTo(FALL_RULES.unitDamage * fullHp, 6);
    expect(eventsOf(events, 'unitHit').some((e) => e.unit === clear.id)).toBe(false);
    expect(eventsOf(events, 'structureStage')).toMatchObject([{ id: 1, stage: 3, cause: 'fall', by: KAIJU_PLAYER }]);
    expect(world.structureHp[2]).toBe(500);
    expect(world.structureFall[0]).toBe(2);
    expect(world.cityQuery.fallen).toEqual([0]);

    // It lies there: a long mound that blocks a line across it and slows units, its own footprint clear.
    const box = fallenBox(world.cityIndex, 0, 1, createMoundBox());
    expect([box.x, box.z, box.hx, box.hz, box.height].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 25, 5, 20, 5]);
    expect(moundHeightAt(world.cityQuery, 0, 25)).toBe(5);
    expect(moundHeightAt(world.cityQuery, 0, 0)).toBe(0);
    expect(lineOfSight(world.cityQuery, eye(-30, 2, 25), eye(30, 2, 25), true, true)).toBe(false);
    expect(lineOfSight(world.cityQuery, eye(-30, 6, 25), eye(30, 6, 25), true, true)).toBe(true);
    expect(lineOfSight(world.cityQuery, eye(-30, 2, 0), eye(30, 2, 0), true, true)).toBe(true);

    // A client that joins now gets it lying the same way, and sees the same lines.
    const decoded = decodeCityState(encodeCityState(world.structureStage, world.propAlive, world.propWreck, world.city.props.length, world.structureFall));
    const mirror = createCityQuery(world.cityIndex, cityStateFromWire(world.city, decoded));
    expect(mirror.fallen).toEqual([0]);
    expect(lineOfSight(mirror, eye(-30, 2, 25), eye(30, 2, 25), true, true)).toBe(false);
    expect(moundHeightAt(mirror, 0, 25)).toBe(5);
  });

  it('falls the way the shot that brought it down was going', () => {
    const world = fallField();
    world.events = [];
    // A shell travelling west (toward -X) brings it down: it falls west, whatever the kaiju.
    startStructureFall(world, 0, -1, 0.2, 2, 'shell');
    expect(eventsOf(world.events, 'structureFall')).toMatchObject([{ phase: 'falling', side: 2 }]);
  });

  it('happens about half the time to a slender building, never to a squat one, and never more than twice in a row', () => {
    const towers = 160;
    const structures = [];
    for (let i = 0; i < towers; i++) structures.push({ x: (i % 16) * 100 - 800, z: Math.floor(i / 16) * 100 - 500, w: 10, d: 10, height: 40, hp: 100 });
    for (let i = 0; i < 20; i++) structures.push({ x: (i % 16) * 100 - 800, z: 600, w: 10, d: 10, height: 25, hp: 100 });
    const world = makeTestWorld({ structures });
    placeKaiju(world, 0, -900, 0);
    world.events = [];
    for (let id = 0; id < towers; id++) applyStructureDamage(world, { id, damage: Infinity, by: KAIJU_PLAYER, cause: 'swipe' });
    const fell = eventsOf(world.events, 'structureFall').length;
    expect(fell).toBeGreaterThan(towers * 0.35);
    expect(fell).toBeLessThan(towers * 0.65);
    // Too squat to fall (25 m on a 10 m footprint).
    world.events = [];
    for (let id = towers; id < towers + 20; id++) applyStructureDamage(world, { id, damage: Infinity, by: KAIJU_PLAYER, cause: 'swipe' });
    expect(eventsOf(world.events, 'structureFall')).toEqual([]);

    // Brought down by the second fall in a row, a slender building collapses where it stands.
    const chain = makeTestWorld({ structures: structures.slice(0, towers) });
    chain.events = [];
    for (let id = 0; id < towers; id++) {
      applyStructureDamage(chain, { id, damage: Infinity, by: KAIJU_PLAYER, cause: 'fall', fallDepth: FALL_RULES.maxChain });
    }
    expect(eventsOf(chain.events, 'structureFall')).toEqual([]);
  });

  it('can bring a neighbor down, and that one can fall in turn', () => {
    // Two slender towers in a row, the second weak enough that the first's fall brings it down.
    const world = makeTestWorld({
      structures: [
        { x: 0, z: 0, w: 10, d: 10, height: 60, hp: 4000 },
        { x: 0, z: 40, w: 10, d: 10, height: 40, hp: 1000 },
      ],
    });
    placeKaiju(world, 0, -60, 0);
    world.events = [];
    startStructureFall(world, 0, 0, 1, KAIJU_PLAYER, 'swipe');
    const events = run(world, Math.round(FALL_RULES.time * TICK_RATE) + 1);
    expect(eventsOf(events, 'structureStage')).toMatchObject([{ id: 1, stage: 3, cause: 'fall' }]);
    // Whether it falls in turn is the draw's; if it does, it falls on along the same line.
    for (const f of eventsOf(events, 'structureFall').filter((e) => e.id === 1)) expect(f.side).toBe(1);
  });
});
