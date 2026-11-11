import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  angleDist,
  angleInArc,
  approach,
  clamp,
  clampAngleAround,
  createRng,
  DEG,
  hash32,
  lerpAngle,
  PI,
  remapClamped,
  rngChance,
  rngFloat,
  rngFork,
  rngGauss,
  rngInDisc,
  rngInt,
  rngIntRange,
  rngPick,
  rngShuffle,
  rngU32,
  rngWeightedIndex,
  TAU,
  turnToward,
  v2FromYaw,
  v2LocalToWorld,
  v2Normalize,
  v2RightOfYaw,
  v2WorldToLocal,
  v3Cross,
  v3FromYawPitch,
  v3Len,
  wrapAngle,
  yawFromTo,
  yawOf,
} from '../src/math';

describe('scalar helpers', () => {
  it('clamps, approaches and remaps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(0, -10, 3)).toBe(-3);
    expect(remapClamped(5, 0, 10, 100, 200)).toBe(150);
    expect(remapClamped(50, 0, 10, 100, 200)).toBe(200);
  });
});

describe('angles', () => {
  it('wraps into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle(PI)).toBeCloseTo(-PI, 12);
    expect(wrapAngle(-PI)).toBeCloseTo(-PI, 12);
    expect(wrapAngle(3 * PI + 0.25)).toBeCloseTo(-PI + 0.25, 12);
    expect(wrapAngle(-7 * TAU - 1)).toBeCloseTo(-1, 9);
  });

  it('takes the short way round', () => {
    expect(angleDiff(170 * DEG, -170 * DEG)).toBeCloseTo(-20 * DEG, 12);
    expect(angleDiff(-170 * DEG, 170 * DEG)).toBeCloseTo(20 * DEG, 12);
    expect(angleDist(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG, 12);
    expect(turnToward(170 * DEG, -170 * DEG, 5 * DEG)).toBeCloseTo(175 * DEG, 12);
    expect(turnToward(170 * DEG, -170 * DEG, 50 * DEG)).toBeCloseTo(-170 * DEG, 12);
    expect(lerpAngle(170 * DEG, -170 * DEG, 0.5)).toBeCloseTo(-PI, 9);
  });

  it('clamps around a center and tests arcs across the seam', () => {
    expect(clampAngleAround(100 * DEG, 0, 50 * DEG)).toBeCloseTo(50 * DEG, 12);
    expect(clampAngleAround(-179 * DEG, 170 * DEG, 50 * DEG)).toBeCloseTo(-179 * DEG, 12);
    expect(clampAngleAround(-100 * DEG, 170 * DEG, 50 * DEG)).toBeCloseTo(-140 * DEG, 9);
    expect(angleInArc(179 * DEG, -179 * DEG, 5 * DEG)).toBe(true);
    expect(angleInArc(90 * DEG, 0, 60 * DEG)).toBe(false);
  });

  it('follows the heading convention: yaw 0 faces +Z and grows toward +X', () => {
    const f0 = v2FromYaw(0);
    expect(f0.x).toBeCloseTo(0, 12);
    expect(f0.z).toBeCloseTo(1, 12);
    const f90 = v2FromYaw(PI / 2);
    expect(f90.x).toBeCloseTo(1, 12);
    expect(f90.z).toBeCloseTo(0, 12);
    expect(yawOf(1, 0)).toBeCloseTo(PI / 2, 12);
    expect(yawOf(0, -1)).toBeCloseTo(PI, 12);
    expect(yawFromTo(10, 10, 10, 20)).toBeCloseTo(0, 12);
    // Right of a body facing +Z is -X (right-handed, Y up).
    const r = v2RightOfYaw(0);
    expect(r.x).toBeCloseTo(-1, 12);
    expect(r.z).toBeCloseTo(0, 12);
  });
});

describe('vectors', () => {
  it('converts between body-local and world space', () => {
    const yaw = 0.7;
    const world = v2LocalToWorld({ x: 0, z: 1 }, yaw);
    const fwd = v2FromYaw(yaw);
    expect(world.x).toBeCloseTo(fwd.x, 12);
    expect(world.z).toBeCloseTo(fwd.z, 12);
    const back = v2WorldToLocal(v2LocalToWorld({ x: 3, z: -2 }, yaw), yaw);
    expect(back.x).toBeCloseTo(3, 12);
    expect(back.z).toBeCloseTo(-2, 12);
    // Local +X is the body's left, the opposite of the right vector.
    const left = v2LocalToWorld({ x: 1, z: 0 }, yaw);
    const right = v2RightOfYaw(yaw);
    expect(left.x).toBeCloseTo(-right.x, 12);
    expect(left.z).toBeCloseTo(-right.z, 12);
  });

  it('builds unit aim directions and normalizes safely', () => {
    const d = v3FromYawPitch(0.3, 0.4);
    expect(v3Len(d)).toBeCloseTo(1, 12);
    expect(d.y).toBeCloseTo(Math.sin(0.4), 12);
    expect(v2Normalize({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
    const up = v3Cross({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
    expect(up).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe('seeded random numbers', () => {
  it('is deterministic and pinned to known values', () => {
    // These literals pin the algorithm: the city and every replay depend on this exact stream.
    const rng = createRng(9001);
    const first = [rngU32(rng), rngU32(rng), rngU32(rng), rngU32(rng)];
    const again = createRng(9001);
    expect([rngU32(again), rngU32(again), rngU32(again), rngU32(again)]).toEqual(first);
    expect(first).toMatchInlineSnapshot(`
      [
        227879533,
        827814544,
        1222908360,
        1591367383,
      ]
    `);
    expect(hash32(1, 2, 3)).toMatchInlineSnapshot(`1796040242`);
  });

  it('gives different streams for different seeds and forks', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(rngU32(a)).not.toBe(rngU32(b));
    const parent = createRng(5);
    const child = rngFork(parent);
    expect(rngU32(child)).not.toBe(rngU32(parent));
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });

  it('produces uniform floats in [0, 1) with a sane mean', () => {
    const rng = createRng(123);
    let sum = 0;
    const buckets = new Array<number>(10).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const f = rngFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += f;
      buckets[Math.floor(f * 10)]++;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    for (const b of buckets) {
      expect(b).toBeGreaterThan(n / 10 - 250);
      expect(b).toBeLessThan(n / 10 + 250);
    }
  });

  it('covers integer ranges, picks, weights and shuffles', () => {
    const rng = createRng(77);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rngIntRange(rng, 3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
    expect(rngInt(rng, 0)).toBe(0);
    expect(['a', 'b', 'c']).toContain(rngPick(rng, ['a', 'b', 'c']));
    expect(() => rngPick(rng, [])).toThrow();
    expect(rngWeightedIndex(rng, [0, 0, 5])).toBe(2);
    expect(rngWeightedIndex(rng, [0, 0])).toBe(-1);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rngShuffle(rng, items.slice());
    expect(shuffled.slice().sort((x, y) => x - y)).toEqual(items);
    expect(rngChance(rng, 0)).toBe(false);
    expect(rngChance(rng, 1)).toBe(true);
  });

  it('draws gaussian-like values and points in a disc', () => {
    const rng = createRng(4);
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const g = rngGauss(rng);
      sum += g;
      sq += g * g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.03);
    expect(sq / n).toBeGreaterThan(0.95);
    expect(sq / n).toBeLessThan(1.05);
    const p = { x: 0, z: 0 };
    for (let i = 0; i < 200; i++) {
      rngInDisc(rng, 28, p);
      expect(p.x * p.x + p.z * p.z).toBeLessThanOrEqual(28 * 28 + 1e-9);
    }
  });
});
