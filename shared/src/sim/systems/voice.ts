/**
 * System 11 of 11: voice cues.
 *
 * Turns what happened this tick into `voice` events (cue ids from DESIGN.md section 8). It runs
 * last and reads the tick's other events; two cues come from watching a number instead
 * (`kaiju.lowhp`, `bar.near`), three from the clock, and other systems call `say` themselves
 * for `kaiju.spotted` / `kaiju.lost` (sim/spotting.ts) and `volley.ready` (the orders system).
 *
 * Every cue goes through `say`, which keeps the radio lively but never spammy:
 * - each cue has a minimum gap before it may be heard again (VOICE_CUE_RULES);
 * - routine chatter (priority 0) spends a token from a small budget that refills slowly
 *   (VOICE_RULES): a burst when things start happening, then a steady trickle. Important cues
 *   (priority 1) always go out and take a token with them, so chatter gives way to them.
 *   Cues the match turns on (priority 2) always go out and cost nothing.
 *
 * `say` also chooses the concrete lines, one list per listening side, from whatever
 * `voiceLines.json` holds today (`chooseVoiceLines`): deterministic from the world's generator,
 * the squad's own voice when the cue is about a squad, and not the line that cue played last.
 */

import { VOICE_CUE_RULES, VOICE_RULES, chooseVoiceLines, type VoiceCueId } from '../../defs/voice';
import { DT } from '../../defs/rules';
import { rngU32 } from '../../math/rng';
import { NO_PLAYER } from '../config';
import type { SimEvent } from '../events';
import type { World } from '../types';
import { emit } from '../worldOps';

const SIDES = ['humans', 'kaiju'] as const;
const callsigns: string[] = [];

/**
 * Emits a voice cue unless radio discipline says no: the same cue was heard too recently, or it
 * is routine chatter and the chatter budget is spent. Returns whether it was emitted.
 */
export function say(world: World, cue: VoiceCueId, squad = -1, player: number = NO_PLAYER): boolean {
  const v = world.voice;
  if ((v.cooldowns[cue] ?? 0) > 0) return false;
  const rule = VOICE_CUE_RULES[cue];
  if (rule.priority === 0 && v.tokens < 1) return false;
  if (rule.priority < 2) v.tokens = Math.max(0, v.tokens - 1);
  if (rule.gap > 0) v.cooldowns[cue] = rule.gap;

  const variant = rngU32(world.rng) & 0xffff;
  callsigns.length = 0;
  for (const s of world.squads) callsigns.push(s.callsign);
  const callsign = world.squads[squad]?.callsign;
  const lines = { humans: [] as string[], kaiju: [] as string[] };
  for (const side of SIDES) {
    const key = `${cue}|${side}`;
    const chosen = chooseVoiceLines(cue, side, variant, { callsign, callsigns, avoid: v.lastLine[key] });
    for (const line of chosen) lines[side].push(line.id);
    if (chosen.length === 1) v.lastLine[key] = chosen[0].id;
  }
  emit(world, { type: 'voice', cue, variant, squad, player, lines });
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
      say(world, 'crossfire', world.units[e.unitA]?.squad ?? -1);
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

/** The two cues that watch a number: the kaiju's health, and the bar closing on its next mark. */
function watchNumbers(world: World): void {
  const v = world.voice;
  const m = world.match;

  // Once per stage, the first time a kaiju is badly hurt.
  if (v.lowHpStage !== m.stage) {
    for (const k of world.kaijus) {
      if (!k.alive || k.hp <= 0 || k.hp >= k.maxHp * VOICE_RULES.lowHpFraction) continue;
      v.lowHpStage = m.stage;
      say(world, 'kaiju.lowhp', -1, k.player);
      break;
    }
  }

  // Once on the way to each mark, when the bar is most of the way there.
  if (m.marksReached < 3 && v.barNearCalled <= m.marksReached) {
    const from = m.marksReached > 0 ? m.marks[m.marksReached - 1] : 0;
    const to = m.marks[m.marksReached];
    if (to > from && m.barPoints >= from + (to - from) * VOICE_RULES.barNearFraction) {
      v.barNearCalled = m.marksReached + 1;
      say(world, 'bar.near');
    }
  }
}

export function voiceSystem(world: World): void {
  const v = world.voice;
  for (const cue of Object.keys(v.cooldowns) as VoiceCueId[]) {
    const left = (v.cooldowns[cue] ?? 0) - DT;
    if (left > 0) v.cooldowns[cue] = left;
    else delete v.cooldowns[cue];
  }
  if (v.tokens < VOICE_RULES.chatterTokens) {
    v.tokens = Math.min(VOICE_RULES.chatterTokens, v.tokens + DT / VOICE_RULES.chatterRefill);
  }

  // Only the events that existed before this system ran: the cues it adds are not re-read.
  const count = world.events.length;
  for (let i = 0; i < count; i++) cueForEvent(world, world.events[i]);

  const m = world.match;
  if (m.phase === 'playing') {
    watchNumbers(world);
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
