/**
 * Client-side prediction of the local player's body (ARCHITECTURE.md section 4.2).
 *
 * Every client tick the input that was just sent is also applied locally with the shared
 * `stepMovement`, so the player's own kaiju or unit answers at once. Every snapshot says which
 * input the server has applied (`ackSeq`) and where the body really is; the predictor restarts
 * from that state, replays the inputs the server has not seen yet, and folds whatever
 * difference remains into an error offset that fades out over a few frames instead of snapping.
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
  if (p.ready && moving) stepMovement(p.body, input, DT, city, params);
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

/** Where to draw the body: the prediction plus what is left of the last correction. */
export function predictedPose(p: Predictor, out: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
  out.x = p.body.x + p.errX;
  out.z = p.body.z + p.errZ;
  out.yaw = wrapAngle(p.body.yaw + p.errYaw);
  return out;
}
