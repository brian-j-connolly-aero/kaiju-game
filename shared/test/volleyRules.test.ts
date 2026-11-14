import { describe, expect, it } from 'vitest';
import {
  applyHit,
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
 * (DESIGN.md sections 3 and 5): a volley let go early is worth what fire at will is worth, and
 * it takes charged volleys from two squads to break it.
 *
 * Everything here is played by four people (scripted) around a kaiju that stands still on open
 * ground at the origin, facing +Z: the most favorable case for the squads there is.
 */

const CAP = LIZARD.nerveCapacity;
const CHARGE_TICKS = Math.round(COMBAT_RULES.chargeTime * TICK_RATE);

interface Field {
  world: World;
  /**
   * Steps once. `buttons[s]` is what squad s holds; every leader keeps its crosshair on the
   * middle of the kaiju. Squads that take no part in the test hold the volley button for good:
   * planted where they were parked, they never fire.
   */
  step(buttons: number[]): SimEvent[];
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
    step(buttons) {
      const frame = [input(), ...aims.map((a, s) => input({ ...a, buttons: s < bearings.length ? (buttons[s] ?? 0) : Btn.volley }))];
      const events = world.step(frame);
      f.events.push(...events);
      return events;
    },
  };
  return f;
}

const ALL_ROUND = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const FIRE4 = [Btn.fire, Btn.fire, Btn.fire, Btn.fire];
const VOLLEY4 = [Btn.volley, Btn.volley, Btn.volley, Btn.volley];
/** Ticks a hasty player holds the volley button before letting go: well short of a charged volley. */
const HASTY = Math.round(0.3 * CHARGE_TICKS);

/**
 * Everybody shoots without ever charging, for `seconds`: holding Fire (the squad-mates shooting
 * at will), or also letting go of the volley button every time it has been held a moment.
 */
function neverCharge(stage: StageId, way: 'fire' | 'hasty', seconds: number, bearings = ALL_ROUND): Field {
  const f = field(stage, bearings);
  for (let t = 0; t < seconds * TICK_RATE; t++) {
    const volley = way === 'hasty' && t % (HASTY + 1) !== HASTY ? Btn.volley : 0;
    f.step(FIRE4.map((b) => b | volley));
  }
  return f;
}

function charged(f: Field, squads: number): boolean {
  return f.world.squads.slice(0, squads).every((sq) => sq.units.every((id) => id === sq.driven || f.world.units[id].charge >= 1));
}

describe('shooting without charging', () => {
  it('a volley let go early is ragged: no volley, half nerve, no bonus until the charge is well over half', () => {
    expect(volleyStrength(0)).toBe(0);
    expect(volleyStrength(COMBAT_RULES.volleyMinCharge - 0.01)).toBe(0);
    expect(volleyStrength(1)).toBe(1);
    expect(volleyStrength((1 + COMBAT_RULES.volleyMinCharge) / 2)).toBeCloseTo(0.5, 9);

    for (const stage of [1, 2, 3] as const) {
      const weapon = WEAPONS[UNIT_TYPES[field(stage, [0]).world.units[0].type].weapon];
      // One squad in front, its player letting go of the volley button as soon as it is pressed.
      const f = field(stage, [0]);
      for (let t = 0; t < 12 * TICK_RATE; t++) f.step([t % (HASTY + 1) !== HASTY ? Btn.volley : 0]);
      expect(eventsOf(f.events, 'volley')).toEqual([]);
      const spawns = eventsOf(f.events, 'projectileSpawn');
      expect(spawns.length).toBeGreaterThanOrEqual(12);
      expect(spawns.every((s) => !s.volley)).toBe(true);
      // The squad-mates did fire, and each of their hits is worth half its nerve; the leader's own, all of it.
      const subHits = eventsOf(f.events, 'kaijuHit');
      const nerves = new Set(subHits.map((h) => Math.round(h.nerve * 1000) / 1000));
      expect([...nerves].sort()).toEqual([weapon.nerve * COMBAT_RULES.atWillNerveMult, weapon.nerve].sort());
      expect(subHits.filter((h) => h.nerve < weapon.nerve).length).toBeGreaterThan(subHits.length / 2);
    }
  });

  it('never breaks the kaiju in a minute of four squads that never charge; synchronized full volleys break it in seconds', () => {
    for (const stage of [1, 2, 3] as const) {
      for (const way of ['fire', 'hasty'] as const) {
        const lazy = neverCharge(stage, way, 60);
        expect(eventsOf(lazy.events, 'nerveBreak'), `stage ${stage}, ${way}`).toEqual([]);
        // Scattered fire slows it: its nerve is up, and it is still standing.
        expect(lazy.world.kaijus[0].nerve, `stage ${stage}, ${way}`).toBeGreaterThan(CAP * 0.3);
        expect(lazy.world.kaijus[0].alive).toBe(true);
      }

      const f = field(stage, ALL_ROUND);
      const k = f.world.kaijus[0];
      let first = -1;
      for (let t = 0; t < 60 * TICK_RATE && k.alive; t++) {
        // Everybody charges and lets go together when everybody is charged; into the stagger,
        // everybody fires as the guns load.
        const go = k.phase === 'stagger' || (k.nerveImmune <= 0.05 && charged(f, 4));
        const events = f.step(go ? FIRE4 : VOLLEY4);
        if (first < 0 && eventsOf(events, 'nerveBreak').length > 0) first = t / TICK_RATE;
      }
      expect(first, `stage ${stage}`).toBeGreaterThan(0);
      expect(first).toBeLessThan(COMBAT_RULES.chargeTime + 4);
      // Again and again: at least four breaks in the minute, or three and the kaiju is dead (at
      // stage 3 the first shells of a volley now break it, so the rest land on the weak point).
      const breaks = eventsOf(f.events, 'nerveBreak').length;
      expect(breaks, `stage ${stage}`).toBeGreaterThanOrEqual(k.alive ? 4 : 3);
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
        for (let t = 0; t < CHARGE_TICKS + 5; t++) f.events.push(...world.step(frame({ buttons: Btn.volley })));
        let peak = 0;
        for (let t = 0; t < 8 * TICK_RATE; t++) {
          f.events.push(...world.step(frame({})));
          peak = Math.max(peak, k.nerve);
          // What follows the volley is not part of it: the squad-mates, free again, would fire at will.
          if (t === 0) for (const id of world.squads[0].units) world.units[id].cooldown = 1e9;
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
      // The second squad stands by, planted, while the first one keeps at it.
      for (let t = 0; t < 60 * TICK_RATE; t++) f.step([charged(f, 1) ? 0 : Btn.volley, Btn.volley]);
      expect(eventsOf(f.events, 'volley').length).toBeGreaterThanOrEqual(8);
      expect(eventsOf(f.events, 'nerveBreak'), `stage ${stage}`).toEqual([]);
      expect(k.alive).toBe(true);

      // Both squads now: the second one's volley is what was missing.
      let broke = -1;
      for (let t = 0; t < 20 * TICK_RATE && broke < 0; t++) {
        const events = f.step(charged(f, 2) ? [0, 0] : [Btn.volley, Btn.volley]);
        if (eventsOf(events, 'nerveBreak').length > 0) broke = t / TICK_RATE;
      }
      expect(broke, `stage ${stage}`).toBeGreaterThanOrEqual(0);
      expect(k.phase).toBe('stagger');
    }
  });
});

// The polish pass after the first playtest: docs/STATUS.md, "Polish pass: the monster's combat feel".
describe('a volley of about ten tanks', () => {
  /** Wears a unit down to `members` (0: destroyed) the way fire would. */
  function wear(world: World, id: number, members: number): void {
    const u = world.units[id];
    const def = UNIT_TYPES[u.type];
    const hp = (members / def.members) * def.hp;
    applyHit(world, { entity: 'unit', id }, { damage: u.hp - hp + (members === 0 ? 1 : 0), nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: -1, player: 0, kind: 'swipe', atWill: false });
    expect(u.members).toBe(members);
  }

  /**
   * Stage 3, the kaiju standing still facing the squads. `members[s][i]`: tanks left in unit i of
   * squad s (the squad's leader is unit 0); a squad listed as null has been wiped out. Only the
   * first `firing` squads charge and fire one volley together; the others stand by, planted.
   */
  function lateVolley(members: Array<number[] | null>, firing: number, bearingsDeg: number[]) {
    const f = field(3, bearingsDeg.slice(0, firing).map((d) => (d * Math.PI) / 180));
    const { world } = f;
    const k = world.kaijus[0];
    members.forEach((m, s) => world.squads[s].units.forEach((id, i) => wear(world, id, m ? m[i] : 0)));
    for (let s = 0; s < 4; s++) expect(world.squads[s].eliminated).toBe(members[s] === null);
    let tanks = 0;
    for (let s = 0; s < firing; s++) for (const id of world.squads[s].units) tanks += world.units[id].alive ? world.units[id].members : 0;
    const hold = Array.from({ length: firing }, () => Btn.volley);
    for (let t = 0; t < CHARGE_TICKS + 5; t++) f.step(hold);
    f.step([]);
    // What follows the volley is not part of it: the squad-mates, free again, would fire at will.
    for (const u of world.units) u.cooldown = 1e9;
    let nerve = 0;
    for (let t = 0; t < 8 * TICK_RATE; t++) {
      for (const h of eventsOf(f.step([]), 'kaijuHit')) nerve += h.nerve;
    }
    return { world, k, tanks, nerve, events: f.events, breaks: eventsOf(f.events, 'nerveBreak').length };
  }

  it('from two squads, staggers a titan that stands still in front of them, even with the leaders shooting uncharged', () => {
    // A leader with 2 tanks and a full troop; a leader with 1 tank and two troops of 2: ten tanks, three of them leaders.
    const v = lateVolley([[2, 3, 0, 0], [1, 2, 2, 0], [3, 3, 3, 3], [3, 3, 3, 3]], 2, [-15, 15]);
    expect(v.tanks).toBe(10);
    expect(eventsOf(v.events, 'crossfire')).toEqual([]);
    expect(v.breaks).toBe(1);
    expect(eventsOf(v.events, 'kaijuStagger')[0]).toMatchObject({ on: true });
  });

  it('from the last squad standing, staggers it too: the two-squad rule asks only for the squads still in the fight', () => {
    const v = lateVolley([[1, 3, 3, 3], null, null, null], 1, [0]);
    expect(v.tanks).toBe(10);
    expect(v.breaks).toBe(1);
  });

  it('one full squad of a match with four standing still brings it only to the brink', () => {
    const v = lateVolley([[3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3]], 1, [0]);
    expect(v.tanks).toBe(12);
    expect(v.nerve).toBeGreaterThan(CAP);
    expect(v.breaks).toBe(0);
    expect(v.k.nerve).toBeGreaterThan(CAP * 0.5);
  });

  it('a few charged tanks do not: three tanks from each of two squads stay well short', () => {
    const v = lateVolley([[1, 2, 0, 0], [1, 2, 0, 0], [3, 3, 3, 3], [3, 3, 3, 3]], 2, [-15, 15]);
    expect(v.tanks).toBe(6);
    expect(v.breaks).toBe(0);
    expect(v.nerve).toBeLessThan(CAP * 0.75);
  });
});
