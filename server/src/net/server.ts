/**
 * The whole server in one call: one Node process, one port, carrying the page (Express), the
 * matchmaking requests and the WebSocket (room library). Nothing here uses an absolute address,
 * so it works unchanged behind a tunnel or reverse proxy on a single hostname.
 */

import { matchMaker, Room, Server } from '@colyseus/core';
import { WebSocketClient, WebSocketTransport } from '@colyseus/ws-transport';
import { buildStamp, CITY_SEED, getCity, JOIN_ERROR, PROTOCOL_VERSION, ROOM_NAME } from '@mb/shared';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { ServerConfig } from '../config';
import { configureApp, servedPageId, type HealthInfo } from '../http/app';
import { installFrontGuard } from '../http/guard';
import { PublicAddress } from '../http/publicUrl';
import { configureRooms, MatchRoom, openRoomCodes, roomPerf, roomStats } from './matchRoom';

/**
 * How often every connection is pinged, and how many pings in a row may go unanswered before
 * it is cut. A connection that died without saying so (a laptop changing networks) is noticed
 * after 2 to 3 s; the library's own defaults (3 s, twice) take 6 to 9 s, during which nobody
 * plays that player's slot.
 */
export const PING_INTERVAL_MS = 1000;
export const PING_MAX_MISSED = 2;

/**
 * A slow, uneven link for testing clients without one (MB_LATENCY with MB_JITTER): every message
 * is held back half the round trip plus a random 0 to `jitterMs`, each way, and each connection
 * still delivers in order, as one TCP connection does (a message held back holds back the ones
 * after it). The room library's own simulation holds every message back by the same time; this
 * wraps the same two places it does: the sending of bytes and the room's handling of a message.
 * For tests only: it changes the library for the whole process.
 */
function simulateUnevenLink(latencyMs: number, jitterMs: number): void {
  const half = latencyMs / 2;
  /** One connection, one way: when its newest message is due, and the messages still on their way. */
  interface Line {
    dueAt: number;
    waiting: Array<() => void>;
  }
  const later = (lines: WeakMap<object, Line>, connection: object, deliver: () => void): void => {
    let line = lines.get(connection);
    if (!line) {
      line = { dueAt: 0, waiting: [] };
      lines.set(connection, line);
    }
    const now = performance.now();
    line.dueAt = Math.max(line.dueAt, now + half + Math.random() * jitterMs);
    line.waiting.push(deliver);
    // One timer per message. Timers can fire a millisecond the wrong way round, so each delivers
    // the oldest message still waiting rather than its own.
    const waiting = line.waiting;
    setTimeout(() => (waiting.shift() as () => void)(), line.dueAt - now);
  };
  const sent = new WeakMap<object, Line>();
  const send = WebSocketClient.prototype.raw;
  WebSocketClient.prototype.raw = function (this: WebSocketClient, data, options, cb) {
    // The library may reuse the buffer once this returns: keep a copy.
    const copy = Buffer.from(data);
    later(sent, this, () => send.call(this, copy, options, cb));
  };
  const received = new WeakMap<object, Line>();
  // The room's handling of an incoming message is private to the library; its own latency
  // simulation replaces it the same way.
  const rooms = Room.prototype as unknown as Record<string, (this: unknown, client: object, buffer: Buffer) => void>;
  const receive = rooms._onMessage;
  rooms._onMessage = function (this: unknown, client: object, buffer: Buffer) {
    const copy = Buffer.from(buffer);
    later(received, client, () => receive.call(this, client, copy));
  };
}

export interface GameServer {
  /** The port actually bound (useful when the configuration asked for port 0). */
  port: number;
  /** The build stamp a page must carry to join right now. */
  build(): string;
  health(): HealthInfo;
  /** The codes of the rooms that are open right now (for tests and tools; never sent to clients). */
  roomCodes(): string[];
  /** Closes every room and stops listening. */
  close(): Promise<void>;
}

/**
 * Starts the server. Only one can run per process: the room library keeps its matchmaker in
 * module state.
 */
export async function startGameServer(config: ServerConfig): Promise<GameServer> {
  const startedAt = performance.now();
  const fixedBuild = config.build;
  const publicAddress = new PublicAddress(config.publicUrl);
  const build = fixedBuild !== null ? (): string => fixedBuild : (): string => buildStamp(servedPageId(config.clientDir));
  const health = (): HealthInfo => ({
    ok: true,
    game: 'monster-battle-9001',
    protocol: PROTOCOL_VERSION,
    build: build(),
    uptime: Math.round((performance.now() - startedAt) / 1000),
    ...roomStats(),
    fast: config.fast,
    perf: roomPerf(),
    publicUrl: publicAddress.get(),
  });

  configureRooms({
    fast: config.fast,
    speed: config.speed,
    graceSeconds: config.graceSeconds,
    endScreenSeconds: config.endScreenSeconds,
    hostHandoffSeconds: config.hostHandoffSeconds,
    startWaitSeconds: config.startWaitSeconds,
    maxRooms: config.maxRooms,
    joinTimeoutSeconds: config.joinTimeoutSeconds,
    reservationSeconds: config.reservationSeconds,
    build: config.checkBuild ? build : null,
    publicUrl: () => publicAddress.get(),
    log: config.log,
    logError: config.logError,
  });

  // A failed create or join answers with an ordinary HTTP status and the error code in the
  // body. The library's default statuses (520 to 526) are ones Cloudflare replaces with its
  // own error pages, which would hide "no such room" from a client behind the tunnel.
  matchMaker.controller.standardHttpStatus = true;
  // Rooms are private: the only ways in are creating one and knowing a room's code. Without
  // this the library would also let anyone "join any room" or "join or create" by room name.
  matchMaker.controller.exposedMethods = ['create', 'joinById', 'reconnect'];

  // The HTTP server is made here, not by the library, so that the front guard can be put before
  // everything the library attaches to it.
  const httpServer = createServer();
  const transport = new WebSocketTransport({ server: httpServer, pingInterval: PING_INTERVAL_MS, pingMaxRetries: PING_MAX_MISSED });
  const server = new Server({
    transport,
    greet: false,
    // The library's own handling ends the process on ANY uncaught error. Signals are handled
    // below instead, and stray errors by the crash guard the entry point installs.
    gracefullyShutdown: false,
    express: (app) => configureApp(app, { clientDir: config.clientDir, health, publicAddress, log: config.log }),
  });
  server.define(ROOM_NAME, MatchRoom);
  if (config.jitterMs > 0) {
    simulateUnevenLink(config.latencyMs, config.jitterMs);
    config.log?.(`simulating a slow link: ${config.latencyMs} ms round trip, plus up to ${config.jitterMs} ms each way at random`);
  } else if (config.latencyMs > 0) {
    server.simulateLatency(config.latencyMs);
  }

  // Build the city before the first player arrives, not while they wait for a match to start.
  getCity(CITY_SEED);

  // The library only logs a failed bind (a port already in use) and then waits forever, so
  // listen for the error ourselves and fail loudly instead.
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      httpServer.once('error', onError);
      server.listen(config.port, config.host).then(() => {
        httpServer.off('error', onError);
        resolve();
      }, reject);
    });
  } catch (err) {
    await server.gracefullyShutdown(false).catch(() => undefined);
    throw err;
  }
  // The library attached its handlers when the port opened; nothing has been received yet.
  installFrontGuard(httpServer, { limits: config.limits, busyCode: JOIN_ERROR.busy, log: config.log });

  const address = httpServer.address() as AddressInfo | string | null;
  const port = typeof address === 'object' && address ? address.port : config.port;

  if (config.handleSignals) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        config.log?.(`asked to stop (${signal}): closing every room`);
        // Closes the rooms (clients see close code 4001) and then exits with code 0.
        void server.gracefullyShutdown(true);
      });
    }
  }

  return {
    port,
    build,
    health,
    roomCodes: openRoomCodes,
    close: () => server.gracefullyShutdown(false),
  };
}
