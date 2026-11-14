/** What every local player controller shares. */

import type * as THREE from 'three';
import type { CommandId, GroundMarker, SnapSquad } from '@mb/shared';
import type { FrameState, MatchSession } from '../../net/matchSession';
import type { GameRenderer } from '../../render/gameRenderer';
import type { ActionState } from '../input/actions';

export interface ControlContext {
  session: MatchSession;
  renderer: GameRenderer;
  input: ActionState;
  frame: FrameState;
  dt: number;
  /** Local time, seconds. */
  now: number;
  /** The map or the settings panel is open: the view does not turn and the body idles. */
  mapOpen: boolean;
}

/**
 * Whether a squad has nothing left to drive (so its player flies the news drone until the next
 * stage). A dead leader alone does not count: the simulation puts the player in a surviving unit
 * on the next tick, and for the snapshot in between the view should stay where it is.
 */
export function squadIsOut(squads: readonly SnapSquad[], squadId: number): boolean {
  const squad = squads[squadId];
  return !squad || squad.eliminated || squad.driven < 0;
}

/** One input sample, before the session stamps its sequence number. */
export interface InputSample {
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  buttons: number;
  wheel?: CommandId;
  marker?: GroundMarker;
}

export interface Controller {
  readonly kind: 'kaiju' | 'human' | 'drone';
  thirdPerson: boolean;
  /** Once per frame, before the renderer poses anything: turns the view, reads toggles. */
  update(ctx: ControlContext): void;
  /** 30 times a second: what to send to the server (null: this controller sends nothing). */
  sample(ctx: ControlContext): InputSample | null;
  /** Once per frame, after the renderer has posed the rigs: places the camera. */
  applyCamera(ctx: ControlContext, camera: THREE.PerspectiveCamera): void;
}

/** Points a camera along a heading and elevation (yaw 0 faces +Z, positive pitch looks up). */
export function aimCamera(camera: THREE.PerspectiveCamera, yaw: number, pitch: number): void {
  const cp = Math.cos(pitch);
  camera.up.set(0, 1, 0);
  camera.lookAt(camera.position.x + Math.sin(yaw) * cp, camera.position.y + Math.sin(pitch), camera.position.z + Math.cos(yaw) * cp);
}

/** Sets the camera's lens; only touches the projection when something changed. */
export function setLens(camera: THREE.PerspectiveCamera, fov: number, near: number, far: number): void {
  if (camera.fov !== fov || camera.near !== near || camera.far !== far) {
    camera.fov = fov;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** A decaying camera shake: `add` kicks it, `apply` nudges the camera after it has been placed. */
export class CameraShake {
  private amount = 0;
  private phase = 0;

  add(strength: number): void {
    this.amount = Math.min(1.5, this.amount + strength);
  }

  /** Stops the shake at once (the moment that caused it is long past). */
  reset(): void {
    this.amount = 0;
  }

  apply(camera: THREE.PerspectiveCamera, dt: number, scale: number): void {
    if (this.amount < 0.002) {
      this.amount = 0;
      return;
    }
    this.phase += dt * 55;
    const a = this.amount * this.amount;
    camera.position.x += Math.sin(this.phase * 1.3) * a * scale;
    camera.position.y += Math.sin(this.phase * 1.7 + 1) * a * scale;
    camera.rotation.z += Math.sin(this.phase) * a * 0.03;
    this.amount *= Math.exp(-dt * 6);
  }
}
