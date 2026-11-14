/**
 * The short per-player input queue: which input each tick of the match plays, and what the
 * snapshots tell the client about it.
 *
 * Clients send 30 inputs a second and the simulation plays exactly one tick per player per tick
 * (match.ts). The client predicts its own body as "the body in the newest snapshot, plus one tick
 * for every input since". For that to hold, the server keeps every input to one tick and tells the
 * client whenever it cannot:
 *
 *   - The cushion. The first tick after a player's first input is played on a guess while that
 *     input waits (INPUT_CUSHION ticks), so the match plays each input a tick after it was due.
 *     The tick is part of the body for good (the client counts it like any other); it puts the
 *     match's clock just behind the player's, so that an input made a little late on a busy
 *     machine is still in time. Built during the briefing, when nothing moves, it costs nothing.
 *   - A late input. A tick whose input has not arrived is played on a guess (the last input
 *     again) that stands in for it: the server commits to drop the next input that brings nothing
 *     new, and says so (`drops`). The late input is that input when its buttons are the guess's;
 *     a late press or release is played on the next tick instead (so a tap is never lost and a
 *     hold is not cut short) and a later input with nothing new is dropped. The client leaves
 *     that many inputs out of its prediction, so neither side takes an extra step and no delay
 *     builds up.
 *   - Nothing new means: the same buttons as the input before it, and, unless it stands for a
 *     tick that was guessed with those very buttons, none of the HOLD_BUTTONS down (dropping it
 *     would cut a hold short).
 *   - Only guesses that repeat the last input stand in. When a player has been silent so long
 *     that the match loop stops their unit (STARVED_TICKS), the ticks after that are not guesses
 *     at what they did (`dead`): if their inputs do turn up late, in a queue longer than
 *     INPUT_QUEUE_MAX, that many of them with nothing new are skipped to bring the player back to
 *     the present. (The client is not told in advance; after such a stall it is corrected anyway.)
 *   - One-shot fields of a dropped input (a pick: the monster's molt card) are carried over to
 *     the next input that is kept.
 *
 * Inputs that pile up anyway (the cushion was built while the link was slow, or a burst came in
 * on a jittery link) are trimmed one at a time, but only when skipping one cannot be seen: inputs
 * have waited after every tick for a second (INPUT_BACKLOG_*) and the player's body stands still
 * (or cannot move: the briefing). A client that floods the queue is cut back hard
 * (INPUT_QUEUE_HARD_MAX), carrying over presses and picks.
 *
 * The acknowledgement a snapshot carries (`packedAck`): the newest input up to which every input
 * has been played or dropped (what says a press has reached the simulation), and in its top byte
 * how many of the inputs after it the server will drop, or has dropped already from behind inputs
 * still waiting (`drops` and `droppedAhead`).
 */

import { Btn, type PlayerInput } from '@mb/shared';

/** Ticks the match plays each input after it was due (see the header). */
export const INPUT_CUSHION = 1;
/** A queue longer than this after a stall the guesses did not cover is brought back to INPUT_QUEUE_KEEP. */
export const INPUT_QUEUE_MAX = 5;
/** Inputs the queue is brought back to when it skips. */
export const INPUT_QUEUE_KEEP = 2;
/**
 * Inputs a queue may hold at all: over this the oldest are discarded outright. A little over a
 * second of play: more than the longest stall during which the match loop keeps a silent
 * player's buttons held (STARVED_BUTTON_TICKS in match.ts), so a hold that arrives after such a
 * stall still fits in whole.
 */
export const INPUT_QUEUE_HARD_MAX = 32;
/** The most inputs the server may be committed to drop, and the most dead ticks it remembers. */
export const INPUT_DROPS_MAX = 30;
/** A backlog: this many inputs or more still waiting after every tick for INPUT_BACKLOG_TICKS (one second). */
export const INPUT_BACKLOG_MIN = 2;
export const INPUT_BACKLOG_TICKS = 30;
/**
 * Buttons whose holding time means something: the squad's volley (it charges for as long as it
 * is held) and the monster's two move buttons (a brace lasts as long as its button is held).
 * Everything else acts on the press. An input with one of them down is never dropped unless its
 * own tick was guessed with the same buttons.
 */
export const HOLD_BUTTONS = Btn.volley | Btn.move1 | Btn.move2;

/** The fields every input has. Anything else on an input is a one-shot pick. */
const EVERY_TICK: ReadonlySet<string> = new Set(['seq', 'moveX', 'moveZ', 'aimYaw', 'aimPitch', 'buttons']);

export interface InputQueue {
  /** Inputs received and not yet played, oldest first. */
  items: PlayerInput[];
  /** The buttons the simulation has for this player now: the last input played, or the guess after it. */
  lastButtons: number;
  /** Sequence number of the newest input received; anything not newer is a duplicate. */
  lastSeq: number;
  /** False until the first input since the queue was cleared: a guess before it stands for nothing. */
  started: boolean;
  /** Ticks of the cushion built so far (0 until the first input, then INPUT_CUSHION). */
  cushion: number;
  /** Inputs the server has committed to drop when they bring nothing new (see the header). */
  drops: number;
  /** Guessed ticks since the last input played: the next inputs to arrive stand for them in order. */
  guessRun: number;
  /** Ticks played for a silent player that stood for nothing, until the queue is empty again. */
  dead: number;
  /** The fewest inputs left waiting after a tick, over the current backlog window. */
  minWaiting: number;
  /** Ticks into the current backlog window. */
  windowTicks: number;
  /** A backlog was seen: one input is to be skipped the next time that cannot be seen. */
  trim: boolean;
  /** Sequence numbers of inputs dropped while older ones were still waiting, until those are played. */
  droppedAhead: number[];
  /** One-shot fields of dropped inputs, waiting for the next input that is kept. */
  carry: Record<string, unknown> | null;
  /** Ticks played on a guess since the queue was made (diagnostics). */
  guessed: number;
  /** Inputs dropped or discarded since the queue was made (diagnostics). */
  dropped: number;
}

export function createInputQueue(): InputQueue {
  return {
    items: [],
    lastButtons: 0,
    lastSeq: 0,
    started: false,
    cushion: 0,
    drops: 0,
    guessRun: 0,
    dead: 0,
    minWaiting: Number.POSITIVE_INFINITY,
    windowTicks: 0,
    trim: false,
    droppedAhead: [],
    carry: null,
    guessed: 0,
    dropped: 0,
  };
}

/**
 * Forgets the waiting inputs (a slot handed to a person or back to a bot). With `fresh` the
 * client's numbering starts over (a new page); otherwise it carries on (the same page came back).
 */
export function clearInputQueue(q: InputQueue, fresh: boolean): void {
  q.items.length = 0;
  q.lastButtons = 0;
  q.started = false;
  q.cushion = 0;
  q.drops = 0;
  q.guessRun = 0;
  q.dead = 0;
  q.minWaiting = Number.POSITIVE_INFINITY;
  q.windowTicks = 0;
  q.trim = false;
  q.droppedAhead.length = 0;
  q.carry = null;
  if (fresh) q.lastSeq = 0;
}

function view(input: PlayerInput): Record<string, unknown> {
  // An input seen as a bag of fields, so that picks added to or removed from PlayerInput are
  // carried without this file naming them.
  return input as unknown as Record<string, unknown>;
}

/** Copies the picks of `from` onto `to`, except those `to` already carries (an input keeps its own). */
function carryOneShots(from: Record<string, unknown>, to: PlayerInput): void {
  const target = view(to);
  for (const key of Object.keys(from)) {
    if (!EVERY_TICK.has(key) && from[key] !== undefined && target[key] === undefined) target[key] = from[key];
  }
}

/** Keeps the picks of a dropped input for the next input that is kept (the newest pick wins). */
function holdOneShots(q: InputQueue, input: PlayerInput): void {
  const source = view(input);
  for (const key of Object.keys(source)) {
    if (EVERY_TICK.has(key) || source[key] === undefined) continue;
    (q.carry ??= {})[key] = source[key];
  }
}

/**
 * The simulation played a tick for this player without an input from the queue, with these
 * buttons. `repeats`: the guess is the last input again (the player is late, not away).
 */
export function noteGuessedTick(q: InputQueue, buttons: number, repeats: boolean): void {
  q.guessed++;
  q.lastButtons = buttons;
  q.minWaiting = 0;
  if (!q.started) return;
  if (q.cushion < INPUT_CUSHION) {
    q.cushion++;
  } else if (repeats && q.drops < INPUT_DROPS_MAX) {
    q.drops++;
    q.guessRun++;
  } else if (q.dead < INPUT_DROPS_MAX) {
    q.dead++;
  }
}

/**
 * Adds a sanitized input, or drops it at once when the server is committed to drop an input and
 * this one brings nothing new (see the header). An input whose sequence number is not newer than
 * the last one received is ignored (a duplicate or a reordered resend).
 */
export function pushInput(q: InputQueue, input: PlayerInput, max = INPUT_QUEUE_MAX, keep = INPUT_QUEUE_KEEP, hardMax = INPUT_QUEUE_HARD_MAX): void {
  if (input.seq <= q.lastSeq) return;
  q.lastSeq = input.seq;
  q.started = true;
  const items = q.items;

  if (q.drops > 0) {
    const before = items.length > 0 ? items[items.length - 1].buttons : q.lastButtons;
    if (input.buttons === before) {
      // Its own tick was guessed with these very buttons: the guess was this input.
      const guessedFor = items.length === 0 && q.guessRun > 0;
      if (guessedFor || (input.buttons & HOLD_BUTTONS) === 0) {
        if (guessedFor) q.guessRun--;
        q.drops--;
        q.dropped++;
        if (items.length > 0) q.droppedAhead.push(input.seq);
        holdOneShots(q, input);
        return;
      }
    }
    // Something new, played after all: from here the guesses no longer line up with the
    // inputs one by one, and the drop falls to a later input with nothing new in it.
    if (items.length === 0) q.guessRun = 0;
  }

  if (q.carry) {
    carryOneShots(q.carry, input);
    q.carry = null;
  }
  items.push(input);

  if (items.length > max && q.dead > 0) {
    // The late inputs of a stall the guesses did not cover: skip those with no news, oldest
    // first, one for each tick that stood for nothing, until the queue is short again.
    let before = q.lastButtons;
    let i = 0;
    while (q.dead > 0 && items.length > keep && i < items.length - 1) {
      const it = items[i];
      if (it.buttons === before && (it.buttons & HOLD_BUTTONS) === 0) {
        carryOneShots(view(it), items[i + 1]);
        items.splice(i, 1);
        if (i > 0) q.droppedAhead.push(it.seq);
        q.dropped++;
        q.dead--;
      } else {
        before = it.buttons;
        i++;
      }
    }
  }
  if (items.length <= hardMax) return;

  // Far too many: discard the oldest outright. A press among them is not lost.
  const cut = items.length - keep;
  const survivor = items[cut];
  let before = q.lastButtons;
  let pressed = 0;
  for (let k = 0; k < cut; k++) {
    pressed |= items[k].buttons & ~before;
    before = items[k].buttons;
  }
  survivor.buttons |= pressed;
  for (let k = cut - 1; k >= 0; k--) carryOneShots(view(items[k]), survivor);
  items.splice(0, cut);
  q.dropped += cut;
  q.drops = 0;
  q.guessRun = 0;
  q.dead = 0;
  q.droppedAhead.length = 0;
}

/** True when an input would change nothing for a body standing still: no stick, no button change, no hold. */
function idleRepeat(q: InputQueue, input: PlayerInput): boolean {
  return input.moveX === 0 && input.moveZ === 0 && input.buttons === q.lastButtons && (input.buttons & HOLD_BUTTONS) === 0;
}

/**
 * The input for this tick, or undefined when the tick is to be played on a guess: nothing has
 * arrived, or the cushion is being built. `still`: the player's body stands still or cannot move
 * this tick, so an input that changes nothing can be skipped without anyone seeing it.
 */
export function takeInput(q: InputQueue, still = false): PlayerInput | undefined {
  if (q.started && q.cushion < INPUT_CUSHION) return undefined;
  let next = q.items.shift();
  if (!next) return undefined;
  if (q.trim && still && q.items.length > 0 && idleRepeat(q, next)) {
    // The backlog: skip this input and play the one after it in its place.
    carryOneShots(view(next), q.items[0]);
    q.dropped++;
    q.trim = false;
    next = q.items.shift() as PlayerInput;
  }
  q.lastButtons = next.buttons;
  q.guessRun = 0;
  // Caught up with the present: what was left of a stall no longer matters.
  if (q.items.length === 0) q.dead = 0;
  q.minWaiting = Math.min(q.minWaiting, q.items.length);
  if (++q.windowTicks >= INPUT_BACKLOG_TICKS) {
    if (q.minWaiting >= INPUT_BACKLOG_MIN) q.trim = true;
    q.minWaiting = Number.POSITIVE_INFINITY;
    q.windowTicks = 0;
  }
  return next;
}

/** Bits of `packedAck` that hold the sequence number. */
const SEQ_BITS = 0xffffff;
const SEQ_RANGE = 0x1000000;

/**
 * The acknowledgement for this player's snapshots. In the low 24 bits: the newest input sequence
 * number up to which every input has been played or dropped (sequence numbers restart with every
 * match and grow by 30 a second, so 24 bits last 155 hours). In the top 8 bits: how many of the
 * inputs after it the server will drop or has dropped already (`drops`, `droppedAhead`). The
 * client predicts the body in the snapshot plus one tick for each input after the first number,
 * less the second.
 */
export function packedAck(q: InputQueue): number {
  const played = q.items.length > 0 ? q.items[0].seq - 1 : q.lastSeq;
  const ahead = q.droppedAhead;
  while (ahead.length > 0 && ahead[0] <= played) ahead.shift();
  return ((played & SEQ_BITS) + Math.min(255, q.drops + ahead.length) * SEQ_RANGE) >>> 0;
}
