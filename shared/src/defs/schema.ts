/**
 * Definition schemas: the shape of every piece of tunable data. The data itself lives in the
 * sibling files (stages.ts, rules.ts, kaiju/, factions.ts, units.ts, weapons.ts, callins.ts,
 * upgrades.ts). Systems read these definitions and the `mods` tables; they never hardcode a
 * kaiju kind, a faction or a number.
 *
 * Units: meters, seconds, radians (write degrees as `n * DEG`), hit points.
 */

import type {
  CallInId,
  FactionId,
  FlightModel,
  KaijuKindId,
  KaijuPhase,
  Level,
  PerStage,
  ProjectileTypeId,
  StageId,
  TimeOfDay,
  UnitTypeId,
  WeaponId,
} from './ids';

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------

export interface StageDef {
  id: StageId;
  /** Internal name; never shown as text in the game. */
  key: 'hatchling' | 'juvenile' | 'titan';
  /** Half the side of the square playable bounds, meters. */
  boundsHalfSize: number;
  humanLevel: Level;
  timeOfDay: TimeOfDay;
  /** Multiplier on aim error and artillery scatter: a bigger kaiju is easier to hit. */
  scatterMult: number;
  /** Whether the humans' map always shows the kaiju (false at stage 1: it must be spotted). */
  kaijuAlwaysKnown: boolean;
}

// ---------------------------------------------------------------------------------------------
// Modifier tables and upgrades (Tier 2 content; the schema exists so systems read mods now)
// ---------------------------------------------------------------------------------------------

/** Multipliers an upgrade can apply. A missing key means 1. */
export const MOD_MULT_KEYS = [
  'maxHp',
  'damageTaken',
  'nerveTaken',
  'speed',
  'turnRate',
  'unitDamage',
  'structureDamage',
  'nerveDamage',
  'aimError',
  'weaponCooldown',
  'weaponRange',
  'chargeTime',
  'callInCooldown',
  'actionCooldown',
  'rageGain',
  'heal',
  'roarRadius',
  'barPoints',
] as const;
export type ModMultKey = (typeof MOD_MULT_KEYS)[number];

/** Rule switches an upgrade can turn on (the examples from DESIGN.md section 6). */
export const MOD_FLAGS = [
  'magneticHide',
  'tailClub',
  'stubbyWings',
  'acidSpit',
  'towCables',
  'decoy',
  'insuranceRider',
] as const;
export type ModFlag = (typeof MOD_FLAGS)[number];

/** The modifier table carried by every kaiju and every squad. Plain data. */
export interface Mods {
  mult: Partial<Record<ModMultKey, number>>;
  flags: ModFlag[];
}

export type UpgradeScope =
  | { kind: 'general' }
  | { kind: 'kaiju'; kaiju: KaijuKindId }
  | { kind: 'faction'; faction: FactionId };

export interface UpgradeDef {
  id: string;
  side: 'kaiju' | 'human';
  scope: UpgradeScope;
  /** Folded into the owner's mods when drafted. */
  mods: Mods;
  /** Id of the looping card animation and of the model attachment that shows the pick. */
  visual: string;
}

// ---------------------------------------------------------------------------------------------
// Kaiju
// ---------------------------------------------------------------------------------------------

/** Per-stage body numbers of one kaiju kind (DESIGN.md section 2, the stages table). */
export interface KaijuStageDef {
  height: number;
  bodyRadius: number;
  topSpeed: number;
  /** Radians per second. */
  turnRate: number;
  /** Meters per second squared, for both speeding up and stopping. */
  accel: number;
  /** Structures up to this tall are walked through and destroyed. */
  trampleHeight: number;
  /** True when taller structures never block: the kaiju wades through them. */
  wadesTall: boolean;
  /** Speed multiplier while wading through a taller structure. */
  wadeSpeedMult: number;
  /** Damage per second to each taller structure the body touches while wading. */
  wadeContactDps: number;
  /** Speed multiplier while standing in water (the river is shallow; a titan ignores it). */
  waterSpeedMult: number;
  /**
   * The eye, where the aim ray starts and the first-person camera sits: its height, and how far
   * ahead of the body's axis it is along the aim heading. From the model's `cam_fp` anchor.
   */
  eyeHeight: number;
  eyeForward: number;
  /** The mouth, where the beam starts: height and distance ahead of the body's axis along the aim heading. From the model's `mouth` anchor. */
  mouthHeight: number;
  mouthForward: number;
  /** Height at which a held object is carried and from which it is thrown. */
  handHeight: number;
}

/** How a kaiju kind takes damage (DESIGN.md section 3). */
export interface KaijuDamageProfile {
  /** Damage multiplier in normal states. */
  normalMult: number;
  /** Damage multiplier for hits on the braced front arc. */
  braceFrontMult: number;
  /** Damage multiplier while staggered or cocooned. */
  helplessMult: number;
  /** Nerve multiplier for hits on the braced front arc. */
  braceNerveMult: number;
  /** Half the width of the braced front arc. */
  braceHalfArc: number;
  /** Hits within this angle of the facing are "front". */
  frontHalfAngle: number;
  /** Hits more than this angle off the facing are "rear"; between the two is "flank". */
  rearAngle: number;
  /** Damage and nerve multipliers by facing. */
  frontMult: number;
  flankMult: number;
  rearMult: number;
}

/** Which input drives a verb. */
export type KaijuButton = 'strike' | 'grab' | 'block' | 'roar' | 'special' | 'molt';

/**
 * How the button is read (the full tap and hold rules are in net/input.ts):
 * - tap: starts on press; it is the action unless the hold partner takes over.
 * - hold: takes over once the button has been down for `holdTime`.
 * - press: starts on the press edge.
 * - level: runs for as long as the button is down.
 */
export type Gesture = 'tap' | 'hold' | 'press' | 'level';

export interface ActionTiming {
  /** The tell: time from the start until the effect begins. */
  windup: number;
  /** How long the effect lasts (0 for an instant effect at the end of the wind-up). */
  active: number;
  /** Time after the effect before the kaiju can act again. */
  recover: number;
}

interface KaijuActionBase {
  button: KaijuButton;
  gesture: Gesture;
  /** Seconds the button must be held for a hold gesture; 0 otherwise. */
  holdTime: number;
  timing: ActionTiming;
  /** Phase the state machine shows while `timing.active` runs. */
  activePhase: KaijuPhase;
  /** Seconds before the action can be used again, counted from when it starts. */
  cooldown: number;
  rageCost: number;
  /** Movement speed multiplier for the whole action; 0 means rooted. */
  moveMult: number;
  /** Turn rate multiplier for the whole action. */
  turnMult: number;
}

/** Melee arc in front of the kaiju. */
export interface SwipeActionDef extends KaijuActionBase {
  id: 'swipe';
  /** Full opening angle of the arc. */
  arc: number;
  /** Reach, in body radii. */
  reach: number;
  unitDamage: number;
  unitNerve: number;
  structureDamage: PerStage<number>;
}

/** Shockwave around the kaiju. Values fall off linearly from the center to the edge. */
export interface StompActionDef extends KaijuActionBase {
  id: 'stomp';
  /** Shockwave radius, in body radii. */
  radius: number;
  unitDamageCenter: number;
  unitDamageEdge: number;
  unitNerveCenter: number;
  unitNerveEdge: number;
  /** How far a unit at the center is shoved, in body radii; falls off to 0 at the edge. */
  knockback: number;
  structureDamage: PerStage<number>;
  /** Fraction of the structure damage that still lands at the edge of the shockwave. */
  structureEdgeFraction: number;
}

/** Picks up the nearest grabbable thing in an arc. */
export interface GrabActionDef extends KaijuActionBase {
  id: 'grab';
  arc: number;
  /** Reach, in body radii. */
  reach: number;
  /** First stage at which a live vehicle can be grabbed. */
  vehicleFromStage: StageId;
  /** First stage at which a chunk can be torn from a building. */
  chunkFromStage: StageId;
  /** Structure damage dealt to a building when a chunk is torn out of it. */
  chunkStructureDamage: PerStage<number>;
}

/** Throws the held object at the aim point on a ballistic path. */
export interface ThrowActionDef extends KaijuActionBase {
  id: 'throw';
  speed: PerStage<number>;
  unitDamage: number;
  unitNerve: number;
  /** Radius within which units take the impact damage. */
  impactRadius: PerStage<number>;
  structureDamage: PerStage<number>;
}

/** Eats the held object or an edible thing in reach. */
export interface EatActionDef extends KaijuActionBase {
  id: 'eat';
  heal: number;
  /** Reach for edibles on the ground, in body radii. */
  reach: number;
}

/** Braces against a volley. The reductions live in KaijuDamageProfile. */
export interface BraceActionDef extends KaijuActionBase {
  id: 'brace';
}

export interface RoarActionDef extends KaijuActionBase {
  id: 'roar';
  radius: PerStage<number>;
  unitNerve: number;
  /** A roar always clears the volley charge of units it reaches. */
  resetsCharge: boolean;
}

/** The Lizard's special. Other kinds add their own member to KaijuSpecialDef. */
export interface BeamSpecialDef extends KaijuActionBase {
  id: 'special';
  special: 'beam';
  range: PerStage<number>;
  width: PerStage<number>;
  unitDps: number;
  unitNervePerSecond: number;
  structureDps: PerStage<number>;
}

export type KaijuSpecialDef = BeamSpecialDef;

/** Starts the cocoon. `holdTime` is how long the Molt input must be held. */
export interface MoltActionDef extends KaijuActionBase {
  id: 'molt';
}

export type KaijuActionDef =
  | SwipeActionDef
  | StompActionDef
  | GrabActionDef
  | ThrowActionDef
  | EatActionDef
  | BraceActionDef
  | RoarActionDef
  | KaijuSpecialDef
  | MoltActionDef;

/** One entry per verb, each with its own precise type. */
export interface KaijuActionSet {
  swipe: SwipeActionDef;
  stomp: StompActionDef;
  grab: GrabActionDef;
  throw: ThrowActionDef;
  eat: EatActionDef;
  brace: BraceActionDef;
  roar: RoarActionDef;
  special: KaijuSpecialDef;
  molt: MoltActionDef;
}

export interface KaijuKindDef {
  id: KaijuKindId;
  /** Proper name shown in the game ("Gragnor"). */
  name: string;
  /** Species word used in docs and file names ("Lizard"). */
  species: string;
  hp: number;
  nerveCapacity: number;
  /** Nerve damage that leaks away per second. */
  nerveLeak: number;
  stages: PerStage<KaijuStageDef>;
  damage: KaijuDamageProfile;
  /** How far the head (the view) can lead the body heading. */
  headLeadMax: number;
  /** Speed multipliers for moving sideways and backward relative to the body. */
  strafeSpeedMult: number;
  reverseSpeedMult: number;
  /** Damage per second to units inside the body radius while the kaiju is moving. */
  trampleDps: number;
  actions: KaijuActionSet;
}

// ---------------------------------------------------------------------------------------------
// Humans: factions, units, weapons, projectiles, call-ins
// ---------------------------------------------------------------------------------------------

export interface FactionLevelDef {
  level: Level;
  unitType: UnitTypeId;
  callIns: readonly CallInId[];
}

export interface FactionDef {
  id: FactionId;
  /** Display name ("Army"). */
  name: string;
  levels: PerStage<FactionLevelDef>;
}

/** How a unit is drawn: a crowd of sprites around the body, or member models. */
export type UnitVisual =
  | { kind: 'sprites'; primary: string; secondary: string; primaryCount: number }
  | { kind: 'model'; model: string; wreck: string };

/**
 * How a body turns (see sim/movement.ts):
 * - aim: the body turns toward the aim heading (kaiju).
 * - heading: the body turns toward where it wants to go and drives along its heading (vehicles).
 * - free: moves in any direction at once and faces where it moves (infantry).
 */
export type SteerModel = 'aim' | 'heading' | 'free';

export interface UnitTypeDef {
  id: UnitTypeId;
  faction: FactionId;
  level: Level;
  /** Display name; used in docs and debug output only. */
  name: string;
  body: 'infantry' | 'vehicle' | 'aircraft';
  /** Soldiers or vehicles drawn for this unit; lost one by one as hp drops. */
  members: number;
  hp: number;
  speed: number;
  accel: number;
  radius: number;
  /** Height of the hit volume. */
  height: number;
  steer: SteerModel;
  /** Radians per second (ignored by 'free' steering). */
  turnRate: number;
  /** Height of the first-person camera and of the aim ray origin. */
  eyeHeight: number;
  /** Height projectiles leave from. */
  muzzleHeight: number;
  weapon: WeaponId;
  /** Whether a kaiju can pick this unit up while it is alive (from GrabActionDef.vehicleFromStage). */
  grabbable: boolean;
  visual: UnitVisual;
}

export interface WeaponDef {
  id: WeaponId;
  projectile: ProjectileTypeId;
  /** Projectiles per trigger pull at full strength. */
  maxShots: number;
  /** Members needed per projectile: shots = min(maxShots, ceil(members / membersPerShot)). */
  membersPerShot: number;
  /** Per projectile. */
  damage: number;
  nerve: number;
  /** A unit only fires at targets within this distance. */
  range: number;
  cooldown: number;
  splashRadius: number;
  /** Damage to a structure the projectile hits (and to structures within the splash). */
  structureDamage: number;
  /** One-sigma aim error of sub-units and bots, radians. The player-driven unit has none. */
  aimErrorAtWill: number;
  aimErrorVolley: number;
}

export interface ProjectileTypeDef {
  id: ProjectileTypeId;
  flight: FlightModel;
  /** Launch speed, meters per second (thrown objects use the kaiju's throw speed instead). */
  speed: number;
  /** Downward acceleration; 0 for flat flight. */
  gravity: number;
  /** Collision radius of the projectile itself. */
  radius: number;
  /** Seconds before an unexploded projectile is removed. */
  ttl: number;
  /** Model id in the asset manifest, or null when the projectile is drawn from its payload. */
  model: string | null;
}

export interface CallInDef {
  id: CallInId;
  /** Seconds from placing the marker to the first impact. */
  delay: number;
  shells: number;
  /** Seconds over which the shells land. */
  duration: number;
  /** Shells land within this distance of the marker (before scatter multipliers). */
  scatterRadius: number;
  damage: number;
  nerve: number;
  splashRadius: number;
  structureDamage: number;
  /** Per player. */
  cooldown: number;
  projectile: ProjectileTypeId;
  /** Height above the ground at which the falling shells appear. */
  spawnHeight: number;
}
