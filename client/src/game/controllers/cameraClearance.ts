/**
 * Keeps a camera out of the buildings.
 *
 * A body never stands inside a standing structure, but a camera that hangs off it can: the
 * kaiju's head reaches past its collision circle at stages 2 and 3 (walk up to a tower and the
 * eye would be inside it), and a chase camera trails behind a unit that has its back to a wall.
 * From inside a building the walls are back faces, so the building would simply vanish.
 *
 * `clearOfWalls` answers how far along the line from a pivot on the body (a point in the open)
 * to the wanted camera position the camera may go: it stops `margin` meters short of the first
 * standing wall, so the near plane cannot cut through it either. `easeClearance` makes the
 * result pleasant: the camera gives way to a wall at once and drifts back out slowly.
 */

import { castRay, createCityCastHit, structureAt, type CityQuery } from '@mb/shared';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

const hit = createCityCastHit();
const dir = { x: 0, y: 0, z: 0 };

/**
 * The fraction (0..1) of the way from `pivot` to `eye` that is clear of standing structures,
 * leaving `margin` meters before the first wall. 1 means nothing is in the way. When the pivot
 * itself is inside a building (a titan wading through a tower) there is nothing sensible to
 * do, and the answer is 1.
 */
export function clearOfWalls(query: CityQuery, pivot: Point3, eye: Point3, margin: number): number {
  const dx = eye.x - pivot.x;
  const dy = eye.y - pivot.y;
  const dz = eye.z - pivot.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return 1;
  const inside = structureAt(query, pivot.x, pivot.z);
  if (inside >= 0 && query.index.spassable[inside] === 0 && pivot.y < query.index.sheight[inside]) return 1;
  dir.x = dx / len;
  dir.y = dy / len;
  dir.z = dz / len;
  // Look a margin past the eye as well: a wall just behind the camera is as bad as one in front.
  if (!castRay(query, pivot, dir, len + margin, hit, -1, true)) return 1;
  return Math.max(0, Math.min(1, (hit.t - margin) / len));
}

/** Moves a smoothed clearance toward its target: inward at once, outward at `rate` per second. */
export function easeClearance(current: number, target: number, dt: number, rate = 5): number {
  if (target <= current) return target;
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}
