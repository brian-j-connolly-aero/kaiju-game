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
    damage: 14,
    nerve: 10,
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
