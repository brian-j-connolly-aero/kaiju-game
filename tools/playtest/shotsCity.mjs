/**
 * shots.mjs extras for phase 2's city and the monster's weight (docs/ROADMAP.md: "something
 * happening every 20 seconds"): the special buildings standing and going off, a field of mounds
 * after a fight, a tower fallen across a street (and as a late joiner sees it), the monster's
 * footsteps and a stomp swaying a block, a tank at top speed, the squad faded by a third-person
 * camera, a propane tank going off where it stands. Run alone with
 * `node tools/playtest/shots.mjs --only x-city`.
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
}
