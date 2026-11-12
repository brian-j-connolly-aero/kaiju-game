/**
 * The kaiju player's controller (DESIGN.md section 4). The mouse or right stick sets a desired
 * heading; the body turns toward it at the stage's turn rate, and the head, which is the
 * first-person camera, can lead the body by at most 50 degrees. So a flick of the mouse does
 * not snap the view around: the head swings to its limit and the body lumbers after it.
 *
 * First person sits on the rig's `cam_fp` node (own snout and claws in view); the toggle gives
 * a chase camera behind the body. In the chase camera the aim sent to the server runs from the
 * kaiju's eye (its mouth while the beam is on) to whatever the camera's center ray lands on, so
 * the crosshair shows where a throw or the beam goes.
 */

import type * as THREE from 'three';
import {
  Btn,
  clamp,
  clampAngleAround,
  createAimPoint,
  DEG,
  kaijuEyePoint,
  kaijuMouthPoint,
  kaijuStageDef,
  lerpAngle,
  resolveAimPoint,
  wrapAngle,
  type AimPoint,
  type SnapKaiju,
} from '@mb/shared';
import { clearOfWalls, easeClearance, type Point3 } from './cameraClearance';
import { aimCamera, setLens, type ControlContext, type Controller, type InputSample } from './types';

/** How far the desired heading may run ahead of the body: enough to ask for a turn-around. */
const MAX_HEADING_LEAD = 150 * DEG;
const PITCH_LIMIT = 62 * DEG;
/** How high the chase camera may rise over a wall behind the kaiju, in body heights. */
const MAX_LIFT = 2.4;

/** Where the chase camera wants to be and what it looks at, before walls. */
interface ChasePose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

/**
 * The lift (body heights) that takes a camera at `wanted`, looking from `pivot`, clear over the
 * walls between them: the lowest of a few steps whose line of sight is free, or -1 when none is.
 */
export function liftOverWalls(query: Parameters<typeof clearOfWalls>[0], pivot: Point3, wanted: Point3, height: number, margin: number): number {
  const probe = { x: wanted.x, y: wanted.y, z: wanted.z };
  for (let i = 0; i <= 12; i++) {
    const lift = (MAX_LIFT * i) / 12;
    probe.y = wanted.y + lift * height;
    if (clearOfWalls(query, pivot, probe, margin) >= 1) return lift;
  }
  return -1;
}

export class KaijuController implements Controller {
  readonly kind = 'kaiju' as const;
  thirdPerson: boolean;
  /** The heading the player wants (the view; what is sent as aimYaw in first person). */
  aimYaw = 0;
  aimPitch = 0;
  /** What is sent to the server: the view in first person, the crosshair's target in third. */
  sendYaw = 0;
  sendPitch = 0;
  /** Where the crosshair lands (third person). */
  readonly aimPoint: AimPoint = createAimPoint();
  private started = false;
  private chaseYaw = 0;
  private orbit = 0;
  /** How much of the way from the body to the wanted camera position is free of walls (eased). */
  private clear = 1;
  /** How far the chase camera has risen over a wall behind the kaiju, body heights (eased). */
  private lift = 0;
  /** How far in the cocoon camera has come to stay clear of the buildings around (eased). */
  private orbitClear = 1;
  private readonly pivot = { x: 0, y: 0, z: 0 };
  private readonly chase: ChasePose = { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0 };
  private readonly eye = { x: 0, y: 0, z: 0 };

  constructor(thirdPerson = false) {
    this.thirdPerson = thirdPerson;
  }

  /** First person with the camera pulled back inside the skull by a wall ahead. */
  get insideHead(): boolean {
    return !this.thirdPerson && this.clear < 0.999;
  }

  update(ctx: ControlContext): void {
    const k = ctx.frame.localKaiju;
    const input = ctx.input;
    if (!k) return;
    if (!this.started) {
      this.started = true;
      this.aimYaw = k.yaw;
      this.chaseYaw = k.yaw;
    }
    if (input.pressed.camera) {
      this.thirdPerson = !this.thirdPerson;
      this.clear = 1;
      this.lift = 0;
    }
    if (input.aimOverride) {
      this.aimYaw = input.aimOverride.yaw;
      this.aimPitch = input.aimOverride.pitch;
    } else if (!ctx.mapOpen) {
      this.aimYaw = wrapAngle(this.aimYaw - input.lookX);
      this.aimPitch += input.lookY;
    }
    this.aimYaw = clampAngleAround(this.aimYaw, k.yaw, MAX_HEADING_LEAD);
    this.aimPitch = clamp(this.aimPitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.sendYaw = this.aimYaw;
    this.sendPitch = this.aimPitch;
    if (this.thirdPerson && k.phase !== 'cocoon' && k.phase !== 'dead') {
      this.chaseYaw = lerpAngle(this.chaseYaw, this.aimYaw, 1 - Math.exp(-ctx.dt * 9));
      this.placeChase(ctx, k);
      if (!input.aimOverride) this.aimFromCamera(ctx, k);
    }
    ctx.session.aimYaw = this.sendYaw;
    ctx.session.aimPitch = this.sendPitch;
  }

  sample(ctx: ControlContext): InputSample {
    // The latch, not the instant: a click that began and ended between two samples is in this one.
    const d = ctx.input.held;
    if (ctx.mapOpen) return { moveX: 0, moveZ: 0, aimYaw: this.sendYaw, aimPitch: this.sendPitch, buttons: 0 };
    let buttons = 0;
    if (d.strike) buttons |= Btn.strike;
    if (d.grab) buttons |= Btn.grab;
    if (d.block) buttons |= Btn.block;
    if (d.roar) buttons |= Btn.roar;
    if (d.special) buttons |= Btn.special;
    if (d.molt) buttons |= Btn.molt;
    // The stick is relative to the view; the server reads it relative to the aim it is sent.
    const turn = this.aimYaw - this.sendYaw;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const mx = ctx.input.moveX;
    const mz = ctx.input.moveZ;
    return { moveX: mx * c - mz * s, moveZ: mz * c + mx * s, aimYaw: this.sendYaw, aimPitch: this.sendPitch, buttons };
  }

  /**
   * The chase camera for this frame: behind and above along the lazily turning heading. A wall
   * behind the kaiju does not pull the camera in against its back (the view would be nothing
   * but spines); the camera rises over the wall instead, and looks down past the shoulders.
   * Only when no height up to MAX_LIFT clears it (a titan wading through towers) does it come in.
   */
  private placeChase(ctx: ControlContext, k: SnapKaiju): void {
    const st = kaijuStageDef(k.kind, k.stage);
    const back = st.height * 2.3 + st.bodyRadius * 2;
    const up = st.height * 1.15;
    const cp = Math.cos(this.aimPitch * 0.6);
    const p = this.chase;
    p.x = k.x - Math.sin(this.chaseYaw) * back * cp;
    p.y = Math.max(st.height * 0.25, up - Math.sin(this.aimPitch * 0.6) * back * 0.5);
    p.z = k.z - Math.cos(this.chaseYaw) * back * cp;
    p.lookX = k.x + Math.sin(this.chaseYaw) * st.height * 1.5;
    p.lookY = st.height * 0.7;
    p.lookZ = k.z + Math.cos(this.chaseYaw) * st.height * 1.5;
    const near = Math.max(0.3, st.height * 0.05);
    this.pivot.x = k.x;
    this.pivot.y = st.height * 0.85;
    this.pivot.z = k.z;
    const query = ctx.session.mirror.query;
    const wanted = liftOverWalls(query, this.pivot, p, st.height, near * 2);
    // Up quickly, down gently (so walking past a row of houses does not bob the camera).
    const target = Math.max(0, wanted);
    this.lift = target > this.lift ? this.lift + (target - this.lift) * (1 - Math.exp(-ctx.dt * 10)) : this.lift + (target - this.lift) * (1 - Math.exp(-ctx.dt * 1.5));
    p.y += this.lift * st.height;
    // Whatever is still in the way (rising, or nothing clears it): come in to this side of it.
    this.clear = easeClearance(this.clear, clearOfWalls(query, this.pivot, p, near * 2), ctx.dt);
    if (this.clear < 1) {
      p.x = this.pivot.x + (p.x - this.pivot.x) * this.clear;
      p.y = this.pivot.y + (p.y - this.pivot.y) * this.clear;
      p.z = this.pivot.z + (p.z - this.pivot.z) * this.clear;
    }
  }

  /** Third person: aim from the kaiju's eye (or mouth, for the beam) at what the crosshair is on. */
  private aimFromCamera(ctx: ControlContext, k: SnapKaiju): void {
    const p = this.chase;
    const dx = p.lookX - p.x;
    const dy = p.lookY - p.y;
    const dz = p.lookZ - p.z;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const st = kaijuStageDef(k.kind, k.stage);
    resolveAimPoint(ctx.session.mirror.query, p.x, p.y, p.z, yaw, pitch, st.height * 40, this.aimPoint);
    const a = this.aimPoint;
    if (a.on === 'none') {
      // The sky: aim the same way the camera looks.
      this.sendYaw = clampAngleAround(yaw, k.yaw, MAX_HEADING_LEAD);
      this.sendPitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
      return;
    }
    // The eye (or mouth) moves with the aim heading; one refinement is plenty.
    const beam = k.action === 'special';
    const source = { kind: k.kind, stage: k.stage, x: k.x, z: k.z, aimYaw: this.aimYaw };
    for (let i = 0; i < 2; i++) {
      if (beam) kaijuMouthPoint(source, this.eye);
      else kaijuEyePoint(source, this.eye);
      const ex = a.x - this.eye.x;
      const ez = a.z - this.eye.z;
      const flat = Math.hypot(ex, ez);
      if (flat < st.bodyRadius) {
        this.sendYaw = this.aimYaw;
        this.sendPitch = this.aimPitch;
        return;
      }
      source.aimYaw = Math.atan2(ex, ez);
      this.sendYaw = clampAngleAround(source.aimYaw, k.yaw, MAX_HEADING_LEAD);
      this.sendPitch = clamp(Math.atan2(a.y - this.eye.y, flat), -PITCH_LIMIT, PITCH_LIMIT);
    }
  }

  applyCamera(ctx: ControlContext, camera: THREE.PerspectiveCamera): void {
    const k = ctx.frame.localKaiju;
    if (!k) return;
    const st = kaijuStageDef(k.kind, k.stage);
    if (k.phase === 'cocoon' || k.phase === 'dead') {
      // Helpless inside the cocoon (or fallen): watch from outside, circling slowly, and come in
      // to this side of any building that would stand between the camera and the body.
      this.orbit += ctx.dt * 0.35;
      const r = st.height * 2.6 + 14;
      const eye = this.eye;
      eye.x = k.x + Math.sin(this.orbit) * r;
      eye.y = st.height * 1.1 + 5;
      eye.z = k.z + Math.cos(this.orbit) * r;
      this.pivot.x = k.x;
      this.pivot.y = st.height * 0.9;
      this.pivot.z = k.z;
      const near = Math.max(0.3, st.height * 0.05);
      this.orbitClear = easeClearance(this.orbitClear, clearOfWalls(ctx.session.mirror.query, this.pivot, eye, near * 2), ctx.dt, 2);
      camera.position.set(
        this.pivot.x + (eye.x - this.pivot.x) * this.orbitClear,
        this.pivot.y + (eye.y - this.pivot.y) * this.orbitClear,
        this.pivot.z + (eye.z - this.pivot.z) * this.orbitClear,
      );
      setLens(camera, 60, near, 9000);
      camera.up.set(0, 1, 0);
      camera.lookAt(k.x, st.height * 0.45, k.z);
      return;
    }
    this.orbit = k.yaw + Math.PI;
    this.orbitClear = 1;
    if (!this.thirdPerson) {
      // In the head: the camera rides the rig's anchor and looks where the head looks.
      const anchor = ctx.renderer.kaijuCamAnchor(k.id);
      if (anchor) camera.position.copy(anchor);
      else camera.position.set(k.x, st.eyeHeight, k.z);
      const near = Math.max(0.08, st.height * 0.02);
      // From stage 2 on the head reaches past the body's collision circle: against a tower the
      // eye would be inside it. Hold it back, level with itself, short of the wall.
      this.pivot.x = k.x;
      this.pivot.y = camera.position.y;
      this.pivot.z = k.z;
      this.clear = easeClearance(this.clear, clearOfWalls(ctx.session.mirror.query, this.pivot, camera.position, near * 2.5), ctx.dt);
      if (this.clear < 1) {
        camera.position.x = k.x + (camera.position.x - k.x) * this.clear;
        camera.position.z = k.z + (camera.position.z - k.z) * this.clear;
      }
      setLens(camera, 72, near, 9000);
      aimCamera(camera, k.aimYaw, k.aimPitch);
    } else {
      const p = this.chase;
      camera.position.set(p.x, p.y, p.z);
      setLens(camera, 60, Math.max(0.3, st.height * 0.05), 9000);
      camera.up.set(0, 1, 0);
      camera.lookAt(p.lookX, p.lookY, p.lookZ);
    }
  }
}
