import { describe, expect, it } from 'vitest';
import {
  applyHit,
  beamPath,
  beamShake,
  beginStage,
  bitGet,
  Btn,
  COMBAT_RULES,
  DEG,
  DT,
  INPUT_BUFFER_TICKS,
  kaijuEyePoint,
  LIZARD,
  MATCH_RULES,
  PROP_KINDS,
  TICK_RATE,
  type KaijuActionEvent,
  type KaijuMoveId,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type World,
} from '../src/index';
import { breakNerve, eventsOf, holdFire, HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

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
  // These tests are about the kaiju: the squads stand as targets and do not shoot back.
  holdFire(world);
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

/** Puts moves in the kaiju's two slots, as if it had picked them at its molts. */
function equip(world: World, first: KaijuMoveId, second: KaijuMoveId = 'none'): void {
  world.kaijus[0].moves = [first, second];
}

describe('one move per button', () => {
  it('a move button does the move in its slot, and nothing while the slot is empty', () => {
    const world = arena();
    const k = world.kaijus[0];
    k.rage = COMBAT_RULES.rageMax;
    // Nothing picked yet: the move buttons do nothing.
    for (const button of [Btn.move1, Btn.move2]) {
      expect(actions(tap(world, button))).toEqual([]);
    }
    expect(k.phase).toBe('idle');
    // (Past the 0.2 s a press is remembered for.)
    play(world, 10);

    equip(world, 'roar', 'tailSweep');
    expect(actions(tap(world, Btn.move2))).toEqual([['tailSweep', 'windup']]);
    untilIdle(world);
    expect(actions(tap(world, Btn.move1))).toEqual([['roar', 'roar']]);
  });
});

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
    equip(world, 'roar');
    play(world, 2, { buttons: Btn.strike });
    const events = [...play(world, 3, { buttons: Btn.move1 | Btn.stomp | Btn.grab }), ...untilIdle(world)];
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

describe('buttons held through another action', () => {
  it('start their action as soon as the kaiju is free, however long ago the press was, once per press', () => {
    const world = arena({ props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }] });
    const k = world.kaijus[0];
    k.hp = 500;
    equip(world, 'roar');
    // Roar, then press and keep holding Grab while the roar is still going.
    play(world, 2, { buttons: Btn.move1 });
    const roarLeft = ticksFor(A.roar.timing.active) - 1;
    expect(roarLeft).toBeGreaterThan(INPUT_BUFFER_TICKS + 5);
    let events = play(world, roarLeft - 1, { buttons: Btn.grab });
    expect(actions(events)).toEqual([]);
    // The roar ends: the hand reaches at once.
    events = play(world, 1, { buttons: Btn.grab });
    expect(actions(events)).toEqual([
      ['roar', 'idle'],
      ['grab', 'windup'],
    ]);
    // Holding the button down does not do it again: one press, one move. The car stays in the hand.
    events = [...play(world, ticksFor(A.grab.timing.windup) + 30, { buttons: Btn.grab }), ...untilIdle(world)];
    expect(actions(events)).toEqual([
      ['grab', 'active'],
      ['grab', 'idle'],
    ]);
    expect(k.held).toEqual({ kind: 'prop', prop: 'car_sedan' });
    expect(k.hp).toBe(500);

    // A button that was let go again long before the kaiju was free is forgotten.
    k.cooldowns.roar = 0;
    play(world, 2, { buttons: Btn.strike });
    play(world, 3, { buttons: Btn.move1 });
    events = untilIdle(world);
    events = [...events, ...play(world, 10)];
    expect(actions(events).map((a) => a[0])).not.toContain('roar');
  });
});

describe('stomp: its own button', () => {
  it('starts on the press, and lands at the end of its wind-up; holding Strike is a swipe and nothing more', () => {
    // Strike held as long as a stomp's wind-up: one swipe, no stomp.
    let world = arena();
    let events = [...play(world, ticksFor(A.stomp.timing.windup) + 5, { buttons: Btn.strike }), ...untilIdle(world)];
    expect(actions(events).map((a) => a[0])).not.toContain('stomp');
    expect(actions(events)[0]).toEqual(['swipe', 'windup']);

    world = arena();
    const u = placeUnit(world, 0, 0, 4);
    toughen(world, 0);
    const timeline: Array<[number, string, string]> = [];
    let hitStep = -1;
    for (let step = 1; step <= 90; step++) {
      const stepEvents = play(world, 1, { buttons: step <= 2 ? Btn.stomp : 0 });
      for (const e of eventsOf(stepEvents, 'kaijuAction')) timeline.push([step, e.action, e.phase]);
      if (hitStep < 0 && u.hp < u.maxHp) hitStep = step;
    }
    const windup = ticksFor(A.stomp.timing.windup);
    expect(timeline).toEqual([
      [1, 'stomp', 'windup'],
      [1 + windup, 'stomp', 'active'],
      [1 + windup + ticksFor(A.stomp.timing.active), 'stomp', 'recover'],
      [1 + windup + ticksFor(A.stomp.timing.active) + ticksFor(A.stomp.timing.recover), 'stomp', 'idle'],
    ]);
    expect(hitStep).toBe(1 + windup);
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
    // Three leaders (squad-mates would follow their leader when the stomp throws it).
    const near = placeUnit(world, 0, -3.5, 0);
    const far = placeUnit(world, 4, -(reach + 3 - 0.5), 0);
    const outside = placeUnit(world, 8, -(reach + 3 + 1), -1);
    for (const id of [0, 4, 8]) toughen(world, id);
    const farStart = Math.hypot(far.x, far.z);

    const events = [...tap(world, Btn.stomp), ...untilIdle(world)];
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
    play(world, 2, { buttons: Btn.stomp, moveZ: 1 });
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
    let world = arena({ props: [{ kind: 'car_sedan', x: 0, z: R * A.grab.reach + 20 }] });
    let events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(world.kaijus[0].held).toBeNull();
    expect(eventsOf(events, 'kaijuHeld')).toEqual([]);
    expect(bitGet(world.propAlive, 0)).toBe(true);

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

  it('throws what it holds at the aim point with strike', () => {
    for (const button of [Btn.strike]) {
      const world = arena({
        props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }],
        structures: [{ x: 30, z: 0, w: 8, d: 8, height: 6, hp: 1000 }],
      });
      const k = world.kaijus[0];
      tap(world, Btn.grab);
      untilIdle(world);
      expect(k.held).not.toBeNull();

      // Look at a point on the ground 20 m ahead (the eye is in the head, a little ahead of the body's axis).
      const eye = LIZARD.stages[0].eyeHeight;
      const aim = { aimPitch: -Math.atan2(eye, 20 - LIZARD.stages[0].eyeForward) };
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
    const aim = { aimPitch: -Math.atan2(LIZARD.stages[0].eyeHeight - 1, 24 - LIZARD.stages[0].eyeForward) };
    const events = [...tap(world, Btn.strike, aim), ...play(world, 90, aim)];
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

describe('eat: grab with something in the hand, or something to eat in reach', () => {
  it('eats what it grabbed when grab is pressed again, healing when the meal is finished', () => {
    const world = arena({ props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }] });
    const k = world.kaijus[0];
    k.hp = 500;
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).toEqual({ kind: 'prop', prop: 'car_sedan' });

    const timeline: Array<[number, string, string]> = [];
    const held: SimEvent[] = [];
    let healStep = -1;
    const chew = ticksFor(A.eat.timing.active);
    for (let step = 1; step <= 1 + chew; step++) {
      // The stick is pushed forward once the meal has begun: the kaiju must stay where it is.
      const events = play(world, 1, { buttons: step <= 2 ? Btn.grab : 0, moveZ: step > 1 && step < chew ? 1 : 0 });
      for (const e of eventsOf(events, 'kaijuAction')) timeline.push([step, e.action, e.phase]);
      held.push(...eventsOf(events, 'kaijuHeld'));
      if (healStep < 0 && k.hp > 500) healStep = step;
    }
    expect(timeline).toEqual([
      [1, 'eat', 'eat'],
      [1 + chew, 'eat', 'idle'],
    ]);
    expect(held).toMatchObject([{ reason: 'eat', source: 'none', held: null }]);
    expect(healStep).toBe(1 + chew);
    expect(k.hp).toBe(500 + A.eat.heal);
    expect(k.held).toBeNull();
    // Rooted for the whole meal, and nothing was thrown.
    expect(k.z).toBe(0);
    expect(A.eat.moveMult).toBe(0);
    expect(k.cooldowns.eat).toBeGreaterThan(0);
    expect(world.projectiles).toEqual([]);
  });

  it('respects the cooldown: with something in the hand, grab does nothing until the last meal is far enough behind', () => {
    const world = arena({ props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }, { kind: 'car_taxi', x: 3, z: clearOf('car_taxi', 0.6) }] });
    const k = world.kaijus[0];
    k.hp = 500;
    tap(world, Btn.grab);
    untilIdle(world);
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.hp).toBe(500 + A.eat.heal);

    // Straight away again: the second car is grabbed, but the cooldown stops the meal.
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).not.toBeNull();
    const events = [...tap(world, Btn.grab), ...play(world, 20)];
    expect(actions(events)).toEqual([]);
    expect(k.held).not.toBeNull();

    // Once the cooldown (counted from the start of the first meal) is over, it can eat again.
    play(world, ticksFor(A.eat.cooldown));
    expect(k.cooldowns.eat).toBe(0);
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).toBeNull();
    expect(k.hp).toBe(500 + 2 * A.eat.heal);
  });

  it('eats an edible off the ground when there is nothing to pick up', () => {
    const world = arena({ props: [{ kind: 'kiosk', x: 0, z: clearOf('kiosk', 0.6) }] });
    const k = world.kaijus[0];
    k.hp = k.maxHp - 10;
    const events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(actions(events)).toEqual([
      ['eat', 'eat'],
      ['eat', 'idle'],
    ]);
    expect(eventsOf(events, 'kaijuHeld')).toMatchObject([{ held: null, reason: 'eat', source: 'prop', sourceId: 0 }]);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(world.match.barPoints).toBe(PROP_KINDS.kiosk.value);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.kiosk).toBe(1);
    // Healing stops at full health.
    expect(k.hp).toBe(k.maxHp);
  });

  it('grabs at nothing when there is nothing to pick up or eat', () => {
    const world = arena();
    const events = [...tap(world, Btn.grab), ...untilIdle(world)];
    expect(actions(events)).toEqual([
      ['grab', 'windup'],
      ['grab', 'active'],
      ['grab', 'idle'],
    ]);
    expect(world.kaijus[0].held).toBeNull();
    expect(world.kaijus[0].cooldowns.eat).toBe(0);
  });

  it('loses the meal and the heal when its nerve breaks mid-bite', () => {
    const world = arena({ props: [{ kind: 'kiosk', x: 0, z: clearOf('kiosk', 0.6) }] });
    const k = world.kaijus[0];
    k.hp = 500;
    play(world, 10, { buttons: Btn.grab });
    expect(k.phase).toBe('eat');
    breakNerve(world);
    expect(k.phase).toBe('stagger');
    play(world, ticksFor(COMBAT_RULES.staggerDuration) + ticksFor(A.eat.timing.active) + 5);
    expect(k.phase).toBe('idle');
    expect(k.hp).toBe(500);
    expect(k.held).toBeNull();
  });
});

describe('brace: a move, held on the button of its slot', () => {
  it('braces for exactly as long as its button is down, rooted, and nothing else starts meanwhile', () => {
    const world = arena();
    const k = world.kaijus[0];
    equip(world, 'roar', 'brace');
    let events = play(world, 1, { buttons: Btn.move2 });
    expect(actions(events)).toEqual([['brace', 'brace']]);
    expect(eventsOf(events, 'kaijuAction')[0].duration).toBe(0);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('kaiju.brace');

    events = play(world, 45, { buttons: Btn.move2 | Btn.strike | Btn.move1, moveZ: 1 });
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
    equip(world, 'brace');
    play(world, TICK_RATE, { buttons: Btn.move1, aimYaw: 170 * DEG });
    const expected = LIZARD.stages[0].turnRate * A.brace.turnMult;
    expect(k.yaw).toBeGreaterThan(expected * 0.9);
    expect(k.yaw).toBeLessThan(expected * 1.1);
  });
});

describe('roar: a move that stuns', () => {
  it('stuns every unit in the radius, wipes their charge, shakes them once the stun is over, and goes on cooldown', () => {
    const world = arena();
    const k = world.kaijus[0];
    equip(world, 'roar');
    const reach = A.roar.radius[0];
    // Two driven units (0 and 4): nothing but the roar changes their charge.
    const inside = placeUnit(world, 0, 0, reach - 2);
    const outside = placeUnit(world, 4, 0, reach + 2);
    inside.charge = 0.9;
    outside.charge = 0.9;

    let events = play(world, 1, { buttons: Btn.move1 });
    expect(actions(events)).toEqual([['roar', 'roar']]);
    expect(eventsOf(events, 'roar')).toMatchObject([{ kaiju: 0, x: 0, z: 0, radius: reach }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('kaiju.roar');
    expect(eventsOf(events, 'unitStunned')).toMatchObject([{ unit: 0, duration: A.roar.stunTime }]);
    expect(eventsOf(events, 'unitShaken')).toMatchObject([{ unit: 0 }]);
    expect(inside.stun).toBeCloseTo(A.roar.stunTime - DT, 6);
    expect(inside.charge).toBe(0);
    expect(outside.stun).toBe(0);
    expect(outside.nerve).toBe(0);
    expect(outside.charge).toBe(0.9);
    expect(k.knownTimer).toBeGreaterThan(MATCH_RULES.revealAfterNoise - 2 * DT);

    // The shaking waits for the stun: its time runs once the stun is over.
    play(world, ticksFor(A.roar.stunTime) - 1);
    expect(inside.stun).toBe(0);
    expect(inside.shaken).toBeCloseTo(COMBAT_RULES.shakenDuration, 6);
    expect(inside.state).toBe('shaken');
    play(world, 10);
    expect(inside.shaken).toBeCloseTo(COMBAT_RULES.shakenDuration - 10 * DT, 6);

    // On cooldown: hammering the button does nothing until the cooldown, counted from the start
    // of the first roar, has run out.
    untilIdle(world);
    const start = world.tick - (ticksFor(A.roar.stunTime) - 1 + 10 + 1);
    let again = -1;
    for (let i = 0; i < ticksFor(A.roar.cooldown) + 10 && again < 0; i++) {
      const stepEvents = play(world, 1, { buttons: i % 2 === 0 ? Btn.move1 : 0 });
      if (eventsOf(stepEvents, 'roar').length > 0) again = world.tick - start;
    }
    expect(again).toBeGreaterThanOrEqual(ticksFor(A.roar.cooldown));
    expect(again).toBeLessThanOrEqual(ticksFor(A.roar.cooldown) + 2);
  });

  it('a stunned unit cannot move or fire: neither its player nor its squad moves it until the stun is over', () => {
    const world = makeTestWorld({ people: 'both' });
    placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    equip(world, 'roar');
    const squad = world.squads[0];
    const leader = placeUnit(world, squad.driven, 0, 20);
    const mate = placeUnit(world, squad.units[1], 10, 20);
    // The player pushes forward and holds the trigger the whole time.
    const push = input({ moveZ: 1, aimYaw: Math.PI, buttons: Btn.fire });
    run(world, 1, [input({ buttons: Btn.move1 }), push]);
    expect(leader.stun).toBeGreaterThan(0);
    const x = leader.x;
    const z = leader.z;
    const events = run(world, ticksFor(A.roar.stunTime) - 2, [null, push]);
    // Frozen: not a step, not a shot (the squad-mate neither).
    expect(Math.hypot(leader.x - x, leader.z - z)).toBeLessThan(0.05);
    expect(eventsOf(events, 'projectileSpawn').filter((e) => e.owner === 'unit' && world.units[e.ownerId].squad === 0)).toEqual([]);
    expect(Math.hypot(mate.vx, mate.vz)).toBeLessThan(0.05);
    // Then it answers again (shaken: it moves, but does not fire).
    run(world, 30, [null, push]);
    expect(leader.stun).toBe(0);
    expect(Math.hypot(leader.x - x, leader.z - z)).toBeGreaterThan(1);
    expect(world.players[HUMAN_PLAYER].input.buttons & Btn.fire).toBeTruthy();
  });

  it('stuns a unit that is already shaken without shaking it again', () => {
    expect(A.roar.unitNerve).toBeGreaterThanOrEqual(COMBAT_RULES.unitNerveCapacity);
    const world = arena();
    equip(world, 'roar');
    const fresh = placeUnit(world, 0, 0, 10);
    const rattled = placeUnit(world, 1, 10, 0);
    const shaken = placeUnit(world, 2, -10, 0);
    rattled.nerve = 50;
    shaken.shaken = 1;
    shaken.state = 'shaken';
    const events = play(world, 1, { buttons: Btn.move1 });
    expect(eventsOf(events, 'unitStunned').map((e) => e.unit).sort()).toEqual([0, 1, 2]);
    expect(eventsOf(events, 'unitShaken').map((e) => e.unit).sort()).toEqual([0, 1]);
    expect(fresh.shaken).toBeGreaterThan(0);
    expect(rattled.shaken).toBeGreaterThan(0);
    // Already shaken: not shaken again, and its shaking waits out the stun.
    expect(shaken.shaken).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.breaks).toBe(2);
  });

  it('reaches farther at each stage', () => {
    expect(A.roar.radius[0]).toBeLessThan(A.roar.radius[1]);
    expect(A.roar.radius[1]).toBeLessThan(A.roar.radius[2]);
    const world = arena({}, 2);
    equip(world, 'roar');
    const u = placeUnit(world, 4, 0, A.roar.radius[1] - 5);
    play(world, 1, { buttons: Btn.move1 });
    expect(u.stun).toBeGreaterThan(0);
  });
});

describe('the beam special', () => {
  const beam = A.special;
  const windup = ticksFor(beam.timing.windup);
  const burn = ticksFor(beam.timing.active);

  /**
   * Runs `fn` with the beam's shake, pull and kick turned off: for the tests of where the beam
   * reaches and what it burns, which aim it exactly. The shake has its own test below.
   */
  function steady(fn: () => void): void {
    const saved = { wobbleYaw: beam.wobbleYaw, wobblePitch: beam.wobblePitch, driftYaw: beam.driftYaw, kickPitch: beam.kickPitch };
    Object.assign(beam, { wobbleYaw: 0, wobblePitch: 0, driftYaw: 0, kickPitch: 0 });
    try {
      fn();
    } finally {
      Object.assign(beam, saved);
    }
  }

  /** Fires the beam straight ahead and runs it to the end; returns the events. */
  function fire(world: World, partial: Partial<PlayerInput> = {}): SimEvent[] {
    equip(world, 'beam');
    world.kaijus[0].rage = COMBAT_RULES.rageMax;
    return [...play(world, 2, { ...partial, buttons: Btn.move1 }), ...untilIdle(world, partial)];
  }

  it('needs full rage, spends it at the start, and runs wind-up, beam and recovery by the clock', () => {
    const world = arena();
    const k = world.kaijus[0];
    equip(world, 'beam');
    k.rage = beam.rageCost - 1;
    expect(actions(play(world, 10, { buttons: Btn.move1 }))).toEqual([]);
    play(world, 10);

    k.rage = beam.rageCost;
    const timeline: Array<[number, string, string]> = [];
    const cues: string[] = [];
    const total = windup + burn + ticksFor(beam.timing.recover);
    for (let step = 1; step <= 1 + total; step++) {
      // The stick is pushed forward all the way through, except on the tick it is free again.
      const events = play(world, 1, { buttons: step <= 2 ? Btn.move1 : 0, moveZ: step <= total ? 1 : 0 });
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

  it('stops at a building until it burns through, then reaches what was behind', () => steady(() => {
    const firstHp = beam.structureDps[0] * 1;
    const world = arena({
      structures: [
        { x: 0, z: 20, w: 8, d: 4, height: 8, hp: firstHp },
        { x: 0, z: 40, w: 8, d: 4, height: 8, hp: 5000 },
      ],
    });
    const sheltered = placeUnit(world, 0, 0, 30);
    toughen(world, 0);
    equip(world, 'beam');
    world.kaijus[0].rage = COMBAT_RULES.rageMax;
    play(world, 2, { buttons: Btn.move1 });
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
  }));

  it('hurts units it passes over at the beam rate, within its width and range', () => steady(() => {
    const world = arena();
    const range = beam.range[0];
    const reachSide = beam.width[0] / 2 + world.units[0].radius;
    // The two that burn are driven units (0 and 4): a sub-unit would be shaken by the beam and back out of it.
    const inBeam = placeUnit(world, 0, 0, 30);
    const grazed = placeUnit(world, 4, reachSide - 0.3, 20);
    const beside = placeUnit(world, 1, reachSide + 1.5, 20);
    const beyond = placeUnit(world, 2, 0, range + world.units[2].radius + beam.width[0] + 2);
    const behind = placeUnit(world, 3, 0, -10);
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
  }));

  it('leaves the mouth where the model has it: ahead of the body along the aim, at mouth height', () => {
    // The art's anchors (docs/art/client-notes-kaiju-lizard.md, section 7): eye and mouth, height / forward.
    expect(LIZARD.stages.map((s) => [s.eyeHeight, s.eyeForward])).toEqual([[4.2, 1.73], [27.5, 10.95], [90.7, 38.5]]);
    expect(LIZARD.stages.map((s) => [s.mouthHeight, s.mouthForward])).toEqual([[2.9, 2.5], [22, 15], [72, 51.4]]);
    for (const stage of [1, 2, 3] as const) {
      const st = LIZARD.stages[stage - 1];
      const world = arena({}, stage);
      const k = world.kaijus[0];
      const yaw = 0.7;
      const pitch = -0.3;
      const path = beamPath(world.cityQuery, { kind: k.kind, stage, x: k.x, z: k.z, aimYaw: yaw, aimPitch: pitch }, beam);
      expect(path.ox).toBeCloseTo(k.x + Math.sin(yaw) * st.mouthForward, 9);
      expect(path.oy).toBe(st.mouthHeight);
      expect(path.oz).toBeCloseTo(k.z + Math.cos(yaw) * st.mouthForward, 9);
      // Pointed down it ends on the ground, as far ahead of the mouth as its height and the pitch say.
      expect(path.end).toBe('ground');
      const ahead = st.mouthForward + st.mouthHeight / Math.tan(-pitch);
      expect(Math.hypot(path.ex - k.x, path.ez - k.z)).toBeCloseTo(ahead, 6);
      // The eye, for the throw's aim and the camera.
      const eye = kaijuEyePoint({ kind: k.kind, stage, x: k.x, z: k.z, aimYaw: yaw }, { x: 0, y: 0, z: 0 });
      expect([eye.x - k.x, eye.y, eye.z - k.z]).toEqual([expect.closeTo(Math.sin(yaw) * st.eyeForward, 9), st.eyeHeight, expect.closeTo(Math.cos(yaw) * st.eyeForward, 9)]);
    }
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

  it('sweeps slowly: the head only turns at the reduced rate while the beam is on', () => steady(() => {
    const world = arena();
    const k = world.kaijus[0];
    // Normally the head snaps to the aim.
    play(world, 1, { aimYaw: 40 * DEG });
    expect(k.aimYaw).toBeCloseTo(40 * DEG, 9);
    play(world, 30);
    expect(k.yaw).toBeCloseTo(0, 6);

    equip(world, 'beam');
    k.rage = COMBAT_RULES.rageMax;
    play(world, 2, { buttons: Btn.move1 });
    play(world, windup + 1);
    expect(k.phase).toBe('special');
    const start = k.aimYaw;
    play(world, 15, { aimYaw: 45 * DEG, aimPitch: -0.5 });
    const rate = LIZARD.stages[0].turnRate * beam.turnMult;
    expect(k.aimYaw - start).toBeCloseTo(rate * 0.5, 2);
    expect(k.aimYaw).toBeLessThan(45 * DEG);
    expect(k.aimPitch).toBeCloseTo(-Math.min(0.5, rate * 0.5), 2);
    expect(beam.turnMult).toBeLessThan(1);
  }));

  it('fights the head: it shakes, pulls to one side and kicks up about where it is steered, and stays aimable', () => {
    // Nothing defined, nothing happens.
    expect(beamShake({ ...beam, wobbleYaw: undefined, wobblePitch: undefined, driftYaw: undefined, kickPitch: undefined }, 1, 3, 5)).toEqual({ yaw: 0, pitch: 0 });
    const active = beam.timing.active;
    const pull = beam.driftYaw ?? 0;
    const most = pull + (beam.wobbleYaw ?? 0);

    /** Fires the beam with the crosshair held dead ahead and level; the beam's yaw and pitch on every tick it burns. */
    function burnAhead(extraTicks: number): Array<{ yaw: number; pitch: number; steered: number }> {
      const world = arena();
      const k = world.kaijus[0];
      play(world, extraTicks);
      equip(world, 'beam');
      k.rage = COMBAT_RULES.rageMax;
      const out: Array<{ yaw: number; pitch: number; steered: number }> = [];
      play(world, 2, { buttons: Btn.move1 });
      for (let i = 0; i < 400 && k.phase !== 'idle'; i++) {
        play(world, 1);
        if (k.phase === 'special') out.push({ yaw: k.aimYaw, pitch: k.aimPitch, steered: k.act.beamYaw });
      }
      // Free again: the head snaps back to the crosshair.
      play(world, 1);
      expect(k.aimYaw).toBe(0);
      expect(k.aimPitch).toBe(0);
      return out;
    }

    const a = burnAhead(0);
    expect(a.length).toBeGreaterThanOrEqual(burn - 1);
    // The head stays steered at the crosshair; the beam is what strays.
    expect(a.every((t) => Math.abs(t.steered) < 1e-9)).toBe(true);
    const yaws = a.map((t) => t.yaw);
    const spread = Math.max(...yaws) - Math.min(...yaws);
    expect(spread).toBeGreaterThan(5 * DEG);
    // ...but never further than its pull and shake together: it goes where it is pointed, roughly.
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThanOrEqual(most + 1e-9);
    // It kicks up as it goes: by the end it is aimed above where the head is steered.
    expect(a[a.length - 1].pitch).toBeGreaterThan((beam.kickPitch ?? 0) - (beam.wobblePitch ?? 0) - 1e-9);
    expect(a[0].pitch).toBeLessThan(a[a.length - 1].pitch);

    // The same beam started on the next tick pulls the other way at the end; a replay is the same.
    const b = burnAhead(1);
    expect(Math.sign(a[a.length - 1].yaw)).toBe(-Math.sign(b[b.length - 1].yaw));
    expect(Math.abs(a[a.length - 1].yaw)).toBeGreaterThan(pull - (beam.wobbleYaw ?? 0) - 1e-9);
    expect(burnAhead(0)).toEqual(a);

    // The pure function the clients can use says the same: the full pull to one side by the end.
    expect(beamShake(beam, active, active, 2).yaw).toBeGreaterThan(0);
    expect(beamShake(beam, active, active, 3).yaw).toBeLessThan(0);
    // At the start it is only a tremor: a third of the shake, no pull, no kick.
    const start = beamShake(beam, 0, active, 2);
    expect(Math.abs(start.yaw)).toBeLessThanOrEqual((beam.wobbleYaw ?? 0) * 0.35 + 1e-12);
    expect(Math.abs(start.pitch)).toBeLessThanOrEqual((beam.wobblePitch ?? 0) * 0.35 + 1e-12);
  });

  it('is cut short when the kaiju is staggered, and the rage is gone', () => {
    const world = arena({ structures: [{ x: 0, z: 20, w: 8, d: 4, height: 8, hp: 5000 }] });
    const k = world.kaijus[0];
    equip(world, 'beam');
    k.rage = COMBAT_RULES.rageMax;
    play(world, 2, { buttons: Btn.move1 });
    play(world, windup + 10);
    const hp = world.structureHp[0];
    expect(hp).toBeLessThan(5000);
    breakNerve(world);
    expect(k.phase).toBe('stagger');
    play(world, 60);
    expect(world.structureHp[0]).toBe(hp);
    expect(k.rage).toBeLessThan(beam.rageCost);
  });
});

describe('the charge: a move', () => {
  const c = A.charge;
  const windup = ticksFor(c.timing.windup);
  const runTicks = ticksFor(c.timing.active);
  const stumble = ticksFor(c.timing.recover);

  it('winds up rooted, runs straight ahead at twice its walking speed turning slowly, and always ends in a stumble; the cooldown counts from its end', () => {
    const world = arena();
    const k = world.kaijus[0];
    equip(world, 'charge');
    const st = LIZARD.stages[0];
    const timeline: Array<[number, string, string, number]> = [];
    const speeds: number[] = [];
    for (let step = 1; step <= 300 && (step < 3 || k.phase !== 'idle'); step++) {
      // The stick is pulled back the whole time, and the crosshair is off to the right halfway
      // through the run: the run goes where the body faces, turning only slowly.
      const turn = step > 1 + windup + runTicks / 2;
      const events = play(world, 1, { buttons: step <= 2 ? Btn.move1 : 0, moveZ: -1, aimYaw: turn ? 90 * DEG : 0 });
      for (const e of eventsOf(events, 'kaijuAction')) timeline.push([step, e.action, e.phase, e.duration]);
      speeds.push(Math.hypot(k.vx, k.vz));
      if (step === windup) expect(Math.hypot(k.x, k.z)).toBe(0);
      if (step === 1 + windup + runTicks - 1) {
        // Half a run of turning at a quarter of the rate (a tick of slack for when it began).
        const turned = st.turnRate * c.runTurnMult * (runTicks / 2) * DT;
        expect(k.yaw).toBeGreaterThan(turned - st.turnRate * c.runTurnMult * 2 * DT);
        expect(k.yaw).toBeLessThan(turned + 1e-6);
        expect(k.cooldowns.charge).toBeGreaterThan(c.cooldown);
      }
    }
    expect(timeline).toEqual([
      [1, 'charge', 'windup', c.timing.windup],
      [1 + windup, 'charge', 'charge', c.timing.active],
      [1 + windup + runTicks, 'charge', 'stumble', c.timing.recover],
      [1 + windup + runTicks + stumble, 'charge', 'idle', 0],
    ]);
    // Twice the walking top speed, reached half a second into the run.
    const top = st.topSpeed * c.speedMult;
    expect(Math.max(...speeds)).toBeCloseTo(top, 6);
    expect(speeds[windup + ticksFor(c.rampTime)]).toBeGreaterThan(top * 0.97);
    expect(k.z).toBeGreaterThan(top * (c.timing.active - c.rampTime));
    expect(k.cooldowns.charge).toBe(c.cooldown);
    // The stumble left it standing still (on the tick it is free it starts walking where the stick says).
    expect(speeds[speeds.length - 2]).toBeLessThan(0.5);
  });

  it('smashes the houses it runs through, and a building too tall to smash stops it dead', () => {
    // Houses (6 m: more than a hatchling walks through, less than its charge smashes) ahead, then a tall block.
    const houses = [14, 26, 38].map((z) => ({ x: 0, z, w: 8, d: 8, height: 6, hp: 80, value: 8 }));
    const world = arena({ structures: [...houses, { x: 0, z: 50, w: 12, d: 8, height: 20, hp: 900, value: 50 }] });
    const k = world.kaijus[0];
    equip(world, 'charge');
    expect(houses[0].height).toBeGreaterThan(LIZARD.stages[0].trampleHeight);
    expect(houses[0].height).toBeLessThanOrEqual(c.smashHeight[0]);
    const events = [...tap(world, Btn.move1), ...untilIdle(world)];
    expect([0, 1, 2].map((id) => world.structureHp[id])).toEqual([0, 0, 0]);
    expect(eventsOf(events, 'structureStage').filter((e) => e.stage === 3)).toMatchObject([0, 1, 2].map((id) => ({ id, cause: 'charge', by: KAIJU_PLAYER })));
    expect(world.match.barPoints).toBeCloseTo(3 * 8, 6);
    // The tall block stood: the run stopped against it, before its time was up.
    expect(world.structureHp[3]).toBe(900);
    const stumbleAt = eventsOf(events, 'kaijuAction').find((e) => e.phase === 'stumble') as KaijuActionEvent;
    const runAt = eventsOf(events, 'kaijuAction').find((e) => e.phase === 'charge') as KaijuActionEvent;
    expect(stumbleAt.tick - runAt.tick).toBeLessThan(runTicks);
    expect(k.z + LIZARD.stages[0].bodyRadius).toBeLessThanOrEqual(46 + 0.05);
  });

  it('hits each unit it runs into once and throws it aside; a second press ends the run early', () => {
    const world = arena();
    const k = world.kaijus[0];
    equip(world, 'charge');
    // Two leaders (they stay where they are put) in the path, just to either side of the middle.
    const right = placeUnit(world, 0, -1, 14);
    const left = placeUnit(world, 4, 1.5, 22);
    toughen(world, 0);
    toughen(world, 4);
    let events = [...tap(world, Btn.move1), ...play(world, windup + ticksFor(1.5))];
    const hits = eventsOf(events, 'unitHit').filter((e) => e.cause === 'charge');
    expect(hits.map((e) => [e.unit, e.damage]).sort()).toEqual([
      [0, c.unitDamage],
      [4, c.unitDamage],
    ]);
    expect(right.nerve).toBeGreaterThan(0);
    // Thrown aside, each to its own side of the path.
    expect(right.x).toBeLessThan(-1 - LIZARD.stages[0].bodyRadius);
    expect(left.x).toBeGreaterThan(1.5 + LIZARD.stages[0].bodyRadius);
    // Pressed again in the run: the stumble starts at once.
    expect(k.phase).toBe('charge');
    events = play(world, 1, { buttons: Btn.move1 });
    expect(actions(events)).toEqual([['charge', 'stumble']]);
  });
});

describe('the tail sweep: a move', () => {
  it('sweeps the rear half after a short wind-up: units behind are hit and knocked outward, buildings behind take a swipe of damage', () => {
    const r = radius(1);
    const world = arena({
      structures: [
        { x: 3, z: -(r + 3), w: 4, d: 4, height: 6, hp: 1000 },
        { x: 0, z: r + 3, w: 4, d: 4, height: 6, hp: 1000 },
      ],
    });
    const k = world.kaijus[0];
    equip(world, 'tailSweep');
    const behind = placeUnit(world, 0, -2, -(r + 2));
    const front = placeUnit(world, 4, -3, r + 2);
    toughen(world, 0);
    toughen(world, 4);
    const timeline: Array<[number, string, string]> = [];
    for (let step = 1; step <= 60; step++) {
      for (const e of eventsOf(play(world, 1, { buttons: step <= 2 ? Btn.move1 : 0 }), 'kaijuAction')) timeline.push([step, e.action, e.phase]);
    }
    const sw = A.tailSweep.timing;
    expect(timeline).toEqual([
      [1, 'tailSweep', 'windup'],
      [1 + ticksFor(sw.windup), 'tailSweep', 'active'],
      [1 + ticksFor(sw.windup) + ticksFor(sw.active), 'tailSweep', 'recover'],
      [1 + ticksFor(sw.windup) + ticksFor(sw.active) + ticksFor(sw.recover), 'tailSweep', 'idle'],
    ]);
    expect(behind.maxHp - behind.hp).toBe(A.tailSweep.unitDamage);
    expect(behind.nerve).toBeGreaterThan(0);
    // Knocked outward, away from the kaiju.
    expect(Math.hypot(behind.x, behind.z)).toBeGreaterThan(Math.hypot(2, r + 2) + r * 0.5);
    expect(front.hp).toBe(front.maxHp);
    expect(1000 - world.structureHp[0]).toBe(A.tailSweep.structureDamage[0]);
    expect(world.structureHp[1]).toBe(1000);
    expect(k.cooldowns.tailSweep).toBeGreaterThan(A.tailSweep.cooldown - 2.1);
  });
});

describe('the molt', () => {
  it('starts the cocoon with one press of Molt, only when a molt is available', () => {
    const world = arena({
      marks: [10, 1e6, 2e6],
      structures: [{ x: 100, z: 100, w: 10, d: 10, height: 20, hp: 100, value: 40 }],
      props: [{ kind: 'car_sedan', x: 0, z: clearOf('car_sedan') }],
    });
    const k = world.kaijus[0];

    // Not available yet: pressing or holding does nothing.
    expect(actions(play(world, 40, { buttons: Btn.molt }))).toEqual([]);
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

    // It lets go of what it holds when the cocoon closes, on the press itself.
    tap(world, Btn.grab);
    untilIdle(world);
    expect(k.held).not.toBeNull();

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
    events = play(world, 60, { buttons: Btn.strike | Btn.stomp, moveZ: 1 });
    expect(actions(events)).toEqual([]);
    expect(eventsOf(events, 'moltAvailable')).toEqual([]);
    expect(k.z).toBe(0);
    const hp = k.hp;
    applyHit(world, { entity: 'kaiju', id: 0 }, {
      damage: 20, nerve: 0, fromDir: { x: 0, z: 1 }, sourceId: 4, player: 1, kind: 'shell', atWill: false,
    });
    expect(hp - k.hp).toBeCloseTo(20 * LIZARD.damage.helplessMult, 9);

    // The cocoon runs its full time, to the tick...
    play(world, ticksFor(world.config.tuning.cocoon) - 61);
    expect(k.phase).toBe('cocoon');
    expect(k.stage).toBe(1);
    expect(world.match.phase).toBe('playing');
    // ...and then the match flow system takes over: the blast wave, the new body, the intermission
    // (test/molt.test.ts follows it from here).
    events = play(world, 1);
    expect(eventsOf(events, 'moltBlast')).toMatchObject([{ kaiju: 0 }]);
    expect(actions(events)).toEqual([['molt', 'idle']]);
    expect(k.phase).toBe('idle');
    expect(k.stage).toBe(2);
    expect(world.match.phase).toBe('intermission');
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
    events = play(world, 30, { buttons: Btn.molt });
    expect(eventsOf(events, 'moltAvailable')).toEqual([]);
    expect(world.kaijus[0].phase).toBe('idle');
  });
});
