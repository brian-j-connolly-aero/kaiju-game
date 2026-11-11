/** Scalar helpers shared by every module. Pure functions, no allocation. */

export const EPSILON = 1e-9;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where `v` sits between `a` and `b` (0 at a, 1 at b), unclamped. Returns 0 when a equals b. */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Maps v from [inA, inB] to [outA, outB], clamped to the output range. */
export function remapClamped(v: number, inA: number, inB: number, outA: number, outB: number): number {
  return lerp(outA, outB, clamp01(invLerp(inA, inB, v)));
}

export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Moves `current` toward `target` by at most `maxStep` (maxStep >= 0). */
export function approach(current: number, target: number, maxStep: number): number {
  const d = target - current;
  if (d > maxStep) return current + maxStep;
  if (d < -maxStep) return current - maxStep;
  return target;
}

export function sign(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
