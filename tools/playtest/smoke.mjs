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
 *   --idle-humans    the human pages do not play (no autopilot): they join, get ready and then
 *                    stand still, so the autoplay kaiju goes through all three stages and, time
 *                    permitting, wins by the bar. The default (everyone on autoplay) usually
 *                    ends with the humans winning.
 *   --expect W       fail unless the match ends with this winner: kaiju or humans
 *   --expect-stage N fail unless the match reached stage N (3: both molts happened)
 *
 * Besides the pass or fail verdict the summary carries measurements per page: draw calls and
 * triangles (peak, and peak while stage 3 was on screen), bytes received and sent over the
 * WebSocket during the match (bandwidth), snapshot sizes, and a smoothness probe: for about
 * three seconds at stage 2 or 3 every frame's position of the kaiju is recorded on the kaiju's own
 * page (predicted) and on a human page (interpolated), and the largest step between two frames is
 * compared with what the kaiju's top speed allows. The server's own tick timing is read from
 * `/healthz` (`perf`) at the end.
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
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const opts = { players: 5, role: 'kaiju', out: '/tmp/mb-scratch/playtest', timeout: 300, width: 800, height: 450, noAssets: false, build: true, headed: false, reconnect: false, debug: false, idleHumans: false, expect: '', expectStage: 0 };
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
    else if (a === '--idle-humans') opts.idleHumans = true;
    else if (a === '--expect') opts.expect = next() === 'kaiju' ? 'kaiju' : 'humans';
    else if (a === '--expect-stage') opts.expectStage = Math.min(3, Math.max(1, Number(next()) || 1));
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
      const idle = opts.idleHumans && index > 0;
      const record = { index, name: NAMES[index], role: index === 0 ? opts.role : 'human', idle, errors: [], warnings: [], crashed: false, maxCalls: 0, maxTriangles: 0, maxSprites: 0, stage3Calls: 0, stage3Triangles: 0, wsIn: 0, wsOut: 0, wsFramesIn: 0 };
      // Everything the game sends and receives goes over one WebSocket: count its payload bytes.
      page.on('websocket', (ws) => {
        ws.on('framereceived', (f) => {
          record.wsIn += typeof f.payload === 'string' ? Buffer.byteLength(f.payload) : f.payload.length;
          record.wsFramesIn++;
        });
        ws.on('framesent', (f) => {
          record.wsOut += typeof f.payload === 'string' ? Buffer.byteLength(f.payload) : f.payload.length;
        });
      });
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
      const q = new URLSearchParams({ name: record.name, role: record.role, fps: '30' });
      // An idle page is a person who joined and then went to make tea: no autopilot.
      if (!idle) q.set('autoplay', '1');
      // The debug overlay is exercised on one page; the others keep a clean view for screenshots.
      if (opts.debug || (opts.players > 2 && index === opts.players - 1)) q.set('debug', '1');
      if (index === 0) {
        q.set('start', String(opts.players));
        if (opts.role === 'human') q.set('practice', '1');
      }
      if (opts.noAssets) q.set('assets', 'none');
      // Only the first two pages are photographed. The rest draw at low resolution and rate so
      // that five software-rendered pages fit on four cores.
      if (index >= 2) {
        q.set('res', '0.4');
        q.set('fps', '20');
      }
      await page.goto(`${origin}/?${q.toString()}${hash ? `#${hash}` : ''}`, { waitUntil: 'load' });
      pages.push({ page, record });
      return { page, record };
    };
    const state = (page) => page.evaluate(() => (window.__mb ? window.__mb.state() : null)).catch(() => null);
    const info = (page) => page.evaluate(() => (window.__mb ? window.__mb.renderer.info() : null)).catch(() => null);
    /**
     * Records the kaiju's position on every frame a page draws for about three seconds, then
     * measures how even the motion is: the largest step between two frames against what the
     * top speed allows, direction reversals, and how steadily the view's clock advances.
     */
    const smoothness = (page) =>
      page
        .evaluate(
          () =>
            new Promise((done) => {
              const rt = window.__mb.internals.ctx.runtime;
              const samples = [];
              const t0 = performance.now();
              let lastTick = -1;
              const step = () => {
                const f = rt && rt.frame;
                const k = f && f.kaijus[0];
                // One sample per frame the game produced (the page may draw less often than rAF fires).
                if (f && k && f.tick !== lastTick) {
                  lastTick = f.tick;
                  samples.push([performance.now() - t0, f.tick, k.x, k.z, k.stage, k.phase]);
                }
                if (performance.now() - t0 < 3000) requestAnimationFrame(step);
                else done(samples);
              };
              requestAnimationFrame(step);
            }),
        )
        .then((samples) => {
          const TOP = { 1: 8.5, 2: 14, 3: 22 };
          let maxStepRatio = 0;
          let reversals = 0;
          let moving = 0;
          let tickBack = 0;
          let minRate = Infinity;
          let maxRate = 0;
          let px = 0;
          let pz = 0;
          for (let i = 1; i < samples.length; i++) {
            const [t, tick, x, z, stage] = samples[i];
            const [t1, tick1, x1, z1] = samples[i - 1];
            const dt = (t - t1) / 1000;
            if (dt <= 0) continue;
            const dx = x - x1;
            const dz = z - z1;
            const d = Math.hypot(dx, dz);
            // What the kaiju can cover in this frame at top speed, with a little slack for rounding.
            maxStepRatio = Math.max(maxStepRatio, d / (TOP[stage] * dt + 0.05));
            if (d > 0.03) {
              moving++;
              if (dx * px + dz * pz < -0.0004) reversals++;
              px = dx;
              pz = dz;
            }
            const rate = (tick - tick1) / dt;
            if (tick < tick1) tickBack++;
            minRate = Math.min(minRate, rate);
            maxRate = Math.max(maxRate, rate);
          }
          const span = samples.length > 1 ? (samples[samples.length - 1][0] - samples[0][0]) / 1000 : 0;
          return {
            frames: samples.length,
            fps: span > 0 ? Number(((samples.length - 1) / span).toFixed(1)) : 0,
            movingFrames: moving,
            maxStepRatio: Number(maxStepRatio.toFixed(2)),
            reversals,
            clockWentBack: tickBack,
            ticksPerSecond: samples.length > 1 && span > 0 ? Number(((samples[samples.length - 1][1] - samples[0][1]) / span).toFixed(1)) : 0,
            frameTickRate: { min: Number((minRate === Infinity ? 0 : minRate).toFixed(1)), max: Number(maxRate.toFixed(1)) },
          };
        })
        .catch((err) => ({ error: String(err) }));
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
    // Idle pages have no autopilot to press Ready for them: click the real button.
    for (const p of pages) {
      if (!p.record.idle) continue;
      await p.page.waitForSelector('.lobby .ready-toggle', { timeout: 60000 });
      await p.page.click('.lobby .ready-toggle');
    }
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
    let maxStage = 0;
    let probed = false;
    for (const p of pages) {
      p.record.wsInAtStart = p.record.wsIn;
      p.record.wsOutAtStart = p.record.wsOut;
    }
    const deadline = Date.now() + opts.timeout * 1000;
    while (Date.now() < deadline) {
      const elapsed = (Date.now() - matchStart) / 1000;
      const states = await Promise.all(pages.map((p) => state(p.page)));
      const infos = await Promise.all(pages.map((p) => info(p.page)));
      states.forEach((s, i) => {
        lastStates[i] = s ?? lastStates[i];
        const rec = pages[i].record;
        const inf = infos[i];
        if (inf && s && s.screen === 'match' && s.matchesEnded === 0) {
          rec.maxCalls = Math.max(rec.maxCalls, inf.calls);
          rec.maxTriangles = Math.max(rec.maxTriangles, inf.triangles);
          rec.maxSprites = Math.max(rec.maxSprites, inf.sprites);
          if (s.match && s.match.stage === 3) {
            rec.stage3Calls = Math.max(rec.stage3Calls, inf.calls);
            rec.stage3Triangles = Math.max(rec.stage3Triangles, inf.triangles);
          }
        }
        if (s && s.match && s.matchesEnded === 0) {
          maxStage = Math.max(maxStage, s.match.stage);
          // The match is still on: keep the byte counters of its last moment.
          rec.wsInAtEnd = rec.wsIn;
          rec.wsOutAtEnd = rec.wsOut;
          rec.matchWallMs = Date.now() - matchStart;
          if (s.net && s.net.snapshotBytes) rec.snapshotBytes = s.net.snapshotBytes;
        }
        // The room goes back to its lobby after the match: keep the match's numbers as they peak.
        if (s && s.net) {
          rec.snapshots = Math.max(rec.snapshots ?? 0, s.net.snapshots);
          rec.inputs = Math.max(rec.inputs ?? 0, s.net.inputs);
          rec.predicting = rec.predicting || s.net.predicting;
          rec.matchRole = s.role;
          rec.events = s.events;
          rec.frameMs = Number(s.frame.ms.toFixed(1));
          rec.fps = Number((s.frame.fps ?? 0).toFixed(1));
        }
        if (s && s.me && !first[i]) first[i] = { x: s.me.x, z: s.me.z };
        // How far this player has travelled, sampled every poll (a lower bound on the real path).
        if (s && s.me && s.matchesEnded === 0) {
          const rec2 = pages[i].record;
          if (rec2.lastPos) rec2.travelled = (rec2.travelled ?? 0) + Math.hypot(s.me.x - rec2.lastPos.x, s.me.z - rec2.lastPos.z);
          rec2.lastPos = { x: s.me.x, z: s.me.z };
        }
      });
      while (moments.length > 0 && elapsed >= moments[0][0]) {
        const [, name] = moments.shift();
        if ((states[0]?.matchesEnded ?? 0) === 0) {
          await shot(host.page, `${name}-kaiju`);
          await shot(other.page, `${name}-human`);
        }
      }
      // Smoothness probe, once, when the kaiju is past the hatchling stage and the match is on.
      if (!probed && states[0]?.match && states[0].match.phase === 'playing' && states[0].match.stage >= 2 && states[0].matchesEnded === 0) {
        probed = true;
        const [own, seen] = await Promise.all([smoothness(host.page), other === host ? null : smoothness(other.page)]);
        summary.smoothness = { kaijuPage: own, humanPage: seen };
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
      // `matchesEnded` stays up after the room returns to its lobby, so a slow poll cannot miss the end.
      if (states.every((s) => s && s.matchesEnded >= 1)) {
        ended = true;
        break;
      }
      if (pages.some((p) => p.record.crashed)) break;
      await sleep(2000);
    }
    if (!ended) failures.push(`the match did not end on every page within ${opts.timeout} s`);
    await sleep(1500);
    await shot(host.page, '10-end-kaiju');
    await shot(other.page, '10-end-human');
    if (last !== other) await shot(last.page, '10-end-human-debug');

    // --- verdict -------------------------------------------------------------------------------
    for (let i = 0; i < pages.length; i++) {
      const { record } = pages[i];
      const s = lastStates[i];
      const moved = record.travelled ?? 0;
      delete record.lastPos;
      Object.assign(record, {
        screen: s?.screen ?? 'unknown',
        role: record.matchRole ?? record.role,
        result: s?.lastResult ?? null,
        snapshots: record.snapshots ?? 0,
        inputs: record.inputs ?? 0,
        predicting: record.predicting ?? false,
        frameMs: record.frameMs ?? 0,
        frames: s?.frame.count ?? 0,
        ping: s?.ping ?? 0,
        moved: Number(moved.toFixed(1)),
        events: record.events ?? {},
        pageErrors: s?.errors ?? [],
      });
      // Bandwidth over the match, as carried by the WebSocket (payload bytes, both directions).
      const wall = (record.matchWallMs ?? 0) / 1000;
      if (wall > 0) {
        record.kbpsDown = Number((((record.wsInAtEnd ?? record.wsIn) - record.wsInAtStart) * 8 / 1000 / wall).toFixed(1));
        record.kbpsUp = Number((((record.wsOutAtEnd ?? record.wsOut) - record.wsOutAtStart) * 8 / 1000 / wall).toFixed(1));
      }
      if (record.snapshotBytes && record.snapshots > 0) record.snapshotSize = Math.round(record.snapshotBytes / record.snapshots);
      for (const key of ['wsInAtStart', 'wsOutAtStart', 'wsInAtEnd', 'wsOutAtEnd', 'matchWallMs']) delete record[key];
      delete record.matchRole;
      if (record.errors.length > 0) failures.push(`page ${i} (${record.name}) logged ${record.errors.length} console error(s): ${record.errors.slice(0, 3).join(' | ')}`);
      if ((s?.errors ?? []).length > 0) failures.push(`page ${i} (${record.name}) saw uncaught errors: ${s.errors.slice(0, 3).join(' | ')}`);
      if (record.snapshots < 50) failures.push(`page ${i} (${record.name}) received only ${record.snapshots} snapshots`);
      if (record.maxCalls <= 0 || record.maxTriangles <= 0) failures.push(`page ${i} (${record.name}) never drew anything during the match`);
      summary.pages.push(record);
    }
    const s0 = lastStates[0];
    summary.result = s0?.lastResult ?? null;
    summary.matchSeconds = Number(((Date.now() - matchStart) / 1000).toFixed(1));
    if (opts.role === 'kaiju' && !(pages[0].record.events.structureStage > 0 || pages[0].record.events.propsDestroyed > 0)) {
      failures.push('the autoplay kaiju destroyed nothing');
    }
    if (!summary.result) failures.push('no page reported how the match ended');
    summary.maxStage = maxStage;
    if (opts.expect && summary.result && summary.result.winner !== opts.expect) failures.push(`expected ${opts.expect} to win, but ${summary.result.winner} won by ${summary.result.reason}`);
    if (opts.expectStage > 0 && maxStage < opts.expectStage) failures.push(`expected the match to reach stage ${opts.expectStage}, but it ended at stage ${maxStage}`);
    // The server's own account of its tick timing (GET /healthz, `perf`).
    try {
      const health = await (await fetch(`${origin}/healthz`)).json();
      if (health.perf) summary.serverPerf = health.perf;
    } catch {
      // The server is gone already: the failures above say why.
    }
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
  console.log(`result: ${summary.result ? `${summary.result.winner} won by ${summary.result.reason} after ${summary.result.duration.toFixed(0)} s of play` : 'no result'}; reached stage ${summary.maxStage ?? '?'}; wall time ${summary.matchSeconds ?? '?'} s`);
  for (const p of summary.pages) {
    const warnings = [...new Set(p.warnings)];
    console.log(
      `page ${p.index} ${String(p.name).padEnd(4)} ${String(p.role).padEnd(6)} screen=${p.screen} snapshots=${p.snapshots} inputs=${p.inputs} predicting=${p.predicting} moved=${p.moved}m ` +
        `script=${p.frameMs}ms fps=${p.fps ?? 0} max draw calls=${p.maxCalls} max triangles=${p.maxTriangles} max sprites=${p.maxSprites} errors=${p.errors.length} warnings=${p.warnings.length} (${warnings.length} distinct)`,
    );
    console.log(
      `       stage 3 peak: ${p.stage3Calls} draw calls, ${p.stage3Triangles} triangles; network: ${p.kbpsDown ?? '?'} kbit/s down, ${p.kbpsUp ?? '?'} kbit/s up` +
        (p.snapshotSize ? `, snapshot ${p.snapshotSize} bytes` : ''),
    );
  }
  if (summary.smoothness) console.log(`smoothness: ${JSON.stringify(summary.smoothness)}`);
  if (summary.serverPerf) console.log(`server: ${JSON.stringify(summary.serverPerf)}`);
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

// Only when run as a program: shots.mjs imports CHROMIUM_ARGS from this file.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
