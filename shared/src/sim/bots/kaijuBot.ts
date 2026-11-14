/**
 * The kaiju bot (DESIGN.md section 5, "Bots"). It plays through the same input a person sends:
 * a heading, a stick and buttons. What it does with them:
 *
 * - Wrecking. It goes for whatever standing structure (or valuable prop) pays best for the time
 *   it takes to reach and bring down: bar value over travel time plus the swipes it needs.
 *   Small things it simply walks through; what it must hit it swipes, or stomps when several
 *   things stand around it. That is "roams toward the densest standing value" without a map:
 *   rich blocks win, and so does the tower three streets away when the street it is on is flat.
 * - Squads. It fights units that come close, takes revenge on the nearest squad for a while
 *   after its nerve breaks, and throws what is at hand at a squad in range.
 * - The moves it picked at its molts (one press per move, on its two move buttons): the beam
 *   on units in reach (else on something big) when the rage is there; the roar when guns
 *   charge close by (it stuns them); the charge at a unit in the open, or through a row of
 *   buildings it can smash on the way to what it is wrecking; the tail sweep at units behind
 *   it; the brace when enough charged lasers are on it.
 * - Eating when hurt: what is in the hand, what lies in reach (a grab and then a bite, or a
 *   bite straight off the ground), or after a short walk to a car.
 * - The molt: when it may, it looks for a place where fewer guns can see it, for a few seconds
 *   at most, and cocoons there with one press. In the cocoon it looks at the molt cards for a
 *   moment and picks one (`BOT_RULES.kaiju.cardWeights`, with some randomness).
 * - Swimming (sim/swim.ts): in trouble (its nerve near breaking, badly hurt) with deep water
 *   close by, it slips into the water and swims away from the squads for a few seconds, then
 *   goes back to work (it earns nothing in the water).
 *
 * It is deliberately beatable: it reacts to what is on top of it, never plans a route, and can
 * be baited away from the city by a squad that knows how.
 *
 * Everything it knows it reads from the World; everything it does goes into `player.botInput`.
 */

import { PROP_KINDS } from '../../city/props';
import { castSegment, distToStructure, lineOfSight, propsInCircle, structuresInCircle } from '../../city/spatialIndex';
import { BOT_RULES } from '../../defs/bots';
import { perStage, type KaijuVerb, type StageId } from '../../defs/ids';
import { kaijuKindDef, kaijuMoveSlot, kaijuStageDef } from '../../defs/kaiju/index';
import { DT } from '../../defs/rules';
import type { KaijuKindDef, KaijuStageDef } from '../../defs/schema';
import { LAST_STAGE } from '../../defs/stages';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { projectileTypeDef, weaponDef } from '../../defs/weapons';
import { angleDist, wrapAngle, yawFromTo, yawOf } from '../../math/angle';
import { boundsContains, circleInArc, obbInArc } from '../../math/geom';
import { rngRange, rngWeightedIndex } from '../../math/rng';
import { clamp, lerp } from '../../math/scalar';
import type { Vec3 } from '../../math/vec';
import { Btn, MAX_AIM_PITCH, type PlayerInput } from '../../net/input';
import { findEdible, findGrabTarget } from '../kaijuEffects';
import { laserOnKaiju } from '../squads';
import { unitSeesKaiju } from '../spotting';
import { canSwimAt, deepWaterAt, swimDef } from '../swim';
import type { Kaiju, PlayerState, Unit, World } from '../types';
import { beginBotInput, botHandicap, busyWith, heldButtons, hesitates, press, releaseAll } from './common';
import type { BotState } from './types';

const R = BOT_RULES.kaiju;

/** Ticks a press lasts (one move per button: every press is a tap). */
const TAP_TICKS = 2;
/** Turns tried to get round something it cannot break, smallest first (radians). */
const DEFLECTIONS = [Math.PI / 6, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3];
/** It presses the next strike this long before the last one's recovery ends (inside the input buffer). */
const CHAIN_LEAD = 0.12;
/** The body must face this close to a target before a throw or a beam is started (the head leads by at most 50 degrees). */
const FACE_ANGLE = (40 * Math.PI) / 180;
/** Hiding places are looked for on this many rings of this many points around the kaiju. */
const HIDE_RINGS = 4;
const HIDE_SPOKES = 12;
/** Props are looked for within this many meters (and this many radii). */
const PROP_SEARCH = 45;

const ids: number[] = [];
const propIds: number[] = [];
const seen: number[] = [];
const eye: Vec3 = { x: 0, y: 0, z: 0 };
const mark: Vec3 = { x: 0, y: 0, z: 0 };

function weaponRangeOf(world: World, u: Unit): number {
  return weaponDef(unitTypeDef(u.type).weapon).range * modMult(world.squads[u.squad].mods, 'weaponRange');
}

/** Seconds of swiping (and wading) it takes to bring a structure down from `hp`. 0 for what it tramples. */
function killTime(def: KaijuKindDef, st: KaijuStageDef, k: Kaiju, height: number, passable: boolean, hp: number): number {
  if (height <= st.trampleHeight) return 0;
  const swipe = def.actions.swipe;
  const dmg = perStage(swipe.structureDamage, k.stage) * modMult(k.mods, 'structureDamage');
  const cycle = swipe.timing.windup + swipe.timing.active + swipe.timing.recover;
  if (st.wadesTall && !passable) return hp / (dmg / cycle + st.wadeContactDps);
  return Math.ceil(hp / dmg) * cycle;
}

// ---------------------------------------------------------------------------------------------
// Looking: what is around (done a few times a second; the answers are kept in the bot state)
// ---------------------------------------------------------------------------------------------

/** Counts the lasers on the kaiju and whether any gun in range can see it. */
function lookAtSquads(world: World, k: Kaiju, bs: BotState): void {
  let lasers = 0;
  let charge = 0;
  let sx = 0;
  let sz = 0;
  let exposed = false;
  for (const u of world.units) {
    if (!u.alive) continue;
    if (!exposed && unitSeesKaiju(world, u, k, weaponRangeOf(world, u))) exposed = true;
    if (!laserOnKaiju(world, u, k)) continue;
    lasers++;
    if (u.charge > charge) charge = u.charge;
    const d = Math.hypot(u.x - k.x, u.z - k.z) || 1;
    sx += (u.x - k.x) / d;
    sz += (u.z - k.z) / d;
  }
  bs.lasers = lasers;
  bs.laserCharge = charge;
  bs.laserYaw = lasers > 0 && sx * sx + sz * sz > 1e-6 ? yawOf(sx, sz) : k.yaw;
  bs.exposed = exposed;
}

/** Picks what to wreck next: the structure or prop with the best value for the time it costs. */
function chooseWreckGoal(world: World, k: Kaiju, bs: BotState): void {
  const def = kaijuKindDef(k.kind);
  const st = kaijuStageDef(k.kind, k.stage);
  const index = world.cityIndex;
  const b = world.match.bounds;
  const speed = st.topSpeed * modMult(k.mods, 'speed');
  const maxKill = perStage(R.maxKillTime, k.stage);

  let best = -1;
  let bestScore = 0;
  let currentScore = 0;
  for (const s of world.city.structures) {
    const hp = world.structureHp[s.id];
    if (hp <= 0 || s.id === bs.avoidId) continue;
    if (!boundsContains(b, s.x, s.z)) continue;
    const kill = killTime(def, st, k, s.height, s.passable, hp);
    if (kill > maxKill) continue;
    const dist = distToStructure(index, s.id, k.x, k.z);
    // What it tramples it must walk through; what it hits it only has to reach.
    const travel = (kill === 0 ? dist + Math.min(s.hx, s.hz) : Math.max(0, dist - k.radius)) / speed;
    const score = (s.value * hp) / s.hp / (travel + kill + R.travelBias);
    if (bs.goal === 'structure' && s.id === bs.goalId) currentScore = score;
    if (score > bestScore) {
      bestScore = score;
      best = s.id;
    }
  }

  // Cars and kiosks in the street are worth the detour while the kaiju is small. With no
  // building left to go for, it looks for them as far as the bounds reach.
  let bestProp = -1;
  if (k.stage < LAST_STAGE) {
    const reach = best >= 0 ? Math.max(PROP_SEARCH, 6 * k.radius) : Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
    propsInCircle(world.cityQuery, k.x, k.z, reach, propIds);
    for (const id of propIds) {
      const value = PROP_KINDS[world.city.props[id].kind].value;
      if (!(value > 0) || !boundsContains(b, index.px[id], index.pz[id], k.radius)) continue;
      const dist = Math.hypot(index.px[id] - k.x, index.pz[id] - k.z);
      const score = value / (dist / speed + R.travelBias);
      if (bs.goal === 'prop' && id === bs.goalId) currentScore = score;
      if (score > bestScore) {
        bestScore = score;
        bestProp = id;
        best = -1;
      }
    }
  }

  // Stay with what it is doing unless the new thing is clearly better.
  if ((bs.goal === 'structure' || bs.goal === 'prop') && currentScore > 0 && bestScore < currentScore * R.switchGain) {
    bs.goalScore = currentScore;
    return;
  }
  bs.goalBest = Infinity;
  bs.goalStall = 0;
  if (bestProp >= 0) {
    bs.goal = 'prop';
    bs.goalId = bestProp;
    bs.goalX = index.px[bestProp];
    bs.goalZ = index.pz[bestProp];
  } else if (best >= 0) {
    bs.goal = 'structure';
    bs.goalId = best;
    bs.goalX = index.sx[best];
    bs.goalZ = index.sz[best];
  } else {
    // Nothing left that it can break: wander toward the middle of the bounds.
    bs.goal = 'point';
    bs.goalId = -1;
    bs.goalX = (b.minX + b.maxX) / 2;
    bs.goalZ = (b.minZ + b.maxZ) / 2;
  }
  bs.goalScore = bestScore;
}

/** Looks for ground where fewer guns can see it than here; leaves the goal there. Returns false when here is as good as anywhere. */
function chooseHidingPlace(world: World, k: Kaiju, bs: BotState): boolean {
  const b = world.match.bounds;
  const st = kaijuStageDef(k.kind, k.stage);
  // The body it will come out with needs room there too (one that wades needs none).
  const next = k.stage < LAST_STAGE ? kaijuStageDef(k.kind, (k.stage + 1) as StageId) : null;
  const grown = next && !next.wadesTall ? next : null;
  const reach = R.hideRadii * k.radius;
  const sightHeight = k.height * 0.7;
  const seenFrom = (x: number, z: number): number => {
    let n = 0;
    mark.x = x;
    mark.y = sightHeight;
    mark.z = z;
    for (const u of world.units) {
      if (!u.alive) continue;
      const range = weaponRangeOf(world, u) + k.radius;
      if ((u.x - x) * (u.x - x) + (u.z - z) * (u.z - z) > range * range) continue;
      eye.x = u.x;
      eye.y = u.y + unitTypeDef(u.type).eyeHeight;
      eye.z = u.z;
      if (lineOfSight(world.cityQuery, eye, mark, true)) n++;
    }
    return n;
  };
  let bestSeen = seenFrom(k.x, k.z);
  if (bestSeen === 0) return false;
  let bestDist = Infinity;
  let found = false;
  // Rings of points around it, out to `reach`: the lee of a building is rarely on a crossroads.
  for (let ring = 1; ring <= HIDE_RINGS; ring++) {
    const d = (reach * ring) / HIDE_RINGS;
    for (let i = 0; i < HIDE_SPOKES; i++) {
      const a = ((i + (ring % 2) * 0.5) / HIDE_SPOKES) * Math.PI * 2;
      const x = k.x + Math.sin(a) * d;
      const z = k.z + Math.cos(a) * d;
      if (!boundsContains(b, x, z, k.radius + 1)) continue;
      // It has to be able to stand there: nothing it cannot walk through.
      structuresInCircle(world.cityQuery, x, z, k.radius, ids);
      let free = true;
      for (const id of ids) {
        if (world.cityIndex.spassable[id] === 0 && world.cityIndex.sheight[id] > st.trampleHeight) free = false;
      }
      if (free && grown) {
        structuresInCircle(world.cityQuery, x, z, grown.bodyRadius, ids);
        for (const id of ids) {
          if (world.cityIndex.spassable[id] === 0 && world.cityIndex.sheight[id] > grown.trampleHeight) free = false;
        }
      }
      if (!free) continue;
      const seen = seenFrom(x, z);
      if (seen < bestSeen || (found && seen === bestSeen && d < bestDist)) {
        bestSeen = seen;
        bestDist = d;
        bs.goalX = x;
        bs.goalZ = z;
        found = true;
      }
    }
  }
  if (found) {
    bs.goal = 'hide';
    bs.goalId = -1;
    bs.goalBest = Infinity;
    bs.goalStall = 0;
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------------------------

/**
 * The first standing structure that would stop the body within `look` meters along a heading
 * and that it will not simply smash on the way (too tough, or told to leave alone); -1 when the
 * way is open. What it tramples, bridge decks and `allow` never count.
 */
function hardBlocker(world: World, k: Kaiju, def: KaijuKindDef, st: KaijuStageDef, dirX: number, dirZ: number, look: number, allow: number): number {
  const index = world.cityIndex;
  const step = Math.max(1, k.radius * 0.75);
  for (let d = step; d <= look + 1e-6; d += step) {
    structuresInCircle(world.cityQuery, k.x + dirX * d, k.z + dirZ * d, k.radius * 0.9, ids);
    for (const id of ids) {
      if (id === allow || index.spassable[id] === 1 || index.sheight[id] <= st.trampleHeight) continue;
      if (killTime(def, st, k, index.sheight[id], false, world.structureHp[id]) <= R.smashInWay) continue;
      return id;
    }
  }
  return -1;
}

/**
 * The heading to walk to get to (gx, gz): straight at it when the way is open (or only things
 * it will smash stand in it), otherwise the smallest turn that is clear, kept to the same side
 * until the way opens again.
 */
function steer(world: World, k: Kaiju, bs: BotState, gx: number, gz: number, allow: number): number {
  const dx = gx - k.x;
  const dz = gz - k.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return k.yaw;
  const yaw = yawOf(dx, dz);
  const st = kaijuStageDef(k.kind, k.stage);
  if (st.wadesTall) return yaw;
  const def = kaijuKindDef(k.kind);
  const look = Math.min(d, Math.max(3 * k.radius, 10));
  if (hardBlocker(world, k, def, st, dx / d, dz / d, look, allow) < 0) {
    if (bs.side !== 0) {
      bs.sideTime -= DT;
      if (bs.sideTime <= 0) bs.side = 0;
    }
    return yaw;
  }
  bs.sideTime = 0.6;
  const sides = bs.side !== 0 ? [bs.side, -bs.side] : [1, -1];
  for (const turn of DEFLECTIONS) {
    for (const side of sides) {
      const a = yaw + turn * side;
      if (hardBlocker(world, k, def, st, Math.sin(a), Math.cos(a), look, allow) >= 0) continue;
      bs.side = side;
      return a;
    }
    // With a side chosen, exhaust it before trying the other.
    if (bs.side !== 0) continue;
  }
  return yaw;
}

// ---------------------------------------------------------------------------------------------
// Swimming away (sim/swim.ts)
// ---------------------------------------------------------------------------------------------

const SWIM_RINGS = 4;
const SWIM_SPOKES = 16;

/** Distance from (x, z) to the nearest living unit. */
function unitDistance(world: World, x: number, z: number): number {
  let best = Infinity;
  for (const u of world.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - x, u.z - z);
    if (d < best) best = d;
  }
  return best;
}

/** True when the straight line from a to b runs through water deep enough all the way (every 3 m). */
function deepAllTheWay(world: World, ax: number, az: number, bx: number, bz: number, fit: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 3));
  for (let i = 1; i <= n; i++) {
    if (!deepWaterAt(world.cityQuery, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, fit)) return false;
  }
  return true;
}

/**
 * Where to swim: on dry land, the deep water nearest to it that is far from the squads; in the
 * water, the stretch it can swim to in a straight line that is farthest from every unit.
 * Writes bs.swimX, bs.swimZ; false when there is no such water.
 */
function chooseSwimPoint(world: World, k: Kaiju, bs: BotState, inWaterNow: boolean): boolean {
  const swim = swimDef(k.kind, k.stage);
  if (!swim) return false;
  const fit = perStage(swim.fitRadii, k.stage) * k.radius;
  const b = world.match.bounds;
  const reach = (inWaterNow ? perStage(R.swimLegRadii, k.stage) : perStage(R.swimSearchRadii, k.stage)) * k.radius;
  let best = -Infinity;
  let found = false;
  for (let ring = 1; ring <= SWIM_RINGS; ring++) {
    const d = (reach * ring) / SWIM_RINGS;
    for (let i = 0; i < SWIM_SPOKES; i++) {
      const a = ((i + (ring % 2) * 0.5) / SWIM_SPOKES) * Math.PI * 2;
      const x = k.x + Math.sin(a) * d;
      const z = k.z + Math.cos(a) * d;
      // Getting in, a point a little way out from the bank, so that it is under when it gets there.
      const need = inWaterNow ? fit : fit + Math.min(0.5 * k.radius, 2);
      if (!boundsContains(b, x, z, k.radius + 1) || !deepWaterAt(world.cityQuery, x, z, need)) continue;
      if (inWaterNow && !deepAllTheWay(world, k.x, k.z, x, z, fit)) continue;
      // In the water: as far from the guns as it can get. Getting in: near, and not into them.
      const score = Math.min(unitDistance(world, x, z), 400) - (inWaterNow ? 0 : d * 1.5);
      if (score > best) {
        best = score;
        bs.swimX = x;
        bs.swimZ = z;
        found = true;
      }
    }
  }
  return found;
}

/**
 * Whether it is swimming away this tick (then bs.swimX, bs.swimZ is where to go). It starts
 * under pressure when there is deep water within reach, and stops after R.swimMax seconds.
 */
function swimAway(world: World, k: Kaiju, bs: BotState, thinking: boolean): boolean {
  if (bs.swimRest > 0) bs.swimRest -= DT;
  if (!swimDef(k.kind, k.stage)) {
    bs.swimFor = 0;
    return false;
  }
  if (bs.swimFor <= 0) {
    if (!thinking || bs.swimRest > 0 || k.held) return false;
    const pressure = k.nerve >= R.swimNerve * kaijuKindDef(k.kind).nerveCapacity || (bs.exposed && k.hp < k.maxHp * R.swimBelow);
    if (!pressure || !chooseSwimPoint(world, k, bs, canSwimAt(world.cityQuery, k, k.x, k.z))) return false;
    bs.swimFor = R.swimMax;
  }
  bs.swimFor -= DT;
  if (bs.swimFor <= 0) {
    // Long enough: back to work, and not into the water again for a while.
    bs.swimFor = 0;
    bs.swimRest = R.swimRest;
    bs.goal = 'none';
    return false;
  }
  const inWaterNow = canSwimAt(world.cityQuery, k, k.x, k.z);
  const arrived = Math.hypot(bs.swimX - k.x, bs.swimZ - k.z) < Math.max(3, k.radius);
  if (inWaterNow && (thinking || arrived)) chooseSwimPoint(world, k, bs, true);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Striking
// ---------------------------------------------------------------------------------------------

interface StrikeWorth {
  swipe: number;
  stomp: number;
}
const worth: StrikeWorth = { swipe: 0, stomp: 0 };

/** What a swipe along `yaw` and a stomp here would be worth right now, in bar points (units count as R.unitWorth each). */
function strikeWorth(world: World, k: Kaiju, def: KaijuKindDef, st: KaijuStageDef, yaw: number): StrikeWorth {
  const index = world.cityIndex;
  const swipe = def.actions.swipe;
  const stomp = def.actions.stomp;
  const structMult = modMult(k.mods, 'structureDamage');
  const swipeRange = swipe.reach * k.radius;
  const swipeDmg = perStage(swipe.structureDamage, k.stage) * structMult;
  const stompRadius = stomp.radius * k.radius;
  const stompDmg = perStage(stomp.structureDamage, k.stage) * structMult;
  worth.swipe = 0;
  worth.stomp = 0;

  structuresInCircle(world.cityQuery, k.x, k.z, Math.max(swipeRange, stompRadius), ids);
  for (const id of ids) {
    // What it tramples is not worth a blow: it will be walked through.
    if (index.sheight[id] <= st.trampleHeight && index.spassable[id] === 0) continue;
    const s = world.city.structures[id];
    const hp = world.structureHp[id];
    const dist = distToStructure(index, id, k.x, k.z);
    if (dist < swipeRange && obbInArc(s, k.x, k.z, yaw, swipe.arc / 2, swipeRange)) {
      worth.swipe += (s.value * Math.min(hp, swipeDmg)) / s.hp;
    }
    if (dist < stompRadius) {
      const dmg = stompDmg * lerp(1, stomp.structureEdgeFraction, Math.min(1, dist / stompRadius));
      worth.stomp += (s.value * Math.min(hp, dmg)) / s.hp;
    }
  }
  for (const u of world.units) {
    if (!u.alive || u.y > k.height) continue;
    if (circleInArc(u.x, u.z, u.radius, k.x, k.z, yaw, swipe.arc / 2, swipeRange)) worth.swipe += R.unitWorth;
    const edge = Math.max(0, Math.hypot(u.x - k.x, u.z - k.z) - u.radius);
    if (edge <= stompRadius) worth.stomp += R.unitWorth * lerp(1, 0.4, edge / stompRadius);
  }
  propsInCircle(world.cityQuery, k.x, k.z, stompRadius, propIds);
  for (const id of propIds) worth.stomp += PROP_KINDS[world.city.props[id].kind].value;
  return worth;
}

/**
 * A standing structure right in front of the body along a heading that it cannot walk through
 * (so it must be hit to get past); -1 when there is none.
 */
function wallAhead(world: World, k: Kaiju, st: KaijuStageDef, yaw: number): number {
  const index = world.cityIndex;
  const reach = k.radius + 1;
  structuresInCircle(world.cityQuery, k.x + Math.sin(yaw) * reach, k.z + Math.cos(yaw) * reach, k.radius * 0.9, ids);
  for (const id of ids) {
    if (index.spassable[id] === 0 && index.sheight[id] > st.trampleHeight) return id;
  }
  return -1;
}

/** True when the kaiju can start (or queue) a new action now. */
function canAct(k: Kaiju): boolean {
  if (k.phase === 'idle') return true;
  return k.phase === 'recover' && k.phaseDuration - k.phaseTime <= CHAIN_LEAD;
}

/** Swipes or stomps (each its own button) when either is worth something; returns whether it struck. */
function strike(world: World, k: Kaiju, bs: BotState, def: KaijuKindDef, st: KaijuStageDef, yaw: number): boolean {
  if (!canAct(k) || busyWith(bs, 'strike') || busyWith(bs, 'stomp')) return false;
  const w = strikeWorth(world, k, def, st, yaw);
  if (w.swipe <= 0 && w.stomp <= 0) return false;
  const swipeTime = def.actions.swipe.timing.windup + def.actions.swipe.timing.active + def.actions.swipe.timing.recover;
  const stompTime = def.actions.stomp.timing.windup + def.actions.stomp.timing.active + def.actions.stomp.timing.recover;
  press(bs, w.stomp / stompTime > (w.swipe / swipeTime) * R.stompBias ? 'stomp' : 'strike', TAP_TICKS);
  return true;
}

// ---------------------------------------------------------------------------------------------
// The moves picked at the molts
// ---------------------------------------------------------------------------------------------

/** The move button a verb is on, or null when the kaiju has not picked that move. */
function moveButton(k: Kaiju, verb: KaijuVerb): 'move1' | 'move2' | null {
  const slot = kaijuMoveSlot(k.moves, verb);
  return slot === 0 ? 'move1' : slot === 1 ? 'move2' : null;
}

/** The move button of a move it has picked and can use now (off cooldown), or null. */
function readyMove(k: Kaiju, bs: BotState, verb: KaijuVerb): 'move1' | 'move2' | null {
  const button = moveButton(k, verb);
  if (!button || k.cooldowns[verb] > 0 || busyWith(bs, button)) return null;
  return button;
}

/** The molt cards: a moment to look at them, then a pick by preference, with some randomness. */
function chooseCard(world: World, k: Kaiju, bs: BotState, input: PlayerInput): void {
  if (bs.cardWait < 0) bs.cardWait = rngRange(world.rng, R.cardThink[0], R.cardThink[1]);
  bs.cardWait -= DT;
  if (bs.cardWait > 0) return;
  const weights = k.offer.map((m) => (m === 'none' ? 0 : R.cardWeights[m]));
  input.card = rngWeightedIndex(world.rng, weights) + 1;
  // Should the pick not land, it looks again a little later.
  bs.cardWait = R.cardThink[1];
}

/**
 * How far a charge along a heading could run before something it cannot smash stops it (up to
 * `length`), and what it would smash on the way (bar points of the buildings taller than it
 * walks through, each counted once).
 */
function chargeLine(world: World, k: Kaiju, def: KaijuKindDef, st: KaijuStageDef, yaw: number, length: number, out: { clear: number; worth: number }): void {
  const index = world.cityIndex;
  const smash = perStage(def.actions.charge.smashHeight, k.stage);
  const step = Math.max(1, k.radius * 0.75);
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const b = world.match.bounds;
  seen.length = 0;
  out.clear = length;
  out.worth = 0;
  for (let d = step; d <= length + 1e-6; d += step) {
    const x = k.x + dx * d;
    const z = k.z + dz * d;
    if (!boundsContains(b, x, z, k.radius)) {
      out.clear = d - step;
      return;
    }
    structuresInCircle(world.cityQuery, x, z, k.radius * 0.9, ids);
    for (const id of ids) {
      if (index.spassable[id] === 1 || index.sheight[id] <= st.trampleHeight || seen.includes(id)) continue;
      if (index.sheight[id] > smash && !st.wadesTall) {
        out.clear = d - step;
        return;
      }
      seen.push(id);
      const s = world.city.structures[id];
      out.worth += (s.value * world.structureHp[id]) / s.hp;
    }
  }
}
const line = { clear: 0, worth: 0 };

// ---------------------------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------------------------

function nearestUnit(world: World, k: Kaiju): { unit: Unit | null; dist: number } {
  let unit: Unit | null = null;
  let dist = Infinity;
  for (const u of world.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - k.x, u.z - k.z) - u.radius;
    if (d < dist) {
      dist = d;
      unit = u;
    }
  }
  return { unit, dist };
}

/** Pitch that puts the crosshair (from the eye or the mouth at `fromY`) on a point `dist` meters ahead of it at height `y`. */
function pitchTo(fromY: number, y: number, dist: number): number {
  return clamp(Math.atan2(y - fromY, Math.max(dist, 0.5)), -MAX_AIM_PITCH, MAX_AIM_PITCH);
}

/** A unit the beam can reach and see from the mouth, nearest to (nx, nz); null when there is none. */
function beamUnit(world: World, k: Kaiju, st: KaijuStageDef, range: number, nx: number, nz: number): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  eye.y = st.mouthHeight;
  for (const u of world.units) {
    if (!u.alive) continue;
    const away = Math.hypot(u.x - k.x, u.z - k.z);
    // The beam starts at the mouth, ahead of the body: what stands under its chin is out of it.
    if (away > range || away <= st.mouthForward + u.radius) continue;
    const d = Math.hypot(u.x - nx, u.z - nz);
    if (d >= bestD) continue;
    // The mouth, with the head turned toward this unit.
    eye.x = k.x + ((u.x - k.x) / away) * st.mouthForward;
    eye.z = k.z + ((u.z - k.z) / away) * st.mouthForward;
    mark.x = u.x;
    mark.y = u.y + 1;
    mark.z = u.z;
    if (castSegment(world.cityQuery, eye, mark)) continue;
    best = u;
    bestD = d;
  }
  return best;
}

export function kaijuBot(world: World, p: PlayerState, k: Kaiju): void {
  const input = beginBotInput(world, p);
  const bs = p.botState;
  const handicap = botHandicap(world, p);
  // The molt cards are on offer from the start of the cocoon to the end of the intermission.
  if (k.alive && k.offer.length > 0 && handicap < 1) chooseCard(world, k, bs, input);
  else bs.cardWait = -1;
  if (world.match.phase !== 'playing' || !k.alive) {
    releaseAll(bs);
    return;
  }
  if (hesitates(world, bs, handicap)) {
    releaseAll(bs);
    return;
  }
  if (bs.stage !== k.stage) {
    // A new body in a wider city: start over.
    bs.stage = k.stage;
    bs.goal = 'none';
    bs.goalId = -1;
    bs.thinkTimer = 0;
    bs.hideFor = 0;
    bs.side = 0;
    bs.avoidId = -1;
    bs.markX = k.x;
    bs.markZ = k.z;
    bs.stuck = 0;
    releaseAll(bs);
  }

  // A broken nerve: nothing to do but remember it.
  if (k.phase === 'stagger') {
    bs.wasStaggered = true;
    releaseAll(bs);
    return;
  }
  if (k.phase === 'cocoon') {
    releaseAll(bs);
    return;
  }
  if (bs.wasStaggered) {
    bs.wasStaggered = false;
    bs.revenge = R.revengeTime;
    bs.thinkTimer = 0;
  }

  const def = kaijuKindDef(k.kind);
  const st = kaijuStageDef(k.kind, k.stage);
  const a = def.actions;
  if (bs.revenge > 0) bs.revenge -= DT;
  if (bs.braceRest > 0) bs.braceRest -= DT;
  if (bs.throwTimer > 0) bs.throwTimer -= DT;
  if (bs.avoidTime > 0) {
    bs.avoidTime -= DT;
    if (bs.avoidTime <= 0) bs.avoidId = -1;
  }

  // The goal it had may be gone.
  if (bs.goal === 'structure' && !(world.structureHp[bs.goalId] > 0)) bs.goal = 'none';
  if (bs.goal === 'prop' && propGone(world, bs.goalId)) bs.goal = 'none';

  bs.thinkTimer -= DT;
  const thinking = bs.thinkTimer <= 0 || bs.goal === 'none';
  if (thinking) {
    bs.thinkTimer = R.think;
    lookAtSquads(world, k, bs);
  }

  let moveYaw = k.yaw;
  let throttle = 0;
  let aimYaw = input.aimYaw;
  let aimPitch = 0;
  let facing = false; // aim is set explicitly (not along the way it walks)

  const near = nearestUnit(world, k);
  const special = a.special;
  const beamRange = special.special === 'beam' ? perStage(special.range, k.stage) : 0;

  // --- The charge is winding up or running: keep it pointed at what it is for -------------------
  if (k.action === 'charge') {
    const u = bs.chargeUnit >= 0 ? world.units[bs.chargeUnit] : null;
    if (u && u.alive) {
      bs.chargeX = u.x;
      bs.chargeZ = u.z;
    }
    input.aimYaw = yawFromTo(k.x, k.z, bs.chargeX, bs.chargeZ);
    input.aimPitch = 0;
    // Run past the unit it was after (or it is gone): no point running on.
    const button = moveButton(k, 'charge');
    if (k.phase === 'charge' && button && bs.chargeUnit >= 0 && (!u || !u.alive || angleDist(input.aimYaw, k.yaw) > Math.PI / 2)) {
      press(bs, button, TAP_TICKS, 10);
    }
    input.buttons = heldButtons(bs);
    return;
  }

  // --- The beam is on (or winding up): walk it across whatever it was started for -------------
  if (k.action === 'special') {
    const u = beamUnit(world, k, st, beamRange, bs.beamX, bs.beamZ);
    if (u) {
      bs.beamX = u.x;
      bs.beamY = u.y + 1;
      bs.beamZ = u.z;
    }
    const d = Math.hypot(bs.beamX - k.x, bs.beamZ - k.z);
    input.aimYaw = yawFromTo(k.x, k.z, bs.beamX, bs.beamZ);
    input.aimPitch = pitchTo(st.mouthHeight, bs.beamY, d - st.mouthForward);
    input.buttons = heldButtons(bs);
    return;
  }

  // --- The molt ---------------------------------------------------------------------------------
  if (k.moltAvailable && k.stage < LAST_STAGE) {
    bs.hideFor += DT;
    let hiding = bs.goal === 'hide';
    if (thinking && bs.hideFor < R.hideTime && bs.exposed) hiding = chooseHidingPlace(world, k, bs);
    const arrived = hiding && Math.hypot(bs.goalX - k.x, bs.goalZ - k.z) < Math.max(2, k.radius * 0.5);
    if (!hiding || arrived || !bs.exposed || bs.hideFor >= R.hideTime) {
      // Here will do: stand still and press Molt.
      if (canAct(k)) press(bs, 'molt', TAP_TICKS, 15);
      input.buttons = heldButtons(bs);
      input.aimPitch = 0;
      return;
    }
    moveYaw = steer(world, k, bs, bs.goalX, bs.goalZ, -1);
    input.aimYaw = moveYaw;
    input.aimPitch = 0;
    input.moveZ = 1;
    // On the way it smashes what it does not walk round (steer leaves that to it), as it does
    // when wrecking: a hatchling used to lean on a house for the whole search.
    if (!k.held && !st.wadesTall && canAct(k) && wallAhead(world, k, st, moveYaw) >= 0) strike(world, k, bs, def, st, k.aimYaw);
    input.buttons = heldButtons(bs);
    watchProgress(k, bs, true);
    return;
  }
  if (bs.goal === 'hide') bs.goal = 'none';
  bs.hideFor = 0;

  // --- Swimming away: under pressure, with deep water near, it slips in and swims off ----------
  if (swimAway(world, k, bs, thinking)) {
    // No buttons: any of them would bring it up again.
    releaseAll(bs);
    moveYaw = steer(world, k, bs, bs.swimX, bs.swimZ, -1);
    input.aimYaw = moveYaw;
    input.aimPitch = 0;
    input.moveZ = Math.hypot(bs.swimX - k.x, bs.swimZ - k.z) > 1 ? 1 : 0;
    // Short of deep water, keep going (the bank may stand between it and the point).
    if (input.moveZ === 0 && !canSwimAt(world.cityQuery, k, k.x, k.z)) input.moveZ = 1;
    // On the way to the water it smashes what it does not walk round, as when it hides.
    if (k.submerge <= 0 && !k.held && !st.wadesTall && canAct(k) && wallAhead(world, k, st, moveYaw) >= 0) strike(world, k, bs, def, st, k.aimYaw);
    input.buttons = heldButtons(bs);
    return;
  }

  // --- Bracing against a charged volley (when it has the brace) ---------------------------------
  const braceButton = moveButton(k, 'brace');
  if (!braceButton) bs.bracing = 0;
  else if (bs.bracing > 0 || (bs.lasers >= R.braceLasers && bs.laserCharge >= R.braceCharge && bs.braceRest <= 0 && k.phase === 'idle')) {
    bs.bracing += DT;
    const over = bs.bracing >= R.braceMax || (bs.bracing > 0.5 && bs.lasers < R.braceLasers);
    if (over) {
      bs.bracing = 0;
      bs.braceRest = R.braceRest;
    } else {
      input.aimYaw = bs.laserYaw;
      input.aimPitch = 0;
      input.buttons = heldButtons(bs) | Btn[braceButton];
      return;
    }
  }

  // --- Roar (when it has it): guns charging close by (it stuns them), or simply too many ----------
  const roarButton = canAct(k) ? readyMove(k, bs, 'roar') : null;
  if (roarButton) {
    const radius = perStage(a.roar.radius, k.stage) * modMult(k.mods, 'roarRadius');
    let inside = 0;
    let charging = 0;
    for (const u of world.units) {
      if (!u.alive || Math.hypot(u.x - k.x, u.z - k.z) > radius) continue;
      inside++;
      if (u.rooted && u.charge > 0.3) charging++;
    }
    if (charging >= 1 || inside >= R.roarUnits + 1 || (inside >= R.roarUnits && bs.revenge > 0)) press(bs, roarButton, TAP_TICKS, 10);
  }

  // --- Tail sweep (when it has it): units behind it, within the tail's reach ---------------------
  const sweepButton = canAct(k) ? readyMove(k, bs, 'tailSweep') : null;
  if (sweepButton) {
    const reach = a.tailSweep.reach * k.radius * R.sweepReach;
    let behind = 0;
    for (const u of world.units) {
      if (!u.alive || u.y > k.height || !circleInArc(u.x, u.z, u.radius, k.x, k.z, wrapAngle(k.yaw + Math.PI), a.tailSweep.arc / 2, reach)) continue;
      behind++;
    }
    if (behind >= R.sweepUnits) press(bs, sweepButton, TAP_TICKS, 10);
  }

  // --- Something in the hand: throw it at a squad, or eat it when hurt ------------------------
  const hurt = k.hp < k.maxHp * R.eatBelow;
  const throwSpeed = perStage(a.throw.speed, k.stage);
  const throwReach = ((throwSpeed * throwSpeed) / projectileTypeDef('thrown').gravity) * R.throwRange;
  if (k.held) {
    if (hurt && k.cooldowns.eat <= 0) {
      // Grab with something in the hand eats it.
      if (canAct(k)) press(bs, 'grab', TAP_TICKS, 6);
    } else if (near.unit && near.dist <= throwReach) {
      const u = near.unit;
      aimYaw = yawFromTo(k.x, k.z, u.x, u.z);
      aimPitch = pitchTo(st.eyeHeight, 0.5, Math.hypot(u.x - k.x, u.z - k.z) - st.eyeForward);
      facing = true;
      if (canAct(k) && angleDist(aimYaw, k.yaw) <= FACE_ANGLE && angleDist(k.aimYaw, aimYaw) < 0.1) press(bs, 'strike', TAP_TICKS, 6);
    } else if (canAct(k) && !busyWith(bs, 'strike')) {
      // Nobody to throw it at: get rid of it where it is looking.
      press(bs, 'strike', TAP_TICKS, 6);
    }
  }

  // --- The beam (when it has it): on units in reach, else on something big -----------------------
  const beamButton = readyMove(k, bs, 'special');
  if (beamButton && special.special === 'beam' && k.rage >= special.rageCost && !k.held) {
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let found = false;
    const u = beamUnit(world, k, st, beamRange * R.beamUnitRange, k.x, k.z);
    if (u) {
      tx = u.x;
      ty = u.y + 1;
      tz = u.z;
      found = true;
    } else if (bs.goal === 'structure' && world.structureHp[bs.goalId] > 0) {
      const s = world.city.structures[bs.goalId];
      const worthIt = s.height > st.trampleHeight && s.value >= perStage(R.beamStructureValue, k.stage);
      if (worthIt && distToStructure(world.cityIndex, s.id, k.x, k.z) < beamRange * 0.8) {
        tx = s.x;
        ty = Math.min(s.height * 0.5, st.mouthHeight);
        tz = s.z;
        found = true;
      }
    }
    if (found) {
      aimYaw = yawFromTo(k.x, k.z, tx, tz);
      aimPitch = pitchTo(st.mouthHeight, ty, Math.hypot(tx - k.x, tz - k.z) - st.mouthForward);
      facing = true;
      if (canAct(k) && angleDist(aimYaw, k.yaw) <= FACE_ANGLE && press(bs, beamButton, TAP_TICKS, 10)) {
        bs.beamX = tx;
        bs.beamY = ty;
        bs.beamZ = tz;
      }
      input.aimYaw = aimYaw;
      input.aimPitch = aimPitch;
      input.buttons = heldButtons(bs);
      return;
    }
  }

  // --- The charge (when it has it): at a unit within a run's reach, or through buildings it can
  // smash on the way to what it is wrecking --------------------------------------------------------
  const chargeButton = !k.held && canAct(k) && !(hurt && k.cooldowns.eat <= 0) ? readyMove(k, bs, 'charge') : null;
  if (chargeButton && chargeTarget(world, k, bs, def, st)) {
    aimYaw = yawFromTo(k.x, k.z, bs.chargeX, bs.chargeZ);
    // The wind-up still turns the body: it presses once the rest of the turn fits in it.
    const turnReach = st.turnRate * a.charge.windupTurnMult * a.charge.timing.windup * 0.8;
    if (angleDist(aimYaw, k.yaw) <= turnReach) press(bs, chargeButton, TAP_TICKS, 10);
    input.aimYaw = aimYaw;
    input.aimPitch = 0;
    input.buttons = heldButtons(bs);
    return;
  }

  // --- Units close by, the squad that just broke its nerve, or guns charging within a dash: fight them ---
  const meleeRange = R.meleeRadii * k.radius + R.meleeMargin;
  const revengeRange = R.revengeRadii * k.radius;
  // Hungry and able to eat: food comes before chasing anybody (not before what is underfoot).
  const hungry = hurt && k.cooldowns.eat <= 0 && !k.held;
  let foe: Unit | null = null;
  if (near.unit && (near.dist <= meleeRange || (bs.revenge > 0 && !hungry && near.dist <= revengeRange))) {
    foe = near.unit;
    bs.rushTime = 0;
  } else if (hungry) {
    bs.rushTime = 0;
  } else if (bs.rushRest > 0) {
    bs.rushRest -= DT;
  } else if (bs.lasers >= R.rushLasers || bs.rushTime > 0) {
    // Lasers on it: go for the nearest gun that is charging. They will have to pack up and run.
    const range = perStage(R.rushRange, k.stage);
    let best = range;
    for (const u of world.units) {
      if (!u.alive || !u.rooted) continue;
      const d = Math.hypot(u.x - k.x, u.z - k.z);
      if (d < best) {
        best = d;
        foe = u;
      }
    }
    if (foe) bs.rushTime += DT;
    if (!foe || bs.rushTime >= R.rushMax) {
      // Nobody left to chase, or it has chased long enough: back to work for a while.
      if (bs.rushTime > 0) bs.rushRest = R.rushRest;
      bs.rushTime = 0;
      foe = null;
    }
  }
  if (foe) {
    const u = foe;
    const foeDist = Math.hypot(u.x - k.x, u.z - k.z) - u.radius;
    // Walk onto it (that tramples it) and hit whatever is in reach on the way.
    const yaw = yawFromTo(k.x, k.z, u.x + u.vx * 0.4, u.z + u.vz * 0.4);
    moveYaw = steer(world, k, bs, u.x, u.z, -1);
    throttle = 1;
    if (!facing) aimYaw = foeDist < a.swipe.reach * k.radius ? yaw : moveYaw;
    if (!k.held) strike(world, k, bs, def, st, k.aimYaw);
  } else {
    // --- Food, when hurt -----------------------------------------------------------------------
    let eating = false;
    if (hungry) {
      const reach = a.eat.reach * k.radius;
      const inReach = findEdible(world, k, def);
      if (inReach) {
        eating = true;
        // A grab when something can be picked up (and then a bite: what is in the hand is
        // eaten), else a bite straight off the ground.
        if (canAct(k)) press(bs, 'grab', TAP_TICKS, 6);
      } else {
        const food = nearestFood(world, k, R.foodRadii * k.radius);
        if (food >= 0) {
          eating = true;
          const fx = world.cityIndex.px[food];
          const fz = world.cityIndex.pz[food];
          const d = Math.hypot(fx - k.x, fz - k.z);
          // Stop short of stepping on it: within reach of the hand, not under the feet.
          const stop = Math.max(0.75 * reach, k.radius + world.cityIndex.pradius[food] + 0.8);
          moveYaw = steer(world, k, bs, fx, fz, -1);
          throttle = d > stop ? 1 : 0;
          if (!facing) aimYaw = yawFromTo(k.x, k.z, fx, fz);
          facing = true;
          // A wall between it and the meal is smashed, as on the way to anything else (it
          // could otherwise lean on a house for the rest of the match, the meal beyond it).
          if (throttle > 0 && !k.held && !st.wadesTall && canAct(k) && wallAhead(world, k, st, moveYaw) >= 0) strike(world, k, bs, def, st, k.aimYaw);
        }
      }
    }

    // --- Wrecking ---------------------------------------------------------------------------------
    if (!eating) {
      if (thinking || bs.goal === 'none') chooseWreckGoal(world, k, bs);
      const index = world.cityIndex;
      if (bs.goal === 'structure') {
        const id = bs.goalId;
        const low = index.sheight[id] <= st.trampleHeight;
        const dist = distToStructure(index, id, k.x, k.z);
        const reach = a.swipe.reach * k.radius * 0.8;
        const yaw = yawFromTo(k.x, k.z, index.sx[id], index.sz[id]);
        moveYaw = steer(world, k, bs, index.sx[id], index.sz[id], id);
        if (low) {
          throttle = 1;
          if (!facing) aimYaw = moveYaw;
        } else {
          // Close enough to hit: stand and face it. A wading titan keeps pushing in for the contact damage.
          const inReach = dist <= reach;
          throttle = inReach && !st.wadesTall ? 0 : 1;
          if (!facing) aimYaw = inReach ? yaw : moveYaw;
          if (inReach && !k.held) strike(world, k, bs, def, st, k.aimYaw);
        }
      } else {
        moveYaw = steer(world, k, bs, bs.goalX, bs.goalZ, -1);
        throttle = Math.hypot(bs.goalX - k.x, bs.goalZ - k.z) > 1 ? 1 : 0;
        if (!facing) aimYaw = moveYaw;
      }
      // Whatever stands in the way and can be smashed, is (a wading titan just pushes through).
      if (throttle > 0 && !k.held && !st.wadesTall && canAct(k) && wallAhead(world, k, st, moveYaw) >= 0) {
        if (!facing) aimYaw = moveYaw;
        strike(world, k, bs, def, st, k.aimYaw);
      }
    }

    // --- A squad in throwing range and something to throw within reach of the hand ----------------
    if (!k.held && bs.throwTimer <= 0 && near.unit && near.dist <= throwReach && near.dist > meleeRange && canAct(k) && !eating) {
      if (findGrabTarget(world, k, def) && press(bs, 'grab', TAP_TICKS, 8)) bs.throwTimer = R.throwEvery;
    }
  }

  // The stick is relative to the view: with the view along the way it walks, forward is forward.
  input.aimYaw = aimYaw;
  input.aimPitch = aimPitch;
  if (throttle > 0) {
    const s = Math.sin(aimYaw);
    const c = Math.cos(aimYaw);
    const dx = Math.sin(moveYaw);
    const dz = Math.cos(moveYaw);
    input.moveZ = (dx * s + dz * c) * throttle;
    input.moveX = (-dx * c + dz * s) * throttle;
  }
  input.buttons = heldButtons(bs);
  watchProgress(k, bs, throttle > 0 && k.phase === 'idle');
}

const chargeCandidates: Unit[] = [];

/**
 * Something worth a charge (bs.chargeUnit, chargeX, chargeZ): the nearest unit within a run's
 * reach (not one at its feet) with nothing it cannot smash in between; failing that, the goal
 * it is wrecking when the way there is lined with buildings the run would smash.
 */
function chargeTarget(world: World, k: Kaiju, bs: BotState, def: KaijuKindDef, st: KaijuStageDef): boolean {
  const c = def.actions.charge;
  const reach = st.topSpeed * c.speedMult * Math.max(0, c.timing.active - c.rampTime / 2) * R.chargeReach;
  const minD = k.radius * 2.5;
  chargeCandidates.length = 0;
  for (const u of world.units) {
    if (!u.alive || u.y > k.height) continue;
    const d = Math.hypot(u.x - k.x, u.z - k.z);
    if (d >= minD && d <= reach) chargeCandidates.push(u);
  }
  chargeCandidates.sort((p, q) => Math.hypot(p.x - k.x, p.z - k.z) - Math.hypot(q.x - k.x, q.z - k.z) || p.id - q.id);
  for (const u of chargeCandidates) {
    const d = Math.hypot(u.x - k.x, u.z - k.z);
    chargeLine(world, k, def, st, yawFromTo(k.x, k.z, u.x, u.z), d, line);
    if (line.clear < d - k.radius - u.radius) continue;
    bs.chargeUnit = u.id;
    bs.chargeX = u.x;
    bs.chargeZ = u.z;
    return true;
  }
  if (bs.goal !== 'structure' && bs.goal !== 'prop') return false;
  const d = Math.hypot(bs.goalX - k.x, bs.goalZ - k.z);
  if (d < minD) return false;
  chargeLine(world, k, def, st, yawFromTo(k.x, k.z, bs.goalX, bs.goalZ), Math.min(reach, d + k.radius), line);
  if (line.worth < perStage(R.chargeWorth, k.stage) || line.clear < Math.min(reach, d) * 0.6) return false;
  bs.chargeUnit = -1;
  bs.chargeX = bs.goalX;
  bs.chargeZ = bs.goalZ;
  return true;
}

function propGone(world: World, id: number): boolean {
  return ((world.propAlive[id >> 3] >> (id & 7)) & 1) === 0;
}

/** The nearest thing lying in the street that it can eat (a car, a kiosk), within `range`; -1 when there is none. */
function nearestFood(world: World, k: Kaiju, range: number): number {
  const index = world.cityIndex;
  const b = world.match.bounds;
  let best = -1;
  let bestD = Infinity;
  propsInCircle(world.cityQuery, k.x, k.z, range, propIds);
  for (const id of propIds) {
    if (!PROP_KINDS[world.city.props[id].kind].edible) continue;
    if (!boundsContains(b, index.px[id], index.pz[id], k.radius)) continue;
    const d = Math.hypot(index.px[id] - k.x, index.pz[id] - k.z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * Notices when it wants to walk and is getting nowhere (pushing against something it cannot
 * break, or circling something it cannot pass), and gives up on what it was after.
 */
function watchProgress(k: Kaiju, bs: BotState, walking: boolean): void {
  if (!walking) {
    bs.markX = k.x;
    bs.markZ = k.z;
    bs.stuck = 0;
    bs.goalStall = 0;
    return;
  }
  const toGoal = Math.hypot(bs.goalX - k.x, bs.goalZ - k.z);
  if (toGoal < bs.goalBest - R.stuckDist) {
    bs.goalBest = toGoal;
    bs.goalStall = 0;
  } else {
    bs.goalStall += DT;
  }
  if (Math.hypot(k.x - bs.markX, k.z - bs.markZ) >= R.stuckDist) {
    bs.markX = k.x;
    bs.markZ = k.z;
    bs.stuck = 0;
  } else {
    bs.stuck += DT;
  }
  if (bs.stuck < R.stuckTime && bs.goalStall < R.stallTime) return;
  // Leave it for a while and try the other way round.
  bs.stuck = 0;
  bs.goalStall = 0;
  bs.goalBest = Infinity;
  if (bs.goal === 'structure') {
    bs.avoidId = bs.goalId;
    bs.avoidTime = R.avoidTime;
  }
  bs.goal = 'none';
  bs.side = bs.side === 0 ? 1 : -bs.side;
  bs.sideTime = 2;
  bs.thinkTimer = 0;
}
