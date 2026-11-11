#!/usr/bin/env node
/**
 * Browser smoke playtest (ARCHITECTURE.md section 6).
 *
 *   node tools/playtest/smoke.mjs [options]
 *
 * Starts the game server with MB_FAST=1 on a free port against the production client build,
 * opens headless Chromium pages that play themselves (?autoplay=1), has the first page create a
 * room and the others join it by code, lets the match run to its end, and fails if any page
 * logs a console error, throws, or crashes. Screenshots from both sides are saved at several
 * moments, and a summary with draw calls and triangle counts is printed and written as JSON.
 *
 * Options
 *   --players N      pages to open, 1 to 5 (default 5). The first plays the kaiju.
 *   --role R         side of the first page: kaiju (default) or human (a bot plays the kaiju)
 *   --out DIR        where screenshots and summary.json go (default /tmp/mb-scratch/playtest)
 *   --timeout S      seconds to wait for the match to end (default 300)
 *   --width W --height H   page size (default 800 x 450; small keeps software rendering fast)
 *   --no-assets      run the client on procedural fallbacks only (?assets=none)
 *   --no-build       do not build when client/dist or server/dist is missing; fail instead
 *   --headed         show the browser windows
 *   --reconnect      drop one human's connection mid-match and expect it to come back
 *   --debug          show the ?debug=1 overlay on every page (default: on the last page only)
 *
 * WebGL in headless Chromium on this machine: there is no GPU, so Chromium draws WebGL with
 * SwiftShader, its software renderer. Recent Chromium only allows that when asked, hence the
 * launch flags below (`--use-angle=swiftshader --enable-unsafe-swiftshader
 * --ignore-gpu-blocklist`). `--autoplay-policy=no-user-gesture-required` lets the audio engine
 * run without a click so its code paths are exercised too. Software rendering is slow: five
 * pages share four cores, so the pages are small and capped at 30 frames a second, and every
 * page gets its own browser (pages of one browser share one GPU process, which with software
 * rendering serializes all of them down to a couple of frames a second).
 *
 * Playwright is installed globally (never run `playwright install`); it is found through
 * NODE_PATH with a CommonJS `require`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

export const CHROMIUM_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

const NAMES = ['Rex', 'Ada', 'Bo', 'Cy', 'Di'];

function parseArgs(argv) {
  const opts = { players: 5, role: 'kaiju', out: '/tmp/mb-scratch/playtest', timeout: 300, width: 800, height: 450, noAssets: false, build: true, headed: false, reconnect: false, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--players') opts.players = Math.min(5, Math.max(1, Number(next()) || 5));
    else if (a === '--role') opts.role = next() === 'human' ? 'human' : 'kaiju';
    else if (a === '--out') opts.out = resolve(next());
    else if (a === '--timeout') opts.timeout = Number(next()) || 300;
    else if (a === '--width') opts.width = Number(next()) || 800;
    else if (a === '--height') opts.height = Number(next()) || 450;
    else if (a === '--no-assets') opts.noAssets = true;
    else if (a === '--no-build') opts.build = false;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--reconnect') opts.reconnect = true;
    else if (a === '--debug') opts.debug = true;
    else if (a === '--help' || a === '-h') {
      console.log('See the header of tools/playtest/smoke.mjs for the options.');
      process.exit(0);
    } else {
      console.error(`unknown option ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, timeoutMs, everyMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.out, { recursive: true });

  // --- builds --------------------------------------------------------------------------------
  const serverEntry = join(root, 'server', 'dist', 'index.js');
  const clientIndex = join(root, 'client', 'dist', 'index.html');
  if (!existsSync(serverEntry) || !existsSync(clientIndex)) {
    if (!opts.build) throw new Error('client/dist or server/dist is missing: run `npm run build` first');
    console.log('smoke: no production build found, running `npm run build`...');
    const built = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('npm run build failed');
  }

  // --- server --------------------------------------------------------------------------------
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const serverLog = [];
  const server = spawn(process.execPath, ['--enable-source-maps', serverEntry], {
    cwd: join(root, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MB_FAST: '1', MB_CLIENT_DIR: join(root, 'client', 'dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) serverLog.push(line);
    if (serverLog.length > 400) serverLog.splice(0, serverLog.length - 400);
  };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
  let serverExit = null;
  server.on('exit', (code) => {
    serverExit = code ?? -1;
  });

  // One browser per page: pages of one browser share a single GPU process, and with software
  // rendering that process becomes the bottleneck (five pages crawl at two frames a second).
  const browsers = [];
  const pages = [];
  const failures = [];
  const summary = { ok: false, origin, players: opts.players, startedAt: new Date().toISOString(), chromiumArgs: CHROMIUM_ARGS, pages: [], screenshots: [], failures };
  const stop = async () => {
    await Promise.all(
      browsers.map((b) =>
        b.close().catch(() => {
          // The browser is already gone.
        }),
      ),
    );
    if (serverExit === null) {
      server.kill('SIGTERM');
      await Promise.race([new Promise((r) => server.once('exit', r)), sleep(4000)]);
      if (serverExit === null) server.kill('SIGKILL');
    }
  };

  try {
    await waitFor(
      'the server to answer /healthz',
      async () => {
        if (serverExit !== null) throw new Error(`the server exited with code ${serverExit}:\n${serverLog.join('\n')}`);
        try {
          const r = await fetch(`${origin}/healthz`);
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      },
      20000,
    );

    // --- browser -----------------------------------------------------------------------------
    const { chromium } = require('playwright');
    let version = '';

    const openPage = async (index, hash) => {
      const browser = await chromium.launch({ headless: !opts.headed, args: CHROMIUM_ARGS });
      browsers.push(browser);
      version = browser.version();
      summary.chromium = version;
      const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const record = { index, name: NAMES[index], role: index === 0 ? opts.role : 'human', errors: [], warnings: [], crashed: false, maxCalls: 0, maxTriangles: 0, maxSprites: 0 };
      page.on('console', (msg) => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error') record.errors.push(text);
        else if (type === 'warning') record.warnings.push(text);
      });
      page.on('pageerror', (err) => record.errors.push(`uncaught: ${err.message}`));
      page.on('crash', () => {
        record.crashed = true;
        record.errors.push('page crashed');
      });
      page.on('requestfailed', (req) => {
        const failure = req.failure();
        // Aborted media range requests are normal when a sound is replaced; anything else is a miss.
        if (failure && !/ERR_ABORTED/.test(failure.errorText)) record.errors.push(`request failed: ${req.url()} (${failure.errorText})`);
      });
      const q = new URLSearchParams({ autoplay: '1', name: record.name, role: record.role, fps: '30' });
      // The debug overlay is exercised on one page; the others keep a clean view for screenshots.
      if (opts.debug || (opts.players > 2 && index === opts.players - 1)) q.set('debug', '1');
      if (index === 0) {
        q.set('start', String(opts.players));
        if (opts.role === 'human') q.set('practice', '1');
      }
      if (opts.noAssets) q.set('assets', 'none');
      await page.goto(`${origin}/?${q.toString()}${hash ? `#${hash}` : ''}`, { waitUntil: 'load' });
      pages.push({ page, record });
      return { page, record };
    };
    const state = (page) => page.evaluate(() => (window.__mb ? window.__mb.state() : null)).catch(() => null);
    const info = (page) => page.evaluate(() => (window.__mb ? window.__mb.renderer.info() : null)).catch(() => null);
    const shot = async (page, name) => {
      const file = join(opts.out, `${name}.png`);
      try {
        await page.screenshot({ path: file });
        summary.screenshots.push(file);
      } catch (err) {
        failures.push(`screenshot ${name} failed: ${err.message}`);
      }
    };

    // --- create and join -----------------------------------------------------------------------
    const host = await openPage(0, '');
    const code = await waitFor('the host to create a room', async () => (await state(host.page))?.code || null, 60000);
    console.log(`smoke: server ${origin}, Chromium ${version}, room ${code}`);
    summary.code = code;
    await shot(host.page, '01-lobby-host');
    await Promise.all(Array.from({ length: opts.players - 1 }, (_, i) => openPage(i + 1, code)));
    pages.sort((a, b) => a.record.index - b.record.index);
    const other = pages[Math.min(1, pages.length - 1)];
    const last = pages[pages.length - 1];

    await waitFor('everyone to be in the room', async () => {
      const s = await state(host.page);
      return s && (s.lobby?.players === opts.players || s.match) ? s : null;
    }, 60000);
    await shot(other.page, '02-lobby-guest');

    // --- the match -----------------------------------------------------------------------------
    await waitFor('the match to start on every page', async () => {
      const states = await Promise.all(pages.map((p) => state(p.page)));
      return states.every((s) => s && s.match) ? states : null;
    }, 60000);
    const matchStart = Date.now();
    await shot(host.page, '03-briefing-kaiju');
    await shot(other.page, '03-briefing-human');

    const moments = [
      [4, '04-early'],
      [14, '05-fight'],
      [30, '06-fight'],
      [55, '07-mid'],
      [90, '08-late'],
      [130, '09-late'],
    ];
    const first = {};
    const lastStates = [];
    let dropped = false;
    let ended = false;
    const deadline = Date.now() + opts.timeout * 1000;
    while (Date.now() < deadline) {
      const elapsed = (Date.now() - matchStart) / 1000;
      const states = await Promise.all(pages.map((p) => state(p.page)));
      const infos = await Promise.all(pages.map((p) => info(p.page)));
      states.forEach((s, i) => {
        lastStates[i] = s ?? lastStates[i];
        const rec = pages[i].record;
        const inf = infos[i];
        if (inf && s && s.screen === 'match') {
          rec.maxCalls = Math.max(rec.maxCalls, inf.calls);
          rec.maxTriangles = Math.max(rec.maxTriangles, inf.triangles);
          rec.maxSprites = Math.max(rec.maxSprites, inf.sprites);
        }
        if (s && s.me && !first[i]) first[i] = { x: s.me.x, z: s.me.z };
      });
      while (moments.length > 0 && elapsed >= moments[0][0]) {
        const [, name] = moments.shift();
        if (states[0]?.screen !== 'end') {
          await shot(host.page, `${name}-kaiju`);
          await shot(other.page, `${name}-human`);
          if (last !== other) await shot(last.page, `${name}-human-b`);
        }
      }
      if (opts.reconnect && !dropped && elapsed > 20 && pages.length > 1) {
        dropped = true;
        console.log('smoke: dropping the connection of one human page');
        await other.page.evaluate(() => window.__mb.helpers.dropConnection());
      }
      const s0 = states[0];
      if (s0) {
        const m = s0.match;
        console.log(
          `smoke: t=${elapsed.toFixed(0).padStart(3)}s screen=${s0.screen} ${m ? `phase=${m.phase} stage=${m.stage} clock=${m.clock.toFixed(0)} bar=${m.barPoints.toFixed(0)}/${m.marks.map((v) => v.toFixed(0)).join('/')}` : ''}` +
            ` kaiju=${s0.kaiju ? `${s0.kaiju.phase}/${s0.kaiju.action} hp ${s0.kaiju.hp.toFixed(0)}` : '-'} units=${s0.unitsAlive} frame=${s0.frame.ms.toFixed(0)}ms calls=${infos[0]?.calls ?? 0} tris=${infos[0]?.triangles ?? 0}`,
        );
      }
      if (states.every((s) => s && s.screen === 'end' && s.result)) {
        ended = true;
        break;
      }
      if (pages.some((p) => p.record.crashed)) break;
      await sleep(2000);
    }
    if (!ended) failures.push(`the match did not reach the end screen on every page within ${opts.timeout} s`);
    await sleep(1500);
    await shot(host.page, '10-end-kaiju');
    await shot(other.page, '10-end-human');

    // --- verdict -------------------------------------------------------------------------------
    for (let i = 0; i < pages.length; i++) {
      const { record } = pages[i];
      const s = lastStates[i];
      const moved = s && s.me && first[i] ? Math.hypot(s.me.x - first[i].x, s.me.z - first[i].z) : 0;
      Object.assign(record, {
        screen: s?.screen ?? 'unknown',
        role: s?.role ?? record.role,
        result: s?.result ?? null,
        snapshots: s?.net?.snapshots ?? 0,
        inputs: s?.net?.inputs ?? 0,
        predicting: s?.net?.predicting ?? false,
        frameMs: s ? Number(s.frame.ms.toFixed(1)) : 0,
        frames: s?.frame.count ?? 0,
        ping: s?.ping ?? 0,
        moved: Number(moved.toFixed(1)),
        events: s?.events ?? {},
        pageErrors: s?.errors ?? [],
      });
      if (record.errors.length > 0) failures.push(`page ${i} (${record.name}) logged ${record.errors.length} console error(s): ${record.errors.slice(0, 3).join(' | ')}`);
      if ((s?.errors ?? []).length > 0) failures.push(`page ${i} (${record.name}) saw uncaught errors: ${s.errors.slice(0, 3).join(' | ')}`);
      if (record.snapshots < 50) failures.push(`page ${i} (${record.name}) received only ${record.snapshots} snapshots`);
      if (record.maxCalls <= 0 || record.maxTriangles <= 0) failures.push(`page ${i} (${record.name}) never drew anything during the match`);
      summary.pages.push(record);
    }
    const s0 = lastStates[0];
    summary.result = s0?.result ?? null;
    summary.finalMatch = s0?.match ?? null;
    summary.matchSeconds = Number(((Date.now() - matchStart) / 1000).toFixed(1));
    if (s0 && opts.role === 'kaiju' && s0.match && s0.match.barPoints <= 0) failures.push('the autoplay kaiju destroyed nothing (bar stayed at 0)');
    if (opts.role === 'kaiju' && pages[0].record.moved < 5) failures.push('the autoplay kaiju did not move');
    summary.ok = failures.length === 0;
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  } finally {
    await stop();
  }

  // --- report ------------------------------------------------------------------------------------
  summary.serverLogTail = serverLog.slice(-15);
  writeFileSync(join(opts.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log('\n=== smoke playtest summary ===');
  console.log(`result: ${summary.result ? `${summary.result.winner} won by ${summary.result.reason} after ${summary.result.duration.toFixed(0)} s of play` : 'no result'}; wall time ${summary.matchSeconds ?? '?'} s`);
  for (const p of summary.pages) {
    const warnings = [...new Set(p.warnings)];
    console.log(
      `page ${p.index} ${String(p.name).padEnd(4)} ${String(p.role).padEnd(6)} screen=${p.screen} snapshots=${p.snapshots} inputs=${p.inputs} predicting=${p.predicting} moved=${p.moved}m ` +
        `frame=${p.frameMs}ms max draw calls=${p.maxCalls} max triangles=${p.maxTriangles} max sprites=${p.maxSprites} errors=${p.errors.length} warnings=${p.warnings.length} (${warnings.length} distinct)`,
    );
  }
  const allWarnings = [...new Set(summary.pages.flatMap((p) => p.warnings))];
  if (allWarnings.length > 0) {
    console.log(`distinct console warnings (${allWarnings.length}):`);
    for (const w of allWarnings.slice(0, 25)) console.log(`  - ${w.slice(0, 220)}`);
  }
  console.log(`screenshots: ${summary.screenshots.length} in ${opts.out}`);
  if (failures.length > 0) {
    console.log('FAILED:');
    for (const f of failures) console.log(`  - ${f}`);
    if (summary.serverLogTail.length > 0) console.log(`server log tail:\n  ${summary.serverLogTail.join('\n  ')}`);
    process.exit(1);
  }
  console.log('PASSED: the match ran to its end with no console errors.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
