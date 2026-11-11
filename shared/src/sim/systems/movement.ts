/**
 * System 5 of 11: movement and collision.
 *
 * Moves every kaiju from its player's input and every unit from its control, through the shared
 * `stepMovement`, and turns what the bodies walked through into city damage:
 * - a kaiju destroys structures up to its trample height and every prop it steps on;
 * - a wading kaiju (the titan) deals contact damage to the taller structures it pushes through;
 * - vehicles crush props; infantry walks around them.
 *
 * Nothing moves outside the 'playing' phase.
 */

import { propsInCircle } from '../../city/spatialIndex';
import { kaijuKindDef, kaijuStageDef } from '../../defs/kaiju/index';
import { DT } from '../../defs/rules';
import { unitTypeDef } from '../../defs/units';
import { clampAngleAround } from '../../math/angle';
import { createMoveResult, kaijuMoveParams, stepMovement, unitMoveParams, type MoveParams } from '../movement';
import type { World } from '../types';

const params = {} as MoveParams;
const result = createMoveResult();
const propIds: number[] = [];

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
      k.aimYaw = clampAngleAround(input.aimYaw, k.yaw, kaijuKindDef(k.kind).headLeadMax);
      k.aimPitch = input.aimPitch;
    }

    for (const id of result.trampled) {
      world.structureHits.push({ id, damage: Infinity, by: k.player, cause: 'trample' });
    }
    if (result.waded.length > 0) {
      const dps = kaijuStageDef(k.kind, k.stage).wadeContactDps;
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
