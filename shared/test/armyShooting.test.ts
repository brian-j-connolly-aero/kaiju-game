/**
 * Round 5, the army's shooting after the third playtest ("army machine gun bugged, could only
 * shoot one at a time and charged shots didn't work"; "LOS issues"): regression tests that fail on
 * the round 4 code. Each goes through the player's input (`world.step` with the squad's buttons
 * and aim), the path a person's mouse takes on the server. Written by the round 5 army
 * investigation and its checker, adopted here; the volley comparison averages five seeds (one
 * seed alone measured 1.16 against the bar of 1.2 where five measure about 1.4).
 */

import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  chargeCap,
  COMBAT_RULES,
  DT,
  PICKUP_WEAPONS,
  TICK_RATE,
  UNIT_TYPES,
  WEAPONS,
  type Squad,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type Unit,
  type World,
} from '../src/index';
import { eventsOf, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run } from './helpers';

const CHARGE_TICKS = Math.round(COMBAT_RULES.chargeTime * TICK_RATE);
const RANGE: Record<StageId, number> = { 1: WEAPONS.army_rocket_launchers.range, 2: WEAPONS.army_tank_gun.range, 3: WEAPONS.army_troop_guns.range };

/** Open ground at a stage, the first squad (a person's) lined up facing +Z, everybody else parked far off. */
function field(stage: StageId, seed = 7): { world: World; units: Unit[] } {
  const world = makeTestWorld({ seed });
  // The first tick of a stage hands out its pick-ups (none): set one after it.
  run(world, 1);
  if (stage > 1) {
    beginStage(world, stage);
    run(world, 1);
  }
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -700, -700, 0);
  const gap = 2 * world.units[0].radius + 3;
  const units = [0, 1, 2, 3].map((id) => {
    const u = placeUnit(world, id, id * gap, 0);
    u.yaw = 0;
    u.aimYaw = 0;
    u.control.aimYaw = 0;
    return u;
  });
  return { world, units };
}

function aimAt(u: Unit, x: number, y: number, z: number): { aimYaw: number; aimPitch: number } {
  const eye = u.y + UNIT_TYPES[u.type].eyeHeight;
  return { aimYaw: Math.atan2(x - u.x, z - u.z), aimPitch: Math.atan2(y - eye, Math.hypot(x - u.x, z - u.z)) };
}

const lead = (world: World, ticks: number, p: Partial<PlayerInput> = {}): SimEvent[] => run(world, ticks, [null, input(p)]);

/** The person's own Fire held for 6 s at the monster `share` of the weapon's range away; the squad-mates kept quiet. */
function fireHeld(stage: StageId, pickup: Squad['pickup'], share: number): { spawnTicks: number[]; damage: number } {
  const { world, units } = field(stage);
  for (const u of units.slice(1)) u.cooldown = 1e9;
  world.squads[0].pickup = pickup;
  const k = placeKaiju(world, units[0].x, RANGE[stage] * share, Math.PI);
  const aim = aimAt(units[0], k.x, k.height / 2, k.z);
  units[0].aimYaw = aim.aimYaw;
  const events = lead(world, 6 * TICK_RATE, { ...aim, buttons: Btn.fire });
  units[0].cooldown = 1e9;
  events.push(...lead(world, 6 * TICK_RATE, aim));
  const spawnTicks = eventsOf(events, 'projectileSpawn').filter((e) => e.ownerId === 0).map((e) => e.tick);
  return { spawnTicks, damage: eventsOf(events, 'kaijuHit').reduce((a, h) => a + h.damage, 0) };
}

/** One full-charge volley at the monster `share` of the weapon's range away: the nerve it put on the monster. */
function volleyNerve(stage: StageId, pickup: Squad['pickup'], share: number, seed = 7): number {
  const { world, units } = field(stage, seed);
  world.squads[0].pickup = pickup;
  const k = placeKaiju(world, units[1].x, RANGE[stage] * share, Math.PI);
  const aim = aimAt(units[0], k.x, k.height / 2, k.z);
  units[0].aimYaw = aim.aimYaw;
  lead(world, CHARGE_TICKS + 5, { ...aim, buttons: Btn.volley });
  const events = lead(world, 1, aim);
  for (const u of units) u.cooldown = 1e9;
  events.push(...lead(world, 8 * TICK_RATE, aim));
  return eventsOf(events, 'kaijuHit').reduce((a, h) => a + h.nerve, 0);
}

describe('round 5: the machine gun', () => {
  it('streams while Fire is held: one tracer at a time, the next within 0.2 s, at every stage (round 4: one pull every 0.53 s on foot, 0.67 s in a tank, a single tracer at stage 2)', () => {
    for (const stage of [1, 2, 3] as StageId[]) {
      const spawns = fireHeld(stage, 'machineGun', 0.6).spawnTicks;
      const ticks = [...new Set(spawns)].sort((a, b) => a - b);
      const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
      expect(Math.max(...gaps) / TICK_RATE, `stage ${stage}: longest gap between tracers`).toBeLessThanOrEqual(0.2);
      // One tracer at a time, not a clump on one tick.
      expect(spawns.length, `stage ${stage}: tracers on the same tick`).toBe(ticks.length);
    }
  });

  it('is worth having on Fire: held at the stage 1 hatchling it deals more than the plain launchers (round 4: x0.66 at 60% of range, x0.29 at 90%)', () => {
    for (const share of [0.6, 0.9]) {
      const plain = fireHeld(1, 'none', share).damage;
      const mg = fireHeld(1, 'machineGun', share).damage;
      expect(mg / plain, `${share * 100}% of range`).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('is worth having in a charged volley: more nerve than a plain volley at stages 1 and 2, over five seeds (round 4: x0.64 and x0.40 at stage 1, x1.03 and x0.43 at stage 2)', () => {
    const seeds = [1, 2, 3, 4, 5];
    for (const stage of [1, 2] as StageId[]) {
      for (const share of [0.6, 0.9]) {
        const plain = seeds.reduce((a, s) => a + volleyNerve(stage, 'none', share, s), 0);
        const mg = seeds.reduce((a, s) => a + volleyNerve(stage, 'machineGun', share, s), 0);
        expect(mg / plain, `stage ${stage}, ${share * 100}% of range`).toBeGreaterThanOrEqual(1.2);
      }
    }
  });
});

describe('round 5: a charge is never spent for nothing', () => {
  it('a squad-mate charged past 60% fires when Volley is let go, even right after a big cannon or missile pod volley (round 4: they charge to full while reloading, then do not fire, and the charge is gone)', () => {
    for (const stage of [1, 2] as StageId[]) {
      for (const pickup of ['bigCannon', 'missilePod'] as Array<Squad['pickup']>) {
        const { world, units } = field(stage);
        world.squads[0].pickup = pickup;
        const k = placeKaiju(world, units[1].x, RANGE[stage] * 0.5, Math.PI);
        const aim = aimAt(units[0], k.x, k.height / 2, k.z);
        units[0].aimYaw = aim.aimYaw;
        // A first charged volley, let go at full.
        lead(world, CHARGE_TICKS + 2, { ...aim, buttons: Btn.volley });
        lead(world, 1, aim);
        // At once the button again, held until the squad's meter reads full, then let go.
        let held = 0;
        while (held < 30 * TICK_RATE && !units.slice(1).every((u) => u.charge >= 1)) {
          lead(world, 1, { ...aim, buttons: Btn.volley });
          held++;
        }
        const charged = units.slice(1).filter((u) => u.charge >= COMBAT_RULES.volleyMinCharge).map((u) => u.id);
        const events = lead(world, 1, aim);
        const fired = new Set(eventsOf(events, 'projectileSpawn').map((e) => e.ownerId));
        for (const id of charged) expect(fired.has(id), `stage ${stage}, ${pickup}: squad-mate ${id} was charged and did not fire`).toBe(true);
      }
    }
  });

  it('a squad-mate still reloading charges only to just under the 60% notch, and on from there once loaded', () => {
    const { world, units } = field(1);
    const mate = units[1];
    mate.cooldown = 6;
    const aim = { aimYaw: 0, aimPitch: 0 };
    lead(world, CHARGE_TICKS, { ...aim, buttons: Btn.volley });
    expect(mate.rooted).toBe(true);
    expect(mate.charge).toBeLessThan(COMBAT_RULES.volleyMinCharge);
    expect(mate.charge).toBeGreaterThan(COMBAT_RULES.volleyMinCharge - 0.02);
    // The others, loaded, are full.
    expect(units[2].charge).toBeCloseTo(1, 6);
    // Loaded again (6 s after it began), it charges on from the notch to full.
    lead(world, 4 * TICK_RATE, { ...aim, buttons: Btn.volley });
    expect(mate.charge).toBeCloseTo(1, 6);
    // The rule as a function the screen can use too.
    expect(chargeCap(0)).toBe(1);
    expect(chargeCap(DT)).toBe(1);
    expect(chargeCap(2)).toBeLessThan(COMBAT_RULES.volleyMinCharge);
  });
});

describe('round 5: a volley from behind cover', () => {
  // The checker's case: the leader 3 m behind a 4 m garage, three squad-mates 14 to 20 m to the
  // side in the open, the hatchling 66 m off, the crosshair on its head (as the third-person
  // camera sees it over the roof).
  function behindCover() {
    const world = makeTestWorld({ structures: [{ x: 0, z: 6, w: 8, d: 6, height: 4 }] });
    run(world, 1);
    parkUnits(world);
    const leader = placeUnit(world, 0, 0, 0);
    const mates = [placeUnit(world, 1, 14, 0), placeUnit(world, 2, -14, 0), placeUnit(world, 3, 20, -4)];
    for (const u of [leader, ...mates]) {
      u.yaw = 0;
      u.aimYaw = 0;
      u.control.aimYaw = 0;
    }
    const k = placeKaiju(world, 0, 66, Math.PI);
    const eye = leader.y + UNIT_TYPES[leader.type].eyeHeight;
    const aim = { aimYaw: 0, aimPitch: Math.atan2(k.height * 0.9 - eye, 66) };
    return { world, leader, k, aim };
  }

  it('squad-mates in the open with a clear line put nerve on the monster when the crosshair is on it, even if the leader crouches behind a garage (round 4: all 12 shots hit the garage, 0 nerve)', () => {
    const { world, aim } = behindCover();
    run(world, CHARGE_TICKS + 5, [null, input({ ...aim, buttons: Btn.volley })]);
    const ev = run(world, 3 * TICK_RATE, [null, input(aim)]);
    const nerve = eventsOf(ev, 'kaijuHit').reduce((a, h) => a + h.nerve, 0);
    expect(nerve).toBeGreaterThan(20);
    // The leader's own shot is a shot from behind the garage: it hits the garage.
    const leaderShots = eventsOf(ev, 'projectileSpawn').filter((e) => e.ownerId === 0).map((e) => e.id);
    const leaderHits = eventsOf(ev, 'projectileHit').filter((h) => leaderShots.includes(h.id));
    expect(leaderHits.length).toBeGreaterThan(0);
    expect(leaderHits.every((h) => h.target === 'structure')).toBe(true);
  });

  it('the artillery radio barrage that volley calls comes down at the monster, not on the garage beside the squad (round 4: marked 3 m from the leader, 63 m from the monster)', () => {
    const { world, leader, k, aim } = behindCover();
    world.squads[0].barrages = 3;
    run(world, CHARGE_TICKS + 5, [null, input({ ...aim, buttons: Btn.volley })]);
    const ev = run(world, 2, [null, input(aim)]);
    const marked = eventsOf(ev, 'callin').find((c) => c.phase === 'marked');
    expect(marked).toBeDefined();
    expect(Math.hypot(marked!.x - k.x, marked!.z - k.z)).toBeLessThan(Math.hypot(marked!.x - leader.x, marked!.z - leader.z));
  });
});

describe('round 5: the machine gun numbers', () => {
  it('streams one tracer every sixth of a second, a hair of spread for the look only', () => {
    expect(PICKUP_WEAPONS.machineGun.stream).toBeCloseTo(1 / 6, 9);
    expect(PICKUP_WEAPONS.machineGun.spread).toBeLessThanOrEqual((0.3 * Math.PI) / 180 + 1e-12);
  });
});
