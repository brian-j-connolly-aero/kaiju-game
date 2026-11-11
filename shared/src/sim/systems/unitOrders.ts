/**
 * System 3 of 11: unit orders and sub-unit AI.
 *
 * STUB(sim): Worker 2 (human squads) fills this in:
 * - apply this tick's `player.commands` to the player's squad: 'follow' / 'moveTo' set
 *   `squad.moveOrder` (and `moveTarget`), 'fireAtWill' / 'holdCharge' set `squad.fireMode`;
 *   'callIn' starts a CallInMission in `world.callIns` if its cooldown is ready (emit `callin`);
 * - for every sub-unit (every living unit that is not `squad.driven`), write `unit.control`:
 *   follow in formation or go to the move target (use `setWorldMove`), aim at the target, and
 *   set `control.fire` when firing at will with range and line of sight;
 * - hold-and-charge: root the unit (`unit.rooted`), lock its aim to the firing arc
 *   (COMBAT_RULES.chargeHalfArc), build `unit.charge` over COMBAT_RULES.chargeTime; a new
 *   movement order un-roots it;
 * - shaken units (`unit.shaken > 0`, state 'shaken') back off and cannot fire. The damage
 *   system already shakes them, clears their charge, counts `unit.shaken` down and puts the
 *   state back to 'idle'; what a shaken unit DOES is decided here (it stays `rooted` if it was);
 * - lives: when a squad's driven unit dies, hand the player the next living unit (emit
 *   `takeover`). The damage system already sets `squad.eliminated` and `squad.driven = -1` on
 *   the tick the last unit dies;
 * - keep `unit.state` current for animation ('idle' | 'moving' | 'charging' | 'shaken' | 'dead').
 *
 * Real today: perception. `updateSpotting` (sim/spotting.ts) refreshes `kaiju.spotted` and
 * `kaiju.known` every tick before any orders are decided, so sub-unit AI and bots can rely on
 * them. The driven unit's control is already written by the input system, and the movement
 * system already moves every unit from its control.
 */

import { updateSpotting } from '../spotting';
import type { World } from '../types';

export function unitOrderSystem(world: World): void {
  if (world.match.phase !== 'playing') return;
  updateSpotting(world);
  for (const u of world.units) {
    if (!u.alive) continue;
    // Minimal placeholder so animation states are not frozen: moving or idle from actual velocity.
    if (u.state === 'idle' || u.state === 'moving') {
      u.state = u.vx * u.vx + u.vz * u.vz > 0.04 ? 'moving' : 'idle';
    }
  }
}
