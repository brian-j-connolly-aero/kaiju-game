/**
 * Army supply crates and pick-ups (docs/ROADMAP.md, phase 2; DESIGN.md section 5, "Supply crates
 * and pick-ups"): crates coming down and being taken, and what each pick-up does.
 */

import { describe, expect, it } from 'vitest';
import {
  applyHit,
  boundsContains,
  Btn,
  COMBAT_RULES,
  CRATE_RULES,
  inWater,
  MAX_AIM_PITCH,
  PICKUP_WEAPONS,
  pickupWeaponDef,
  shotsForMembers,
  snapshotOfWorld,
  stepProjectile,
  TICK_RATE,
  UNIT_TYPES,
  unitWeapon,
  WEAPONS,
  dropCrate,
  type PickupKind,
  type PlayerInput,
  type SimEvent,
  type Unit,
  type World,
} from '../src/index';
import { eventsOf, holdFire, HUMAN_PLAYER, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const CHARGE_TICKS = Math.round(COMBAT_RULES.chargeTime * TICK_RATE);
const ROCKETS = WEAPONS.army_rocket_launchers;

/** A wide open field at stage 1: the first squad (a person's) lined up at the origin facing +Z, the kaiju far away. */
function field(options: TestWorldOptions = {}): { world: World; squad: World['squads'][number]; leader: Unit } {
  const world = makeTestWorld(options);
  // The first tick of play hands out the stage's crates (none here unless asked for).
  run(world, 1);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -700, -700, 0);
  for (const id of [0, 1, 2, 3]) {
    const u = placeUnit(world, id, id * 12, 0);
    u.yaw = 0;
    u.aimYaw = 0;
    u.control.aimYaw = 0;
  }
  return { world, squad: world.squads[0], leader: world.units[0] };
}

function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [null, input(partial)]);
}

/** Lays a landed crate on the ground. */
function layCrate(world: World, kind: PickupKind, x: number, z: number): number {
  const id = world.nextCrateId++;
  world.crates.push({ id, kind, x, z, fall: 0 });
  return id;
}

describe('supply crates', () => {
  it('come down for every squad when a stage starts, on a street near it and clear of the kaiju, land, and go to the unit that touches one', () => {
    const world = makeTestWorld({ realCity: true, crates: true });
    const events = run(world, 1);
    const drops = eventsOf(events, 'crate').filter((e) => e.phase === 'drop');
    expect(drops.map((d) => d.squad)).toEqual([0, 1, 2, 3]);
    const b = world.match.bounds;
    const k = world.kaijus[0];
    for (const d of drops) {
      expect(d).toMatchObject({ duration: CRATE_RULES.fallTime, height: CRATE_RULES.dropHeight, unit: -1, player: -1 });
      expect(boundsContains(b, d.x, d.z)).toBe(true);
      expect(Math.hypot(d.x - k.x, d.z - k.z)).toBeGreaterThan((CRATE_RULES.kaijuClearShare * (b.maxX - b.minX)) / 2);
      expect(inWater(world.cityQuery, d.x, d.z)).toBe(false);
      const leader = world.units[world.squads[d.squad].driven];
      const near = Math.hypot(d.x - leader.x, d.z - leader.z);
      expect(near).toBeGreaterThanOrEqual(CRATE_RULES.nearSquad[0] - 1e-6);
      expect(near).toBeLessThanOrEqual(CRATE_RULES.nearSquad[1] + 1e-6);
    }
    // The snapshot lists them, coming down.
    const snap = snapshotOfWorld(world);
    expect(snap.crates.map((c) => c.id)).toEqual(drops.map((d) => d.id));
    expect(snap.crates.every((c) => c.fall > 0 && c.fall < CRATE_RULES.fallTime)).toBe(true);

    // They land when the fall is over, and lie there.
    const later = run(world, Math.round(CRATE_RULES.fallTime * TICK_RATE));
    expect(eventsOf(later, 'crate').map((e) => e.phase)).toEqual(['land', 'land', 'land', 'land']);
    expect(world.crates.every((c) => c.fall === 0)).toBe(true);

    // A squad-mate of the first squad drives onto one: it is the squad's now.
    const c = world.crates[2];
    placeUnit(world, 1, c.x + 2, c.z);
    const took = run(world, 1);
    expect(eventsOf(took, 'crate')).toMatchObject([{ phase: 'take', id: c.id, kind: c.kind, squad: 0, unit: 1, player: HUMAN_PLAYER }]);
    expect(world.crates.map((x) => x.id)).not.toContain(c.id);
  });

  it('drop one every 30 s for the squads in turn while fewer than the stage allows are down, and go when the stage ends', () => {
    const world = makeTestWorld({ crates: true });
    run(world, 1);
    expect(world.crates.length).toBe(4);
    // Clear the first ones away to watch the timed drops: one per period, squad after squad, up to three at stage 1.
    world.crates.length = 0;
    const period = Math.round(CRATE_RULES.every * TICK_RATE);
    let events = run(world, period * 4);
    expect(eventsOf(events, 'crate').filter((e) => e.phase === 'drop').map((e) => e.squad)).toEqual([0, 1, 2]);
    expect(world.crates.length).toBe(CRATE_RULES.maxDown[0]);
    expect(eventsOf(events, 'crate').some((e) => e.phase === 'take')).toBe(false);

    // The molt ends the stage: the crates go, and so do the pick-ups.
    world.squads[0].pickup = 'bigCannon';
    world.squads[1].barrages = 2;
    world.match.phase = 'intermission';
    world.match.phaseTime = 1;
    events = run(world, 1);
    expect(eventsOf(events, 'crate').map((e) => e.phase)).toEqual(['gone', 'gone', 'gone']);
    expect(world.crates).toEqual([]);
    expect(world.squads.map((s) => [s.pickup, s.barrages])).toEqual([['none', 0], ['none', 0], ['none', 0], ['none', 0]]);
    // The next stage hands out its own.
    events = run(world, TICK_RATE + 2);
    expect(eventsOf(events, 'stageChange').length).toBe(1);
    expect(eventsOf(events, 'crate').filter((e) => e.phase === 'drop').map((e) => e.squad)).toEqual([0, 1, 2, 3]);
  });

  it('hold what the draw says: every kind turns up, and reinforcements are likelier for a squad that has lost units', () => {
    const world = makeTestWorld({ crates: true });
    run(world, 1);
    const share = (n: number): { reinforcements: number; kinds: Set<string> } => {
      let r = 0;
      const kinds = new Set<string>();
      for (let i = 0; i < n; i++) {
        world.crates.length = 0;
        const c = dropCrate(world, world.squads[0]);
        if (!c) throw new Error('no room for a crate');
        kinds.add(c.kind);
        if (c.kind === 'reinforcements') r++;
      }
      return { reinforcements: r / n, kinds };
    };
    const whole = share(400);
    expect(whole.kinds.size).toBe(5);
    // 1 in 12 for a whole squad...
    expect(whole.reinforcements).toBeGreaterThan(0.03);
    expect(whole.reinforcements).toBeLessThan(0.14);
    // ...7 in 18 for one that has lost three of its four.
    for (const id of [1, 2, 3]) world.units[id].alive = false;
    expect(share(400).reinforcements).toBeGreaterThan(0.3);
  });
});

describe('pick-ups', () => {
  it('scale the driven unit\'s own weapon with the stage, and leave the squad-mates\' alone', () => {
    for (const weapon of Object.values(WEAPONS)) {
      const mg = pickupWeaponDef(weapon, 'machineGun');
      expect(mg).toMatchObject({ projectile: 'tracer', maxShots: weapon.maxShots, range: weapon.range });
      expect(mg.cooldown).toBeCloseTo(weapon.cooldown / 5, 9);
      expect(mg.damage).toBeCloseTo(weapon.damage / 3, 9);
      // Five times the rate at a third of the damage: about 1.6 times the damage over time.
      expect((mg.damage / mg.cooldown) / (weapon.damage / weapon.cooldown)).toBeCloseTo(5 / 3, 9);
      expect(mg.spread).toBeGreaterThan(0);

      const cannon = pickupWeaponDef(weapon, 'bigCannon');
      expect(cannon.projectile).toBe('heavyShell');
      expect(cannon.cooldown).toBeCloseTo(weapon.cooldown * 2.5, 9);
      expect(cannon.damage).toBeCloseTo(weapon.damage * 3.5, 9);
      expect(cannon.nerve).toBeCloseTo(weapon.nerve * 2, 9);
      expect(cannon.splashRadius).toBeGreaterThan(weapon.splashRadius);

      // A salvo of six missiles at full strength, each 0.6 of a whole trigger pull of the unit's own weapon.
      const pod = pickupWeaponDef(weapon, 'missilePod');
      expect(pod.projectile).toBe('missile');
      expect(pod.cooldown).toBe(6);
      expect(pod.damage).toBeCloseTo(0.6 * weapon.damage * weapon.maxShots, 9);
      expect(shotsForMembers(pod, UNIT_TYPES[Object.values(UNIT_TYPES).find((t) => t.weapon === weapon.id)!.id].members)).toBe(6);
    }
    expect(pickupWeaponDef(ROCKETS, 'none')).toBe(ROCKETS);
    expect(pickupWeaponDef(ROCKETS, 'artilleryRadio')).toBe(ROCKETS);

    const { squad, leader, world } = field();
    squad.pickup = 'bigCannon';
    expect(unitWeapon(squad, leader).projectile).toBe('heavyShell');
    expect(unitWeapon(squad, world.units[1])).toBe(ROCKETS);
  });

  it('the machine gun: five times the rate of fire at a third of the damage, with a spread on a person\'s own shots', () => {
    const { world, squad, leader } = field();
    const fire = { buttons: Btn.fire, aimYaw: 0, aimPitch: 0.05 };
    const own = eventsOf(lead(world, 6 * TICK_RATE, fire), 'projectileSpawn').filter((e) => e.ownerId === leader.id);
    expect(own.length).toBe(3 * shotsForMembers(ROCKETS, leader.members));

    squad.pickup = 'machineGun';
    leader.cooldown = 0;
    const spawns: SimEvent[] = [];
    const damages = new Set<number>();
    for (let t = 0; t < 6 * TICK_RATE; t++) {
      spawns.push(...lead(world, 1, fire));
      for (const p of world.projectiles) if (p.ownerId === leader.id && p.type === 'tracer') damages.add(Math.round(p.damage * 1e6) / 1e6);
    }
    const mg = eventsOf(spawns, 'projectileSpawn').filter((e) => e.ownerId === leader.id);
    expect(mg.every((e) => e.projectile === 'tracer')).toBe(true);
    // 6 s at a fifth of 2.6 s: twelve pulls (the first at once), against three.
    expect(mg.length).toBe(12 * shotsForMembers(ROCKETS, leader.members));
    expect([...damages]).toEqual([Math.round((ROCKETS.damage / 3) * 1e6) / 1e6]);
    // A person's own shots have no aim error, but the machine gun has its spread.
    const yaws = mg.map((e) => Math.atan2(e.vx, e.vz));
    const sd = Math.sqrt(yaws.reduce((a, y) => a + y * y, 0) / yaws.length);
    expect(sd).toBeGreaterThan(0.4 * PICKUP_WEAPONS.machineGun.spread);
    expect(sd).toBeLessThan(2.5 * PICKUP_WEAPONS.machineGun.spread);
  });

  it('the big cannon: 3.5 times the damage and twice the nerve for 2.5 times the reload', () => {
    const shoot = (pickup: 'none' | 'bigCannon'): { damage: number; nerve: number; cooldown: number } => {
      const { world, squad, leader } = field();
      // Only the leader shoots.
      holdFire(world);
      squad.pickup = pickup;
      const k = placeKaiju(world, 0, 90, Math.PI);
      const eye = UNIT_TYPES.army_rocket_infantry.eyeHeight;
      const pitch = Math.atan2(k.height * 0.5 - eye, 90);
      const events = lead(world, 1, { buttons: Btn.fire, aimYaw: 0, aimPitch: pitch });
      const cooldown = leader.cooldown;
      events.push(...lead(world, 3 * TICK_RATE, { aimYaw: 0, aimPitch: pitch }));
      const hits = eventsOf(events, 'kaijuHit');
      expect(hits.length).toBe(shotsForMembers(ROCKETS, leader.members));
      return { damage: hits[0].damage, nerve: hits[0].nerve, cooldown };
    };
    const base = shoot('none');
    const cannon = shoot('bigCannon');
    expect(cannon.damage / base.damage).toBeCloseTo(3.5, 6);
    expect(cannon.nerve / base.nerve).toBeCloseTo(2, 6);
    expect(cannon.cooldown / base.cooldown).toBeCloseTo(2.5, 6);
  });

  it('the missile pod: six missiles fan out and curve onto the aim point, and a client flies each one exactly', () => {
    const { world, squad, leader } = field();
    squad.pickup = 'missilePod';
    const eye = UNIT_TYPES.army_rocket_infantry.eyeHeight;
    // The crosshair on the ground 120 m ahead.
    const pitch = -Math.atan2(eye, 120);
    const events = lead(world, 1, { buttons: Btn.fire, aimYaw: 0, aimPitch: pitch });
    const spawns = eventsOf(events, 'projectileSpawn').filter((e) => e.ownerId === leader.id);
    expect(spawns.length).toBe(6);
    expect(leader.cooldown).toBeCloseTo(PICKUP_WEAPONS.missilePod.reload ?? 0, 6);
    for (const s of spawns) {
      expect(s).toMatchObject({ projectile: 'missile', flight: 'guided' });
      expect(s.steer).toBeGreaterThan(0);
      expect(Math.round((s.steer ?? 0) * TICK_RATE * 1e6) / 1e6 % 1).toBe(0);
    }
    // They leave fanned out...
    const yaws = spawns.map((s) => Math.atan2(s.vx, s.vz));
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeCloseTo(PICKUP_WEAPONS.missilePod.fan, 1);
    // ...and all come down on the point.
    events.push(...lead(world, 4 * TICK_RATE, { aimYaw: 0, aimPitch: pitch }));
    const hits = eventsOf(events, 'projectileHit').filter((h) => spawns.some((s) => s.id === h.id));
    expect(hits.length).toBe(6);
    for (const h of hits) {
      expect(h.target).toBe('ground');
      expect(Math.hypot(h.x - 0, h.z - 120)).toBeLessThan(1.5);
      // A client that flies the missile from its spawn event sees it come down there too.
      const s = spawns.find((e) => e.id === h.id)!;
      const body = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, gravity: s.gravity, ax: s.ax, ay: s.ay, az: s.az, steer: s.steer };
      for (let tick = s.tick; tick < h.tick; tick++) stepProjectile(body, 1 / TICK_RATE);
      expect(body.y).toBeGreaterThan(-1e-6);
      stepProjectile(body, 1 / TICK_RATE);
      expect(body.y).toBeLessThanOrEqual(1e-6);
      expect(Math.hypot(body.x - h.x, body.z - h.z)).toBeLessThan(1.5);
    }
  });

  it('the artillery radio: each of the next three charged volleys calls a barrage where it lands, and nothing else does', () => {
    const { world, squad } = field();
    squad.barrages = CRATE_RULES.barrages;
    const eye = UNIT_TYPES.army_rocket_infantry.eyeHeight;
    const ground = { aimYaw: 0, aimPitch: -Math.atan2(eye, 200) };
    const volley = (ticks: number, aim: { aimYaw: number; aimPitch: number }): SimEvent[] => {
      const events = lead(world, ticks, { ...aim, buttons: Btn.volley });
      events.push(...lead(world, 2, aim));
      // Let the guns load again before the next one.
      events.push(...lead(world, 4 * TICK_RATE, aim));
      return events;
    };

    // A charged volley at the ground 200 m ahead: a barrage comes down there, and the radio says so.
    let events = volley(CHARGE_TICKS, ground);
    expect(eventsOf(events, 'volley').length).toBe(1);
    let marked = eventsOf(events, 'callin').filter((e) => e.phase === 'marked');
    expect(marked.length).toBe(1);
    expect(marked[0]).toMatchObject({ squad: 0, player: HUMAN_PLAYER, callIn: 'artillery' });
    expect(Math.hypot(marked[0].x - 0, marked[0].z - 200)).toBeLessThan(1);
    expect(eventsOf(events, 'voice').some((v) => v.cue === 'callin.inbound')).toBe(true);
    expect(squad.barrages).toBe(2);

    // A ragged volley (let go early) calls nothing, nor does a charged one at the empty sky.
    events = volley(Math.round(CHARGE_TICKS * 0.3), ground);
    events.push(...volley(CHARGE_TICKS, { aimYaw: 0, aimPitch: 0.6 }));
    expect(eventsOf(events, 'callin').filter((e) => e.phase === 'marked')).toEqual([]);
    expect(squad.barrages).toBe(2);

    // Two more, and the radio is spent.
    events = volley(CHARGE_TICKS, ground);
    events.push(...volley(CHARGE_TICKS, ground));
    events.push(...volley(CHARGE_TICKS, ground));
    expect(eventsOf(events, 'volley').length).toBe(3);
    marked = eventsOf(events, 'callin').filter((e) => e.phase === 'marked');
    expect(marked.length).toBe(2);
    expect(squad.barrages).toBe(0);
    expect(snapshotOfWorld(world).squads[0].barrages).toBe(0);
  });

  it('reinforcements: the dead come back by parachute beside the leader, and everybody is healed to full', () => {
    const { world, leader } = field();
    for (const id of [2, 3]) {
      applyHit(world, { entity: 'unit', id }, { damage: Infinity, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: -1, player: 0, kind: 'stomp', atWill: false });
    }
    applyHit(world, { entity: 'unit', id: 1 }, { damage: 60, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: -1, player: 0, kind: 'stomp', atWill: false });
    expect([1, 2, 3].map((id) => world.units[id].alive)).toEqual([true, false, false]);
    expect(world.units[1].members).toBeLessThan(UNIT_TYPES.army_rocket_infantry.members);

    layCrate(world, 'reinforcements', leader.x + 1, leader.z);
    const events = lead(world, 1);
    expect(eventsOf(events, 'crate')).toMatchObject([{ phase: 'take', kind: 'reinforcements', squad: 0, unit: 0 }]);
    expect(eventsOf(events, 'reinforce')).toMatchObject([
      { squad: 0, player: HUMAN_PLAYER, units: [2, 3], healed: [0, 1], duration: CRATE_RULES.reinforceTime, height: CRATE_RULES.reinforceHeight },
    ]);
    for (const id of [1, 2, 3]) {
      const u = world.units[id];
      expect(u.alive).toBe(true);
      expect(u.hp).toBe(u.maxHp);
      expect(u.members).toBe(UNIT_TYPES.army_rocket_infantry.members);
    }
    const dropped = [2, 3].map((id) => world.units[id]);
    for (const u of dropped) {
      expect(u.y).toBe(CRATE_RULES.reinforceHeight);
      expect(Math.hypot(u.x - leader.x, u.z - leader.z)).toBeLessThan(30);
    }
    // Coming down they stay where they are and hold their fire, even with the kaiju in reach.
    placeKaiju(world, 0, 60, Math.PI);
    const where = dropped.map((u) => [u.x, u.z]);
    const half = lead(world, Math.round((CRATE_RULES.reinforceTime / 2) * TICK_RATE));
    expect(dropped.map((u) => [u.x, u.z])).toEqual(where);
    expect(eventsOf(half, 'projectileSpawn').filter((e) => e.ownerId === 2 || e.ownerId === 3)).toEqual([]);
    expect(dropped[0].y).toBeCloseTo(CRATE_RULES.reinforceHeight / 2, 0);
    expect(snapshotOfWorld(world).units[2].y).toBeCloseTo(CRATE_RULES.reinforceHeight / 2, 0);
    // Then they are down, and in the fight.
    lead(world, Math.round((CRATE_RULES.reinforceTime / 2) * TICK_RATE) + 1);
    expect(dropped.map((u) => [u.y, u.drop])).toEqual([[0, 0], [0, 0]]);
  });

  it('a weapon pick-up replaces the last, and every pick-up ends with the squad', () => {
    const { world, squad, leader } = field();
    layCrate(world, 'missilePod', leader.x, leader.z + 2);
    lead(world, 1);
    expect(squad.pickup).toBe('missilePod');
    layCrate(world, 'machineGun', leader.x, leader.z + 2);
    layCrate(world, 'artilleryRadio', world.units[1].x, world.units[1].z + 2);
    lead(world, 1);
    expect([squad.pickup, squad.barrages]).toEqual(['machineGun', CRATE_RULES.barrages]);
    expect(snapshotOfWorld(world).squads[0]).toMatchObject({ pickup: 'machineGun', barrages: CRATE_RULES.barrages });
    for (const id of squad.units) {
      applyHit(world, { entity: 'unit', id }, { damage: Infinity, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: -1, player: 0, kind: 'stomp', atWill: false });
    }
    lead(world, 1);
    expect([squad.eliminated, squad.pickup, squad.barrages]).toEqual([true, 'none', 0]);
  });
});

describe('the squad bot and crates', () => {
  it('fetches a crate near by while the kaiju is far off, and takes it', () => {
    const world = makeTestWorld({ people: 'kaiju', bots: true, config: { bots: { kaijuHandicap: 1, humanHandicap: 0 } } });
    run(world, 1);
    const leader = world.units[world.squads[0].driven];
    // 40 m from the first squad's leader, toward the middle of the bounds, with nothing in the way.
    const d = Math.hypot(leader.x, leader.z);
    const id = layCrate(world, 'bigCannon', leader.x - (40 * leader.x) / d, leader.z - (40 * leader.z) / d);
    let took: SimEvent[] = [];
    for (let s = 0; s < 20 && took.length === 0; s++) {
      took = eventsOf(run(world, TICK_RATE), 'crate').filter((e) => e.phase === 'take' && e.id === id);
    }
    expect(took).toMatchObject([{ squad: 0 }]);
    expect(world.squads[0].pickup).toBe('bigCannon');
    expect(world.players[world.squads[0].player].botState.mode).not.toBe('crate');
    // Every input it sent stayed in range.
    expect(Math.abs(world.players[world.squads[0].player].botInput.aimPitch)).toBeLessThanOrEqual(MAX_AIM_PITCH);
  });
});
