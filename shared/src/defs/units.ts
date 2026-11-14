/** Unit types (DESIGN.md section 5, the Army table). */

import { DEG } from '../math/angle';
import type { UnitTypeId } from './ids';
import type { TankDriveDef, UnitTypeDef } from './schema';

/**
 * How the player's own tank handles at stages 2 and 3 (docs/ROADMAP.md, phase 1): W and S are
 * the throttle along the hull, A and D turn the hull (on the spot when it stands still), and the
 * turret swings toward the mouse at its own pace. A troop of three is the heavier of the two.
 * Sub-units keep their own steering (`steer: 'heading'`, `turnRate`, `accel`).
 */
const TANK_DRIVE: TankDriveDef = { turnRate: 75 * DEG, turretRate: 140 * DEG, accel: 10, brake: 16, reverseMult: 0.5 };
const TROOP_DRIVE: TankDriveDef = { turnRate: 55 * DEG, turretRate: 110 * DEG, accel: 10, brake: 16, reverseMult: 0.5 };

/**
 * Top speeds follow the owner's rule (docs/ROADMAP.md): the army is 10 to 20% faster than the
 * kaiju at every stage, so that a squad can always get away while the kaiju can still throw
 * things at it. Each level is about 1.15 times the kaiju's top speed at its stage (8.5, 14 and
 * 22 m/s); `shared/test/defs.test.ts` holds every level between 1.1 and 1.2 times.
 */
export const UNIT_TYPES: Readonly<Record<UnitTypeId, UnitTypeDef>> = {
  army_rocket_infantry: {
    id: 'army_rocket_infantry',
    faction: 'army',
    level: 1,
    name: 'Rocket infantry section',
    body: 'infantry',
    members: 10,
    hp: 100,
    speed: 9.8,
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
    speed: 16.1,
    accel: 12,
    radius: 4,
    height: 3,
    steer: 'heading',
    turnRate: 110 * DEG,
    drive: TANK_DRIVE,
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
    speed: 25.3,
    accel: 12,
    radius: 9,
    height: 3,
    steer: 'heading',
    turnRate: 110 * DEG,
    drive: TROOP_DRIVE,
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
