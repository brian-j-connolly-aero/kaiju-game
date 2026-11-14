/**
 * Off-map call-ins (DESIGN.md section 5). No button calls one any more (docs/ROADMAP.md, phase
 * 1); the mission itself is kept for the artillery radio pick-up of phase 2, which starts one
 * with `startCallIn` (sim/systems/weapons.ts). `cooldown` is what the old button waited between
 * two calls of one squad; nothing reads it until then.
 */

import type { CallInId } from './ids';
import type { CallInDef } from './schema';

export const CALLINS: Readonly<Record<CallInId, CallInDef>> = {
  artillery: {
    id: 'artillery',
    delay: 4,
    shells: 8,
    duration: 2,
    scatterRadius: 28,
    // Tuned (docs/BALANCE.md): at 14 / 10 four squads' barrages alone kept a titan staggered.
    damage: 9,
    nerve: 5,
    splashRadius: 14,
    structureDamage: 300,
    cooldown: 35,
    projectile: 'arty',
    spawnHeight: 400,
  },
};

export function callInDef(id: CallInId): CallInDef {
  return CALLINS[id];
}
