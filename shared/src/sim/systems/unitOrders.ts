/**
 * System 3 of 12: squad-mates (DESIGN.md section 5, "The humans").
 *
 * The player drives one unit of the squad; the input system has already copied their stick, aim
 * and trigger onto it. The other living units are its squad-mates. Nobody gives them orders:
 * they ride with the leader as a loose swarm and shoot on their own, and the volley button is
 * the one thing the player asks of them. This system runs all of it:
 *
 * - Perception first: `updateSpotting` refreshes `kaiju.spotted` and `kaiju.known`.
 * - Lives: when the driven unit is dead and others live, the player takes over the nearest
 *   survivor (`takeOver`). (The damage system marks the squad eliminated when the last one dies.)
 * - Every living squad-mate then gets its `control` for this tick:
 *     coming down     (reinforcements by parachute) nothing until it lands;
 *     stunned         (a roar) it stands frozen: no moving, no firing, no charge;
 *     shaken          it cannot fire or charge, and backs away from a kaiju that is near;
 *     volley held     (Btn.volley is down, or was let go on this very tick: the weapon system
 *                     fires the volley later in the tick and un-plants the squad) it stops
 *                     where it is and plants: rooted, laser on (`state` 'charging'), its weapon
 *                     swinging toward the point the leader's aim ray lands on (`volleyAim`), its
 *                     charge growing from 0 to 1 over COMBAT_RULES.chargeTime. The leader
 *                     itself is never planted and drives on;
 *     otherwise       it rides in its place in the swarm (`swarmSlot`: one spacing behind the
 *                     leader out to either side, the third two spacings straight behind, single
 *                     file where a street is too narrow), finding its way with sim/nav.ts,
 *                     keeping pace with a leader on the move and hurrying when it has dropped
 *                     behind; and it shoots at will at a kaiju it has range and a clear line of
 *                     fire to (half nerve, the at-will aim error).
 * - It keeps `unit.state` current for animation and says `volley.ready` when every planted
 *   squad-mate of a squad is fully charged.
 *
 * The weapon system fires; this one only sets `control.fire`. Nothing here changes hp.
 */

import { castSegment } from '../../city/spatialIndex';
import { COMBAT_RULES, DT, SQUAD_RULES } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { projectileTypeDef, weaponDef } from '../../defs/weapons';
import { angleDist, DEG, turnToward, yawFromTo, yawOf } from '../../math/angle';
import { approach, clamp } from '../../math/scalar';
import type { Vec2, Vec3 } from '../../math/vec';
import { Btn } from '../../net/input';
import { createAimPoint } from '../aim';
import { setWorldMove } from '../movement';
import { createSteer, resetRoute, steerToward } from '../nav';
import { updateSpotting } from '../spotting';
import { clearTrail, formationSpacing, nearestKaiju, swarmSlot, swarmWidth, trailFollow, updateTrail, volleyAim, type TrailTarget } from '../squads';
import { kaijuShownHeight } from '../swim';
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
/** A leader faster than this is on the move: its squad-mates keep pace with it instead of settling. */
const LEADER_MOVING = 1;
/** On the move, a squad-mate closes the gap to its place in about this many seconds on top of the leader's pace. */
const CLOSE_TIME = 1;
/** A tank squad-mate settled in its place turns to face the way its leader faces, creeping at this throttle... */
const FACE_THROTTLE = 0.06;
/** ...whenever it is more than this far off. */
const FACE_SLACK = 15 * DEG;
/** A squad-mate this many spacings from its place has fallen behind: it drives the leader's way after it... */
const BEHIND_SPACINGS = 3;
/** ...passing every point of it it comes within this many meters (beyond its radius) of, and aiming about a second's drive on. */
const TRAIL_NEAR = 3;
/**
 * A vehicle takes the corners of that way at no more than this share of its top speed: going
 * flat out it would sail past the corner and into the houses (a troop of tanks catching up at
 * 33 m/s slides some 40 m before it has turned).
 */
const TRAIL_CORNER_SPEED = 0.4;

const steer = createSteer();
const slot: Vec2 = { x: 0, z: 0 };
const lead: TrailTarget = { x: 0, z: 0, corner: Infinity };
const push: Vec2 = { x: 0, z: 0 };
const aim = createAimPoint();
const target: Vec3 = { x: 0, y: 0, z: 0 };
const muzzle: Vec3 = { x: 0, y: 0, z: 0 };
const mark: Vec3 = { x: 0, y: 0, z: 0 };
/** Where a sub-unit wants its weapon pointed this tick. */
const want = { yaw: 0, pitch: 0 };

// ---------------------------------------------------------------------------------------------
// The volley button
// ---------------------------------------------------------------------------------------------

/** True while the squad's player holds the volley button, and on the tick it is let go (the weapon system fires then). */
export function volleyHeld(world: World, squad: Squad): boolean {
  const input = world.players[squad.player].input;
  return ((input.buttons | input.released) & Btn.volley) !== 0;
}

/** Plants a squad-mate for the volley: rooted where it stands, laser on, charge from 0. */
function plant(u: Unit): void {
  u.rooted = true;
  u.charge = 0;
  u.state = 'charging';
  u.nav.settled = true;
  u.nav.hurry = 1;
  resetRoute(u.nav);
}

/** One tick of a planted squad-mate: it stands, swings its weapon toward the volley's aim point and charges. */
function holdAndCharge(squad: Squad, u: Unit, aimAt: Vec3 | null): void {
  const c = u.control;
  c.moveX = 0;
  c.moveZ = 0;
  c.fire = false;
  u.state = 'charging';
  const time = COMBAT_RULES.chargeTime * modMult(squad.mods, 'chargeTime');
  u.charge = time > 0 ? Math.min(1, u.charge + DT / time) : 1;
  if (!aimAt) return;
  const dx = aimAt.x - u.x;
  const dz = aimAt.z - u.z;
  const d = Math.hypot(dx, dz);
  if (d < 1) return;
  const step = SQUAD_RULES.aimTurnRate * DT;
  c.aimYaw = turnToward(c.aimYaw, yawOf(dx, dz), step);
  c.aimPitch = approach(c.aimPitch, Math.atan2(aimAt.y - (u.y + unitTypeDef(u.type).muzzleHeight), d), step);
}

// ---------------------------------------------------------------------------------------------
// Lives
// ---------------------------------------------------------------------------------------------

/**
 * Hands the player the surviving unit nearest to the one they just lost (one on the ground
 * before one still coming down by parachute).
 */
function takeOver(world: World, squad: Squad): void {
  const lost = world.units[squad.driven];
  if (lost.alive) return;
  let next: Unit | null = null;
  let best = Infinity;
  for (const id of squad.units) {
    const u = world.units[id];
    if (!u.alive) continue;
    const d = (u.x - lost.x) * (u.x - lost.x) + (u.z - lost.z) * (u.z - lost.z) + (u.drop > 0 ? 1e12 : 0);
    if (d < best) {
      best = d;
      next = u;
    }
  }
  // With nobody left the damage system has already marked the squad eliminated.
  if (!next) return;
  squad.driven = next.id;
  next.rooted = false;
  next.charge = 0;
  next.nav.settled = true;
  next.nav.hurry = 1;
  resetRoute(next.nav);
  if (next.state !== 'shaken') next.state = 'idle';
  // The stick and trigger were held for the unit that died; the new one starts from rest.
  next.control.moveX = 0;
  next.control.moveZ = 0;
  next.control.fire = false;
  clearTrail(squad);
  emit(world, { type: 'takeover', player: squad.player, squad: squad.id, fromUnit: lost.id, toUnit: next.id });
}

// ---------------------------------------------------------------------------------------------
// The swarm
// ---------------------------------------------------------------------------------------------

/**
 * Steers a squad-mate toward its place in the swarm (into `steer`). Behind the leader as it
 * goes, a squad-mate keeps the leader's pace and a little more until it is in its place, then
 * rides along; one that has dropped well behind hurries (`nav.hurry`). Around a leader that has
 * stopped it settles in its place and does not shuffle after every small move.
 */
function followSwarm(world: World, squad: Squad, leader: Unit, u: Unit, rank: number, width: number): void {
  steer.dirX = 0;
  steer.dirZ = 0;
  steer.throttle = 0;
  const nav = u.nav;
  nav.hurry = 1;
  // Not formed up yet (a fresh deployment): the unit's place is where it stands.
  if (!swarmSlot(world, squad, leader, u, rank, width, slot)) {
    nav.settled = true;
    return;
  }
  const def = unitTypeDef(u.type);
  const tolerance = SQUAD_RULES.slotTolerance * u.radius + 1;
  const resume = 1.5 * tolerance + 0.5;
  const dist = Math.hypot(slot.x - u.x, slot.z - u.z);
  const lvx = leader.vx;
  const lvz = leader.vz;
  const pace = Math.hypot(lvx, lvz);
  const onTheMove = pace > LEADER_MOVING;
  if (!onTheMove && nav.settled && dist <= resume) {
    // Settled: a tank turns to face where its leader faces, so that the swarm sets off together.
    // (Infantry turns at once whichever way it goes.)
    if (def.steer === 'heading' && angleDist(u.yaw, leader.yaw) > FACE_SLACK) {
      steer.dirX = Math.sin(leader.yaw);
      steer.dirZ = Math.cos(leader.yaw);
      steer.throttle = FACE_THROTTLE;
    }
    return;
  }

  nav.settled = false;
  const top = def.speed * modMult(squad.mods, 'speed');
  if (dist > BEHIND_SPACINGS * formationSpacing(u)) {
    // Fallen behind: flat out along the way the leader came (it is open to a unit of this size),
    // which beats finding a way of its own to a place that keeps moving off. Off that way, it
    // first goes to where the way passes nearest (a point that stays put), unless its place is nearer.
    const fast = top * SQUAD_RULES.catchUpSpeed;
    const corner = TRAIL_CORNER_SPEED * top;
    // A vehicle looks out for a corner as far ahead as it needs to brake for it.
    const reach = def.steer === 'heading' ? (fast * fast - corner * corner) / (2 * def.accel) + u.radius : 0;
    if (trailFollow(squad, u, u.radius + TRAIL_NEAR, Math.max(3 * u.radius, def.speed), reach, lead) < dist) {
      steerToward(world, u, lead.x, lead.z, 1, steer);
      nav.hurry = SQUAD_RULES.catchUpSpeed;
      if (steer.throttle > 0) {
        // Flat out, braking in time to take the leader's next corner at corner speed.
        const v = def.steer === 'heading' ? Math.sqrt(corner * corner + 2 * def.accel * Math.max(0, lead.corner - u.radius)) : fast;
        steer.throttle = Math.min(1, v / fast);
      }
      return;
    }
  }
  nav.trailMark = -1;
  steerToward(world, u, slot.x, slot.z, tolerance, steer);
  if (steer.arrived) {
    if (onTheMove) {
      // In its place: ride along with the leader.
      steer.dirX = lvx / pace;
      steer.dirZ = lvz / pace;
      steer.throttle = Math.min(1, pace / top);
    } else {
      nav.settled = true;
    }
    return;
  }
  if (onTheMove && (slot.x - u.x) * lvx + (slot.z - u.z) * lvz <= 0) {
    // Ahead of its place: ride along a little slower while the place catches up (a tank does
    // not turn round for a place that is coming to it anyway).
    steer.dirX = lvx / pace;
    steer.dirZ = lvz / pace;
    steer.throttle = clamp((pace - dist / CLOSE_TIME) / top, 0, 1);
    return;
  }
  // On its way to its place: the leader's pace (its place moves with the leader), and on top of
  // it no more than it can still brake from in the distance left, so that it does not overshoot
  // (a troop of tanks at full speed needs some 25 m to stop). Faster than the leader if it must.
  const want = (onTheMove ? pace : 0) + Math.sqrt(2 * def.accel * dist);
  if (want > top) nav.hurry = SQUAD_RULES.catchUpSpeed;
  // Along the streets the navigation's own easing for the corners stands.
  if (steer.throttle > 0 && nav.path.length === 0) steer.throttle = Math.min(1, want / (top * nav.hurry));
}

/**
 * Adds a push away from any moving unit this one overlaps, so a swarm on the move does not
 * bunch up. Units that stand still are walked past: a planted squad is not an obstacle course.
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

// ---------------------------------------------------------------------------------------------
// Fire at will, and backing off
// ---------------------------------------------------------------------------------------------

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
        mark.y = kaijuShownHeight(k) * SQUAD_RULES.aimHeights[h];
        // Rubble and fallen buildings are in the way up to their height.
        if (castSegment(world.cityQuery, muzzle, mark, undefined, -1, true, true)) continue;
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
  want.pitch = Math.atan2(kaijuShownHeight(k) * SQUAD_RULES.aimHeights[nav.shotHeight] - muzzle.y, Math.max(Math.hypot(tx - u.x, tz - u.z), 1e-6));
  return true;
}

/** A shaken unit lets go of everything (its charge too) and backs away from a kaiju that is near. */
function backOff(world: World, u: Unit): void {
  const c = u.control;
  c.fire = false;
  u.rooted = false;
  u.charge = 0;
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

// ---------------------------------------------------------------------------------------------
// One squad-mate, one tick
// ---------------------------------------------------------------------------------------------

function orderSubUnit(world: World, squad: Squad, leader: Unit, u: Unit, rank: number, width: number, held: boolean, aimAt: Vec3 | null): void {
  const c = u.control;
  c.fire = false;
  // Reinforcements still coming down by parachute (sim/systems/pickups.ts) do nothing until they land.
  if (u.drop > 0) {
    c.moveX = 0;
    c.moveZ = 0;
    u.rooted = false;
    u.charge = 0;
    u.state = 'idle';
    return;
  }
  // roar stun: frozen where it stands; it neither moves, nor fires, nor charges.
  if (u.stun > 0) {
    c.moveX = 0;
    c.moveZ = 0;
    u.rooted = false;
    u.charge = 0;
    return;
  }
  if (u.shaken > 0) {
    backOff(world, u);
    return;
  }
  if (held) {
    // The volley: stop where it stands, plant once, and charge for as long as the button is held.
    if (!u.rooted) plant(u);
    holdAndCharge(squad, u, aimAt);
    return;
  }
  if (u.rooted) {
    // Let go without a shot (the weapon system un-plants those that fired): the charge is gone.
    u.rooted = false;
    u.charge = 0;
  }
  followSwarm(world, squad, leader, u, rank, width);
  // On the move it keeps clear of the others; on the last few meters it does not, or a unit
  // standing where it is going would hold it off for good.
  const nav = u.nav;
  if (!nav.settled && Math.hypot(nav.goalX - u.x, nav.goalZ - u.z) > 2 * u.radius + SEPARATION_GAP) separate(world, u);

  // Where the weapon points: at a target it can shoot, otherwise along the way it is going, and
  // where the leader looks when it is standing by.
  const step = SQUAD_RULES.aimTurnRate * DT;
  const shot = findShot(world, squad, u);
  if (!shot) {
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
    // An eliminated player is out until the next stage.
    if (squad.eliminated || squad.driven < 0) {
      squad.volleyReady = false;
      continue;
    }
    takeOver(world, squad);
    const leader = world.units[squad.driven];
    if (!leader.alive) continue;
    updateTrail(squad, leader);

    // The driven unit is never planted; the player moves and aims it.
    leader.rooted = false;
    if (leader.shaken <= 0) {
      leader.state = leader.vx * leader.vx + leader.vz * leader.vz > MOVING_SPEED * MOVING_SPEED ? 'moving' : 'idle';
    }

    let mates = 0;
    let sample: Unit | null = null;
    for (const id of squad.units) {
      const u = world.units[id];
      if (!u.alive || id === squad.driven) continue;
      mates++;
      sample ??= u;
    }
    if (!sample) {
      squad.volleyReady = false;
      continue;
    }
    const held = volleyHeld(world, squad);
    let aimAt: Vec3 | null = null;
    if (held) {
      volleyAim(world, leader, aim, target);
      aimAt = target;
    }
    const width = held ? 1 : swarmWidth(world, squad, leader, sample, mates);

    let rank = 0;
    let holding = 0;
    let full = 0;
    for (const id of squad.units) {
      const u = world.units[id];
      if (!u.alive || id === squad.driven) continue;
      orderSubUnit(world, squad, leader, u, rank++, width, held, aimAt);
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
