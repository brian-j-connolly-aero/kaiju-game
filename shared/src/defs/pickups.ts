/**
 * Army supply crates and the pick-ups they hold (docs/ROADMAP.md, phase 2; DESIGN.md section 5,
 * "Supply crates and pick-ups"). The rules run in sim/systems/pickups.ts; the pick-up weapons are
 * fired by sim/systems/weapons.ts. All starting values.
 */

import { DEG } from '../math/angle';
import { WEAPON_PICKUP_IDS, type PerStage, type PickupId, type PickupKind, type WeaponPickupId } from './ids';
import type { PickupWeaponDef, WeaponDef } from './schema';

export const CRATE_RULES = {
  /**
   * When a stage starts, one crate comes down for every squad, on a street near its leader. Then
   * one every `every` seconds, for each squad still in the fight in turn, while fewer than
   * `maxDown` (per stage) are coming down or lying about.
   */
  every: 30,
  maxDown: [3, 4, 5] as PerStage<number>,
  /** Seconds a crate takes to come down under its parachute, from this many meters up (straight down, at a steady speed). */
  fallTime: 4,
  dropHeight: 90,
  /**
   * Where a crate comes down: on a street inside the bounds, at least this share of the bounds'
   * half-size from the kaiju, and this many meters (closest, farthest) from the leader of the
   * squad it is meant for (anywhere on a street in the bounds when nothing there will do).
   */
  kaijuClearShare: 1 / 3,
  nearSquad: [25, 90] as readonly [number, number],
  /** A unit takes a landed crate for its squad when it comes within its own radius plus this many meters of it. */
  reach: 1.5,
  /**
   * What a crate holds, drawn with these weights; reinforcements weigh `reinforcePerLost` more
   * for every unit the squad the crate is meant for has lost.
   */
  weights: { machineGun: 3, bigCannon: 3, missilePod: 3, artilleryRadio: 2, reinforcements: 1 } as Readonly<Record<PickupKind, number>>,
  reinforcePerLost: 2,
  /** Reinforcements: the squad's dead units come down by parachute beside the leader, from this many meters up, landing after this many seconds. */
  reinforceHeight: 60,
  reinforceTime: 4,
  /** The artillery radio: this many charged volleys (each the squad's next) call a barrage. */
  barrages: 3,
} as const;

/**
 * The weapon pick-ups. Each changes only the driven unit's own weapon (its Fire button, and its
 * own shot when it goes with a volley), from when it is taken until the stage ends or the squad
 * is wiped out; a new one replaces the old.
 *
 * - Machine gun: five times the rate of fire at a third of the damage, nerve and structure damage
 *   per shot (1.67 times as much over time), with a slight spread, a person's own shots included.
 * - Big cannon: 2.5 times the reload for 3.5 times the damage, twice the nerve, and a wider splash.
 * - Missile pod: a salvo of 6 missiles that fan out and curve onto the aim point, each worth 0.6
 *   of a whole trigger pull of the unit's own weapon; 6 s to reload.
 */
export const PICKUP_WEAPONS: Readonly<Record<WeaponPickupId, PickupWeaponDef>> = {
  machineGun: {
    id: 'machineGun',
    projectile: 'tracer',
    cooldownMult: 0.2,
    damageMult: 1 / 3,
    nerveMult: 1 / 3,
    structureMult: 1 / 3,
    splashMult: 0.3,
    salvo: 0,
    spread: 1.5 * DEG,
    fan: 0,
    loft: 0,
  },
  bigCannon: {
    id: 'bigCannon',
    projectile: 'heavyShell',
    cooldownMult: 2.5,
    damageMult: 3.5,
    nerveMult: 2,
    structureMult: 3.5,
    splashMult: 1.6,
    salvo: 0,
    spread: 0,
    fan: 0,
    loft: 0,
  },
  missilePod: {
    id: 'missilePod',
    projectile: 'missile',
    cooldownMult: 1,
    reload: 6,
    damageMult: 0.6,
    nerveMult: 0.6,
    structureMult: 0.6,
    splashMult: 1,
    salvo: 6,
    spread: 0,
    fan: 50 * DEG,
    loft: 12 * DEG,
  },
};

/** True for the pick-ups that replace the driven unit's own weapon. */
export function isWeaponPickup(id: PickupId): id is WeaponPickupId {
  return (WEAPON_PICKUP_IDS as readonly string[]).includes(id);
}

const derived = new Map<string, WeaponDef>();

/**
 * The weapon a unit fires with a pick-up: its own weapon changed by the pick-up, so that it
 * scales with the stage (rocket infantry, a tank, a troop of three) the way the weapon does. With
 * no weapon pick-up it is the weapon itself.
 */
export function pickupWeaponDef(base: WeaponDef, pickup: PickupId): WeaponDef {
  if (!isWeaponPickup(pickup)) return base;
  const key = `${base.id}|${pickup}`;
  let def = derived.get(key);
  if (!def) {
    const p = PICKUP_WEAPONS[pickup];
    // A salvo pick-up is worth a share of the weapon's whole trigger pull per projectile.
    const pull = p.salvo > 0 ? base.maxShots : 1;
    def = {
      ...base,
      projectile: p.projectile,
      maxShots: p.salvo > 0 ? p.salvo : base.maxShots,
      membersPerShot: p.salvo > 0 ? (base.membersPerShot * base.maxShots) / p.salvo : base.membersPerShot,
      damage: base.damage * p.damageMult * pull,
      nerve: base.nerve * p.nerveMult * pull,
      structureDamage: base.structureDamage * p.structureMult * pull,
      splashRadius: base.splashRadius * p.splashMult,
      cooldown: p.reload ?? base.cooldown * p.cooldownMult,
      spread: p.spread,
      fan: p.fan,
      loft: p.loft,
    };
    derived.set(key, def);
  }
  return def;
}
