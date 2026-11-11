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
 *   after its nerve breaks, roars when units stand inside the roar radius, braces when enough
 *   charged lasers are on it, throws what is at hand at a squad in range, and turns its beam on
 *   units when it has one and they are in reach (else on something big).
 * - Eating when hurt, from the hand, from within reach, or after a short walk to a car.
 * - The molt: when it may, it looks for a place where fewer guns can see it, for a few seconds
 *   at most, and cocoons there.
 *
 * It is deliberately beatable: it reacts to what is on top of it, never plans a route, and can
 * be baited away from the city by a squad that knows how.
 *
 * Everything it knows it reads from the World; everything it does goes into `player.botInput`.
 */

import { PROP_KINDS } from '../../city/props';
import { castSegment, distToStructure, lineOfSight, propsInCircle, structuresInCircle } from '../../city/spatialIndex';
import { BOT_RULES } from '../../defs/bots';
import { perStage } from '../../defs/ids';
import { kaijuKindDef, kaijuStageDef } from '../../defs/kaiju/index';
import { DT, TICK_RATE } from '../../defs/rules';
import type { KaijuKindDef, KaijuStageDef } from '../../defs/schema';
import { LAST_STAGE } from '../../defs/stages';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { projectileTypeDef, weaponDef } from '../../defs/weapons';
import { angleDist, yawFromTo, yawOf } from '../../math/angle';
import { boundsContains, circleInArc, obbInArc } from '../../math/geom';
import { clamp, lerp } from '../../math/scalar';
import type { Vec3 } from '../../math/vec';
import { Btn, MAX_AIM_PITCH } from '../../net/input';
import { findEdible, findGrabTarget } from '../kaijuEffects';
import { laserOnKaiju } from '../squads';
import { unitSeesKaiju } from '../spotting';
import type { Kaiju, PlayerState, Unit, World } from '../types';
import { beginBotInput, botHandicap, busyWith, heldButtons, hesitates, press, releaseAll } from './common';
import type { BotState } from './types';

const R = BOT_RULES.kaiju;

/** Ticks a tap lasts, and ticks a hold needs beyond the action's hold time to be safe. */
const TAP_TICKS = 2;
const HOLD_SLACK_TICKS = 3;
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

  // Cars and kiosks in the street are worth the detour while the kaiju is small.
  let bestProp = -1;
  if (k.stage < LAST_STAGE) {
    propsInCircle(world.cityQuery, k.x, k.z, Math.max(PROP_SEARCH, 6 * k.radius), propIds);
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

/** Swipes or stomps when either is worth something; returns whether it struck. */
function strike(world: World, k: Kaiju, bs: BotState, def: KaijuKindDef, st: KaijuStageDef, yaw: number): boolean {
  if (!canAct(k) || busyWith(bs, 'strike')) return false;
  const w = strikeWorth(world, k, def, st, yaw);
  if (w.swipe <= 0 && w.stomp <= 0) return false;
  const swipeTime = def.actions.swipe.timing.windup + def.actions.swipe.timing.active + def.actions.swipe.timing.recover;
  const stompTime = def.actions.stomp.timing.windup + def.actions.stomp.timing.active + def.actions.stomp.timing.recover;
  if (w.stomp / stompTime > (w.swipe / swipeTime) * R.stompBias) {
    press(bs, 'strike', Math.ceil(def.actions.stomp.holdTime * TICK_RATE) + HOLD_SLACK_TICKS);
  } else {
    press(bs, 'strike', TAP_TICKS);
  }
  return true;
}

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

/** Pitch that puts the crosshair (from the eye at `fromY`) on a point `dist` meters away at height `y`. */
function pitchTo(fromY: number, y: number, dist: number): number {
  return clamp(Math.atan2(y - fromY, Math.max(dist, 0.5)), -MAX_AIM_PITCH, MAX_AIM_PITCH);
}

/** A unit the beam can reach and see from the mouth, nearest to (nx, nz); null when there is none. */
function beamUnit(world: World, k: Kaiju, st: KaijuStageDef, range: number, nx: number, nz: number): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  eye.x = k.x;
  eye.y = st.mouthHeight;
  eye.z = k.z;
  for (const u of world.units) {
    if (!u.alive) continue;
    if (Math.hypot(u.x - k.x, u.z - k.z) > range) continue;
    const d = Math.hypot(u.x - nx, u.z - nz);
    if (d >= bestD) continue;
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
  if (world.match.phase !== 'playing' || !k.alive) {
    releaseAll(bs);
    return;
  }
  if (hesitates(world, bs, botHandicap(world, p))) {
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
    input.aimPitch = pitchTo(st.mouthHeight, bs.beamY, d);
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
      // Here will do: stand still and hold Molt until the cocoon closes.
      input.buttons = heldButtons(bs) | Btn.molt;
      input.aimPitch = 0;
      return;
    }
    moveYaw = steer(world, k, bs, bs.goalX, bs.goalZ, -1);
    input.aimYaw = moveYaw;
    input.aimPitch = 0;
    input.moveZ = 1;
    input.buttons = heldButtons(bs);
    watchProgress(k, bs, true);
    return;
  }
  if (bs.goal === 'hide') bs.goal = 'none';
  bs.hideFor = 0;

  // --- Bracing against a charged volley ---------------------------------------------------------
  if (bs.bracing > 0 || (bs.lasers >= R.braceLasers && bs.laserCharge >= R.braceCharge && bs.braceRest <= 0 && k.phase === 'idle')) {
    bs.bracing += DT;
    const over = bs.bracing >= R.braceMax || (bs.bracing > 0.5 && bs.lasers < R.braceLasers);
    if (over) {
      bs.bracing = 0;
      bs.braceRest = R.braceRest;
    } else {
      input.aimYaw = bs.laserYaw;
      input.aimPitch = 0;
      input.buttons = heldButtons(bs) | Btn.block;
      return;
    }
  }

  // --- Roar: units inside the radius, charging or simply too many ------------------------------
  if (k.cooldowns.roar <= 0 && canAct(k) && !busyWith(bs, 'roar')) {
    const radius = perStage(a.roar.radius, k.stage) * modMult(k.mods, 'roarRadius');
    let inside = 0;
    let charging = 0;
    for (const u of world.units) {
      if (!u.alive || Math.hypot(u.x - k.x, u.z - k.z) > radius) continue;
      inside++;
      if (u.rooted && u.charge > 0.3) charging++;
    }
    if (charging >= 1 || inside >= R.roarUnits + 1 || (inside >= R.roarUnits && bs.revenge > 0)) press(bs, 'roar', TAP_TICKS, 10);
  }

  // --- Something in the hand: throw it at a squad, or eat it when hurt ------------------------
  const hurt = k.hp < k.maxHp * R.eatBelow;
  const throwSpeed = perStage(a.throw.speed, k.stage);
  const throwReach = ((throwSpeed * throwSpeed) / projectileTypeDef('thrown').gravity) * R.throwRange;
  if (k.held) {
    if (hurt && k.cooldowns.eat <= 0) {
      if (canAct(k)) press(bs, 'grab', Math.ceil(a.eat.holdTime * TICK_RATE) + HOLD_SLACK_TICKS, 6);
    } else if (near.unit && near.dist <= throwReach) {
      const u = near.unit;
      aimYaw = yawFromTo(k.x, k.z, u.x, u.z);
      aimPitch = pitchTo(st.eyeHeight, 0.5, Math.hypot(u.x - k.x, u.z - k.z));
      facing = true;
      if (canAct(k) && angleDist(aimYaw, k.yaw) <= FACE_ANGLE && angleDist(k.aimYaw, aimYaw) < 0.1) press(bs, 'strike', TAP_TICKS, 6);
    } else if (canAct(k) && !busyWith(bs, 'strike')) {
      // Nobody to throw it at: get rid of it where it is looking.
      press(bs, 'strike', TAP_TICKS, 6);
    }
  }

  // --- The beam: on units in reach, else on something big ----------------------------------------
  if (special.special === 'beam' && k.rage >= special.rageCost && k.cooldowns.special <= 0 && !k.held) {
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
      aimPitch = pitchTo(st.mouthHeight, ty, Math.hypot(tx - k.x, tz - k.z));
      facing = true;
      if (canAct(k) && angleDist(aimYaw, k.yaw) <= FACE_ANGLE && press(bs, 'special', TAP_TICKS, 10)) {
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

  // --- Units close by, the squad that just broke its nerve, or guns charging within a dash: fight them ---
  const meleeRange = R.meleeRadii * k.radius + R.meleeMargin;
  const revengeRange = R.revengeRadii * k.radius;
  let foe: Unit | null = null;
  if (near.unit && (near.dist <= meleeRange || (bs.revenge > 0 && near.dist <= revengeRange))) {
    foe = near.unit;
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
    if (hurt && k.cooldowns.eat <= 0 && !k.held) {
      const reach = a.eat.reach * k.radius;
      const inReach = findEdible(world, k, def);
      if (inReach) {
        eating = true;
        // Grab held down goes on to eat what the hand finds, or what lies in reach.
        if (canAct(k)) press(bs, 'grab', Math.ceil(a.eat.holdTime * TICK_RATE) + HOLD_SLACK_TICKS + Math.ceil(a.grab.timing.windup * TICK_RATE), 6);
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
