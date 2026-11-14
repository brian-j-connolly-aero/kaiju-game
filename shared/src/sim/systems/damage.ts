/**
 * System 8 of 11: damage and nerve. One rule set for every combatant (DESIGN.md section 3).
 *
 * `applyHit` is the single door all damage goes through. Systems queue hits in `world.hits`
 * during the tick and this system drains them; code that needs the result at once (a grab
 * lifting a tank) may call `applyHit` directly.
 *
 * Kaiju:
 * - damage = raw x state (normal, braced front arc, helpless) x facing (front, flank, rear);
 * - nerve = raw x facing x brace (front arc) x fire-at-will x crossfire. Nerve leaks away every
 *   second, slows the kaiju while it builds (sim/movement.ts reads `kaiju.nerve`), and at
 *   capacity breaks: a stagger (helpless, full damage), after which nerve clears and the kaiju
 *   is immune to nerve damage for a while. No nerve builds while it is staggered or cocooned;
 * - it takes two squads to break it: nerve at capacity only breaks while charged volleys
 *   (`hit.volley`) from COMBAT_RULES.breakSquads different squads have hit the kaiju within
 *   the last `volleyBreakWindow` seconds. Until then the nerve stays at capacity ("on the
 *   brink": slowed as far as it goes), whatever lands: scattered fire, artillery, or one
 *   squad's volleys, however many and from whatever side;
 * - crossfire: a hit from a unit whose direction differs by `crossfireMinAngle` or more from
 *   ANOTHER unit's hit inside `crossfireWindow`. Only directional hits with a unit as their
 *   source take part (`hit.sourceId` >= 0, a human weapon kind); call-ins with source -1 never do;
 * - rage: 1 per `rageDamagePerPoint` hp actually lost;
 * - at 0 hp it dies (phase 'dead'); the match flow system ends the match.
 *
 * Units: hp and members, nerve (leaks; at capacity the unit is shaken: cannot fire, loses its
 * charge), the roar's stun (`hit.stun`: frozen, charge gone; its shaking waits until the stun
 * is over), death (vehicles leave a wreck), and 15 nerve to friends near a unit that is
 * destroyed. This system counts `unit.stun` and then `unit.shaken` down and puts the unit back
 * to 'idle'; the orders system decides how a shaken unit behaves. A squad whose last unit dies is marked eliminated here, in
 * the same tick, so the radio can say so; handing the player a surviving unit (takeover) is the
 * orders system's job.
 *
 * Each tick, in order: units under a moving kaiju are trampled, the hit queue is drained, then
 * timers run (nerve leak, nerve immunity, stagger end, shaken end).
 */

import type { DamageKind } from '../../defs/ids';
import { kaijuKindDef } from '../../defs/kaiju/index';
import { COMBAT_RULES, DT, TICK_RATE } from '../../defs/rules';
import { membersForHp, unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { angleDist, yawOf } from '../../math/angle';
import type { Vec2 } from '../../math/vec';
import type { PlayerId } from '../config';
import type { HitFacing } from '../events';
import { kaijuSwimming } from '../swim';
import type { CombatantRef, Hit, Kaiju, Unit, World } from '../types';
import { emit } from '../worldOps';

/** Slack for comparing accumulated tick time against a duration. */
const TIME_EPS = 1e-6;
/** Slack for angle thresholds, so a hit at exactly 60 degrees counts on every engine. */
const ANGLE_EPS = 1e-9;
/** Slack for "reached capacity", so ten hits of a tenth each add up. */
const VALUE_EPS = 1e-9;

/** Damage kinds that come from a kaiju's own body; everything else is weapon fire from a unit. */
const KAIJU_DAMAGE_KINDS: readonly DamageKind[] = ['swipe', 'stomp', 'thrown', 'beam', 'trample', 'wade', 'roar', 'blast', 'charge', 'tailSweep', 'collapse'];
/** Damage dealt a little every tick; its hit events are thinned out. */
const CONTINUOUS_KINDS: readonly DamageKind[] = ['beam', 'trample', 'wade'];

function hasDirection(dir: Vec2): boolean {
  return dir.x * dir.x + dir.z * dir.z > 1e-12;
}

/** Whether to report a hit of this kind this tick (continuous damage is sampled). */
function reportsHit(world: World, kind: DamageKind): boolean {
  return !CONTINUOUS_KINDS.includes(kind) || world.tick % COMBAT_RULES.continuousHitEventTicks === 0;
}

/** The tally of a kaiju player, or null when `player` is a human or nobody (units only have kaiju for enemies). */
function kaijuPlayerTally(world: World, player: PlayerId) {
  const p = world.players[player];
  return p && p.kaijuId >= 0 ? p.tally : null;
}

/**
 * Which side of the kaiju a hit from `fromDir` lands on (DESIGN.md section 3). `fromDir` points
 * from the kaiju toward the attacker. A hit with no direction counts as frontal.
 */
export function hitFacing(k: Kaiju, fromDir: Vec2): HitFacing {
  if (!hasDirection(fromDir)) return 'front';
  const profile = kaijuKindDef(k.kind).damage;
  const off = angleDist(yawOf(fromDir.x, fromDir.z), k.yaw);
  if (off <= profile.frontHalfAngle + ANGLE_EPS) return 'front';
  return off > profile.rearAngle + ANGLE_EPS ? 'rear' : 'flank';
}

// ---------------------------------------------------------------------------------------------
// Kaiju
// ---------------------------------------------------------------------------------------------

/**
 * Records a directional hit from a unit and reports whether it crosses another unit's recent
 * fire: returns that other unit's id, or -1. One entry per unit is kept (its latest hit).
 */
function crossfireWith(world: World, k: Kaiju, unit: number, yaw: number): number {
  const windowTicks = COMBAT_RULES.crossfireWindow * TICK_RATE;
  let other = -1;
  let own = -1;
  for (let i = k.recentHits.length - 1; i >= 0; i--) {
    const r = k.recentHits[i];
    if (world.tick - r.tick > windowTicks) {
      k.recentHits.splice(i, 1);
      if (own > i) own--;
      continue;
    }
    if (r.unit === unit) own = i;
    else if (angleDist(r.yaw, yaw) >= COMBAT_RULES.crossfireMinAngle - ANGLE_EPS) other = r.unit;
  }
  if (own >= 0) {
    k.recentHits[own].yaw = yaw;
    k.recentHits[own].tick = world.tick;
  } else {
    k.recentHits.push({ unit, yaw, tick: world.tick });
  }
  return other;
}

/**
 * Records a charged volley hit from a squad and forgets the ones that are too old to count.
 * One entry per squad is kept (its latest hit).
 */
function noteVolleyHit(world: World, k: Kaiju, squad: number): void {
  const windowTicks = COMBAT_RULES.volleyBreakWindow * TICK_RATE;
  let own = -1;
  for (let i = k.volleyHits.length - 1; i >= 0; i--) {
    const v = k.volleyHits[i];
    if (world.tick - v.tick > windowTicks) {
      k.volleyHits.splice(i, 1);
      if (own > i) own--;
    } else if (v.squad === squad) own = i;
  }
  if (own >= 0) k.volleyHits[own].tick = world.tick;
  else k.volleyHits.push({ squad, tick: world.tick });
}

/**
 * Whether the kaiju's nerve may break now: charged volleys from enough different squads have
 * hit it within the window (DESIGN.md section 3). A match with fewer squads still in the fight
 * than that (the rest wiped out) needs all it has left; with none nothing is asked.
 */
function volleysCanBreak(world: World, k: Kaiju): boolean {
  let standing = 0;
  for (const s of world.squads) if (!s.eliminated) standing++;
  const needed = Math.min(COMBAT_RULES.breakSquads, standing);
  if (needed <= 0) return true;
  const windowTicks = COMBAT_RULES.volleyBreakWindow * TICK_RATE;
  let squads = 0;
  for (const v of k.volleyHits) if (world.tick - v.tick <= windowTicks) squads++;
  return squads >= needed;
}

/** Breaks the kaiju's nerve: whatever it was doing is cut short and it is helpless for a while. */
function staggerKaiju(world: World, k: Kaiju, by: PlayerId): void {
  k.nerve = kaijuKindDef(k.kind).nerveCapacity;
  k.phase = 'stagger';
  k.action = 'none';
  k.phaseTime = 0;
  k.phaseDuration = COMBAT_RULES.staggerDuration;
  k.actionTime = 0;
  k.act.meal = false;
  k.act.beamLength = 0;
  k.act.beamBlocker = -1;
  k.act.chargeBlocked = false;
  k.act.actionButton = 0;
  world.match.breaks++;
  const breaker = world.players[by];
  if (breaker) breaker.tally.breaks++;
  emit(world, { type: 'nerveBreak', kaiju: k.id, x: k.x, z: k.z, by });
  emit(world, { type: 'kaijuStagger', kaiju: k.id, on: true, duration: COMBAT_RULES.staggerDuration });
}

function endStagger(world: World, k: Kaiju): void {
  k.phase = 'idle';
  k.action = 'none';
  k.phaseTime = 0;
  k.phaseDuration = 0;
  k.actionTime = 0;
  k.nerve = 0;
  k.nerveImmune = COMBAT_RULES.staggerNerveImmunity;
  emit(world, { type: 'kaijuStagger', kaiju: k.id, on: false, duration: COMBAT_RULES.staggerNerveImmunity });
}

function killKaiju(k: Kaiju): void {
  k.hp = 0;
  k.alive = false;
  k.phase = 'dead';
  k.action = 'none';
  k.phaseTime = 0;
  k.phaseDuration = 0;
  k.actionTime = 0;
  k.vx = 0;
  k.vz = 0;
  k.moltAvailable = false;
  k.forceMolt = false;
  k.act.actionButton = 0;
  k.act.beamLength = 0;
  k.act.beamBlocker = -1;
}

function hitKaiju(world: World, k: Kaiju, hit: Hit): void {
  if (!k.alive) return;
  const def = kaijuKindDef(k.kind);
  const profile = def.damage;
  const directional = hasDirection(hit.fromDir);
  const yaw = directional ? yawOf(hit.fromDir.x, hit.fromDir.z) : k.yaw;
  const off = directional ? angleDist(yaw, k.yaw) : 0;
  const facing = hitFacing(k, hit.fromDir);
  const facingMult = facing === 'front' ? profile.frontMult : facing === 'rear' ? profile.rearMult : profile.flankMult;

  const helpless = k.phase === 'stagger' || k.phase === 'cocoon';
  // The brace only covers the front arc, so a hit with no direction (a blast) gets no benefit.
  const braced = !helpless && k.phase === 'brace' && directional && off <= profile.braceHalfArc + ANGLE_EPS;
  const stateMult = helpless ? profile.helplessMult : braced ? profile.braceFrontMult : profile.normalMult;

  // Crossfire is judged for every directional hit from a unit, so fire that lands during a
  // stagger or an immunity window still sets up the next crossing shot.
  let crossedWith = -1;
  if (directional && hit.sourceId >= 0 && !KAIJU_DAMAGE_KINDS.includes(hit.kind)) {
    crossedWith = crossfireWith(world, k, hit.sourceId, yaw);
  }

  // So is a charged volley: one that lands just before the immunity runs out still counts as
  // its squad's part in the next break.
  if (hit.volleySquad !== undefined && hit.volleySquad >= 0) noteVolleyHit(world, k, hit.volleySquad);

  let nerve = 0;
  if (!helpless && k.nerveImmune <= 0 && hit.nerve > 0) {
    nerve = hit.nerve * facingMult * modMult(k.mods, 'nerveTaken');
    if (braced) nerve *= profile.braceNerveMult;
    if (hit.atWill) nerve *= COMBAT_RULES.atWillNerveMult;
    if (crossedWith >= 0) nerve *= COMBAT_RULES.crossfireNerveMult;
  }

  const damage = Math.max(0, hit.damage) * stateMult * facingMult * modMult(k.mods, 'damageTaken');
  const lost = Math.min(k.hp, damage);
  if (lost > 0) {
    k.hp -= lost;
    const gain = (lost / COMBAT_RULES.rageDamagePerPoint) * modMult(k.mods, 'rageGain');
    k.rage = Math.min(COMBAT_RULES.rageMax, k.rage + gain);
    const attacker = world.players[hit.player];
    if (attacker && attacker.kaijuId !== k.id) attacker.tally.damageDealt += lost;
  }
  if (nerve > 0) k.nerve += nerve;

  if ((lost > 0 || nerve > 0) && reportsHit(world, hit.kind)) {
    emit(world, {
      type: 'kaijuHit',
      kaiju: k.id,
      damage: lost,
      nerve,
      facing,
      cause: hit.kind,
      by: hit.player,
      braced,
    });
  }
  if (crossedWith >= 0 && nerve > 0) {
    const gapTicks = COMBAT_RULES.crossfireEventGap * TICK_RATE;
    if (world.tick - k.act.crossfireTick >= gapTicks) {
      k.act.crossfireTick = world.tick;
      emit(world, { type: 'crossfire', kaiju: k.id, unitA: hit.sourceId, unitB: crossedWith, x: k.x, z: k.z });
    }
  }

  if (k.hp <= 0) killKaiju(k);
  else if (nerve > 0 && k.nerve >= def.nerveCapacity - VALUE_EPS) {
    if (volleysCanBreak(world, k)) staggerKaiju(world, k, hit.player);
    // On the brink: it holds until the volleys of two squads come together.
    else k.nerve = def.nerveCapacity;
  }
}

/**
 * Heals a kaiju (eating). Returns the hp actually gained. Lives here so that every change to a
 * combatant's hp is in this file.
 */
export function healKaiju(k: Kaiju, amount: number): number {
  if (!k.alive || !(amount > 0)) return 0;
  const gain = Math.min(k.maxHp - k.hp, amount * modMult(k.mods, 'heal'));
  if (gain <= 0) return 0;
  k.hp += gain;
  return gain;
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/** Adds nerve damage to a unit and shakes it at capacity. A unit that is already shaken cannot get worse. */
function addUnitNerve(world: World, u: Unit, amount: number, by: PlayerId): void {
  if (!u.alive || u.shaken > 0 || !(amount > 0)) return;
  u.nerve += amount;
  if (u.nerve < COMBAT_RULES.unitNerveCapacity - VALUE_EPS) return;
  u.nerve = 0;
  u.shaken = COMBAT_RULES.shakenDuration;
  u.charge = 0;
  u.state = 'shaken';
  const tally = kaijuPlayerTally(world, by);
  if (tally) tally.breaks++;
  emit(world, { type: 'unitShaken', unit: u.id, duration: COMBAT_RULES.shakenDuration });
}

function destroyUnit(world: World, u: Unit, cause: DamageKind, by: PlayerId): void {
  const def = unitTypeDef(u.type);
  const squad = world.squads[u.squad];
  u.hp = 0;
  u.members = 0;
  u.alive = false;
  u.state = 'dead';
  // A dead vehicle stays where it died as a wreck the kaiju can pick up or eat.
  u.wreck = def.body === 'vehicle';
  u.nerve = 0;
  u.shaken = 0;
  u.stun = 0;
  u.charge = 0;
  u.rooted = false;
  u.vx = 0;
  u.vz = 0;
  u.control.moveX = 0;
  u.control.moveZ = 0;
  u.control.fire = false;

  world.match.kills++;
  const owner = world.players[squad.player];
  if (owner) owner.tally.unitsLost++;
  const tally = kaijuPlayerTally(world, by);
  if (tally) tally.kills++;
  if (squad.units.every((id) => !world.units[id].alive)) {
    squad.eliminated = true;
    squad.driven = -1;
  }
  emit(world, {
    type: 'unitDestroyed',
    unit: u.id,
    squad: u.squad,
    unitType: u.type,
    x: u.x,
    z: u.z,
    cause,
    by,
  });

  // Seeing a friend go down rattles everyone nearby.
  const r2 = COMBAT_RULES.friendlyLossRadius * COMBAT_RULES.friendlyLossRadius;
  for (const other of world.units) {
    if (!other.alive) continue;
    const dx = other.x - u.x;
    const dz = other.z - u.z;
    if (dx * dx + dz * dz > r2) continue;
    const mods = world.squads[other.squad].mods;
    addUnitNerve(world, other, COMBAT_RULES.friendlyLossNerve * modMult(mods, 'nerveTaken'), by);
  }
}

function hitUnit(world: World, u: Unit, hit: Hit): void {
  if (!u.alive) return;
  const def = unitTypeDef(u.type);
  const mods = world.squads[u.squad].mods;
  const damage = Math.max(0, hit.damage) * modMult(mods, 'damageTaken');
  const lost = Math.min(u.hp, damage);
  if (lost > 0) {
    u.hp -= lost;
    const tally = kaijuPlayerTally(world, hit.player);
    if (tally) tally.damageDealt += lost;
    if (reportsHit(world, hit.kind) || u.hp <= 0) {
      emit(world, { type: 'unitHit', unit: u.id, damage: lost, hp: u.hp, cause: hit.kind, x: u.x, z: u.z });
    }
    // Members fall one by one as hp drops (maxHp may be raised by upgrades; members follow the fraction).
    const members = membersForHp(def, (u.hp / u.maxHp) * def.hp);
    if (members < u.members) {
      emit(world, { type: 'memberLost', unit: u.id, count: u.members - members, members });
      u.members = members;
    }
  }
  if (u.hp <= 0) {
    destroyUnit(world, u, hit.kind, hit.player);
    return;
  }
  if (hit.resetsCharge) u.charge = 0;
  // roar stun: frozen for a moment; the shaking the same roar brings waits until it is over.
  if (hit.stun !== undefined && hit.stun > 0) stunUnit(world, u, hit.stun);
  if (hit.nerve > 0) addUnitNerve(world, u, hit.nerve * modMult(mods, 'nerveTaken'), hit.player);
}

/** A roar's stun (DESIGN.md section 4): it cannot move or fire, and its charge is gone. A longer stun is not cut shorter. */
function stunUnit(world: World, u: Unit, seconds: number): void {
  u.stun = Math.max(u.stun, seconds);
  u.charge = 0;
  // Its laser goes out with the charge (the orders system lets go of its plant).
  if (u.state === 'charging') u.state = 'idle';
  emit(world, { type: 'unitStunned', unit: u.id, duration: seconds });
}

// ---------------------------------------------------------------------------------------------
// The one door
// ---------------------------------------------------------------------------------------------

/**
 * Applies one hit, in raw numbers, to a kaiju or a unit: every multiplier, nerve, stagger,
 * shaken, death, rage, tallies and events follow from here. Dead targets ignore it.
 */
export function applyHit(world: World, target: CombatantRef, hit: Hit): void {
  if (target.entity === 'kaiju') {
    const k = world.kaijus[target.id];
    if (k) hitKaiju(world, k, hit);
  } else {
    const u = world.units[target.id];
    if (u) hitUnit(world, u, hit);
  }
}

/** Queues trample damage for every unit under a kaiju that is on the move. */
function queueTrample(world: World): void {
  const minSpeed2 = COMBAT_RULES.trampleMinSpeed * COMBAT_RULES.trampleMinSpeed;
  for (const k of world.kaijus) {
    if (!k.alive || k.phase === 'stagger' || k.phase === 'cocoon') continue;
    // Swimming, it tramples nobody (sim/swim.ts).
    if (kaijuSwimming(k)) continue;
    if (k.vx * k.vx + k.vz * k.vz < minSpeed2) continue;
    const dps = kaijuKindDef(k.kind).trampleDps * modMult(k.mods, 'unitDamage');
    if (!(dps > 0)) continue;
    for (const u of world.units) {
      // Aircraft above its head are out of reach.
      if (!u.alive || u.y > k.height) continue;
      const dx = k.x - u.x;
      const dz = k.z - u.z;
      const reach = k.radius + u.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      world.hits.push({
        target: { entity: 'unit', id: u.id },
        hit: {
          damage: dps * DT,
          nerve: 0,
          fromDir: d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 0 },
          sourceId: k.id,
          player: k.player,
          kind: 'trample',
          atWill: false,
        },
      });
    }
  }
}

export function damageSystem(world: World): void {
  const playing = world.match.phase === 'playing';
  if (playing) queueTrample(world);

  // Hits queued by a hit (none today) would be picked up in the same pass.
  for (let i = 0; i < world.hits.length; i++) applyHit(world, world.hits[i].target, world.hits[i].hit);
  world.hits.length = 0;

  if (!playing) return;

  for (const k of world.kaijus) {
    if (!k.alive) continue;
    if (k.hp <= 0) {
      killKaiju(k);
      continue;
    }
    if (k.nerveImmune > 0) k.nerveImmune = Math.max(0, k.nerveImmune - DT);
    if (k.phase === 'stagger') {
      // The kaiju action system counts phaseTime; the nerve stays broken until the stagger ends.
      if (k.phaseTime >= k.phaseDuration - TIME_EPS) endStagger(world, k);
    } else if (k.nerve > 0) {
      k.nerve = Math.max(0, k.nerve - kaijuKindDef(k.kind).nerveLeak * DT);
    }
  }

  for (const u of world.units) {
    if (!u.alive) continue;
    if (u.stun > 0) {
      // roar stun: its shaking (and the nerve leak) wait until the stun is over.
      u.stun = u.stun - DT > TIME_EPS ? u.stun - DT : 0;
    } else if (u.shaken > 0) {
      u.shaken = Math.max(0, u.shaken - DT);
      if (u.shaken <= TIME_EPS) {
        u.shaken = 0;
        if (u.state === 'shaken') u.state = 'idle';
      }
    } else if (u.nerve > 0) {
      u.nerve = Math.max(0, u.nerve - COMBAT_RULES.unitNerveLeak * DT);
    }
  }
}
