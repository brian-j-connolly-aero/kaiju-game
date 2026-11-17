/**
 * One match as the client knows it: the welcome message, the mirrored city, the snapshot
 * buffer, the estimate of the server's clock, the prediction of the local body and the queue
 * of simulation events waiting for their moment on screen.
 *
 * Two timelines meet here. The local body lives in the present: inputs are applied as they are
 * sent. Everything else is drawn about 100 ms in the past, between two snapshots, and events
 * are handed to the rest of the client when that delayed view reaches their tick, so an
 * explosion lines up with the shell that the view shows arriving. The city used for collision
 * is updated the moment an event arrives, because the predicted body needs the present.
 */

import {
  Btn,
  clampAngleAround,
  DT,
  decodeSnapshot,
  heldEdible,
  kaijuKindDef,
  kaijuMoveParams,
  kaijuMoveVerb,
  kaijuStageDef,
  stageBounds,
  strikeVerb,
  unitMoveParams,
  unitTypeDef,
  type Bounds,
  type KaijuActionId,
  type KaijuMoveState,
  type KaijuPhase,
  type KaijuVerb,
  type MatchConfig,
  type MoveParams,
  type PlayerInput,
  type SimEvent,
  type SnapCrate,
  type SnapKaiju,
  type SnapMatch,
  type SnapSquad,
  type SnapUnit,
  type Snapshot,
  type StageId,
  type UnitMoveState,
  type WelcomeMessage,
} from '@mb/shared';
import { applyCityEvent, createCityMirror, resyncCityMirror, type CityMirror } from './cityMirror';
import { createPredictor, decayPredictionError, predictedPose, predictedTurret, predictStep, readAck, reconcile, resetPredictor, type Hold, type Predictor } from './prediction';
import { clockSample, createServerClock, renderTick, type ServerClock } from './serverClock';
import { createSnapshotBuffer, newestSnapshot, pushSnapshot, sampleSnapshots, type SnapshotBuffer } from './snapshotBuffer';

export interface LocalRole {
  kind: 'kaiju' | 'human' | 'spectator';
  playerId: number;
  kaijuId: number;
  squadId: number;
}

/** Everything the renderer, the HUD and the controllers need for one frame. */
export interface FrameState {
  /** Fractional server tick this frame shows. */
  tick: number;
  match: SnapMatch;
  kaijus: SnapKaiju[];
  squads: SnapSquad[];
  units: SnapUnit[];
  /** Army supply crates coming down or on the ground (phase 2), as the snapshot drawn has them. */
  crates: SnapCrate[];
  /** Playable bounds of the stage being shown. */
  bounds: Bounds;
  /** The unit the local player drives (already at its predicted position), or null. */
  localUnit: SnapUnit | null;
  /** The kaiju the local player controls (already at its predicted position), or null. */
  localKaiju: SnapKaiju | null;
}

/** A locally started wind-up, shown until the server's own state takes over. */
export interface ActionHint {
  verb: KaijuVerb;
  /** Local time (seconds) the press happened. */
  startedAt: number;
}

/** The session's own record of a hint: what the server has said about it and what has been drawn. */
interface LocalHint extends ActionHint {
  /** Sequence number of the input that carried the press. */
  seq: number;
  /** The newest snapshot has shown the server's own phase: prediction uses that from now on. */
  confirmed: boolean;
  /** The delayed view has shown the server's phase: when it is idle again the action is over. */
  shown: boolean;
}

/**
 * The phase a verb's press leads into (what the drawn kaiju shows once the server's state
 * arrives): its wind-up, or for a verb without one (the roar, eating) its active phase at once.
 */
function hintPhase(verb: KaijuVerb, kind: SnapKaiju['kind']): KaijuPhase {
  if (verb === 'brace') return 'brace';
  const action = kaijuKindDef(kind).actions[verb];
  return action.timing.windup > 0 ? 'windup' : action.activePhase;
}

/** The two move buttons' bits, by slot (`SnapKaiju.moves`). */
const MOVE_BITS = [Btn.move1, Btn.move2] as const;

/**
 * Which verb a fresh press starts on an idle kaiju, by the simulation's rules for one move per
 * button (net/input.ts; sim/systems/kaijuActions.ts `startFromInput`), or null when it starts
 * nothing that can be shown ahead of the server. `buttons` is what is down, `pressed` what just
 * went down. The order is the simulation's: molt, brace, the first move, the second, stomp,
 * strike, grab. A Grab with empty hands is shown as a grab: whether the server eats a kiosk
 * instead depends on what lies in reach, and the server's own phase takes over the picture.
 * With a city weapon in the hand (phase 2) Strike swings a fast-food sign and throws anything
 * else (`strikeVerb`), and Grab drops it, which has no wind-up to show (`heldEdible`).
 */
export function hintVerb(k: SnapKaiju, buttons: number, pressed: number): KaijuVerb | null {
  if (pressed & Btn.molt && k.moltAvailable) return null;
  const def = kaijuKindDef(k.kind);
  for (let slot = 0; slot < 2; slot++) {
    if (kaijuMoveVerb(k.moves[slot]) === 'brace' && buttons & MOVE_BITS[slot]) return 'brace';
  }
  for (let slot = 0; slot < 2; slot++) {
    const verb = kaijuMoveVerb(k.moves[slot]);
    if (verb === 'none' || verb === 'brace' || !(pressed & MOVE_BITS[slot])) continue;
    const ready = k.cooldowns[verb] <= 0 && k.rage >= def.actions[verb].rageCost;
    if (ready) return verb;
  }
  if (pressed & Btn.stomp) return 'stomp';
  if (pressed & Btn.strike) return strikeVerb(k.held);
  if (pressed & Btn.grab) return k.held ? (heldEdible(k.held) && k.cooldowns.eat <= 0 ? 'eat' : null) : 'grab';
  return null;
}

/** The action state to pose a kaiju in, in place of its own. */
export interface HintPose {
  action: KaijuActionId;
  phase: KaijuPhase;
  phaseTime: number;
  phaseDuration: number;
}

/**
 * How the local kaiju's own press is shown ahead of the server (`hint` comes from
 * `MatchSession.hintFor`, `k` is the kaiju as drawn). While the view still has the kaiju idle,
 * the wind-up is posed from the moment of the press. When the server's phase reaches the view
 * (a round trip plus the view's delay later) the pose carries on from the time already shown
 * instead of starting again, and waits at the end of the wind-up for the server's strike.
 * Null: pose the kaiju as the snapshot says.
 */
export function hintPose(k: SnapKaiju, hint: ActionHint | null, now: number): HintPose | null {
  if (!hint) return null;
  const elapsed = Math.max(0, now - hint.startedAt);
  if (k.phase !== 'idle') {
    if (elapsed <= k.phaseTime) return null;
    return { action: k.action, phase: k.phase, phaseTime: k.phaseDuration > 0 ? Math.min(elapsed, k.phaseDuration) : elapsed, phaseDuration: k.phaseDuration };
  }
  const def = kaijuKindDef(k.kind).actions[hint.verb];
  if (hint.verb === 'brace') return { action: 'brace', phase: 'brace', phaseTime: elapsed, phaseDuration: 0 };
  // No wind-up (the roar, eating): straight into the active phase.
  if (!(def.timing.windup > 0)) return { action: hint.verb, phase: def.activePhase, phaseTime: Math.min(elapsed, def.timing.active), phaseDuration: def.timing.active };
  return { action: hint.verb, phase: 'windup', phaseTime: Math.min(elapsed, def.timing.windup), phaseDuration: def.timing.windup };
}

/** One snapshot as the network readout sees it (ui/netReadout.ts). */
export interface NetSample {
  /** Local time it arrived, seconds. */
  at: number;
  /** Milliseconds since the snapshot before it. */
  gap: number;
  /** How far it moved the prediction of the local body, meters (`Predictor.lastJump`). */
  jump: number;
  /** Inputs the server said it will drop (the acknowledgement's second number). */
  drops: number;
  /** Inputs sent and not yet played by the server (in flight, or waiting there). */
  pending: number;
}

/** Snapshots the readout's history keeps: 30 seconds. */
export const NET_HISTORY = 450;
/** A correction of the local body at least this big counts as snapping back in the page's report, meters (as ui/netReadout.ts counts it). */
const REPORT_SNAP = 0.15;
/** A frame at least this long counts as the page freezing in its report, seconds. */
const REPORT_FREEZE = 0.1;

export interface SessionCallbacks {
  sendInput(input: PlayerInput): void;
  /** A simulation event whose moment on screen has come. */
  onEvent(event: SimEvent): void;
  /** The mirrored city was replaced wholesale (reconnection): redraw every structure and prop. */
  onCityResync(): void;
}

/** A unit in the intermission: no drive, only braking (as `coastUnits` in sim/systems/matchFlow.ts moves it). */
const COASTING: UnitMoveState = { alive: true, rooted: true };

/** Seconds below which the simulation counts a stun as over (sim/systems/damage.ts). */
const STUN_EPS = 1e-6;
/** How far a snapshot's stun may be from the true one: it is rounded to 0.05 s (net/snapshot.ts). */
const STUN_SNAPSHOT_STEP = 0.026;

/**
 * Ticks after a snapshot during which a unit with `stun` seconds left stays frozen: the damage
 * system counts the stun down at the end of every tick, and movement reads it before that.
 */
export function stunTicks(stun: number): number {
  let left = stun;
  let ticks = 0;
  while (left > 0 && ticks < 600) {
    ticks++;
    left = left - DT > STUN_EPS ? left - DT : 0;
  }
  return ticks;
}

/** Seconds the simulation allows a phase to end early by (sim/systems/kaijuActions.ts). */
const PHASE_EPS = 1e-6;

/** Ticks a phase of `seconds` lasts from the tick it begins (none when it has no length). */
function phaseTicks(seconds: number): number {
  return seconds > 0 ? Math.max(1, Math.ceil((seconds - PHASE_EPS) / DT - 1e-9)) : 0;
}

/**
 * Ticks after a snapshot during which a kaiju is still slowed by the attack it is in, by the
 * action system's own clock (sim/systems/kaijuActions.ts: the phase time grows at the start of
 * every tick and the phase ends once it reaches its length): what is left of this phase plus
 * the phases after it (0: it is over by the next tick). -1 when the end is not known in
 * advance: idle, the charge (a wall or a second press ends it), the brace (held), the beam, the
 * molt, a stagger.
 */
export function actionTicksLeft(k: SnapKaiju): number {
  let rest: number[];
  if (k.phase === 'flinch') {
    rest = [];
  } else {
    if (k.action === 'none' || k.action === 'brace' || k.action === 'charge' || k.action === 'special' || k.action === 'molt') return -1;
    const action = kaijuKindDef(k.kind).actions[k.action];
    const t = action.timing;
    if (k.phase === 'windup') rest = [t.active, t.recover];
    else if (k.phase === action.activePhase) rest = [t.recover];
    else if (k.phase === (action.recoverPhase ?? 'recover')) rest = [];
    else return -1;
  }
  // This phase ends on the first tick whose phase time reaches its length; that tick is the next phase's.
  const ends = Math.max(1, Math.ceil((k.phaseDuration - PHASE_EPS - k.phaseTime) / DT - 1e-9));
  let ticks = ends - 1;
  for (const seconds of rest) ticks += phaseTicks(seconds);
  return ticks;
}

/** A press the server has said nothing about for this long is no longer predicted (seconds). */
const HINT_TIMEOUT = 1;
/** A hint is never drawn for longer than this over a kaiju the view still shows idle (seconds). */
const HINT_DRAW_TIMEOUT = 1.5;
/** Events are released no later than this long after they arrived, whatever the clock says. */
const EVENT_MAX_WAIT = 1.2;
/**
 * Events that have waited longer than this were not shown because no frames ran (a hidden tab,
 * a long stall of the page). They are handed out with `catchingUp` set: only what lasts is
 * applied, nothing is played back.
 */
const EVENT_STALE_AFTER = 2;

interface QueuedEvent {
  event: SimEvent;
  arrivedAt: number;
}

export class MatchSession {
  readonly welcome: WelcomeMessage;
  readonly config: MatchConfig;
  readonly mirror: CityMirror;
  readonly role: LocalRole;
  readonly buffer: SnapshotBuffer = createSnapshotBuffer();
  readonly clock: ServerClock = createServerClock();
  readonly predictor: Predictor = createPredictor();
  /** Newest snapshot received. */
  latest: Snapshot | null = null;
  /** The frame most recently produced by `sample`. */
  frame: FrameState | null = null;
  /** The direction the local player is looking (set by the controller every frame). */
  aimYaw = 0;
  aimPitch = 0;
  hint: LocalHint | null = null;
  /**
   * True while `sample` hands out events that waited so long that their moment has passed (the
   * tab was hidden, the page stalled for seconds). Whoever receives an event while this is set
   * should take only its lasting effect (the state of the city, marks, the match result) and
   * skip everything momentary: effects, camera shake, flashes, one-shot sounds.
   */
  catchingUp = false;
  /** Counters for the debug overlay and the automation hook. */
  stats = { snapshots: 0, snapshotBytes: 0, events: 0, inputs: 0, lastSnapshotAt: 0 };
  /** The newest snapshots, oldest first, for the network readout (NET_HISTORY of them). */
  readonly net: NetSample[] = [];
  /** What this page saw since its last ping, for the server's log (`takeReport`, round 5). */
  private report = { snaps: 0, snapMax: 0, freezes: 0, frameMax: 0 };
  /** Local time of the previous `sample`, seconds (the page's frames, for the report). */
  private lastSampleAt = Number.NaN;

  private readonly callbacks: SessionCallbacks;
  private queue: QueuedEvent[] = [];
  private seq = 0;
  private boundsCache: { stage: StageId; bounds: Bounds } | null = null;
  private readonly params = {} as MoveParams;
  /** A stunned unit's parameters once the stun is over, and the state unit parameters are built from. */
  private readonly freeParams = {} as MoveParams;
  private readonly unitState: UnitMoveState = { alive: true, rooted: false, stun: 0 };
  /** A kaiju standing idle, for its movement once an attack is over. */
  private readonly idleKaiju: KaijuMoveState = { kind: 'lizard', stage: 1, nerve: 0, action: 'none', phase: 'idle', submerge: 0 };
  /** The newest stun of each unit, from its `unitStunned` event: the tick it began and its length. */
  private readonly stuns = new Map<number, { tick: number; duration: number }>();
  private predictedKey = '';
  private lastButtons = 0;
  private readonly pose = { x: 0, z: 0, yaw: 0 };
  /** How far the present is past the newest input tick, 0..1 (see `refreshLocal`). */
  private localAlpha = 1;

  constructor(welcome: WelcomeMessage, callbacks: SessionCallbacks) {
    this.welcome = welcome;
    this.config = welcome.config;
    this.callbacks = callbacks;
    this.mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    const kind = welcome.kaijuId >= 0 ? 'kaiju' : welcome.squadId >= 0 ? 'human' : 'spectator';
    this.role = { kind, playerId: welcome.playerId, kaijuId: welcome.kaijuId, squadId: welcome.squadId };
  }

  /** True when this welcome belongs to the match this session already mirrors. */
  sameMatch(welcome: WelcomeMessage): boolean {
    return welcome.seed === this.welcome.seed && welcome.config.citySeed === this.config.citySeed && welcome.anchor === this.welcome.anchor;
  }

  /** A welcome for the same match (after a reconnection): take over the server's city state. */
  resync(welcome: WelcomeMessage): void {
    resyncCityMirror(this.mirror, welcome.cityState);
    resetPredictor(this.predictor);
    this.callbacks.onCityResync();
  }

  boundsFor(stage: StageId): Bounds {
    if (!this.boundsCache || this.boundsCache.stage !== stage) {
      this.boundsCache = { stage, bounds: stageBounds(this.mirror.city, this.welcome.anchor, stage) };
    }
    return this.boundsCache.bounds;
  }

  // --- from the network ------------------------------------------------------------------------

  handleSnapshot(bytes: Uint8Array, now: number): void {
    let snap: Snapshot;
    try {
      snap = decodeSnapshot(bytes);
    } catch (err) {
      console.warn('net: dropped a snapshot that could not be decoded', err);
      return;
    }
    if (!pushSnapshot(this.buffer, snap)) return;
    this.latest = newestSnapshot(this.buffer);
    clockSample(this.clock, snap.tick, now);
    const gap = this.stats.snapshots > 0 ? (now - this.stats.lastSnapshotAt) * 1000 : 0;
    this.stats.snapshots++;
    this.stats.snapshotBytes += bytes.length;
    this.stats.lastSnapshotAt = now;
    this.reconcileFrom(snap);
    const p = this.predictor;
    const jump = p.ready ? p.lastJump : 0;
    this.net.push({ at: now, gap, jump, drops: readAck(snap.ackSeq).drops, pending: p.pending.length });
    if (this.net.length > NET_HISTORY) this.net.shift();
    if (jump >= REPORT_SNAP) this.report.snaps++;
    this.report.snapMax = Math.max(this.report.snapMax, jump);
  }

  /**
   * What the page saw since the last call (corrections of its own body, frames that froze), for
   * the report its pings carry to the server's log (`PageReport`, protocol.ts), and starts over.
   */
  takeReport(): { snaps: number; snapMax: number; freezes: number; frameMax: number } {
    const r = this.report;
    this.report = { snaps: 0, snapMax: 0, freezes: 0, frameMax: 0 };
    return { snaps: r.snaps, snapMax: Math.round(r.snapMax * 100), freezes: r.freezes, frameMax: Math.round(r.frameMax * 1000) };
  }

  handleEvents(events: SimEvent[], now: number): void {
    for (const event of events) {
      if (event.type === 'unitStunned') {
        if (this.stuns.size > 64) this.stuns.clear();
        this.stuns.set(event.unit, { tick: event.tick, duration: event.duration });
      }
      applyCityEvent(this.mirror, event);
      this.queue.push({ event, arrivedAt: now });
      this.stats.events++;
    }
  }

  // --- the local player --------------------------------------------------------------------------

  /** The body the local player drives according to a snapshot, or null. */
  private localBody(snap: Snapshot): { key: string; kaiju: SnapKaiju | null; unit: SnapUnit | null } | null {
    if (this.role.kind === 'kaiju') {
      const k = snap.kaijus[this.role.kaijuId];
      return k ? { key: `k${k.id}s${k.stage}`, kaiju: k, unit: null } : null;
    }
    if (this.role.kind === 'human') {
      const squad = snap.squads[this.role.squadId];
      const u = squad && squad.driven >= 0 ? snap.units[squad.driven] : undefined;
      return u ? { key: `u${u.id}t${u.type}`, kaiju: null, unit: u } : null;
    }
    return null;
  }

  /** The kaiju's movement state to predict with: the snapshot's, or the wind-up of a press the server has not answered yet. */
  private kaijuState(k: SnapKaiju, now: number): KaijuMoveState {
    const hint = this.predictedHint(k, now);
    return hint ? { kind: k.kind, stage: k.stage, nerve: k.nerve, action: hint.verb, phase: hintPhase(hint.verb, k.kind), submerge: k.submerge } : k;
  }

  /**
   * How the local body moves: whether it moves at all (`moving`), its movement parameters, its
   * radius and, for a kaiju, the movement state that can override the stick (a charge's run), as
   * the server's movement uses them. A stunned unit's frozen parameters hold only until its stun
   * runs out (`hold`). In the intermission nobody drives, but a unit the molt's blast threw
   * slides on until it stops (sim/systems/matchFlow.ts, `coastUnits`): it is predicted braking.
   */
  private paramsFor(
    body: { kaiju: SnapKaiju | null; unit: SnapUnit | null },
    snap: Snapshot,
    now: number,
  ): { moving: boolean; params: MoveParams; radius: number; drive: KaijuMoveState | null; hold: Hold | null } {
    const bounds = this.boundsFor(snap.match.stage);
    const phase = snap.match.phase;
    if (body.kaiju) {
      const k = body.kaiju;
      const radius = kaijuStageDef(k.kind, k.stage).bodyRadius;
      const moving = phase === 'playing';
      const hint = this.predictedHint(k, now) ? this.hint : null;
      if (hint) {
        // A press the server has not played yet: the body moves as the snapshot has it (idle)
        // for the inputs before the press, and as the press's wind-up from the press on.
        const drive = this.kaijuState(k, now);
        const free = kaijuMoveParams(drive, bounds, undefined, this.freeParams);
        const before = this.inputsBefore(hint.seq, snap);
        if (before === 0) return { moving, params: free, radius, drive, hold: null };
        return { moving, params: kaijuMoveParams(k, bounds, undefined, this.params), radius, drive, hold: { ticks: before, free } };
      }
      const params = kaijuMoveParams(k, bounds, undefined, this.params);
      // An attack with a known end: its slower steps last that many ticks, then it walks freely.
      const ticks = actionTicksLeft(k);
      if (ticks < 0) return { moving, params, radius, drive: k, hold: null };
      const idle = this.idleKaiju;
      idle.kind = k.kind;
      idle.stage = k.stage;
      idle.nerve = k.nerve;
      idle.submerge = k.submerge;
      const free = kaijuMoveParams(idle, bounds, undefined, this.freeParams);
      if (ticks === 0) return { moving, params: free, radius, drive: idle, hold: null };
      return { moving, params, radius, drive: k, hold: { ticks, free } };
    }
    const u = body.unit as SnapUnit;
    const def = unitTypeDef(u.type);
    if (phase === 'intermission') {
      return { moving: u.alive, params: unitMoveParams(def, COASTING, bounds, undefined, this.params), radius: def.radius, drive: null, hold: null };
    }
    const state = this.unitState;
    state.alive = u.alive;
    state.rooted = u.rooted;
    state.driven = u.driven;
    state.y = u.y;
    state.stun = 0;
    const left = u.alive ? this.stunLeft(u, snap.tick) : 0;
    const ticks = left > 0 ? stunTicks(left) : 0;
    if (ticks === 0) return { moving: phase === 'playing', params: unitMoveParams(def, state, bounds, undefined, this.params), radius: def.radius, drive: null, hold: null };
    // Frozen by a stun for `ticks` more ticks, then free again.
    const free = unitMoveParams(def, state, bounds, undefined, this.freeParams);
    state.stun = left;
    return { moving: phase === 'playing', params: unitMoveParams(def, state, bounds, undefined, this.params), radius: def.radius, drive: null, hold: { ticks, free } };
  }

  /**
   * How many of the inputs the server will play after this snapshot come before the input with
   * sequence number `seq` (the ones it will drop are left out, as `reconcile` leaves them out).
   */
  private inputsBefore(seq: number, snap: Snapshot): number {
    const { played, drops } = readAck(snap.ackSeq);
    let skip = drops;
    let n = 0;
    for (const input of this.predictor.pending) {
      if (input.seq <= played) continue;
      if (input.seq >= seq) break;
      if (skip > 0) skip--;
      else n++;
    }
    return n;
  }

  /**
   * Seconds of stun a unit has left after the snapshot's tick: worked out from the `unitStunned`
   * event that began it when that agrees with the snapshot, whose own figure is rounded to 0.05 s
   * (a tick and a half; read as it is, the stun would end a tick early or late on the page).
   */
  private stunLeft(u: SnapUnit, tick: number): number {
    const began = this.stuns.get(u.id);
    if (began && tick >= began.tick) {
      // The stun is set on its tick and counted down at the end of that same tick (sim/systems/damage.ts).
      const left = began.duration - (tick - began.tick + 1) * DT;
      if (Math.abs(left - u.stun) <= STUN_SNAPSHOT_STEP) return Math.max(0, left);
    }
    return u.stun;
  }

  private reconcileFrom(snap: Snapshot): void {
    const body = this.localBody(snap);
    if (!body || !this.mirror.trusted) {
      resetPredictor(this.predictor);
      this.predictedKey = '';
      return;
    }
    if (body.key !== this.predictedKey) {
      // A different body (takeover, a fresh unit at a new stage, the kaiju grew): start clean.
      const pending = this.predictor.pending.slice();
      resetPredictor(this.predictor);
      this.predictor.pending.push(...pending);
      this.predictedKey = body.key;
    }
    const now = this.stats.lastSnapshotAt;
    const hint = this.hint;
    const ack = readAck(snap.ackSeq);
    if (hint && !hint.confirmed && body.kaiju) {
      if (body.kaiju.phase !== 'idle') hint.confirmed = true;
      // The server has played the press and the kaiju is still idle: it was refused. Stop pretending.
      else if (ack.played >= hint.seq) this.hint = null;
    }
    const { moving, params, radius, drive, hold } = this.paramsFor(body, snap, now);
    const server = body.kaiju ?? (body.unit as SnapUnit);
    reconcile(this.predictor, server, radius, snap.ackSeq, this.mirror.query, params, moving, drive, hold);
  }

  /**
   * The hint as the PREDICTION uses it, judged against the newest snapshot: it stands in for the
   * server's phase only until that phase arrives (then the snapshot itself says how the body
   * moves) or the press has gone unanswered for too long. The hint itself lives on for drawing:
   * the view runs about 100 ms behind the newest snapshot, see `hintFor`.
   */
  private predictedHint(k: SnapKaiju, now: number): ActionHint | null {
    const hint = this.hint;
    if (!hint || hint.confirmed || k.phase !== 'idle' || now - hint.startedAt > HINT_TIMEOUT) return null;
    return hint;
  }

  /** Works out which wind-up a fresh button press will start, so it can be shown at once. */
  private updateHint(buttons: number, k: SnapKaiju, now: number, seq: number): void {
    const pressed = buttons & ~this.lastButtons;
    if (pressed === 0 || k.phase !== 'idle' || !k.alive || this.hint) return;
    // In the water a press only brings it up first (sim/swim.ts): nothing to show ahead of the server.
    if (k.submerge > 0) return;
    // The view is still showing the tail of the last action: a hint now would be cut off by it.
    const drawn = this.frame?.localKaiju;
    if (drawn && drawn.phase !== 'idle') return;
    const verb = hintVerb(k, buttons, pressed);
    if (verb) this.hint = { verb, startedAt: now, seq, confirmed: false, shown: false };
  }

  /**
   * One client tick (30 per second): stamps the input with the next sequence number, sends it
   * and applies it to the predicted body. Returns the input as sent.
   */
  tickInput(sample: Omit<PlayerInput, 'seq'>, now: number): PlayerInput {
    const input: PlayerInput = { ...sample, seq: ++this.seq };
    this.callbacks.sendInput(input);
    this.stats.inputs++;
    const snap = this.latest;
    const body = snap ? this.localBody(snap) : null;
    if (snap && body && this.mirror.trusted) {
      const playing = snap.match.phase === 'playing';
      if (body.kaiju && playing) this.updateHint(input.buttons, body.kaiju, now, input.seq);
      const { moving, params, drive, hold } = this.paramsFor(body, snap, now);
      predictStep(this.predictor, input, this.mirror.query, params, moving, drive, hold ? hold.free : params);
    }
    this.lastButtons = input.buttons;
    return input;
  }

  // --- per frame -------------------------------------------------------------------------------

  /**
   * Produces the state to draw at local time `now` and releases the events whose tick the view
   * has reached. Returns null until the first snapshot has arrived.
   */
  sample(now: number, dt: number): FrameState | null {
    const frameTime = now - this.lastSampleAt;
    this.lastSampleAt = now;
    if (frameTime > 0) {
      if (frameTime >= REPORT_FREEZE) this.report.freezes++;
      this.report.frameMax = Math.max(this.report.frameMax, frameTime);
    }
    const tick = renderTick(this.clock, now);
    const sampled = sampleSnapshots(this.buffer, tick);
    if (!sampled) {
      this.releaseEvents(Number.POSITIVE_INFINITY, now);
      return null;
    }
    const snap = sampled.snap;
    const frame: FrameState = {
      tick,
      match: snap.match,
      kaijus: sampled.kaijus,
      squads: snap.squads,
      units: sampled.units,
      crates: snap.crates,
      bounds: this.boundsFor(snap.match.stage),
      localUnit: null,
      localKaiju: null,
    };

    decayPredictionError(this.predictor, dt);
    this.placeLocal(frame);
    this.frame = frame;
    this.releaseEvents(tick, now);
    return frame;
  }

  /**
   * Puts the local player's body into a frame at its predicted place, `localAlpha` of the way
   * through the newest input tick's step, and points its aim where the player is looking.
   */
  private placeLocal(frame: FrameState): void {
    const usePrediction = this.predictor.ready && this.mirror.trusted;
    if (this.role.kind === 'kaiju') {
      const k = frame.kaijus[this.role.kaijuId];
      if (k) {
        frame.localKaiju = k;
        const latest = this.latest?.kaijus[this.role.kaijuId];
        if (usePrediction && latest && latest.stage === k.stage) {
          const pose = predictedPose(this.predictor, this.pose, this.localAlpha);
          k.x = pose.x;
          k.z = pose.z;
          k.yaw = pose.yaw;
          k.vx = this.predictor.body.vx;
          k.vz = this.predictor.body.vz;
          // The head follows the player's aim at once, except while the beam drags it.
          const def = kaijuKindDef(k.kind);
          const helpless = k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead';
          const beaming = k.action === 'special' && k.phase === def.actions.special.activePhase;
          if (!helpless && !beaming) {
            k.aimYaw = clampAngleAround(this.aimYaw, k.yaw, def.headLeadMax);
            k.aimPitch = this.aimPitch;
          }
        }
      }
    } else if (this.role.kind === 'human') {
      const squad = frame.squads[this.role.squadId];
      const u = squad && squad.driven >= 0 ? frame.units[squad.driven] : undefined;
      if (u) {
        frame.localUnit = u;
        const latest = this.latest?.units[u.id];
        if (usePrediction && latest && latest.type === u.type && latest.alive && this.predictedKey === `u${u.id}t${u.type}`) {
          const pose = predictedPose(this.predictor, this.pose, this.localAlpha);
          u.x = pose.x;
          u.z = pose.z;
          u.yaw = pose.yaw;
          u.vx = this.predictor.body.vx;
          u.vz = this.predictor.body.vz;
          // A tank's turret swings toward the aim at its own rate (predicted with the hull); any
          // other unit's weapon points where the player looks.
          u.aimYaw = predictedTurret(this.predictor, this.localAlpha) ?? this.aimYaw;
          u.aimPitch = this.aimPitch;
        }
      }
    }
  }

  /**
   * Call once per frame after this frame's input ticks have run and the controller has turned
   * the view: places the local body again, `alpha` (0..1) of a tick past the newest input tick.
   * The body is predicted in 30 steps a second; drawing it part of the way through the newest
   * step makes it move on every frame, at any frame rate. (`sample` has already placed it once,
   * with the previous frame's fraction, so that the controller had something to steer by.)
   */
  refreshLocal(alpha: number): void {
    this.localAlpha = Math.min(1, Math.max(0, alpha));
    if (this.frame) this.placeLocal(this.frame);
  }

  /**
   * The wind-up the local kaiju should be showing ahead of the server, or null. `k` is the kaiju
   * as DRAWN, which is about 100 ms behind the newest snapshot: the hint is kept while that view
   * still shows the kaiju idle and on while it shows the phase the press led to, so that the
   * renderer can carry on from the time already shown instead of starting the wind-up again.
   * It ends when the drawn kaiju moves on (the strike lands, a stagger cuts in), is idle again
   * afterwards, or was never answered.
   */
  hintFor(k: SnapKaiju, now: number): ActionHint | null {
    const hint = this.hint;
    if (!hint || this.role.kind !== 'kaiju' || k.id !== this.role.kaijuId) return null;
    if (k.phase === 'idle') {
      if (!hint.shown && now - hint.startedAt <= HINT_DRAW_TIMEOUT) return hint;
    } else if (k.phase === hintPhase(hint.verb, k.kind)) {
      hint.shown = true;
      return hint;
    }
    this.hint = null;
    return null;
  }

  private releaseEvents(tick: number, now: number): void {
    const queue = this.queue;
    let n = 0;
    while (n < queue.length && (queue[n].event.tick <= tick || now - queue[n].arrivedAt > EVENT_MAX_WAIT)) n++;
    if (n === 0) return;
    const due = queue.splice(0, n);
    // The oldest has waited far longer than any event does while frames run: this is the backlog
    // of a hidden tab or a stalled page. All of it is past; none of it is played back.
    this.catchingUp = now - due[0].arrivedAt > EVENT_STALE_AFTER;
    for (const q of due) {
      try {
        this.callbacks.onEvent(q.event);
      } catch (err) {
        console.warn(`event handler failed for "${q.event.type}"`, err);
      }
    }
    this.catchingUp = false;
  }
}
