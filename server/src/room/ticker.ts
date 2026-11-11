/**
 * A steady timer for the room loop. `setInterval` drifts and bunches up after a stall; this
 * aims every call at an absolute deadline instead, so the average rate is exact, and after a
 * stall it simply starts again from now (the accumulator in fixedStep.ts decides how much
 * simulation to run, never the timer).
 */

import { performance } from 'node:perf_hooks';

export interface Ticker {
  stop(): void;
}

export function startTicker(hz: number, fn: () => void, onError: (err: unknown) => void): Ticker {
  const period = 1000 / hz;
  let next = performance.now() + period;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const run = (): void => {
    if (stopped) return;
    try {
      fn();
    } catch (err) {
      onError(err);
    }
    if (stopped) return;
    const now = performance.now();
    next += period;
    // Fell more than a period behind (a stall): do not fire a burst, start over from now.
    if (next < now) next = now + period;
    timer = setTimeout(run, Math.max(1, next - now));
  };

  timer = setTimeout(run, period);
  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
