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
 *   --no-extras      skip the scripted extras (the squad's volley and its meter, the tank's
 *                    reticles and driving, the monster's kit and molt cards, charge, tail sweep,
 *                    roar and its stun, beam, stagger, the city giving way, swimming)
 *   --only TAGS      only the extras whose names start with one of these (comma separated, for
 *                    example `x-kaiju-swim,x-human-swim`), and none of the stage visits
 *
 * The Chromium flags are the ones documented in smoke.mjs.
 */

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disablePointerLock } from './driver.mjs';
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
  const opts = { out: '/tmp/mb-scratch/playtest/shots', stages: [1, 2, 3], roles: ['kaiju', 'human'], seconds: 14, width: 960, height: 540, noAssets: false, extras: true, only: [] };
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
    else if (a === '--only') {
      opts.only = next().split(',').filter(Boolean);
      opts.stages = [];
    }
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
      // (Third person is the default view: the first pictures ask for first person.)
      const q = new URLSearchParams({ sandbox: String(stage), role, autoplay: '1', fps: '30', name: 'Shots', cam: 'fp' });
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
    // `noLock`: as in a browser without pointer lock, so that mouse buttons act at once (driver.mjs).
    const visit = async (tag, query, steps, { noLock = false } = {}) => {
      if (opts.only.length > 0 && !opts.only.some((o) => tag.startsWith(o))) return;
      const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
      if (noLock) await page.addInitScript(disablePointerLock);
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

    // --- the squad's new controls (docs/ROADMAP.md phase 1) -------------------------------------
    // (A software-drawn page shows a few frames a second, and a picture takes a moment: what must
    // be caught mid-way, a charge below the notch, a turret still swinging, is set up so that it
    // is still that way when the picture is taken.)
    /**
     * Puts the player's squad on the street `dist` meters from the kaiju (the road node nearest to
     * that distance inside the bounds), the kaiju standing still, and turns the view onto it. The
     * squad-mates stand beside the leader and a little ahead, in view. `humanBots`: the other
     * squads' handicap (0 fight on, 1 stand still).
     */
    const squadFacingKaiju = async (page, dist, humanBots) => {
      const spot = await page.evaluate(
        ({ dist, humanBots }) => {
          const w = window.__mb.internals.ctx.client.local.world;
          w.config.bots = { kaijuHandicap: 1, humanHandicap: humanBots };
          const k = w.kaijus[0];
          const b = w.match.bounds;
          const me = w.players.find((p) => !p.bot && p.role === 'human');
          const squad = w.squads[me.squadId];
          let best = null;
          let bestErr = Infinity;
          for (const n of w.city.roads.nodes) {
            if (n.x < b.minX + 30 || n.x > b.maxX - 30 || n.z < b.minZ + 30 || n.z > b.maxZ - 30) continue;
            const err = Math.abs(Math.hypot(n.x - k.x, n.z - k.z) - dist);
            if (err < bestErr) {
              bestErr = err;
              best = n;
            }
          }
          const yaw = Math.atan2(k.x - best.x, k.z - best.z);
          const spacing = w.units[squad.driven].radius * 2 + 2;
          squad.units.forEach((id, i) => {
            const u = w.units[id];
            const ahead = i === 0 ? 0 : [0.6, 0.6, 1.4][(i - 1) % 3] * spacing;
            const side = i === 0 ? 0 : [-1, 1, 0][(i - 1) % 3] * spacing;
            u.x = best.x + Math.sin(yaw) * ahead + Math.cos(yaw) * side;
            u.z = best.z + Math.cos(yaw) * ahead - Math.sin(yaw) * side;
            u.vx = 0;
            u.vz = 0;
            u.yaw = yaw;
            u.aimYaw = yaw;
            u.control.aimYaw = yaw;
          });
          return { yaw, x: best.x, z: best.z, kx: k.x, kz: k.z };
        },
        { dist, humanBots },
      );
      // (A unit that jumps looks toward the middle of the zone: turn it once it has landed.)
      await sleep(700);
      await page.evaluate((s) => {
        const c = window.__mb.internals.ctx.runtime.controller;
        c.viewYaw = s.yaw;
        c.viewPitch = 0.04;
      }, spot);
      await sleep(500);
      return spot;
    };
    /** The squad's charge, from the sandbox's own simulation (it stands in for the server). */
    const squadCharge = (page) =>
      page.evaluate(() => {
        const w = window.__mb.internals.ctx.client.local.world;
        const me = w.players.find((p) => !p.bot && p.role === 'human');
        const squad = w.squads[me.squadId];
        const mates = squad.units.map((id) => w.units[id]).filter((u) => u.alive && u.id !== squad.driven && u.rooted);
        return mates.length > 0 ? mates.reduce((s, u) => s + u.charge, 0) / mates.length : 0;
      });
    /** Sets the charge of the squad's planted squad-mates (to picture the meter at that charge). */
    const setCharge = (page, charge) =>
      page.evaluate((charge) => {
        const w = window.__mb.internals.ctx.client.local.world;
        const me = w.players.find((p) => !p.bot && p.role === 'human');
        const squad = w.squads[me.squadId];
        for (const id of squad.units) if (w.units[id].rooted) w.units[id].charge = charge;
      }, charge);
    const meterClasses = (page) => page.evaluate(() => document.querySelector('.volley-meter')?.className ?? '');

    // The volley: the right button held, the three squad-mates plant, their lasers converge on the
    // kaiju and the meter round the crosshair fills: below its notch, past it, full; let go and it
    // flashes as they all fire. Then the other squads fight on until one's charged volley lands,
    // and the meter's ring counts the five seconds this squad has to land its own.
    await visit(
      'x-human-volley',
      { sandbox: '1', role: 'human' },
      async (page, shot) => {
        await sleep(1500);
        await squadFacingKaiju(page, 110, 1);
        await shot('0-before');
        await page.mouse.move(opts.width / 2, opts.height / 2);
        await page.mouse.down({ button: 'right' });
        const planted = Date.now() + 4000;
        while (Date.now() < planted && (await squadCharge(page)) <= 0) await sleep(50);
        for (const [charge, name] of [
          [0.22, '1-charging-below-the-notch'],
          [0.62, '2-past-the-notch'],
        ]) {
          await setCharge(page, charge);
          await sleep(150);
          console.log(`shots: x-human-volley: ${name}: charge ${(await squadCharge(page)).toFixed(2)}, meter "${await meterClasses(page)}"`);
          await shot(name);
        }
        const full = Date.now() + 9000;
        while (Date.now() < full && (await squadCharge(page)) < 0.995) await sleep(60);
        await sleep(200);
        console.log(`shots: x-human-volley: 3-full: charge ${(await squadCharge(page)).toFixed(2)}, meter "${await meterClasses(page)}"`);
        await shot('3-full');
        if ((await squadCharge(page)) < 0.99) throw new Error('x-human-volley: the squad never charged to full while the right button was held');
        const fired = await page.evaluate(() => window.__mb.internals.ctx.runtime.eventCounts.volley ?? 0);
        // Every change of the meter's look is written down as it happens (the evidence that it
        // flashed: a picture may come a frame too late on a slow page).
        await page.evaluate(() => {
          const m = document.querySelector('.volley-meter');
          window.__meterLog = [];
          new MutationObserver(() => window.__meterLog.push(m.className)).observe(m, { attributes: true, attributeFilter: ['class'] });
        });
        const meterSaw = async (name, ms) => {
          const end = Date.now() + ms;
          for (;;) {
            if ((await page.evaluate(() => window.__meterLog.join(' '))).includes(name)) return true;
            if (Date.now() > end) return false;
            await sleep(25);
          }
        };
        await page.mouse.up({ button: 'right' });
        const flashed = await meterSaw('fired', 4000);
        await shot('4-let-go-flash');
        const volleyEnd = Date.now() + 4000;
        let volleys = 0;
        while (volleys < 1 && Date.now() < volleyEnd) {
          volleys = (await page.evaluate(() => window.__mb.internals.ctx.runtime.eventCounts.volley ?? 0)) - fired;
          if (volleys < 1) await sleep(100);
        }
        console.log(`shots: x-human-volley: let go at full charge: the meter flashed ${flashed}; volley events since: ${volleys}`);
        if (!flashed || volleys < 1) throw new Error('x-human-volley: letting go at full charge did not flash the meter and fire a volley');
        await sleep(1200);
        await shot('5-after');
        // A short hold and an early let go: a weak, ragged shot (the meter fizzles).
        await page.evaluate(() => {
          window.__meterLog.length = 0;
        });
        await page.mouse.down({ button: 'right' });
        const early = Date.now() + 6000;
        while (Date.now() < early && (await squadCharge(page)) < 0.2) await sleep(50);
        await page.mouse.up({ button: 'right' });
        const fizzled = await meterSaw('fizzle', 4000);
        await shot('6-let-go-early');
        console.log(`shots: x-human-volley: let go early: the meter fizzled ${fizzled}`);
        if (!fizzled) throw new Error('x-human-volley: letting go early did not fizzle the meter');
        // The other squads fight now; wait for one of their charged volleys to land.
        await page.evaluate(() => {
          window.__mb.internals.ctx.client.local.world.config.bots = { kaijuHandicap: 1, humanHandicap: 0 };
        });
        const end = Date.now() + 90000;
        let seen = false;
        while (!seen && Date.now() < end) {
          seen = (await meterClasses(page)).includes('countdown');
          if (!seen) await sleep(150);
        }
        if (seen) {
          await shot('7-countdown');
          await page.mouse.down({ button: 'right' });
          await sleep(1200);
          await shot('8-countdown-charging');
          await page.mouse.up({ button: 'right' });
        } else console.log('shots: x-human-volley: no other squad landed a charged volley within 90 s (no countdown picture)');
      },
      { noLock: true },
    );

    // The tank at stage 2: third person from behind and above, looking where the player looks.
    // The view swings round faster than the turret can: the turret follows at its own pace, so
    // the gun's reticle (cyan) trails off to the side of the crosshair, and slides back onto it
    // once the view stops. Then W drives and A turns the hull, and the troop at stage 3.
    await visit(
      'x-human-tank',
      { sandbox: '2', role: 'human' },
      async (page, shot) => {
        await sleep(1500);
        await squadFacingKaiju(page, 260, 1);
        await sleep(1200);
        await shot('0-third-person');
        const reticle = () =>
          page.evaluate(() => {
            const g = document.querySelector('.gun-reticle');
            return g && !g.classList.contains('hidden') ? { left: parseFloat(g.style.left), top: parseFloat(g.style.top) } : null;
          });
        // The view turns at 200 degrees a second (the turret: 140) while the reticle is watched, and
        // for as long as the picture takes; then it stops and the turret catches up.
        await page.evaluate(() => {
          const c = window.__mb.internals.ctx.runtime.controller;
          window.__shotsSpin = setInterval(() => {
            c.viewYaw += (200 * Math.PI) / 180 / 60;
          }, 1000 / 60);
        });
        let lagging = null;
        const spinEnd = Date.now() + 2500;
        while (Date.now() < spinEnd) {
          const r = await reticle();
          if (r && (!lagging || Math.abs(r.left - 50) > Math.abs(lagging.left - 50))) lagging = r;
          await sleep(100);
        }
        await shot('1-turret-lags');
        await page.evaluate(() => clearInterval(window.__shotsSpin));
        // For a picture of the two reticles apart that does not depend on when the picture is
        // taken (or on the frame rate: at 5 frames a second the turret catches up within one
        // frame): the inputs sent hold the turret where it is while the view turns 25 degrees
        // off it. (Planting the tank would not do: the driven unit is never planted.)
        await page.evaluate(() => {
          const c = window.__mb.internals.ctx.runtime.controller;
          const hold = window.__mb.internals.ctx.runtime.frame.localUnit.aimYaw;
          const sample = c.sample.bind(c);
          c.sample = (cx) => {
            const s = sample(cx);
            if (s) s.aimYaw = hold;
            return s;
          };
          c.viewYaw = hold + (25 * Math.PI) / 180;
        });
        await sleep(1500);
        await shot('1b-two-reticles');
        await page.evaluate(() => {
          delete window.__mb.internals.ctx.runtime.controller.sample;
        });
        let caught = null;
        const settleEnd = Date.now() + 6000;
        while (Date.now() < settleEnd) {
          caught = await reticle();
          if (caught && Math.abs(caught.left - 50) < 1 && Math.abs(caught.top - 50) < 3) break;
          await sleep(150);
        }
        await shot('2-turret-on');
        console.log(`shots: x-human-tank: the gun reticle while the view swung: furthest at ${lagging ? `${lagging.left.toFixed(1)}%, ${lagging.top.toFixed(1)}%` : 'hidden'}; once it stopped: ${caught ? `${caught.left.toFixed(1)}%, ${caught.top.toFixed(1)}%` : 'hidden'}`);
        if (!lagging || Math.abs(lagging.left - 50) < 4) throw new Error('x-human-tank: the gun reticle did not show the turret lagging behind the view');
        if (!caught || Math.abs(caught.left - 50) > 2 || Math.abs(caught.top - 50) > 4) throw new Error('x-human-tank: the gun reticle did not come back onto the crosshair');
        await page.keyboard.down('KeyW');
        await sleep(1800);
        await shot('3-driving');
        await page.keyboard.up('KeyW');
        await page.keyboard.down('KeyA');
        await sleep(900);
        await shot('4-turning-the-hull');
        await page.keyboard.up('KeyA');
        await page.keyboard.press('KeyV');
        await sleep(700);
        await shot('5-first-person');
        await page.keyboard.press('KeyV');
        await page.evaluate(() => window.__mb.internals.ctx.client.local.toStage(3));
        await sleep(3000);
        await squadFacingKaiju(page, 420, 1);
        await sleep(1500);
        await shot('6-troop-third-person');
      },
      { noLock: true },
    );

    // --- the monster's new controls (docs/ROADMAP.md phase 1) ----------------------------------
    // The sandbox's own simulation stands in for the server: what it says is the evidence.
    const world = 'window.__mb.internals.ctx.client.local.world';
    /** A key pressed the way a person does: down for a moment, then up. */
    const tapKey = async (page, code, ms = 150) => {
      await page.keyboard.down(code);
      await sleep(ms);
      await page.keyboard.up(code);
    };
    /** The moves the molts would have given it, every cooldown cleared. */
    const equip = (page, moves) =>
      page.evaluate(
        ({ moves, w }) => {
          const k = eval(w).kaijus[0];
          k.moves = moves;
          for (const verb of Object.keys(k.cooldowns)) k.cooldowns[verb] = 0;
        },
        { moves, w: world },
      );
    const kaiju = (page) =>
      page.evaluate((w) => {
        const k = eval(w).kaijus[0];
        return { action: k.action, phase: k.phase, moves: [...k.moves], offer: [...k.offer], x: k.x, z: k.z, yaw: k.yaw, stage: k.stage, match: eval(w).match.phase };
      }, world);
    const waitFor = async (page, test, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const st = await kaiju(page);
        if (test(st)) return st;
        await sleep(60);
      }
      return null;
    };
    /** The local kaiju as the page draws it right now (a moment behind the simulation). */
    const drawn = (page) =>
      page.evaluate(() => {
        const k = window.__mb.internals.ctx.runtime?.frame?.localKaiju;
        return k ? { action: k.action, phase: k.phase, phaseTime: k.phaseTime } : null;
      });
    /** Waits until the page draws the kaiju in a state that passes `test` (pictures are slower than moves). */
    const waitDrawn = async (page, test, ms = 6000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const k = await drawn(page);
        if (k && test(k)) return k;
        await sleep(20);
      }
      return null;
    };
    /** Records every kaijuAction the page is handed (`action/phase`) in `window.__actions`. */
    const recordActions = (page) =>
      page.evaluate(() => {
        const rt = window.__mb.internals.ctx.runtime;
        const original = rt.handleEvent.bind(rt);
        window.__actions = [];
        rt.handleEvent = (e) => {
          if (e.type === 'kaijuAction') window.__actions.push(`${e.action}/${e.phase}`);
          original(e);
        };
      });
    const actionsSeen = (page) => page.evaluate(() => window.__actions.slice());
    /** The bot squads stand still and stay out of the picture unless a visit places them. */
    const quietSquads = (page) =>
      page.evaluate((w) => {
        const wd = eval(w);
        wd.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
        const k = wd.kaijus[0];
        for (const u of wd.units) {
          u.x = k.x + 900;
          u.z = k.z + 900;
          u.vx = 0;
          u.vz = 0;
        }
      }, world);
    /**
     * Turns the kaiju (and the player's view) along the heading with the longest run before a
     * standing structure taller than the charge smashes, so a charge has a street to run down.
     */
    const faceOpenRun = (page, smash) =>
      page.evaluate(
        ({ w, smash }) => {
          const wd = eval(w);
          const k = wd.kaijus[0];
          const b = wd.match.bounds;
          const tall = wd.city.structures.filter((st) => wd.structureHp[st.id] > 0 && st.height > smash && Math.hypot(st.x - k.x, st.z - k.z) < 260);
          const blocked = (x, z) =>
            x < b.minX + 5 || x > b.maxX - 5 || z < b.minZ + 5 || z > b.maxZ - 5 ||
            tall.some((st) => {
              const c = Math.cos(st.yaw);
              const sn = Math.sin(st.yaw);
              const lx = (x - st.x) * c - (z - st.z) * sn;
              const lz = (x - st.x) * sn + (z - st.z) * c;
              return Math.abs(lx) < st.hx + 10 && Math.abs(lz) < st.hz + 10;
            });
          let best = k.yaw;
          let bestRun = -1;
          for (let i = 0; i < 32; i++) {
            const yaw = (i / 32) * Math.PI * 2 - Math.PI;
            let run = 0;
            while (run < 160 && !blocked(k.x + Math.sin(yaw) * (run + 5), k.z + Math.cos(yaw) * (run + 5))) run += 5;
            if (run > bestRun) {
              bestRun = run;
              best = yaw;
            }
          }
          k.yaw = best;
          k.aimYaw = best;
          k.vx = 0;
          k.vz = 0;
          const c = window.__mb.internals.ctx.runtime.controller;
          c.aimYaw = best;
          c.aimPitch = -0.12;
          return bestRun;
        },
        { w: world, smash },
      );

    // The starting kit and the molt cards: the bar reaches the first mark, F starts the cocoon,
    // three cards come up and the first is picked with its key; at the second molt the third
    // card is picked with a click (the pointer is free while the cards wait, and the click takes
    // it back). Each pick must land in its slot in the world the sandbox runs.
    await visit('x-kaiju-cards', { sandbox: '1', role: 'kaiju' }, async (page, shot) => {
      await sleep(2500);
      await quietSquads(page);
      // Every moltPick the page is handed, to tell a pick of ours from the server's random draw.
      await page.evaluate(() => {
        const rt = window.__mb.internals.ctx.runtime;
        const original = rt.handleEvent.bind(rt);
        window.__picks = [];
        rt.handleEvent = (e) => {
          if (e.type === 'moltPick') window.__picks.push(e);
          original(e);
        };
      });
      await sleep(600);
      await shot('0-kit-empty-slots');
      // The monster's controls card (H opens it, H closes it; the match runs on).
      await tapKey(page, 'KeyH');
      await page.waitForFunction(() => window.__mb.internals.ctx.controls.open === true, null, { timeout: 4000 }).catch(() => null);
      await sleep(500);
      await shot('0-controls-card');
      // The whole card fits the window: its six rows are shrunk to fit rather than cut off.
      const size = await page.evaluate(() => {
        const c = document.querySelector('.controls-card');
        return c ? { need: c.scrollHeight, room: c.clientHeight } : null;
      });
      console.log(`shots: x-kaiju-cards: the controls card needs ${size?.need} px of height and has ${size?.room} px`);
      if (!size || size.need > size.room + 1) throw new Error('x-kaiju-cards: the controls card does not fit the window (its last row is cut off)');
      await tapKey(page, 'KeyH');
      await sleep(400);
      // The pointer captured the way a player captures it (a click on the view): the cards must
      // let it go while they wait, and a pick, by key as by click, must take it back.
      // Nor may the view leap when the pointer is captured: the browser reports a jump of the
      // cursor then, late on a busy page (input/inputManager.ts throws it away).
      const aim = () =>
        page.evaluate(() => {
          const c = window.__mb.internals.ctx.runtime.controller;
          return { yaw: c.aimYaw, pitch: c.aimPitch };
        });
      const leap = (a, b) => Math.hypot(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)), b.pitch - a.pitch);
      const aimBefore = await aim();
      await page.mouse.click(Math.round(opts.width / 2), Math.round(opts.height / 2));
      const captured = await page.waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 4000 }).then(() => true).catch(() => false);
      if (!captured) throw new Error('x-kaiju-cards: a click on the view did not capture the pointer');
      await sleep(1500);
      const leapt = leap(aimBefore, await aim());
      console.log(`shots: x-kaiju-cards: the view turned ${leapt.toFixed(3)} rad as the pointer was captured`);
      if (leapt > 0.05) throw new Error(`x-kaiju-cards: the view leapt ${leapt.toFixed(2)} rad when the pointer was captured`);
      for (const [mark, pick] of [
        [0, 'key'],
        [1, 'click'],
      ]) {
        await page.evaluate(({ w, mark }) => {
          const m = eval(w).match;
          m.barPoints = Math.max(m.barPoints, m.marks[mark]);
        }, { w: world, mark });
        if (!(await page.waitForFunction((w) => eval(w).kaijus[0].moltAvailable, world, { timeout: 4000 }).catch(() => null))) throw new Error(`x-kaiju-cards: no molt offered at mark ${mark + 1}`);
        await sleep(400);
        await shot(`${mark + 1}a-molt-offered`);
        await tapKey(page, 'KeyF');
        const offered = await waitFor(page, (st) => st.offer.length === 3, 5000);
        if (!offered) throw new Error(`x-kaiju-cards: F did not start a cocoon with three cards (molt ${mark + 1})`);
        // The page shows the offer once its view reaches it (a moment behind the simulation).
        const shown = await page
          .waitForFunction(() => {
            const cards = [...document.querySelectorAll('.molt-cards:not(.hidden):not(.picked) .molt-card')].map((c) => c.dataset.move);
            return cards.length === 3 ? cards : null;
          }, null, { timeout: 6000 })
          .then((h) => h.jsonValue())
          .catch(() => []);
        const freed = await page.waitForFunction(() => document.pointerLockElement === null, null, { timeout: 3000 }).then(() => true).catch(() => false);
        console.log(`shots: x-kaiju-cards: molt ${mark + 1}: the simulation offers ${offered.offer.join(', ')}; the page shows ${shown.join(', ') || 'nothing'}; pointer let go: ${freed}`);
        if (shown.join() !== offered.offer.join()) throw new Error(`x-kaiju-cards: the cards on the page (${shown}) are not the offer (${offered.offer})`);
        if (!freed) throw new Error('x-kaiju-cards: the pointer stayed captured while the cards waited for a click');
        await sleep(700);
        await shot(`${mark + 1}b-cards`);
        const card = pick === 'key' ? 1 : 3;
        const aimPicking = await aim();
        if (pick === 'key') await tapKey(page, 'Digit1');
        else {
          const box = await page.locator(`.molt-card[data-card="${card}"]`).boundingBox();
          if (!box) throw new Error('x-kaiju-cards: the third card has no box to click');
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        const chosen = await page.waitForFunction((n) => document.querySelector(`.molt-card.chosen[data-card="${n}"]`) !== null, card, { timeout: 3000 }).catch(() => null);
        if (!chosen) throw new Error(`x-kaiju-cards: the page did not take card ${card} (by ${pick})`);
        await sleep(120);
        await shot(`${mark + 1}c-card-flying`);
        const slot = mark;
        const landed = await waitFor(page, (st) => st.moves[slot] !== 'none', 4000);
        if (!landed || landed.moves[slot] !== offered.offer[card - 1]) throw new Error(`x-kaiju-cards: picked card ${card} (${offered.offer[card - 1]}), the world has ${landed ? landed.moves[slot] : 'nothing'} in slot ${slot + 1}`);
        const word = await page.waitForFunction((n) => window.__picks.length >= n && window.__picks[n - 1], mark + 1, { timeout: 4000 }).then((h) => h.jsonValue()).catch(() => null);
        if (!word || word.random || word.card !== card) throw new Error(`x-kaiju-cards: the server's moltPick was ${JSON.stringify(word)}, not card ${card} picked by the player`);
        const locked = await page.waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 3000 }).then(() => true).catch(() => false);
        await sleep(1000);
        const turned = leap(aimPicking, await aim());
        console.log(`shots: x-kaiju-cards: card ${card} by ${pick} -> the server put ${landed.moves[slot]} in slot ${slot + 1} (moltPick card ${word.card}, random ${word.random}); pointer captured again: ${locked}; the view turned ${turned.toFixed(3)} rad`);
        if (!locked) throw new Error(`x-kaiju-cards: the pick by ${pick} did not take the pointer back`);
        if (turned > 0.05) throw new Error(`x-kaiju-cards: the view leapt ${turned.toFixed(2)} rad when the pick took the pointer back`);
        await sleep(900);
        await shot(`${mark + 1}d-landed`);
        const next = await waitFor(page, (st) => st.stage === mark + 2 && st.match === 'playing', 60000);
        if (!next) throw new Error(`x-kaiju-cards: stage ${mark + 2} did not begin`);
        await quietSquads(page);
        await sleep(1500);
        await shot(`${mark + 1}e-stage-${mark + 2}-kit`);
      }
    });

    // The charge: down an open street at stage 2. One charge per picture (a picture takes longer
    // than a move here): the wind-up (head down, a foot pawing), the run (dust, a wider lens),
    // the stumble, then a run seen from inside the head. The page must be told every phase.
    // (The charge, the sweep and the roar run as in a browser without pointer lock, so that their
    // pictures carry no "click to play" picture in the middle; the cards test the lock.)
    await visit('x-kaiju-charge', { sandbox: '2', role: 'kaiju' }, async (page, shot) => {
      await sleep(2500);
      await quietSquads(page);
      await recordActions(page);
      await equip(page, ['charge', 'tailSweep']);
      const views = [
        ['1-windup', (k) => k.action === 'charge' && k.phase === 'windup' && k.phaseTime > 0.35, true],
        ['2-run', (k) => k.action === 'charge' && k.phase === 'charge' && k.phaseTime > 0.45, true],
        ['3-stumble', (k) => k.action === 'charge' && k.phase === 'stumble' && k.phaseTime > 0.15, true],
        ['4-run-first-person', (k) => k.action === 'charge' && k.phase === 'charge' && k.phaseTime > 0.45, false],
      ];
      for (const [name, when, third] of views) {
        await page.evaluate(({ w, third }) => {
          window.__mb.internals.ctx.runtime.controller.thirdPerson = third;
          const k = eval(w).kaijus[0];
          k.cooldowns.charge = 0;
          // (No stray shell may stagger it in the middle of the picture.)
          k.nerve = 0;
          k.nerveImmune = 10;
        }, { w: world, third });
        // (The run seen from inside the head goes down a clear street: through a house the view is
        // the house's walls for a moment.)
        const open = await faceOpenRun(page, third ? 30 : 0);
        await sleep(900);
        if (name === '1-windup') {
          console.log(`shots: x-kaiju-charge: ${open} m of open street ahead`);
          await shot('0-before');
        }
        await tapKey(page, 'KeyQ');
        // (On a busy machine the sandbox runs slower than real time: a whole charge, five seconds
        // of its time, can take twice that.)
        if (!(await waitDrawn(page, when, 12000))) throw new Error(`x-kaiju-charge: never drawn for ${name}`);
        await shot(name);
        if (!(await waitFor(page, (st) => st.phase === 'idle', 25000))) throw new Error(`x-kaiju-charge: the charge did not end (${name})`);
      }
      const seen = await actionsSeen(page);
      const runs = seen.filter((a) => a === 'charge/charge').length;
      const stumbles = seen.filter((a) => a === 'charge/stumble').length;
      console.log(`shots: x-kaiju-charge: the page was told of ${runs} runs and ${stumbles} stumbles`);
      if (runs < 4 || stumbles < 4) throw new Error(`x-kaiju-charge: four charges, but ${runs} runs and ${stumbles} stumbles reached the page`);
    }, { noLock: true });

    // The tail sweep: units behind the juvenile; E lashes the tail across the rear half and
    // knocks them outward. Twice: once for the coil and the lash, once for the follow-through.
    await visit('x-kaiju-sweep', { sandbox: '2', role: 'kaiju' }, async (page, shot) => {
      await sleep(2500);
      await quietSquads(page);
      await recordActions(page);
      await equip(page, ['charge', 'tailSweep']);
      const place = () =>
        page.evaluate((w) => {
          const wd = eval(w);
          const k = wd.kaijus[0];
          window.__mb.internals.ctx.runtime.controller.aimYaw = k.yaw;
          k.cooldowns.tailSweep = 0;
          k.nerve = 0;
          k.nerveImmune = 10;
          return wd.units.slice(0, 5).map((u, i) => {
            const a = k.yaw + Math.PI + (i - 2) * 0.45;
            const d = 13 + (i % 2) * 7;
            u.x = k.x + Math.sin(a) * d;
            u.z = k.z + Math.cos(a) * d;
            u.vx = 0;
            u.vz = 0;
            return { id: u.id, x: u.x, z: u.z, hp: u.hp };
          });
        }, world);
      let hitTotal = 0;
      for (const [name, when] of [
        ['1-coil', (k) => k.action === 'tailSweep' && k.phase === 'windup' && k.phaseTime > 0.15],
        ['2-lash', (k) => k.action === 'tailSweep' && (k.phase === 'active' || (k.phase === 'recover' && k.phaseTime < 0.25))],
      ]) {
        // The coil is a third of a second: a page drawing a few frames a second can step right
        // over it, so the sweep is given again (up to three times) until a frame shows it.
        let before = null;
        let caught = null;
        for (let tries = 0; tries < 3 && !caught; tries++) {
          before = await place();
          await sleep(1200);
          if (name === '1-coil' && tries === 0) await shot('0-before');
          await tapKey(page, 'KeyE');
          caught = await waitDrawn(page, when, 8000);
          if (!caught && !(await waitFor(page, (st) => st.phase === 'idle', 12000))) break;
        }
        if (!caught) throw new Error(`x-kaiju-sweep: never drawn for ${name} in three sweeps`);
        await shot(name);
        if (!(await waitFor(page, (st) => st.phase === 'idle', 12000))) throw new Error('x-kaiju-sweep: the sweep did not end');
        const after = await page.evaluate(({ w, ids }) => ids.map((id) => {
          const u = eval(w).units[id];
          return { x: u.x, z: u.z, hp: u.hp, alive: u.alive };
        }), { w: world, ids: before.map((u) => u.id) });
        hitTotal += after.filter((u, i) => !u.alive || u.hp < before[i].hp || Math.hypot(u.x - before[i].x, u.z - before[i].z) > 2).length;
      }
      const sweeps = (await actionsSeen(page)).filter((a) => a === 'tailSweep/active').length;
      console.log(`shots: x-kaiju-sweep: ${sweeps} sweeps reached the page; ${hitTotal} of 10 units behind it hit or knocked away`);
      if (sweeps < 2 || hitTotal === 0) throw new Error(`x-kaiju-sweep: ${sweeps} sweeps, ${hitTotal} units hit`);
    }, { noLock: true });

    // The roar: a squad stands round the juvenile, inside its roar; the player presses the roar's
    // move button. The shockwave spreads, each unit jolts as it reaches it, and every unit it
    // reached stands dazed (yellow dots circling over it) for the stun, then backs off shaken.
    await visit('x-kaiju-roar', { sandbox: '2', role: 'kaiju' }, async (page, shot) => {
      await sleep(2500);
      await equip(page, ['roar', 'none']);
      for (const [name, third] of [
        ['1-shockwave-and-daze', true],
        ['2-daze-first-person', false],
      ]) {
        await page.evaluate(({ w, third }) => {
          window.__mb.internals.ctx.runtime.controller.thirdPerson = third;
          const wd = eval(w);
          // The bot squads hold still where they are put (they would drive off before the roar).
          wd.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
          const k = wd.kaijus[0];
          k.cooldowns.roar = 0;
          for (const u of wd.units.slice(0, 8)) {
            const a = k.yaw + (u.id - 3.5) * 0.35;
            u.x = k.x + Math.sin(a) * (50 + (u.id % 4) * 12);
            u.z = k.z + Math.cos(a) * (50 + (u.id % 4) * 12);
            u.stun = 0;
            u.shaken = 0;
          }
        }, { w: world, third });
        await sleep(1200);
        if (third) await shot('0-before');
        await tapKey(page, 'KeyQ');
        // (A key press can be lost by a page this busy: if the roar has not even started, once more.)
        if (!(await page.waitForFunction((w) => eval(w).kaijus[0].cooldowns.roar > 0, world, { timeout: 4000 }).catch(() => null))) {
          console.log('shots: x-kaiju-roar: no roar 4 s after the key; pressing it again');
          await tapKey(page, 'KeyQ', 250);
        }
        // Counted at once: a picture can take longer than a unit stays stunned.
        const hit = await page.waitForFunction((w) => {
          const units = eval(w).units.slice(0, 8);
          const stunned = units.filter((u) => u.stun > 0).length;
          return stunned > 0 ? { stunned, shaken: units.filter((u) => u.shaken > 0).length } : null;
        }, world, { timeout: 6000 }).then((h) => h.jsonValue()).catch(() => null);
        if (!hit) throw new Error(`x-kaiju-roar: the roar stunned no unit (the kaiju: ${JSON.stringify(await kaiju(page))})`);
        console.log(`shots: x-kaiju-roar: ${hit.stunned} of 8 units stunned and ${hit.shaken} shaken by the roar`);
        // The page draws the daze once its view reaches the stun.
        const dazed = await page.waitForFunction(() => (window.__mb.internals.ctx.runtime.frame?.units ?? []).some((u) => u.stunned), null, { timeout: 3000 }).catch(() => null);
        if (!dazed) throw new Error('x-kaiju-roar: the page never drew a stunned unit');
        await shot(name);
        await sleep(2600);
      }
      await shot('3-backing-off');
    }, { noLock: true });

    // The beam: the first molt's pick, rage full, and the autopilot breathes it.
    await visit('x-kaiju-beam', { sandbox: '2', role: 'kaiju', autoplay: '1' }, async (page, shot) => {
      await sleep(2500);
      await equip(page, ['beam', 'none']);
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
        const st = await page.evaluate(() => window.__mb.state());
        if (st.kaiju && st.kaiju.action === 'special' && st.kaiju.phase === 'special') break;
        await sleep(150);
      }
      await sleep(500);
      await shot('1-beam-third-person');
      await page.evaluate(() => {
        window.__mb.internals.ctx.runtime.controller.thirdPerson = false;
      });
      await sleep(700);
      await shot('2-beam-first-person');
      // Then a stagger: the weak point shows.
      await page.evaluate(() => {
        window.__mb.internals.ctx.runtime.controller.thirdPerson = true;
        const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
        k.phase = 'stagger';
        k.action = 'none';
        k.phaseTime = 0;
        k.phaseDuration = 5;
      });
      await sleep(1500);
      await shot('3-stagger');
    });

    // Never alone: every squad is wiped out, the buildings nearest the hatchling collapse one
    // after another, and the cocoon starts by itself with the cards up.
    await visit('x-kaiju-collapse', { sandbox: '1', role: 'kaiju' }, async (page, shot) => {
      await sleep(2500);
      await page.evaluate(() => {
        window.__mb.internals.ctx.runtime.controller.aimPitch = -0.2;
        const w = window.__mb.internals.ctx.client.local.world;
        for (const s of w.squads) s.eliminated = true;
        for (const u of w.units) {
          u.alive = false;
          u.hp = 0;
        }
      });
      await sleep(900);
      await shot('1-collapsing');
      await sleep(900);
      await shot('2-collapsing');
      const cocoon = await waitFor(page, (st) => st.phase === 'cocoon', 6000);
      const counts = await page.evaluate(() => ({ ...window.__mb.internals.ctx.runtime.eventCounts }));
      console.log(`shots: x-kaiju-collapse: cityCollapse ${counts.cityCollapse ?? 0}, structure stages ${counts.structureStage ?? 0}, cocoon ${cocoon ? 'yes' : 'NO'}`);
      if (!cocoon) throw new Error('x-kaiju-collapse: the cocoon did not start by itself');
      await sleep(1200);
      await shot('3-cocoon-and-cards');
    });

    // Swimming (sim/swim.ts): the kaiju is put in the Old Moat inside its bounds and left idle;
    // it must go under by itself (the server's world says so), show its spines and a wake as
    // it swims, and come up for Roar. Stage 1 and stage 2; the squads' view of it last.
    const intoMoat = (stage) => {
      const w = window.__mb.internals.ctx.client.local.world;
      const b = w.match.bounds;
      const k = w.kaijus[0];
      // The Old Moat runs 20 m wide along the west (world +X), north (+Z) and east (-X) limits.
      const lane = stage === 1 ? 1090 : 1088;
      if (b.maxX >= 1095) {
        k.x = lane;
        k.z = (b.minZ + b.maxZ) / 2;
        k.yaw = 0;
      } else if (b.minX <= -1095) {
        k.x = -lane;
        k.z = (b.minZ + b.maxZ) / 2;
        k.yaw = 0;
      } else {
        k.x = (b.minX + b.maxX) / 2;
        k.z = lane;
        k.yaw = Math.PI / 2;
      }
      k.vx = 0;
      k.vz = 0;
      k.aimYaw = k.yaw;
      // Keep the squads out of it: this is about the look of the water.
      for (const u of w.units) {
        u.x = (b.minX + b.maxX) / 2;
        u.z = (b.minZ + b.maxZ) / 2;
      }
      return { x: k.x, z: k.z, yaw: k.yaw };
    };
    const submerge = (page) => page.evaluate(() => window.__mb.internals.ctx.client.local.world.kaijus[0].submerge);
    for (const stage of [1, 2]) {
      await visit(`x-kaiju-swim-s${stage}`, { sandbox: String(stage), role: 'kaiju' }, async (page, shot) => {
        await sleep(2000);
        const at = await page.evaluate(intoMoat, stage);
        // The view along the moat.
        await page.evaluate((yaw) => {
          const c = window.__mb.internals.ctx.runtime.controller;
          c.aimYaw = yaw;
          c.aimPitch = -0.15;
        }, at.yaw);
        await sleep(3000);
        const under = await submerge(page);
        console.log(`shots: x-kaiju-swim-s${stage}: submerge ${under.toFixed(2)} after 3 s idle in the moat`);
        if (under < 1) throw new Error(`x-kaiju-swim-s${stage}: the kaiju did not go under in the moat`);
        await shot('1-under-first-person');
        await page.evaluate(() => {
          window.__mb.internals.ctx.runtime.controller.thirdPerson = true;
        });
        await sleep(900);
        await shot('2-under-third-person');
        await page.keyboard.down('KeyW');
        await sleep(2500);
        await shot('3-swimming-wake');
        await page.keyboard.up('KeyW');
        const moving = await submerge(page);
        if (moving < 1) throw new Error(`x-kaiju-swim-s${stage}: it came up while swimming along the moat`);
        // Roar (on the first move button) brings it up, and it roars once it is up.
        await page.evaluate(() => {
          const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
          k.moves = ['roar', 'none'];
          k.cooldowns.roar = 0;
        });
        await page.keyboard.down('KeyQ');
        await sleep(150);
        await page.keyboard.up('KeyQ');
        let roared = false;
        // (On a busy machine the sandbox can take a few seconds to hear a key.)
        for (let i = 0; i < 60 && !roared; i++) {
          await sleep(100);
          roared = await page.evaluate(() => window.__mb.internals.ctx.client.local.world.kaijus[0].action === 'roar');
        }
        const up = await submerge(page);
        console.log(`shots: x-kaiju-swim-s${stage}: after Roar, submerge ${up.toFixed(2)}, roared ${roared}`);
        if (!roared || up > 0) throw new Error(`x-kaiju-swim-s${stage}: Roar did not bring it up and roar`);
        await shot('4-up-and-roaring');
      });
    }
    await visit('x-human-swim', { sandbox: '2', role: 'human' }, async (page, shot) => {
      await sleep(2000);
      // The bot kaiju lies still (it would go back to wrecking), and so do the bot squads.
      await page.evaluate(() => {
        window.__mb.internals.ctx.client.local.world.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
      });
      await page.evaluate(intoMoat, 2);
      await sleep(2500);
      if ((await submerge(page)) < 1) throw new Error('x-human-swim: the kaiju did not go under in the moat');
      // The player's unit on the bank, 70 m along the moat, looking at the spines.
      await page.evaluate(() => {
        const w = window.__mb.internals.ctx.client.local.world;
        const k = w.kaijus[0];
        const squad = w.squads[w.players.find((p) => !p.bot && p.role === 'human').squadId];
        const u = w.units[squad.driven];
        const inward = Math.abs(k.x) > Math.abs(k.z) ? { x: -Math.sign(k.x), z: 0 } : { x: 0, z: -Math.sign(k.z) };
        const along = { x: -inward.z, z: inward.x };
        // (On the beltway, between the moat and the houses.)
        u.x = k.x + inward.x * 16 + along.x * 70;
        u.z = k.z + inward.z * 16 + along.z * 70;
        u.vx = 0;
        u.vz = 0;
      });
      // (A unit that jumps looks toward the middle of the zone: turn it once it has landed.)
      await sleep(600);
      await page.evaluate(() => {
        const w = window.__mb.internals.ctx.client.local.world;
        const k = w.kaijus[0];
        const me = window.__mb.state().me;
        const c = window.__mb.internals.ctx.runtime.controller;
        c.viewYaw = Math.atan2(k.x - me.x, k.z - me.z);
        c.viewPitch = -0.05;
      });
      await sleep(1500);
      await shot('1-spines-from-the-bank');
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
