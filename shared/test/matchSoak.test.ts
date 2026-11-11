import { describe, expect, it } from 'vitest';
import { boundsContains, MATCH_RULES, SIM_EVENT_TYPES, TICK_RATE, type SimEvent, type World } from '../src/index';
import { runBotMatch, type BotMatchReport } from '../scripts/botMatch';

/**
 * Soak: whole bot-versus-bot matches, start to finish, with the invariants checked as they go.
 * Nothing may throw, no number may go bad, nothing may pile up, and every match must end the
 * way the rules say a match ends.
 */
const KNOWN: readonly string[] = SIM_EVENT_TYPES;

function checkWorld(world: World, events: SimEvent[], peak: { events: number }): void {
  if (events.length > peak.events) peak.events = events.length;
  for (const e of events) {
    expect(KNOWN).toContain(e.type);
    expect(e.tick).toBe(world.tick);
  }
  // The full sweep is not needed every tick; ten times a second catches anything that lasts.
  if (world.tick % 3 !== 0) return;
  const m = world.match;
  const b = m.bounds;
  expect(Number.isFinite(m.barPoints) && Number.isFinite(m.clock) && Number.isFinite(m.phaseTime)).toBe(true);
  expect(m.clock).toBeGreaterThanOrEqual(0);
  expect(world.kaijus.length).toBe(1);
  expect(world.units.length).toBe(MATCH_RULES.squadsPerKaiju * MATCH_RULES.unitsPerSquad);
  for (const k of world.kaijus) {
    for (const v of [k.x, k.z, k.yaw, k.vx, k.vz, k.hp, k.nerve, k.rage, k.aimYaw, k.aimPitch, k.phaseTime]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(k.hp).toBeLessThanOrEqual(k.maxHp);
    expect(k.rage).toBeGreaterThanOrEqual(0);
    expect(boundsContains(b, k.x, k.z, k.radius - 1e-6)).toBe(true);
  }
  for (const u of world.units) {
    for (const v of [u.x, u.z, u.yaw, u.vx, u.vz, u.hp, u.aimYaw, u.aimPitch, u.charge, u.cooldown, u.nerve]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(boundsContains(b, u.x, u.z, u.radius - 1e-6)).toBe(true);
    expect(u.charge).toBeGreaterThanOrEqual(0);
    expect(u.charge).toBeLessThanOrEqual(1);
  }
  for (const p of world.projectiles) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
  }
  for (const p of world.players) {
    expect(Number.isFinite(p.botInput.moveX) && Number.isFinite(p.botInput.moveZ) && Number.isFinite(p.botInput.aimYaw)).toBe(true);
  }
  // Nothing piles up.
  expect(world.projectiles.length).toBeLessThan(400);
  expect(world.callIns.length).toBeLessThanOrEqual(world.squads.length);
  expect(world.hits.length).toBe(0);
  expect(world.structureHits.length).toBe(0);
  expect(world.propHits.length).toBe(0);
  for (const k of world.kaijus) expect(k.recentHits.length).toBeLessThanOrEqual(world.units.length);
  for (const squad of world.squads) expect(squad.trail.length).toBeLessThan(200);
}

function play(seed: number, fast: boolean): { report: BotMatchReport; peakEvents: number } {
  const peak = { events: 0 };
  const { report, world } = runBotMatch({ seed, fast, onTick: (w, events) => checkWorld(w, events, peak) });
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
    const wanted = ['projectileSpawn', 'projectileHit', 'structureStage', 'propsDestroyed', 'kaijuAction', 'kaijuHit', 'volley', 'moltAvailable', 'cocoon', 'moltBlast', 'stageChange', 'barMark', 'matchPhase', 'voice', 'matchEnd', 'callin', 'unitHit'];
    expect(wanted.filter((type) => !seen.has(type))).toEqual([]);
  });
});
