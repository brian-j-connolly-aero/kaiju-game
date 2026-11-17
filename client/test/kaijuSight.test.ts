/**
 * The monster's line of sight (round 5, docs/ROADMAP.md: "when a shot, a volley or an attack
 * cannot reach because something is in the way, the screen must say so"): the controller finds
 * what cannot be reached (the beam stopped short of the crosshair by a building, a charge's lane
 * meeting a building too tall to smash), and the army shots that hit the monster are marked with
 * their shooter.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCityIndex,
  CITY_HALF,
  createCityQuery,
  createCityState,
  kaijuKindDef,
  type CityData,
  type SimEvent,
  type SnapKaiju,
  type Structure,
} from '@mb/shared';
import { KaijuController } from '../src/game/controllers/kaijuController';
import type { ControlContext } from '../src/game/controllers/types';
import { createActionState } from '../src/game/input/actions';
import { HitLog } from '../src/ui/kaijuSight';

const A = kaijuKindDef('lizard').actions;

function kaiju(over: Partial<SnapKaiju> = {}): SnapKaiju {
  return {
    id: 0, player: 0, kind: 'lizard', stage: 1, alive: true, moltAvailable: false, wading: false, inWater: false, submerge: 0, known: true, spotted: false,
    x: 0, z: 0, vx: 0, vz: 0, yaw: 0, aimYaw: 0, aimPitch: 0, hp: 500, maxHp: 500, nerve: 0, nerveImmune: 0, rage: 0,
    action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, held: null, cooldowns: {} as SnapKaiju['cooldowns'], moves: ['none', 'none'], offer: [], surge: 0, clubSwings: 0, shieldHp: 0,
    ...over,
  };
}

/** A city of just these buildings (axis-aligned boxes: x, z, half widths, height). */
function cityOf(boxes: Array<[number, number, number, number, number]>): { query: ReturnType<typeof createCityQuery>; city: CityData } {
  const structures: Structure[] = boxes.map(([x, z, hx, hz, height], id) => ({ id, archetype: 'office_a', x, z, hx, hz, yaw: 0, height, cls: 'office', hp: 1000, value: 10, landmark: null, passable: false }));
  const city: CityData = { seed: 1, half: CITY_HALF, structures, props: [], roads: { nodes: [], edges: [] }, areas: [], districts: [], anchors: [{ id: 0, name: 'Anchor', x: 0, z: 0 }], downtown: { x: 0, z: 0 } };
  return { query: createCityQuery(buildCityIndex(city), createCityState(city)), city };
}

function context(k: SnapKaiju, where: ReturnType<typeof cityOf>): ControlContext {
  return {
    session: { mirror: where, aimYaw: 0, aimPitch: 0 },
    renderer: { kaijuCamAnchor: () => null },
    input: createActionState(),
    frame: { localKaiju: k, localUnit: null, kaijus: [k], units: [], squads: [], match: { stage: k.stage, phase: 'playing' }, bounds: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 } },
    dt: 1 / 60,
    now: 0,
    mapOpen: false,
  } as unknown as ControlContext;
}

describe('what the monster cannot reach', () => {
  it('says the beam is blocked when a building stops it short of the crosshair, and not when the crosshair is on that building', () => {
    // Stage 2: a 30 m block 60 m ahead stops the beam from the mouth (22 m up); the chase camera,
    // higher, looks on over it.
    const where = cityOf([[0, 60, 30, 5, 30]]);
    const k = kaiju({ stage: 2, action: 'special', phase: A.special.activePhase, aimYaw: 0, aimPitch: -0.05 });
    const c = new KaijuController(true);
    const camera = new THREE.PerspectiveCamera();
    c.update(context(k, where));
    c.applyCamera(context(k, where), camera);
    c.update(context(k, where));
    expect(c.aim.warning?.word).toBe('Blocked');
    expect(c.aim.warning?.z).toBeCloseTo(55, 0);
    // Taller, the crosshair is on the block itself: what it looks at is what it burns.
    const tall = cityOf([[0, 60, 30, 5, 200]]);
    c.update(context(k, tall));
    expect(c.aim.warning).toBeNull();
  });

  it('shows a charge’s lane, and the first building in it too tall to smash', () => {
    // Stage 1 smashes up to 9 m: a 6 m house is smashed, the 20 m block behind it stops the run.
    const where = cityOf([
      [0, 15, 4, 3, 6],
      [0, 32, 8, 4, 20],
    ]);
    const k = kaiju({ action: 'charge', phase: 'windup', phaseTime: 0.2, phaseDuration: A.charge.timing.windup });
    const c = new KaijuController(true);
    c.update(context(k, where));
    expect(c.aim.lane).toMatchObject({ blocker: 1 });
    const lane = c.aim.lane;
    expect(lane?.length ?? 0).toBeGreaterThan(20);
    expect(lane?.length ?? 99).toBeLessThan(28);
    expect(c.aim.warning?.word).toBe('Too tall');
    // A clear run: the whole lane, nothing stops it.
    c.update(context(k, cityOf([[0, 15, 4, 3, 6]])));
    expect(c.aim.lane?.blocker).toBe(-1);
    expect(c.aim.warning).toBeNull();
    // Not charging: no lane.
    c.update(context(kaiju(), where));
    expect(c.aim.lane).toBeNull();
  });
});

describe('who hit the monster', () => {
  const spawn = (id: number, ownerId: number, owner: 'unit' | 'kaiju' = 'unit'): SimEvent =>
    ({ type: 'projectileSpawn', tick: 0, id, projectile: 'tracer', flight: 'flat', owner, ownerId, player: 1, x: ownerId * 10, y: 1, z: 50, vx: 0, vy: 0, vz: -100, gravity: 0, ttl: 2, volley: false }) as SimEvent;
  const hit = (id: number, target: 'kaiju' | 'ground', targetId = 0): SimEvent =>
    ({ type: 'projectileHit', tick: 1, id, projectile: 'tracer', x: 0, y: 1, z: 0, target, targetId, splash: 0 }) as SimEvent;

  it('marks the squad whose shot hit the monster, once per shooter, for two seconds', () => {
    const log = new HitLog();
    for (const e of [spawn(1, 3), spawn(2, 3), spawn(3, 5), spawn(4, 6), spawn(5, 0, 'kaiju')]) log.onEvent(e, 0, 0);
    log.onEvent(hit(1, 'kaiju'), 0.1, 0);
    log.onEvent(hit(2, 'kaiju'), 0.5, 0);
    // A miss, a hit on another monster, the monster's own throw: no mark.
    log.onEvent(hit(3, 'ground', -1), 0.5, 0);
    log.onEvent(hit(4, 'kaiju', 1), 0.5, 0);
    log.onEvent(hit(5, 'kaiju'), 0.5, 0);
    expect(log.live(1).map((m) => [m.unit, m.at])).toEqual([[3, 0.5]]);
    expect(log.live(1)[0]).toMatchObject({ x: 30, z: 50 });
    expect(log.live(2.6)).toEqual([]);
  });
});
