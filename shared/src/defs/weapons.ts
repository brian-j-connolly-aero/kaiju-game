/** Weapons and projectile types (DESIGN.md section 5, the Army table). */

import { DEG } from '../math/angle';
import type { ProjectileTypeId, WeaponId } from './ids';
import { COMBAT_RULES } from './rules';
import type { ProjectileTypeDef, WeaponDef } from './schema';

export const PROJECTILE_TYPES: Readonly<Record<ProjectileTypeId, ProjectileTypeDef>> = {
  rocket: { id: 'rocket', flight: 'flat', speed: 55, gravity: 0, radius: 0.4, ttl: 7, model: 'proj_rocket' },
  shell: { id: 'shell', flight: 'flat', speed: 110, gravity: 0, radius: 0.4, ttl: 9, model: 'proj_shell' },
  arty: {
    id: 'arty',
    flight: 'arc',
    speed: 90,
    gravity: COMBAT_RULES.gravity,
    radius: 0.6,
    ttl: 12,
    model: 'proj_arty',
  },
  // Speed comes from the kaiju's throw action; the model is whatever was thrown.
  thrown: { id: 'thrown', flight: 'thrown', speed: 0, gravity: COMBAT_RULES.gravity, radius: 1, ttl: 20, model: null },
  // The pick-up weapons (defs/pickups.ts). Tracers are drawn as glowing streaks (no model).
  tracer: { id: 'tracer', flight: 'flat', speed: 140, gravity: 0, radius: 0.3, ttl: 6, model: null },
  missile: { id: 'missile', flight: 'guided', speed: 75, gravity: 0, radius: 0.4, ttl: 9, model: 'proj_rocket' },
  heavyShell: { id: 'heavyShell', flight: 'flat', speed: 120, gravity: 0, radius: 0.6, ttl: 9, model: 'proj_shell' },
};

/**
 * Nerve and structure damage are tuned with the balance harness (docs/BALANCE.md). Nerve, levels
 * 1 and 2: one squad's full-charge volley stays under the kaiju's nerve capacity from any side
 * and even as a one-player crossfire (54 from the front, 92 from behind or crossed). Level 3 is
 * counted per tank, the way a player sees it: each tank of a troop is worth nearly what a level 2
 * tank is, so a charged volley of about ten tanks breaks the titan from the front (docs/STATUS.md,
 * "Polish pass: the monster's combat feel"). One squad still never breaks it alone in a match where another squad is left:
 * that is the two-squad rule in the damage system.
 * Structure damage: a stray projectile dents a building rather than flattening it, so misses
 * cost the humans the bar without filling it for the kaiju.
 */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  army_rocket_launchers: {
    id: 'army_rocket_launchers',
    projectile: 'rocket',
    maxShots: 3,
    membersPerShot: 3.4,
    damage: 3.2,
    nerve: 1.8,
    range: 160,
    cooldown: 2.6,
    splashRadius: 3,
    structureDamage: 3,
    aimErrorAtWill: 3.5 * DEG,
    aimErrorVolley: 1.2 * DEG,
  },
  army_tank_gun: {
    id: 'army_tank_gun',
    projectile: 'shell',
    maxShots: 1,
    membersPerShot: 1,
    damage: 9.5,
    nerve: 5.4,
    range: 420,
    cooldown: 3.2,
    splashRadius: 5,
    structureDamage: 25,
    aimErrorAtWill: 2.5 * DEG,
    aimErrorVolley: 0.9 * DEG,
  },
  army_troop_guns: {
    id: 'army_troop_guns',
    projectile: 'shell',
    maxShots: 3,
    membersPerShot: 1,
    damage: 3.2,
    nerve: 4.5,
    range: 600,
    cooldown: 3.2,
    splashRadius: 5,
    structureDamage: 25,
    aimErrorAtWill: 2.5 * DEG,
    aimErrorVolley: 0.9 * DEG,
  },
};

export function weaponDef(id: WeaponId): WeaponDef {
  return WEAPONS[id];
}

export function projectileTypeDef(id: ProjectileTypeId): ProjectileTypeDef {
  return PROJECTILE_TYPES[id];
}

/** Projectiles one trigger pull fires for a unit with this many members left. */
export function shotsForMembers(weapon: WeaponDef, members: number): number {
  if (members <= 0) return 0;
  return Math.min(weapon.maxShots, Math.ceil(members / weapon.membersPerShot));
}
