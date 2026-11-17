import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  beginStage,
  Btn,
  createMatchConfig,
  createWorld,
  DEG,
  DT,
  encodeSnapshot,
  idleBots,
  kaijuKindDef,
  kaijuStageDef,
  snapshotOfWorld,
  unitTypeDef,
  welcomeFor,
  type Hit,
  type PlayerInput,
  type SimEvent,
  type StageId,
  type World,
} from '@mb/shared';
import { squadIsOut } from '../src/game/controllers/types';
import { InputTicker } from '../src/game/input/inputTicker';
import { hintPose, MatchSession, type FrameState } from '../src/net/matchSession';

/**
 * A real simulation and a real MatchSession joined by a link with a delay, with the client's
 * frame loop run the way MatchRuntime.update runs it: sample, the input ticks that are due,
 * then the local body placed for this frame. Time moves in steps of one millisecond.
 */
class Rig {
  readonly world: World;
  readonly session: MatchSession;
  readonly player: number;
  /** Local time, seconds. */
  now = 100;
  /** One-way delay of the link, seconds. */
  oneWay: number;
  fps: number;
  /** The buttons and the stick for the next input ticks. */
  control: Omit<PlayerInput, 'seq'> = { moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0 };
  /** Inputs for which this answers true never reach the server (a refused or lost press). */
  dropInput: (input: PlayerInput) => boolean = () => false;
  /** Every event the session released, with whether it was handed out as a backlog. */
  readonly released: Array<{ event: SimEvent; past: boolean }> = [];
  /** Every event the server's world produced, in order. */
  readonly emitted: SimEvent[] = [];
  frame: FrameState | null = null;
  /** Input ticks the newest frame sent. */
  ticksLastFrame = 0;

  private readonly ticker = new InputTicker();
  private readonly toServer: Array<{ at: number; input: PlayerInput }> = [];
  private readonly toClient: Array<{ at: number; deliver: () => void }> = [];
  private pendingEvents: SimEvent[] = [];
  private nextTick: number;
  private nextFrame: number;
  private lastFrame: number;
  private ms = 0;

  constructor(options: { role: 'kaiju' | 'human'; stage?: StageId; seed?: number; roundTripMs?: number; fps?: number; idle?: boolean; openGround?: boolean }) {
    const config = createMatchConfig({ humans: [{ name: 'Tester', role: options.role }], fast: false, anchor: 1 });
    if (options.idle !== false) config.bots = idleBots();
    const world = createWorld({ seed: options.seed ?? 5, config });
    for (let i = 0; i < 2000 && world.match.phase !== 'playing'; i++) world.step([]);
    if (world.match.phase !== 'playing') throw new Error('the match did not start');
    if (options.stage && options.stage > 1) beginStage(world, options.stage);
    // Every structure flattened (for the server and, through the welcome, for the client): open
    // ground, so a body driven straight is not stopped by a wall.
    if (options.openGround) {
      world.structureHp.fill(0);
      world.structureStage.fill(3);
    }
    this.world = world;
    this.player = options.role === 'kaiju' ? 0 : 1;
    this.oneWay = (options.roundTripMs ?? 0) / 2000;
    this.fps = options.fps ?? 60;
    this.session = new MatchSession(welcomeFor(world, this.player), {
      sendInput: (input) => {
        if (!this.dropInput(input)) this.toServer.push({ at: this.now + this.oneWay, input });
      },
      onEvent: (event) => this.released.push({ event, past: this.session.catchingUp }),
      onCityResync: () => undefined,
    });
    this.nextTick = this.now + DT;
    this.nextFrame = this.now + 1 / this.fps;
    this.lastFrame = this.now;
    this.sendSnapshot();
  }

  private sendSnapshot(): void {
    const bytes = encodeSnapshot(snapshotOfWorld(this.world, this.world.players[this.player].input.seq));
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.toClient.push({
      at: this.now + this.oneWay,
      deliver: () => {
        if (events.length > 0) this.session.handleEvents(events, this.now);
        this.session.handleSnapshot(bytes, this.now);
      },
    });
  }

  private serverTick(): void {
    const inputs: PlayerInput[] = [];
    // One input per tick, as the server takes them.
    if (this.toServer.length > 0 && this.toServer[0].at <= this.now) inputs[this.player] = (this.toServer.shift() as { input: PlayerInput }).input;
    const events = this.world.step(inputs);
    this.emitted.push(...events);
    this.pendingEvents.push(...events);
    if (this.world.tick % 2 === 0) this.sendSnapshot();
  }

  /**
   * Runs for `seconds`. With `frames` false the page draws nothing (a hidden tab): messages are
   * still handled. `onFrame` sees every frame after the local body has been placed.
   */
  run(seconds: number, onFrame: ((frame: FrameState, now: number, dt: number) => void) | null = null, frames = true): void {
    const steps = Math.round(seconds * 1000);
    for (let i = 0; i < steps; i++) {
      this.ms++;
      this.now = 100 + this.ms / 1000;
      while (this.now >= this.nextTick - 1e-9) {
        this.nextTick += DT;
        this.serverTick();
      }
      while (this.toClient.length > 0 && this.toClient[0].at <= this.now + 1e-9) (this.toClient.shift() as { deliver: () => void }).deliver();
      if (this.now >= this.nextFrame - 1e-9) {
        this.nextFrame += 1 / this.fps;
        if (!frames) continue;
        const dt = Math.min(0.25, this.now - this.lastFrame);
        this.lastFrame = this.now;
        const frame = this.session.sample(this.now, dt);
        this.frame = frame;
        if (!frame) continue;
        // As MatchRuntime.update: the input ticks follow the real clock, not the clamped `dt`.
        const ticks = this.ticker.advanceTo(this.now, dt);
        this.ticksLastFrame = ticks;
        for (let t = 0; t < ticks; t++) this.session.tickInput(this.control, this.now);
        this.session.refreshLocal(this.ticker.alpha);
        onFrame?.(frame, this.now, dt);
      }
    }
  }
}

describe('the local body between input ticks', () => {
  for (const fps of [60, 144]) {
    for (const roundTripMs of [0, 80]) {
      it(`moves a tank the same distance every frame at ${fps} frames a second (${roundTripMs} ms round trip)`, () => {
        const rig = new Rig({ role: 'human', stage: 2, roundTripMs, fps, openGround: true });
        const speed = unitTypeDef('army_tank').speed;
        rig.run(0.5);
        const u = rig.frame?.localUnit;
        if (!u) throw new Error('no local unit');
        // Drive straight ahead along the hull.
        rig.control = { moveX: 0, moveZ: 1, aimYaw: u.yaw, aimPitch: 0, buttons: 0 };
        rig.run(1.5);
        // Per frame: how far the drawn body moved, the frame's length, and how far the newest
        // input tick moved the predicted body (the step the drawn body is sliding through).
        const frames: Array<{ moved: number; dt: number; tickStep: number }> = [];
        let last: { x: number; z: number } | null = null;
        rig.run(1.5, (frame, _now, dt) => {
          const me = frame.localUnit;
          if (!me) return;
          const p = rig.session.predictor;
          if (last) frames.push({ moved: Math.hypot(me.x - last.x, me.z - last.z), dt, tickStep: Math.hypot(p.stepX, p.stepZ) });
          last = { x: me.x, z: me.z };
        });
        expect(frames.length).toBeGreaterThan(fps);
        // The tank does drive at its top speed (most of the time: a river slows it).
        const ideal = speed / fps;
        const sorted = frames.map((f) => f.moved).sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        expect(median).toBeGreaterThan(ideal * 0.93);
        expect(median).toBeLessThan(ideal * 1.07);
        // Every frame moves the body by this frame's share of a tick's step: never by nothing,
        // never by a whole step at once. (Before the body was drawn between ticks the steps were
        // 0 and 0.5 m by turns at 60 frames a second, and 0.5 m every fifth frame at 144.)
        for (let i = 1; i < frames.length; i++) {
          const f = frames[i];
          const share = f.dt / DT;
          const lo = Math.min(f.tickStep, frames[i - 1].tickStep) * share;
          const hi = Math.max(f.tickStep, frames[i - 1].tickStep) * share;
          expect(f.moved, `frame ${i}`).toBeGreaterThan(lo * 0.93 - 0.002);
          expect(f.moved, `frame ${i}`).toBeLessThan(hi * 1.07 + 0.002);
        }
      });
    }
  }

  it('turns the hatchling evenly while the body lags behind the view', () => {
    for (const fps of [60, 144]) {
      const rig = new Rig({ role: 'kaiju', fps, roundTripMs: 40 });
      rig.run(0.5);
      const k0 = rig.frame?.localKaiju;
      if (!k0) throw new Error('no local kaiju');
      const turnRate = kaijuStageDef(k0.kind, 1).turnRate;
      // Ask for a heading the body needs a good half second to reach.
      const aim = k0.yaw + 140 * DEG;
      rig.session.aimYaw = aim;
      rig.control = { moveX: 0, moveZ: 0, aimYaw: aim, aimPitch: 0, buttons: 0 };
      rig.run(0.15);
      const rates: number[] = [];
      let last: number | null = null;
      rig.run(0.3, (frame, _now, dt) => {
        const k = frame.localKaiju;
        if (!k) return;
        if (last !== null) rates.push(angleDiff(k.yaw, last) / dt);
        last = k.yaw;
      });
      expect(rates.length).toBeGreaterThan(fps * 0.2);
      // Every frame turns at the body's turn rate: none stands still, none takes two steps.
      for (const rate of rates) {
        expect(rate, `${fps} fps`).toBeGreaterThan(turnRate * 0.85);
        expect(rate, `${fps} fps`).toBeLessThan(turnRate * 1.15);
      }
    }
  });
});

describe("the local kaiju's own wind-up", () => {
  /** What is posed for the local kaiju on a frame: the hint's pose, or the snapshot's own state. */
  function shown(rig: Rig, frame: FrameState, now: number): { phase: string; action: string; time: number } {
    const k = frame.localKaiju;
    if (!k) throw new Error('no local kaiju');
    const pose = hintPose(k, rig.session.hintFor(k, now), now);
    return pose ? { phase: pose.phase, action: pose.action, time: pose.phaseTime } : { phase: k.phase, action: k.action, time: k.phaseTime };
  }

  for (const roundTripMs of [10, 80, 150, 300]) {
    it(`starts at once and never starts over (${roundTripMs} ms round trip)`, () => {
      const rig = new Rig({ role: 'kaiju', roundTripMs });
      rig.run(1);
      const windup = kaijuKindDef('lizard').actions.swipe.timing.windup;
      // A strike tap: the button is down for three input ticks.
      rig.control = { ...rig.control, buttons: Btn.strike };
      const pressedAt = rig.now;
      const seen: Array<{ t: number; phase: string; action: string; time: number }> = [];
      rig.run(0.1, (frame, now) => seen.push({ t: now - pressedAt, ...shown(rig, frame, now) }));
      rig.control = { ...rig.control, buttons: 0 };
      rig.run(1.6, (frame, now) => seen.push({ t: now - pressedAt, ...shown(rig, frame, now) }));

      const first = seen.findIndex((s) => s.phase === 'windup');
      const strike = seen.findIndex((s) => s.phase === 'active');
      expect(first).toBeGreaterThanOrEqual(0);
      expect(strike).toBeGreaterThan(first);
      // The wind-up is on screen within two frames and a tick of the press, whatever the latency.
      expect(seen[first].t).toBeLessThan(DT + 2 / 60 + 0.005);
      // From there to the strike: always winding up, always the same action, time never going back.
      let before = -1;
      for (let i = first; i < strike; i++) {
        expect(seen[i].phase, `at +${Math.round(seen[i].t * 1000)} ms`).toBe('windup');
        expect(seen[i].action).toBe('swipe');
        expect(seen[i].time, `at +${Math.round(seen[i].t * 1000)} ms`).toBeGreaterThanOrEqual(before - 1e-6);
        expect(seen[i].time).toBeLessThanOrEqual(windup + 1e-6);
        before = seen[i].time;
      }
      // The whole wind-up was shown before the strike landed.
      expect(before).toBeGreaterThan(windup - 0.07);
      // And it ends: back to idle, with the hint gone.
      expect(seen[seen.length - 1].phase).toBe('idle');
      expect(rig.session.hint).toBeNull();
    });
  }

  it('shows a brace from the press to the release without a gap', () => {
    const rig = new Rig({ role: 'kaiju', roundTripMs: 120 });
    // The brace is a move picked at a molt, held on its move button (net/input.ts).
    rig.world.kaijus[0].moves = ['brace', 'none'];
    rig.run(1);
    rig.control = { ...rig.control, buttons: Btn.move1 };
    const phases: string[] = [];
    rig.run(0.8, (frame, now) => phases.push(shown(rig, frame, now).phase));
    const first = phases.indexOf('brace');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(4);
    for (let i = first; i < phases.length; i++) expect(phases[i], `frame ${i}`).toBe('brace');
    rig.control = { ...rig.control, buttons: 0 };
    rig.run(0.6, (frame, now) => phases.push(shown(rig, frame, now).phase));
    expect(phases[phases.length - 1]).toBe('idle');
    expect(rig.session.hint).toBeNull();
  });

  it('drops a wind-up the server never answered as soon as the server has had the press', () => {
    const roundTripMs = 100;
    const rig = new Rig({ role: 'kaiju', roundTripMs });
    rig.run(1);
    // The press never reaches the server; the inputs after it do.
    rig.dropInput = (input) => (input.buttons & Btn.strike) !== 0;
    rig.control = { ...rig.control, buttons: Btn.strike };
    const pressedAt = rig.now;
    const seen: Array<{ t: number; phase: string }> = [];
    rig.run(0.1, (frame, now) => seen.push({ t: now - pressedAt, phase: shown(rig, frame, now).phase }));
    rig.control = { ...rig.control, buttons: 0 };
    rig.run(1, (frame, now) => seen.push({ t: now - pressedAt, phase: shown(rig, frame, now).phase }));
    expect(seen.some((s) => s.phase === 'windup')).toBe(true);
    const lastWindup = Math.max(...seen.filter((s) => s.phase === 'windup').map((s) => s.t));
    // Gone a round trip and a couple of snapshots after the release, not after a fixed long wait.
    expect(lastWindup).toBeLessThan(0.1 + roundTripMs / 1000 + 4 * DT + 0.05);
    expect(rig.session.hint).toBeNull();
    expect(rig.world.kaijus[0].phase).toBe('idle');
  });
});

describe('a page that freezes or draws slowly', () => {
  it('sends every input it owes on the first frame after a freeze, so its inputs are not late for good', () => {
    // Round 5, the third playtest: a page that froze for 0.5 s sent only 8 inputs (a quarter
    // second) on its next frame, so every later input reached the server a few ticks after its
    // tick: played as a guess and thrown away, and the body stopped and snapped back.
    const rig = new Rig({ role: 'human', stage: 1, roundTripMs: 60 });
    rig.run(1);
    const sent = rig.session.stats.inputs;
    rig.run(0.5, null, false);
    expect(rig.session.stats.inputs).toBe(sent);
    rig.run(1 / 60 + 0.002);
    expect(rig.ticksLastFrame).toBeGreaterThanOrEqual(15);
    expect(rig.ticksLastFrame).toBeLessThanOrEqual(16);
    // Over the whole stretch the page sent one input per tick of time.
    const elapsed = 0.5 + 1 / 60 + 0.002;
    expect(Math.abs(rig.session.stats.inputs - sent - elapsed / DT)).toBeLessThanOrEqual(1);
  });

  it('keeps sending thirty inputs a second at three frames a second', () => {
    // A browser drawing without its graphics card: frames of 0.28 s, which play as 0.25 s.
    const rig = new Rig({ role: 'human', stage: 1, roundTripMs: 60, fps: 3.6 });
    rig.run(1);
    const sent = rig.session.stats.inputs;
    rig.run(10);
    expect(Math.abs(rig.session.stats.inputs - sent - 10 / DT)).toBeLessThanOrEqual(2);
  });
});

describe('events a hidden tab missed', () => {
  it('are handed out as a backlog, in one go, and the next ones play as usual', () => {
    const rig = new Rig({ role: 'human', stage: 3, roundTripMs: 60, idle: false, seed: 9001 });
    rig.run(2);
    const before = rig.released.length;
    expect(rig.released.every((r) => !r.past)).toBe(true);

    // Thirty seconds with no frames: the socket still delivers, nothing is drawn.
    rig.run(30, null, false);
    expect(rig.released.length).toBe(before);

    // The first frame back.
    rig.run(1 / 60 + 0.002);
    const backlog = rig.released.slice(before);
    expect(backlog.length).toBeGreaterThan(200);
    expect(backlog.every((r) => r.past)).toBe(true);
    expect(rig.session.catchingUp).toBe(false);
    // Nothing of the backlog is left for later (every event older than the link's delay and a
    // little slack is out; a quiet second in the match must not count against it), and the city
    // the session mirrors is the server's.
    const out = new Set(rig.released.map((r) => r.event));
    const due = rig.emitted.filter((e) => e.tick <= rig.world.tick - 0.3 / DT);
    expect(due.length).toBeGreaterThan(200);
    expect(due.filter((e) => !out.has(e))).toEqual([]);
    for (let i = 0; i < rig.world.structureStage.length; i++) expect(rig.session.mirror.structureStage[i]).toBe(rig.world.structureStage[i]);

    // Play goes on: what happens now is shown as it happens.
    const mark = rig.released.length;
    rig.run(3);
    const fresh = rig.released.slice(mark);
    expect(fresh.length).toBeGreaterThan(10);
    expect(fresh.every((r) => !r.past)).toBe(true);
  });

  it('does not call a short hitch a backlog', () => {
    const rig = new Rig({ role: 'human', stage: 3, roundTripMs: 60, idle: false, seed: 9001 });
    rig.run(2);
    const mark = rig.released.length;
    rig.run(0.8, null, false);
    rig.run(1);
    const after = rig.released.slice(mark);
    expect(after.length).toBeGreaterThan(5);
    expect(after.every((r) => !r.past)).toBe(true);
  });
});

describe('the view when the driven unit dies', () => {
  /** A blow no unit survives, as the kaiju's swipe queues it. */
  const blow = (): Hit => ({ damage: 5000, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: 0, kind: 'swipe', atWill: false });

  it('stays with the squad for the snapshot between the death and the takeover', () => {
    const config = createMatchConfig({ humans: [{ name: 'Tester', role: 'human' }], fast: false, anchor: 1 });
    config.bots = idleBots();
    const world = createWorld({ seed: 11, config });
    for (let i = 0; i < 2000 && world.match.phase !== 'playing'; i++) world.step([]);
    const squadId = welcomeFor(world, 1).squadId;
    const driven = world.squads[squadId].driven;
    // Something destroys the leader on this tick.
    world.hits.push({ target: { entity: 'unit', id: driven }, hit: blow() });
    world.step([]);
    const dead = snapshotOfWorld(world, 0);
    const leader = dead.units[dead.squads[squadId].driven];
    // The snapshot of the tick of the death still names the dead unit as the one driven...
    expect(leader.alive).toBe(false);
    // ...which used to send the player to the drone for a few frames. The squad is not out.
    expect(squadIsOut(dead.squads, squadId)).toBe(false);
    world.step([]);
    const next = snapshotOfWorld(world, 0);
    expect(next.squads[squadId].driven).not.toBe(driven);
    expect(next.units[next.squads[squadId].driven].alive).toBe(true);
    expect(squadIsOut(next.squads, squadId)).toBe(false);

    // With every unit gone the squad is out and the drone takes over.
    for (let i = 0; i < 6; i++) {
      for (const u of world.units) {
        if (u.squad === squadId && u.alive) world.hits.push({ target: { entity: 'unit', id: u.id }, hit: blow() });
      }
      world.step([]);
    }
    expect(squadIsOut(snapshotOfWorld(world, 0).squads, squadId)).toBe(true);
    expect(squadIsOut([], 3)).toBe(true);
  });
});

describe('the local unit through a stun and the molt blast (round 4: corrections the game made itself)', () => {
  /** The biggest jump of the prediction (`Predictor.lastJump`) per snapshot while `seconds` run. */
  function worstJump(rig: Rig, seconds: number): number {
    let worst = 0;
    let seen = rig.session.stats.snapshots;
    rig.run(seconds, () => {
      if (rig.session.stats.snapshots === seen) return;
      seen = rig.session.stats.snapshots;
      worst = Math.max(worst, rig.session.predictor.lastJump);
    });
    return worst;
  }

  it('lets the body walk on when the stun runs out, as the server does, instead of pulling it forward', () => {
    const rig = new Rig({ role: 'human', roundTripMs: 160, openGround: true });
    rig.control = { moveX: 0, moveZ: 1, aimYaw: 0.3, aimPitch: 0, buttons: 0 };
    rig.run(1);
    const leader = rig.world.units[rig.world.squads[rig.session.role.squadId].driven];
    // A roar freezes the leader for 0.8 s while the player keeps walking.
    rig.world.hits.push({
      target: { entity: 'unit', id: leader.id },
      hit: { damage: 0, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: 0, kind: 'roar', atWill: false, stun: 0.8 },
    });
    // The stun itself is a surprise the page learns of a snapshot later; what follows is not.
    rig.run(0.4);
    expect(leader.stun).toBeGreaterThan(0);
    const after = worstJump(rig, 1.6);
    expect(leader.stun).toBe(0);
    // Before, the page held the body frozen for every input it replayed from a snapshot that
    // still showed the stun (rounded to 0.05 s), and was pulled forward at its end.
    expect(after).toBeLessThan(0.02);
  });

  it("slides on with the molt blast's push in the intermission, as the server does", () => {
    const rig = new Rig({ role: 'human', roundTripMs: 160, openGround: true });
    rig.run(0.5);
    const leader = rig.world.units[rig.world.squads[rig.session.role.squadId].driven];
    // The molt's blast wave throws the leader, and the intermission begins (matchFlow.ts).
    rig.world.match.phase = 'intermission';
    rig.world.match.phaseTime = 5;
    leader.vx = 24;
    leader.vz = 12;
    rig.run(0.3);
    const after = worstJump(rig, 1.5);
    expect(Math.hypot(leader.vx, leader.vz)).toBe(0);
    // Before, the page held the body still outside play and caught up with it a snapshot at a
    // time, two meters and more each.
    expect(after).toBeLessThan(0.02);
  });
});

describe("the local kaiju's own attacks (round 4: corrections the game made itself)", () => {
  it('walks on through a swipe and a stomp exactly as the server moves it, from the press to the end', () => {
    const rig = new Rig({ role: 'kaiju', roundTripMs: 160, openGround: true });
    const walk = { moveX: 0, moveZ: 1, aimYaw: 0.4, aimPitch: 0, buttons: 0 };
    rig.control = { ...walk };
    rig.run(1);
    let worst = 0;
    let seen = rig.session.stats.snapshots;
    const watch = (frame: FrameState, now: number): void => {
      // As the match runtime does every frame: the hint lives as long as the drawn kaiju needs it.
      if (frame.localKaiju) rig.session.hintFor(frame.localKaiju, now);
      if (rig.session.stats.snapshots === seen) return;
      seen = rig.session.stats.snapshots;
      worst = Math.max(worst, rig.session.predictor.lastJump);
    };
    const actions = (): string[] => rig.emitted.flatMap((e) => (e.type === 'kaijuAction' ? [`${e.action}/${e.phase}`] : []));
    for (const button of [Btn.strike, Btn.stomp]) {
      // A tap while walking: one input tick with the button down.
      rig.control = { ...walk, buttons: button };
      rig.run(1 / 30, watch);
      rig.control = { ...walk };
      rig.run(2.5, watch);
    }
    expect(actions()).toContain('swipe/active');
    expect(actions()).toContain('stomp/active');
    // Before, the page moved the body at the attack's slower pace for every input it replayed
    // from a snapshot taken during the attack, and at walking pace for those replayed before
    // the server had the press: a correction of a third to half a meter at each end of it.
    expect(worst).toBeLessThan(0.02);
  });
});
