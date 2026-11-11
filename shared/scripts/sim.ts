/**
 * npm run sim [-- --seed N --matches N --anchor N --fast --max-minutes N]
 *
 * Headless bot-versus-bot match: creates a World with every slot played by a bot, steps it to
 * the end as fast as the machine allows, and prints the balance metrics (ARCHITECTURE.md
 * section 6): winner, match length, time per stage, nerve breaks, kills.
 *
 * STUB(sim): this is the harness shell. Worker 3 (balance harness) extends the report as the
 * systems land (damage dealt per side, molt times, bar curve). With today's stub bots nobody
 * moves or fires, so every match is a clock win for the humans.
 */

import { createMatchConfig, createWorld, TICK_RATE, type SimEvent, type World } from '../src/index';

interface Options {
  seed: number;
  matches: number;
  anchor: number;
  fast: boolean;
  maxMinutes: number;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { seed: 1, matches: 1, anchor: -1, fast: false, maxMinutes: 20 };
  for (let i = 0; i < argv.length; i++) {
    const next = (): number => {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v)) throw new Error(`${argv[i - 1]} needs a number`);
      return v;
    };
    switch (argv[i]) {
      case '--seed':
        o.seed = next();
        break;
      case '--matches':
        o.matches = next();
        break;
      case '--anchor':
        o.anchor = next();
        break;
      case '--max-minutes':
        o.maxMinutes = next();
        break;
      case '--fast':
        o.fast = true;
        break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }
  return o;
}

function clockText(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function runMatch(seed: number, o: Options): void {
  const world: World = createWorld({ seed, config: createMatchConfig({ anchor: o.anchor, fast: o.fast }) });
  const counts = new Map<string, number>();
  const maxTicks = o.maxMinutes * 60 * TICK_RATE;
  const started = performance.now();
  while (world.match.phase !== 'ended' && world.tick < maxTicks) {
    const events: SimEvent[] = world.step();
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const wall = (performance.now() - started) / 1000;
  const m = world.match;
  const anchor = world.city.anchors[m.anchor];

  console.log(`match seed ${seed}  start: ${anchor.name} (anchor ${m.anchor})${o.fast ? '  [fast tuning]' : ''}`);
  if (m.phase !== 'ended') {
    console.log(`  NOT FINISHED after ${o.maxMinutes} simulated minutes (phase ${m.phase}, stage ${m.stage})`);
  } else {
    console.log(`  winner: ${m.winner} (${m.endReason})`);
  }
  console.log(`  match length: ${clockText(m.elapsed)}   clock left: ${clockText(m.clock)}`);
  console.log(`  time per stage: ${m.stageTime.map((t, i) => `S${i + 1} ${clockText(t)}`).join('  ')}   reached stage ${m.stage}`);
  console.log(`  bar: ${m.barPoints.toFixed(0)} points, marks ${m.marks.map((v) => v.toFixed(0)).join(' / ')}, passed ${m.marksReached}`);
  console.log(`  nerve breaks: ${m.breaks}   kills: ${m.kills}`);
  const k = world.kaijus[0];
  if (k) console.log(`  kaiju: hp ${k.hp.toFixed(0)} / ${k.maxHp.toFixed(0)}, rage ${k.rage.toFixed(0)}`);
  const eventText = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');
  console.log(`  events: ${eventText || 'none'}`);
  console.log(`  simulated ${world.tick} ticks in ${wall.toFixed(2)} s (${(world.tick / TICK_RATE / Math.max(wall, 1e-6)).toFixed(0)}x real time)`);
}

const options = parseArgs(process.argv.slice(2));
for (let i = 0; i < options.matches; i++) runMatch(options.seed + i, options);
