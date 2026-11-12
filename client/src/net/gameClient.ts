/**
 * The client's side of a room: connects (create, or join by code), keeps the lobby state,
 * starts a MatchSession when the server sends a welcome, measures ping, and gets the seat back
 * when the connection is lost (ARCHITECTURE.md section 4.1).
 */

import {
  CLOSE_REPLACED,
  JOIN_ERROR,
  type ClientMessages,
  type ClientMessageType,
  type LobbyMessage,
  type LobbyState,
  type SimEvent,
  type WelcomeMessage,
} from '@mb/shared';
import { Emitter } from '../util/emitter';
import { CLOSE_CONSENTED, createRoom, ERROR_NO_ROOM, JoinFailure, joinRoom, type RoomLink } from './connection';
import { createLocalLink, type LocalMatchControl, type LocalMatchOptions } from './localLink';
import { MatchSession } from './matchSession';
import { forgetBuildReload, reloadForNewBuild } from './session';

export type LinkStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

/** Why the client is no longer in a room. */
export type ClosedReason =
  /** The player left on purpose. */
  | 'left'
  /** The same player opened the game in another tab, which took the seat. */
  | 'replaced'
  /** The room no longer exists. */
  | 'gone'
  /** The room is full, or the server refused for another reason. */
  | 'refused'
  /** This page and the server are different builds of the game, and reloading did not help. */
  | 'version'
  /** The server could not be reached. */
  | 'network';

export interface GameClientEvents {
  status: LinkStatus;
  lobby: LobbyMessage;
  /** A match began (or was joined in progress). */
  session: MatchSession;
  /** The match is over and the room is back in the lobby. */
  sessionEnded: null;
  /** A simulation event, released when the delayed view reaches its tick. */
  event: SimEvent;
  /** The city was replaced wholesale after a reconnection. */
  cityResync: null;
  closed: ClosedReason;
}

const PING_EVERY_MS = 2000;
const REJOIN_DELAYS_MS = [300, 1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

export interface GameClientOptions {
  /** Where the server is: the origin the page was loaded from. */
  origin: string;
  token: string;
  /** Local clock in milliseconds (performance.now in the browser). */
  now: () => number;
  /**
   * Reloads the page to fetch the current build after the server refused this one; `code` is
   * the room being joined ('' when creating one). Returns false when it did not reload (it
   * already has, once). Default: `reloadForNewBuild` and `forgetBuildReload` of session.ts.
   */
  reload?: (code: string) => boolean;
  /** Called once the server has let this page in. */
  admitted?: () => void;
}

export class GameClient {
  readonly events = new Emitter<GameClientEvents>();
  status: LinkStatus = 'offline';
  /** The room code, '' when not in a room. */
  code = '';
  lobby: LobbyState | null = null;
  /** The local player's seat, -1 when unknown. */
  seat = -1;
  session: MatchSession | null = null;
  /** Round trip time in milliseconds, smoothed; 0 until measured. */
  ping = 0;
  /** The sandbox simulation when this client runs one (`startLocal`), else null. */
  local: LocalMatchControl | null = null;

  private readonly options: GameClientOptions;
  private link: RoomLink | null = null;
  private name = '';
  private leaving = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  /** Counts connections so callbacks from an old link are ignored. */
  private generation = 0;

  constructor(options: GameClientOptions) {
    this.options = options;
  }

  private nowSeconds(): number {
    return this.options.now() / 1000;
  }

  private setStatus(status: LinkStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.emit('status', status);
  }

  // --- connecting ------------------------------------------------------------------------------

  /** Creates a room and joins it. Rejects with a JoinFailure. */
  async create(name: string): Promise<void> {
    await this.connect(name, null);
  }

  /** Joins the room with this code. Rejects with a JoinFailure. */
  async join(code: string, name: string): Promise<void> {
    await this.connect(name, code);
  }

  /**
   * Starts a sandbox match inside the page (no server): this player against the bots, at the
   * stage asked for. Everything downstream behaves as with a real room.
   */
  startLocal(options: LocalMatchOptions): void {
    this.dropLink();
    this.leaving = false;
    this.name = options.name;
    const generation = ++this.generation;
    const { link, control } = createLocalLink(options, (l) => this.attach(l, generation));
    this.local = control;
    this.code = link.code;
    this.setStatus('online');
  }

  private async connect(name: string, code: string | null): Promise<void> {
    this.dropLink();
    this.leaving = false;
    this.name = name;
    this.setStatus('connecting');
    const generation = ++this.generation;
    try {
      const subscribe = (link: RoomLink): void => this.attach(link, generation);
      const link = code === null
        ? await createRoom(this.options.origin, name, this.options.token, subscribe)
        : await joinRoom(this.options.origin, code, name, this.options.token, subscribe);
      if (generation !== this.generation) {
        link.leave();
        return;
      }
      this.code = link.code;
      this.admitted();
      this.setStatus('online');
    } catch (err) {
      if (generation === this.generation) this.setStatus('offline');
      // A page from another build than the server fetches the current one, once. If it is
      // refused again after that, the failure is reported like any other.
      if (err instanceof JoinFailure && err.code === JOIN_ERROR.version) this.reloadPage(code ?? '');
      throw err;
    }
  }

  private reloadPage(code: string): boolean {
    return (this.options.reload ?? reloadForNewBuild)(code);
  }

  private admitted(): void {
    (this.options.admitted ?? forgetBuildReload)();
  }

  private attach(link: RoomLink, generation: number): void {
    this.link = link;
    const current = (): boolean => generation === this.generation;
    link.on('lobby', (msg) => {
      if (current()) this.onLobby(msg);
    });
    link.on('welcome', (msg) => {
      if (current()) this.onWelcome(msg);
    });
    link.on('snap', (bytes) => {
      if (current()) this.session?.handleSnapshot(bytes, this.nowSeconds());
    });
    link.on('events', (events) => {
      if (current()) this.session?.handleEvents(events, this.nowSeconds());
    });
    link.on('pong', (msg) => {
      if (!current()) return;
      const rtt = Math.max(0, this.options.now() - msg.t);
      this.ping = this.ping === 0 ? rtt : this.ping + (rtt - this.ping) * 0.3;
    });
    link.onDropped(() => {
      if (current()) this.setStatus('reconnecting');
    });
    link.onReconnected(() => {
      if (current()) this.setStatus('online');
    });
    link.onClosed((code) => {
      if (current()) this.onClosed(code);
    });
    if (this.pingTimer === null) {
      this.pingTimer = setInterval(() => {
        if (this.status === 'online') this.link?.send('ping', { t: this.options.now() });
      }, PING_EVERY_MS);
    }
  }

  private dropLink(): void {
    this.generation++;
    this.local = null;
    if (this.rejoinTimer !== null) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.link = null;
  }

  /** Leaves the room on purpose and forgets it. */
  leave(): void {
    this.leaving = true;
    const link = this.link;
    this.dropLink();
    link?.leave();
    this.reset();
    this.setStatus('offline');
    this.events.emit('closed', 'left');
  }

  /** Drops the socket without telling the server (to exercise the reconnection path). */
  simulateDrop(): void {
    this.link?.cut();
  }

  private reset(): void {
    if (this.session) {
      this.session = null;
      this.events.emit('sessionEnded', null);
    }
    this.lobby = null;
    this.seat = -1;
    this.code = '';
  }

  // --- messages --------------------------------------------------------------------------------

  private onLobby(msg: LobbyMessage): void {
    const before = this.lobby?.phase;
    this.lobby = msg.lobby;
    this.seat = msg.you;
    this.code = msg.lobby.code;
    if (msg.lobby.phase === 'lobby' && this.session && before !== undefined) {
      this.session = null;
      this.events.emit('sessionEnded', null);
    }
    this.events.emit('lobby', msg);
  }

  private onWelcome(welcome: WelcomeMessage): void {
    if (this.session && this.session.sameMatch(welcome) && welcome.playerId === this.session.role.playerId) {
      this.session.resync(welcome);
      return;
    }
    let session: MatchSession;
    try {
      session = new MatchSession(welcome, {
        sendInput: (input) => this.send('input', input),
        sendCommand: (command) => this.send('command', command),
        onEvent: (event) => this.events.emit('event', event),
        onCityResync: () => this.events.emit('cityResync', null),
      });
    } catch (err) {
      // The welcome describes a city this page cannot build: it is not the server's build after
      // all. Staying would mean sitting in the lobby while the others play, so get out, the
      // same way as when the server refuses a page at the door.
      console.error('net: could not start the match from the welcome message', err);
      this.failVersion();
      return;
    }
    if (!session.mirror.trusted) {
      console.warn('net: this page builds a different city than the server; prediction is off. Reload the page.');
    }
    this.session = session;
    this.events.emit('session', session);
  }

  /** This page cannot play on this server: reload it once, else leave the room and say so. */
  private failVersion(): void {
    const code = this.code;
    const link = this.link;
    this.leaving = true;
    this.dropLink();
    // Leaving on purpose gives the seat up, so nobody waits for a player who cannot take part.
    link?.leave();
    this.reset();
    this.setStatus('offline');
    if (!this.reloadPage(code)) this.events.emit('closed', 'version');
  }

  private onClosed(code: number): void {
    if (this.leaving || code === CLOSE_CONSENTED) return;
    if (code === CLOSE_REPLACED) {
      this.dropLink();
      this.reset();
      this.setStatus('offline');
      this.events.emit('closed', 'replaced');
      return;
    }
    // The connection is gone and the library gave up (or never tried): join again by code with
    // the same token, which gives the seat back while the server still holds it.
    this.setStatus('reconnecting');
    this.rejoin(0);
  }

  private rejoin(attempt: number): void {
    const code = this.code;
    if (!code || this.leaving) return;
    const generation = ++this.generation;
    const delay = REJOIN_DELAYS_MS[Math.min(attempt, REJOIN_DELAYS_MS.length - 1)];
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      if (generation !== this.generation) return;
      joinRoom(this.options.origin, code, this.name, this.options.token, (link) => this.attach(link, generation))
        .then((link) => {
          if (generation !== this.generation) {
            link.leave();
            return;
          }
          this.admitted();
          this.setStatus('online');
        })
        .catch((err: unknown) => {
          if (generation !== this.generation) return;
          const failure = err instanceof JoinFailure ? err : new JoinFailure(0, String(err));
          const reason = closedReasonFor(failure.code);
          if (reason === 'network' && attempt + 1 < REJOIN_DELAYS_MS.length) {
            this.rejoin(attempt + 1);
            return;
          }
          this.dropLink();
          this.reset();
          this.setStatus('offline');
          if (reason === 'version' && this.reloadPage(code)) return;
          this.events.emit('closed', reason);
        });
    }, delay);
  }

  // --- sending ---------------------------------------------------------------------------------

  send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void {
    if (this.status !== 'online' || !this.link) return;
    try {
      this.link.send(type, payload);
    } catch (err) {
      console.warn(`net: could not send "${type}"`, err);
    }
  }

  /** The local player's entry in the lobby, or null. */
  me(): LobbyState['players'][number] | null {
    return this.lobby?.players.find((p) => p.seat === this.seat) ?? null;
  }

  isHost(): boolean {
    return this.lobby !== null && this.lobby.host === this.seat;
  }
}

/** Maps a failed join's error code to what the player should be shown. */
export function closedReasonFor(code: number): ClosedReason {
  if (code === ERROR_NO_ROOM) return 'gone';
  if (code === JOIN_ERROR.version) return 'version';
  if (code === JOIN_ERROR.roomFull || code === JOIN_ERROR.serverFull) return 'refused';
  return 'network';
}
