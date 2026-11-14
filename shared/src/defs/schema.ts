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
  KaijuMove,
  KaijuPhase,
  Level,
  PerStage,
  ProjectileTypeId,
  StageId,
  TimeOfDay,
  UnitTypeId,
  WeaponId,
  WeaponPickupId,
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
  /** Where the head and the tail are, for the hit volume (sim/kaijuBody.ts). */
  hit: KaijuHitShape;
}

/**
 * The parts of the body that reach out beyond its upright capsule, as capsules (sim/kaijuBody.ts;
 * DESIGN.md section 4, "The hit volume"). Measured on the model (meters). A point is
 * [forward, height]: how far ahead of the body's axis (negative: behind), and how high.
 */
export interface KaijuHitShape {
  /** Head and neck: one capsule from `neck` to `snout`, along the heading the head looks (the aim). */
  neck: readonly [number, number];
  snout: readonly [number, number];
  headRadius: number;
  /** Tail: a capsule between each two points in turn (root first, sloping down to the tip), along the body's facing. */
  tail: ReadonlyArray<readonly [number, number]>;
  /** One radius per tail capsule (one fewer than the points). */
  tailRadii: readonly number[];
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

/**
 * Which button starts a verb (the full rules are in net/input.ts: one move per button, no
 * tap-versus-hold). The starting kit has fixed buttons: Strike (swipe; throw with something in
 * the hand), Grab (grab; eat with something in the hand), Stomp and Molt. A move picked at a
 * molt is a 'slot' verb: it is on the move button of the slot it was put in (`Kaiju.moves`).
 */
export type KaijuButton = 'strike' | 'grab' | 'stomp' | 'molt' | 'slot';

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
  /** True when it lasts for as long as its button is down (the brace); otherwise one press starts it and it runs its course. */
  whileHeld: boolean;
  timing: ActionTiming;
  /** Phase the state machine shows while `timing.active` runs. */
  activePhase: KaijuPhase;
  /** Phase shown while `timing.recover` runs; 'recover' when left out (the charge ends in a 'stumble'). */
  recoverPhase?: KaijuPhase;
  /** Seconds before the action can be used again, counted from when it starts (the charge: from the end of its stumble). */
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
  /**
   * Seconds every unit it reaches is stunned: it cannot move or fire and does not answer its
   * controls. Its shaking (from `unitNerve`) starts when the stun is over.
   */
  stunTime: number;
}

/**
 * A lumbering charge (DESIGN.md section 4): a wind-up in which it is rooted but can turn, a run
 * straight ahead (the active phase, 'charge') that it steers only slowly and can end early with
 * another press, and a stumble (the recovery, 'stumble') in which it can do nothing.
 */
export interface ChargeActionDef extends KaijuActionBase {
  id: 'charge';
  /** Turn rate multiplier during the wind-up (`moveMult` roots it then, and in the stumble). */
  windupTurnMult: number;
  /** The run: top speed as a multiple of the walking top speed, reached in `rampTime` seconds from a standstill. */
  speedMult: number;
  rampTime: number;
  /** Turn rate multiplier during the run. */
  runTurnMult: number;
  /** The run smashes structures up to this tall; a taller one stops it at once, unless the body wades through it. */
  smashHeight: PerStage<number>;
  /** Units it runs into, each once per charge: damage, nerve, and how far they are thrown aside (body radii). */
  unitDamage: number;
  unitNerve: number;
  throwAside: number;
}

/** A quick sweep of the tail over the rear half (DESIGN.md section 4). */
export interface TailSweepActionDef extends KaijuActionBase {
  id: 'tailSweep';
  /** Full opening angle of the arc, centered behind the body. */
  arc: number;
  /** Reach behind the body's axis, in body radii. */
  reach: number;
  unitDamage: number;
  unitNerve: number;
  /** How far a unit is knocked outward, in body radii, at the body (half that at the end of the reach). */
  knockback: number;
  structureDamage: PerStage<number>;
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
  /**
   * How hard the breath is to hold (radians, all optional, 0 when left out). While it burns,
   * the beam shakes about where the head is steered (`wobbleYaw` / `wobblePitch`: the largest
   * sideways and up-and-down shake, reached by the end), pulls to one side (`driftYaw` by the
   * end) and kicks upward (`kickPitch` by the end). The player steers against it.
   */
  wobbleYaw?: number;
  wobblePitch?: number;
  driftYaw?: number;
  kickPitch?: number;
}

export type KaijuSpecialDef = BeamSpecialDef;

/** Starts the cocoon: one press of Molt while a molt is offered. */
export interface MoltActionDef extends KaijuActionBase {
  id: 'molt';
}

/**
 * Strike with a fast-food sign in the hand (DESIGN.md section 4, "The city as a weapon"): a big
 * swing over a wide arc instead of a throw. The sign breaks after `swings` swings.
 */
export interface ClubActionDef extends KaijuActionBase {
  id: 'club';
  /** Full opening angle of the arc, centered on where the head looks. */
  arc: number;
  /** Reach, in body radii. */
  reach: number;
  unitDamage: number;
  unitNerve: number;
  /** How far a unit is knocked outward, in body radii, at the body (half that at the end of the reach). */
  knockback: number;
  structureDamage: PerStage<number>;
  /** Swings one sign lasts. */
  swings: number;
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
  | MoltActionDef
  | ChargeActionDef
  | TailSweepActionDef
  | ClubActionDef;

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
  charge: ChargeActionDef;
  tailSweep: TailSweepActionDef;
  club: ClubActionDef;
}

// ---------------------------------------------------------------------------------------------
// The city as a weapon, and the special buildings' rewards (docs/ROADMAP.md phase 2)
// ---------------------------------------------------------------------------------------------

/**
 * A burst round a point: a propane tank going off, a water tank bursting, the gas station's
 * fireball. Units inside take damage and nerve falling linearly from the center to the rim
 * (measured to their near edge) and are pushed outward; structures inside take damage.
 */
export interface BurstDef {
  radius: number;
  unitDamageCenter: number;
  unitDamageEdge: number;
  unitNerveCenter: number;
  unitNerveEdge: number;
  /** Meters a unit is thrown outward at the center, and at the rim. */
  pushCenter: number;
  pushEdge: number;
  /** Seconds a unit inside lies knocked over (it cannot move or fire, as stunned); 0 for none. */
  knockdown: number;
  /** Damage to every standing structure the burst reaches; 0 for none. */
  structureDamage: number;
  /** Whether the props it reaches are destroyed (a fire does it, water does not). */
  props: boolean;
  /** Raw damage to a kaiju inside (through the usual multipliers; a thrown one never hurts its thrower); 0 for none. */
  kaijuDamage: number;
}

/** A thrown object that bursts where it lands (the propane tank, the water tank). */
export interface ThrownBurstDef extends BurstDef {
  /** Launch speed: it flies the throw's arc at this speed, aimed like any throw. */
  speed: number;
}

/** The propane tank: thrown, set off on the ground or in the hand by a shot or explosion, or crushed. */
export interface PropaneDef extends ThrownBurstDef {
  /** Going off in the kaiju's hand: hp it loses (exactly, no multiplier), and seconds it flinches (rooted, its action cut short). */
  handDamage: number;
  flinch: number;
  /** Crushed underfoot or struck rather than set off by fire: a small bang. */
  small: BurstDef;
}

/** A thrown javelin (the antenna, the mast): straight and fast, through units, into the first wall. */
export interface JavelinDef {
  speed: number;
  /** Downward acceleration while it flies (almost none: it flies straight). */
  gravity: number;
  /** It gives out after this many meters. */
  range: number;
  /** Units it goes through, each hit once; then it flies on past the rest. */
  pierce: number;
  unitDamage: number;
  unitNerve: number;
  /** A unit it goes through is thrown this far along its flight (meters). */
  push: number;
  /** Damage to the structure it stops in, and to a kaiju it stops in (raw). */
  structureDamage: number;
  kaijuDamage: number;
}

/** The garage door: a shield in the hand, a frisbee when thrown. */
export interface ShieldDef {
  /** Hp of the door: what it takes (raw hit damage) before it breaks. */
  hp: number;
  /** Hits arriving within this angle of the body's facing hit the door instead of the kaiju. */
  halfArc: number;
  /** Thrown (Strike): flat and spinning, knocking over what it hits. */
  throw: ThrownBurstDef & {
    /** Downward acceleration while it flies (a frisbee floats), and how far it flies. */
    gravity: number;
    range: number;
  };
}

/** What the hand can do with the city (DESIGN.md section 4, "The city as a weapon"). */
export interface KaijuCityWeapons {
  /** City weapons can be picked up at this stage and below; at later stages they are crushed underfoot like any small prop. */
  grabStage: StageId;
  /** A shot or explosion landing within this distance of a propane tank (on the ground or in the hand) sets it off. */
  detonateRadius: number;
  propane: PropaneDef;
  watertank: ThrownBurstDef;
  antenna: JavelinDef;
  mast: JavelinDef;
  garagedoor: ShieldDef;
}

/** What wrecking each special building pays (DESIGN.md section 7, "Special buildings"), once. */
export interface KaijuSpecialRewards {
  /** The power substation: a power surge for the kaiju. */
  surge: {
    /** Seconds it lasts. */
    duration: number;
    /** Every cooldown is cleared when it starts, and they recover this many times as fast while it lasts. */
    cooldownRate: number;
    /** Its attacks do this many times the damage to units and structures while it lasts. */
    damageMult: number;
    /** Rage it gains at once. */
    rage: number;
  };
  /** The gas station: a fireball sized to the building (it never hurts the kaiju). */
  fireball: BurstDef;
  /**
   * The radio mast: it falls over away from the kaiju (the army's falling buildings,
   * `startStructureFall`, crush what it lands on), and the army's map turns to static.
   */
  radiomast: {
    /** Seconds the humans' map shows static. */
    staticTime: number;
    /** Its top section, this long, comes to lie at the far end as a `mast` the hand can pick up. */
    topLength: number;
  };
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
  /**
   * Molt cards (DESIGN.md section 4): the three moves the first molt offers, in card order; the
   * second molt offers the two of those not taken, and beside them one of `second`, drawn with
   * the match's random numbers when the offer is made.
   */
  cards: { first: readonly KaijuMove[]; second: readonly KaijuMove[] };
  /** Swimming, the hide-and-travel mode in deep water; absent for a kind that cannot swim. */
  swim?: KaijuSwimDef;
  /** The city as a weapon: what each object the hand can pick up does (phase 2). */
  cityWeapons: KaijuCityWeapons;
  /** What wrecking a special building pays (phase 2). */
  rewards: KaijuSpecialRewards;
}

/**
 * Swimming (DESIGN.md section 4, "Swimming"). It is automatic: a kaiju that stands idle in water
 * deep enough goes under; any action button brings it up. Under, only its spines show: it is
 * harder to see and to hit, it travels fast, and it cannot act.
 */
export interface KaijuSwimDef {
  /** Per stage: whether the body can go under at all (the titan is too big for any water). */
  stages: PerStage<boolean>;
  /**
   * Per stage: water is deep enough where it reaches this many body radii out from the center,
   * all round. Less than 1: the sides of the body may brush the banks of a narrow channel.
   */
  fitRadii: PerStage<number>;
  /** Seconds to go all the way under, and to come all the way up. */
  diveTime: number;
  surfaceTime: number;
  /** Seconds after its last action (or button) before it goes under again. */
  settleTime: number;
  /** Top speed while under, as a multiple of the stage's top speed on land (no water slowdown). */
  speedMult: number;
  turnMult: number;
  /** What shows above the water while under: the spines' height (body heights) and their spread (body radii). This is the hit volume. */
  exposedHeight: number;
  exposedRadius: number;
  /** While under, squads see it only within this share of their usual sight and spotting distances. */
  sightMult: number;
}

// ---------------------------------------------------------------------------------------------
// Humans: factions, units, weapons, projectiles, call-ins
// ---------------------------------------------------------------------------------------------

export interface FactionLevelDef {
  level: Level;
  unitType: UnitTypeId;
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
 * - heading: the body turns toward where it wants to go and drives along its heading (vehicles
 *   under the squad's own steering: the sub-units).
 * - free: moves in any direction at once and faces where it moves (infantry).
 * - tank: driven by hand (the player's own vehicle, `UnitTypeDef.drive`): the stick's forward
 *   axis is the throttle along the hull, its side axis turns the hull, and the turret swings
 *   toward the aim at its own rate.
 */
export type SteerModel = 'aim' | 'heading' | 'free' | 'tank';

/** How the player's own vehicle handles: real tank driving (docs/ROADMAP.md, phase 1). */
export interface TankDriveDef {
  /** Hull turn at full stick, radians per second. The hull turns on the spot when it is not moving. */
  turnRate: number;
  /** How fast the turret swings toward the aim, radians per second. */
  turretRate: number;
  /** Speeding up, and slowing down (or stopping to reverse), along the hull, meters per second squared. */
  accel: number;
  brake: number;
  /** Top speed in reverse, as a share of the top speed. */
  reverseMult: number;
}

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
  /** How sub-units steer (and the driven unit too, when there is no `drive`). */
  steer: SteerModel;
  /** Radians per second (ignored by 'free' steering). */
  turnRate: number;
  /** Vehicles: the driven unit handles like a tank ('tank' steering) with these numbers. */
  drive?: TankDriveDef;
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
  /** One-sigma spread on every shot, a person's own included (the machine gun pick-up), radians. Absent: none. */
  spread?: number;
  /**
   * A guided salvo (the missile pod pick-up): the projectiles leave fanned out over `fan`
   * radians of heading and `loft` radians above the line to the aim point, and curve onto it.
   * Absent: shots go straight.
   */
  fan?: number;
  loft?: number;
}

/**
 * An army pick-up that replaces the driven unit's own weapon until the stage ends (docs/ROADMAP.md,
 * phase 2; defs/pickups.ts). It is a change to the weapon the unit already has, so it scales with
 * the stage the way that weapon does (`pickupWeaponDef`).
 */
export interface PickupWeaponDef {
  id: WeaponPickupId;
  projectile: ProjectileTypeId;
  /** The weapon's reload times this; or, when `reload` is given, that many seconds whatever the weapon. */
  cooldownMult: number;
  reload?: number;
  /** Per projectile, times the weapon's own. */
  damageMult: number;
  nerveMult: number;
  structureMult: number;
  splashMult: number;
  /**
   * Projectiles per trigger pull at full strength; 0 keeps the weapon's own. When set (the
   * missile pod), damage, nerve and structure damage per projectile are the multipliers times the
   * weapon's whole trigger pull (all its projectiles), and a unit that has lost members fires
   * fewer of them in the same proportion as it would its own weapon.
   */
  salvo: number;
  /** See WeaponDef: `spread` on every shot; `fan` and `loft` make a guided salvo. */
  spread: number;
  fan: number;
  loft: number;
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
  projectile: ProjectileTypeId;
  /** Height above the ground at which the falling shells appear. */
  spawnHeight: number;
}
