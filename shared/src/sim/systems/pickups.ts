/**
 * System 6 of 12: army supply crates and pick-ups (docs/ROADMAP.md, phase 2; DESIGN.md section
 * 5, "Supply crates and pick-ups"; numbers in defs/pickups.ts, CRATE_RULES).
 *
 * - When a stage starts, a crate comes down for every squad, on a street near its leader; then
 *   one every CRATE_RULES.every seconds for the squads still in the fight in turn, while fewer
 *   than CRATE_RULES.maxDown are down. A crate comes down by parachute on a street inside the
 *   bounds, at least a third of the bounds' half-size from the kaiju, over CRATE_RULES.fallTime
 *   seconds (`crate` 'drop', then 'land'), and lies there until it is taken or the stage ends
 *   ('gone'). What it holds is drawn with the match's random numbers; reinforcements are likelier
 *   the more units the squad it is meant for has lost.
 * - Any living unit on the ground that comes within its radius plus CRATE_RULES.reach of a
 *   landed crate takes it for its squad (`crate` 'take'):
 *     machine gun, big cannon, missile pod   `squad.pickup`: the driven unit fires it instead of
 *                                            its own weapon (sim/systems/weapons.ts);
 *     artillery radio                        `squad.barrages`: the squad's next charged volleys
 *                                            each call a barrage (sim/systems/weapons.ts);
 *     reinforcements                         at once: every living unit healed to full, every
 *                                            dead one back at full strength, coming down by
 *                                            parachute beside the leader (`reinforce`; `unit.drop`
 *                                            and `unit.y` while it comes down).
 * - Pick-ups last until the stage ends (the molt) or the squad is wiped out.
 *
 * It runs after movement (units take what they have just driven onto) and before the weapons
 * (a weapon picked up fires on the same tick).
 */

import { circleHitsStructure, inWater, moundHeightAt } from '../../city/spatialIndex';
import type { CityData } from '../../city/types';
import { factionLevelDef } from '../../defs/factions';
import type { PickupKind } from '../../defs/ids';
import { CRATE_RULES, isWeaponPickup, pickupWeaponDef } from '../../defs/pickups';
import { DT } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { weaponDef } from '../../defs/weapons';
import { rngFloat, rngInt, rngWeightedIndex } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import { resetNav } from '../nav';
import { findClearSpot } from '../spawn';
import type { Crate, Squad, Unit, World } from '../types';
import { emit } from '../worldOps';

const TIME_EPS = 1e-6;
/** The kinds a crate can hold, in the order of their draw weights. */
const KINDS: readonly PickupKind[] = ['machineGun', 'bigCannon', 'missilePod', 'artilleryRadio', 'reinforcements'];
/** Streets are sampled this often (meters) for places a crate can come down. */
const STREET_STEP = 10;
/** A crate needs this much clear ground round it (meters), and keeps this far from another crate. */
const CRATE_ROOM = 2;
const CRATE_SPACING = 12;
/** Random places tried in a city with no streets in play (the hand-made cities of the tests). */
const OPEN_TRIES = 24;

const weights: number[] = [0, 0, 0, 0, 0];
const drop: Vec2 = { x: 0, z: 0 };
const spot: Vec2 = { x: 0, z: 0 };
const picks: number[] = [];

// ---------------------------------------------------------------------------------------------
// Where a crate comes down
// ---------------------------------------------------------------------------------------------

/** Points along every street (not the bridges), per city: the places a crate may come down. */
const streetCache = new WeakMap<CityData, Float64Array>();

function streetPoints(city: CityData): Float64Array {
  let pts = streetCache.get(city);
  if (!pts) {
    const out: number[] = [];
    const { nodes, edges } = city.roads;
    for (const e of edges) {
      if (e.kind === 'bridge' || e.bridge >= 0) continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(len / STREET_STEP));
      // The middle of the street from one crossroads to the next, the crossroads themselves left out.
      for (let i = 1; i < n; i++) out.push(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n);
    }
    pts = Float64Array.from(out);
    streetCache.set(city, pts);
  }
  return pts;
}

/** True when a crate may come down at (x, z): in the bounds, clear of the kaiju, dry, open, and not on another crate. */
function dropOk(world: World, x: number, z: number, kaijuClear: number): boolean {
  const b = world.match.bounds;
  const inset = CRATE_ROOM + 1;
  if (x < b.minX + inset || x > b.maxX - inset || z < b.minZ + inset || z > b.maxZ - inset) return false;
  for (const k of world.kaijus) {
    if (k.alive && (k.x - x) * (k.x - x) + (k.z - z) * (k.z - z) < kaijuClear * kaijuClear) return false;
  }
  for (const c of world.crates) {
    if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) < CRATE_SPACING * CRATE_SPACING) return false;
  }
  const q = world.cityQuery;
  return !inWater(q, x, z) && !circleHitsStructure(q, x, z, CRATE_ROOM) && moundHeightAt(q, x, z) === 0;
}

/**
 * Picks where a crate comes down (into `drop`): a street point near the leader of the squad it
 * is meant for, else any street point in the bounds, else (no streets in play) open ground at
 * random. Returns false when there is nowhere.
 */
function pickDropPoint(world: World, squad: Squad | null): boolean {
  const b = world.match.bounds;
  const kaijuClear = CRATE_RULES.kaijuClearShare * Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5;
  const leader = squad && squad.driven >= 0 ? world.units[squad.driven] : null;
  const pts = streetPoints(world.city);
  const [near, far] = CRATE_RULES.nearSquad;
  for (let pass = leader ? 0 : 1; pass < 2; pass++) {
    picks.length = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i];
      const z = pts[i + 1];
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (pass === 0 && leader) {
        const d2 = (x - leader.x) * (x - leader.x) + (z - leader.z) * (z - leader.z);
        if (d2 < near * near || d2 > far * far) continue;
      }
      if (!dropOk(world, x, z, kaijuClear)) continue;
      picks.push(i);
    }
    if (picks.length > 0) {
      const i = picks[rngInt(world.rng, picks.length)];
      drop.x = pts[i];
      drop.z = pts[i + 1];
      return true;
    }
  }
  for (let t = 0; t < OPEN_TRIES; t++) {
    const x = b.minX + rngFloat(world.rng) * (b.maxX - b.minX);
    const z = b.minZ + rngFloat(world.rng) * (b.maxZ - b.minZ);
    if (!dropOk(world, x, z, kaijuClear)) continue;
    drop.x = x;
    drop.z = z;
    return true;
  }
  return false;
}

/** What a crate meant for `squad` holds: reinforcements weigh more for every unit it has lost. */
function drawKind(world: World, squad: Squad | null): PickupKind {
  let lost = 0;
  if (squad) for (const id of squad.units) if (!world.units[id].alive) lost++;
  for (let i = 0; i < KINDS.length; i++) weights[i] = CRATE_RULES.weights[KINDS[i]];
  weights[4] += CRATE_RULES.reinforcePerLost * lost;
  return KINDS[Math.max(0, rngWeightedIndex(world.rng, weights))];
}

/**
 * Sends a crate down for a squad (null: for nobody in particular), on a street near its leader:
 * what the system does when a stage starts and every CRATE_RULES.every seconds. Exported for
 * tests and the sandbox. Returns the crate, or null when there is nowhere for it.
 */
export function dropCrate(world: World, squad: Squad | null): Crate | null {
  if (!pickDropPoint(world, squad)) return null;
  const crate: Crate = { id: world.nextCrateId++, kind: drawKind(world, squad), x: drop.x, z: drop.z, fall: CRATE_RULES.fallTime };
  world.crates.push(crate);
  emit(world, {
    type: 'crate',
    id: crate.id,
    kind: crate.kind,
    x: crate.x,
    z: crate.z,
    phase: 'drop',
    squad: squad ? squad.id : -1,
    unit: -1,
    player: -1,
    duration: CRATE_RULES.fallTime,
    height: CRATE_RULES.dropHeight,
  });
  return crate;
}

function crateEvent(world: World, c: Crate, phase: 'land' | 'gone'): void {
  emit(world, { type: 'crate', id: c.id, kind: c.kind, x: c.x, z: c.z, phase, squad: -1, unit: -1, player: -1, duration: 0, height: 0 });
}

// ---------------------------------------------------------------------------------------------
// Taking one
// ---------------------------------------------------------------------------------------------

/** Every dead unit of the squad back at full strength by parachute beside the leader, every living one healed. */
function reinforce(world: World, squad: Squad, leader: Unit): void {
  const def = unitTypeDef(factionLevelDef(squad.faction, world.match.stage).unitType);
  const healed: number[] = [];
  const units: number[] = [];
  const avoid: Array<{ x: number; z: number; radius: number }> = [];
  for (const u of world.units) if (u.alive) avoid.push({ x: u.x, z: u.z, radius: u.radius });
  for (const k of world.kaijus) if (k.alive) avoid.push({ x: k.x, z: k.z, radius: k.radius });
  for (const id of squad.units) {
    const u = world.units[id];
    if (!u.alive) continue;
    u.hp = u.maxHp;
    u.members = def.members;
    healed.push(id);
  }
  const spacing = 2 * def.radius + 3;
  for (const id of squad.units) {
    const u = world.units[id];
    if (u.alive) continue;
    // Beside and behind the leader, one place each, on open ground.
    const n = units.length;
    const side = n === 1 ? 1 : n === 2 ? 0 : -1;
    const back = n === 2 ? 2 : 1;
    const bx = Math.sin(leader.yaw);
    const bz = Math.cos(leader.yaw);
    const wantX = leader.x - bx * back * spacing - bz * side * spacing;
    const wantZ = leader.z - bz * back * spacing + bx * side * spacing;
    if (!findClearSpot(world.cityQuery, wantX, wantZ, def.radius, world.match.bounds, avoid, spot, true)) {
      findClearSpot(world.cityQuery, wantX, wantZ, def.radius, world.match.bounds, avoid, spot);
    }
    const hp = def.hp * modMult(squad.mods, 'maxHp');
    u.type = def.id;
    u.alive = true;
    u.radius = def.radius;
    u.x = spot.x;
    u.z = spot.z;
    u.vx = 0;
    u.vz = 0;
    u.yaw = leader.yaw;
    u.aimYaw = leader.aimYaw;
    u.aimPitch = 0;
    u.hp = hp;
    u.maxHp = hp;
    u.members = def.members;
    u.nerve = 0;
    u.shaken = 0;
    u.stun = 0;
    u.charge = 0;
    u.cooldown = 0;
    u.veteran = false;
    u.state = 'idle';
    u.rooted = false;
    resetNav(u.nav);
    u.inWater = inWater(world.cityQuery, u.x, u.z);
    u.wreck = false;
    u.drop = CRATE_RULES.reinforceTime;
    u.y = CRATE_RULES.reinforceHeight;
    u.control.moveX = 0;
    u.control.moveZ = 0;
    u.control.aimYaw = leader.aimYaw;
    u.control.aimPitch = 0;
    u.control.fire = false;
    avoid.push({ x: u.x, z: u.z, radius: u.radius });
    units.push(id);
  }
  emit(world, {
    type: 'reinforce',
    squad: squad.id,
    player: squad.player,
    units,
    healed,
    duration: CRATE_RULES.reinforceTime,
    height: CRATE_RULES.reinforceHeight,
  });
}

/** A unit takes a landed crate: what it holds is its squad's now. */
function take(world: World, c: Crate, u: Unit): void {
  const squad = world.squads[u.squad];
  emit(world, {
    type: 'crate',
    id: c.id,
    kind: c.kind,
    x: c.x,
    z: c.z,
    phase: 'take',
    squad: squad.id,
    unit: u.id,
    player: squad.player,
    duration: 0,
    height: 0,
  });
  if (isWeaponPickup(c.kind)) {
    squad.pickup = c.kind;
    // Its new gun is ready no later than a full reload of it.
    if (squad.driven >= 0) {
      const leader = world.units[squad.driven];
      const weapon = pickupWeaponDef(weaponDef(unitTypeDef(leader.type).weapon), c.kind);
      leader.cooldown = Math.min(leader.cooldown, weapon.cooldown * modMult(squad.mods, 'weaponCooldown'));
    }
  } else if (c.kind === 'artilleryRadio') {
    squad.barrages = CRATE_RULES.barrages;
  } else {
    // Beside the leader (or, the tick its leader has fallen, the unit that took it).
    const leader = squad.driven >= 0 && world.units[squad.driven].alive ? world.units[squad.driven] : u;
    reinforce(world, squad, leader);
  }
}

/** Hands every landed crate to the nearest unit touching it, if any. */
function takeCrates(world: World): void {
  for (let i = 0; i < world.crates.length; i++) {
    const c = world.crates[i];
    if (c.fall > 0) continue;
    let taker: Unit | null = null;
    let best = Infinity;
    for (const squad of world.squads) {
      if (squad.eliminated) continue;
      for (const id of squad.units) {
        const u = world.units[id];
        if (!u.alive || u.drop > 0) continue;
        const d = Math.hypot(u.x - c.x, u.z - c.z);
        if (d > u.radius + CRATE_RULES.reach || d >= best) continue;
        best = d;
        taker = u;
      }
    }
    if (!taker) continue;
    world.crates.splice(i--, 1);
    take(world, c, taker);
  }
}

// ---------------------------------------------------------------------------------------------
// The stage's supply
// ---------------------------------------------------------------------------------------------

/** The stage is over (or a new one began without an intermission): crates and pick-ups go, parachutes land. */
function clearSupply(world: World): void {
  for (const c of world.crates) crateEvent(world, c, 'gone');
  world.crates.length = 0;
  for (const squad of world.squads) {
    squad.pickup = 'none';
    squad.barrages = 0;
  }
  for (const u of world.units) {
    if (u.drop <= 0) continue;
    u.drop = 0;
    u.y = 0;
  }
}

/** A stage has begun: a crate for every squad, and the timed drops from now on. */
function startSupply(world: World): void {
  clearSupply(world);
  const s = world.supply;
  s.stage = world.match.stage;
  s.timer = CRATE_RULES.every;
  s.turn = 0;
  if (world.config.crates === false) return;
  for (const squad of world.squads) if (!squad.eliminated) dropCrate(world, squad);
}

/** The next squad still in the fight to get a timed drop, turn by turn; null when none is left. */
function nextSquad(world: World): Squad | null {
  const n = world.squads.length;
  for (let k = 0; k < n; k++) {
    const squad = world.squads[(world.supply.turn + k) % n];
    if (squad.eliminated) continue;
    world.supply.turn = (squad.id + 1) % n;
    return squad;
  }
  return null;
}

/** Parachutes come down at a steady speed; a unit that died on the way down lies on the ground. */
function lowerParachutes(world: World): void {
  for (const u of world.units) {
    if (u.drop <= 0) continue;
    if (!u.alive) {
      u.drop = 0;
      u.y = 0;
      continue;
    }
    u.drop = u.drop - DT > TIME_EPS ? u.drop - DT : 0;
    u.y = u.drop > 0 ? (CRATE_RULES.reinforceHeight * u.drop) / CRATE_RULES.reinforceTime : 0;
  }
}

export function pickupSystem(world: World): void {
  const m = world.match;
  if (m.phase === 'intermission') {
    // The molt ended the stage: nothing is left lying about (or hanging in the air) for the next one.
    if (world.crates.length > 0 || world.squads.some((s) => s.pickup !== 'none' || s.barrages > 0) || world.units.some((u) => u.drop > 0)) {
      clearSupply(world);
    }
    return;
  }
  if (m.phase !== 'playing') return;
  if (world.supply.stage !== m.stage) startSupply(world);

  lowerParachutes(world);
  // A squad wiped out loses its pick-ups (it comes back at the next stage without them).
  for (const squad of world.squads) {
    if (!squad.eliminated) continue;
    squad.pickup = 'none';
    squad.barrages = 0;
  }

  for (const c of world.crates) {
    if (c.fall <= 0) continue;
    c.fall = c.fall - DT > TIME_EPS ? c.fall - DT : 0;
    if (c.fall === 0) crateEvent(world, c, 'land');
  }

  const s = world.supply;
  s.timer -= DT;
  if (s.timer <= TIME_EPS) {
    s.timer += CRATE_RULES.every;
    if (world.config.crates !== false && world.crates.length < CRATE_RULES.maxDown[m.stage - 1]) {
      const squad = nextSquad(world);
      if (squad) dropCrate(world, squad);
    }
  }

  takeCrates(world);
}
