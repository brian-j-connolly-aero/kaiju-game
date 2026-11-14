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
 */

import { bridgeAt, groundCodeAt, GROUND_WATER, structureContact, structuresInCircle, type CityQuery } from '../city/spatialIndex';
import { kaijuKindDef } from '../defs/kaiju/index';
import type { KaijuActionId, KaijuKindId, KaijuPhase, StageId } from '../defs/ids';
import { perStage } from '../defs/ids';
import { COMBAT_RULES } from '../defs/rules';
import type { Mods, SteerModel, UnitTypeDef } from '../defs/schema';
import { modMult } from '../defs/upgrades';
import { angleDiff, turnToward, yawOf } from '../math/angle';
import { createContact, type Bounds, type Contact } from '../math/geom';
import { clamp, clamp01, lerp } from '../math/scalar';

/** The moving part of a body. Kaiju and Unit both satisfy it. */
export interface MoveBody {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  radius: number;
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
  /** 'aim' steering only: speed multipliers for moving sideways and backward relative to the body. */
  strafeMult: number;
  reverseMult: number;
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

  // --- Intent: a world-space direction and a 0..1 throttle ----------------------------------
  let mag = Math.hypot(input.moveX, input.moveZ);
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
  if (params.steer === 'aim') {
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

  // --- Accelerate toward it and move ---------------------------------------------------------
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
 */
export function kaijuMoveParams(k: KaijuMoveState, bounds: Bounds, mods?: Mods, out?: MoveParams): MoveParams {
  const def = kaijuKindDef(k.kind);
  const st = perStage(def.stages, k.stage);
  let moveMult = 1;
  let turnMult = 1;
  if (k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead') {
    moveMult = 0;
    turnMult = 0;
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
  p.accel = st.accel;
  p.turnRate = st.turnRate * turnMult * turnMod;
  p.strafeMult = def.strafeSpeedMult;
  p.reverseMult = def.reverseSpeedMult;
  p.trampleHeight = st.trampleHeight;
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

/** Speed multiplier for ground units wading through the river (DESIGN.md section 7). */
export const UNIT_WATER_SPEED_MULT = 0.5;

/** The parts of a unit's state that decide how it moves. Unit and snapshot unit both satisfy it. */
export interface UnitMoveState {
  alive: boolean;
  rooted: boolean;
}

/** Movement parameters for a unit this tick. Rooted (charging) and dead units do not move. */
export function unitMoveParams(
  def: UnitTypeDef,
  u: UnitMoveState,
  bounds: Bounds,
  mods?: Mods,
  out?: MoveParams,
): MoveParams {
  const still = !u.alive || u.rooted;
  const speedMod = mods ? modMult(mods, 'speed') : 1;
  const p: MoveParams = out ?? ({} as MoveParams);
  p.steer = def.steer;
  p.topSpeed = still ? 0 : def.speed * speedMod;
  p.accel = def.accel;
  p.turnRate = still ? 0 : def.turnRate;
  p.strafeMult = 1;
  p.reverseMult = 1;
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
