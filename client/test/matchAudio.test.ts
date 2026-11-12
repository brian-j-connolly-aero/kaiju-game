import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TICK_RATE,
  VOICE_LINES,
  voiceLinesFor,
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
import { CHAIR_AT, chargeTone, HEARING_MUSIC_AT, isRadioLine, MatchAudio, voiceAheadIds, type MatchAudioSession } from '../src/audio/matchAudio';
import type { FrameState, LocalRole } from '../src/net/matchSession';
import { FakeAudioContext, FakeGain, fakeFetch, type FakeFetch, type FakeSource } from './fakeAudio';

/** Lengths of the real music files (seconds); one-shots have no loop points. */
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
];

interface Rig {
  engine: AudioEngine;
  audio: MatchAudio;
  ctx: FakeAudioContext;
  fetcher: FakeFetch;
  session: { role: LocalRole; mirror: MatchAudioSession['mirror']; frame: FrameState | null };
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
  for (const [id, loop] of Object.entries(SFX_LOOPS)) {
    manifest.sfx[id] = { variants: [`audio/sfx/${id}`], gain: 1, loop };
    ctx.durations.set(`audio/sfx/${id}.ogg`, loop[1] + 0.25);
  }
  for (const l of VOICE_LINES) {
    manifest.voice[l.id] = { base: `audio/voice/${l.id}`, duration: 2.2 };
    ctx.durations.set(`audio/voice/${l.id}.ogg`, 2.2);
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

function frameOf(over: { tick?: number; phase?: SnapMatch['phase']; stage?: StageId; kaiju?: Partial<SnapKaiju>; units?: SnapUnit[] } = {}): FrameState {
  const stage = over.stage ?? 1;
  return {
    tick: over.tick ?? 900,
    match: { phase: over.phase ?? 'playing', stage } as SnapMatch,
    kaijus: [kaiju({ stage, ...over.kaiju })],
    squads: [],
    units: over.units ?? [],
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } as Bounds,
    localUnit: null,
    localKaiju: null,
  };
}

function voice(cue: VoiceCueId, tick: number, lines: { humans?: string[]; kaiju?: string[] }): object {
  return { type: 'voice', tick, cue, variant: 0, squad: -1, player: -1, lines: { humans: lines.humans ?? [], kaiju: lines.kaiju ?? [] } };
}

const firstLine = (cue: VoiceCueId, side: 'humans' | 'kaiju'): string => voiceLinesFor(cue, side)[0].id;

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
  it('plays the lines the simulation chose for the listener, never its own pick', async () => {
    const humans = rig();
    const say = vi.spyOn(humans.engine, 'say');
    await humans.frame(frameOf());
    // The event names a line of another cue on purpose: the ids decide, not the cue.
    const chosen = firstLine('crossfire', 'humans');
    const forKaiju = firstLine('kaiju.roar', 'kaiju');
    humans.event(voice('volley.fired', 900, { humans: [chosen], kaiju: [forKaiju] }));
    expect(say.mock.calls.map((c) => c[0].id)).toEqual([chosen]);

    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    const sayK = vi.spyOn(k.engine, 'say');
    await k.frame(frameOf());
    k.event(voice('volley.fired', 900, { humans: [chosen], kaiju: [forKaiju] }));
    expect(sayK.mock.calls.map((c) => c[0].id)).toEqual([forKaiju]);
    // Nothing chosen for this side: nothing is said.
    k.event(voice('volley.ready', 900, { humans: [chosen] }));
    expect(sayK).toHaveBeenCalledTimes(1);
  });

  it('plays a briefing in order, never to be dropped', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.frame(frameOf({ phase: 'briefing', tick: 10 }));
    const ids = voiceLinesFor('match.briefing', 'humans').map((l) => l.id);
    expect(ids.length).toBeGreaterThan(1);
    r.event(voice('match.briefing', 10, { humans: ids }));
    expect(say.mock.calls.map((c) => c[0].id)).toEqual(ids);
    for (const c of say.mock.calls) expect(c[1]?.priority).toBe(3);
  });

  it('treats radio as a property of the line, not of the listener', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.frame(frameOf());
    r.event(voice('volley.fired', 900, { humans: [firstLine('volley.fired', 'humans')] }));
    expect(say.mock.calls[0][1]?.radio).toBe(true);
    // The news anchor and the committee chair are not on the radio, whoever hears them.
    for (const l of VOICE_LINES) expect(isRadioLine(l), l.id).toBe(l.audience === 'humans');
    expect(VOICE_LINES.some((l) => l.speaker === 'Chair' && isRadioLine(l))).toBe(false);
  });

  it('holds the hearing line for the end screen instead of queueing it', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.frame(frameOf());
    const chair = firstLine('hearing.humans.win', 'humans');
    r.event(voice('hearing.humans.win', 900, { humans: [chair], kaiju: [chair] }));
    expect(say).not.toHaveBeenCalled();
    expect(r.audio.takeHearing()?.id).toBe(chair);
    expect(r.audio.takeHearing()).toBeNull();
  });

  it('sends an order to the front, lets it cut in, and lets it go stale fast', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.frame(frameOf());
    r.event(voice('nerve.break', 900, { humans: [firstLine('nerve.break', 'humans')] }));
    r.event(voice('kaiju.special', 900, { humans: [firstLine('kaiju.special', 'humans')] }));
    r.event(voice('volley.fired', 900, { humans: [firstLine('volley.fired', 'humans')] }));
    r.event(voice('end.kaiju', 900, { humans: [firstLine('end.kaiju', 'humans')] }));
    expect(say.mock.calls[0][1]).toMatchObject({ priority: 2.5, staleAfter: 1.5, cutsIn: true, radio: true });
    expect(say.mock.calls[1][1]).toMatchObject({ priority: 2.5, staleAfter: 1.5, cutsIn: true });
    expect(say.mock.calls[2][1]).toMatchObject({ priority: 1, cutsIn: false });
    expect(say.mock.calls[2][1]?.staleAfter).toBeUndefined();
    // The last word on the match is never dropped.
    expect(say.mock.calls[3][1]).toMatchObject({ priority: 3 });

    // The same cues are news, not orders, for the kaiju player.
    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    const sayK = vi.spyOn(k.engine, 'say');
    await k.frame(frameOf());
    k.event(voice('nerve.break', 900, { kaiju: [firstLine('nerve.break', 'kaiju')] }));
    expect(sayK.mock.calls[0][1]).toMatchObject({ priority: 2, cutsIn: false, radio: false });
  });

  it('starts an order on a free radio at once, and within 1.5 s or not at all on a busy one', async () => {
    const r = rig();
    await r.frame(frameOf());
    const order = firstLine('nerve.break', 'humans');
    r.event(voice('nerve.break', 900, { humans: [order] }));
    await r.frame(frameOf());
    const src = r.ctx.startedFrom(`voice/${order}.`)[0];
    expect(src.startedAt).toBeLessThan(0.3);
    // It was loaded before the match: nothing was fetched when it was called for.
    expect(r.fetcher.requests.filter((u) => u === `audio/voice/${order}.ogg`)).toHaveLength(1);
    expect(voiceAheadIds('humans')).toContain(order);
  });

  it('loads the lines that must start at once before the match, for the side that hears them', () => {
    const humans = rig();
    const ahead = voiceAheadIds('humans');
    expect(ahead.length).toBeGreaterThanOrEqual(12);
    for (const id of ahead) expect(humans.fetcher.requests, id).toContain(`audio/voice/${id}.ogg`);
    expect(humans.fetcher.requests.filter((u) => u.includes('/voice/'))).toHaveLength(ahead.length);
    const k = rig({ kind: 'kaiju', kaijuId: 0, squadId: -1, playerId: 0 });
    const aheadK = voiceAheadIds('kaiju');
    expect(aheadK.length).toBeGreaterThan(0);
    expect(k.fetcher.requests.filter((u) => u.includes('/voice/')).sort()).toEqual(aheadK.map((id) => `audio/voice/${id}.ogg`).sort());
    expect(ahead.some((id) => aheadK.includes(id))).toBe(false);
  });
});

describe('the end of the match', () => {
  const matchEnd = (tick: number, winner: 'kaiju' | 'humans'): object => ({ type: 'matchEnd', tick, winner, reason: winner === 'kaiju' ? 'bar' : 'clock', duration: 100, tallies: [] });

  it('plays the win cue, then the hearing music, then the chair over it, once', async () => {
    const r = rig();
    const say = vi.spyOn(r.engine, 'say');
    await r.frame(frameOf({ stage: 3 }));
    const ended = frameOf({ stage: 3, phase: 'ended' });
    r.session.frame = ended;
    const chair = firstLine('hearing.kaiju.win', 'humans');
    r.event(matchEnd(900, 'kaiju'));
    r.event(voice('end.kaiju', 900, { humans: [firstLine('end.kaiju', 'humans')] }));
    r.event(voice('hearing.kaiju.win', 900, { humans: [chair] }));
    await r.hold(ended, 1);
    expect(r.engine.music).toBe('win_kaiju');
    expect(r.ctx.startedFrom('win_kaiju')[0].loop).toBe(false);
    expect(say).toHaveBeenCalledTimes(1);
    await r.hold(ended, HEARING_MUSIC_AT - 1 - 0.2);
    expect(r.engine.music).toBe('win_kaiju');
    await r.hold(ended, 0.4);
    expect(r.engine.music).toBe('hearing');
    expect(r.ctx.startedFrom('music/hearing')).toHaveLength(1);
    expect(say).toHaveBeenCalledTimes(1);
    await r.hold(ended, CHAIR_AT - HEARING_MUSIC_AT);
    expect(say).toHaveBeenCalledTimes(2);
    expect(say.mock.calls[1][0].id).toBe(chair);
    expect(say.mock.calls[1][1]).toMatchObject({ priority: 3, radio: false });
    const spoken = r.ctx.startedFrom(`voice/${chair}.`)[0];
    expect(spoken.startedAt).toBeGreaterThan(CHAIR_AT - 0.1);
    expect(spoken.startedAt).toBeLessThan(CHAIR_AT + 0.4);
    await r.hold(ended, 10);
    expect(say).toHaveBeenCalledTimes(2);
    expect(r.ctx.startedFrom('music/hearing')).toHaveLength(1);
  });

  it('gives someone who arrived after the end a chair line as well, and leaves it to whoever took it first', async () => {
    const late = rig({ kind: 'spectator', squadId: -1, playerId: -1 });
    const say = vi.spyOn(late.engine, 'say');
    const ended = frameOf({ stage: 2, phase: 'ended' });
    late.session.frame = ended;
    late.event(matchEnd(900, 'humans'));
    await late.hold(ended, CHAIR_AT + 0.3);
    expect(say).toHaveBeenCalledTimes(1);
    expect(VOICE_LINES.find((l) => l.id === say.mock.calls[0][0].id)?.cue).toBe('hearing.humans.win');

    const taken = rig();
    const sayT = vi.spyOn(taken.engine, 'say');
    ended.tick = 900;
    taken.session.frame = ended;
    taken.event(matchEnd(900, 'humans'));
    taken.event(voice('hearing.humans.win', 900, { humans: [firstLine('hearing.humans.win', 'humans')] }));
    await taken.hold(ended, 1);
    expect(taken.audio.takeHearing()).not.toBeNull();
    await taken.hold(ended, CHAIR_AT + 2);
    expect(sayT).not.toHaveBeenCalled();
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
    expect(r.engine.music).toBe('stage1_base+stage1_combat');
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
    expect(r.engine.music).toBe('stage2_base+stage2_combat');
    expect(gainOf(build).gain.last).toMatchObject({ kind: 'target', value: 0 });
    expect(gainOf(build).gain.last?.timeConstant).toBeCloseTo(2.5 / 3, 3);
    const stem = r.ctx.startedFrom('stage2_base')[0];
    expect(gainOf(stem).gain.events.find((e) => e.kind === 'target')?.timeConstant).toBeCloseTo(0.1, 3);
    // The stems were announced while the build played: they start within a frame of the hit.
    expect((stem.startedAt as number) - (startedAt + 8)).toBeLessThan(0.2);
  });

  it('loads the coming stage in an intermission from the kaiju, whose stage is already the new one', async () => {
    const r = rig({ kind: 'spectator', squadId: -1, playerId: -1 });
    await r.frame(frameOf({ stage: 1, phase: 'intermission', kaiju: { stage: 2, kind: 'crab' as KaijuKindId } }));
    expect(r.fetcher.requests).toContain('audio/music/stage2_base.ogg');
    expect(r.fetcher.requests).toContain('audio/music/stage2_combat.ogg');
    expect(r.fetcher.requests).toContain('audio/sfx/kaiju_roar_crab_s2.ogg');
    expect(r.fetcher.requests).not.toContain('audio/music/stage1_base.ogg');
  });

  it('loads the roar of the kaiju that is in the match', async () => {
    const r = rig();
    await r.frame(frameOf({ stage: 1, kaiju: { kind: 'crab' as KaijuKindId } }));
    expect(r.fetcher.requests).toContain('audio/sfx/kaiju_roar_crab_s1.ogg');
    expect(r.fetcher.requests).not.toContain('audio/sfx/kaiju_roar_lizard_s1.ogg');
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
        const mb = r.engine.stats().megabytes;
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
    // Every track was played: all thirteen were decoded at some point (lobby twice).
    expect(music()).toBe(13);
    // Before: everything stayed, 261 MB of music. Now the most at once is one stage's two
    // stems with the next stage's two loading under the cocoon, and the short cues.
    const all = megabytes(Object.values(MUSIC).reduce((s, m) => s + m.duration, 0));
    expect(all).toBeGreaterThan(255);
    expect(peak, `peak during ${at}`).toBeLessThan(160);
    // Back in the lobby: the lobby track and nothing else of the music.
    const sfxAndVoice = r.engine.stats().megabytes - megabytes(80.5);
    expect(sfxAndVoice).toBeLessThan(40);
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
    r.event(voice('volley.fired', 1500, { humans: [firstLine('volley.fired', 'humans')] }));
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
    expect(r.engine.music).toBe('stage2_base+stage2_combat');
    expect(r.ctx.startedFrom('stage2_base')).toHaveLength(1);
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
    r.event(voice('volley.fired', 900, { humans: [firstLine('volley.fired', 'humans')] }));
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
