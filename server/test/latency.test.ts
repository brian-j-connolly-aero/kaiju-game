/**
 * The simulated latency option (MB_LATENCY): a server that delays every message, to test
 * clients against a slow connection without one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config';
import { options, Player, startTestServer, until, type TestServer } from './netHelpers';

const LATENCY_MS = 160;

let ts: TestServer;
let player: Player | null = null;

beforeAll(async () => {
  // Configured the way the command line does it.
  const fromEnv = configFromEnv({ MB_LATENCY: String(LATENCY_MS), MB_FAST: '1' });
  expect(fromEnv.latencyMs).toBe(LATENCY_MS);
  ts = await startTestServer({ latencyMs: fromEnv.latencyMs, fast: fromEnv.fast });
});

afterAll(async () => {
  player?.stopInputs();
  await ts.server.close();
});

describe('simulated latency', () => {
  it('delays the round trip by about the configured time and everything still works', async () => {
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
    expect(best).toBeLessThan(LATENCY_MS + 250);

    // A match over the slow link: inputs are acknowledged, late but in order.
    p.client.send('start', {});
    await until(() => p.welcomes.length === 1, 'the welcome');
    p.startInputs({ moveZ: 1 });
    await until(() => p.snapshots.length > 10 && p.snapshot.ackSeq > 5, 'acknowledged inputs over the slow link');
    const acks = p.snapshots.map((s) => s.ackSeq);
    expect(acks).toEqual([...acks].sort((a, b) => a - b));
    // What the server has applied trails what was sent by at least the latency.
    expect(p.lastSeq - p.snapshot.ackSeq).toBeGreaterThanOrEqual(Math.floor((LATENCY_MS / 1000) * 30) - 2);
    await p.leave();
  });
});
