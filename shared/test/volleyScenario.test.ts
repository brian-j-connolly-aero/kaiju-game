import { describe, expect, it } from 'vitest';
import {
  Btn,
  COMBAT_RULES,
  DEG,
  LIZARD,
  setPlayerBot,
  TICK_RATE,
  UNIT_TYPES,
  WEAPONS,
  yawFromTo,
  type PlayerInput,
  type SimEvent,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, valueDestroyed, type TestWorldOptions } from './helpers';

/**
 * Scripted squads against a kaiju that stands still at the origin, facing north (+Z). Units are
 * put on their marks by hand before the first step; after that everything goes through
 * `world.step(inputs)`: the command wheel, the stick, the aim and the trigger, the way people
 * at the controls would play it.
 */
const ROCKETS = WEAPONS.army_rocket_launchers;
const P = LIZARD.damage;
const INFANTRY = UNIT_TYPES.army_rocket_infantry;
const CHARGE_TICKS = COMBAT_RULES.chargeTime * TICK_RATE;
/** Height the squads aim at: the middle of the hatchling. */
const MID = LIZARD.stages[0].height / 2;

interface Script {
  world: World;
  events: SimEvent[];
  /** Steps once with these inputs per squad player (index 0 is the first squad). */
  step(inputs?: Array<Partial<PlayerInput> | null>): void;
  wait(ticks: number): void;
}

function createScript(options: TestWorldOptions = {}): Script {
  const world = makeTestWorld(options);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, 0, 0, 0);
  // Every squad is played by a person in these scenarios (a parked squad's player touches nothing).
  for (const p of world.players) setPlayerBot(world, p.id, false);
  const events: SimEvent[] = [];
  const last: PlayerInput[] = world.players.map(() => input());
  const script: Script = {
    world,
    events,
    step(inputs = []) {
      const frame: Array<PlayerInput | null> = [null];
      for (let s = 0; s < world.squads.length; s++) {
        const partial = inputs[s];
        // A person's aim stays where they left it between button presses.
        const next = input({ aimYaw: last[s + 1].aimYaw, aimPitch: last[s + 1].aimPitch, ...partial });
        last[s + 1] = next;
        frame.push(next);
      }
      events.push(...world.step(frame));
      // Collateral is the score: the bar always equals what the city has lost, whoever did it.
      expect(world.match.barPoints).toBeCloseTo(valueDestroyed(world), 3);
    },
    wait(ticks) {
      for (let i = 0; i < ticks; i++) script.step();
    },
  };
  return script;
}

/** Puts a squad on a line square to the direction of the kaiju, centered `dist` meters from it on a bearing. */
function deploy(world: World, squad: number, bearing: number, dist: number, gap = 9): void {
  const cx = Math.sin(bearing) * dist;
  const cz = Math.cos(bearing) * dist;
  const tx = Math.cos(bearing);
  const tz = -Math.sin(bearing);
  world.squads[squad].units.forEach((id, i) => {
    const off = (i - 1.5) * gap;
    placeUnit(world, id, cx + tx * off, cz + tz * off);
  });
}

/** The aim (from a unit's eye) that puts the crosshair on a point. */
function aimAt(world: World, unit: number, x: number, y: number, z: number): Partial<PlayerInput> {
  const u = world.units[unit];
  const eye = u.y + UNIT_TYPES[u.type].eyeHeight;
  return { aimYaw: yawFromTo(u.x, u.z, x, z), aimPitch: Math.atan2(y - eye, Math.hypot(x - u.x, z - u.z)) };
}

/** Walks a squad's leader to a point: look at it, stick forward. */
function walkTo(script: Script, squad: number, x: number, z: number): void {
  const world = script.world;
  const u = world.units[world.squads[squad].driven];
  for (let i = 0; i < 900; i++) {
    const d = Math.hypot(x - u.x, z - u.z);
    if (d < 0.5) break;
    const inputs: Array<Partial<PlayerInput> | null> = [];
    inputs[squad] = { aimYaw: yawFromTo(u.x, u.z, x, z), aimPitch: 0, moveZ: d > 3 ? 1 : 0.4 };
    script.step(inputs);
  }
  expect(Math.hypot(x - u.x, z - u.z)).toBeLessThan(1.5);
}

/** What a volley did to the kaiju, summed from the hit reports. */
function tally(events: SimEvent[]): { hits: number; damage: number; nerve: number } {
  const hits = eventsOf(events, 'kaijuHit');
  return { hits: hits.length, damage: hits.reduce((a, h) => a + h.damage, 0), nerve: hits.reduce((a, h) => a + h.nerve, 0) };
}

/** One squad's full-charge volley, in raw numbers: the trigger shot plus three charged sub-units. */
const VOLLEY_NERVE = 3 * ROCKETS.nerve + 9 * ROCKETS.nerve * (1 + COMBAT_RULES.volleyNervePerCharge);
const VOLLEY_DAMAGE = 3 * ROCKETS.damage + 9 * ROCKETS.damage * (1 + COMBAT_RULES.volleyDamagePerCharge);

/** The first squad charges a full volley from one bearing and fires it at the middle of the kaiju. */
function volleyFrom(bearing: number): { script: Script; result: ReturnType<typeof tally> } {
  const script = createScript();
  const { world } = script;
  deploy(world, 0, bearing, 45);
  script.step([{ wheel: 'holdCharge' }]);
  script.wait(CHARGE_TICKS + 5);
  expect(eventsOf(script.events, 'voice').map((e) => e.cue)).toContain('volley.ready');
  expect(eventsOf(script.events, 'projectileSpawn')).toEqual([]);
  script.step([{ ...aimAt(world, 0, 0, MID, 0), buttons: Btn.fire }]);
  script.step([{ buttons: 0 }]);
  script.wait(60);
  expect(eventsOf(script.events, 'volley')).toMatchObject([{ squad: 0, player: HUMAN_PLAYER, units: [1, 2, 3], charge: 1 }]);
  return { script, result: tally(script.events) };
}

describe('a squad charges a volley at a stationary kaiju', () => {
  it('from the front: every rocket lands, the kaiju is slowed, and it shrugs the damage off', () => {
    const { script, result } = volleyFrom(0);
    const k = script.world.kaijus[0];
    expect(result.hits).toBe(12);
    expect(eventsOf(script.events, 'kaijuHit').every((h) => h.facing === 'front' && !h.braced)).toBe(true);
    expect(result.nerve).toBeCloseTo(VOLLEY_NERVE * P.frontMult, 6);
    expect(result.damage).toBeCloseTo(VOLLEY_DAMAGE * P.normalMult * P.frontMult, 6);
    // One squad from the front does not break it: its nerve is shaken, not broken.
    expect(eventsOf(script.events, 'nerveBreak')).toEqual([]);
    expect(k.phase).not.toBe('stagger');
    expect(k.maxHp - k.hp).toBeLessThan(0.01 * k.maxHp);
    // No building was touched: nothing on the bar.
    expect(script.world.match.barPoints).toBe(0);
    expect(script.world.players[HUMAN_PLAYER].tally.volleys).toBe(1);
  });

  it('from the flank: the same volley does 1.35 times the nerve and the damage', () => {
    const front = volleyFrom(0).result;
    const { script, result } = volleyFrom(90 * DEG);
    expect(result.hits).toBe(12);
    expect(eventsOf(script.events, 'kaijuHit').every((h) => h.facing === 'flank')).toBe(true);
    expect(result.nerve).toBeGreaterThan(front.nerve);
    expect(result.damage).toBeGreaterThan(front.damage);
    expect(result.nerve / front.nerve).toBeCloseTo(P.flankMult / P.frontMult, 6);
    expect(result.damage / front.damage).toBeCloseTo(P.flankMult / P.frontMult, 6);
    // And from behind more still.
    const rear = volleyFrom(180 * DEG).result;
    expect(rear.hits).toBe(12);
    expect(rear.nerve / front.nerve).toBeCloseTo(P.rearMult / P.frontMult, 6);
  });

  it('as a crossfire: one player parks the sub-units in front, drives to the side, and beats both', () => {
    const front = volleyFrom(0).result;
    const flank = volleyFrom(90 * DEG).result;

    const script = createScript();
    const { world } = script;
    deploy(world, 0, 0, 45);
    // Park them on hold-and-charge, then drive round to the kaiju's east side.
    script.step([{ wheel: 'holdCharge' }]);
    walkTo(script, 0, 45, 45);
    walkTo(script, 0, 45, 0);
    script.wait(CHARGE_TICKS);
    const subs = [1, 2, 3].map((id) => world.units[id]);
    for (const u of subs) {
      expect(u.rooted).toBe(true);
      expect(u.charge).toBe(1);
      expect(u.z).toBeCloseTo(45, 6);
    }
    script.step([{ ...aimAt(world, 0, 0, MID, 0), buttons: Btn.fire }]);
    script.step([{ buttons: 0 }]);
    script.wait(60);

    const result = tally(script.events);
    expect(result.hits).toBe(12);
    const hits = eventsOf(script.events, 'kaijuHit');
    expect(hits.filter((h) => h.facing === 'flank').length).toBe(3);
    expect(hits.filter((h) => h.facing === 'front').length).toBe(9);
    expect(eventsOf(script.events, 'crossfire')).toMatchObject([{ kaiju: 0 }]);
    expect(eventsOf(script.events, 'voice').map((e) => e.cue)).toContain('crossfire');
    // Two angles at once: more nerve than the same squad from the front or from the flank.
    expect(result.nerve).toBeGreaterThan(front.nerve * 1.5);
    expect(result.nerve).toBeGreaterThan(flank.nerve);
    // The trigger shot from the side lands first; the nine charged rockets from the front cross it.
    expect(result.nerve).toBeCloseTo(
      3 * ROCKETS.nerve * P.flankMult + 9 * ROCKETS.nerve * (1 + COMBAT_RULES.volleyNervePerCharge) * P.frontMult * COMBAT_RULES.crossfireNerveMult,
      6,
    );
    // The squad stays parked where the player left it, charging again.
    script.wait(30);
    for (const u of subs) expect(u.rooted && u.z > 44 && u.charge > 0).toBe(true);
  });
});

describe('a full coordinated volley', () => {
  it('staggers the kaiju, and what lands after the break does real damage', () => {
    const single = volleyFrom(0).result;

    const script = createScript();
    const { world } = script;
    const k = world.kaijus[0];
    // All four squads inside the front arc, close enough together that none of it is crossfire.
    // They stand at different distances, so the four volleys arrive one after the other.
    const bearings = [-24, -8, 8, 24].map((d) => d * DEG);
    bearings.forEach((b, s) => deploy(world, s, b, 46 + 8 * s, 7));
    script.step(world.squads.map(() => ({ wheel: 'holdCharge' as const })));
    script.wait(CHARGE_TICKS + 5);
    expect(world.squads.every((s) => s.volleyReady)).toBe(true);
    expect(k.hp).toBe(k.maxHp);

    // "Fire!": everybody's trigger on the same tick.
    script.step(world.squads.map((s) => ({ ...aimAt(world, s.driven, 0, MID, 0), buttons: Btn.fire })));
    script.step(world.squads.map(() => ({ buttons: 0 })));
    script.wait(60);

    expect(eventsOf(script.events, 'volley').length).toBe(4);
    expect(eventsOf(script.events, 'crossfire')).toEqual([]);
    const breaks = eventsOf(script.events, 'nerveBreak');
    expect(breaks.length).toBe(1);
    expect(eventsOf(script.events, 'kaijuStagger')).toMatchObject([{ kaiju: 0, on: true, duration: COMBAT_RULES.staggerDuration }]);
    expect(eventsOf(script.events, 'voice').map((e) => e.cue)).toContain('nerve.break');
    expect(k.phase).toBe('stagger');
    expect(world.match.breaks).toBe(1);
    expect(world.players[breaks[0].by].tally.breaks).toBe(1);

    // Rockets that arrive after the break hit the weak point: the helpless multiplier instead of 12%.
    const after = eventsOf(script.events.slice(script.events.indexOf(breaks[0])), 'kaijuHit');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((h) => h.nerve === 0)).toBe(true);
    for (const h of after) expect([ROCKETS.damage, 2 * ROCKETS.damage].some((d) => Math.abs(h.damage - d * P.helplessMult) < 1e-9)).toBe(true);
    const result = tally(script.events);
    expect(result.damage).toBeGreaterThan(4 * single.damage * 1.5);
    // The single squad, for comparison, did not come close to breaking it (a little over half
    // the capacity since the nerve retune, docs/BALANCE.md; it takes two).
    expect(single.nerve).toBeLessThan(LIZARD.nerveCapacity * 0.6);
  });
});

describe('a miss', () => {
  it('carries on into the building behind the kaiju and puts it on the bar', () => {
    // The shop takes exactly the squad's twelve rockets (28 each) to bring down.
    const script = createScript({
      structures: [{ x: 24, z: -40, w: 30, d: 14, height: 12, hp: 12 * ROCKETS.structureDamage, value: 90, cls: 'shop' }],
    });
    const { world } = script;
    const k = world.kaijus[0];
    deploy(world, 0, 0, 45);
    script.step([{ wheel: 'holdCharge' }]);
    script.wait(CHARGE_TICKS + 5);
    // The player's crosshair slips off the kaiju's shoulder: it is on the shop front behind it.
    const aim = aimAt(world, 0, 24, 3, -33);
    script.step([{ ...aim, buttons: Btn.fire }]);
    script.step([{ buttons: 0 }]);
    script.wait(90);

    // Nothing touched the kaiju; every rocket found the shop.
    expect(tally(script.events).hits).toBe(0);
    expect(k.hp).toBe(k.maxHp);
    const hits = eventsOf(script.events, 'projectileHit');
    expect(hits.length).toBe(12);
    expect(hits.every((h) => h.target === 'structure' && h.targetId === 0)).toBe(true);
    // Twelve rockets at 28 each: the shop is rubble, and all 90 of its points are on the bar.
    expect(world.structureHp[0]).toBe(0);
    const stages = eventsOf(script.events, 'structureStage').map((e) => e.stage);
    expect(stages[stages.length - 1]).toBe(3);
    expect(stages).toEqual([...stages].sort());
    expect(eventsOf(script.events, 'structureStage').every((e) => e.by === HUMAN_PLAYER && e.cause === 'rocket')).toBe(true);
    expect(world.match.barPoints).toBeCloseTo(90, 6);
    expect(world.players[HUMAN_PLAYER].tally.barPoints).toBeCloseTo(90, 6);
    expect(world.players[HUMAN_PLAYER].tally.wrecked.shop).toBe(1);
    // The kaiju earns nothing for what the humans wreck, but the newsroom noticed.
    expect(k.rage).toBe(0);
    expect(world.players[0].tally.barPoints).toBe(0);
    expect(eventsOf(script.events, 'voice').map((e) => e.cue)).toContain('collateral.human');
    // Rubble is a safe backstop: the next volley through the same spot costs nothing.
    script.wait(CHARGE_TICKS);
    script.step([{ ...aim, buttons: Btn.fire }]);
    script.step([{ buttons: 0 }]);
    script.wait(120);
    expect(world.match.barPoints).toBeCloseTo(90, 6);
  });

  it('a near miss still splashes the kaiju and wrecks the car beside it', () => {
    const script = createScript({ props: [{ kind: 'car_sedan', x: 6.5, z: 1 }] });
    const { world } = script;
    const k = world.kaijus[0];
    deploy(world, 0, 0, 45);
    script.step([{ wheel: 'holdCharge' }]);
    script.wait(60);
    // On the ground a couple of meters off its flank: inside the splash of a rocket.
    script.step([{ ...aimAt(world, 0, LIZARD.stages[0].bodyRadius + 2, 0, 0), buttons: Btn.fire }]);
    script.step([{ buttons: 0 }]);
    script.wait(60);
    expect(tally(script.events).hits).toBeGreaterThan(0);
    expect(k.hp).toBeLessThan(k.maxHp);
    expect(eventsOf(script.events, 'propsDestroyed')).toMatchObject([{ ids: [0], by: HUMAN_PLAYER, cause: 'rocket' }]);
    expect(world.players[HUMAN_PLAYER].tally.wrecked.car).toBe(1);
    expect(world.match.barPoints).toBe(2);
    expect(INFANTRY.eyeHeight).toBeGreaterThan(0);
  });
});
