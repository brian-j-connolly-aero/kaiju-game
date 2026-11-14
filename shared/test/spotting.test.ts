import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  COMBAT_RULES,
  decodeSnapshot,
  encodeSnapshot,
  LIZARD,
  MATCH_RULES,
  snapshotOfWorld,
  TICK_RATE,
  unitSeesKaiju,
  type SimEvent,
  type World,
} from '../src/index';
import { eventsOf, holdFire, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const R = LIZARD.stages[0].bodyRadius;

/** Everybody a long way from the kaiju (at the origin) and ordered to hold fire, in bounds wide enough to stand back in. */
function field(options: TestWorldOptions = {}): World {
  const world = makeTestWorld(options);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, 0, 0, 0);
  holdFire(world);
  return world;
}

function cues(events: SimEvent[]): string[] {
  return eventsOf(events, 'voice').map((e) => e.cue).filter((c) => c === 'kaiju.spotted' || c === 'kaiju.lost');
}

describe('spotted: a driven unit has the kaiju in sight within the spotting range', () => {
  it('takes a driven unit, in range, with a clear line of sight', () => {
    const world = field({ structures: [{ x: 300, z: 60, w: 10, d: 60, height: 20 }] });
    const k = world.kaijus[0];
    run(world, 2);
    expect(k.spotted).toBe(false);

    // Just inside the range (measured to the kaiju's skin).
    placeUnit(world, 0, 0, COMBAT_RULES.spotRange + R - 1);
    run(world, 1);
    expect(k.spotted).toBe(true);
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).kaijus[0]).toMatchObject({ spotted: true, known: true });

    placeUnit(world, 0, 0, COMBAT_RULES.spotRange + R + 1);
    run(world, 1);
    expect(k.spotted).toBe(false);

    // A sub-unit that close does not count: the spotter is the unit somebody drives.
    placeUnit(world, 1, 0, 60);
    run(world, 1);
    expect(k.spotted).toBe(false);
    expect(k.known).toBe(true);
    placeUnit(world, 1, 900, 900);

    // Close, but behind a building.
    placeKaiju(world, 250, 60, 0);
    placeUnit(world, 0, 350, 60);
    run(world, 1);
    expect(unitSeesKaiju(world, world.units[0], k, COMBAT_RULES.spotRange)).toBe(false);
    expect(k.spotted).toBe(false);
    world.structureHp[0] = 0;
    run(world, 1);
    expect(k.spotted).toBe(true);
  });

  it('counts the leader of a bot squad too: bots play by the same rules', () => {
    const world = field();
    const k = world.kaijus[0];
    expect(world.players[2].bot).toBe(true);
    placeUnit(world, 4, 80, 0);
    run(world, 1);
    expect(k.spotted).toBe(true);
    placeUnit(world, 4, 900, 900);
    placeUnit(world, 5, 80, 0);
    run(world, 1);
    expect(k.spotted).toBe(false);
  });

  it('sees from a bridge deck and onto one', () => {
    const world = field({
      water: [[-400, 40, 400, 110]],
      structures: [
        { x: 0, z: 75, w: 16, d: 74, height: 8, passable: true },
        { x: 100, z: 75, w: 16, d: 74, height: 8, passable: true },
      ],
    });
    const k = placeKaiju(world, 0, 75, 0);
    // The spotter stands on the other bridge; the kaiju is in the middle of the first.
    placeUnit(world, 0, 100, 75);
    run(world, 1);
    expect(k.spotted).toBe(true);
    expect(world.units[0].inWater).toBe(false);
  });
});

describe('known: when the humans\' map shows the kaiju', () => {
  it('at stage 1 needs a unit with line of sight within 250 m', () => {
    const world = field({ structures: [{ x: 0, z: 100, w: 80, d: 10, height: 20 }] });
    const k = world.kaijus[0];
    let events = run(world, 2);
    expect(k.known).toBe(false);

    // Any unit will do, sub-units included.
    placeUnit(world, 6, MATCH_RULES.revealSightRange + R - 2, 0);
    events = run(world, 1);
    expect(k.known).toBe(true);
    expect(cues(events)).toEqual(['kaiju.spotted']);
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).kaijus[0]).toMatchObject({ known: true, spotted: false });

    placeUnit(world, 6, MATCH_RULES.revealSightRange + R + 2, 0);
    events = run(world, 1);
    expect(k.known).toBe(false);
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).kaijus[0].known).toBe(false);
    // The radio does not chatter about every flicker (the cue is throttled), but the state is exact.
    placeUnit(world, 6, 0, 200);
    run(world, 1);
    // Behind the wall at z = 100: in range but out of sight.
    expect(k.known).toBe(false);
    // A few steps to the side it looks past the end of the wall.
    placeUnit(world, 6, 120, 200);
    run(world, 1);
    expect(k.known).toBe(true);
  });

  it('shows it for 3 s after it roars, stomps or wrecks something, even with nobody looking', () => {
    const world = field({ structures: [{ x: 0, z: 8, w: 6, d: 6, height: 5, hp: 30 }] });
    const k = world.kaijus[0];
    run(world, 2);
    expect(k.known).toBe(false);

    k.moves = ['roar', 'none'];
    let events = run(world, 2, [input({ buttons: Btn.move1 })]);
    expect(k.known).toBe(true);
    expect(cues(events)).toEqual(['kaiju.spotted']);
    events = run(world, Math.round(MATCH_RULES.revealAfterNoise * TICK_RATE) - 3);
    expect(k.known).toBe(true);
    events = run(world, 6);
    expect(k.known).toBe(false);

    // A swipe that brings the kiosk-sized house down makes noise too.
    run(world, TICK_RATE * 20);
    events = run(world, 3, [input({ buttons: Btn.strike })]);
    events.push(...run(world, 40));
    expect(eventsOf(events, 'structureStage').some((e) => e.stage === 3)).toBe(true);
    expect(k.knownTimer).toBeGreaterThan(0);
    expect(k.known).toBe(true);
    run(world, Math.round(MATCH_RULES.revealAfterNoise * TICK_RATE) + 5);
    expect(k.known).toBe(false);
  });

  it('is always on the map at stages 2 and 3', () => {
    const world = field();
    for (const stage of [2, 3] as const) {
      beginStage(world, stage);
      world.match.bounds = world.match.stageBounds[2];
      parkUnits(world);
      placeKaiju(world, -900, -900, 0);
      const events = run(world, 30);
      expect(world.kaijus[0].known).toBe(true);
      expect(world.kaijus[0].spotted).toBe(false);
      expect(cues(events).filter((c) => c === 'kaiju.lost')).toEqual([]);
    }
  });
});
