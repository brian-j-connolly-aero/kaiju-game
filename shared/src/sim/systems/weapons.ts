/**
 * System 6 of 11: weapons and volleys.
 *
 * STUB(sim): Worker 2 (human squads) fills this in:
 * - tick `unit.cooldown` down; a living, unshaken unit with `control.fire` set and its weapon
 *   ready fires `shotsForMembers(weapon, unit.members)` projectiles along its aim, from
 *   `muzzleHeight`, with the weapon's aim error for sub-units (at-will or volley, times the
 *   scatter multipliers in COMBAT_RULES and the stage's `scatterMult`; veterans x0.7; the
 *   player-driven unit has no error). Push into `world.projectiles`, emit `projectileSpawn`;
 * - volley: when a player-driven unit fires, every sub-unit of the squad with charge fires at
 *   the player's aim point (`resolveAimPoint` in sim/aim.ts) with damage x(1 + charge) and
 *   nerve x(1 + 2 * charge), then its charge resets. Emit `volley`, count `tally.volleys`;
 * - call-ins: advance `world.callIns` (delay, then shells over the duration, scattered within
 *   the scatter radius), spawn 'arty' projectiles, emit `callin` phases, run cooldowns in
 *   `squad.callInCooldowns`.
 */

import type { World } from '../types';

export function weaponSystem(_world: World): void {
  // STUB(sim): see the file header.
}
