/**
 * Civilians: tiny sprites that flee the kaiju (DESIGN.md section 7). They exist only on this
 * client, have no effect on play, and share the one sprite batch with the soldiers, so a crowd
 * costs nothing but the instances.
 */

import { circleHitsStructure, type Bounds, type CityQuery, type SnapKaiju } from '@mb/shared';
import type * as THREE from 'three';
import type { AssetStore } from '../assets/assetStore';
import { frameRect, type SpriteAnimInfo, type SpriteInfo } from '../assets/spriteAtlas';
import type { QuadBatch } from './quadBatch';

interface Civilian {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  sprite: SpriteInfo;
  /** Seconds until it picks a new stroll direction. */
  wander: number;
  panic: number;
}

const uv = [0, 0, 0, 0];

export class Crowd {
  private readonly people: Civilian[] = [];
  private readonly sprites: SpriteInfo[];
  private readonly batch: QuadBatch;
  private seed = 424242;
  private readonly size: number;

  constructor(assets: AssetStore, batch: QuadBatch, size = 260) {
    this.batch = batch;
    this.size = size;
    const ids = assets.civilianSprites();
    this.sprites = ids.map((id) => assets.sprite(id));
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  clear(): void {
    this.people.length = 0;
  }

  private spawn(city: CityQuery, bounds: Bounds, fx: number, fz: number, spread: number): Civilian | null {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rand() * 6.283;
      const d = spread * (0.25 + this.rand() * 0.75);
      const x = Math.min(bounds.maxX - 2, Math.max(bounds.minX + 2, fx + Math.cos(a) * d));
      const z = Math.min(bounds.maxZ - 2, Math.max(bounds.minZ + 2, fz + Math.sin(a) * d));
      if (circleHitsStructure(city, x, z, 1)) continue;
      const dir = this.rand() * 6.283;
      return {
        x,
        z,
        dirX: Math.cos(dir),
        dirZ: Math.sin(dir),
        sprite: this.sprites[Math.floor(this.rand() * this.sprites.length)],
        wander: this.rand() * 4,
        panic: 0,
      };
    }
    return null;
  }

  /**
   * Moves the crowd and draws it. `focusX, focusZ` is where the action is (people are kept
   * around it), `spread` how wide an area they fill, `fear` how far the kaiju frightens them.
   */
  update(dt: number, time: number, city: CityQuery, bounds: Bounds, kaijus: SnapKaiju[], focusX: number, focusZ: number, spread: number, fear: number, camera: THREE.Camera): void {
    if (this.sprites.length === 0) return;
    // Top the crowd up a few at a time.
    for (let i = 0; i < 6 && this.people.length < this.size; i++) {
      const c = this.spawn(city, bounds, focusX, focusZ, spread);
      if (c) this.people.push(c);
    }
    const people = this.people;
    for (let i = 0; i < people.length; i++) {
      const c = people[i];
      const far = Math.hypot(c.x - focusX, c.z - focusZ) > spread * 1.3;
      if (far) {
        const fresh = this.spawn(city, bounds, focusX, focusZ, spread);
        if (fresh) people[i] = fresh;
        continue;
      }
      // Run from the nearest kaiju inside the fear radius.
      let threatX = 0;
      let threatZ = 0;
      let threat = 0;
      for (const k of kaijus) {
        if (!k.alive || k.phase === 'cocoon') continue;
        const dx = c.x - k.x;
        const dz = c.z - k.z;
        const d = Math.hypot(dx, dz);
        if (d < fear && d > 0.01) {
          const w = 1 - d / fear;
          threatX += (dx / d) * w;
          threatZ += (dz / d) * w;
          threat = Math.max(threat, w);
        }
      }
      c.panic = threat > 0 ? Math.min(1, c.panic + dt * 4) : Math.max(0, c.panic - dt * 0.4);
      if (threat > 0) {
        const len = Math.hypot(threatX, threatZ) || 1;
        c.dirX += ((threatX / len) - c.dirX) * Math.min(1, dt * 5);
        c.dirZ += ((threatZ / len) - c.dirZ) * Math.min(1, dt * 5);
      } else {
        c.wander -= dt;
        if (c.wander <= 0) {
          const a = this.rand() * 6.283;
          c.dirX = Math.cos(a);
          c.dirZ = Math.sin(a);
          c.wander = 2 + this.rand() * 5;
        }
      }
      const speed = 1.2 + c.panic * 5.5;
      const nx = c.x + c.dirX * speed * dt;
      const nz = c.z + c.dirZ * speed * dt;
      const blocked = nx < bounds.minX + 1 || nx > bounds.maxX - 1 || nz < bounds.minZ + 1 || nz > bounds.maxZ - 1 || circleHitsStructure(city, nx, nz, 0.6);
      if (blocked) {
        // Turn along the wall instead of running on the spot.
        const turn = this.rand() < 0.5 ? 1 : -1;
        const dx = c.dirX;
        c.dirX = -c.dirZ * turn;
        c.dirZ = dx * turn;
      } else {
        c.x = nx;
        c.z = nz;
      }

      const sprite = c.sprite;
      const anim = (sprite.anims.get('run') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
      // Which side we see: the same rule as for soldiers.
      const fx = c.x - camera.position.x;
      const fz = c.z - camera.position.z;
      const len = Math.hypot(fx, fz) || 1;
      const toward = -(c.dirX * fx + c.dirZ * fz) / len;
      const facing = toward > 0.707 ? 0 : toward < -0.707 ? 2 : c.dirX * -fz + c.dirZ * fx > 0 ? 3 : 1;
      const frame = c.panic > 0.1 ? Math.floor((time + i * 0.37) * anim.fps) : Math.floor((time + i * 0.37) * 3);
      frameRect(anim, facing, frame, uv, 0);
      const h = sprite.worldHeight;
      this.batch.push(c.x, 0, c.z, h * sprite.aspect, h, uv, 0, 1, 1, 1, 1);
    }
  }
}
