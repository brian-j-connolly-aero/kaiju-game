/**
 * Slow moments of a room's loop, written to the server's log (what `host/logs.cmd` shows and
 * `host/savelog.cmd` saves), so that lag at a playtest can be matched with what the server was
 * doing at the time (docs/HOSTING.md, "If the game feels laggy"). Three kinds:
 *
 *   - a slow update: one update of the match took longer than SLOW_WORK_MS, with the simulation
 *     systems that took the most of it (timed through the pipeline's `mark`), the snapshot and
 *     sending, and any garbage collection pause inside it;
 *   - the server falling behind: the timer came more than SLOW_GAP_MS after the previous update
 *     (the process stood still: a garbage collection pause, the operating system, the container).
 *     Since round 5 the match catches that time up (fixedStep.ts); only a stall over a second
 *     still skips some of the match, and the line says how much;
 *   - a player's inputs not reaching their ticks for STALL_REPORT_TICKS ticks or more (match.ts;
 *     written when their inputs come again, with how long it lasted): either nothing arrived (a
 *     stall on their connection, or their page froze: the server cannot tell those apart, their
 *     line a minute can) or their inputs kept arriving, each too late for its tick (their page or
 *     computer fell behind; round 5: this used to read like a stall on the connection).
 *
 * Lines are rationed: at most one per LOG_EVERY_MS per room, the next one saying how many were
 * left out meanwhile. Timing costs a dozen clock reads per tick.
 *
 * And, unrationed, a few lines a minute while a match runs (`minute`, round 5): one for the server
 * (ticks run, how long its updates took, how long it stood still, time skipped) and one per player
 * (input delay, inputs waiting, ticks guessed, inputs dropped, and what their own page reported:
 * round trip, snapping back, frames that froze), so that a saved log shows how every player's
 * game went even when nobody took a screenshot.
 */

import { SYSTEM_ORDER } from '@mb/shared';
import { PerformanceObserver } from 'node:perf_hooks';

/** An update that takes longer than this is slow (a tick is 33 ms). */
export const SLOW_WORK_MS = 30;
/** Updates further apart than this mean the server stood still (they are 33 ms apart). */
export const SLOW_GAP_MS = 100;
/** At most one line per room this often, milliseconds. */
export const LOG_EVERY_MS = 5000;
/** The lines a minute come this often, milliseconds of the room's clock. */
export const MINUTE_MS = 60_000;
/** Length of one simulation tick, milliseconds (the queue lengths in the lines a minute are turned into time with it). */
const TICK_MS = 1000 / 30;

/** Plain names of the simulation systems, by SYSTEM_ORDER index, for the log. */
const SYSTEM_NAMES: Record<(typeof SYSTEM_ORDER)[number], string> = {
  inputs: 'inputs',
  kaijuActions: 'monster moves',
  unitOrders: 'squad orders',
  bots: 'bots',
  movement: 'movement',
  pickups: 'crates',
  weapons: 'weapons',
  projectiles: 'projectiles',
  damage: 'damage',
  cityDamage: 'city damage',
  matchFlow: 'match flow',
  voice: 'voice cues',
};

// --- Garbage collection pauses (one observer for the whole process) ----------------------------

const GC_KEEP = 64;
const gcStarts = new Float64Array(GC_KEEP);
const gcLengths = new Float64Array(GC_KEEP);
let gcCount = 0;
let gcObserver: PerformanceObserver | null = null;

function watchGarbageCollection(): void {
  if (gcObserver) return;
  try {
    gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const i = gcCount % GC_KEEP;
        gcStarts[i] = entry.startTime;
        gcLengths[i] = entry.duration;
        gcCount++;
      }
    });
    gcObserver.observe({ entryTypes: ['gc'] });
  } catch {
    // No garbage collection entries on this runtime: the lines simply leave them out.
    gcObserver = null;
  }
}

/** Milliseconds of garbage collection pauses that ended between `from` and `to` (performance.now() time). */
export function gcPausesBetween(from: number, to: number): number {
  let total = 0;
  for (let k = Math.max(0, gcCount - GC_KEEP); k < gcCount; k++) {
    const i = k % GC_KEEP;
    const end = gcStarts[i] + gcLengths[i];
    if (end >= from && gcStarts[i] <= to) total += gcLengths[i];
  }
  return total;
}

// --- Per room ----------------------------------------------------------------------------------

/** What `SlowWatch.update` needs to know about one update of the room. */
export interface UpdateSample {
  /** When the update began and ended, milliseconds (the room's clock). */
  began: number;
  ended: number;
  /** When the simulation part ended (the rest is the snapshot and sending). */
  simulated: number;
  /** Ticks the update ran. */
  ticks: number;
  /** The match's total of simulation time dropped so far (FixedStep.dropped), milliseconds. */
  dropped: number;
  /** Seconds into the match (for the line). */
  elapsed: number;
}

/** What one player's page reported in its pings over the minute (`ClientMessages.ping`), or nothing. */
export interface PageMinute {
  /** Pings that carried a report. */
  reports: number;
  /** Round trips the page measured, milliseconds: the mean and the worst. */
  rttMean: number;
  rttWorst: number;
  /** Corrections of the player's own body of 15 cm or more, and the largest, meters. */
  snaps: number;
  snapWorst: number;
  /** Frames of 100 ms or more (the page froze), and the longest frame, milliseconds. */
  freezes: number;
  frameWorst: number;
}

/** How one player's inputs fared over the minute, for its line (`SlowWatch.minute`). */
export interface SeatMinute {
  seat: number;
  /** What they play. */
  role: string;
  /** Ticks played for them; of those, ticks played from their queue. */
  ticks: number;
  fed: number;
  /** Inputs left waiting after a tick played from their queue: the mean and the most. */
  waitingMean: number;
  waitingMax: number;
  /** Ticks played on a guess; of those, ticks at which their inputs had kept arriving (late); the longest run in a row. */
  guessed: number;
  late: number;
  longestRun: number;
  /** Inputs that arrived; inputs dropped (late ones a guess stood for, skipped, discarded); of those, skipped from a backlog. */
  arrived: number;
  dropped: number;
  trimmed: number;
  /** What their page said, or null when it sent nothing. */
  page: PageMinute | null;
}

export interface SlowWatchOptions {
  /** The clock the systems are timed with, milliseconds; the same as the room's. */
  now: () => number;
  /** Whether to ask the process for its garbage collection pauses (real servers only). */
  gc: boolean;
  log: (line: string) => void;
}

export class SlowWatch {
  /** Milliseconds per simulation system over the current update (SYSTEM_ORDER order). */
  readonly systems = new Float64Array(SYSTEM_ORDER.length);
  private markAt = 0;
  private lastBegan = Number.NaN;
  private lastDropped = 0;
  private loggedAt = Number.NEGATIVE_INFINITY;
  private skipped = 0;
  private readonly options: SlowWatchOptions;
  /** The server's own numbers since the last lines a minute. */
  private minuteUpdates = 0;
  private minuteTicks = 0;
  private minuteWork = 0;
  private minuteWorkMax = 0;
  private minuteGapMax = 0;
  private minuteStood = 0;
  private minuteDropped = 0;

  constructor(options: SlowWatchOptions) {
    this.options = options;
    if (options.gc) watchGarbageCollection();
  }

  /** Call right before each tick is simulated. */
  beginTick(): void {
    this.markAt = this.options.now();
  }

  /** The pipeline's mark (SystemMark): charges the time since the last mark to `system`. */
  readonly mark = (system: number): void => {
    const t = this.options.now();
    this.systems[system] += t - this.markAt;
    this.markAt = t;
  };

  /** A new match: the gap, the dropped time and the minute start over. */
  reset(): void {
    this.lastBegan = Number.NaN;
    this.lastDropped = 0;
    this.systems.fill(0);
    this.clearMinute();
  }

  private clearMinute(): void {
    this.minuteUpdates = 0;
    this.minuteTicks = 0;
    this.minuteWork = 0;
    this.minuteWorkMax = 0;
    this.minuteGapMax = 0;
    this.minuteStood = 0;
    this.minuteDropped = 0;
  }

  /** One update of a running match is over: writes a line if it was a slow moment. */
  update(s: UpdateSample): void {
    const gap = Number.isNaN(this.lastBegan) ? 0 : s.began - this.lastBegan;
    const dropped = Math.max(0, s.dropped - this.lastDropped);
    this.lastBegan = s.began;
    this.lastDropped = s.dropped;
    const work = s.ended - s.began;
    const slowWork = work > SLOW_WORK_MS;
    const stood = gap > SLOW_GAP_MS || dropped > 1;
    this.minuteUpdates++;
    this.minuteTicks += s.ticks;
    this.minuteWork += work;
    this.minuteWorkMax = Math.max(this.minuteWorkMax, work);
    this.minuteGapMax = Math.max(this.minuteGapMax, gap);
    if (gap > SLOW_GAP_MS) this.minuteStood++;
    this.minuteDropped += dropped;
    if (slowWork || stood) {
      const parts: string[] = [];
      if (stood) {
        const gc = this.options.gc ? gcPausesBetween(s.began - gap, s.began) : 0;
        parts.push(
          `the server stood still for ${Math.round(gap)} ms${gc >= 1 ? ` (garbage collection ${Math.round(gc)} ms of it)` : ''}` +
            (dropped > 1 ? `, ${Math.round(dropped)} ms of the match skipped (inputs wait longer for a while)` : ', and caught up'),
        );
      }
      if (slowWork) {
        const gc = this.options.gc ? gcPausesBetween(s.began, s.ended) : 0;
        parts.push(`one update took ${Math.round(work)} ms for ${s.ticks} step${s.ticks === 1 ? '' : 's'} (${this.breakdown(s, gc)})`);
      }
      this.write(`slow moment ${clockText(s.elapsed)} into the match: ${parts.join('; ')}`, s.ended);
    }
    this.systems.fill(0);
  }

  /**
   * A player's inputs came again after `ticks` ticks without any in time (`seat` is their lobby
   * seat). `late`: at how many of those ticks inputs of theirs had arrived since the tick before,
   * each too late: when that is most of them, their page or computer fell behind; otherwise
   * nothing came through (their connection stalled).
   */
  stall(seat: number, ticks: number, stopped: boolean, elapsed: number, now: number, late = 0): void {
    const seconds = (ticks / 30).toFixed(2);
    const what =
      late * 2 >= ticks
        ? `seat ${seat}'s inputs kept arriving but too late for their ticks for ${seconds} s ${clockText(elapsed)} into the match (their page or computer fell behind, not the connection)`
        : `seat ${seat}'s inputs stopped arriving for ${seconds} s ${clockText(elapsed)} into the match (their connection stalled, or their page froze)`;
    this.write(what + (stopped ? '; their body was stopped after 1 s and snaps back on their screen' : '; the server repeated their last input meanwhile'), now);
  }

  /**
   * The lines a minute: one for the server since the last ones, one per player in `seats`.
   * Never rationed. `elapsed`: seconds into the match.
   */
  minute(seats: readonly SeatMinute[], elapsed: number): void {
    const n = Math.max(1, this.minuteUpdates);
    const at = `${clockText(elapsed)} into the match, the last minute:`;
    this.options.log(
      `${at} the server ran ${this.minuteTicks} steps in ${this.minuteUpdates} updates, ` +
        `${(this.minuteWork / n).toFixed(1)} ms each on average (longest ${Math.round(this.minuteWorkMax)} ms), ` +
        `longest wait between updates ${Math.round(this.minuteGapMax)} ms, stood still ${this.minuteStood} time${this.minuteStood === 1 ? '' : 's'}, ` +
        `${Math.round(this.minuteDropped)} ms of the match skipped`,
    );
    for (const p of seats) {
      // An input waits at the server for the ticks before its own, plus half a tick on average.
      const wait = Math.round((p.waitingMean + 0.5) * TICK_MS);
      const parts: string[] = [];
      if (p.page && p.page.reports > 0) {
        const page = p.page;
        parts.push(`input delay about ${Math.round(page.rttMean / 2) + wait} ms (${Math.round(page.rttMean / 2)} on the line, ${wait} waiting at the server)`);
        parts.push(`round trip ${Math.round(page.rttMean)} ms (worst ${Math.round(page.rttWorst)})`);
      } else {
        parts.push(`inputs waiting at the server about ${wait} ms`);
      }
      parts.push(`queue ${p.waitingMean.toFixed(1)} on average, at most ${p.waitingMax}`);
      parts.push(
        `${p.arrived} inputs arrived for ${p.ticks} steps, ${p.guessed} steps played on a guess` +
          (p.guessed > 0 ? ` (${p.late} with their input late, longest run ${p.longestRun})` : '') +
          `, ${p.dropped} inputs dropped` +
          (p.trimmed > 0 ? ` (${p.trimmed} skipped to cut the delay)` : ''),
      );
      if (p.page && p.page.reports > 0) {
        const page = p.page;
        parts.push(`snapped back ${page.snaps} time${page.snaps === 1 ? '' : 's'} over 15 cm` + (page.snaps > 0 ? ` (largest ${page.snapWorst.toFixed(2)} m)` : ''));
        parts.push(`page froze ${page.freezes} time${page.freezes === 1 ? '' : 's'} over 0.1 s` + (page.freezes > 0 ? ` (longest ${Math.round(page.frameWorst)} ms)` : ''));
      } else {
        parts.push('no report from their page');
      }
      this.options.log(`${at} seat ${p.seat} (${p.role}): ${parts.join('; ')}`);
    }
    this.clearMinute();
  }

  private breakdown(s: UpdateSample, gc: number): string {
    const order = Array.from(this.systems.keys()).sort((a, b) => this.systems[b] - this.systems[a]);
    const parts: string[] = [];
    for (const i of order.slice(0, 3)) {
      if (this.systems[i] < 1) break;
      parts.push(`${SYSTEM_NAMES[SYSTEM_ORDER[i]]} ${Math.round(this.systems[i])} ms`);
    }
    const sending = s.ended - s.simulated;
    if (sending >= 1) parts.push(`snapshots and sending ${Math.round(sending)} ms`);
    if (gc >= 1) parts.push(`garbage collection ${Math.round(gc)} ms`);
    return parts.length > 0 ? parts.join(', ') : 'nothing in particular';
  }

  private write(line: string, now: number): void {
    if (now - this.loggedAt < LOG_EVERY_MS) {
      this.skipped++;
      return;
    }
    const more = this.skipped > 0 ? ` (and ${this.skipped} more since the last line)` : '';
    this.loggedAt = now;
    this.skipped = 0;
    this.options.log(line + more);
  }
}

function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
