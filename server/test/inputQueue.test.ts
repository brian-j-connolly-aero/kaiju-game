import { Btn, type PlayerInput } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import {
  createInputQueue,
  INPUT_BACKLOG_TICKS,
  INPUT_CUSHION,
  INPUT_QUEUE_HARD_MAX,
  INPUT_QUEUE_KEEP,
  INPUT_QUEUE_MAX,
  noteGuessedTick,
  packedAck,
  pushInput,
  takeInput,
} from '../src/room/inputQueue';
import { STARVED_TICKS } from '../src/room/match';
import { input } from './helpers';

/** A button held for a time that matters (the volley charges while it is down). */
const S = Btn.volley;
const F = Btn.fire;

/** One player's queue, played tick by tick the way the match loop plays it (match.ts). */
class Line {
  readonly q = createInputQueue();
  /** The buttons the simulation had on each tick. */
  readonly seen: number[] = [];
  /** The molt cards the simulation was handed, in order. */
  readonly cards: number[] = [];
  ticks = 0;
  private seq = 0;
  private last = 0;
  private silent = 0;

  /** The player's next input, not delivered yet. */
  make(buttons = 0, fields: Partial<PlayerInput> = {}): PlayerInput {
    return input(++this.seq, { moveZ: 1, buttons, ...fields });
  }

  deliver(...inputs: PlayerInput[]): void {
    for (const it of inputs) pushInput(this.q, it);
  }

  /** Makes and delivers one input per entry at once. */
  send(...buttons: number[]): void {
    for (const b of buttons) this.deliver(this.make(b));
  }

  tick(still = false): void {
    // Ticks before the player's first input stand for nothing: not counted.
    if (this.q.started) this.ticks++;
    const next = takeInput(this.q, still);
    if (next) {
      this.last = next.buttons;
      this.silent = 0;
      this.seen.push(next.buttons);
      if (next.card) this.cards.push(next.card);
      return;
    }
    this.silent++;
    noteGuessedTick(this.q, this.last, this.silent < STARVED_TICKS);
    this.seen.push(this.last);
  }

  /** The acknowledgement as a snapshot carries it. */
  get ack(): { played: number; drops: number } {
    const v = packedAck(this.q);
    return { played: v & 0xffffff, drops: v >>> 24 };
  }

  /**
   * Ticks the body has had beyond what the client counts: the client predicts the snapshot's body
   * plus one tick for every input after `played`, less `drops`.
   */
  get extra(): number {
    const { played, drops } = this.ack;
    return this.ticks - played - drops;
  }
}

/** A line one input into play, then `guessed` ticks with nothing arriving, holding `buttons`. */
function stalled(guessed: number, buttons: number): Line {
  const line = new Line();
  line.send(buttons);
  line.tick(); // the cushion
  line.tick(); // input 1
  for (let i = 0; i < guessed; i++) line.tick();
  return line;
}

/** Presses (a button going down) in a run of per-tick buttons. */
function presses(buttons: number[]): number {
  let n = 0;
  let before = 0;
  for (const b of buttons) {
    for (let x = b & ~before; x; x &= x - 1) n++;
    before = b;
  }
  return n;
}

/** The lengths of the holds of `bit` in a run of per-tick buttons. */
function holds(buttons: number[], bit: number): number[] {
  const out: number[] = [];
  let run = 0;
  for (const b of [...buttons, 0]) {
    if (b & bit) run++;
    else if (run > 0) {
      out.push(run);
      run = 0;
    }
  }
  return out;
}

describe('input queue', () => {
  it('plays inputs one per tick, oldest first, from the tick after the first one arrived', () => {
    const line = new Line();
    line.send(0, 0);
    // The cushion: the first tick after the first input is played on a guess while it waits.
    line.tick();
    expect(line.q.items.map((i) => i.seq)).toEqual([1, 2]);
    line.tick();
    expect(line.q.items.map((i) => i.seq)).toEqual([2]);
    line.tick();
    expect(line.q.items).toEqual([]);
    expect(line.ack).toEqual({ played: 2, drops: 0 });
    expect(line.extra).toBe(INPUT_CUSHION);
  });

  it('ignores duplicates and inputs that arrive out of order', () => {
    const q = createInputQueue();
    pushInput(q, input(5));
    pushInput(q, input(5));
    pushInput(q, input(4));
    pushInput(q, input(6));
    expect(q.items.map((i) => i.seq)).toEqual([5, 6]);
  });

  it('never grows without bound under a flood, whatever the inputs say', () => {
    for (const pattern of [(seq: number) => 0, (seq: number) => S, (seq: number) => (seq % 2 ? S : 0)]) {
      const q = createInputQueue();
      for (let seq = 1; seq <= 10_000; seq++) {
        pushInput(q, input(seq, { buttons: pattern(seq) }));
        expect(q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_HARD_MAX);
      }
      expect(q.items[q.items.length - 1].seq).toBe(10_000);
    }
  });

  it('does not lose a press even when a flood forces it to discard outright', () => {
    const q = createInputQueue();
    // A press, a release, and then far more inputs than the queue will ever hold, each
    // changing a button so that none of them can be skipped politely.
    pushInput(q, input(1, { buttons: S }));
    pushInput(q, input(2));
    for (let seq = 3; seq <= INPUT_QUEUE_HARD_MAX + 1; seq++) pushInput(q, input(seq, { buttons: seq % 2 ? Btn.stomp : 0 }));
    expect(q.items.length).toBe(INPUT_QUEUE_KEEP);
    expect(q.items[0].buttons & S).toBe(S);
    expect(q.items[1].buttons & S).toBe(0);
  });
});

describe('late inputs: a guess stands in, and nothing the player did is changed', () => {
  it('drops the late input a guess stood for, and tells the client it will', () => {
    const line = new Line();
    line.send(0);
    line.tick(); // the cushion
    line.tick(); // input 1
    line.tick(); // input 2 is late: a guess
    expect(line.ack).toEqual({ played: 1, drops: 1 });
    line.send(0, 0);
    // Input 2 was the guess's; input 3 is played on its own tick.
    expect(line.q.items.map((i) => i.seq)).toEqual([3]);
    expect(line.ack).toEqual({ played: 2, drops: 0 });
    line.tick();
    expect(line.ack).toEqual({ played: 3, drops: 0 });
    expect(line.extra).toBe(INPUT_CUSHION);
  });

  it('never gives the body a tick the client does not count, and builds up no delay', () => {
    let rand = 99;
    const roll = (n: number): number => {
      rand = (rand * 1103515245 + 12345) % 2147483648;
      return rand % n;
    };
    for (const maxLate of [1, 3, 8, STARVED_TICKS - 2]) {
      const line = new Line();
      const inFlight: Array<{ at: number; it: PlayerInput }> = [];
      let arrive = 0;
      const sent: number[] = [];
      for (let t = 1; t <= 900; t++) {
        // Taps of Fire and holds of the volley now and then; late by a random amount until near the end.
        const buttons = t > 850 ? 0 : roll(12) === 0 ? F : t % 90 < 25 && t % 90 > 10 ? S : 0;
        sent.push(buttons);
        arrive = Math.max(arrive, t + (t < 800 ? roll(maxLate + 1) : 0));
        inFlight.push({ at: arrive, it: line.make(buttons) });
        while (inFlight.length > 0 && inFlight[0].at <= t) line.deliver((inFlight.shift() as { it: PlayerInput }).it);
        line.tick();
        if (line.ticks > 1) expect(line.extra, `up to ${maxLate} ticks late, tick ${t}`).toBe(INPUT_CUSHION);
      }
      for (let t = 0; t < 30; t++) line.tick();
      // Every press arrived, and the player is back in the present.
      expect(presses(line.seen), `up to ${maxLate} ticks late`).toBe(presses(sent));
      expect(line.q.items.length).toBe(0);
    }
  });

  it('keeps a tap that happened entirely inside a stall', () => {
    for (const tap of [1, 2, 3]) {
      const line = stalled(9, 0);
      // The nine late inputs and the current one, all at once: idle, the tap, idle again.
      line.send(0, 0, 0, ...new Array<number>(tap).fill(S), ...new Array<number>(7 - tap).fill(0));
      for (let i = 0; i < 12; i++) line.tick();
      // The button goes down for exactly as many ticks as the player held it, then up.
      expect(holds(line.seen, S), `tap of ${tap}`).toEqual([tap]);
      // And the idle time around it was dropped: the player is not left nine ticks behind.
      expect(line.q.items).toEqual([]);
      expect(line.extra).toBe(INPUT_CUSHION);
    }
  });

  it('keeps a hold that began inside a stall at its full length', () => {
    const line = stalled(8, 0);
    // The stall ends: ten late inputs at once, the last eight with the button already down,
    // and then six more held and released on time.
    line.send(0, 0, ...new Array<number>(8).fill(S));
    for (const b of [S, S, S, S, S, S, 0, 0, 0]) {
      line.tick();
      line.send(b);
    }
    for (let i = 0; i < 12; i++) line.tick();
    expect(holds(line.seen, S)).toEqual([14]);
    expect(line.q.items).toEqual([]);
    expect(line.extra).toBe(INPUT_CUSHION);
  });

  it('keeps a hold exactly as long when a stall falls in the middle of it (the guesses held it too)', () => {
    const line = stalled(9, S);
    line.send(...new Array<number>(10).fill(S));
    for (const b of [S, S, 0, 0]) {
      line.tick();
      line.send(b);
    }
    for (let i = 0; i < 6; i++) line.tick();
    // Down for input 1, the nine late inputs, the current one and the two after it.
    expect(holds(line.seen, S)).toEqual([13]);
    expect(line.extra).toBe(INPUT_CUSHION);
  });

  it('lets go as soon as a late release is known', () => {
    const line = stalled(6, S);
    // The player let go two inputs into the stall.
    line.send(S, S, 0, 0, 0, 0, 0);
    line.tick();
    expect(line.seen[line.seen.length - 1] & S).toBe(0);
    for (let i = 0; i < 4; i++) line.tick();
    // The six guesses kept the button down (they could not know it had come up): the hold lasts
    // input 1 and the six guessed ticks, and not a tick longer.
    expect(holds(line.seen, S)).toEqual([7]);
    expect(line.extra).toBe(INPUT_CUSHION);
  });

  it('carries a pick from a dropped input to the next input that is kept', () => {
    const line = stalled(3, 0);
    // The late inputs: the second carries a molt card. It is dropped (its tick was guessed), and
    // the card goes with the next input played.
    line.deliver(line.make(0), line.make(0, { card: 2 }), line.make(0), line.make(0));
    for (let i = 0; i < 3; i++) line.tick();
    expect(line.cards).toEqual([2]);
    // An input that carries its own pick keeps it; the newest dropped one waits for the next.
    const own = stalled(2, 0);
    own.deliver(own.make(0, { card: 1 }), own.make(0, { card: 3 }), own.make(0, { card: 2 }));
    for (let i = 0; i < 3; i++) own.tick();
    expect(own.cards).toEqual([2]);
  });
});

describe('what no guess stood for', () => {
  it('catches up after a stall long enough for the unit to be stopped', () => {
    // 24 silent ticks: the first STARVED_TICKS - 1 are guesses that stand in, the rest stand
    // for nothing. Then all the late inputs arrive at once.
    const line = stalled(24, 0);
    line.send(...new Array<number>(25).fill(0));
    // The fourteen the guesses stood for are dropped, and most of the rest skipped.
    expect(line.q.dropped).toBeGreaterThanOrEqual(STARVED_TICKS - 1 + 8);
    expect(line.q.items.length).toBeLessThanOrEqual(INPUT_QUEUE_MAX);
    for (let i = 0; i < INPUT_QUEUE_MAX; i++) line.tick();
    expect(line.q.items).toEqual([]);
  });

  it('trims inputs that keep waiting, but only while the body stands still', () => {
    const line = new Line();
    // A standing backlog: four inputs waiting after every tick, for good. The player has let go of
    // the stick (a body still coasting counts as moving).
    const idle = (): PlayerInput => line.make(0, { moveZ: 0 });
    line.deliver(idle(), idle(), idle(), idle());
    line.tick();
    for (let t = 0; t < 2 * INPUT_BACKLOG_TICKS; t++) {
      line.deliver(idle());
      line.tick(false);
    }
    // Moving: nothing is skipped however long the backlog stays.
    expect(line.q.items.length).toBe(4);
    const played = line.ack.played;
    line.deliver(idle());
    line.tick(true);
    // Standing still: one input is skipped (no stick, no buttons: nobody can see it go).
    expect(line.q.items.length).toBe(3);
    expect(line.ack.played).toBe(played + 2);
  });
});
