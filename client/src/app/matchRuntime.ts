/**
 * MatchRuntime: everything that runs for the length of one match, shared by the briefing, match
 * and end screens. Each frame it reads the input, sends the 30 Hz input samples, asks the
 * session for the state to draw, runs the local controller, updates the renderer and the audio,
 * and routes simulation events to whoever shows or sounds them.
 *
 * Screens stay small: they add their own overlay and choose between the player's camera and a
 * cinematic one.
 */

import { kaijuStageDef, unitTypeDef, weaponDef, type MatchEndEvent, type SimEvent, type SnapKaiju } from '@mb/shared';
import type { AudioEngine } from '../audio/audioEngine';
import { MatchAudio } from '../audio/matchAudio';
import type { Autopilot } from '../game/autoplay';
import { CinematicCamera, type OrbitShot } from '../game/controllers/cinematicCamera';
import { DroneController } from '../game/controllers/droneController';
import { HumanController } from '../game/controllers/humanController';
import { KaijuController } from '../game/controllers/kaijuController';
import { CameraShake, squadIsOut, type ControlContext, type Controller } from '../game/controllers/types';
import type { InputManager } from '../game/input/inputManager';
import { InputTicker } from '../game/input/inputTicker';
import type { FrameState, MatchSession } from '../net/matchSession';
import type { GameRenderer, RenderView } from '../render/gameRenderer';
import type { HudView } from '../ui/hud';

/** The front page photo is this wide at most, and is not retaken more often than this (seconds). */
const PHOTO_WIDTH = 640;
const PHOTO_EVERY = 5;

export interface RuntimeDeps {
  session: MatchSession;
  renderer: GameRenderer;
  input: InputManager;
  audio: AudioEngine;
  autopilot: Autopilot | null;
  thirdPerson: boolean;
  /** True while the connection is being restored. */
  reconnecting: () => boolean;
}

export class MatchRuntime {
  readonly session: MatchSession;
  readonly matchAudio: MatchAudio;
  readonly cinematic = new CinematicCamera();
  readonly shake = new CameraShake();
  /** The newest frame, or null before the first snapshot. */
  frame: FrameState | null = null;
  /** The controller in charge this frame. */
  controller: Controller;
  /** When set, the camera follows this shot instead of the player's view. */
  shot: OrbitShot | null = null;
  mapOpen = false;
  /** The settings panel is open over the match: like the map, the view holds still and the body idles. */
  menuOpen = false;
  /** Set when the match has ended. */
  result: MatchEndEvent | null = null;
  /** A picture of the match for the end screen's front page (an address the page can show), or ''. */
  photo = '';
  /** Called for every simulation event after the renderer and the audio have had it. */
  onEvent: ((e: SimEvent) => void) | null = null;
  eventCounts: Record<string, number> = {};
  /** Where a frame's time goes, milliseconds, smoothed: input and network, scene update, drawing. */
  readonly timing = { logic: 0, scene: 0, draw: 0 };

  private readonly deps: RuntimeDeps;
  private readonly player: KaijuController | HumanController | null;
  private readonly drone = new DroneController();
  private readonly ticker = new InputTicker();
  private lastBounds: FrameState['bounds'] | null = null;
  private wantPhoto = 0;
  private photoScore = 0;
  private photoAt = -PHOTO_EVERY;
  private photoCanvas: HTMLCanvasElement | null = null;
  private clockNow = 0;
  private skippedAt = -1;
  private disposed = false;

  constructor(deps: RuntimeDeps) {
    this.deps = deps;
    this.session = deps.session;
    this.matchAudio = new MatchAudio(deps.audio);
    this.matchAudio.begin(deps.session);
    const role = deps.session.role.kind;
    this.player = role === 'kaiju' ? new KaijuController(deps.thirdPerson) : role === 'human' ? new HumanController(deps.thirdPerson) : null;
    this.controller = this.player ?? this.drone;
    deps.renderer.beginMatch(deps.session.mirror, 1, deps.session.boundsFor(1));
    deps.renderer.cues = { onStep: (k) => this.onStep(k) };
    // Whatever was pressed in the menus is not the first input of the match.
    deps.input.sampleTaken();
  }

  dispose(): void {
    this.disposed = true;
    this.matchAudio.end();
    this.deps.renderer.cues = {};
    this.deps.autopilot?.setContext(null, null);
    this.setPhoto('');
  }

  get human(): HumanController | null {
    return this.player instanceof HumanController ? this.player : null;
  }

  /** The human controller when the player is driving a unit right now, else null. */
  get activeHuman(): HumanController | null {
    return this.controller === this.player ? this.human : null;
  }

  // --- events ----------------------------------------------------------------------------------

  private distanceToCamera(x: number, z: number): number {
    const c = this.deps.renderer.camera.position;
    return Math.hypot(x - c.x, z - c.z);
  }

  private onStep(k: SnapKaiju): void {
    this.matchAudio.step(k);
    const st = kaijuStageDef(k.kind, k.stage);
    const d = this.distanceToCamera(k.x, k.z);
    if (k.id !== this.session.role.kaijuId && d < st.height * 5) this.shake.add(0.12 * (1 - d / (st.height * 5)));
  }

  handleEvent(e: SimEvent): void {
    this.eventCounts[e.type] = (this.eventCounts[e.type] ?? 0) + 1;
    // An event from a backlog (the tab was hidden): the picture takes over what lasts and shows
    // nothing happening; no shake, no photo, no flash on the HUD. The audio is handed every
    // event and reads the same flag (`session.catchingUp`) for what it should not play.
    const past = this.session.catchingUp;
    if (past && this.skippedAt !== this.clockNow) {
      // The first of a backlog: what was on screen when the frames stopped is over too.
      this.skippedAt = this.clockNow;
      this.deps.renderer.skipMoment();
      this.shake.reset();
    }
    this.deps.renderer.handleEvent(e, past);
    this.matchAudio.handleEvent(e);
    if (past) {
      if (e.type === 'matchEnd') this.result = e;
      return;
    }
    const frame = this.frame;
    switch (e.type) {
      case 'kaijuAction': {
        const k = frame?.kaijus[e.kaiju];
        if (k && e.action === 'stomp' && e.phase === 'active') {
          const reach = kaijuStageDef(k.kind, k.stage).height * 8;
          const d = this.distanceToCamera(e.x, e.z);
          if (d < reach) this.shake.add(0.7 * (1 - d / reach));
        }
        break;
      }
      case 'kaijuHit':
        if (e.kaiju === this.session.role.kaijuId && e.damage > 0.2) this.shake.add(Math.min(0.5, 0.15 + e.damage * 0.02));
        break;
      case 'projectileHit': {
        const d = this.distanceToCamera(e.x, e.z);
        const reach = 20 + e.splash * 6;
        if (d < reach) this.shake.add(0.45 * (1 - d / reach));
        break;
      }
      case 'structureStage': {
        if (e.stage < 3) break;
        const s = this.session.mirror.city.structures[e.id];
        if (!s) break;
        const d = this.distanceToCamera(s.x, s.z);
        if (d < s.height * 4 + 40) this.shake.add(0.3);
        // The front page wants the biggest thing that fell (but not a capture every second).
        if (s.value > this.photoScore) {
          this.photoScore = s.value;
          this.wantPhoto = Math.max(0.35, this.photoAt + PHOTO_EVERY - this.clockNow);
        }
        break;
      }
      case 'moltBlast':
        this.shake.add(1);
        break;
      case 'matchEnd':
        this.result = e;
        if (!this.photo) this.wantPhoto = 0.05;
        break;
      default:
        break;
    }
    this.onEvent?.(e);
  }

  // --- per frame -------------------------------------------------------------------------------

  private pickController(frame: FrameState): Controller {
    const role = this.session.role.kind;
    if (role === 'kaiju' && this.player) return this.player;
    if (role === 'human' && this.player) {
      // A dead leader is not the end: the player is in another unit a tick later. Stay with it.
      if (frame.localUnit && !squadIsOut(frame.squads, this.session.role.squadId)) return this.player;
      // The squad is gone until the next molt: fly a drone from where it fell.
      if (this.controller !== this.drone) {
        const k = frame.kaijus[0];
        const cam = this.deps.renderer.camera.position;
        if (k) this.drone.place(cam.x, cam.z, Math.max(20, cam.y + 15), Math.atan2(k.x - cam.x, k.z - cam.z));
      }
      return this.drone;
    }
    return this.drone;
  }

  /** The HUD's view of the controller. */
  hudView(): HudView {
    const input = this.deps.input;
    const human = this.activeHuman;
    const frame = this.frame;
    let inRange = true;
    if (human && frame?.localUnit) {
      const range = weaponDef(unitTypeDef(frame.localUnit.type).weapon).range;
      inRange = human.aimPoint.on !== 'none' && human.aimPoint.dist <= range;
    }
    return {
      aimOn: human ? human.aimPoint.on : 'none',
      inRange,
      thirdPerson: this.controller.thirdPerson,
      recoil: human ? human.recoil : 0,
      wheelOpen: human ? human.wheel.open : false,
      mapOpen: this.mapOpen,
      mode: this.controller.kind,
      device: input.state.device,
      bindings: input.bindings,
      reconnecting: this.deps.reconnecting(),
      pointerFree: input.pointerFree && frame?.match.phase === 'playing',
    };
  }

  /**
   * Runs one frame. `now` is local time in seconds. Returns the frame state (null until the
   * first snapshot has arrived, when only the city is drawn).
   */
  update(dt: number, now: number): FrameState | null {
    const { renderer, input, audio, autopilot } = this.deps;
    const session = this.session;

    const t0 = performance.now();
    this.clockNow = now;
    autopilot?.setContext(session, this.frame);
    const actions = input.poll(dt);
    const frame = session.sample(now, dt);
    this.frame = frame;

    if (!frame) {
      renderer.update(null, dt, null);
      this.cinematic.aim({ x: 0, y: 0, z: 0, radius: 500, height: 260, speed: 0.04 }, dt, 0);
      this.cinematic.apply(renderer.camera);
      renderer.render();
      return null;
    }
    if (frame.bounds !== this.lastBounds) {
      this.lastBounds = frame.bounds;
      renderer.showBounds(frame.bounds, frame.match.stage);
    }

    const controller = this.pickController(frame);
    this.controller = controller;
    const playing = frame.match.phase === 'playing';
    if (!playing) this.mapOpen = false;
    const ctx: ControlContext = { session, renderer, input: actions, frame, dt, now, mapOpen: this.mapOpen || this.menuOpen };
    controller.update(ctx);

    // 30 Hz input ticks. Outside play the body cannot act: send a neutral sample so the server
    // still hears from this client. Buttons are read from the latch (`input.held`), which is
    // started again after every sample, so a click between two ticks is in exactly one of them.
    const ticks = this.ticker.advance(dt);
    for (let i = 0; i < ticks; i++) {
      const sample = controller.sample(ctx);
      input.sampleTaken();
      if (!sample && this.session.role.kind === 'spectator') continue;
      if (!sample || !playing) {
        session.tickInput({ moveX: 0, moveZ: 0, aimYaw: session.aimYaw, aimPitch: session.aimPitch, buttons: 0 }, now);
      } else {
        session.tickInput(sample, now);
      }
    }
    // The local body is predicted tick by tick; draw it where it is between the last two.
    session.refreshLocal(this.ticker.alpha);

    const cinematic = this.shot !== null;
    const human = this.activeHuman;
    const view: RenderView = {
      localKaiju: session.role.kaijuId,
      localUnit: frame.localUnit ? frame.localUnit.id : -1,
      localSquad: session.role.squadId,
      hideLocalLead: !cinematic && human !== null && !human.thirdPerson,
      kaijuFirstPerson: !cinematic && controller instanceof KaijuController && !controller.thirdPerson,
      kaijuInsideHead: !cinematic && controller instanceof KaijuController && controller.insideHead,
      seesKaiju: session.role.kind !== 'human' || controller.kind === 'drone',
      hint: frame.localKaiju ? session.hintFor(frame.localKaiju, now) : null,
      now,
    };
    const t1 = performance.now();
    renderer.update(frame, dt, view);
    const t2 = performance.now();

    if (this.shot) {
      this.cinematic.aim(this.shot, dt);
      this.cinematic.apply(renderer.camera);
    } else {
      controller.applyCamera(ctx, renderer.camera);
      this.cinematic.cut();
      const k = frame.kaijus[0];
      this.shake.apply(renderer.camera, dt, k ? Math.max(0.15, kaijuStageDef(k.kind, k.stage).height * 0.012) : 0.2);
    }

    const cam = renderer.camera;
    const e = cam.matrixWorld.elements;
    cam.updateMatrixWorld();
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, -e[8], -e[9], -e[10]);
    this.matchAudio.update(frame, dt);
    audio.update(dt);

    const t3 = performance.now();
    renderer.render();
    const t4 = performance.now();
    const timing = this.timing;
    timing.logic += (t1 - t0 + (t3 - t2) - timing.logic) * 0.1;
    timing.scene += (t2 - t1 - timing.scene) * 0.1;
    timing.draw += (t4 - t3 - timing.draw) * 0.1;
    if (this.wantPhoto > 0) {
      this.wantPhoto -= dt;
      if (this.wantPhoto <= 0) this.takePhoto();
    }
    return frame;
  }

  private setPhoto(address: string): void {
    if (this.photo.startsWith('blob:')) URL.revokeObjectURL(this.photo);
    this.photo = address;
  }

  /**
   * Takes the front page photo without holding up the frame. Straight after a render the view's
   * canvas still holds the frame: the browser is asked for a small copy of it, which it makes
   * in its own time, and encodes that in its own time too. (Reading the full-size view back and
   * encoding it on the spot stalled the game right after the biggest collapses.)
   */
  private takePhoto(): void {
    this.photoAt = this.clockNow;
    try {
      const view = this.deps.renderer.renderer.domElement;
      if (view.width === 0 || view.height === 0) return;
      const width = Math.min(PHOTO_WIDTH, view.width);
      const height = Math.max(1, Math.round((width * view.height) / view.width));
      const encode = (source: CanvasImageSource): void => {
        if (this.disposed) return;
        const small = (this.photoCanvas ??= document.createElement('canvas'));
        small.width = width;
        small.height = height;
        const pen = small.getContext('2d');
        if (!pen) return;
        pen.drawImage(source, 0, 0, width, height);
        small.toBlob(
          (blob) => {
            if (blob && !this.disposed) this.setPhoto(URL.createObjectURL(blob));
          },
          'image/jpeg',
          0.7,
        );
      };
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(view, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' })
          .then((bitmap) => {
            encode(bitmap);
            bitmap.close();
          })
          .catch(() => undefined);
      } else {
        encode(view);
      }
    } catch {
      // No picture: the front page shows its stand-in.
    }
  }
}
