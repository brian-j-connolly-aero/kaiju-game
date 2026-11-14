/**
 * Army supply crates (docs/ROADMAP.md phase 2; the rules: DESIGN.md section 5, "Supply crates and
 * pick-ups"). The snapshot lists every crate coming down or on the ground (`FrameState.crates`);
 * the `crate` events say when one is taken or goes.
 *
 *   coming down   `prop_crate` hanging under `prop_parachute` (its lines meet at the crate's
 *                 `beacon`), swaying, a white smoke trail behind it, from 90 m straight down
 *   on the ground a beacon anyone sees from afar: a pulsing cyan column of light, a blinking
 *                 light on the lid and cyan smoke rising; the canopy collapses beside it
 *   always        a picture of what is inside floating over it (the pick-up icons `pk_*`, in a
 *                 dark badge with the humans' cyan ring), bigger the farther it is
 *   taken         a cyan flash, a ring and sparks, and its picture leaps up and fades
 *   gone          (the stage ended) a puff of smoke
 */

import * as THREE from 'three';
import { CRATE_RULES, PICKUP_IDS, TICK_RATE, type CrateEvent, type PickupKind, type SnapCrate } from '@mb/shared';
import type { AssetStore } from '../assets/assetStore';
import { iconImage, pickupIcon } from '../assets/iconRaster';
import { frameRect } from '../assets/spriteAtlas';
import type { Effects } from './effects';
import { InstancedRig } from './instancedRig';
import type { LineBatch } from './lineBatch';
import type { Materials } from './materials';
import { QuadBatch } from './quadBatch';

/** The pick-up kinds, in the order of their pictures on the icon strip. */
export const PICKUP_KINDS = PICKUP_IDS.filter((id): id is PickupKind => id !== 'none');

/** How high a crate still is, `fall` seconds before it lands (straight down at a steady speed). */
export function crateHeight(fall: number): number {
  return (CRATE_RULES.dropHeight * Math.max(0, fall)) / CRATE_RULES.fallTime;
}

/** The crate's `beacon` node: the middle of its lid, where it hangs and its light sits (meters up). */
const BEACON_Y = 1.63;
/** The humans' cyan (DESIGN.md section 8). */
const CYAN = 0x1ec8e0;
const CELL = 128;

interface CrateState {
  /** The tick it lands on (estimated from the snapshots; see `update`). */
  landTick: number;
  /** Local seconds when it was first seen on the ground (-1 while it comes down). */
  landedAt: number;
  trail: number;
  smoke: number;
}

/** A taken crate's picture leaping up and fading, or a landed canopy collapsing. */
interface Ghost {
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  age: number;
}

interface Canopy {
  x: number;
  z: number;
  yaw: number;
  age: number;
}

export class CratesView {
  readonly group = new THREE.Group();
  private readonly assets: AssetStore;
  private readonly effects: Effects;
  private readonly glow: QuadBatch;
  private readonly crates: InstancedRig;
  private readonly chutes: InstancedRig;
  private readonly icons: QuadBatch;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly texture: THREE.Texture;
  private readonly cellUv: number[][] = [];
  private readonly ready = new Set<PickupKind>();
  private readonly state = new Map<number, CrateState>();
  private readonly ghosts: Ghost[] = [];
  private readonly canopies: Canopy[] = [];
  private readonly glowUv = [0, 0, 0, 0];
  private time = 0;

  constructor(assets: AssetStore, materials: Materials, effects: Effects, glow: QuadBatch) {
    this.assets = assets;
    this.effects = effects;
    this.glow = glow;
    this.crates = new InstancedRig(assets.model('prop_crate'), materials, 32);
    this.chutes = new InstancedRig(assets.model('prop_parachute'), materials, 48);
    const anim = [...assets.sprite('fx_glow').anims.values()][0];
    if (anim) frameRect(anim, 0, 0, this.glowUv, 0);
    // The pictures of the five pick-ups, side by side on one strip: one draw call for all of them.
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = CELL * PICKUP_KINDS.length;
      this.canvas.height = CELL;
    }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.Texture();
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    PICKUP_KINDS.forEach((kind, i) => {
      this.cellUv.push([i / PICKUP_KINDS.length, 0, (i + 1) / PICKUP_KINDS.length, 1]);
      void this.paintCell(kind, i);
    });
    this.icons = new QuadBatch(this.texture, { mode: 'facing', capacity: 48, renderOrder: 19, fog: false });
    this.group.add(this.crates.group, this.chutes.group, this.icons.mesh);
  }

  /** Paints one pick-up's badge on the strip once its icon has been decoded. */
  private async paintCell(kind: PickupKind, i: number): Promise<void> {
    const img = await iconImage(this.assets, pickupIcon(kind), '#ffffff', 96);
    const pen = this.canvas?.getContext('2d');
    if (!pen) return;
    const cx = i * CELL + CELL / 2;
    const cy = CELL / 2;
    pen.clearRect(i * CELL, 0, CELL, CELL);
    // A dark badge with the humans' cyan ring reads over sky, street and smoke alike.
    pen.beginPath();
    pen.arc(cx, cy, CELL * 0.46, 0, Math.PI * 2);
    pen.fillStyle = 'rgba(10, 18, 30, 0.82)';
    pen.fill();
    pen.lineWidth = CELL * 0.06;
    pen.strokeStyle = '#1ec8e0';
    pen.stroke();
    if (img) pen.drawImage(img, cx - 34, cy - 34, 68, 68);
    else {
      // No picture for it: a plain cyan diamond (a pick-up all the same).
      pen.beginPath();
      pen.moveTo(cx, cy - 26);
      pen.lineTo(cx + 26, cy);
      pen.lineTo(cx, cy + 26);
      pen.lineTo(cx - 26, cy);
      pen.closePath();
      pen.fillStyle = '#1ec8e0';
      pen.fill();
    }
    this.texture.needsUpdate = true;
    this.ready.add(kind);
  }

  private uvOf(kind: PickupKind): number[] | null {
    const i = PICKUP_KINDS.indexOf(kind);
    return i >= 0 && this.ready.has(kind) ? this.cellUv[i] : null;
  }

  /** A crate event: the flash of one being taken, the smoke of one going. */
  handleEvent(e: CrateEvent): void {
    const fx = this.effects;
    if (e.phase === 'take') {
      fx.glowAt(e.x, 2, e.z, 16, CYAN, 0.3, 1);
      fx.ring(e.x, e.z, 9, CYAN, 0.6, 0.95);
      fx.sparks(e.x, 1.6, e.z, 2.5, 14, 0xbff4ff, 0.55);
      this.ghosts.push({ kind: e.kind, x: e.x, y: BEACON_Y + 3, z: e.z, age: 0 });
      this.state.delete(e.id);
    } else if (e.phase === 'gone') {
      fx.dust(e.x, 1, e.z, 3, 6, 0xd8d8d0);
      this.state.delete(e.id);
    } else if (e.phase === 'land') {
      fx.dust(e.x, 0.3, e.z, 3, 6);
    }
  }

  clear(): void {
    this.state.clear();
    this.ghosts.length = 0;
    this.canopies.length = 0;
    this.crates.begin();
    this.crates.end();
    this.chutes.begin();
    this.chutes.end();
    this.icons.begin();
    this.icons.end();
  }

  /** Draws the crates of this frame (`tick`: the fractional server tick the frame shows). */
  update(crates: readonly SnapCrate[], tick: number, dt: number, camera: THREE.Camera, lines: LineBatch): void {
    this.time += dt;
    const time = this.time;
    const fx = this.effects;
    this.crates.begin();
    this.chutes.begin();
    this.icons.begin();
    const cam = camera.position;
    const seen = new Set<number>();
    for (const c of crates) {
      seen.add(c.id);
      let s = this.state.get(c.id);
      // When it lands: the snapshot's `fall` is counted from a snapshot a little older than the
      // frame, so frame + fall is never early; the smallest such guess is the true one, and the
      // crate comes down smoothly between the snapshots' steps.
      const guess = tick + c.fall * TICK_RATE;
      if (!s) {
        s = { landTick: guess, landedAt: c.fall > 0 ? -1 : time - 5, trail: 0, smoke: 0 };
        this.state.set(c.id, s);
      } else if (c.fall > 0) {
        s.landTick = Math.min(s.landTick, guess);
      }
      const fall = c.fall > 0 ? Math.max(0, (s.landTick - tick) / TICK_RATE) : 0;
      const y = crateHeight(fall);
      if (fall <= 0 && s.landedAt < 0) {
        s.landedAt = time;
        this.canopies.push({ x: c.x, z: c.z, yaw: c.id * 1.3, age: 0 });
      }
      const sway = fall > 0 ? Math.sin(time * 1.4 + c.id) * 0.07 : 0;
      this.crates.add(c.x, y, c.z, c.id * 0.7, 1, undefined, sway, Math.cos(time * 1.1 + c.id) * 0.05 * (fall > 0 ? 1 : 0));
      const dist = Math.hypot(c.x - cam.x, y - cam.y, c.z - cam.z);
      if (fall > 0) {
        this.chutes.add(c.x, y + BEACON_Y, c.z, c.id * 0.7, 1, undefined, sway, Math.cos(time * 1.1 + c.id) * 0.05);
        s.trail -= dt;
        if (s.trail <= 0) {
          s.trail = 0.12;
          fx.puff(c.x, y + 0.5, c.z, 1.6, 0xf2f2ee, 1.6, 0.5);
        }
      } else {
        this.beacon(c, s, time, dt, dist, lines);
      }
      // What is inside, over it: the picture grows with the distance so it reads from afar.
      const uv = this.uvOf(c.kind);
      if (uv) {
        const size = Math.max(2.2, Math.min(36, dist * 0.045));
        const bob = Math.sin(time * 2.2 + c.id) * size * 0.06;
        this.icons.push(c.x, y + BEACON_Y + 1.6 + size * 0.6 + bob + (fall > 0 ? 7.5 : 0), c.z, size, size, uv, 0, 1, 1, 1, 0.97);
      }
    }
    for (const id of [...this.state.keys()]) if (!seen.has(id)) this.state.delete(id);

    // Canopies that came down with their crates fold over and sink away.
    for (let i = 0; i < this.canopies.length; i++) {
      const c = this.canopies[i];
      c.age += dt;
      if (c.age > 1.6) {
        this.canopies[i] = this.canopies[this.canopies.length - 1];
        this.canopies.pop();
        i--;
        continue;
      }
      const f = Math.min(1, c.age / 1.6);
      this.chutes.add(c.x + Math.sin(c.yaw) * f * 3, BEACON_Y + 1 - f * 4.5, c.z + Math.cos(c.yaw) * f * 3, c.yaw, 1 - f * 0.3, undefined, f * 1.35, 0);
    }
    // A taken crate's picture leaps up and fades.
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      g.age += dt;
      if (g.age > 0.9) {
        this.ghosts[i] = this.ghosts[this.ghosts.length - 1];
        this.ghosts.pop();
        i--;
        continue;
      }
      const uv = this.uvOf(g.kind);
      if (!uv) continue;
      const dist = Math.hypot(g.x - cam.x, g.y - cam.y, g.z - cam.z);
      const size = Math.max(2.2, Math.min(36, dist * 0.045)) * (1 + g.age * 1.2);
      this.icons.push(g.x, g.y + g.age * 9, g.z, size, size, uv, 0, 1, 1, 1, 1 - g.age / 0.9);
    }
    this.crates.end();
    this.chutes.end();
    this.icons.end();
  }

  /**
   * A crate on the ground: a pulsing column of cyan light anyone can see over the roofs, a
   * blinking light on its lid, and cyan smoke drifting up.
   */
  private beacon(c: SnapCrate, s: CrateState, time: number, dt: number, dist: number, lines: LineBatch): void {
    const pulse = 0.55 + 0.35 * Math.sin(time * 4 + c.id);
    const height = Math.min(160, 32 + dist * 0.12);
    const width = Math.max(0.5, dist * 0.004);
    lines.push(c.x, BEACON_Y, c.z, c.x, BEACON_Y + height, c.z, width * 2.5, 0.12, 0.62, 0.7, 0.35 * pulse);
    lines.push(c.x, BEACON_Y, c.z, c.x, BEACON_Y + height * 0.8, c.z, width, 0.6, 0.95, 1, 0.8 * pulse);
    const blink = Math.sin(time * 6 + c.id) > 0.2 ? 1 : 0.25;
    const g = Math.max(1.6, dist * 0.02);
    this.glow.push(c.x, BEACON_Y + 0.25, c.z, g, g, this.glowUv, 0, 0.3 * blink, 0.85 * blink, 1 * blink, 0.95);
    s.smoke -= dt;
    if (s.smoke <= 0) {
      s.smoke = 0.4;
      this.effects.puff(c.x, BEACON_Y + 0.4, c.z, 1.8, 0x7fdcec, 3.2, 0.55);
    }
  }
}
