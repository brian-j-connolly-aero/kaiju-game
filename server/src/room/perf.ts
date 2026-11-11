/**
 * A small meter for the room loop: how long each update takes, how late the timer calls it, and
 * how fast the simulation really runs. It keeps the most recent samples only (about 100 s of a
 * match), so `/healthz` always describes the present and nothing grows.
 *
 * It exists for two readers: the playtests, which record the numbers against the budget in
 * ARCHITECTURE.md, and whoever hosts the game and wonders whether their PC keeps up.
 */

export interface PerfMeter {
  /** Milliseconds each update took (ring buffer). */
  work: Float32Array;
  /** Milliseconds between the starts of consecutive updates (ring buffer). */
  gap: Float32Array;
  /** Simulation ticks each update ran (ring buffer). */
  ticks: Float32Array;
  /** Samples written so far (may exceed the capacity). */
  count: number;
}

export interface PerfSpread {
  mean: number;
  p99: number;
  max: number;
}

export interface PerfReport {
  /** Updates the figures are taken from (0 when no match has run yet). */
  samples: number;
  /** Time spent inside one update (simulation, snapshot, sending), milliseconds. */
  updateMs: PerfSpread;
  /** Time between two updates, milliseconds; the timer aims at 33.3. */
  gapMs: PerfSpread;
  /** Simulation ticks per wall-clock second over the window; 30 when the server keeps up. */
  ticksPerSecond: number;
}

export function createPerfMeter(capacity = 3000): PerfMeter {
  return { work: new Float32Array(capacity), gap: new Float32Array(capacity), ticks: new Float32Array(capacity), count: 0 };
}

/** Records one update: how long it took, how long since the previous one began, how many ticks it ran. */
export function perfSample(meter: PerfMeter, workMs: number, gapMs: number, ticks: number): void {
  const i = meter.count % meter.work.length;
  meter.work[i] = workMs;
  meter.gap[i] = gapMs;
  meter.ticks[i] = ticks;
  meter.count++;
}

function spread(values: Float32Array, n: number): PerfSpread {
  if (n === 0) return { mean: 0, p99: 0, max: 0 };
  const sorted = Array.from(values.subarray(0, n)).sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  const round = (v: number): number => Math.round(v * 100) / 100;
  return { mean: round(sum / n), p99: round(sorted[Math.min(n - 1, Math.floor(n * 0.99))]), max: round(sorted[n - 1]) };
}

export function perfReport(meter: PerfMeter): PerfReport {
  const n = Math.min(meter.count, meter.work.length);
  let ticks = 0;
  let wall = 0;
  for (let i = 0; i < n; i++) {
    ticks += meter.ticks[i];
    wall += meter.gap[i];
  }
  return {
    samples: n,
    updateMs: spread(meter.work, n),
    gapMs: spread(meter.gap, n),
    ticksPerSecond: wall > 0 ? Math.round((ticks / wall) * 10000) / 10 : 0,
  };
}
