/**
 * Seeded random numbers. The generator state is one plain 32-bit integer so it can live inside
 * World and be copied or serialized trivially. Only integer math (Math.imul, shifts, xor) is
 * used to produce the stream, so every JavaScript engine yields the identical sequence.
 *
 * Never use Math.random in shared code: the simulation and the city must be reproducible.
 */

export interface Rng {
  /** Current state, an unsigned 32-bit integer. */
  s: number;
}

/** Bit mixer (the 32-bit finalizer of MurmurHash3). Good avalanche for small integer inputs. */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Stateless hash of a few integers to an unsigned 32-bit integer. Use it to derive independent
 * sub-seeds (for example one per city block: hash32(seed, blockX, blockZ)).
 */
export function hash32(...values: number[]): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < values.length; i++) {
    h = mix32((h ^ (values[i] | 0)) + 0x7f4a7c15);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  return { s: mix32((seed | 0) ^ 0x2545f491) };
}

/** Independent generator derived from this one (advances the parent once). */
export function rngFork(rng: Rng): Rng {
  return { s: mix32(rngU32(rng) ^ 0x68bc21eb) };
}

/** Next unsigned 32-bit integer (mulberry32). */
export function rngU32(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform float in [0, 1). */
export function rngFloat(rng: Rng): number {
  return rngU32(rng) / 4294967296;
}

/** Uniform float in [lo, hi). */
export function rngRange(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rngFloat(rng);
}

/** Uniform integer in [0, n). Returns 0 when n <= 0. */
export function rngInt(rng: Rng, n: number): number {
  if (n <= 0) return 0;
  return Math.floor(rngFloat(rng) * n);
}

/** Uniform integer in [lo, hi], both inclusive. */
export function rngIntRange(rng: Rng, lo: number, hi: number): number {
  return lo + rngInt(rng, hi - lo + 1);
}

/** True with probability p. */
export function rngChance(rng: Rng, p: number): boolean {
  return rngFloat(rng) < p;
}

/** -1 or +1 with equal probability. */
export function rngSign(rng: Rng): -1 | 1 {
  return rngU32(rng) & 1 ? 1 : -1;
}

/** Random element of a non-empty array. Throws on an empty array: that is always a caller bug. */
export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('rngPick: empty array');
  return items[rngInt(rng, items.length)];
}

/** Index chosen with probability proportional to its weight. Returns -1 when all weights are 0. */
export function rngWeightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
  if (total <= 0) return -1;
  let roll = rngFloat(rng) * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] > 0 ? weights[i] : 0;
    if (roll < w) return i;
    roll -= w;
  }
  return weights.length - 1;
}

/** In-place Fisher-Yates shuffle. Returns the same array. */
export function rngShuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rngInt(rng, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Uniform heading in [-PI, PI). */
export function rngAngle(rng: Rng): number {
  return (rngFloat(rng) * 2 - 1) * Math.PI;
}

/**
 * Approximately normal value with mean 0 and standard deviation 1 (sum of 4 uniforms, range about
 * -3.46 to 3.46). Uses no transcendental functions, so it is identical on every engine.
 */
export function rngGauss(rng: Rng): number {
  const sum = rngFloat(rng) + rngFloat(rng) + rngFloat(rng) + rngFloat(rng);
  return (sum - 2) * 1.7320508075688772;
}

/**
 * Uniform point inside a disc of the given radius, written to `out` as { x, z }.
 * Rejection sampling keeps it free of trigonometry.
 */
export function rngInDisc(rng: Rng, radius: number, out: { x: number; z: number }): { x: number; z: number } {
  for (let i = 0; i < 16; i++) {
    const x = rngFloat(rng) * 2 - 1;
    const z = rngFloat(rng) * 2 - 1;
    if (x * x + z * z <= 1) {
      out.x = x * radius;
      out.z = z * radius;
      return out;
    }
  }
  out.x = 0;
  out.z = 0;
  return out;
}
