/**
 * Swimming: the kaiju's hide-and-travel mode in deep water (DESIGN.md section 4, "Swimming";
 * sim/swim.ts), and the water every start needs for it (docs/CITY.md section 11).
 */

import { describe, expect, it } from 'vitest';
import {
  beginStage,
  Btn,
  createCityQuery,
  createCityState,
  decodeSnapshot,
  deepWaterAt,
  DT,
  encodeSnapshot,
  getCity,
  kaijuCapsule,
  kaijuKindDef,
  kaijuShownHeight,
  kaijuStageDef,
  perStage,
  segmentVsCapsule,
  snapshotOfWorld,
  stageBounds,
  structuresInCircle,
  type Bounds,
  type CityQuery,
  type StageId,
  type VerticalCapsule,
  type World,
} from '../src/index';
import { holdFire, input, KAIJU_PLAYER, makeTestWorld, placeKaiju, placeUnit, parkUnits, run } from './helpers';

const SWIM = kaijuKindDef('lizard').swim!;
/** A 60 m wide channel across the stage 1 square, east of the start. */
const CHANNEL: [number, number, number, number] = [40, -170, 100, 170];

function channelWorld(options: Parameters<typeof makeTestWorld>[0] = {}): World {
  const world = makeTestWorld({ water: [CHANNEL], ...options });
  parkUnits(world);
  return world;
}

/** Steps with the kaiju player's input, the others idle. */
function steps(world: World, ticks: number, buttons = 0, moveZ = 0, aimYaw = 0): void {
  const inputs = [];
  inputs[KAIJU_PLAYER] = input({ buttons, moveZ, aimYaw });
  run(world, ticks, inputs);
}

const ticksFor = (seconds: number): number => Math.ceil(seconds / DT) + 1;

describe('going under', () => {
  it('goes under by itself, standing idle in deep water, and takes its dive time to get there', () => {
    const world = channelWorld();
    const k = placeKaiju(world, 70, 0);
    steps(world, 2);
    expect(k.submerge).toBeGreaterThan(0);
    expect(k.submerge).toBeLessThan(1);
    steps(world, ticksFor(SWIM.diveTime));
    expect(k.submerge).toBe(1);
  });

  it('stays up on dry land, in water too shallow for its body, and at stage 3', () => {
    const dry = channelWorld();
    const k = placeKaiju(dry, 0, 0);
    steps(dry, 60);
    expect(k.submerge).toBe(0);

    // A 4 m ditch: water, and deep enough for a hatchling, but not for a juvenile.
    const ditch = makeTestWorld({ water: [[40, -170, 44, 170]] });
    beginStage(ditch, 2);
    parkUnits(ditch);
    const d = placeKaiju(ditch, 42, 0);
    steps(ditch, 60);
    expect(d.inWater).toBe(true);
    expect(d.submerge).toBe(0);

    // The titan is too big for any water.
    const titan = makeTestWorld({ water: [[-400, -400, 400, 400]] });
    parkUnits(titan);
    beginStage(titan, 3);
    const t = placeKaiju(titan, 0, 0);
    steps(titan, 60);
    expect(t.submerge).toBe(0);
  });

  it('swims faster than it wades, and comes up when it leaves deep water', () => {
    const world = channelWorld();
    const k = placeKaiju(world, 70, -150);
    steps(world, ticksFor(SWIM.diveTime) + 2);
    expect(k.submerge).toBe(1);
    const z0 = k.z;
    steps(world, 60, 0, 1, 0);
    const swum = k.z - z0;
    expect(k.submerge).toBe(1);
    const st = kaijuStageDef('lizard', 1);
    // Two seconds at full swimming speed, less the time to get going.
    expect(swum).toBeGreaterThan(st.topSpeed * st.waterSpeedMult * 2 * 1.5);

    // Out of the channel to the west: it comes up as it reaches the bank.
    steps(world, 150, 0, 1, -Math.PI / 2);
    expect(k.x).toBeLessThan(40);
    expect(k.submerge).toBe(0);
  });
});

describe('coming up', () => {
  it('comes up for any action button, and the press is carried out once it is up', () => {
    const world = channelWorld();
    const k = placeKaiju(world, 70, 0);
    steps(world, ticksFor(SWIM.diveTime) + 2);
    expect(k.submerge).toBe(1);

    // A tap of Roar while under: nothing happens at once, it comes up, then it roars.
    steps(world, 2, Btn.roar);
    expect(k.action).toBe('none');
    let roared = -1;
    for (let i = 0; i < ticksFor(SWIM.surfaceTime) + 2; i++) {
      steps(world, 1);
      if (k.action === 'roar' && roared < 0) roared = i;
    }
    expect(k.submerge).toBe(0);
    expect(roared).toBeGreaterThanOrEqual(0);

    // It stays up while it acts and for the settle time after, then goes down again.
    while (k.action !== 'none') steps(world, 1);
    steps(world, ticksFor(SWIM.settleTime) - 3);
    expect(k.submerge).toBe(0);
    steps(world, ticksFor(SWIM.diveTime) + 4);
    expect(k.submerge).toBe(1);
  });

  it('cannot attack, grab or beam while it is in the water going down, under or coming up', () => {
    const world = channelWorld();
    const k = placeKaiju(world, 70, 0);
    k.rage = 100;
    steps(world, ticksFor(SWIM.diveTime) + 2);
    for (const b of [Btn.strike, Btn.grab, Btn.special]) {
      steps(world, 1, b);
      expect(k.action).toBe('none');
      expect(k.submerge).toBeGreaterThan(0);
    }
  });
});

describe('what shows', () => {
  it('shrinks the hit volume to the spines: a shot over them misses, a shot at them hits', () => {
    const world = channelWorld();
    const k = placeKaiju(world, 70, 0);
    const cap: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
    const shot = (y: number): boolean => segmentVsCapsule({ x: 70, y, z: -30 }, { x: 70, y, z: 30 }, kaijuCapsule(k, cap));
    expect(shot(3)).toBe(true);
    steps(world, ticksFor(SWIM.diveTime) + 2);
    const st = kaijuStageDef('lizard', 1);
    expect(kaijuShownHeight(k)).toBeCloseTo(st.height * SWIM.exposedHeight, 6);
    expect(shot(3)).toBe(false);
    expect(shot(1.2)).toBe(false);
    expect(shot(0.3)).toBe(true);
  });

  it('wrecks nothing and tramples nobody while it swims: a low bridge deck overhead is passed under', () => {
    // A 3 m deck (a hatchling would trample it) across the channel.
    const world = channelWorld({ structures: [{ x: 70, z: 20, w: 70, d: 8, height: 3, passable: true, value: 50 }] });
    const k = placeKaiju(world, 70, -20);
    steps(world, ticksFor(SWIM.diveTime) + 2);
    expect(k.submerge).toBe(1);
    // A sub-unit in the water in its way, holding its fire (so that its misses cost nothing).
    holdFire(world);
    const unit = placeUnit(world, 1, 70, 0);
    const hp = unit.hp;
    steps(world, 200, 0, 1, 0);
    expect(k.z).toBeGreaterThan(30);
    expect(world.structureHp[0]).toBeGreaterThan(0);
    expect(world.match.barPoints).toBe(0);
    expect(unit.hp).toBe(hp);
  });

  it('is lost to the humans at stage 2 while it is under and nobody is near, and seen again up close', () => {
    const world = makeTestWorld({ water: [[-400, -400, 400, 400]] });
    beginStage(world, 2);
    parkUnits(world);
    const k = placeKaiju(world, 0, 0);
    steps(world, 2);
    expect(k.known).toBe(true);
    steps(world, ticksFor(SWIM.diveTime) + 2);
    expect(k.submerge).toBe(1);
    expect(k.known).toBe(false);
    // A unit 30 m away sees the spines.
    placeUnit(world, 0, 0, 30);
    steps(world, 1);
    expect(k.known).toBe(true);
  });

  it('goes out to every client in the snapshot', () => {
    const world = channelWorld();
    const k = placeKaiju(world, 70, 0);
    steps(world, 10);
    const s = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    expect(s.kaijus[0].submerge).toBeCloseTo(k.submerge, 2);
    expect(s.kaijus[0].submerge).toBeGreaterThan(0);
  });
});

/**
 * The city check: from where a match starts, the kaiju can walk to water deep enough to swim in,
 * at stage 1 and at stage 2, without breaking anything (only through what it tramples).
 */
function deepWaterReachable(q: CityQuery, b: Bounds, sx: number, sz: number, stage: StageId): { reached: number; deep: number } {
  const st = kaijuStageDef('lizard', stage);
  const r = st.bodyRadius;
  const fit = perStage(SWIM.fitRadii, stage) * r;
  const step = stage === 1 ? 2 : 4;
  const ids: number[] = [];
  const free = (x: number, z: number): boolean => {
    structuresInCircle(q, x, z, r, ids);
    for (const id of ids) if (q.index.sheight[id] > st.trampleHeight && q.index.spassable[id] === 0) return false;
    return true;
  };
  const x0 = b.minX + r;
  const z0 = b.minZ + r;
  const nx = Math.floor((b.maxX - r - x0) / step) + 1;
  const nz = Math.floor((b.maxZ - r - z0) / step) + 1;
  let start = -1;
  let best = Infinity;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const d = (x - sx) * (x - sx) + (z - sz) * (z - sz);
      if (d < best && d < 3600 && free(x, z)) {
        best = d;
        start = j * nx + i;
      }
    }
  }
  if (start < 0) return { reached: 0, deep: 0 };
  const seen = new Uint8Array(nx * nz);
  const queue = [start];
  seen[start] = 1;
  let deep = 0;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const i = c % nx;
    const j = (c - i) / nx;
    if (deepWaterAt(q, x0 + i * step, z0 + j * step, fit)) deep++;
    const next = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < nz - 1 ? c + nx : -1];
    for (const n of next) {
      if (n < 0 || seen[n]) continue;
      seen[n] = 1;
      const ni = n % nx;
      if (free(x0 + ni * step, z0 + ((n - ni) / nx) * step)) queue.push(n);
    }
  }
  return { reached: queue.length, deep: deep * step * step };
}

describe('Port Meridian has water to swim in at every start', () => {
  const built = getCity();
  const q = createCityQuery(built.index, createCityState(built.city));
  for (const a of built.city.anchors) {
    it(`${a.name}: deep water within walking reach at stages 1 and 2`, () => {
      for (const stage of [1, 2] as const) {
        const b = stageBounds(built.city, a.id, stage);
        const { reached, deep } = deepWaterReachable(q, b, a.x, a.z, stage);
        expect(reached, `${a.name} stage ${stage}: no start`).toBeGreaterThan(0);
        // At least a 200 m stretch of the Old Moat (hatchling: 3.6 m of it across counts).
        expect(deep, `${a.name} stage ${stage}: square meters of swimmable water`).toBeGreaterThan(stage === 1 ? 2500 : 5000);
      }
    }, 60_000);
  }
});

describe('the kaiju bot', () => {
  it('slips into deep water close by when its nerve is near breaking, swims for a while, and comes back to work', () => {
    const world = makeTestWorld({ water: [CHANNEL], people: 'human', config: { bots: { kaijuHandicap: 0, humanHandicap: 1 } } });
    parkUnits(world);
    const k = placeKaiju(world, 30, 0, Math.PI / 2);
    k.nerve = 85;
    const bs = world.players[k.player].botState;
    let dived = false;
    let farthest = 0;
    for (let i = 0; i < 6 / DT && !dived; i++) {
      run(world, 1);
      if (k.submerge >= 1) dived = true;
    }
    expect(dived).toBe(true);
    expect(bs.swimFor).toBeGreaterThan(0);
    // It swims on, away from the squads (parked in the far corner), until its time is up.
    for (let i = 0; i < 12 / DT && bs.swimFor > 0; i++) {
      run(world, 1);
      farthest = Math.max(farthest, Math.hypot(k.x - 30, k.z));
    }
    expect(bs.swimFor).toBe(0);
    expect(bs.swimRest).toBeGreaterThan(0);
    expect(farthest).toBeGreaterThan(20);
  });
});
