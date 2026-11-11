/**
 * System 2 of 11: kaiju actions.
 *
 * STUB(sim): the kaiju action state machine. Worker 1 (kaiju combat) fills this in:
 * - read each kaiju's player input (`world.players[k.player].input`: pressed / released edges,
 *   heldTicks, lastHeldTicks, sincePressTicks) and apply the tap and hold rules in net/input.ts
 *   to start swipe, stomp, grab, throw, eat, brace, roar, special and (when
 *   `k.moltAvailable`) molt, using the timings in `kaijuKindDef(k.kind).actions`;
 * - advance `phase`, `phaseTime`, `phaseDuration`, `actionTime`, `actionYaw` and tick down
 *   `cooldowns`; emit `kaijuAction` on every phase change and `kaijuHeld`, `roar` as they happen;
 *   call `noteKaijuNoise(k)` (sim/spotting.ts) when it roars or stomps, so a hatchling shows on
 *   the humans' map for a few seconds;
 * - grab and eat take things out of the world: a live prop (clear its `propAlive` bit), a prop
 *   wreck (`world.propWreck`), a living grabbable vehicle or a dead one's wreck (`unit.wreck`),
 *   or a chunk of a building; say which in `kaijuHeld.source` / `sourceId` so clients remove it;
 * - when an effect goes off, push the results into the queues: `world.hits` for units,
 *   `world.structureHits` and `world.propHits` for the city, and spawn thrown projectiles into
 *   `world.projectiles` (emit `projectileSpawn`);
 * - stagger, cocoon and dead are phases too: the damage and match flow systems put the kaiju
 *   in them; this system only counts their timers and must not start actions during them.
 *
 * The movement system already honors the state machine: `kaijuMoveParams` slows or roots the
 * kaiju from `phase` and `action` (see sim/movement.ts).
 */

import { DT } from '../../defs/rules';
import type { World } from '../types';

export function kaijuActionSystem(world: World): void {
  if (world.match.phase !== 'playing') return;
  for (const k of world.kaijus) {
    if (!k.alive) continue;
    // Timers that must run even before the real state machine exists, so snapshots stay sane.
    k.phaseTime += DT;
    if (k.phase !== 'idle') k.actionTime += DT;
  }
}
