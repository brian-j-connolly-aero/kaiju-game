/**
 * The city as a weapon (docs/ROADMAP.md phase 2, "small monster first"; DESIGN.md section 4, "The
 * city as a weapon"): the propane tanks, water tanks, antennas, fast-food signs and garage doors
 * that stand about every starting neighborhood, and the top of a fallen radio mast, in the
 * hatchling's hand. Numbers: the kind's `cityWeapons` (defs/kaiju/lizard.ts).
 *
 * - Picking up: Grab, while the kaiju is no bigger than `grabStage` (the hatchling). Its own feet
 *   spare them then (`sparedUnderfoot`); at later stages feet and tracks crush them like any small
 *   prop. They are never eaten: Grab with one in the hand drops it (`dropToGround`), and it lies
 *   loose on the ground (`world.loose`) to be picked up again.
 * - In the hand: Strike throws it (kaijuEffects.ts `throwEffect`, with `cityThrow`), except the
 *   fast-food sign, which is swung as a club (the 'club' verb, `clubEffect` in kaijuEffects.ts)
 *   and breaks after its swings, while the garage door is a shield against hits from the front
 *   until its hp runs out (`shieldTakes`, called by the damage system).
 * - Thrown (`cityWeaponImpact`, called by the projectile system where it lands): the propane
 *   tank explodes; the water tank bursts into a splash that knocks units over and pushes them
 *   out; the antenna and the mast fly straight and fast as javelins through units
 *   (`javelinPierce`) into the first wall or the ground; the garage door flies flat like a
 *   frisbee and knocks over what it hits.
 * - Propane: a shot or explosion landing within `detonateRadius` of a tank sets it off, where it
 *   stands (a full blast) or in the hand (the blast, and the kaiju loses `handDamage` exactly and
 *   flinches); crushed or struck it goes off with a small bang. `cityBlastAt` is called wherever
 *   shots and explosions land; the generator's props that blasts and feet destroy go through the
 *   city damage system, which calls `propaneDestroyed` for a propane tank.
 *
 * Like every system, nothing here changes hp: hits are queued (`world.hits`, `structureHits`,
 * `propHits`); the units a burst throws get a velocity kick (`shoveUnit`).
 */

import { PROP_KINDS } from '../city/props';
import { inWater, propsInCircle, structuresInCircle } from '../city/spatialIndex';
import type { PropKindId } from '../city/types';
import type { DamageKind } from '../defs/ids';
import { kaijuKindDef, kaijuStageDef } from '../defs/kaiju/index';
import type { BurstDef, JavelinDef, KaijuCityWeapons } from '../defs/schema';
import { modMult } from '../defs/upgrades';
import { projectileTypeDef } from '../defs/weapons';
import { angleDist, yawOf } from '../math/angle';
import { createCastHit, segmentVsCapsule, type VerticalCapsule } from '../math/geom';
import { lerp } from '../math/scalar';
import type { Vec3 } from '../math/vec';
import { unitCapsule } from './aim';
import type { PlayerId } from './config';
import type { HeldObject, ProjectileTarget } from './events';
import { kaijuBodyDistance } from './kaijuBody';
import { shoveUnit } from './kaijuEffects';
import { kaijuSwimming } from './swim';
import type { Hit, Kaiju, LooseObject, Projectile, ThrownCityWeapon, Unit, World } from './types';
import { applyStructureDamage } from './systems/cityDamage';
import { applyHit } from './systems/damage';
import { emit } from './worldOps';

/** How far ahead of the body's axis the hand is, in body radii (where throws leave from). */
export const HAND_FORWARD = 0.6;
/** Props are low: a blast this far above them (beyond its radius) leaves them alone. */
const PROP_REACH_HEIGHT = 10;
/** Height of a propane tank's middle, where it goes off from when it stands on the ground. */
const PROPANE_Y = 0.6;

/** Fire and explosions set a propane tank off; feet, tracks, claws and falling buildings only crush it (the small bang). */
const FIRE_CAUSES: readonly DamageKind[] = [
  'thrown',
  'beam',
  'blast',
  'rocket',
  'shell',
  'arty',
  'tracer',
  'missile',
  'heavyShell',
  'propane',
  'fireball',
  'javelin',
];

const ids: number[] = [];
const hand: Vec3 = { x: 0, y: 0, z: 0 };
const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const capHit = createCastHit();

// ---------------------------------------------------------------------------------------------
// What is in the hand
// ---------------------------------------------------------------------------------------------

/** The city-weapon numbers of a kaiju's kind. */
export function weaponDefs(k: Kaiju): KaijuCityWeapons {
  return kaijuKindDef(k.kind).cityWeapons;
}

/** The numbers where no kaiju is involved (a propane tank set off by a shot): those of the match's first kaiju. */
function worldWeapons(world: World): KaijuCityWeapons {
  return kaijuKindDef(world.kaijus.length > 0 ? world.kaijus[0].kind : 'lizard').cityWeapons;
}

/** The city weapon in the hand, or null (nothing, or something else: a car, a wreck, a tank, a chunk). */
export function heldCityWeapon(held: HeldObject | null): PropKindId | null {
  return held !== null && held.kind === 'prop' && PROP_KINDS[held.prop].cityWeapon ? held.prop : null;
}

/** Whether what is in the hand can be eaten: anything but a city weapon (Grab drops one of those). */
export function heldEdible(held: HeldObject | null): boolean {
  return held !== null && heldCityWeapon(held) === null;
}

/** The verb Strike starts with this in the hand: a swipe with nothing, the club with a fast-food sign, else a throw. */
export function strikeVerb(held: HeldObject | null): 'swipe' | 'throw' | 'club' {
  if (held === null) return 'swipe';
  return heldCityWeapon(held) === 'foodsign' ? 'club' : 'throw';
}

/** Whether the hand can pick up a prop of this kind now (a city weapon only while the kaiju is small). */
export function canPickUp(k: Kaiju, kind: PropKindId): boolean {
  const def = PROP_KINDS[kind];
  return def.grabbable && (!def.cityWeapon || k.stage <= weaponDefs(k).grabStage);
}

/**
 * Whether the kaiju's own body spares a prop: a city weapon, while it can still pick one up. Its
 * feet step round it, and its claws, tail and stomp push it aside instead of wrecking it (they
 * are there to be picked up); a charge, fire and explosions still wreck them.
 */
export function sparedByKaiju(world: World, k: Kaiju, propId: number): boolean {
  return PROP_KINDS[world.city.props[propId].kind].cityWeapon && k.stage <= weaponDefs(k).grabStage;
}

/** A city weapon has just come into the hand: a fast-food sign's swings, a garage door's hp. */
export function armHeld(k: Kaiju): void {
  const kind = heldCityWeapon(k.held);
  const def = kaijuKindDef(k.kind);
  k.clubSwings = kind === 'foodsign' ? def.actions.club.swings : 0;
  k.shieldHp = kind === 'garagedoor' ? def.cityWeapons.garagedoor.hp : 0;
}

/** The hand is empty now (thrown, eaten, dropped, broken, gone off). */
export function emptyHand(k: Kaiju): void {
  k.held = null;
  k.clubSwings = 0;
  k.shieldHp = 0;
}

/** Where the hand is: ahead of the body's axis along the head's aim, at the stage's hand height. */
export function kaijuHandPoint(k: Kaiju, out: Vec3): Vec3 {
  const st = kaijuStageDef(k.kind, k.stage);
  out.x = k.x + Math.sin(k.aimYaw) * k.radius * HAND_FORWARD;
  out.y = st.handHeight;
  out.z = k.z + Math.cos(k.aimYaw) * k.radius * HAND_FORWARD;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Loose city weapons (dropped, or a fallen radio mast's top)
// ---------------------------------------------------------------------------------------------

function announceLoose(world: World, o: LooseObject, cause: 'drop' | 'mast' | 'crushed' | 'blast'): void {
  emit(world, { type: 'looseProp', id: o.id, prop: o.kind, x: o.x, z: o.z, yaw: o.yaw, state: o.state === 'down' ? 'down' : 'gone', cause });
}

/**
 * Lays a city weapon loose on the ground: at once, or (a mast's top on its way down) from tick
 * `landsAt` on, when its `looseProp` event goes out.
 */
export function addLoose(world: World, kind: PropKindId, x: number, z: number, yaw: number, cause: 'drop' | 'mast', landsAt = 0): LooseObject {
  const o: LooseObject = { id: world.loose.length, kind, x, z, yaw, state: landsAt > world.tick ? 'falling' : 'down', landsAt };
  world.loose.push(o);
  if (o.state === 'down') announceLoose(world, o, cause);
  return o;
}

function goneLoose(world: World, o: LooseObject, cause: 'crushed' | 'blast'): void {
  o.state = 'gone';
  announceLoose(world, o, cause);
}

/** Takes a loose object off the ground into the hand. False when it no longer lies there. No event: `kaijuHeld` (source 'loose') says it. */
export function takeLoose(world: World, id: number): boolean {
  const o = world.loose[id];
  if (!o || o.state !== 'down') return false;
  o.state = 'gone';
  return true;
}

/** Grab with a city weapon in the hand: it is let go and lies on the ground below the hand. */
export function dropToGround(world: World, k: Kaiju): void {
  const kind = heldCityWeapon(k.held);
  if (kind === null) return;
  kaijuHandPoint(k, hand);
  emptyHand(k);
  emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'drop', source: 'none', sourceId: -1 });
  addLoose(world, kind, hand.x, hand.z, k.aimYaw, 'drop');
}

/**
 * Every tick (the kaiju action system calls it): a mast's top that has come down lies there now,
 * and where the hand no longer picks them up, feet and tracks crush the loose objects they
 * touch (a propane tank goes off with its small bang). A charge crushes them at any stage.
 */
export function updateLoose(world: World): void {
  for (let i = 0; i < world.loose.length; i++) {
    const o = world.loose[i];
    if (o.state === 'falling' && world.tick >= o.landsAt) {
      o.state = 'down';
      announceLoose(world, o, 'mast');
    }
    if (o.state !== 'down') continue;
    const r = PROP_KINDS[o.kind].radius;
    let by = -2;
    for (const k of world.kaijus) {
      if (!k.alive || kaijuSwimming(k)) continue;
      const charging = k.action === 'charge' && k.phase === 'charge';
      if (k.stage <= weaponDefs(k).grabStage && !charging) continue;
      const reach = k.radius + r;
      if ((k.x - o.x) * (k.x - o.x) + (k.z - o.z) * (k.z - o.z) < reach * reach) {
        by = k.player;
        break;
      }
    }
    if (by === -2) {
      for (const u of world.units) {
        if (!u.alive || u.y > 0 || !crushes(u)) continue;
        const reach = u.radius + r;
        if ((u.x - o.x) * (u.x - o.x) + (u.z - o.z) * (u.z - o.z) < reach * reach) {
          by = world.squads[u.squad].player;
          break;
        }
      }
    }
    if (by === -2) continue;
    goneLoose(world, o, 'crushed');
    if (o.kind === 'propane') propaneBlast(world, o.x, PROPANE_Y, o.z, 'crushed', -1, -1, by, NO_MULT);
  }
}

/** Vehicles crush small things; infantry steps round them. */
function crushes(u: Unit): boolean {
  return u.type !== 'army_rocket_infantry';
}

// ---------------------------------------------------------------------------------------------
// Bursts: propane, water, the gas station's fireball, a garage door landing
// ---------------------------------------------------------------------------------------------

/** What a burst's damage is multiplied by: to units, their nerve, structures. */
export interface BurstMult {
  unit: number;
  nerve: number;
  structure: number;
}
const NO_MULT: BurstMult = { unit: 1, nerve: 1, structure: 1 };

/**
 * A burst round (x, y, z) (`BurstDef`): units within its radius (to their near edge) take damage
 * and nerve falling linearly from the middle to the rim and are pushed outward (and knocked over
 * when it says so); standing structures it reaches take its structure damage; when it is a fire
 * (`def.props`) the props it reaches are destroyed, and loose city weapons and a propane tank in
 * a hand nearby go too (`cityBlastAt`); a kaiju it reaches takes `kaijuDamage`, except `spare`
 * (its thrower). Returns how many units it reached.
 */
export function burst(world: World, def: BurstDef, x: number, y: number, z: number, by: PlayerId, cause: DamageKind, mult: BurstMult, spare: number): number {
  const q = world.cityQuery;
  const r = def.radius;
  if (def.structureDamage > 0) {
    structuresInCircle(q, x, z, r, ids);
    for (const id of ids) {
      if (y > world.cityIndex.sheight[id] + r) continue;
      world.structureHits.push({ id, damage: def.structureDamage * mult.structure, by, cause });
    }
  }
  if (def.props && y <= r + PROP_REACH_HEIGHT) {
    propsInCircle(q, x, z, r, ids);
    for (const id of ids) world.propHits.push({ id, by, cause });
  }
  let reached = 0;
  for (const u of world.units) {
    if (!u.alive || u.y > y + r) continue;
    const dx = u.x - x;
    const dz = u.z - z;
    const d = Math.hypot(dx, dz);
    const edge = Math.max(0, d - u.radius);
    if (edge > r) continue;
    const t = edge / r;
    const hit: Hit = {
      damage: lerp(def.unitDamageCenter, def.unitDamageEdge, t) * mult.unit,
      nerve: lerp(def.unitNerveCenter, def.unitNerveEdge, t) * mult.nerve,
      fromDir: d > 1e-6 ? { x: -dx / d, z: -dz / d } : { x: 0, z: 0 },
      sourceId: -1,
      player: by,
      kind: cause,
      atWill: false,
    };
    if (def.knockdown > 0) {
      hit.stun = def.knockdown;
      hit.knockdown = true;
    }
    world.hits.push({ target: { entity: 'unit', id: u.id }, hit });
    const push = lerp(def.pushCenter, def.pushEdge, t);
    // A unit right in the middle goes along its own heading.
    if (d > 1e-6) shoveUnit(u, dx / d, dz / d, push);
    else shoveUnit(u, Math.sin(u.yaw), Math.cos(u.yaw), push);
    reached++;
  }
  if (def.kaijuDamage > 0) {
    for (const k of world.kaijus) {
      if (!k.alive || k.id === spare || kaijuBodyDistance(k, x, y, z) > r) continue;
      world.hits.push({
        target: { entity: 'kaiju', id: k.id },
        hit: { damage: def.kaijuDamage * mult.unit, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: -1, player: by, kind: cause, atWill: false },
      });
    }
  }
  if (def.props) cityBlastAt(world, x, y, z, r, by, cause);
  return reached;
}

/**
 * A propane tank goes off at (x, y, z) (`how`, as in the `propaneBlast` event): the full blast,
 * or the small bang when it was crushed. A thrown one never hurts its thrower; in the hand, its
 * holder takes its own exact damage instead (`propaneInHand`).
 */
export function propaneBlast(
  world: World,
  x: number,
  y: number,
  z: number,
  how: 'thrown' | 'ground' | 'hand' | 'crushed',
  kaiju: number,
  prop: number,
  by: PlayerId,
  mult: BurstMult,
): void {
  const w = kaiju >= 0 ? weaponDefs(world.kaijus[kaiju]) : worldWeapons(world);
  const def = how === 'crushed' ? w.propane.small : w.propane;
  emit(world, { type: 'propaneBlast', x, y, z, radius: def.radius, how, kaiju: how === 'hand' ? kaiju : -1, prop, by });
  burst(world, def, x, y, z, by, 'propane', mult, how === 'thrown' || how === 'hand' ? kaiju : -1);
}

/** A propane tank in a kaiju's hand goes off: the blast, the hand empty, the kaiju hurt and flinching. */
function propaneInHand(world: World, k: Kaiju, by: PlayerId): void {
  const w = weaponDefs(k).propane;
  kaijuHandPoint(k, hand);
  const hx = hand.x;
  const hy = hand.y;
  const hz = hand.z;
  emptyHand(k);
  emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'drop', source: 'none', sourceId: -1 });
  propaneBlast(world, hx, hy, hz, 'hand', k.id, -1, by, NO_MULT);
  world.hits.push({
    target: { entity: 'kaiju', id: k.id },
    hit: { damage: w.handDamage, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: -1, player: by, kind: 'propane', atWill: false, exact: true },
  });
  flinchKaiju(world, k, w.flinch);
}

/**
 * Where a shot or an explosion lands (the projectile system calls it at every impact; every
 * fiery burst does too): a propane tank in a kaiju's hand within `detonateRadius` of (x, y, z)
 * goes off there; loose city weapons within the blast's `radius` are wrecked, and a loose
 * propane tank within it (or within `detonateRadius`) goes off; so do the generator's propane
 * tanks within `detonateRadius` that a small splash would not reach (the ones a splash does
 * reach go through the city damage system: `propaneDestroyed`).
 */
export function cityBlastAt(world: World, x: number, y: number, z: number, radius: number, by: PlayerId, cause: DamageKind): void {
  const w = worldWeapons(world);
  const near = w.detonateRadius;
  for (const k of world.kaijus) {
    if (!k.alive || k.submerge > 0 || heldCityWeapon(k.held) !== 'propane') continue;
    kaijuHandPoint(k, hand);
    const dx = hand.x - x;
    const dy = hand.y - y;
    const dz = hand.z - z;
    if (dx * dx + dy * dy + dz * dz <= near * near) propaneInHand(world, k, by);
  }
  const reach = Math.max(near, radius);
  if (y <= reach + PROP_REACH_HEIGHT) {
    for (let i = 0; i < world.loose.length; i++) {
      const o = world.loose[i];
      if (o.state !== 'down') continue;
      const d = Math.hypot(o.x - x, o.z - z) - PROP_KINDS[o.kind].radius;
      if (o.kind === 'propane' ? d > reach : !(radius > 0) || d > radius) continue;
      goneLoose(world, o, 'blast');
      if (o.kind === 'propane') propaneBlast(world, o.x, PROPANE_Y, o.z, 'ground', -1, -1, by, NO_MULT);
    }
  }
  if (radius < near && y <= near + PROP_REACH_HEIGHT) {
    propsInCircle(world.cityQuery, x, z, near, ids);
    for (const id of ids) if (world.city.props[id].kind === 'propane') world.propHits.push({ id, by, cause });
  }
}

/**
 * The city damage system destroyed one of the generator's propane tanks: fire sets it off,
 * anything else crushes it. That system drains the structure and hit queues before the props, so
 * what this blast queues there is applied here and now (the props it reaches are still to come
 * in that system's own loop): every queue is empty when the tick ends.
 */
export function propaneDestroyed(world: World, propId: number, by: PlayerId, cause: DamageKind): void {
  const p = world.city.props[propId];
  const structures = world.structureHits.length;
  const hits = world.hits.length;
  propaneBlast(world, p.x, PROPANE_Y, p.z, FIRE_CAUSES.includes(cause) ? 'ground' : 'crushed', -1, propId, by, NO_MULT);
  // Structures first (one may be a gas station: its fireball queues more of both), then the hits.
  for (let i = structures; i < world.structureHits.length; i++) applyStructureDamage(world, world.structureHits[i]);
  world.structureHits.length = structures;
  for (let i = hits; i < world.hits.length; i++) applyHit(world, world.hits[i].target, world.hits[i].hit);
  world.hits.length = hits;
}

/**
 * The kaiju flinches (a propane tank went off in its hand): whatever it was doing is cut short
 * and it stands rooted for `duration` seconds (phase 'flinch'; the kaiju action system ends it).
 * A stagger, a cocoon or death is not interrupted.
 */
export function flinchKaiju(world: World, k: Kaiju, duration: number): void {
  if (!k.alive || k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead' || !(duration > 0)) return;
  k.act.meal = false;
  k.act.beamLength = 0;
  k.act.beamBlocker = -1;
  k.act.chargeBlocked = false;
  k.act.actionButton = 0;
  k.phase = 'flinch';
  k.action = 'none';
  k.phaseTime = 0;
  k.phaseDuration = duration;
  k.actionTime = 0;
  emit(world, { type: 'kaijuFlinch', kaiju: k.id, duration, x: k.x, z: k.z });
}

// ---------------------------------------------------------------------------------------------
// The garage door as a shield
// ---------------------------------------------------------------------------------------------

/**
 * The damage system asks before a hit lands on a kaiju: does the garage door in its hand take
 * it? It does when the hit comes from within `halfArc` of the body's facing (a hit with no
 * direction, a blast, goes round it); the door loses the hit's raw damage and the kaiju takes
 * nothing, nerve included. When its hp runs out it breaks and the hand is empty. Not while the
 * kaiju is staggered or in its cocoon (the arms are down).
 */
export function shieldTakes(world: World, k: Kaiju, hit: Hit): boolean {
  if (!(k.shieldHp > 0) || hit.exact || heldCityWeapon(k.held) !== 'garagedoor') return false;
  if (k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead') return false;
  const fx = hit.fromDir.x;
  const fz = hit.fromDir.z;
  if (fx * fx + fz * fz <= 1e-12) return false;
  const w = weaponDefs(k).garagedoor;
  if (angleDist(yawOf(fx, fz), k.yaw) > w.halfArc + 1e-9) return false;
  const damage = Math.max(0, hit.damage);
  k.shieldHp = Math.max(0, k.shieldHp - damage);
  kaijuHandPoint(k, hand);
  emit(world, { type: 'shieldHit', kaiju: k.id, x: hand.x, y: hand.y, z: hand.z, damage, hpLeft: k.shieldHp, cause: hit.kind });
  if (k.shieldHp <= 0) {
    emptyHand(k);
    emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'drop', source: 'none', sourceId: -1 });
    emit(world, { type: 'shieldBroken', kaiju: k.id, x: hand.x, z: hand.z });
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Thrown city weapons
// ---------------------------------------------------------------------------------------------

/** How a city weapon leaves the hand (kaijuEffects.ts `throwEffect` launches it). */
export interface CityThrow {
  speed: number;
  gravity: number;
  /** Seconds before it gives out in the air. */
  ttl: number;
  cause: DamageKind;
  /** For the spawn record (what it does is `cityWeaponImpact`'s): unit damage, nerve, splash, structure damage. */
  damage: number;
  nerve: number;
  splash: number;
  structureDamage: number;
  city: ThrownCityWeapon;
}

function javelinDef(w: KaijuCityWeapons, kind: PropKindId): JavelinDef {
  return kind === 'mast' ? w.mast : w.antenna;
}

/**
 * How a city weapon in the hand is thrown, with the kaiju's mods and its power surge
 * (`surgeMult`, 1 without one) folded into its damage; null for a prop that is not one (it is
 * thrown like any object) and for the fast-food sign (swung, never thrown).
 */
export function cityThrow(k: Kaiju, kind: PropKindId | null, surgeMult: number): CityThrow | null {
  if (kind === null || kind === 'foodsign' || !PROP_KINDS[kind].cityWeapon) return null;
  const w = weaponDefs(k);
  const gravity = projectileTypeDef('thrown').gravity;
  const unitMult = modMult(k.mods, 'unitDamage') * surgeMult;
  const nerveMult = modMult(k.mods, 'nerveDamage');
  const structureMult = modMult(k.mods, 'structureDamage') * surgeMult;
  const javelin = kind === 'antenna' || kind === 'mast';
  const city: ThrownCityWeapon = { prop: kind, javelin, pierce: 0, pierced: [], unitMult, nerveMult, structureMult };
  if (javelin) {
    const j = javelinDef(w, kind);
    city.pierce = j.pierce;
    return { speed: j.speed, gravity: j.gravity, ttl: j.range / j.speed, cause: 'javelin', damage: j.unitDamage * unitMult, nerve: j.unitNerve * nerveMult, splash: 0, structureDamage: j.structureDamage * structureMult, city };
  }
  if (kind === 'garagedoor') {
    const d = w.garagedoor.throw;
    return { speed: d.speed, gravity: d.gravity, ttl: d.range / d.speed, cause: 'thrown', damage: d.unitDamageCenter * unitMult, nerve: d.unitNerveCenter * nerveMult, splash: d.radius, structureDamage: d.structureDamage * structureMult, city };
  }
  const b = kind === 'propane' ? w.propane : w.watertank;
  return {
    speed: b.speed,
    gravity,
    ttl: projectileTypeDef('thrown').ttl,
    cause: kind === 'propane' ? 'propane' : 'splash',
    damage: b.unitDamageCenter * unitMult,
    nerve: b.unitNerveCenter * nerveMult,
    splash: b.radius,
    structureDamage: b.structureDamage * structureMult,
    city,
  };
}

const pierced: Array<{ t: number; u: Unit }> = [];

/**
 * One step of a javelin's flight (the projectile system calls it before it looks for what
 * stops the javelin): every unit the step passes through before `upTo` (the fraction of the step
 * where something stops it) that it has not gone through yet takes its hit, nearest first, while
 * it can still go through units; each is thrown along the flight and gets a `javelinHit`.
 */
export function javelinPierce(world: World, p: Projectile, a: Vec3, b: Vec3, upTo: number): void {
  const c = p.city;
  if (!c || !c.javelin || c.pierce <= 0) return;
  const radius = projectileTypeDef(p.type).radius;
  pierced.length = 0;
  for (const u of world.units) {
    if (!u.alive || c.pierced.includes(u.id)) continue;
    unitCapsule(u, capsule).r += radius;
    if (segmentVsCapsule(a, b, capsule, capHit) && capHit.t <= upTo) pierced.push({ t: capHit.t, u });
  }
  if (pierced.length === 0) return;
  pierced.sort((p1, p2) => p1.t - p2.t || p1.u.id - p2.u.id);
  const owner = world.kaijus[p.ownerId];
  const j = javelinDef(owner ? weaponDefs(owner) : worldWeapons(world), c.prop);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-9 ? dx / len : 0;
  const uz = len > 1e-9 ? dz / len : 0;
  for (const e of pierced) {
    if (c.pierce <= 0) break;
    c.pierce--;
    c.pierced.push(e.u.id);
    const damage = j.unitDamage * c.unitMult;
    world.hits.push({
      target: { entity: 'unit', id: e.u.id },
      hit: { damage, nerve: j.unitNerve * c.nerveMult, fromDir: { x: -ux, z: -uz }, sourceId: p.ownerId, player: p.player, kind: 'javelin', atWill: false },
    });
    shoveUnit(e.u, ux, uz, j.push);
    emit(world, {
      type: 'javelinHit',
      projectile: p.id,
      prop: c.prop,
      unit: e.u.id,
      x: a.x + (b.x - a.x) * e.t,
      y: a.y + (b.y - a.y) * e.t,
      z: a.z + (b.z - a.z) * e.t,
      damage,
    });
  }
}

/**
 * A thrown city weapon lands (the projectile system calls it instead of its own impact): the
 * propane tank explodes, the water tank splashes, the garage door knocks over what it lands
 * among, a javelin sticks in the structure, kaiju or ground it stopped in. Then `projectileHit`,
 * with the radius of what to draw.
 */
export function cityWeaponImpact(world: World, p: Projectile, x: number, y: number, z: number, target: ProjectileTarget, targetId: number): void {
  const c = p.city;
  if (!c) return;
  const owner = world.kaijus[p.ownerId];
  const w = owner ? weaponDefs(owner) : worldWeapons(world);
  const mult: BurstMult = { unit: c.unitMult, nerve: c.nerveMult, structure: c.structureMult };
  const spare = p.owner === 'kaiju' ? p.ownerId : -1;
  let radius = 0;
  if (c.prop === 'propane') {
    propaneBlast(world, x, y, z, 'thrown', spare, -1, p.player, mult);
    radius = w.propane.radius;
  } else if (c.prop === 'watertank') {
    radius = w.watertank.radius;
    emit(world, { type: 'waterSplash', x, z, radius, by: p.player });
    burst(world, w.watertank, x, y, z, p.player, 'splash', mult, spare);
  } else if (c.prop === 'garagedoor') {
    radius = w.garagedoor.throw.radius;
    burst(world, w.garagedoor.throw, x, y, z, p.player, 'thrown', mult, spare);
  } else {
    const j = javelinDef(w, c.prop);
    if (target === 'structure') {
      world.structureHits.push({ id: targetId, damage: j.structureDamage * c.structureMult, by: p.player, cause: 'javelin', dirX: p.vx, dirZ: p.vz });
    } else if (target === 'kaiju') {
      const speed = Math.hypot(p.vx, p.vz);
      world.hits.push({
        target: { entity: 'kaiju', id: targetId },
        hit: {
          damage: j.kaijuDamage * c.unitMult,
          nerve: j.unitNerve * c.nerveMult,
          fromDir: speed > 1e-6 ? { x: -p.vx / speed, z: -p.vz / speed } : { x: 0, z: 0 },
          sourceId: p.ownerId,
          player: p.player,
          kind: 'javelin',
          atWill: false,
        },
      });
    }
  }
  const shown: ProjectileTarget = target === 'ground' && inWater(world.cityQuery, x, z) ? 'water' : target;
  emit(world, { type: 'projectileHit', id: p.id, projectile: p.type, x, y, z, target: shown, targetId, splash: radius });
}
