/**
 * The room library's side of a room: a thin adapter that turns its callbacks into calls on the
 * framework-free GameRoom (src/room) and its clients into Peers. No game rule lives here.
 *
 * What the library does for us: matchmaking over HTTP (create, join by id), the WebSocket, and
 * automatic reconnection of a dropped socket. What it does not do: game state (we send our own
 * messages), admission (the lobby decides who gets a seat) and room life time beyond "nobody
 * connected and nobody expected back".
 *
 *   room id               the 4-letter room code, so "join by id" is "join by code"
 *   onJoin                GameRoom.join; a refusal travels to the client as an error code
 *   onDrop                GameRoom.drop, then hold the session for automatic reconnection
 *   onReconnect           GameRoom.resume
 *   onLeave               GameRoom.leave (asked to leave, or the hold was given up)
 *   Peer.close            close the socket, or give up the hold of a dropped session
 *
 * Things with nobody behind them must not get in anybody's way, so this file also keeps them
 * short-lived: a room whose creator never connects, a join request that is never followed by a
 * connection, a connection that never finishes joining, and one that stops reading what it is
 * sent (each is described at its constant below).
 */

import { ClientState, matchMaker, Room, ServerError, type Client, type Deferred } from '@colyseus/core';
import {
  CLOSE_BACKLOG,
  CLOSE_JOIN_TIMEOUT,
  CLOSE_SEAT_RELEASED,
  JOIN_ERROR,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TICK_RATE,
  type ServerMessages,
  type ServerMessageType,
} from '@mb/shared';
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GameRoom } from '../room/gameRoom';
import { JoinRefused, type Peer } from '../room/peer';
import { createPerfMeter, perfReport, perfSample, type PerfReport } from '../room/perf';
import { startTicker, type Ticker } from '../room/ticker';

/** What every room on this server shares; set once by the server before any room exists. */
export interface RoomRuntime {
  fast: boolean;
  speed: number;
  graceSeconds: number;
  endScreenSeconds: number;
  hostHandoffSeconds: number;
  startWaitSeconds: number;
  /** Rooms with somebody in them that may exist at once. */
  maxRooms: number;
  /** Seconds a connection may take to finish joining. */
  joinTimeoutSeconds: number;
  /**
   * Seconds a join request waits for its connection (and a new room for its creator) before
   * the place is given up. A browser connects within a fraction of a second; the library's
   * default of 15 s only kept dead requests around.
   */
  reservationSeconds: number;
  /** The build stamp a joining page must carry, asked at every join. */
  build: () => string;
  log: ((line: string) => void) | undefined;
  logError: (line: string) => void;
}

/**
 * Connections and unused join requests the library may count per room before it locks the
 * room. The lobby does the real admission (five seats), so this only has to be out of reach:
 * a room the library has locked answers every join, a player's own reload included, with "no
 * such room". At 12 it took eleven join requests with no connection behind them to do that.
 */
export const MAX_CONNECTIONS = 256;
/**
 * Rooms that may be waiting for their creator at one time. They do not count against the room
 * limit; one more than this closes the one that has waited longest, so requests with nobody
 * behind them can neither fill the server nor keep anybody from creating a room.
 */
export const MAX_WAITING_ROOMS = 5;
/** A client that sends more than this many messages in a second is cut off (30 inputs are normal). */
const MAX_MESSAGES_PER_SECOND = 300;
/**
 * Bytes that may be waiting to go out on one connection. A match sends about 13 kB a second,
 * so this is over a minute of it: a connection that far behind is not reading at all, and
 * without a limit everything sent to it would pile up in memory. It is cut; the seat is kept
 * for the usual grace period.
 */
export const MAX_BACKLOG_BYTES = 1024 * 1024;

interface Link {
  client: Client;
  /** Set while the session is dropped and held for reconnection. */
  held: Deferred<Client> | null;
  /** Closes the connection if it has not finished joining in time. */
  joinTimer: NodeJS.Timeout | null;
}

let runtime: RoomRuntime | null = null;
const liveRooms = new Map<string, MatchRoom>();
/** Rooms nobody has joined yet, oldest first. */
const waitingRooms = new Set<MatchRoom>();

export function configureRooms(next: RoomRuntime): void {
  runtime = next;
}

/** The codes of the rooms that are open right now. */
export function openRoomCodes(): string[] {
  return [...liveRooms.keys()];
}

/** Timing of the room loop while matches run, over every room of this server (see room/perf.ts). */
const perf = createPerfMeter();

export function roomPerf(): PerfReport {
  return perfReport(perf);
}

export function roomStats(): { rooms: number; players: number } {
  let players = 0;
  for (const room of liveRooms.values()) players += room.connectedPlayers;
  return { rooms: liveRooms.size, players };
}

/** A room code nobody can work out from earlier ones: every letter from the system's generator. */
function freshCode(): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    // A duplicate id would silently put the creator into the other room.
    if (!liveRooms.has(code) && !matchMaker.getLocalRoomById(code)) return code;
  }
  throw new ServerError(JOIN_ERROR.serverFull, 'no free room code');
}

/** The raw socket's count of bytes not yet written out, or 0 when the transport has no such thing. */
function backlogOf(client: Client): number {
  const amount = (client.ref as { bufferedAmount?: unknown } | undefined)?.bufferedAmount;
  return typeof amount === 'number' ? amount : 0;
}

/**
 * Sends one message unless the connection's backlog is over `limit`; then nothing is queued
 * and `cut` is called instead. Returns whether the message was handed to the connection.
 */
export function sendBounded<K extends ServerMessageType>(
  client: Client,
  type: K,
  payload: ServerMessages[K],
  limit: number,
  cut: () => void,
): boolean {
  if (backlogOf(client) > limit) {
    cut();
    return false;
  }
  if (payload instanceof Uint8Array) client.sendBytes(type, payload);
  else client.send(type, payload);
  return true;
}

export class MatchRoom extends Room {
  private game: GameRoom | null = null;
  private ticker: Ticker | null = null;
  private readonly links = new Map<string, Link>();
  /** Connections that are being hung up on. */
  private readonly cutting = new WeakSet<Client>();

  get connectedPlayers(): number {
    return this.game ? this.game.connectedCount : 0;
  }

  override onCreate(): void {
    const rt = runtime;
    if (!rt) throw new ServerError(JOIN_ERROR.serverFull, 'the server is not ready');
    // Only rooms somebody has walked into count against the limit.
    if (liveRooms.size - waitingRooms.size >= rt.maxRooms) throw new ServerError(JOIN_ERROR.serverFull, 'the server is full');
    if (waitingRooms.size >= MAX_WAITING_ROOMS) {
      const oldest = waitingRooms.values().next().value;
      if (oldest) {
        waitingRooms.delete(oldest);
        rt.log?.(`[room ${oldest.roomId}] closed: its creator never connected and newer rooms are waiting`);
        void oldest.disconnect().catch(() => undefined);
      }
    }

    const code = freshCode();
    this.roomId = code;
    this.maxClients = MAX_CONNECTIONS;
    this.seatReservationTimeout = rt.reservationSeconds;
    this.maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
    // No library state sync: the game sends its own snapshots.
    this.patchRate = null;
    // Never offered to someone looking for "any room" (the server also refuses to look).
    void this.setPrivate(true);

    const game = new GameRoom({
      code,
      fast: rt.fast,
      graceSeconds: rt.graceSeconds,
      endScreenSeconds: rt.endScreenSeconds,
      hostHandoffSeconds: rt.hostHandoffSeconds,
      startWaitSeconds: rt.startWaitSeconds,
      speed: rt.speed,
      seed: randomInt(0x100000000),
      build: rt.build,
      now: () => performance.now(),
      log: rt.log,
      logError: rt.logError,
    });
    this.game = game;
    liveRooms.set(code, this);
    waitingRooms.add(this);
    rt.log?.(`[room ${code}] created (${liveRooms.size} room${liveRooms.size === 1 ? '' : 's'} open)`);

    // One handler for every message type: unknown types are ignored by the room, not punished
    // by the library with a disconnect.
    this.onMessage('*', (client: Client, type: string | number, message: unknown) => {
      game.message(client.sessionId, String(type), message);
    });

    let lastUpdate = 0;
    this.ticker = startTicker(
      TICK_RATE,
      () => {
        const began = performance.now();
        const running = game.matchRunning;
        const tick = game.matchTick;
        game.update();
        // Only updates of a running match are measured: the lobby does next to nothing.
        if (running && lastUpdate > 0) perfSample(perf, performance.now() - began, began - lastUpdate, Math.max(0, game.matchTick - tick));
        lastUpdate = running ? began : 0;
      },
      (err) => rt.logError(`[room ${code}] update failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`),
    );
  }

  override onJoin(client: Client, options?: unknown): void {
    const game = this.requireGame();
    const link: Link = { client, held: null, joinTimer: null };
    this.links.set(client.sessionId, link);
    try {
      game.join(this.peerFor(client), options);
    } catch (err) {
      this.links.delete(client.sessionId);
      if (err instanceof JoinRefused) throw new ServerError(err.code, err.message);
      throw err;
    }
    waitingRooms.delete(this);
    // The seat is granted now, but the library only starts delivering once the client has
    // answered its join offer. One that never answers would sit in the seat for ever, unready
    // in the lobby or parked on a squad, with everything sent to it kept in memory.
    const seconds = runtime?.joinTimeoutSeconds ?? 0;
    if (seconds > 0) {
      link.joinTimer = setTimeout(() => {
        link.joinTimer = null;
        if (client.state !== ClientState.JOINING) return;
        if (this.cut(client, CLOSE_JOIN_TIMEOUT, 'the join was never completed')) {
          runtime?.log?.(`[room ${this.roomId}] a connection did not finish joining within ${seconds} s and was closed`);
        }
      }, seconds * 1000);
    }
  }

  override onDrop(client: Client): void {
    const link = this.links.get(client.sessionId);
    // No link: the seat was taken over, given up, or never granted. Nothing to hold.
    if (!link || !this.game || !this.game.drop(client.sessionId)) return;
    // "manual": the game room owns the grace period and gives the hold up through Peer.close.
    const held = this.allowReconnection(client, 'manual');
    // Giving the hold up rejects it; that is expected and already handled by the library.
    held.catch(() => undefined);
    link.held = held;
  }

  override onReconnect(client: Client): void {
    const link = this.links.get(client.sessionId);
    if (!link || !this.game) {
      client.leave(CLOSE_SEAT_RELEASED, 'the seat was given up');
      return;
    }
    link.client = client;
    link.held = null;
    if (!this.game.resume(this.peerFor(client))) {
      this.links.delete(client.sessionId);
      client.leave(CLOSE_SEAT_RELEASED, 'the seat was given up');
    }
  }

  override onLeave(client: Client): void {
    const link = this.links.get(client.sessionId);
    if (link?.joinTimer) clearTimeout(link.joinTimer);
    this.links.delete(client.sessionId);
    this.game?.leave(client.sessionId);
  }

  override onDispose(): void {
    this.ticker?.stop();
    this.ticker = null;
    waitingRooms.delete(this);
    if (liveRooms.get(this.roomId) === this) liveRooms.delete(this.roomId);
    runtime?.log?.(`[room ${this.roomId}] closed (${liveRooms.size} room${liveRooms.size === 1 ? '' : 's'} open)`);
    this.game?.dispose();
    this.game = null;
    for (const link of this.links.values()) if (link.joinTimer) clearTimeout(link.joinTimer);
    this.links.clear();
  }

  /**
   * Ends a connection that cannot be reasoned with: says why, then hangs up without waiting
   * for an answer. Returns false when that is already under way.
   */
  private cut(client: Client, code: number, reason: string): boolean {
    if (this.cutting.has(client)) return false;
    this.cutting.add(client);
    client.leave(code, reason);
    const socket = client.ref as { terminate?: () => void } | undefined;
    const timer = setTimeout(() => socket?.terminate?.(), 1000);
    timer.unref();
    return true;
  }

  private requireGame(): GameRoom {
    if (!this.game) throw new ServerError(JOIN_ERROR.serverFull, 'the room is closing');
    return this.game;
  }

  private peerFor(client: Client): Peer {
    const id = client.sessionId;
    return {
      id,
      send: <K extends ServerMessageType>(type: K, payload: ServerMessages[K]): void => {
        // One connection in a bad state must never stop a frame from reaching the others.
        try {
          sendBounded(client, type, payload, MAX_BACKLOG_BYTES, () => {
            if (this.cut(client, CLOSE_BACKLOG, 'too far behind')) {
              runtime?.log?.(`[room ${this.roomId}] a connection stopped reading what it is sent and was closed`);
            }
          });
        } catch (err) {
          runtime?.logError(`[room ${this.roomId}] could not send "${type}": ${err instanceof Error ? err.message : String(err)}`);
        }
      },
      close: (code: number, reason: string): void => this.release(id, client, code, reason),
    };
  }

  /** Peer.close: the game room is done with this connection. */
  private release(sessionId: string, client: Client, code: number, reason: string): void {
    const link = this.links.get(sessionId);
    if (link && link.held) {
      // Dropped and waiting: stop holding its place. The library then calls onLeave.
      this.links.delete(sessionId);
      // A session that never finished joining gets a plain rejected promise, not a hold.
      if (typeof link.held.reject === 'function') link.held.reject(new Error(reason));
      return;
    }
    // Only forget the link when it still belongs to this connection (a reconnected session
    // reuses the id with a new client object).
    if (link && link.client === client) this.links.delete(sessionId);
    client.leave(code, reason);
  }
}
