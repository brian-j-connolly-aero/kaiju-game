/**
 * System 11 of 11: voice cues.
 *
 * Turns what happened this tick into `voice` events (cue ids from DESIGN.md section 8). It runs
 * last, reads the tick's other events, and throttles each cue so the radio does not repeat
 * itself. Clients pick the actual line (see defs/voice.ts).
 *
 * Real today: every cue that follows directly from an event or from the clock, plus
 * `kaiju.spotted` / `kaiju.lost`, which sim/spotting.ts says when `kaiju.known` changes, and
 * `volley.ready`, which the orders system says when every charging sub-unit of a squad is full.
 *
 * STUB(sim): cues that need state other systems do not track yet:
 * - `kaiju.lowhp`: when a kaiju first drops below about 25% hp in a stage;
 * - `bar.near`: when the bar passes about 85% of the way to the next mark.
 * Add them here with `say(world, cue, squad, player)`.
 */

import type { VoiceCueId } from '../../defs/voice';
import { DT } from '../../defs/rules';
import { rngU32 } from '../../math/rng';
import { NO_PLAYER } from '../config';
import type { SimEvent } from '../events';
import type { World } from '../types';
import { emit } from '../worldOps';

/** Minimum seconds between two emissions of the same cue. Cues not listed are never throttled. */
const CUE_GAP: Partial<Record<VoiceCueId, number>> = {
  'building.down': 9,
  'landmark.down': 2,
  'collateral.human': 12,
  'unit.lost': 6,
  'volley.fired': 8,
  'volley.ready': 10,
  crossfire: 10,
  'kaiju.roar': 12,
  'kaiju.brace': 15,
  'kaiju.special': 5,
  'callin.inbound': 5,
  'player.takeover': 4,
  'kaiju.spotted': 15,
  'kaiju.lost': 15,
};

/** Emits a voice cue unless the same cue was emitted too recently. Returns whether it was emitted. */
export function say(world: World, cue: VoiceCueId, squad = -1, player: number = NO_PLAYER): boolean {
  const left = world.voice.cooldowns[cue] ?? 0;
  if (left > 0) return false;
  const gap = CUE_GAP[cue];
  if (gap) world.voice.cooldowns[cue] = gap;
  emit(world, { type: 'voice', cue, variant: rngU32(world.rng) & 0xffff, squad, player });
  return true;
}

function cueForEvent(world: World, e: SimEvent): void {
  switch (e.type) {
    case 'matchPhase':
      if (e.phase === 'briefing') say(world, 'match.briefing');
      else if (e.phase === 'playing' && e.stage === 1) say(world, 'match.start');
      break;
    case 'structureStage': {
      if (e.stage !== 3) break;
      const s = world.city.structures[e.id];
      const by = world.players[e.by];
      if (s.landmark !== null) say(world, 'landmark.down', -1, e.by);
      else if (by && by.role === 'human') say(world, 'collateral.human', by.squadId, e.by);
      // Small things fall all the time; only buildings of some size are worth a radio call.
      else if (s.cls !== 'house' && s.cls !== 'shop') say(world, 'building.down', -1, e.by);
      break;
    }
    case 'kaijuAction':
      if (e.action === 'brace' && e.phase === 'brace') say(world, 'kaiju.brace');
      else if (e.action === 'special' && e.phase === 'windup') say(world, 'kaiju.special');
      break;
    case 'roar':
      say(world, 'kaiju.roar');
      break;
    case 'nerveBreak':
      say(world, 'nerve.break', world.players[e.by]?.squadId ?? -1, e.by);
      break;
    case 'kaijuStagger':
      if (!e.on) say(world, 'stagger.end');
      break;
    case 'crossfire':
      say(world, 'crossfire');
      break;
    case 'volley':
      say(world, 'volley.fired', e.squad, e.player);
      break;
    case 'unitDestroyed': {
      const squad = world.squads[e.squad];
      if (squad && squad.eliminated) say(world, 'squad.wiped', e.squad, squad.player);
      else say(world, 'unit.lost', e.squad, squad ? squad.player : NO_PLAYER);
      break;
    }
    case 'takeover':
      say(world, 'player.takeover', e.squad, e.player);
      break;
    case 'callin':
      if (e.phase === 'marked') say(world, 'callin.inbound', e.squad, e.player);
      break;
    case 'moltAvailable':
      say(world, 'molt.available');
      break;
    case 'cocoon':
      say(world, 'cocoon.start');
      break;
    case 'moltBlast':
      say(world, 'molt.blast');
      break;
    case 'stageChange':
      if (e.stage === 2) say(world, 'stage.2');
      else if (e.stage === 3) say(world, 'stage.3');
      break;
    case 'matchEnd':
      if (e.winner === 'kaiju') {
        say(world, 'end.kaiju');
        say(world, 'hearing.kaiju.win');
      } else {
        say(world, e.reason === 'kill' ? 'end.humans.kill' : 'end.humans.clock');
        say(world, 'hearing.humans.win');
      }
      break;
    default:
      break;
  }
}

export function voiceSystem(world: World): void {
  const v = world.voice;
  for (const cue of Object.keys(v.cooldowns) as VoiceCueId[]) {
    const left = (v.cooldowns[cue] ?? 0) - DT;
    if (left > 0) v.cooldowns[cue] = left;
    else delete v.cooldowns[cue];
  }

  // Only the events that existed before this system ran: the cues it adds are not re-read.
  const count = world.events.length;
  for (let i = 0; i < count; i++) cueForEvent(world, world.events[i]);

  const m = world.match;
  if (m.phase === 'playing') {
    if (!v.clockCalled.min3 && m.clock <= 180) {
      v.clockCalled.min3 = true;
      say(world, 'clock.3min');
    }
    if (!v.clockCalled.min1 && m.clock <= 60) {
      v.clockCalled.min1 = true;
      say(world, 'clock.1min');
    }
    if (!v.clockCalled.sec10 && m.clock <= 10) {
      v.clockCalled.sec10 = true;
      say(world, 'clock.10s');
    }
  }
}
