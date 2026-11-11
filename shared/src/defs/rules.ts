/**
 * Match flow and combat numbers that are the same for every kaiju kind and every faction
 * (DESIGN.md sections 2, 3 and 5). All starting values; tune here, never in the systems.
 */

import { DEG } from '../math/angle';
import type { PerStage } from './ids';

export const TICK_RATE = 30;
/** Fixed simulation step, seconds. */
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 15;
/** Simulation ticks between snapshots. */
export const SNAPSHOT_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;

export const MATCH_RULES = {
  /** Players in a room: 1 kaiju + up to 4 human squads. */
  maxPlayers: 5,
  squadsPerKaiju: 4,
  unitsPerSquad: 4,

  /** Seconds on the clock; it runs only while the phase is 'playing' (including the cocoon). */
  clock: 720,
  briefing: 10,
  /** Intermission without drafts (Tier 1) and with drafts (Tier 2). */
  intermission: 8,
  intermissionWithDraft: 20,

  /** Seconds the Molt input must be held is in the kaiju's molt action; this is the cocoon. */
  cocoon: 10,
  /** Blast wave radii, in multiples of the NEW body radius. */
  blastKillRadius: 3.5,
  blastShoveRadius: 7,
  /** Squads redeploy at least this far from the kaiju. */
  redeployMinKaijuDist: 250,

  /** Destruction bar marks: P1 = p1 * V(stage 1), P2 = max(growth * P1, p2 * V(stage 2)), ... */
  bar: {
    p1: 0.35,
    p2: 0.3,
    p3: 0.3,
    growth: 1.6,
    /** Where the three marks sit along the skyline display, 0..1. */
    display: [0.21, 0.57, 1] as PerStage<number>,
  },

  /** Structure hp fractions at or below which it shows as damaged (stage 1) and heavily damaged (stage 2). */
  structureDamagedAt: 0.66,
  structureHeavyAt: 0.33,

  /** Stage 1 only: the humans' map shows the kaiju while a unit has line of sight within this range... */
  revealSightRange: 250,
  /** ...and for this long after it roars, stomps or wrecks something. */
  revealAfterNoise: 3,

  /** The kaiju role is not given to the same player twice in a row unless they volunteer. */
  rotateKaijuRole: true,
} as const;

export const COMBAT_RULES = {
  /** A hit from a direction at least this far from another unit's recent hit is crossfire. */
  crossfireMinAngle: 60 * DEG,
  crossfireWindow: 2.5,
  crossfireNerveMult: 1.75,
  /** Nerve multiplier for fire-at-will hits from sub-units and bots. */
  atWillNerveMult: 0.5,
  /** Speed lost at full accumulated nerve damage ("scattered fire only slows it"). */
  nerveSlowMax: 0.3,
  staggerDuration: 5,
  /** After a stagger ends the kaiju cannot take nerve damage for this long. */
  staggerNerveImmunity: 6,
  /** Tier 2: immunity to freeze and trip after either ends. */
  freezeTripImmunity: 6,

  /** Human units. */
  unitNerveCapacity: 100,
  unitNerveLeak: 8,
  shakenDuration: 4,
  /** Nerve damage to units near a friendly unit that is destroyed. */
  friendlyLossNerve: 15,
  friendlyLossRadius: 40,

  /** Volleys: sub-units on hold build charge 0..1 over chargeTime and lock to this firing arc. */
  chargeTime: 6,
  chargeHalfArc: 35 * DEG,
  /** Volley damage is multiplied by (1 + volleyDamagePerCharge * charge), nerve likewise. */
  volleyDamagePerCharge: 1,
  volleyNervePerCharge: 2,

  /** Scatter multipliers on aim error and artillery scatter. */
  scatterSlowedMult: 0.6,
  scatterSpottedMult: 0.7,
  /** A target is spotted when a player-driven unit has line of sight within this range. */
  spotRange: 150,
  /** Veteran sub-units: aim error multiplier. */
  veteranAimErrorMult: 0.7,

  /** Rage 0..rageMax. Gains 1 per `rageDamagePerPoint` hp of post-multiplier damage taken... */
  rageMax: 100,
  rageDamagePerPoint: 12,
  /** ...and this much for filling one whole stage segment of the destruction bar. */
  ragePerBarSegment: 150,

  /** Downward acceleration of thrown objects and falling shells, m/s^2. */
  gravity: 9.8,
} as const;
