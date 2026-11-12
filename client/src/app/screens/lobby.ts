/**
 * Lobby: the room code to share, five seats, a role choice (volunteer for the kaiju or lead a
 * squad), a ready switch, and for the host the start button and the practice option (a bot
 * plays the kaiju). Names are the only words.
 */

import { canStartMatch, factionDef, kaijuKindDef, MATCH_RULES, type LobbyState } from '@mb/shared';
import { el, icon, portrait } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

/**
 * The invite the link button copies. It opens the room directly. Built from the public address
 * the server sends (`LobbyState.publicUrl`: the tunnel's address, so it works for friends even
 * when the host plays on localhost), else from the page's own address.
 */
export function inviteLink(code: string, publicUrl: string | undefined, page: { origin: string; pathname: string }): string {
  const base = publicUrl && /^https?:\/\/[^/?#]+$/.test(publicUrl) ? `${publicUrl}/` : `${page.origin}${page.pathname}`;
  return `${base}#${code}`;
}

/**
 * A seat the start no longer waits for: connected, not the host, not ready, and in the lobby
 * long enough (the server's `waited` flag; `canStartMatch` in shared/src/net/lobby.ts).
 */
export function seatAsleep(lobby: LobbyState, p: LobbyState['players'][number]): boolean {
  return p.connected && !p.ready && p.seat !== lobby.host && p.waited === true;
}

export class LobbyScreen implements Screen {
  readonly id = 'lobby' as const;
  private root: HTMLElement | null = null;
  private seats: HTMLElement | null = null;
  private start: HTMLButtonElement | null = null;
  private ready: HTMLButtonElement | null = null;
  private role: HTMLButtonElement | null = null;
  private practice: HTMLButtonElement | null = null;
  private portraitBox: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private shown = '';
  private autoClock = 0;
  private autoRole = false;
  private autoOptions = false;

  enter(ctx: AppContext): void {
    const client = ctx.client;
    const code = el('div', 'room-code', [client.code]);
    const link = el('button', 'btn', [icon('lb_link')]);
    link.addEventListener('click', () => {
      const address = inviteLink(client.code, client.lobby?.publicUrl, window.location);
      void navigator.clipboard?.writeText(address).catch(() => undefined);
      ctx.audio.play('ui_click');
      link.classList.add('done');
    });
    const back = el('button', 'btn', [icon('lb_back')]);
    back.addEventListener('click', () => {
      ctx.audio.play('ui_click');
      client.leave();
    });

    this.seats = el('div', 'seats');
    this.portraitBox = el('div', 'lobby-portrait');
    this.role = el('button', 'btn btn-big role-toggle');
    this.role.addEventListener('click', () => {
      const me = client.me();
      if (!me) return;
      client.send('setRole', { wantsKaiju: !me.wantsKaiju });
      ctx.audio.unlock();
      ctx.audio.play('ui_click');
    });
    this.ready = el('button', 'btn btn-big ready-toggle', [icon('lb_ready')]);
    this.ready.addEventListener('click', () => {
      const me = client.me();
      if (!me) return;
      client.send('ready', { ready: !me.ready });
      ctx.audio.unlock();
      ctx.audio.play('ui_ready');
    });
    this.practice = el('button', 'btn practice-toggle', [icon('lb_bot'), icon('lb_kaiju')]);
    this.practice.addEventListener('click', () => {
      const lobby = client.lobby;
      if (lobby && client.isHost()) client.send('setOptions', { botKaiju: !lobby.options.botKaiju });
      ctx.audio.play('ui_click');
    });
    this.start = el('button', 'btn btn-big start', [icon('lb_play')]);
    this.start.addEventListener('click', () => {
      ctx.audio.unlock();
      ctx.audio.play('ui_match_start');
      client.send('start', {});
    });

    const gear = el('button', 'btn settings-open', [icon('ui_settings')]);
    gear.addEventListener('click', () => {
      ctx.audio.unlock();
      ctx.audio.play('ui_click');
      ctx.settings.setOpen(true);
    });

    // The controls card for the role this player has picked, next to the gear.
    const card = el('button', 'btn controls-open', [icon('ui_controls')]);
    card.addEventListener('click', () => {
      ctx.audio.unlock();
      ctx.audio.play('ui_click');
      ctx.controls.toggle();
    });
    ctx.controls.setPassive(false);

    this.root = el('div', 'screen lobby', [
      gear,
      card,
      el('div', 'lobby-top', [back, code, link]),
      el('div', 'lobby-mid', [this.portraitBox, this.seats]),
      el('div', 'lobby-bottom', [this.role, this.ready, this.practice, this.start]),
    ]);
    ctx.ui.append(this.root);
    // (The app puts the room code in the page address as soon as the client is in a room.)
    this.unsubscribe = client.events.on('lobby', () => this.render(ctx));
    this.render(ctx);
    ctx.audio.playMusic(['lobby']);
  }

  private render(ctx: AppContext): void {
    const client = ctx.client;
    const lobby = client.lobby;
    if (!lobby || !this.seats) return;
    const key = JSON.stringify([lobby.players, lobby.host, lobby.options, lobby.phase, client.seat]);
    if (key === this.shown) return;
    this.shown = key;

    const cards: HTMLElement[] = [];
    for (let seat = 0; seat < MATCH_RULES.maxPlayers; seat++) {
      const p = lobby.players.find((x) => x.seat === seat);
      if (!p) {
        // Nobody here: a bot leads this squad.
        cards.push(el('div', 'seat empty', [icon('lb_bot', 'seat-role bot'), icon('lb_human', 'seat-bot-role')]));
        continue;
      }
      // Not ready for 20 seconds: the host may start without them (`canStartMatch`).
      const asleep = seatAsleep(lobby, p);
      const card = el('div', `seat${p.seat === client.seat ? ' me' : ''}${p.connected ? '' : ' away'}${p.ready || p.seat === lobby.host ? ' ready' : ''}${asleep ? ' asleep' : ''}`, [
        icon(p.wantsKaiju ? 'lb_kaiju' : 'lb_human', `seat-role ${p.wantsKaiju ? 'kaiju' : 'human'}`),
        el('div', 'seat-name', [p.name]),
        el('div', 'seat-flags', [
          p.seat === lobby.host ? icon('lb_host', 'flag host') : '',
          p.ready ? icon('lb_ready', 'flag ok') : '',
          asleep ? icon('ui_asleep', 'flag asleep') : '',
          p.connected ? '' : icon('ui_offline', 'flag off'),
        ]),
      ]);
      cards.push(card);
    }
    this.seats.replaceChildren(...cards);

    const me = client.me();
    const host = client.isHost();
    if (me) {
      if (me.wantsKaiju) ctx.controls.setRole('kaiju', me.kaijuKind, kaijuKindDef(me.kaijuKind).name);
      else ctx.controls.setRole('squad', me.kaijuKind, factionDef(me.faction).name);
    }
    if (this.role && me) {
      this.role.replaceChildren(icon(me.wantsKaiju ? 'lb_kaiju' : 'lb_human'));
      this.role.classList.toggle('kaiju', me.wantsKaiju);
    }
    if (this.portraitBox && me) {
      const id = me.wantsKaiju ? `portrait_${me.kaijuKind}` : `portrait_${me.faction}`;
      if (this.portraitBox.dataset.shown !== id) {
        this.portraitBox.dataset.shown = id;
        this.portraitBox.replaceChildren(portrait(id, me.wantsKaiju ? 'lb_kaiju' : 'fac_army'));
      }
    }
    this.ready?.classList.toggle('on', !!me?.ready);
    this.ready?.classList.toggle('hidden', host);
    this.practice?.classList.toggle('hidden', !host);
    this.practice?.classList.toggle('on', lobby.options.botKaiju);
    this.start?.classList.toggle('hidden', !host);
    if (this.start) this.start.disabled = !canStartMatch(lobby) || lobby.phase !== 'lobby';
  }

  /** The autopilot's lobby manners: pick a role, get ready, and (as host) start when the room is full enough. */
  private autoplay(ctx: AppContext, lobby: LobbyState, dt: number): void {
    const client = ctx.client;
    const me = client.me();
    if (!me || lobby.phase !== 'lobby') return;
    this.autoClock += dt;
    if (this.autoClock < 0.4) return;
    this.autoClock = 0;
    const wantsKaiju = ctx.params.role === 'kaiju';
    if (!this.autoRole || me.wantsKaiju !== wantsKaiju) {
      this.autoRole = true;
      client.send('setRole', { wantsKaiju });
      return;
    }
    if (client.isHost()) {
      if (!this.autoOptions && ctx.params.practice !== lobby.options.botKaiju) {
        this.autoOptions = true;
        client.send('setOptions', { botKaiju: ctx.params.practice });
        return;
      }
      // One match, unless asked to loop: a playtest wants the room to rest in the lobby afterwards.
      const present = lobby.players.filter((p) => p.connected).length;
      const again = ctx.matchesEnded === 0 || ctx.params.loop;
      if (again && present >= ctx.params.startAt && canStartMatch(lobby)) client.send('start', {});
    } else if (!me.ready) {
      client.send('ready', { ready: true });
    }
  }

  frame(ctx: AppContext, dt: number): void {
    const lobby = ctx.client.lobby;
    if (lobby && ctx.params.autoplay) this.autoplay(ctx, lobby, dt);
  }

  exit(ctx: AppContext): void {
    ctx.controls.setOpen(false);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root?.remove();
    this.root = null;
    this.shown = '';
  }
}
