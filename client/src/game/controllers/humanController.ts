/**
 * The human player's controller (DESIGN.md section 5): drives one unit directly, third person
 * from behind it (the default) or first person from the lead member. Two buttons: Fire (the
 * unit's own weapon) and Volley (held: the three squad-mates plant and charge; let go: they all
 * fire at the crosshair).
 *
 * In third person the aim sent to the server is the direction from the unit's eye to whatever
 * the camera's center ray lands on, so the crosshair is honest. Rocket infantry (stage 1) moves
 * relative to the view. The tank or troop the player drives at stages 2 and 3 is driven like a
 * tank (net/input.ts): W and S are the throttle, A and D turn the hull, and they go to the
 * server as they are, not turned into the view's frame. The turret swings toward the aim at its
 * own rate and the shells leave along it, so the controller also works out where the gun
 * points now (`gunPoint`): the HUD draws a second reticle there.
 */

import type * as THREE from 'three';
import {
  Btn,
  clamp,
  createAimPoint,
  createCastHit,
  DEG,
  kaijuStageDef,
  PROP_KINDS,
  propsInCircle,
  rayVsCapsule,
  resolveAimPoint,
  unitTypeDef,
  wrapAngle,
  type AimPoint,
  type CityData,
  type CityQuery,
  type SnapUnit,
  type VerticalCapsule,
} from '@mb/shared';
import { clearOfWalls, easeClearance, type Point3 } from './cameraClearance';
import { aimCamera, setLens, type ControlContext, type Controller, type InputSample } from './types';

/** How far the view may look up or down, in both cameras. */
export const HUMAN_PITCH_LIMIT = 80 * DEG;
const PITCH_LIMIT = HUMAN_PITCH_LIMIT;
const AIM_RANGE = 900;

/**
 * Props the chase camera keeps out of, by the radius of what shows (meters): a tree's crown is
 * far wider than its trunk, and a billboard's board. From inside one the camera sees nothing but
 * leaves (props never block a body, so a unit drives right past them).
 */
const CAMERA_SCREENS: Readonly<Partial<Record<string, number>>> = { tree_a: 3.2, tree_b: 3.8, billboard: 2.8 };
const propIds: number[] = [];
const crown: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const crownHit = createCastHit();
const crownDir = { x: 0, y: 0, z: 0 };

/**
 * The fraction (0..1) of the way from `pivot` to `eye` that is clear of tree crowns and
 * billboards, `margin` meters short of the first; 1 when nothing is in the way. A crown the
 * pivot itself stands under is no obstacle (the unit is driving past the tree).
 */
export function clearOfProps(city: CityData, query: CityQuery, pivot: Point3, eye: Point3, margin: number): number {
  const dx = eye.x - pivot.x;
  const dy = eye.y - pivot.y;
  const dz = eye.z - pivot.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return 1;
  crownDir.x = dx / len;
  crownDir.y = dy / len;
  crownDir.z = dz / len;
  propsInCircle(query, (pivot.x + eye.x) / 2, (pivot.z + eye.z) / 2, Math.hypot(dx, dz) / 2 + 4 + margin, propIds);
  let t = Number.POSITIVE_INFINITY;
  for (const id of propIds) {
    const p = city.props[id];
    const r = p ? CAMERA_SCREENS[p.kind] : undefined;
    if (!p || !r) continue;
    crown.r = r + margin;
    if (Math.hypot(pivot.x - p.x, pivot.z - p.z) < crown.r) continue;
    crown.x = p.x;
    crown.z = p.z;
    crown.y0 = 0;
    crown.y1 = PROP_KINDS[p.kind].height + 1;
    if (rayVsCapsule(pivot, crownDir, len + margin, crown, crownHit) && crownHit.t < t) t = crownHit.t;
  }
  return t === Number.POSITIVE_INFINITY ? 1 : clamp(t / len, 0, 1);
}

/**
 * Where the chase camera hangs, behind the unit along the view and above it (meters). Infantry
 * close, a tank or troop farther back and higher: the center ray of the view passes over the
 * vehicles, so they never stand on the crosshair, and the hull and the turret stay in sight.
 */
export function chaseOffset(unitType: SnapUnit['type']): { back: number; up: number } {
  const def = unitTypeDef(unitType);
  if (def.body === 'infantry') return { back: 9, up: 4.2 };
  return { back: 11 + def.radius * 1.4, up: 4.6 + def.radius * 0.5 };
}

/** True when the unit a player drives handles like a tank (stages 2 and 3: net/input.ts). */
export function drivesLikeTank(u: Pick<SnapUnit, 'type' | 'driven'>): boolean {
  return u.driven && unitTypeDef(u.type).drive !== undefined;
}

/**
 * The army's sense of speed (docs/ROADMAP.md phase 2): how many degrees wider the lens is at
 * `share` of the unit's top speed. A little on foot, more in a tank, most near its top speed.
 */
export function speedLensWidening(share: number, vehicle: boolean): number {
  const s = Math.min(1.1, Math.max(0, share));
  return vehicle ? 9 * s * s : 3 * s;
}

/** On foot: meters per step (a running soldier), how high the view bobs (meters) and rolls (radians) at full speed. */
const STEP_LENGTH = 2.2;
const BOB_HEIGHT = 0.07;
const BOB_ROLL = 0.006;
/** A tank's chase camera trails its speed by this many seconds of travel (it pulls back as the tank speeds up). */
const TANK_LAG = 0.11;
/** How far a tank's camera leans into a turn: radians per radian a second of the hull's turn, and at most. */
const TANK_LEAN = 0.05;
const TANK_LEAN_MAX = 0.045;

export class HumanController implements Controller {
  readonly kind = 'human' as const;
  thirdPerson: boolean;
  /** Direction the view looks. */
  viewYaw = 0;
  viewPitch = 0;
  /** Direction sent to the server (differs from the view in third person). */
  aimYaw = 0;
  aimPitch = 0;
  /** Where the crosshair lands (the view's aim: a volley goes there). */
  readonly aimPoint: AimPoint = createAimPoint();
  /**
   * Where the driven unit's own weapon points now and its shot would land. For a tank that is
   * along the turret, which catches up with the aim at its own rate; for infantry it is the
   * crosshair's point. Worked out once the frame's body is in place (`applyCamera`).
   */
  readonly gunPoint: AimPoint = createAimPoint();
  /** The unit driven right now handles like a tank (stages 2 and 3). */
  tank = false;
  /** The volley button is down (and the map is closed): the squad-mates are planting or charging. */
  volleyHeld = false;
  /** The volley button went down since the last sample (a tap shorter than the gap between two still counts). */
  private volleyTap = false;
  private started = false;
  private lastX = 0;
  private lastZ = 0;
  private lastUnit = -1;
  private lastStage = 0;
  private kick = 0;
  private wasFiring = false;
  private readonly eye = { x: 0, y: 0, z: 0 };
  /** How much of the way from the unit to the chase camera is free of walls (eased). */
  private clear = 1;
  private readonly pivot = { x: 0, y: 0, z: 0 };
  /** The sense of speed: the lens's widening (degrees, eased), the step bob's phase, the tank camera's trailing speed and lean. */
  private widen = 0;
  private stepPhase = 0;
  private stepShare = 0;
  private readonly trail = { x: 0, z: 0 };
  private lean = 0;
  private lastYaw = 0;
  private lastYawUnit = -1;

  constructor(thirdPerson = false) {
    this.thirdPerson = thirdPerson;
  }

  /** Casts from (ox, oy, oz) along a heading and elevation against the city and the kaijus. */
  private cast(ctx: ControlContext, ox: number, oy: number, oz: number, yaw: number, pitch: number, out: AimPoint): void {
    resolveAimPoint(ctx.session.mirror.query, ox, oy, oz, yaw, pitch, AIM_RANGE, out, ctx.frame.kaijus);
  }

  update(ctx: ControlContext): void {
    const u = ctx.frame.localUnit;
    const input = ctx.input;
    if (!u) return;
    if (!this.started) {
      this.started = true;
      this.viewYaw = u.aimYaw;
      this.aimYaw = u.aimYaw;
    }
    // Took over another unit of the squad (the leader fell): keep looking the way the player
    // was looking, or at the kaiju when the squads know where it is. Redeployed for a new
    // stage: look toward the middle of the new zone.
    const stage = ctx.frame.match.stage;
    if (this.lastUnit >= 0) {
      const tookOver = u.id !== this.lastUnit && stage === this.lastStage;
      const jumped = Math.hypot(u.x - this.lastX, u.z - this.lastZ) > 40 || stage !== this.lastStage;
      const k = ctx.frame.kaijus[0];
      if (tookOver) {
        if (k && k.alive && k.known) {
          const def = unitTypeDef(u.type);
          const st = kaijuStageDef(k.kind, k.stage);
          const flat = Math.max(1, Math.hypot(k.x - u.x, k.z - u.z));
          this.viewYaw = Math.atan2(k.x - u.x, k.z - u.z);
          this.viewPitch = clamp(Math.atan2(st.height * 0.5 - (u.y + def.eyeHeight), flat), -PITCH_LIMIT, PITCH_LIMIT);
        }
      } else if (jumped) {
        const b = ctx.frame.bounds;
        this.viewYaw = Math.atan2((b.minX + b.maxX) / 2 - u.x, (b.minZ + b.maxZ) / 2 - u.z);
        this.viewPitch = 0;
      }
    }
    this.lastX = u.x;
    this.lastZ = u.z;
    this.lastUnit = u.id;
    this.lastStage = stage;
    this.tank = drivesLikeTank(u);
    if (input.pressed.camera) this.thirdPerson = !this.thirdPerson;

    if (input.aimOverride) {
      this.viewYaw = input.aimOverride.yaw;
      this.viewPitch = input.aimOverride.pitch;
    } else if (!ctx.mapOpen) {
      this.viewYaw = wrapAngle(this.viewYaw - input.lookX);
      this.viewPitch = clamp(this.viewPitch + input.lookY, -PITCH_LIMIT, PITCH_LIMIT);
    }

    const def = unitTypeDef(u.type);
    const eyeY = u.y + def.eyeHeight;
    this.updateMotion(ctx, u);
    this.updateClearance(ctx);
    if (this.thirdPerson && !input.aimOverride) {
      // Aim from the unit at what the camera's center ray lands on.
      this.cameraPosition(ctx, this.eye);
      this.cast(ctx, this.eye.x, this.eye.y, this.eye.z, this.viewYaw, this.viewPitch, this.aimPoint);
      const dx = this.aimPoint.x - u.x;
      const dy = this.aimPoint.y - eyeY;
      const dz = this.aimPoint.z - u.z;
      const flat = Math.hypot(dx, dz);
      if (flat > def.radius + 2) {
        this.aimYaw = Math.atan2(dx, dz);
        this.aimPitch = clamp(Math.atan2(dy, flat), -PITCH_LIMIT, PITCH_LIMIT);
      } else {
        this.aimYaw = this.viewYaw;
        this.aimPitch = this.viewPitch;
      }
    } else {
      this.aimYaw = this.viewYaw;
      this.aimPitch = this.viewPitch;
      this.cast(ctx, u.x, eyeY, u.z, this.aimYaw, this.aimPitch, this.aimPoint);
    }
    ctx.session.aimYaw = this.aimYaw;
    ctx.session.aimPitch = this.aimPitch;
    this.volleyHeld = input.down.volley && !ctx.mapOpen && u.alive;
    if (input.pressed.volley) this.volleyTap = true;

    // A little recoil when a shot actually leaves (the weapon was ready when Fire went down).
    const firing = input.down.fire && !ctx.mapOpen && u.alive && u.cooldown <= 0.05 && u.shaken <= 0 && u.stun <= 0;
    if (firing && !this.wasFiring) this.kick = 1;
    this.wasFiring = firing;
    this.kick = Math.max(0, this.kick - ctx.dt * 6);
  }

  sample(ctx: ControlContext): InputSample {
    const input = ctx.input;
    const out: InputSample = { moveX: 0, moveZ: 0, aimYaw: this.aimYaw, aimPitch: this.aimPitch, buttons: 0 };
    if (!ctx.mapOpen) {
      if (this.tank) {
        // A tank's stick goes as it is: W and S the throttle, A and D the hull's turn.
        out.moveX = input.moveX;
        out.moveZ = input.moveZ;
      } else {
        // Infantry moves relative to the VIEW; in third person the aim can differ from it, so
        // turn the stick into the aim's frame, which is the one the server reads it in.
        const turn = this.viewYaw - this.aimYaw;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        out.moveX = input.moveX * c - input.moveZ * s;
        out.moveZ = input.moveZ * c + input.moveX * s;
      }
      // The latch, not the instant: a click that began and ended between two samples still fires.
      if (input.held.fire) out.buttons |= Btn.fire;
      // Volley is a hold whose end matters (letting go fires the squad): it goes as it is now,
      // so the release is in the very next sample, and a tap between two samples still counts once.
      if (input.down.volley || this.volleyTap) out.buttons |= Btn.volley;
    }
    this.volleyTap = false;
    return out;
  }

  /** Whether the weapon's shot was just fired locally (for the HUD's crosshair pulse). */
  get recoil(): number {
    return this.kick;
  }

  /**
   * Once per frame, the sense of speed: the lens widens with the speed, the step bob runs on
   * foot, a tank's camera trails its speed and leans into the hull's turn. All eased, so a
   * redeploy or a takeover does not jerk the view.
   */
  private updateMotion(ctx: ControlContext, u: SnapUnit): void {
    const def = unitTypeDef(u.type);
    const dt = ctx.dt;
    const speed = u.alive ? Math.hypot(u.vx, u.vz) : 0;
    const share = speed / Math.max(0.1, def.speed);
    const vehicle = def.body === 'vehicle';
    const target = speedLensWidening(share, vehicle);
    this.widen += (target - this.widen) * (1 - Math.exp(-dt * (target > this.widen ? 2.5 : 1.8)));
    this.stepShare += (Math.min(1, share) - this.stepShare) * (1 - Math.exp(-dt * 6));
    this.stepPhase += (speed * dt * Math.PI) / STEP_LENGTH;
    const ease = 1 - Math.exp(-dt * 4);
    if (vehicle) {
      this.trail.x += (u.vx - this.trail.x) * ease;
      this.trail.z += (u.vz - this.trail.z) * ease;
      // The hull's turn rate, from its heading this frame and last (not across a takeover).
      let turn = 0;
      if (this.lastYawUnit === u.id && dt > 0) turn = wrapAngle(u.yaw - this.lastYaw) / dt;
      const lean = clamp(-turn * TANK_LEAN, -TANK_LEAN_MAX, TANK_LEAN_MAX);
      this.lean += (lean - this.lean) * (1 - Math.exp(-dt * 5));
    } else {
      this.trail.x *= 1 - ease;
      this.trail.z *= 1 - ease;
      this.lean *= 1 - ease;
    }
    this.lastYaw = u.yaw;
    this.lastYawUnit = u.id;
  }

  /**
   * Where the chase camera wants to be, walls or no walls. A tank's camera trails its speed (it
   * hangs back as the tank speeds up and catches up as it slows); on foot the view bobs in step.
   */
  private chasePosition(ctx: ControlContext, out: { x: number; y: number; z: number }): void {
    const u = ctx.frame.localUnit;
    if (!u) return;
    const { back, up } = chaseOffset(u.type);
    const cp = Math.cos(this.viewPitch);
    out.x = u.x - Math.sin(this.viewYaw) * back * cp - this.trail.x * TANK_LAG;
    out.y = Math.max(1, u.y + up - Math.sin(this.viewPitch) * back * 0.6) + this.bob();
    out.z = u.z - Math.cos(this.viewYaw) * back * cp - this.trail.z * TANK_LAG;
  }

  /** The step bob on foot (meters up): a little lift on every stride, more at a run. */
  private bob(): number {
    return this.tank ? 0 : Math.abs(Math.sin(this.stepPhase)) * BOB_HEIGHT * this.stepShare;
  }

  /** The point above the unit that the chase camera hangs from (always in the open). */
  private chasePivot(ctx: ControlContext): { x: number; y: number; z: number } {
    const u = ctx.frame.localUnit;
    const p = this.pivot;
    if (u) {
      const def = unitTypeDef(u.type);
      p.x = u.x;
      // At the chase camera's own height: a camera that a wall pulls in comes in level, over the
      // unit, instead of down onto its roof (a tank's turret would fill the lower half of the view).
      p.y = u.y + Math.max(def.eyeHeight + (def.body === 'vehicle' ? 0.6 : 0), chaseOffset(u.type).up);
      p.z = u.z;
    }
    return p;
  }

  /** Once per frame: how far out the chase camera may go before it meets a wall or a tree's crown. */
  private updateClearance(ctx: ControlContext): void {
    if (!this.thirdPerson || !ctx.frame.localUnit) {
      this.clear = 1;
      return;
    }
    this.chasePosition(ctx, this.eye);
    const mirror = ctx.session.mirror;
    const pivot = this.chasePivot(ctx);
    const clear = Math.min(clearOfWalls(mirror.query, pivot, this.eye, 0.6), clearOfProps(mirror.city, mirror.query, pivot, this.eye, 0.6));
    this.clear = easeClearance(this.clear, clear, ctx.dt);
  }

  private cameraPosition(ctx: ControlContext, out: { x: number; y: number; z: number }): void {
    const u = ctx.frame.localUnit;
    if (!u) return;
    const def = unitTypeDef(u.type);
    if (!this.thirdPerson) {
      out.x = u.x;
      out.y = u.y + def.eyeHeight + (def.body === 'vehicle' ? 0.6 : 0) + this.bob() * 0.8;
      out.z = u.z;
      return;
    }
    this.chasePosition(ctx, out);
    if (this.clear < 1) {
      // A wall behind the unit: the camera comes in to this side of it.
      const pivot = this.chasePivot(ctx);
      out.x = pivot.x + (out.x - pivot.x) * this.clear;
      out.y = pivot.y + (out.y - pivot.y) * this.clear;
      out.z = pivot.z + (out.z - pivot.z) * this.clear;
    }
  }

  /**
   * Where the driven unit's weapon points: from its eye along its own aim, which is the turret
   * of a tank (the frame's unit carries the predicted turret) and the crosshair's aim for
   * infantry. Call once the frame's body is where it is drawn.
   */
  private updateGun(ctx: ControlContext): void {
    const u = ctx.frame.localUnit;
    if (!u) return;
    if (!this.tank) {
      Object.assign(this.gunPoint, this.aimPoint);
      return;
    }
    const def = unitTypeDef(u.type);
    this.cast(ctx, u.x, u.y + def.eyeHeight, u.z, u.aimYaw, this.aimPitch, this.gunPoint);
  }

  applyCamera(ctx: ControlContext, camera: THREE.PerspectiveCamera): void {
    if (!ctx.frame.localUnit) return;
    this.updateGun(ctx);
    this.cameraPosition(ctx, this.eye);
    camera.position.set(this.eye.x, this.eye.y, this.eye.z);
    // The lens widens with speed (rounded so the projection is not rebuilt every frame for nothing).
    setLens(camera, (this.thirdPerson ? 58 : 66) + Math.round(this.widen * 20) / 20, 0.25, 9000);
    aimCamera(camera, this.viewYaw, this.viewPitch + this.kick * 0.012);
    // A tank's camera leans into the hull's turn; a soldier's view rolls a touch with each stride.
    const roll = this.tank ? this.lean : Math.sin(this.stepPhase) * BOB_ROLL * this.stepShare * (this.thirdPerson ? 0.5 : 1);
    if (roll !== 0) camera.rotateZ(roll);
  }
}
