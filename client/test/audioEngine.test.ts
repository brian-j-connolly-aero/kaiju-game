import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyManifest, type Manifest } from '../src/assets/manifest';
import { AudioEngine, LIMITER, limiterTrim, type SpokenLine } from '../src/audio/audioEngine';
import { FakeAudioContext, FakeCompressor, FakeGain, FakePanner, fakeFetch, type FakeFetch, type FakeNode, type FakeSource } from './fakeAudio';

/** The music the game has (ASSETS.md section 6), with the lengths and loop points of the real files. */
const MUSIC: Record<string, { duration: number; loop?: [number, number]; mark?: number }> = {
  lobby: { duration: 80.5, loop: [0.25, 80.25] },
  briefing: { duration: 20.5, loop: [0.25, 20.25] },
  stage1_base: { duration: 80.5, loop: [0.25, 80.25] },
  stage1_combat: { duration: 80.5, loop: [0.25, 80.25] },
  stage2_base: { duration: 80.5, loop: [0.25, 80.25] },
  stage2_combat: { duration: 80.5, loop: [0.25, 80.25] },
  stage3_base: { duration: 80.5, loop: [0.25, 80.25] },
  stage3_combat: { duration: 80.5, loop: [0.25, 80.25] },
  hearing: { duration: 30.5, loop: [0.25, 30.25] },
  cocoon: { duration: 12.5, mark: 10 },
  intermission: { duration: 23.5, mark: 20 },
  win_humans: { duration: 14.5 },
  win_kaiju: { duration: 14.9 },
};

const ONE_SHOTS = ['cocoon', 'intermission', 'win_humans', 'win_kaiju'];
const LOOPS = Object.keys(MUSIC).filter((id) => !ONE_SHOTS.includes(id));

interface Rig {
  engine: AudioEngine;
  ctx: FakeAudioContext;
  fetcher: FakeFetch;
  manifest: Manifest;
  subtitles: Array<string | null>;
}

function rig(options: { unlock?: boolean } = {}): Rig {
  const ctx = new FakeAudioContext();
  const fetcher = fakeFetch();
  vi.stubGlobal('fetch', fetcher);
  const manifest = emptyManifest();
  for (const [id, m] of Object.entries(MUSIC)) {
    manifest.music[id] = { base: `audio/music/${id}`, ...m };
    ctx.durations.set(`audio/music/${id}.ogg`, m.duration);
  }
  for (const id of ['tank_fire', 'rocket_launch', 'explosion_m']) {
    manifest.sfx[id] = { variants: [1, 2, 3].map((n) => `audio/sfx/${id}_${n}`), gain: 1 };
    for (const n of [1, 2, 3]) ctx.durations.set(`audio/sfx/${id}_${n}.ogg`, 1);
  }
  for (const id of ['ui_click', 'radio_open', 'radio_close', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']) {
    manifest.sfx[id] = { variants: [`audio/sfx/${id}`], gain: 1 };
    ctx.durations.set(`audio/sfx/${id}.ogg`, 1);
  }
  manifest.sfx.hum_loop = { variants: ['audio/sfx/hum_loop'], gain: 1, loop: [0.25, 1.25] };
  ctx.durations.set('audio/sfx/hum_loop.ogg', 1.5);
  for (let i = 0; i < 40; i++) {
    manifest.voice[`v_${i}`] = { base: `audio/voice/v_${i}`, duration: 2 };
    ctx.durations.set(`audio/voice/v_${i}.ogg`, 2);
  }
  manifest.voice.v_long = { base: 'audio/voice/v_long', duration: 12 };
  ctx.durations.set('audio/voice/v_long.ogg', 12);
  const engine = new AudioEngine({ manifest, hasManifest: true, audioUrl: (base) => `${base}.ogg` }, false, {
    // The fake has the parts of an audio context the engine uses.
    createContext: () => ctx as unknown as AudioContext,
  });
  const subtitles: Array<string | null> = [];
  engine.onSubtitle = (line) => subtitles.push(line ? line.id : null);
  if (options.unlock !== false) engine.unlock();
  return { engine, ctx, fetcher, manifest, subtitles };
}

const line = (id: string, speaker = 'Overlord'): SpokenLine => ({ id, speaker, text: 'Weak point is open. Fire.' });

/** Lets promise chains (fetch, decode, then) run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Moves the audio clock and the page's clock on together. */
async function pass(ctx: FakeAudioContext, seconds: number): Promise<void> {
  const steps = Math.max(1, Math.round(seconds / 0.05));
  for (let i = 0; i < steps; i++) {
    // Files that were asked for arrive while both clocks still agree; then time moves on.
    await vi.advanceTimersByTimeAsync(0);
    ctx.advance(seconds / steps);
    await vi.advanceTimersByTimeAsync((seconds / steps) * 1000);
  }
}

function inputsOf(ctx: FakeAudioContext, node: FakeNode): FakeNode[] {
  return ctx.nodes.filter((n) => n.outputs.includes(node));
}

function pannerOf(src: FakeSource): FakePanner | null {
  const gain = src.outputs[0];
  const next = gain?.outputs[0];
  return next instanceof FakePanner ? next : null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voice limits', () => {
  it('spreads a volley of one sound over a few voices instead of starting 28 on one instant', async () => {
    const { engine, ctx } = rig();
    engine.preload(['tank_fire']);
    await settle();
    engine.setListener(0, 2, 0, 0, 0, -1);
    for (let i = 0; i < 28; i++) engine.play('tank_fire', { x: i % 5, y: 1, z: 3, refDistance: 30 });
    const starts = ctx.started.map((s) => s.startedAt as number).sort((a, b) => a - b);
    expect(starts).toHaveLength(5);
    expect(new Set(starts).size).toBe(5);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(0.025);
    expect(starts[starts.length - 1]).toBeLessThanOrEqual(0.15);
    expect(engine.stats().voices).toBe(5);
  });

  it('lets a louder copy take the place of the quietest one', async () => {
    const { engine, ctx } = rig();
    engine.preload(['tank_fire']);
    await settle();
    engine.setListener(0, 2, 0, 0, 0, -1);
    for (let i = 0; i < 10; i++) engine.play('tank_fire', { x: 600, y: 1, z: 0, refDistance: 30 });
    for (let i = 0; i < 3; i++) engine.play('tank_fire', { x: 2, y: 1, z: 0, refDistance: 30 });
    // The far copies that gave way are stopped before they sound (or faded out if they had begun).
    const stopped = ctx.started.filter((s) => s.stoppedAt !== null);
    expect(stopped).toHaveLength(3);
    for (const s of stopped) expect(pannerOf(s)?.positionX.value).toBe(600);
    await pass(ctx, 0.2);
    const sounding = ctx.playing();
    expect(sounding).toHaveLength(5);
    expect(sounding.filter((s) => pannerOf(s)?.positionX.value === 2)).toHaveLength(3);
  });

  it('drops a copy that is no louder than what is already playing', async () => {
    const { engine, ctx } = rig();
    engine.preload(['tank_fire']);
    await settle();
    for (let i = 0; i < 40; i++) engine.play('tank_fire');
    expect(ctx.started).toHaveLength(5);
    expect(ctx.started.every((s) => s.stoppedAt === null)).toBe(true);
  });

  it('keeps room for other sounds while one sound is at its limit, and caps the total', async () => {
    const { engine, ctx } = rig();
    engine.preload(['tank_fire', 'ui_click', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
    await settle();
    for (let i = 0; i < 45; i++) engine.play('tank_fire');
    engine.play('ui_click');
    expect(ctx.startedFrom('ui_click')).toHaveLength(1);
    for (let n = 0; n < 8; n++) for (let i = 0; i < 8; i++) engine.play(`s${n}`);
    expect(engine.stats().voices).toBeLessThanOrEqual(28);
    expect(ctx.started.length).toBeLessThanOrEqual(28);
  });

  it('frees a voice when its sound has ended', async () => {
    const { engine, ctx } = rig();
    engine.preload(['tank_fire']);
    await settle();
    for (let i = 0; i < 12; i++) engine.play('tank_fire');
    await pass(ctx, 1.5);
    expect(engine.stats().voices).toBe(0);
    engine.play('tank_fire');
    expect(ctx.started).toHaveLength(6);
    expect(ctx.started[5].startedAt).toBeCloseTo(ctx.currentTime, 5);
  });

  it('holds the synthesized stand-ins to the same limits', () => {
    const { engine, ctx } = rig();
    for (let i = 0; i < 20; i++) engine.play('not_in_the_manifest');
    expect(ctx.oscillators).toHaveLength(5);
    expect(new Set(ctx.oscillators.map((o) => o.startedAt)).size).toBe(5);
  });
});

describe('the limiter and the master volume', () => {
  it('sends every bus through one limiter, then the trim, then the master volume', () => {
    const { ctx } = rig();
    const intoOut = inputsOf(ctx, ctx.destination);
    expect(intoOut).toHaveLength(1);
    const master = intoOut[0] as FakeGain;
    const trims = inputsOf(ctx, master);
    expect(trims).toHaveLength(1);
    const trim = trims[0] as FakeGain;
    expect(trim.gain.value).toBeCloseTo(limiterTrim(), 6);
    const limiters = inputsOf(ctx, trim);
    expect(limiters.map((n) => n.kind)).toEqual(['compressor']);
    const limiter = limiters[0] as FakeCompressor;
    expect(limiter.threshold.value).toBe(LIMITER.threshold);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(20);
    // It starts with a slow attack (a new compressor ducks its first tenth of a second
    // otherwise) and gets its fast one a quarter of a second later.
    expect(limiter.attack.value).toBe(1);
    expect(limiter.attack.last).toMatchObject({ kind: 'set', value: LIMITER.attack });
    expect(limiter.attack.last?.time).toBeLessThanOrEqual(0.5);
    expect(LIMITER.attack).toBeLessThanOrEqual(0.003);
    // Three buses (music, effects, voice) and nothing else feed the limiter.
    expect(inputsOf(ctx, limiters[0])).toHaveLength(3);
  });

  it('undoes the makeup gain a compressor adds by itself', () => {
    // Threshold -3 dB at 20:1: full scale comes out at -2.85 dB, the makeup is 0.6 of that.
    expect(20 * Math.log10(limiterTrim(-3, 20))).toBeCloseTo(-1.71, 2);
    expect(limiterTrim(0, 20)).toBeCloseTo(1, 9);
  });

  it('routes an effect through the limiter and nowhere else', async () => {
    const { engine, ctx } = rig();
    engine.preload(['ui_click']);
    await settle();
    engine.play('ui_click');
    const src = ctx.started[0];
    expect(src.reaches(ctx.destination)).toBe(true);
    const limiter = ctx.nodes.find((n) => n.kind === 'compressor') as FakeNode;
    limiter.disconnect();
    expect(src.reaches(ctx.destination)).toBe(false);
  });

  it('sets and reads the master volume, smoothly, from 0 to 1', () => {
    const { engine, ctx } = rig();
    const master = inputsOf(ctx, ctx.destination)[0] as FakeGain;
    expect(engine.getMasterVolume()).toBe(0.9);
    expect(master.gain.value).toBe(0.9);
    engine.setMasterVolume(0.4);
    expect(engine.getMasterVolume()).toBe(0.4);
    expect(master.gain.last).toMatchObject({ kind: 'target', value: 0.4 });
    expect(master.gain.last?.timeConstant).toBeGreaterThan(0);
    expect(master.gain.last?.timeConstant).toBeLessThanOrEqual(0.1);
    engine.setMasterVolume(7);
    expect(engine.getMasterVolume()).toBe(1);
    engine.setMasterVolume(-1);
    expect(engine.getMasterVolume()).toBe(0);
    engine.setMasterVolume(Number.NaN);
    expect(engine.getMasterVolume()).toBe(0);
    engine.setMasterVolume(0.5);
    engine.setMuted(true);
    expect(master.gain.target).toBe(0);
    expect(engine.getMasterVolume()).toBe(0.5);
    engine.setMuted(false);
    expect(master.gain.target).toBe(0.5);
  });

  it('keeps a volume set before the first click', () => {
    const { engine, ctx } = rig({ unlock: false });
    engine.setMasterVolume(0.25);
    expect(ctx.nodes.filter((n) => n.kind === 'gain')).toHaveLength(0);
    engine.unlock();
    const master = inputsOf(ctx, ctx.destination)[0] as FakeGain;
    expect(master.gain.value).toBe(0.25);
    expect(engine.getMasterVolume()).toBe(0.25);
  });
});

describe('music', () => {
  it('never loops a one-shot and always loops a loop, between its loop points', async () => {
    const { engine, ctx } = rig();
    for (const id of ONE_SHOTS) {
      engine.playMusic([id]);
      await settle();
      const src = ctx.startedFrom(`music/${id}.`)[0];
      expect(src.loop, id).toBe(false);
    }
    for (const id of LOOPS) {
      // `loop: false` from a caller does not make a looping track stop after one pass.
      engine.playMusic([id], { loop: false });
      await settle();
      const src = ctx.startedFrom(`music/${id}.`)[0];
      expect(src.loop, id).toBe(true);
      expect(src.loopStart, id).toBe(0.25);
      expect(src.loopEnd, id).toBe(MUSIC[id].duration - 0.25);
      expect(src.offset, id).toBe(0);
    }
  });

  it('starts a cue part-way in so that its mark lands on the event', async () => {
    // The intermission's hit is 20 s into the file. 8 s to go: start at 12.
    let r = rig();
    r.engine.playMusic(['intermission'], { fade: 0.6, landIn: 8 });
    await settle();
    let src = r.ctx.startedFrom('intermission')[0];
    expect(src.offset).toBeGreaterThanOrEqual(12);
    expect(src.offset).toBeLessThanOrEqual(12.1);
    expect((src.startedAt as number) + (20 - src.offset)).toBeCloseTo(8, 3);

    // 20 s to go: from the top.
    r = rig();
    r.engine.playMusic(['intermission'], { landIn: 20 });
    await settle();
    src = r.ctx.startedFrom('intermission')[0];
    expect(src.offset).toBeGreaterThanOrEqual(0);
    expect(src.offset).toBeLessThanOrEqual(0.1);

    // 25 s to go: from the top, 5 s later.
    r = rig();
    r.engine.playMusic(['intermission'], { landIn: 25 });
    await settle();
    src = r.ctx.startedFrom('intermission')[0];
    expect(src.offset).toBe(0);
    expect(src.startedAt).toBeCloseTo(5, 3);
    const gain = src.outputs[0] as FakeGain;
    expect(gain.gain.last?.time).toBeCloseTo(5, 3);

    // The moment has passed: nothing plays.
    r = rig();
    r.engine.playMusic(['intermission'], { landIn: 0 });
    await settle();
    expect(r.ctx.started).toHaveLength(0);
    expect(r.engine.music).toBe('intermission');
  });

  it('works the offset out when the file arrives, not when it was asked for', async () => {
    const { engine, ctx, fetcher } = rig();
    fetcher.hold = true;
    engine.playMusic(['intermission'], { landIn: 8 });
    await pass(ctx, 3);
    expect(ctx.started).toHaveLength(0);
    fetcher.release();
    await settle();
    const src = ctx.startedFrom('intermission')[0];
    expect((src.startedAt as number) + (20 - src.offset)).toBeCloseTo(8, 3);
    expect(src.offset).toBeCloseTo(15.05, 2);
  });

  it('keeps the deadline of a cue that was asked for before sound was unlocked', async () => {
    const { engine, ctx } = rig({ unlock: false });
    engine.playMusic(['cocoon'], { landIn: 10 });
    await pass(ctx, 4);
    engine.unlock();
    engine.update(0.016);
    await settle();
    const src = ctx.startedFrom('cocoon')[0];
    // The cut is 10 s into the file and 6 s away.
    expect(src.offset).toBeCloseTo(4.05, 2);
    expect(src.loop).toBe(false);
  });

  it('plays a cue without a mark from the top whatever landIn says', async () => {
    const { engine, ctx } = rig();
    engine.playMusic(['win_humans'], { landIn: 3 });
    await settle();
    expect(ctx.startedFrom('win_humans')[0].offset).toBe(0);
  });

  it('can let the old music ring out while the new comes in fast', async () => {
    const { engine, ctx } = rig();
    engine.playMusic(['intermission'], { fade: 0.6, landIn: 8 });
    await settle();
    const old = ctx.startedFrom('intermission')[0].outputs[0] as FakeGain;
    await pass(ctx, 8);
    engine.playMusic(['stage2_base', 'stage2_combat'], { fade: 0.3, fadeOut: 2.5 });
    await settle();
    expect(old.gain.last).toMatchObject({ kind: 'target', value: 0 });
    expect(old.gain.last?.timeConstant).toBeCloseTo(2.5 / 3, 3);
    const base = ctx.startedFrom('stage2_base')[0];
    const combat = ctx.startedFrom('stage2_combat')[0];
    expect((base.outputs[0] as FakeGain).gain.last).toMatchObject({ kind: 'target', value: 1 });
    expect((base.outputs[0] as FakeGain).gain.last?.timeConstant).toBeCloseTo(0.1, 3);
    // Stems start on the same instant, or they are not aligned.
    expect(base.startedAt).toBe(combat.startedAt);
    // The old source is only stopped once it has rung out.
    const before = ctx.startedFrom('intermission')[0].stoppedAt;
    expect(before).toBeNull();
    await pass(ctx, 2.7);
    expect(ctx.startedFrom('intermission')[0].stoppedAt).not.toBeNull();
  });

  it('changes nothing when the same music is asked for again', async () => {
    const { engine, ctx } = rig();
    engine.playMusic(['lobby']);
    await settle();
    engine.playMusic(['lobby']);
    engine.update(0.016);
    await settle();
    expect(ctx.started).toHaveLength(1);
  });
});

describe('the cache of decoded audio', () => {
  const megabytes = (seconds: number): number => (seconds * 48000 * 2 * 4) / 1e6;

  it('drops music once other music has taken its place', async () => {
    const { engine, ctx } = rig();
    engine.playMusic(['lobby']);
    await settle();
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(80.5), 1);
    engine.playMusic(['briefing']);
    await settle();
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(20.5), 1);
    // Going back decodes the file again: it really was let go.
    engine.playMusic(['lobby']);
    await settle();
    expect(ctx.decoded.get('audio/music/lobby.ogg')).toBe(2);
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(80.5), 1);
  });

  it('never holds all the music: playing every track in turn keeps one at a time', async () => {
    const { engine } = rig();
    let peak = 0;
    for (const id of Object.keys(MUSIC)) {
      engine.playMusic([id]);
      await settle();
      peak = Math.max(peak, engine.stats().megabytes);
    }
    // Before: all thirteen stayed decoded, 261 MB. Now: the largest single track.
    expect(peak).toBeCloseTo(megabytes(80.5), 1);
  });

  it('keeps announced music until it is released', async () => {
    const { engine, ctx } = rig();
    engine.preloadMusic(['stage1_base', 'stage1_combat', 'cocoon']);
    engine.playMusic(['briefing']);
    await settle();
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(80.5 * 2 + 12.5 + 20.5), 1);
    engine.playMusic(['stage1_base', 'stage1_combat']);
    await settle();
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(80.5 * 2 + 12.5), 1);
    // Announced music is not fetched or decoded a second time when it is played.
    expect(ctx.decoded.get('audio/music/stage1_base.ogg')).toBe(1);
    engine.releaseMusic(['stage1_base', 'stage1_combat']);
    engine.playMusic(['cocoon']);
    await settle();
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(12.5), 1);
    engine.releaseMusic();
    engine.playMusic(['lobby']);
    await settle();
    expect(engine.stats().megabytes).toBeCloseTo(megabytes(80.5), 1);
  });

  it('keeps only the most recent voice lines, and the ones loaded ahead', async () => {
    const { engine, ctx } = rig();
    engine.preloadVoice(['v_38', 'v_39']);
    await settle();
    for (let i = 0; i < 36; i++) {
      engine.say(line(`v_${i}`));
      await pass(ctx, 2.2);
    }
    expect(engine.stats().buffers).toBe(24 + 2);
    // An old line was let go and is decoded again when it comes round; a recent one is not.
    engine.say(line('v_0'));
    await pass(ctx, 2.2);
    expect(ctx.decoded.get('audio/voice/v_0.ogg')).toBe(2);
    engine.say(line('v_35'));
    await pass(ctx, 2.2);
    expect(ctx.decoded.get('audio/voice/v_35.ogg')).toBe(1);
    engine.say(line('v_39'));
    await pass(ctx, 2.2);
    expect(ctx.decoded.get('audio/voice/v_39.ogg')).toBe(1);
    engine.releaseVoice();
    expect(engine.stats().buffers).toBe(24);
  });

  it('remembers what was to be loaded ahead until there is sound to load it for', async () => {
    const { engine, fetcher } = rig({ unlock: false });
    engine.preload(['tank_fire']);
    engine.preloadMusic(['cocoon']);
    engine.preloadVoice(['v_1']);
    await settle();
    expect(fetcher.requests).toHaveLength(0);
    engine.unlock();
    await settle();
    expect(fetcher.requests.sort()).toEqual([
      'audio/music/cocoon.ogg',
      'audio/sfx/tank_fire_1.ogg',
      'audio/sfx/tank_fire_2.ogg',
      'audio/sfx/tank_fire_3.ogg',
      'audio/voice/v_1.ogg',
    ]);
  });
});

describe('voice', () => {
  it('adds no squelch to a recorded line, and one of each to a radio line without audio', async () => {
    const { engine, ctx } = rig();
    const play = vi.spyOn(engine, 'play');
    const squelches = (): string[] => play.mock.calls.map((c) => c[0]).filter((id) => id.startsWith('radio_'));

    engine.say(line('v_1'), { radio: true });
    await pass(ctx, 2.4);
    expect(ctx.startedFrom('voice/v_1')).toHaveLength(1);
    expect(squelches()).toEqual([]);

    engine.say(line('v_not_recorded'), { radio: true });
    await pass(ctx, 6.5);
    expect(squelches()).toEqual(['radio_open', 'radio_close']);

    play.mockClear();
    engine.say(line('v_2'), { radio: false });
    await pass(ctx, 2.4);
    engine.say(line('v_not_recorded', 'Chair'), { radio: false });
    await pass(ctx, 6.5);
    expect(squelches()).toEqual([]);
  });

  it('stops the line being spoken when the voice is cleared', async () => {
    const { engine, ctx, subtitles } = rig();
    const music = inputsOf(ctx, ctx.nodes.find((n) => n.kind === 'compressor') as FakeNode)[0] as FakeGain;
    engine.say(line('v_long'));
    engine.say(line('v_3'));
    await pass(ctx, 1);
    const src = ctx.startedFrom('voice/v_long')[0];
    expect(src.playing).toBe(true);
    expect(music.gain.target).toBeCloseTo(0.55 * 0.4, 6);
    engine.clearVoice();
    expect(src.stoppedAt).not.toBeNull();
    expect((src.stoppedAt as number) - ctx.currentTime).toBeLessThanOrEqual(0.06);
    await pass(ctx, 0.1);
    expect(src.playing).toBe(false);
    expect(engine.speaking).toBe(false);
    expect(subtitles[subtitles.length - 1]).toBeNull();
    expect(music.gain.target).toBeCloseTo(0.55, 6);
    // The queue went with it, and the next line that comes is the only voice sounding.
    await pass(ctx, 3);
    expect(ctx.startedFrom('voice/v_3')).toHaveLength(0);
    engine.say(line('v_4'));
    await pass(ctx, 0.2);
    expect(ctx.playing().filter((s) => s.buffer?.url.includes('voice/'))).toHaveLength(1);
  });

  it('silences the stand-in blips of a line that is cleared', async () => {
    const { engine, ctx } = rig();
    engine.say(line('v_not_recorded'));
    await pass(ctx, 0.2);
    const blip = ctx.oscillators[ctx.oscillators.length - 1];
    expect(blip.reaches(ctx.destination)).toBe(true);
    engine.clearVoice();
    await pass(ctx, 0.2);
    expect(blip.reaches(ctx.destination)).toBe(false);
  });

  it('plays an order before older chatter, and drops it once its moment has gone', async () => {
    let r = rig();
    r.engine.say(line('v_1'), { priority: 2 });
    await pass(r.ctx, 0.5);
    r.engine.say(line('v_2'), { priority: 2 });
    await pass(r.ctx, 0.5);
    r.engine.say(line('v_3'), { priority: 2.5, staleAfter: 1.5 });
    await pass(r.ctx, 6);
    // v_1 ends 2.15 s in; the order had waited 1.15 s: it goes first.
    expect(r.subtitles.filter((s) => s !== null)).toEqual(['v_1', 'v_3', 'v_2']);

    r = rig();
    r.engine.say(line('v_long'), { priority: 2 });
    await pass(r.ctx, 10.5);
    r.engine.say(line('v_2'), { priority: 2 });
    r.engine.say(line('v_3'), { priority: 2.5, staleAfter: 1.5 });
    await pass(r.ctx, 6);
    // v_long ends 12.15 s in; the order had waited 1.65 s: it is skipped.
    expect(r.subtitles.filter((s) => s !== null)).toEqual(['v_long', 'v_2']);
    expect(r.ctx.startedFrom('voice/v_3')).toHaveLength(0);
  });

  it('never drops a priority 3 line, however long it waited', async () => {
    const { engine, ctx, subtitles } = rig();
    engine.say(line('v_long'), { priority: 3 });
    engine.say(line('v_long'), { priority: 3 });
    engine.say(line('v_long'), { priority: 3 });
    engine.say(line('v_7'), { priority: 3 });
    engine.say(line('v_8'), { priority: 1 });
    await pass(ctx, 3 * 12.15 + 3);
    // 36 s of waiting: the priority 3 line is spoken, the chatter (7 s at most) is not.
    expect(subtitles.filter((s) => s !== null)).toEqual(['v_long', 'v_long', 'v_long', 'v_7']);
  });

  it('drops an order whose file took too long to arrive', async () => {
    const { engine, ctx, fetcher, subtitles } = rig();
    fetcher.hold = true;
    engine.say(line('v_3'), { priority: 2.5, staleAfter: 1.5 });
    engine.say(line('v_4'), { priority: 1 });
    await pass(ctx, 2);
    fetcher.release();
    await pass(ctx, 0.2);
    expect(ctx.startedFrom('voice/v_3')).toHaveLength(0);
    expect(subtitles.filter((s) => s !== null)).toEqual(['v_4']);
  });

  it('lets an order cut in on chatter, but not on a line that matters', async () => {
    let r = rig();
    const play = vi.spyOn(r.engine, 'play');
    r.engine.say(line('v_long'), { priority: 1, radio: true });
    await pass(r.ctx, 1);
    r.engine.say(line('v_3'), { priority: 2.5, staleAfter: 1.5, cutsIn: true, radio: true });
    await settle();
    const cut = r.ctx.startedFrom('voice/v_long')[0];
    expect(cut.stoppedAt).not.toBeNull();
    expect((cut.stoppedAt as number) - r.ctx.currentTime).toBeLessThanOrEqual(0.07);
    expect(r.ctx.startedFrom('voice/v_3')).toHaveLength(1);
    expect(r.ctx.startedFrom('voice/v_3')[0].startedAt).toBeCloseTo(r.ctx.currentTime, 5);
    // The cut line lost its own squelch tail, so it gets one.
    expect(play.mock.calls.filter((c) => c[0] === 'radio_close')).toHaveLength(1);
    await pass(r.ctx, 3);
    expect(r.subtitles.filter((s) => s !== null)).toEqual(['v_long', 'v_3']);
    expect(r.engine.speaking).toBe(false);

    r = rig();
    r.engine.say(line('v_long'), { priority: 2, radio: true });
    await pass(r.ctx, 1);
    r.engine.say(line('v_3'), { priority: 2.5, staleAfter: 1.5, cutsIn: true, radio: true });
    await settle();
    expect(r.ctx.startedFrom('voice/v_long')[0].stoppedAt).toBeNull();
    expect(r.ctx.startedFrom('voice/v_3')).toHaveLength(0);
  });

  it('leaves 0.15 s between lines and ducks the music for as long as someone speaks', async () => {
    const { engine, ctx } = rig();
    const music = inputsOf(ctx, ctx.nodes.find((n) => n.kind === 'compressor') as FakeNode)[0] as FakeGain;
    engine.say(line('v_1'), { priority: 3 });
    engine.say(line('v_2'), { priority: 3 });
    await pass(ctx, 2.1);
    expect(ctx.startedFrom('voice/v_2')).toHaveLength(0);
    expect(music.gain.target).toBeCloseTo(0.55 * 0.4, 6);
    await pass(ctx, 0.1);
    expect(ctx.startedFrom('voice/v_2')[0].startedAt).toBeCloseTo(2.15, 1);
    await pass(ctx, 2.3);
    expect(music.gain.target).toBeCloseTo(0.55, 6);
  });
});

describe('a hidden page', () => {
  it('pauses the sound, drops the line being spoken, and starts nothing', async () => {
    const { engine, ctx } = rig();
    engine.preload(['ui_click']);
    engine.say(line('v_long'));
    await pass(ctx, 1);
    engine.setHidden(true);
    expect(ctx.suspends).toBe(1);
    expect(ctx.startedFrom('voice/v_long')[0].stoppedAt).not.toBeNull();
    expect(engine.unlocked).toBe(false);
    const before = ctx.started.length;
    engine.play('ui_click');
    engine.say(line('v_1'));
    engine.unlock();
    expect(ctx.resumes).toBe(0);
    await settle();
    expect(ctx.started.length).toBe(before);
    engine.setHidden(false);
    expect(ctx.resumes).toBe(1);
    expect(engine.unlocked).toBe(true);
    engine.play('ui_click');
    expect(ctx.startedFrom('ui_click')).toHaveLength(1);
  });

  it('does not wake sound that was never unlocked', () => {
    const { engine, ctx } = rig();
    ctx.state = 'suspended';
    engine.setHidden(true);
    engine.setHidden(false);
    expect(ctx.suspends).toBe(0);
    expect(ctx.resumes).toBe(0);
  });

  it('restarts a timed cue from where it should be when the page is shown again', async () => {
    const { engine, ctx } = rig();
    engine.playMusic(['intermission'], { landIn: 20 });
    await settle();
    expect(ctx.startedFrom('intermission')[0].offset).toBeCloseTo(0.05, 2);
    await pass(ctx, 2);
    engine.setHidden(true);
    // The audio clock stands still while hidden; the game does not.
    await vi.advanceTimersByTimeAsync(9000);
    engine.setHidden(false);
    engine.update(0.016);
    await settle();
    const again = ctx.startedFrom('intermission')[1];
    expect(again.offset).toBeCloseTo(11.05, 1);
  });
});

describe('loops', () => {
  it('follows the rate it is given, before and after the file has arrived', async () => {
    const { engine, ctx, fetcher } = rig();
    fetcher.hold = true;
    const handle = engine.loop('hum_loop', { gain: 0.5 });
    handle.setRate(1.25);
    fetcher.release();
    await settle();
    const src = ctx.startedFrom('hum_loop')[0];
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBe(0.25);
    expect(src.loopEnd).toBe(1.25);
    expect(src.playbackRate.value).toBe(1.25);
    // An ordinary loop plays from the top of the file and swells in.
    expect(src.offset).toBe(0);
    expect((src.outputs[0] as FakeGain).gain.last?.timeConstant).toBeCloseTo(0.2, 6);
    handle.setRate(1.5);
    expect(src.playbackRate.last).toMatchObject({ kind: 'target', value: 1.5 });
    handle.stop(0.15);
    await pass(ctx, 0.3);
    expect(src.stoppedAt).not.toBeNull();
  });

  it('comes in at full level from the loop start when asked to be sharp', async () => {
    const { engine, ctx } = rig();
    engine.loop('hum_loop', { sharp: true });
    await settle();
    const src = ctx.startedFrom('hum_loop')[0];
    expect(src.offset).toBe(0.25);
    expect((src.outputs[0] as FakeGain).gain.last?.timeConstant).toBeCloseTo(0.03, 6);
  });
});
