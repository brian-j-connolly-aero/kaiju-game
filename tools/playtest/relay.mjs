#!/usr/bin/env node
/**
 * A slow, uneven link between browsers (or test clients) and the game server, like a tunnel on a
 * bad evening: it passes TCP through unchanged (the page, the matchmaking requests and the
 * WebSocket all work through it), but holds every chunk back by a delay that wanders between
 * two bounds, adds a little jitter, and now and then stalls everything for a moment. Each
 * direction of each connection delivers in order, as TCP does: a chunk held back holds back the
 * ones behind it.
 *
 *   node tools/playtest/relay.mjs --listen 3100 --target 127.0.0.1:2567 \
 *     [--delay 30-80] [--jitter 15] [--stall-every 20] [--stall-ms 150-400] [--seed 1]
 *
 * Then open http://127.0.0.1:3100 (or point a test client at it). Defaults: 30 to 80 ms each
 * way, up to 15 ms of jitter, a stall of 150 to 400 ms about every 20 s (15 to 25 s apart).
 * `--stall-every 0` switches the stalls off, `--delay 0-0 --jitter 0` passes straight through.
 *
 * `startRelay(options)` does the same from a script (tools/playtest/netprobe.ts) and returns
 * { port, stalls, close() }; `stalls` lists when each stall began and how long it lasted.
 */

import net from 'node:net';
import { performance } from 'node:perf_hooks';

/** A small seeded random generator (mulberry32), so a run can be repeated. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Starts the relay. Options: listenPort (0 for any free one), targetHost, targetPort,
 * delayMin, delayMax (ms each way), jitter (ms), stallEvery (s, 0 for none), stallMin,
 * stallMax (ms), seed, log (function or undefined), now (seconds, for the stall list).
 */
export function startRelay(options) {
  const o = { listenPort: 0, targetHost: '127.0.0.1', delayMin: 30, delayMax: 80, jitter: 15, stallEvery: 20, stallMin: 150, stallMax: 400, seed: 1, ...options };
  const random = rng(o.seed);
  const start = performance.now();
  /** Seconds, for the list of stalls: the caller's clock when given (`now`), else since the start. */
  const clock = o.now ?? (() => (performance.now() - start) / 1000);
  // The wandering base delay: a slow random walk between the bounds, the same for every
  // connection (they share one route), re-drawn a little every 100 ms.
  let base = (o.delayMin + o.delayMax) / 2;
  const wander = setInterval(() => {
    const span = o.delayMax - o.delayMin;
    base = Math.min(o.delayMax, Math.max(o.delayMin, base + (random() - 0.5) * span * 0.15));
  }, 100);
  // Stalls: nothing is delivered until `stalledUntil`.
  let stalledUntil = 0;
  const stalls = [];
  let stallTimer = null;
  const planStall = () => {
    if (!(o.stallEvery > 0)) return;
    const wait = o.stallEvery * (0.75 + random() * 0.5) * 1000;
    stallTimer = setTimeout(() => {
      const length = o.stallMin + random() * (o.stallMax - o.stallMin);
      const now = performance.now();
      stalledUntil = now + length;
      stalls.push({ at: clock(), ms: Math.round(length) });
      o.log?.(`relay: stall of ${Math.round(length)} ms`);
      planStall();
    }, wait);
  };
  planStall();

  /** One direction of one connection: chunks wait their turn, in order. */
  const line = (to) => {
    let dueAt = 0;
    const waiting = [];
    let timer = null;
    const pump = () => {
      timer = null;
      const now = performance.now();
      while (waiting.length > 0 && waiting[0].at <= now && now >= stalledUntil) {
        const chunk = waiting.shift();
        if (!to.destroyed) to.write(chunk.data);
      }
      if (waiting.length > 0) {
        const next = Math.max(waiting[0].at, stalledUntil);
        timer = setTimeout(pump, Math.max(0, next - now));
      }
    };
    return (data) => {
      const now = performance.now();
      dueAt = Math.max(dueAt, now + base + random() * o.jitter);
      waiting.push({ at: dueAt, data });
      if (timer === null) timer = setTimeout(pump, Math.max(0, Math.max(dueAt, stalledUntil) - now));
    };
  };

  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(o.targetPort, o.targetHost);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    sockets.add(client);
    sockets.add(upstream);
    const up = line(upstream);
    const down = line(client);
    client.on('data', up);
    upstream.on('data', down);
    const end = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('close', end);
    upstream.on('close', end);
    client.on('error', end);
    upstream.on('error', end);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.listenPort, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        stalls,
        close() {
          clearInterval(wander);
          if (stallTimer) clearTimeout(stallTimer);
          for (const s of sockets) s.destroy();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

function range(text, fallback) {
  if (text === undefined) return fallback;
  const [a, b] = String(text).split('-').map(Number);
  return [a, Number.isFinite(b) ? b : a];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
  }
  const [targetHost, targetPort] = (args.target ?? '127.0.0.1:2567').split(':');
  const [delayMin, delayMax] = range(args.delay, [30, 80]);
  const [stallMin, stallMax] = range(args['stall-ms'], [150, 400]);
  const relay = await startRelay({
    listenPort: Number(args.listen ?? 3100),
    targetHost,
    targetPort: Number(targetPort),
    delayMin,
    delayMax,
    jitter: Number(args.jitter ?? 15),
    stallEvery: Number(args['stall-every'] ?? 20),
    stallMin,
    stallMax,
    seed: Number(args.seed ?? 1),
    log: (line) => console.log(line),
  });
  console.log(`relay: http://127.0.0.1:${relay.port} -> ${targetHost}:${targetPort}, ${delayMin}-${delayMax} ms each way`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => relay.close().then(() => process.exit(0)));
}
