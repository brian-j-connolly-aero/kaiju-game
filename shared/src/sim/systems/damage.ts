/**
 * System 8 of 11: damage and nerve. One rule set for every combatant (DESIGN.md section 3).
 *
 * STUB(sim): Worker 1 (kaiju combat) fills this in:
 * - `applyHit` below is the single door all damage goes through. For a kaiju: state multiplier
 *   (normal / braced front arc / helpless), facing multiplier from `hit.fromDir` against the
 *   body yaw, crossfire (`kaiju.recentHits`, COMBAT_RULES), brace and at-will nerve multipliers,
 *   nerve immunity, rage gain; emit `kaijuHit`, `crossfire`, and at full nerve `nerveBreak` +
 *   `kaijuStagger` (phase 'stagger'). For a unit: hp, members (`membersForHp`), nerve, shaken;
 *   emit `unitHit`, `memberLost`, `unitShaken`, `unitDestroyed`, and shake nearby friends;
 * - each tick: drain `world.hits` through `applyHit`, leak nerve (kaiju `nerveLeak`, units
 *   COMBAT_RULES.unitNerveLeak), count down `nerveImmune`, end staggers, apply trample damage
 *   to units under a moving kaiju, mark kaiju death (phase 'dead', `alive = false`);
 * - update tallies (`damageDealt`, `breaks`, `kills`, `unitsLost`) and `match.breaks / kills`.
 */

import type { CombatantRef, Hit, World } from '../types';

/**
 * Applies one hit to a kaiju or a unit.
 * STUB(sim): does nothing yet; see the file header for the rules it must implement.
 */
export function applyHit(_world: World, _target: CombatantRef, _hit: Hit): void {
  // STUB(sim): see the file header.
}

export function damageSystem(world: World): void {
  for (const pending of world.hits) applyHit(world, pending.target, pending.hit);
  world.hits.length = 0;
}
