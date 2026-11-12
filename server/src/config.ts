/**
 * Server configuration: one plain object, read once from the environment by the entry point
 * and passed down. Tests build it directly.
 *
 *   PORT            port for the page and the WebSocket (default 2567; 0 picks a free port)
 *   HOST            address to bind (default: every interface)
 *   MB_FAST=1       short match timers and a small destruction bar, for automated playtests;
 *                   the end screen also returns to the lobby sooner
 *   MB_LATENCY      simulated round-trip latency in milliseconds, for tests (default 0)
 *   MB_SPEED        simulation seconds per real second, for headless tests only (default 1);
 *                   real clients cannot predict at any other speed
 *   MB_GRACE        seconds a dropped player's seat is kept (default 45)
 *   MB_END_SCREEN   seconds before the end screen returns to the lobby by itself
 *                   (default 120, or 20 with MB_FAST; 0 waits for the host)
 *   MB_MAX_ROOMS    rooms with somebody in them that the server will run at once (default 50)
 *   MB_NO_LIMITS=1  switches off the per-visitor limits on creating rooms, joining and wrong
 *                   room codes (http/guard.ts); the size and sanity checks stay on
 *   MB_ANY_BUILD=1  lets in pages from any build of the game (shared/src/net/build.ts). A way
 *                   out for an evening when a browser is wrongly refused; expect a stale page
 *                   to misbehave
 *   MB_CLIENT_DIR   folder with the built client (default: client/dist next to the server)
 *   MB_PUBLIC_URL   the address friends open, such as https://kaiju.example.com (a named
 *                   tunnel). Unset: learned from requests that come through a quick tunnel
 *                   (http/publicUrl.ts). The lobby's link button builds invites from it
 *   MB_QUIET=1      no log lines for room events; failures are always printed
 */

import { DEFAULT_PORT } from '@mb/shared';
import { DEFAULT_RATE_LIMITS, type RateLimits } from './http/guard';
import { parsePublicUrl } from './http/publicUrl';
import {
  DEFAULT_END_SCREEN_SECONDS,
  DEFAULT_GRACE_SECONDS,
  DEFAULT_HOST_HANDOFF_SECONDS,
  DEFAULT_START_WAIT_SECONDS,
} from './room/gameRoom';

export interface ServerConfig {
  port: number;
  /** Address to bind; undefined binds every interface. */
  host: string | undefined;
  fast: boolean;
  latencyMs: number;
  speed: number;
  graceSeconds: number;
  endScreenSeconds: number;
  hostHandoffSeconds: number;
  /** Seconds after which the host may start although somebody connected is not ready. */
  startWaitSeconds: number;
  /** Rooms with somebody in them that may exist at once. */
  maxRooms: number;
  /** Seconds a connection may take to finish joining before it is closed. */
  joinTimeoutSeconds: number;
  /** Seconds a join request waits for its connection, and a new room for its creator. */
  reservationSeconds: number;
  /** Per-visitor limits on matchmaking requests (http/guard.ts). */
  limits: RateLimits;
  /**
   * The build stamp a joining page must carry; null works it out (shared rules plus the page
   * in `clientDir`). Tests set it to play a server that was rebuilt.
   */
  build: string | null;
  /** False lets in pages from any build (MB_ANY_BUILD=1). */
  checkBuild: boolean;
  /** Folder with the built client, or null to serve no page. */
  clientDir: string | null;
  /**
   * The address friends open (MB_PUBLIC_URL, checked, no trailing slash), or null to learn it
   * from requests that come through a quick tunnel.
   */
  publicUrl: string | null;
  /** Install SIGINT / SIGTERM handlers that shut the server down cleanly and exit. */
  handleSignals: boolean;
  /** Room chatter: who joined, what started. Undefined switches it off (MB_QUIET). */
  log: ((line: string) => void) | undefined;
  /** Failures. Always printed, whatever `log` is. */
  logError: (line: string) => void;
}

export const FAST_END_SCREEN_SECONDS = 20;
export const DEFAULT_MAX_ROOMS = 50;
export const DEFAULT_JOIN_TIMEOUT_SECONDS = 10;
export const DEFAULT_RESERVATION_SECONDS = 5;

export function defaultConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const fast = overrides.fast ?? false;
  return {
    port: DEFAULT_PORT,
    host: undefined,
    fast,
    latencyMs: 0,
    speed: 1,
    graceSeconds: DEFAULT_GRACE_SECONDS,
    endScreenSeconds: fast ? FAST_END_SCREEN_SECONDS : DEFAULT_END_SCREEN_SECONDS,
    hostHandoffSeconds: DEFAULT_HOST_HANDOFF_SECONDS,
    startWaitSeconds: DEFAULT_START_WAIT_SECONDS,
    maxRooms: DEFAULT_MAX_ROOMS,
    joinTimeoutSeconds: DEFAULT_JOIN_TIMEOUT_SECONDS,
    reservationSeconds: DEFAULT_RESERVATION_SECONDS,
    limits: { ...DEFAULT_RATE_LIMITS },
    build: null,
    checkBuild: true,
    clientDir: null,
    publicUrl: null,
    handleSignals: false,
    log: undefined,
    logError: (line) => console.error(line),
    ...overrides,
  };
}

function flag(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

/** A non-negative number from the environment, or undefined when unset. Throws on nonsense. */
function numberFrom(env: Record<string, string | undefined>, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number of 0 or more, got "${raw}"`);
  return value;
}

/** Builds the configuration from environment variables (see the list at the top of this file). */
export function configFromEnv(env: Record<string, string | undefined>, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const fromEnv: Partial<ServerConfig> = { fast: flag(env.MB_FAST) };
  const port = numberFrom(env, 'PORT');
  if (port !== undefined) {
    if (!Number.isInteger(port) || port > 65535) throw new Error(`PORT must be a whole number up to 65535, got "${env.PORT}"`);
    fromEnv.port = port;
  }
  if (env.HOST) fromEnv.host = env.HOST;
  const latency = numberFrom(env, 'MB_LATENCY');
  if (latency !== undefined) fromEnv.latencyMs = latency;
  const speed = numberFrom(env, 'MB_SPEED');
  if (speed !== undefined) {
    if (speed < 0.1 || speed > 100) throw new Error(`MB_SPEED must be between 0.1 and 100, got "${env.MB_SPEED}"`);
    fromEnv.speed = speed;
  }
  const grace = numberFrom(env, 'MB_GRACE');
  if (grace !== undefined) fromEnv.graceSeconds = grace;
  const endScreen = numberFrom(env, 'MB_END_SCREEN');
  if (endScreen !== undefined) fromEnv.endScreenSeconds = endScreen;
  const maxRooms = numberFrom(env, 'MB_MAX_ROOMS');
  if (maxRooms !== undefined) fromEnv.maxRooms = Math.max(1, Math.floor(maxRooms));
  if (flag(env.MB_NO_LIMITS)) fromEnv.limits = { createsPerMinute: 0, joinsPerMinute: 0, missesPerMinute: 0 };
  if (flag(env.MB_ANY_BUILD)) fromEnv.checkBuild = false;
  if (env.MB_CLIENT_DIR) fromEnv.clientDir = env.MB_CLIENT_DIR;
  if (env.MB_PUBLIC_URL && env.MB_PUBLIC_URL.trim() !== '') fromEnv.publicUrl = parsePublicUrl(env.MB_PUBLIC_URL);
  return defaultConfig({ ...overrides, ...fromEnv });
}
