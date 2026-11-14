/**
 * System 6 of 11: weapons, volleys and call-ins (DESIGN.md section 5).
 *
 * Arcade handling: no ammunition, only cooldowns. A unit whose weapon is ready fires one salvo:
 * `shotsForMembers(weapon, members)` projectiles (a section's launchers, a troop's tanks) that
 * leave from points spread across its width. Every projectile is a real object launched with
 * `spawnProjectile`; the projectile system flies it and resolves what it hits.
 *
 * - The driven unit fires while its player holds Fire. Its shots go to the point where the
 *   player's aim ray (from the unit's eye, along the view) lands: on a kaiju, a structure, the
 *   ground, or far away along the ray when it meets nothing. A person's shots have no aim
 *   error. A bot's do (the weapon's at-will error) and count as fire at will.
 * - Range: every projectile a unit fires, whoever aimed it, gives out in the air once it has
 *   flown SQUAD_RULES.rangeSlack times the weapon's range (its `ttl`). Nothing else checks
 *   range for the driven unit or for a volley.
 * - The volley: each shot of the driven unit is the trigger. Every sub-unit that has charge,
 *   is not shaken, has its weapon ready, and whose firing arc covers the aim point fires at it
 *   with damage x(1 + charge), then loses its charge and its hold (the orders system plants it
 *   again on its spot the next tick, with a fresh arc). Nerve is what a volley is for, and it
 *   only rewards a charge that is nearly complete (`volleyStrength`): below
 *   COMBAT_RULES.volleyMinCharge the shot is ragged, worth the fire-at-will nerve multiplier
 *   and aimed with the at-will error; from there to a full charge the multiplier rises to
 *   x(1 + 2) and the error falls to the weapon's volley error. So holding Fire (the guns
 *   reload faster than the charge counts) is fire at will with the squad's shots on one
 *   target, and waiting for the charge is what breaks nerve.
 *   When the aim ray is on a kaiju the sub-units aim for the middle of its body at the height
 *   the player picked, so a shot from any side connects. A sub-unit whose arc does not reach
 *   the aim point keeps charging and does not fire: the kaiju can walk out of an arc, and the
 *   player answers by planting the squad again.
 *   A charged volley (at least one sub-unit at volleyMinCharge or more) emits `volley` and
 *   counts in the player's tally; its charged shots and the trigger shot are flagged `volley`
 *   (a bot's trigger shot then counts as volley fire), and only those count toward breaking
 *   the kaiju's nerve (systems/damage.ts).
 * - Fire at will: a sub-unit whose orders set `control.fire` shoots along its own aim with the
 *   weapon's at-will aim error; these projectiles are flagged `atWill` (half nerve damage).
 * - Aim error is one sigma, in radians, applied to heading and elevation of every projectile
 *   separately, multiplied by the scatter multipliers (`scatterMult`: stage, spotted, slowed)
 *   of the kaiju being shot at, by 0.7 for veterans, and by the squad's `aimError` modifier.
 * - Call-ins: a mission (started by the orders system) waits out its delay, then drops its
 *   shells over its duration within the scatter radius (times the scatter multipliers of the
 *   kaiju nearest the marker). The shells are 'arty' projectiles owned by the call-in (never
 *   crossfire) that fall steeply from `spawnHeight`, timed so the first one lands exactly
 *   `delay` seconds after the marker was placed. `callin` reports 'inbound' when the first
 *   shell is on its way and 'done' when the last one has landed.
 *
 * Cooldowns (`unit.cooldown`, `squad.callInCooldowns`) are counted down here.
 */

import { callInDef } from '../../defs/callins';
import type { CallInDef } from '../../defs/schema';
import { COMBAT_RULES, DT, SQUAD_RULES } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { projectileTypeDef, shotsForMembers, weaponDef } from '../../defs/weapons';
import { yawOf } from '../../math/angle';
import { rngGauss, rngInDisc } from '../../math/rng';
import { clamp } from '../../math/scalar';
import { MAX_AIM_PITCH } from '../../net/input';
import { createAimPoint, resolveAimPoint } from '../aim';
import { arcCovers, isChargedVolley, nearestKaiju, scatterMult, unitAimErrorMult, volleyStrength } from '../squads';
import { kaijuShownHeight } from '../swim';
import type { CallInMission, Squad, Unit, World } from '../types';
import { emit } from '../worldOps';
import { spawnProjectile } from './projectiles';

/** Slack for comparing counted-down timers against zero. */
const TIME_EPS = 1e-6;

const aim = createAimPoint();
const disc = { x: 0, z: 0 };
const volleyUnits: Unit[] = [];

/** One trigger pull of one unit. */
interface Salvo {
  /** Converge on this point; when false the salvo goes along the unit's own aim. */
  atPoint: boolean;
  x: number;
  y: number;
  z: number;
  /** One-sigma aim error, radians; 0 for a person's own shots. */
  error: number;
  damageMult: number;
  nerveMult: number;
  volley: boolean;
  atWill: boolean;
}

const salvo: Salvo = { atPoint: false, x: 0, y: 0, z: 0, error: 0, damageMult: 1, nerveMult: 1, volley: false, atWill: false };

function ready(u: Unit): boolean {
  return u.alive && u.shaken <= 0 && u.cooldown <= 0;
}

/** Fires one salvo of a unit's weapon and starts its cooldown. */
function fireSalvo(world: World, squad: Squad, u: Unit, s: Salvo): void {
  const type = unitTypeDef(u.type);
  const weapon = weaponDef(type.weapon);
  const proj = projectileTypeDef(weapon.projectile);
  const shots = shotsForMembers(weapon, u.members);
  const my = u.y + type.muzzleHeight;

  // The muzzles sit in a row across the unit, square to the line of fire.
  let facing = u.aimYaw;
  if (s.atPoint && Math.hypot(s.x - u.x, s.z - u.z) > 1e-3) facing = yawOf(s.x - u.x, s.z - u.z);
  const rx = -Math.cos(facing);
  const rz = Math.sin(facing);
  const spread = u.radius * SQUAD_RULES.muzzleSpread;

  // Range is the weapon's reach: the projectile gives out a little beyond it, whoever aimed it.
  const reach = weapon.range * modMult(squad.mods, 'weaponRange') * SQUAD_RULES.rangeSlack;
  const ttl = proj.speed > 0 ? Math.min(proj.ttl, reach / proj.speed) : proj.ttl;

  const damage = weapon.damage * s.damageMult * modMult(squad.mods, 'unitDamage');
  const nerve = weapon.nerve * s.nerveMult * modMult(squad.mods, 'nerveDamage');
  const structureDamage = weapon.structureDamage * modMult(squad.mods, 'structureDamage');

  for (let j = 0; j < shots; j++) {
    const off = (j - (shots - 1) / 2) * spread;
    const mx = u.x + rx * off;
    const mz = u.z + rz * off;
    let yaw = u.aimYaw;
    let pitch = u.aimPitch;
    if (s.atPoint) {
      const dx = s.x - mx;
      const dy = s.y - my;
      const dz = s.z - mz;
      const ground = Math.hypot(dx, dz);
      if (ground > 1e-3 || Math.abs(dy) > 1e-3) {
        if (ground > 1e-3) yaw = yawOf(dx, dz);
        pitch = Math.atan2(dy, ground);
      }
    }
    if (s.error > 0) {
      yaw += rngGauss(world.rng) * s.error;
      pitch += rngGauss(world.rng) * s.error;
    }
    pitch = clamp(pitch, -MAX_AIM_PITCH, MAX_AIM_PITCH);
    const cp = Math.cos(pitch);
    spawnProjectile(world, {
      type: weapon.projectile,
      flight: proj.flight,
      owner: 'unit',
      ownerId: u.id,
      player: squad.player,
      x: mx,
      y: my,
      z: mz,
      vx: Math.sin(yaw) * cp * proj.speed,
      vy: Math.sin(pitch) * proj.speed,
      vz: Math.cos(yaw) * cp * proj.speed,
      gravity: proj.gravity,
      ttl,
      damage,
      nerve,
      splash: weapon.splashRadius,
      structureDamage,
      cause: weapon.projectile,
      volley: s.volley,
      atWill: s.atWill,
      payload: null,
    });
  }
  u.cooldown = weapon.cooldown * modMult(squad.mods, 'weaponCooldown');
}

/** The driven unit fires, and takes every charged sub-unit that can bear with it. */
function fireLeader(world: World, squad: Squad, leader: Unit): void {
  const player = world.players[squad.player];
  const type = unitTypeDef(leader.type);
  const weapon = weaponDef(type.weapon);
  resolveAimPoint(
    world.cityQuery,
    leader.x,
    leader.y + type.eyeHeight,
    leader.z,
    leader.aimYaw,
    leader.aimPitch,
    SQUAD_RULES.aimRayRange,
    aim,
    world.kaijus,
  );
  const ax = aim.x;
  const ay = aim.y;
  const az = aim.z;
  const target = aim.on === 'kaiju' ? world.kaijus[aim.id] : nearestKaiju(world, ax, az);
  const scatter = scatterMult(world.match.stage, target);

  // What the sub-units shoot at: the aim point, or the middle of the kaiju the player is aiming at.
  let sx = ax;
  let sy = ay;
  let sz = az;
  if (aim.on === 'kaiju' && target) {
    sx = target.x;
    sy = clamp(ay, 0, kaijuShownHeight(target));
    sz = target.z;
  }

  // Who fires with the trigger, and whether any of them makes it a charged volley.
  volleyUnits.length = 0;
  let volley = false;
  for (const id of squad.units) {
    const u = world.units[id];
    if (id === squad.driven || !ready(u) || !(u.charge > 0) || !arcCovers(u, sx, sz)) continue;
    volleyUnits.push(u);
    if (isChargedVolley(u.charge)) volley = true;
  }

  salvo.atPoint = true;
  salvo.x = ax;
  salvo.y = ay;
  salvo.z = az;
  salvo.damageMult = 1;
  salvo.nerveMult = 1;
  salvo.volley = volley;
  // A bot at the trigger is no better a shot than a sub-unit, and its plinking is fire at will.
  salvo.atWill = player.bot && !volley;
  salvo.error = player.bot
    ? (volley ? weapon.aimErrorVolley : weapon.aimErrorAtWill) * unitAimErrorMult(squad, leader) * scatter
    : 0;
  fireSalvo(world, squad, leader, salvo);
  if (volleyUnits.length === 0) return;

  let charge = 0;
  const ids: number[] = [];
  const fullNerve = 1 + COMBAT_RULES.volleyNervePerCharge;
  for (const u of volleyUnits) {
    const w = weaponDef(unitTypeDef(u.type).weapon);
    // 0 for a ragged shot (worth what fire at will is worth) up to 1 at a full charge.
    const strength = volleyStrength(u.charge);
    salvo.x = sx;
    salvo.y = sy;
    salvo.z = sz;
    salvo.damageMult = 1 + COMBAT_RULES.volleyDamagePerCharge * u.charge;
    salvo.nerveMult = COMBAT_RULES.atWillNerveMult + (fullNerve - COMBAT_RULES.atWillNerveMult) * strength;
    salvo.volley = isChargedVolley(u.charge);
    salvo.atWill = false;
    salvo.error = (w.aimErrorAtWill + (w.aimErrorVolley - w.aimErrorAtWill) * strength) * unitAimErrorMult(squad, u) * scatter;
    fireSalvo(world, squad, u, salvo);
    charge += u.charge;
    ids.push(u.id);
    // Firing ends this hold: the orders system plants it again on its spot, with a fresh arc.
    u.charge = 0;
    u.rooted = false;
    u.state = 'idle';
  }
  // Ragged shots alone are not a volley: nothing to announce, nothing for the tally.
  if (!volley) return;
  player.tally.volleys++;
  emit(world, {
    type: 'volley',
    squad: squad.id,
    player: squad.player,
    units: ids,
    x: ax,
    y: ay,
    z: az,
    charge: charge / ids.length,
  });
}

/** A sub-unit shoots on its own, along its own aim. */
function fireAtWill(world: World, squad: Squad, u: Unit): void {
  const weapon = weaponDef(unitTypeDef(u.type).weapon);
  salvo.atPoint = false;
  salvo.damageMult = 1;
  salvo.nerveMult = 1;
  salvo.volley = false;
  salvo.atWill = true;
  salvo.error =
    weapon.aimErrorAtWill * unitAimErrorMult(squad, u) * scatterMult(world.match.stage, nearestKaiju(world, u.x, u.z));
  fireSalvo(world, squad, u, salvo);
}

// ---------------------------------------------------------------------------------------------
// Call-ins
// ---------------------------------------------------------------------------------------------

/**
 * Seconds a call-in shell takes from its release at `spawnHeight` to the ground: it leaves at
 * the projectile's speed, SQUAD_RULES.callInElevation below the horizon, and gravity adds to it.
 */
export function callInFallTime(def: CallInDef): number {
  const proj = projectileTypeDef(def.projectile);
  const down = proj.speed * Math.sin(SQUAD_RULES.callInElevation);
  const g = proj.gravity;
  if (g <= 0) return down > 0 ? def.spawnHeight / down : 0;
  return (Math.sqrt(down * down + 2 * g * def.spawnHeight) - down) / g;
}

function releaseShell(world: World, m: CallInMission, def: CallInDef, fall: number): void {
  const proj = projectileTypeDef(def.projectile);
  const squad = world.squads[m.squad];
  const scatter = def.scatterRadius * scatterMult(world.match.stage, nearestKaiju(world, m.x, m.z));
  rngInDisc(world.rng, scatter, disc);
  const tx = m.x + disc.x;
  const tz = m.z + disc.z;
  const along = proj.speed * Math.cos(SQUAD_RULES.callInElevation);
  const down = proj.speed * Math.sin(SQUAD_RULES.callInElevation);
  spawnProjectile(world, {
    type: def.projectile,
    flight: proj.flight,
    owner: 'callin',
    ownerId: m.id,
    player: m.player,
    // Released up-range, so that it comes down on the chosen point after `fall` seconds.
    x: tx - m.dirX * along * fall,
    y: def.spawnHeight,
    z: tz - m.dirZ * along * fall,
    vx: m.dirX * along,
    vy: -down,
    vz: m.dirZ * along,
    gravity: proj.gravity,
    ttl: proj.ttl,
    damage: def.damage * modMult(squad.mods, 'unitDamage'),
    nerve: def.nerve * modMult(squad.mods, 'nerveDamage'),
    splash: def.splashRadius,
    structureDamage: def.structureDamage * modMult(squad.mods, 'structureDamage'),
    cause: def.projectile,
    volley: false,
    atWill: false,
    payload: null,
  });
}

function callInEvent(world: World, m: CallInMission, def: CallInDef, phase: 'inbound' | 'done', delay: number): void {
  emit(world, {
    type: 'callin',
    id: m.id,
    callIn: m.callIn,
    squad: m.squad,
    player: m.player,
    x: m.x,
    z: m.z,
    phase,
    delay,
    radius: def.scatterRadius * scatterMult(world.match.stage, nearestKaiju(world, m.x, m.z)),
  });
}

/** Advances one mission by a tick. Returns false when it is over. */
function advanceCallIn(world: World, m: CallInMission): boolean {
  const def = callInDef(m.callIn);
  const fall = callInFallTime(def);
  m.timer -= DT;
  if (m.shellsLeft <= 0) {
    // Everything is in the air; the mission ends when the last shell has come down.
    if (m.timer > TIME_EPS) return true;
    callInEvent(world, m, def, 'done', 0);
    return false;
  }
  if (m.shellsLeft === def.shells) {
    // Not begun: the first shell goes when it has just enough time to land on the dot.
    if (m.timer > fall + TIME_EPS) return true;
    callInEvent(world, m, def, 'inbound', Math.max(0, m.timer));
    m.nextShell = 0;
  }
  // Shell n leaves on the first tick at or after n intervals from the start, so the barrage
  // keeps its length whatever the tick rate.
  const interval = def.shells > 1 ? def.duration / (def.shells - 1) : 0;
  while (m.shellsLeft > 0 && m.nextShell <= TIME_EPS) {
    releaseShell(world, m, def, fall);
    m.shellsLeft--;
    m.nextShell += interval;
  }
  m.nextShell -= DT;
  if (m.shellsLeft <= 0) m.timer = fall;
  return true;
}

export function weaponSystem(world: World): void {
  if (world.match.phase !== 'playing') return;

  for (const u of world.units) {
    if (!u.alive || u.cooldown <= 0) continue;
    u.cooldown -= DT;
    if (u.cooldown < TIME_EPS) u.cooldown = 0;
  }

  for (const squad of world.squads) {
    const cd = squad.callInCooldowns;
    for (let i = 0; i < cd.length; i++) {
      if (cd[i] <= 0) continue;
      cd[i] -= DT;
      if (cd[i] < TIME_EPS) cd[i] = 0;
    }
    if (squad.eliminated || squad.driven < 0) continue;

    const leader = world.units[squad.driven];
    if (leader.control.fire && ready(leader)) fireLeader(world, squad, leader);
    for (const id of squad.units) {
      const u = world.units[id];
      if (id === squad.driven || !u.control.fire || u.rooted || !ready(u)) continue;
      fireAtWill(world, squad, u);
    }
  }

  const missions = world.callIns;
  let kept = 0;
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i];
    if (advanceCallIn(world, m)) missions[kept++] = m;
  }
  missions.length = kept;
}
