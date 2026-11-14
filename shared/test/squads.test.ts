import { describe, expect, it } from 'vitest';
import {
  angleDist,
  beginStage,
  boundsContains,
  Btn,
  COMBAT_RULES,
  createSteer,
  DEG,
  decodeSnapshot,
  encodeSnapshot,
  formationSpacing,
  lasersOnKaiju,
  LIZARD,
  setTankMove,
  setWorldMove,
  snapshotOfWorld,
  SQUAD_RULES,
  squadCharge,
  steerToward,
  structureContact,
  structuresInCircle,
  TICK_RATE,
  UNIT_TYPES,
  volleyMeter,
  WEAPONS,
  wrapAngle,
  yawFromTo,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type Unit,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const INFANTRY = UNIT_TYPES.army_rocket_infantry;
const ROCKETS = WEAPONS.army_rocket_launchers;
const CHARGE_TICKS = Math.round(COMBAT_RULES.chargeTime * TICK_RATE);

/**
 * A wide open field: the first squad is a person's (player 1, units 0 to 3, unit 0 driven), the
 * other squads and the kaiju are parked a long way off, out of everybody's range and sight.
 */
function field(options: TestWorldOptions = {}, stage: StageId = 1): World {
  const world = makeTestWorld(options);
  if (stage > 1) beginStage(world, stage);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -700, -700, 0);
  return world;
}

/** Lines the first squad up along x at a z, leader first, `gap` apart, all facing +Z. */
function lineUp(world: World, x: number, z: number, gap = 12): Unit[] {
  return [0, 1, 2, 3].map((id) => {
    const u = placeUnit(world, id, x + id * gap, z);
    u.yaw = 0;
    u.aimYaw = 0;
    u.control.aimYaw = 0;
    return u;
  });
}

/** Steps with the squad leader's input. */
function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [null, input(partial)]);
}

/**
 * Drives the leader to a point the way a player would: infantry looks at it and pushes the
 * stick forward; a tank turns its hull to it and opens the throttle, easing off at the end.
 */
function driveTo(world: World, x: number, z: number, maxTicks = 1500, buttons = 0): SimEvent[] {
  const leader = world.units[world.squads[0].driven];
  const tank = UNIT_TYPES[leader.type].drive !== undefined;
  const near = tank ? 4 : 0.6;
  const events: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const d = Math.hypot(x - leader.x, z - leader.z);
    if (d < near) break;
    const inp = input({ aimYaw: yawFromTo(leader.x, leader.z, x, z), buttons });
    if (tank) setTankMove(inp, leader.yaw, x - leader.x, z - leader.z, Math.min(1, d / 25));
    else inp.moveZ = d > 3 ? 1 : 0.4;
    events.push(...run(world, 1, [null, inp]));
  }
  expect(Math.hypot(x - leader.x, z - leader.z)).toBeLessThan(near + 1);
  return events;
}

function subs(world: World, squad = 0): Unit[] {
  const s = world.squads[squad];
  return s.units.filter((id) => id !== s.driven && world.units[id].alive).map((id) => world.units[id]);
}

/** No unit of the squad is sunk into a wall. */
function expectClearOfWalls(world: World): void {
  const ids: number[] = [];
  for (const u of world.units) {
    if (!u.alive) continue;
    structuresInCircle(world.cityQuery, u.x, u.z, u.radius - 0.3, ids);
    for (const id of ids) {
      if (world.cityIndex.spassable[id] === 1) continue;
      expect(structureContact(world.cityIndex, id, u.x, u.z, u.radius - 0.3)).toBe(false);
    }
  }
}

describe('squads', () => {
  it('fields four units of the level, one driven and three squad-mates', () => {
    const world = makeTestWorld();
    for (const squad of world.squads) {
      expect(squad.units.length).toBe(4);
      expect(squad.driven).toBe(squad.units[0]);
      for (const id of squad.units) {
        const u = world.units[id];
        expect(u).toMatchObject({ alive: true, type: 'army_rocket_infantry', hp: 100, members: 10, radius: 3, rooted: false });
      }
    }
    beginStage(world, 2);
    expect(world.units.every((u) => u.type === 'army_tank' && u.members === 1 && u.hp === 100)).toBe(true);
    beginStage(world, 3);
    expect(world.units.every((u) => u.type === 'army_tank_troop' && u.members === 3 && u.hp === 300)).toBe(true);
  });
});

describe('the driven unit at stage 1: rocket infantry', () => {
  it('is nimble: it goes where the stick points at once, relative to the view, whatever it faces', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    // Looking along +Z, stick to the right: it sidesteps (to -X) and its weapon keeps pointing along +Z.
    lead(world, 15, { aimYaw: 0, moveX: 1 });
    expect(leader.vx).toBeLessThan(-INFANTRY.speed + 0.01);
    expect(Math.abs(leader.vz)).toBeLessThan(1e-6);
    expect(leader.aimYaw).toBe(0);
    expect(leader.state).toBe('moving');
    // Stick back: it reverses within a fraction of a second.
    lead(world, 12, { aimYaw: 0, moveZ: -1 });
    expect(leader.vz).toBeLessThan(-INFANTRY.speed + 0.01);
    expect(Math.abs(leader.vx)).toBeLessThan(1e-6);
    lead(world, 10);
    expect(leader.state).toBe('idle');
  });
});

describe('the driven tank at stages 2 and 3', () => {
  const TANKS = [
    [2, UNIT_TYPES.army_tank],
    [3, UNIT_TYPES.army_tank_troop],
  ] as const;

  function tankField(stage: StageId): { world: World; leader: Unit } {
    const world = field({}, stage);
    const [leader] = lineUp(world, 0, 0, 40);
    return { world, leader };
  }

  it('drives along its hull on the throttle (W), whatever the view, speeding up and braking at its own rates', () => {
    for (const [stage, def] of TANKS) {
      const drive = def.drive!;
      const { world, leader } = tankField(stage);
      leader.yaw = 30 * DEG;
      // Full throttle with the view well off to the side: the hull does not turn, and the tank
      // goes along it, gaining `accel` meters per second every second.
      lead(world, 30, { moveZ: 1, aimYaw: 120 * DEG });
      expect(leader.yaw).toBeCloseTo(30 * DEG, 9);
      expect(Math.hypot(leader.vx, leader.vz)).toBeCloseTo(drive.accel, 6);
      expect(Math.atan2(leader.vx, leader.vz)).toBeCloseTo(30 * DEG, 6);
      // ...up to its top speed.
      lead(world, 3 * TICK_RATE, { moveZ: 1, aimYaw: 120 * DEG });
      expect(Math.hypot(leader.vx, leader.vz)).toBeCloseTo(def.speed, 6);
      // Off the throttle: it brakes to a stop at `brake`, straight on along the hull.
      const stopTicks = Math.ceil((def.speed / drive.brake) * TICK_RATE);
      lead(world, stopTicks - 2, { aimYaw: 120 * DEG });
      expect(Math.hypot(leader.vx, leader.vz)).toBeGreaterThan(0);
      expect(Math.atan2(leader.vx, leader.vz)).toBeCloseTo(30 * DEG, 6);
      lead(world, 3, { aimYaw: 120 * DEG });
      expect(Math.hypot(leader.vx, leader.vz)).toBe(0);
      expect(leader.yaw).toBeCloseTo(30 * DEG, 9);
    }
  });

  it('reverses (S) at half its top speed, and stops before it reverses', () => {
    for (const [stage, def] of TANKS) {
      const drive = def.drive!;
      const { world, leader } = tankField(stage);
      lead(world, 4 * TICK_RATE, { moveZ: -1 });
      // Backward along the hull (it faces +Z), at the reverse top speed.
      expect(leader.vz).toBeCloseTo(-def.speed * drive.reverseMult, 6);
      expect(leader.vx).toBeCloseTo(0, 9);
      expect(leader.yaw).toBe(0);
      // From full reverse to full ahead: braking first, then speeding up the other way.
      lead(world, 15, { moveZ: 1 });
      expect(leader.vz).toBeCloseTo(-def.speed * drive.reverseMult + (15 * drive.brake) / TICK_RATE, 6);
    }
  });

  it('turns its hull with A and D, on the spot when it stands still; W and D together are full throttle and full turn', () => {
    for (const [stage, def] of TANKS) {
      const drive = def.drive!;
      const { world, leader } = tankField(stage);
      // D: a right turn, which lowers the yaw (facing +Z, right is toward -X). It does not move.
      lead(world, TICK_RATE / 2, { moveX: 1 });
      expect(leader.yaw).toBeCloseTo(-drive.turnRate / 2, 9);
      expect([leader.x, leader.z]).toEqual([0, 0]);
      expect(Math.hypot(leader.vx, leader.vz)).toBe(0);
      // A: back the other way.
      lead(world, TICK_RATE / 2, { moveX: -1 });
      expect(leader.yaw).toBeCloseTo(0, 9);
      // W and D on a keyboard arrive as a diagonal of length 1, and are read as a square.
      lead(world, TICK_RATE, { moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2 });
      expect(leader.yaw).toBeCloseTo(wrapAngle(-drive.turnRate), 9);
      // A full second of throttle, all of it along a hull that turned as it went.
      const speed = Math.hypot(leader.vx, leader.vz);
      expect(speed).toBeGreaterThan(drive.accel * 0.97);
      expect(speed).toBeLessThanOrEqual(drive.accel + 1e-9);
      expect(angleDist(Math.atan2(leader.vx, leader.vz), leader.yaw)).toBeLessThan(1e-9);
      expect(stage === 2 ? drive.turnRate > UNIT_TYPES.army_tank_troop.drive!.turnRate : true).toBe(true);
    }
  });

  it('swings its turret toward the view at the turret rate, not tied to the hull; the gun\'s elevation follows at once', () => {
    for (const [stage, def] of TANKS) {
      const drive = def.drive!;
      const { world, leader } = tankField(stage);
      const behind = 180 * DEG - 1e-6;
      lead(world, 1, { aimYaw: behind, aimPitch: 0.2 });
      expect(leader.aimYaw).toBeCloseTo(drive.turretRate / TICK_RATE, 9);
      expect(leader.aimPitch).toBe(0.2);
      lead(world, TICK_RATE / 2 - 1, { aimYaw: behind, aimPitch: 0.2 });
      expect(leader.aimYaw).toBeCloseTo(drive.turretRate / 2, 9);
      // The hull has not moved.
      expect(leader.yaw).toBe(0);
      lead(world, 2 * TICK_RATE, { aimYaw: behind, aimPitch: 0.2 });
      expect(angleDist(leader.aimYaw, behind)).toBeLessThan(1e-9);
      // The hull turns a quarter turn under it: the turret stays where the player looks.
      lead(world, Math.ceil((90 * DEG * TICK_RATE) / drive.turnRate), { aimYaw: behind, moveX: 1 });
      expect(angleDist(leader.yaw, -90 * DEG)).toBeLessThan(drive.turnRate / TICK_RATE + 1e-9);
      expect(angleDist(leader.aimYaw, behind)).toBeLessThan(1e-9);
      // What a client draws: the hull and the turret, each where the server has them.
      const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
      expect(snap.units[leader.id].yaw).toBeCloseTo(leader.yaw, 6);
      expect(angleDist(snap.units[leader.id].aimYaw, leader.aimYaw)).toBeLessThan(1e-3);
      expect(snap.units[leader.id].driven).toBe(true);
    }
  });
});

describe('the swarm', () => {
  it('stays where it was deployed until the leader moves', () => {
    const world = field();
    const [, a, b, c] = lineUp(world, 0, 0);
    lead(world, 60);
    expect([a.x, b.x, c.x]).toEqual([12, 24, 36]);
    expect(a.state).toBe('idle');
  });

  it('rides one spacing behind the leader out to either side, the third two behind, and settles when the leader stops', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    driveTo(world, 0, 90);
    lead(world, 150);

    const spacing = formationSpacing(a);
    expect(spacing).toBe(2 * INFANTRY.radius + SQUAD_RULES.formationGap);
    // A unit that has settled does not shuffle until its place has moved well away from it.
    const tol = 1.5 * (SQUAD_RULES.slotTolerance * a.radius + 1) + 0.5;
    const side = SQUAD_RULES.swarmSide * spacing;
    // Facing +Z, the left is +X.
    const places = [
      [side, leader.z - spacing],
      [-side, leader.z - spacing],
      [0, leader.z - 2 * spacing],
    ];
    [a, b, c].forEach((u, rank) => {
      expect(Math.hypot(u.x - places[rank][0], u.z - places[rank][1])).toBeLessThan(tol);
      expect(Math.hypot(u.vx, u.vz)).toBe(0);
      expect(u.state).toBe('idle');
    });
    // Nobody stands on anybody.
    const all = [leader, a, b, c];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThan(all[i].radius + all[j].radius);
      }
    }
  });

  it('keeps up with a leader going flat out from a standstill, at every level', () => {
    for (const stage of [1, 2, 3] as const) {
      const world = field({}, stage);
      const spacing = formationSpacing(world.units[0]);
      const [leader, ...mates] = lineUp(world, 0, 0, spacing);
      // Form up behind a leader that moves off slowly and stops.
      lead(world, 4 * TICK_RATE, { moveZ: 0.5 });
      lead(world, 8 * TICK_RATE);
      // Then flat out for eight seconds: nobody falls out of the swarm (the third rides two spacings back).
      let worst = 0;
      for (let t = 0; t < 8 * TICK_RATE; t++) {
        lead(world, 1, { moveZ: 1 });
        for (const u of mates) worst = Math.max(worst, Math.hypot(u.x - leader.x, u.z - leader.z));
      }
      expect(Math.hypot(leader.vx, leader.vz), `stage ${stage}`).toBeCloseTo(UNIT_TYPES[leader.type].speed, 6);
      expect(worst, `stage ${stage}`).toBeLessThan(2.5 * spacing);
      for (const u of mates) expect(Math.hypot(u.vx, u.vz), `stage ${stage}`).toBeGreaterThan(UNIT_TYPES[leader.type].speed * 0.95);
    }
  });

  it('closes up into single file where the street is too narrow to ride side by side', () => {
    // A street 9 m wide between two long blocks: room for one section (6 m) but not for two abreast.
    const world = field({
      structures: [
        { x: -24.5, z: 100, w: 40, d: 120, height: 10 },
        { x: 24.5, z: 100, w: 40, d: 120, height: 10 },
      ],
    });
    const [leader, a, b, c] = lineUp(world, 0, 0);
    for (const u of [a, b, c]) u.x = (u.id - 2) * 10;
    driveTo(world, 0, 150);
    lead(world, 240);
    for (const u of [a, b, c]) {
      expect(Math.abs(u.x)).toBeLessThan(1.6);
      expect(u.z).toBeGreaterThan(60);
      expect(u.z).toBeLessThan(leader.z - 2 * u.radius);
    }
    expect(a.z).toBeGreaterThan(b.z);
    expect(b.z).toBeGreaterThan(c.z);
    expectClearOfWalls(world);
  });

  it('follows the leader round a corner, and one that is left far behind drives the leader\'s way after it', () => {
    const world = field({ structures: [{ x: 40, z: 60, w: 60, d: 60, height: 12 }] });
    const [leader, a, b, c] = lineUp(world, 0, 0);
    for (const u of [a, b, c]) {
      u.x = 0;
      u.z = -10 * u.id;
    }
    // Up the west side of the block, then east along its north side.
    driveTo(world, 0, 100);
    driveTo(world, 90, 100);
    lead(world, 240);
    for (const u of [a, b, c]) {
      expect(Math.hypot(u.x - leader.x, u.z - leader.z)).toBeLessThan(4 * formationSpacing(u));
      expect(u.z).toBeGreaterThan(90 - u.radius);
    }
    expectClearOfWalls(world);

    // One of them is back where they all started, on the far side of the block, while the
    // leader drives on east: it comes round the way the leader went, and catches up.
    placeUnit(world, c.id, 0, -10);
    driveTo(world, 150, 100);
    for (let t = 0; t < 20 * TICK_RATE && Math.hypot(c.x - leader.x, c.z - leader.z) > 4 * formationSpacing(c); t += 10) {
      lead(world, 10);
      expectClearOfWalls(world);
    }
    expect(Math.hypot(c.x - leader.x, c.z - leader.z)).toBeLessThan(4 * formationSpacing(c));
  });

  it('slows a troop of tanks that has fallen behind for the leader\'s corner, so it makes the turn and catches up', () => {
    // A street 30 m wide north from the start, turning east at z = 300 (blocks to the west, to
    // the south-east and to the north of the corner).
    const world = field(
      {
        structures: [
          { x: -215, z: 120, w: 400, d: 520, height: 20 },
          { x: 215, z: 90, w: 400, d: 380, height: 20 },
          { x: 100, z: 515, w: 650, d: 400, height: 20 },
        ],
      },
      3,
    );
    const spacing = formationSpacing(world.units[0]);
    const [leader, a, b, c] = lineUp(world, 0, 0, 0);
    for (const u of [a, b, c]) placeUnit(world, u.id, 0, -spacing * u.id);
    driveTo(world, 0, 300);
    driveTo(world, 120, 300);
    // One squad-mate is back at the start while the leader drives on east.
    placeUnit(world, c.id, 0, 0);
    c.yaw = 0;
    const top = UNIT_TYPES[c.type].speed;
    let cornerSpeed = 0;
    let fastest = 0;
    let t = 0;
    for (; t < 40 * TICK_RATE && Math.hypot(c.x - leader.x, c.z - leader.z) > 4 * spacing; t++) {
      const inp = input({ aimYaw: Math.PI / 2 });
      setTankMove(inp, leader.yaw, 1, 0, leader.x < 380 ? 1 : 0);
      run(world, 1, [null, inp]);
      const v = Math.hypot(c.vx, c.vz);
      fastest = Math.max(fastest, v);
      // Halfway round (its hull between 20 and 70 degrees off north, turning east).
      if (c.yaw > 20 * DEG && c.yaw < 70 * DEG) cornerSpeed = Math.max(cornerSpeed, v);
      if (t % 10 === 0) expectClearOfWalls(world);
    }
    // Flat out on the straight (faster than the leader, to catch up), slowly round the corner.
    expect(fastest).toBeGreaterThan(top * 1.2);
    expect(cornerSpeed).toBeGreaterThan(0);
    expect(cornerSpeed).toBeLessThan(top * 0.65);
    expect(Math.hypot(c.x - leader.x, c.z - leader.z)).toBeLessThan(4 * spacing);
  });

  it('makes tank squad-mates turn their hull toward where they go, and close ranks as units are lost', () => {
    const world = field({}, 2);
    const [leader, a, b, c] = lineUp(world, 0, 0);
    for (const u of world.units) u.yaw = Math.PI / 2;
    leader.yaw = 0;
    driveTo(world, 0, 150);
    lead(world, 240);
    expect(angleDist(a.yaw, 0)).toBeLessThan(25 * DEG);
    const spacing = formationSpacing(a);
    expect(leader.z - c.z).toBeGreaterThan(1.5 * spacing);

    // The flank is lost: the last tank moves up a place.
    b.alive = false;
    driveTo(world, 0, 190);
    lead(world, 240);
    expect(leader.z - c.z).toBeLessThan(spacing + 1.5 * (SQUAD_RULES.slotTolerance * c.radius + 1) + 0.5);
  });

  it('follows its leader through the real city along the streets, at every level, clear of walls and inside the line', () => {
    for (const stage of [1, 2, 3] as const) {
      const world = makeTestWorld({ realCity: true, seed: 5 });
      if (stage > 1) beginStage(world, stage);
      const squad = world.squads[0];
      const b = world.match.bounds;
      const leader = world.units[squad.driven];
      // The leader drives itself (the way a bot would) to a point blocks away; the squad-mates follow on their own.
      const sx = leader.x < (b.minX + b.maxX) / 2 ? 1 : -1;
      let tx = leader.x + sx * Math.min(260, 0.6 * (b.maxX - b.minX));
      const tz = leader.z + (leader.z < (b.minZ + b.maxZ) / 2 ? 1 : -1) * Math.min(230, 0.5 * (b.maxZ - b.minZ));
      // A point on open ground (since phase 2 a special building may stand on the first try).
      const around: number[] = [];
      while (structuresInCircle(world.cityQuery, tx, tz, 8, around) > 0) tx -= sx * 4;
      const steer = createSteer();
      const tank = UNIT_TYPES[leader.type].drive !== undefined;
      const limit = 60 * TICK_RATE;
      for (let t = 0; t < limit; t++) {
        steerToward(world, leader, tx, tz, 4, steer);
        const inp = input({ aimYaw: leader.control.aimYaw });
        if (steer.throttle > 0) {
          inp.aimYaw = Math.atan2(steer.dirX, steer.dirZ);
          if (tank) setTankMove(inp, leader.yaw, steer.dirX, steer.dirZ, steer.throttle);
          else setWorldMove(inp, steer.dirX, steer.dirZ, steer.throttle);
        }
        run(world, 1, [null, inp]);
        if (t % 15 === 0) {
          expectClearOfWalls(world);
          for (const u of world.units) expect(boundsContains(b, u.x, u.z, u.radius - 1e-6)).toBe(true);
        }
        if (steer.arrived && Math.hypot(leader.vx, leader.vz) < 0.1 && t > 20 * TICK_RATE) break;
      }
      expect(Math.hypot(leader.x - tx, leader.z - tz), `stage ${stage}`).toBeLessThan(10);
      lead(world, 20 * TICK_RATE);
      for (const u of subs(world)) expect(Math.hypot(u.x - leader.x, u.z - leader.z), `stage ${stage}`).toBeLessThan(4 * formationSpacing(u));
    }
  });
});

describe('the volley button', () => {
  it('holding it plants the squad-mates where they stand, lasers on, charging from 0 to 1 over the charge time', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    placeKaiju(world, 18, 120, 0);
    const aim = { aimYaw: yawFromTo(0, 0, 18, 120), aimPitch: Math.atan2(LIZARD.stages[0].height / 2 - INFANTRY.eyeHeight, Math.hypot(18, 120)) };
    lead(world, 1, { ...aim, buttons: Btn.volley });
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(true);
      expect(u.state).toBe('charging');
      expect(u.charge).toBeCloseTo(1 / CHARGE_TICKS, 9);
    }
    // The leader is never planted.
    expect(leader.rooted).toBe(false);

    const half = Math.round(CHARGE_TICKS / 2);
    lead(world, half - 1, { ...aim, buttons: Btn.volley });
    expect(a.charge).toBeCloseTo(half / CHARGE_TICKS, 6);
    expect(squadCharge(world, world.squads[0])).toBeCloseTo(half / CHARGE_TICKS, 6);
    // They hold their fire the whole time, though the kaiju is in range and in plain view.
    const events = lead(world, CHARGE_TICKS, { ...aim, buttons: Btn.volley });
    expect(a.charge).toBe(1);
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    expect([a.x, a.z, b.x, c.x]).toEqual([12, 0, 24, 36]);

    // What a client draws: the laser flag, the charge, the aim the laser lies along, and the
    // squad's volley meter worked out from the snapshot's units.
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.units[1]).toMatchObject({ laser: true, rooted: true, state: 'charging', charge: 1 });
    expect(snap.units[0]).toMatchObject({ laser: false, rooted: false, driven: true });
    expect(volleyMeter(snap.units, 0)).toBe(1);
    expect(volleyMeter(snap.units, 1)).toBe(0);
    // Their weapons are on the middle of the kaiju, so the kaiju's lasers count them.
    expect(lasersOnKaiju(world, world.kaijus[0])).toBe(3);
  });

  it('turns their weapons toward where the crosshair lands, and keeps them on it', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    // The crosshair on the ground 50 m out to the north-east.
    let aimYaw = 40 * DEG;
    const aimPitch = -Math.atan2(INFANTRY.eyeHeight, 50);
    lead(world, 20, { aimYaw, aimPitch, buttons: Btn.volley });
    let px = Math.sin(aimYaw) * 50;
    let pz = Math.cos(aimYaw) * 50;
    for (const u of [a, b, c]) {
      expect(angleDist(u.aimYaw, yawFromTo(u.x, u.z, px, pz))).toBeLessThan(1e-6);
      expect(u.aimPitch).toBeCloseTo(Math.atan2(-INFANTRY.muzzleHeight, Math.hypot(px - u.x, pz - u.z)), 6);
    }
    // The player looks the other way: they swing round after the crosshair, at their own pace.
    aimYaw = -60 * DEG;
    px = Math.sin(aimYaw) * 50;
    pz = Math.cos(aimYaw) * 50;
    lead(world, 1, { aimYaw, aimPitch, buttons: Btn.volley });
    expect(angleDist(a.aimYaw, yawFromTo(a.x, a.z, px, pz))).toBeGreaterThan(30 * DEG);
    lead(world, TICK_RATE, { aimYaw, aimPitch, buttons: Btn.volley });
    for (const u of [a, b, c]) expect(angleDist(u.aimYaw, yawFromTo(u.x, u.z, px, pz))).toBeLessThan(1e-6);
    expect(leader.rooted).toBe(false);
  });

  it('lets the leader drive on while they stand and charge', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    lead(world, 1, { buttons: Btn.volley });
    driveTo(world, -40, 60, 1500, Btn.volley);
    lead(world, 30, { buttons: Btn.volley });
    expect(Math.hypot(leader.x + 40, leader.z - 60)).toBeLessThan(1.5);
    expect([a.x, a.z, b.x, b.z, c.x, c.z]).toEqual([12, 0, 24, 0, 36, 0]);
    expect(a.rooted && b.rooted && c.rooted).toBe(true);
    expect(a.charge).toBeGreaterThan(0.5);
  });

  it('says so on the radio once, when the whole squad is charged', () => {
    const world = field();
    const [, a] = lineUp(world, 0, 0);
    const events: SimEvent[] = [];
    let full = -1;
    for (let t = 0; t < CHARGE_TICKS + 60; t++) {
      events.push(...lead(world, 1, { buttons: Btn.volley }));
      if (full < 0 && a.charge >= 1) full = world.tick;
    }
    const ready = eventsOf(events, 'voice').filter((e) => e.cue === 'volley.ready');
    expect(ready).toMatchObject([{ squad: 0, player: HUMAN_PLAYER, tick: full }]);
    expect(world.squads[0].volleyReady).toBe(true);
  });

  it('does not charge a squad-mate that is shaken or stunned; it plants afresh once it is steady', () => {
    const world = field();
    const [, a, b, c] = lineUp(world, 0, 0);
    b.shaken = 2;
    c.stun = 1;
    lead(world, 30, { buttons: Btn.volley });
    expect([a.rooted, a.charge > 0]).toEqual([true, true]);
    expect([b.rooted, b.charge]).toEqual([false, 0]);
    expect([c.rooted, c.charge]).toEqual([false, 0]);
    // Steady again, the button still held: it plants where it stands, its charge from nothing.
    lead(world, 3 * TICK_RATE, { buttons: Btn.volley });
    for (const u of [b, c]) {
      expect(u.rooted).toBe(true);
      expect(u.charge).toBeGreaterThan(0);
      expect(u.charge).toBeLessThan(a.charge);
    }
  });

  it('letting go un-plants them, and they follow the leader again', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    lead(world, 60, { buttons: Btn.volley });
    lead(world, 1);
    for (const u of [a, b, c]) expect([u.rooted, u.charge, u.state]).toEqual([false, 0, 'idle']);
    driveTo(world, 0, 80);
    lead(world, 4 * TICK_RATE);
    for (const u of [a, b, c]) expect(Math.hypot(u.x - leader.x, u.z - leader.z)).toBeLessThan(3 * formationSpacing(u));
  });
});

describe('shaken squad-mates', () => {
  it('back away from the kaiju without firing, and come back to the swarm when they steady', () => {
    const world = field();
    const [leader, a, b] = lineUp(world, 0, 0);
    const k = placeKaiju(world, 12, 40, 0);
    // The squad-mates hold their fire for this one (they would shoot at the kaiju).
    for (const u of subs(world)) u.cooldown = 1e9;
    lead(world, 30, { buttons: Btn.volley });
    // A roar-sized fright for one of them.
    world.hits.push({
      target: { entity: 'unit', id: a.id },
      hit: { damage: 0, nerve: COMBAT_RULES.unitNerveCapacity, fromDir: { x: 0, z: 1 }, sourceId: 0, player: 0, kind: 'blast', atWill: false },
    });
    const events = lead(world, 2, { buttons: Btn.volley });
    expect(eventsOf(events, 'unitShaken')).toMatchObject([{ unit: a.id }]);
    expect([a.rooted, a.charge, a.state]).toEqual([false, 0, 'shaken']);

    const before = Math.hypot(a.x - k.x, a.z - k.z);
    const fled = lead(world, Math.round(COMBAT_RULES.shakenDuration * TICK_RATE) - 5, { buttons: Btn.volley });
    expect(a.shaken).toBeGreaterThan(0);
    expect(Math.hypot(a.x - k.x, a.z - k.z)).toBeGreaterThan(before + 15);
    expect(eventsOf(fled, 'projectileSpawn')).toEqual([]);
    // Its neighbor kept its nerve and its place.
    expect([b.rooted, b.x, b.z]).toEqual([true, 24, 0]);

    // Steady again, the button let go: it comes back to its leader.
    lead(world, 30);
    expect(a.shaken).toBe(0);
    leader.yaw = 0;
    driveTo(world, 0, 20);
    lead(world, 6 * TICK_RATE);
    expect(Math.hypot(a.x - leader.x, a.z - leader.z)).toBeLessThan(3 * formationSpacing(a));
  });

  it('stand their ground when the kaiju is nowhere near', () => {
    const world = field();
    const [, a] = lineUp(world, 0, 0);
    world.hits.push({
      target: { entity: 'unit', id: a.id },
      hit: { damage: 0, nerve: COMBAT_RULES.unitNerveCapacity, fromDir: { x: 0, z: 0 }, sourceId: -1, player: -1, kind: 'blast', atWill: false },
    });
    lead(world, 60);
    expect(a.state).toBe('shaken');
    expect([a.x, a.z]).toEqual([12, 0]);
  });
});

describe('fire at will', () => {
  /** Ticks until the first projectile, and the events up to it. */
  function untilShot(world: World, max: number, partial: Partial<PlayerInput> = {}): { ticks: number; events: SimEvent[] } {
    const events: SimEvent[] = [];
    for (let t = 1; t <= max; t++) {
      events.push(...lead(world, 1, partial));
      if (eventsOf(events, 'projectileSpawn').length > 0) return { ticks: t, events };
    }
    return { ticks: -1, events };
  }

  it('squad-mates shoot on their own at a kaiju in range and in sight, with half nerve', () => {
    const world = field();
    const [leader, a] = lineUp(world, 0, 0);
    parkUnits(world, [0, 1]);
    // The kaiju stands south of them and looks north, straight at them. (At-will fire is
    // loose: from much further out most of a hatchling-sized target's rockets go wide.)
    const k = placeKaiju(world, 12, -45, 0);
    const { ticks, events } = untilShot(world, 60);
    // It swings its weapon round first, then fires.
    expect(ticks).toBeGreaterThan(0);
    const spawns = eventsOf(events, 'projectileSpawn');
    expect(spawns.length).toBe(3);
    for (const s of spawns) {
      expect(s).toMatchObject({ projectile: 'rocket', flight: 'flat', owner: 'unit', ownerId: a.id, player: HUMAN_PLAYER, volley: false, gravity: 0 });
      expect(Math.hypot(s.vx, s.vy, s.vz)).toBeCloseTo(55, 6);
    }
    expect(world.projectiles.every((p) => p.atWill && !p.volley)).toBe(true);
    // The leader does not fire unless its player does.
    expect(leader.cooldown).toBe(0);
    expect(a.cooldown).toBeCloseTo(ROCKETS.cooldown, 6);

    // The rockets take under a second; those that land count half for nerve.
    const flight = lead(world, 40);
    const hits = eventsOf(flight, 'kaijuHit');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.cause).toBe('rocket');
      expect(h.nerve).toBeCloseTo(ROCKETS.nerve * COMBAT_RULES.atWillNerveMult, 9);
      expect(h.damage).toBeCloseTo(ROCKETS.damage * LIZARD.damage.normalMult, 9);
    }
    expect(k.hp).toBeLessThan(k.maxHp);
    // And it keeps firing as its weapon comes ready: the next salvo exactly one cooldown after the first.
    const more = lead(world, Math.round(ROCKETS.cooldown * TICK_RATE) - 40);
    expect(eventsOf(more, 'projectileSpawn').length).toBe(3);
    expect(eventsOf(more, 'projectileSpawn')[0].tick - spawns[0].tick).toBe(Math.round(ROCKETS.cooldown * TICK_RATE));
  });

  it('shoots on the move too, riding with the leader', () => {
    const world = field();
    lineUp(world, 0, 0);
    placeKaiju(world, 60, 120, 0);
    const { ticks, events } = untilShot(world, 90, { moveZ: 1 });
    expect(ticks).toBeGreaterThan(0);
    expect(eventsOf(events, 'projectileSpawn').every((s) => s.ownerId !== 0)).toBe(true);
  });

  it('holds fire when the kaiju is out of range or behind a building, and while planted', () => {
    const far = field();
    lineUp(far, 0, 0);
    placeKaiju(far, 12, ROCKETS.range + LIZARD.stages[0].bodyRadius + 6, 0);
    expect(untilShot(far, 90).ticks).toBe(-1);
    // One step closer and it opens up.
    placeKaiju(far, 12, ROCKETS.range + LIZARD.stages[0].bodyRadius - 2, 0);
    expect(untilShot(far, 90).ticks).toBeGreaterThan(0);

    const hidden = field({ structures: [{ x: 20, z: 50, w: 120, d: 10, height: 20 }] });
    lineUp(hidden, 0, 0);
    placeKaiju(hidden, 12, 100, 0);
    expect(untilShot(hidden, 90).ticks).toBe(-1);
    // The wall comes down, and its rubble (half as high) still hides a hatchling.
    hidden.structureHp[0] = 0;
    expect(untilShot(hidden, 90).ticks).toBe(-1);
    // A low wall's rubble hides only its feet: over it they see the rest of it.
    const low = field({ structures: [{ x: 20, z: 50, w: 120, d: 10, height: 4 }] });
    lineUp(low, 0, 0);
    placeKaiju(low, 12, 100, 0);
    expect(untilShot(low, 90).ticks).toBe(-1);
    low.structureHp[0] = 0;
    expect(untilShot(low, 90).ticks).toBeGreaterThan(0);

    // Planted for a volley, nobody shoots until the button is let go.
    const planted = field();
    lineUp(planted, 0, 0);
    placeKaiju(planted, 12, 60, 0);
    expect(untilShot(planted, 90, { buttons: Btn.volley }).ticks).toBe(-1);
  });

  it('leads a moving target by the flight time of its rockets', () => {
    const world = field();
    const [, a] = lineUp(world, 0, 0);
    parkUnits(world, [0, 1]);
    const k = placeKaiju(world, 12, 110, 0);
    k.vx = 6;
    const { events } = untilShot(world, 60);
    const spawns = eventsOf(events, 'projectileSpawn');
    expect(spawns.length).toBe(3);
    // The weapon points ahead of where the kaiju is now, by the flight time of a rocket. (The
    // rockets themselves scatter around that aim, each with its own at-will error, so the lead
    // is read off the weapon rather than off one rocket.)
    const dist = Math.hypot(k.x - a.x, k.z - a.z);
    const lead1 = Math.atan2(k.x + k.vx * (dist / 55) - a.x, k.z - a.z);
    expect(a.aimYaw).toBeGreaterThan(Math.atan2(k.x - a.x, k.z - a.z) + 2 * DEG);
    expect(Math.abs(a.aimYaw - lead1)).toBeLessThan(1 * DEG);
    const mean = spawns.reduce((sum, s) => sum + Math.atan2(s.vx, s.vz), 0) / spawns.length;
    expect(Math.abs(mean - lead1)).toBeLessThan(4 * ROCKETS.aimErrorAtWill);
  });
});
