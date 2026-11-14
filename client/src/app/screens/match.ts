/**
 * Match: the screen the game is played on. It owns the HUD, the command wheel and the map; the
 * controllers, the renderer and the audio run in the MatchRuntime. During an intermission the
 * camera pulls back to show the kaiju grown and the quarantine line widening.
 *
 * It also looks after the captured mouse. While this screen is up and neither the map nor the
 * settings panel is open, the game wants the mouse (`input.wantCapture`): a click on the view
 * captures it, and only that. Opening the map or the panel lets the pointer go; closing them
 * takes it back if it had been captured. Escape belongs to the browser while the pointer is
 * captured (it frees the pointer and the page never sees the key), so "the pointer was taken
 * away while this window had the focus" is read as Escape: the settings panel opens.
 */

import { kaijuStageDef, type SimEvent } from '@mb/shared';
import { CommandWheel } from '../../ui/commandWheel';
import { Hud } from '../../ui/hud';
import { el } from '../../ui/icons';
import { MapView } from '../../ui/mapView';
import { ThreatRing } from '../../ui/threats';
import type { AppContext, Screen } from '../context';
import { cardForMatch } from './briefing';

export class MatchScreen implements Screen {
  readonly id = 'match' as const;
  private root: HTMLElement | null = null;
  private hud: Hud | null = null;
  private wheel: CommandWheel | null = null;
  private map: MapView | null = null;
  /** The kaiju's warnings of guns charging at it (in first person above all). */
  private threats: ThreatRing | null = null;
  private wheelWasOpen = false;
  /** The pointer was captured when the map or the panel opened: give it back when they close. */
  private mapTookPointer = false;
  private panelTookPointer = false;
  /** Set by the input manager when the browser took the pointer away. */
  private lockLost = false;
  private lockLostAt = -1;

  enter(ctx: AppContext): void {
    const runtime = ctx.runtime;
    if (!runtime) return;
    this.hud = new Hud();
    this.wheel = new CommandWheel();
    this.map = new MapView();
    this.threats = new ThreatRing();
    this.map.setCity(runtime.session.mirror.city);
    const renderer = ctx.renderer;
    if (renderer) this.map.setLandmarkPictures(() => renderer.landmarkPictures());
    this.map.onCommand = (command) => {
      runtime.session.sendCommand(command);
      ctx.audio.play('ui_wheel_select');
    };
    this.root = el('div', 'screen match', [this.threats.root, this.hud.root, this.wheel.root, this.map.root]);
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
    if (e.type === 'crossfire') hud.flash('crossfire', now);
    else if (e.type === 'nerveBreak') hud.flash('nerveBreak', now, 2.5);
    else if (e.type === 'volley') {
      hud.flash('volley', now, 1);
      this.threats?.volley(e.squad, now);
    }
    else if (e.type === 'callin' && e.phase !== 'done') hud.flash('callin', now, 2);
  }

  frame(ctx: AppContext, dt: number): void {
    const runtime = ctx.runtime;
    const hud = this.hud;
    const map = this.map;
    const wheel = this.wheel;
    if (!runtime || !hud || !map || !wheel) return;
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
    map.update(frame, runtime.session, input, dt);
    ctx.input.wantCapture = !ctx.params.autoplay && !runtime.mapOpen && !runtime.menuOpen;

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
      threats.update(lk, frame.units, frame.smokes, renderer.camera, !runtime.controller.thirdPerson, now);
    } else {
      threats?.hide();
    }

    const human = runtime.activeHuman;
    if (human) {
      wheel.update(human.wheel, ctx.input.bindings, input.device, frame.squads[runtime.session.role.squadId] ?? null);
      if (human.wheel.open !== this.wheelWasOpen) {
        this.wheelWasOpen = human.wheel.open;
        ctx.audio.play(human.wheel.open ? 'ui_wheel_open' : 'ui_wheel_select');
      }
    } else {
      wheel.root.classList.add('hidden');
    }
  }

  exit(ctx: AppContext): void {
    if (ctx.runtime) {
      ctx.runtime.onEvent = null;
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
    this.wheel = null;
    this.map = null;
    this.threats = null;
  }
}
