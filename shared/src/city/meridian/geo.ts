/**
 * Geometry for the Port Meridian generator. Everything here uses only + - * / and Math.sqrt on
 * doubles (plus Math.floor, round, abs, min, max, which are exact), so every result is the same
 * bit pattern in every JavaScript engine. Boxes carry their own cosine and sine, taken from the
 * heading table in dirs.ts, never from Math.cos or Math.sin.
 */

import type { Vec2 } from '../../math/vec';
import { DIR_COS, DIR_SIN } from './dirs';

/** Final coordinates are snapped to this step (1/8 m is exact in binary). */
export const QUANT = 8;

export function quant(v: number): number {
  return Math.round(v * QUANT) / QUANT;
}

/** An oriented rectangle with its heading as a table index. Local +Z (the front) is (sin, cos). */
export interface Box {
  x: number;
  z: number;
  hx: number;
  hz: number;
  dir: number;
}

export function len(dx: number, dz: number): number {
  return Math.sqrt(dx * dx + dz * dz);
}

/** Even-odd test: true when (px, pz) is inside the simple polygon. */
export function pointInPolygon(px: number, pz: number, polygon: readonly Vec2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > pz !== b.z > pz) {
      const x = a.x + ((pz - a.z) / (b.z - a.z)) * (b.x - a.x);
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

/** Squared distance from a point to the segment a..b. */
export function distSqPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return cx * cx + cz * cz;
}

/** Squared distance from a point to the outline of a polygon. */
export function distSqPointPolygonEdge(px: number, pz: number, polygon: readonly Vec2[]): number {
  let best = Infinity;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = distSqPointSeg(px, pz, polygon[j].x, polygon[j].z, polygon[i].x, polygon[i].z);
    if (d < best) best = d;
  }
  return best;
}

export interface SegHit {
  /** Parameter along the first segment, 0..1. */
  t: number;
  /** Parameter along the second segment, 0..1. */
  u: number;
}

/**
 * Proper intersection of segments a..b and c..d. Returns false for parallel segments. The
 * parameters are written to `out` (both within 0..1 when it returns true).
 */
export function segSeg(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
  out: SegHit,
): boolean {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (den === 0) return false;
  const qx = cx - ax;
  const qz = cz - az;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return false;
  out.t = t;
  out.u = u;
  return true;
}

/** Squared distance between segments a..b and c..d (0 when they cross). */
export function distSqSegSeg(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segSeg(ax, az, bx, bz, cx, cz, dx, dz, scratchHit)) return 0;
  return Math.min(
    distSqPointSeg(ax, az, cx, cz, dx, dz),
    distSqPointSeg(bx, bz, cx, cz, dx, dz),
    distSqPointSeg(cx, cz, ax, az, bx, bz),
    distSqPointSeg(dx, dz, ax, az, bx, bz),
  );
}

const scratchHit: SegHit = { t: 0, u: 0 };

/** The four corners of a box, into `out` as x0, z0, x1, z1, ... (local -x-z, +x-z, +x+z, -x+z). */
export function boxCorners(b: Box, out: number[]): number[] {
  const c = DIR_COS[b.dir];
  const s = DIR_SIN[b.dir];
  // Local +X is (cos, -sin), local +Z is (sin, cos).
  const xx = c * b.hx;
  const xz = -s * b.hx;
  const zx = s * b.hz;
  const zz = c * b.hz;
  out[0] = b.x - xx - zx;
  out[1] = b.z - xz - zz;
  out[2] = b.x + xx - zx;
  out[3] = b.z + xz - zz;
  out[4] = b.x + xx + zx;
  out[5] = b.z + xz + zz;
  out[6] = b.x - xx + zx;
  out[7] = b.z - xz + zz;
  return out;
}

/** Half extents of the axis-aligned rectangle around a box. */
export function boxExtentX(b: Box): number {
  return b.hx * Math.abs(DIR_COS[b.dir]) + b.hz * Math.abs(DIR_SIN[b.dir]);
}

export function boxExtentZ(b: Box): number {
  return b.hx * Math.abs(DIR_SIN[b.dir]) + b.hz * Math.abs(DIR_COS[b.dir]);
}

/** True when two boxes come closer than `gap` (separating axis test on boxes grown by gap / 2 each). */
export function boxesTouch(a: Box, b: Box, gap: number): boolean {
  const ca = DIR_COS[a.dir];
  const sa = DIR_SIN[a.dir];
  const cb = DIR_COS[b.dir];
  const sb = DIR_SIN[b.dir];
  const g = gap / 2;
  const ahx = a.hx + g;
  const ahz = a.hz + g;
  const bhx = b.hx + g;
  const bhz = b.hz + g;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Axes: a's X (ca, -sa) and Z (sa, ca), b's X (cb, -sb) and Z (sb, cb).
  // Dot products between the axes of the two boxes.
  const xx = ca * cb + sa * sb; // aX . bX  (= aZ . bZ)
  const xz = ca * sb - sa * cb; // aX . bZ  (= -(aZ . bX))
  const axx = Math.abs(xx);
  const axz = Math.abs(xz);
  if (Math.abs(dx * ca - dz * sa) >= ahx + bhx * axx + bhz * axz) return false;
  if (Math.abs(dx * sa + dz * ca) >= ahz + bhx * axz + bhz * axx) return false;
  if (Math.abs(dx * cb - dz * sb) >= bhx + ahx * axx + ahz * axz) return false;
  if (Math.abs(dx * sb + dz * cb) >= bhz + ahx * axz + ahz * axx) return false;
  return true;
}

/** Squared distance from a point to a box (0 inside). */
export function distSqPointBox(px: number, pz: number, b: Box): number {
  const c = DIR_COS[b.dir];
  const s = DIR_SIN[b.dir];
  const rx = px - b.x;
  const rz = pz - b.z;
  const lx = Math.abs(rx * c - rz * s) - b.hx;
  const lz = Math.abs(rx * s + rz * c) - b.hz;
  const ox = lx > 0 ? lx : 0;
  const oz = lz > 0 ? lz : 0;
  return ox * ox + oz * oz;
}

/** Squared distance from the segment a..b to a box (0 when the segment touches or enters it). */
export function distSqSegBox(ax: number, az: number, bx: number, bz: number, box: Box): number {
  const c = DIR_COS[box.dir];
  const s = DIR_SIN[box.dir];
  // Into the box's own frame.
  const rax = ax - box.x;
  const raz = az - box.z;
  const rbx = bx - box.x;
  const rbz = bz - box.z;
  const lax = rax * c - raz * s;
  const laz = rax * s + raz * c;
  const lbx = rbx * c - rbz * s;
  const lbz = rbx * s + rbz * c;
  const hx = box.hx;
  const hz = box.hz;

  // Does the segment enter the rectangle? (Slab test.)
  let t0 = 0;
  let t1 = 1;
  const dx = lbx - lax;
  const dz = lbz - laz;
  let hit = true;
  if (dx === 0) {
    if (lax < -hx || lax > hx) hit = false;
  } else {
    let u0 = (-hx - lax) / dx;
    let u1 = (hx - lax) / dx;
    if (u0 > u1) {
      const tmp = u0;
      u0 = u1;
      u1 = tmp;
    }
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
  }
  if (hit) {
    if (dz === 0) {
      if (laz < -hz || laz > hz) hit = false;
    } else {
      let u0 = (-hz - laz) / dz;
      let u1 = (hz - laz) / dz;
      if (u0 > u1) {
        const tmp = u0;
        u0 = u1;
        u1 = tmp;
      }
      if (u0 > t0) t0 = u0;
      if (u1 < t1) t1 = u1;
    }
  }
  if (hit && t0 <= t1) return 0;

  // Otherwise the closest approach is at an end of the segment or at a corner of the rectangle.
  let best = distSqPointRect(lax, laz, hx, hz);
  let d = distSqPointRect(lbx, lbz, hx, hz);
  if (d < best) best = d;
  d = distSqPointSeg(-hx, -hz, lax, laz, lbx, lbz);
  if (d < best) best = d;
  d = distSqPointSeg(hx, -hz, lax, laz, lbx, lbz);
  if (d < best) best = d;
  d = distSqPointSeg(hx, hz, lax, laz, lbx, lbz);
  if (d < best) best = d;
  d = distSqPointSeg(-hx, hz, lax, laz, lbx, lbz);
  if (d < best) best = d;
  return best;
}

/** Squared distance from a point to the axis-aligned rectangle of half extents (hx, hz) at the origin. */
function distSqPointRect(x: number, z: number, hx: number, hz: number): number {
  const ex = Math.abs(x) - hx;
  const ez = Math.abs(z) - hz;
  const ox = ex > 0 ? ex : 0;
  const oz = ez > 0 ? ez : 0;
  return ox * ox + oz * oz;
}

/** One round of corner cutting (Chaikin) on an open polyline; the two ends stay where they are. */
export function chaikinOpen(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, z: p.z }));
  const out: Vec2[] = [{ x: points[0].x, z: points[0].z }];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
    if (i + 2 < points.length) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, z: last.z });
  return out;
}
