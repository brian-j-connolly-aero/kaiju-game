import { describe, expect, it } from 'vitest';
import {
  angleDist,
  bitClear,
  bitCount,
  bitSet,
  Btn,
  COMBAT_RULES,
  computeBarMarks,
  createBitset,
  DEG,
  distToStructure,
  isStanding,
  LIZARD,
  PROP_KINDS,
  structuresInCircle,
  TICK_RATE,
  yawFromTo,
  type PlayerInput,
  type SimEvent,
  type World,
} from '../src/index';
import { eventsOf, holdFire, input, KAIJU_PLAYER, makeTestCity, makeTestWorld, parkUnits, placeKaiju, valueDestroyed, type TestCityOptions } from './helpers';

/**
 * A scripted kaiju: each call feeds the kaiju player's inputs for a while, the way a person at
 * the controls would, and collects every event. Nothing reaches into the world except through
 * `world.step(inputs)`.
 */
function createScript(world: World) {
  const events: SimEvent[] = [];
  const k = world.kaijus[0];
  let aimYaw = k.aimYaw;
  let aimPitch = 0;

  function step(partial: Partial<PlayerInput> = {}): void {
    events.push(...world.step([input({ aimYaw, aimPitch, ...partial })]));
    // The bar always equals what the city has lost.
    expect(world.match.barPoints).toBeCloseTo(valueDestroyed(world), 2);
  }

  function wait(ticks: number): void {
    for (let i = 0; i < ticks; i++) step();
  }

  function untilIdle(max = 300): void {
    for (let i = 0; i < max && k.phase !== 'idle'; i++) step();
    expect(k.phase).toBe('idle');
  }

  /** Turns to face a heading (and looks at a pitch) without walking. */
  function face(yaw: number, pitch = 0): void {
    aimYaw = yaw;
    aimPitch = pitch;
    for (let i = 0; i < 120 && angleDist(k.yaw, yaw) > 1 * DEG; i++) step();
    step();
  }

  /** Walks to a point: looks at it and pushes the stick forward. */
  function walkTo(x: number, z: number): void {
    for (let i = 0; i < 600; i++) {
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < 0.4) break;
      aimYaw = yawFromTo(k.x, k.z, x, z);
      // Ease off near the goal so it stops on the mark.
      step({ moveZ: d > 3 ? 1 : 0.35 });
    }
    expect(Math.hypot(x - k.x, z - k.z)).toBeLessThan(1);
    wait(8);
  }

  function tap(button: number): void {
    step({ buttons: button });
    step({ buttons: button });
    step();
  }

  function swipe(): void {
    tap(Btn.strike);
    untilIdle();
  }

  function hold(button: number, seconds: number): void {
    for (let i = 0; i < Math.ceil(seconds * TICK_RATE) + 1; i++) step({ buttons: button });
    step();
  }

  return { events, k, step, wait, untilIdle, face, walkTo, tap, swipe, hold };
}

/**
 * What a client knows about the city if it only ever listened to events: structure stages from
 * `structureStage`, props from `propsDestroyed`, and what the kaiju took from `kaijuHeld`.
 */
function mirrorCity(world: World, events: SimEvent[]) {
  const stage = new Uint8Array(world.city.structures.length);
  const alive = createBitset(world.city.props.length, true);
  const wreck = createBitset(world.city.props.length);
  for (const e of events) {
    if (e.type === 'structureStage') stage[e.id] = e.stage;
    else if (e.type === 'propsDestroyed') {
      for (const id of e.ids) {
        bitClear(alive, id);
        if (PROP_KINDS[world.city.props[id].kind].leavesWreck) bitSet(wreck, id);
      }
    } else if (e.type === 'kaijuHeld') {
      if (e.source === 'prop') bitClear(alive, e.sourceId);
      else if (e.source === 'propWreck') bitClear(wreck, e.sourceId);
    }
  }
  return { stage, alive, wreck };
}

function expectMirrorMatches(world: World, events: SimEvent[]): void {
  const mirror = mirrorCity(world, events);
  expect(mirror.stage).toEqual(world.structureStage);
  expect(mirror.alive).toEqual(world.propAlive);
  expect(mirror.wreck).toEqual(world.propWreck);
}

const HOUSE = { w: 8, d: 8, height: 6, hp: 80, value: 8, cls: 'house' as const };

/** One block: a street running north (+Z) from the origin with houses on both sides. */
const BLOCK: TestCityOptions = {
  structures: [
    { x: -9, z: 14, ...HOUSE },
    { x: 9, z: 14, ...HOUSE },
    { x: -9, z: 30, ...HOUSE },
    { x: 9, z: 30, ...HOUSE },
    // A low shop the hatchling can walk through.
    { x: 0, z: 46, w: 6, d: 6, height: LIZARD.stages[0].trampleHeight - 0.5, hp: 120, value: 12, cls: 'shop' },
    // An apartment block at the end of the street.
    { x: 0, z: 72, w: 14, d: 10, height: 20, hp: 300, value: 40, cls: 'apartment' },
  ],
  props: [
    { kind: 'car_sedan', x: 3, z: 6 },
    { kind: 'car_taxi', x: -6.5, z: 24 },
    { kind: 'kiosk', x: 2, z: 38 },
    { kind: 'tree_a', x: -3, z: 40 },
  ],
};

describe('scripted scenario: a hatchling wrecks a block', () => {
  it('raises the bar by exactly what it destroys, passes the first mark and cocoons', () => {
    const marks = computeBarMarks(makeTestCity(BLOCK).city, 0);
    const blockValue = 4 * HOUSE.value + 12 + 40 + PROP_KINDS.car_sedan.value + PROP_KINDS.car_taxi.value + PROP_KINDS.kiosk.value;
    expect(marks[0]).toBeCloseTo(0.35 * blockValue, 9);

    // The first mark is the real one for this block; the later ones are put out of reach so
    // that this one block cannot end the match.
    const world = makeTestWorld({ ...BLOCK, marks: [marks[0], 1e6, 2e6] });
    placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    const s = createScript(world);
    const k = s.k;
    const tally = world.players[KAIJU_PLAYER].tally;
    const A = LIZARD.actions;
    let expected = 0;
    const bar = () => world.match.barPoints;

    // 1. Up the street. The parked sedan is underfoot.
    s.walkTo(0, 14);
    expected += PROP_KINDS.car_sedan.value;
    expect(bar()).toBeCloseTo(expected, 6);
    expect(tally.wrecked.car).toBe(1);

    // 2. The house on the east side: two swipes bring it down.
    s.face(90 * DEG);
    s.swipe();
    expect(world.structureHp[1]).toBe(HOUSE.hp - A.swipe.structureDamage[0]);
    expected += (HOUSE.value * A.swipe.structureDamage[0]) / HOUSE.hp;
    expect(bar()).toBeCloseTo(expected, 6);
    s.swipe();
    expect(isStanding(world.cityQuery, 1)).toBe(false);
    expected = PROP_KINDS.car_sedan.value + HOUSE.value;
    expect(bar()).toBeCloseTo(expected, 6);
    expect(tally.wrecked.house).toBe(1);

    // 3. A stomp shakes the house across the street (the rubble takes nothing), then claws finish it.
    s.face(-90 * DEG);
    s.hold(Btn.strike, A.stomp.holdTime);
    s.untilIdle();
    const afterStomp = world.structureHp[0];
    expect(afterStomp).toBeLessThan(HOUSE.hp);
    expect(afterStomp).toBeGreaterThan(HOUSE.hp - A.stomp.structureDamage[0]);
    expect(world.structureHp[1]).toBe(0);
    expect(bar()).toBeCloseTo(expected + (HOUSE.value * (HOUSE.hp - afterStomp)) / HOUSE.hp, 4);
    s.swipe();
    s.swipe();
    expect(isStanding(world.cityQuery, 0)).toBe(false);
    expected += HOUSE.value;
    expect(bar()).toBeCloseTo(expected, 4);

    // 4. Pick up the taxi parked up the street and throw it through the next house's wall.
    s.walkTo(0, 24);
    s.face(-90 * DEG);
    s.tap(Btn.grab);
    s.untilIdle();
    expect(k.held).toEqual({ kind: 'prop', prop: 'car_taxi' });
    expected += PROP_KINDS.car_taxi.value;
    expect(bar()).toBeCloseTo(expected, 4);
    s.face(yawFromTo(k.x, k.z, 9, 30));
    s.tap(Btn.grab);
    s.wait(60);
    expect(k.held).toBeNull();
    expect(world.structureHp[3]).toBe(HOUSE.hp - A.throw.structureDamage[0]);
    expected += (HOUSE.value * A.throw.structureDamage[0]) / HOUSE.hp;
    expect(bar()).toBeCloseTo(expected, 4);

    // 5. Finish that house and its neighbor.
    s.walkTo(0, 30);
    s.face(90 * DEG);
    s.swipe();
    s.face(-90 * DEG);
    s.swipe();
    s.swipe();
    expect(isStanding(world.cityQuery, 2)).toBe(false);
    expect(isStanding(world.cityQuery, 3)).toBe(false);
    expected = PROP_KINDS.car_sedan.value + PROP_KINDS.car_taxi.value + 4 * HOUSE.value;
    expect(bar()).toBeCloseTo(expected, 4);
    expect(tally.wrecked.house).toBe(4);

    // The bar is past the first mark by now: the mark fell exactly once, and the molt is offered.
    expect(bar()).toBeGreaterThan(marks[0]);
    const markEvents = eventsOf(s.events, 'barMark');
    expect(markEvents.map((e) => e.mark)).toEqual([1]);
    expect(markEvents[0].points).toBeGreaterThanOrEqual(marks[0]);
    expect(markEvents[0].points).toBeLessThan(marks[0] + HOUSE.value);
    expect(eventsOf(s.events, 'moltAvailable')).toMatchObject([{ kaiju: 0, mark: 1 }]);
    expect(eventsOf(s.events, 'moltAvailable')[0].tick).toBe(markEvents[0].tick);
    expect(k.moltAvailable).toBe(true);

    // 6. On through the kiosk and the low shop: walking is enough.
    s.walkTo(0, 52);
    expected += PROP_KINDS.kiosk.value + 12;
    expect(bar()).toBeCloseTo(expected, 4);
    expect(tally.wrecked.kiosk).toBe(1);
    expect(tally.wrecked.shop).toBe(1);

    // 7. All that wrecking filled the rage meter: breathe on the apartment block.
    expect(k.rage).toBe(COMBAT_RULES.rageMax);
    s.face(0);
    s.tap(Btn.special);
    s.untilIdle();
    // The special spent the whole meter, and what it burnt does not refill it.
    expect(k.rage).toBe(COMBAT_RULES.rageMax - A.special.rageCost);
    const burnt = A.special.structureDps[0] * A.special.timing.active;
    expect(300 - world.structureHp[5]).toBeCloseTo(burnt, 3);
    expected += (40 * burnt) / 300;
    expect(bar()).toBeCloseTo(expected, 3);
    expect(tally.wrecked.apartment).toBe(0);

    // The whole rampage, added up.
    expect(bar()).toBeCloseTo(blockValue - 40 * (1 - burnt / 300), 3);
    expect(tally.barPoints).toBeCloseTo(bar(), 6);
    expect(world.match.marksReached).toBe(1);
    // Every collapse was announced once, in the order it happened.
    const fallen = eventsOf(s.events, 'structureStage').filter((e) => e.stage === 3);
    expect(fallen.map((e) => e.id)).toEqual([1, 0, 3, 2, 4]);
    expect(fallen.every((e) => e.by === KAIJU_PLAYER)).toBe(true);
    expect(fallen.map((e) => e.cause)).toEqual(['swipe', 'swipe', 'swipe', 'swipe', 'trample']);
    // The humans could have read every attack coming.
    const tells = eventsOf(s.events, 'kaijuAction').filter((e) => e.phase === 'windup');
    expect(tells.filter((e) => e.action === 'swipe').length).toBe(8);
    expect(tells.filter((e) => e.action === 'stomp').length).toBe(1);
    expect(tells.filter((e) => e.action === 'grab').length).toBe(1);
    expect(tells.filter((e) => e.action === 'throw').length).toBe(1);
    expect(tells.filter((e) => e.action === 'special').length).toBe(1);

    // A client that only listened to the events has the same city.
    expectMirrorMatches(world, s.events);

    // 8. Time to grow: hold Molt.
    s.hold(Btn.molt, A.molt.holdTime);
    expect(k.phase).toBe('cocoon');
    expect(eventsOf(s.events, 'cocoon').length).toBe(1);
    expect(world.match.phase).toBe('playing');
  });

  it('tells clients about everything the kaiju picks up or eats off the street', () => {
    const world = makeTestWorld({
      props: [
        { kind: 'car_van', x: 0, z: 3 },
        { kind: 'kiosk', x: 0, z: 14.5 },
        { kind: 'bus', x: 8, z: 20 },
      ],
    });
    placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    const s = createScript(world);
    const k = s.k;
    k.hp = 400;
    // The van underfoot is crushed to a wreck; pick the wreck up and eat it.
    s.wait(2);
    s.hold(Btn.grab, LIZARD.actions.eat.holdTime);
    s.untilIdle();
    expect(k.hp).toBe(400 + LIZARD.actions.eat.heal);
    // Wait out the cooldown, walk up to the kiosk and eat it where it stands.
    s.wait(Math.ceil(LIZARD.actions.eat.cooldown * TICK_RATE));
    s.walkTo(0, 9.5);
    s.face(0);
    s.hold(Btn.grab, LIZARD.actions.eat.holdTime);
    s.untilIdle();
    expect(k.hp).toBe(400 + 2 * LIZARD.actions.eat.heal);
    // Then carry the bus off.
    s.walkTo(1, 18);
    s.face(yawFromTo(k.x, k.z, 8, 20));
    s.tap(Btn.grab);
    s.untilIdle();
    expect(k.held).toEqual({ kind: 'prop', prop: 'bus' });
    expect(eventsOf(s.events, 'kaijuHeld').map((e) => [e.reason, e.source])).toEqual([
      ['grab', 'propWreck'],
      ['eat', 'none'],
      ['eat', 'prop'],
      ['grab', 'prop'],
    ]);
    expect(bitCount(world.propAlive)).toBe(0);
    expect(bitCount(world.propWreck)).toBe(0);
    expectMirrorMatches(world, s.events);
  });

  it('plays out the same way every time', () => {
    const play = (): { bar: number; events: number; x: number; z: number } => {
      const world = makeTestWorld({ ...BLOCK });
      placeKaiju(world, 0, 0, 0);
      parkUnits(world);
      const s = createScript(world);
      s.walkTo(0, 14);
      s.face(90 * DEG);
      s.swipe();
      s.hold(Btn.strike, LIZARD.actions.stomp.holdTime);
      s.untilIdle();
      s.walkTo(0, 50);
      return { bar: world.match.barPoints, events: s.events.length, x: world.kaijus[0].x, z: world.kaijus[0].z };
    };
    expect(play()).toEqual(play());
  });
});

describe('scripted rampage in the real city', () => {
  it('a hatchling that keeps attacking the nearest building moves the bar by what it destroys', () => {
    const world = makeTestWorld({ realCity: true, people: 'kaiju', seed: 11 });
    // The squads hold their fire, so every point on the bar is the kaiju's own work.
    holdFire(world);
    const k = world.kaijus[0];
    const ids: number[] = [];
    let aimYaw = k.yaw;
    let wrecked = 0;
    let lastBar = 0;
    const all: SimEvent[] = [];
    for (let tick = 0; tick < TICK_RATE * 75 && world.match.phase === 'playing'; tick++) {
      // Head for the nearest standing structure within sight; swipe when it is in reach.
      let target = -1;
      let best = Infinity;
      structuresInCircle(world.cityQuery, k.x, k.z, 120, ids);
      for (const id of ids) {
        const d = distToStructure(world.cityIndex, id, k.x, k.z);
        if (d < best) {
          best = d;
          target = id;
        }
      }
      let buttons = 0;
      let moveZ = 1;
      if (target >= 0) {
        const s = world.city.structures[target];
        aimYaw = yawFromTo(k.x, k.z, s.x, s.z);
        if (best < k.radius * 2) {
          moveZ = 0;
          // Alternate swipes and stomps: tap, or keep the button down.
          const cycle = tick % 90;
          if (cycle < 2 || (cycle >= 45 && cycle < 45 + 14)) buttons = Btn.strike;
        }
      }
      const events = world.step([input({ aimYaw, moveZ, buttons })]);
      all.push(...events);
      wrecked += eventsOf(events, 'structureStage').filter((e) => e.stage === 3).length;
      expect(world.match.barPoints).toBeGreaterThanOrEqual(lastBar);
      lastBar = world.match.barPoints;
    }
    expect(wrecked).toBeGreaterThan(2);
    expect(world.match.barPoints).toBeGreaterThan(0);
    // Float32 structure hp: allow a small relative error over many partial hits.
    expect(Math.abs(world.match.barPoints - valueDestroyed(world))).toBeLessThan(0.001 * world.match.barPoints + 0.01);
    expect(world.players[KAIJU_PLAYER].tally.barPoints).toBeCloseTo(world.match.barPoints, 6);
    const tallied = Object.values(world.players[KAIJU_PLAYER].tally.wrecked).reduce((a, b) => a + b, 0);
    expect(tallied).toBeGreaterThanOrEqual(wrecked);
    expect(k.rage).toBeGreaterThan(0);
    expectMirrorMatches(world, all);
  });
});
