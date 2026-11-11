/**
 * System 10 of 11: molt and match flow.
 *
 * Real today: the briefing countdown into 'playing', the match clock, per-stage play time, and
 * the three ways a match ends (bar reaches the third mark: kaiju win; a kaiju's hp reaches 0 or
 * the clock runs out: humans win). `endMatch` and `beginStage` are the entry points the rest of
 * the flow should use.
 *
 * Already done elsewhere: the city damage system sets `kaiju.moltAvailable` and emits
 * `moltAvailable` while the bar is past the current stage's mark; the kaiju action system starts
 * the cocoon when the player holds Molt (phase 'cocoon', action 'molt', `phaseDuration` =
 * `config.tuning.cocoon`, the `cocoon` event) and keeps counting `phaseTime`; the damage system
 * gives a cocooned kaiju full damage. Nothing ends the cocoon yet: the kaiju stays in it.
 *
 * STUB(sim): Worker 3 (match flow) fills in the rest of the molt (DESIGN.md section 2, "The molt"):
 * - the cocoon is over when a kaiju has `phase === 'cocoon'` and
 *   `phaseTime >= phaseDuration`; the clock keeps running until then;
 * - blast wave: destroy units within blastKillRadius, shove and shake units within
 *   blastShoveRadius (multiples of the NEW body radius), emit `moltBlast`; no building damage;
 * - intermission: phase 'intermission' for `config.tuning.intermission` seconds (the clock is
 *   paused), then call `beginStage(world, nextStage)`, which already grows the kaiju, widens the
 *   bounds, redeploys fresh squads and emits `stageChange`;
 * - carry-overs: mark surviving sub-units in `squad.veteranSlots` before the redeploy; keep
 *   rage, city damage and upgrades; reset kaiju hp and nerve (beginStage does the reset).
 */

import { kaijuKindDef } from '../../defs/kaiju/index';
import type { EndReason, StageId, Winner } from '../../defs/ids';
import { DT } from '../../defs/rules';
import { modMult } from '../../defs/upgrades';
import { deploySquads, setKaijuStage } from '../spawn';
import type { World } from '../types';
import { emit } from '../worldOps';

/** Ends the match. Safe to call more than once; only the first call counts. */
export function endMatch(world: World, winner: Exclude<Winner, 'none'>, reason: Exclude<EndReason, 'none'>): void {
  const m = world.match;
  if (m.phase === 'ended') return;
  m.phase = 'ended';
  m.phaseTime = 0;
  m.winner = winner;
  m.endReason = reason;
  emit(world, { type: 'matchPhase', phase: 'ended', stage: m.stage, duration: 0 });
  emit(world, {
    type: 'matchEnd',
    winner,
    reason,
    duration: m.elapsed,
    tallies: world.players.map((p) => p.tally),
  });
}

/**
 * Starts a stage: the kaiju takes its new size with full hp and nerve, the bounds widen, every
 * squad returns fresh at the stage's level on the new perimeter, and play resumes.
 */
export function beginStage(world: World, stage: StageId): void {
  const m = world.match;
  m.stage = stage;
  m.bounds = m.stageBounds[stage - 1];
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const def = kaijuKindDef(k.kind);
    setKaijuStage(k, stage);
    k.maxHp = def.hp * modMult(k.mods, 'maxHp');
    k.hp = k.maxHp;
    k.nerve = 0;
    k.nerveImmune = 0;
    k.phase = 'idle';
    k.action = 'none';
    k.phaseTime = 0;
    k.phaseDuration = 0;
    k.actionTime = 0;
    k.moltAvailable = false;
    k.vx = 0;
    k.vz = 0;
  }
  world.projectiles.length = 0;
  world.callIns.length = 0;
  deploySquads(world);
  m.phase = 'playing';
  m.phaseTime = 0;
  emit(world, { type: 'stageChange', stage, bounds: m.bounds });
  emit(world, { type: 'matchPhase', phase: 'playing', stage, duration: 0 });
}

export function matchFlowSystem(world: World): void {
  const m = world.match;

  if (world.tick === 1 && m.phase === 'briefing') {
    emit(world, { type: 'matchPhase', phase: 'briefing', stage: m.stage, duration: m.phaseTime });
  }

  if (m.phase === 'briefing') {
    m.phaseTime -= DT;
    if (m.phaseTime <= 0) {
      m.phase = 'playing';
      m.phaseTime = 0;
      emit(world, { type: 'matchPhase', phase: 'playing', stage: m.stage, duration: 0 });
    }
    return;
  }

  if (m.phase !== 'playing') return;

  m.clock = Math.max(0, m.clock - DT);
  m.elapsed += DT;
  m.stageTime[m.stage - 1] += DT;

  // A kill at any stage ends the match, including in the cocoon.
  if (world.kaijus.length > 0 && world.kaijus.every((k) => !k.alive || k.hp <= 0)) {
    endMatch(world, 'humans', 'kill');
    return;
  }
  if (m.marksReached >= 3) {
    endMatch(world, 'kaiju', 'bar');
    return;
  }
  if (m.clock <= 0) {
    endMatch(world, 'humans', 'clock');
    return;
  }

  // STUB(sim): the end of the cocoon: blast wave, intermission and stage change; see the file header.
}
