/**
 * Watches how the bots get about in a match (npm run sim -- --nav): is anybody stuck, how much
 * wading, how crowded do the bridges get. Used to judge a city, not to change anything: it
 * only reads the World after each tick.
 */

import { bridgeAt, DT, type SimEvent, type World } from '../src/index';

export interface NavWatch {
  onTick: (world: World, events: SimEvent[]) => void;
  /** Seconds of play watched. */
  seconds: number;
  /** Unit-seconds alive during play. */
  unitSeconds: number;
  /** Unit-seconds spent pushing on the stick while hardly moving (after the first second of it). */
  stuckSeconds: number;
  /** The longest one unit stayed like that, seconds. */
  longestStuck: number;
  /** Times a unit gave up on a goal it could not reach (it waits, then tries again). */
  giveUps: number;
  /** Unit-seconds wading. */
  wadeSeconds: number;
  /** Unit-seconds on a bridge deck, and the most units on one deck at once. */
  bridgeSeconds: number;
  bridgePeak: number;
  /** Seconds the kaiju pushed on the stick, free to move, while hardly moving. */
  kaijuStuckSeconds: number;
  kaijuLongestStuck: number;
  /** Where the longest stuck spells happened: "stage N at (east, north)" in map coordinates. */
  longestStuckAt: string;
  kaijuLongestStuckAt: string;
  /** Seconds the kaiju spent in water. */
  kaijuWadeSeconds: number;
}

export function createNavWatch(): NavWatch {
  const still: number[] = [];
  const waiting: boolean[] = [];
  let kaijuStill = 0;
  const onDeck = new Map<number, number>();
  const w: NavWatch = {
    seconds: 0,
    unitSeconds: 0,
    stuckSeconds: 0,
    longestStuck: 0,
    giveUps: 0,
    wadeSeconds: 0,
    bridgeSeconds: 0,
    bridgePeak: 0,
    kaijuStuckSeconds: 0,
    kaijuLongestStuck: 0,
    longestStuckAt: '',
    kaijuLongestStuckAt: '',
    kaijuWadeSeconds: 0,
    onTick(world: World): void {
      if (world.match.phase !== 'playing') return;
      w.seconds += DT;
      onDeck.clear();
      for (const u of world.units) {
        if (!u || !u.alive) {
          if (u) still[u.id] = 0;
          continue;
        }
        w.unitSeconds += DT;
        const pushing = Math.hypot(u.control.moveX, u.control.moveZ) > 0.3 && !u.rooted && u.shaken <= 0;
        const speed = Math.hypot(u.vx, u.vz);
        if (pushing && speed < 0.4) {
          still[u.id] = (still[u.id] ?? 0) + DT;
          if (still[u.id] > 1) w.stuckSeconds += DT;
          if (still[u.id] > w.longestStuck) {
            w.longestStuck = still[u.id];
            w.longestStuckAt = `stage ${world.match.stage} at (${Math.round(-u.x)}, ${Math.round(u.z)})`;
          }
        } else {
          still[u.id] = 0;
        }
        const gaveUp = u.nav.wait > 0;
        if (gaveUp && !waiting[u.id]) w.giveUps++;
        waiting[u.id] = gaveUp;
        if (u.inWater) w.wadeSeconds += DT;
        const deck = bridgeAt(world.cityQuery, u.x, u.z);
        if (deck >= 0) {
          w.bridgeSeconds += DT;
          const n = (onDeck.get(deck) ?? 0) + 1;
          onDeck.set(deck, n);
          if (n > w.bridgePeak) w.bridgePeak = n;
        }
      }
      const k = world.kaijus[0];
      if (k && k.alive) {
        const input = world.players[k.player].input;
        const free = k.phase === 'idle';
        const pushing = free && Math.hypot(input.moveX, input.moveZ) > 0.3;
        if (pushing && Math.hypot(k.vx, k.vz) < 0.3) {
          kaijuStill += DT;
          if (kaijuStill > 1) w.kaijuStuckSeconds += DT;
          if (kaijuStill > w.kaijuLongestStuck) {
            w.kaijuLongestStuck = kaijuStill;
            w.kaijuLongestStuckAt = `stage ${world.match.stage} at (${Math.round(-k.x)}, ${Math.round(k.z)})`;
          }
        } else {
          kaijuStill = 0;
        }
        if (k.inWater) w.kaijuWadeSeconds += DT;
      }
    },
  };
  return w;
}

export function navSummary(watches: readonly NavWatch[]): string {
  const sum = (f: (w: NavWatch) => number): number => watches.reduce((a, w) => a + f(w), 0);
  const max = (f: (w: NavWatch) => number): number => watches.reduce((a, w) => Math.max(a, f(w)), 0);
  const unit = sum((w) => w.unitSeconds) || 1;
  const play = sum((w) => w.seconds) || 1;
  const pct = (v: number, of: number): string => `${((100 * v) / of).toFixed(2)}%`;
  const worst = (f: (w: NavWatch) => number, at: (w: NavWatch) => string): string => {
    let best: NavWatch | null = null;
    for (const w of watches) if (!best || f(w) > f(best)) best = w;
    return best && f(best) > 0 ? `${f(best).toFixed(1)} s, ${at(best)}` : '0 s';
  };
  return (
    `navigation over ${watches.length} matches: units stuck ${pct(sum((w) => w.stuckSeconds), unit)} of unit time` +
    ` (longest ${worst((w) => w.longestStuck, (w) => w.longestStuckAt)}), gave up on a goal ${sum((w) => w.giveUps)} times` +
    ` (${(sum((w) => w.giveUps) / watches.length).toFixed(1)} per match), wading ${pct(sum((w) => w.wadeSeconds), unit)}` +
    `, on a bridge ${pct(sum((w) => w.bridgeSeconds), unit)} (at most ${max((w) => w.bridgePeak)} units on one deck)` +
    `; kaiju stuck ${pct(sum((w) => w.kaijuStuckSeconds), play)} of play (longest ${worst((w) => w.kaijuLongestStuck, (w) => w.kaijuLongestStuckAt)})` +
    `, in water ${pct(sum((w) => w.kaijuWadeSeconds), play)}`
  );
}
