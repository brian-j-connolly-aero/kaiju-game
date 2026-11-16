/**
 * The network readout: a small hidden panel for finding out why a player's own body snaps back
 * (docs/PLAYTEST.md, docs/HOSTING.md). The ` key (left of 1, under Escape) shows and hides it on
 * every screen; it is off by default and is a tool for the host, not part of the game, so it may
 * show numbers. While it is open the page pings the server four times a second.
 *
 * It shows, over the last 30 seconds:
 *   - the round trip to the server and back (now, and the worst);
 *   - the gap between snapshots (they should come every 67 ms; a long gap is a stall on the line
 *     or a server that stood still);
 *   - the inputs waiting at the server and those not yet played (in flight or waiting);
 *   - the ticks the server played on a guess because an input was late, and the inputs it
 *     dropped (from the server's own count, `ServerInputs`), and the drops the newest snapshot
 *     announced;
 *   - the corrections of the player's own body (`Predictor.lastJump`): the last, the worst, and
 *     how many were over 15 cm;
 *   - this page's own frame time: a long frame is the page freezing, not the network.
 * And a rolling graph: a bar per correction (green under 15 cm, amber under 50 cm, red above),
 * the snapshot gaps as a blue line, and frames over 100 ms as purple marks at the bottom, so
 * that a snap and what came with it stand out.
 */

import type { GameClient } from '../net/gameClient';
import type { NetSample } from '../net/matchSession';

/** The key that shows and hides the panel (KeyboardEvent.code). */
export const NET_READOUT_KEY = 'Backquote';
/** Seconds of history shown. */
export const NET_WINDOW = 30;
/** A correction at least this big counts as a visible snap, meters. */
export const SNAP_VISIBLE = 0.15;
/** A frame longer than this is a freeze of the page, milliseconds. */
const LONG_FRAME_MS = 100;
/** Pings while the panel is open, milliseconds apart. */
const FAST_PING_MS = 250;

/** What the panel says, worked out from the histories (pure, so it can be tested). */
export interface NetSummary {
  rtt: number;
  rttWorst: number;
  gap: number;
  gapWorst: number;
  /** Inputs not yet played by the server (in flight or waiting), from the newest snapshot. */
  pending: number;
  /** Drops the newest snapshot announced. */
  drops: number;
  jumpLast: number;
  jumpWorst: number;
  /** Corrections of SNAP_VISIBLE or more. */
  snaps: number;
  frameWorst: number;
  longFrames: number;
}

/** Summarizes the last NET_WINDOW seconds before `now` (seconds, the session's clock). */
export function summarizeNet(net: readonly NetSample[], pings: readonly TimedValue[], frames: readonly TimedValue[], now: number): NetSummary {
  const from = now - NET_WINDOW;
  const s: NetSummary = { rtt: 0, rttWorst: 0, gap: 0, gapWorst: 0, pending: 0, drops: 0, jumpLast: 0, jumpWorst: 0, snaps: 0, frameWorst: 0, longFrames: 0 };
  for (const p of pings) {
    if (p.at < from) continue;
    s.rtt = p.value;
    s.rttWorst = Math.max(s.rttWorst, p.value);
  }
  for (const n of net) {
    if (n.at < from) continue;
    s.gap = n.gap;
    s.gapWorst = Math.max(s.gapWorst, n.gap);
    s.pending = n.pending;
    s.drops = n.drops;
    if (n.jump > 0.005) s.jumpLast = n.jump;
    s.jumpWorst = Math.max(s.jumpWorst, n.jump);
    if (n.jump >= SNAP_VISIBLE) s.snaps++;
  }
  for (const f of frames) {
    if (f.at < from) continue;
    s.frameWorst = Math.max(s.frameWorst, f.value);
    if (f.value >= LONG_FRAME_MS) s.longFrames++;
  }
  return s;
}

export interface TimedValue {
  /** Seconds. */
  at: number;
  value: number;
}

/** Keeps the entries of the last NET_WINDOW seconds. */
function trim(list: TimedValue[], now: number): void {
  while (list.length > 0 && list[0].at < now - NET_WINDOW) list.shift();
}

const PANEL_STYLE = [
  'position:fixed',
  'left:8px',
  'top:96px',
  'z-index:30',
  'margin:0',
  'padding:6px 8px',
  'background:rgba(0,0,0,0.78)',
  'border-radius:6px',
  'color:#d6f5ff',
  'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace',
  'pointer-events:none',
  'white-space:pre',
].join(';');

const GRAPH_W = 300;
const GRAPH_H = 64;

export class NetReadout {
  readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private visible = false;
  private readonly pings: TimedValue[] = [];
  private readonly frames: TimedValue[] = [];
  /** The server's counts at the start of the window: guessed and dropped since then. */
  private readonly serverCounts: Array<{ at: number; guessed: number; dropped: number }> = [];
  private lastPongAt = 0;
  private since = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'net-readout';
    this.root.setAttribute('style', PANEL_STYLE);
    this.root.hidden = true;
    this.text = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.width = GRAPH_W;
    this.canvas.height = GRAPH_H;
    this.canvas.setAttribute('style', `display:block;margin-top:4px;width:${GRAPH_W}px;height:${GRAPH_H}px;background:rgba(255,255,255,0.06)`);
    const legend = document.createElement('div');
    legend.textContent = 'bars: corrections (green <15 cm, amber <50 cm, red)\nblue: snapshot gaps (500 ms at the top)\npurple: this page froze';
    legend.setAttribute('style', 'margin-top:2px;font-size:10px;opacity:0.75');
    this.root.append(this.text, this.canvas, legend);
    window.addEventListener('keydown', (e) => {
      if (e.code !== NET_READOUT_KEY || e.repeat) return;
      const target = e.target as HTMLElement | null;
      // Typing a name or a room code is not a request for the readout.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      this.toggle();
    });
  }

  get shown(): boolean {
    return this.visible;
  }

  toggle(on = !this.visible): void {
    this.visible = on;
    this.root.hidden = !on;
    this.since = Number.POSITIVE_INFINITY;
  }

  /**
   * Once per frame. `frameMs` is how long the previous frame took (the time between frames),
   * `now` the local time in seconds (the session's clock).
   */
  update(client: GameClient, frameMs: number, now: number): void {
    // Frames are counted even while hidden, so the panel shows the freezes that came before it opened.
    this.frames.push({ at: now, value: frameMs });
    trim(this.frames, now);
    client.pingEvery = this.visible ? FAST_PING_MS : 2000;
    if (!this.visible) return;
    if (client.pongAt > this.lastPongAt) {
      this.lastPongAt = client.pongAt;
      this.pings.push({ at: now, value: client.pingLast });
      trim(this.pings, now);
    }
    const server = client.serverInputs;
    if (server) {
      const counts = this.serverCounts;
      if (counts.length === 0 || now - counts[counts.length - 1].at >= 1) counts.push({ at: now, guessed: server.guessed, dropped: server.dropped });
      while (counts.length > 1 && counts[0].at < now - NET_WINDOW) counts.shift();
    }
    this.since += frameMs / 1000;
    if (this.since < 0.2) return;
    this.since = 0;
    const session = client.session;
    const net = session ? session.net : [];
    const s = summarizeNet(net, this.pings, this.frames, now);
    const lines = [
      `network  (\` hides)        last ${NET_WINDOW} s`,
      `round trip   ${ms(s.rtt)}   worst ${ms(s.rttWorst)}`,
      `snapshots    gap ${ms(s.gap)}   worst ${ms(s.gapWorst)}`,
      session ? `inputs       ${server ? `${server.wait} waiting at server, ` : ''}${s.pending} not played yet` : 'inputs       (not in a match)',
    ];
    if (server && this.serverCounts.length > 0) {
      const first = this.serverCounts[0];
      lines.push(`late         ${server.guessed - first.guessed} guessed, ${server.dropped - first.dropped} dropped   (match: ${server.guessed}, ${server.dropped})`);
    }
    lines.push(
      `correction   last ${meters(s.jumpLast)}   worst ${meters(s.jumpWorst)}   ${s.snaps} over ${SNAP_VISIBLE * 100} cm${s.drops > 0 ? `   drops ${s.drops}` : ''}`,
      `this page    worst frame ${ms(s.frameWorst)}   ${s.longFrames} over ${LONG_FRAME_MS} ms`,
    );
    this.text.textContent = lines.join('\n');
    this.draw(net, now);
  }

  /** The rolling graph: corrections as bars, snapshot gaps as a line, long frames as marks. */
  private draw(net: readonly NetSample[], now: number): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, GRAPH_W, GRAPH_H);
    const x = (at: number): number => GRAPH_W - ((now - at) / NET_WINDOW) * GRAPH_W;
    // The 15 cm line, so a snap is easy to tell from drift.
    const snapY = GRAPH_H - 6 - Math.sqrt(SNAP_VISIBLE / 2) * (GRAPH_H - 10);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(0, snapY);
    g.lineTo(GRAPH_W, snapY);
    g.stroke();
    // Snapshot gaps: 0 at the bottom, 500 ms at the top.
    g.strokeStyle = 'rgba(110,170,255,0.9)';
    g.beginPath();
    let started = false;
    for (const n of net) {
      if (n.at < now - NET_WINDOW) continue;
      const y = GRAPH_H - 6 - Math.min(1, n.gap / 500) * (GRAPH_H - 10);
      if (started) g.lineTo(x(n.at), y);
      else g.moveTo(x(n.at), y);
      started = true;
    }
    g.stroke();
    // Corrections: the bar's height grows with the square root of the jump (2 m reaches the top).
    for (const n of net) {
      if (n.at < now - NET_WINDOW || n.jump < 0.01) continue;
      const h = Math.max(2, Math.min(1, Math.sqrt(n.jump / 2)) * (GRAPH_H - 10));
      g.fillStyle = n.jump < SNAP_VISIBLE ? '#5fd38a' : n.jump < 0.5 ? '#ffc34d' : '#ff5a4d';
      g.fillRect(x(n.at) - 1, GRAPH_H - 6 - h, 3, h);
    }
    // The page's own freezes.
    g.fillStyle = '#d27bff';
    for (const f of this.frames) {
      if (f.value >= LONG_FRAME_MS && f.at >= now - NET_WINDOW) g.fillRect(x(f.at) - 1, GRAPH_H - 5, 3, 5);
    }
  }
}

function ms(v: number): string {
  return `${Math.round(v)} ms`.padStart(6);
}

function meters(v: number): string {
  return `${v.toFixed(2)} m`;
}
