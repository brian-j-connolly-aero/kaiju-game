import { describe, expect, it } from 'vitest';
import type { NetSample } from '../src/net/matchSession';
import { NET_WINDOW, SNAP_VISIBLE, summarizeNet } from '../src/ui/netReadout';

describe('the network readout (round 4)', () => {
  it('sums up the last 30 seconds: round trips, snapshot gaps, corrections and long frames', () => {
    const now = 100;
    const net: NetSample[] = [];
    // Older than the window: left out, however bad.
    net.push({ at: now - NET_WINDOW - 1, gap: 900, jump: 3, drops: 9, pending: 30 });
    for (let i = 0; i < 40; i++) net.push({ at: now - 20 + i * 0.067, gap: 67, jump: i === 10 ? 0.6 : i === 20 ? 0.05 : 0, drops: 0, pending: 5 });
    net.push({ at: now - 1, gap: 410, jump: SNAP_VISIBLE, drops: 2, pending: 14 });
    const pings = [
      { at: now - 40, value: 999 },
      { at: now - 10, value: 140 },
      { at: now - 2, value: 95 },
    ];
    const frames = [
      { at: now - 5, value: 16 },
      { at: now - 4, value: 130 },
      { at: now - 3, value: 17 },
    ];
    const s = summarizeNet(net, pings, frames, now);
    expect(s.rtt).toBe(95);
    expect(s.rttWorst).toBe(140);
    expect(s.gap).toBe(410);
    expect(s.gapWorst).toBe(410);
    expect(s.pending).toBe(14);
    expect(s.drops).toBe(2);
    expect(s.jumpLast).toBe(SNAP_VISIBLE);
    expect(s.jumpWorst).toBe(0.6);
    // The 60 cm one and the one right at 15 cm; 5 cm is drift, not a snap.
    expect(s.snaps).toBe(2);
    expect(s.frameWorst).toBe(130);
    expect(s.longFrames).toBe(1);
  });
});
