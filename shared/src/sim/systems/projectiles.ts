/**
 * System 7 of 11: projectiles.
 *
 * STUB(sim): Worker 2 (human squads) fills this in:
 * - integrate every projectile by DT (flat: constant velocity; arc and thrown: add
 *   `gravity` downward), count `ttl` down;
 * - sweep the step segment against, in order of distance: standing structures
 *   (`castSegment`), living kaiju (capsule: `kaijuCapsule` + `segmentVsCapsule`), enemy units
 *   (no friendly fire between human units) and the ground (y <= 0);
 * - on impact queue the damage: `world.hits` for the kaiju or units in the splash radius,
 *   `world.structureHits` for the structure hit and structures within the splash (the backstop
 *   rule: a miss damages whatever is behind), `world.propHits` for props in the splash; emit
 *   `projectileHit` and remove the projectile. Clients fly projectiles themselves from
 *   `projectileSpawn` with the same kinematics, so keep the integration exactly this simple.
 */

import type { World } from '../types';

export function projectileSystem(_world: World): void {
  // STUB(sim): see the file header.
}
