/**
 * System 5 of 12: movement and collision.
 *
 * Moves every kaiju from its player's input and every unit from its control, through the shared
 * `stepMovement`, and turns what the bodies walked through into city damage:
 * - a kaiju destroys structures up to its trample height and every prop it steps on;
 * - a wading kaiju (the titan) deals contact damage to the taller structures it pushes through;
 * - vehicles crush props; infantry walks around them;
 * - a swimming kaiju (sim/swim.ts) wrecks nothing at all;
 * - units cross mounds of rubble and fallen buildings at half speed; the kaiju walks over them
 *   (`moundSpeedMult`, sim/movement.ts); a unit still coming down by parachute stays put;
 * - a charging kaiju runs straight ahead (`kaijuMoveInput`), smashes what is low enough for
 *   the charge (cause 'charge'), and is stopped dead by anything else: its stumble starts on
 *   the next tick (`act.chargeBlocked`, read by the kaiju action system).
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
import {
  createMoveResult,
  kaijuMoveInput,
  kaijuMoveParams,
  stepMovement,
  unitMoveParams,
  type MoveInput,
  type MoveParams,
  type UnitMoveState,
} from '../movement';
import { sparedByKaiju } from '../cityWeapons';
import { kaijuSwimming } from '../swim';
import type { World } from '../types';

const params = {} as MoveParams;
const result = createMoveResult();
const propIds: number[] = [];
const shake: BeamShake = { yaw: 0, pitch: 0 };
const driveInput: MoveInput = { moveX: 0, moveZ: 0, aimYaw: 0 };
const unitState: UnitMoveState = { alive: false, rooted: false, stun: 0, driven: false, y: 0 };

export function movementSystem(world: World): void {
  if (world.match.phase !== 'playing') return;
  const city = world.cityQuery;
  const bounds = world.match.bounds;

  for (const k of world.kaijus) {
    if (!k.alive) continue;
    const input = world.players[k.player].input;
    kaijuMoveParams(k, bounds, k.mods, params);
    stepMovement(k, kaijuMoveInput(k, input, driveInput), DT, city, params, result);
    k.wading = result.wading;
    k.inWater = result.inWater;
    const charging = k.action === 'charge' && k.phase === 'charge';
    if (charging && result.blocked) {
      // Too tall to smash (or the edge of the bounds): it stops dead and stumbles.
      k.vx = 0;
      k.vz = 0;
      k.act.chargeBlocked = true;
    }

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

    // A swimming kaiju wrecks nothing: it passes under a bridge deck (sim/swim.ts).
    if (kaijuSwimming(k)) continue;
    for (const id of result.trampled) {
      world.structureHits.push({ id, damage: Infinity, by: k.player, cause: charging ? 'charge' : 'trample' });
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
    for (const id of propIds) {
      // The hatchling's feet spare the city weapons it can pick up (sim/cityWeapons.ts); a charge does not.
      if (!charging && sparedByKaiju(world, k, id)) continue;
      world.propHits.push({ id, by: k.player, cause: charging ? 'charge' : 'trample' });
    }
  }

  for (const u of world.units) {
    if (!u.alive) continue;
    const def = unitTypeDef(u.type);
    const squad = world.squads[u.squad];
    unitState.alive = u.alive;
    unitState.rooted = u.rooted;
    unitState.stun = u.stun;
    // The driven unit of a vehicle level drives like a tank (sim/movement.ts).
    unitState.driven = squad.driven === u.id;
    // Coming down by parachute (reinforcements, sim/systems/pickups.ts) it cannot move yet.
    unitState.y = u.y;
    unitMoveParams(def, unitState, bounds, squad.mods, params);
    // A squad-mate that has dropped behind its place in the swarm closes up a little faster
    // than the leader goes (the orders system says when). Never the driven unit.
    if (u.nav.hurry !== 1) params.topSpeed *= u.nav.hurry;
    stepMovement(u, u.control, DT, city, params, result);
    u.inWater = result.inWater;
    // A driven tank's turret has swung toward the aim at its own rate in stepMovement; every
    // other unit's weapon points where its control says (squad-mates turn theirs in the orders system).
    if (params.steer !== 'tank') u.aimYaw = u.control.aimYaw;
    u.aimPitch = u.control.aimPitch;
    if (def.body === 'vehicle') {
      propsInCircle(city, u.x, u.z, u.radius, propIds);
      for (const id of propIds) world.propHits.push({ id, by: squad.player, cause: 'trample' });
    }
  }
}
