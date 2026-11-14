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
  KaijuMoveId,
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
  /** Charged volleys fired (human players). */
  volleys: number;
}

interface EventBase {
  /** Simulation tick the event happened on. */
  tick: number;
}

/**
 * A projectile now exists. Clients fly it locally with the same kinematics until `projectileHit`:
 * position(t) = (x, y, z) + (vx, vy, vz) * t - (0, gravity * t^2 / 2, 0), with t counted from
 * this event's tick (`stepProjectile` does one tick of it). By the end of the spawn tick it has
 * already flown one step. A unit's salvo is several of these on the same tick (one per launcher
 * or tank); a call-in's shells arrive one event at a time over the barrage.
 */
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
  /** Seconds until it expires if it hits nothing (a unit's shot gives out a little past its weapon's range). */
  ttl: number;
  /**
   * True when it was fired as part of a charged volley (drawn brighter): by a squad-mate with
   * at least COMBAT_RULES.volleyMinCharge, or the leader's own shot that went with such a volley.
   * Ragged shots, let go on less charge than that, are not volley shots.
   */
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
 * verb that just ended). The charge: 'windup' (0.8 s, rooted, turning), 'charge' (its run, up
 * to 3 s: `duration` is the longest it can last; it can end early, and the next event says
 * so), 'stumble' (1.2 s; it comes on the tick the run ends, whatever ended it), 'idle'.
 */
export interface KaijuActionEvent extends EventBase {
  type: 'kaijuAction';
  kaiju: number;
  action: KaijuVerb;
  phase: KaijuPhase;
  /** Length of this phase in seconds (0 when open-ended, like brace, or instant, like a grab's snatch). */
  duration: number;
  x: number;
  z: number;
  /** Direction the action is aimed along (the tail sweep: straight behind the body). */
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

/**
 * The kaiju started or stopped being staggered. A stagger cuts whatever action was running
 * short: no further `kaijuAction` event is sent for that action.
 */
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

/**
 * A roar stunned a unit: for `duration` seconds it cannot move or fire and does not answer its
 * controls (a player's camera still looks around); it lost its charge. Its shaking, if the
 * roar shook it (`unitShaken` on the same tick), starts when the stun is over. The snapshot's
 * unit record carries `stunned` and the seconds left (`stun`).
 */
export interface UnitStunnedEvent extends EventBase {
  type: 'unitStunned';
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

/**
 * A squad fired a charged volley: its player let go of the volley button and at least one
 * planted squad-mate fired with a charge of COMBAT_RULES.volleyMinCharge or more. (Letting go
 * on less charge than that also fires them, but raggedly: no `volley` event.) The projectiles
 * themselves arrive as `projectileSpawn` events of the same tick.
 */
export interface VolleyEvent extends EventBase {
  type: 'volley';
  squad: number;
  player: PlayerId;
  /** The squad-mates that fired, ragged ones included (the driven unit, whose own shot may have gone with them, is not listed). */
  units: number[];
  /** The aim point: where the view's aim ray from the leader's eye (the crosshair) landed. */
  x: number;
  y: number;
  z: number;
  /** Average charge of those sub-units when they fired, 0..1. */
  charge: number;
}

export interface RoarEvent extends EventBase {
  type: 'roar';
  kaiju: number;
  x: number;
  z: number;
  radius: number;
}

/**
 * A call-in mission (`startCallIn`) has its marker on the ground ('marked'), its first shell has
 * been released and is falling ('inbound'), or its last shell has landed ('done': take the
 * marker away). The shells are `projectileSpawn` events with owner 'callin' and this mission's
 * id. A mission that is still running when a stage ends is dropped without a 'done'. Nothing
 * starts one in phase 1 (the artillery button is gone); phase 2's artillery radio will.
 */
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
  /** Seconds until the first impact ('marked' and 'inbound'); 0 for 'done'. */
  delay: number;
  /** Scatter radius to draw on the ground, with the scatter multipliers as they stand at this moment. */
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

/**
 * Molt cards (DESIGN.md section 4): the cocoon has started and the kaiju is offered three moves
 * (in card order: card 1 is `offer[0]`). The one it picks goes in `slot` (0: the first move
 * button, 1: the second). The offer stands until a pick lands (`moltPick`), at the latest at the
 * end of the intermission. The snapshot's kaiju record carries the offer as well.
 */
export interface MoltOfferEvent extends EventBase {
  type: 'moltOffer';
  kaiju: number;
  offer: KaijuMoveId[];
  slot: 0 | 1;
}

/** A molt card was picked: `move` is in `slot` from now on. `random` when nobody picked and it was drawn at the end of the intermission. */
export interface MoltPickEvent extends EventBase {
  type: 'moltPick';
  kaiju: number;
  move: KaijuMoveId;
  slot: 0 | 1;
  /** Which card it was, 1 to 3. */
  card: number;
  random: boolean;
}

/**
 * Never alone (DESIGN.md section 2): every squad has been wiped out, so the city gives way
 * around the kaiju. Over `duration` seconds `count` structures nearest it collapse (each a
 * `structureStage` with cause 'collapse'), the bar fills to the stage's mark, and then the
 * cocoon starts by itself (`cocoon`); at stage 3 the bar fills to the end and the kaiju wins.
 */
export interface CityCollapseEvent extends EventBase {
  type: 'cityCollapse';
  kaiju: number;
  x: number;
  z: number;
  count: number;
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

/**
 * The match phase changed (briefing, playing, intermission, ended). An intermission follows a
 * molt: `stage` is still the stage that just ended and `nextStage` the one that begins when it
 * is over (with `stageChange`). The kaiju already has its new body during the intermission.
 */
export interface MatchPhaseEvent extends EventBase {
  type: 'matchPhase';
  phase: MatchPhase;
  stage: StageId;
  /** Length of the phase in seconds when it is timed (briefing, intermission), else 0. */
  duration: number;
  /** Intermission only: the stage that begins when it ends. */
  nextStage?: StageId;
}

/**
 * A voice cue, with the lines to play already chosen. Humans hear radio chatter and the kaiju
 * player hears the news, so there is one list per side: ids of lines in `voiceLines.json` (the
 * id is also the audio file name), to be played in order. A list is usually one line; the
 * briefing is several; it is empty when the script has nothing for that side.
 */
export interface VoiceEvent extends EventBase {
  type: 'voice';
  cue: VoiceCueId;
  /** The random number the lines were chosen with (kept for tools; `lines` is what to play). */
  variant: number;
  /** Squad the cue is about (its callsign's lines are preferred), or -1. */
  squad: number;
  /** Player the cue is about, or -1. */
  player: PlayerId;
  /** Line ids to play, per listening side. */
  lines: { humans: string[]; kaiju: string[] };
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
  | UnitStunnedEvent
  | TakeoverEvent
  | VolleyEvent
  | RoarEvent
  | CallInEvent
  | MoltAvailableEvent
  | CocoonEvent
  | MoltOfferEvent
  | MoltPickEvent
  | CityCollapseEvent
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
  'unitStunned',
  'moltOffer',
  'moltPick',
  'cityCollapse',
];
