/** The room loop's timing meter (src/room/perf.ts). */

import { describe, expect, it } from 'vitest';
import { createPerfMeter, perfReport, perfSample } from '../src/room/perf';

describe('perf meter', () => {
  it('reports nothing before the first sample', () => {
    const report = perfReport(createPerfMeter());
    expect(report).toEqual({ samples: 0, updateMs: { mean: 0, p99: 0, max: 0 }, gapMs: { mean: 0, p99: 0, max: 0 }, ticksPerSecond: 0 });
  });

  it('gives the mean, the 99th percentile and the maximum, and the real tick rate', () => {
    const meter = createPerfMeter(1000);
    // 199 quick updates and one slow one, each a third of a tenth of a second apart, one tick each.
    for (let i = 0; i < 199; i++) perfSample(meter, 1, 1000 / 30, 1);
    perfSample(meter, 21, 1000 / 30, 1);
    const report = perfReport(meter);
    expect(report.samples).toBe(200);
    expect(report.updateMs.mean).toBeCloseTo(1.1, 5);
    expect(report.updateMs.p99).toBe(1);
    expect(report.updateMs.max).toBe(21);
    expect(report.gapMs.mean).toBeCloseTo(33.33, 2);
    expect(report.ticksPerSecond).toBeCloseTo(30, 1);
  });

  it('shows a starved server as fewer ticks per second, not as a lie', () => {
    const meter = createPerfMeter(100);
    // The timer only comes round every 200 ms and the accumulator allows four ticks per update.
    for (let i = 0; i < 50; i++) perfSample(meter, 2, 200, 4);
    expect(perfReport(meter).ticksPerSecond).toBeCloseTo(20, 1);
  });

  it('keeps only the most recent samples', () => {
    const meter = createPerfMeter(10);
    for (let i = 0; i < 10; i++) perfSample(meter, 100, 33, 1);
    for (let i = 0; i < 10; i++) perfSample(meter, 2, 33, 1);
    const report = perfReport(meter);
    expect(report.samples).toBe(10);
    expect(report.updateMs.max).toBe(2);
  });
});
