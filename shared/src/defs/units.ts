/** Unit types (DESIGN.md section 5, the Army table). */

import { DEG } from '../math/angle';
import type { UnitTypeId } from './ids';
import type { UnitTypeDef } from './schema';

export const UNIT_TYPES: Readonly<Record<UnitTypeId, UnitTypeDef>> = {
  army_rocket_infantry: {
    id: 'army_rocket_infantry',
    faction: 'army',
    level: 1,
    name: 'Rocket infantry section',
    body: 'infantry',
    members: 10,
    hp: 100,
    speed: 6.5,
    accel: 40,
    radius: 3,
    height: 2,
    steer: 'free',
    turnRate: 720 * DEG,
    eyeHeight: 1.7,
    muzzleHeight: 1.5,
    weapon: 'army_rocket_launchers',
    grabbable: false,
    visual: { kind: 'sprites', primary: 'soldier_army_rocket', secondary: 'soldier_army_rifle', primaryCount: 3 },
  },
  army_tank: {
    id: 'army_tank',
    faction: 'army',
    level: 2,
    name: 'Tank',
    body: 'vehicle',
    members: 1,
    hp: 100,
    speed: 15,
    accel: 12,
    radius: 4,
    height: 3,
    steer: 'heading',
    turnRate: 110 * DEG,
    eyeHeight: 2.8,
    muzzleHeight: 2.3,
    weapon: 'army_tank_gun',
    grabbable: true,
    visual: { kind: 'model', model: 'army_tank', wreck: 'army_tank_wreck' },
  },
  army_tank_troop: {
    id: 'army_tank_troop',
    faction: 'army',
    level: 3,
    name: 'Tank troop',
    body: 'vehicle',
    members: 3,
    hp: 300,
    speed: 15,
    accel: 12,
    radius: 9,
    height: 3,
    steer: 'heading',
    turnRate: 110 * DEG,
    eyeHeight: 2.8,
    muzzleHeight: 2.3,
    weapon: 'army_troop_guns',
    grabbable: true,
    visual: { kind: 'model', model: 'army_tank', wreck: 'army_tank_wreck' },
  },
};

export function unitTypeDef(id: UnitTypeId): UnitTypeDef {
  return UNIT_TYPES[id];
}

/** Members still standing for a unit at this hp: they are lost one by one as hp drops. */
export function membersForHp(def: UnitTypeDef, hp: number): number {
  if (hp <= 0) return 0;
  return Math.min(def.members, Math.ceil((hp / def.hp) * def.members));
}
