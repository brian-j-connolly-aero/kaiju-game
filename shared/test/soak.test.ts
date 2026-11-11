import { describe, expect, it } from 'vitest';
import {
  beginStage,
  boundsContains,
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
            buttons: change ? rngInt(rng, BUTTON_MASK + 1) : prev.buttons,
          };
          if (p > 0 && rngChance(rng, 0.01)) {
            next.wheel = COMMAND_IDS[rngInt(rng, COMMAND_IDS.length)];
            if (rngChance(rng, 0.5)) next.marker = { x: rngRange(rng, -1100, 1100), z: rngRange(rng, -1100, 1100) };
          }
          held[p] = next;
          return next;
        });
        const events = world.step(inputs);
        eventCount += events.length;
        for (const e of events) {
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
    // The kaiju walked through things: props at every stage, buildings once it was big enough.
    expect(eventCount).toBeGreaterThan(50);
    expect(wrecked).toBeGreaterThan(5);
    expect(world.match.barPoints).toBeGreaterThan(0);
    expect(world.players[0].tally.barPoints).toBeGreaterThan(0);
  });
});
