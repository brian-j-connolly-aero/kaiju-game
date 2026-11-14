import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  COMBAT_RULES,
  decodeSnapshot,
  encodeSnapshot,
  markVeterans,
  snapshotOfWorld,
  UNIT_TYPES,
  type DamageKind,
  type PlayerInput,
  type SimEvent,
  type Unit,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run } from './helpers';

function field(): World {
  const world = makeTestWorld();
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -700, -700, 0);
  [0, 1, 2, 3].forEach((id) => placeUnit(world, id, id * 12, 0));
  return world;
}

function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [null, input(partial)]);
}

/** Queues a hit from the kaiju on a unit (it lands in this tick's damage system). */
function strike(world: World, id: number, damage: number, kind: DamageKind = 'swipe'): void {
  world.hits.push({
    target: { entity: 'unit', id },
    hit: { damage, nerve: 0, fromDir: { x: 0, z: 1 }, sourceId: 0, player: KAIJU_PLAYER, kind, atWill: false },
  });
}

describe('unit damage and losses', () => {
  it('loses members as hp drops, and with them firepower', () => {
    const world = field();
    const leader = world.units[0];
    strike(world, 0, 45);
    const events = lead(world, 1);
    expect(leader.hp).toBe(55);
    expect(leader.members).toBe(6);
    expect(eventsOf(events, 'memberLost')).toMatchObject([{ unit: 0, count: 4, members: 6 }]);
    expect(eventsOf(events, 'unitHit')).toMatchObject([{ unit: 0, damage: 45, hp: 55, cause: 'swipe' }]);
    // Six soldiers carry two launchers.
    expect(eventsOf(lead(world, 1, { buttons: Btn.fire }), 'projectileSpawn').length).toBe(2);
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.units[0]).toMatchObject({ hp: 55, members: 6, alive: true });
  });

  it('destroys a unit at 0 hp: it stops acting, and its squad mates are rattled', () => {
    const world = field();
    const [, a, b] = [0, 1, 2].map((id) => world.units[id]);
    strike(world, 1, 500);
    const events = lead(world, 1);
    expect(eventsOf(events, 'unitDestroyed')).toMatchObject([{ unit: 1, squad: 0, unitType: 'army_rocket_infantry', cause: 'swipe', by: KAIJU_PLAYER }]);
    expect(a).toMatchObject({ alive: false, hp: 0, members: 0, state: 'dead', wreck: false });
    expect(b.nerve).toBeGreaterThan(0);
    expect(world.players[HUMAN_PLAYER].tally.unitsLost).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.kills).toBe(1);
    // The dead do nothing: nothing moves it, plants it or fires it.
    lead(world, 30, { buttons: Btn.fire | Btn.volley });
    expect(a).toMatchObject({ alive: false, rooted: false, charge: 0, state: 'dead', x: 12, z: 0 });
    expect(b.rooted).toBe(true);
  });
});

describe('lives: the squad is the life pool', () => {
  it('hands the player the nearest surviving unit when the driven one dies', () => {
    const world = field();
    const [leader, a, b, c] = [0, 1, 2, 3].map((id) => world.units[id]);
    lead(world, 120, { buttons: Btn.volley });
    expect(a.charge).toBeGreaterThan(COMBAT_RULES.volleyMinCharge);

    strike(world, 0, 500, 'stomp');
    let events = lead(world, 1, { moveZ: 1, buttons: Btn.volley });
    expect(leader.alive).toBe(false);
    expect(world.squads[0].driven).toBe(0);
    expect(world.squads[0].eliminated).toBe(false);

    // The next tick the player is in the unit that stood closest.
    events = lead(world, 1, { moveZ: 1, buttons: Btn.fire | Btn.volley });
    expect(eventsOf(events, 'takeover')).toMatchObject([{ player: HUMAN_PLAYER, squad: 0, fromUnit: 0, toUnit: 1 }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('player.takeover');
    expect(world.squads[0].driven).toBe(1);
    // It was planted and charging a moment ago: now it is the player's, free to move, with no charge.
    expect(a).toMatchObject({ rooted: false, charge: 0 });
    expect(a.state).not.toBe('charging');
    // The stick and trigger that were held for the dead unit do not act in the tick of the switch.
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    expect([a.x, a.z]).toEqual([12, 0]);

    // From then on it obeys the player, and the two that are left still charge for its volley.
    events = lead(world, 30, { moveZ: 1, aimYaw: 0, buttons: Btn.volley });
    expect(a.z).toBeGreaterThan(3);
    events = lead(world, 1, { aimYaw: 0 });
    expect(eventsOf(events, 'volley')).toMatchObject([{ squad: 0, units: [2, 3] }]);
    expect(b.alive && c.alive).toBe(true);
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.squads[0].driven).toBe(1);
    expect(snap.units[1].driven).toBe(true);
    expect(snap.units[0]).toMatchObject({ alive: false, driven: false });
  });

  it('picks the nearest survivor, not the next slot', () => {
    const world = field();
    placeUnit(world, 1, 200, 0);
    placeUnit(world, 2, 100, 0);
    placeUnit(world, 3, 30, 40);
    strike(world, 0, 500);
    const events = lead(world, 2);
    expect(eventsOf(events, 'takeover')).toMatchObject([{ fromUnit: 0, toUnit: 3 }]);
    // Lose that one too: the next nearest to where it fell.
    strike(world, 3, 500);
    expect(eventsOf(lead(world, 2), 'takeover')).toMatchObject([{ fromUnit: 3, toUnit: 2 }]);
  });

  it('puts the player out when all four are gone, until the next stage', () => {
    const world = field();
    for (const id of [0, 1, 2, 3]) strike(world, id, 500);
    let events = lead(world, 1);
    const squad = world.squads[0];
    expect(squad.eliminated).toBe(true);
    expect(squad.driven).toBe(-1);
    expect(eventsOf(events, 'unitDestroyed').length).toBe(4);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('squad.wiped');
    expect(eventsOf(events, 'takeover')).toEqual([]);

    // Out: sticks and buttons do nothing.
    events = lead(world, 60, { moveZ: 1, buttons: Btn.fire | Btn.volley });
    events.push(...lead(world, 1));
    expect(eventsOf(events, 'projectileSpawn').filter((e) => e.player === HUMAN_PLAYER)).toEqual([]);
    expect(eventsOf(events, 'takeover')).toEqual([]);
    expect(world.units[0]).toMatchObject({ alive: false, x: 0, z: 0 });
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.squads[0]).toMatchObject({ eliminated: true, driven: -1 });
    // The other squads play on.
    expect(world.squads[1].eliminated).toBe(false);

    // The molt brings everybody back, fresh, at the new level.
    beginStage(world, 2);
    expect(squad).toMatchObject({ eliminated: false, driven: 0, level: 2 });
    for (const id of squad.units) expect(world.units[id]).toMatchObject({ alive: true, type: 'army_tank', hp: UNIT_TYPES.army_tank.hp, rooted: false });
    world.match.bounds = world.match.stageBounds[2];
    const leader = world.units[0];
    const z = leader.z;
    // A tank now: the throttle drives it along its hull.
    lead(world, 30, { moveZ: 1, aimYaw: leader.yaw });
    expect(Math.hypot(leader.vx, leader.vz)).toBeGreaterThan(5);
    expect(leader.z).not.toBe(z);
  });

  it('leaves a wreck where a vehicle dies, and the squad drives on', () => {
    const world = makeTestWorld();
    beginStage(world, 2);
    world.match.bounds = world.match.stageBounds[2];
    parkUnits(world);
    placeKaiju(world, -700, -700, 0);
    [0, 1, 2, 3].forEach((id) => placeUnit(world, id, id * 14, 0));
    strike(world, 0, 500);
    const events = lead(world, 2);
    expect(world.units[0]).toMatchObject({ alive: false, wreck: true });
    expect(eventsOf(events, 'takeover')).toMatchObject([{ toUnit: 1 }]);
  });
});

describe('veterans', () => {
  function unit(world: World, id: number): Unit {
    return world.units[id];
  }

  it('marks every unit that lives through a stage; the dead come back green', () => {
    const world = field();
    strike(world, 2, 500);
    strike(world, 5, 500);
    lead(world, 2);
    expect(world.units.every((u) => !u.veteran)).toBe(true);

    markVeterans(world);
    expect(world.squads[0].veteranSlots).toEqual([true, true, false, true]);
    expect(world.squads[1].veteranSlots).toEqual([true, false, true, true]);
    beginStage(world, 2);
    expect([0, 1, 2, 3].map((id) => unit(world, id).veteran)).toEqual([true, true, false, true]);
    expect([4, 5, 6, 7].map((id) => unit(world, id).veteran)).toEqual([true, false, true, true]);
    // The chevron is in the snapshot.
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.units.slice(0, 4).map((u) => u.veteran)).toEqual([true, true, false, true]);

    // A veteran that falls in the next stage is replaced by a green unit; survivors keep the mark.
    world.match.bounds = world.match.stageBounds[2];
    strike(world, 1, 5000);
    lead(world, 2);
    markVeterans(world);
    beginStage(world, 3);
    expect([0, 1, 2, 3].map((id) => unit(world, id).veteran)).toEqual([true, false, true, true]);
  });
});
