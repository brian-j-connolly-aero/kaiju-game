/**
 * The World: the complete authoritative state of one match (ARCHITECTURE.md section 3).
 *
 * Plain objects and typed arrays only, so it is cheap to snapshot and easy to inspect. Entities
 * refer to each other by small integer ids, never by object reference:
 *   - a kaiju id is its index in `world.kaijus`;
 *   - a squad id is its index in `world.squads`;
 *   - a unit id is its index in `world.units`, and always `squad id * 4 + slot`. Unit ids are
 *     stable for the whole match: at each new stage the same 16 slots are refilled with fresh
 *     units of the new level;
 *   - a player id is its index in `world.players` (and in MatchConfig.players).
 *
 * Times are seconds unless a name ends in `Ticks`. Angles are radians.
 */

import type { CityIndex, CityQuery, FallSide } from '../city/spatialIndex';
import type { CityData, PropKindId } from '../city/types';
import type {
  CallInId,
  DamageKind,
  EndReason,
  FactionId,
  FlightModel,
  KaijuActionId,
  KaijuKindId,
  KaijuMoveId,
  KaijuPhase,
  KaijuVerb,
  Level,
  MatchPhase,
  PerStage,
  PickupKind,
  ProjectileTypeId,
  Role,
  StageId,
  UnitState,
  UnitTypeId,
  WeaponPickupId,
  Winner,
} from '../defs/ids';
import type { Mods } from '../defs/schema';
import type { VoiceCueId } from '../defs/voice';
import type { Bounds } from '../math/geom';
import type { Rng } from '../math/rng';
import type { Vec2 } from '../math/vec';
import type { PlayerInput } from '../net/input';
import type { BotState } from './bots/types';
import type { MatchConfig, PlayerId } from './config';
import type { HeldObject, PlayerTally, ProjectileOwner, SimEvent } from './events';
import type { UnitNav } from './nav';

// ---------------------------------------------------------------------------------------------
// Players and input
// ---------------------------------------------------------------------------------------------

/**
 * A player's input as the simulation sees it this tick: the latest sample plus the button
 * history the action systems need (edges, how long each button has been down). Written by the
 * input system, read by everything after it. Per-button arrays are indexed by BtnIndex.
 */
export interface InputState {
  /** Sequence number of the newest input that has been applied (echoed in snapshots). */
  seq: number;
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  /** Buttons down this tick (Btn bits). */
  buttons: number;
  /** Buttons that went down this tick. */
  pressed: number;
  /** Buttons that went up this tick. */
  released: number;
  /** Per button: ticks it has been down without a break, counting this one; 0 while it is up. */
  heldTicks: number[];
  /** Per button: how many ticks the press that ended most recently lasted (read it on the release tick). */
  lastHeldTicks: number[];
  /** Per button: ticks since it last went down (0 on the press tick); large if never pressed. */
  sincePressTicks: number[];
  /** Kaiju: the molt card picked in this tick's input (1 to 3), 0 for none. One-shot: it does not repeat. */
  card: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Radio callsign of this player's squad; empty for the kaiju player. */
  callsign: string;
  role: Role;
  /** True while a bot drives this slot (a bot slot from the config, or a dropped player). */
  bot: boolean;
  /** Kaiju this player controls, or -1. */
  kaijuId: number;
  /** Squad this player leads, or -1. */
  squadId: number;
  input: InputState;
  /** The input a bot wants applied on the next tick; the bots system writes it. */
  botInput: PlayerInput;
  /** Scratch memory of the bot driving this slot. */
  botState: BotState;
  /**
   * The slot has just been handed back to its player: until their first input arrives the
   * controls are let go (no buttons, no movement) instead of repeating what the bot last pressed.
   */
  handBack: boolean;
  tally: PlayerTally;
}

// ---------------------------------------------------------------------------------------------
// Kaiju
// ---------------------------------------------------------------------------------------------

/** A recent hit on the kaiju, kept for the crossfire rule. */
export interface RecentHit {
  /** Unit that fired it. */
  unit: number;
  /** Heading of the hit's `fromDir`: from the kaiju toward the shooter. */
  yaw: number;
  tick: number;
}

/** A charged volley hit on a kaiju: which squad's, and when. */
export interface VolleyHit {
  squad: number;
  tick: number;
}

/**
 * What the kaiju action system remembers between ticks: which button presses it has already
 * used, and the bookkeeping of the action that is running. Server-side only; never in snapshots.
 */
export interface KaijuActionMemory {
  /** Btn bits whose latest press has already started an action (cleared by the next press). */
  usedPress: number;
  /** The running Eat took a meal (from the hand or off the ground) and will heal when it finishes. */
  meal: boolean;
  /** Beam special: how far the beam reaches this tick, and the structure it is burning through (-1: none). */
  beamLength: number;
  beamBlocker: number;
  /**
   * Beam special: where the player has steered the head (the beam itself shakes about this,
   * see `beamShake`), the tick the steering started (it seeds the shake), and whether it has.
   */
  beamSteering: boolean;
  beamYaw: number;
  beamPitch: number;
  beamSeed: number;
  /** Tick of the last `crossfire` event for this kaiju (they are rate limited). */
  crossfireTick: number;
  /** Btn bits pressed while it was under water: acted on as soon as it is up (sim/swim.ts). */
  swimPress: number;
  /** The Btn bit whose press started the running action (a brace lasts while it is down; a second press ends a charge's run). */
  actionButton: number;
  /** Charge: the units it has run into in this charge (each is hit once). */
  chargeHits: number[];
  /** Charge: a wall it cannot smash (or the bounds) stopped the run; the stumble starts on the next tick. */
  chargeBlocked: boolean;
}

/**
 * Never alone (DESIGN.md section 2): every squad is gone, so the city gives way around the kaiju.
 * The structures nearest it collapse one after another until the bar reaches the stage's mark;
 * then the cocoon starts by itself. Server-side only (clients see the buildings fall).
 */
export interface CityCollapse {
  /** Structures still to bring down, nearest first, and the tick each falls on. */
  ids: number[];
  ticks: number[];
  /** How many have fallen. */
  done: number;
  /** The bar mark it fills to (the current stage's). */
  mark: number;
}

export interface Kaiju {
  entity: 'kaiju';
  id: number;
  /** Controlling player. */
  player: PlayerId;
  kind: KaijuKindId;
  stage: StageId;
  alive: boolean;

  x: number;
  z: number;
  /** Body heading. */
  yaw: number;
  vx: number;
  vz: number;
  /** Body radius and height at the current stage (copied from the kind definition). */
  radius: number;
  height: number;
  /** Where the head looks: the player's aim, kept within the head lead of the body heading. */
  aimYaw: number;
  aimPitch: number;

  hp: number;
  maxHp: number;
  /** Accumulated nerve damage, 0 up to the kind's nerve capacity. */
  nerve: number;
  /** Seconds of nerve immunity left (after a stagger). */
  nerveImmune: number;
  /** 0..COMBAT_RULES.rageMax. */
  rage: number;

  /**
   * Action state machine. `action` is the verb that is running; it is 'none' while the kaiju is
   * idle, staggered or dead (a cocoon is the 'molt' verb in phase 'cocoon').
   */
  phase: KaijuPhase;
  action: KaijuActionId;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /** Length of the current phase; 0 when it is open-ended (idle, brace). */
  phaseDuration: number;
  /** Seconds since the current action began (carried through a tap that becomes a hold). */
  actionTime: number;
  /** Heading the action's effect is aimed along, fixed when the effect starts. */
  actionYaw: number;
  /** Button and action bookkeeping of the kaiju action system. */
  act: KaijuActionMemory;

  held: HeldObject | null;
  /**
   * The city as a weapon (DESIGN.md section 4): what is left of what the hand holds. A fast-food
   * sign: swings left before it breaks (`clubSwings`). A garage door: the hp the door has left
   * as a shield (`shieldHp`). Both 0 for anything else, and with nothing in the hand.
   */
  clubSwings: number;
  shieldHp: number;
  /** Seconds left of a power surge (a power substation wrecked, sim/systems/specials.ts); 0 for none. */
  surge: number;
  /** Seconds until each verb can be used again. */
  cooldowns: Record<KaijuVerb, number>;
  /** True from the moment the bar passes a mark until the kaiju cocoons. */
  moltAvailable: boolean;
  /**
   * The moves it picked at its molts (DESIGN.md section 4, "Molt cards"), on its first and
   * second move buttons; 'none' while a slot is empty. They carry over for the whole match.
   */
  moves: [KaijuMoveId, KaijuMoveId];
  /** The cards on offer, from the start of its cocoon until it picks one (at the latest the end of the intermission); empty otherwise. */
  offer: KaijuMoveId[];
  /** Never alone: the city gave way and the cocoon starts by itself as soon as it can. */
  forceMolt: boolean;
  /** Never alone: the collapse that is running, or null. */
  collapse: CityCollapse | null;
  mods: Mods;
  /** Ids of drafted upgrades (Tier 2). */
  upgrades: string[];

  /** Set by the movement system each tick. */
  wading: boolean;
  inWater: boolean;
  /**
   * Swimming (sim/swim.ts): 0 standing up, 1 all the way under with only the spines showing,
   * in between while going down or coming up. Set by the kaiju action system.
   */
  submerge: number;
  /** Seconds left before it may go under again after acting. */
  swimSettle: number;
  /** Whether the humans' map shows the kaiju, and for how long noise keeps it shown (stage 1). */
  known: boolean;
  knownTimer: number;
  /** Whether a player-driven unit currently has it in sight within the spotting range. */
  spotted: boolean;
  recentHits: RecentHit[];
  /** The latest charged volley hit of each squad that has landed one lately (for the two-squad rule on breaking nerve). */
  volleyHits: VolleyHit[];
}

// ---------------------------------------------------------------------------------------------
// Humans
// ---------------------------------------------------------------------------------------------

export interface Squad {
  id: number;
  /** Player (or bot slot) that leads it. */
  player: PlayerId;
  faction: FactionId;
  level: Level;
  callsign: string;
  /** The four unit ids, by slot. */
  units: number[];
  /** Unit id the player drives right now; -1 once the whole squad is gone. */
  driven: number;
  upgrades: string[];
  mods: Mods;
  /** All four units are gone; the player is out until the next stage. */
  eliminated: boolean;
  /** Per slot: whether that unit comes back as a veteran at the next stage. */
  veteranSlots: boolean[];
  /**
   * Where the driven unit has been lately, oldest first (sampled every SQUAD_RULES.trailStep
   * meters): the squad-mates' places in the swarm are measured back along it. Server-side only.
   */
  trail: Vec2[];
  /** How many trail points have ever been dropped from its front: a point's number (`trailBase` plus its index) stays its own. */
  trailBase: number;
  /**
   * The squad-mates have formed up around the leader: set once the leader moves. Until then (a
   * fresh deployment) they stay where they were placed.
   */
  formed: boolean;
  /** Every planted squad-mate has a full charge (the edge of this is the `volley.ready` cue). */
  volleyReady: boolean;
  /**
   * The weapon pick-up the driven unit fires instead of its own weapon (defs/pickups.ts), or
   * 'none'. It lasts until the stage ends or the squad is wiped out; a new one replaces it.
   */
  pickup: WeaponPickupId | 'none';
  /** The artillery radio: how many of the squad's next charged volleys still call a barrage (0: none). */
  barrages: number;
}

/** What a unit is trying to do this tick; same meaning as the matching PlayerInput fields. */
export interface UnitControl {
  /** View-relative movement, each in [-1, 1] (see net/input.ts). Use `setWorldMove` for a world direction. */
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  /** Wants to fire its weapon this tick. */
  fire: boolean;
}

export interface Unit {
  entity: 'unit';
  id: number;
  squad: number;
  /** Position in the squad, 0..3. */
  slot: number;
  type: UnitTypeId;
  alive: boolean;

  x: number;
  z: number;
  /** Altitude above the ground (0 for ground units; aircraft in Tier 2). */
  y: number;
  /** Body (hull) heading. */
  yaw: number;
  vx: number;
  vz: number;
  radius: number;
  /** Weapon aim: for a driven tank the turret, which swings toward the player's aim at its own rate (sim/movement.ts). */
  aimYaw: number;
  aimPitch: number;

  hp: number;
  maxHp: number;
  /** Soldiers or vehicles still standing. */
  members: number;
  /** Accumulated nerve damage, 0..COMBAT_RULES.unitNerveCapacity. */
  nerve: number;
  /** Seconds left of being shaken; 0 when steady. The time does not run while it is stunned. */
  shaken: number;
  /**
   * Seconds left of a roar's stun (DESIGN.md section 4): it cannot move or fire, and does not
   * answer its controls or its orders. 0 when it is not stunned.
   */
  stun: number;
  /** Volley charge, 0..1. */
  charge: number;
  /** Seconds until the weapon can fire again. */
  cooldown: number;
  veteran: boolean;
  state: UnitState;
  /** Planted for the squad's volley (its player holds the volley button): it stands, laser on, charging. Never the driven unit. */
  rooted: boolean;
  /** Navigation memory of a sub-unit (where it is going and how). Server-side only; never in snapshots. */
  nav: UnitNav;
  inWater: boolean;
  /** Dead vehicles only: its wreck is still lying where it died (a kaiju can grab or eat it). */
  wreck: boolean;
  /**
   * Seconds left of coming down by parachute (reinforcements, sim/systems/pickups.ts); 0 on the
   * ground. Until it lands its `y` is its height and it cannot move, fire or charge.
   */
  drop: number;
  /** Filled by the input system for the driven unit and by the orders system for sub-units. */
  control: UnitControl;
}

export interface Projectile {
  id: number;
  type: ProjectileTypeId;
  flight: FlightModel;
  owner: ProjectileOwner;
  /** Unit id, kaiju id or call-in mission id. */
  ownerId: number;
  player: PlayerId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  /** Seconds left before it expires. */
  ttl: number;
  /** Resolved at launch (charge multipliers already applied). */
  damage: number;
  nerve: number;
  splash: number;
  structureDamage: number;
  cause: DamageKind;
  /** Fired as part of a charged volley (the leader's own shot with it, or a squad-mate with at least COMBAT_RULES.volleyMinCharge). */
  volley: boolean;
  /** Fired at will by a sub-unit or bot (halves nerve damage). */
  atWill: boolean;
  payload: HeldObject | null;
  /** A thrown city weapon (phase 2): how it lands; absent for everything else. */
  city?: ThrownCityWeapon;
  /**
   * Flight 'guided' (the missile pod): a constant acceleration, m/s², for `steer` more seconds
   * (a whole number of ticks), after which it flies straight on (`stepProjectile`). Absent or 0
   * for everything else.
   */
  ax?: number;
  ay?: number;
  az?: number;
  steer?: number;
}

/** An army supply crate (docs/ROADMAP.md, phase 2): coming down by parachute, or lying on a street until a unit takes it. */
export interface Crate {
  /** Unique per match. */
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  /** Seconds until it lands; 0 once it is on the ground (and anybody's to take). */
  fall: number;
}

/** When and where the crates come down (sim/systems/pickups.ts). Server-side only. */
export interface SupplyState {
  /** The stage the crates down and the squads' pick-ups belong to (0 before play has begun). */
  stage: number;
  /** Seconds until the next timed drop. */
  timer: number;
  /** The squad the next timed drop is meant for (they take turns). */
  turn: number;
}

/**
 * A structure falling over (docs/ROADMAP.md, phase 2; sim/systems/cityDamage.ts): it collapsed
 * and is on its way down onto its side. Server-side only; clients get `structureFall`.
 */
export interface FallingStructure {
  id: number;
  side: FallSide;
  /** Seconds until it lands. */
  timer: number;
  by: PlayerId;
  cause: DamageKind;
  /** Falls in a row before this one (0: nothing fell on it). */
  depth: number;
}

/** An artillery mission on its way (started with `startCallIn`, sim/systems/weapons.ts). */
export interface CallInMission {
  id: number;
  callIn: CallInId;
  squad: number;
  player: PlayerId;
  x: number;
  z: number;
  /** Seconds until the first shell lands; once every shell is on its way, seconds until the last one has landed. */
  timer: number;
  shellsLeft: number;
  /** Seconds until the next shell is released once the mission has begun. */
  nextShell: number;
  /** Ground direction the shells travel along (unit vector): from behind the caller toward the marker. */
  dirX: number;
  dirZ: number;
}

/**
 * A city weapon lying loose on the ground (DESIGN.md section 4, "The city as a weapon"): dropped
 * from the kaiju's hand, or the top of a radio mast that fell. It behaves like the generator's
 * props of its kind (the hatchling can pick it up; at later stages feet and tracks crush it; a
 * propane tank goes off), but it is not part of the city data: clients learn of it from the
 * `looseProp` event and from the city state in the welcome.
 */
export interface LooseObject {
  /** Index in `world.loose`, unique per match. */
  id: number;
  kind: PropKindId;
  x: number;
  z: number;
  yaw: number;
  /**
   * 'falling' until tick `landsAt` (a radio mast's top on its way down), 'down' while it lies
   * there to be picked up, 'gone' once it is picked up, crushed or gone off.
   */
  state: 'falling' | 'down' | 'gone';
  landsAt: number;
}

/**
 * A city weapon in flight (thrown by a kaiju, sim/cityWeapons.ts): what it is, and what it does
 * where it lands (the kind's `cityWeapons` numbers, times `mult`). Server-side only.
 */
export interface ThrownCityWeapon {
  prop: PropKindId;
  /** A javelin (the antenna, the mast): it goes through units instead of stopping on them. */
  javelin: boolean;
  /** Javelins: how many more units it can go through, and the ones it has gone through. */
  pierce: number;
  pierced: number[];
  /** What its damage is multiplied by (the kaiju's mods, and the power surge's when it was thrown): to units, their nerve, structures. */
  unitMult: number;
  nerveMult: number;
  structureMult: number;
}

// ---------------------------------------------------------------------------------------------
// Damage queues
// ---------------------------------------------------------------------------------------------

/** Reference to anything that has hp and nerve. */
export interface CombatantRef {
  entity: 'kaiju' | 'unit';
  id: number;
}

/** One hit, in raw numbers before any multiplier (DESIGN.md section 3: one rule set). */
export interface Hit {
  damage: number;
  nerve: number;
  /**
   * Where the hit came from: a unit ground vector pointing from the target toward the attacker
   * (the opposite of a projectile's travel direction). (0, 0) for hits with no direction, such
   * as a blast. Facing and crossfire are judged from it.
   */
  fromDir: Vec2;
  /** Unit id or kaiju id that caused it, or -1. */
  sourceId: number;
  /** Player responsible, or -1. */
  player: PlayerId;
  kind: DamageKind;
  /** Fire-at-will hit from a sub-unit or bot (halves nerve damage against the kaiju). */
  atWill: boolean;
  /**
   * The squad whose charged volley this hit is part of; absent or -1 for everything else.
   * Only these count toward breaking a kaiju's nerve (the two-squad rule).
   */
  volleySquad?: number;
  /** The hit clears the volley charge of a unit it reaches, whatever its nerve (the roar). */
  resetsCharge?: boolean;
  /** Seconds it stuns a unit it reaches (the roar). */
  stun?: number;
  /** The stun is a knock-down (a water tank's splash, a garage door): the unit lies flat rather than reels (`unitStunned.knockdown`). */
  knockdown?: boolean;
  /** A kaiju loses exactly `damage` (its own propane tank going off in its hand): no state or facing multiplier, no nerve, no brace. */
  exact?: boolean;
}

export interface PendingHit {
  target: CombatantRef;
  hit: Hit;
}

/** Damage to a structure, waiting for the city damage system. */
export interface StructureHit {
  id: number;
  /** Hp to remove; Infinity destroys it outright (trample). */
  damage: number;
  by: PlayerId;
  cause: DamageKind;
  /**
   * The way what hit it was travelling (a ground direction, any length): a tall structure that
   * this brings down falls over that way. Absent: away from the nearest kaiju.
   */
  dirX?: number;
  dirZ?: number;
  /** A building that fell over is landing on it: how many falls in a row led here (it bounds the chain). */
  fallDepth?: number;
}

/** A prop to destroy, waiting for the city damage system. */
export interface PropHit {
  id: number;
  by: PlayerId;
  cause: DamageKind;
}

/**
 * A zone that protects the structures standing in it (Tier 2: the Coalition's sanctuaries).
 * Damage to a structure whose center is inside is multiplied by `damageMult`; overlapping zones
 * do not stack (the strongest wins). Walking through a building (trample) is never reduced.
 */
export interface StructureShield {
  x: number;
  z: number;
  radius: number;
  /** 0..1; 0.5 halves the damage. */
  damageMult: number;
  /** Squad that placed it, or -1. */
  squad: number;
}

// ---------------------------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------------------------

export interface MatchState {
  /** 'briefing', 'playing', 'intermission' or 'ended' ('lobby' never appears inside a World). */
  phase: MatchPhase;
  stage: StageId;
  /** Seconds left on the match clock. */
  clock: number;
  /** Seconds left in a timed phase (briefing, intermission); 0 otherwise. */
  phaseTime: number;
  /** Neighborhood anchor the match started at. */
  anchor: number;
  /** Current playable bounds; always `stageBounds[stage - 1]`. */
  bounds: Bounds;
  stageBounds: PerStage<Bounds>;
  /** Destruction bar. */
  barPoints: number;
  /** Points at which the three marks sit (P1, P2, P3). */
  marks: PerStage<number>;
  /** How many marks the bar has passed, 0..3. */
  marksReached: number;
  winner: Winner;
  endReason: EndReason;
  /** Balance metrics: seconds of play in total and per stage, kaiju nerve breaks, units destroyed. */
  elapsed: number;
  stageTime: [number, number, number];
  breaks: number;
  kills: number;
  /**
   * The radio mast's reward (sim/systems/specials.ts): the humans' map shows static until this
   * tick (0: it never has). While it does, `kaiju.known` comes only from what units see.
   */
  staticUntil: number;
}

/** What keeps the radio lively but never spammy: per-cue timers, a chatter budget, and what was said last. */
export interface VoiceState {
  /** Seconds until each cue may be emitted again. */
  cooldowns: Partial<Record<VoiceCueId, number>>;
  /** Clock announcements already made. */
  clockCalled: { min3: boolean; min1: boolean; sec10: boolean };
  /** Chatter budget: routine cues spend one each and it refills slowly (VOICE_RULES). */
  tokens: number;
  /** The line last played for a cue on each side (key `<cue>|<side>`), so a cue does not repeat itself. */
  lastLine: Record<string, string>;
  /** The stage in which `kaiju.lowhp` was last called (0: never); it is called once per stage. */
  lowHpStage: number;
  /** How many marks `bar.near` has been called for (it is called once on the way to each mark). */
  barNearCalled: number;
  /** The radio's own, stricter discipline (VOICE_SIDE_RULES.radio): its per-cue waits and budget. */
  radio: { cooldowns: Partial<Record<VoiceCueId, number>>; tokens: number };
}

/** Inputs for one tick, indexed by PlayerId. A missing entry repeats that player's last input. */
export type InputsByPlayer = ReadonlyArray<PlayerInput | null | undefined>;

export interface World {
  seed: number;
  config: MatchConfig;
  /** Ticks stepped so far. The first step is tick 1. */
  tick: number;
  /** The only source of randomness in the simulation. */
  rng: Rng;

  city: CityData;
  cityIndex: CityIndex;
  /** Queries against the city in its current state (shares the three arrays below). */
  cityQuery: CityQuery;
  /** Current hp per structure id; 0 is rubble. */
  structureHp: Float32Array;
  /** Visual damage stage per structure id (0 intact .. 3 rubble), kept in step with hp. */
  structureStage: Uint8Array;
  /** Bitset of props still standing. */
  propAlive: Uint8Array;
  /** Bitset of destroyed props that left a wreck on the ground which nobody has taken yet. */
  propWreck: Uint8Array;
  /**
   * Per structure id: 0, or 1 + the side (`FallSide`) it lies fallen toward; shared with
   * `cityQuery` (whose `fallen` lists them). Set when a fall lands.
   */
  structureFall: Uint8Array;
  /** Structures falling over right now (they land after FALL_RULES.time). */
  falls: FallingStructure[];
  /** Army supply crates coming down or lying on the ground, and when the next one comes. */
  crates: Crate[];
  nextCrateId: number;
  supply: SupplyState;
  /** Zones that reduce structure damage (Tier 2 sanctuaries); empty in Tier 1. */
  shields: StructureShield[];
  /** Landmarks covered by an 'insuranceRider' upgrade: damage to them adds nothing to the bar. */
  insuredStructures: number[];
  /**
   * City weapons lying loose (sim/cityWeapons.ts): ones the kaiju dropped, and the top sections of
   * fallen radio masts. Indexed by their `id`; one that is taken or destroyed stays in the list
   * with state 'gone'. Static props of the generated city are not in here.
   */
  loose: LooseObject[];

  match: MatchState;
  players: PlayerState[];
  kaijus: Kaiju[];
  squads: Squad[];
  units: Unit[];
  projectiles: Projectile[];
  callIns: CallInMission[];
  nextProjectileId: number;
  nextCallInId: number;

  /** Queues filled during a tick and drained by the damage and city damage systems. */
  hits: PendingHit[];
  structureHits: StructureHit[];
  propHits: PropHit[];

  voice: VoiceState;
  /** Events of the tick being stepped; step() returns this array and starts a new one next tick. */
  events: SimEvent[];

  /** Advances the simulation by one tick (1/30 s) and returns that tick's events. */
  step(inputs?: InputsByPlayer): SimEvent[];
}
