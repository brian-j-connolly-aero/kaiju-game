/**
 * A typed, headless game client for Node: the integration tests and command-line tools talk to
 * a running server through it exactly as a browser does (matchmaking over HTTP, then the
 * WebSocket). It is not part of the server itself and is never bundled into it.
 *
 * The browser client's own wrapper (client/src/net) follows the same recipe:
 *
 *   create a room     sdk.create(ROOM_NAME, { name, token, protocol })
 *   join by code      sdk.joinById(CODE, { name, token, protocol })     (the code in capitals)
 *   messages          room.send(type, payload) / room.onMessage(type, handler); `snap` arrives
 *                     as bytes, everything else as plain data
 */

import { Client, type Room } from '@colyseus/sdk';
import {
  buildStamp,
  PROTOCOL_VERSION,
  ROOM_NAME,
  type ClientMessages,
  type ClientMessageType,
  type JoinOptions,
  type ServerMessages,
  type ServerMessageType,
} from '@mb/shared';

export interface NodeGameClient {
  /** The room code. */
  readonly code: string;
  /** The room library's id for this connection. */
  readonly sessionId: string;
  send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void;
  /** Sends any message type with any payload, for testing how the server treats nonsense. */
  sendRaw(type: string, payload: unknown): void;
  /** Subscribes to a server message. Returns a function that unsubscribes. */
  on<K extends ServerMessageType>(type: K, handler: (payload: ServerMessages[K]) => void): () => void;
  /** Called once when the connection is over for good, with the close code. */
  onClosed(handler: (code: number) => void): void;
  /** Called when the connection was lost and the library is trying to get it back. */
  onDropped(handler: () => void): void;
  /** Called when the library got the connection back by itself. */
  onReconnected(handler: () => void): void;
  /** Leaves the room on purpose. */
  leave(): Promise<void>;
  /**
   * Cuts the connection without telling the server, as a lost network would. With
   * `autoReconnect` the library then tries to restore it by itself; without, the connection
   * simply ends (the way a closed or reloaded page behaves).
   */
  cut(autoReconnect: boolean): void;
}

export interface ConnectOptions extends JoinOptions {
  /** Leave out the protocol version (to test a client that does not send one). */
  omitProtocol?: boolean;
  /** Leave out the build stamp (to test a page from before there was one). */
  omitBuild?: boolean;
}

function wrap(room: Room): NodeGameClient {
  return {
    code: room.roomId,
    sessionId: room.sessionId,
    send(type, payload) {
      room.send(type, payload);
    },
    sendRaw(type, payload) {
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
    async leave() {
      await room.leave(true);
    },
    cut(autoReconnect) {
      room.reconnection.enabled = autoReconnect;
      // The library only reconnects rooms that have been up for a while; a test has no time to wait.
      room.reconnection.minUptime = 0;
      void room.leave(false);
    },
  };
}

function joinOptions(options: ConnectOptions): JoinOptions {
  const out: JoinOptions = {};
  if (options.name !== undefined) out.name = options.name;
  if (options.token !== undefined) out.token = options.token;
  if (!options.omitProtocol) out.protocol = options.protocol ?? PROTOCOL_VERSION;
  // A Node client is built from the same shared code as the server it talks to and has no page.
  if (!options.omitBuild) out.build = options.build ?? buildStamp();
  return out;
}

/**
 * Creates a room on the server at `url` (for example "http://localhost:2567") and joins it.
 * `subscribe` runs before any message can arrive, so nothing sent on joining is missed.
 */
export async function createRoom(
  url: string,
  options: ConnectOptions = {},
  subscribe?: (client: NodeGameClient) => void,
): Promise<NodeGameClient> {
  const room = await new Client(url).create(ROOM_NAME, joinOptions(options));
  const client = wrap(room);
  subscribe?.(client);
  return client;
}

/** Joins the room with the given code. Rejects with an error carrying `code` when refused. */
export async function joinRoom(
  url: string,
  code: string,
  options: ConnectOptions = {},
  subscribe?: (client: NodeGameClient) => void,
): Promise<NodeGameClient> {
  const room = await new Client(url).joinById(code.toUpperCase(), joinOptions(options));
  const client = wrap(room);
  subscribe?.(client);
  return client;
}
