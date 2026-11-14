/**
 * Squad rules that more than one system needs (DESIGN.md section 5): the swarm around the
 * leader, the volley meter, the scatter multipliers, veterans. The orders system and the weapon
 * system are built from these; bots and clients can call the pure ones too (several take only
 * what a snapshot carries).
 */

import type { KaijuKindId, KaijuPhase, StageId } from '../defs/ids';
import { kaijuKindDef } from '../defs/kaiju/index';
import { COMBAT_RULES, MATCH_RULES, SQUAD_RULES } from '../defs/rules';
import { stageDef } from '../defs/stages';
import { unitTypeDef } from '../defs/units';
import { modMult } from '../defs/upgrades';
import { weaponDef } from '../defs/weapons';
import { clamp } from '../math/scalar';
import type { Vec2, Vec3 } from '../math/vec';
import { resolveAimPoint, type AimPoint } from './aim';
import { solidInCircle } from './nav';
import { unitSeesKaiju } from './spotting';
import { kaijuShownHeight } from './swim';
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
// The volley: planted squad-mates, their lasers and their charge
// ---------------------------------------------------------------------------------------------

/**
 * Where a squad's volley goes. `out` is the point the view's aim ray from the leader's eye
 * (the crosshair: `control.aimYaw` and `aimPitch`) lands on: a kaiju, a structure, the ground,
 * or far out along the ray. `mates` is where the squad-mates aim: the same point, or, with the
 * crosshair on a kaiju, the middle of its body at the height the ray met it, so that shots from
 * every side connect. Returns the kaiju the volley is at (the one under the crosshair, else the
 * one nearest the point), or null when there is none.
 */
export function volleyAim(world: World, leader: Unit, out: AimPoint, mates: Vec3): Kaiju | null {
  const eye = leader.y + unitTypeDef(leader.type).eyeHeight;
  const c = leader.control;
  resolveAimPoint(world.cityQuery, leader.x, eye, leader.z, c.aimYaw, c.aimPitch, SQUAD_RULES.aimRayRange, out, world.kaijus);
  const k = out.on === 'kaiju' ? world.kaijus[out.id] : nearestKaiju(world, out.x, out.z);
  if (out.on === 'kaiju' && k) {
    mates.x = k.x;
    mates.y = clamp(out.y, 0, kaijuShownHeight(k));
    mates.z = k.z;
  } else {
    mates.x = out.x;
    mates.y = out.y;
    mates.z = out.z;
  }
  return k;
}

/**
 * True when a charging unit's targeting laser is on the kaiju: it is planted with its laser lit,
 * its weapon points within SQUAD_RULES.laserSlackRadii body radii of the kaiju's middle, and the
 * kaiju is inside its weapon's range and in sight. For the kaiju bot ("roars when lasers are on
 * it") and for HUD warnings.
 */
export function laserOnKaiju(world: World, u: Unit, k: Kaiju): boolean {
  if (!u.alive || !u.rooted || u.state !== 'charging' || !k.alive) return false;
  const dx = k.x - u.x;
  const dz = k.z - u.z;
  if (dx * dx + dz * dz > k.radius * k.radius) {
    const s = Math.sin(u.aimYaw);
    const c = Math.cos(u.aimYaw);
    // Ahead of the weapon, and the line of the weapon passes close enough to the middle.
    if (dx * s + dz * c <= 0 || Math.abs(dx * c - dz * s) > k.radius * SQUAD_RULES.laserSlackRadii) return false;
  }
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

/**
 * How much of a volley a shot fired with this charge is, 0..1: nothing below
 * COMBAT_RULES.volleyMinCharge (a ragged shot, worth what fire at will is worth), rising evenly
 * to 1 at a full charge. The nerve multiplier and the aim error of a volley follow it.
 */
export function volleyStrength(charge: number): number {
  const min = COMBAT_RULES.volleyMinCharge;
  if (charge < min - EPS) return 0;
  return min < 1 ? clamp((charge - min) / (1 - min), 0, 1) : 1;
}

/** True when a shot fired with this charge is part of a charged volley (and counts toward breaking nerve). */
export function isChargedVolley(charge: number): boolean {
  return charge >= COMBAT_RULES.volleyMinCharge - EPS;
}

/** What the volley meter needs to know about a unit. World units and snapshot units both satisfy it. */
export interface ChargeView {
  squad: number;
  alive: boolean;
  /** Planted for a volley (the driven unit never is). */
  rooted: boolean;
  charge: number;
}

/**
 * The volley meter of a squad, 0..1: the mean charge of its planted squad-mates (0 when none is
 * planted). It is what a volley fired now would be worth, and what the HUD's big meter shows;
 * clients call it with the snapshot's units. The driven unit is never planted, so it never counts.
 */
export function volleyMeter(units: readonly ChargeView[], squad: number): number {
  let sum = 0;
  let n = 0;
  for (const u of units) {
    if (u.squad !== squad || !u.alive || !u.rooted) continue;
    sum += u.charge;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Charge (0..1) the squad's volley would fire with now: the mean over its planted squad-mates, 0 with none. */
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
// The swarm: a loose group around and behind the leader, along its trail
// ---------------------------------------------------------------------------------------------

/** Distance between neighbours in the swarm of this unit's kind (one spacing). */
export function formationSpacing(u: Unit): number {
  return 2 * u.radius + SQUAD_RULES.formationGap;
}

/** A jump of the leader this far in one tick is a redeployment, not travel: the trail starts over. */
const TRAIL_JUMP = 8;
/**
 * The trail keeps this much of the leader's way, meters (or the whole swarm in single file, if
 * that is longer): a squad-mate that has fallen far behind drives the leader's own way after it.
 */
const TRAIL_KEEP = 400;
/** Room demanded around a place in the swarm beyond the unit's radius. */
const SLOT_MARGIN = 0.3;

/**
 * Keeps the squad's trail: the leader's position sampled every SQUAD_RULES.trailStep meters,
 * oldest first, the last few hundred meters of its way. The squad counts as formed once the
 * leader has gone anywhere.
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
    clearTrail(squad);
    t.push({ x: leader.x, z: leader.z });
    return;
  }
  if (d < SQUAD_RULES.trailStep) return;
  t.push({ x: leader.x, z: leader.z });
  squad.formed = true;
  const keep = Math.ceil(Math.max(MATCH_RULES.unitsPerSquad * formationSpacing(leader), TRAIL_KEEP) / SQUAD_RULES.trailStep) + 2;
  if (t.length > keep) {
    squad.trailBase += t.length - keep;
    t.splice(0, t.length - keep);
  }
}

/** Forgets the trail (the leader was redeployed or taken over); the numbers of its points are not given out again. */
export function clearTrail(squad: Squad): void {
  squad.trailBase += squad.trail.length;
  squad.trail.length = 0;
}

/** The leader's way turns a corner where it bends more than 45 degrees (this cosine) over a body's width either side. */
const TRAIL_CORNER_COS = Math.SQRT1_2;
/** ...measured over at least this many meters either side. */
const TRAIL_CORNER_SPAN = 8;

/** Where a squad-mate that has fallen behind drives for (`trailFollow`). */
export interface TrailTarget extends Vec2 {
  /**
   * Meters from the unit, along the leader's way, to the next corner of it (Infinity: none
   * within the distance asked about). A vehicle slows down for it.
   */
  corner: number;
}

/** Whether the trail turns a corner at point `j`: the way in and the way out, `k` points each, are more than 45 degrees apart. */
function trailBends(t: readonly Vec2[], j: number, k: number): boolean {
  const a = Math.max(0, j - k);
  const b = Math.min(t.length - 1, j + k);
  const ax = t[j].x - t[a].x;
  const az = t[j].z - t[a].z;
  const bx = t[b].x - t[j].x;
  const bz = t[b].z - t[j].z;
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-6 || lb < 1e-6) return false;
  return (ax * bx + az * bz) / (la * lb) < TRAIL_CORNER_COS;
}

/**
 * For a squad-mate that has fallen behind: where to drive to get back to its leader along the
 * way the leader came (open to a unit of its size: the leader drove it). The unit keeps the
 * number of the trail point it is driving for (`nav.trailMark`) and only ever moves it on, past
 * every point it comes within `near` of (so a loop the leader drove, or a street it drove twice,
 * is cut short where the unit passes close to the later part), and drives for the point `ahead`
 * meters on from there, or for the next corner of the way if that comes first (aiming past a
 * corner would cut it, through the houses). With no point to go on from, it joins where the
 * trail passes nearest and drives for that point itself. Returns how far the unit is from the
 * point it is driving for (into `out`, with how far on the next corner is, looked for up to
 * `reach` meters); Infinity, with no mark, when there is no trail.
 */
export function trailFollow(squad: Squad, u: Unit, near: number, ahead: number, reach: number, out: TrailTarget): number {
  const t = squad.trail;
  const nav = u.nav;
  out.corner = Infinity;
  if (t.length < 2) {
    nav.trailMark = -1;
    return Infinity;
  }
  let i = nav.trailMark - squad.trailBase;
  if (i < 0 || i >= t.length) {
    let bestD = Infinity;
    for (let j = 0; j < t.length; j++) {
      const d2 = (t[j].x - u.x) * (t[j].x - u.x) + (t[j].z - u.z) * (t[j].z - u.z);
      if (d2 < bestD) {
        bestD = d2;
        i = j;
      }
    }
  }
  // Passed: the last point it has come within `near` of. The point of the way it is at: the
  // nearest of those (where it has not joined the way yet, the point it joins at).
  let passed = -1;
  let here = i;
  let hereD2 = Infinity;
  for (let j = i; j < t.length; j++) {
    const d2 = (t[j].x - u.x) * (t[j].x - u.x) + (t[j].z - u.z) * (t[j].z - u.z);
    if (d2 > near * near) continue;
    passed = j;
    if (d2 < hereD2) {
      hereD2 = d2;
      here = j;
    }
  }
  if (passed >= 0) i = Math.min(passed + 1, t.length - 1);
  nav.trailMark = squad.trailBase + i;
  const k = Math.max(1, Math.ceil(Math.max(2 * u.radius, TRAIL_CORNER_SPAN) / SQUAD_RULES.trailStep));

  // The next corner, from where the unit is on the way (it is not round a corner until it is
  // past it, however far on the point it drives for already is).
  let along = Math.hypot(t[here].x - u.x, t[here].z - u.z);
  for (let j = here; along <= reach; j++) {
    if (trailBends(t, j, k)) {
      out.corner = along;
      break;
    }
    if (j + 1 >= t.length) break;
    along += Math.hypot(t[j + 1].x - t[j].x, t[j + 1].z - t[j].z);
  }

  // Where it drives for: on the way, a little way on along it, but never past a corner (aiming
  // past one would cut it, through the houses); joining it, the point where it joins.
  let ax = t[i].x;
  let az = t[i].z;
  if (passed >= 0) {
    let left = ahead;
    for (let j = i; j + 1 < t.length && left > 0 && !trailBends(t, j, k); j++) {
      const len = Math.hypot(t[j + 1].x - ax, t[j + 1].z - az);
      if (len >= left) {
        ax += ((t[j + 1].x - ax) * left) / len;
        az += ((t[j + 1].z - az) * left) / len;
        break;
      }
      left -= len;
      ax = t[j + 1].x;
      az = t[j + 1].z;
    }
  }
  out.x = ax;
  out.z = az;
  return Math.hypot(ax - u.x, az - u.z);
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

/** Widths of the swarm tried, widest first, before it closes up into single file. */
const SWARM_WIDTHS = [1, 0.5];
const slotScratch: Vec2 = { x: 0, z: 0 };

/**
 * How wide the swarm can ride here: 1 (the two front squad-mates at their full distance out to
 * the sides), 0.5 (half of it) or 0 (single file on the leader's track: the street is too
 * narrow). Judged for the whole squad at once, so that nobody's place lands on another's.
 */
export function swarmWidth(world: World, squad: Squad, leader: Unit, sample: Unit, mates: number): number {
  if (!squad.formed || mates <= 0) return 1;
  const spacing = formationSpacing(sample);
  const r = sample.radius + SLOT_MARGIN;
  const p = slotScratch;
  for (const f of SWARM_WIDTHS) {
    let open = true;
    for (let rank = 0; rank < Math.min(2, mates) && open; rank++) {
      pointBehind(squad, leader, spacing, (rank === 0 ? -1 : 1) * SQUAD_RULES.swarmSide * spacing * f, p);
      clampIntoBounds(world, sample.radius, p);
      if (solidInCircle(world.cityQuery, p.x, p.z, r)) open = false;
    }
    if (open) return f;
  }
  return 0;
}

/**
 * Where a squad-mate belongs in the swarm: `rank` is its place among the squad's living
 * sub-units (0 and 1 ride one spacing behind the leader out to either side, 2 rides two spacings
 * straight behind), `width` what `swarmWidth` says there is room for. In single file (width 0)
 * they string out along the leader's track one spacing apart. Returns false while the squad has
 * not formed up (a fresh deployment): the unit then stays where it is.
 */
export function swarmSlot(world: World, squad: Squad, leader: Unit, u: Unit, rank: number, width: number, out: Vec2): boolean {
  if (!squad.formed) return false;
  const spacing = formationSpacing(u);
  if (width > 0) {
    if (rank < 2) {
      pointBehind(squad, leader, spacing, (rank === 0 ? -1 : 1) * SQUAD_RULES.swarmSide * spacing * width, out);
    } else {
      pointBehind(squad, leader, rank * spacing, 0, out);
    }
    clampIntoBounds(world, u.radius, out);
    if (rank < 2 || !solidInCircle(world.cityQuery, out.x, out.z, u.radius + SLOT_MARGIN)) return true;
  }
  // Single file on the leader's own track, as far back as it is known: the leader drove over
  // that ground, so it is open.
  pointBehind(squad, leader, Math.min((rank + 1) * spacing, trailLength(squad, leader)), 0, out);
  clampIntoBounds(world, u.radius, out);
  return true;
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
