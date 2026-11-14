/**
 * The old squad commands: the four command wheel orders plus call-ins, smoke and marking. The
 * squads take no orders any more (docs/ROADMAP.md, phase 1), and nothing in the simulation acts
 * on these: a `command` message is still validated here and handed to `queueCommand`, which
 * drops it, because the client of the moment still sends them from the map. Remove this file,
 * `queueCommand` and the `command` message together once no client sends one.
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
  | { type: 'callIn'; callIn: CallInId; x: number; z: number }
  /** Throw the squad's smoke toward a ground point (sim/abilities.ts). */
  | { type: 'smoke'; x: number; z: number }
  /** Mark the kaiju the leader is aiming at, for the whole army (sim/abilities.ts). */
  | { type: 'mark' };

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
    case 'smoke': {
      const m = sanitizeMarker(r, cityHalf);
      return m ? { type: 'smoke', x: m.x, z: m.z } : null;
    }
    case 'mark':
      return { type: 'mark' };
    case 'callIn': {
      const m = sanitizeMarker(r, cityHalf);
      if (!m || typeof r.callIn !== 'string' || !(CALLIN_IDS as readonly string[]).includes(r.callIn)) return null;
      return { type: 'callIn', callIn: r.callIn as CallInId, x: m.x, z: m.z };
    }
    default:
      return null;
  }
}
