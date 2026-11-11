/**
 * Turns what happens in a match into sound: simulation events into effects at their place in
 * the world, the match phase and stage into music, voice cues into spoken lines for the side
 * the local player is on (humans hear the radio, the kaiju player hears the news), and the
 * state of the fight into how much of the combat stem plays.
 */

import {
  kaijuStageDef,
  pickVoiceLine,
  SQUAD_CALLSIGNS,
  stageDef,
  unitTypeDef,
  VOICE_LINES,
  VOICE_SEQUENCE_CUES,
  voiceLinesFor,
  type SimEvent,
  type SnapKaiju,
  type StageId,
  type VoiceEvent,
  type VoiceLine,
} from '@mb/shared';
import type { FrameState, MatchSession } from '../net/matchSession';
import type { AudioEngine, LoopHandle } from './audioEngine';

/** How far big sounds carry before they fall off, by stage: a titan is heard across the city. */
const REACH: Record<StageId, number> = { 1: 14, 2: 40, 3: 110 };

const AMBIENCE = { afternoon: 'amb_day_loop', sunset: 'amb_sunset_loop', night: 'amb_night_loop' } as const;

let linesById: Map<string, VoiceLine> | null = null;

function lineById(id: string): VoiceLine | undefined {
  if (!linesById) linesById = new Map(VOICE_LINES.map((l) => [l.id, l]));
  return linesById.get(id);
}

/** Effects worth having decoded before the first shot is fired. */
export const PRELOAD_SFX = [
  'kaiju_step_s1',
  'kaiju_swipe_s1',
  'kaiju_stomp_s1',
  'kaiju_roar_lizard_s1',
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
  'radio_open',
  'radio_close',
  'ui_click',
];

export class MatchAudio {
  private readonly audio: AudioEngine;
  private session: MatchSession | null = null;
  private frame: FrameState | null = null;
  private ambience: LoopHandle | null = null;
  private ambienceId = '';
  private beam: LoopHandle | null = null;
  private heartbeat: LoopHandle | null = null;
  private musicStage: StageId | 0 = 0;
  private heat = 0;
  private lastHurt = 0;
  private lastCrush = 0;
  private time = 0;

  constructor(audio: AudioEngine) {
    this.audio = audio;
  }

  begin(session: MatchSession): void {
    this.end();
    this.session = session;
    this.audio.preload(PRELOAD_SFX);
  }

  end(): void {
    this.session = null;
    this.frame = null;
    this.ambience?.stop();
    this.ambience = null;
    this.ambienceId = '';
    this.beam?.stop();
    this.beam = null;
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.musicStage = 0;
    this.heat = 0;
    this.audio.clearVoice();
  }

  private stageOf(kaijuId: number): { k: SnapKaiju; stage: StageId } | null {
    const k = this.frame?.kaijus[kaijuId];
    return k ? { k, stage: k.stage } : null;
  }

  /** Which side's lines the local player hears. Spectators listen to the radio. */
  private side(): 'humans' | 'kaiju' {
    return this.session?.role.kind === 'kaiju' ? 'kaiju' : 'humans';
  }

  private speak(e: VoiceEvent): void {
    const side = this.side();
    const radio = side === 'humans';
    const urgent = e.cue.startsWith('end.') || e.cue.startsWith('stage.') || e.cue.startsWith('hearing.') || e.cue === 'nerve.break' || e.cue === 'molt.available';
    // The simulation names the lines to play for each side. (A server built before it did
    // sends none: then the line is picked here by the same rule.)
    const chosen = (e as { lines?: Partial<Record<'humans' | 'kaiju', string[]>> }).lines?.[side];
    if (Array.isArray(chosen)) {
      const many = chosen.length > 1;
      for (const id of chosen) {
        const line = lineById(id);
        if (line) this.audio.say(line, { priority: many ? 3 : urgent ? 2 : 1, radio });
      }
      return;
    }
    if (VOICE_SEQUENCE_CUES.includes(e.cue)) {
      for (const line of voiceLinesFor(e.cue, side)) this.audio.say(line, { priority: 3, radio });
      return;
    }
    const callsign = e.squad >= 0 ? SQUAD_CALLSIGNS[e.squad % SQUAD_CALLSIGNS.length] : undefined;
    const line = pickVoiceLine(e.cue, side, e.variant, callsign);
    if (line) this.audio.say(line, { priority: urgent ? 2 : 1, radio });
  }

  /** A simulation event whose moment has come. */
  handleEvent(e: SimEvent): void {
    const a = this.audio;
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
        else if (e.action === 'special' && e.phase === 'special') {
          this.beam?.stop();
          this.beam = a.loop('kaiju_beam_loop', at);
        }
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
          a.play('kaiju_hurt', { x: s.k.x, y: 5, z: s.k.z, refDistance: REACH[s.stage], gain: 0.7 });
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
      case 'cocoon':
        this.heartbeat?.stop();
        this.heartbeat = a.loop('kaiju_heartbeat_loop', { x: e.x, y: 2, z: e.z, refDistance: reach * 1.2 });
        this.audio.playMusic(['cocoon'], { fade: 0.8 });
        break;
      case 'moltBlast':
        this.heartbeat?.stop(0.1);
        this.heartbeat = null;
        a.play('kaiju_molt_blast', { x: e.x, y: 5, z: e.z, refDistance: reach * 4 });
        break;
      case 'callin':
        if (e.phase === 'inbound') a.play('arty_distant', { gain: 0.8 });
        break;
      case 'matchPhase':
        if (e.phase === 'briefing') this.audio.playMusic(['briefing']);
        else if (e.phase === 'intermission') this.audio.playMusic(['intermission'], { loop: false, fade: 0.6 });
        else if (e.phase === 'playing') {
          this.musicStage = 0;
          a.play('ui_match_start', { gain: 0.7 });
        }
        break;
      case 'matchEnd':
        this.heartbeat?.stop();
        this.heartbeat = null;
        this.beam?.stop();
        this.beam = null;
        this.audio.playMusic([e.winner === 'kaiju' ? 'win_kaiju' : 'win_humans'], { loop: false, fade: 0.5 });
        if (e.winner === 'humans' && e.reason === 'kill') {
          const k = this.frame?.kaijus[0];
          if (k) a.play('kaiju_death', { x: k.x, y: 5, z: k.z, refDistance: reach * 3 });
        }
        break;
      case 'voice':
        this.speak(e);
        break;
      default:
        break;
    }
  }

  /** A kaiju's foot came down. */
  step(k: SnapKaiju): void {
    this.audio.play(`kaiju_step_s${k.stage}`, { x: k.x, y: 0, z: k.z, refDistance: REACH[k.stage] * 0.8, gain: 0.8 });
  }

  /** Once per frame: music for the phase and stage, ambience for the time of day, combat heat. */
  update(frame: FrameState, dt: number): void {
    this.time += dt;
    this.frame = frame;
    const match = frame.match;
    const cocooned = frame.kaijus.some((k) => k.phase === 'cocoon');
    if (match.phase === 'playing' && !cocooned && this.musicStage !== match.stage) {
      this.musicStage = match.stage;
      this.audio.playMusic([`stage${match.stage}_base`, `stage${match.stage}_combat`]);
    }
    const wanted = match.phase === 'ended' ? '' : AMBIENCE[stageDef(match.stage).timeOfDay];
    if (wanted !== this.ambienceId && this.audio.unlocked) {
      this.ambience?.stop(1.5);
      this.ambience = wanted ? this.audio.loop(wanted, { gain: 0.5 }) : null;
      this.ambienceId = wanted;
    }
    // The fight is "on" while shots fly or lasers are lit, and cools down over a few seconds.
    if (frame.units.some((u) => u.alive && u.laser)) this.heat = Math.max(this.heat, 0.7);
    this.heat = Math.max(0, this.heat - dt * 0.12);
    this.audio.setCombat(match.phase === 'playing' ? this.heat : 0);
    const k = frame.kaijus[0];
    if (this.beam && k) this.beam.setPosition(k.x, kaijuStageDef(k.kind, k.stage).mouthHeight, k.z);
  }
}
