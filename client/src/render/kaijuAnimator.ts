/**
 * Procedural animation of the lizard rig, driven entirely by the kaiju's action state
 * (ARCHITECTURE.md section 5): a walk cycle from its speed, the head leading the body, and a
 * pose for every wind-up, active and recovery phase, the brace, the roar, the stagger and the
 * beam. The wind-ups are the tells the humans read, so each one is a distinct silhouette.
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

/** Fills `pose` for the given state. */
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
    const r = R(name);
    r.x += x;
    r.y += y;
    r.z += z;
  };

  const { time, phase, action } = input;
  const t = input.phaseTime;
  const u = input.phaseDuration > 0 ? clamp01(t / input.phaseDuration) : 0;
  const ease = smoothstep(u);
  const helpless = phase === 'stagger' || phase === 'dead' || phase === 'cocoon';

  // --- idle: breathing and a slow tail --------------------------------------------------------
  add('torso', Math.sin(time * 1.6) * 0.025);
  for (let i = 1; i <= 5; i++) add(`tail_${i}`, 0, Math.sin(time * 1.1 - i * 0.7) * 0.07);

  // --- walk -----------------------------------------------------------------------------------
  const m = helpless ? 0 : clamp01(input.speed);
  if (m > 0.01) {
    const w = input.walkPhase;
    const s = Math.sin(w);
    const c = Math.cos(w);
    add('leg_L', -s * 0.62 * m);
    add('leg_R', s * 0.62 * m);
    add('shin_L', Math.max(0, c) * 0.75 * m);
    add('shin_R', Math.max(0, -c) * 0.75 * m);
    add('foot_L', -Math.max(0, c) * 0.3 * m);
    add('foot_R', -Math.max(0, -c) * 0.3 * m);
    add('hips', 0, s * 0.06 * m, c * 0.05 * m);
    add('torso', 0.08 * m, -s * 0.09 * m, -c * 0.04 * m);
    add('arm_L', s * 0.3 * m);
    add('arm_R', -s * 0.3 * m);
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, 0, Math.sin(w - i * 0.8) * 0.13 * m);
    pose.hipsLift += Math.abs(c) * 0.018 * input.height * m;
  }

  // --- head: leads the body, looks where the player looks --------------------------------------
  if (!helpless) {
    const yaw = clamp(input.headYaw, -1, 1);
    const pitch = clamp(input.headPitch, -0.7, 0.7);
    add('neck', -pitch * 0.35, yaw * 0.4);
    add('head', -pitch * 0.45, yaw * 0.6);
    add('torso', 0, yaw * 0.12);
  }

  // --- held object: the right arm carries it in front ------------------------------------------
  if (input.holding && phase === 'idle') {
    add('arm_R', -0.9, 0.15);
    add('forearm_R', -0.6);
  }

  // --- actions --------------------------------------------------------------------------------
  const acting = phase !== 'idle';
  if (acting) pose.stiffness = 22;

  if (phase === 'stagger') {
    // Slumped and swaying, chest (the weak point) pushed forward.
    pose.stiffness = 8;
    pose.hipsLift -= 0.05 * input.height;
    add('torso', 0.45, 0, Math.sin(time * 2.6) * 0.12);
    add('neck', 0.3);
    add('head', 0.45, Math.sin(time * 2.1) * 0.25);
    add('jaw', 0.35);
    add('arm_L', 0.35, 0, 0.25);
    add('arm_R', 0.35, 0, -0.25);
    add('forearm_L', 0.3);
    add('forearm_R', 0.3);
    add('leg_L', -0.15);
    add('leg_R', 0.2);
    pose.jawOpen = 0.3;
  } else if (phase === 'dead') {
    pose.stiffness = 5;
    add('torso', 0.7);
    add('head', 0.6);
    add('arm_L', 0.6, 0, 0.5);
    add('arm_R', 0.6, 0, -0.5);
    add('jaw', 0.5);
  } else if (phase === 'brace' || action === 'brace') {
    // Crouched behind crossed arms.
    pose.hipsLift -= 0.07 * input.height;
    add('torso', 0.38);
    add('neck', 0.2);
    add('head', 0.3);
    add('arm_L', -1.25, -0.7);
    add('arm_R', -1.25, 0.7);
    add('forearm_L', -0.9);
    add('forearm_R', -0.9);
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
    add('torso', -0.1 * back + 0.25 * a, -0.6 * back + 0.75 * a);
    add('arm_R', -2.3 * back - 1.25 * a, -0.5 * back + 0.9 * a, -0.5 * back);
    add('forearm_R', -0.3 * back - 0.15 * a);
    add('hand_R', -0.4 * a);
    add('arm_L', 0.3 * back);
    add('head', 0, 0.2 * a);
    add('hips', 0, -0.15 * back + 0.2 * a);
  } else if (action === 'stomp') {
    // Wind-up: rear up with the right leg raised; active: slam it down; recover: settle.
    const w = phase === 'windup' ? ease : 0;
    const a = phase === 'active' ? 1 : phase === 'recover' ? 1 - ease : 0;
    pose.hipsLift += (0.07 * w - 0.06 * a) * input.height;
    add('torso', -0.3 * w + 0.4 * a);
    add('leg_R', -1.25 * w + 0.15 * a);
    add('shin_R', 1.3 * w);
    add('arm_L', -1.3 * w + 0.3 * a, 0, 0.5 * w);
    add('arm_R', -1.3 * w + 0.3 * a, 0, -0.5 * w);
    add('head', -0.2 * w + 0.3 * a);
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.1 * w + 0.08 * a);
  } else if (action === 'grab') {
    const w = phase === 'windup' || phase === 'active' ? ease : 1 - ease;
    add('torso', 0.3 * w, 0.2 * w);
    add('arm_R', -1.55 * w, 0.2 * w);
    add('forearm_R', -0.45 * w);
    add('hand_R', -0.5 * w);
  } else if (action === 'throw') {
    // Cock the arm overhead, then whip it forward.
    const w = phase === 'windup' ? ease : 0;
    const a = phase === 'recover' || phase === 'active' ? 1 - ease : 0;
    add('torso', -0.25 * w + 0.3 * a, -0.3 * w + 0.3 * a);
    add('arm_R', -2.8 * w - 1.1 * a, 0, -0.2 * w);
    add('forearm_R', -0.8 * w - 0.1 * a);
  } else if (phase === 'eat' || action === 'eat') {
    const chew = Math.sin(t * 11);
    add('torso', 0.2);
    add('arm_L', -1.55, -0.45);
    add('arm_R', -1.55, 0.45);
    add('forearm_L', -1.1);
    add('forearm_R', -1.1);
    add('head', 0.3 + chew * 0.08);
    add('jaw', 0.3 + chew * 0.25);
    pose.jawOpen = 0.4;
  } else if (phase === 'roar' || action === 'roar') {
    // Rear back, throw the arms wide, head up, jaw open, the whole body shaking.
    const swell = Math.sin(clamp01(u) * Math.PI);
    const shake = Math.sin(t * 46) * 0.035;
    add('torso', -0.35 * swell, 0, shake);
    add('neck', -0.25 * swell);
    add('head', -0.45 * swell, shake * 2, shake);
    add('jaw', 0.75 * Math.min(1, swell * 2.5));
    add('arm_L', 0.2 * swell, 0, 0.85 * swell);
    add('arm_R', 0.2 * swell, 0, -0.85 * swell);
    add('forearm_L', -0.5 * swell);
    add('forearm_R', -0.5 * swell);
    for (let i = 1; i <= 5; i++) add(`tail_${i}`, -0.07 * swell);
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
    add('arm_L', 0.3 * w + 0.25 * on, 0, 0.3 * on);
    add('arm_R', 0.3 * w + 0.25 * on, 0, -0.3 * on);
    pose.hipsLift -= 0.03 * on * input.height;
    pose.jawOpen = Math.max(0.3 * w, on);
  }
  return pose;
}
