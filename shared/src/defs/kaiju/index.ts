/**
 * Kaiju kind registry. To add a kind: write its definition file here, register it below, append
 * its id to KAIJU_KIND_IDS if it is new, and add at most one behavior module for its special.
 */

import type { KaijuKindId, KaijuMoveId, KaijuVerb, StageId } from '../ids';
import { perStage } from '../ids';
import type { KaijuActionDef, KaijuKindDef, KaijuStageDef } from '../schema';
import { LIZARD } from './lizard';

export const KAIJU_KINDS: Readonly<Partial<Record<KaijuKindId, KaijuKindDef>>> = {
  lizard: LIZARD,
};

/** Kinds that can be picked today. */
export const PLAYABLE_KAIJU_KINDS: readonly KaijuKindId[] = ['lizard'];

export const DEFAULT_KAIJU_KIND: KaijuKindId = 'lizard';

export function kaijuKindDef(kind: KaijuKindId): KaijuKindDef {
  const def = KAIJU_KINDS[kind];
  if (!def) throw new Error(`kaiju kind "${kind}" is not registered`);
  return def;
}

export function kaijuStageDef(kind: KaijuKindId, stage: StageId): KaijuStageDef {
  return perStage(kaijuKindDef(kind).stages, stage);
}

export function kaijuActionDef(kind: KaijuKindId, verb: KaijuVerb): KaijuActionDef {
  return kaijuKindDef(kind).actions[verb];
}

/** The verb a move picked at a molt performs ('none' for an empty slot): the beam is the special. */
export function kaijuMoveVerb(move: KaijuMoveId): KaijuVerb | 'none' {
  switch (move) {
    case 'beam':
      return 'special';
    case 'none':
      return 'none';
    default:
      return move;
  }
}

/** The slot (0 or 1) a kaiju holding these moves has put a verb in, or -1 when it has not picked it. */
export function kaijuMoveSlot(moves: readonly KaijuMoveId[], verb: KaijuVerb): number {
  for (let i = 0; i < moves.length; i++) if (kaijuMoveVerb(moves[i]) === verb) return i;
  return -1;
}

export { LIZARD };
