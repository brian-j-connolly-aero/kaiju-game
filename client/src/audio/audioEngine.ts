/**
 * The audio engine, with the interface the rest of the client keeps for good:
 *
 *   play / loop     positional or flat sound effects by manifest id, with variants
 *   music           one track at a time, or a staged pair: a base stem that always plays and a
 *                   combat stem of the same length that fades in when the fight is on
 *   voice           a queue of spoken lines; while one plays, music and effects duck and the
 *                   subtitle callback fires with the words
 *
 * Every sound has a fallback (ARCHITECTURE.md section 5): an effect that is not in the manifest
 * or fails to load becomes a short synthesized beep or thump, music becomes a quiet drone, and
 * a voice line becomes radio blips with its subtitle. Missing audio is a console warning, never
 * an error. Browsers only allow sound after a click or key press: `unlock()` is called from one.
 */

import type { AssetStore } from '../assets/assetStore';

export interface PlayOptions {
  /** World position; leave out for a sound that is not in the world (UI, music stings). */
  x?: number;
  y?: number;
  z?: number;
  gain?: number;
  /** Playback speed and pitch, 1 = as recorded. */
  rate?: number;
  /** Distance at which a positional sound starts to fall off, meters. */
  refDistance?: number;
}

export interface LoopHandle {
  setGain(gain: number): void;
  setPosition(x: number, y: number, z: number): void;
  stop(fadeSeconds?: number): void;
}

export interface SpokenLine {
  id: string;
  speaker: string;
  text: string;
}

export interface VoiceOptions {
  /** Higher plays sooner; a full queue drops the lowest. */
  priority?: number;
  /** Radio lines open and close with a squelch. */
  radio?: boolean;
}

export type Bus = 'master' | 'music' | 'sfx' | 'voice';

const MAX_VOICES = 28;
const VOICE_QUEUE_LIMIT = 4;
const VOICE_STALE_SECONDS = 7;
const DUCK_MUSIC = 0.4;
const DUCK_SFX = 0.65;

interface QueuedLine {
  line: SpokenLine;
  priority: number;
  radio: boolean;
  queuedAt: number;
}

interface MusicLayer {
  id: string;
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export class AudioEngine {
  /** Called when a line starts (with how long it will show) and when the voice falls silent (null). */
  onSubtitle: ((line: SpokenLine | null, seconds: number) => void) | null = null;

  private readonly assets: AssetStore;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Exclude<Bus, 'master'>, GainNode> | null = null;
  private readonly volumes: Record<Bus, number> = { master: 0.9, music: 0.55, sfx: 0.9, voice: 1 };
  private muted = false;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly ready = new Map<string, AudioBuffer | null>();
  private readonly warned = new Set<string>();
  private active = 0;
  private noise: AudioBuffer | null = null;

  private musicLayers: MusicLayer[] = [];
  private musicKey = '';
  private wantedMusic: { ids: string[]; options: { loop?: boolean; fade?: number } } | null = null;
  private combat = 0;
  private combatTarget = 0;

  private readonly voiceQueue: QueuedLine[] = [];
  private speaking = false;
  private voiceToken = 0;

  constructor(assets: AssetStore, muted = false) {
    this.assets = assets;
    this.muted = muted;
  }

  // --- set-up ----------------------------------------------------------------------------------

  /** True once sound can actually be heard. */
  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Creates the audio context if needed and starts it. Call from a click or key press. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.warnOnce('context', 'this browser has no Web Audio; the game is silent.');
        return;
      }
      try {
        this.ctx = new Ctor();
      } catch (err) {
        this.warnOnce('context', `audio could not start (${err instanceof Error ? err.message : String(err)}); the game is silent.`);
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      const make = (): GainNode => {
        const g = ctx.createGain();
        g.connect(this.master as GainNode);
        return g;
      };
      this.buses = { music: make(), sfx: make(), voice: make() };
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`audio: ${message}`);
  }

  private applyVolumes(): void {
    if (!this.master || !this.buses || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(this.volumes.voice, t, 0.05);
    const duck = this.speaking;
    this.buses.music.gain.setTargetAtTime(this.volumes.music * (duck ? DUCK_MUSIC : 1), t, 0.15);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx * (duck ? DUCK_SFX : 1), t, 0.15);
  }

  setVolume(bus: Bus, value: number): void {
    this.volumes[bus] = Math.min(1, Math.max(0, value));
    this.applyVolumes();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Where the listener is and which way it looks (the camera). */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(x, t, 0.03);
      l.positionY.setTargetAtTime(y, t, 0.03);
      l.positionZ.setTargetAtTime(z, t, 0.03);
      l.forwardX.setTargetAtTime(fx, t, 0.03);
      l.forwardY.setTargetAtTime(fy, t, 0.03);
      l.forwardZ.setTargetAtTime(fz, t, 0.03);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Older browsers only have the method form.
      const legacy = l as unknown as { setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (...v: number[]) => void };
      legacy.setPosition?.(x, y, z);
      legacy.setOrientation?.(fx, fy, fz, 0, 1, 0);
    }
  }

  // --- buffers ---------------------------------------------------------------------------------

  private load(base: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(base);
    if (!pending) {
      const ctx = this.ctx;
      if (!ctx) return Promise.resolve(null);
      pending = fetch(this.assets.audioUrl(base))
        .then((r) => {
          if (!r.ok) throw new Error(`status ${r.status}`);
          return r.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .catch((err: unknown) => {
          this.warnOnce(`load:${base}`, `could not load ${base} (${err instanceof Error ? err.message : String(err)}); using a synthesized stand-in.`);
          return null;
        })
        .then((buffer) => {
          this.ready.set(base, buffer);
          return buffer;
        });
      this.buffers.set(base, pending);
    }
    return pending;
  }

  /** Starts loading effects ahead of time so their first use is not late. */
  preload(ids: string[]): void {
    if (!this.ctx) return;
    for (const id of ids) {
      const entry = this.assets.manifest.sfx[id];
      if (entry) for (const variant of entry.variants) void this.load(variant);
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let s = 22222;
      for (let i = 0; i < data.length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        data[i] = s / 2147483648 - 1;
      }
      this.noise = buffer;
    }
    return this.noise;
  }

  // --- effects ---------------------------------------------------------------------------------

  private output(options: PlayOptions, gain: number): { input: AudioNode; nodes: AudioNode[] } | null {
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    const nodes: AudioNode[] = [g];
    if (options.x !== undefined && options.z !== undefined) {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = options.refDistance ?? 20;
      panner.rolloffFactor = 1.1;
      panner.maxDistance = 6000;
      panner.positionX.value = options.x;
      panner.positionY.value = options.y ?? 1;
      panner.positionZ.value = options.z;
      g.connect(panner);
      panner.connect(buses.sfx);
      nodes.push(panner);
    } else {
      g.connect(buses.sfx);
    }
    return { input: g, nodes };
  }

  /** A synthesized stand-in: a thump of noise for impacts, a short tone for everything else. */
  private beep(id: string, options: PlayOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = this.output(options, (options.gain ?? 1) * 0.35);
    if (!out) return;
    const t = ctx.currentTime;
    const h = hashOf(id);
    const impact = /explosion|crumble|stomp|crush|break|fire|launch|blast|step|hit|roar|death/.test(id);
    const env = ctx.createGain();
    env.connect(out.input);
    if (impact) {
      const length = 0.18 + (h % 5) * 0.08;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180 + (h % 900);
      src.connect(filter);
      filter.connect(env);
      env.gain.setValueAtTime(1, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + length);
      src.start(t);
      src.stop(t + length + 0.02);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = (220 + (h % 660)) * (options.rate ?? 1);
      osc.connect(env);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  }

  /**
   * Plays an effect by id. An id without a manifest entry or whose file did not load plays a
   * synthesized stand-in. A file that is still loading is played when it arrives if that is
   * soon enough to still make sense.
   */
  play(id: string, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.active >= MAX_VOICES) return;
    const entry = this.assets.manifest.sfx[id];
    if (!entry || entry.variants.length === 0) {
      if (this.assets.hasManifest) this.warnOnce(`sfx:${id}`, `no sound "${id}" yet; playing a beep.`);
      this.beep(id, options);
      return;
    }
    const variant = entry.variants[Math.floor(Math.random() * entry.variants.length)];
    const asked = ctx.currentTime;
    const start = (buffer: AudioBuffer | null): void => {
      if (!buffer) {
        this.beep(id, options);
        return;
      }
      if (ctx.currentTime - asked > 0.25) return;
      const out = this.output(options, (options.gain ?? 1) * (entry.gain ?? 1));
      if (!out) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = options.rate ?? 1;
      src.connect(out.input);
      this.active++;
      src.onended = () => {
        this.active = Math.max(0, this.active - 1);
        for (const node of out.nodes) node.disconnect();
      };
      src.start();
    };
    if (this.ready.has(variant)) start(this.ready.get(variant) ?? null);
    else void this.load(variant).then(start);
  }

  /** Starts a looping effect. The handle keeps working (as a no-op) when there is no audio. */
  loop(id: string, options: PlayOptions = {}): LoopHandle {
    const ctx = this.ctx;
    const entry = this.assets.manifest.sfx[id];
    let stopped = false;
    let gainNode: GainNode | null = null;
    let panner: PannerNode | null = null;
    let source: AudioBufferSourceNode | null = null;
    let wanted = options.gain ?? 1;
    if (ctx && ctx.state === 'running' && entry && entry.variants.length > 0) {
      void this.load(entry.variants[0]).then((buffer) => {
        if (stopped || !buffer) return;
        const out = this.output(options, 0);
        if (!out) return;
        gainNode = out.input as GainNode;
        panner = (out.nodes.find((n) => n instanceof PannerNode) as PannerNode | undefined) ?? null;
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        if (entry.loop && entry.loop[1] > entry.loop[0]) {
          source.loopStart = entry.loop[0];
          source.loopEnd = Math.min(buffer.duration, entry.loop[1]);
        }
        source.connect(gainNode);
        gainNode.gain.setTargetAtTime(wanted * (entry.gain ?? 1), ctx.currentTime, 0.2);
        source.start();
      });
    } else if (ctx && this.assets.hasManifest && !entry) {
      this.warnOnce(`sfx:${id}`, `no sound "${id}" yet; the loop is silent.`);
    }
    return {
      setGain: (gain) => {
        wanted = gain;
        if (gainNode && ctx) gainNode.gain.setTargetAtTime(gain * (entry?.gain ?? 1), ctx.currentTime, 0.1);
      },
      setPosition: (x, y, z) => {
        if (panner) {
          panner.positionX.value = x;
          panner.positionY.value = y;
          panner.positionZ.value = z;
        }
      },
      stop: (fadeSeconds = 0.25) => {
        if (stopped) return;
        stopped = true;
        if (source && gainNode && ctx) {
          gainNode.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fadeSeconds / 3));
          const s = source;
          const g = gainNode;
          const p = panner;
          setTimeout(() => {
            try {
              s.stop();
            } catch {
              // Already stopped.
            }
            g.disconnect();
            p?.disconnect();
          }, fadeSeconds * 1000 + 80);
        }
      },
    };
  }

  // --- music -----------------------------------------------------------------------------------

  private stopMusic(fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const old = this.musicLayers;
    this.musicLayers = [];
    for (const layer of old) {
      layer.gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 3));
      setTimeout(() => {
        try {
          layer.source.stop();
        } catch {
          // Already stopped.
        }
        layer.gain.disconnect();
      }, fade * 1000 + 100);
    }
  }

  /** A quiet two-note drone, for a track that has no file. */
  private drone(id: string, when: number, gain: GainNode): OscillatorNode {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55 + (hashOf(id) % 5) * 6.875;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const level = ctx.createGain();
    level.gain.value = 0.25;
    osc.connect(filter);
    filter.connect(level);
    level.connect(gain);
    osc.start(when);
    return osc;
  }

  /**
   * Plays music. `ids` is one track, or a base stem followed by a combat stem: stems start on
   * the same instant and loop together, and `setCombat` fades the second one in and out.
   * Calling it again with the same ids changes nothing.
   */
  playMusic(ids: string[], options: { loop?: boolean; fade?: number } = {}): void {
    const ctx = this.ctx;
    const buses = this.buses;
    const key = ids.join('+');
    this.wantedMusic = { ids, options };
    if (key === this.musicKey) return;
    // Not audible yet (no click so far): `update` starts it once sound is allowed.
    if (!ctx || !buses || ctx.state !== 'running') return;
    this.musicKey = key;
    const fade = options.fade ?? 1.2;
    this.stopMusic(fade);
    if (ids.length === 0) return;
    const loop = options.loop !== false;
    const entries = ids.map((id) => this.assets.manifest.music[id]);
    const token = key;
    void Promise.all(entries.map((entry) => (entry ? this.load(entry.base) : Promise.resolve(null)))).then((buffers) => {
      if (this.musicKey !== token || !this.ctx) return;
      const when = ctx.currentTime + 0.05;
      const layers: MusicLayer[] = [];
      ids.forEach((id, i) => {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(buses.music);
        const target = i === 0 ? 1 : this.combat;
        gain.gain.setTargetAtTime(target, when, Math.max(0.01, fade / 3));
        const buffer = buffers[i];
        const entry = entries[i];
        if (buffer) {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.loop = loop;
          if (loop && entry?.loop && entry.loop[1] > entry.loop[0]) {
            src.loopStart = entry.loop[0];
            src.loopEnd = Math.min(buffer.duration, entry.loop[1]);
          }
          src.connect(gain);
          src.start(when);
          layers.push({ id, source: src, gain });
        } else {
          if (!entry && this.assets.hasManifest) this.warnOnce(`music:${id}`, `no music "${id}" yet; playing a drone.`);
          // A drone only stands in for the base stem; a missing combat stem is simply silent.
          if (i === 0) layers.push({ id, source: this.drone(id, when, gain), gain });
          else gain.disconnect();
        }
      });
      this.musicLayers = layers;
    });
  }

  /** How much of the combat stem to mix in, 0..1. It follows smoothly. */
  setCombat(amount: number): void {
    this.combatTarget = Math.min(1, Math.max(0, amount));
  }

  /** The id (or joined ids) of the music that was last asked for. */
  get music(): string {
    return this.wantedMusic ? this.wantedMusic.ids.join('+') : '';
  }

  // --- voice -----------------------------------------------------------------------------------

  /** Queues a spoken line. Its subtitle shows while it plays, even when its audio is missing. */
  say(line: SpokenLine, options: VoiceOptions = {}): void {
    const q: QueuedLine = { line, priority: options.priority ?? 1, radio: options.radio ?? false, queuedAt: performance.now() / 1000 };
    this.voiceQueue.push(q);
    this.voiceQueue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    if (this.voiceQueue.length > VOICE_QUEUE_LIMIT) this.voiceQueue.length = VOICE_QUEUE_LIMIT;
    if (!this.speaking) this.nextLine();
  }

  /** Silences the voice and empties the queue (a new screen, a new match). */
  clearVoice(): void {
    this.voiceQueue.length = 0;
    this.voiceToken++;
    if (this.speaking) {
      this.speaking = false;
      this.applyVolumes();
      this.onSubtitle?.(null, 0);
    }
  }

  private nextLine(): void {
    const now = performance.now() / 1000;
    let next = this.voiceQueue.shift();
    // A line that waited too long is no longer news.
    while (next && now - next.queuedAt > VOICE_STALE_SECONDS && next.priority < 3) next = this.voiceQueue.shift();
    if (!next) {
      if (this.speaking) {
        this.speaking = false;
        this.applyVolumes();
        this.onSubtitle?.(null, 0);
      }
      return;
    }
    const q = next;
    const token = ++this.voiceToken;
    this.speaking = true;
    this.applyVolumes();
    const entry = this.assets.manifest.voice[q.line.id];
    const estimate = Math.min(6, 0.9 + q.line.text.length * 0.055);
    const finish = (seconds: number): void => {
      setTimeout(() => {
        if (token !== this.voiceToken) return;
        if (q.radio) this.play('radio_close', { gain: 0.5 });
        this.nextLine();
      }, seconds * 1000 + 150);
    };
    const ctx = this.ctx;
    const buses = this.buses;
    if (q.radio) this.play('radio_open', { gain: 0.5 });
    if (!ctx || !buses || ctx.state !== 'running' || !entry) {
      if (!entry && this.assets.hasManifest) this.warnOnce('voice', 'voice lines have no audio yet; showing subtitles with radio blips.');
      this.onSubtitle?.(q.line, estimate);
      this.blips(q.line, estimate);
      finish(estimate);
      return;
    }
    void this.load(entry.base).then((buffer) => {
      if (token !== this.voiceToken) return;
      if (!buffer) {
        this.onSubtitle?.(q.line, estimate);
        this.blips(q.line, estimate);
        finish(estimate);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(buses.voice);
      src.start();
      this.onSubtitle?.(q.line, buffer.duration + 0.3);
      finish(buffer.duration);
    });
  }

  /** Stand-in speech: a few soft blips whose pitch depends on the speaker. */
  private blips(line: SpokenLine, seconds: number): void {
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses || ctx.state !== 'running') return;
    const base = 180 + (hashOf(line.speaker) % 220);
    const count = Math.max(2, Math.min(14, Math.round(seconds * 3.2)));
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + 0.1 + (i / count) * (seconds - 0.3);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = base * (1 + ((hashOf(line.id) >> i) & 3) * 0.12);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(env);
      env.connect(buses.voice);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  // --- per frame -------------------------------------------------------------------------------

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const wanted = this.wantedMusic;
    if (wanted && ctx.state === 'running' && wanted.ids.join('+') !== this.musicKey) this.playMusic(wanted.ids, wanted.options);
    if (Math.abs(this.combat - this.combatTarget) > 0.001) {
      this.combat += (this.combatTarget - this.combat) * Math.min(1, dt * 1.2);
      const layer = this.musicLayers[1];
      if (layer) layer.gain.gain.setTargetAtTime(this.combat, ctx.currentTime, 0.2);
    }
  }
}
