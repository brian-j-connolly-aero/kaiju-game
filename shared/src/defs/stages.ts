/** The three stages of a match (DESIGN.md section 2). Kaiju body numbers per stage live in the kaiju kind. */

import type { PerStage, StageId } from './ids';
import { perStage } from './ids';
import type { StageDef } from './schema';

export const STAGES: PerStage<StageDef> = [
  {
    id: 1,
    key: 'hatchling',
    boundsHalfSize: 180,
    humanLevel: 1,
    timeOfDay: 'afternoon',
    scatterMult: 1.0,
    kaijuAlwaysKnown: false,
  },
  {
    id: 2,
    key: 'juvenile',
    boundsHalfSize: 460,
    humanLevel: 2,
    timeOfDay: 'sunset',
    scatterMult: 0.8,
    kaijuAlwaysKnown: true,
  },
  {
    id: 3,
    key: 'titan',
    boundsHalfSize: 1100,
    humanLevel: 3,
    timeOfDay: 'night',
    scatterMult: 0.6,
    kaijuAlwaysKnown: true,
  },
];

export const LAST_STAGE: StageId = 3;

export function stageDef(stage: StageId): StageDef {
  return perStage(STAGES, stage);
}
