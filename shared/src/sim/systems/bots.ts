/**
 * System 4 of 11: bots.
 *
 * Bots play through the same interface as people: for every player with `player.bot === true`
 * this system writes the input the bot wants for the NEXT tick into `player.botInput` (a
 * PlayerInput: the stick, the aim and the button bits). The input system picks it up next
 * tick, so a bot obeys every rule a person does
 * and is always one tick behind what it saw, like a person with very good reflexes.
 *
 * The behavior is in sim/bots/ (`kaijuBot`, `squadBot`; DESIGN.md section 5, "Bots"), its
 * numbers in defs/bots.ts, its memory in `player.botState`. A slot can be handed to a bot at
 * any moment (`setPlayerBot`): the bot starts with a blank mind and reads the world as it is.
 * `MatchConfig.bots` handicaps a side; at 1 a bot stands still with its hands off the buttons.
 */

import { kaijuBot } from '../bots/kaijuBot';
import { squadBot } from '../bots/squadBot';
import { beginBotInput } from '../bots/common';
import type { World } from '../types';

export function botSystem(world: World): void {
  for (const p of world.players) {
    if (!p.bot) continue;
    if (p.kaijuId >= 0) kaijuBot(world, p, world.kaijus[p.kaijuId]);
    else if (p.squadId >= 0) squadBot(world, p, world.squads[p.squadId]);
    else beginBotInput(world, p);
  }
}
