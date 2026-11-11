/**
 * System 9 of 11: city damage and the destruction bar.
 *
 * Drains the structure and prop damage queued during the tick. For every structure hit: remove
 * hp, add `value * hpLost / maxHp` points to the bar whoever caused it, emit `structureStage`
 * when the visual stage changes, and credit the player's tally when it collapses. Rubble takes
 * no damage and gives no points. Props are destroyed outright and add their value; cars and
 * other vehicles leave a wreck (`world.propWreck`) that a kaiju can pick up.
 * Then check whether the bar passed a mark and emit `barMark`.
 *
 * What a mark MEANS (molt prompt, kaiju win) is decided by the match flow system, which runs
 * right after this one and sees the `barMark` events in `world.events`.
 *
 * STUB(sim): Worker 1 (city destruction) owns the rest: the `barPoints` modifier and the
 * 'insuranceRider' flag from mods, structures shielded by sanctuaries (Tier 2), and anything
 * that should happen when a bridge deck falls under units standing on it.
 */

import { bitClear, bitGet, bitSet } from '../../math/bits';
import { PROP_KINDS } from '../../city/props';
import type { DamageKind } from '../../defs/ids';
import { COMBAT_RULES } from '../../defs/rules';
import { modMult } from '../../defs/upgrades';
import { structureStageFor } from '../bar';
import type { PlayerId } from '../config';
import type { StructureHit, World } from '../types';
import { emit } from '../worldOps';

/** Adds bar points caused by `by` and feeds the kaiju's rage when the kaiju did the wrecking. */
function addBarPoints(world: World, points: number, by: PlayerId): void {
  if (points <= 0) return;
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

/** Applies one queued hit to a structure. Returns the hp actually removed. */
export function applyStructureDamage(world: World, hit: StructureHit): number {
  const hp = world.structureHp[hit.id];
  if (!(hp > 0) || !(hit.damage > 0)) return 0;
  const s = world.city.structures[hit.id];
  const lost = Math.min(hp, hit.damage);
  const left = hp - lost;
  world.structureHp[hit.id] = left;
  addBarPoints(world, (s.value * lost) / s.hp, hit.by);

  const stage = structureStageFor(left, s.hp);
  if (stage !== world.structureStage[hit.id]) {
    world.structureStage[hit.id] = stage;
    emit(world, { type: 'structureStage', id: hit.id, stage, by: hit.by, cause: hit.cause });
    if (stage === 3) {
      const player = world.players[hit.by];
      if (player) player.tally.wrecked[s.cls]++;
    }
  }
  return lost;
}

export function cityDamageSystem(world: World): void {
  for (const hit of world.structureHits) applyStructureDamage(world, hit);
  world.structureHits.length = 0;

  if (world.propHits.length > 0) {
    // One event per (player, cause) pair keeps the message count low when a titan walks a street.
    const groups = new Map<number, { by: PlayerId; cause: DamageKind; ids: number[] }>();
    const causes: DamageKind[] = [];
    for (const hit of world.propHits) {
      if (!bitGet(world.propAlive, hit.id)) continue;
      bitClear(world.propAlive, hit.id);
      const def = PROP_KINDS[world.city.props[hit.id].kind];
      if (def.leavesWreck) bitSet(world.propWreck, hit.id);
      addBarPoints(world, def.value, hit.by);
      const player = world.players[hit.by];
      if (player && def.tally) player.tally.wrecked[def.tally]++;
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
}
