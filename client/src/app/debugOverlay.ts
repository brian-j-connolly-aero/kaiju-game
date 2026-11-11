/** The `?debug=1` overlay: frame time, draw calls, triangles, ping and a few counters. Not part of the game's UI. */

import type { AppContext } from './context';

export class DebugOverlay {
  readonly root: HTMLElement;
  private readonly samples: number[] = [];
  private since = 0;

  constructor() {
    this.root = document.createElement('pre');
    this.root.className = 'debug-overlay';
  }

  /** Feed every frame's duration; the text refreshes a few times a second. */
  update(ctx: AppContext, frameMs: number, dt: number, screen: string, fps: number): void {
    this.samples.push(frameMs);
    if (this.samples.length > 90) this.samples.shift();
    this.since += dt;
    if (this.since < 0.25) return;
    this.since = 0;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const max = Math.max(...this.samples);
    const stats = ctx.renderer?.stats;
    const session = ctx.runtime?.session;
    const lines = [
      `screen    ${screen}`,
      `frame     ${fps.toFixed(0)} fps; script ${avg.toFixed(1)} ms avg, ${max.toFixed(1)} ms max`,
      `draw      ${stats ? stats.calls : 0} calls, ${stats ? stats.triangles : 0} triangles`,
      `sprites   ${stats ? stats.sprites : 0}, props ${stats ? stats.props : 0}, particles ${stats ? stats.particles : 0}, chunks ${stats ? stats.chunks : 0}, projectiles ${stats ? stats.projectiles : 0}`,
      `ping      ${ctx.client.ping.toFixed(0)} ms, link ${ctx.client.status}`,
    ];
    const timing = ctx.runtime?.timing;
    if (timing) lines.push(`split     logic ${timing.logic.toFixed(1)} ms, scene ${timing.scene.toFixed(1)} ms, draw ${timing.draw.toFixed(1)} ms`);
    if (session) {
      const m = session.latest?.match;
      lines.push(
        `net       ${session.stats.snapshots} snapshots, ${session.stats.events} events, ${session.stats.inputs} inputs`,
        `predict   ${session.predictor.pending.length} pending, last correction ${session.predictor.lastCorrection.toFixed(2)} m${session.mirror.trusted ? '' : ' (OFF: city mismatch)'}`,
        m ? `match     ${m.phase} stage ${m.stage}, clock ${m.clock.toFixed(0)} s, bar ${m.barPoints.toFixed(0)} / ${m.marks.map((v) => v.toFixed(0)).join(' / ')}` : 'match     waiting for the first snapshot',
      );
    }
    this.root.textContent = lines.join('\n');
  }
}
