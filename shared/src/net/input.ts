/**
 * The input contract: what a client sends 30 times a second, and what every button means.
 *
 * The client sends RAW state (which buttons are down right now). Taps, holds and edges are
 * worked out by the simulation's input system from that state, on the server, so there is one
 * authority and bots can drive the exact same interface. The client runs the same rules locally
 * only to start wind-up animations at once.
 *
 * ---------------------------------------------------------------------------------------------
 * Movement and aim (both roles)
 *
 *   moveX, moveZ   Stick or keys, each in [-1, 1], length at most 1, RELATIVE TO THE VIEW:
 *                  moveZ +1 is forward along aimYaw, moveX +1 is to the right of the view.
 *   aimYaw         Heading of the view (yaw 0 faces +Z, grows toward +X).
 *   aimPitch       Elevation of the view, positive up.
 *
 *   Kaiju: aimYaw is the desired heading. The body turns toward it at the stage turn rate; the
 *   head (camera, throw and beam direction) follows aimYaw but can lead the body by at most
 *   `headLeadMax` (50 degrees).
 *   Human: the unit moves relative to the view and its weapon aims along (aimYaw, aimPitch)
 *   from the unit's eye. In third person the client converts its camera ray to that direction.
 *
 * ---------------------------------------------------------------------------------------------
 * Kaiju buttons
 *
 *   Btn.strike   Swipe / Stomp. Pressing starts the Swipe wind-up at once. If the button is
 *                still down `stomp.holdTime` (0.35 s) after the press, the action becomes a
 *                Stomp and keeps the time already spent (the stomp's 0.9 s wind-up counts from
 *                the press). Releasing earlier leaves it a Swipe.
 *                While holding an object, pressing Strike throws it instead.
 *   Btn.grab     Grab / Throw / Eat.
 *                Empty hands: pressing starts the Grab (0.4 s). If the button is still down
 *                `eat.holdTime` (0.5 s) after the press, the kaiju goes on to Eat what it just
 *                grabbed, or an edible in reach if the grab found nothing.
 *                Holding an object: releasing before 0.5 s throws it at the aim point; keeping
 *                the button down for 0.5 s eats it.
 *   Btn.block    Brace for as long as the button is down.
 *   Btn.roar     Roar on the press, if it is off cooldown.
 *   Btn.special  The kind's special on the press, if rage is full.
 *   Btn.molt     Only when a molt is available: holding for `molt.holdTime` (1 s) starts the
 *                cocoon; letting go earlier cancels.
 *
 *   A press that arrives while another action is still running is remembered for
 *   INPUT_BUFFER_TICKS and starts as soon as the kaiju is free.
 *
 * ---------------------------------------------------------------------------------------------
 * Human buttons
 *
 *   Btn.fire     Fires the driven unit's weapon whenever it is off cooldown: on the press and
 *                again for as long as the button stays down. Every shot the player fires is the
 *                volley trigger: each sub-unit with charge fires at the player's aim point.
 *   Btn.callIn   On the press, requests the squad's call-in at `marker` if this input carries
 *                one, otherwise at the point where the aim ray meets the ground.
 *
 *   wheel        One-shot: the command picked on the wheel since the last input.
 *   marker       One-shot ground point that goes with `wheel: 'moveTo'` or with Btn.callIn. When
 *                'moveTo' has no marker the server uses the point where the aim ray lands.
 *
 *   The map view and the camera toggle are client-only. While the map is open the client sends
 *   zero movement and no buttons (the unit idles); markers placed on the map are sent either as
 *   `wheel` + `marker` on the next input or as a `command` message. Both do the same thing.
 */

import { COMMAND_IDS, type CommandId } from '../defs/ids';
import { PI, wrapAngle } from '../math/angle';
import { clamp } from '../math/scalar';

/** Button bits of PlayerInput.buttons. */
export const Btn = {
  strike: 1 << 0,
  grab: 1 << 1,
  block: 1 << 2,
  roar: 1 << 3,
  special: 1 << 4,
  molt: 1 << 5,
  fire: 1 << 6,
  callIn: 1 << 7,
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
  wheel?: CommandId;
  marker?: GroundMarker;
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
  return out;
}

/** Validates a ground marker and clamps it into the city. Returns null when unusable. */
export function sanitizeMarker(raw: unknown, cityHalf = 1100): GroundMarker | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.z)) return null;
  return { x: clamp(m.x, -cityHalf, cityHalf), z: clamp(m.z, -cityHalf, cityHalf) };
}
