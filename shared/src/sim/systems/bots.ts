/**
 * System 4 of 11: bots.
 *
 * STUB(sim): Worker 3 (bots) fills this in. Bots play through the same interface as people:
 * for every player with `player.bot === true`, write the input the bot wants for the NEXT tick
 * into `player.botInput` (a PlayerInput: movement relative to its aim, aim, button bits, and
 * optionally `wheel` / `marker` for squad commands). The input system picks it up next tick, so
 * bots obey every rule a person does. Keep per-bot memory in `player.botState`
 * (sim/bots/types.ts) and behavior modules in sim/bots/.
 *
 * Behavior spec: DESIGN.md section 5, "Bots". Use `world.rng` for any randomness.
 */

import type { World } from '../types';

export function botSystem(world: World): void {
  for (const p of world.players) {
    if (!p.bot) continue;
    // Placeholder bot: stands still, hands off the buttons, keeps looking where it looked.
    p.botInput.seq = world.tick;
    p.botInput.moveX = 0;
    p.botInput.moveZ = 0;
    p.botInput.buttons = 0;
    p.botInput.wheel = undefined;
    p.botInput.marker = undefined;
  }
}
