/**
 * What the kaiju's verbs DO when their effect goes off (DESIGN.md section 4). The action state
 * machine (systems/kaijuActions.ts) decides when; these functions decide what gets hit.
 *
 * Nothing here changes hp: unit damage goes into `world.hits`, city damage into
 * `world.structureHits` and `world.propHits`. The exceptions are the things a kaiju takes out
 * of the world with its hand or mouth, which must be gone at once: a prop (`takeProp`), a wreck,
 * or one vehicle of a unit (through `applyHit`).
 *
 * All reach numbers are in body radii of the current stage and come from the kind's definitions.
 */

import { PROP_KINDS } from '../city/props';
import { distToStructure, propsInCircle, structuresInCircle } from '../city/spatialIndex';
import type { DamageKind } from '../defs/ids';
import { perStage } from '../defs/ids';
import { kaijuStageDef } from '../defs/kaiju/index';
import { DT } from '../defs/rules';
import type { BeamSpecialDef, KaijuKindDef } from '../defs/schema';
import { unitTypeDef } from '../defs/units';
import { hasModFlag, modMult } from '../defs/upgrades';
import { projectileTypeDef } from '../defs/weapons';
import { PI } from '../math/angle';
import { bitGet } from '../math/bits';
import { circleInArc, createCastHit, obbInArc, rayVsCapsule, type VerticalCapsule } from '../math/geom';
import { lerp } from '../math/scalar';
import type { Vec3 } from '../math/vec';
import { createAimPoint, kaijuCapsule, resolveAimPoint, unitCapsule } from './aim';
import { beamPath, createBeamPath } from './beam';
import type { HeldObject, HeldSource } from './events';
import { noteKaijuNoise } from './spotting';
import { takeProp, takePropWreck } from './systems/cityDamage';
import { applyHit, healKaiju } from './systems/damage';
import { spawnProjectile } from './systems/projectiles';
import type { Hit, Kaiju, Unit, World } from './types';
import { emit } from './worldOps';

/** How far in front of the body center the hand releases a thrown object, in body radii. */
const HAND_FORWARD = 0.6;
/** Props within this margin of the beam's end are burnt with whatever it hit, when it ends this low. */
const BEAM_PROP_MARGIN = 1;
const BEAM_PROP_HEIGHT = 10;

/** Hp taken beyond one member's share when a vehicle is lifted, so rounding never leaves it standing. */
const GRAB_HP_SLACK = 1e-6;

const ids: number[] = [];
const aim = createAimPoint();
const beam = createBeamPath();
const capHit = createCastHit();
const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const rayOrigin: Vec3 = { x: 0, y: 0, z: 0 };
const rayDir: Vec3 = { x: 0, y: 0, z: 0 };

/** A hit dealt by a kaiju's own body or breath, in raw numbers; `fromDir` points from the target to the kaiju. */
function kaijuHit(k: Kaiju, tx: number, tz: number, damage: number, nerve: number, kind: DamageKind): Hit {
  const dx = k.x - tx;
  const dz = k.z - tz;
  const d = Math.hypot(dx, dz);
  return {
    damage,
    nerve,
    fromDir: d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 0 },
    sourceId: k.id,
    player: k.player,
    kind,
    atWill: false,
  };
}

/** Units a kaiju's ground attacks can reach: alive and not flying above its head. */
function inReachOfBody(k: Kaiju, u: Unit): boolean {
  return u.alive && u.y <= k.height;
}

// ---------------------------------------------------------------------------------------------
// Swipe, stomp, roar
// ---------------------------------------------------------------------------------------------

function swipeArc(world: World, k: Kaiju, def: KaijuKindDef, yaw: number): void {
  const a = def.actions.swipe;
  const range = a.reach * k.radius;
  const half = a.arc / 2;
  const unitDamage = a.unitDamage * modMult(k.mods, 'unitDamage');
  const unitNerve = a.unitNerve * modMult(k.mods, 'nerveDamage');
  const structureDamage = perStage(a.structureDamage, k.stage) * modMult(k.mods, 'structureDamage');

  for (const u of world.units) {
    if (!inReachOfBody(k, u) || !circleInArc(u.x, u.z, u.radius, k.x, k.z, yaw, half, range)) continue;
    world.hits.push({ target: { entity: 'unit', id: u.id }, hit: kaijuHit(k, u.x, u.z, unitDamage, unitNerve, 'swipe') });
  }
  for (const other of world.kaijus) {
    if (other === k || !other.alive || !circleInArc(other.x, other.z, other.radius, k.x, k.z, yaw, half, range)) continue;
    world.hits.push({ target: { entity: 'kaiju', id: other.id }, hit: kaijuHit(k, other.x, other.z, unitDamage, unitNerve, 'swipe') });
  }
  structuresInCircle(world.cityQuery, k.x, k.z, range, ids);
  for (const id of ids) {
    if (!obbInArc(world.city.structures[id], k.x, k.z, yaw, half, range)) continue;
    world.structureHits.push({ id, damage: structureDamage, by: k.player, cause: 'swipe' });
  }
  const index = world.cityIndex;
  propsInCircle(world.cityQuery, k.x, k.z, range, ids);
  for (const id of ids) {
    if (!circleInArc(index.px[id], index.pz[id], index.pradius[id], k.x, k.z, yaw, half, range)) continue;
    world.propHits.push({ id, by: k.player, cause: 'swipe' });
  }
}

/** Swipe: everything in the arc in front of the head takes the claws once. */
export function swipeEffect(world: World, k: Kaiju, def: KaijuKindDef): void {
  swipeArc(world, k, def, k.actionYaw);
  // Tier 2 mutation: the tail sweeps the same arc behind.
  if (hasModFlag(k.mods, 'tailClub')) swipeArc(world, k, def, k.actionYaw + PI);
}

/** Stomp: a shockwave around the body, strongest at the center, that also shoves units outward. */
export function stompEffect(world: World, k: Kaiju, def: KaijuKindDef): void {
  const a = def.actions.stomp;
  const radius = a.radius * k.radius;
  const unitMult = modMult(k.mods, 'unitDamage');
  const nerveMult = modMult(k.mods, 'nerveDamage');
  const structureDamage = perStage(a.structureDamage, k.stage) * modMult(k.mods, 'structureDamage');

  for (const u of world.units) {
    if (!inReachOfBody(k, u)) continue;
    const dx = u.x - k.x;
    const dz = u.z - k.z;
    const d = Math.hypot(dx, dz);
    const edge = Math.max(0, d - u.radius);
    if (edge > radius) continue;
    const t = edge / radius;
    const damage = lerp(a.unitDamageCenter, a.unitDamageEdge, t) * unitMult;
    const nerve = lerp(a.unitNerveCenter, a.unitNerveEdge, t) * nerveMult;
    world.hits.push({ target: { entity: 'unit', id: u.id }, hit: kaijuHit(k, u.x, u.z, damage, nerve, 'stomp') });

    // Knockback as a velocity kick: the movement system carries the unit outward and stops it
    // at walls and at the bounds. A body braking at `accel` from v travels v^2 / (2 accel).
    const shove = a.knockback * k.radius * (1 - t);
    if (shove > 0) {
      const speed = Math.sqrt(2 * unitTypeDef(u.type).accel * shove);
      const nx = d > 1e-6 ? dx / d : Math.sin(k.yaw);
      const nz = d > 1e-6 ? dz / d : Math.cos(k.yaw);
      u.vx = nx * speed;
      u.vz = nz * speed;
    }
  }
  for (const other of world.kaijus) {
    if (other === k || !other.alive) continue;
    const edge = Math.max(0, Math.hypot(other.x - k.x, other.z - k.z) - other.radius);
    if (edge > radius) continue;
    const t = edge / radius;
    world.hits.push({
      target: { entity: 'kaiju', id: other.id },
      hit: kaijuHit(k, other.x, other.z, lerp(a.unitDamageCenter, a.unitDamageEdge, t) * unitMult, lerp(a.unitNerveCenter, a.unitNerveEdge, t) * nerveMult, 'stomp'),
    });
  }

  structuresInCircle(world.cityQuery, k.x, k.z, radius, ids);
  for (const id of ids) {
    const t = Math.min(1, distToStructure(world.cityIndex, id, k.x, k.z) / radius);
    world.structureHits.push({ id, damage: structureDamage * lerp(1, a.structureEdgeFraction, t), by: k.player, cause: 'stomp' });
  }
  propsInCircle(world.cityQuery, k.x, k.z, radius, ids);
  for (const id of ids) world.propHits.push({ id, by: k.player, cause: 'stomp' });
  noteKaijuNoise(k);
}

/** Roar: nerve damage to every unit in the radius, and their volley charge is gone. */
export function roarEffect(world: World, k: Kaiju, def: KaijuKindDef): void {
  const a = def.actions.roar;
  const radius = perStage(a.radius, k.stage) * modMult(k.mods, 'roarRadius');
  const nerve = a.unitNerve * modMult(k.mods, 'nerveDamage');
  for (const u of world.units) {
    if (!u.alive) continue;
    const dx = u.x - k.x;
    const dz = u.z - k.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    const hit = kaijuHit(k, u.x, u.z, 0, nerve, 'roar');
    hit.resetsCharge = a.resetsCharge;
    world.hits.push({ target: { entity: 'unit', id: u.id }, hit });
  }
  emit(world, { type: 'roar', kaiju: k.id, x: k.x, z: k.z, radius });
  noteKaijuNoise(k);
}

// ---------------------------------------------------------------------------------------------
// Grab, throw, eat: the held-object model
// ---------------------------------------------------------------------------------------------

/** Something within reach of the hand or the mouth. */
export interface ReachTarget {
  source: Exclude<HeldSource, 'none'>;
  /** Prop id, unit id or structure id, depending on `source`. */
  id: number;
  /** Distance from the body center to its nearest edge. */
  dist: number;
}

function nearer(best: ReachTarget | null, source: ReachTarget['source'], id: number, dist: number): ReachTarget | null {
  if (best && best.dist <= dist) return best;
  return { source, id, dist };
}

/**
 * The nearest thing the kaiju can pick up in its grab arc: a car, a wreck, or (from the stage
 * the definition says) a live vehicle. Loose objects always win over buildings: only when none
 * is in reach, and the stage allows it, does the hand tear a chunk from the nearest structure.
 */
export function findGrabTarget(world: World, k: Kaiju, def: KaijuKindDef): ReachTarget | null {
  const a = def.actions.grab;
  const range = a.reach * k.radius;
  const half = a.arc / 2;
  const yaw = k.aimYaw;
  const index = world.cityIndex;
  let best: ReachTarget | null = null;

  propsInCircle(world.cityQuery, k.x, k.z, range, ids, false);
  for (const id of ids) {
    const alive = bitGet(world.propAlive, id);
    const kind = PROP_KINDS[world.city.props[id].kind];
    const source = alive ? (kind.grabbable ? 'prop' : null) : bitGet(world.propWreck, id) ? 'propWreck' : null;
    if (!source) continue;
    const r = index.pradius[id];
    if (!circleInArc(index.px[id], index.pz[id], r, k.x, k.z, yaw, half, range)) continue;
    best = nearer(best, source, id, Math.max(0, Math.hypot(index.px[id] - k.x, index.pz[id] - k.z) - r));
  }
  for (const u of world.units) {
    if (u.y > k.height || !unitTypeDef(u.type).grabbable) continue;
    const source = u.alive ? (k.stage >= a.vehicleFromStage ? 'unit' : null) : u.wreck ? 'unitWreck' : null;
    if (!source) continue;
    if (!circleInArc(u.x, u.z, u.radius, k.x, k.z, yaw, half, range)) continue;
    best = nearer(best, source, u.id, Math.max(0, Math.hypot(u.x - k.x, u.z - k.z) - u.radius));
  }
  if (best || k.stage < a.chunkFromStage) return best;

  structuresInCircle(world.cityQuery, k.x, k.z, range, ids);
  for (const id of ids) {
    if (!obbInArc(world.city.structures[id], k.x, k.z, yaw, half, range)) continue;
    best = nearer(best, 'structure', id, distToStructure(index, id, k.x, k.z));
  }
  return best;
}

/**
 * The nearest thing the kaiju can eat straight off the ground: an edible prop (cars, kiosks), a
 * car wreck or a dead vehicle's wreck, within the eat reach in the grab arc.
 */
export function findEdible(world: World, k: Kaiju, def: KaijuKindDef): ReachTarget | null {
  const range = def.actions.eat.reach * k.radius;
  const half = def.actions.grab.arc / 2;
  const yaw = k.aimYaw;
  const index = world.cityIndex;
  let best: ReachTarget | null = null;

  propsInCircle(world.cityQuery, k.x, k.z, range, ids, false);
  for (const id of ids) {
    const alive = bitGet(world.propAlive, id);
    const kind = PROP_KINDS[world.city.props[id].kind];
    const source = alive ? (kind.edible ? 'prop' : null) : bitGet(world.propWreck, id) ? 'propWreck' : null;
    if (!source) continue;
    const r = index.pradius[id];
    if (!circleInArc(index.px[id], index.pz[id], r, k.x, k.z, yaw, half, range)) continue;
    best = nearer(best, source, id, Math.max(0, Math.hypot(index.px[id] - k.x, index.pz[id] - k.z) - r));
  }
  for (const u of world.units) {
    if (u.alive || !u.wreck) continue;
    if (!circleInArc(u.x, u.z, u.radius, k.x, k.z, yaw, half, range)) continue;
    best = nearer(best, 'unitWreck', u.id, Math.max(0, Math.hypot(u.x - k.x, u.z - k.z) - u.radius));
  }
  return best;
}

/**
 * Takes a reach target out of the world and says what it is as a held object. Returns null when
 * it is no longer there.
 */
function takeFromWorld(world: World, k: Kaiju, def: KaijuKindDef, target: ReachTarget): HeldObject | null {
  switch (target.source) {
    case 'prop': {
      const kind = world.city.props[target.id].kind;
      return takeProp(world, target.id, k.player) ? { kind: 'prop', prop: kind } : null;
    }
    case 'propWreck':
      return takePropWreck(world, target.id) ? { kind: 'wreck', wreck: 'car' } : null;
    case 'unitWreck': {
      const u = world.units[target.id];
      if (u.alive || !u.wreck) return null;
      u.wreck = false;
      return { kind: 'wreck', wreck: 'tank' };
    }
    case 'unit': {
      const u = world.units[target.id];
      if (!u.alive) return null;
      const unitType = u.type;
      // The hand takes ONE vehicle: the unit drops to (just under) the hp of one member fewer,
      // whatever protection its squad has.
      const perMember = u.maxHp / Math.max(1, unitTypeDef(u.type).members);
      const damage = u.hp - Math.max(0, u.members - 1) * perMember + GRAB_HP_SLACK;
      const taken = modMult(world.squads[u.squad].mods, 'damageTaken');
      applyHit(world, { entity: 'unit', id: u.id }, kaijuHit(k, u.x, u.z, taken > 0 ? damage / taken : Infinity, 0, 'swipe'));
      // The last vehicle of a unit is in the hand, not burning on the ground.
      if (!u.alive) u.wreck = false;
      return { kind: 'vehicle', unitType };
    }
    case 'structure': {
      const s = world.city.structures[target.id];
      const damage = perStage(def.actions.grab.chunkStructureDamage, k.stage) * modMult(k.mods, 'structureDamage');
      world.structureHits.push({ id: target.id, damage, by: k.player, cause: 'swipe' });
      return { kind: 'chunk', archetype: s.archetype };
    }
  }
}

/** Grab: the hand closes on the nearest thing in reach. A grab that finds nothing is a whiff. */
export function grabEffect(world: World, k: Kaiju, def: KaijuKindDef): void {
  if (k.held) return;
  const target = findGrabTarget(world, k, def);
  if (!target) return;
  const held = takeFromWorld(world, k, def, target);
  if (!held) return;
  k.held = held;
  emit(world, { type: 'kaijuHeld', kaiju: k.id, held, reason: 'grab', source: target.source, sourceId: target.id });
}

/**
 * Launch angle (radians above the horizon) that lands a throw of speed `v` on a point `d` meters
 * away and `dy` meters above the hand, on the flat arc. Out of reach: 45 degrees, the longest throw.
 */
export function throwAngle(d: number, dy: number, v: number, g: number): number {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (disc < 0) return PI / 4;
  return Math.atan2(v2 - Math.sqrt(disc), g * d);
}

/** Throw: the held object leaves the hand toward the aim point as a ballistic projectile. */
export function throwEffect(world: World, k: Kaiju, def: KaijuKindDef): void {
  const payload = k.held;
  if (!payload) return;
  const a = def.actions.throw;
  const st = kaijuStageDef(k.kind, k.stage);
  const type = projectileTypeDef('thrown');
  const speed = perStage(a.speed, k.stage);
  const g = type.gravity;

  const hx = k.x + Math.sin(k.aimYaw) * k.radius * HAND_FORWARD;
  const hy = st.handHeight;
  const hz = k.z + Math.cos(k.aimYaw) * k.radius * HAND_FORWARD;

  // What the crosshair is on, out to well past the longest possible throw.
  const reach = (speed * speed) / Math.max(g, 0.01) + st.eyeHeight * 2 + 50;
  resolveAimPoint(world.cityQuery, k.x, st.eyeHeight, k.z, k.aimYaw, k.aimPitch, reach, aim);

  let dirX = Math.sin(k.aimYaw);
  let dirZ = Math.cos(k.aimYaw);
  let angle: number;
  if (aim.on === 'none') {
    // Looking at the sky or the horizon: it flies where the head points.
    angle = k.aimPitch;
  } else {
    const dx = aim.x - hx;
    const dz = aim.z - hz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) {
      dirX = dx / d;
      dirZ = dz / d;
    }
    angle = throwAngle(d, aim.y - hy, speed, g);
  }
  const horizontal = Math.cos(angle) * speed;

  spawnProjectile(world, {
    type: 'thrown',
    flight: type.flight,
    owner: 'kaiju',
    ownerId: k.id,
    player: k.player,
    x: hx,
    y: hy,
    z: hz,
    vx: dirX * horizontal,
    vy: Math.sin(angle) * speed,
    vz: dirZ * horizontal,
    gravity: g,
    ttl: type.ttl,
    damage: a.unitDamage * modMult(k.mods, 'unitDamage'),
    nerve: a.unitNerve * modMult(k.mods, 'nerveDamage'),
    splash: perStage(a.impactRadius, k.stage),
    structureDamage: perStage(a.structureDamage, k.stage) * modMult(k.mods, 'structureDamage'),
    cause: 'thrown',
    volley: false,
    atWill: false,
    payload,
  });
  k.held = null;
  emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'throw', source: 'none', sourceId: -1 });
}

/** Lets go of whatever is in the hand (the cocoon closes over it). */
export function dropHeld(world: World, k: Kaiju): void {
  if (!k.held) return;
  k.held = null;
  emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'drop', source: 'none', sourceId: -1 });
}

/** True when an Eat started now would find a meal: something in the hand or an edible in reach. */
export function canEat(world: World, k: Kaiju, def: KaijuKindDef): boolean {
  return k.held !== null || findEdible(world, k, def) !== null;
}

/**
 * Eat, first bite: the meal goes into the mouth (out of the hand, or out of the world). Returns
 * whether there was one. The heal lands when the kaiju has finished chewing (`eatFinish`).
 */
export function eatStart(world: World, k: Kaiju, def: KaijuKindDef): boolean {
  if (k.held) {
    k.held = null;
    emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'eat', source: 'none', sourceId: -1 });
    return true;
  }
  const target = findEdible(world, k, def);
  if (!target || !takeFromWorld(world, k, def, target)) return false;
  emit(world, { type: 'kaijuHeld', kaiju: k.id, held: null, reason: 'eat', source: target.source, sourceId: target.id });
  return true;
}

export function eatFinish(k: Kaiju, def: KaijuKindDef): void {
  healKaiju(k, def.actions.eat.heal);
}

// ---------------------------------------------------------------------------------------------
// The Lizard's special: the beam
// ---------------------------------------------------------------------------------------------

/**
 * One tick of the beam. It leaves the mouth along the head's aim and ends at the first standing
 * structure, at the ground, or at its range. That one structure takes the structure damage
 * (when it falls, the beam reaches the next one on the following tick); every unit the beam
 * passes within half its width of takes the unit damage. Units behind a standing building are
 * safe until it has burnt through.
 */
export function beamTick(world: World, k: Kaiju, a: BeamSpecialDef): void {
  beamPath(world.cityQuery, k, a, beam);
  k.act.beamLength = beam.length;
  k.act.beamBlocker = beam.blocker;
  const halfWidth = perStage(a.width, k.stage) / 2;

  if (beam.blocker >= 0) {
    const damage = perStage(a.structureDps, k.stage) * modMult(k.mods, 'structureDamage') * DT;
    world.structureHits.push({ id: beam.blocker, damage, by: k.player, cause: 'beam' });
  }

  rayOrigin.x = beam.ox;
  rayOrigin.y = beam.oy;
  rayOrigin.z = beam.oz;
  rayDir.x = beam.dx;
  rayDir.y = beam.dy;
  rayDir.z = beam.dz;
  const damage = a.unitDps * modMult(k.mods, 'unitDamage') * DT;
  const nerve = a.unitNervePerSecond * modMult(k.mods, 'nerveDamage') * DT;
  for (const u of world.units) {
    if (!u.alive) continue;
    unitCapsule(u, capsule).r += halfWidth;
    if (!rayVsCapsule(rayOrigin, rayDir, beam.length, capsule, capHit)) continue;
    world.hits.push({ target: { entity: 'unit', id: u.id }, hit: kaijuHit(k, u.x, u.z, damage, nerve, 'beam') });
  }
  for (const other of world.kaijus) {
    if (other === k || !other.alive) continue;
    kaijuCapsule(other, capsule).r += halfWidth;
    if (!rayVsCapsule(rayOrigin, rayDir, beam.length, capsule, capHit)) continue;
    world.hits.push({ target: { entity: 'kaiju', id: other.id }, hit: kaijuHit(k, other.x, other.z, damage, nerve, 'beam') });
  }

  // Whatever small things stand where the beam lands burn with it.
  if (beam.end !== 'range' && beam.ey <= BEAM_PROP_HEIGHT) {
    propsInCircle(world.cityQuery, beam.ex, beam.ez, halfWidth + BEAM_PROP_MARGIN, ids);
    for (const id of ids) world.propHits.push({ id, by: k.player, cause: 'beam' });
  }
}
