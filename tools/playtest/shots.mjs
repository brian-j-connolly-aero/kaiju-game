#!/usr/bin/env node
/**
 * Stage screenshots without a server.
 *
 *   node tools/playtest/shots.mjs [options]
 *
 * Serves the production client build from a tiny static file server and opens it in sandbox
 * mode (`?sandbox=<stage>`: the simulation runs inside the page, one player against the bots),
 * once per stage and side, with the autopilot playing. It saves screenshots of the first-person
 * view, the third-person view and the map, and fails on any console error. This is how stages
 * 2 and 3 (tanks, the titan, sunset and night) are looked at without playing a whole match.
 *
 * Options
 *   --out DIR        where the pictures go (default /tmp/mb-scratch/playtest/shots)
 *   --stages 1,2,3   stages to visit (default all three)
 *   --roles kaiju,human
 *   --seconds N      how long each visit plays before the last picture (default 14)
 *   --width W --height H   page size (default 960 x 540)
 *   --no-assets      procedural fallbacks only
 *   --no-extras      skip the scripted extras (command wheel, charging lasers, molts, roar, beam, stagger)
 *
 * The Chromium flags are the ones documented in smoke.mjs.
 */

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROMIUM_ARGS } from './smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const dist = join(root, 'client', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json',
};

function parseArgs(argv) {
  const opts = { out: '/tmp/mb-scratch/playtest/shots', stages: [1, 2, 3], roles: ['kaiju', 'human'], seconds: 14, width: 960, height: 540, noAssets: false, extras: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') opts.out = resolve(next());
    else if (a === '--stages') opts.stages = next().split(',').map(Number).filter((n) => n >= 1 && n <= 3);
    else if (a === '--roles') opts.roles = next().split(',').filter((r) => r === 'kaiju' || r === 'human');
    else if (a === '--seconds') opts.seconds = Number(next()) || 14;
    else if (a === '--width') opts.width = Number(next()) || 960;
    else if (a === '--height') opts.height = Number(next()) || 540;
    else if (a === '--no-assets') opts.noAssets = true;
    else if (a === '--no-extras') opts.extras = false;
    else {
      console.error(`unknown option ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = normalize(join(dist, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(join(dist, 'index.html'))) throw new Error('client/dist is missing: run `npm run build` first');
  mkdirSync(opts.out, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require('playwright');
  const failures = [];
  const report = [];

  for (const stage of opts.stages) {
    for (const role of opts.roles) {
      const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
      const q = new URLSearchParams({ sandbox: String(stage), role, autoplay: '1', fps: '30', name: 'Shots' });
      if (opts.noAssets) q.set('assets', 'none');
      const tag = `s${stage}-${role}`;
      const shot = (name) => page.screenshot({ path: join(opts.out, `${tag}-${name}.png`) });
      try {
        await page.goto(`${origin}/?${q.toString()}`, { waitUntil: 'load' });
        const deadline = Date.now() + 60000;
        for (;;) {
          const s = await page.evaluate(() => (window.__mb ? window.__mb.state() : null));
          if (s && s.screen === 'match' && s.match && s.match.phase === 'playing') break;
          if (Date.now() > deadline) throw new Error(`stage ${stage} ${role}: the sandbox match did not start`);
          await sleep(300);
        }
        await sleep(Math.max(1000, opts.seconds * 400));
        await shot('1-first-person');
        await sleep(Math.max(1000, opts.seconds * 300));
        await shot('2-first-person');
        // Third person, then the map, then back.
        await page.evaluate(() => {
          const c = window.__mb.internals.ctx.runtime.controller;
          c.thirdPerson = true;
        });
        await sleep(Math.max(1000, opts.seconds * 200));
        await shot('3-third-person');
        await page.keyboard.press('KeyM');
        await sleep(1200);
        await shot('4-map');
        await page.keyboard.press('KeyM');
        await sleep(Math.max(500, opts.seconds * 100));
        await shot('5-third-person');
        const state = await page.evaluate(() => window.__mb.state());
        const timing = await page.evaluate(() => ({ ...window.__mb.internals.ctx.runtime.timing }));
        const info = await page.evaluate(() => window.__mb.renderer.info());
        report.push({ stage, role, phase: state.match?.phase, bar: state.match?.barPoints, frameMs: Number(state.frame.ms.toFixed(1)), calls: info.calls, triangles: info.triangles, sprites: info.sprites, props: info.props, errors: errors.length });
        console.log(`shots: stage ${stage} ${role}: ${info.calls} draw calls, ${info.triangles} triangles, ${info.sprites} sprites, ${info.props} props, frame ${state.frame.ms.toFixed(1)} ms (logic ${timing.logic.toFixed(1)}, scene ${timing.scene.toFixed(1)}, draw ${timing.draw.toFixed(1)}), ${errors.length} console errors`);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
      if (errors.length > 0) failures.push(`stage ${stage} ${role}: ${errors.length} console error(s): ${errors.slice(0, 3).join(' | ')}`);
      await browser.close();
    }
  }
  // --- extras: things the autopilot does not show by itself ------------------------------------
  if (opts.extras) {
    const visit = async (tag, query, steps) => {
      const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
      const q = new URLSearchParams({ fps: '30', name: 'Shots', ...query });
      if (opts.noAssets) q.set('assets', 'none');
      try {
        await page.goto(`${origin}/?${q.toString()}`, { waitUntil: 'load' });
        const deadline = Date.now() + 60000;
        for (;;) {
          const s = await page.evaluate(() => (window.__mb ? window.__mb.state() : null));
          if (s && s.screen === 'match' && s.match && s.match.phase === 'playing') break;
          if (Date.now() > deadline) throw new Error(`${tag}: the sandbox match did not start`);
          await sleep(300);
        }
        await steps(page, (name) => page.screenshot({ path: join(opts.out, `${tag}-${name}.png`) }));
        console.log(`shots: ${tag}: ${errors.length} console errors`);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
      if (errors.length > 0) failures.push(`${tag}: ${errors.length} console error(s): ${errors.slice(0, 3).join(' | ')}`);
      await browser.close();
    };

    // A person at the keyboard (no autopilot): the command wheel, charging lasers, then two molts.
    await visit('x-human-keys', { sandbox: '1', role: 'human' }, async (page, shot) => {
      await sleep(1500);
      await page.keyboard.down('KeyQ');
      await sleep(700);
      await shot('1-wheel');
      await page.keyboard.up('KeyQ');
      await page.keyboard.press('Digit4');
      await page.keyboard.down('KeyW');
      await sleep(1500);
      await page.keyboard.up('KeyW');
      await page.keyboard.press('KeyV');
      await sleep(3500);
      await shot('2-hold-and-charge');
      await page.evaluate(() => window.__mb.internals.ctx.client.local.toStage(2));
      await sleep(3000);
      await shot('3-after-molt-stage-2');
      await page.evaluate(() => window.__mb.internals.ctx.client.local.toStage(3));
      await sleep(6000);
      await shot('4-after-molt-stage-3');
    });

    // The roar: a squad stands round the juvenile, inside its roar; the player presses Roar.
    // The shockwave spreads and each unit jolts as it reaches it, then backs off shaken.
    await visit('x-kaiju-roar', { sandbox: '2', role: 'kaiju' }, async (page, shot) => {
      await sleep(2500);
      await page.evaluate(() => {
        window.__mb.internals.ctx.runtime.controller.thirdPerson = true;
        const w = window.__mb.internals.ctx.client.local.world;
        const k = w.kaijus[0];
        k.cooldowns.roar = 0;
        for (const u of w.units.slice(0, 8)) {
          const a = k.yaw + (u.id - 3.5) * 0.35;
          u.x = k.x + Math.sin(a) * (50 + (u.id % 4) * 12);
          u.z = k.z + Math.cos(a) * (50 + (u.id % 4) * 12);
        }
      });
      await sleep(1200);
      await shot('0-before');
      await page.keyboard.down('KeyQ');
      await sleep(150);
      await page.keyboard.up('KeyQ');
      await sleep(250);
      // Counted before the pictures: a screenshot can take longer than a unit stays shaken.
      const shaken = await page.evaluate(() => window.__mb.internals.ctx.client.local.world.units.slice(0, 8).filter((u) => u.shaken > 0).length);
      console.log(`shots: x-kaiju-roar: ${shaken} of 8 units shaken by the roar`);
      if (shaken === 0) throw new Error('x-kaiju-roar: the roar shook no unit');
      await shot('1-shockwave');
      await sleep(400);
      await shot('2-units-jolt');
      await sleep(1500);
      await shot('3-backing-off');
    });

    // The beam: fill the rage meter and let the autopilot breathe it.
    await visit('x-kaiju-beam', { sandbox: '2', role: 'kaiju', autoplay: '1' }, async (page, shot) => {
      await sleep(2500);
      await page.evaluate(() => {
        const w = window.__mb.internals.ctx.client.local.world;
        w.kaijus[0].rage = 100;
        // Put a squad in front of it so there is something to breathe on.
        const k = w.kaijus[0];
        for (const u of w.units.slice(0, 4)) {
          u.x = k.x + Math.sin(k.yaw) * 90 + (u.id - 1.5) * 12;
          u.z = k.z + Math.cos(k.yaw) * 90;
        }
      });
      for (let i = 0; i < 40; i++) {
        const s = await page.evaluate(() => window.__mb.state());
        if (s.kaiju && s.kaiju.action === 'special' && s.kaiju.phase === 'special') break;
        await sleep(150);
      }
      await sleep(500);
      await shot('1-beam-first-person');
      await page.evaluate(() => {
        window.__mb.internals.ctx.runtime.controller.thirdPerson = true;
      });
      await sleep(700);
      await shot('2-beam-third-person');
      // Then a stagger: the weak point shows.
      await page.evaluate(() => {
        const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
        k.phase = 'stagger';
        k.action = 'none';
        k.phaseTime = 0;
        k.phaseDuration = 5;
      });
      await sleep(1500);
      await shot('3-stagger');
    });
  }

  server.close();
  writeFileSync(join(opts.out, 'summary.json'), `${JSON.stringify({ ok: failures.length === 0, report, failures }, null, 2)}\n`);
  console.log(`shots: pictures in ${opts.out}`);
  if (failures.length > 0) {
    console.log('FAILED:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('PASSED: every stage drew without console errors.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
