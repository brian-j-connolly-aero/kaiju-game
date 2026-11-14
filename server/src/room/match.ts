/**
 * One running match: a World plus what the server needs around it to run the loop in
 * ARCHITECTURE.md section 4.
 *
 *   - a fixed 30 Hz step driven by the accumulator in fixedStep.ts;
 *   - one input per human-controlled slot per tick, taken from that slot's short queue; a tick
 *     with nothing queued is played on a guess (the previous input again, held buttons
 *     included), and the queue is told, so that it can skip the late inputs the guess already
 *     stood in for (inputQueue.ts). A player who stays silent is brought to a stop rather than
 *     left walking (after 0.5 s), and lets go of held buttons after 1 s;
 *   - the sequence number of the last input applied per slot (the snapshot acknowledgement);
 *   - the events since the last flush, sent together with each snapshot;
 *   - a snapshot every second tick at normal speed, and never more than one per update, so a
 *     catch-up after a hitch does not send a burst of stale snapshots.
 *
 * Nothing here knows about connections: the room decides who receives what.
 */

import {
  createWorld,
  encodeSnapshot,
  neutralInput,
  queueCommand,
  setPlayerBot,
  SNAPSHOT_EVERY_TICKS,
  snapshotOfWorld,
  TICK_RATE,
  type MatchConfig,
  type MatchEndEvent,
  type PlayerId,
  type PlayerInput,
  type SimEvent,
  type SquadCommand,
  type World,
} from '@mb/shared';
import { createFixedStep, dueSteps, type FixedStep, type FixedStepOptions } from './fixedStep';
import { clearInputQueue, createInputQueue, noteGuessedTick, pushInput, takeInput, type InputQueue } from './inputQueue';

export const TICK_MS = 1000 / TICK_RATE;
/** Ticks one update may run to catch up (at speed 1). */
export const MAX_CATCH_UP_STEPS = 4;
/** The longest gap between two updates that is simulated in full, milliseconds. */
export const MAX_FRAME_MS = 250;
/** How early a tick may run, milliseconds (timers are only accurate to about a millisecond). */
export const STEP_SLOP_MS = 2;
/** Ticks without a fresh input after which a connected player's unit stops moving (0.5 s). */
export const STARVED_TICKS = 15;
/**
 * Ticks without a fresh input after which a connected player's held buttons are let go too
 * (1 s, as long as the queue remembers guessed ticks: INPUT_OWED_MAX). Buttons are kept longer
 * than movement so that a hiccup on the line in the middle of a hold (a brace, an eat, a stomp,
 * the molt) does not cut the hold short and then start it again when the late inputs arrive.
 */
export const STARVED_BUTTON_TICKS = 30;

export interface MatchSession {
  world: World;
  clock: FixedStep;
  stepOptions: FixedStepOptions;
  /** Per slot: the queue of inputs waiting to be simulated. */
  queues: InputQueue[];
  /** Per slot: sequence number of the last input the simulation applied for the current connection. */
  acks: number[];
  /** Per slot: ticks in a row with no fresh input. */
  starved: number[];
  /** Per slot: true while a connected person (not a bot) drives it. */
  live: boolean[];
  /** Events since the last flush, in order. */
  events: SimEvent[];
  /** World tick of the last snapshot taken. */
  lastSnapshotTick: number;
  /** The matchEnd event once the match is over (kept for people who join the end screen). */
  ended: MatchEndEvent | null;
  /** Reused every tick. */
  scratch: Array<PlayerInput | undefined>;
}

export interface MatchSessionOptions {
  seed: number;
  config: MatchConfig;
  /** Simulation seconds per wall-clock second; 1 in real play. */
  speed?: number;
  /** The time the match starts at, milliseconds on the clock later passed to advanceMatch. */
  now: number;
}

export function createMatchSession(options: MatchSessionOptions): MatchSession {
  const world = createWorld({ seed: options.seed, config: options.config });
  const n = world.players.length;
  const speed = options.speed && options.speed > 0 ? options.speed : 1;
  const stepOptions: FixedStepOptions = {
    stepMs: TICK_MS,
    maxSteps: Math.ceil(MAX_CATCH_UP_STEPS * speed),
    maxFrameMs: MAX_FRAME_MS,
    slopMs: STEP_SLOP_MS,
    speed,
  };
  // The first tick is due one step after the match starts, not one step after the first update.
  const clock = createFixedStep();
  dueSteps(clock, options.now, stepOptions);
  return {
    world,
    clock,
    stepOptions,
    queues: Array.from({ length: n }, createInputQueue),
    acks: new Array<number>(n).fill(0),
    starved: new Array<number>(n).fill(0),
    live: new Array<boolean>(n).fill(false),
    events: [],
    lastSnapshotTick: 0,
    ended: null,
    scratch: new Array<PlayerInput | undefined>(n),
  };
}

export function matchOver(m: MatchSession): boolean {
  return m.world.match.phase === 'ended';
}

/**
 * Hands a slot to a person (`fresh` says whether their input numbering starts over, as it does
 * after a page reload) or back to a bot.
 */
export function setSlotLive(m: MatchSession, slot: PlayerId, live: boolean, fresh: boolean): void {
  if (slot < 0 || slot >= m.live.length) return;
  m.live[slot] = live;
  m.starved[slot] = 0;
  clearInputQueue(m.queues[slot]);
  if (live && fresh) m.acks[slot] = 0;
  setPlayerBot(m.world, slot, !live);
}

/** Queues a sanitized input for a slot. Inputs for bot slots and stale inputs are ignored. */
export function queueInput(m: MatchSession, slot: PlayerId, input: PlayerInput): void {
  if (slot < 0 || slot >= m.live.length || !m.live[slot]) return;
  if (input.seq <= m.acks[slot]) return;
  pushInput(m.queues[slot], input);
}

/** Queues a sanitized squad command for a slot. */
export function queueSlotCommand(m: MatchSession, slot: PlayerId, command: SquadCommand): void {
  if (slot < 0 || slot >= m.live.length || !m.live[slot]) return;
  queueCommand(m.world, slot, command);
}

/** Runs exactly one simulation tick. */
export function stepMatch(m: MatchSession): void {
  const world = m.world;
  if (world.match.phase === 'ended') return;
  const inputs = m.scratch;
  for (let slot = 0; slot < inputs.length; slot++) {
    inputs[slot] = undefined;
    if (!m.live[slot]) continue;
    const next = takeInput(m.queues[slot]);
    if (next) {
      inputs[slot] = next;
      m.acks[slot] = next.seq;
      m.starved[slot] = 0;
      continue;
    }
    // Nothing arrived for this tick: it is played on a guess, the last input again.
    const last = world.players[slot].input;
    let buttons = last.buttons;
    const starved = ++m.starved[slot];
    if (starved === STARVED_TICKS || starved === STARVED_BUTTON_TICKS) {
      // Still connected but silent: stop walking, keep looking the same way; a little later let
      // go of the buttons as well.
      const stop = neutralInput(last.seq);
      stop.aimYaw = last.aimYaw;
      stop.aimPitch = last.aimPitch;
      if (starved < STARVED_BUTTON_TICKS) stop.buttons = last.buttons;
      inputs[slot] = stop;
      buttons = stop.buttons;
    }
    noteGuessedTick(m.queues[slot], buttons);
  }
  const events = world.step(inputs);
  for (const e of events) {
    m.events.push(e);
    if (e.type === 'matchEnd') m.ended = e;
  }
}

/** Runs the ticks that are due at `nowMs`. Returns how many ran. */
export function advanceMatch(m: MatchSession, nowMs: number): number {
  if (matchOver(m)) return 0;
  const steps = dueSteps(m.clock, nowMs, m.stepOptions);
  let ran = 0;
  for (let i = 0; i < steps && !matchOver(m); i++) {
    stepMatch(m);
    ran++;
  }
  return ran;
}

/** True when enough ticks have passed since the last snapshot (or the match just ended). */
export function snapshotDue(m: MatchSession): boolean {
  const tick = m.world.tick;
  if (tick === m.lastSnapshotTick) return false;
  return tick - m.lastSnapshotTick >= SNAPSHOT_EVERY_TICKS || matchOver(m);
}

/** Encodes the world as it is now. The acknowledgement field is left 0 for the caller to patch. */
export function takeSnapshot(m: MatchSession): Uint8Array {
  m.lastSnapshotTick = m.world.tick;
  return encodeSnapshot(snapshotOfWorld(m.world));
}

/** Hands over the events gathered since the last call. */
export function takeEvents(m: MatchSession): SimEvent[] {
  const out = m.events;
  m.events = [];
  return out;
}
