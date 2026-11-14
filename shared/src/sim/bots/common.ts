/** What both bots share: writing an input, pressing buttons for a while, the handicap. */

import { BOT_RULES } from '../../defs/bots';
import { DT } from '../../defs/rules';
import { rngChance } from '../../math/rng';
import { Btn, BtnIndex, BUTTON_COUNT, type ButtonName, type PlayerInput } from '../../net/input';
import type { PlayerState, World } from '../types';
import type { BotState } from './types';

/** How handicapped the bot of this slot is: 0 plays its best, 1 stands still. */
export function botHandicap(world: World, p: PlayerState): number {
  const tuning = world.config.bots;
  if (!tuning) return 0;
  const h = p.role === 'kaiju' ? tuning.kaijuHandicap : tuning.humanHandicap;
  return h > 0 ? Math.min(1, h) : 0;
}

/**
 * Starts this tick's input: hands off everything, still looking where it looked. The bot then
 * fills in what it wants. (This alone is what an idle bot sends.)
 */
export function beginBotInput(world: World, p: PlayerState): PlayerInput {
  const input = p.botInput;
  input.seq = world.tick;
  input.moveX = 0;
  input.moveZ = 0;
  input.buttons = 0;
  input.card = undefined;
  return input;
}

/**
 * The handicap: every BOT_RULES.hesitateWindow seconds the bot rolls whether it idles until the
 * next roll. A handicap of 1 always idles (and never touches the generator); 0 never does.
 */
export function hesitates(world: World, bs: BotState, handicap: number): boolean {
  if (handicap >= 1) return true;
  if (handicap <= 0) return false;
  bs.hesitateTimer -= DT;
  if (bs.hesitateTimer <= 0) {
    bs.hesitateTimer = BOT_RULES.hesitateWindow;
    bs.hesitating = rngChance(world.rng, handicap);
  }
  return bs.hesitating;
}

/** Lets go of every button the bot was holding (it has been staggered, or it is hesitating). */
export function releaseAll(bs: BotState): void {
  for (let b = 0; b < BUTTON_COUNT; b++) bs.hold[b] = 0;
}

/**
 * Presses a button for `ticks` ticks and then leaves it alone for at least `rest` ticks, the way
 * a finger does. Ignored while the button is still down or resting. Returns whether it pressed.
 */
export function press(bs: BotState, button: ButtonName, ticks: number, rest = 2): boolean {
  const b = BtnIndex[button];
  if (bs.hold[b] > 0 || bs.rest[b] > 0) return false;
  bs.hold[b] = Math.max(1, Math.round(ticks));
  bs.rest[b] = Math.max(1, Math.round(rest));
  return true;
}

/** True while the bot's finger is on the button (or it has only just let go). */
export function busyWith(bs: BotState, button: ButtonName): boolean {
  const b = BtnIndex[button];
  return bs.hold[b] > 0 || bs.rest[b] > 0;
}

/** Advances the button timers by one tick and returns the Btn bits that are down. */
export function heldButtons(bs: BotState): number {
  let bits = 0;
  for (let b = 0; b < BUTTON_COUNT; b++) {
    if (bs.hold[b] > 0) {
      bs.hold[b]--;
      bits |= 1 << b;
    } else if (bs.rest[b] > 0) {
      bs.rest[b]--;
    }
  }
  return bits;
}

export { Btn };
