import { describe, expect, it } from 'vitest';
import {
  boundsContains,
  decodeSnapshot,
  encodeSnapshot,
  MATCH_RULES,
  SIM_EVENT_TYPES,
  snapshotOfWorld,
  TICK_RATE,
  type SimEvent,
  type World,
} from '../src/index';
import { runBotMatch, type BotMatchReport } from '../scripts/botMatch';
import { createNavWatch } from '../scripts/navWatch';

/**
 * Soak: whole bot-versus-bot matches, start to finish, with the invariants checked as they go.
 * Nothing may throw, no number may go bad, nothing may pile up, and every match must end the
 * way the rules say a match ends.
 */
const KNOWN: readonly string[] = SIM_EVENT_TYPES;

/**
 * Looks the world over and writes down anything wrong. (Plain checks: an assertion per number
 * per tick would take longer than the matches themselves.)
 */
function checkWorld(world: World, events: SimEvent[], peak: { events: number }, problems: string[]): void {
  if (problems.length > 20) return;
  const bad = (what: string): void => {
    problems.push(`tick ${world.tick}: ${what}`);
  };
  if (events.length > peak.events) peak.events = events.length;
  for (const e of events) {
    if (!KNOWN.includes(e.type)) bad(`unknown event ${e.type}`);
    if (e.tick !== world.tick) bad(`event ${e.type} stamped ${e.tick}`);
  }
  // What goes over the wire stays sendable through every phase, the molt included: events
  // survive JSON, and the snapshot survives its codec.
  if (events.length > 0 && JSON.stringify(JSON.parse(JSON.stringify(events))) !== JSON.stringify(events)) bad('events do not survive JSON');
  if (world.tick % 15 === 0) {
    const snap = decodeSnapshot(encodeSnapshot(snapshotOfWorld(world)));
    if (snap.tick !== world.tick || snap.match.phase !== world.match.phase || snap.match.stage !== world.match.stage) bad('snapshot header');
    if (snap.kaijus[0].stage !== world.kaijus[0].stage || snap.kaijus[0].phase !== world.kaijus[0].phase) bad('snapshot kaiju');
    if (snap.units.length !== world.units.length) bad('snapshot units');
  }
  // The full sweep is not needed every tick; ten times a second catches anything that lasts.
  if (world.tick % 3 !== 0) return;
  const m = world.match;
  const b = m.bounds;
  const finite = (name: string, values: number[]): void => {
    for (const v of values) if (!Number.isFinite(v)) bad(`${name} has a number that is not finite`);
  };
  finite('match', [m.barPoints, m.clock, m.phaseTime, m.elapsed]);
  if (m.clock < 0) bad('clock below zero');
  if (world.kaijus.length !== 1) bad(`${world.kaijus.length} kaiju`);
  if (world.units.length !== MATCH_RULES.squadsPerKaiju * MATCH_RULES.unitsPerSquad) bad(`${world.units.length} units`);
  for (const k of world.kaijus) {
    finite('kaiju', [k.x, k.z, k.yaw, k.vx, k.vz, k.hp, k.nerve, k.rage, k.aimYaw, k.aimPitch, k.phaseTime]);
    if (k.hp > k.maxHp) bad('kaiju hp above its maximum');
    if (k.rage < 0) bad('negative rage');
    if (!boundsContains(b, k.x, k.z, k.radius - 1e-6)) bad('kaiju outside the bounds');
    if (k.recentHits.length > world.units.length) bad('recent hits pile up');
  }
  for (const u of world.units) {
    finite(`unit ${u.id}`, [u.x, u.z, u.yaw, u.vx, u.vz, u.hp, u.aimYaw, u.aimPitch, u.charge, u.cooldown, u.nerve]);
    if (!boundsContains(b, u.x, u.z, u.radius - 1e-6)) bad(`unit ${u.id} outside the bounds`);
    if (u.charge < 0 || u.charge > 1) bad(`unit ${u.id} charge ${u.charge}`);
  }
  for (const p of world.projectiles) finite(`projectile ${p.id}`, [p.x, p.y, p.z, p.vx, p.vy, p.vz]);
  for (const p of world.players) finite(`bot input ${p.id}`, [p.botInput.moveX, p.botInput.moveZ, p.botInput.aimYaw, p.botInput.aimPitch]);
  // Nothing piles up.
  if (world.projectiles.length >= 400) bad(`${world.projectiles.length} projectiles`);
  if (world.callIns.length > world.squads.length) bad(`${world.callIns.length} call-ins`);
  if (world.hits.length + world.structureHits.length + world.propHits.length > 0) bad('a damage queue was not drained');
  // A squad's trail keeps the last 400 m of its leader's way (sim/squads.ts), sampled every 2 m.
  for (const squad of world.squads) if (squad.trail.length > 210) bad(`squad ${squad.id} trail ${squad.trail.length}`);
}

function play(seed: number, fast: boolean): { report: BotMatchReport; peakEvents: number } {
  const peak = { events: 0 };
  const problems: string[] = [];
  const watch = createNavWatch();
  const { report, world } = runBotMatch({
    seed,
    fast,
    onTick: (w, events) => {
      checkWorld(w, events, peak, problems);
      watch.onTick(w, events);
    },
  });
  expect(problems).toEqual([]);
  // Nobody is ever wedged for long: not the kaiju bot (it smashes or backs out of what holds it)
  // and not a unit; and nobody ever stands outside the quarantine line.
  expect(watch.kaijuLongestStuck, `kaiju stuck at ${watch.kaijuLongestStuckAt}`).toBeLessThan(20);
  expect(watch.longestStuck, `unit stuck at ${watch.longestStuckAt}`).toBeLessThan(20);
  expect(watch.outsideTicks).toBe(0);
  const clock = world.config.tuning.clock;

  // It ended, the way matches end.
  expect(report.finished).toBe(true);
  expect(['kaiju', 'humans']).toContain(report.winner);
  if (report.winner === 'kaiju') {
    expect(report.reason).toBe('bar');
    expect(world.match.marksReached).toBe(3);
  } else if (report.reason === 'kill') {
    expect(world.kaijus[0].alive).toBe(false);
  } else {
    expect(report.reason).toBe('clock');
    expect(world.match.clock).toBe(0);
  }
  // Never longer than the clock; the ticks beyond it are the briefing and the intermissions.
  expect(report.length).toBeLessThanOrEqual(clock + 1e-6);
  expect(report.ticks).toBeLessThanOrEqual((clock + world.config.tuning.briefing + 2 * world.config.tuning.intermission) * TICK_RATE + 5);
  expect(report.stages[0].reached).toBe(true);
  expect(report.stages.reduce((sum, s) => sum + s.time, 0)).toBeCloseTo(report.length, 3);
  // Entity counts stayed sane all match, and no tick drowned the wire in events.
  expect(report.peakProjectiles).toBeLessThan(400);
  expect(report.peakCallIns).toBeLessThanOrEqual(4);
  expect(peak.events).toBeLessThan(400);
  // Both sides did something.
  expect(world.players[0].tally.barPoints).toBeGreaterThan(0);
  expect(report.eventCounts.projectileSpawn ?? 0).toBeGreaterThan(0);
  return { report, peakEvents: peak.events };
}

describe('full bot matches (soak)', () => {
  for (const seed of [101, 102, 103]) {
    it(`plays a full-length match from seed ${seed} to its end with every invariant intact`, () => {
      const { report } = play(seed, false);
      // A real match: the first stage was fought over.
      expect(report.length).toBeGreaterThan(120);
      expect(report.stages[0].volleys).toBeGreaterThan(0);
    });
  }

  it('plays six fast matches to their ends, and between them sees the whole game', () => {
    const reports = [201, 202, 203, 204, 205, 206].map((seed) => play(seed, true).report);
    // The short clock still fits all three stages for most of them.
    expect(reports.filter((r) => r.stages[2].reached).length).toBeGreaterThanOrEqual(3);
    const seen = new Set<string>();
    for (const r of reports) for (const type of Object.keys(r.eventCounts)) seen.add(type);
    // Phase 2: supply crates, the artillery radio's barrages and buildings falling over too.
    const wanted = ['projectileSpawn', 'projectileHit', 'structureStage', 'propsDestroyed', 'kaijuAction', 'kaijuHit', 'volley', 'moltAvailable', 'cocoon', 'moltOffer', 'moltPick', 'moltBlast', 'stageChange', 'barMark', 'matchPhase', 'voice', 'matchEnd', 'unitHit', 'crate', 'callin', 'structureFall'];
    expect(wanted.filter((type) => !seen.has(type))).toEqual([]);
  });
});
