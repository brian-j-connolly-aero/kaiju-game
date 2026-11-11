/**
 * System 9 of 11: city damage and the destruction bar.
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
 */

import { bitClear, bitGet, bitSet } from '../../math/bits';
import { pointInObb } from '../../math/geom';
import { PROP_KINDS } from '../../city/props';
import type { Structure } from '../../city/types';
import type { DamageKind } from '../../defs/ids';
import { COMBAT_RULES } from '../../defs/rules';
import { LAST_STAGE } from '../../defs/stages';
import type { Mods } from '../../defs/schema';
import { hasModFlag, modMult } from '../../defs/upgrades';
import { structureStageFor } from '../bar';
import type { PlayerId } from '../config';
import { noteKaijuNoise } from '../spotting';
import type { StructureHit, World } from '../types';
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
    const k = world.kaijus[player.kaijuId];
    const lo = m.stage > 1 ? m.marks[m.stage - 2] : 0;
    const segment = m.marks[m.stage - 1] - lo;
    if (segment > 0) {
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
    }
  }
  return lost;
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
  for (const hit of world.structureHits) applyStructureDamage(world, hit);
  world.structureHits.length = 0;

  if (world.propHits.length > 0) {
    // One event per (player, cause) pair keeps the message count low when a titan walks a street.
    const groups = new Map<number, { by: PlayerId; cause: DamageKind; ids: number[] }>();
    const causes: DamageKind[] = [];
    for (const hit of world.propHits) {
      if (!removeProp(world, hit.id, hit.by, true)) continue;
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
