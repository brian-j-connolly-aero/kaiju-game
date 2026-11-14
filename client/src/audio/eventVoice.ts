/**
 * Voice lines for moments of phases 2 and 3 that the simulation has no voice cue for: a supply
 * crate for the player's own squad, the radio mast falling, a gas station going up, a substation
 * going down, the monster taking up a garage door as a shield, and civilians eaten. The client
 * says them for the simulation's own events (`MatchAudio`), each side its own lines: the squads
 * hear the radio, the monster's player hears the news.
 *
 * Every screen on a side picks the same line, because the pick comes from the event's tick. Each
 * cue waits its own gap before it is said again on a screen, so a busy fight is not all talk.
 *
 * The script is `eventLines.json`, in the same shape as the simulation's script
 * (`shared/src/defs/voiceLines.json`) and built into sound files with it by `tools/audio/voice`,
 * which checks both against the same writing rules (docs/VOICE_SCRIPT.md, the chapter "Phases 2
 * and 3"). A line's id is also its sound file and its text is its subtitle.
 */

import rawEventLines from './eventLines.json' with { type: 'json' };

/** The moments, and how long each waits before it is said again on one screen (seconds). */
export const EVENT_CUES = {
  /** A supply crate is coming down for the player's own squad. */
  'crate.drop': { gap: 45 },
  /** The player's own squad's crate has been lying on the ground for a few seconds. */
  'crate.land': { gap: 45 },
  /** A radio mast fell: the squads' maps show static. */
  'mast.down': { gap: 30 },
  /** A gas station went up in a fireball. */
  'gas.station': { gap: 30 },
  /** A substation went down: the district's power is cut and the monster surges. */
  'power.cut': { gap: 30 },
  /** The monster picked up a garage door to hold as a shield. */
  'door.shield': { gap: 90 },
  /** The monster gulped down a handful of civilians. */
  'civilians.eaten': { gap: 90 },
} as const;

export type EventCueId = keyof typeof EVENT_CUES;

export interface EventLine {
  /** Also the sound file: `audio/voice/<id>.ogg|.mp3`. */
  id: string;
  cue: EventCueId;
  /** The squads (radio) or the monster's player (news). */
  audience: 'humans' | 'kaiju';
  speaker: string;
  /** The subtitle. */
  text: string;
}

/** Validates the script. Never throws: a bad entry is left out and reported, like the simulation's script. */
export function parseEventLines(raw: unknown): { lines: EventLine[]; problems: string[] } {
  const lines: EventLine[] = [];
  const problems: string[] = [];
  if (!Array.isArray(raw)) return { lines, problems: ['event lines are not an array'] };
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index: number) => {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const { id, cue, audience, speaker, text } = e;
    const label = typeof id === 'string' ? `"${id}"` : `entry ${index}`;
    if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id) || seen.has(id)) problems.push(`${label}: missing, malformed or duplicate id`);
    else if (typeof cue !== 'string' || !(cue in EVENT_CUES)) problems.push(`${label}: unknown cue ${JSON.stringify(cue)}`);
    else if (audience !== 'humans' && audience !== 'kaiju') problems.push(`${label}: unknown audience ${JSON.stringify(audience)}`);
    else if (typeof speaker !== 'string' || speaker.length === 0) problems.push(`${label}: missing speaker`);
    else if (typeof text !== 'string' || text.length === 0) problems.push(`${label}: missing text`);
    else {
      seen.add(id);
      lines.push({ id, cue: cue as EventCueId, audience, speaker, text });
    }
  });
  return { lines, problems };
}

const SCRIPT = parseEventLines(rawEventLines);

/** Every valid line, in script order. */
export const EVENT_LINES: readonly EventLine[] = SCRIPT.lines;
/** Problems found in eventLines.json (empty when the script is valid). */
export const EVENT_LINE_PROBLEMS: readonly string[] = SCRIPT.problems;

/** The line a side hears for a moment, picked by `seed` (the event's tick), or null when that side hears nothing. */
export function eventLine(cue: EventCueId, side: 'humans' | 'kaiju', seed: number): EventLine | null {
  const pool = EVENT_LINES.filter((l) => l.cue === cue && l.audience === side);
  if (pool.length === 0) return null;
  const i = ((Math.floor(seed) % pool.length) + pool.length) % pool.length;
  return pool[i];
}
