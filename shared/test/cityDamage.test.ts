import { describe, expect, it } from 'vitest';
import {
  beginStage,
  bitGet,
  COMBAT_RULES,
  computeBarMarks,
  LIZARD,
  MATCH_RULES,
  PROP_KINDS,
  STAGES,
  takeProp,
  takePropWreck,
  TALLY_CLASSES,
  TICK_RATE,
  type DamageKind,
  type SimEvent,
  type World,
} from '../src/index';
import {
  eventsOf,
  HUMAN_PLAYER,
  input,
  KAIJU_PLAYER,
  makeTestCity,
  makeTestWorld,
  parkUnits,
  placeKaiju,
  placeUnit,
  run,
  valueDestroyed,
} from './helpers';

function damage(world: World, id: number, amount: number, by: number, cause: DamageKind = 'swipe'): SimEvent[] {
  world.structureHits.push({ id, damage: amount, by, cause });
  return world.step();
}

describe('the destruction bar', () => {
  it('computes the three marks from the value actually present, as the design specifies', () => {
    const bar = MATCH_RULES.bar;
    const near = STAGES[0].boundsHalfSize - 20;
    const mid = STAGES[1].boundsHalfSize - 20;
    const far = STAGES[1].boundsHalfSize + 200;

    // A lot of value everywhere: each mark is its fraction of the value inside its bounds.
    let { city } = makeTestCity({
      structures: [
        { x: near, z: 0, w: 10, d: 10, height: 10, value: 1000 },
        { x: mid, z: 0, w: 10, d: 10, height: 10, value: 3000 },
        { x: far, z: 0, w: 10, d: 10, height: 10, value: 20000 },
      ],
      props: [{ kind: 'bus', x: 10, z: 10 }, { kind: 'tree_a', x: 12, z: 10 }],
    });
    const v1 = 1000 + PROP_KINDS.bus.value;
    let marks = computeBarMarks(city, 0);
    expect(marks[0]).toBeCloseTo(bar.p1 * v1, 9);
    expect(marks[1]).toBeCloseTo(bar.p2 * (v1 + 3000), 9);
    expect(marks[2]).toBeCloseTo(bar.p3 * (v1 + 3000 + 20000), 9);
    expect(bar.p2 * (v1 + 3000)).toBeGreaterThan(bar.growth * marks[0]);

    // A city with nothing more beyond the neighborhood: later marks still grow by the minimum step.
    ({ city } = makeTestCity({ structures: [{ x: near, z: 0, w: 10, d: 10, height: 10, value: 1000 }] }));
    marks = computeBarMarks(city, 0);
    expect(marks[0]).toBeCloseTo(bar.p1 * 1000, 9);
    expect(marks[1]).toBeCloseTo(bar.growth * marks[0], 9);
    expect(marks[2]).toBeCloseTo(Math.max(bar.growth * marks[1], bar.p3 * 1000), 9);
    expect(marks[2]).toBeGreaterThanOrEqual(bar.growth * marks[1]);
  });

  it('gives partial credit for partial damage, from every kind of source, and nothing for rubble', () => {
    const world = makeTestWorld({ structures: [{ x: 200, z: 200, w: 20, d: 20, height: 30, hp: 1000, value: 200, cls: 'office' }] });
    let expected = 0;
    const causes: DamageKind[] = ['swipe', 'stomp', 'thrown', 'beam', 'wade', 'rocket', 'shell', 'arty'];
    causes.forEach((cause, i) => {
      damage(world, 0, 100, i % 2 === 0 ? KAIJU_PLAYER : HUMAN_PLAYER, cause);
      expected += 200 * (100 / 1000);
      expect(world.match.barPoints).toBeCloseTo(expected, 6);
    });
    expect(world.structureHp[0]).toBe(200);
    // Whoever finishes it gets the building on their tally; the points went to whoever did the damage.
    const events = damage(world, 0, Infinity, HUMAN_PLAYER, 'shell');
    expect(world.match.barPoints).toBeCloseTo(200, 6);
    expect(eventsOf(events, 'structureStage')).toMatchObject([{ id: 0, stage: 3, by: HUMAN_PLAYER, cause: 'shell' }]);
    expect(world.players[HUMAN_PLAYER].tally.wrecked.office).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.office).toBe(0);
    expect(world.players[KAIJU_PLAYER].tally.barPoints).toBeCloseTo(80, 6);
    expect(world.players[HUMAN_PLAYER].tally.barPoints).toBeCloseTo(120, 6);

    // Rubble: shots that land on it cost nothing, and it cannot be destroyed twice.
    expect(eventsOf(damage(world, 0, 500, HUMAN_PLAYER, 'shell'), 'structureStage')).toEqual([]);
    expect(world.match.barPoints).toBeCloseTo(200, 6);
    expect(world.match.barPoints).toBeCloseTo(valueDestroyed(world), 6);
  });

  it('tallies what each player flattened by structure class, and cars and kiosks', () => {
    const world = makeTestWorld({
      structures: [
        { x: 200, z: 200, w: 10, d: 10, height: 10, cls: 'house' },
        { x: 230, z: 200, w: 10, d: 10, height: 10, cls: 'house' },
        { x: 260, z: 200, w: 10, d: 10, height: 10, cls: 'tower' },
        { x: 290, z: 200, w: 10, d: 10, height: 10, cls: 'landmark', landmark: 'Clock Tower' },
      ],
      props: [
        { kind: 'car_sedan', x: 300, z: 300 },
        { kind: 'kiosk', x: 310, z: 300 },
        { kind: 'tree_a', x: 320, z: 300 },
      ],
    });
    damage(world, 0, Infinity, KAIJU_PLAYER, 'trample');
    damage(world, 1, Infinity, HUMAN_PLAYER, 'shell');
    damage(world, 2, Infinity, KAIJU_PLAYER, 'beam');
    damage(world, 3, Infinity, 2, 'rocket');
    world.propHits.push({ id: 0, by: KAIJU_PLAYER, cause: 'stomp' }, { id: 1, by: HUMAN_PLAYER, cause: 'shell' }, { id: 2, by: KAIJU_PLAYER, cause: 'stomp' });
    const events = world.step();
    const tally = (p: number) => world.players[p].tally.wrecked;
    expect(tally(KAIJU_PLAYER)).toMatchObject({ house: 1, tower: 1, car: 1, kiosk: 0, landmark: 0 });
    expect(tally(HUMAN_PLAYER)).toMatchObject({ house: 1, tower: 0, car: 0, kiosk: 1 });
    expect(tally(2)).toMatchObject({ landmark: 1 });
    // Every class has a counter for every player.
    for (const p of world.players) expect(Object.keys(p.tally.wrecked).sort()).toEqual([...TALLY_CLASSES].sort());
    // Props go in one event per player and cause; trees count for nothing.
    expect(eventsOf(events, 'propsDestroyed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ids: [0, 2], by: KAIJU_PLAYER, cause: 'stomp' }),
        expect.objectContaining({ ids: [1], by: HUMAN_PLAYER, cause: 'shell' }),
      ]),
    );
    expect(bitGet(world.propWreck, 0)).toBe(true);
    expect(bitGet(world.propWreck, 1)).toBe(false);
    expect(world.match.barPoints).toBeCloseTo(valueDestroyed(world), 6);
  });

  it('lets a kaiju take a prop or a wreck out of the city, counted once', () => {
    const world = makeTestWorld({ props: [{ kind: 'car_van', x: 300, z: 300 }, { kind: 'truck', x: 320, z: 300 }] });
    expect(takeProp(world, 0, KAIJU_PLAYER)).toBe(true);
    expect(takeProp(world, 0, KAIJU_PLAYER)).toBe(false);
    expect(bitGet(world.propAlive, 0)).toBe(false);
    expect(bitGet(world.propWreck, 0)).toBe(false);
    expect(world.match.barPoints).toBe(PROP_KINDS.car_van.value);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.car).toBe(1);
    // A prop that is already gone is not destroyed again by a later hit in the same tick.
    world.propHits.push({ id: 0, by: HUMAN_PLAYER, cause: 'shell' });
    expect(eventsOf(world.step(), 'propsDestroyed')).toEqual([]);
    expect(world.match.barPoints).toBe(PROP_KINDS.car_van.value);

    expect(takePropWreck(world, 1)).toBe(false);
    world.propHits.push({ id: 1, by: KAIJU_PLAYER, cause: 'trample' });
    world.step();
    expect(takePropWreck(world, 1)).toBe(true);
    expect(takePropWreck(world, 1)).toBe(false);
    expect(bitGet(world.propWreck, 1)).toBe(false);
  });

  it('feeds rage only from the kaiju\'s own wrecking, a whole stage segment being worth the rule', () => {
    const world = makeTestWorld({
      marks: [100, 300, 900],
      structures: [{ x: 200, z: 200, w: 20, d: 20, height: 30, hp: 1000, value: 1000 }],
    });
    const k = world.kaijus[0];
    damage(world, 0, 10, KAIJU_PLAYER);
    expect(k.rage).toBeCloseTo((COMBAT_RULES.ragePerBarSegment * 10) / 100, 6);
    k.rage = 0;
    damage(world, 0, 10, HUMAN_PLAYER, 'shell');
    expect(k.rage).toBe(0);
    // At stage 2 the same points are a smaller share of a longer segment.
    world.match.stage = 2;
    damage(world, 0, 10, KAIJU_PLAYER);
    expect(k.rage).toBeCloseTo((COMBAT_RULES.ragePerBarSegment * 10) / 200, 6);
  });
});

describe('upgrade and Tier 2 hooks in city damage', () => {
  it('scales bar points by the modifier of whoever caused the damage', () => {
    const world = makeTestWorld({ structures: [{ x: 200, z: 200, w: 20, d: 20, height: 30, hp: 1000, value: 100 }] });
    world.kaijus[0].mods.mult.barPoints = 1.5;
    world.squads[0].mods.mult.barPoints = 0.5;
    damage(world, 0, 100, KAIJU_PLAYER);
    expect(world.match.barPoints).toBeCloseTo(15, 6);
    damage(world, 0, 100, HUMAN_PLAYER, 'shell');
    expect(world.match.barPoints).toBeCloseTo(20, 6);
    // Another squad without the upgrade pays in full, and so does damage by nobody.
    damage(world, 0, 100, 2, 'shell');
    damage(world, 0, 100, -1, 'shell');
    expect(world.match.barPoints).toBeCloseTo(40, 6);
  });

  it('insurance rider: the first landmark damaged after the policy is free adds nothing to the bar', () => {
    const world = makeTestWorld({
      structures: [
        { x: 200, z: 200, w: 20, d: 20, height: 30, hp: 100, value: 500, landmark: 'City Hall', cls: 'landmark' },
        { x: 260, z: 200, w: 20, d: 20, height: 30, hp: 100, value: 700, landmark: 'Cathedral', cls: 'landmark' },
        { x: 320, z: 200, w: 20, d: 20, height: 30, hp: 100, value: 50 },
      ],
    });
    // Without the upgrade nothing is insured.
    damage(world, 2, 50, KAIJU_PLAYER);
    expect(world.match.barPoints).toBeCloseTo(25, 6);

    world.squads[1].mods.flags.push('insuranceRider');
    damage(world, 2, 50, KAIJU_PLAYER);
    expect(world.match.barPoints).toBeCloseTo(50, 6);
    // The first landmark hit is the insured one, for all of its damage, whoever deals it.
    damage(world, 1, 40, KAIJU_PLAYER);
    const events = damage(world, 1, 60, HUMAN_PLAYER, 'shell');
    expect(world.structureHp[1]).toBe(0);
    expect(world.match.barPoints).toBeCloseTo(50, 6);
    expect(world.insuredStructures).toEqual([1]);
    // It still falls, and still counts as flattened.
    expect(eventsOf(events, 'structureStage')).toMatchObject([{ id: 1, stage: 3 }]);
    expect(world.players[HUMAN_PLAYER].tally.wrecked.landmark).toBe(1);
    // One policy, one landmark.
    damage(world, 0, 100, KAIJU_PLAYER);
    expect(world.match.barPoints).toBeCloseTo(550, 6);
  });

  it('shields reduce damage to the structures inside them, but not a trample', () => {
    const world = makeTestWorld({
      structures: [
        { x: 200, z: 200, w: 20, d: 20, height: 30, hp: 1000, value: 100 },
        { x: 400, z: 200, w: 20, d: 20, height: 30, hp: 1000, value: 100 },
      ],
    });
    world.shields.push({ x: 190, z: 200, radius: 30, damageMult: 0.5, squad: 0 });
    world.shields.push({ x: 210, z: 200, radius: 30, damageMult: 0.8, squad: 1 });
    damage(world, 0, 200, KAIJU_PLAYER);
    damage(world, 1, 200, KAIJU_PLAYER);
    // The strongest shield wins; they do not stack. Less damage, so fewer points.
    expect(world.structureHp[0]).toBe(900);
    expect(world.structureHp[1]).toBe(800);
    expect(world.match.barPoints).toBeCloseTo(10 + 20, 6);
    damage(world, 0, Infinity, KAIJU_PLAYER, 'trample');
    expect(world.structureHp[0]).toBe(0);
  });

  it('drops the units on a bridge deck into the river when it collapses', () => {
    const world = makeTestWorld({
      structures: [{ x: 0, z: 100, w: 16, d: 60, height: 8, hp: 500, passable: true }],
      water: [[-200, 75, 200, 125]],
    });
    parkUnits(world);
    const onDeck = placeUnit(world, 0, 0, 100);
    const onBank = placeUnit(world, 1, 0, 60);
    const nearby = placeUnit(world, 2, 30, 100);
    run(world, 2);
    expect(onDeck.inWater).toBe(false);

    damage(world, 0, 400, KAIJU_PLAYER, 'stomp');
    expect(onDeck.hp).toBe(onDeck.maxHp);
    let events = damage(world, 0, 100, KAIJU_PLAYER, 'stomp');
    expect(eventsOf(events, 'structureStage')).toMatchObject([{ id: 0, stage: 3 }]);
    // The fall lands on the tick the deck goes, through the same door as every other hit
    // (no hit is left queued from one tick to the next), and only once.
    expect(onDeck.maxHp - onDeck.hp).toBe(COMBAT_RULES.bridgeFallDamage);
    expect(world.hits).toEqual([]);
    events = [...events, ...world.step()];
    expect(onDeck.maxHp - onDeck.hp).toBe(COMBAT_RULES.bridgeFallDamage);
    expect(onDeck.shaken).toBeGreaterThan(0);
    expect(onDeck.inWater).toBe(true);
    expect(eventsOf(events, 'unitHit')).toMatchObject([{ unit: 0, cause: 'stomp' }]);
    expect(eventsOf(events, 'unitShaken')).toMatchObject([{ unit: 0 }]);
    expect(onBank.hp).toBe(onBank.maxHp);
    expect(nearby.hp).toBe(nearby.maxHp);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.bridge).toBe(1);
  });
});

describe('contact damage from the kaiju walking', () => {
  it('flattens what it can trample outright and credits the full value', () => {
    const world = makeTestWorld({
      structures: [{ x: 0, z: 12, w: 6, d: 6, height: LIZARD.stages[0].trampleHeight - 0.5, hp: 300, value: 30, cls: 'shop' }],
      props: [{ kind: 'kiosk', x: 0, z: 30 }, { kind: 'lamp', x: 1, z: 34 }],
    });
    placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    const events = run(world, TICK_RATE * 5, [input({ moveZ: 1 })]);
    expect(world.structureHp[0]).toBe(0);
    expect(eventsOf(events, 'structureStage')).toMatchObject([{ id: 0, stage: 3, by: KAIJU_PLAYER, cause: 'trample' }]);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.shop).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.wrecked.kiosk).toBe(1);
    expect(bitGet(world.propAlive, 1)).toBe(false);
    expect(world.match.barPoints).toBeCloseTo(30 + PROP_KINDS.kiosk.value, 6);
    expect(world.match.barPoints).toBeCloseTo(valueDestroyed(world), 6);
  });

  it('grinds down a tower the titan wades through, with partial credit along the way', () => {
    const world = makeTestWorld({
      structures: [{ x: 0, z: 60, w: 30, d: 30, height: 150, hp: 6000, value: 520, cls: 'tower' }],
    });
    beginStage(world, 3);
    // Standing with its belly in the tower's front wall.
    placeKaiju(world, 0, 60 - 15 - LIZARD.stages[2].bodyRadius + 5, 0);
    parkUnits(world);
    // Touching it for a while: some hp gone, the same share of its value on the bar.
    run(world, TICK_RATE, [input()]);
    const lost = 6000 - world.structureHp[0];
    expect(lost).toBeCloseTo(LIZARD.stages[2].wadeContactDps, 0);
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(6000);
    expect(world.match.barPoints).toBeCloseTo((520 * lost) / 6000, 3);
    // Standing in it long enough brings it down.
    const events = run(world, Math.ceil((6000 / LIZARD.stages[2].wadeContactDps) * TICK_RATE) + 5, [input()]);
    expect(world.structureHp[0]).toBe(0);
    expect(eventsOf(events, 'structureStage').at(-1)).toMatchObject({ stage: 3, cause: 'wade', by: KAIJU_PLAYER });
    expect(world.players[KAIJU_PLAYER].tally.wrecked.tower).toBe(1);
    expect(world.match.barPoints).toBeCloseTo(520, 3);
  });
});
