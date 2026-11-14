/**
 * Spatial index over the static city, plus the queries the simulation needs.
 *
 * Two layers:
 * - CityIndex: built once from CityData. Uniform grids of structures and props, cached
 *   per-structure trigonometry, and a ground raster (water, park, plaza). Immutable apart from
 *   a visit-stamp scratch array, so one index can serve every World in a process.
 * - CityQuery: an index plus the live state of one match (structure hp, live props, which
 *   structures fell over and which way). All queries take a CityQuery; "standing" means
 *   hp > 0. The server builds one over the World's arrays, the client builds one over its
 *   mirrored copy for movement prediction.
 *
 * Mounds (docs/ROADMAP.md, phase 2: rubble that stays). A structure that collapsed where it
 * stands is a mound over its own footprint, `index.srubble` high (half its height, from its
 * archetype; bridge decks leave none). One that fell over is a long mound where it lies
 * (`fallenBox`): as long as it was tall, as wide as its footprint across the fall, half its
 * depth high. Mounds never block a body (units cross them slowly: `moundHeightAt`; the kaiju
 * walks over them); they block shots and sight up to their height, but only for the casts that
 * ask (`mounds` true: projectiles, aim rays, spotting, lines of fire). A cast that starts inside
 * a mound passes through that one: whoever stands on rubble sees and shoots over it.
 *
 * Queries do not allocate: results go into caller-supplied arrays or result objects.
 */

import { FALL_RULES, RUBBLE_RULES } from '../defs/rubble';
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
  /** Height of the mound a structure leaves when it collapses where it stands (0: none, a bridge deck). */
  srubble: Float64Array;
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
  /**
   * Per structure id: 0 unless it lies fallen over, else 1 + the side it fell toward (`FallSide`).
   * Set when a fall lands (`setStructureFallen`); a fallen structure is rubble (hp 0) whose
   * mound is the long one where it lies, not the one over its footprint.
   */
  structureFall: Uint8Array;
  /** The ids of the structures lying fallen (the queries look at each), in the order they landed. */
  fallen: number[];
}

export interface CityQuery extends CityState {
  index: CityIndex;
}

/**
 * The sides a structure can fall toward, in its own frame: 0 its local +X, 1 local +Z (the
 * front), 2 local -X, 3 local -Z. In the world, local +X is (cos yaw, -sin yaw) and local +Z is
 * (sin yaw, cos yaw), the structure's forward.
 */
export type FallSide = 0 | 1 | 2 | 3;

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
  const srubble = new Float64Array(n);
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
    srubble[i] = s.passable ? 0 : Math.min(RUBBLE_RULES.maxHeight, s.height * RUBBLE_RULES.heightShare);
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
    srubble,
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

/** Fresh live state for a city: every structure at full hp, every prop alive, nothing fallen. */
export function createCityState(city: CityData): CityState {
  const structureHp = new Float32Array(city.structures.length);
  for (let i = 0; i < structureHp.length; i++) structureHp[i] = city.structures[i].hp;
  return {
    structureHp,
    propAlive: createBitset(city.props.length, true),
    structureFall: new Uint8Array(city.structures.length),
    fallen: [],
  };
}

/** A query over an index and a live state. It shares the state's arrays: changes to one are changes to the other. */
export function createCityQuery(index: CityIndex, state: CityState): CityQuery {
  return { index, structureHp: state.structureHp, propAlive: state.propAlive, structureFall: state.structureFall, fallen: state.fallen };
}

// ---------------------------------------------------------------------------------------------
// Fallen structures (docs/ROADMAP.md, phase 2: some tall buildings fall over on their side)
// ---------------------------------------------------------------------------------------------

/** True for a structure slender enough to fall over when it collapses (FALL_RULES.slenderness). Bridge decks never do. */
export function canFallOver(index: CityIndex, id: number): boolean {
  if (index.spassable[id] === 1) return false;
  return index.sheight[id] >= FALL_RULES.slenderness * 2 * Math.max(index.shx[id], index.shz[id]);
}

/** World direction (a unit ground vector) of a fall toward `side` of a structure. */
export function fallSideDir(index: CityIndex, id: number, side: number, out: Vec2): Vec2 {
  const c = index.scos[id];
  const s = index.ssin[id];
  switch (side & 3) {
    case 0:
      out.x = c;
      out.z = -s;
      break;
    case 1:
      out.x = s;
      out.z = c;
      break;
    case 2:
      out.x = -c;
      out.z = s;
      break;
    default:
      out.x = -s;
      out.z = -c;
  }
  return out;
}

/** The side of a structure that faces most nearly along the ground direction (dirX, dirZ): the way it falls when pushed that way. */
export function fallSideToward(index: CityIndex, id: number, dirX: number, dirZ: number): FallSide {
  const c = index.scos[id];
  const s = index.ssin[id];
  // The direction in the structure's own frame (see castBoxCS).
  const lx = dirX * c - dirZ * s;
  const lz = dirX * s + dirZ * c;
  if (Math.abs(lx) >= Math.abs(lz)) return lx >= 0 ? 0 : 2;
  return lz >= 0 ? 1 : 3;
}

/** A mound as a box prism from the ground up to `height`, in the frame of the structure it came from. */
export interface MoundBox {
  /** Center on the ground. */
  x: number;
  z: number;
  /** Half extents along the structure's own X and Z. */
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  height: number;
}

export function createMoundBox(): MoundBox {
  return { x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0, height: 0 };
}

/** Half the footprint's depth along a fall toward `side` (sides 0 and 2 run along its own X). */
function halfDepthAlong(index: CityIndex, id: number, side: number): number {
  return (side & 1) === 0 ? index.shx[id] : index.shz[id];
}

/**
 * Where a structure lies once it has fallen toward `side`: it tipped over the edge of its
 * footprint on that side, so it reaches from that edge out as far as it was tall, as wide as
 * its footprint across the fall, FALL_RULES.lyingHeightShare of its depth along the fall high.
 * Its own footprint is left clear. The box keeps the structure's own frame (its yaw).
 */
export function fallenBox(index: CityIndex, id: number, side: number, out: MoundBox): MoundBox {
  const along = halfDepthAlong(index, id, side);
  const h = index.sheight[id];
  const dir = fallSideDir(index, id, side, scratchDir);
  out.x = index.sx[id] + dir.x * (along + h / 2);
  out.z = index.sz[id] + dir.z * (along + h / 2);
  if ((side & 1) === 0) {
    out.hx = h / 2;
    out.hz = index.shz[id];
  } else {
    out.hx = index.shx[id];
    out.hz = h / 2;
  }
  out.cos = index.scos[id];
  out.sin = index.ssin[id];
  out.height = 2 * along * FALL_RULES.lyingHeightShare;
  return out;
}

/**
 * Where the top of a structure lands when it falls toward `side` (`out`), and where its base
 * pivots (the middle of the footprint's edge on that side, `pivot`, optional).
 */
export function fallTop(index: CityIndex, id: number, side: number, out: Vec2, pivot?: Vec2): Vec2 {
  const along = halfDepthAlong(index, id, side);
  const dir = fallSideDir(index, id, side, scratchDir);
  const h = index.sheight[id];
  if (pivot) {
    pivot.x = index.sx[id] + dir.x * along;
    pivot.z = index.sz[id] + dir.z * along;
  }
  out.x = index.sx[id] + dir.x * (along + h);
  out.z = index.sz[id] + dir.z * (along + h);
  return out;
}

/** Records that a structure now lies fallen toward `side` (the server when a fall lands; a client from the `structureFall` event). */
export function setStructureFallen(state: CityState, id: number, side: number): void {
  if (state.structureFall[id] !== 0) return;
  state.structureFall[id] = (side & 3) + 1;
  state.fallen.push(id);
}

/** The mound a collapsed structure is, wherever it lies: false when it is standing or left none. */
export function moundBox(q: CityQuery, id: number, out: MoundBox): boolean {
  if (q.structureHp[id] > 0) return false;
  const fall = q.structureFall[id];
  if (fall !== 0) {
    fallenBox(q.index, id, fall - 1, out);
    return true;
  }
  const idx = q.index;
  if (!(idx.srubble[id] > 0)) return false;
  out.x = idx.sx[id];
  out.z = idx.sz[id];
  out.hx = idx.shx[id];
  out.hz = idx.shz[id];
  out.cos = idx.scos[id];
  out.sin = idx.ssin[id];
  out.height = idx.srubble[id];
  return true;
}

const scratchDir: Vec2 = { x: 0, z: 0 };
const scratchBox: MoundBox = createMoundBox();

function insideMound(b: MoundBox, x: number, y: number, z: number): boolean {
  return y < b.height && distSqPointBoxCS(x, z, b.x, b.z, b.hx, b.hz, b.cos, b.sin) === 0;
}

/**
 * Height of the mound (rubble, or a fallen structure) under a ground point; 0 when there is
 * none. Units cross mounds at RUBBLE_RULES.unitSpeedMult of their speed (sim/movement.ts).
 */
export function moundHeightAt(q: CityQuery, x: number, z: number): number {
  const idx = q.index;
  let best = 0;
  if (x >= -idx.half && x <= idx.half && z >= -idx.half && z <= idx.half) {
    const cell = cellOf(idx, z) * idx.cols + cellOf(idx, x);
    for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
      const id = idx.cellItems[k];
      if (q.structureHp[id] > 0 || q.structureFall[id] !== 0 || !(idx.srubble[id] > best)) continue;
      if (distSqPointBoxCS(x, z, idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id]) === 0) best = idx.srubble[id];
    }
  }
  for (const id of q.fallen) {
    fallenBox(idx, id, q.structureFall[id] - 1, scratchBox);
    if (scratchBox.height > best && distSqPointBoxCS(x, z, scratchBox.x, scratchBox.z, scratchBox.hx, scratchBox.hz, scratchBox.cos, scratchBox.sin) === 0) {
      best = scratchBox.height;
    }
  }
  return best;
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
 * `skipPassable` leaves out bridge decks: for everything that moves, shoots or looks along the
 * ground a deck is road surface, not a wall (bodies on it stand at ground level, inside its box).
 * `mounds` adds the mounds of collapsed and fallen structures (box prisms up to the mound's
 * height), except any mound the path starts inside.
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
  skipPassable = false,
  mounds = false,
): boolean {
  const idx = q.index;
  const half = idx.half;

  let best = Infinity;
  let bestId = -1;
  let bnx = 0;
  let bny = 0;
  let bnz = 0;

  // Fallen structures first: they lie outside the cells of their own footprint, so the grid does
  // not list them where they are. There are only ever a few dozen.
  if (mounds && q.fallen.length > 0) {
    const ex = ox + dx * tMax;
    const ey = oy + dy * tMax;
    const ez = oz + dz * tMax;
    const minX = Math.min(ox, ex);
    const maxX = Math.max(ox, ex);
    const minZ = Math.min(oz, ez);
    const maxZ = Math.max(oz, ez);
    const minY = Math.min(oy, ey);
    for (let i = 0; i < q.fallen.length; i++) {
      const id = q.fallen[i];
      if (id === ignore) continue;
      const b = fallenBox(idx, id, q.structureFall[id] - 1, scratchBox);
      if (minY >= b.height) continue;
      const rx = b.hx * Math.abs(b.cos) + b.hz * Math.abs(b.sin);
      const rz = b.hx * Math.abs(b.sin) + b.hz * Math.abs(b.cos);
      if (maxX < b.x - rx || minX > b.x + rx || maxZ < b.z - rz || minZ > b.z + rz) continue;
      if (insideMound(b, ox, oy, oz)) continue;
      if (castBoxCS(ox, oy, oz, dx, dy, dz, tMax, b.x, b.z, b.hx, b.hz, b.cos, b.sin, 0, b.height, scratchHit) && scratchHit.t < best) {
        best = scratchHit.t;
        bestId = id;
        bnx = scratchHit.nx;
        bny = scratchHit.ny;
        bnz = scratchHit.nz;
      }
    }
  }

  // Clip the path to the city square: there is nothing else to hit outside it.
  let t0 = 0;
  let t1 = tMax;
  let inSquare = true;
  if (dx === 0) {
    if (ox < -half || ox > half) inSquare = false;
  } else {
    const a = (-half - ox) / dx;
    const b = (half - ox) / dx;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (dz === 0) {
    if (oz < -half || oz > half) inSquare = false;
  } else {
    const a = (-half - oz) / dz;
    const b = (half - oz) / dz;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 > t1) inSquare = false;

  let cx = cellOf(idx, ox + dx * t0);
  let cz = cellOf(idx, oz + dz * t0);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? INDEX_CELL / Math.abs(dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? INDEX_CELL / Math.abs(dz) : Infinity;
  let tNextX = stepX > 0 ? ((cx + 1) * INDEX_CELL - half - ox) / dx : stepX < 0 ? (cx * INDEX_CELL - half - ox) / dx : Infinity;
  let tNextZ = stepZ > 0 ? ((cz + 1) * INDEX_CELL - half - oz) / dz : stepZ < 0 ? (cz * INDEX_CELL - half - oz) / dz : Infinity;

  const now = nextStamp(idx);

  while (inSquare) {
    const cell = cz * idx.cols + cx;
    for (let k = idx.cellStart[cell]; k < idx.cellStart[cell + 1]; k++) {
      const id = idx.cellItems[k];
      if (idx.stamp[id] === now) continue;
      idx.stamp[id] = now;
      if (id === ignore) continue;
      // What a structure is to a cast: its whole box while it stands; once down, the mound over
      // its footprint (when the cast counts mounds, it did not fall over, and the cast does not
      // start on top of it).
      let top = idx.sheight[id];
      if (q.structureHp[id] <= 0) {
        if (!mounds || q.structureFall[id] !== 0 || !(idx.srubble[id] > 0)) continue;
        top = idx.srubble[id];
        if (oy < top && distSqPointBoxCS(ox, oz, idx.sx[id], idx.sz[id], idx.shx[id], idx.shz[id], idx.scos[id], idx.ssin[id]) === 0) continue;
      } else if (skipPassable && idx.spassable[id] === 1) {
        continue;
      }
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
        top,
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
 * and `out.structure` the structure id. `ignore` skips one structure id (-1 for none);
 * `skipPassable` skips every bridge deck (projectiles, sight lines and aim rays pass it);
 * `mounds` counts the mounds of collapsed and fallen structures too (shots and sight: rubble
 * blocks them up to its height; bodies cross it, so movement leaves it out).
 */
export function castSegment(q: CityQuery, a: Vec3, b: Vec3, out?: CityCastHit, ignore = -1, skipPassable = false, mounds = false): boolean {
  return castPath(q, a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, 1, out, ignore, skipPassable, mounds);
}

/**
 * Ray against standing structures (and, with `mounds`, rubble and fallen structures). `dir`
 * must be a unit vector. On a hit, `out.t` is the distance along the ray and `out.structure`
 * the structure id.
 */
export function castRay(
  q: CityQuery,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  out?: CityCastHit,
  ignore = -1,
  skipPassable = false,
  mounds = false,
): boolean {
  return castPath(q, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, out, ignore, skipPassable, mounds);
}

/**
 * True when no standing structure blocks the straight line between two points. With
 * `skipPassable` bridge decks do not count (a unit on a bridge can see and be seen); with
 * `mounds` rubble and fallen structures do (spotting, lines of fire).
 */
export function lineOfSight(q: CityQuery, a: Vec3, b: Vec3, skipPassable = false, mounds = false): boolean {
  return !castPath(q, a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, 1, undefined, -1, skipPassable, mounds);
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
