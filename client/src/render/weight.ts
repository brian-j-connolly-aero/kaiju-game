/**
 * The monster's weight in the city (docs/ROADMAP.md phase 2, "monster weight"): what its feet do
 * to the street, for everyone who can see it. The camera's part (a nudge at stage 1, a jolt at
 * stage 3, fading with distance) is the match runtime's; this is the city's part.
 *
 * - A footstep (the animator's gait): a puff of dust and a low ring at the foot, cars and small
 *   props near it hop and trees and poles sway; from stage 2 on, windows burst out of the
 *   buildings beside it (glass and its sound).
 * - A landing (a stomp, the charge's stumble, the molt's new body coming out of the cocoon):
 *   standing buildings within about three times the stomp's radius sway as the shock reaches
 *   them, their windows burst, and cars are thrown higher.
 *
 * Nothing here changes the game: it is all picture, made from the mirrored city on each client.
 */

import { kaijuKindDef, kaijuStageDef, structuresInCircle, type CityData, type CityQuery, type KaijuKindId, type SnapKaiju, type StageId } from '@mb/shared';
import type { CityView } from './cityView';
import type { Effects } from './effects';

/** By stage: how far a footstep makes props hop (body radii) and how high at the foot (meters). */
const STEP_HOP_REACH: Record<StageId, number> = { 1: 2.5, 2: 3, 3: 3 };
const STEP_HOP_HEIGHT: Record<StageId, number> = { 1: 0.12, 2: 0.45, 3: 1.1 };
/** By stage: how high a landing throws the cars nearest it (meters). */
const LAND_HOP_HEIGHT: Record<StageId, number> = { 1: 0.8, 2: 1.9, 3: 3.6 };
/** By stage: the largest sway of a building next to a landing (radians). */
const LAND_SWAY: Record<StageId, number> = { 1: 0.08, 2: 0.07, 3: 0.05 };
/** How many buildings lose windows at a footstep (from stage 2) and at a landing. */
const STEP_WINDOWS: Record<StageId, number> = { 1: 0, 2: 2, 3: 3 };
const LAND_WINDOWS: Record<StageId, number> = { 1: 3, 2: 6, 3: 9 };
/** A building's windows burst at most this often (seconds). */
const WINDOW_GAP = 2.5;
/** Seconds the shock of a landing takes to reach the edge of the swaying ring. */
const SHOCK_TIME = 0.6;

/** What the sound wants to know about windows bursting. */
export interface GlassCue {
  (x: number, y: number, z: number, panes: number): void;
}

const nearby: number[] = [];

export class KaijuWeight {
  private readonly city: CityData;
  private readonly view: CityView;
  private readonly effects: Effects;
  /** Which foot comes down next, per kaiju (they alternate). */
  private readonly foot = new Map<number, number>();
  /** When each building's windows last burst (renderer time). */
  private readonly broken = new Map<number, number>();
  private time = 0;
  private seed = 777;
  /** Windows bursting (the match audio plays glass there). */
  onGlass: GlassCue | null = null;

  constructor(city: CityData, view: CityView, effects: Effects) {
    this.city = city;
    this.view = view;
    this.effects = effects;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Once per frame: the clock the window gaps are measured on. */
  tick(dt: number): void {
    this.time += dt;
  }

  clear(): void {
    this.foot.clear();
    this.broken.clear();
  }

  /** Where the foot that just came down is (it alternates left and right). */
  footOf(k: Pick<SnapKaiju, 'id' | 'kind' | 'stage' | 'x' | 'z' | 'yaw'>): { x: number; z: number } {
    const side = (this.foot.get(k.id) ?? 1) * -1;
    this.foot.set(k.id, side);
    const r = kaijuStageDef(k.kind, k.stage).bodyRadius * 0.45;
    // The body's right is (-cos, sin) in the world; a positive side is its left.
    return { x: k.x + Math.cos(k.yaw) * side * r, z: k.z - Math.sin(k.yaw) * side * r };
  }

  /** A foot came down (the animator's gait). */
  step(k: SnapKaiju, query: CityQuery | null): void {
    const st = kaijuStageDef(k.kind, k.stage);
    const foot = this.footOf(k);
    const r = st.bodyRadius;
    // The foot's own dust is the kaiju view's; a titan's footfall also sends a low ring out.
    if (k.stage >= 2) this.effects.ring(foot.x, foot.z, r * 1.4, 0xe8dcc4, 0.5, 0.45);
    if (k.stage === 3) this.effects.dust(foot.x, 0.3, foot.z, r * 0.7, 3, 0xd4c9b4);
    this.view.hop(foot.x, foot.z, r * STEP_HOP_REACH[k.stage], STEP_HOP_HEIGHT[k.stage]);
    if (query && STEP_WINDOWS[k.stage] > 0) this.burstWindows(foot.x, foot.z, r * 2.2, STEP_WINDOWS[k.stage], k.stage, st.height, query);
  }

  /**
   * A heavy landing at (x, z): a stomp, the charge's stumble, the molt's new body. `radius` is the
   * stomp's (its shock reaches three times as far).
   */
  land(x: number, z: number, kind: KaijuKindId, stage: StageId, query: CityQuery | null, scale = 1): void {
    const st = kaijuStageDef(kind, stage);
    const radius = kaijuKindDef(kind).actions.stomp.radius * st.bodyRadius * scale;
    const reach = radius * 3;
    this.view.hop(x, z, reach, LAND_HOP_HEIGHT[stage] * scale);
    if (!query) return;
    structuresInCircle(query, x, z, reach, nearby);
    for (const id of nearby) {
      const s = this.city.structures[id];
      if (!s || s.passable) continue;
      const dx = s.x - x;
      const dz = s.z - z;
      const d = Math.max(0, Math.hypot(dx, dz) - Math.max(s.hx, s.hz));
      const falloff = Math.max(0, 1 - d / reach);
      this.view.wobble(id, LAND_SWAY[stage] * scale * (0.25 + 0.75 * Math.sqrt(falloff)), dx, dz, (d / reach) * SHOCK_TIME);
    }
    this.burstWindows(x, z, radius * 1.6, LAND_WINDOWS[stage], stage, st.height, query);
  }

  /**
   * Windows burst out of up to `max` standing buildings within `reach` of (x, z): from the wall
   * that faces the foot, at a height the monster's weight would shake (never above its own).
   */
  private burstWindows(x: number, z: number, reach: number, max: number, stage: StageId, height: number, query: CityQuery): void {
    structuresInCircle(query, x, z, reach, nearby);
    let done = 0;
    let panes = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const id of nearby) {
      if (done >= max) break;
      const s = this.city.structures[id];
      if (!s || s.passable || s.height < 3) continue;
      const last = this.broken.get(id);
      if (last !== undefined && this.time - last < WINDOW_GAP) continue;
      this.broken.set(id, this.time);
      // The wall facing the foot: the nearest point of the footprint, in its own frame.
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const lx = (x - s.x) * c - (z - s.z) * sn;
      const lz = (x - s.x) * sn + (z - s.z) * c;
      const onX = Math.abs(lx) / Math.max(0.1, s.hx) > Math.abs(lz) / Math.max(0.1, s.hz);
      const px = onX ? Math.sign(lx) * s.hx : Math.max(-s.hx, Math.min(s.hx, lx));
      const pz = onX ? Math.max(-s.hz, Math.min(s.hz, lz)) : Math.sign(lz) * s.hz;
      // Back to the world: +X is (cos, -sin), +Z is (sin, cos).
      const wx = s.x + px * c + pz * sn;
      const wz = s.z - px * sn + pz * c;
      const nlx = onX ? Math.sign(lx) : 0;
      const nlz = onX ? 0 : Math.sign(lz);
      const nx = nlx * c + nlz * sn;
      const nz = -nlx * sn + nlz * c;
      const top = Math.min(s.height * 0.9, height * 0.9);
      const count = stage === 1 ? 4 : stage === 2 ? 7 : 9;
      const spread = stage === 1 ? 1.2 : stage === 2 ? 2.5 : 4;
      for (let i = 0; i < (stage === 3 ? 2 : 1); i++) {
        const y = Math.max(1.5, top * (0.25 + this.rand() * 0.7));
        this.effects.glass(wx + nx * 0.3, y, wz + nz * 0.3, nx, nz, spread, count);
        if (i === 0) sy += y;
      }
      sx += wx;
      sz += wz;
      panes += count;
      done++;
    }
    if (done > 0) this.onGlass?.(sx / done, sy / done, sz / done, panes);
  }
}
