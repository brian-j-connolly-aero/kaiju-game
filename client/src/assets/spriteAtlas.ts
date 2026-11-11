/**
 * Packs every sprite sheet (real or procedural) into one texture, so all soldiers, civilians
 * and effect particles can be drawn from a single instanced batch each. Frame rectangles are
 * precomputed as texture coordinates.
 */

import * as THREE from 'three';
import type { SpriteEntry } from './manifest';

export interface SpriteAnimInfo {
  /** 1 (same picture from every side) or 4 (front, left, back, right). */
  facings: number;
  frames: number;
  fps: number;
  /** u0, v0, u1, v1 for every facing and frame: index (facing * frames + frame) * 4. */
  uv: Float32Array;
}

export interface SpriteInfo {
  id: string;
  /** Height of a frame in the world, meters. */
  worldHeight: number;
  /** Frame width divided by frame height. */
  aspect: number;
  anims: Map<string, SpriteAnimInfo>;
  /** True when the frames come from the procedural generator. */
  procedural: boolean;
}

export interface SpriteSheetSource {
  /** Identifies the sheet: sprites that share a `file` share one image. */
  key: string;
  image: CanvasImageSource & { width: number; height: number };
  entries: Record<string, SpriteEntry>;
  procedural: boolean;
}

export interface SpriteAtlas {
  texture: THREE.Texture;
  width: number;
  height: number;
  sprites: Map<string, SpriteInfo>;
}

/** Writes the rectangle of one frame into `out` (4 numbers at `offset`). */
export function frameRect(anim: SpriteAnimInfo, facing: number, frame: number, out: Float32Array | number[], offset = 0): void {
  const f = anim.facings === 4 ? facing & 3 : 0;
  const i = (f * anim.frames + (((frame % anim.frames) + anim.frames) % anim.frames)) * 4;
  out[offset] = anim.uv[i];
  out[offset + 1] = anim.uv[i + 1];
  out[offset + 2] = anim.uv[i + 2];
  out[offset + 3] = anim.uv[i + 3];
}

/**
 * Stacks the sheets top to bottom on one canvas. The canvas is created by `makeCanvas` so this
 * module does not touch the DOM by itself.
 */
export function buildSpriteAtlas(
  sheets: SpriteSheetSource[],
  makeCanvas: (w: number, h: number) => HTMLCanvasElement,
): SpriteAtlas {
  const PAD = 2;
  let width = 64;
  let height = PAD;
  for (const sheet of sheets) {
    width = Math.max(width, sheet.image.width + PAD * 2);
    height += sheet.image.height + PAD;
  }
  const canvas = makeCanvas(width, Math.max(64, height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;
  const W = canvas.width;
  const H = canvas.height;

  const sprites = new Map<string, SpriteInfo>();
  let y = PAD;
  for (const sheet of sheets) {
    ctx.drawImage(sheet.image, PAD, y);
    for (const [id, entry] of Object.entries(sheet.entries)) {
      const [fw, fh] = entry.frame;
      if (!(fw > 0 && fh > 0)) continue;
      const anims = new Map<string, SpriteAnimInfo>();
      for (const [name, anim] of Object.entries(entry.anims ?? {})) {
        const rows = Array.isArray(anim.rows) && anim.rows.length > 0 ? anim.rows : [0];
        const facings = rows.length >= 4 ? 4 : 1;
        const frames = Math.max(1, Math.floor(anim.frames) || 1);
        const uv = new Float32Array(facings * frames * 4);
        for (let f = 0; f < facings; f++) {
          for (let k = 0; k < frames; k++) {
            const px = PAD + ((anim.col ?? 0) + k) * fw;
            const py = y + rows[f] * fh;
            const i = (f * frames + k) * 4;
            // A small inset keeps neighbours from bleeding in at grazing angles.
            uv[i] = (px + 0.05) / W;
            uv[i + 1] = 1 - (py + fh - 0.05) / H;
            uv[i + 2] = (px + fw - 0.05) / W;
            uv[i + 3] = 1 - (py + 0.05) / H;
          }
        }
        anims.set(name, { facings, frames, fps: anim.fps > 0 ? anim.fps : 8, uv });
      }
      sprites.set(id, { id, worldHeight: entry.worldHeight > 0 ? entry.worldHeight : 1.8, aspect: fw / fh, anims, procedural: sheet.procedural });
    }
    y += sheet.image.height + PAD;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, width: W, height: H, sprites };
}
