import { Btn } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import {
  createInputQueue,
  HOLD_BUTTONS,
  INPUT_QUEUE_HARD_MAX,
  INPUT_QUEUE_KEEP,
  INPUT_QUEUE_MAX,
  noteGuessedTick,
  pushInput,
  takeInput,
  type InputQueue,
} from '../src/room/inputQueue';
import { input } from './helpers';

/** Pushes one input per entry of `buttons`, numbered from `firstSeq`. */
function burst(q: InputQueue, firstSeq: number, buttons: number[]): void {
  buttons.forEach((b, i) => pushInput(q, input(firstSeq + i, { buttons: b })));
}

/** Plays the queue out one input per tick and returns the buttons the simulation would see. */
function play(q: InputQueue): number[] {
  const seen: number[] = [];
  for (let next = takeInput(q); next; next = takeInput(q)) seen.push(next.buttons);
  return seen;
}

const S = Btn.strike;

describe('input queue', () => {
  it('hands inputs back one at a time, oldest first', () => {
    const q = createInputQueue();
    pushInput(q, input(1));
    pushInput(q, input(2));
    expect(takeInput(q)?.seq).toBe(1);
    expect(takeInput(q)?.seq).toBe(2);
    expect(takeInput(q)).toBeUndefined();
  });

  it('ignores duplicates and inputs that arrive out of order', () => {
    const q = createInputQueue();
    pushInput(q, input(5));
    pushInput(q, input(5));
    pushInput(q, input(4));
    pushInput(q, input(6));
    expect(q.items.map((i) => i.seq)).toEqual([5, 6]);
  });

  it('skips to the newest inputs when it overflows with nothing new in them', () => {
    const q = createInputQueue();
    for (let seq = 1; seq <= INPUT_QUEUE_MAX + 1; seq++) pushInput(q, input(seq));
    expect(q.items.map((i) => i.seq)).toEqual([INPUT_QUEUE_MAX, INPUT_QUEUE_MAX + 1]);
    expect(q.items.length).toBe(INPUT_QUEUE_KEEP);
    expect(q.dropped).toBe(INPUT_QUEUE_MAX + 1 - INPUT_QUEUE_KEEP);
  });

  it('never grows without bound under a flood, whatever the inputs say', () => {
    const q = createInputQueue();
    for (let seq = 1; seq <= 10_000; seq++) {
      pushInput(q, input(seq));
      expect(q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_MAX);
    }
    expect(q.items[q.items.length - 1].seq).toBe(10_000);
    // Inputs that all hold a button down, or that change it every time, cannot be skipped
    // politely. They are still bounded.
    const held = createInputQueue();
    const mashed = createInputQueue();
    for (let seq = 1; seq <= 10_000; seq++) {
      pushInput(held, input(seq, { buttons: S }));
      pushInput(mashed, input(seq, { buttons: seq % 2 ? S : 0 }));
      expect(held.items.length).toBeLessThanOrEqual(INPUT_QUEUE_HARD_MAX);
      expect(mashed.items.length).toBeLessThanOrEqual(INPUT_QUEUE_HARD_MAX);
    }
    expect(held.items[held.items.length - 1].seq).toBe(10_000);
  });

  it('carries a command wheel pick from a skipped input to the oldest survivor', () => {
    const q = createInputQueue();
    pushInput(q, input(1, { wheel: 'follow' }));
    pushInput(q, input(2, { wheel: 'moveTo', marker: { x: 10, z: -20 } }));
    for (let seq = 3; seq <= INPUT_QUEUE_MAX + 1; seq++) pushInput(q, input(seq));
    const survivor = q.items[0];
    // The newest skipped pick wins.
    expect(survivor.wheel).toBe('moveTo');
    expect(survivor.marker).toEqual({ x: 10, z: -20 });
  });

  it('does not overwrite a pick the survivor already carries', () => {
    const q = createInputQueue();
    pushInput(q, input(1, { wheel: 'follow' }));
    for (let seq = 2; seq <= INPUT_QUEUE_MAX - 1; seq++) pushInput(q, input(seq));
    pushInput(q, input(INPUT_QUEUE_MAX, { wheel: 'holdCharge' }));
    pushInput(q, input(INPUT_QUEUE_MAX + 1));
    expect(q.items[0].seq).toBe(INPUT_QUEUE_MAX);
    expect(q.items[0].wheel).toBe('holdCharge');
  });
});

describe('input queue after a stall: nothing the player did is changed', () => {
  /** A queue whose player has just been through `guessed` ticks with nothing arriving. */
  function stalled(guessed: number, buttons: number): InputQueue {
    const q = createInputQueue();
    pushInput(q, input(1, { buttons }));
    takeInput(q);
    for (let i = 0; i < guessed; i++) noteGuessedTick(q, buttons);
    return q;
  }

  it('keeps a tap that happened entirely inside the stall', () => {
    for (const tap of [1, 2, 3]) {
      const q = stalled(9, 0);
      // Nine late inputs and the current one, all at once: idle, the tap, idle again.
      const late = [0, 0, 0, ...new Array<number>(tap).fill(S), ...new Array<number>(7 - tap).fill(0)];
      burst(q, 2, late);
      const seen = play(q);
      // The button goes down for exactly as many ticks as the player held it, then up.
      expect(seen.filter((b) => b & S).length, `tap of ${tap}`).toBe(tap);
      expect(seen[seen.length - 1]).toBe(0);
      // And the idle time around it was skipped: the player is not left nine ticks behind.
      expect(seen.length).toBeLessThanOrEqual(tap + INPUT_QUEUE_KEEP + 1);
    }
  });

  it('keeps a hold that began inside the stall at its full length', () => {
    const q = stalled(8, 0);
    // The stall ends: ten late inputs at once, the last eight with the button already down.
    burst(q, 2, [0, 0, ...new Array<number>(8).fill(S)]);
    expect(q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_HARD_MAX);
    // From here on the link is fine again: one input arrives and one is played per tick.
    const seen: number[] = [];
    const rest = [S, S, S, S, S, S, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    rest.forEach((buttons, i) => {
      seen.push(takeInput(q)?.buttons ?? -1);
      pushInput(q, input(12 + i, { buttons }));
    });
    seen.push(...play(q));
    expect(seen.filter((b) => b & S).length).toBe(14);
    // One unbroken hold: down for fourteen ticks, then up, never down again.
    expect(seen.join('').replace(/^0*/, '')).toMatch(/^1{14}0+$/);
    // Once the button was up the queue caught up again.
    expect(seen.length).toBeLessThan(10 + rest.length - 4);
  });

  it('skips the late inputs of a hold that the guesses already stood in for, and no more', () => {
    // The button was down before the stall, and the server guessed "still down" nine times.
    const q = stalled(9, S);
    burst(q, 2, new Array<number>(10).fill(S));
    // Nine guessed, at most nine skipped: the hold is not a tick shorter than it really was.
    expect(q.dropped).toBeLessThanOrEqual(9);
    expect(q.dropped).toBeGreaterThanOrEqual(10 - INPUT_QUEUE_MAX);
    expect(q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_MAX);
    expect(q.items.every((i) => i.buttons === S)).toBe(true);
    // The same burst with nothing owed (a client that simply sent too fast) skips nothing of it.
    const fast = createInputQueue();
    pushInput(fast, input(1, { buttons: S }));
    takeInput(fast);
    burst(fast, 2, new Array<number>(10).fill(S));
    expect(fast.dropped).toBe(0);
    expect(fast.items.length).toBe(10);
  });

  it('skips freely through buttons whose holding time means nothing', () => {
    expect(HOLD_BUTTONS & Btn.block).toBe(0);
    expect(HOLD_BUTTONS & Btn.fire).toBe(0);
    const q = createInputQueue();
    burst(q, 1, [Btn.block, Btn.block, Btn.block, Btn.block, Btn.block, Btn.block, Btn.block]);
    // The press itself stays; the rest of the brace is the same thing said again.
    expect(q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_MAX);
    expect(play(q).every((b) => b === Btn.block)).toBe(true);
  });

  it('keeps a release that arrived late, so the button comes up as soon as it is known', () => {
    const q = stalled(6, S);
    // The player let go two inputs into the stall.
    burst(q, 2, [S, S, 0, 0, 0, 0, 0]);
    const seen = play(q);
    expect(seen[0] & S).toBe(0);
    expect(seen.every((b) => b === 0)).toBe(true);
  });

  it('does not lose a press even when a flood forces it to discard outright', () => {
    const q = createInputQueue();
    // A press, a release, and then far more inputs than the queue will ever hold, each
    // changing a button so that none of them can be skipped politely.
    burst(q, 1, [S, 0]);
    for (let seq = 3; seq <= INPUT_QUEUE_HARD_MAX + 1; seq++) pushInput(q, input(seq, { buttons: seq % 2 ? Btn.block : 0 }));
    expect(q.items.length).toBe(INPUT_QUEUE_KEEP);
    expect(q.items[0].buttons & S).toBe(S);
    expect(q.items[1].buttons & S).toBe(0);
  });
});
