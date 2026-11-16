import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROSE_ARMY,
  ROSE_KAIJU,
  TICK_RATE,
  VOICE_LINES,
  type Bounds,
  type KaijuKindId,
  type SimEvent,
  type SnapKaiju,
  type SnapMatch,
  type SnapUnit,
  type StageId,
  type VoiceCueId,
} from '@mb/shared';
import { emptyManifest } from '../src/assets/manifest';
import { AudioEngine } from '../src/audio/audioEngine';
import { chargeTone, FINAL_MINUTE_AT, HEARING_MUSIC_AT, MatchAudio, voiceAheadIds, WHOOSH_PEAK, type MatchAudioSession } from '../src/audio/matchAudio';
import { allRoseLineIds, ROSE_KAIJU_SOUNDS, ROSE_SOUND_VARIANTS, ROSE_VOICES, roseLineId, roseTexts } from '../src/audio/roseLines';
import type { FrameState, LocalRole } from '../src/net/matchSession';
import { attackVariant } from '../src/render/kaijuAnimator';
import { FakeAudioContext, FakeGain, fakeFetch, type FakeFetch, type FakeSource } from './fakeAudio';

/** Lengths of the real music files (seconds); one-shots have no loop points. */
const MUSIC: Record<string, { duration: number; loop?: [number, number]; mark?: number }> = {
  lobby: { duration: 80.5, loop: [0.25, 80.25] },
  briefing: { duration: 20.5, loop: [0.25, 20.25] },
  stage1: { duration: 154.1, loop: [0.25, 153.85] },
  stage2: { duration: 156.5, loop: [0.25, 156.25] },
  stage3: { duration: 160.5, loop: [0.25, 160.25] },
  final_minute: { duration: 60.5, loop: [0.25, 60.25], mark: 60.25 },
  hearing: { duration: 30.5, loop: [0.25, 30.25] },
  cocoon: { duration: 12.5, mark: 10 },
  intermission: { duration: 23.5, mark: 20 },
  win_humans: { duration: 14.5 },
  win_kaiju: { duration: 14.9 },
};

const SFX_LOOPS: Record<string, [number, number]> = {
  kaiju_beam_loop: [0.25, 2.25],
  kaiju_heartbeat_loop: [0.25, 1.93],
  laser_charge_loop: [0.25, 1.25],
  amb_day_loop: [0.25, 10.25],
  amb_sunset_loop: [0.25, 10.25],
  amb_night_loop: [0.25, 10.25],
};

const SFX = [
  'tank_fire',
  'rocket_launch',
  'explosion_s',
  'explosion_m',
  'kaiju_hurt',
  'kaiju_beam_charge',
  'kaiju_molt_blast',
  'kaiju_death',
  'volley_ready',
  'volley_fire',
  'ui_match_start',
  'radio_open',
  'radio_close',
  'sting_nerve_break',
  'kaiju_stagger',
  // phases 1 to 3
  'kaiju_rake_s1',
  'kaiju_hop_s1',
  'stun_ring',
  'shaken',
  'supply_drop',
  'crate_land',
  'crate_take',
  'radio_static',
];

interface Rig {
  engine: AudioEngine;
  audio: MatchAudio;
  ctx: FakeAudioContext;
  fetcher: FakeFetch;
  session: { role: LocalRole; mirror: MatchAudioSession['mirror']; frame: FrameState | null; catchingUp?: boolean };
  /** One frame: the session shows it, the match audio and the engine update, time moves on. */
  frame(frame: FrameState, dt?: number): Promise<void>;
  /** The same frame for a while, at 20 frames a second, its tick moving with the time. */
  hold(frame: FrameState, seconds: number): Promise<void>;
  event(e: object): void;
}

function rig(role: Partial<LocalRole> = {}): Rig {
  const ctx = new FakeAudioContext();
  const fetcher = fakeFetch();
  vi.stubGlobal('fetch', fetcher);
  const manifest = emptyManifest();
  for (const [id, m] of Object.entries(MUSIC)) {
    manifest.music[id] = { base: `audio/music/${id}`, ...m };
    ctx.durations.set(`audio/music/${id}.ogg`, m.duration);
  }
  for (const id of SFX) {
    manifest.sfx[id] = { variants: [`audio/sfx/${id}`], gain: 1 };
    ctx.durations.set(`audio/sfx/${id}.ogg`, 1);
  }
  for (const kind of ['lizard', 'crab']) {
    for (const stage of [1, 2, 3]) {
      for (const id of [`kaiju_roar_${kind}_s${stage}`, `kaiju_step_s${stage}`, `kaiju_swipe_s${stage}`, `kaiju_stomp_s${stage}`]) {
        manifest.sfx[id] = { variants: [`audio/sfx/${id}`], gain: 1 };
        ctx.durations.set(`audio/sfx/${id}.ogg`, 1);
      }
    }
  }
  // the stumble's three falls, one variant per look
  manifest.sfx.kaiju_stumble_s1 = { variants: [1, 2, 3].map((n) => `audio/sfx/kaiju_stumble_s1_${n}`), gain: 1 };
  for (const n of [1, 2, 3]) ctx.durations.set(`audio/sfx/kaiju_stumble_s1_${n}.ogg`, 1);
  for (const [id, loop] of Object.entries(SFX_LOOPS)) {
    manifest.sfx[id] = { variants: [`audio/sfx/${id}`], gain: 1, loop };
    ctx.durations.set(`audio/sfx/${id}.ogg`, loop[1] + 0.25);
  }
  for (const id of [...VOICE_LINES.map((l) => l.id), ...allRoseLineIds()]) {
    manifest.voice[id] = { base: `audio/voice/${id}`, duration: 2.2 };
    ctx.durations.set(`audio/voice/${id}.ogg`, 2.2);
  }
  for (const base of Object.values(ROSE_KAIJU_SOUNDS)) {
    for (const stage of [1, 2, 3]) {
      const id = `${base}_s${stage}`;
      manifest.sfx[id] = { variants: [1, 2].map((n) => `audio/sfx/${id}_${n}`), gain: 1 };
      for (const n of [1, 2]) ctx.durations.set(`audio/sfx/${id}_${n}.ogg`, 1);
    }
  }
  const engine = new AudioEngine({ manifest, hasManifest: true, audioUrl: (base) => `${base}.ogg` }, false, {
    // The fake has the parts of an audio context the engine uses.
    createContext: () => ctx as unknown as AudioContext,
  });
  engine.unlock();
  const session: Rig['session'] = {
    role: { kind: 'human', playerId: 1, kaijuId: -1, squadId: 0, ...role },
    mirror: { city: { structures: [], props: [] } },
    frame: null,
  };
  const audio = new MatchAudio(engine);
  audio.begin(session);
  const frame = async (f: FrameState, dt = 0.05): Promise<void> => {
    session.frame = f;
    audio.update(f, dt);
    engine.update(dt);
    // Files that were asked for arrive while both clocks still agree; then time moves on.
    await vi.advanceTimersByTimeAsync(0);
    ctx.advance(dt);
    await vi.advanceTimersByTimeAsync(dt * 1000);
  };
  const hold = async (f: FrameState, seconds: number): Promise<void> => {
    const steps = Math.round(seconds / 0.05);
    for (let i = 0; i < steps; i++) {
      await frame(f);
      f.tick += 0.05 * TICK_RATE;
    }
  };
  return { engine, audio, ctx, fetcher, session, frame, hold, event: (e) => audio.handleEvent(e as SimEvent) };
}

function kaiju(over: Partial<SnapKaiju> = {}): SnapKaiju {
  // Only what the audio reads.
  return { id: 0, player: 0, kind: 'lizard', stage: 1, alive: true, x: 0, z: 0, action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, ...over } as SnapKaiju;
}

function unit(over: Partial<SnapUnit> = {}): SnapUnit {
  return { id: 0, squad: 0, alive: true, laser: false, charge: 0, x: 0, y: 0, z: 0, ...over } as SnapUnit;
}

function frameOf(
  over: { tick?: number; phase?: SnapMatch['phase']; stage?: StageId; phaseTime?: number; clock?: number; kaiju?: Partial<SnapKaiju>; units?: SnapUnit[] } = {},
): FrameState {
  const stage = over.stage ?? 1;
  return {
    tick: over.tick ?? 900,
    match: { phase: over.phase ?? 'playing', stage, phaseTime: over.phaseTime ?? 0, clock: over.clock ?? 300 } as SnapMatch,
    kaijus: [kaiju({ stage, ...over.kaiju })],
    squads: [],
    units: over.units ?? [],
    crates: [],
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } as Bounds,
    localUnit: null,
    localKaiju: null,
  };
}

function voice(cue: VoiceCueId, tick: number, lines: { humans?: string[]; kaiju?: string[] }): object {
  return { type: 'voice', tick, cue, variant: 0, squad: -1, player: -1, lines: { humans: lines.humans ?? [], kaiju: lines.kaiju ?? [] } };
}

const MOLT_LINE = VOICE_LINES[0].id;

const gainOf = (src: FakeSource): FakeGain => src.outputs[0] as FakeGain;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voice lines', () => {
  it('plays the molt line the simulation chose, for the monster only, and nothing for a cue with no line', async () => {
    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    const say = vi.spyOn(k.engine, 'say');
    await k.frame(frameOf());
    k.event(voice('molt.available', 900, { kaiju: [MOLT_LINE] }));
    expect(say.mock.calls.map((c) => c[0].id)).toEqual([MOLT_LINE]);
    expect(say.mock.calls[0][1]).toMatchObject({ priority: 2, radio: false });
    k.event(voice('volley.fired', 900, {}));
    expect(say).toHaveBeenCalledTimes(1);

    const humans = rig();
    const sayH = vi.spyOn(humans.engine, 'say');
    await humans.frame(frameOf());
    humans.event(voice('molt.available', 900, { kaiju: [MOLT_LINE] }));
    expect(sayH).not.toHaveBeenCalled();
  });

  it('loads the monster\'s molt line before the match, and no line for the squads', () => {
    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    expect(voiceAheadIds('kaiju')).toContain(MOLT_LINE);
    expect(k.fetcher.requests).toContain(`audio/voice/${MOLT_LINE}.ogg`);
    expect(voiceAheadIds('humans')).toEqual([]);
  });
});

describe('the communication rose', () => {
  const granite = { role: 'human' as const, name: 'Rook', callsign: 'Granite' };
  const beacon = { role: 'human' as const, name: 'Beacon', callsign: 'Beacon' };
  const beast = { role: 'kaiju' as const, name: 'Mo', callsign: '' };

  it('puts a squad\'s line on the radio in its own voice, with the player\'s name, the same line on every screen', async () => {
    const lines: string[][] = [];
    for (const role of [{}, { kind: 'kaiju' as const, kaijuId: 0, squadId: -1, playerId: 0 }]) {
      const r = rig(role);
      const say = vi.spyOn(r.engine, 'say');
      await r.frame(frameOf());
      const science = ROSE_ARMY.indexOf('science');
      r.audio.rose({ player: 1, cat: science, pick: 7 }, granite);
      r.audio.rose({ player: 2, cat: science, pick: 7 }, beacon);
      expect(say.mock.calls.map((c) => c[1])).toEqual([
        expect.objectContaining({ radio: true, priority: 1 }),
        expect.objectContaining({ radio: true, priority: 1 }),
      ]);
      const n = 7 % roseTexts('science').length;
      expect(say.mock.calls[0][0]).toEqual({ id: roseLineId('Granite', 'science', n), speaker: 'Rook', text: roseTexts('science')[n] });
      expect(say.mock.calls[1][0].id).toBe(roseLineId('Beacon', 'science', n));
      lines.push(say.mock.calls.map((c) => c[0].id));
    }
    expect(lines[1]).toEqual(lines[0]);
  });

  it('gives a squad whose callsign has no voice of its own the voice of its place in the order', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.frame(frameOf());
    r.audio.rose({ player: 4, cat: 0, pick: 0 }, { role: 'human', name: 'Zed', callsign: 'Nobody' });
    expect(say.mock.calls[0][0].id).toBe(roseLineId(ROSE_VOICES[3], ROSE_ARMY[0], 0));
    // Not a wedge: nothing.
    r.audio.rose({ player: 4, cat: ROSE_ARMY.length, pick: 0 }, granite);
    r.audio.rose({ player: 4, cat: 0, pick: 0 }, undefined);
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('plays the monster\'s noise from the monster at its size, and at full level for the monster\'s own player', async () => {
    const mating = ROSE_KAIJU.indexOf('mating');
    const id = `${ROSE_KAIJU_SOUNDS.mating}_s2`;
    const r = rig();
    const play = vi.spyOn(r.engine, 'play');
    await r.frame(frameOf({ stage: 2, kaiju: { x: 40, z: 10 } }));
    r.audio.rose({ player: 0, cat: mating, pick: 3 }, beast);
    expect(play).toHaveBeenCalledWith(id, expect.objectContaining({ x: 40, z: 10, variant: 3 % ROSE_SOUND_VARIANTS }));

    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    const playK = vi.spyOn(k.engine, 'play');
    const sayK = vi.spyOn(k.engine, 'say');
    await k.frame(frameOf({ stage: 2, kaiju: { x: 40, z: 10 } }));
    k.audio.rose({ player: 0, cat: mating, pick: 3 }, beast);
    const call = playK.mock.calls.find((c) => c[0] === id);
    expect(call?.[1]).toMatchObject({ gain: 1, variant: 3 % ROSE_SOUND_VARIANTS });
    expect(call?.[1]?.x).toBeUndefined();
    // No words, no subtitle.
    expect(sayK).not.toHaveBeenCalled();
  });

  it('has a sound file for every army line in every voice, and every monster noise at every size', () => {
    const shipped = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')) as {
      voice: Record<string, unknown>;
      sfx: Record<string, { variants: string[] }>;
    };
    expect(allRoseLineIds().filter((id) => !shipped.voice[id])).toEqual([]);
    for (const cat of ROSE_ARMY) expect(roseTexts(cat).length, cat).toBeGreaterThanOrEqual(4);
    for (const base of Object.values(ROSE_KAIJU_SOUNDS)) {
      for (const stage of [1, 2, 3]) expect(shipped.sfx[`${base}_s${stage}`]?.variants.length, `${base}_s${stage}`).toBe(ROSE_SOUND_VARIANTS);
    }
  });
});

describe('the end of the match', () => {
  const matchEnd = (tick: number, winner: 'kaiju' | 'humans'): object => ({ type: 'matchEnd', tick, winner, reason: winner === 'kaiju' ? 'bar' : 'clock', duration: 100, tallies: [] });

  it('plays the win cue, then the hearing music, once', async () => {
    const r = rig();
    await r.frame(frameOf({ stage: 3 }));
    const ended = frameOf({ stage: 3, phase: 'ended' });
    r.session.frame = ended;
    r.event(matchEnd(900, 'kaiju'));
    await r.hold(ended, 1);
    expect(r.engine.music).toBe('win_kaiju');
    expect(r.ctx.startedFrom('win_kaiju')[0].loop).toBe(false);
    await r.hold(ended, HEARING_MUSIC_AT - 1 - 0.2);
    expect(r.engine.music).toBe('win_kaiju');
    await r.hold(ended, 0.4);
    expect(r.engine.music).toBe('hearing');
    await r.hold(ended, 10);
    expect(r.ctx.startedFrom('music/hearing')).toHaveLength(1);
  });
});

describe('the charging tone', () => {
  it('is one tone for the squad: null, a rising tone, a hum when all are full', () => {
    expect(chargeTone([], 0)).toBeNull();
    expect(chargeTone([unit({ laser: true, charge: 0.5, squad: 1 })], 0)).toBeNull();
    expect(chargeTone([unit({ laser: true, charge: 0.5, alive: false })], 0)).toBeNull();
    expect(chargeTone([unit({ laser: true, charge: 0.5 })], -1)).toBeNull();
    const one = chargeTone([unit({ laser: true, charge: 0.5 }), unit({ laser: false, charge: 1 })], 0);
    expect(one?.rate).toBeCloseTo(1.25, 6);
    expect(one?.gain).toBeCloseTo(0.67, 6);
    expect(one?.full).toBe(0);
    const two = chargeTone([unit({ laser: true, charge: 0.2 }), unit({ laser: true, charge: 1 })], 0);
    expect(two).toMatchObject({ rate: 1.5, full: 1 });
    expect(two?.gain).toBeCloseTo(0.84, 6);
    expect(chargeTone([unit({ laser: true, charge: 1 }), unit({ laser: true, charge: 1 }), unit({ laser: true, charge: 1 })], 0)).toEqual({ rate: 1.5, gain: 0.3, full: 3 });
  });

  it('plays while the local squad charges, pings once when lasers fill together, and stops when they fire', async () => {
    const r = rig();
    const lasers = (charge: number): SnapUnit[] => [1, 2, 3].map((id) => unit({ id, laser: true, charge }));
    await r.frame(frameOf({ units: lasers(0) }));
    await r.frame(frameOf({ units: lasers(0.1) }));
    const tone = r.ctx.startedFrom('laser_charge_loop');
    expect(tone).toHaveLength(1);
    expect(tone[0].loop).toBe(true);
    await r.frame(frameOf({ units: lasers(0.5) }));
    expect(tone[0].playbackRate.target).toBeCloseTo(1.25, 6);
    expect(gainOf(tone[0]).gain.target).toBeCloseTo(1.01, 6);
    expect(r.ctx.startedFrom('volley_ready')).toHaveLength(0);
    // All three fill on the same frame: one ping, and the tone drops to a hum.
    await r.frame(frameOf({ units: lasers(1) }));
    await r.frame(frameOf({ units: lasers(1) }));
    expect(r.ctx.startedFrom('volley_ready')).toHaveLength(1);
    expect(tone[0].playbackRate.target).toBeCloseTo(1.5, 6);
    expect(gainOf(tone[0]).gain.target).toBeCloseTo(0.3, 6);
    await r.hold(frameOf({ units: lasers(1) }), 2);
    expect(r.ctx.startedFrom('volley_ready')).toHaveLength(1);
    // Fired: the lasers go off and the tone stops within a quarter of a second.
    await r.hold(frameOf({ units: [1, 2, 3].map((id) => unit({ id })) }), 0.3);
    expect(tone[0].stoppedAt).not.toBeNull();
    expect(r.ctx.startedFrom('laser_charge_loop')).toHaveLength(1);
  });

  it('is not played for other squads, nor for the kaiju player', async () => {
    const r = rig();
    await r.hold(frameOf({ units: [unit({ squad: 2, laser: true, charge: 1 })] }), 0.5);
    expect(r.ctx.startedFrom('laser_charge_loop')).toHaveLength(0);
    expect(r.ctx.startedFrom('volley_ready')).toHaveLength(0);
    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    await k.hold(frameOf({ units: [unit({ laser: true, charge: 1 })] }), 0.5);
    expect(k.ctx.startedFrom('laser_charge_loop')).toHaveLength(0);
  });
});

describe('loops follow the frame state', () => {
  const action = (tick: number, phase: string): object => ({ type: 'kaijuAction', tick, kaiju: 0, action: 'special', phase, duration: 3, x: 0, z: 0, yaw: 0 });

  it('starts the beam on its event, sharply, and stops it on its event', async () => {
    const r = rig();
    const beaming = frameOf({ kaiju: { action: 'special', phase: 'special' } });
    await r.frame(frameOf());
    r.session.frame = beaming;
    r.event(action(900, 'special'));
    await r.hold(beaming, 1);
    const beam = r.ctx.startedFrom('kaiju_beam_loop');
    expect(beam).toHaveLength(1);
    expect(beam[0].offset).toBe(0.25);
    expect(beam[0].playing).toBe(true);
    r.event(action(beaming.tick, 'recover'));
    await r.hold(frameOf({ tick: beaming.tick, kaiju: { action: 'special', phase: 'recover' } }), 0.6);
    expect(beam[0].playing).toBe(false);
    expect(r.ctx.startedFrom('kaiju_beam_loop')).toHaveLength(1);
  });

  it('stops a beam whose end was never heard of (a reconnection), and starts one that is on', async () => {
    const r = rig();
    const beaming = frameOf({ kaiju: { action: 'special', phase: 'special' } });
    r.session.frame = beaming;
    r.event(action(900, 'special'));
    await r.hold(beaming, 0.5);
    const beam = r.ctx.startedFrom('kaiju_beam_loop')[0];
    // No recover event arrives; the frame simply shows the kaiju idle.
    await r.hold(frameOf({ tick: beaming.tick }), 1);
    expect(beam.playing).toBe(false);

    const joined = rig();
    await joined.hold(frameOf({ kaiju: { action: 'special', phase: 'special' } }), 0.8);
    expect(joined.ctx.startedFrom('kaiju_beam_loop')).toHaveLength(1);
    // A match that ended in mid-beam shows that last frame for good: no beam on the end screen.
    const over = rig();
    await over.hold(frameOf({ phase: 'ended', kaiju: { action: 'special', phase: 'special' } }), 1);
    expect(over.ctx.startedFrom('kaiju_beam_loop')).toHaveLength(0);
  });

  it('stops a heartbeat whose blast was never heard of, and starts heartbeat and music for a cocoon it joins', async () => {
    const r = rig();
    const cocooned = frameOf({ kaiju: { action: 'molt', phase: 'cocoon', phaseTime: 0, phaseDuration: 10 } });
    await r.frame(frameOf());
    r.session.frame = cocooned;
    r.event({ type: 'cocoon', tick: 900, kaiju: 0, x: 5, z: 5, duration: 10 });
    await r.hold(cocooned, 1);
    const beat = r.ctx.startedFrom('kaiju_heartbeat_loop');
    expect(beat).toHaveLength(1);
    expect(beat[0].playing).toBe(true);
    expect(r.engine.music).toBe('cocoon');
    // The connection drops; when it is back the kaiju has long molted. No blast event came.
    await r.hold(frameOf({ tick: 2000, stage: 1, phase: 'intermission', kaiju: { stage: 2 } }), 1);
    expect(beat[0].playing).toBe(false);
    expect(r.ctx.startedFrom('kaiju_heartbeat_loop')).toHaveLength(1);

    const joined = rig();
    await joined.hold(frameOf({ kaiju: { action: 'molt', phase: 'cocoon', phaseTime: 4, phaseDuration: 10 } }), 0.6);
    expect(joined.ctx.startedFrom('kaiju_heartbeat_loop')).toHaveLength(1);
    expect(joined.engine.music).toBe('cocoon');
    const cue = joined.ctx.startedFrom('music/cocoon')[0];
    // 6 s of cocoon were left when it was found out: the cut (10 s into the file) is 6 s away.
    expect((cue.startedAt as number) + (10 - cue.offset)).toBeCloseTo(0.35 + 6, 0);
    expect(cue.loop).toBe(false);
  });

  it('ends the heartbeat on the blast and plays the blast at once', async () => {
    const r = rig();
    const cocooned = frameOf({ kaiju: { action: 'molt', phase: 'cocoon', phaseDuration: 10 } });
    r.session.frame = cocooned;
    r.event({ type: 'cocoon', tick: 900, kaiju: 0, x: 5, z: 5, duration: 10 });
    await r.hold(cocooned, 2);
    // Loaded when the cocoon began, ten seconds before it is needed.
    expect(r.fetcher.requests).toContain('audio/sfx/kaiju_molt_blast.ogg');
    const beat = r.ctx.startedFrom('kaiju_heartbeat_loop')[0];
    const before = r.ctx.currentTime;
    r.event({ type: 'moltBlast', tick: cocooned.tick, kaiju: 0, x: 5, z: 5, killRadius: 30, shoveRadius: 60 });
    expect(r.ctx.startedFrom('kaiju_molt_blast')[0].startedAt).toBe(before);
    await r.hold(frameOf({ tick: cocooned.tick, phase: 'intermission', kaiju: { stage: 2 } }), 0.3);
    expect(beat.playing).toBe(false);
  });
});

describe('music through a match', () => {
  it('starts the intermission late so that its hit lands as the stage begins, then lets it ring', async () => {
    const r = rig();
    await r.hold(frameOf({ stage: 1 }), 0.2);
    expect(r.engine.music).toBe('stage1');
    const inter = frameOf({ tick: 1200, stage: 1, phase: 'intermission', kaiju: { stage: 2 } });
    r.session.frame = inter;
    const startedAt = r.ctx.currentTime;
    r.event({ type: 'matchPhase', tick: 1200, phase: 'intermission', stage: 1, duration: 8, nextStage: 2 });
    await r.hold(inter, 8);
    const build = r.ctx.startedFrom('music/intermission')[0];
    expect(build.loop).toBe(false);
    expect(build.offset).toBeGreaterThanOrEqual(12);
    expect(build.offset).toBeLessThanOrEqual(12.1);
    // (time of start) + (what is left of the file before the hit) = when the stage begins.
    expect((build.startedAt as number) + (20 - build.offset) - startedAt).toBeCloseTo(8, 2);
    const playing = frameOf({ tick: inter.tick, stage: 2 });
    r.session.frame = playing;
    r.event({ type: 'matchPhase', tick: playing.tick, phase: 'playing', stage: 2, duration: 0 });
    await r.hold(playing, 0.2);
    expect(r.engine.music).toBe('stage2');
    expect(gainOf(build).gain.last).toMatchObject({ kind: 'target', value: 0 });
    expect(gainOf(build).gain.last?.timeConstant).toBeCloseTo(2.5 / 3, 3);
    const track = r.ctx.startedFrom('music/stage2')[0];
    expect(track.loop).toBe(true);
    expect(gainOf(track).gain.events.find((e) => e.kind === 'target')?.timeConstant).toBeCloseTo(0.1, 3);
    // The track was announced while the build played: it starts within a frame of the hit.
    expect((track.startedAt as number) - (startedAt + 8)).toBeLessThan(0.2);
  });

  it('gives someone who arrives in the middle of a briefing or an intermission its music, timed by what is left', async () => {
    const briefed = rig();
    await briefed.hold(frameOf({ phase: 'briefing', tick: 30 }), 0.2);
    expect(briefed.engine.music).toBe('briefing');
    expect(briefed.ctx.startedFrom('music/briefing')).toHaveLength(1);

    const r = rig();
    const at = r.ctx.currentTime;
    // No event: the frame shows an intermission with 5 s left.
    await r.hold(frameOf({ phase: 'intermission', stage: 1, phaseTime: 5, kaiju: { stage: 2 } }), 0.2);
    const build = r.ctx.startedFrom('music/intermission');
    expect(build).toHaveLength(1);
    expect((build[0].startedAt as number) + (20 - build[0].offset) - at).toBeCloseTo(5, 2);
  });

  it('loads the coming stage in an intermission from the kaiju, whose stage is already the new one', async () => {
    const r = rig({ kind: 'spectator', squadId: -1, playerId: -1 });
    await r.frame(frameOf({ stage: 1, phase: 'intermission', kaiju: { stage: 2, kind: 'crab' as KaijuKindId } }));
    expect(r.fetcher.requests).toContain('audio/music/stage2.ogg');
    expect(r.fetcher.requests).toContain('audio/sfx/kaiju_roar_crab_s2.ogg');
    expect(r.fetcher.requests).not.toContain('audio/music/stage1.ogg');
  });

  it('loads the roar of the kaiju that is in the match', async () => {
    const r = rig();
    await r.frame(frameOf({ stage: 1, kaiju: { kind: 'crab' as KaijuKindId } }));
    expect(r.fetcher.requests).toContain('audio/sfx/kaiju_roar_crab_s1.ogg');
    expect(r.fetcher.requests).not.toContain('audio/sfx/kaiju_roar_lizard_s1.ogg');
  });

  it('plays the final-minute track in the last minute on the clock, its end landing as the clock runs out', async () => {
    const r = rig();
    await r.hold(frameOf({ stage: 2, clock: FINAL_MINUTE_AT + 30 }), 0.2);
    expect(r.engine.music).toBe('stage2');
    expect(r.fetcher.requests).not.toContain('audio/music/final_minute.ogg');
    // Loaded a little ahead, while the stage's track plays on.
    await r.hold(frameOf({ stage: 2, clock: FINAL_MINUTE_AT + 15 }), 0.2);
    expect(r.fetcher.requests).toContain('audio/music/final_minute.ogg');
    expect(r.engine.music).toBe('stage2');
    // The clock shows 45 s (a late join, say): the track starts 15 s in, so that the end of its
    // build (60.25 s into the file) comes as the clock reaches zero.
    const at = r.ctx.currentTime;
    await r.hold(frameOf({ stage: 2, clock: 45 }), 0.2);
    expect(r.engine.music).toBe('final_minute');
    const track = r.ctx.startedFrom('music/final_minute')[0];
    expect(track.loop).toBe(true);
    expect(track.offset).toBeCloseTo(15.25, 1);
    expect((track.startedAt as number) + (60.25 - track.offset) - at).toBeCloseTo(45, 1);
    // A molt in the last minute: after the intermission the next stage goes on with the final minute.
    const inter = frameOf({ stage: 2, phase: 'intermission', phaseTime: 8, clock: 30, kaiju: { stage: 3 } });
    await r.hold(inter, 0.5);
    expect(r.engine.music).toBe('intermission');
    await r.hold(frameOf({ stage: 3, clock: 30 }), 0.2);
    expect(r.engine.music).toBe('final_minute');
    expect(r.ctx.startedFrom('music/final_minute')).toHaveLength(2);
  });

  it('holds a fraction of the music in memory at any moment of a whole match', async () => {
    const r = rig();
    let peak = 0;
    let at = '';
    const watch = async (label: string, f: FrameState, seconds: number): Promise<void> => {
      const steps = Math.round(seconds / 0.05);
      for (let i = 0; i < steps; i++) {
        await r.frame(f);
        f.tick += 0.05 * TICK_RATE;
        const mb = r.engine.stats().musicMegabytes;
        if (mb > peak) {
          peak = mb;
          at = label;
        }
      }
    };
    r.engine.playMusic(['lobby']);
    let tick = 0;
    const next = (seconds: number): number => (tick += seconds * TICK_RATE);
    const phase = (p: string, stage: number, duration = 0, nextStage?: number): void => {
      r.event({ type: 'matchPhase', tick, phase: p, stage, duration, nextStage });
    };
    const brief = frameOf({ tick, phase: 'briefing' });
    r.session.frame = brief;
    phase('briefing', 1, 10);
    await watch('briefing', brief, 10);
    for (const stage of [1, 2, 3] as const) {
      const play = frameOf({ tick: next(0), stage });
      r.session.frame = play;
      phase('playing', stage);
      await watch(`stage ${stage}`, play, 20);
      if (stage === 3) break;
      const cocooned = frameOf({ tick: next(20), stage, kaiju: { action: 'molt', phase: 'cocoon', phaseDuration: 10 } });
      r.session.frame = cocooned;
      r.event({ type: 'cocoon', tick, kaiju: 0, x: 0, z: 0, duration: 10 });
      await watch(`cocoon ${stage}`, cocooned, 10);
      const inter = frameOf({ tick: next(10), stage, phase: 'intermission', kaiju: { stage: (stage + 1) as StageId } });
      r.session.frame = inter;
      r.event({ type: 'moltBlast', tick, kaiju: 0, x: 0, z: 0, killRadius: 30, shoveRadius: 60 });
      phase('intermission', stage, 8, stage + 1);
      await watch(`intermission ${stage}`, inter, 8);
      next(8);
    }
    const ended = frameOf({ tick: next(20), stage: 3, phase: 'ended' });
    r.session.frame = ended;
    r.event({ type: 'matchEnd', tick, winner: 'humans', reason: 'clock', duration: 100, tallies: [] });
    await watch('end screen', ended, 20);
    r.audio.end();
    r.engine.playMusic(['lobby']);
    await watch('lobby again', ended, 1);
    const megabytes = (seconds: number): number => (seconds * 48000 * 2 * 4) / 1e6;
    const music = (): number => [...r.ctx.decoded.keys()].filter((u) => u.includes('/music/')).length;
    // Every track of a match that ran out of time was played: all ten were decoded at some
    // point (lobby twice; the final minute never came, its clock stayed long).
    expect(music()).toBe(10);
    // Kept, it would be all of it, 280 MB of music. The most at once is in the briefing (92 MB:
    // its own track, the first stage's track and the four short cues).
    const all = megabytes(Object.values(MUSIC).reduce((s, m) => s + m.duration, 0));
    expect(all).toBeGreaterThan(275);
    expect(peak, `peak during ${at}`).toBeLessThan(100);
    expect(peak, `peak during ${at}`).toBeGreaterThan(megabytes(154.1 + 65.4));
    // Back in the lobby: the lobby track and nothing else of the music.
    expect(r.engine.stats().musicMegabytes).toBeCloseTo(megabytes(80.5), 1);
    expect(r.ctx.decoded.get('audio/music/lobby.ogg')).toBe(2);
  });
});

describe('events that arrive long after they happened', () => {
  it('makes no sound for a backlog, and still knows what should be playing', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.hold(frameOf({ tick: 900, stage: 1 }), 0.2);
    const sounds = (): number => r.ctx.started.filter((s) => s.buffer?.url.includes('/sfx/') && !s.loop).length;
    const before = sounds();
    // The tab was hidden for a minute: the first frame back is 1800 ticks later and brings it all.
    const back = frameOf({ tick: 2700, stage: 2 });
    r.session.frame = back;
    for (let i = 0; i < 600; i++) {
      const tick = 900 + i * 2.9;
      r.event({ type: 'projectileSpawn', tick, id: i, projectile: 'shell', x: 0, y: 1, z: 0 });
      r.event({ type: 'projectileHit', tick, id: i, target: 'kaiju', x: 0, y: 1, z: 0, splash: 5 });
      r.event({ type: 'kaijuHit', tick, kaiju: 0, damage: 5 });
    }
    r.event(voice('volley.fired', 1500, { humans: [MOLT_LINE] }));
    r.event({ type: 'cocoon', tick: 1500, kaiju: 0, x: 0, z: 0, duration: 10 });
    r.event({ type: 'moltBlast', tick: 1800, kaiju: 0, x: 0, z: 0, killRadius: 30, shoveRadius: 60 });
    r.event({ type: 'matchPhase', tick: 1800, phase: 'intermission', stage: 1, duration: 8, nextStage: 2 });
    r.event({ type: 'matchPhase', tick: 2040, phase: 'playing', stage: 2, duration: 0 });
    expect(sounds()).toBe(before);
    expect(say).not.toHaveBeenCalled();
    await r.hold(back, 0.5);
    expect(sounds()).toBe(before);
    expect(r.ctx.startedFrom('kaiju_heartbeat_loop')).toHaveLength(0);
    // The cues whose moment has passed never started; the stage that is on did.
    expect(r.ctx.startedFrom('music/cocoon')).toHaveLength(0);
    expect(r.ctx.startedFrom('music/intermission')).toHaveLength(0);
    expect(r.engine.music).toBe('stage2');
    expect(r.ctx.startedFrom('music/stage2')).toHaveLength(1);
  });

  it('still plays what happened within the last second, held to the voice limits', async () => {
    const r = rig();
    await r.hold(frameOf({ tick: 900 }), 0.2);
    const f = frameOf({ tick: 960 });
    r.session.frame = f;
    for (let i = 0; i < 40; i++) r.event({ type: 'projectileSpawn', tick: 900 + i, id: i, projectile: 'shell', x: 0, y: 1, z: 0 });
    // Ticks 900 to 929 are more than a second old at tick 960; 930 to 939 are not.
    expect(r.ctx.startedFrom('tank_fire')).toHaveLength(5);
  });

  it('plays nothing the session hands out as a backlog, however recent', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.hold(frameOf({ tick: 900 }), 0.2);
    const f = frameOf({ tick: 905 });
    r.session.frame = f;
    r.session.catchingUp = true;
    for (let i = 0; i < 10; i++) r.event({ type: 'projectileSpawn', tick: 904, id: i, projectile: 'shell', x: 0, y: 1, z: 0 });
    r.event(voice('volley.fired', 904, { humans: [MOLT_LINE] }));
    expect(r.ctx.startedFrom('tank_fire')).toHaveLength(0);
    expect(say).not.toHaveBeenCalled();
    r.session.catchingUp = false;
    r.event({ type: 'projectileSpawn', tick: 904, id: 99, projectile: 'shell', x: 0, y: 1, z: 0 });
    expect(r.ctx.startedFrom('tank_fire')).toHaveLength(1);
  });

  it('times an intermission it hears of late by how much of it is left', async () => {
    const r = rig();
    await r.hold(frameOf({ tick: 900 }), 0.2);
    const f = frameOf({ tick: 1050, phase: 'intermission', kaiju: { stage: 2 } });
    r.session.frame = f;
    const at = r.ctx.currentTime;
    r.event({ type: 'matchPhase', tick: 900, phase: 'intermission', stage: 1, duration: 8, nextStage: 2 });
    await r.hold(f, 0.2);
    const build = r.ctx.startedFrom('music/intermission')[0];
    // 5 s of the 8 have gone: 3 s to the hit.
    expect((build.startedAt as number) + (20 - build.offset) - at).toBeCloseTo(3, 2);
  });

  it('keeps the result of a match that ended while nobody looked, without the fanfare', async () => {
    const r = rig();
    await r.hold(frameOf({ tick: 900 }), 0.2);
    const ended = frameOf({ tick: 900 + 20 * TICK_RATE, phase: 'ended' });
    r.session.frame = ended;
    r.event({ type: 'matchEnd', tick: 900, winner: 'humans', reason: 'kill', duration: 100, tallies: [] });
    await r.hold(ended, 0.3);
    expect(r.ctx.startedFrom('win_humans')).toHaveLength(0);
    expect(r.ctx.startedFrom('kaiju_death')).toHaveLength(0);
    expect(r.engine.music).toBe('hearing');
  });
});

describe('small things', () => {
  it('pitches the hurt sound by the size of the kaiju', async () => {
    for (const [stage, rate] of [[1, 1.2], [2, 1], [3, 0.8]] as const) {
      const r = rig();
      await r.hold(frameOf({ stage }), 1);
      r.event({ type: 'kaijuHit', tick: 900 + TICK_RATE, kaiju: 0, damage: 5 });
      expect(r.ctx.startedFrom('kaiju_hurt')[0].playbackRate.value).toBe(rate);
    }
  });

  it('lets go of everything when the match is over', async () => {
    const r = rig();
    const cocooned = frameOf({ kaiju: { action: 'molt', phase: 'cocoon', phaseDuration: 10 }, units: [unit({ laser: true, charge: 0.5 })] });
    r.session.frame = cocooned;
    r.event({ type: 'cocoon', tick: 900, kaiju: 0, x: 0, z: 0, duration: 10 });
    r.event(voice('volley.fired', 900, { humans: [MOLT_LINE] }));
    await r.hold(cocooned, 1);
    const loops = r.ctx.started.filter((s) => s.loop && s.buffer?.url.includes('/sfx/'));
    expect(loops.map((s) => s.buffer?.url.split('/').pop()).sort()).toEqual(['amb_day_loop.ogg', 'kaiju_heartbeat_loop.ogg', 'laser_charge_loop.ogg']);
    r.audio.end();
    await vi.advanceTimersByTimeAsync(500);
    r.ctx.advance(0.5);
    expect(loops.every((s) => !s.playing)).toBe(true);
    expect(r.engine.speaking).toBe(false);
    expect(r.ctx.playing().filter((s) => s.buffer?.url.includes('/voice/'))).toHaveLength(0);
  });
});

describe('the moves of phases 1 and 3', () => {
  /** The first tick from `from` on whose attack shows `look` (render/kaijuAnimator.ts, as every screen picks it). */
  const tickWithLook = (action: 'swipe' | 'stomp', look: number, from: number): number => {
    let t = from;
    while (attackVariant(action, t, 0) !== look) t++;
    return t;
  };
  const act = (tick: number, action: string, phase: string, duration: number): object => ({ type: 'kaijuAction', tick, kaiju: 0, action, phase, duration, x: 0, z: 0, yaw: 0 });

  it('sounds the look every screen draws: the two-claw rake, the hop, the stumble its own fall', async () => {
    const r = rig();
    const rake = tickWithLook('swipe', 2, 900);
    let f = frameOf({ tick: rake });
    await r.frame(f);
    r.event(act(rake, 'swipe', 'windup', 0.45));
    await r.hold(f, 0.6);
    const swipe = tickWithLook('swipe', 0, rake + 60);
    f = frameOf({ tick: swipe });
    await r.frame(f);
    r.event(act(swipe, 'swipe', 'windup', 0.45));
    await r.hold(f, 0.6);
    expect(r.ctx.startedFrom('kaiju_rake_s1')).toHaveLength(1);
    expect(r.ctx.startedFrom('kaiju_swipe_s1')).toHaveLength(1);
    // The stomp's look is the one of the tick its wind-up began, reckoned back from its landing (0.9 s).
    const hop = tickWithLook('stomp', 2, swipe + 60) + 27;
    f = frameOf({ tick: hop });
    await r.frame(f);
    r.event(act(hop, 'stomp', 'active', 0.1));
    await r.frame(f);
    expect(r.ctx.startedFrom('kaiju_hop_s1')).toHaveLength(1);
    expect(r.ctx.startedFrom('kaiju_stomp_s1')).toHaveLength(0);
    const fall = hop + 60;
    f = frameOf({ tick: fall });
    await r.frame(f);
    r.event(act(fall, 'charge', 'stumble', 1.2));
    await r.frame(f);
    expect(r.ctx.startedFrom('kaiju_stumble_s1').map((s) => s.buffer?.url)).toEqual([`audio/sfx/kaiju_stumble_s1_${attackVariant('charge', fall, 0) + 1}.ogg`]);
  });

  it('starts a whoosh early enough for it to peak as the strike comes through', async () => {
    const r = rig();
    const t = tickWithLook('swipe', 0, 900);
    const f = frameOf({ tick: t });
    await r.frame(f);
    const asked = r.ctx.currentTime;
    r.event(act(t, 'swipe', 'windup', 0.45));
    await r.hold(f, 0.6);
    const lead = (r.ctx.startedFrom('kaiju_swipe_s1')[0].startedAt ?? 0) - asked;
    expect(Math.abs(lead - (0.45 - WHOOSH_PEAK.swipe[0]))).toBeLessThan(0.08);
  });

  it('rings the ears of a squad stunned by the roar once, and shakes it when the stun is over', async () => {
    const r = rig();
    const f = frameOf({ units: [unit({ id: 0 }), unit({ id: 1 }), unit({ id: 2, squad: 1 })] });
    await r.frame(f);
    for (const id of [0, 1, 2]) {
      r.event({ type: 'unitStunned', tick: f.tick, unit: id, duration: 2.5 });
      r.event({ type: 'unitShaken', tick: f.tick, unit: id });
    }
    await r.hold(f, 1);
    expect(r.ctx.startedFrom('stun_ring')).toHaveLength(1);
    expect(r.ctx.startedFrom('shaken')).toHaveLength(0);
    await r.hold(f, 2);
    expect(r.ctx.startedFrom('shaken')).toHaveLength(1);
  });
});
