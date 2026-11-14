/** Playable bounds per stage and the value inside them (DESIGN.md section 2). */

import type { PerStage, StageId } from '../defs/ids';
import { STAGES } from '../defs/stages';
import type { Bounds } from '../math/geom';
import { clamp } from '../math/scalar';
import { PROP_KINDS } from './props';
import type { CityData } from './types';

export function cityBounds(city: CityData): Bounds {
  return { minX: -city.half, minZ: -city.half, maxX: city.half, maxZ: city.half };
}

/** Square of the given half size centered as close to (x, z) as fits inside the city. */
export function squareInCity(city: CityData, x: number, z: number, half: number): Bounds {
  const h = Math.min(half, city.half);
  const cx = clamp(x, -city.half + h, city.half - h);
  const cz = clamp(z, -city.half + h, city.half - h);
  return { minX: cx - h, minZ: cz - h, maxX: cx + h, maxZ: cz + h };
}

/**
 * Playable bounds for a match that starts at the given neighborhood anchor.
 * Stage 1: the neighborhood square around the anchor. Stage 2: a district square that contains
 * the neighborhood and leans toward downtown. Stage 3: the whole city. All are axis-aligned
 * squares shifted to fit inside the city.
 */
export function stageBounds(city: CityData, anchorId: number, stage: StageId): Bounds {
  const anchor = city.anchors[anchorId];
  if (!anchor) throw new Error(`no neighborhood anchor ${anchorId}`);
  const half1 = STAGES[0].boundsHalfSize;
  const b1 = squareInCity(city, anchor.x, anchor.z, half1);
  if (stage === 1) return b1;
  if (stage === 3) return cityBounds(city);
  const half2 = STAGES[1].boundsHalfSize;
  const c1x = (b1.minX + b1.maxX) / 2;
  const c1z = (b1.minZ + b1.maxZ) / 2;
  // Slide toward downtown as far as possible while still containing the neighborhood.
  const slack = Math.max(0, half2 - half1);
  const cx = c1x + clamp(city.downtown.x - c1x, -slack, slack);
  const cz = c1z + clamp(city.downtown.z - c1z, -slack, slack);
  return squareInCity(city, cx, cz, half2);
}

export function allStageBounds(city: CityData, anchorId: number): PerStage<Bounds> {
  return [stageBounds(city, anchorId, 1), stageBounds(city, anchorId, 2), stageBounds(city, anchorId, 3)];
}

/**
 * V(bounds): destruction bar value present inside the bounds at the start of a match: every
 * structure whose center is inside, plus every prop inside. The bar marks are fractions of this.
 */
export function valueInBounds(city: CityData, b: Bounds): number {
  let total = 0;
  for (const s of city.structures) {
    if (s.x >= b.minX && s.x <= b.maxX && s.z >= b.minZ && s.z <= b.maxZ) total += s.value;
  }
  for (const p of city.props) {
    if (p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ) total += PROP_KINDS[p.kind].value;
  }
  return total;
}
