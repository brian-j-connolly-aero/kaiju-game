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
 */

import { matchMaker, Room, ServerError, type Client, type Deferred } from '@colyseus/core';
import {
  CLOSE_SEAT_RELEASED,
  createRng,
  JOIN_ERROR,
  makeRoomCode,
  rngU32,
  TICK_RATE,
  type Rng,
  type ServerMessages,
  type ServerMessageType,
} from '@mb/shared';
import { performance } from 'node:perf_hooks';
import { GameRoom } from '../room/gameRoom';
import { JoinRefused, type Peer } from '../room/peer';
import { startTicker, type Ticker } from '../room/ticker';

/** What every room on this server shares; set once by the server before any room exists. */
export interface RoomRuntime {
  fast: boolean;
  speed: number;
  graceSeconds: number;
  endScreenSeconds: number;
  hostHandoffSeconds: number;
  maxRooms: number;
  /** Seed for room codes and for each room's own rolls. */
  seed: number;
  log: ((line: string) => void) | undefined;
}

/**
 * Connections the library may hold per room. Deliberately more than the five seats: a player
 * who comes back must never be turned away by the library because the room "is full" of their
 * own dropped connection. The lobby does the real admission.
 */
const MAX_CONNECTIONS = 12;
/** A client that sends more than this many messages in a second is cut off (30 inputs are normal). */
const MAX_MESSAGES_PER_SECOND = 300;

interface Link {
  client: Client;
  /** Set while the session is dropped and held for reconnection. */
  held: Deferred<Client> | null;
}

let runtime: RoomRuntime | null = null;
let codeRng: Rng | null = null;
const liveRooms = new Map<string, MatchRoom>();

export function configureRooms(next: RoomRuntime): void {
  runtime = next;
  codeRng = createRng(next.seed);
}

/** The codes of the rooms that are open right now. */
export function openRoomCodes(): string[] {
  return [...liveRooms.keys()];
}

export function roomStats(): { rooms: number; players: number } {
  let players = 0;
  for (const room of liveRooms.values()) players += room.connectedPlayers;
  return { rooms: liveRooms.size, players };
}

function freshCode(rng: Rng): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = makeRoomCode(rng);
    // A duplicate id would silently put the creator into the other room.
    if (!liveRooms.has(code) && !matchMaker.getLocalRoomById(code)) return code;
  }
  throw new ServerError(JOIN_ERROR.serverFull, 'no free room code');
}

export class MatchRoom extends Room {
  private game: GameRoom | null = null;
  private ticker: Ticker | null = null;
  private readonly links = new Map<string, Link>();

  get connectedPlayers(): number {
    return this.game ? this.game.connectedCount : 0;
  }

  override onCreate(): void {
    const rt = runtime;
    if (!rt || !codeRng) throw new ServerError(JOIN_ERROR.serverFull, 'the server is not ready');
    if (liveRooms.size >= rt.maxRooms) throw new ServerError(JOIN_ERROR.serverFull, 'the server is full');

    const code = freshCode(codeRng);
    this.roomId = code;
    this.maxClients = MAX_CONNECTIONS;
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
      speed: rt.speed,
      seed: rngU32(codeRng),
      now: () => performance.now(),
      log: rt.log,
    });
    this.game = game;
    liveRooms.set(code, this);
    rt.log?.(`[room ${code}] created (${liveRooms.size} room${liveRooms.size === 1 ? '' : 's'} open)`);

    // One handler for every message type: unknown types are ignored by the room, not punished
    // by the library with a disconnect.
    this.onMessage('*', (client: Client, type: string | number, message: unknown) => {
      game.message(client.sessionId, String(type), message);
    });

    this.ticker = startTicker(
      TICK_RATE,
      () => game.update(),
      (err) => rt.log?.(`[room ${code}] update failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`),
    );
  }

  override onJoin(client: Client, options?: unknown): void {
    const game = this.requireGame();
    this.links.set(client.sessionId, { client, held: null });
    try {
      game.join(this.peerFor(client), options);
    } catch (err) {
      this.links.delete(client.sessionId);
      if (err instanceof JoinRefused) throw new ServerError(err.code, err.message);
      throw err;
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
    this.links.delete(client.sessionId);
    this.game?.leave(client.sessionId);
  }

  override onDispose(): void {
    this.ticker?.stop();
    this.ticker = null;
    if (liveRooms.get(this.roomId) === this) liveRooms.delete(this.roomId);
    runtime?.log?.(`[room ${this.roomId}] closed (${liveRooms.size} room${liveRooms.size === 1 ? '' : 's'} open)`);
    this.game?.dispose();
    this.game = null;
    this.links.clear();
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
          if (payload instanceof Uint8Array) client.sendBytes(type, payload);
          else client.send(type, payload);
        } catch (err) {
          runtime?.log?.(`[room ${this.roomId}] could not send "${type}": ${err instanceof Error ? err.message : String(err)}`);
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
