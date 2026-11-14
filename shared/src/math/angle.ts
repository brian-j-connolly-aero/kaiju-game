/**
 * Angles are radians. Heading convention (DESIGN.md section 1): yaw 0 faces +Z, forward is
 * (sin yaw, 0, cos yaw), so yaw grows toward +X. Seen from above with +Z up the page, +X is on
 * the LEFT of a body facing +Z (right-handed, Y up), so the "right" vector is (-cos yaw, sin yaw).
 */

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG;
}

export function radToDeg(rad: number): number {
  return rad / DEG;
}

/** Wraps any angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  let r = (a + PI) % TAU;
  if (r < 0) r += TAU;
  return r - PI;
}

/** Signed shortest rotation that takes `from` to `to`, in [-PI, PI). */
export function angleDiff(to: number, from: number): number {
  return wrapAngle(to - from);
}

/** Absolute shortest angular distance between two headings, in [0, PI]. */
export function angleDist(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

/** Rotates `current` toward `target` by at most `maxStep` radians, result wrapped. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(target, current);
  if (d > maxStep) return wrapAngle(current + maxStep);
  if (d < -maxStep) return wrapAngle(current - maxStep);
  return wrapAngle(target);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDiff(b, a) * t);
}

/** Clamps `angle` to within `maxOffset` radians either side of `center`. */
export function clampAngleAround(angle: number, center: number, maxOffset: number): number {
  const d = angleDiff(angle, center);
  if (d > maxOffset) return wrapAngle(center + maxOffset);
  if (d < -maxOffset) return wrapAngle(center - maxOffset);
  return wrapAngle(angle);
}

/** True when `angle` lies within `halfWidth` radians of `center`. */
export function angleInArc(angle: number, center: number, halfWidth: number): boolean {
  return angleDist(angle, center) <= halfWidth;
}

/** Heading of the ground direction (dx, dz): the yaw whose forward vector points that way. */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Heading from point a to point b on the ground plane. */
export function yawFromTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, bz - az);
}
