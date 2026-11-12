/**
 * Port Meridian as a level: squads can be deployed on every perimeter the game uses and get
 * out of where they are put, and whole bot matches play through on it. The city is handed to
 * createWorld through its `city` option; the default city is not touched.
 */

import { describe, expect, it } from 'vitest';
import { runBotMatch, worldHash } from '../scripts/botMatch';
import { createNavWatch } from '../scripts/navWatch';
import {
  beginStage,
  buildCityIndex,
  circleHitsStructure,
  createCityQuery,
  createCityState,
  createMatchConfig,
  createWorld,
  findClearSpot,
  generatePortMeridian,
  idleBots,
  inWater,
  stageBounds,
  type BuiltCity,
  type CityData,
  type StageId,
} from '../src/index';

const data = generatePortMeridian();
const built: BuiltCity = { city: data, index: buildCityIndex(data) };

/**
 * Where a body that needs `clear` meters of room can get to from the streets: a 1 m raster of
 * the whole city, flooded from every street. Returns a lookup: 2 reached, 1 too close to a
 * wall, 0 free ground that cannot be reached (a walled-in yard).
 */
function reachMap(city: CityData, clear: number): (x: number, z: number) => number {
  const half = city.half;
  const n = half * 2;
  const cells = new Uint8Array(n * n);
  for (const s of city.structures) {
    if (s.passable) continue;
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const ex = s.hx * Math.abs(c) + s.hz * Math.abs(sn) + clear;
    const ez = s.hx * Math.abs(sn) + s.hz * Math.abs(c) + clear;
    const c0 = Math.max(0, Math.floor(s.x - ex + half));
    const c1 = Math.min(n - 1, Math.floor(s.x + ex + half));
    const r0 = Math.max(0, Math.floor(s.z - ez + half));
    const r1 = Math.min(n - 1, Math.floor(s.z + ez + half));
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        const x = -half + cc + 0.5 - s.x;
        const z = -half + r + 0.5 - s.z;
        const lx = Math.max(0, Math.abs(x * c - z * sn) - s.hx);
        const lz = Math.max(0, Math.abs(x * sn + z * c) - s.hz);
        if (lx * lx + lz * lz < clear * clear) cells[r * n + cc] = 1;
      }
    }
  }
  const queue = new Int32Array(n * n);
  let tail = 0;
  for (const e of city.roads.edges) {
    const a = city.roads.nodes[e.a];
    const b = city.roads.nodes[e.b];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2));
    for (let i = 0; i <= steps; i++) {
      const k = Math.floor(a.z + ((b.z - a.z) * i) / steps + half) * n + Math.floor(a.x + ((b.x - a.x) * i) / steps + half);
      if (cells[k] === 0) {
        cells[k] = 2;
        queue[tail++] = k;
      }
    }
  }
  for (let q = 0; q < tail; q++) {
    const k = queue[q];
    const c = k % n;
    for (const j of [c + 1 < n ? k + 1 : -1, c > 0 ? k - 1 : -1, k + n < n * n ? k + n : -1, k - n]) {
      if (j >= 0 && cells[j] === 0) {
        cells[j] = 2;
        queue[tail++] = j;
      }
    }
  }
  return (x, z) => {
    // The spot itself or a neighboring cell: the raster is a meter coarse.
    let best = 1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const r = Math.floor(z + dz + half);
        const c = Math.floor(x + dx + half);
        if (r < 0 || c < 0 || r >= n || c >= n) continue;
        const v = cells[r * n + c];
        if (v === 2) return 2;
        if (v === 0) best = 0;
      }
    }
    return best;
  };
}

/** The points sim/spawn.ts considers along the inside of a bounds line. */
function perimeter(b: { minX: number; minZ: number; maxX: number; maxZ: number }): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const x0 = b.minX + 20;
  const x1 = b.maxX - 20;
  const z0 = b.minZ + 20;
  const z1 = b.maxZ - 20;
  for (let x = x0; x < x1; x += 20) pts.push([x, z0]);
  for (let z = z0; z < z1; z += 20) pts.push([x1, z]);
  for (let x = x1; x > x0; x -= 20) pts.push([x, z1]);
  for (let z = z1; z > z0; z -= 20) pts.push([x0, z]);
  return pts;
}

describe('Port Meridian: deployment', () => {
  // Unit radius per stage (rocket infantry, tank, tank troop); spawn asks for 0.75 m more around it.
  const radius = [3, 4, 9];

  it('has reachable, mostly dry ground at every perimeter point of every stage of every start', () => {
    const q = createCityQuery(built.index, createCityState(data));
    const spot = { x: 0, z: 0 };
    for (const stage of [1, 2, 3] as const) {
      const r = radius[stage - 1];
      const reach = reachMap(data, r + 0.75);
      let total = 0;
      let wet = 0;
      for (const a of data.anchors) {
        const b = stageBounds(data, a.id, stage);
        for (const [x, z] of perimeter(b)) {
          total++;
          expect(findClearSpot(q, x, z, r, b, [], spot), `${a.name} stage ${stage}: no room near (${x}, ${z})`).toBe(true);
          if (inWater(q, spot.x, spot.z)) wet++;
          expect(reach(spot.x, spot.z), `${a.name} stage ${stage}: a unit put at (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}) is walled in`).toBe(2);
        }
      }
      // Measured: 0%, 2% (the bay edge of the Gull Point district), 11% (the sea side of the city).
      expect(wet / total, `stage ${stage}`).toBeLessThanOrEqual([0, 0.04, 0.14][stage - 1]);
    }
  });

  it('has no yard along the edge of the city that would trap a troop of tanks', () => {
    // The last stage deploys troops (9 m radius, 0.75 m of room round them) along the city edge,
    // lined up to some tens of meters inside it. Anywhere there a troop can be put, it must be
    // able to drive out to a street. (Tanks and infantry are covered city-wide by the test above.)
    const q = createCityQuery(built.index, createCityState(data));
    const drive = reachMap(data, 9.25);
    let spots = 0;
    const trapped: string[] = [];
    for (let z = -data.half + 11; z < data.half - 10; z += 2) {
      for (let x = -data.half + 11; x < data.half - 10; x += 2) {
        if (Math.max(Math.abs(x), Math.abs(z)) < data.half - 185) continue;
        if (circleHitsStructure(q, x, z, 9.75)) continue;
        spots++;
        if (drive(x, z) !== 2) trapped.push(`E ${-x} N ${z}`);
      }
    }
    expect(spots).toBeGreaterThan(150000);
    expect(trapped, 'spots where a troop fits and cannot leave').toEqual([]);
  });

  it('deploys four whole squads at every start and stage, clear of walls, inside the line and free to leave', () => {
    const reach = [reachMap(data, 3.25), reachMap(data, 4.25), reachMap(data, 9.25)];
    for (const a of data.anchors) {
      const world = createWorld({ seed: 11 + a.id, config: createMatchConfig({ anchor: a.id, bots: idleBots() }), city: built });
      expect(world.city).toBe(data);
      // The kaiju hatches at the anchor, on open ground.
      const k = world.kaijus[0];
      expect(Math.hypot(k.x - a.x, k.z - a.z), a.name).toBeLessThan(12);
      for (const stage of [1, 2, 3] as StageId[]) {
        if (stage > 1) beginStage(world, stage);
        const b = world.match.bounds;
        let alive = 0;
        for (const u of world.units) {
          if (!u.alive) continue;
          alive++;
          expect(circleHitsStructure(world.cityQuery, u.x, u.z, u.radius), `${a.name} stage ${stage} unit ${u.id}`).toBe(false);
          // Every unit, not only the one at the deploy point, can drive out to the streets.
          expect(reach[stage - 1](u.x, u.z), `${a.name} stage ${stage} unit ${u.id} at E ${(-u.x).toFixed(0)} N ${u.z.toFixed(0)} is walled in`).toBe(2);
          expect(u.x >= b.minX + u.radius && u.x <= b.maxX - u.radius && u.z >= b.minZ + u.radius && u.z <= b.maxZ - u.radius).toBe(true);
          // Not on top of the kaiju: at least 150 m out even in the small stage 1 square.
          expect(Math.hypot(u.x - world.kaijus[0].x, u.z - world.kaijus[0].z)).toBeGreaterThan(150);
        }
        expect(alive).toBe(16);
      }
    }
  });
});

describe('Port Meridian: bot matches', () => {
  it('plays fast matches to the end from several starts, with nobody stuck in a yard', () => {
    for (const seed of [1, 2, 3, 4]) {
      const watch = createNavWatch();
      const { report, world } = runBotMatch({ seed, fast: true, city: built, anchor: (seed * 3) % data.anchors.length, onTick: watch.onTick });
      expect(report.finished, `seed ${seed}`).toBe(true);
      expect(['kaiju', 'humans']).toContain(report.winner);
      expect(Number.isFinite(world.match.barPoints)).toBe(true);
      for (const u of world.units) expect(Number.isFinite(u.x) && Number.isFinite(u.z)).toBe(true);
      // Nobody gives up on a route, and nobody grinds against a wall for long.
      expect(watch.giveUps, `seed ${seed}`).toBe(0);
      expect(watch.stuckSeconds / Math.max(1, watch.unitSeconds), `seed ${seed}`).toBeLessThan(0.02);
    }
  });

  it('plays one full-length match, the same way twice', () => {
    const first = runBotMatch({ seed: 5, city: built });
    const again = runBotMatch({ seed: 5, city: built });
    expect(first.report.finished).toBe(true);
    expect(first.report.stages[0].reached).toBe(true);
    expect(first.report.stages[1].reached).toBe(true);
    expect(worldHash(again.world)).toBe(worldHash(first.world));
    expect(again.report.length).toBe(first.report.length);
    // The marks come from the value in the stage squares of this city.
    expect(first.report.marks[0]).toBeGreaterThan(150);
    expect(first.report.marks[1]).toBeGreaterThan(first.report.marks[0] * 1.6 - 1e-6);
    expect(first.report.marks[2]).toBeGreaterThan(first.report.marks[1] * 1.6 - 1e-6);
  });
});
