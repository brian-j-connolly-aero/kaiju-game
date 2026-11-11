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

  /**
   * Destruction bar marks: P1 = p1 * V(stage 1), P2 = max(growth * P1, p2 * V(stage 2)), ...
   * Tuned with the balance harness so that a kaiju left alone fills each segment in about two
   * minutes (docs/BALANCE.md).
   */
  bar: {
    p1: 0.13,
    p2: 0.088,
    p3: 0.31,
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
  /** After a stagger ends the kaiju cannot take nerve damage for this long (long enough that it cannot be stun-locked). */
  staggerNerveImmunity: 8,
  /** Tier 2: immunity to freeze and trip after either ends. */
  freezeTripImmunity: 6,
  /** At most one `crossfire` event per kaiju in this many seconds (every crossing hit still gets the multiplier). */
  crossfireEventGap: 1,
  /** A kaiju tramples the units under it only while it moves at least this fast, m/s. */
  trampleMinSpeed: 1,

  /** Human units. */
  unitNerveCapacity: 100,
  unitNerveLeak: 8,
  shakenDuration: 4,
  /** Nerve damage to units near a friendly unit that is destroyed. */
  friendlyLossNerve: 15,
  friendlyLossRadius: 40,
  /** Units standing on a bridge deck when it collapses fall into the river: damage and nerve. */
  bridgeFallDamage: 40,
  bridgeFallNerve: 100,
  /** Continuous damage (beam, trample) reports `unitHit` / `kaijuHit` only every this many ticks. */
  continuousHitEventTicks: 6,

  /** Volleys: sub-units on hold build charge 0..1 over chargeTime and lock to this firing arc. */
  chargeTime: 6,
  chargeHalfArc: 35 * DEG,
  /** Volley damage is multiplied by (1 + volleyDamagePerCharge * charge), nerve likewise. */
  volleyDamagePerCharge: 1,
  volleyNervePerCharge: 2,

  /** Scatter multipliers on aim error and artillery scatter. */
  scatterSlowedMult: 0.6,
  scatterSpottedMult: 0.7,
  /** A kaiju counts as slowed once its accumulated nerve damage is this fraction of its capacity. */
  scatterSlowedNerve: 0.3,
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

/**
 * How squads move, aim and behave (DESIGN.md section 5). The numbers the design gives live in
 * COMBAT_RULES and in the unit, weapon and call-in definitions; these are the ones it leaves
 * to the build. All starting values.
 */
export const SQUAD_RULES = {
  /** Formation: sub-units trail the leader in a staggered column, this far apart beyond two unit radii. */
  formationGap: 2,
  /** Formation: how far each sub-unit sits to the side of the leader's trail, in column spacings. */
  formationStagger: 0.45,
  /** The leader's trail is sampled every this many meters of travel. */
  trailStep: 2,
  /** A sub-unit is in its formation slot within this many of its radii, plus one meter. */
  slotTolerance: 0.5,
  /** A sub-unit that has fallen behind its formation slot moves this much faster until it is back in it. */
  catchUpSpeed: 1.3,
  /** Move-to: a sub-unit holds once it is this close to its hold point. */
  arriveRadius: 1.2,
  /** Sub-units ease off the throttle inside this many seconds of travel from where they are going. */
  arriveSlowTime: 0.6,
  /** Navigation: a blocked sub-unit plans again at most this often, seconds. */
  repathInterval: 1.5,
  /** Navigation: no progress for this long counts as stuck (the unit tries the other way round). Longer than a tank's about-turn. */
  stuckTime: 2.5,
  /** Navigation: how far ahead a sub-unit looks for walls, in its radii (and at least this many meters). */
  probeRadii: 3,
  probeMin: 10,
  /** A shaken sub-unit backs away from a kaiju closer than this many kaiju body radii (and at least this many meters). */
  backOffRadii: 10,
  backOffMin: 60,
  /** How fast a sub-unit swings its weapon round, radians per second; it fires once it is this close to on target. */
  aimTurnRate: 270 * DEG,
  aimFireTolerance: 3 * DEG,
  /** How far the driven unit's aim ray reaches when it lands on nothing. */
  aimRayRange: 1500,
  /** Sub-units aim at these fractions of the kaiju's height, taking the first with a clear line of fire. */
  aimHeights: [0.5, 0.8, 0.25],
  /** Several projectiles of one unit leave from points spread this far apart, in unit radii. */
  muzzleSpread: 0.6,
  /** Call-in shells fall at this angle above the horizon, toward the marker from behind the caller. */
  callInElevation: 75 * DEG,
} as const;
