/**
 * Helpers for the integration tests: a real server on a free port and real clients that connect
 * to it from Node the way a browser does, keeping everything they receive.
 */

import {
  decodeSnapshot,
  type JoinOptions,
  type LobbyMessage,
  type LobbyState,
  type PlayerInput,
  type PongMessage,
  type SimEvent,
  type Snapshot,
  type WelcomeMessage,
} from '@mb/shared';
import { defaultConfig, type ServerConfig } from '../src/config';
import { createRoom, joinRoom, type ConnectOptions, type NodeGameClient } from '../src/net/nodeClient';
import { startGameServer, type GameServer } from '../src/net/server';

export interface TestServer {
  server: GameServer;
  url: string;
}

export async function startTestServer(overrides: Partial<ServerConfig> = {}): Promise<TestServer> {
  const server = await startGameServer(defaultConfig({ port: 0, host: '127.0.0.1', fast: true, ...overrides }));
  return { server, url: `http://127.0.0.1:${server.port}` };
}

/** Waits until the condition holds. Fails with what was being waited for when it never does. */
export async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One connected test client and everything the server has sent it. */
export class Player {
  readonly client: NodeGameClient;
  readonly lobbies: LobbyMessage[] = [];
  readonly welcomes: WelcomeMessage[] = [];
  readonly snapshots: Snapshot[] = [];
  readonly events: SimEvent[] = [];
  readonly pongs: Array<PongMessage & { receivedAt: number }> = [];
  /** Message types in the order they arrived. */
  readonly order: string[] = [];
  closedCode: number | null = null;
  drops = 0;
  reconnects = 0;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;

  private constructor(client: NodeGameClient) {
    this.client = client;
    client.on('lobby', (m) => {
      this.order.push('lobby');
      this.lobbies.push(m);
    });
    client.on('welcome', (m) => {
      this.order.push('welcome');
      this.welcomes.push(m);
    });
    client.on('snap', (bytes) => {
      this.order.push('snap');
      this.snapshots.push(decodeSnapshot(bytes));
    });
    client.on('events', (events) => {
      this.order.push('events');
      this.events.push(...events);
    });
    client.on('pong', (m) => {
      this.order.push('pong');
      this.pongs.push({ ...m, receivedAt: performance.now() });
    });
    client.onClosed((code) => {
      this.closedCode = code;
      this.stopInputs();
    });
    client.onDropped(() => this.drops++);
    client.onReconnected(() => this.reconnects++);
  }

  static async create(url: string, options: ConnectOptions = {}): Promise<Player> {
    let player: Player | null = null;
    await createRoom(url, options, (client) => (player = new Player(client)));
    if (!player) throw new Error('the room was not created');
    return player;
  }

  static async join(url: string, code: string, options: ConnectOptions = {}): Promise<Player> {
    let player: Player | null = null;
    await joinRoom(url, code, options, (client) => (player = new Player(client)));
    if (!player) throw new Error('the room was not joined');
    return player;
  }

  get code(): string {
    return this.client.code;
  }

  get lobby(): LobbyState {
    const last = this.lobbies[this.lobbies.length - 1];
    if (!last) throw new Error('no lobby message received yet');
    return last.lobby;
  }

  get seat(): number {
    const last = this.lobbies[this.lobbies.length - 1];
    if (!last) throw new Error('no lobby message received yet');
    return last.you;
  }

  get welcome(): WelcomeMessage {
    const last = this.welcomes[this.welcomes.length - 1];
    if (!last) throw new Error('no welcome received yet');
    return last;
  }

  get snapshot(): Snapshot {
    const last = this.snapshots[this.snapshots.length - 1];
    if (!last) throw new Error('no snapshot received yet');
    return last;
  }

  get lastSeq(): number {
    return this.seq;
  }

  sendInput(fields: Partial<PlayerInput> = {}): void {
    this.client.send('input', { seq: ++this.seq, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0, ...fields });
  }

  /** Sends an input 30 times a second, as a playing client does. */
  startInputs(fields: Partial<PlayerInput> = {}): void {
    this.stopInputs();
    this.timer = setInterval(() => this.sendInput(fields), 1000 / 30);
  }

  stopInputs(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async leave(): Promise<void> {
    this.stopInputs();
    if (this.closedCode === null) await this.client.leave();
  }
}

export function token(i: number): string {
  return `test-token-${i}-0123456789`;
}

export function options(i: number, extra: JoinOptions = {}): JoinOptions {
  return { name: `Tester ${i}`, token: token(i), ...extra };
}
