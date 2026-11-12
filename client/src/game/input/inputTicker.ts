/**
 * Turns frame time into the client's 30 Hz input ticks, and says how far the present moment
 * is past the newest tick: the fraction the local body is drawn at between its last two
 * predicted poses, so that it moves every frame and not only on every tick.
 */

import { DT } from '@mb/shared';

/** At very low frame rates the input ticks of a frame are sent in one burst, up to this many. */
export const MAX_TICKS_PER_FRAME = 8;

export class InputTicker {
  private accumulator = 0;

  /** Adds a frame's time and returns how many input ticks are due now. */
  advance(dt: number): number {
    this.accumulator = Math.min(this.accumulator + dt, DT * MAX_TICKS_PER_FRAME);
    let ticks = 0;
    while (this.accumulator >= DT) {
      this.accumulator -= DT;
      ticks++;
    }
    return ticks;
  }

  /** Time since the newest tick as a fraction of a tick, 0 (just ticked) up to 1. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / DT));
  }
}
