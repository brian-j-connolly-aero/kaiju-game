/**
 * One running match: a World plus what the server needs around it to run the loop in
 * ARCHITECTURE.md section 4.
 *
 *   - a fixed 30 Hz step driven by the accumulator in fixedStep.ts, which catches up after the
 *     server stood still (up to MAX_OWED_MS) instead of dropping the time;
 *   - one input per human-controlled slot per tick, taken from that slot's short queue, a tick
 *     after it was due; a tick with nothing queued is played on a guess (the previous input
 *     again, held buttons included), and the queue is told: the guess stands in for the input
 *     that is late, and an input with nothing new in it is dropped in its place (inputQueue.ts).
 *     A player who stays silent is brought to a stop rather than left walking (after 1 s), and
 *     lets go of held buttons after 1.5 s;
 *   - per slot, the acknowledgement for the snapshots (`ackFor`): the inputs played or dropped,
 *     and how many more the server will drop (`packedAck` in inputQueue.ts);
 *   - the events since the last flush, sent together with each snapshot;
 *   - a snapshot every second tick at normal speed, and never more than one per update, so a
 *     catch-up after a hitch does not send a burst of stale snapshots.
 *
 * Nothing here knows about connections: the room decides who receives what.
 */

import {
  Btn,
  createWorld,
  drivenUnit,
  encodeSnapshot,
  neutralInput,
  playerKaiju,
  playerSquad,
  setPlayerBot,
  SNAPSHOT_EVERY_TICKS,
  snapshotOfWorld,
  TICK_RATE,
  type MatchConfig,
  type MatchEndEvent,
  type PlayerId,
  type PlayerInput,
  type SimEvent,
  type SystemMark,
  type World,
} from '@mb/shared';
import { catchingUp, createFixedStep, dueSteps, type FixedStep, type FixedStepOptions } from './fixedStep';
import { clearInputQueue, createInputQueue, noteGuessedTick, packedAck, pushInput, takeInput, type InputQueue } from './inputQueue';

export const TICK_MS = 1000 / TICK_RATE;
/** Ticks one update may run to catch up (at speed 1). */
export const MAX_CATCH_UP_STEPS = 4;
/**
 * The most time the match may owe and still catch up after the server stood still, milliseconds
 * (fixedStep.ts). Until round 5 a gap counted for at most 250 ms and anything over 4 ticks owed
 * was dropped, so every stall of about 0.17 s or more left every player's inputs waiting longer
 * for the rest of the match.
 */
export const MAX_OWED_MS = 1000;
/** How early a tick may run, milliseconds (timers are only accurate to about a millisecond). */
export const STEP_SLOP_MS = 2;
/**
 * Ticks without a fresh input after which a connected player's unit stops moving (1 s). Up to
 * then a guessed tick repeats the last input and stands in for the late one (inputQueue.ts).
 * It was 0.5 s until round 4: a tunnel that stalls for 0.6 to 1 s now and then (the second
 * playtest) then stopped the body on the server while the player's screen walked on, and when
 * the inputs came again the body snapped back by up to 3.5 m (docs/STATUS.md, round 4, the
 * stutter through the tunnel). A stall up to 1 s is now played on as guesses, which the late
 * inputs stand for when they come: nothing to correct unless the player turned meanwhile.
 */
export const STARVED_TICKS = 30;
/**
 * Ticks without a fresh input after which a connected player's held buttons are let go too
 * (1.5 s), all but Volley, which stays held until inputs come again (its release fires the
 * squad: round 5). Buttons are kept longer than movement so that a hiccup on the line in the
 * middle of a hold (a brace, a volley's charge) does not cut the hold short and then start it
 * again when the late inputs arrive.
 */
export const STARVED_BUTTON_TICKS = 45;
/** Slower than this a body counts as standing still (meters per second). */
const STILL_SPEED = 0.05;
/** Inputs that stop for this many ticks or more are reported as a stall (`MatchSession.stalls`). */
export const STALL_REPORT_TICKS = 9;

/** Times the simulation systems of each tick (slowLog.ts). */
export interface TickTimer {
  beginTick(): void;
  mark: SystemMark;
}

/** A player's inputs stopped for a while and have come again (for the server's log). */
export interface InputStall {
  slot: PlayerId;
  /** Ticks played without an input from them. */
  ticks: number;
  /** Their body was brought to a stop meanwhile (STARVED_TICKS). */
  stopped: boolean;
  /**
   * Of those ticks, the ones at which inputs from them had arrived since the tick before: their
   * inputs kept coming, but each too late for its tick (a page or computer that fell behind, not
   * a stall on the line, where nothing arrives).
   */
  late: number;
}

/**
 * How one player's inputs fared over a stretch of the match, for the server's log (a line a
 * minute per player: gameRoom.ts, slowLog.ts). The room takes it and starts it over.
 */
export interface SlotTally {
  /** Ticks played for them while a person drove the slot. */
  ticks: number;
  /** Inputs left waiting after each tick played from the queue, summed (divide by `fed`). */
  waitingSum: number;
  /** The most inputs left waiting after a tick. */
  waitingMax: number;
  /** Ticks played from their queue (the rest were guesses). */
  fed: number;
  /** Ticks played on a guess after their first input. */
  guessed: number;
  /** Guessed ticks at which an input of theirs had arrived since the tick before (too late). */
  late: number;
  /** The longest run of guessed ticks in a row. */
  longestRun: number;
}

export function createSlotTally(): SlotTally {
  return { ticks: 0, waitingSum: 0, waitingMax: 0, fed: 0, guessed: 0, late: 0, longestRun: 0 };
}

export interface MatchSession {
  world: World;
  clock: FixedStep;
  stepOptions: FixedStepOptions;
  /** Per slot: the queue of inputs waiting to be simulated, and the acknowledgement (inputQueue.ts). */
  queues: InputQueue[];
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
  /** Times each tick's systems, or null (tests, tools). */
  timer: TickTimer | null;
  /** Stalls of players' inputs since the room last took them (STALL_REPORT_TICKS). */
  stalls: InputStall[];
  /** Per slot: guessed ticks of the current run at which an input had arrived since the tick before. */
  runLate: number[];
  /** Per slot: the queue's count of inputs received, as of the tick before. */
  seenArrived: number[];
  /** Per slot: how their inputs fared since the room last took the tallies (`SlotTally`). */
  tally: SlotTally[];
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
    maxOwedMs: MAX_OWED_MS,
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
    starved: new Array<number>(n).fill(0),
    live: new Array<boolean>(n).fill(false),
    events: [],
    lastSnapshotTick: 0,
    ended: null,
    scratch: new Array<PlayerInput | undefined>(n),
    timer: null,
    stalls: [],
    runLate: new Array<number>(n).fill(0),
    seenArrived: new Array<number>(n).fill(0),
    tally: Array.from({ length: n }, createSlotTally),
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
  m.runLate[slot] = 0;
  // The acknowledgement starts over for a new page and carries on for the same page come back.
  clearInputQueue(m.queues[slot], live && fresh);
  setPlayerBot(m.world, slot, !live);
}

/** Queues a sanitized input for a slot. Inputs for bot slots and stale inputs are ignored. */
export function queueInput(m: MatchSession, slot: PlayerId, input: PlayerInput): void {
  if (slot < 0 || slot >= m.live.length || !m.live[slot]) return;
  pushInput(m.queues[slot], input);
}

/** The acknowledgement to put in this slot's snapshots (inputQueue.ts, `packedAck`). */
export function ackFor(m: MatchSession, slot: PlayerId): number {
  return slot >= 0 && slot < m.queues.length ? packedAck(m.queues[slot]) : 0;
}

/** The body this slot drives stands still, or nothing moves this tick (the briefing, an intermission). */
function standsStill(world: World, slot: PlayerId): boolean {
  if (world.match.phase !== 'playing') return true;
  const squad = playerSquad(world, slot);
  const body = squad ? drivenUnit(world, squad) : playerKaiju(world, slot);
  return !body || !body.alive || body.vx * body.vx + body.vz * body.vz < STILL_SPEED * STILL_SPEED;
}

/**
 * Runs exactly one simulation tick. `catchingUp`: it is one of the extra ticks run after the
 * server stood still, so the input queues neither trim nor count a backlog (inputQueue.ts).
 */
export function stepMatch(m: MatchSession, catchingUp = false): void {
  const world = m.world;
  if (world.match.phase === 'ended') return;
  const inputs = m.scratch;
  for (let slot = 0; slot < inputs.length; slot++) {
    inputs[slot] = undefined;
    if (!m.live[slot]) continue;
    const queue = m.queues[slot];
    const tally = m.tally[slot];
    // Whether an input of theirs came in since the tick before (for the log: late, or missing).
    const arrived = queue.arrived !== m.seenArrived[slot];
    m.seenArrived[slot] = queue.arrived;
    tally.ticks++;
    const next = takeInput(queue, standsStill(world, slot), catchingUp);
    if (next) {
      inputs[slot] = next;
      const gap = m.starved[slot];
      if (gap >= STALL_REPORT_TICKS && m.stalls.length < 16) m.stalls.push({ slot, ticks: gap, stopped: gap >= STARVED_TICKS, late: m.runLate[slot] });
      m.starved[slot] = 0;
      m.runLate[slot] = 0;
      tally.fed++;
      tally.waitingSum += queue.items.length;
      if (queue.items.length > tally.waitingMax) tally.waitingMax = queue.items.length;
      continue;
    }
    // Nothing arrived for this tick: it is played on a guess, the last input again.
    const last = world.players[slot].input;
    let buttons = last.buttons;
    const starved = ++m.starved[slot];
    if (queue.started) {
      tally.guessed++;
      if (arrived) {
        tally.late++;
        m.runLate[slot]++;
      }
      if (starved > tally.longestRun) tally.longestRun = starved;
    }
    if (starved === STARVED_TICKS || starved === STARVED_BUTTON_TICKS) {
      // Still connected but silent: stop walking, keep looking the same way; a little later let
      // go of the buttons as well.
      const stop = neutralInput(last.seq);
      stop.aimYaw = last.aimYaw;
      stop.aimPitch = last.aimPitch;
      // A held Volley stays held (round 5): letting go fires the squad's volley, so a stall in
      // the middle of a charge used to fire it early and start the charge again from nothing
      // when the late inputs came. A planted squad is harmless; the player's own release, or a
      // bot taking the seat, ends it.
      stop.buttons = starved < STARVED_BUTTON_TICKS ? last.buttons : last.buttons & Btn.volley;
      inputs[slot] = stop;
      buttons = stop.buttons;
    }
    // Only a guess that repeats the last input stands in for the one that is late; from the stop
    // on the player is away, not late.
    noteGuessedTick(m.queues[slot], buttons, starved < STARVED_TICKS);
  }
  const timer = m.timer;
  timer?.beginTick();
  const events = world.step(inputs, timer?.mark);
  for (const e of events) {
    m.events.push(e);
    if (e.type === 'matchEnd') m.ended = e;
  }
}

/** Runs the ticks that are due at `nowMs`. Returns how many ran. */
export function advanceMatch(m: MatchSession, nowMs: number): number {
  if (matchOver(m)) return 0;
  const steps = dueSteps(m.clock, nowMs, m.stepOptions);
  // More ticks now than one update's worth, or more still owed: the server stood still and is
  // catching up.
  const catching = steps > Math.ceil(m.stepOptions.speed) || catchingUp(m.clock, m.stepOptions);
  let ran = 0;
  for (let i = 0; i < steps && !matchOver(m); i++) {
    stepMatch(m, catching);
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
