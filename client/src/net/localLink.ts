/**
 * A sandbox "server" inside the page: it runs the shared simulation locally and speaks the same
 * messages a real room does, so the whole client (prediction, interpolation, effects, HUD,
 * audio) can be exercised with no server at all. One person against the bots, starting at any
 * stage. It exists for visual checks and automated screenshots (`?sandbox=2`), not for play
 * between people: there is no room to join.
 */

import {
  beginStage,
  createLobbyState,
  createMatchConfig,
  createWorld,
  DT,
  encodeSnapshot,
  queueCommand,
  sanitizeCommand,
  sanitizeInput,
  SNAPSHOT_EVERY_TICKS,
  snapshotOfWorld,
  welcomeFor,
  type ClientMessages,
  type ClientMessageType,
  type LobbyMessage,
  type PlayerInput,
  type ServerMessages,
  type ServerMessageType,
  type SimEvent,
  type StageId,
  type World,
} from '@mb/shared';
import type { RoomLink } from './connection';

export interface LocalMatchOptions {
  name: string;
  role: 'kaiju' | 'human';
  /** Stage to start at (the simulation is moved straight there). */
  stage: StageId;
  seed?: number;
  /** Short timers and a small bar, as on a server started with MB_FAST=1. */
  fast?: boolean;
}

type Handlers = { [K in ServerMessageType]: Array<(payload: ServerMessages[K]) => void> };

const MAX_CATCH_UP_TICKS = 4;

/**
 * Starts a local match. `subscribe` is called before the first message, like the real
 * connection's, and messages are delivered asynchronously so the caller's order of events is
 * the same as over a socket.
 */
export function createLocalLink(options: LocalMatchOptions, subscribe: (link: RoomLink) => void): RoomLink {
  const handlers: Handlers = { welcome: [], lobby: [], snap: [], events: [], pong: [] };
  const emit = <K extends ServerMessageType>(type: K, payload: ServerMessages[K]): void => {
    for (const handler of handlers[type]) handler(payload);
  };

  const config = createMatchConfig({ humans: [{ name: options.name || 'Solo', role: options.role }], fast: options.fast ?? false });
  const world: World = createWorld({ seed: options.seed ?? 9001, config });
  const playerId = options.role === 'kaiju' ? 0 : 1;

  const lobby = createLobbyState('SOLO');
  lobby.phase = 'match';
  lobby.host = 0;
  lobby.lastKaijuSeat = options.role === 'kaiju' ? 0 : -1;
  lobby.options.botKaiju = options.role !== 'kaiju';
  lobby.options.fast = options.fast ?? false;
  lobby.players.push({
    seat: 0,
    name: options.name || 'Solo',
    wantsKaiju: options.role === 'kaiju',
    faction: config.players[playerId].faction,
    kaijuKind: config.players[0].kaijuKind,
    ready: true,
    connected: true,
    slot: playerId,
  });
  const lobbyMessage = (): LobbyMessage => ({ lobby: { ...lobby, players: lobby.players.map((p) => ({ ...p })) }, you: 0 });

  const queue: PlayerInput[] = [];
  let ack = 0;
  let pending: SimEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = 0;
  let owed = 0;
  let closed = false;

  const stepOnce = (): void => {
    const inputs: Array<PlayerInput | null> = [];
    const next = queue.shift();
    if (next) {
      inputs[playerId] = next;
      ack = next.seq;
    }
    const events = world.step(inputs);
    for (const e of events) pending.push(e);
    if (world.tick % SNAPSHOT_EVERY_TICKS === 0 || world.match.phase === 'ended') {
      if (pending.length > 0) {
        emit('events', pending);
        pending = [];
      }
      emit('snap', encodeSnapshot(snapshotOfWorld(world, ack)));
    }
    if (world.match.phase === 'ended' && lobby.phase !== 'end') {
      lobby.phase = 'end';
      emit('lobby', lobbyMessage());
    }
  };

  const start = (): void => {
    if (closed) return;
    // Skip to the wanted stage before anyone watches: through the briefing, then straight in.
    if (options.stage > 1) {
      for (let i = 0; i < 2000 && world.match.phase !== 'playing'; i++) world.step([]);
      world.events = [];
      beginStage(world, options.stage);
      world.events = [];
    }
    emit('lobby', lobbyMessage());
    emit('welcome', welcomeFor(world, playerId));
    emit('snap', encodeSnapshot(snapshotOfWorld(world, ack)));
    last = performance.now();
    timer = setInterval(() => {
      const now = performance.now();
      owed = Math.min(owed + (now - last) / 1000, DT * MAX_CATCH_UP_TICKS);
      last = now;
      while (owed >= DT) {
        owed -= DT;
        if (world.match.phase !== 'ended') stepOnce();
      }
    }, 1000 / 60);
  };

  const link: RoomLink = {
    code: 'SOLO',
    send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void {
      if (closed) return;
      if (type === 'input') {
        const input = sanitizeInput(payload);
        if (!input) return;
        queue.push(input);
        // The same rule as the server: a queue that has fallen behind jumps to the present.
        if (queue.length > 5) queue.splice(0, queue.length - 2);
      } else if (type === 'command') {
        const command = sanitizeCommand(payload);
        if (command) queueCommand(world, playerId, command);
      } else if (type === 'ping') {
        const t = (payload as ClientMessages['ping']).t;
        setTimeout(() => emit('pong', { t, tick: world.tick }), 0);
      }
      // Lobby actions have nothing to act on here: the sandbox is always one match.
    },
    on<K extends ServerMessageType>(type: K, handler: (payload: ServerMessages[K]) => void): () => void {
      handlers[type].push(handler);
      return () => {
        const list = handlers[type];
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
      };
    },
    onClosed() {
      // A local match never loses its connection.
    },
    onDropped() {
      // See onClosed.
    },
    onReconnected() {
      // See onClosed.
    },
    leave() {
      closed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    cut() {
      // Nothing to cut.
    },
  };
  subscribe(link);
  setTimeout(start, 0);
  return link;
}
