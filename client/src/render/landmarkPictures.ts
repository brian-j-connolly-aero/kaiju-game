/**
 * Small pictures of the landmarks for the map (no words on the map: a landmark is shown by its
 * own model). Each is drawn once, from its art file in the intact state, in a three-quarter view
 * from above, onto a transparent square of a 2D canvas: the triangles are projected and painted
 * back to front, each in its vertex color times the city atlas under it, lit by a sun and the sky.
 * Done on the processor on purpose: reading a WebGL picture back would stall the frame.
 */

import * as THREE from 'three';

export interface LandmarkModel {
  /** Archetype id. */
  id: string;
  geometries: THREE.BufferGeometry[];
}

/** The atlas's pixels, for looking up the color under a texture coordinate. */
export interface AtlasPixels {
  width: number;
  height: number;
  /** RGBA, row 0 at the top (glTF texture coordinates: v = 0 is the top). */
  data: Uint8ClampedArray;
}

/** Reads an image's pixels through a 2D canvas, or null when it cannot (no image, no DOM). */
export function atlasPixels(image: unknown): AtlasPixels | null {
  const source = image as { width?: number; height?: number } | null;
  if (!source || !source.width || !source.height || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  } catch {
    return null;
  }
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** One painted triangle in picture space. */
export interface PictureTriangle {
  points: [number, number, number, number, number, number];
  depth: number;
  /** sRGB, 0..255. */
  color: [number, number, number];
}

const SUN = new THREE.Vector3(0.5, 0.8, 0.6).normalize();
const VIEW = new THREE.Vector3(-0.75, 0.62, 1).normalize();

/**
 * The triangles of a model as they appear in a `size` square picture, back to front, facing the
 * viewer only. Pure: the canvas drawing is separate so this can be tested.
 */
export function pictureTriangles(geometries: THREE.BufferGeometry[], atlas: AtlasPixels | null, size: number): PictureTriangle[] {
  const box = new THREE.Box3();
  for (const g of geometries) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  if (box.isEmpty()) return [];
  const center = box.getCenter(new THREE.Vector3());
  const forward = VIEW.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  // Fit the box's corners, as seen, into the square with a small margin.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    minX = Math.min(minX, corner.dot(right));
    maxX = Math.max(maxX, corner.dot(right));
    minY = Math.min(minY, corner.dot(up));
    maxY = Math.max(maxY, corner.dot(up));
  }
  const scale = (size * 0.94) / Math.max(0.5, maxX - minX, maxY - minY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const out: PictureTriangle[] = [];
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const g of geometries) {
    const position = g.getAttribute('position');
    if (!position) continue;
    const color = g.getAttribute('color');
    const uv = g.getAttribute('uv');
    const index = g.getIndex();
    const count = index ? index.count : position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const v = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k));
      for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(position, v[k]);
      n.crossVectors(e1.subVectors(p[1], p[0]), e2.subVectors(p[2], p[0]));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      // Facing away from the viewer: hidden behind the faces that do face it.
      if (n.dot(VIEW) <= 0) continue;
      let r = 0;
      let gr = 0;
      let b = 0;
      for (let k = 0; k < 3; k++) {
        let cr = color ? color.getX(v[k]) : 1;
        let cg = color ? color.getY(v[k]) : 1;
        let cb = color ? color.getZ(v[k]) : 1;
        if (atlas && uv) {
          // The atlas is drawn with nearest pixels: the pixel under each corner, pulled a little
          // toward the middle so a corner on a picture's edge reads its own picture.
          const u = (uv.getX(v[0]) + uv.getX(v[1]) + uv.getX(v[2])) / 3;
          const w = (uv.getY(v[0]) + uv.getY(v[1]) + uv.getY(v[2])) / 3;
          const su = uv.getX(v[k]) * 0.6 + u * 0.4;
          const sv = uv.getY(v[k]) * 0.6 + w * 0.4;
          const x = Math.min(atlas.width - 1, Math.max(0, Math.floor(su * atlas.width)));
          const y = Math.min(atlas.height - 1, Math.max(0, Math.floor(sv * atlas.height)));
          const o = (y * atlas.width + x) * 4;
          cr *= toLinear(atlas.data[o] / 255);
          cg *= toLinear(atlas.data[o + 1] / 255);
          cb *= toLinear(atlas.data[o + 2] / 255);
        }
        r += cr / 3;
        gr += cg / 3;
        b += cb / 3;
      }
      // Sky from above, bounce from below, and the sun.
      const light = 0.55 + 0.25 * n.y + 0.75 * Math.max(0, n.dot(SUN));
      const points: PictureTriangle['points'] = [0, 0, 0, 0, 0, 0];
      let depth = 0;
      for (let k = 0; k < 3; k++) {
        e1.subVectors(p[k], center);
        points[k * 2] = size / 2 + (e1.dot(right) - midX) * scale;
        points[k * 2 + 1] = size / 2 - (e1.dot(up) - midY) * scale;
        depth += e1.dot(forward) / 3;
      }
      const channel = (c: number): number => Math.max(0, Math.min(255, Math.round(toSrgb(Math.min(1, c * light)) * 255)));
      out.push({ points, depth, color: [channel(r), channel(gr), channel(b)] });
    }
  }
  // Far first.
  out.sort((a, c) => c.depth - a.depth);
  return out;
}

export function renderLandmarkPictures(models: LandmarkModel[], atlas: AtlasPixels | null, size = 96): Map<string, HTMLCanvasElement> {
  const out = new Map<string, HTMLCanvasElement>();
  if (typeof document === 'undefined') return out;
  for (const model of models) {
    const triangles = pictureTriangles(model.geometries, atlas, size);
    if (triangles.length === 0) continue;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6;
    for (const t of triangles) {
      const style = `rgb(${t.color[0]}, ${t.color[1]}, ${t.color[2]})`;
      ctx.fillStyle = style;
      // A hairline of the same color closes the seams between neighbors.
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(t.points[0], t.points[1]);
      ctx.lineTo(t.points[2], t.points[3]);
      ctx.lineTo(t.points[4], t.points[5]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    out.set(model.id, canvas);
  }
  return out;
}
