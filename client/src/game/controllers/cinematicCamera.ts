/**
 * Cameras nobody steers: the slow orbit behind the menus, the fly-in of the briefing, the
 * pull-back of an intermission and the circling shot of the end screen.
 */

import type * as THREE from 'three';
import { setLens } from './types';

export interface OrbitShot {
  /** Point the camera circles and looks at. */
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  /** Radians per second. */
  speed: number;
}

export class CinematicCamera {
  private angle = 0.6;
  private readonly shot: OrbitShot = { x: 0, y: 0, z: 0, radius: 600, height: 300, speed: 0.03 };
  private started = false;

  /** Moves toward a shot; `ease` is how quickly (1/seconds), 0 jumps there. */
  aim(target: OrbitShot, dt: number, ease = 1.5): void {
    const s = this.shot;
    const k = !this.started || ease <= 0 ? 1 : 1 - Math.exp(-ease * dt);
    this.started = true;
    s.x += (target.x - s.x) * k;
    s.y += (target.y - s.y) * k;
    s.z += (target.z - s.z) * k;
    s.radius += (target.radius - s.radius) * k;
    s.height += (target.height - s.height) * k;
    s.speed = target.speed;
    this.angle += s.speed * dt;
  }

  /** Starts the next shot from this bearing (so a cut does not spin the world). */
  setAngle(angle: number): void {
    this.angle = angle;
  }

  /** Forgets the current shot: the next `aim` jumps straight to its target. */
  cut(): void {
    this.started = false;
  }

  apply(camera: THREE.PerspectiveCamera): void {
    const s = this.shot;
    camera.position.set(s.x + Math.sin(this.angle) * s.radius, Math.max(2, s.y + s.height), s.z + Math.cos(this.angle) * s.radius);
    setLens(camera, 55, Math.max(0.5, s.radius * 0.01), 9000);
    camera.up.set(0, 1, 0);
    camera.lookAt(s.x, s.y, s.z);
  }
}
