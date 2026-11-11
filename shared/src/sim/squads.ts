/**
 * Squad rules that more than one system needs (DESIGN.md section 5): the formation behind the
 * leader, hold points for a move-to, the firing arc of a charging unit, the scatter
 * multipliers, veterans. The orders system and the weapon system are built from these; bots and
 * clients can call the pure ones too (several take only what a snapshot carries).
 */

import type { KaijuKindId, KaijuPhase, StageId } from '../defs/ids';
import { kaijuKindDef } from '../defs/kaiju/index';
import { COMBAT_RULES, MATCH_RULES, SQUAD_RULES } from '../defs/rules';
import { stageDef } from '../defs/stages';
import { unitTypeDef } from '../defs/units';
import { modMult } from '../defs/upgrades';
import { weaponDef } from '../defs/weapons';
import { angleDist, yawFromTo } from '../math/angle';
import { clamp } from '../math/scalar';
import type { Vec2 } from '../math/vec';
import { solidInCircle, standsByRoad } from './nav';
import { findClearSpot } from './spawn';
import { unitSeesKaiju } from './spotting';
import type { Kaiju, Squad, Unit, World } from './types';

/** Slack for angle and value thresholds, so a target exactly on the edge counts on every engine. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------------------------
// Who is who
// ---------------------------------------------------------------------------------------------

/** The living kaiju nearest to a ground point, or null. */
export function nearestKaiju(world: World, x: number, z: number): Kaiju | null {
  let best: Kaiju | null = null;
  let bestD = Infinity;
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const d = (k.x - x) * (k.x - x) + (k.z - z) * (k.z - z);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * The kaiju a unit on hold-and-charge points its laser at: the nearest living one that the
 * humans know about (it is on their map) or that this unit can see for itself. Null when there
 * is none: the unit then just watches the middle of its arc.
 */
export function chargeTarget(world: World, u: Unit): Kaiju | null {
  let best: Kaiju | null = null;
  let bestD = Infinity;
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    if (!k.known && !unitSeesKaiju(world, u, k, MATCH_RULES.revealSightRange)) continue;
    const d = (k.x - u.x) * (k.x - u.x) + (k.z - u.z) * (k.z - u.z);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Scatter (DESIGN.md section 5, "Scatter multipliers")
// ---------------------------------------------------------------------------------------------

/** What the scatter rule needs to know about a target. Kaiju and snapshot kaiju both satisfy it. */
export interface ScatterTarget {
  kind: KaijuKindId;
  stage: StageId;
  phase: KaijuPhase;
  nerve: number;
  spotted: boolean;
}

/**
 * True when a kaiju is easier to hit because it is slowed: staggered, cocooned, or carrying at
 * least COMBAT_RULES.scatterSlowedNerve of its nerve capacity in accumulated nerve damage.
 */
export function kaijuIsSlowed(k: ScatterTarget): boolean {
  if (k.phase === 'stagger' || k.phase === 'cocoon') return true;
  return k.nerve >= kaijuKindDef(k.kind).nerveCapacity * COMBAT_RULES.scatterSlowedNerve - EPS;
}

/**
 * Multiplier on aim error and artillery scatter against a target: the stage (a bigger kaiju is
 * easier to hit), times 0.7 when it is spotted, times 0.6 when it is slowed. With no target the
 * stage alone counts.
 */
export function scatterMult(stage: StageId, target: ScatterTarget | null): number {
  let m = stageDef(target ? target.stage : stage).scatterMult;
  if (target) {
    if (target.spotted) m *= COMBAT_RULES.scatterSpottedMult;
    if (kaijuIsSlowed(target)) m *= COMBAT_RULES.scatterSlowedMult;
  }
  return m;
}

/** A unit's own multiplier on its weapon's aim error: veterans shoot straighter, upgrades may help. */
export function unitAimErrorMult(squad: Squad, u: Unit): number {
  return (u.veteran ? COMBAT_RULES.veteranAimErrorMult : 1) * modMult(squad.mods, 'aimError');
}

// ---------------------------------------------------------------------------------------------
// Hold-and-charge
// ---------------------------------------------------------------------------------------------

/** True when a rooted unit's firing arc covers the ground point (a unit that is not rooted covers everything). */
export function arcCovers(u: Unit, x: number, z: number): boolean {
  if (!u.rooted) return true;
  const dx = x - u.x;
  const dz = z - u.z;
  if (dx * dx + dz * dz < 1e-6) return true;
  return angleDist(yawFromTo(u.x, u.z, x, z), u.arcYaw) <= COMBAT_RULES.chargeHalfArc + EPS;
}

/**
 * True when a charging unit's targeting laser is on the kaiju: it is rooted with its laser lit,
 * the kaiju is inside its firing arc and inside its weapon's range, and it has a line of sight.
 * For the kaiju bot ("roars when lasers are on it") and for HUD warnings.
 */
export function laserOnKaiju(world: World, u: Unit, k: Kaiju): boolean {
  if (!u.alive || !u.rooted || u.state !== 'charging' || !k.alive) return false;
  if (!arcCovers(u, k.x, k.z)) return false;
  const squad = world.squads[u.squad];
  const range = weaponDef(unitTypeDef(u.type).weapon).range * modMult(squad.mods, 'weaponRange');
  return unitSeesKaiju(world, u, k, range);
}

/** How many targeting lasers are on a kaiju right now. */
export function lasersOnKaiju(world: World, k: Kaiju): number {
  let n = 0;
  for (const u of world.units) if (laserOnKaiju(world, u, k)) n++;
  return n;
}

/** Charge (0..1) the squad's volley would fire with now: the average over its charging sub-units, 0 with none. */
export function squadCharge(world: World, squad: Squad): number {
  let sum = 0;
  let n = 0;
  for (const id of squad.units) {
    const u = world.units[id];
    if (!u.alive || id === squad.driven || !u.rooted) continue;
    sum += u.charge;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// ---------------------------------------------------------------------------------------------
// Formation: a staggered column along the leader's trail
// ---------------------------------------------------------------------------------------------

/** Distance between neighbours in a column of this unit's kind. */
export function formationSpacing(u: Unit): number {
  return 2 * u.radius + SQUAD_RULES.formationGap;
}

/** A jump of the leader this far in one tick is a redeployment, not travel: the trail starts over. */
const TRAIL_JUMP = 8;
/** Lateral offsets tried for a slot, as fractions of the full stagger, before falling back to the leader's own track. */
const SIDE_TRIES = [1, 0.5, 0];
/** Room demanded around a formation slot beyond the unit's radius. */
const SLOT_MARGIN = 0.3;

/**
 * Keeps the squad's trail: the leader's position sampled every SQUAD_RULES.trailStep meters,
 * oldest first, long enough for the whole column. The squad counts as formed once the leader
 * has gone anywhere.
 */
export function updateTrail(squad: Squad, leader: Unit): void {
  const t = squad.trail;
  if (t.length === 0) {
    t.push({ x: leader.x, z: leader.z });
    return;
  }
  const last = t[t.length - 1];
  const d = Math.hypot(leader.x - last.x, leader.z - last.z);
  if (d >= TRAIL_JUMP) {
    t.length = 0;
    t.push({ x: leader.x, z: leader.z });
    return;
  }
  if (d < SQUAD_RULES.trailStep) return;
  t.push({ x: leader.x, z: leader.z });
  squad.formed = true;
  const keep = Math.ceil((MATCH_RULES.unitsPerSquad * formationSpacing(leader)) / SQUAD_RULES.trailStep) + 2;
  if (t.length > keep) t.splice(0, t.length - keep);
}

/** Length of the recorded trail, from the leader back to its oldest point. */
function trailLength(squad: Squad, leader: Unit): number {
  const t = squad.trail;
  let len = 0;
  let ax = leader.x;
  let az = leader.z;
  for (let i = t.length - 1; i >= 0; i--) {
    len += Math.hypot(t[i].x - ax, t[i].z - az);
    ax = t[i].x;
    az = t[i].z;
  }
  return len;
}

/**
 * The point `back` meters behind the leader along its trail, shifted `side` meters to the right
 * of the direction of travel there. Past the end of the trail it carries straight on (straight
 * back from the leader's hull when there is no trail at all).
 */
function pointBehind(squad: Squad, leader: Unit, back: number, side: number, out: Vec2): Vec2 {
  const t = squad.trail;
  let ax = leader.x;
  let az = leader.z;
  // Direction of travel at the point (toward the leader); starts as the leader's own heading.
  let fx = Math.sin(leader.yaw);
  let fz = Math.cos(leader.yaw);
  let left = back;
  for (let i = t.length - 1; i >= 0 && left > 0; i--) {
    const bx = t[i].x;
    const bz = t[i].z;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    fx = (ax - bx) / len;
    fz = (az - bz) / len;
    if (left <= len) {
      ax -= fx * left;
      az -= fz * left;
      left = 0;
      break;
    }
    left -= len;
    ax = bx;
    az = bz;
  }
  if (left > 0) {
    ax -= fx * left;
    az -= fz * left;
  }
  // Right of a heading (fx, fz) is (-fz, fx): facing +Z, +X is on the left.
  out.x = ax - fz * side;
  out.z = az + fx * side;
  return out;
}

function clampIntoBounds(world: World, radius: number, p: Vec2): void {
  const b = world.match.bounds;
  const inset = radius + 0.5;
  p.x = clamp(p.x, Math.min(b.minX + inset, b.maxX - inset), Math.max(b.minX + inset, b.maxX - inset));
  p.z = clamp(p.z, Math.min(b.minZ + inset, b.maxZ - inset), Math.max(b.minZ + inset, b.maxZ - inset));
}

/**
 * Where a sub-unit belongs when the order is 'follow': `rank` is its place among the squad's
 * living sub-units (0 is right behind the leader). The column is staggered to both sides of the
 * leader's trail where there is room and closes up into single file where there is not (a
 * street narrower than the formation). Returns false while the squad has not formed up: the
 * unit then stays where it is.
 */
export function formationSlot(world: World, squad: Squad, leader: Unit, u: Unit, rank: number, out: Vec2): boolean {
  if (!squad.formed) return false;
  const spacing = formationSpacing(u);
  const back = (rank + 1) * spacing;
  const side = (rank % 2 === 0 ? -1 : 1) * SQUAD_RULES.formationStagger * spacing;
  for (const f of SIDE_TRIES) {
    pointBehind(squad, leader, back, side * f, out);
    clampIntoBounds(world, u.radius, out);
    if (!solidInCircle(world.cityQuery, out.x, out.z, u.radius + SLOT_MARGIN)) return true;
  }
  // No room there: wait on the leader's own track, as far back as it is known. The leader drove
  // over that ground, so it is open.
  pointBehind(squad, leader, Math.min(back, trailLength(squad, leader)), 0, out);
  clampIntoBounds(world, u.radius, out);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Move-to: hold points around the marker
// ---------------------------------------------------------------------------------------------

const spot: Vec2 = { x: 0, z: 0 };
const taken: Array<{ x: number; z: number; radius: number }> = [];

/** Room a hold point keeps from walls beyond the unit's radius, so that driving up to it is easy. */
const HOLD_CLEARANCE = 2;
/** Rings searched outward from where a hold point was wanted. */
const HOLD_RINGS = 16;

/**
 * Picks the ground a unit will hold near (x, z): inside the bounds, with room to spare from
 * walls, clear of the spots already given out, and beside a street it can drive in from (so
 * nobody is sent into a back yard). Searches outward in rings; when nothing that good is near,
 * it settles for any open ground.
 */
function findHoldSpot(world: World, x: number, z: number, radius: number, out: Vec2): void {
  const b = world.match.bounds;
  const step = Math.max(2, radius);
  const margin = radius + 1;
  for (let ring = 0; ring <= HOLD_RINGS; ring++) {
    const count = ring === 0 ? 1 : 6 + ring * 2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const cx = x + Math.sin(a) * ring * step;
      const cz = z + Math.cos(a) * ring * step;
      if (cx < b.minX + margin || cx > b.maxX - margin || cz < b.minZ + margin || cz > b.maxZ - margin) continue;
      if (solidInCircle(world.cityQuery, cx, cz, radius + HOLD_CLEARANCE)) continue;
      let free = true;
      for (const t of taken) {
        const rr = t.radius + radius + 0.5;
        if ((t.x - cx) * (t.x - cx) + (t.z - cz) * (t.z - cz) < rr * rr) {
          free = false;
          break;
        }
      }
      if (!free || !standsByRoad(world, cx, cz, radius)) continue;
      out.x = cx;
      out.z = cz;
      return;
    }
  }
  findClearSpot(world.cityQuery, x, z, radius, b, taken, out);
  clampIntoBounds(world, radius, out);
}

/**
 * Gives every living sub-unit its own hold point around the squad's move target: spread evenly
 * round the marker one column spacing apart, each on open ground inside the bounds that it can
 * drive to (a marker placed on a building sends them to the nearest such ground beside it).
 */
export function assignHoldPoints(world: World, squad: Squad): void {
  const subs: Unit[] = [];
  for (const id of squad.units) {
    const u = world.units[id];
    if (u.alive && id !== squad.driven) subs.push(u);
  }
  taken.length = 0;
  // Not on top of the leader, when the marker is at its feet.
  const leader = squad.driven >= 0 ? world.units[squad.driven] : null;
  if (leader && leader.alive) taken.push({ x: leader.x, z: leader.z, radius: leader.radius });
  const tx = squad.moveTarget.x;
  const tz = squad.moveTarget.z;
  for (let i = 0; i < subs.length; i++) {
    const u = subs[i];
    // Three units stand on a circle whose chord is one spacing; a lone unit stands on the marker.
    const ring = subs.length > 1 ? formationSpacing(u) / (2 * Math.sin(Math.PI / subs.length)) : 0;
    const a = (i / subs.length) * Math.PI * 2;
    findHoldSpot(world, tx + Math.sin(a) * ring, tz + Math.cos(a) * ring, u.radius, spot);
    u.nav.holdX = spot.x;
    u.nav.holdZ = spot.z;
    u.nav.hasHold = true;
    taken.push({ x: spot.x, z: spot.z, radius: u.radius });
  }
}

// ---------------------------------------------------------------------------------------------
// Veterans
// ---------------------------------------------------------------------------------------------

/**
 * Call when a stage is over, after the molt's blast wave and before the squads are refilled:
 * every unit still alive comes back at the next stage as a veteran (aim error x0.7 and a
 * chevron). A slot whose unit died comes back green.
 */
export function markVeterans(world: World): void {
  for (const squad of world.squads) {
    for (let s = 0; s < squad.units.length; s++) squad.veteranSlots[s] = world.units[squad.units[s]].alive;
  }
}
