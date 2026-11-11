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
  type KaijuMoveState,
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

export interface SessionCallbacks {
  sendInput(input: PlayerInput): void;
  sendCommand(command: SquadCommand): void;
  /** A simulation event whose moment on screen has come. */
  onEvent(event: SimEvent): void;
  /** The mirrored city was replaced wholesale (reconnection): redraw every structure and prop. */
  onCityResync(): void;
}

const HINT_TIMEOUT = 0.35;
/** Events are released no later than this long after they arrived, whatever the clock says. */
const EVENT_MAX_WAIT = 1.2;

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
  hint: ActionHint | null = null;
  /** Counters for the debug overlay and the automation hook. */
  stats = { snapshots: 0, events: 0, inputs: 0, lastSnapshotAt: 0 };

  private readonly callbacks: SessionCallbacks;
  private queue: QueuedEvent[] = [];
  private seq = 0;
  private boundsCache: { stage: StageId; bounds: Bounds } | null = null;
  private readonly params = {} as MoveParams;
  private predictedKey = '';
  private lastButtons = 0;
  private readonly pose = { x: 0, z: 0, yaw: 0 };

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
    const hint = this.activeHint(k, now);
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
    const { params, radius } = this.paramsFor(body, snap, now);
    const server = body.kaiju ?? (body.unit as SnapUnit);
    reconcile(this.predictor, server, radius, snap.ackSeq, this.mirror.query, params, snap.match.phase === 'playing');
  }

  private activeHint(k: SnapKaiju, now: number): ActionHint | null {
    const hint = this.hint;
    if (!hint) return null;
    // The server's own state has taken over, or the press was refused: drop the hint.
    if (k.phase !== 'idle' || now - hint.startedAt > HINT_TIMEOUT) {
      this.hint = null;
      return null;
    }
    return hint;
  }

  /** Works out which wind-up a fresh button press will start, so it can be shown at once. */
  private updateHint(buttons: number, k: SnapKaiju, now: number): void {
    const pressed = buttons & ~this.lastButtons;
    if (pressed === 0 || k.phase !== 'idle' || !k.alive || this.hint) return;
    const def = kaijuKindDef(k.kind);
    let verb: KaijuVerb | null = null;
    if (buttons & Btn.block) verb = 'brace';
    else if (pressed & Btn.special && k.rage >= def.actions.special.rageCost) verb = 'special';
    else if (pressed & Btn.roar && k.cooldowns.roar <= 0) verb = 'roar';
    else if (pressed & Btn.strike) verb = k.held ? 'throw' : 'swipe';
    else if (pressed & Btn.grab && !k.held) verb = 'grab';
    if (verb) this.hint = { verb, startedAt: now };
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
      if (body.kaiju && playing) this.updateHint(input.buttons, body.kaiju, now);
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
    const usePrediction = this.predictor.ready && this.mirror.trusted;
    if (this.role.kind === 'kaiju') {
      const k = frame.kaijus[this.role.kaijuId];
      if (k) {
        frame.localKaiju = k;
        const latest = this.latest?.kaijus[this.role.kaijuId];
        if (usePrediction && latest && latest.stage === k.stage) {
          const pose = predictedPose(this.predictor, this.pose);
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
          const pose = predictedPose(this.predictor, this.pose);
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
    this.frame = frame;
    this.releaseEvents(tick, now);
    return frame;
  }

  /** The wind-up the local kaiju should already be showing, or null. */
  hintFor(k: SnapKaiju, now: number): ActionHint | null {
    return this.role.kind === 'kaiju' && k.id === this.role.kaijuId ? this.activeHint(k, now) : null;
  }

  private releaseEvents(tick: number, now: number): void {
    const queue = this.queue;
    let n = 0;
    while (n < queue.length && (queue[n].event.tick <= tick || now - queue[n].arrivedAt > EVENT_MAX_WAIT)) n++;
    if (n === 0) return;
    const due = queue.splice(0, n);
    for (const q of due) {
      try {
        this.callbacks.onEvent(q.event);
      } catch (err) {
        console.warn(`event handler failed for "${q.event.type}"`, err);
      }
    }
  }
}
