/**
 * The whole server in one call: one Node process, one port, carrying the page (Express), the
 * matchmaking requests and the WebSocket (room library). Nothing here uses an absolute address,
 * so it works unchanged behind a tunnel or reverse proxy on a single hostname.
 */

import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CITY_SEED, getCity, PROTOCOL_VERSION, ROOM_NAME } from '@mb/shared';
import { randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { ServerConfig } from '../config';
import { configureApp, type HealthInfo } from '../http/app';
import { configureRooms, MatchRoom, openRoomCodes, roomStats } from './matchRoom';

export interface GameServer {
  /** The port actually bound (useful when the configuration asked for port 0). */
  port: number;
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
  const health = (): HealthInfo => ({
    ok: true,
    game: 'monster-battle-9001',
    protocol: PROTOCOL_VERSION,
    uptime: Math.round((performance.now() - startedAt) / 1000),
    ...roomStats(),
    fast: config.fast,
  });

  configureRooms({
    fast: config.fast,
    speed: config.speed,
    graceSeconds: config.graceSeconds,
    endScreenSeconds: config.endScreenSeconds,
    hostHandoffSeconds: config.hostHandoffSeconds,
    maxRooms: config.maxRooms,
    seed: randomInt(0, 0x7fffffff),
    log: config.log,
  });

  // A failed create or join answers with an ordinary HTTP status and the error code in the
  // body. The library's default statuses (520 to 526) are ones Cloudflare replaces with its
  // own error pages, which would hide "no such room" from a client behind the tunnel.
  matchMaker.controller.standardHttpStatus = true;
  // Rooms are private: the only ways in are creating one and knowing a room's code. Without
  // this the library would also let anyone "join any room" or "join or create" by room name.
  matchMaker.controller.exposedMethods = ['create', 'joinById', 'reconnect'];

  const transport = new WebSocketTransport();
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: config.handleSignals,
    express: (app) => configureApp(app, { clientDir: config.clientDir, health }),
  });
  server.define(ROOM_NAME, MatchRoom);
  if (config.latencyMs > 0) server.simulateLatency(config.latencyMs);

  // Build the city before the first player arrives, not while they wait for a match to start.
  getCity(CITY_SEED);

  // The library only logs a failed bind (a port already in use) and then waits forever, so
  // listen for the error ourselves and fail loudly instead.
  const httpServer = transport.server;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      httpServer?.once('error', onError);
      server.listen(config.port, config.host).then(() => {
        httpServer?.off('error', onError);
        resolve();
      }, reject);
    });
  } catch (err) {
    await server.gracefullyShutdown(false).catch(() => undefined);
    throw err;
  }
  const address = transport.server?.address() as AddressInfo | string | null | undefined;
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    port,
    health,
    roomCodes: openRoomCodes,
    close: () => server.gracefullyShutdown(false),
  };
}
