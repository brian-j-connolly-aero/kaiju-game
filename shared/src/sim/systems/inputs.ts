/**
 * System 1 of 11: input intake.
 *
 * Takes one input per player for this tick (bots supply their own), and turns raw button state
 * into what the action systems need: press and release edges and how long each button has been
 * down. It also collects this tick's squad commands (wheel picks, the call-in button, and
 * commands queued from `command` messages) into `player.commands`, and copies the player's
 * movement, aim and trigger onto the unit they drive.
 *
 * The meaning of every button is specified in net/input.ts.
 */

import { factionLevelDef } from '../../defs/factions';
import { unitTypeDef } from '../../defs/units';
import { Btn, BUTTON_COUNT, neutralInput, type PlayerInput } from '../../net/input';
import { SQUAD_RULES } from '../../defs/rules';
import { resolveMarkerPoint } from '../aim';
import type { SquadCommand } from '../commands';
import type { InputsByPlayer, InputState, PlayerState, Squad, World } from '../types';
import { drivenUnit, NEVER_PRESSED_TICKS } from '../worldOps';

const marker = { x: 0, z: 0 };

/** Applies one input sample to a player's input state and derives edges and hold timers. */
export function applyInput(state: InputState, input: PlayerInput | null | undefined): void {
  const prev = state.buttons;
  if (input) {
    state.seq = input.seq;
    state.moveX = input.moveX;
    state.moveZ = input.moveZ;
    state.aimYaw = input.aimYaw;
    state.aimPitch = input.aimPitch;
    state.buttons = input.buttons;
  }
  // With no new sample the last one repeats: sticks stay where they were, held buttons stay held.
  const now = state.buttons;
  state.pressed = now & ~prev;
  state.released = ~now & prev;
  for (let b = 0; b < BUTTON_COUNT; b++) {
    const bit = 1 << b;
    if (now & bit) {
      state.heldTicks[b]++;
      if (state.pressed & bit) state.sincePressTicks[b] = 0;
      else if (state.sincePressTicks[b] < NEVER_PRESSED_TICKS) state.sincePressTicks[b]++;
    } else {
      if (state.released & bit) state.lastHeldTicks[b] = state.heldTicks[b];
      state.heldTicks[b] = 0;
      if (state.sincePressTicks[b] < NEVER_PRESSED_TICKS) state.sincePressTicks[b]++;
    }
  }
}

/**
 * The ground point a squad leader's crosshair marks (`resolveMarkerPoint`): under the kaiju it
 * is on, else where the aim ray lands, else a kaiju on the map it is just beside. With the
 * crosshair on nothing at all the marker goes `skyReach` meters ahead, or nowhere (null) when
 * that is 0.
 */
function aimGround(world: World, squad: Squad, state: InputState, skyReach: number): { x: number; z: number } | null {
  const unit = drivenUnit(world, squad);
  if (!unit || !unit.alive) return null;
  const eye = unit.y + unitTypeDef(unit.type).eyeHeight;
  const found = resolveMarkerPoint(
    world.cityQuery,
    world.kaijus,
    unit.x,
    eye,
    unit.z,
    state.aimYaw,
    state.aimPitch,
    SQUAD_RULES.markerRange,
    skyReach,
    marker,
  );
  return found ? { x: marker.x, z: marker.z } : null;
}

function collectCommands(world: World, p: PlayerState, input: PlayerInput | null | undefined): void {
  p.commands.length = 0;
  if (p.role !== 'human' || p.squadId < 0) {
    p.queuedCommands.length = 0;
    return;
  }
  for (const c of p.queuedCommands) p.commands.push(c);
  p.queuedCommands.length = 0;

  const squad = world.squads[p.squadId];
  if (input?.wheel) {
    let command: SquadCommand | null = null;
    if (input.wheel === 'moveTo') {
      const at = input.marker ?? aimGround(world, squad, p.input, SQUAD_RULES.markerSkyReach);
      if (at) command = { type: 'moveTo', x: at.x, z: at.z };
    } else {
      command = { type: input.wheel };
    }
    if (command) p.commands.push(command);
  }
  if (p.input.pressed & Btn.callIn) {
    const callIns = factionLevelDef(squad.faction, world.match.stage).callIns;
    if (callIns.length > 0) {
      // The crosshair on the empty sky marks nothing: the battery is not spent on it.
      const at = input?.marker ?? aimGround(world, squad, p.input, 0);
      if (at) p.commands.push({ type: 'callIn', callIn: callIns[0], x: at.x, z: at.z });
    }
  }
}

export function inputSystem(world: World, inputs: InputsByPlayer | undefined): void {
  for (const p of world.players) {
    let input = p.bot ? p.botInput : inputs?.[p.id];
    if (!p.bot && p.handBack) {
      // A slot a bot has just handed back: until the person's first input arrives the controls
      // are let go, rather than repeating whatever the bot was pressing.
      if (!input) {
        input = neutralInput(p.input.seq);
        input.aimYaw = p.input.aimYaw;
        input.aimPitch = p.input.aimPitch;
      }
      p.handBack = false;
    }
    applyInput(p.input, input);
    collectCommands(world, p, input);

    if (p.role === 'human' && p.squadId >= 0) {
      const unit = drivenUnit(world, world.squads[p.squadId]);
      if (unit && unit.alive) {
        unit.control.moveX = p.input.moveX;
        unit.control.moveZ = p.input.moveZ;
        unit.control.aimYaw = p.input.aimYaw;
        unit.control.aimPitch = p.input.aimPitch;
        unit.control.fire = (p.input.buttons & Btn.fire) !== 0;
      }
    }
  }
}
