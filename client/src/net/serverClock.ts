/**
 * Estimates where the server's simulation clock is, from the arrival times of snapshots.
 *
 * Every snapshot carries the tick it was taken at. `tick * DT - arrival time` is a noisy sample
 * of the offset between the server's clock and ours (noisy because of network jitter and because
 * messages are only handled between frames). The estimate follows the samples slowly and jumps
 * only when it is clearly wrong (a new match, a long stall).
 *
 * Everything the client draws that it does not predict is shown `delay` seconds behind that
 * estimate, so there is almost always a newer snapshot to interpolate toward.
 */

import { DT } from '@mb/shared';

/** How far behind the newest server state other entities are drawn, seconds. */
export const INTERP_DELAY = 0.1;
/** How far past the newest snapshot the view may run before it holds still, seconds. */
export const MAX_EXTRAPOLATION = 0.12;

const SNAP_THRESHOLD = 0.35;
const FOLLOW_RATE = 0.08;

export interface ServerClock {
  /** Server time minus local time, seconds; NaN until the first sample. */
  offset: number;
  /** Tick of the newest snapshot seen. */
  newestTick: number;
  samples: number;
}

export function createServerClock(): ServerClock {
  return { offset: Number.NaN, newestTick: 0, samples: 0 };
}

/** Feeds the arrival of a snapshot taken at `tick`, received at local time `nowSeconds`. */
export function clockSample(clock: ServerClock, tick: number, nowSeconds: number): void {
  const sample = tick * DT - nowSeconds;
  if (Number.isNaN(clock.offset) || Math.abs(sample - clock.offset) > SNAP_THRESHOLD) {
    clock.offset = sample;
  } else {
    clock.offset += (sample - clock.offset) * FOLLOW_RATE;
  }
  if (tick > clock.newestTick || clock.samples === 0) clock.newestTick = tick;
  clock.samples++;
}

/** The server tick (fractional) to draw at local time `nowSeconds`. */
export function renderTick(clock: ServerClock, nowSeconds: number, delay = INTERP_DELAY): number {
  if (Number.isNaN(clock.offset)) return 0;
  const t = (nowSeconds + clock.offset - delay) / DT;
  const max = clock.newestTick + MAX_EXTRAPOLATION / DT;
  return Math.max(0, Math.min(t, max));
}
