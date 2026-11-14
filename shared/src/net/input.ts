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
 *   (Bits 2, 3 and 4 were the old brace, roar and beam buttons. They are free now, and
 *   sanitizeInput drops them.)
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
 *   (Bits 7, 8 and 9 were the squad's old artillery, smoke and mark buttons. They are free now,
 *   and sanitizeInput drops them, as it drops any field it does not know.)
 *
 *   The map view and the camera toggle are client-only. While the map is open the client sends
 *   zero movement and no buttons (the unit idles).
 */

import { PI, wrapAngle } from '../math/angle';
import { clamp } from '../math/scalar';

/**
 * Button bits of PlayerInput.buttons. A button keeps its bit for good; a bit whose button is
 * gone stays free (bits 2 to 4: the monster's old brace, roar and beam buttons; bits 7 to 9: the
 * squad's old artillery, smoke and mark buttons).
 */
export const Btn = {
  strike: 1 << 0,
  grab: 1 << 1,
  molt: 1 << 5,
  fire: 1 << 6,
  stomp: 1 << 10,
  move1: 1 << 11,
  move2: 1 << 12,
  /** The squad's volley: hold to plant and charge the squad-mates, let go to fire (see the header). */
  volley: 1 << 13,
} as const;

export type ButtonName = keyof typeof Btn;

/** Every button, in the order of its bit. */
export const BUTTON_NAMES: readonly ButtonName[] = (Object.keys(Btn) as ButtonName[]).sort((a, b) => Btn[a] - Btn[b]);

/** Every button's bit together: anything else in `buttons` is dropped by sanitizeInput. */
export const BUTTON_MASK = BUTTON_NAMES.reduce((mask, name) => mask | Btn[name], 0);

/**
 * How long the simulation's per-button arrays are: one entry per bit up to the highest in use
 * (bit i is 1 << i; the entry of a free bit is never read).
 */
export const BUTTON_COUNT = 32 - Math.clz32(BUTTON_MASK);

/** Bit index of each button, for the per-button arrays in the simulation's input state. */
export const BtnIndex: Readonly<Record<ButtonName, number>> = Object.fromEntries(BUTTON_NAMES.map((name) => [name, 31 - Math.clz32(Btn[name])])) as Record<ButtonName, number>;

/** Ticks a kaiju button press is remembered while another action finishes (0.2 s). */
export const INPUT_BUFFER_TICKS = 6;

/** Steepest aim elevation either way. */
export const MAX_AIM_PITCH = (89 * PI) / 180;

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
 * input at all; otherwise a clean copy with every field in range, and nothing else (no unknown
 * field, no free button bit). Never trust the wire.
 */
export function sanitizeInput(raw: unknown): PlayerInput | null {
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
  if (r.card === 1 || r.card === 2 || r.card === 3) out.card = r.card;
  return out;
}
