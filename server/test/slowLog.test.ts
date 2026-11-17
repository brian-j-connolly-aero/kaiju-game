import { describe, expect, it } from 'vitest';
import { LOG_EVERY_MS, MINUTE_MS, SlowWatch } from '../src/room/slowLog';
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
    // The process stands still for 400 ms (a garbage collection, the container's machine). Since
    // round 5 the match catches that up.
    skip(400);
    run(TICK_MS / 1000);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/\[room BCDF\] slow moment .* the server stood still for 4\d\d ms, and caught up/);
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
    expect(errors[1]).toMatch(/seat 0's inputs stopped arriving for 0\.\d+ s .* \(their connection stalled, or their page froze\); the server repeated their last input meanwhile/);
    // A stall over a second still skips what cannot be caught up.
    for (let i = 0; i < LOG_EVERY_MS / TICK_MS; i++) {
      room.message('p0', 'input', input(++seq));
      run(TICK_MS / 1000);
    }
    skip(3000);
    run(TICK_MS / 1000);
    expect(errors.length).toBe(3);
    expect(errors[2]).toMatch(/the server stood still for 30\d\d ms, 20\d\d ms of the match skipped/);
  });

  it('tells a page that fell behind from a connection that stalled (round 5)', () => {
    // A page whose inputs keep coming, each one tick after its tick was played (it lost the
    // tick of slack: a freeze, a page that draws too few frames). Before round 5 the log blamed
    // the connection for this too.
    const errors: string[] = [];
    const { room, run } = makeRoom({ slowLog: true, logError: (line) => errors.push(line) });
    const peers = seatPlayers(room, 1);
    startMatch(room, peers);
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      room.message('p0', 'input', input(++seq, { moveZ: 1 }));
      run(TICK_MS / 1000);
    }
    // The page freezes for two ticks and then sends one input a tick again, as a page did before
    // round 5: it never sends the two it owes, so each input now arrives just after its tick. A
    // button pressed now and then (a press is played late rather than dropped) keeps the body
    // from being stopped.
    run((2 * TICK_MS) / 1000);
    for (let i = 0; i < 20; i++) {
      run(TICK_MS / 1000);
      room.message('p0', 'input', input(++seq, { moveZ: 1, buttons: i % 12 === 11 ? 1 : 0 }));
    }
    for (let i = 0; i < 10; i++) {
      room.message('p0', 'input', input(++seq, { moveZ: 1 }));
      room.message('p0', 'input', input(++seq, { moveZ: 1 }));
      run(TICK_MS / 1000);
    }
    const late = errors.filter((line) => line.includes('inputs kept arriving but too late'));
    expect(late.length, errors.join('\n')).toBe(1);
    expect(late[0]).toMatch(/seat 0's inputs kept arriving but too late for their ticks for 0\.\d+ s .* \(their page or computer fell behind, not the connection\)/);
  });

  it('writes a line a minute for the server and for every player, with what their page reported (round 5)', () => {
    const errors: string[] = [];
    const { room, run } = makeRoom({ slowLog: true, logError: (line) => errors.push(line) });
    const peers = seatPlayers(room, 2);
    startMatch(room, peers);
    let seq = [0, 0];
    const ticks = MINUTE_MS / TICK_MS + 2;
    for (let i = 0; i < ticks; i++) {
      for (let p = 0; p < 2; p++) room.message(`p${p}`, 'input', input(++seq[p], { moveZ: 1 }));
      // Seat 1's page pings every 2 s with its report; seat 0's sends none (an older page).
      if (i % 60 === 0) room.message('p1', 'ping', { t: i, rtt: 120 + (i % 120 === 0 ? 40 : 0), snaps: 1, snapMax: 42, freezes: 1, frameMax: 180 });
      run(TICK_MS / 1000);
    }
    const minute = errors.filter((line) => line.includes('the last minute'));
    expect(minute.length, errors.join('\n')).toBe(3);
    expect(minute[0]).toMatch(/the server ran 1[78]\d\d steps in \d+ updates, [\d.]+ ms each on average \(longest \d+ ms\), longest wait between updates \d+ ms, stood still 0 times, 0 ms of the match skipped/);
    const one = minute.find((line) => line.includes('seat 1 ('));
    const zero = minute.find((line) => line.includes('seat 0 ('));
    expect(one).toMatch(/input delay about \d+ ms \(70 on the line, \d+ waiting at the server\); round trip 140 ms \(worst 160\)/);
    expect(one).toMatch(/snapped back 30 times over 15 cm \(largest 0\.42 m\); page froze 30 times over 0\.1 s \(longest 180 ms\)/);
    expect(zero).toMatch(/inputs waiting at the server about \d+ ms; queue [\d.]+ on average, at most \d+; 18\d\d inputs arrived for 18\d\d steps/);
    expect(zero).toContain('no report from their page');
    // Nonsense in a report is ignored, and the next minute starts from nothing.
    room.message('p1', 'ping', { t: 1, rtt: 'fast', snaps: -5, frameMax: Number.NaN });
    room.message('p1', 'ping', { t: 2, rtt: 1e12, snaps: 1e9, snapMax: -1 });
    for (let i = 0; i < ticks; i++) run(TICK_MS / 1000);
    const next = errors.filter((line) => line.includes('the last minute')).slice(3);
    const one2 = next.find((line) => line.includes('seat 1 ('));
    // ('fast' is no round trip: that report is left out; the other is clamped.)
    expect(one2).toMatch(/round trip \d+ ms \(worst 60000\)/);
    expect(one2).toMatch(/snapped back 100[01] times/);
  });
});
