/**
 * Who can see the kaiju (DESIGN.md section 5, "Scatter multipliers" and "Map view").
 *
 * - `kaiju.spotted`: a driven unit (the one a squad's player or bot drives, not a sub-unit) has
 *   line of sight to it within COMBAT_RULES.spotRange. Spotted targets are easier to hit (the
 *   scatter multiplier). Bot squads follow the same rules as players, so their leaders spot too.
 * - `kaiju.known`: the humans' map shows it. Always at stages 2 and 3. At stage 1 only while any
 *   living human unit has line of sight within MATCH_RULES.revealSightRange, or for
 *   MATCH_RULES.revealAfterNoise seconds after it made noise (see `noteKaijuNoise`).
 * - Swimming (sim/swim.ts): while it is all the way under, the stage 1 rule holds at every stage,
 *   and both distances shrink to the swim's `sightMult` (only the spines show).
 *
 * Line of sight runs from the unit's eye to the kaiju's upper body and is blocked by standing
 * structures and by smoke clouds (sim/abilities.ts). Bridge decks do not block it: a unit or a
 * kaiju on a bridge stands inside the deck's box.
 *
 * A kaiju a squad has marked (sim/abilities.ts) is both known and spotted for as long as the
 * mark lasts.
 */

import { lineOfSight } from '../city/spatialIndex';
import { COMBAT_RULES, DT, MATCH_RULES } from '../defs/rules';
import { stageDef } from '../defs/stages';
import { unitTypeDef } from '../defs/units';
import { smokeBlocks } from './abilities';
import { say } from './systems/voice';
import { kaijuShownHeight, kaijuSightMult, kaijuUnder } from './swim';
import type { Kaiju, Unit, World } from './types';

/** Fraction of the kaiju's height that sight lines aim at. */
const SIGHT_TARGET_HEIGHT = 0.7;

const eye = { x: 0, y: 0, z: 0 };
const target = { x: 0, y: 0, z: 0 };

/** True when the unit can see the kaiju within `range` meters. */
export function unitSeesKaiju(world: World, unit: Unit, kaiju: Kaiju, range: number): boolean {
  const dx = kaiju.x - unit.x;
  const dz = kaiju.z - unit.z;
  // Swimming, only the spines show: it is seen from nearer, and only there (sim/swim.ts).
  const reach = range * kaijuSightMult(kaiju) + kaiju.radius;
  if (dx * dx + dz * dz > reach * reach) return false;
  eye.x = unit.x;
  eye.y = unit.y + unitTypeDef(unit.type).eyeHeight;
  eye.z = unit.z;
  target.x = kaiju.x;
  target.y = kaijuShownHeight(kaiju) * SIGHT_TARGET_HEIGHT;
  target.z = kaiju.z;
  if (world.smokes.length > 0 && smokeBlocks(world.smokes, eye, target)) return false;
  return lineOfSight(world.cityQuery, eye, target, true);
}

/**
 * Call when a kaiju roars, stomps or wrecks something: at stage 1 the noise puts it on the
 * humans' map for a few seconds even with nobody looking.
 */
export function noteKaijuNoise(kaiju: Kaiju): void {
  kaiju.knownTimer = MATCH_RULES.revealAfterNoise;
}

/** Refreshes `spotted` and `known` for every kaiju and calls it on the radio when that changes. */
export function updateSpotting(world: World): void {
  const stageKnown = stageDef(world.match.stage).kaijuAlwaysKnown;
  for (const k of world.kaijus) {
    // Under water it is never simply known, at any stage: it has to be seen (sim/swim.ts).
    const alwaysKnown = stageKnown && !kaijuUnder(k);
    if (!k.alive) {
      k.spotted = false;
      k.marked = 0;
      continue;
    }
    if (k.knownTimer > 0) k.knownTimer = Math.max(0, k.knownTimer - DT);

    let spotted = false;
    let seen = false;
    // The squad whose unit has eyes on it (the first one found), for the radio call.
    let seenBy = -1;
    for (const squad of world.squads) {
      for (const id of squad.units) {
        const u = world.units[id];
        if (!u.alive) continue;
        const driven = squad.driven === id;
        if (!spotted && driven && unitSeesKaiju(world, u, k, COMBAT_RULES.spotRange)) spotted = true;
        if (!seen && !alwaysKnown && unitSeesKaiju(world, u, k, MATCH_RULES.revealSightRange)) {
          seen = true;
          seenBy = squad.id;
        }
      }
    }
    const marked = k.marked > 0;
    k.spotted = spotted || marked;

    const known = alwaysKnown || seen || marked || k.knownTimer > 0;
    if (known !== k.known) {
      k.known = known;
      // At later stages it is out of sight only while it swims; otherwise there is nothing to announce.
      if (!alwaysKnown) say(world, known ? 'kaiju.spotted' : 'kaiju.lost', known ? seenBy : -1);
    }
  }
}
