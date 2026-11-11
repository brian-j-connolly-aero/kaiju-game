import { describe, expect, it } from 'vitest';
import {
  applyHit,
  beginStage,
  bitGet,
  Btn,
  COMBAT_RULES,
  DEG,
  DT,
  INPUT_BUFFER_TICKS,
  LIZARD,
  MATCH_RULES,
  PROP_KINDS,
  TICK_RATE,
  type KaijuActionEvent,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type World,
} from '../src/index';
import { eventsOf, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const A = LIZARD.actions;

/** Ticks a phase of `seconds` lasts: it ends on the first tick at which the time has fully passed. */
function ticksFor(seconds: number): number {
  return Math.ceil(seconds * TICK_RATE - 1e-6);
}

/** Body radius of the lizard at a stage. */
function radius(stage: StageId): number {
  return LIZARD.stages[stage - 1].bodyRadius;
}

/** A world with the kaiju at the origin facing +Z, every unit parked far away, at the given stage. */
function arena(options: TestWorldOptions = {}, stage: StageId = 1): World {
  const world = makeTestWorld(options);
  if (stage > 1) beginStage(world, stage);
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  return world;
}

/** Steps with the kaiju player's input for `ticks` ticks. */
function play(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [input(partial)]);
}

/** Presses a button for a couple of ticks and lets go: a tap. */
function tap(world: World, button: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return [...play(world, 2, { ...partial, buttons: button }), ...play(world, 1, partial)];
}

/** Steps until the kaiju is idle again (at most `max` ticks). */
function untilIdle(world: World, partial: Partial<PlayerInput> = {}, max = 400): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < max && world.kaijus[0].phase !== 'idle'; i++) events.push(...play(world, 1, partial));
  expect(world.kaijus[0].phase).toBe('idle');
  return events;
}

function actions(events: SimEvent[]): Array<[KaijuActionEvent['action'], KaijuActionEvent['phase']]> {
  return eventsOf(events, 'kaijuAction').map((e) => [e.action, e.phase]);
}

/** The hatchling's body radius, and spots in front of it that depend on it rather than on today's numbers. */
const R = radius(1);
/** A prop of this kind standing just clear of the hatchling's feet (so it is not crushed), inside its reach. */
function clearOf(kind: keyof typeof PROP_KINDS, gap = 0.9): number {
  return R + PROP_KINDS[kind].radius + gap;
}

/** Gives a unit plenty of hp so a test can read damage numbers off it without killing it. */
function toughen(world: World, id: number, hp = 10000): void {
  world.units[id].hp = hp;
  world.units[id].maxHp = hp;
}

describe('swipe', () => {
  it('telegraphs with a wind-up, hits the arc once, recovers, in the times from the definition', () => {
    const world = arena({
      structures: [
        // In front, inside the reach.
        { x: 0, z: radius(1) * A.swipe.reach + 3, w: 8, d: 8, height: 6, hp: 1000 },
        // Behind and to the side: inside the reach but outside the arc.
        { x: 6.06, z: -3.5, w: 4, d: 4, height: 6, hp: 1000 },
      ],
    });
    const k = world.kaijus[0];
    const front = placeUnit(world, 0, 0, 5);
    const behind = placeUnit(world, 1, 0, -5);
    toughen(world, 0);
    toughen(world, 1);

    const timeline: Array<{ step: number; action: string; phase: string; duration: number }> = [];
    let hitStep = -1;
    for (let step = 1; step <= 60; step++) {
      const events = play(world, 1, { buttons: step <= 2 ? Btn.strike : 0 });
      for (const e of eventsOf(events, 'kaijuAction')) timeline.push({ step, action: e.action, phase: e.phase, duration: e.duration });
      if (hitStep < 0 && front.hp < front.maxHp) hitStep = step;
    }
    const windup = ticksFor(A.swipe.timing.windup);
    const active = ticksFor(A.swipe.timing.active);
    const recover = ticksFor(A.swipe.timing.recover);
    expect(timeline).toEqual([
      { step: 1, action: 'swipe', phase: 'windup', duration: A.swipe.timing.windup },
      { step: 1 + windup, action: 'swipe', phase: 'active', duration: A.swipe.timing.active },
      { step: 1 + windup + active, action: 'swipe', phase: 'recover', duration: A.swipe.timing.recover },
      { step: 1 + windup + active + recover, action: 'swipe', phase: 'idle', duration: 0 },
    ]);
    // Nothing lands before the wind-up is over: that is the tell.
    expect(hitStep).toBe(1 + windup);
    expect(k.phase).toBe('idle');
    expect(k.action).toBe('none');

    expect(front.maxHp - front.hp).toBe(A.swipe.unitDamage);
    expect(behind.hp).toBe(behind.maxHp);
    expect(world.structureHp[0]).toBe(1000 - A.swipe.structureDamage[0]);
    expect(world.structureHp[1]).toBe(1000);
  });

  it('hits harder against structures at each stage, and reaches in body radii', () => {
    for (const stage of [1, 2, 3] as const) {
      const r = radius(stage);
      const reach = r * A.swipe.reach;
      const world = arena(
        {
          structures: [
            { x: 0, z: reach - 1 + 10, w: 20, d: 20, height: 200, hp: 1e6 },
            { x: 0, z: -(reach + 1 + 10), w: 20, d: 20, height: 200, hp: 1e6 },
          ],
        },
        stage,
      );
      tap(world, Btn.strike);
      untilIdle(world);
      expect(1e6 - world.structureHp[0]).toBeCloseTo(A.swipe.structureDamage[stage - 1], 0);
      expect(world.structureHp[1]).toBe(1e6);
    }
    expect(A.swipe.structureDamage[0]).toBeLessThan(A.swipe.structureDamage[1]);
    expect(A.swipe.structureDamage[1]).toBeLessThan(A.swipe.structureDamage[2]);
  });

  it('shakes a unit with its nerve damage and crushes props in the arc', () => {
    const world = arena({ props: [{ kind: 'kiosk', x: 0, z: 5 }, { kind: 'kiosk', x: 0, z: -5 }] });
    const u = placeUnit(world, 0, 3, 4);
    toughen(world, 0);
    const events = [...tap(world, Btn.strike), ...untilIdle(world)];
    expect(u.nerve).toBeGreaterThan(0);
    expect(u.nerve).toBeLessThanOrEqual(A.swipe.unitNerve);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(bitGet(world.propAlive, 1)).toBe(true);
    expect(eventsOf(events, 'propsDestroyed')).toMatchObject([{ ids: [0], by: KAIJU_PLAYER, cause: 'swipe' }]);
  });

  it('is committed: other buttons during the wind-up do not cancel or replace it', () => {
    const world = arena();
    const k = world.kaijus[0];
    play(world, 2, { buttons: Btn.strike });
    const events = [...play(world, 3, { buttons: Btn.roar | Btn.block | Btn.grab }), ...untilIdle(world)];
    expect(actions(events)).toEqual([
      ['swipe', 'active'],
      ['swipe', 'recover'],
      ['swipe', 'idle'],
    ]);
    expect(k.cooldowns.roar).toBe(0);
  });

  it('remembers a press made just before the kaiju is free, and forgets an older one', () => {
    const total = ticksFor(A.swipe.timing.windup) + ticksFor(A.swipe.timing.active) + ticksFor(A.swipe.timing.recover);

    // Pressed INPUT_BUFFER_TICKS before the end: the next swipe starts on the tick the first ends.
    let world = arena();
    play(world, 1, { buttons: Btn.strike });
    play(world, total - 1 - INPUT_BUFFER_TICKS);
    play(world, 1, { buttons: Btn.strike });
    let events = play(world, INPUT_BUFFER_TICKS);
    expect(actions(events)).toEqual([
      ['swipe', 'idle'],
      ['swipe', 'windup'],
    ]);

    // Pressed one tick earlier than that: forgotten.
    world = arena();
    play(world, 1, { buttons: Btn.strike });
    play(world, total - 2 - INPUT_BUFFER_TICKS);
    play(world, 1, { buttons: Btn.strike });
    events = play(world, INPUT_BUFFER_TICKS + 5);
    expect(actions(events)).toEqual([['swipe', 'idle']]);
    expect(world.kaijus[0].phase).toBe('idle');
  });
});

describe('stomp: strike held', () => {
  it('turns the swipe into a stomp when strike is still down at the hold time, keeping the elapsed time', () => {
    const hold = ticksFor(A.stomp.holdTime);

    // Released one tick too early: it stays a swipe.
    let world = arena();
    let events = [...play(world, hold, { buttons: Btn.strike }), ...untilIdle(world)];
    expect(actions(events).map((a) => a[0])).not.toContain('stomp');
    expect(actions(events)[0]).toEqual(['swipe', 'windup']);

    // Still down on the tick the hold time has passed: a stomp.
    world = arena();
    const u = placeUnit(world, 0, 0, 4);
    toughen(world, 0);
    const timeline: Array<{ step: number; action: string; phase: string; elapsed: number | undefined }> = [];
    let hitStep = -1;
    for (let step = 1; step <= 90; step++) {
      const stepEvents = play(world, 1, { buttons: step <= hold + 1 ? Btn.strike : 0 });
      for (const e of eventsOf(stepEvents, 'kaijuAction')) timeline.push({ step, action: e.action, phase: e.phase, elapsed: e.elapsed });
      if (hitStep < 0 && u.hp < u.maxHp) hitStep = step;
    }
    const windup = ticksFor(A.stomp.timing.windup);
    expect(timeline.map((t) => [t.step, t.action, t.phase])).toEqual([
      [1, 'swipe', 'windup'],
      [1 + hold, 'stomp', 'windup'],
      // The stomp's wind-up counts from the press, not from the moment it became a stomp.
      [1 + windup, 'stomp', 'active'],
      [1 + windup + ticksFor(A.stomp.timing.active), 'stomp', 'recover'],
      [1 + windup + ticksFor(A.stomp.timing.active) + ticksFor(A.stomp.timing.recover), 'stomp', 'idle'],
    ]);
    expect(timeline[1].elapsed).toBeCloseTo(hold * DT, 6);
    expect(hitStep).toBe(1 + windup);
    // The state machine relies on the hold deciding before the swipe would land.
    expect(A.stomp.holdTime).toBeLessThan(A.swipe.timing.windup);
    expect(A.stomp.timing.windup).toBeGreaterThan(A.stomp.holdTime);
  });

  it('sends out a shockwave that falls off with distance and shoves units away', () => {
    const r = radius(1);
    const reach = r * A.stomp.radius;
    const world = arena({
      structures: [
        { x: 0, z: 4 + 2, w: 4, d: 4, height: 6, hp: 1000 },
        { x: reach - 1 + 2, z: 0, w: 4, d: 4, height: 6, hp: 1000 },
        { x: 0, z: -(reach + 1 + 2), w: 4, d: 4, height: 6, hp: 1000 },
      ],
      props: [{ kind: 'kiosk', x: -6, z: -4 }],
    });
    const k = world.kaijus[0];
    const near = placeUnit(world, 0, -3.5, 0);
    const far = placeUnit(world, 1, -(reach + 3 - 0.5), 0);
    const outside = placeUnit(world, 2, -(reach + 3 + 1), -1);
    for (const id of [0, 1, 2]) toughen(world, id);
    const farStart = Math.hypot(far.x, far.z);

    const events = [...play(world, ticksFor(A.stomp.timing.windup) + 1, { buttons: Btn.strike }), ...untilIdle(world)];
    expect(actions(events)).toContainEqual(['stomp', 'active']);

    // Units: full damage inside the body's reach, the edge value at the rim, nothing beyond.
    const nearT = Math.max(0, 3.5 - near.radius) / reach;
    expect(near.maxHp - near.hp).toBeCloseTo(A.stomp.unitDamageCenter + (A.stomp.unitDamageEdge - A.stomp.unitDamageCenter) * nearT, 6);
    const farLost = far.maxHp - far.hp;
    expect(farLost).toBeGreaterThanOrEqual(A.stomp.unitDamageEdge);
    expect(farLost).toBeLessThan(A.stomp.unitDamageEdge + 0.1 * (A.stomp.unitDamageCenter - A.stomp.unitDamageEdge));
    expect(outside.hp).toBe(outside.maxHp);
    expect(near.nerve).toBeGreaterThan(far.nerve);
    expect(far.nerve).toBeGreaterThan(0);

    // Knockback: the near unit is thrown outward, about the distance the definition says.
    const shove = A.stomp.knockback * r * (1 - nearT);
    const moved = Math.hypot(near.x, near.z) - 3.5;
    expect(moved).toBeGreaterThan(shove * 0.7);
    expect(moved).toBeLessThan(shove * 1.2);
    expect(near.x).toBeLessThan(-3.5);
    expect(Math.hypot(far.x, far.z)).toBeGreaterThanOrEqual(farStart);

    // Structures: more damage close to the body than at the rim, none outside.
    const lostNear = 1000 - world.structureHp[0];
    const lostRim = 1000 - world.structureHp[1];
    expect(lostNear).toBeCloseTo(A.stomp.structureDamage[0] * (1 + (A.stomp.structureEdgeFraction - 1) * (4 / reach)), 3);
    expect(lostRim).toBeGreaterThan(A.stomp.structureDamage[0] * A.stomp.structureEdgeFraction - 1e-6);
    expect(lostRim).toBeLessThan(lostNear);
    expect(world.structureHp[2]).toBe(1000);
    expect(bitGet(world.propAlive, 0)).toBe(false);

    // It is loud: a hatchling gives itself away. And it is rooted for the whole stomp.
    expect(k.x).toBe(0);
    expect(k.z).toBe(0);
  });

  it('roots the kaiju while it stomps', () => {
    const world = arena();
    const k = world.kaijus[0];
    play(world, ticksFor(A.stomp.holdTime) + 2, { buttons: Btn.strike, moveZ: 1 });
    expect(k.action).toBe('stomp');
    const z = k.z;
    play(world, 10, { moveZ: 1 });
    // It slides to a stop and stays put.
    expect(k.z - z).toBeLessThan(1);
    const z2 = k.z;
    play(world, 5, { moveZ: 1 });
    expect(k.z).toBe(z2);
  });
});

describe('grab and throw', () => {
  it('picks up the nearest car in the arc; the car leaves the city and counts for the bar', () => {
    const world = arena({
      props: [
        { kind: 'car_sedan', x: 0, z: clearOf('car_sedan') },
        { kind: 'car_van', x: 1, z: clearOf('car_van', 0.1) },
        { kind: 'bus', x: 0, z: -clearOf('bus', 0.6) },
      ],
    });
    const k = world.kaijus[0];
    let events = tap(world, Btn.grab);
    expect(actions(events)).toEqual([['grab', 'windup']]);
    expect(k.held).toBeNull();
    events = untilIdle(world);
    expect(actions(events)).toEqual([
      ['grab', 'active'],
      ['grab', 'idle'],
    ]);
    // The van is a little nearer than the sedan; the bus is behind.
    expect(k.held).toEqual({ kind: 'prop', prop: 'car_van' });
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([
      { kaiju: 0, held: { kind: 'prop', prop: 'car_van' }, reason: 'grab', source: 'prop', sourceId: 1 },
    ]);
    expect(bitGet(world.propAlive, 1)).toBe(false);
    expect(bitGet(world.propWreck, 1)).toBe(false);
    expect(bitGet(world.propAlive, 0)).toBe(true);
    // It is in the hand, so clients are not told it was destroyed where it stood.
    expect(eventsOf(events, 'propsDestroyed')).toEqual([]);
    expect(world.match.barPoints).toBe(PROP_KINDS.car_van.value);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.car).toBe(1);

    // The grab takes the time from the definition, and tapping does not throw what was just grabbed.
    play(world, 20);
    expect(k.held).not.toBeNull();
    expect(k.phase).toBe('idle');
  });

  it('whiffs when nothing is in reach, and takes a wreck off the ground', () => {
    let world = arena({ props: [{ kind: 'car_sedan', x: 0, z: R * A.grab.reach + 20 }, { kind: 'kiosk', x: 0, z: clearOf('kiosk', 0.6) }] });
    let events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(world.kaijus[0].held).toBeNull();
    expect(eventsOf(events, 'kaijuHeld')).toEqual([]);
    // A kiosk cannot be picked up.
    expect(bitGet(world.propAlive, 1)).toBe(true);

    // A car the kaiju stands on is crushed to a wreck, and the wreck can be picked up.
    world = arena({ props: [{ kind: 'car_taxi', x: 0, z: R }] });
    play(world, 1);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(bitGet(world.propWreck, 0)).toBe(true);
    events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(world.kaijus[0].held).toEqual({ kind: 'wreck', wreck: 'car' });
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ reason: 'grab', source: 'propWreck', sourceId: 0 }]);
    expect(bitGet(world.propWreck, 0)).toBe(false);
    // The wreck was already counted when the car was crushed.
    expect(world.match.barPoints).toBe(PROP_KINDS.car_taxi.value);
  });

  it('throws what it holds at the aim point: tap grab again, or strike', () => {
    for (const button of [Btn.grab, Btn.strike]) {
      const world = arena({
        props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }],
        structures: [{ x: 30, z: 0, w: 8, d: 8, height: 6, hp: 1000 }],
      });
      const k = world.kaijus[0];
      tap(world, Btn.grab);
      untilIdle(world);
      expect(k.held).not.toBeNull();

      // Look at a point on the ground 20 m ahead.
      const eye = LIZARD.stages[0].eyeHeight;
      const aim = { aimPitch: -Math.atan2(eye, 20) };
      let events = tap(world, button, aim);
      expect(actions(events)).toEqual([['throw', 'windup']]);
      events = [...events, ...play(world, 120, aim)];
      expect(actions(events)).toEqual([
        ['throw', 'windup'],
        ['throw', 'active'],
        ['throw', 'recover'],
        ['throw', 'idle'],
      ]);
      const spawn = eventsOf(events, 'projectileSpawn');
      expect(spawn).toMatchObject([
        { projectile: 'thrown', flight: 'thrown', owner: 'kaiju', ownerId: 0, player: KAIJU_PLAYER, payload: { kind: 'prop', prop: 'car_sedan' } },
      ]);
      expect(Math.hypot(spawn[0].vx, spawn[0].vy, spawn[0].vz)).toBeCloseTo(A.throw.speed[0], 6);
      expect(spawn[0].y).toBe(LIZARD.stages[0].handHeight);
      expect(k.held).toBeNull();
      expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ held: null, reason: 'throw', source: 'none', sourceId: -1 }]);

      // It lands where the kaiju was looking.
      const hit = eventsOf(events, 'projectileHit');
      expect(hit).toMatchObject([{ id: spawn[0].id, target: 'ground', splash: A.throw.impactRadius[0] }]);
      expect(hit[0].x).toBeCloseTo(0, 1);
      expect(hit[0].z).toBeCloseTo(20, 0);
      expect(world.projectiles).toEqual([]);
      // Strike with something in the hand is a throw, not a swipe.
      expect(actions(events).map((a) => a[0])).not.toContain('swipe');
    }
  });

  it('damages what the thrown object lands on: structures, and units in the impact radius', () => {
    const world = arena({
      props: [{ kind: 'bus', x: 0, z: clearOf('bus', 0.3) }],
      structures: [{ x: 0, z: 28, w: 10, d: 8, height: 8, hp: 1000 }],
    });
    const k = world.kaijus[0];
    // The wall is at z = 24. One unit stands inside the impact radius of its foot, one outside.
    const splash = A.throw.impactRadius[0];
    const close = placeUnit(world, 0, 5, 20);
    const away = placeUnit(world, 1, splash + 3 + 3, 20);
    expect(Math.hypot(5, 4) - close.radius).toBeLessThan(splash);
    toughen(world, 0);
    toughen(world, 1);
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).toEqual({ kind: 'prop', prop: 'bus' });

    // The crosshair is on the building's front wall, near its foot.
    const aim = { aimPitch: -Math.atan2(LIZARD.stages[0].eyeHeight - 1, 24) };
    const events = [...tap(world, Btn.grab, aim), ...play(world, 90, aim)];
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'structure', targetId: 0 }]);
    expect(1000 - world.structureHp[0]).toBe(A.throw.structureDamage[0]);
    expect(close.maxHp - close.hp).toBe(A.throw.unitDamage);
    expect(close.nerve).toBeGreaterThan(0);
    expect(away.hp).toBe(away.maxHp);
    expect(world.players[KAIJU_PLAYER].tally.barPoints).toBeGreaterThan(PROP_KINDS.bus.value);
  });

  it('lifts a live vehicle from stage 2 on (the tank is gone, no wreck), but not at stage 1', () => {
    // Stage 1: even a tank standing right there cannot be lifted.
    let world = arena();
    world.units[4].type = 'army_tank';
    placeUnit(world, 4, 0, 5);
    tap(world, Btn.grab);
    untilIdle(world);
    expect(world.kaijus[0].held).toBeNull();
    expect(world.units[4].alive).toBe(true);
    expect(A.grab.vehicleFromStage).toBe(2);

    world = arena({}, 2);
    const k = world.kaijus[0];
    const tank = placeUnit(world, 4, 0, radius(2) * A.grab.reach - 2);
    const events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(k.held).toEqual({ kind: 'vehicle', unitType: 'army_tank' });
    expect(tank.alive).toBe(false);
    expect(tank.wreck).toBe(false);
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ reason: 'grab', source: 'unit', sourceId: 4 }]);
    expect(eventsOf(events, 'unitDestroyed')).toMatchObject([{ unit: 4, by: KAIJU_PLAYER }]);
    expect(world.players[KAIJU_PLAYER].tally.kills).toBe(1);
  });

  it('takes one tank out of a troop, and picks up a dead tank\'s wreck', () => {
    const world = arena({}, 3);
    const k = world.kaijus[0];
    const troop = placeUnit(world, 4, 0, 50);
    const members = troop.members;
    expect(members).toBeGreaterThan(1);
    let events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(k.held).toEqual({ kind: 'vehicle', unitType: troop.type });
    expect(troop.alive).toBe(true);
    expect(troop.members).toBe(members - 1);
    expect(troop.hp).toBeCloseTo((troop.maxHp * (members - 1)) / members, 3);
    expect(eventsOf(events, 'memberLost')).toMatchObject([{ unit: 4, count: 1, members: members - 1 }]);

    // Throw it away, kill the rest of the troop, and pick up the wreck it leaves.
    tap(world, Btn.strike, { aimPitch: -0.5 });
    untilIdle(world, { aimPitch: -0.5 });
    applyHit(world, { entity: 'unit', id: 4 }, {
      damage: 1e6, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: KAIJU_PLAYER, kind: 'stomp', atWill: false,
    });
    expect(troop.wreck).toBe(true);
    events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(k.held).toEqual({ kind: 'wreck', wreck: 'tank' });
    expect(troop.wreck).toBe(false);
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ reason: 'grab', source: 'unitWreck', sourceId: 4 }]);
  });

  it('tears a chunk from a building from stage 2 on, but prefers a loose object', () => {
    const building = { x: 0, z: 15 + 5, w: 10, d: 10, height: 30, hp: 5000 };
    // Stage 1: no chunks.
    let world = arena({ structures: [{ ...building, z: 4 + 5 }] });
    tap(world, Btn.grab);
    untilIdle(world);
    expect(world.kaijus[0].held).toBeNull();
    expect(world.structureHp[0]).toBe(5000);

    world = arena({ structures: [building] }, 2);
    let events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(world.kaijus[0].held).toEqual({ kind: 'chunk', archetype: world.city.structures[0].archetype });
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ reason: 'grab', source: 'structure', sourceId: 0 }]);
    expect(5000 - world.structureHp[0]).toBe(A.grab.chunkStructureDamage[1]);
    expect(world.match.barPoints).toBeGreaterThan(0);

    // With a car also in reach (farther away than the wall), the hand takes the car.
    world = arena({ structures: [building], props: [{ kind: 'car_sedan', x: 12, z: 14 }] }, 2);
    events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(world.kaijus[0].held).toEqual({ kind: 'prop', prop: 'car_sedan' });
    expect(world.structureHp[0]).toBe(5000);
  });
});

describe('eat: grab held', () => {
  it('goes on from the grab to eat what it grabbed, healing when the meal is finished', () => {
    const world = arena({ props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }] });
    const k = world.kaijus[0];
    k.hp = 500;
    const timeline: Array<[number, string, string]> = [];
    const held: SimEvent[] = [];
    let healStep = -1;
    const grab = ticksFor(A.grab.timing.windup);
    const hold = ticksFor(A.eat.holdTime);
    const chew = ticksFor(A.eat.timing.active);
    for (let step = 1; step <= 1 + hold + chew; step++) {
      // The stick is pushed forward once the meal has begun: the kaiju must stay where it is.
      const events = play(world, 1, { buttons: step <= hold + 1 ? Btn.grab : 0, moveZ: step > hold + 1 && step < hold + chew ? 1 : 0 });
      for (const e of eventsOf(events, 'kaijuAction')) timeline.push([step, e.action, e.phase]);
      held.push(...eventsOf(events, 'kaijuHeld'));
      if (healStep < 0 && k.hp > 500) healStep = step;
    }
    expect(timeline).toEqual([
      [1, 'grab', 'windup'],
      [1 + grab, 'grab', 'active'],
      [1 + grab, 'grab', 'idle'],
      [1 + hold, 'eat', 'eat'],
      [1 + hold + chew, 'eat', 'idle'],
    ]);
    expect(held).toMatchObject([
      { reason: 'grab', source: 'prop', held: { kind: 'prop' } },
      { reason: 'eat', source: 'none', held: null },
    ]);
    expect(healStep).toBe(1 + hold + chew);
    expect(k.hp).toBe(500 + A.eat.heal);
    expect(k.held).toBeNull();
    // Rooted for the whole meal.
    expect(k.z).toBe(0);
    expect(A.eat.moveMult).toBe(0);
    expect(k.cooldowns.eat).toBeGreaterThan(0);
  });

  it('eats what it already holds when grab is held, and respects the cooldown', () => {
    const world = arena({ props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }, { kind: 'car_taxi', x: 3, z: clearOf('car_taxi', 0.6) }] });
    const k = world.kaijus[0];
    k.hp = 500;
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).not.toBeNull();

    // Hold grab: after the hold time it eats; letting go afterwards throws nothing.
    let events = play(world, ticksFor(A.eat.holdTime) + 3, { buttons: Btn.grab });
    expect(actions(events)).toEqual([['eat', 'eat']]);
    events = untilIdle(world);
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    expect(k.hp).toBe(500 + A.eat.heal);

    // Straight away again: the second car is grabbed, but the cooldown stops the meal, and
    // releasing the long hold does not throw it either.
    events = [...play(world, ticksFor(A.eat.holdTime) + 10, { buttons: Btn.grab }), ...play(world, 20)];
    expect(k.held).not.toBeNull();
    expect(actions(events).map((a) => a[0])).not.toContain('eat');
    expect(actions(events).map((a) => a[0])).not.toContain('throw');
    expect(k.hp).toBe(500 + A.eat.heal);

    // Once the cooldown (counted from the start of the first meal) is over, it can eat again.
    play(world, ticksFor(A.eat.cooldown));
    expect(k.cooldowns.eat).toBe(0);
    play(world, ticksFor(A.eat.holdTime) + 3, { buttons: Btn.grab });
    untilIdle(world);
    expect(k.held).toBeNull();
    expect(k.hp).toBe(500 + 2 * A.eat.heal);
  });

  it('eats an edible off the ground when the grab finds nothing to pick up', () => {
    const world = arena({ props: [{ kind: 'kiosk', x: 0, z: clearOf('kiosk', 0.6) }] });
    const k = world.kaijus[0];
    k.hp = k.maxHp - 10;
    const events = [...play(world, ticksFor(A.eat.holdTime) + 3, { buttons: Btn.grab }), ...untilIdle(world)];
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ held: null, reason: 'eat', source: 'prop', sourceId: 0 }]);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(world.match.barPoints).toBe(PROP_KINDS.kiosk.value);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.kiosk).toBe(1);
    // Healing stops at full health.
    expect(k.hp).toBe(k.maxHp);
  });

  it('does nothing when there is nothing to eat', () => {
    const world = arena();
    const events = play(world, 60, { buttons: Btn.grab });
    expect(actions(events).map((a) => a[0])).toEqual(['grab', 'grab', 'grab']);
    expect(world.kaijus[0].cooldowns.eat).toBe(0);
  });

  it('loses the meal and the heal when its nerve breaks mid-bite', () => {
    const world = arena({ props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }] });
    const k = world.kaijus[0];
    k.hp = 500;
    play(world, ticksFor(A.eat.holdTime) + 10, { buttons: Btn.grab });
    expect(k.phase).toBe('eat');
    applyHit(world, { entity: 'kaiju', id: 0 }, {
      damage: 0, nerve: 1000, fromDir: { x: 0, z: 1 }, sourceId: 4, player: 1, kind: 'shell', atWill: false,
    });
    expect(k.phase).toBe('stagger');
    play(world, ticksFor(COMBAT_RULES.staggerDuration) + ticksFor(A.eat.timing.active) + 5);
    expect(k.phase).toBe('idle');
    expect(k.hp).toBe(500);
    expect(k.held).toBeNull();
  });
});

describe('brace', () => {
  it('braces for exactly as long as block is down, rooted, and nothing else starts meanwhile', () => {
    const world = arena();
    const k = world.kaijus[0];
    let events = play(world, 1, { buttons: Btn.block });
    expect(actions(events)).toEqual([['brace', 'brace']]);
    expect(eventsOf(events, 'kaijuAction')[0].duration).toBe(0);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('kaiju.brace');

    events = play(world, 45, { buttons: Btn.block | Btn.strike | Btn.roar, moveZ: 1 });
    expect(k.phase).toBe('brace');
    expect(k.action).toBe('brace');
    expect(actions(events)).toEqual([]);
    expect(Math.hypot(k.x, k.z)).toBe(0);
    expect(A.brace.moveMult).toBe(0);

    events = play(world, 1);
    expect(actions(events)).toEqual([['brace', 'idle']]);
    expect(k.phase).toBe('idle');
  });

  it('turns slowly while braced', () => {
    const world = arena();
    const k = world.kaijus[0];
    play(world, TICK_RATE, { buttons: Btn.block, aimYaw: 170 * DEG });
    const expected = LIZARD.stages[0].turnRate * A.brace.turnMult;
    expect(k.yaw).toBeGreaterThan(expected * 0.9);
    expect(k.yaw).toBeLessThan(expected * 1.1);
  });
});

describe('roar', () => {
  it('rattles every unit in the radius, wipes their charge, and goes on cooldown', () => {
    const world = arena();
    const k = world.kaijus[0];
    const reach = A.roar.radius[0];
    const inside = placeUnit(world, 0, 0, reach - 2);
    const outside = placeUnit(world, 1, 0, reach + 2);
    inside.charge = 0.9;
    outside.charge = 0.9;

    let events = play(world, 1, { buttons: Btn.roar });
    expect(actions(events)).toEqual([['roar', 'roar']]);
    expect(eventsOf(events, 'roar')).toMatchObject([{ kaiju: 0, x: 0, z: 0, radius: reach }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('kaiju.roar');
    expect(inside.nerve).toBeGreaterThan(A.roar.unitNerve - COMBAT_RULES.unitNerveLeak);
    expect(inside.charge).toBe(0);
    expect(outside.nerve).toBe(0);
    expect(outside.charge).toBe(0.9);
    expect(k.knownTimer).toBeGreaterThan(MATCH_RULES.revealAfterNoise - 2 * DT);

    // The roar itself takes its time, rooted.
    events = play(world, ticksFor(A.roar.timing.active) - 1, { moveZ: 1 });
    expect(actions(events)).toEqual([]);
    expect(k.phase).toBe('roar');
    expect(k.z).toBe(0);
    events = play(world, 1);
    expect(actions(events)).toEqual([['roar', 'idle']]);

    // On cooldown: hammering the button does nothing until the cooldown, counted from the
    // start of the first roar (step 1), has run out.
    let again = -1;
    for (let step = 2 + ticksFor(A.roar.timing.active); step <= ticksFor(A.roar.cooldown) + 10 && again < 0; step++) {
      const stepEvents = play(world, 1, { buttons: step % 2 === 0 ? Btn.roar : 0 });
      if (eventsOf(stepEvents, 'roar').length > 0) again = step;
    }
    expect(again).toBeGreaterThanOrEqual(1 + ticksFor(A.roar.cooldown));
    expect(again).toBeLessThanOrEqual(2 + ticksFor(A.roar.cooldown));
  });

  it('unsettles a fresh unit without breaking it, and breaks one that was already rattled', () => {
    // The relationship the design relies on: one roar alone does not shake a fresh unit.
    expect(A.roar.unitNerve).toBeLessThan(COMBAT_RULES.unitNerveCapacity);
    const world = arena();
    const fresh = placeUnit(world, 0, 0, 10);
    const rattled = placeUnit(world, 1, 10, 0);
    rattled.nerve = COMBAT_RULES.unitNerveCapacity - A.roar.unitNerve + 1;
    const events = play(world, 1, { buttons: Btn.roar });
    expect(fresh.shaken).toBe(0);
    expect(rattled.shaken).toBeGreaterThan(0);
    expect(eventsOf(events, 'unitShaken')).toMatchObject([{ unit: 1 }]);
    expect(world.players[KAIJU_PLAYER].tally.breaks).toBe(1);
  });

  it('reaches farther at each stage', () => {
    expect(A.roar.radius[0]).toBeLessThan(A.roar.radius[1]);
    expect(A.roar.radius[1]).toBeLessThan(A.roar.radius[2]);
    const world = arena({}, 2);
    const u = placeUnit(world, 4, 0, A.roar.radius[1] - 5);
    play(world, 1, { buttons: Btn.roar });
    expect(u.nerve).toBeGreaterThan(0);
  });
});

describe('the beam special', () => {
  const beam = A.special;
  const windup = ticksFor(beam.timing.windup);
  const burn = ticksFor(beam.timing.active);

  /** Fires the beam straight ahead and runs it to the end; returns the events. */
  function fire(world: World, partial: Partial<PlayerInput> = {}): SimEvent[] {
    world.kaijus[0].rage = COMBAT_RULES.rageMax;
    return [...play(world, 2, { ...partial, buttons: Btn.special }), ...untilIdle(world, partial)];
  }

  it('needs full rage, spends it at the start, and runs wind-up, beam and recovery by the clock', () => {
    const world = arena();
    const k = world.kaijus[0];
    k.rage = beam.rageCost - 1;
    expect(actions(play(world, 10, { buttons: Btn.special }))).toEqual([]);
    play(world, 10);

    k.rage = beam.rageCost;
    const timeline: Array<[number, string, string]> = [];
    const cues: string[] = [];
    const total = windup + burn + ticksFor(beam.timing.recover);
    for (let step = 1; step <= 1 + total; step++) {
      // The stick is pushed forward all the way through, except on the tick it is free again.
      const events = play(world, 1, { buttons: step <= 2 ? Btn.special : 0, moveZ: step <= total ? 1 : 0 });
      for (const e of eventsOf(events, 'kaijuAction')) timeline.push([step, e.action, e.phase]);
      cues.push(...eventsOf(events, 'voice').map((e) => e.cue));
      if (step === 1) expect(k.rage).toBe(0);
    }
    expect(timeline).toEqual([
      [1, 'special', 'windup'],
      [1 + windup, 'special', 'special'],
      [1 + windup + burn, 'special', 'recover'],
      [1 + windup + burn + ticksFor(beam.timing.recover), 'special', 'idle'],
    ]);
    expect(cues).toContain('kaiju.special');
    // Rooted for the whole special.
    expect(k.z).toBe(0);
  });

  it('burns the first standing structure in its path and nothing behind it', () => {
    const world = arena({
      structures: [
        { x: 0, z: 20, w: 8, d: 4, height: 8, hp: 5000, value: 50 },
        { x: 0, z: 40, w: 8, d: 4, height: 8, hp: 5000, value: 50 },
        // Beside the beam, not in it.
        { x: 12, z: 20, w: 8, d: 4, height: 8, hp: 5000, value: 50 },
      ],
    });
    fire(world);
    expect(5000 - world.structureHp[0]).toBeCloseTo(beam.structureDps[0] * beam.timing.active, 6);
    expect(world.structureHp[1]).toBe(5000);
    expect(world.structureHp[2]).toBe(5000);
    expect(world.match.barPoints).toBeCloseTo((50 * beam.structureDps[0] * beam.timing.active) / 5000, 6);
  });

  it('stops at a building until it burns through, then reaches what was behind', () => {
    const firstHp = beam.structureDps[0] * 1;
    const world = arena({
      structures: [
        { x: 0, z: 20, w: 8, d: 4, height: 8, hp: firstHp },
        { x: 0, z: 40, w: 8, d: 4, height: 8, hp: 5000 },
      ],
    });
    const sheltered = placeUnit(world, 0, 0, 30);
    toughen(world, 0);
    world.kaijus[0].rage = COMBAT_RULES.rageMax;
    play(world, 2, { buttons: Btn.special });
    play(world, windup - 1);

    // For the first second the wall takes it all.
    const firstSecond = play(world, TICK_RATE - 2);
    expect(world.structureHp[0]).toBeGreaterThan(0);
    expect(world.structureHp[1]).toBe(5000);
    expect(sheltered.hp).toBe(sheltered.maxHp);
    expect(eventsOf(firstSecond, 'structureStage').map((e) => e.stage)).toEqual([1, 2]);
    expect(world.kaijus[0].act.beamBlocker).toBe(0);

    // Then it falls and the beam goes on: the unit and the second building start to burn.
    const rest = untilIdle(world);
    expect(world.structureHp[0]).toBe(0);
    expect(eventsOf(rest, 'structureStage')).toContainEqual(expect.objectContaining({ id: 0, stage: 3, cause: 'beam', by: KAIJU_PLAYER }));
    const remaining = beam.timing.active - 1;
    expect(5000 - world.structureHp[1]).toBeGreaterThan(beam.structureDps[0] * (remaining - 0.2));
    expect(5000 - world.structureHp[1]).toBeLessThanOrEqual(beam.structureDps[0] * remaining + 1e-6);
    expect(sheltered.maxHp - sheltered.hp).toBeGreaterThan(beam.unitDps * (remaining - 0.2));
    expect(sheltered.maxHp - sheltered.hp).toBeLessThanOrEqual(beam.unitDps * remaining + 1e-6);
  });

  it('hurts units it passes over at the beam rate, within its width and range', () => {
    const world = arena();
    const range = beam.range[0];
    const reachSide = beam.width[0] / 2 + world.units[0].radius;
    const inBeam = placeUnit(world, 0, 0, 30);
    const grazed = placeUnit(world, 1, reachSide - 0.3, 20);
    const beside = placeUnit(world, 2, reachSide + 1.5, 20);
    const beyond = placeUnit(world, 3, 0, range + world.units[3].radius + beam.width[0] + 2);
    const behind = placeUnit(world, 4, 0, -10);
    for (const id of [0, 1, 2, 3, 4]) toughen(world, id);
    const events = fire(world);
    expect(inBeam.maxHp - inBeam.hp).toBeCloseTo(beam.unitDps * beam.timing.active, 6);
    expect(grazed.maxHp - grazed.hp).toBeCloseTo(beam.unitDps * beam.timing.active, 6);
    expect(beside.hp).toBe(beside.maxHp);
    expect(beyond.hp).toBe(beyond.maxHp);
    expect(behind.hp).toBe(behind.maxHp);
    // Reported a few times a second, not on every tick.
    const reports = eventsOf(events, 'unitHit').filter((e) => e.unit === 0);
    expect(reports.length).toBeGreaterThan(5);
    expect(reports.length).toBeLessThan(burn / 2);
    expect(reports.every((e) => e.cause === 'beam')).toBe(true);
  });

  it('follows the aim: look down and it ends on the ground, look up and it clears a low building', () => {
    const mouth = LIZARD.stages[0].mouthHeight;
    const world = arena({ structures: [{ x: 0, z: 40, w: 8, d: 4, height: 6, hp: 5000 }] });
    const near = placeUnit(world, 0, 0, 15);
    toughen(world, 0);
    // Aimed at the ground well short of the building: it never gets there.
    fire(world, { aimPitch: -Math.atan2(mouth, 15) });
    expect(world.structureHp[0]).toBe(5000);
    expect(near.hp).toBeLessThan(near.maxHp);
    // Aimed over the roof.
    placeUnit(world, 0, 100, 100);
    fire(world, { aimPitch: Math.atan2(6 - mouth + 3, 38) });
    expect(world.structureHp[0]).toBe(5000);
    // Level: it burns.
    fire(world);
    expect(world.structureHp[0]).toBeLessThan(5000);
  });

  it('sweeps slowly: the head only turns at the reduced rate while the beam is on', () => {
    const world = arena();
    const k = world.kaijus[0];
    // Normally the head snaps to the aim.
    play(world, 1, { aimYaw: 40 * DEG });
    expect(k.aimYaw).toBeCloseTo(40 * DEG, 9);
    play(world, 30);
    expect(k.yaw).toBeCloseTo(0, 6);

    k.rage = COMBAT_RULES.rageMax;
    play(world, 2, { buttons: Btn.special });
    play(world, windup + 1);
    expect(k.phase).toBe('special');
    const start = k.aimYaw;
    play(world, 15, { aimYaw: 45 * DEG, aimPitch: -0.5 });
    const rate = LIZARD.stages[0].turnRate * beam.turnMult;
    expect(k.aimYaw - start).toBeCloseTo(rate * 0.5, 2);
    expect(k.aimYaw).toBeLessThan(45 * DEG);
    expect(k.aimPitch).toBeCloseTo(-Math.min(0.5, rate * 0.5), 2);
    expect(beam.turnMult).toBeLessThan(1);
  });

  it('is cut short when the kaiju is staggered, and the rage is gone', () => {
    const world = arena({ structures: [{ x: 0, z: 20, w: 8, d: 4, height: 8, hp: 5000 }] });
    const k = world.kaijus[0];
    k.rage = COMBAT_RULES.rageMax;
    play(world, 2, { buttons: Btn.special });
    play(world, windup + 10);
    const hp = world.structureHp[0];
    expect(hp).toBeLessThan(5000);
    applyHit(world, { entity: 'kaiju', id: 0 }, {
      damage: 0, nerve: 1000, fromDir: { x: 0, z: 1 }, sourceId: 4, player: 1, kind: 'shell', atWill: false,
    });
    play(world, 60);
    expect(world.structureHp[0]).toBe(hp);
    expect(k.rage).toBeLessThan(beam.rageCost);
  });
});

describe('the molt', () => {
  it('starts the cocoon only when a molt is available and Molt is held long enough', () => {
    const world = arena({
      marks: [10, 1e6, 2e6],
      structures: [{ x: 100, z: 100, w: 10, d: 10, height: 20, hp: 100, value: 40 }],
      props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }],
    });
    const k = world.kaijus[0];
    const hold = ticksFor(A.molt.holdTime);

    // Not available yet: holding does nothing.
    expect(actions(play(world, hold + 10, { buttons: Btn.molt }))).toEqual([]);
    play(world, 2);

    // The bar passes the first mark: the prompt.
    world.structureHits.push({ id: 0, damage: 100, by: KAIJU_PLAYER, cause: 'swipe' });
    let events = play(world, 1);
    expect(eventsOf(events, 'barMark')).toMatchObject([{ mark: 1 }]);
    expect(eventsOf(events, 'moltAvailable')).toMatchObject([{ kaiju: 0, mark: 1 }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('molt.available');
    expect(k.moltAvailable).toBe(true);
    // Told once, not every tick.
    expect(eventsOf(play(world, 30), 'moltAvailable')).toEqual([]);

    // Letting go early cancels.
    events = [...play(world, hold - 2, { buttons: Btn.molt }), ...play(world, 5)];
    expect(actions(events)).toEqual([]);
    expect(k.phase).toBe('idle');

    // It lets go of what it holds when the cocoon closes.
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).not.toBeNull();

    events = play(world, hold, { buttons: Btn.molt });
    expect(actions(events)).toEqual([]);
    events = play(world, 1, { buttons: Btn.molt });
    expect(actions(events)).toEqual([['molt', 'cocoon']]);
    expect(eventsOf(events, 'cocoon')).toMatchObject([{ kaiju: 0, x: k.x, z: k.z, duration: world.config.tuning.cocoon }]);
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ held: null, reason: 'drop' }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('cocoon.start');
    expect(k.phase).toBe('cocoon');
    expect(k.action).toBe('molt');
    expect(k.phaseDuration).toBe(world.config.tuning.cocoon);
    expect(k.moltAvailable).toBe(false);
    expect(k.held).toBeNull();

    // Helpless: no movement, no actions, and no new prompt while it is in there.
    events = play(world, 60, { buttons: Btn.strike | Btn.roar, moveZ: 1 });
    expect(actions(events)).toEqual([]);
    expect(eventsOf(events, 'moltAvailable')).toEqual([]);
    expect(k.z).toBe(0);
    const hp = k.hp;
    applyHit(world, { entity: 'kaiju', id: 0 }, {
      damage: 20, nerve: 0, fromDir: { x: 0, z: 1 }, sourceId: 4, player: 1, kind: 'shell', atWill: false,
    });
    expect(hp - k.hp).toBeCloseTo(20 * LIZARD.damage.helplessMult, 9);

    // The hand-over to the match flow system: the cocoon phase has run its time.
    play(world, ticksFor(world.config.tuning.cocoon) - 60);
    expect(k.phase).toBe('cocoon');
    expect(k.phaseTime).toBeGreaterThanOrEqual(k.phaseDuration - 1e-6);
  });

  it('offers the next molt at once when the bar is already past the next mark, and none at stage 3', () => {
    const world = arena({ marks: [10, 20, 1e6], structures: [{ x: 100, z: 100, w: 10, d: 10, height: 20, hp: 100, value: 25 }] });
    world.structureHits.push({ id: 0, damage: 100, by: 1, cause: 'shell' });
    let events = play(world, 1);
    // Both marks fell in one tick; the prompt is for the molt of the current stage.
    expect(eventsOf(events, 'barMark').map((e) => e.mark)).toEqual([1, 2]);
    expect(eventsOf(events, 'moltAvailable')).toMatchObject([{ mark: 1 }]);

    beginStage(world, 2);
    expect(world.kaijus[0].moltAvailable).toBe(false);
    events = play(world, 1);
    expect(eventsOf(events, 'moltAvailable')).toMatchObject([{ mark: 2 }]);

    beginStage(world, 3);
    events = play(world, ticksFor(A.molt.holdTime) + 5, { buttons: Btn.molt });
    expect(eventsOf(events, 'moltAvailable')).toEqual([]);
    expect(world.kaijus[0].phase).toBe('idle');
  });
});
