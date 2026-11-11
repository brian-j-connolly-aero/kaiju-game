import { describe, expect, it } from 'vitest';
import {
  angleDist,
  beginStage,
  boundsContains,
  COMBAT_RULES,
  DEG,
  decodeSnapshot,
  encodeSnapshot,
  formationSpacing,
  lasersOnKaiju,
  LIZARD,
  queueCommand,
  snapshotOfWorld,
  SQUAD_RULES,
  squadCharge,
  structureContact,
  structuresInCircle,
  TICK_RATE,
  UNIT_TYPES,
  WEAPONS,
  yawFromTo,
  type PlayerInput,
  type SimEvent,
  type Unit,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const INFANTRY = UNIT_TYPES.army_rocket_infantry;
const ROCKETS = WEAPONS.army_rocket_launchers;
const HALF_ARC = COMBAT_RULES.chargeHalfArc;

/**
 * A wide open field: the first squad is a person's (player 1, units 0 to 3, unit 0 driven), the
 * other squads and the kaiju are parked a long way off, out of everybody's range and sight.
 */
function field(options: TestWorldOptions = {}): World {
  const world = makeTestWorld(options);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -700, -700, 0);
  return world;
}

/** Lines the first squad up along x at a z, leader first, 12 m apart. */
function lineUp(world: World, x: number, z: number): Unit[] {
  return [0, 1, 2, 3].map((id) => placeUnit(world, id, x + id * 12, z));
}

/** Steps with the squad leader's input. */
function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [null, input(partial)]);
}

/** Drives the leader to a point the way a player would: look at it, stick forward. */
function driveTo(world: World, x: number, z: number, maxTicks = 1200): SimEvent[] {
  const leader = world.units[world.squads[0].driven];
  const events: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const d = Math.hypot(x - leader.x, z - leader.z);
    if (d < 0.6) break;
    events.push(...lead(world, 1, { aimYaw: yawFromTo(leader.x, leader.z, x, z), moveZ: d > 3 ? 1 : 0.4 }));
  }
  expect(Math.hypot(x - leader.x, z - leader.z)).toBeLessThan(1.5);
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

describe('squads and commands', () => {
  it('fields four units of the level, one driven and three under orders', () => {
    const world = makeTestWorld();
    for (const squad of world.squads) {
      expect(squad.units.length).toBe(4);
      expect(squad.driven).toBe(squad.units[0]);
      for (const id of squad.units) {
        const u = world.units[id];
        expect(u).toMatchObject({ alive: true, type: 'army_rocket_infantry', hp: 100, members: 10, radius: 3 });
      }
    }
    beginStage(world, 2);
    expect(world.units.every((u) => u.type === 'army_tank' && u.members === 1 && u.hp === 100)).toBe(true);
    beginStage(world, 3);
    expect(world.units.every((u) => u.type === 'army_tank_troop' && u.members === 3 && u.hp === 300)).toBe(true);
  });

  it('keeps the movement order and the fire mode independent, from the wheel or from a command message', () => {
    const world = field();
    const squad = world.squads[0];
    expect([squad.moveOrder, squad.fireMode]).toEqual(['follow', 'atWill']);

    lead(world, 1, { wheel: 'holdCharge' });
    expect([squad.moveOrder, squad.fireMode]).toEqual(['follow', 'charge']);
    lead(world, 1, { wheel: 'moveTo', marker: { x: 20, z: 30 } });
    expect([squad.moveOrder, squad.fireMode]).toEqual(['moveTo', 'charge']);
    expect(squad.moveTarget).toEqual({ x: 20, z: 30 });
    lead(world, 1, { wheel: 'fireAtWill' });
    expect([squad.moveOrder, squad.fireMode]).toEqual(['moveTo', 'atWill']);
    lead(world, 1, { wheel: 'follow' });
    expect([squad.moveOrder, squad.fireMode]).toEqual(['follow', 'atWill']);

    // A `command` message does the same thing as a wheel pick, one tick later.
    queueCommand(world, HUMAN_PLAYER, { type: 'holdCharge' });
    queueCommand(world, HUMAN_PLAYER, { type: 'moveTo', x: -5000, z: 12 });
    lead(world, 1);
    expect([squad.moveOrder, squad.fireMode]).toEqual(['moveTo', 'charge']);
    // A marker outside the quarantine line is pulled back to it.
    expect(squad.moveTarget).toEqual({ x: world.match.bounds.minX, z: 12 });
    // Other squads heard nothing.
    expect([world.squads[1].moveOrder, world.squads[1].fireMode]).toEqual(['follow', 'atWill']);

    // The snapshot carries the orders.
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.squads[0]).toMatchObject({ moveOrder: 'moveTo', fireMode: 'charge', driven: 0 });
    expect(snap.squads[0].moveTargetX).toBeCloseTo(world.match.bounds.minX, 1);
  });
});

describe('the driven unit: arcade handling', () => {
  it('infantry is nimble: it goes where the stick points at once, whatever it is looking at', () => {
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

  it('a tank turns its hull toward where it is going while the turret stays on the aim', () => {
    const world = field();
    beginStage(world, 2);
    world.match.bounds = world.match.stageBounds[2];
    parkUnits(world);
    placeKaiju(world, -700, -700, 0);
    const [leader] = lineUp(world, 0, 0);
    const tank = UNIT_TYPES.army_tank;
    leader.yaw = 100 * DEG;
    // The view is at 45 degrees and the stick is to its right: travel is a quarter turn off the view, at -45 degrees.
    const aimYaw = 45 * DEG;
    lead(world, 1, { aimYaw, aimPitch: 0.1, moveX: 1 });
    // The turret is on the aim at once; the hull has only begun to turn, and the tank has barely moved.
    expect(leader.aimYaw).toBeCloseTo(aimYaw, 9);
    expect(leader.aimPitch).toBeCloseTo(0.1, 9);
    expect(leader.yaw).toBeCloseTo(100 * DEG - tank.turnRate / TICK_RATE, 9);
    expect(Math.hypot(leader.vx, leader.vz)).toBeLessThan(0.5);
    lead(world, 20, { aimYaw, aimPitch: 0.1, moveX: 1 });
    expect(leader.yaw).toBeCloseTo(100 * DEG - (21 * tank.turnRate) / TICK_RATE, 6);
    // Once the hull points along the travel direction it drives at full speed, turret still on the aim.
    lead(world, 90, { aimYaw, aimPitch: 0.1, moveX: 1 });
    expect(leader.yaw).toBeCloseTo(-45 * DEG, 6);
    expect(Math.hypot(leader.vx, leader.vz)).toBeCloseTo(tank.speed, 6);
    expect(leader.vx).toBeLessThan(0);
    expect(leader.vz).toBeGreaterThan(0);
    expect(leader.aimYaw).toBeCloseTo(aimYaw, 9);
  });
});

describe('follow me: the formation', () => {
  it('stays where it was deployed until the leader moves or calls it in', () => {
    const world = field();
    const [, a, b, c] = lineUp(world, 0, 0);
    lead(world, 60);
    expect([a.x, b.x, c.x]).toEqual([12, 24, 36]);
    expect(a.state).toBe('idle');

    // "Follow me" with the leader standing still: they fall in behind its back.
    const leader = world.units[0];
    leader.yaw = 0;
    lead(world, 1, { wheel: 'follow' });
    lead(world, 240);
    for (const u of [a, b, c]) {
      expect(u.z).toBeLessThan(leader.z - u.radius);
      expect(Math.hypot(u.vx, u.vz)).toBe(0);
      expect(u.state).toBe('idle');
    }
  });

  it('strings the sub-units out behind the leader in a staggered column and stops when the leader stops', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    driveTo(world, 0, 90);
    lead(world, 150);

    const spacing = formationSpacing(a);
    expect(spacing).toBe(2 * INFANTRY.radius + SQUAD_RULES.formationGap);
    // A unit that has settled does not shuffle until its slot has moved well away from it.
    const tol = 1.5 * (SQUAD_RULES.slotTolerance * a.radius + 1) + 0.5;
    [a, b, c].forEach((u, rank) => {
      // Rank by rank further back along the way the leader came, alternating sides of its track.
      expect(leader.z - u.z).toBeGreaterThan((rank + 1) * spacing - tol);
      expect(leader.z - u.z).toBeLessThan((rank + 1) * spacing + tol);
      const side = (rank % 2 === 0 ? 1 : -1) * SQUAD_RULES.formationStagger * spacing;
      expect(Math.abs(u.x - side)).toBeLessThan(tol);
      expect(Math.hypot(u.vx, u.vz)).toBe(0);
    });
    // Nobody stands on anybody.
    const all = [leader, a, b, c];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThan(all[i].radius + all[j].radius);
      }
    }
    // They were on the move while the leader was, and kept pace.
    expect(a.yaw).toBeCloseTo(0, 1);
  });

  it('closes up into single file where the street is too narrow for the stagger', () => {
    // A street 9 m wide between two long blocks: room for one section (6 m) but not for the stagger.
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

  it('follows the leader round a corner without anybody getting stuck on it', () => {
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
  });

  it('makes tanks turn their hull toward where they go, and close ranks as units are lost', () => {
    const world = field();
    beginStage(world, 2);
    world.match.bounds = world.match.stageBounds[2];
    parkUnits(world);
    placeKaiju(world, -700, -700, 0);
    const [leader, a, b, c] = lineUp(world, 0, 0);
    for (const u of world.units) u.yaw = Math.PI / 2;
    driveTo(world, 0, 150);
    lead(world, 240);
    expect(angleDist(a.yaw, 0)).toBeLessThan(25 * DEG);
    const spacing = formationSpacing(a);
    expect(leader.z - c.z).toBeGreaterThan(2.5 * spacing);

    // The middle of the column is lost: the last tank moves up a place.
    b.alive = false;
    driveTo(world, 0, 190);
    lead(world, 240);
    expect(leader.z - c.z).toBeLessThan(2 * spacing + SQUAD_RULES.slotTolerance * c.radius + 1);
  });
});

describe('move to', () => {
  it('sends the sub-units to their own spots around the marker, where they hold', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    lead(world, 1, { wheel: 'moveTo', marker: { x: 30, z: 80 } });
    const events = lead(world, TICK_RATE * 25);
    const spacing = formationSpacing(a);
    for (const u of [a, b, c]) {
      expect(Math.hypot(u.x - 30, u.z - 80)).toBeLessThan(spacing);
      expect(Math.hypot(u.vx, u.vz)).toBe(0);
      expect(u.state).toBe('idle');
    }
    // Spread out round the marker, not stacked on it.
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * a.radius);
    expect(Math.hypot(b.x - c.x, b.z - c.z)).toBeGreaterThan(2 * a.radius);
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThan(2 * a.radius);
    // The leader is the player's to move; it was not sent anywhere.
    expect([leader.x, leader.z]).toEqual([0, 0]);
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);

    // They hold there even when the leader wanders off, until "follow me".
    driveTo(world, -60, 0);
    lead(world, 60);
    expect(Math.hypot(a.x - 30, a.z - 80)).toBeLessThan(spacing);
    lead(world, 1, { wheel: 'follow' });
    lead(world, TICK_RATE * 30);
    for (const u of [a, b, c]) expect(Math.hypot(u.x - leader.x, u.z - leader.z)).toBeLessThan(4 * spacing);
  });

  it('picks open ground when the marker is on a building, and goes round what is in the way', () => {
    const world = field({ structures: [{ x: 0, z: 60, w: 70, d: 30, height: 12 }] });
    const [, a, b, c] = lineUp(world, -12, 0);
    // The marker is in the middle of the building; the units start south of it.
    lead(world, 1, { wheel: 'moveTo', marker: { x: 0, z: 60 } });
    for (const u of [a, b, c]) {
      expect(u.nav.hasHold).toBe(true);
      expect(Math.abs(u.nav.holdX) > 35 + u.radius || Math.abs(u.nav.holdZ - 60) > 15 + u.radius).toBe(true);
    }
    // Now a marker on the far side: there are no roads in this little city, so they feel their way round.
    lead(world, 1, { wheel: 'moveTo', marker: { x: 0, z: 110 } });
    for (let t = 0; t < TICK_RATE * 60; t += 10) {
      lead(world, 10);
      expectClearOfWalls(world);
    }
    for (const u of [a, b, c]) {
      expect(u.z).toBeGreaterThan(75);
      expect(Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ)).toBeLessThan(SQUAD_RULES.arriveRadius + 0.6);
    }
  });

  it('walks straight across rubble', () => {
    const world = field({ structures: [{ x: 0, z: 60, w: 70, d: 30, height: 12 }] });
    world.structureHp[0] = 0;
    const [, a] = lineUp(world, -12, 0);
    lead(world, 1, { wheel: 'moveTo', marker: { x: 0, z: 110 } });
    const dist = Math.hypot(a.nav.holdX - a.x, a.nav.holdZ - a.z);
    lead(world, Math.ceil((dist / INFANTRY.speed) * TICK_RATE) + 20);
    // No detour: it arrived in the time a straight walk takes.
    expect(Math.hypot(a.x - a.nav.holdX, a.z - a.nav.holdZ)).toBeLessThan(SQUAD_RULES.arriveRadius + 0.6);
  });

  it('finds its way through the real city along the streets, at every level', () => {
    for (const stage of [1, 2, 3] as const) {
      const world = makeTestWorld({ realCity: true, seed: 5 });
      if (stage > 1) beginStage(world, stage);
      const squad = world.squads[0];
      const b = world.match.bounds;
      // A point well inside the bounds, blocks away from where the squad deployed.
      const leader = world.units[squad.driven];
      const tx = leader.x + (leader.x < (b.minX + b.maxX) / 2 ? 1 : -1) * Math.min(260, 0.6 * (b.maxX - b.minX));
      const tz = leader.z + (leader.z < (b.minZ + b.maxZ) / 2 ? 1 : -1) * Math.min(230, 0.5 * (b.maxZ - b.minZ));
      // The squads hold their fire: this is about getting there.
      lead(world, 1, { wheel: 'holdCharge' });
      lead(world, 1, { wheel: 'moveTo', marker: { x: tx, z: tz } });
      const speed = UNIT_TYPES[world.units[0].type].speed;
      const far = Math.max(...subs(world).map((u) => Math.abs(u.nav.holdX - u.x) + Math.abs(u.nav.holdZ - u.z)));
      // Along a street grid the way is at most the sum of the two legs; allow for corners and for wading.
      const limit = Math.ceil(((far * 1.6) / speed + 20) * TICK_RATE);
      let ticks = 0;
      while (ticks < limit && subs(world).some((u) => !u.rooted)) {
        lead(world, 15);
        ticks += 15;
        expectClearOfWalls(world);
        for (const u of world.units) expect(boundsContains(b, u.x, u.z, u.radius - 1e-6)).toBe(true);
      }
      for (const u of subs(world)) {
        expect(Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ)).toBeLessThan(SQUAD_RULES.arriveRadius + 0.6);
        // Hold fire and charge: having arrived, they planted themselves.
        expect(u.rooted).toBe(true);
      }
    }
  });
});

describe('hold fire and charge', () => {
  it('plants the sub-units where they stand, lasers on, and builds charge from 0 to 1 over the charge time', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    placeKaiju(world, 18, 120, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(true);
      expect(u.state).toBe('charging');
      // The arc is centered on the kaiju, which everybody can see from here.
      expect(u.arcYaw).toBeCloseTo(yawFromTo(u.x, u.z, 18, 120), 9);
    }
    expect(leader.rooted).toBe(false);
    expect(a.charge).toBeCloseTo(1 / (COMBAT_RULES.chargeTime * TICK_RATE), 9);

    const half = Math.round((COMBAT_RULES.chargeTime / 2) * TICK_RATE);
    lead(world, half - 1);
    expect(a.charge).toBeCloseTo(0.5, 6);
    expect(squadCharge(world, world.squads[0])).toBeCloseTo(0.5, 6);
    // They hold fire the whole time, though the kaiju is in range and in plain view.
    const events = lead(world, half + 30);
    expect(a.charge).toBe(1);
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    expect([a.x, a.z, b.x, c.x]).toEqual([12, 0, 24, 36]);

    // What a client draws: the laser flag, the charge, and the aim the laser lies along.
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.units[1]).toMatchObject({ laser: true, rooted: true, state: 'charging', charge: 1 });
    expect(snap.units[0]).toMatchObject({ laser: false, rooted: false, driven: true });
    expect(snap.units[1].aimYaw).toBeCloseTo(yawFromTo(a.x, a.z, 18, 120), 3);
    expect(lasersOnKaiju(world, world.kaijus[0])).toBe(3);
  });

  it('says so on the radio once, when the whole squad is charged', () => {
    const world = field();
    lineUp(world, 0, 0);
    const events = lead(world, 1, { wheel: 'holdCharge' });
    events.push(...lead(world, COMBAT_RULES.chargeTime * TICK_RATE + 60));
    const ready = eventsOf(events, 'voice').filter((e) => e.cue === 'volley.ready');
    expect(ready).toMatchObject([{ squad: 0, player: HUMAN_PLAYER }]);
    expect(ready[0].tick).toBe(1 + 1 + COMBAT_RULES.chargeTime * TICK_RATE);
    expect(world.squads[0].volleyReady).toBe(true);
  });

  it('keeps them rooted while the leader goes elsewhere', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    driveTo(world, -40, 60);
    lead(world, 30);
    expect(Math.hypot(leader.x + 40, leader.z - 60)).toBeLessThan(1.5);
    expect([a.x, a.z, b.x, b.z, c.x, c.z]).toEqual([12, 0, 24, 0, 36, 0]);
    expect(a.rooted && b.rooted && c.rooted).toBe(true);
  });

  it('locks each unit to its firing arc: the laser follows the kaiju to the edge and no further', () => {
    const world = field();
    const [, a] = lineUp(world, 0, 0);
    const k = placeKaiju(world, 12, 100, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    expect(a.arcYaw).toBeCloseTo(0, 9);
    lead(world, 30);
    expect(a.aimYaw).toBeCloseTo(0, 6);
    // Its weapon points at the middle of the body.
    expect(a.aimPitch).toBeCloseTo(Math.atan2(LIZARD.stages[0].height * 0.5 - INFANTRY.muzzleHeight, 100), 6);

    // The kaiju sidesteps 20 degrees: the laser goes with it.
    k.x = 12 + 100 * Math.tan(20 * DEG);
    lead(world, 30);
    expect(a.aimYaw).toBeCloseTo(20 * DEG, 6);
    expect(lasersOnKaiju(world, k)).toBe(3);
    // It walks right out of the arc: the laser stops at the edge.
    k.x = 12 + 100 * Math.tan(60 * DEG);
    lead(world, 60);
    expect(a.aimYaw).toBeCloseTo(HALF_ARC, 6);
    expect(a.arcYaw).toBeCloseTo(0, 9);
    expect(a.rooted).toBe(true);

    // Giving the order again plants the squad afresh: new arcs, and the charge starts over.
    expect(a.charge).toBeGreaterThan(0.6);
    lead(world, 1, { wheel: 'holdCharge' });
    expect(a.arcYaw).toBeCloseTo(yawFromTo(a.x, a.z, k.x, k.z), 9);
    expect(a.charge).toBeLessThan(0.01);
  });

  it('covers what the leader is aiming at when nobody knows where the kaiju is', () => {
    const world = field({ structures: [{ x: -100, z: -100, w: 60, d: 60, height: 20 }] });
    // The kaiju is far away behind a building: not on the map at stage 1.
    placeKaiju(world, -160, -160, 0);
    const [leader, a, b] = lineUp(world, 0, 0);
    lead(world, 5);
    expect(world.kaijus[0].known).toBe(false);
    // The leader looks down the street to the north-east, at the ground 50 m out.
    const aimYaw = 40 * DEG;
    const aimPitch = -Math.atan2(INFANTRY.eyeHeight, 50);
    lead(world, 1, { wheel: 'holdCharge', aimYaw, aimPitch });
    const px = leader.x + Math.sin(aimYaw) * 50;
    const pz = leader.z + Math.cos(aimYaw) * 50;
    expect(a.arcYaw).toBeCloseTo(yawFromTo(a.x, a.z, px, pz), 6);
    expect(b.arcYaw).toBeCloseTo(yawFromTo(b.x, b.z, px, pz), 6);
    lead(world, 20, { aimYaw, aimPitch });
    expect(a.aimYaw).toBeCloseTo(a.arcYaw, 9);
  });

  it('lets them go on a new movement order or on fire at will, and the charge is gone', () => {
    const world = field();
    const [, a, b, c] = lineUp(world, 0, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    lead(world, 90);
    expect(a.charge).toBeGreaterThan(0.4);

    lead(world, 1, { wheel: 'fireAtWill' });
    expect([a.rooted, a.charge, a.state]).toEqual([false, 0, 'idle']);

    lead(world, 1, { wheel: 'holdCharge' });
    lead(world, 90);
    lead(world, 1, { wheel: 'moveTo', marker: { x: 20, z: 70 } });
    for (const u of [a, b, c]) expect([u.rooted, u.charge]).toEqual([false, 0]);
    lead(world, 30);
    expect(a.state).toBe('moving');
    expect(a.charge).toBe(0);
    // Still on hold-and-charge: they plant themselves again at their hold points and start over.
    lead(world, TICK_RATE * 20);
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(true);
      expect(Math.hypot(u.x - u.nav.holdX, u.z - u.nav.holdZ)).toBeLessThan(SQUAD_RULES.arriveRadius + 0.6);
      expect(u.charge).toBeGreaterThan(0.5);
    }
  });

  it('follow me on hold-and-charge: they come along holding their fire, and plant again on the next hold order', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    // The kaiju is in range and in plain view the whole time: fire-at-will units would be shooting.
    placeKaiju(world, 60, 60, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    driveTo(world, 0, 80);
    expect(a.rooted).toBe(true);
    expect([a.x, a.z]).toEqual([12, 0]);

    const events = lead(world, 1, { wheel: 'follow' });
    events.push(...lead(world, TICK_RATE * 15));
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(false);
      expect(u.charge).toBe(0);
      expect(u.state).toBe('idle');
      expect(Math.hypot(u.x - leader.x, u.z - leader.z)).toBeLessThan(4 * formationSpacing(u));
    }
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    expect(world.squads[0].fireMode).toBe('charge');

    // The hold command again: they plant where they now stand.
    lead(world, 1, { wheel: 'holdCharge' });
    lead(world, 60);
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(true);
      expect(u.charge).toBeGreaterThan(0.3);
      expect(u.z).toBeGreaterThan(40);
    }
  });
});

describe('shaken sub-units', () => {
  it('let go of their hold, back away from the kaiju without firing, and come back when they steady', () => {
    const world = field();
    const [, a, b] = lineUp(world, 0, 0);
    const k = placeKaiju(world, 12, 40, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    lead(world, 60);
    // A roar-sized fright for one of them.
    world.hits.push({
      target: { entity: 'unit', id: a.id },
      hit: { damage: 0, nerve: COMBAT_RULES.unitNerveCapacity, fromDir: { x: 0, z: 1 }, sourceId: 0, player: 0, kind: 'roar', atWill: false },
    });
    const events = lead(world, 2);
    expect(eventsOf(events, 'unitShaken')).toMatchObject([{ unit: a.id }]);
    expect([a.rooted, a.charge, a.state]).toEqual([false, 0, 'shaken']);

    const before = Math.hypot(a.x - k.x, a.z - k.z);
    const fled = lead(world, Math.round(COMBAT_RULES.shakenDuration * TICK_RATE) - 5);
    expect(a.shaken).toBeGreaterThan(0);
    expect(Math.hypot(a.x - k.x, a.z - k.z)).toBeGreaterThan(before + 15);
    expect(eventsOf(fled, 'projectileSpawn')).toEqual([]);
    // Its neighbor kept its nerve and its place.
    expect([b.rooted, b.x, b.z]).toEqual([true, 24, 0]);

    // Steady again: it goes back to the spot it was parked on, plants itself and starts charging from nothing.
    lead(world, 30);
    expect(a.shaken).toBe(0);
    expect(a.rooted).toBe(false);
    expect(a.state).toBe('moving');
    lead(world, TICK_RATE * 8);
    expect(Math.hypot(a.x - 12, a.z)).toBeLessThan(SQUAD_RULES.arriveRadius + 0.6);
    expect(a.rooted).toBe(true);
    expect(a.state).toBe('charging');
    expect(a.charge).toBeGreaterThan(0);
    expect(a.charge).toBeLessThan(b.charge);
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
  function untilShot(world: World, max: number): { ticks: number; events: SimEvent[] } {
    const events: SimEvent[] = [];
    for (let t = 1; t <= max; t++) {
      events.push(...lead(world, 1));
      if (eventsOf(events, 'projectileSpawn').length > 0) return { ticks: t, events };
    }
    return { ticks: -1, events };
  }

  it('sub-units shoot on their own at a kaiju in range and in sight, with half nerve', () => {
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

  it('holds fire when the kaiju is out of range or behind a building', () => {
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
    // The wall comes down: now they see it.
    hidden.structureHp[0] = 0;
    expect(untilShot(hidden, 90).ticks).toBeGreaterThan(0);
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
