/**
 * Draws the human units. A unit is one simulated body with a member count: vehicles are drawn
 * as that many models around the body (one instanced rig for every tank on the field), infantry
 * as that many soldier sprites (one instanced batch for every sprite in the game). Also the
 * yellow targeting lasers of charging units, blob shadows, and the shape-coded markers that
 * keep small units readable from a titan's height.
 */

import * as THREE from 'three';
import {
  createAimPoint,
  createCastHit,
  kaijuStageDef,
  rayVsCapsule,
  resolveAimPoint,
  unitTypeDef,
  weaponDef,
  type CityQuery,
  type SnapKaiju,
  type SnapUnit,
  type UnitTypeDef,
  type VerticalCapsule,
} from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect, type SpriteAnimInfo, type SpriteInfo } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { InstancedRig } from './instancedRig';
import type { LineBatch } from './lineBatch';
import type { Materials } from './materials';
import type { QuadBatch } from './quadBatch';

const MAX_VEHICLES = 64;

export interface UnitsViewContext {
  camera: THREE.Camera;
  time: number;
  dt: number;
  /** The unit the local player drives, or -1. */
  localUnit: number;
  /** The local player's squad, or -1. */
  localSquad: number;
  /** First person: the local unit's own members are not drawn (the camera is among them). */
  hideLocalLead: boolean;
  city: CityQuery | null;
  kaijus: SnapKaiju[];
}

interface Fallen {
  x: number;
  z: number;
  sprite: SpriteInfo;
  age: number;
}

const aim = createAimPoint();
const capHit = createCastHit();
const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const origin = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };
const uv = [0, 0, 0, 0];

/** Where member `i` of `count` stands relative to the unit's center, before the unit's heading. */
export function memberOffset(def: UnitTypeDef, unitId: number, i: number, count: number, out: { x: number; z: number }): void {
  if (def.body !== 'infantry') {
    if (count <= 1 && def.members <= 1) {
      out.x = 0;
      out.z = 0;
      return;
    }
    // A wedge: the lead vehicle in front, the others behind to either side.
    const r = def.radius * 0.55;
    const slots = [
      [0, r],
      [-r * 0.95, -r * 0.6],
      [r * 0.95, -r * 0.6],
      [0, -r * 1.3],
    ];
    const s = slots[i % slots.length];
    out.x = s[0];
    out.z = s[1];
    return;
  }
  if (i === 0) {
    out.x = 0;
    out.z = 0;
    return;
  }
  // A loose cluster: a sunflower spiral, different for every unit.
  const a = i * 2.39996 + unitId * 1.7;
  const r = def.radius * 0.85 * Math.sqrt(i / Math.max(1, def.members - 1));
  out.x = Math.cos(a) * r;
  out.z = Math.sin(a) * r;
}

export class UnitsView {
  readonly group = new THREE.Group();
  private readonly assets: AssetStore;
  private readonly sprites: QuadBatch;
  private readonly decals: QuadBatch;
  private readonly markers: QuadBatch;
  private readonly rigs = new Map<string, InstancedRig>();
  private readonly materials: Materials;
  private readonly fireUntil = new Float32Array(256);
  private readonly fallen: Fallen[] = [];
  private readonly shadowUv = [0, 0, 0, 0];
  private readonly circleUv = [0, 0, 0, 0];
  private readonly diamondUv = [0, 0, 0, 0];
  private readonly chevronUv = [0, 0, 0, 0];
  private readonly offset = { x: 0, z: 0 };

  constructor(assets: AssetStore, materials: Materials, sprites: QuadBatch, decals: QuadBatch, markers: QuadBatch) {
    this.assets = assets;
    this.materials = materials;
    this.sprites = sprites;
    this.decals = decals;
    this.markers = markers;
    const first = (id: string, out: number[]): void => {
      const sprite = assets.sprite(id);
      const anim = [...sprite.anims.values()][0];
      if (anim) frameRect(anim, 0, 0, out, 0);
    };
    first('fx_shadow', this.shadowUv);
    first('mk_circle', this.circleUv);
    first('mk_diamond', this.diamondUv);
    first('mk_chevron', this.chevronUv);
  }

  private rig(modelId: string): InstancedRig {
    let rig = this.rigs.get(modelId);
    if (!rig) {
      rig = new InstancedRig(this.assets.model(modelId), this.materials, MAX_VEHICLES);
      this.rigs.set(modelId, rig);
      this.group.add(rig.group);
    }
    return rig;
  }

  /** A unit fired: its soldiers show their firing frame for a moment. */
  noteFired(unitId: number, time: number): void {
    if (unitId >= 0 && unitId < this.fireUntil.length) this.fireUntil[unitId] = time + 0.3;
  }

  /** Soldiers of a unit fell: show them going down where they stood. */
  noteMembersLost(u: SnapUnit, count: number): void {
    const def = unitTypeDef(u.type);
    if (def.visual.kind !== 'sprites') return;
    const sprite = this.assets.sprite(def.visual.secondary);
    const cos = Math.cos(u.yaw);
    const sin = Math.sin(u.yaw);
    for (let i = 0; i < Math.min(count, 10); i++) {
      memberOffset(def, u.id, u.members + i, def.members, this.offset);
      this.fallen.push({ x: u.x + this.offset.x * cos + this.offset.z * sin, z: u.z - this.offset.x * sin + this.offset.z * cos, sprite, age: 0 });
    }
    if (this.fallen.length > 80) this.fallen.splice(0, this.fallen.length - 80);
  }

  /** Which of the four pictures of a sprite to show for a heading, seen from the camera. */
  private facingFor(yaw: number, x: number, z: number, camera: THREE.Camera): number {
    const fx = x - camera.position.x;
    const fz = z - camera.position.z;
    const len = Math.hypot(fx, fz) || 1;
    const hx = Math.sin(yaw);
    const hz = Math.cos(yaw);
    const toward = -(hx * fx + hz * fz) / len;
    if (toward > 0.707) return 0;
    if (toward < -0.707) return 2;
    // The camera's right is (-fz, fx): a figure walking that way is seen moving right.
    return hx * -fz + hz * fx > 0 ? 3 : 1;
  }

  update(units: SnapUnit[], ctx: UnitsViewContext, lines: LineBatch, effects: Effects): void {
    for (const rig of this.rigs.values()) rig.begin();
    const { camera, time } = ctx;

    for (const u of units) {
      const def = unitTypeDef(u.type);
      const cos = Math.cos(u.yaw);
      const sin = Math.sin(u.yaw);
      const local = u.id === ctx.localUnit;
      const own = u.squad === ctx.localSquad;
      const dist = Math.hypot(u.x - camera.position.x, u.z - camera.position.z, camera.position.y);

      if (!u.alive) {
        if (u.wreck && def.visual.kind === 'model') {
          this.rig(def.visual.wreck).add(u.x, 0, u.z, u.yaw, 1, 0xffffff);
          this.decals.push(u.x, 0.12, u.z, def.radius * 2.6, def.radius * 2.6, this.shadowUv, 0, 0, 0, 0, 0.5);
          if (Math.floor(time * 6 + u.id) % 3 === 0) effects.puff(u.x, 1.5, u.z, 1.6, 0x2c2a28, 1.4, 0.45);
        }
        continue;
      }
      const shaken = u.shaken > 0;
      const moving = Math.hypot(u.vx, u.vz) > 0.5;

      if (def.visual.kind === 'model') {
        const rig = this.rig(def.visual.model);
        const tint = shaken && Math.floor(time * 10) % 2 === 0 ? 0xffb0a0 : 0xffffff;
        // First person: none of the local unit's vehicles is drawn. The camera sits at the
        // unit's center, where the server aims from, and a troop's tanks stand around it 5 to 6
        // meters away: drawn, they would fill the lower third of the view.
        const hidden = local && ctx.hideLocalLead;
        for (let i = 0; i < u.members && !hidden; i++) {
          memberOffset(def, u.id, i, u.members, this.offset);
          const x = u.x + this.offset.x * cos + this.offset.z * sin;
          const z = u.z - this.offset.x * sin + this.offset.z * cos;
          this.decals.push(x, 0.12, z, 7, 9, this.shadowUv, 0, 0, 0, 0, 0.55, u.yaw);
          rig.pose('turret', 0, u.aimYaw - u.yaw, 0);
          rig.pose('barrel', -Math.max(-0.2, Math.min(0.6, u.aimPitch)), 0, 0);
          rig.add(x, 0, z, u.yaw, 1, tint);
        }
      } else {
        const primary = this.assets.sprite(def.visual.primary);
        const secondary = this.assets.sprite(def.visual.secondary);
        const firing = this.fireUntil[u.id] > time;
        const heading = moving ? Math.atan2(u.vx, u.vz) : u.aimYaw;
        const shade = shaken ? 0.75 + Math.sin(time * 30) * 0.25 : 1;
        this.decals.push(u.x, 0.1, u.z, def.radius * 2.2, def.radius * 2.2, this.shadowUv, 0, 0, 0, 0, 0.35);
        // First person: the player's own section stands all around the camera and would fill
        // the view with backs of heads, so it is not drawn.
        const hidden = local && ctx.hideLocalLead;
        for (let i = 0; i < u.members && !hidden; i++) {
          memberOffset(def, u.id, i, def.members, this.offset);
          const x = u.x + this.offset.x * cos + this.offset.z * sin;
          const z = u.z - this.offset.x * sin + this.offset.z * cos;
          const sprite = i < def.visual.primaryCount ? primary : secondary;
          const name = firing ? 'fire' : moving ? 'walk' : 'idle';
          const anim = (sprite.anims.get(name) ?? sprite.anims.get('idle') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
          const frame = Math.floor((time + i * 0.13) * anim.fps);
          frameRect(anim, this.facingFor(heading, x, z, camera), frame, uv, 0);
          const h = sprite.worldHeight;
          this.sprites.push(x, u.y, z, h * sprite.aspect, h, uv, 0, shade, shade, shade, 1);
        }
      }

      // Marker: a cyan circle over every unit, a yellow diamond while it charges a volley.
      // (Not over the unit the player drives: they know where they are, and it would sit on the crosshair.)
      if (!local) {
        const size = Math.min(40, Math.max(1.6, dist * 0.022));
        const top = def.height + 1.2 + size * 0.5;
        const charging = u.laser || u.state === 'charging';
        const bright = own ? 1 : 0.7;
        if (charging) {
          const pulse = 0.75 + 0.25 * Math.sin(time * (4 + u.charge * 10));
          this.markers.push(u.x, top, u.z, size * (0.8 + u.charge * 0.5), size * (0.8 + u.charge * 0.5), this.diamondUv, 0, 1, 0.85, 0.1, pulse);
        } else {
          this.markers.push(u.x, top, u.z, size * (u.driven ? 1 : 0.75), size * (u.driven ? 1 : 0.75), this.circleUv, 0, 0.12 * bright, 0.78 * bright, 0.88 * bright, shaken ? 0.5 : 0.95);
        }
        if (u.veteran) this.markers.push(u.x, top + size * 0.7, u.z, size * 0.7, size * 0.7, this.chevronUv, 0, 1, 1, 1, 0.9);
      }

      // Targeting laser: from the muzzle along the aim to whatever it meets first.
      if (u.laser && ctx.city) {
        const range = weaponDef(def.weapon).range;
        const oy = u.y + def.muzzleHeight;
        resolveAimPoint(ctx.city, u.x, oy, u.z, u.aimYaw, u.aimPitch, range, aim);
        let end = aim.dist;
        const cp = Math.cos(u.aimPitch);
        origin.x = u.x;
        origin.y = oy;
        origin.z = u.z;
        dir.x = Math.sin(u.aimYaw) * cp;
        dir.y = Math.sin(u.aimPitch);
        dir.z = Math.cos(u.aimYaw) * cp;
        for (const k of ctx.kaijus) {
          if (!k.alive) continue;
          const st = kaijuStageDef(k.kind, k.stage);
          capsule.x = k.x;
          capsule.z = k.z;
          capsule.r = st.bodyRadius;
          capsule.y0 = 0;
          capsule.y1 = st.height;
          if (rayVsCapsule(origin, dir, end, capsule, capHit) && capHit.t < end) end = capHit.t;
        }
        const ex = u.x + dir.x * end;
        const ey = Math.max(0.15, oy + dir.y * end);
        const ez = u.z + dir.z * end;
        const glow = 0.35 + u.charge * 0.65;
        const width = Math.max(0.12, dist * 0.0025) * (1 + u.charge);
        lines.push(u.x, oy, u.z, ex, ey, ez, width, 1, 0.82, 0.1, glow);
        const dot = Math.max(0.6, Math.hypot(ex - camera.position.x, ey - camera.position.y, ez - camera.position.z) * 0.012) * (1 + u.charge);
        effects.laserDot(ex, ey, ez, dot, 0xffd91a, 0.03);
      }
    }

    // Soldiers who just went down.
    for (let i = 0; i < this.fallen.length; i++) {
      const f = this.fallen[i];
      f.age += ctx.dt;
      const anim = f.sprite.anims.get('die');
      if (f.age > 4 || !anim) {
        this.fallen[i] = this.fallen[this.fallen.length - 1];
        this.fallen.pop();
        i--;
        continue;
      }
      frameRect(anim, 0, Math.min(anim.frames - 1, Math.floor(f.age * anim.fps)), uv, 0);
      const fade = f.age > 3 ? 4 - f.age : 1;
      const h = f.sprite.worldHeight;
      this.sprites.push(f.x, 0, f.z, h * f.sprite.aspect, h, uv, 0, fade, fade, fade, 1);
    }

    for (const rig of this.rigs.values()) rig.end();
  }

  clear(): void {
    this.fallen.length = 0;
    this.fireUntil.fill(0);
    for (const rig of this.rigs.values()) {
      rig.begin();
      rig.end();
    }
  }
}
