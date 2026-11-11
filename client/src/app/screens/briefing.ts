/**
 * Briefing: the few seconds before play. The camera circles down onto the starting
 * neighborhood, the player's side is shown as a portrait with the names of everyone in the
 * match, and the voiced briefing plays with subtitles (the simulation sends it as a voice cue).
 */

import { kaijuKindDef } from '@mb/shared';
import { el, icon, portrait } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

export class BriefingScreen implements Screen {
  readonly id = 'briefing' as const;
  private root: HTMLElement | null = null;
  private time = 0;

  enter(ctx: AppContext): void {
    const runtime = ctx.runtime;
    if (!runtime) return;
    const session = runtime.session;
    const players = session.config.players;
    const kaijuSlot = players[0];
    const isKaiju = session.role.kind === 'kaiju';
    const mySlot = players[session.role.playerId];
    const portraitId = isKaiju ? `portrait_${kaijuSlot.kaijuKind}` : `portrait_${mySlot ? mySlot.faction : 'army'}`;

    const sides = el('div', 'briefing-sides', [
      el('div', 'briefing-side kaiju', [
        icon('lb_kaiju', 'side-icon'),
        el('div', 'side-name', [kaijuKindDef(kaijuSlot.kaijuKind).name]),
        el('div', 'side-player', [kaijuSlot.bot ? icon('lb_bot') : '', kaijuSlot.bot ? '' : kaijuSlot.name]),
      ]),
      el(
        'div',
        'briefing-side humans',
        players.slice(1).map((p) =>
          el('div', `side-squad${p.id === session.role.playerId ? ' me' : ''}`, [icon(p.bot ? 'lb_bot' : 'lb_human'), el('span', '', [p.bot ? p.callsign : p.name])]),
        ),
      ),
    ]);
    this.root = el('div', 'screen briefing', [el('div', 'briefing-portrait', [portrait(portraitId, isKaiju ? 'lb_kaiju' : 'fac_army')]), sides]);
    ctx.ui.append(this.root);
    this.time = 0;
    runtime.cinematic.cut();
  }

  frame(ctx: AppContext, dt: number): void {
    const runtime = ctx.runtime;
    if (!runtime) return;
    this.time += dt;
    const k = runtime.frame?.kaijus[0];
    const anchor = runtime.session.mirror.city.anchors[runtime.session.welcome.anchor];
    const x = k ? k.x : anchor ? anchor.x : 0;
    const z = k ? k.z : anchor ? anchor.z : 0;
    // Circle down from above the neighborhood toward street level.
    const t = Math.min(1, this.time / 8);
    runtime.shot = { x, y: 3, z, radius: 150 - t * 105, height: 90 - t * 72, speed: 0.22 };
  }

  exit(ctx: AppContext): void {
    if (ctx.runtime) ctx.runtime.shot = null;
    this.root?.remove();
    this.root = null;
  }
}
