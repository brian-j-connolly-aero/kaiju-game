/**
 * npm run sim [-- options]
 *
 * The balance harness: plays full bot-versus-bot matches, headless, as fast as the machine
 * allows, and prints one row per match plus a summary. The numbers are the ones the design's
 * tuning targets are written in (DESIGN.md section 2; docs/BALANCE.md has the history).
 *
 *   --seeds N            how many matches (default 5); seeds run from --seed upward
 *   --seed N             first seed (default 1)
 *   --anchor N           start every match at this neighborhood anchor (default: the seed picks)
 *   --fast               the short MB_FAST timers and small bar
 *   --kaiju-handicap H   0 (the bot at its best) to 1 (it stands still); default 0
 *   --human-handicap H   the same for the squads
 *   --unopposed          no squads at all: how fast does a kaiju fill the bar when left alone
 *   --max-minutes N      give up on a match after this many simulated minutes (default 20)
 *   --events             also print each match's event counts
 *   --json               print the reports as JSON instead of the table
 *
 * Columns: winner and why; match length; time per stage; kaiju nerve breaks (staggers) per
 * stage; units lost per stage; the bar at the end of each stage as a percentage of the way to
 * the third mark (the skyline display); kaiju hp lost per stage.
 */

import { runBotMatch, type BotMatchReport } from './botMatch';

interface Options {
  seed: number;
  seeds: number;
  anchor: number;
  fast: boolean;
  kaijuHandicap: number;
  humanHandicap: number;
  squads: number;
  maxMinutes: number;
  events: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    seed: 1,
    seeds: 5,
    anchor: -1,
    fast: false,
    kaijuHandicap: 0,
    humanHandicap: 0,
    squads: 4,
    maxMinutes: 20,
    events: false,
    json: false,
  };
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
      case '--seeds':
      case '--matches':
        o.seeds = Math.max(1, Math.floor(next()));
        break;
      case '--anchor':
        o.anchor = next();
        break;
      case '--max-minutes':
        o.maxMinutes = next();
        break;
      case '--kaiju-handicap':
        o.kaijuHandicap = Math.min(1, Math.max(0, next()));
        break;
      case '--human-handicap':
        o.humanHandicap = Math.min(1, Math.max(0, next()));
        break;
      case '--unopposed':
        o.squads = 0;
        break;
      case '--fast':
        o.fast = true;
        break;
      case '--events':
        o.events = true;
        break;
      case '--json':
        o.json = true;
        break;
      default:
        throw new Error(`unknown option ${argv[i]} (see the header of shared/scripts/sim.ts)`);
    }
  }
  return o;
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

const per = (r: BotMatchReport, f: (s: BotMatchReport['stages'][number]) => string): string =>
  r.stages.map((s) => (s.reached ? f(s) : '-')).join(' / ');

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => (i < 3 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
}

function printTable(reports: BotMatchReport[], o: Options): void {
  const head = ['seed', 'start', 'winner', 'length', 'stage time', 'staggers', 'units lost', 'bar % at stage end', 'kaiju hp lost'];
  const rows = reports.map((r) => [
    String(r.seed),
    r.anchorName,
    r.finished ? `${r.winner} (${r.reason})` : 'NOT FINISHED',
    clock(r.length),
    per(r, (s) => clock(s.time)),
    per(r, (s) => String(s.staggers)),
    per(r, (s) => String(s.unitsLost)),
    per(r, (s) => (s.barDisplay * 100).toFixed(0)),
    per(r, (s) => s.kaijuHpLost.toFixed(0)),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((c) => c[i].length)));
  const tags = [o.fast ? 'fast tuning' : '', o.kaijuHandicap > 0 ? `kaiju handicap ${o.kaijuHandicap}` : '', o.humanHandicap > 0 ? `human handicap ${o.humanHandicap}` : '', o.squads === 0 ? 'unopposed' : ''].filter(Boolean);
  console.log(`${reports.length} bot matches${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}`);
  console.log(row(head, widths));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const cells of rows) console.log(row(cells, widths));

  const done = reports.filter((r) => r.finished);
  const kaiju = done.filter((r) => r.winner === 'kaiju').length;
  const kills = done.filter((r) => r.reason === 'kill').length;
  const clocks = done.filter((r) => r.reason === 'clock').length;
  const pct = (n: number): string => (done.length > 0 ? `${((100 * n) / done.length).toFixed(0)}%` : '-');
  console.log('');
  console.log(`kaiju wins ${kaiju}/${done.length} (${pct(kaiju)})   human wins ${done.length - kaiju} (${pct(done.length - kaiju)}): ${kills} by kill, ${clocks} by the clock`);
  console.log(`mean match length ${clock(mean(done.map((r) => r.length)))}   shortest ${clock(Math.min(...done.map((r) => r.length)))}   longest ${clock(Math.max(...done.map((r) => r.length)))}`);
  for (let i = 0; i < 3; i++) {
    // A stage is complete when the next one was reached, or when the kaiju won in it.
    const complete = done.filter((r) => (i < 2 ? r.stages[i + 1].reached : r.winner === 'kaiju'));
    const all = done.filter((r) => r.stages[i].reached);
    if (all.length === 0) continue;
    console.log(
      `stage ${i + 1}: reached ${all.length}, completed ${complete.length}, mean time when completed ${clock(mean(complete.map((r) => r.stages[i].time)))}` +
        `, molt offered after ${clock(mean(complete.filter((r) => r.stages[i].moltOffered >= 0).map((r) => r.stages[i].moltOffered)))}` +
        `; per match: staggers ${mean(all.map((r) => r.stages[i].staggers)).toFixed(1)}, volleys ${mean(all.map((r) => r.stages[i].volleys)).toFixed(1)}` +
        `, units lost ${mean(all.map((r) => r.stages[i].unitsLost)).toFixed(1)}, kaiju hp lost ${mean(all.map((r) => r.stages[i].kaijuHpLost)).toFixed(0)}` +
        ` (healed ${mean(all.map((r) => r.stages[i].kaijuHpHealed)).toFixed(0)}), collateral ${mean(all.map((r) => r.stages[i].collateral)).toFixed(0)} points`,
    );
  }
  const ticks = reports.reduce((a, r) => a + r.ticks, 0);
  const wall = reports.reduce((a, r) => a + r.wall, 0);
  console.log(
    `voice: ${mean(reports.map((r) => (r.voiceCues / Math.max(r.length, 1)) * 60)).toFixed(1)} cues per minute, at most ${Math.max(...reports.map((r) => r.voicePeak10s))} in any 10 s` +
      `   simulated ${ticks} ticks in ${wall.toFixed(1)} s (${(ticks / 30 / Math.max(wall, 1e-6)).toFixed(0)}x real time)`,
  );
  if (o.events) {
    for (const r of reports) {
      const text = Object.entries(r.eventCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `${type} ${n}`)
        .join(', ');
      console.log(`seed ${r.seed} events: ${text}`);
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const reports: BotMatchReport[] = [];
for (let i = 0; i < options.seeds; i++) {
  reports.push(
    runBotMatch({
      seed: options.seed + i,
      anchor: options.anchor,
      fast: options.fast,
      kaijuHandicap: options.kaijuHandicap,
      humanHandicap: options.humanHandicap,
      squads: options.squads,
      maxMinutes: options.maxMinutes,
    }).report,
  );
}
if (options.json) console.log(JSON.stringify(reports, null, 2));
else printTable(reports, options);
