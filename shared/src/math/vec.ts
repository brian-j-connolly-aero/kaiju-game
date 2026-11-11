/**
 * Ground-plane vectors are { x, z }; 3D vectors are { x, y, z } with Y up (DESIGN.md section 1).
 * Functions that return a vector allocate a new one unless they take an `out` argument.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function v2(x = 0, z = 0): Vec2 {
  return { x, z };
}

export function v2Copy(a: Vec2): Vec2 {
  return { x: a.x, z: a.z };
}

export function v2Set(out: Vec2, x: number, z: number): Vec2 {
  out.x = x;
  out.z = z;
  return out;
}

export function v2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function v2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function v2Scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s };
}

export function v2AddScaled(a: Vec2, b: Vec2, s: number): Vec2 {
  return { x: a.x + b.x * s, z: a.z + b.z * s };
}

export function v2Dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

/** 2D cross product a.x * b.z - a.z * b.x (positive when b is clockwise of a seen from above with +Z up). */
export function v2Cross(a: Vec2, b: Vec2): number {
  return a.x * b.z - a.z * b.x;
}

export function v2LenSq(a: Vec2): number {
  return a.x * a.x + a.z * a.z;
}

export function v2Len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

export function v2DistSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function v2Dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(v2DistSq(a, b));
}

/** Unit vector in the direction of `a`; the zero vector stays zero. */
export function v2Normalize(a: Vec2): Vec2 {
  const l = Math.sqrt(a.x * a.x + a.z * a.z);
  return l > 0 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}

export function v2ClampLen(a: Vec2, maxLen: number): Vec2 {
  const l2 = a.x * a.x + a.z * a.z;
  if (l2 <= maxLen * maxLen) return { x: a.x, z: a.z };
  const k = maxLen / Math.sqrt(l2);
  return { x: a.x * k, z: a.z * k };
}

export function v2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Forward vector of a heading: (sin yaw, cos yaw), optionally scaled. */
export function v2FromYaw(yaw: number, len = 1): Vec2 {
  return { x: Math.sin(yaw) * len, z: Math.cos(yaw) * len };
}

/** Right-hand vector of a heading (screen-right for a viewer looking along it): (-cos yaw, sin yaw). */
export function v2RightOfYaw(yaw: number, len = 1): Vec2 {
  return { x: -Math.cos(yaw) * len, z: Math.sin(yaw) * len };
}

/**
 * Rotates a body-local vector into world space for a body with heading `yaw`.
 * Local +Z is forward; local +X is the body's left (the three.js convention for `rotation.y = yaw`).
 */
export function v2LocalToWorld(local: Vec2, yaw: number): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: local.x * c + local.z * s, z: -local.x * s + local.z * c };
}

/** Inverse of v2LocalToWorld. */
export function v2WorldToLocal(world: Vec2, yaw: number): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: world.x * c - world.z * s, z: world.x * s + world.z * c };
}

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function v3Copy(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function v3Set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function v3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function v3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function v3Scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function v3AddScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function v3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3Cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function v3LenSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function v3Len(a: Vec3): number {
  return Math.sqrt(v3LenSq(a));
}

export function v3DistSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function v3Dist(a: Vec3, b: Vec3): number {
  return Math.sqrt(v3DistSq(a, b));
}

export function v3Normalize(a: Vec3): Vec3 {
  const l = Math.sqrt(v3LenSq(a));
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

export function v3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Unit aim direction for a heading and an elevation. Pitch is positive upward:
 * (sin yaw cos pitch, sin pitch, cos yaw cos pitch).
 */
export function v3FromYawPitch(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
}
