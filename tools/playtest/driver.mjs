/**
 * A player made of real input events, for scripted playtests (scripted.mjs).
 *
 * Nothing here calls into the game to make things happen: the driver presses keys, holds and
 * moves the mouse and clicks DOM buttons through Playwright, exactly the events a person's
 * hands produce. It READS the game through `window.__mb` (the latest server snapshot, the
 * events the server sent, the local controller's view direction), so a test can tell a visible
 * effect that the server confirmed from one the page merely imagined.
 *
 * Mouse look. In a real browser a click on the view locks the pointer and mouse movement turns
 * the view. Headless Chromium grants the lock but then reports garbage movement for synthetic
 * mouse events, so the driver switches pointer lock off (`disablePointerLock`) and uses the
 * path the game keeps for browsers without it: the view turns while a mouse button is held on
 * the canvas. The middle button is bound to nothing, so holding it turns the view and does
 * nothing else.
 */

/** Radians of view rotation per pixel of mouse movement (client/src/game/input/inputManager.ts). */
export const MOUSE_SENSITIVITY = 0.0023;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function wrapAngle(a) {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
}

/** Runs before any page script: takes pointer lock away, as in a browser that has none. */
export function disablePointerLock() {
  try {
    Object.defineProperty(Element.prototype, 'requestPointerLock', { value: undefined, configurable: true });
  } catch {
    // The game then asks for the lock and the headless browser grants it; mouse look will not work.
  }
}

/**
 * Runs in the page: everything a script wants to know, as plain data. `since` is how many
 * recorded events the caller has already seen.
 */
function probeInPage(since) {
  const mb = window.__mb;
  if (!mb) return null;
  const ctx = mb.internals.ctx;
  const rt = ctx.runtime;
  const store = (window.__mbEvents ??= { list: [], runtime: null });
  if (rt && store.runtime !== rt) {
    // Record every simulation event as it is released to the renderer (they all come from the server).
    store.runtime = rt;
    const original = rt.handleEvent.bind(rt);
    rt.handleEvent = (e) => {
      store.list.push(e);
      original(e);
    };
  }
  const state = mb.state();
  const session = rt ? rt.session : null;
  const latest = session ? session.latest : null;
  const frame = rt ? rt.frame : null;
  const out = {
    screen: state.screen,
    code: state.code,
    link: state.link,
    host: state.host,
    lobby: state.lobby,
    role: state.role,
    errors: state.errors,
    matchesEnded: state.matchesEnded,
    lastResult: state.lastResult,
    match: latest ? { ...latest.match, marks: [...latest.match.marks], tick: latest.tick } : null,
    kaiju: null,
    me: null,
    squad: null,
    squadUnits: [],
    units: [],
    view: null,
    aim: null,
    mapOpen: rt ? rt.mapOpen : false,
    wheelOpen: false,
    wheelHighlight: null,
    controller: rt ? rt.controller.kind : 'none',
    thirdPerson: rt ? rt.controller.thirdPerson : false,
    bounds: frame ? frame.bounds : null,
    predicted: null,
    counts: rt ? { ...rt.eventCounts } : {},
    events: store.list.slice(since),
    eventTotal: store.list.length,
    info: mb.renderer.info(),
    fps: state.frame.fps,
    ping: state.ping,
  };
  if (latest) {
    const k = latest.kaijus[0];
    if (k) out.kaiju = { ...k, cooldowns: { ...k.cooldowns }, held: k.held ? { ...k.held } : null };
    out.units = latest.units.map((u) => ({ id: u.id, squad: u.squad, x: u.x, z: u.z, alive: u.alive, hp: u.hp, laser: u.laser, rooted: u.rooted, charge: u.charge, shaken: u.shaken, members: u.members, type: u.type, cooldown: u.cooldown, veteran: u.veteran }));
    if (session.role.squadId >= 0) {
      const sq = latest.squads[session.role.squadId];
      if (sq) {
        out.squad = { ...sq, callInCooldowns: sq.callInCooldowns ? [...sq.callInCooldowns] : [] };
        out.squadUnits = out.units.filter((u) => u.squad === sq.id);
        out.me = sq.driven >= 0 ? out.units[sq.driven] : null;
      }
    }
  }
  if (frame) {
    const body = frame.localKaiju ?? frame.localUnit;
    if (body) out.predicted = { x: body.x, z: body.z, yaw: body.yaw };
  }
  if (rt) {
    const c = rt.controller;
    if (c.kind === 'kaiju') out.view = { yaw: c.aimYaw, pitch: c.aimPitch };
    else if (c.kind === 'human') {
      out.view = { yaw: c.viewYaw, pitch: c.viewPitch };
      out.aim = { on: c.aimPoint.on, x: c.aimPoint.x, y: c.aimPoint.y, z: c.aimPoint.z, dist: c.aimPoint.dist };
      out.wheelOpen = c.wheel.open;
      out.wheelHighlight = c.wheel.highlight;
    } else out.view = { yaw: c.yaw ?? 0, pitch: c.pitch ?? 0 };
  }
  return out;
}

/** Runs in the page: the standing structures and live props near a point, nearest first. */
function surroundingsInPage({ x, z, radius, limit }) {
  const rt = window.__mb.internals.ctx.runtime;
  if (!rt) return { structures: [], props: [] };
  const mirror = rt.session.mirror;
  const hp = mirror.query.structureHp;
  const structures = [];
  for (const s of mirror.city.structures) {
    if (hp[s.id] <= 0) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d > radius + Math.max(s.hx, s.hz)) continue;
    // Distance from the point to the footprint's edge (0 inside).
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const lx = (x - s.x) * c - (z - s.z) * sn;
    const lz = (x - s.x) * sn + (z - s.z) * c;
    const gx = Math.max(0, Math.abs(lx) - s.hx);
    const gz = Math.max(0, Math.abs(lz) - s.hz);
    structures.push({ id: s.id, x: s.x, z: s.z, hx: s.hx, hz: s.hz, yaw: s.yaw, height: s.height, cls: s.cls, value: s.value, maxHp: s.hp, hp: hp[s.id], passable: s.passable, gap: Math.hypot(gx, gz), dist: d });
  }
  structures.sort((a, b) => a.gap - b.gap);
  const props = [];
  const alive = mirror.query.propAlive;
  for (const p of mirror.city.props) {
    // The live props are a bitset, one bit per prop id.
    if (((alive[p.id >> 3] >> (p.id & 7)) & 1) === 0) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= radius) props.push({ id: p.id, kind: p.kind, x: p.x, z: p.z, dist: d });
  }
  props.sort((a, b) => a.dist - b.dist);
  return { structures: structures.slice(0, limit), props: props.slice(0, limit) };
}

export class Driver {
  /**
   * @param {import('playwright').Page} page
   * @param {{ width: number, height: number, log?: (line: string) => void }} options
   */
  constructor(page, options) {
    this.page = page;
    this.width = options.width;
    this.height = options.height;
    this.log = options.log ?? (() => {});
    this.seen = 0;
    /** Every event the page has released so far, in order. */
    this.events = [];
    this.last = null;
  }

  /** Reads the page. Also collects the events released since the previous call. */
  async probe() {
    const p = await this.page.evaluate(probeInPage, this.seen).catch(() => null);
    if (!p) return this.last;
    this.seen = p.eventTotal;
    for (const e of p.events) this.events.push(e);
    this.last = p;
    return p;
  }

  async surroundings(x, z, radius = 120, limit = 40) {
    return this.page.evaluate(surroundingsInPage, { x, z, radius, limit });
  }

  /**
   * Waits until `test(probe)` is truthy; returns its value, or null on timeout. The test may be
   * async: its result is awaited. (Without that, an async test's Promise counts as truthy and
   * the wait ends at once, having waited for nothing.)
   */
  async until(test, timeoutMs = 8000, everyMs = 60) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const p = await this.probe();
      const v = p ? await test(p) : null;
      if (v) return v;
      if (Date.now() > deadline) return null;
      await sleep(everyMs);
    }
  }

  /** Events of a type recorded from index `from` on that pass `filter`. */
  eventsSince(from, type, filter = () => true) {
    const out = [];
    for (let i = from; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.type === type && filter(e)) out.push(e);
    }
    return out;
  }

  // --- hands -----------------------------------------------------------------------------------

  async keyDown(code) {
    await this.page.keyboard.down(code);
  }

  async keyUp(code) {
    await this.page.keyboard.up(code);
  }

  async tapKey(code, holdMs = 90) {
    await this.page.keyboard.down(code);
    await sleep(holdMs);
    await this.page.keyboard.up(code);
  }

  /** Presses a mouse button on the middle of the view for `holdMs`. */
  async click(button = 'left', holdMs = 90) {
    await this.page.mouse.move(this.width / 2, this.height / 2);
    await this.page.mouse.down({ button });
    await sleep(holdMs);
    await this.page.mouse.up({ button });
  }

  /**
   * Turns the view by dragging with the middle button held: `dYaw` radians toward +yaw,
   * `dPitch` radians up. One drag stays inside the page, so a long turn takes several.
   */
  async drag(dYaw, dPitch, button = 'middle') {
    const cx = this.width / 2;
    const cy = this.height / 2;
    // The game subtracts lookX from the yaw and adds lookY to the pitch (lookY is minus mouse dy).
    let px = -dYaw / MOUSE_SENSITIVITY;
    let py = -dPitch / MOUSE_SENSITIVITY;
    const maxX = this.width * 0.4;
    const maxY = this.height * 0.4;
    while (Math.abs(px) > 0.5 || Math.abs(py) > 0.5) {
      const sx = Math.max(-maxX, Math.min(maxX, px));
      const sy = Math.max(-maxY, Math.min(maxY, py));
      await this.page.mouse.move(cx, cy);
      await this.page.mouse.down({ button });
      await this.page.mouse.move(cx + sx, cy + sy, { steps: 3 });
      await this.page.mouse.up({ button });
      px -= sx;
      py -= sy;
    }
  }

  /**
   * Turns the view to a heading and elevation. The kaiju's wanted heading can only run 150
   * degrees ahead of its body, so this repeats until the view has arrived (or gives up).
   */
  async lookTo(yaw, pitch = 0, tolerance = 0.03, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const p = await this.probe();
      if (!p || !p.view) return false;
      const dYaw = wrapAngle(yaw - p.view.yaw);
      const dPitch = pitch - p.view.pitch;
      if (Math.abs(dYaw) <= tolerance && Math.abs(dPitch) <= tolerance) return true;
      if (Date.now() > deadline) return false;
      await this.drag(dYaw, dPitch);
      await sleep(70);
    }
  }

  /** Where the local body is drawn right now (predicted), or null. */
  async position() {
    const p = await this.probe();
    return p ? p.predicted : null;
  }

  /** Turns the view toward a ground point (and a height, for the elevation) from `eyeHeight`. */
  async lookAt(x, z, y = 0, eyeHeight = 0, tolerance = 0.04) {
    const pos = await this.position();
    if (!pos) return false;
    const flat = Math.hypot(x - pos.x, z - pos.z);
    const yaw = Math.atan2(x - pos.x, z - pos.z);
    const pitch = flat > 0.5 ? Math.atan2(y - eyeHeight, flat) : 0;
    return this.lookTo(yaw, pitch, tolerance);
  }

  /**
   * Walks toward a point with the forward key held, steering with the mouse, until within
   * `stopDist` of it, `done(probe)` says so, or the time is up. Returns true when it arrived.
   */
  async walkTo(x, z, stopDist, { timeoutMs = 15000, done = null, key = 'KeyW' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let walking = false;
    let arrived = false;
    try {
      for (;;) {
        const p = await this.probe();
        if (!p || !p.predicted) break;
        const d = Math.hypot(x - p.predicted.x, z - p.predicted.z);
        if (d <= stopDist || (done && done(p))) {
          arrived = true;
          break;
        }
        if (Date.now() > deadline) break;
        const yaw = Math.atan2(x - p.predicted.x, z - p.predicted.z);
        const off = wrapAngle(yaw - p.view.yaw);
        if (Math.abs(off) > 0.05) await this.drag(off, -p.view.pitch);
        // Only walk once the view points roughly the right way: movement is relative to it.
        const facing = Math.abs(off) < 0.6;
        if (facing && !walking) {
          await this.keyDown(key);
          walking = true;
        } else if (!facing && walking) {
          await this.keyUp(key);
          walking = false;
        }
        await sleep(60);
      }
    } finally {
      if (walking) await this.keyUp(key);
    }
    return arrived;
  }

  async screenshot(file) {
    await this.page.screenshot({ path: file });
    return file;
  }
}
