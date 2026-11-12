import { describe, expect, it } from 'vitest';
import {
  allStageBounds,
  beginStage,
  boundsContains,
  Btn,
  CITY_SEED,
  COMBAT_RULES,
  createMatchConfig,
  createRng,
  createWorld,
  DT,
  getCity,
  idleBots,
  kaijuStageDef,
  LIZARD,
  MATCH_RULES,
  rngRange,
  spawnProjectile,
  structuresInCircle,
  TICK_RATE,
  UNIT_TYPES,
  type PlayerInput,
  type SimEvent,
  type World,
} from '../src/index';
import { eventsOf, holdFire, HUMAN_PLAYER, input, KAIJU_PLAYER, makeTestWorld, parkUnits, placeKaiju, placeUnit, run } from './helpers';

const COCOON_TICKS = MATCH_RULES.cocoon * TICK_RATE;
const INTERMISSION_TICKS = MATCH_RULES.intermission * TICK_RATE;
const MOLT_HOLD_TICKS = Math.ceil(LIZARD.actions.molt.holdTime * TICK_RATE) + 2;
const R2 = LIZARD.stages[1].bodyRadius;
const R3 = LIZARD.stages[2].bodyRadius;

/** A world whose bar is already past the first two marks, so the kaiju may molt at once; the third is out of reach. */
function moltWorld(options: Parameters<typeof makeTestWorld>[0] = {}): World {
  const world = makeTestWorld({
    marks: [10, 20, 1e6],
    structures: [{ x: 150, z: 150, w: 10, d: 10, height: 20, hp: 100, value: 25 }],
    ...options,
  });
  // The squads hold their fire: these tests are about what the molt does, not about stray rockets.
  holdFire(world);
  world.structureHits.push({ id: 0, damage: Infinity, by: KAIJU_PLAYER, cause: 'swipe' });
  world.step();
  expect(world.kaijus[0].moltAvailable).toBe(true);
  return world;
}

/** The same in the shipped city: marks low enough that one flattened building passes two of them. */
function realMoltWorld(): World {
  return moltWorld({ realCity: true, structures: undefined, marks: [1, 2, 1e9] });
}

/** Steps with the kaiju player's input (everybody else lets go). */
function play(world: World, ticks: number, kaiju: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [input(kaiju), input()]);
}

/** Holds Molt until the cocoon closes, and returns the events up to and including that tick. */
function cocoon(world: World): SimEvent[] {
  const events = play(world, MOLT_HOLD_TICKS, { buttons: Btn.molt });
  expect(world.kaijus[0].phase).toBe('cocoon');
  return events;
}

/** Runs the cocoon to the tick before it opens. */
function toLastCocoonTick(world: World): SimEvent[] {
  const k = world.kaijus[0];
  const events: SimEvent[] = [];
  while (k.phaseTime < k.phaseDuration - DT - 1e-6) events.push(...play(world, 1));
  expect(k.phase).toBe('cocoon');
  return events;
}

describe('the molt: blast wave', () => {
  it('destroys what is close, shakes and throws what is near, and leaves the rest and every building alone', () => {
    const world = moltWorld({
      structures: [
        { x: 150, z: 150, w: 10, d: 10, height: 20, hp: 100, value: 25 },
        // A house right beside the cocoon: the blast must not touch it.
        { x: -14, z: 0, w: 8, d: 8, height: 6, hp: 80, value: 8 },
      ],
    });
    const k = placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    const killRadius = MATCH_RULES.blastKillRadius * R2;
    const shoveRadius = MATCH_RULES.blastShoveRadius * R2;
    const inside = placeUnit(world, 4, 0, killRadius - 4);
    const edge = placeUnit(world, 5, killRadius + 6, 0);
    const near = placeUnit(world, 8, 0, -(shoveRadius - 5));
    const far = placeUnit(world, 12, shoveRadius + 20, 0);
    const bar = world.match.barPoints;
    const houseHp = world.structureHp[1];

    cocoon(world);
    k.rage = 40;
    k.hp = 300;
    toLastCocoonTick(world);
    // Something in the air and a fire mission on its way when the cocoon opens.
    spawnProjectile(world, {
      type: 'rocket', flight: 'flat', owner: 'unit', ownerId: 12, player: 4, x: 100, y: 30, z: 100, vx: 0, vy: 0, vz: 1,
      gravity: 0, ttl: 5, damage: 1, nerve: 1, splash: 1, structureDamage: 1, cause: 'rocket', volley: false, atWill: false, payload: null,
    });
    world.callIns.push({ id: 7, callIn: 'artillery', squad: 3, player: 4, x: 50, z: 50, timer: 30, shellsLeft: 8, nextShell: 0, dirX: 0, dirZ: 1 });
    const clock = world.match.clock;

    const events = play(world, 1);
    expect(eventsOf(events, 'moltBlast')).toMatchObject([{ kaiju: 0, x: 0, z: 0, killRadius, shoveRadius }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('molt.blast');

    // Inside the kill radius: gone, and no veteran comes of it.
    expect(inside.alive).toBe(false);
    expect(eventsOf(events, 'unitDestroyed')).toMatchObject([{ unit: 4, cause: 'blast', by: KAIJU_PLAYER }]);
    expect(world.players[KAIJU_PLAYER].tally.kills).toBe(1);
    // Between the radii: alive, shaken, thrown outward.
    for (const u of [edge, near]) {
      expect(u.alive).toBe(true);
      expect(u.hp).toBe(UNIT_TYPES.army_rocket_infantry.hp);
      expect(u.shaken).toBe(COMBAT_RULES.shakenDuration);
      expect(u.charge).toBe(0);
    }
    expect(edge.vx).toBeGreaterThan(10);
    expect(near.vz).toBeLessThan(-5);
    expect(eventsOf(events, 'unitShaken').map((e) => e.unit).sort()).toEqual([5, 8]);
    // Beyond: untouched.
    expect(far.shaken).toBe(0);
    expect(far.vx).toBe(0);

    // No free bar: every building stands as it stood.
    expect(world.structureHp[1]).toBe(houseHp);
    expect(world.match.barPoints).toBe(bar);
    expect(eventsOf(events, 'structureStage')).toEqual([]);

    // Nothing is left in the air; the fire mission is called off.
    expect(world.projectiles).toEqual([]);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ target: 'none', targetId: -1 }]);
    expect(world.callIns).toEqual([]);
    expect(eventsOf(events, 'callin')).toMatchObject([{ id: 7, phase: 'done' }]);

    // The kaiju stands up whole at its new size, where the cocoon was; the cocoon is closed as an action.
    expect(k).toMatchObject({ stage: 2, radius: R2, height: LIZARD.stages[1].height, hp: LIZARD.hp, nerve: 0, phase: 'idle', action: 'none', x: 0, z: 0 });
    expect(k.rage).toBe(40);
    expect(eventsOf(events, 'kaijuAction')).toMatchObject([{ action: 'molt', phase: 'idle' }]);

    // Intermission: still the old stage and bounds, the clock stopped at where it was.
    expect(world.match).toMatchObject({ phase: 'intermission', stage: 1 });
    expect(world.match.bounds).toEqual(world.match.stageBounds[0]);
    expect(world.match.phaseTime).toBe(MATCH_RULES.intermission);
    expect(eventsOf(events, 'matchPhase')).toMatchObject([{ phase: 'intermission', stage: 1, duration: MATCH_RULES.intermission, nextStage: 2 }]);
    expect(world.match.clock).toBeCloseTo(clock - DT, 9);
  });

  it('throws the survivors clear during the intermission, where they come to rest inside the bounds', () => {
    const world = moltWorld();
    placeKaiju(world, 0, 0, 0);
    parkUnits(world);
    const shoveRadius = MATCH_RULES.blastShoveRadius * R2;
    const u = placeUnit(world, 8, MATCH_RULES.blastKillRadius * R2 + 8, 0);
    cocoon(world);
    toLastCocoonTick(world);
    play(world, 1);
    expect(world.match.phase).toBe('intermission');
    const clock = world.match.clock;
    const elapsed = world.match.elapsed;

    // Nobody acts in the intermission: sticks and buttons do nothing, but the thrown unit slides.
    const k = world.kaijus[0];
    const events = run(world, 60, [input({ moveZ: 1, buttons: Btn.strike | Btn.roar }), input({ moveX: 1, buttons: Btn.fire, wheel: 'holdCharge' })]);
    expect(eventsOf(events, 'kaijuAction')).toEqual([]);
    expect(eventsOf(events, 'projectileSpawn')).toEqual([]);
    expect([k.x, k.z]).toEqual([0, 0]);
    expect(eventsOf(events, 'volley')).toEqual([]);
    expect(u.x).toBeGreaterThan(shoveRadius);
    expect(Math.hypot(u.vx, u.vz)).toBe(0);
    expect(boundsContains(world.match.bounds, u.x, u.z, u.radius - 1e-9)).toBe(true);
    // The clock stands still.
    expect(world.match.clock).toBe(clock);
    expect(world.match.elapsed).toBe(elapsed);
    expect(world.match.phaseTime).toBeCloseTo(MATCH_RULES.intermission - 60 * DT, 6);
  });
});

describe('the molt: the next stage', () => {
  it('redeploys fresh squads at the new edge with the survivors as veterans, and carries the rest over', () => {
    const world = realMoltWorld();
    const k = world.kaijus[0];
    // The first squad loses two units in the fight and one to the blast; the second is wiped out.
    for (const id of [1, 2, 4, 5, 6, 7]) {
      world.hits.push({ target: { entity: 'unit', id }, hit: { damage: Infinity, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: 0, kind: 'swipe', atWill: false } });
    }
    play(world, 2);
    expect(world.squads[1]).toMatchObject({ eliminated: true, driven: -1 });
    placeUnit(world, 3, k.x + MATCH_RULES.blastKillRadius * R2 - 5, k.z);
    world.units[0].hp = 40;
    world.squads[2].veteranSlots[0] = true;

    cocoon(world);
    k.rage = 64;
    k.hp = 120;
    k.nerve = 70;
    const bar = world.match.barPoints;
    const kills = world.match.kills;
    toLastCocoonTick(world);
    play(world, 1);
    expect(world.units[3].alive).toBe(false);
    const clock = world.match.clock;
    const tick = world.tick;

    // The intermission lasts exactly its time, then the stage changes.
    let events = play(world, INTERMISSION_TICKS - 1);
    expect(world.match.phase).toBe('intermission');
    expect(eventsOf(events, 'stageChange')).toEqual([]);
    events = play(world, 1);
    expect(world.tick - tick).toBe(INTERMISSION_TICKS);
    expect(eventsOf(events, 'stageChange')).toMatchObject([{ stage: 2, bounds: world.match.stageBounds[1] }]);
    expect(eventsOf(events, 'matchPhase')).toMatchObject([{ phase: 'playing', stage: 2 }]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('stage.2');
    expect(world.match).toMatchObject({ phase: 'playing', stage: 2 });
    expect(world.match.bounds).toEqual(world.match.stageBounds[1]);

    // Carried over: the bar, the clock (it was paused), rage, the tallies. Reset: health and nerve.
    expect(world.match.barPoints).toBe(bar);
    expect(world.match.clock).toBe(clock);
    expect(world.match.kills).toBe(kills + 1);
    expect(k).toMatchObject({ stage: 2, hp: LIZARD.hp, nerve: 0, rage: 64, phase: 'idle', moltAvailable: false });
    expect(world.match.stageTime[1]).toBe(0);

    // Every squad is back, fresh, at level 2, on the new perimeter, away from the kaiju.
    for (const squad of world.squads) {
      expect(squad).toMatchObject({ eliminated: false, level: 2, driven: squad.units[0], moveOrder: 'follow', fireMode: 'atWill' });
      for (const id of squad.units) {
        const u = world.units[id];
        expect(u).toMatchObject({ alive: true, type: 'army_tank', hp: UNIT_TYPES.army_tank.hp, shaken: 0, charge: 0, nerve: 0 });
        expect(boundsContains(world.match.bounds, u.x, u.z, u.radius)).toBe(true);
        expect(Math.hypot(u.x - k.x, u.z - k.z)).toBeGreaterThanOrEqual(MATCH_RULES.redeployMinKaijuDist - 10);
      }
    }
    // Veterans: exactly the units that lived through the stage and the blast.
    expect(world.squads[0].units.map((id) => world.units[id].veteran)).toEqual([true, false, false, false]);
    expect(world.squads[1].units.map((id) => world.units[id].veteran)).toEqual([false, false, false, false]);
    expect(world.squads[2].units.map((id) => world.units[id].veteran)).toEqual([true, true, true, true]);

    // The bar is already past the second mark, so the next molt is offered at once.
    events = play(world, 1);
    expect(eventsOf(events, 'moltAvailable')).toMatchObject([{ kaiju: 0, mark: 2 }]);
  });

  it('goes on to the titan, uses the bigger blast, and offers no molt at stage 3', () => {
    const world = realMoltWorld();
    const k = world.kaijus[0];
    cocoon(world);
    toLastCocoonTick(world);
    play(world, 1 + INTERMISSION_TICKS);
    expect(world.match.stage).toBe(2);
    play(world, 1);
    expect(k.moltAvailable).toBe(true);

    const events: SimEvent[] = [];
    events.push(...cocoon(world));
    events.push(...toLastCocoonTick(world));
    events.push(...play(world, 1));
    expect(eventsOf(events, 'moltBlast')).toMatchObject([{ killRadius: MATCH_RULES.blastKillRadius * R3, shoveRadius: MATCH_RULES.blastShoveRadius * R3 }]);
    expect(k).toMatchObject({ stage: 3, radius: R3 });
    // The titan never sticks out of the bounds it is still in.
    expect(boundsContains(world.match.bounds, k.x, k.z, k.radius - 1e-6)).toBe(true);
    events.push(...play(world, INTERMISSION_TICKS));
    expect(eventsOf(events, 'matchPhase').map((e) => [e.phase, e.stage])).toEqual([['intermission', 2], ['playing', 3]]);
    expect(eventsOf(events, 'voice').map((e) => e.cue)).toContain('stage.3');
    expect(world.match).toMatchObject({ phase: 'playing', stage: 3 });
    expect(world.units.every((u) => u.alive && u.type === 'army_tank_troop')).toBe(true);
    expect(world.squads[0].callInCooldowns).toEqual([0]);

    // Nothing more to grow into.
    const more = play(world, MOLT_HOLD_TICKS + 30, { buttons: Btn.molt });
    expect(eventsOf(more, 'moltAvailable')).toEqual([]);
    expect(k.phase).not.toBe('cocoon');
  });

  it('takes longer when there is a draft to hold', () => {
    const config = createMatchConfig({ humans: [{ name: 'Kay', role: 'kaiju' }], anchor: 0, drafts: true });
    config.tuning.briefing = 0;
    config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
    const world = createWorld({ seed: 3, config });
    world.match.marks = [1, 2, 1e9];
    world.step();
    world.structureHits.push({ id: world.city.structures[0].id, damage: 1e9, by: 0, cause: 'swipe' });
    world.step();
    run(world, MOLT_HOLD_TICKS, [input({ buttons: Btn.molt })]);
    const events = run(world, COCOON_TICKS + 2, [input()]);
    expect(eventsOf(events, 'matchPhase')).toMatchObject([{ phase: 'intermission', duration: MATCH_RULES.intermissionWithDraft }]);
  });
});

describe('the molt: room for the new body', () => {
  const TALL = { height: 40, hp: 5000 };
  // A 6 m alley between two 40 m blocks (a hatchling fits, a juvenile is 18 m wide), then the
  // same with a wall across one end, then a light well shut in on every side.
  const ALLEY = [
    { x: -23, z: 0, w: 40, d: 80, ...TALL },
    { x: 23, z: 0, w: 40, d: 80, ...TALL },
  ];
  const DEAD_END = [...ALLEY, { x: 0, z: 30, w: 6, d: 20, ...TALL }];
  const WELL = [
    { x: -24, z: 0, w: 40, d: 88, ...TALL },
    { x: 24, z: 0, w: 40, d: 88, ...TALL },
    { x: 0, z: 24, w: 8, d: 40, ...TALL },
    { x: 0, z: -24, w: 8, d: 40, ...TALL },
  ];

  /** True when a wall the body cannot walk through overlaps it. */
  function inAWall(world: World): boolean {
    const k = world.kaijus[0];
    const ids: number[] = [];
    structuresInCircle(world.cityQuery, k.x, k.z, k.radius, ids);
    const trample = kaijuStageDef(k.kind, k.stage).trampleHeight;
    return ids.some((id) => world.cityIndex.spassable[id] === 0 && world.cityIndex.sheight[id] > trample);
  }

  it('stands the juvenile up on the nearest ground with room when the cocoon was between tall buildings', () => {
    for (const structures of [ALLEY, DEAD_END, WELL]) {
      // The first structure is the one moltWorld flattens for the bar; keep it out of the way.
      const world = moltWorld({ structures: [{ x: 150, z: 150, w: 10, d: 10, height: 20, hp: 100, value: 25 }, ...structures] });
      parkUnits(world);
      const k = placeKaiju(world, 0, 0, 0);
      cocoon(world);
      const events = play(world, COCOON_TICKS + 2);
      expect(world.match.phase).toBe('intermission');
      expect(k.stage).toBe(2);
      // Out of the gap, on open ground, as near as there is any; the closing event says where.
      expect(inAWall(world)).toBe(false);
      const moved = Math.hypot(k.x, k.z);
      expect(moved).toBeGreaterThan(5);
      expect(moved).toBeLessThan(90);
      const stood = eventsOf(events, 'kaijuAction').find((e) => e.action === 'molt' && e.phase === 'idle');
      expect(stood).toMatchObject({ x: k.x, z: k.z });
      // The blast still goes off where the cocoon was.
      expect(eventsOf(events, 'moltBlast')).toMatchObject([{ x: 0, z: 0 }]);

      // Into stage 2: it stands still when left alone, and walks like any juvenile when told to.
      play(world, INTERMISSION_TICKS + 2);
      expect(world.match.stage).toBe(2);
      let px = k.x;
      let pz = k.z;
      for (let t = 0; t < 90; t++) {
        play(world, 1);
        expect(Math.hypot(k.x - px, k.z - pz)).toBeLessThan(1e-9);
        px = k.x;
        pz = k.z;
      }
      const away = Math.atan2(k.x, k.z);
      for (let t = 0; t < 150; t++) {
        play(world, 1, { moveZ: 1, aimYaw: away });
        // No jump: never more than a step of its top speed in a tick.
        expect(Math.hypot(k.x - px, k.z - pz)).toBeLessThan(LIZARD.stages[1].topSpeed * DT + 1e-6);
        expect(inAWall(world)).toBe(false);
        px = k.x;
        pz = k.z;
      }
    }
  });

  it('leaves it where the cocoon was when there is room, and when what stands close is low enough to walk through', () => {
    const world = moltWorld({
      structures: [
        { x: 150, z: 150, w: 10, d: 10, height: 20, hp: 100, value: 25 },
        // A house (the juvenile tramples up to 12 m) right beside the cocoon.
        { x: 9, z: 0, w: 10, d: 10, height: 8, hp: 100, value: 10 },
      ],
    });
    parkUnits(world);
    const k = placeKaiju(world, 0, 0, 0);
    cocoon(world);
    play(world, COCOON_TICKS + 2);
    expect(k.stage).toBe(2);
    expect([k.x, k.z]).toEqual([0, 0]);
  });

  it('never leaves a juvenile shaking between the walls of the real city, wherever a hatchling could have stood', () => {
    // Port Meridian's stage 1 squares hold only low-rise streets, so it has few or no such gaps;
    // the placeholder grid has them in most neighborhoods. Both are searched, so the rule is
    // proved on the city the game plays in and still exercised where the gaps exist.
    let tried = 0;
    for (const built of [getCity(), getCity(CITY_SEED, 'placeholder')]) {
      const index = built.index;
      const s1 = kaijuStageDef('lizard', 1);
      const s2 = kaijuStageDef('lizard', 2);
      const rng = createRng(11);
      const ids: number[] = [];
      for (let anchor = 0; anchor < built.city.anchors.length; anchor++) {
        const [b1] = allStageBounds(built.city, anchor);
        const config = { ...createMatchConfig({ humans: [{ name: 'K', role: 'kaiju' }], anchor, squads: 0 }), bots: idleBots() };
        config.tuning = { ...config.tuning, briefing: 0 };
        const probe = createWorld({ seed: 3, config, city: built });
        let found = 0;
        for (let i = 0; i < 20000 && found < 6; i++) {
          const x = rngRange(rng, b1.minX + 10, b1.maxX - 10);
          const z = rngRange(rng, b1.minZ + 10, b1.maxZ - 10);
          // A spot where the hatchling stands free and the juvenile would overlap two or more tall buildings.
          structuresInCircle(probe.cityQuery, x, z, s1.bodyRadius, ids);
          if (ids.some((id) => index.sheight[id] > s1.trampleHeight && index.spassable[id] === 0)) continue;
          structuresInCircle(probe.cityQuery, x, z, s2.bodyRadius, ids);
          if (ids.filter((id) => index.sheight[id] > s2.trampleHeight && index.spassable[id] === 0).length < 2) continue;
          found++;
          tried++;
          const world = createWorld({ seed: 3, config, city: built });
          world.step();
          const k = world.kaijus[0];
          k.x = x;
          k.z = z;
          beginStage(world, 2);
          expect(inAWall(world), `${built.city.anchors[anchor].name} (${x.toFixed(0)}, ${z.toFixed(0)})`).toBe(false);
          const at = { x: k.x, z: k.z };
          for (let t = 0; t < 30; t++) world.step([input()]);
          expect(Math.hypot(k.x - at.x, k.z - at.z), `${built.city.anchors[anchor].name} (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(1e-6);
        }
      }
    }
    // A search that found no gap anywhere would prove nothing.
    expect(tried).toBeGreaterThan(0);
  });
});

describe('the molt: what can still end the match', () => {
  it('lets the humans kill the kaiju in its cocoon', () => {
    const world = moltWorld();
    cocoon(world);
    const k = world.kaijus[0];
    k.hp = 30;
    // Helpless: the hit lands with the helpless multiplier, from any side.
    world.hits.push({
      target: { entity: 'kaiju', id: 0 },
      hit: { damage: 30 / LIZARD.damage.helplessMult + 1, nerve: 0, fromDir: { x: 0, z: 1 }, sourceId: 4, player: HUMAN_PLAYER, kind: 'shell', atWill: false },
    });
    const events = play(world, 1);
    expect(k.alive).toBe(false);
    expect(eventsOf(events, 'matchEnd')).toMatchObject([{ winner: 'humans', reason: 'kill' }]);
    expect(eventsOf(events, 'moltBlast')).toEqual([]);
    expect(world.match.stage).toBe(1);
  });

  it('keeps the clock running through the cocoon, and lets it run out there', () => {
    const world = moltWorld();
    cocoon(world);
    world.match.clock = 3;
    const events = play(world, 30 * 4);
    expect(eventsOf(events, 'matchEnd')).toMatchObject([{ winner: 'humans', reason: 'clock' }]);
    expect(world.kaijus[0].stage).toBe(1);
  });

  it('gives the kaiju the win in its cocoon when the humans push the bar past the third mark', () => {
    const world = moltWorld({ marks: [10, 20, 30] });
    cocoon(world);
    // A stray barrage levels what was left of the block.
    world.match.barPoints = 29;
    world.structureHp[0] = 10;
    world.structureHits.push({ id: 0, damage: 10, by: HUMAN_PLAYER, cause: 'arty' });
    const events = play(world, 1);
    expect(eventsOf(events, 'matchEnd')).toMatchObject([{ winner: 'kaiju', reason: 'bar' }]);
  });
});
