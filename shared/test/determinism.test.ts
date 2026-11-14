import { describe, expect, it } from 'vitest';
import {
  BUTTON_MASK,
  COMMAND_IDS,
  createMatchConfig,
  createRng,
  createWorld,
  rngChance,
  rngInt,
  rngRange,
  type PlayerInput,
  type World,
} from '../src/index';
import { createBotWorld, runBotMatch, worldHash } from '../scripts/botMatch';

/**
 * The simulation is deterministic: the same seed, config and inputs give the same state on
 * every tick, on any machine, whatever else has run in the process. Client prediction, replays
 * of a balance run and "it only happened once" bug reports all lean on this.
 */
describe('determinism', () => {
  it('two all-bot matches from the same seed stay identical tick for tick, played side by side', () => {
    // Interleaved, so that anything remembered outside the World (scratch buffers, caches)
    // would show up as a difference at once.
    const a = createBotWorld({ seed: 2024, fast: true });
    const b = createBotWorld({ seed: 2024, fast: true });
    let ticks = 0;
    while (a.match.phase !== 'ended' && ticks < 200 * 30) {
      const ea = a.step();
      const eb = b.step();
      ticks++;
      expect(worldHash(b)).toBe(worldHash(a));
      if (ea.length > 0 || eb.length > 0) expect(JSON.stringify(eb)).toBe(JSON.stringify(ea));
    }
    expect(a.match.phase).toBe('ended');
    expect(b.match.phase).toBe('ended');
    expect(b.match.winner).toBe(a.match.winner);
    // A whole match happened: every stage, bots on both sides, both kinds of fire.
    expect(a.match.stage).toBe(3);
    expect(ticks).toBeGreaterThan(60 * 30);
  });

  it('replays recorded inputs exactly: people at the controls, bots in the other slots', () => {
    const config = createMatchConfig({
      humans: [
        { name: 'K', role: 'kaiju' },
        { name: 'A', role: 'human' },
      ],
      fast: true,
    });
    // Sixty seconds of erratic play, recorded once.
    const rng = createRng(77);
    const tape: Array<Array<PlayerInput | null>> = [];
    const held: PlayerInput[] = [0, 1].map(() => ({ seq: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }));
    for (let t = 0; t < 60 * 30; t++) {
      tape.push(
        held.map((prev, p): PlayerInput | null => {
          if (rngChance(rng, 0.03)) return null;
          const change = rngChance(rng, 0.1);
          const next: PlayerInput = {
            seq: t + 1,
            moveX: change ? rngRange(rng, -1, 1) : prev.moveX,
            moveZ: change ? rngRange(rng, -0.2, 1) : prev.moveZ,
            aimYaw: prev.aimYaw + rngRange(rng, -0.05, 0.05) + (change ? rngRange(rng, -1, 1) : 0),
            aimPitch: rngRange(rng, -0.3, 0.2),
            buttons: change ? rngInt(rng, BUTTON_MASK + 1) : prev.buttons,
          };
          if (p === 1 && rngChance(rng, 0.02)) next.wheel = COMMAND_IDS[rngInt(rng, COMMAND_IDS.length)];
          held[p] = next;
          return next;
        }),
      );
    }
    const play = (): number[] => {
      const world: World = createWorld({ seed: 4711, config: JSON.parse(JSON.stringify(config)) });
      const hashes: number[] = [];
      for (const inputs of tape) {
        if (world.match.phase === 'ended') break;
        world.step(inputs);
        hashes.push(worldHash(world));
      }
      return hashes;
    };
    const first = play();
    // Something else happens in between: another match, with another seed.
    runBotMatch({ seed: 5, fast: true });
    const second = play();
    expect(second.length).toBe(first.length);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(30 * 30);
    // The hash is not asleep: it changes from tick to tick.
    expect(new Set(first).size).toBeGreaterThan(first.length * 0.95);
  });

  it('plays a full-length match to the same report twice, and a different one from another seed', () => {
    const samples = (seed: number): { hashes: number[]; summary: string } => {
      const hashes: number[] = [];
      const { report } = runBotMatch({
        seed,
        onTick: (world) => {
          if (world.tick % 150 === 0) hashes.push(worldHash(world));
        },
      });
      const { wall: _wall, ...rest } = report;
      return { hashes, summary: JSON.stringify(rest) };
    };
    const a = samples(31);
    const b = samples(31);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.summary).toBe(a.summary);
    const c = samples(32);
    expect(c.hashes.slice(0, 20)).not.toEqual(a.hashes.slice(0, 20));
  });
});
