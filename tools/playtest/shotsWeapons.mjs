/**
 * shots.mjs extras for phase 2's weapons and pick-ups (docs/ROADMAP.md: "something happening
 * every 20 seconds"): pictures of the monster's city weapons and power surge and of the army's
 * crates, pick-up weapons, artillery and reinforcements, taken in the sandbox.
 *
 * The scenes are set with the sandbox's hooks (`client.local.apply` to change the world between
 * two steps, `client.local.pause` to hold it still while a picture is taken: on a software-drawn
 * page a picture takes a second or more, longer than a swing or a shell's flight). The bot
 * kaiju is made to act by writing the input its bot would write (`botInput`). Moments that are
 * all particles (an explosion, a splash) are also caught as the 3D view draws them, frame by
 * frame (`*-frames-NN.jpg`, the view without the HUD).
 *
 *   x-weapons-kit    the monster's own view: the kit with a sign (three swings), a door (its
 *                    strength and the front it covers), an antenna (the javelin's aim line), a
 *                    propane tank (Strike throbbing red); then a power surge (arcs, the ring, the
 *                    move slots flashing)
 *   x-weapons-army   a squad's view of the hatchling: the sign held up and swung (the swing's
 *                    trail), the door taking shots (sparks) and breaking, a javelin in flight and
 *                    stuck, a water tank's splash knocking the squad flat, a propane tank going up
 *   x-pickups        a crate coming down under its parachute, landed (its beacon and picture),
 *                    taken (the HUD's picture); the map with crates, then the map's static; the
 *                    machine gun, the big cannon and the missile pod firing; the artillery radio's
 *                    barrage (red smoke and the closing ring, the shells falling, the impacts);
 *                    reinforcements coming down by parachute
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- in the page --------------------------------------------------------------------------------

/** The bots stand still, nobody fires, no crates of their own come down. */
function quietInPage() {
  const w = window.__mb.internals.ctx.client.local.world;
  w.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
  w.config.crates = false;
  w.crates.length = 0;
  for (const u of w.units) u.cooldown = 1e6;
}

/** Moves the kaiju to the most open street spot near it (nothing standing within the most meters). */
function openGroundInPage() {
  const w = window.__mb.internals.ctx.client.local.world;
  const k = w.kaijus[0];
  const b = w.match.bounds;
  let best = null;
  let bestScore = -1;
  for (const n of w.city.roads.nodes) {
    if (n.x < b.minX + 40 || n.x > b.maxX - 40 || n.z < b.minZ + 40 || n.z > b.maxZ - 40) continue;
    if (Math.hypot(n.x - k.x, n.z - k.z) > 160) continue;
    let clear = 60;
    for (const s of w.city.structures) clear = Math.min(clear, Math.hypot(s.x - n.x, s.z - n.z) - Math.max(s.hx, s.hz));
    for (const p of w.city.props) {
      if (p.kind.startsWith('tree') || p.kind === 'lamp' || p.kind === 'billboard') clear = Math.min(clear, Math.hypot(p.x - n.x, p.z - n.z) - 3);
    }
    if (clear > bestScore) {
      bestScore = clear;
      best = n;
    }
  }
  if (best) {
    k.x = best.x;
    k.z = best.z;
    k.vx = 0;
    k.vz = 0;
  }
  return bestScore;
}

/** Gives the kaiju a city weapon in the hand, as a grab would. */
function giveInPage(prop) {
  window.__mb.internals.ctx.client.local.apply((w) => {
    const k = w.kaijus[0];
    k.held = { kind: 'prop', prop };
    k.clubSwings = prop === 'foodsign' ? 3 : 0;
    k.shieldHp = prop === 'garagedoor' ? 250 : 0;
    w.events.push({ type: 'kaijuHeld', tick: w.tick, kaiju: 0, held: k.held, reason: 'grab', source: 'none', sourceId: -1 });
  });
}

/**
 * Puts the player's squad `dist` meters from the kaiju, `side` radians off its facing, the
 * leader in front and the squad-mates behind it (nobody shooting), and turns the view onto it.
 */
function squadViewInPage({ dist, side }) {
  const w = window.__mb.internals.ctx.client.local.world;
  const k = w.kaijus[0];
  const me = w.players.find((p) => !p.bot && p.role === 'human');
  const squad = w.squads[me.squadId];
  const face = k.yaw + side;
  const x = k.x + Math.sin(face) * dist;
  const z = k.z + Math.cos(face) * dist;
  const yaw = Math.atan2(k.x - x, k.z - z);
  squad.units.forEach((id, i) => {
    const u = w.units[id];
    // The squad-mates out to the sides, so the view past the leader is clear.
    const across = i === 0 ? 0 : [-14, 14, -28][(i - 1) % 3];
    const back = i === 0 ? 0 : 2;
    u.x = x + Math.cos(yaw) * across - Math.sin(yaw) * back;
    u.z = z - Math.sin(yaw) * across - Math.cos(yaw) * back;
    u.vx = 0;
    u.vz = 0;
    u.yaw = yaw;
    u.aimYaw = yaw;
    u.control.aimYaw = yaw;
    u.cooldown = 1e6;
  });
  // The kaiju looks at the squad.
  k.aimYaw = Math.atan2(x - k.x, z - k.z);
  return { yaw, x, z };
}

function lookInPage({ yaw, pitch }) {
  const c = window.__mb.internals.ctx.runtime.controller;
  c.thirdPerson = true;
  c.viewYaw = yaw;
  c.viewPitch = pitch;
}

/** The bot kaiju presses a button on its next input. */
function kaijuPressInPage({ button, aimYaw, aimPitch = 0 }) {
  const w = window.__mb.internals.ctx.client.local.world;
  const k = w.kaijus[0];
  const p = w.players[k.player];
  const BTN = { strike: 1, grab: 2, stomp: 1024 };
  p.botInput = { seq: (p.input.seq ?? 0) + 1, moveX: 0, moveZ: 0, aimYaw: aimYaw ?? k.aimYaw, aimPitch, buttons: BTN[button] };
}

function pauseInPage(on) {
  window.__mb.internals.ctx.client.local.pause(on);
}

/**
 * Holds the simulation still the moment its kaiju is `phase` of `action` at least `after`
 * seconds in (watched from inside the page, so a slow page cannot miss a moment that lasts a
 * tenth of a second). Resolves true when it did, false after `timeoutMs`.
 */
function pauseAtInPage({ action, phase, after, timeoutMs }) {
  const local = window.__mb.internals.ctx.client.local;
  return new Promise((done) => {
    const start = performance.now();
    const timer = setInterval(() => {
      const k = local.world.kaijus[0];
      if (k.action === action && k.phase === phase && k.phaseTime >= after) {
        local.pause(true);
        clearInterval(timer);
        done(true);
      } else if (performance.now() - start > timeoutMs) {
        clearInterval(timer);
        done(false);
      }
    }, 2);
  });
}

/** How many simulation events of a type the page has handed out (counted by the runtime). */
function countInPage(type) {
  return window.__mb.internals.ctx.runtime.eventCounts[type] ?? 0;
}

/** Records what the 3D view draws, every frame (see `saveFrames`). */
function recordInPage({ width, max }) {
  const r = window.__mb.internals.ctx.renderer;
  const canvas = r.renderer.domElement;
  window.__rec = { frames: [], on: true, max, width };
  if (!r.__recWrapped) {
    r.__recWrapped = true;
    const draw = r.render.bind(r);
    r.render = () => {
      draw();
      const rec = window.__rec;
      if (!rec || !rec.on || rec.frames.length >= rec.max) return;
      // Straight after the draw the canvas still holds the frame.
      rec.frames.push(createImageBitmap(canvas, { resizeWidth: rec.width, resizeHeight: Math.round((rec.width * canvas.height) / canvas.width), resizeQuality: 'medium' }));
    };
  }
}

async function framesInPage() {
  const rec = window.__rec;
  if (!rec) return [];
  rec.on = false;
  const out = [];
  for (const p of rec.frames) {
    try {
      const bmp = await p;
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      out.push(c.toDataURL('image/jpeg', 0.88));
    } catch {
      // A frame that could not be read is left out.
    }
  }
  return out;
}

// --- in the script ------------------------------------------------------------------------------

/** Waits until `test` (evaluated in the page) is truthy; returns its value or null. */
async function until(page, fn, arg, timeoutMs = 8000, everyMs = 80) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(everyMs);
  }
}

/** Starts recording (the first frame of a recording is slow to come: it is warmed up first). */
async function record(page, width, max) {
  await page.evaluate(recordInPage, { width, max: 1 });
  await sleep(2500);
  await page.evaluate(recordInPage, { width, max });
}

async function saveFrames(page, out, tag) {
  const frames = await page.evaluate(framesInPage);
  frames.forEach((url, i) => writeFileSync(join(out, `${tag}-frames-${String(i).padStart(2, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64')));
  return frames.length;
}

/**
 * Adds the phase 2 extras to shots.mjs. `visit(tag, query, steps, options)` is shots.mjs's own:
 * it opens the sandbox and fails the run on console errors or a thrown error.
 */
export async function weaponExtras(visit, out) {
  // --- the monster's own view: the kit's pictures and the surge ---------------------------------
  await visit(
    'x-weapons-kit',
    { sandbox: '1', role: 'kaiju', cam: 'tp' },
    async (page, shot) => {
      await page.evaluate(quietInPage);
      await page.evaluate(openGroundInPage);
      await sleep(800);
      await page.evaluate(lookInPage, { yaw: await page.evaluate(() => window.__mb.internals.ctx.client.local.world.kaijus[0].yaw), pitch: 0.06 });
      for (const [i, prop] of ['foodsign', 'garagedoor', 'antenna', 'propane'].entries()) {
        await page.evaluate(giveInPage, prop);
        await sleep(1800);
        const kit = await page.evaluate(() => document.querySelector('.kit-strike .hint-icon > .icon')?.getAttribute('data-icon'));
        const want = prop === 'foodsign' ? 'k_club' : prop === 'antenna' ? 'k_javelin' : 'k_throw';
        if (kit !== want) throw new Error(`x-weapons-kit: Strike shows ${kit} with a ${prop}, not ${want}`);
        await shot(`${i + 1}-held-${prop}`);
      }
      // A power surge, as wrecking a substation gives one.
      await page.evaluate(() => {
        window.__mb.internals.ctx.client.local.apply((w) => {
          const k = w.kaijus[0];
          k.held = null;
          k.surge = 8;
          k.rage = Math.min(100, k.rage + 50);
          for (const v of Object.keys(k.cooldowns)) k.cooldowns[v] = 0;
          w.events.push({ type: 'kaijuHeld', tick: w.tick, kaiju: 0, held: null, reason: 'drop', source: 'none', sourceId: -1 });
          w.events.push({ type: 'powerSurge', tick: w.tick, kaiju: 0, structure: -1, x: k.x + 30, z: k.z, duration: 8, cooldownRate: 3, damageMult: 1.5, rage: 50, by: -1 });
        });
      });
      await sleep(1200);
      const surge = await page.evaluate(() => !document.querySelector('.kit-surge')?.classList.contains('hidden'));
      if (!surge) throw new Error('x-weapons-kit: the surge ring is not on the HUD');
      await shot('5-surge');
      await sleep(2500);
      await shot('6-surge-later');
    },
    { noLock: true },
  );

  // --- a squad's view of the hatchling and its city weapons --------------------------------------
  await visit(
    'x-weapons-army',
    { sandbox: '1', role: 'human', cam: 'tp' },
    async (page, shot) => {
    await page.evaluate(quietInPage);
    await page.evaluate(openGroundInPage);
    await sleep(600);
    // (Out of the sign's reach: its swing would knock the squad about.)
    const spot = await page.evaluate(squadViewInPage, { dist: 16, side: 0.75 });
    await sleep(900);
    await page.evaluate(lookInPage, { yaw: spot.yaw, pitch: 0.12 });

    // The sign held up, then swung: the picture is taken in the middle of the swing.
    await page.evaluate(giveInPage, 'foodsign');
    await sleep(1500);
    await shot('1-sign-held');
    const caught = page.evaluate(pauseAtInPage, { action: 'club', phase: 'active', after: 0.07, timeoutMs: 6000 });
    await page.evaluate(kaijuPressInPage, { button: 'strike', aimYaw: null });
    const swing = await caught;
    // (The page draws up to the newest snapshot it has: the swing, held there.)
    await sleep(700);
    if (!swing) throw new Error('x-weapons-army: the club swing never came');
    await shot('2-club-swing');
    await page.evaluate(pauseInPage, false);
    await sleep(1500);

    // The door held up in front; the squad opens fire on it: sparks, then it breaks.
    await page.evaluate(giveInPage, 'garagedoor');
    await sleep(1500);
    await shot('3-door-held');
    const before = await page.evaluate(countInPage, 'shieldHit');
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      for (const id of w.squads[me.squadId].units) {
        const u = w.units[id];
        u.cooldown = 0;
        u.shaken = 0;
        u.stun = 0;
        u.nerve = 0;
      }
      // Square on to the squad, so its shots come at the door.
      const lead = w.units[w.squads[me.squadId].driven];
      k.yaw = Math.atan2(lead.x - k.x, lead.z - k.z);
      k.aimYaw = k.yaw;
    });
    // The leader's own rockets, straight at the door (the left button; the squad-mates join in).
    const view = page.viewportSize() ?? { width: 960, height: 540 };
    await page.evaluate(lookInPage, { yaw: spot.yaw, pitch: 0.08 });
    await sleep(500);
    await page.mouse.move(view.width / 2, view.height / 2);
    await page.mouse.down({ button: 'left' });
    const hit = await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.shieldHit ?? 0) > n ? true : null), before, 15000, 30);
    await page.mouse.up({ button: 'left' });
    await page.evaluate(pauseInPage, true);
    await sleep(300);
    if (!hit) throw new Error('x-weapons-army: no shot hit the door');
    await shot('4-door-hit');
    await page.evaluate(pauseInPage, false);
    await record(page, 960, 24);
    await page.evaluate(() => {
      window.__mb.internals.ctx.client.local.world.kaijus[0].shieldHp = 4;
    });
    const broken = await until(page, () => ((window.__mb.internals.ctx.runtime.eventCounts.shieldBroken ?? 0) > 0 ? true : null), null, 15000, 60);
    await sleep(1500);
    await saveFrames(page, out, 'x-weapons-army-5-door-breaks');
    if (!broken) throw new Error('x-weapons-army: the door never broke');
    await page.evaluate(quietInPage);
    await sleep(800);

    // A javelin thrown across the view: in flight, then stuck where it stopped.
    await page.evaluate(giveInPage, 'antenna');
    await sleep(1200);
    const yaw = await page.evaluate(() => window.__mb.internals.ctx.client.local.world.kaijus[0].aimYaw);
    const spawned = await page.evaluate(countInPage, 'projectileSpawn');
    // Across the view and down at the street in front of the squad, where it sticks.
    await page.evaluate(kaijuPressInPage, { button: 'strike', aimYaw: yaw + 0.5, aimPitch: -0.22 });
    const flying = await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.projectileSpawn ?? 0) > n ? true : null), spawned, 6000, 10);
    await page.evaluate(pauseInPage, true);
    await sleep(400);
    if (!flying) throw new Error('x-weapons-army: the javelin was never thrown');
    await shot('6-javelin-flight');
    await page.evaluate(pauseInPage, false);
    await sleep(2500);
    await shot('7-javelin-stuck');

    // A water tank thrown at the squad: the splash and the squad knocked flat (the picture is
    // late on a slow page, so the knock-down is drawn a while longer for it).
    await page.evaluate(giveInPage, 'watertank');
    await sleep(1200);
    await record(page, 960, 24);
    const splashes = await page.evaluate(countInPage, 'waterSplash');
    // At the squad's leader (whichever unit that is now): down from the eye (4.2 m up) onto the
    // street where it stands.
    const at = await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const u = w.units[w.squads[me.squadId].driven];
      const d = Math.hypot(u.x - k.x, u.z - k.z);
      return { yaw: Math.atan2(u.x - k.x, u.z - k.z), pitch: -Math.atan2(4.2, Math.max(1, d)) };
    });
    await page.evaluate(kaijuPressInPage, { button: 'strike', aimYaw: at.yaw, aimPitch: at.pitch });
    const splash = await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.waterSplash ?? 0) > n ? true : null), splashes, 8000, 20);
    await page.evaluate(() => {
      const r = window.__mb.internals.ctx.renderer;
      const w = window.__mb.internals.ctx.client.local.world;
      for (const u of w.units) if (u.stun > 0) r.units.knockDown(u.id, 6);
    });
    await sleep(1800);
    await saveFrames(page, out, 'x-weapons-army-8-splash');
    if (!splash) throw new Error('x-weapons-army: no water splash');
    await shot('9-knocked-flat');

    // A propane tank thrown: the blast.
    await page.evaluate(giveInPage, 'propane');
    await sleep(1200);
    await record(page, 960, 24);
    const blasts = await page.evaluate(countInPage, 'propaneBlast');
    await page.evaluate(kaijuPressInPage, { button: 'strike', aimYaw: yaw - 0.45, aimPitch: -0.2 });
    const blast = await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.propaneBlast ?? 0) > n ? true : null), blasts, 8000, 20);
    await sleep(2000);
    await saveFrames(page, out, 'x-weapons-army-10-propane');
    if (!blast) throw new Error('x-weapons-army: the propane tank never went off');
    },
    { noLock: true },
  );

  // --- the army's pick-ups -----------------------------------------------------------------------
  await visit(
    'x-pickups',
    { sandbox: '1', role: 'human', cam: 'tp' },
    async (page, shot) => {
    const view = page.viewportSize() ?? { width: 960, height: 540 };
    await page.evaluate(quietInPage);
    await page.evaluate(openGroundInPage);
    await sleep(600);
    // The squad 70 m from the kaiju, looking at it: crates go down between them.
    const spot = await page.evaluate(squadViewInPage, { dist: 70, side: 0.3 });
    await sleep(900);
    await page.evaluate(lookInPage, { yaw: spot.yaw, pitch: 0.3 });
    const lay = (kind, ahead, side, fall) =>
      page.evaluate(
        ({ kind, ahead, side, fall, yaw }) => {
          let out = null;
          window.__mb.internals.ctx.client.local.apply((w) => {
            const me = w.players.find((p) => !p.bot && p.role === 'human');
            const u = w.units[w.squads[me.squadId].driven];
            const x = u.x + Math.sin(yaw) * ahead + Math.cos(yaw) * side;
            const z = u.z + Math.cos(yaw) * ahead - Math.sin(yaw) * side;
            const id = w.nextCrateId++;
            w.crates.push({ id, kind, x, z, fall });
            if (fall > 0) w.events.push({ type: 'crate', tick: w.tick, id, kind, x, z, phase: 'drop', squad: me.squadId, unit: -1, player: -1, duration: fall, height: 90 });
            out = { id, x, z };
          });
          return out;
        },
        { kind, ahead, side, fall, yaw: spot.yaw },
      );

    // A crate coming down under its parachute, caught half way.
    await lay('missilePod', 70, -8, 4);
    await sleep(1700);
    await page.evaluate(pauseInPage, true);
    await sleep(400);
    await shot('1-crate-coming-down');
    await page.evaluate(pauseInPage, false);
    // Down: its beacon and the picture of what it holds; two more lie further off.
    await lay('artilleryRadio', 26, 7, 0);
    await lay('reinforcements', 38, -9, 0);
    await page.evaluate(lookInPage, { yaw: spot.yaw, pitch: 0.02 });
    await sleep(3500);
    await shot('2-crates-landed');
    // The map shows them; then a radio mast's static wipes it.
    await page.keyboard.press('KeyM');
    await sleep(1500);
    await shot('3-map-crates');
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      w.match.staticUntil = w.tick + 900;
    });
    await sleep(1500);
    const statik = await page.evaluate(() => window.__mb.internals.ctx.runtime && document.querySelector('.map:not(.hidden)') !== null);
    await shot('4-map-static');
    await page.evaluate(() => {
      window.__mb.internals.ctx.client.local.world.match.staticUntil = 0;
    });
    await page.keyboard.press('KeyM');
    await sleep(800);
    if (!statik) throw new Error('x-pickups: the map was not open');

    // Taken: the leader is put on the nearest crate (the scripted playtest drives onto them).
    const takes = await page.evaluate(countInPage, 'crate');
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const u = w.units[w.squads[me.squadId].driven];
      const c = w.crates.filter((c) => c.fall <= 0).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
      if (c) {
        u.x = c.x;
        u.z = c.z;
      }
    });
    await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.crate ?? 0) > n ? true : null), takes, 6000, 20);
    await sleep(250);
    await shot('5-crate-taken');

    // The pick-up weapons, fired at the kaiju: each caught in flight.
    const fire = async (pickup, name, freezeAfter) => {
      await page.evaluate((pickup) => {
        const w = window.__mb.internals.ctx.client.local.world;
        const me = w.players.find((p) => !p.bot && p.role === 'human');
        const squad = w.squads[me.squadId];
        squad.pickup = pickup;
        w.units[squad.driven].cooldown = 0;
      }, pickup);
      const s = await page.evaluate(squadViewInPage, { dist: 55, side: 0.9 });
      await sleep(900);
      await page.evaluate(lookInPage, { yaw: s.yaw, pitch: 0.05 });
      await page.evaluate(() => {
        const w = window.__mb.internals.ctx.client.local.world;
        const me = w.players.find((p) => !p.bot && p.role === 'human');
        w.units[w.squads[me.squadId].driven].cooldown = 0;
      });
      await sleep(600);
      const n0 = await page.evaluate(countInPage, 'projectileSpawn');
      await page.mouse.move(view.width / 2, view.height / 2);
      await page.mouse.down({ button: 'left' });
      await sleep(pickup === 'machineGun' ? 1200 : 150);
      await page.mouse.up({ button: 'left' });
      const shotOk = await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.projectileSpawn ?? 0) > n ? true : null), n0, 5000, 10);
      await sleep(freezeAfter);
      await page.evaluate(pauseInPage, true);
      await sleep(400);
      if (!shotOk) throw new Error(`x-pickups: the ${pickup} did not fire`);
      await shot(name);
      await page.evaluate(pauseInPage, false);
      await sleep(1200);
    };
    await fire('machineGun', '6-machine-gun', 60);
    await fire('bigCannon', '7-big-cannon', 120);
    await fire('missilePod', '8-missile-salvo', 120);

    // The artillery radio: a barrage called onto the kaiju.
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const squad = w.squads[me.squadId];
      squad.pickup = 'none';
      squad.barrages = 3;
    });
    const s = await page.evaluate(squadViewInPage, { dist: 90, side: 0.4 });
    await sleep(900);
    await page.evaluate(lookInPage, { yaw: s.yaw, pitch: 0.1 });
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      for (const u of w.units) u.cooldown = 0;
    });
    await sleep(500);
    const m0 = await page.evaluate(countInPage, 'callin');
    await page.mouse.move(view.width / 2, view.height / 2);
    await page.mouse.down({ button: 'right' });
    await until(page, () => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      return w.squads[me.squadId].units.some((id) => w.units[id].rooted && w.units[id].charge > 0.97) ? true : null;
    }, null, 10000, 100);
    await page.mouse.up({ button: 'right' });
    const marked = await until(page, (n) => ((window.__mb.internals.ctx.runtime.eventCounts.callin ?? 0) > n ? true : null), m0, 5000, 20);
    if (!marked) throw new Error('x-pickups: the radio volley called no barrage');
    await sleep(1500);
    await shot('9-artillery-marked');
    // The shells coming down: caught in the air.
    const a0 = await page.evaluate(countInPage, 'projectileSpawn');
    await until(page, () => window.__mb.internals.ctx.runtime.frame && window.__mb.renderer.info().projectiles >= 3 ? true : null, a0, 8000, 20);
    await page.evaluate(pauseInPage, true);
    await sleep(400);
    await shot('10-artillery-falling');
    await page.evaluate(pauseInPage, false);
    await record(page, 960, 30);
    await sleep(4000);
    await saveFrames(page, out, 'x-pickups-11-artillery-impacts');
    await shot('12-artillery-after');

    // Reinforcements: two squad-mates lost, then a crate of reinforcements taken.
    await page.evaluate(quietInPage);
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const squad = w.squads[me.squadId];
      for (const id of squad.units) {
        const u = w.units[id];
        if (id === squad.driven || !u.alive) continue;
        u.alive = false;
        u.hp = 0;
        u.members = 0;
      }
    });
    const r = await page.evaluate(squadViewInPage, { dist: 60, side: 0.3 });
    await sleep(900);
    await page.evaluate(lookInPage, { yaw: r.yaw, pitch: 0.1 });
    const c = await lay('reinforcements', 0.5, 0, 0);
    if (!c) throw new Error('x-pickups: no crate laid for the reinforcements');
    const rf = await until(page, () => ((window.__mb.internals.ctx.runtime.eventCounts.reinforce ?? 0) > 0 ? true : null), null, 6000, 20);
    if (!rf) throw new Error('x-pickups: no reinforcements came');
    // Half way down: the view turned up at the squad-mates coming down.
    await sleep(1600);
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const squad = w.squads[me.squadId];
      const lead = w.units[squad.driven];
      const falling = squad.units.map((id) => w.units[id]).filter((u) => u.alive && u.y > 1);
      if (falling.length === 0) return;
      const x = falling.reduce((a, u) => a + u.x, 0) / falling.length;
      const z = falling.reduce((a, u) => a + u.z, 0) / falling.length;
      const y = falling.reduce((a, u) => a + u.y, 0) / falling.length;
      const c = window.__mb.internals.ctx.runtime.controller;
      c.viewYaw = Math.atan2(x - lead.x, z - lead.z) + 0.25;
      c.viewPitch = Math.min(1.2, Math.atan2(y, Math.max(4, Math.hypot(x - lead.x, z - lead.z) + 9)));
    });
    await sleep(700);
    await page.evaluate(pauseInPage, true);
    await sleep(400);
    await shot('13-reinforcements');
    await page.evaluate(pauseInPage, false);
    },
    { noLock: true },
  );
}

