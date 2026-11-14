/**
 * Watches how the bots get about in a match (npm run sim -- --nav): is anybody stuck, how much
 * wading, how crowded do the bridges get. Used to judge a city, not to change anything: it
 * only reads the World after each tick.
 */

import { bridgeAt, DT, formationSpacing, inWater, unitTypeDef, weaponDef, type CityData, type SimEvent, type World } from '../src/index';

/** The open sea (as opposed to a river): a water area named like one. Only Port Meridian has it. */
function seaAreas(city: CityData): Array<Array<{ x: number; z: number }>> {
  return city.areas.filter((a) => a.kind === 'water' && /bay|sea|harbou?r/i.test(a.name)).map((a) => a.polygon);
}

function inside(px: number, pz: number, poly: ReadonlyArray<{ x: number; z: number }>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Seconds of history kept per body to tell going back and forth from getting somewhere. */
const SWAY_WINDOW = 12;
/** In that window: at least this much path, and at most this far from where it was. */
const SWAY_PATH = 40;
const SWAY_NET = 6;
/** Meters of water all round that make it open water. */
const OPEN_SEA = 50;
/** A squad-mate (not planted) further than this many spacings from its leader has fallen behind the swarm. */
const STRAGGLE_SPACINGS = 6;

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
  /** Unit-seconds in the bay (not a river), and of those, out in open water (no land within 50 m). */
  seaSeconds: number;
  openSeaSeconds: number;
  /** Ticks on which some living unit, or the kaiju, stood outside the playable bounds. */
  outsideTicks: number;
  /** Times a unit (or the kaiju) went back and forth: 40 m of path in 12 s for 6 m of progress. */
  sways: number;
  kaijuSways: number;
  /** Squad-seconds, while the kaiju was on the map, a squad bot spent more than 1.5 weapon ranges from it; longest spell. */
  farSeconds: number;
  longestFar: number;
  longestFarAt: string;
  /** Seconds the kaiju bot had nothing to wreck (it wandered toward the middle of the bounds). */
  kaijuAimless: number;
  /** Unit-seconds a squad-mate that is not planted spent more than 6 spacings from its leader; the longest such spell. */
  straggleSeconds: number;
  longestStraggle: number;
  longestStraggleAt: string;
}

export function createNavWatch(): NavWatch {
  const still: number[] = [];
  const waiting: boolean[] = [];
  let kaijuStill = 0;
  const onDeck = new Map<number, number>();
  let sea: Array<Array<{ x: number; z: number }>> | null = null;
  // Per body (units by id, the kaiju as -1): positions once a second, and when it last swayed.
  const trail = new Map<number, number[]>();
  const swayedAt = new Map<number, number>();
  const far: number[] = [];
  const straggle: number[] = [];
  let tick = 0;
  const sway = (id: number, x: number, z: number, moving: boolean): boolean => {
    let t = trail.get(id);
    if (!t) trail.set(id, (t = []));
    if (!moving) {
      t.length = 0;
      return false;
    }
    if (tick % 30 !== 0) return false;
    t.push(x, z);
    if (t.length > (SWAY_WINDOW + 1) * 2) t.splice(0, 2);
    if (t.length < (SWAY_WINDOW + 1) * 2) return false;
    let path = 0;
    for (let i = 2; i < t.length; i += 2) path += Math.hypot(t[i] - t[i - 2], t[i + 1] - t[i - 1]);
    const net = Math.hypot(t[t.length - 2] - t[0], t[t.length - 1] - t[1]);
    if (path < SWAY_PATH || net > SWAY_NET) return false;
    if (tick - (swayedAt.get(id) ?? -1e9) < SWAY_WINDOW * 30) return false;
    swayedAt.set(id, tick);
    return true;
  };
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
    seaSeconds: 0,
    openSeaSeconds: 0,
    outsideTicks: 0,
    sways: 0,
    kaijuSways: 0,
    farSeconds: 0,
    longestFar: 0,
    longestFarAt: '',
    kaijuAimless: 0,
    straggleSeconds: 0,
    longestStraggle: 0,
    longestStraggleAt: '',
    onTick(world: World): void {
      if (world.match.phase !== 'playing') {
        trail.clear();
        far.length = 0;
        straggle.length = 0;
        return;
      }
      sea ??= seaAreas(world.city);
      tick++;
      w.seconds += DT;
      onDeck.clear();
      const b = world.match.bounds;
      let outside = false;
      for (const u of world.units) {
        if (!u || !u.alive) {
          if (u) {
            still[u.id] = 0;
            straggle[u.id] = 0;
          }
          continue;
        }
        w.unitSeconds += DT;
        // A driven tank's stick is throttle and turn: turning on the spot is not pushing to go anywhere.
        const tank = world.squads[u.squad].driven === u.id && unitTypeDef(u.type).drive !== undefined;
        const push = tank ? Math.abs(u.control.moveZ) : Math.hypot(u.control.moveX, u.control.moveZ);
        const pushing = push > 0.3 && !u.rooted && u.shaken <= 0 && u.stun <= 0;
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
        // Squad-mates that have fallen out of the swarm (planted ones stay where they are on purpose).
        const squad = world.squads[u.squad];
        const leader = squad.driven >= 0 ? world.units[squad.driven] : null;
        if (leader && leader.alive && leader !== u && !u.rooted && Math.hypot(u.x - leader.x, u.z - leader.z) > STRAGGLE_SPACINGS * formationSpacing(u)) {
          straggle[u.id] = (straggle[u.id] ?? 0) + DT;
          w.straggleSeconds += DT;
          if (straggle[u.id] > w.longestStraggle) {
            w.longestStraggle = straggle[u.id];
            w.longestStraggleAt = `stage ${world.match.stage}, unit ${u.id} ${Math.round(Math.hypot(u.x - leader.x, u.z - leader.z))} m from its leader at (${Math.round(-leader.x)}, ${Math.round(leader.z)})`;
          }
        } else {
          straggle[u.id] = 0;
        }
        const gaveUp = u.nav.wait > 0;
        if (gaveUp && !waiting[u.id]) w.giveUps++;
        waiting[u.id] = gaveUp;
        if (u.inWater) {
          w.wadeSeconds += DT;
          if (sea.some((poly) => inside(u.x, u.z, poly)) && inWater(world.cityQuery, u.x, u.z) && bridgeAt(world.cityQuery, u.x, u.z) < 0) {
            w.seaSeconds += DT;
            // Out in open water: no land within OPEN_SEA meters in any of eight directions.
            let open = true;
            for (let i = 0; i < 8 && open; i++) {
              const a = (i / 8) * Math.PI * 2;
              if (!inWater(world.cityQuery, u.x + Math.sin(a) * OPEN_SEA, u.z + Math.cos(a) * OPEN_SEA)) open = false;
            }
            if (open) w.openSeaSeconds += DT;
          }
        }
        if (u.x < b.minX - 0.01 || u.x > b.maxX + 0.01 || u.z < b.minZ - 0.01 || u.z > b.maxZ + 0.01) outside = true;
        if (sway(u.id, u.x, u.z, pushing)) w.sways++;
        const deck = bridgeAt(world.cityQuery, u.x, u.z);
        if (deck >= 0) {
          w.bridgeSeconds += DT;
          const n = (onDeck.get(deck) ?? 0) + 1;
          onDeck.set(deck, n);
          if (n > w.bridgePeak) w.bridgePeak = n;
        }
      }
      const k = world.kaijus[0];
      // Squad bots that hang back: their leader more than 1.5 weapon ranges from a kaiju on the map.
      for (const squad of world.squads) {
        const p = world.players[squad.player];
        const leader = squad.driven >= 0 ? world.units[squad.driven] : null;
        if (!k || !k.alive || !k.known || !p || !p.bot || squad.eliminated || !leader || !leader.alive) {
          far[squad.id] = 0;
          continue;
        }
        const range = weaponDef(unitTypeDef(leader.type).weapon).range;
        if (Math.hypot(leader.x - k.x, leader.z - k.z) - k.radius > 1.5 * range) {
          far[squad.id] = (far[squad.id] ?? 0) + DT;
          w.farSeconds += DT;
          if (far[squad.id] > w.longestFar) {
            w.longestFar = far[squad.id];
            w.longestFarAt = `stage ${world.match.stage}, squad ${squad.id} at (${Math.round(-leader.x)}, ${Math.round(leader.z)}), kaiju at (${Math.round(-k.x)}, ${Math.round(k.z)})`;
          }
        } else {
          far[squad.id] = 0;
        }
      }
      if (k && k.alive) {
        if (k.x < b.minX - 0.01 || k.x > b.maxX + 0.01 || k.z < b.minZ - 0.01 || k.z > b.maxZ + 0.01) outside = true;
        const kp = world.players[k.player];
        if (kp && kp.bot && kp.botState.goal === 'point') w.kaijuAimless += DT;
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
        if (sway(-1, k.x, k.z, pushing)) w.kaijuSways++;
      }
      if (outside) w.outsideTicks++;
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
    `, in water ${pct(sum((w) => w.kaijuWadeSeconds), play)}` +
    `\n  in the bay ${pct(sum((w) => w.seaSeconds), unit)} of unit time (out in open water ${pct(sum((w) => w.openSeaSeconds), unit)}); outside the bounds on ${sum((w) => w.outsideTicks)} ticks` +
    `; back and forth: units ${sum((w) => w.sways)} times, kaiju ${sum((w) => w.kaijuSways)} times` +
    `; squads beyond 1.5 ranges of a kaiju on the map ${pct(sum((w) => w.farSeconds), play * 4)} of squad time (longest ${worst((w) => w.longestFar, (w) => w.longestFarAt)})` +
    `; kaiju with nothing to wreck ${pct(sum((w) => w.kaijuAimless), play)} of play` +
    `\n  squad-mates out of the swarm (more than ${STRAGGLE_SPACINGS} spacings from the leader, not planted) ${pct(sum((w) => w.straggleSeconds), unit)} of unit time (longest ${worst((w) => w.longestStraggle, (w) => w.longestStraggleAt)})`
  );
}
