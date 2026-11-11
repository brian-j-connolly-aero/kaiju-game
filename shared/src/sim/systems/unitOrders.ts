/**
 * System 3 of 11: unit orders and sub-unit behavior (DESIGN.md section 5).
 *
 * The player drives one unit of the squad (the input system has already copied their stick,
 * aim and trigger onto it). This system runs everything else about a squad:
 *
 * - Perception first: `updateSpotting` refreshes `kaiju.spotted` and `kaiju.known`.
 * - Lives: when the driven unit is dead and others live, the player takes over the nearest
 *   survivor (`takeover`). (The damage system marks the squad eliminated when the last one dies.)
 * - Commands from `player.commands`. The movement order ('follow' / 'moveTo') and the fire mode
 *   ('atWill' / 'charge') are independent; a call-in request starts a mission if it is ready.
 * - Every living sub-unit then gets its `control` for this tick:
 *     shaken            it cannot fire, lets go of a hold, and backs away from a kaiju that is near;
 *     on hold (rooted)  it stands, keeps its laser on the target inside its firing arc, and
 *                       builds charge from 0 to 1 over COMBAT_RULES.chargeTime;
 *     otherwise         it goes to its hold point when it has one (by the move-to marker, or
 *                       where a hold command parked it) and else to its place in the column
 *                       behind the leader, finding its way with sim/nav.ts. In fire mode
 *                       'atWill' it shoots on its own at a kaiju it has range and a clear line
 *                       of fire to; in fire mode 'charge' it holds fire, and plants itself when
 *                       it is at its hold point.
 * - It keeps `unit.state` current for animation and says `volley.ready` when every charging
 *   sub-unit of a squad is full.
 *
 * Hold-and-charge, as built:
 * - "hold fire and charge" means "hold here and charge". With the order 'follow' the command
 *   parks every sub-unit where it stands (that spot becomes its hold point); with the order
 *   'moveTo' they keep the hold points by the marker. A sub-unit that is at its hold point
 *   plants itself: it is rooted, its firing arc (COMBAT_RULES.chargeHalfArc either side) is
 *   fixed at that moment, its laser is on (`state` 'charging') and its charge starts from 0.
 *   The arc points at the kaiju when the humans know where it is (or the unit sees it),
 *   otherwise at what the leader is aiming at;
 * - a planted unit stays planted while the leader goes wherever it likes. Firing a volley
 *   spends the charge and ends that hold, and the unit plants itself again on the spot the
 *   next tick: a fresh arc, aimed anew, and the charge builds again;
 * - a new movement order lets it go and clears its charge. 'follow' gives up the parking spot:
 *   the sub-units come along holding their fire, and do not plant again until the hold command
 *   is given again. 'moveTo' sends them to the marker, where they plant when they arrive;
 * - 'fire at will' ends the hold too (parked units fall back in behind the leader);
 * - a shaken unit lets go and backs off; when it steadies it returns to its hold point and
 *   plants again. Giving the hold command again plants everybody afresh: new arcs, charge from 0.
 *
 * The weapon system fires; this one only sets `control.fire`. Nothing here changes hp.
 */

import { castSegment } from '../../city/spatialIndex';
import { callInDef } from '../../defs/callins';
import { factionLevelDef } from '../../defs/factions';
import { COMBAT_RULES, DT, SQUAD_RULES } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { projectileTypeDef, weaponDef } from '../../defs/weapons';
import { angleDist, clampAngleAround, turnToward, yawFromTo, yawOf } from '../../math/angle';
import { approach, clamp } from '../../math/scalar';
import type { Vec2, Vec3 } from '../../math/vec';
import { createAimPoint, resolveAimPoint } from '../aim';
import type { SquadCommand } from '../commands';
import { setWorldMove } from '../movement';
import { createSteer, resetRoute, steerToward } from '../nav';
import { updateSpotting } from '../spotting';
import {
  assignHoldPoints,
  chargeTarget,
  formationSlot,
  nearestKaiju,
  scatterMult,
  updateTrail,
} from '../squads';
import type { Squad, Unit, World } from '../types';
import { emit } from '../worldOps';
import { say } from './voice';

/** A unit moving faster than this is 'moving' for animation. */
const MOVING_SPEED = 0.2;
/** How far ahead of itself a shaken unit picks the point it runs for. */
const FLEE_STEP = 30;
/** Units push apart when their circles come closer than this to touching. */
const SEPARATION_GAP = 0.5;
const SEPARATION_WEIGHT = 0.8;
/** A sub-unit firing at will checks its lines of fire every this many ticks (five times a second). */
const SHOT_LOOK_TICKS = 6;

const steer = createSteer();
const slot: Vec2 = { x: 0, z: 0 };
const push: Vec2 = { x: 0, z: 0 };
const aim = createAimPoint();
const muzzle: Vec3 = { x: 0, y: 0, z: 0 };
const mark: Vec3 = { x: 0, y: 0, z: 0 };
/** Where a sub-unit wants its weapon pointed this tick. */
const want = { yaw: 0, pitch: 0 };

// ---------------------------------------------------------------------------------------------
// Hold-and-charge
// ---------------------------------------------------------------------------------------------

/** Lets a unit go from a hold: it may move again and whatever charge it had is gone. */
function release(u: Unit): void {
  u.rooted = false;
  u.charge = 0;
  u.nav.settled = false;
  u.nav.hurry = 1;
  resetRoute(u.nav);
}

/** The heading a unit's firing arc is centered on when it plants itself now. */
function arcCenter(world: World, leader: Unit, u: Unit): number {
  const k = chargeTarget(world, u);
  if (k) return yawFromTo(u.x, u.z, k.x, k.z);
  // Nothing to point at: cover what the leader is looking at.
  const eye = unitTypeDef(leader.type).eyeHeight;
  const c = leader.control;
  resolveAimPoint(world.cityQuery, leader.x, leader.y + eye, leader.z, c.aimYaw, c.aimPitch, SQUAD_RULES.aimRayRange, aim);
  const dx = aim.x - u.x;
  const dz = aim.z - u.z;
  if (aim.on === 'none' || dx * dx + dz * dz < 1) return c.aimYaw;
  return yawOf(dx, dz);
}

/** Plants a unit for a charge: rooted where it stands, arc fixed, laser on, charge from 0. */
function plant(world: World, leader: Unit, u: Unit): void {
  u.rooted = true;
  u.charge = 0;
  u.state = 'charging';
  u.arcYaw = arcCenter(world, leader, u);
  u.nav.settled = true;
  u.nav.hurry = 1;
  resetRoute(u.nav);
  const c = u.control;
  c.moveX = 0;
  c.moveZ = 0;
  c.fire = false;
  c.aimYaw = u.arcYaw;
  c.aimPitch = 0;
}

/** One tick of holding: charge builds and the laser follows the target as far as the arc allows. */
function holdAndCharge(world: World, squad: Squad, u: Unit): void {
  const c = u.control;
  c.moveX = 0;
  c.moveZ = 0;
  c.fire = false;
  u.state = 'charging';
  const time = COMBAT_RULES.chargeTime * modMult(squad.mods, 'chargeTime');
  u.charge = time > 0 ? Math.min(1, u.charge + DT / time) : 1;

  let yaw = u.arcYaw;
  let pitch = 0;
  const k = chargeTarget(world, u);
  if (k) {
    const type = unitTypeDef(u.type);
    const d = Math.hypot(k.x - u.x, k.z - u.z);
    yaw = clampAngleAround(yawFromTo(u.x, u.z, k.x, k.z), u.arcYaw, COMBAT_RULES.chargeHalfArc);
    pitch = Math.atan2(k.height * SQUAD_RULES.aimHeights[0] - (u.y + type.muzzleHeight), Math.max(d, 1e-6));
  }
  const step = SQUAD_RULES.aimTurnRate * DT;
  c.aimYaw = clampAngleAround(turnToward(c.aimYaw, yaw, step), u.arcYaw, COMBAT_RULES.chargeHalfArc);
  c.aimPitch = approach(c.aimPitch, pitch, step);
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

function startCallIn(world: World, squad: Squad, leader: Unit, c: Extract<SquadCommand, { type: 'callIn' }>): void {
  const index = factionLevelDef(squad.faction, world.match.stage).callIns.indexOf(c.callIn);
  if (index < 0 || (squad.callInCooldowns[index] ?? 0) > 0) return;
  const def = callInDef(c.callIn);
  const b = world.match.bounds;
  const x = clamp(c.x, b.minX, b.maxX);
  const z = clamp(c.z, b.minZ, b.maxZ);
  // The shells come over the caller's shoulder: from behind the squad toward the marker.
  let dirX = x - leader.x;
  let dirZ = z - leader.z;
  const d = Math.hypot(dirX, dirZ);
  if (d > 1) {
    dirX /= d;
    dirZ /= d;
  } else {
    dirX = Math.sin(leader.control.aimYaw);
    dirZ = Math.cos(leader.control.aimYaw);
  }
  const id = world.nextCallInId++;
  world.callIns.push({
    id,
    callIn: c.callIn,
    squad: squad.id,
    player: squad.player,
    x,
    z,
    timer: def.delay,
    shellsLeft: def.shells,
    nextShell: 0,
    dirX,
    dirZ,
  });
  squad.callInCooldowns[index] = def.cooldown * modMult(squad.mods, 'callInCooldown');
  emit(world, {
    type: 'callin',
    id,
    callIn: c.callIn,
    squad: squad.id,
    player: squad.player,
    x,
    z,
    phase: 'marked',
    delay: def.delay,
    radius: def.scatterRadius * scatterMult(world.match.stage, nearestKaiju(world, x, z)),
  });
}

function applyCommand(world: World, squad: Squad, leader: Unit, c: SquadCommand): void {
  switch (c.type) {
    case 'follow':
      squad.moveOrder = 'follow';
      squad.formed = true;
      break;
    case 'moveTo': {
      const b = world.match.bounds;
      squad.moveOrder = 'moveTo';
      squad.moveTarget.x = clamp(c.x, b.minX, b.maxX);
      squad.moveTarget.z = clamp(c.z, b.minZ, b.maxZ);
      assignHoldPoints(world, squad);
      break;
    }
    case 'fireAtWill':
      squad.fireMode = 'atWill';
      break;
    case 'holdCharge':
      squad.fireMode = 'charge';
      break;
    case 'callIn':
      startCallIn(world, squad, leader, c);
      return;
  }
  const parked = squad.moveOrder === 'follow';
  for (const id of squad.units) {
    const u = world.units[id];
    if (!u.alive || id === squad.driven) continue;
    // Every wheel command ends the hold a unit is in; one that is at its hold point on
    // hold-and-charge plants itself afresh this same tick.
    release(u);
    // By the move-to marker a unit keeps its hold point. Following the leader there are none,
    // except the spot a hold command parks a unit on.
    if (!parked && u.nav.hasHold) continue;
    u.nav.hasHold = c.type === 'holdCharge';
    u.nav.holdX = u.x;
    u.nav.holdZ = u.z;
  }
}

// ---------------------------------------------------------------------------------------------
// Lives
// ---------------------------------------------------------------------------------------------

/** Hands the player the surviving unit nearest to the one they just lost. */
function takeOver(world: World, squad: Squad): void {
  const lost = world.units[squad.driven];
  if (lost.alive) return;
  let next: Unit | null = null;
  let best = Infinity;
  for (const id of squad.units) {
    const u = world.units[id];
    if (!u.alive) continue;
    const d = (u.x - lost.x) * (u.x - lost.x) + (u.z - lost.z) * (u.z - lost.z);
    if (d < best) {
      best = d;
      next = u;
    }
  }
  // With nobody left the damage system has already marked the squad eliminated.
  if (!next) return;
  squad.driven = next.id;
  release(next);
  next.nav.hasHold = false;
  if (next.state !== 'shaken') next.state = 'idle';
  // The stick and trigger were held for the unit that died; the new one starts from rest.
  next.control.moveX = 0;
  next.control.moveZ = 0;
  next.control.fire = false;
  squad.trail.length = 0;
  emit(world, { type: 'takeover', player: squad.player, squad: squad.id, fromUnit: lost.id, toUnit: next.id });
}

// ---------------------------------------------------------------------------------------------
// Sub-unit behavior
// ---------------------------------------------------------------------------------------------

/**
 * Steers a sub-unit toward where it belongs (into `steer`): its hold point when it has one,
 * otherwise its place in the column behind the leader. Returns true when it is at its hold point.
 */
function followOrder(world: World, squad: Squad, leader: Unit, u: Unit, rank: number): boolean {
  steer.dirX = 0;
  steer.dirZ = 0;
  steer.throttle = 0;
  const nav = u.nav;
  nav.hurry = 1;

  let gx: number;
  let gz: number;
  let tolerance: number;
  let resume: number;
  if (nav.hasHold) {
    gx = nav.holdX;
    gz = nav.holdZ;
    tolerance = SQUAD_RULES.arriveRadius;
    resume = tolerance + 0.5;
  } else {
    // Not formed up yet (a fresh deployment): the unit's place is where it stands.
    if (!formationSlot(world, squad, leader, u, rank, slot)) {
      nav.settled = true;
      return false;
    }
    gx = slot.x;
    gz = slot.z;
    tolerance = SQUAD_RULES.slotTolerance * u.radius + 1;
    // A unit that has stopped in its slot does not shuffle after every small move of the leader.
    resume = 1.5 * tolerance + 0.5;
  }

  const dist = Math.hypot(gx - u.x, gz - u.z);
  if (!nav.settled || dist > resume) {
    nav.settled = false;
    steerToward(world, u, gx, gz, tolerance, steer);
    if (steer.arrived) nav.settled = true;
    // The leader is as fast as its sub-units: one that has dropped out of the column hurries to close up.
    else if (!nav.hasHold && dist > resume) nav.hurry = SQUAD_RULES.catchUpSpeed;
  }
  return nav.settled && nav.hasHold;
}

/**
 * Adds a push away from any moving unit this one overlaps, so a column on the move does not
 * bunch up. Units that stand still are walked past: a parked squad is not an obstacle course.
 */
function separate(world: World, u: Unit): void {
  push.x = 0;
  push.z = 0;
  for (const o of world.units) {
    if (o === u || !o.alive || o.vx * o.vx + o.vz * o.vz <= MOVING_SPEED * MOVING_SPEED) continue;
    const dx = u.x - o.x;
    const dz = u.z - o.z;
    const min = u.radius + o.radius + SEPARATION_GAP;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    const w = (min - d) / min;
    if (d > 1e-3) {
      push.x += (dx / d) * w;
      push.z += (dz / d) * w;
    } else {
      // Exactly on top of each other: part in a fixed direction that differs per unit.
      push.x += Math.sin(u.id * 2.4) * w;
      push.z += Math.cos(u.id * 2.4) * w;
    }
  }
  if (push.x === 0 && push.z === 0) return;
  const mx = steer.dirX * steer.throttle + push.x * SEPARATION_WEIGHT;
  const mz = steer.dirZ * steer.throttle + push.z * SEPARATION_WEIGHT;
  const len = Math.hypot(mx, mz);
  if (len < 1e-6) return;
  steer.dirX = mx / len;
  steer.dirZ = mz / len;
  steer.throttle = Math.min(1, len);
}

/**
 * Looks for something to shoot at will: the nearest living kaiju within the weapon's range that
 * the unit has a clear line of fire to (to the middle of its body, or failing that higher or
 * lower on it). The lines are cast a few times a second; in between the unit keeps tracking
 * the target it found. Leaves the aim (leading the target by the projectile's flight time) in
 * `want` and returns true when there is a shot.
 */
function findShot(world: World, squad: Squad, u: Unit): boolean {
  const type = unitTypeDef(u.type);
  const weapon = weaponDef(type.weapon);
  const range = weapon.range * modMult(squad.mods, 'weaponRange');
  const speed = projectileTypeDef(weapon.projectile).speed;
  const nav = u.nav;
  muzzle.x = u.x;
  muzzle.y = u.y + type.muzzleHeight;
  muzzle.z = u.z;

  if ((world.tick + u.id) % SHOT_LOOK_TICKS === 0 || nav.shotAt >= world.kaijus.length) {
    nav.shotAt = -1;
    let best = Infinity;
    for (const k of world.kaijus) {
      if (!k.alive) continue;
      const d = Math.hypot(k.x - u.x, k.z - u.z);
      if (d - k.radius > range || d >= best) continue;
      // The line of fire to where it will be when the shot arrives.
      const t = speed > 0 ? d / speed : 0;
      mark.x = k.x + k.vx * t;
      mark.z = k.z + k.vz * t;
      for (let h = 0; h < SQUAD_RULES.aimHeights.length; h++) {
        mark.y = k.height * SQUAD_RULES.aimHeights[h];
        if (castSegment(world.cityQuery, muzzle, mark, undefined, -1, true)) continue;
        nav.shotAt = k.id;
        nav.shotHeight = h;
        best = d;
        break;
      }
    }
  }
  if (nav.shotAt < 0) return false;
  const k = world.kaijus[nav.shotAt];
  const d = Math.hypot(k.x - u.x, k.z - u.z);
  if (!k.alive || d - k.radius > range) {
    nav.shotAt = -1;
    return false;
  }
  const t = speed > 0 ? d / speed : 0;
  const tx = k.x + k.vx * t;
  const tz = k.z + k.vz * t;
  want.yaw = yawFromTo(u.x, u.z, tx, tz);
  want.pitch = Math.atan2(k.height * SQUAD_RULES.aimHeights[nav.shotHeight] - muzzle.y, Math.max(Math.hypot(tx - u.x, tz - u.z), 1e-6));
  return true;
}

/** A shaken unit lets go of everything and backs away from a kaiju that is near. */
function backOff(world: World, u: Unit): void {
  const c = u.control;
  c.fire = false;
  u.rooted = false;
  u.nav.settled = false;
  u.nav.hurry = 1;
  steer.dirX = 0;
  steer.dirZ = 0;
  steer.throttle = 0;
  const k = nearestKaiju(world, u.x, u.z);
  if (k) {
    const dx = u.x - k.x;
    const dz = u.z - k.z;
    const d = Math.hypot(dx, dz);
    if (d < Math.max(SQUAD_RULES.backOffMin, SQUAD_RULES.backOffRadii * k.radius)) {
      const ax = d > 1e-6 ? dx / d : Math.sin(u.yaw + Math.PI);
      const az = d > 1e-6 ? dz / d : Math.cos(u.yaw + Math.PI);
      const b = world.match.bounds;
      const inset = u.radius + 1;
      const fx = clamp(u.x + ax * FLEE_STEP, b.minX + inset, b.maxX - inset);
      const fz = clamp(u.z + az * FLEE_STEP, b.minZ + inset, b.maxZ - inset);
      steerToward(world, u, fx, fz, 1, steer);
      // It runs flat out, and keeps its eyes on the thing it is running from.
      if (steer.throttle > 0) steer.throttle = 1;
      c.aimYaw = turnToward(c.aimYaw, yawFromTo(u.x, u.z, k.x, k.z), SQUAD_RULES.aimTurnRate * DT);
    }
  }
  setWorldMove(c, steer.dirX, steer.dirZ, steer.throttle);
}

function orderSubUnit(world: World, squad: Squad, leader: Unit, u: Unit, rank: number): void {
  const c = u.control;
  c.fire = false;
  if (u.shaken > 0) {
    backOff(world, u);
    return;
  }

  const charging = squad.fireMode === 'charge';
  if (!charging) u.rooted = false;
  if (!u.rooted) {
    // Free to move: go where it belongs. On hold-and-charge, plant once at its hold point.
    const holding = followOrder(world, squad, leader, u, rank);
    if (charging && holding) plant(world, leader, u);
  }
  if (u.rooted) {
    holdAndCharge(world, squad, u);
    return;
  }
  // On the move it keeps clear of the others; on the last few meters it does not, or a unit
  // standing where it is going would hold it off for good.
  const nav = u.nav;
  if (!nav.settled && Math.hypot(nav.goalX - u.x, nav.goalZ - u.z) > 2 * u.radius + SEPARATION_GAP) separate(world, u);

  // Where the weapon points: at a target when firing at will, otherwise along the way it is
  // going, and where the leader looks when it is standing by.
  const step = SQUAD_RULES.aimTurnRate * DT;
  let shot = false;
  if (!charging && findShot(world, squad, u)) {
    shot = true;
  } else {
    want.yaw = steer.throttle > 0 ? yawOf(steer.dirX, steer.dirZ) : leader.control.aimYaw;
    want.pitch = 0;
  }
  c.aimYaw = turnToward(c.aimYaw, want.yaw, step);
  c.aimPitch = approach(c.aimPitch, want.pitch, step);
  if (shot) {
    const tol = SQUAD_RULES.aimFireTolerance;
    c.fire = angleDist(c.aimYaw, want.yaw) <= tol && Math.abs(c.aimPitch - want.pitch) <= tol;
  }
  setWorldMove(c, steer.dirX, steer.dirZ, steer.throttle);
  u.state = u.vx * u.vx + u.vz * u.vz > MOVING_SPEED * MOVING_SPEED ? 'moving' : 'idle';
}

export function unitOrderSystem(world: World): void {
  if (world.match.phase !== 'playing') return;
  updateSpotting(world);

  for (const squad of world.squads) {
    // An eliminated player is out until the next stage: nothing to order, nothing to call in.
    if (squad.eliminated || squad.driven < 0) {
      squad.volleyReady = false;
      continue;
    }
    takeOver(world, squad);
    const leader = world.units[squad.driven];
    if (!leader.alive) continue;

    for (const c of world.players[squad.player].commands) applyCommand(world, squad, leader, c);
    updateTrail(squad, leader);

    // The driven unit is never on hold; the player moves and aims it.
    leader.rooted = false;
    if (leader.shaken <= 0) {
      leader.state = leader.vx * leader.vx + leader.vz * leader.vz > MOVING_SPEED * MOVING_SPEED ? 'moving' : 'idle';
    }

    let rank = 0;
    let holding = 0;
    let full = 0;
    for (const id of squad.units) {
      const u = world.units[id];
      if (!u.alive || id === squad.driven) continue;
      orderSubUnit(world, squad, leader, u, rank++);
      if (u.rooted) {
        holding++;
        if (u.charge >= 1) full++;
      }
    }
    const ready = holding > 0 && full === holding;
    if (ready && !squad.volleyReady) say(world, 'volley.ready', squad.id, squad.player);
    squad.volleyReady = ready;
  }
}
