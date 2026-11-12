/**
 * The human squad bot (DESIGN.md section 5, "Bots"). It leads a squad the way a person does:
 * it drives the leader with a stick and an aim, gives the four wheel commands, pulls the
 * trigger and (at level 3) marks artillery. The loop:
 *
 * - approach: order 'follow' and 'fire at will', drive to a firing position: a spot on a
 *   street at its own bearing around the kaiju, 60 to 80% of weapon range out, with a line of
 *   fire. Each squad keeps its bearing apart from the others', so their fire crosses.
 * - hold: stop, order 'hold fire and charge' (the sub-units plant where they stand), keep the
 *   crosshair on the kaiju, and fire the volley when the charge is full, waiting a moment for
 *   another squad that is nearly charged so the volleys land together. Against a kaiju that is
 *   staggered or in its cocoon it fires as fast as the guns load. (With the harness profile
 *   `MatchConfig.bots.triggerHappy` it always does: the lazy way to lead a squad.)
 * - retreat: when the kaiju comes close it un-parks and drives away, then starts over.
 * - search (stage 1, kaiju not on the map): go to where it was last known, then look around.
 * - a cocoon on the map is a target like any other, only better: the squad closes in on it.
 * - artillery: marked a little ahead of the kaiju whenever it is ready and the kaiju is near.
 *
 * It only knows what the humans' map shows (`kaiju.known`) and what it reads off its own
 * squad. It is deliberately beatable: it parks in plain sight, it is slow to notice that the
 * kaiju has walked out of its arcs, and it never guards a place the kaiju is going to.
 *
 * Everything it does goes into `player.botInput`.
 */

import { castSegment } from '../../city/spatialIndex';
import type { CityData } from '../../city/types';
import { BOT_RULES } from '../../defs/bots';
import { factionLevelDef } from '../../defs/factions';
import { kaijuStageDef } from '../../defs/kaiju/index';
import { DT, SQUAD_RULES } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { projectileTypeDef, weaponDef } from '../../defs/weapons';
import { angleDiff, angleDist, yawFromTo } from '../../math/angle';
import { boundsContains } from '../../math/geom';
import { rngInt } from '../../math/rng';
import { clamp } from '../../math/scalar';
import type { Vec3 } from '../../math/vec';
import { MAX_AIM_PITCH } from '../../net/input';
import { setWorldMove } from '../movement';
import { createSteer, steerToward } from '../nav';
import { arcCovers, nearestKaiju, squadCharge } from '../squads';
import type { Kaiju, PlayerState, Squad, Unit, World } from '../types';
import { beginBotInput, botHandicap, heldButtons, hesitates, press, releaseAll } from './common';
import type { BotState, SquadBotMode } from './types';

const S = BOT_RULES.squad;

/** Ticks the trigger is held for one shot. */
const TAP_TICKS = 2;
/** The leader has arrived within this many meters of its firing position. */
const ARRIVE = 3;
/** A firing position this close to where another squad stands or is going is crowded. */
const CROWD = 30;

const steer = createSteer();
const muzzle: Vec3 = { x: 0, y: 0, z: 0 };
const mark: Vec3 = { x: 0, y: 0, z: 0 };

/** Places a squad could park: every crossroads and the middle of every street, per city. */
const spotCache = new WeakMap<CityData, Float64Array>();

function parkingSpots(city: CityData): Float64Array {
  let spots = spotCache.get(city);
  if (!spots) {
    const { nodes, edges } = city.roads;
    spots = new Float64Array((nodes.length + edges.length) * 2);
    let i = 0;
    for (const n of nodes) {
      spots[i++] = n.x;
      spots[i++] = n.z;
    }
    for (const e of edges) {
      spots[i++] = (nodes[e.a].x + nodes[e.b].x) / 2;
      spots[i++] = (nodes[e.a].z + nodes[e.b].z) / 2;
    }
    spotCache.set(city, spots);
  }
  return spots;
}

/**
 * The height on the kaiju's body (a fraction of its height, from SQUAD_RULES.aimHeights) that a
 * gun at (x, z), `height` above the ground, has a clear line to; -1 when it has none.
 */
function lineOfFire(world: World, x: number, z: number, height: number, k: Kaiju): number {
  for (const h of SQUAD_RULES.aimHeights) {
    if (lineOfFireAt(world, x, z, height, k, h)) return h;
  }
  return -1;
}

/** True when that gun has a clear line to the kaiju's body at the fraction `h` of its height. */
function lineOfFireAt(world: World, x: number, z: number, height: number, k: Kaiju, h: number): boolean {
  muzzle.x = x;
  muzzle.y = height;
  muzzle.z = z;
  mark.x = k.x;
  mark.y = k.height * h;
  mark.z = k.z;
  return !castSegment(world.cityQuery, muzzle, mark, undefined, -1, true);
}

function botOf(world: World, squad: Squad): BotState | null {
  const p = world.players[squad.player];
  return p && p.bot ? p.botState : null;
}

/** Turns this squad's bearing away from the squads before it, until they are spread around the kaiju. */
function spreadBearing(world: World, squad: Squad, bs: BotState): void {
  for (const other of world.squads) {
    if (other.id >= squad.id || other.eliminated) continue;
    const ob = botOf(world, other);
    if (!ob || ob.stage !== bs.stage) continue;
    const off = angleDiff(bs.bearing, ob.bearing);
    if (Math.abs(off) >= S.bearingSpread) continue;
    bs.bearing += (off >= 0 ? 1 : -1) * 0.2;
  }
}

const candCost: number[] = [];
const candX: number[] = [];
const candZ: number[] = [];

/**
 * Chooses where to drive to: a parking spot between `lo` and `hi` of weapon range from the
 * target point, near the squad's bearing, not far to drive, not on top of another squad, and
 * (when the kaiju is on the map) with a line of fire. Falls back to the point on its bearing.
 */
function pickFiringSpot(
  world: World,
  squad: Squad,
  leader: Unit,
  bs: BotState,
  k: Kaiju | null,
  tx: number,
  tz: number,
  range: number,
  lo: number,
  hi: number,
  want: number,
  fleeing: boolean,
): void {
  const b = world.match.bounds;
  const inset = leader.radius + 2;
  const spots = parkingSpots(world.city);
  const toKaijuX = tx - leader.x;
  const toKaijuZ = tz - leader.z;
  const toKaiju = Math.hypot(toKaijuX, toKaijuZ) || 1;
  const height = unitTypeDef(leader.type).muzzleHeight;
  candCost.length = 0;
  candX.length = 0;
  candZ.length = 0;

  for (let i = 0; i < spots.length; i += 2) {
    const x = spots[i];
    const z = spots[i + 1];
    if (!boundsContains(b, x, z, inset)) continue;
    const d = Math.hypot(x - tx, z - tz);
    if (d < lo * range || d > hi * range) continue;
    const lx = x - leader.x;
    const lz = z - leader.z;
    const drive = Math.hypot(lx, lz);
    // Running away, it does not run past the thing it is running from.
    if (fleeing && drive > 1 && (lx * toKaijuX + lz * toKaijuZ) / (drive * toKaiju) > 0.3) continue;
    let cost = angleDist(yawFromTo(tx, tz, x, z), bs.bearing) * 0.6 * range + Math.abs(d - want * range) * 0.5 + drive * 0.35;
    for (const other of world.squads) {
      if (other.id === squad.id || other.eliminated || other.driven < 0) continue;
      const ol = world.units[other.driven];
      const ob = botOf(world, other);
      if (Math.hypot(ol.x - x, ol.z - z) < CROWD || (ob && Math.hypot(ob.goalX - x, ob.goalZ - z) < CROWD)) cost += 0.4 * range;
    }
    // Keep the best few, cheapest first.
    let at = candCost.length;
    while (at > 0 && candCost[at - 1] > cost) at--;
    if (at >= S.spotCandidates) continue;
    candCost.splice(at, 0, cost);
    candX.splice(at, 0, x);
    candZ.splice(at, 0, z);
    if (candCost.length > S.spotCandidates) {
      candCost.length = S.spotCandidates;
      candX.length = S.spotCandidates;
      candZ.length = S.spotCandidates;
    }
  }

  if (candCost.length === 0) {
    // No street in the band (a small or empty stage): the point on its bearing will have to do.
    bs.goalX = clamp(tx + Math.sin(bs.bearing) * want * range, b.minX + inset, b.maxX - inset);
    bs.goalZ = clamp(tz + Math.cos(bs.bearing) * want * range, b.minZ + inset, b.maxZ - inset);
    return;
  }
  let pick = 0;
  if (k) {
    for (let i = 0; i < candCost.length; i++) {
      if (lineOfFire(world, candX[i], candZ[i], height, k) < 0) continue;
      pick = i;
      break;
    }
  }
  bs.goalX = candX[pick];
  bs.goalZ = candZ[pick];
}

function setMode(bs: BotState, mode: SquadBotMode): void {
  if (bs.mode === mode) return;
  const wasHold = bs.mode === 'hold';
  bs.mode = mode;
  bs.blind = 0;
  bs.waited = 0;
  if (mode === 'hold') {
    bs.wheel.length = 0;
    bs.wheel.push('holdCharge');
    bs.parked = true;
  } else if (wasHold || bs.parked) {
    // Un-park: the sub-units fall in behind, still holding their fire (stray shots are the
    // kaiju's gain; the squad shoots when it is parked and has a line).
    bs.wheel.length = 0;
    bs.wheel.push('follow');
    bs.parked = false;
  }
}

export function squadBot(world: World, p: PlayerState, squad: Squad): void {
  const input = beginBotInput(world, p);
  const bs = p.botState;
  if (world.match.phase !== 'playing' || squad.eliminated || squad.driven < 0) {
    releaseAll(bs);
    bs.wheel.length = 0;
    return;
  }
  const leader = world.units[squad.driven];
  if (!leader.alive) return;
  if (hesitates(world, bs, botHandicap(world, p))) {
    releaseAll(bs);
    return;
  }
  const k = nearestKaiju(world, leader.x, leader.z);
  if (!k) return;

  const b = world.match.bounds;
  if (bs.stage !== world.match.stage) {
    // A fresh deployment: a fresh mind. Its bearing is where it stands, seen from the kaiju
    // (or from the middle of the bounds while nobody knows where the kaiju is).
    bs.stage = world.match.stage;
    bs.mode = 'approach';
    bs.parked = false;
    // Hold fire from the start: 'hold and charge' sets the fire mode, 'follow' gets them moving.
    bs.wheel.length = 0;
    bs.wheel.push('holdCharge', 'follow');
    bs.wheelTimer = 0;
    bs.lastX = k.known ? k.x : (b.minX + b.maxX) / 2;
    bs.lastZ = k.known ? k.z : (b.minZ + b.maxZ) / 2;
    bs.lastChecked = false;
    bs.bearing = yawFromTo(bs.lastX, bs.lastZ, leader.x, leader.z);
    bs.goalX = leader.x;
    bs.goalZ = leader.z;
    // Squads take turns thinking.
    bs.thinkTimer = (squad.id % 4) * 0.1;
    bs.blind = 0;
    bs.waited = 0;
    bs.los = false;
    bs.callInTimer = 2 + squad.id;
    releaseAll(bs);
  }

  const type = unitTypeDef(leader.type);
  const weapon = weaponDef(type.weapon);
  const range = weapon.range * modMult(squad.mods, 'weaponRange');
  const known = k.known;
  if (known) {
    bs.lastX = k.x;
    bs.lastZ = k.z;
    bs.lastChecked = false;
  }
  const tx = bs.lastX;
  const tz = bs.lastZ;
  const dist = Math.hypot(tx - leader.x, tz - leader.z);
  const helpless = known && (k.phase === 'stagger' || k.phase === 'cocoon');
  const retreatDist = Math.max(S.retreatAt * range, S.retreatRadii * k.radius + S.retreatMargin);

  // --- Think ------------------------------------------------------------------------------------
  bs.thinkTimer -= DT;
  if (bs.thinkTimer <= 0) {
    bs.thinkTimer = S.think;
    bs.aimHeight = known && dist - k.radius <= range ? lineOfFire(world, leader.x, leader.z, leader.y + type.muzzleHeight, k) : -1;
    bs.los = bs.aimHeight >= 0;
    if (bs.los && bs.mode === 'hold') {
      // A volley is the whole squad's: most of the planted guns need a clear line too, or the
      // shells go into the houses in between.
      let planted = 0;
      let clear = 0;
      for (const id of squad.units) {
        const u = world.units[id];
        if (!u.alive || id === squad.driven || !u.rooted) continue;
        planted++;
        if (lineOfFireAt(world, u.x, u.z, u.y + unitTypeDef(u.type).muzzleHeight, k, bs.aimHeight)) clear++;
      }
      if (planted > 0 && clear < planted * S.clearLines) bs.los = false;
    }
    spreadBearing(world, squad, bs);

    if (known && dist < retreatDist && !helpless) {
      if (bs.mode !== 'retreat') bs.bearing = yawFromTo(k.x, k.z, leader.x, leader.z);
      setMode(bs, 'retreat');
    } else if (!known) {
      setMode(bs, 'search');
    } else if (bs.mode === 'retreat') {
      if (dist > Math.max(S.safeAt * range, retreatDist * 1.3)) setMode(bs, 'approach');
    } else if (bs.mode === 'search') {
      setMode(bs, 'approach');
    } else if (bs.mode === 'hold') {
      bs.blind = bs.los ? 0 : bs.blind + S.think;
      if (dist > S.leaveAt * range || bs.blind > S.losPatience) setMode(bs, 'approach');
    } else {
      // Approaching: anywhere in the band with a line of fire will do.
      const lo = helpless ? S.closeInMin : S.standoffMin;
      if (bs.los && dist >= lo * range && dist <= S.standoffMax * range) setMode(bs, 'hold');
    }

    if (bs.mode === 'approach') {
      const want = helpless ? S.closeInStandoff : S.standoff;
      const lo = helpless ? S.closeInMin : S.standoffMin;
      pickFiringSpot(world, squad, leader, bs, k, tx, tz, range, lo, S.standoffMax, want, false);
    } else if (bs.mode === 'retreat') {
      pickFiringSpot(world, squad, leader, bs, k, tx, tz, range, S.safeAt, 1.1, S.standoff, true);
    } else if (bs.mode === 'search') {
      const reached = Math.hypot(bs.goalX - leader.x, bs.goalZ - leader.z) < S.searchReach;
      if (!bs.lastChecked) {
        bs.goalX = tx;
        bs.goalZ = tz;
        if (dist < S.searchReach) bs.lastChecked = true;
      } else if (reached) {
        // Nothing here: look somewhere else inside the line.
        const spots = parkingSpots(world.city);
        for (let tries = 0; tries < 8 && spots.length > 0; tries++) {
          const i = rngInt(world.rng, spots.length / 2) * 2;
          if (!boundsContains(b, spots[i], spots[i + 1], leader.radius + 2)) continue;
          bs.goalX = spots[i];
          bs.goalZ = spots[i + 1];
          break;
        }
      }
    }
  }

  // --- Wheel commands, one at a time -------------------------------------------------------------
  if (bs.wheelTimer > 0) bs.wheelTimer -= DT;
  else if (bs.wheel.length > 0) {
    input.wheel = bs.wheel.shift();
    bs.wheelTimer = S.commandGap;
  }

  // --- Aim: at the kaiju when it is on the map, else where it is going ---------------------------
  const eyeY = leader.y + type.eyeHeight;
  let aimYaw = input.aimYaw;
  let aimPitch = 0;
  if (known) {
    const top = kaijuStageDef(k.kind, k.stage).topSpeed;
    const speed = Math.hypot(k.vx, k.vz);
    // Where on the body: the height the leader has a line to (the middle when it has none).
    const aimY = k.height * (bs.aimHeight >= 0 ? bs.aimHeight : 0.5);
    if (speed < S.stillSpeed * top || helpless) {
      aimYaw = yawFromTo(leader.x, leader.z, k.x, k.z);
      aimPitch = Math.atan2(aimY - eyeY, Math.max(dist, 1));
    } else {
      // On the move: aim where it will be when the shots arrive. At a small kaiju that is a
      // point on the ground (the shots fly low and the splash does the rest); at a tall one it
      // is the same height on its body, and whatever is behind is the backstop.
      const t = dist / projectileTypeDef(weapon.projectile).speed;
      const px = k.x + k.vx * t;
      const pz = k.z + k.vz * t;
      const pd = Math.max(Math.hypot(px - leader.x, pz - leader.z), 1);
      aimYaw = yawFromTo(leader.x, leader.z, px, pz);
      aimPitch = aimY > eyeY + 1 ? Math.atan2(aimY - eyeY, pd) : Math.atan2(-eyeY, pd);
    }
  }

  // --- Drive --------------------------------------------------------------------------------------
  let moving = false;
  if (bs.mode !== 'hold') {
    steerToward(world, leader, bs.goalX, bs.goalZ, ARRIVE, steer);
    if (steer.throttle > 0) {
      moving = true;
      if (!known) aimYaw = Math.atan2(steer.dirX, steer.dirZ);
    }
  }
  input.aimYaw = aimYaw;
  input.aimPitch = clamp(aimPitch, -MAX_AIM_PITCH, MAX_AIM_PITCH);
  if (moving) setWorldMove(input, steer.dirX, steer.dirZ, steer.throttle);

  // --- Trigger ------------------------------------------------------------------------------------
  const canShoot = known && bs.los && leader.cooldown <= 0.05 && leader.shaken <= 0;
  if (canShoot) {
    let subs = 0;
    let planted = 0;
    let covering = 0;
    for (const id of squad.units) {
      const u = world.units[id];
      if (!u.alive || id === squad.driven) continue;
      subs++;
      if (!u.rooted) continue;
      planted++;
      if (arcCovers(u, k.x, k.z)) covering++;
    }
    if (subs === 0 || helpless) {
      // Alone, or with the kaiju helpless: every shot counts, take it.
      press(bs, 'fire', TAP_TICKS);
    } else if (bs.mode !== 'hold') {
      // On the move it holds its fire: a leader plinking from the saddle mostly hits houses.
    } else if (planted === 0) {
      // The order to hold has only just gone out: nobody has planted yet.
    } else if (covering < planted * S.replantUncovered) {
      // It has walked out of the arcs: plant the squad again, facing it.
      if (bs.wheel.length === 0) bs.wheel.push('holdCharge');
    } else if (world.config.bots?.triggerHappy) {
      // The lazy way (a harness profile): never mind the charge, shoot whenever the gun has loaded.
      press(bs, 'fire', TAP_TICKS);
    } else if (squadCharge(world, squad) >= S.volleyCharge) {
      // Charged. Wait a moment for a neighbor that is nearly there, so the volleys land together.
      let waitFor = false;
      for (const other of world.squads) {
        if (other.id === squad.id || other.eliminated) continue;
        const ob = botOf(world, other);
        if (!ob || !ob.parked || !ob.los) continue;
        const c = squadCharge(world, other);
        if (c >= S.syncCharge && c < S.volleyCharge) waitFor = true;
      }
      bs.waited += DT;
      if (!waitFor || bs.waited >= S.syncWait) {
        if (press(bs, 'fire', TAP_TICKS)) bs.waited = 0;
      }
    }
  }

  // --- Artillery, when the squad has it ---------------------------------------------------------
  if (bs.callInTimer > 0) bs.callInTimer -= DT;
  else if (known && dist < S.callInRange * range && factionLevelDef(squad.faction, world.match.stage).callIns.length > 0 && (squad.callInCooldowns[0] ?? 1) <= 0) {
    if (press(bs, 'callIn', TAP_TICKS, 15)) {
      input.marker = {
        x: clamp(k.x + k.vx * S.callInLead, b.minX, b.maxX),
        z: clamp(k.z + k.vz * S.callInLead, b.minZ, b.maxZ),
      };
      bs.callInTimer = 2;
    }
  }

  input.buttons = heldButtons(bs);
}
