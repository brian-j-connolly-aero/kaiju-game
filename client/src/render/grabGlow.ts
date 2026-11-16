/**
 * What the monster can pick up glows, on the monster's own screen only (docs/ROADMAP.md round 4:
 * "grabbable things glow, brighter when in reach"): every car and car wreck, every city weapon
 * while the monster is small enough to lift it (propane tank, water tank, antenna, fast-food sign,
 * garage door), a fallen radio mast's top at any size, and the wrecks of army vehicles. A soft
 * gold halo round each; the ones within the hand's reach (the grab's reach and arc, where the
 * crosshair looks) brighter, bigger and pulsing, the one the grab would take brightest. A gold
 * ring lies on the ground round each too (light alone washes out in daylight). Nothing glows
 * while the hand is full: Grab then eats or drops what it holds.
 *
 * Cheap: a quad or two each in the renderer's added-light and ground batches (no draw call of
 * its own), the nearest few dozen only, found with the city's prop grid.
 */

import {
  bitGet,
  circleInArc,
  kaijuKindDef,
  kaijuStageDef,
  PROP_KINDS,
  propsInCircle,
  unitTypeDef,
  type KaijuKindId,
  type PropKindId,
  type SnapKaiju,
  type SnapUnit,
  type StageId,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect } from '../assets/spriteAtlas';
import type { CityMirror } from '../net/cityMirror';
import type { QuadBatch } from './quadBatch';

/** The most halos drawn at once (the batch is shared with shots and crates). */
const MAX_GLOWS = 40;
/** How far out things glow, in grab reaches. */
const SCAN_REACHES = 4;
/** The halo's colors (linear): soft gold, and white-gold in reach. */
const FAR = { r: 1, g: 0.7, b: 0.25, a: 0.55 };
const NEAR = { r: 1, g: 0.88, b: 0.5 };
/** The ring on the ground round each (alpha blended, so it reads in daylight too). */
const RING = { r: 1, g: 0.78, b: 0.22 };
/** The in-reach pulse: about three a second. */
const PULSE = 19;

/**
 * Whether a monster of this kind and stage can pick up a prop of this kind (the rule of
 * `canPickUp` in shared/src/sim/cityWeapons.ts, from what the snapshot says; a test keeps the
 * two alike).
 */
export function canLift(kind: KaijuKindId, stage: StageId, prop: PropKindId): boolean {
  const def = PROP_KINDS[prop];
  if (!def.grabbable) return false;
  if (!def.cityWeapon) return true;
  const w = kaijuKindDef(kind).cityWeapons;
  return stage <= (prop === 'mast' ? w.topGrabStage : w.grabStage);
}

interface Glow {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Distance from the body's center to its nearest edge. */
  d: number;
  reach: boolean;
}

export class GrabGlow {
  private readonly uv = [0, 0, 0, 0];
  private readonly ringUv = [0, 0, 0, 0];
  private readonly ids: number[] = [];
  private readonly pool: Glow[] = [];
  private count = 0;
  /** How many glowed on the last frame, and how many of them were in reach (playtests). */
  readonly stats = { shown: 0, inReach: 0 };

  constructor(assets: AssetStore) {
    const anim = [...assets.sprite('fx_glow').anims.values()][0];
    if (anim) frameRect(anim, 0, 0, this.uv, 0);
    const ring = [...assets.sprite('fx_ring').anims.values()][0];
    if (ring) frameRect(ring, 0, 0, this.ringUv, 0);
  }

  private add(x: number, y: number, z: number, r: number, d: number, reach: boolean): void {
    let g = this.pool[this.count];
    if (!g) this.pool.push((g = { x: 0, y: 0, z: 0, r: 0, d: 0, reach: false }));
    g.x = x;
    g.y = y;
    g.z = z;
    g.r = r;
    g.d = d;
    g.reach = reach;
    this.count++;
  }

  /**
   * Draws the halos (in `glow`, added light) and the rings on the ground (in `ground`) round what
   * the local monster `k` can pick up now (none: nothing glows). `units`: the frame's, for the
   * army's wrecks.
   */
  update(k: SnapKaiju | null, mirror: CityMirror | null, units: readonly SnapUnit[], glow: QuadBatch, ground: QuadBatch, time: number): void {
    this.count = 0;
    this.stats.shown = 0;
    this.stats.inReach = 0;
    if (!k || !mirror || !k.alive || k.held || k.phase === 'cocoon' || k.phase === 'dead' || k.submerge > 0.5) return;
    const stage = kaijuStageDef(k.kind, k.stage);
    const grab = kaijuKindDef(k.kind).actions.grab;
    const reach = grab.reach * stage.bodyRadius;
    const half = grab.arc / 2;
    const scan = reach * SCAN_REACHES;
    const idx = mirror.index;
    const inReach = (x: number, z: number, r: number): boolean => circleInArc(x, z, r, k.x, k.z, k.aimYaw, half, reach);
    const edge = (x: number, z: number, r: number): number => Math.max(0, Math.hypot(x - k.x, z - k.z) - r);

    // Cars and city weapons standing in the street, and the wrecks of crushed cars.
    propsInCircle(mirror.query, k.x, k.z, scan, this.ids, false);
    for (const id of this.ids) {
      const prop = mirror.city.props[id];
      if (!prop) continue;
      const alive = bitGet(mirror.query.propAlive, id);
      if (alive ? !canLift(k.kind, k.stage, prop.kind) : !bitGet(mirror.propWreck, id)) continue;
      const x = idx.px[id];
      const z = idx.pz[id];
      const r = idx.pradius[id];
      this.add(x, PROP_KINDS[prop.kind].height * 0.5, z, r, edge(x, z, r), inReach(x, z, r));
    }
    // City weapons lying loose (dropped, or a fallen mast's top).
    for (const o of mirror.loose.values()) {
      if (!canLift(k.kind, k.stage, o.prop)) continue;
      const r = PROP_KINDS[o.prop].radius;
      if (Math.hypot(o.x - k.x, o.z - k.z) > scan + r) continue;
      this.add(o.x, PROP_KINDS[o.prop].height * 0.5, o.z, r, edge(o.x, o.z, r), inReach(o.x, o.z, r));
    }
    // The army's burnt-out vehicles.
    for (const u of units) {
      if (u.alive || !u.wreck || !unitTypeDef(u.type).grabbable) continue;
      const r = unitTypeDef(u.type).radius;
      if (Math.hypot(u.x - k.x, u.z - k.z) > scan + r) continue;
      this.add(u.x, 1.5, u.z, r, edge(u.x, u.z, r), inReach(u.x, u.z, r));
    }
    if (this.count === 0) return;

    // The nearest few dozen; the nearest in reach is what a grab would take.
    const shown = this.pool.slice(0, this.count).sort((a, b) => a.d - b.d).slice(0, MAX_GLOWS);
    const pick = shown.find((g) => g.reach) ?? null;
    // Small things glow big enough to be seen from a big monster's eye.
    const least = stage.bodyRadius * 0.45;
    const pulse = 0.5 + 0.5 * Math.sin(time * PULSE);
    for (const g of shown) {
      const size = Math.max(g.r * 2.2, least);
      if (g.reach) {
        const best = g === pick;
        const a = (best ? 0.6 : 0.45) + pulse * (best ? 0.3 : 0.2);
        const grow = (best ? 1.25 : 1.1) * (1 + pulse * 0.12);
        glow.push(g.x, g.y, g.z, size * grow, size * grow, this.uv, 0, NEAR.r, NEAR.g, NEAR.b, a);
        ground.push(g.x, 0.15, g.z, size * 1.3 * grow, size * 1.3 * grow, this.ringUv, 0, 1, 0.95, 0.6, 0.75 + pulse * 0.25);
        this.stats.inReach++;
      } else {
        glow.push(g.x, g.y, g.z, size, size, this.uv, 0, FAR.r, FAR.g, FAR.b, FAR.a);
        ground.push(g.x, 0.15, g.z, size * 1.2, size * 1.2, this.ringUv, 0, RING.r, RING.g, RING.b, 0.55);
      }
      this.stats.shown++;
    }
  }
}
