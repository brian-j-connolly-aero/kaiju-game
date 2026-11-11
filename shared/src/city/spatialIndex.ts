/**
 * Spatial index over the static city, plus the queries the simulation needs.
 *
 * Two layers:
 * - CityIndex: built once from CityData. Uniform grids of structures and props, cached
 *   per-structure trigonometry, and a ground raster (water, park, plaza). Immutable apart from
 *   a visit-stamp scratch array, so one index can serve every World in a process.
 * - CityQuery: an index plus the live state of one match (structure hp, live props). All
 *   queries take a CityQuery; "standing" means hp > 0. The server builds one over the World's
 *   arrays, the client builds one over its mirrored copy for movement prediction.
 *
 * Queries do not allocate: results go into caller-supplied arrays or result objects.
 */

import { bitGet, createBitset } from '../math/bits';
import {
  castBoxCS,
  circleVsBoxCS,
  createCastHit,
  distSqPointBoxCS,
  type CastHit,
  type Contact,
} from '../math/geom';
import type { Vec2, Vec3 } from '../math/vec';
import { PROP_KINDS } from './props';
import { GROUND_KINDS, type CityData, type GroundKind } from './types';

/** Side of a structure or prop grid cell, meters. */
export const INDEX_CELL = 40;
/** Side of a ground raster cell, meters. */
export const GROUND_CELL = 4;

export const GROUND_LAND = 0;
export const GROUND_WATER = 1;
export const GROUND_PARK = 2;
export const GROUND_PLAZA = 3;

export interface CityIndex {
  city: CityData;
  half: number;
  /** Grid cells per side. */
  cols: number;
  /** Structure ids per cell, in compressed rows: items of cell c are cellItems[cellStart[c] .. cellStart[c + 1]). */
  cellStart: Uint32Array;
  cellItems: Uint32Array;
  /** Per-structure geometry, indexed by structure id. */
  sx: Float64Array;
  sz: Float64Array;
  shx: Float64Array;
  shz: Float64Array;
  scos: Float64Array;
  ssin: Float64Array;
  sheight: Float64Array;
  spassable: Uint8Array;
  /** Prop ids per cell, same layout. */
  propCellStart: Uint32Array;
  propCellItems: Uint32Array;
  px: Float64Array;
  pz: Float64Array;
  pradius: Float64Array;
  /** Ground raster: one GROUND_* code per GROUND_CELL square, row-major (z rows, x columns). */
  groundCols: number;
  ground: Uint8Array;
  /** Scratch for de-duplicating structures that span several cells. */
  stamp: Uint32Array;
  stampNow: number;
}

/** The live, per-match part of the city. */
export interface CityState {
  /** Current hp per structure id; 0 means rubble. */
  structureHp: Float32Array;
  /** Bitset of props that are still standing. */
  propAlive: Uint8Array;
}

export interface CityQuery extends CityState {
  index: CityIndex;
}

/** A cast result against the city: the usual hit plus which structure was hit. */
export interface CityCastHit extends CastHit {
  structure: number;
}

export function createCityCastHit(): CityCastHit {
  return { t: 0, nx: 0, ny: 0, nz: 0, structure: -1 };
}

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

function cellOf(index: { half: number; cols: number }, v: number): number {
  const c = Math.floor((v + index.half) / INDEX_CELL);
  return c < 0 ? 0 : c >= index.cols ? index.cols - 1 : c;
}

export function buildCityIndex(city: CityData): CityIndex {
  const half = city.half;
  const cols = Math.ceil((half * 2) / INDEX_CELL);
  const cellCount = cols * cols;
  const n = city.structures.length;
  const grid = { half, cols };

  const sx = new Float64Array(n);
  const sz = new Float64Array(n);
  const shx = new Float64Array(n);
  const shz = new Float64Array(n);
  const scos = new Float64Array(n);
  const ssin = new Float64Array(n);
  const sheight = new Float64Array(n);
  const spassable = new Uint8Array(n);
  // Cell ranges per structure: [c0, r0, c1, r1].
  const ranges = new Int32Array(n * 4);
  const counts = new Uint32Array(cellCount + 1);

  for (let i = 0; i < n; i++) {
    const s = city.structures[i];
    if (s.id !== i) throw new Error(`structure at index ${i} has id ${s.id}`);
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    sx[i] = s.x;
    sz[i] = s.z;
    shx[i] = s.hx;
    shz[i] = s.hz;
    scos[i] = c;
    ssin[i] = sn;
    sheight[i] = s.height;
    spassable[i] = s.passable ? 1 : 0;
    const ex = s.hx * Math.abs(c) + s.hz * Math.abs(sn);
    const ez = s.hx * Math.abs(sn) + s.hz * Math.abs(c);
    const c0 = cellOf(grid, s.x - ex);
    const c1 = cellOf(grid, s.x + ex);
    const r0 = cellOf(grid, s.z - ez);
    const r1 = cellOf(grid, s.z + ez);
    ranges[i * 4] = c0;
    ranges[i * 4 + 1] = r0;
    ranges[i * 4 + 2] = c1;
    ranges[i * 4 + 3] = r1;
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) counts[r * cols + cc + 1]++;
  }
  for (let i = 0; i < cellCount; i++) counts[i + 1] += counts[i];
  const cellStart = counts.slice();
  const cellItems = new Uint32Array(cellStart[cellCount]);
  const cursor = cellStart.slice(0, cellCount);
  for (let i = 0; i < n; i++) {
    for (let r = ranges[i * 4 + 1]; r <= ranges[i * 4 + 3]; r++) {
      for (let cc = ranges[i * 4]; cc <= ranges[i * 4 + 2]; cc++) {
        cellItems[cursor[r * cols + cc]++] = i;
      }
    }
  }

  const pn = city.props.length;
  const px = new Float64Array(pn);
  const pz = new Float64Array(pn);
  const pradius = new Float64Array(pn);
  const pcounts = new Uint32Array(cellCount + 1);
  const pcell = new Uint32Array(pn);
  for (let i = 0; i < pn; i++) {
    const p = city.props[i];
    if (p.id !== i) throw new Error(`prop at index ${i} has id ${p.id}`);
    px[i] = p.x;
    pz[i] = p.z;
    pradius[i] = PROP_KINDS[p.kind].radius;
    const c = cellOf(grid, p.z) * cols + cellOf(grid, p.x);
    pcell[i] = c;
    pcounts[c + 1]++;
  }
  for (let i = 0; i < cellCount; i++) pcounts[i + 1] += pcounts[i];
  const propCellStart = pcounts.slice();
  const propCellItems = new Uint32Array(pn);
  const pcursor = propCellStart.slice(0, cellCount);
  for (let i = 0; i < pn; i++) propCellItems[pcursor[pcell[i]]++] = i;

  const groundCols = Math.ceil((half * 2) / GROUND_CELL);
  const ground = new Uint8Array(groundCols * groundCols);
  // Later kinds win where areas overlap: water over park over plaza.
  const order: Array<[string, number]> = [
    ['plaza', GROUND_PLAZA],
    ['park', GROUND_PARK],
    ['water', GROUND_WATER],
  ];
  for (const [kind, code] of order) {
    for (const area of city.areas) {
      if (area.kind === kind) rasterizePolygon(ground, groundCols, half, area.polygon, code);
    }
  }

  return {
    city,
    half,
    cols,
    cellStart,
    cellItems,
    sx,
    sz,
    shx,
    shz,
    scos,
    ssin,
    sheight,
    spassable,
    propCellStart,
    propCellItems,
    px,
    pz,
    pradius,
    groundCols,
    ground,
    stamp: new Uint32Array(n),
    stampNow: 0,
  };
}

/** Even-odd scanline fill of a simple polygon into the ground raster, sampling cell centers. */
function rasterizePolygon(ground: Uint8Array, cols: number, half: number, polygon: readonly Vec2[], code: number): void {
  const n = polygon.length;
  if (n < 3) return;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of polygon) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const r0 = Math.max(0, Math.floor((minZ + half) / GROUND_CELL));
  const r1 = Math.min(cols - 1, Math.floor((maxZ + half) / GROUND_CELL));
  const crossings: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const zc = -half + (r + 0.5) * GROUND_CELL;
    crossings.length = 0;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      if (a.z <= zc === b.z <= zc) continue;
      crossings.push(a.x + ((zc - a.z) / (b.z - a.z)) * (b.x - a.x));
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      // Cells whose center x lies in [crossings[k], crossings[k + 1]).
      const c0 = Math.max(0, Math.ceil((crossings[k] + half) / GROUND_CELL - 0.5));
      const c1 = Math.min(cols - 1, Math.ceil((crossings[k + 1] + half) / GROUND_CELL - 0.5) - 1);
      for (let c = c0; c <= c1; c++) ground[r * cols + c] = code;
    }
  }
}

/** Fresh live state for a city: every structure at full hp, every prop alive. */
export function createCityState(city: CityData): CityState {
  const structureHp = new Float32Array(city.structures.length);
  for (let i = 0; i < structureHp.length; i++) structureHp[i] = city.structures[i].hp;
  return { structureHp, propAlive: createBitset(city.props.length, true) };
}

export function createCityQuery(index: CityIndex, state: CityState): CityQuery {
  return { index, structureHp: state.structureHp, propAlive: state.propAlive };
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

function nextStamp(index: CityIndex): number {
  index.stampNow++;
  if (index.stampNow >= 0xffffffff) {
    index.stamp.fill(0);
    index.stampNow = 1;
  }
  return index.stampNow;
}

export function isStanding(q: CityQuery, structureId: number): boolean {
  return q.structureHp[structureId] > 0;
}

/**
 * Structures whose footprint overlaps the circle (x, z, r). Writes their ids to `out` (cleared
 * first) and returns how many. By default only standing structures; pass false to include rubble.
 */
export function structuresInCircle(
  q: CityQuery,
  x: number,
  z: number,
  r: number,
  out: number[],
  standingOnly = true,
): number {
  out.length = 0;
  const idx = q.index;
  const now = nextStamp(idx);
  const c0 = cellOf(idx, x - r);
  const c1 = cellOf(idx, x + r);
  const r0 = cellOf(idx, z - r);
  const r1 = cellOf(idx, z + r);
  const r2 = r * r;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell = row * idx.cols + col;
      for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
        const id = idx.cellItems[k];
        if (idx.stamp[id] === now) continue;
        idx.stamp[id] = now;
        if (standingOnly && q.structureHp[id] <= 0) continue;
        const d2 = distSqPointBoxCS(x, z, idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id]);
        if (d2 < r2) out.push(id);
      }
    }
  }
  return out.length;
}

/** True when the circle overlaps any standing structure at least `minHeight` tall. */
export function circleHitsStructure(q: CityQuery, x: number, z: number, r: number, minHeight = 0): boolean {
  const idx = q.index;
  const c0 = cellOf(idx, x - r);
  const c1 = cellOf(idx, x + r);
  const r0 = cellOf(idx, z - r);
  const r1 = cellOf(idx, z + r);
  const r2 = r * r;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell = row * idx.cols + col;
      for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
        const id = idx.cellItems[k];
        if (q.structureHp[id] <= 0 || idx.sheight[id] < minHeight) continue;
        const d2 = distSqPointBoxCS(x, z, idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id]);
        if (d2 < r2) return true;
      }
    }
  }
  return false;
}

/** Push-out contact between a circle and one structure's footprint (ignores hp and height). */
export function structureContact(
  index: CityIndex,
  structureId: number,
  x: number,
  z: number,
  r: number,
  out?: Contact,
): boolean {
  return circleVsBoxCS(
    x,
    z,
    r,
    index.sx[structureId],
    index.sz[structureId],
    index.shx[structureId],
    index.shz[structureId],
    index.scos[structureId],
    index.ssin[structureId],
    out,
  );
}

/** Distance from a point to a structure's footprint (0 inside). */
export function distToStructure(index: CityIndex, structureId: number, x: number, z: number): number {
  return Math.sqrt(
    distSqPointBoxCS(
      x,
      z,
      index.sx[structureId],
      index.sz[structureId],
      index.shx[structureId],
      index.shz[structureId],
      index.scos[structureId],
      index.ssin[structureId],
    ),
  );
}

/**
 * Id of a structure whose footprint contains the point, or -1. With `standingOnly` false it also
 * finds rubble (to tell whether a shot landed on wrecked ground).
 */
export function structureAt(q: CityQuery, x: number, z: number, standingOnly = true): number {
  const idx = q.index;
  if (x < -idx.half || x > idx.half || z < -idx.half || z > idx.half) return -1;
  const cell = cellOf(idx, z) * idx.cols + cellOf(idx, x);
  for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
    const id = idx.cellItems[k];
    if (standingOnly && q.structureHp[id] <= 0) continue;
    if (distSqPointBoxCS(x, z, idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id]) === 0) {
      return id;
    }
  }
  return -1;
}

/**
 * Live props the circle (x, z, r) reaches (center distance under r + the prop's crush radius).
 * Writes their ids to `out` (cleared first) and returns how many. Pass false to include dead props.
 */
export function propsInCircle(q: CityQuery, x: number, z: number, r: number, out: number[], aliveOnly = true): number {
  out.length = 0;
  const idx = q.index;
  // Props are bucketed by their center, so widen the search by the largest crush radius.
  const reach = r + MAX_PROP_RADIUS;
  const c0 = cellOf(idx, x - reach);
  const c1 = cellOf(idx, x + reach);
  const r0 = cellOf(idx, z - reach);
  const r1 = cellOf(idx, z + reach);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell = row * idx.cols + col;
      for (let k = idx.propCellStart[cell]; k < idx.propCellStart[cell + 1]; k++) {
        const id = idx.propCellItems[k];
        if (aliveOnly && !bitGet(q.propAlive, id)) continue;
        const dx = idx.px[id] - x;
        const dz = idx.pz[id] - z;
        const rr = r + idx.pradius[id];
        if (dx * dx + dz * dz < rr * rr) out.push(id);
      }
    }
  }
  return out.length;
}

const MAX_PROP_RADIUS = Math.max(...Object.values(PROP_KINDS).map((k) => k.radius));

const scratchHit: CastHit = createCastHit();

/**
 * Casts origin + dir * t, t in [0, tMax], against every standing structure (as a box prism from
 * the ground to its height) and reports the nearest hit. `ignore` skips one structure id.
 */
function castPath(
  q: CityQuery,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  out: CityCastHit | undefined,
  ignore: number,
): boolean {
  const idx = q.index;
  const half = idx.half;

  // Clip the path to the city square: there is nothing to hit outside it.
  let t0 = 0;
  let t1 = tMax;
  if (dx === 0) {
    if (ox < -half || ox > half) return false;
  } else {
    const a = (-half - ox) / dx;
    const b = (half - ox) / dx;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (dz === 0) {
    if (oz < -half || oz > half) return false;
  } else {
    const a = (-half - oz) / dz;
    const b = (half - oz) / dz;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 > t1) return false;

  let cx = cellOf(idx, ox + dx * t0);
  let cz = cellOf(idx, oz + dz * t0);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? INDEX_CELL / Math.abs(dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? INDEX_CELL / Math.abs(dz) : Infinity;
  let tNextX = stepX > 0 ? ((cx + 1) * INDEX_CELL - half - ox) / dx : stepX < 0 ? (cx * INDEX_CELL - half - ox) / dx : Infinity;
  let tNextZ = stepZ > 0 ? ((cz + 1) * INDEX_CELL - half - oz) / dz : stepZ < 0 ? (cz * INDEX_CELL - half - oz) / dz : Infinity;

  const now = nextStamp(idx);
  let best = Infinity;
  let bestId = -1;
  let bnx = 0;
  let bny = 0;
  let bnz = 0;

  for (;;) {
    const cell = cz * idx.cols + cx;
    for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
      const id = idx.cellItems[k];
      if (idx.stamp[id] === now) continue;
      idx.stamp[id] = now;
      if (id === ignore || q.structureHp[id] <= 0) continue;
      const hit = castBoxCS(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        tMax,
        idx.sx[id],
        idx.sz[id],
        idx.shx[id],
        idx.shz[id],
        idx.scos[id],
        idx.ssin[id],
        0,
        idx.sheight[id],
        scratchHit,
      );
      if (hit && scratchHit.t < best) {
        best = scratchHit.t;
        bestId = id;
        bnx = scratchHit.nx;
        bny = scratchHit.ny;
        bnz = scratchHit.nz;
      }
    }
    const tExit = tNextX < tNextZ ? tNextX : tNextZ;
    if (best <= tExit || tExit > t1) break;
    if (tNextX < tNextZ) {
      cx += stepX;
      tNextX += tDeltaX;
      if (cx < 0 || cx >= idx.cols) break;
    } else {
      cz += stepZ;
      tNextZ += tDeltaZ;
      if (cz < 0 || cz >= idx.cols) break;
    }
  }

  if (bestId < 0) return false;
  if (out) {
    out.t = best;
    out.nx = bnx;
    out.ny = bny;
    out.nz = bnz;
    out.structure = bestId;
  }
  return true;
}

/**
 * Segment a..b against standing structures. On a hit, `out.t` is the fraction along the segment
 * and `out.structure` the structure id. `ignore` skips one structure id (-1 for none).
 */
export function castSegment(q: CityQuery, a: Vec3, b: Vec3, out?: CityCastHit, ignore = -1): boolean {
  return castPath(q, a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, 1, out, ignore);
}

/**
 * Ray against standing structures. `dir` must be a unit vector. On a hit, `out.t` is the distance
 * along the ray and `out.structure` the structure id.
 */
export function castRay(q: CityQuery, origin: Vec3, dir: Vec3, maxDist: number, out?: CityCastHit, ignore = -1): boolean {
  return castPath(q, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, out, ignore);
}

/** True when no standing structure blocks the straight line between two points. */
export function lineOfSight(q: CityQuery, a: Vec3, b: Vec3): boolean {
  return !castPath(q, a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, 1, undefined, -1);
}

/** Raw ground code (GROUND_*) at a point; land outside the city. */
export function groundCodeAt(index: CityIndex, x: number, z: number): number {
  const c = Math.floor((x + index.half) / GROUND_CELL);
  const r = Math.floor((z + index.half) / GROUND_CELL);
  if (c < 0 || r < 0 || c >= index.groundCols || r >= index.groundCols) return GROUND_LAND;
  return index.ground[r * index.groundCols + c];
}

export function groundKindAt(index: CityIndex, x: number, z: number): GroundKind {
  return GROUND_KINDS[groundCodeAt(index, x, z)];
}

/** Id of a standing bridge deck (passable structure) under the point, or -1. */
export function bridgeAt(q: CityQuery, x: number, z: number): number {
  const idx = q.index;
  if (x < -idx.half || x > idx.half || z < -idx.half || z > idx.half) return -1;
  const cell = cellOf(idx, z) * idx.cols + cellOf(idx, x);
  for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
    const id = idx.cellItems[k];
    if (idx.spassable[id] === 0 || q.structureHp[id] <= 0) continue;
    if (distSqPointBoxCS(x, z, idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id]) === 0) {
      return id;
    }
  }
  return -1;
}

/** True when a ground body at this point is wading: it is over water and not on a standing bridge. */
export function inWater(q: CityQuery, x: number, z: number): boolean {
  return groundCodeAt(q.index, x, z) === GROUND_WATER && bridgeAt(q, x, z) < 0;
}
