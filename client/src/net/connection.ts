/**
 * The only file in the client that touches the room library. It follows the recipe of
 * server/src/net/nodeClient.ts: create a room, or join one by its code, and exchange typed
 * (type, payload) messages. Everything is addressed to the origin the page came from, so one
 * hostname behind a tunnel carries the page, the matchmaking requests and the WebSocket.
 */

import { Client, type Room } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  ROOM_NAME,
  type ClientMessages,
  type ClientMessageType,
  type JoinOptions,
  type ServerMessages,
  type ServerMessageType,
} from '@mb/shared';

/** The room library's close code for "you left on purpose". */
export const CLOSE_CONSENTED = 4000;
/** The room library's error code for "no such room". */
export const ERROR_NO_ROOM = 522;

/** A refused create or join. `code` is ERROR_NO_ROOM, a JOIN_ERROR value, or 0 for a network failure. */
export class JoinFailure extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'JoinFailure';
    this.code = code;
  }
}

export interface RoomLink {
  /** The room code. */
  readonly code: string;
  send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void;
  /** Subscribes to a server message; returns a function that unsubscribes. */
  on<K extends ServerMessageType>(type: K, handler: (payload: ServerMessages[K]) => void): () => void;
  /** The connection is over for good, with the close code. */
  onClosed(handler: (code: number) => void): void;
  /** The socket dropped and the library is trying to get it back. */
  onDropped(handler: () => void): void;
  /** The library got the socket back by itself. */
  onReconnected(handler: () => void): void;
  /** Leaves the room on purpose (gives the seat up at once). */
  leave(): void;
  /** Drops the socket as a lost network would (for tests of the reconnection path). */
  cut(): void;
}

function wrap(room: Room): RoomLink {
  return {
    code: room.roomId,
    send(type, payload) {
      room.send(type, payload);
    },
    on<K extends ServerMessageType>(type: K, handler: (payload: ServerMessages[K]) => void) {
      return room.onMessage(type, (payload: ServerMessages[K]) => handler(payload));
    },
    onClosed(handler) {
      room.onLeave((code: number) => handler(code));
    },
    onDropped(handler) {
      room.onDrop(() => handler());
    },
    onReconnected(handler) {
      room.onReconnect(() => handler());
    },
    leave() {
      void room.leave(true);
    },
    cut() {
      void room.leave(false);
    },
  };
}

function failure(err: unknown): JoinFailure {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = e && typeof e.code === 'number' ? e.code : 0;
  const message = e && typeof e.message === 'string' ? e.message : String(err);
  return new JoinFailure(code, message);
}

function options(name: string, token: string): JoinOptions {
  return { name, token, protocol: PROTOCOL_VERSION };
}

/**
 * Creates a room and joins it. `subscribe` runs before any message can arrive, so nothing the
 * server sends on joining is missed. Rejects with a JoinFailure.
 */
export async function createRoom(
  origin: string,
  name: string,
  token: string,
  subscribe: (link: RoomLink) => void,
): Promise<RoomLink> {
  try {
    const room = await new Client(origin).create(ROOM_NAME, options(name, token));
    const link = wrap(room);
    subscribe(link);
    return link;
  } catch (err) {
    throw failure(err);
  }
}

/** Joins the room with the given code. Rejects with a JoinFailure (code ERROR_NO_ROOM when it is gone). */
export async function joinRoom(
  origin: string,
  code: string,
  name: string,
  token: string,
  subscribe: (link: RoomLink) => void,
): Promise<RoomLink> {
  try {
    const room = await new Client(origin).joinById(code.toUpperCase(), options(name, token));
    const link = wrap(room);
    subscribe(link);
    return link;
  } catch (err) {
    throw failure(err);
  }
}
