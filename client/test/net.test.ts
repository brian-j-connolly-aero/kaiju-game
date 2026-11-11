import { describe, expect, it } from 'vitest';
import {
  bitGet,
  Btn,
  createMatchConfig,
  createWorld,
  decodeSnapshot,
  DT,
  encodeSnapshot,
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
