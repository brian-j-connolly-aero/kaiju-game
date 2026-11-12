/**
 * The short per-player input queue. Clients send 30 inputs a second and the simulation takes
 * exactly one per player per tick, so in steady state the queue holds zero or one input and
 * only absorbs network jitter.
 *
 * On a link that stalls (a lost packet holds everything behind it back) inputs arrive late and
 * all at once, after the simulation has already played their ticks on a guess (match.ts). The
 * queue then has to skip some of them to bring the player back to real time, and it must do
 * that without changing what the player did. So it only skips inputs that carry no news:
 *
 *   - an input may go when its buttons are the same as in the input before it, and either it
 *     stands for a tick that was guessed (the guess said "same buttons" too), or none of the
 *     buttons whose holding time matters is down in it (HOLD_BUTTONS);
 *   - an input in which a button goes down or comes up always stays, and so does every input
 *     of a hold in progress. A tap that fell entirely inside a stall still happens, and a hold
 *     is as long in the simulation as it was on the player's machine. The price is a little
 *     extra delay until the buttons are at rest again;
 *   - a command wheel pick in a skipped input is carried over to the next one.
 *
 * A client that floods the queue anyway is cut back hard (HARD_MAX): then the oldest inputs
 * are discarded whatever they say, and only a press and a wheel pick are carried over.
 */

import { Btn, type PlayerInput } from '@mb/shared';

/** Inputs a queue may hold before it looks for inputs to skip (about 170 ms of play). */
export const INPUT_QUEUE_MAX = 5;
/** Inputs the queue is brought back to when it skips. */
export const INPUT_QUEUE_KEEP = 2;
/**
 * Inputs a queue may hold at all: over this the oldest are discarded outright. Two thirds of a
 * second of play: more than the longest stall the match loop sits through before it stops a
 * silent player, so a hold that arrives after such a stall still fits in whole.
 */
export const INPUT_QUEUE_HARD_MAX = 20;
/** The most guessed ticks that are remembered as owed. */
export const INPUT_OWED_MAX = 30;
/**
 * Buttons that mean something different, or only anything at all, once held for a time: Strike
 * (Swipe or Stomp), Grab (Grab or Eat), Molt (hold to cocoon). An input with one of them down
 * is never skipped unless its tick was guessed with the same buttons.
 */
export const HOLD_BUTTONS = Btn.strike | Btn.grab | Btn.molt;

export interface InputQueue {
  items: PlayerInput[];
  /** Inputs skipped or discarded since the queue was made (diagnostics). */
  dropped: number;
  /** The buttons the simulation has for this player now: the last input handed out, or the guess after it. */
  lastButtons: number;
  /**
   * Ticks the simulation played on a guess since it last had an input for this player. That
   * many of the inputs that arrive next are for ticks already played.
   */
  owed: number;
}

export function createInputQueue(): InputQueue {
  return { items: [], dropped: 0, lastButtons: 0, owed: 0 };
}

export function clearInputQueue(q: InputQueue): void {
  q.items.length = 0;
  q.lastButtons = 0;
  q.owed = 0;
}

/** The simulation played a tick for this player with nothing in the queue, with these buttons. */
export function noteGuessedTick(q: InputQueue, buttons: number): void {
  if (q.owed < INPUT_OWED_MAX) q.owed++;
  q.lastButtons = buttons;
}

function carryWheel(from: PlayerInput, to: PlayerInput): void {
  // The newest skipped pick wins; an input that already carries a pick keeps its own.
  if (!from.wheel || to.wheel) return;
  to.wheel = from.wheel;
  if (from.marker) to.marker = from.marker;
}

/**
 * Adds a sanitized input. An input whose sequence number is not newer than the last one queued
 * is ignored (a duplicate or a reordered resend).
 */
export function pushInput(
  q: InputQueue,
  input: PlayerInput,
  max = INPUT_QUEUE_MAX,
  keep = INPUT_QUEUE_KEEP,
  hardMax = INPUT_QUEUE_HARD_MAX,
): void {
  const items = q.items;
  if (items.length > 0 && input.seq <= items[items.length - 1].seq) return;
  items.push(input);
  if (items.length <= max) return;

  // Skip inputs that carry no news, oldest first, until the queue is short again.
  let before = q.lastButtons;
  let guessed = q.owed;
  let i = 0;
  while (items.length > keep && i < items.length - 1) {
    const it = items[i];
    const sameButtons = it.buttons === before;
    // Only the inputs at the very front stand for guessed ticks.
    const wasGuessed = guessed > 0 && i === 0 && sameButtons;
    if (sameButtons && (wasGuessed || (it.buttons & HOLD_BUTTONS) === 0)) {
      carryWheel(it, items[i + 1]);
      items.splice(i, 1);
      q.dropped++;
      if (wasGuessed) guessed--;
    } else {
      // From the first input that says something new, none of them stands for a guessed tick.
      guessed = 0;
      before = it.buttons;
      i++;
    }
  }
  q.owed = guessed;
  if (items.length <= hardMax) return;

  // Still far too many: discard the oldest outright. A press among them is not lost.
  const cut = items.length - keep;
  const survivor = items[cut];
  before = q.lastButtons;
  let pressed = 0;
  for (let k = 0; k < cut; k++) {
    pressed |= items[k].buttons & ~before;
    before = items[k].buttons;
  }
  survivor.buttons |= pressed;
  for (let k = cut - 1; k >= 0; k--) carryWheel(items[k], survivor);
  items.splice(0, cut);
  q.dropped += cut;
  q.owed = 0;
}

/** The next input to simulate, or undefined when the client has fallen behind. */
export function takeInput(q: InputQueue): PlayerInput | undefined {
  const next = q.items.shift();
  if (next) {
    q.lastButtons = next.buttons;
    // What was owed and has not been skipped by now stays in the queue as a little delay.
    q.owed = 0;
  }
  return next;
}
