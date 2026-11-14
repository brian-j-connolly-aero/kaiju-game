/**
 * Match: the screen the game is played on. It owns the HUD, the squad's volley meter and the
 * tank's gun reticle, the kaiju's warnings and the map; the controllers, the renderer and the
 * audio run in the MatchRuntime. During an intermission the camera pulls back to show the kaiju
 * grown and the quarantine line widening.
 *
 * It also looks after the captured mouse. While this screen is up and neither the map nor the
 * settings panel is open, the game wants the mouse (`input.wantCapture`): a click on the view
 * captures it, and only that. Opening the map or the panel lets the pointer go; closing them
 * takes it back if it had been captured. The kaiju's molt cards (ui/moltCards.ts) do the same
 * while they wait for a pick: a click on a card picks it and takes the pointer back. Escape belongs to the browser while the pointer is
 * captured (it frees the pointer and the page never sees the key), so "the pointer was taken
 * away while this window had the focus" is read as Escape: the settings panel opens.
 */

import { kaijuStageDef, unitTypeDef, weaponDef, type SimEvent } from '@mb/shared';
import { GunReticle } from '../../ui/gunReticle';
import { Hud } from '../../ui/hud';
import { el } from '../../ui/icons';
import { MapView } from '../../ui/mapView';
import { MoltCardPicker } from '../../ui/moltCards';
import { ThreatRing } from '../../ui/threats';
import { VolleyMeter } from '../../ui/volleyMeter';
import type { AppContext, Screen } from '../context';
import { cardForMatch } from './briefing';

export class MatchScreen implements Screen {
  readonly id = 'match' as const;
  private root: HTMLElement | null = null;
  private hud: Hud | null = null;
  private map: MapView | null = null;
  /** The kaiju's warnings of guns charging at it (in first person above all). */
  private threats: ThreatRing | null = null;
  /** The squad's volley meter round the crosshair, and the tank's gun reticle. */
  private volley: VolleyMeter | null = null;
  private gun: GunReticle | null = null;
  /** The kaiju's molt cards (ui/moltCards.ts): while they wait for a pick the pointer is free. */
  private cards: MoltCardPicker | null = null;
  private cardsWaiting = false;
  /** The pointer was captured when the map, the panel or the molt cards opened: give it back when they close. */
  private mapTookPointer = false;
  private panelTookPointer = false;
  private cardsTookPointer = false;
  /** Set by the input manager when the browser took the pointer away. */
  private lockLost = false;
  private lockLostAt = -1;

  enter(ctx: AppContext): void {
    const runtime = ctx.runtime;
    if (!runtime) return;
    this.hud = new Hud();
    this.map = new MapView();
    this.threats = new ThreatRing();
    this.volley = new VolleyMeter(runtime.session.role.squadId);
    this.gun = new GunReticle();
    this.map.setCity(runtime.session.mirror.city);
    const renderer = ctx.renderer;
    if (renderer) this.map.setLandmarkPictures(() => renderer.landmarkPictures());
    // The molt cards: a pick goes to the server with the next input; a picked card flies to its
    // slot on the HUD and lands there. A click on a card is the gesture a browser wants before
    // it hands the pointer back.
    const cards = new MoltCardPicker();
    this.cards = cards;
    this.cardsWaiting = false;
    this.cardsTookPointer = false;
    cards.slotRect = (slot) => this.hud?.kit.slotRect(slot) ?? null;
    cards.onFlight = (slot) => this.hud?.kit.hold(slot);
    cards.onLand = (slot, move) => this.hud?.kit.land(slot, move);
    cards.onPick = (n, byClick) => {
      runtime.pickCard(n);
      ctx.audio.play('ui_wheel_select');
      if (this.cardsTookPointer || byClick) ctx.input.lockPointer();
      this.cardsTookPointer = false;
    };
    this.root = el('div', 'screen match', [this.threats.root, this.volley.root, this.gun.root, this.hud.root, this.map.root, cards.root]);
    // The gun reticle is placed once the camera is where this frame's picture is drawn from.
    runtime.onCamera = () => this.placeGun(ctx);
    ctx.ui.append(this.root);
    // The controls card opens and closes with its own key and takes no mouse input here: the
    // pointer stays captured and the game runs on behind it.
    cardForMatch(ctx);
    ctx.controls.setPassive(true);
    runtime.onEvent = (e) => this.onEvent(ctx, e);

    // The input manager captures the mouse on a click on the view while `wantCapture` is set
    // (see `frame`). (The first click or key press anywhere also lets the browser start the sound.)
    this.mapTookPointer = false;
    this.panelTookPointer = false;
    this.lockLost = false;
    this.lockLostAt = -1;
    ctx.input.gameKeys = true;
    ctx.input.onLockLost = () => {
      this.lockLost = true;
    };
    ctx.settings.onClose = () => {
      // Closed with a click (the check mark, or anywhere outside the panel): the click is the
      // gesture a browser wants before it hands the pointer over.
      runtime.menuOpen = false;
      if (this.panelTookPointer) ctx.input.lockPointer();
      this.panelTookPointer = false;
    };
  }

  private openPanel(ctx: AppContext, hadPointer: boolean): void {
    this.panelTookPointer = hadPointer;
    ctx.input.unlockPointer();
    ctx.settings.setOpen(true);
  }

  private closePanel(ctx: AppContext): void {
    ctx.settings.setOpen(false);
    // Asked from a key press. A browser may refuse this (Escape is not a key it takes as
    // consent): the pointer then stays free, the HUD says "click", and the click captures it.
    if (this.panelTookPointer) ctx.input.lockPointer();
    this.panelTookPointer = false;
  }

  private onEvent(ctx: AppContext, e: SimEvent): void {
    const hud = this.hud;
    if (!hud) return;
    const now = ctx.now();
    this.volley?.onEvent(e, now);
    if (e.type === 'moltPick' && e.kaiju === ctx.runtime?.session.role.kaijuId) this.cards?.picked(e);
    if (e.type === 'crossfire') hud.flash('crossfire', now);
    else if (e.type === 'nerveBreak') hud.flash('nerveBreak', now, 2.5);
    else if (e.type === 'volley') {
      hud.flash('volley', now, 1);
      this.threats?.volley(e.squad, now);
    }
    else if (e.type === 'callin' && e.phase !== 'done') hud.flash('callin', now, 2);
  }

  /**
   * The tank's gun reticle, on the point its turret's aim lands on as seen through this frame's
   * camera; hidden unless the player drives a tank with the view their own.
   */
  private placeGun(ctx: AppContext): void {
    const gun = this.gun;
    const runtime = ctx.runtime;
    const renderer = ctx.renderer;
    if (!gun) return;
    const human = runtime?.activeHuman ?? null;
    const u = runtime?.frame?.localUnit ?? null;
    if (!runtime || !renderer || !human || !u || !u.alive || !human.tank || runtime.shot !== null || runtime.mapOpen || runtime.frame?.match.phase !== 'playing') {
      gun.hide();
      return;
    }
    const weapon = weaponDef(unitTypeDef(u.type).weapon);
    const p = human.gunPoint;
    gun.place(renderer.camera, {
      x: p.x,
      y: p.y,
      z: p.z,
      onKaiju: p.on === 'kaiju',
      inRange: p.on !== 'none' && p.dist <= weapon.range,
      ready: 1 - Math.min(1, u.cooldown / Math.max(0.01, weapon.cooldown)),
    });
  }

  frame(ctx: AppContext, dt: number): void {
    const runtime = ctx.runtime;
    const hud = this.hud;
    const map = this.map;
    if (!runtime || !hud || !map) return;
    const frame = runtime.frame;
    const input = ctx.input.state;
    if (!frame) return;

    // The settings panel: Escape (Start on a gamepad), or the browser taking the captured
    // pointer away while the window has the focus, which is what Escape does then.
    const settings = ctx.settings;
    const now = ctx.now();
    if (this.lockLost) {
      this.lockLost = false;
      this.lockLostAt = now;
      if (!settings.open && !runtime.mapOpen && document.hasFocus()) this.openPanel(ctx, true);
    }
    // (A browser that frees the pointer AND delivers the key must not open and close in one go.)
    if (input.pressed.menu && now - this.lockLostAt > 0.4) {
      if (settings.open) this.closePanel(ctx);
      else this.openPanel(ctx, ctx.input.pointerLocked);
    }
    runtime.menuOpen = settings.open;

    // Map toggle. Opening it frees the mouse; the body idles while it is open. Closing it gives
    // the mouse back if the map had taken it.
    if (input.pressed.map && frame.match.phase === 'playing' && !runtime.menuOpen) {
      runtime.mapOpen = !runtime.mapOpen;
      map.setOpen(runtime.mapOpen);
      ctx.audio.play('ui_click');
      if (runtime.mapOpen) {
        this.mapTookPointer = ctx.input.pointerLocked;
        ctx.input.unlockPointer();
      }
    }
    if (map.open && !runtime.mapOpen) map.setOpen(false);
    if (!runtime.mapOpen && this.mapTookPointer) {
      this.mapTookPointer = false;
      if (!runtime.menuOpen) ctx.input.lockPointer();
    }
    map.update(frame, runtime.session);

    // The molt cards. While they wait for a pick the pointer is free, so a click on a card picks
    // it (mouse movement under pointer lock plays no part); a pick by a key, or the server's own
    // pick at the end of the intermission, takes the pointer back if the cards had taken it.
    const cards = this.cards;
    if (cards) {
      cards.update(frame.localKaiju, frame.match, runtime.session.config.tuning, input, ctx.input.bindings, input.device, now);
      if (cards.waiting && !this.cardsWaiting) {
        ctx.audio.play('ui_wheel_open');
        this.cardsTookPointer = ctx.input.pointerLocked;
        ctx.input.unlockPointer();
      } else if (!cards.waiting && this.cardsWaiting && this.cardsTookPointer) {
        this.cardsTookPointer = false;
        if (!runtime.mapOpen && !runtime.menuOpen) ctx.input.lockPointer();
      }
      this.cardsWaiting = cards.waiting;
      hud.root.classList.toggle('cards', cards.active);
    }
    ctx.input.wantCapture = !ctx.params.autoplay && !runtime.mapOpen && !runtime.menuOpen && !this.cardsWaiting;

    // Intermission: pull the camera back and around the kaiju.
    if (frame.match.phase === 'intermission') {
      const k = frame.kaijus[0];
      if (k) {
        const h = kaijuStageDef(k.kind, k.stage).height;
        runtime.shot = { x: k.x, y: h * 0.5, z: k.z, radius: h * 4 + 30, height: h * 1.6 + 12, speed: 0.35 };
      }
    } else {
      runtime.shot = null;
    }

    const view = runtime.hudView();
    hud.root.classList.toggle('cinematic', runtime.shot !== null);
    hud.update(frame, runtime.session, view, ctx.now());
    // The kaiju's own warnings, while it plays (not under the intermission's cinematic camera).
    const threats = this.threats;
    const lk = frame.localKaiju;
    const renderer = ctx.renderer;
    if (threats && lk && lk.alive && renderer && runtime.shot === null && frame.match.phase === 'playing' && !runtime.mapOpen) {
      renderer.camera.updateMatrixWorld();
      threats.update(lk, frame.units, renderer.camera, !runtime.controller.thirdPerson, now);
    } else {
      threats?.hide();
    }

    // The squad's volley meter round the crosshair, from the newest snapshot (not the view's,
    // which runs a tenth of a second behind), while the player drives a unit of their own.
    const human = runtime.activeHuman;
    const session = runtime.session;
    const volley = this.volley;
    if (volley) {
      volley.update({
        units: session.latest?.units ?? frame.units,
        sinceSnapshot: now - session.stats.lastSnapshotAt,
        held: !!human && human.volleyHeld,
        visible: !!human && !!frame.localUnit && frame.localUnit.alive && runtime.shot === null && !runtime.mapOpen && frame.match.phase === 'playing',
        now,
      });
    }
  }

  exit(ctx: AppContext): void {
    if (ctx.runtime) {
      ctx.runtime.onEvent = null;
      ctx.runtime.onCamera = null;
      ctx.runtime.mapOpen = false;
      ctx.runtime.menuOpen = false;
      ctx.runtime.shot = null;
    }
    ctx.input.wantCapture = false;
    ctx.input.gameKeys = false;
    ctx.input.onLockLost = null;
    ctx.settings.onClose = null;
    ctx.settings.setOpen(false);
    ctx.controls.setOpen(false);
    ctx.input.unlockPointer();
    this.root?.remove();
    this.root = null;
    this.hud = null;
    this.map = null;
    this.threats = null;
    this.volley = null;
    this.gun = null;
    this.cards = null;
  }
}
