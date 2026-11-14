/**
 * Back lanes (phase 3, docs/ROADMAP.md: "packed closer together where the match starts"). In a
 * start's stage 1 square every block deep enough gets a lane through its middle, parallel to the
 * streets on its two long sides, from the cross street at one end of the block to the one at the
 * other; garages line it, doors to the lane.
 *
 * A lane is not a street. It is not in the road graph (nothing plans a route along it; units and
 * the monster cross it as open ground), it carries no props, and only the garages front it. It
 * keeps every building LANE_HALF from its middle line, the cross streets' rows included, so its
 * two mouths stay open. The client may draw it as a gravel track (`CityData.lanes`).
 *
 * Found from the street network as it is, whatever its pattern (lattices, rings): a run of tight
 * streets that bends gently from one junction to the next is one side of a block; the street met
 * straight across the block from the run's middle, if it runs nearly parallel and lies
 * LANE_MIN_DEPTH to LANE_MAX_DEPTH away, is the other side. The lane is the run moved half that
 * depth into the block (corners mitred), each end carried on to the cross street. A block found
 * from both sides gets one lane.
 *
 * Exact arithmetic only (see generate.ts): directions are vectors made with Math.sqrt, final
 * coordinates are snapped to 1/8 m.
 */

import { createRng, hash32, rngFloat, rngRange } from '../../math/rng';
import { archetypeDef } from '../archetypes';
import * as BUILD from './build';
import type { Builder } from './build';
import { DIR_COS, DIR_SIN, nearestDir } from './dirs';
import * as GEO from './geo';
import type { Box, SegHit } from './geo';
import { boxOnGround, stripOnGround } from './ground';
import { BUILD_LIMIT } from './layout';
import { LANE_ROW } from './palettes';
import type { RoadSpec } from './roadnet';

// The functions the hot loops call, read once into this module: under the module loaders the
// game and its tests run in, every read of an imported binding goes through a getter.
const { addLane, addStructure, clearOfBuildings, clearOfStreets, inStartSquare, LANE_HALF, patchAt, SHORE } = BUILD;
const { distSqPointSeg, len, quant, segSeg } = GEO;

/** The heading table, read once into this module (a read of the imported binding costs more in the hot loops). */
const COS: readonly number[] = DIR_COS;
const SIN: readonly number[] = DIR_SIN;

/** A block this deep (street middle to street middle) or more gets a lane; deeper than the second, none (a park, a square, open ground). */
export const LANE_MIN_DEPTH = 56;
export const LANE_MAX_DEPTH = 130;
/** The gravel track the client may draw, meters wide (buildings keep LANE_HALF from its middle). */
export const LANE_WIDTH = 6;
/** A run of streets goes on through a junction where one street carries on turning less than this (its cosine: 35 degrees). */
const RUN_TURN_COS = 0.819;
/** The street across the block runs within this of parallel (the sine of 25 degrees). */
const PARALLEL_SIN = 0.423;
/** A lane end is carried on to the cross street over at most this many meters... */
const END_REACH = 22;
/** ...unless it already lies this near the cross street's middle line (inside its roadway's clearance, where no house stands). */
const END_NEAR = 7;
/** The side of a block a lane runs along is at least this many times as long as the block is deep (a lane runs along the long sides). */
const LONG_SIDE = 0.9;
/** A lane is at least this long. */
const MIN_LENGTH = 24;
/** Away from its ends, a lane keeps this far from every other street's middle line (the closes that poke into a block aside). */
const KEEP_CLEAR = 9;

const LANE_SPEC: RoadSpec = {
  name: 'back lane',
  width: LANE_WIDTH,
  kind: 'street',
  lots: false,
  cars: 0,
  ford: false,
  deck: null,
  arterial: false,
  stub: false,
  patch: -1,
  lane: true,
};

const hit: SegHit = { t: 0, u: 0 };
const near: number[] = [];

/** Ids of the streets (lanes too) whose hash cells the rectangle touches, each once. */
function streetsNear(b: Builder, x0: number, z0: number, x1: number, z1: number): number[] {
  near.length = 0;
  const now = ++b.stampNow;
  const cell = 40;
  const c0 = Math.max(0, Math.floor((Math.min(x0, x1) + b.half) / cell));
  const c1 = Math.min(b.cols - 1, Math.floor((Math.max(x0, x1) + b.half) / cell));
  const r0 = Math.max(0, Math.floor((Math.min(z0, z1) + b.half) / cell));
  const r1 = Math.min(b.cols - 1, Math.floor((Math.max(z0, z1) + b.half) / cell));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const id of b.streetCells[r * b.cols + c]) {
        if (b.stamp[id] === now) continue;
        b.stamp[id] = now;
        near.push(id);
      }
    }
  }
  return near;
}

/** The first road street (not a lane, not one of `skip`) a ray from (x, z) along (ux, uz) meets within `reach`: its id and distance, or id -1. */
function rayHit(b: Builder, x: number, z: number, ux: number, uz: number, reach: number, skip: readonly number[], out: { id: number; dist: number }): void {
  const ex = x + ux * reach;
  const ez = z + uz * reach;
  out.id = -1;
  out.dist = Infinity;
  for (const id of streetsNear(b, x, z, ex, ez)) {
    const s = b.streets[id];
    if (s.spec.lane || s.spec.kind === 'bridge' || skip.includes(id)) continue;
    if (!segSeg(x, z, ex, ez, s.ax, s.az, s.bx, s.bz, hit)) continue;
    const d = hit.t * reach;
    if (d < out.dist || (d === out.dist && id < out.id)) {
      out.dist = d;
      out.id = id;
    }
  }
}

/** Squared distance from a point to the nearest road street (not a lane, not a close, not one of `skip`). */
function streetDistSq(b: Builder, x: number, z: number, reach: number, skip: readonly number[]): number {
  let best = Infinity;
  for (const id of streetsNear(b, x - reach, z - reach, x + reach, z + reach)) {
    const s = b.streets[id];
    if (s.spec.lane || s.spec.stub || skip.includes(id)) continue;
    const d = distSqPointSeg(x, z, s.ax, s.az, s.bx, s.bz);
    if (d < best) best = d;
  }
  return best;
}

/** A key for a junction: street ends meet at exactly the same 1/8 m point. */
function nodeKey(x: number, z: number): number {
  return (Math.round(x * 8) + 16384) * 32768 + (Math.round(z * 8) + 16384);
}

interface RunPiece {
  id: number;
  /** The piece walked from (ax, az) to (bx, bz). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/**
 * Plans the back lanes of every start square and adds them to the builder (after the road
 * streets, before any building). Returns how many lane pieces it added.
 */
export function planLanes(b: Builder): number {
  const roads = b.streets.length;
  // The streets at every junction.
  const at = new Map<number, number[]>();
  for (let id = 0; id < roads; id++) {
    const s = b.streets[id];
    for (const key of [nodeKey(s.ax, s.az), nodeKey(s.bx, s.bz)]) {
      const list = at.get(key);
      if (list) list.push(id);
      else at.set(key, [id]);
    }
  }
  const lanes: number[] = [];
  const probe = { id: -1, dist: Infinity };
  for (let side = -1; side <= 1; side += 2) {
    const used = new Uint8Array(roads);
    // From the end (x, z) of `from`, walking along (ux, uz): the piece the run goes on into, or -1.
    // A run is one side of a block: it goes on through a junction when exactly one tight street
    // carries on gently and every other street there leaves on the far side (or is a close).
    const onward = (from: number, x: number, z: number, ux: number, uz: number, sideNow: number): number => {
      const list = at.get(nodeKey(x, z));
      if (!list) return -1;
      const nx = -uz * sideNow;
      const nz = ux * sideNow;
      let next = -1;
      for (const id of list) {
        if (id === from) continue;
        const s = b.streets[id];
        const fromA = s.ax === x && s.az === z;
        const dx = fromA ? s.bx - s.ax : s.ax - s.bx;
        const dz = fromA ? s.bz - s.az : s.az - s.bz;
        const l = len(dx, dz);
        if (l === 0) return -1;
        if ((dx * ux + dz * uz) / l >= RUN_TURN_COS) {
          if (next >= 0 || !s.spec.tight || s.spec.stub || used[id]) return -1;
          next = id;
        } else if (!s.spec.stub && (dx * nx + dz * nz) / l > 0.26) {
          return -1;
        }
      }
      return next;
    };
    for (let id = 0; id < roads; id++) {
      const first = b.streets[id];
      if (!first.spec.tight || first.spec.stub || used[id]) continue;
      // The run through this piece, both ways (pieces kept in walking order, each walked a to b).
      const run: RunPiece[] = [{ id, ax: first.ax, az: first.az, bx: first.bx, bz: first.bz }];
      used[id] = 1;
      for (let dir = 0; dir < 2; dir++) {
        for (;;) {
          const end = dir === 0 ? run[run.length - 1] : run[0];
          const x = dir === 0 ? end.bx : end.ax;
          const z = dir === 0 ? end.bz : end.az;
          const l = len(end.bx - end.ax, end.bz - end.az);
          const sign = dir === 0 ? 1 : -1;
          // Walking backwards, the block's side is the other hand.
          const next = onward(end.id, x, z, (sign * (end.bx - end.ax)) / l, (sign * (end.bz - end.az)) / l, sign * side);
          if (next < 0) break;
          used[next] = 1;
          const s = b.streets[next];
          const fromA = s.ax === x && s.az === z;
          if (dir === 0) run.push(fromA ? { id: next, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz } : { id: next, ax: s.bx, az: s.bz, bx: s.ax, bz: s.az });
          else run.unshift(fromA ? { id: next, ax: s.bx, az: s.bz, bx: s.ax, bz: s.az } : { id: next, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz });
        }
      }
      laneBehind(b, run, side, probe, lanes);
    }
  }
  return lanes.length;
}

/** The lane behind one side of a run of streets, if its block is deep enough and has none yet. */
function laneBehind(b: Builder, run: readonly RunPiece[], side: number, probe: { id: number; dist: number }, lanes: number[]): void {
  // The middle of the run, and the street straight across the block from it.
  let total = 0;
  for (const p of run) total += len(p.bx - p.ax, p.bz - p.az);
  if (total < MIN_LENGTH) return;
  let walked = 0;
  let mid = run[0];
  let t = 0.5;
  for (const p of run) {
    const l = len(p.bx - p.ax, p.bz - p.az);
    if (walked + l >= total / 2) {
      mid = p;
      t = (total / 2 - walked) / l;
      break;
    }
    walked += l;
  }
  const ml = len(mid.bx - mid.ax, mid.bz - mid.az);
  const ux = (mid.bx - mid.ax) / ml;
  const uz = (mid.bz - mid.az) / ml;
  const nx = -uz * side;
  const nz = ux * side;
  const mx = mid.ax + (mid.bx - mid.ax) * t;
  const mz = mid.az + (mid.bz - mid.az) * t;
  const own = run.map((p) => p.id);
  // (From a meter in: a street that leaves the run's middle junction on the other side touches its start.)
  rayHit(b, mx + nx, mz + nz, nx, nz, LANE_MAX_DEPTH, own, probe);
  probe.dist += 1;
  if (probe.id < 0 || probe.dist < LANE_MIN_DEPTH || probe.dist > LANE_MAX_DEPTH) return;
  const across = b.streets[probe.id];
  const al = len(across.bx - across.ax, across.bz - across.az);
  const cross = Math.abs((ux * (across.bz - across.az) - uz * (across.bx - across.ax)) / al);
  if (cross > PARALLEL_SIN) return;
  // A lane runs along a block's long sides, never across it.
  if (total < probe.dist * LONG_SIDE) return;
  const depth = probe.dist / 2;
  // The middle of the lane: already one there (this block seen from its other side)?
  const cx = mx + nx * depth;
  const cz = mz + nz * depth;
  for (const lane of lanes) {
    const s = b.streets[lane];
    if (distSqPointSeg(cx, cz, s.ax, s.az, s.bx, s.bz) < 36) return;
  }
  if (!inStartSquare(b.half, cx, cz)) return;

  // The run moved `depth` into the block: each corner along the mitre of its two pieces.
  const pts: number[] = [];
  for (let i = 0; i <= run.length; i++) {
    const prev = i > 0 ? run[i - 1] : null;
    const next = i < run.length ? run[i] : null;
    const x = next ? next.ax : (prev as RunPiece).bx;
    const z = next ? next.az : (prev as RunPiece).bz;
    let ox = 0;
    let oz = 0;
    for (const p of [prev, next]) {
      if (!p) continue;
      const l = len(p.bx - p.ax, p.bz - p.az);
      ox += (-(p.bz - p.az) / l) * side;
      oz += ((p.bx - p.ax) / l) * side;
    }
    const ol = len(ox, oz);
    if (ol < 1e-9) return;
    ox /= ol;
    oz /= ol;
    // Mitre: the offset along the bisector that keeps `depth` from both pieces.
    const ref = next ?? (prev as RunPiece);
    const rl = len(ref.bx - ref.ax, ref.bz - ref.az);
    const cos = ox * (-(ref.bz - ref.az) / rl) * side + oz * ((ref.bx - ref.ax) / rl) * side;
    if (cos < 0.5) return;
    pts.push(x + (ox * depth) / cos, z + (oz * depth) / cos);
  }
  // Carry each end on to the cross street (a lattice's cross street is a few degrees off square).
  const own2 = [...own, probe.id];
  for (let end = 0; end < 2; end++) {
    const k = end === 0 ? 0 : pts.length - 2;
    const j = end === 0 ? 2 : pts.length - 4;
    const ex = pts[k] - pts[j];
    const ez = pts[k + 1] - pts[j + 1];
    const el = len(ex, ez);
    if (streetDistSq(b, pts[k], pts[k + 1], END_REACH, own2) <= END_NEAR * END_NEAR) continue;
    rayHit(b, pts[k], pts[k + 1], ex / el, ez / el, END_REACH, own2, probe);
    if (probe.id < 0) return;
    pts[k] += (ex / el) * probe.dist;
    pts[k + 1] += (ez / el) * probe.dist;
  }
  // On land all along, and away from its ends clear of every other street.
  let length = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    if (!stripOnGround(b.g, ax, az, bx, bz, LANE_HALF, 0.5, false)) return;
    if (Math.max(Math.abs(ax), Math.abs(az), Math.abs(bx), Math.abs(bz)) > BUILD_LIMIT) return;
    length += len(bx - ax, bz - az);
  }
  if (length < MIN_LENGTH) return;
  let along = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const l = len(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    // (Every 8 m: a street that crosses the lane comes within 4 m of a sample, one alongside it within all of them.)
    for (let s = 0; s <= l; s += 8) {
      const d = along + s;
      if (d < END_REACH || d > length - END_REACH) continue;
      const x = pts[i] + ((pts[i + 2] - pts[i]) * s) / l;
      const z = pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * s) / l;
      if (streetDistSq(b, x, z, KEEP_CLEAR + 1, own2) < KEEP_CLEAR * KEEP_CLEAR) return;
    }
    along += l;
  }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = quant(pts[i]);
    const az = quant(pts[i + 1]);
    const bx = quant(pts[i + 2]);
    const bz = quant(pts[i + 3]);
    if (ax === bx && az === bz) continue;
    lanes.push(addLane(b, ax, az, bx, bz, LANE_SPEC));
  }
}

const box: Box = { x: 0, z: 0, hx: 0, hz: 0, dir: 0 };

/**
 * The garages along both sides of every back lane, doors to the lane (after the street fronts,
 * which have taken the lots they need). Every few garages a passage is left through to the
 * gardens behind, so no garden is walled in.
 */
export function buildLaneRows(b: Builder, seed: number): number {
  const a = archetypeDef(LANE_ROW.a);
  const w = a.footprint[0];
  const d = a.footprint[1];
  let placed = 0;
  for (let id = 0; id < b.streets.length; id++) {
    const s = b.streets[id];
    if (!s.spec.lane) continue;
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const l = len(dx, dz);
    if (l < w + 2) continue;
    // Each start's own share of garages (the knob that helps balance the starts' value).
    const patch = patchAt(b.patches, (s.ax + s.bx) / 2, (s.az + s.bz) / 2);
    const keep = LANE_ROW.keep * (patch?.spec.tight?.garages ?? 1);
    const ux = dx / l;
    const uz = dz / l;
    for (let side = -1; side <= 1; side += 2) {
      const rng = createRng(hash32(seed, 223, id, side + 1));
      const nx = -uz * side;
      const nz = ux * side;
      const facing = nearestDir(-nx, -nz);
      const fx = SIN[facing];
      const fz = COS[facing];
      const front = LANE_HALF + LANE_ROW.setback;
      let at = rngRange(rng, 0.5, 3);
      let run = 0;
      while (at + w <= l) {
        const roll = rngFloat(rng);
        const gap = rngRange(rng, LANE_ROW.gap[0], LANE_ROW.gap[1]);
        const mx = s.ax + ux * (at + w / 2) + nx * front;
        const mz = s.az + uz * (at + w / 2) + nz * front;
        box.x = quant(mx - fx * (d / 2));
        box.z = quant(mz - fz * (d / 2));
        box.hx = w / 2;
        box.hz = d / 2;
        box.dir = facing;
        const fits = inStartSquare(b.half, box.x, box.z) && clearOfStreets(b, box, 0) && boxOnGround(b.g, box, SHORE, false, BUILD_LIMIT) && clearOfBuildings(b, box, LANE_ROW.gap[0]);
        if (!fits) {
          at += 3;
          continue;
        }
        if (roll < keep) {
          addStructure(b, a, { x: box.x, z: box.z, hx: box.hx, hz: box.hz, dir: box.dir });
          placed++;
          run++;
        }
        at += w + gap;
        if (run >= LANE_ROW.every) {
          at += LANE_ROW.passage - gap;
          run = 0;
        }
      }
    }
  }
  return placed;
}
