/**
 * Procedural animation of the lizard rig, driven entirely by the kaiju's action state
 * (ARCHITECTURE.md section 5): a walk cycle from its speed, the head leading the body, and a
 * pose for every wind-up, active and recovery phase, the brace, the roar, the stagger, the
 * beam, the charge (the head-down wind-up, the run with its longer, pounding stride, the
 * stumble) and the tail sweep. The wind-ups are the tells the humans read, so each one is a
 * distinct silhouette.
 *
 * The output is a set of rotations (radians, relative to the rest pose) for named nodes; the
 * view eases the rig toward them. Rotation signs (tools/art/README.md section 8): x positive is
 * nose down / swing back, y positive turns to the model's left, z positive rolls left side up.
 * A hanging limb therefore swings FORWARD and up with negative x.
 */

import { clamp, clamp01, smoothstep, type KaijuActionId, type KaijuPhase } from '@mb/shared';

export interface KaijuAnimInput {
  /** Seconds, for idle motion. */
  time: number;
  /** Walk cycle angle in radians; one full turn is two steps. */
  walkPhase: number;
  /** 0 standing .. 1 full speed. */
  speed: number;
  /** Head yaw relative to the body, radians (positive = to the model's left). */
  headYaw: number;
  headPitch: number;
  action: KaijuActionId;
  phase: KaijuPhase;
  /** Seconds into the current phase and its length (0 when open-ended). */
  phaseTime: number;
  phaseDuration: number;
  /** Something is in the right hand. */
  holding: boolean;
  /** Body height, meters (for offsets). */
  height: number;
  /**
   * The model's pose targets (radians, relative to the rest pose), from the manifest's `poses`
   * (docs/art/client-notes-kaiju-lizard.md section 2). Missing: the stand-in's FALLBACK_POSES.
   */
  poses?: PoseTable;
  /** The local player's own kaiju seen from inside its head: the claws are held up into view. */
  firstPerson?: boolean;
}

/** Rotations of named nodes, radians, Euler XYZ relative to the rest pose. */
export type PoseTarget = Readonly<Record<string, readonly [number, number, number]>>;
export type PoseTable = Readonly<Record<string, PoseTarget>>;

/**
 * Targets for a rig that has no `poses` in the manifest (the box stand-in): the animator's
 * numbers from before the art had targets, so the stand-in moves as it always did.
 */
export const FALLBACK_POSES: PoseTable = {
  fp_claws: {},
  hold: { arm_R: [-0.9, 0.15, 0], forearm_R: [-0.6, 0, 0] },
  grab: { torso: [0.3, 0.2, 0], arm_R: [-1.55, 0.2, 0], forearm_R: [-0.45, 0, 0], hand_R: [-0.5, 0, 0] },
  eat: {
    torso: [0.2, 0, 0],
    head: [0.3, 0, 0],
    jaw: [0.3, 0, 0],
    arm_L: [-1.55, -0.45, 0],
    arm_R: [-1.55, 0.45, 0],
    forearm_L: [-1.1, 0, 0],
    forearm_R: [-1.1, 0, 0],
  },
  brace: {
    torso: [0.38, 0, 0],
    neck: [0.2, 0, 0],
    head: [0.3, 0, 0],
    arm_L: [-1.25, -0.7, 0],
    arm_R: [-1.25, 0.7, 0],
    forearm_L: [-0.9, 0, 0],
    forearm_R: [-0.9, 0, 0],
  },
  throw_windup: { torso: [-0.25, -0.3, 0], arm_R: [-2.8, 0, -0.2], forearm_R: [-0.8, 0, 0] },
  throw_release: { torso: [0.3, 0.3, 0], arm_R: [-1.1, 0, 0], forearm_R: [-0.1, 0, 0] },
  swipe_hit: { torso: [0.25, 0.75, 0], head: [0, 0.2, 0], arm_R: [-1.25, 0.9, 0], forearm_R: [-0.15, 0, 0], hand_R: [-0.4, 0, 0] },
  // The stagger target is the same at every stage of the art: the stand-in uses it too.
  stagger: {
    torso: [-0.297, 0, 0],
    neck: [-0.192, 0, 0],
    head: [-0.349, 0, 0],
    jaw: [0.349, 0, 0],
    arm_L: [0.209, 0, 0.559],
    arm_R: [0.209, 0, -0.559],
    forearm_L: [-0.175, 0, 0],
    forearm_R: [-0.175, 0, 0],
    leg_L: [-0.14, 0, 0],
    leg_R: [0.175, 0, 0],
  },
};

/** Converts the manifest's `poses` (degrees) to radians; null when there are none. */
export function posesFromManifest(raw: unknown): PoseTable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: Record<string, Record<string, [number, number, number]>> = {};
  const D = Math.PI / 180;
  for (const [name, target] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof target !== 'object' || target === null) continue;
    const t: Record<string, [number, number, number]> = {};
    for (const [node, v] of Object.entries(target as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        t[node] = [v[0] * D, v[1] * D, v[2] * D];
      }
    }
    out[name] = t;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Built-in targets (radians) for the actions the art has no target for: the animator's own
// numbers, kept because they read well from outside.
const SWIPE_WINDUP: PoseTarget = { arm_R: [-2.3, -0.5, -0.5], forearm_R: [-0.3, 0, 0] };
const STOMP_WINDUP: PoseTarget = { arm_L: [-1.3, 0, 0.5], arm_R: [-1.3, 0, -0.5] };
const STOMP_SLAM: PoseTarget = { arm_L: [0.3, 0, 0], arm_R: [0.3, 0, 0] };
const ROAR_ARMS: PoseTarget = { arm_L: [0.2, 0, 0.85], arm_R: [0.2, 0, -0.85], forearm_L: [-0.5, 0, 0], forearm_R: [-0.5, 0, 0] };
const BEAM_BREATH: PoseTarget = { arm_L: [0.3, 0, 0], arm_R: [0.3, 0, 0] };
const BEAM_ON: PoseTarget = { arm_L: [0.25, 0, 0.3], arm_R: [0.25, 0, -0.3] };
const DEAD_ARMS: PoseTarget = { arm_L: [0.6, 0, 0.5], arm_R: [0.6, 0, -0.5] };
/** The charge: the arms tucked back along the flanks, elbows bent, like a sprinter's. */
const CHARGE_ARMS: PoseTarget = { arm_L: [0.65, 0, 0.12], arm_R: [0.65, 0, -0.12], forearm_L: [-0.85, 0, 0], forearm_R: [-0.85, 0, 0] };
/** The stumble: both arms thrown forward and out to catch the fall. */
const STUMBLE_ARMS: PoseTarget = { arm_L: [-1.25, 0, 0.75], arm_R: [-1.05, 0, -0.85], forearm_L: [-0.25, 0, 0], forearm_R: [-0.35, 0, 0], hand_L: [-0.4, 0, 0], hand_R: [-0.4, 0, 0] };
/** The tail sweep: the arms out a little for balance. */
const SWEEP_ARMS: PoseTarget = { arm_L: [-0.35, 0, 0.45], arm_R: [-0.35, 0, -0.45] };
const EMPTY: PoseTarget = {};

const ARM_NODES = ['arm_L', 'forearm_L', 'hand_L', 'arm_R', 'forearm_R', 'hand_R'] as const;
function armSide(name: string): 0 | 1 | -1 {
  if (name === 'arm_L' || name === 'forearm_L' || name === 'hand_L') return 0;
  if (name === 'arm_R' || name === 'forearm_R' || name === 'hand_R') return 1;
  return -1;
}

export interface NodePose {
  x: number;
  y: number;
  z: number;
}

export interface KaijuPose {
  rotations: Map<string, NodePose>;
  /** Vertical offset of the hips, meters. */
  hipsLift: number;
  /** How quickly the rig should ease toward this pose, 1/seconds (attacks snap, idling drifts). */
  stiffness: number;
  /** The jaw is wide open (roar, beam). */
  jawOpen: number;
}

const NODES = [
  'hips',
  'torso',
  'neck',
  'head',
  'jaw',
  'arm_L',
  'forearm_L',
  'hand_L',
  'arm_R',
  'forearm_R',
  'hand_R',
  'leg_L',
  'shin_L',
  'foot_L',
  'leg_R',
  'shin_R',
  'foot_R',
  'tail_1',
  'tail_2',
  'tail_3',
  'tail_4',
  'tail_5',
] as const;

export function createKaijuPose(): KaijuPose {
  const rotations = new Map<string, NodePose>();
  for (const name of NODES) rotations.set(name, { x: 0, y: 0, z: 0 });
  return { rotations, hipsLift: 0, stiffness: 12, jawOpen: 0 };
}

/** Accumulated arm angles of the actions of one frame (see `computeKaijuPose`). */
const armSum = new Map<string, { x: number; y: number; z: number }>(ARM_NODES.map((n) => [n, { x: 0, y: 0, z: 0 }]));
const armTaken = [0, 0];

/**
 * Fills `pose` for the given state.
 *
 * The arms follow one rule (docs/art/client-notes-kaiju-lizard.md section 4): each arm has a
 * base pose (the right arm `hold` when something is in the hand; both arms `fp_claws` in the
 * first-person view; else the rest pose) and the actions blend targets over it with a weight.
 * For the body nodes a target names, `angle * w` is added to what is there (walk, breathing,
 * look); the arm nodes are `accumulated + base * max(0, 1 - weight taken by that arm)`.
 */
export function computeKaijuPose(input: KaijuAnimInput, pose: KaijuPose): KaijuPose {
  for (const r of pose.rotations.values()) {
    r.x = 0;
    r.y = 0;
    r.z = 0;
  }
  pose.hipsLift = 0;
  pose.stiffness = 12;
  pose.jawOpen = 0;
  const R = (name: string): NodePose => pose.rotations.get(name) as NodePose;
  const add = (name: string, x: number, y = 0, z = 0): void => {
    const r = pose.rotations.get(name);
    if (!r) return;
    r.x += x;
    r.y += y;
    r.z += z;
  };
  for (const a of armSum.values()) {
    a.x = 0;
    a.y = 0;
    a.z = 0;
  }
  armTaken[0] = 0;
  armTaken[1] = 0;
  /** Blends a target in with weight `w`. */
  const act = (target: PoseTarget | undefined, w: number): void => {
    if (!target || w <= 0) return;
    let left = false;
    let right = false;
    for (const name in target) {
      const v = target[name];
      const side = armSide(name);
      if (side < 0) {
        add(name, v[0] * w, v[1] * w, v[2] * w);
        continue;
      }
      const a = armSum.get(name) as NodePose;
      a.x += v[0] * w;
      a.y += v[1] * w;
      a.z += v[2] * w;
      if (side === 0) left = true;
      else right = true;
    }
    if (left) armTaken[0] += w;
    if (right) armTaken[1] += w;
  };

  const P = input.poses ?? FALLBACK_POSES;
  const { time, phase, action } = input;
  const t = input.phaseTime;
  const u = input.phaseDuration > 0 ? clamp01(t / input.phaseDuration) : 0;
  const ease = smoothstep(u);
  const helpless = phase === 'stagger' || phase === 'dead' || phase === 'cocoon';
  const assembly = input.firstPerson === true && phase !== 'dead' && phase !== 'cocoon';

  // --- idle: breathing and a slow tail --------------------------------------------------------
  add('torso', Math.sin(time * 1.6) * 0.025);
  for (let i = 1; i <= 5; i++) add(`tail_${i}`, 0, Math.sin(time * 1.1 - i * 0.7) * 0.07);

  // --- walk -----------------------------------------------------------------------------------
  // In a charge's run the stride is longer and the body pounds up and down (it runs at twice
  // its walking speed, so the cycle, driven by the real speed, also comes twice as fast).
  const running = action === 'charge' && phase === 'charge';
  const m = helpless ? 0 : clamp01(input.speed);
  const stride = running ? 1.45 : 1;
  let swing = 0;
  if (m > 0.01) {
    const w = input.walkPhase;
    const s = Math.sin(w);
    const c = Math.cos(w);
    add('leg_L', -s * 0.62 * m * stride);
    add('leg_R', s * 0.62 * m * stride);
    add('shin_L', Math.max(0, c) * 0.75 * m * stride);
    add('shin_R', Math.max(0, -c) * 0.75 * m * stride);
    add('foot_L', -Math.max(0, c) * 0.3 * m);
    add('foot_R', -Math.max(0, -c) * 0.3 * m);
    add('hips', 0, s * 0.06 * m, c * 0.05 * m * stride);
    add('torso', 0.08 * m, -s * 0.09 * m, -c * 0.04 * m * stride);
    // Close to the lens a claw swings far across the frame: a calm bob in first person.
    swing = s * (assembly ? 0.03 : 0.3) * m * (running ? 0.4 : 1);
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, 0, Math.sin(w - i * 0.8) * 0.13 * m);
    pose.hipsLift += Math.abs(c) * (running ? 0.045 : 0.018) * input.height * m;
  }

  // --- head: leads the body, looks where the player looks --------------------------------------
  // (In the first-person view the head is locked to the aim afterwards, by the view.)
  if (!helpless) {
    const yaw = clamp(input.headYaw, -1, 1);
    const pitch = clamp(input.headPitch, -0.7, 0.7);
    add('neck', -pitch * 0.35, yaw * 0.4);
    add('head', -pitch * 0.45, yaw * 0.6);
    add('torso', 0, yaw * 0.12);
  }

  // --- actions --------------------------------------------------------------------------------
  const acting = phase !== 'idle';
  if (acting) pose.stiffness = 22;

  if (phase === 'stagger') {
    // Reeling back with the chest (the weak point) open to the front.
    pose.stiffness = 8;
    pose.hipsLift -= 0.05 * input.height;
    act(P.stagger, 1);
    add('torso', 0, 0, Math.sin(time * 2.6) * 0.12);
    add('head', 0, Math.sin(time * 2.1) * 0.25);
    pose.jawOpen = 0.3;
  } else if (phase === 'dead') {
    pose.stiffness = 5;
    add('torso', 0.7);
    add('head', 0.6);
    add('jaw', 0.5);
    act(DEAD_ARMS, 1);
  } else if (phase === 'brace' || action === 'brace') {
    // Crouched behind crossed arms.
    pose.hipsLift -= 0.07 * input.height;
    act(P.brace, 1);
    add('leg_L', -0.25);
    add('leg_R', -0.25);
    add('shin_L', 0.45);
    add('shin_R', 0.45);
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.06);
  } else if (action === 'swipe') {
    // Wind-up: the right claw goes up and back with the torso; active: it rakes across.
    const w = phase === 'windup' ? ease : phase === 'active' ? 1 : 0;
    const a = phase === 'active' ? ease : phase === 'recover' ? 1 - ease : 0;
    const back = phase === 'recover' ? 0 : w * (1 - a);
    add('torso', -0.1 * back, -0.6 * back);
    add('hips', 0, -0.15 * back + 0.2 * a);
    if (!assembly) add('arm_L', 0.3 * back);
    act(SWIPE_WINDUP, back);
    act(P.swipe_hit, a);
  } else if (action === 'stomp') {
    // Wind-up: rear up with the right leg raised; active: slam it down; recover: settle.
    const w = phase === 'windup' ? ease : 0;
    const a = phase === 'active' ? 1 : phase === 'recover' ? 1 - ease : 0;
    pose.hipsLift += (0.07 * w - 0.06 * a) * input.height;
    add('torso', -0.3 * w + 0.4 * a);
    add('leg_R', -1.25 * w + 0.15 * a);
    add('shin_R', 1.3 * w);
    add('head', -0.2 * w + 0.3 * a);
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.1 * w + 0.08 * a);
    act(STOMP_WINDUP, w);
    act(STOMP_SLAM, a);
  } else if (action === 'grab') {
    const w = phase === 'windup' || phase === 'active' ? ease : 1 - ease;
    act(P.grab, w);
  } else if (action === 'throw') {
    // Cock the arm, then whip it forward.
    const w = phase === 'windup' ? ease : 0;
    const a = phase === 'recover' || phase === 'active' ? 1 - ease : 0;
    act(P.throw_windup, w);
    act(P.throw_release, a);
  } else if (phase === 'eat' || action === 'eat') {
    const chew = Math.sin(t * 11);
    act(P.eat, 1);
    add('head', chew * 0.08);
    add('jaw', chew * 0.25);
    pose.jawOpen = 0.4;
  } else if (phase === 'roar' || action === 'roar') {
    // Rear back, throw the arms wide, head up, jaw open, the whole body shaking.
    const swell = Math.sin(clamp01(u) * Math.PI);
    const shake = Math.sin(t * 46) * 0.035;
    add('torso', -0.35 * swell, 0, shake);
    add('neck', -0.25 * swell);
    add('head', -0.45 * swell, shake * 2, shake);
    add('jaw', 0.75 * Math.min(1, swell * 2.5));
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.07 * swell);
    act(ROAR_ARMS, swell);
    pose.jawOpen = Math.min(1, swell * 2.5);
  } else if (action === 'special') {
    // Wind-up: a deep breath, leaning back; active: head thrust forward, jaw wide, recoil shake.
    const w = phase === 'windup' ? ease : 0;
    const on = phase === 'special' || phase === 'active' ? 1 : 0;
    const r = phase === 'recover' ? 1 - ease : 0;
    const shake = on * Math.sin(t * 60) * 0.02;
    add('torso', -0.32 * w + 0.18 * on + 0.1 * r, 0, shake);
    add('neck', -0.25 * w + 0.1 * on);
    add('head', -0.3 * w + shake);
    add('jaw', 0.25 * w + 0.8 * on + 0.3 * r);
    act(BEAM_BREATH, w);
    act(BEAM_ON, on);
    pose.hipsLift -= 0.03 * on * input.height;
    pose.jawOpen = Math.max(0.3 * w, on);
  } else if (action === 'charge') {
    // Seen from inside the head the lean is kept small: the camera rides the head.
    const lean = assembly ? 0.35 : 1;
    if (phase === 'windup') {
      // The bull before the rush: shoulders low, head down, a foot scraping the ground, the
      // tail up and stiff.
      const w = ease;
      const paw = Math.sin(t * 15);
      pose.hipsLift -= 0.07 * w * input.height;
      add('torso', 0.34 * w * lean);
      add('neck', 0.2 * w * lean);
      add('head', 0.32 * w * lean);
      add('jaw', 0.08 * w);
      add('leg_R', (-0.3 + paw * 0.35) * w);
      add('shin_R', (0.5 + Math.max(0, paw) * 0.35) * w);
      add('leg_L', 0.15 * w);
      add('shin_L', 0.25 * w);
      for (let i = 1; i <= 5; i++) add(`tail_${i}`, 0.08 * w);
      act(CHARGE_ARMS, w);
    } else if (phase === 'charge') {
      // The run: low and forward, the head down like a ram, the tail straight out behind.
      pose.hipsLift -= 0.03 * input.height;
      add('torso', 0.44 * lean);
      add('neck', 0.14 * lean);
      add('head', 0.28 * lean);
      for (let i = 1; i <= 5; i++) add(`tail_${i}`, 0.1);
      act(CHARGE_ARMS, 1);
    } else if (phase === 'stumble') {
      // The stumble: it pitches forward and lurches to one side, a knee buckling, arms thrown
      // out to catch itself, then wobbles back up shaking its head.
      const lurch = u < 0.3 ? smoothstep(u / 0.3) : 1 - smoothstep((u - 0.3) / 0.7);
      const wobble = Math.sin(t * 13) * (1 - u) * 0.22;
      pose.stiffness = 14;
      pose.hipsLift -= 0.1 * lurch * input.height;
      add('torso', 0.6 * lurch * lean, wobble, (0.24 * lurch + wobble * 0.5) * lean);
      add('neck', 0.25 * lurch * lean, wobble);
      add('head', 0.3 * lurch, wobble * 1.6, -0.22 * lurch);
      add('jaw', 0.35 * lurch);
      add('leg_L', -0.6 * lurch);
      add('shin_L', 1.0 * lurch);
      add('leg_R', 0.3 * lurch);
      for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.1 * lurch, wobble * 0.6);
      act(STUMBLE_ARMS, lurch);
      pose.jawOpen = 0.3 * lurch;
    }
  } else if (action === 'tailSweep') {
    // Wind-up: the hips coil and the tail is drawn round to the right; active: the hips whip
    // back and the tail lashes across behind, to the left; recover: it settles. The legs turn
    // against the hips so the feet stay planted.
    let coil = 0;
    let lash = 0;
    if (phase === 'windup') coil = ease;
    else if (phase === 'active') {
      coil = 1 - ease;
      lash = ease;
    } else if (phase === 'recover') lash = 1 - ease;
    pose.stiffness = 30;
    const hipsYaw = 0.25 * coil - 0.35 * lash;
    add('hips', 0, hipsYaw);
    add('leg_L', 0, -hipsYaw);
    add('leg_R', 0, -hipsYaw);
    add('torso', -0.06 * coil, -0.2 * coil + 0.18 * lash, 0.05 * lash);
    add('head', 0, -0.25 * coil + 0.2 * lash);
    add('tail_1', 0.04 * coil, 0.32 * coil - 0.48 * lash);
    for (let i = 2; i <= 5; i++) add(`tail_${i}`, 0.03 * coil, 0.16 * coil - 0.24 * lash);
    act(SWEEP_ARMS, Math.max(coil, lash));
  }

  // --- the arms: what the actions took, over each arm's base pose ------------------------------
  const claws = assembly ? P.fp_claws ?? EMPTY : EMPTY;
  const baseR = input.holding ? P.hold ?? EMPTY : claws;
  const baseL = claws;
  for (const name of ARM_NODES) {
    const side = armSide(name);
    const base = (side === 0 ? baseL : baseR)[name];
    const keep = Math.max(0, 1 - armTaken[side]);
    const a = armSum.get(name) as NodePose;
    const r = R(name);
    r.x += a.x + (base ? base[0] * keep : 0);
    r.y += a.y + (base ? base[1] * keep : 0);
    r.z += a.z + (base ? base[2] * keep : 0);
  }
  add('arm_L', swing);
  if (!input.holding) add('arm_R', -swing);
  return pose;
}
