/**
 * Slow moments of a room's loop, written to the server's log (what `host/logs.cmd` shows), so
 * that a stutter at a playtest can be matched with what the server was doing at the time
 * (docs/HOSTING.md, "If players' bodies snap back"). Three kinds:
 *
 *   - a slow update: one update of the match took longer than SLOW_WORK_MS, with the simulation
 *     systems that took the most of it (timed through the pipeline's `mark`), the snapshot and
 *     sending, and any garbage collection pause inside it;
 *   - the server falling behind: the timer came more than SLOW_GAP_MS after the previous update
 *     (the process stood still: a garbage collection pause, the operating system, the container)
 *     or simulation time was dropped (the match ran slow and the players' inputs wait longer);
 *   - a stall on a player's connection: no input arrived from them for STALL_REPORT_TICKS ticks
 *     or more (match.ts; written when their inputs come again, with how long it lasted).
 *
 * Lines are rationed: at most one per LOG_EVERY_MS per room, the next one saying how many were
 * left out meanwhile. Timing costs a dozen clock reads per tick.
 */

import { SYSTEM_ORDER } from '@mb/shared';
import { PerformanceObserver } from 'node:perf_hooks';

/** An update that takes longer than this is slow (a tick is 33 ms). */
export const SLOW_WORK_MS = 30;
/** Updates further apart than this mean the server stood still (they are 33 ms apart). */
export const SLOW_GAP_MS = 100;
/** At most one line per room this often, milliseconds. */
export const LOG_EVERY_MS = 5000;

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

  /** A new match: the gap and the dropped time start over. */
  reset(): void {
    this.lastBegan = Number.NaN;
    this.lastDropped = 0;
    this.systems.fill(0);
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
    if (slowWork || stood) {
      const parts: string[] = [];
      if (stood) {
        const gc = this.options.gc ? gcPausesBetween(s.began - gap, s.began) : 0;
        parts.push(
          `the server stood still for ${Math.round(gap)} ms${gc >= 1 ? ` (garbage collection ${Math.round(gc)} ms of it)` : ''}` +
            (dropped > 1 ? `, ${Math.round(dropped)} ms of the match skipped (inputs now wait longer)` : ''),
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

  /** A player's inputs came again after `ticks` ticks without any (`seat` is their lobby seat). */
  stall(seat: number, ticks: number, stopped: boolean, elapsed: number, now: number): void {
    const seconds = (ticks / 30).toFixed(2);
    this.write(
      `seat ${seat}'s inputs stopped arriving for ${seconds} s ${clockText(elapsed)} into the match (their connection stalled)` +
        (stopped ? '; their body was stopped after 1 s and snaps back on their screen' : '; the server repeated their last input meanwhile'),
      now,
    );
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
