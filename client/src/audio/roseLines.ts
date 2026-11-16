/**
 * What the communication rose says (shared/src/net/rose.ts holds the wedges' order, which is
 * what goes over the wire).
 *
 * The army's lines are `roseLines.json`: per wedge, a few one-sentence lines of 1950s
 * monster-movie radio, shouted. The voice tools (tools/audio/voice) speak every line in every
 * squad's voice (`voices`, the squad callsigns) through the radio chain, as the sound file
 * `rose_<voice>_<wedge>_<n>`; a later voice pass can replace the files from the same data file.
 * A line's text is its subtitle, shown with the name of the squad's player.
 *
 * The monster has no words: each of its wedges is a sound effect at the three sizes of the
 * monster (`kaiju_rose_<sound>_s<stage>`, made by tools/audio/sfx/mbsfx/rose.py), in
 * ROSE_SOUND_VARIANTS versions each.
 *
 * Every screen picks the same line or version: the server's `pick` decides (`rosePick`).
 */

import { ROSE_ARMY, ROSE_KAIJU, rosePick, SQUAD_CALLSIGNS, type RoseArmyId, type RoseKaijuId, type StageId } from '@mb/shared';
import rawRoseLines from './roseLines.json' with { type: 'json' };

/** A line as the voice queue takes it: the sound file, who says it (the subtitle's name) and the words. */
export interface RoseLine {
  id: string;
  speaker: string;
  text: string;
}

interface RoseScript {
  voices: string[];
  army: Record<string, string[]>;
}

const SCRIPT = rawRoseLines as RoseScript;

/** The squad voices every army line is spoken in (the squad callsigns, in squad order). */
export const ROSE_VOICES: readonly string[] = SCRIPT.voices;

/** The army's lines, per wedge, in file order. */
export function roseTexts(cat: RoseArmyId): readonly string[] {
  return SCRIPT.army[cat] ?? [];
}

/** The sound file of line `n` (from 0) of a wedge, in a voice. */
export function roseLineId(voice: string, cat: RoseArmyId, n: number): string {
  return `rose_${voice.toLowerCase()}_${cat}_${n + 1}`;
}

/** The voice a squad's leader shouts in: the squad's callsign, if it is one of the voices. */
export function roseVoiceOf(callsign: string, squadId: number): string {
  if (ROSE_VOICES.includes(callsign)) return callsign;
  const fallback = SQUAD_CALLSIGNS[((squadId % SQUAD_CALLSIGNS.length) + SQUAD_CALLSIGNS.length) % SQUAD_CALLSIGNS.length];
  return ROSE_VOICES.includes(fallback) ? fallback : ROSE_VOICES[0];
}

/** The army line a wedge and a pick stand for, in a voice, said by `speaker`. Null for a wedge that is not one. */
export function roseArmyLine(cat: number, pick: number, voice: string, speaker: string): RoseLine | null {
  const id = ROSE_ARMY[cat];
  if (id === undefined) return null;
  const texts = roseTexts(id);
  const n = rosePick(pick, texts.length);
  if (n < 0) return null;
  return { id: roseLineId(voice, id, n), speaker, text: texts[n] };
}

/** Versions of each of the monster's rose sounds. */
export const ROSE_SOUND_VARIANTS = 2;

/** The sound effect of each of the monster's wedges (add `_s<stage>`). */
export const ROSE_KAIJU_SOUNDS: Readonly<Record<RoseKaijuId, string>> = {
  roar: 'kaiju_rose_roar',
  roarShort: 'kaiju_rose_roar_short',
  snuffle: 'kaiju_rose_snuffle',
  growl: 'kaiju_rose_growl',
  chomp: 'kaiju_rose_chomp',
  rumble: 'kaiju_rose_rumble',
  mating: 'kaiju_rose_mating',
};

/** The monster's sound for a wedge at a stage, and which version a pick stands for. Null for a wedge that is not one. */
export function roseKaijuSound(cat: number, pick: number, stage: StageId): { id: string; variant: number } | null {
  const id = ROSE_KAIJU[cat];
  if (id === undefined) return null;
  return { id: `${ROSE_KAIJU_SOUNDS[id]}_s${stage}`, variant: rosePick(pick, ROSE_SOUND_VARIANTS) };
}

/** Every army line's sound file (for the tests and the manifest check). */
export function allRoseLineIds(): string[] {
  const out: string[] = [];
  for (const voice of ROSE_VOICES) for (const cat of ROSE_ARMY) roseTexts(cat).forEach((_t, n) => out.push(roseLineId(voice, cat, n)));
  return out;
}
