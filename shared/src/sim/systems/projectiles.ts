/**
 * System 7 of 11: projectiles.
 *
 * Projectiles are real objects (DESIGN.md section 5, "Backstop"): each one flies until it meets
 * something, and a miss damages whatever is behind the target. This system flies every
 * projectile in `world.projectiles`, whoever launched it, and resolves what it hits.
 *
 * Kinematics, the same for the three flight models (flat has gravity 0). Clients fly their own
 * copies from `projectileSpawn` with exactly this, so it must stay this simple:
 *
 *   position(t) = p0 + v0 * t - (0, 1/2 * gravity * t^2, 0),   t = seconds since the spawn tick
 *
 * `stepProjectile` advances one tick of that exactly (no integration drift). The kaiju action
 * and weapon systems run before this one, so a projectile has already flown one step by the end
 * of the tick that spawned it: at the end of tick T it is at position((T - spawnTick + 1) / 30).
 *
 * Each tick the step segment is swept against, nearest first:
 * - standing structures (box prisms up to their height), bridge decks excepted;
 * - living kaiju (their hit volume: body, head and neck, tail; sim/kaijuBody.ts), except the
 *   kaiju that threw it;
 * - units, only for projectiles thrown by a kaiju: there is no friendly fire between human
 *   units, so their own shells pass over each other;
 * - the ground (y = 0).
 * A bridge deck is road surface: bodies on it stand at ground level, inside its box, so nothing
 * in flight collides with the box (a unit on a bridge can shoot, and a kaiju on one can be
 * hit). A projectile that comes down on a standing deck has hit the deck.
 * On impact: the structure that was hit and every standing structure within the splash radius
 * take `structureDamage`; kaiju whose hit volume is within the splash (and units, for kaiju
 * projectiles) take
 * `damage` and `nerve` through the hit queue; props within the splash are destroyed;
 * `projectileHit` ends it for the clients. A projectile whose time runs out, or that leaves the
 * city, ends with target 'none'.
 *
 * Spawning is the launcher's job: `spawnProjectile` adds one and emits `projectileSpawn`. The
 * kaiju's throw and the weapon system (unit fire, volleys, call-in shells) use it.
 */

import {
  bridgeAt,
  castSegment,
  createCityCastHit,
  inWater,
  propsInCircle,
  structuresInCircle,
} from '../../city/spatialIndex';
import { DT } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { projectileTypeDef } from '../../defs/weapons';
import { createCastHit, segmentVsCapsule, type VerticalCapsule } from '../../math/geom';
import type { Vec2, Vec3 } from '../../math/vec';
import { unitCapsule } from '../aim';
import type { ProjectileTarget } from '../events';
import { castKaijuBody, kaijuBodyDistance } from '../kaijuBody';
import type { Projectile, World } from '../types';
import { emit } from '../worldOps';

/** How far outside the city a projectile may fly before it is forgotten. */
const CITY_MARGIN = 200;
/** Props are low: an explosion this far above the splash radius leaves them alone. */
const PROP_REACH_HEIGHT = 10;

const segA: Vec3 = { x: 0, y: 0, z: 0 };
const segB: Vec3 = { x: 0, y: 0, z: 0 };
const cityHit = createCityCastHit();
const capHit = createCastHit();
const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const ids: number[] = [];

/** The moving part of a projectile (Projectile and a client's local copy both satisfy it). */
export interface ProjectileBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
}

/** Advances a projectile by `dt` seconds, exactly along its parabola. */
export function stepProjectile(p: ProjectileBody, dt: number): void {
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y += p.vy * dt - 0.5 * p.gravity * dt * dt;
  p.vy -= p.gravity * dt;
}

/** Adds a projectile to the world (assigning its id) and tells the clients. */
export function spawnProjectile(world: World, init: Omit<Projectile, 'id'>): Projectile {
  const p: Projectile = { ...init, id: world.nextProjectileId++ };
  world.projectiles.push(p);
  emit(world, {
    type: 'projectileSpawn',
    id: p.id,
    projectile: p.type,
    flight: p.flight,
    owner: p.owner,
    ownerId: p.ownerId,
    player: p.player,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: p.vx,
    vy: p.vy,
    vz: p.vz,
    gravity: p.gravity,
    ttl: p.ttl,
    volley: p.volley,
    ...(p.payload ? { payload: p.payload } : {}),
  });
  return p;
}

/**
 * Where a hit came from, for facing and crossfire: against the travel direction for flat fire,
 * and from the target toward the point of impact for things that fall from above.
 */
function fromDirFor(p: Projectile, ix: number, iz: number, tx: number, tz: number): Vec2 {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed > 1 && speed >= Math.abs(p.vy)) return { x: -p.vx / speed, z: -p.vz / speed };
  const dx = ix - tx;
  const dz = iz - tz;
  const d = Math.hypot(dx, dz);
  return d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 0 };
}

function impact(world: World, p: Projectile, x: number, y: number, z: number, target: ProjectileTarget, targetId: number): void {
  const q = world.cityQuery;
  const splash = p.splash;

  if (p.structureDamage > 0) {
    if (target === 'structure') {
      world.structureHits.push({ id: targetId, damage: p.structureDamage, by: p.player, cause: p.cause });
    }
    if (splash > 0) {
      structuresInCircle(q, x, z, splash, ids);
      for (const id of ids) {
        if (target === 'structure' && id === targetId) continue;
        if (y > world.cityIndex.sheight[id] + splash) continue;
        world.structureHits.push({ id, damage: p.structureDamage, by: p.player, cause: p.cause });
      }
    }
  }

  if (p.damage > 0 || p.nerve > 0) {
    const sourceId = p.owner === 'callin' ? -1 : p.ownerId;
    // A charged volley's shots count for their squad toward breaking the kaiju's nerve.
    const volleySquad = p.volley && p.owner === 'unit' ? (world.units[p.ownerId]?.squad ?? -1) : -1;
    for (const k of world.kaijus) {
      if (!k.alive || (p.owner === 'kaiju' && p.ownerId === k.id)) continue;
      let reached = target === 'kaiju' && targetId === k.id;
      // A blast catches the head or the tail as well as the body; swimming, only what shows
      // above the water (sim/swim.ts).
      if (!reached && splash > 0) reached = kaijuBodyDistance(k, x, y, z) <= splash;
      if (!reached) continue;
      world.hits.push({
        target: { entity: 'kaiju', id: k.id },
        hit: {
          damage: p.damage,
          nerve: p.nerve,
          fromDir: fromDirFor(p, x, z, k.x, k.z),
          sourceId,
          player: p.player,
          kind: p.cause,
          atWill: p.atWill,
          volleySquad,
        },
      });
    }
    if (p.owner === 'kaiju') {
      for (const u of world.units) {
        if (!u.alive) continue;
        let reached = target === 'unit' && targetId === u.id;
        if (!reached && splash > 0) {
          const side = Math.max(0, Math.hypot(x - u.x, z - u.z) - u.radius);
          const above = Math.max(0, y - (u.y + unitTypeDef(u.type).height));
          const below = Math.max(0, u.y - y);
          reached = side * side + above * above + below * below <= splash * splash;
        }
        if (!reached) continue;
        world.hits.push({
          target: { entity: 'unit', id: u.id },
          hit: {
            damage: p.damage,
            nerve: p.nerve,
            fromDir: fromDirFor(p, x, z, u.x, u.z),
            sourceId,
            player: p.player,
            kind: p.cause,
            atWill: p.atWill,
          },
        });
      }
    }
  }

  if (splash > 0 && y <= splash + PROP_REACH_HEIGHT) {
    propsInCircle(q, x, z, splash, ids);
    for (const id of ids) world.propHits.push({ id, by: p.player, cause: p.cause });
  }

  const shown: ProjectileTarget = target === 'ground' && inWater(q, x, z) ? 'water' : target;
  emit(world, { type: 'projectileHit', id: p.id, projectile: p.type, x, y, z, target: shown, targetId, splash });
}

/** Flies one projectile for a tick. Returns false when it ended (hit something, expired, left the city). */
function fly(world: World, p: Projectile): boolean {
  const radius = projectileTypeDef(p.type).radius;
  segA.x = p.x;
  segA.y = p.y;
  segA.z = p.z;
  stepProjectile(p, DT);
  segB.x = p.x;
  segB.y = p.y;
  segB.z = p.z;

  // Fraction along the step of the nearest thing in the way; above 1 means nothing.
  let best = 2;
  let target: ProjectileTarget = 'none';
  let targetId = -1;

  if (castSegment(world.cityQuery, segA, segB, cityHit, -1, true)) {
    best = cityHit.t;
    target = 'structure';
    targetId = cityHit.structure;
  }
  for (const k of world.kaijus) {
    if (!k.alive || (p.owner === 'kaiju' && p.ownerId === k.id)) continue;
    // The step is the segment's own length, so `t` is a fraction of it (as for the city cast).
    if (castKaijuBody(k, segA.x, segA.y, segA.z, segB.x - segA.x, segB.y - segA.y, segB.z - segA.z, 1, radius, capHit) && capHit.t < best) {
      best = capHit.t;
      target = 'kaiju';
      targetId = k.id;
    }
  }
  if (p.owner === 'kaiju') {
    for (const u of world.units) {
      if (!u.alive) continue;
      unitCapsule(u, capsule).r += radius;
      if (segmentVsCapsule(segA, segB, capsule, capHit) && capHit.t < best) {
        best = capHit.t;
        target = 'unit';
        targetId = u.id;
      }
    }
  }
  if (segB.y <= 0) {
    const t = segA.y <= 0 ? 0 : segA.y / (segA.y - segB.y);
    if (t < best) {
      best = t;
      target = 'ground';
      targetId = -1;
    }
  }

  if (best <= 1) {
    const x = segA.x + (segB.x - segA.x) * best;
    const y = target === 'ground' ? 0 : segA.y + (segB.y - segA.y) * best;
    const z = segA.z + (segB.z - segA.z) * best;
    if (target === 'ground') {
      // Coming down on a bridge is a hit on the bridge.
      const deck = bridgeAt(world.cityQuery, x, z);
      if (deck >= 0) {
        target = 'structure';
        targetId = deck;
      }
    }
    p.x = x;
    p.y = y;
    p.z = z;
    impact(world, p, x, y, z, target, targetId);
    return false;
  }

  p.ttl -= DT;
  const limit = world.city.half + CITY_MARGIN;
  if (p.ttl <= 0 || Math.abs(p.x) > limit || Math.abs(p.z) > limit) {
    emit(world, { type: 'projectileHit', id: p.id, projectile: p.type, x: p.x, y: p.y, z: p.z, target: 'none', targetId: -1, splash: 0 });
    return false;
  }
  return true;
}

export function projectileSystem(world: World): void {
  if (world.match.phase !== 'playing') return;
  const list = world.projectiles;
  let kept = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (fly(world, p)) list[kept++] = p;
  }
  list.length = kept;
}
