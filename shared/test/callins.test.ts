import { describe, expect, it } from 'vitest';
import {
  beginStage,
  CALLINS,
  callInFallTime,
  COMBAT_RULES,
  LIZARD,
  PROJECTILE_TYPES,
  resolveMarkerPoint,
  SQUAD_RULES,
  startCallIn,
  stepProjectile,
  TICK_RATE,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type World,
} from '../src/index';
import { eventsOf, holdFire, HUMAN_PLAYER, input, makeTestWorld, parkUnits, placeKaiju, placeUnit, run, type TestWorldOptions } from './helpers';

const ARTY = CALLINS.artillery;

/** Stage 3 in a hand-made city: the first squad (a person's tank company) at the origin, everyone else far away. */
function field(options: TestWorldOptions = {}, stage: StageId = 3): World {
  const world = makeTestWorld(options);
  if (stage > 1) beginStage(world, stage);
  world.match.bounds = world.match.stageBounds[2];
  parkUnits(world);
  placeKaiju(world, -900, -900, 0);
  [0, 1, 2, 3].forEach((id) => placeUnit(world, id, id * 30, 0));
  return world;
}

function lead(world: World, ticks: number, partial: Partial<PlayerInput> = {}): SimEvent[] {
  return run(world, ticks, [null, input(partial)]);
}

/**
 * Starts a mission for the first squad between two ticks (the artillery radio calls
 * `startCallIn` from inside a tick, with a charged volley) and returns the events it emitted.
 */
function callIn(world: World, x: number, z: number): SimEvent[] {
  const before = world.events.length;
  startCallIn(world, world.squads[0], 'artillery', x, z);
  return world.events.slice(before);
}

describe('the artillery call-in', () => {
  it('marks the ground, waits out the delay, then lands its shells over the duration inside the scatter radius', () => {
    const world = field();
    const start = world.tick;
    const events = callIn(world, 100, 300);
    expect(eventsOf(events, 'callin')).toMatchObject([
      { id: 1, callIn: 'artillery', squad: 0, player: HUMAN_PLAYER, x: 100, z: 300, phase: 'marked', delay: ARTY.delay },
    ]);
    // Stage 3 tightens the scatter; nothing else does here (the kaiju is far away, unseen and calm).
    const radius = ARTY.scatterRadius * 0.6;
    expect(eventsOf(events, 'callin')[0].radius).toBeCloseTo(radius, 9);
    expect(world.callIns.length).toBe(1);

    events.push(...lead(world, Math.round((ARTY.delay + ARTY.duration + 2) * TICK_RATE)));
    const spawns = eventsOf(events, 'projectileSpawn');
    const hits = eventsOf(events, 'projectileHit');
    expect(spawns.length).toBe(ARTY.shells);
    expect(hits.length).toBe(ARTY.shells);
    for (const s of spawns) {
      expect(s).toMatchObject({ projectile: 'arty', flight: 'arc', owner: 'callin', ownerId: 1, player: HUMAN_PLAYER, y: ARTY.spawnHeight, gravity: COMBAT_RULES.gravity, volley: false });
      expect(Math.hypot(s.vx, s.vy, s.vz)).toBeCloseTo(PROJECTILE_TYPES.arty.speed, 9);
      // Steep, and coming over the caller's shoulder: from the squad's side toward the marker.
      expect(Math.atan2(-s.vy, Math.hypot(s.vx, s.vz))).toBeCloseTo(SQUAD_RULES.callInElevation, 9);
      expect(s.vz).toBeGreaterThan(0);
    }
    // The first shell lands when the delay is up, the last one `duration` later.
    const first = (hits[0].tick - start) / TICK_RATE;
    const last = (hits[hits.length - 1].tick - start) / TICK_RATE;
    expect(Math.abs(first - ARTY.delay)).toBeLessThanOrEqual(2 / TICK_RATE);
    expect(Math.abs(last - first - ARTY.duration)).toBeLessThanOrEqual(2 / TICK_RATE);
    for (const h of hits) {
      expect(h).toMatchObject({ target: 'ground', y: 0, splash: ARTY.splashRadius });
      expect(Math.hypot(h.x - 100, h.z - 300)).toBeLessThanOrEqual(radius + 1e-6);
    }
    // Not all in one hole.
    expect(new Set(hits.map((h) => Math.round(h.x))).size).toBeGreaterThan(3);
    // A client that flies each shell from its spawn event with the shared kinematics sees it
    // come down exactly where and when the server says it did.
    for (const h of hits) {
      const s = spawns.find((e) => e.id === h.id);
      if (!s) throw new Error('a shell landed that was never announced');
      const body = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, gravity: s.gravity };
      for (let tick = s.tick; tick < h.tick; tick++) stepProjectile(body, 1 / TICK_RATE);
      expect(body.y).toBeGreaterThan(0);
      stepProjectile(body, 1 / TICK_RATE);
      expect(body.y).toBeLessThanOrEqual(0);
      expect(Math.hypot(body.x - h.x, body.z - h.z)).toBeLessThan(1);
    }

    // Its phases, in order; the marker can come off the ground at 'done'.
    expect(eventsOf(events, 'callin').map((e) => e.phase)).toEqual(['marked', 'inbound', 'done']);
    const inbound = eventsOf(events, 'callin')[1];
    expect(inbound.delay).toBeCloseTo(callInFallTime(ARTY), 1);
    expect(eventsOf(events, 'callin')[2].tick).toBeGreaterThanOrEqual(hits[hits.length - 1].tick);
    expect(world.callIns).toEqual([]);
  });

  it('hurts the kaiju: 14 damage and 10 nerve a shell, and never counts as crossfire', () => {
    const world = field();
    const k = placeKaiju(world, 100, 300, 0);
    // The tanks hold their fire, so the guns are the only thing shooting.
    holdFire(world);
    const events = callIn(world, 100, 300);
    events.push(...lead(world, Math.round((ARTY.delay + ARTY.duration + 2) * TICK_RATE)));
    const hits = eventsOf(events, 'kaijuHit');
    // The titan fills the middle of the pattern and the splash is wide: every shell reaches it.
    expect(hits.length).toBe(ARTY.shells);
    let lost = 0;
    for (const h of hits) {
      expect(h).toMatchObject({ cause: 'arty', by: HUMAN_PLAYER });
      const facing = h.facing === 'front' ? LIZARD.damage.frontMult : h.facing === 'rear' ? LIZARD.damage.rearMult : LIZARD.damage.flankMult;
      expect(h.damage).toBeCloseTo(ARTY.damage * LIZARD.damage.normalMult * facing, 9);
      expect(h.nerve).toBeCloseTo(ARTY.nerve * facing, 9);
      lost += h.damage;
    }
    expect(k.maxHp - k.hp).toBeCloseTo(lost, 6);
    expect(k.recentHits).toEqual([]);
    expect(eventsOf(events, 'crossfire')).toEqual([]);
  });

  it('wrecks the city it lands on, 300 a shell, and that is on the caller', () => {
    const world = field({
      structures: [
        { x: 100, z: 300, w: 30, d: 30, height: 12, hp: 100000, value: 400, cls: 'office' },
        { x: 100, z: 420, w: 30, d: 30, height: 12, hp: 100000, value: 400, cls: 'office' },
      ],
    });
    const events = callIn(world, 100, 300);
    events.push(...lead(world, Math.round((ARTY.delay + ARTY.duration + 2) * TICK_RATE)));
    // The marker is on the first block: every shell lands on its roof or close enough to reach it.
    const hits = eventsOf(events, 'projectileHit');
    expect(hits.length).toBe(ARTY.shells);
    expect(hits.some((h) => h.target === 'structure' && h.targetId === 0)).toBe(true);
    const loss = 100000 - world.structureHp[0];
    expect(loss).toBe(ARTY.shells * ARTY.structureDamage);
    expect(world.structureHp[1]).toBe(100000);
    expect(world.players[HUMAN_PLAYER].tally.barPoints).toBeCloseTo((400 * loss) / 100000, 3);
    expect(world.match.barPoints).toBeCloseTo((400 * loss) / 100000, 3);
    expect(world.kaijus[0].rage).toBe(0);
  });

  it('scatters less on a slowed, spotted target', () => {
    const world = field();
    // The leader has the titan in plain view within the spotting range, and its nerve is half gone.
    const k = placeKaiju(world, 0, 120 + LIZARD.stages[2].bodyRadius, 0);
    k.nerve = 50;
    holdFire(world);
    lead(world, 1);
    expect(k.spotted).toBe(true);
    const events = callIn(world, k.x, k.z);
    const tight = ARTY.scatterRadius * 0.6 * COMBAT_RULES.scatterSpottedMult * COMBAT_RULES.scatterSlowedMult;
    expect(eventsOf(events, 'callin')[0].radius).toBeCloseTo(tight, 9);
    for (let t = 0; t < (ARTY.delay + ARTY.duration + 2) * TICK_RATE; t++) {
      k.nerve = 50;
      k.hp = k.maxHp;
      events.push(...lead(world, 1));
    }
    // Shells that meet the titan's body on the way down end on it; where each was headed is what counts.
    const spawns = eventsOf(events, 'projectileSpawn');
    expect(spawns.length).toBe(ARTY.shells);
    for (const s of spawns) {
      const body = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, gravity: s.gravity };
      while (body.y > 0) stepProjectile(body, 1 / 600);
      expect(Math.hypot(body.x - k.x, body.z - k.z)).toBeLessThanOrEqual(tight + 0.5);
    }
  });

  it('carries on after its caller is gone, and is dropped when the stage ends', () => {
    const world = field();
    callIn(world, 100, 300);
    for (const id of [0, 1, 2, 3]) {
      world.hits.push({
        target: { entity: 'unit', id },
        hit: { damage: Infinity, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: 0, kind: 'blast', atWill: false },
      });
    }
    const events = lead(world, Math.round((ARTY.delay + ARTY.duration + 2) * TICK_RATE));
    expect(world.squads[0].eliminated).toBe(true);
    expect(eventsOf(events, 'projectileHit').length).toBe(ARTY.shells);

    const again = field();
    callIn(again, 100, 300);
    beginStage(again, 3);
    expect(again.callIns).toEqual([]);
  });

  it('pulls a marker outside the playable bounds back to the line', () => {
    const world = field();
    world.match.bounds = world.match.stageBounds[0];
    const b = world.match.bounds;
    const marked = eventsOf(callIn(world, b.maxX + 300, b.minZ - 300), 'callin')[0];
    expect([marked.x, marked.z]).toEqual([b.maxX, b.minZ]);
  });
});

/** Where a crosshair marks the ground (`resolveMarkerPoint`, sim/aim.ts): where the artillery radio's barrage comes down. */
describe('a ground marker placed with the crosshair', () => {
  const eye = 2.8;
  const out = { x: 0, z: 0 };

  it('is where the aim ray meets the ground, or the ground under a kaiju the crosshair is on, anywhere on its body', () => {
    const world = field();
    expect(resolveMarkerPoint(world.cityQuery, world.kaijus, 0, eye, 0, 0.5, -Math.atan2(eye, 200), SQUAD_RULES.markerRange, out)).toBe(true);
    expect(out.x).toBeCloseTo(Math.sin(0.5) * 200, 3);
    expect(out.z).toBeCloseTo(Math.cos(0.5) * 200, 3);

    const radius = LIZARD.stages[2].bodyRadius;
    const height = LIZARD.stages[2].height;
    for (const dist of [300, 600]) {
      // Knees, chest, head, and the chest again well off the center line.
      for (const [frac, side] of [[0.1, 0], [0.5, 0], [0.9, 0], [0.5, 0.7 * radius]]) {
        const k = placeKaiju(world, 0, dist, 0);
        const hit = resolveMarkerPoint(world.cityQuery, world.kaijus, 0, eye, 0, Math.atan2(side, dist), Math.atan2(height * frac - eye, dist), SQUAD_RULES.markerRange, out);
        expect(hit, `at ${dist} m, height ${frac}, side ${side}`).toBe(true);
        expect(Math.hypot(out.x - k.x, out.z - k.z)).toBeLessThanOrEqual(radius + 1e-6);
      }
    }
  });

  it('snaps to a kaiju on the map with the crosshair on the sky just beside it, and is nowhere at the empty sky', () => {
    const world = field();
    const k = placeKaiju(world, 0, 400, 0);
    k.known = true;
    const radius = LIZARD.stages[2].bodyRadius;
    for (const [aimYaw, aimPitch] of [[0, 0.6], [Math.atan2(1.5 * radius, 400), 0.2]]) {
      expect(resolveMarkerPoint(world.cityQuery, world.kaijus, 0, eye, 0, aimYaw, aimPitch, SQUAD_RULES.markerRange, out)).toBe(true);
      expect([out.x, out.z]).toEqual([k.x, k.z]);
    }
    expect(resolveMarkerPoint(world.cityQuery, world.kaijus, 0, eye, 0, 2, 0.3, SQUAD_RULES.markerRange, out)).toBe(false);
  });
});
