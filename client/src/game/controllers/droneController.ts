/**
 * A free-flying news drone camera: for players whose squad is gone until the next molt, and
 * for anyone watching a match they are not in (DESIGN.md section 5). It sends nothing.
 */

import type * as THREE from 'three';
import { clamp, DEG, wrapAngle, type Bounds } from '@mb/shared';
import { aimCamera, setLens, type ControlContext, type Controller, type InputSample } from './types';

const PITCH_LIMIT = 85 * DEG;

export class DroneController implements Controller {
  readonly kind = 'drone' as const;
  thirdPerson = false;
  x = 0;
  y = 60;
  z = 0;
  yaw = 0;
  pitch = -0.5;
  private placed = false;

  /** Puts the drone somewhere sensible: above and behind a point, looking at it. */
  place(x: number, z: number, height: number, yaw: number): void {
    this.x = x - Math.sin(yaw) * height * 1.6;
    this.z = z - Math.cos(yaw) * height * 1.6;
    this.y = height;
    this.yaw = yaw;
    this.pitch = -0.5;
    this.placed = true;
  }

  private keepInside(bounds: Bounds): void {
    const margin = 120;
    this.x = clamp(this.x, bounds.minX - margin, bounds.maxX + margin);
    this.z = clamp(this.z, bounds.minZ - margin, bounds.maxZ + margin);
    this.y = clamp(this.y, 3, 700);
  }

  update(ctx: ControlContext): void {
    const input = ctx.input;
    if (!this.placed) {
      const k = ctx.frame.kaijus[0];
      if (k) this.place(k.x, k.z, 40 + k.stage * 30, k.yaw);
      else this.placed = true;
    }
    if (input.aimOverride) {
      this.yaw = input.aimOverride.yaw;
      this.pitch = input.aimOverride.pitch;
    } else if (!ctx.mapOpen) {
      this.yaw = wrapAngle(this.yaw - input.lookX);
      this.pitch = clamp(this.pitch + input.lookY, -PITCH_LIMIT, PITCH_LIMIT);
    }
    // Faster the higher it flies, so it is nimble in the streets and quick across the city.
    const speed = (25 + this.y * 0.9) * ctx.dt;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.x += (s * input.moveZ - c * input.moveX) * speed;
    this.z += (c * input.moveZ + s * input.moveX) * speed;
    this.y += ((input.down.rise ? 1 : 0) - (input.down.sink ? 1 : 0)) * speed * 0.7;
    this.keepInside(ctx.frame.bounds);
  }

  sample(): InputSample | null {
    return null;
  }

  applyCamera(_ctx: ControlContext, camera: THREE.PerspectiveCamera): void {
    camera.position.set(this.x, this.y, this.z);
    setLens(camera, 62, 0.5, 9000);
    aimCamera(camera, this.yaw, this.pitch);
  }
}
