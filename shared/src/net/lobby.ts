/**
 * Lobby state and the rules that turn a lobby into a match (DESIGN.md section 2).
 *
 * The server owns the LobbyState and sends it to every client as JSON whenever it changes.
 * People in the lobby have a `seat` (0..4, stable while they are in the room). When the match
 * starts, `buildMatchConfig` gives every seat a match slot (PlayerId): slot 0 is the kaiju,
 * slots 1..4 are the human squads; bots take every slot nobody sits in.
 */

import { DEFAULT_FACTION, PLAYABLE_FACTIONS } from '../defs/factions';
import type { FactionId, KaijuKindId } from '../defs/ids';
import { DEFAULT_KAIJU_KIND, PLAYABLE_KAIJU_KINDS } from '../defs/kaiju/index';
import { MATCH_RULES } from '../defs/rules';
import { rngInt, type Rng } from '../math/rng';
import { createMatchConfig, type MatchConfig, type PlayerId } from '../sim/config';

export const ROOM_CODE_LENGTH = 4;
/** Letters used in room codes: no vowels (no accidental words), no easily confused letters. */
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const MAX_NAME_LENGTH = 16;

/** Where the room is in its life: create -> lobby -> match -> end -> lobby. */
export const ROOM_PHASES = ['lobby', 'match', 'end'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

export interface LobbyPlayer {
  /** Seat in the room, 0..4. */
  seat: number;
  name: string;
  /** Volunteers to be the kaiju. */
  wantsKaiju: boolean;
  /** Faction to field when playing a human squad. */
  faction: FactionId;
  /** Kaiju to be when playing the kaiju. */
  kaijuKind: KaijuKindId;
  ready: boolean;
  /** False while the player is disconnected and may still reclaim the seat. */
  connected: boolean;
  /**
   * Set by the server in the lobby: this player has been in the lobby long enough (20 s by
   * default) that the host may start without waiting for their ready. A player who is not
   * ready and not yet `waited` is who the start is waiting for.
   */
  waited?: boolean;
  /**
   * Set by the server: the match slot (PlayerId) this seat plays while the room is in a match or
   * on the end screen; -1 for a spectator and whenever the room is in the lobby.
   */
  slot?: number;
}

export interface LobbyOptions {
  /** Practice: a bot plays the kaiju and every person plays a squad. */
  botKaiju: boolean;
  /** Short timers and a small bar (the server sets this from MB_FAST=1). */
  fast: boolean;
}

export interface LobbyState {
  /** The 4-letter room code (also in the URL hash). */
  code: string;
  phase: RoomPhase;
  /** Seat of the host (the first player in the room); the host starts the match. */
  host: number;
  players: LobbyPlayer[];
  options: LobbyOptions;
  /**
   * Seat that played the kaiju in the most recent match, or -1 (nobody yet, or a bot). The
   * server sets it when a match starts, so during a match it is the current kaiju's seat.
   */
  lastKaijuSeat: number;
}

export function createLobbyState(code: string): LobbyState {
  return { code, phase: 'lobby', host: -1, players: [], options: { botKaiju: false, fast: false }, lastKaijuSeat: -1 };
}

/** A random room code from the seeded generator. */
export function makeRoomCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[rngInt(rng, ROOM_CODE_ALPHABET.length)];
  return code;
}

/**
 * Characters that never belong in a name: control characters (some terminals read U+009B as
 * the start of an escape sequence), invisible and direction-changing format characters
 * (zero-width spaces, right-to-left overrides), line and paragraph separators, halves of a
 * surrogate pair, letters that are drawn as blanks, and the two characters of markup.
 */
const NAME_JUNK = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\u115f\u1160\u2800\u3164\uffa0<>]/gu;

/**
 * Turns a requested display name into something safe to show and to print: composed form, no
 * junk characters, single spaces, at most two combining marks on a letter, cut to
 * MAX_NAME_LENGTH whole characters (never through the middle of an emoji). Falls back to
 * "Player N" when nothing visible is left.
 */
export function cleanPlayerName(raw: unknown, seat: number): string {
  const fallback = `Player ${seat + 1}`;
  if (typeof raw !== 'string') return fallback;
  const text = raw
    .slice(0, 256)
    .normalize('NFC')
    .replace(NAME_JUNK, '')
    .replace(/\s+/gu, ' ')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .trim();
  const name = Array.from(text).slice(0, MAX_NAME_LENGTH).join('').trim();
  return /[^\s\p{M}]/u.test(name) ? name : fallback;
}

/** Adds a player in the lowest free seat. Returns the new player, or null when the room is full. */
export function addLobbyPlayer(lobby: LobbyState, name: string): LobbyPlayer | null {
  if (lobby.players.length >= MATCH_RULES.maxPlayers) return null;
  let seat = 0;
  while (lobby.players.some((p) => p.seat === seat)) seat++;
  const player: LobbyPlayer = {
    seat,
    name: cleanPlayerName(name, seat),
    wantsKaiju: false,
    faction: DEFAULT_FACTION,
    kaijuKind: DEFAULT_KAIJU_KIND,
    ready: false,
    connected: true,
  };
  lobby.players.push(player);
  lobby.players.sort((a, b) => a.seat - b.seat);
  if (lobby.host < 0) lobby.host = seat;
  return player;
}

/** Removes a player for good. The host role passes to the lowest remaining seat. */
export function removeLobbyPlayer(lobby: LobbyState, seat: number): void {
  lobby.players = lobby.players.filter((p) => p.seat !== seat);
  if (lobby.host === seat) lobby.host = lobby.players.length > 0 ? lobby.players[0].seat : -1;
  if (lobby.lastKaijuSeat === seat) lobby.lastKaijuSeat = -1;
}

/** True when this player does not hold the start up: they are the host, ready, or have had their time. */
function startNeedNotWaitFor(lobby: LobbyState, p: LobbyPlayer): boolean {
  return p.ready || p.seat === lobby.host || p.waited === true;
}

/**
 * Whether the host may start: everyone connected is ready (the host's own ready flag is
 * implied) or has been in the lobby long enough that the server no longer makes the others
 * wait for them (`LobbyPlayer.waited`). One person who walked away cannot keep a room from
 * playing; they are in the match all the same and find their squad when they come back.
 */
export function canStartMatch(lobby: LobbyState): boolean {
  const present = lobby.players.filter((p) => p.connected);
  return present.length > 0 && present.every((p) => startNeedNotWaitFor(lobby, p));
}

/**
 * Chooses who plays the kaiju. Returns a seat, or -1 for a bot kaiju.
 * - Practice option: always a bot.
 * - Volunteers go first (a random one if several; one who was not the kaiju last match if possible).
 * - Otherwise the role rotates: a random connected player, never the same one twice in a row.
 * - A lone player who did not volunteer plays a squad against a bot kaiju.
 * - Somebody the host started without (connected, not ready, `waited`) is never the kaiju: the
 *   match must not hang on a player who may not be at the keyboard.
 */
export function pickKaijuSeat(lobby: LobbyState, rng: Rng): number {
  const present = lobby.players.filter((p) => p.connected);
  if (lobby.options.botKaiju || present.length === 0) return -1;
  const here = present.filter((p) => p.ready || p.seat === lobby.host || !p.waited);
  const volunteers = here.filter((p) => p.wantsKaiju);
  if (volunteers.length === 1) return volunteers[0].seat;
  if (present.length === 1 && volunteers.length === 0) return -1;
  if (here.length === 0) return -1;
  let pool = volunteers.length > 0 ? volunteers : here;
  if (MATCH_RULES.rotateKaijuRole) {
    const fresh = pool.filter((p) => p.seat !== lobby.lastKaijuSeat);
    if (fresh.length > 0) pool = fresh;
  }
  return pool[rngInt(rng, pool.length)].seat;
}

export interface MatchSeating {
  config: MatchConfig;
  /** Match slot (PlayerId) of every seat, indexed by seat; -1 for empty seats. */
  slotBySeat: PlayerId[];
}

/**
 * Builds the match config for a lobby: the chosen seat (or a bot) is the kaiju in slot 0, the
 * other connected players lead squads in seat order, bots fill the remaining squads.
 */
export function buildMatchConfig(lobby: LobbyState, kaijuSeat: number, anchor = -1): MatchSeating {
  const present = lobby.players.filter((p) => p.connected);
  const kaiju = present.find((p) => p.seat === kaijuSeat);
  const humans = present.filter((p) => p.seat !== kaijuSeat).slice(0, MATCH_RULES.squadsPerKaiju);
  const people: NonNullable<Parameters<typeof createMatchConfig>[0]>['humans'] = [];
  if (kaiju) {
    const kind = PLAYABLE_KAIJU_KINDS.includes(kaiju.kaijuKind) ? kaiju.kaijuKind : DEFAULT_KAIJU_KIND;
    people.push({ name: kaiju.name, role: 'kaiju', kaijuKind: kind });
  }
  for (const h of humans) {
    const faction = PLAYABLE_FACTIONS.includes(h.faction) ? h.faction : DEFAULT_FACTION;
    people.push({ name: h.name, role: 'human', faction });
  }
  const config = createMatchConfig({ humans: people, anchor, fast: lobby.options.fast });

  const slotBySeat: PlayerId[] = [];
  for (let seat = 0; seat < MATCH_RULES.maxPlayers; seat++) slotBySeat.push(-1);
  if (kaiju) slotBySeat[kaiju.seat] = 0;
  humans.forEach((h, i) => {
    slotBySeat[h.seat] = 1 + i;
  });
  return { config, slotBySeat };
}
