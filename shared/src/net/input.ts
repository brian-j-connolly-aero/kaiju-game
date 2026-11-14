/**
 * The input contract: what a client sends 30 times a second, and what every button means.
 *
 * The client sends RAW state (which buttons are down right now). Presses, releases and edges are
 * worked out by the simulation's input system from that state, on the server, so there is one
 * authority and bots can drive the exact same interface. The client runs the same rules locally
 * only to start wind-up animations at once.
 *
 * ---------------------------------------------------------------------------------------------
 * Movement and aim (both roles)
 *
 *   moveX, moveZ   Stick or keys, each in [-1, 1], length at most 1. For the kaiju and for
 *                  rocket infantry they are RELATIVE TO THE VIEW: moveZ +1 is forward along
 *                  aimYaw, moveX +1 is to the right of the view. A tank reads them differently
 *                  (below).
 *   aimYaw         Heading of the view (yaw 0 faces +Z, grows toward +X).
 *   aimPitch       Elevation of the view, positive up.
 *
 *   Kaiju: aimYaw is the desired heading. The body turns toward it at the stage turn rate; the
 *   head (camera, throw and beam direction) follows aimYaw but can lead the body by at most
 *   `headLeadMax` (50 degrees).
 *   Human, stage 1 (rocket infantry): the unit moves relative to the view, at once in any
 *   direction, and its weapon aims along (aimYaw, aimPitch) from the unit's eye. In third
 *   person the client converts its camera ray to that direction.
 *   Human, stages 2 and 3 (the driven tank, or troop of three): real tank driving
 *   ('tank' steering in sim/movement.ts, numbers in `UnitTypeDef.drive`):
 *     moveZ        throttle along the hull: +1 full ahead, -1 full reverse (reverse tops out at
 *                  `drive.reverseMult` of the top speed). Speeding up takes `drive.accel`,
 *                  slowing down and stopping to reverse `drive.brake` (meters per second
 *                  squared). With no throttle the tank brakes to a stop.
 *     moveX        turns the hull, +1 to the right at `drive.turnRate`; it turns on the spot
 *                  when it is not moving. The pair is read as a square, not a disc: a diagonal
 *                  of length 1 (W and D together) is full throttle AND full turn.
 *     aimYaw       where the player looks. The turret (the unit's `aimYaw` in snapshots) swings
 *                  toward it at `drive.turretRate`; it is not tied to the hull.
 *     aimPitch     the gun's elevation follows it at once (the unit's `aimPitch`).
 *   The driven tank's own shots leave along the turret, not along the view. Sub-units steer
 *   themselves and are not affected. The client predicts all of this with `stepMovement` and
 *   `unitMoveParams` (pass the snapshot unit: its `driven` flag picks tank steering), with the
 *   turret in the predicted body's `aimYaw`.
 *
 * ---------------------------------------------------------------------------------------------
 * Kaiju buttons: one move per button, no tap-versus-hold anywhere (docs/ROADMAP.md, phase 1)
 *
 *   Btn.strike   Swipe. With something in the hand: Throw it at the aim point.
 *   Btn.grab     Grab the nearest thing in reach that can be picked up. With something in the
 *                hand: Eat it (when the meal is off cooldown). With nothing to pick up in reach
 *                but something to eat (a kiosk, say): Eat that. With neither: the hand grabs
 *                at nothing (a whiff).
 *   Btn.stomp    Stomp.
 *   Btn.move1    The move put in the first slot at the first molt (`Kaiju.moves[0]`), and
 *   Btn.move2    the one put in the second slot at the second molt. Nothing while a slot is
 *                empty. The moves: beam (when rage is full), roar, charge (a second press
 *                during the run ends it early), tail sweep (each when off cooldown), and the
 *                brace, which lasts for as long as its button is down.
 *   Btn.molt     Starts the cocoon, on the press, when a molt is offered.
 *   Btn.block, Btn.roar, Btn.special: the old controls. Still defined (and let through by
 *                sanitizeInput) but the simulation reads none of them.
 *
 *   card         One-shot: the molt card picked since the last input, 1 to 3 (the first,
 *                second or third move on offer). It counts from the moment the cocoon starts
 *                until the intermission after it is over; a card that is not picked by then is
 *                drawn at random. Anything else is ignored.
 *
 *   A press that arrives while another action is still running is remembered for
 *   INPUT_BUFFER_TICKS, and for as long as the button stays down, and starts as soon as the
 *   kaiju is free. Holding a button down does not repeat its action.
 *
 *   Nothing cancels an action once it has begun, except a second press of the charge's button
 *   during its run (it stumbles at once). Bracing is exclusive: while its button is down no
 *   other button starts anything. When several things are wanted on the same tick the order is
 *   molt, brace, the first move, the second move, stomp, strike, grab.
 *
 *   Swimming has no button: any kaiju button (strike, grab, stomp, either move, molt) brings a
 *   swimming kaiju up, and the press is carried out once it is up.
 *
 * ---------------------------------------------------------------------------------------------
 * Human buttons: two (docs/ROADMAP.md, phase 1). The squad's other three units are not
 * ordered about: they ride with the leader as a loose swarm and shoot at will on their own.
 *
 *   Btn.fire     (left mouse) Fires the driven unit's weapon whenever it is off cooldown: on
 *                the press and again for as long as the button stays down. The shots go to the
 *                point where the weapon's aim ray from the unit's eye lands (for a tank, along
 *                the turret). A person's own shots have no aim error.
 *   Btn.volley   (right mouse) While it is down, the squad-mates stop where they are and plant:
 *                rooted, lasers on, their weapons swinging toward the point the view's aim ray
 *                from the leader's eye lands on (the crosshair; on a kaiju, the middle of its
 *                body at that height), charging from 0 to 1 over COMBAT_RULES.chargeTime. The
 *                leader is never planted and drives on. When it is let go, every planted
 *                squad-mate with charge whose weapon is ready fires at that point (ragged below
 *                COMBAT_RULES.volleyMinCharge, a charged volley from there up), the leader's
 *                own shot joins if its weapon is ready, and the squad-mates follow again. A
 *                stunned or shaken squad-mate neither charges nor fires.
 *
 *   Btn.callIn, Btn.smoke, Btn.mark, and the `wheel` and `marker` fields: the old squad
 *                controls (artillery, smoke, marking, the command wheel and its markers). Still
 *                defined (and let through by sanitizeInput) for the client of the moment, but
 *                the simulation reads none of them.
 *
 *   The map view and the camera toggle are client-only. While the map is open the client sends
 *   zero movement and no buttons (the unit idles).
 */

import { COMMAND_IDS, type CommandId } from '../defs/ids';
import { PI, wrapAngle } from '../math/angle';
import { clamp } from '../math/scalar';

/** Button bits of PlayerInput.buttons. */
export const Btn = {
  strike: 1 << 0,
  grab: 1 << 1,
  /** Unused by the simulation since the monster's new controls (the client still sends it). */
  block: 1 << 2,
  /** Unused by the simulation since the monster's new controls (the client still sends it). */
  roar: 1 << 3,
  /** Unused by the simulation since the monster's new controls (the client still sends it). */
  special: 1 << 4,
  molt: 1 << 5,
  fire: 1 << 6,
  /** Unused by the simulation since the army's new controls (the client still sends it). */
  callIn: 1 << 7,
  /** Unused by the simulation since the army's new controls (the client still sends it). */
  smoke: 1 << 8,
  /** Unused by the simulation since the army's new controls (the client still sends it). */
  mark: 1 << 9,
  stomp: 1 << 10,
  move1: 1 << 11,
  move2: 1 << 12,
  /** The squad's volley: hold to plant and charge the squad-mates, let go to fire (see the header). */
  volley: 1 << 13,
} as const;

export type ButtonName = keyof typeof Btn;

/** Button names by bit index (bit i is 1 << i). */
export const BUTTON_NAMES: readonly ButtonName[] = [
  'strike',
  'grab',
  'block',
  'roar',
  'special',
  'molt',
  'fire',
  'callIn',
  'smoke',
  'mark',
  'stomp',
  'move1',
  'move2',
  'volley',
];
export const BUTTON_COUNT = BUTTON_NAMES.length;
export const BUTTON_MASK = (1 << BUTTON_COUNT) - 1;

/** Bit index of each button, for the per-button arrays in the simulation's input state. */
export const BtnIndex: Readonly<Record<ButtonName, number>> = {
  strike: 0,
  grab: 1,
  block: 2,
  roar: 3,
  special: 4,
  molt: 5,
  fire: 6,
  callIn: 7,
  smoke: 8,
  mark: 9,
  stomp: 10,
  move1: 11,
  move2: 12,
  volley: 13,
};

/** Ticks a kaiju button press is remembered while another action finishes (0.2 s). */
export const INPUT_BUFFER_TICKS = 6;

/** Steepest aim elevation either way. */
export const MAX_AIM_PITCH = (89 * PI) / 180;

export interface GroundMarker {
  x: number;
  z: number;
}

/** One input sample. JSON on the wire (`input` message), 30 per second. */
export interface PlayerInput {
  /** Client sequence number: starts at 1 and grows by 1 per input sent. Echoed back in snapshots. */
  seq: number;
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  /** Bitwise OR of the Btn bits that are down right now. */
  buttons: number;
  /** The old command wheel pick: let through, read by nothing in the simulation (see the header). */
  wheel?: CommandId;
  /** The old ground marker: let through, read by nothing in the simulation (see the header). */
  marker?: GroundMarker;
  /** Kaiju: the molt card picked since the last input, 1 to 3 (one-shot; see the header). */
  card?: number;
}

export function neutralInput(seq = 0): PlayerInput {
  return { seq, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, buttons: 0 };
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates and normalizes an input received from a client. Returns null when it is not a usable
 * input at all; otherwise a clean copy with every field in range. Never trust the wire.
 */
export function sanitizeInput(raw: unknown, cityHalf = 1100): PlayerInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.seq) || !finite(r.moveX) || !finite(r.moveZ) || !finite(r.aimYaw) || !finite(r.aimPitch)) return null;
  if (!finite(r.buttons)) return null;
  let moveX = clamp(r.moveX, -1, 1);
  let moveZ = clamp(r.moveZ, -1, 1);
  const len = Math.hypot(moveX, moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }
  const out: PlayerInput = {
    seq: Math.max(0, Math.floor(r.seq)) >>> 0,
    moveX,
    moveZ,
    aimYaw: wrapAngle(r.aimYaw),
    aimPitch: clamp(r.aimPitch, -MAX_AIM_PITCH, MAX_AIM_PITCH),
    buttons: Math.floor(r.buttons) & BUTTON_MASK,
  };
  if (typeof r.wheel === 'string' && (COMMAND_IDS as readonly string[]).includes(r.wheel)) {
    out.wheel = r.wheel as CommandId;
  }
  const marker = sanitizeMarker(r.marker, cityHalf);
  if (marker) out.marker = marker;
  if (r.card === 1 || r.card === 2 || r.card === 3) out.card = r.card;
  return out;
}

/** Validates a ground marker and clamps it into the city. Returns null when unusable. */
export function sanitizeMarker(raw: unknown, cityHalf = 1100): GroundMarker | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.z)) return null;
  return { x: clamp(m.x, -cityHalf, cityHalf), z: clamp(m.z, -cityHalf, cityHalf) };
}
