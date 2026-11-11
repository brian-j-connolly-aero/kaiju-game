/**
 * Who can see the kaiju (DESIGN.md section 5, "Scatter multipliers" and "Map view").
 *
 * - `kaiju.spotted`: a player-driven unit has line of sight to it within COMBAT_RULES.spotRange.
 *   Spotted targets are easier to hit (the scatter multiplier).
 * - `kaiju.known`: the humans' map shows it. Always at stages 2 and 3. At stage 1 only while any
 *   living human unit has line of sight within MATCH_RULES.revealSightRange, or for
 *   MATCH_RULES.revealAfterNoise seconds after it made noise (see `noteKaijuNoise`).
 *
 * Line of sight runs from the unit's eye to the kaiju's upper body and is blocked by standing
 * structures only.
 */

import { lineOfSight } from '../city/spatialIndex';
import { COMBAT_RULES, DT, MATCH_RULES } from '../defs/rules';
import { stageDef } from '../defs/stages';
import { unitTypeDef } from '../defs/units';
import { say } from './systems/voice';
import type { Kaiju, Unit, World } from './types';

/** Fraction of the kaiju's height that sight lines aim at. */
const SIGHT_TARGET_HEIGHT = 0.7;

const eye = { x: 0, y: 0, z: 0 };
const target = { x: 0, y: 0, z: 0 };

/** True when the unit can see the kaiju within `range` meters. */
export function unitSeesKaiju(world: World, unit: Unit, kaiju: Kaiju, range: number): boolean {
  const dx = kaiju.x - unit.x;
  const dz = kaiju.z - unit.z;
  const reach = range + kaiju.radius;
  if (dx * dx + dz * dz > reach * reach) return false;
  eye.x = unit.x;
  eye.y = unit.y + unitTypeDef(unit.type).eyeHeight;
  eye.z = unit.z;
  target.x = kaiju.x;
  target.y = kaiju.height * SIGHT_TARGET_HEIGHT;
  target.z = kaiju.z;
  return lineOfSight(world.cityQuery, eye, target);
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
  const alwaysKnown = stageDef(world.match.stage).kaijuAlwaysKnown;
  for (const k of world.kaijus) {
    if (!k.alive) {
      k.spotted = false;
      continue;
    }
    if (k.knownTimer > 0) k.knownTimer = Math.max(0, k.knownTimer - DT);

    let spotted = false;
    let seen = false;
    for (const squad of world.squads) {
      for (const id of squad.units) {
        const u = world.units[id];
        if (!u.alive) continue;
        const driven = squad.driven === id && !world.players[squad.player].bot;
        if (!spotted && driven && unitSeesKaiju(world, u, k, COMBAT_RULES.spotRange)) spotted = true;
        if (!seen && !alwaysKnown && unitSeesKaiju(world, u, k, MATCH_RULES.revealSightRange)) seen = true;
      }
    }
    k.spotted = spotted;

    const known = alwaysKnown || seen || k.knownTimer > 0;
    if (known !== k.known) {
      k.known = known;
      // At later stages it is never out of sight, so there is nothing to announce.
      if (!alwaysKnown) say(world, known ? 'kaiju.spotted' : 'kaiju.lost');
    }
  }
}
