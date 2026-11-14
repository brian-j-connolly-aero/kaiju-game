/**
 * A lot on a street front for one particular building: the special buildings (specials.ts) and
 * the diner, the motel and the firehouse of every starting neighborhood (starts.ts). Every lot
 * along the streets near an area is looked at, a few meters apart on both sides, its front at the
 * street's clearance plus a setback, and scored by the caller; then the best lots are tried in
 * turn until one passes every check. Placed before the street fronts are filled in, so the houses
 * fill in around it.
 *
 * Exact arithmetic only (see generate.ts): directions are table indexes, coordinates are snapped
 * to 1/8 m, and the best lot is picked by a plain scan (no engine sort).
 */

import type { ArchetypeDef } from '../archetypes';
import * as BUILD from './build';
import type { Builder, Street } from './build';
import { DIR_COS, DIR_SIN, nearestDir } from './dirs';
import { hash32 } from '../../math/rng';
import * as GEO from './geo';
import type { Box } from './geo';
import { boxOnGround } from './ground';
import { BUILD_LIMIT } from './layout';

// The functions the hot loops call, read once into this module: under the module loaders the
// game and its tests run in, every read of an imported binding goes through a getter.
const { addStructure, clearOfBuildings, clearOfStreets, SHORE, streetClearance, TALL, TALL_SETBACK } = BUILD;
const { distSqPointSeg, len, quant } = GEO;

/** The heading table, read once into this module (a read of the imported binding costs more in the hot loops). */
const COS: readonly number[] = DIR_COS;
const SIN: readonly number[] = DIR_SIN;

export interface FrontSearch {
  a: ArchetypeDef;
  /** Lots whose middle lies within `reach` meters of (cx, cz) are looked at. */
  cx: number;
  cz: number;
  reach: number;
  /** Which streets (ones without lots, bridges, fords and back lanes are never looked at). */
  street: (s: Street) => boolean;
  /** Meters behind the street's clearance (plus half a meter, and TALL_SETBACK for a building over TALL). */
  setback: number;
  /** Lots every this many meters along a street. */
  step: number;
  /**
   * Lower is better; a negative score leaves the lot out. (x, z) is the box's middle, `d` its
   * distance from (cx, cz), `key` a number that tells the street and its side apart (for a
   * jitter), `at` meters along the street.
   */
  score: (x: number, z: number, d: number, key: number, at: number) => number;
  /** Checks on a lot's box before the usual ones (clear of the streets, on land, clear of other buildings). */
  accept: (box: Box) => boolean;
  /** Clear ground kept round it. */
  gap: number;
  /** At most this many lots are tried, best first. */
  tries: number;
}

/** The heading a lot on each side of each street faces (worked out once per builder: the table search is not cheap). */
const facings = new WeakMap<Builder, Int32Array>();

/** Candidate lots, as parallel arrays (no garbage: there are thousands). */
let lotX: Float64Array = new Float64Array(4096);
let lotZ: Float64Array = new Float64Array(4096);
let lotScore: Float64Array = new Float64Array(4096);
let lotDir: Int32Array = new Int32Array(4096);
let lotCount = 0;

function pushLot(x: number, z: number, dir: number, score: number): void {
  if (lotCount === lotX.length) {
    const grow = (a: Float64Array): Float64Array => {
      const b = new Float64Array(a.length * 2);
      b.set(a);
      return b;
    };
    lotX = grow(lotX);
    lotZ = grow(lotZ);
    lotScore = grow(lotScore);
    const d = new Int32Array(lotDir.length * 2);
    d.set(lotDir);
    lotDir = d;
  }
  lotX[lotCount] = x;
  lotZ[lotCount] = z;
  lotDir[lotCount] = dir;
  lotScore[lotCount] = score;
  lotCount++;
}

/** True when lot i comes before lot j: lower score, then lower x, then lower z, then found first. */
function before(i: number, j: number): boolean {
  const a = lotScore[i];
  const b = lotScore[j];
  if (a !== b) return a < b;
  if (lotX[i] !== lotX[j]) return lotX[i] < lotX[j];
  if (lotZ[i] !== lotZ[j]) return lotZ[i] < lotZ[j];
  return i < j;
}

let heap: Int32Array = new Int32Array(4096);
let heapSize = 0;

function siftDown(at: number): void {
  let k = at;
  for (;;) {
    const l = k * 2 + 1;
    if (l >= heapSize) return;
    const r = l + 1;
    const c = r < heapSize && before(heap[r], heap[l]) ? r : l;
    if (!before(heap[c], heap[k])) return;
    const t = heap[c];
    heap[c] = heap[k];
    heap[k] = t;
    k = c;
  }
}

function heapBuild(): void {
  if (heap.length < lotCount) heap = new Int32Array(lotX.length);
  heapSize = lotCount;
  for (let i = 0; i < lotCount; i++) heap[i] = i;
  for (let i = (heapSize >> 1) - 1; i >= 0; i--) siftDown(i);
}

/** The best lot left, taken off the heap; -1 when none is. */
function heapPop(): number {
  if (heapSize === 0) return -1;
  const top = heap[0];
  heapSize--;
  heap[0] = heap[heapSize];
  siftDown(0);
  return top;
}

const box: Box = { x: 0, z: 0, hx: 0, hz: 0, dir: 0 };

/** Finds the best lot that passes every check and builds there. Returns its box, or null when none does. */
export function placeOnFront(b: Builder, q: FrontSearch): Box | null {
  const a = q.a;
  const w = a.footprint[0];
  const d = a.footprint[1];
  const tall = a.height > TALL ? TALL_SETBACK : 0;
  let faces = facings.get(b);
  if (!faces || faces.length < b.streets.length * 2) {
    faces = new Int32Array(b.streets.length * 2).fill(-1);
    facings.set(b, faces);
  }
  lotCount = 0;
  for (const s of b.streets) {
    if (!s.spec.lots || s.spec.kind === 'bridge' || s.spec.ford || s.spec.lane) continue;
    const front = streetClearance(s.spec) + 0.5 + q.setback + tall;
    // A street further from (cx, cz) than the reach and a lot's depth cannot have a lot in reach.
    const far = q.reach + front + d + w;
    if (distSqPointSeg(q.cx, q.cz, s.ax, s.az, s.bx, s.bz) > far * far) continue;
    if (!q.street(s)) continue;
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const l = len(dx, dz);
    if (l < w + 4) continue;
    const ux = dx / l;
    const uz = dz / l;
    for (let side = -1; side <= 1; side += 2) {
      const nx = -uz * side;
      const nz = ux * side;
      const fi = s.id * 2 + (side + 1) / 2;
      let facing = faces[fi];
      if (facing < 0) {
        facing = nearestDir(-nx, -nz);
        faces[fi] = facing;
      }
      const fx = SIN[facing];
      const fz = COS[facing];
      const key = hash32(s.id, side + 1);
      for (let at = 2; at <= l - w - 2; at += q.step) {
        const mx = s.ax + ux * (at + w / 2) + nx * front;
        const mz = s.az + uz * (at + w / 2) + nz * front;
        const x = quant(mx - fx * (d / 2));
        const z = quant(mz - fz * (d / 2));
        const dist = len(x - q.cx, z - q.cz);
        if (dist > q.reach) continue;
        const score = q.score(x, z, dist, key, at);
        if (score >= 0) pushLot(x, z, facing, score);
      }
    }
  }
  // Best first: each try takes the best lot not tried yet (ties by position, then by the order
  // they were found in), off a binary heap written out here (no engine sort).
  heapBuild();
  const tries = Math.min(lotCount, q.tries);
  for (let i = 0; i < tries; i++) {
    const bi = heapPop();
    if (bi < 0) break;
    box.x = lotX[bi];
    box.z = lotZ[bi];
    box.hx = w / 2;
    box.hz = d / 2;
    box.dir = lotDir[bi];
    if (!q.accept(box)) continue;
    if (!clearOfStreets(b, box, tall)) continue;
    if (!boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT)) continue;
    if (!clearOfBuildings(b, box, q.gap)) continue;
    const placed: Box = { x: box.x, z: box.z, hx: box.hx, hz: box.hz, dir: box.dir };
    addStructure(b, a, placed);
    return placed;
  }
  return null;
}
