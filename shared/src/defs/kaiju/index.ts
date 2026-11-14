/**
 * Kaiju kind registry. To add a kind: write its definition file here, register it below, append
 * its id to KAIJU_KIND_IDS if it is new, and add at most one behavior module for its special.
 */

import type { KaijuKindId, KaijuVerb, StageId } from '../ids';
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

export { LIZARD };
