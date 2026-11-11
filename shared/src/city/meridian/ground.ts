/**
 * A fine raster of what the ground is (land, water, park, plaza) that the generator consults
 * while it lays streets, buildings and props. Built from the hand-made area polygons with the
 * same scanline rule as the game's own ground raster (spatialIndex.ts), only finer. Integer and
 * plain arithmetic only: identical on every engine.
 */

import type { Vec2 } from '../../math/vec';
import { DIR_COS, DIR_SIN } from './dirs';
import type { Box } from './geo';

/** Side of a cell, meters. */
export const G_CELL = 2;
export const G_LAND = 0;
export const G_WATER = 1;
export const G_PARK = 2;
export const G_PLAZA = 3;
/** Beyond the city square. */
export const G_OUT = 4;

export interface Ground {
  half: number;
  cols: number;
  cells: Uint8Array;
}

export interface GroundArea {
  kind: 'water' | 'park' | 'plaza';
  polygon: readonly Vec2[];
}

export function buildGround(areas: readonly GroundArea[], half: number): Ground {
  const cols = Math.ceil((half * 2) / G_CELL);
  const g: Ground = { half, cols, cells: new Uint8Array(cols * cols) };
  // Later kinds win where areas overlap: water over park over plaza (as in the city index).
  for (const a of areas) if (a.kind === 'plaza') fill(g, a.polygon, G_PLAZA);
  for (const a of areas) if (a.kind === 'park') fill(g, a.polygon, G_PARK);
  for (const a of areas) if (a.kind === 'water') fill(g, a.polygon, G_WATER);
  return g;
}

function fill(g: Ground, polygon: readonly Vec2[], code: number): void {
  const n = polygon.length;
  if (n < 3) return;
  const { half, cols, cells } = g;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of polygon) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const r0 = Math.max(0, Math.floor((minZ + half) / G_CELL));
  const r1 = Math.min(cols - 1, Math.floor((maxZ + half) / G_CELL));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const zc = -half + (r + 0.5) * G_CELL;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      if (a.z <= zc === b.z <= zc) continue;
      xs.push(a.x + ((zc - a.z) / (b.z - a.z)) * (b.x - a.x));
    }
    // Insertion sort: a handful of crossings, and no dependence on the engine's sort.
    for (let i = 1; i < xs.length; i++) {
      const v = xs[i];
      let j = i - 1;
      while (j >= 0 && xs[j] > v) {
        xs[j + 1] = xs[j];
        j--;
      }
      xs[j + 1] = v;
    }
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] + half) / G_CELL - 0.5));
      const c1 = Math.min(cols - 1, Math.ceil((xs[k + 1] + half) / G_CELL - 0.5) - 1);
      for (let c = c0; c <= c1; c++) cells[r * cols + c] = code;
    }
  }
}

export function groundAt(g: Ground, x: number, z: number): number {
  const c = Math.floor((x + g.half) / G_CELL);
  const r = Math.floor((z + g.half) / G_CELL);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.cols) return G_OUT;
  return g.cells[r * g.cols + c];
}

/** True when the point and eight points `reach` meters around it are all plain land. */
export function landAround(g: Ground, x: number, z: number, reach: number): boolean {
  if (groundAt(g, x, z) !== G_LAND) return false;
  const d = reach * 0.7071067811865476;
  return (
    groundAt(g, x + reach, z) === G_LAND &&
    groundAt(g, x - reach, z) === G_LAND &&
    groundAt(g, x, z + reach) === G_LAND &&
    groundAt(g, x, z - reach) === G_LAND &&
    groundAt(g, x + d, z + d) === G_LAND &&
    groundAt(g, x - d, z + d) === G_LAND &&
    groundAt(g, x + d, z - d) === G_LAND &&
    groundAt(g, x - d, z - d) === G_LAND
  );
}

/** True when no point within `reach` meters (eight probes and the point itself) is water. */
export function dryAround(g: Ground, x: number, z: number, reach: number): boolean {
  if (groundAt(g, x, z) === G_WATER) return false;
  const d = reach * 0.7071067811865476;
  return (
    groundAt(g, x + reach, z) !== G_WATER &&
    groundAt(g, x - reach, z) !== G_WATER &&
    groundAt(g, x, z + reach) !== G_WATER &&
    groundAt(g, x, z - reach) !== G_WATER &&
    groundAt(g, x + d, z + d) !== G_WATER &&
    groundAt(g, x - d, z + d) !== G_WATER &&
    groundAt(g, x + d, z - d) !== G_WATER &&
    groundAt(g, x - d, z - d) !== G_WATER
  );
}

/**
 * True when a box, grown by `margin` on every side, stands on buildable ground: its outline
 * (sampled every cell) and a coarse grid inside it are all land, or, with `openOk`, park or
 * plaza too; never water, never beyond `limit` from the city center on either axis.
 */
export function boxOnGround(g: Ground, b: Box, margin: number, openOk: boolean, limit: number): boolean {
  const c = DIR_COS[b.dir];
  const s = DIR_SIN[b.dir];
  const hx = b.hx + margin;
  const hz = b.hz + margin;
  const nx = Math.max(1, Math.ceil((hx * 2) / G_CELL));
  const nz = Math.max(1, Math.ceil((hz * 2) / G_CELL));
  for (let i = 0; i <= nx; i++) {
    const lx = -hx + (2 * hx * i) / nx;
    if (!spotOk(g, b, c, s, lx, -hz, openOk, limit) || !spotOk(g, b, c, s, lx, hz, openOk, limit)) return false;
  }
  for (let j = 0; j <= nz; j++) {
    const lz = -hz + (2 * hz * j) / nz;
    if (!spotOk(g, b, c, s, -hx, lz, openOk, limit) || !spotOk(g, b, c, s, hx, lz, openOk, limit)) return false;
  }
  // Inside: every 6 m is plenty, no pond or square is that small.
  const ix = Math.max(1, Math.ceil((hx * 2) / 6));
  const iz = Math.max(1, Math.ceil((hz * 2) / 6));
  for (let i = 1; i < ix; i++) {
    for (let j = 1; j < iz; j++) {
      if (!spotOk(g, b, c, s, -hx + (2 * hx * i) / ix, -hz + (2 * hz * j) / iz, openOk, limit)) return false;
    }
  }
  return true;
}

/** One sample of boxOnGround: the box-local point (lx, lz). */
function spotOk(g: Ground, b: Box, c: number, s: number, lx: number, lz: number, openOk: boolean, limit: number): boolean {
  const x = b.x + lx * c + lz * s;
  const z = b.z - lx * s + lz * c;
  if (x < -limit || x > limit || z < -limit || z > limit) return false;
  const k = groundAt(g, x, z);
  return k === G_LAND || (openOk && (k === G_PARK || k === G_PLAZA));
}

/**
 * True when a street of half width `halfWidth` can run from a to b: the center line and both
 * edges (plus `margin`) stay on dry ground; with `openOk` false it also keeps off parks and plazas.
 */
export function stripOnGround(
  g: Ground,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  halfWidth: number,
  margin: number,
  openOk: boolean,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l === 0) return true;
  const ux = dx / l;
  const uz = dz / l;
  const off = halfWidth + margin;
  const steps = Math.max(1, Math.ceil(l / G_CELL));
  for (let i = 0; i <= steps; i++) {
    const t = (l * i) / steps;
    const x = ax + ux * t;
    const z = az + uz * t;
    for (let side = -1; side <= 1; side++) {
      const k = groundAt(g, x - uz * off * side, z + ux * off * side);
      if (k === G_WATER || k === G_OUT) return false;
      if (!openOk && k !== G_LAND) return false;
    }
  }
  return true;
}
