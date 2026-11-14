/** What every local player controller shares. */

import type * as THREE from 'three';
import type { SnapSquad } from '@mb/shared';
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
  /** Kaiju: the molt card picked since the last sample, 1 to 3 (net/input.ts: one-shot). */
  card?: number;
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

/** How fast a thump's spring rings (radians a second: about 4 swings a second) and how soon it settles (a third of a second). */
const THUMP_RATE = 24;
const THUMP_DAMPING = 0.45;
/** How far the view dips (radians) per unit of a thump's drop: the picture nods with the weight. */
const THUMP_NOD = 0.02;

/**
 * A decaying camera shake: `add` kicks a rattle (explosions, hits), `thump` a drop that springs
 * back (the monster's weight: a footfall, a landing), and `apply` nudges the camera after it has
 * been placed. Both move the camera, never where it points, beyond a nod of a fraction of a
 * degree: aiming stays possible through them.
 */
export class CameraShake {
  private amount = 0;
  private phase = 0;
  /** The thump's spring: how far the view has dropped (units of `scale`) and how fast it moves. */
  private drop = 0;
  private dropSpeed = 0;

  add(strength: number): void {
    this.amount = Math.min(1.5, this.amount + strength);
  }

  /** A weight landing: the view drops about `amount` (units of the `scale` given to `apply`) and springs back. */
  thump(amount: number): void {
    if (!(amount > 0)) return;
    // A kick of the spring's speed that peaks near `amount` below rest.
    this.dropSpeed = Math.max(-THUMP_RATE * 3, this.dropSpeed - Math.min(1.5, amount) * THUMP_RATE * 1.45);
  }

  /** How far the view is dropped by a thump right now (tests). */
  get thumped(): number {
    return this.drop;
  }

  /** Stops the shake at once (the moment that caused it is long past). */
  reset(): void {
    this.amount = 0;
    this.drop = 0;
    this.dropSpeed = 0;
  }

  apply(camera: THREE.PerspectiveCamera, dt: number, scale: number): void {
    this.applyThump(camera, dt, scale);
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

  private applyThump(camera: THREE.PerspectiveCamera, dt: number, scale: number): void {
    if (this.drop === 0 && this.dropSpeed === 0) return;
    // A damped spring, in small steps so a slow frame cannot blow it up.
    const steps = Math.min(30, Math.ceil(dt / 0.008));
    const h = dt / Math.max(1, steps);
    for (let i = 0; i < steps; i++) {
      const pull = -THUMP_RATE * THUMP_RATE * this.drop - 2 * THUMP_DAMPING * THUMP_RATE * this.dropSpeed;
      this.dropSpeed += pull * h;
      this.drop += this.dropSpeed * h;
    }
    if (Math.abs(this.drop) < 1e-4 && Math.abs(this.dropSpeed) < 1e-3) {
      this.drop = 0;
      this.dropSpeed = 0;
      return;
    }
    camera.position.y += this.drop * scale;
    camera.rotateX(this.drop * THUMP_NOD);
  }
}
