/**
 * Navigation for sub-units: how a unit that is under orders gets to a ground point.
 *
 * `steerToward` is called once a tick for a unit and a goal and answers with a direction and a
 * throttle (the orders system turns them into the unit's control; the movement system does the
 * actual moving and all collision). It decides in three layers:
 *
 * 1. The straight line. When nothing stands in the way of the unit's whole width between it and
 *    the goal, it simply goes there. Rubble is flat, so a line across a wrecked block is clear;
 *    so is a line across the river (units wade) and across a bridge deck.
 * 2. The road graph. Otherwise it routes along the streets: it steps out onto the nearest street
 *    it can reach in a straight line, follows the shortest way through the crossroads
 *    (Dijkstra over the road graph), and leaves the street at the point nearest the goal. It
 *    cuts every corner it can see past and eases off before a sharp turn. Streets outside the
 *    playable bounds are closed. A fallen bridge does not close its road: the river is shallow.
 * 3. Local steering. On every leg it looks a few body lengths ahead; when a wall is in the way
 *    it takes the smallest turn that is clear and keeps going round the same side until the way
 *    is open again. A unit that makes no progress tries the other side, plans again, and after
 *    a few failures waits a moment instead of grinding against a wall.
 *
 * Everything here is deterministic and reads only the city in its current state.
 */

import { roadAdjacency } from '../city/roads';
import { castSegment, structuresInCircle, type CityQuery } from '../city/spatialIndex';
import type { CityData } from '../city/types';
import { DT, SQUAD_RULES } from '../defs/rules';
import { unitTypeDef } from '../defs/units';
import { boundsContains, closestTOnSegment2 } from '../math/geom';
import type { Vec2, Vec3 } from '../math/vec';
import type { Unit, World } from './types';

/** What a sub-unit remembers about where it is going. Plain data; lives in `unit.nav`. */
export interface UnitNav {
  /** The ground point this unit holds at (by a move-to marker, or where a hold command parked it); meaningful while `hasHold`. */
  holdX: number;
  holdZ: number;
  hasHold: boolean;
  /** It reached its place (a formation slot or a hold point) and is staying there. */
  settled: boolean;
  /** Multiplier on its top speed this tick: above 1 while it is catching up with its place in the formation. */
  hurry: number;
  /** The goal of the last `steerToward` call. */
  goalX: number;
  goalZ: number;
  /** The straight line to the goal was clear the last time it was checked; `fresh` until the first check. */
  direct: boolean;
  fresh: boolean;
  /** Points still to pass on the way to the goal, next first: onto the street, the crossroads, off the street. */
  path: Vec2[];
  /** The goal `path` was planned for; `planned` is false until a plan has been made for the current goal. */
  pathX: number;
  pathZ: number;
  planned: boolean;
  /** Seconds until it may plan again. */
  repath: number;
  /** Which way round it is going past a wall: 1 or -1, 0 when the way is open. */
  side: number;
  /** Seconds the way ahead has been open while `side` is still remembered. */
  openTime: number;
  /** Progress watch: where it was when it last got somewhere, and for how long it has not since. */
  markX: number;
  markZ: number;
  stuck: number;
  /** Times in a row it got stuck on the way to this goal. */
  fails: number;
  /** The closest it has been to this goal, and for how long it has not come closer (feeling its way with no route). */
  bestDist: number;
  sinceBest: number;
  /** Seconds left of standing still after giving up on a goal it cannot reach. */
  wait: number;
}

export function createUnitNav(): UnitNav {
  return {
    holdX: 0,
    holdZ: 0,
    hasHold: false,
    settled: true,
    hurry: 1,
    goalX: 0,
    goalZ: 0,
    direct: true,
    fresh: true,
    path: [],
    pathX: 0,
    pathZ: 0,
    planned: false,
    repath: 0,
    side: 0,
    openTime: 0,
    markX: 0,
    markZ: 0,
    stuck: 0,
    fails: 0,
    bestDist: Infinity,
    sinceBest: 0,
    wait: 0,
  };
}

/** Forgets the route (not the hold point): the next `steerToward` starts from scratch. */
export function resetRoute(nav: UnitNav): void {
  nav.direct = true;
  nav.fresh = true;
  nav.bestDist = Infinity;
  nav.sinceBest = 0;
  nav.path.length = 0;
  nav.planned = false;
  nav.repath = 0;
  nav.side = 0;
  nav.openTime = 0;
  nav.stuck = 0;
  nav.fails = 0;
  nav.wait = 0;
}

/** Back to a blank memory (a fresh unit at the start of a stage). */
export function resetNav(nav: UnitNav): void {
  resetRoute(nav);
  nav.hasHold = false;
  nav.settled = true;
  nav.hurry = 1;
}

/** What `steerToward` answers. */
export interface Steer {
  /** Unit ground direction to move along. */
  dirX: number;
  dirZ: number;
  /** 0..1. */
  throttle: number;
  /** The unit is within the tolerance of the goal. */
  arrived: boolean;
}

export function createSteer(): Steer {
  return { dirX: 0, dirZ: 0, throttle: 0, arrived: false };
}

/** Height of the feeler rays above the ground: low enough to meet every wall. */
const FEELER_HEIGHT = 0.5;
/** Feeler rays are at most this far apart across the body's width. */
const FEELER_SPACING = 4;
/** Extra room demanded on each side before a whole leg counts as clear. */
const LEG_MARGIN = 0.5;
/** The short look-ahead is this much narrower than the body, so sliding along a wall counts as open. */
const PROBE_SLACK = 0.4;
/** The straight line to the goal and the corner-cutting are re-checked every this many ticks. */
const RECHECK_TICKS = 5;
/** A goal that moves this far (in unit radii, at least this many meters) needs a new route. */
const REPLAN_RADII = 2;
const REPLAN_MIN = 8;
/** Turns tried to get round a wall, smallest first. */
const DEFLECTIONS = [Math.PI / 6, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3, (5 * Math.PI) / 6];
/** The side of a wall is remembered for this long after the way opens, so the unit does not dither at a corner. */
const SIDE_MEMORY = 0.5;
/** Movement of less than this between two looks is no progress. */
const PROGRESS_STEP = 1;
/** After this many times stuck in a row the unit waits before it tries again. */
const MAX_FAILS = 3;
const GIVE_UP_WAIT = 3;
/** Feeling its way round walls with no route, it gives up after this long without getting any closer. */
const WANDER_LIMIT = 20;
/** Streets considered as the way onto and off the road network, nearest first. */
const ACCESS_CANDIDATES = 6;
/** How close it comes to the point where it leaves the street for the goal. */
const EXIT_REACH = 1.5;
/** Lowest throttle while easing into a stop, so the last meter does not take forever. */
const MIN_THROTTLE = 0.25;
/** A turn sharper than this (the cosine of 45 degrees) at the next stop is taken slowly, at no less than this throttle. */
const SHARP_TURN_COS = Math.SQRT1_2;
const CORNER_THROTTLE = 0.4;

const ids: number[] = [];
const segA: Vec3 = { x: 0, y: FEELER_HEIGHT, z: 0 };
const segB: Vec3 = { x: 0, y: FEELER_HEIGHT, z: 0 };

/** True when a standing structure that blocks bodies (not a bridge deck) overlaps the circle. */
export function solidInCircle(q: CityQuery, x: number, z: number, r: number): boolean {
  structuresInCircle(q, x, z, r, ids);
  for (let i = 0; i < ids.length; i++) if (q.index.spassable[ids[i]] === 0) return true;
  return false;
}

/**
 * True when a body of radius `r` can go straight from a to b: no standing structure (bridge
 * decks aside) touches the strip of that width between them or the circle at b.
 */
export function corridorClear(q: CityQuery, ax: number, az: number, bx: number, bz: number, r: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len > 1e-6) {
    const nx = -dz / len;
    const nz = dx / len;
    const rays = Math.max(3, Math.ceil((2 * r) / FEELER_SPACING) + 1);
    for (let i = 0; i < rays; i++) {
      const off = -r + (2 * r * i) / (rays - 1);
      segA.x = ax + nx * off;
      segA.z = az + nz * off;
      segB.x = bx + nx * off;
      segB.z = bz + nz * off;
      if (castSegment(q, segA, segB, undefined, -1, true)) return false;
    }
  }
  return !solidInCircle(q, bx, bz, r);
}

// ---------------------------------------------------------------------------------------------
// The road network
// ---------------------------------------------------------------------------------------------

/** A way onto (or off) the streets: the point of a road edge nearest to somewhere. */
interface RoadAccess {
  edge: number;
  x: number;
  z: number;
  /** A body can go straight between the place and this point. */
  clear: boolean;
}

const accessFrom: RoadAccess = { edge: -1, x: 0, z: 0, clear: false };
const accessTo: RoadAccess = { edge: -1, x: 0, z: 0, clear: false };
const candEdge: number[] = [];
const candDist: number[] = [];
const candX: number[] = [];
const candZ: number[] = [];
const adjacencyCache = new WeakMap<CityData, number[][]>();
let routeDist = new Float64Array(0);
let routePrev = new Int32Array(0);
let routeDone = new Uint8Array(0);
const routeNodes: number[] = [];

function adjacencyOf(city: CityData): number[][] {
  let adj = adjacencyCache.get(city);
  if (!adj) {
    adj = roadAdjacency(city.roads);
    adjacencyCache.set(city, adj);
  }
  return adj;
}

/** True when a body of radius `r` can stand on a road node: it lies inside the playable bounds. */
function nodeInPlay(world: World, node: number, r: number): boolean {
  const n = world.city.roads.nodes[node];
  return boundsContains(world.match.bounds, n.x, n.z, r);
}

/**
 * Finds where to step onto the streets from (x, z): the nearest point of a road edge, inside
 * the playable bounds, that a body of radius `r` can reach in a straight line; when no street
 * is in plain reach, simply the nearest point (`clear` false). Returns false when there is no
 * street in play at all.
 */
function roadAccess(world: World, x: number, z: number, r: number, out: RoadAccess): boolean {
  const graph = world.city.roads;
  const b = world.match.bounds;
  candEdge.length = 0;
  candDist.length = 0;
  candX.length = 0;
  candZ.length = 0;
  for (const e of graph.edges) {
    const a = graph.nodes[e.a];
    const c = graph.nodes[e.b];
    const t = closestTOnSegment2(x, z, a.x, a.z, c.x, c.z);
    const px = a.x + (c.x - a.x) * t;
    const pz = a.z + (c.z - a.z) * t;
    // Only the part of a street inside the quarantine line is of any use.
    if (!boundsContains(b, px, pz, r)) continue;
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    let at = candEdge.length;
    while (at > 0 && candDist[at - 1] > d) at--;
    if (at >= ACCESS_CANDIDATES) continue;
    candEdge.splice(at, 0, e.id);
    candDist.splice(at, 0, d);
    candX.splice(at, 0, px);
    candZ.splice(at, 0, pz);
    if (candEdge.length > ACCESS_CANDIDATES) {
      candEdge.length = ACCESS_CANDIDATES;
      candDist.length = ACCESS_CANDIDATES;
      candX.length = ACCESS_CANDIDATES;
      candZ.length = ACCESS_CANDIDATES;
    }
  }
  if (candEdge.length === 0) return false;
  let pick = 0;
  out.clear = false;
  for (let i = 0; i < candEdge.length; i++) {
    if (!corridorClear(world.cityQuery, x, z, candX[i], candZ[i], r)) continue;
    pick = i;
    out.clear = true;
    break;
  }
  out.edge = candEdge[pick];
  out.x = candX[pick];
  out.z = candZ[pick];
  return true;
}

/**
 * True when a body of radius `r` standing at (x, z) can step straight out onto a street (or the
 * city has no streets in play to step onto). Hold points are chosen where this is true, so
 * units are sent to ground they can drive to rather than into a back yard.
 */
export function standsByRoad(world: World, x: number, z: number, r: number): boolean {
  return !roadAccess(world, x, z, r + LEG_MARGIN, accessTo) || accessTo.clear;
}

/**
 * The crossroads to pass between two streets, shortest way, into `routeNodes` (none when both
 * are the same street). Returns false when the streets do not connect inside the bounds.
 */
function crossroadsBetween(world: World, from: RoadAccess, to: RoadAccess, r: number): boolean {
  routeNodes.length = 0;
  if (from.edge === to.edge) return true;
  const graph = world.city.roads;
  const nodes = graph.nodes;
  const n = nodes.length;
  if (routeDist.length !== n) {
    routeDist = new Float64Array(n);
    routePrev = new Int32Array(n);
    routeDone = new Uint8Array(n);
  }
  routeDist.fill(Infinity);
  routePrev.fill(-1);
  routeDone.fill(0);
  const adj = adjacencyOf(world.city);
  const ef = graph.edges[from.edge];
  const et = graph.edges[to.edge];
  // Dijkstra from both ends of the street it starts on to either end of the street it leaves by.
  if (nodeInPlay(world, ef.a, r)) routeDist[ef.a] = Math.hypot(nodes[ef.a].x - from.x, nodes[ef.a].z - from.z);
  if (nodeInPlay(world, ef.b, r)) routeDist[ef.b] = Math.hypot(nodes[ef.b].x - from.x, nodes[ef.b].z - from.z);
  let end = -1;
  let endCost = Infinity;
  for (;;) {
    // The graph is small (a few hundred nodes), so a linear scan for the closest open node is fine.
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (routeDone[i] === 0 && routeDist[i] < best) {
        best = routeDist[i];
        u = i;
      }
    }
    if (u < 0 || best >= endCost) break;
    routeDone[u] = 1;
    if (u === et.a || u === et.b) {
      const cost = best + Math.hypot(nodes[u].x - to.x, nodes[u].z - to.z);
      if (cost < endCost) {
        endCost = cost;
        end = u;
      }
    }
    for (const edgeId of adj[u]) {
      const e = graph.edges[edgeId];
      const v = e.a === u ? e.b : e.a;
      // Streets that leave the playable bounds are closed: nobody can cross the quarantine line.
      if (routeDone[v] === 1 || !nodeInPlay(world, v, r)) continue;
      const d = best + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (d < routeDist[v]) {
        routeDist[v] = d;
        routePrev[v] = u;
      }
    }
  }
  if (end < 0) return false;
  for (let at = end; at >= 0; at = routePrev[at]) routeNodes.push(at);
  routeNodes.reverse();
  return true;
}

/** Plans a route along the streets from the unit to the goal into `nav.path` (empty when there is none). */
function planRoute(world: World, u: Unit, gx: number, gz: number): void {
  const nav = u.nav;
  nav.path.length = 0;
  nav.planned = true;
  nav.pathX = gx;
  nav.pathZ = gz;
  nav.repath = SQUAD_RULES.repathInterval;
  // Where it stands it may be brushing a wall, so the way out is judged a little narrower than
  // the body; the way in to the goal has to take the whole body with room to spare.
  if (!roadAccess(world, u.x, u.z, Math.max(0.5, u.radius - PROBE_SLACK), accessFrom)) return;
  if (!roadAccess(world, gx, gz, u.radius + LEG_MARGIN, accessTo)) return;
  if (!crossroadsBetween(world, accessFrom, accessTo, u.radius)) return;
  const nodes = world.city.roads.nodes;
  nav.path.push({ x: accessFrom.x, z: accessFrom.z });
  for (const id of routeNodes) nav.path.push({ x: nodes[id].x, z: nodes[id].z });
  nav.path.push({ x: accessTo.x, z: accessTo.z });
}

// ---------------------------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------------------------

const turned = { x: 0, z: 0 };

/**
 * Tries heading `angle` off (dirX, dirZ) (positive toward +X from +Z, like yaw). When the way is
 * clear for `look` meters it leaves the new direction in `turned` and returns true.
 */
function tryTurn(q: CityQuery, u: Unit, dirX: number, dirZ: number, angle: number, look: number, probeR: number): boolean {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = dirX * c + dirZ * s;
  const rz = dirZ * c - dirX * s;
  if (!corridorClear(q, u.x, u.z, u.x + rx * look, u.z + rz * look, probeR)) return false;
  turned.x = rx;
  turned.z = rz;
  return true;
}

/**
 * Where to head and how fast to get the unit to (gx, gz). `tolerance` is how close counts as
 * there. Call it every tick while the unit should be on its way; it keeps its route in `u.nav`.
 */
export function steerToward(world: World, u: Unit, gx: number, gz: number, tolerance: number, out: Steer): Steer {
  const nav = u.nav;
  const q = world.cityQuery;
  const r = u.radius;
  out.dirX = 0;
  out.dirZ = 0;
  out.throttle = 0;
  out.arrived = false;
  nav.goalX = gx;
  nav.goalZ = gz;

  const gdx = gx - u.x;
  const gdz = gz - u.z;
  const goalDist = Math.hypot(gdx, gdz);
  if (goalDist <= tolerance) {
    resetRoute(nav);
    out.arrived = true;
    return out;
  }

  if (nav.repath > 0) nav.repath -= DT;
  const replanDist = Math.max(REPLAN_MIN, REPLAN_RADII * r);
  if (nav.wait > 0) {
    // It gave up on this goal for now. A goal that has moved away is a new goal.
    nav.wait -= DT;
    if (nav.wait > 0 && Math.hypot(gx - nav.pathX, gz - nav.pathZ) <= replanDist) return out;
    resetRoute(nav);
  }

  // --- 1. The straight line ------------------------------------------------------------------
  const probeR = Math.max(0.5, r - PROBE_SLACK);
  const recheck = nav.fresh || (world.tick + u.id) % RECHECK_TICKS === 0;
  // Leaving a route for the straight line takes room to spare; staying on the straight line
  // only takes room to pass. Without the difference a unit squeezing past a corner would
  // change its mind with every step.
  if (recheck) nav.direct = corridorClear(q, u.x, u.z, gx, gz, nav.direct && !nav.fresh ? probeR : r + LEG_MARGIN);
  nav.fresh = false;

  const type = unitTypeDef(u.type);
  let tx = gx;
  let tz = gz;
  let cornering = 1;
  if (nav.direct) {
    nav.path.length = 0;
    nav.planned = false;
  } else {
    // --- 2. Along the streets ------------------------------------------------------------------
    // A route is planned for a new goal, and again whenever the last one has run out without
    // bringing the goal into plain reach.
    const path = nav.path;
    const stale = !nav.planned || path.length === 0 || Math.hypot(gx - nav.pathX, gz - nav.pathZ) > replanDist;
    if (stale && nav.repath <= 0) planRoute(world, u, gx, gz);
    while (path.length > 0) {
      const p = path[0];
      // Crossroads are rounded; the point where it leaves the street is met exactly, because
      // the way from there to the goal is the one that was checked.
      const reach = path.length > 1 ? Math.max(r, 3) : EXIT_REACH;
      let passed = Math.hypot(p.x - u.x, p.z - u.z) <= reach;
      if (!passed && recheck) {
        // Cut the corner when the stop after this one is already in plain view.
        const nx = path.length > 1 ? path[1].x : gx;
        const nz = path.length > 1 ? path[1].z : gz;
        passed = corridorClear(q, u.x, u.z, nx, nz, r + LEG_MARGIN);
      }
      if (!passed) break;
      path.shift();
    }
    if (path.length > 0) {
      tx = path[0].x;
      tz = path[0].z;
      // Ease off for a sharp turn at this stop, so a tank does not sail past the corner.
      const nx = (path.length > 1 ? path[1].x : gx) - tx;
      const nz = (path.length > 1 ? path[1].z : gz) - tz;
      const ax = tx - u.x;
      const az = tz - u.z;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(nx, nz);
      if (la > 1e-6 && lb > 1e-6 && (ax * nx + az * nz) / (la * lb) < SHARP_TURN_COS) {
        const brake = (type.speed * type.speed) / (2 * type.accel) + r;
        if (la < brake) cornering = Math.max(CORNER_THROTTLE, la / brake);
      }
    }
  }

  // --- 3. Local steering toward (tx, tz) -------------------------------------------------------
  const dx = tx - u.x;
  const dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  let dirX = d > 1e-6 ? dx / d : gdx / goalDist;
  let dirZ = d > 1e-6 ? dz / d : gdz / goalDist;
  const look = Math.max(SQUAD_RULES.probeRadii * r, SQUAD_RULES.probeMin);
  const probe = Math.min(Math.max(d, 1), look);
  if (corridorClear(q, u.x, u.z, u.x + dirX * probe, u.z + dirZ * probe, probeR)) {
    if (nav.side !== 0) {
      nav.openTime += DT;
      if (nav.openTime >= SIDE_MEMORY) nav.side = 0;
    }
  } else {
    nav.openTime = 0;
    let found = false;
    if (nav.side !== 0) {
      // Keep going round the same way; only when that side is shut at every angle try the other.
      for (let pass = 0; pass < 2 && !found; pass++) {
        const side = pass === 0 ? nav.side : -nav.side;
        for (let i = 0; i < DEFLECTIONS.length && !found; i++) {
          if (!tryTurn(q, u, dirX, dirZ, DEFLECTIONS[i] * side, look, probeR)) continue;
          nav.side = side;
          found = true;
        }
      }
    } else {
      // No side chosen yet: whichever opens at the smaller angle.
      for (let i = 0; i < DEFLECTIONS.length && !found; i++) {
        if (tryTurn(q, u, dirX, dirZ, DEFLECTIONS[i], look, probeR)) {
          nav.side = 1;
          found = true;
        } else if (tryTurn(q, u, dirX, dirZ, -DEFLECTIONS[i], look, probeR)) {
          nav.side = -1;
          found = true;
        }
      }
    }
    // With every way shut it pushes on regardless: the movement system slides it along the wall.
    if (found) {
      dirX = turned.x;
      dirZ = turned.z;
    }
  }

  // --- Progress watch ---------------------------------------------------------------------------
  let gaveUp = false;
  if (Math.hypot(u.x - nav.markX, u.z - nav.markZ) >= PROGRESS_STEP) {
    nav.markX = u.x;
    nav.markZ = u.z;
    nav.stuck = 0;
    nav.fails = 0;
  } else {
    nav.stuck += DT;
    if (nav.stuck >= SQUAD_RULES.stuckTime) {
      // Going nowhere: try the other way round, and plan again.
      nav.stuck = 0;
      nav.fails++;
      nav.side = nav.side === 0 ? -1 : -nav.side;
      nav.openTime = 0;
      nav.planned = false;
      nav.repath = 0;
      if (nav.fails >= MAX_FAILS) gaveUp = true;
    }
  }
  if (nav.direct || nav.path.length > 0 || goalDist <= nav.bestDist - PROGRESS_STEP) {
    nav.bestDist = goalDist;
    nav.sinceBest = 0;
  } else {
    // Feeling its way with no route: circling a block that has no way in must end sometime.
    nav.sinceBest += DT;
    if (nav.sinceBest >= WANDER_LIMIT) gaveUp = true;
  }
  if (gaveUp) {
    resetRoute(nav);
    nav.wait = GIVE_UP_WAIT;
    nav.pathX = gx;
    nav.pathZ = gz;
    return out;
  }

  const slow = type.speed * SQUAD_RULES.arriveSlowTime;
  const arriving = slow > 0 && goalDist < slow ? Math.max(MIN_THROTTLE, goalDist / slow) : 1;
  out.dirX = dirX;
  out.dirZ = dirZ;
  out.throttle = Math.min(arriving, cornering);
  return out;
}
