/**
 * The special buildings' rewards (docs/ROADMAP.md phase 2; DESIGN.md section 7, "Special
 * buildings"; sim/systems/specials.ts), each paid once when the building collapses.
 */

import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  decodeSnapshot,
  encodeSnapshot,
  LIZARD,
  snapshotOfWorld,
  TICK_RATE,
  type PlayerInput,
  type SimEvent,
  type World,
} from '../src/index';
import { eventsOf, holdFire, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestStructure } from './helpers';

const REWARDS = LIZARD.rewards;

function arena(structures: TestStructure[]): World {
  const world = makeTestWorld({ structures });
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  holdFire(world);
  return world;
}

function play(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [input(partial)]);
}

/** Brings structure `id` down, credited to the kaiju player (as its swipe would). */
function wreck(world: World, id: number): SimEvent[] {
  world.structureHits.push({ id, damage: Infinity, by: KAIJU_PLAYER, cause: 'swipe' });
  return play(world, 1);
}

const substation: TestStructure = { archetype: 'substation_a', x: 0, z: 14, w: 22, d: 16, height: 9, hp: 150, value: 15 };

describe('the power substation', () => {
  it('surges the kaiju: cooldowns cleared and recovering faster, its attacks harder, rage up; once', () => {
    const world = arena([substation]);
    const k = world.kaijus[0];
    k.moves = ['roar', 'tailSweep'];
    k.cooldowns.roar = 17;
    k.cooldowns.eat = 9;
    k.rage = 20;
    const events = wreck(world, 0);
    const surge = eventsOf(events, 'powerSurge');
    expect(surge).toEqual([expect.objectContaining({ kaiju: 0, structure: 0, duration: REWARDS.surge.duration, rage: REWARDS.surge.rage })]);
    expect(k.surge).toBeCloseTo(REWARDS.surge.duration, 6);
    expect(k.cooldowns.roar).toBe(0);
    expect(k.cooldowns.eat).toBe(0);
    // (and a little for the bar points the substation itself was worth)
    expect(k.rage).toBeGreaterThanOrEqual(20 + REWARDS.surge.rage);
    expect(k.rage).toBeLessThan(20 + REWARDS.surge.rage + 1);

    // A cooldown started now comes back three times as fast: a roar's 18 s in 6.
    play(world, 2, { buttons: Btn.move1 });
    expect(k.action).toBe('roar');
    play(world, Math.round(TICK_RATE * 2));
    // (It started on the first of the two ticks the button was down, and has recovered on every one since.)
    expect(k.cooldowns.roar).toBeCloseTo(LIZARD.actions.roar.cooldown - REWARDS.surge.cooldownRate * (2 + 1 / TICK_RATE), 4);

    // Its swipe does half again as much to a unit while it lasts.
    play(world, 60);
    const u = placeUnit(world, 0, 0, 4);
    u.hp = 10000;
    u.maxHp = 10000;
    play(world, 2, { buttons: Btn.strike });
    play(world, 30);
    expect(10000 - u.hp).toBeCloseTo(LIZARD.actions.swipe.unitDamage * REWARDS.surge.damageMult, 4);

    // Then it runs out, and a swipe is a swipe again.
    play(world, Math.round(REWARDS.surge.duration * TICK_RATE));
    expect(k.surge).toBe(0);
    placeUnit(world, 0, 0, 4).hp = 10000;
    play(world, 2, { buttons: Btn.strike });
    play(world, 30);
    expect(10000 - u.hp).toBeCloseTo(LIZARD.actions.swipe.unitDamage, 4);

    // The rubble pays nothing more, and the snapshot carried the surge.
    expect(eventsOf(wreck(world, 0), 'powerSurge')).toEqual([]);
  });

  it('the surge shows in the snapshot', () => {
    const world = arena([substation]);
    wreck(world, 0);
    play(world, 15);
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(snap.kaijus[0].surge).toBeCloseTo(world.kaijus[0].surge, 2);
    expect(snap.kaijus[0].surge).toBeGreaterThan(REWARDS.surge.duration - 1);
  });
});

describe('the gas station', () => {
  it('goes up in a fireball: units in it are hurt and thrown out, the house behind it falls, the kaiju is spared', () => {
    const world = arena([
      { archetype: 'gasstation_a', x: 40, z: 0, w: 26, d: 20, height: 7, hp: 160, value: 15 },
      // Behind it, 4 m off its back wall: inside the fireball's reach.
      { x: 40, z: 18.5, w: 9, d: 9, height: 6, hp: 80 },
      // Far beyond it.
      { x: 40, z: 60, w: 9, d: 9, height: 6, hp: 80 },
    ]);
    const k = placeKaiju(world, 24, 0, Math.PI / 2);
    // In front of it, clear of its walls.
    const u = placeUnit(world, 1, 40, -16);
    u.hp = 10000;
    u.maxHp = 10000;
    const events = wreck(world, 0);
    expect(eventsOf(events, 'fireball')).toEqual([expect.objectContaining({ structure: 0, x: 40, z: 0, radius: REWARDS.fireball.radius })]);
    expect(world.structureHp[1]).toBe(0);
    expect(world.structureHp[2]).toBe(80);
    // 16 m from the middle, its own 3 m radius: 13 m in.
    const f = REWARDS.fireball;
    const t = (16 - u.radius) / f.radius;
    expect(10000 - u.hp).toBeCloseTo(f.unitDamageCenter + (f.unitDamageEdge - f.unitDamageCenter) * t, 4);
    expect(u.vz).toBeLessThan(0);
    expect(k.hp).toBe(LIZARD.hp);
    expect(eventsOf(events, 'kaijuHit')).toEqual([]);
  });
});

describe('the radio mast', () => {
  it('falls away from the kaiju, its top comes to lie at the far end to be picked up, and the map shows static', () => {
    const world = arena([{ archetype: 'radiomast_a', x: 0, z: 20, w: 8, d: 8, height: 24, hp: 120, value: 15 }]);
    const events = wreck(world, 0);
    const fall = eventsOf(events, 'mastFall');
    expect(fall).toHaveLength(1);
    const m = fall[0];
    // Straight away from the kaiju (it stands due south of the mast).
    expect(Math.abs(m.yaw)).toBeLessThan(1e-6);
    expect(m.length).toBe(24);
    expect(m.topX).toBeCloseTo(0, 6);
    expect(m.topZ).toBeCloseTo(24 + 24 - REWARDS.radiomast.topLength / 2, 6);
    expect(m.staticUntil).toBe(world.tick + REWARDS.radiomast.staticTime * TICK_RATE);
    expect(world.match.staticUntil).toBe(m.staticUntil);
    expect(eventsOf(events, 'structureFall')).toEqual([expect.objectContaining({ id: 0, phase: 'falling' })]);
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).match.staticUntil).toBe(m.staticUntil);

    // The top is not there to pick up until the mast has come down.
    expect(world.loose[m.topId].state).toBe('falling');
    const landed = play(world, Math.round(m.duration * TICK_RATE) + 1);
    expect(eventsOf(landed, 'looseProp')).toEqual([expect.objectContaining({ id: m.topId, prop: 'mast', state: 'down', cause: 'mast' })]);

    // The hatchling walks up and takes it.
    placeKaiju(world, 0, m.topZ - 5, 0);
    const grabbed = [...play(world, 2, { buttons: Btn.grab }), ...play(world, 20)];
    expect(world.kaijus[0].held).toEqual({ kind: 'prop', prop: 'mast' });
    expect(eventsOf(grabbed, 'kaijuHeld')[0]).toMatchObject({ source: 'loose', sourceId: m.topId });
  });

  it('while the map shows static, the squads know where a juvenile is only from what they see', () => {
    const world = arena([{ archetype: 'radiomast_a', x: 0, z: 20, w: 8, d: 8, height: 24, hp: 120, value: 15 }]);
    beginStage(world, 2);
    placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    play(world, 2);
    const k = world.kaijus[0];
    expect(k.known).toBe(true);
    wreck(world, 0);
    play(world, 1);
    expect(k.known).toBe(false);
    play(world, REWARDS.radiomast.staticTime * TICK_RATE);
    expect(k.known).toBe(true);
  });
});
