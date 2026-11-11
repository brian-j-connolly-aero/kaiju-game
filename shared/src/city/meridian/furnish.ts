/**
 * Small breakables for Port Meridian: parked and moving cars, buses at stops, kiosks, trees,
 * lamps, traffic lights, benches, hydrants and billboards. Vehicles stand on the roadway (or in
 * a driveway); everything else stands off it. Nothing is placed in water or inside a building.
 */

import { createRng, hash32, rngChance, rngFloat, rngInt, rngRange, type Rng } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import type { Area, Prop, PropKindId } from '../types';
import { PROP_KINDS } from '../props';
import type { River } from './areas';
import { patchAt, type Builder, type Street } from './build';
import { DIR_COS, DIR_SIN, DIR_YAW, nearestDir, turnDir } from './dirs';
import { distSqPointBox, distSqPointSeg, len, pointInPolygon, quant } from './geo';
import { G_LAND, G_PARK, G_PLAZA, G_WATER, groundAt } from './ground';
import { EDGE } from './layout';
import type { PaletteId } from './palettes';

/** Props stay inside this distance from the center on both axes. */
const PROP_LIMIT = 1096;
/** Side of an occupancy cell: two props never share one. */
const OCC_CELL = 2;

const HOMELY: readonly PaletteId[] = ['suburb', 'gardenSuburb', 'oldSuburb', 'rowhouses', 'workerRows', 'harborVillage', 'beachVillage', 'templeSlope', 'temple', 'oldtown'];
const WORKS: readonly PaletteId[] = ['industrial', 'docks', 'quay'];
const GARDENS: readonly PaletteId[] = ['suburb', 'gardenSuburb', 'oldSuburb', 'templeSlope', 'temple', 'harborVillage', 'beachVillage'];

interface Furnisher {
  b: Builder;
  props: Prop[];
  occ: Uint8Array;
  occCols: number;
  nodeStreets: number[][];
}

/** Distance (squared) to the nearest building wall near a point; Infinity when none is close. */
function wallDistSq(b: Builder, x: number, z: number): number {
  const cell = 40;
  const c = Math.floor((x + b.half) / cell);
  const r = Math.floor((z + b.half) / cell);
  let best = Infinity;
  for (let rr = r - 1; rr <= r + 1; rr++) {
    for (let cc = c - 1; cc <= c + 1; cc++) {
      if (rr < 0 || cc < 0 || rr >= b.cols || cc >= b.cols) continue;
      for (const id of b.boxCells[rr * b.cols + cc]) {
        if (b.structures[id].passable) continue;
        const d = distSqPointBox(x, z, b.boxes[id]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** True when the point lies on some street's roadway, grown by `pad`. */
function onRoadway(b: Builder, x: number, z: number, pad: number): boolean {
  const cell = 40;
  const c = Math.floor((x + b.half) / cell);
  const r = Math.floor((z + b.half) / cell);
  if (r < 0 || c < 0 || r >= b.cols || c >= b.cols) return false;
  for (const id of b.streetCells[r * b.cols + c]) {
    const s = b.streets[id];
    const reach = s.spec.width / 2 + pad;
    if (distSqPointSeg(x, z, s.ax, s.az, s.bx, s.bz) < reach * reach) return true;
  }
  return false;
}

function isVehicle(kind: PropKindId): boolean {
  return PROP_KINDS[kind].tally === 'car';
}

/** Places a prop when the spot is legal and free. `dir` is a heading table index. */
function put(f: Furnisher, kind: PropKindId, x: number, z: number, dir: number): boolean {
  const qx = quant(x);
  const qz = quant(z);
  if (qx < -PROP_LIMIT || qx > PROP_LIMIT || qz < -PROP_LIMIT || qz > PROP_LIMIT) return false;
  const ground = groundAt(f.b.g, qx, qz);
  if (ground === G_WATER) return false;
  const vehicle = isVehicle(kind);
  const radius = PROP_KINDS[kind].radius;
  const keep = (radius < 1.6 ? radius : 1.6) + 0.4;
  if (wallDistSq(f.b, qx, qz) < keep * keep) return false;
  if (!vehicle && onRoadway(f.b, qx, qz, 0.2)) return false;
  // Occupancy: big things claim their neighbors too.
  const c = Math.floor((qx + f.b.half) / OCC_CELL);
  const r = Math.floor((qz + f.b.half) / OCC_CELL);
  const span = radius > 3 ? 2 : radius > 1.2 ? 1 : 0;
  for (let rr = r - span; rr <= r + span; rr++) {
    for (let cc = c - span; cc <= c + span; cc++) {
      if (rr < 0 || cc < 0 || rr >= f.occCols || cc >= f.occCols) continue;
      if (f.occ[rr * f.occCols + cc]) return false;
    }
  }
  for (let rr = r - span; rr <= r + span; rr++) {
    for (let cc = c - span; cc <= c + span; cc++) {
      if (rr < 0 || cc < 0 || rr >= f.occCols || cc >= f.occCols) continue;
      f.occ[rr * f.occCols + cc] = 1;
    }
  }
  f.props.push({ id: f.props.length, kind, x: qx, z: qz, yaw: DIR_YAW[dir] });
  return true;
}

function carKind(rng: Rng, palette: PaletteId | null, moving: boolean): PropKindId {
  const r = rngFloat(rng);
  const works = palette !== null && WORKS.includes(palette);
  const town = palette === 'core' || palette === 'bayfront' || palette === 'eastside' || palette === 'station';
  if (moving && r < 0.1) return 'bus';
  if (works) return r < 0.4 ? 'truck' : r < 0.7 ? 'car_van' : 'car_sedan';
  if (town) return r < 0.4 ? 'car_taxi' : r < 0.55 ? 'car_van' : 'car_sedan';
  return r < 0.62 ? 'car_sedan' : r < 0.85 ? 'car_van' : r < 0.93 ? 'car_taxi' : 'truck';
}

function furnishStreet(f: Furnisher, s: Street, seed: number): void {
  if (s.spec.kind === 'bridge' || s.spec.ford) return;
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l = len(dx, dz);
  if (l < 12) return;
  const ux = dx / l;
  const uz = dz / l;
  const half = s.spec.width / 2;
  const along = nearestDir(ux, uz);
  const back = turnDir(along, 64);
  const rng = createRng(hash32(seed, 401, s.id));
  const beltway = s.spec.name === 'Meridian Beltway';
  const mole = s.spec.width <= 9;

  for (let side = -1; side <= 1; side += 2) {
    const nx = -uz * side;
    const nz = ux * side;
    const patch = patchAt(f.b.patches, (s.ax + s.bx) / 2 + nx * (half + 16), (s.az + s.bz) / 2 + nz * (half + 16));
    const palette = patch ? patch.spec.palette : null;
    const at = (t: number, off: number): Vec2 => ({ x: s.ax + ux * t + nx * off, z: s.az + uz * t + nz * off });

    // Parked cars at the curb.
    const cars = (l / 100) * s.spec.cars * (patch ? 0.75 : 0.3);
    const count = Math.floor(cars + rngFloat(rng));
    for (let i = 0; i < count; i++) {
      const p = at(rngRange(rng, 7, Math.max(8, l - 7)), half - 1.3);
      put(f, carKind(rng, palette, false), p.x, p.z, side > 0 ? along : back);
    }
    // Moving traffic on the avenues, in lane.
    if (s.spec.kind === 'avenue') {
      const moving = Math.floor((l / 100) * (beltway ? 0.25 : 0.55) + rngFloat(rng));
      for (let i = 0; i < moving; i++) {
        const p = at(rngRange(rng, 10, Math.max(11, l - 10)), half * 0.42);
        put(f, carKind(rng, palette, true), p.x, p.z, side > 0 ? along : back);
      }
    }
    if (mole) {
      // The mole and the pier: lamps and benches only.
      for (let t = 12; t < l - 4; t += 34) {
        const p = at(t, half + 1.2);
        put(f, side > 0 ? 'lamp' : 'bench', p.x, p.z, turnDir(along, side > 0 ? 32 : -32));
      }
      continue;
    }
    // A lamp on most pieces of street, on alternating sides.
    if (l >= 30 && s.id % 3 !== 0 && (s.id % 2 === 0) === side > 0) {
      const p = at(l / 2, half + 1.1);
      put(f, 'lamp', p.x, p.z, along);
    }
    // Street trees on the avenues; a tree belt outside the beltway.
    if (s.spec.kind === 'avenue') {
      const outer = beltway && Math.max(Math.abs(s.ax + nx * 30), Math.abs(s.az + nz * 30)) > EDGE;
      if (beltway) {
        if (outer) {
          for (let t = 9; t < l - 4; t += 40) {
            const p = at(t + rngRange(rng, -3, 3), half + rngRange(rng, 5, 14));
            put(f, rngChance(rng, 0.5) ? 'tree_a' : 'tree_b', p.x, p.z, 0);
          }
        }
      } else if (palette === null || !WORKS.includes(palette)) {
        for (let t = 11; t < l - 8; t += 46) {
          const p = at(t, half + 1.7);
          put(f, (s.id + (side > 0 ? 0 : 1)) % 2 === 0 ? 'tree_a' : 'tree_b', p.x, p.z, 0);
        }
      }
      // A bus stop on the longer pieces, sometimes with the bus in it.
      if (!beltway && l > 40 && rngChance(rng, l / 300)) {
        const t = rngRange(rng, 0.3, 0.7) * l;
        const p = at(t, half + 2.2);
        if (put(f, 'busstop', p.x, p.z, turnDir(along, side > 0 ? 32 : -32)) && rngChance(rng, 0.7)) {
          const q = at(t + 2, half - 2.4);
          put(f, 'bus', q.x, q.z, side > 0 ? along : back);
        }
      }
      // Billboards along the works and the beltway.
      if ((beltway && !outer) || (palette !== null && WORKS.includes(palette))) {
        if (l > 40 && rngChance(rng, beltway ? 0.1 : 0.3)) {
          const p = at(rngRange(rng, 0.2, 0.8) * l, half + 4.5);
          put(f, 'billboard', p.x, p.z, turnDir(along, side > 0 ? 32 : -32));
        }
      }
    }
    if (!patch) continue;
    // Kiosks on the pavement.
    const kiosks = (l / 100) * 0.45 * (patch.spec.kiosks ?? (palette === 'core' || palette === 'bayfront' || palette === 'station' ? 0.5 : 0.15));
    const kioskCount = Math.floor(kiosks + rngFloat(rng));
    for (let i = 0; i < kioskCount; i++) {
      const p = at(rngRange(rng, 8, Math.max(9, l - 8)), half + 2.4);
      put(f, 'kiosk', p.x, p.z, turnDir(along, side > 0 ? 32 : -32));
    }
    // A hydrant near the corner and a bench here and there in the homely streets.
    if (palette !== null && HOMELY.includes(palette)) {
      if (rngChance(rng, 0.22)) {
        const p = at(9, half + 0.9);
        put(f, 'hydrant', p.x, p.z, 0);
      }
      if (rngChance(rng, 0.1)) {
        const p = at(rngRange(rng, 0.3, 0.7) * l, half + 1.6);
        put(f, 'bench', p.x, p.z, turnDir(along, side > 0 ? 32 : -32));
      }
    }
  }
}

/** Traffic lights where an avenue meets other streets. */
function furnishJunctions(f: Furnisher, nodes: readonly Vec2[]): void {
  for (let n = 0; n < nodes.length; n++) {
    const list = f.nodeStreets[n];
    if (list.length < 3) continue;
    let avenues = 0;
    let half = 0;
    for (const id of list) {
      const s = f.b.streets[id];
      if (s.spec.kind === 'avenue') avenues++;
      if (s.spec.kind !== 'bridge' && s.spec.width / 2 > half) half = s.spec.width / 2;
    }
    // Where avenues cross, and where a street crosses an avenue (not at every side turning).
    if (avenues < 3 && !(avenues >= 2 && list.length >= 4)) continue;
    // Along the first street's direction, at two opposite corners.
    const s = f.b.streets[list[0]];
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const l = len(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    const off = half + 1.3;
    const p = nodes[n];
    put(f, 'trafficlight', p.x + ux * off - uz * off, p.z + uz * off + ux * off, nearestDir(-ux, -uz));
    put(f, 'trafficlight', p.x - ux * off + uz * off, p.z - uz * off - ux * off, nearestDir(ux, uz));
  }
}

function polygonBounds(polygon: readonly Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number; area: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let twice = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p = polygon[i];
    const q = polygon[j];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    twice += q.x * p.z - p.x * q.z;
  }
  return { minX, maxX, minZ, maxZ, area: Math.abs(twice) / 2 };
}

/** Trees and benches in the parks; kiosks, benches, lamps and a few trees on the plazas. */
function furnishAreas(f: Furnisher, areas: readonly Area[], seed: number): void {
  for (const area of areas) {
    if (area.kind === 'water') continue;
    const rng = createRng(hash32(seed, 503, area.id));
    const bounds = polygonBounds(area.polygon);
    const want = area.kind === 'park' ? G_PARK : G_PLAZA;
    const scatter = (kind: () => PropKindId, count: number, inset: number): void => {
      for (let i = 0; i < count; i++) {
        // A few tries each: the polygon may be far from filling its bounds.
        for (let tries = 0; tries < 4; tries++) {
          const x = rngRange(rng, bounds.minX + inset, bounds.maxX - inset);
          const z = rngRange(rng, bounds.minZ + inset, bounds.maxZ - inset);
          const dir = rngInt(rng, 4) * 32;
          if (!pointInPolygon(x, z, area.polygon) || groundAt(f.b.g, x, z) !== want) continue;
          if (put(f, kind(), x, z, dir)) break;
        }
      }
    };
    const thin = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) < 30;
    const inset = thin ? 2 : 4;
    if (area.kind === 'park') {
      scatter(() => (rngChance(rng, 0.5) ? 'tree_a' : 'tree_b'), Math.round(bounds.area / 260), inset);
      scatter(() => 'bench', Math.max(2, Math.round(bounds.area / 900)), inset);
      scatter(() => 'lamp', Math.max(1, Math.round(bounds.area / 1800)), inset);
      scatter(() => 'kiosk', bounds.area > 3000 ? 2 : 1, inset);
    } else {
      scatter(() => 'kiosk', Math.min(8, Math.max(2, Math.round(bounds.area / 700))), inset);
      scatter(() => 'bench', Math.min(10, Math.max(2, Math.round(bounds.area / 520))), inset);
      scatter(() => 'lamp', Math.min(8, Math.max(2, Math.round(bounds.area / 800))), inset);
      scatter(() => (rngChance(rng, 0.5) ? 'tree_a' : 'tree_b'), Math.min(12, Math.round(bounds.area / 800)), inset);
    }
  }
}

/** A tree in the back garden and now and then a car in the drive. */
function furnishGardens(f: Furnisher, seed: number): void {
  const b = f.b;
  for (let id = 0; id < b.structures.length; id++) {
    const s = b.structures[id];
    if (s.cls !== 'house') continue;
    const patch = patchAt(b.patches, s.x, s.z);
    if (!patch || !GARDENS.includes(patch.spec.palette)) continue;
    const rng = createRng(hash32(seed, 601, id));
    const box = b.boxes[id];
    const fx = DIR_SIN[box.dir];
    const fz = DIR_COS[box.dir];
    // Local +X of the box is (cos, -sin).
    const sx = DIR_COS[box.dir];
    const sz = -DIR_SIN[box.dir];
    if (rngChance(rng, 0.2)) {
      const back = box.hz + rngRange(rng, 3, 6);
      const slide = rngRange(rng, -box.hx, box.hx);
      put(f, rngChance(rng, 0.5) ? 'tree_a' : 'tree_b', s.x - fx * back + sx * slide, s.z - fz * back + sz * slide, 0);
    }
    if (rngChance(rng, 0.16)) {
      const side = rngChance(rng, 0.5) ? 1 : -1;
      const out = box.hx + 2.3;
      put(f, rngChance(rng, 0.75) ? 'car_sedan' : 'car_van', s.x + sx * out * side + fx * (box.hz - 2.5), s.z + sz * out * side + fz * (box.hz - 2.5), box.dir);
    }
  }
}

/** Trees along both banks of the river. */
function furnishBanks(f: Furnisher, river: River, seed: number): void {
  const rng = createRng(hash32(seed, 701));
  const walk = (bank: readonly Vec2[], center: readonly Vec2[]): void => {
    let carry = 0;
    for (let i = 0; i + 1 < bank.length; i++) {
      const a = bank[i];
      const c = bank[i + 1];
      const l = len(c.x - a.x, c.z - a.z);
      if (l === 0) continue;
      // Away from the water: from the center line through the bank.
      const ox = a.x - center[i].x;
      const oz = a.z - center[i].z;
      const ol = len(ox, oz);
      for (let t = carry; t < l; t += 44) {
        const off = rngRange(rng, 5, 9);
        const x = a.x + ((c.x - a.x) * t) / l + (ox / ol) * off;
        const z = a.z + ((c.z - a.z) * t) / l + (oz / ol) * off;
        if (groundAt(f.b.g, x, z) === G_LAND || groundAt(f.b.g, x, z) === G_PARK) {
          put(f, rngChance(rng, 0.5) ? 'tree_a' : 'tree_b', x, z, 0);
        }
      }
      carry = (carry + 44 * Math.ceil((l - carry) / 44) - l) % 44;
    }
  };
  walk(river.bankWest, river.center);
  walk(river.bankEast, river.center);
}

export function furnish(b: Builder, nodes: readonly Vec2[], nodeStreets: number[][], areas: readonly Area[], river: River, seed: number): Prop[] {
  const occCols = Math.ceil((b.half * 2) / OCC_CELL);
  const f: Furnisher = { b, props: [], occ: new Uint8Array(occCols * occCols), occCols, nodeStreets };
  furnishJunctions(f, nodes);
  for (const s of b.streets) furnishStreet(f, s, seed);
  furnishAreas(f, areas, seed);
  furnishGardens(f, seed);
  furnishBanks(f, river, seed);
  return f.props;
}
