import { describe, expect, it } from 'vitest';
import { catchingUp, createFixedStep, dueSteps, resetFixedStep, type FixedStepOptions } from '../src/room/fixedStep';

const STEP = 1000 / 30;
const options: FixedStepOptions = { stepMs: STEP, maxSteps: 4, maxOwedMs: 1000, slopMs: 2, speed: 1 };

describe('fixed-step accumulator', () => {
  it('runs nothing on the first call and one tick per step of time after that', () => {
    const clock = createFixedStep();
    expect(dueSteps(clock, 5000, options)).toBe(0);
    let total = 0;
    for (let i = 1; i <= 300; i++) total += dueSteps(clock, 5000 + i * STEP, options);
    expect(total).toBe(300);
  });

  it('keeps the exact long-run rate whatever the call rhythm', () => {
    // A timer that fires a little early or late, as real ones do, and a caller twice as fast.
    for (const period of [STEP - 1.4, STEP + 1.7, STEP / 2, 7]) {
      const clock = createFixedStep();
      dueSteps(clock, 0, options);
      let total = 0;
      let t = 0;
      while (t < 60_000) {
        t += period;
        total += dueSteps(clock, t, options);
      }
      expect(Math.abs(total - Math.round(t / STEP))).toBeLessThanOrEqual(1);
    }
  });

  it('runs a tick that is due within the slop instead of waiting for the next call', () => {
    const clock = createFixedStep();
    dueSteps(clock, 0, options);
    expect(dueSteps(clock, STEP - 1.5, options)).toBe(1);
    // The early tick is paid back: the next one is not early as well.
    expect(dueSteps(clock, STEP - 1.5 + 20, options)).toBe(0);
  });

  it('catches up after the server stood still, a few ticks per call, and drops nothing', () => {
    // Round 5: a stall of 0.4 s used to drop all but 4 ticks of it, and every player's inputs
    // then waited 8 ticks longer for the rest of the match.
    for (const stall of [170, 400, 950]) {
      const clock = createFixedStep();
      dueSteps(clock, 0, options);
      let t = 0;
      let total = 0;
      for (let i = 0; i < 30; i++) total += dueSteps(clock, (t += STEP), options);
      t += stall;
      let calls = 0;
      // Then the timer comes back every tick: the owed ticks are run within a few calls.
      while (calls < 12) {
        const steps = dueSteps(clock, (t += STEP), options);
        expect(steps).toBeLessThanOrEqual(options.maxSteps);
        total += steps;
        calls++;
      }
      expect(Math.abs(total - t / STEP)).toBeLessThan(1);
      expect(clock.dropped).toBe(0);
      expect(catchingUp(clock, options)).toBe(false);
    }
  });

  it('says whether ticks are still owed after a call', () => {
    const clock = createFixedStep();
    dueSteps(clock, 0, options);
    expect(dueSteps(clock, 400, options)).toBe(4);
    expect(catchingUp(clock, options)).toBe(true);
    expect(dueSteps(clock, 400 + STEP, options)).toBe(4);
    expect(dueSteps(clock, 400 + 2 * STEP, options)).toBe(4);
    expect(dueSteps(clock, 400 + 3 * STEP, options)).toBe(3);
    expect(catchingUp(clock, options)).toBe(false);
    expect(dueSteps(clock, 400 + 4 * STEP, options)).toBe(1);
  });

  it('never asks for more than maxSteps, and drops what is owed beyond maxOwedMs', () => {
    const clock = createFixedStep();
    dueSteps(clock, 0, options);
    // A ten second stall: a few catch-up ticks per call, not three hundred, and only the last
    // second of it is owed; the rest is dropped.
    expect(dueSteps(clock, 10_000, options)).toBe(4);
    expect(clock.dropped).toBeCloseTo(9_000, 6);
    expect(clock.owed).toBeLessThanOrEqual(options.maxOwedMs);
    // That second is caught up within ten calls a tick apart, never more than 4 ticks at a time.
    let t = 10_000;
    let total = 4;
    for (let i = 0; i < 10; i++) {
      const steps = dueSteps(clock, (t += STEP), options);
      expect(steps).toBeLessThanOrEqual(4);
      total += steps;
    }
    expect(total).toBe(30 + 10);
    // And no debt left behind: the next step of time is one tick.
    expect(dueSteps(clock, (t += STEP), options)).toBe(1);
    // Many stalls in a row never add up either: what is owed never passes a second.
    let stalls = 0;
    for (let i = 1; i <= 50; i++) {
      stalls += dueSteps(clock, (t += 5_000), options);
      expect(clock.owed).toBeLessThanOrEqual(options.maxOwedMs);
    }
    expect(stalls).toBe(50 * 4);
  });

  it('drops only what a stall over the limit owes beyond it', () => {
    const clock = createFixedStep();
    dueSteps(clock, 0, options);
    dueSteps(clock, 3_000, options);
    expect(clock.dropped).toBeCloseTo(2_000, 6);
  });

  it('ignores a clock that stands still, runs backwards or is not a number', () => {
    const clock = createFixedStep();
    dueSteps(clock, 1000, options);
    expect(dueSteps(clock, 1000, options)).toBe(0);
    expect(dueSteps(clock, 400, options)).toBe(0);
    expect(dueSteps(clock, Number.NaN, options)).toBe(0);
    expect(clock.owed).toBe(0);
  });

  it('scales simulated time with speed, and its step limit with it', () => {
    const fast: FixedStepOptions = { ...options, speed: 10, maxSteps: 40 };
    const clock = createFixedStep();
    dueSteps(clock, 0, fast);
    let total = 0;
    for (let i = 1; i <= 30; i++) total += dueSteps(clock, i * STEP, fast);
    expect(total).toBe(300);
  });

  it('starts measuring afresh after a reset', () => {
    const clock = createFixedStep();
    dueSteps(clock, 0, options);
    dueSteps(clock, 20, options);
    resetFixedStep(clock);
    expect(dueSteps(clock, 90_000, options)).toBe(0);
    expect(dueSteps(clock, 90_000 + STEP, options)).toBe(1);
  });
});
