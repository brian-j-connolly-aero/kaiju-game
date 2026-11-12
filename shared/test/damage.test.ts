import { describe, expect, it } from 'vitest';
import {
  applyHit,
  beginStage,
  Btn,
  COMBAT_RULES,
  DEG,
  DT,
  healKaiju,
  hitFacing,
  kaijuMoveParams,
  LIZARD,
  TICK_RATE,
  UNIT_TYPES,
  type DamageKind,
  type Hit,
  type SimEvent,
  type World,
} from '../src/index';
import { dirOfYaw, eventsOf, HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run } from './helpers';

const P = LIZARD.damage;
const CAP = LIZARD.nerveCapacity;

/** A hit on the kaiju from a unit standing along `yaw` as seen from the kaiju (0 = dead ahead of a kaiju facing yaw 0). */
function shot(yaw: number, partial: Partial<Hit> = {}): Hit {
  return {
    damage: 10,
    nerve: 0,
    fromDir: dirOfYaw(yaw),
    sourceId: 4,
    player: HUMAN_PLAYER,
    kind: 'shell',
    atWill: false,
    ...partial,
  };
}

/** The same, as part of a charged volley of a squad (unit 4 is the second squad's; pass the unit to match). */
function volleyShot(yaw: number, squad: number, partial: Partial<Hit> = {}): Hit {
  return shot(yaw, { sourceId: squad * 4, player: squad + 1, volleySquad: squad, ...partial });
}

/** Applies a hit to the kaiju right now and returns the events it caused. */
function hitKaiju(world: World, hit: Hit): SimEvent[] {
  const from = world.events.length;
  applyHit(world, { entity: 'kaiju', id: 0 }, hit);
  return world.events.slice(from);
}

function hitUnit(world: World, id: number, partial: Partial<Hit> = {}): SimEvent[] {
  const from = world.events.length;
  applyHit(world, { entity: 'unit', id }, {
    damage: 0,
    nerve: 0,
    fromDir: { x: 0, z: 0 },
    sourceId: 0,
    player: KAIJU_PLAYER,
    kind: 'swipe',
    atWill: false,
    ...partial,
  });
  return world.events.slice(from);
}

/** A world with the kaiju at the origin facing +Z and every unit parked out of the way. */
function arena(): World {
  const world = makeTestWorld();
  placeKaiju(world, 0, 0, 0);
  parkUnits(world);
  return world;
}

describe('applyHit on the kaiju: damage', () => {
  it('scales damage by state and by facing, and reports the hit', () => {
    const world = arena();
    const k = world.kaijus[0];

    let events = hitKaiju(world, shot(0, { damage: 100 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.normalMult * P.frontMult, 9);
    expect(eventsOf(events, 'kaijuHit')).toMatchObject([
      { kaiju: 0, facing: 'front', cause: 'shell', by: HUMAN_PLAYER, braced: false },
    ]);
    expect(eventsOf(events, 'kaijuHit')[0].damage).toBeCloseTo(100 * P.normalMult * P.frontMult, 9);

    k.hp = k.maxHp;
    events = hitKaiju(world, shot(90 * DEG, { damage: 100 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.normalMult * P.flankMult, 9);
    expect(eventsOf(events, 'kaijuHit')[0].facing).toBe('flank');

    k.hp = k.maxHp;
    events = hitKaiju(world, shot(180 * DEG, { damage: 100 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.normalMult * P.rearMult, 9);
    expect(eventsOf(events, 'kaijuHit')[0].facing).toBe('rear');

    // The design's point: the front is tough, the flanks softer, the rear softest.
    expect(P.frontMult).toBeLessThan(P.flankMult);
    expect(P.flankMult).toBeLessThan(P.rearMult);
  });

  it('judges facing against the body heading, with the boundaries from the definition', () => {
    const world = arena();
    const k = placeKaiju(world, 0, 0, 40 * DEG);
    const eps = 0.5 * DEG;
    expect(hitFacing(k, dirOfYaw(40 * DEG))).toBe('front');
    expect(hitFacing(k, dirOfYaw(40 * DEG + P.frontHalfAngle - eps))).toBe('front');
    expect(hitFacing(k, dirOfYaw(40 * DEG - P.frontHalfAngle + eps))).toBe('front');
    expect(hitFacing(k, dirOfYaw(40 * DEG + P.frontHalfAngle + eps))).toBe('flank');
    expect(hitFacing(k, dirOfYaw(40 * DEG + P.rearAngle - eps))).toBe('flank');
    expect(hitFacing(k, dirOfYaw(40 * DEG + P.rearAngle + eps))).toBe('rear');
    expect(hitFacing(k, dirOfYaw(40 * DEG + 180 * DEG))).toBe('rear');
    // A blast has no direction and counts as frontal.
    expect(hitFacing(k, { x: 0, z: 0 })).toBe('front');
  });

  it('takes far less on the braced front arc, and nothing off the flank or rear', () => {
    const world = arena();
    const k = world.kaijus[0];
    run(world, 3, [input({ buttons: Btn.block })]);
    expect(k.phase).toBe('brace');

    let events = hitKaiju(world, shot(0, { damage: 100, nerve: 10 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.braceFrontMult * P.frontMult, 9);
    expect(k.nerve).toBeCloseTo(10 * P.braceNerveMult * P.frontMult, 9);
    expect(eventsOf(events, 'kaijuHit')[0].braced).toBe(true);
    expect(P.braceFrontMult).toBeLessThan(P.normalMult);

    // Just inside the edge of the braced arc still counts.
    k.hp = k.maxHp;
    k.nerve = 0;
    hitKaiju(world, shot(P.braceHalfArc - 0.5 * DEG, { damage: 100 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.braceFrontMult * P.frontMult, 9);

    // The brace does nothing for the flank: this is why humans go around.
    k.hp = k.maxHp;
    events = hitKaiju(world, shot(100 * DEG, { damage: 100, nerve: 10 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.normalMult * P.flankMult, 9);
    expect(k.nerve).toBeCloseTo(10 * P.flankMult, 9);
    expect(eventsOf(events, 'kaijuHit')[0].braced).toBe(false);

    // Nor against a hit with no direction.
    k.hp = k.maxHp;
    hitKaiju(world, shot(0, { damage: 100, fromDir: { x: 0, z: 0 } }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.normalMult, 9);
  });

  it('takes full damage while staggered or cocooned', () => {
    const world = arena();
    const k = world.kaijus[0];
    k.phase = 'stagger';
    k.phaseDuration = COMBAT_RULES.staggerDuration;
    hitKaiju(world, shot(0, { damage: 100 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.helplessMult * P.frontMult, 9);

    k.hp = k.maxHp;
    k.phase = 'cocoon';
    k.action = 'molt';
    hitKaiju(world, shot(180 * DEG, { damage: 100 }));
    expect(k.maxHp - k.hp).toBeCloseTo(100 * P.helplessMult * P.rearMult, 9);
    expect(P.helplessMult).toBeGreaterThan(P.normalMult);
  });

  it('gains rage from the damage it actually takes and credits the shooter', () => {
    const world = arena();
    const k = world.kaijus[0];
    hitKaiju(world, shot(180 * DEG, { damage: 200 }));
    const lost = k.maxHp - k.hp;
    expect(lost).toBeCloseTo(200 * P.normalMult * P.rearMult, 9);
    expect(k.rage).toBeCloseTo(lost / COMBAT_RULES.rageDamagePerPoint, 9);
    expect(world.players[HUMAN_PLAYER].tally.damageDealt).toBeCloseTo(lost, 9);

    // Rage is capped.
    k.phase = 'stagger';
    hitKaiju(world, shot(0, { damage: 5000 }));
    expect(k.rage).toBeLessThanOrEqual(COMBAT_RULES.rageMax);
  });

  it('dies at 0 hp: no more actions, and the humans win by a kill', () => {
    const world = arena();
    const k = world.kaijus[0];
    k.phase = 'stagger';
    world.hits.push({ target: { entity: 'kaiju', id: 0 }, hit: shot(180 * DEG, { damage: 1e6 }) });
    const events = world.step([input({ buttons: Btn.strike })]);
    expect(k.hp).toBe(0);
    expect(k.alive).toBe(false);
    expect(k.phase).toBe('dead');
    expect(k.action).toBe('none');
    expect(eventsOf(events, 'matchEnd')).toMatchObject([{ winner: 'humans', reason: 'kill' }]);
    // Overkill only counts the hp that was there.
    expect(world.players[HUMAN_PLAYER].tally.damageDealt).toBeCloseTo(k.maxHp, 6);
    // A dead kaiju ignores further hits.
    expect(hitKaiju(world, shot(0, { damage: 50, nerve: 50 }))).toEqual([]);
  });

  it('heals through healKaiju, never past full', () => {
    const world = arena();
    const k = world.kaijus[0];
    k.hp = k.maxHp - 30;
    expect(healKaiju(k, 20)).toBe(20);
    expect(healKaiju(k, 50)).toBe(10);
    expect(k.hp).toBe(k.maxHp);
    expect(healKaiju(k, 50)).toBe(0);
  });
});

describe('applyHit on the kaiju: nerve', () => {
  it('accumulates with the facing multiplier and leaks away continuously', () => {
    const world = arena();
    const k = world.kaijus[0];
    hitKaiju(world, shot(0, { nerve: 20 }));
    expect(k.nerve).toBeCloseTo(20 * P.frontMult, 9);
    hitKaiju(world, shot(180 * DEG, { nerve: 20 }));
    expect(k.nerve).toBeCloseTo(20 * P.frontMult + 20 * P.rearMult, 9);

    const before = k.nerve;
    run(world, TICK_RATE);
    expect(k.nerve).toBeCloseTo(before - LIZARD.nerveLeak, 6);
    run(world, TICK_RATE * 10);
    expect(k.nerve).toBe(0);
  });

  it('halves the nerve of fire-at-will hits', () => {
    const world = arena();
    const k = world.kaijus[0];
    hitKaiju(world, shot(0, { nerve: 20, atWill: true }));
    expect(k.nerve).toBeCloseTo(20 * COMBAT_RULES.atWillNerveMult, 9);
    // Damage is not affected.
    const hp = k.hp;
    hitKaiju(world, shot(0, { damage: 50, atWill: true }));
    expect(hp - k.hp).toBeCloseTo(50 * P.normalMult, 9);
  });

  it('multiplies nerve when two units hit from widely separated angles (crossfire)', () => {
    const world = arena();
    const k = world.kaijus[0];
    const angle = COMBAT_RULES.crossfireMinAngle;

    // The first hit is just a hit.
    let events = hitKaiju(world, shot(-20 * DEG, { nerve: 10, sourceId: 4 }));
    expect(k.nerve).toBeCloseTo(10, 9);
    expect(eventsOf(events, 'crossfire')).toEqual([]);

    // Another unit, at least the minimum angle away: crossfire.
    events = hitKaiju(world, shot(-20 * DEG + angle, { nerve: 10, sourceId: 5 }));
    expect(k.nerve).toBeCloseTo(10 + 10 * COMBAT_RULES.crossfireNerveMult, 9);
    expect(eventsOf(events, 'crossfire')).toMatchObject([{ kaiju: 0, unitA: 5, unitB: 4, x: 0, z: 0 }]);

    // And it works both ways: the first unit's next shot now crosses the second's.
    k.nerve = 0;
    events = hitKaiju(world, shot(-20 * DEG, { nerve: 10, sourceId: 4 }));
    expect(k.nerve).toBeCloseTo(10 * COMBAT_RULES.crossfireNerveMult, 9);
    // The event is rate limited; the multiplier is not.
    expect(eventsOf(events, 'crossfire')).toEqual([]);
    expect(COMBAT_RULES.crossfireNerveMult).toBeGreaterThan(1);
  });

  it('does not count the same unit, a narrow angle, old hits or sourceless hits as crossfire', () => {
    const world = arena();
    const k = world.kaijus[0];
    const angle = COMBAT_RULES.crossfireMinAngle;

    // One unit that drives around is not crossfire with itself.
    hitKaiju(world, shot(0, { nerve: 10, sourceId: 4 }));
    hitKaiju(world, shot(50 * DEG, { nerve: 10, sourceId: 4 }));
    expect(k.nerve).toBeCloseTo(20, 9);

    // Another unit almost alongside it is not crossfire either (it is a plain flank hit).
    k.nerve = 0;
    hitKaiju(world, shot(50 * DEG + angle - 2 * DEG, { nerve: 10, sourceId: 5 }));
    expect(k.nerve).toBeCloseTo(10 * P.flankMult, 9);

    // After the window has passed, an old hit no longer counts.
    const world2 = arena();
    const k2 = world2.kaijus[0];
    hitKaiju(world2, shot(0, { nerve: 10, sourceId: 4 }));
    run(world2, Math.ceil(COMBAT_RULES.crossfireWindow * TICK_RATE) + 1);
    k2.nerve = 0;
    hitKaiju(world2, shot(120 * DEG, { nerve: 10, sourceId: 5 }));
    expect(k2.nerve).toBeCloseTo(10 * P.flankMult, 9);

    // Inside the window it does.
    const world3 = arena();
    const k3 = world3.kaijus[0];
    hitKaiju(world3, shot(0, { nerve: 10, sourceId: 4 }));
    run(world3, Math.floor(COMBAT_RULES.crossfireWindow * TICK_RATE) - 1);
    k3.nerve = 0;
    hitKaiju(world3, shot(120 * DEG, { nerve: 10, sourceId: 5 }));
    expect(k3.nerve).toBeCloseTo(10 * P.flankMult * COMBAT_RULES.crossfireNerveMult, 9);

    // Hits with no source unit (a call-in) or no direction neither make nor take crossfire.
    const world4 = arena();
    const k4 = world4.kaijus[0];
    hitKaiju(world4, shot(0, { nerve: 10, sourceId: -1, kind: 'arty' }));
    hitKaiju(world4, shot(180 * DEG, { nerve: 10, sourceId: 5 }));
    hitKaiju(world4, shot(0, { nerve: 10, sourceId: 6, fromDir: { x: 0, z: 0 } }));
    expect(k4.nerve).toBeCloseTo(10 + 10 * P.rearMult + 10, 9);
    expect(k4.recentHits.map((r) => r.unit)).toEqual([5]);
  });

  it('slows the kaiju while nerve damage builds, by at most the rule', () => {
    const world = arena();
    const k = world.kaijus[0];
    const full = kaijuMoveParams(k, world.match.bounds).topSpeed;
    hitKaiju(world, shot(0, { nerve: CAP / 2 }));
    const half = kaijuMoveParams(k, world.match.bounds).topSpeed;
    expect(half).toBeCloseTo(full * (1 - COMBAT_RULES.nerveSlowMax / 2), 6);
    k.nerve = CAP;
    expect(kaijuMoveParams(k, world.match.bounds).topSpeed).toBeCloseTo(full * (1 - COMBAT_RULES.nerveSlowMax), 6);

    // In the world: with the same input, a rattled kaiju covers less ground.
    const calm = arena();
    const rattled = arena();
    const walk = [input({ moveZ: 1 })];
    for (let i = 0; i < TICK_RATE * 2; i++) {
      rattled.kaijus[0].nerve = CAP * 0.9;
      calm.step(walk);
      rattled.step(walk);
    }
    expect(rattled.kaijus[0].z).toBeLessThan(calm.kaijus[0].z * 0.85);
    expect(rattled.kaijus[0].z).toBeGreaterThan(calm.kaijus[0].z * (1 - COMBAT_RULES.nerveSlowMax) * 0.9);
  });

  it('breaks at capacity: a stagger that cuts the action short, then immunity', () => {
    const world = arena();
    const k = world.kaijus[0];
    // Mid swipe, walking.
    run(world, 5, [input({ buttons: Btn.strike, moveZ: 1 })]);
    expect(k.phase).toBe('windup');

    // Charged volleys from two squads, landing on the same tick.
    world.hits.push({ target: { entity: 'kaiju', id: 0 }, hit: volleyShot(0, 1, { nerve: CAP - 1 }) });
    world.hits.push({ target: { entity: 'kaiju', id: 0 }, hit: volleyShot(0, 0, { nerve: 5 }) });
    let events = world.step([input({ moveZ: 1 })]);
    expect(k.phase).toBe('stagger');
    expect(k.action).toBe('none');
    expect(k.phaseDuration).toBe(COMBAT_RULES.staggerDuration);
    expect(eventsOf(events, 'nerveBreak')).toMatchObject([{ kaiju: 0, by: HUMAN_PLAYER }]);
    expect(eventsOf(events, 'kaijuStagger')).toMatchObject([{ kaiju: 0, on: true, duration: COMBAT_RULES.staggerDuration }]);
    expect(world.match.breaks).toBe(1);
    expect(world.players[HUMAN_PLAYER].tally.breaks).toBe(1);

    // Helpless: it cannot move or act, takes full damage, and its nerve cannot be broken again.
    const at = { x: k.x, z: k.z };
    const hp = k.hp;
    events = run(world, 30, [input({ moveZ: 1, buttons: Btn.strike })]);
    expect(eventsOf(events, 'kaijuAction')).toEqual([]);
    expect(Math.hypot(k.x - at.x, k.z - at.z)).toBeLessThan(1.5);
    expect(k.phase).toBe('stagger');
    events = hitKaiju(world, volleyShot(0, 1, { damage: 50, nerve: CAP }));
    expect(hp - k.hp).toBeCloseTo(50 * P.helplessMult, 9);
    expect(eventsOf(events, 'nerveBreak')).toEqual([]);
    expect(world.match.breaks).toBe(1);

    // It lasts exactly the stagger duration, then nerve clears and immunity starts.
    const left = Math.round(COMBAT_RULES.staggerDuration * TICK_RATE) - 31;
    events = run(world, left - 1, [input()]);
    expect(k.phase).toBe('stagger');
    events = run(world, 2, [input()]);
    expect(k.phase).toBe('idle');
    expect(k.nerve).toBe(0);
    expect(eventsOf(events, 'kaijuStagger')).toMatchObject([{ on: false, duration: COMBAT_RULES.staggerNerveImmunity }]);
    expect(k.nerveImmune).toBeGreaterThan(COMBAT_RULES.staggerNerveImmunity - 3 * DT);

    // Immune: nerve damage does nothing, hp damage still lands (at the normal rate again).
    const hp2 = k.hp;
    events = hitKaiju(world, volleyShot(0, 0, { damage: 50, nerve: CAP * 2 }));
    hitKaiju(world, volleyShot(0, 1, { damage: 0, nerve: CAP * 2 }));
    expect(k.nerve).toBe(0);
    expect(k.phase).toBe('idle');
    expect(hp2 - k.hp).toBeCloseTo(50 * P.normalMult, 9);
    expect(eventsOf(events, 'kaijuHit')[0].nerve).toBe(0);

    // When the immunity runs out it can be broken again.
    run(world, Math.ceil(COMBAT_RULES.staggerNerveImmunity * TICK_RATE) + 1, [input()]);
    expect(k.nerveImmune).toBe(0);
    hitKaiju(world, volleyShot(0, 0, { nerve: CAP }));
    hitKaiju(world, volleyShot(0, 1, { nerve: 1 }));
    expect(k.phase).toBe('stagger');
    expect(world.match.breaks).toBe(2);
  });

  it('takes two squads to break: anything else only brings it to the brink', () => {
    const world = arena();
    const k = world.kaijus[0];
    const window = Math.round(COMBAT_RULES.volleyBreakWindow * TICK_RATE);
    expect(COMBAT_RULES.breakSquads).toBe(2);

    // Fire that is no charged volley, however much of it, from however many squads: the brink.
    let events = hitKaiju(world, shot(0, { nerve: CAP * 3 }));
    events.push(...hitKaiju(world, shot(Math.PI, { nerve: CAP, sourceId: 8, player: 3 })));
    events.push(...hitKaiju(world, shot(0, { nerve: CAP, sourceId: -1, kind: 'arty' })));
    expect(eventsOf(events, 'nerveBreak')).toEqual([]);
    expect(k.phase).toBe('idle');
    expect(k.nerve).toBe(CAP);
    // On the brink it is as slow as nerve damage makes it, and it leaks away as ever.
    expect(kaijuMoveParams(k, world.match.bounds).topSpeed).toBeCloseTo(LIZARD.stages[0].topSpeed * (1 - COMBAT_RULES.nerveSlowMax), 6);
    run(world, TICK_RATE, [input()]);
    expect(k.nerve).toBeCloseTo(CAP - LIZARD.nerveLeak, 6);

    // One squad's charged volleys, from behind and crossing each other: still the brink.
    events = hitKaiju(world, volleyShot(Math.PI, 0, { nerve: CAP }));
    events.push(...hitKaiju(world, volleyShot(Math.PI - 70 * DEG, 0, { nerve: CAP, sourceId: 1 })));
    expect(eventsOf(events, 'crossfire').length).toBe(1);
    expect(eventsOf(events, 'nerveBreak')).toEqual([]);
    expect(k.nerve).toBe(CAP);

    // A second squad's volley that comes too late is one squad again...
    run(world, window + 1, [input()]);
    events = hitKaiju(world, volleyShot(0, 1, { nerve: CAP }));
    expect(eventsOf(events, 'nerveBreak')).toEqual([]);
    expect(k.phase).toBe('idle');
    // ...and the first squad's next volley, inside the window, is what breaks it. The straw that
    // does it need not be a volley shot: the two volleys have landed, the nerve is full.
    run(world, window - 5, [input()]);
    events = hitKaiju(world, volleyShot(Math.PI, 0, { nerve: 1 }));
    expect(eventsOf(events, 'nerveBreak')).toEqual([]);
    events = hitKaiju(world, shot(0, { nerve: CAP, atWill: true }));
    expect(eventsOf(events, 'nerveBreak')).toMatchObject([{ kaiju: 0, by: HUMAN_PLAYER }]);
    expect(k.phase).toBe('stagger');
  });

  it('asks a match with a single squad for that squad only, and one with no squads for nothing', () => {
    const one = arena();
    one.squads.length = 1;
    hitKaiju(one, shot(0, { nerve: CAP }));
    expect(one.kaijus[0].phase).toBe('idle');
    hitKaiju(one, volleyShot(0, 0, { nerve: 1 }));
    expect(one.kaijus[0].phase).toBe('stagger');

    const none = arena();
    none.squads.length = 0;
    hitKaiju(none, shot(0, { nerve: CAP, sourceId: -1 }));
    expect(none.kaijus[0].phase).toBe('stagger');
  });

  it('cannot have its nerve broken in the cocoon', () => {
    const world = arena();
    const k = world.kaijus[0];
    k.phase = 'cocoon';
    k.action = 'molt';
    k.phaseDuration = 10;
    hitKaiju(world, shot(0, { nerve: CAP * 3 }));
    expect(k.phase).toBe('cocoon');
    expect(k.nerve).toBe(0);
  });
});

describe('applyHit on units', () => {
  it('removes hp, loses members one by one, and reports both', () => {
    const world = arena();
    const u = world.units[0];
    const def = UNIT_TYPES[u.type];
    const events = hitUnit(world, 0, { damage: def.hp * 0.35 });
    expect(u.hp).toBeCloseTo(def.hp * 0.65, 9);
    expect(u.members).toBe(Math.ceil(def.members * 0.65));
    expect(eventsOf(events, 'unitHit')).toMatchObject([{ unit: 0, cause: 'swipe', x: u.x, z: u.z }]);
    expect(eventsOf(events, 'unitHit')[0].hp).toBeCloseTo(u.hp, 9);
    expect(eventsOf(events, 'memberLost')).toMatchObject([
      { unit: 0, count: def.members - Math.ceil(def.members * 0.65), members: Math.ceil(def.members * 0.65) },
    ]);
    expect(world.players[KAIJU_PLAYER].tally.damageDealt).toBeCloseTo(def.hp * 0.35, 9);
    // A scratch that does not cost a member reports only the hit.
    expect(eventsOf(hitUnit(world, 0, { damage: 0.5 }), 'memberLost')).toEqual([]);
  });

  it('shakes a unit when its nerve reaches capacity: charge lost, for the shaken duration', () => {
    const world = arena();
    const u = world.units[0];
    u.charge = 0.8;
    const cap = COMBAT_RULES.unitNerveCapacity;
    let events = hitUnit(world, 0, { nerve: cap * 0.6, kind: 'roar' });
    expect(u.nerve).toBeCloseTo(cap * 0.6, 9);
    expect(u.shaken).toBe(0);
    expect(u.charge).toBe(0.8);
    expect(eventsOf(events, 'unitShaken')).toEqual([]);

    // It leaks away while nothing happens.
    run(world, TICK_RATE);
    expect(u.nerve).toBeCloseTo(cap * 0.6 - COMBAT_RULES.unitNerveLeak, 6);

    events = hitUnit(world, 0, { nerve: cap * 0.6, kind: 'stomp' });
    expect(u.shaken).toBe(COMBAT_RULES.shakenDuration);
    expect(u.state).toBe('shaken');
    expect(u.charge).toBe(0);
    expect(u.nerve).toBe(0);
    expect(eventsOf(events, 'unitShaken')).toMatchObject([{ unit: 0, duration: COMBAT_RULES.shakenDuration }]);
    expect(world.players[KAIJU_PLAYER].tally.breaks).toBe(1);

    // Already shaken: more nerve changes nothing.
    events = hitUnit(world, 0, { nerve: cap * 5 });
    expect(eventsOf(events, 'unitShaken')).toEqual([]);
    expect(u.nerve).toBe(0);

    // It steadies after the duration and starts again from zero.
    run(world, Math.round(COMBAT_RULES.shakenDuration * TICK_RATE) - 1);
    expect(u.shaken).toBeGreaterThan(0);
    run(world, 2);
    expect(u.shaken).toBe(0);
    expect(u.state).not.toBe('shaken');
    expect(u.nerve).toBe(0);
  });

  it('clears the charge on a hit that says so, whatever its nerve', () => {
    const world = arena();
    const u = world.units[0];
    u.charge = 1;
    hitUnit(world, 0, { nerve: 1, kind: 'roar', resetsCharge: true });
    expect(u.charge).toBe(0);
    expect(u.shaken).toBe(0);
  });

  it('destroys a unit at 0 hp, rattles its neighbors and counts it', () => {
    const world = arena();
    placeUnit(world, 0, 100, 100);
    placeUnit(world, 1, 100 + COMBAT_RULES.friendlyLossRadius - 5, 100);
    placeUnit(world, 2, 100 + COMBAT_RULES.friendlyLossRadius + 5, 100);
    const events = hitUnit(world, 0, { damage: 1e6, kind: 'stomp' });
    const u = world.units[0];
    expect(u.alive).toBe(false);
    expect(u.hp).toBe(0);
    expect(u.members).toBe(0);
    expect(u.state).toBe('dead');
    // Infantry leaves no wreck.
    expect(u.wreck).toBe(false);
    expect(eventsOf(events, 'unitDestroyed')).toMatchObject([
      { unit: 0, squad: 0, unitType: u.type, x: 100, z: 100, cause: 'stomp', by: KAIJU_PLAYER },
    ]);
    expect(eventsOf(events, 'memberLost')).toMatchObject([{ unit: 0, members: 0 }]);
    expect(world.match.kills).toBe(1);
    expect(world.players[KAIJU_PLAYER].tally.kills).toBe(1);
    expect(world.players[HUMAN_PLAYER].tally.unitsLost).toBe(1);
    // Overkill is not damage dealt.
    expect(world.players[KAIJU_PLAYER].tally.damageDealt).toBe(u.maxHp);

    expect(world.units[1].nerve).toBe(COMBAT_RULES.friendlyLossNerve);
    expect(world.units[2].nerve).toBe(0);
    // Dead units ignore everything.
    expect(hitUnit(world, 0, { damage: 10, nerve: 10 })).toEqual([]);
  });

  it('leaves a wreck where a vehicle dies', () => {
    const world = arena();
    beginStage(world, 2);
    const u = world.units[0];
    expect(UNIT_TYPES[u.type].body).toBe('vehicle');
    hitUnit(world, 0, { damage: 1e6 });
    expect(u.alive).toBe(false);
    expect(u.wreck).toBe(true);
  });

  it('marks the squad eliminated when its last unit dies, in the same tick', () => {
    const world = arena();
    const squad = world.squads[0];
    for (const id of squad.units.slice(0, 3)) hitUnit(world, id, { damage: 1e6 });
    expect(squad.eliminated).toBe(false);
    world.hits.push({
      target: { entity: 'unit', id: squad.units[3] },
      hit: { damage: 1e6, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: KAIJU_PLAYER, kind: 'swipe', atWill: false },
    });
    const events = world.step();
    expect(squad.eliminated).toBe(true);
    expect(squad.driven).toBe(-1);
    expect(world.players[HUMAN_PLAYER].tally.unitsLost).toBe(4);
    const cues = eventsOf(events, 'voice').map((e) => e.cue);
    expect(cues).toContain('squad.wiped');
  });

  it('does not credit a human for hurting other humans (a bridge they dropped)', () => {
    const world = arena();
    hitUnit(world, 4, { damage: 30, player: HUMAN_PLAYER, kind: 'shell' });
    expect(world.units[4].hp).toBe(world.units[4].maxHp - 30);
    expect(world.players[HUMAN_PLAYER].tally.damageDealt).toBe(0);
    expect(world.players[HUMAN_PLAYER].tally.kills).toBe(0);
  });
});

describe('trample', () => {
  it('hurts units under a moving kaiju at the trample rate, and not under a standing one', () => {
    const world = arena();
    const k = world.kaijus[0];
    const u = placeUnit(world, 0, 0, 1);
    // Standing on top of the unit, not moving: nothing.
    run(world, TICK_RATE, [input()]);
    expect(u.hp).toBe(u.maxHp);

    // Walking over it: once it is moving, every tick under the body costs the trample rate.
    let events: SimEvent[] = [];
    let ticks = 0;
    for (let i = 0; i < TICK_RATE * 3 && u.hp === u.maxHp; i++) world.step([input({ moveZ: 1 })]);
    const hpAtStart = u.hp;
    expect(hpAtStart).toBeLessThan(u.maxHp);
    for (let i = 0; i < 10; i++) {
      const d = Math.hypot(k.x - u.x, k.z - u.z);
      if (d >= k.radius + u.radius - 0.5) break;
      events = events.concat(world.step([input({ moveZ: 1 })]));
      ticks++;
    }
    expect(ticks).toBeGreaterThan(3);
    expect(hpAtStart - u.hp).toBeCloseTo(LIZARD.trampleDps * DT * ticks, 6);
    // Continuous damage is reported sparsely, not every tick.
    const kinds: DamageKind[] = eventsOf(events, 'unitHit').map((e) => e.cause);
    expect(kinds.every((c) => c === 'trample')).toBe(true);
    expect(kinds.length).toBeLessThan(ticks);
  });

  it('kills what it keeps walking over and counts the kill for the kaiju', () => {
    const world = arena();
    const k = world.kaijus[0];
    const u = placeUnit(world, 0, 0, 3);
    u.hp = 2;
    u.members = 1;
    const events = run(world, 20, [input({ moveZ: 1 })]);
    expect(u.alive).toBe(false);
    expect(eventsOf(events, 'unitDestroyed')).toMatchObject([{ unit: 0, cause: 'trample', by: KAIJU_PLAYER }]);
    expect(world.players[k.player].tally.kills).toBe(1);
  });
});
