/**
 * Short-lived effects: sparkler explosions, dust, smoke, shockwave rings and flashes
 * (ASSETS.md section 2: a model-city look). Everything is a particle in one of four sprite
 * batches, so any number of effects costs four draw calls. Which batch follows the sprite's
 * `blend` (docs/art/client-notes-sprites-textures.md note 2): the full-color pictures
 * (explosion, fire, flash) are alpha blended in `burst`, white ones (smoke, dust) in `smoke`,
 * and only white light (glow, sparks, the laser dot) is added, in `glow`, so nothing burns out
 * to a white blob against a bright sky.
 */

import * as THREE from 'three';
import type { AssetStore } from '../assets/assetStore';
import { frameRect, type SpriteAnimInfo } from '../assets/spriteAtlas';
import { QuadBatch } from './quadBatch';

type Layer = 'glow' | 'burst' | 'smoke' | 'ground';

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
/** A bright particle is drawn at most this many times its distance from the camera across. */
const NEAR_SIZE = 0.6;
/** The same for smoke and dust: they may come closer to filling the view, but never blank it. */
const NEAR_SMOKE = 1;
const scratch = new THREE.Color();
function rgb(color: number): [number, number, number] {
  scratch.set(color);
  return [scratch.r, scratch.g, scratch.b];
}

export class Effects {
  readonly group = new THREE.Group();
  readonly glow: QuadBatch;
  readonly burst: QuadBatch;
  readonly smoke: QuadBatch;
  readonly ground: QuadBatch;
  private readonly particles: Particle[] = [];
  private readonly anims: Record<string, SpriteAnimInfo>;
  /** Animations of the sprites drawn added; the rest are alpha blended. */
  private readonly addedAnims = new Set<SpriteAnimInfo>();
  private seed = 987654321;

  constructor(assets: AssetStore) {
    const atlas = assets.atlas;
    if (!atlas) throw new Error('effects need the sprite atlas');
    this.glow = new QuadBatch(atlas.texture, { mode: 'facing', capacity: MAX_PARTICLES, additive: true, renderOrder: 16 });
    this.burst = new QuadBatch(atlas.texture, { mode: 'facing', capacity: MAX_PARTICLES, renderOrder: 15 });
    this.smoke = new QuadBatch(atlas.texture, { mode: 'facing', capacity: MAX_PARTICLES, renderOrder: 14 });
    this.ground = new QuadBatch(atlas.texture, { mode: 'ground', capacity: 400, renderOrder: 4 });
    this.group.add(this.ground.mesh, this.smoke.mesh, this.burst.mesh, this.glow.mesh);
    const anim = (id: string): SpriteAnimInfo => {
      const sprite = assets.sprite(id);
      const a = (sprite.anims.get('play') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
      if (sprite.blend === 'add') this.addedAnims.add(a);
      return a;
    };
    const has = (id: string): boolean => atlas.sprites.has(id);
    this.anims = {
      explosion: anim('fx_explosion'),
      explosionGround: anim(has('fx_explosion_ground') ? 'fx_explosion_ground' : 'fx_explosion'),
      laserdot: anim('fx_laserdot'),
      smoke: anim('fx_smoke'),
      dust: anim('fx_dust'),
      fire: anim('fx_fire'),
      debris: anim('fx_debris'),
      // Small broken bits (glass, torn metal): the fourth debris picture when the art has it.
      bits: anim(has('fx_debris_4') ? 'fx_debris_4' : 'fx_debris'),
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
    // A procedural stand-in or an art file may say otherwise than the caller: the sprite's
    // blend wins (added light never goes into an alpha batch, nor a picture into the added one).
    if (layer !== 'ground') {
      const added = this.addedAnims.has(anim);
      if (added) layer = 'glow';
      else if (layer === 'glow') layer = 'burst';
    }
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

  /**
   * A sparkler burst: a glow underneath (the place for a tint), the full-color flash and
   * fireball over it, flying sparks, a ring on the ground and a little smoke. On the ground the
   * fireball is the one drawn standing on its bottom edge.
   */
  explosion(x: number, y: number, z: number, radius: number, color = 0xff8a1a): void {
    const r = Math.max(1.5, radius);
    const onGround = y < r * 1.5;
    this.spawn('glow', this.anims.glow, x, y, z, r * 4.0, 0.35, color, 0.6);
    this.spawn('burst', this.anims.flash, x, y, z, r * 3.2, 0.16, 0xffffff, 1);
    if (onGround) this.spawn('burst', this.anims.explosionGround, x, (r * 2.6) / 2, z, r * 2.6, 0.45, 0xffffff, 1).rot = 0;
    else this.spawn('burst', this.anims.explosion, x, y, z, r * 2.6, 0.45, 0xffffff, 1).rot = 0;
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
    if (onGround) this.ring(x, z, r * 2.4, 0xffe2a0, 0.45);
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

  /** A ring that spreads on the ground (or, flat, at height `y`) to `radius` over `life` seconds. */
  ring(x: number, z: number, radius: number, color = 0xffffff, life = 0.6, alpha = 0.9, y = 0.2): void {
    const p = this.spawn('ground', this.anims.ring, x, y, z, radius * 0.2, life, color, alpha);
    p.grow = (radius * 2 - radius * 0.2) / life;
    p.rot = 0;
  }

  /** A quick bright flash (muzzles): the full-color picture, untinted. */
  flash(x: number, y: number, z: number, size: number, color = 0xffffff, life = 0.09): void {
    this.spawn('burst', this.anims.flash, x, y, z, size, life, color, 1);
  }

  /** A soft tinted glow of light (the beam, hits): added, so it fades to nothing at its rim. */
  glowAt(x: number, y: number, z: number, size: number, color: number, life = 0.06, alpha = 1): void {
    this.spawn('glow', this.anims.glow, x, y, z, size, life, color, alpha);
  }

  /** The bright end of a targeting laser: a crisp dot with a thin cross flare. */
  laserDot(x: number, y: number, z: number, size: number, color: number, life = 0.03): void {
    this.spawn('glow', this.anims.laserdot, x, y, z, size, life, color, 1);
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

  /** Lingering fire on a wreck or ruin, standing on `y`. */
  fire(x: number, y: number, z: number, size: number): void {
    const p = this.spawn('burst', this.anims.fire, x, y + size / 2, z, size, 0.6, 0xffffff, 1);
    p.rot = 0;
    p.vy = size * 0.5;
  }

  // --- the city and the monster's weight (phase 2) ----------------------------------------------

  /**
   * A propane tank going off (docs/ROADMAP.md phase 2, "the city as a weapon"). One effect for
   * every way a tank goes off (thrown, shot where it stands, in the monster's hand, crushed), so
   * they all look alike: a white flash, a ball of flame that rolls upward, a ring of air on the
   * ground, sparks and torn metal flying, then black smoke. `radius` is the blast's (8 m; 3.5 m
   * for a crushed one).
   */
  propaneBlast(x: number, y: number, z: number, radius: number): void {
    const r = Math.max(2, radius);
    const base = Math.max(0, y);
    this.spawn('glow', this.anims.glow, x, base + r * 0.4, z, r * 5, 0.5, 0xffa040, 0.85);
    this.spawn('burst', this.anims.flash, x, base + r * 0.3, z, r * 2.6, 0.18, 0xffffff, 1);
    this.spawn('burst', this.anims.explosionGround, x, base + r * 0.75, z, r * 1.5, 0.55, 0xffffff, 1).rot = 0;
    // The ball of flame: a few fireballs that start together and roll up and out.
    for (let i = 0; i < 5; i++) {
      const a = this.rand() * 6.283;
      const out = r * (0.6 + this.rand() * 0.8);
      const p = this.spawn('burst', this.anims.explosion, x + Math.cos(a) * r * 0.15, base + r * (0.25 + this.rand() * 0.3), z + Math.sin(a) * r * 0.15, r * (0.7 + this.rand() * 0.45), 0.75 + this.rand() * 0.35, 0xffffff, 1);
      p.vx = Math.cos(a) * out;
      p.vz = Math.sin(a) * out;
      p.vy = r * (1.1 + this.rand() * 0.7);
      p.grow = r * 0.7;
      p.drag = 1.6;
      p.rot = 0;
    }
    for (let i = 0; i < 3; i++) this.fire(x + (this.rand() - 0.5) * r * 0.6, base, z + (this.rand() - 0.5) * r * 0.6, r * (0.45 + this.rand() * 0.3));
    this.sparks(x, base + r * 0.3, z, r, 10, 0xffd890);
    this.debris(x, base + r * 0.3, z, r * 0.9, 6, 0xd8d8d0, 0.35);
    for (let i = 0; i < 3; i++) {
      const p = this.spawn('smoke', this.anims.smoke, x + (this.rand() - 0.5) * r * 0.5, base + r * (0.8 + this.rand() * 0.6), z + (this.rand() - 0.5) * r * 0.5, r * 1.1, 2.2 + this.rand() * 1.2, 0x2e2a28, 0.75);
      p.vy = r * 0.55;
      p.grow = r * 0.8;
      p.drag = 0.3;
    }
    this.ring(x, z, r * 2.2, 0xffd9a0, 0.5, 0.85);
  }

  /** A puff of a smoke column: rises `rise` meters a second and spreads slowly (a fire's smoke). */
  plume(x: number, y: number, z: number, size: number, rise: number, color = 0x2a2624, life = 5, alpha = 0.7): void {
    const p = this.spawn('smoke', this.anims.smoke, x, y, z, size, life, color, alpha);
    p.vy = rise;
    p.grow = size * 0.35;
    p.vx = (this.rand() - 0.5) * size * 0.3;
    p.vz = (this.rand() - 0.5) * size * 0.3;
  }

  /**
   * Sparks that leap and fall (electricity, torn metal): `count` bright points thrown up and out
   * from (x, y, z) within `reach` meters, drawn added.
   */
  sparks(x: number, y: number, z: number, reach: number, count: number, color = 0xbfe4ff, life = 0.45): void {
    for (let i = 0; i < count; i++) {
      const a = this.rand() * 6.283;
      const speed = reach * (1.2 + this.rand() * 2.2);
      const p = this.spawn('glow', this.anims.spark, x, y, z, Math.max(0.25, reach * (0.06 + this.rand() * 0.07)), life * (0.6 + this.rand() * 0.8), color, 1);
      p.vx = Math.cos(a) * speed;
      p.vz = Math.sin(a) * speed;
      p.vy = speed * (0.2 + this.rand() * 0.9);
      p.gravity = reach * 7;
      p.drag = 0.8;
    }
  }

  /** Pieces thrown out of a blast or a fall: `count` tumbling bits of `size` meters (about), tinted `color`. */
  debris(x: number, y: number, z: number, reach: number, count: number, color = 0xb8b0a4, size = 0.5): void {
    for (let i = 0; i < count; i++) {
      const a = this.rand() * 6.283;
      const speed = reach * (0.8 + this.rand() * 1.6);
      const p = this.spawn('burst', this.anims.bits, x, y, z, size * (0.6 + this.rand() * 0.9), 0.9 + this.rand() * 0.6, color, 1);
      p.vx = Math.cos(a) * speed;
      p.vz = Math.sin(a) * speed;
      p.vy = speed * (0.6 + this.rand() * 0.8);
      p.gravity = 20;
      p.spin = (this.rand() - 0.5) * 14;
      p.animate = false;
    }
  }

  /**
   * Windows bursting out of a wall: glass bits that fly out along the wall's outward normal
   * (nx, nz) from (x, y, z), glint as they turn, and rain down. `size` is the spread (meters).
   */
  glass(x: number, y: number, z: number, nx: number, nz: number, size: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const out = size * (0.8 + this.rand() * 1.6);
      const side = (this.rand() - 0.5) * size * 1.6;
      const p = this.spawn('burst', this.anims.bits, x - nz * side * 0.4, y + (this.rand() - 0.5) * size * 0.6, z + nx * side * 0.4, Math.max(0.2, size * (0.08 + this.rand() * 0.1)), 1.1 + this.rand() * 0.7, 0xd8f0ff, 0.95);
      p.vx = nx * out - nz * side;
      p.vz = nz * out + nx * side;
      p.vy = out * (0.2 + this.rand() * 0.5);
      p.gravity = 22;
      p.spin = (this.rand() - 0.5) * 18;
      p.animate = false;
      if (i % 3 === 0) {
        // A glint where the light catches a falling pane.
        const g = this.spawn('glow', this.anims.spark, p.x, p.y, p.z, p.size * 1.6, 0.35 + this.rand() * 0.3, 0xe8f6ff, 0.9);
        g.vx = p.vx;
        g.vz = p.vz;
        g.vy = p.vy;
        g.gravity = 22;
      }
    }
  }

  // --- the monster's looks (phase 3) -----------------------------------------------------------

  /**
   * A cartoon puff (docs/ROADMAP.md phase 3: a civilian squashed or gulped): a round white cloud
   * that pops out and is gone, a few little stars thrown up, a faint ring on the ground. Nothing
   * else is left behind: no bodies, nothing gory. `size` is about the puff's width (meters).
   */
  cartoonPuff(x: number, y: number, z: number, size: number): void {
    const s = Math.max(0.4, size);
    for (let i = 0; i < 3; i++) {
      const a = this.rand() * 6.283;
      const p = this.spawn('smoke', this.anims.smoke, x + Math.cos(a) * s * 0.2, y + s * (0.35 + this.rand() * 0.2), z + Math.sin(a) * s * 0.2, s * 0.65, 0.42 + this.rand() * 0.18, 0xffffff, 0.95);
      p.vx = Math.cos(a) * s * 1.4;
      p.vz = Math.sin(a) * s * 1.4;
      p.vy = s * 0.9;
      p.grow = s * 2.4;
      p.drag = 4;
    }
    for (let i = 0; i < 3; i++) {
      const a = this.rand() * 6.283;
      const p = this.spawn('glow', this.anims.spark, x, y + s * 0.5, z, s * (0.28 + this.rand() * 0.12), 0.45 + this.rand() * 0.2, 0xfff1a8, 1);
      p.vx = Math.cos(a) * s * 2.2;
      p.vz = Math.sin(a) * s * 2.2;
      p.vy = s * (2.2 + this.rand() * 1.2);
      p.gravity = s * 9;
      p.drag = 1.2;
    }
    // (A ring on the ground only for a puff on the ground: not under a gulp at the mouth.)
    if (y < s) this.ring(x, z, s * 0.9, 0xffffff, 0.3, 0.55);
  }

  /**
   * A blow of a monster in a power surge landing (docs/ROADMAP.md round 4: "its hits flash
   * electric"): a blue-white flash and glow, a spray of sparks and a crackling ring. `size` is
   * about the hit's width (meters).
   */
  electricHit(x: number, y: number, z: number, size: number): void {
    const s = Math.max(1, size);
    this.spawn('glow', this.anims.glow, x, y, z, s * 3.2, 0.22, 0x9cc8ff, 0.95);
    this.spawn('burst', this.anims.flash, x, y, z, s * 1.6, 0.1, 0xdfeaff, 1);
    this.sparks(x, y, z, s * 0.9, 9, 0xd8ecff, 0.4);
    this.ring(x, z, s * 1.4, 0xbcd8ff, 0.3, 0.85, Math.max(0.2, y * 0.2));
  }

  get count(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles.length = 0;
  }

  /**
   * Moves and draws every particle. With a camera, a bright particle (fireball, flash, glow) is
   * never drawn wider than 0.6 of its distance from the camera, a third of the view at most,
   * and smoke or dust no wider than its distance: a shell bursting on the kaiju's own snout, or
   * right beside a tank, must not blank the screen (and a full-screen blended quad is the most
   * expensive thing a weak graphics chip draws).
   */
  update(dt: number, camera?: THREE.Camera): void {
    const list = this.particles;
    const cam = camera?.position;
    this.glow.begin();
    this.burst.begin();
    this.smoke.begin();
    this.ground.begin();
    const uv = [0, 0, 0, 0];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      // Every particle is drawn at least once, however long the frame (a glow that is
      // spawned every frame for a frame's length must not vanish at a low frame rate).
      const fresh = p.age === 0;
      p.age += dt;
      if (p.age >= p.life && !fresh) {
        list[i] = list[list.length - 1];
        list.pop();
        i--;
        continue;
      }
      const t = Math.min(fresh ? 0.4 : 1, p.age / p.life);
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
      const batch = p.layer === 'glow' ? this.glow : p.layer === 'burst' ? this.burst : p.layer === 'smoke' ? this.smoke : this.ground;
      let size = p.size;
      if (cam && p.layer !== 'ground') size = Math.min(size, Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) * (p.layer === 'smoke' ? NEAR_SMOKE : NEAR_SIZE));
      batch.push(p.x, p.y, p.z, size, size, uv, 0, p.r, p.g, p.b, fade, p.rot);
    }
    this.glow.end();
    this.burst.end();
    this.smoke.end();
    this.ground.end();
  }
}
