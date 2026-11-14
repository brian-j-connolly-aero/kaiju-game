import { describe, expect, it } from 'vitest';
import {
  beginStage,
  boundsContains,
  Btn,
  BUTTON_MASK,
  COMMAND_IDS,
  createMatchConfig,
  createRng,
  createWorld,
  decodeSnapshot,
  encodeSnapshot,
  rngChance,
  rngInt,
  rngRange,
  SIM_EVENT_TYPES,
  snapshotOfWorld,
  structureContact,
  structuresInCircle,
  type PlayerInput,
  type World,
} from '../src/index';

/**
 * Whole-pipeline soak: five erratic players (random sticks, random buttons, random commands)
 * on the real city at every stage. Nothing may throw, go non-finite, escape the bounds or end
 * up inside a wall, whatever the inputs are.
 */
/**
 * Random buttons from one draw of 0..255: the first eight buttons as drawn, and smoke and mark
 * (added later) pressed together with some of them, so that the draws, and so the rest of the
 * chaos, stay what they were before those two buttons existed.
 */
function chaosButtons(v: number): number {
  return (v | ((v & 0x81) === 0x81 ? Btn.smoke : 0) | ((v & 0x42) === 0x42 ? Btn.mark : 0)) & BUTTON_MASK;
}

describe('simulation soak with random inputs', () => {
  function checkInvariants(world: World, lastBar: number): void {
    const b = world.match.bounds;
    for (const k of world.kaijus) {
      for (const v of [k.x, k.z, k.yaw, k.vx, k.vz, k.hp, k.nerve, k.rage, k.aimYaw, k.aimPitch]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(boundsContains(b, k.x, k.z, k.radius - 1e-6)).toBe(true);
    }
    const ids: number[] = [];
    for (const u of world.units) {
      for (const v of [u.x, u.z, u.yaw, u.vx, u.vz, u.hp, u.aimYaw, u.aimPitch]) expect(Number.isFinite(v)).toBe(true);
      expect(boundsContains(b, u.x, u.z, u.radius - 1e-6)).toBe(true);
      // Units never trample: they may touch a wall but not sink into it.
      structuresInCircle(world.cityQuery, u.x, u.z, u.radius - 0.3, ids);
      for (const id of ids) {
        if (world.cityIndex.spassable[id] === 1) continue;
        expect(structureContact(world.cityIndex, id, u.x, u.z, u.radius - 0.3)).toBe(false);
      }
    }
    expect(world.match.barPoints).toBeGreaterThanOrEqual(lastBar);
    expect(Number.isFinite(world.match.barPoints)).toBe(true);

    // The human side: squads, charge, cooldowns, things in flight.
    for (const u of world.units) {
      expect(u.charge).toBeGreaterThanOrEqual(0);
      expect(u.charge).toBeLessThanOrEqual(1);
      expect(u.cooldown).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(u.cooldown) && Number.isFinite(u.arcYaw) && Number.isFinite(u.nav.holdX) && Number.isFinite(u.nav.holdZ)).toBe(true);
      expect(Number.isFinite(u.control.moveX) && Number.isFinite(u.control.moveZ) && Number.isFinite(u.control.aimYaw) && Number.isFinite(u.control.aimPitch)).toBe(true);
      if (!u.alive) expect([u.rooted, u.charge, u.state]).toEqual([false, 0, 'dead']);
      // Only a planted sub-unit shows a laser; the unit a player drives is never planted.
      if (u.state === 'charging') expect(u.rooted && world.squads[u.squad].driven !== u.id).toBe(true);
    }
    for (const squad of world.squads) {
      const living = squad.units.filter((id) => world.units[id].alive).length;
      expect(squad.eliminated).toBe(living === 0);
      expect(squad.driven < 0).toBe(squad.eliminated);
      if (!squad.eliminated) expect(squad.units).toContain(squad.driven);
      for (const c of squad.callInCooldowns) expect(c).toBeGreaterThanOrEqual(0);
    }
    // Nothing piles up: every projectile ends (a hit, the edge of the city, or its time running out).
    expect(world.projectiles.length).toBeLessThan(400);
    expect(world.callIns.length).toBeLessThanOrEqual(world.squads.length);
    for (const p of world.projectiles) expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
  }

  it('survives 60 seconds of chaos at each stage', () => {
    const config = createMatchConfig({
      humans: [
        { name: 'K', role: 'kaiju' },
        { name: 'A', role: 'human' },
        { name: 'B', role: 'human' },
        { name: 'C', role: 'human' },
        { name: 'D', role: 'human' },
      ],
    });
    config.tuning.briefing = 0;
    const world = createWorld({ seed: 31337, config });
    const rng = createRng(4242);
    const known: readonly string[] = SIM_EVENT_TYPES;
    const held: PlayerInput[] = config.players.map(() => ({ seq: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }));
    let eventCount = 0;
    let wrecked = 0;
    const seen = new Set<string>();

    for (const stage of [1, 2, 3] as const) {
      if (stage > 1) beginStage(world, stage);
      let lastBar = world.match.barPoints;
      for (let t = 0; t < 30 * 60; t++) {
        const inputs = held.map((prev, p): PlayerInput | null => {
          // Now and then a player's packet is late.
          if (rngChance(rng, 0.05)) return null;
          const change = rngChance(rng, 0.08);
          const next: PlayerInput = {
            seq: world.tick,
            moveX: change ? rngRange(rng, -1, 1) : prev.moveX,
            moveZ: change ? rngRange(rng, -0.3, 1) : prev.moveZ,
            aimYaw: prev.aimYaw + rngRange(rng, -0.08, 0.08) + (change ? rngRange(rng, -1.5, 1.5) : 0),
            aimPitch: rngRange(rng, -0.4, 0.3),
            buttons: change ? chaosButtons(rngInt(rng, 256)) : prev.buttons,
          };
          if (p > 0 && rngChance(rng, 0.01)) {
            next.wheel = COMMAND_IDS[rngInt(rng, COMMAND_IDS.length)];
            if (rngChance(rng, 0.5)) next.marker = { x: rngRange(rng, -1100, 1100), z: rngRange(rng, -1100, 1100) };
          }
          held[p] = next;
          return next;
        });
        // Now and then a unit is destroyed outright, the way a blast wave or a thrown bus would do it.
        if (rngChance(rng, 0.004)) {
          const id = rngInt(rng, world.units.length);
          world.hits.push({
            target: { entity: 'unit', id },
            hit: { damage: Infinity, nerve: 0, fromDir: { x: 0, z: 0 }, sourceId: 0, player: 0, kind: 'blast', atWill: false },
          });
        }
        const events = world.step(inputs);
        eventCount += events.length;
        for (const e of events) {
          seen.add(e.type);
          expect(known).toContain(e.type);
          expect(e.tick).toBe(world.tick);
          if (e.type === 'structureStage' && e.stage === 3) wrecked++;
        }
        if (t % 15 === 0) {
          checkInvariants(world, lastBar);
          lastBar = world.match.barPoints;
          const bytes = encodeSnapshot(snapshotOfWorld(world));
          expect(decodeSnapshot(bytes).tick).toBe(world.tick);
        }
        if (world.match.phase === 'ended') break;
      }
      expect(world.match.stage).toBe(stage);
    }
    // The squads did their part of the chaos too: shots, volleys, call-ins, lost units, takeovers.
    const wanted = ['projectileSpawn', 'projectileHit', 'volley', 'callin', 'smoke', 'kaijuHit', 'unitDestroyed', 'takeover'];
    expect(wanted.filter((type) => !seen.has(type))).toEqual([]);
    // The kaiju walked through things: props at every stage, buildings once it was big enough.
    expect(eventCount).toBeGreaterThan(50);
    expect(wrecked).toBeGreaterThan(5);
    expect(world.match.barPoints).toBeGreaterThan(0);
    expect(world.players[0].tally.barPoints).toBeGreaterThan(0);
  });
});
