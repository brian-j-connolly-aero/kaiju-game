/**
 * The audio engine, with the interface the rest of the client keeps for good:
 *
 *   play / loop     positional or flat sound effects by manifest id, with variants
 *   music           one track at a time, or a staged pair: a base stem that always plays and a
 *                   combat stem of the same length that fades in when the fight is on
 *   voice           a queue of spoken lines; while one plays, music and effects duck and the
 *                   subtitle callback fires with the words
 *   volume          setMasterVolume / getMasterVolume (0 to 1), setVolume per bus, setMuted
 *
 * Every sound has a fallback (ARCHITECTURE.md section 5): an effect that is not in the manifest
 * or fails to load becomes a short synthesized beep or thump, music becomes a quiet drone, and
 * a voice line becomes radio blips with its subtitle. Missing audio is a console warning, never
 * an error. Browsers only allow sound after a click or key press: `unlock()` is called from one.
 *
 * Three things keep the mix in bounds whatever the game throws at it:
 *
 *   voice limits    a sound may have a few copies playing at once; copies asked for on the same
 *                   instant (a volley) are spread out by a few hundredths of a second, and when
 *                   there is no room the quietest copy (or one long past its attack) gives way
 *   the limiter     everything passes through a compressor set as a limiter, so a full salvo is
 *                   loud instead of clipped
 *   the cache       decoded music is dropped once it is no longer playing or announced, and only
 *                   the most recent voice lines are kept
 */

import type { Manifest, MusicEntry } from '../assets/manifest';

/** `mark`: seconds into a one-shot of the moment that is written to land on a game event (ASSETS.md section 7). */
type MarkedMusic = MusicEntry & { mark?: number };

/** What the engine needs from the asset store. */
export interface AudioAssets {
  readonly manifest: Manifest;
  readonly hasManifest: boolean;
  /** Full address of an audio file given its manifest path without extension. */
  audioUrl(base: string): string;
}

/** Seams for tests and for measuring the mix offline. */
export interface AudioEnv {
  /** Makes the audio context (default: the browser's). */
  createContext?: () => AudioContext;
}

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
  /** Loops only: come in at full level at once (from the loop start) instead of swelling in. */
  sharp?: boolean;
}

export interface LoopHandle {
  setGain(gain: number): void;
  /** Playback speed and pitch, 1 = as recorded. It follows smoothly. */
  setRate(rate: number): void;
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
  /**
   * A radio line. Recorded radio lines carry their own key click and squelch tail, so nothing is
   * added to them; only a radio line WITHOUT audio gets the squelch effects around its blips.
   */
  radio?: boolean;
  /**
   * Seconds the line may wait before it is no longer worth saying. Default: 7 s, and never for
   * priority 3 and above.
   */
  staleAfter?: number;
  /** May cut off a line of priority 1 or lower that is being spoken (an order on a busy radio). */
  cutsIn?: boolean;
}

export interface MusicOptions {
  /** Kept for callers; whether a track loops is decided by its manifest entry (`loop` points). */
  loop?: boolean;
  /** Seconds the new music takes to come in (default 1.2). */
  fade?: number;
  /** Seconds the music that is leaving takes to go (default: the same as `fade`). */
  fadeOut?: number;
  /**
   * Seconds from now until the game event this one-shot is written to land on (the manifest's
   * `mark`): the file is started part-way in, or after a wait, so that the mark falls on the
   * event however late the file arrives. Nothing plays once the event has passed.
   */
  landIn?: number;
}

export type Bus = 'master' | 'music' | 'sfx' | 'voice';

/** Voices of all effects together. */
const MAX_VOICES = 28;
/** Copies of one sound that may play at once. */
const MAX_PER_SOUND = 6;
/** Copies of one sound asked for together start this far apart, in turn (irregular on purpose). */
const STAGGER_STEPS = [0.026, 0.037, 0.03, 0.041];
/** A copy that would have to wait longer than this for its turn is not played. */
const STAGGER_WINDOW = 0.15;
/** A copy this long into its sound is taken to be past its attack, and to lose half its weight every so often. */
const TAIL_AFTER = 0.1;
const TAIL_HALVES_IN = 0.15;
/** A file that arrives later than this after its sound was asked for is not played. */
const LATE_SECONDS = 0.25;
const VOICE_QUEUE_LIMIT = 4;
const VOICE_STALE_SECONDS = 7;
const DUCK_MUSIC = 0.4;
const DUCK_SFX = 0.65;
/** Decoded voice lines kept for reuse (about 0.7 MB each), besides the ones loaded ahead. */
const VOICE_CACHE = 24;
/** The lead with which music sources are scheduled. */
const MUSIC_LEAD = 0.05;

/**
 * The limiter: a compressor with a hard knee and the steepest ratio. Below the threshold the
 * mix passes untouched; above it the level hardly rises. Measured in Chromium with a 1 kHz tone:
 * -12 dB in gives -12.0 out, 0 dB gives -2.8, +12 dB gives -2.1, +18 dB gives -1.7, with no
 * overshoot at the start of a burst (the node looks 6 ms ahead, which is also the delay it adds).
 */
export const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.2 } as const;
/** Seconds after the audio context is made before the limiter gets its fast attack (see `unlock`). */
const LIMITER_SETTLE = 0.25;

/**
 * A compressor node adds a fixed "makeup" gain of its own that depends only on its settings
 * (Web Audio specification: the gain at full scale, inverted, to the power 0.6). This is the
 * gain that undoes it, so that sound under the threshold leaves at the level it came in.
 */
export function limiterTrim(threshold: number = LIMITER.threshold, ratio: number = LIMITER.ratio): number {
  const fullScaleDb = threshold + (0 - threshold) / ratio;
  return Math.pow(10, (0.6 * fullScaleDb) / 20);
}

interface QueuedLine {
  line: SpokenLine;
  priority: number;
  radio: boolean;
  queuedAt: number;
  staleAfter: number;
}

/** The line being spoken (or loading). */
interface CurrentLine {
  q: QueuedLine;
  /** Everything the line sounds through, so that it can be cut. */
  gain: GainNode | null;
  source: AudioBufferSourceNode | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface MusicLayer {
  id: string;
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
}

interface WantedMusic {
  ids: string[];
  options: MusicOptions;
  /** Local time (seconds) of the event the cue lands on, or null. */
  landAt: number | null;
}

/** One effect that is sounding or about to. */
interface Voice {
  id: string;
  /** How loud it is at the listener, roughly: gain times distance falloff. */
  level: number;
  when: number;
  until: number;
  kill(now: number): void;
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function seconds(): number {
  return performance.now() / 1000;
}

export class AudioEngine {
  /** Called when a line starts (with how long it will show) and when the voice falls silent (null). */
  onSubtitle: ((line: SpokenLine | null, seconds: number) => void) | null = null;

  private readonly assets: AudioAssets;
  private readonly env: AudioEnv;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Exclude<Bus, 'master'>, GainNode> | null = null;
  private readonly volumes: Record<Bus, number> = { master: 0.9, music: 0.55, sfx: 0.9, voice: 1 };
  private muted = false;
  /** The page is hidden: the context is paused and nothing new starts. */
  private hidden = false;
  private pausedByHide = false;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly ready = new Map<string, AudioBuffer | null>();
  /** Files asked for before there was a context to decode them. */
  private readonly loadLater = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly voices: Voice[] = [];
  private noise: AudioBuffer | null = null;
  private readonly listener = { x: 0, y: 0, z: 0, set: false };

  private musicLayers: MusicLayer[] = [];
  private musicKey = '';
  private wantedMusic: WantedMusic | null = null;
  /** Music files (manifest paths) announced with preloadMusic: kept decoded until released. */
  private readonly musicKept = new Set<string>();
  private combat = 0;
  private combatTarget = 0;

  private readonly voiceQueue: QueuedLine[] = [];
  private current: CurrentLine | null = null;
  /** Voice files loaded ahead: never dropped from the cache until released. */
  private readonly voiceKept = new Set<string>();
  /** Voice files that were spoken, oldest first. */
  private readonly voiceRecent: string[] = [];

  constructor(assets: AudioAssets, muted = false, env: AudioEnv = {}) {
    this.assets = assets;
    this.muted = muted;
    this.env = env;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.setHidden(document.visibilityState === 'hidden'));
    }
  }

  // --- set-up ----------------------------------------------------------------------------------

  /** True once sound can actually be heard. */
  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && !this.hidden;
  }

  /** Creates the audio context if needed and starts it. Call from a click or key press. */
  unlock(): void {
    if (!this.ctx) {
      try {
        if (this.env.createContext) {
          this.ctx = this.env.createContext();
        } else {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctor) {
            this.warnOnce('context', 'this browser has no Web Audio; the game is silent.');
            return;
          }
          this.ctx = new Ctor();
        }
      } catch (err) {
        this.warnOnce('context', `audio could not start (${err instanceof Error ? err.message : String(err)}); the game is silent.`);
        return;
      }
      const ctx = this.ctx;
      // buses -> mix -> limiter -> trim -> master volume -> out. The volume comes after the
      // limiter, so turning the game down never changes how the mix itself sounds.
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volumes.master;
      this.master.connect(ctx.destination);
      const trim = ctx.createGain();
      trim.gain.value = limiterTrim();
      trim.connect(this.master);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = LIMITER.threshold;
      limiter.knee.value = LIMITER.knee;
      limiter.ratio.value = LIMITER.ratio;
      // A compressor that has only just been made ducks whatever passes through it for its first
      // tenth of a second when its attack is fast (measured in Chromium: 15 dB in the first
      // 10 ms, which swallowed the very first click). So it starts slow and is set to its real
      // attack a moment later.
      limiter.attack.value = 1;
      limiter.attack.setValueAtTime(LIMITER.attack, ctx.currentTime + LIMITER_SETTLE);
      limiter.release.value = LIMITER.release;
      limiter.connect(trim);
      const make = (): GainNode => {
        const g = ctx.createGain();
        g.connect(limiter);
        return g;
      };
      this.buses = { music: make(), sfx: make(), voice: make() };
      this.buses.music.gain.value = this.volumes.music;
      this.buses.sfx.gain.value = this.volumes.sfx;
      this.buses.voice.gain.value = this.volumes.voice;
      for (const base of this.loadLater) void this.load(base);
      this.loadLater.clear();
    }
    if (this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume().catch(() => undefined);
  }

  /**
   * Tells the engine the page was hidden or shown again (it listens to the browser itself; this
   * is the same switch for tests). Hidden: the line being spoken is dropped and the sound is
   * paused, so no loop drones on while nobody is looking. Shown: the sound carries on.
   */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) {
      this.clearVoice();
      if (ctx.state === 'running') {
        this.pausedByHide = true;
        void ctx.suspend().catch(() => undefined);
      }
    } else {
      if (this.pausedByHide) void ctx.resume().catch(() => undefined);
      this.pausedByHide = false;
      // A cue that is timed to a game event stood still while the game went on: start it again
      // from where it should be by now (`update` does, or drops it if its moment has passed).
      if (this.wantedMusic && this.wantedMusic.landAt !== null && this.musicKey !== '') {
        this.stopMusic(0.05);
        this.musicKey = '';
      }
    }
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
    const duck = this.current !== null;
    this.buses.music.gain.setTargetAtTime(this.volumes.music * (duck ? DUCK_MUSIC : 1), t, 0.15);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx * (duck ? DUCK_SFX : 1), t, 0.15);
  }

  /** Sets the level of one bus, 0 to 1. Anything else is brought into that range; not-a-number is ignored. */
  setVolume(bus: Bus, value: number): void {
    if (!Number.isFinite(value)) return;
    this.volumes[bus] = Math.min(1, Math.max(0, value));
    this.applyVolumes();
  }

  getVolume(bus: Bus): number {
    return this.volumes[bus];
  }

  /**
   * The volume of everything, 0 (silent) to 1 (full). The change is eased in over about a
   * tenth of a second, so it can be called on every movement of a slider. It works before the
   * first click too: the value is kept and applied when sound starts. Muting is separate
   * (`setMuted`) and does not change this value.
   */
  setMasterVolume(value: number): void {
    this.setVolume('master', value);
  }

  /** The volume last set with `setMasterVolume` (0.9 until someone sets it). */
  getMasterVolume(): number {
    return this.volumes.master;
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
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    this.listener.set = true;
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

  /**
   * What is sounding and what is held in memory, for the debug hook and for tests: effect
   * voices, decoded files, and the megabytes they take (all of them, and the music alone).
   */
  stats(): { voices: number; buffers: number; megabytes: number; musicMegabytes: number } {
    const size = (buffer: AudioBuffer): number => (buffer.length * buffer.numberOfChannels * 4) / 1e6;
    let megabytes = 0;
    let buffers = 0;
    for (const buffer of this.ready.values()) {
      if (!buffer) continue;
      buffers++;
      megabytes += size(buffer);
    }
    let musicMegabytes = 0;
    for (const entry of Object.values(this.assets.manifest.music)) {
      const buffer = this.ready.get(entry.base);
      if (buffer) musicMegabytes += size(buffer);
    }
    const now = this.ctx ? this.ctx.currentTime : 0;
    return { voices: this.voices.filter((v) => v.until > now).length, buffers, megabytes, musicMegabytes };
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
          // Dropped from the cache while it was on its way: whoever asked still gets it.
          if (this.buffers.get(base) === pending) this.ready.set(base, buffer);
          return buffer;
        });
      this.buffers.set(base, pending);
    }
    return pending;
  }

  /** Loads a file ahead of its use; before sound is unlocked the request is kept for later. */
  private loadAhead(base: string): void {
    if (this.ctx) void this.load(base);
    else this.loadLater.add(base);
  }

  /** Forgets a decoded file. A source that is playing it keeps its own hold until it ends. */
  private drop(base: string): void {
    this.buffers.delete(base);
    this.ready.delete(base);
  }

  /** Starts loading effects ahead of time so their first use is not late. */
  preload(ids: string[]): void {
    for (const id of ids) {
      const entry = this.assets.manifest.sfx[id];
      if (entry) for (const variant of entry.variants) this.loadAhead(variant);
    }
  }

  /**
   * Announces music that will be needed soon: it is loaded now and kept decoded until
   * `releaseMusic` lets go of it. Music that was never announced is dropped as soon as other
   * music has taken its place.
   */
  preloadMusic(ids: string[]): void {
    for (const id of ids) {
      const entry = this.assets.manifest.music[id];
      if (!entry) continue;
      this.musicKept.add(entry.base);
      this.loadAhead(entry.base);
    }
  }

  /** Lets go of announced music (all of it when no ids are given). It is dropped when other music next starts. */
  releaseMusic(ids?: string[]): void {
    if (!ids) {
      this.musicKept.clear();
      return;
    }
    for (const id of ids) {
      const entry = this.assets.manifest.music[id];
      if (entry) this.musicKept.delete(entry.base);
    }
  }

  /** Drops every decoded music file that is neither playing now nor announced. */
  private sweepMusic(playing: string[]): void {
    const keep = new Set<string>(this.musicKept);
    for (const id of playing) {
      const entry = this.assets.manifest.music[id];
      if (entry) keep.add(entry.base);
    }
    for (const entry of Object.values(this.assets.manifest.music)) {
      if (!keep.has(entry.base) && this.ready.has(entry.base)) this.drop(entry.base);
    }
  }

  /** Loads voice lines ahead of time (orders that must start at once) and keeps them until released. */
  preloadVoice(ids: string[]): void {
    for (const id of ids) {
      const entry = this.assets.manifest.voice[id];
      if (!entry) continue;
      this.voiceKept.add(entry.base);
      this.loadAhead(entry.base);
    }
  }

  /** Lets go of every voice line loaded ahead (the end of a match). */
  releaseVoice(): void {
    for (const base of this.voiceKept) {
      if (!this.voiceRecent.includes(base)) this.voiceRecent.push(base);
    }
    this.voiceKept.clear();
    this.trimVoiceCache();
  }

  /** Notes that a voice file was just used and drops the ones not used for longest. */
  private touchVoice(base: string): void {
    const at = this.voiceRecent.indexOf(base);
    if (at >= 0) this.voiceRecent.splice(at, 1);
    this.voiceRecent.push(base);
    this.trimVoiceCache();
  }

  private trimVoiceCache(): void {
    let extra = this.voiceRecent.filter((b) => !this.voiceKept.has(b)).length - VOICE_CACHE;
    for (let i = 0; i < this.voiceRecent.length && extra > 0; ) {
      const base = this.voiceRecent[i];
      if (this.voiceKept.has(base)) {
        i++;
        continue;
      }
      this.voiceRecent.splice(i, 1);
      this.drop(base);
      extra--;
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

  private output(options: PlayOptions, gain: number): { input: GainNode; panner: PannerNode | null; nodes: AudioNode[] } | null {
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    const nodes: AudioNode[] = [g];
    let panner: PannerNode | null = null;
    if (options.x !== undefined && options.z !== undefined) {
      panner = ctx.createPanner();
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
    return { input: g, panner, nodes };
  }

  /** How much of a positional sound reaches the listener (the panner's own falloff rule), 0..1. */
  private falloff(options: PlayOptions): number {
    if (options.x === undefined || options.z === undefined || !this.listener.set) return 1;
    const ref = options.refDistance ?? 20;
    const d = Math.hypot(options.x - this.listener.x, (options.y ?? 1) - this.listener.y, options.z - this.listener.z);
    return ref / (ref + 1.1 * (Math.max(d, ref) - ref));
  }

  /**
   * Finds room for one more copy of a sound. Returns the time it may start (copies asked for
   * together are spread out), or null when it is not to be played: there are already as many
   * copies as a sound may have, and none of them is quieter than this one.
   */
  private admit(id: string, level: number): number | null {
    const now = (this.ctx as AudioContext).currentTime;
    const voices = this.voices;
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].until <= now) voices.splice(i, 1);
    const same = voices.filter((v) => v.id === id);
    let when = now;
    if (same.length > 0) {
      const last = same.reduce((latest, v) => Math.max(latest, v.when), -Infinity);
      when = Math.max(now, last + STAGGER_STEPS[same.length % STAGGER_STEPS.length]);
    }
    const crowded = same.length >= MAX_PER_SOUND || when - now > STAGGER_WINDOW;
    const pool = crowded ? same : voices.length >= MAX_VOICES ? voices : null;
    if (pool) {
      // Among copies of one sound, one that began a while ago is in its tail and counts for
      // less: in a long firefight the old tails give way to new shots, while copies asked for
      // on the same instant (a volley) only give way to a louder one.
      const worth = (v: Voice): number => v.level * (crowded ? Math.pow(0.5, Math.max(0, now - v.when - TAIL_AFTER) / TAIL_HALVES_IN) : 1);
      const quietest = pool.reduce((q, v) => (worth(v) < worth(q) ? v : q));
      if (worth(quietest) >= level) return null;
      quietest.kill(now);
      voices.splice(voices.indexOf(quietest), 1);
      // A louder copy takes the place, and the turn, of the quietest one.
      if (crowded) when = Math.max(now, quietest.when);
    }
    return when;
  }

  /** A synthesized stand-in: a thump of noise for impacts, a short tone for everything else. */
  private beep(id: string, options: PlayOptions, when: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = this.output(options, (options.gain ?? 1) * 0.35);
    if (!out) return;
    const t = when;
    const h = hashOf(id);
    const impact = /explosion|crumble|stomp|crush|break|fire|launch|blast|step|hit|roar|death/.test(id);
    const env = ctx.createGain();
    env.connect(out.input);
    let length: number;
    let source: AudioScheduledSourceNode;
    if (impact) {
      length = 0.18 + (h % 5) * 0.08;
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
      source = src;
    } else {
      length = 0.16;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = (220 + (h % 660)) * (options.rate ?? 1);
      osc.connect(env);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + length);
      osc.start(t);
      osc.stop(t + length + 0.02);
      source = osc;
    }
    source.onended = () => {
      for (const node of out.nodes) node.disconnect();
    };
    this.voices.push({
      id,
      level,
      when,
      until: when + length + 0.02,
      kill: (now) => {
        out.input.gain.setTargetAtTime(0, now, 0.004);
      },
    });
  }

  /**
   * Plays an effect by id. An id without a manifest entry or whose file did not load plays a
   * synthesized stand-in. A file that is still loading is played when it arrives if that is
   * soon enough to still make sense. Subject to the voice limits (see the top of this file).
   */
  play(id: string, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked) return;
    const entry = this.assets.manifest.sfx[id];
    const asked = ctx.currentTime;
    const start = (buffer: AudioBuffer | null): void => {
      if (ctx.currentTime - asked > LATE_SECONDS || !this.unlocked) return;
      const gain = (options.gain ?? 1) * (buffer ? (entry?.gain ?? 1) : 1);
      const level = gain * this.falloff(options);
      const when = this.admit(id, level);
      if (when === null) return;
      if (!buffer) {
        this.beep(id, options, when, level);
        return;
      }
      const out = this.output(options, gain);
      if (!out) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const rate = options.rate ?? 1;
      src.playbackRate.value = rate;
      src.connect(out.input);
      const voice: Voice = {
        id,
        level,
        when,
        until: when + buffer.duration / Math.max(0.01, rate),
        kill: (now) => {
          out.input.gain.setTargetAtTime(0, now, 0.004);
          try {
            // Not begun yet: it never sounds. Begun: a few hundredths to fade, then gone.
            src.stop(when > now ? 0 : now + 0.03);
          } catch {
            // Already stopped.
          }
        },
      };
      src.onended = () => {
        const at = this.voices.indexOf(voice);
        if (at >= 0) this.voices.splice(at, 1);
        for (const node of out.nodes) node.disconnect();
      };
      this.voices.push(voice);
      src.start(when);
    };
    if (!entry || entry.variants.length === 0) {
      if (this.assets.hasManifest) this.warnOnce(`sfx:${id}`, `no sound "${id}" yet; playing a beep.`);
      start(null);
      return;
    }
    const variant = entry.variants[Math.floor(Math.random() * entry.variants.length)];
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
    let rate = options.rate ?? 1;
    if (ctx && this.unlocked && entry && entry.variants.length > 0) {
      void this.load(entry.variants[0]).then((buffer) => {
        if (stopped || !buffer) return;
        const out = this.output(options, 0);
        if (!out) return;
        gainNode = out.input;
        panner = out.panner;
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = rate;
        const points = entry.loop && entry.loop[1] > entry.loop[0] ? entry.loop : null;
        if (points) {
          source.loopStart = points[0];
          source.loopEnd = Math.min(buffer.duration, points[1]);
        }
        source.connect(gainNode);
        // A loop file opens with a short fade-in of its own; a sharp start skips it.
        gainNode.gain.setTargetAtTime(wanted * (entry.gain ?? 1), ctx.currentTime, options.sharp ? 0.03 : 0.2);
        source.start(0, options.sharp && points ? points[0] : 0);
      });
    } else if (ctx && this.assets.hasManifest && !entry) {
      this.warnOnce(`sfx:${id}`, `no sound "${id}" yet; the loop is silent.`);
    }
    return {
      setGain: (gain) => {
        if (gain === wanted) return;
        wanted = gain;
        if (gainNode && ctx) gainNode.gain.setTargetAtTime(gain * (entry?.gain ?? 1), ctx.currentTime, 0.1);
      },
      setRate: (r) => {
        if (r === rate) return;
        rate = r;
        if (source && ctx) source.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.05);
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
   * Calling it again with the same ids changes nothing. A track loops when its manifest entry
   * has loop points and plays once when it has none.
   */
  playMusic(ids: string[], options: MusicOptions = {}): void {
    // The deadline is fixed now: when sound is not unlocked yet the music starts later, and a
    // number of seconds "from now" would be stale by then.
    this.wantedMusic = { ids, options, landAt: options.landIn !== undefined ? seconds() + options.landIn : null };
    if (ids.join('+') !== this.musicKey) this.startWanted();
  }

  private startWanted(): void {
    const wanted = this.wantedMusic;
    const ctx = this.ctx;
    const buses = this.buses;
    // Not audible yet (no click so far): `update` starts it once sound is allowed.
    if (!wanted || !ctx || !buses || !this.unlocked) return;
    const { ids, options, landAt } = wanted;
    const key = ids.join('+');
    this.musicKey = key;
    const fade = options.fade ?? 1.2;
    this.stopMusic(options.fadeOut ?? fade);
    if (ids.length === 0) {
      this.sweepMusic([]);
      return;
    }
    const entries = ids.map((id) => this.assets.manifest.music[id]);
    void Promise.all(entries.map((entry) => (entry ? this.load(entry.base) : Promise.resolve(null)))).then((buffers) => {
      if (this.musicKey !== key || !this.ctx) return;
      this.sweepMusic(ids);
      let when = ctx.currentTime + MUSIC_LEAD;
      let offset = 0;
      const mark = (entries[0] as MarkedMusic | undefined)?.mark;
      if (landAt !== null && mark !== undefined) {
        // Worked out now, not when the music was asked for: the file may have taken a while.
        const remaining = landAt - seconds() - MUSIC_LEAD;
        if (remaining <= 0) return;
        offset = mark - remaining;
        if (offset < 0) {
          when -= offset;
          offset = 0;
        }
      }
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
          // An entry without loop points is a one-shot, whatever the caller says.
          const points = entry?.loop && entry.loop[1] > entry.loop[0] ? entry.loop : null;
          src.loop = points !== null;
          if (points) {
            src.loopStart = points[0];
            src.loopEnd = Math.min(buffer.duration, points[1]);
          }
          src.connect(gain);
          src.start(when, Math.min(offset, buffer.duration));
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
    if (this.hidden) return;
    const priority = options.priority ?? 1;
    const q: QueuedLine = {
      line,
      priority,
      radio: options.radio ?? false,
      queuedAt: seconds(),
      staleAfter: options.staleAfter ?? (priority >= 3 ? Infinity : VOICE_STALE_SECONDS),
    };
    this.voiceQueue.push(q);
    this.voiceQueue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    if (this.voiceQueue.length > VOICE_QUEUE_LIMIT) this.voiceQueue.length = VOICE_QUEUE_LIMIT;
    const cur = this.current;
    if (!cur) {
      this.nextLine();
    } else if (options.cutsIn && cur.q.priority <= 1 && this.voiceQueue[0] === q) {
      // Urgent traffic cuts in. The line it cuts loses its own squelch tail, so it gets one.
      const hadAudio = cur.source !== null;
      this.stopCurrent(0.06);
      if (cur.q.radio && hadAudio) this.play('radio_close', { gain: 0.5 });
      this.nextLine();
    }
  }

  /** True while a line is being spoken (or is loading). */
  get speaking(): boolean {
    return this.current !== null;
  }

  /** Silences the voice, the line being spoken included, and empties the queue (a new screen, a new match). */
  clearVoice(): void {
    this.voiceQueue.length = 0;
    if (this.current) {
      this.stopCurrent(0.05);
      this.applyVolumes();
      this.onSubtitle?.(null, 0);
    }
  }

  /** Cuts the line being spoken: a short fade, then its source is stopped and let go. */
  private stopCurrent(fade: number): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    if (cur.timer !== null) clearTimeout(cur.timer);
    const ctx = this.ctx;
    const gain = cur.gain;
    if (!ctx || !gain) return;
    gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.005, fade / 3));
    if (cur.source) {
      try {
        cur.source.stop(ctx.currentTime + fade);
      } catch {
        // Already stopped.
      }
    }
    setTimeout(() => gain.disconnect(), fade * 1000 + 50);
  }

  private nextLine(): void {
    const now = seconds();
    let next = this.voiceQueue.shift();
    // A line that waited too long is no longer news.
    while (next && now - next.queuedAt > next.staleAfter) next = this.voiceQueue.shift();
    if (!next) {
      this.applyVolumes();
      this.onSubtitle?.(null, 0);
      return;
    }
    const q = next;
    const cur: CurrentLine = { q, gain: null, source: null, timer: null };
    this.current = cur;
    this.applyVolumes();
    const entry = this.assets.manifest.voice[q.line.id];
    const estimate = Math.min(6, 0.9 + q.line.text.length * 0.055);
    const ctx = this.ctx;
    const buses = this.buses;
    const finish = (length: number, squelch: boolean): void => {
      cur.timer = setTimeout(() => {
        if (this.current !== cur) return;
        this.current = null;
        cur.gain?.disconnect();
        if (squelch) this.play('radio_close', { gain: 0.5 });
        this.nextLine();
      }, length * 1000 + 150);
    };
    // A subtitle with blips: the only place the squelch effects belong (recorded lines carry their own).
    const standIn = (): void => {
      if (q.radio) this.play('radio_open', { gain: 0.5 });
      this.onSubtitle?.(q.line, estimate);
      if (ctx && buses && this.unlocked) {
        cur.gain = ctx.createGain();
        cur.gain.connect(buses.voice);
        this.blips(q.line, estimate, cur.gain);
      }
      finish(estimate, q.radio);
    };
    if (!ctx || !buses || !this.unlocked || !entry) {
      if (!entry && this.assets.hasManifest) this.warnOnce('voice', 'voice lines have no audio yet; showing subtitles with radio blips.');
      standIn();
      return;
    }
    void this.load(entry.base).then((buffer) => {
      if (this.current !== cur) return;
      if (seconds() - q.queuedAt > q.staleAfter) {
        // The file took too long: the moment the line was for has gone.
        this.current = null;
        this.nextLine();
        return;
      }
      if (!buffer) {
        standIn();
        return;
      }
      this.touchVoice(entry.base);
      const gain = ctx.createGain();
      gain.connect(buses.voice);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start();
      cur.gain = gain;
      cur.source = src;
      this.onSubtitle?.(q.line, buffer.duration + 0.3);
      finish(buffer.duration, false);
    });
  }

  /** Stand-in speech: a few soft blips whose pitch depends on the speaker. */
  private blips(line: SpokenLine, length: number, out: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const base = 180 + (hashOf(line.speaker) % 220);
    const count = Math.max(2, Math.min(14, Math.round(length * 3.2)));
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + 0.1 + (i / count) * (length - 0.3);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = base * (1 + ((hashOf(line.id) >> i) & 3) * 0.12);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(env);
      env.connect(out);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  // --- per frame -------------------------------------------------------------------------------

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const wanted = this.wantedMusic;
    if (wanted && this.unlocked && wanted.ids.join('+') !== this.musicKey) this.startWanted();
    if (Math.abs(this.combat - this.combatTarget) > 0.001) {
      this.combat += (this.combatTarget - this.combat) * Math.min(1, dt * 1.2);
      const layer = this.musicLayers[1];
      if (layer) layer.gain.gain.setTargetAtTime(this.combat, ctx.currentTime, 0.2);
    }
  }
}
