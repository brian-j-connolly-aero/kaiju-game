import { describe, expect, it } from 'vitest';
import {
  createInputQueue,
  INPUT_QUEUE_KEEP,
  INPUT_QUEUE_MAX,
  pushInput,
  takeInput,
} from '../src/room/inputQueue';
import { input } from './helpers';

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

  it('trims to the newest inputs when it overflows', () => {
    const q = createInputQueue();
    for (let seq = 1; seq <= INPUT_QUEUE_MAX + 1; seq++) pushInput(q, input(seq));
    expect(q.items.map((i) => i.seq)).toEqual([INPUT_QUEUE_MAX, INPUT_QUEUE_MAX + 1]);
    expect(q.items.length).toBe(INPUT_QUEUE_KEEP);
    expect(q.dropped).toBe(INPUT_QUEUE_MAX + 1 - INPUT_QUEUE_KEEP);
  });

  it('never grows without bound under a flood', () => {
    const q = createInputQueue();
    for (let seq = 1; seq <= 10_000; seq++) {
      pushInput(q, input(seq));
      expect(q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_MAX);
    }
    expect(q.items[q.items.length - 1].seq).toBe(10_000);
  });

  it('carries a command wheel pick from a discarded input to the oldest survivor', () => {
    const q = createInputQueue();
    pushInput(q, input(1, { wheel: 'follow' }));
    pushInput(q, input(2, { wheel: 'moveTo', marker: { x: 10, z: -20 } }));
    for (let seq = 3; seq <= INPUT_QUEUE_MAX + 1; seq++) pushInput(q, input(seq));
    const survivor = q.items[0];
    // The newest discarded pick wins.
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
