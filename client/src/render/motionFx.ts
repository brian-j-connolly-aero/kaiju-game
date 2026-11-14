/**
 * The army's sense of speed in the picture (docs/ROADMAP.md phase 2: "the army gets a sense of
 * speed too"): dust kicked up behind every tank on the move (anyone sees it), and, for the
 * player's own unit near its top speed, a few faint streaks of air rushing past the camera. The
 * camera's own part (a wider lens with speed, the step bob, the tank camera lagging and leaning)
 * is the human controller's.
 */

import * as THREE from 'three';
import { unitTypeDef, type SnapUnit } from '@mb/shared';
import type { Effects } from './effects';
import { LineBatch } from './lineBatch';
import { memberOffset } from './unitsView';

/** A streak of rushing air: fixed in the world, so the camera passing it draws it past. */
interface Streak {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  t: number;
  life: number;
}

/** Tanks farther from the camera than this kick up no dust (it would not show). */
const DUST_RANGE = 450;
/** Speed (share of its top speed) at which a unit starts to leave dust, and at which the streaks begin and are full. */
const DUST_FROM = 0.3;
const STREAKS_FROM = 0.62;
const STREAKS_FULL = 0.95;
const MAX_STREAKS = 40;

const offset = { x: 0, z: 0 };

/** How strongly the speed streaks show for a unit going `speed` m/s with top speed `top` (0 to 1). */
export function streakStrength(speed: number, top: number): number {
  const u = (speed / Math.max(0.1, top) - STREAKS_FROM) / (STREAKS_FULL - STREAKS_FROM);
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

export class MotionFx {
  readonly lines = new LineBatch(MAX_STREAKS);
  private readonly dustTimer = new Map<number, number>();
  private readonly streaks: Streak[] = [];
  private streakTimer = 0;
  private seed = 99;

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  clear(): void {
    this.dustTimer.clear();
    this.streaks.length = 0;
  }

  /** Dust behind the moving tanks; streaks for the local unit `local` (null: none). */
  update(dt: number, units: readonly SnapUnit[], local: SnapUnit | null, camera: THREE.Camera, effects: Effects, fog: { near: number; far: number }): void {
    const cam = camera.position;
    for (const u of units) {
      if (!u.alive || u.y > 0) continue;
      const def = unitTypeDef(u.type);
      if (def.body !== 'vehicle') continue;
      const speed = Math.hypot(u.vx, u.vz);
      const share = speed / Math.max(0.1, def.speed);
      if (share < DUST_FROM || Math.hypot(u.x - cam.x, u.z - cam.z) > DUST_RANGE) continue;
      const left = (this.dustTimer.get(u.id) ?? 0) - dt;
      if (left > 0) {
        this.dustTimer.set(u.id, left);
        continue;
      }
      // Faster: more often and bigger. One member at a time, in turn.
      this.dustTimer.set(u.id, 0.22 - 0.1 * Math.min(1, share));
      const i = Math.floor(this.rand() * Math.max(1, u.members));
      memberOffset(def, u.id, i, u.members, offset);
      const c = Math.cos(u.yaw);
      const s = Math.sin(u.yaw);
      // Off one track or the other, a little behind the tank.
      const track = (this.rand() < 0.5 ? -1 : 1) * 1.4;
      const fx = u.vx / Math.max(0.1, speed);
      const fz = u.vz / Math.max(0.1, speed);
      const x = u.x + offset.x * c + offset.z * s - fx * 2.8 - fz * track;
      const z = u.z - offset.x * s + offset.z * c - fz * 2.8 + fx * track;
      effects.dust(x, 0.2, z, 0.6 + share * 0.7, 1, 0xd2c8b4);
    }
    this.updateStreaks(dt, local, camera);
    this.lines.setFog(fog.near, fog.far);
  }

  private updateStreaks(dt: number, local: SnapUnit | null, camera: THREE.Camera): void {
    this.lines.begin();
    const def = local ? unitTypeDef(local.type) : null;
    const speed = local ? Math.hypot(local.vx, local.vz) : 0;
    const strength = local && def && local.alive ? streakStrength(speed, def.speed) : 0;
    if (strength > 0 && local) {
      this.streakTimer -= dt;
      const dirX = local.vx / Math.max(0.1, speed);
      const dirZ = local.vz / Math.max(0.1, speed);
      while (this.streakTimer <= 0 && this.streaks.length < MAX_STREAKS) {
        this.streakTimer += 1 / (10 + 30 * strength);
        // Ahead of the camera along the way it goes, off to the sides and above: never on the crosshair.
        const ahead = 10 + this.rand() * 26;
        const side = (this.rand() < 0.5 ? -1 : 1) * (3 + this.rand() * 6);
        const cam = camera.position;
        this.streaks.push({
          x: cam.x + dirX * ahead - dirZ * side,
          y: Math.max(0.4, cam.y - 2.5 + this.rand() * 6),
          z: cam.z + dirZ * ahead + dirX * side,
          dx: dirX,
          dz: dirZ,
          len: speed * 0.09,
          t: 0,
          life: 0.35 + this.rand() * 0.2,
        });
      }
    } else {
      this.streakTimer = 0;
    }
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      s.t += dt;
      if (s.t >= s.life) {
        this.streaks[i] = this.streaks[this.streaks.length - 1];
        this.streaks.pop();
        i--;
        continue;
      }
      const u = s.t / s.life;
      const a = 0.22 * Math.sin(Math.PI * u) * Math.max(0.3, strength);
      this.lines.push(s.x, s.y, s.z, s.x - s.dx * s.len, s.y, s.z - s.dz * s.len, 0.05, 1, 1, 1, a);
    }
    this.lines.end();
  }
}
