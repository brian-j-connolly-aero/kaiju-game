#!/usr/bin/env node
/**
 * Scripted playtest with real inputs (the companion of smoke.mjs, which uses the autopilot).
 *
 *   node tools/playtest/scripted.mjs [options]
 *
 * Starts the game server with MB_FAST=1 on a free port against the production build and plays
 * its sessions in one headless Chromium page each, one after the other, with the hands
 * of driver.mjs: real key presses, mouse buttons, mouse movement and clicks on the real lobby
 * buttons. Nothing is sent to the server by the script itself and the autopilot is off.
 *
 *   kaiju   creates a room, volunteers, starts. Then (docs/ROADMAP.md phase 1, one move per
 *           button): look, walk, swipe (left button), stomp (Space), the two move buttons doing
 *           nothing before a molt, grab (right button) and throw (left button with something in
 *           the hand); wreck to the first mark and molt with one press of F; the three cards on
 *           screen, the charge picked with its key; the charge on Q and Q again to end its run;
 *           grab and eat (right button twice); wreck to the second mark (charging through the
 *           blocks) and molt again, the roar picked with a click on its card; the roar on E
 *           stunning the units it reaches (the kaiju walks at the squads until one is in reach).
 *           That takes the whole of the fast match's clock (the marks' checks say how much was
 *           left; when it runs out first, the roar is "not attempted"). One
 *           match cannot give one player every move either, so a second part runs in the
 *           sandbox (the page runs the simulation behind the same messages as a room; its
 *           checks of moves say "(sandbox)"): the view toggle (V) and the controls card (H,
 *           then Enter), the warnings of guns charging at it in first person, then the beam,
 *           the tail sweep, the brace and the roar's stun once more.
 *   human   creates a room, switches the practice option on (a bot plays the kaiju) and off
 *           again; a second page joins by the invite address, volunteers for the kaiju, gets
 *           ready and then never touches the controls. The host starts. Then (docs/ROADMAP.md
 *           phase 1, two buttons): drive, fire (left button), the volley (right button held: the
 *           squad-mates plant and charge, the meter fills; let go at full charge: a charged
 *           volley), an early let go (a weak, ragged shot, no charged volley), the old squad keys
 *           (Q, 1 to 4, G, R, E) doing nothing, the map (the unit idles; nothing to place on
 *           it), the view toggle and the controls card. After that the player lets go and the
 *           match runs to its end; meanwhile, when another squad's charged volley lands on the
 *           kaiju, the volley meter must show its five-second ring. (On Port Meridian the
 *           practice bot kaiju molts within a minute of a fast match, and every molt redeploys the
 *           squads, which undid the human checks half way through: an idle kaiju keeps the
 *           match at stage 1.)
 *   tank    stage 2 in the sandbox (`?sandbox=2`: the page runs the simulation behind the same
 *           messages as a room, so its snapshots and events stand in for the server's), the
 *           kaiju and the other squads told to stand still: A and D turn the hull on the spot,
 *           W drives along the hull whichever way the view looks, the turret follows the view
 *           at its own pace while the gun's reticle shows where it points, and a shot fired
 *           while the turret still swings leaves along the turret. Runs with --only human too,
 *           and alone with --only tank.
 *
 * What counts as working. Every action is judged ONLY by what the server said afterwards: the
 * newest snapshot it sent and the simulation events it sent (driver.mjs reads both). What the
 * page predicts or draws on its own is never evidence of what the game did; the few checks that
 * are about the page itself (the volley meter, the gun's reticle, the view toggle, the controls
 * card) say "client-side". Each check ends in one of three ways:
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
 *   --only kaiju|human   play the kaiju session, or the human and tank sessions
 *   --only tank          play the tank session alone
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
import { disablePointerLock, Driver, MOUSE_SENSITIVITY, sleep, wrapAngle } from './driver.mjs';
import { CHROMIUM_ARGS } from './smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const opts = { only: '', out: '/tmp/mb-scratch/playtest/scripted', width: 640, height: 360, build: true, finish: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--only') {
      const v = next();
      opts.only = v === 'human' || v === 'tank' ? v : 'kaiju';
    }
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
    // server staggers the kaiju for five seconds, and a staggered kaiju cannot act: a press given
    // then proves nothing either way. So a press is only given to a kaiju the server shows free
    // (idle, not staggered), and an attempt the server interrupted with a stagger (the
    // kaijuStagger event says so) is given once more. It is never repeated for any other reason.
    const free = () => driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 12000);
    // Free, and nothing pressed earlier still on its way: the wrecking's last click can reach the
    // server just after the bar offers the molt, and a press of F given meanwhile meets a swipe
    // under way (the server keeps a press waiting for only a fifth of a second).
    const settled = async () => {
      for (let i = 0; i < 6; i++) {
        await free();
        const mark = driver.events.length;
        await sleep(600);
        const q = await driver.probe();
        if (q.kaiju && q.kaiju.phase === 'idle' && driver.eventsSince(mark, 'kaijuAction').length === 0) return q;
      }
      return driver.probe();
    };
    const staggeredSince = (from) => driver.eventsSince(from, 'kaijuStagger', (e) => e.on).length > 0;
    const actionsSince = (from) => driver.eventsSince(from, 'kaijuAction').map((e) => `${e.action}/${e.phase}`).join(', ') || 'none';
    const playing = (q) => q && q.match && q.match.phase === 'playing' && q.matchesEnded === 0;
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
    /** Grabs the nearest thing a hand can take (right button); the kaijuHeld event and the snapshot must say so. */
    const grab = async (name) => {
      await free();
      p = await driver.probe();
      const around = await driver.surroundings(p.kaiju.x, p.kaiju.z, 90, 40);
      const cars = around.props.filter((c) => /car|van|taxi|bus|truck/.test(String(c.kind)));
      if (cars.length === 0 && p.kaiju.stage < 2) {
        report.skip(name, `no car within 90 m of the kaiju (${around.props.length} props nearby); nothing a hatchling can pick up`);
        return false;
      }
      // A car if there is one (stop short of it: a hatchling crushes a car it walks onto); from
      // stage 2 the hand tears a piece off the nearest building when no car is in reach.
      const target = cars[0] ?? around.structures.find((s) => !s.passable);
      if (target) {
        // The hand reaches 2.5 body radii, in a 100 degree arc round the head. Close enough by the
        // server's own snapshot before the button is pressed (on a busy machine the predicted
        // body can stop well short of where the server has it, or past the car).
        const reach = 2.5 * [2.4, 9, 26][p.kaiju.stage - 1];
        const near = cars[0] ? reach * 0.7 : 18;
        // (The match clock is short: the approach gets at most 35 s.)
        const until = Date.now() + 35000;
        for (let tries = 0; tries < 3 && Date.now() < until; tries++) {
          await driver.walkTo(target.x, target.z, near, { timeoutMs: 12000 });
          const q = await faceOnServer(target.x, target.z);
          if (q && Math.hypot(target.x - q.kaiju.x, target.z - q.kaiju.z) <= (cars[0] ? reach * 0.85 : reach + Math.max(target.hx, target.hz))) break;
        }
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        await free();
        const from = driver.events.length;
        await driver.click('right', 110);
        const held = await driver.until((q) => (q.kaiju && q.kaiju.held ? q : null), 4000);
        const event = held ? await driver.until(() => driver.eventsSince(from, 'kaijuHeld', (e) => e.reason === 'grab')[0], 3000) : null;
        if (held && event) {
          report.pass(name, `pressed the right button once; the server sent kaijuHeld (source ${event.source}) and the snapshot shows the kaiju holding a ${held.kaiju.held.kind}${attempt > 1 ? ' (second attempt: the army staggered the kaiju during the first)' : ''}`);
          return true;
        }
        if (attempt === 1 && staggeredSince(from)) continue;
        p = await driver.probe();
        report.fail(name, `pressed the right button; kaijuHeld ${event ? 'seen' : 'NOT seen'}, snapshot held=${JSON.stringify(p.kaiju.held)}; actions: ${actionsSince(from)}`);
        return false;
      }
      return false;
    };
    /** Turns to the heading with the longest straight run before a standing structure taller than `smash` (the city as this page mirrors it). */
    const faceLongestRun = async (smash) => {
      const q = await driver.probe();
      const yaw = await page.evaluate(longestRunInPage, { x: q.kaiju.x, z: q.kaiju.z, smash, reach: 160 });
      if (yaw !== null) await driver.lookTo(yaw, -0.1, 0.06, 5000);
      return yaw;
    };
    /**
     * Wrecks the city with real input until the bar offers the next molt: walks up to the nearest
     * building that is worth something, strikes and stomps it; once the charge is on a move
     * button, charges at it whenever it is ready. Returns true when the molt is offered.
     */
    const wreckToMark = async (budgetMs, chargeKey) => {
      const deadline = Date.now() + budgetMs;
      let offered = (await driver.probe()).kaiju.moltAvailable;
      let stomp = false;
      while (!offered && Date.now() < deadline) {
        p = await driver.probe();
        if (!playing(p)) break;
        if (chargeKey && p.kaiju.phase === 'idle' && p.kaiju.cooldowns.charge <= 0) {
          await faceLongestRun(30);
          await driver.tapKey(chargeKey, 110);
          await driver.until((q) => (q.kaiju && q.kaiju.phase !== 'idle' ? q : null), 2500);
          await driver.until((q) => (q.kaiju && (q.kaiju.phase === 'idle' || q.kaiju.moltAvailable) ? q : null), 7000);
          offered = (await driver.probe()).kaiju.moltAvailable;
          continue;
        }
        const around = await driver.surroundings(p.kaiju.x, p.kaiju.z, 220, 30);
        const target = around.structures.find((s) => s.value > 0 && !s.passable);
        if (!target) break;
        // Walk up to it (the kaiju tramples what is low) and strike and stomp until it is down or the molt is offered.
        await driver.walkTo(target.x, target.z, 1, { timeoutMs: 9000, done: (q) => q.kaiju.moltAvailable || Math.hypot(target.x - q.predicted.x, target.z - q.predicted.z) < Math.max(target.hx, target.hz) + 2 + 4 * q.kaiju.stage });
        await driver.lookAt(target.x, target.z);
        for (let i = 0; i < 5; i++) {
          if (stomp) await driver.tapKey('Space', 100);
          else await driver.click('left', 90);
          stomp = !stomp;
          const q = await driver.until((s) => (s.kaiju.phase === 'idle' || s.kaiju.moltAvailable ? s : null), 2500);
          if (!q || q.kaiju.moltAvailable) break;
          const left = await driver.surroundings(q.kaiju.x, q.kaiju.z, 220, 30);
          if (!left.structures.some((s) => s.id === target.id)) break;
        }
        offered = (await driver.probe()).kaiju.moltAvailable;
      }
      return offered;
    };
    /**
     * A molt: one press of F starts the cocoon and the server offers three cards; the page shows
     * them; the card holding `wanted` is picked by its key or by a click on it. The server's
     * moltPick (not drawn at random) and its snapshot's slot say whether the pick counted. Returns
     * the move picked, or null.
     */
    const molt = async (n, by, wanted) => {
      const name = `molt ${n} (one press of F)`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        await settled();
        const from = driver.events.length;
        await driver.tapKey('KeyF', 110);
        // The snapshot carries the offer as soon as the cocoon starts (the events come with the delayed view).
        const offered = await driver.until((q) => (q.kaiju && q.kaiju.offer && q.kaiju.offer.length === 3 ? q : null), 5000);
        if (!offered && attempt === 1 && staggeredSince(from)) continue;
        if (!offered) {
          report.fail(name, `pressed F with the molt offered; the snapshot shows phase ${(await driver.probe()).kaiju.phase} and no cards (actions: ${actionsSince(from)})`);
          return null;
        }
        const offer = offered.kaiju.offer;
        const slot = offered.kaiju.moves[0] === 'none' ? 0 : 1;
        // The window for a pick is the cocoon and the intermission (3.5 s with MB_FAST): the
        // cards are waited for and picked first, the pictures taken after.
        const shown = await page
          .waitForFunction(() => {
            const cards = [...document.querySelectorAll('.molt-cards:not(.hidden):not(.picked) .molt-card')].map((c) => c.dataset.move);
            return cards.length === 3 ? cards : null;
          }, null, { timeout: 3000 })
          .then((h) => h.jsonValue())
          .catch(() => null);
        const card = Math.max(1, offer.indexOf(wanted) + 1);
        if (shown) {
          if (by === 'key') await driver.tapKey(`Digit${card}`, 90);
          else await page.click(`.molt-card[data-card="${card}"]`);
        }
        const cocoon = await driver.until(() => driver.eventsSince(from, 'cocoon')[0], 4000);
        const offerEvent = await driver.until(() => driver.eventsSince(from, 'moltOffer')[0], 3000);
        if (cocoon && offerEvent) report.pass(name, `pressed F once; the server sent cocoon and moltOffer (${offerEvent.offer.join(', ')}, for move button ${offerEvent.slot + 1})`);
        else report.fail(name, `cocoon ${cocoon ? 'seen' : 'NOT seen'}, moltOffer ${offerEvent ? 'seen' : 'NOT seen'}; the snapshot offered ${offer.join(', ')}`);
        if (shown && shown.join() === offer.join()) report.pass(`molt ${n}: the three cards on screen`, `the page showed ${shown.join(', ')} as cards, in the order of the server's offer (client-side)`);
        else report.fail(`molt ${n}: the three cards on screen`, `the server offered ${offer.join(', ')}; the page showed ${shown ? shown.join(', ') : 'no cards'} within 3 s`);
        const pickName = `molt ${n}: pick a card by ${by === 'key' ? `its key (${card})` : 'a click on it'}`;
        if (!shown) {
          report.skip(pickName, 'the cards were not on screen to pick');
        } else {
          const pick = await driver.until(() => driver.eventsSince(from, 'moltPick')[0], 8000);
          const inSlot = await driver.until((q) => (q.kaiju && q.kaiju.moves[slot] === offer[card - 1] ? q : null), 4000);
          if (pick && !pick.random && pick.card === card && inSlot) report.pass(pickName, `the server sent moltPick card ${pick.card} (${pick.move}), not drawn at random, and its snapshot has ${pick.move} on move button ${slot + 1}`);
          else report.fail(pickName, `wanted card ${card} (${offer[card - 1]}); moltPick ${pick ? JSON.stringify({ card: pick.card, move: pick.move, random: pick.random }) : 'NOT seen'}; the snapshot's slots: ${(await driver.probe()).kaiju.moves.join(', ')}`);
        }
        await shot(`molt${n}-picked`);
        const grown = await driver.until((q) => (q.match && q.match.stage === n + 1 && q.match.phase === 'playing' && q.kaiju.stage === n + 1 ? q : null), 15000);
        if (!grown) report.fail(`molt ${n}: the next stage`, `stage ${n + 1} never began in play`);
        await sleep(500);
        await shot(`stage${n + 1}`);
        return grown ? (await driver.probe()).kaiju.moves[slot] : null;
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
    for (let attempt = 1; attempt <= 2; attempt++) {
      // (A staggered kaiju cannot walk: the squads' volleys can catch it in the first seconds.)
      const at = (await free()) ?? (await driver.probe());
      const from = driver.events.length;
      const origin = { x: at.kaiju.x, z: at.kaiju.z };
      await driver.keyDown('KeyW');
      const moved = await driver.until((q) => (q.kaiju && Math.hypot(q.kaiju.x - origin.x, q.kaiju.z - origin.z) > 6 ? q : null), 6000);
      await driver.keyUp('KeyW');
      if (moved) report.pass('move (W)', `held W; the server moved the kaiju ${fmt(Math.hypot(moved.kaiju.x - origin.x, moved.kaiju.z - origin.z))} m${attempt > 1 ? ' (second attempt: the army staggered the kaiju during the first)' : ''}`);
      else if (attempt === 1 && staggeredSince(from)) continue;
      else {
        p = await driver.probe();
        report.fail('move (W)', `held W for 6 s; the server's kaiju moved only ${fmt(Math.hypot(p.kaiju.x - origin.x, p.kaiju.z - origin.z))} m (phase ${p.kaiju.phase})`);
      }
      break;
    }

    // --- swipe (left button) -------------------------------------------------------------------
    {
      await free();
      const from = driver.events.length;
      await driver.click('left', 90);
      const active = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'swipe' && e.phase === 'active')[0], 4000);
      if (active) report.pass('swipe (left button)', `clicked the left button; the server sent kaijuAction swipe active (tick ${active.tick})`);
      else report.fail('swipe (left button)', `no kaijuAction swipe/active from the server; actions seen: ${actionsSince(from)}`);
      await shot('01-swipe');
    }

    // --- stomp (Space: its own button now) -----------------------------------------------------
    for (let attempt = 1; attempt <= 2; attempt++) {
      await free();
      const from = driver.events.length;
      await driver.tapKey('Space', 110);
      const active = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'stomp' && e.phase === 'active')[0], 5000);
      if (active) report.pass('stomp (Space)', `pressed Space once; the server sent kaijuAction stomp active (tick ${active.tick})`);
      else if (attempt === 1 && staggeredSince(from)) continue;
      else report.fail('stomp (Space)', `no kaijuAction stomp/active from the server; actions seen: ${actionsSince(from)}`);
      await shot('02-stomp');
      break;
    }

    // --- the two move buttons before any molt: empty slots, nothing happens --------------------
    {
      await free();
      const from = driver.events.length;
      await driver.tapKey('KeyQ', 110);
      await driver.tapKey('KeyE', 110);
      await sleep(1500);
      p = await driver.probe();
      const acted = driver.eventsSince(from, 'kaijuAction');
      if (acted.length === 0 && p.kaiju.moves[0] === 'none' && p.kaiju.moves[1] === 'none') report.pass('empty move slots (Q, E)', 'pressed Q and E before any molt; the server started nothing and its snapshot shows both move slots empty');
      else report.fail('empty move slots (Q, E)', `actions: ${actionsSince(from)}; slots in the snapshot: ${p.kaiju.moves.join(', ')}`);
    }

    // --- grab (right button) and throw (left button with something in the hand) ----------------
    if (await grab('grab (right button)')) {
      await free();
      const from = driver.events.length;
      await driver.click('left', 90);
      const spawn = await driver.until(() => driver.eventsSince(from, 'projectileSpawn', (e) => e.owner === 'kaiju')[0], 4000);
      // (Its own impact: the squads' shells land on the kaiju meanwhile.)
      const landed = spawn ? await driver.until(() => driver.eventsSince(from, 'projectileHit', (e) => e.id === spawn.id)[0], 8000) : null;
      const empty = await driver.until((q) => (q.kaiju && !q.kaiju.held ? q : null), 3000);
      if (spawn && landed && empty) report.pass('throw (left button, holding)', `clicked the left button with something in the hand; the server spawned a thrown projectile, reported its impact on "${landed.target}", and the snapshot shows the hand empty`);
      else report.fail('throw (left button, holding)', `projectileSpawn ${spawn ? 'seen' : 'NOT seen'}, projectileHit ${landed ? 'seen' : 'NOT seen'}, hand empty in snapshot: ${!!empty}; actions: ${actionsSince(from)}`);
      await shot('03-throw');
    } else {
      report.skip('throw (left button, holding)', 'nothing was grabbed');
    }

    // --- wreck until the bar offers the molt; molt; pick the charge by its key ------------------
    let first = null;
    if (await wreckToMark(80000, null)) {
      p = await driver.probe();
      report.pass('wreck the city to the first mark', `swipes, stomps and trampling by real input took the server's bar to ${fmt(p.match.barPoints, 0)} (mark ${fmt(p.match.marks[0], 0)}) with ${fmt(p.match.clock, 0)} s left on the fast match clock; the server offers the molt`);
      await shot('04-molt-offered');
      first = await molt(1, 'key', 'charge');
    } else {
      p = await driver.probe();
      report.skip('molt 1 (one press of F)', `the bar did not reach the first mark in the time allowed (bar ${fmt(p.match.barPoints, 0)} of ${fmt(p.match.marks[0], 0)}, clock ${fmt(p.match.clock, 0)} s)`);
    }

    // --- stage 2: the charge on Q, and Q again to end its run early ----------------------------
    let second = null;
    if (first === 'charge') {
      for (let attempt = 1; attempt <= 2; attempt++) {
        await free();
        await faceLongestRun(30);
        const from = driver.events.length;
        await driver.tapKey('KeyQ', 110);
        const running = await driver.until((q) => (q.kaiju && q.kaiju.action === 'charge' && q.kaiju.phase === 'charge' ? q : null), 4000);
        // Still running a moment into the run: a second press ends it.
        await sleep(350);
        const still = (await driver.probe()).kaiju.phase === 'charge';
        if (running && still) await driver.tapKey('KeyQ', 90);
        const ran = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'charge' && e.phase === 'charge')[0], 4000);
        const stumble = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'charge' && e.phase === 'stumble')[0], 6000);
        if (!ran && attempt === 1 && staggeredSince(from)) continue;
        await shot('05-charge-stumble');
        const windup = driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'charge' && e.phase === 'windup')[0];
        if (windup && ran && stumble) report.pass('charge (Q, from the first molt)', `pressed Q once; the server sent the charge's wind-up, its run and its stumble (actions: ${actionsSince(from)})`);
        else report.fail('charge (Q, from the first molt)', `wind-up ${windup ? 'seen' : 'NOT seen'}, run ${ran ? 'seen' : 'NOT seen'}, stumble ${stumble ? 'seen' : 'NOT seen'}; actions: ${actionsSince(from)}`);
        const ranFor = ran && stumble ? (stumble.tick - ran.tick) / 30 : NaN;
        if (!still) report.skip('charge: Q again ends the run', 'the run had already ended (a wall it could not smash) before the second press could be given');
        else if (ran && stumble && ranFor < 2.6) report.pass('charge: Q again ends the run', `pressed Q again ${fmt(0.35, 2)} s into the run; the server's stumble came after ${fmt(ranFor, 2)} s of running (a run lasts up to 3 s)`);
        else report.fail('charge: Q again ends the run', `the run lasted ${fmt(ranFor, 2)} s after the second press`);
        break;
      }
      // --- grab and eat (right button twice) ---------------------------------------------------
      if (await grab('grab at stage 2 (right button)')) {
        await free();
        p = await driver.probe();
        if (p.kaiju.cooldowns.eat > 0) report.skip('eat (right button, holding)', `the eat cooldown is at ${fmt(p.kaiju.cooldowns.eat)} s`);
        else {
          const from = driver.events.length;
          await driver.click('right', 110);
          const eating = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'eat')[0], 5000);
          p = await driver.probe();
          if (eating && p.kaiju.cooldowns.eat > 0) report.pass('eat (right button, holding)', `pressed the right button with something in the hand; the server sent kaijuAction eat and the snapshot shows the eat cooldown at ${fmt(p.kaiju.cooldowns.eat)} s`);
          else report.fail('eat (right button, holding)', `kaijuAction eat ${eating ? 'seen' : 'NOT seen'}; eat cooldown ${fmt(p.kaiju.cooldowns.eat)}; actions: ${actionsSince(from)}`);
          await shot('06-eat');
        }
      } else {
        report.skip('eat (right button, holding)', 'nothing was grabbed');
      }
      // --- the second mark (charging through the blocks), the second molt by a click ------------
      if (await wreckToMark(70000, 'KeyQ')) {
        p = await driver.probe();
        report.pass('wreck the city to the second mark', `the bar reached ${fmt(p.match.barPoints, 0)} (mark ${fmt(p.match.marks[1], 0)}) with ${fmt(p.match.clock, 0)} s left on the fast match clock; the server offers the second molt`);
        second = await molt(2, 'click', 'roar');
      } else {
        p = await driver.probe();
        report.skip('molt 2 (one press of F)', `the bar did not reach the second mark in the time allowed (bar ${fmt(p.match.barPoints, 0)} of ${fmt(p.match.marks[1], 0)}, clock ${fmt(p.match.clock, 0)} s)`);
      }
    } else {
      report.skip('charge (Q, from the first molt)', first ? `the first molt gave ${first}` : 'the first molt did not happen');
    }

    // --- stage 3: the roar on E stuns the units it reaches -------------------------------------
    if (second === 'roar') {
      const radius = 280;
      const inReach = (q) => q.kaiju && q.units.some((u) => u.alive && Math.hypot(u.x - q.kaiju.x, u.z - q.kaiju.z) < radius * 0.85);
      // The squads keep their distance from a titan: walk at the nearest unit until one is in reach.
      let near = null;
      for (const end = Date.now() + 25000; Date.now() < end; ) {
        const q = await driver.probe();
        if (!playing(q) || inReach(q)) {
          near = q;
          break;
        }
        const alive = q.units.filter((u) => u.alive);
        if (alive.length === 0 || !q.kaiju) break;
        const dist = (u) => Math.hypot(u.x - q.kaiju.x, u.z - q.kaiju.z);
        const nearest = alive.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
        await driver.walkTo(nearest.x, nearest.z, radius * 0.5, { timeoutMs: 3000, done: (s) => !playing(s) || inReach(s) });
      }
      await free();
      p = await driver.probe();
      // The fast match's clock is short and this comes last: on a slow machine it can run out first.
      if (!playing(p)) {
        report.skip('roar (E, from the second molt) stuns', 'the match was over (the fast match clock had run out) before E could be pressed');
      } else {
        const clock = p.match.clock;
        const from = driver.events.length;
        await driver.tapKey('KeyE', 110);
        const roar = await driver.until(() => driver.eventsSince(from, 'roar')[0], 4000);
        const stunned = roar ? await driver.until(() => {
          const list = driver.eventsSince(from, 'unitStunned');
          return list.length > 0 ? list : null;
        }, 3000) : null;
        p = await driver.probe();
        await shot('07-roar-stun');
        if (roar && p.kaiju.cooldowns.roar > 0 && stunned) report.pass('roar (E, from the second molt) stuns', `pressed E; the server sent a roar (radius ${fmt(roar.radius, 0)} m), unitStunned for ${stunned.length} unit(s) (${fmt(stunned[0].duration, 1)} s each), and the roar's cooldown (${fmt(clock, 0)} s left on the fast match clock)`);
        else if (roar && !(near && inReach(near))) report.skip('roar (E, from the second molt) stuns', `the server roared (cooldown ${fmt(p.kaiju.cooldowns.roar)} s) but no unit came within its reach in 25 s to be stunned`);
        else if (!roar && !playing(p) && clock < 5) report.skip('roar (E, from the second molt) stuns', `E was pressed with ${fmt(clock, 1)} s left on the fast match clock; the match ended before the server answered`);
        else report.fail('roar (E, from the second molt) stuns', `roar ${roar ? 'seen' : 'NOT seen'}, unitStunned ${stunned ? stunned.length : 0}; roar cooldown ${fmt(p.kaiju.cooldowns.roar)}; actions: ${actionsSince(from)}`);
      }
    } else {
      report.skip('roar (E, from the second molt) stuns', second ? `the second molt gave ${second}` : 'the second molt did not happen');
    }

    p = await driver.probe();
    report.final = { stage: p.match?.stage, clock: p.match?.clock, bar: p.match?.barPoints, kaijuHp: p.kaiju?.hp, moves: p.kaiju?.moves, fps: p.fps, pageErrors: p.errors };
  } finally {
    await browser.close().catch(() => {});
  }
  await playKaijuMoves(origin, opts, errors, report);
  return report;
}

/**
 * The kaiju's warnings of guns charging at it, in first person (polish pass 2): one diamond per
 * squad charging at it, over the guns or on the screen's edge. Client-side; the squads' charge
 * comes from the snapshots.
 */
async function warningsCheck(driver, report, shot, playing) {
  // A squad with guns charging at the kaiju, by the snapshot: lasers lit, in range, aimed at it.
  const threatened = (q) => {
    if (!q.kaiju) return 0;
    const squads = new Set();
    for (const u of q.units) {
      if (!u.alive || !u.laser) continue;
      const d = Math.hypot(q.kaiju.x - u.x, q.kaiju.z - u.z);
      const off = Math.abs(wrapAngle(Math.atan2(q.kaiju.x - u.x, q.kaiju.z - u.z) - u.aimYaw));
      const range = u.type === 'army_rocket_infantry' ? 160 : u.type === 'army_tank' ? 420 : 600;
      if (d < range * 0.9 && off < 0.1) squads.add(u.squad);
    }
    return squads.size;
  };
  const p0 = await driver.probe();
  if (p0.thirdPerson) await driver.tapKey('KeyV', 110);
  let expected = 0;
  let streak = 0;
  const seen = await driver.until((q) => {
    if (q.thirdPerson || !playing(q)) return null;
    const n = threatened(q);
    if (n > 0) expected++;
    streak = n > 0 && q.threatsShown === 0 ? streak + 1 : 0;
    if (streak >= 8) return { missing: true, q };
    return n > 0 && q.threatsShown > 0 ? { q, n } : null;
  }, 90000, 250);
  if (seen && !seen.missing) {
    await shot('08-first-person-warnings');
    report.pass('(sandbox) first person: warnings of charging guns', `in first person, with ${seen.n} squad(s) charging at the kaiju by the snapshot, the page shows ${seen.q.threatsShown} warning diamond(s), ${seen.q.threatsAtEdge} of them on the screen's edge`);
  } else if (seen && seen.missing) {
    report.fail('(sandbox) first person: warnings of charging guns', `for 2 s the snapshot had squads charging at the kaiju and the page showed no warning`);
  } else if (expected === 0) {
    report.skip('(sandbox) first person: warnings of charging guns', 'no squad charged at the kaiju with its lasers on it in 90 s');
  } else {
    report.fail('(sandbox) first person: warnings of charging guns', `the snapshot had squads charging at the kaiju (${expected} probes) and no warning was ever shown`);
  }
  // Back to the default view.
  if ((await driver.probe()).thirdPerson === false) await driver.tapKey('KeyV', 110);
}

/**
 * Runs in the page: the heading along which the kaiju runs furthest straight ahead before a
 * standing structure taller than `smash` (or the bounds) would stop it, from the city as this
 * page mirrors it. Null without a match.
 */
function longestRunInPage({ x, z, smash, reach }) {
  const rt = window.__mb.internals.ctx.runtime;
  const mirror = rt?.session?.mirror;
  const b = rt?.frame?.bounds;
  if (!mirror || !b) return null;
  const tall = mirror.city.structures.filter((st) => mirror.structureStage[st.id] < 3 && st.height > smash && Math.hypot(st.x - x, st.z - z) < reach + 60);
  const blocked = (px, pz) =>
    px < b.minX + 8 || px > b.maxX - 8 || pz < b.minZ + 8 || pz > b.maxZ - 8 ||
    tall.some((st) => {
      const c = Math.cos(st.yaw);
      const s = Math.sin(st.yaw);
      const lx = (px - st.x) * c - (pz - st.z) * s;
      const lz = (px - st.x) * s + (pz - st.z) * c;
      return Math.abs(lx) < st.hx + 10 && Math.abs(lz) < st.hz + 10;
    });
  let best = null;
  let bestRun = -1;
  for (let i = 0; i < 32; i++) {
    const yaw = (i / 32) * Math.PI * 2 - Math.PI;
    let run = 0;
    while (run < reach && !blocked(x + Math.sin(yaw) * (run + 5), z + Math.cos(yaw) * (run + 5))) run += 5;
    if (run > bestRun) {
      bestRun = run;
      best = yaw;
    }
  }
  return best;
}

/**
 * The moves a monster can own that one match of the session above does not give it: the beam,
 * the tail sweep and the brace (and the roar's stun once more, in case no unit came near it
 * there). A single person cannot pick all five in one match, so this part runs in the sandbox
 * (`?sandbox=2`: the page runs the simulation behind the same messages as a room, so its
 * snapshots and events stand in for the server's), with the moves put on the two buttons and
 * pressed with real keys. Its checks say "(sandbox)".
 */
async function playKaijuMoves(origin, opts, errors, report) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const shot = (page, name) => page.screenshot({ path: join(opts.out, `kaiju-sandbox-${name}.png`) });
  try {
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    await context.addInitScript(disablePointerLock);
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`Sandbox: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`Sandbox: uncaught: ${e.message}`));
    await page.goto(`${origin}/?sandbox=2&role=kaiju&name=Rex&mute=1&fps=30`, { waitUntil: 'load' });
    const driver = new Driver(page, { width: opts.width, height: opts.height });
    const ready = await driver.until((q) => (q.match && q.match.phase === 'playing' && q.screen === 'match' && q.kaiju ? q : null), 60000, 200);
    if (!ready) {
      report.fail('(sandbox) the match starts', 'the sandbox match did not start');
      return;
    }
    // Client-side checks, while the bot squads still fight (the sandbox's match does not run out
    // of clock the way the real server's fast one does): the view toggle and the controls card
    // first, while the squads are still far off, then the warnings of their charging guns in
    // first person once they come close enough to charge at it.
    const playing = (q) => q && q.match && q.match.phase === 'playing' && q.matchesEnded === 0;
    await viewAndCardChecks(page, driver, report, (name) => shot(page, name));
    await warningsCheck(driver, report, (name) => shot(page, name), playing);
    // The world the sandbox runs (in the page): the moves on the buttons, the squads held still.
    const setUp = (moves, rage, place) =>
      page.evaluate(({ moves, rage, place }) => {
        const w = window.__mb.internals.ctx.client.local.world;
        w.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
        const k = w.kaijus[0];
        k.moves = moves;
        k.rage = rage;
        for (const verb of Object.keys(k.cooldowns)) k.cooldowns[verb] = 0;
        // Held still, the bot squads let go of the volleys they were charging: those shells must
        // not stagger the kaiju in the middle of the move being checked.
        k.nerve = 0;
        k.nerveImmune = Math.max(k.nerveImmune, 6);
        w.units.forEach((u, i) => {
          // 'ahead': four units in front; 'behind': four close behind; the rest far away.
          const a = place === 'behind' ? k.yaw + Math.PI + ((i % 4) - 1.5) * 0.5 : k.yaw + ((i % 4) - 1.5) * 0.25;
          const d = i >= 4 ? 900 : place === 'behind' ? 16 + (i % 2) * 6 : 60 + i * 8;
          u.x = k.x + Math.sin(a) * d;
          u.z = k.z + Math.cos(a) * d;
          u.vx = 0;
          u.vz = 0;
        });
        window.__mb.internals.ctx.runtime.controller.aimYaw = k.yaw;
        window.__mb.internals.ctx.runtime.controller.aimPitch = -0.08;
      }, { moves, rage, place });
    const free = () => driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 12000);
    const actionsSince = (from) => driver.eventsSince(from, 'kaijuAction').map((e) => `${e.action}/${e.phase}`).join(', ') || 'none';
    // A volley still in the air when the squads are held still can stagger the kaiju just as a
    // key goes down: as in the server session, such an attempt is given once more, and only then.
    const staggeredSince = (from) => driver.eventsSince(from, 'kaijuStagger', (e) => e.on).length > 0;

    // The beam (Q): full rage, units ahead.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await setUp(['beam', 'tailSweep'], 100, 'ahead');
      await sleep(800);
      await free();
      const from = driver.events.length;
      await driver.tapKey('KeyQ', 150);
      const on = await driver.until((q) => (q.kaiju && q.kaiju.action === 'special' && q.kaiju.phase === 'special' ? q : null), 6000);
      if (on) await shot(page, '1-beam');
      const spent = (await driver.probe()).kaiju.rage < 50;
      const started = driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'special')[0];
      if (!on && attempt === 1 && staggeredSince(from)) continue;
      if (on && spent && started) report.pass('(sandbox) beam (Q, a molt card)', `pressed Q with full rage; the simulation sent kaijuAction special, spent the rage, and its snapshots show the beam burning${attempt > 1 ? ' (second attempt: a volley staggered the kaiju during the first)' : ''}`);
      else report.fail('(sandbox) beam (Q, a molt card)', `special event ${started ? 'seen' : 'NOT seen'}, rage spent ${spent}, beam phase ${!!on}; actions: ${actionsSince(from)}; staggered ${staggeredSince(from)}; phase now ${(await driver.probe()).kaiju?.phase}`);
      await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 8000);
      break;
    }
    // The tail sweep (E): units close behind.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await setUp(['beam', 'tailSweep'], 0, 'behind');
      await sleep(800);
      await free();
      const before = (await driver.probe()).units.filter((u) => u.alive).map((u) => ({ id: u.id, hp: u.hp, x: u.x, z: u.z }));
      const from = driver.events.length;
      await driver.tapKey('KeyE', 150);
      const active = await driver.until(() => driver.eventsSince(from, 'kaijuAction', (e) => e.action === 'tailSweep' && e.phase === 'active')[0], 6000);
      if (!active && attempt === 1 && staggeredSince(from)) continue;
      await shot(page, '2-tail-sweep');
      const hits = driver.eventsSince(from, 'unitHit', (e) => e.cause === 'tailSweep');
      const after = (await driver.probe()).units;
      const moved = before.filter((b) => {
        const u = after.find((a) => a.id === b.id);
        return u && Math.hypot(u.x - b.x, u.z - b.z) > 2;
      }).length;
      if (active && hits.length > 0) report.pass('(sandbox) tail sweep (E, a molt card)', `pressed E; the simulation sent kaijuAction tailSweep active and ${hits.length} unitHit(s) from it; ${moved} unit(s) knocked away`);
      else report.fail('(sandbox) tail sweep (E, a molt card)', `tailSweep active ${active ? 'seen' : 'NOT seen'}; unit hits ${hits.length}; actions: ${actionsSince(from)}; staggered ${staggeredSince(from)}`);
      await driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 4000);
      break;
    }
    // The brace (Q, held): it lasts while the button is down.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await setUp(['brace', 'roar'], 0, 'ahead');
      await sleep(800);
      await free();
      const from = driver.events.length;
      await driver.keyDown('KeyQ');
      const braced = await driver.until((q) => (q.kaiju && q.kaiju.phase === 'brace' ? q : null), 5000);
      await sleep(800);
      const held = (await driver.probe()).kaiju.phase === 'brace';
      if (braced && held) await shot(page, '3-brace');
      await driver.keyUp('KeyQ');
      const released = await driver.until((q) => (q.kaiju && q.kaiju.phase !== 'brace' ? q : null), 4000);
      if (!(braced && held) && attempt === 1 && staggeredSince(from)) continue;
      if (braced && held && released) report.pass('(sandbox) brace (Q held, a molt card)', 'held Q: the snapshots show the brace for as long as it was held; let go: it ended');
      else report.fail('(sandbox) brace (Q held, a molt card)', `brace seen ${!!braced}, still braced while held ${held}, ended on release ${!!released}; staggered ${staggeredSince(from)}`);
      break;
    }
    // The roar (E) once more, with units in its reach for certain: it stuns them, and the page
    // draws them dazed.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await setUp(['brace', 'roar'], 0, 'ahead');
      await sleep(800);
      await free();
      const from = driver.events.length;
      await driver.tapKey('KeyE', 150);
      const stunned = await driver.until(() => {
        const list = driver.eventsSince(from, 'unitStunned');
        return list.length > 0 ? list : null;
      }, 6000);
      if (!stunned && attempt === 1 && staggeredSince(from)) continue;
      const drawn = stunned ? await page.waitForFunction(() => (window.__mb.internals.ctx.runtime.frame?.units ?? []).some((u) => u.stunned), null, { timeout: 3000 }).then(() => true).catch(() => false) : false;
      await shot(page, '4-roar-stun');
      if (stunned && drawn) report.pass('(sandbox) roar (E, a molt card) stuns', `pressed E; the simulation sent unitStunned for ${stunned.length} unit(s) and the page drew them stunned`);
      else report.fail('(sandbox) roar (E, a molt card) stuns', `unitStunned ${stunned ? stunned.length : 0}, drawn stunned ${drawn}; actions: ${actionsSince(from)}; staggered ${staggeredSince(from)}`);
      break;
    }
  } finally {
    await browser.close().catch(() => {});
  }
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
  // The page reads a key on its next frame: on a busy machine that can be half a second away.
  const cardBecomes = async (want) => {
    const end = Date.now() + 3000;
    for (;;) {
      await sleep(150);
      const open = await cardOpen();
      if (open === want || Date.now() > end) return open;
    }
  };
  for (const [key, name] of [
    ['KeyH', 'H'],
    ['Enter', 'Enter'],
  ]) {
    await driver.tapKey(key, 110);
    const opened = await cardBecomes(true);
    if (opened) await shot(`controls-card-${name}`);
    const stillPlaying = (await driver.probe()).match?.phase === 'playing';
    await driver.tapKey(key, 110);
    const closed = !(await cardBecomes(false));
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

/**
 * Runs in the page: whether the straight line from (x, eye height, z) to the kaiju's upper body
 * is clear of standing, solid structures (sampled every metre against each footprint and its
 * height), the way the server's sight test sees it. Smoke is ignored (the check is made with
 * none near).
 */
function sightOfKaijuInPage({ x, z, eye, kx, kz, ky }) {
  const mirror = window.__mb.internals.ctx.runtime?.session?.mirror;
  if (!mirror) return false;
  const d = Math.hypot(kx - x, kz - z);
  const near = mirror.city.structures.filter((st) => !st.passable && mirror.structureStage[st.id] < 3 && st.cls !== 'bridge' && distToSegment(st.x, st.z) < Math.hypot(st.hx, st.hz) + 1);
  function distToSegment(px, pz) {
    const t = Math.max(0, Math.min(1, ((px - x) * (kx - x) + (pz - z) * (kz - z)) / Math.max(d * d, 1e-6)));
    return Math.hypot(px - (x + (kx - x) * t), pz - (z + (kz - z) * t));
  }
  for (let s = 1; s < d - 2; s += 1) {
    const t = s / d;
    const px = x + (kx - x) * t;
    const pz = z + (kz - z) * t;
    const py = eye + (ky - eye) * t;
    for (const st of near) {
      if (py > st.height) continue;
      const c = Math.cos(st.yaw);
      const sn = Math.sin(st.yaw);
      const lx = (px - st.x) * c - (pz - st.z) * sn;
      const lz = (px - st.x) * sn + (pz - st.z) * c;
      if (Math.abs(lx) < st.hx && Math.abs(lz) < st.hz) return false;
    }
  }
  return true;
}

/**
 * Runs in the page: writes down every look the squad's volley meter takes (`__mbMeterLog`, which
 * a check may clear) and every look it has taken since (`__mbMeterSeen`), as they happen.
 */
function installMeterLog() {
  const m = document.querySelector('.volley-meter');
  if (!m || window.__mbMeterLog) return;
  window.__mbMeterLog = [];
  window.__mbMeterSeen = '';
  new MutationObserver(() => {
    window.__mbMeterLog.push(m.className);
    if (!window.__mbMeterSeen.includes(m.className)) window.__mbMeterSeen += ` ${m.className}`;
  }).observe(m, { attributes: true, attributeFilter: ['class'] });
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

    // --- the volley: hold the right button, let go at full charge ---------------------------------
    // (Docs/ROADMAP.md phase 1: two buttons. The right button held plants the three squad-mates,
    // lasers on, and charges them; let go and they all fire at the crosshair. The page's meter is
    // watched as it changes, a picture may come a frame late on a slow machine.)
    await page.evaluate(installMeterLog);
    const cx = driver.width / 2;
    const cy = driver.height / 2;
    const ownSquad = (await driver.probe()).squad?.id ?? -1;
    let landedWhileDriving = 0;
    const mates = (q) => q.squadUnits.filter((u) => u.alive && u.id !== q.me?.id);
    const planted = (q) => mates(q).filter((u) => u.rooted && u.laser);
    const charge = (q) => {
      const ps = planted(q);
      return ps.length > 0 ? ps.reduce((sum, u) => sum + u.charge, 0) / ps.length : 0;
    };
    const ownShots = (from, filter = () => true) => driver.eventsSince(from, 'projectileSpawn', (e) => e.owner === 'unit' && Math.floor(e.ownerId / 4) === ownSquad && filter(e));
    {
      p = await driver.probe();
      // Aim at the kaiju when the map knows it, else down the street: a volley goes wherever the
      // crosshair is (a house in the way is the bar's gain, not a fault).
      if (p.kaiju && p.kaiju.known) await driver.lookAt(p.kaiju.x, p.kaiju.z, 2, 2);
      else await driver.lookTo(p.view.yaw, -0.08, 0.06, 4000);
      // The squad-mates' guns must be loaded for the volley to fire.
      await driver.until((q) => (mates(q).every((u) => u.cooldown <= 0) && q.me && q.me.cooldown <= 0 ? q : null), 8000);
      await page.evaluate(() => (window.__mbMeterLog.length = 0));
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button: 'right' });
      const rooted = await driver.until((q) => (planted(q).length > 0 ? q : null), 6000);
      if (!rooted) {
        p = await driver.probe();
        report.fail('volley held: the squad-mates plant', `held the right button for 6 s; no squad-mate is rooted with its laser on in the snapshot (${mates(p).map((u) => `#${u.id} rooted=${u.rooted} laser=${u.laser} stun=${fmt(u.stun)} shaken=${fmt(u.shaken)}`).join(', ')})`);
        await page.mouse.up({ button: 'right' });
        report.skip('volley: the squad-mates charge to full', 'nobody planted');
        report.skip('volley: let go at full charge fires a charged volley', 'nobody planted');
      } else {
        report.pass('volley held: the squad-mates plant', `held the right button; ${planted(rooted).length} of ${mates(rooted).length} squad-mate(s) are rooted with their lasers on in the snapshot`);
        // (On a loaded machine the page may take a second or more to draw its next frame.)
        const shown = await driver.until((q) => (q.meter?.shown && q.meter.charging > 0 ? q : null), 4000);
        if (shown) report.pass('volley meter shows while held', `the meter round the crosshair is up with ${shown.meter.charging} squad-mate picture(s) charging (client-side)`);
        else report.fail('volley meter shows while held', `meter on the page: ${JSON.stringify((await driver.probe()).meter)}`);
        // (No pictures while the button is held: on a busy machine a picture can hold the page
        // still for over a second, and the server lets go of a silent player's buttons after one
        // (STARVED_BUTTON_TICKS), which fires the volley early. shots.mjs pictures the meter.)
        // 4.5 s of the server's time; a server starved of the processor plays slower than that.
        const full = await driver.until((q) => (charge(q) >= 0.99 ? q : null), 20000);
        if (!full) {
          p = await driver.probe();
          report.fail('volley: the squad-mates charge to full', `still ${fmt(charge(p), 2)} after 20 s of holding (charges: ${planted(p).map((u) => fmt(u.charge, 2)).join(', ')})`);
        } else {
          report.pass('volley: the squad-mates charge to full', `charges in the snapshot: ${planted(full).map((u) => fmt(u.charge, 2)).join(', ')}`);
          await sleep(300);
          const log = await page.evaluate(() => window.__mbMeterLog.join(' | '));
          if (/\bcharged\b/.test(log) && /\bfull\b/.test(log)) report.pass('volley meter: past the notch, then full', 'the meter lit up past its 60% notch and then showed full (client-side)');
          else report.fail('volley meter: past the notch, then full', `the meter's looks while it filled: ${log.slice(0, 300)}`);
        }
        const from = driver.events.length;
        await page.evaluate(() => (window.__mbMeterLog.length = 0));
        await page.mouse.up({ button: 'right' });
        const volley = await driver.until(() => driver.eventsSince(from, 'volley', (e) => e.squad === ownSquad)[0], 6000);
        await sleep(300);
        const shells = ownShots(from, (e) => e.volley === true);
        // The meter flashes on the page's next frame after the let go; a page starved of the
        // processor draws a frame every half second or so, which can be after the volley's event.
        let flashed = false;
        const flashEnd = Date.now() + 4000;
        while (!flashed && Date.now() < flashEnd) {
          flashed = (await page.evaluate(() => window.__mbMeterLog.join(' '))).includes('fired');
          if (!flashed) await sleep(100);
        }
        if (volley && shells.length > 0) report.pass('volley: let go at full charge fires a charged volley', `let go of the right button; the server sent a volley event (${volley.units.length} squad-mate(s), charge ${fmt(volley.charge, 2)}) and ${shells.length} projectile(s) marked as volley${shells.some((e) => e.ownerId === full?.me?.id) ? ', the leader\'s own shot among them' : ''}`);
        else report.fail('volley: let go at full charge fires a charged volley', `volley event ${volley ? 'seen' : 'NOT seen'}; volley projectiles ${shells.length}`);
        if (flashed) report.pass('volley meter flashes when it fires', 'the meter took its "fired" look as the button was let go (client-side)');
        else report.fail('volley meter flashes when it fires', `the meter never took its "fired" look within 4 s of the let go (its looks: ${(await page.evaluate(() => window.__mbMeterLog.join(' | '))).slice(0, 300) || 'none'})`);
        await shot('04-volley-fired');
      }
    }

    // --- a weak volley: let go early ---------------------------------------------------------------
    {
      // The guns that just fired reload first.
      await driver.until((q) => (mates(q).every((u) => u.cooldown <= 0) ? q : null), 8000);
      await page.evaluate(() => (window.__mbMeterLog.length = 0));
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button: 'right' });
      const started = await driver.until((q) => (charge(q) >= 0.08 ? q : null), 6000);
      const from = driver.events.length;
      await page.mouse.up({ button: 'right' });
      const at = started ? charge(started) : 0;
      if (!started) report.fail('volley: let go early is a weak shot', 'held the right button for 6 s and the squad never started charging');
      else if (at >= 0.55) report.skip('volley: let go early is a weak shot', `the page was too slow to let go early: the squad was at ${fmt(at, 2)} already`);
      else {
        const spawns = await driver.until(() => {
          const list = ownShots(from, (e) => e.ownerId !== started.me?.id);
          return list.length > 0 ? list : null;
        }, 5000);
        await sleep(1500);
        const charged = driver.eventsSince(from, 'volley', (e) => e.squad === ownSquad);
        const fizzled = (await page.evaluate(() => window.__mbMeterLog.join(' '))).includes('fizzle');
        if (spawns && charged.length === 0 && spawns.every((e) => !e.volley)) report.pass('volley: let go early is a weak shot', `let go at a charge of ${fmt(at, 2)}; the squad-mates fired ${spawns.length} ragged shot(s) (not marked as volley) and the server announced no charged volley`);
        else report.fail('volley: let go early is a weak shot', `let go at ${fmt(at, 2)}; squad-mate shots ${spawns ? spawns.length : 0} (${spawns ? spawns.filter((e) => e.volley).length : 0} marked as volley); volley events ${charged.length}`);
        if (fizzled) report.pass('volley meter fizzles on an early let go', 'the meter took its "fizzle" look (client-side)');
        else report.fail('volley meter fizzles on an early let go', 'the meter never took its "fizzle" look');
      }
    }

    // --- the old squad keys do nothing ---------------------------------------------------------------
    {
      const from = driver.events.length;
      const before = await driver.probe();
      for (const key of ['KeyQ', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyG', 'KeyR', 'KeyE']) await driver.tapKey(key, 90);
      await sleep(1500);
      const after = await driver.probe();
      const shots = ownShots(from);
      const odd = ['smoke', 'mark', 'callin', 'volley'].flatMap((type) => driver.eventsSince(from, type, (e) => e.squad === ownSquad || e.squad === undefined));
      const plantedNow = planted(after).length;
      if (shots.length === 0 && odd.length === 0 && plantedNow === 0) report.pass('the old squad keys do nothing', `pressed Q, 1 to 4, G, R and E; the server sent no shot, smoke, mark, call-in or volley for this squad and nobody planted (the leader ${fmt(Math.hypot(after.me.x - before.me.x, after.me.z - before.me.z), 1)} m from where it was)`);
      else report.fail('the old squad keys do nothing', `after Q, 1 to 4, G, R, E: ${shots.length} shot(s), events ${odd.map((e) => e.type).join(', ') || 'none'}, ${plantedNow} planted`);
    }

    // --- the map: a view, nothing to place ---------------------------------------------------------
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
        // A left click on the map places nothing any more (the map orders went with the wheel).
        const from = driver.events.length;
        await page.mouse.click(driver.width * 0.5, driver.height * 0.42);
        await sleep(800);
        const after = (await driver.probe()).me;
        const drift = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : -1;
        if (drift >= 0 && drift < 0.6) report.pass('map (M): the unit idles', `the map opened; W held for 1.5 s and a click on the map moved the server's unit ${fmt(drift, 2)} m`);
        else report.fail('map (M): the unit idles', `with the map open, holding W and clicking moved the server's unit ${fmt(drift, 2)} m`);
        const pickers = await page.evaluate(() => document.querySelectorAll('.map-tools, .map-tool').length);
        const fired = ownShots(from).length;
        if (pickers === 0 && fired === 0) report.pass('map: nothing to place on it', 'no order picker beside the map, and the click on it fired nothing');
        else report.fail('map: nothing to place on it', `${pickers} order picker element(s) on the page; ${fired} shot(s) from the click`);
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
      // Meanwhile: the other squads' charged volleys that hit the kaiju while this page's player
      // drove a living unit of its own (the meter shows only then), for the countdown check below.
      const volleyShots = new Map();
      let seenEvents = driver.events.length;
      const ended = await driver.until((q) => {
        if (q.match) maxStage = Math.max(maxStage, q.match.stage);
        const driving = q.controller === 'human' && q.me?.alive && !q.mapOpen && q.match?.phase === 'playing';
        for (; seenEvents < driver.events.length; seenEvents++) {
          const e = driver.events[seenEvents];
          if (e.type === 'projectileSpawn' && e.volley && e.owner === 'unit') volleyShots.set(e.id, Math.floor(e.ownerId / 4));
          else if (e.type === 'projectileHit' && e.target === 'kaiju' && volleyShots.has(e.id) && volleyShots.get(e.id) !== ownSquad && driving) landedWhileDriving++;
        }
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
    // --- two squads within five seconds: the countdown ring ------------------------------------------
    // Over the whole session the bot squads fire charged volleys at the kaiju. When another
    // squad's lands, the meter round the crosshair counts this squad's five seconds down.
    {
      const sawRing = (await page.evaluate(() => window.__mbMeterSeen ?? '')).includes('countdown');
      if (landedWhileDriving === 0) report.skip('countdown ring after another squad\'s volley', 'no other squad\'s charged volley hit the kaiju while this page drove a unit of its own');
      else if (sawRing) report.pass('countdown ring after another squad\'s volley', `the server sent ${landedWhileDriving} hit(s) on the kaiju from other squads' charged volleys while this page drove its unit; the meter showed its five-second ring (client-side)`);
      else report.fail('countdown ring after another squad\'s volley', `${landedWhileDriving} other-squad volley hit(s) on the kaiju while driving; the meter never showed its ring`);
    }
    p = await driver.probe();
    report.final = { fps: p.fps, pageErrors: p.errors };
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// The tank session (stage 2, in the sandbox)
// ---------------------------------------------------------------------------------------------

/**
 * Tank driving at stage 2 (docs/ROADMAP.md phase 1), in the sandbox (`?sandbox=2`): the page
 * runs the simulation itself behind the same messages as a room, so its snapshots and events are
 * what a server would have sent. The kaiju and the other squads are told to stand still (the
 * sandbox's own handicap setting) so that nothing else moves the tank. With real keys and mouse:
 * A and D turn the hull on the spot, W drives along the hull whichever way the view looks, the
 * turret follows the view at its own pace (and the gun's reticle shows where it points), and a
 * shot fired while the turret still swings leaves along the turret, not along the view.
 */
/**
 * Turns the view by `dYaw` radians toward +yaw as fast as a hand flicks the mouse: whole-width
 * drags of one step each with the middle button held (no pointer lock: driver.mjs), so that the
 * view arrives within a frame or two and a turret has something to catch up with.
 */
async function flick(page, driver, dYaw) {
  // The game subtracts the mouse's look from the yaw: a turn toward +yaw is a move to the left.
  let px = -dYaw / MOUSE_SENSITIVITY;
  const margin = 8;
  const y = driver.height / 2;
  while (Math.abs(px) > 0.5) {
    const span = Math.min(Math.abs(px), driver.width - margin * 2);
    const startX = px < 0 ? driver.width - margin : margin;
    const endX = px < 0 ? startX - span : startX + span;
    await page.mouse.move(startX, y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(endX, y, { steps: 1 });
    await page.mouse.up({ button: 'middle' });
    px += px < 0 ? span : -span;
  }
}

async function playTank(opts, origin, errors) {
  const report = new Report('tank');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  await context.addInitScript(disablePointerLock);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`Tanker: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`Tanker: uncaught: ${e.message}`));
  const driver = new Driver(page, { width: opts.width, height: opts.height });
  const shot = (name) => driver.screenshot(join(opts.out, `tank-${name}.png`));
  const deg = (r) => `${fmt((r * 180) / Math.PI, 0)} degrees`;
  try {
    await page.goto(`${origin}/?sandbox=2&role=human&name=Tanker&mute=1&fps=30`, { waitUntil: 'load' });
    const playing = await driver.until((q) => (q.match && q.match.phase === 'playing' && q.screen === 'match' && q.me ? q : null), 60000, 200);
    if (!playing) {
      report.fail('tank: the sandbox match starts', 'no snapshot with phase "playing" at stage 2');
      return report;
    }
    await page.evaluate(() => {
      window.__mb.internals.ctx.client.local.world.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
    });
    await sleep(1500);
    let p = await driver.probe();
    if (p.me.type === 'army_tank' && p.tank) report.pass('tank: stage 2 drives a tank', `the sandbox's snapshot has this page driving unit ${p.me.id} (${p.me.type}); the controller drives it like a tank`);
    else report.fail('tank: stage 2 drives a tank', `unit ${p.me.id} is ${p.me.type}; tank driving: ${p.tank}`);
    await shot('00-start');

    // --- A and D turn the hull, on the spot ---
    {
      const before = (await driver.probe()).me;
      await driver.keyDown('KeyA');
      const turned = await driver.until((q) => (Math.abs(wrapAngle(q.me.yaw - before.yaw)) > 0.6 ? q : null), 5000);
      await driver.keyUp('KeyA');
      await sleep(400);
      const after = (await driver.probe()).me;
      const moved = Math.hypot(after.x - before.x, after.z - before.z);
      const turn = wrapAngle(after.yaw - before.yaw);
      if (turned && moved < 2.5) report.pass('tank: A turns the hull on the spot', `held A; the hull in the snapshot turned ${deg(Math.abs(turn))} ${turn > 0 ? 'left' : 'right'} and the tank moved ${fmt(moved, 1)} m`);
      else report.fail('tank: A turns the hull on the spot', `held A for up to 5 s; the hull turned ${deg(Math.abs(turn))}, the tank moved ${fmt(moved, 1)} m`);
      const b2 = (await driver.probe()).me;
      await driver.keyDown('KeyD');
      const back = await driver.until((q) => (Math.abs(wrapAngle(q.me.yaw - b2.yaw)) > 0.4 ? q : null), 5000);
      await driver.keyUp('KeyD');
      await sleep(400);
      const a2 = (await driver.probe()).me;
      const turn2 = wrapAngle(a2.yaw - b2.yaw);
      if (back && turn2 < 0 === turn > 0) report.pass('tank: D turns the hull the other way', `held D; the hull turned ${deg(Math.abs(turn2))} ${turn2 > 0 ? 'left' : 'right'}`);
      else report.fail('tank: D turns the hull the other way', `held D; the hull turned ${deg(turn2)} (A had turned it ${deg(turn)})`);
    }

    // --- W drives along the hull, not along the view ---
    {
      p = await driver.probe();
      // Point the hull down the most open way near where it faces, then look well away from it.
      const open = await page.evaluate(openHeadingInPage, { x: p.me.x, z: p.me.z, yaw: p.me.yaw });
      if (open !== null && Math.abs(wrapAngle(open - p.me.yaw)) > 0.15) {
        const key = wrapAngle(open - p.me.yaw) > 0 ? 'KeyA' : 'KeyD';
        await driver.keyDown(key);
        await driver.until((q) => (Math.abs(wrapAngle(open - q.me.yaw)) < 0.12 ? q : null), 6000, 30);
        await driver.keyUp(key);
        await sleep(500);
      }
      p = await driver.probe();
      await driver.lookTo(wrapAngle(p.me.yaw + 1.1), 0, 0.06, 5000);
      await sleep(600);
      const before = (await driver.probe()).me;
      const view = (await driver.probe()).view.yaw;
      await driver.keyDown('KeyW');
      // (A sandbox on a loaded machine runs its simulation slower than real time: give it a while.)
      const moved = await driver.until((q) => (Math.hypot(q.me.x - before.x, q.me.z - before.z) > 8 ? q : null), 12000);
      await shot('01-driving');
      await driver.keyUp('KeyW');
      const after = moved ?? (await driver.probe());
      const dist = Math.hypot(after.me.x - before.x, after.me.z - before.z);
      const heading = Math.atan2(after.me.x - before.x, after.me.z - before.z);
      const offHull = Math.abs(wrapAngle(heading - before.yaw));
      const offView = Math.abs(wrapAngle(heading - view));
      if (dist > 3 && offHull < 0.35 && offView > 0.7) report.pass('tank: W drives along the hull, not the view', `held W with the view ${deg(Math.abs(wrapAngle(view - before.yaw)))} off the hull; the tank went ${fmt(dist, 1)} m, ${deg(offHull)} off its hull's heading and ${deg(offView)} off the view's`);
      else report.fail('tank: W drives along the hull, not the view', `held W for up to 12 s; moved ${fmt(dist, 1)} m, ${deg(offHull)} off the hull, ${deg(offView)} off the view`);
      // To a stop.
      await driver.until((q) => (Math.hypot(q.me.vx, q.me.vz) < 0.3 ? q : null), 5000);
    }

    // --- the turret follows the view at its own pace; the gun reticle shows where it points ---
    {
      p = await driver.probe();
      await driver.until((q) => (Math.abs(wrapAngle(q.view.yaw - q.me.aimYaw)) < 0.05 ? q : null), 4000);
      const start = await driver.probe();
      let maxGap = 0;
      let offCenter = 0;
      const turnedAt = Date.now();
      await flick(page, driver, 2.2);
      let caughtAt = 0;
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        const q = await driver.probe();
        const gap = Math.abs(wrapAngle(q.view.yaw - q.me.aimYaw));
        maxGap = Math.max(maxGap, gap);
        if (q.gunReticle) offCenter = Math.max(offCenter, Math.abs(q.gunReticle.left - 50));
        if (offCenter > 3 && !caughtAt) await shot('02-turret-lags');
        if (gap < 0.05 && maxGap > 0.3) {
          caughtAt = Date.now();
          break;
        }
        await sleep(40);
      }
      const q = await driver.probe();
      const centered = q.gunReticle && Math.abs(q.gunReticle.left - 50) < 2;
      if (maxGap > 0.4 && caughtAt) report.pass('tank: the turret follows the view at its own pace', `turned the view ${deg(Math.abs(wrapAngle(q.view.yaw - start.view.yaw)))}; the turret in the snapshot trailed the view by up to ${deg(maxGap)} and was on it ${fmt((caughtAt - turnedAt) / 1000, 1)} s after the turn began`);
      else report.fail('tank: the turret follows the view at its own pace', `largest gap between the view and the snapshot's turret ${deg(maxGap)}; caught up: ${!!caughtAt}`);
      if (offCenter > 3 && centered) report.pass('tank: the gun reticle shows where the turret points', `the gun's reticle stood up to ${fmt(offCenter, 0)}% of the screen's width off the crosshair while the turret swung, and back on it once the turret was round (client-side)`);
      else report.fail('tank: the gun reticle shows where the turret points', `reticle furthest ${fmt(offCenter, 1)}% off the middle; on the crosshair at the end: ${!!centered} (${JSON.stringify(q.gunReticle)})`);
      await shot('03-turret-on');
    }

    // --- a shot fired while the turret swings leaves along the turret ---
    {
      await driver.until((q) => (q.me.cooldown <= 0 && Math.abs(wrapAngle(q.view.yaw - q.me.aimYaw)) < 0.05 ? q : null), 6000);
      const unit = (await driver.probe()).me.id;
      const from = driver.events.length;
      // The click straight after the turn; the view is read afterwards (it does not move again).
      await flick(page, driver, 2.6);
      await driver.click('left', 120);
      const view = (await driver.probe()).view.yaw;
      const spawn = await driver.until(() => driver.eventsSince(from, 'projectileSpawn', (e) => e.owner === 'unit' && e.ownerId === unit)[0], 5000);
      const q = await driver.probe();
      if (!spawn) report.fail('tank: a shot leaves along the turret, not the view', `clicked the left button; no projectileSpawn from unit ${unit}`);
      else {
        const heading = Math.atan2(spawn.vx, spawn.vz);
        const offView = Math.abs(wrapAngle(heading - view));
        if (offView > 0.35) report.pass('tank: a shot leaves along the turret, not the view', `turned the view and fired at once: the server's shell left ${deg(offView)} off the view, along the turret still swinging round (the turret is now ${deg(Math.abs(wrapAngle(q.me.aimYaw - view)))} off the view)`);
        else report.skip('tank: a shot leaves along the turret, not the view', `the page was too slow to fire before the turret had swung round: the shell left ${deg(offView)} off the view`);
      }
      await sleep(1500);
    }

    // --- view toggle and the controls card ---
    await cardChecks(page, driver, report, shot);
    p = await driver.probe();
    report.final = { fps: p.fps, pageErrors: p.errors };
    return report;
  } finally {
    await browser.close().catch(() => {});
  }
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
    if (opts.only === '' || opts.only === 'kaiju') reports.push(await playKaiju(origin, opts, errors));
    if (opts.only === '' || opts.only === 'human') reports.push(await playHuman(origin, opts, errors));
    if (opts.only !== 'kaiju') reports.push(await playTank(opts, origin, errors));
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
