/**
 * System 5 of 11: movement and collision.
 *
 * Moves every kaiju from its player's input and every unit from its control, through the shared
 * `stepMovement`, and turns what the bodies walked through into city damage:
 * - a kaiju destroys structures up to its trample height and every prop it steps on;
 * - a wading kaiju (the titan) deals contact damage to the taller structures it pushes through;
 * - vehicles crush props; infantry walks around them.
 * It also points the kaiju's head: at the player's aim, within the head lead of the body, and
 * only at the special's reduced turn rate while a special (the beam) is running, with the
 * beam's own shake, pull and kick on top (`beamShake`).
 *
 * Nothing moves outside the 'playing' phase.
 */

import { propsInCircle } from '../../city/spatialIndex';
import { kaijuKindDef, kaijuStageDef } from '../../defs/kaiju/index';
import { DT } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { modMult } from '../../defs/upgrades';
import { clampAngleAround, turnToward, wrapAngle } from '../../math/angle';
import { approach } from '../../math/scalar';
import { beamShake, type BeamShake } from '../beam';
import { createMoveResult, kaijuMoveParams, stepMovement, unitMoveParams, type MoveParams } from '../movement';
import type { World } from '../types';

const params = {} as MoveParams;
const result = createMoveResult();
const propIds: number[] = [];
const shake: BeamShake = { yaw: 0, pitch: 0 };

export function movementSystem(world: World): void {
  if (world.match.phase !== 'playing') return;
  const city = world.cityQuery;
  const bounds = world.match.bounds;

  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const input = world.players[k.player].input;
    kaijuMoveParams(k, bounds, k.mods, params);
    stepMovement(k, input, DT, city, params, result);
    k.wading = result.wading;
    k.inWater = result.inWater;

    // The head follows the player's aim but can only lead the body so far.
    const helpless = k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead';
    if (!helpless) {
      const def = kaijuKindDef(k.kind);
      const wantYaw = clampAngleAround(input.aimYaw, k.yaw, def.headLeadMax);
      const special = def.actions.special;
      if (k.action === 'special' && k.phase === special.activePhase) {
        // While the special runs (the beam) the head is as slow as the body, so the breath
        // sweeps instead of snapping to wherever the player looks; and the breath fights the
        // head: it shakes, pulls to one side and kicks up about where the head is steered.
        const act = k.act;
        if (!act.beamSteering) {
          act.beamSteering = true;
          act.beamYaw = k.aimYaw;
          act.beamPitch = k.aimPitch;
          act.beamSeed = world.tick;
        }
        const step = kaijuStageDef(k.kind, k.stage).turnRate * special.turnMult * modMult(k.mods, 'turnRate') * DT;
        act.beamYaw = clampAngleAround(turnToward(act.beamYaw, wantYaw, step), k.yaw, def.headLeadMax);
        act.beamPitch = approach(act.beamPitch, input.aimPitch, step);
        beamShake(special, k.phaseTime, special.timing.active, act.beamSeed, shake);
        k.aimYaw = clampAngleAround(wrapAngle(act.beamYaw + shake.yaw), k.yaw, def.headLeadMax);
        k.aimPitch = act.beamPitch + shake.pitch;
      } else {
        k.act.beamSteering = false;
        k.aimYaw = wantYaw;
        k.aimPitch = input.aimPitch;
      }
    } else {
      k.act.beamSteering = false;
    }

    for (const id of result.trampled) {
      world.structureHits.push({ id, damage: Infinity, by: k.player, cause: 'trample' });
    }
    if (result.waded.length > 0) {
      const dps = kaijuStageDef(k.kind, k.stage).wadeContactDps * modMult(k.mods, 'structureDamage');
      if (dps > 0) {
        for (const id of result.waded) {
          world.structureHits.push({ id, damage: dps * DT, by: k.player, cause: 'wade' });
        }
      }
    }
    propsInCircle(city, k.x, k.z, k.radius, propIds);
    for (const id of propIds) world.propHits.push({ id, by: k.player, cause: 'trample' });
  }

  for (const u of world.units) {
    if (!u.alive) continue;
    const def = unitTypeDef(u.type);
    const squad = world.squads[u.squad];
    unitMoveParams(def, u, bounds, squad.mods, params);
    // A sub-unit that has dropped behind its place in the formation closes up a little faster
    // than the column moves (the orders system says when). Never the driven unit.
    if (u.nav.hurry !== 1) params.topSpeed *= u.nav.hurry;
    stepMovement(u, u.control, DT, city, params, result);
    u.inWater = result.inWater;
    u.aimYaw = u.control.aimYaw;
    u.aimPitch = u.control.aimPitch;
    if (def.body === 'vehicle') {
      propsInCircle(city, u.x, u.z, u.radius, propIds);
      for (const id of propIds) world.propHits.push({ id, by: squad.player, cause: 'trample' });
    }
  }
}
