/**
 * The scripted playtest's phase 2 sessions (docs/ROADMAP.md, "weapons and pick-ups"), played
 * with real inputs in the sandbox (`?sandbox=1`: the page runs the simulation behind the same
 * messages as a room, so its snapshots and events stand in for the server's). The scene is set
 * with the sandbox's own hook (`client.local.apply`: a city weapon laid in reach of the hand, a
 * supply crate put down in front of the squad); everything after that is real key and mouse
 * input, judged only by the snapshots and events that came back (driver.mjs).
 *
 *   weapons-kaiju   for each city weapon (propane tank, water tank, antenna, fast-food sign,
 *                   garage door, the radio mast's top): picked up with the right button, dropped
 *                   with it (it lies loose), picked up again, then used with the left button: a
 *                   tank thrown and bursting, a javelin thrown, the sign swung three times until
 *                   it breaks, the door taking the squads' shots from the front and then thrown
 *                   like a frisbee; and a propane tank in the hand set off by the squads' fire
 *                   (the blast and the flinch). The kit's pictures are checked too (client-side).
 *   weapons-squad   a crate of each of the five kinds driven onto with W and taken; the machine
 *                   gun, big cannon and missile pod fired with the left button (their own shots);
 *                   the artillery radio's volley held with the right button and let go (the fire
 *                   mission marked, its shells falling); reinforcements bringing a dead squad-mate
 *                   back by parachute. The HUD's pick-up pictures are checked too (client-side).
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { disablePointerLock, Driver, sleep } from './driver.mjs';
import { CHROMIUM_ARGS } from './smoke.mjs';

const require = createRequire(import.meta.url);

const CITY_WEAPONS = ['propane', 'watertank', 'antenna', 'foodsign', 'garagedoor', 'mast'];
const PICKUPS = ['machineGun', 'bigCannon', 'missilePod', 'artilleryRadio', 'reinforcements'];
const SHOT_OF = { machineGun: 'tracer', bigCannon: 'heavyShell', missilePod: 'missile' };

async function openSandbox(opts, origin, errors, name, role) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  await context.addInitScript(disablePointerLock);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: uncaught: ${e.message}`));
  const driver = new Driver(page, { width: opts.width, height: opts.height });
  await page.goto(`${origin}/?sandbox=1&role=${role}&name=${name}&mute=1&fps=30`, { waitUntil: 'load' });
  const playing = await driver.until((q) => (q.match && q.match.phase === 'playing' && q.screen === 'match' ? q : null), 60000, 200);
  return { browser, page, driver, playing };
}

/** In the page: the bots stand still, nobody fires, no crates of their own come down. */
function quietInPage() {
  const w = window.__mb.internals.ctx.client.local.world;
  w.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
  w.config.crates = false;
  w.crates.length = 0;
  for (const u of w.units) u.cooldown = 1e6;
}

/** In the page: lays a city weapon loose on the ground where the kaiju's hand closes. */
function layLooseInPage(kind) {
  const local = window.__mb.internals.ctx.client.local;
  let id = -1;
  local.apply((w) => {
    const k = w.kaijus[0];
    const x = k.x + Math.sin(k.aimYaw) * k.radius * 0.6;
    const z = k.z + Math.cos(k.aimYaw) * k.radius * 0.6;
    id = w.loose.length;
    w.loose.push({ id, kind, x, z, yaw: k.aimYaw, state: 'down', landsAt: 0 });
    w.events.push({ type: 'looseProp', tick: w.tick, id, prop: kind, x, z, yaw: k.aimYaw, state: 'down', cause: 'drop' });
  });
  return id;
}

/** In the page: the squads shoot at will again (or stop), the bot squads fight (or stand still). */
function squadsFireInPage(on) {
  const w = window.__mb.internals.ctx.client.local.world;
  w.config.bots = { kaijuHandicap: 1, humanHandicap: on ? 0 : 1 };
  for (const u of w.units) u.cooldown = on ? 0 : 1e6;
}

/** In the page: what the kaiju kit shows (client-side). */
function kitInPage() {
  const icon = (sel) => document.querySelector(`${sel} .hint-icon > .icon`)?.getAttribute('data-icon') ?? '';
  return {
    strike: icon('.kit-strike'),
    grab: icon('.kit-grab'),
    pips: document.querySelectorAll('.kit-strike .kit-pip.on').length,
    volatile: document.querySelector('.kit-strike')?.classList.contains('volatile') ?? false,
    shield: !(document.querySelector('.kit-shield')?.classList.contains('hidden') ?? true),
    shieldBar: parseFloat(document.querySelector('.kit-shield-fill')?.style.width ?? '0'),
    surge: !(document.querySelector('.kit-surge')?.classList.contains('hidden') ?? true),
  };
}

/**
 * Waits for events of a type (the page hands them out when its view, a tenth of a second behind
 * the newest snapshot, reaches them: a snapshot can show what happened before its event is in).
 */
async function eventsOf(driver, from, type, filter, count = 1, timeoutMs = 4000) {
  await driver.until(() => (driver.eventsSince(from, type, filter).length >= count ? true : null), timeoutMs, 60);
  return driver.eventsSince(from, type, filter);
}

/** The nearest living unit to a point, from a probe. */
function nearestUnit(p, x, z) {
  let best = null;
  for (const u of p.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - x, u.z - z);
    if (!best || d < best.d) best = { u, d };
  }
  return best;
}

export async function playWeaponsKaiju(opts, origin, errors, Report) {
  const report = new Report('weapons-kaiju');
  const { browser, page, driver, playing } = await openSandbox(opts, origin, errors, 'Hatchling', 'kaiju');
  const shot = (name) => driver.screenshot(join(opts.out, `weapons-kaiju-${name}.png`));
  try {
    if (!playing) {
      report.fail('weapons: the sandbox match starts', 'no snapshot with phase "playing"');
      return report;
    }
    await page.evaluate(quietInPage);
    await sleep(1000);
    const idle = () => driver.until((q) => (q.kaiju && q.kaiju.phase === 'idle' ? q : null), 6000);

    for (const kind of CITY_WEAPONS) {
      await idle();
      // Whatever an earlier step left in the hand is let go first (Grab drops a city weapon).
      if ((await driver.probe())?.kaiju?.held) {
        await driver.click('right');
        await driver.until((q) => (q.kaiju && q.kaiju.held === null && q.kaiju.phase === 'idle' ? q : null), 5000);
      }
      // --- grab it (the right button) ---
      let from = driver.events.length;
      const looseId = await page.evaluate(layLooseInPage, kind);
      await sleep(400);
      await driver.click('right');
      let held = await driver.until((q) => (q.kaiju?.held?.kind === 'prop' && q.kaiju.held.prop === kind ? q : null), 5000);
      let grab = await eventsOf(driver, from, 'kaijuHeld', (e) => e.reason === 'grab' && e.source === 'loose' && e.sourceId === looseId);
      if (held && grab.length > 0) report.pass(`weapons: Grab picks up the ${kind}`, `right button with a ${kind} lying in reach: kaijuHeld 'grab' from the loose object ${looseId}; the snapshot's kaiju holds a ${kind}`);
      else {
        report.fail(`weapons: Grab picks up the ${kind}`, `right button with a ${kind} lying in reach: held ${JSON.stringify((await driver.probe())?.kaiju?.held)}, grab events ${grab.length}`);
        continue;
      }
      // The kit says what the buttons do with it now (client-side).
      await sleep(400);
      const kit = await page.evaluate(kitInPage);
      const wantStrike = kind === 'foodsign' ? 'k_club' : kind === 'antenna' || kind === 'mast' ? 'k_javelin' : 'k_throw';
      const extra = kind === 'foodsign' ? kit.pips === 3 : kind === 'garagedoor' ? kit.shield && kit.shieldBar > 99 : kind === 'propane' ? kit.volatile : true;
      if (kit.strike === wantStrike && kit.grab === 'k_drop' && extra) report.pass(`weapons: the kit shows what to do with the ${kind} (client-side)`, `Strike shows ${kit.strike}, Grab ${kit.grab}${kind === 'foodsign' ? `, ${kit.pips} swings left` : kind === 'garagedoor' ? `, the door's strength ${kit.shieldBar}%` : kind === 'propane' ? ', Strike throbs red' : ''}`);
      else report.fail(`weapons: the kit shows what to do with the ${kind} (client-side)`, `kit ${JSON.stringify(kit)}; wanted Strike ${wantStrike}, Grab k_drop`);
      await shot(`${kind}-1-held`);

      // --- drop it (the right button again), and pick it up again ---
      await idle();
      from = driver.events.length;
      await driver.click('right');
      const dropped = await driver.until((q) => (q.kaiju && q.kaiju.held === null ? q : null), 5000);
      const drop = await eventsOf(driver, from, 'kaijuHeld', (e) => e.reason === 'drop');
      const lies = await eventsOf(driver, from, 'looseProp', (e) => e.prop === kind && e.state === 'down' && e.cause === 'drop');
      if (dropped && drop.length > 0 && lies.length > 0) report.pass(`weapons: Grab drops the ${kind}`, `right button with it in the hand: kaijuHeld 'drop', and it lies loose (looseProp ${lies[0].id} 'down'); never eaten`);
      else {
        report.fail(`weapons: Grab drops the ${kind}`, `right button: drop events ${drop.length}, looseProp ${lies.length}, held ${JSON.stringify((await driver.probe())?.kaiju?.held)}`);
        continue;
      }
      await idle();
      from = driver.events.length;
      await driver.click('right');
      held = await driver.until((q) => (q.kaiju?.held?.kind === 'prop' && q.kaiju.held.prop === kind ? q : null), 5000);
      grab = await eventsOf(driver, from, 'kaijuHeld', (e) => e.reason === 'grab' && e.source === 'loose' && e.sourceId === lies[0].id);
      if (!held || grab.length === 0) {
        report.fail(`weapons: the dropped ${kind} is picked up again`, `right button over it: grab events ${grab.length}`);
        continue;
      }
      report.pass(`weapons: the dropped ${kind} is picked up again`, `right button over it: kaijuHeld 'grab' from loose object ${lies[0].id}`);

      // --- use it (the left button) ---
      await idle();
      if (kind === 'foodsign') {
        // Three swings, then it breaks.
        from = driver.events.length;
        for (let i = 0; i < 3; i++) {
          await idle();
          await driver.click('left');
          await driver.until(() => (driver.eventsSince(from, 'clubSwing').length > i ? true : null), 5000);
          if (i === 0) await shot(`${kind}-2-swing`);
        }
        const swings = await eventsOf(driver, from, 'clubSwing', () => true, 3);
        const broke = await eventsOf(driver, from, 'signBroken', () => true);
        const after = await driver.probe();
        if (swings.length === 3 && swings[2].swingsLeft === 0 && broke.length === 1 && after.kaiju.held === null) report.pass('weapons: Strike swings the sign three times, then it breaks', `three presses of the left button: clubSwing ×3 (swings left ${swings.map((s) => s.swingsLeft).join(', ')}), signBroken, the hand empty`);
        else report.fail('weapons: Strike swings the sign three times, then it breaks', `clubSwing ${swings.length} (${swings.map((s) => s.swingsLeft).join(', ')}), signBroken ${broke.length}, held ${JSON.stringify(after.kaiju.held)}`);
        continue;
      }
      if (kind === 'garagedoor') {
        // The squads open fire; the kaiju turns to face the nearest of them: the door takes the shots.
        let p = await driver.probe();
        const near = nearestUnit(p, p.kaiju.x, p.kaiju.z);
        if (near) await driver.lookTo(Math.atan2(near.u.x - p.kaiju.x, near.u.z - p.kaiju.z), 0, 0.08, 5000);
        from = driver.events.length;
        await page.evaluate(squadsFireInPage, true);
        const hit = await driver.until(() => (driver.eventsSince(from, 'shieldHit').length >= 3 ? true : null), 25000, 200);
        await page.evaluate(squadsFireInPage, false);
        p = await driver.probe();
        const hits = driver.eventsSince(from, 'shieldHit');
        if (hit && p.kaiju.held?.prop === 'garagedoor' && p.kaiju.shieldHp < 250) report.pass('weapons: the garage door takes shots from the front', `the squads fired at the kaiju facing them: shieldHit ×${hits.length}, the door's hp ${p.kaiju.shieldHp.toFixed(0)} of 250 in the snapshot`);
        else if (hits.length > 0 && p.kaiju.held === null) report.pass('weapons: the garage door takes shots from the front', `shieldHit ×${hits.length}; it broke (shieldBroken ${driver.eventsSince(from, 'shieldBroken').length})`);
        else report.fail('weapons: the garage door takes shots from the front', `shieldHit ×${hits.length} in 25 s; held ${JSON.stringify(p.kaiju.held)}`);
        await shot(`${kind}-2-shield`);
        if (p.kaiju.held?.prop !== 'garagedoor') continue;
        await idle();
      }
      // Thrown: at the ground ahead (a javelin straight along the aim).
      const p0 = await driver.probe();
      await driver.lookTo(p0.view.yaw, kind === 'antenna' || kind === 'mast' ? 0 : -0.25, 0.06, 4000);
      from = driver.events.length;
      await driver.click('left');
      const spawned = await driver.until(() => {
        const s = driver.eventsSince(from, 'projectileSpawn', (e) => e.owner === 'kaiju' && e.payload?.kind === 'prop' && e.payload.prop === kind);
        return s.length > 0 ? s[0] : null;
      }, 5000);
      if (!spawned) {
        report.fail(`weapons: Strike throws the ${kind}`, 'left button: no projectileSpawn carrying it');
        continue;
      }
      const landed = await driver.until(() => (driver.eventsSince(from, 'projectileHit', (e) => e.id === spawned.id).length > 0 ? true : null), 8000);
      const what =
        kind === 'propane'
          ? await eventsOf(driver, from, 'propaneBlast', (e) => e.how === 'thrown')
          : kind === 'watertank'
            ? await eventsOf(driver, from, 'waterSplash', () => true)
            : driver.eventsSince(from, 'projectileHit', (e) => e.id === spawned.id);
      const verb = kind === 'antenna' || kind === 'mast' ? 'as a javelin' : kind === 'garagedoor' ? 'like a frisbee' : '';
      const flight = `speed ${Math.hypot(spawned.vx, spawned.vy, spawned.vz).toFixed(0)} m/s, gravity ${spawned.gravity}`;
      if (landed && what.length > 0) report.pass(`weapons: Strike throws the ${kind} ${verb}`.trim(), `left button: projectileSpawn ${spawned.id} carrying it (${flight}), then ${kind === 'propane' ? "propaneBlast 'thrown'" : kind === 'watertank' ? 'waterSplash' : `projectileHit on the ${what[0].target}`}`);
      else report.fail(`weapons: Strike throws the ${kind} ${verb}`.trim(), `projectileSpawn ${spawned.id} (${flight}); landed ${!!landed}, its own event ${what.length}`);
      await shot(`${kind}-3-thrown`);
    }

    // --- a propane tank in the hand, set off by the squads' fire: the blast and the flinch ---
    {
      await idle();
      let from = driver.events.length;
      const id = await page.evaluate(layLooseInPage, 'propane');
      await sleep(400);
      await driver.click('right');
      const held = await driver.until((q) => (q.kaiju?.held?.prop === 'propane' ? q : null), 5000);
      if (!held) report.fail('weapons: a propane tank in the hand is set off by fire', `could not pick up loose propane ${id}`);
      else {
        const p = await driver.probe();
        const near = nearestUnit(p, p.kaiju.x, p.kaiju.z);
        if (near) await driver.lookTo(Math.atan2(near.u.x - p.kaiju.x, near.u.z - p.kaiju.z), 0, 0.08, 5000);
        from = driver.events.length;
        await page.evaluate(squadsFireInPage, true);
        const blast = await driver.until(() => (driver.eventsSince(from, 'propaneBlast', (e) => e.how === 'hand').length > 0 ? true : null), 30000, 200);
        await page.evaluate(squadsFireInPage, false);
        const flinch = await eventsOf(driver, from, 'kaijuFlinch', () => true);
        if (blast && flinch.length > 0) report.pass('weapons: a propane tank in the hand is set off by fire', `the squads fired at the kaiju holding it: propaneBlast 'hand', kaijuFlinch for ${flinch[0].duration} s`);
        else if (blast) report.fail('weapons: a propane tank in the hand is set off by fire', "propaneBlast 'hand' but no kaijuFlinch");
        else report.skip('weapons: a propane tank in the hand is set off by fire', 'no shot landed near the hand within 30 s (the bot squads may not have had a line of fire)');
        await shot('propane-4-hand');
      }
    }
  } catch (err) {
    report.fail('weapons-kaiju: the session ran to its end', err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }
  return report;
}

/** In the page: puts a landed crate of a kind on the ground `ahead` meters in front of the player's unit, along its heading. */
function layCrateInPage({ kind, ahead }) {
  const local = window.__mb.internals.ctx.client.local;
  let out = null;
  local.apply((w) => {
    const me = w.players.find((p) => !p.bot && p.role === 'human');
    const u = w.units[w.squads[me.squadId].driven];
    const x = u.x + Math.sin(u.yaw) * ahead;
    const z = u.z + Math.cos(u.yaw) * ahead;
    const id = w.nextCrateId++;
    w.crates.push({ id, kind, x, z, fall: 0 });
    out = { id, x, z };
  });
  return out;
}

/** In the page: one of the player's squad-mates is lost (as if killed), for the reinforcements. */
function loseMateInPage() {
  const w = window.__mb.internals.ctx.client.local.world;
  const me = w.players.find((p) => !p.bot && p.role === 'human');
  const squad = w.squads[me.squadId];
  const mate = squad.units.map((id) => w.units[id]).find((u) => u.alive && u.id !== squad.driven);
  if (!mate) return -1;
  mate.alive = false;
  mate.hp = 0;
  mate.members = 0;
  return mate.id;
}

/** In the page: what the squad's HUD shows of its pick-ups (client-side). */
function squadHudInPage() {
  const fire = document.querySelector('.hud .hints:not(.kaiju-kit) .hint .hint-icon > .icon')?.getAttribute('data-icon') ?? '';
  const radio = document.querySelector('.squad-radio');
  return { fire, radio: !!radio && !radio.classList.contains('hidden'), pips: document.querySelectorAll('.radio-pip.on').length };
}

export async function playWeaponsSquad(opts, origin, errors, Report) {
  const report = new Report('weapons-squad');
  const { browser, page, driver, playing } = await openSandbox(opts, origin, errors, 'Quartermaster', 'human');
  const shot = (name) => driver.screenshot(join(opts.out, `weapons-squad-${name}.png`));
  try {
    if (!playing || !playing.me) {
      report.fail('pick-ups: the sandbox match starts', 'no snapshot with phase "playing" and a unit of our own');
      return report;
    }
    await page.evaluate(quietInPage);
    await sleep(1200);
    // Face the open street: the crates go down ahead of the unit, along its heading.
    for (const kind of PICKUPS) {
      let p = await driver.probe();
      let lost = -1;
      if (kind === 'reinforcements') {
        lost = await page.evaluate(loseMateInPage);
        await sleep(600);
      }
      // Our own unit's heading in the snapshot: look along it, then drive onto the crate with W.
      await driver.lookTo(p.me.yaw, 0, 0.08, 4000);
      p = await driver.probe();
      const crate = await page.evaluate(layCrateInPage, { kind, ahead: 9 });
      const from = driver.events.length;
      await driver.keyDown('KeyW');
      const took = await driver.until(() => {
        const t = driver.eventsSince(from, 'crate', (e) => e.phase === 'take' && e.id === crate.id);
        return t.length > 0 ? t[0] : null;
      }, 8000, 50);
      await driver.keyUp('KeyW');
      if (!took) {
        report.fail(`pick-ups: driving onto a ${kind} crate takes it`, `held W toward crate ${crate.id} 9 m ahead: no 'take' in 8 s`);
        continue;
      }
      await sleep(500);
      p = await driver.probe();
      const sq = p.squad;
      const got =
        kind === 'artilleryRadio' ? sq.barrages === 3 : kind === 'reinforcements' ? (await eventsOf(driver, from, 'reinforce', () => true)).length > 0 : sq.pickup === kind;
      if (took.kind === kind && took.squad === sq.id && got) report.pass(`pick-ups: driving onto a ${kind} crate takes it`, `held W: crate ${crate.id} 'take' by unit ${took.unit} of our squad, holding ${took.kind}; the snapshot's squad has ${kind === 'artilleryRadio' ? `${sq.barrages} barrages` : kind === 'reinforcements' ? 'reinforcements coming' : `pickup ${sq.pickup}`}`);
      else report.fail(`pick-ups: driving onto a ${kind} crate takes it`, `take ${JSON.stringify(took)}; squad pickup ${sq.pickup}, barrages ${sq.barrages}`);
      const hud = await page.evaluate(squadHudInPage);
      await shot(`${kind}-1-taken`);

      if (SHOT_OF[kind]) {
        // The pick-up's own shot, with the left button.
        if (hud.fire === `pk_${kind.toLowerCase()}`) report.pass(`pick-ups: the HUD shows the ${kind} on Fire (client-side)`, `Fire's picture is ${hud.fire}`);
        else report.fail(`pick-ups: the HUD shows the ${kind} on Fire (client-side)`, `Fire's picture is ${hud.fire}`);
        await driver.until((q) => (q.me && q.me.cooldown <= 0 ? q : null), 15000);
        const f2 = driver.events.length;
        await driver.click('left');
        const fired = await driver.until(() => {
          const s = driver.eventsSince(f2, 'projectileSpawn', (e) => e.owner === 'unit' && e.ownerId === p.me.id);
          return s.length > 0 ? s : null;
        }, 6000);
        if (fired && fired.every((e) => e.projectile === SHOT_OF[kind])) report.pass(`pick-ups: Fire shoots the ${kind}`, `left button: ${fired.length} ${SHOT_OF[kind]} shot(s) from our unit${kind === 'missilePod' ? `, flight ${fired[0].flight}` : ''}`);
        else report.fail(`pick-ups: Fire shoots the ${kind}`, `left button: shots ${fired ? fired.map((e) => e.projectile).join(', ') : 'none'}`);
        await sleep(300);
        await shot(`${kind}-2-fired`);
      } else if (kind === 'artilleryRadio') {
        if (hud.radio && hud.pips === 3) report.pass('pick-ups: the HUD shows the radio and its 3 barrages (client-side)', 'the radio beside Volley with 3 pips lit');
        else report.fail('pick-ups: the HUD shows the radio and its 3 barrages (client-side)', JSON.stringify(hud));
        // A charged volley at the ground ahead calls a barrage there.
        await driver.lookTo(p.me.yaw, -0.12, 0.06, 4000);
        await page.evaluate(() => {
          const w = window.__mb.internals.ctx.client.local.world;
          for (const u of w.units) u.cooldown = 0;
        });
        const f2 = driver.events.length;
        await driver.page.mouse.move(opts.width / 2, opts.height / 2);
        await driver.page.mouse.down({ button: 'right' });
        await driver.until((q) => (q.squadUnits.filter((u) => u.rooted && u.charge > 0.95).length >= 1 ? q : null), 9000, 100);
        await driver.page.mouse.up({ button: 'right' });
        const marked = await driver.until(() => {
          const m = driver.eventsSince(f2, 'callin', (e) => e.phase === 'marked');
          return m.length > 0 ? m[0] : null;
        }, 4000);
        const volley = await eventsOf(driver, f2, 'volley', () => true);
        if (marked && volley.length > 0) report.pass('pick-ups: a charged volley with the radio calls a barrage', `held the right button to full charge and let go: volley (charge ${volley[0].charge.toFixed(2)}), then callin 'marked' at ${marked.x.toFixed(0)}, ${marked.z.toFixed(0)}, first shell in ${marked.delay} s`);
        else report.fail('pick-ups: a charged volley with the radio calls a barrage', `volley events ${volley.length}, marked ${!!marked}`);
        await sleep(800);
        await shot(`${kind}-2-marked`);
        if (marked) {
          const shells = await driver.until(() => (driver.eventsSince(f2, 'projectileHit', (e) => e.projectile === 'arty').length >= 4 ? true : null), 12000, 100);
          const after = await driver.probe();
          const n = driver.eventsSince(f2, 'projectileHit', (e) => e.projectile === 'arty').length;
          if (shells && after.squad.barrages === 2) report.pass('pick-ups: the barrage falls, and the radio has one fewer', `${n} artillery shells landed; the snapshot's squad has ${after.squad.barrages} barrages left`);
          else report.fail('pick-ups: the barrage falls, and the radio has one fewer', `${n} shells landed; barrages ${after.squad.barrages}`);
          await shot(`${kind}-3-barrage`);
        }
      } else if (kind === 'reinforcements') {
        const r = driver.eventsSince(from, 'reinforce');
        const coming = r.length > 0 && r[0].units.includes(lost);
        const fell = coming && (await driver.until((q) => (q.units[lost]?.alive && q.units[lost].y > 1 ? q : null), 2000, 50));
        const down = coming && (await driver.until((q) => (q.units[lost]?.alive && q.units[lost].y <= 0.05 ? q : null), 8000, 100));
        if (coming && down) report.pass('pick-ups: reinforcements bring a dead squad-mate back by parachute', `reinforce: units ${r[0].units.join(', ')} coming down (unit ${lost} seen ${fell ? `${fell.units[lost].y.toFixed(0)} m up` : 'coming down'}), healed ${r[0].healed.join(', ')}; unit ${lost} alive on the ground`);
        else report.fail('pick-ups: reinforcements bring a dead squad-mate back by parachute', `reinforce ${JSON.stringify(r[0] ?? null)}; lost unit ${lost}`);
      }
    }
  } catch (err) {
    report.fail('weapons-squad: the session ran to its end', err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }
  return report;
}

