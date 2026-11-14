/**
 * The network protocol for Tier 1: every message, both directions (ARCHITECTURE.md section 4).
 *
 * Messages are (type, payload) pairs, which is how the room library sends them; the two maps
 * below give the payload type for every message type. Everything is JSON-safe except `snap`
 * (binary, see snapshot.ts) and the `cityState` bytes inside `welcome` (see cityState.ts).
 *
 * The server must validate everything it receives: `sanitizeInput` does it for the hot message
 * (`input`); lobby actions carry only short strings and booleans.
 */

import type { FactionId, KaijuKindId } from '../defs/ids';
import type { MatchConfig, PlayerId } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerInput } from './input';
import type { LobbyState } from './lobby';

/** Bump when a message or the snapshot layout changes incompatibly. Sent in `welcome`. */
export const PROTOCOL_VERSION = 2;

/** Default port for the one process that serves both the page and the WebSocket. */
export const DEFAULT_PORT = 2567;

// --- Joining a room ----------------------------------------------------------------------------

/**
 * Name the game room is registered under with the room library. A client creates a room with
 * this name and joins an existing one by its 4-letter code (the code is the library's room id).
 */
export const ROOM_NAME = 'mb';

/** Options a client passes when it creates a room or joins one by code. Everything is optional. */
export interface JoinOptions {
  /** Display name; the server cleans it with `cleanPlayerName`. */
  name?: string;
  /**
   * Session token: a random string the client makes once and keeps (8 to 64 characters of
   * `A-Z a-z 0-9 _ -`). Joining a room where this token already holds a seat gives that seat
   * back (the newest connection wins; the older one is closed with `CLOSE_REPLACED`).
   */
  token?: string;
  /** The client's PROTOCOL_VERSION. A different version is refused with `JOIN_ERROR.version`. */
  protocol?: number;
  /**
   * The client's build stamp (`buildStamp`, build.ts). A page built from a different version of
   * the game than the server, or one that sends no stamp, is refused with `JOIN_ERROR.version`.
   */
  build?: string;
}

/** What a session token must look like to be accepted. */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Error codes a refused create or join fails with. */
export const JOIN_ERROR = {
  /** All five seats are taken by people who are connected. */
  roomFull: 4401,
  /** The page was built from a different version of the game than the server (build.ts): reload it. */
  version: 4402,
  /** The server is at its room limit. */
  serverFull: 4403,
  /**
   * This visitor sent too many matchmaking requests in a minute (rooms created, join requests,
   * wrong room codes). Nothing is wrong with the room: wait and try again.
   */
  busy: 4404,
} as const;

/** WebSocket close code: this connection's seat was taken over by a newer one with the same token. */
export const CLOSE_REPLACED = 4101;
/** WebSocket close code: the seat was given up (the player stayed away longer than the grace period). */
export const CLOSE_SEAT_RELEASED = 4102;
/** WebSocket close code: the connection never finished the join handshake. Join again. */
export const CLOSE_JOIN_TIMEOUT = 4103;
/** WebSocket close code: the connection stopped reading what the server sent it. Join again. */
export const CLOSE_BACKLOG = 4104;

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
  'draftPick',
  'ping',
];

export const SERVER_MESSAGE_TYPES: readonly ServerMessageType[] = ['welcome', 'lobby', 'snap', 'events', 'pong'];
