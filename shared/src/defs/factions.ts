/**
 * Faction registry. Tier 1 registers the Army; Air, Super Science and the Coalition of Faiths
 * (ids 'air', 'science', 'faith') are added in Tier 2 by registering a FactionDef here plus
 * their unit types, weapons and call-ins.
 */

import type { FactionId, StageId } from './ids';
import { perStage } from './ids';
import type { FactionDef, FactionLevelDef } from './schema';

export const ARMY: FactionDef = {
  id: 'army',
  name: 'Army',
  levels: [
    { level: 1, unitType: 'army_rocket_infantry', callIns: [] },
    { level: 2, unitType: 'army_tank', callIns: [] },
    { level: 3, unitType: 'army_tank_troop', callIns: ['artillery'] },
  ],
};

export const FACTIONS: Readonly<Partial<Record<FactionId, FactionDef>>> = {
  army: ARMY,
};

/** Factions that can be picked today. */
export const PLAYABLE_FACTIONS: readonly FactionId[] = ['army'];

export const DEFAULT_FACTION: FactionId = 'army';

export function factionDef(id: FactionId): FactionDef {
  const def = FACTIONS[id];
  if (!def) throw new Error(`faction "${id}" is not registered`);
  return def;
}

/** What a faction fields at a stage (human level always equals the stage). */
export function factionLevelDef(id: FactionId, stage: StageId): FactionLevelDef {
  return perStage(factionDef(id).levels, stage);
}
