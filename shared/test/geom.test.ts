import { describe, expect, it } from 'vitest';
import {
  boundsContains,
  boundsFromCenter,
  boundsInside,
  boundsOverlap,
  castCapsule,
  circleInArc,
  circleVsObb,
  closestPointOnObb,
  closestTOnSegment2,
  createCastHit,
  createContact,
  createRng,
  DEG,
  distPointObb,
  distSqPointSegment2,
  obbBounds,
  obbCorners,
  obbInArc,
  obbVsObb,
  PI,
  pointInArc,
  pointInCone,
  pointInObb,
  rayVsCapsule,
  rayVsPrism,
  rngRange,
  segmentVsCapsule,
  segmentVsCircle2,
  segmentVsObb2,
  segmentVsPrism,
  sphereInCone,
  v3Normalize,
  type OrientedBox,
  type VerticalCapsule,
} from '../src/math';

const axisBox: OrientedBox = { x: 10, z: 20, hx: 4, hz: 2, yaw: 0 };
const turnedBox: OrientedBox = { x: 0, z: 0, hx: 10, hz: 2, yaw: PI / 4 };

describe('bounds', () => {
  it('contains, overlaps and nests', () => {
    const b = boundsFromCenter(0, 0, 180);
    expect(boundsContains(b, 179, -179)).toBe(true);
    expect(boundsContains(b, 179, -179, 2)).toBe(false);
    expect(boundsOverlap(b, boundsFromCenter(300, 0, 130))).toBe(true);
    expect(boundsOverlap(b, boundsFromCenter(400, 0, 100))).toBe(false);
    expect(boundsInside(boundsFromCenter(10, 10, 50), b)).toBe(true);
    expect(boundsInside(boundsFromCenter(150, 10, 50), b)).toBe(false);
  });

  it('wraps an oriented box', () => {
    const b = obbBounds(turnedBox);
    const reach = (10 + 2) * Math.SQRT1_2;
    expect(b.maxX).toBeCloseTo(reach, 9);
    expect(b.minZ).toBeCloseTo(-reach, 9);
    for (const c of obbCorners(turnedBox)) {
      expect(boundsContains(b, c.x, c.z, -1e-9)).toBe(true);
    }
  });
});

describe('points and circles against oriented boxes', () => {
  it('tests point containment with rotation', () => {
    expect(pointInObb(13.9, 21.9, axisBox)).toBe(true);
    expect(pointInObb(14.1, 20, axisBox)).toBe(false);
    // The long axis of turnedBox runs along local X = (cos 45, -sin 45).
    expect(pointInObb(6, -6, turnedBox)).toBe(true);
    expect(pointInObb(6, 6, turnedBox)).toBe(false);
  });

  it('measures distance and closest points', () => {
    expect(distPointObb(17, 20, axisBox)).toBeCloseTo(3, 12);
    expect(distPointObb(10, 20, axisBox)).toBe(0);
    expect(distPointObb(17, 26, axisBox)).toBeCloseTo(5, 12);
    const out = { x: 0, z: 0 };
    closestPointOnObb(17, 26, axisBox, out);
    expect(out).toEqual({ x: 14, z: 22 });
  });

  it('reports the shortest push for a circle outside the box', () => {
    const c = createContact();
    expect(circleVsObb(16, 20, 3, axisBox, c)).toBe(true);
    expect(c.nx).toBeCloseTo(1, 12);
    expect(c.nz).toBeCloseTo(0, 12);
    expect(c.depth).toBeCloseTo(1, 12);
    expect(circleVsObb(17, 20, 3, axisBox)).toBe(false);
    expect(circleVsObb(17.5, 20, 3, axisBox)).toBe(false);
    // Corner contact pushes diagonally.
    expect(circleVsObb(15, 23, 2, axisBox, c)).toBe(true);
    expect(c.nx).toBeCloseTo(Math.SQRT1_2, 9);
    expect(c.nz).toBeCloseTo(Math.SQRT1_2, 9);
    expect(c.depth).toBeCloseTo(2 - Math.SQRT2, 9);
  });

  it('pushes a circle whose center is inside out through the nearest face', () => {
    const c = createContact();
    expect(circleVsObb(10.5, 21.5, 1, axisBox, c)).toBe(true);
    expect(c.nx).toBeCloseTo(0, 12);
    expect(c.nz).toBeCloseTo(1, 12);
    expect(c.depth).toBeCloseTo(1.5, 12);
  });

  it('separates the circle after applying the contact, for random rotated boxes', () => {
    const rng = createRng(31);
    const c = createContact();
    let overlaps = 0;
    for (let i = 0; i < 2000; i++) {
      const box: OrientedBox = {
        x: rngRange(rng, -5, 5),
        z: rngRange(rng, -5, 5),
        hx: rngRange(rng, 1, 8),
        hz: rngRange(rng, 1, 8),
        yaw: rngRange(rng, -PI, PI),
      };
      const px = rngRange(rng, -15, 15);
      const pz = rngRange(rng, -15, 15);
      const r = rngRange(rng, 0.5, 4);
      const brute = distPointObb(px, pz, box) < r;
      expect(circleVsObb(px, pz, r, box, c)).toBe(brute);
      if (!brute) continue;
      overlaps++;
      const nx = px + c.nx * (c.depth + 1e-6);
      const nz = pz + c.nz * (c.depth + 1e-6);
      expect(circleVsObb(nx, nz, r, box)).toBe(false);
      expect(Math.hypot(c.nx, c.nz)).toBeCloseTo(1, 9);
    }
    expect(overlaps).toBeGreaterThan(200);
  });

  it('detects box against box overlap', () => {
    expect(obbVsObb(axisBox, { x: 17, z: 20, hx: 4, hz: 2, yaw: 0 })).toBe(true);
    expect(obbVsObb(axisBox, { x: 18.5, z: 20, hx: 4, hz: 2, yaw: 0 })).toBe(false);
    // A diagonal box that pokes between two axis-aligned corners.
    // Its long axis (local X) at yaw -45 degrees runs along (+x, +z), toward the corner (14, 22).
    expect(obbVsObb(axisBox, { x: 16, z: 24, hx: 3, hz: 0.5, yaw: -PI / 4 })).toBe(true);
    expect(obbVsObb(axisBox, { x: 18, z: 26, hx: 3, hz: 0.5, yaw: -PI / 4 })).toBe(false);
    // Turned the other way it runs past the corner without touching.
    expect(obbVsObb(axisBox, { x: 16, z: 24, hx: 3, hz: 0.5, yaw: PI / 4 })).toBe(false);
  });
});

describe('casts against box prisms', () => {
  const hit = createCastHit();

  it('finds the entry point and face normal of a flat shot', () => {
    const ok = segmentVsPrism({ x: 0, y: 5, z: 20 }, { x: 20, y: 5, z: 20 }, axisBox, 0, 30, hit);
    expect(ok).toBe(true);
    expect(hit.t).toBeCloseTo(6 / 20, 12);
    expect(hit.nx).toBeCloseTo(-1, 12);
    expect(hit.ny).toBe(0);
    expect(hit.nz).toBeCloseTo(0, 12);
  });

  it('lets shots fly over the roof and hit it from above', () => {
    expect(segmentVsPrism({ x: 0, y: 31, z: 20 }, { x: 20, y: 31, z: 20 }, axisBox, 0, 30)).toBe(false);
    const ok = segmentVsPrism({ x: 10, y: 60, z: 20 }, { x: 10, y: 0, z: 20 }, axisBox, 0, 30, hit);
    expect(ok).toBe(true);
    expect(hit.t).toBeCloseTo(0.5, 12);
    expect(hit.ny).toBe(1);
  });

  it('stops short segments and reports starts inside', () => {
    expect(segmentVsPrism({ x: 0, y: 5, z: 20 }, { x: 5, y: 5, z: 20 }, axisBox, 0, 30)).toBe(false);
    const ok = segmentVsPrism({ x: 10, y: 5, z: 20 }, { x: 40, y: 5, z: 20 }, axisBox, 0, 30, hit);
    expect(ok).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.nx).toBe(0);
    expect(hit.nz).toBe(0);
  });

  it('handles rotated boxes and gives distances for rays', () => {
    // Fire along +Z toward the diagonal slab; it crosses the Z axis between z = -2.83 and +2.83.
    const dir = { x: 0, y: 0, z: 1 };
    const ok = rayVsPrism({ x: 0, y: 1, z: -50 }, dir, 100, turnedBox, 0, 10, hit);
    expect(ok).toBe(true);
    expect(hit.t).toBeCloseTo(50 - 2 * Math.SQRT2, 9);
    // The face normal points back toward the shooter, tilted with the box.
    expect(hit.nz).toBeLessThan(0);
    expect(Math.hypot(hit.nx, hit.nz)).toBeCloseTo(1, 9);
    expect(rayVsPrism({ x: 0, y: 1, z: -50 }, dir, 40, turnedBox, 0, 10)).toBe(false);
    expect(rayVsPrism({ x: 30, y: 1, z: -50 }, dir, 100, turnedBox, 0, 10)).toBe(false);
  });

  it('agrees with a brute-force march for random rays', () => {
    const rng = createRng(8);
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      const box: OrientedBox = {
        x: rngRange(rng, -10, 10),
        z: rngRange(rng, -10, 10),
        hx: rngRange(rng, 1, 9),
        hz: rngRange(rng, 1, 9),
        yaw: rngRange(rng, -PI, PI),
      };
      const top = rngRange(rng, 3, 40);
      const origin = { x: rngRange(rng, -40, 40), y: rngRange(rng, 0, 50), z: rngRange(rng, -40, 40) };
      // Aim roughly at the box so about half the rays hit.
      const aim = {
        x: box.x + rngRange(rng, -12, 12) - origin.x,
        y: rngRange(rng, 0, top + 6) - origin.y,
        z: box.z + rngRange(rng, -12, 12) - origin.z,
      };
      const dir = v3Normalize(aim);
      const ok = rayVsPrism(origin, dir, 120, box, 0, top, hit);
      let brute = -1;
      for (let d = 0; d <= 120; d += 0.05) {
        const x = origin.x + dir.x * d;
        const y = origin.y + dir.y * d;
        const z = origin.z + dir.z * d;
        if (y >= 0 && y <= top && pointInObb(x, z, box)) {
          brute = d;
          break;
        }
      }
      if (brute >= 0) {
        expect(ok).toBe(true);
        expect(hit.t).toBeLessThanOrEqual(brute + 1e-6);
        expect(hit.t).toBeGreaterThan(brute - 0.06);
        hits++;
      } else if (ok) {
        // The march can step over a thin corner clip; the exact test may still find it.
        const x = origin.x + dir.x * (hit.t + 1e-4);
        const z = origin.z + dir.z * (hit.t + 1e-4);
        expect(distPointObb(x, z, box)).toBeLessThan(1e-3);
      }
    }
    expect(hits).toBeGreaterThan(150);
  });

  it('casts ground-plane segments', () => {
    expect(segmentVsObb2(0, 20, 20, 20, axisBox)).toBeCloseTo(0.3, 12);
    expect(segmentVsObb2(0, 30, 20, 30, axisBox)).toBe(-1);
    expect(segmentVsObb2(10, 20, 20, 20, axisBox)).toBe(0);
  });
});

describe('casts against upright capsules', () => {
  const hit = createCastHit();
  // A stage 2 kaiju: 9 m radius, 32 m tall.
  const kaiju: VerticalCapsule = { x: 0, z: 0, r: 9, y0: 0, y1: 32 };

  it('hits the side wall', () => {
    const ok = segmentVsCapsule({ x: -100, y: 16, z: 0 }, { x: 100, y: 16, z: 0 }, kaiju, hit);
    expect(ok).toBe(true);
    expect(hit.t).toBeCloseTo(91 / 200, 12);
    expect(hit.nx).toBeCloseTo(-1, 12);
    expect(hit.ny).toBe(0);
  });

  it('hits the rounded top and misses above it', () => {
    // Straight down onto the top of the head.
    let ok = segmentVsCapsule({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, kaiju, hit);
    expect(ok).toBe(true);
    expect(hit.t).toBeCloseTo(0.68, 12);
    expect(hit.ny).toBeCloseTo(1, 12);
    // A flat shot at head height off center: the cap is narrower than the body there.
    // (the cap sphere is centered at y = 23, so at y = 30 it is only sqrt(81 - 49) = 5.66 m wide).
    expect(segmentVsCapsule({ x: -100, y: 30, z: 6 }, { x: 100, y: 30, z: 6 }, kaiju)).toBe(false);
    ok = segmentVsCapsule({ x: -100, y: 30, z: 3 }, { x: 100, y: 30, z: 3 }, kaiju, hit);
    expect(ok).toBe(true);
    expect(hit.ny).toBeGreaterThan(0);
    expect(segmentVsCapsule({ x: -100, y: 33, z: 0 }, { x: 100, y: 33, z: 0 }, kaiju)).toBe(false);
    expect(segmentVsCapsule({ x: -100, y: 16, z: 9.5 }, { x: 100, y: 16, z: 9.5 }, kaiju)).toBe(false);
  });

  it('treats a short capsule as a sphere and reports starts inside', () => {
    const ball: VerticalCapsule = { x: 5, z: 5, r: 3, y0: 0, y1: 2 };
    expect(castCapsule(5, 10, 5, 0, -1, 0, 20, ball, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(10 - 1 - 3, 12);
    expect(castCapsule(5, 1, 5, 1, 0, 0, 20, ball, hit)).toBe(true);
    expect(hit.t).toBe(0);
  });

  it('agrees with a brute-force march for random rays', () => {
    const rng = createRng(21);
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      const cap: VerticalCapsule = {
        x: rngRange(rng, -10, 10),
        z: rngRange(rng, -10, 10),
        r: rngRange(rng, 1, 8),
        y0: 0,
        y1: rngRange(rng, 1, 40),
      };
      const origin = { x: rngRange(rng, -40, 40), y: rngRange(rng, 0, 50), z: rngRange(rng, -40, 40) };
      const aim = {
        x: cap.x + rngRange(rng, -10, 10) - origin.x,
        y: rngRange(rng, 0, cap.y1 + 6) - origin.y,
        z: cap.z + rngRange(rng, -10, 10) - origin.z,
      };
      const dir = v3Normalize(aim);
      const ok = rayVsCapsule(origin, dir, 120, cap, hit);
      const mid = (cap.y0 + cap.y1) / 2;
      const ya = Math.min(cap.y0 + cap.r, mid);
      const yb = Math.max(cap.y1 - cap.r, mid);
      let brute = -1;
      for (let d = 0; d <= 120; d += 0.02) {
        const x = origin.x + dir.x * d - cap.x;
        const y = origin.y + dir.y * d;
        const z = origin.z + dir.z * d - cap.z;
        const sy = Math.min(Math.max(y, ya), yb);
        if (x * x + (y - sy) * (y - sy) + z * z <= cap.r * cap.r) {
          brute = d;
          break;
        }
      }
      if (brute >= 0) {
        expect(ok).toBe(true);
        expect(hit.t).toBeLessThanOrEqual(brute + 1e-6);
        expect(hit.t).toBeGreaterThan(brute - 0.03);
        if (hit.t > 0) expect(Math.hypot(hit.nx, hit.ny, hit.nz)).toBeCloseTo(1, 6);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(150);
  });
});

describe('ground-plane segments and circles', () => {
  it('finds closest points and distances', () => {
    expect(closestTOnSegment2(5, 3, 0, 0, 10, 0)).toBeCloseTo(0.5, 12);
    expect(closestTOnSegment2(-5, 3, 0, 0, 10, 0)).toBe(0);
    expect(distSqPointSegment2(5, 3, 0, 0, 10, 0)).toBeCloseTo(9, 12);
    expect(distSqPointSegment2(13, 4, 0, 0, 10, 0)).toBeCloseTo(25, 12);
  });

  it('casts a segment against a circle (a thick beam against a unit)', () => {
    expect(segmentVsCircle2(0, 0, 100, 0, 50, 0, 5)).toBeCloseTo(0.45, 12);
    expect(segmentVsCircle2(0, 0, 100, 0, 50, 6, 5)).toBe(-1);
    expect(segmentVsCircle2(0, 0, 100, 0, 50, 6, 5 + 1.5)).toBeGreaterThan(0);
    expect(segmentVsCircle2(48, 0, 100, 0, 50, 0, 5)).toBe(0);
    expect(segmentVsCircle2(0, 0, 40, 0, 50, 0, 5)).toBe(-1);
  });
});

describe('arcs and cones', () => {
  it('tests points against a swipe arc', () => {
    // 120 degree arc facing +Z with reach 6.
    expect(pointInArc(0, 5, 0, 0, 0, 60 * DEG, 6)).toBe(true);
    expect(pointInArc(0, 7, 0, 0, 0, 60 * DEG, 6)).toBe(false);
    expect(pointInArc(4, 2.5, 0, 0, 0, 60 * DEG, 6)).toBe(true);
    expect(pointInArc(4, 2, 0, 0, 0, 60 * DEG, 6)).toBe(false);
    expect(pointInArc(0, -1, 0, 0, 0, 60 * DEG, 6)).toBe(false);
    expect(pointInArc(0, 0, 0, 0, 0, 60 * DEG, 6)).toBe(true);
    // Facing backward across the angle seam.
    expect(pointInArc(0.1, -5, 0, 0, PI, 60 * DEG, 6)).toBe(true);
    expect(pointInArc(-0.1, -5, 0, 0, PI, 60 * DEG, 6)).toBe(true);
  });

  it('widens the arc by the size of a circular body', () => {
    expect(circleInArc(0, 8, 3, 0, 0, 0, 60 * DEG, 6)).toBe(true);
    expect(circleInArc(0, 9.5, 3, 0, 0, 0, 60 * DEG, 6)).toBe(false);
    expect(circleInArc(5, 1, 3, 0, 0, 0, 60 * DEG, 6)).toBe(true);
    expect(circleInArc(0, -4, 3, 0, 0, 0, 60 * DEG, 6)).toBe(false);
    expect(circleInArc(0, -2, 3, 0, 0, 0, 60 * DEG, 6)).toBe(true);
  });

  it('tests structure footprints against an arc', () => {
    const house: OrientedBox = { x: 0, z: 12, hx: 5, hz: 4, yaw: 0.3 };
    expect(obbInArc(house, 0, 0, 0, 60 * DEG, 9)).toBe(true);
    expect(obbInArc(house, 0, 0, 0, 60 * DEG, 6)).toBe(false);
    expect(obbInArc(house, 0, 0, PI, 60 * DEG, 20)).toBe(false);
    // A long wall crossing the whole arc with no corner inside it.
    const wall: OrientedBox = { x: 0, z: 5, hx: 60, hz: 0.5, yaw: 0 };
    expect(obbInArc(wall, 0, 0, 0, 60 * DEG, 6)).toBe(true);
    expect(obbInArc(wall, 0, 0, 0, 60 * DEG, 4)).toBe(false);
  });

  it('tests points and spheres against a 3D cone', () => {
    const apex = { x: 0, y: 10, z: 0 };
    const dir = { x: 0, y: 0, z: 1 };
    expect(pointInCone({ x: 0, y: 10, z: 50 }, apex, dir, 15 * DEG, 100)).toBe(true);
    expect(pointInCone({ x: 0, y: 10, z: 150 }, apex, dir, 15 * DEG, 100)).toBe(false);
    expect(pointInCone({ x: 20, y: 10, z: 50 }, apex, dir, 15 * DEG, 100)).toBe(false);
    expect(pointInCone({ x: 0, y: 22, z: 50 }, apex, dir, 15 * DEG, 100)).toBe(true);
    expect(pointInCone({ x: 0, y: 10, z: -5 }, apex, dir, 15 * DEG, 100)).toBe(false);
    expect(sphereInCone({ x: 20, y: 10, z: 50 }, 8, apex, dir, 15 * DEG, 100)).toBe(true);
    expect(sphereInCone({ x: 20, y: 10, z: 50 }, 2, apex, dir, 15 * DEG, 100)).toBe(false);
  });
});
