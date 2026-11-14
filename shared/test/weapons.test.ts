import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  COMBAT_RULES,
  DEG,
  kaijuIsSlowed,
  LIZARD,
  PROJECTILE_TYPES,
  scatterMult,
  setPlayerBot,
  shotsForMembers,
  SQUAD_RULES,
  stepProjectile,
  TICK_RATE,
  UNIT_TYPES,
  volleyStrength,
  WEAPONS,
  type PlayerInput,
  type ProjectileHitEvent,
  type ProjectileSpawnEvent,
  type SimEvent,
  type StageId,
  type Unit,
  type World,
} from '../src/index';
import { eventsOf, HUMAN_PLAYER, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const INFANTRY = UNIT_TYPES.army_rocket_infantry;
const ROCKETS = WEAPONS.army_rocket_launchers;
const ROCKET = PROJECTILE_TYPES.rocket;

/** A wide open field with the first squad (a person's) in the middle and everybody else far away. */
function field(options: TestWorldOptions = {}, stage: StageId = 1): World {
  const world = makeTestWorld(options);
  if (stage > 1) beginStage(world, stage);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -700, -700, 0);
  return world;
}

function lineUp(world: World, x: number, z: number, gap = 12): Unit[] {
  return [0, 1, 2, 3].map((id) => placeUnit(world, id, x + id * gap, z));
}

function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [null, input(partial)]);
}

/** Aim angles from a unit's eye to a point. */
function aimAt(u: Unit, x: number, y: number, z: number): { aimYaw: number; aimPitch: number } {
  const eye = u.y + UNIT_TYPES[u.type].eyeHeight;
  return { aimYaw: Math.atan2(x - u.x, z - u.z), aimPitch: Math.atan2(y - eye, Math.hypot(x - u.x, z - u.z)) };
}

/** How far a projectile's launch direction is off the straight line from its muzzle to a point: [heading, elevation]. */
function offAim(s: ProjectileSpawnEvent, x: number, y: number, z: number): [number, number] {
  const yaw = Math.atan2(s.vx, s.vz) - Math.atan2(x - s.x, z - s.z);
  const pitch = Math.atan2(s.vy, Math.hypot(s.vx, s.vz)) - Math.atan2(y - s.y, Math.hypot(x - s.x, z - s.z));
  return [yaw, pitch];
}

function sigma(values: number[]): number {
  return Math.sqrt(values.reduce((a, v) => a + v * v, 0) / values.length);
}

describe('the driven unit', () => {
  it('fires a salvo when its player pulls the trigger, and again each time the weapon is ready', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    const none = lead(world, 30);
    expect(eventsOf(none, 'projectileSpawn')).toEqual([]);

    const cooldownTicks = Math.round(ROCKETS.cooldown * TICK_RATE);
    const events = lead(world, 2 * cooldownTicks + 1, { buttons: Btn.fire });
    const spawns = eventsOf(events, 'projectileSpawn');
    // Three rockets (ten soldiers, three launchers), three times: on the press and every cooldown after.
    expect(spawns.length).toBe(9);
    const ticks = [...new Set(spawns.map((s) => s.tick))];
    expect(ticks).toEqual([spawns[0].tick, spawns[0].tick + cooldownTicks, spawns[0].tick + 2 * cooldownTicks]);
    for (const s of spawns) {
      expect(s).toMatchObject({ projectile: 'rocket', flight: 'flat', owner: 'unit', ownerId: leader.id, player: HUMAN_PLAYER, gravity: 0, volley: false });
      // It flies a little further than the launchers' range and no more.
      expect(s.ttl).toBeCloseTo((ROCKETS.range * SQUAD_RULES.rangeSlack) / ROCKET.speed, 9);
      expect(s.ttl).toBeLessThan(ROCKET.ttl);
      expect(s.y).toBe(INFANTRY.muzzleHeight);
      expect(Math.hypot(s.vx, s.vy, s.vz)).toBeCloseTo(ROCKET.speed, 9);
    }
    // The muzzles are spread across the section, square to the line of fire.
    expect(spawns.slice(0, 3).map((s) => s.x)).toEqual([-SQUAD_RULES.muzzleSpread * leader.radius, 0, SQUAD_RULES.muzzleSpread * leader.radius].map((v) => expect.closeTo(-v, 9)));
    // A person's own shots are not fire at will, and nobody else in the squad fired.
    expect(world.projectiles.every((p) => !p.atWill && p.ownerId === leader.id)).toBe(true);
    expect(world.projectiles[0]).toMatchObject({ damage: ROCKETS.damage, nerve: ROCKETS.nerve, splash: ROCKETS.splashRadius, structureDamage: ROCKETS.structureDamage, cause: 'rocket' });
  });

  it('puts every shot exactly where the aim ray lands: no aim error for a person', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    // On the ground 80 m out and a little to the right.
    const aim = aimAt(leader, -20, 0, 80);
    const events = lead(world, 1, { ...aim, buttons: Btn.fire });
    events.push(...lead(world, 60, aim));
    const spawns = eventsOf(events, 'projectileSpawn');
    expect(spawns.length).toBe(3);
    for (const s of spawns) {
      const [yaw, pitch] = offAim(s, -20, 0, 80);
      expect(yaw).toBeCloseTo(0, 9);
      expect(pitch).toBeCloseTo(0, 9);
    }
    const hits = eventsOf(events, 'projectileHit');
    expect(hits.length).toBe(3);
    for (const h of hits) {
      expect(h).toMatchObject({ target: 'ground', splash: ROCKETS.splashRadius });
      expect(Math.hypot(h.x + 20, h.z - 80)).toBeLessThan(0.05);
    }
  });

  it('hits the kaiju it is aiming at, from the side it is fired from', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    parkUnits(world, [0]);
    const k = placeKaiju(world, 0, 60, 0);
    // The squad is behind the kaiju (it faces away from them).
    const aim = aimAt(leader, 0, LIZARD.stages[0].height * 0.5, 60);
    const events = lead(world, 1, { ...aim, buttons: Btn.fire });
    events.push(...lead(world, 45, aim));
    const hits = eventsOf(events, 'kaijuHit');
    expect(hits.length).toBe(3);
    for (const h of hits) {
      expect(h).toMatchObject({ facing: 'rear', cause: 'rocket', by: HUMAN_PLAYER });
      expect(h.nerve).toBeCloseTo(ROCKETS.nerve * LIZARD.damage.rearMult, 9);
    }
    expect(k.maxHp - k.hp).toBeCloseTo(3 * ROCKETS.damage * LIZARD.damage.normalMult * LIZARD.damage.rearMult, 9);
    expect(world.players[HUMAN_PLAYER].tally.damageDealt).toBeCloseTo(k.maxHp - k.hp, 9);
  });

  it('fires fewer projectiles as members are lost, and none while shaken', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    leader.members = 6;
    expect(shotsForMembers(ROCKETS, 6)).toBe(2);
    let spawns = eventsOf(lead(world, 1, { buttons: Btn.fire }), 'projectileSpawn');
    expect(spawns.length).toBe(2);
    expect(spawns[0].x).toBeCloseTo(-spawns[1].x, 9);
    leader.members = 2;
    leader.cooldown = 0;
    spawns = eventsOf(lead(world, 1, { buttons: Btn.fire }), 'projectileSpawn');
    expect(spawns.length).toBe(1);

    leader.cooldown = 0;
    leader.shaken = 1;
    leader.state = 'shaken';
    expect(eventsOf(lead(world, 20, { buttons: Btn.fire }), 'projectileSpawn')).toEqual([]);
    // It steadies after a second, and the held trigger fires at once.
    expect(eventsOf(lead(world, 15, { buttons: Btn.fire }), 'projectileSpawn').length).toBe(1);
  });

  it('fires the weapon of its level: one tank shell, then three from a troop, one per tank left', () => {
    const tank = field({}, 2);
    const [t] = lineUp(tank, 0, 0);
    let spawns = eventsOf(lead(tank, 1, { buttons: Btn.fire }), 'projectileSpawn');
    expect(spawns.length).toBe(1);
    expect(spawns[0]).toMatchObject({ projectile: 'shell', flight: 'flat', y: UNIT_TYPES.army_tank.muzzleHeight });
    expect(Math.hypot(spawns[0].vx, spawns[0].vy, spawns[0].vz)).toBeCloseTo(PROJECTILE_TYPES.shell.speed, 9);
    expect(tank.projectiles[0]).toMatchObject({ damage: WEAPONS.army_tank_gun.damage, nerve: WEAPONS.army_tank_gun.nerve, structureDamage: WEAPONS.army_tank_gun.structureDamage, splash: 5 });
    expect(t.cooldown).toBeCloseTo(WEAPONS.army_tank_gun.cooldown, 9);

    const troop = field({}, 3);
    const [c] = lineUp(troop, 0, 0, 30);
    spawns = eventsOf(lead(troop, 1, { buttons: Btn.fire }), 'projectileSpawn');
    expect(spawns.length).toBe(3);
    expect(troop.projectiles[0]).toMatchObject({ damage: WEAPONS.army_troop_guns.damage, nerve: WEAPONS.army_troop_guns.nerve });
    c.members = 2;
    c.cooldown = 0;
    expect(eventsOf(lead(troop, 1, { buttons: Btn.fire }), 'projectileSpawn').length).toBe(2);
  });

  it('a squad salvo is about 38 damage at every level, and about 20 nerve at levels 1 and 2', () => {
    for (const weapon of Object.values(WEAPONS)) {
      expect(4 * weapon.maxShots * weapon.damage).toBeCloseTo(38.4, 0);
      // Nerve is tuned per level (docs/BALANCE.md); defs.test.ts checks what it must never exceed.
      // The level 3 troop is counted per tank since the polish pass (defs.test.ts).
      if (weapon.id === 'army_troop_guns') continue;
      expect(4 * weapon.maxShots * weapon.nerve).toBeGreaterThanOrEqual(19);
      expect(4 * weapon.maxShots * weapon.nerve).toBeLessThanOrEqual(22);
    }
  });
});

describe('the volley', () => {
  it('fires every charged sub-unit at the player\'s aim point with the charge multipliers, then starts over', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    // Five seconds of a six second charge: a real volley, not yet a full one.
    lead(world, 150);
    const charge = a.charge;
    expect(charge).toBeCloseTo(151 / (COMBAT_RULES.chargeTime * TICK_RATE), 9);

    const aim = aimAt(leader, 10, 0, 90);
    const events = lead(world, 1, { ...aim, buttons: Btn.fire });
    const spawns = eventsOf(events, 'projectileSpawn');
    expect(spawns.length).toBe(12);
    expect(spawns.every((s) => s.volley)).toBe(true);
    expect(spawns.map((s) => s.ownerId)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);

    // The charge at the moment of firing (one more tick of it) multiplies damage. Nerve only
    // counts the part of the charge above the minimum: from the fire-at-will half to x3 at full.
    const fired = charge + 1 / (COMBAT_RULES.chargeTime * TICK_RATE);
    const strength = (fired - COMBAT_RULES.volleyMinCharge) / (1 - COMBAT_RULES.volleyMinCharge);
    expect(volleyStrength(fired)).toBeCloseTo(strength, 12);
    const fullNerve = 1 + COMBAT_RULES.volleyNervePerCharge;
    for (const p of world.projectiles) {
      if (p.ownerId === leader.id) {
        expect(p.damage).toBeCloseTo(ROCKETS.damage, 9);
        expect(p.nerve).toBeCloseTo(ROCKETS.nerve, 9);
      } else {
        expect(p.damage).toBeCloseTo(ROCKETS.damage * (1 + COMBAT_RULES.volleyDamagePerCharge * fired), 9);
        expect(p.nerve).toBeCloseTo(ROCKETS.nerve * (COMBAT_RULES.atWillNerveMult + (fullNerve - COMBAT_RULES.atWillNerveMult) * strength), 9);
      }
      expect(p.structureDamage).toBe(ROCKETS.structureDamage);
      expect(p.volley).toBe(true);
      expect(p.atWill).toBe(false);
    }
    expect(eventsOf(events, 'volley')).toMatchObject([{ squad: 0, player: HUMAN_PLAYER, units: [1, 2, 3], y: 0 }]);
    const v = eventsOf(events, 'volley')[0];
    expect([v.x, v.z]).toEqual([expect.closeTo(10, 6), expect.closeTo(90, 6)]);
    expect(v.charge).toBeCloseTo(fired, 9);
    expect(world.players[HUMAN_PLAYER].tally.volleys).toBe(1);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('volley.fired');

    // Every rocket is headed for the aim point, give or take the aim error (between the volley's and the at-will one).
    const error = ROCKETS.aimErrorAtWill + (ROCKETS.aimErrorVolley - ROCKETS.aimErrorAtWill) * strength;
    for (const s of spawns.slice(3)) {
      const [yaw, pitch] = offAim(s, 10, 0, 90);
      expect(Math.abs(yaw)).toBeLessThan(5 * error);
      expect(Math.abs(pitch)).toBeLessThan(5 * error);
    }

    // The charge is spent; they stay planted (the squad has not moved) and build it again.
    for (const u of [a, b, c]) {
      expect(u.charge).toBe(0);
      expect(u.cooldown).toBeCloseTo(ROCKETS.cooldown, 9);
    }
    lead(world, 30, aim);
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(true);
      expect(u.charge).toBeCloseTo(30 / (COMBAT_RULES.chargeTime * TICK_RATE), 9);
      expect([u.x, u.z]).toEqual([u.id * 12, 0]);
    }
  });

  it('is ragged below the minimum charge: the sub-units fire with the trigger, but it is fire at will and no volley', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    // Half a charge: more than holding Fire ever gets (the launchers reload in 2.6 s of the 6).
    lead(world, 89);
    const events = lead(world, 1, { ...aimAt(leader, 10, 0, 90), buttons: Btn.fire });
    const fired = 91 / (COMBAT_RULES.chargeTime * TICK_RATE);
    expect(fired).toBeLessThan(COMBAT_RULES.volleyMinCharge);
    const spawns = eventsOf(events, 'projectileSpawn');
    expect(spawns.map((s) => s.ownerId)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(spawns.some((s) => s.volley)).toBe(false);
    expect(eventsOf(events, 'volley')).toEqual([]);
    expect(world.players[HUMAN_PLAYER].tally.volleys).toBe(0);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).not.toContain('volley.fired');
    for (const p of world.projectiles) {
      if (p.ownerId === leader.id) continue;
      // The time spent aiming still tells in the damage; the nerve is what fire at will is worth.
      expect(p.damage).toBeCloseTo(ROCKETS.damage * (1 + COMBAT_RULES.volleyDamagePerCharge * fired), 9);
      expect(p.nerve).toBeCloseTo(ROCKETS.nerve * COMBAT_RULES.atWillNerveMult, 9);
      expect(p.volley).toBe(false);
    }
    // The charge is spent all the same.
    for (const u of [a, b, c]) {
      expect(u.charge).toBe(0);
      expect(u.cooldown).toBeCloseTo(ROCKETS.cooldown, 9);
    }
  });

  it('is at full strength after the charge time: damage x2, nerve x3', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    lead(world, 1, { wheel: 'holdCharge' });
    lead(world, COMBAT_RULES.chargeTime * TICK_RATE + 5);
    const events = lead(world, 1, { ...aimAt(leader, 10, 0, 90), buttons: Btn.fire });
    expect(eventsOf(events, 'volley')[0].charge).toBe(1);
    const sub = world.projectiles.filter((p) => p.ownerId !== 0);
    expect(sub.length).toBe(9);
    for (const p of sub) {
      expect(p.damage).toBeCloseTo(2 * ROCKETS.damage, 9);
      expect(p.nerve).toBeCloseTo(3 * ROCKETS.nerve, 9);
    }
  });

  it('is only the player\'s own shot when nobody has charge', () => {
    const world = field();
    const [leader, a] = lineUp(world, 0, 0);
    const events = lead(world, 1, { ...aimAt(leader, 10, 0, 90), buttons: Btn.fire });
    expect(eventsOf(events, 'projectileSpawn').length).toBe(3);
    expect(eventsOf(events, 'volley')).toEqual([]);
    expect(world.players[HUMAN_PLAYER].tally.volleys).toBe(0);
    expect(a.cooldown).toBe(0);
  });

  it('leaves out a sub-unit whose firing arc does not cover the aim point; it keeps its charge', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0, 60);
    // Planted facing north (the leader looks at the ground a kilometer to the north).
    const north = aimAt(leader, 90, 0, 1000);
    lead(world, 1, { ...north, wheel: 'holdCharge' });
    lead(world, 120, north);
    const charge = a.charge;
    // The player swings round and fires west: only arcs that reach there join in. None do.
    const west = aimAt(leader, -150, 0, 0);
    let events = lead(world, 1, { ...west, buttons: Btn.fire });
    expect(eventsOf(events, 'projectileSpawn').length).toBe(3);
    expect(eventsOf(events, 'volley')).toEqual([]);
    for (const u of [a, b, c]) {
      expect(u.rooted).toBe(true);
      expect(u.charge).toBeGreaterThan(charge);
    }
    // A point just inside the far unit's arc edge (and outside the others') takes that one unit along.
    leader.cooldown = 0;
    const edge = COMBAT_RULES.chargeHalfArc - 1 * DEG;
    const px = c.x + Math.sin(c.arcYaw + edge) * 80;
    const pz = c.z + Math.cos(c.arcYaw + edge) * 80;
    events = lead(world, 1, { ...aimAt(leader, px, 0, pz), buttons: Btn.fire });
    expect(eventsOf(events, 'volley')).toMatchObject([{ units: [c.id] }]);
    expect(a.charge).toBeGreaterThan(charge);
    expect(c.charge).toBe(0);
  });

  it('aims the sub-units at the middle of the kaiju when the player\'s crosshair is on it', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0, 30);
    parkUnits(world, [0, 1, 2, 3]);
    // Sub-units on three sides of the kaiju, the leader on the fourth.
    placeUnit(world, 1, 60, 60);
    placeUnit(world, 2, 0, 120);
    placeUnit(world, 3, -60, 60);
    const k = placeKaiju(world, 0, 60, 0);
    const aim = aimAt(leader, 0, 3, 60);
    lead(world, 1, { ...aim, wheel: 'holdCharge' });
    lead(world, COMBAT_RULES.chargeTime * TICK_RATE, aim);
    const events = lead(world, 1, { ...aim, buttons: Btn.fire });
    expect(eventsOf(events, 'volley')).toMatchObject([{ units: [1, 2, 3], charge: 1 }]);
    // The aim point of the event is where the ray met the kaiju's skin, on the leader's side.
    const v = eventsOf(events, 'volley')[0];
    expect(v.z).toBeGreaterThan(60 - k.radius - 0.01);
    expect(v.z).toBeLessThan(60 - k.radius + 0.4);
    expect(v.y).toBeCloseTo(3, 1);
    events.push(...lead(world, 60, aim));
    // All twelve rockets connect, each from its own side.
    const hits = eventsOf(events, 'kaijuHit');
    expect(hits.length).toBe(12);
    expect(hits.filter((h) => h.facing === 'rear').length).toBe(3);
    expect(hits.filter((h) => h.facing === 'flank').length).toBe(6);
    expect(hits.filter((h) => h.facing === 'front').length).toBe(3);
    expect(eventsOf(events, 'crossfire').length).toBeGreaterThan(0);
    for (const u of [a, b, c]) expect(u.hp).toBe(u.maxHp);
  });

  it('does not take along a sub-unit that is shaken or whose weapon is not ready', () => {
    const world = field();
    const [leader, a, b, c] = lineUp(world, 0, 0);
    const aim = aimAt(leader, 18, 0, 100);
    lead(world, 1, { ...aim, wheel: 'holdCharge' });
    lead(world, 150, aim);
    a.cooldown = 1;
    b.shaken = 2;
    const events = lead(world, 1, { ...aim, buttons: Btn.fire });
    expect(eventsOf(events, 'volley')).toMatchObject([{ units: [c.id] }]);
    expect(a.charge).toBeGreaterThan(0);
    expect(a.rooted).toBe(true);
  });
});

describe('weapon range', () => {
  /** One full-charge volley of the first squad at a kaiju `dist` meters away on open ground; returns what came of it. */
  function volleyAt(stage: StageId, dist: number): { events: SimEvent[]; world: World } {
    const world = field({}, stage);
    const units = lineUp(world, 0, 0, 2 * world.units[0].radius + 3);
    const k = placeKaiju(world, units[1].x, dist, 0);
    const aim = aimAt(units[0], k.x, k.height / 2, k.z);
    lead(world, 1, { ...aim, wheel: 'holdCharge' });
    lead(world, COMBAT_RULES.chargeTime * TICK_RATE + 5, aim);
    const events = lead(world, 1, { ...aim, buttons: Btn.fire });
    events.push(...lead(world, 12 * TICK_RATE, aim));
    return { events, world };
  }

  it('limits a person\'s own shots and volleys alike: nothing flies much further than the weapon reaches', () => {
    for (const [stage, weapon] of [[1, WEAPONS.army_rocket_launchers], [2, WEAPONS.army_tank_gun], [3, WEAPONS.army_troop_guns]] as const) {
      const radius = LIZARD.stages[stage - 1].bodyRadius;
      const shots = 4 * weapon.maxShots;

      // Just inside the listed range (to the middle of the kaiju): the whole volley can connect.
      const near = volleyAt(stage, weapon.range - 5);
      expect(eventsOf(near.events, 'volley').length).toBe(1);
      expect(eventsOf(near.events, 'projectileSpawn').length).toBe(shots);
      // (The player's own salvo has no aim error; at this distance some of the hatchling's attackers miss.)
      expect(eventsOf(near.events, 'kaijuHit').length, `stage ${stage} at range`).toBeGreaterThanOrEqual(weapon.maxShots);

      // Well beyond it: the squad still fires, and nothing arrives.
      const far = volleyAt(stage, weapon.range * 1.5 + radius);
      const spawns = eventsOf(far.events, 'projectileSpawn');
      expect(spawns.length).toBe(shots);
      expect(eventsOf(far.events, 'kaijuHit'), `stage ${stage} beyond range`).toEqual([]);
      expect(far.world.kaijus[0].nerve).toBe(0);
      // Every projectile gave out in the air a little past the listed range from its muzzle
      // (or came down short of that: aim error can put a flat shot into the ground).
      const ends = eventsOf(far.events, 'projectileHit');
      expect(ends.length).toBe(shots);
      expect(ends.filter((e) => e.target === 'none').length).toBeGreaterThanOrEqual(weapon.maxShots);
      for (const end of ends) {
        const from = spawns.find((s) => s.id === end.id);
        if (!from) throw new Error('no spawn');
        expect(['none', 'ground']).toContain(end.target);
        const flown = Math.hypot(end.x - from.x, end.y - from.y, end.z - from.z);
        if (end.target === 'none') expect(flown).toBeGreaterThanOrEqual(weapon.range);
        expect(flown).toBeLessThanOrEqual(weapon.range * SQUAD_RULES.rangeSlack + PROJECTILE_TYPES[weapon.projectile].speed / TICK_RATE + 1e-6);
        expect(from.ttl).toBeCloseTo((weapon.range * SQUAD_RULES.rangeSlack) / PROJECTILE_TYPES[weapon.projectile].speed, 9);
      }
    }
  });

  it('reaches further with a range upgrade', () => {
    const world = field({}, 2);
    const [leader] = lineUp(world, 0, 0, 11);
    world.squads[0].mods.mult.weaponRange = 1.5;
    const events = lead(world, 1, { ...aimAt(leader, 0, 30, 2000), buttons: Btn.fire });
    const gun = WEAPONS.army_tank_gun;
    expect(eventsOf(events, 'projectileSpawn')[0].ttl).toBeCloseTo((gun.range * 1.5 * SQUAD_RULES.rangeSlack) / PROJECTILE_TYPES.shell.speed, 9);
  });
});

describe('aim error and scatter', () => {
  /**
   * Fires `rounds` volleys in quick succession (a test rig: weapons are reloaded and the charge
   * is set by hand, a full one unless the test says otherwise) and returns the sub-units' launch errors.
   */
  function volleyErrors(world: World, aim: { aimYaw: number; aimPitch: number }, at: [number, number, number], rounds: number, prepare?: () => void, charge = 1): number[] {
    const errors: number[] = [];
    lead(world, 1, { ...aim, wheel: 'holdCharge' });
    for (let i = 0; i < rounds; i++) {
      // A unit that has just fired plants itself again on the next tick, with its charge at 0.
      lead(world, 1, aim);
      for (const id of [0, 1, 2, 3]) world.units[id].cooldown = 0;
      for (const id of [1, 2, 3]) world.units[id].charge = charge;
      prepare?.();
      const events = lead(world, 1, { ...aim, buttons: Btn.fire });
      for (const s of eventsOf(events, 'projectileSpawn')) {
        if (s.ownerId === 0) continue;
        errors.push(...offAim(s, at[0], at[1], at[2]));
      }
      world.projectiles.length = 0;
    }
    return errors;
  }

  it('gives sub-units the volley error in a volley, one sigma, on heading and elevation', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    const errors = volleyErrors(world, aimAt(leader, 18, 0, 150), [18, 0, 150], 60);
    expect(errors.length).toBe(60 * 9 * 2);
    expect(sigma(errors)).toBeGreaterThan(ROCKETS.aimErrorVolley * 0.9);
    expect(sigma(errors)).toBeLessThan(ROCKETS.aimErrorVolley * 1.1);
    // No bias: the pattern is centered on the aim point.
    expect(Math.abs(errors.reduce((a, v) => a + v, 0) / errors.length)).toBeLessThan(ROCKETS.aimErrorVolley * 0.15);
  });

  it('gives a ragged volley the at-will error, and a part-charged one something in between', () => {
    const ragged = field();
    let errors = volleyErrors(ragged, aimAt(lineUp(ragged, 0, 0)[0], 18, 0, 150), [18, 0, 150], 60, undefined, 0.4);
    expect(sigma(errors)).toBeGreaterThan(ROCKETS.aimErrorAtWill * 0.9);
    expect(sigma(errors)).toBeLessThan(ROCKETS.aimErrorAtWill * 1.1);

    const part = field();
    const charge = (1 + COMBAT_RULES.volleyMinCharge) / 2;
    errors = volleyErrors(part, aimAt(lineUp(part, 0, 0)[0], 18, 0, 150), [18, 0, 150], 60, undefined, charge - 1 / (COMBAT_RULES.chargeTime * TICK_RATE));
    const between = (ROCKETS.aimErrorAtWill + ROCKETS.aimErrorVolley) / 2;
    expect(sigma(errors)).toBeGreaterThan(between * 0.9);
    expect(sigma(errors)).toBeLessThan(between * 1.1);
  });

  it('gives them the larger at-will error when they fire on their own', () => {
    const world = field();
    const [, a] = lineUp(world, 0, 0);
    parkUnits(world, [0, 1]);
    const k = placeKaiju(world, 12, 400, 0);
    const errors: number[] = [];
    // Out of the spotting range of the leader, so nothing tightens the fire. (The range is stretched for the test.)
    world.squads[0].mods.mult.weaponRange = 4;
    for (let i = 0; i < 400 && errors.length < 600; i++) {
      a.cooldown = 0;
      const events = lead(world, 1);
      for (const s of eventsOf(events, 'projectileSpawn')) errors.push(...offAim({ ...s, x: a.x, z: a.z }, k.x, k.height * 0.5, k.z));
      world.projectiles.length = 0;
      world.hits.length = 0;
    }
    expect(errors.length).toBeGreaterThanOrEqual(600);
    expect(world.kaijus[0].spotted).toBe(false);
    expect(sigma(errors)).toBeGreaterThan(ROCKETS.aimErrorAtWill * 0.9);
    expect(sigma(errors)).toBeLessThan(ROCKETS.aimErrorAtWill * 1.1);
  });

  it('tightens with the stage, with a spotter and with a slowed target', () => {
    const k = makeTestWorld().kaijus[0];
    expect(scatterMult(1, k)).toBe(1);
    expect(scatterMult(1, null)).toBe(1);
    expect(scatterMult(2, null)).toBe(0.8);
    expect(scatterMult(3, null)).toBe(0.6);
    k.spotted = true;
    expect(scatterMult(1, k)).toBeCloseTo(COMBAT_RULES.scatterSpottedMult, 12);
    // Slowed: carrying enough nerve damage, staggered, or cocooned.
    expect(kaijuIsSlowed(k)).toBe(false);
    k.nerve = LIZARD.nerveCapacity * COMBAT_RULES.scatterSlowedNerve - 1;
    expect(kaijuIsSlowed(k)).toBe(false);
    k.nerve = LIZARD.nerveCapacity * COMBAT_RULES.scatterSlowedNerve;
    expect(kaijuIsSlowed(k)).toBe(true);
    expect(scatterMult(1, k)).toBeCloseTo(0.7 * 0.6, 12);
    k.nerve = 0;
    k.phase = 'stagger';
    expect(kaijuIsSlowed(k)).toBe(true);
    k.phase = 'cocoon';
    expect(kaijuIsSlowed(k)).toBe(true);
    k.phase = 'idle';
    k.spotted = false;
    k.stage = 3;
    k.nerve = 50;
    expect(scatterMult(1, k)).toBeCloseTo(0.6 * 0.6, 12);
  });

  it('applies those multipliers, and the veteran one, to the shots themselves', () => {
    // Stage 3, the titan in plain view 120 m from the leader and already slowed: 0.6 x 0.7 x 0.6.
    const world = field({}, 3);
    const [leader, a, b, c] = lineUp(world, 0, 0, 30);
    const k = placeKaiju(world, 0, 120 + LIZARD.stages[2].bodyRadius, 0);
    const guns = WEAPONS.army_troop_guns;
    const aim = aimAt(leader, 45, 0, 60);
    const slow = (): void => {
      k.nerve = 60;
      k.hp = k.maxHp;
    };
    slow();
    lead(world, 2, aim);
    expect(k.spotted).toBe(true);
    let errors = volleyErrors(world, aim, [45, 0, 60], 50, slow);
    const expected = guns.aimErrorVolley * 0.6 * COMBAT_RULES.scatterSpottedMult * COMBAT_RULES.scatterSlowedMult;
    expect(sigma(errors)).toBeGreaterThan(expected * 0.88);
    expect(sigma(errors)).toBeLessThan(expected * 1.12);

    // Veterans shoot straighter still.
    for (const u of [a, b, c]) u.veteran = true;
    errors = volleyErrors(world, aim, [45, 0, 60], 50, slow);
    expect(sigma(errors)).toBeGreaterThan(expected * COMBAT_RULES.veteranAimErrorMult * 0.88);
    expect(sigma(errors)).toBeLessThan(expected * COMBAT_RULES.veteranAimErrorMult * 1.12);
  });

  it('treats a bot at the trigger like a sub-unit: aim error, and half nerve unless it is a volley', () => {
    const world = field();
    const [leader] = lineUp(world, 0, 0);
    parkUnits(world, [0]);
    setPlayerBot(world, HUMAN_PLAYER, true);
    const p = world.players[HUMAN_PLAYER];
    const aim = aimAt(leader, 0, 0, 150);
    const errors: number[] = [];
    for (let i = 0; i < 100; i++) {
      leader.cooldown = 0;
      // The bot's input for the next tick (the stub bot leaves the aim alone and lets go of the buttons).
      p.botInput.aimYaw = aim.aimYaw;
      p.botInput.aimPitch = aim.aimPitch;
      p.botInput.buttons = Btn.fire;
      const events = world.step();
      for (const s of eventsOf(events, 'projectileSpawn')) errors.push(...offAim(s, 0, 0, 150));
      expect(world.projectiles.every((q) => q.atWill)).toBe(true);
      world.projectiles.length = 0;
    }
    expect(errors.length).toBeGreaterThan(200);
    expect(sigma(errors)).toBeGreaterThan(ROCKETS.aimErrorAtWill * 0.85);
    expect(sigma(errors)).toBeLessThan(ROCKETS.aimErrorAtWill * 1.15);
  });
});

describe('projectile events', () => {
  /** Flies a client-side copy of a spawned projectile with the shared kinematics until the server said it ended. */
  function replay(spawn: ProjectileSpawnEvent, hit: ProjectileHitEvent): { x: number; y: number; z: number } {
    const body = { x: spawn.x, y: spawn.y, z: spawn.z, vx: spawn.vx, vy: spawn.vy, vz: spawn.vz, gravity: spawn.gravity };
    const prev = { x: body.x, y: body.y, z: body.z };
    // A projectile has flown one step by the end of its spawn tick.
    for (let tick = spawn.tick; tick <= hit.tick; tick++) {
      prev.x = body.x;
      prev.y = body.y;
      prev.z = body.z;
      stepProjectile(body, 1 / TICK_RATE);
    }
    // The impact is somewhere on the last step.
    const seg = Math.hypot(body.x - prev.x, body.y - prev.y, body.z - prev.z);
    const toHit = Math.hypot(hit.x - prev.x, hit.y - prev.y, hit.z - prev.z);
    const fromHit = Math.hypot(hit.x - body.x, hit.y - body.y, hit.z - body.z);
    expect(toHit + fromHit).toBeCloseTo(seg, 6);
    return body;
  }

  it('carry everything a client needs to fly volleys and at-will fire locally', () => {
    const world = field({ structures: [{ x: 40, z: 120, w: 60, d: 10, height: 14, hp: 100000 }] });
    const [leader] = lineUp(world, 0, 0);
    placeKaiju(world, 30, 80, 0);
    const aim = aimAt(leader, 30, 2, 80);
    const events = lead(world, 1, { ...aim, wheel: 'holdCharge' });
    events.push(...lead(world, 100, aim));
    events.push(...lead(world, 200, { ...aim, buttons: Btn.fire }));
    events.push(...lead(world, 1, { wheel: 'fireAtWill' }));
    events.push(...lead(world, 300));
    const spawns = eventsOf(events, 'projectileSpawn');
    const hits = eventsOf(events, 'projectileHit');
    expect(spawns.length).toBeGreaterThan(40);
    const targets = new Set<string>();
    let ended = 0;
    for (const s of spawns) {
      const h = hits.find((e) => e.id === s.id);
      if (!h) continue;
      ended++;
      expect(h.projectile).toBe(s.projectile);
      expect(h.tick).toBeGreaterThanOrEqual(s.tick);
      replay(s, h);
      targets.add(h.target);
    }
    // Every projectile that is gone from the world has had its ending announced.
    expect(ended).toBe(spawns.length - world.projectiles.length);
    expect(new Set(spawns.map((s) => s.id)).size).toBe(spawns.length);
    expect([...targets].sort()).toEqual(expect.arrayContaining(['kaiju']));
    expect(targets.size).toBeGreaterThan(1);
  });
});
