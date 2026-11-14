/**
 * Turns the hand-made water, park and plaza data (layout.ts, map coordinates) into the city's
 * area polygons in world coordinates: the sea with its bay, quays and mole, the River Wend as
 * two channels that part around Chapter Island, every park and plaza, and the Old Moat along the
 * city limit.
 */

import type { Vec2 } from '../../math/vec';
import type { Area, AreaKind } from '../types';
import { DIR_COS, DIR_COUNT, DIR_SIN } from './dirs';
import { chaikinOpen, quant } from './geo';
import { MOATS, OPEN, RIVER, SEA, type Pt } from './layout';

/** Map point [east, north] to world: +X is west on the map. */
export function toWorld(p: Pt): Vec2 {
  return { x: -p[0], z: p[1] };
}

/** A point snapped to 1/8 m, like every other final coordinate of the city. */
function snapped(x: number, z: number): Vec2 {
  return { x: quant(x), z: quant(z) };
}

export function rectPolygon(r: readonly [number, number, number, number]): Vec2[] {
  return [
    { x: -r[0], z: r[1] },
    { x: -r[2], z: r[1] },
    { x: -r[2], z: r[3] },
    { x: -r[0], z: r[3] },
  ];
}

/** A 16-sided polygon of the given radius (corners on the heading table). */
export function discPolygon(e: number, n: number, radius: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < 16; k++) {
    const i = k * (DIR_COUNT / 16);
    out.push(snapped(-e + DIR_SIN[i] * radius, n + DIR_COS[i] * radius));
  }
  return out;
}

interface RiverPoint {
  x: number;
  z: number;
  /** Half width of the water on each side of the island (or of the whole river where there is none). */
  half: number;
  /** Half width of the island; 0 where the river is one channel. */
  isle: number;
}

/** Corner cutting on the river's control points, widths included. */
function smoothRiver(points: RiverPoint[]): RiverPoint[] {
  const out: RiverPoint[] = [points[0]];
  const mix = (a: RiverPoint, b: RiverPoint, t: number): RiverPoint => ({
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    half: a.half + (b.half - a.half) * t,
    isle: a.isle + (b.isle - a.isle) * t,
  });
  for (let i = 0; i + 1 < points.length; i++) {
    if (i > 0) out.push(mix(points[i], points[i + 1], 0.25));
    if (i + 2 < points.length) out.push(mix(points[i], points[i + 1], 0.75));
  }
  out.push(points[points.length - 1]);
  return out;
}

export interface River {
  /** The two channels as polygons (they overlap along the middle where there is no island). */
  west: Vec2[];
  east: Vec2[];
  /** The center line, north to south. */
  center: Vec2[];
  /** The two banks, north to south. */
  bankWest: Vec2[];
  bankEast: Vec2[];
}

export function buildRiver(): River {
  let pts: RiverPoint[] = RIVER.map((r) => ({ x: -r[0], z: r[1], half: r[2], isle: r[3] }));
  pts = smoothRiver(smoothRiver(pts));
  const n = pts.length;
  const bankA: Vec2[] = [];
  const bankB: Vec2[] = [];
  const midA: Vec2[] = [];
  const midB: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[i > 0 ? i - 1 : i];
    const b = pts[i + 1 < n ? i + 1 : i];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.sqrt(tx * tx + tz * tz);
    tx /= l;
    tz /= l;
    // The normal to one side; which bank is "A" does not matter as long as it is the same all along.
    const nx = -tz;
    const nz = tx;
    const outer = p.half + p.isle;
    // With an island the dividing line follows its shores; without one the channels overlap a little.
    const inner = p.isle > 2 ? p.isle : -1.5;
    bankA.push(snapped(p.x + nx * outer, p.z + nz * outer));
    bankB.push(snapped(p.x - nx * outer, p.z - nz * outer));
    midA.push(snapped(p.x + nx * inner, p.z + nz * inner));
    midB.push(snapped(p.x - nx * inner, p.z - nz * inner));
  }
  const channel = (bank: Vec2[], mid: Vec2[]): Vec2[] => {
    const poly = bank.map((p) => ({ x: p.x, z: p.z }));
    for (let i = n - 1; i >= 0; i--) poly.push({ x: mid[i].x, z: mid[i].z });
    return poly;
  };
  // Flowing south (-Z), the normal (-tz, tx) points to +X: the west bank on the map.
  return {
    west: channel(bankA, midA),
    east: channel(bankB, midB),
    center: pts.map((p) => snapped(p.x, p.z)),
    bankWest: bankA,
    bankEast: bankB,
  };
}

export function buildSea(): Vec2[] {
  const out: Vec2[] = [];
  for (const run of SEA) {
    let pts = run.pts.map(toWorld);
    if (run.smooth) pts = chaikinOpen(chaikinOpen(pts));
    for (const p of pts) out.push(snapped(p.x, p.z));
  }
  return out;
}

/** Every area of the city, water first. Ids are the array indexes. */
export function buildAreas(): Area[] {
  const areas: Area[] = [];
  const add = (kind: AreaKind, name: string, polygon: Vec2[]): void => {
    // Every outline point on the 1/8 m grid (the hand-made ones already are; this is the guarantee).
    areas.push({ id: areas.length, kind, name, polygon: polygon.map((p) => snapped(p.x, p.z)) });
  };
  const river = buildRiver();
  add('water', 'Meridian Bay', buildSea());
  add('water', 'River Wend', river.west);
  add('water', 'River Wend', river.east);
  for (const o of OPEN) {
    const polygon = o.rect ? rectPolygon(o.rect) : o.disc ? discPolygon(o.disc[0], o.disc[1], o.disc[2]) : (o.poly ?? []).map(toWorld);
    add(o.kind, o.name, polygon);
  }
  // Last, so the ids of everything above (which seed their furnishing) stay what they were.
  for (const m of MOATS) add('water', m.name, rectPolygon(m.rect));
  return areas;
}
