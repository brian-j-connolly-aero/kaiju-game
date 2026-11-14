/**
 * System 1 of 11: input intake.
 *
 * Takes one input per player for this tick (bots supply their own), and turns raw button state
 * into what the action systems need: press and release edges and how long each button has been
 * down. It copies a squad player's stick, aim and trigger onto the unit they drive (the volley
 * button is read from the input state by the orders and weapon systems).
 *
 * The meaning of every button is specified in net/input.ts.
 */

import { Btn, BUTTON_COUNT, neutralInput, type PlayerInput } from '../../net/input';
import type { InputsByPlayer, InputState, World } from '../types';
import { drivenUnit, NEVER_PRESSED_TICKS } from '../worldOps';

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
  // A molt card is a one-shot, like a wheel pick: a repeated input does not pick again.
  state.card = input?.card ?? 0;
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

    if (p.role === 'human' && p.squadId >= 0) {
      const unit = drivenUnit(world, world.squads[p.squadId]);
      // roar stun: the unit does not answer its player's controls (the camera still looks round).
      if (unit && unit.alive && unit.stun > 0) {
        unit.control.moveX = 0;
        unit.control.moveZ = 0;
        unit.control.fire = false;
      } else if (unit && unit.alive) {
        unit.control.moveX = p.input.moveX;
        unit.control.moveZ = p.input.moveZ;
        unit.control.aimYaw = p.input.aimYaw;
        unit.control.aimPitch = p.input.aimPitch;
        unit.control.fire = (p.input.buttons & Btn.fire) !== 0;
      }
    }
  }
}
