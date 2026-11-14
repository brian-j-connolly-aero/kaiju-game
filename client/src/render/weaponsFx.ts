/**
 * What the monster's city weapons and its power surge look like when something happens
 * (docs/ROADMAP.md phase 2; the rules: DESIGN.md section 4, "The city as a weapon"): every
 * event of `sim/cityWeapons.ts` turned into effects in the world. The weapon in the hand and the
 * surge's crackle on the body are the kaiju view's (render/kaijuWeapons.ts); the special
 * buildings and a propane tank set off where it stands are the city's (one shared explosion,
 * `Effects.propaneBlast`).
 *
 *   powerSurge     a blue-white flash round the monster as the surge takes it
 *   propaneBlast   a thrown tank, or one set off in the hand: the blast, and in the hand a puff
 *                  of black smoke and burning bits round the claw
 *   kaijuFlinch    smoke streaming off the burnt hand
 *   waterSplash    a column of water, a wave rolling out over the street, spray and the tank's
 *                  pieces; the units it knocks over lie flat (UnitsView)
 *   javelinHit     a javelin going through a unit: a burst of sparks and dust where it passes
 *   clubSwing      dust kicked up along the arc and a flash where units are struck
 *   signBroken     the sign flies apart: its pieces tumble away, bits of it rain down
 *   shieldHit      sparks off the garage door, and it jolts in the claw
 *   shieldBroken   the door bursts: slabs of it spin away
 *   (landing)      a javelin stuck in a wall or the ground throws up dust and sparks; a door
 *                  lands flat with a thump of dust
 */

import * as THREE from 'three';
import { kaijuStageDef, type ProjectileHitEvent, type PropKindId, type SimEvent, type SnapKaiju, type SnapUnit } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import type { Effects } from './effects';
import type { KaijuView } from './kaijuView';
import type { Materials } from './materials';
import { SceneRig } from './sceneRig';
import type { UnitsView } from './unitsView';

/** What the effects need to know about the match at the moment of an event. */
export interface WeaponsFxContext {
  kaiju(id: number): SnapKaiju | undefined;
  unit(id: number): SnapUnit | undefined;
  view(id: number): KaijuView | undefined;
  /** The camera is inside this kaiju's head (its own first-person view): no flash on its body. */
  inside(id: number): boolean;
}

/** A broken piece of a city weapon tumbling away. */
interface Piece {
  rig: SceneRig;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax: THREE.Vector3;
  spin: number;
  age: number;
  life: number;
}

/** The blue-white of the power surge (never the humans' cyan). */
const SURGE = 0xc8d4ff;
/** The colors of the bits a broken sign and a burst water tank throw about. */
const SIGN_BITS = [0xd7263d, 0xffd91a, 0xf3e3b3];
const DOOR_BITS = 0xd9d2c0;

const tmp = new THREE.Vector3();

export class WeaponsFx {
  private readonly assets: AssetStore;
  private readonly materials: Materials;
  private readonly effects: Effects;
  private readonly units: UnitsView;
  readonly group = new THREE.Group();
  private readonly pieces: Piece[] = [];
  private seed = 1234567;

  constructor(assets: AssetStore, materials: Materials, effects: Effects, units: UnitsView) {
    this.assets = assets;
    this.materials = materials;
    this.effects = effects;
    this.units = units;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Breaks a city weapon's model into `count` spinning pieces flung out from (x, y, z). */
  private shatter(kind: PropKindId, x: number, y: number, z: number, count: number, scale: number, speed: number): void {
    const model = this.assets.model(`prop_${kind}`);
    for (let i = 0; i < count; i++) {
      const rig = new SceneRig(model, this.materials);
      rig.root.scale.setScalar(scale * (0.75 + this.rand() * 0.5));
      this.group.add(rig.root);
      const a = this.rand() * Math.PI * 2;
      const v = speed * (0.6 + this.rand() * 0.8);
      this.pieces.push({
        rig,
        x,
        y,
        z,
        vx: Math.cos(a) * v,
        vy: speed * (0.8 + this.rand() * 0.9),
        vz: Math.sin(a) * v,
        ax: new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize(),
        spin: 6 + this.rand() * 10,
        age: 0,
        life: 1.3 + this.rand() * 0.5,
      });
    }
  }

  /** A simulation event (only the city-weapon and surge ones mean anything here). */
  handleEvent(e: SimEvent, ctx: WeaponsFxContext): void {
    const fx = this.effects;
    switch (e.type) {
      case 'powerSurge': {
        const k = ctx.kaiju(e.kaiju);
        if (!k) break;
        const st = kaijuStageDef(k.kind, k.stage);
        // The surge takes the monster: a flash of blue-white light over it, sparks off its back,
        // a ring of it on the ground.
        if (!ctx.inside(e.kaiju)) fx.glowAt(k.x, st.height * 0.6, k.z, st.bodyRadius * 7, SURGE, 0.35, 1);
        fx.sparks(k.x, st.height * 0.7, k.z, st.bodyRadius * 0.9, 16, SURGE, 0.6);
        fx.ring(k.x, k.z, st.bodyRadius * 4, SURGE, 0.6, 0.9);
        break;
      }
      case 'propaneBlast': {
        // A tank set off where it stood, or crushed, is the city's picture (the same blast).
        if (e.how !== 'thrown' && e.how !== 'hand') break;
        fx.propaneBlast(e.x, e.y, e.z, e.radius);
        if (e.how === 'hand') {
          // In the claw: black smoke and burning bits about the hand as well.
          fx.dust(e.x, e.y, e.z, e.radius * 0.35, 6, 0x2f2a27);
          fx.sparks(e.x, e.y, e.z, e.radius * 0.5, 12, 0xffc070, 0.7);
        }
        break;
      }
      case 'kaijuFlinch': {
        const view = ctx.view(e.kaiju);
        const k = ctx.kaiju(e.kaiju);
        if (!k) break;
        const st = kaijuStageDef(k.kind, k.stage);
        const hand = view && view.hasHand ? view.hand : tmp.set(e.x, st.handHeight, e.z);
        for (let i = 0; i < 4; i++) fx.puff(hand.x, hand.y + i * st.bodyRadius * 0.15, hand.z, st.bodyRadius * 0.4, 0x3a3532, 1.4, 0.6);
        break;
      }
      case 'waterSplash': {
        const r = e.radius;
        // The tank bursts: a column of water, a wave rolling out over the street, a mist hanging
        // a moment, and the tank's own pieces.
        fx.splash(e.x, e.z, r * 0.8);
        fx.splash(e.x, e.z, r * 0.45);
        fx.ring(e.x, e.z, r * 1.15, 0xdff1ff, 0.7, 0.95);
        fx.ring(e.x, e.z, r * 0.7, 0xb8dcff, 1.1, 0.7, 0.3);
        fx.dust(e.x, 0.6, e.z, r * 0.8, 8, 0xe4f2ff);
        fx.debris(e.x, 1, e.z, r * 0.6, 6, 0x9ab3c4, 0.45);
        break;
      }
      case 'unitStunned':
        if (e.knockdown) this.units.knockDown(e.unit, e.duration);
        break;
      case 'javelinHit': {
        const r = e.prop === 'mast' ? 2.2 : 1.6;
        fx.sparks(e.x, e.y, e.z, r, 10, 0xffe0a8, 0.5);
        fx.dust(e.x, Math.max(0.3, e.y * 0.5), e.z, r * 1.2, 4);
        fx.glowAt(e.x, e.y, e.z, r * 4, 0xffd0a0, 0.12, 0.9);
        break;
      }
      case 'clubSwing': {
        const k = ctx.kaiju(e.kaiju);
        const st = k ? kaijuStageDef(k.kind, k.stage) : null;
        const radius = st ? st.bodyRadius : 2.4;
        // Dust kicked up along the arc the sign's head swept, and a glint of its passing.
        const steps = 9;
        for (let i = 0; i <= steps; i++) {
          const a = e.yaw - e.arc / 2 + (e.arc * i) / steps;
          const d = e.reach * 0.85;
          fx.dust(e.x + Math.sin(a) * d, 0.3, e.z + Math.cos(a) * d, radius * 0.5, 2, 0xd4c8b2);
          if (i % 2 === 0 && st) fx.glowAt(e.x + Math.sin(a) * d, st.handHeight, e.z + Math.cos(a) * d, radius * 0.9, 0xffd9a0, 0.18, 0.6);
        }
        if (e.units > 0) fx.ring(e.x, e.z, e.reach, 0xffd9a0, 0.45, 0.8);
        break;
      }
      case 'signBroken': {
        const view = ctx.view(e.kaiju);
        const k = ctx.kaiju(e.kaiju);
        const st = k ? kaijuStageDef(k.kind, k.stage) : null;
        // Where the sign's head was when it broke (else over the hand).
        const at = view && view.weaponKind === 'foodsign' ? tmp.copy(view.weaponEnd) : tmp.set(e.x, st ? st.handHeight * 1.5 : 3, e.z);
        this.shatter('foodsign', at.x, at.y, at.z, 3, 0.4, 7);
        for (const c of SIGN_BITS) fx.debris(at.x, at.y, at.z, 4, 5, c, 0.6);
        fx.dust(at.x, at.y, at.z, 2.5, 5, 0xe8dcc4);
        break;
      }
      case 'shieldHit': {
        const view = ctx.view(e.kaiju);
        view?.shieldHit(e.damage);
        // The sparks fly off the door's face, where the shot struck.
        const at = view && view.weaponKind === 'garagedoor' ? view.weaponEnd : tmp.set(e.x, e.y, e.z);
        fx.sparks(at.x, at.y, at.z, 1.2 + Math.min(2, e.damage * 0.08), 6, 0xffe2a0, 0.4);
        fx.flash(at.x, at.y, at.z, 1.6, 0xffffff, 0.06);
        break;
      }
      case 'shieldBroken': {
        const view = ctx.view(e.kaiju);
        const at = view && view.weaponKind === 'garagedoor' ? tmp.copy(view.weaponEnd) : tmp.set(e.x, 2.2, e.z);
        this.shatter('garagedoor', at.x, at.y, at.z, 3, 0.5, 6);
        fx.debris(at.x, at.y, at.z, 4, 10, DOOR_BITS, 0.6);
        fx.sparks(at.x, at.y, at.z, 2.5, 14, 0xffe2a0, 0.6);
        fx.dust(at.x, at.y, at.z, 2.5, 6);
        break;
      }
      default:
        break;
    }
  }

  /** A thrown city weapon came down (its own `projectileHit`, which then draws nothing else). */
  landed(e: ProjectileHitEvent, prop: PropKindId): void {
    const fx = this.effects;
    if (prop === 'antenna' || prop === 'mast') {
      // Stuck fast: a spray of grit and sparks where the point went in.
      const r = prop === 'mast' ? 2.5 : 1.8;
      if (e.target === 'water') fx.splash(e.x, e.z, r);
      else {
        fx.dust(e.x, Math.max(0.3, e.y), e.z, r, 6);
        fx.sparks(e.x, Math.max(0.3, e.y), e.z, r, 8, 0xffe0a8, 0.45);
      }
    } else if (prop === 'garagedoor') {
      // A frisbee landing flat: a slap of dust round it.
      if (e.target === 'water') fx.splash(e.x, e.z, 3);
      else {
        fx.dust(e.x, 0.3, e.z, Math.max(2.5, e.splash), 8);
        fx.ring(e.x, e.z, Math.max(3, e.splash) * 1.3, 0xf1e2c4, 0.45, 0.8);
      }
    }
    // The propane tank and the water tank have their own events (the blast, the splash).
  }

  update(dt: number): void {
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.rig.dispose();
        this.pieces[i] = this.pieces[this.pieces.length - 1];
        this.pieces.pop();
        i--;
        continue;
      }
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.1, p.y + p.vy * dt);
      p.z += p.vz * dt;
      if (p.y <= 0.1) {
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.vy = Math.abs(p.vy) * 0.3;
      }
      p.rig.root.position.set(p.x, p.y, p.z);
      p.rig.root.quaternion.setFromAxisAngle(p.ax, p.spin * p.age);
      // Shrinking away over the last third of its life.
      const fade = Math.min(1, (p.life - p.age) / (p.life * 0.33));
      if (fade < 1) p.rig.root.scale.multiplyScalar(0.92 + 0.08 * fade);
    }
  }

  clear(): void {
    for (const p of this.pieces) p.rig.dispose();
    this.pieces.length = 0;
  }
}
