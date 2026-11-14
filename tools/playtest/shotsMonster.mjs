/**
 * shots.mjs extras for phase 3's monster looks (docs/ROADMAP.md, "looks and sound"): every look
 * of every attack as a short run of frames at every stage, in third person and a few in first
 * person, with the slash trails; the stripes glowing at low rage, at full rage, pulsing with the
 * beam ready and taken over by a power surge; and, played with real buttons, swipes whose looks
 * every screen agrees on, a stomp and a footstep squashing civilians and a grab coming up with a
 * handful and gulping it down. Run alone with `node tools/playtest/shots.mjs --only x-monster`.
 *
 *   x-monster-looks-s1, -s2, -s3   the pose bench: the simulation is held still and the page is
 *                                  shown the kaiju at chosen moments of an attack, with the look
 *                                  picked by the tick the attack began (as every screen picks
 *                                  it), from a camera placed beside it; and the stripes
 *   x-monster-play                 real presses in the sandbox (the evidence is what the page
 *                                  drew and what the sandbox's simulation sent)
 *
 * Frames are the 3D view only (`__mb.helpers.screenshot`), saved as `<tag>-<name>.png`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TICK_RATE = 30;

/** The attack-look hash: a copy of `attackVariant` in client/src/render/kaijuAnimator.ts (keep them alike). */
const VARIANTS = { swipe: 3, stomp: 3, tailSweep: 2, throw: 2, roar: 2, charge: 3, club: 3 };
export function attackVariant(action, tick, kaiju = 0) {
  const n = VARIANTS[action] ?? 1;
  if (n <= 1) return 0;
  let h = Math.imul((tick | 0) ^ 0x2545f491, 0x9e3779b1) ^ Math.imul((kaiju | 0) + 1, 0x85ebca6b) ^ (action.length * 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) % n;
}

/** The attacks' timings (DESIGN.md section 4: wind-up, active, recovery; the phase names). */
const TIMING = {
  swipe: { windup: 0.45, active: 0.15, recover: 0.5, activePhase: 'active' },
  stomp: { windup: 0.9, active: 0.1, recover: 0.9, activePhase: 'active' },
  tailSweep: { windup: 0.35, active: 0.15, recover: 0.45, activePhase: 'active' },
  throw: { windup: 0.3, active: 0, recover: 0.2, activePhase: 'active' },
  roar: { windup: 0, active: 1.2, recover: 0, activePhase: 'roar' },
  club: { windup: 0.5, active: 0.15, recover: 0.55, activePhase: 'active' },
  charge: { windup: 0.8, active: 3.0, recover: 1.2, activePhase: 'charge' },
};
/** Ticks a phase lasts in the simulation (it ends on the tick its time reaches its length). */
const ticks = (s) => (s > 0 ? Math.ceil(s * TICK_RATE - 1e-6) : 0);

/** The moments of each attack the bench shows: [phase, fraction of it]. */
const MOMENTS = {
  swipe: [['windup', 0.6], ['windup', 1], ['active', 0.5], ['active', 1], ['recover', 0.3]],
  stomp: [['windup', 0.55], ['windup', 1], ['active', 1], ['recover', 0.35]],
  tailSweep: [['windup', 1], ['active', 0.55], ['active', 1], ['recover', 0.3]],
  throw: [['windup', 0.6], ['windup', 1], ['recover', 0.05], ['recover', 0.8]],
  roar: [['roar', 0.15], ['roar', 0.45], ['roar', 0.8]],
  charge: [['stumble', 0.12], ['stumble', 0.3], ['stumble', 0.65]],
  club: [['windup', 1], ['active', 0.5], ['active', 1], ['recover', 0.3]],
};

/** A start tick (well apart from the others) whose look for `action` is `look`. */
function startFor(action, look, from) {
  for (let t = from; ; t++) if (attackVariant(action, t, 0) === look) return t;
}

/**
 * The frame's tick and the kaiju's phase for a moment of an attack begun at `start` (for the
 * charge, `start` is when its stumble began).
 */
function momentOf(action, start, phase, f) {
  const t = TIMING[action];
  if (phase === 'stumble') return { tick: start + f * t.recover * TICK_RATE, phase, phaseTime: f * t.recover, phaseDuration: t.recover };
  const len = phase === 'windup' ? t.windup : phase === 'recover' ? t.recover : t.active;
  const earlier = phase === 'windup' ? 0 : phase === 'recover' ? ticks(t.windup) + ticks(t.active) : ticks(t.windup);
  // (A moment exactly on a phase's start would read as not known yet: a hair into it.)
  const time = Math.max(0.004, f * len);
  return { tick: start + earlier + time * TICK_RATE, phase, phaseTime: time, phaseDuration: len };
}

export async function monsterExtras(visit, out) {
  const world = 'window.__mb.internals.ctx.client.local.world';
  /** Saves the 3D view as it is drawn on the next frame. */
  const frame = async (page, name) => {
    const d = await page.evaluate(() => window.__mb.helpers.screenshot());
    if (d) writeFileSync(join(out, `${name}.png`), Buffer.from(d.split(',')[1], 'base64'));
  };
  /** Waits for the page to draw `n` more frames (the rig eases into a new pose over a few). */
  const frames = (page, n) =>
    page.evaluate(async (n) => {
      for (let i = 0; i < n; i++) await window.__mb.helpers.screenshot();
    }, n);

  /**
   * The pose bench: the simulation held still, the bots quiet, and every frame the page draws
   * shows the kaiju as `window.__pose` says (its fields and the frame's tick).
   */
  const bench = async (page) => {
    // The squads far away with their charges dropped (no volley's lasers across the picture),
    // and a moment for a snapshot to say so before the simulation is held still.
    await page.evaluate((w) => {
      const wd = eval(w);
      wd.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
      const k = wd.kaijus[0];
      k.vx = 0;
      k.vz = 0;
      for (const u of wd.units) {
        u.x = k.x + 900;
        u.z = k.z + 900;
        u.charge = 0;
        u.rooted = false;
      }
    }, world);
    await sleep(800);
    return page.evaluate((w) => {
      const ctx = window.__mb.internals.ctx;
      const wd = eval(w);
      const k = wd.kaijus[0];
      for (const u of wd.units) u.charge = 0;
      ctx.client.local.pause(true);
      const r = ctx.renderer;
      const update = r.update.bind(r);
      window.__pose = null;
      r.update = (f, dt, view) => {
        if (f && window.__pose) {
          Object.assign(f.kaijus[0], window.__pose.kaiju);
          f.tick = window.__pose.tick;
        }
        return update(f, dt, view);
      };
      const c = ctx.runtime.controller;
      window.__ownCamera = c.applyCamera.bind(c);
      return { x: k.x, z: k.z, yaw: k.yaw };
    }, world);
  };
  /** The camera beside the kaiju: `side` radians round from its front, `far` and `up` in body heights. */
  const beside = (page, at, height, side, far = 2.3, up = 0.7) =>
    page.evaluate(
      ({ at, height, side, far, up }) => {
        const c = window.__mb.internals.ctx.runtime.controller;
        c.thirdPerson = true;
        const a = at.yaw + side;
        c.applyCamera = (ctx, cam) => {
          cam.position.set(at.x + Math.sin(a) * height * far, height * up, at.z + Math.cos(a) * height * far);
          cam.up.set(0, 1, 0);
          cam.lookAt(at.x, height * 0.5, at.z);
          if (cam.fov !== 50) {
            cam.fov = 50;
            cam.updateProjectionMatrix();
          }
        };
      },
      { at, height, side, far, up },
    );
  /** The kaiju's own first-person camera (the head locked to the aim, the claws riding on it). */
  const firstPerson = (page, pitch = -0.12) =>
    page.evaluate((pitch) => {
      const c = window.__mb.internals.ctx.runtime.controller;
      c.applyCamera = window.__ownCamera;
      c.thirdPerson = false;
      c.aimPitch = pitch;
    }, pitch);
  const pose = (page, kaiju, tick) => page.evaluate(({ kaiju, tick }) => (window.__pose = { kaiju, tick }), { kaiju, tick });
  /** The look the page drew on its last frame. */
  const drawnLook = (page) => page.evaluate(() => window.__mb.internals.ctx.renderer.kaijuViews[0]?.attackLook ?? null);

  /** One attack's looks as runs of frames; returns the looks the page says it drew. */
  const attack = async (page, tag, at, height, action, looks, extra = {}, sides = [0.75], fp = []) => {
    const seen = [];
    let from = 40000 + Object.keys(TIMING).indexOf(action) * 5000;
    for (const look of looks) {
      const start = startFor(action, look, from);
      from = start + 400;
      for (const side of sides) {
        await beside(page, at, height, side);
        let i = 0;
        for (const [phase, f] of MOMENTS[action]) {
          const m = momentOf(action, start, phase, f);
          await pose(page, { action, phase: m.phase, phaseTime: m.phaseTime, phaseDuration: m.phaseDuration, vx: 0, vz: 0, yaw: at.yaw, aimYaw: at.yaw, aimPitch: -0.1, ...extra }, m.tick);
          await frames(page, 2);
          // A stomp's landing: the renderer is handed the event the simulation would send (the
          // shock ring at the landing foot).
          if (action === 'stomp' && phase === 'active') {
            await page.evaluate(({ at, tick }) => window.__mb.internals.ctx.renderer.handleEvent({ type: 'kaijuAction', tick: Math.floor(tick), kaiju: 0, action: 'stomp', phase: 'active', duration: 0.1, x: at.x, z: at.z, yaw: at.yaw }), { at, tick: m.tick });
          }
          await frames(page, 1);
          seen.push(await drawnLook(page));
          await frame(page, `${tag}-${action}-${look}${sides.length > 1 ? `-side${sides.indexOf(side)}` : ''}-${i++}-${phase}${Math.round(f * 100)}`);
        }
      }
      for (const [phase, f] of fp) {
        await firstPerson(page);
        const m = momentOf(action, start, phase, f);
        await pose(page, { action, phase: m.phase, phaseTime: m.phaseTime, phaseDuration: m.phaseDuration, vx: 0, vz: 0, yaw: at.yaw, aimYaw: at.yaw, aimPitch: -0.12, ...extra }, m.tick);
        await frames(page, 3);
        seen.push(await drawnLook(page));
        await frame(page, `${tag}-${action}-${look}-fp-${phase}${Math.round(f * 100)}`);
      }
    }
    return seen;
  };

  /** The stripes at a rage and with the beam picked or not, a surge or not, seen from beside. */
  const stripes = async (page, tag, at, height, name, kaiju, side = 0.9) => {
    await beside(page, at, height, side, 2.0, 0.6);
    await pose(page, { action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, vx: 0, vz: 0, yaw: at.yaw, aimYaw: at.yaw, aimPitch: 0, ...kaiju }, 1000);
    await frames(page, 4);
    await frame(page, `${tag}-stripes-${name}`);
  };

  for (const stage of [1, 2, 3]) {
    const tag = `x-monster-looks-s${stage}`;
    await visit(tag, { sandbox: String(stage), role: 'kaiju', mute: '1' }, async (page) => {
      await sleep(2500);
      const at = await bench(page);
      const height = { 1: 4.5, 2: 32, 3: 115 }[stage];
      const looks = {};
      looks.swipe = await attack(page, tag, at, height, 'swipe', [0, 1, 2], {}, [0.75], stage === 2 ? [] : [['active', 0.6], ['active', 1]]);
      looks.stomp = await attack(page, tag, at, height, 'stomp', [0, 1, 2]);
      looks.tailSweep = await attack(page, tag, at, height, 'tailSweep', [0, 1], {}, [Math.PI - 0.7]);
      looks.roar = await attack(page, tag, at, height, 'roar', [0, 1]);
      looks.charge = await attack(page, tag, at, height, 'charge', [0, 1, 2], { moves: ['charge', 'none'] }, [1.1]);
      if (stage < 3) looks.throw = await attack(page, tag, at, height, 'throw', [0, 1], { held: { kind: 'wreck', wreck: 'car' } }, [-0.75], stage === 1 ? [['recover', 0.05]] : []);
      if (stage === 1) looks.club = await attack(page, tag, at, height, 'club', [0, 1, 2], { held: { kind: 'prop', prop: 'foodsign' }, clubSwings: 3 }, [-0.45], [['active', 0.6]]);
      // The stripes: no rage, half, full (the beam not picked), the beam ready (its slow pulse,
      // two moments of it), a power surge.
      await stripes(page, tag, at, height, '1-rage-0', { rage: 0, moves: ['none', 'none'], surge: 0 });
      await stripes(page, tag, at, height, '2-rage-50', { rage: 50, moves: ['none', 'none'], surge: 0 });
      await stripes(page, tag, at, height, '3-rage-100', { rage: 100, moves: ['none', 'none'], surge: 0 });
      await stripes(page, tag, at, height, '4-beam-ready-a', { rage: 100, moves: ['beam', 'none'], surge: 0 });
      await sleep(1300);
      await stripes(page, tag, at, height, '5-beam-ready-b', { rage: 100, moves: ['beam', 'none'], surge: 0 });
      await stripes(page, tag, at, height, '6-surge', { rage: 60, moves: ['none', 'none'], surge: 6 });
      // Every frame must have drawn the look it was set up for (or the first look, for an
      // action with one): the page picks the look from the tick, as every screen does.
      const wrong = [];
      for (const [action, seen] of Object.entries(looks)) {
        const want = [];
        for (const look of action === 'tailSweep' || action === 'roar' || action === 'throw' ? [0, 1] : [0, 1, 2]) {
          const n = seen.length / (action === 'tailSweep' || action === 'roar' || action === 'throw' ? 2 : 3);
          for (let i = 0; i < n; i++) want.push(look);
        }
        if (seen.join() !== want.join()) wrong.push(`${action}: drew ${seen.join(',')} for ${want.join(',')}`);
      }
      console.log(`shots: ${tag}: looks drawn as set up: ${wrong.length === 0 ? 'all' : wrong.join('; ')}`);
      if (wrong.length > 0) throw new Error(`${tag}: looks drawn wrong: ${wrong.join('; ')}`);
    }, { noLock: true });
  }

  // Played with real buttons in the sandbox: swipes (each look the page drew must be the look of
  // the tick the simulation began it on), a crowd squashed by a stomp and under its feet, and a
  // grab into a crowd coming up with a handful that is gulped down.
  await visit('x-monster-play', { sandbox: '1', role: 'kaiju', mute: '1' }, async (page) => {
    await sleep(2500);
    // The bot squads stand still far away; the kaiju's own events are recorded with their ticks.
    await page.evaluate((w) => {
      const wd = eval(w);
      wd.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
      const k = wd.kaijus[0];
      for (const u of wd.units) {
        u.x = k.x + 900;
        u.z = k.z + 900;
      }
      const rt = window.__mb.internals.ctx.runtime;
      const original = rt.handleEvent.bind(rt);
      window.__starts = [];
      window.__drawn = [];
      rt.handleEvent = (e) => {
        if (e.type === 'kaijuAction' && e.action === 'swipe' && e.phase === 'windup') window.__starts.push(e.tick);
        original(e);
      };
      // The look the page draws in every swipe's strike.
      const r = window.__mb.internals.ctx.renderer;
      const update = r.update.bind(r);
      r.update = (f, dt, view) => {
        const out = update(f, dt, view);
        const k = f?.kaijus[0];
        if (k && k.action === 'swipe' && k.phase === 'active') window.__drawn.push(r.kaijuViews[0].attackLook);
        return out;
      };
    }, world);
    const c = { x: 480, y: 270 };
    await page.mouse.move(c.x, c.y);
    for (let i = 0; i < 7; i++) {
      await page.mouse.down({ button: 'left' });
      await sleep(120);
      await page.mouse.up({ button: 'left' });
      // A strike, on the third and fifth swipes: the simulation is held still the moment its
      // strike begins (a page drawn in software shows a few frames a second, and the strike lasts
      // 0.15 s), and the page draws it as it is then, from the player's own camera and from beside.
      if (i === 2 || i === 4) {
        const held = await page.waitForFunction(() => {
          const local = window.__mb.internals.ctx.client.local;
          const k = local.world.kaijus[0];
          if (k.action === 'swipe' && k.phase === 'active' && k.phaseTime > 0.06) {
            local.pause(true);
            return true;
          }
          return false;
        }, null, { timeout: 5000, polling: 5 }).catch(() => null);
        if (held) {
          await frames(page, 3);
          await frame(page, `x-monster-play-1-swipe-${i}-own-camera`);
          const at = await page.evaluate((w) => {
            const k = eval(w).kaijus[0];
            return { x: k.x, z: k.z, yaw: k.yaw };
          }, world);
          await beside(page, at, 4.5, 0.6);
          await frames(page, 2);
          await frame(page, `x-monster-play-1-swipe-${i}-beside`);
          await page.evaluate(() => {
            const ctx = window.__mb.internals.ctx;
            const c = ctx.runtime.controller;
            // (Back to its own camera: `beside` put one on the controller itself.)
            delete c.applyCamera;
            ctx.client.local.pause(false);
          });
        }
      }
      await page.waitForFunction(() => window.__mb.internals.ctx.runtime.frame?.localKaiju?.phase === 'idle', null, { timeout: 8000 }).catch(() => null);
      await sleep(250);
    }
    const { starts, drawn } = await page.evaluate(() => ({ starts: window.__starts.slice(), drawn: window.__drawn.slice() }));
    const want = starts.map((t) => attackVariant('swipe', t, 0));
    const distinct = [...new Set(want)];
    const bad = drawn.filter((l) => !want.includes(l));
    console.log(`shots: x-monster-play: ${starts.length} swipes began on ticks ${starts.join(', ')}: looks ${want.join(', ')} (${distinct.length} kinds); the page drew ${[...new Set(drawn)].join(', ')} in their strikes`);
    if (starts.length < 3) throw new Error(`x-monster-play: only ${starts.length} swipes began`);
    if (bad.length > 0) throw new Error(`x-monster-play: the page drew looks ${bad.join(',')} that no swipe began with (${want.join(',')})`);

    // Somewhere with nothing the hand could take in reach (cars, kiosks, wrecks, the city's
    // weapons): where it stands if that is clear (it hatches in a park), else the nearest street
    // middle that is, the view turned along the street.
    const spot = await page.evaluate((w) => {
      const wd = eval(w);
      const k = wd.kaijus[0];
      const b = wd.match.bounds;
      const takeable = new Set(['car_sedan', 'car_taxi', 'car_van', 'bus', 'truck', 'kiosk', 'propane', 'watertank', 'antenna', 'foodsign', 'garagedoor', 'mast']);
      const bit = (bits, i) => (bits[i >> 3] & (1 << (i & 7))) !== 0;
      const clear = (x, z) =>
        !wd.city.props.some((p) => Math.hypot(p.x - x, p.z - z) < 16 && ((bit(wd.propAlive, p.id) && takeable.has(p.kind)) || bit(wd.propWreck, p.id))) &&
        !wd.loose.some((l) => Math.hypot(l.x - x, l.z - z) < 16) &&
        !wd.units.some((u) => !u.alive && u.wreck && Math.hypot(u.x - x, u.z - z) < 16);
      if (clear(k.x, k.z)) return { x: k.x, z: k.z, d: 0 };
      let best = null;
      for (const e of wd.city.roads.edges) {
        const a = wd.city.roads.nodes[e.a];
        const c = wd.city.roads.nodes[e.b];
        const x = (a.x + c.x) / 2;
        const z = (a.z + c.z) / 2;
        if (x < b.minX + 30 || x > b.maxX - 30 || z < b.minZ + 30 || z > b.maxZ - 30) continue;
        const d = Math.hypot(x - k.x, z - k.z);
        if ((best && d >= best.d) || !clear(x, z)) continue;
        best = { x, z, d, yaw: Math.atan2(c.x - a.x, c.z - a.z) };
      }
      if (!best) return null;
      k.x = best.x;
      k.z = best.z;
      k.vx = 0;
      k.vz = 0;
      k.yaw = best.yaw;
      k.aimYaw = best.yaw;
      window.__mb.internals.ctx.runtime.controller.aimYaw = best.yaw;
      return best;
    }, world);
    console.log(`shots: x-monster-play: nothing the hand could take in reach ${spot ? `${spot.d.toFixed(0)} m from where it stood` : 'anywhere near: NOT FOUND'}`);
    if (!spot) throw new Error('x-monster-play: no spot without anything to grab for the crowd');
    await sleep(1500);

    // Civilians put down round the hatchling (the crowd is the page's own: nothing in the
    // simulation knows of them), standing frozen in fright for a few seconds.
    const crowdAt = (spots) =>
      page.evaluate(
        ({ w, spots }) => {
          const k = eval(w).kaijus[0];
          const crowd = window.__mb.internals.ctx.renderer.crowd;
          const proto = crowd.people[0];
          if (!proto) return 0;
          const c = Math.cos(k.yaw);
          const s = Math.sin(k.yaw);
          // (ahead, to the left) in the body's frame, to the world.
          for (const [ahead, left] of spots) crowd.people.push({ ...proto, x: k.x + s * ahead + c * left, z: k.z + c * ahead - s * left, panic: 0, frozen: 4, dirX: 0, dirZ: 1 });
          return spots.length;
        },
        { w: world, spots },
      );
    const tally = () => page.evaluate(() => ({ ...window.__mb.renderer.info() }));
    const here = () =>
      page.evaluate((w) => {
        const k = eval(w).kaijus[0];
        return { x: k.x, z: k.z, yaw: k.yaw };
      }, world);

    // A walk through a crowd: each footstep squashes those under the foot, each in a puff.
    const beforeWalk = await tally();
    const lane = [];
    for (let d = 3; d <= 11; d += 1.6) lane.push([d, 1.1], [d + 0.8, -1.1]);
    await crowdAt(lane);
    await beside(page, await here(), 4.5, 0.95, 2.4, 0.55);
    await frames(page, 2);
    await frame(page, 'x-monster-play-2-crowd-ahead');
    await page.keyboard.down('KeyW');
    for (let j = 0; j < 4; j++) await frame(page, `x-monster-play-3-walk-${j}`);
    await sleep(600);
    await page.keyboard.up('KeyW');
    await sleep(800);
    const afterWalk = await tally();
    console.log(`shots: x-monster-play: walking through ${lane.length} civilians, its footsteps squashed ${afterWalk.squashed - beforeWalk.squashed}`);
    if (afterWalk.squashed <= beforeWalk.squashed) throw new Error('x-monster-play: no footstep squashed anybody');

    // A stomp in a crowd: everyone in its shockwave.
    const ring = [];
    for (let i = 0; i < 10; i++) ring.push([Math.cos(i * 0.63) * (3 + (i % 3) * 1.6), Math.sin(i * 0.63) * (3 + (i % 3) * 1.6)]);
    await crowdAt(ring);
    const beforeStomp = await tally();
    await beside(page, await here(), 4.5, 0.9, 2.2, 0.6);
    await frames(page, 2);
    await page.keyboard.down('Space');
    await sleep(120);
    await page.keyboard.up('Space');
    await page.waitForFunction(() => window.__mb.internals.ctx.runtime.frame?.localKaiju?.action === 'stomp' && window.__mb.internals.ctx.runtime.frame.localKaiju.phase !== 'windup', null, { timeout: 6000 }).catch(() => null);
    for (let j = 0; j < 3; j++) await frame(page, `x-monster-play-4-stomp-${j}`);
    const afterStomp = await tally();
    console.log(`shots: x-monster-play: a stomp squashed ${afterStomp.squashed - beforeStomp.squashed} civilians`);
    if (afterStomp.squashed <= beforeStomp.squashed) throw new Error('x-monster-play: the stomp squashed nobody');
    await page.waitForFunction(() => window.__mb.internals.ctx.runtime.frame?.localKaiju?.phase === 'idle', null, { timeout: 8000 }).catch(() => null);

    // A grab into a crowd where nothing else is in reach: the hand comes up with a handful,
    // lifts them to the mouth and gulps them down (seen from the front, on the side of the hand).
    const beforeGrab = await tally();
    await crowdAt([[3, 0.6], [3.6, -0.4], [4.2, 0.2], [3.2, 1.4], [4.6, -1.2], [5, 0.9]]);
    await beside(page, await here(), 4.5, -0.75, 1.7, 0.62);
    await frames(page, 2);
    await page.mouse.down({ button: 'right' });
    await sleep(120);
    await page.mouse.up({ button: 'right' });
    const lifted = await page.waitForFunction(() => window.__mb.internals.ctx.renderer.crowd.handfuls.length > 0, null, { timeout: 6000, polling: 10 }).catch(() => null);
    for (let j = 0; j < 5; j++) await frame(page, `x-monster-play-5-handful-${j}`);
    await sleep(1600);
    const afterGrab = await tally();
    console.log(`shots: x-monster-play: the grab came up with a handful: ${lifted ? 'yes' : 'NO'}; eaten ${afterGrab.eaten - beforeGrab.eaten}`);
    if (!lifted || afterGrab.eaten <= beforeGrab.eaten) throw new Error('x-monster-play: the grab did not come up with a handful that was eaten');

    // And the same seen from inside its head.
    await page.evaluate(() => {
      const c = window.__mb.internals.ctx.runtime.controller;
      delete c.applyCamera;
      c.thirdPerson = false;
      c.aimPitch = -0.25;
    });
    await crowdAt([[3, 0.6], [3.6, -0.4], [4.2, 0.2], [3.2, 1.4], [4.6, -1.2]]);
    await sleep(500);
    await page.mouse.down({ button: 'right' });
    await sleep(120);
    await page.mouse.up({ button: 'right' });
    await page.waitForFunction(() => window.__mb.internals.ctx.renderer.crowd.handfuls.length > 0, null, { timeout: 6000, polling: 10 }).catch(() => null);
    for (let j = 0; j < 4; j++) await frame(page, `x-monster-play-6-handful-fp-${j}`);
  }, { noLock: true });
}
