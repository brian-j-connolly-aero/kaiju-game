/**
 * Port Meridian, the handcrafted city (shared/src/city/meridian, docs/CITY.md): what the data
 * must always be. It is the game's city (getCity builds it); these tests build it directly with
 * generatePortMeridian().
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  archetypeDef,
  bridgeAt,
  buildCityIndex,
  CITY_HALF,
  CITY_SEED,
  cityChecksum,
  createCityQuery,
  createCityState,
  findRoadPath,
  generateCity,
  generatePortMeridian,
  getCity,
  groundKindAt,
  meridianChecksum,
  nearestRoadNode,
  PROP_KINDS,
  roadAdjacency,
  stageBounds,
  structureAt,
  validateCity,
  valueInBounds,
  ZONE_TAGS,
  type Bounds,
  type Structure,
} from '../src/city';
import { boundsContains, distPointObb, distSqPointSegment2, obbBounds, obbCorners, segmentVsObb2 } from '../src/math';

const city = generatePortMeridian();
const index = buildCityIndex(city);
const { nodes, edges } = city.roads;
const water = city.areas.filter((a) => a.kind === 'water');

function inPolygon(x: number, z: number, polygon: ReadonlyArray<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

const waterBounds = water.map((a) => ({
  minX: Math.min(...a.polygon.map((p) => p.x)),
  maxX: Math.max(...a.polygon.map((p) => p.x)),
  minZ: Math.min(...a.polygon.map((p) => p.z)),
  maxZ: Math.max(...a.polygon.map((p) => p.z)),
}));

/** Exact test against the water polygons (not the game's 4 m ground raster). */
function inWaterExact(x: number, z: number): boolean {
  for (let i = 0; i < water.length; i++) {
    const b = waterBounds[i];
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (inPolygon(x, z, water[i].polygon)) return true;
  }
  return false;
}

/** Distance from the segment a..b to a structure's footprint (0 when they touch). */
function segToStructure(ax: number, az: number, bx: number, bz: number, s: Structure): number {
  if (segmentVsObb2(ax, az, bx, bz, s) >= 0) return 0;
  let best = Math.min(distPointObb(ax, az, s), distPointObb(bx, bz, s));
  for (const c of obbCorners(s)) best = Math.min(best, Math.sqrt(distSqPointSegment2(c.x, c.z, ax, az, bx, bz)));
  return best;
}

function inBounds(b: Bounds, x: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

describe('the game plays in Port Meridian; the placeholder is untouched', () => {
  it('is what getCity returns, and the placeholder is still what generateCity returns, to the last bit', () => {
    expect(cityChecksum(getCity().city)).toBe(3570529651);
    expect(cityChecksum(getCity().city)).toBe(cityChecksum(city));
    // The checksum the placeholder had before Port Meridian's archetypes were appended.
    expect(cityChecksum(generateCity())).toBe(1340881825);
    expect(cityChecksum(getCity(CITY_SEED, 'placeholder').city)).toBe(1340881825);
    expect(getCity(CITY_SEED, 'placeholder').city.structures.length).toBe(2592);
    expect(getCity(CITY_SEED, 'placeholder').city.props.length).toBe(4303);
  });

  it('keeps the archetype list within the draw budget, append-only', () => {
    expect(ARCHETYPES.length).toBeLessThanOrEqual(40);
    // The first 22 are the starter set, in their original order.
    expect(ARCHETYPES.slice(0, 22).map((a) => a.id)).toEqual([
      'house_a',
      'house_b',
      'house_c',
      'rowhouse_a',
      'shop_a',
      'shop_b',
      'shop_c',
      'apartment_a',
      'apartment_b',
      'apartment_c',
      'office_a',
      'office_b',
      'office_c',
      'tower_a',
      'tower_b',
      'tower_c',
      'factory_a',
      'factory_b',
      'warehouse_a',
      'bridge_a',
      'meridian_tower',
      'city_hall',
    ]);
  });
});

describe('Port Meridian: the data', () => {
  it('is well formed', () => {
    expect(validateCity(city)).toEqual([]);
    expect(city.half).toBe(CITY_HALF);
    expect(city.seed).toBe(CITY_SEED);
    for (const s of city.structures) {
      const a = archetypeDef(s.archetype);
      expect(s.height).toBe(a.height);
      expect(s.hp).toBe(a.hp);
      expect(s.value).toBe(a.value);
      expect(s.landmark).toBe(a.landmark);
      // Everything but a bridge deck has exactly its archetype's footprint.
      if (!s.passable) {
        expect(s.hx).toBe(a.footprint[0] / 2);
        expect(s.hz).toBe(a.footprint[1] / 2);
      }
    }
  });

  it('has the right size: structures, props, streets', () => {
    expect(city.structures.length).toBeGreaterThanOrEqual(2500);
    expect(city.structures.length).toBeLessThanOrEqual(3200);
    expect(city.props.length).toBeGreaterThanOrEqual(4000);
    expect(city.props.length).toBeLessThanOrEqual(6000);
    // The bots search the street graph with a linear scan: keep it in the hundreds.
    expect(nodes.length).toBeGreaterThan(400);
    expect(nodes.length).toBeLessThan(900);
    const used = new Set(city.structures.map((s) => s.archetype));
    expect(used.size).toBeLessThanOrEqual(40);
    // Every archetype appended for this city is actually used.
    for (const a of ARCHETYPES.slice(22)) expect(used.has(a.id), a.id).toBe(true);
  });

  it('has every kind of district, with names', () => {
    for (const zone of ZONE_TAGS) expect(city.districts.some((d) => d.zone === zone), zone).toBe(true);
    expect(new Set(city.districts.map((d) => d.name)).size).toBe(city.districts.length);
    expect(city.areas.filter((a) => a.kind === 'park').length).toBeGreaterThanOrEqual(8);
    expect(city.areas.filter((a) => a.kind === 'plaza').length).toBeGreaterThanOrEqual(8);
    expect(water.length).toBeGreaterThanOrEqual(2);
    expect(city.anchors.length).toBeGreaterThanOrEqual(8);
    expect(new Set(city.anchors.map((a) => a.name)).size).toBe(city.anchors.length);
  });

  it('keeps every structure inside the beltway, off the water and clear of every street', () => {
    for (const s of city.structures) {
      const b = obbBounds(s);
      if (!s.passable) {
        expect(Math.max(-b.minX, b.maxX, -b.minZ, b.maxZ), `${s.archetype} ${s.id}`).toBeLessThanOrEqual(1058);
        // The footprint, sampled every meter along its outline and every 3 m inside, is dry.
        const c = Math.cos(s.yaw);
        const sn = Math.sin(s.yaw);
        let wet = false;
        const probe = (lx: number, lz: number): void => {
          if (inWaterExact(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c)) wet = true;
        };
        for (let lx = -s.hx; lx <= s.hx; lx += 1) {
          probe(lx, -s.hz);
          probe(lx, s.hz);
        }
        for (let lz = -s.hz; lz <= s.hz; lz += 1) {
          probe(-s.hx, lz);
          probe(s.hx, lz);
        }
        for (let lx = -s.hx; lx <= s.hx; lx += 3) for (let lz = -s.hz; lz <= s.hz; lz += 3) probe(lx, lz);
        probe(s.hx, s.hz);
        expect(wet, `${s.archetype} ${s.id} stands in water`).toBe(false);
      }
    }
    // Streets: no wall within 12 m of a center line (a tank troop is 18 m wide) nor within 3 m of the roadway.
    let worst = Infinity;
    for (const e of edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const reach = 40;
      const box = { minX: Math.min(a.x, b.x) - reach, maxX: Math.max(a.x, b.x) + reach, minZ: Math.min(a.z, b.z) - reach, maxZ: Math.max(a.z, b.z) + reach };
      for (const s of city.structures) {
        if (s.passable) continue;
        const r = Math.max(s.hx, s.hz) * 1.5;
        if (s.x < box.minX - r || s.x > box.maxX + r || s.z < box.minZ - r || s.z > box.maxZ + r) continue;
        const d = segToStructure(a.x, a.z, b.x, b.z, s);
        const need = Math.max(e.width / 2 + 3, 12);
        if (d - need < worst) worst = d - need;
      }
    }
    expect(worst).toBeGreaterThanOrEqual(-0.01);
  });

  it('puts every prop on legal ground', () => {
    const q = createCityQuery(index, createCityState(city));
    for (const p of city.props) {
      const def = PROP_KINDS[p.kind];
      expect(Math.max(Math.abs(p.x), Math.abs(p.z)), `${p.kind} ${p.id}`).toBeLessThanOrEqual(1096);
      expect(inWaterExact(p.x, p.z), `${p.kind} ${p.id} in water`).toBe(false);
      expect(structureAt(q, p.x, p.z), `${p.kind} ${p.id} inside a structure`).toBe(-1);
      // Where it stands relative to the nearest roadway edge (negative: on the road).
      let off = Infinity;
      for (const e of edges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        if (p.x < Math.min(a.x, b.x) - 40 || p.x > Math.max(a.x, b.x) + 40 || p.z < Math.min(a.z, b.z) - 40 || p.z > Math.max(a.z, b.z) + 40) continue;
        const d = Math.sqrt(distSqPointSegment2(p.x, p.z, a.x, a.z, b.x, b.z)) - e.width / 2;
        if (d < off) off = d;
      }
      if (def.tally === 'car') {
        // Vehicles: on a street, or in a drive right beside one.
        expect(off, `${p.kind} ${p.id} is ${off.toFixed(1)} m off the street`).toBeLessThanOrEqual(12.5);
      } else {
        // Trees, lamps, kiosks, benches: never on the roadway.
        expect(off, `${p.kind} ${p.id} on the roadway`).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it('gives every starting neighborhood cars, kiosks and houses, and nothing a hatchling cannot wreck', () => {
    for (const a of city.anchors) {
      const b1 = stageBounds(city, a.id, 1);
      const inside = city.structures.filter((s) => inBounds(b1, s.x, s.z));
      expect(inside.length, a.name).toBeGreaterThanOrEqual(90);
      for (const s of inside) expect(s.cls === 'house' || s.cls === 'shop', `${a.name}: ${s.archetype}`).toBe(true);
      const props = city.props.filter((p) => inBounds(b1, p.x, p.z));
      expect(props.filter((p) => PROP_KINDS[p.kind].tally === 'car').length, a.name).toBeGreaterThanOrEqual(70);
      expect(props.filter((p) => p.kind === 'kiosk').length, a.name).toBeGreaterThanOrEqual(4);
      // The anchor itself is open ground, on dry land.
      const q = createCityQuery(index, createCityState(city));
      expect(structureAt(q, a.x, a.z), a.name).toBe(-1);
      expect(groundKindAt(index, a.x, a.z), a.name).not.toBe('water');
    }
  });
});

describe('Port Meridian: the level', () => {
  it('is fair: the value in the stage 1 and stage 2 squares is about the same for every start', () => {
    const v1 = city.anchors.map((a) => valueInBounds(city, stageBounds(city, a.id, 1)));
    const v2 = city.anchors.map((a) => valueInBounds(city, stageBounds(city, a.id, 2)));
    // Measured: 1.04 and 1.14. The design allows about 25%.
    expect(Math.max(...v1) / Math.min(...v1)).toBeLessThanOrEqual(1.12);
    expect(Math.max(...v2) / Math.min(...v2)).toBeLessThanOrEqual(1.25);
    expect(Math.min(...v1)).toBeGreaterThan(1200);
    expect(Math.min(...v2)).toBeGreaterThan(14000);
  });

  it('keeps the towers for the titan: no stage 2 square reaches the downtown core', () => {
    const towers = city.structures.filter((s) => s.cls === 'tower' || s.archetype === 'meridian_tower');
    expect(towers.length).toBeGreaterThanOrEqual(30);
    for (const t of towers) expect(Math.abs(t.x), `tower ${t.id}`).toBeLessThan(180);
    for (const a of city.anchors) {
      const b2 = stageBounds(city, a.id, 2);
      for (const t of towers) expect(inBounds(b2, t.x, t.z), `${a.name} reaches tower ${t.id}`).toBe(false);
      // Every stage 2 square has a landmark of its own; no stage 1 square has one.
      const landmarks = city.structures.filter((s) => s.landmark !== null);
      expect(landmarks.filter((s) => inBounds(b2, s.x, s.z)).length, a.name).toBeGreaterThanOrEqual(1);
      expect(landmarks.filter((s) => inBounds(stageBounds(city, a.id, 1), s.x, s.z)).length, a.name).toBe(0);
    }
    // The tallest building stands in the middle of downtown.
    const tallest = city.structures.reduce((p, s) => (s.height > p.height ? s : p));
    expect(tallest.archetype).toBe('meridian_tower');
    expect(Math.hypot(tallest.x - city.downtown.x, tallest.z - city.downtown.z)).toBeLessThan(150);
  });

  it('has at least 12 landmarks, each its own archetype with its own name', () => {
    const landmarks = city.structures.filter((s) => s.landmark !== null);
    expect(landmarks.length).toBeGreaterThanOrEqual(12);
    expect(new Set(landmarks.map((s) => s.landmark)).size).toBe(landmarks.length);
    expect(new Set(landmarks.map((s) => s.archetype)).size).toBe(landmarks.length);
    for (const s of landmarks) expect(s.cls).toBe('landmark');
    // Spread out: nowhere on dry land inside the beltway (25 m grid) is further than 760 m from
    // one (measured: 748 m, in the far north-west corner).
    let worst = 0;
    for (let x = -1050; x <= 1050; x += 25) {
      for (let z = -1050; z <= 1050; z += 25) {
        if (inWaterExact(x, z)) continue;
        let d = Infinity;
        for (const s of landmarks) d = Math.min(d, Math.hypot(s.x - x, s.z - z));
        worst = Math.max(worst, d);
      }
    }
    expect(worst).toBeLessThan(760);
  });

  it('has a connected street network that reaches every anchor', () => {
    const adjacency = roadAdjacency(city.roads);
    const seen = new Uint8Array(nodes.length);
    const queue = [0];
    seen[0] = 1;
    for (let i = 0; i < queue.length; i++) {
      for (const id of adjacency[queue[i]]) {
        const e = edges[id];
        const other = e.a === queue[i] ? e.b : e.a;
        if (!seen[other]) {
          seen[other] = 1;
          queue.push(other);
        }
      }
    }
    expect(queue.length).toBe(nodes.length);
    const center = nearestRoadNode(city.roads, city.downtown.x, city.downtown.z);
    for (const a of city.anchors) {
      const near = nearestRoadNode(city.roads, a.x, a.z);
      // (Bellhaven's anchor stands in the middle of its common, 80 m from the nearest corner.)
      expect(Math.hypot(nodes[near].x - a.x, nodes[near].z - a.z), a.name).toBeLessThan(90);
      expect(findRoadPath(city.roads, adjacency, near, center).length, a.name).toBeGreaterThan(1);
    }
    // No stub of a street shorter than a vehicle.
    for (const e of edges) expect(Math.hypot(nodes[e.a].x - nodes[e.b].x, nodes[e.a].z - nodes[e.b].z)).toBeGreaterThan(8);
  });

  it('has no dead ends but the pier, the mole and a few short closes', () => {
    const degree = nodes.map(() => 0);
    for (const e of edges) {
      degree[e.a]++;
      degree[e.b]++;
    }
    const dead = nodes.filter((n) => degree[n.id] === 1);
    expect(dead.length).toBeLessThanOrEqual(12);
    for (const n of dead) {
      const e = edges.find((x) => x.a === n.id || x.b === n.id);
      if (!e) continue;
      const other = nodes[e.a === n.id ? e.b : e.a];
      const length = Math.hypot(other.x - n.x, other.z - n.z);
      // Either a close of under 40 m, or one of the two walks out over the water (width 8).
      expect(length < 40 || e.width === 8, `dead end at (${n.x}, ${n.z})`).toBe(true);
    }
  });

  it('keeps the streets in one piece inside every stage square', () => {
    const adjacency = roadAdjacency(city.roads);
    const radius = [3, 4, 9];
    for (const a of city.anchors) {
      for (const stage of [1, 2, 3] as const) {
        const b = stageBounds(city, a.id, stage);
        const r = radius[stage - 1];
        const inPlay = nodes.map((n) => boundsContains(b, n.x, n.z, r));
        const total = inPlay.filter(Boolean).length;
        let start = -1;
        let best = Infinity;
        for (const n of nodes) {
          const d = Math.hypot(n.x - a.x, n.z - a.z);
          if (inPlay[n.id] && d < best) {
            best = d;
            start = n.id;
          }
        }
        const seen = new Uint8Array(nodes.length);
        const queue = [start];
        seen[start] = 1;
        for (let i = 0; i < queue.length; i++) {
          for (const id of adjacency[queue[i]]) {
            const e = edges[id];
            const other = e.a === queue[i] ? e.b : e.a;
            if (inPlay[other] && !seen[other]) {
              seen[other] = 1;
              queue.push(other);
            }
          }
        }
        // A few junctions at the very line may hang on streets that run outside it.
        expect(queue.length / total, `${a.name} stage ${stage}`).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it('makes every bridge deck at least as wide as the road it carries', () => {
    for (const e of edges.filter((x) => x.kind === 'bridge')) {
      const deck = city.structures[e.bridge];
      // A meter of curb and railing each side of the roadway.
      expect(e.width + 2, `bridge road ${e.id}`).toBeLessThanOrEqual(2 * deck.hx);
      expect(deck.hx).toBeGreaterThanOrEqual(archetypeDef(deck.archetype).footprint[0] / 2);
    }
  });

  it('keeps a 20 m apron round every landmark a juvenile can reach: no tall building wedges it in', () => {
    const reachable = city.structures.filter((s) => s.landmark !== null && city.anchors.some((a) => inBounds(stageBounds(city, a.id, 2), s.x, s.z)));
    expect(reachable.length).toBeGreaterThanOrEqual(8);
    const gapBetween = (a: Structure, b: Structure): number => {
      let d = Infinity;
      for (const c of obbCorners(a)) d = Math.min(d, distPointObb(c.x, c.z, b));
      for (const c of obbCorners(b)) d = Math.min(d, distPointObb(c.x, c.z, a));
      return d;
    };
    for (const lm of reachable) {
      for (const s of city.structures) {
        if (s.height <= 12 || s.passable || s.landmark !== null) continue;
        if (Math.abs(s.x - lm.x) > 150 || Math.abs(s.z - lm.z) > 150) continue;
        expect(gapBetween(lm, s), `${lm.landmark} and ${s.archetype} ${s.id}`).toBeGreaterThanOrEqual(20 - 1e-6);
      }
    }
  });

  it('crosses the river on at least 4 bridges, with a ford between them', () => {
    const q = createCityQuery(index, createCityState(city));
    const bridges = edges.filter((e) => e.kind === 'bridge');
    expect(bridges.length).toBeGreaterThanOrEqual(4);
    const decks = new Set<number>();
    for (const e of bridges) {
      const deck = city.structures[e.bridge];
      expect(deck.cls).toBe('bridge');
      expect(deck.passable).toBe(true);
      decks.add(deck.id);
      // The deck carries the street over the water: every wet point of the edge is on it, and some are wet.
      const a = nodes[e.a];
      const b = nodes[e.b];
      let wet = 0;
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (!inWaterExact(x, z)) continue;
        wet++;
        expect(bridgeAt(q, x, z)).toBe(deck.id);
      }
      expect(wet).toBeGreaterThan(20);
      // Both ends stand on dry land and lead somewhere.
      expect(inWaterExact(a.x, a.z) || inWaterExact(b.x, b.z)).toBe(false);
    }
    expect(decks.size).toBe(bridges.length);
    expect(city.structures.filter((s) => s.passable).length).toBe(bridges.length);
    // Other streets stay dry, except the ford (one narrow street through the river).
    const wetStreets = edges.filter((e) => {
      if (e.kind === 'bridge') return false;
      const a = nodes[e.a];
      const b = nodes[e.b];
      return inWaterExact((a.x + b.x) / 2, (a.z + b.z) / 2);
    });
    expect(wetStreets.length).toBe(1);
    expect(wetStreets[0].width).toBeLessThan(10);
  });

  it('rises from low outskirts to a tall center (the placeholder tests ask the same)', () => {
    const near: number[] = [];
    const far: number[] = [];
    for (const s of city.structures) {
      if (s.cls === 'bridge') continue;
      const d = Math.hypot(s.x - city.downtown.x, s.z - city.downtown.z);
      if (d < 250) near.push(s.height);
      if (d > 800) far.push(s.height);
    }
    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(near)).toBeGreaterThan(60);
    expect(mean(far)).toBeLessThan(12);
  });
});

describe('Port Meridian: identical on every machine', () => {
  it('comes out the same twice, and differently for another seed', () => {
    const again = generatePortMeridian(CITY_SEED);
    // The city as delivered (docs/CITY.md). Chromium computes the same two numbers. When the city
    // is changed on purpose, these change: update them here and in docs/CITY.md.
    expect(cityChecksum(city)).toBe(3570529651);
    expect(meridianChecksum(city)).toBe(3898350366);
    expect(cityChecksum(again)).toBe(cityChecksum(city));
    expect(meridianChecksum(again)).toBe(meridianChecksum(city));
    expect(JSON.stringify(again)).toBe(JSON.stringify(city));
    const other = generatePortMeridian(CITY_SEED + 1);
    expect(cityChecksum(other)).not.toBe(cityChecksum(city));
    expect(validateCity(other)).toEqual([]);
    // The hand-made part does not depend on the seed.
    expect(other.anchors).toEqual(city.anchors);
    expect(other.areas).toEqual(city.areas);
    expect(other.structures.filter((s) => s.landmark !== null).map((s) => [s.x, s.z])).toEqual(
      city.structures.filter((s) => s.landmark !== null).map((s) => [s.x, s.z]),
    );
  });

  it('snaps coordinates to 1/8 m and headings to the table', () => {
    const snapped = (v: number): boolean => Number.isInteger(v * 8);
    for (const s of city.structures) expect(snapped(s.x) && snapped(s.z) && snapped(s.hx) && snapped(s.hz), `structure ${s.id}`).toBe(true);
    for (const p of city.props) expect(snapped(p.x) && snapped(p.z), `prop ${p.id}`).toBe(true);
    for (const n of nodes) expect(snapped(n.x) && snapped(n.z), `node ${n.id}`).toBe(true);
    // Water, parks and plazas (the city's own ground lookup is built from these) and districts.
    for (const a of city.areas) for (const p of a.polygon) expect(snapped(p.x) && snapped(p.z), `area ${a.name}`).toBe(true);
    for (const d of city.districts) for (const p of d.polygon) expect(snapped(p.x) && snapped(p.z), `district ${d.name}`).toBe(true);
    const step = (Math.PI * 2) / 128;
    for (const s of city.structures) expect(Math.abs(s.yaw / step - Math.round(s.yaw / step)), `structure ${s.id}`).toBeLessThan(1e-6);
  });

  it('never calls a function whose last bit may differ between engines', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const dir = join(src, 'city', 'meridian');
    const own = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(own.length).toBeGreaterThanOrEqual(10);
    // The generator's own files, then the shared files it imports (checked for the same things;
    // the seeded generator also uses Math.imul, which is exact integer math, and names Math.PI).
    const helpers = ['math/rng.ts', 'city/archetypes.ts', 'city/props.ts', 'city/types.ts', 'defs/stages.ts', 'defs/ids.ts'];
    const files = [...own.map((f) => join(dir, f)), ...helpers.map((f) => join(src, f))];
    // Math may only be used for these (all exact, or correctly rounded by the language standard).
    const allowedOwn = new Set(['sqrt', 'floor', 'ceil', 'round', 'abs', 'min', 'max']);
    const allowedHelper = new Set([...allowedOwn, 'imul', 'PI']);
    for (const path of files) {
      const helper = !path.startsWith(dir);
      const file = helper ? path.slice(src.length + 1) : path.slice(dir.length + 1);
      const allowed = helper ? allowedHelper : allowedOwn;
      const text = readFileSync(path, 'utf8');
      // Blank out comments and strings: only code counts.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
      for (const m of code.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_]+)/g)) {
        expect(allowed.has(m[1]), `${file}: Math.${m[1]}`).toBe(true);
      }
      expect(/\bMath\s*\[/.test(code), `${file}: computed Math access`).toBe(false);
      expect(code.includes('**'), `${file}: the ** operator`).toBe(false);
      expect(/\b(Date|performance|crypto|Intl)\b/.test(code), `${file}: clock or locale`).toBe(false);
      expect(/\.sort\s*\(|\.toSorted\s*\(|\blocaleCompare\b|\btoLocale/.test(code), `${file}: engine-dependent ordering`).toBe(false);
      expect(/\bfor\s*\([^)]*\bin\b/.test(code), `${file}: for-in`).toBe(false);
      expect(/\b(parseFloat|toFixed|toPrecision|toExponential)\b/.test(code), `${file}: number formatting`).toBe(false);
      // Helpers: only type imports, besides defs/stages using defs/ids (both scanned here).
      if (helper) {
        for (const m of text.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from '([^']+)'/g)) {
          expect(m[1] !== undefined || (file === 'defs/stages.ts' && m[2] === './ids'), `${file} imports ${m[2]}`).toBe(true);
        }
        continue;
      }
      // Only the seeded generator, plain data and each other: no trigonometry helpers from math/.
      for (const m of text.matchAll(/from '([^']+)'/g)) {
        const from = m[1];
        const ok =
          from.startsWith('./') ||
          from === '../../math/rng' ||
          from === '../../math/vec' ||
          from === '../../defs/stages' ||
          from === '../types' ||
          from === '../archetypes' ||
          from === '../props';
        expect(ok, `${file} imports ${from}`).toBe(true);
      }
      // From math/vec only types may come (its functions use sines and cosines).
      for (const m of text.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from '\.\.\/\.\.\/math\/vec'/g)) {
        expect(m[1], `${file}: math/vec may only be imported for its types`).toBeTruthy();
      }
    }
  });

  it('builds, with its spatial index, in well under 200 ms', () => {
    // The best of five: a busy machine or a cold start must not fail the build. (Measured on a
    // quiet machine: about 45 ms once the engine is warm; the first, cold build is in docs/CITY.md.)
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      buildCityIndex(generatePortMeridian());
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(200);
  });
});
