/**
 * The system pipeline: eleven systems in a fixed order, each in its own file under systems/
 * (ARCHITECTURE.md section 3). The order is part of the contract; changing it changes the game.
 */

import type { SimEvent } from './events';
import { botSystem } from './systems/bots';
import { cityDamageSystem } from './systems/cityDamage';
import { damageSystem } from './systems/damage';
import { inputSystem } from './systems/inputs';
import { kaijuActionSystem } from './systems/kaijuActions';
import { matchFlowSystem } from './systems/matchFlow';
import { movementSystem } from './systems/movement';
import { projectileSystem } from './systems/projectiles';
import { unitOrderSystem } from './systems/unitOrders';
import { voiceSystem } from './systems/voice';
import { weaponSystem } from './systems/weapons';
import type { InputsByPlayer, World } from './types';

/** System names in execution order, for docs, profiling and tests. */
export const SYSTEM_ORDER = [
  'inputs',
  'kaijuActions',
  'unitOrders',
  'bots',
  'movement',
  'weapons',
  'projectiles',
  'damage',
  'cityDamage',
  'matchFlow',
  'voice',
] as const;
export type SystemName = (typeof SYSTEM_ORDER)[number];

/**
 * Advances the world by one tick (DT seconds) and returns the events of that tick. After the
 * match has ended the world no longer changes and no further events are produced.
 */
export function stepWorld(world: World, inputs?: InputsByPlayer): SimEvent[] {
  if (world.match.phase === 'ended') return [];
  world.tick++;
  world.events = [];

  inputSystem(world, inputs); //   1. inputs
  kaijuActionSystem(world); //     2. kaiju actions
  unitOrderSystem(world); //       3. unit orders and sub-unit AI
  botSystem(world); //             4. bots (they write the input used on the next tick)
  movementSystem(world); //        5. movement and collision
  weaponSystem(world); //          6. weapons and volleys
  projectileSystem(world); //      7. projectiles
  damageSystem(world); //          8. damage and nerve
  cityDamageSystem(world); //      9. city damage and bar
  matchFlowSystem(world); //      10. molt and match flow
  voiceSystem(world); //          11. voice cues

  return world.events;
}
