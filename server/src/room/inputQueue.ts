/**
 * The short per-player input queue. Clients send 30 inputs a second and the simulation takes
 * exactly one per player per tick, so in steady state the queue holds zero or one input and
 * only absorbs network jitter.
 *
 * When it overflows (a burst after a stall, or a client whose clock runs fast) the oldest
 * inputs are discarded down to `keep`, which brings the player back to real time instead of
 * leaving them a fixed delay behind. A one-shot command wheel pick in a discarded input is
 * carried over to the oldest input that survives, so an order is never lost that way.
 */

import type { PlayerInput } from '@mb/shared';

/** Inputs a queue may hold before it is trimmed (about 170 ms of play). */
export const INPUT_QUEUE_MAX = 5;
/** Inputs left after a trim. */
export const INPUT_QUEUE_KEEP = 2;

export interface InputQueue {
  items: PlayerInput[];
  /** Inputs discarded by trims since the queue was made (diagnostics). */
  dropped: number;
}

export function createInputQueue(): InputQueue {
  return { items: [], dropped: 0 };
}

export function clearInputQueue(q: InputQueue): void {
  q.items.length = 0;
}

/**
 * Adds a sanitized input. An input whose sequence number is not newer than the last one queued
 * is ignored (a duplicate or a reordered resend).
 */
export function pushInput(q: InputQueue, input: PlayerInput, max = INPUT_QUEUE_MAX, keep = INPUT_QUEUE_KEEP): void {
  const items = q.items;
  if (items.length > 0 && input.seq <= items[items.length - 1].seq) return;
  items.push(input);
  if (items.length <= max) return;

  const cut = items.length - keep;
  const survivor = items[cut];
  for (let i = cut - 1; i >= 0; i--) {
    const old = items[i];
    // The newest discarded pick wins; an input that already carries a pick keeps its own.
    if (old.wheel && !survivor.wheel) {
      survivor.wheel = old.wheel;
      if (old.marker) survivor.marker = old.marker;
    }
  }
  items.splice(0, cut);
  q.dropped += cut;
}

/** The next input to simulate, or undefined when the client has fallen behind. */
export function takeInput(q: InputQueue): PlayerInput | undefined {
  return q.items.shift();
}
