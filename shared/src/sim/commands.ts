/**
 * Squad commands: the four command wheel orders plus call-ins. They reach the simulation either
 * inside an input (`wheel` / `marker`, or the call-in button) or as a `command` message that the
 * server passes to `queueCommand`. Either way the orders system sees them in
 * `player.commands` on the next tick.
 */

import { CALLIN_IDS, type CallInId } from '../defs/ids';
import { sanitizeMarker } from '../net/input';

export type SquadCommand =
  /** Sub-units keep formation behind the leader. */
  | { type: 'follow' }
  /** Sub-units go to the marked ground point and hold there. */
  | { type: 'moveTo'; x: number; z: number }
  /** Sub-units shoot on their own when they have range and line of sight. */
  | { type: 'fireAtWill' }
  /** Sub-units stop, lock to their firing arc, show lasers and build charge. */
  | { type: 'holdCharge' }
  /** Request an off-map strike on a ground point. */
  | { type: 'callIn'; callIn: CallInId; x: number; z: number };

export type SquadCommandType = SquadCommand['type'];

/** Validates a command received from a client. Returns null when it is not usable. */
export function sanitizeCommand(raw: unknown, cityHalf = 1100): SquadCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'follow':
      return { type: 'follow' };
    case 'fireAtWill':
      return { type: 'fireAtWill' };
    case 'holdCharge':
      return { type: 'holdCharge' };
    case 'moveTo': {
      const m = sanitizeMarker(r, cityHalf);
      return m ? { type: 'moveTo', x: m.x, z: m.z } : null;
    }
    case 'callIn': {
      const m = sanitizeMarker(r, cityHalf);
      if (!m || typeof r.callIn !== 'string' || !(CALLIN_IDS as readonly string[]).includes(r.callIn)) return null;
      return { type: 'callIn', callIn: r.callIn as CallInId, x: m.x, z: m.z };
    }
    default:
      return null;
  }
}
