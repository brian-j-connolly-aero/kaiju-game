import { describe, expect, it } from 'vitest';
import { LOG_EVERY_MS, SlowWatch } from '../src/room/slowLog';
import { input, makeRoom, seatPlayers, startMatch, TICK_MS } from './helpers';

describe('slow moments in the server log (round 4)', () => {
  it('names the systems that took the time of a slow update, and rations its lines', () => {
    let t = 0;
    const lines: string[] = [];
    const watch = new SlowWatch({ now: () => t, gc: false, log: (line) => lines.push(line) });
    const update = (work: (mark: (system: number) => void) => void, ticks = 1): void => {
      const began = t;
      watch.beginTick();
      work(watch.mark);
      const simulated = t;
      t += 1;
      watch.update({ began, ended: t, simulated, ticks, dropped: 0, elapsed: 151 });
      t = began + TICK_MS;
    };
    // An ordinary update: 3 ms of simulation. Nothing to say.
    update((mark) => {
      t += 2;
      mark(3);
      t += 1;
      mark(9);
    });
    expect(lines).toEqual([]);
    // The bots take 41 ms and city damage 12 ms.
    update((mark) => {
      t += 41;
      mark(3);
      t += 12;
      mark(9);
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('2:31 into the match');
    expect(lines[0]).toMatch(/one update took 54 ms for 1 step \(bots 41 ms, city damage 12 ms, snapshots and sending 1 ms\)/);
    // Another one at once is held back, and counted in the next line once LOG_EVERY_MS has passed.
    update((mark) => {
      t += 40;
      mark(4);
    });
    expect(lines.length).toBe(1);
    t += LOG_EVERY_MS;
    update((mark) => {
      t += 35;
      mark(4);
    });
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('movement 35 ms');
    expect(lines[1]).toContain('(and 1 more since the last line)');
  });

  it('says when the server stood still, and when a player\'s inputs stopped arriving', () => {
    const errors: string[] = [];
    const { room, run, skip } = makeRoom({ slowLog: true, logError: (line) => errors.push(line) });
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      room.message('p0', 'input', input(++seq));
      run(TICK_MS / 1000);
    }
    expect(errors).toEqual([]);
    // The process stands still for 400 ms (a garbage collection, the container's machine).
    skip(400);
    run(TICK_MS / 1000);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/\[room BCDF\] slow moment .* the server stood still for 4\d\d ms, \d+ ms of the match skipped/);
    // Later the player's line stalls for half a second, then everything arrives.
    for (let i = 0; i < (LOG_EVERY_MS / TICK_MS) + 5; i++) {
      room.message('p0', 'input', input(++seq));
      run(TICK_MS / 1000);
    }
    expect(errors.length).toBe(1);
    for (let i = 0; i < 15; i++) run(TICK_MS / 1000);
    for (let i = 0; i < 16; i++) room.message('p0', 'input', input(++seq));
    run(TICK_MS / 1000);
    expect(errors.length).toBe(2);
    expect(errors[1]).toMatch(/seat 0's inputs stopped arriving for 0\.\d+ s .* the server repeated their last input meanwhile/);
  });
});
