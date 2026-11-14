/**
 * Smoke and marking (DESIGN.md section 5, "Smoke and marking"; sim/abilities.ts): every squad
 * leader can throw smoke that blocks sight and hides the guns in it from the kaiju, and can mark
 * the kaiju for the whole army for a while. Both on a cooldown; the bots use both.
 */

import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  decodeSnapshot,
  encodeSnapshot,
  hiddenFromKaiju,
  LIZARD,
  MATCH_RULES,
  smokeBlocks,
  snapshotOfWorld,
  SQUAD_ABILITIES,
  TICK_RATE,
  unitSeesKaiju,
  type MatchConfig,
  type World,
} from '../src/index';
import { eventsOf, holdFire, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run } from './helpers';

const SEC = TICK_RATE;
const R = LIZARD.stages[0].bodyRadius;
const H = LIZARD.stages[0].height;
const EYE = 1.7;

/** Everybody parked far off, the kaiju at the origin, the first squad's leader (unit 0, the person) where a test puts it. */
function field(): World {
  const world = makeTestWorld();
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, 0, 0, 0);
  holdFire(world);
  run(world, 1);
  return world;
}

/** One tick with these buttons down for the person leading squad 0 (player 1), aimed along (yaw, pitch). */
function press(world: World, buttons: number, yaw: number, pitch: number) {
  const events = run(world, 1, [null, input({ buttons, aimYaw: yaw, aimPitch: pitch })]);
  events.push(...run(world, 1, [null, input({ aimYaw: yaw, aimPitch: pitch })]));
  return events;
}

/** The aim from unit 0 at (0, z) to the middle of the kaiju at the origin. */
function aimAtKaiju(z: number): { yaw: number; pitch: number } {
  return { yaw: Math.PI, pitch: Math.atan2(H * 0.5 - EYE, z) };
}

describe('smoke blocks sight', () => {
  const cloud = { x: 0, z: 0, radius: 10, height: 8 };

  it('stops a line through it, and a line that starts or ends inside it, below its top', () => {
    expect(smokeBlocks([cloud], { x: -30, y: 2, z: 0 }, { x: 30, y: 2, z: 0 })).toBe(true);
    expect(smokeBlocks([cloud], { x: 0, y: 1, z: 0 }, { x: 80, y: 3, z: 40 })).toBe(true);
    expect(smokeBlocks([cloud], { x: 80, y: 3, z: 40 }, { x: 2, y: 1, z: 2 })).toBe(true);
  });

  it('lets a line past it, or over its top, through', () => {
    expect(smokeBlocks([cloud], { x: -30, y: 2, z: 11 }, { x: 30, y: 2, z: 11 })).toBe(false);
    expect(smokeBlocks([cloud], { x: -30, y: 12, z: 0 }, { x: 30, y: 9, z: 0 })).toBe(false);
    expect(smokeBlocks([], { x: -30, y: 2, z: 0 }, { x: 30, y: 2, z: 0 })).toBe(false);
  });
});

describe('throwing smoke', () => {
  it('lands where the crosshair is, stands for a while, and cools down before the next', () => {
    const world = field();
    const squad = world.squads[0];
    placeUnit(world, 0, 0, 100);
    // Aimed down at the ground 30 m ahead (toward the kaiju).
    const events = press(world, Btn.smoke, Math.PI, -Math.atan2(EYE, 30));
    expect(world.smokes.length).toBe(1);
    const c = world.smokes[0];
    expect(Math.hypot(c.x - 0, c.z - 70)).toBeLessThan(1.5);
    expect(c.radius).toBe(SQUAD_ABILITIES.smoke.radius[0]);
    expect(squad.smokeCooldown).toBeGreaterThan(SQUAD_ABILITIES.smoke.cooldown - 0.2);
    expect(eventsOf(events, 'smoke')).toMatchObject([{ squad: 0, radius: c.radius }]);
    // The clients get it in every snapshot while it stands.
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).smokes).toMatchObject([{ squad: 0, radius: c.radius }]);

    // Again at once: nothing.
    press(world, Btn.smoke, Math.PI, -0.1);
    expect(world.smokes.length).toBe(1);

    // It thins out and is gone after its time.
    run(world, Math.ceil(SQUAD_ABILITIES.smoke.duration * SEC));
    expect(world.smokes.length).toBe(0);
  });

  it('goes no further than the throw: at the crosshair on the sky it lands straight ahead at the full range', () => {
    const world = field();
    placeUnit(world, 0, 0, 200);
    press(world, Btn.smoke, Math.PI, 0.5);
    expect(world.smokes.length).toBe(1);
    expect(world.smokes[0].z).toBeCloseTo(200 - SQUAD_ABILITIES.smoke.range[0], 0);
  });

  it('cuts the squads’ sight of the kaiju and hides the guns in it from the kaiju', () => {
    const world = field();
    const k = world.kaijus[0];
    const leader = placeUnit(world, 0, 0, 100);
    run(world, 1);
    expect(k.spotted).toBe(true);
    world.smokes.push({ id: 99, squad: 1, x: 0, z: 50, radius: 12, height: 10, timer: 10 });
    run(world, 1);
    expect(unitSeesKaiju(world, leader, k, 400)).toBe(false);
    expect(k.spotted).toBe(false);
    expect(hiddenFromKaiju(world, leader)).toBe(false);
    placeUnit(world, 0, 3, 52);
    expect(hiddenFromKaiju(world, leader)).toBe(true);
  });
});

describe('marking the kaiju', () => {
  it('puts it on every squad’s map and makes it spotted, for a while', () => {
    const world = field();
    const k = world.kaijus[0];
    // Beyond the range at which anybody's eyes put a hatchling on the map, inside the mark's.
    const z = MATCH_RULES.revealSightRange + R + 4;
    expect(z).toBeLessThan(SQUAD_ABILITIES.mark.range[0]);
    placeUnit(world, 0, 0, z);
    run(world, Math.ceil(MATCH_RULES.revealAfterNoise * SEC) + 2);
    expect(k.known).toBe(false);

    // Aimed away: nothing happens and nothing is spent.
    press(world, Btn.mark, 0, 0);
    expect(k.marked).toBe(0);
    expect(world.squads[0].markCooldown).toBe(0);

    const aim = aimAtKaiju(z);
    const events = press(world, Btn.mark, aim.yaw, aim.pitch);
    expect(eventsOf(events, 'mark')).toMatchObject([{ kaiju: 0, squad: 0 }]);
    expect(k.marked).toBeGreaterThan(SQUAD_ABILITIES.mark.duration - 0.2);
    expect(k.known).toBe(true);
    expect(k.spotted).toBe(true);
    expect(world.squads[0].markCooldown).toBeGreaterThan(SQUAD_ABILITIES.mark.cooldown - 0.2);
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).kaijus[0]).toMatchObject({ marked: true, known: true, spotted: true });

    run(world, Math.ceil(SQUAD_ABILITIES.mark.duration * SEC) + 1);
    expect(k.marked).toBe(0);
    expect(k.known).toBe(false);
    expect(decodeSnapshot(encodeSnapshot(snapshotOfWorld(world))).kaijus[0].marked).toBe(false);
  });

  it('needs the kaiju in sight and in range: not through smoke, not from too far', () => {
    const world = field();
    const k = world.kaijus[0];
    const far = SQUAD_ABILITIES.mark.range[0] + R + 10;
    placeUnit(world, 0, 0, far);
    let aim = aimAtKaiju(far);
    press(world, Btn.mark, aim.yaw, aim.pitch);
    expect(k.marked).toBe(0);

    placeUnit(world, 0, 0, 120);
    world.smokes.push({ id: 99, squad: 1, x: 0, z: 60, radius: 12, height: 10, timer: 10 });
    aim = aimAtKaiju(120);
    press(world, Btn.mark, aim.yaw, aim.pitch);
    expect(k.marked).toBe(0);
    expect(world.squads[0].markCooldown).toBe(0);
  });

  it('wears off, smoke and all, when the next stage begins; both are ready again', () => {
    const world = field();
    const k = world.kaijus[0];
    placeUnit(world, 0, 0, 100);
    const aim = aimAtKaiju(100);
    press(world, Btn.mark, aim.yaw, aim.pitch);
    press(world, Btn.smoke, aim.yaw, -0.1);
    expect(k.marked).toBeGreaterThan(0);
    expect(world.smokes.length).toBe(1);
    beginStage(world, 2);
    expect(k.marked).toBe(0);
    expect(world.smokes.length).toBe(0);
    expect(world.squads[0].smokeCooldown).toBe(0);
    expect(world.squads[0].markCooldown).toBe(0);
  });
});

describe('the bots', () => {
  it('mark the kaiju and throw smoke in a match of bots, and only through the buttons a person has', () => {
    const config: Partial<MatchConfig> = { bots: { kaijuHandicap: 0, humanHandicap: 0 } };
    const world = makeTestWorld({ realCity: true, people: 'none', bots: true, config, seed: 4 });
    const events = run(world, 240 * SEC);
    const marks = eventsOf(events, 'mark');
    const smokes = eventsOf(events, 'smoke');
    expect(marks.length).toBeGreaterThan(2);
    expect(smokes.length).toBeGreaterThan(0);
    // A mark never lands on a kaiju that is already marked (no squad wastes its mark).
    for (const m of marks) expect(marks.filter((o) => o.kaiju === m.kaiju && o.tick > m.tick && o.tick < m.tick + SQUAD_ABILITIES.mark.duration * SEC - 1)).toEqual([]);
  });
});
