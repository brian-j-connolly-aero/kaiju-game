/**
 * Civilians: tiny sprites that flee the kaiju (DESIGN.md section 7). They exist only on this
 * client, have no effect on play, and share the one sprite batch with the soldiers, so a crowd
 * costs nothing but the instances.
 *
 * Phase 3 (docs/ROADMAP.md: "the monster can squash and eat civilians, a puff, no gore"): they
 * come in little groups, often ahead of where the monster is walking, and some freeze in fright
 * before they run, so a hatchling meets them in its own streets. Whatever comes down on them (a
 * footstep, a stomp, a charge, the tail's sweep) squashes them, and a grab that closes on
 * nothing the rules can take comes up with a handful of them, which the monster lifts to its
 * mouth and gulps down (its view poses the arm: render/kaijuView.ts). Either way they vanish in
 * a cartoon puff: no bodies, nothing gory.
 */

import { circleHitsStructure, type Bounds, type CityQuery, type SnapKaiju } from '@mb/shared';
import type * as THREE from 'three';
import type { AssetStore } from '../assets/assetStore';
import { frameRect, type SpriteAnimInfo, type SpriteInfo } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { SNACK_GULP } from './kaijuAnimator';
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
  /** How fast this one runs, against the crowd's usual (0.8 to 1.2). */
  pace: number;
  /** Seconds it still stands frozen in fright (0: running or strolling). */
  frozen: number;
}

/** A handful of civilians in a monster's hand, on the way to its mouth. */
interface Handful {
  /** Which kaiju (its index) holds them. */
  owner: number;
  sprites: SpriteInfo[];
  /** Where each sits in the claw, across and up (body heights). */
  offsets: number[];
  time: number;
}

/** What the crowd needs of a kaiju view to draw a handful (render/kaijuView.ts). */
export interface HandView {
  hand: THREE.Vector3;
  mouth: THREE.Vector3;
  hasHand: boolean;
  /** Seconds since the hand closed on them (null: they are gone). */
  snack: number | null;
  /** Seen from inside its own head: what is in the hand is shrunk out of the lens. */
  firstPerson: boolean;
}

const uv = [0, 0, 0, 0];
/** Panicked running speed (meters a second, before each one's own pace), and strolling. */
const RUN = 4.4;
const STROLL = 1.2;
/** The share that freeze in fright for a moment when the monster first comes near. */
const FREEZE_CHANCE = 0.35;
/** The share of new arrivals put ahead of a monster on the move (where it is walking to). */
const AHEAD_SHARE = 0.45;
/** At most this many puffs for one squash (a stomp in a dense crowd); the rest go with them. */
const MAX_PUFFS = 6;

export class Crowd {
  private readonly people: Civilian[] = [];
  private readonly handfuls: Handful[] = [];
  private readonly sprites: SpriteInfo[];
  private readonly batch: QuadBatch;
  private seed = 424242;
  private readonly size: number;
  /** How many have been squashed and eaten (for the debug hooks and playtests). */
  readonly tally = { squashed: 0, eaten: 0 };

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

  /** How many stand in the streets right now (not counting those in a hand). */
  get count(): number {
    return this.people.length;
  }

  clear(): void {
    this.people.length = 0;
    this.handfuls.length = 0;
  }

  private spawnAt(city: CityQuery, bounds: Bounds, cx: number, cz: number, spread: number, inner: number): Civilian | null {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rand() * 6.283;
      const d = spread * (inner + this.rand() * (1 - inner));
      const x = Math.min(bounds.maxX - 2, Math.max(bounds.minX + 2, cx + Math.cos(a) * d));
      const z = Math.min(bounds.maxZ - 2, Math.max(bounds.minZ + 2, cz + Math.sin(a) * d));
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
        pace: 0.8 + this.rand() * 0.4,
        frozen: 0,
      };
    }
    return null;
  }

  /**
   * A little group arriving: around the focus, or (a monster on the move) ahead of it, where it
   * is going. Returns how many were added.
   */
  private arrive(city: CityQuery, bounds: Bounds, fx: number, fz: number, spread: number, fear: number, aheadX: number, aheadZ: number): number {
    let cx = fx;
    let cz = fz;
    let around = spread;
    let inner = 0.25;
    const moving = Math.hypot(aheadX, aheadZ);
    if (moving > 0.5 && this.rand() < AHEAD_SHARE) {
      const d = fear * (0.5 + this.rand() * 1.1);
      cx = fx + (aheadX / moving) * d;
      cz = fz + (aheadZ / moving) * d;
      around = Math.max(6, fear * 0.35);
      inner = 0;
    }
    const group = 2 + Math.floor(this.rand() * 4);
    let added = 0;
    const first = this.spawnAt(city, bounds, cx, cz, around, inner);
    if (!first) return 0;
    this.people.push(first);
    added++;
    for (let i = 1; i < group && this.people.length < this.size; i++) {
      const c = this.spawnAt(city, bounds, first.x, first.z, 4, 0.2);
      if (!c) continue;
      c.dirX = first.dirX;
      c.dirZ = first.dirZ;
      this.people.push(c);
      added++;
    }
    return added;
  }

  /**
   * Moves the crowd and draws it. `focusX, focusZ` is where the action is (people are kept
   * around it), `spread` how wide an area they fill, `fear` how far the kaiju frightens them;
   * `aheadX, aheadZ` the way the monster at the focus is walking (meters a second; 0 for none),
   * so that some arrive in its path.
   */
  update(
    dt: number,
    time: number,
    city: CityQuery,
    bounds: Bounds,
    kaijus: SnapKaiju[],
    focusX: number,
    focusZ: number,
    spread: number,
    fear: number,
    camera: THREE.Camera,
    aheadX = 0,
    aheadZ = 0,
  ): void {
    if (this.sprites.length === 0) return;
    // Top the crowd up a group at a time.
    for (let i = 0; i < 3 && this.people.length < this.size; i++) this.arrive(city, bounds, focusX, focusZ, spread, fear, aheadX, aheadZ);
    const people = this.people;
    for (let i = 0; i < people.length; i++) {
      const c = people[i];
      const far = Math.hypot(c.x - focusX, c.z - focusZ) > spread * 1.3;
      if (far) {
        const fresh = this.spawnAt(city, bounds, focusX, focusZ, spread, 0.25);
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
      // The first fright: some freeze for a moment (arms up, staring) before they run.
      if (threat > 0 && c.panic < 0.05 && c.frozen <= 0 && this.rand() < FREEZE_CHANCE) c.frozen = 0.5 + this.rand() * 1.1;
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
      if (c.frozen > 0) {
        c.frozen -= dt;
      } else {
        const speed = (STROLL + c.panic * RUN) * c.pace;
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
      }

      const sprite = c.sprite;
      const anim = (sprite.anims.get('run') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
      // Which side we see: the same rule as for soldiers. Frozen in fright, they face the monster.
      const fx = c.x - camera.position.x;
      const fz = c.z - camera.position.z;
      const len = Math.hypot(fx, fz) || 1;
      const dirX = c.frozen > 0 ? -c.dirX : c.dirX;
      const dirZ = c.frozen > 0 ? -c.dirZ : c.dirZ;
      const toward = -(dirX * fx + dirZ * fz) / len;
      const facing = toward > 0.707 ? 0 : toward < -0.707 ? 2 : dirX * -fz + dirZ * fx > 0 ? 3 : 1;
      const frame = c.frozen > 0 ? Math.floor((time + i * 0.37) * 14) % 2 : c.panic > 0.1 ? Math.floor((time + i * 0.37) * anim.fps) : Math.floor((time + i * 0.37) * 3);
      frameRect(anim, facing, frame, uv, 0);
      const h = sprite.worldHeight;
      this.batch.push(c.x, 0, c.z, h * sprite.aspect, h, uv, 0, 1, 1, 1, 1);
    }
  }

  /**
   * Squashes everyone within `radius` of (x, z) (a foot, a stomp, a charging body): each vanishes
   * in a cartoon puff. Returns how many.
   */
  squash(x: number, z: number, radius: number, effects: Effects): number {
    return this.squashWhere(effects, (c) => (c.x - x) ** 2 + (c.z - z) ** 2 <= radius * radius);
  }

  /**
   * Squashes everyone in an arc round (x, z): within `reach`, and within `halfArc` radians of the
   * direction `yaw` (yaw 0 is +z). The tail sweep's rear half.
   */
  squashArc(x: number, z: number, yaw: number, reach: number, halfArc: number, effects: Effects): number {
    const ax = Math.sin(yaw);
    const az = Math.cos(yaw);
    const cos = Math.cos(halfArc);
    return this.squashWhere(effects, (c) => {
      const dx = c.x - x;
      const dz = c.z - z;
      const d = Math.hypot(dx, dz);
      return d <= reach && (d < 0.5 || (dx * ax + dz * az) / d >= cos);
    });
  }

  private squashWhere(effects: Effects, hit: (c: Civilian) => boolean): number {
    let n = 0;
    const people = this.people;
    for (let i = 0; i < people.length; i++) {
      const c = people[i];
      if (!hit(c)) continue;
      if (n < MAX_PUFFS) effects.cartoonPuff(c.x, 0, c.z, c.sprite.worldHeight * 0.75);
      people[i] = people[people.length - 1];
      people.pop();
      i--;
      n++;
    }
    this.tally.squashed += n;
    return n;
  }

  /**
   * A grab that closed on nothing the rules can take: the nearest civilians within its reach
   * (`reach` meters of (x, z), within `halfArc` of `yaw`), up to `max`, come up in the hand of
   * kaiju `owner`. Returns how many (0: nobody there, the hand stays empty).
   */
  takeHandful(owner: number, x: number, z: number, yaw: number, reach: number, halfArc: number, max: number): number {
    const ax = Math.sin(yaw);
    const az = Math.cos(yaw);
    const cos = Math.cos(halfArc);
    const near: Array<{ i: number; d: number }> = [];
    this.people.forEach((c, i) => {
      const dx = c.x - x;
      const dz = c.z - z;
      const d = Math.hypot(dx, dz);
      if (d <= reach && (d < 0.5 || (dx * ax + dz * az) / d >= cos)) near.push({ i, d });
    });
    if (near.length === 0) return 0;
    near.sort((a, b) => a.d - b.d);
    const taken = near.slice(0, Math.max(1, max)).map((n) => n.i).sort((a, b) => b - a);
    const sprites: SpriteInfo[] = [];
    const offsets: number[] = [];
    for (const i of taken) {
      sprites.push(this.people[i].sprite);
      this.people[i] = this.people[this.people.length - 1];
      this.people.pop();
      // Bunched in the claw, overlapping, a little up and down.
      offsets.push((sprites.length - 1 - (taken.length - 1) / 2) * 0.17, (this.rand() - 0.5) * 0.3);
    }
    this.handfuls.push({ owner, sprites, offsets, time: 0 });
    return sprites.length;
  }

  /** Whether kaiju `owner` has a handful on the way to its mouth. */
  holding(owner: number): boolean {
    return this.handfuls.some((h) => h.owner === owner);
  }

  /**
   * Draws the handfuls in the monsters' hands (`view(owner)`: its hand and mouth this frame) and
   * gulps each down when its view's snack reaches the gulp: a puff at the mouth, then
   * `onGulp(x, y, z, count)`. `height(owner)` is that kaiju's body height.
   */
  updateHandfuls(dt: number, time: number, camera: THREE.Camera, view: (owner: number) => HandView | null, height: (owner: number) => number, effects: Effects, onGulp?: (x: number, y: number, z: number, count: number) => void): void {
    for (let i = 0; i < this.handfuls.length; i++) {
      const hf = this.handfuls[i];
      hf.time += dt;
      const v = view(hf.owner);
      const h = height(hf.owner);
      const gulped = !v || v.snack === null || v.snack >= SNACK_GULP || hf.time > 3;
      if (gulped) {
        if (v) {
          effects.cartoonPuff(v.mouth.x, v.mouth.y, v.mouth.z, Math.max(1.2, h * 0.12));
          onGulp?.(v.mouth.x, v.mouth.y, v.mouth.z, hf.sprites.length);
        }
        this.tally.eaten += hf.sprites.length;
        this.handfuls[i] = this.handfuls[this.handfuls.length - 1];
        this.handfuls.pop();
        i--;
        continue;
      }
      if (!v.hasHand) continue;
      // In the claw, kicking (the panicked run, fast), facing whoever looks: a handful, not an
      // armful (at most 0.3 body heights tall, so smaller in a hatchling's claw than in the
      // street). Seen from inside the monster's own head they are shrunk as anything held is (to
      // 0.16 body heights in all) and sit up on the claw, where the eye can see them.
      const sprite0 = hf.sprites[0];
      const tall = sprite0.worldHeight;
      const scale = v.firstPerson ? Math.min(1, (0.16 * h) / Math.max(tall, hf.sprites.length * 0.35 * tall)) : Math.min(1, (0.3 * h) / tall);
      const perch = v.firstPerson ? 0.4 : 0;
      const rx = camera.matrixWorld.elements[0];
      const rz = camera.matrixWorld.elements[2];
      // Each one a little nearer the eye than the one before, so the bunch never flickers where they overlap.
      const nx = camera.matrixWorld.elements[8];
      const nz = camera.matrixWorld.elements[10];
      for (let j = 0; j < hf.sprites.length; j++) {
        const sprite = hf.sprites[j];
        const anim = (sprite.anims.get('run') ?? [...sprite.anims.values()][0]) as SpriteAnimInfo;
        frameRect(anim, 0, Math.floor((time + j * 0.21) * anim.fps * 1.6), uv, 0);
        const sh = sprite.worldHeight * scale;
        const across = hf.offsets[j * 2] * sh * 1.4;
        const up = hf.offsets[j * 2 + 1] * sh;
        const near = j * 0.06 * sh;
        this.batch.push(v.hand.x + rx * across + nx * near, v.hand.y + sh * (perch - 0.45) + up, v.hand.z + rz * across + nz * near, sh * sprite.aspect, sh, uv, 0, 1, 1, 1, 1);
      }
    }
  }
}
