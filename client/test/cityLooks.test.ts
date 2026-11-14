/**
 * Phase 3's city looks that are not the buildings' paint (city.test.ts has the roofs): the hills
 * on the horizon and the sea round the city (render/scenery.ts), and the gas station's fireball
 * (render/fireball.ts).
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CITY_HALF } from '@mb/shared';
import { Fireballs, heatColor, smokeShare } from '../src/render/fireball';
import { beyondLimit, coastAt, HILLS, hillHeight, hillsGeometry, RIVER_NORTH, waterBeyond } from '../src/render/scenery';

const half = CITY_HALF;

describe('the hills on the horizon', () => {
  it('leave the city and the open land round it flat, and rise beyond it to the west, north and east', () => {
    // Nothing in the city or on the open land just outside it: every rule assumes flat ground.
    for (let x = -half - 300; x <= half + 300; x += 50) {
      for (let z = -half - 300; z <= half + 300; z += 50) {
        if (beyondLimit(x, z, half) < HILLS.foot) expect(Math.max(0, hillHeight(x, z, half))).toBe(0);
      }
    }
    // West (+x), north (+z), east (-x): hills a few hundred meters high a couple of kilometers out.
    const highest = (dx: number, dz: number, sx: number, sz: number): number => {
      let top = 0;
      for (let d = -1500; d <= 1500; d += 100) for (let r = 2400; r <= 5000; r += 200) top = Math.max(top, hillHeight(dx * r + sx * d, dz * r + sz * d, half));
      return top;
    };
    for (const [dx, dz, sx, sz] of [
      [1, 0, 0, 1],
      [0, 1, 1, 0],
      [-1, 0, 0, 1],
    ]) {
      const top = highest(dx, dz, sx, sz);
      expect(top).toBeGreaterThan(200);
      expect(top).toBeLessThan(800);
    }
  });

  it('give way to the open sea in the south, but for the headland, and to the river coming down from the north', () => {
    // Straight south of the city: sea all the way out.
    for (let z = -half - 100; z > -6000; z -= 250) expect(hillHeight(0, z, half)).toBeLessThan(0);
    // The headland rises out of the sea far to the south-west.
    let headland = 0;
    for (let x = 2500; x < 5000; x += 100) for (let z = -1500; z > -4000; z -= 100) if (z < coastAt(x, half)) headland = Math.max(headland, hillHeight(x, z, half));
    expect(headland).toBeGreaterThan(120);
    // The river's valley: lower along the river than a little to either side of it.
    const [rx, rz] = RIVER_NORTH[3];
    expect(hillHeight(rx, rz, half)).toBeLessThan(Math.max(hillHeight(rx + 900, rz, half), hillHeight(rx - 900, rz, half)) * 0.3);
    // The water beyond the city: up-facing triangles, south of the coast or along the river.
    const water = waterBeyond(half, 9000);
    expect(water.length % 6).toBe(0);
    for (let i = 0; i < water.length; i += 6) {
      const [ax, az, bx, bz, cx, cz] = water.slice(i, i + 6);
      // Up-facing: clockwise in (x, z) numbers (ground.ts).
      expect((bx - ax) * (cz - az) - (bz - az) * (cx - ax)).toBeLessThanOrEqual(1e-6);
    }
  });

  it('cost one mesh of a few thousand triangles, every face turned up to the sky', () => {
    const g = hillsGeometry(half);
    const p = g.getAttribute('position');
    const triangles = p.count / 3;
    expect(triangles).toBeGreaterThan(2000);
    expect(triangles).toBeLessThan(9000);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      c.fromBufferAttribute(p, i + 2);
      const n = b.sub(a).cross(c.sub(a));
      expect(n.y).toBeGreaterThanOrEqual(0);
      // Nothing inside the city's square.
      expect(Math.max(Math.abs(a.x), Math.abs(a.z))).toBeGreaterThan(half);
    }
  });
});

describe("the gas station's fireball", () => {
  it('runs from white-hot through orange and red to soot, flame turning into smoke', () => {
    const hot = heatColor(1, new THREE.Color());
    const orange = heatColor(0.6, new THREE.Color());
    const soot = heatColor(0, new THREE.Color());
    expect(hot.b).toBeGreaterThan(0.5);
    expect(orange.r).toBeGreaterThan(orange.g);
    expect(orange.g).toBeGreaterThan(orange.b);
    expect(Math.max(soot.r, soot.g, soot.b)).toBeLessThan(0.1);
    expect(smokeShare(1)).toBe(0);
    expect(smokeShare(0.5)).toBe(0);
    expect(smokeShare(0)).toBe(1);
  });

  it('rolls up and out from where the station stood, rises as a column, and is gone after a few seconds', () => {
    const fireballs = new Fireballs();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(100, 20, 0);
    fireballs.burst(0, 0, 30);
    const drawn: number[] = [];
    let top = 0;
    let wide = 0;
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    for (let t = 0; t < 9; t += 1 / 30) {
      fireballs.update(1 / 30, camera);
      drawn.push(fireballs.mesh.count);
      for (let i = 0; i < fireballs.mesh.count; i++) {
        fireballs.mesh.getMatrixAt(i, m);
        at.setFromMatrixPosition(m);
        top = Math.max(top, at.y);
        wide = Math.max(wide, Math.hypot(at.x, at.z));
      }
    }
    // Dozens of puffs at its height, one mesh; it reaches well above the blast's radius as a
    // column, spreads to about it, and is all gone well before the fire on the ruin dies (9 s).
    expect(Math.max(...drawn)).toBeGreaterThan(30);
    expect(top).toBeGreaterThan(45);
    expect(wide).toBeGreaterThan(12);
    expect(wide).toBeLessThan(60);
    expect(drawn[drawn.length - 1]).toBe(0);
    expect(fireballs.count).toBe(0);
  });
});
