/**
 * What the room logic needs from a connection, and nothing more. The room library's client is
 * adapted to this in src/net; tests use a plain object. The room never learns how messages
 * travel.
 */

import type { ServerMessages, ServerMessageType } from '@mb/shared';

export interface Peer {
  /** Identifies this connection for as long as it (or its automatic reconnection) lives. */
  readonly id: string;
  /**
   * Sends one message. The payload must be serialized or copied before this returns: the room
   * reuses and mutates what it passes in.
   */
  send<K extends ServerMessageType>(type: K, payload: ServerMessages[K]): void;
  /**
   * The room is done with this connection: close it if it is open, and stop holding its place
   * if it is waiting to reconnect. Must not call back into the room synchronously.
   */
  close(code: number, reason: string): void;
}

/** Thrown by `GameRoom.join` when a player cannot be admitted; `code` is a JOIN_ERROR value. */
export class JoinRefused extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'JoinRefused';
    this.code = code;
  }
}
