/**
 * System 10 of 12: city damage and the destruction bar.
 *
 * Drains the structure and prop damage queued during the tick. For every structure hit: remove
 * hp, add `value * hpLost / maxHp` points to the bar whoever caused it, emit `structureStage`
 * when the visual stage changes, and credit the player's tally when it collapses. Rubble takes
 * no damage and gives no points. Props are destroyed outright and add their value; cars and
 * other vehicles leave a wreck (`world.propWreck`) that a kaiju can pick up.
 * Then check whether the bar passed a mark and emit `barMark`, and offer the molt: while the bar
 * is past the mark of the current stage (1 or 2) the kaiju has `moltAvailable` (emitted once as
 * `moltAvailable`; the kaiju action system starts the cocoon and clears the flag).
 *
 * What a mark MEANS beyond the prompt (the cocoon ending, the stage change, the kaiju win) is
 * decided by the match flow system, which runs right after this one.
 *
 * Rules from upgrades and Tier 2 content that already live here, so nothing else needs to know:
 * - `barPoints` modifier: points are multiplied by the modifier of whoever caused the damage
 *   (the kaiju's mods, or the squad's mods for human collateral);
 * - 'insuranceRider' flag: each squad that carries it insures one landmark, the first one that
 *   takes damage after the policy is free. Damage to an insured landmark adds nothing to the bar;
 * - shields (`world.shields`, the Coalition's sanctuaries): damage to a structure whose center
 *   is inside one is multiplied by its `damageMult`. Trample is never reduced;
 * - a bridge deck that collapses drops the ground units standing on it into the river: they
 *   take `bridgeFallDamage` and are shaken (`bridgeFallNerve`), credited to whoever felled it.
 *
 * Rubble stays (docs/ROADMAP.md, phase 2): a structure that collapses where it stands is a mound
 * over its footprint, half its height (city/spatialIndex.ts; nothing to store: the height follows
 * from the archetype). A slender one (FALL_RULES.slenderness) falls over on its side instead,
 * FALL_RULES.chance of the time (the match's random numbers): `startStructureFall`. It tips over
 * the side of its footprint that faces along whatever hit it last (a projectile's flight), or
 * away from the kaiju, and lands FALL_RULES.time later (`structureFall`, 'falling' then
 * 'landed'): units under its length take FALL_RULES.unitDamage of their hp, structures under it
 * FALL_RULES.crushShare of the falling one's hp (cause 'fall'; one brought down may fall over in
 * turn, at most FALL_RULES.maxChain falls in a row), props are crushed; from then on it is a long
 * mound where it lies (`world.structureFall`).
 */

import { bitClear, bitGet, bitSet } from '../../math/bits';
import { circleVsBoxCS, distSqPointBoxCS, obbVsObb, pointInObb, type OrientedBox } from '../../math/geom';
import { PROP_KINDS } from '../../city/props';
import {
  canFallOver,
  createMoundBox,
  fallenBox,
  fallSideDir,
  fallSideToward,
  fallTop,
  propsInCircle,
  setStructureFallen,
  structuresInCircle,
  type FallSide,
  type MoundBox,
} from '../../city/spatialIndex';
import type { Structure } from '../../city/types';
import type { DamageKind } from '../../defs/ids';
import { FALL_RULES } from '../../defs/rubble';
import { COMBAT_RULES, DT } from '../../defs/rules';
import { LAST_STAGE } from '../../defs/stages';
import type { Mods } from '../../defs/schema';
import { hasModFlag, modMult } from '../../defs/upgrades';
import { yawOf } from '../../math/angle';
import { rngChance, rngInt } from '../../math/rng';
import type { Vec2 } from '../../math/vec';
import { structureStageFor } from '../bar';
import type { PlayerId } from '../config';
import { noteKaijuNoise } from '../spotting';
import { propaneDestroyed } from '../cityWeapons';
import { applyHit } from './damage';
import { specialCollapsed } from './specials';
import type { FallingStructure, StructureHit, World } from '../types';
import { emit } from '../worldOps';

/** The modifier table of whoever a player controls: their kaiju or their squad. */
function modsOfPlayer(world: World, player: PlayerId): Mods | null {
  const p = world.players[player];
  if (!p) return null;
  if (p.kaijuId >= 0) return world.kaijus[p.kaijuId].mods;
  if (p.squadId >= 0) return world.squads[p.squadId].mods;
  return null;
}

/** Adds bar points caused by `by` and feeds the kaiju's rage when the kaiju did the wrecking. */
function addBarPoints(world: World, points: number, by: PlayerId): void {
  if (!(points > 0)) return;
  const mods = modsOfPlayer(world, by);
  if (mods) points *= modMult(mods, 'barPoints');
  if (!(points > 0)) return;
  const m = world.match;
  m.barPoints += points;
  const player = world.players[by];
  if (!player) return;
  player.tally.barPoints += points;
  if (player.kaijuId >= 0) {
    // Rage for wrecking: filling one whole stage segment of the bar is worth ragePerBarSegment.
    // What the special itself wrecks earns none, so a beam can never pay for the next beam.
    const k = world.kaijus[player.kaijuId];
    const lo = m.stage > 1 ? m.marks[m.stage - 2] : 0;
    const segment = m.marks[m.stage - 1] - lo;
    if (segment > 0 && k.action !== 'special') {
      const gain = (COMBAT_RULES.ragePerBarSegment * points * modMult(k.mods, 'rageGain')) / segment;
      k.rage = Math.min(COMBAT_RULES.rageMax, k.rage + gain);
    }
  }
}

/** Damage multiplier from the shields a structure stands in (1 when there is none). */
function shieldMult(world: World, s: Structure): number {
  let mult = 1;
  for (const shield of world.shields) {
    const dx = s.x - shield.x;
    const dz = s.z - shield.z;
    if (dx * dx + dz * dz <= shield.radius * shield.radius && shield.damageMult < mult) mult = shield.damageMult;
  }
  return mult < 0 ? 0 : mult;
}

/**
 * Whether a landmark is covered by an insurance rider. Each squad carrying the upgrade insures
 * one landmark: the first that takes damage while a policy is still free.
 */
function isInsured(world: World, id: number): boolean {
  if (world.insuredStructures.includes(id)) return true;
  let policies = 0;
  for (const squad of world.squads) if (hasModFlag(squad.mods, 'insuranceRider')) policies++;
  if (world.insuredStructures.length >= policies) return false;
  world.insuredStructures.push(id);
  return true;
}

/** Ground units standing on a deck when it goes fall into the river with it. */
function dropUnitsFromDeck(world: World, s: Structure, hit: StructureHit): void {
  for (const u of world.units) {
    if (!u.alive || u.y > 0 || !pointInObb(u.x, u.z, s)) continue;
    world.hits.push({
      target: { entity: 'unit', id: u.id },
      hit: {
        damage: COMBAT_RULES.bridgeFallDamage,
        nerve: COMBAT_RULES.bridgeFallNerve,
        fromDir: { x: 0, z: 0 },
        sourceId: -1,
        player: hit.by,
        kind: hit.cause,
        atWill: false,
      },
    });
  }
}

/** Applies one queued hit to a structure. Returns the hp actually removed. */
export function applyStructureDamage(world: World, hit: StructureHit): number {
  const hp = world.structureHp[hit.id];
  if (!(hp > 0) || !(hit.damage > 0)) return 0;
  const s = world.city.structures[hit.id];
  // Walking through a building flattens it whatever protects it; everything else can be shielded.
  const damage = hit.damage === Infinity || world.shields.length === 0 ? hit.damage : hit.damage * shieldMult(world, s);
  if (!(damage > 0)) return 0;
  const lost = Math.min(hp, damage);
  const left = hp - lost;
  world.structureHp[hit.id] = left;
  if (s.landmark === null || !isInsured(world, hit.id)) addBarPoints(world, (s.value * lost) / s.hp, hit.by);

  const stage = structureStageFor(left, s.hp);
  if (stage !== world.structureStage[hit.id]) {
    world.structureStage[hit.id] = stage;
    emit(world, { type: 'structureStage', id: hit.id, stage, by: hit.by, cause: hit.cause });
    if (stage === 3) {
      const player = world.players[hit.by];
      if (player) {
        player.tally.wrecked[s.cls]++;
        // Wrecking something is loud: a hatchling gives itself away.
        if (player.kaijuId >= 0) noteKaijuNoise(world.kaijus[player.kaijuId]);
      }
      if (s.passable) dropUnitsFromDeck(world, s, hit);
      // A special building pays its reward (the radio mast falls away from the kaiju: before
      // the chance of a fall below, which then leaves it be). sim/systems/specials.ts
      specialCollapsed(world, hit.id, hit.by, hit.cause);
      // A slender building may fall over on its side rather than straight down.
      maybeFall(world, hit);
    }
  }
  return lost;
}

// ---------------------------------------------------------------------------------------------
// Buildings that fall over (docs/ROADMAP.md, phase 2)
// ---------------------------------------------------------------------------------------------

const crushBox: MoundBox = createMoundBox();
const crushArea: OrientedBox = { x: 0, z: 0, hx: 0, hz: 0, yaw: 0 };
const fallDir: Vec2 = { x: 0, z: 0 };
const fallPivot: Vec2 = { x: 0, z: 0 };
const fallTip: Vec2 = { x: 0, z: 0 };
const crushIds: number[] = [];
/** The structure `startStructureFall` is knocking down itself: its collapse does not roll for a fall of its own. */
let knockingDown = -1;

/** The fall in progress of a structure, or null. */
function fallingNow(world: World, id: number): FallingStructure | null {
  for (const f of world.falls) if (f.id === id) return f;
  return null;
}

/**
 * Which side a structure falls toward: along (dirX, dirZ) when that is given, else away from the
 * nearest kaiju (straight out from its middle, or the way it faces when it stands right on it),
 * else a side drawn at random.
 */
function fallSideFor(world: World, id: number, dirX: number, dirZ: number): FallSide {
  const index = world.cityIndex;
  if (dirX * dirX + dirZ * dirZ > 1e-12) return fallSideToward(index, id, dirX, dirZ);
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const dx = index.sx[id] - k.x;
    const dz = index.sz[id] - k.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= best) continue;
    best = d2;
    bx = d2 > 1e-6 ? dx : Math.sin(k.yaw);
    bz = d2 > 1e-6 ? dz : Math.cos(k.yaw);
  }
  if (best < Infinity) return fallSideToward(index, id, bx, bz);
  return rngInt(world.rng, 4) as FallSide;
}

/** The collapse of a slender structure: about half the time it falls over (see the header). */
function maybeFall(world: World, hit: StructureHit): void {
  const id = hit.id;
  if (id === knockingDown || !canFallOver(world.cityIndex, id)) return;
  const depth = hit.fallDepth ?? 0;
  if (depth >= FALL_RULES.maxChain) return;
  // Something has already made it fall (the radio mast's own reward does, sim/systems/specials.ts).
  if (world.structureFall[id] !== 0 || fallingNow(world, id)) return;
  if (!rngChance(world.rng, FALL_RULES.chance)) return;
  startStructureFall(world, id, hit.dirX ?? 0, hit.dirZ ?? 0, hit.by, hit.cause, depth);
}

/**
 * Makes a structure fall over on its side, toward the side of its footprint that faces most
 * nearly along (dirX, dirZ) (a zero direction: away from the nearest kaiju). One that is still
 * standing is brought down first, credited to `by` like any collapse. It lands FALL_RULES.time
 * later and crushes what lies under it (see the header); `depth` is how many falls in a row
 * led here (it bounds the chain). Returns where its top lands, written to `top`; a structure
 * already falling or lying fallen keeps its fall, and its landing point is returned. Null for a
 * bridge deck, or a structure that could not be brought down.
 */
export function startStructureFall(
  world: World,
  id: number,
  dirX: number,
  dirZ: number,
  by: PlayerId,
  cause: DamageKind,
  depth = 0,
  top: Vec2 = { x: 0, z: 0 },
): Vec2 | null {
  const index = world.cityIndex;
  if (!(id >= 0 && id < world.city.structures.length) || index.spassable[id] === 1) return null;
  const existing = fallingNow(world, id);
  if (existing) return fallTop(index, id, existing.side, top);
  if (world.structureFall[id] !== 0) return fallTop(index, id, world.structureFall[id] - 1, top);
  if (world.structureHp[id] > 0) {
    knockingDown = id;
    applyStructureDamage(world, { id, damage: Infinity, by, cause, dirX, dirZ, fallDepth: depth });
    knockingDown = -1;
    if (world.structureHp[id] > 0) return null;
  }
  const side = fallSideFor(world, id, dirX, dirZ);
  world.falls.push({ id, side, timer: FALL_RULES.time, by, cause, depth });
  fallTop(index, id, side, top, fallPivot);
  fallSideDir(index, id, side, fallDir);
  emit(world, {
    type: 'structureFall',
    id,
    phase: 'falling',
    side,
    yaw: yawOf(fallDir.x, fallDir.z),
    duration: FALL_RULES.time,
    x: fallPivot.x,
    z: fallPivot.z,
    topX: top.x,
    topZ: top.z,
    by,
    cause,
  });
  return top;
}

/** A fall lands: it lies where it fell from now on, and crushes what is under it. */
function landFall(world: World, f: FallingStructure): void {
  const index = world.cityIndex;
  const id = f.id;
  setStructureFallen(world.cityQuery, id, f.side);
  fallTop(index, id, f.side, fallTip, fallPivot);
  fallSideDir(index, id, f.side, fallDir);
  emit(world, {
    type: 'structureFall',
    id,
    phase: 'landed',
    side: f.side,
    yaw: yawOf(fallDir.x, fallDir.z),
    duration: 0,
    x: fallPivot.x,
    z: fallPivot.z,
    topX: fallTip.x,
    topZ: fallTip.z,
    by: f.by,
    cause: f.cause,
  });

  const box = fallenBox(index, id, f.side, crushBox);
  const reach = Math.hypot(box.hx, box.hz);
  // Units under it (not those still high up on a parachute).
  for (const u of world.units) {
    if (!u.alive || u.y > box.height) continue;
    if (!circleVsBoxCS(u.x, u.z, u.radius, box.x, box.z, box.hx, box.hz, box.cos, box.sin)) continue;
    world.hits.push({
      target: { entity: 'unit', id: u.id },
      hit: {
        damage: FALL_RULES.unitDamage * u.maxHp,
        nerve: FALL_RULES.unitNerve,
        fromDir: { x: -fallDir.x, z: -fallDir.z },
        sourceId: -1,
        player: f.by,
        kind: 'fall',
        atWill: false,
      },
    });
  }
  // Structures under it: the bigger the building that falls, the harder it hits.
  const damage = FALL_RULES.crushShare * world.city.structures[id].hp;
  crushArea.x = box.x;
  crushArea.z = box.z;
  crushArea.hx = box.hx;
  crushArea.hz = box.hz;
  crushArea.yaw = world.city.structures[id].yaw;
  structuresInCircle(world.cityQuery, box.x, box.z, reach, crushIds);
  for (const sid of crushIds) {
    if (sid === id || !obbVsObb(crushArea, world.city.structures[sid])) continue;
    world.structureHits.push({ id: sid, damage, by: f.by, cause: 'fall', dirX: fallDir.x, dirZ: fallDir.z, fallDepth: f.depth + 1 });
  }
  // And whatever small things stood there.
  propsInCircle(world.cityQuery, box.x, box.z, reach, crushIds);
  for (const pid of crushIds) {
    const r = index.pradius[pid];
    if (distSqPointBoxCS(index.px[pid], index.pz[pid], box.x, box.z, box.hx, box.hz, box.cos, box.sin) > r * r) continue;
    world.propHits.push({ id: pid, by: f.by, cause: 'fall' });
  }
}

/** Counts the falls in progress down and lands those whose time has come. */
function advanceFalls(world: World): void {
  if (world.falls.length === 0) return;
  let kept = 0;
  for (let i = 0; i < world.falls.length; i++) {
    const f = world.falls[i];
    f.timer -= DT;
    if (f.timer > 1e-6) world.falls[kept++] = f;
    else landFall(world, f);
  }
  // A landing does not start another fall (its crush is applied below, after this), so nothing was added meanwhile.
  world.falls.length = kept;
}

/**
 * Takes a live prop out of the city and credits whoever did it: its bar value, the tally, the
 * noise. Returns false when the prop was already gone. `leaveWreck` is false when the prop is
 * carried off whole (a grab, a meal).
 */
function removeProp(world: World, id: number, by: PlayerId, leaveWreck: boolean): boolean {
  if (!bitGet(world.propAlive, id)) return false;
  bitClear(world.propAlive, id);
  const def = PROP_KINDS[world.city.props[id].kind];
  if (leaveWreck && def.leavesWreck) bitSet(world.propWreck, id);
  addBarPoints(world, def.value, by);
  const player = world.players[by];
  if (player && def.tally) {
    player.tally.wrecked[def.tally]++;
    if (player.kaijuId >= 0) noteKaijuNoise(world.kaijus[player.kaijuId]);
  }
  return true;
}

/**
 * A kaiju picks a live prop up (or eats it off the ground): the prop leaves the city at once,
 * counts for the bar and the tally like any destroyed prop, and leaves no wreck. No
 * `propsDestroyed` event: the `kaijuHeld` event tells clients where it went.
 */
export function takeProp(world: World, id: number, by: PlayerId): boolean {
  return removeProp(world, id, by, false);
}

/** A kaiju picks up (or eats) the wreck a destroyed prop left behind. Returns false when there is none. */
export function takePropWreck(world: World, id: number): boolean {
  if (!bitGet(world.propWreck, id)) return false;
  bitClear(world.propWreck, id);
  return true;
}

export function cityDamageSystem(world: World): void {
  // Buildings that fell over land first, so that what they crush is applied with the rest.
  advanceFalls(world);
  for (const hit of world.structureHits) applyStructureDamage(world, hit);
  world.structureHits.length = 0;
  // Units that fell with a bridge deck take their fall now, on the tick it fell: the damage
  // system has already run this tick (it used to land a tick late, which the soak test caught
  // on Port Meridian, where squads cross decks a titan is wading through).
  for (let i = 0; i < world.hits.length; i++) applyHit(world, world.hits[i].target, world.hits[i].hit);
  world.hits.length = 0;

  if (world.propHits.length > 0) {
    // One event per (player, cause) pair keeps the message count low when a titan walks a street.
    const groups = new Map<number, { by: PlayerId; cause: DamageKind; ids: number[] }>();
    const causes: DamageKind[] = [];
    for (const hit of world.propHits) {
      if (!removeProp(world, hit.id, hit.by, true)) continue;
      // A propane tank goes off (phase 2: the city as a weapon, sim/cityWeapons.ts).
      if (world.city.props[hit.id].kind === 'propane') propaneDestroyed(world, hit.id, hit.by, hit.cause);
      let causeIndex = causes.indexOf(hit.cause);
      if (causeIndex < 0) causeIndex = causes.push(hit.cause) - 1;
      const key = (hit.by + 1) * 64 + causeIndex;
      let group = groups.get(key);
      if (!group) {
        group = { by: hit.by, cause: hit.cause, ids: [] };
        groups.set(key, group);
      }
      group.ids.push(hit.id);
    }
    world.propHits.length = 0;
    for (const group of groups.values()) {
      emit(world, { type: 'propsDestroyed', ids: group.ids, by: group.by, cause: group.cause });
    }
  }

  checkBarMarks(world);
}

/**
 * Whether the bar has passed a mark (`barMark`), and the molt prompt. Run every tick by this
 * system; the match flow system runs it too when it fills the bar itself (never alone).
 */
export function checkBarMarks(world: World): void {
  const m = world.match;
  while (m.marksReached < 3 && m.barPoints >= m.marks[m.marksReached]) {
    m.marksReached++;
    emit(world, { type: 'barMark', mark: m.marksReached as 1 | 2 | 3, points: m.barPoints });
  }

  // The molt prompt: the bar is past this stage's mark and the kaiju has not cocooned yet. Checked
  // as a state, not only on the mark's tick, so a bar that already sits past the next mark when a
  // stage begins offers the next molt at once.
  if (m.phase === 'playing' && m.stage < LAST_STAGE && m.marksReached >= m.stage && m.marksReached < 3) {
    for (const k of world.kaijus) {
      if (!k.alive || k.moltAvailable || k.phase === 'cocoon') continue;
      k.moltAvailable = true;
      emit(world, { type: 'moltAvailable', kaiju: k.id, mark: m.stage as 1 | 2 });
    }
  }
}
