/**
 * The kaiju player's controller (DESIGN.md section 4). The mouse or right stick sets a desired
 * heading; the body turns toward it at the stage's turn rate, and the head, which is the
 * first-person camera, can lead the body by at most 50 degrees. So a flick of the mouse does
 * not snap the view around: the head swings to its limit and the body lumbers after it.
 *
 * First person sits on the rig's `cam_fp` node (own snout and claws in view); the toggle gives
 * a chase camera behind the body.
 */

import type * as THREE from 'three';
import { Btn, clamp, clampAngleAround, DEG, kaijuStageDef, lerpAngle, wrapAngle } from '@mb/shared';
import { clearOfWalls, easeClearance } from './cameraClearance';
import { aimCamera, setLens, type ControlContext, type Controller, type InputSample } from './types';

/** How far the desired heading may run ahead of the body: enough to ask for a turn-around. */
const MAX_HEADING_LEAD = 150 * DEG;
const PITCH_LIMIT = 62 * DEG;

export class KaijuController implements Controller {
  readonly kind = 'kaiju' as const;
  thirdPerson: boolean;
  /** The heading the player wants (what is sent as aimYaw). */
  aimYaw = 0;
  aimPitch = 0;
  private started = false;
  private chaseYaw = 0;
  private orbit = 0;
  /** How much of the way from the body to the wanted camera position is free of walls (eased). */
  private clear = 1;
  private readonly pivot = { x: 0, y: 0, z: 0 };

  constructor(thirdPerson = false) {
    this.thirdPerson = thirdPerson;
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
    if (input.pressed.camera) this.thirdPerson = !this.thirdPerson;
    if (input.aimOverride) {
      this.aimYaw = input.aimOverride.yaw;
      this.aimPitch = input.aimOverride.pitch;
    } else if (!ctx.mapOpen) {
      this.aimYaw = wrapAngle(this.aimYaw - input.lookX);
      this.aimPitch += input.lookY;
    }
    this.aimYaw = clampAngleAround(this.aimYaw, k.yaw, MAX_HEADING_LEAD);
    this.aimPitch = clamp(this.aimPitch, -PITCH_LIMIT, PITCH_LIMIT);
    ctx.session.aimYaw = this.aimYaw;
    ctx.session.aimPitch = this.aimPitch;
  }

  sample(ctx: ControlContext): InputSample {
    const d = ctx.input.down;
    if (ctx.mapOpen) return { moveX: 0, moveZ: 0, aimYaw: this.aimYaw, aimPitch: this.aimPitch, buttons: 0 };
    let buttons = 0;
    if (d.strike) buttons |= Btn.strike;
    if (d.grab) buttons |= Btn.grab;
    if (d.block) buttons |= Btn.block;
    if (d.roar) buttons |= Btn.roar;
    if (d.special) buttons |= Btn.special;
    if (d.molt) buttons |= Btn.molt;
    return { moveX: ctx.input.moveX, moveZ: ctx.input.moveZ, aimYaw: this.aimYaw, aimPitch: this.aimPitch, buttons };
  }

  applyCamera(ctx: ControlContext, camera: THREE.PerspectiveCamera): void {
    const k = ctx.frame.localKaiju;
    if (!k) return;
    const st = kaijuStageDef(k.kind, k.stage);
    if (k.phase === 'cocoon' || k.phase === 'dead') {
      // Helpless inside the cocoon (or fallen): watch from outside, circling slowly.
      this.orbit += ctx.dt * 0.35;
      const r = st.height * 2.6 + 14;
      camera.position.set(k.x + Math.sin(this.orbit) * r, st.height * 1.1 + 5, k.z + Math.cos(this.orbit) * r);
      setLens(camera, 60, Math.max(0.3, st.height * 0.05), 9000);
      camera.up.set(0, 1, 0);
      camera.lookAt(k.x, st.height * 0.45, k.z);
      return;
    }
    this.orbit = k.yaw + Math.PI;
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
      // Chase camera: behind and above, turning with the wanted heading a little lazily.
      this.chaseYaw = lerpAngle(this.chaseYaw, this.aimYaw, 1 - Math.exp(-ctx.dt * 9));
      const back = st.height * 2.3 + st.bodyRadius * 2;
      const up = st.height * 1.15;
      const cp = Math.cos(this.aimPitch * 0.6);
      camera.position.set(k.x - Math.sin(this.chaseYaw) * back * cp, up - Math.sin(this.aimPitch * 0.6) * back * 0.5, k.z - Math.cos(this.chaseYaw) * back * cp);
      camera.position.y = Math.max(st.height * 0.25, camera.position.y);
      const near = Math.max(0.3, st.height * 0.05);
      // A wall between the kaiju's shoulders and the camera: come in to this side of it.
      this.pivot.x = k.x;
      this.pivot.y = st.height * 0.85;
      this.pivot.z = k.z;
      this.clear = easeClearance(this.clear, clearOfWalls(ctx.session.mirror.query, this.pivot, camera.position, near * 2), ctx.dt);
      if (this.clear < 1) {
        camera.position.x = this.pivot.x + (camera.position.x - this.pivot.x) * this.clear;
        camera.position.y = this.pivot.y + (camera.position.y - this.pivot.y) * this.clear;
        camera.position.z = this.pivot.z + (camera.position.z - this.pivot.z) * this.clear;
      }
      setLens(camera, 60, near, 9000);
      camera.up.set(0, 1, 0);
      camera.lookAt(k.x + Math.sin(this.chaseYaw) * st.height * 1.5, st.height * 0.7, k.z + Math.cos(this.chaseYaw) * st.height * 1.5);
    }
  }
}
