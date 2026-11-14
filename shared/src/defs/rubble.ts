/**
 * Rubble that stays, and buildings that fall over (docs/ROADMAP.md, phase 2; DESIGN.md section
 * 7, "Rubble and falls"). The geometry lives with the city queries (city/spatialIndex.ts), the
 * falls themselves in the city damage system (sim/systems/cityDamage.ts). All starting values.
 */

export const RUBBLE_RULES = {
  /**
   * A structure that collapses where it stands leaves a mound of this share of its height over
   * its own footprint, never taller than `maxHeight` (a pile any taller would stand like a tower
   * of its own). Bridge decks leave none: they fall into the river. A mound blocks shots and
   * sight up to its height; it never blocks a body.
   */
  heightShare: 0.5,
  maxHeight: 40,
  /** Units cross a mound (rubble, or a fallen building) at this share of their speed. The kaiju walks over them. */
  unitSpeedMult: 0.5,
} as const;

export const FALL_RULES = {
  /**
   * A structure at least this many times taller than its footprint is wide (its longer side)
   * may fall over on its side when it collapses, instead of straight down: towers, tall
   * offices, the slender landmarks, the radio masts.
   */
  slenderness: 2.9,
  /** ...this often (drawn with the match's random numbers). */
  chance: 0.5,
  /**
   * Seconds from the collapse until it lies on the ground. It tips over one side of its
   * footprint (the side facing away from the monster, or along whatever hit it last) and lands
   * with its top as far out as it was tall.
   */
  time: 2,
  /** Lying, it is a long mound: as long as it was tall, as wide as its footprint across the fall, and this share of its depth along the fall high. */
  lyingHeightShare: 0.5,
  /** Units under the fallen length when it lands take this share of their full hp, and this much nerve. */
  unitDamage: 0.8,
  unitNerve: 100,
  /** Structures under it take this share of the falling structure's full hp (a big building hits harder). */
  crushShare: 0.5,
  /**
   * Falls in a row at most: a building brought down by a fall may fall over in turn (the same
   * chance), but what that one brings down collapses where it stands.
   */
  maxChain: 2,
} as const;
