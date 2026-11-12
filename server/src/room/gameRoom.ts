/**
 * One room, from the first player walking in to the last one leaving: the lobby, the seats and
 * who is connected to them, the match loop, and the way back to the lobby. It is plain
 * TypeScript with no room library in it: connections are `Peer`s, time comes from `options.now`,
 * and nothing happens except inside `join`, `drop`, `resume`, `leave`, `message` and `update`.
 * That is what makes it testable without a network.
 *
 * Life of a room (DESIGN.md section 2, ARCHITECTURE.md section 4):
 *
 *   lobby --start--> match --match over--> end --toLobby or timeout--> lobby
 *
 * Seats and slots. A person in the room holds a seat (0..4) for as long as they stay. When a
 * match starts every connected seat gets a match slot (slot 0 is the kaiju); bots play the
 * rest. Someone who joins while a match is running takes over a bot squad if one is free and
 * watches otherwise.
 *
 * Dropped players. A seat whose connection is lost is kept for `graceSeconds`, and for nobody
 * but its owner: a newcomer is refused while every seat is taken, dropped ones included. In a
 * match a bot plays the slot meanwhile. The player gets it back either through the room
 * library's own reconnection (`resume`) or by joining again with the same session token
 * (`join`). After the grace period the seat is given up and the bot keeps the slot, but the
 * match remembers whose slot it was: when that player comes back with their token while a bot
 * still has it, it is theirs again, the kaiju included (DESIGN.md section 2: "can rejoin their
 * slot with the same link").
 */

import {
  addLobbyPlayer,
  buildMatchConfig,
  buildsMatch,
  canStartMatch,
  cleanPlayerName,
  CLOSE_REPLACED,
  CLOSE_SEAT_RELEASED,
  createLobbyState,
  createRng,
  encodeSnapshot,
  JOIN_ERROR,
  pickKaijuSeat,
  PLAYABLE_FACTIONS,
  PLAYABLE_KAIJU_KINDS,
  PROTOCOL_VERSION,
  removeLobbyPlayer,
  rngU32,
  sanitizeCommand,
  sanitizeInput,
  SESSION_TOKEN_PATTERN,
  setSnapshotAck,
  snapshotOfWorld,
  welcomeFor,
  type FactionId,
  type KaijuKindId,
  type LobbyPlayer,
  type LobbyState,
  type PlayerId,
  type Rng,
} from '@mb/shared';
import {
  advanceMatch,
  createMatchSession,
  matchOver,
  queueInput,
  queueSlotCommand,
  setSlotLive,
  snapshotDue,
  takeEvents,
  takeSnapshot,
  type MatchSession,
} from './match';
import { JoinRefused, type Peer } from './peer';

export interface GameRoomOptions {
  /** The 4-letter room code. */
  code: string;
  /** Short match timers and a small destruction bar (MB_FAST=1). */
  fast: boolean;
  /** Seconds a dropped player's seat is kept for them. */
  graceSeconds: number;
  /** Seconds the end screen stays up before the room returns to the lobby by itself; 0 waits for the host. */
  endScreenSeconds: number;
  /** Seconds a disconnected host keeps the host role while somebody else is connected. */
  hostHandoffSeconds: number;
  /** Simulation seconds per wall-clock second. 1 in real play; more only in headless tests. */
  speed: number;
  /** Seed for this room's own rolls (who plays the kaiju, match seeds). */
  seed: number;
  /**
   * Seconds after which the host may start although somebody connected is not ready (counted
   * per person from the moment they are in the lobby). Default DEFAULT_START_WAIT_SECONDS.
   */
  startWaitSeconds?: number;
  /**
   * The build stamp a joining page must carry (`JoinOptions.build`); a page with another one,
   * or none, is refused with JOIN_ERROR.version. A function is asked at every join (the page
   * the server serves can be rebuilt while it runs). Undefined admits any page (unit tests).
   */
  build?: string | (() => string);
  /** Monotonic clock, milliseconds. */
  now: () => number;
  /** Room chatter; may be switched off. */
  log?: (line: string) => void;
  /** Failures (a match that could not start or was abandoned). Falls back to `log`. */
  logError?: (line: string) => void;
}

export const DEFAULT_GRACE_SECONDS = 45;
export const DEFAULT_END_SCREEN_SECONDS = 120;
export const DEFAULT_HOST_HANDOFF_SECONDS = 8;
export const DEFAULT_START_WAIT_SECONDS = 20;

interface Seat {
  /** Lobby seat, 0..4. */
  seat: number;
  /** Session token the player joined with, or null when they sent none. */
  token: string | null;
  /** The current connection, or the last one while the player is away. */
  peer: Peer;
  connected: boolean;
  /** When the connection was lost (meaningful while not connected). */
  droppedAt: number;
  /** Match slot, or -1 (no match, or watching). */
  slot: PlayerId;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export class GameRoom {
  readonly options: GameRoomOptions;
  readonly lobby: LobbyState;
  /** The running or just finished match; null in the lobby. */
  match: MatchSession | null = null;

  private readonly seats: Seat[] = [];
  private readonly byPeer = new Map<string, Seat>();
  private readonly rng: Rng;
  /** When the current match ended (meaningful in the 'end' phase). */
  private endedAt = 0;
  private matchCount = 0;
  /**
   * Per match slot: the session token of the person who last played it in the current match,
   * or null. It outlives their seat, so that they can have the slot back.
   */
  private slotOwners: Array<string | null> = [];

  constructor(options: GameRoomOptions) {
    this.options = options;
    this.lobby = createLobbyState(options.code);
    this.lobby.options.fast = options.fast;
    this.rng = createRng(options.seed);
  }

  // --- Queries -------------------------------------------------------------------------------

  /** True once nobody holds a seat: the room can be thrown away. */
  get empty(): boolean {
    return this.seats.length === 0;
  }

  get seatCount(): number {
    return this.seats.length;
  }

  get connectedCount(): number {
    let n = 0;
    for (const s of this.seats) if (s.connected) n++;
    return n;
  }

  /** True while a match is being simulated (not in the lobby, not on the end screen). */
  get matchRunning(): boolean {
    return this.lobby.phase === 'match' && this.match !== null;
  }

  /** The simulation tick of the current match, or 0. */
  get matchTick(): number {
    return this.match ? this.match.world.tick : 0;
  }

  /** The seat number a connection holds, or -1. */
  seatOfPeer(peerId: string): number {
    return this.byPeer.get(peerId)?.seat ?? -1;
  }

  // --- Connections ---------------------------------------------------------------------------

  /**
   * A new connection wants in. Gives back a seat when its session token already holds one,
   * otherwise seats a new player. Throws JoinRefused when that is not possible.
   */
  join(peer: Peer, rawOptions: unknown): number {
    const raw = isRecord(rawOptions) ? rawOptions : {};
    if (raw.protocol !== undefined && raw.protocol !== PROTOCOL_VERSION) {
      throw new JoinRefused(JOIN_ERROR.version, `this server speaks protocol ${PROTOCOL_VERSION}`);
    }
    const build = typeof this.options.build === 'function' ? this.options.build() : this.options.build;
    if (build !== undefined && !buildsMatch(build, raw.build)) {
      // Worth a line even in a quiet window: if every page is refused, it is the server that is old.
      this.logError(
        `refused a page from another build of the game (it has "${typeof raw.build === 'string' ? raw.build.slice(0, 60) : 'none'}", ` +
          `this server "${build}"). The page reloads itself; if people still cannot join, restart the server.`,
      );
      throw new JoinRefused(JOIN_ERROR.version, 'this page is from a different build of the game than the server: reload it');
    }
    const token = typeof raw.token === 'string' && SESSION_TOKEN_PATTERN.test(raw.token) ? raw.token : null;

    // People already in the match get everything up to now before the roster changes.
    this.sendFrame(true);

    let seat = token === null ? undefined : this.seats.find((s) => s.token === token);
    if (seat) {
      const old = seat.peer;
      const wasConnected = seat.connected;
      this.byPeer.delete(old.id);
      seat.peer = peer;
      this.byPeer.set(peer.id, seat);
      seat.connected = true;
      this.lobbyPlayer(seat).connected = true;
      old.close(CLOSE_REPLACED, 'this seat was taken over by a newer connection');
      this.log(`seat ${seat.seat} ${wasConnected ? 'taken over by a newer connection' : 'reclaimed'}`);
    } else {
      // A seat whose player is away is still taken: it waits for them for the grace period,
      // however many newcomers knock meanwhile.
      const player = addLobbyPlayer(this.lobby, typeof raw.name === 'string' ? raw.name : '');
      if (!player) throw new JoinRefused(JOIN_ERROR.roomFull, 'the room is full');
      player.slot = -1;
      seat = { seat: player.seat, token, peer, connected: true, droppedAt: 0, slot: -1 };
      this.seats.push(seat);
      this.byPeer.set(peer.id, seat);
      this.log(`seat ${seat.seat} joined as "${player.name}"`);
    }

    this.enterMatch(seat, true);
    this.broadcastLobby();
    this.sendMatchState(seat);
    return seat.seat;
  }

  /**
   * A connection was lost without the player asking to leave. Returns true when the seat is
   * being kept for them (the caller may then let the connection reconnect by itself).
   */
  drop(peerId: string): boolean {
    const seat = this.byPeer.get(peerId);
    if (!seat || !seat.connected) return false;
    seat.connected = false;
    seat.droppedAt = this.options.now();
    this.lobbyPlayer(seat).connected = false;
    if (this.match && this.lobby.phase === 'match') setSlotLive(this.match, seat.slot, false, false);
    this.log(`seat ${seat.seat} dropped; holding it for ${this.options.graceSeconds} s`);
    this.broadcastLobby();
    return true;
  }

  /**
   * The same connection came back by itself (the room library reconnected it), possibly as a
   * new transport object. Returns false when its seat is gone; the caller should close it.
   */
  resume(peer: Peer): boolean {
    const seat = this.byPeer.get(peer.id);
    if (!seat) return false;
    this.sendFrame(true);
    seat.peer = peer;
    seat.connected = true;
    this.lobbyPlayer(seat).connected = true;
    this.enterMatch(seat, false);
    this.log(`seat ${seat.seat} reconnected`);
    this.broadcastLobby();
    this.sendMatchState(seat);
    return true;
  }

  /** The player left on purpose, or their connection is gone for good. Safe to call twice. */
  leave(peerId: string): void {
    const seat = this.byPeer.get(peerId);
    if (!seat) return;
    this.removeSeat(seat);
    this.log(`seat ${seat.seat} left`);
    this.broadcastLobby();
  }

  /** Lets go of everything. The room must not be used afterwards. */
  dispose(): void {
    this.match = null;
    this.seats.length = 0;
    this.byPeer.clear();
  }

  // --- Messages ------------------------------------------------------------------------------

  /** A message from a connection. Anything malformed, out of turn or unknown is ignored. */
  message(peerId: string, type: string, payload: unknown): void {
    const seat = this.byPeer.get(peerId);
    if (!seat || !seat.connected) return;
    const lobby = this.lobby;
    const player = this.lobbyPlayer(seat);
    const data = isRecord(payload) ? payload : {};

    switch (type) {
      case 'input': {
        if (!this.match || lobby.phase !== 'match' || seat.slot < 0) return;
        const input = sanitizeInput(payload, this.match.world.city.half);
        if (input) queueInput(this.match, seat.slot, input);
        return;
      }
      case 'command': {
        if (!this.match || lobby.phase !== 'match' || seat.slot < 0) return;
        const command = sanitizeCommand(payload, this.match.world.city.half);
        if (command) queueSlotCommand(this.match, seat.slot, command);
        return;
      }
      case 'ping': {
        if (typeof data.t !== 'number' || !Number.isFinite(data.t)) return;
        seat.peer.send('pong', { t: data.t, tick: this.match ? this.match.world.tick : 0 });
        return;
      }
      case 'setName': {
        const name = cleanPlayerName(data.name, seat.seat);
        if (name === player.name) return;
        player.name = name;
        break;
      }
      case 'setRole': {
        if (typeof data.wantsKaiju !== 'boolean') return;
        player.wantsKaiju = data.wantsKaiju;
        if (typeof data.kaijuKind === 'string' && (PLAYABLE_KAIJU_KINDS as readonly string[]).includes(data.kaijuKind)) {
          player.kaijuKind = data.kaijuKind as KaijuKindId;
        }
        break;
      }
      case 'setFaction': {
        if (typeof data.faction !== 'string' || !(PLAYABLE_FACTIONS as readonly string[]).includes(data.faction)) return;
        player.faction = data.faction as FactionId;
        break;
      }
      case 'ready': {
        if (lobby.phase !== 'lobby' || typeof data.ready !== 'boolean') return;
        player.ready = data.ready;
        break;
      }
      case 'setOptions': {
        if (lobby.phase !== 'lobby' || seat.seat !== lobby.host) return;
        if (typeof data.botKaiju !== 'boolean') return;
        lobby.options.botKaiju = data.botKaiju;
        break;
      }
      case 'start': {
        if (lobby.phase !== 'lobby' || seat.seat !== lobby.host || !canStartMatch(lobby)) return;
        this.startMatch();
        return;
      }
      case 'toLobby': {
        if (lobby.phase !== 'end' || seat.seat !== lobby.host) return;
        this.toLobby();
        return;
      }
      case 'draftPick':
        // STUB(server): upgrade drafts are Tier 2; the simulation has no draft to pick from yet.
        return;
      default:
        return;
    }
    this.broadcastLobby();
  }

  // --- Time ----------------------------------------------------------------------------------

  /** Advances the room to the present. Call it about once per simulation tick. */
  update(): void {
    const now = this.options.now();
    this.expireSeats(now);
    this.handOffHost(now);

    if (this.lobby.phase === 'match' && this.match) {
      const m = this.match;
      try {
        advanceMatch(m, now);
      } catch (err) {
        this.abortMatch(err);
        return;
      }
      this.sendFrame(false);
      if (matchOver(m)) {
        this.lobby.phase = 'end';
        this.endedAt = now;
        const w = m.world.match;
        this.log(`match ${this.matchCount} over: ${w.winner} win (${w.endReason}) after ${Math.round(w.elapsed)} s`);
        this.broadcastLobby();
      }
    } else if (this.lobby.phase === 'end') {
      const limit = this.options.endScreenSeconds;
      if (limit > 0 && now - this.endedAt >= limit * 1000) this.toLobby();
    }
  }

  // --- Internals -----------------------------------------------------------------------------

  private log(line: string): void {
    this.options.log?.(`[room ${this.options.code}] ${line}`);
  }

  /** For failures: these are printed even when the room chatter is switched off. */
  private logError(line: string): void {
    (this.options.logError ?? this.options.log)?.(`[room ${this.options.code}] ${line}`);
  }

  private lobbyPlayer(seat: Seat): LobbyPlayer {
    const player = this.lobby.players.find((p) => p.seat === seat.seat);
    if (!player) throw new Error(`room ${this.options.code}: seat ${seat.seat} has no lobby entry`);
    return player;
  }

  private setSlot(seat: Seat, slot: PlayerId): void {
    seat.slot = slot;
    this.lobbyPlayer(seat).slot = slot;
  }

  private broadcastLobby(): void {
    for (const seat of this.seats) {
      if (seat.connected) seat.peer.send('lobby', { lobby: this.lobby, you: seat.seat });
    }
  }

  /**
   * Sends the events gathered so far and a snapshot to everyone connected. Without `force` it
   * does so only at the snapshot rate; with it, whenever there is anything new at all.
   */
  private sendFrame(force: boolean): void {
    const m = this.match;
    if (!m || this.lobby.phase !== 'match') return;
    const moved = m.world.tick !== m.lastSnapshotTick;
    if (force ? !moved && m.events.length === 0 : !snapshotDue(m)) return;

    const events = takeEvents(m);
    const snapshot = moved ? takeSnapshot(m) : null;
    for (const seat of this.seats) {
      if (!seat.connected) continue;
      if (events.length > 0) seat.peer.send('events', events);
      if (snapshot) {
        // Each connection gets its own copy: the acknowledgement differs per player.
        const bytes = snapshot.slice();
        setSnapshotAck(bytes, seat.slot >= 0 ? m.acks[seat.slot] : 0);
        seat.peer.send('snap', bytes);
      }
    }
  }

  /** Everything a connection needs to draw a match it walked into: the welcome, and on the end screen the result. */
  private sendMatchState(seat: Seat): void {
    const m = this.match;
    if (!m || this.lobby.phase === 'lobby') return;
    seat.peer.send('welcome', welcomeFor(m.world, seat.slot));
    if (this.lobby.phase === 'end') {
      seat.peer.send('snap', encodeSnapshot(snapshotOfWorld(m.world)));
      if (m.ended) seat.peer.send('events', [m.ended]);
    }
  }

  /**
   * Puts a (re)connected seat back into the running match: its own slot if it has one, else
   * the slot this player had earlier in the match if a bot still plays it (the kaiju
   * included), else a bot squad nobody holds. `fresh` is true for a new page whose input
   * numbering starts over.
   */
  private enterMatch(seat: Seat, fresh: boolean): void {
    const m = this.match;
    if (!m || this.lobby.phase !== 'match') return;
    if (seat.slot < 0) {
      let slot = this.formerSlot(m, seat.token);
      const returning = slot >= 0;
      if (!returning) slot = this.freeSquadSlot(m);
      if (slot < 0) return;
      this.setSlot(seat, slot);
      this.slotOwners[slot] = seat.token;
      // The person's name replaces the bot's on this slot for everyone who joins from now on.
      const name = this.lobbyPlayer(seat).name;
      m.world.players[slot].name = name;
      m.world.config.players[slot].name = name;
      if (slot === 0 && m.world.players[slot].role === 'kaiju') this.lobby.lastKaijuSeat = seat.seat;
      this.log(returning ? `seat ${seat.seat} is back in slot ${slot}` : `seat ${seat.seat} takes over squad slot ${slot}`);
    }
    setSlotLive(m, seat.slot, true, fresh);
  }

  /** True when a bot plays the slot and no seat holds it. */
  private slotIsFree(m: MatchSession, slot: PlayerId): boolean {
    return m.world.players[slot].bot && !this.seats.some((s) => s.slot === slot);
  }

  /** The slot this token played earlier in the match, if it can be had back, or -1. */
  private formerSlot(m: MatchSession, token: string | null): PlayerId {
    if (token === null) return -1;
    const slot = this.slotOwners.indexOf(token);
    return slot >= 0 && slot < m.world.players.length && this.slotIsFree(m, slot) ? slot : -1;
  }

  /**
   * A human squad slot for somebody new, or -1: one that nobody has played in this match if
   * there is one, so that a player who is away finds their own squad free when they return.
   */
  private freeSquadSlot(m: MatchSession): PlayerId {
    let fallback: PlayerId = -1;
    for (const p of m.world.players) {
      if (p.role !== 'human' || !this.slotIsFree(m, p.id)) continue;
      if (!this.slotOwners[p.id]) return p.id;
      if (fallback < 0) fallback = p.id;
    }
    return fallback;
  }

  private startMatch(): void {
    const lobby = this.lobby;
    const kaijuSeat = pickKaijuSeat(lobby, this.rng);
    const { config, slotBySeat } = buildMatchConfig(lobby, kaijuSeat);
    const seed = rngU32(this.rng);
    let m: MatchSession;
    try {
      m = createMatchSession({ seed, config, speed: this.options.speed, now: this.options.now() });
    } catch (err) {
      this.logError(`could not start a match: ${describeError(err)}`);
      return;
    }
    this.match = m;
    this.matchCount++;
    lobby.phase = 'match';
    lobby.lastKaijuSeat = kaijuSeat;
    this.slotOwners = m.world.players.map(() => null);
    for (const seat of this.seats) {
      this.setSlot(seat, seat.connected ? (slotBySeat[seat.seat] ?? -1) : -1);
      if (seat.slot >= 0) {
        this.slotOwners[seat.slot] = seat.token;
        setSlotLive(m, seat.slot, true, true);
      }
    }
    this.log(
      `match ${this.matchCount} started: seed ${seed}, kaiju ${kaijuSeat < 0 ? 'bot' : `seat ${kaijuSeat}`}, ` +
        `${this.connectedCount} connected${lobby.options.fast ? ', fast timers' : ''}`,
    );
    this.broadcastLobby();
    for (const seat of this.seats) if (seat.connected) this.sendMatchState(seat);
  }

  private toLobby(): void {
    this.match = null;
    this.slotOwners = [];
    this.lobby.phase = 'lobby';
    for (const seat of this.seats) seat.slot = -1;
    for (const p of this.lobby.players) {
      p.ready = false;
      p.slot = -1;
    }
    this.log('back in the lobby');
    this.broadcastLobby();
  }

  /** The simulation threw: stop the match and take everyone back to the lobby rather than crash. */
  private abortMatch(err: unknown): void {
    this.logError(`match ${this.matchCount} aborted, the simulation failed: ${describeError(err)}`);
    this.toLobby();
  }

  /** Gives up the seats of players who stayed away longer than the grace period. */
  private expireSeats(now: number): void {
    const graceMs = this.options.graceSeconds * 1000;
    let changed = false;
    for (let i = this.seats.length - 1; i >= 0; i--) {
      const seat = this.seats[i];
      if (seat.connected || now - seat.droppedAt < graceMs) continue;
      this.removeSeat(seat);
      seat.peer.close(CLOSE_SEAT_RELEASED, 'the seat was given up');
      this.log(`seat ${seat.seat} given up after ${this.options.graceSeconds} s away`);
      changed = true;
    }
    if (changed) this.broadcastLobby();
  }

  /** The host role moves on when the host has been gone a while and somebody else is here. */
  private handOffHost(now: number): void {
    const host = this.seats.find((s) => s.seat === this.lobby.host);
    if (!host || host.connected) return;
    if (now - host.droppedAt < this.options.hostHandoffSeconds * 1000) return;
    let next: Seat | null = null;
    for (const seat of this.seats) {
      if (seat.connected && (!next || seat.seat < next.seat)) next = seat;
    }
    if (!next) return;
    this.lobby.host = next.seat;
    this.log(`host role passed to seat ${next.seat}`);
    this.broadcastLobby();
  }

  private removeSeat(seat: Seat): void {
    const i = this.seats.indexOf(seat);
    if (i < 0) return;
    this.seats.splice(i, 1);
    if (this.byPeer.get(seat.peer.id) === seat) this.byPeer.delete(seat.peer.id);
    // In a match the slot stays in the world; a bot plays it to the end.
    if (this.match && this.lobby.phase === 'match') setSlotLive(this.match, seat.slot, false, false);
    removeLobbyPlayer(this.lobby, seat.seat);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

