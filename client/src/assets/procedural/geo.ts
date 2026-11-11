/**
 * Small geometry kit for the procedural stand-ins: colored boxes, bars and cones that merge
 * into one flat-shaded mesh. Colors go into an RGBA `color` attribute, like the art files:
 * RGB is linear light, alpha is the tint mask (1 = takes a per-instance paint color).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type ColorLike = number | string | THREE.Color;

const scratchColor = new THREE.Color();

/** Paints every vertex of a geometry. Returns the geometry. */
export function paint(geometry: THREE.BufferGeometry, color: ColorLike, tintMask = 1): THREE.BufferGeometry {
  const c = color instanceof THREE.Color ? color : scratchColor.set(color);
  const count = geometry.getAttribute('position').count;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = tintMask;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 4));
  return geometry;
}

/** A box of the given size centered on (x, y, z). */
export function box(w: number, h: number, d: number, color: ColorLike, x = 0, y = 0, z = 0, tintMask = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color, tintMask);
}

/** A box standing on y = `y0`, centered on (x, z). */
export function boxOn(w: number, h: number, d: number, color: ColorLike, x = 0, y0 = 0, z = 0, tintMask = 1): THREE.BufferGeometry {
  return box(w, h, d, color, x, y0 + h / 2, z, tintMask);
}

const UP = new THREE.Vector3(0, 1, 0);

/** A rectangular bar from p0 to p1 (limbs, posts, barrels). */
export function bar(p0: THREE.Vector3Like, p1: THREE.Vector3Like, w: number, d: number, color: ColorLike, tintMask = 1): THREE.BufferGeometry {
  const a = new THREE.Vector3(p0.x, p0.y, p0.z);
  const b = new THREE.Vector3(p1.x, p1.y, p1.z);
  const dir = b.clone().sub(a);
  const len = Math.max(1e-4, dir.length());
  const g = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyQuaternion(q);
  const mid = a.add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return paint(g, color, tintMask);
}

/** An upright cone or pyramid standing on y = `y0`. */
export function cone(radius: number, height: number, sides: number, color: ColorLike, x = 0, y0 = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, sides, 1);
  g.translate(x, y0 + height / 2, z);
  return paint(g, color);
}

/** A faceted blob (egg, cocoon, tree crown) centered on (x, y, z). */
export function blob(rx: number, ry: number, rz: number, color: ColorLike, x = 0, y = 0, z = 0, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return paint(g, color);
}

/**
 * Merges geometries into one. Every input must have position, normal, uv and color (the
 * builders above guarantee it); indexed and non-indexed inputs are both accepted.
 */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('procedural geometry: parts could not be merged');
  return merged;
}

/** Moves a geometry authored in model space into the local space of a node whose pivot is at `pivot`. */
export function relativeTo(geometry: THREE.BufferGeometry, pivot: THREE.Vector3Like): THREE.BufferGeometry {
  geometry.translate(-pivot.x, -pivot.y, -pivot.z);
  return geometry;
}
