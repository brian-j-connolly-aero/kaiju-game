/**
 * SimEvent: everything the simulation tells the outside world besides snapshots.
 *
 * Each tick, world.step() returns the events of that tick. The server forwards them to clients
 * as JSON with the next snapshot (`events` message); clients turn them into effects, sound and
 * UI. Events are the ONLY way projectiles and structure changes reach a client.
 *
 * Contract rules (ARCHITECTURE.md section 4): extend freely, never rename casually. Adding a
 * field or a new event type is fine; renaming or removing one breaks every client and tool.
 * All events are plain JSON-safe objects. Positions are meters, angles radians, times seconds.
 */

import type { PropKindId } from '../city/types';
import type {
  CallInId,
  DamageKind,
  EndReason,
  FlightModel,
  KaijuPhase,
  KaijuVerb,
  MatchPhase,
  ProjectileTypeId,
  StageId,
  StructureStage,
  TallyClass,
  UnitTypeId,
  Winner,
  WreckKind,
} from '../defs/ids';
import type { VoiceCueId } from '../defs/voice';
import type { Bounds } from '../math/geom';
import type { PlayerId } from './config';

/** What a kaiju holds in its hand. */
export type HeldObject =
  | { kind: 'prop'; prop: PropKindId }
  | { kind: 'wreck'; wreck: WreckKind }
  | { kind: 'vehicle'; unitType: UnitTypeId }
  | { kind: 'chunk'; archetype: string };

/** Who fired or threw a projectile. */
export type ProjectileOwner = 'unit' | 'kaiju' | 'callin';

/** What a projectile ended on. 'none' means it expired in the air or left the map. */
export type ProjectileTarget = 'kaiju' | 'unit' | 'structure' | 'ground' | 'water' | 'none';

/** Which side of the kaiju a hit landed on (DESIGN.md section 3). */
export type HitFacing = 'front' | 'flank' | 'rear';

/** End-of-match numbers for one player; drives the pictogram tally on the end screen. */
export interface PlayerTally {
  /** Structures and props this player destroyed, by tally class. */
  wrecked: Record<TallyClass, number>;
  /** Destruction bar points this player caused. */
  barPoints: number;
  /** Raw hp damage dealt to enemies (after multipliers). */
  damageDealt: number;
  /** Nerve breaks (kaiju staggers) this player triggered, or units this kaiju player shook. */
  breaks: number;
  /** Enemy units destroyed (kaiju player). */
  kills: number;
  /** Own units lost (human players). */
  unitsLost: number;
  /** Volleys fired (human players). */
  volleys: number;
}

interface EventBase {
  /** Simulation tick the event happened on. */
  tick: number;
}

/** A projectile now exists. Clients fly it locally with the same kinematics until `projectileHit`. */
export interface ProjectileSpawnEvent extends EventBase {
  type: 'projectileSpawn';
  id: number;
  projectile: ProjectileTypeId;
  flight: FlightModel;
  owner: ProjectileOwner;
  /** Unit id, kaiju id or call-in mission id, depending on `owner`. */
  ownerId: number;
  player: PlayerId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Downward acceleration (0 for flat flight). */
  gravity: number;
  /** Seconds until it expires if it hits nothing. */
  ttl: number;
  /** True when it was fired as part of a charged volley (drawn brighter). */
  volley: boolean;
  /** For thrown objects: what is flying. */
  payload?: HeldObject;
}

/** A projectile ended. */
export interface ProjectileHitEvent extends EventBase {
  type: 'projectileHit';
  id: number;
  projectile: ProjectileTypeId;
  x: number;
  y: number;
  z: number;
  target: ProjectileTarget;
  /** Kaiju id, unit id or structure id for those targets; -1 otherwise. */
  targetId: number;
  /** Radius of the explosion to draw. */
  splash: number;
}

/** A structure changed visual damage state. Stage 3 is collapse into rubble. */
export interface StructureStageEvent extends EventBase {
  type: 'structureStage';
  id: number;
  stage: StructureStage;
  /** Player responsible, or -1. */
  by: PlayerId;
  cause: DamageKind;
}

/** Props were crushed or blown up. */
export interface PropsDestroyedEvent extends EventBase {
  type: 'propsDestroyed';
  ids: number[];
  by: PlayerId;
  cause: DamageKind;
}

/**
 * The kaiju's action state machine changed phase. Emitted when an action starts (phase
 * 'windup', or its active phase when it has no wind-up), when its effect begins, when recovery
 * begins, and when the kaiju returns to 'idle' (action 'none' is never sent; idle carries the
 * verb that just ended).
 */
export interface KaijuActionEvent extends EventBase {
  type: 'kaijuAction';
  kaiju: number;
  action: KaijuVerb;
  phase: KaijuPhase;
  /** Length of this phase in seconds (0 when open-ended, like brace, or instant, like a grab's snatch). */
  duration: number;
  /**
   * Seconds of this phase that had already passed when the event was emitted. Only present when
   * it is not 0: a Swipe wind-up that becomes a Stomp keeps the time already spent.
   */
  elapsed?: number;
  x: number;
  z: number;
  /** Direction the action is aimed along. */
  yaw: number;
}

/** The kaiju took a hit that dealt damage or nerve damage (hit flash, hurt sound). */
export interface KaijuHitEvent extends EventBase {
  type: 'kaijuHit';
  kaiju: number;
  /** Hp actually removed, after all multipliers. */
  damage: number;
  /** Nerve damage actually added, after all multipliers. */
  nerve: number;
  facing: HitFacing;
  cause: DamageKind;
  by: PlayerId;
  /** True when the brace absorbed it. */
  braced: boolean;
}

/** The kaiju started or stopped being staggered. */
export interface KaijuStaggerEvent extends EventBase {
  type: 'kaijuStagger';
  kaiju: number;
  /** True at the start, false when it recovers. */
  on: boolean;
  /** Start: how long the stagger lasts. Recovery: how long the nerve immunity that follows lasts. */
  duration: number;
}

/** Where a grabbed (or eaten off the ground) object came from, so clients can remove it from the scene. */
export type HeldSource =
  /** A live prop (`sourceId` is the prop id; its `propAlive` bit is cleared). */
  | 'prop'
  /** The wreck of a destroyed prop (`sourceId` is the prop id; its `propWreck` bit is cleared). */
  | 'propWreck'
  /**
   * A living vehicle (`sourceId` is the unit id). The unit loses that one vehicle (`memberLost`);
   * when it was its last one the unit is destroyed (`unitDestroyed`) and leaves no wreck.
   */
  | 'unit'
  /** The wreck of a dead vehicle (`sourceId` is the unit id; `unit.wreck` is cleared). */
  | 'unitWreck'
  /** A chunk torn from a building (`sourceId` is the structure id). */
  | 'structure'
  /** Nothing in the world changed (throwing or dropping what was already held). */
  | 'none';

/** What the kaiju holds changed. */
export interface KaijuHeldEvent extends EventBase {
  type: 'kaijuHeld';
  kaiju: number;
  /** What it holds now (null after a throw, a meal or a drop). */
  held: HeldObject | null;
  reason: 'grab' | 'throw' | 'eat' | 'drop';
  source: HeldSource;
  /** Id of the prop, unit or structure named by `source`, or -1. */
  sourceId: number;
}

/** The kaiju's nerve broke (accumulated nerve damage reached capacity). */
export interface NerveBreakEvent extends EventBase {
  type: 'nerveBreak';
  kaiju: number;
  x: number;
  z: number;
  /** Player whose hit broke it. */
  by: PlayerId;
}

/** A hit counted as crossfire. */
export interface CrossfireEvent extends EventBase {
  type: 'crossfire';
  kaiju: number;
  /** The two units whose fire crossed. */
  unitA: number;
  unitB: number;
  x: number;
  z: number;
}

/**
 * A unit took damage. Continuous damage (the beam, being trampled) is reported only a few times
 * a second, with the damage of that one tick; hp is always current.
 */
export interface UnitHitEvent extends EventBase {
  type: 'unitHit';
  unit: number;
  damage: number;
  /** Hp left after the hit. */
  hp: number;
  cause: DamageKind;
  x: number;
  z: number;
}

/** A unit lost members (soldiers fall, a tank of the troop burns). */
export interface MemberLostEvent extends EventBase {
  type: 'memberLost';
  unit: number;
  /** How many were lost by this hit. */
  count: number;
  /** Members left. */
  members: number;
}

export interface UnitDestroyedEvent extends EventBase {
  type: 'unitDestroyed';
  unit: number;
  squad: number;
  unitType: UnitTypeId;
  x: number;
  z: number;
  cause: DamageKind;
  by: PlayerId;
}

/** A unit's nerve broke: it cannot fire for `duration` and lost its charge. */
export interface UnitShakenEvent extends EventBase {
  type: 'unitShaken';
  unit: number;
  duration: number;
}

/** A player's driven unit died and they took over a surviving sub-unit. */
export interface TakeoverEvent extends EventBase {
  type: 'takeover';
  player: PlayerId;
  squad: number;
  fromUnit: number;
  toUnit: number;
}

/** A squad fired a charged volley. */
export interface VolleyEvent extends EventBase {
  type: 'volley';
  squad: number;
  player: PlayerId;
  /** Units that fired. */
  units: number[];
  /** The aim point. */
  x: number;
  y: number;
  z: number;
  /** Average charge of the units that fired, 0..1. */
  charge: number;
}

export interface RoarEvent extends EventBase {
  type: 'roar';
  kaiju: number;
  x: number;
  z: number;
  radius: number;
}

/** A call-in was requested ('marked'), its first shells are about to land ('inbound'), or it finished ('done'). */
export interface CallInEvent extends EventBase {
  type: 'callin';
  /** Mission id, unique per match. */
  id: number;
  callIn: CallInId;
  squad: number;
  player: PlayerId;
  x: number;
  z: number;
  phase: 'marked' | 'inbound' | 'done';
  /** Seconds until the first impact (for 'marked'). */
  delay: number;
  /** Scatter radius to draw on the ground. */
  radius: number;
}

/** The bar passed a mark and the kaiju may now cocoon. */
export interface MoltAvailableEvent extends EventBase {
  type: 'moltAvailable';
  kaiju: number;
  /** The mark that was passed: 1 or 2. */
  mark: 1 | 2;
}

export interface CocoonEvent extends EventBase {
  type: 'cocoon';
  kaiju: number;
  x: number;
  z: number;
  duration: number;
}

export interface MoltBlastEvent extends EventBase {
  type: 'moltBlast';
  kaiju: number;
  x: number;
  z: number;
  /** Units inside this radius were destroyed. */
  killRadius: number;
  /** Units inside this radius were shoved out and shaken. */
  shoveRadius: number;
}

/** A new stage began: bounds widened, the kaiju grew, squads redeployed. */
export interface StageChangeEvent extends EventBase {
  type: 'stageChange';
  stage: StageId;
  bounds: Bounds;
}

/** The destruction bar passed a mark (the third one ends the match). */
export interface BarMarkEvent extends EventBase {
  type: 'barMark';
  mark: 1 | 2 | 3;
  points: number;
}

/** The match phase changed (briefing, playing, intermission, ended). */
export interface MatchPhaseEvent extends EventBase {
  type: 'matchPhase';
  phase: MatchPhase;
  stage: StageId;
  /** Length of the phase in seconds when it is timed (briefing, intermission), else 0. */
  duration: number;
}

/**
 * A voice cue. Each client looks up the lines for the cue and its own side (humans hear radio
 * chatter, the kaiju player hears the news) with `pickVoiceLine(cue, side, variant, callsign)`.
 */
export interface VoiceEvent extends EventBase {
  type: 'voice';
  cue: VoiceCueId;
  /** Random number that selects the line, so every listener hears the same one. */
  variant: number;
  /** Squad the cue is about (its callsign's lines are preferred), or -1. */
  squad: number;
  /** Player the cue is about, or -1. */
  player: PlayerId;
}

export interface MatchEndEvent extends EventBase {
  type: 'matchEnd';
  winner: Exclude<Winner, 'none'>;
  reason: Exclude<EndReason, 'none'>;
  /** Seconds of play (clock time used). */
  duration: number;
  /** One tally per player slot, indexed by PlayerId. */
  tallies: PlayerTally[];
}

export type SimEvent =
  | ProjectileSpawnEvent
  | ProjectileHitEvent
  | StructureStageEvent
  | PropsDestroyedEvent
  | KaijuActionEvent
  | KaijuHitEvent
  | KaijuStaggerEvent
  | KaijuHeldEvent
  | NerveBreakEvent
  | CrossfireEvent
  | UnitHitEvent
  | MemberLostEvent
  | UnitDestroyedEvent
  | UnitShakenEvent
  | TakeoverEvent
  | VolleyEvent
  | RoarEvent
  | CallInEvent
  | MoltAvailableEvent
  | CocoonEvent
  | MoltBlastEvent
  | StageChangeEvent
  | BarMarkEvent
  | MatchPhaseEvent
  | VoiceEvent
  | MatchEndEvent;

export type SimEventType = SimEvent['type'];

/** The event interface for a given `type` string. */
export type SimEventOf<T extends SimEventType> = Extract<SimEvent, { type: T }>;

/** An event before the world stamps its tick (what systems pass to `emit`). */
export type SimEventInput = { [T in SimEventType]: Omit<SimEventOf<T>, 'tick'> }[SimEventType];

/** Every event type, for tools and tests that want to iterate them. */
export const SIM_EVENT_TYPES: readonly SimEventType[] = [
  'projectileSpawn',
  'projectileHit',
  'structureStage',
  'propsDestroyed',
  'kaijuAction',
  'kaijuHit',
  'kaijuStagger',
  'kaijuHeld',
  'nerveBreak',
  'crossfire',
  'unitHit',
  'memberLost',
  'unitDestroyed',
  'unitShaken',
  'takeover',
  'volley',
  'roar',
  'callin',
  'moltAvailable',
  'cocoon',
  'moltBlast',
  'stageChange',
  'barMark',
  'matchPhase',
  'voice',
  'matchEnd',
];
