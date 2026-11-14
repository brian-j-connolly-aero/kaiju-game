/**
 * shots.mjs extras for phase 2's city and the monster's weight (docs/ROADMAP.md: "something
 * happening every 20 seconds"): the special buildings standing and going off, a field of mounds
 * after a fight, a tower fallen across a street (and as a late joiner sees it), the monster's
 * footsteps and a stomp swaying a block, a tank at top speed, the squad faded by a third-person
 * camera, a propane tank going off where it stands. Run alone with
 * `node tools/playtest/shots.mjs --only x-city`.
 *
 * Phase 3 ("looks and sound", the city): the roofs colored by district from the monster's height
 * by day, at sunset and at night, damaged and in rubble, and on the map (`x-city-roofs`); a packed
 * starting neighborhood from the street and from the hatchling's height, with the six new kinds of
 * buildings whole and wrecked (`x-city-starts`); the hills on the horizon from the street and from
 * the titan's height at noon and at sunset (`x-city-hills`); the gas station's fireball as a short
 * sequence (`x-city-fireball`); the frame's cost in a start at stage 1 and over the city at stage 3
 * (`x-city-cost`).
 *
 * Everything happens in the sandbox (the simulation runs in the page): structures are wrecked by
 * queueing hits on its world, the camera is placed by replacing the controller's `applyCamera`.
 * Moments are caught as short runs of frames (`__mb.helpers.screenshot`, the 3D view only),
 * saved as `<tag>-<name>-NN.png`. A page drawn in software stalls for seconds at a time; so that
 * the events of a stall are not taken for a backlog (whose effects the page skips), the extras
 * hold the event queue's arrival times (`holdEvents`).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Events released in their own time however long a frame stalls (see the header). */
const holdEvents = (page) =>
  page.evaluate(() => {
    const q = window.__mb.internals.ctx.runtime.session.queue;
    const push = q.push.bind(q);
    q.push = (...items) => push(...items.map((i) => ({ ...i, arrivedAt: Number.POSITIVE_INFINITY })));
  });

/** The bots stand still (no fight gets in the picture). */
const stillBots = (page) =>
  page.evaluate(() => {
    window.__mb.internals.ctx.client.local.world.config.bots = { kaijuHandicap: 1, humanHandicap: 1 };
  });

/** Places the camera at `from`, looking at `to`, for the frames to come (lens 55 degrees). */
const camera = (page, from, to) =>
  page.evaluate(
    ({ from, to }) => {
      const c = window.__mb.internals.ctx.runtime.controller;
      c.applyCamera = (ctx, cam) => {
        cam.position.set(from.x, from.y, from.z);
        cam.up.set(0, 1, 0);
        cam.lookAt(to.x, to.y, to.z);
        if (cam.fov !== 55) {
          cam.fov = 55;
          cam.updateProjectionMatrix();
        }
      };
    },
    { from, to },
  );

/** Queues a hit that wrecks structure `id` outright (as a swipe would, in the end). */
const wreck = (page, ids, dir) =>
  page.evaluate(
    ({ ids, dir }) => {
      const w = window.__mb.internals.ctx.client.local.world;
      for (const id of ids) w.structureHits.push({ id, damage: Number.POSITIVE_INFINITY, by: 0, cause: 'swipe', ...(dir ? { dirX: dir.x, dirZ: dir.z } : {}) });
    },
    { ids, dir },
  );

const counts = (page) => page.evaluate(() => ({ ...window.__mb.internals.ctx.runtime.eventCounts }));

/** The middle of a district's outline (world meters), by its name. */
const districtMiddle = (page, name) =>
  page.evaluate((name) => {
    const d = window.__mb.internals.ctx.client.local.world.city.districts.find((x) => x.name === name);
    if (!d) throw new Error(`no district ${name}`);
    let x = 0;
    let z = 0;
    for (const p of d.polygon) {
      x += p.x;
      z += p.z;
    }
    return { x: x / d.polygon.length, z: z / d.polygon.length };
  }, name);

/** The fog of the stage that has each time of day (render/gameRenderer.ts FOG). */
const FOG_OF = { afternoon: { near: 140, far: 1500 }, sunset: { near: 280, far: 2700 }, night: { near: 520, far: 4400 } };

/** Shows another time of day at once (the sky, the light and the fog of its stage; the match's stage stays). */
const timeOfDay = (page, time, fog = FOG_OF[time]) =>
  page.evaluate(({ time, fog }) => window.__mb.internals.ctx.renderer.sky.setTime(time, fog, 0), { time, fog });

/** The nearest structure of an archetype to the kaiju. */
const nearest = (page, archetype) =>
  page.evaluate((archetype) => {
    const w = window.__mb.internals.ctx.client.local.world;
    const k = w.kaijus[0];
    let best = null;
    for (const s of w.city.structures) {
      if (s.archetype !== archetype || w.structureHp[s.id] <= 0) continue;
      if (!best || Math.hypot(s.x - k.x, s.z - k.z) < Math.hypot(best.x - k.x, best.z - k.z)) best = s;
    }
    return best && { id: best.id, x: best.x, z: best.z, h: best.height, kx: k.x, kz: k.z };
  }, archetype);

/** The frame statistics over `seconds` (frames shown a second, script time a frame). */
const frameRate = async (page, seconds) => {
  const a = await page.evaluate(() => ({ n: window.__mb.state().frame.count, t: performance.now() }));
  await sleep(seconds * 1000);
  const b = await page.evaluate(() => ({ n: window.__mb.state().frame.count, t: performance.now(), ms: window.__mb.state().frame.ms, info: window.__mb.renderer.info() }));
  return { fps: +(((b.n - a.n) * 1000) / (b.t - a.t)).toFixed(1), ms: +b.ms.toFixed(1), calls: b.info.calls, triangles: b.info.triangles };
};

export async function cityExtras(visit, out) {
  /** A short run of frames as the page draws them, saved as `<tag>-<name>-NN.png`. */
  const frames = async (page, tag, name, n) => {
    const shots = await page.evaluate(async (n) => {
      const list = [];
      for (let i = 0; i < n; i++) list.push(await window.__mb.helpers.screenshot());
      return list;
    }, n);
    shots.forEach((d, i) => writeFileSync(join(out, `${tag}-${name}-${String(i).padStart(2, '0')}.png`), Buffer.from(d.split(',')[1], 'base64')));
  };

  // The three special buildings of the starting neighborhood: standing (their lights), then each
  // going off: the substation's surge leaping to the monster, the gas station's fireball, the
  // radio mast falling and its top section coming to lie as a city weapon.
  await visit('x-city-specials', { sandbox: '1', role: 'kaiju', mute: '1' }, async (page, shot) => {
    await holdEvents(page);
    await stillBots(page);
    const sub = await nearest(page, 'substation_a');
    const gas = await nearest(page, 'gasstation_a');
    const mast = await nearest(page, 'radiomast_a');
    if (!sub || !gas || !mast) throw new Error('x-city-specials: the start has no substation, gas station or radio mast');
    const around = (s, r, h, a, y) => camera(page, { x: s.x + Math.sin(a) * r, y: y + h, z: s.z + Math.cos(a) * r }, { x: s.x, y, z: s.z });
    await around(sub, 40, 14, 0.8, 3);
    await sleep(1200);
    await shot('1-substation');
    await around(gas, 42, 14, 0.8, 3);
    await sleep(1200);
    await shot('2-gasstation');
    await around(mast, 50, 12, 0.8, 10);
    await sleep(1200);
    await shot('3-radiomast');
    await camera(page, { x: sub.kx + Math.sin(2.2) * 260, y: 120, z: sub.kz + Math.cos(2.2) * 260 }, { x: sub.kx, y: 0, z: sub.kz });
    await sleep(1200);
    await shot('4-from-afar');
    const before = await counts(page);
    const place = (s, off) =>
      page.evaluate(
        ({ s, off }) => {
          const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
          k.x = s.x + off;
          k.z = s.z + off;
          k.vx = 0;
          k.vz = 0;
        },
        { s, off },
      );
    await place(sub, 18);
    await around(sub, 55, 20, 0.3, 4);
    await sleep(900);
    await wreck(page, [sub.id]);
    await frames(page, 'x-city-specials', '5-surge', 8);
    await place(gas, 30);
    await around(gas, 70, 25, 0.3, 6);
    await sleep(900);
    await wreck(page, [gas.id]);
    await frames(page, 'x-city-specials', '6-fireball', 12);
    // The mast falls away from the monster, over the side of its footprint that faces that way:
    // the monster is put straight out from one side (along the mast's own -Z), so it falls along
    // its own +Z, watched from beside its fall.
    const myaw = await page.evaluate((id) => window.__mb.internals.ctx.client.local.world.city.structures[id].yaw, mast.id);
    const dir = { x: Math.sin(myaw), z: Math.cos(myaw) };
    await page.evaluate(
      ({ mast, dir }) => {
        const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
        k.x = mast.x - dir.x * 14;
        k.z = mast.z - dir.z * 14;
        k.vx = 0;
        k.vz = 0;
      },
      { mast, dir },
    );
    const mid = { x: mast.x + dir.x * 12, z: mast.z + dir.z * 12 };
    await camera(page, { x: mid.x - dir.z * 38, y: 12, z: mid.z + dir.x * 38 }, { x: mid.x, y: 4, z: mid.z });
    await sleep(900);
    await wreck(page, [mast.id]);
    await frames(page, 'x-city-specials', '7-mast', 14);
    await sleep(1500);
    await shot('8-mast-down');
    const after = await counts(page);
    const got = (type) => (after[type] ?? 0) - (before[type] ?? 0);
    const loose = await page.evaluate(() => [...window.__mb.internals.ctx.renderer.city.looseShown()].map((o) => o.prop));
    console.log(`shots: x-city-specials: powerSurge ${got('powerSurge')}, fireball ${got('fireball')}, mastFall ${got('mastFall')}, structureFall ${got('structureFall')}, loose ${JSON.stringify(loose)}`);
    if (got('powerSurge') < 1 || got('fireball') < 1 || got('mastFall') < 1 || !loose.includes('mast')) throw new Error('x-city-specials: a special building did not pay its reward on screen');
  });

  // Rubble that stays and a tower that falls over: a block wrecked into mounds of its own
  // pieces; towers brought down until one falls over (half of them do) and lies across the
  // street; the city redrawn from the mirror as a player who joins late gets it; and the frame
  // rate before and after, with many mounds and fallen buildings in view.
  await visit('x-city-rubble', { sandbox: '2', role: 'human', mute: '1' }, async (page, shot) => {
    await holdEvents(page);
    await stillBots(page);
    const pick = await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      const slender = (s) => /^tower_|^office_c/.test(s.archetype);
      const towers = w.city.structures.filter(slender).sort((a, b) => Math.hypot(a.x - k.x, a.z - k.z) - Math.hypot(b.x - k.x, b.z - k.z));
      const t = towers[0];
      const block = w.city.structures.filter((s) => !s.passable && !slender(s) && Math.hypot(s.x - t.x, s.z - t.z) < 170).map((s) => s.id);
      return { t: { x: t.x, z: t.z, h: t.height }, towers: towers.slice(0, 24).map((s) => ({ id: s.id, x: s.x, z: s.z, h: s.height })), block };
    });
    const t = pick.t;
    const overview = { from: { x: t.x + 190, y: 110, z: t.z + 190 }, to: { x: t.x, y: 15, z: t.z } };
    await camera(page, overview.from, overview.to);
    await sleep(1500);
    await shot('0-before');
    const fpsBefore = await frameRate(page, 4);
    await wreck(page, pick.block);
    await sleep(5000);
    await shot('1-mounds');
    // Topple the towers one by one until one falls over, watched from beside it.
    let fell = null;
    for (const s of pick.towers) {
      const n = (await counts(page)).structureFall ?? 0;
      await camera(page, { x: s.x + 2.2 * s.h, y: s.h * 0.7, z: s.z - 0.6 * s.h }, { x: s.x, y: s.h * 0.3, z: s.z });
      await sleep(400);
      await wreck(page, [s.id], { x: 1, z: 0.3 });
      await frames(page, 'x-city-rubble', `2-fall-${s.id}`, 12);
      if (((await counts(page)).structureFall ?? 0) > n) {
        fell = s;
        break;
      }
    }
    if (!fell) throw new Error('x-city-rubble: none of the towers fell over');
    await sleep(3000);
    const lying = { from: { x: fell.x + 1.6 * fell.h, y: fell.h * 0.9, z: fell.z + 1.6 * fell.h }, to: { x: fell.x + fell.h * 0.4, y: 0, z: fell.z } };
    await camera(page, lying.from, lying.to);
    await sleep(1500);
    await shot('3-fallen');
    // As a player who joins late sees it: the city redrawn from the mirrored city state.
    await page.evaluate(() => window.__mb.internals.ctx.renderer.resync());
    await sleep(1500);
    await shot('4-fallen-late-joiner');
    const still = await page.evaluate((id) => window.__mb.internals.ctx.renderer.city.fallen(id), fell.id);
    if (!still) throw new Error('x-city-rubble: the fallen tower was not lying fallen after a redraw from the mirror');
    // Many mounds and fallen buildings in view: wreck the rest of the towers too.
    await wreck(page, pick.towers.map((s) => s.id), { x: 0.3, z: 1 });
    await sleep(5000);
    await camera(page, overview.from, overview.to);
    await sleep(1500);
    await shot('5-after-the-fight');
    const fpsAfter = await frameRate(page, 4);
    const fallen = await page.evaluate(() => window.__mb.internals.ctx.renderer.city.lying);
    console.log(`shots: x-city-rubble: ${pick.block.length} buildings wrecked into mounds, ${fallen} lying fallen; frame rate before ${JSON.stringify(fpsBefore)}, after ${JSON.stringify(fpsAfter)}`);
  });

  // The monster's weight: its own view while it walks (the lens opens), the footstep thumps for
  // a squad near it, and a stomp swaying the block around it (frames from beside the block).
  await visit('x-city-weight', { sandbox: '2', role: 'kaiju', mute: '1' }, async (page, shot) => {
    await holdEvents(page);
    await stillBots(page);
    await page.evaluate(() => {
      const r = window.__mb.internals.ctx.runtime;
      const renderer = window.__mb.internals.ctx.renderer;
      window.__weight = { thumps: 0, kick: 0, fov: 0, swaying: 0, hopping: 0, glass: 0 };
      // The footfalls' thumps as they are kicked (a picture a fifth of a second apart misses their dip).
      const thump = r.shake.thump.bind(r.shake);
      r.shake.thump = (amount) => {
        thump(amount);
        window.__weight.thumps++;
        window.__weight.kick = Math.max(window.__weight.kick, amount);
      };
      const apply = r.shake.apply.bind(r.shake);
      r.shake.apply = (cam, dt, scale) => {
        apply(cam, dt, scale);
        window.__weight.fov = Math.max(window.__weight.fov, cam.fov);
      };
      const update = renderer.update.bind(renderer);
      renderer.update = (...a) => {
        update(...a);
        window.__weight.swaying = Math.max(window.__weight.swaying, renderer.city.swaying);
        window.__weight.hopping = Math.max(window.__weight.hopping, renderer.city.hopping);
      };
      const glass = renderer.cues.onGlass;
      renderer.cues.onGlass = (...a) => {
        window.__weight.glass++;
        glass?.(...a);
      };
    });
    await page.keyboard.down('KeyW');
    await sleep(3000);
    await frames(page, 'x-city-weight', '1-walk', 6);
    await page.keyboard.up('KeyW');
    // A stomp beside a block: the monster is put beside the tallest building in a stomp's shock
    // reach (not so close that the stomp itself wrecks it), seen low from across the street so
    // the sway shows against the sky.
    const spot = await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      const near = w.city.structures
        .filter((s) => !s.passable && w.structureHp[s.id] > 0 && s.height < 60 && Math.hypot(s.x - k.x, s.z - k.z) < 300)
        .sort((a, b) => b.height - a.height);
      const t = near[0];
      // 50 m from it, on the side toward where the monster stands.
      const dx = k.x - t.x;
      const dz = k.z - t.z;
      const len = Math.hypot(dx, dz) || 1;
      k.x = t.x + (dx / len) * 50;
      k.z = t.z + (dz / len) * 50;
      k.vx = 0;
      k.vz = 0;
      return { kx: k.x, kz: k.z, tx: t.x, tz: t.z, th: t.height };
    });
    await sleep(800);
    const dx = spot.tx - spot.kx;
    const dz = spot.tz - spot.kz;
    const len = Math.hypot(dx, dz) || 1;
    // Off to the side of the line from the monster to the building, the building between.
    const back = Math.max(60, spot.th * 2.2);
    await camera(page, { x: spot.tx + (dx / len) * back * 0.5 - (dz / len) * back, y: Math.max(4, spot.th * 0.35), z: spot.tz + (dz / len) * back * 0.5 + (dx / len) * back }, { x: spot.tx, y: spot.th * 0.55, z: spot.tz });
    await sleep(1500);
    await page.keyboard.down('Space');
    await sleep(150);
    await page.keyboard.up('Space');
    await sleep(700);
    await frames(page, 'x-city-weight', '2-stomp', 12);
    await shot('3-after-the-stomp');
    const w = await page.evaluate(() => window.__weight);
    console.log(`shots: x-city-weight: widest lens ${w.fov.toFixed(1)} degrees (60 standing), ${w.thumps} thumps (the largest ${w.kick.toFixed(2)}), buildings swaying at once ${w.swaying}, props hopping ${w.hopping}, glass bursts ${w.glass}`);
    if (w.swaying < 1 || w.hopping < 1 || w.thumps < 1) throw new Error('x-city-weight: the stomp swayed no building or hopped no prop, or no footfall thumped');
  });

  // The army's sense of speed: a tank flat out down a long street (a wider lens, dust off its
  // tracks, streaks of air), then a turn (the camera leans); and the squad on foot standing close
  // behind its leader, faded by the third-person camera (and, for comparison, drawn solid).
  await visit('x-city-speed', { sandbox: '2', role: 'human', mute: '1' }, async (page, shot) => {
    await holdEvents(page);
    await stillBots(page);
    await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const u = w.units[w.squads[me.squadId].driven];
      const b = w.match.bounds;
      let best = null;
      for (const e of w.city.roads.edges) {
        const a = w.city.roads.nodes[e.a];
        const z = w.city.roads.nodes[e.b];
        if (e.kind === 'bridge' || a.x < b.minX + 40 || a.x > b.maxX - 40 || a.z < b.minZ + 40 || a.z > b.maxZ - 40) continue;
        const len = Math.hypot(z.x - a.x, z.z - a.z);
        if (!best || len > best.len) best = { a, z, len };
      }
      const yaw = Math.atan2(best.z.x - best.a.x, best.z.z - best.a.z);
      Object.assign(u, { x: best.a.x, z: best.a.z, yaw, aimYaw: yaw, vx: 0, vz: 0 });
      u.control.aimYaw = yaw;
      window.__speedYaw = yaw;
      window.__speed = { fov: 0, roll: 0, streaks: 0 };
      const r = window.__mb.internals.ctx.runtime;
      const apply = r.shake.apply.bind(r.shake);
      r.shake.apply = (cam, dt, scale) => {
        apply(cam, dt, scale);
        cam.updateMatrixWorld();
        window.__speed.fov = Math.max(window.__speed.fov, cam.fov);
        window.__speed.roll = Math.max(window.__speed.roll, Math.abs(Math.asin(cam.matrixWorld.elements[1])) * 57.3);
        window.__speed.streaks = Math.max(window.__speed.streaks, window.__mb.internals.ctx.renderer.motion.streaks.length);
      };
    });
    await sleep(800);
    await page.evaluate(() => {
      const c = window.__mb.internals.ctx.runtime.controller;
      c.viewYaw = window.__speedYaw;
      c.viewPitch = 0.02;
    });
    await shot('0-standing');
    await page.keyboard.down('KeyW');
    await sleep(4500);
    await shot('1-top-speed');
    await page.keyboard.down('KeyA');
    await sleep(900);
    await shot('2-turning');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    const s = await page.evaluate(() => window.__speed);
    console.log(`shots: x-city-speed: widest lens ${s.fov.toFixed(1)} degrees (58 standing), lean up to ${s.roll.toFixed(1)} degrees, up to ${s.streaks} streaks`);
    if (s.fov < 63 || s.streaks < 1) throw new Error('x-city-speed: the tank at top speed showed no wider lens or no streaks');
  });

  await visit('x-city-squad', { sandbox: '1', role: 'human', mute: '1' }, async (page, shot) => {
    await stillBots(page);
    const yaw = await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const squad = w.squads[me.squadId];
      const lead = w.units[squad.driven];
      squad.units.forEach((id, i) => {
        if (i === 0) return;
        const u = w.units[id];
        const back = [3, 5, 7.5][(i - 1) % 3];
        const side = [-2.5, 2.5, 0][(i - 1) % 3];
        Object.assign(u, { x: lead.x - Math.sin(lead.yaw) * back + Math.cos(lead.yaw) * side, z: lead.z - Math.cos(lead.yaw) * back - Math.sin(lead.yaw) * side, vx: 0, vz: 0, yaw: lead.yaw });
      });
      return lead.yaw;
    });
    await sleep(600);
    await page.evaluate((yaw) => {
      const c = window.__mb.internals.ctx.runtime.controller;
      c.viewYaw = yaw;
      c.viewPitch = -0.05;
    }, yaw);
    await sleep(1200);
    await shot('1-squad-faded');
    await page.evaluate(() => {
      const r = window.__mb.internals.ctx.renderer;
      const update = r.units.update.bind(r.units);
      r.units.update = (units, ctx, ...rest) => update(units, { ...ctx, fadeSquadNear: false }, ...rest);
    });
    await sleep(1200);
    await shot('2-squad-solid-for-comparison');
  });

  // A propane tank set off where it stands by a shot (the same blast as one thrown).
  await visit('x-city-propane', { sandbox: '1', role: 'human', mute: '1' }, async (page) => {
    await holdEvents(page);
    await stillBots(page);
    const p = await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      let best = null;
      for (const q of w.city.props) if (q.kind === 'propane' && (!best || Math.hypot(q.x - k.x, q.z - k.z) < Math.hypot(best.x - k.x, best.z - k.z))) best = q;
      return best && { id: best.id, x: best.x, z: best.z };
    });
    if (!p) throw new Error('x-city-propane: no propane tank in the start');
    await camera(page, { x: p.x + 22, y: 9, z: p.z + 16 }, { x: p.x, y: 1.5, z: p.z });
    await sleep(1500);
    const n = (await counts(page)).propaneBlast ?? 0;
    await page.evaluate((id) => window.__mb.internals.ctx.client.local.world.propHits.push({ id, by: 0, cause: 'shell' }), p.id);
    await frames(page, 'x-city-propane', '1-blast', 8);
    if (((await counts(page)).propaneBlast ?? 0) <= n) throw new Error('x-city-propane: the shot tank did not go off');
  });

  // --- phase 3: the city's looks (docs/ROADMAP.md phase 3) ------------------------------------

  // Roofs colored by district: from a juvenile's and a titan's height over the north-west
  // (Temple Hill's terracotta, Hollowmere's moss green, Northgate's charcoal), the south-west
  // (Bellhaven's slate blue, the Old Town's red clay, the Boardwalk's teal) and the east (Easter
  // Green's brick red, the Cinder Works' soot), by day, at sunset and at night; then a block
  // wrecked (damaged roofs, mounds, falling pieces) and the map.
  await visit('x-city-roofs', { sandbox: '1', role: 'kaiju', mute: '1' }, async (page, shot) => {
    await holdEvents(page);
    await stillBots(page);
    const hill = await districtMiddle(page, 'Temple Hill');
    const hollow = await districtMiddle(page, 'Hollowmere');
    const north = await districtMiddle(page, 'Northgate');
    const bell = await districtMiddle(page, 'Bellhaven');
    const old = await districtMiddle(page, 'Old Town');
    const board = await districtMiddle(page, 'The Boardwalk');
    const easter = await districtMiddle(page, 'Easter Green');
    const cinder = await districtMiddle(page, 'The Cinder Works');
    const mid = (...ps) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, z: ps.reduce((a, p) => a + p.z, 0) / ps.length });
    /** From `back` meters toward the city's middle from `at`, `up` meters high, looking at `at`. */
    const over = (at, back, up) => {
      const len = Math.hypot(at.x, at.z) || 1;
      return camera(page, { x: at.x - (at.x / len) * back, y: up, z: at.z - (at.z / len) * back }, { x: at.x, y: 0, z: at.z });
    };
    const nw = mid(hill, hollow, north);
    const sw = mid(bell, old, board);
    const east = mid(easter, cinder);
    for (const time of ['afternoon', 'sunset', 'night']) {
      await timeOfDay(page, time, time === 'afternoon' ? { near: 300, far: 2600 } : FOG_OF[time]);
      await over(nw, 420, 240);
      await sleep(1500);
      await frames(page, 'x-city-roofs', `1-north-west-${time}`, 1);
      if (time !== 'afternoon') continue;
      await over(sw, 380, 230);
      await sleep(1500);
      await frames(page, 'x-city-roofs', '2-south-west-afternoon', 1);
      await over(east, 380, 230);
      await sleep(1500);
      await frames(page, 'x-city-roofs', '3-east-afternoon', 1);
      // A juvenile's height over the line between Hollowmere and Temple Hill.
      const edge = mid(hill, hollow);
      await camera(page, { x: edge.x - 160, y: 70, z: edge.z - 120 }, { x: edge.x, y: 0, z: edge.z + 40 });
      await sleep(1500);
      await frames(page, 'x-city-roofs', '4-juvenile-height-afternoon', 1);
    }
    // A block wrecked: some buildings damaged, some in rubble, pieces in the air.
    await timeOfDay(page, 'afternoon', { near: 300, far: 2600 });
    const block = await page.evaluate((at) => {
      const w = window.__mb.internals.ctx.client.local.world;
      const near = w.city.structures.filter((s) => s.landmark === null && !s.passable && Math.hypot(s.x - at.x, s.z - at.z) < 70);
      return near.map((s) => ({ id: s.id, hp: s.hp }));
    }, bell);
    await page.evaluate((block) => {
      const w = window.__mb.internals.ctx.client.local.world;
      block.forEach((b, i) => w.structureHits.push({ id: b.id, damage: i % 3 === 0 ? Number.POSITIVE_INFINITY : b.hp * (i % 3 === 1 ? 0.45 : 0.8), by: 0, cause: 'swipe' }));
    }, block);
    await camera(page, { x: bell.x - 120, y: 85, z: bell.z - 90 }, { x: bell.x, y: 0, z: bell.z });
    await frames(page, 'x-city-roofs', '5-wrecked-block', 4);
    await sleep(4000);
    await frames(page, 'x-city-roofs', '6-wrecked-block-settled', 1);
    await page.keyboard.press('KeyM');
    await sleep(1500);
    await shot('7-map');
    await page.keyboard.press('KeyM');
    console.log(`shots: x-city-roofs: ${block.length} buildings round the middle of Bellhaven wrecked or damaged`);
  });

  // Hills on the horizon: from the street of three starts looking out of the city (west, north,
  // east), from a titan's height over the middle, at noon and at sunset (and the titan's night),
  // and the open sea with the headland far out to the south-west. Pictures of the 3D view only.
  await visit('x-city-hills', { sandbox: '1', role: 'human', mute: '1' }, async (page) => {
    await stillBots(page);
    const spots = await page.evaluate(() => {
      const c = window.__mb.internals.ctx.client.local.world.city;
      const node = (name) => {
        const a = c.anchors.find((x) => x.name === name);
        let best = null;
        for (const n of c.roads.nodes) if (!best || Math.hypot(n.x - a.x, n.z - a.z) < Math.hypot(best.x - a.x, best.z - a.z)) best = n;
        return { x: best.x, z: best.z };
      };
      return { west: node('Alder Row'), north: node('Ivy Court'), east: node('Harrow Lane'), sea: node('Juniper Bay') };
    });
    const look = (from, dx, dz, y, up) => camera(page, { x: from.x, y, z: from.z }, { x: from.x + dx * 1000, y: y + up * 1000, z: from.z + dz * 1000 });
    const one = (name) => frames(page, 'x-city-hills', name, 1);
    for (const time of ['afternoon', 'sunset']) {
      await timeOfDay(page, time);
      await look(spots.west, 1, 0.15, 5, 0.06);
      await sleep(1500);
      await one(`1-street-west-${time}`);
      await look(spots.north, 0.1, 1, 5, 0.06);
      await sleep(1500);
      await one(`2-street-north-${time}`);
      await look(spots.east, -1, -0.1, 5, 0.06);
      await sleep(1500);
      await one(`3-street-east-${time}`);
      await camera(page, { x: 60, y: 260, z: -560 }, { x: 0, y: 120, z: 2000 });
      await sleep(1500);
      await one(`4-titan-north-${time}`);
      await camera(page, { x: -560, y: 260, z: -60 }, { x: 2000, y: 120, z: 200 });
      await sleep(1500);
      await one(`5-titan-west-${time}`);
    }
    await timeOfDay(page, 'night');
    await camera(page, { x: 60, y: 260, z: -560 }, { x: 0, y: 120, z: 2000 });
    await sleep(1500);
    await one('6-titan-north-night');
    await timeOfDay(page, 'afternoon');
    await camera(page, { x: spots.sea.x, y: 40, z: spots.sea.z }, { x: spots.sea.x + 1500, y: 0, z: spots.sea.z - 1800 });
    await sleep(1500);
    await one('7-sea-and-headland-afternoon');
    const info = await page.evaluate(() => {
      const ground = window.__mb.internals.ctx.renderer.ground;
      const hills = ground.children.find((o) => o.name === 'hills');
      return { triangles: hills ? hills.geometry.getAttribute('position').count / 3 : 0, meshes: ground.children.length };
    });
    console.log(`shots: x-city-hills: the hills are one mesh of ${info.triangles} triangles (the ground: ${info.meshes} meshes)`);
    if (info.triangles <= 0) throw new Error('x-city-hills: no hills drawn');
  });

  // The gas station's fireball as a short sequence: the flash and the shock ring, flames rolling up
  // and out, cooling into a cap of dark smoke over the fire left on the ruin. From across the
  // street, every frame the page draws for six seconds (each named by its time after the blast),
  // then two at sunset from a juvenile's height.
  await visit('x-city-fireball', { sandbox: '1', role: 'kaiju', mute: '1' }, async (page) => {
    await holdEvents(page);
    await stillBots(page);
    await page.evaluate(() => {
      const specials = window.__mb.internals.ctx.renderer.specials;
      const renderer = window.__mb.internals.ctx.renderer;
      const fireball = specials.fireball.bind(specials);
      // Its age on the effects' own clock (a page drawn in software takes short steps of a long frame).
      specials.fireball = (...a) => {
        window.__fireballAt = renderer.time;
        return fireball(...a);
      };
    });
    const go = async (time, place, name, seconds, most) => {
      const gas = await nearest(page, 'gasstation_a');
      if (!gas) throw new Error('x-city-fireball: no gas station left standing');
      await timeOfDay(page, time);
      await page.evaluate((gas) => {
        const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
        k.x = gas.x + 30;
        k.z = gas.z + 30;
        k.vx = 0;
        k.vz = 0;
        window.__fireballAt = 0;
      }, gas);
      const from = place(gas);
      await camera(page, from, { x: gas.x, y: 18, z: gas.z });
      await sleep(1200);
      await wreck(page, [gas.id]);
      const ages = [];
      for (let i = 0; i < most; i++) {
        const shot = await page.evaluate(async () => {
          const d = await window.__mb.helpers.screenshot();
          return { d, age: window.__fireballAt > 0 ? window.__mb.internals.ctx.renderer.time - window.__fireballAt : -1 };
        });
        if (shot.age < 0) continue;
        writeFileSync(join(out, `x-city-fireball-${name}-${shot.age.toFixed(1).padStart(4, '0')}s.png`), Buffer.from(shot.d.split(',')[1], 'base64'));
        ages.push(shot.age.toFixed(1));
        if (shot.age > seconds) break;
      }
      if (ages.length === 0) throw new Error('x-city-fireball: the gas station did not go up');
      return ages;
    };
    const ages = await go('afternoon', (g) => ({ x: g.x - 70, y: 12, z: g.z - 50 }), '1-afternoon', 6, 90);
    const dusk = await go('sunset', (g) => ({ x: g.x - 120, y: 60, z: g.z - 90 }), '2-sunset', 2.5, 30);
    console.log(`shots: x-city-fireball: afternoon pictures at ${ages.join(', ')} s after the blast; sunset at ${dusk.join(', ')} s`);
  });

  // A packed starting neighborhood: from the squad's own third-person camera along a narrow
  // street and across it (houses close behind), from the hatchling's chase camera the same way,
  // then the six new kinds of buildings whole and wrecked (pieces falling, damaged, in mounds), a
  // back lane with its garages, and the whole start from above.
  /**
   * The most built-up narrow street (9 m or less) in the start's square: the one with the most
   * houses standing within 19 m of its middle line for its length. Its middle and heading.
   */
  const narrowStreet = (page) =>
    page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const c = w.city;
      const a = c.anchors[w.match.anchor];
      const b = w.match.bounds;
      let best = null;
      for (const e of c.roads.edges) {
        if (e.kind === 'bridge' || e.width > 9) continue;
        const p = c.roads.nodes[e.a];
        const q = c.roads.nodes[e.b];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        const mx = (p.x + q.x) / 2;
        const mz = (p.z + q.z) / 2;
        if (len < 45 || mx < b.minX + 40 || mx > b.maxX - 40 || mz < b.minZ + 40 || mz > b.maxZ - 40) continue;
        const ux = (q.x - p.x) / len;
        const uz = (q.z - p.z) / len;
        let n = 0;
        for (const s of c.structures) {
          const dx = s.x - mx;
          const dz = s.z - mz;
          const along = dx * ux + dz * uz;
          const across = Math.abs(-dx * uz + dz * ux);
          if (Math.abs(along) < len / 2 - 4 && across < 19 && s.cls === 'house') n++;
        }
        const score = n / len;
        if (!best || score > best.score) best = { score, x: mx, z: mz, yaw: Math.atan2(ux, uz), width: e.width, houses: n };
      }
      return best && { ...best, start: a.name };
    });
  const lens = (page) =>
    page.evaluate(() => {
      const c = window.__mb.internals.ctx.runtime.controller;
      return { clear: +(c.clear ?? 1).toFixed(2), lift: +(c.lift ?? 0).toFixed(2) };
    });
  await visit('x-city-starts', { sandbox: '1', role: 'human', mute: '1' }, async (page) => {
    await stillBots(page);
    const street = await narrowStreet(page);
    if (!street) throw new Error('x-city-starts: no narrow street near the start');
    await page.evaluate((st) => {
      const w = window.__mb.internals.ctx.client.local.world;
      const me = w.players.find((p) => !p.bot && p.role === 'human');
      const squad = w.squads[me.squadId];
      // The monster out of the way, at the far end of the street.
      const k = w.kaijus[0];
      k.x = st.x + Math.sin(st.yaw) * 70;
      k.z = st.z + Math.cos(st.yaw) * 70;
      squad.units.forEach((id, i) => {
        const u = w.units[id];
        const back = i === 0 ? 0 : 4 + i * 2;
        Object.assign(u, { x: st.x - Math.sin(st.yaw) * back, z: st.z - Math.cos(st.yaw) * back, vx: 0, vz: 0, yaw: st.yaw, aimYaw: st.yaw });
      });
    }, street);
    await sleep(800);
    const view = (yaw, pitch) =>
      page.evaluate(
        ({ yaw, pitch }) => {
          const c = window.__mb.internals.ctx.runtime.controller;
          c.viewYaw = yaw;
          c.viewPitch = pitch;
        },
        { yaw, pitch },
      );
    await view(street.yaw, -0.04);
    await sleep(1500);
    await frames(page, 'x-city-starts', '1-squad-along-a-narrow-street', 1);
    const along = await lens(page);
    await view(street.yaw + Math.PI / 2, -0.04);
    await sleep(1500);
    await frames(page, 'x-city-starts', '2-squad-across-the-street', 1);
    const across = await lens(page);
    const info = await page.evaluate(() => window.__mb.renderer.info());
    console.log(`shots: x-city-starts: ${street.start}, a ${street.width} m street between ${street.houses} houses; the squad's camera clear ${along.clear} along it, ${across.clear} across it; ${info.calls} draw calls, ${info.triangles} triangles`);
  });
  await visit('x-city-starts', { sandbox: '1', role: 'kaiju', mute: '1' }, async (page) => {
    await stillBots(page);
    const street = await narrowStreet(page);
    if (!street) throw new Error('x-city-starts: no narrow street near the start');
    await page.evaluate((st) => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      Object.assign(k, { x: st.x, z: st.z, vx: 0, vz: 0, yaw: st.yaw, aimYaw: st.yaw });
      const c = window.__mb.internals.ctx.runtime.controller;
      c.aimYaw = st.yaw;
      c.aimPitch = -0.05;
    }, street);
    await sleep(1800);
    await frames(page, 'x-city-starts', '3-hatchling-along-a-narrow-street', 1);
    const along = await lens(page);
    await page.evaluate((st) => {
      const w = window.__mb.internals.ctx.client.local.world;
      const k = w.kaijus[0];
      k.yaw = st.yaw + Math.PI / 2;
      const c = window.__mb.internals.ctx.runtime.controller;
      c.aimYaw = st.yaw + Math.PI / 2;
    }, street);
    await sleep(1800);
    await frames(page, 'x-city-starts', '4-hatchling-across-the-street', 1);
    const across = await lens(page);
    const info = await page.evaluate(() => window.__mb.renderer.info());
    console.log(`shots: x-city-starts: the hatchling's camera clear ${along.clear} (lifted ${along.lift} body heights) along the street, ${across.clear} (lifted ${across.lift}) across it; ${info.calls} draw calls, ${info.triangles} triangles`);

    // The six new kinds, whole, from three quarters in front.
    const kinds = ['bungalow_a', 'duplex_a', 'garage_a', 'diner_a', 'firehouse_a', 'motel_a'];
    const found = [];
    for (const kind of kinds) {
      const s = await nearest(page, kind);
      if (!s) throw new Error(`x-city-starts: no ${kind} near the start`);
      const yaw = await page.evaluate((id) => window.__mb.internals.ctx.client.local.world.city.structures[id].yaw, s.id);
      found.push({ kind, ...s, yaw });
    }
    // The monster stands aside, out of the pictures.
    await page.evaluate((st) => {
      const k = window.__mb.internals.ctx.client.local.world.kaijus[0];
      k.x = st.x + Math.sin(st.yaw) * 400;
      k.z = st.z + Math.cos(st.yaw) * 400;
    }, street);
    const front = (s, far) => {
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      const d = Math.max(14, far);
      return camera(page, { x: s.x + fx * d - fz * d * 0.5, y: s.h * 0.9 + 3, z: s.z + fz * d + fx * d * 0.5 }, { x: s.x, y: s.h * 0.4, z: s.z });
    };
    const size = (s) => (s.kind === 'motel_a' ? 24 : s.kind === 'firehouse_a' ? 18 : s.kind === 'diner_a' ? 16 : 11);
    for (const s of found) {
      await front(s, size(s) * 1.25);
      await sleep(1300);
      await frames(page, 'x-city-starts', `5-${s.kind}`, 1);
    }
    // Wrecked: the bungalow, the duplex and the diner damaged; the garage, the firehouse and the
    // motel to rubble (the motel's pieces caught as they fall).
    await page.evaluate((found) => {
      const w = window.__mb.internals.ctx.client.local.world;
      for (const s of found) {
        const hp = w.city.structures[s.id].hp;
        if (['bungalow_a', 'duplex_a', 'diner_a'].includes(s.kind)) w.structureHits.push({ id: s.id, damage: hp * 0.6, by: 0, cause: 'swipe' });
      }
    }, found);
    const motel = found.find((s) => s.kind === 'motel_a');
    await front(motel, size(motel) * 1.6);
    await sleep(600);
    await wreck(page, found.filter((s) => ['garage_a', 'firehouse_a', 'motel_a'].includes(s.kind)).map((s) => s.id));
    // (Once the hit has been dealt: the pieces in the air.)
    for (let i = 0; i < 40 && (await page.evaluate((id) => window.__mb.internals.ctx.renderer.city.stageOf(id), motel.id)) < 3; i++) await sleep(100);
    await frames(page, 'x-city-starts', '6-motel-falling', 2);
    await sleep(3500);
    for (const s of found) {
      await front(s, size(s) * 1.25);
      await sleep(1200);
      await frames(page, 'x-city-starts', `7-${s.kind}-wrecked`, 1);
    }
    // A back lane between the garages, and the whole start from above.
    const lane = await page.evaluate(() => {
      const w = window.__mb.internals.ctx.client.local.world;
      const a = w.city.anchors[w.match.anchor];
      let best = null;
      for (const l of w.city.lanes ?? []) {
        const mx = (l.ax + l.bx) / 2;
        const mz = (l.az + l.bz) / 2;
        const d = Math.hypot(mx - a.x, mz - a.z);
        if (!best || d < best.d) best = { d, x: mx, z: mz, yaw: Math.atan2(l.bx - l.ax, l.bz - l.az) };
      }
      return best;
    });
    if (lane) {
      await camera(page, { x: lane.x - Math.sin(lane.yaw) * 45, y: 16, z: lane.z - Math.cos(lane.yaw) * 45 }, { x: lane.x, y: 0, z: lane.z });
      await sleep(1300);
      await frames(page, 'x-city-starts', '8-back-lane', 1);
    }
    await camera(page, { x: street.x - 160, y: 150, z: street.z - 120 }, { x: street.x, y: 0, z: street.z });
    await sleep(1500);
    await frames(page, 'x-city-starts', '9-the-start-from-above', 1);
    const stages = await page.evaluate((found) => found.map((s) => window.__mb.internals.ctx.renderer.city.stageOf(s.id)), found);
    console.log(`shots: x-city-starts: the six kinds drawn at stages ${stages.join(', ')} after the hits; a back lane ${lane ? 'drawn' : 'missing'}`);
    if (stages.filter((x) => x >= 3).length < 3 || stages.filter((x) => x === 1 || x === 2).length < 3) throw new Error('x-city-starts: the new kinds did not show their damage');
  });

  // The frame's cost (draw calls and triangles, docs/CITY.md section 8): in a start at stage 1 from
  // the squad's and the hatchling's own cameras, and at stage 3 from the titan's camera and from
  // 1.7 km over the whole city at night; each again with the hills hidden, to show what they cost.
  const costOf = async (page, label) => {
    const rate = await frameRate(page, 3);
    const hidden = await page.evaluate(async () => {
      const ground = window.__mb.internals.ctx.renderer.ground;
      const hills = ground.children.find((o) => o.name === 'hills');
      hills.visible = false;
      await window.__mb.helpers.screenshot();
      await window.__mb.helpers.screenshot();
      const info = window.__mb.renderer.info();
      hills.visible = true;
      return info;
    });
    const line = `${label}: ${rate.calls} draw calls, ${rate.triangles} triangles, ${rate.fps} frames a second (without the hills: ${hidden.calls} calls, ${hidden.triangles} triangles)`;
    console.log(`shots: x-city-cost: ${line}`);
    return { label, ...rate, hillsHidden: { calls: hidden.calls, triangles: hidden.triangles } };
  };
  const costs = [];
  await visit('x-city-cost', { sandbox: '1', role: 'human', mute: '1' }, async (page) => {
    await stillBots(page);
    await sleep(1500);
    costs.push(await costOf(page, 'stage 1, the squad in its start (third person)'));
  });
  await visit('x-city-cost', { sandbox: '1', role: 'kaiju', mute: '1' }, async (page) => {
    await stillBots(page);
    await sleep(1500);
    costs.push(await costOf(page, 'stage 1, the hatchling in its start (third person)'));
  });
  await visit('x-city-cost', { sandbox: '3', role: 'kaiju', mute: '1' }, async (page) => {
    await stillBots(page);
    await sleep(2000);
    costs.push(await costOf(page, 'stage 3, the titan (third person)'));
    await camera(page, { x: 300, y: 1700, z: -1500 }, { x: 0, y: 0, z: 0 });
    await sleep(2000);
    costs.push(await costOf(page, 'stage 3, the whole city from 1.7 km up at night'));
  });
  writeFileSync(join(out, 'x-city-cost.json'), `${JSON.stringify(costs, null, 2)}\n`);
}
