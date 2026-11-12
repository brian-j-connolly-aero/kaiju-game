import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  COMBAT_RULES,
  createMatchConfig,
  createWorld,
  idleBots,
  LIZARD,
  setPlayerBot,
  TICK_RATE,
  UNIT_TYPES,
  volleyStrength,
  WEAPONS,
  yawFromTo,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type World,
} from '../src/index';
import { eventsOf, input, makeTestCity, parkUnits, placeKaiju, placeUnit } from './helpers';

/**
 * The rules that make a charged, coordinated volley the way to break the kaiju's nerve
 * (DESIGN.md sections 3 and 5): a hasty shot is fire at will whatever the fire mode, and it
 * takes charged volleys from two squads to break it.
 *
 * Everything here is played by four people (scripted) around a kaiju that stands still on open
 * ground at the origin, facing +Z: the most favorable case for the squads there is.
 */

const CAP = LIZARD.nerveCapacity;
const CHARGE_TICKS = Math.round(COMBAT_RULES.chargeTime * TICK_RATE);

interface Field {
  world: World;
  /** Steps once. `buttons[s]` is what squad s holds; every leader keeps its crosshair on the middle of the kaiju. */
  step(buttons: number[], wheel?: PlayerInput['wheel']): SimEvent[];
  events: SimEvent[];
}

/** Squads placed on the given bearings (seen from the kaiju; 0 is dead ahead of it), each in a line square to it. */
function field(stage: StageId, bearings: number[]): Field {
  const humans: NonNullable<Parameters<typeof createMatchConfig>[0]>['humans'] = [{ name: 'K', role: 'kaiju' }];
  for (let i = 0; i < 4; i++) humans.push({ name: `H${i}`, role: 'human' });
  const config = { ...createMatchConfig({ humans, anchor: 0 }), bots: idleBots() };
  config.tuning = { ...config.tuning, briefing: 0, clock: 1e6 };
  const world = createWorld({ seed: 7, config, city: makeTestCity({}) });
  world.match.marks = [1e6, 2e6, 3e6];
  world.step();
  if (stage > 1) beginStage(world, stage);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  const k = placeKaiju(world, 0, 0, 0);
  for (const p of world.players) setPlayerBot(world, p.id, false);
  const dist = stage === 1 ? 45 : stage === 2 ? 150 : 300;
  const aims: Array<Partial<PlayerInput>> = [];
  for (let s = 0; s < 4; s++) {
    const squad = world.squads[s];
    if (s >= bearings.length) {
      aims.push({});
      continue;
    }
    const b = bearings[s];
    const gap = world.units[squad.units[0]].radius * 2 + 3;
    squad.units.forEach((id, i) => {
      const off = (i - 1.5) * gap;
      placeUnit(world, id, Math.sin(b) * dist + Math.cos(b) * off, Math.cos(b) * dist - Math.sin(b) * off);
    });
    const u = world.units[squad.driven];
    const eye = u.y + UNIT_TYPES[u.type].eyeHeight;
    aims.push({ aimYaw: yawFromTo(u.x, u.z, 0, 0), aimPitch: Math.atan2(k.height / 2 - eye, Math.hypot(u.x, u.z)) });
  }
  const f: Field = {
    world,
    events: [],
    step(buttons, wheel) {
      // Squads that take no part in the test hold their fire where they were parked.
      const frame = [input(), ...aims.map((a, s) => input({ ...a, buttons: buttons[s] ?? 0, wheel: s < bearings.length ? wheel : wheel ? 'holdCharge' : undefined }))];
      const events = world.step(frame);
      f.events.push(...events);
      return events;
    },
  };
  return f;
}

const ALL_ROUND = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const FIRE4 = [Btn.fire, Btn.fire, Btn.fire, Btn.fire];

/** Everybody simply holds Fire for `seconds`, in the given fire mode. */
function holdTheTrigger(stage: StageId, mode: 'holdCharge' | 'fireAtWill', seconds: number, bearings = ALL_ROUND): Field {
  const f = field(stage, bearings);
  f.step([], mode);
  for (let t = 0; t < seconds * TICK_RATE; t++) f.step(FIRE4);
  return f;
}

function charged(f: Field, squads: number): boolean {
  return f.world.squads.slice(0, squads).every((sq) => sq.units.every((id) => id === sq.driven || f.world.units[id].charge >= 1));
}

describe('holding the trigger against charging a volley', () => {
  it('a hasty volley is fire at will: half nerve, no bonus until the charge is well over half', () => {
    expect(volleyStrength(0)).toBe(0);
    expect(volleyStrength(COMBAT_RULES.volleyMinCharge - 0.01)).toBe(0);
    expect(volleyStrength(1)).toBe(1);
    expect(volleyStrength((1 + COMBAT_RULES.volleyMinCharge) / 2)).toBeCloseTo(0.5, 9);
    // Holding Fire can never charge a volley: the guns reload faster than the charge counts.
    for (const w of Object.values(WEAPONS)) expect(w.cooldown / COMBAT_RULES.chargeTime).toBeLessThan(COMBAT_RULES.volleyMinCharge - 0.05);

    for (const stage of [1, 2, 3] as const) {
      const weapon = WEAPONS[UNIT_TYPES[field(stage, [0]).world.units[0].type].weapon];
      // One squad in front, Fire held from the moment the squad is planted.
      const f = field(stage, [0]);
      f.step([], 'holdCharge');
      for (let t = 0; t < 12 * TICK_RATE; t++) f.step([Btn.fire]);
      expect(eventsOf(f.events, 'volley')).toEqual([]);
      const spawns = eventsOf(f.events, 'projectileSpawn');
      expect(spawns.length).toBeGreaterThanOrEqual(12);
      expect(spawns.every((s) => !s.volley)).toBe(true);
      // The sub-units did fire with the leader, and each of their hits is worth half its nerve.
      const subHits = eventsOf(f.events, 'kaijuHit');
      const nerves = new Set(subHits.map((h) => Math.round(h.nerve * 1000) / 1000));
      expect([...nerves].sort()).toEqual([weapon.nerve * COMBAT_RULES.atWillNerveMult, weapon.nerve].sort());
      expect(subHits.filter((h) => h.nerve < weapon.nerve).length).toBeGreaterThan(subHits.length / 2);
    }
  });

  it('never breaks the kaiju in a minute of four squads holding Fire, in either fire mode; synchronized full volleys break it in seconds', () => {
    for (const stage of [1, 2, 3] as const) {
      for (const mode of ['holdCharge', 'fireAtWill'] as const) {
        const lazy = holdTheTrigger(stage, mode, 60);
        expect(eventsOf(lazy.events, 'nerveBreak'), `stage ${stage}, ${mode}`).toEqual([]);
        // Scattered fire slows it: its nerve is up, and it is still standing.
        expect(lazy.world.kaijus[0].nerve).toBeGreaterThan(CAP * 0.3);
        expect(lazy.world.kaijus[0].alive).toBe(true);
      }

      const f = field(stage, ALL_ROUND);
      const k = f.world.kaijus[0];
      f.step([], 'holdCharge');
      let first = -1;
      for (let t = 0; t < 60 * TICK_RATE && k.alive; t++) {
        // Everybody fires together when everybody is charged; into the stagger, as the guns load.
        const fire = k.phase === 'stagger' || (k.nerveImmune <= 0.05 && charged(f, 4));
        const events = f.step(fire ? FIRE4 : []);
        if (first < 0 && eventsOf(events, 'nerveBreak').length > 0) first = t / TICK_RATE;
      }
      expect(first, `stage ${stage}`).toBeGreaterThan(0);
      expect(first).toBeLessThan(COMBAT_RULES.chargeTime + 4);
      expect(eventsOf(f.events, 'nerveBreak').length, `stage ${stage}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('stays a reasonable way to do plain damage: held fire on hold-and-charge hurts at least as much as fire at will', () => {
    for (const stage of [1, 2, 3] as const) {
      const held = holdTheTrigger(stage, 'holdCharge', 30);
      const atWill = holdTheTrigger(stage, 'fireAtWill', 30);
      const lost = (f: Field): number => f.world.kaijus[0].maxHp - f.world.kaijus[0].hp;
      expect(lost(atWill)).toBeGreaterThan(100);
      expect(lost(held)).toBeGreaterThanOrEqual(lost(atWill));
    }
  });
});

describe('it takes two squads to break the kaiju', () => {
  /** One squad's units on the given bearings (degrees), fully charged, fire one volley. */
  function oneVolley(stage: StageId, bearingsDeg: number[]): Field {
    const f = field(stage, [0]);
    const { world } = f;
    const dist = stage === 1 ? 45 : stage === 2 ? 150 : 300;
    world.squads[0].units.forEach((id, i) => {
      const b = (bearingsDeg[i] * Math.PI) / 180;
      placeUnit(world, id, Math.sin(b) * dist, Math.cos(b) * dist);
    });
    return f;
  }

  it('one full-charge volley from one squad never does: from behind, crossed, or both', () => {
    for (const stage of [1, 2, 3] as const) {
      for (const bearings of [
        [174, 178, 182, 186], // all behind
        [150, 148, -150, -148], // behind, split 60 degrees apart: rear and crossfire stack
        [70, 72, 132, 134], // one flank, split
        [-31, -29, 31, 29], // in front, split
      ]) {
        const f = oneVolley(stage, bearings);
        const { world } = f;
        const u = world.units[world.squads[0].driven];
        const k = world.kaijus[0];
        const eye = u.y + UNIT_TYPES[u.type].eyeHeight;
        const aim = { aimYaw: yawFromTo(u.x, u.z, 0, 0), aimPitch: Math.atan2(k.height / 2 - eye, Math.hypot(u.x, u.z)) };
        const frame = (partial: Partial<PlayerInput>): Array<PlayerInput | null> => [input(), input({ ...aim, ...partial })];
        f.events.push(...world.step(frame({ wheel: 'holdCharge' })));
        for (let t = 0; t < CHARGE_TICKS + 5; t++) world.step(frame({}));
        let peak = 0;
        for (let t = 0; t < 8 * TICK_RATE; t++) {
          f.events.push(...world.step(frame({ buttons: t < 2 ? Btn.fire : 0 })));
          peak = Math.max(peak, k.nerve);
        }
        expect(eventsOf(f.events, 'volley').length).toBe(1);
        expect(eventsOf(f.events, 'nerveBreak'), `stage ${stage}, bearings ${bearings.join(' ')}`).toEqual([]);
        expect(k.phase).not.toBe('stagger');
        // It can be brought to the brink, and no further.
        expect(peak).toBeLessThanOrEqual(CAP);
        expect(peak).toBeGreaterThan(CAP * 0.4);
      }
    }
  });

  it('nor does one squad that keeps at it for a minute from behind; the first charged volley of a second squad then does', () => {
    for (const stage of [1, 2, 3] as const) {
      // The first squad behind the kaiju, the second in front of it.
      const f = field(stage, [Math.PI, 0]);
      const k = f.world.kaijus[0];
      f.step([], 'holdCharge');
      for (let t = 0; t < 60 * TICK_RATE; t++) f.step(charged(f, 1) ? [Btn.fire] : []);
      expect(eventsOf(f.events, 'volley').length).toBeGreaterThanOrEqual(8);
      expect(eventsOf(f.events, 'nerveBreak'), `stage ${stage}`).toEqual([]);
      expect(k.alive).toBe(true);

      // Both squads now: the second one's volley is what was missing.
      let broke = -1;
      for (let t = 0; t < 20 * TICK_RATE && broke < 0; t++) {
        const events = f.step(charged(f, 2) ? [Btn.fire, Btn.fire] : []);
        if (eventsOf(events, 'nerveBreak').length > 0) broke = t / TICK_RATE;
      }
      expect(broke, `stage ${stage}`).toBeGreaterThanOrEqual(0);
      expect(k.phase).toBe('stagger');
    }
  });
});
