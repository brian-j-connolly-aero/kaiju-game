/**
 * stepMovement: the one movement function for every circle body (kaiju, tanks, infantry
 * sections). It is pure: given the same body, input, parameters and city state it produces the
 * same result on the server and in the client's prediction. It never changes the city; it
 * reports what the body walked through and the movement system applies the consequences.
 *
 * Rules (DESIGN.md sections 2 and 7):
 * - Standing structures taller than the body's trample height block it, as oriented boxes.
 * - Structures up to the trample height never block; they are reported in `trampled`.
 * - A wading body (the titan) is never blocked: taller structures are reported in `waded` and
 *   slow it to `wadeSpeedMult` while it touches them.
 * - Bridge decks (passable structures) never block anybody. They are trampled like any other
 *   structure when they are not taller than the trample height.
 * - Rubble (hp 0) is flat and passable. Props never block.
 * - Water slows the body to `waterSpeedMult` unless it stands on a bridge deck.
 * - Nobody can leave the playable bounds.
 *
 * Steering ('aim', 'heading', 'free' and 'tank'): see `SteerModel` in defs/schema.ts. 'tank' is
 * the player's own vehicle at stages 2 and 3, real tank driving: the input's moveZ is the
 * throttle along the hull and moveX turns the hull (right positive, on the spot when it stands
 * still); the velocity always lies along the hull (tracks do not slide), speeding up at
 * `accel` and slowing down or stopping to reverse at `brake`; reverse tops out at
 * `reverseMult` of the top speed; and the turret (the body's `aimYaw`) swings toward the
 * input's aimYaw at `turretRate`. All of it is in here so that a client predicts its own tank
 * exactly: hull speed is worked out from the velocity, the turret from the body's `aimYaw`.
 */

import { bridgeAt, groundCodeAt, GROUND_WATER, structureContact, structuresInCircle, type CityQuery } from '../city/spatialIndex';
import { kaijuKindDef } from '../defs/kaiju/index';
import type { KaijuActionId, KaijuKindId, KaijuPhase, StageId } from '../defs/ids';
import { perStage } from '../defs/ids';
import { COMBAT_RULES } from '../defs/rules';
import type { Mods, SteerModel, UnitTypeDef } from '../defs/schema';
import { modMult } from '../defs/upgrades';
import { angleDiff, turnToward, wrapAngle, yawOf } from '../math/angle';
import { createContact, type Bounds, type Contact } from '../math/geom';
import { approach, clamp, clamp01, lerp } from '../math/scalar';

/** The moving part of a body. Kaiju and Unit both satisfy it. */
export interface MoveBody {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  radius: number;
  /**
   * 'tank' steering only: the turret's heading, which stepMovement swings toward the input's
   * aimYaw at the turret rate. A body without it (or any other steering) is left alone here.
   */
  aimYaw?: number;
}

/** The movement part of an input (PlayerInput and UnitControl both satisfy it). */
export interface MoveInput {
  moveX: number;
  moveZ: number;
  aimYaw: number;
}

/** Everything about HOW a body moves this tick. Build it with kaijuMoveParams or unitMoveParams. */
export interface MoveParams {
  steer: SteerModel;
  /** Top speed this tick, with every multiplier except terrain already applied. */
  topSpeed: number;
  accel: number;
  /** Radians per second this tick. */
  turnRate: number;
  /** 'aim' steering: speed multipliers for moving sideways and backward relative to the body. 'tank': reverseMult is the reverse top speed's share. */
  strafeMult: number;
  reverseMult: number;
  /** 'tank' steering only: slowing down (and stopping to reverse) along the hull, m/s per second. */
  brake: number;
  /** 'tank' steering only: how fast the turret swings toward the aim, radians per second. */
  turretRate: number;
  /** Structures up to this tall are walked through. 0 for bodies that trample nothing. */
  trampleHeight: number;
  /** True when taller structures do not block either (the body wades through them). */
  wades: boolean;
  wadeSpeedMult: number;
  waterSpeedMult: number;
  bounds: Bounds;
}

export interface MoveResult {
  /** Standing structures no taller than the trample height that the body overlapped. */
  trampled: number[];
  /** Taller standing structures a wading body overlapped. */
  waded: number[];
  /** The body was pushed back by a structure or by the bounds. */
  blocked: boolean;
  /** The body ends the step in water (and not on a bridge deck). */
  inWater: boolean;
  /** The body was slowed by wading this step. */
  wading: boolean;
}

export function createMoveResult(): MoveResult {
  return { trampled: [], waded: [], blocked: false, inWater: false, wading: false };
}

/** Inputs smaller than this are treated as "not moving" for steering. */
const MOVE_DEADZONE = 0.05;
const COLLISION_PASSES = 3;

const ids: number[] = [];
const contact: Contact = createContact();
const sharedResult: MoveResult = createMoveResult();

function wet(city: CityQuery, x: number, z: number): boolean {
  return groundCodeAt(city.index, x, z) === GROUND_WATER && bridgeAt(city, x, z) < 0;
}

/**
 * Advances `body` by `dt` seconds under `input`. Mutates the body and returns what happened.
 * Pass your own `result` to keep it; otherwise a shared scratch object is returned that is only
 * valid until the next call.
 */
export function stepMovement(
  body: MoveBody,
  input: MoveInput,
  dt: number,
  city: CityQuery,
  params: MoveParams,
  result: MoveResult = sharedResult,
): MoveResult {
  result.trampled.length = 0;
  result.waded.length = 0;
  result.blocked = false;
  result.wading = false;
  const index = city.index;
  const r = body.radius;
  const tank = params.steer === 'tank';

  // --- Intent: a world-space direction and a 0..1 throttle ----------------------------------
  let mag = tank ? 0 : Math.hypot(input.moveX, input.moveZ);
  let dirX = 0;
  let dirZ = 0;
  if (mag > MOVE_DEADZONE) {
    const s = Math.sin(input.aimYaw);
    const c = Math.cos(input.aimYaw);
    // forward = (sin, cos), right = (-cos, sin)
    dirX = (s * input.moveZ - c * input.moveX) / mag;
    dirZ = (c * input.moveZ + s * input.moveX) / mag;
    if (mag > 1) mag = 1;
  } else {
    mag = 0;
  }

  // --- Terrain at the start of the step ------------------------------------------------------
  let terrain = 1;
  if (params.waterSpeedMult !== 1 && wet(city, body.x, body.z)) terrain *= params.waterSpeedMult;
  if (params.wades && params.wadeSpeedMult !== 1) {
    structuresInCircle(city, body.x, body.z, r, ids);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (index.sheight[id] > params.trampleHeight && index.spassable[id] === 0) {
        terrain *= params.wadeSpeedMult;
        result.wading = true;
        break;
      }
    }
  }

  // --- Turn and choose the velocity the body wants ------------------------------------------
  const maxTurn = params.turnRate * dt;
  let wantX = 0;
  let wantZ = 0;
  const speed = params.topSpeed * mag * terrain;
  if (tank) {
    driveTank(body, input, dt, params, terrain);
  } else if (params.steer === 'aim') {
    body.yaw = turnToward(body.yaw, input.aimYaw, maxTurn);
    if (mag > 0) {
      const fs = Math.sin(body.yaw);
      const fc = Math.cos(body.yaw);
      const forward = dirX * fs + dirZ * fc;
      const side = dirX * -fc + dirZ * fs;
      // Blend the limits by how much of the direction is forward, backward or sideways.
      const along = forward >= 0 ? 1 : params.reverseMult;
      const limit = along * forward * forward + params.strafeMult * side * side;
      wantX = dirX * speed * limit;
      wantZ = dirZ * speed * limit;
    }
  } else if (params.steer === 'heading') {
    if (mag > 0) {
      const target = yawOf(dirX, dirZ);
      body.yaw = turnToward(body.yaw, target, maxTurn);
      // Drive along the hull; slow down while it is still turning toward where it wants to go.
      const align = Math.cos(angleDiff(target, body.yaw));
      const drive = speed * (align > 0 ? align : 0);
      wantX = Math.sin(body.yaw) * drive;
      wantZ = Math.cos(body.yaw) * drive;
    }
  } else {
    if (mag > 0) {
      body.yaw = turnToward(body.yaw, yawOf(dirX, dirZ), maxTurn);
      wantX = dirX * speed;
      wantZ = dirZ * speed;
    }
  }

  // --- Accelerate toward it and move (a tank has set its velocity already) --------------------
  if (!tank) {
    const dvx = wantX - body.vx;
    const dvz = wantZ - body.vz;
    const dv = Math.hypot(dvx, dvz);
    const maxDv = params.accel * dt;
    if (dv <= maxDv) {
      body.vx = wantX;
      body.vz = wantZ;
    } else {
      body.vx += (dvx / dv) * maxDv;
      body.vz += (dvz / dv) * maxDv;
    }
  }
  body.x += body.vx * dt;
  body.z += body.vz * dt;

  // --- Bounds and structures -----------------------------------------------------------------
  const b = params.bounds;
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    if (clampToBounds(body, b)) result.blocked = true;
    let pushed = false;
    structuresInCircle(city, body.x, body.z, r, ids);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const low = index.sheight[id] <= params.trampleHeight;
      if (low) {
        if (pass === 0) result.trampled.push(id);
        continue;
      }
      if (index.spassable[id] === 1) continue;
      if (params.wades) {
        if (pass === 0) result.waded.push(id);
        continue;
      }
      if (!structureContact(index, id, body.x, body.z, r, contact)) continue;
      body.x += contact.nx * contact.depth;
      body.z += contact.nz * contact.depth;
      const vn = body.vx * contact.nx + body.vz * contact.nz;
      if (vn < 0) {
        body.vx -= contact.nx * vn;
        body.vz -= contact.nz * vn;
      }
      pushed = true;
    }
    if (pushed) result.blocked = true;
    else break;
  }
  // The bounds always win: a body squeezed between a wall and the line stays inside the line.
  if (clampToBounds(body, b)) result.blocked = true;

  result.inWater = wet(city, body.x, body.z);
  return result;
}

/** Throttle and turn of a tank's stick, read as a square (see `tankStick`). */
const stick = { throttle: 0, turn: 0 };

/**
 * A tank's stick, read as a square rather than a disc: every input has length at most 1, so W
 * and D together arrive as (0.71, 0.71), and that is full throttle and full turn. Inputs inside
 * the dead zone count as 0.
 */
export function tankStick(moveX: number, moveZ: number, out: { throttle: number; turn: number }): { throttle: number; turn: number } {
  const m = Math.max(Math.abs(moveX), Math.abs(moveZ));
  const k = m > 1e-9 ? Math.hypot(moveX, moveZ) / m : 0;
  out.throttle = clamp(moveZ * k, -1, 1);
  out.turn = clamp(moveX * k, -1, 1);
  if (Math.abs(out.throttle) < MOVE_DEADZONE) out.throttle = 0;
  if (Math.abs(out.turn) < MOVE_DEADZONE) out.turn = 0;
  return out;
}

/** One tick of tank driving: the hull turns, the speed along it changes, the turret swings. */
function driveTank(body: MoveBody, input: MoveInput, dt: number, params: MoveParams, terrain: number): void {
  tankStick(input.moveX, input.moveZ, stick);
  // Right is toward -X when facing +Z: a right turn lowers the yaw.
  if (stick.turn !== 0) body.yaw = wrapAngle(body.yaw - stick.turn * params.turnRate * dt);
  const fs = Math.sin(body.yaw);
  const fc = Math.cos(body.yaw);
  // Tracks do not slide: whatever the hull was doing (a wall took some of it), it now goes along the hull.
  const speed = body.vx * fs + body.vz * fc;
  const top = params.topSpeed * terrain;
  const want = stick.throttle >= 0 ? stick.throttle * top : stick.throttle * top * params.reverseMult;
  const faster = Math.abs(want) > Math.abs(speed) && (speed === 0 || want > 0 === speed > 0);
  const next = approach(speed, want, (faster ? params.accel : params.brake) * dt);
  body.vx = fs * next;
  body.vz = fc * next;
  if (body.aimYaw !== undefined) body.aimYaw = turnToward(body.aimYaw, input.aimYaw, params.turretRate * dt);
}

/** Tank driving by a bot: the hull is given full turn this far off the way it wants to go, less nearer. */
const TANK_FULL_TURN = (15 * Math.PI) / 180;
/** ...and it only drives (rather than turning on the spot) with the way within this of straight ahead (cosine of 60 degrees). */
const TANK_DRIVE_ALIGN = 0.5;

/**
 * Writes a world direction and a 0..1 throttle into a tank's control the way tank driving reads
 * it: the hull turns toward the direction (full stick from 15 degrees off), on the spot while
 * the direction is more than 60 degrees off, and the throttle grows as the hull lines up. The
 * pair is stored as a disc (length at most 1) that `tankStick` reads back as that square. For
 * bots and anything else that steers a driven tank by a direction.
 */
export function setTankMove(control: MoveInput, hullYaw: number, dirX: number, dirZ: number, throttle = 1): void {
  if (throttle <= 0 || Math.hypot(dirX, dirZ) < 1e-9) {
    control.moveX = 0;
    control.moveZ = 0;
    return;
  }
  // Positive: the way is to the left (yaw grows toward +X, the left of +Z), so the stick goes left.
  const off = angleDiff(yawOf(dirX, dirZ), hullYaw);
  const turn = clamp(-off / TANK_FULL_TURN, -1, 1);
  const align = Math.cos(off);
  const drive = align > TANK_DRIVE_ALIGN ? clamp(throttle, 0, 1) * align : 0;
  // From the square back to the disc an input carries: the inverse of tankStick.
  const len = Math.hypot(turn, drive);
  const k = len > 1e-9 ? Math.max(Math.abs(turn), Math.abs(drive)) / len : 0;
  control.moveX = turn * k;
  control.moveZ = drive * k;
}

function clampToBounds(body: MoveBody, b: Bounds): boolean {
  const r = body.radius;
  let hit = false;
  // A body wider than the bounds (cannot happen with shipped data) is centered instead of oscillating.
  const minX = Math.min(b.minX + r, (b.minX + b.maxX) / 2);
  const maxX = Math.max(b.maxX - r, (b.minX + b.maxX) / 2);
  const minZ = Math.min(b.minZ + r, (b.minZ + b.maxZ) / 2);
  const maxZ = Math.max(b.maxZ - r, (b.minZ + b.maxZ) / 2);
  if (body.x < minX) {
    body.x = minX;
    if (body.vx < 0) body.vx = 0;
    hit = true;
  } else if (body.x > maxX) {
    body.x = maxX;
    if (body.vx > 0) body.vx = 0;
    hit = true;
  }
  if (body.z < minZ) {
    body.z = minZ;
    if (body.vz < 0) body.vz = 0;
    hit = true;
  } else if (body.z > maxZ) {
    body.z = maxZ;
    if (body.vz > 0) body.vz = 0;
    hit = true;
  }
  return hit;
}

// ---------------------------------------------------------------------------------------------
// Parameters from definitions and state (used by the server and by client prediction)
// ---------------------------------------------------------------------------------------------

/** The parts of a kaiju's state that decide how it moves. Kaiju and snapshot kaiju both satisfy it. */
export interface KaijuMoveState {
  kind: KaijuKindId;
  stage: StageId;
  phase: KaijuPhase;
  action: KaijuActionId;
  nerve: number;
  /** Swimming (sim/swim.ts): 0 standing, 1 under. Absent counts as 0. */
  submerge?: number;
}

/**
 * Movement parameters for a kaiju this tick: stage numbers from its kind, slowed and rooted by
 * its current action, and slowed by accumulated nerve damage (up to COMBAT_RULES.nerveSlowMax).
 * The charge (DESIGN.md section 4): rooted but turning in its wind-up; in its run ('charge')
 * fast, quick to reach that speed, slow to turn, and smashing taller structures; rooted and
 * still in its stumble. Its run also drives the body straight ahead (`kaijuMoveInput`).
 */
export function kaijuMoveParams(k: KaijuMoveState, bounds: Bounds, mods?: Mods, out?: MoveParams): MoveParams {
  const def = kaijuKindDef(k.kind);
  const st = perStage(def.stages, k.stage);
  let moveMult = 1;
  let turnMult = 1;
  let accel = st.accel;
  let trampleHeight = st.trampleHeight;
  if (k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead') {
    moveMult = 0;
    turnMult = 0;
  } else if (k.action === 'charge' && k.phase === 'windup') {
    const charge = def.actions.charge;
    moveMult = charge.moveMult;
    turnMult = charge.windupTurnMult;
  } else if (k.action === 'charge' && k.phase === 'charge') {
    const charge = def.actions.charge;
    moveMult = charge.speedMult;
    turnMult = charge.runTurnMult;
    accel = (st.topSpeed * charge.speedMult) / Math.max(charge.rampTime, 1e-3);
    trampleHeight = Math.max(trampleHeight, perStage(charge.smashHeight, k.stage));
  } else if (k.phase !== 'idle' && k.action !== 'none') {
    const action = def.actions[k.action];
    moveMult = action.moveMult;
    turnMult = action.turnMult;
  }
  const nerveSlow = 1 - COMBAT_RULES.nerveSlowMax * clamp01(k.nerve / def.nerveCapacity);
  const speedMod = mods ? modMult(mods, 'speed') : 1;
  const turnMod = mods ? modMult(mods, 'turnRate') : 1;
  const p: MoveParams = out ?? ({} as MoveParams);
  p.steer = 'aim';
  p.topSpeed = st.topSpeed * moveMult * nerveSlow * speedMod;
  p.accel = accel;
  p.turnRate = st.turnRate * turnMult * turnMod;
  p.strafeMult = def.strafeSpeedMult;
  p.reverseMult = def.reverseSpeedMult;
  p.trampleHeight = trampleHeight;
  p.wades = st.wadesTall;
  p.wadeSpeedMult = st.wadeSpeedMult;
  p.waterSpeedMult = st.waterSpeedMult;
  p.bounds = bounds;
  // Swimming: from wading toward its swimming speed as it goes under, with no water slowdown.
  const sub = k.submerge ?? 0;
  const swim = sub > 0 ? def.swim : undefined;
  if (swim) {
    const top = st.topSpeed * nerveSlow * speedMod;
    p.topSpeed = lerp(top * st.waterSpeedMult, top * swim.speedMult, sub);
    p.waterSpeedMult = 1;
    p.turnRate *= lerp(1, swim.turnMult, sub);
  }
  return p;
}

/** What `kaijuMoveInput` needs: the movement state and the body's heading. Kaiju and snapshot kaiju both satisfy it. */
export interface KaijuDriveState extends KaijuMoveState {
  yaw: number;
}

/**
 * The input a kaiju's body moves by this tick (pass it to `stepMovement` with `kaijuMoveParams`):
 * the player's own, except in a charge's run, when the body runs straight along its heading
 * whatever the stick says, still turning (slowly) toward where the player looks. Returns `input`
 * itself or `out`. The server and a client predicting its own kaiju both use it.
 */
export function kaijuMoveInput(k: KaijuDriveState, input: MoveInput, out: MoveInput): MoveInput {
  if (k.action !== 'charge' || k.phase !== 'charge') return input;
  out.aimYaw = input.aimYaw;
  setWorldMove(out, Math.sin(k.yaw), Math.cos(k.yaw), 1);
  return out;
}

/** Speed multiplier for ground units wading through the river (DESIGN.md section 7). */
export const UNIT_WATER_SPEED_MULT = 0.5;

/** The parts of a unit's state that decide how it moves. Unit and snapshot unit both satisfy it. */
export interface UnitMoveState {
  alive: boolean;
  rooted: boolean;
  /** Seconds left of a roar's stun (it cannot move); absent counts as 0. */
  stun?: number;
  /**
   * The unit its squad's player drives (a snapshot unit carries this flag; the server passes
   * it). A vehicle with a `drive` then handles like a tank ('tank' steering). Absent: a sub-unit.
   */
  driven?: boolean;
}

/**
 * Movement parameters for a unit this tick. Planted (charging) and dead units do not move: they
 * brake to a stop, a tank at its `drive.brake`. The driven unit of a vehicle level drives like a
 * tank ('tank' steering with the numbers of `def.drive`); everybody else steers by `def.steer`.
 */
export function unitMoveParams(
  def: UnitTypeDef,
  u: UnitMoveState,
  bounds: Bounds,
  mods?: Mods,
  out?: MoveParams,
): MoveParams {
  // roar stun: a stunned unit does not move.
  const still = !u.alive || u.rooted || (u.stun ?? 0) > 0;
  const speedMod = mods ? modMult(mods, 'speed') : 1;
  const p: MoveParams = out ?? ({} as MoveParams);
  const drive = u.driven ? def.drive : undefined;
  const brake = def.drive ? Math.max(def.accel, def.drive.brake) : def.accel;
  p.steer = drive ? 'tank' : def.steer;
  p.topSpeed = still ? 0 : def.speed * speedMod;
  p.accel = drive ? drive.accel : still ? brake : def.accel;
  p.brake = drive ? drive.brake : brake;
  p.turnRate = still ? 0 : drive ? drive.turnRate : def.turnRate;
  p.turretRate = still || !drive ? 0 : drive.turretRate;
  p.strafeMult = 1;
  p.reverseMult = drive ? drive.reverseMult : 1;
  p.trampleHeight = 0;
  p.wades = false;
  p.wadeSpeedMult = 1;
  p.waterSpeedMult = def.body === 'aircraft' ? 1 : UNIT_WATER_SPEED_MULT;
  p.bounds = bounds;
  return p;
}

/**
 * Writes a world-space move direction into a control or input as view-relative moveX / moveZ
 * (the inverse of what stepMovement does), so AI code can say "go that way at this throttle".
 */
export function setWorldMove(control: MoveInput, dirX: number, dirZ: number, throttle = 1): void {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-9 || throttle <= 0) {
    control.moveX = 0;
    control.moveZ = 0;
    return;
  }
  const t = clamp(throttle, 0, 1) / len;
  const s = Math.sin(control.aimYaw);
  const c = Math.cos(control.aimYaw);
  control.moveZ = (dirX * s + dirZ * c) * t;
  control.moveX = (-dirX * c + dirZ * s) * t;
}
