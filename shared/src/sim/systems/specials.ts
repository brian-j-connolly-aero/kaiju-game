/**
 * The special buildings' rewards (docs/ROADMAP.md phase 2; DESIGN.md section 7, "Special
 * buildings"). Every starting neighborhood has a power substation, a gas station and a radio mast
 * (city/meridian/specials.ts). The city damage system calls `specialCollapsed` on the tick a
 * structure turns to rubble; for those three it pays the reward, once (rubble never collapses
 * again), whoever wrecked it, with the numbers of the kaiju kind's `rewards`:
 *
 * - power substation: a power surge for the kaiju (the one that wrecked it, else the nearest
 *   living one): every cooldown cleared at once and recovering `cooldownRate` times as fast,
 *   its attacks doing `damageMult` times the damage to units and structures, for `duration`
 *   seconds, and its rage up by `rage` (`kaiju.surge`; the kaiju action system counts it down,
 *   kaijuEffects.ts `attackMult` reads it);
 * - gas station: a fireball round it (`fireball`, a burst sized to the building) that hurts,
 *   shakes and throws the units in it, damages the structures round it and sets off what burns;
 *   it never hurts a kaiju;
 * - radio mast: it falls over away from the kaiju (the army's falling buildings,
 *   `startStructureFall`, which also crush what it lands on); its top section comes to lie at
 *   the far end as a loose `mast` the hatchling can throw as a heavy javelin; and the humans'
 *   map shows static for `staticTime` seconds (`match.staticUntil`; spotting.ts then lets only
 *   what the units see put the kaiju on their map).
 */

import { archetypeSpecial } from '../../city/archetypes';
import { kaijuKindDef } from '../../defs/kaiju/index';
import { KAIJU_ACTION_IDS, type DamageKind, type KaijuVerb } from '../../defs/ids';
import { FALL_RULES } from '../../defs/rubble';
import { COMBAT_RULES, TICK_RATE } from '../../defs/rules';
import { yawOf } from '../../math/angle';
import type { Vec2 } from '../../math/vec';
import { addLoose, burst } from '../cityWeapons';
import type { PlayerId } from '../config';
import type { Kaiju, World } from '../types';
import { emit } from '../worldOps';
import { startStructureFall } from './cityDamage';

const VERBS: readonly KaijuVerb[] = KAIJU_ACTION_IDS.filter((id): id is KaijuVerb => id !== 'none');
const top: Vec2 = { x: 0, z: 0 };

/** Whether the humans' map shows static at this tick (the radio mast's reward). */
export function mapStatic(world: World): boolean {
  return world.tick < world.match.staticUntil;
}

/** The kaiju a reward is for: the one whose player wrecked it, else the living one nearest to (x, z); null when none is alive. */
function rewardKaiju(world: World, by: PlayerId, x: number, z: number): Kaiju | null {
  const p = world.players[by];
  if (p && p.kaijuId >= 0 && world.kaijus[p.kaijuId].alive) return world.kaijus[p.kaijuId];
  let best: Kaiju | null = null;
  let bestD = Infinity;
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const d = Math.hypot(k.x - x, k.z - z);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** The city damage system's hook: structure `id` has just turned to rubble (stage 3). Pays a special building's reward. */
export function specialCollapsed(world: World, id: number, by: PlayerId, cause: DamageKind): void {
  const s = world.city.structures[id];
  const special = archetypeSpecial(s.archetype);
  if (special === null) return;
  const k = rewardKaiju(world, by, s.x, s.z);
  const rewards = kaijuKindDef(k ? k.kind : world.kaijus[0]?.kind ?? 'lizard').rewards;

  if (special === 'substation') {
    if (!k) return;
    const r = rewards.surge;
    k.surge = Math.max(k.surge, r.duration);
    for (const verb of VERBS) k.cooldowns[verb] = 0;
    k.rage = Math.min(COMBAT_RULES.rageMax, k.rage + r.rage);
    emit(world, { type: 'powerSurge', kaiju: k.id, structure: id, x: s.x, z: s.z, duration: r.duration, cooldownRate: r.cooldownRate, damageMult: r.damageMult, rage: r.rage, by });
    return;
  }

  if (special === 'gasstation') {
    const f = rewards.fireball;
    emit(world, { type: 'fireball', structure: id, x: s.x, z: s.z, radius: f.radius, by });
    burst(world, f, s.x, 0, s.z, by, 'fireball', { unit: 1, nerve: 1, structure: 1 }, -1);
    return;
  }

  // The radio mast: it falls away from the kaiju (straight out from it), else the way it faces.
  const r = rewards.radiomast;
  let dx = k ? s.x - k.x : Math.sin(s.yaw);
  let dz = k ? s.z - k.z : Math.cos(s.yaw);
  if (dx * dx + dz * dz < 1e-6) {
    dx = Math.sin(k ? k.yaw : s.yaw);
    dz = Math.cos(k ? k.yaw : s.yaw);
  }
  const tip = startStructureFall(world, id, dx, dz, by, cause, 0, top);
  // Where it lies: from the edge it turned about (its side's middle) to the tip, as tall as it was.
  const tipX = tip ? tip.x : s.x + (dx / Math.hypot(dx, dz)) * s.height;
  const tipZ = tip ? tip.z : s.z + (dz / Math.hypot(dx, dz)) * s.height;
  const yaw = yawOf(tipX - s.x, tipZ - s.z);
  const ux = Math.sin(yaw);
  const uz = Math.cos(yaw);
  const baseX = tipX - ux * s.height;
  const baseZ = tipZ - uz * s.height;
  const topX = tipX - ux * (r.topLength / 2);
  const topZ = tipZ - uz * (r.topLength / 2);
  const landsAt = world.tick + Math.round(FALL_RULES.time * TICK_RATE);
  const loose = addLoose(world, 'mast', topX, topZ, yaw, 'mast', landsAt);
  const until = Math.max(world.match.staticUntil, world.tick + Math.round(r.staticTime * TICK_RATE));
  world.match.staticUntil = until;
  emit(world, {
    type: 'mastFall',
    structure: id,
    x: baseX,
    z: baseZ,
    yaw,
    length: s.height,
    duration: FALL_RULES.time,
    topId: loose.id,
    topX,
    topZ,
    staticUntil: until,
    staticTime: r.staticTime,
    by,
  });
}
