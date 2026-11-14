/**
 * Artillery barrages (docs/ROADMAP.md phase 2: the artillery radio, a pick-up; DESIGN.md section
 * 5). The owner called artillery once and could not tell that it had fired, so every step of a
 * fire mission is shown, to both sides:
 *
 *   marked     a red flare and red smoke rising at the target, and a red ring that closes in on
 *              where the shells will land, reaching it the moment the first one does
 *   falling    the shells themselves, big and glowing with a long streak down the sky
 *              (render/projectilesView.ts), whistling in (audio/matchAudio.ts)
 *   impact     big explosions: a fireball, a shockwave ring and a column of dust each
 *   done       the smoke thins out and the ring fades
 *
 * The missions come from the `callin` events: 'marked' (the marker is down, the first shell
 * lands `delay` seconds later), 'inbound', 'done'.
 */

import { type CallInEvent, type ProjectileHitEvent } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import type { QuadBatch } from './quadBatch';

/** The barrage's shells land over this many seconds after the first (CALL_INS: 8 shells in 2 s). */
const BARRAGE = 2;
/** How far out the closing ring starts, in scatter radii. */
const RING_FROM = 3;
const RED = 0xe0301e;

interface Mission {
  id: number;
  x: number;
  z: number;
  radius: number;
  /** Local seconds: when it was marked, when the first shell lands, and when it is over. */
  marked: number;
  impact: number;
  until: number;
  /** Seconds to the next puff of red smoke. */
  smoke: number;
  done: boolean;
}

/** How far the closing ring is from the middle, `since` seconds after the mark of a mission whose first shell lands at `delay`. */
export function closingRing(radius: number, since: number, delay: number): number {
  if (delay <= 0) return radius;
  const f = Math.max(0, Math.min(1, since / delay));
  return radius * (RING_FROM + (1 - RING_FROM) * f);
}

export class ArtilleryView {
  private readonly effects: Effects;
  private readonly decals: QuadBatch;
  private readonly missions: Mission[] = [];
  private readonly ringUv = [0, 0, 0, 0];
  private time = 0;

  constructor(assets: AssetStore, effects: Effects, decals: QuadBatch) {
    this.effects = effects;
    this.decals = decals;
    const anim = [...assets.sprite('fx_ring').anims.values()][0];
    if (anim) frameRect(anim, 0, 0, this.ringUv, 0);
  }

  /** How many fire missions are on the ground now (for the automation hook and tests). */
  get count(): number {
    return this.missions.length;
  }

  handleCallIn(e: CallInEvent): void {
    if (e.phase === 'marked') {
      const m: Mission = { id: e.id, x: e.x, z: e.z, radius: e.radius, marked: this.time, impact: this.time + e.delay, until: this.time + e.delay + BARRAGE + 6, smoke: 0, done: false };
      this.missions.push(m);
      // The flare that marks the target: a red flash and a burst of red smoke.
      this.effects.glowAt(e.x, 2, e.z, 14, 0xff4030, 0.4, 1);
      this.effects.dust(e.x, 0.5, e.z, 3, 6, RED);
    } else if (e.phase === 'done') {
      const m = this.missions.find((x) => x.id === e.id);
      if (m) {
        m.done = true;
        m.until = Math.min(m.until, this.time + 3);
      }
    }
  }

  /** An artillery shell landed: the explosion is a big one. */
  shellHit(e: ProjectileHitEvent): void {
    if (e.projectile !== 'arty' || e.target === 'none') return;
    const fx = this.effects;
    const r = Math.max(6, e.splash);
    if (e.target === 'water') {
      fx.splash(e.x, e.z, r * 0.7);
      return;
    }
    fx.glowAt(e.x, r * 0.5, e.z, r * 5, 0xff9040, 0.45, 0.9);
    fx.ring(e.x, e.z, r * 2.6, 0xfff0d0, 0.55, 0.95);
    fx.dust(e.x, 0.5, e.z, r * 0.8, 10, 0xb8ab98);
    fx.dust(e.x, r * 0.6, e.z, r * 0.4, 5, 0x6a625a);
  }

  clear(): void {
    this.missions.length = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const time = this.time;
    for (let i = 0; i < this.missions.length; i++) {
      const m = this.missions[i];
      if (m.until < time) {
        this.missions[i] = this.missions[this.missions.length - 1];
        this.missions.pop();
        i--;
        continue;
      }
      // Red smoke rising from the target until the barrage is over, then thinning out.
      const over = time > m.impact + BARRAGE;
      m.smoke -= dt;
      if (m.smoke <= 0) {
        m.smoke = over ? 0.6 : 0.16;
        this.effects.puff(m.x + Math.sin(time * 7) * 1.5, 0.8, m.z + Math.cos(time * 5) * 1.5, over ? 3 : 4.5, 0xd8402c, 3.5, over ? 0.35 : 0.7);
      }
      const pulse = 0.6 + 0.35 * Math.sin(time * 10);
      // Where the shells will land: the scatter circle, faint and steady...
      this.decals.push(m.x, 0.22, m.z, m.radius * 2, m.radius * 2, this.ringUv, 0, 1, 0.25, 0.15, over ? 0.35 : 0.55);
      // ...and the ring closing in on it, reaching it as the first shell lands.
      if (time < m.impact) {
        const r = closingRing(m.radius, time - m.marked, m.impact - m.marked);
        this.decals.push(m.x, 0.25, m.z, r * 2, r * 2, this.ringUv, 0, 1, 0.3, 0.2, pulse);
      } else if (!over) {
        this.decals.push(m.x, 0.25, m.z, m.radius * 2, m.radius * 2, this.ringUv, 0, 1, 0.55, 0.3, pulse);
      }
    }
  }
}
