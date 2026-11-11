import { describe, expect, it } from 'vitest';
import { createFixedStep, dueSteps, resetFixedStep, type FixedStepOptions } from '../src/room/fixedStep';

const STEP = 1000 / 30;
const options: FixedStepOptions = { stepMs: STEP, maxSteps: 4, maxFrameMs: 250, slopMs: 2, speed: 1 };

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

  it('never asks for more than maxSteps and drops the backlog after a stall', () => {
    const clock = createFixedStep();
    dueSteps(clock, 0, options);
    // A ten second stall: a few catch-up ticks, not three hundred.
    expect(dueSteps(clock, 10_000, options)).toBe(4);
    expect(clock.owed).toBe(0);
    // And no debt left behind: the next step of time is one tick.
    expect(dueSteps(clock, 10_000 + STEP, options)).toBe(1);
    // Many stalls in a row never add up either.
    let total = 0;
    for (let i = 1; i <= 50; i++) total += dueSteps(clock, 20_000 + i * 5_000, options);
    expect(total).toBe(50 * 4);
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
