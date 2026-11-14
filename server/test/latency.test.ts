/**
 * The simulated latency and jitter options (MB_LATENCY, MB_JITTER): a server that delays every
 * message, by a random amount on top, to test clients against a slow and uneven connection
 * without one. The same server runs with a room limit of one, to check what happens when the
 * server is full.
 */

import { JOIN_ERROR } from '@mb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config';
import { ackOf } from './helpers';
import { options, Player, startTestServer, until, type TestServer } from './netHelpers';

const LATENCY_MS = 160;
const JITTER_MS = 40;

let ts: TestServer;
let player: Player | null = null;

beforeAll(async () => {
  // Configured the way the command line does it.
  const fromEnv = configFromEnv({ MB_LATENCY: String(LATENCY_MS), MB_JITTER: String(JITTER_MS), MB_FAST: '1' });
  expect(fromEnv.latencyMs).toBe(LATENCY_MS);
  expect(fromEnv.jitterMs).toBe(JITTER_MS);
  ts = await startTestServer({ latencyMs: fromEnv.latencyMs, jitterMs: fromEnv.jitterMs, fast: fromEnv.fast, maxRooms: 1 });
});

afterAll(async () => {
  player?.stopInputs();
  await ts.server.close();
});

describe('simulated latency', () => {
  it('delays the round trip by about the configured time, in order, and everything still works', async () => {
    const p = await Player.create(ts.url, options(50));
    player = p;
    await until(() => p.lobbies.length > 0, 'the lobby');

    const roundTrips: number[] = [];
    for (let i = 0; i < 3; i++) {
      const sentAt = performance.now();
      p.client.send('ping', { t: i });
      await until(() => p.pongs.length === i + 1, `pong ${i}`);
      roundTrips.push(p.pongs[i].receivedAt - sentAt);
    }
    const best = Math.min(...roundTrips);
    expect(best).toBeGreaterThanOrEqual(LATENCY_MS * 0.9);
    expect(best).toBeLessThan(LATENCY_MS + 2 * JITTER_MS + 250);
    // Each held back at random, yet a burst comes back in the order it went out.
    for (let i = 3; i < 13; i++) p.client.send('ping', { t: i });
    await until(() => p.pongs.length === 13, 'a burst of pongs');
    expect(p.pongs.map((m) => m.t)).toEqual([...Array(13).keys()]);

    // The server is at its room limit: creating another room is refused with a clear code.
    const refused = await Player.create(ts.url, options(51)).then(
      () => null,
      (e: unknown) => e,
    );
    expect((refused as { code?: number } | null)?.code).toBe(JOIN_ERROR.serverFull);
    expect(ts.server.health().rooms).toBe(1);

    // A match over the slow link: inputs are acknowledged, late but in order.
    p.client.send('start', {});
    await until(() => p.welcomes.length === 1, 'the welcome');
    p.startInputs({ moveZ: 1 });
    await until(() => p.snapshots.length > 10 && ackOf(p.snapshot).played > 5, 'acknowledged inputs over the slow link');
    const acks = p.snapshots.map((s) => ackOf(s).played);
    expect(acks).toEqual([...acks].sort((a, b) => a - b));
    // What the server has played trails what was sent by at least the latency.
    expect(p.lastSeq - ackOf(p.snapshot).played).toBeGreaterThanOrEqual(Math.floor((LATENCY_MS / 1000) * 30) - 2);
    await p.leave();

    // With the room closed there is space again.
    await until(() => ts.server.health().rooms === 0, 'the room to close');
    const next = await Player.create(ts.url, options(52));
    await until(() => next.lobbies.length > 0, 'the new room to open');
    expect(next.code).not.toBe(p.code);
    await next.leave();
  });
});
