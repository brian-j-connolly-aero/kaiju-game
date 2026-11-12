/**
 * The human player's controller (DESIGN.md section 5): drives one unit directly, first person
 * from the lead member or third person behind it, fires, opens the command wheel and places
 * its markers. In third person the aim sent to the server is the direction from the unit's
 * eye to whatever the camera's center ray lands on, so the crosshair is honest.
 */

import type * as THREE from 'three';
import {
  Btn,
  clamp,
  COMMAND_IDS,
  createAimPoint,
  createCastHit,
  DEG,
  kaijuStageDef,
  rayVsCapsule,
  resolveAimPoint,
  unitTypeDef,
  wrapAngle,
  type AimPoint,
  type CommandId,
  type GroundMarker,
  type SnapKaiju,
  type VerticalCapsule,
} from '@mb/shared';
import type { ActionState } from '../input/actions';
import { clearOfWalls, easeClearance } from './cameraClearance';
import { aimCamera, setLens, type ControlContext, type Controller, type InputSample } from './types';

const PITCH_LIMIT = 80 * DEG;
const AIM_RANGE = 900;

export interface WheelState {
  open: boolean;
  /** The entry the pointer is on, or null in the dead center. */
  highlight: CommandId | null;
  /** Pointer offset from the wheel's center, each -1..1. */
  x: number;
  y: number;
}

const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const capHit = createCastHit();
const origin = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

/** The wheel's four entries, by direction: up, right, down, left (COMMAND_IDS order clockwise from the top). */
export const WHEEL_LAYOUT: readonly CommandId[] = COMMAND_IDS;

export class HumanController implements Controller {
  readonly kind = 'human' as const;
  thirdPerson: boolean;
  /** Direction the view looks. */
  viewYaw = 0;
  viewPitch = 0;
  /** Direction sent to the server (differs from the view in third person). */
  aimYaw = 0;
  aimPitch = 0;
  readonly wheel: WheelState = { open: false, highlight: null, x: 0, y: 0 };
  /** Where the crosshair lands. */
  readonly aimPoint: AimPoint = createAimPoint();
  /** Seconds since the local player last fired (for the recoil kick). */
  private pendingWheel: CommandId | null = null;
  private pendingMarker: GroundMarker | null = null;
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

  constructor(thirdPerson = false) {
    this.thirdPerson = thirdPerson;
  }

  /** Queues a command to go out with the next input (the map view uses this too). */
  queueCommand(command: CommandId, marker: GroundMarker | null): void {
    this.pendingWheel = command;
    this.pendingMarker = marker;
  }

  private updateWheel(input: ActionState): void {
    const w = this.wheel;
    if (input.pressed.wheel) {
      w.open = true;
      w.x = 0;
      w.y = 0;
      w.highlight = null;
    }
    if (w.open) {
      // While the wheel is open the look input moves its pointer, not the view.
      w.x = clamp(w.x + input.lookX * 2.2, -1, 1);
      w.y = clamp(w.y + input.pointerY * 2.2, -1, 1);
      if (Math.hypot(w.x, w.y) > 0.35) {
        const a = Math.atan2(w.x, w.y);
        const quadrant = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
        w.highlight = WHEEL_LAYOUT[quadrant];
      } else {
        w.highlight = null;
      }
      if (!input.down.wheel) {
        w.open = false;
        if (w.highlight) this.queueCommand(w.highlight, w.highlight === 'moveTo' ? this.groundMarker() : null);
      }
    }
    if (input.pressed.cmdFollow) this.queueCommand('follow', null);
    if (input.pressed.cmdMoveTo) this.queueCommand('moveTo', this.groundMarker());
    if (input.pressed.cmdFireAtWill) this.queueCommand('fireAtWill', null);
    if (input.pressed.cmdHoldCharge) this.queueCommand('holdCharge', null);
  }

  /** The ground point under the crosshair, or null when it is on the sky. */
  private groundMarker(): GroundMarker | null {
    return this.aimPoint.on === 'none' ? null : { x: this.aimPoint.x, z: this.aimPoint.z };
  }

  /** Casts from (ox, oy, oz) along a heading and elevation against the city and the kaijus. */
  private cast(ctx: ControlContext, ox: number, oy: number, oz: number, yaw: number, pitch: number): void {
    const out = this.aimPoint;
    resolveAimPoint(ctx.session.mirror.query, ox, oy, oz, yaw, pitch, AIM_RANGE, out);
    const cp = Math.cos(pitch);
    origin.x = ox;
    origin.y = oy;
    origin.z = oz;
    dir.x = Math.sin(yaw) * cp;
    dir.y = Math.sin(pitch);
    dir.z = Math.cos(yaw) * cp;
    for (const k of ctx.frame.kaijus as SnapKaiju[]) {
      if (!k.alive) continue;
      const st = kaijuStageDef(k.kind, k.stage);
      capsule.x = k.x;
      capsule.z = k.z;
      capsule.r = st.bodyRadius;
      capsule.y0 = 0;
      capsule.y1 = st.height;
      if (rayVsCapsule(origin, dir, out.dist, capsule, capHit) && capHit.t < out.dist) {
        out.dist = capHit.t;
        out.on = 'kaiju';
        out.id = k.id;
        out.x = ox + dir.x * capHit.t;
        out.y = oy + dir.y * capHit.t;
        out.z = oz + dir.z * capHit.t;
      }
    }
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
    if (input.pressed.camera) this.thirdPerson = !this.thirdPerson;
    if (!ctx.mapOpen) this.updateWheel(input);
    else this.wheel.open = false;

    if (input.aimOverride) {
      this.viewYaw = input.aimOverride.yaw;
      this.viewPitch = input.aimOverride.pitch;
    } else if (!ctx.mapOpen && !this.wheel.open) {
      this.viewYaw = wrapAngle(this.viewYaw - input.lookX);
      this.viewPitch = clamp(this.viewPitch + input.lookY, -PITCH_LIMIT, PITCH_LIMIT);
    }

    const def = unitTypeDef(u.type);
    const eyeY = u.y + def.eyeHeight;
    this.updateClearance(ctx);
    if (this.thirdPerson && !input.aimOverride) {
      // Aim from the unit at what the camera's center ray lands on.
      this.cameraPosition(ctx, this.eye);
      this.cast(ctx, this.eye.x, this.eye.y, this.eye.z, this.viewYaw, this.viewPitch);
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
      this.cast(ctx, u.x, eyeY, u.z, this.aimYaw, this.aimPitch);
    }
    ctx.session.aimYaw = this.aimYaw;
    ctx.session.aimPitch = this.aimPitch;

    // A little recoil when a shot actually leaves (the weapon was ready when Fire went down).
    const firing = input.down.fire && !ctx.mapOpen && u.alive && u.cooldown <= 0.05 && u.shaken <= 0;
    if (firing && !this.wasFiring) this.kick = 1;
    this.wasFiring = firing;
    this.kick = Math.max(0, this.kick - ctx.dt * 6);
  }

  sample(ctx: ControlContext): InputSample {
    const input = ctx.input;
    const out: InputSample = { moveX: 0, moveZ: 0, aimYaw: this.aimYaw, aimPitch: this.aimPitch, buttons: 0 };
    if (!ctx.mapOpen) {
      // Movement is relative to the VIEW; in third person the aim can differ from it, so turn
      // the stick into the aim's frame, which is the one the server reads it in.
      const turn = this.viewYaw - this.aimYaw;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      out.moveX = input.moveX * c - input.moveZ * s;
      out.moveZ = input.moveZ * c + input.moveX * s;
      // The latch, not the instant: a click that began and ended between two samples still fires.
      if (input.held.fire && !this.wheel.open) out.buttons |= Btn.fire;
      if (input.held.callIn) out.buttons |= Btn.callIn;
    }
    if (this.pendingWheel) {
      out.wheel = this.pendingWheel;
      if (this.pendingMarker) out.marker = this.pendingMarker;
      this.pendingWheel = null;
      this.pendingMarker = null;
    }
    return out;
  }

  /** Whether the weapon's shot was just fired locally (for the HUD's crosshair pulse). */
  get recoil(): number {
    return this.kick;
  }

  /** Where the chase camera wants to be, walls or no walls. */
  private chasePosition(ctx: ControlContext, out: { x: number; y: number; z: number }): void {
    const u = ctx.frame.localUnit;
    if (!u) return;
    const def = unitTypeDef(u.type);
    const back = def.body === 'infantry' ? 9 : 15 + def.radius;
    const up = def.body === 'infantry' ? 4.2 : 7.5 + def.radius * 0.4;
    const cp = Math.cos(this.viewPitch);
    out.x = u.x - Math.sin(this.viewYaw) * back * cp;
    out.y = Math.max(1, u.y + up - Math.sin(this.viewPitch) * back * 0.6);
    out.z = u.z - Math.cos(this.viewYaw) * back * cp;
  }

  /** The point above the unit that the chase camera hangs from (always in the open). */
  private chasePivot(ctx: ControlContext): { x: number; y: number; z: number } {
    const u = ctx.frame.localUnit;
    const p = this.pivot;
    if (u) {
      const def = unitTypeDef(u.type);
      p.x = u.x;
      p.y = u.y + def.eyeHeight + (def.body === 'vehicle' ? 0.6 : 0);
      p.z = u.z;
    }
    return p;
  }

  /** Once per frame: how far out the chase camera may go before it meets a wall. */
  private updateClearance(ctx: ControlContext): void {
    if (!this.thirdPerson || !ctx.frame.localUnit) {
      this.clear = 1;
      return;
    }
    this.chasePosition(ctx, this.eye);
    this.clear = easeClearance(this.clear, clearOfWalls(ctx.session.mirror.query, this.chasePivot(ctx), this.eye, 0.6), ctx.dt);
  }

  private cameraPosition(ctx: ControlContext, out: { x: number; y: number; z: number }): void {
    const u = ctx.frame.localUnit;
    if (!u) return;
    const def = unitTypeDef(u.type);
    if (!this.thirdPerson) {
      out.x = u.x;
      out.y = u.y + def.eyeHeight + (def.body === 'vehicle' ? 0.6 : 0);
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

  applyCamera(ctx: ControlContext, camera: THREE.PerspectiveCamera): void {
    if (!ctx.frame.localUnit) return;
    this.cameraPosition(ctx, this.eye);
    camera.position.set(this.eye.x, this.eye.y, this.eye.z);
    setLens(camera, this.thirdPerson ? 58 : 66, 0.25, 9000);
    aimCamera(camera, this.viewYaw, this.viewPitch + this.kick * 0.012);
  }
}
