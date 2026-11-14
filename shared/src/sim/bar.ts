/** Destruction bar arithmetic (DESIGN.md section 2). */

import { allStageBounds, valueInBounds } from '../city/bounds';
import type { CityData } from '../city/types';
import type { PerStage, StructureStage } from '../defs/ids';
import { MATCH_RULES } from '../defs/rules';
import { clamp01 } from '../math/scalar';

/**
 * The three marks for a match that starts at `anchor`, computed from the value actually present
 * so every neighborhood is fair:
 *   P1 = p1 * V(stage 1 bounds), P2 = max(growth * P1, p2 * V(stage 2 bounds)),
 *   P3 = max(growth * P2, p3 * V(whole city)), each times `scale` (MatchTuning.barScale).
 */
export function computeBarMarks(city: CityData, anchor: number, scale = 1): PerStage<number> {
  const [b1, b2, b3] = allStageBounds(city, anchor);
  const bar = MATCH_RULES.bar;
  // Never 0, even for an empty test city: a zero mark would be "passed" before anyone moved.
  const p1 = Math.max(1, bar.p1 * valueInBounds(city, b1));
  const p2 = Math.max(bar.growth * p1, bar.p2 * valueInBounds(city, b2));
  const p3 = Math.max(bar.growth * p2, bar.p3 * valueInBounds(city, b3));
  return [p1 * scale, p2 * scale, p3 * scale];
}

/**
 * Where the bar's fill sits along the skyline display, 0..1: points 0..P1 map to the first 21%
 * of the width, P1..P2 to 21..57%, P2..P3 to 57..100%.
 */
export function barDisplayFraction(points: number, marks: PerStage<number>): number {
  const d = MATCH_RULES.bar.display;
  if (points <= marks[0]) return marks[0] > 0 ? d[0] * clamp01(points / marks[0]) : 0;
  if (points <= marks[1]) return d[0] + (d[1] - d[0]) * clamp01((points - marks[0]) / (marks[1] - marks[0]));
  return d[1] + (d[2] - d[1]) * clamp01((points - marks[1]) / (marks[2] - marks[1]));
}

/** Visual damage stage for a structure at `hp` of `maxHp`: 0 intact, 1 damaged, 2 heavily damaged, 3 rubble. */
export function structureStageFor(hp: number, maxHp: number): StructureStage {
  if (hp <= 0) return 3;
  const f = hp / maxHp;
  if (f <= MATCH_RULES.structureHeavyAt) return 2;
  if (f <= MATCH_RULES.structureDamagedAt) return 1;
  return 0;
}
