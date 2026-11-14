/**
 * PLACEHOLDER CITY. Everything in this file is a stand-in: a plain grid city of the right size
 * and scale so the simulation, the network code and the client can be built and tested before
 * the handcrafted Port Meridian exists. The city worker replaces this file (and may add layout
 * data files next to it) behind the same signature:
 *
 *     generateCity(seed?: number): CityData
 *
 * Requirements any replacement must keep (tests in shared/test/city.test.ts check them):
 * - Deterministic and identical on every JavaScript engine. Use the seeded generator from
 *   math/rng.ts, and never let a branch (place it or not, which id comes next) depend on the
 *   last bits of a Math.sin / Math.cos / Math.atan2 result: engines may round those differently.
 * - `validateCity(city, { specials: false })` returns no problems: ids equal array indexes, no
 *   overlapping structures, everything inside the city, at least 8 neighborhood anchors. (This
 *   placeholder places none of phase 2's special buildings and city weapons; Port Meridian must.)
 *
 * What this placeholder builds: a 100 m street grid; a straight river with 5 bridges; a few
 * parks; low-rise outskirts rising to towers downtown; a small industrial corner; two landmark
 * stand-ins; 10 neighborhood anchors in the outskirts; about 4500 props.
 */

import { PI } from '../math/angle';
import { createRng, hash32, rngChance, rngFloat, rngInt, rngPick, type Rng } from '../math/rng';
import type { Vec2 } from '../math/vec';
import { archetypeDef } from './archetypes';
import {
  CITY_HALF,
  CITY_SEED,
  type Area,
  type CityData,
  type District,
  type NeighborhoodAnchor,
  type Prop,
  type PropKindId,
  type RoadEdge,
  type RoadNode,
  type Structure,
} from './types';

const LINE_SPACING = 100;
const LINE_COUNT = 21; // street center lines at -1000, -900, ..., 1000 on both axes
const FIRST_LINE = -1000;
const BLOCKS = LINE_COUNT - 1;

const RIVER_ROW = 12; // the block row between the z = 200 and z = 300 lines is the river
const RIVER_Z0 = 215;
const RIVER_Z1 = 285;
const BRIDGE_LINES = [3, 7, 11, 15, 19]; // x = -700, -300, 100, 500, 900

const DOWNTOWN: Vec2 = { x: 0, z: -100 };

/** Yaw for a building whose front faces +Z, +X, -Z, -X. */
const FACING_YAW = [0, PI / 2, PI, -PI / 2];

const PARK_BLOCKS: ReadonlyArray<readonly [number, number, string]> = [
  [6, 6, 'Founders Park'],
  [7, 6, 'Founders Park'],
  [6, 7, 'Founders Park'],
  [7, 7, 'Founders Park'],
  [14, 4, 'Signal Green'],
  [3, 15, 'Northbank Common'],
  [16, 16, 'Kiln Gardens'],
  [12, 9, 'Exchange Square'],
];

const ANCHORS: ReadonlyArray<readonly [number, number, string]> = [
  [-800, -800, 'Alder Row'],
  [0, -800, 'Bellhaven'],
  [800, -800, 'Cinder Flats'],
  [-800, -200, 'Dovecote'],
  [800, -300, 'Easter Green'],
  [-800, 700, 'Fennel Hill'],
  [-100, 800, 'Gull Point'],
  [400, 800, 'Harrow Lane'],
  [-500, -700, 'Ivy Court'],
  [500, -700, 'Juniper Bay'],
];

type Zone = 'core' | 'inner' | 'mid' | 'outer' | 'industrial';

function line(i: number): number {
  return FIRST_LINE + i * LINE_SPACING;
}

function isAvenue(i: number): boolean {
  return i % 5 === 0;
}

function roadWidth(i: number): number {
  return isAvenue(i) ? 20 : 14;
}

function zoneOf(cx: number, cz: number): Zone {
  if (cx > 550 && cz > 350) return 'industrial';
  const dx = cx - DOWNTOWN.x;
  const dz = cz - DOWNTOWN.z;
  const d2 = dx * dx + dz * dz;
  if (d2 < 230 * 230) return 'core';
  if (d2 < 430 * 430) return 'inner';
  if (d2 < 680 * 680) return 'mid';
  return 'outer';
}

export function generateCity(seed: number = CITY_SEED): CityData {
  const structures: Structure[] = [];
  const props: Prop[] = [];

  const place = (archetype: string, x: number, z: number, facing: number): number => {
    const a = archetypeDef(archetype);
    const id = structures.length;
    structures.push({
      id,
      archetype: a.id,
      x,
      z,
      hx: a.footprint[0] / 2,
      hz: a.footprint[1] / 2,
      yaw: FACING_YAW[facing],
      height: a.height,
      cls: a.cls,
      hp: a.hp,
      value: a.value,
      landmark: a.landmark,
      passable: a.passable,
    });
    return id;
  };

  const prop = (kind: PropKindId, x: number, z: number, yaw: number): void => {
    props.push({ id: props.length, kind, x, z, yaw });
  };

  const parkAt = new Map<number, string>();
  for (const [bi, bj, name] of PARK_BLOCKS) parkAt.set(bj * BLOCKS + bi, name);

  // --- Bridges first, so their ids are small and stable -------------------------------------
  const bridgeIdByLine = new Map<number, number>();
  for (const i of BRIDGE_LINES) {
    bridgeIdByLine.set(i, place('bridge_a', line(i), (RIVER_Z0 + RIVER_Z1) / 2, 0));
  }

  // --- Blocks -------------------------------------------------------------------------------
  const landmarkBlocks = new Map<number, string>([
    [8 * BLOCKS + 10, 'meridian_tower'], // block x 0..100, z -200..-100
    [9 * BLOCKS + 8, 'city_hall'], // block x -200..-100, z -100..0
  ]);

  for (let bj = 0; bj < BLOCKS; bj++) {
    if (bj === RIVER_ROW) continue;
    for (let bi = 0; bi < BLOCKS; bi++) {
      const key = bj * BLOCKS + bi;
      const cx = line(bi) + LINE_SPACING / 2;
      const cz = line(bj) + LINE_SPACING / 2;
      const rng = createRng(hash32(seed, bi, bj));

      if (parkAt.has(key)) {
        fillPark(rng, cx, cz, prop);
        continue;
      }
      const lm = landmarkBlocks.get(key);
      if (lm) {
        place(lm, cx, cz, 2);
        continue;
      }
      fillBlock(rng, zoneOf(cx, cz), cx, cz, place, prop);
    }
  }

  // --- Roads --------------------------------------------------------------------------------
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  for (let j = 0; j < LINE_COUNT; j++) {
    for (let i = 0; i < LINE_COUNT; i++) nodes.push({ id: j * LINE_COUNT + i, x: line(i), z: line(j) });
  }
  for (let j = 0; j < LINE_COUNT; j++) {
    for (let i = 0; i < LINE_COUNT; i++) {
      const id = j * LINE_COUNT + i;
      if (i + 1 < LINE_COUNT) {
        edges.push({
          id: edges.length,
          a: id,
          b: id + 1,
          width: roadWidth(j),
          kind: isAvenue(j) ? 'avenue' : 'street',
          bridge: -1,
        });
      }
      if (j + 1 < LINE_COUNT) {
        if (j === RIVER_ROW) {
          const deck = bridgeIdByLine.get(i);
          if (deck === undefined) continue; // this street stops at the river
          edges.push({ id: edges.length, a: id, b: id + LINE_COUNT, width: 16, kind: 'bridge', bridge: deck });
        } else {
          edges.push({
            id: edges.length,
            a: id,
            b: id + LINE_COUNT,
            width: roadWidth(i),
            kind: isAvenue(i) ? 'avenue' : 'street',
            bridge: -1,
          });
        }
      }
    }
  }

  // --- Street props -------------------------------------------------------------------------
  const carKinds: PropKindId[] = [
    'car_sedan',
    'car_sedan',
    'car_sedan',
    'car_sedan',
    'car_taxi',
    'car_van',
    'car_van',
    'bus',
    'truck',
  ];
  for (const e of edges) {
    if (e.kind === 'bridge') continue;
    const a = nodes[e.a];
    const b = nodes[e.b];
    const rng = createRng(hash32(seed, 7001, e.id));
    const alongX = a.z === b.z;
    const count = 2 + rngInt(rng, 3);
    for (let k = 0; k < count; k++) {
      const t = 0.18 + (0.64 * (k + rngFloat(rng) * 0.6)) / count;
      const side = rngChance(rng, 0.5) ? 1 : -1;
      const off = side * (e.width / 2 - 2.2);
      const kind = rngPick(rng, carKinds);
      if (alongX) prop(kind, a.x + (b.x - a.x) * t, a.z + off, side > 0 ? PI / 2 : -PI / 2);
      else prop(kind, a.x + off, a.z + (b.z - a.z) * t, side > 0 ? 0 : PI);
    }
  }
  for (let j = 0; j < LINE_COUNT; j++) {
    for (let i = 0; i < LINE_COUNT; i++) {
      const x = line(i);
      const z = line(j);
      const rng = createRng(hash32(seed, 7002, i, j));
      const corner = Math.max(roadWidth(i), roadWidth(j)) / 2 + 1.5;
      prop('lamp', x + corner, z + corner, 0);
      if (isAvenue(i) || isAvenue(j)) prop('trafficlight', x - corner, z - corner, 0);
      const zone = zoneOf(x, z);
      if ((zone === 'outer' || zone === 'mid') && rngChance(rng, 0.45)) prop('kiosk', x + corner + 1.5, z - corner - 1.5, 0);
      if (zone === 'outer') prop('hydrant', x - corner, z + corner, 0);
      if ((isAvenue(i) || isAvenue(j)) && rngChance(rng, 0.3)) prop('busstop', x - corner - 3, z + corner + 1, 0);
      if (zone === 'mid' && rngChance(rng, 0.12)) prop('billboard', x + corner + 2, z + corner + 4, 0);
    }
  }
  // Trees along both river banks.
  for (let x = -1080; x <= 1080; x += 40) {
    prop('tree_a', x, RIVER_Z0 - 4, 0);
    prop('tree_b', x + 20, RIVER_Z1 + 4, 0);
  }

  // --- Areas, districts, anchors ------------------------------------------------------------
  const areas: Area[] = [];
  const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
  areas.push({ id: 0, kind: 'water', name: 'Meridian River', polygon: rect(-CITY_HALF, RIVER_Z0, CITY_HALF, RIVER_Z1) });
  for (const [bi, bj, name] of PARK_BLOCKS) {
    const x0 = line(bi) + 10;
    const z0 = line(bj) + 10;
    areas.push({
      id: areas.length,
      kind: name === 'Exchange Square' ? 'plaza' : 'park',
      name,
      polygon: rect(x0, z0, x0 + 80, z0 + 80),
    });
  }

  const districts: District[] = [
    { id: 0, zone: 'downtown', name: 'Downtown', polygon: rect(DOWNTOWN.x - 430, DOWNTOWN.z - 430, DOWNTOWN.x + 430, RIVER_Z0) },
    { id: 1, zone: 'industrial', name: 'Northbank Works', polygon: rect(550, 350, CITY_HALF, CITY_HALF) },
    { id: 2, zone: 'suburb', name: 'Northbank', polygon: rect(-CITY_HALF, RIVER_Z1, 550, CITY_HALF) },
    { id: 3, zone: 'suburb', name: 'Southside', polygon: rect(-CITY_HALF, -CITY_HALF, CITY_HALF, DOWNTOWN.z - 430) },
  ];

  const anchors: NeighborhoodAnchor[] = ANCHORS.map(([x, z, name], id) => ({ id, name, x, z }));

  return {
    seed,
    half: CITY_HALF,
    structures,
    props,
    roads: { nodes, edges },
    areas,
    districts,
    anchors,
    downtown: { x: DOWNTOWN.x, z: DOWNTOWN.z },
  };
}

type Place = (archetype: string, x: number, z: number, facing: number) => number;
type PlaceProp = (kind: PropKindId, x: number, z: number, yaw: number) => void;

function fillPark(rng: Rng, cx: number, cz: number, prop: PlaceProp): void {
  for (let k = 0; k < 14; k++) {
    const x = cx - 34 + rngInt(rng, 69);
    const z = cz - 34 + rngInt(rng, 69);
    prop(rngChance(rng, 0.5) ? 'tree_a' : 'tree_b', x, z, 0);
  }
  prop('bench', cx - 20, cz, PI / 2);
  prop('bench', cx + 20, cz, -PI / 2);
  prop('bench', cx, cz - 20, 0);
  prop('bench', cx, cz + 20, PI);
}

function fillBlock(rng: Rng, zone: Zone, cx: number, cz: number, place: Place, prop: PlaceProp): void {
  if (zone === 'outer') {
    const homes = ['house_a', 'house_a', 'house_b', 'house_b', 'house_c', 'shop_a'];
    for (const dx of [-27, -9, 9, 27]) {
      if (rngChance(rng, 0.9)) place(rngPick(rng, homes), cx + dx, cz + 27, 0);
      if (rngChance(rng, 0.9)) place(rngPick(rng, homes), cx + dx, cz - 27, 2);
    }
    if (rngChance(rng, 0.8)) place(rngPick(rng, homes), cx + 28, cz, 1);
    if (rngChance(rng, 0.8)) place(rngPick(rng, homes), cx - 28, cz, 3);
    // A couple of garden trees in the middle of the block.
    prop('tree_a', cx - 6 + rngInt(rng, 5), cz - 8 + rngInt(rng, 5), 0);
    prop('tree_b', cx + 4 + rngInt(rng, 5), cz + 5 + rngInt(rng, 5), 0);
    return;
  }
  if (zone === 'mid') {
    const kinds = ['apartment_a', 'apartment_a', 'apartment_b', 'shop_b', 'shop_c', 'rowhouse_a'];
    for (const dx of [-24, 0, 24]) {
      if (rngChance(rng, 0.92)) place(rngPick(rng, kinds), cx + dx, cz + 20, 0);
      if (rngChance(rng, 0.92)) place(rngPick(rng, kinds), cx + dx, cz - 20, 2);
    }
    return;
  }
  if (zone === 'inner') {
    const kinds = ['office_a', 'office_a', 'office_b', 'apartment_c', 'apartment_b'];
    for (const dx of [-20, 20]) {
      place(rngPick(rng, kinds), cx + dx, cz + 20, 0);
      place(rngPick(rng, kinds), cx + dx, cz - 20, 2);
    }
    return;
  }
  if (zone === 'core') {
    const kinds = ['tower_a', 'tower_a', 'tower_b', 'tower_c', 'office_c', 'office_b'];
    for (const dx of [-19, 19]) {
      place(rngPick(rng, kinds), cx + dx, cz + 19, 0);
      place(rngPick(rng, kinds), cx + dx, cz - 19, 2);
    }
    return;
  }
  // industrial
  place('factory_b', cx, cz + 19, 0);
  place(rngChance(rng, 0.5) ? 'factory_a' : 'warehouse_a', cx, cz - 20, 2);
}
