/**
 * The fixed-step accumulator: turns wall-clock time into a whole number of simulation ticks.
 *
 * It can never spiral. Three things bound the work one call may ask for:
 *   - a single gap between calls counts for at most `maxFrameMs` (a stalled process, a laptop
 *     that slept, a debugger pause);
 *   - one call asks for at most `maxSteps` ticks;
 *   - when more than that is owed, the rest is dropped, so the simulation runs slow for a moment
 *     instead of trying to catch up forever.
 *
 * Timers fire a little early as often as a little late, so a tick is due once the owed time is
 * within `slopMs` of a full step. The remainder (which may be slightly negative) carries over,
 * which keeps the long-run rate exact.
 */

export interface FixedStep {
  /** Time of the previous call, milliseconds; meaningless until `started`. */
  last: number;
  /** Simulation time owed and not yet stepped, milliseconds. */
  owed: number;
  started: boolean;
}

export interface FixedStepOptions {
  /** Length of one tick, milliseconds. */
  stepMs: number;
  /** Most ticks one call may return. */
  maxSteps: number;
  /** Longest gap between two calls that is taken at face value, milliseconds. */
  maxFrameMs: number;
  /** How early a tick may run, milliseconds. */
  slopMs: number;
  /** Simulation seconds per wall-clock second (1 in real play; more only in headless tests). */
  speed: number;
}

export function createFixedStep(): FixedStep {
  return { last: 0, owed: 0, started: false };
}

/** Forgets owed time, so the next call starts a fresh measurement. */
export function resetFixedStep(clock: FixedStep): void {
  clock.started = false;
  clock.owed = 0;
}

/** How many ticks to run now. Call it with a monotonic clock, as often as you like. */
export function dueSteps(clock: FixedStep, nowMs: number, o: FixedStepOptions): number {
  if (!clock.started) {
    clock.started = true;
    clock.last = nowMs;
    return 0;
  }
  const dt = nowMs - clock.last;
  clock.last = nowMs;
  // A clock that stood still, ran backwards or returned NaN adds nothing.
  if (!(dt > 0)) return 0;

  clock.owed += Math.min(dt, o.maxFrameMs) * o.speed;
  let steps = Math.floor((clock.owed + o.slopMs) / o.stepMs);
  if (steps <= 0) return 0;
  if (steps > o.maxSteps) {
    steps = o.maxSteps;
    clock.owed = 0;
  } else {
    clock.owed -= steps * o.stepMs;
  }
  return steps;
}
