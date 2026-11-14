/**
 * Scenery round the city (docs/ROADMAP.md phase 3: "hills on the horizon"): a ring of low,
 * faceted hills beyond the Old Moat and the open land round the city, to the west, north and
 * east, with the River Wend coming down to the city through a valley between them; to the south
 * the open sea, and far out to the south-west a headland. Scenery only: nothing walks on it, no
 * rule knows it is there, and every rule still sees flat ground.
 *
 * The hills are one mesh (one draw call) on the far plain, lit like the city. They have their own
 * haze: the city's fog swallows everything past its far distance, and hills two to seven
 * kilometers out would vanish with it, so the hills take the fog as the city does up close and,
 * beyond it, a capped share of the fog's color that grows with distance (nearer ridges stand out
 * against farther, hazier ones), while their feet sink fully into the haze, where the plain has
 * gone. The sea and the river's way north are water triangles for the ground's water mesh.
 */

import * as THREE from 'three';
import { hash32 } from '@mb/shared';

/** The shape of the hills (meters; the city limit is `half` from the middle on each axis). */
export const HILLS = {
  /** Open land between the city limit and the foot of the hills. */
  foot: 520,
  /** Beyond the limit by this much, the hills have risen to their full height. */
  full: 1750,
  /** Typical height of the near hills, and of the far ridges behind them. */
  near: 190,
  far: 440,
  /** Where the far ridges take over (meters beyond the limit). */
  farFrom: 2200,
  farTo: 4300,
  /** The ring of the mesh: from this far from the middle out to that far, in rings and segments. */
  inner: 1420,
  outer: 7100,
  rings: 24,
  segments: 256,
} as const;

/**
 * The coast (meters north, at `x` meters west): along the city's south edge where the bay opens
 * to the sea, then bulging south to the west toward the headland and drawing back a little to the
 * east, where the Old Moat runs out into the sea.
 */
export function coastAt(x: number, half: number): number {
  const west = smoothstep(half, half + 2200, x);
  const east = smoothstep(half, half + 1500, -x);
  const far = smoothstep(half + 2500, half + 6000, -x);
  return -half - 620 * west + 90 * Math.sin(x / 430) * smoothstep(half + 200, half + 900, Math.abs(x)) + 300 * east - 650 * far;
}

/** The River Wend's way north from the city limit, between the hills (x, z; it enters the city at x 120). */
export const RIVER_NORTH: readonly (readonly [number, number])[] = [
  [120, 1060],
  [120, 1350],
  [70, 1750],
  [150, 2250],
  [300, 2850],
  [240, 3600],
  [80, 4400],
  [-60, 5200],
];
/** The river's half width as it leaves the city, and far out (it narrows into the distance). */
const RIVER_HALF = [34, 24];

/** The headland far out to the south-west: a ridge from the west hills out into the sea. */
const HEADLAND = { ax: 2500, az: -1350, bx: 4700, bz: -3900, width: 720, height: 300 } as const;

/** How much a face's normal y may darken it: steep slopes in shade read as relief. */
const SLOPE_DARK = 0.18;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Smooth value noise, 0..1, from integer hashes (the same on every machine). */
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const at = (i: number, j: number): number => hash32(i, j, seed) / 4294967296;
  const a = at(ix, iz);
  const b = at(ix + 1, iz);
  const c = at(ix, iz + 1);
  const d = at(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Distance from (px, pz) to the segment a-b, and how far along it (0..1) the nearest point is. */
function toSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t };
}

/** Distance from (x, z) to the river's way north, and how far along it (0 at the city, 1 at its end). */
function riverDistance(x: number, z: number): { d: number; along: number } {
  let best = { d: Number.POSITIVE_INFINITY, along: 0 };
  for (let i = 0; i + 1 < RIVER_NORTH.length; i++) {
    const [ax, az] = RIVER_NORTH[i];
    const [bx, bz] = RIVER_NORTH[i + 1];
    const s = toSegment(x, z, ax, az, bx, bz);
    if (s.d < best.d) best = { d: s.d, along: (i + s.t) / (RIVER_NORTH.length - 1) };
  }
  return best;
}

/** Meters beyond the city limit (negative inside), measured to a square with rounded corners. */
export function beyondLimit(x: number, z: number, half: number, round = 320): number {
  const qx = Math.abs(x) - (half - round);
  const qz = Math.abs(z) - (half - round);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qz), 0) - round;
}

/**
 * The height of the scenery at (x, z), meters above the plain: 0 on the open land round the city
 * (and the city itself), the hills beyond it, below 0 under the sea (south of the coast), where
 * only the headland rises.
 */
export function hillHeight(x: number, z: number, half: number): number {
  let head = 0;
  {
    const s = toSegment(x, z, HEADLAND.ax, HEADLAND.az, HEADLAND.bx, HEADLAND.bz);
    const across = 1 - smoothstep(0, HEADLAND.width * (1 - 0.35 * s.t), s.d);
    head = HEADLAND.height * (1 - 0.5 * s.t) * across * (0.7 + 0.5 * noise(x / 520, z / 520, 7));
  }
  const coast = coastAt(x, half);
  if (z < coast) return head > 4 ? head : -12;
  const d = beyondLimit(x, z, half);
  if (d <= HILLS.foot) return Math.max(0, head);
  const rise = smoothstep(HILLS.foot, HILLS.full, d);
  const range = HILLS.near + (HILLS.far - HILLS.near) * smoothstep(HILLS.farFrom, HILLS.farTo, d);
  // Big rounded masses with smaller knolls on them; ridges (1 - |2n - 1|) give the crests an edge.
  const big = noise(x / 1300, z / 1300, 1);
  const small = noise(x / 480, z / 480, 2);
  const ridge = 1 - Math.abs(2 * noise(x / 900, z / 900, 3) - 1);
  let h = rise * range * (0.3 + 0.75 * big + 0.25 * small + 0.25 * ridge);
  // The River Wend's valley through the northern hills, closed far out by the ridges it comes from.
  if (z > 0) {
    const river = riverDistance(x, z);
    const open = 1 - smoothstep(0.85, 1, river.along);
    h *= 1 - open * (1 - smoothstep(70, 300 + 200 * river.along, river.d));
  }
  // Down to the shore toward the sea.
  h *= smoothstep(coast - 50, coast + 900, z);
  return Math.max(h, head);
}

/** The colors of the hills by height: meadow at the feet, woods on the slopes, heath on the tops. */
const MEADOW = new THREE.Color(0x8fb862);
const WOODS = new THREE.Color(0x5f8f4e);
const DARK_WOODS = new THREE.Color(0x4c7a45);
const HEATH = new THREE.Color(0xa3a074);
const ROCK = new THREE.Color(0x9a948a);

/**
 * The hills' geometry: a ring of triangles round the middle, unindexed, flat shaded, a color per
 * face. Triangles that lie wholly on the open land or under the sea are left out (the plain and
 * the sea are drawn by the ground). The feet sit 1.5 m under the plain, so the plain draws the
 * line where the hills meet it, with nothing to flicker.
 */
export function hillsGeometry(half: number): THREE.BufferGeometry {
  const { inner, outer, rings, segments } = HILLS;
  const radius = (k: number): number => inner + (outer - inner) * Math.pow(k / rings, 1.7);
  // Vertex grid (positions and heights), ring by ring.
  const cols = segments;
  const px = new Float32Array((rings + 1) * cols);
  const pz = new Float32Array((rings + 1) * cols);
  const ph = new Float32Array((rings + 1) * cols);
  for (let k = 0; k <= rings; k++) {
    const r = radius(k);
    for (let i = 0; i < cols; i++) {
      // Every other ring turned half a segment: triangles, not a grid of slivers.
      const a = ((i + (k % 2) * 0.5) / cols) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const j = k * cols + i;
      px[j] = x;
      pz[j] = z;
      ph[j] = hillHeight(x, z, half);
    }
  }
  const positions: number[] = [];
  const colors: number[] = [];
  const top = HILLS.far * 1.3;
  const c = new THREE.Color();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  let face = 0;
  const tri = (a: number, b: number, d: number): void => {
    const ha = ph[a];
    const hb = ph[b];
    const hd = ph[d];
    // Wholly on the plain or under the sea: the ground draws it.
    if (Math.max(ha, hb, hd) <= 2) return;
    const ya = ha > 0 ? ha - 1.5 : ha < 0 ? -12 : -1.5;
    const yb = hb > 0 ? hb - 1.5 : hb < 0 ? -12 : -1.5;
    const yd = hd > 0 ? hd - 1.5 : hd < 0 ? -12 : -1.5;
    // Wound to face up (counter-clockwise seen from above).
    e1.set(px[b] - px[a], yb - ya, pz[b] - pz[a]);
    e2.set(px[d] - px[a], yd - ya, pz[d] - pz[a]);
    n.crossVectors(e1, e2);
    const flip = n.y < 0;
    const order = flip ? [a, d, b] : [a, b, d];
    const ys = flip ? [ya, yd, yb] : [ya, yb, yd];
    for (let v = 0; v < 3; v++) positions.push(px[order[v]], ys[v], pz[order[v]]);
    n.normalize();
    const ny = Math.abs(n.y);
    const h = (Math.max(ha, 0) + Math.max(hb, 0) + Math.max(hd, 0)) / 3;
    const pick = hash32(face++, 41) / 4294967296;
    const u = h / top;
    if (u < 0.12) c.copy(MEADOW);
    else if (u < 0.55) c.copy(pick < 0.4 ? DARK_WOODS : WOODS);
    else if (u < 0.8) c.copy(pick < 0.35 ? WOODS : HEATH);
    else c.copy(pick < 0.5 ? HEATH : ROCK);
    // Steep faces a little darker, and a little jitter from face to face.
    c.multiplyScalar((1 - SLOPE_DARK + SLOPE_DARK * ny) * (0.94 + 0.12 * pick));
    for (let v = 0; v < 3; v++) colors.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % cols;
      const a = k * cols + i;
      const b = k * cols + i1;
      const o = (k + 1) * cols;
      // The outer ring is turned half a segment from the inner one when k is even (and back when odd).
      if (k % 2 === 0) {
        tri(a, b, o + i);
        tri(b, o + i1, o + i);
      } else {
        tri(a, b, o + i1);
        tri(a, o + i1, o + i);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * How much of the fog's color the hills take (see the header): `capNear` just past the fog's far
 * distance, growing to `capFar` at `farReach` times it; the feet take all of it where the plain
 * has gone into the fog.
 */
export const HILL_HAZE = { capNear: 0.42, capFar: 0.8, farReach: 3.6, foot: 140 } as const;

/** The hills' material: lit like the city, with their own haze (one shader, kept in the program cache). */
export function hillsMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.name = 'hills';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHillY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHillY = position.y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vHillY;').replace(
      '#include <fog_fragment>',
      [
        '#ifdef USE_FOG',
        '  float hazeFar = smoothstep( fogNear, fogFar, vFogDepth );',
        `  float hazeCap = mix( ${HILL_HAZE.capNear.toFixed(3)}, ${HILL_HAZE.capFar.toFixed(3)}, smoothstep( fogFar, fogFar * ${HILL_HAZE.farReach.toFixed(2)}, vFogDepth ) );`,
        `  float hazeFoot = 1.0 - smoothstep( 0.0, ${HILL_HAZE.foot.toFixed(1)}, vHillY );`,
        '  float haze = max( min( hazeFar, hazeCap ), hazeFar * hazeFoot );',
        '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, haze );',
        '#endif',
      ].join('\n'),
    );
  };
  material.customProgramCacheKey = () => 'mb-hills-haze';
  return material;
}

/**
 * Water beyond the city, as up-facing triangles (x, z pairs) for the ground's water mesh: the
 * open sea south of the coast, as a grid of tiles (a software renderer drops one giant triangle
 * now and then), and the River Wend's way north into the hills, a strip that narrows into the
 * distance. `far` is how far out the ground goes.
 */
export function waterBeyond(half: number, far: number): number[] {
  const out: number[] = [];
  const push = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number): void => {
    // Counter-clockwise seen from above is clockwise in (x, z) numbers (ground.ts `quad`).
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross > 0) out.push(ax, az, cx, cz, bx, bz);
    else out.push(ax, az, bx, bz, cx, cz);
  };
  // The sea: strips from the coast out to the far edge, in a few pieces each.
  const columns = 96;
  const pieces = 4;
  for (let i = 0; i < columns; i++) {
    const ax = -far + (2 * far * i) / columns;
    const bx = -far + (2 * far * (i + 1)) / columns;
    const ca = coastAt(ax, half);
    const cb = coastAt(bx, half);
    for (let j = 0; j < pieces; j++) {
      const za0 = ca + ((-far - ca) * j) / pieces;
      const za1 = ca + ((-far - ca) * (j + 1)) / pieces;
      const zb0 = cb + ((-far - cb) * j) / pieces;
      const zb1 = cb + ((-far - cb) * (j + 1)) / pieces;
      push(ax, za0, bx, zb0, bx, zb1);
      push(ax, za0, bx, zb1, ax, za1);
    }
  }
  // The river: a strip along its way north, each piece a quad.
  for (let i = 0; i + 1 < RIVER_NORTH.length; i++) {
    const [ax, az] = RIVER_NORTH[i];
    const [bx, bz] = RIVER_NORTH[i + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const wa = RIVER_HALF[0] + ((RIVER_HALF[1] - RIVER_HALF[0]) * i) / (RIVER_NORTH.length - 1);
    const wb = RIVER_HALF[0] + ((RIVER_HALF[1] - RIVER_HALF[0]) * (i + 1)) / (RIVER_NORTH.length - 1);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    // A little past each end, so the pieces overlap at the bends.
    const ex = ((bx - ax) / len) * 6;
    const ez = ((bz - az) / len) * 6;
    push(ax - ex + nx * wa, az - ez + nz * wa, bx + ex + nx * wb, bz + ez + nz * wb, bx + ex - nx * wb, bz + ez - nz * wb);
    push(ax - ex + nx * wa, az - ez + nz * wa, bx + ex - nx * wb, bz + ez - nz * wb, ax - ex - nx * wa, az - ez - nz * wa);
  }
  return out;
}
