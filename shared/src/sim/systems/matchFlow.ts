/**
 * System 10 of 11: molt and match flow (DESIGN.md section 2).
 *
 * Phases: 'briefing' (timed) -> 'playing' -> 'intermission' (timed) -> 'playing' -> ... ->
 * 'ended'. The clock runs only while the phase is 'playing', the cocoon included.
 *
 * A match ends in one of three ways, checked every tick of play in this order: a kaiju's hp
 * reaches 0 at any stage, in the cocoon too (humans win, 'kill'); the bar passes the third mark
 * (kaiju wins, 'bar'); the clock runs out (humans win, 'clock').
 *
 * The molt. The city damage system offers it (`kaiju.moltAvailable`) and the kaiju action system
 * starts the cocoon when the player holds Molt; both leave the rest to this system:
 * 1. The cocoon is over when a kaiju has `phase === 'cocoon'` and `phaseTime >= phaseDuration`.
 * 2. Blast wave, around the NEW body: units within `blastKillRadius` new body radii are
 *    destroyed, units within `blastShoveRadius` are shaken and thrown clear. No building is
 *    touched (no free bar). Everything in flight is gone and running call-ins are called off.
 * 3. The kaiju stands up at its new size, whole again (hp, nerve), where the cocoon was.
 * 4. Intermission (`config.tuning.intermission` seconds, longer with drafts): nobody acts; units
 *    the blast threw are still sliding. `match.stage` and `match.bounds` are still the old ones.
 * 5. `beginStage`: survivors are marked as veterans, the bounds widen, every squad returns
 *    fresh at the new level on the new perimeter (eliminated players are back), and play
 *    resumes. City damage, rage, upgrades and the clock carry over.
 */

import { kaijuKindDef, kaijuStageDef } from '../../defs/kaiju/index';
import type { EndReason, StageId, Winner } from '../../defs/ids';
import { callInDef } from '../../defs/callins';
import { COMBAT_RULES, DT, MATCH_RULES } from '../../defs/rules';
import { LAST_STAGE } from '../../defs/stages';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { clamp } from '../../math/scalar';
import { shoveUnit } from '../kaijuEffects';
import { createMoveResult, stepMovement, unitMoveParams, type MoveInput, type MoveParams } from '../movement';
import { deploySquads, setKaijuStage } from '../spawn';
import { markVeterans, nearestKaiju, scatterMult } from '../squads';
import type { Kaiju, World } from '../types';
import { emit } from '../worldOps';
import { applyHit } from './damage';

/** How far past the edge of the shove radius the blast wave throws a unit. */
const BLAST_SHOVE_MARGIN = 6;
/** A unit slower than this has stopped sliding. */
const COAST_MIN_SPEED = 0.05;

const coastInput: MoveInput = { moveX: 0, moveZ: 0, aimYaw: 0 };
const coastParams = {} as MoveParams;
const coastResult = createMoveResult();

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
 * Gives a kaiju the body of a stage: its size, full hp and nerve, and a clean action state.
 * Position, rage, what it has drafted and what it has wrecked are untouched. The bigger body is
 * kept inside the current bounds.
 */
function growKaiju(world: World, k: Kaiju, stage: StageId): void {
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
  k.recentHits.length = 0;
  const b = world.match.bounds;
  const inset = Math.min(k.radius, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2);
  k.x = clamp(k.x, b.minX + inset, b.maxX - inset);
  k.z = clamp(k.z, b.minZ + inset, b.maxZ - inset);
}

/**
 * Starts a stage: the kaiju takes its new size with full hp and nerve, the bounds widen, every
 * squad returns fresh at the stage's level on the new perimeter, and play resumes. Veterans are
 * whoever `squad.veteranSlots` says (the molt marks the survivors before it calls this).
 */
export function beginStage(world: World, stage: StageId): void {
  const m = world.match;
  m.stage = stage;
  m.bounds = m.stageBounds[stage - 1];
  for (const k of world.kaijus) {
    if (k.alive) growKaiju(world, k, stage);
  }
  world.projectiles.length = 0;
  world.callIns.length = 0;
  deploySquads(world);
  m.phase = 'playing';
  m.phaseTime = 0;
  emit(world, { type: 'stageChange', stage, bounds: m.bounds });
  emit(world, { type: 'matchPhase', phase: 'playing', stage, duration: 0 });
}

// ---------------------------------------------------------------------------------------------
// The molt
// ---------------------------------------------------------------------------------------------

/** The blast wave of a kaiju leaving its cocoon as a body of `radius`. Units only; no building is touched. */
function blastWave(world: World, k: Kaiju, radius: number): void {
  const killRadius = MATCH_RULES.blastKillRadius * radius;
  const shoveRadius = MATCH_RULES.blastShoveRadius * radius;
  emit(world, { type: 'moltBlast', kaiju: k.id, x: k.x, z: k.z, killRadius, shoveRadius });
  for (const u of world.units) {
    if (!u.alive) continue;
    const dx = u.x - k.x;
    const dz = u.z - k.z;
    const d = Math.hypot(dx, dz);
    // Measured to the near edge of the unit: a troop half inside the radius is inside it.
    const edge = Math.max(0, d - u.radius);
    if (edge > shoveRadius) continue;
    const ox = d > 1e-6 ? dx / d : Math.sin(u.id * 2.4);
    const oz = d > 1e-6 ? dz / d : Math.cos(u.id * 2.4);
    const inner = edge <= killRadius;
    applyHit(world, { entity: 'unit', id: u.id }, {
      damage: inner ? Infinity : 0,
      nerve: inner ? 0 : COMBAT_RULES.unitNerveCapacity,
      fromDir: { x: -ox, z: -oz },
      sourceId: k.id,
      player: k.player,
      kind: 'blast',
      atWill: false,
      resetsCharge: true,
    });
    // Whoever lives is let go of its hold and thrown clear of the radius (walls stop it).
    if (u.alive) {
      u.rooted = false;
      shoveUnit(u, ox, oz, shoveRadius - edge + BLAST_SHOVE_MARGIN);
    }
  }
}

/** The blast leaves nothing in the air and calls off every fire mission. */
function clearTheAir(world: World): void {
  for (const p of world.projectiles) {
    emit(world, { type: 'projectileHit', id: p.id, projectile: p.type, x: p.x, y: p.y, z: p.z, target: 'none', targetId: -1, splash: 0 });
  }
  world.projectiles.length = 0;
  for (const c of world.callIns) {
    emit(world, {
      type: 'callin',
      id: c.id,
      callIn: c.callIn,
      squad: c.squad,
      player: c.player,
      x: c.x,
      z: c.z,
      phase: 'done',
      delay: 0,
      radius: callInDef(c.callIn).scatterRadius * scatterMult(world.match.stage, nearestKaiju(world, c.x, c.z)),
    });
  }
  world.callIns.length = 0;
}

/** Seconds of intermission for this match: the Tier 2 draft needs longer. */
function intermissionLength(world: World): number {
  const base = world.config.tuning.intermission;
  if (!world.config.drafts) return base;
  return (base * MATCH_RULES.intermissionWithDraft) / MATCH_RULES.intermission;
}

/**
 * Ends the cocoon of every kaiju whose time is up: blast wave, the new body, and the
 * intermission that leads to the next stage. Returns true when a molt happened.
 */
function finishCocoons(world: World): boolean {
  const m = world.match;
  if (m.stage >= LAST_STAGE) return false;
  const next = (m.stage + 1) as StageId;
  let molted = false;
  for (const k of world.kaijus) {
    if (!k.alive || k.phase !== 'cocoon' || k.phaseTime < k.phaseDuration - 1e-6) continue;
    molted = true;
    blastWave(world, k, kaijuStageDef(k.kind, next).bodyRadius);
    growKaiju(world, k, next);
    // The cocoon is the 'molt' verb; this closes it the way every other action ends.
    emit(world, { type: 'kaijuAction', kaiju: k.id, action: 'molt', phase: 'idle', duration: 0, x: k.x, z: k.z, yaw: k.yaw });
  }
  if (!molted) return false;

  clearTheAir(world);
  for (const squad of world.squads) squad.volleyReady = false;
  m.phase = 'intermission';
  m.phaseTime = intermissionLength(world);
  emit(world, { type: 'matchPhase', phase: 'intermission', stage: m.stage, duration: m.phaseTime, nextStage: next });
  return true;
}

/** During the intermission nobody drives, but whatever the blast threw keeps sliding until it stops. */
function coastUnits(world: World): void {
  for (const u of world.units) {
    if (!u.alive) continue;
    if (u.vx * u.vx + u.vz * u.vz < COAST_MIN_SPEED * COAST_MIN_SPEED) {
      u.vx = 0;
      u.vz = 0;
      continue;
    }
    coastInput.aimYaw = u.yaw;
    // The parameters of a unit that is held in place: no drive, only braking.
    unitMoveParams(unitTypeDef(u.type), { alive: true, rooted: true }, world.match.bounds, world.squads[u.squad].mods, coastParams);
    stepMovement(u, coastInput, DT, world.cityQuery, coastParams, coastResult);
    u.inWater = coastResult.inWater;
  }
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

  if (m.phase === 'intermission') {
    coastUnits(world);
    m.phaseTime -= DT;
    if (m.phaseTime <= 1e-9) {
      // Who lived through the stage (and the blast) comes back as a veteran.
      markVeterans(world);
      beginStage(world, Math.min(LAST_STAGE, m.stage + 1) as StageId);
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

  finishCocoons(world);
}
