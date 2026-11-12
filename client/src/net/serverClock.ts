/**
 * Estimates where the server's simulation clock is, from the arrival times of snapshots, and
 * keeps the clock the view is drawn by.
 *
 * Every snapshot carries the tick it was taken at. `tick * DT - arrival time` is a sample of the
 * offset between the server's clock and ours. A sample can only be late, never early (the
 * network, a busy server and a busy page all add delay), so the estimate trusts the samples
 * that say the server is further on, follows the ones that say it is less far on more slowly,
 * and treats snapshots that arrive together (a burst after a stall) as one sample: the newest.
 *
 * Everything the client draws that it does not predict is shown `delay` seconds behind that
 * estimate, so there is almost always a newer snapshot to interpolate toward. The drawn clock
 * itself never jumps and never runs backwards: when the estimate moves, the drawn clock runs a
 * little faster or slower until it is back where it belongs. It only starts afresh when the
 * timeline itself changed (a new match, frames that stopped for a while, a server that stood
 * still for seconds).
 */

import { DT } from '@mb/shared';

/** How far behind the newest server state other entities are drawn, seconds. */
export const INTERP_DELAY = 0.1;
/** How far past the newest snapshot the view may run before it holds still, seconds. */
export const MAX_EXTRAPOLATION = 0.12;

/** A sample this far from the estimate, or a drawn clock this far from where it should be: start afresh. */
const RESET_THRESHOLD = 1;
/** Share of the way the estimate moves toward a sample that says the server is further on. */
const FOLLOW_UP = 0.5;
/** ... and toward one that says it is less far on (a late arrival, or a server that fell behind). */
const FOLLOW_DOWN = 0.3;
/** Snapshots arriving within this many seconds of the first of them are one burst. */
const BURST_WINDOW = 0.004;
/** The drawn clock runs between these multiples of real time while it steers back to where it belongs. */
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;
/** Share of the drawn clock's error taken out per second (before the rate limits). */
const STEER = 5;

export interface ServerClock {
  /** Server time minus local time, seconds; NaN until the first sample. */
  offset: number;
  /** Tick of the newest snapshot seen. */
  newestTick: number;
  samples: number;
  /** The best sample of the burst being received, its tick and when the burst began; NaN when none waits. */
  pending: number;
  pendingTick: number;
  pendingAt: number;
  /** The tick the view was last drawn at and the local time of that frame; NaN before the first frame. */
  drawn: number;
  drawnAt: number;
}

export function createServerClock(): ServerClock {
  return { offset: Number.NaN, newestTick: 0, samples: 0, pending: Number.NaN, pendingTick: 0, pendingAt: 0, drawn: Number.NaN, drawnAt: 0 };
}

/** Takes the waiting burst into the estimate. */
function commit(clock: ServerClock): void {
  const sample = clock.pending;
  if (Number.isNaN(sample)) return;
  clock.pending = Number.NaN;
  if (Number.isNaN(clock.offset) || Math.abs(sample - clock.offset) > RESET_THRESHOLD) {
    // The first sample, or a different timeline: take it as it is and draw from there.
    clock.offset = sample;
    clock.newestTick = clock.pendingTick;
    clock.drawn = Number.NaN;
  } else {
    clock.offset += (sample - clock.offset) * (sample > clock.offset ? FOLLOW_UP : FOLLOW_DOWN);
  }
}

/** Feeds the arrival of a snapshot taken at `tick`, received at local time `nowSeconds`. */
export function clockSample(clock: ServerClock, tick: number, nowSeconds: number): void {
  const sample = tick * DT - nowSeconds;
  if (!Number.isNaN(clock.pending) && nowSeconds - clock.pendingAt > BURST_WINDOW) commit(clock);
  if (Number.isNaN(clock.pending)) {
    clock.pending = sample;
    clock.pendingTick = tick;
    clock.pendingAt = nowSeconds;
  } else if (sample > clock.pending) {
    // The same moment, a newer tick: the earlier snapshots of the burst were only late.
    clock.pending = sample;
    clock.pendingTick = tick;
  }
  if (tick > clock.newestTick || clock.samples === 0) clock.newestTick = tick;
  clock.samples++;
  if (Number.isNaN(clock.offset)) commit(clock);
}

/**
 * The server tick (fractional) to draw at local time `nowSeconds`. Call it once per frame: it
 * moves the drawn clock on from the previous call. The result never decreases from one call to
 * the next, except when the clock starts afresh.
 */
export function renderTick(clock: ServerClock, nowSeconds: number, delay = INTERP_DELAY): number {
  commit(clock);
  if (Number.isNaN(clock.offset)) return 0;
  const cap = clock.newestTick + MAX_EXTRAPOLATION / DT;
  const target = Math.max(0, Math.min((nowSeconds + clock.offset - delay) / DT, cap));
  const elapsed = (nowSeconds - clock.drawnAt) / DT;
  const error = target - (clock.drawn + elapsed);
  if (Number.isNaN(clock.drawn) || !(elapsed >= 0) || elapsed * DT > RESET_THRESHOLD || Math.abs(error) * DT > RESET_THRESHOLD) {
    clock.drawn = target;
  } else {
    // Run faster or slower than real time, in proportion to the error and within limits, and
    // never past the point where the error is gone.
    const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, 1 + error * DT * STEER));
    let step = elapsed * rate;
    if (error >= 0) step = Math.min(step, elapsed + error);
    else step = Math.max(step, elapsed + error, elapsed * MIN_RATE);
    clock.drawn = Math.max(clock.drawn, Math.min(cap, clock.drawn + step));
  }
  clock.drawnAt = nowSeconds;
  return clock.drawn;
}
