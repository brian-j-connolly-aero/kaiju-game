/**
 * Swimming: the kaiju's hide-and-travel mode in deep water (DESIGN.md section 4, "Swimming").
 *
 * It is automatic, so a new player needs no extra button: a kaiju that stands idle in water deep
 * enough for its body goes under (`diveTime`), and any action button (or an action, a stagger)
 * brings it back up (`surfaceTime`). It stays up for `settleTime` after it last acted, so a
 * fight in the river is a fight, not a bob up and down. `Kaiju.submerge` runs from 0 (standing)
 * to 1 (all the way under) and everything that cares reads it through the helpers below:
 *
 * - Under, only the spines show: the hit volume is what shows (`kaijuShownHeight`,
 *   `kaijuShownRadius`), so it can still be hit, by a good shot.
 * - It is harder to see: squads' sight and spotting reach shrink to `sightMult`, and even at
 *   stage 2 the humans' map loses it while it is under and unseen (sim/spotting.ts).
 * - It travels at `speedMult` of its land speed, with no water slowdown (sim/movement.ts).
 * - It cannot act, wreck or trample while it is going under, under, or coming up: it earns no
 *   destruction while it swims, so swimming is never a way to run up the bar or the clock.
 *
 * Deep enough means the water reaches `fitRadii` body radii out from its center all round. A
 * bridge deck overhead does not count against it (it swims under). Kinds without a `swim`
 * definition, and stages the definition leaves out (the titan), never go under.
 */

import { groundCodeAt, GROUND_WATER, type CityQuery } from '../city/spatialIndex';
import type { KaijuKindId, StageId } from '../defs/ids';
import { perStage } from '../defs/ids';
import { kaijuKindDef, kaijuStageDef } from '../defs/kaiju/index';
import type { KaijuSwimDef } from '../defs/schema';
import { DT } from '../defs/rules';
import { lerp } from '../math/scalar';
import { Btn } from '../net/input';
import type { InputState, Kaiju } from './types';

/** The buttons that bring a swimming kaiju up: every kaiju button (net/input.ts). */
export const SWIM_SURFACE_BUTTONS = Btn.strike | Btn.grab | Btn.stomp | Btn.move1 | Btn.move2 | Btn.molt;

/** What the helpers need of a kaiju. Kaiju and snapshot kaiju both satisfy it. */
export interface SwimBody {
  kind: KaijuKindId;
  stage: StageId;
  /** 0..1; absent counts as 0 (standing up). */
  submerge?: number;
}

/** The kind's swim definition when it can swim at this stage, else null. */
export function swimDef(kind: KaijuKindId, stage: StageId): KaijuSwimDef | null {
  const swim = kaijuKindDef(kind).swim;
  return swim && perStage(swim.stages, stage) ? swim : null;
}

/** Eight directions around a point, for the depth test. */
const RING = 8;
const RING_COS: number[] = [];
const RING_SIN: number[] = [];
for (let i = 0; i < RING; i++) {
  RING_COS.push(Math.cos((i * 2 * Math.PI) / RING));
  RING_SIN.push(Math.sin((i * 2 * Math.PI) / RING));
}

/** True when the water at (x, z) reaches `reach` meters out all round (bridges overhead ignored). */
export function deepWaterAt(city: CityQuery, x: number, z: number, reach: number): boolean {
  const index = city.index;
  if (groundCodeAt(index, x, z) !== GROUND_WATER) return false;
  for (let i = 0; i < RING; i++) {
    if (groundCodeAt(index, x + RING_COS[i] * reach, z + RING_SIN[i] * reach) !== GROUND_WATER) return false;
  }
  return true;
}

/** True when this kaiju's body, at its stage, could go under at (x, z). */
export function canSwimAt(city: CityQuery, k: SwimBody, x: number, z: number): boolean {
  const swim = swimDef(k.kind, k.stage);
  if (!swim) return false;
  return deepWaterAt(city, x, z, perStage(swim.fitRadii, k.stage) * kaijuStageDef(k.kind, k.stage).bodyRadius);
}

/** True while it is going under, under, or coming up: it cannot act, wreck or trample. */
export function kaijuSwimming(k: SwimBody): boolean {
  return (k.submerge ?? 0) > 0;
}

/** True when it is all the way under. */
export function kaijuUnder(k: SwimBody): boolean {
  return (k.submerge ?? 0) >= 1;
}

/** How high above the water (the ground plane) the kaiju shows: its height, down to its spines when under. */
export function kaijuShownHeight(k: SwimBody): number {
  const h = kaijuStageDef(k.kind, k.stage).height;
  const s = k.submerge ?? 0;
  if (!(s > 0)) return h;
  const swim = kaijuKindDef(k.kind).swim;
  return swim ? lerp(h, h * swim.exposedHeight, s) : h;
}

/** The radius of what shows (its hit volume): the body radius, down to the spread of the spines when under. */
export function kaijuShownRadius(k: SwimBody): number {
  const r = kaijuStageDef(k.kind, k.stage).bodyRadius;
  const s = k.submerge ?? 0;
  if (!(s > 0)) return r;
  const swim = kaijuKindDef(k.kind).swim;
  return swim ? lerp(r, r * swim.exposedRadius, s) : r;
}

/** Multiplier on how far squads see and spot it: 1 standing, `sightMult` all the way under. */
export function kaijuSightMult(k: SwimBody): number {
  const s = k.submerge ?? 0;
  if (!(s > 0)) return 1;
  const swim = kaijuKindDef(k.kind).swim;
  return swim ? lerp(1, swim.sightMult, s) : 1;
}

/**
 * One tick of swimming, run by the kaiju action system before it reads the buttons. Decides
 * whether the kaiju goes down or comes up and moves `submerge` toward that.
 */
export function updateSwim(city: CityQuery, k: Kaiju, input: InputState): void {
  const swim = swimDef(k.kind, k.stage);
  if (!swim) {
    k.submerge = 0;
    k.swimSettle = 0;
    k.act.swimPress = 0;
    return;
  }
  const pressed = input.pressed & SWIM_SURFACE_BUTTONS;
  // A press made while it is in the water is kept until it is up (the action system uses it then).
  if (k.submerge > 0) k.act.swimPress |= pressed;
  const busy = k.phase !== 'idle' || (input.buttons & SWIM_SURFACE_BUTTONS) !== 0 || pressed !== 0;
  if (busy) k.swimSettle = swim.settleTime;
  else if (k.swimSettle > 0) k.swimSettle = Math.max(0, k.swimSettle - DT);

  const down =
    k.phase === 'idle' &&
    k.swimSettle <= 0 &&
    k.act.swimPress === 0 &&
    deepWaterAt(city, k.x, k.z, perStage(swim.fitRadii, k.stage) * k.radius);
  if (down) k.submerge = Math.min(1, k.submerge + DT / swim.diveTime);
  else k.submerge = Math.max(0, k.submerge - DT / swim.surfaceTime);
}
