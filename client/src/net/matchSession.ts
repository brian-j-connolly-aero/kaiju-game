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
  decodeSnapshot,
  kaijuKindDef,
  kaijuMoveParams,
  kaijuStageDef,
  stageBounds,
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
  type SnapKaiju,
  type SnapMatch,
  type SnapSquad,
  type SnapUnit,
  type Snapshot,
  type SquadCommand,
  type StageId,
  type WelcomeMessage,
} from '@mb/shared';
import { applyCityEvent, createCityMirror, resyncCityMirror, type CityMirror } from './cityMirror';
import { createPredictor, decayPredictionError, predictedPose, predictStep, reconcile, resetPredictor, type Predictor } from './prediction';
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

/** The phase a verb's press leads into (what the drawn kaiju shows once the server's state arrives). */
function hintPhase(verb: KaijuVerb): KaijuPhase {
  return verb === 'brace' ? 'brace' : verb === 'roar' ? 'roar' : 'windup';
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
  if (hint.verb === 'roar') return { action: 'roar', phase: 'roar', phaseTime: Math.min(elapsed, def.timing.active), phaseDuration: def.timing.active };
  return { action: hint.verb, phase: 'windup', phaseTime: Math.min(elapsed, def.timing.windup), phaseDuration: def.timing.windup };
}

export interface SessionCallbacks {
  sendInput(input: PlayerInput): void;
  sendCommand(command: SquadCommand): void;
  /** A simulation event whose moment on screen has come. */
  onEvent(event: SimEvent): void;
  /** The mirrored city was replaced wholesale (reconnection): redraw every structure and prop. */
  onCityResync(): void;
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

  private readonly callbacks: SessionCallbacks;
  private queue: QueuedEvent[] = [];
  private seq = 0;
  private boundsCache: { stage: StageId; bounds: Bounds } | null = null;
  private readonly params = {} as MoveParams;
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
    this.stats.snapshots++;
    this.stats.snapshotBytes += bytes.length;
    this.stats.lastSnapshotAt = now;
    this.reconcileFrom(snap);
  }

  handleEvents(events: SimEvent[], now: number): void {
    for (const event of events) {
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

  private kaijuParams(k: SnapKaiju, bounds: Bounds, now: number): MoveParams {
    let state: KaijuMoveState = k;
    const hint = this.predictedHint(k, now);
    if (hint) state = { kind: k.kind, stage: k.stage, nerve: k.nerve, action: hint.verb, phase: 'windup' };
    return kaijuMoveParams(state, bounds, undefined, this.params);
  }

  private paramsFor(body: { kaiju: SnapKaiju | null; unit: SnapUnit | null }, snap: Snapshot, now: number): { params: MoveParams; radius: number } {
    const bounds = this.boundsFor(snap.match.stage);
    if (body.kaiju) {
      return { params: this.kaijuParams(body.kaiju, bounds, now), radius: kaijuStageDef(body.kaiju.kind, body.kaiju.stage).bodyRadius };
    }
    const u = body.unit as SnapUnit;
    const def = unitTypeDef(u.type);
    return { params: unitMoveParams(def, u, bounds, undefined, this.params), radius: def.radius };
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
    if (hint && !hint.confirmed && body.kaiju) {
      if (body.kaiju.phase !== 'idle') hint.confirmed = true;
      // The server has had the press and the kaiju is still idle: it was refused. Stop pretending.
      else if (snap.ackSeq >= hint.seq) this.hint = null;
    }
    const { params, radius } = this.paramsFor(body, snap, now);
    const server = body.kaiju ?? (body.unit as SnapUnit);
    reconcile(this.predictor, server, radius, snap.ackSeq, this.mirror.query, params, snap.match.phase === 'playing');
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
    // The view is still showing the tail of the last action: a hint now would be cut off by it.
    const drawn = this.frame?.localKaiju;
    if (drawn && drawn.phase !== 'idle') return;
    const def = kaijuKindDef(k.kind);
    let verb: KaijuVerb | null = null;
    if (buttons & Btn.block) verb = 'brace';
    else if (pressed & Btn.special && k.rage >= def.actions.special.rageCost) verb = 'special';
    else if (pressed & Btn.roar && k.cooldowns.roar <= 0) verb = 'roar';
    else if (pressed & Btn.strike) verb = k.held ? 'throw' : 'swipe';
    else if (pressed & Btn.grab && !k.held) verb = 'grab';
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
      const { params } = this.paramsFor(body, snap, now);
      predictStep(this.predictor, input, this.mirror.query, params, playing);
    }
    this.lastButtons = input.buttons;
    return input;
  }

  sendCommand(command: SquadCommand): void {
    this.callbacks.sendCommand(command);
  }

  // --- per frame -------------------------------------------------------------------------------

  /**
   * Produces the state to draw at local time `now` and releases the events whose tick the view
   * has reached. Returns null until the first snapshot has arrived.
   */
  sample(now: number, dt: number): FrameState | null {
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
          u.aimYaw = this.aimYaw;
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
    } else if (k.phase === hintPhase(hint.verb)) {
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
