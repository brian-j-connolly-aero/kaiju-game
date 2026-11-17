/**
 * Turns frame time into the client's 30 Hz input ticks, and says how far the present moment
 * is past the newest tick: the fraction the local body is drawn at between its last two
 * predicted poses, so that it moves every frame and not only on every tick.
 *
 * The ticks follow the real clock, not the frame time the rest of the page plays (which stops
 * at a quarter second so that nothing leaps): after the page froze, or while it draws only a few
 * frames a second, it sends every input it owes, up to MAX_TICKS_PER_FRAME in one frame. The
 * server plays one input per tick and takes a tick with no input for a late one; a page that sent
 * fewer inputs than the time it took stayed late for good, its movement and aim thrown away and
 * its body stopped after a second (round 5: the third playtest's snapping back after a hitch).
 */

import { DT } from '@mb/shared';

/** The longest freeze after which a page still sends every input it owes, seconds. */
export const MAX_OWED_SECONDS = 1.5;
/** The most input ticks one frame sends: MAX_OWED_SECONDS of them (45). */
export const MAX_TICKS_PER_FRAME = Math.round(MAX_OWED_SECONDS / DT);

export class InputTicker {
  private accumulator = 0;
  /** The time of the previous `advanceTo`, seconds; NaN before the first. */
  private lastNow = Number.NaN;

  /** Adds a frame's time and returns how many input ticks are due now. */
  advance(dt: number): number {
    this.accumulator = Math.min(this.accumulator + dt, DT * MAX_TICKS_PER_FRAME);
    let ticks = 0;
    // (A hair of slack: 45 steps of a thirtieth do not add up to 1.5 exactly in floating point.)
    while (this.accumulator >= DT - 1e-9) {
      this.accumulator = Math.max(0, this.accumulator - DT);
      ticks++;
    }
    return ticks;
  }

  /**
   * The frame at local time `now` (seconds): the input ticks owed by the real time since the
   * previous frame. `dt` (the frame's own, possibly clamped, time) counts instead for the first
   * frame and when the clock went backwards.
   */
  advanceTo(now: number, dt: number): number {
    const real = now - this.lastNow;
    this.lastNow = now;
    return this.advance(real >= 0 ? real : dt);
  }

  /** Time since the newest tick as a fraction of a tick, 0 (just ticked) up to 1. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / DT));
  }
}
