/**
 * The network probe: the real game server, a slow and uneven relay in front of it
 * (tools/playtest/relay.mjs), and headless players that run the client's own network code
 * (GameClient, MatchSession, the predictor, the input ticker) and walk their bodies about the
 * way a person does, while recording every correction their prediction makes. No browser and
 * no drawing: what it measures is the network and the prediction alone.
 *
 *   npx tsx tools/playtest/netprobe.ts [--secs 180] [--players 2] [--kaiju] [--relay tunnel|none]
 *     [--delay 30-80] [--jitter 15] [--stall-every 20] [--stall-ms 150-400] [--seed 1]
 *     [--freeze-every 20] [--freeze-ms 150-350] [--server-pause-every 20] [--server-pause-ms 150-350]
 *     [--fast] [--out /tmp/mb-scratch/netprobe] [--url http://127.0.0.1:2567]
 *
 * `--freeze-every` freezes each headless page now and then (no frames, nothing received handled:
 * a browser's garbage collection); `--server-pause-every` stops the server process for a moment
 * (its garbage collection, or the container's virtual machine pausing).
 * `--players N` army players (the monster is a bot), plus one monster player with `--kaiju`.
 * `--url` uses a server that is already running instead of starting one. The report (a
 * per-player summary, the biggest corrections with what was going on at the time, and the
 * corrections second by second) is printed and written to `<out>/report.json`; the server's own
 * log (its slow moments: server/src/room/slowLog.ts) to `<out>/server.log`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Btn, moundHeightAt, type PlayerInput, type SimEvent, type SnapUnit } from '@mb/shared';
import { InputTicker } from '../../client/src/game/input/inputTicker';
import { GameClient } from '../../client/src/net/gameClient';
import { readAck } from '../../client/src/net/prediction';
import type { MatchSession } from '../../client/src/net/matchSession';
// @ts-expect-error: a plain JavaScript module next to this one
import { startRelay } from './relay.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
}
const secs = Number(args.secs ?? 180);
const armyPlayers = Number(args.players ?? 2);
const withKaiju = args.kaiju === '1';
const relayMode = args.relay ?? 'tunnel';
const seed = Number(args.seed ?? 1);
const out = args.out ?? '/tmp/mb-scratch/netprobe';
/** Page freezes like a browser's garbage collection: about every this many seconds, this long (ms). */
const freezeEvery = Number(args['freeze-every'] ?? 0);
/** Server pauses like a garbage collection or a virtual machine hiccup (the process is stopped). */
const pauseEvery = Number(args['server-pause-every'] ?? 0);
mkdirSync(out, { recursive: true });
const range = (text: string | undefined, fallback: [number, number]): [number, number] => {
  if (text === undefined) return fallback;
  const [a, b] = text.split('-').map(Number);
  return [a, Number.isFinite(b) ? b : a];
};
const freezeMs = range(args['freeze-ms'], [150, 350]);
const pauseMs = range(args['server-pause-ms'], [150, 350]);

function random(s: number): () => number {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const clock = (): number => (performance.now() - t0) / 1000;

// --- the server ----------------------------------------------------------------------------------

let server: ChildProcess | null = null;
const serverLog: string[] = [];
async function startServer(): Promise<string> {
  if (args.url) return args.url;
  const port = 20000 + Math.floor(Math.random() * 30000);
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', MB_NO_LIMITS: '1', MB_ANY_BUILD: '1' };
  if (args.fast === '1') env.MB_FAST = '1';
  // One process (no tsx wrapper), so that a pause (--server-pause-every) stops the server itself.
  server = spawn(process.execPath, ['--import', 'tsx', join(root, 'server/src/index.ts')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = (d: Buffer): void => {
    for (const line of d.toString().split('\n')) if (line.trim()) serverLog.push(`[${clock().toFixed(1)}] ${line}`);
  };
  server.stdout?.on('data', take);
  server.stderr?.on('data', take);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) return url;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`the server did not start:\n${serverLog.join('\n')}`);
}

// --- one headless player -------------------------------------------------------------------------

interface Correction {
  t: number;
  /** How far the drawn body jumped at this snapshot (meters). */
  jump: number;
  /** Component of the jump against the body's motion (positive: pulled back). */
  back: number;
  drops: number;
  covered: number;
  pending: number;
  /** Milliseconds since the previous snapshot. */
  gap: number;
  speed: number;
  stage: number;
  phase: string;
  onMound: boolean;
  stun: number;
  /** City or knock events that arrived in the last half second near the body. */
  recent: string[];
  /** A monster's action and phase in the snapshot, and its nerve; '' for a unit. */
  action: string;
  nerve: number;
  wait: number;
}

interface Probe {
  name: string;
  role: 'army' | 'kaiju';
  client: GameClient;
  corrections: Correction[];
  snapshots: number;
  inputs: number;
  /** Inputs the server said it played on a guess / dropped (from the pong), newest. */
  guessed: number;
  dropped: number;
  wait: number;
  maxWait: number;
  ping: number[];
  recent: Array<{ at: number; text: string; x: number; z: number }>;
  /** Meters the predicted body moved, and seconds of play. */
  walked: number;
  played: number;
  /** Page freezes made (--freeze-every). */
  freezes: Array<{ at: number; ms: number }>;
  stop(): void;
}

function makeProbe(name: string, role: 'army' | 'kaiju', url: string, index: number): Probe {
  const rnd = random(seed * 977 + index * 31);
  const client = new GameClient({ origin: url, token: `probe_${index}_${Math.floor(Math.random() * 1e9)}`, now: () => performance.now(), reload: () => false, admitted: () => undefined });
  const probe: Probe = { name, role, client, corrections: [], snapshots: 0, inputs: 0, guessed: 0, dropped: 0, wait: 0, maxWait: 0, ping: [], recent: [], walked: 0, played: 0, freezes: [], stop: () => undefined };
  let session: MatchSession | null = null;
  let loop: NodeJS.Timeout | null = null;
  const ticker = new InputTicker();
  let lastFrame = 0;
  let lastSnapAt = 0;
  /** The jump the snapshots of the current frame add up to, and the newest record of it. */
  const net: { x: number; z: number; snap: number; record: Correction | null } = { x: 0, z: 0, snap: 0, record: null };
  const flushJump = (): void => {
    if (net.record) probe.corrections.push(net.record);
    net.x = 0;
    net.z = 0;
    net.snap = 0;
    net.record = null;
  };
  // The walk: where it looks and where it wants to go, re-planned every few seconds.
  let aimYaw = rnd() * Math.PI * 2;
  let wantYaw = aimYaw;
  let plan = 0;
  let mode: 'walk' | 'strafe' | 'stand' | 'back' = 'walk';
  let side = 1;
  let buttons = 0;
  let holdUntil = 0;
  // Page freezes (--freeze-every): no frames, and nothing received is handled until it ends.
  let frozen = false;
  const held: Array<() => void> = [];
  let nextFreeze = freezeEvery > 0 ? 10 + rnd() * freezeEvery : Number.POSITIVE_INFINITY;

  client.events.on('session', (s) => {
    session = s;
    // A frozen page handles nothing: what arrives meanwhile waits for the next frame.
    const realSnapshot = s.handleSnapshot.bind(s);
    const realEvents = s.handleEvents.bind(s);
    s.handleSnapshot = (bytes: Uint8Array, now: number) => {
      if (frozen) held.push(() => recordSnapshot(bytes, performance.now() / 1000));
      else recordSnapshot(bytes, now);
    };
    s.handleEvents = (events: SimEvent[], now: number) => {
      if (frozen) held.push(() => recordEvents(events, performance.now() / 1000));
      else recordEvents(events, now);
    };
    const original = realSnapshot;
    const recordSnapshot = (bytes: Uint8Array, now: number): void => {
      const p = s.predictor;
      const ready = p.ready;
      const ex = p.errX;
      const ez = p.errZ;
      const key = (s as unknown as { predictedKey: string }).predictedKey;
      original(bytes, now);
      probe.snapshots++;
      const gap = lastSnapAt > 0 ? (now - lastSnapAt) * 1000 : 0;
      lastSnapAt = now;
      const snap = s.latest;
      if (!snap || !ready || !p.ready || key !== (s as unknown as { predictedKey: string }).predictedKey) return;
      // Snapshots handled in the same frame (a burst after a stall) make one visible jump: add
      // them up, and record the sum when the frame comes (`flushJump`).
      net.x += p.errX - ex;
      net.z += p.errZ - ez;
      if (p.lastCorrection > 12) net.snap = Math.max(net.snap, p.lastCorrection);
      const jx = net.x;
      const jz = net.z;
      const jump = Math.max(Math.hypot(jx, jz), net.snap);
      if (jump < 0.005) return;
      const v = Math.hypot(p.body.vx, p.body.vz);
      const back = v > 0.3 ? (jx * p.body.vx + jz * p.body.vz) / v : 0;
      const ack = readAck(snap.ackSeq);
      const body = localBody(s);
      const recent = probe.recent.filter((r) => now - r.at < 0.5 && (!body || Math.hypot(r.x - body.x, r.z - body.z) < 60)).map((r) => r.text);
      net.record = {
        t: clock(),
        jump,
        back,
        drops: ack.drops,
        covered: p.covered,
        pending: p.pending.length,
        gap,
        speed: v,
        stage: snap.match.stage,
        phase: snap.match.phase,
        onMound: body ? moundHeightAt(s.mirror.query, p.body.x, p.body.z) > 0 : false,
        stun: body && 'stun' in body ? (body as SnapUnit).stun : 0,
        recent,
        wait: probe.wait,
        action: body && 'phase' in body ? `${(body as { action: string }).action}/${(body as { phase: string }).phase}` : '',
        nerve: body && 'nerve' in body ? (body as { nerve: number }).nerve : 0,
      };
    };
    const recordEvents = (events: SimEvent[], now: number): void => {
      const body = localBody(s);
      for (const e of events) noteEvent(e, now, s, body);
      realEvents(events, now);
    };
  });

  function noteEvent(e: SimEvent, now: number, s: MatchSession, body: { x: number; z: number } | null): void {
    const city = s.mirror.city;
    let x = Number.NaN;
    let z = Number.NaN;
    let text = '';
    switch (e.type) {
      case 'structureStage':
        x = city.structures[e.id]?.x ?? Number.NaN;
        z = city.structures[e.id]?.z ?? Number.NaN;
        text = `structure ${e.id} stage ${e.stage}`;
        break;
      case 'structureFall':
        x = e.x;
        z = e.z;
        text = `structure ${e.id} ${e.phase}`;
        break;
      case 'unitStunned':
        text = `unit ${e.unit} stunned${e.knockdown ? ' (knocked down)' : ''}`;
        if (body) {
          x = body.x;
          z = body.z;
        }
        break;
      case 'stageChange':
        text = `stage ${e.stage}`;
        if (body) {
          x = body.x;
          z = body.z;
        }
        break;
      case 'kaijuAction':
        if (e.phase === 'active' || e.phase === 'stumble') {
          x = e.x;
          z = e.z;
          text = `kaiju ${e.action} ${e.phase}`;
        }
        break;
      case 'crate':
        x = e.x;
        z = e.z;
        text = `crate ${e.phase}`;
        break;
      default:
        return;
    }
    if (text && Number.isFinite(x)) probe.recent.push({ at: now, text, x, z });
    while (probe.recent.length > 200) probe.recent.shift();
  }

  function localBody(s: MatchSession): { x: number; z: number; stun?: number } | null {
    const snap = s.latest;
    if (!snap) return null;
    if (s.role.kind === 'kaiju') return snap.kaijus[s.role.kaijuId] ?? null;
    const squad = snap.squads[s.role.squadId];
    return squad && squad.driven >= 0 ? (snap.units[squad.driven] ?? null) : null;
  }

  /** The player's hands on the keys and the mouse: walk, turn, stand, fire, now and then a volley. */
  function sample(s: MatchSession, now: number): Omit<PlayerInput, 'seq'> {
    const frame = s.frame;
    const me = s.role.kind === 'kaiju' ? frame?.localKaiju : frame?.localUnit;
    const k = frame?.kaijus[0];
    if (now > plan) {
      plan = now + 1.5 + rnd() * 3;
      const r = rnd();
      mode = r < 0.6 ? 'walk' : r < 0.75 ? 'strafe' : r < 0.88 ? 'stand' : 'back';
      side = rnd() < 0.5 ? 1 : -1;
      if (me && frame) {
        const b = frame.bounds;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const nearEdge = me.x - b.minX < 40 || b.maxX - me.x < 40 || me.z - b.minZ < 40 || b.maxZ - me.z < 40;
        // Head for the monster (where the city is being wrecked), back to the middle when near
        // the edge, otherwise anywhere.
        if (nearEdge) wantYaw = Math.atan2(cx - me.x, cz - me.z);
        else if (s.role.kind !== 'kaiju' && k && rnd() < 0.6) wantYaw = Math.atan2(k.x - me.x, k.z - me.z) + (rnd() - 0.5) * 1.6;
        else wantYaw = rnd() * Math.PI * 2;
      }
      if (s.role.kind === 'kaiju') buttons = rnd() < 0.3 ? (rnd() < 0.5 ? Btn.strike : Btn.stomp) : 0;
      else buttons = rnd() < 0.35 ? Btn.fire : rnd() < 0.15 ? Btn.volley : 0;
      holdUntil = now + (buttons === Btn.volley ? 1 + rnd() * 1.5 : 0.2 + rnd() * 2);
    }
    if (now > holdUntil) buttons = 0;
    // The mouse: turns toward where it wants to look at up to 2.5 rad/s, with a little shake.
    let d = wantYaw - aimYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    aimYaw += Math.max(-2.5 * (1 / 30), Math.min(2.5 * (1 / 30), d)) + (rnd() - 0.5) * 0.01;
    const move = mode === 'walk' ? { x: 0, z: 1 } : mode === 'strafe' ? { x: side, z: 0.3 } : mode === 'back' ? { x: 0, z: -1 } : { x: 0, z: 0 };
    return { moveX: move.x, moveZ: move.z, aimYaw, aimPitch: 0, buttons };
  }

  const frame = (): void => {
    if (frozen) {
      frozen = false;
      for (const f of held.splice(0)) f();
    }
    flushJump();
    if (clock() > nextFreeze) {
      nextFreeze = clock() + freezeEvery * (0.75 + rnd() * 0.5);
      const ms = freezeMs[0] + rnd() * (freezeMs[1] - freezeMs[0]);
      probe.freezes.push({ at: clock(), ms: Math.round(ms) });
      frozen = true;
      loop = setTimeout(frame, ms);
      return;
    }
    const now = performance.now() / 1000;
    const dt = lastFrame > 0 ? now - lastFrame : 1 / 60;
    lastFrame = now;
    const s = session;
    if (s && client.session === s) {
      s.sample(now, dt);
      const ticks = ticker.advance(dt);
      const playing = s.latest?.match.phase === 'playing';
      if (playing) probe.played += dt;
      for (let i = 0; i < ticks; i++) {
        const bx = s.predictor.body.x;
        const bz = s.predictor.body.z;
        const input = sample(s, now);
        if (!playing) {
          input.moveX = 0;
          input.moveZ = 0;
          input.buttons = 0;
        }
        s.tickInput(input, now);
        probe.inputs++;
        if (playing) probe.walked += Math.hypot(s.predictor.body.x - bx, s.predictor.body.z - bz);
      }
      s.refreshLocal(ticker.alpha);
    }
    // About 60 frames a second, like a browser, with the timer's own unevenness.
    loop = setTimeout(frame, 16 + (rnd() < 0.02 ? 10 : 0));
  };
  loop = setTimeout(frame, 16);
  probe.stop = () => {
    if (loop) clearTimeout(loop);
    loop = null;
  };
  return probe;
}

// --- the run -------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const serverUrl = await startServer();
  const target = new URL(serverUrl);
  const [delayMin, delayMax] = range(args.delay, [30, 80]);
  const [stallMin, stallMax] = range(args['stall-ms'], [150, 400]);
  const relay =
    relayMode === 'none'
      ? null
      : await startRelay({
          listenPort: 0,
          targetHost: target.hostname,
          targetPort: Number(target.port),
          delayMin,
          delayMax,
          jitter: Number(args.jitter ?? 15),
          stallEvery: Number(args['stall-every'] ?? 20),
          stallMin,
          stallMax,
          seed,
          now: clock,
        });
  const url = relay ? `http://127.0.0.1:${relay.port}` : serverUrl;
  console.log(`netprobe: server ${serverUrl}, players through ${relay ? `the relay (${delayMin}-${delayMax} ms each way)` : 'no relay'}`);

  const probes: Probe[] = [];
  const total = armyPlayers + (withKaiju ? 1 : 0);
  for (let i = 0; i < total; i++) {
    const role = withKaiju && i === 0 ? 'kaiju' : 'army';
    const p = makeProbe(`${role}${i}`, role, url, i);
    probes.push(p);
    if (i === 0) await p.client.create(p.name);
    else await p.client.join(probes[0].client.code, p.name);
    await sleep(300);
  }
  // Pings for the readout's numbers: once a second, with the server's view of the inputs.
  const pongs = setInterval(() => {
    for (const p of probes) p.client.send('ping', { t: performance.now() });
  }, 1000);
  for (const p of probes) {
    const link = (p.client as unknown as { link: { on: (t: 'pong', h: (m: { t: number; wait?: number; guessed?: number; dropped?: number }) => void) => void } | null }).link;
    link?.on('pong', (m) => {
      p.ping.push(performance.now() - m.t);
      if (m.wait !== undefined) {
        p.wait = m.wait;
        p.maxWait = Math.max(p.maxWait, m.wait);
      }
      if (m.guessed !== undefined) p.guessed = m.guessed;
      if (m.dropped !== undefined) p.dropped = m.dropped;
    });
  }
  const host = probes[0].client;
  for (const p of probes) p.client.send('setRole', { wantsKaiju: p.role === 'kaiju' });
  if (!withKaiju) host.send('setOptions', { botKaiju: true });
  await sleep(500);
  for (const p of probes) p.client.send('ready', { ready: true });
  await sleep(500);
  host.send('start', {});
  const began = clock();
  const pauses: Array<{ at: number; ms: number }> = [];
  let pauseTimer: NodeJS.Timeout | null = null;
  if (pauseEvery > 0 && server?.pid) {
    const pid = server.pid;
    const rnd = random(seed + 5);
    const plan = (): void => {
      pauseTimer = setTimeout(() => {
        const ms = pauseMs[0] + rnd() * (pauseMs[1] - pauseMs[0]);
        pauses.push({ at: clock(), ms: Math.round(ms) });
        process.kill(pid, 'SIGSTOP');
        setTimeout(() => process.kill(pid, 'SIGCONT'), ms);
        plan();
      }, pauseEvery * (0.75 + rnd() * 0.5) * 1000);
    };
    plan();
  }
  while (clock() - began < secs) {
    await sleep(1000);
    const phase = host.session?.latest?.match.phase;
    if (host.lobby?.phase === 'end' || phase === 'ended') break;
  }
  clearInterval(pongs);
  if (pauseTimer) clearTimeout(pauseTimer);
  for (const p of probes) p.stop();
  for (const p of probes) p.client.leave();
  await sleep(300);
  await relay?.close();
  server?.kill('SIGTERM');

  // --- the report ----------------------------------------------------------------------------
  const lines: string[] = [];
  const report = { args, secs: clock() - began, stalls: relay?.stalls ?? [], players: [] as unknown[] };
  for (const p of probes) {
    const c = p.corrections;
    const big = c.filter((x) => x.jump >= 0.15);
    const network = (x: Correction): boolean => x.drops > 0 || x.covered > 0 || x.gap > 150;
    const gameBig = big.filter((x) => !network(x));
    const ping = p.ping.slice().sort((a, b) => a - b);
    const minutes = (clock() - began) / 60;
    lines.push(
      `${p.name}: ${p.snapshots} snapshots, ${p.inputs} inputs, ${p.played.toFixed(0)} s of play, walked ${p.walked.toFixed(0)} m; corrections over 15 cm: ${big.length} (${(big.length / minutes).toFixed(1)}/min), ` +
        `${gameBig.length} with no network cause; largest ${Math.max(0, ...c.map((x) => x.jump)).toFixed(2)} m; ` +
        `ping median ${ping[Math.floor(ping.length / 2)]?.toFixed(0)} ms, max ${ping[ping.length - 1]?.toFixed(0)} ms; ` +
        `server: ${p.guessed} guessed ticks, ${p.dropped} dropped inputs, waiting now ${p.wait}, at most ${p.maxWait}`,
    );
    for (const x of big.slice().sort((a, b) => b.jump - a.jump).slice(0, 12)) {
      lines.push(
        `   t=${(x.t - began).toFixed(1)} jump ${x.jump.toFixed(2)} m (back ${x.back.toFixed(2)}) drops ${x.drops} covered ${x.covered} pending ${x.pending} gap ${x.gap.toFixed(0)} ms ` +
          `speed ${x.speed.toFixed(1)} stage ${x.stage} ${x.phase}${x.action ? ` ${x.action} nerve ${x.nerve.toFixed(1)}` : ''}${x.onMound ? ' on rubble' : ''}${x.stun > 0 ? ' stunned' : ''}${x.recent.length ? ` [${x.recent.join('; ')}]` : ''}`,
      );
    }
    // Second by second: the sum of the corrections, so anything periodic stands out.
    const perSecond: number[] = [];
    for (const x of c) perSecond[Math.floor(x.t - began)] = (perSecond[Math.floor(x.t - began)] ?? 0) + x.jump;
    const row = Array.from(perSecond, (v) => (v === undefined ? '.' : v < 0.05 ? '.' : v < 0.15 ? 'o' : v < 0.5 ? 'O' : '#')).join('');
    for (let i = 0; i < row.length; i += 60) lines.push(`   ${String(i).padStart(4)} s  ${row.slice(i, i + 60)}`);
    report.players.push({ name: p.name, snapshots: p.snapshots, inputs: p.inputs, guessed: p.guessed, dropped: p.dropped, maxWait: p.maxWait, ping, corrections: c });
  }
  const when = (list: Array<{ at: number; ms: number }>): string => list.map((s) => `${(s.at - began).toFixed(0)} s (${s.ms} ms)`).join(', ');
  if (relay) lines.push(`relay stalls at: ${when(relay.stalls)}`);
  if (pauses.length) lines.push(`server paused at: ${when(pauses)}`);
  for (const p of probes) if (p.freezes.length) lines.push(`${p.name} froze at: ${when(p.freezes)}`);
  const slow = serverLog.filter((l) => l.includes('slow moment') || l.includes('stopped arriving'));
  lines.push(`server slow-moment lines: ${slow.length}`);
  for (const l of slow.slice(0, 20)) lines.push(`   ${l}`);
  console.log(lines.join('\n'));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(out, 'report.txt'), lines.join('\n'));
  writeFileSync(join(out, 'server.log'), serverLog.join('\n'));
  process.exit(0);
}

process.once('SIGINT', () => {
  server?.kill('SIGTERM');
  process.exit(1);
});
main().catch((err) => {
  console.error(err);
  server?.kill('SIGTERM');
  process.exit(1);
});
