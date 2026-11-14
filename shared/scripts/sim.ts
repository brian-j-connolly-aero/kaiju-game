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
 *   --every-anchor       take the anchors in turn instead (match i starts at anchor i mod 10), so
 *                        that every start is played equally often
 *   --fast               the short MB_FAST timers and small bar
 *   --kaiju-handicap H   0 (the bot at its best) to 1 (it stands still); default 0
 *   --human-handicap H   the same for the squads
 *   --trigger-happy      the squads play the lazy way: parked, they fire every time the guns have
 *                        loaded instead of charging volleys (what undisciplined fire is worth)
 *   --unopposed          no squads at all: how fast does a kaiju fill the bar when left alone
 *   --max-minutes N      give up on a match after this many simulated minutes (default 20)
 *   --city NAME          'meridian' (default: Port Meridian, the game's city, docs/CITY.md) or
 *                        'placeholder' (the old grid city, a development option)
 *   --bar P1,P2,P3       try other destruction bar fractions (MATCH_RULES.bar.p1/p2/p3) in this run
 *                        only; the rules file is not changed
 *   --nav                also print how the squads got about: stuck time, wading, bridge crowding
 *   --events             also print each match's event counts
 *   --json               print the reports as JSON instead of the table
 *
 * Columns: winner and why; match length; time per stage; kaiju nerve breaks (staggers) per
 * stage; units lost per stage; the bar at the end of each stage as a percentage of the way to
 * the third mark (the skyline display, on which the marks sit at 21, 57 and 100); kaiju hp lost
 * per stage. A stage that was not reached shows as "-". The summary adds, per stage, how long
 * the kaiju took to fill its segment of the bar, volleys, healing and the squads' collateral.
 */

import { MATCH_RULES } from '../src/defs/rules';
import { getCity, type BuiltCity, type CityKind } from '../src/index';
import { runBotMatch, type BotMatchReport } from './botMatch';
import { createNavWatch, navSummary, type NavWatch } from './navWatch';

interface Options {
  seed: number;
  seeds: number;
  anchor: number;
  everyAnchor: boolean;
  fast: boolean;
  kaijuHandicap: number;
  humanHandicap: number;
  triggerHappy: boolean;
  squads: number;
  maxMinutes: number;
  events: boolean;
  json: boolean;
  city: CityKind;
  nav: boolean;
  bar: [number, number, number] | null;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    seed: 1,
    seeds: 5,
    anchor: -1,
    everyAnchor: false,
    fast: false,
    kaijuHandicap: 0,
    humanHandicap: 0,
    triggerHappy: false,
    squads: 4,
    maxMinutes: 20,
    events: false,
    json: false,
    city: 'meridian',
    nav: false,
    bar: null,
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
      case '--every-anchor':
        o.everyAnchor = true;
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
      case '--trigger-happy':
        o.triggerHappy = true;
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
      case '--nav':
        o.nav = true;
        break;
      case '--city': {
        const name = argv[++i] ?? '';
        if (name !== 'placeholder' && name !== 'meridian') throw new Error("--city needs 'meridian' or 'placeholder'");
        o.city = name;
        break;
      }
      case '--bar': {
        const v = (argv[++i] ?? '').split(',').map(Number);
        if (v.length !== 3 || !v.every((x) => Number.isFinite(x) && x > 0)) throw new Error('--bar needs three fractions, like 0.18,0.13,0.30');
        o.bar = [v[0], v[1], v[2]];
        break;
      }
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
  const tags = [o.city !== 'meridian' ? `city: ${o.city}` : '', o.bar ? `bar ${o.bar.join(' / ')}` : '', o.fast ? 'fast tuning' : '', o.kaijuHandicap > 0 ? `kaiju handicap ${o.kaijuHandicap}` : '', o.humanHandicap > 0 ? `human handicap ${o.humanHandicap}` : '', o.triggerHappy ? 'trigger-happy squads' : '', o.squads === 0 ? 'unopposed' : '', o.everyAnchor ? 'every start in turn' : ''].filter(Boolean);
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
    // The segment is full when the molt is offered (stages 1 and 2) or the match is won (stage 3).
    const filled = i < 2 ? all.filter((r) => r.stages[i].moltOffered >= 0).map((r) => r.stages[i].moltOffered) : complete.map((r) => r.stages[i].time);
    const perMatch = (f: (s: BotMatchReport['stages'][number]) => number, digits = 1): string => mean(all.map((r) => f(r.stages[i]))).toFixed(digits);
    console.log(
      `stage ${i + 1}: reached ${all.length}, completed ${complete.length}` +
        `, segment filled after ${filled.length > 0 ? clock(mean(filled)) : '-'}` +
        `, stage time when completed ${complete.length > 0 ? clock(mean(complete.map((r) => r.stages[i].time))) : '-'}` +
        `; per match: staggers ${perMatch((s) => s.staggers)}, volleys ${perMatch((s) => s.volleys)}, units lost ${perMatch((s) => s.unitsLost)}` +
        `, kaiju hp lost ${perMatch((s) => s.kaijuHpLost, 0)} (healed ${perMatch((s) => s.kaijuHpHealed, 0)}), collateral ${perMatch((s) => s.collateral, 0)} points` +
        `, swum ${perMatch((s) => s.swimTime, 0)} s (${perMatch((s) => s.dives)} dives)`,
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
if (options.bar) {
  // A trial for this run only (the rules object is plain data, read when each match starts).
  const bar = MATCH_RULES.bar as { p1: number; p2: number; p3: number };
  [bar.p1, bar.p2, bar.p3] = options.bar;
}
// Built once and handed to every match.
const city: BuiltCity = getCity(undefined, options.city);
const reports: BotMatchReport[] = [];
const watches: NavWatch[] = [];
for (let i = 0; i < options.seeds; i++) {
  const watch = options.nav ? createNavWatch() : null;
  reports.push(
    runBotMatch({
      seed: options.seed + i,
      anchor: options.everyAnchor ? i % city.city.anchors.length : options.anchor,
      fast: options.fast,
      kaijuHandicap: options.kaijuHandicap,
      humanHandicap: options.humanHandicap,
      triggerHappy: options.triggerHappy,
      squads: options.squads,
      maxMinutes: options.maxMinutes,
      city,
      onTick: watch ? watch.onTick : undefined,
    }).report,
  );
  if (watch) watches.push(watch);
}
if (options.json) console.log(JSON.stringify(reports, null, 2));
else printTable(reports, options);
if (options.nav && !options.json) console.log(navSummary(watches));
