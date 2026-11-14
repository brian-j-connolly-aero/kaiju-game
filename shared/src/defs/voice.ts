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
 * How urgent a cue is. 2: the match turns on it, it always goes out. 1: worth interrupting
 * routine chatter for. 0: routine chatter, which is rationed (VOICE_RULES).
 */
export type VoicePriority = 0 | 1 | 2;

export interface VoiceCueRule {
  priority: VoicePriority;
  /** Minimum seconds between two emissions of this cue; 0 for none. */
  gap: number;
}

/** Radio discipline per cue: how urgent it is and how soon it may be heard again. */
export const VOICE_CUE_RULES: Readonly<Record<VoiceCueId, VoiceCueRule>> = {
  'match.briefing': { priority: 2, gap: 0 },
  'match.start': { priority: 2, gap: 0 },
  'kaiju.spotted': { priority: 1, gap: 15 },
  'kaiju.lost': { priority: 0, gap: 15 },
  'volley.ready': { priority: 0, gap: 10 },
  'volley.fired': { priority: 0, gap: 8 },
  crossfire: { priority: 1, gap: 12 },
  'nerve.break': { priority: 2, gap: 0 },
  'stagger.end': { priority: 0, gap: 0 },
  'kaiju.brace': { priority: 0, gap: 15 },
  'kaiju.roar': { priority: 0, gap: 12 },
  'kaiju.special': { priority: 1, gap: 5 },
  'building.down': { priority: 0, gap: 9 },
  'landmark.down': { priority: 2, gap: 2 },
  'collateral.human': { priority: 1, gap: 12 },
  'unit.lost': { priority: 0, gap: 6 },
  'squad.wiped': { priority: 1, gap: 0 },
  'player.takeover': { priority: 1, gap: 4 },
  'molt.available': { priority: 2, gap: 0 },
  'cocoon.start': { priority: 2, gap: 0 },
  'molt.blast': { priority: 2, gap: 0 },
  'stage.2': { priority: 2, gap: 0 },
  'stage.3': { priority: 2, gap: 0 },
  'callin.inbound': { priority: 1, gap: 10 },
  'clock.3min': { priority: 2, gap: 0 },
  'clock.1min': { priority: 2, gap: 0 },
  'clock.10s': { priority: 2, gap: 0 },
  'kaiju.lowhp': { priority: 1, gap: 20 },
  'bar.near': { priority: 1, gap: 20 },
  'end.humans.kill': { priority: 2, gap: 0 },
  'end.humans.clock': { priority: 2, gap: 0 },
  'end.kaiju': { priority: 2, gap: 0 },
  'hearing.humans.win': { priority: 2, gap: 0 },
  'hearing.kaiju.win': { priority: 2, gap: 0 },
};

/** The chatter budget and the thresholds of the two cues that watch a number. */
export const VOICE_RULES = {
  /** Routine cues (priority 0) spend one token each; none left, nothing said. */
  chatterTokens: 2,
  /** Seconds for one token to come back: the long-run pace of routine chatter. */
  chatterRefill: 5,
  /** `kaiju.lowhp` is called when a kaiju first drops below this fraction of its hp in a stage. */
  lowHpFraction: 0.25,
  /** `bar.near` is called when the bar is this far along the way from the last mark to the next. */
  barNearFraction: 0.85,
} as const;

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

let linesByCue: Map<VoiceCueId, VoiceLine[]> | null = null;

/** The shipped script, grouped by cue (built on first use from whatever the script holds today). */
function scriptLinesFor(cue: VoiceCueId): readonly VoiceLine[] {
  if (!linesByCue) {
    linesByCue = new Map();
    for (const line of VOICE_LINES) {
      const list = linesByCue.get(line.cue);
      if (list) list.push(line);
      else linesByCue.set(line.cue, [line]);
    }
  }
  return linesByCue.get(cue) ?? [];
}

export interface VoiceChoice {
  /** The squad callsign whose own lines are preferred (the squad the cue is about), if any. */
  callsign?: string;
  /** Every squad callsign in the match: a line spoken by ANOTHER squad is never put in this one's mouth. */
  callsigns?: readonly string[];
  /** Id of the line this cue played last time on this side; another one is taken when there is a choice. */
  avoid?: string;
}

/**
 * Chooses the lines one side hears for a cue, deterministically from `variant`. A sequence cue
 * (the briefing) gets all of its lines in script order; every other cue gets one:
 * - when the cue is about a squad that has lines of its own, one of those;
 * - when it is about a squad that has none, a line that is not spoken by some other squad
 *   (command, the news anchor), falling back to any line at all;
 * - when it is about nobody in particular, any line: whoever is on the radio says it;
 * - never the line in `avoid` when there is another to take.
 * Returns an empty list when the script has nothing for this side.
 */
export function chooseVoiceLines(
  cue: VoiceCueId,
  listener: 'humans' | 'kaiju',
  variant: number,
  choice: VoiceChoice = {},
  lines?: readonly VoiceLine[],
): VoiceLine[] {
  const all = lines ? lines.filter((l) => l.cue === cue) : scriptLinesFor(cue);
  let pool = all.filter((l) => l.audience === listener || l.audience === 'all');
  if (pool.length === 0) return [];
  if (VOICE_SEQUENCE_CUES.includes(cue)) return pool;

  if (choice.callsign) {
    const own = pool.filter((l) => l.speaker === choice.callsign);
    if (own.length > 0) {
      pool = own;
    } else if (choice.callsigns) {
      const others = choice.callsigns.filter((c) => c !== choice.callsign);
      const neutral = pool.filter((l) => !others.includes(l.speaker));
      if (neutral.length > 0) pool = neutral;
    }
  }
  let i = ((Math.floor(variant) % pool.length) + pool.length) % pool.length;
  if (pool.length > 1 && pool[i].id === choice.avoid) i = (i + 1) % pool.length;
  return [pool[i]];
}

/** Cues with no line at all for a listener; used by tests and tools to report script coverage. */
export function missingVoiceCues(
  listener: 'humans' | 'kaiju',
  lines: readonly VoiceLine[] = VOICE_LINES,
): VoiceCueId[] {
  return VOICE_CUE_IDS.filter((cue) => voiceLinesFor(cue, listener, lines).length === 0);
}
