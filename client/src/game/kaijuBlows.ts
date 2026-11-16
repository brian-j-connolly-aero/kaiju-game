/**
 * Which simulation events are the monster's own blows landing (round 4's flair: its crosshair
 * flashes claw slashes, ui/kaijuFlair.ts; in a power surge the hit flashes electric in the world,
 * render/gameRenderer.ts).
 */

import type { SimEvent } from '@mb/shared';

/** What the monster's own blows deal (a unit or a building hit by one of these is its hit landing). */
const KAIJU_BLOWS: ReadonlySet<string> = new Set(['swipe', 'stomp', 'thrown', 'beam', 'roar', 'charge', 'tailSweep', 'javelin', 'club', 'splash']);

/** Whether a simulation event is one of the monster's blows landing on a unit or a building. */
export function kaijuBlowLanded(e: SimEvent): e is Extract<SimEvent, { type: 'unitHit' | 'structureStage' }> {
  return (e.type === 'unitHit' || e.type === 'structureStage') && KAIJU_BLOWS.has(e.cause);
}
