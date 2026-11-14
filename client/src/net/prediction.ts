/**
 * Client-side prediction of the local player's body (ARCHITECTURE.md section 4.2).
 *
 * Every client tick the input that was just sent is also applied locally with the shared
 * `stepMovement`, so the player's own kaiju or unit answers at once. Every snapshot says which
 * input the server has applied (`ackSeq`) and where the body really is; the predictor restarts
 * from that state, replays the inputs the server has not seen yet, and folds whatever
 * difference remains into an error offset that fades out over a few frames instead of snapping.
 *
 * The body only moves on client ticks, 30 times a second; screens refresh faster. So the body is
 * DRAWN between the pose before its newest tick and the pose after it (`predictedPose` with the
 * fraction of a tick that has passed since), which makes its motion as smooth as the frame rate.
 */

import { angleDiff, DT, stepMovement, wrapAngle, type CityQuery, type MoveBody, type MoveParams, type PlayerInput } from '@mb/shared';

/** A correction larger than this is a relocation (new stage, takeover), not drift: snap. */
const SNAP_DISTANCE = 12;
const MAX_PENDING = 90;
/** The visible error halves about every 60 ms. */
const ERROR_DECAY = 11;

export interface ServerBody {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
}

export interface Predictor {
  /** The predicted body at the present moment (after the newest local input). */
  body: MoveBody;
  /** Inputs sent to the server and not yet acknowledged, oldest first. */
  pending: PlayerInput[];
  /** How far the newest tick moved the body (what it is drawn sliding through until the next one). */
  stepX: number;
  stepZ: number;
  stepYaw: number;
  /** Offset added to the body for drawing; it decays to zero. */
  errX: number;
  errZ: number;
  errYaw: number;
  /** False until the first server state has been taken over. */
  ready: boolean;
  /** Size of the most recent correction, meters (for the debug overlay). */
  lastCorrection: number;
}

export function createPredictor(): Predictor {
  return {
    body: { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, radius: 1 },
    pending: [],
    stepX: 0,
    stepZ: 0,
    stepYaw: 0,
    errX: 0,
    errZ: 0,
    errYaw: 0,
    ready: false,
    lastCorrection: 0,
  };
}

/** Forgets everything (a new match, a different body to drive). */
export function resetPredictor(p: Predictor): void {
  p.pending.length = 0;
  p.stepX = 0;
  p.stepZ = 0;
  p.stepYaw = 0;
  p.errX = 0;
  p.errZ = 0;
  p.errYaw = 0;
  p.ready = false;
  p.lastCorrection = 0;
}

/**
 * One client tick: remembers the input that was just sent and, when `moving` (the match is
 * being played), applies it to the predicted body.
 */
export function predictStep(p: Predictor, input: PlayerInput, city: CityQuery, params: MoveParams, moving: boolean): void {
  p.pending.push(input);
  if (p.pending.length > MAX_PENDING) p.pending.splice(0, p.pending.length - MAX_PENDING);
  const b = p.body;
  const x = b.x;
  const z = b.z;
  const yaw = b.yaw;
  if (p.ready && moving) stepMovement(b, input, DT, city, params);
  p.stepX = b.x - x;
  p.stepZ = b.z - z;
  p.stepYaw = angleDiff(b.yaw, yaw);
}

/**
 * A snapshot arrived: restart from the server's body, replay what it has not seen, and keep
 * the picture continuous by moving the difference into the error offset.
 */
export function reconcile(
  p: Predictor,
  server: ServerBody,
  radius: number,
  ackSeq: number,
  city: CityQuery,
  params: MoveParams,
  moving: boolean,
): void {
  // The step of the newest tick is left alone: the drawn pose is "the body, less what is left of
  // that step, plus the error", so keeping the first and the last of those where they were keeps
  // the picture where it was, whatever fraction of the tick has passed.
  const beforeX = p.body.x + p.errX;
  const beforeZ = p.body.z + p.errZ;
  const beforeYaw = p.body.yaw + p.errYaw;
  const wasReady = p.ready;

  let drop = 0;
  while (drop < p.pending.length && p.pending[drop].seq <= ackSeq) drop++;
  if (drop > 0) p.pending.splice(0, drop);

  const b = p.body;
  b.x = server.x;
  b.z = server.z;
  b.yaw = server.yaw;
  b.vx = server.vx;
  b.vz = server.vz;
  b.radius = radius;
  if (moving) {
    for (const input of p.pending) stepMovement(b, input, DT, city, params);
  }
  p.ready = true;

  if (!wasReady) {
    p.stepX = 0;
    p.stepZ = 0;
    p.stepYaw = 0;
    p.errX = 0;
    p.errZ = 0;
    p.errYaw = 0;
    return;
  }
  const ex = beforeX - b.x;
  const ez = beforeZ - b.z;
  const dist = Math.hypot(ex, ez);
  p.lastCorrection = dist;
  if (dist > SNAP_DISTANCE) {
    p.stepX = 0;
    p.stepZ = 0;
    p.stepYaw = 0;
    p.errX = 0;
    p.errZ = 0;
    p.errYaw = 0;
  } else {
    p.errX = ex;
    p.errZ = ez;
    p.errYaw = angleDiff(beforeYaw, b.yaw);
  }
}

/** Fades the error offset; call once per frame. */
export function decayPredictionError(p: Predictor, dt: number): void {
  const keep = Math.exp(-ERROR_DECAY * dt);
  p.errX *= keep;
  p.errZ *= keep;
  p.errYaw *= keep;
}

/**
 * Where to draw the body: the prediction plus what is left of the last correction. `alpha` is
 * how much of a tick has passed since the newest one (0 to 1): the body is drawn that far along
 * the newest tick's step, so it glides from tick to tick. At 1 (the default) it is the predicted
 * body itself.
 */
export function predictedPose(p: Predictor, out: { x: number; z: number; yaw: number }, alpha = 1): { x: number; z: number; yaw: number } {
  const back = 1 - Math.min(1, Math.max(0, alpha));
  out.x = p.body.x - p.stepX * back + p.errX;
  out.z = p.body.z - p.stepZ * back + p.errZ;
  out.yaw = wrapAngle(p.body.yaw - p.stepYaw * back + p.errYaw);
  return out;
}
