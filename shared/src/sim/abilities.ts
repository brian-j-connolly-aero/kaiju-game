/**
 * Smoke and marking: the two things every squad leader can do besides firing (DESIGN.md
 * section 5, "Smoke and marking"). Numbers in SQUAD_ABILITIES (defs/rules.ts).
 *
 * - **Smoke.** The leader throws a smoke cloud at the crosshair (no further than the stage's
 *   throw range). It stands for a while as a cylinder on the ground. No sight line passes
 *   through it, in either direction: not the squads' spotting (sim/spotting.ts), not the kaiju
 *   bot's looking. The units inside it are hidden from the kaiju: the kaiju bot does not pick
 *   them as targets, and the kaiju player's picture leaves out their markers and their
 *   targeting lasers. Shells and claws pass through smoke as they would through air.
 * - **Marking.** With the kaiju in sight (no building, no smoke in between) within the stage's
 *   mark range and the crosshair on or beside it, the leader marks it for the whole army for a
 *   while: the humans' map shows it, it counts as spotted (the scatter bonus), and the orange
 *   marker floats over it on every squad's screen.
 *
 * Both are per squad, on a cooldown, and come back ready with every new stage. A press that
 * does nothing (no kaiju in sight, smoke still cooling) spends nothing.
 */

import { SQUAD_ABILITIES, DT, SQUAD_RULES } from '../defs/rules';
import { unitTypeDef } from '../defs/units';
import { createCastHit, rayVsCapsule, type VerticalCapsule } from '../math/geom';
import { clamp } from '../math/scalar';
import type { Vec3 } from '../math/vec';
import { unitSeesKaiju } from './spotting';
import type { Kaiju, Squad, Unit, World } from './types';
import { emit } from './worldOps';

/** What a sight test needs to know about a cloud. SmokeCloud satisfies it; a client fills it from a snapshot. */
export interface SmokeShape {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/**
 * True when the straight line from a to b passes through a smoke cloud (a ground-standing
 * cylinder) anywhere below the cloud's top. A line that starts or ends inside a cloud passes
 * through it: whoever stands in the smoke cannot see out, and cannot be seen.
 */
export function smokeBlocks(smokes: readonly SmokeShape[], a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dd = dx * dx + dz * dz;
  for (const s of smokes) {
    // The part of the segment (t in 0..1) inside the cloud's circle on the ground.
    const fx = a.x - s.x;
    const fz = a.z - s.z;
    const c = fx * fx + fz * fz - s.radius * s.radius;
    let t0: number;
    let t1: number;
    if (dd < 1e-12) {
      if (c > 0) continue;
      t0 = 0;
      t1 = 1;
    } else {
      const half = fx * dx + fz * dz;
      const disc = half * half - dd * c;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      t0 = Math.max(0, (-half - root) / dd);
      t1 = Math.min(1, (-half + root) / dd);
      if (t0 > t1) continue;
    }
    // The line is lowest at one end of that part: it is in the smoke if that end is below the top.
    const y0 = a.y + (b.y - a.y) * t0;
    const y1 = a.y + (b.y - a.y) * t1;
    if (Math.min(y0, y1) <= s.height) return true;
  }
  return false;
}

/** True when the point (x, z) on the ground stands inside a smoke cloud. */
export function inSmoke(smokes: readonly SmokeShape[], x: number, z: number): boolean {
  for (const s of smokes) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.radius * s.radius) return true;
  }
  return false;
}

/** True when the kaiju cannot see this unit: it stands in smoke. (The kaiju bot's targeting asks this.) */
export function hiddenFromKaiju(world: World, u: Unit): boolean {
  return world.smokes.length > 0 && inSmoke(world.smokes, u.x, u.z);
}

/** Counts down the clouds, the marks and every squad's two cooldowns. Once per tick. */
export function updateAbilities(world: World): void {
  const smokes = world.smokes;
  for (let i = smokes.length - 1; i >= 0; i--) {
    smokes[i].timer -= DT;
    if (smokes[i].timer <= 0) smokes.splice(i, 1);
  }
  for (const k of world.kaijus) {
    if (k.marked > 0) k.marked = k.alive ? Math.max(0, k.marked - DT) : 0;
  }
  for (const s of world.squads) {
    if (s.smokeCooldown > 0) s.smokeCooldown = Math.max(0, s.smokeCooldown - DT);
    if (s.markCooldown > 0) s.markCooldown = Math.max(0, s.markCooldown - DT);
  }
}

/** A new stage, or a blast: the air clears and nobody is marked any more. */
export function clearAbilities(world: World): void {
  world.smokes.length = 0;
  for (const k of world.kaijus) k.marked = 0;
}

/**
 * Throws the squad's smoke toward (x, z): no further from the leader than the stage's range,
 * inside the bounds. Returns whether it was thrown (it is not while the smoke cools down).
 */
export function throwSmoke(world: World, squad: Squad, leader: Unit, x: number, z: number): boolean {
  if (squad.smokeCooldown > 0 || squad.eliminated || !leader.alive) return false;
  const rules = SQUAD_ABILITIES.smoke;
  const i = world.match.stage - 1;
  const range = rules.range[i];
  let dx = x - leader.x;
  let dz = z - leader.z;
  const d = Math.hypot(dx, dz);
  if (d > range) {
    dx *= range / d;
    dz *= range / d;
  }
  const b = world.match.bounds;
  const cloud = {
    id: world.nextSmokeId++,
    squad: squad.id,
    x: clamp(leader.x + dx, b.minX, b.maxX),
    z: clamp(leader.z + dz, b.minZ, b.maxZ),
    radius: rules.radius[i],
    height: rules.height[i],
    timer: rules.duration,
  };
  world.smokes.push(cloud);
  if (world.smokes.length > rules.maxClouds) world.smokes.shift();
  squad.smokeCooldown = rules.cooldown;
  emit(world, {
    type: 'smoke',
    id: cloud.id,
    squad: squad.id,
    player: squad.player,
    x: cloud.x,
    z: cloud.z,
    radius: cloud.radius,
    height: cloud.height,
    duration: rules.duration,
  });
  return true;
}

const capsule: VerticalCapsule = { x: 0, z: 0, r: 0, y0: 0, y1: 0 };
const capHit = createCastHit();
const origin: Vec3 = { x: 0, y: 0, z: 0 };
const dir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The kaiju the leader can mark with the crosshair at (aimYaw, aimPitch): in sight within the
 * stage's mark range, the crosshair on its body or within SQUAD_ABILITIES.mark.aimSlackRadii
 * body radii of it. The nearest such; null when there is none.
 */
export function markableKaiju(world: World, leader: Unit, aimYaw: number, aimPitch: number): Kaiju | null {
  const rules = SQUAD_ABILITIES.mark;
  const range = rules.range[world.match.stage - 1];
  const cp = Math.cos(aimPitch);
  origin.x = leader.x;
  origin.y = leader.y + unitTypeDef(leader.type).eyeHeight;
  origin.z = leader.z;
  dir.x = Math.sin(aimYaw) * cp;
  dir.y = Math.sin(aimPitch);
  dir.z = Math.cos(aimYaw) * cp;
  let best: Kaiju | null = null;
  let bestT = Infinity;
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const slack = k.radius * rules.aimSlackRadii;
    capsule.x = k.x;
    capsule.z = k.z;
    capsule.r = slack;
    capsule.y0 = 0;
    capsule.y1 = k.height + slack;
    if (!rayVsCapsule(origin, dir, range + slack, capsule, capHit) || capHit.t >= bestT) continue;
    if (!unitSeesKaiju(world, leader, k, range)) continue;
    best = k;
    bestT = capHit.t;
  }
  return best;
}

/** Marks the kaiju under the leader's crosshair for the whole army. Returns whether it did. */
export function markKaiju(world: World, squad: Squad, leader: Unit, aimYaw: number, aimPitch: number): boolean {
  if (squad.markCooldown > 0 || squad.eliminated || !leader.alive) return false;
  const k = markableKaiju(world, leader, aimYaw, aimPitch);
  if (!k) return false;
  const rules = SQUAD_ABILITIES.mark;
  k.marked = rules.duration;
  squad.markCooldown = rules.cooldown;
  emit(world, { type: 'mark', kaiju: k.id, squad: squad.id, player: squad.player, x: k.x, z: k.z, duration: rules.duration });
  return true;
}

/** How far a crosshair smoke may be thrown at this stage (the sky point when the crosshair is on nothing). */
export function smokeReach(world: World): number {
  return Math.min(SQUAD_ABILITIES.smoke.range[world.match.stage - 1], SQUAD_RULES.markerRange);
}
