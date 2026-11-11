/** Off-map call-ins (DESIGN.md section 5). */

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
