/**
 * The kaiju's hit volume (DESIGN.md section 4, "The hit volume"): a few capsules that follow the
 * body, so that a shot at the head or at the tail counts, where it used to pass through.
 *
 * - The body: an upright capsule of the body radius from the ground to the top of the body
 *   (the hit volume of old).
 * - The head and neck: one capsule from the neck to the snout, along the heading the head looks
 *   (`aimYaw`), where the model has them (`KaijuStageDef.hit`).
 * - The tail: capsules from its root behind the body, sloping down to the tip, along the body's
 *   facing (`yaw`).
 * Swimming, only the spines show: one small upright capsule (sim/swim.ts), the same as before.
 * In the cocoon there is no head or tail to hit: the body's capsule only.
 *
 * Projectiles (systems/projectiles.ts), aim rays (`resolveAimPoint`) and blasts all use it. It
 * needs only what a snapshot carries, so a client can cast against the very same volume.
 * Where a hit lands on the volume changes nothing else: the facing multiplier is still judged
 * by the direction the hit came from (systems/damage.ts).
 */

import type { KaijuKindId, KaijuPhase, StageId } from '../defs/ids';
import { kaijuStageDef } from '../defs/kaiju/index';
import type { CastHit } from '../math/geom';
import { kaijuShownHeight, kaijuShownRadius } from './swim';

/** What fixes where a kaiju's body is. Kaiju and snapshot kaiju both satisfy it. */
export interface KaijuBodySource {
  kind: KaijuKindId;
  stage: StageId;
  x: number;
  z: number;
  /** Body heading (the tail trails it). */
  yaw: number;
  /** Where the head looks (the head and neck point along it). */
  aimYaw: number;
  phase: KaijuPhase;
  /** Swimming: 0 standing up, 1 under. Absent counts as 0. */
  submerge?: number;
}

/** A capsule of any orientation: every point within `r` of the segment from a to b. */
export interface BodyCapsule {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

/** The most capsules a kaiju's volume has (body, head, and two tail pieces for the Lizard; room to spare). */
export const MAX_BODY_CAPSULES = 6;

export function createBodyCapsules(): BodyCapsule[] {
  const out: BodyCapsule[] = [];
  for (let i = 0; i < MAX_BODY_CAPSULES; i++) out.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 });
  return out;
}

/** Writes an upright capsule (rounded ends reaching down to y0 and up to y1) as a segment and a radius. */
function upright(c: BodyCapsule, x: number, z: number, r: number, y0: number, y1: number): void {
  const mid = (y0 + y1) / 2;
  c.ax = x;
  c.az = z;
  c.bx = x;
  c.bz = z;
  c.ay = Math.min(y0 + r, mid);
  c.by = Math.max(y1 - r, mid);
  c.r = r;
}

/**
 * The capsules of a kaiju's hit volume as it stands now, into `out` (at least MAX_BODY_CAPSULES
 * long, from `createBodyCapsules`). Returns how many were written.
 */
export function kaijuBodyCapsules(k: KaijuBodySource, out: BodyCapsule[]): number {
  const st = kaijuStageDef(k.kind, k.stage);
  if ((k.submerge ?? 0) > 0) {
    // What shows above the water: a capsule whose rounded top is the spines' height.
    const r = kaijuShownRadius(k);
    const top = kaijuShownHeight(k);
    upright(out[0], k.x, k.z, r, Math.min(0, top - 2 * r), top);
    return 1;
  }
  upright(out[0], k.x, k.z, st.bodyRadius, 0, st.height);
  if (k.phase === 'cocoon') return 1;
  const hit = st.hit;
  let n = 1;

  // Head and neck, along where the head looks.
  const hx = Math.sin(k.aimYaw);
  const hz = Math.cos(k.aimYaw);
  const head = out[n++];
  head.ax = k.x + hx * hit.neck[0];
  head.ay = hit.neck[1];
  head.az = k.z + hz * hit.neck[0];
  head.bx = k.x + hx * hit.snout[0];
  head.by = hit.snout[1];
  head.bz = k.z + hz * hit.snout[0];
  head.r = hit.headRadius;

  // The tail, along the body's facing (its points are behind: negative forward).
  const fx = Math.sin(k.yaw);
  const fz = Math.cos(k.yaw);
  for (let i = 0; i + 1 < hit.tail.length && n < out.length; i++) {
    const a = hit.tail[i];
    const b = hit.tail[i + 1];
    const c = out[n++];
    c.ax = k.x + fx * a[0];
    c.ay = a[1];
    c.az = k.z + fz * a[0];
    c.bx = k.x + fx * b[0];
    c.by = b[1];
    c.bz = k.z + fz * b[0];
    c.r = hit.tailRadii[i] ?? hit.tailRadii[hit.tailRadii.length - 1] ?? 0;
  }
  return n;
}

const EPS = 1e-12;

/**
 * Casts the path origin + dir * t, t in [0, tMax], against a capsule grown by `inflate`. Returns
 * true on a hit and writes the entry `t` and the outward surface normal to `out`. A path that
 * starts inside hits at 0 (normal zero). `dir` need not be a unit vector: `t` is in its units.
 */
export function castBodyCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  c: BodyCapsule,
  inflate: number,
  out?: CastHit,
): boolean {
  const r = c.r + inflate;
  const abx = c.bx - c.ax;
  const aby = c.by - c.ay;
  const abz = c.bz - c.az;
  const mx = ox - c.ax;
  const my = oy - c.ay;
  const mz = oz - c.az;
  const dd = abx * abx + aby * aby + abz * abz;
  const md = mx * abx + my * aby + mz * abz;

  // Starts inside?
  const s0 = dd > EPS ? Math.min(1, Math.max(0, md / dd)) : 0;
  const px = mx - abx * s0;
  const py = my - aby * s0;
  const pz = mz - abz * s0;
  if (px * px + py * py + pz * pz <= r * r) {
    if (out) {
      out.t = 0;
      out.nx = 0;
      out.ny = 0;
      out.nz = 0;
    }
    return true;
  }

  const nn = dx * dx + dy * dy + dz * dz;
  if (nn <= EPS) return false;
  let best = Infinity;
  let cx = 0;
  let cy = 0;
  let cz = 0;

  // The side: the infinite cylinder round the segment, kept only between its two ends.
  if (dd > EPS) {
    const nd = dx * abx + dy * aby + dz * abz;
    const mn = mx * dx + my * dy + mz * dz;
    const mm = mx * mx + my * my + mz * mz;
    const a = dd * nn - nd * nd;
    if (a > EPS) {
      const b = dd * mn - nd * md;
      const cc = dd * (mm - r * r) - md * md;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        const s = md + t * nd;
        if (t >= 0 && t <= tMax && s >= 0 && s <= dd) {
          best = t;
          const f = s / dd;
          cx = c.ax + abx * f;
          cy = c.ay + aby * f;
          cz = c.az + abz * f;
        }
      }
    }
  }

  // The two rounded ends.
  for (let i = 0; i < 2; i++) {
    const ex = i === 0 ? c.ax : c.bx;
    const ey = i === 0 ? c.ay : c.by;
    const ez = i === 0 ? c.az : c.bz;
    const qx = ox - ex;
    const qy = oy - ey;
    const qz = oz - ez;
    const hb = qx * dx + qy * dy + qz * dz;
    const qc = qx * qx + qy * qy + qz * qz - r * r;
    const disc = hb * hb - nn * qc;
    if (disc < 0) continue;
    const t = (-hb - Math.sqrt(disc)) / nn;
    if (t >= 0 && t <= tMax && t < best) {
      best = t;
      cx = ex;
      cy = ey;
      cz = ez;
    }
    if (dd <= EPS) break;
  }

  if (best === Infinity) return false;
  if (out) {
    out.t = best;
    out.nx = (ox + dx * best - cx) / r;
    out.ny = (oy + dy * best - cy) / r;
    out.nz = (oz + dz * best - cz) / r;
  }
  return true;
}

const scratch = createBodyCapsules();
const scratchHit: CastHit = { t: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Casts the path origin + dir * t, t in [0, tMax], against a kaiju's whole hit volume (every
 * capsule grown by `inflate`, a projectile's own radius). Returns true on a hit and writes the
 * nearest entry to `out`.
 */
export function castKaijuBody(
  k: KaijuBodySource,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  inflate = 0,
  out?: CastHit,
): boolean {
  const n = kaijuBodyCapsules(k, scratch);
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    if (!castBodyCapsule(ox, oy, oz, dx, dy, dz, Math.min(tMax, best), scratch[i], inflate, scratchHit)) continue;
    if (scratchHit.t < best) {
      best = scratchHit.t;
      if (out) {
        out.t = scratchHit.t;
        out.nx = scratchHit.nx;
        out.ny = scratchHit.ny;
        out.nz = scratchHit.nz;
      }
    }
  }
  return best !== Infinity;
}

/** How far a point is from the surface of a kaiju's hit volume (0 inside it). For blasts. */
export function kaijuBodyDistance(k: KaijuBodySource, x: number, y: number, z: number): number {
  const n = kaijuBodyCapsules(k, scratch);
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const c = scratch[i];
    const abx = c.bx - c.ax;
    const aby = c.by - c.ay;
    const abz = c.bz - c.az;
    const dd = abx * abx + aby * aby + abz * abz;
    const s = dd > EPS ? Math.min(1, Math.max(0, ((x - c.ax) * abx + (y - c.ay) * aby + (z - c.az) * abz) / dd)) : 0;
    const d = Math.hypot(x - c.ax - abx * s, y - c.ay - aby * s, z - c.az - abz * s) - c.r;
    if (d < best) best = d;
  }
  return Math.max(0, best);
}
