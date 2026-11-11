import { describe, expect, it } from 'vitest';
import {
  allStageBounds,
  ARCHETYPES,
  archetypeDef,
  archetypeModelId,
  archetypeSizeClass,
  bridgeAt,
  buildCityIndex,
  castRay,
  castSegment,
  CITY_HALF,
  CITY_SEED,
  cityBounds,
  cityChecksum,
  circleHitsStructure,
  createCityCastHit,
  createCityQuery,
  createCityState,
  distToStructure,
  findRoadPath,
  generateCity,
  getCity,
  groundKindAt,
  inWater,
  isStanding,
  lineOfSight,
  nearestRoadNode,
  PROP_KIND_IDS,
  PROP_KINDS,
  propsInCircle,
  roadAdjacency,
  stageBounds,
  structureAt,
  structureContact,
  structuresInCircle,
  validateCity,
  valueInBounds,
  type CityQuery,
} from '../src/city';
import { STRUCTURE_CLASSES } from '../src/defs';
import {
  bitClear,
  bitCount,
  boundsContains,
  boundsInside,
  createCastHit,
  createContact,
  createRng,
  distPointObb,
  rngRange,
  segmentVsPrism,
  v3Normalize,
} from '../src/math';

const { city, index } = getCity();

function freshQuery(): CityQuery {
  return createCityQuery(index, createCityState(city));
}

describe('archetypes and prop kinds', () => {
  it('have unique ids and cover every structure class', () => {
    const ids = new Set(ARCHETYPES.map((a) => a.id));
    expect(ids.size).toBe(ARCHETYPES.length);
    for (const cls of STRUCTURE_CLASSES) {
      expect(ARCHETYPES.some((a) => a.cls === cls)).toBe(true);
    }
    for (const a of ARCHETYPES) {
      expect(a.id).toMatch(/^[a-z0-9_]+$/);
      expect(a.footprint[0]).toBeGreaterThan(0);
      expect(a.footprint[1]).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
      expect(a.hp).toBeGreaterThan(0);
      expect(a.value).toBeGreaterThan(0);
      expect(a.landmark !== null).toBe(a.cls === 'landmark');
      expect(a.passable).toBe(a.cls === 'bridge');
    }
    expect(() => archetypeDef('nope')).toThrow();
  });

  it('name models the way the art contract says', () => {
    expect(archetypeModelId(archetypeDef('house_a'))).toBe('bld_house_a');
    expect(archetypeModelId(archetypeDef('meridian_tower'))).toBe('lm_meridian_tower');
    expect(archetypeSizeClass(archetypeDef('house_a'))).toBe('small');
    expect(archetypeSizeClass(archetypeDef('tower_b'))).toBe('large');
    expect(archetypeSizeClass(archetypeDef('city_hall'))).toBe('landmark');
  });

  it('defines every prop kind', () => {
    for (const id of PROP_KIND_IDS) {
      const def = PROP_KINDS[id];
      expect(def.id).toBe(id);
      expect(def.radius).toBeGreaterThan(0);
      expect(def.value).toBeGreaterThanOrEqual(0);
    }
    // Cars and kiosks count toward the bar so the hatchling has things to wreck.
    expect(PROP_KINDS.car_sedan.value).toBeGreaterThan(0);
    expect(PROP_KINDS.kiosk.value).toBeGreaterThan(0);
    expect(PROP_KINDS.car_sedan.tally).toBe('car');
  });
});

describe('the generated city', () => {
  it('is well formed', () => {
    expect(validateCity(city)).toEqual([]);
    expect(city.half).toBe(CITY_HALF);
    expect(city.seed).toBe(CITY_SEED);
  });

  it('is deterministic, and the seed matters', () => {
    const again = generateCity(CITY_SEED);
    expect(cityChecksum(again)).toBe(cityChecksum(city));
    expect(again.structures.length).toBe(city.structures.length);
    expect(cityChecksum(generateCity(CITY_SEED + 1))).not.toBe(cityChecksum(city));
  });

  it('has the right scale: thousands of structures and props, anchors, landmarks, water, parks', () => {
    expect(city.structures.length).toBeGreaterThanOrEqual(2000);
    expect(city.structures.length).toBeLessThanOrEqual(3600);
    expect(city.props.length).toBeGreaterThanOrEqual(3000);
    expect(city.props.length).toBeLessThanOrEqual(6500);
    expect(city.anchors.length).toBeGreaterThanOrEqual(8);
    expect(city.structures.filter((s) => s.landmark !== null).length).toBeGreaterThanOrEqual(2);
    expect(city.structures.filter((s) => s.cls === 'bridge').length).toBeGreaterThanOrEqual(4);
    expect(city.areas.some((a) => a.kind === 'water')).toBe(true);
    expect(city.areas.filter((a) => a.kind === 'park').length).toBeGreaterThanOrEqual(2);
    expect(city.roads.nodes.length).toBeGreaterThan(100);
  });

  it('rises from low outskirts to a tall center', () => {
    const near: number[] = [];
    const far: number[] = [];
    for (const s of city.structures) {
      if (s.cls === 'bridge') continue;
      const d = Math.hypot(s.x - city.downtown.x, s.z - city.downtown.z);
      if (d < 250) near.push(s.height);
      if (d > 800) far.push(s.height);
    }
    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    expect(near.length).toBeGreaterThan(10);
    expect(far.length).toBeGreaterThan(100);
    expect(mean(near)).toBeGreaterThan(60);
    expect(mean(far)).toBeLessThan(12);
  });

  it('puts every anchor in a low-rise area with things a hatchling can wreck', () => {
    const q = freshQuery();
    const ids: number[] = [];
    for (const anchor of city.anchors) {
      const b1 = stageBounds(city, anchor.id, 1);
      const inside = city.structures.filter((s) => boundsContains(b1, s.x, s.z));
      expect(inside.length).toBeGreaterThan(20);
      const houses = inside.filter((s) => s.cls === 'house' || s.cls === 'shop').length;
      expect(houses / inside.length).toBeGreaterThan(0.6);
      expect(propsInCircle(q, anchor.x, anchor.z, 150, ids)).toBeGreaterThan(20);
      // The anchor itself is open ground.
      expect(structureAt(q, anchor.x, anchor.z)).toBe(-1);
      expect(valueInBounds(city, b1)).toBeGreaterThan(300);
    }
  });
});

describe('stage bounds', () => {
  it('are nested squares of the right size inside the city', () => {
    const whole = cityBounds(city);
    for (const anchor of city.anchors) {
      const [b1, b2, b3] = allStageBounds(city, anchor.id);
      expect(b1.maxX - b1.minX).toBe(360);
      expect(b1.maxZ - b1.minZ).toBe(360);
      expect(b2.maxX - b2.minX).toBe(920);
      expect(b2.maxZ - b2.minZ).toBe(920);
      expect(b3).toEqual(whole);
      expect(boundsContains(b1, anchor.x, anchor.z)).toBe(true);
      expect(boundsInside(b1, b2)).toBe(true);
      expect(boundsInside(b2, b3)).toBe(true);
      expect(valueInBounds(city, b2)).toBeGreaterThan(valueInBounds(city, b1));
      expect(valueInBounds(city, b3)).toBeGreaterThan(valueInBounds(city, b2));
    }
  });

  it('lean the district toward downtown', () => {
    for (const anchor of city.anchors) {
      const b1 = stageBounds(city, anchor.id, 1);
      const b2 = stageBounds(city, anchor.id, 2);
      const c1 = { x: (b1.minX + b1.maxX) / 2, z: (b1.minZ + b1.maxZ) / 2 };
      const c2 = { x: (b2.minX + b2.maxX) / 2, z: (b2.minZ + b2.maxZ) / 2 };
      const before = Math.hypot(c1.x - city.downtown.x, c1.z - city.downtown.z);
      const after = Math.hypot(c2.x - city.downtown.x, c2.z - city.downtown.z);
      expect(after).toBeLessThanOrEqual(before);
    }
    expect(() => stageBounds(city, 999, 1)).toThrow();
  });
});

describe('spatial index', () => {
  it('finds exactly the structures a circle overlaps', () => {
    const q = freshQuery();
    const rng = createRng(3);
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = rngRange(rng, -1150, 1150);
      const z = rngRange(rng, -1150, 1150);
      const r = rngRange(rng, 1, 90);
      structuresInCircle(q, x, z, r, out);
      const expected = city.structures.filter((s) => distPointObb(x, z, s) < r).map((s) => s.id);
      expect(out.slice().sort((a, b) => a - b)).toEqual(expected);
      expect(circleHitsStructure(q, x, z, r)).toBe(expected.length > 0);
    }
  });

  it('skips rubble unless asked for it', () => {
    const q = freshQuery();
    const target = city.structures.find((s) => s.cls === 'house');
    expect(target).toBeDefined();
    if (!target) return;
    const out: number[] = [];
    expect(structuresInCircle(q, target.x, target.z, 1, out)).toBe(1);
    expect(structureAt(q, target.x, target.z)).toBe(target.id);
    expect(isStanding(q, target.id)).toBe(true);
    q.structureHp[target.id] = 0;
    expect(isStanding(q, target.id)).toBe(false);
    expect(structuresInCircle(q, target.x, target.z, 1, out)).toBe(0);
    expect(structuresInCircle(q, target.x, target.z, 1, out, false)).toBe(1);
    expect(structureAt(q, target.x, target.z)).toBe(-1);
    expect(structureAt(q, target.x, target.z, false)).toBe(target.id);
    expect(circleHitsStructure(q, target.x, target.z, 1)).toBe(false);
  });

  it('filters circle hits by height', () => {
    const q = freshQuery();
    const house = city.structures.find((s) => s.cls === 'house');
    expect(house).toBeDefined();
    if (!house) return;
    expect(circleHitsStructure(q, house.x, house.z, 1, 3.5)).toBe(true);
    expect(circleHitsStructure(q, house.x, house.z, 1, 12)).toBe(false);
  });

  it('gives the same contact as the plain geometry', () => {
    const s = city.structures[100];
    const c = createContact();
    const px = s.x + s.hx + 1;
    expect(structureContact(index, s.id, px, s.z, 3, c)).toBe(distPointObb(px, s.z, s) < 3);
    expect(distToStructure(index, s.id, s.x, s.z)).toBe(0);
  });

  it('casts segments like a brute-force test against every structure', () => {
    const q = freshQuery();
    const rng = createRng(11);
    const hit = createCityCastHit();
    const one = createCastHit();
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const a = { x: rngRange(rng, -1100, 1100), y: rngRange(rng, 0.5, 12), z: rngRange(rng, -1100, 1100) };
      const len = rngRange(rng, 20, 700);
      const dir = v3Normalize({ x: rngRange(rng, -1, 1), y: rngRange(rng, -0.02, 0.05), z: rngRange(rng, -1, 1) });
      const b = { x: a.x + dir.x * len, y: a.y + dir.y * len, z: a.z + dir.z * len };
      let bestT = Infinity;
      let bestId = -1;
      for (const s of city.structures) {
        if (segmentVsPrism(a, b, s, 0, s.height, one) && one.t < bestT) {
          bestT = one.t;
          bestId = s.id;
        }
      }
      const ok = castSegment(q, a, b, hit);
      expect(ok).toBe(bestId >= 0);
      expect(lineOfSight(q, a, b)).toBe(bestId < 0);
      if (ok) {
        hits++;
        expect(hit.t).toBeCloseTo(bestT, 9);
        expect(hit.structure).toBe(bestId);
        // The ray form reports a distance instead of a fraction.
        expect(castRay(q, a, dir, len, hit)).toBe(true);
        expect(hit.t).toBeCloseTo(bestT * len, 6);
        // Ignoring the hit structure finds something farther, or nothing.
        if (castSegment(q, a, b, hit, bestId)) {
          expect(hit.structure).not.toBe(bestId);
          expect(hit.t).toBeGreaterThanOrEqual(bestT - 1e-9);
        }
      }
    }
    expect(hits).toBeGreaterThan(150);
  });

  it('handles vertical and out-of-city casts', () => {
    const q = freshQuery();
    const hit = createCityCastHit();
    const tower = city.structures.find((s) => s.landmark === 'Meridian Tower');
    expect(tower).toBeDefined();
    if (!tower) return;
    // An artillery shell falling straight down onto the roof.
    const top = { x: tower.x, y: 400, z: tower.z };
    expect(castSegment(q, top, { x: tower.x, y: 0, z: tower.z }, hit)).toBe(true);
    expect(hit.structure).toBe(tower.id);
    expect(hit.ny).toBe(1);
    expect(hit.t).toBeCloseTo((400 - tower.height) / 400, 9);
    // Entirely outside the city.
    expect(castSegment(q, { x: 2000, y: 5, z: 0 }, { x: 3000, y: 5, z: 0 }, hit)).toBe(false);
    // From outside into the city.
    expect(castSegment(q, { x: -3000, y: 5, z: tower.z }, { x: tower.x, y: 5, z: tower.z }, hit)).toBe(true);
    // Rubble does not block.
    q.structureHp[tower.id] = 0;
    expect(castSegment(q, top, { x: tower.x, y: 0, z: tower.z }, hit)).toBe(false);
  });

  it('finds live props in a radius', () => {
    const q = freshQuery();
    const rng = createRng(5);
    const out: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = rngRange(rng, -1100, 1100);
      const z = rngRange(rng, -1100, 1100);
      const r = rngRange(rng, 1, 60);
      propsInCircle(q, x, z, r, out);
      const expected = city.props
        .filter((p) => Math.hypot(p.x - x, p.z - z) < r + PROP_KINDS[p.kind].radius)
        .map((p) => p.id);
      expect(out.slice().sort((a, b) => a - b)).toEqual(expected);
    }
    const p = city.props[10];
    expect(propsInCircle(q, p.x, p.z, 0.5, out)).toBeGreaterThanOrEqual(1);
    expect(out).toContain(p.id);
    bitClear(q.propAlive, p.id);
    propsInCircle(q, p.x, p.z, 0.5, out);
    expect(out).not.toContain(p.id);
    propsInCircle(q, p.x, p.z, 0.5, out, false);
    expect(out).toContain(p.id);
    expect(bitCount(q.propAlive)).toBe(city.props.length - 1);
  });

  it('knows water, parks and bridges', () => {
    const q = freshQuery();
    const water = city.areas.find((a) => a.kind === 'water');
    const park = city.areas.find((a) => a.kind === 'park');
    const bridge = city.structures.find((s) => s.cls === 'bridge');
    expect(water && park && bridge).toBeTruthy();
    if (!water || !park || !bridge) return;
    const centroid = (poly: { x: number; z: number }[]): { x: number; z: number } => ({
      x: poly.reduce((a, p) => a + p.x, 0) / poly.length,
      z: poly.reduce((a, p) => a + p.z, 0) / poly.length,
    });
    const pc = centroid(park.polygon);
    expect(groundKindAt(index, pc.x, pc.z)).toBe('park');
    expect(groundKindAt(index, 5000, 5000)).toBe('land');
    // Mid-river, away from any bridge: wading.
    const wx = bridge.x + 150;
    expect(groundKindAt(index, wx, bridge.z)).toBe('water');
    expect(inWater(q, wx, bridge.z)).toBe(true);
    // On the bridge deck: over water but dry.
    expect(groundKindAt(index, bridge.x, bridge.z)).toBe('water');
    expect(bridgeAt(q, bridge.x, bridge.z)).toBe(bridge.id);
    expect(inWater(q, bridge.x, bridge.z)).toBe(false);
    // A destroyed bridge no longer carries anybody.
    q.structureHp[bridge.id] = 0;
    expect(bridgeAt(q, bridge.x, bridge.z)).toBe(-1);
    expect(inWater(q, bridge.x, bridge.z)).toBe(true);
    // Dry land is dry.
    expect(inWater(q, city.anchors[0].x, city.anchors[0].z)).toBe(false);
  });

  it('rasterizes arbitrary polygons into the ground grid', () => {
    const custom = generateCity();
    custom.areas = [
      {
        id: 0,
        kind: 'water',
        name: 'Triangle Bay',
        polygon: [
          { x: 0, z: 0 },
          { x: 200, z: 0 },
          { x: 0, z: 200 },
        ],
      },
    ];
    const idx = buildCityIndex(custom);
    expect(groundKindAt(idx, 50, 50)).toBe('water');
    expect(groundKindAt(idx, 150, 150)).toBe('land');
    expect(groundKindAt(idx, -10, 50)).toBe('land');
    expect(groundKindAt(idx, 190, 6)).toBe('water');
    expect(groundKindAt(idx, 190, 30)).toBe('land');
  });
});

describe('road graph', () => {
  const adjacency = roadAdjacency(city.roads);

  it('routes across the river over a bridge', () => {
    const south = nearestRoadNode(city.roads, 0, -500);
    const north = nearestRoadNode(city.roads, 0, 700);
    const path = findRoadPath(city.roads, adjacency, south, north);
    expect(path[0]).toBe(south);
    expect(path[path.length - 1]).toBe(north);
    let usedBridge = false;
    for (let i = 0; i + 1 < path.length; i++) {
      const edge = city.roads.edges.find(
        (e) => (e.a === path[i] && e.b === path[i + 1]) || (e.b === path[i] && e.a === path[i + 1]),
      );
      expect(edge).toBeDefined();
      if (edge?.kind === 'bridge') usedBridge = true;
    }
    expect(usedBridge).toBe(true);
  });

  it('respects closed edges and reports no route', () => {
    const south = nearestRoadNode(city.roads, 0, -500);
    const north = nearestRoadNode(city.roads, 0, 700);
    const noBridges = findRoadPath(city.roads, adjacency, south, north, (id) => city.roads.edges[id].kind !== 'bridge');
    expect(noBridges).toEqual([]);
    expect(findRoadPath(city.roads, adjacency, south, south)).toEqual([south]);
    expect(findRoadPath(city.roads, adjacency, -1, north)).toEqual([]);
  });
});
