/**
 * The monster's slash trails (docs/ROADMAP.md phase 3): bright arcs from the claw tips through
 * a swipe's strike, from the tail tip through a tail sweep, behind the fast-food sign's head
 * through the club's swing (phase 2), and the short shock ring where a stomp's foot lands. One
 * system for all of them: a trail is the band swept between two paths (the tip's, and a point
 * further in: the claws' roots, the sign's middle), oldest point first, drawn as a ribbon that
 * is clear at its tail and hot at its head (`TrailRibbons`, one draw call for every trail), with
 * a glowing edge along the tip in the line batch. The monster's colors, an orange that reads
 * against a bright sky or grass; brighter and blue-white during a power surge (the surge's own
 * light, never the humans' cyan).
 *
 * The paths are worked out from the motion itself (where the claw is at each moment of the
 * strike), not recorded frame by frame, so a trail reads the same at any frame rate.
 */

import * as THREE from 'three';
import type { Effects } from './effects';
import type { LineBatch } from './lineBatch';

/**
 * Linear colors: the band at the tip and toward its inner edge, the hot rim along the tip, and
 * the glow along it (added light, so it shows from far off); the same in a power surge.
 */
const TIP = { r: 1, g: 0.42, b: 0.08 };
const INNER = { r: 1, g: 0.22, b: 0.03 };
const RIM = { r: 1, g: 0.86, b: 0.5 };
const EDGE = { r: 1, g: 0.66, b: 0.3 };
const SURGE_TIP = { r: 0.72, g: 0.8, b: 1 };
const SURGE_INNER = { r: 0.42, g: 0.5, b: 1 };
const SURGE_RIM = { r: 0.95, g: 0.97, b: 1 };
const SURGE_EDGE = { r: 0.85, g: 0.9, b: 1 };
type Rgb = { r: number; g: number; b: number };

/** How much brighter a trail is during a power surge. */
const SURGE_BOOST = 1.5;
/** The band's opacity at its head, along the tip and along the inner edge; the rim's. */
const TIP_ALPHA = 1;
const INNER_ALPHA = 0.55;
const RIM_ALPHA = 0.95;
/** The hot rim is this share of the band, along its tip. */
const RIM_SHARE = 0.14;

/** A trail's path: x, y, z of each point, oldest first, `count` points. */
export interface TrailPath {
  pts: number[];
  count: number;
}

export function createTrailPath(): TrailPath {
  return { pts: [], count: 0 };
}

export function clearTrail(path: TrailPath): void {
  path.count = 0;
}

export function addTrailPoint(path: TrailPath, x: number, y: number, z: number): void {
  const o = path.count * 3;
  path.pts[o] = x;
  path.pts[o + 1] = y;
  path.pts[o + 2] = z;
  path.count++;
}

/** Every slash trail of a frame in one dynamic mesh (one draw call): begin(), ribbon(...) for each, end(). */
export class TrailRibbons {
  readonly mesh: THREE.Mesh;
  /** The most quads (trail segments) a frame can hold. */
  readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private quads = 0;

  constructor(capacity = 256) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 4 * 3);
    this.colors = new Float32Array(capacity * 4 * 4);
    const index: number[] = [];
    for (let q = 0; q < capacity; q++) index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    this.geometry = geometry;
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
    this.mesh.visible = false;
  }

  begin(): void {
    this.quads = 0;
  }

  /**
   * A slash trail: the band between the `tip` path and the `inner` one (the same number of
   * points, oldest first), clear at its tail and hottest at its head, with a hot rim along the
   * tip and, when `edgeWidth` is above 0, a glow along it that far across (added light, in
   * `lines`: it carries the trail to a distant eye). `fade` (0 to 1) dims all of it: a trail
   * fades out over the follow-through.
   */
  ribbon(tip: TrailPath, inner: TrailPath, fade: number, surge: boolean, lines: LineBatch | null, edgeWidth: number): void {
    const n = Math.min(tip.count, inner.count);
    if (n < 2 || fade <= 0.01) return;
    const boost = surge ? SURGE_BOOST : 1;
    const ct = surge ? SURGE_TIP : TIP;
    const ci = surge ? SURGE_INNER : INNER;
    const cr = surge ? SURGE_RIM : RIM;
    const ce = surge ? SURGE_EDGE : EDGE;
    const t = tip.pts;
    const s = inner.pts;
    const r = this.rim;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      for (let k = 0; k < 3; k++) r[o + k] = t[o + k] + (s[o + k] - t[o + k]) * RIM_SHARE;
    }
    for (let i = 1; i < n && this.quads + 2 <= this.capacity; i++) {
      const f0 = (i - 1) / (n - 1);
      const f1 = i / (n - 1);
      // Clear at the tail, solid toward the head.
      const a0 = fade * f0 ** 1.2 * boost;
      const a1 = fade * f1 ** 1.2 * boost;
      const o0 = (i - 1) * 3;
      const o1 = i * 3;
      this.quad(t, s, o0, o1, ct, ci, Math.min(1, TIP_ALPHA * a0), Math.min(1, TIP_ALPHA * a1), Math.min(1, INNER_ALPHA * a0), Math.min(1, INNER_ALPHA * a1));
      this.quad(t, r, o0, o1, cr, cr, Math.min(1, RIM_ALPHA * a0), Math.min(1, RIM_ALPHA * a1), Math.min(1, RIM_ALPHA * a0), Math.min(1, RIM_ALPHA * a1));
      if (lines && edgeWidth > 0) {
        lines.push(t[o0], t[o0 + 1], t[o0 + 2], t[o1], t[o1 + 1], t[o1 + 2], edgeWidth * (0.4 + 0.6 * f1), ce.r, ce.g, ce.b, Math.min(1, 0.7 * a1));
      }
    }
  }

  /** The rim's path (scratch). */
  private readonly rim: number[] = [];

  /** One quad: from point o0 to o1 along the `a` and `b` paths, colored and see-through by corner. */
  private quad(a: number[], b: number[], o0: number, o1: number, ca: Rgb, cb: Rgb, aa0: number, aa1: number, ab0: number, ab1: number): void {
    const q = this.quads++;
    const p = q * 12;
    const c = q * 16;
    this.set(p, c, 0, a, o0, ca, aa0);
    this.set(p, c, 1, a, o1, ca, aa1);
    this.set(p, c, 2, b, o1, cb, ab1);
    this.set(p, c, 3, b, o0, cb, ab0);
  }

  private set(p: number, c: number, corner: number, pts: number[], o: number, color: Rgb, alpha: number): void {
    const pos = this.positions;
    const col = this.colors;
    pos[p + corner * 3] = pts[o];
    pos[p + corner * 3 + 1] = pts[o + 1];
    pos[p + corner * 3 + 2] = pts[o + 2];
    col[c + corner * 4] = color.r;
    col[c + corner * 4 + 1] = color.g;
    col[c + corner * 4 + 2] = color.b;
    col[c + corner * 4 + 3] = alpha;
  }

  /** How many trail segments this frame holds. */
  get size(): number {
    return this.quads;
  }

  end(): void {
    const g = this.geometry;
    g.setDrawRange(0, this.quads * 6);
    this.mesh.visible = this.quads > 0;
    if (this.quads === 0) return;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    pos.clearUpdateRanges();
    pos.addUpdateRange(0, this.quads * 12);
    pos.needsUpdate = true;
    col.clearUpdateRanges();
    col.addUpdateRange(0, this.quads * 16);
    col.needsUpdate = true;
  }
}

/**
 * The short shock ring where a stomping foot lands (x, z on the ground), `size` meters across
 * at its widest: a bright ring that snaps out and fades, a flash at the heel, sparks in a surge.
 */
export function stompShock(effects: Effects, x: number, z: number, size: number, surge: boolean): void {
  const ring = surge ? 0xd8e0ff : 0xffb050;
  effects.ring(x, z, size, ring, 0.42, 1, 0.25);
  effects.ring(x, z, size * 0.6, 0xfff2d8, 0.3, 1, 0.3);
  effects.glowAt(x, size * 0.12, z, size * (surge ? 1.5 : 1.1), surge ? 0xc8d4ff : 0xffa040, 0.2, 0.9);
  if (surge) effects.sparks(x, size * 0.1, z, size * 0.4, 6, 0xd8e0ff, 0.35);
}
