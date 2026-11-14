/**
 * Procedural animation of the lizard rig, driven entirely by the kaiju's action state
 * (ARCHITECTURE.md section 5): a walk cycle from its speed, the head leading the body, and a
 * pose for every wind-up, active and recovery phase, the brace, the roar, the stagger, the
 * beam, the charge (the head-down wind-up, the run with its longer, pounding stride, the
 * stumble), the tail sweep, the fast-food sign's club swing and the flinch when a propane tank
 * goes off in the hand. The wind-ups are the tells the humans read, so each one is a distinct
 * silhouette.
 *
 * Each attack has two or three looks (docs/ROADMAP.md phase 3; a look only: the simulation's
 * hit areas and timings are the same for all of them). Which one a screen shows is
 * `attackVariant` of the tick the attack began, so every screen shows the same one. A look not
 * known yet (the local player's press shown ahead of the server) starts with what all the
 * looks of that attack share, and the rest follows as soon as the server's word arrives.
 *
 *   swipe      0 the right claw slashes across; 1 the left claw does (mirrored); 2 both claws
 *              rake down together
 *   stomp      0 the right foot; 1 the left foot (mirrored); 2 a crouch, a hop and a landing on
 *              both feet
 *   tailSweep  0 coiled to the right, lashed to the left; 1 the other way round (mirrored)
 *   throw      0 overhand; 1 sidearm
 *   roar       0 head thrown up, arms wide; 1 head low and forward, arms spread low
 *   charge     the stumble it ends in: 0 pitching forward onto a knee; 1 spinning out to the
 *              side; 2 sitting down hard on its tail
 *   club       0 a forehand swing across the front; 1 a backhand; 2 an overhead smash
 *
 * The output is a set of rotations (radians, relative to the rest pose) for named nodes; the
 * view eases the rig toward them. Rotation signs (tools/art/README.md section 8): x positive is
 * nose down / swing back, y positive turns to the model's left, z positive rolls the left side up.
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
  /**
   * Which look of the attack (`attackVariant`; for the charge, the look of its stumble).
   * Undefined is the first look; null is a look not known yet: the parts of a wind-up that tell
   * the looks apart wait for it.
   */
  variant?: number | null;
  /**
   * Seconds since the hand closed on a handful of civilians (render/crowd.ts, client only), while
   * it lifts them to the mouth and gulps them down (`SNACK_TIME`); null or undefined for none.
   */
  snack?: number | null;
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

// ---------------------------------------------------------------------------------------------
// Which look
// ---------------------------------------------------------------------------------------------

/** How many looks each attack has (the charge: its stumble). Everything else has one. */
export const ATTACK_VARIANTS: Readonly<Partial<Record<KaijuActionId, number>>> = {
  swipe: 3,
  stomp: 3,
  tailSweep: 2,
  throw: 2,
  roar: 2,
  charge: 3,
  club: 3,
};

/**
 * Which look an attack takes: a pure function of the tick its phase began (the same on every
 * screen: the snapshot's tick less its phase time, or the `kaijuAction` event's tick) and the
 * kaiju, so all screens show the same one. For the charge, `tick` is where its stumble began.
 */
export function attackVariant(action: KaijuActionId, tick: number, kaiju = 0): number {
  const n = ATTACK_VARIANTS[action] ?? 1;
  if (n <= 1) return 0;
  // An integer hash (the same on every engine): neighboring ticks give unrelated looks.
  let h = Math.imul((tick | 0) ^ 0x2545f491, 0x9e3779b1) ^ Math.imul((kaiju | 0) + 1, 0x85ebca6b) ^ (action.length * 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) % n;
}

/** How long the hand takes to bring a handful of civilians to the mouth and gulp them down (seconds). */
export const SNACK_TIME = 1.25;
/** When, within it, the jaws close on them (the puff and the gulp). */
export const SNACK_GULP = 0.72;

// ---------------------------------------------------------------------------------------------
// Built-in targets (radians) for the actions the art has no target for: the animator's own
// numbers, kept because they read well from outside.
// ---------------------------------------------------------------------------------------------

const SWIPE_WINDUP: PoseTarget = { arm_R: [-2.3, -0.5, -0.5], forearm_R: [-0.3, 0, 0] };
/** The swipe's look not known yet (the local press): both arms on the way up. */
const SWIPE_RAISE: PoseTarget = { arm_L: [-1.1, 0, 0.25], arm_R: [-1.1, 0, -0.25], forearm_L: [-0.3, 0, 0], forearm_R: [-0.3, 0, 0] };
/** The two-claw rake: both arms high overhead (then `derived(P).rakeHit`). */
const RAKE_WINDUP: PoseTarget = { arm_L: [-2.45, 0.25, 0.4], arm_R: [-2.45, -0.25, -0.4], forearm_L: [-0.45, 0, 0], forearm_R: [-0.45, 0, 0] };
const STOMP_WINDUP: PoseTarget = { arm_L: [-1.3, 0, 0.5], arm_R: [-1.3, 0, -0.5] };
const STOMP_SLAM: PoseTarget = { arm_L: [0.3, 0, 0], arm_R: [0.3, 0, 0] };
/** The hop: arms swung back as it crouches. */
const HOP_ARMS_BACK: PoseTarget = { arm_L: [0.75, 0, 0.3], arm_R: [0.75, 0, -0.3], forearm_L: [-0.4, 0, 0], forearm_R: [-0.4, 0, 0] };
const ROAR_ARMS: PoseTarget = { arm_L: [0.2, 0, 0.85], arm_R: [0.2, 0, -0.85], forearm_L: [-0.5, 0, 0], forearm_R: [-0.5, 0, 0] };
/** The low roar: arms spread wide and low, claws open, as it bellows at the ground ahead. */
const ROAR_LOW_ARMS: PoseTarget = { arm_L: [-0.35, 0, 1.05], arm_R: [-0.35, 0, -1.05], forearm_L: [-0.55, 0, 0], forearm_R: [-0.55, 0, 0], hand_L: [0, 0, 0.35], hand_R: [0, 0, -0.35] };
const BEAM_BREATH: PoseTarget = { arm_L: [0.3, 0, 0], arm_R: [0.3, 0, 0] };
const BEAM_ON: PoseTarget = { arm_L: [0.25, 0, 0.3], arm_R: [0.25, 0, -0.3] };
const DEAD_ARMS: PoseTarget = { arm_L: [0.6, 0, 0.5], arm_R: [0.6, 0, -0.5] };
/** The charge: the arms tucked back along the flanks, elbows bent, like a sprinter's. */
const CHARGE_ARMS: PoseTarget = { arm_L: [0.65, 0, 0.12], arm_R: [0.65, 0, -0.12], forearm_L: [-0.85, 0, 0], forearm_R: [-0.85, 0, 0] };
/** The stumble: both arms thrown forward and out to catch the fall. */
const STUMBLE_ARMS: PoseTarget = { arm_L: [-1.25, 0, 0.75], arm_R: [-1.05, 0, -0.85], forearm_L: [-0.25, 0, 0], forearm_R: [-0.35, 0, 0], hand_L: [-0.4, 0, 0], hand_R: [-0.4, 0, 0] };
/** Spinning out: one arm flung up, the other out wide. */
const SPIN_ARMS: PoseTarget = { arm_L: [-2.0, 0, 0.55], arm_R: [-0.35, 0, -1.25], forearm_L: [-0.3, 0, 0], forearm_R: [-0.2, 0, 0] };
/** Sitting down hard: both arms thrown up. */
const SIT_ARMS: PoseTarget = { arm_L: [-2.05, 0, 0.6], arm_R: [-2.05, 0, -0.6], forearm_L: [-0.45, 0, 0], forearm_R: [-0.45, 0, 0], hand_L: [0.3, 0, 0], hand_R: [0.3, 0, 0] };
/** The tail sweep: the arms out a little for balance. */
const SWEEP_ARMS: PoseTarget = { arm_L: [-0.35, 0, 0.45], arm_R: [-0.35, 0, -0.45] };
/** The sidearm throw: the arm drawn back out at the side at shoulder height (then `derived(P).sideRelease`). */
const SIDE_WINDUP: PoseTarget = { torso: [-0.05, -0.7, 0.08], arm_R: [-1.05, -0.65, -1.0], forearm_R: [-0.85, 0.25, 0], hand_R: [0.15, 0, 0] };
/** The club's backhand (cocked by `derived(P).backhandCock`), swung out to the right. */
const BACKHAND_HIT: PoseTarget = { torso: [0.15, -0.55, 0], arm_R: [-1.3, -0.65, -0.95], forearm_R: [-0.15, 0, 0], hand_R: [0, 0, -0.3] };
/** The club's overhead smash: the sign raised straight up behind the head (then `derived(P).overheadHit`). */
const OVERHEAD_COCK: PoseTarget = { torso: [-0.28, 0, 0], arm_R: [-2.75, -0.1, -0.15], forearm_R: [-0.75, 0, 0] };
/**
 * The flinch (a propane tank went off in the hand): the burnt right hand flung out and back,
 * the left arm up across the face.
 */
const FLINCH_ARMS: PoseTarget = { arm_R: [0.45, 0, -1.05], forearm_R: [-0.3, 0, 0], hand_R: [-0.6, 0, 0], arm_L: [-1.45, -0.35, 0.35], forearm_L: [-1.2, 0, 0] };
const EMPTY: PoseTarget = {};

/**
 * Targets made from the art's own (`P`, per stage), for the strikes that end where the art has
 * already checked a hand is clear of the head and shows in the first-person frame
 * (tools/art/kaiju/poses.py): generic angles put this character's claws through its jaw.
 */
interface Derived {
  /** The two-claw rake ends with both claws reaching low in front: the grab, and its mirror. */
  rakeHit: PoseTarget;
  /** The sidearm throw lets go where the overhand does, the body turned further round. */
  sideRelease: PoseTarget;
  /** The club's backhand is cocked with the right arm across the face, as in the brace. */
  backhandCock: PoseTarget;
  /** The club's overhead smash comes down where the grab reaches. */
  overheadHit: PoseTarget;
}
const RIGHT_ARM = ['arm_R', 'forearm_R', 'hand_R'] as const;
/** How much wider (radians, turned and rolled out) each claw ends in the two-claw rake than in the grab. */
const RAKE_SPREAD = 0.2;
const derivedCache = new WeakMap<PoseTable, Derived>();

function derived(P: PoseTable): Derived {
  let d = derivedCache.get(P);
  if (d) return d;
  const right = (t: PoseTarget | undefined, out: Record<string, readonly [number, number, number]>): void => {
    for (const n of RIGHT_ARM) {
      const v = t?.[n];
      if (v) out[n] = v;
    }
  };
  const rakeHit: Record<string, readonly [number, number, number]> = { torso: [0.32, 0, 0], head: [0.08, 0, 0] };
  right(P.grab, rakeHit);
  // (Each claw a little wider than the grab's, so the two do not meet in the middle.)
  const arm = rakeHit.arm_R;
  if (arm) rakeHit.arm_R = [arm[0], arm[1] - RAKE_SPREAD, arm[2] - RAKE_SPREAD];
  for (const n of RIGHT_ARM) {
    const v = rakeHit[n];
    if (v) rakeHit[twin(n)] = [v[0], -v[1], -v[2]];
  }
  const sideRelease: Record<string, readonly [number, number, number]> = { torso: [0.2, 0.62, -0.06] };
  right(P.throw_release, sideRelease);
  const backhandCock: Record<string, readonly [number, number, number]> = { torso: [-0.08, 0.5, 0] };
  right(P.brace, backhandCock);
  const overheadHit: Record<string, readonly [number, number, number]> = { torso: [0.38, 0.05, 0], head: [0.1, 0, 0] };
  right(P.grab, overheadHit);
  d = { rakeHit, sideRelease, backhandCock, overheadHit };
  derivedCache.set(P, d);
  return d;
}

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

/** The node on the other side (arm_L and arm_R, ...); a node on the middle line is its own. */
function twin(name: string): string {
  if (name.endsWith('_L')) return `${name.slice(0, -2)}_R`;
  if (name.endsWith('_R')) return `${name.slice(0, -2)}_L`;
  return name;
}

export function createKaijuPose(): KaijuPose {
  const rotations = new Map<string, NodePose>();
  for (const name of NODES) rotations.set(name, { x: 0, y: 0, z: 0 });
  return { rotations, hipsLift: 0, stiffness: 12, jawOpen: 0 };
}

/**
 * The action's own part of one frame's pose (see `computeKaijuPose`), kept apart from walking,
 * breathing and the look so that a mirrored look can turn just that part over.
 */
const layer = new Map<string, NodePose>(NODES.map((n) => [n, { x: 0, y: 0, z: 0 }]));
/** Accumulated arm angles of the actions of one frame, and the weight each arm has given them. */
const armSum = new Map<string, NodePose>(ARM_NODES.map((n) => [n, { x: 0, y: 0, z: 0 }]));
const armTaken = [0, 0];
const swapTmp: NodePose = { x: 0, y: 0, z: 0 };

/** Turns the action's layer over: left and right swapped, every turn and roll the other way. */
function mirrorLayer(): void {
  for (const map of [layer, armSum]) {
    const seen = new Set<string>();
    for (const [name, r] of map) {
      if (seen.has(name)) continue;
      const other = twin(name);
      const o = map.get(other);
      seen.add(name);
      seen.add(other);
      if (!o || o === r) {
        r.y = -r.y;
        r.z = -r.z;
        continue;
      }
      swapTmp.x = r.x;
      swapTmp.y = r.y;
      swapTmp.z = r.z;
      r.x = o.x;
      r.y = -o.y;
      r.z = -o.z;
      o.x = swapTmp.x;
      o.y = -swapTmp.y;
      o.z = -swapTmp.z;
    }
  }
  const t = armTaken[0];
  armTaken[0] = armTaken[1];
  armTaken[1] = t;
}

/** Whether a look is turned over (left for right) from the first one. */
function mirrored(action: KaijuActionId, variant: number | null): boolean {
  if (variant !== 1) return false;
  return action === 'swipe' || action === 'stomp' || action === 'tailSweep';
}

/** 0 before `from`, 1 after `to`, smooth between. */
function ramp(u: number, from: number, to: number): number {
  return smoothstep(clamp01((u - from) / (to - from)));
}

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
  for (const r of layer.values()) {
    r.x = 0;
    r.y = 0;
    r.z = 0;
  }
  for (const a of armSum.values()) {
    a.x = 0;
    a.y = 0;
    a.z = 0;
  }
  armTaken[0] = 0;
  armTaken[1] = 0;
  pose.hipsLift = 0;
  pose.stiffness = 12;
  pose.jawOpen = 0;
  const R = (name: string): NodePose => pose.rotations.get(name) as NodePose;
  /** Walking, breathing, the look: never mirrored. */
  const add = (name: string, x: number, y = 0, z = 0): void => {
    const r = pose.rotations.get(name);
    if (!r) return;
    r.x += x;
    r.y += y;
    r.z += z;
  };
  /** The action's own motion (mirrored with its look). */
  const addA = (name: string, x: number, y = 0, z = 0): void => {
    const r = layer.get(name);
    if (!r) return;
    r.x += x;
    r.y += y;
    r.z += z;
  };
  /** Blends a target in with weight `w`. */
  const act = (target: PoseTarget | undefined, w: number): void => {
    if (!target || w <= 0) return;
    let left = false;
    let right = false;
    for (const name in target) {
      const v = target[name];
      const side = armSide(name);
      if (side < 0) {
        addA(name, v[0] * w, v[1] * w, v[2] * w);
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
  const variant = input.variant === undefined ? 0 : input.variant;
  const known = variant !== null;
  const h = input.height;

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
    pose.hipsLift += Math.abs(c) * (running ? 0.045 : 0.018) * h * m;
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
    pose.hipsLift -= 0.05 * h;
    act(P.stagger, 1);
    addA('torso', 0, 0, Math.sin(time * 2.6) * 0.12);
    addA('head', 0, Math.sin(time * 2.1) * 0.25);
    pose.jawOpen = 0.3;
  } else if (phase === 'dead') {
    pose.stiffness = 5;
    addA('torso', 0.7);
    addA('head', 0.6);
    addA('jaw', 0.5);
    act(DEAD_ARMS, 1);
  } else if (phase === 'flinch') {
    // A propane tank went off in the hand (phase 2): the body jerks back and turns away from
    // the blast, then shakes it off.
    const jolt = u < 0.2 ? smoothstep(u / 0.2) : 1 - smoothstep((u - 0.2) / 0.8);
    const shake = Math.sin(t * 40) * 0.06 * (1 - u);
    pose.stiffness = 28;
    pose.hipsLift -= 0.03 * jolt * h;
    addA('torso', -0.32 * jolt, 0.28 * jolt, shake);
    addA('neck', -0.18 * jolt, 0.3 * jolt);
    addA('head', -0.25 * jolt, 0.45 * jolt, shake * 2);
    addA('jaw', 0.5 * jolt);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.06 * jolt, shake);
    act(FLINCH_ARMS, jolt);
    pose.jawOpen = 0.5 * jolt;
  } else if (phase === 'brace' || action === 'brace') {
    // Crouched behind crossed arms.
    pose.hipsLift -= 0.07 * h;
    act(P.brace, 1);
    addA('leg_L', -0.25);
    addA('leg_R', -0.25);
    addA('shin_L', 0.45);
    addA('shin_R', 0.45);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.06);
  } else if (action === 'swipe') {
    swipePose(P, phase, ease, variant, assembly, h, pose, addA, act);
  } else if (action === 'stomp') {
    stompPose(phase, u, ease, variant, h, pose, addA, act);
  } else if (action === 'grab') {
    const w = phase === 'windup' || phase === 'active' ? ease : 1 - ease;
    act(P.grab, w);
  } else if (action === 'throw') {
    // Cock the arm, then whip it forward: overhand, or round at the side (look 1).
    const w = phase === 'windup' ? ease : 0;
    const a = phase === 'recover' || phase === 'active' ? 1 - ease : 0;
    if (!known) {
      act(P.throw_windup, w * 0.6);
    } else if (variant === 1) {
      pose.stiffness = 26;
      act(SIDE_WINDUP, w);
      act(derived(P).sideRelease, a);
      addA('head', 0, 0.25 * w);
    } else {
      act(P.throw_windup, w);
      act(P.throw_release, a);
    }
  } else if (action === 'club') {
    clubPose(P, phase, ease, variant, pose, addA, act);
  } else if (phase === 'eat' || action === 'eat') {
    const chew = Math.sin(t * 11);
    act(P.eat, 1);
    addA('head', chew * 0.08);
    addA('jaw', chew * 0.25);
    pose.jawOpen = 0.4;
  } else if (phase === 'roar' || action === 'roar') {
    const swell = Math.sin(clamp01(u) * Math.PI);
    const shake = Math.sin(t * 46) * 0.035;
    addA('jaw', 0.75 * Math.min(1, swell * 2.5));
    pose.jawOpen = Math.min(1, swell * 2.5);
    if (!known) {
      // Not known yet: the jaw opens and the body shakes; the head waits for its look.
      addA('torso', 0, 0, shake);
      act(ROAR_ARMS, swell * 0.35);
    } else if (variant === 1) {
      // Head low and forward: it leans into the bellow, snout level at whatever is ahead, arms
      // spread low and wide, legs braced apart, the tail up behind for balance.
      pose.hipsLift -= 0.04 * swell * h;
      addA('torso', 0.34 * swell, 0, shake);
      addA('neck', 0.16 * swell, 0, shake);
      addA('head', -0.3 * swell, shake * 2, shake);
      addA('leg_L', -0.12 * swell, 0, 0.12 * swell);
      addA('leg_R', -0.12 * swell, 0, -0.12 * swell);
      addA('shin_L', 0.25 * swell);
      addA('shin_R', 0.25 * swell);
      for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0.08 * swell);
      act(ROAR_LOW_ARMS, swell);
    } else {
      // Rear back, throw the arms wide, head up, jaw open, the whole body shaking.
      addA('torso', -0.35 * swell, 0, shake);
      addA('neck', -0.25 * swell);
      addA('head', -0.45 * swell, shake * 2, shake);
      for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.07 * swell);
      act(ROAR_ARMS, swell);
    }
  } else if (action === 'special') {
    // Wind-up: a deep breath, leaning back; active: head thrust forward, jaw wide, recoil shake.
    const w = phase === 'windup' ? ease : 0;
    const on = phase === 'special' || phase === 'active' ? 1 : 0;
    const r = phase === 'recover' ? 1 - ease : 0;
    const shake = on * Math.sin(t * 60) * 0.02;
    addA('torso', -0.32 * w + 0.18 * on + 0.1 * r, 0, shake);
    addA('neck', -0.25 * w + 0.1 * on);
    addA('head', -0.3 * w + shake);
    addA('jaw', 0.25 * w + 0.8 * on + 0.3 * r);
    act(BEAM_BREATH, w);
    act(BEAM_ON, on);
    pose.hipsLift -= 0.03 * on * h;
    pose.jawOpen = Math.max(0.3 * w, on);
  } else if (action === 'charge') {
    chargePose(phase, u, t, ease, variant, assembly, h, pose, addA, act);
  } else if (action === 'tailSweep') {
    // Wind-up: the hips coil and the tail is drawn round to one side; active: the hips whip
    // back and the tail lashes across behind, to the other; recover: it settles. The legs turn
    // against the hips so the feet stay planted. (Look 1 is the same the other way round.)
    let coil = 0;
    let lash = 0;
    if (phase === 'windup') coil = ease;
    else if (phase === 'active') {
      coil = 1 - ease;
      lash = ease;
    } else if (phase === 'recover') lash = 1 - ease;
    pose.stiffness = 30;
    if (!known) {
      // Not known yet: the tail lifts and stiffens, the body drops a little, no side yet.
      pose.hipsLift -= 0.02 * coil * h;
      for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0.06 * coil);
      act(SWEEP_ARMS, coil * 0.6);
    } else {
      const hipsYaw = 0.25 * coil - 0.35 * lash;
      addA('hips', 0, hipsYaw);
      addA('leg_L', 0, -hipsYaw);
      addA('leg_R', 0, -hipsYaw);
      addA('torso', -0.06 * coil, -0.2 * coil + 0.18 * lash, 0.05 * lash);
      addA('head', 0, -0.25 * coil + 0.2 * lash);
      addA('tail_1', 0.04 * coil, 0.32 * coil - 0.48 * lash);
      for (let i = 2; i <= 5; i++) addA(`tail_${i}`, 0.03 * coil, 0.16 * coil - 0.24 * lash);
      act(SWEEP_ARMS, Math.max(coil, lash));
    }
  }

  // --- a handful of civilians to the mouth (client only), only while it does nothing else ------
  const snack = input.snack;
  if (snack !== null && snack !== undefined && phase === 'idle' && snack < SNACK_TIME) {
    const lift = ramp(snack, 0, 0.42) * (1 - ramp(snack, SNACK_GULP + 0.12, SNACK_TIME));
    const gulp = ramp(snack, SNACK_GULP, SNACK_GULP + 0.1) * (1 - ramp(snack, SNACK_GULP + 0.25, SNACK_TIME));
    const eat = P.eat ?? EMPTY;
    // The right claw goes to the open mouth; the jaws snap shut and the head tips back to gulp.
    for (const node of ['arm_R', 'forearm_R', 'hand_R'] as const) {
      const v = eat[node];
      if (v) act({ [node]: v }, lift);
    }
    const open = ramp(snack, 0.25, 0.5) * (1 - ramp(snack, SNACK_GULP, SNACK_GULP + 0.06));
    addA('jaw', 0.55 * open);
    addA('head', 0.12 * lift - 0.28 * gulp);
    addA('neck', -0.1 * gulp);
    pose.jawOpen = Math.max(pose.jawOpen, open * 0.6);
    pose.stiffness = Math.max(pose.stiffness, 16);
  }

  // --- the action's layer, turned over for a mirrored look, joins the rest ---------------------
  if (mirrored(action, variant)) mirrorLayer();
  for (const [name, r] of layer) add(name, r.x, r.y, r.z);

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

type AddFn = (name: string, x: number, y?: number, z?: number) => void;
type ActFn = (target: PoseTarget | undefined, w: number) => void;

/**
 * The swipe. Wind-up: the claw goes up and back with the torso (the tell: an arm raised high,
 * whichever look); active: it rakes across; recover: back to rest. Looks 0 and 1 are the slash
 * with the right claw and (turned over) the left; look 2 brings both claws down together.
 */
function swipePose(P: PoseTable, phase: KaijuPhase, ease: number, variant: number | null, assembly: boolean, h: number, pose: KaijuPose, addA: AddFn, act: ActFn): void {
  const w = phase === 'windup' ? ease : phase === 'active' ? 1 : 0;
  const a = phase === 'active' ? ease : phase === 'recover' ? 1 - ease : 0;
  const back = phase === 'recover' ? 0 : w * (1 - a);
  // The strike snaps: the claws follow their path closely, so the slash trails sit on them.
  if (phase === 'active') pose.stiffness = 40;
  if (variant === null) {
    addA('torso', -0.1 * back);
    act(SWIPE_RAISE, back);
    return;
  }
  if (variant === 2) {
    // Both arms high overhead and the chest thrown back, then both claws raked down together.
    pose.hipsLift += (0.02 * back - 0.04 * a) * h;
    addA('torso', -0.22 * back);
    addA('head', -0.12 * back);
    act(RAKE_WINDUP, back);
    act(derived(P).rakeHit, a);
    return;
  }
  addA('torso', -0.1 * back, -0.6 * back);
  addA('hips', 0, -0.15 * back + 0.2 * a);
  if (!assembly) addA('arm_L', 0.3 * back);
  act(SWIPE_WINDUP, back);
  act(P.swipe_hit, a);
}

/**
 * The stomp. All looks start alike (a little crouch, the arms coming up); then a foot rises
 * (look 0 the right, look 1 the left) as it rears up, or it crouches deep and hops (look 2);
 * active: it comes down; recover: it settles.
 */
function stompPose(phase: KaijuPhase, u: number, ease: number, variant: number | null, h: number, pose: KaijuPose, addA: AddFn, act: ActFn): void {
  const windup = phase === 'windup';
  const a = phase === 'active' ? 1 : phase === 'recover' ? 1 - ease : 0;
  if (variant === null) {
    // Not known yet: what every look starts with, settling the weight, arms on the way up.
    const start = windup ? ramp(u, 0, 0.3) : 0;
    pose.hipsLift -= 0.015 * start * h;
    addA('torso', -0.06 * start);
    act(STOMP_WINDUP, start * 0.5);
    return;
  }
  if (variant === 2) {
    // Crouch with the arms swung back, spring up with the knees tucked and the arms high, land
    // on both feet with the arms slammed down.
    const crouch = windup ? ramp(u, 0.1, 0.62) * (1 - ramp(u, 0.62, 0.9)) : 0;
    const up = windup ? ramp(u, 0.62, 0.95) : 0;
    pose.hipsLift += (-0.08 * crouch + 0.13 * up - 0.08 * a) * h;
    addA('torso', 0.3 * crouch - 0.12 * up + 0.32 * a);
    addA('head', -0.1 * up + 0.2 * a);
    for (const side of ['L', 'R'] as const) {
      addA(`leg_${side}`, -0.5 * crouch - 0.8 * up - 0.35 * a);
      addA(`shin_${side}`, 0.95 * crouch + 1.25 * up + 0.7 * a);
      addA(`foot_${side}`, -0.35 * crouch - 0.2 * a);
    }
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0.05 * crouch - 0.06 * up + 0.08 * a);
    act(HOP_ARMS_BACK, crouch);
    act(STOMP_WINDUP, up);
    act(STOMP_SLAM, a);
    return;
  }
  // Rear up with one leg raised (the right; look 1 is turned over), then slam it down.
  const w = windup ? ease : 0;
  const lift = windup ? ramp(u, 0.25, 1) : 0;
  pose.hipsLift += (0.03 * w + 0.04 * lift - 0.06 * a) * h;
  addA('torso', -0.15 * w - 0.15 * lift + 0.4 * a);
  addA('leg_R', -1.25 * lift + 0.15 * a);
  addA('shin_R', 1.3 * lift);
  addA('head', -0.2 * w + 0.3 * a);
  // Leaning a little over the standing leg.
  addA('torso', 0, 0, -0.06 * lift);
  for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.1 * w + 0.08 * a);
  act(STOMP_WINDUP, w);
  act(STOMP_SLAM, a);
}

/**
 * The fast-food sign (phase 2). Look 0: cocked back over the right shoulder with the body wound
 * up, then swung right across the front as the body turns into it; look 1: a backhand, cocked
 * across the chest and swung out to the right; look 2: raised straight up and smashed down in
 * front. The sign itself follows `clubDirection` (render/heldProps.ts) for the same look.
 */
function clubPose(P: PoseTable, phase: KaijuPhase, ease: number, variant: number | null, pose: KaijuPose, addA: AddFn, act: ActFn): void {
  const cock = phase === 'windup' ? ease : phase === 'active' ? 1 - ease : 0;
  const a = phase === 'active' ? ease : phase === 'recover' ? 1 - ease : 0;
  pose.stiffness = phase === 'active' ? 34 : 22;
  if (variant === null) {
    act(P.throw_windup, cock * 0.5);
    return;
  }
  if (variant === 1) {
    act(derived(P).backhandCock, cock);
    act(BACKHAND_HIT, a);
    addA('hips', 0, 0.2 * cock - 0.25 * a);
    addA('head', 0, -0.1 * cock + 0.12 * a);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0, -0.12 * cock + 0.14 * a);
    return;
  }
  if (variant === 2) {
    act(OVERHEAD_COCK, cock);
    act(derived(P).overheadHit, a);
    addA('head', -0.1 * cock + 0.1 * a);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.06 * cock + 0.08 * a);
    return;
  }
  addA('torso', -0.15 * cock + 0.22 * a, -0.5 * cock + 0.75 * a);
  addA('hips', 0, -0.22 * cock + 0.28 * a);
  addA('head', 0, 0.12 * cock - 0.1 * a);
  for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0, 0.12 * cock - 0.16 * a);
  act(P.throw_windup, cock);
  act(P.swipe_hit, a);
}

/** The charge: the head-down wind-up, the run, and the stumble it ends in (three looks). */
function chargePose(phase: KaijuPhase, u: number, t: number, ease: number, variant: number | null, assembly: boolean, h: number, pose: KaijuPose, addA: AddFn, act: ActFn): void {
  // Seen from inside the head the lean is kept small: the camera rides the head.
  const lean = assembly ? 0.35 : 1;
  if (phase === 'windup') {
    // The bull before the rush: shoulders low, head down, a foot scraping the ground, the
    // tail up and stiff.
    const w = ease;
    const paw = Math.sin(t * 15);
    pose.hipsLift -= 0.07 * w * h;
    addA('torso', 0.34 * w * lean);
    addA('neck', 0.2 * w * lean);
    addA('head', 0.32 * w * lean);
    addA('jaw', 0.08 * w);
    addA('leg_R', (-0.3 + paw * 0.35) * w);
    addA('shin_R', (0.5 + Math.max(0, paw) * 0.35) * w);
    addA('leg_L', 0.15 * w);
    addA('shin_L', 0.25 * w);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0.08 * w);
    act(CHARGE_ARMS, w);
  } else if (phase === 'charge') {
    // The run: low and forward, the head down like a ram, the tail straight out behind.
    pose.hipsLift -= 0.03 * h;
    addA('torso', 0.44 * lean);
    addA('neck', 0.14 * lean);
    addA('head', 0.28 * lean);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, 0.1);
    act(CHARGE_ARMS, 1);
  } else if (phase === 'stumble') {
    // It lurches, then wobbles back up shaking its head.
    const lurch = u < 0.3 ? smoothstep(u / 0.3) : 1 - smoothstep((u - 0.3) / 0.7);
    const wobble = Math.sin(t * 13) * (1 - u) * 0.22;
    pose.stiffness = 14;
    if (variant === 2) {
      // Down hard on its tail: the hips drop, the legs shoot out in front, the arms fly up.
      pose.hipsLift -= 0.2 * lurch * h;
      addA('torso', -0.32 * lurch * lean, wobble * 0.6);
      addA('neck', 0.1 * lurch * lean);
      addA('head', 0.15 * lurch, wobble * 1.8, -0.1 * lurch);
      addA('jaw', 0.4 * lurch);
      addA('leg_L', -1.15 * lurch);
      addA('leg_R', -1.05 * lurch);
      addA('shin_L', 0.25 * lurch);
      addA('shin_R', 0.35 * lurch);
      addA('foot_L', -0.3 * lurch);
      addA('foot_R', -0.3 * lurch);
      for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.14 * lurch, wobble * 0.4);
      act(SIT_ARMS, lurch);
      pose.jawOpen = 0.4 * lurch;
      return;
    }
    if (variant === 1) {
      // Spinning out to the side: the hips slew round, a leg kicks out, one arm flung up, the
      // tail swinging wide.
      pose.hipsLift -= 0.06 * lurch * h;
      addA('hips', 0, 0.75 * lurch);
      addA('leg_L', -0.15 * lurch, -0.6 * lurch);
      addA('leg_R', -0.7 * lurch, -0.6 * lurch, -0.25 * lurch);
      addA('shin_R', 0.5 * lurch);
      addA('torso', 0.2 * lurch * lean, -0.25 * lurch + wobble, -0.3 * lurch * lean);
      addA('neck', 0.1 * lurch * lean, wobble);
      addA('head', 0.1 * lurch, wobble * 1.6 - 0.25 * lurch, 0.15 * lurch);
      addA('jaw', 0.35 * lurch);
      for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.04 * lurch, -0.22 * lurch + wobble * 0.6);
      act(SPIN_ARMS, lurch);
      pose.jawOpen = 0.3 * lurch;
      return;
    }
    // Pitching forward and lurching to one side, a knee buckling, arms thrown out to catch itself.
    pose.hipsLift -= 0.1 * lurch * h;
    addA('torso', 0.6 * lurch * lean, wobble, (0.24 * lurch + wobble * 0.5) * lean);
    addA('neck', 0.25 * lurch * lean, wobble);
    addA('head', 0.3 * lurch, wobble * 1.6, -0.22 * lurch);
    addA('jaw', 0.35 * lurch);
    addA('leg_L', -0.6 * lurch);
    addA('shin_L', 1.0 * lurch);
    addA('leg_R', 0.3 * lurch);
    for (let i = 1; i <= 5; i++) addA(`tail_${i}`, -0.1 * lurch, wobble * 0.6);
    act(STUMBLE_ARMS, lurch);
    pose.jawOpen = 0.3 * lurch;
  }
}
