/**
 * Draws the human units. A unit is one simulated body with a member count: vehicles are drawn
 * as that many models around the body (one instanced rig for every tank on the field), infantry
 * as that many soldier sprites (one instanced batch for every sprite in the game). Also the
 * yellow targeting lasers of charging units, blob shadows, and the shape-coded markers that
 * keep small units readable from a titan's height.
 *
 * Phase 2: units knocked over (a thrown water tank's splash, a garage door) lie flat until they
 * get up; reinforcements come down under parachutes (`y` above the ground); a tank firing the
 * big cannon pick-up rocks back on its tracks.
 */

import * as THREE from 'three';
import { createAimPoint, resolveAimPoint, unitTypeDef, weaponDef, type CityQuery, type SnapKaiju, type SnapUnit, type UnitTypeDef } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { frameRect, type SpriteAnimInfo, type SpriteInfo } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { InstancedRig } from './instancedRig';
import type { LineBatch } from './lineBatch';
import type { Materials } from './materials';
import type { QuadBatch } from './quadBatch';

const MAX_VEHICLES = 64;
/** The parachute under which a soldier comes down is this much of the model's size; a tank hangs under three bigger ones. */
const CHUTE_SOLDIER = 0.7;
const CHUTE_TANK = 1.5;
/** Seconds a tank rocks back on its tracks after the big cannon fires. */
const RECOIL = 0.35;
/** A unit's marker is hidden this close to the camera (meters) and fades in over the next stretch. */
const MARKER_HIDE_NEAR = 16;
const MARKER_FADE = 16;
/** A soldier this close to the camera (meters) is not drawn. */
const SPRITE_HIDE_NEAR = 3.5;
/**
 * Third person: the player's own squad-mates (and the rest of the player's own section) closer
 * to the camera than this fade (meters), down to a ghost of themselves at SQUAD_FADE_NEAR, so a
 * squad standing together does not fill the bottom of the view. The player's own soldier stays.
 */
const SQUAD_FADE_FAR = 14;
const SQUAD_FADE_NEAR = 4;
const SQUAD_GHOST = 0.3;

/** How much of a soldier of the player's own squad shows at `distance` meters from a third-person camera (0..1). */
export function squadFade(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - SQUAD_FADE_NEAR) / (SQUAD_FADE_FAR - SQUAD_FADE_NEAR)));
  return SQUAD_GHOST + (1 - SQUAD_GHOST) * t * t * (3 - 2 * t);
}

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
  /** Third person from a unit: the player's own squad fades near the camera (`squadFade`). */
  fadeSquadNear?: boolean;
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
  /** Units knocked over: until when (local seconds), and since when. */
  private readonly knockUntil = new Float32Array(256);
  private readonly knockFrom = new Float32Array(256);
  /** When each unit last fired the big cannon (local seconds). */
  private readonly recoilAt = new Float32Array(256).fill(-1e9);
  /** Each unit's height above the ground last frame (a unit landing from a parachute raises dust). */
  private readonly lastY = new Float32Array(256);
  private time = 0;
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

  /** A unit fired: its soldiers show their firing frame for a moment. A big cannon's shot rocks a tank back. */
  noteFired(unitId: number, time: number, heavy = false): void {
    if (unitId >= 0 && unitId < this.fireUntil.length) {
      this.fireUntil[unitId] = time + 0.3;
      if (heavy) this.recoilAt[unitId] = time;
    }
  }

  /** A unit was knocked over (phase 2: a water tank's splash, a thrown garage door): it lies flat for `seconds`. */
  knockDown(unitId: number, seconds: number): void {
    if (unitId < 0 || unitId >= this.knockUntil.length) return;
    this.knockFrom[unitId] = this.time;
    this.knockUntil[unitId] = this.time + seconds;
  }

  /** Whether a unit is lying knocked over right now. */
  knockedDown(unitId: number): boolean {
    return unitId >= 0 && unitId < this.knockUntil.length && this.knockUntil[unitId] > this.time;
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
    this.time = time;

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
      // Down from a parachute: a puff of dust where it lands.
      if (u.id < this.lastY.length) {
        if (this.lastY[u.id] > 0.3 && u.y <= 0.3) effects.dust(u.x, 0.3, u.z, def.radius * 1.2, 5);
        this.lastY[u.id] = u.y;
      }

      if (def.visual.kind === 'model') {
        const rig = this.rig(def.visual.model);
        const tint = shaken && Math.floor(time * 10) % 2 === 0 ? 0xffb0a0 : 0xffffff;
        // First person: none of the local unit's vehicles is drawn. The camera sits at the
        // unit's center, where the server aims from, and a troop's tanks stand around it 5 to 6
        // meters away: drawn, they would fill the lower third of the view.
        const hidden = local && ctx.hideLocalLead;
        // The big cannon's kick: the hull rocks back, nose up, and settles.
        const kick = Math.max(0, 1 - (time - this.recoilAt[u.id]) / RECOIL);
        const rock = kick > 0 ? Math.sin(kick * Math.PI) * kick : 0;
        // Knocked over: tipped up on one side until it rights itself.
        const tipped = this.knockedDown(u.id) ? 0.5 : 0;
        for (let i = 0; i < u.members && !hidden; i++) {
          memberOffset(def, u.id, i, u.members, this.offset);
          const x = u.x + this.offset.x * cos + this.offset.z * sin - Math.sin(u.yaw) * rock * 0.8;
          const z = u.z - this.offset.x * sin + this.offset.z * cos - Math.cos(u.yaw) * rock * 0.8;
          this.decals.push(x, 0.12, z, 7, 9, this.shadowUv, 0, 0, 0, 0, 0.55, u.yaw);
          rig.pose('turret', 0, u.aimYaw - u.yaw, 0);
          rig.pose('barrel', -Math.max(-0.2, Math.min(0.6, u.aimPitch)), 0, 0);
          rig.add(x, u.y, z, u.yaw, 1, tint, -0.12 * rock, tipped);
          if (u.y > 0.5) this.chutes(x, u.y + def.height, z, CHUTE_TANK, 3, u.id + i, time);
        }
      } else {
        const primary = this.assets.sprite(def.visual.primary);
        const secondary = this.assets.sprite(def.visual.secondary);
        const firing = this.fireUntil[u.id] > time;
        const heading = moving ? Math.atan2(u.vx, u.vz) : u.aimYaw;
        const shade = shaken ? 0.75 + Math.sin(time * 30) * 0.25 : 1;
        const knocked = this.knockedDown(u.id);
        this.decals.push(u.x, 0.1, u.z, def.radius * 2.2, def.radius * 2.2, this.shadowUv, 0, 0, 0, 0, 0.35);
        // First person: the player's own section stands all around the camera and would fill
        // the view with backs of heads, so it is not drawn.
        const hidden = local && ctx.hideLocalLead;
        for (let i = 0; i < u.members && !hidden; i++) {
          memberOffset(def, u.id, i, def.members, this.offset);
          const x = u.x + this.offset.x * cos + this.offset.z * sin;
          const z = u.z - this.offset.x * sin + this.offset.z * cos;
          // A soldier right at the camera (a squad-mate riding past a third-person camera) would
          // be a wall of pixels across the view: not drawn.
          const near = Math.hypot(x - camera.position.x, u.y + 1 - camera.position.y, z - camera.position.z);
          if (near < SPRITE_HIDE_NEAR) continue;
          // The player's own squad near a third-person camera fades (not the player's own soldier).
          const show = own && ctx.fadeSquadNear && !(local && i === 0) ? squadFade(near) : 1;
          const sprite = i < def.visual.primaryCount ? primary : secondary;
          const h = sprite.worldHeight;
          const fallen = knocked ? sprite.anims.get('die') : undefined;
          if (fallen) {
            // Knocked flat: the fall, then lying there until the unit gets up.
            frameRect(fallen, 0, Math.min(fallen.frames - 1, Math.floor((time - this.knockFrom[u.id]) * fallen.fps * 1.5)), uv, 0);
            this.sprites.push(x, u.y, z, h * sprite.aspect, h, uv, 0, shade, shade, shade, show);
            continue;
          }
          const name = firing ? 'fire' : moving ? 'walk' : 'idle';
          const anim = (sprite.anims.get(name) ?? sprite.anims.get('idle') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
          const frame = Math.floor((time + i * 0.13) * anim.fps);
          frameRect(anim, this.facingFor(heading, x, z, camera), frame, uv, 0);
          this.sprites.push(x, u.y, z, h * sprite.aspect, h, uv, 0, shade, shade, shade, show);
          // (One canopy for every two soldiers: one each would make a single dark mass of them.)
          if (u.y > 0.5 && i % 2 === 0) this.chutes(x, u.y + h, z, CHUTE_SOLDIER, 1, u.id * 16 + i, time);
        }
      }

      // Marker: a cyan circle over every unit, a yellow diamond while it charges a volley.
      // (Not over the unit the player drives: they know where they are, and it would sit on the
      // crosshair.) A marker is for finding units far off: close to the camera the unit itself is
      // in plain view, and a marker of its smallest size there would fill the screen (a squad's
      // own squad-mates ride right by a third-person camera), so it fades out up close.
      const near = Math.min(1, Math.max(0, (dist - MARKER_HIDE_NEAR) / MARKER_FADE));
      if (!local && near > 0.02) {
        const size = Math.min(40, Math.max(1.6, dist * 0.022));
        const top = def.height + 1.2 + size * 0.5;
        const charging = u.laser || u.state === 'charging';
        const bright = own ? 1 : 0.7;
        if (charging) {
          const pulse = 0.75 + 0.25 * Math.sin(time * (4 + u.charge * 10));
          this.markers.push(u.x, top, u.z, size * (0.8 + u.charge * 0.5), size * (0.8 + u.charge * 0.5), this.diamondUv, 0, 1, 0.85, 0.1, pulse * near);
        } else {
          this.markers.push(u.x, top, u.z, size * (u.driven ? 1 : 0.75), size * (u.driven ? 1 : 0.75), this.circleUv, 0, 0.12 * bright, 0.78 * bright, 0.88 * bright, (shaken ? 0.5 : 0.95) * near);
        }
        if (u.veteran) this.markers.push(u.x, top + size * 0.7, u.z, size * 0.7, size * 0.7, this.chevronUv, 0, 1, 1, 1, 0.9 * near);
      }

      // Targeting laser: from the muzzle along the aim to whatever it meets first (a building,
      // the ground, or the kaiju's body, head or tail: the hit volume the server uses).
      if (u.laser && ctx.city) {
        const range = weaponDef(def.weapon).range;
        const oy = u.y + def.muzzleHeight;
        resolveAimPoint(ctx.city, u.x, oy, u.z, u.aimYaw, u.aimPitch, range, aim, ctx.kaijus);
        const ex = aim.x;
        const ey = Math.max(0.15, aim.y);
        const ez = aim.z;
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

  /**
   * `count` parachutes over a point coming down (the hook, where the lines meet, at x, hookY, z),
   * swaying a little each its own way.
   */
  private chutes(x: number, hookY: number, z: number, scale: number, count: number, seed: number, time: number): void {
    const rig = this.rig('prop_parachute');
    for (let c = 0; c < count; c++) {
      const s = seed * 1.7 + c * 2.1;
      const swayX = Math.sin(time * 1.3 + s) * 0.08;
      const swayZ = Math.cos(time * 1.1 + s) * 0.08;
      if (count === 1) {
        rig.add(x, hookY, z, s, scale, undefined, swayX, swayZ);
        continue;
      }
      // Several over one load: spread round it, each canopy leaning out.
      const a = (c / count) * Math.PI * 2 + seed;
      const spread = scale * 1.6;
      rig.add(x + Math.sin(a) * spread, hookY, z + Math.cos(a) * spread, a, scale, undefined, 0.22 + swayX, swayZ);
    }
  }

  clear(): void {
    this.fallen.length = 0;
    this.fireUntil.fill(0);
    this.knockUntil.fill(0);
    this.recoilAt.fill(-1e9);
    this.lastY.fill(0);
    for (const rig of this.rigs.values()) {
      rig.begin();
      rig.end();
    }
  }
}
