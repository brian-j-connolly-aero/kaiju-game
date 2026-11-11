/**
 * End screen (DESIGN.md section 8): who won and how, as pictures; a pictogram tally of what
 * each player flattened; and a newspaper front page with a photo of the match over squiggle
 * text. The mock hearing is voiced by the simulation's last voice cues and shows as subtitles.
 * The host takes everyone back to the lobby.
 */

import { TALLY_CLASSES, type MatchEndEvent, type PlayerTally, type TallyClass } from '@mb/shared';
import { el, icon } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

const REASON_ICON = { bar: 'tl_tower', kill: 'ui_skull', clock: 'ui_clock' } as const;

function tallyRow(tally: PlayerTally): HTMLElement {
  const row = el('div', 'tally-row');
  for (const cls of TALLY_CLASSES as readonly TallyClass[]) {
    const count = tally.wrecked[cls] ?? 0;
    if (count <= 0) continue;
    const group = el('div', 'tally-group');
    // A few pictograms for a few; a stack and a bar that grows with the count for many.
    const shown = Math.min(count, 5);
    for (let i = 0; i < shown; i++) group.append(icon(`tl_${cls}`, 'tally-icon'));
    if (count > shown) {
      const bar = el('div', 'tally-more');
      bar.style.width = `${Math.min(90, 6 + Math.sqrt(count - shown) * 7)}px`;
      group.append(bar);
    }
    row.append(group);
  }
  if (row.childElementCount === 0) row.append(el('div', 'tally-none'));
  return row;
}

export class EndScreen implements Screen {
  readonly id = 'end' as const;
  private root: HTMLElement | null = null;
  private built: MatchEndEvent | null = null;
  private time = 0;
  private autoSent = false;

  enter(ctx: AppContext): void {
    this.root = el('div', 'screen end');
    ctx.ui.append(this.root);
    this.built = null;
    this.time = 0;
    this.autoSent = false;
    ctx.runtime?.cinematic.cut();
    this.build(ctx);
  }

  private build(ctx: AppContext): void {
    const runtime = ctx.runtime;
    const root = this.root;
    if (!runtime || !root) return;
    const result = runtime.result;
    if (result === this.built && root.childElementCount > 0) return;
    this.built = result;
    const session = runtime.session;
    const players = session.config.players;
    const kaijuWon = result?.winner === 'kaiju';
    const iWon = result ? (session.role.kind === 'kaiju') === kaijuWon : false;

    const banner = el('div', `end-banner ${kaijuWon ? 'kaiju' : 'humans'}`, [
      icon(kaijuWon ? 'lb_kaiju' : 'lb_human', 'end-winner'),
      icon('ui_trophy', 'end-trophy'),
      result ? icon(REASON_ICON[result.reason], 'end-reason') : '',
    ]);
    if (session.role.kind !== 'spectator' && result) banner.classList.add(iWon ? 'won' : 'lost');

    const tallies = el('div', 'tallies');
    players.forEach((p, i) => {
      const tally = result?.tallies[i];
      if (!tally) return;
      tallies.append(
        el('div', `tally${i === session.role.playerId ? ' me' : ''}`, [
          icon(p.role === 'kaiju' ? 'lb_kaiju' : p.bot ? 'lb_bot' : 'lb_human', `tally-who ${p.role}`),
          el('div', 'tally-name', [p.role === 'human' && p.bot ? p.callsign : p.name]),
          tallyRow(tally),
        ]),
      );
    });

    // The front page: a masthead, the photo, and columns of squiggles for the story.
    const photo = el('div', 'paper-photo');
    if (runtime.photo) photo.style.backgroundImage = `url(${runtime.photo})`;
    else photo.append(icon('ui_newspaper'));
    const squiggles = (lines: number, cls: string): HTMLElement => {
      const col = el('div', `paper-col ${cls}`);
      for (let i = 0; i < lines; i++) col.append(el('div', 'squiggle'));
      return col;
    };
    const paper = el('div', 'paper', [
      el('div', 'paper-masthead', [el('div', 'squiggle big'), el('div', 'squiggle thin')]),
      el('div', 'paper-headline', [el('div', 'squiggle huge'), el('div', 'squiggle huge short')]),
      el('div', 'paper-body', [photo, squiggles(9, 'narrow')]),
      el('div', 'paper-foot', [squiggles(4, ''), squiggles(4, ''), squiggles(4, '')]),
    ]);

    const back = el('button', 'btn btn-big end-back', [icon('lb_back')]);
    back.addEventListener('click', () => {
      ctx.audio.play('ui_click');
      ctx.client.send('toLobby', {});
    });
    back.classList.toggle('hidden', !ctx.client.isHost());

    root.replaceChildren(banner, el('div', 'end-mid', [tallies, paper]), back);
  }

  frame(ctx: AppContext, dt: number): void {
    const runtime = ctx.runtime;
    if (!runtime) return;
    this.time += dt;
    // The result can arrive a moment after the screen (a late joiner gets it with the snapshot).
    if (runtime.result !== this.built) this.build(ctx);
    const k = runtime.frame?.kaijus[0];
    const b = runtime.frame?.bounds;
    const x = k ? k.x : b ? (b.minX + b.maxX) / 2 : 0;
    const z = k ? k.z : b ? (b.minZ + b.maxZ) / 2 : 0;
    const stage = runtime.frame?.match.stage ?? 1;
    runtime.shot = { x, y: 4 * stage * stage, z, radius: 40 + 70 * stage * stage * 0.5, height: 22 + 40 * (stage - 1) * stage * 0.5, speed: 0.12 };
    if (ctx.audio.music === 'win_humans' || ctx.audio.music === 'win_kaiju') {
      if (this.time > 14) ctx.audio.playMusic(['hearing']);
    } else if (this.time > 14 && ctx.audio.music !== 'hearing') {
      ctx.audio.playMusic(['hearing']);
    }
    // The autopilot, as host, goes back to the lobby when asked to loop.
    if (ctx.params.autoplay && ctx.params.loop && ctx.client.isHost() && this.time > 6 && !this.autoSent) {
      this.autoSent = true;
      ctx.client.send('toLobby', {});
    }
  }

  exit(ctx: AppContext): void {
    if (ctx.runtime) ctx.runtime.shot = null;
    this.root?.remove();
    this.root = null;
    this.built = null;
  }
}
