/**
 * Client-side prediction of the local player's body (ARCHITECTURE.md section 4.2).
 *
 * Every client tick the input that was just sent is also applied locally with the shared
 * `stepMovement`, so the player's own kaiju or unit answers at once. Every snapshot says where the
 * body really is and acknowledges inputs (`readAck`): which inputs the server has played, and how
 * many of the next ones it will drop because a tick it played on a guess (the input was late)
 * already stood in for them. The predictor restarts from the snapshot's body, replays the inputs
 * after the acknowledged one less those the server will drop, and folds whatever difference
 * remains into an error offset that fades out over a few frames instead of snapping. An input
 * made after the server had already guessed its tick (the page stalled while the server played
 * on) is not predicted at all: its tick is in the body.
 *
 * The body only moves on client ticks, 30 times a second; screens refresh faster. So the body is
 * DRAWN between the pose before its newest tick and the pose after it (`predictedPose` with the
 * fraction of a tick that has passed since), which makes its motion as smooth as the frame rate.
 */

import {
  angleDiff,
  DT,
  kaijuMoveInput,
  stepMovement,
  wrapAngle,
  type CityQuery,
  type KaijuDriveState,
  type KaijuMoveState,
  type MoveBody,
  type MoveInput,
  type MoveParams,
  type PlayerInput,
} from '@mb/shared';

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
  /**
   * The turret of a driven tank (a snapshot unit's `aimYaw`): predicted along with the hull when
   * the body steers like a tank ('tank' steering turns `MoveBody.aimYaw`), ignored otherwise.
   */
  aimYaw?: number;
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
  /** The same for a tank's turret (`body.aimYaw`). */
  stepAim: number;
  /** Offset added to the body for drawing; it decays to zero. */
  errX: number;
  errZ: number;
  errYaw: number;
  errAim: number;
  /** False until the first server state has been taken over. */
  ready: boolean;
  /** Inputs still to be made whose ticks the server has already played on a guess: not predicted. */
  covered: number;
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
    stepAim: 0,
    errX: 0,
    errZ: 0,
    errYaw: 0,
    errAim: 0,
    ready: false,
    covered: 0,
    lastCorrection: 0,
  };
}

const driveState = {} as KaijuDriveState;
const driveInput: MoveInput = { moveX: 0, moveZ: 0, aimYaw: 0 };

/**
 * One tick of the body under an input, as the server's movement system moves it: a kaiju's
 * `drive` (its action state) can override the stick (a charge runs straight ahead).
 */
function step(b: MoveBody, input: PlayerInput, city: CityQuery, params: MoveParams, drive: KaijuMoveState | null): void {
  let move: MoveInput = input;
  if (drive) {
    Object.assign(driveState, drive);
    driveState.yaw = b.yaw;
    move = kaijuMoveInput(driveState, input, driveInput);
  }
  stepMovement(b, move, DT, city, params);
}

/** Forgets everything (a new match, a different body to drive). */
export function resetPredictor(p: Predictor): void {
  p.pending.length = 0;
  p.stepX = 0;
  p.stepZ = 0;
  p.stepYaw = 0;
  p.stepAim = 0;
  p.errX = 0;
  p.errZ = 0;
  p.errYaw = 0;
  p.errAim = 0;
  p.body.aimYaw = undefined;
  p.ready = false;
  p.covered = 0;
  p.lastCorrection = 0;
}

/**
 * One client tick: remembers the input that was just sent and, when `moving` (the match is
 * being played), applies it to the predicted body. `drive`: a kaiju's movement state (null for
 * a unit), which can override the stick as on the server (`kaijuMoveInput`).
 */
export function predictStep(
  p: Predictor,
  input: PlayerInput,
  city: CityQuery,
  params: MoveParams,
  moving: boolean,
  drive: KaijuMoveState | null = null,
): void {
  p.pending.push(input);
  if (p.pending.length > MAX_PENDING) p.pending.splice(0, p.pending.length - MAX_PENDING);
  if (p.ready && p.covered > 0) {
    // The server has already played this input's tick on a guess (the page was stalled): the
    // body from the snapshot has it. Nothing moves, but the drawn body slides through what is
    // left of the correction during this tick, so that it moves on evenly instead of leaping
    // ahead when the snapshot came and standing still now.
    p.covered--;
    p.stepX = -p.errX;
    p.stepZ = -p.errZ;
    p.stepYaw = -p.errYaw;
    p.stepAim = -p.errAim;
    p.errX = 0;
    p.errZ = 0;
    p.errYaw = 0;
    p.errAim = 0;
    return;
  }
  const b = p.body;
  const x = b.x;
  const z = b.z;
  const yaw = b.yaw;
  const aim = b.aimYaw;
  if (p.ready && moving) step(b, input, city, params, drive);
  p.stepX = b.x - x;
  p.stepZ = b.z - z;
  p.stepYaw = angleDiff(b.yaw, yaw);
  p.stepAim = aim !== undefined && b.aimYaw !== undefined ? angleDiff(b.aimYaw, aim) : 0;
}

/**
 * A snapshot arrived: restart from the server's body, replay what it has not played (less the
 * inputs it will drop), and keep the picture continuous by moving the difference into the error
 * offset. `ackSeq` is the snapshot's acknowledgement as it came (`readAck`); `drive` as for
 * `predictStep`.
 */
export function reconcile(
  p: Predictor,
  server: ServerBody,
  radius: number,
  ackSeq: number,
  city: CityQuery,
  params: MoveParams,
  moving: boolean,
  drive: KaijuMoveState | null = null,
): void {
  const { played, drops } = readAck(ackSeq);
  // The step of the newest tick is left alone: the drawn pose is "the body, less what is left of
  // that step, plus the error", so keeping the first and the last of those where they were keeps
  // the picture where it was, whatever fraction of the tick has passed.
  const beforeX = p.body.x + p.errX;
  const beforeZ = p.body.z + p.errZ;
  const beforeYaw = p.body.yaw + p.errYaw;
  const beforeAim = p.body.aimYaw !== undefined ? p.body.aimYaw + p.errAim : undefined;
  const wasReady = p.ready;

  let drop = 0;
  while (drop < p.pending.length && p.pending[drop].seq <= played) drop++;
  if (drop > 0) p.pending.splice(0, drop);

  const b = p.body;
  b.x = server.x;
  b.z = server.z;
  b.yaw = server.yaw;
  b.vx = server.vx;
  b.vz = server.vz;
  b.radius = radius;
  // A tank's turret turns at its own rate in stepMovement: predicted from the server's turret.
  b.aimYaw = params.steer === 'tank' && server.aimYaw !== undefined ? server.aimYaw : undefined;
  // The first `drops` of them will be dropped: the body already has their ticks (guesses).
  if (moving) {
    for (let i = drops; i < p.pending.length; i++) step(b, p.pending[i], city, params, drive);
  }
  p.covered = Math.max(0, drops - p.pending.length);
  p.ready = true;

  if (!wasReady) {
    p.stepX = 0;
    p.stepZ = 0;
    p.stepYaw = 0;
    p.stepAim = 0;
    p.errX = 0;
    p.errZ = 0;
    p.errYaw = 0;
    p.errAim = 0;
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
    p.stepAim = 0;
    p.errX = 0;
    p.errZ = 0;
    p.errYaw = 0;
    p.errAim = 0;
  } else {
    p.errX = ex;
    p.errZ = ez;
    p.errYaw = angleDiff(beforeYaw, b.yaw);
    p.errAim = beforeAim !== undefined && b.aimYaw !== undefined ? angleDiff(beforeAim, b.aimYaw) : 0;
    if (b.aimYaw === undefined) p.stepAim = 0;
  }
}

/** Bits of a snapshot's `ackSeq` that hold the sequence number (server/src/room/inputQueue.ts, `packedAck`). */
const ACK_SEQ_BITS = 0xffffff;

/**
 * The two parts of a snapshot's acknowledgement: `played`, the newest input up to which the
 * server has played (or dropped) every input, which also says whether a press has reached the
 * simulation; and `drops`, how many of the inputs after it the server will drop.
 */
export function readAck(ackSeq: number): { played: number; drops: number } {
  return { played: ackSeq & ACK_SEQ_BITS, drops: ackSeq >>> 24 };
}

/** Fades the error offset; call once per frame. */
export function decayPredictionError(p: Predictor, dt: number): void {
  const keep = Math.exp(-ERROR_DECAY * dt);
  p.errX *= keep;
  p.errZ *= keep;
  p.errYaw *= keep;
  p.errAim *= keep;
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

/**
 * Where to draw a predicted tank's turret, as `predictedPose` places the hull (the same
 * fraction of the newest tick, the same fading correction); null when the body has no turret
 * of its own (it does not steer like a tank).
 */
export function predictedTurret(p: Predictor, alpha = 1): number | null {
  const aim = p.body.aimYaw;
  if (aim === undefined) return null;
  const back = 1 - Math.min(1, Math.max(0, alpha));
  return wrapAngle(aim - p.stepAim * back + p.errAim);
}
