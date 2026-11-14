/**
 * The kaiju bot and the city (docs/ROADMAP.md phase 2; DESIGN.md section 5, "Bots"): it chases
 * the special buildings between fights and picks up the city weapons that suit the moment.
 */

import { describe, expect, it } from 'vitest';
import { type SimEvent, type World } from '../src/index';
import { eventsOf, holdFire, makeTestWorld, parkUnits, placeKaiju, placeUnit, type TestWorldOptions } from './helpers';

/** The kaiju is a bot at its best; the squads' bots stand still and hold their fire. */
function botArena(options: TestWorldOptions): World {
  const world = makeTestWorld({
    ...options,
    people: 'none',
    config: { bots: { kaijuHandicap: 0, humanHandicap: 1 }, crates: false },
  });
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  holdFire(world);
  return world;
}

/** Steps until an event of `type` comes (at most `seconds`); returns every event so far. */
function until(world: World, type: SimEvent['type'], seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * 30; i++) {
    const tick = world.step();
    events.push(...tick);
    if (tick.some((e) => e.type === type)) break;
  }
  return events;
}

/** A unit that stands where it is put, with plenty of hp. */
function stand(world: World, id: number, x: number, z: number): void {
  const u = placeUnit(world, id, x, z);
  u.hp = 10000;
  u.maxHp = 10000;
}

const house = (x: number, z: number) => ({ x, z, w: 9, d: 10, height: 6, hp: 80, value: 8 });

describe('the kaiju bot and the special buildings', () => {
  it('goes for a special building close by when no squad is, before the houses round it', () => {
    const world = botArena({
      structures: [
        { archetype: 'substation_a', x: 0, z: 70, w: 22, d: 16, height: 9, hp: 150, value: 15 },
        house(22, 8),
        house(-22, 8),
        house(24, -18),
      ],
    });
    const events = until(world, 'powerSurge', 25);
    expect(eventsOf(events, 'powerSurge')).toHaveLength(1);
    expect([1, 2, 3].map((id) => world.structureHp[id])).toEqual([80, 80, 80]);
  });

  it('wrecks the gas station first when squads stand by it', () => {
    const world = botArena({
      structures: [
        { archetype: 'substation_a', x: -60, z: 0, w: 22, d: 16, height: 9, hp: 150, value: 15 },
        { archetype: 'gasstation_a', x: 64, z: 0, w: 26, d: 20, height: 7, hp: 160, value: 15 },
      ],
    });
    stand(world, 1, 64, 17);
    stand(world, 2, 54, 17);
    const events = until(world, 'fireball', 30);
    expect(eventsOf(events, 'fireball')).toHaveLength(1);
    expect(eventsOf(events, 'powerSurge')).toHaveLength(0);
    // The squads by it were caught in it.
    expect(world.units[1].hp).toBeLessThan(10000);
  });
});

describe('the kaiju bot and the city as a weapon', () => {
  it('picks up a propane tank and throws it at a group in range', () => {
    const world = botArena({ props: [{ kind: 'propane', x: 0, z: 12 }] });
    stand(world, 1, 0, 42);
    stand(world, 2, 5, 44);
    stand(world, 3, -5, 44);
    const events = until(world, 'propaneBlast', 20);
    expect(eventsOf(events, 'kaijuHeld')[0]).toMatchObject({ reason: 'grab', held: { kind: 'prop', prop: 'propane' } });
    expect(eventsOf(events, 'propaneBlast')).toEqual([expect.objectContaining({ how: 'thrown' })]);
    expect([1, 2, 3].filter((id) => world.units[id].hp < 10000).length).toBeGreaterThanOrEqual(2);
  });

  it('swings a fast-food sign at units close by', () => {
    const world = botArena({ props: [{ kind: 'foodsign', x: 4, z: 9 }] });
    stand(world, 1, 0, 32);
    const events = until(world, 'clubSwing', 20);
    expect(eventsOf(events, 'kaijuHeld')[0]).toMatchObject({ reason: 'grab', held: { kind: 'prop', prop: 'foodsign' } });
    expect(eventsOf(events, 'clubSwing')).toEqual([expect.objectContaining({ units: 1 })]);
  });

  it('carries a garage door toward guns that can see it, and throws it once it is close', () => {
    const world = botArena({ props: [{ kind: 'garagedoor', x: -5, z: 8 }] });
    stand(world, 1, 0, 70);
    const events = until(world, 'unitStunned', 30);
    expect(eventsOf(events, 'kaijuHeld')[0]).toMatchObject({ reason: 'grab', held: { kind: 'prop', prop: 'garagedoor' } });
    const thrown = eventsOf(events, 'projectileSpawn').find((e) => e.payload?.kind === 'prop' && e.payload.prop === 'garagedoor');
    expect(thrown).toBeDefined();
    expect(eventsOf(events, 'unitStunned')).toEqual([expect.objectContaining({ unit: 1, knockdown: true })]);
  });

  it('throws an antenna as a javelin at a squad farther off', () => {
    const world = botArena({ props: [{ kind: 'antenna', x: 6, z: 8 }] });
    stand(world, 1, 0, 75);
    stand(world, 2, 0, 82);
    const events = until(world, 'javelinHit', 25);
    expect(eventsOf(events, 'kaijuHeld')[0]).toMatchObject({ reason: 'grab', held: { kind: 'prop', prop: 'antenna' } });
    expect(eventsOf(events, 'javelinHit').length).toBeGreaterThanOrEqual(1);
  });
});
