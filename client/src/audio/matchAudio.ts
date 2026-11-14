/**
 * Turns what happens in a match into sound: simulation events into effects at their place in
 * the world, the match phase and stage into music, voice cues into spoken lines for the side
 * the local player is on (humans hear the radio, the kaiju player hears the news), and the
 * state of the fight into how much of the combat stem plays.
 *
 * Phase 2's weapons and pick-ups (the monster's city weapons and power surge, the army's crates,
 * new weapons and artillery barrages) are sounded from what the effects library has: no sound
 * was made for them (docs/STATUS.md lists the ones that are missing).
 *
 * Two rules keep it honest when the page has missed something (a hidden tab, a reconnection):
 * what should be sounding NOW is read from the frame state on every update (the beam, the
 * heartbeat, the charging tone, the stage music), and an event that is delivered long after it
 * happened still counts for that state but its one-shot sounds and radio lines are skipped.
 */

import {
  archetypeSpecial,
  chooseVoiceLines,
  heldCityWeapon,
  kaijuStageDef,
  stageDef,
  TICK_RATE,
  unitTypeDef,
  VOICE_LINES,
  VOICE_SIDE_RULES,
  type CityData,
  type KaijuKindId,
  type MatchEndEvent,
  type PropKindId,
  type SimEvent,
  type SnapKaiju,
  type SnapUnit,
  type StageId,
  type VoiceCueId,
  type VoiceEvent,
  type VoiceLine,
} from '@mb/shared';
import type { FrameState, LocalRole } from '../net/matchSession';
import type { AudioEngine, LoopHandle, PlayOptions } from './audioEngine';

/** What the match audio reads from the match session. */
export interface MatchAudioSession {
  readonly role: LocalRole;
  readonly mirror: {
    readonly city: Pick<CityData, 'structures' | 'props'>;
    /** Visual stage per structure (the mirrored city's): a wrecked substation no longer hums. */
    readonly structureStage?: Uint8Array;
  };
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

/** `arty_incoming`: the whistle swells to its end, where the shell lands (seconds). */
export const WHISTLE_SECONDS = 1.81;
/** At most one sound per salvo, and the machine gun's clatter no closer together than this (seconds). */
const MG_GAP = 0.09;
/** A shot glancing off the monster's garage door clangs no more often than this (seconds). */
const CLANG_GAP = 0.1;

/**
 * Seconds until a shell falling from (y, vy) under `gravity` reaches the ground: when its
 * whistle, which swells to its end, has to start to end with the impact (`arty_incoming`).
 */
export function fallTime(y: number, vy: number, gravity: number): number {
  if (!(gravity > 0)) return vy < 0 ? y / -vy : Infinity;
  return (vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, y))) / gravity;
}

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

/** Seconds the fire of a gas station's fireball crackles on (the picture's fire lasts as long). */
const FIRE_SECONDS = 9;
/** A substation hums for a player whose body is this close to it (meters). */
const HUM_RANGE = 70;
/** At most one burst of glass from the monster's feet in this time (seconds). */
const GLASS_GAP = 0.15;

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
  // Phase 2: the crates, the pick-ups' weapons and the radio's barrages.
  'arty_incoming',
  'arty_distant',
  'takeover',
  'splash',
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
  /** A power surge's hum, while one lasts. */
  private surge: LoopHandle | null = null;
  private surgeOff = 0;
  /** Sounds due a moment from now (an artillery shell's whistle, timed to end as it lands). */
  private readonly due: Array<{ at: number; id: string; options: PlayOptions }> = [];
  /** The city weapons the kaiju has thrown and that are still in the air: they land with their own sound. */
  private readonly thrown = new Map<number, PropKindId>();
  /** The last salvo heard (owner and tick: a salvo is several shots on one tick) and the machine gun's last clatter. */
  private lastSalvo = '';
  private lastCrack = -1;
  private lastClang = -1;
  /** The committee chair's line for this match, held for the end screen. */
  private hearing: VoiceLine | null = null;
  private result: MatchEndEvent | null = null;
  /** Seconds since the match ended. */
  private sinceEnd = 0;
  private chairSaid = false;
  /** Phase 2's city: the player's tank engine, a substation's hum, fires burning on, the last glass. */
  private engine: LoopHandle | null = null;
  private hum: LoopHandle | null = null;
  private humAt: { x: number; z: number } | null = null;
  private substations: { id: number; x: number; z: number }[] | null = null;
  private readonly fires: { loop: LoopHandle; until: number }[] = [];
  private lastGlass = -1;

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
    this.stopCity();
    this.session = null;
    this.frame = null;
    this.ambience?.stop();
    this.ambience = null;
    this.ambienceId = '';
    this.stopLoops();
    this.charge?.stop(0.15);
    this.charge = null;
    this.chargedCount = 0;
    this.surge?.stop(0.2);
    this.surge = null;
    this.surgeOff = 0;
    this.due.length = 0;
    this.thrown.clear();
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
    // Phase 2's city: falls, the gas station's fireball, a tank going off where it stands.
    if (fresh) this.cityEvent(e);
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
        // The moves a molt card gives (phase 1), on the sounds there are: the charge's run sets
        // off with a thud and ends in a crash; the tail sweep whooshes like a swipe.
        else if (e.action === 'charge' && (e.phase === 'charge' || e.phase === 'stumble')) a.play(`kaiju_stomp_s${s.stage}`, { ...at, y: 0, refDistance: REACH[s.stage] * (e.phase === 'stumble' ? 1.5 : 1) });
        else if (e.action === 'tailSweep' && e.phase === 'windup') a.play(`kaiju_swipe_s${s.stage}`, at);
        // The fast-food sign swung: a heavier whoosh than the claws'.
        else if (e.action === 'club' && e.phase === 'windup') a.play(`kaiju_swipe_s${s.stage}`, { ...at, rate: 0.8, gain: 1.1 });
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
      case 'projectileSpawn':
        this.shot(e);
        this.heat = 1;
        break;
      case 'projectileHit': {
        const thrown = this.thrown.get(e.id);
        this.thrown.delete(e.id);
        if (e.target === 'none') break;
        const at = { x: e.x, y: e.y, z: e.z, refDistance: 14 + e.splash * 3 };
        if (thrown) {
          // A city weapon: the propane tank and the water tank are heard in their own events;
          // a javelin thuds into what stopped it, a garage door lands with a clang.
          if (e.target === 'water') a.play('splash', at);
          else if (thrown === 'antenna' || thrown === 'mast') a.play('structure_hit', { ...at, refDistance: 25, rate: 0.85 });
          else if (thrown === 'garagedoor') a.play('car_crush', { ...at, refDistance: 25, gain: 0.8, rate: 1.2 });
          break;
        }
        if (e.target === 'water') a.play('splash', at);
        else if (e.projectile === 'tracer') {
          // The machine gun's rounds: a quick crack, not an explosion each.
          if (this.time - this.lastCrack > MG_GAP) {
            this.lastCrack = this.time;
            a.play('structure_hit', { ...at, refDistance: 18, gain: 0.35, rate: 1.7 });
          }
        } else if (e.projectile === 'arty') a.play('explosion_l', { ...at, refDistance: 90, gain: 1.2 });
        else if (e.projectile === 'heavyShell') a.play('explosion_l', { ...at, refDistance: 45 });
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
        if (e.phase === 'marked') {
          // The radio crackles as the barrage is called (the voice says "strike inbound").
          if (this.side() === 'humans') {
            a.play('radio_open', { gain: 0.9 });
            this.later(0.3, 'radio_close', { gain: 0.8 });
          }
        } else if (e.phase === 'inbound') a.play('arty_distant', { gain: 0.8 });
        break;
      // --- phase 2: the monster's city weapons and its surge ---------------------------------
      case 'powerSurge': {
        const s = this.stageOf(e.kaiju);
        // The monster takes the substation's power: the whine climbs, arcs jump, it lets go.
        if (s) a.play('generator_overload', { x: s.k.x, y: 5, z: s.k.z, refDistance: REACH[s.stage] * 3, gain: 1 });
        this.heat = 1;
        break;
      }
      case 'propaneBlast':
        // A thrown tank, or one going off in the hand (one set off where it stands is the city's).
        if (e.how === 'thrown' || e.how === 'hand') a.play('explosion_l', { x: e.x, y: e.y, z: e.z, refDistance: 30 + e.radius * 3 });
        this.heat = 1;
        break;
      case 'kaijuFlinch': {
        const s = this.stageOf(e.kaiju);
        if (s) a.play('kaiju_hurt', { x: e.x, y: 4, z: e.z, refDistance: REACH[s.stage], rate: [1.35, 1.1, 0.9][s.stage - 1] });
        break;
      }
      case 'waterSplash':
        a.play('splash', { x: e.x, y: 1, z: e.z, refDistance: 28, gain: 1.2, rate: 0.75 });
        break;
      case 'javelinHit':
        a.play('structure_hit', { x: e.x, y: e.y, z: e.z, refDistance: 20, gain: 0.9, rate: 1.2 });
        break;
      case 'clubSwing':
        // The sign's head striking soldiers: a heavy whack.
        if (e.units > 0) a.play('car_crush', { x: e.x, y: 2, z: e.z, refDistance: 25, gain: 0.9, rate: 0.85 });
        break;
      case 'signBroken':
        a.play('prop_break', { x: e.x, y: 3, z: e.z, refDistance: 25, gain: 1 });
        a.play('glass', { x: e.x, y: 3, z: e.z, refDistance: 20, gain: 0.5 });
        break;
      case 'shieldHit':
        // Shots clanging off the garage door.
        if (this.time - this.lastClang > CLANG_GAP) {
          this.lastClang = this.time;
          a.play('car_crush', { x: e.x, y: e.y, z: e.z, refDistance: 14, gain: 0.35, rate: 1.7 });
        }
        break;
      case 'shieldBroken':
        a.play('car_crush', { x: e.x, y: 2, z: e.z, refDistance: 25, gain: 1, rate: 0.9 });
        a.play('glass', { x: e.x, y: 2, z: e.z, refDistance: 18, gain: 0.5 });
        break;
      case 'mastFall':
        // The squads' radios fill with static (their map shows nothing but static).
        if (this.side() === 'humans') {
          a.play('radio_close', { gain: 0.9, rate: 0.8 });
          this.later(0.25, 'radio_open', { gain: 0.8, rate: 0.7 });
          this.later(0.6, 'radio_close', { gain: 0.7, rate: 0.9 });
        }
        break;
      // --- phase 2: the army's supply crates ---------------------------------------------------
      case 'crate':
        if (e.phase === 'drop') a.play('jet_flyby', { x: e.x, y: e.height, z: e.z, refDistance: 90, gain: 0.45 });
        else if (e.phase === 'land') a.play('kaiju_step_s1', { x: e.x, y: 0, z: e.z, refDistance: 14, gain: 0.6, rate: 1.3 });
        else if (e.phase === 'take') {
          a.play('takeover', { x: e.x, y: 1, z: e.z, refDistance: 20, gain: 0.9 });
          // The player's own squad hears it whatever the distance (the HUD shows what it was).
          if (e.squad === this.session?.role.squadId) a.play('volley_ready', { gain: 0.8, rate: 1.2 });
        }
        break;
      case 'reinforce':
        if (e.squad === this.session?.role.squadId) a.play('jet_flyby', { gain: 0.5 });
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

  /** Plays a sound `seconds` from now. */
  private later(seconds: number, id: string, options: PlayOptions): void {
    this.due.push({ at: this.time + seconds, id, options });
  }

  /**
   * A shot was fired: each weapon its own sound, once per salvo (a salvo is several shots on one
   * tick). The machine gun clatters, the big cannon booms deep, the missile pod roars off, and an
   * artillery shell whistles in, its whistle timed to end where it lands.
   */
  private shot(e: Extract<SimEvent, { type: 'projectileSpawn' }>): void {
    const a = this.audio;
    if (e.projectile === 'thrown') {
      const weapon = heldCityWeapon(e.payload ?? null);
      if (weapon) {
        this.thrown.set(e.id, weapon);
        // A javelin hisses off through the air.
        if (weapon === 'antenna' || weapon === 'mast') a.play('shell_whoosh', { x: e.x, y: e.y, z: e.z, refDistance: 25, gain: 0.8, rate: 0.8 });
      }
      return;
    }
    if (e.projectile === 'arty') {
      const t = fallTime(e.y, e.vy, e.gravity);
      const at = { x: e.x + e.vx * t, y: 0, z: e.z + e.vz * t, refDistance: 80 };
      if (!Number.isFinite(t) || t <= WHISTLE_SECONDS) a.play('arty_incoming', at);
      else this.later(t - WHISTLE_SECONDS, 'arty_incoming', at);
      return;
    }
    const salvo = `${e.owner}${e.ownerId}:${e.tick}`;
    if (salvo === this.lastSalvo) return;
    this.lastSalvo = salvo;
    const at = { x: e.x, y: e.y, z: e.z, refDistance: e.projectile === 'rocket' ? 12 : 30 };
    if (e.projectile === 'rocket') a.play('rocket_launch', at);
    else if (e.projectile === 'shell') a.play('tank_fire', at);
    else if (e.projectile === 'tracer') {
      a.play('tank_fire', { ...at, refDistance: 18, gain: 0.32, rate: 2.4 });
    } else if (e.projectile === 'heavyShell') {
      a.play('tank_fire', { ...at, refDistance: 45, gain: 1, rate: 0.7 });
      a.play('explosion_s', { ...at, refDistance: 30, gain: 0.5, rate: 0.7 });
    } else if (e.projectile === 'missile') {
      a.play('rocket_launch', { ...at, refDistance: 25, gain: 1, rate: 0.85 });
      this.later(0.12, 'rocket_launch', { ...at, refDistance: 25, gain: 0.8, rate: 1.05 });
    }
  }

  /**
   * The city's sounds for an event (phase 2): a building falling over (it gives way, then the
   * crash and a deep thud along its length), the gas station's fireball (the blast, then the fire
   * crackling for as long as it burns), a propane tank set off where it stands or crushed (one
   * thrown or in the hand is the weapons' sound), a fallen mast's top coming down.
   */
  private cityEvent(e: SimEvent): void {
    const a = this.audio;
    switch (e.type) {
      case 'structureFall': {
        const s = this.session?.mirror.city.structures[e.id];
        const h = s ? s.height : 40;
        if (e.phase === 'falling') {
          a.play('crumble_m', { x: e.x, y: 2, z: e.z, refDistance: 20 + h * 0.5, gain: 0.8 });
          break;
        }
        const mx = (e.x + e.topX) / 2;
        const mz = (e.z + e.topZ) / 2;
        a.play('crumble_l', { x: mx, y: 2, z: mz, refDistance: 30 + h, gain: 1 });
        // A tall one hits the ground like the titan's foot.
        if (h > 40) a.play('kaiju_stomp_s3', { x: mx, y: 0, z: mz, refDistance: 30 + h, gain: 0.7, rate: 0.85 });
        break;
      }
      case 'fireball': {
        a.play('explosion_l', { x: e.x, y: 4, z: e.z, refDistance: 60, gain: 1.2, rate: 0.8 });
        a.play('explosion_m', { x: e.x, y: 4, z: e.z, refDistance: 40, gain: 0.8 });
        if (a.unlocked) this.fires.push({ loop: a.loop('fire_loop', { x: e.x, y: 2, z: e.z, refDistance: 25, gain: 0.9 }), until: this.time + FIRE_SECONDS });
        break;
      }
      case 'propaneBlast':
        // Set off where it stood by a shot, or crushed underfoot (the small bang).
        if (e.how === 'ground') a.play('explosion_l', { x: e.x, y: e.y, z: e.z, refDistance: 30 + e.radius * 3 });
        else if (e.how === 'crushed') a.play('explosion_s', { x: e.x, y: e.y, z: e.z, refDistance: 20 + e.radius * 3 });
        break;
      case 'looseProp':
        // The mast's top section lands: a clang of steel.
        if (e.state === 'down' && e.cause === 'mast') a.play('structure_hit', { x: e.x, y: 1, z: e.z, refDistance: 30, gain: 1, rate: 0.7 });
        break;
      default:
        break;
    }
  }

  /** Windows burst by the monster's feet (render/weight.ts): glass, not more than one burst at a time. */
  glass(x: number, y: number, z: number, panes: number): void {
    if (this.time - this.lastGlass < GLASS_GAP) return;
    this.lastGlass = this.time;
    this.audio.play('glass', { x, y, z, refDistance: 14 + panes, gain: Math.min(1, 0.45 + panes * 0.03) });
  }

  /**
   * Once per frame, the city's lasting sounds: the engine of the player's own tank (it climbs with
   * the speed), the hum of a power substation the player stands by, and the fires burning down.
   */
  private updateCity(frame: FrameState): void {
    const a = this.audio;
    const playing = frame.match.phase === 'playing';
    const u = playing ? frame.localUnit : null;
    const def = u && u.alive ? unitTypeDef(u.type) : null;
    if (u && def && def.body === 'vehicle' && a.unlocked) {
      const share = Math.min(1.2, Math.hypot(u.vx, u.vz) / Math.max(0.1, def.speed));
      this.engine ??= a.loop('tank_engine_loop', { x: u.x, y: 1.5, z: u.z, refDistance: 12, gain: 0.5 });
      this.engine.setPosition(u.x, 1.5, u.z);
      // From an idle to a roar at full speed: the art notes ask for 1.0 to about 1.4.
      this.engine.setRate(0.95 + 0.45 * share);
      this.engine.setGain(0.4 + 0.45 * share);
    } else if (this.engine) {
      this.engine.stop(0.4);
      this.engine = null;
    }
    // The nearest standing substation within earshot of the player's own body hums.
    const body = frame.localKaiju ?? frame.localUnit;
    const mirror = this.session?.mirror;
    let hum: { x: number; z: number } | null = null;
    if (playing && body && mirror?.structureStage) {
      this.substations ??= mirror.city.structures.filter((s) => archetypeSpecial(s.archetype) === 'substation');
      let best = HUM_RANGE;
      for (const s of this.substations) {
        if (mirror.structureStage[s.id] >= 3) continue;
        const d = Math.hypot(s.x - body.x, s.z - body.z);
        if (d < best) {
          best = d;
          hum = s;
        }
      }
    }
    if (hum && a.unlocked) {
      if (!this.hum || this.humAt !== hum) {
        this.hum?.stop(0.5);
        this.hum = a.loop('dish_beam_loop', { x: hum.x, y: 4, z: hum.z, refDistance: 10, gain: 0.35, rate: 0.6 });
        this.humAt = hum;
      }
    } else if (this.hum) {
      this.hum.stop(0.6);
      this.hum = null;
      this.humAt = null;
    }
    for (let i = 0; i < this.fires.length; i++) {
      if (this.fires[i].until > this.time && playing) continue;
      this.fires[i].loop.stop(1.5);
      this.fires.splice(i--, 1);
    }
  }

  private stopCity(): void {
    this.engine?.stop(0.2);
    this.engine = null;
    this.hum?.stop(0.2);
    this.hum = null;
    this.humAt = null;
    for (const f of this.fires) f.loop.stop(0.2);
    this.fires.length = 0;
    this.substations = null;
  }

  /** A kaiju's foot came down. */
  step(k: SnapKaiju): void {
    this.audio.play(`kaiju_step_s${k.stage}`, { x: k.x, y: 0, z: k.z, refDistance: REACH[k.stage] * 0.8, gain: 0.8 });
  }

  /** The kaiju went under the water or came up (sim/swim.ts): a big splash where it is. */
  splash(k: SnapKaiju): void {
    this.audio.play('splash', { x: k.x, y: 0, z: k.z, refDistance: REACH[k.stage] * 0.8, gain: 1 });
  }

  /** Once per frame: music for the phase and stage, ambience for the time of day, combat heat, loops. */
  update(frame: FrameState, dt: number): void {
    this.time += dt;
    this.frame = frame;
    this.updateCity(frame);
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

    // A power surge hums for as long as it lasts (the frame says when; the start was heard with its event).
    const surger = playing ? frame.kaijus.find((k) => k.alive && k.surge > 0) : undefined;
    this.surgeOff = (surger !== undefined) === (this.surge !== null) ? 0 : this.surgeOff + dt;
    if (this.surgeOff > LOOP_GRACE) {
      this.surgeOff = 0;
      if (surger && a.unlocked) {
        this.surge = a.loop('dish_beam_loop', { x: surger.x, y: 4, z: surger.z, refDistance: REACH[surger.stage] * 1.5, gain: 0.4, rate: 1.35 });
      } else {
        this.surge?.stop(0.6);
        this.surge = null;
      }
    }
    if (this.surge && surger) {
      this.surge.setPosition(surger.x, kaijuStageDef(surger.kind, surger.stage).height * 0.6, surger.z);
      // It crackles: the pitch wavers, and it fades with the last seconds of the surge.
      this.surge.setRate(1.25 + Math.sin(this.time * 23) * 0.12);
      this.surge.setGain(0.4 * Math.min(1, surger.surge / 1.5));
    }

    // Sounds that were due a moment after their event.
    for (let i = 0; i < this.due.length; i++) {
      const d = this.due[i];
      if (d.at > this.time) continue;
      a.play(d.id, d.options);
      this.due[i] = this.due[this.due.length - 1];
      this.due.pop();
      i--;
    }

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
