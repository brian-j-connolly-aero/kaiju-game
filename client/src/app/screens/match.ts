/**
 * Match: the screen the game is played on. It owns the HUD, the command wheel and the map; the
 * controllers, the renderer and the audio run in the MatchRuntime. During an intermission the
 * camera pulls back to show the kaiju grown and the quarantine line widening.
 */

import { kaijuStageDef, type SimEvent } from '@mb/shared';
import { CommandWheel } from '../../ui/commandWheel';
import { Hud } from '../../ui/hud';
import { el } from '../../ui/icons';
import { MapView } from '../../ui/mapView';
import type { AppContext, Screen } from '../context';

export class MatchScreen implements Screen {
  readonly id = 'match' as const;
  private root: HTMLElement | null = null;
  private hud: Hud | null = null;
  private wheel: CommandWheel | null = null;
  private map: MapView | null = null;
  private wheelWasOpen = false;
  private onCanvasClick: (() => void) | null = null;

  enter(ctx: AppContext): void {
    const runtime = ctx.runtime;
    if (!runtime) return;
    this.hud = new Hud();
    this.wheel = new CommandWheel();
    this.map = new MapView();
    this.map.setCity(runtime.session.mirror.city);
    this.map.onCommand = (command) => {
      runtime.session.sendCommand(command);
      ctx.audio.play('ui_wheel_select');
    };
    this.root = el('div', 'screen match', [this.hud.root, this.wheel.root, this.map.root]);
    ctx.ui.append(this.root);
    runtime.onEvent = (e) => this.onEvent(ctx, e);

    // A click on the view captures the mouse (and lets the browser start the sound).
    const canvas = ctx.renderer?.renderer.domElement;
    this.onCanvasClick = () => {
      ctx.audio.unlock();
      if (!runtime.mapOpen && !ctx.params.autoplay) ctx.input.lockPointer();
    };
    canvas?.addEventListener('mousedown', this.onCanvasClick);
  }

  private onEvent(ctx: AppContext, e: SimEvent): void {
    const hud = this.hud;
    if (!hud) return;
    const now = ctx.now();
    if (e.type === 'crossfire') hud.flash('crossfire', now);
    else if (e.type === 'nerveBreak') hud.flash('nerveBreak', now, 2.5);
    else if (e.type === 'volley') hud.flash('volley', now, 1);
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

    // Map toggle. Opening it frees the mouse; the body idles while it is open.
    if (input.pressed.map && frame.match.phase === 'playing') {
      runtime.mapOpen = !runtime.mapOpen;
      map.setOpen(runtime.mapOpen);
      ctx.audio.play('ui_click');
      if (runtime.mapOpen) ctx.input.unlockPointer();
    }
    if (map.open && !runtime.mapOpen) map.setOpen(false);
    map.update(frame, runtime.session, input, dt);

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
    const human = runtime.activeHuman;
    if (human) {
      wheel.update(human.wheel, ctx.input.bindings, input.device);
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
      ctx.runtime.shot = null;
    }
    const canvas = ctx.renderer?.renderer.domElement;
    if (this.onCanvasClick) canvas?.removeEventListener('mousedown', this.onCanvasClick);
    this.onCanvasClick = null;
    ctx.input.unlockPointer();
    this.root?.remove();
    this.root = null;
    this.hud = null;
    this.wheel = null;
    this.map = null;
  }
}
