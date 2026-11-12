/**
 * Plays one whole bot-versus-bot match as fast as the machine allows and reports what happened:
 * the numbers the balance work is steered by (DESIGN.md section 2, tuning targets). Used by
 * `npm run sim` (scripts/sim.ts) and by the determinism and soak tests.
 */

import {
  barDisplayFraction,
  createMatchConfig,
  createWorld,
  TICK_RATE,
  type BuiltCity,
  type EndReason,
  type SimEvent,
  type Winner,
  type World,
} from '../src/index';

export interface BotMatchOptions {
  seed: number;
  /** Starting neighborhood anchor, or -1 for the one the seed picks. */
  anchor?: number;
  /** The short `MB_FAST` timers and small bar. */
  fast?: boolean;
  /** Bot handicaps, 0 (best) to 1 (stands still). */
  kaijuHandicap?: number;
  humanHandicap?: number;
  /** Squad bots hold the trigger instead of charging volleys (MatchConfig.bots.triggerHappy). */
  triggerHappy?: boolean;
  /** Human squads in the match (default 4); 0 leaves the kaiju alone in the city. */
  squads?: number;
  /** Give up after this many simulated minutes (a match always ends by its clock well before). */
  maxMinutes?: number;
  /** Called after every tick, with that tick's events. */
  onTick?: (world: World, events: SimEvent[]) => void;
  /** Play in this city instead of the default one (Port Meridian; for example the placeholder grid, see sim.ts --city). */
  city?: BuiltCity;
}

/** What happened in one stage of a match. */
export interface StageReport {
  /** The stage was played at all. */
  reached: boolean;
  /** Seconds of play in the stage, the cocoon included. */
  time: number;
  /** Seconds from the start of the stage until the molt was offered and until the cocoon closed (-1: never). */
  moltOffered: number;
  cocoonAt: number;
  /** Kaiju nerve breaks. */
  staggers: number;
  unitsLost: number;
  /** Volleys the squads fired. */
  volleys: number;
  /** Hp the kaiju lost (healing not subtracted). */
  kaijuHpLost: number;
  /** Hp the kaiju got back by eating. */
  kaijuHpHealed: number;
  /** Bar points when the stage ended, and where that is along the skyline display (0..1). */
  barPoints: number;
  barDisplay: number;
  /** Bar points added during the stage by the squads' own fire. */
  collateral: number;
}

export interface BotMatchReport {
  seed: number;
  anchor: number;
  anchorName: string;
  finished: boolean;
  winner: Winner;
  reason: EndReason;
  /** Seconds of play (clock time used). */
  length: number;
  stages: [StageReport, StageReport, StageReport];
  marks: [number, number, number];
  /** Voice cues emitted, and the most that went out in any ten seconds of play. */
  voiceCues: number;
  voicePeak10s: number;
  ticks: number;
  /** Wall-clock seconds the simulation took. */
  wall: number;
  /** Events by type. */
  eventCounts: Record<string, number>;
  /** The most entities alive at once (a runaway count is a bug). */
  peakProjectiles: number;
  peakCallIns: number;
}

function emptyStage(): StageReport {
  return {
    reached: false,
    time: 0,
    moltOffered: -1,
    cocoonAt: -1,
    staggers: 0,
    unitsLost: 0,
    volleys: 0,
    kaijuHpLost: 0,
    kaijuHpHealed: 0,
    barPoints: 0,
    barDisplay: 0,
    collateral: 0,
  };
}

/** Creates the all-bot world a harness match is played in. */
export function createBotWorld(o: BotMatchOptions): World {
  const config = createMatchConfig({
    anchor: o.anchor ?? -1,
    fast: o.fast ?? false,
    squads: o.squads,
    bots: { kaijuHandicap: o.kaijuHandicap ?? 0, humanHandicap: o.humanHandicap ?? 0, triggerHappy: o.triggerHappy ?? false },
  });
  return createWorld({ seed: o.seed, config, city: o.city });
}

/** Plays the match to its end and returns the report (and the world, for whoever wants to look). */
export function runBotMatch(o: BotMatchOptions): { report: BotMatchReport; world: World } {
  const world = createBotWorld(o);
  const m = world.match;
  const stages: [StageReport, StageReport, StageReport] = [emptyStage(), emptyStage(), emptyStage()];
  stages[0].reached = true;
  const counts: Record<string, number> = {};
  const maxTicks = (o.maxMinutes ?? 20) * 60 * TICK_RATE;
  const humanBar = (): number => world.players.reduce((sum, p) => sum + (p.role === 'human' ? p.tally.barPoints : 0), 0);

  let stage = 0;
  let prevHp = world.kaijus[0]?.hp ?? 0;
  let collateralBase = 0;
  let peakProjectiles = 0;
  let peakCallIns = 0;
  let voiceCues = 0;
  let voicePeak = 0;
  const voiceTimes: number[] = [];
  const closeStage = (): void => {
    const s = stages[stage];
    s.time = m.stageTime[stage];
    s.barPoints = m.barPoints;
    s.barDisplay = barDisplayFraction(m.barPoints, m.marks);
    s.collateral = humanBar() - collateralBase;
    collateralBase = humanBar();
  };

  const started = performance.now();
  while (m.phase !== 'ended' && world.tick < maxTicks) {
    const events = world.step();
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      const s = stages[stage];
      switch (e.type) {
        case 'nerveBreak':
          s.staggers++;
          break;
        case 'unitDestroyed':
          s.unitsLost++;
          break;
        case 'volley':
          s.volleys++;
          break;
        case 'moltAvailable':
          if (s.moltOffered < 0) s.moltOffered = m.stageTime[stage];
          break;
        case 'cocoon':
          s.cocoonAt = m.stageTime[stage];
          break;
        case 'matchPhase':
          // The stage is over when its intermission begins.
          if (e.phase === 'intermission') closeStage();
          break;
        case 'stageChange':
          stage = e.stage - 1;
          stages[stage].reached = true;
          prevHp = world.kaijus[0]?.hp ?? 0;
          break;
        case 'voice':
          voiceCues++;
          // Wall time of the match, intermissions included (the clock stands still in those).
          voiceTimes.push(world.tick / TICK_RATE);
          while (voiceTimes.length > 0 && voiceTimes[0] < world.tick / TICK_RATE - 10) voiceTimes.shift();
          if (voiceTimes.length > voicePeak) voicePeak = voiceTimes.length;
          break;
        default:
          break;
      }
    }
    const k = world.kaijus[0];
    if (k && m.phase === 'playing') {
      if (k.hp < prevHp) stages[stage].kaijuHpLost += prevHp - k.hp;
      else if (k.hp > prevHp) stages[stage].kaijuHpHealed += k.hp - prevHp;
      prevHp = k.hp;
    } else if (k) {
      prevHp = k.hp;
    }
    if (world.projectiles.length > peakProjectiles) peakProjectiles = world.projectiles.length;
    if (world.callIns.length > peakCallIns) peakCallIns = world.callIns.length;
    o.onTick?.(world, events);
  }
  const wall = (performance.now() - started) / 1000;
  closeStage();

  return {
    world,
    report: {
      seed: o.seed,
      anchor: m.anchor,
      anchorName: world.city.anchors[m.anchor]?.name ?? '?',
      finished: m.phase === 'ended',
      winner: m.winner,
      reason: m.endReason,
      length: m.elapsed,
      stages,
      marks: [m.marks[0], m.marks[1], m.marks[2]],
      voiceCues,
      voicePeak10s: voicePeak,
      ticks: world.tick,
      wall,
      eventCounts: counts,
      peakProjectiles,
      peakCallIns,
    },
  };
}

/**
 * A number that changes when anything about the state of a match does: positions, health,
 * nerve, the city, the bar, the generator. Two worlds stepped with the same seed and the same
 * inputs must have the same hash on every tick.
 */
export function worldHash(world: World): number {
  let h = 0x811c9dc5;
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  const mix = (v: number): void => {
    f64[0] = v;
    h = Math.imul(h ^ u32[0], 0x01000193) >>> 0;
    h = Math.imul(h ^ u32[1], 0x01000193) >>> 0;
  };
  const m = world.match;
  mix(world.tick);
  mix(world.rng.s);
  mix(m.stage);
  mix(m.clock);
  mix(m.phaseTime);
  mix(m.barPoints);
  mix(m.marksReached);
  mix(m.breaks);
  mix(m.kills);
  for (const k of world.kaijus) {
    for (const v of [k.x, k.z, k.yaw, k.vx, k.vz, k.aimYaw, k.aimPitch, k.hp, k.nerve, k.rage, k.phaseTime, k.stage, k.nerveImmune]) mix(v);
    mix(k.alive ? 1 : 0);
    mix(k.held ? 1 : 0);
  }
  for (const u of world.units) {
    for (const v of [u.x, u.z, u.yaw, u.vx, u.vz, u.aimYaw, u.aimPitch, u.hp, u.nerve, u.shaken, u.charge, u.cooldown, u.members]) mix(v);
    mix(u.alive ? 1 : 0);
    mix(u.rooted ? 1 : 0);
  }
  for (const s of world.squads) {
    mix(s.driven);
    mix(s.eliminated ? 1 : 0);
    for (const c of s.callInCooldowns) mix(c);
  }
  for (const p of world.projectiles) for (const v of [p.id, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.ttl]) mix(v);
  for (const c of world.callIns) for (const v of [c.id, c.x, c.z, c.timer, c.shellsLeft]) mix(v);
  for (let i = 0; i < world.structureHp.length; i++) mix(world.structureHp[i]);
  for (let i = 0; i < world.propAlive.length; i++) h = Math.imul(h ^ world.propAlive[i], 0x01000193) >>> 0;
  for (let i = 0; i < world.propWreck.length; i++) h = Math.imul(h ^ world.propWreck[i], 0x01000193) >>> 0;
  for (const p of world.players) {
    mix(p.tally.barPoints);
    mix(p.tally.damageDealt);
    mix(p.input.buttons);
  }
  return h >>> 0;
}
