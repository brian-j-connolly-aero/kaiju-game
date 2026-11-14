import { describe, expect, it } from 'vitest';
import {
  boundsFromCenter,
  circleVsObb,
  createMoveResult,
  createRng,
  DEG,
  DT,
  kaijuMoveParams,
  LIZARD,
  PI,
  rngRange,
  setWorldMove,
  stepMovement,
  UNIT_TYPES,
  unitMoveParams,
  type KaijuMoveState,
  type MoveBody,
  type MoveInput,
  type MoveParams,
} from '../src/index';
import { makeTestCity, queryFor } from './helpers';

const BIG = boundsFromCenter(0, 0, 1000);

function hatchling(overrides: Partial<KaijuMoveState> = {}): KaijuMoveState {
  return { kind: 'lizard', stage: 1, phase: 'idle', action: 'none', nerve: 0, ...overrides };
}

function body(x = 0, z = 0, radius = 2.4, yaw = 0): MoveBody {
  return { x, z, yaw, vx: 0, vz: 0, radius };
}

function drive(b: MoveBody, inp: MoveInput, params: MoveParams, city = queryFor(makeTestCity()), seconds = 1): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) stepMovement(b, inp, DT, city, params);
}

describe('stepMovement in the open', () => {
  it('moves relative to the view: forward along the aim, right of it for +moveX', () => {
    const params = kaijuMoveParams(hatchling(), BIG);
    const fwd = body();
    drive(fwd, { moveX: 0, moveZ: 1, aimYaw: 0 }, params);
    expect(fwd.z).toBeGreaterThan(5);
    expect(Math.abs(fwd.x)).toBeLessThan(1e-9);

    const east = body(0, 0, 2.4, PI / 2);
    drive(east, { moveX: 0, moveZ: 1, aimYaw: PI / 2 }, params);
    expect(east.x).toBeGreaterThan(5);
    expect(Math.abs(east.z)).toBeLessThan(1e-6);

    // Facing +Z, "right" is -X.
    const right = body();
    drive(right, { moveX: 1, moveZ: 0, aimYaw: 0 }, params);
    expect(right.x).toBeLessThan(-3);
    expect(Math.abs(right.z)).toBeLessThan(1e-6);
  });

  it('accelerates up to the stage top speed and stops when the stick is released', () => {
    const params = kaijuMoveParams(hatchling(), BIG);
    const b = body();
    stepMovement(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, queryFor(makeTestCity()), params);
    expect(b.vz).toBeCloseTo(LIZARD.stages[0].accel * DT, 9);
    drive(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, params, undefined, 2);
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(8.5, 9);
    drive(b, { moveX: 0, moveZ: 0, aimYaw: 0 }, params, undefined, 1);
    expect(Math.hypot(b.vx, b.vz)).toBe(0);
    // A half-pushed stick gives half speed.
    drive(b, { moveX: 0, moveZ: 0.5, aimYaw: 0 }, params, undefined, 2);
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(4.25, 9);
  });

  it('uses each stage of the lizard as specified', () => {
    const speeds = [8.5, 14, 22];
    const turns = [200, 120, 75];
    for (const stage of [1, 2, 3] as const) {
      const params = kaijuMoveParams(hatchling({ stage }), BIG);
      expect(params.topSpeed).toBeCloseTo(speeds[stage - 1], 9);
      expect(params.turnRate).toBeCloseTo(turns[stage - 1] * DEG, 9);
      expect(params.steer).toBe('aim');
    }
    expect(kaijuMoveParams(hatchling({ stage: 1 }), BIG).trampleHeight).toBe(3.5);
    expect(kaijuMoveParams(hatchling({ stage: 2 }), BIG).trampleHeight).toBe(12);
    expect(kaijuMoveParams(hatchling({ stage: 3 }), BIG).trampleHeight).toBe(70);
    expect(kaijuMoveParams(hatchling({ stage: 2 }), BIG).wades).toBe(false);
    expect(kaijuMoveParams(hatchling({ stage: 3 }), BIG).wades).toBe(true);
    expect(kaijuMoveParams(hatchling({ stage: 3 }), BIG).wadeSpeedMult).toBe(0.45);
  });

  it('turns the kaiju body toward the aim at the turn rate', () => {
    const params = kaijuMoveParams(hatchling(), BIG);
    const b = body();
    const city = queryFor(makeTestCity());
    stepMovement(b, { moveX: 0, moveZ: 0, aimYaw: PI / 2 }, DT, city, params);
    expect(b.yaw).toBeCloseTo(200 * DEG * DT, 9);
    // 90 degrees at 200 degrees per second takes 0.45 s.
    drive(b, { moveX: 0, moveZ: 0, aimYaw: PI / 2 }, params, city, 0.5);
    expect(b.yaw).toBeCloseTo(PI / 2, 9);
  });

  it('is slower sideways and backward for the lizard', () => {
    const params = kaijuMoveParams(hatchling(), BIG);
    const city = queryFor(makeTestCity());
    // Body faces +Z and stays there (aim +Z); move along -Z: backward.
    const back = body();
    drive(back, { moveX: 0, moveZ: -1, aimYaw: 0 }, params, city, 2);
    expect(Math.hypot(back.vx, back.vz)).toBeCloseTo(8.5 * LIZARD.reverseSpeedMult, 9);
    const side = body();
    drive(side, { moveX: 1, moveZ: 0, aimYaw: 0 }, params, city, 2);
    expect(Math.hypot(side.vx, side.vz)).toBeCloseTo(8.5 * LIZARD.strafeSpeedMult, 9);
  });

  it('slows with accumulated nerve damage and roots during rooted actions', () => {
    const full = kaijuMoveParams(hatchling({ nerve: 100 }), BIG);
    expect(full.topSpeed).toBeCloseTo(8.5 * 0.7, 9);
    const half = kaijuMoveParams(hatchling({ nerve: 50 }), BIG);
    expect(half.topSpeed).toBeCloseTo(8.5 * 0.85, 9);
    const brace = kaijuMoveParams(hatchling({ phase: 'brace', action: 'brace' }), BIG);
    expect(brace.topSpeed).toBe(0);
    expect(brace.turnRate).toBeCloseTo(200 * DEG * 0.3, 9);
    const beam = kaijuMoveParams(hatchling({ phase: 'special', action: 'special' }), BIG);
    expect(beam.topSpeed).toBe(0);
    expect(beam.turnRate).toBeCloseTo(200 * DEG * 0.25, 9);
    for (const phase of ['stagger', 'cocoon', 'dead'] as const) {
      const p = kaijuMoveParams(hatchling({ phase }), BIG);
      expect(p.topSpeed).toBe(0);
      expect(p.turnRate).toBe(0);
    }
    const swipe = kaijuMoveParams(hatchling({ phase: 'windup', action: 'swipe' }), BIG);
    expect(swipe.topSpeed).toBeCloseTo(8.5 * LIZARD.actions.swipe.moveMult, 9);
    const mods = { mult: { speed: 1.2, turnRate: 0.5 }, flags: [] };
    const modded = kaijuMoveParams(hatchling(), BIG, mods);
    expect(modded.topSpeed).toBeCloseTo(8.5 * 1.2, 9);
    expect(modded.turnRate).toBeCloseTo(100 * DEG, 9);
  });

  it('steers vehicles by their hull (squad-mates) and infantry freely', () => {
    const city = queryFor(makeTestCity());
    const tankDef = UNIT_TYPES.army_tank;
    const tank = body(0, 0, tankDef.radius, 0);
    const tankParams = unitMoveParams(tankDef, { alive: true, rooted: false }, BIG);
    // Ask the tank to go east while its hull faces north: it must turn before it makes headway.
    stepMovement(tank, { moveX: 0, moveZ: 1, aimYaw: PI / 2 }, DT, city, tankParams);
    expect(tank.yaw).toBeCloseTo(110 * DEG * DT, 9);
    // It creeps along its hull (still pointing almost north) at a small fraction of top speed.
    expect(Math.hypot(tank.vx, tank.vz)).toBeLessThan(tankDef.speed * 0.1);
    expect(tank.vz).toBeGreaterThan(Math.abs(tank.vx));
    drive(tank, { moveX: 0, moveZ: 1, aimYaw: PI / 2 }, tankParams, city, 3);
    expect(tank.yaw).toBeCloseTo(PI / 2, 6);
    expect(tank.vx).toBeCloseTo(tankDef.speed, 6);
    // The hull heading, not the turret aim, decides where a tank drives.
    expect(Math.abs(tank.vz)).toBeLessThan(1e-6);

    const infDef = UNIT_TYPES.army_rocket_infantry;
    const inf = body(0, 0, infDef.radius, 0);
    const infParams = unitMoveParams(infDef, { alive: true, rooted: false }, BIG);
    drive(inf, { moveX: 0, moveZ: 1, aimYaw: PI / 2 }, infParams, city, 1);
    expect(inf.vx).toBeCloseTo(infDef.speed, 9);
    expect(inf.x).toBeGreaterThan(5);
  });

  it('does not move rooted or dead units', () => {
    const def = UNIT_TYPES.army_tank;
    expect(unitMoveParams(def, { alive: true, rooted: true }, BIG).topSpeed).toBe(0);
    expect(unitMoveParams(def, { alive: false, rooted: false }, BIG).topSpeed).toBe(0);
    expect(unitMoveParams(def, { alive: true, rooted: false }, BIG).topSpeed).toBe(def.speed);
    expect(unitMoveParams(def, { alive: true, rooted: false }, BIG).trampleHeight).toBe(0);
  });

  it('drives the player\'s own tank by throttle and hull turn, with its turret on its own (prediction runs the same)', () => {
    const def = UNIT_TYPES.army_tank_troop;
    const drive = def.drive!;
    const params = unitMoveParams(def, { alive: true, rooted: false, driven: true }, BIG);
    expect(params).toMatchObject({ steer: 'tank', topSpeed: def.speed, accel: drive.accel, brake: drive.brake, reverseMult: drive.reverseMult });
    expect(params.turnRate).toBeCloseTo(drive.turnRate, 12);
    expect(params.turretRate).toBeCloseTo(drive.turretRate, 12);
    // A squad-mate of the same troop steers itself.
    expect(unitMoveParams(def, { alive: true, rooted: false }, BIG).steer).toBe('heading');
    const city = queryFor(makeTestCity());
    const tank: MoveBody = { ...body(0, 0, def.radius, 0), aimYaw: 0 };
    // Throttle with the view to the east: it drives north along its hull, the turret swinging east.
    for (let i = 0; i < 15; i++) stepMovement(tank, { moveX: 0, moveZ: 1, aimYaw: PI / 2 }, DT, city, params);
    expect(tank.yaw).toBe(0);
    expect(tank.vz).toBeCloseTo((15 * drive.accel) / 30, 9);
    expect(tank.aimYaw).toBeCloseTo(drive.turretRate / 2, 9);
    // Turning on the spot: no throttle, full turn.
    const still: MoveBody = { ...body(0, 0, def.radius, 0), aimYaw: 0 };
    for (let i = 0; i < 30; i++) stepMovement(still, { moveX: -1, moveZ: 0, aimYaw: 0 }, DT, city, params);
    expect(still.yaw).toBeCloseTo(drive.turnRate, 9);
    expect([still.x, still.z]).toEqual([0, 0]);
  });

  it('converts a world direction into view-relative input and back', () => {
    const control = { moveX: 0, moveZ: 0, aimYaw: 1.1 };
    setWorldMove(control, 3, -4, 0.5);
    expect(Math.hypot(control.moveX, control.moveZ)).toBeCloseTo(0.5, 9);
    const b = body(0, 0, 3);
    const params = unitMoveParams(UNIT_TYPES.army_rocket_infantry, { alive: true, rooted: false }, BIG);
    drive(b, control, params, undefined, 1);
    expect(b.x / Math.hypot(b.x, b.z)).toBeCloseTo(0.6, 6);
    expect(b.z / Math.hypot(b.x, b.z)).toBeCloseTo(-0.8, 6);
    setWorldMove(control, 0, 0);
    expect(control.moveX).toBe(0);
    expect(control.moveZ).toBe(0);
  });
});

describe('stepMovement against the city', () => {
  it('is blocked by a structure taller than the trample height and slides along it', () => {
    // A long wall across the path, 20 m north of the start.
    const built = makeTestCity({ structures: [{ x: 0, z: 22, w: 200, d: 4, height: 6 }] });
    const city = queryFor(built);
    const params = kaijuMoveParams(hatchling(), BIG);
    const b = body();
    const result = createMoveResult();
    for (let i = 0; i < 150; i++) stepMovement(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, city, params, result);
    expect(b.z).toBeCloseTo(20 - 2.4, 6);
    expect(result.blocked).toBe(true);
    expect(b.vz).toBeCloseTo(0, 6);
    // Push diagonally: no progress into the wall, full slide along it.
    const before = b.x;
    for (let i = 0; i < 60; i++) {
      stepMovement(b, { moveX: -Math.SQRT1_2, moveZ: Math.SQRT1_2, aimYaw: 0 }, DT, city, params, result);
    }
    expect(b.z).toBeCloseTo(20 - 2.4, 6);
    expect(b.x - before).toBeGreaterThan(5);
    expect(circleVsObb(b.x, b.z, b.radius - 1e-6, built.city.structures[0])).toBe(false);
  });

  it('walks through structures up to the trample height and reports them', () => {
    const built = makeTestCity({
      structures: [
        { x: 0, z: 15, w: 6, d: 6, height: 3.5 },
        { x: 0, z: 40, w: 6, d: 6, height: 3.6 },
      ],
    });
    const city = queryFor(built);
    const params = kaijuMoveParams(hatchling(), BIG);
    const b = body();
    const result = createMoveResult();
    const trampled = new Set<number>();
    for (let i = 0; i < 300; i++) {
      stepMovement(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, city, params, result);
      for (const id of result.trampled) trampled.add(id);
      expect(result.waded).toEqual([]);
    }
    // Through the 3.5 m kiosk, stopped by the 3.6 m one.
    expect([...trampled]).toEqual([0]);
    expect(b.z).toBeCloseTo(37 - 2.4, 6);
  });

  it('lets the titan wade through anything, slowed, and reports the contact', () => {
    const built = makeTestCity({ structures: [{ x: 0, z: 100, w: 40, d: 40, height: 150 }] });
    const city = queryFor(built);
    const params = kaijuMoveParams(hatchling({ stage: 3 }), BIG);
    const b = body(0, 0, 26);
    const result = createMoveResult();
    let sawWade = false;
    let slowest = Infinity;
    for (let i = 0; i < 30 * 14; i++) {
      stepMovement(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, city, params, result);
      if (result.waded.length > 0) {
        sawWade = true;
        expect(result.waded).toEqual([0]);
      }
      if (result.wading && b.z > 70 && b.z < 130) slowest = Math.min(slowest, Math.hypot(b.vx, b.vz));
      expect(result.trampled).toEqual([]);
    }
    expect(sawWade).toBe(true);
    expect(slowest).toBeCloseTo(22 * 0.45, 6);
    // It came out the far side at full speed again.
    expect(b.z).toBeGreaterThan(150);
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(22, 6);
  });

  it('ignores rubble', () => {
    const built = makeTestCity({ structures: [{ x: 0, z: 22, w: 200, d: 4, height: 6 }] });
    const city = queryFor(built);
    city.structureHp[0] = 0;
    const params = kaijuMoveParams(hatchling(), BIG);
    const b = body();
    drive(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, params, city, 5);
    expect(b.z).toBeGreaterThan(35);
  });

  it('slows ground bodies in water but not on a standing bridge', () => {
    const built = makeTestCity({
      water: [[-500, 20, 500, 80]],
      structures: [{ x: 100, z: 50, w: 16, d: 64, height: 8, passable: true }],
    });
    const city = queryFor(built);
    const def = UNIT_TYPES.army_rocket_infantry;
    const params = unitMoveParams(def, { alive: true, rooted: false }, BIG);
    const north: MoveInput = { moveX: 0, moveZ: 1, aimYaw: 0 };
    const result = createMoveResult();

    const wader = body(0, 0, def.radius);
    let inWaterSpeed = 0;
    // 20 m of land at full speed, then 60 m of river at half speed: well under 26 s to the far bank.
    for (let i = 0; i < 30 * 26; i++) {
      stepMovement(wader, north, DT, city, params, result);
      if (wader.z > 40 && wader.z < 60) {
        expect(result.inWater).toBe(true);
        inWaterSpeed = Math.hypot(wader.vx, wader.vz);
      }
    }
    expect(inWaterSpeed).toBeCloseTo(def.speed * 0.5, 6);
    expect(result.inWater).toBe(false);

    const walker = body(100, 0, def.radius);
    for (let i = 0; i < 30 * 12; i++) {
      stepMovement(walker, north, DT, city, params, result);
      if (walker.z > 25 && walker.z < 75) {
        expect(result.inWater).toBe(false);
        expect(Math.hypot(walker.vx, walker.vz)).toBeCloseTo(def.speed, 6);
      }
    }
    // Infantry is never blocked by the deck and never tramples it.
    expect(walker.z).toBeGreaterThan(70);

    // With the bridge down, the same path is a wade.
    city.structureHp[0] = 0;
    const late = body(100, 30, def.radius);
    stepMovement(late, north, DT, city, params, result);
    stepMovement(late, north, DT, city, params, result);
    expect(result.inWater).toBe(true);
  });

  it('lets a hatchling cross a bridge without wrecking it, while a juvenile tramples it', () => {
    const built = makeTestCity({
      water: [[-500, 20, 500, 80]],
      structures: [{ x: 0, z: 50, w: 16, d: 64, height: 8, passable: true }],
    });
    const city = queryFor(built);
    const result = createMoveResult();
    const small = body(0, 0, 2.4);
    const p1 = kaijuMoveParams(hatchling({ stage: 1 }), BIG);
    for (let i = 0; i < 30 * 12; i++) {
      stepMovement(small, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, city, p1, result);
      expect(result.trampled).toEqual([]);
      if (small.z > 25 && small.z < 75) expect(Math.hypot(small.vx, small.vz)).toBeCloseTo(8.5, 6);
    }
    expect(small.z).toBeGreaterThan(80);

    const big = body(0, 0, 9);
    const p2 = kaijuMoveParams(hatchling({ stage: 2 }), BIG);
    let trampledDeck = false;
    for (let i = 0; i < 30 * 8; i++) {
      stepMovement(big, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, city, p2, result);
      if (result.trampled.includes(0)) trampledDeck = true;
    }
    expect(trampledDeck).toBe(true);
  });

  it('keeps bodies inside the bounds', () => {
    const city = queryFor(makeTestCity());
    const bounds = boundsFromCenter(0, 0, 30);
    const params = kaijuMoveParams(hatchling(), bounds);
    const b = body();
    const result = createMoveResult();
    for (let i = 0; i < 300; i++) stepMovement(b, { moveX: 0, moveZ: 1, aimYaw: 0 }, DT, city, params, result);
    expect(b.z).toBe(30 - 2.4);
    expect(b.vz).toBe(0);
    expect(result.blocked).toBe(true);
    // Sliding along the line still works.
    for (let i = 0; i < 60; i++) {
      stepMovement(b, { moveX: -Math.SQRT1_2, moveZ: Math.SQRT1_2, aimYaw: 0 }, DT, city, params, result);
    }
    expect(b.z).toBe(30 - 2.4);
    expect(b.x).toBeGreaterThan(5);
    for (let i = 0; i < 600; i++) {
      stepMovement(b, { moveX: -Math.SQRT1_2, moveZ: Math.SQRT1_2, aimYaw: 0 }, DT, city, params, result);
    }
    expect(b.x).toBe(30 - 2.4);
  });

  it('never leaves a body inside a blocking structure or outside the bounds (random walk)', () => {
    const rng = createRng(99);
    const structures = [];
    for (let i = 0; i < 60; i++) {
      structures.push({
        x: rngRange(rng, -120, 120),
        z: rngRange(rng, -120, 120),
        w: rngRange(rng, 6, 24),
        d: rngRange(rng, 6, 24),
        height: rngRange(rng, 5, 40),
        yaw: rngRange(rng, -PI, PI),
      });
    }
    const built = makeTestCity({ structures });
    const city = queryFor(built);
    const bounds = boundsFromCenter(0, 0, 150);
    const params = unitMoveParams(UNIT_TYPES.army_tank, { alive: true, rooted: false }, bounds);
    const result = createMoveResult();
    // Start in a gap.
    const b = body(140, 140, 4);
    let aim = 0;
    let moved = 0;
    for (let i = 0; i < 6000; i++) {
      if (i % 45 === 0) aim = rngRange(rng, -PI, PI);
      const px = b.x;
      const pz = b.z;
      stepMovement(b, { moveX: 0, moveZ: 1, aimYaw: aim }, DT, city, params, result);
      moved += Math.hypot(b.x - px, b.z - pz);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(150 - 4 + 1e-9);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(150 - 4 + 1e-9);
      for (const s of built.city.structures) {
        // Allow a hair of residual overlap where two walls and the bounds meet.
        expect(circleVsObb(b.x, b.z, b.radius - 0.25, s)).toBe(false);
      }
    }
    expect(moved).toBeGreaterThan(500);
  });

  it('is deterministic', () => {
    const structures = [
      { x: 10, z: 30, w: 12, d: 9, height: 8, yaw: 0.4 },
      { x: -14, z: 55, w: 10, d: 10, height: 3 },
    ];
    const runOnce = (): MoveBody => {
      const city = queryFor(makeTestCity({ structures }));
      const params = kaijuMoveParams(hatchling(), BIG);
      const b = body();
      const rng = createRng(5);
      for (let i = 0; i < 900; i++) {
        const inp = { moveX: rngRange(rng, -1, 1), moveZ: rngRange(rng, 0, 1), aimYaw: rngRange(rng, -0.6, 0.6) };
        stepMovement(b, inp, DT, city, params);
      }
      return b;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
