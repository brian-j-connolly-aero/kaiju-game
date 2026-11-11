/**
 * Short-lived effects: sparkler explosions, dust, smoke, shockwave rings and flashes
 * (ASSETS.md section 2: a model-city look). Everything is a particle in one of three sprite
 * batches (added glow, ordinary smoke, flat on the ground), so any number of effects costs
 * three draw calls.
 */

import * as THREE from 'three';
import type { AssetStore } from '../assets/assetStore';
import { frameRect, type SpriteAnimInfo } from '../assets/spriteAtlas';
import { QuadBatch } from './quadBatch';

type Layer = 'glow' | 'smoke' | 'ground';

interface Particle {
  layer: Layer;
  anim: SpriteAnimInfo;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  size: number;
  grow: number;
  rot: number;
  spin: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  age: number;
  life: number;
  /** Play the animation's frames once over the particle's life (else frame 0). */
  animate: boolean;
}

/** A hard cap: blended particles are the most expensive thing on screen for a weak GPU. */
const MAX_PARTICLES = 520;
const scratch = new THREE.Color();

function rgb(color: number): [number, number, number] {
  scratch.set(color);
  return [scratch.r, scratch.g, scratch.b];
}

export class Effects {
  readonly group = new THREE.Group();
  readonly glow: QuadBatch;
  readonly smoke: QuadBatch;
  readonly ground: QuadBatch;
  private readonly particles: Particle[] = [];
  private readonly anims: Record<string, SpriteAnimInfo>;
  private seed = 987654321;

  constructor(assets: AssetStore) {
    const atlas = assets.atlas;
    if (!atlas) throw new Error('effects need the sprite atlas');
    this.glow = new QuadBatch(atlas.texture, { mode: 'facing', capacity: MAX_PARTICLES, additive: true, renderOrder: 16 });
    this.smoke = new QuadBatch(atlas.texture, { mode: 'facing', capacity: MAX_PARTICLES, renderOrder: 14 });
    this.ground = new QuadBatch(atlas.texture, { mode: 'ground', capacity: 400, renderOrder: 4 });
    this.group.add(this.ground.mesh, this.smoke.mesh, this.glow.mesh);
    const anim = (id: string): SpriteAnimInfo => {
      const sprite = assets.sprite(id);
      return (sprite.anims.get('play') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
    };
    this.anims = {
      explosion: anim('fx_explosion'),
      smoke: anim('fx_smoke'),
      dust: anim('fx_dust'),
      fire: anim('fx_fire'),
      debris: anim('fx_debris'),
      flash: anim('fx_flash'),
      spark: anim('fx_spark'),
      glow: anim('fx_glow'),
      ring: anim('fx_ring'),
      shadow: anim('fx_shadow'),
    };
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private spawn(layer: Layer, anim: SpriteAnimInfo, x: number, y: number, z: number, size: number, life: number, color: number, alpha: number): Particle {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const [r, g, b] = rgb(color);
    const p: Particle = {
      layer,
      anim,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      drag: 0,
      size,
      grow: 0,
      rot: this.rand() * 6.28,
      spin: 0,
      r,
      g,
      b,
      alpha,
      age: 0,
      life,
      animate: anim.frames > 1,
    };
    this.particles.push(p);
    return p;
  }

  /** A sparkler burst: flash, flying sparks, a ring on the ground and a little smoke. */
  explosion(x: number, y: number, z: number, radius: number, color = 0xffd27a): void {
    const r = Math.max(1.5, radius);
    this.spawn('glow', this.anims.flash, x, y, z, r * 3.2, 0.16, 0xfff4d0, 1);
    this.spawn('glow', this.anims.explosion, x, y, z, r * 2.6, 0.45, color, 1).rot = 0;
    const sparks = Math.min(12, 5 + Math.round(r));
    for (let i = 0; i < sparks; i++) {
      const a = this.rand() * 6.283;
      const up = 0.3 + this.rand() * 0.9;
      const speed = r * (2.5 + this.rand() * 3.5);
      const p = this.spawn('glow', this.anims.spark, x, y, z, r * (0.22 + this.rand() * 0.2), 0.5 + this.rand() * 0.5, 0xffe9a8, 1);
      p.vx = Math.cos(a) * speed;
      p.vz = Math.sin(a) * speed;
      p.vy = up * speed;
      p.gravity = 9.8 * Math.max(1, r * 0.4);
      p.drag = 0.6;
    }
    for (let i = 0; i < 2; i++) {
      const p = this.spawn('smoke', this.anims.smoke, x + (this.rand() - 0.5) * r, y + this.rand() * r * 0.5, z + (this.rand() - 0.5) * r, r * 1.4, 1.4 + this.rand(), 0x4a4640, 0.7);
      p.vy = r * 0.6;
      p.grow = r * 0.9;
    }
    if (y < r * 1.5) this.ring(x, z, r * 2.4, 0xffe2a0, 0.45);
  }

  /** Billowing dust, for collapses, stomps and footsteps. */
  dust(x: number, y: number, z: number, radius: number, amount = 8, color = 0xcfc6b4): void {
    for (let i = 0; i < amount; i++) {
      const a = this.rand() * 6.283;
      const d = this.rand() * radius;
      const p = this.spawn('smoke', this.anims.dust, x + Math.cos(a) * d, y + this.rand() * radius * 0.3, z + Math.sin(a) * d, radius * (0.5 + this.rand() * 0.5), 1.2 + this.rand() * 1.2, color, 0.75);
      p.vx = Math.cos(a) * radius * 0.5;
      p.vz = Math.sin(a) * radius * 0.5;
      p.vy = radius * (0.15 + this.rand() * 0.3);
      p.grow = radius * 0.5;
      p.drag = 1.2;
    }
  }

  /** A ring that spreads on the ground to `radius` over `life` seconds. */
  ring(x: number, z: number, radius: number, color = 0xffffff, life = 0.6, alpha = 0.9): void {
    const p = this.spawn('ground', this.anims.ring, x, 0.2, z, radius * 0.2, life, color, alpha);
    p.grow = (radius * 2 - radius * 0.2) / life;
    p.rot = 0;
  }

  /** A quick bright flash (muzzles, hits). */
  flash(x: number, y: number, z: number, size: number, color = 0xffe9a8, life = 0.09): void {
    this.spawn('glow', this.anims.flash, x, y, z, size, life, color, 1);
  }

  /** One puff of smoke (trails). */
  puff(x: number, y: number, z: number, size: number, color = 0xd8d8d8, life = 0.7, alpha = 0.5): void {
    const p = this.spawn('smoke', this.anims.smoke, x, y, z, size, life, color, alpha);
    p.grow = size * 1.2;
    p.vy = size * 0.4;
  }

  /** A column of water. */
  splash(x: number, z: number, radius: number): void {
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * 6.283;
      const p = this.spawn('smoke', this.anims.dust, x, 0.3, z, radius * 0.6, 0.9, 0xcfe8ff, 0.8);
      p.vx = Math.cos(a) * radius;
      p.vz = Math.sin(a) * radius;
      p.vy = radius * (2 + this.rand() * 2);
      p.gravity = radius * 5;
    }
    this.ring(x, z, radius * 2, 0xdff1ff, 0.8);
  }

  /** Lingering fire on a wreck or ruin. */
  fire(x: number, y: number, z: number, size: number): void {
    const p = this.spawn('glow', this.anims.fire, x, y, z, size, 0.6, 0xffffff, 0.9);
    p.rot = 0;
    p.vy = size * 0.5;
  }

  get count(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles.length = 0;
  }

  update(dt: number): void {
    const list = this.particles;
    this.glow.begin();
    this.smoke.begin();
    this.ground.begin();
    const uv = [0, 0, 0, 0];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) {
        list[i] = list[list.length - 1];
        list.pop();
        i--;
        continue;
      }
      const t = p.age / p.life;
      if (p.drag > 0) {
        const keep = Math.exp(-p.drag * dt);
        p.vx *= keep;
        p.vz *= keep;
        p.vy *= keep;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.layer !== 'ground' && p.y < 0.05) {
        p.y = 0.05;
        p.vy = 0;
      }
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
      frameRect(p.anim, 0, p.animate ? Math.min(p.anim.frames - 1, Math.floor(t * p.anim.frames)) : 0, uv, 0);
      // Fade out over the last 60% of the life.
      const fade = p.alpha * (t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6);
      const batch = p.layer === 'glow' ? this.glow : p.layer === 'smoke' ? this.smoke : this.ground;
      batch.push(p.x, p.y, p.z, p.size, p.size, uv, 0, p.r, p.g, p.b, fade, p.rot);
    }
    this.glow.end();
    this.smoke.end();
    this.ground.end();
  }
}
