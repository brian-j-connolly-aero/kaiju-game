/**
 * Geometry tests used by movement, weapons and the city index.
 *
 * Everything lives on the ground plane (x, z) plus a height (y, up). Boxes are oriented with the
 * same yaw convention as bodies: local +Z is (sin yaw, cos yaw), local +X is (cos yaw, -sin yaw).
 *
 * The "CS" variants take a precomputed cosine and sine of the box yaw: the city index stores them
 * per structure so hot loops never call trigonometry.
 */

import { angleDist, yawOf } from './angle';
import type { Vec2, Vec3 } from './vec';

/** Oriented rectangle on the ground: center, half extents along its local X and Z axes, heading. */
export interface OrientedBox {
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
}

/** Axis-aligned rectangle on the ground. */
export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Result of a circle overlap: move the circle by (nx, nz) * depth to separate it. */
export interface Contact {
  nx: number;
  nz: number;
  depth: number;
}

/**
 * Result of a cast. `t` is in the units of the cast: a fraction in [0, 1] for segment casts, a
 * distance for ray casts. The normal points out of the surface that was hit; it is the zero
 * vector when the cast started inside the shape (t = 0).
 */
export interface CastHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Upright capsule: every point within `r` of the vertical line segment through (x, z) whose
 * rounded ends reach down to y0 and up to y1. If y1 - y0 is less than 2r it degenerates to a
 * sphere centered at mid height.
 */
export interface VerticalCapsule {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

const PARALLEL_EPS = 1e-12;

export function createContact(): Contact {
  return { nx: 0, nz: 0, depth: 0 };
}

export function createCastHit(): CastHit {
  return { t: 0, nx: 0, ny: 0, nz: 0 };
}

// ---------------------------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------------------------

export function boundsFromCenter(x: number, z: number, half: number): Bounds {
  return { minX: x - half, minZ: z - half, maxX: x + half, maxZ: z + half };
}

export function boundsContains(b: Bounds, x: number, z: number, margin = 0): boolean {
  return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/** True when `inner` lies entirely inside `outer`. */
export function boundsInside(inner: Bounds, outer: Bounds): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
}

/** Axis-aligned bounds of an oriented box. */
export function obbBounds(box: OrientedBox): Bounds {
  const c = Math.abs(Math.cos(box.yaw));
  const s = Math.abs(Math.sin(box.yaw));
  const ex = box.hx * c + box.hz * s;
  const ez = box.hx * s + box.hz * c;
  return { minX: box.x - ex, minZ: box.z - ez, maxX: box.x + ex, maxZ: box.z + ez };
}

/** The four corners of an oriented box, counter-clockwise in local space starting at (-hx, -hz). */
export function obbCorners(box: OrientedBox): Vec2[] {
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  const out: Vec2[] = [];
  const lx = [-box.hx, box.hx, box.hx, -box.hx];
  const lz = [-box.hz, -box.hz, box.hz, box.hz];
  for (let i = 0; i < 4; i++) {
    out.push({ x: box.x + lx[i] * c + lz[i] * s, z: box.z - lx[i] * s + lz[i] * c });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Points and circles against oriented boxes
// ---------------------------------------------------------------------------------------------

export function pointInObb(px: number, pz: number, box: OrientedBox): boolean {
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  const rx = px - box.x;
  const rz = pz - box.z;
  return Math.abs(rx * c - rz * s) <= box.hx && Math.abs(rx * s + rz * c) <= box.hz;
}

/** Squared distance from a point to a box (0 when the point is inside). */
export function distSqPointBoxCS(
  px: number,
  pz: number,
  bx: number,
  bz: number,
  hx: number,
  hz: number,
  cos: number,
  sin: number,
): number {
  const rx = px - bx;
  const rz = pz - bz;
  const lx = rx * cos - rz * sin;
  const lz = rx * sin + rz * cos;
  const dx = Math.abs(lx) - hx;
  const dz = Math.abs(lz) - hz;
  const ox = dx > 0 ? dx : 0;
  const oz = dz > 0 ? dz : 0;
  return ox * ox + oz * oz;
}

/** Distance from a point to a box (0 when the point is inside). */
export function distPointObb(px: number, pz: number, box: OrientedBox): number {
  return Math.sqrt(distSqPointBoxCS(px, pz, box.x, box.z, box.hx, box.hz, Math.cos(box.yaw), Math.sin(box.yaw)));
}

/** Closest point on (or in) a box to a point, in world space. */
export function closestPointOnObb(px: number, pz: number, box: OrientedBox, out: Vec2): Vec2 {
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  const rx = px - box.x;
  const rz = pz - box.z;
  let lx = rx * c - rz * s;
  let lz = rx * s + rz * c;
  lx = lx < -box.hx ? -box.hx : lx > box.hx ? box.hx : lx;
  lz = lz < -box.hz ? -box.hz : lz > box.hz ? box.hz : lz;
  out.x = box.x + lx * c + lz * s;
  out.z = box.z - lx * s + lz * c;
  return out;
}

/**
 * Circle against oriented box. Returns true when they overlap (touching does not count). When
 * `out` is given it receives the shortest push that moves the circle out of the box; a circle
 * whose center is inside the box is pushed out through the nearest face.
 */
export function circleVsBoxCS(
  cx: number,
  cz: number,
  r: number,
  bx: number,
  bz: number,
  hx: number,
  hz: number,
  cos: number,
  sin: number,
  out?: Contact,
): boolean {
  const rx = cx - bx;
  const rz = cz - bz;
  const lx = rx * cos - rz * sin;
  const lz = rx * sin + rz * cos;
  const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
  const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
  const dx = lx - qx;
  const dz = lz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (!out) return true;
  let nlx: number;
  let nlz: number;
  let depth: number;
  if (d2 > PARALLEL_EPS) {
    const d = Math.sqrt(d2);
    nlx = dx / d;
    nlz = dz / d;
    depth = r - d;
  } else {
    const px = hx - Math.abs(lx);
    const pz = hz - Math.abs(lz);
    if (px < pz) {
      nlx = lx >= 0 ? 1 : -1;
      nlz = 0;
      depth = px + r;
    } else {
      nlx = 0;
      nlz = lz >= 0 ? 1 : -1;
      depth = pz + r;
    }
  }
  out.nx = nlx * cos + nlz * sin;
  out.nz = -nlx * sin + nlz * cos;
  out.depth = depth;
  return true;
}

export function circleVsObb(cx: number, cz: number, r: number, box: OrientedBox, out?: Contact): boolean {
  return circleVsBoxCS(cx, cz, r, box.x, box.z, box.hx, box.hz, Math.cos(box.yaw), Math.sin(box.yaw), out);
}

/** Overlap test for two oriented boxes (separating axis test). Touching does not count. */
export function obbVsObb(a: OrientedBox, b: OrientedBox): boolean {
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Axes: a's X and Z, b's X and Z, each as a world direction (ax, az).
  const axes = [ca, -sa, sa, ca, cb, -sb, sb, cb];
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i];
    const az = axes[i + 1];
    const ra = a.hx * Math.abs(ca * ax - sa * az) + a.hz * Math.abs(sa * ax + ca * az);
    const rb = b.hx * Math.abs(cb * ax - sb * az) + b.hz * Math.abs(sb * ax + cb * az);
    if (Math.abs(dx * ax + dz * az) >= ra + rb) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Casts against box prisms (oriented footprint, vertical extent y0..y1)
// ---------------------------------------------------------------------------------------------

/**
 * Casts the path origin + dir * t, t in [0, tMax], against a box prism. Returns true on a hit and
 * writes the entry `t` and surface normal to `out`. A path that starts inside hits at t = 0.
 */
export function castBoxCS(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  bx: number,
  bz: number,
  hx: number,
  hz: number,
  cos: number,
  sin: number,
  y0: number,
  y1: number,
  out?: CastHit,
): boolean {
  const rx = ox - bx;
  const rz = oz - bz;
  const lox = rx * cos - rz * sin;
  const loz = rx * sin + rz * cos;
  const ldx = dx * cos - dz * sin;
  const ldz = dx * sin + dz * cos;

  let tEnter = 0;
  let tExit = tMax;
  let axis = 0; // 0: started inside, 1: local X face, 2: Y face, 3: local Z face
  let face = 0; // sign of the outward normal along that axis

  if (Math.abs(ldx) < PARALLEL_EPS) {
    if (lox < -hx || lox > hx) return false;
  } else {
    const inv = 1 / ldx;
    let ta = (-hx - lox) * inv;
    let tb = (hx - lox) * inv;
    let s = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      s = 1;
    }
    if (ta > tEnter) {
      tEnter = ta;
      axis = 1;
      face = s;
    }
    if (tb < tExit) tExit = tb;
    if (tEnter > tExit) return false;
  }

  if (Math.abs(dy) < PARALLEL_EPS) {
    if (oy < y0 || oy > y1) return false;
  } else {
    const inv = 1 / dy;
    let ta = (y0 - oy) * inv;
    let tb = (y1 - oy) * inv;
    let s = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      s = 1;
    }
    if (ta > tEnter) {
      tEnter = ta;
      axis = 2;
      face = s;
    }
    if (tb < tExit) tExit = tb;
    if (tEnter > tExit) return false;
  }

  if (Math.abs(ldz) < PARALLEL_EPS) {
    if (loz < -hz || loz > hz) return false;
  } else {
    const inv = 1 / ldz;
    let ta = (-hz - loz) * inv;
    let tb = (hz - loz) * inv;
    let s = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      s = 1;
    }
    if (ta > tEnter) {
      tEnter = ta;
      axis = 3;
      face = s;
    }
    if (tb < tExit) tExit = tb;
    if (tEnter > tExit) return false;
  }

  if (out) {
    out.t = tEnter;
    if (axis === 1) {
      out.nx = face * cos;
      out.ny = 0;
      out.nz = -face * sin;
    } else if (axis === 2) {
      out.nx = 0;
      out.ny = face;
      out.nz = 0;
    } else if (axis === 3) {
      out.nx = face * sin;
      out.ny = 0;
      out.nz = face * cos;
    } else {
      out.nx = 0;
      out.ny = 0;
      out.nz = 0;
    }
  }
  return true;
}

/** Segment a..b against a box prism. `out.t` is the fraction along the segment of the entry point. */
export function segmentVsPrism(a: Vec3, b: Vec3, box: OrientedBox, y0: number, y1: number, out?: CastHit): boolean {
  return castBoxCS(
    a.x,
    a.y,
    a.z,
    b.x - a.x,
    b.y - a.y,
    b.z - a.z,
    1,
    box.x,
    box.z,
    box.hx,
    box.hz,
    Math.cos(box.yaw),
    Math.sin(box.yaw),
    y0,
    y1,
    out,
  );
}

/** Ray against a box prism. `dir` must be a unit vector; `out.t` is the distance to the entry point. */
export function rayVsPrism(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  box: OrientedBox,
  y0: number,
  y1: number,
  out?: CastHit,
): boolean {
  return castBoxCS(
    origin.x,
    origin.y,
    origin.z,
    dir.x,
    dir.y,
    dir.z,
    maxDist,
    box.x,
    box.z,
    box.hx,
    box.hz,
    Math.cos(box.yaw),
    Math.sin(box.yaw),
    y0,
    y1,
    out,
  );
}

/**
 * Ground-plane segment against an oriented box. Returns the entry fraction in [0, 1], or -1 when
 * the segment misses. A segment that starts inside returns 0.
 */
export function segmentVsObb2(ax: number, az: number, bx: number, bz: number, box: OrientedBox): number {
  const hit = scratchHit;
  const ok = castBoxCS(
    ax,
    0,
    az,
    bx - ax,
    0,
    bz - az,
    1,
    box.x,
    box.z,
    box.hx,
    box.hz,
    Math.cos(box.yaw),
    Math.sin(box.yaw),
    -1,
    1,
    hit,
  );
  return ok ? hit.t : -1;
}

const scratchHit: CastHit = createCastHit();

// ---------------------------------------------------------------------------------------------
// Casts against upright capsules (kaiju and unit hit volumes)
// ---------------------------------------------------------------------------------------------

/**
 * Casts the path origin + dir * t, t in [0, tMax], against an upright capsule. Returns true on a
 * hit and writes the entry `t` and surface normal to `out`. A path that starts inside hits at 0.
 */
export function castCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  cap: VerticalCapsule,
  out?: CastHit,
): boolean {
  const r = cap.r;
  const mid = (cap.y0 + cap.y1) * 0.5;
  const ya = Math.min(cap.y0 + r, mid);
  const yb = Math.max(cap.y1 - r, mid);
  const rx = ox - cap.x;
  const rz = oz - cap.z;

  // Start inside?
  const sy = oy < ya ? ya : oy > yb ? yb : oy;
  const ry0 = oy - sy;
  if (rx * rx + ry0 * ry0 + rz * rz <= r * r) {
    if (out) {
      out.t = 0;
      out.nx = 0;
      out.ny = 0;
      out.nz = 0;
    }
    return true;
  }

  let best = Infinity;
  let bnx = 0;
  let bny = 0;
  let bnz = 0;

  // Side wall: infinite cylinder around the vertical axis, kept only between the end spheres.
  const a2 = dx * dx + dz * dz;
  if (a2 > PARALLEL_EPS) {
    const hb = rx * dx + rz * dz;
    const c = rx * rx + rz * rz - r * r;
    const disc = hb * hb - a2 * c;
    if (disc >= 0) {
      const t = (-hb - Math.sqrt(disc)) / a2;
      if (t >= 0 && t <= tMax) {
        const y = oy + dy * t;
        if (y >= ya && y <= yb) {
          best = t;
          bnx = (rx + dx * t) / r;
          bny = 0;
          bnz = (rz + dz * t) / r;
        }
      }
    }
  }

  // End spheres.
  const a3 = a2 + dy * dy;
  if (a3 > PARALLEL_EPS) {
    for (let i = 0; i < 2; i++) {
      const cy = i === 0 ? ya : yb;
      const ry = oy - cy;
      const hb = rx * dx + ry * dy + rz * dz;
      const c = rx * rx + ry * ry + rz * rz - r * r;
      const disc = hb * hb - a3 * c;
      if (disc < 0) continue;
      const t = (-hb - Math.sqrt(disc)) / a3;
      if (t >= 0 && t <= tMax && t < best) {
        best = t;
        bnx = (rx + dx * t) / r;
        bny = (ry + dy * t) / r;
        bnz = (rz + dz * t) / r;
      }
      if (ya === yb) break;
    }
  }

  if (best === Infinity) return false;
  if (out) {
    out.t = best;
    out.nx = bnx;
    out.ny = bny;
    out.nz = bnz;
  }
  return true;
}

/** Segment a..b against an upright capsule. `out.t` is the fraction along the segment. */
export function segmentVsCapsule(a: Vec3, b: Vec3, cap: VerticalCapsule, out?: CastHit): boolean {
  return castCapsule(a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, 1, cap, out);
}

/** Ray against an upright capsule. `dir` must be a unit vector; `out.t` is a distance. */
export function rayVsCapsule(origin: Vec3, dir: Vec3, maxDist: number, cap: VerticalCapsule, out?: CastHit): boolean {
  return castCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, cap, out);
}

// ---------------------------------------------------------------------------------------------
// Ground-plane segments and circles
// ---------------------------------------------------------------------------------------------

/** Fraction in [0, 1] along segment a..b of the point closest to p. */
export function closestTOnSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 <= PARALLEL_EPS) return 0;
  const t = ((px - ax) * dx + (pz - az) * dz) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Squared distance from point p to segment a..b. */
export function distSqPointSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const t = closestTOnSegment2(px, pz, ax, az, bx, bz);
  const qx = ax + (bx - ax) * t - px;
  const qz = az + (bz - az) * t - pz;
  return qx * qx + qz * qz;
}

/**
 * Ground-plane segment against a circle. Returns the entry fraction in [0, 1], 0 when the segment
 * starts inside, or -1 on a miss. Use it with radius = target radius + half the beam width to
 * test a thick beam.
 */
export function segmentVsCircle2(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const rx = ax - cx;
  const rz = az - cz;
  const c = rx * rx + rz * rz - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a <= PARALLEL_EPS) return -1;
  const hb = rx * dx + rz * dz;
  const disc = hb * hb - a * c;
  if (disc < 0) return -1;
  const t = (-hb - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

export function circlesOverlap(ax: number, az: number, ar: number, bx: number, bz: number, br: number): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  const r = ar + br;
  return dx * dx + dz * dz < r * r;
}

// ---------------------------------------------------------------------------------------------
// Arcs (ground-plane sectors: melee swipes, firing arcs) and cones (3D)
// ---------------------------------------------------------------------------------------------

/**
 * True when point p lies in the sector with apex o, facing `facingYaw`, half opening
 * `halfAngle` and radius `range`. The apex itself is inside.
 */
export function pointInArc(
  px: number,
  pz: number,
  ox: number,
  oz: number,
  facingYaw: number,
  halfAngle: number,
  range: number,
): boolean {
  const dx = px - ox;
  const dz = pz - oz;
  const d2 = dx * dx + dz * dz;
  if (d2 > range * range) return false;
  if (d2 <= PARALLEL_EPS) return true;
  return angleDist(yawOf(dx, dz), facingYaw) <= halfAngle;
}

/**
 * True when a circle (a unit's body) touches the sector. Slightly generous at the two far
 * corners, which is the right bias for melee: a claw that visibly clips a unit should hit it.
 */
export function circleInArc(
  cx: number,
  cz: number,
  cr: number,
  ox: number,
  oz: number,
  facingYaw: number,
  halfAngle: number,
  range: number,
): boolean {
  const dx = cx - ox;
  const dz = cz - oz;
  const d2 = dx * dx + dz * dz;
  const reach = range + cr;
  if (d2 > reach * reach) return false;
  if (d2 <= cr * cr) return true;
  const d = Math.sqrt(d2);
  const widen = Math.asin(cr / d);
  return angleDist(yawOf(dx, dz), facingYaw) <= halfAngle + widen;
}

/**
 * True when an oriented box (a structure footprint) touches the sector. Tested by: the box
 * point closest to the apex, the box corners, and a fan of rays across the sector. This catches
 * every practical case for the wide, short arcs used by melee attacks.
 */
export function obbInArc(
  box: OrientedBox,
  ox: number,
  oz: number,
  facingYaw: number,
  halfAngle: number,
  range: number,
): boolean {
  closestPointOnObb(ox, oz, box, scratchVec);
  if (pointInArc(scratchVec.x, scratchVec.z, ox, oz, facingYaw, halfAngle, range)) return true;
  const corners = obbCorners(box);
  for (let i = 0; i < 4; i++) {
    if (pointInArc(corners[i].x, corners[i].z, ox, oz, facingYaw, halfAngle, range)) return true;
  }
  const rays = 7;
  for (let i = 0; i < rays; i++) {
    const yaw = facingYaw - halfAngle + (2 * halfAngle * i) / (rays - 1);
    const ex = ox + Math.sin(yaw) * range;
    const ez = oz + Math.cos(yaw) * range;
    if (segmentVsObb2(ox, oz, ex, ez, box) >= 0) return true;
  }
  return false;
}

const scratchVec: Vec2 = { x: 0, z: 0 };

/**
 * True when point p lies inside the 3D cone with the given apex, unit axis direction, half
 * opening angle and length (measured from the apex to p).
 */
export function pointInCone(p: Vec3, apex: Vec3, dir: Vec3, halfAngle: number, range: number): boolean {
  const dx = p.x - apex.x;
  const dy = p.y - apex.y;
  const dz = p.z - apex.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > range * range) return false;
  if (d2 <= PARALLEL_EPS) return true;
  const along = dx * dir.x + dy * dir.y + dz * dir.z;
  return along >= Math.sqrt(d2) * Math.cos(halfAngle);
}

/**
 * True when a sphere touches the 3D cone. Conservative widening by the sphere's angular radius,
 * like circleInArc.
 */
export function sphereInCone(
  center: Vec3,
  radius: number,
  apex: Vec3,
  dir: Vec3,
  halfAngle: number,
  range: number,
): boolean {
  const dx = center.x - apex.x;
  const dy = center.y - apex.y;
  const dz = center.z - apex.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const reach = range + radius;
  if (d2 > reach * reach) return false;
  if (d2 <= radius * radius) return true;
  const d = Math.sqrt(d2);
  const along = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
  const angle = Math.acos(along < -1 ? -1 : along > 1 ? 1 : along);
  return angle <= halfAngle + Math.asin(radius / d);
}
