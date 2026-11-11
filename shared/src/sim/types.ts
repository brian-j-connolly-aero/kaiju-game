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

import type { CityIndex, CityQuery } from '../city/spatialIndex';
import type { CityData } from '../city/types';
import type {
  CallInId,
  DamageKind,
  EndReason,
  FactionId,
  FireMode,
  FlightModel,
  KaijuActionId,
  KaijuKindId,
  KaijuPhase,
  KaijuVerb,
  Level,
  MatchPhase,
  MoveOrder,
  PerStage,
  ProjectileTypeId,
  Role,
  StageId,
  UnitState,
  UnitTypeId,
  Winner,
} from '../defs/ids';
import type { Mods } from '../defs/schema';
import type { VoiceCueId } from '../defs/voice';
import type { Bounds } from '../math/geom';
import type { Rng } from '../math/rng';
import type { Vec2 } from '../math/vec';
import type { PlayerInput } from '../net/input';
import type { BotState } from './bots/types';
import type { SquadCommand } from './commands';
import type { MatchConfig, PlayerId } from './config';
import type { HeldObject, PlayerTally, ProjectileOwner, SimEvent } from './events';

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
  /** Commands that take effect this tick (from the wheel, the call-in button, or `command` messages). */
  commands: SquadCommand[];
  /** Commands received between ticks, waiting for the next input intake. */
  queuedCommands: SquadCommand[];
  /** The input a bot wants applied on the next tick; the bots system writes it. */
  botInput: PlayerInput;
  /** Scratch memory of the bot driving this slot. */
  botState: BotState;
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

/**
 * What the kaiju action system remembers between ticks: which button presses it has already
 * used, and the bookkeeping of the action that is running. Server-side only; never in snapshots.
 */
export interface KaijuActionMemory {
  /** Btn bits whose latest press has already started an action (cleared by the next press). */
  usedPress: number;
  /** Btn bits whose current hold has already been judged as a hold (eat). Cleared by the next press. */
  usedHold: number;
  /** The button that started the running action has been down ever since, so a tap can still become a hold. */
  holdLive: boolean;
  /** Ticks left in which a grab tap made with something in hand still turns into a throw. */
  throwBuffer: number;
  /** The running Eat took a meal (from the hand or off the ground) and will heal when it finishes. */
  meal: boolean;
  /** Beam special: how far the beam reaches this tick, and the structure it is burning through (-1: none). */
  beamLength: number;
  beamBlocker: number;
  /** Tick of the last `crossfire` event for this kaiju (they are rate limited). */
  crossfireTick: number;
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
  /** Seconds until each verb can be used again. */
  cooldowns: Record<KaijuVerb, number>;
  /** True from the moment the bar passes a mark until the kaiju cocoons. */
  moltAvailable: boolean;
  mods: Mods;
  /** Ids of drafted upgrades (Tier 2). */
  upgrades: string[];

  /** Set by the movement system each tick. */
  wading: boolean;
  inWater: boolean;
  /** Whether the humans' map shows the kaiju, and for how long noise keeps it shown (stage 1). */
  known: boolean;
  knownTimer: number;
  /** Whether a player-driven unit currently has it in sight within the spotting range. */
  spotted: boolean;
  recentHits: RecentHit[];
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
  moveOrder: MoveOrder;
  /** Destination of a 'moveTo' order. */
  moveTarget: Vec2;
  fireMode: FireMode;
  /** Seconds until each call-in of the faction level is ready again (same order as its `callIns`). */
  callInCooldowns: number[];
  upgrades: string[];
  mods: Mods;
  /** All four units are gone; the player is out until the next stage. */
  eliminated: boolean;
  /** Per slot: whether that unit comes back as a veteran at the next stage. */
  veteranSlots: boolean[];
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
  /** Weapon aim. */
  aimYaw: number;
  aimPitch: number;

  hp: number;
  maxHp: number;
  /** Soldiers or vehicles still standing. */
  members: number;
  /** Accumulated nerve damage, 0..COMBAT_RULES.unitNerveCapacity. */
  nerve: number;
  /** Seconds left of being shaken; 0 when steady. */
  shaken: number;
  /** Volley charge, 0..1. */
  charge: number;
  /** Seconds until the weapon can fire again. */
  cooldown: number;
  veteran: boolean;
  state: UnitState;
  /** Held in place by a hold-and-charge order. */
  rooted: boolean;
  inWater: boolean;
  /** Dead vehicles only: its wreck is still lying where it died (a kaiju can grab or eat it). */
  wreck: boolean;
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
  /** Fired as part of a charged volley. */
  volley: boolean;
  /** Fired at will by a sub-unit or bot (halves nerve damage). */
  atWill: boolean;
  payload: HeldObject | null;
}

/** An artillery mission on its way. */
export interface CallInMission {
  id: number;
  callIn: CallInId;
  squad: number;
  player: PlayerId;
  x: number;
  z: number;
  /** Seconds until the first shell lands. */
  timer: number;
  shellsLeft: number;
  /** Seconds until the next shell is released once the mission has begun. */
  nextShell: number;
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
  /** The hit clears the volley charge of a unit it reaches, whatever its nerve (the roar). */
  resetsCharge?: boolean;
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
}

/** Per-cue timers that keep the radio from repeating itself. */
export interface VoiceState {
  /** Seconds until each cue may be emitted again. */
  cooldowns: Partial<Record<VoiceCueId, number>>;
  /** Clock announcements already made. */
  clockCalled: { min3: boolean; min1: boolean; sec10: boolean };
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
  /** Zones that reduce structure damage (Tier 2 sanctuaries); empty in Tier 1. */
  shields: StructureShield[];
  /** Landmarks covered by an 'insuranceRider' upgrade: damage to them adds nothing to the bar. */
  insuredStructures: number[];

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
