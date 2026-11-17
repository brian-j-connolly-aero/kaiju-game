/**
 * Throws on real ballistic arcs (docs/ROADMAP.md, round 4: "real trajectory physics, could angle
 * over buildings"; DESIGN.md section 4, "Throw"). One place for the physics, used by the
 * simulation (the kaiju's throw: sim/kaijuEffects.ts `throwEffect`), the bots (the monster bot
 * and the client's autopilot aim with `aimThrowAt`), the monster player's crosshair (round 5:
 * `aimThrowAtPoint`, the throw lands where the crosshair points and the arc is picked for it) and
 * the trajectory preview on the monster player's screen, so the arc drawn is the arc flown.
 *
 * - Launch (`throwFlight`, `throwLaunch`): from the hand (HAND_FORWARD body radii ahead of the
 *   body's axis along the aim, at the stage's hand height), along the aim's heading, at the aim's
 *   pitch plus a `lift` (it leaves a little above where the head looks), at a speed set by the
 *   stage and the object's weight, under the stage's gravity. Javelins (an antenna, a radio mast's
 *   top) and the garage door are thrown flat: their elevation is held under the angle that
 *   carries them their `range`.
 * - Error (`throwError`): the launch velocity is off by a random vector, uniform in a ball of
 *   radius speed × tan(spread), drawn from a seed (the match seed, the tick and the kaiju: the
 *   same on every run and every machine). After t seconds the throw is then within
 *   speed × tan(spread) × t of where the aimed arc is: a tube round the arc whose round
 *   cross-section grows with the flight (`spreadAt`). Where it comes down, that ball's shadow
 *   along the flight is an ellipse (`landingSpread`): round for a lob, long for a flat throw.
 * - Flight: the projectile system flies it (sim/systems/projectiles.ts). `traceThrow` steps the
 *   aimed arc exactly the same way, a tick at a time, against the city (standing structures, the
 *   rubble beyond the kaiju's reach, the ground) for the preview and the bots; units and the
 *   other kaiju are left out (the preview shows where the throw meets the city).
 */

import { PROP_KINDS } from '../city/props';
import { castSegment, createCityCastHit, type CityQuery } from '../city/spatialIndex';
import type { KaijuKindId, StageId } from '../defs/ids';
import { perStage } from '../defs/ids';
import { kaijuKindDef, kaijuStageDef } from '../defs/kaiju/index';
import { DT } from '../defs/rules';
import { projectileTypeDef } from '../defs/weapons';
import { createRng, rngFloat } from '../math/rng';
import type { Vec3 } from '../math/vec';
import { HAND_FORWARD } from './cityWeapons';
import type { HeldObject } from './events';
import { stepProjectile, type ProjectileBody } from './systems/projectiles';

/** How a held object flies when thrown (`throwFlight`). */
export interface ThrowFlight {
  speed: number;
  gravity: number;
  /** Radians above where the head looks that it leaves at. */
  lift: number;
  /** The steepest it can be thrown up, and down (radians above the horizon; the second is negative). */
  maxElevation: number;
  minElevation: number;
  /** Half-angle of the cone of its error (radians; see the header). */
  spread: number;
  /** Seconds it may fly. */
  ttl: number;
}

export function createThrowFlight(): ThrowFlight {
  return { speed: 0, gravity: 0, lift: 0, maxElevation: 0, minElevation: 0, spread: 0, ttl: 0 };
}

/** What fixes where a throw leaves from and which way: Kaiju and snapshot kaiju both satisfy it. */
export interface ThrowSource {
  kind: KaijuKindId;
  stage: StageId;
  x: number;
  z: number;
  aimYaw: number;
  aimPitch: number;
}

/** A throw leaving the hand. */
export interface ThrowLaunch extends ProjectileBody {
  speed: number;
  gravity: number;
  spread: number;
  ttl: number;
  /** Radians above the horizon it was thrown at (before any error). */
  elevation: number;
}

export function createThrowLaunch(): ThrowLaunch {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, gravity: 0, spread: 0, ttl: 0, elevation: 0 };
}

/**
 * The elevation over flat ground that carries a throw of speed `v` under gravity `g` exactly
 * `range` meters (the lower of the two; 45 degrees when it cannot reach that far).
 */
function flatCap(range: number, v: number, g: number): number {
  return 0.5 * Math.asin(Math.min(1, (range * g) / Math.max(1e-6, v * v)));
}

/**
 * How `held` flies when a kaiju of this kind and stage throws it: its speed (by the stage, and by
 * its weight: something heavy flies slower), the stage's gravity (a garage door floats), how far
 * above the look it leaves, how steep it may go and its spread. Numbers: the kind's
 * `actions.throw` and `cityWeapons` (defs/kaiju/lizard.ts).
 */
export function throwFlight(kind: KaijuKindId, stage: StageId, held: HeldObject, out: ThrowFlight): ThrowFlight {
  const def = kaijuKindDef(kind);
  const a = def.actions.throw;
  const w = def.cityWeapons;
  const base = perStage(a.speed, stage);
  // City weapons are numbered at stage 1; a bigger monster throws them as it throws a car.
  const scale = base / a.speed[0];
  const g = perStage(a.gravity, stage);
  out.gravity = g;
  out.lift = a.lift;
  out.maxElevation = a.maxElevation;
  out.minElevation = -a.maxElevation;
  out.spread = perStage(a.spread, stage);
  out.ttl = projectileTypeDef('thrown').ttl;
  const prop = held.kind === 'prop' && PROP_KINDS[held.prop].cityWeapon ? held.prop : null;
  if (prop === 'antenna' || prop === 'mast') {
    const j = prop === 'mast' ? w.mast : w.antenna;
    out.speed = j.speed * scale;
    out.lift = j.lift;
    // The same angle at every stage: the arc is the stage-1 one, scaled.
    out.maxElevation = flatCap(j.range, j.speed, a.gravity[0]);
    out.spread *= j.spreadMult;
  } else if (prop === 'garagedoor') {
    const d = w.garagedoor.throw;
    out.speed = d.speed * scale;
    out.gravity = d.gravity * (g / a.gravity[0]);
    out.lift = d.lift;
    out.maxElevation = flatCap(d.range, d.speed, d.gravity);
    out.spread *= d.spreadMult;
  } else if (prop === 'propane' || prop === 'watertank') {
    out.speed = (prop === 'propane' ? w.propane : w.watertank).speed * scale;
  } else {
    const heavy = held.kind === 'vehicle' || held.kind === 'chunk' || (held.kind === 'wreck' && held.wreck === 'tank');
    out.speed = base * (heavy ? a.heavyMult : 1);
  }
  return out;
}

/** Where the hand is for a throw along `aimYaw`: ahead of the body's axis, at the stage's hand height. */
export function throwHand(src: ThrowSource, out: Vec3): Vec3 {
  const st = kaijuStageDef(src.kind, src.stage);
  const forward = st.bodyRadius * HAND_FORWARD;
  out.x = src.x + Math.sin(src.aimYaw) * forward;
  out.y = st.handHeight;
  out.z = src.z + Math.cos(src.aimYaw) * forward;
  return out;
}

/** The elevation a throw leaves at for an aim pitch: the pitch plus the lift, no steeper than it may go. */
export function throwElevation(flight: ThrowFlight, aimPitch: number): number {
  return Math.max(flight.minElevation, Math.min(flight.maxElevation, aimPitch + flight.lift));
}

/** The aimed launch (no error yet): from the hand, along the aim, at the throw's elevation and speed. */
export function throwLaunch(src: ThrowSource, flight: ThrowFlight, out: ThrowLaunch): ThrowLaunch {
  throwHand(src, out);
  const e = throwElevation(flight, src.aimPitch);
  const flat = Math.cos(e) * flight.speed;
  out.vx = Math.sin(src.aimYaw) * flat;
  out.vy = Math.sin(e) * flight.speed;
  out.vz = Math.cos(src.aimYaw) * flat;
  out.speed = flight.speed;
  out.gravity = flight.gravity;
  out.spread = flight.spread;
  out.ttl = flight.ttl;
  out.elevation = e;
  return out;
}

/**
 * Puts a throw's error into its launch velocity: a random vector, uniform in the ball of radius
 * speed × tan(spread), drawn from `seed` alone (so the same seed gives the same throw anywhere).
 */
export function throwError(launch: ThrowLaunch, seed: number): ThrowLaunch {
  const rng = createRng(seed);
  // A direction, uniform over the sphere (by rejection; the loop all but never runs long).
  let ux = 0;
  let uy = 1;
  let uz = 0;
  for (let i = 0; i < 32; i++) {
    const x = rngFloat(rng) * 2 - 1;
    const y = rngFloat(rng) * 2 - 1;
    const z = rngFloat(rng) * 2 - 1;
    const q = x * x + y * y + z * z;
    if (q > 1 || q < 1e-6) continue;
    const n = Math.sqrt(q);
    ux = x / n;
    uy = y / n;
    uz = z / n;
    break;
  }
  // ... and a distance from the middle, uniform over the ball's volume.
  const m = launch.speed * Math.tan(launch.spread) * Math.cbrt(rngFloat(rng));
  launch.vx += ux * m;
  launch.vy += uy * m;
  launch.vz += uz * m;
  return launch;
}

/** How far off the aimed arc a throw can be after `t` seconds of flight: the tube's radius there. */
export function spreadAt(launch: ThrowLaunch, t: number): number {
  return launch.speed * Math.tan(launch.spread) * t;
}

// ---------------------------------------------------------------------------------------------
// The aimed arc against the city
// ---------------------------------------------------------------------------------------------

/** How far outside the city an arc is followed (the projectile system forgets projectiles there too). */
const CITY_MARGIN = 200;
/** A throw this close above the ground at the end of a step has reached it. */
const GROUND_SLACK = 1e-6;
/** Ticks of flight `traceThrow` follows at most: a titan's highest lob takes about 10 s. */
const MAX_TICKS = 600;

/** The aimed arc, tick by tick, and where it meets the city. */
export interface ThrowTrace {
  /** x, y, z, t of each point along the arc: the hand first, then one per tick, the last where it ends. */
  points: Float64Array;
  count: number;
  /** What it ends on: 'none' when it flies out of the city or its time runs out. */
  end: 'ground' | 'structure' | 'none';
  /** The structure it ends on, else -1. */
  structure: number;
  /** Where it ends, the seconds it took, and the surface there (up for the ground). */
  x: number;
  y: number;
  z: number;
  time: number;
  nx: number;
  ny: number;
  nz: number;
  /** Its velocity where it ends. */
  vx: number;
  vy: number;
  vz: number;
}

export function createThrowTrace(): ThrowTrace {
  return {
    points: new Float64Array((MAX_TICKS + 2) * 4),
    count: 0,
    end: 'none',
    structure: -1,
    x: 0,
    y: 0,
    z: 0,
    time: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
  };
}

const body: ProjectileBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gravity: 0 };
const segA: Vec3 = { x: 0, y: 0, z: 0 };
const segB: Vec3 = { x: 0, y: 0, z: 0 };
const cityHit = createCityCastHit();

function pushPoint(out: ThrowTrace, x: number, y: number, z: number, t: number): void {
  const o = out.count * 4;
  out.points[o] = x;
  out.points[o + 1] = y;
  out.points[o + 2] = z;
  out.points[o + 3] = t;
  out.count++;
}

/**
 * Follows a launch tick by tick, exactly as the projectile system flies it, until it meets a
 * standing structure (bridge decks excepted), a heap of rubble or a fallen building beyond its
 * first `clearRubble` meters (the kaiju's reach, as `Projectile.clearRubble`), or the ground.
 */
export function traceThrow(city: CityQuery, launch: ThrowLaunch, clearRubble: number, out: ThrowTrace): ThrowTrace {
  body.x = launch.x;
  body.y = launch.y;
  body.z = launch.z;
  body.vx = launch.vx;
  body.vy = launch.vy;
  body.vz = launch.vz;
  body.gravity = launch.gravity;
  out.count = 0;
  out.end = 'none';
  out.structure = -1;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  pushPoint(out, body.x, body.y, body.z, 0);
  const limit = city.index.half + CITY_MARGIN;
  const ticks = Math.min(MAX_TICKS, Math.ceil(launch.ttl / DT - 1e-9));
  let clear = clearRubble;
  for (let i = 1; i <= ticks; i++) {
    segA.x = body.x;
    segA.y = body.y;
    segA.z = body.z;
    const vy0 = body.vy;
    stepProjectile(body, DT);
    segB.x = body.x;
    segB.y = body.y;
    segB.z = body.z;
    const clearing = clear > 0;
    if (clearing) clear -= Math.hypot(segB.x - segA.x, segB.z - segA.z);
    let best = 2;
    if (castSegment(city, segA, segB, cityHit, -1, true, !clearing)) {
      best = cityHit.t;
      out.end = 'structure';
      out.structure = cityHit.structure;
      out.nx = cityHit.nx;
      out.ny = cityHit.ny;
      out.nz = cityHit.nz;
    }
    if (segB.y <= GROUND_SLACK) {
      const t = segA.y <= GROUND_SLACK ? 0 : Math.min(1, segA.y / (segA.y - segB.y));
      if (t < best) {
        best = t;
        out.end = 'ground';
        out.structure = -1;
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
      }
    }
    if (best <= 1) {
      out.x = segA.x + (segB.x - segA.x) * best;
      out.y = out.end === 'ground' ? 0 : segA.y + (segB.y - segA.y) * best;
      out.z = segA.z + (segB.z - segA.z) * best;
      out.time = (i - 1 + best) * DT;
      out.vx = body.vx;
      out.vy = vy0 - launch.gravity * best * DT;
      out.vz = body.vz;
      pushPoint(out, out.x, out.y, out.z, out.time);
      return out;
    }
    pushPoint(out, body.x, body.y, body.z, i * DT);
    if (Math.abs(body.x) > limit || Math.abs(body.z) > limit) break;
  }
  out.x = body.x;
  out.y = body.y;
  out.z = body.z;
  out.time = (out.count - 1) * DT;
  out.vx = body.vx;
  out.vy = body.vy;
  out.vz = body.vz;
  return out;
}

/** The landing spread of a traced throw (`landingSpread`). */
export interface LandingSpread {
  /** Across the flight, and along it (meters): the ellipse's half-widths. */
  across: number;
  along: number;
  /** The flight's heading over the ground there (unit vector), the ellipse's long axis. */
  dirX: number;
  dirZ: number;
}

export function createLandingSpread(): LandingSpread {
  return { across: 0, along: 0, dirX: 0, dirZ: 1 };
}

/**
 * The longest the landing ellipse is, in times its width. A throw skimming the ground can stray
 * farther along its flight than that, but seldom: the error is thickest in the middle of its ball.
 * (Round 5: 4, was 2. With 2, one stage 1 flat throw in four came down outside the ring drawn.)
 */
const MAX_ELONGATION = 4;

/**
 * Where a traced throw can come down: the ball its error spreads it over by then (radius
 * `spreadAt`), seen along its flight on the surface it ends on. On the ground or a roof that is
 * an ellipse, as wide as the ball across the flight and longer along it the flatter the throw
 * comes in; on a wall it is the ball's own circle.
 *
 * Along the flight the ball's shadow alone (1 / steepness) is too short for a flat throw: a big
 * error changes the angle it comes in at too, and a throw that leaves a little high skims on
 * farther. So the length grows half as fast again as the shadow (1.5 / steepness - 0.5: a lob,
 * coming down steeply, stays round), up to MAX_ELONGATION. Measured (round 5, 1000 seeds a case,
 * flat open ground): flat throws at 3 / 5 / 7 monster lengths land outside it 10 / 3 / 1% of the
 * time at stage 1 (36 / 28 / 15% with the round 4 ring), 0% at stages 2 and 3; lobs under 1%.
 * Only the preview reads it: nothing in the simulation does.
 */
export function landingSpread(launch: ThrowLaunch, trace: ThrowTrace, out: LandingSpread): LandingSpread {
  const r = spreadAt(launch, trace.time);
  const flat = Math.hypot(trace.vx, trace.vz);
  out.dirX = flat > 1e-6 ? trace.vx / flat : 0;
  out.dirZ = flat > 1e-6 ? trace.vz / flat : 1;
  out.across = r;
  if (trace.ny > 0.5) {
    const speed = Math.hypot(flat, trace.vy);
    const steep = speed > 1e-6 ? Math.abs(trace.vy) / speed : 1;
    out.along = r * Math.min(MAX_ELONGATION, 1.5 / Math.max(1e-6, steep) - 0.5);
  } else {
    out.along = r;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Aiming a throw at a point (the bots)
// ---------------------------------------------------------------------------------------------

/**
 * Elevations (radians) that carry a throw of speed `v` under gravity `g` to a point `d` meters
 * away (over the ground) and `dy` meters above the hand: [low, high], or null when it is out of
 * reach.
 */
export function throwElevations(d: number, dy: number, v: number, g: number): [number, number] | null {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (disc < 0 || d < 1e-6) return null;
  const root = Math.sqrt(disc);
  return [Math.atan2(v2 - root, g * d), Math.atan2(v2 + root, g * d)];
}

/** The answer of `aimThrowAt`. */
export interface ThrowAim {
  yaw: number;
  pitch: number;
  /** Lobbed (the high arc): nothing lower gets there. */
  high: boolean;
  /** Seconds the aimed arc takes to get there. */
  time: number;
}

export function createThrowAim(): ThrowAim {
  return { yaw: 0, pitch: 0, high: false, time: 0 };
}

const aimLaunch = createThrowLaunch();
const aimTrace = createThrowTrace();
const aimSource: ThrowSource = { kind: 'lizard', stage: 1, x: 0, z: 0, aimYaw: 0, aimPitch: 0 };
const hand: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The aim (heading and pitch) that throws `flight` from a kaiju at (x, z) onto the point
 * (tx, ty, tz): the low arc when the city leaves it a way there, else the lob over what stands
 * in the way (when it may be thrown that steep). An arc gets there when it comes down within
 * `tolerance` meters of the point. Returns false when no arc does. The monster bot and the
 * client's autopilot aim with it.
 */
export function aimThrowAt(
  city: CityQuery,
  src: Pick<ThrowSource, 'kind' | 'stage' | 'x' | 'z'>,
  flight: ThrowFlight,
  tx: number,
  ty: number,
  tz: number,
  tolerance: number,
  clearRubble: number,
  out: ThrowAim,
): boolean {
  aimSource.kind = src.kind;
  aimSource.stage = src.stage;
  aimSource.x = src.x;
  aimSource.z = src.z;
  aimSource.aimYaw = Math.atan2(tx - src.x, tz - src.z);
  throwHand(aimSource, hand);
  const d = Math.hypot(tx - hand.x, tz - hand.z);
  const both = throwElevations(d, ty - hand.y, flight.speed, flight.gravity);
  if (!both) return false;
  for (let i = 0; i < 2; i++) {
    const e = both[i];
    if (e > flight.maxElevation + 1e-9 || e < flight.minElevation - 1e-9) continue;
    aimSource.aimPitch = e - flight.lift;
    throwLaunch(aimSource, flight, aimLaunch);
    traceThrow(city, aimLaunch, clearRubble, aimTrace);
    if (aimTrace.end === 'none' || Math.hypot(aimTrace.x - tx, aimTrace.z - tz) > tolerance) continue;
    out.yaw = aimSource.aimYaw;
    out.pitch = aimSource.aimPitch;
    out.high = i === 1;
    out.time = aimTrace.time;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Aiming a throw at the crosshair's point (the monster player, round 5)
// ---------------------------------------------------------------------------------------------

/**
 * What a throw aimed at a point does: 'on' it comes down there; 'short' the point is beyond the
 * throw's reach (it goes as far as it can that way); 'blocked' the point is in reach but every
 * arc meets something first; 'close' the point is beside or under the monster, where the head
 * cannot turn or the hand cannot throw that steeply down.
 */
export type ThrowReach = 'on' | 'short' | 'blocked' | 'close';

/** The answer of `aimThrowAtPoint`. */
export interface PointThrowAim extends ThrowAim {
  reach: ThrowReach;
  /** Where the aimed arc it picked comes down (or where its trace stops). */
  x: number;
  y: number;
  z: number;
}

export function createPointThrowAim(): PointThrowAim {
  return { yaw: 0, pitch: 0, high: false, time: 0, reach: 'on', x: 0, y: 0, z: 0 };
}

/** How far a structure target lets the arc land from the crosshair's point, in tolerances (on the same roof or wall). */
const SAME_STRUCTURE_SLACK = 4;

const pointLaunch = createThrowLaunch();
const pointTrace = createThrowTrace();
const pointSource: ThrowSource = { kind: 'lizard', stage: 1, x: 0, z: 0, aimYaw: 0, aimPitch: 0 };
const pointHand: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The elevation that carries a throw of speed `v` under gravity `g` farthest over ground `h`
 * meters below the hand: 45 degrees from the ground, flatter from higher up.
 */
export function farthestElevation(v: number, g: number, h: number): number {
  return Math.asin(v / Math.sqrt(Math.max(1e-9, 2 * (v * v + g * Math.max(0, h)))));
}

/** Flies `pointSource` at elevation `e` against the city into `pointTrace`. */
function tracePoint(city: CityQuery, flight: ThrowFlight, e: number, clearRubble: number): void {
  pointSource.aimPitch = e - flight.lift;
  throwLaunch(pointSource, flight, pointLaunch);
  traceThrow(city, pointLaunch, clearRubble, pointTrace);
}

/** Copies the last `tracePoint` into the answer. */
function takePoint(out: PointThrowAim, high: boolean, reach: ThrowReach): PointThrowAim {
  out.pitch = pointSource.aimPitch;
  out.high = high;
  out.time = pointTrace.time;
  out.x = pointTrace.x;
  out.y = pointTrace.y;
  out.z = pointTrace.z;
  out.reach = reach;
  return out;
}

/**
 * The aim that throws `flight` from a kaiju onto the point the player's crosshair is on
 * (tx, ty, tz): the game picks the arc. The heading runs toward the point, no farther round than
 * `maxLead` from the body's `yaw` (the head's reach; the server clamps the same way). Then the flat
 * arc when it gets there, else the lob over whatever stands in the way (`preferHigh` tries the lob
 * first: the last frame's choice, so the arc does not flip between the two on a roof's edge). An
 * arc gets there when it comes down within `tolerance` meters of the point (over the ground), or
 * on the structure `structure` (the roof or wall the crosshair is on) within a few tolerances.
 *
 * When none gets there: beyond reach it goes as far as it can along the heading ('short'); in
 * reach but blocked, the arc that comes down nearest the point ('blocked'); too steep down or
 * beyond the head's turn, what it can ('close'). `out.yaw` and `out.pitch` are the aim to send
 * (the server flies exactly this arc), set in every case. Costs two traces at most.
 */
export function aimThrowAtPoint(
  city: CityQuery,
  src: Pick<ThrowSource, 'kind' | 'stage' | 'x' | 'z'> & { yaw: number },
  flight: ThrowFlight,
  tx: number,
  ty: number,
  tz: number,
  tolerance: number,
  structure: number,
  maxLead: number,
  clearRubble: number,
  out: PointThrowAim,
  preferHigh = false,
): PointThrowAim {
  pointSource.kind = src.kind;
  pointSource.stage = src.stage;
  pointSource.x = src.x;
  pointSource.z = src.z;
  // The heading, no farther round than the head reaches (a point beside the monster: the
  // farthest heading it can turn to).
  let yaw = Math.atan2(tx - src.x, tz - src.z);
  let d = yaw - src.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const turned = Math.abs(d) > maxLead + 1e-6;
  if (turned) yaw = src.yaw + Math.sign(d) * maxLead;
  pointSource.aimYaw = yaw;
  throwHand(pointSource, pointHand);
  // The point, on that heading at the same distance from the body, and a meter beyond the hand at least.
  const handOut = Math.hypot(pointHand.x - src.x, pointHand.z - src.z);
  const far = Math.max(Math.hypot(tx - src.x, tz - src.z), handOut + 1);
  const px = src.x + Math.sin(yaw) * far;
  const pz = src.z + Math.cos(yaw) * far;
  const dist = far - handOut;
  out.yaw = yaw;
  const both = throwElevations(dist, ty - pointHand.y, flight.speed, flight.gravity);
  if (both !== null && both[0] < flight.minElevation - 1e-9) {
    // Too steep down for the hand (right under the snout): as steep as it goes.
    tracePoint(city, flight, flight.minElevation, clearRubble);
    return takePoint(out, false, 'close');
  }
  const inReach = both !== null && both[0] <= flight.maxElevation + 1e-9;
  if (inReach) {
    let bestMiss = Infinity;
    for (let n = 0; n < 2; n++) {
      const i = preferHigh ? 1 - n : n;
      const e = both[i];
      if (e > flight.maxElevation + 1e-9) continue;
      tracePoint(city, flight, e, clearRubble);
      const miss = pointTrace.end === 'none' ? Infinity : Math.hypot(pointTrace.x - px, pointTrace.z - pz);
      const there =
        miss <= tolerance || (structure >= 0 && pointTrace.end === 'structure' && pointTrace.structure === structure && miss <= tolerance * SAME_STRUCTURE_SLACK);
      if (there) return takePoint(out, i === 1, turned ? 'close' : 'on');
      // Blocked so far: keep the arc that comes down nearest the point.
      if (miss < bestMiss) {
        bestMiss = miss;
        takePoint(out, i === 1, turned ? 'close' : 'blocked');
      }
    }
    if (bestMiss < Infinity) return out;
  }
  // Beyond reach (or both arcs fly out of the city): as far as it goes along the heading.
  tracePoint(city, flight, Math.min(flight.maxElevation, farthestElevation(flight.speed, flight.gravity, pointHand.y - Math.max(0, ty))), clearRubble);
  return takePoint(out, false, turned ? 'close' : inReach ? 'blocked' : 'short');
}
