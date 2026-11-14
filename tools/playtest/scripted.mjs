#!/usr/bin/env node
/**
 * Scripted playtest with real inputs (the companion of smoke.mjs, which uses the autopilot).
 *
 *   node tools/playtest/scripted.mjs [options]
 *
 * Starts the game server with MB_FAST=1 on a free port against the production build and plays
 * two short sessions in one headless Chromium page each, one after the other, with the hands
 * of driver.mjs: real key presses, mouse buttons, mouse movement and clicks on the real lobby
 * buttons. Nothing is sent to the server by the script itself and the autopilot is off.
 *
 *   kaiju   creates a room, volunteers, starts. Then: look, walk, swipe, stomp, grab, throw,
 *           eat, roar, brace, molt (when the bar offers it), the special (when rage allows),
 *           the view toggle (V) and the controls card (H, then Enter).
 *   human   creates a room, switches the practice option on (a bot plays the kaiju) and off
 *           again; a second page joins by the invite address, volunteers for the kaiju, gets
 *           ready and then never touches the controls. The host starts. Then: drive, fire, the
 *           four commands by their keys, every entry of the command wheel (right button held,
 *           pointer moved toward the entry, let go; and once more with Q), a charged volley,
 *           the map and a marker on it, the view toggle and the controls card. After that the player
 *           lets go and the match runs to its end. (On Port Meridian the practice bot kaiju
 *           molts within a minute of a fast match, and every molt redeploys the squads, which
 *           undid the human checks half way through: an idle kaiju keeps the match at stage 1.)
 *
 * What counts as working. Every action is judged ONLY by what the server said afterwards: the
 * newest snapshot it sent and the simulation events it sent (driver.mjs reads both). What the
 * page predicts or draws on its own is never evidence. Each check ends in one of three ways:
 *
 *   pass            the server confirmed the effect
 *   FAIL            the input was given and the server did not confirm it in time
 *   not attempted   the situation the action needs never came up (the reason is printed)
 *
 * Only `pass` means the action works. The run exits 0 only when nothing failed AND nothing
 * was left unattempted; otherwise it exits 1 and says which. It never retries a failed check
 * until it turns green. The one exception is not a retry of a failure: the bot squads fight on
 * throughout, and when their volleys stagger the kaiju (five seconds in which it cannot act) in
 * the middle of a hold, the server's kaijuStagger event shows the attempt never tested the
 * button, and the hold is given once more.
 *
 * Options
 *   --only kaiju|human   play one session
 *   --out DIR            screenshots and report.json (default /tmp/mb-scratch/playtest/scripted)
 *   --width W --height H page size (default 640 x 360)
 *   --no-build           fail instead of building when client/dist or server/dist is missing
 *   --finish S           seconds to wait for the human session's match to end (default 200)
 *
 * The Chromium flags and why they are needed are documented in smoke.mjs.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disablePointerLock, Driver, sleep, wrapAngle } from './driver.mjs';
import { CHROMIUM_ARGS } from './smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const opts = { only: '', out: '/tmp/mb-scratch/playtest/scripted', width: 640, height: 360, build: true, finish: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--only') opts.only = next() === 'human' ? 'human' : 'kaiju';
    else if (a === '--out') opts.out = resolve(next());
    else if (a === '--width') opts.width = Number(next()) || 640;
    else if (a === '--height') opts.height = Number(next()) || 360;
    else if (a === '--no-build') opts.build = false;
    else if (a === '--finish') opts.finish = Number(next()) || 200;
    else {
      console.error(`unknown option ${a} (see the header of tools/playtest/scripted.mjs)`);
      process.exit(2);
    }
  }
  return opts;
}

function freePort() {
  return new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

/** One session's list of checks. */
class Report {
  constructor(session) {
    this.session = session;
    this.checks = [];
  }

  add(name, outcome, detail) {
    this.checks.push({ name, outcome, detail });
    const tag = outcome === 'pass' ? 'pass         ' : outcome === 'fail' ? 'FAIL         ' : 'not attempted';
    console.log(`  [${this.session}] ${tag} ${name}: ${detail}`);
  }

  pass(name, detail) {
    this.add(name, 'pass', detail);
  }

  fail(name, detail) {
    this.add(name, 'fail', detail);
  }

  skip(name, why) {
    this.add(name, 'not attempted', why);
  }
}

const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : String(v));

async function openSession(origin, opts, name, errors) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  // As in a browser without pointer lock: the view turns while a mouse button is held (driver.mjs).
  await context.addInitScript(disablePointerLock);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: uncaught: ${e.message}`));
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    if (failure && !/ERR_ABORTED/.test(failure.errorText)) errors.push(`${name}: request failed: ${req.url()} (${failure.errorText})`);
  });
  // No autoplay: a person. Sound off, modest frame cap for software rendering.
  await page.goto(`${origin}/?name=${name}&mute=1&fps=30`, { waitUntil: 'load' });
  const driver = new Driver(page, { width: opts.width, height: opts.height });
  return { browser, page, driver };
}

/** Clicks through the home screen and the lobby as a person does, then waits for play to begin. */
async function startMatch(page, driver, report, { kaiju, practice, guest }) {
  await page.waitForSelector('.home .btn-big', { timeout: 60000 });
  await page.click('.home .btn-big');
  await page.waitForSelector('.lobby .start', { timeout: 30000 });
  const lobby = await driver.until((p) => (p.screen === 'lobby' && p.code ? p : null), 15000);
  if (!lobby) {
    report.fail('create a room', 'the lobby never appeared after clicking Create');
    return false;
  }
  report.pass('create a room', `clicked Create; the server opened room ${lobby.code} and made this player host (${lobby.host})`);

  if (kaiju) {
    await page.click('.lobby .role-toggle');
    const ok = await page.waitForFunction(() => window.__mb.internals.ctx.client.me()?.wantsKaiju === true, null, { timeout: 8000 }).catch(() => null);
    if (ok) report.pass('volunteer for the kaiju', 'clicked the role button; the lobby message from the server shows wantsKaiju');
    else report.fail('volunteer for the kaiju', 'the lobby state from the server never showed wantsKaiju');
  }
  if (practice) {
    await page.click('.lobby .practice-toggle');
    const ok = await page.waitForFunction(() => window.__mb.internals.ctx.client.lobby?.options.botKaiju === true, null, { timeout: 8000 }).catch(() => null);
    if (ok) report.pass('practice option', 'clicked the practice button; the lobby message from the server shows botKaiju');
    else report.fail('practice option', 'the lobby state from the server never showed botKaiju');
  }
  if (guest) {
    // The practice option off again, and a person (the guest page) in the kaiju's seat.
    if (practice) {
      await page.click('.lobby .practice-toggle');
      const off = await page.waitForFunction(() => window.__mb.internals.ctx.client.lobby?.options.botKaiju === false, null, { timeout: 8000 }).catch(() => null);
      if (off) report.pass('practice option off', 'clicked the practice button again; the lobby message from the server shows botKaiju off');
      else report.fail('practice option off', 'the lobby state from the server still showed botKaiju');
    }
    await guest(lobby.code);
    const seated = await page
      .waitForFunction(() => (window.__mb.internals.ctx.client.lobby?.players ?? []).some((pl) => pl.seat !== window.__mb.internals.ctx.client.seat && pl.ready && pl.wantsKaiju), null, { timeout: 30000 })
      .catch(() => null);
    if (seated) report.pass('a guest joins by the invite address', 'the second page opened the room from its address, volunteered for the kaiju and got ready: the host\'s lobby message shows it');
    else report.fail('a guest joins by the invite address', 'the host\'s lobby never showed a ready kaiju volunteer');
    await page.waitForFunction(() => !document.querySelector('.lobby .start')?.disabled, null, { timeout: 10000 }).catch(() => null);
  }
  await page.click('.lobby .start');
  const playing = await driver.until((p) => (p.match && p.match.phase === 'playing' && p.screen === 'match' ? p : null), 40000, 150);
  if (!playing) {
    report.fail('start the match', 'no snapshot with phase "playing" arrived after clicking Start');
    return false;
  }
  report.pass('start the match', `clicked Start; the server is playing stage ${playing.match.stage}, this page is the ${playing.role} (controller ${playing.controller})`);
  if (playing.role !== (kaiju ? 'kaiju' : 'human')) {
    report.fail('seat', `expected to play the ${kaiju ? 'kaiju' : 'human'} side but the server seated this page as ${playing.role}`);
    return false;
  }
  // Everything below needs a click in the open view to reach the canvas, not the HUD overlay.
  // Asked again for up to two seconds: what matters is that the match view takes the clicks,
  // and the answer says what was in the way and for how long if it was not there at once.
  const hitAt = () =>
    page.evaluate(({ x, y }) => {
      const at = document.elementFromPoint(x, y);
      if (!at) return 'nothing';
      const path = [];
      for (let n = at; n && n !== document.body && path.length < 4; n = n.parentElement) path.push(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).join('.')}` : ''}`);
      return path.join(' in ');
    }, { x: driver.width / 2, y: driver.height / 2 });
  const first = await hitAt();
  let hit = first;
  const askedAt = Date.now();
  while (hit !== 'canvas#view' && Date.now() - askedAt < 2000) {
    await sleep(100);
    hit = await hitAt();
  }
  if (hit === 'canvas#view') report.pass('the view takes the mouse', `the element under the middle of the screen is the game canvas${first !== hit ? ` (after ${Date.now() - askedAt} ms; at first it was ${first})` : ''}`);
  else report.fail('the view takes the mouse', `the element under the middle of the screen is ${hit}, not the canvas: clicks would not reach the game`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// The kaiju session
// ---------------------------------------------------------------------------------------------

async function playKaiju(origin, opts, errors) {
  const report = new Report('kaiju');
  const { browser, page, driver } = await openSession(origin, opts, 'Rex', errors);
  const shot = (name) => driver.screenshot(join(opts.out, `kaiju-${name}.png`));
  try {
    if (!(await startMatch(page, driver, report, { kaiju: true, practice: false }))) return report;
    await shot('00-start');
    let p = await driver.probe();
    const start = { x: p.kaiju.x, z: p.kaiju.z, yaw: p.kaiju.yaw };
    // The bot squads keep fighting the whole time. When two of their volleys land together the
    // server staggers the kaiju for five seconds, and a staggered kaiju cannot act: a hold given
    // then proves nothing either way. So a hold is only given to a kaiju the server shows free
    // (idle, not staggered), and an attempt the server interrupted with a stagger (the
    // kaijuStagger event says so) is given once more. It is never repeated for any other reason.
    const free = () => driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 12000);
    const staggeredSince = (from) => driver.eventsSince(from, 'kaijuStagger', (e) => e.on).length > 0;
    // Before reaching for something: the server's kaiju has stopped and faces it. walkTo stops
    // on the PREDICTED position while the body is still moving, so the kaiju often ends up a
    // couple of meters further on, beside or past the thing; the head can lead the body by only
    // 50 degrees, and the grab arc is 100 degrees wide around the head. A reach given before the
    // body has turned back finds nothing, and that says nothing about the button.
    const faceOnServer = async (x, z) => {
      for (let i = 0; i < 4; i++) {
        await driver.lookAt(x, z);
        let last = null;
        const q = await driver.until((s) => {
          if (!s.kaiju) return null;
          const still = last !== null && Math.hypot(s.kaiju.x - last.x, s.kaiju.z - last.z) < 0.05;
          last = { x: s.kaiju.x, z: s.kaiju.z };
          const toward = Math.atan2(x - s.kaiju.x, z - s.kaiju.z);
          const close = Math.hypot(x - s.kaiju.x, z - s.kaiju.z) < 1.5;
          const facing = close || (Math.abs(wrapAngle(s.kaiju.yaw - toward)) < 0.4 && Math.abs(wrapAngle(s.kaiju.aimYaw - toward)) < 0.4);
          return still && facing ? s : null;
        }, 3000);
        if (q) return q;
      }
      return null;
    };

    // --- look ----------------------------------------------------------------------------------
    {
      const wanted = wrapAngle(p.view.yaw + 0.6);
      await driver.lookTo(wanted, 0, 0.06, 5000);
      // Server-confirmed: the kaiju's own aim in a snapshot follows (the body lumbers after it).
      const seen = await driver.until((q) => (q.kaiju && Math.abs(wrapAngle(q.kaiju.aimYaw - start.yaw)) > 0.25 ? q : null), 4000);
      if (seen) report.pass('look (mouse)', `dragged the view ${fmt(0.6, 2)} rad; the server's kaiju aimYaw moved ${fmt(wrapAngle(seen.kaiju.aimYaw - start.yaw), 2)} rad from where it began`);
      else report.fail('look (mouse)', 'the kaiju aim in the snapshots did not follow the mouse');
    }

    // --- walk ----------------------------------------------------------------------------------
    {
      await driver.keyDown('KeyW');
      const moved = await driver.until((q) => (q.kaiju && Math.hypot(q.kaiju.x - start.x, q.kaiju.z - start.z) > 6 ? q : null), 6000);
      await driver.keyUp('KeyW');
      if (moved) report.pass('move (W)', `held W; the server moved the kaiju ${fmt(Math.hypot(moved.kaiju.x - start.x, moved.kaiju.z - start.z))} m`);
      else {
        p = await driver.probe();
        report.fail('move (W)', `held W for 6 s; the server's kaiju moved only ${fmt(Math.hypot(p.kaiju.x - start.x, p.kaiju.z - start.z))} m`);
      }
    }

    // --- swipe ---------------------------------------------------------------------------------
    {
      const from = driver.events.length;
      await driver.click('left', 90);
      const active = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'swipe' && e.phase === 'active')[0], 4000);
      if (active) report.pass('swipe (tap strike)', `tapped the left button; the server sent kaijuAction swipe active (tick ${active.tick})`);
      else report.fail('swipe (tap strike)', `no kaijuAction swipe/active from the server; actions seen: ${driver.eventsSince(from, 'kaijuAction').map((e) => `${e.action}/${e.phase}`).join(', ') || 'none'}`);
      await shot('01-swipe');
      await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 3000);
    }

    // --- stomp ---------------------------------------------------------------------------------
    {
      const from = driver.events.length;
      await driver.click('left', 650);
      const active = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'stomp' && e.phase === 'active')[0], 5000);
      if (active) report.pass('stomp (hold strike)', `held the left button 0.65 s; the server sent kaijuAction stomp active (tick ${active.tick})`);
      else report.fail('stomp (hold strike)', `no kaijuAction stomp/active from the server; actions seen: ${driver.eventsSince(from, 'kaijuAction').map((e) => `${e.action}/${e.phase}`).join(', ') || 'none'}`);
      await shot('02-stomp');
      await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 4000);
    }

    // --- roar ----------------------------------------------------------------------------------
    {
      const from = driver.events.length;
      await driver.tapKey('KeyQ', 120);
      const roar = await driver.until(() => driver.eventsSince(from, 'roar')[0], 4000);
      p = await driver.probe();
      if (roar && p.kaiju.cooldowns.roar > 0) report.pass('roar (Q)', `pressed Q; the server sent a roar event (radius ${fmt(roar.radius, 0)} m) and the snapshot shows the roar cooldown at ${fmt(p.kaiju.cooldowns.roar)} s`);
      else report.fail('roar (Q)', `roar event ${roar ? 'seen' : 'NOT seen'}; snapshot roar cooldown ${fmt(p.kaiju.cooldowns.roar)}`);
      await shot('03-roar');
      await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 4000);
    }

    // --- brace ---------------------------------------------------------------------------------
    for (let attempt = 1; attempt <= 2; attempt++) {
      await free();
      const from = driver.events.length;
      await driver.keyDown('Space');
      const braced = await driver.until((q) => (q.kaiju && q.kaiju.phase === 'brace' ? q : null), 3000);
      await shot('04-brace');
      await driver.keyUp('Space');
      const released = await driver.until((q) => (q.kaiju && q.kaiju.phase !== 'brace' ? q : null), 3000);
      const again = attempt === 1 && staggeredSince(from);
      if (braced && released) report.pass('brace (hold Space)', `held Space: the snapshots show phase brace; released: the snapshots show it ended${attempt > 1 ? ' (second attempt: the army staggered the kaiju during the first)' : ''}`);
      else if (again) continue;
      else report.fail('brace (hold Space)', `snapshot showed brace while held: ${!!braced}; ended after release: ${!!released}${staggeredSince(from) ? ' (the army staggered the kaiju during this attempt too)' : ''}`);
      break;
    }

    // --- grab and throw ------------------------------------------------------------------------
    let grabbed = false;
    {
      await free();
      p = await driver.probe();
      const around = await driver.surroundings(p.kaiju.x, p.kaiju.z, 70, 40);
      // What a hatchling's hand can take: a car (the grab picks the nearest loose object in its arc).
      const cars = around.props.filter((c) => /car|van|taxi|bus|truck/.test(String(c.kind)));
      if (cars.length === 0) {
        report.skip('grab (tap right button)', `no car within 70 m of the kaiju (${around.props.length} props nearby); nothing a hatchling can pick up`);
        report.skip('throw (strike while holding)', 'nothing was grabbed');
      } else {
        const car = cars[0];
        // Stop short of it: a hatchling crushes a car it walks onto, and would then pick up the
        // wreck instead. The grab reaches 2.5 body radii (6 m at stage 1).
        await driver.walkTo(car.x, car.z, 5, { timeoutMs: 15000 });
        await faceOnServer(car.x, car.z);
        const from = driver.events.length;
        await driver.click('right', 110);
        const held = await driver.until((q) => (q.kaiju && q.kaiju.held ? q : null), 4000);
        // The snapshot is the present; events are handed over when the delayed view (about
        // 100 ms behind, 1.2 s at the latest) reaches their tick. So the event is WAITED for,
        // like every other event here. Both are required: the event is how the page learns
        // that the car or wreck has left the ground.
        const heldEvent = held ? await driver.until(() => driver.eventsSince(from, 'kaijuHeld', (e) => e.reason === 'grab')[0], 3000) : null;
        if (held && heldEvent) {
          grabbed = true;
          report.pass('grab (tap right button)', `walked up to a ${car.kind} and tapped the right button; the server sent kaijuHeld (source ${heldEvent.source}) and the snapshot shows the kaiju holding a ${held.kaiju.held.kind}${heldEvent.source === 'prop' ? '' : ' (not the live car: it took what was nearest)'}`);
        } else {
          p = await driver.probe();
          report.fail('grab (tap right button)', `tapped the right button ${fmt(Math.hypot(car.x - p.kaiju.x, car.z - p.kaiju.z))} m from a ${car.kind}; kaijuHeld event ${heldEvent ? 'seen' : 'NOT seen'}, snapshot held=${JSON.stringify(p.kaiju.held)}; actions: ${driver.eventsSince(from, 'kaijuAction').map((e) => `${e.action}/${e.phase}`).join(', ') || 'none'}`);
        }
        await shot('05-grab');
        if (grabbed) {
          await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 3000);
          const from2 = driver.events.length;
          await driver.click('left', 90);
          const spawn = await driver.until(() => driver.eventsSince(from2, 'projectileSpawn', (e) => e.owner === 'kaiju')[0], 4000);
          const landed = spawn ? await driver.until(() => driver.eventsSince(from2, 'projectileHit')[0], 8000) : null;
          const empty = await driver.until((q) => (q.kaiju && !q.kaiju.held ? q : null), 3000);
          if (spawn && landed && empty) report.pass('throw (strike while holding)', `tapped the left button; the server spawned a thrown projectile, reported its impact on "${landed.target}", and the snapshot shows the hand empty`);
          else report.fail('throw (strike while holding)', `projectileSpawn ${spawn ? 'seen' : 'NOT seen'}, projectileHit ${landed ? 'seen' : 'NOT seen'}, hand empty in snapshot: ${!!empty}`);
          await shot('06-throw');
        } else {
          report.skip('throw (strike while holding)', 'the grab did not succeed');
        }
      }
    }

    // --- eat -----------------------------------------------------------------------------------
    for (let attempt = 1; attempt <= 2; attempt++) {
      await free();
      p = await driver.probe();
      const around = await driver.surroundings(p.kaiju.x, p.kaiju.z, 90, 40);
      const meals = around.props.filter((c) => /car|van|taxi|bus|truck|kiosk/.test(String(c.kind)));
      if (p.kaiju.cooldowns.eat > 0) report.skip('eat (hold right button)', `the eat cooldown is at ${fmt(p.kaiju.cooldowns.eat)} s`);
      else if (meals.length === 0) report.skip('eat (hold right button)', 'no car or kiosk within 90 m to eat');
      else {
        const meal = meals[0];
        await driver.walkTo(meal.x, meal.z, 5, { timeoutMs: 15000 });
        await faceOnServer(meal.x, meal.z);
        const from = driver.events.length;
        await driver.click('right', 950);
        const eating = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'eat')[0], 5000);
        p = await driver.probe();
        if (eating && p.kaiju.cooldowns.eat > 0) report.pass('eat (hold right button)', `held the right button 0.95 s next to a ${meal.kind}; the server sent kaijuAction eat and the snapshot shows the eat cooldown at ${fmt(p.kaiju.cooldowns.eat)} s${attempt > 1 ? ' (second attempt: the army staggered the kaiju during the first)' : ''}`);
        else if (!eating && attempt === 1 && staggeredSince(from)) continue;
        else report.fail('eat (hold right button)', `kaijuAction eat ${eating ? 'seen' : 'NOT seen'}; snapshot eat cooldown ${fmt(p.kaiju.cooldowns.eat)}; actions: ${driver.eventsSince(from, 'kaijuAction').map((e) => `${e.action}/${e.phase}`).join(', ') || 'none'}${staggeredSince(from) ? ' (the army staggered the kaiju during this attempt)' : ''}`);
        await shot('07-eat');
        await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 5000);
      }
      break;
    }

    // --- wreck until the bar offers the molt, then molt -----------------------------------------
    {
      const deadline = Date.now() + 75000;
      let offered = (await driver.probe()).kaiju.moltAvailable;
      while (!offered && Date.now() < deadline) {
        p = await driver.probe();
        if (!p.match || p.match.phase !== 'playing' || p.matchesEnded > 0) break;
        const around = await driver.surroundings(p.kaiju.x, p.kaiju.z, 160, 30);
        const target = around.structures.find((s) => s.value > 0 && !s.passable);
        if (!target) break;
        // Walk up to it (a hatchling tramples only what is low) and swipe until it is down or the molt is offered.
        await driver.walkTo(target.x, target.z, 1, { timeoutMs: 12000, done: (q) => q.kaiju.moltAvailable || Math.hypot(target.x - q.predicted.x, target.z - q.predicted.z) < Math.max(target.hx, target.hz) + 6 });
        await driver.lookAt(target.x, target.z);
        for (let i = 0; i < 6; i++) {
          await driver.click('left', 90);
          const q = await driver.until((s) => (s.kaiju.phase === 'idle' || s.kaiju.moltAvailable ? s : null), 2500);
          if (!q || q.kaiju.moltAvailable) break;
        }
        offered = (await driver.probe()).kaiju.moltAvailable;
      }
      p = await driver.probe();
      if (!offered) {
        report.skip('molt (hold F)', `the bar did not reach the first mark in the time allowed (bar ${fmt(p.match.barPoints, 0)} of ${fmt(p.match.marks[0], 0)}, clock ${fmt(p.match.clock, 0)} s)`);
      } else {
        report.pass('wreck the city to the first mark', `swipes and trampling by real input took the server's bar to ${fmt(p.match.barPoints, 0)} (mark ${fmt(p.match.marks[0], 0)}); the server offers the molt`);
        await shot('08-molt-offered');
        for (let attempt = 1; attempt <= 2; attempt++) {
          await free();
          const from = driver.events.length;
          await driver.keyDown('KeyF');
          const cocoon = await driver.until(() => driver.eventsSince(from, 'cocoon')[0], 5000);
          await driver.keyUp('KeyF');
          await shot('09-cocoon');
          const blast = cocoon ? await driver.until(() => driver.eventsSince(from, 'moltBlast')[0], 15000) : null;
          const grown = blast ? await driver.until((q) => (q.match.stage === 2 && q.match.phase === 'playing' && q.kaiju.stage === 2 ? q : null), 15000) : null;
          if (cocoon && blast && grown) report.pass('molt (hold F)', `held F: the server sent cocoon, then moltBlast, then stage 2 with the kaiju at its new size${attempt > 1 ? ' (second attempt: the army staggered the kaiju during the first)' : ''}`);
          else if (!cocoon && attempt === 1 && staggeredSince(from)) continue;
          else report.fail('molt (hold F)', `cocoon ${cocoon ? 'seen' : 'NOT seen'}, moltBlast ${blast ? 'seen' : 'NOT seen'}, stage 2 playing ${grown ? 'reached' : 'NOT reached'}${staggeredSince(from) ? ' (the army staggered the kaiju during this attempt)' : ''}`);
          break;
        }
        await sleep(600);
        await shot('10-stage2');
      }
    }

    // --- the special ---------------------------------------------------------------------------
    {
      p = await driver.probe();
      if (!p.match || p.match.phase !== 'playing' || p.matchesEnded > 0) {
        report.skip('special (E)', 'the match was no longer in play');
      } else if (p.kaiju.rage < 100) {
        // Rage comes from being hit and from wrecking. Against a real server it cannot be granted.
        report.skip('special (E)', `rage is ${fmt(p.kaiju.rage, 0)} of the 100 the beam costs after this short session; not exercised with real input here`);
      } else {
        const from = driver.events.length;
        await driver.tapKey('KeyE', 120);
        const beam = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'special')[0], 4000);
        const spent = await driver.until((q) => (q.kaiju.rage < 50 ? q : null), 6000);
        // The rage is spent when the wind-up starts; the beam itself comes 0.8 s later, in the
        // phase named 'special'. The picture is taken while the snapshots show the beam ON.
        const on = await driver.until((q) => (q.kaiju.action === 'special' && q.kaiju.phase === 'special' ? q : null), 5000);
        if (on) {
          await sleep(500);
          await shot('11-special-beam-on');
        }
        if (beam && spent && on) report.pass('special (E)', 'pressed E with full rage; the server sent kaijuAction special, the snapshot shows the rage spent, and then the beam phase running');
        else report.fail('special (E)', `kaijuAction special ${beam ? 'seen' : 'NOT seen'}; rage spent in snapshot: ${!!spent}; beam phase seen in a snapshot: ${!!on}`);
      }
    }
    await viewAndCardChecks(page, driver, report, shot);
    p = await driver.probe();
    report.final = { stage: p.match?.stage, clock: p.match?.clock, bar: p.match?.barPoints, kaijuHp: p.kaiju?.hp, fps: p.fps, pageErrors: p.errors };
  } finally {
    await browser.close().catch(() => {});
  }
  return report;
}

/** Runs in the page: the 3D camera's heading and elevation (yaw 0 faces +Z). */
function cameraLookInPage() {
  const cam = window.__mb.internals.ctx.renderer?.camera;
  if (!cam) return null;
  const e = cam.matrixWorld.elements;
  // The camera looks down its own -Z axis.
  const x = -e[8];
  const y = -e[9];
  const z = -e[10];
  return { yaw: Math.atan2(x, z), pitch: Math.asin(Math.max(-1, Math.min(1, y))) };
}

/**
 * Both sides: the view toggle keeps the look direction (V, client only), and the controls card
 * opens and closes with H and with Enter while the match runs on (client only: the card is a
 * page overlay, there is nothing for the server to confirm).
 */
async function viewAndCardChecks(page, driver, report, shot) {
  {
    // Look somewhere that is not level first, so a view that resets its pitch would show.
    await driver.drag(0, 0.25);
    // The kaiju's views look where its head looks, and the head is held within 50 degrees of
    // a body that may still be turning, or is the server's while the kaiju is staggered: so
    // the camera is compared only once the kaiju is free and its body has stopped turning.
    let lastYaw = null;
    const steady = await driver.until((q) => {
      if (q.role !== 'kaiju' || !q.kaiju) return q;
      const still = lastYaw !== null && Math.abs(wrapAngle(q.kaiju.yaw - lastYaw)) < 0.002;
      lastYaw = q.kaiju.yaw;
      return still && q.kaiju.phase === 'idle' ? q : null;
    }, 12000, 150);
    if (!steady) {
      report.skip('view toggle (V) keeps the look direction', 'the kaiju was never free and still for long enough (staggered or turning) to compare the views');
      return cardChecks(page, driver, report, shot);
    }
    const was = (await driver.probe()).thirdPerson;
    const before = await page.evaluate(cameraLookInPage);
    await driver.tapKey('KeyV', 110);
    const now = (await driver.until((q) => (q.thirdPerson !== was ? q : null), 2000)) !== null;
    const after = await page.evaluate(cameraLookInPage);
    const p = await driver.probe();
    await shot(was ? 'view-first-person' : 'view-third-person');
    const turned = before && after ? Math.hypot(wrapAngle(after.yaw - before.yaw), after.pitch - before.pitch) : NaN;
    // (The bot squads' fire shakes the camera a little; a different view is tens of degrees off.)
    if (now && turned < 0.06) report.pass('view toggle (V) keeps the look direction', `switched to ${was ? 'first' : 'third'} person; the camera looked (${fmt(before.yaw, 2)}, ${fmt(before.pitch, 2)}) rad before and (${fmt(after.yaw, 2)}, ${fmt(after.pitch, 2)}) after, ${fmt(turned, 3)} rad apart (client-side view)`);
    else report.fail('view toggle (V) keeps the look direction', `switched: ${now}; camera before ${JSON.stringify(before)}, after ${JSON.stringify(after)} (${fmt(turned, 3)} rad apart; kaiju phase ${p.kaiju?.phase ?? 'none'})`);
    if (now) await driver.tapKey('KeyV', 110);
    await sleep(300);
  }
  return cardChecks(page, driver, report, shot);
}

/** The controls card opens and closes with H and with Enter in a running match. */
async function cardChecks(page, driver, report, shot) {
  const cardOpen = () =>
    page.evaluate(() => {
      const card = window.__mb.internals.ctx.controls;
      return card.open === true && !card.root.classList.contains('hidden');
    });
  for (const [key, name] of [
    ['KeyH', 'H'],
    ['Enter', 'Enter'],
  ]) {
    await driver.tapKey(key, 110);
    await sleep(400);
    const opened = await cardOpen();
    if (opened) await shot(`controls-card-${name}`);
    const stillPlaying = (await driver.probe()).match?.phase === 'playing';
    await driver.tapKey(key, 110);
    await sleep(400);
    const closed = !(await cardOpen());
    if (opened && closed) report.pass(`controls card (${name})`, `${name} opened the controls card over the running match (phase still "${stillPlaying ? 'playing' : 'not playing'}") and ${name} again closed it (client-side overlay)`);
    else report.fail(`controls card (${name})`, `after ${name}: open ${opened}; after a second ${name}: closed ${closed}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The human session
// ---------------------------------------------------------------------------------------------

/**
 * Runs in the page: the heading nearest `yaw` along which the next 30 m are clear of standing,
 * solid structures (3 m to spare), or null when there is none.
 */
function openHeadingInPage({ x, z, yaw }) {
  const mirror = window.__mb.internals.ctx.runtime?.session?.mirror;
  if (!mirror) return null;
  const near = mirror.city.structures.filter((st) => !st.passable && mirror.structureStage[st.id] < 3 && Math.hypot(st.x - x, st.z - z) < 30 + Math.hypot(st.hx, st.hz) + 3);
  const blocked = (px, pz) =>
    near.some((st) => {
      const dx = px - st.x;
      const dz = pz - st.z;
      const c = Math.cos(st.yaw);
      const s = Math.sin(st.yaw);
      // Into the structure's own frame (its yaw turns +z toward +x).
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      return Math.abs(lx) < st.hx + 3 && Math.abs(lz) < st.hz + 3;
    });
  let best = null;
  for (let i = 0; i < 48; i++) {
    const turn = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 24);
    const h = yaw + turn;
    let clear = true;
    for (let d = 2; d <= 30 && clear; d += 2) clear = !blocked(x + Math.sin(h) * d, z + Math.cos(h) * d);
    if (clear) {
      best = h;
      break;
    }
  }
  return best;
}

async function playHuman(origin, opts, errors) {
  const report = new Report('human');
  const { browser, page, driver } = await openSession(origin, opts, 'Ada', errors);
  const shot = (name) => driver.screenshot(join(opts.out, `human-${name}.png`));
  try {
    // The guest: a second person who takes the kaiju and then leaves the controls alone.
    let guestBrowser = null;
    const guest = async (code) => {
      const { chromium } = require('playwright');
      guestBrowser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const gp = await guestBrowser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
      gp.on('console', (m) => {
        if (m.type() === 'error') errors.push(`Idle: ${m.text()}`);
      });
      gp.on('pageerror', (e) => errors.push(`Idle: uncaught: ${e.message}`));
      await gp.goto(`${origin}/?name=Idle&mute=1&fps=10&res=0.5#${code}`, { waitUntil: 'load' });
      await gp.waitForSelector('.lobby .role-toggle', { timeout: 60000 });
      await gp.click('.lobby .role-toggle');
      await gp.waitForFunction(() => window.__mb.internals.ctx.client.me()?.wantsKaiju === true, null, { timeout: 8000 }).catch(() => null);
      await gp.click('.lobby .ready-toggle');
    };
    try {
      if (!(await startMatch(page, driver, report, { kaiju: false, practice: true, guest }))) return report;
      await shot('00-start');
      await playHumanChecks(page, driver, report, opts, shot);
    } finally {
      await guestBrowser?.close().catch(() => {});
    }
    return report;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** The human session's checks, from the start of play to the end of the match. */
async function playHumanChecks(page, driver, report, opts, shot) {
  {
    let p = await driver.probe();
    if (!p.me) {
      report.fail('own unit', 'the snapshot has no driven unit for this squad');
      return report;
    }
    const start = { x: p.me.x, z: p.me.z, id: p.me.id };

    // --- drive ---------------------------------------------------------------------------------
    {
      // Port Meridian is dense: a squad may start facing a house. Turn to the nearest open
      // heading first, so "W drives" is not judged against a wall.
      const open = await page.evaluate(openHeadingInPage, { x: start.x, z: start.z, yaw: p.view?.yaw ?? 0 });
      if (open !== null && Math.abs(wrapAngle(open - (p.view?.yaw ?? 0))) > 0.05) await driver.lookTo(open, 0, 0.06, 5000);
      await driver.keyDown('KeyW');
      const moved = await driver.until((q) => (q.me && Math.hypot(q.me.x - start.x, q.me.z - start.z) > 5 ? q : null), 6000);
      await driver.keyUp('KeyW');
      if (moved) report.pass('drive (W)', `held W; the server moved unit ${start.id} by ${fmt(Math.hypot(moved.me.x - start.x, moved.me.z - start.z))} m`);
      else {
        p = await driver.probe();
        report.fail('drive (W)', `held W for 6 s; the server's unit moved only ${fmt(Math.hypot(p.me.x - start.x, p.me.z - start.z))} m`);
      }
    }

    // --- look and fire -------------------------------------------------------------------------
    {
      p = await driver.probe();
      await driver.lookTo(wrapAngle(p.view.yaw + 0.4), 0.05, 0.06, 5000);
      const from = driver.events.length;
      const unit = (await driver.probe()).me.id;
      await driver.click('left', 200);
      const spawn = await driver.until(() => driver.eventsSince(from, 'projectileSpawn', (e) => e.owner === 'unit' && e.ownerId === unit)[0], 5000);
      p = await driver.probe();
      if (spawn && p.me.cooldown > 0) report.pass('fire (left button)', `pressed the left button; the server spawned a ${spawn.projectile} from unit ${unit} and the snapshot shows its weapon cooling down (${fmt(p.me.cooldown)} s)`);
      else report.fail('fire (left button)', `projectileSpawn from unit ${unit} ${spawn ? 'seen' : 'NOT seen'}; snapshot cooldown ${fmt(p.me.cooldown)}`);
      await shot('01-fire');
    }

    // --- the four commands (number keys) -------------------------------------------------------
    const order = async (name, key, test, describe) => {
      // A command only proves something when it CHANGES the squad: if the server already shows
      // the state the key would set, pressing it could not fail, so it is not counted.
      const before = await driver.probe();
      if (before.squad && test(before)) {
        report.skip(name, `the squad was already at moveOrder=${before.squad.moveOrder} fireMode=${before.squad.fireMode}, so pressing ${key.replace('Digit', '')} would prove nothing`);
        return false;
      }
      await driver.tapKey(key, 110);
      const ok = await driver.until((q) => (q.squad && test(q) ? q : null), 5000);
      p = await driver.probe();
      if (ok) report.pass(name, `pressed ${key.replace('Digit', '')}; ${describe(ok)} (it was moveOrder=${before.squad?.moveOrder} fireMode=${before.squad?.fireMode})`);
      else report.fail(name, `pressed ${key.replace('Digit', '')}; the squad in the snapshot stayed at moveOrder=${p.squad?.moveOrder} fireMode=${p.squad?.fireMode}`);
      return !!ok;
    };
    // A squad starts on fire at will, so that command is tried from hold-and-charge.
    await order('command: hold and charge (4), first time', 'Digit4', (q) => q.squad.fireMode === 'charge', () => 'the squad in the snapshot has fireMode charge');
    await order('command: fire at will (3)', 'Digit3', (q) => q.squad.fireMode === 'atWill', () => 'the squad in the snapshot has fireMode atWill');
    await shot('02-fire-at-will');
    {
      // Move to: the marker is the ground under the crosshair, so look down the street first.
      p = await driver.probe();
      await driver.lookTo(p.view.yaw, -0.25, 0.06, 4000);
      p = await driver.probe();
      const aimed = p.aim && p.aim.on !== 'none';
      if (!aimed) report.skip('command: move to (2)', 'the crosshair was on the sky, so there is no ground point to mark');
      else {
        const ok = await order('command: move to (2)', 'Digit2', (q) => q.squad.moveOrder === 'moveTo', (q) => `the squad in the snapshot has moveOrder moveTo with its marker at (${fmt(q.squad.moveTargetX, 0)}, ${fmt(q.squad.moveTargetZ, 0)}), ${fmt(Math.hypot(q.squad.moveTargetX - p.aim.x, q.squad.moveTargetZ - p.aim.z))} m from where the crosshair was`);
        if (ok) await shot('03-move-to');
      }
    }
    await order('command: follow me (1)', 'Digit1', (q) => q.squad.moveOrder === 'follow', () => 'the squad in the snapshot has moveOrder follow');
    await order('command: hold and charge (4)', 'Digit4', (q) => q.squad.fireMode === 'charge', () => 'the squad in the snapshot has fireMode charge');

    // --- the command wheel itself: every entry, picked by the pointer ------------------------------
    // The right button (or Q) held, the mouse moved toward an entry, let go. Each pick is made
    // from a state it changes, so the server's snapshot proves the entry works; the order runs
    // through all four entries and ends on hold-and-charge for the volley below. (The owner's
    // first squad game: "the commo rose opened but I only ever could use weapon 1".)
    {
      const cx = driver.width / 2;
      const cy = driver.height / 2;
      const reach = 140;
      const wheelPick = async (name, how, dx, dy, test, entry) => {
        if (how === 'right button') {
          await page.mouse.move(cx, cy);
          await page.mouse.down({ button: 'right' });
        } else {
          // Without pointer lock the view (and the wheel's pointer) follows the mouse while a
          // button is held on the view: the middle button is bound to nothing.
          await driver.keyDown('KeyQ');
          await page.mouse.move(cx, cy);
          await page.mouse.down({ button: 'middle' });
        }
        const opened = await driver.until((q) => (q.wheelOpen ? q : null), 2500);
        await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
        const picked = await driver.until((q) => (q.wheelHighlight === entry ? q : null), 2500);
        if (picked) await shot(`04-wheel-${entry}`);
        if (how === 'right button') await page.mouse.up({ button: 'right' });
        else {
          await driver.keyUp('KeyQ');
          await sleep(150);
          await page.mouse.up({ button: 'middle' });
        }
        const applied = picked ? await driver.until((q) => (q.squad && test(q) ? q : null), 5000) : null;
        const label = `command wheel (${how}): ${entry}`;
        if (opened && picked && applied) report.pass(label, `the wheel opened, the pointer chose "${entry}", and on release the squad in the snapshot has moveOrder=${applied.squad.moveOrder} fireMode=${applied.squad.fireMode}`);
        else report.fail(label, `wheel opened: ${!!opened}; entry highlighted: ${picked ? picked.wheelHighlight : `not ${entry}`}; snapshot afterwards: moveOrder=${(await driver.probe()).squad?.moveOrder} fireMode=${(await driver.probe()).squad?.fireMode}`);
        await sleep(300);
      };
      // Move to marks the ground under the crosshair: look down the street first.
      p = await driver.probe();
      await driver.lookTo(p.view.yaw, -0.25, 0.06, 4000);
      p = await driver.probe();
      if (p.squad?.fireMode !== 'charge') await driver.tapKey('Digit4', 110);
      if (p.squad?.moveOrder !== 'follow') await driver.tapKey('Digit1', 110);
      await driver.until((q) => (q.squad && q.squad.fireMode === 'charge' && q.squad.moveOrder === 'follow' ? q : null), 4000);
      await wheelPick('fire at will', 'right button', 0, reach, (q) => q.squad.fireMode === 'atWill', 'fireAtWill');
      await wheelPick('hold and charge', 'right button', -reach, 0, (q) => q.squad.fireMode === 'charge', 'holdCharge');
      await wheelPick('move to', 'right button', reach, 0, (q) => q.squad.moveOrder === 'moveTo', 'moveTo');
      await wheelPick('follow me', 'right button', 0, -reach, (q) => q.squad.moveOrder === 'follow', 'follow');
      await wheelPick('fire at will', 'Q', 0, reach, (q) => q.squad.fireMode === 'atWill', 'fireAtWill');
      await wheelPick('hold and charge', 'Q', -reach, 0, (q) => q.squad.fireMode === 'charge', 'holdCharge');
    }

    // --- a charged volley ----------------------------------------------------------------------
    {
      const planted = await driver.until((q) => (q.squadUnits.filter((u) => u.alive && u.id !== q.me?.id && u.rooted && u.laser).length > 0 ? q : null), 12000);
      if (!planted) {
        p = await driver.probe();
        report.fail('hold and charge plants the sub-units', `no sub-unit became rooted with its laser on within 12 s (fireMode ${p.squad?.fireMode}; sub-units: ${p.squadUnits.map((u) => `#${u.id} rooted=${u.rooted} laser=${u.laser}`).join(', ')})`);
        report.skip('charged volley', 'no sub-unit was charging');
      } else {
        const n = planted.squadUnits.filter((u) => u.alive && u.id !== planted.me.id && u.rooted && u.laser).length;
        report.pass('hold and charge plants the sub-units', `${n} sub-unit(s) are rooted with their lasers on in the snapshot`);
        await shot('05-lasers');
        const charged = await driver.until((q) => (q.squadUnits.some((u) => u.alive && u.id !== q.me?.id && u.charge >= 0.9) && q.me && q.me.cooldown <= 0 ? q : null), 14000);
        if (!charged) {
          p = await driver.probe();
          report.fail('sub-units build charge', `no sub-unit reached 0.9 charge in 14 s (charges: ${p.squadUnits.map((u) => fmt(u.charge, 2)).join(', ')})`);
          report.skip('charged volley', 'the squad never charged');
        } else {
          report.pass('sub-units build charge', `charges in the snapshot: ${charged.squadUnits.filter((u) => u.id !== charged.me.id).map((u) => fmt(u.charge, 2)).join(', ')}`);
          // Aim where the arcs point: at the kaiju when the map knows it, else straight ahead.
          const k = charged.kaiju;
          if (k && k.known) await driver.lookAt(k.x, k.z, 2, 2);
          const from = driver.events.length;
          await driver.click('left', 200);
          const volley = await driver.until(() => driver.eventsSince(from, 'volley')[0], 5000);
          const shells = driver.eventsSince(from, 'projectileSpawn', (e) => e.volley === true);
          if (volley && shells.length > 0) report.pass('charged volley', `fired; the server sent a volley event (${volley.units.length} sub-unit(s), charge ${fmt(volley.charge, 2)}) and ${shells.length} projectiles marked as volley`);
          else {
            p = await driver.probe();
            report.fail('charged volley', `volley event ${volley ? 'seen' : 'NOT seen'}; volley projectiles ${shells.length}; kaiju known to the map: ${!!(k && k.known)} (a sub-unit whose arc does not cover the aim point sits the volley out)`);
          }
          await shot('06-volley');
        }
      }
    }

    // --- the map -------------------------------------------------------------------------------
    {
      await driver.tapKey('KeyM', 110);
      const open = await driver.until((q) => (q.mapOpen ? q : null), 3000);
      if (!open) report.fail('map (M)', 'the map did not open');
      else {
        await sleep(400);
        await shot('07-map');
        // While the map is open the unit idles: hold W and see that the SERVER does not move it.
        const before = (await driver.probe()).me;
        await driver.keyDown('KeyW');
        await sleep(1500);
        await driver.keyUp('KeyW');
        const after = (await driver.probe()).me;
        const drift = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : -1;
        if (drift >= 0 && drift < 0.6) report.pass('map (M): the unit idles', `the map opened; W held for 1.5 s moved the server's unit ${fmt(drift, 2)} m`);
        else report.fail('map (M): the unit idles', `with the map open, holding W moved the server's unit ${fmt(drift, 2)} m`);
        // A click on the map places the move-to marker.
        const was = (await driver.probe()).squad;
        await page.mouse.click(driver.width * 0.5, driver.height * 0.42);
        const marked = await driver.until((q) => (q.squad && q.squad.moveOrder === 'moveTo' && (q.squad.moveTargetX !== was.moveTargetX || q.squad.moveTargetZ !== was.moveTargetZ || was.moveOrder !== 'moveTo') ? q : null), 5000);
        if (marked) report.pass('map: place a move-to marker', `clicked on the map; the squad in the snapshot has moveOrder moveTo at (${fmt(marked.squad.moveTargetX, 0)}, ${fmt(marked.squad.moveTargetZ, 0)})`);
        else report.fail('map: place a move-to marker', `clicked on the map; the squad in the snapshot is still moveOrder=${(await driver.probe()).squad?.moveOrder}`);
        await shot('08-map-marker');
        await driver.tapKey('KeyM', 110);
        const closed = await driver.until((q) => (!q.mapOpen ? q : null), 3000);
        if (!closed) report.fail('map (M) closes', 'the map stayed open after the second press');
      }
    }

    // --- view toggle and controls card (client only) ---------------------------------------------
    await viewAndCardChecks(page, driver, report, shot);

    // --- let go and let the match run out ------------------------------------------------------
    {
      console.log(`  [human] hands off; waiting up to ${opts.finish} s for the match to end...`);
      let maxStage = 1;
      const ended = await driver.until((q) => {
        if (q.match) maxStage = Math.max(maxStage, q.match.stage);
        return q.matchesEnded >= 1 ? q : null;
      }, opts.finish * 1000, 1000);
      if (!ended) {
        p = await driver.probe();
        report.fail('the match ends', `no ending within ${opts.finish} s (stage ${p.match?.stage}, clock ${fmt(p.match?.clock, 0)}, bar ${fmt(p.match?.barPoints, 0)})`);
      } else {
        await sleep(1500);
        await shot('10-end-screen');
        const r = ended.lastResult;
        const screen = (await driver.probe()).screen;
        const end = driver.events.find((e) => e.type === 'matchEnd');
        report.ending = { winner: r?.winner, reason: r?.reason, duration: r?.duration, maxStage, screen };
        if (end && screen === 'end') report.pass('the match ends', `the server sent matchEnd: ${r.winner} won by ${r.reason} after ${fmt(r.duration, 0)} s of play, having reached stage ${maxStage}; the page shows the end screen`);
        else report.fail('the match ends', `matchEnd event ${end ? 'seen' : 'NOT seen'}; screen is "${screen}"`);
      }
    }
    p = await driver.probe();
    report.final = { fps: p.fps, pageErrors: p.errors };
  }
  return report;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.out, { recursive: true });
  const serverEntry = join(root, 'server', 'dist', 'index.js');
  if (!existsSync(serverEntry) || !existsSync(join(root, 'client', 'dist', 'index.html'))) {
    if (!opts.build) throw new Error('client/dist or server/dist is missing: run `npm run build` first');
    const built = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('npm run build failed');
  }

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
  };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
  let serverExit = null;
  server.on('exit', (code) => {
    serverExit = code ?? -1;
  });

  const errors = [];
  const reports = [];
  let crash = null;
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      if (serverExit !== null) throw new Error(`the server exited with code ${serverExit}:\n${serverLog.join('\n')}`);
      const ok = await fetch(`${origin}/healthz`).then((r) => r.ok, () => false);
      if (ok) break;
      if (Date.now() > deadline) throw new Error('the server did not answer /healthz');
      await sleep(150);
    }
    console.log(`scripted: server ${origin} (MB_FAST), real inputs, no autopilot`);
    if (opts.only !== 'human') reports.push(await playKaiju(origin, opts, errors));
    if (opts.only !== 'kaiju') reports.push(await playHuman(origin, opts, errors));
  } catch (err) {
    crash = err instanceof Error ? (err.stack ?? err.message) : String(err);
  } finally {
    if (serverExit === null) {
      server.kill('SIGTERM');
      await Promise.race([new Promise((r) => server.once('exit', r)), sleep(4000)]);
      if (serverExit === null) server.kill('SIGKILL');
    }
  }

  // --- the verdict, stated without rounding up ---------------------------------------------------
  const all = reports.flatMap((r) => r.checks.map((c) => ({ session: r.session, ...c })));
  const passed = all.filter((c) => c.outcome === 'pass');
  const failed = all.filter((c) => c.outcome === 'fail');
  const skipped = all.filter((c) => c.outcome === 'not attempted');
  const summary = {
    ok: !crash && failed.length === 0 && skipped.length === 0 && errors.length === 0,
    passed: passed.length,
    failed: failed.length,
    notAttempted: skipped.length,
    consoleErrors: errors,
    crash,
    sessions: reports.map((r) => ({ session: r.session, checks: r.checks, ending: r.ending ?? null, final: r.final ?? null })),
    serverLogTail: serverLog.slice(-12),
  };
  writeFileSync(join(opts.out, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log('\n=== scripted playtest ===');
  console.log(`${passed.length} confirmed by the server, ${failed.length} FAILED, ${skipped.length} not attempted; console errors: ${errors.length}`);
  for (const r of reports) if (r.ending) console.log(`ending (${r.session} session): ${r.ending.winner} won by ${r.ending.reason} after ${fmt(r.ending.duration, 0)} s, stage ${r.ending.maxStage} reached`);
  if (failed.length > 0) {
    console.log('FAILED (the input was given; the server did not confirm the effect):');
    for (const c of failed) console.log(`  - [${c.session}] ${c.name}: ${c.detail}`);
  }
  if (skipped.length > 0) {
    console.log('NOT ATTEMPTED (these are not known to work from this run):');
    for (const c of skipped) console.log(`  - [${c.session}] ${c.name}: ${c.detail}`);
  }
  if (errors.length > 0) {
    console.log('console errors:');
    for (const e of errors.slice(0, 10)) console.log(`  - ${e.slice(0, 240)}`);
  }
  if (crash) console.log(`the script itself stopped early:\n${crash}`);
  console.log(`screenshots and report.json: ${opts.out}`);
  if (summary.ok) console.log('PASSED: every action was attempted and every one was confirmed by the server.');
  else {
    console.log(failed.length > 0 || crash || errors.length > 0 ? 'FAILED.' : 'INCOMPLETE: nothing failed, but not everything was exercised.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
