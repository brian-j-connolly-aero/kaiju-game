/**
 * Where an aim ray lands. Used for the volley aim point ("where the player's aim ray lands"),
 * for markers placed with the crosshair, and for the kaiju's throw and beam targets.
 */

import { castRay, createCityCastHit, type CityQuery } from '../city/spatialIndex';
import { createCastHit, rayVsCapsule, type VerticalCapsule } from '../math/geom';
import { unitTypeDef } from '../defs/units';
import type { Kaiju, Unit } from './types';

export interface AimPoint {
  x: number;
  y: number;
  z: number;
  /** What the ray ended on. 'none': nothing within range; the point is at maximum range. */
  on: 'ground' | 'structure' | 'kaiju' | 'none';
  /** Structure id or kaiju id for those cases, else -1. */
  id: number;
  /** Distance from the ray origin. */
  dist: number;
}

export function createAimPoint(): AimPoint {
  return { x: 0, y: 0, z: 0, on: 'none', id: -1, dist: 0 };
}

const cityHit = createCityCastHit();
const capHit = createCastHit();
const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const origin = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

/** Hit volume of a kaiju: an upright capsule of its body radius and height. */
export function kaijuCapsule(k: Kaiju, out: VerticalCapsule): VerticalCapsule {
  out.x = k.x;
  out.z = k.z;
  out.r = k.radius;
  out.y0 = 0;
  out.y1 = k.height;
  return out;
}

/** Hit volume of a unit: an upright capsule of its radius, from its altitude up to its type's height. */
export function unitCapsule(u: Unit, out: VerticalCapsule): VerticalCapsule {
  out.x = u.x;
  out.z = u.z;
  out.r = u.radius;
  out.y0 = u.y;
  out.y1 = u.y + Math.max(unitTypeDef(u.type).height, 0.1);
  return out;
}

/**
 * Casts a ray from (ox, oy, oz) along (yaw, pitch) and returns the first thing it meets within
 * `maxDist`: a standing structure (bridge decks do not count: whoever aims may be standing on
 * one), a living kaiju (when `kaijus` is given), or the ground.
 */
export function resolveAimPoint(
  city: CityQuery,
  ox: number,
  oy: number,
  oz: number,
  yaw: number,
  pitch: number,
  maxDist: number,
  out: AimPoint,
  kaijus?: readonly Kaiju[],
): AimPoint {
  const cp = Math.cos(pitch);
  origin.x = ox;
  origin.y = oy;
  origin.z = oz;
  dir.x = Math.sin(yaw) * cp;
  dir.y = Math.sin(pitch);
  dir.z = Math.cos(yaw) * cp;

  let best = maxDist;
  out.on = 'none';
  out.id = -1;

  if (dir.y < 0) {
    const t = -oy / dir.y;
    if (t >= 0 && t < best) {
      best = t;
      out.on = 'ground';
    }
  }
  // Bridge decks are road surface, not walls: the ray carries on to the ground on or under them.
  if (castRay(city, origin, dir, best, cityHit, -1, true) && cityHit.t < best) {
    best = cityHit.t;
    out.on = 'structure';
    out.id = cityHit.structure;
  }
  if (kaijus) {
    for (const k of kaijus) {
      if (!k.alive) continue;
      if (rayVsCapsule(origin, dir, best, kaijuCapsule(k, capsule), capHit) && capHit.t < best) {
        best = capHit.t;
        out.on = 'kaiju';
        out.id = k.id;
      }
    }
  }
  out.dist = best;
  out.x = ox + dir.x * best;
  out.y = oy + dir.y * best;
  out.z = oz + dir.z * best;
  if (out.on === 'ground') out.y = 0;
  return out;
}
