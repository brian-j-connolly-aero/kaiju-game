/**
 * Voice cues: the contract between the simulation (which emits cue ids) and the audio (which
 * voices lines for them). The script itself is `voiceLines.json`, owned by the audio team
 * (schema in ASSETS.md section 6). This module only reads it.
 */

import rawVoiceLines from './voiceLines.json' with { type: 'json' };

/** Every cue the simulation can emit (DESIGN.md section 8). */
export const VOICE_CUE_IDS = [
  'match.briefing',
  'match.start',
  'kaiju.spotted',
  'kaiju.lost',
  'volley.ready',
  'volley.fired',
  'crossfire',
  'nerve.break',
  'stagger.end',
  'kaiju.brace',
  'kaiju.roar',
  'kaiju.special',
  'building.down',
  'landmark.down',
  'collateral.human',
  'unit.lost',
  'squad.wiped',
  'player.takeover',
  'molt.available',
  'cocoon.start',
  'molt.blast',
  'stage.2',
  'stage.3',
  'callin.inbound',
  'clock.3min',
  'clock.1min',
  'clock.10s',
  'kaiju.lowhp',
  'bar.near',
  'end.humans.kill',
  'end.humans.clock',
  'end.kaiju',
  'hearing.humans.win',
  'hearing.kaiju.win',
] as const;
export type VoiceCueId = (typeof VOICE_CUE_IDS)[number];

export const VOICE_AUDIENCES = ['humans', 'kaiju', 'all'] as const;
/** Who hears a line: the human squads (military radio), the kaiju player (news broadcast), or everyone. */
export type VoiceAudience = (typeof VOICE_AUDIENCES)[number];

export interface VoiceLine {
  /** Also the audio file name: `audio/voice/<id>.ogg|.mp3`. */
  id: string;
  cue: VoiceCueId;
  audience: VoiceAudience;
  speaker: string;
  /** Subtitle text. */
  text: string;
}

/**
 * Cues whose lines are played one after another, in script order, instead of one being picked.
 * Every other cue plays a single line chosen by the `variant` number in the voice event.
 */
export const VOICE_SEQUENCE_CUES: readonly VoiceCueId[] = ['match.briefing'];

/**
 * Default squad callsigns, by squad index. The first three have voiced radio lines in the
 * script; lines for a cue fall back to Overlord when a squad has none of its own.
 */
export const SQUAD_CALLSIGNS: readonly string[] = ['Granite', 'Beacon', 'Tempest', 'Anvil'];

export interface VoiceScript {
  lines: VoiceLine[];
  /** One message per entry that broke the schema; such entries are dropped, never thrown on. */
  problems: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates raw script data. Never throws: a bad entry is skipped and reported in `problems`, so
 * a script mistake costs one voice line, not the game. Tests assert that `problems` is empty.
 */
export function parseVoiceLines(raw: unknown): VoiceScript {
  const lines: VoiceLine[] = [];
  const problems: string[] = [];
  if (!Array.isArray(raw)) {
    return { lines, problems: ['voice script is not an array'] };
  }
  const seen = new Set<string>();
  const cues: readonly string[] = VOICE_CUE_IDS;
  const audiences: readonly string[] = VOICE_AUDIENCES;
  raw.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      problems.push(`entry ${index}: not an object`);
      return;
    }
    const { id, cue, audience, speaker, text } = entry;
    const label = typeof id === 'string' ? `"${id}"` : `entry ${index}`;
    if (typeof id !== 'string' || id.length === 0) {
      problems.push(`${label}: missing id`);
      return;
    }
    if (!/^[a-z0-9_]+$/.test(id)) {
      problems.push(`${label}: id must be lower case letters, digits and underscores (it is a file name)`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${label}: duplicate id`);
      return;
    }
    if (typeof cue !== 'string' || !cues.includes(cue)) {
      problems.push(`${label}: unknown cue ${JSON.stringify(cue)}`);
      return;
    }
    if (typeof audience !== 'string' || !audiences.includes(audience)) {
      problems.push(`${label}: unknown audience ${JSON.stringify(audience)}`);
      return;
    }
    if (typeof speaker !== 'string' || speaker.length === 0) {
      problems.push(`${label}: missing speaker`);
      return;
    }
    if (typeof text !== 'string' || text.length === 0) {
      problems.push(`${label}: missing text`);
      return;
    }
    seen.add(id);
    lines.push({ id, cue: cue as VoiceCueId, audience: audience as VoiceAudience, speaker, text });
  });
  return { lines, problems };
}

const SCRIPT: VoiceScript = parseVoiceLines(rawVoiceLines);

/** Every valid line of the script, in script order. */
export const VOICE_LINES: readonly VoiceLine[] = SCRIPT.lines;
/** Schema problems found in voiceLines.json (empty when the script is valid). */
export const VOICE_LINE_PROBLEMS: readonly string[] = SCRIPT.problems;

/**
 * Lines a listener on the given side can hear for a cue, in script order: lines addressed to
 * that side plus lines addressed to everyone.
 */
export function voiceLinesFor(
  cue: VoiceCueId,
  listener: 'humans' | 'kaiju',
  lines: readonly VoiceLine[] = VOICE_LINES,
): VoiceLine[] {
  return lines.filter((l) => l.cue === cue && (l.audience === listener || l.audience === 'all'));
}

/**
 * Picks the line to play for a cue. `variant` is the number carried by the voice event, so every
 * client hearing the cue picks the same line. Lines spoken by `preferSpeaker` (a squad callsign)
 * win when there are any. Returns null when the script has nothing for this listener.
 */
export function pickVoiceLine(
  cue: VoiceCueId,
  listener: 'humans' | 'kaiju',
  variant: number,
  preferSpeaker?: string,
  lines: readonly VoiceLine[] = VOICE_LINES,
): VoiceLine | null {
  let pool = voiceLinesFor(cue, listener, lines);
  if (pool.length === 0) return null;
  if (preferSpeaker) {
    const own = pool.filter((l) => l.speaker === preferSpeaker);
    if (own.length > 0) pool = own;
  }
  const i = ((Math.floor(variant) % pool.length) + pool.length) % pool.length;
  return pool[i];
}

/** Cues with no line at all for a listener; used by tests and tools to report script coverage. */
export function missingVoiceCues(
  listener: 'humans' | 'kaiju',
  lines: readonly VoiceLine[] = VOICE_LINES,
): VoiceCueId[] {
  return VOICE_CUE_IDS.filter((cue) => voiceLinesFor(cue, listener, lines).length === 0);
}
