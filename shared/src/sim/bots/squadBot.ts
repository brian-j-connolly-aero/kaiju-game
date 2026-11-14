/**
 * The human squad bot (DESIGN.md section 5, "Bots"). It leads a squad the way a person does:
 * it drives the leader with a stick and an aim, and has the same two buttons, Fire and the
 * volley. Its squad-mates follow it as a swarm and shoot on their own (the orders system); the
 * bot only decides when they plant and charge. The loop:
 *
 * - approach: drive to a firing position: a spot on a street at its own bearing around the
 *   kaiju, 50 to 90% of weapon range out, with a line of fire. Each squad keeps its bearing
 *   apart from the others', so their fire crosses. A tank is driven like a person drives one:
 *   the way it wants to go becomes throttle and hull turn (`setTankMove`).
 * - hold: stop there, hold the volley button (the squad-mates plant where they stand and
 *   charge), keep the crosshair on the kaiju, and let go at a full charge, waiting a moment for
 *   another squad that is nearly charged so the volleys land together. Then it holds again.
 *   Against a kaiju that is staggered or in its cocoon it does not charge: everybody fires as
 *   fast as the guns load. (With the harness profile `MatchConfig.bots.triggerHappy` it never
 *   charges: the lazy way to lead a squad.)
 * - retreat: when the kaiju comes close it lets go of the volley at once (whatever the charge
 *   is worth) and drives away, then starts over.
 * - search (kaiju not on the map: stage 1, or swimming): go to where it was last known (to the
 *   near bank when that was out in the water), then look around.
 * - a cocoon on the map is a target like any other, only better: the squad closes in on it.
 * - fire at will: whenever it is not charging a volley, the leader shoots when it has the
 *   kaiju in range and a clear line of fire.
 * - supply crates (phase 2): while the kaiju is not close and it is not charging, it fetches a
 *   crate coming down or lying within BOT_RULES.squad.crateRange of its leader (one no other
 *   bot squad is already going for), then goes back to work. With a weapon pick-up it parks in
 *   that weapon's band of range (the machine gun closer in, the big cannon and the missile pod
 *   at range); with the artillery radio it keeps volleying (even into a staggered or cocooned
 *   kaiju, and even as the lazy harness profile), since every charged volley calls a barrage.
 * - lines of fire count rubble and fallen buildings (up to their height), so it parks where it
 *   can shoot past them and moves on when one is in the way.
 *
 * It only knows what the humans' map shows (`kaiju.known`) and what it reads off its own
 * squad. It is deliberately beatable: it parks in plain sight and never guards a place the
 * kaiju is going to.
 *
 * Everything it does goes into `player.botInput`.
 */

import { castSegment, inWater } from '../../city/spatialIndex';
import type { CityData } from '../../city/types';
import { BOT_RULES } from '../../defs/bots';
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
import { BtnIndex, MAX_AIM_PITCH } from '../../net/input';
import { setTankMove, setWorldMove } from '../movement';
import { createSteer, steerToward } from '../nav';
import { formationSpacing, nearestKaiju, squadCharge } from '../squads';
import { kaijuShownHeight } from '../swim';
import type { Crate, Kaiju, PlayerState, Squad, Unit, World } from '../types';
import { beginBotInput, botHandicap, heldButtons, hesitates, press, releaseAll } from './common';
import type { BotState, SquadBotMode } from './types';

const S = BOT_RULES.squad;

/** Ticks the trigger is held for one shot. */
const TAP_TICKS = 2;
/** The leader has arrived within this many meters of its firing position. */
const ARRIVE = 3;
/** A firing position this close to where another squad stands or is going is crowded. */
const CROWD = 30;
const VOLLEY = BtnIndex.volley;

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
  mark.y = kaijuShownHeight(k) * h;
  mark.z = k.z;
  // Rubble and fallen buildings block it up to their height: the bot looks for a line round them.
  return !castSegment(world.cityQuery, muzzle, mark, undefined, -1, true, true);
}

const bank = { x: 0, z: 0 };

/**
 * The first dry ground on the way from (x, z) back toward (fromX, fromZ), in 4 m steps: the
 * point itself when it is dry, the near bank when it is out in the water.
 */
function bankToward(world: World, x: number, z: number, fromX: number, fromZ: number, out: { x: number; z: number }): void {
  const d = Math.hypot(fromX - x, fromZ - z);
  const steps = Math.floor(d / 4);
  out.x = x;
  out.z = z;
  for (let i = 0; i < steps && inWater(world.cityQuery, out.x, out.z); i++) {
    out.x = x + ((fromX - x) * (i + 1) * 4) / d;
    out.z = z + ((fromZ - z) * (i + 1) * 4) / d;
  }
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
  bs.mode = mode;
  bs.blind = 0;
  bs.waited = 0;
  bs.gather = 0;
  bs.crateTime = 0;
  if (mode !== 'crate') bs.crate = -1;
}

/** The supply crate with this id, while it is still coming down or lying there; else null. */
function crateById(world: World, id: number): Crate | null {
  for (const c of world.crates) if (c.id === id) return c;
  return null;
}

/**
 * A supply crate worth fetching: the nearest one coming down or lying within S.crateRange of
 * the leader that no other bot squad is already on its way to. Returns its id, or -1.
 */
function crateToFetch(world: World, squad: Squad, leader: Unit): number {
  let best = -1;
  let bestD: number = S.crateRange;
  for (const c of world.crates) {
    const d = Math.hypot(c.x - leader.x, c.z - leader.z);
    if (d > bestD) continue;
    let claimed = false;
    for (const other of world.squads) {
      if (other.id === squad.id) continue;
      const ob = botOf(world, other);
      if (ob && ob.mode === 'crate' && ob.crate === c.id) claimed = true;
    }
    if (claimed) continue;
    best = c.id;
    bestD = d;
  }
  return best;
}

/** Keeps the volley button down this tick (the squad-mates plant, or stay planted, and charge). */
function holdVolley(bs: BotState): void {
  bs.hold[VOLLEY] = 1;
  bs.rest[VOLLEY] = 0;
  bs.charging = true;
}

/** Lets go of the volley button (the squad fires with whatever charge it has). */
function letGoVolley(bs: BotState): void {
  bs.hold[VOLLEY] = 0;
  bs.charging = false;
  bs.waited = 0;
}

export function squadBot(world: World, p: PlayerState, squad: Squad): void {
  const input = beginBotInput(world, p);
  const bs = p.botState;
  if (world.match.phase !== 'playing' || squad.eliminated || squad.driven < 0) {
    releaseAll(bs);
    bs.charging = false;
    return;
  }
  const leader = world.units[squad.driven];
  if (!leader.alive) return;
  if (hesitates(world, bs, botHandicap(world, p))) {
    releaseAll(bs);
    bs.charging = false;
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
    bs.charging = false;
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
    bs.crate = -1;
    bs.crateTime = 0;
    releaseAll(bs);
  }

  const type = unitTypeDef(leader.type);
  const weapon = weaponDef(type.weapon);
  const range = weapon.range * modMult(squad.mods, 'weaponRange');
  // With a weapon pick-up it parks in that weapon's band: the machine gun closer in, the big
  // cannon and the missile pod at range.
  const band = squad.pickup !== 'none' ? S.pickupBand[squad.pickup] : null;
  const standoffMin = band ? band[0] : S.standoffMin;
  const standoff = band ? band[1] : S.standoff;
  const standoffMax = band ? band[2] : S.standoffMax;
  // With the artillery radio every charged volley calls a barrage: it keeps volleying.
  const radio = squad.barrages > 0;
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

    // A supply crate is worth a detour while the kaiju is not close (and not helpless: then it is the target).
    const calm = !known || (!helpless && dist > retreatDist * S.crateCalm);
    const fetch = bs.mode !== 'crate' && bs.mode !== 'retreat' && !bs.charging && calm ? crateToFetch(world, squad, leader) : -1;
    if (bs.mode === 'crate') bs.crateTime += S.think;
    if (known && dist < retreatDist && !helpless) {
      if (bs.mode !== 'retreat') bs.bearing = yawFromTo(k.x, k.z, leader.x, leader.z);
      setMode(bs, 'retreat');
    } else if (bs.mode === 'crate' && (!crateById(world, bs.crate) || !calm || bs.crateTime > S.crateGiveUp)) {
      // Taken (by us, or by somebody else), gone, or no time for it now.
      setMode(bs, known ? 'approach' : 'search');
    } else if (fetch >= 0) {
      setMode(bs, 'crate');
      bs.crate = fetch;
    } else if (bs.mode === 'crate') {
      // On its way to the crate.
    } else if (!known) {
      setMode(bs, 'search');
    } else if (bs.mode === 'retreat') {
      if (dist > Math.max(S.safeAt * range, retreatDist * 1.3)) setMode(bs, 'approach');
    } else if (bs.mode === 'search') {
      setMode(bs, 'approach');
    } else if (bs.mode === 'hold') {
      bs.blind = bs.los ? 0 : bs.blind + S.think;
      if (dist > (standoffMax + S.leaveAt - S.standoffMax) * range || bs.blind > S.losPatience) setMode(bs, 'approach');
    } else {
      // Approaching: anywhere in the band with a line of fire will do.
      const lo = helpless ? S.closeInMin : standoffMin;
      if (bs.los && dist >= lo * range && dist <= standoffMax * range) setMode(bs, 'hold');
    }

    if (bs.mode === 'crate') {
      const c = crateById(world, bs.crate);
      if (c) {
        bs.goalX = c.x;
        bs.goalZ = c.z;
      }
    } else if (bs.mode === 'approach') {
      const want = helpless ? S.closeInStandoff : standoff;
      const lo = helpless ? S.closeInMin : standoffMin;
      pickFiringSpot(world, squad, leader, bs, k, tx, tz, range, lo, standoffMax, want, false);
    } else if (bs.mode === 'retreat') {
      pickFiringSpot(world, squad, leader, bs, k, tx, tz, range, S.safeAt, 1.1, S.standoff, true);
    } else if (bs.mode === 'search') {
      const reached = Math.hypot(bs.goalX - leader.x, bs.goalZ - leader.z) < S.searchReach;
      if (!bs.lastChecked) {
        // Lost in the water (it swims, sim/swim.ts): wait on the bank nearest the leader rather
        // than wade out after it.
        bankToward(world, tx, tz, leader.x, leader.z, bank);
        bs.goalX = bank.x;
        bs.goalZ = bank.z;
        if (Math.hypot(bank.x - leader.x, bank.z - leader.z) < S.searchReach) bs.lastChecked = true;
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

  // --- Aim: at the kaiju when it is on the map, else where it is going ---------------------------
  const eyeY = leader.y + type.eyeHeight;
  let aimYaw = input.aimYaw;
  let aimPitch = 0;
  if (known) {
    const top = kaijuStageDef(k.kind, k.stage).topSpeed;
    const speed = Math.hypot(k.vx, k.vz);
    // Where on the body: the height the leader has a line to (the middle when it has none).
    const aimY = kaijuShownHeight(k) * (bs.aimHeight >= 0 ? bs.aimHeight : 0.5);
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
  if (moving) {
    // A tank is driven by throttle and hull turn; infantry goes where the stick points.
    if (type.drive) setTankMove(input, leader.yaw, steer.dirX, steer.dirZ, steer.throttle);
    else setWorldMove(input, steer.dirX, steer.dirZ, steer.throttle);
  }

  // --- The volley, and fire at will -----------------------------------------------------------------
  let mates = 0;
  let straggling = false;
  for (const id of squad.units) {
    const u = world.units[id];
    if (!u.alive || id === squad.driven) continue;
    mates++;
    if (!u.rooted && Math.hypot(u.x - leader.x, u.z - leader.z) > S.gatherSpacings * formationSpacing(u)) straggling = true;
  }
  // Parked, it lets the squad-mates come up before they plant (for a while: not for ever).
  if (bs.mode === 'hold' && !bs.charging && straggling && bs.gather < S.gatherWait) bs.gather += DT;
  const gathered = !straggling || bs.gather >= S.gatherWait;
  const lazy = world.config.bots?.triggerHappy === true;
  const volleying = known && bs.los && bs.mode === 'hold' && mates > 0 && (bs.charging || gathered) && (!helpless || radio) && (!lazy || radio);
  if (bs.charging && !volleying) {
    // Moving off (the kaiju came close, the line of fire went), or it is helpless: let go now.
    letGoVolley(bs);
  } else if (volleying) {
    if (squadCharge(world, squad) >= S.volleyCharge && bs.charging) {
      // Charged. Wait a moment for a neighbor that is nearly there, so the volleys land together.
      let waitFor = false;
      for (const other of world.squads) {
        if (other.id === squad.id || other.eliminated) continue;
        const ob = botOf(world, other);
        if (!ob || !ob.charging || !ob.los) continue;
        const c = squadCharge(world, other);
        if (c >= S.syncCharge && c < S.volleyCharge) waitFor = true;
      }
      bs.waited += DT;
      if (!waitFor || bs.waited >= S.syncWait) letGoVolley(bs);
      else holdVolley(bs);
    } else {
      holdVolley(bs);
    }
  }
  // Not charging a volley: the leader shoots whenever it has the kaiju in range and in its line of fire.
  if (!bs.charging && known && bs.los && leader.cooldown <= 0.05 && leader.shaken <= 0) press(bs, 'fire', TAP_TICKS);

  input.buttons = heldButtons(bs);
}
