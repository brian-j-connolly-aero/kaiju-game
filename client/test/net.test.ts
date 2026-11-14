import { describe, expect, it } from 'vitest';
import {
  bitGet,
  Btn,
  createMatchConfig,
  createWorld,
  decodeSnapshot,
  DT,
  encodeSnapshot,
  idleBots,
  kaijuMoveParams,
  kaijuStageDef,
  snapshotOfWorld,
  stageBounds,
  welcomeFor,
  type PlayerInput,
  type Snapshot,
  type World,
} from '@mb/shared';
import { applyCityEvent, createCityMirror, resyncCityMirror } from '../src/net/cityMirror';
import { createPredictor, predictedPose, predictStep, reconcile } from '../src/net/prediction';
import { clockSample, createServerClock, INTERP_DELAY, MAX_EXTRAPOLATION, renderTick } from '../src/net/serverClock';
import { cleanRoomCode, memoryStore, roomCodeFromHash, sessionToken } from '../src/net/session';
import { createSnapshotBuffer, newestSnapshot, pushSnapshot, sampleSnapshots } from '../src/net/snapshotBuffer';

/** A match with a person as the kaiju (slot 0), advanced past the briefing. */
function playingWorld(seed: number): World {
  const config = createMatchConfig({ humans: [{ name: 'Tester', role: 'kaiju' }], fast: true, anchor: 1 });
  const world = createWorld({ seed, config });
  for (let i = 0; i < 400 && world.match.phase !== 'playing'; i++) world.step([]);
  expect(world.match.phase).toBe('playing');
  return world;
}

function wander(seq: number, buttons = 0): PlayerInput {
  return { seq, moveX: Math.sin(seq / 19) * 0.5, moveZ: 1, aimYaw: Math.sin(seq / 60) * 2.2, aimPitch: 0, buttons };
}

function snap(world: World, ack: number): Snapshot {
  return decodeSnapshot(encodeSnapshot(snapshotOfWorld(world, ack)));
}

describe('prediction and reconciliation', () => {
  it('lands where the server does, through latency, when the kaiju only walks', () => {
    const world = playingWorld(31);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    expect(mirror.trusted).toBe(true);
    const predictor = createPredictor();
    const LATENCY = 3; // ticks each way
    const toServer: Array<{ at: number; input: PlayerInput }> = [];
    const toClient: Array<{ at: number; snap: Snapshot }> = [];
    const predictedAt = new Map<number, { x: number; z: number }>();
    const radius = kaijuStageDef('lizard', 1).bodyRadius;
    let latest = snap(world, 0);
    let worst = 0;
    let compared = 0;

    for (let t = 1; t <= 420; t++) {
      // Client: one input per tick, predicted at once.
      const input = wander(t);
      toServer.push({ at: t + LATENCY, input });
      const bounds = stageBounds(mirror.city, welcome.anchor, latest.match.stage);
      predictStep(predictor, input, mirror.query, kaijuMoveParams(latest.kaijus[0], bounds), true);
      if (predictor.ready) predictedAt.set(input.seq, { x: predictor.body.x, z: predictor.body.z });

      // Server: applies whatever has arrived (or repeats), mirrors events to the client's city.
      const due = toServer.length > 0 && toServer[0].at <= t ? toServer.shift() : undefined;
      const events = world.step(due ? [due.input] : []);
      for (const e of events) applyCityEvent(mirror, e);
      if (due) {
        const guess = predictedAt.get(due.input.seq);
        if (guess) {
          const k = world.kaijus[0];
          worst = Math.max(worst, Math.hypot(guess.x - k.x, guess.z - k.z));
          compared++;
        }
      }
      if (t % 2 === 0) toClient.push({ at: t + LATENCY, snap: snap(world, world.players[0].input.seq) });

      // Client: snapshots arrive late and restart the prediction.
      while (toClient.length > 0 && toClient[0].at <= t) {
        latest = (toClient.shift() as { snap: Snapshot }).snap;
        const b = stageBounds(mirror.city, welcome.anchor, latest.match.stage);
        reconcile(predictor, latest.kaijus[0], radius, latest.ackSeq, mirror.query, kaijuMoveParams(latest.kaijus[0], b), true);
      }
    }
    expect(compared).toBeGreaterThan(350);
    // The client's guess for "where I am after input n" matches where the server put the body.
    expect(worst).toBeLessThan(0.05);
    expect(predictor.pending.length).toBeLessThanOrEqual(2 * LATENCY + 2);
    expect(Math.hypot(predictor.errX, predictor.errZ)).toBeLessThan(0.05);
  });

  it('folds a surprise into a fading error instead of snapping, and snaps a relocation', () => {
    const world = playingWorld(32);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    const predictor = createPredictor();
    const s = snap(world, 0);
    const k = s.kaijus[0];
    const params = kaijuMoveParams(k, stageBounds(mirror.city, welcome.anchor, 1));
    reconcile(predictor, k, 2.4, 0, mirror.query, params, true);
    expect(predictor.ready).toBe(true);
    const pose = { x: 0, z: 0, yaw: 0 };
    predictedPose(predictor, pose);
    expect(pose.x).toBeCloseTo(k.x, 5);

    // The server says the body is 1.5 m from where we thought: the drawn pose stays put...
    reconcile(predictor, { ...k, x: k.x + 1.5 }, 2.4, 0, mirror.query, params, true);
    predictedPose(predictor, pose);
    expect(pose.x).toBeCloseTo(k.x, 5);
    expect(predictor.body.x).toBeCloseTo(k.x + 1.5, 5);
    expect(predictor.lastCorrection).toBeCloseTo(1.5, 5);

    // ...but a jump across the map (a new stage) is taken at once.
    reconcile(predictor, { ...k, x: k.x + 200 }, 2.4, 0, mirror.query, params, true);
    predictedPose(predictor, pose);
    expect(pose.x).toBeCloseTo(k.x + 200, 4);
  });

  it("predicts the kaiju's charge as the server runs it: straight ahead, whatever the stick says", () => {
    const config = createMatchConfig({ humans: [{ name: 'Tester', role: 'kaiju' }], fast: true, anchor: 1 });
    config.bots = idleBots();
    const world = createWorld({ seed: 37, config });
    for (let i = 0; i < 400 && world.match.phase !== 'playing'; i++) world.step([]);
    // Open ground (for the server and, through the welcome, for the client): a run that hits a
    // tower stops dead, which is not what this is about.
    world.structureHp.fill(0);
    world.structureStage.fill(3);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    const k = world.kaijus[0];
    k.moves = ['charge', 'none'];
    const radius = kaijuStageDef(k.kind, k.stage).bodyRadius;
    // Press the charge, then pull the stick to the side and look away.
    const look = k.yaw + 1.2;
    let seq = 1;
    const steer = (): PlayerInput => ({ seq: ++seq, moveX: 1, moveZ: -0.5, aimYaw: look, aimPitch: 0, buttons: 0 });
    world.step([{ seq, moveX: 0, moveZ: 0, aimYaw: k.yaw, aimPitch: 0, buttons: Btn.move1 }]);
    for (let i = 0; i < 90 && k.phase !== 'charge'; i++) world.step([steer()]);
    expect(k.phase).toBe('charge');
    // The client restarts from a snapshot of the run and predicts what it sends next.
    const s = snap(world, seq);
    const sk = s.kaijus[0];
    const params = kaijuMoveParams(sk, stageBounds(mirror.city, welcome.anchor, s.match.stage));
    const predictor = createPredictor();
    reconcile(predictor, sk, radius, s.ackSeq, mirror.query, params, true, sk);
    for (let i = 0; i < 10; i++) {
      const input = steer();
      predictStep(predictor, input, mirror.query, params, true, sk);
      for (const e of world.step([input])) applyCityEvent(mirror, e);
    }
    expect(k.phase).toBe('charge');
    expect(Math.hypot(predictor.body.x - k.x, predictor.body.z - k.z)).toBeLessThan(0.05);
    // Without the run's drive the prediction would have followed the stick, far off.
    const loose = createPredictor();
    reconcile(loose, sk, radius, s.ackSeq, mirror.query, params, true);
    for (let i = 0; i < 10; i++) predictStep(loose, { seq: seq + 1 + i, moveX: 1, moveZ: -0.5, aimYaw: look, aimPitch: 0, buttons: 0 }, mirror.query, params, true);
    expect(Math.hypot(loose.body.x - k.x, loose.body.z - k.z)).toBeGreaterThan(1);
  });

  it('does not move the body outside the playing phase', () => {
    const world = playingWorld(33);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    const predictor = createPredictor();
    const k = snap(world, 0).kaijus[0];
    const params = kaijuMoveParams(k, stageBounds(mirror.city, welcome.anchor, 1));
    reconcile(predictor, k, 2.4, 0, mirror.query, params, false);
    for (let i = 1; i <= 20; i++) predictStep(predictor, wander(i), mirror.query, params, false);
    expect(predictor.body.x).toBe(Math.fround(k.x));
    expect(predictor.pending.length).toBe(20);
  });
});

describe('prediction when inputs reach the server late', () => {
  /** The acknowledgement as the server packs it: played inputs, and in the top byte how many it will drop. */
  const packAck = (played: number, drops: number): number => played + drops * 0x1000000;
  const walk = (seq: number): PlayerInput => ({ seq, moveX: 0, moveZ: 1, aimYaw: 0.4, aimPitch: 0, buttons: 0 });

  it('makes no correction when the server played late inputs on guesses and says it will drop them', () => {
    const world = playingWorld(35);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    const predictor = createPredictor();
    const radius = kaijuStageDef('lizard', 1).bodyRadius;
    let rand = 7;
    const roll = (n: number): number => {
      rand = (rand * 1103515245 + 12345) % 2147483648;
      return rand % n;
    };
    // The server's side, as server/src/room/inputQueue.ts does it: one tick per tick; a tick
    // whose input has not arrived repeats the last one and stands in for it, and the late input
    // (nothing new in it) is dropped when it comes.
    const inFlight: Array<{ at: number; input: PlayerInput }> = [];
    const waiting: PlayerInput[] = [];
    const toClient: Array<{ at: number; snap: Snapshot }> = [];
    let played = 0;
    let drops = 0;
    let arrive = 0;
    let guessed = 0;
    let latest = snap(world, 0);
    let worst = 0;
    for (let t = 1; t <= 400; t++) {
      const input = walk(t);
      arrive = Math.max(arrive, t + roll(5));
      inFlight.push({ at: arrive, input });
      const bounds = stageBounds(mirror.city, welcome.anchor, latest.match.stage);
      predictStep(predictor, input, mirror.query, kaijuMoveParams(latest.kaijus[0], bounds), true);

      while (inFlight.length > 0 && inFlight[0].at <= t) {
        const late = (inFlight.shift() as { input: PlayerInput }).input;
        if (drops > 0 && waiting.length === 0) {
          drops--;
          played = late.seq;
        } else {
          waiting.push(late);
        }
      }
      const next = waiting.shift();
      if (next) played = next.seq;
      else {
        drops++;
        guessed++;
      }
      world.step(next ? [next] : []);
      if (t % 2 === 0) toClient.push({ at: t + 2, snap: snap(world, packAck(waiting.length > 0 ? waiting[0].seq - 1 : played, drops)) });

      while (toClient.length > 0 && toClient[0].at <= t) {
        latest = (toClient.shift() as { snap: Snapshot }).snap;
        const b = stageBounds(mirror.city, welcome.anchor, latest.match.stage);
        reconcile(predictor, latest.kaijus[0], radius, latest.ackSeq, mirror.query, kaijuMoveParams(latest.kaijus[0], b), true);
        if (t > 30) worst = Math.max(worst, predictor.lastCorrection);
      }
    }
    expect(guessed).toBeGreaterThan(30);
    // The guesses were right (the player walked straight on): nothing to correct. Read as one
    // number, or with the guessed ticks replayed a second time, this was a step or more each time.
    expect(worst).toBeLessThan(0.01);
  });

  /** A walking kaiju one input into play, and the server's guesses for `guessed` ticks after it. */
  function aheadOfThePage(guessed: number) {
    const world = playingWorld(36);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    const predictor = createPredictor();
    const radius = kaijuStageDef('lizard', 1).bodyRadius;
    const params = (): ReturnType<typeof kaijuMoveParams> => kaijuMoveParams(world.kaijus[0], stageBounds(mirror.city, welcome.anchor, 1));
    reconcile(predictor, snap(world, 0).kaijus[0], radius, 0, mirror.query, params(), true);
    for (let seq = 1; seq <= 5; seq++) {
      predictStep(predictor, walk(seq), mirror.query, params(), true);
      world.step([walk(seq)]);
    }
    // The server plays ticks on guesses (walking on) before the page has made their inputs, and
    // its snapshot says it will drop that many: the page is behind the server.
    for (let i = 0; i < guessed; i++) world.step([]);
    const s = snap(world, packAck(5, guessed));
    const pose = { x: 0, z: 0, yaw: 0 };
    const before = { ...predictedPose(predictor, pose, 1) };
    reconcile(predictor, s.kaijus[0], radius, s.ackSeq, mirror.query, params(), true);
    return { world, mirror, predictor, radius, params, s, pose, before };
  }

  it('does not predict an input whose tick the server already played on a guess', () => {
    // A stall of the page: three ticks guessed, then the page makes the three inputs at once.
    const { world, mirror, predictor, radius, params, s } = aheadOfThePage(3);
    for (let seq = 6; seq <= 8; seq++) predictStep(predictor, walk(seq), mirror.query, params(), true);
    // Their ticks are already in the body: it does not move for them (it used to, three steps too far).
    expect(predictor.body.x).toBeCloseTo(s.kaijus[0].x, 5);
    expect(predictor.body.z).toBeCloseTo(s.kaijus[0].z, 5);
    // The next input is predicted as usual, and agrees with the server once it has dropped 6 to 8.
    predictStep(predictor, walk(9), mirror.query, params(), true);
    world.step([walk(9)]);
    reconcile(predictor, world.kaijus[0], radius, packAck(9, 0), mirror.query, params(), true);
    expect(predictor.lastCorrection).toBeLessThan(0.01);
  });

  it('draws the body moving on evenly through a tick the server played before the page made it', () => {
    const { mirror, predictor, params, s, pose, before } = aheadOfThePage(1);
    // The snapshot moved the body a step ahead; drawn, it stays where it was.
    expect(Math.hypot(predictor.body.x - before.x, predictor.body.z - before.z)).toBeGreaterThan(0.1);
    expect(predictedPose(predictor, pose, 1).x).toBeCloseTo(before.x, 5);
    // The page makes input 6, whose tick that was: the body does not move, and the drawn body
    // slides through the step during the tick instead of leaping when the snapshot came and
    // standing still now.
    predictStep(predictor, walk(6), mirror.query, params(), true);
    expect(predictor.body.x).toBeCloseTo(s.kaijus[0].x, 5);
    expect(predictedPose(predictor, pose, 0).x).toBeCloseTo(before.x, 5);
    const half = { ...predictedPose(predictor, pose, 0.5) };
    expect(half.x).toBeCloseTo((before.x + s.kaijus[0].x) / 2, 5);
    expect(half.z).toBeCloseTo((before.z + s.kaijus[0].z) / 2, 5);
    expect(predictedPose(predictor, pose, 1).x).toBeCloseTo(s.kaijus[0].x, 5);
  });
});

describe('the mirrored city', () => {
  it('follows the server from events alone while a kaiju wrecks things', () => {
    const world = playingWorld(34);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    let changed = 0;
    for (let t = 1; t <= 1200; t++) {
      // Walk at the nearest standing building and keep swiping and stomping it.
      const k = world.kaijus[0];
      let target = world.city.structures[0];
      let best = Infinity;
      for (const s of world.city.structures) {
        const d = Math.hypot(s.x - k.x, s.z - k.z);
        if (world.structureHp[s.id] > 0 && d < best) {
          best = d;
          target = s;
        }
      }
      const strike = t % 50 < 25 ? Btn.strike : 0;
      const events = world.step([{ seq: t, moveX: 0, moveZ: best > 8 ? 1 : 0, aimYaw: Math.atan2(target.x - k.x, target.z - k.z), aimPitch: 0, buttons: strike }]);
      for (const e of events) if (applyCityEvent(mirror, e)) changed++;
    }
    expect(changed).toBeGreaterThan(3);
    for (let i = 0; i < world.structureStage.length; i++) {
      expect(mirror.structureStage[i]).toBe(world.structureStage[i]);
      expect(mirror.query.structureHp[i] > 0).toBe(world.structureHp[i] > 0);
    }
    for (let i = 0; i < world.city.props.length; i++) {
      expect(bitGet(mirror.query.propAlive, i)).toBe(bitGet(world.propAlive, i));
      expect(bitGet(mirror.propWreck, i)).toBe(bitGet(world.propWreck, i));
    }

    // A second welcome (reconnection) replaces the state in place.
    const fresh = createCityMirror(welcome.config.citySeed, welcome.cityChecksum, welcome.cityState);
    resyncCityMirror(fresh, welcomeFor(world, 0).cityState);
    expect(Array.from(fresh.structureStage)).toEqual(Array.from(mirror.structureStage));
    expect(Array.from(fresh.query.propAlive)).toEqual(Array.from(mirror.query.propAlive));
  });

  it('refuses to trust a city that differs from the server', () => {
    const world = playingWorld(35);
    const welcome = welcomeFor(world, 0);
    const mirror = createCityMirror(welcome.config.citySeed, welcome.cityChecksum + 1, welcome.cityState);
    expect(mirror.trusted).toBe(false);
  });
});

describe('snapshot buffer', () => {
  function moving(world: World, tick: number, x: number, vx: number): Snapshot {
    const s = snap(world, 0);
    s.tick = tick;
    s.kaijus[0].x = x;
    s.kaijus[0].vx = vx;
    return s;
  }

  it('interpolates between the two snapshots around a tick', () => {
    const world = playingWorld(36);
    const buffer = createSnapshotBuffer();
    pushSnapshot(buffer, moving(world, 100, 10, 3));
    pushSnapshot(buffer, moving(world, 102, 12, 3));
    pushSnapshot(buffer, moving(world, 104, 14, 3));
    expect(sampleSnapshots(buffer, 101)?.kaijus[0].x).toBeCloseTo(11, 5);
    expect(sampleSnapshots(buffer, 103.5)?.kaijus[0].x).toBeCloseTo(13.5, 5);
    // Before the oldest: the oldest. Past the newest: carried along its velocity.
    expect(sampleSnapshots(buffer, 90)?.kaijus[0].x).toBeCloseTo(10, 5);
    expect(sampleSnapshots(buffer, 106)?.kaijus[0].x).toBeCloseTo(14 + 3 * 2 * DT, 4);
    expect(newestSnapshot(buffer)?.tick).toBe(104);
  });

  it('drops duplicates, does not slide a relocated body, and starts over when a new match begins', () => {
    const world = playingWorld(37);
    const buffer = createSnapshotBuffer();
    expect(pushSnapshot(buffer, moving(world, 100, 0, 0))).toBe(true);
    expect(pushSnapshot(buffer, moving(world, 100, 0, 0))).toBe(false);
    expect(pushSnapshot(buffer, moving(world, 102, 500, 0))).toBe(true);
    // Half way between: the body is at one end or the other, never in the middle of the map.
    const x = sampleSnapshots(buffer, 101)?.kaijus[0].x as number;
    expect(x === 0 || x === 500).toBe(true);
    expect(pushSnapshot(buffer, moving(world, 2, 0, 0))).toBe(true);
    expect(buffer.snaps.length).toBe(1);
  });
});

describe('server clock', () => {
  it('draws about 100 ms behind the newest snapshot and never runs far past it', () => {
    const clock = createServerClock();
    expect(renderTick(clock, 5)).toBe(0);
    // Snapshots every 2 ticks arriving with a little jitter.
    let now = 10;
    for (let tick = 2; tick <= 200; tick += 2) {
      now = 10 + tick * DT + (tick % 6 === 0 ? 0.012 : 0);
      clockSample(clock, tick, now);
    }
    const drawn = renderTick(clock, now);
    expect(drawn).toBeGreaterThan(200 - (INTERP_DELAY + 0.03) / DT);
    expect(drawn).toBeLessThan(200 - (INTERP_DELAY - 0.03) / DT);
    // No more snapshots: the view stops a little past the newest instead of running away.
    expect(renderTick(clock, now + 5)).toBeCloseTo(200 + MAX_EXTRAPOLATION / DT, 5);
    // A new match (ticks restart) snaps the clock rather than drifting for seconds.
    clockSample(clock, 2, now + 6);
    expect(renderTick(clock, now + 6)).toBeLessThan(2);
  });
});

describe('the drawn clock under bad conditions', () => {
  interface Arrival {
    tick: number;
    at: number;
  }

  /** Snapshots every second tick from a server that keeps time, each `latency` on the way. */
  function steady(seconds: number, latency: number): Arrival[] {
    const out: Arrival[] = [];
    for (let tick = 2; tick * DT < seconds; tick += 2) out.push({ tick, at: tick * DT + latency });
    return out;
  }

  /**
   * Plays arrivals against frames at 60 a second. Returns, from `from` seconds on: the largest
   * backward step of the drawn clock, how long it stood still, and how far behind where it
   * should be (`ideal`, in ticks, for a given time) it was at each frame.
   */
  function play(arrivals: Arrival[], seconds: number, from: number, ideal: (now: number) => number, stuck: { at: number; len: number } | null = null) {
    const clock = createServerClock();
    let i = 0;
    let prev = Number.NaN;
    let back = 0;
    let frozen = 0;
    const behind: Array<{ now: number; s: number }> = [];
    for (let now = 0.5; now < seconds; now += 1 / 60) {
      // A stuck page runs no frames and handles no messages; they are all waiting when it wakes.
      if (stuck && now > stuck.at && now < stuck.at + stuck.len) continue;
      while (i < arrivals.length && arrivals[i].at <= now) clockSample(clock, arrivals[i++].tick, now);
      const drawn = renderTick(clock, now);
      if (now >= from) {
        if (drawn < prev) back = Math.max(back, (prev - drawn) * DT);
        if (drawn === prev) frozen += 1 / 60;
        behind.push({ now, s: (ideal(now) - drawn) * DT });
      }
      prev = drawn;
    }
    return { back, frozen, behind, clock };
  }

  it('does not go back in time when a stalled connection delivers its backlog at once', () => {
    const LATENCY = 0.075;
    const ideal = (now: number): number => (now - LATENCY - INTERP_DELAY) / DT;
    for (const stall of [0.2, 0.3, 0.4, 0.6, 1, 2]) {
      const arrivals = steady(20, LATENCY).map((a) => (a.at > 10 && a.at < 10 + stall ? { tick: a.tick, at: 10 + stall } : a));
      const { back, behind } = play(arrivals, 20, 9, ideal);
      expect(back, `${stall} s stall`).toBe(0);
      // Before the stall and from half a second after the backlog arrived the view is where it
      // belongs. (It used to be drawn a third of a second late for two seconds after a 0.4 s stall.)
      for (const b of behind) {
        if (b.now < 10 || b.now > 10 + stall + 0.5) expect(Math.abs(b.s), `${stall} s stall, at ${b.now.toFixed(2)}`).toBeLessThan(0.03);
        // Never ahead of the server's present, never further behind than the stall made it.
        expect(b.s, `${stall} s stall, at ${b.now.toFixed(2)}`).toBeGreaterThan(-MAX_EXTRAPOLATION - INTERP_DELAY);
        expect(b.s).toBeLessThan(stall + 0.05);
      }
    }
  });

  it('ignores one late snapshot', () => {
    const arrivals = steady(8, 0.05);
    // One snapshot is held up for 180 ms, and with it (the link delivers in order) the two behind it.
    const late = arrivals.findIndex((a) => a.at > 4);
    arrivals[late] = { tick: arrivals[late].tick, at: arrivals[late].at + 0.18 };
    for (let i = late + 1; i < arrivals.length; i++) arrivals[i].at = Math.max(arrivals[i].at, arrivals[i - 1].at);
    const ideal = (now: number): number => (now - 0.05 - INTERP_DELAY) / DT;
    const { back, behind } = play(arrivals, 8, 3, ideal);
    expect(back).toBe(0);
    for (const b of behind) expect(Math.abs(b.s), `at ${b.now.toFixed(2)}`).toBeLessThan(0.02);
  });

  it('slows down instead of stepping back when the server itself falls behind', () => {
    // The server stops for 1.3 s at t = 5 (a paused host), catches up a quarter of a second and
    // drops the rest, as its loop does: from then on its clock is a good second behind.
    const arrivals: Arrival[] = [];
    let tick = 0;
    let owed = 0;
    for (let t = 0; t < 12; t += DT) {
      if (t >= 5 && t < 6.3) {
        owed = Math.min(0.25, owed + DT);
        continue;
      }
      const extra = Math.min(3, Math.round(owed / DT));
      owed -= extra * DT;
      tick += 1 + extra;
      const even = tick - (tick % 2);
      if (arrivals.length === 0 || even > arrivals[arrivals.length - 1].tick) arrivals.push({ tick: even, at: t + 0.03 });
    }
    const { back, frozen, clock } = play(arrivals, 12, 2, () => 0);
    expect(back).toBe(0);
    // It stands still while nothing arrives, and not for longer.
    expect(frozen).toBeGreaterThan(1);
    expect(frozen).toBeLessThan(1.3);
    // And it ends up the usual distance behind the server's (later) clock.
    const end = renderTick(clock, 12);
    expect(end).toBeGreaterThan(tick - (INTERP_DELAY + 0.05) / DT);
    expect(end).toBeLessThan(tick - (INTERP_DELAY - 0.05) / DT + 1);
  });

  it('takes a page that was stuck for a moment in its stride', () => {
    const ideal = (now: number): number => (now - 0.04 - INTERP_DELAY) / DT;
    const { back, behind } = play(steady(12, 0.04), 12, 2, ideal, { at: 5, len: 0.4 });
    expect(back).toBe(0);
    // The snapshots that waited are handled together, with one time stamp: only the newest
    // counts, and that one waited at most the 67 ms between two snapshots.
    for (const b of behind) expect(Math.abs(b.s), `at ${b.now.toFixed(2)}`).toBeLessThan(b.now > 5.4 && b.now < 5.7 ? 0.07 : 0.03);
  });

  it('never runs backwards, whatever the arrivals, and never faster than twice real time while it follows', () => {
    let seed = 99;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 20; round++) {
      // A server that loses time now and then, and a link with jitter and the odd stall.
      const arrivals: Arrival[] = [];
      let tick = 0;
      let hold = 0;
      for (let t = 0; t < 15; t += DT) {
        if (random() < 0.02) hold = random() * 0.5;
        if (hold > 0) {
          hold -= DT;
          continue;
        }
        tick++;
        if (tick % 2 === 0) arrivals.push({ tick, at: t + 0.02 + random() * 0.06 + (random() < 0.03 ? random() * 0.4 : 0) });
      }
      // The link delivers in order.
      for (let i = 1; i < arrivals.length; i++) arrivals[i].at = Math.max(arrivals[i].at, arrivals[i - 1].at);
      const clock = createServerClock();
      let i = 0;
      let prev = Number.NaN;
      let prevNow = 0;
      for (let now = 0.5; now < 15; now += 1 / 60 + (random() < 0.02 ? random() * 0.2 : 0)) {
        while (i < arrivals.length && arrivals[i].at <= now) clockSample(clock, arrivals[i++].tick, now);
        const drawn = renderTick(clock, now);
        if (!Number.isNaN(prev)) {
          expect(drawn, `round ${round} at ${now.toFixed(3)}`).toBeGreaterThanOrEqual(prev);
          const real = (now - prevNow) / DT;
          const step = drawn - prev;
          // Either it follows (at most twice real time), or it skips forward after standing still.
          if (step > real * 2 + 1e-6) expect(step * DT, `round ${round} at ${now.toFixed(3)}`).toBeGreaterThan(0.2);
          expect(drawn).toBeLessThanOrEqual(clock.newestTick + MAX_EXTRAPOLATION / DT + 1e-6);
        }
        prev = drawn;
        prevNow = now;
      }
    }
  });
});

describe('session helpers', () => {
  it('keeps one token per profile and cleans room codes', () => {
    const store = memoryStore();
    const a = sessionToken(store);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(sessionToken(store)).toBe(a);
    expect(sessionToken(store, 'second')).not.toBe(a);
    expect(cleanRoomCode('b c-d f g')).toBe('BCDF');
    expect(cleanRoomCode('aeiou')).toBe('');
    expect(roomCodeFromHash('#bcdf')).toBe('BCDF');
    expect(roomCodeFromHash('#bc')).toBe('');
    expect(roomCodeFromHash('')).toBe('');
  });
});
