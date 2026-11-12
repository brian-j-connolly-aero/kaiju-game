/**
 * Port Meridian: the first build in a fresh engine (server start, page load) is the one players
 * wait for. This file builds the city once, before anything else in it runs, and times that cold
 * build on its own. The budget is 200 ms on an idle machine (docs/CITY.md section 7); the limit
 * here is looser, and it counts this thread's processor time where Node can measure it, so a
 * busy machine running the whole suite in parallel does not fail it.
 */

import { describe, expect, it } from 'vitest';
import { buildCityIndex, generatePortMeridian } from '../src/city';

// Processor time of this thread where Node can tell it (other test files and other programs
// running at the same time do not count against it), else the time on the clock.
const threadCpu = (process as unknown as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage;
const now = (): number => {
  if (!threadCpu) return performance.now();
  const u = threadCpu.call(process);
  return (u.user + u.system) / 1000;
};
const t0 = now();
const city = generatePortMeridian();
buildCityIndex(city);
const cold = now() - t0;

describe('Port Meridian: the cold build', () => {
  it('builds with its spatial index in under 400 ms the first time', () => {
    expect(city.structures.length).toBeGreaterThan(2500);
    expect(cold).toBeLessThan(400);
  });
});
