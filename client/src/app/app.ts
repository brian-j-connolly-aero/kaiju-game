/**
 * The app: creates the long-lived services, runs the frame loop, and decides which screen is
 * showing. The screen is always derived from the state of the room and the match (no room:
 * home; a room in its lobby: lobby; a match: briefing, then match, then end), so a reconnect, a
 * late join or a server that abandons a match all land on the right screen without special cases.
 */

import { getCity } from '@mb/shared';
import { AssetStore } from '../assets/assetStore';
import { AudioEngine } from '../audio/audioEngine';
import { Autopilot } from '../game/autoplay';
import { CinematicCamera } from '../game/controllers/cinematicCamera';
import { loadKeyboardLayout } from '../game/input/actions';
import { InputManager } from '../game/input/inputManager';
import { GameClient, type ClosedReason } from '../net/gameClient';
import { browserStore, sessionToken, storedName } from '../net/session';
import { GameRenderer } from '../render/gameRenderer';
import { setIconSource } from '../ui/icons';
import { SettingsPanel } from '../ui/settingsPanel';
import { Subtitles } from '../ui/subtitles';
import type { AppContext, Screen, ScreenId } from './context';
import { DebugOverlay } from './debugOverlay';
import { MatchRuntime } from './matchRuntime';
import { installHook } from './mbHook';
import { readPageParams } from './params';
import { loadSettings, saveSettings, sensitivityFromSlider, sliderFromSensitivity, type Settings } from './settings';
import { BootScreen } from './screens/boot';
import { BriefingScreen } from './screens/briefing';
import { EndScreen } from './screens/end';
import { HomeScreen } from './screens/home';
import { LobbyScreen } from './screens/lobby';
import { MatchScreen } from './screens/match';

const CLOSED_NOTICE: Record<ClosedReason, string> = {
  left: '',
  replaced: 'ui_copy',
  gone: 'lb_join',
  refused: 'lb_human',
  version: 'ui_warning',
  network: 'ui_offline',
};

export class App {
  readonly ctx: AppContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly boot = new BootScreen();
  private readonly screens: Record<ScreenId, Screen>;
  private current: Screen | null = null;
  private booted = false;
  private readonly subtitles = new Subtitles();
  private readonly debug: DebugOverlay | null;
  private readonly backdrop = new CinematicCamera();
  private readonly errors: string[] = [];
  private readonly frameStats = { ms: 0, maxMs: 0, count: 0, fps: 0 };
  private readonly afterFrame: Array<() => void> = [];
  private last = 0;
  private menuFrame = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.canvas = canvas;
    const params = readPageParams(window.location.search);
    const store = browserStore();
    const assets = new AssetStore('assets/');
    const input = new InputManager(canvas);
    const autopilot = params.autoplay ? new Autopilot() : null;
    if (autopilot) input.autopilot = (state, dt) => autopilot.drive(state, dt);
    const audio = new AudioEngine(assets, params.mute);
    // The player's settings, as they left them.
    const settings = loadSettings(store);
    input.sensitivity = settings.sensitivity;
    input.invertY = settings.invertY;
    audio.setMasterVolume(settings.volume);
    const change = (patch: Partial<Settings>): void => {
      Object.assign(settings, patch);
      saveSettings(store, settings);
    };
    const panel = new SettingsPanel({
      values: () => ({
        volume: settings.volume,
        mouse: sliderFromSensitivity(settings.sensitivity),
        invertY: settings.invertY,
        fullscreen: document.fullscreenElement !== null,
        lowRes: settings.lowRes,
      }),
      setVolume: (volume) => {
        change({ volume });
        audio.setMasterVolume(settings.volume);
      },
      setMouse: (position) => {
        change({ sensitivity: sensitivityFromSlider(position) });
        input.sensitivity = settings.sensitivity;
      },
      setInvertY: (invertY) => {
        change({ invertY });
        input.invertY = settings.invertY;
      },
      setLowRes: (lowRes) => {
        change({ lowRes });
        this.ctx.renderer?.setQuality(settings.lowRes ? LOW_RES : 1);
      },
      setFullscreen: (on) => {
        try {
          const done = on ? document.documentElement.requestFullscreen() : document.exitFullscreen();
          // Refused (no permission, or nothing to leave): the button simply stays as it was.
          void Promise.resolve(done).catch(() => undefined);
        } catch {
          // This browser has no fullscreen.
        }
      },
      click: () => {
        audio.unlock();
        audio.play('ui_click');
      },
    });
    document.addEventListener('fullscreenchange', () => panel.sync());
    this.ctx = {
      params,
      store,
      assets,
      client: new GameClient({ origin: window.location.origin, token: sessionToken(store, params.profile), now: () => performance.now() }),
      audio,
      input,
      autopilot,
      settings: panel,
      renderer: null,
      runtime: null,
      ui,
      name: params.name ?? storedName(store, params.profile),
      notice: '',
      matchesEnded: 0,
      lastResult: null,
      now: () => performance.now() / 1000,
    };
    this.screens = {
      boot: this.boot,
      home: new HomeScreen(),
      lobby: new LobbyScreen(),
      briefing: new BriefingScreen(),
      match: new MatchScreen(),
      end: new EndScreen(),
    };
    this.debug = params.debug ? new DebugOverlay() : null;
    ui.append(this.subtitles.root, panel.root);
    if (this.debug) document.body.append(this.debug.root);

    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(`unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`));
    window.addEventListener('resize', () => this.resize());
    // Browsers allow sound only after a gesture: take the first one, wherever it lands.
    const unlock = (): void => this.ctx.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.ctx.audio.onSubtitle = (line, seconds) => {
      if (line) this.subtitles.show(line.speaker, line.text, this.ctx.now() + seconds);
      else this.subtitles.clear();
    };
    this.wireClient();
    installHook({
      ctx: this.ctx,
      screen: () => this.current?.id ?? 'boot',
      booted: () => this.booted,
      errors: this.errors,
      frameStats: this.frameStats,
      afterFrame: (fn) => this.afterFrame.push(fn),
    });
  }

  private wireClient(): void {
    const { client } = this.ctx;
    client.events.on('session', (session) => {
      const renderer = this.ctx.renderer;
      if (!renderer) return;
      this.ctx.runtime?.dispose();
      this.ctx.runtime = new MatchRuntime({
        session,
        renderer,
        input: this.ctx.input,
        audio: this.ctx.audio,
        autopilot: this.ctx.autopilot,
        thirdPerson: this.ctx.params.thirdPerson,
        reconnecting: () => client.status === 'reconnecting',
      });
    });
    client.events.on('sessionEnded', () => {
      this.ctx.runtime?.dispose();
      this.ctx.runtime = null;
      this.ctx.renderer?.endMatch();
      this.backdrop.cut();
    });
    client.events.on('event', (e) => {
      this.ctx.runtime?.handleEvent(e);
      if (e.type === 'matchEnd') {
        this.ctx.matchesEnded++;
        this.ctx.lastResult = { winner: e.winner, reason: e.reason, duration: e.duration };
      }
    });
    client.events.on('cityResync', () => this.ctx.renderer?.resync());
    client.events.on('lobby', (msg) => {
      // The address carries the room from the moment the client is in it, however it got there
      // (created, joined from the lobby, or typed into a match that was already running), so a
      // reload or a restored tab comes straight back. The sandbox has no room to come back to.
      const code = msg.lobby.code;
      if (code && !client.local && window.location.hash !== `#${code}`) window.history.replaceState(null, '', `#${code}`);
    });
    client.events.on('closed', (reason) => {
      this.ctx.notice = CLOSED_NOTICE[reason];
      if (reason !== 'left') console.warn(`net: left the room (${reason}).`);
      // The address no longer names a room to come back to (after a network failure it still
      // does: a reload tries again).
      if (reason !== 'network' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
  }

  /**
   * Loads everything and starts the frame loop. If that fails (most likely: this browser cannot
   * give the 3D view a WebGL context), the boot screen shows the warning picture instead of a
   * loading bar that never ends.
   */
  async start(): Promise<void> {
    try {
      await this.load();
    } catch (err) {
      console.error('The game could not start.', err);
      this.errors.push(`start: ${String(err)}`);
      this.setScreen('boot');
      this.boot.fail();
    }
  }

  private async load(): Promise<void> {
    const ctx = this.ctx;
    this.setScreen('boot');
    void loadKeyboardLayout();
    await ctx.assets.loadManifest(ctx.params.noAssets);
    setIconSource(ctx.assets);
    this.boot.setProgress(0.05);
    await ctx.assets.preload((p) => this.boot.setProgress(0.05 + 0.75 * (p.total > 0 ? p.loaded / p.total : 1)));
    // Let the bar paint before the city is built (a few tens of milliseconds of solid work).
    await new Promise((resolve) => setTimeout(resolve, 0));
    const renderer = new GameRenderer(this.canvas, ctx.assets, ctx.params.resolution);
    renderer.setQuality(ctx.settings.lowRes ? LOW_RES : 1);
    renderer.setCity(getCity().city);
    ctx.renderer = renderer;
    this.resize();
    ctx.input.attach();
    this.boot.setProgress(1);
    const sandbox = ctx.params.sandbox;
    if (sandbox !== 0) ctx.client.startLocal({ name: ctx.name || 'Solo', role: ctx.params.role ?? 'kaiju', stage: sandbox, fast: false });
    this.booted = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private resize(): void {
    this.ctx.renderer?.resize(window.innerWidth, window.innerHeight);
  }

  private wanted(): ScreenId {
    if (!this.booted) return 'boot';
    const { client, runtime } = this.ctx;
    const lobby = client.lobby;
    if (!lobby) return 'home';
    if (runtime) {
      const phase = runtime.frame?.match.phase ?? runtime.session.latest?.match.phase;
      if (runtime.result || phase === 'ended' || lobby.phase === 'end') return 'end';
      if (!phase || phase === 'briefing' || phase === 'lobby') return 'briefing';
      return 'match';
    }
    return 'lobby';
  }

  private setScreen(id: ScreenId): void {
    if (this.current?.id === id) return;
    this.current?.exit(this.ctx);
    this.current = this.screens[id];
    document.body.dataset.screen = id;
    this.current.enter(this.ctx);
    if (id === 'home' || id === 'lobby') this.ctx.audio.clearVoice();
    if (id === 'home') this.ctx.audio.playMusic(['lobby']);
  }

  private readonly tick = (time: number): void => {
    requestAnimationFrame(this.tick);
    const ctx = this.ctx;
    const cap = ctx.params.fpsCap;
    if (cap > 0 && time - this.last < 1000 / cap - 2) return;
    const elapsed = Math.max(0.0001, (time - this.last) / 1000);
    this.frameStats.fps += (1 / elapsed - this.frameStats.fps) * 0.08;
    // A long stall is played back as at most a quarter second, so nothing leaps.
    const dt = Math.min(0.25, elapsed);
    this.last = time;
    const started = performance.now();

    this.setScreen(this.wanted());
    this.current?.frame?.(ctx, dt);
    const renderer = ctx.renderer;
    // The settings panel opens and closes with Escape (Start on a gamepad) on every screen but
    // the match, which has the captured mouse to look after and does it itself.
    if (this.current?.id !== 'match' && ctx.input.state.pressed.menu) ctx.settings.setOpen(!ctx.settings.open);
    if (ctx.runtime) {
      ctx.runtime.update(dt, time / 1000);
    } else if (renderer) {
      // Menus: the pristine city turns slowly behind them, drawn at half rate.
      ctx.input.poll(dt);
      ctx.audio.update(dt);
      this.backdrop.aim({ x: 0, y: 30, z: 0, radius: 820, height: 300, speed: 0.025 }, dt, 0.8);
      if (this.menuFrame++ % 2 === 0) {
        renderer.update(null, dt * 2, null);
        this.backdrop.apply(renderer.camera);
        renderer.render();
      }
    }
    this.subtitles.update(ctx.now());
    if (this.afterFrame.length > 0) {
      for (const fn of this.afterFrame.splice(0)) fn();
    }

    const ms = performance.now() - started;
    const stats = this.frameStats;
    stats.count++;
    stats.ms += (ms - stats.ms) * 0.05;
    stats.maxMs = Math.max(stats.maxMs * 0.995, ms);
    this.debug?.update(ctx, ms, dt, this.current?.id ?? 'boot', stats.fps);
  };
}
