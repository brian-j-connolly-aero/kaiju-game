/**
 * The city as a weapon (docs/ROADMAP.md phase 2; DESIGN.md section 4, "The city as a weapon";
 * sim/cityWeapons.ts): what the hatchling can pick up, and what each object does in its hand.
 */

import { describe, expect, it } from 'vitest';
import {
  armHeld,
  beginStage,
  bitGet,
  Btn,
  LIZARD,
  spawnProjectile,
  TICK_RATE,
  type PlayerInput,
  type PropKindId,
  type SimEvent,
  type StageId,
  type World,
} from '../src/index';
import { eventsOf, holdFire, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const W = LIZARD.cityWeapons;
const R = LIZARD.stages[0].bodyRadius;
const ST = LIZARD.stages[0];

/** A world with the kaiju at the origin facing +Z, every unit parked far away and holding fire. */
function arena(options: TestWorldOptions = {}, stage: StageId = 1): World {
  const world = makeTestWorld(options);
  if (stage > 1) beginStage(world, stage);
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  holdFire(world);
  return world;
}

function play(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [input(partial)]);
}

function tap(world: World, button: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return [...play(world, 2, { ...partial, buttons: button }), ...play(world, 1, partial)];
}

/** Steps until the kaiju is idle again. */
function untilIdle(world: World, partial: Partial<PlayerInput> = {}, max = 300): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < max && world.kaijus[0].phase !== 'idle'; i++) events.push(...play(world, 1, partial));
  expect(world.kaijus[0].phase).toBe('idle');
  return events;
}

/** Puts a city weapon straight into the kaiju's hand, as a grab would. */
function hold(world: World, prop: PropKindId): void {
  const k = world.kaijus[0];
  k.held = { kind: 'prop', prop };
  armHeld(k);
}

/** A unit standing still with plenty of hp, so a test can read damage off it. */
function target(world: World, id: number, x: number, z: number, hp = 10000): World['units'][number] {
  const u = placeUnit(world, id, x, z);
  u.hp = hp;
  u.maxHp = hp;
  return u;
}

/** The pitch that puts the crosshair (from the eye) on the ground `d` meters ahead of the body's axis. */
function pitchToGround(d: number): number {
  return -Math.atan2(ST.eyeHeight, d - ST.eyeForward);
}

describe('picking them up', () => {
  it('the hatchling picks a propane tank up and its feet spare it; a juvenile cannot pick one up and crushes it, with a small bang', () => {
    const world = arena({ props: [{ kind: 'propane', x: 0, z: 0 }, { kind: 'propane', x: 0, z: R + 2.5 }] });
    const k = world.kaijus[0];
    // Standing right on the first one: the hatchling does not crush it.
    play(world, 10);
    expect(bitGet(world.propAlive, 0)).toBe(true);
    // Both are in reach of the hand: the nearer (the one underfoot) comes first.
    const events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(k.held).toEqual({ kind: 'prop', prop: 'propane' });
    expect(eventsOf(events, 'kaijuHeld')[0]).toMatchObject({ reason: 'grab', source: 'prop', sourceId: 0 });
    expect(bitGet(world.propAlive, 1)).toBe(true);

    const big = arena({ props: [{ kind: 'propane', x: 0, z: 0 }] }, 2);
    const blasts = play(big, 2);
    expect(bitGet(big.propAlive, 0)).toBe(false);
    expect(eventsOf(blasts, 'propaneBlast')).toEqual([expect.objectContaining({ how: 'crushed', radius: W.propane.small.radius, prop: 0 })]);
    // ...and nothing is left to pick up.
    tap(big, Btn.grab);
    untilIdle(big);
    expect(big.kaijus[0].held).toBeNull();
  });

  it('is never eaten: Grab drops it, it lies loose, and it can be picked up again', () => {
    const world = arena();
    const k = world.kaijus[0];
    hold(world, 'watertank');
    k.hp = 500;
    const dropped = tap(world, Btn.grab);
    expect(k.held).toBeNull();
    expect(k.hp).toBe(500);
    expect(eventsOf(dropped, 'kaijuAction')).toEqual([]);
    const down = eventsOf(dropped, 'looseProp');
    expect(down).toEqual([expect.objectContaining({ id: 0, prop: 'watertank', state: 'down', cause: 'drop' })]);
    expect(Math.hypot(down[0].x, down[0].z - R * 0.6)).toBeLessThan(1e-6);
    // Picked up again off the ground.
    play(world, 8);
    const again = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(k.held).toEqual({ kind: 'prop', prop: 'watertank' });
    expect(eventsOf(again, 'kaijuHeld')[0]).toMatchObject({ reason: 'grab', source: 'loose', sourceId: 0 });
    expect(world.loose[0].state).toBe('gone');
  });
});

describe('the propane tank', () => {
  /** A rocket fired from in front of the kaiju, level, at `height`, toward -Z along x = `x`, with no damage of its own. */
  function rocketAt(world: World, x: number, height: number, z = 30): void {
    spawnProjectile(world, {
      type: 'rocket',
      flight: 'flat',
      owner: 'unit',
      ownerId: 0,
      player: world.squads[0].player,
      x,
      y: height,
      z,
      vx: 0,
      vy: 0,
      vz: -55,
      gravity: 0,
      ttl: 3,
      damage: 0,
      nerve: 0,
      splash: 0.5,
      structureDamage: 0,
      cause: 'rocket',
      volley: false,
      atWill: false,
      payload: null,
    });
  }

  it('in the hand, a shot landing beside it sets it off: the hand is empty, the kaiju loses its hand damage exactly and flinches', () => {
    const world = arena();
    const k = world.kaijus[0];
    hold(world, 'propane');
    // Units standing round the kaiju take the blast.
    const near = target(world, 1, 0, R + 4);
    rocketAt(world, 0, ST.handHeight);
    // It flies 30 m at 55 m/s.
    const events = play(world, 20);
    expect(eventsOf(events, 'propaneBlast')).toEqual([expect.objectContaining({ how: 'hand', kaiju: 0, radius: W.propane.radius })]);
    expect(eventsOf(events, 'kaijuFlinch')).toEqual([expect.objectContaining({ kaiju: 0, duration: W.propane.flinch })]);
    expect(k.held).toBeNull();
    expect(k.hp).toBeCloseTo(LIZARD.hp - W.propane.handDamage, 6);
    expect(near.hp).toBeLessThan(10000 - W.propane.unitDamageEdge);
    // Rooted while it flinches, back to normal after.
    expect(k.phase).toBe('flinch');
    play(world, Math.ceil(W.propane.flinch * TICK_RATE));
    expect(k.phase).toBe('idle');
  });

  it('a shot that lands farther from the hand than the detonation distance does nothing to it', () => {
    const world = arena();
    hold(world, 'propane');
    // Into the body, but on the far side from the hand (the head leans right, the shot comes in left, low).
    rocketAt(world, -R + 0.3, 0.5);
    const events = play(world, 20);
    expect(eventsOf(events, 'projectileHit')).toHaveLength(1);
    expect(eventsOf(events, 'propaneBlast')).toEqual([]);
    expect(world.kaijus[0].held).toEqual({ kind: 'prop', prop: 'propane' });
  });

  it('on the ground, a shot landing within the detonation distance sets it off: units round it are hit and thrown', () => {
    const world = arena({ props: [{ kind: 'propane', x: 30, z: 0 }] });
    const u = target(world, 1, 34, 0);
    // A shell coming down 1.5 m short of the tank.
    spawnProjectile(world, {
      type: 'rocket',
      flight: 'flat',
      owner: 'unit',
      ownerId: 0,
      player: world.squads[0].player,
      x: 28.5,
      y: 5,
      z: 0,
      vx: 0,
      vy: -40,
      vz: 0,
      gravity: 0,
      ttl: 3,
      damage: 0,
      nerve: 0,
      splash: 0.5,
      structureDamage: 0,
      cause: 'rocket',
      volley: false,
      atWill: false,
      payload: null,
    });
    const events = play(world, 8);
    expect(eventsOf(events, 'propaneBlast')).toEqual([expect.objectContaining({ how: 'ground', prop: 0, radius: W.propane.radius })]);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    // 4 m from the middle, its own 3 m radius: 1 m in, an eighth of the way to the rim.
    const t = (4 - u.radius) / W.propane.radius;
    expect(10000 - u.hp).toBeCloseTo(W.propane.unitDamageCenter + (W.propane.unitDamageEdge - W.propane.unitDamageCenter) * t, 4);
    expect(u.vx).toBeGreaterThan(0);
    // The kaiju, 30 m away, is untouched.
    expect(world.kaijus[0].hp).toBe(LIZARD.hp);
  });

  it('thrown, it explodes where it lands and never hurts its thrower', () => {
    const world = arena();
    const k = world.kaijus[0];
    hold(world, 'propane');
    const u = target(world, 1, 0, 14);
    const events = tap(world, Btn.strike, { aimPitch: pitchToGround(14) });
    events.push(...untilIdle(world, { aimPitch: pitchToGround(14) }), ...play(world, 60));
    expect(eventsOf(events, 'kaijuAction')[0]).toMatchObject({ action: 'throw', phase: 'windup' });
    const blasts = eventsOf(events, 'propaneBlast');
    expect(blasts).toEqual([expect.objectContaining({ how: 'thrown', radius: W.propane.radius })]);
    // On the unit it was thrown at (it struck the near side of the section of soldiers).
    expect(Math.hypot(blasts[0].x - 0, blasts[0].z - 14)).toBeLessThan(u.radius + 1.5);
    expect(10000 - u.hp).toBeGreaterThan(W.propane.unitDamageEdge);
    expect(k.hp).toBe(LIZARD.hp);
  });
});

describe('the water tank', () => {
  it('thrown, it bursts into a splash that knocks units over (stunned, lying flat) and pushes them out', () => {
    const world = arena();
    hold(world, 'watertank');
    const u = target(world, 1, 1.5, 14);
    const events = tap(world, Btn.strike, { aimPitch: pitchToGround(14) });
    for (let i = 0; i < 90 && eventsOf(events, 'waterSplash').length === 0; i++) events.push(...play(world, 1, { aimPitch: pitchToGround(14) }));
    events.push(...play(world, 1));
    expect(eventsOf(events, 'waterSplash')).toEqual([expect.objectContaining({ radius: W.watertank.radius })]);
    expect(eventsOf(events, 'unitStunned')).toEqual([expect.objectContaining({ unit: 1, duration: W.watertank.knockdown, knockdown: true })]);
    expect(u.stun).toBeGreaterThan(W.watertank.knockdown - 0.2);
    expect(10000 - u.hp).toBeCloseTo(W.watertank.unitDamageCenter, 4);
    // Pushed away from where it burst (it landed about at the unit's feet, a little to the left of it).
    expect(Math.hypot(u.vx, u.vz)).toBeGreaterThan(1);
    // Nothing burns.
    expect(eventsOf(events, 'propaneBlast')).toEqual([]);
  });
});

describe('the javelins', () => {
  it('a thrown antenna flies straight through three units and stops in the building behind them', () => {
    const world = arena({ structures: [{ x: 0, z: 50, w: 20, d: 10, height: 8, hp: 1000 }] });
    const line = [10, 13, 16, 19].map((z, i) => target(world, i + 1, 0, z));
    hold(world, 'antenna');
    // The crosshair on the foot of the building's face, 45 m out.
    const pitch = -Math.atan2(ST.eyeHeight - 1, 45 - ST.eyeForward);
    const events = tap(world, Btn.strike, { aimPitch: pitch });
    for (let i = 0; i < 60 && eventsOf(events, 'projectileHit').length === 0; i++) events.push(...play(world, 1, { aimPitch: pitch }));
    events.push(...play(world, 1));
    const hits = eventsOf(events, 'javelinHit');
    expect(hits.map((h) => h.unit)).toEqual([1, 2, 3]);
    for (const h of hits) expect(h).toMatchObject({ prop: 'antenna', damage: W.antenna.unitDamage });
    for (let i = 0; i < 3; i++) expect(10000 - line[i].hp).toBeCloseTo(W.antenna.unitDamage, 6);
    expect(line[3].hp).toBe(10000);
    expect(eventsOf(events, 'projectileHit')).toEqual([expect.objectContaining({ target: 'structure', targetId: 0 })]);
    expect(world.structureHp[0]).toBeCloseTo(1000 - W.antenna.structureDamage, 4);
    // It flew nearly flat and fast: well under a second to 45 m.
    const spawn = eventsOf(events, 'projectileSpawn')[0];
    expect(Math.hypot(spawn.vx, spawn.vy, spawn.vz)).toBeCloseTo(W.antenna.speed, 6);
    expect(spawn.gravity).toBe(W.antenna.gravity);
  });
});

describe('the fast-food sign', () => {
  it('Strike swings it as a club: a wide, hard blow; it breaks after its third swing, and Strike swipes again', () => {
    const world = arena();
    const k = world.kaijus[0];
    hold(world, 'foodsign');
    expect(k.clubSwings).toBe(LIZARD.actions.club.swings);
    const swings: number[] = [];
    let first = 0;
    for (let swing = 0; swing < 3; swing++) {
      // A unit beside the kaiju, 60 degrees off its aim: inside the club's wide arc, outside a swipe's.
      const u = target(world, 1, Math.sin(Math.PI / 3) * 7, Math.cos(Math.PI / 3) * 7);
      const events = [...tap(world, Btn.strike), ...untilIdle(world)];
      expect(eventsOf(events, 'kaijuAction')[0]).toMatchObject({ action: 'club', phase: 'windup', duration: LIZARD.actions.club.timing.windup });
      const swing1 = eventsOf(events, 'clubSwing');
      expect(swing1).toHaveLength(1);
      expect(swing1[0].units).toBe(1);
      swings.push(swing1[0].swingsLeft);
      if (swing === 0) {
        first = 10000 - u.hp;
        expect(eventsOf(events, 'signBroken')).toEqual([]);
      } else if (swing === 2) {
        expect(eventsOf(events, 'signBroken')).toHaveLength(1);
      }
    }
    expect(first).toBeCloseTo(LIZARD.actions.club.unitDamage, 6);
    expect(swings).toEqual([2, 1, 0]);
    expect(k.held).toBeNull();
    expect(k.clubSwings).toBe(0);
    const after = tap(world, Btn.strike);
    expect(eventsOf(after, 'kaijuAction')[0]).toMatchObject({ action: 'swipe' });
  });
});

describe('the garage door', () => {
  function shot(world: World, fromX: number, fromZ: number, damage: number): SimEvent[] {
    world.hits.push({
      target: { entity: 'kaiju', id: 0 },
      hit: { damage, nerve: 20, fromDir: { x: fromX, z: fromZ }, sourceId: 1, player: world.squads[0].player, kind: 'rocket', atWill: false },
    });
    return play(world, 1);
  }

  it('held, it takes the hits that come from the front instead of the kaiju until its hp runs out; hits from behind still land', () => {
    const world = arena();
    const k = world.kaijus[0];
    hold(world, 'garagedoor');
    expect(k.shieldHp).toBe(W.garagedoor.hp);

    // From straight ahead, and from 60 degrees off: the door.
    let events = shot(world, 0, 1, 100);
    events.push(...shot(world, Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 50));
    expect(k.hp).toBe(LIZARD.hp);
    expect(k.nerve).toBe(0);
    expect(eventsOf(events, 'shieldHit').map((e) => e.hpLeft)).toEqual([W.garagedoor.hp - 100, W.garagedoor.hp - 150]);
    expect(eventsOf(events, 'kaijuHit')).toEqual([]);

    // From behind, and from 90 degrees off: the kaiju.
    events = shot(world, 0, -1, 100);
    events.push(...shot(world, 1, 0, 100));
    expect(k.hp).toBeLessThan(LIZARD.hp);
    expect(eventsOf(events, 'shieldHit')).toEqual([]);
    expect(eventsOf(events, 'kaijuHit')).toHaveLength(2);
    expect(k.shieldHp).toBe(W.garagedoor.hp - 150);

    // The rest of its hp and it breaks; the next hit from the front lands.
    events = shot(world, 0, 1, 500);
    expect(eventsOf(events, 'shieldBroken')).toHaveLength(1);
    expect(k.held).toBeNull();
    const before = k.hp;
    shot(world, 0, 1, 100);
    expect(k.hp).toBeLessThan(before);
  });

  it('thrown, it flies flat and knocks over the unit it lands on', () => {
    const world = arena();
    hold(world, 'garagedoor');
    const u = target(world, 1, 0, 16);
    const events = tap(world, Btn.strike, { aimPitch: pitchToGround(16) });
    for (let i = 0; i < 90 && eventsOf(events, 'projectileHit').length === 0; i++) events.push(...play(world, 1, { aimPitch: pitchToGround(16) }));
    events.push(...play(world, 1));
    const spawn = eventsOf(events, 'projectileSpawn')[0];
    expect(spawn.payload).toEqual({ kind: 'prop', prop: 'garagedoor' });
    expect(spawn.gravity).toBe(W.garagedoor.throw.gravity);
    expect(eventsOf(events, 'unitStunned')).toEqual([expect.objectContaining({ unit: 1, knockdown: true })]);
    expect(10000 - u.hp).toBeCloseTo(W.garagedoor.throw.unitDamageCenter, 4);
  });
});
