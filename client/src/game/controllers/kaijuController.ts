/**
 * The kaiju player's controller (DESIGN.md section 4). The mouse or right stick sets a desired
 * heading; the body turns toward it at the stage's turn rate, and the head, which is the
 * first-person camera, can lead the body by at most 50 degrees. So a flick of the mouse does
 * not snap the view around: the head swings to its limit and the body lumbers after it.
 *
 * First person sits on the rig's `cam_fp` node (own snout and claws in view); the toggle gives
 * a chase camera behind the body. Both cameras look in exactly the same direction (`viewYaw`,
 * `viewPitch`: the head's), with the same limits, so the toggle changes where the camera sits
 * and never where the player is looking. The chase camera hangs behind a point above the
 * kaiju's shoulders along that direction. In the chase camera the aim sent to the server runs
 * from the kaiju's eye to whatever the camera's center ray lands on, so the crosshair shows
 * where a throw goes.
 *
 * While the head is not the player's (the beam drags it, or the kaiju is staggered) both
 * cameras ride the head as the server has it, and the mouse only says where it should go.
 *
 * The buttons (net/input.ts): one move per button, no tap-versus-hold. Strike, Grab, Stomp, the
 * two move buttons and Molt go out as they are held; a molt card picked on the card picker
 * (ui/moltCards.ts: a key, a d-pad direction or a click) rides on exactly one input.
 */

import type * as THREE from 'three';
import {
  Btn,
  clamp,
  clampAngleAround,
  createAimPoint,
  DEG,
  kaijuEyePoint,
  kaijuKindDef,
  kaijuStageDef,
  resolveAimPoint,
  wrapAngle,
  type AimPoint,
  type SnapKaiju,
} from '@mb/shared';
import { clearOfWalls, easeClearance, type Point3 } from './cameraClearance';
import { aimCamera, setLens, type ControlContext, type Controller, type InputSample } from './types';

/** How far the desired heading may run ahead of the body: enough to ask for a turn-around. */
const MAX_HEADING_LEAD = 150 * DEG;
/** How far the view may look up or down, in both cameras. */
export const KAIJU_PITCH_LIMIT = 62 * DEG;
const PITCH_LIMIT = KAIJU_PITCH_LIMIT;
/** How high the chase camera may rise over a wall behind the kaiju, in body heights. */
const MAX_LIFT = 2;
/** The chase camera hangs from a point this many body heights up, over the shoulders. */
const CHASE_PIVOT = 1.25;
/** The lowest the chase camera goes (body heights): looking up, it slides along the ground. */
const CHASE_FLOOR = 0.12;
/** Swimming: the first-person eye never goes lower than this over the water (body heights). */
const SWIM_EYE = 0.1;
/** The chase camera's lens, and how much wider it opens during a charge's run (degrees). */
const CHASE_FOV = 60;
const CHARGE_FOV = 12;

/**
 * The lift (body heights) that takes a chase camera at `wanted`, hanging from `pivot` above
 * the body, clear over the walls between them: camera and pivot rise together (the air above
 * the kaiju is open), and the answer is the lowest of a few steps whose line is free, or -1
 * when none is.
 */
export function liftOverWalls(query: Parameters<typeof clearOfWalls>[0], pivot: Point3, wanted: Point3, height: number, margin: number): number {
  const from = { x: pivot.x, y: pivot.y, z: pivot.z };
  const to = { x: wanted.x, y: wanted.y, z: wanted.z };
  for (let i = 0; i <= 12; i++) {
    const lift = (MAX_LIFT * i) / 12;
    from.y = pivot.y + lift * height;
    to.y = wanted.y + lift * height;
    if (clearOfWalls(query, from, to, margin) >= 1) return lift;
  }
  return -1;
}

export class KaijuController implements Controller {
  readonly kind = 'kaiju' as const;
  thirdPerson: boolean;
  /** The heading the player wants (the view; what is sent as aimYaw in first person). */
  aimYaw = 0;
  aimPitch = 0;
  /** What is sent to the server: the view in first person, the crosshair's target in third. */
  sendYaw = 0;
  sendPitch = 0;
  /**
   * Where both cameras look: the head's direction. The wanted heading clamped to the head's
   * reach from the body (DESIGN.md section 4), or the head as the server has it while the
   * player does not steer it.
   */
  viewYaw = 0;
  viewPitch = 0;
  /** Where the crosshair lands (third person). */
  readonly aimPoint: AimPoint = createAimPoint();
  private started = false;
  private orbit = 0;
  /** How much of the way from the body to the wanted camera position is free of walls (eased). */
  private clear = 1;
  /** How far the chase camera has risen over a wall behind the kaiju, body heights (eased). */
  private lift = 0;
  /** How far in the cocoon camera has come to stay clear of the buildings around (eased). */
  private orbitClear = 1;
  private readonly pivot = { x: 0, y: 0, z: 0 };
  /** Where the chase camera is this frame. */
  private readonly chase = { x: 0, y: 0, z: 0 };
  /** Where the body was when `chase` was placed (the camera keeps its place relative to it). */
  private readonly chaseFrom = { x: 0, z: 0 };
  private readonly eye = { x: 0, y: 0, z: 0 };
  /** The molt card (1 to 3) the next input sample carries, once; 0 for none. */
  private card = 0;
  /** How far the lens has opened for a charge's run, 0..1 (eased). */
  private rush = 0;

  constructor(thirdPerson = false) {
    this.thirdPerson = thirdPerson;
  }

  /**
   * Picks molt card `n` (1 to 3): the next input sample carries it to the server, and only that
   * one (the server ignores a pick without an offer standing).
   */
  pickCard(n: number): void {
    if (n >= 1 && n <= 3) this.card = n;
  }

  /** A card picked and not yet sent (tests, and the HUD's picture of the pick). */
  get pendingCard(): number {
    return this.card;
  }

  /** First person with the camera pulled back inside the skull by a wall ahead. */
  get insideHead(): boolean {
    return !this.thirdPerson && this.clear < 0.999;
  }

  /** Whether the player steers the head right now (not while the beam drags it, or helpless). */
  private headFree(k: SnapKaiju): boolean {
    if (k.phase === 'stagger' || k.phase === 'cocoon' || k.phase === 'dead') return false;
    const def = kaijuKindDef(k.kind);
    return !(k.action === 'special' && k.phase === def.actions.special.activePhase);
  }

  /** The direction both cameras look this frame (see `viewYaw`). */
  private placeView(k: SnapKaiju): void {
    if (this.headFree(k)) {
      this.viewYaw = clampAngleAround(this.aimYaw, k.yaw, kaijuKindDef(k.kind).headLeadMax);
      this.viewPitch = this.aimPitch;
    } else {
      this.viewYaw = k.aimYaw;
      this.viewPitch = clamp(k.aimPitch, -PITCH_LIMIT, PITCH_LIMIT);
    }
  }

  update(ctx: ControlContext): void {
    const k = ctx.frame.localKaiju;
    const input = ctx.input;
    if (!k) return;
    if (!this.started) {
      this.started = true;
      this.aimYaw = k.yaw;
    }
    if (input.pressed.camera) {
      this.thirdPerson = !this.thirdPerson;
      this.clear = 1;
      this.lift = 0;
    }
    if (input.aimOverride) {
      this.aimYaw = input.aimOverride.yaw;
      this.aimPitch = input.aimOverride.pitch;
    } else if (!ctx.mapOpen) {
      this.aimYaw = wrapAngle(this.aimYaw - input.lookX);
      this.aimPitch += input.lookY;
    }
    this.aimYaw = clampAngleAround(this.aimYaw, k.yaw, MAX_HEADING_LEAD);
    this.aimPitch = clamp(this.aimPitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.sendYaw = this.aimYaw;
    this.sendPitch = this.aimPitch;
    this.placeView(k);
    if (this.thirdPerson && k.phase !== 'cocoon' && k.phase !== 'dead') {
      this.placeChase(ctx, k);
      // (While the head is not the player's the camera rides it, and aiming from the camera
      // would steer the head by its own picture: the mouse's wish goes out as it is.)
      if (!input.aimOverride && this.headFree(k)) this.aimFromCamera(ctx, k);
    }
    ctx.session.aimYaw = this.sendYaw;
    ctx.session.aimPitch = this.sendPitch;
  }

  sample(ctx: ControlContext): InputSample {
    // A picked card goes out once, with whatever else this sample says (the map may be open).
    const card = this.card;
    this.card = 0;
    const out: InputSample = { moveX: 0, moveZ: 0, aimYaw: this.sendYaw, aimPitch: this.sendPitch, buttons: 0 };
    if (card > 0) out.card = card;
    if (ctx.mapOpen) return out;
    // The latch, not the instant: a click that began and ended between two samples is in this one.
    const d = ctx.input.held;
    let buttons = 0;
    if (d.strike) buttons |= Btn.strike;
    if (d.grab) buttons |= Btn.grab;
    if (d.stomp) buttons |= Btn.stomp;
    if (d.move1) buttons |= Btn.move1;
    if (d.move2) buttons |= Btn.move2;
    if (d.molt) buttons |= Btn.molt;
    // The stick is relative to the view; the server reads it relative to the aim it is sent.
    const turn = this.aimYaw - this.sendYaw;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const mx = ctx.input.moveX;
    const mz = ctx.input.moveZ;
    out.moveX = mx * c - mz * s;
    out.moveZ = mz * c + mx * s;
    out.buttons = buttons;
    return out;
  }

  /**
   * The chase camera for this frame: it hangs behind a point over the kaiju's shoulders, back
   * along the view direction, and looks along it (so the crosshair is the same line as in
   * first person, seen from behind). Looking up it slides down toward the ground instead of
   * going under it. A wall behind the kaiju does not pull the camera in against its back (the
   * view would be nothing but spines); the camera rises over the wall instead. Only when no
   * height up to MAX_LIFT clears it (a titan wading through towers) does it come in.
   */
  private placeChase(ctx: ControlContext, k: SnapKaiju): void {
    const st = kaijuStageDef(k.kind, k.stage);
    const back = st.height * 2.3 + st.bodyRadius * 2;
    const cp = Math.cos(this.viewPitch);
    const p = this.chase;
    const pivotY = st.height * CHASE_PIVOT;
    p.x = k.x - Math.sin(this.viewYaw) * back * cp;
    p.y = Math.max(st.height * CHASE_FLOOR, pivotY - Math.sin(this.viewPitch) * back);
    p.z = k.z - Math.cos(this.viewYaw) * back * cp;
    const near = Math.max(0.3, st.height * 0.05);
    this.pivot.x = k.x;
    this.pivot.y = st.height * 0.85;
    this.pivot.z = k.z;
    const query = ctx.session.mirror.query;
    const wanted = liftOverWalls(query, this.pivot, p, st.height, near * 2);
    // Up quickly, down gently (so walking past a row of houses does not bob the camera).
    const target = Math.max(0, wanted);
    this.lift = target > this.lift ? this.lift + (target - this.lift) * (1 - Math.exp(-ctx.dt * 10)) : this.lift + (target - this.lift) * (1 - Math.exp(-ctx.dt * 1.5));
    p.y += this.lift * st.height;
    this.pivot.y += this.lift * st.height;
    // Whatever is still in the way (rising, or nothing clears it): come in to this side of it.
    this.clear = easeClearance(this.clear, clearOfWalls(query, this.pivot, p, near * 2), ctx.dt);
    if (this.clear < 1) {
      p.x = this.pivot.x + (p.x - this.pivot.x) * this.clear;
      p.y = this.pivot.y + (p.y - this.pivot.y) * this.clear;
      p.z = this.pivot.z + (p.z - this.pivot.z) * this.clear;
    }
    this.chaseFrom.x = k.x;
    this.chaseFrom.z = k.z;
  }

  /** The lens opens a little while the kaiju runs in a charge (a sense of its speed), and eases back. */
  private rushLens(k: SnapKaiju, dt: number): number {
    const running = k.action === 'charge' && k.phase === 'charge';
    this.rush += ((running ? 1 : 0) - this.rush) * (1 - Math.exp(-dt * (running ? 5 : 2.5)));
    if (this.rush < 0.002) this.rush = 0;
    return this.rush * CHARGE_FOV;
  }

  /** Third person: aim from the kaiju's eye at what the crosshair is on. */
  private aimFromCamera(ctx: ControlContext, k: SnapKaiju): void {
    const p = this.chase;
    const yaw = this.viewYaw;
    const pitch = this.viewPitch;
    const st = kaijuStageDef(k.kind, k.stage);
    resolveAimPoint(ctx.session.mirror.query, p.x, p.y, p.z, yaw, pitch, st.height * 40, this.aimPoint);
    const a = this.aimPoint;
    if (a.on === 'none') {
      // The sky: aim the same way the camera looks.
      this.sendYaw = clampAngleAround(yaw, k.yaw, MAX_HEADING_LEAD);
      this.sendPitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
      return;
    }
    // The eye moves with the aim heading; one refinement is plenty.
    const source = { kind: k.kind, stage: k.stage, x: k.x, z: k.z, aimYaw: this.viewYaw };
    for (let i = 0; i < 2; i++) {
      kaijuEyePoint(source, this.eye);
      const ex = a.x - this.eye.x;
      const ez = a.z - this.eye.z;
      const flat = Math.hypot(ex, ez);
      if (flat < st.bodyRadius) {
        this.sendYaw = this.viewYaw;
        this.sendPitch = this.viewPitch;
        return;
      }
      source.aimYaw = Math.atan2(ex, ez);
      this.sendYaw = clampAngleAround(source.aimYaw, k.yaw, MAX_HEADING_LEAD);
      this.sendPitch = clamp(Math.atan2(a.y - this.eye.y, flat), -PITCH_LIMIT, PITCH_LIMIT);
    }
  }

  applyCamera(ctx: ControlContext, camera: THREE.PerspectiveCamera): void {
    const k = ctx.frame.localKaiju;
    if (!k) return;
    const st = kaijuStageDef(k.kind, k.stage);
    if (k.phase === 'cocoon' || k.phase === 'dead') {
      // Helpless inside the cocoon (or fallen): watch from outside, circling slowly, and come in
      // to this side of any building that would stand between the camera and the body.
      this.orbit += ctx.dt * 0.35;
      const r = st.height * 2.6 + 14;
      const eye = this.eye;
      eye.x = k.x + Math.sin(this.orbit) * r;
      eye.y = st.height * 1.1 + 5;
      eye.z = k.z + Math.cos(this.orbit) * r;
      this.pivot.x = k.x;
      this.pivot.y = st.height * 0.9;
      this.pivot.z = k.z;
      const near = Math.max(0.3, st.height * 0.05);
      this.orbitClear = easeClearance(this.orbitClear, clearOfWalls(ctx.session.mirror.query, this.pivot, eye, near * 2), ctx.dt, 2);
      camera.position.set(
        this.pivot.x + (eye.x - this.pivot.x) * this.orbitClear,
        this.pivot.y + (eye.y - this.pivot.y) * this.orbitClear,
        this.pivot.z + (eye.z - this.pivot.z) * this.orbitClear,
      );
      setLens(camera, 60, near, 9000);
      camera.up.set(0, 1, 0);
      camera.lookAt(k.x, st.height * 0.45, k.z);
      return;
    }
    this.orbit = k.yaw + Math.PI;
    this.orbitClear = 1;
    const wider = this.rushLens(k, ctx.dt);
    if (!this.thirdPerson) {
      // In the head: the camera rides the rig's anchor and looks where the head looks.
      const anchor = ctx.renderer.kaijuCamAnchor(k.id);
      if (anchor) camera.position.copy(anchor);
      else camera.position.set(k.x, st.eyeHeight, k.z);
      // Swimming, the head lies low in the water: the eyes stay just above the surface.
      if (k.submerge > 0) camera.position.y = Math.max(camera.position.y, st.height * SWIM_EYE);
      const near = Math.max(0.08, st.height * 0.02);
      // From stage 2 on the head reaches past the body's collision circle: against a tower the
      // eye would be inside it. Hold it back, level with itself, short of the wall.
      this.pivot.x = k.x;
      this.pivot.y = camera.position.y;
      this.pivot.z = k.z;
      this.clear = easeClearance(this.clear, clearOfWalls(ctx.session.mirror.query, this.pivot, camera.position, near * 2.5), ctx.dt);
      if (this.clear < 1) {
        camera.position.x = k.x + (camera.position.x - k.x) * this.clear;
        camera.position.z = k.z + (camera.position.z - k.z) * this.clear;
      }
      setLens(camera, 72 + wider, near, 9000);
      this.placeView(k);
      aimCamera(camera, this.viewYaw, this.viewPitch);
    } else {
      // Placed in `update` from the body as it was then; the frame's input steps have moved the
      // drawn body since (MatchSession.refreshLocal), so the camera moves with it, and never
      // trails it by a frame (which shows as a shiver in a charge).
      const p = this.chase;
      camera.position.set(p.x + (k.x - this.chaseFrom.x), p.y, p.z + (k.z - this.chaseFrom.z));
      setLens(camera, CHASE_FOV + wider, Math.max(0.3, st.height * 0.05), 9000);
      aimCamera(camera, this.viewYaw, this.viewPitch);
    }
  }
}
