/**
 * Test doubles for the room logic: a hand-driven clock and peers that record what they are
 * sent. With these a whole room (lobby, match, reconnects) runs in a unit test with no network
 * and no real time.
 */

import {
  decodeSnapshot,
  TICK_RATE,
  type LobbyMessage,
  type PlayerInput,
  type ServerMessages,
  type ServerMessageType,
  type SimEvent,
  type Snapshot,
  type WelcomeMessage,
} from '@mb/shared';
import { GameRoom, type GameRoomOptions } from '../src/room/gameRoom';
import type { Peer } from '../src/room/peer';

export const TICK_MS = 1000 / TICK_RATE;

export interface Sent {
  type: ServerMessageType;
  payload: unknown;
}

/** A connection that keeps everything it is sent, copied at the moment of sending. */
export class FakePeer implements Peer {
  readonly id: string;
  readonly sent: Sent[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(id: string) {
    this.id = id;
  }

  send<K extends ServerMessageType>(type: K, payload: ServerMessages[K]): void {
    this.sent.push({ type, payload: structuredClone(payload) });
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  all<K extends ServerMessageType>(type: K): Array<ServerMessages[K]> {
    return this.sent.filter((s) => s.type === type).map((s) => s.payload as ServerMessages[K]);
  }

  last<K extends ServerMessageType>(type: K): ServerMessages[K] | undefined {
    const all = this.all(type);
    return all[all.length - 1];
  }

  get lobby(): LobbyMessage {
    const m = this.last('lobby');
    if (!m) throw new Error(`peer ${this.id} never received a lobby message`);
    return m;
  }

  get welcome(): WelcomeMessage {
    const m = this.last('welcome');
    if (!m) throw new Error(`peer ${this.id} never received a welcome`);
    return m;
  }

  get snapshots(): Snapshot[] {
    return this.all('snap').map((bytes) => decodeSnapshot(bytes));
  }

  get lastSnapshot(): Snapshot {
    const bytes = this.last('snap');
    if (!bytes) throw new Error(`peer ${this.id} never received a snapshot`);
    return decodeSnapshot(bytes);
  }

  get events(): SimEvent[] {
    return this.all('events').flat();
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface TestRoom {
  room: GameRoom;
  /** Current time of the fake clock, milliseconds. */
  time(): number;
  /** Moves the clock forward without updating the room. */
  skip(ms: number): void;
  /** Advances the clock one simulation tick at a time, updating the room each time. */
  run(seconds: number): void;
  /** Runs until the predicate holds; throws when it does not within `maxSeconds`. */
  runUntil(done: () => boolean, maxSeconds: number): void;
  /** Lines the room logged. */
  log: string[];
}

export function makeRoom(overrides: Partial<GameRoomOptions> = {}): TestRoom {
  let t = 1000;
  const log: string[] = [];
  const room = new GameRoom({
    code: 'BCDF',
    fast: true,
    graceSeconds: 30,
    endScreenSeconds: 60,
    hostHandoffSeconds: 8,
    speed: 1,
    seed: 12345,
    now: () => t,
    log: (line) => log.push(line),
    ...overrides,
  });
  const step = (): void => {
    t += TICK_MS;
    room.update();
  };
  return {
    room,
    time: () => t,
    skip(ms) {
      t += ms;
    },
    run(seconds) {
      const ticks = Math.round(seconds * TICK_RATE);
      for (let i = 0; i < ticks; i++) step();
    },
    runUntil(done, maxSeconds) {
      const ticks = Math.round(maxSeconds * TICK_RATE);
      for (let i = 0; i < ticks; i++) {
        if (done()) return;
        step();
      }
      if (!done()) throw new Error(`condition not reached within ${maxSeconds} s of room time`);
    },
    log,
  };
}

/** Seats `count` players (peer ids p0, p1, ...) with tokens token-p0, ... and returns their peers. */
export function seatPlayers(room: GameRoom, count: number): FakePeer[] {
  const peers: FakePeer[] = [];
  for (let i = 0; i < count; i++) {
    const peer = new FakePeer(`p${i}`);
    room.join(peer, { name: `Player ${String.fromCharCode(65 + i)}`, token: tokenOf(i), protocol: 1 });
    peers.push(peer);
  }
  return peers;
}

export function tokenOf(i: number): string {
  return `token-p${i}-abcdef`;
}

/** Everyone but the host readies up and the host starts the match. */
export function startMatch(room: GameRoom, peers: FakePeer[]): void {
  const host = room.lobby.host;
  for (const peer of peers) {
    if (room.seatOfPeer(peer.id) !== host) room.message(peer.id, 'ready', { ready: true });
  }
  const hostPeer = peers.find((p) => room.seatOfPeer(p.id) === host);
  if (!hostPeer) throw new Error('no connected host');
  room.message(hostPeer.id, 'start', {});
}

export function input(seq: number, fields: Partial<PlayerInput> = {}): PlayerInput {
  return { seq, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0, ...fields };
}
