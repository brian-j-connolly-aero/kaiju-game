/**
 * The system pipeline: twelve systems in a fixed order, each in its own file under systems/
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
import { pickupSystem } from './systems/pickups';
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
  'pickups',
  'weapons',
  'projectiles',
  'damage',
  'cityDamage',
  'matchFlow',
  'voice',
] as const;
export type SystemName = (typeof SYSTEM_ORDER)[number];

/**
 * Called after each system with that system's index in SYSTEM_ORDER: the server times the
 * systems with it (server/src/room/slowLog.ts). The simulation itself has no clock.
 */
export type SystemMark = (system: number) => void;

function noMark(): void {}

/**
 * Advances the world by one tick (DT seconds) and returns the events of that tick. After the
 * match has ended the world no longer changes and no further events are produced. `mark`, when
 * given, is called after every system (see SystemMark).
 */
export function stepWorld(world: World, inputs?: InputsByPlayer, mark: SystemMark = noMark): SimEvent[] {
  if (world.match.phase === 'ended') return [];
  world.tick++;
  world.events = [];

  inputSystem(world, inputs); //   1. inputs
  mark(0);
  kaijuActionSystem(world); //     2. kaiju actions
  mark(1);
  unitOrderSystem(world); //       3. unit orders and sub-unit AI
  mark(2);
  botSystem(world); //             4. bots (they write the input used on the next tick)
  mark(3);
  movementSystem(world); //        5. movement and collision
  mark(4);
  pickupSystem(world); //          6. supply crates and pick-ups
  mark(5);
  weaponSystem(world); //          7. weapons and volleys
  mark(6);
  projectileSystem(world); //      8. projectiles
  mark(7);
  damageSystem(world); //          9. damage and nerve
  mark(8);
  cityDamageSystem(world); //     10. city damage and bar (and buildings falling over)
  mark(9);
  matchFlowSystem(world); //      11. molt and match flow
  mark(10);
  voiceSystem(world); //          12. voice cues
  mark(11);

  return world.events;
}
