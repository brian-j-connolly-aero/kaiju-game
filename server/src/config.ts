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
 *   MB_MAX_ROOMS    rooms the server will run at once (default 50)
 *   MB_CLIENT_DIR   folder with the built client (default: client/dist next to the server)
 *   MB_QUIET=1      no log lines for room events
 */

import { DEFAULT_PORT } from '@mb/shared';
import { DEFAULT_END_SCREEN_SECONDS, DEFAULT_GRACE_SECONDS, DEFAULT_HOST_HANDOFF_SECONDS } from './room/gameRoom';

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
  maxRooms: number;
  /** Folder with the built client, or null to serve no page. */
  clientDir: string | null;
  /** Install SIGINT / SIGTERM handlers that shut the server down cleanly and exit. */
  handleSignals: boolean;
  log: ((line: string) => void) | undefined;
}

export const FAST_END_SCREEN_SECONDS = 20;
export const DEFAULT_MAX_ROOMS = 50;

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
    maxRooms: DEFAULT_MAX_ROOMS,
    clientDir: null,
    handleSignals: false,
    log: undefined,
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
  if (env.MB_CLIENT_DIR) fromEnv.clientDir = env.MB_CLIENT_DIR;
  return defaultConfig({ ...overrides, ...fromEnv });
}
