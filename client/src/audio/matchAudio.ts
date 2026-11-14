/**
 * Turns what happens in a match into sound: simulation events into effects at their place in
 * the world, the match phase and stage into music, voice cues into spoken lines for the side
 * the local player is on (humans hear the radio, the kaiju player hears the news), and the
 * state of the fight into how much of the combat stem plays.
 *
 * Two rules keep it honest when the page has missed something (a hidden tab, a reconnection):
 * what should be sounding NOW is read from the frame state on every update (the beam, the
 * heartbeat, the charging tone, the stage music), and an event that is delivered long after it
 * happened still counts for that state but its one-shot sounds and radio lines are skipped.
 */

import {
  chooseVoiceLines,
  kaijuStageDef,
  stageDef,
  TICK_RATE,
  unitTypeDef,
  VOICE_LINES,
  VOICE_SIDE_RULES,
  type CityData,
  type KaijuKindId,
  type MatchEndEvent,
  type SimEvent,
  type SnapKaiju,
  type SnapUnit,
  type StageId,
  type VoiceCueId,
  type VoiceEvent,
  type VoiceLine,
} from '@mb/shared';
import type { FrameState, LocalRole } from '../net/matchSession';
import type { AudioEngine, LoopHandle } from './audioEngine';

/** What the match audio reads from the match session. */
export interface MatchAudioSession {
  readonly role: LocalRole;
  readonly mirror: { readonly city: Pick<CityData, 'structures' | 'props'> };
  /** The frame most recently put together (events are handed out while it is the current one). */
  readonly frame: FrameState | null;
  /** True while the session hands out a backlog of events whose moment has passed (a hidden tab). */
  readonly catchingUp?: boolean;
}

/** How far big sounds carry before they fall off, by stage: a titan is heard across the city. */
const REACH: Record<StageId, number> = { 1: 14, 2: 40, 3: 110 };

const AMBIENCE = { afternoon: 'amb_day_loop', sunset: 'amb_sunset_loop', night: 'amb_night_loop' } as const;

/** An event delivered this long after it happened is no longer heard (a tab that was hidden, a page that hung). */
export const STALE_EVENT_SECONDS = 1;
/** The frame state must contradict a loop for this long before it is started or stopped without its event. */
const LOOP_GRACE = 0.3;
/** Seconds after the end of the match: the win cue has rung out (both are below -30 dBFS from 12.2 s). */
export const HEARING_MUSIC_AT = 12.5;
/** Seconds after the end of the match: one bar of the hearing music later, the committee chair speaks. */
export const CHAIR_AT = 15;
/** An order for a window that is closing (the stagger, the signature attack) is worthless after this wait. */
const ORDER_STALE_SECONDS = 1.5;
/** At most one "volley ready" ping in this time: sub-units ordered together fill on the same frame. */
const READY_GAP = 0.3;

/** Cues whose lines are loaded before the match, so that they start at once. */
const VOICE_AHEAD: readonly VoiceCueId[] = ['match.briefing', 'match.start', 'nerve.break', 'kaiju.special'];

let linesById: Map<string, VoiceLine> | null = null;

function lineById(id: string): VoiceLine | undefined {
  if (!linesById) linesById = new Map(VOICE_LINES.map((l) => [l.id, l]));
  return linesById.get(id);
}

/**
 * Radio is a property of the line, not of the listener: the lines only the humans hear are
 * the radio voices (command and the squads). The news anchor and the committee chair are not.
 */
export function isRadioLine(line: Pick<VoiceLine, 'audience'>): boolean {
  return line.audience === 'humans';
}

/**
 * The ids of the lines a side should have decoded before the match starts. The news only ever
 * speaks for its own short list of cues (VOICE_SIDE_RULES), so nothing else is loaded for it.
 */
export function voiceAheadIds(side: 'humans' | 'kaiju'): string[] {
  const news: readonly VoiceCueId[] = VOICE_SIDE_RULES.news.cues;
  return VOICE_LINES.filter(
    (l) => l.audience === side && VOICE_AHEAD.includes(l.cue) && (side === 'humans' || news.includes(l.cue)),
  ).map((l) => l.id);
}

/**
 * The charging tone of the local player's squad: one tone however many sub-units are charging.
 * `rate` climbs a fifth with the fullest charge (1 to 1.5, where "volley ready" picks it up),
 * `gain` grows with every laser that joins and drops to a hum once all of them are full, and
 * `full` counts the full ones. Null when nobody in the squad is charging.
 */
export function chargeTone(
  units: readonly Pick<SnapUnit, 'alive' | 'laser' | 'squad' | 'charge'>[],
  squadId: number,
): { rate: number; gain: number; full: number } | null {
  if (squadId < 0) return null;
  let count = 0;
  let top = 0;
  let full = 0;
  for (const u of units) {
    if (!u.alive || !u.laser || u.squad !== squadId) continue;
    count++;
    top = Math.max(top, u.charge);
    if (u.charge >= 0.999) full++;
  }
  if (count === 0) return null;
  return { rate: 1 + 0.5 * top, gain: full === count ? 0.3 : 0.5 + 0.17 * Math.min(3, count), full };
}

/** Effects worth having decoded before the first shot is fired (the kaiju's own are loaded per stage). */
export const PRELOAD_SFX = [
  'kaiju_hurt',
  'rocket_launch',
  'tank_fire',
  'explosion_s',
  'explosion_m',
  'structure_hit',
  'crumble_s',
  'crumble_m',
  'car_crush',
  'prop_break',
  'volley_ready',
  'laser_charge_loop',
  'radio_open',
  'radio_close',
  'ui_click',
];

/** The music of a stage: the base stem and the combat stem. */
function stems(stage: StageId): string[] {
  return [`stage${stage}_base`, `stage${stage}_combat`];
}

export class MatchAudio {
  private readonly audio: AudioEngine;
  private session: MatchAudioSession | null = null;
  private frame: FrameState | null = null;
  private ambience: LoopHandle | null = null;
  private ambienceId = '';
  private beam: LoopHandle | null = null;
  private beamOff = 0;
  private heartbeat: LoopHandle | null = null;
  private heartbeatOff = 0;
  private charge: LoopHandle | null = null;
  private chargedCount = 0;
  private lastReady = -1;
  private musicStage: StageId | 0 = 0;
  /** The stage whose sounds and music have been loaded ahead. */
  private loadedStage: StageId | 0 = 0;
  /** The kaiju whose cocoon has been announced to the loader, or -1. */
  private cocoonOf = -1;
  private heat = 0;
  private lastHurt = 0;
  private lastCrush = 0;
  private time = 0;
  /** The committee chair's line for this match, held for the end screen. */
  private hearing: VoiceLine | null = null;
  private result: MatchEndEvent | null = null;
  /** Seconds since the match ended. */
  private sinceEnd = 0;
  private chairSaid = false;

  constructor(audio: AudioEngine) {
    this.audio = audio;
  }

  begin(session: MatchAudioSession): void {
    this.end();
    this.session = session;
    this.audio.preload(PRELOAD_SFX);
    // The one-shots are short; the stage's own stems follow as soon as the stage is known.
    this.audio.preloadMusic(['cocoon', 'intermission', 'win_humans', 'win_kaiju']);
    this.audio.preloadVoice(voiceAheadIds(this.side()));
  }

  end(): void {
    this.session = null;
    this.frame = null;
    this.ambience?.stop();
    this.ambience = null;
    this.ambienceId = '';
    this.stopLoops();
    this.charge?.stop(0.15);
    this.charge = null;
    this.chargedCount = 0;
    this.lastReady = -1;
    this.musicStage = 0;
    this.loadedStage = 0;
    this.cocoonOf = -1;
    this.heat = 0;
    this.hearing = null;
    this.result = null;
    this.sinceEnd = 0;
    this.chairSaid = false;
    this.audio.clearVoice();
    this.audio.releaseMusic();
    this.audio.releaseVoice();
  }

  private stopLoops(fade?: number): void {
    this.beam?.stop(fade);
    this.beam = null;
    this.beamOff = 0;
    this.heartbeat?.stop(fade);
    this.heartbeat = null;
    this.heartbeatOff = 0;
  }

  private stageOf(kaijuId: number): { k: SnapKaiju; stage: StageId } | null {
    const k = this.frame?.kaijus[kaijuId];
    return k ? { k, stage: k.stage } : null;
  }

  /** Which side's lines the local player hears. Spectators listen to the radio. */
  private side(): 'humans' | 'kaiju' {
    return this.session?.role.kind === 'kaiju' ? 'kaiju' : 'humans';
  }

  /** Seconds between an event happening and it being handed out here. */
  private ageOf(e: SimEvent): number {
    const frame = this.session?.frame ?? this.frame;
    return frame ? (frame.tick - e.tick) / TICK_RATE : 0;
  }

  /**
   * Plays the lines the simulation chose for this side (`event.lines`; the id of a line is also
   * its audio file). The client never picks lines itself, so everyone hears the same ones.
   */
  private speak(e: VoiceEvent, fresh: boolean): void {
    const side = this.side();
    // `lines` is always sent; the guard is for a message that lost it on the way.
    const lines: VoiceLine[] = [];
    for (const id of (e.lines as Partial<VoiceEvent['lines']> | undefined)?.[side] ?? []) {
      const line = lineById(id);
      if (line) lines.push(line);
    }
    if (e.cue.startsWith('hearing.')) {
      // The hearing belongs to the hearing music on the end screen, not to the win fanfare.
      this.hearing = lines[0] ?? null;
      return;
    }
    if (!fresh) return;
    const many = lines.length > 1;
    const ending = e.cue.startsWith('end.');
    const order = side === 'humans' && (e.cue === 'nerve.break' || e.cue === 'kaiju.special');
    const urgent = e.cue.startsWith('stage.') || e.cue === 'nerve.break' || e.cue === 'molt.available';
    for (const line of lines) {
      this.audio.say(line, {
        // The briefing and the last word on the match are never dropped; an order goes before chatter.
        priority: many || ending ? 3 : order ? 2.5 : urgent ? 2 : 1,
        radio: isRadioLine(line),
        staleAfter: order ? ORDER_STALE_SECONDS : undefined,
        cutsIn: order,
      });
    }
  }

  /** The committee chair's line for this match, once; whoever takes it says it. Null when it is gone or never came. */
  takeHearing(): VoiceLine | null {
    const line = this.hearing;
    this.hearing = null;
    if (line) this.chairSaid = true;
    return line;
  }

  private startHeartbeat(x: number, z: number, stage: StageId): void {
    this.heartbeat?.stop();
    this.heartbeat = this.audio.unlocked ? this.audio.loop('kaiju_heartbeat_loop', { x, y: 2, z, refDistance: REACH[stage] * 1.2 }) : null;
    this.heartbeatOff = 0;
  }

  private startBeam(k: SnapKaiju, x: number, z: number): void {
    this.beam?.stop();
    const y = kaijuStageDef(k.kind, k.stage).height * 0.6;
    // Sharp: the wind-up sound ends on its peak, so the beam comes in at full level.
    this.beam = this.audio.unlocked ? this.audio.loop('kaiju_beam_loop', { x, y, z, refDistance: REACH[k.stage], sharp: true }) : null;
    this.beamOff = 0;
  }

  /** A cocoon has begun: what follows it is 10 s away, so load it now and let go of what is over. */
  private announceCocoon(k: SnapKaiju): void {
    if (this.cocoonOf === k.id) return;
    this.cocoonOf = k.id;
    this.audio.preload(['kaiju_molt_blast']);
    this.audio.releaseMusic(stems(k.stage));
    if (k.stage < 3) {
      const next = (k.stage + 1) as StageId;
      this.audio.preloadMusic(['intermission', ...stems(next)]);
      this.loadKaijuSounds(k.kind, next);
    }
  }

  private loadKaijuSounds(kind: KaijuKindId, stage: StageId): void {
    this.audio.preload([`kaiju_step_s${stage}`, `kaiju_swipe_s${stage}`, `kaiju_stomp_s${stage}`, `kaiju_roar_${kind}_s${stage}`]);
  }

  /** A simulation event whose moment has come. */
  handleEvent(e: SimEvent): void {
    const a = this.audio;
    const age = this.ageOf(e);
    // Two signs that the moment has passed: the session says it is working through a backlog,
    // or the event is older, by the match clock, than anything a running page hands out.
    const fresh = age <= STALE_EVENT_SECONDS && this.session?.catchingUp !== true;
    // Old news makes no sound. Only the events that decide what plays from now on are still read.
    if (!fresh && e.type !== 'matchPhase' && e.type !== 'matchEnd' && e.type !== 'voice' && e.type !== 'cocoon') return;
    const stage = this.frame?.match.stage ?? 1;
    const reach = REACH[stage];
    switch (e.type) {
      case 'kaijuAction': {
        const s = this.stageOf(e.kaiju);
        if (!s) break;
        const at = { x: e.x, y: kaijuStageDef(s.k.kind, s.stage).height * 0.6, z: e.z, refDistance: REACH[s.stage] };
        if (e.action === 'swipe' && e.phase === 'windup') a.play(`kaiju_swipe_s${s.stage}`, at);
        else if (e.action === 'stomp' && e.phase === 'active') a.play(`kaiju_stomp_s${s.stage}`, { ...at, y: 0, refDistance: REACH[s.stage] * 1.5 });
        else if (e.action === 'grab' && e.phase === 'windup') a.play('kaiju_grab', at);
        else if (e.action === 'throw' && e.phase === 'windup') a.play('kaiju_throw', at);
        else if (e.action === 'eat' && (e.phase === 'eat' || e.phase === 'active')) a.play('kaiju_eat', at);
        else if (e.action === 'brace' && e.phase === 'brace') a.play('kaiju_brace', at);
        else if (e.action === 'special' && e.phase === 'windup') a.play('kaiju_beam_charge', at);
        else if (e.action === 'special' && e.phase === 'special') this.startBeam(s.k, e.x, e.z);
        if (e.action === 'special' && (e.phase === 'recover' || e.phase === 'idle')) {
          this.beam?.stop(0.4);
          this.beam = null;
        }
        break;
      }
      case 'roar': {
        const s = this.stageOf(e.kaiju);
        if (s) a.play(`kaiju_roar_${s.k.kind}_s${s.stage}`, { x: e.x, y: 10, z: e.z, refDistance: REACH[s.stage] * 2.5 });
        this.heat = 1;
        break;
      }
      case 'kaijuHit': {
        const s = this.stageOf(e.kaiju);
        if (s && this.time - this.lastHurt > 0.5 && e.damage > 0.5) {
          this.lastHurt = this.time;
          // One recording of one size of animal: higher for the hatchling, lower for the titan.
          a.play('kaiju_hurt', { x: s.k.x, y: 5, z: s.k.z, refDistance: REACH[s.stage], gain: 0.7, rate: [1.2, 1, 0.8][s.stage - 1] });
        }
        this.heat = 1;
        break;
      }
      case 'kaijuStagger': {
        const s = this.stageOf(e.kaiju);
        this.beam?.stop(0.2);
        this.beam = null;
        if (s && e.on) {
          a.play('kaiju_stagger', { x: s.k.x, y: 5, z: s.k.z, refDistance: REACH[s.stage] * 1.5 });
          a.play('sting_nerve_break', { gain: 0.8 });
        }
        break;
      }
      case 'projectileSpawn': {
        const at = { x: e.x, y: e.y, z: e.z, refDistance: e.projectile === 'rocket' ? 12 : 30 };
        if (e.projectile === 'rocket') a.play('rocket_launch', at);
        else if (e.projectile === 'shell') a.play('tank_fire', at);
        else if (e.projectile === 'arty') a.play('arty_incoming', { ...at, y: 0, refDistance: 80 });
        this.heat = 1;
        break;
      }
      case 'projectileHit': {
        if (e.target === 'none') break;
        const at = { x: e.x, y: e.y, z: e.z, refDistance: 14 + e.splash * 3 };
        if (e.target === 'water') a.play('splash', at);
        else a.play(e.splash >= 12 ? 'explosion_l' : e.splash >= 4.5 ? 'explosion_m' : 'explosion_s', at);
        break;
      }
      case 'structureStage': {
        const s = this.session?.mirror.city.structures[e.id];
        if (!s) break;
        const volume = s.hx * s.hz * 4 * s.height;
        const at = { x: s.x, y: s.height * 0.4, z: s.z, refDistance: 12 + Math.cbrt(volume) * 1.6 };
        if (e.stage >= 3) a.play(volume > 30000 ? 'crumble_l' : volume > 2500 ? 'crumble_m' : 'crumble_s', at);
        else a.play(s.cls === 'office' || s.cls === 'tower' ? 'glass' : 'structure_hit', at);
        break;
      }
      case 'propsDestroyed': {
        const city = this.session?.mirror.city;
        if (!city || this.time - this.lastCrush < 0.08) break;
        this.lastCrush = this.time;
        const p = city.props[e.ids[0]];
        if (!p) break;
        const car = p.kind.startsWith('car_') || p.kind === 'bus' || p.kind === 'truck';
        a.play(car ? 'car_crush' : 'prop_break', { x: p.x, y: 1, z: p.z, refDistance: 10, gain: car ? 0.9 : 0.6 });
        break;
      }
      case 'unitDestroyed':
        if (unitTypeDef(e.unitType).body !== 'infantry') a.play('explosion_m', { x: e.x, y: 1, z: e.z, refDistance: 25 });
        a.play('unit_destroyed', { x: e.x, y: 1, z: e.z, refDistance: 20 });
        break;
      case 'memberLost': {
        const u = this.frame?.units[e.unit];
        if (u) a.play('member_down', { x: u.x, y: 1, z: u.z, refDistance: 10, gain: 0.7 });
        break;
      }
      case 'unitShaken': {
        const u = this.frame?.units[e.unit];
        if (u && u.squad === this.session?.role.squadId) a.play('shaken', { gain: 0.6 });
        break;
      }
      case 'takeover':
        if (e.player === this.session?.role.playerId) a.play('takeover');
        break;
      case 'volley':
        a.play('volley_fire', { x: e.x, y: e.y, z: e.z, refDistance: 60 });
        break;
      case 'crossfire':
        a.play('sting_crossfire', { gain: 0.7 });
        break;
      case 'barMark':
        a.play('sting_bar_mark');
        break;
      case 'moltAvailable':
        if (this.side() === 'kaiju') a.play('sting_molt_ready');
        break;
      case 'cocoon': {
        const s = this.stageOf(e.kaiju);
        if (s) this.announceCocoon(s.k);
        if (fresh) this.startHeartbeat(e.x, e.z, s ? s.stage : stage);
        // The music stops dead where the blast sounds (its `mark`), however late the file starts.
        a.playMusic(['cocoon'], { fade: 0.8, landIn: e.duration - age });
        break;
      }
      case 'moltBlast':
        this.heartbeat?.stop(0.1);
        this.heartbeat = null;
        a.play('kaiju_molt_blast', { x: e.x, y: 5, z: e.z, refDistance: reach * 4 });
        break;
      case 'callin':
        if (e.phase === 'inbound') a.play('arty_distant', { gain: 0.8 });
        break;
      case 'matchPhase':
        if (e.phase === 'briefing') {
          a.playMusic(['briefing']);
        } else if (e.phase === 'intermission') {
          // A build whose one hit must land as the next stage begins: start it part-way in.
          a.playMusic(['intermission'], { fade: 0.6, landIn: e.duration - age });
        } else if (e.phase === 'playing') {
          this.musicStage = 0;
          if (fresh) a.play('ui_match_start', { gain: 0.7 });
        }
        break;
      case 'matchEnd':
        this.stopLoops();
        this.result = e;
        this.sinceEnd = Math.max(0, age);
        // Everything of the match can go once the win cue is on; the hearing bed is next.
        a.releaseMusic();
        a.preloadMusic(['hearing']);
        if (age < HEARING_MUSIC_AT) a.playMusic([e.winner === 'kaiju' ? 'win_kaiju' : 'win_humans'], { fade: 0.5 });
        if (fresh && e.winner === 'humans' && e.reason === 'kill') {
          const k = this.frame?.kaijus[0];
          if (k) a.play('kaiju_death', { x: k.x, y: 5, z: k.z, refDistance: REACH[k.stage] * 3 });
        }
        break;
      case 'voice':
        this.speak(e, fresh);
        break;
      default:
        break;
    }
  }

  /** A kaiju's foot came down. */
  step(k: SnapKaiju): void {
    this.audio.play(`kaiju_step_s${k.stage}`, { x: k.x, y: 0, z: k.z, refDistance: REACH[k.stage] * 0.8, gain: 0.8 });
  }

  /** Once per frame: music for the phase and stage, ambience for the time of day, combat heat, loops. */
  update(frame: FrameState, dt: number): void {
    this.time += dt;
    this.frame = frame;
    const a = this.audio;
    const match = frame.match;
    const playing = match.phase === 'playing';
    const k0: SnapKaiju | undefined = frame.kaijus[0];

    const cocoon = playing ? frame.kaijus.find((k) => k.alive && k.phase === 'cocoon') : undefined;

    // Load what the stage needs as soon as the stage is known. In an intermission the match
    // still holds the old stage and only the kaiju has the new one: that one is what is coming.
    // (Not during a cocoon: the stage's music is over by then, see announceCocoon.)
    const coming = match.phase === 'intermission' && k0 && k0.stage > match.stage ? k0.stage : match.stage;
    if (match.phase !== 'ended' && !cocoon && coming !== this.loadedStage) {
      this.loadedStage = coming;
      a.releaseMusic(([1, 2, 3] as const).filter((s) => s !== coming).flatMap(stems));
      a.preloadMusic(stems(coming));
      // The last stage has no molt: the two cues that go with one are not needed again.
      if (coming === 3) a.releaseMusic(['cocoon', 'intermission']);
      if (k0) this.loadKaijuSounds(k0.kind, coming);
    }

    // The timed phases normally get their music from their event; someone who arrived in the
    // middle of one (a late join, a reconnection) gets it from the frame, timed by what is left.
    if (match.phase === 'briefing' && a.music !== 'briefing') a.playMusic(['briefing']);
    if (match.phase === 'intermission' && a.music !== 'intermission') a.playMusic(['intermission'], { fade: 0.6, landIn: match.phaseTime });
    if (playing && !cocoon && this.musicStage !== match.stage) {
      // After the intermission: its hit rings out under the first bar, and the stage comes in at once.
      const afterIntermission = a.music === 'intermission';
      this.musicStage = match.stage;
      a.playMusic(stems(match.stage), afterIntermission ? { fade: 0.3, fadeOut: 2.5 } : {});
    }
    const wanted = match.phase === 'ended' ? '' : AMBIENCE[stageDef(match.stage).timeOfDay];
    if (wanted !== this.ambienceId && a.unlocked) {
      this.ambience?.stop(1.5);
      this.ambience = wanted ? a.loop(wanted, { gain: 0.5 }) : null;
      this.ambienceId = wanted;
    }
    // The fight is "on" while shots fly or lasers are lit, and cools down over a few seconds.
    if (frame.units.some((u) => u.alive && u.laser)) this.heat = Math.max(this.heat, 0.7);
    this.heat = Math.max(0, this.heat - dt * 0.12);
    a.setCombat(playing ? this.heat : 0);

    // The loops normally start and stop on their events. When the frame says otherwise for a
    // while, an event was missed (a reconnection, a hidden tab): the frame wins.
    if (cocoon) this.announceCocoon(cocoon);
    else this.cocoonOf = -1;
    this.heartbeatOff = (cocoon !== undefined) === (this.heartbeat !== null) ? 0 : this.heartbeatOff + dt;
    if (this.heartbeatOff > LOOP_GRACE) {
      if (cocoon) {
        this.startHeartbeat(cocoon.x, cocoon.z, cocoon.stage);
        if (a.music !== 'cocoon') a.playMusic(['cocoon'], { fade: 0.8, landIn: cocoon.phaseDuration - cocoon.phaseTime });
      } else {
        this.heartbeat?.stop();
        this.heartbeat = null;
        this.heartbeatOff = 0;
      }
    }
    const beamer = playing ? frame.kaijus.find((k) => k.alive && k.action === 'special' && k.phase === 'special') : undefined;
    this.beamOff = (beamer !== undefined) === (this.beam !== null) ? 0 : this.beamOff + dt;
    if (this.beamOff > LOOP_GRACE) {
      if (beamer) {
        this.startBeam(beamer, beamer.x, beamer.z);
      } else {
        this.beam?.stop();
        this.beam = null;
        this.beamOff = 0;
      }
    }
    if (this.beam && k0) this.beam.setPosition(k0.x, kaijuStageDef(k0.kind, k0.stage).mouthHeight, k0.z);

    // The local squad charging a volley: one tone that climbs with the charge, then a ping.
    const tone = playing && this.session ? chargeTone(frame.units, this.session.role.squadId) : null;
    if (!tone) {
      this.charge?.stop(0.15);
      this.charge = null;
      this.chargedCount = 0;
    } else {
      if (!this.charge && a.unlocked) this.charge = a.loop('laser_charge_loop', { gain: tone.gain, rate: tone.rate });
      this.charge?.setRate(tone.rate);
      this.charge?.setGain(tone.gain);
      if (tone.full > this.chargedCount && this.time - this.lastReady > READY_GAP) {
        this.lastReady = this.time;
        a.play('volley_ready', { gain: 0.9 });
      }
      this.chargedCount = tone.full;
    }

    // The end screen: the hearing music once the win cue has rung out, then the chair over it.
    const result = this.result;
    if (result) {
      this.sinceEnd += dt;
      if (this.sinceEnd > HEARING_MUSIC_AT && a.music !== 'hearing') a.playMusic(['hearing']);
      if (this.sinceEnd > CHAIR_AT && !this.chairSaid) {
        this.chairSaid = true;
        // Someone who arrived after the match ended never got the cue: they hear the chair too.
        const line = this.takeHearing() ?? chooseVoiceLines(result.winner === 'kaiju' ? 'hearing.kaiju.win' : 'hearing.humans.win', this.side(), 0)[0];
        if (line) a.say(line, { priority: 3, radio: false });
      }
    }
  }
}
