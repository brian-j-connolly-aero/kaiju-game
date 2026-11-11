/**
 * `window.__mb`: the automation hook for playtests and debugging (ARCHITECTURE.md section 5).
 * It exposes the client's state as plain data, the renderer's draw statistics, and a few
 * helpers. Nothing in the game depends on it.
 */

import type { AppContext, ScreenId } from './context';

export interface MbState {
  screen: ScreenId;
  booted: boolean;
  /** Uncaught errors and unhandled rejections seen by the page. */
  errors: string[];
  link: string;
  code: string;
  seat: number;
  host: boolean;
  ping: number;
  lobby: { phase: string; players: number; ready: number } | null;
  role: string;
  playerId: number;
  controller: string;
  match: {
    phase: string;
    stage: number;
    clock: number;
    barPoints: number;
    marks: number[];
    marksReached: number;
    winner: string;
    endReason: string;
    tick: number;
  } | null;
  kaiju: { x: number; z: number; hp: number; stage: number; phase: string; action: string; rage: number; nerve: number; known: boolean } | null;
  me: { x: number; z: number; hp: number; alive: boolean } | null;
  unitsAlive: number;
  events: Record<string, number>;
  net: { snapshots: number; events: number; inputs: number; pending: number; correction: number; predicting: boolean } | null;
  /** `ms`: script time per frame, smoothed; `fps`: frames actually shown per second. */
  frame: { ms: number; maxMs: number; count: number; fps: number };
  result: { winner: string; reason: string; duration: number } | null;
  /** Matches this page has seen end, and how the last of them ended (kept after the room returns to its lobby). */
  matchesEnded: number;
  lastResult: { winner: string; reason: string; duration: number } | null;
}

export interface MbHook {
  version: number;
  state(): MbState;
  renderer: { info(): { calls: number; triangles: number; sprites: number; particles: number; chunks: number; projectiles: number; props: number } };
  assets(): unknown;
  /** The app's services, for poking at from a console or a test. Not a stable interface. */
  internals: { ctx: AppContext };
  helpers: {
    /** Drops the socket as a lost network would, to exercise reconnection. */
    dropConnection(): void;
    /** A picture of the 3D view as a data address (taken straight after the next frame). */
    screenshot(): Promise<string>;
    setMuted(muted: boolean): void;
    toggleCamera(): void;
  };
}

export interface HookSource {
  ctx: AppContext;
  screen(): ScreenId;
  booted(): boolean;
  errors: string[];
  frameStats: { ms: number; maxMs: number; count: number; fps: number };
  /** Runs once after the next frame has been drawn. */
  afterFrame(fn: () => void): void;
}

export function installHook(source: HookSource): MbHook {
  const { ctx } = source;
  const hook: MbHook = {
    version: 1,
    state() {
      const client = ctx.client;
      const runtime = ctx.runtime;
      const session = runtime?.session ?? null;
      const frame = runtime?.frame ?? null;
      const m = frame?.match ?? session?.latest?.match ?? null;
      const k = frame?.kaijus[0] ?? null;
      const me = frame?.localKaiju ?? frame?.localUnit ?? null;
      return {
        screen: source.screen(),
        booted: source.booted(),
        errors: source.errors.slice(),
        link: client.status,
        code: client.code,
        seat: client.seat,
        host: client.isHost(),
        ping: Math.round(client.ping),
        lobby: client.lobby
          ? { phase: client.lobby.phase, players: client.lobby.players.length, ready: client.lobby.players.filter((p) => p.ready).length }
          : null,
        role: session ? session.role.kind : 'none',
        playerId: session ? session.role.playerId : -1,
        controller: runtime ? runtime.controller.kind : 'none',
        match: m
          ? {
              phase: m.phase,
              stage: m.stage,
              clock: m.clock,
              barPoints: m.barPoints,
              marks: [...m.marks],
              marksReached: m.marksReached,
              winner: m.winner,
              endReason: m.endReason,
              tick: session?.latest?.tick ?? 0,
            }
          : null,
        kaiju: k ? { x: k.x, z: k.z, hp: k.hp, stage: k.stage, phase: k.phase, action: k.action, rage: k.rage, nerve: k.nerve, known: k.known } : null,
        me: me ? { x: me.x, z: me.z, hp: me.hp, alive: me.alive } : null,
        unitsAlive: frame ? frame.units.filter((u) => u.alive).length : 0,
        events: runtime ? { ...runtime.eventCounts } : {},
        net: session
          ? {
              snapshots: session.stats.snapshots,
              events: session.stats.events,
              inputs: session.stats.inputs,
              pending: session.predictor.pending.length,
              correction: session.predictor.lastCorrection,
              predicting: session.predictor.ready && session.mirror.trusted,
            }
          : null,
        frame: { ...source.frameStats },
        result: runtime?.result ? { winner: runtime.result.winner, reason: runtime.result.reason, duration: runtime.result.duration } : null,
        matchesEnded: ctx.matchesEnded,
        lastResult: ctx.lastResult,
      };
    },
    renderer: {
      info() {
        const s = ctx.renderer?.stats;
        return s ? { ...s } : { calls: 0, triangles: 0, sprites: 0, particles: 0, chunks: 0, projectiles: 0, props: 0 };
      },
    },
    assets() {
      return ctx.assets.report();
    },
    internals: { ctx },
    helpers: {
      dropConnection() {
        ctx.client.simulateDrop();
      },
      screenshot() {
        return new Promise((resolve) => {
          source.afterFrame(() => {
            try {
              resolve(ctx.renderer ? ctx.renderer.renderer.domElement.toDataURL('image/png') : '');
            } catch {
              resolve('');
            }
          });
        });
      },
      setMuted(muted) {
        ctx.audio.setMuted(muted);
      },
      toggleCamera() {
        const c = ctx.runtime?.controller;
        if (c) c.thirdPerson = !c.thirdPerson;
      },
    },
  };
  (window as unknown as { __mb: MbHook }).__mb = hook;
  return hook;
}
