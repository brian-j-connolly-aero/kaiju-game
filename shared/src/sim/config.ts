/** Match configuration: everything createWorld needs besides the seed. Plain JSON-safe data. */

import { CITY_SEED } from '../city/types';
import { DEFAULT_FACTION } from '../defs/factions';
import type { FactionId, KaijuKindId, Role } from '../defs/ids';
import { DEFAULT_KAIJU_KIND } from '../defs/kaiju/index';
import { MATCH_RULES } from '../defs/rules';
import { SQUAD_CALLSIGNS } from '../defs/voice';

/** A player's slot in the match: its index in MatchConfig.players. A small integer, stable all match. */
export type PlayerId = number;

/** Marks "nobody" wherever a PlayerId is optional. */
export const NO_PLAYER: PlayerId = -1;

export interface PlayerSlot {
  id: PlayerId;
  /** Display name of the person, or of the bot. */
  name: string;
  role: Role;
  /** True when a bot plays this slot from the start (the server can also hand a slot to a bot mid-match). */
  bot: boolean;
  /** Used when role is 'human'. */
  faction: FactionId;
  /** Used when role is 'kaiju'. */
  kaijuKind: KaijuKindId;
  /** Radio callsign of the squad (humans); empty for the kaiju. */
  callsign: string;
}

/** Timers and scale knobs; `fastTuning()` shortens everything for automated playtests (MB_FAST=1). */
export interface MatchTuning {
  /** Seconds on the match clock. */
  clock: number;
  briefing: number;
  intermission: number;
  cocoon: number;
  /** Multiplier on the three destruction bar marks (below 1 makes a shorter match). */
  barScale: number;
}

/**
 * How well the bots of a match play, per side. A handicap of 0 is the bot at its (deliberately
 * beatable) best; 1 leaves it standing still with its hands off the buttons; in between it
 * hesitates that much of the time. For the balance harness, tests and practice options.
 */
export interface BotTuning {
  kaijuHandicap: number;
  humanHandicap: number;
  /**
   * Squad bots play the lazy way: parked, they pull the trigger every time the gun has loaded
   * instead of waiting for a full charge. A profile for the balance harness, so that it can
   * measure what undisciplined fire is worth (docs/BALANCE.md). Absent or false: they volley.
   */
  triggerHappy?: boolean;
}

export interface MatchConfig {
  /** Every slot in the match, kaiju and humans; `players[i].id === i`. */
  players: PlayerSlot[];
  citySeed: number;
  /** Starting neighborhood anchor id, or -1 to pick one at random from the match seed. */
  anchor: number;
  /** Tier 2: whether upgrade drafts happen at each molt. */
  drafts: boolean;
  tuning: MatchTuning;
  /** Bot handicaps; absent means every bot plays at its best. */
  bots?: BotTuning;
}

export function defaultTuning(): MatchTuning {
  return {
    clock: MATCH_RULES.clock,
    briefing: MATCH_RULES.briefing,
    intermission: MATCH_RULES.intermission,
    cocoon: MATCH_RULES.cocoon,
    barScale: 1,
  };
}

/** Short timers and a small bar so a whole match fits in about a minute of automated play. */
export function fastTuning(): MatchTuning {
  return { clock: 150, briefing: 1, intermission: 1.5, cocoon: 2, barScale: 0.12 };
}

export interface MatchConfigOptions {
  /** Human-controlled slots. Everything else is filled with bots. */
  humans?: Array<{ name: string; role: Role; faction?: FactionId; kaijuKind?: KaijuKindId }>;
  squads?: number;
  anchor?: number;
  citySeed?: number;
  fast?: boolean;
  drafts?: boolean;
  /** Bot handicaps (see BotTuning); left out of the config when not given. */
  bots?: Partial<BotTuning>;
}

/**
 * Builds a complete Tier 1 config: one kaiju and `squads` human squads (default 4). The given
 * people take the kaiju slot and the first human slots according to their role; bots fill the
 * rest. With no arguments it is an all-bot match, which is what `npm run sim` and most tests use.
 * Slot 0 is always the kaiju.
 */
export function createMatchConfig(options: MatchConfigOptions = {}): MatchConfig {
  const squads = options.squads ?? MATCH_RULES.squadsPerKaiju;
  const people = options.humans ?? [];
  const kaijuPerson = people.find((p) => p.role === 'kaiju');
  const humanPeople = people.filter((p) => p.role === 'human').slice(0, squads);

  const players: PlayerSlot[] = [];
  players.push({
    id: 0,
    name: kaijuPerson?.name ?? 'Kaiju',
    role: 'kaiju',
    bot: !kaijuPerson,
    faction: DEFAULT_FACTION,
    kaijuKind: kaijuPerson?.kaijuKind ?? DEFAULT_KAIJU_KIND,
    callsign: '',
  });
  for (let i = 0; i < squads; i++) {
    const person = humanPeople[i];
    const callsign = SQUAD_CALLSIGNS[i % SQUAD_CALLSIGNS.length];
    players.push({
      id: players.length,
      name: person?.name ?? callsign,
      role: 'human',
      bot: !person,
      faction: person?.faction ?? DEFAULT_FACTION,
      kaijuKind: DEFAULT_KAIJU_KIND,
      callsign,
    });
  }
  const config: MatchConfig = {
    players,
    citySeed: options.citySeed ?? CITY_SEED,
    anchor: options.anchor ?? -1,
    drafts: options.drafts ?? false,
    tuning: options.fast ? fastTuning() : defaultTuning(),
  };
  if (options.bots) {
    config.bots = { kaijuHandicap: options.bots.kaijuHandicap ?? 0, humanHandicap: options.bots.humanHandicap ?? 0 };
    if (options.bots.triggerHappy) config.bots.triggerHappy = true;
  }
  return config;
}

/** Handicaps that leave every bot standing still (what tests of a single rule want around them). */
export function idleBots(): BotTuning {
  return { kaijuHandicap: 1, humanHandicap: 1 };
}
