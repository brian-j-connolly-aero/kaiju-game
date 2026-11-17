/**
 * The fixed-step accumulator: turns wall-clock time into a whole number of simulation ticks.
 *
 * After the server stood still (a busy host computer, the container's virtual machine paused, a
 * garbage collection), the time it owes is caught up, a few ticks per call, so the match keeps
 * pace with the players: they send 30 inputs a second whatever the server does, and every tick
 * the match does not play is one more input waiting in every player's queue for the rest of the
 * match (round 5: before, the owed time was dropped after a gap of about 0.17 s, and the inputs
 * of the third playtest waited longer and longer, up to 1.9 s).
 *
 * It can never spiral. Two things bound the work:
 *   - one call asks for at most `maxSteps` ticks (4: a stall of 0.4 s is caught up in about four
 *     updates, while the world runs up to four times as fast for a moment);
 *   - at most `maxOwedMs` of wall-clock time is owed at once; a longer stall drops the rest (the
 *     match runs slow for a moment instead of catching up forever), and `dropped` counts it.
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
  /**
   * Wall-clock time that was never simulated, milliseconds, in total: whatever was owed beyond
   * `maxOwedMs`. When it grows the match ran slow for a moment (slowLog.ts reports it), and the
   * players' inputs wait longer at the server until the backlog is trimmed (inputQueue.ts).
   */
  dropped: number;
}

export interface FixedStepOptions {
  /** Length of one tick, milliseconds. */
  stepMs: number;
  /** Most ticks one call may return. */
  maxSteps: number;
  /** The most wall-clock time that may be owed and still caught up, milliseconds. */
  maxOwedMs: number;
  /** How early a tick may run, milliseconds. */
  slopMs: number;
  /** Simulation seconds per wall-clock second (1 in real play; more only in headless tests). */
  speed: number;
}

export function createFixedStep(): FixedStep {
  return { last: 0, owed: 0, started: false, dropped: 0 };
}

/** Forgets owed time, so the next call starts a fresh measurement. */
export function resetFixedStep(clock: FixedStep): void {
  clock.started = false;
  clock.owed = 0;
}

/** True while ticks are owed beyond the ones this call returned: the match is catching up. */
export function catchingUp(clock: FixedStep, o: FixedStepOptions): boolean {
  return clock.owed + o.slopMs >= o.stepMs;
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

  const budget = o.maxOwedMs * o.speed;
  clock.owed += dt * o.speed;
  if (clock.owed > budget) {
    // Longer than can be caught up: the rest is dropped.
    clock.dropped += (clock.owed - budget) / o.speed;
    clock.owed = budget;
  }
  let steps = Math.floor((clock.owed + o.slopMs) / o.stepMs);
  if (steps <= 0) return 0;
  if (steps > o.maxSteps) steps = o.maxSteps;
  clock.owed -= steps * o.stepMs;
  return steps;
}
