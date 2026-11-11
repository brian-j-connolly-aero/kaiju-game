/**
 * The network protocol for Tier 1: every message, both directions (ARCHITECTURE.md section 4).
 *
 * Messages are (type, payload) pairs, which is how the room library sends them; the two maps
 * below give the payload type for every message type. Everything is JSON-safe except `snap`
 * (binary, see snapshot.ts) and the `cityState` bytes inside `welcome` (see cityState.ts).
 *
 * The server must validate everything it receives: `sanitizeInput` and `sanitizeCommand` do it
 * for the two hot messages; lobby actions carry only short strings and booleans.
 */

import type { FactionId, KaijuKindId } from '../defs/ids';
import type { SquadCommand } from '../sim/commands';
import type { MatchConfig, PlayerId } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerInput } from './input';
import type { LobbyState } from './lobby';

/** Bump when a message or the snapshot layout changes incompatibly. Sent in `welcome`. */
export const PROTOCOL_VERSION = 1;

/** Default port for the one process that serves both the page and the WebSocket. */
export const DEFAULT_PORT = 2567;

// --- Client -> server ------------------------------------------------------------------------

export interface ClientMessages {
  /** Lobby: change display name. */
  setName: { name: string };
  /** Lobby: volunteer for the kaiju role (or stop volunteering); optionally pick which kaiju. */
  setRole: { wantsKaiju: boolean; kaijuKind?: KaijuKindId };
  /** Lobby: pick the faction to field as a human squad. */
  setFaction: { faction: FactionId };
  /** Lobby: toggle ready. */
  ready: { ready: boolean };
  /** Lobby, host only: room options. */
  setOptions: { botKaiju?: boolean };
  /** Lobby, host only: start the match. */
  start: Record<string, never>;
  /** End screen, host only: take the room back to the lobby. */
  toLobby: Record<string, never>;
  /** Match: one input sample, 30 per second. */
  input: PlayerInput;
  /** Match: a squad command placed outside the input stream (for example on the map view). */
  command: SquadCommand;
  /** Tier 2: pick one of the three offered upgrade cards (0..2). */
  draftPick: { card: number };
  /** Latency probe; `t` is the client's clock in milliseconds and comes back unchanged. */
  ping: { t: number };
}

export type ClientMessageType = keyof ClientMessages;

// --- Server -> client ------------------------------------------------------------------------

/** Sent when a match starts and again whenever a player (re)joins a match in progress. */
export interface WelcomeMessage {
  protocol: number;
  /** Match seed. With `config` it reproduces the server's createWorld call exactly. */
  seed: number;
  config: MatchConfig;
  /** Your match slot, or -1 for a spectator. */
  playerId: PlayerId;
  /** Kaiju you control, or -1. */
  kaijuId: number;
  /** Squad you lead, or -1. */
  squadId: number;
  /** Server tick at the time of sending. */
  tick: number;
  /** Neighborhood anchor the match started at (the config may say -1 for "random"). */
  anchor: number;
  /** `cityChecksum` of the server's city; a client whose own city differs must not predict. */
  cityChecksum: number;
  /** Current structure stages and live props, from `encodeCityState`. */
  cityState: Uint8Array;
}

/** The lobby as one client sees it. Sent on join and on every change. */
export interface LobbyMessage {
  lobby: LobbyState;
  /** The receiving client's seat. */
  you: number;
}

export interface PongMessage {
  /** The `t` from the ping. */
  t: number;
  /** Server tick when the ping was handled. */
  tick: number;
}

export interface ServerMessages {
  welcome: WelcomeMessage;
  lobby: LobbyMessage;
  /** Binary snapshot (encodeSnapshot), 15 per second. */
  snap: Uint8Array;
  /** The simulation events since the previous `events` message, in order, each with its tick. */
  events: SimEvent[];
  pong: PongMessage;
}

export type ServerMessageType = keyof ServerMessages;

/** Message type names, for registering handlers without string typos. */
export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = [
  'setName',
  'setRole',
  'setFaction',
  'ready',
  'setOptions',
  'start',
  'toLobby',
  'input',
  'command',
  'draftPick',
  'ping',
];

export const SERVER_MESSAGE_TYPES: readonly ServerMessageType[] = ['welcome', 'lobby', 'snap', 'events', 'pong'];
