/**
 * Holds the last few snapshots and produces the state to draw at a (fractional) server tick:
 * positions and angles are interpolated between the two snapshots around that tick, discrete
 * state (phase, action, flags) comes from the nearer one.
 */

import { DT, lerp, lerpAngle, type SnapKaiju, type SnapUnit, type Snapshot } from '@mb/shared';

const KEEP = 40;
/** A body that moved faster than this between two snapshots was placed, not driven: do not slide it. */
const TELEPORT_SPEED = 90;
const TELEPORT_SLACK = 6;

export interface SnapshotBuffer {
  snaps: Snapshot[];
}

export function createSnapshotBuffer(): SnapshotBuffer {
  return { snaps: [] };
}

/** Adds a snapshot, keeping the buffer ordered by tick. Stale and duplicate ticks are dropped. */
export function pushSnapshot(buffer: SnapshotBuffer, snap: Snapshot): boolean {
  const snaps = buffer.snaps;
  const last = snaps[snaps.length - 1];
  if (last && snap.tick <= last.tick) {
    // A snapshot from before the newest one: a new match started (tick went back to 0) or the
    // message is a duplicate. A restart replaces everything.
    if (snap.tick + 30 < last.tick) snaps.length = 0;
    else return false;
  }
  snaps.push(snap);
  if (snaps.length > KEEP) snaps.splice(0, snaps.length - KEEP);
  return true;
}

export function newestSnapshot(buffer: SnapshotBuffer): Snapshot | null {
  return buffer.snaps.length > 0 ? buffer.snaps[buffer.snaps.length - 1] : null;
}

function teleported(ax: number, az: number, bx: number, bz: number, span: number): boolean {
  const limit = TELEPORT_SPEED * span + TELEPORT_SLACK;
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz > limit * limit;
}

function mixKaiju(a: SnapKaiju, b: SnapKaiju, alpha: number, span: number, aheadOfA: number): SnapKaiju {
  const near = alpha >= 0.5 ? b : a;
  const out: SnapKaiju = { ...near };
  if (a.stage === b.stage && !teleported(a.x, a.z, b.x, b.z, span)) {
    out.x = lerp(a.x, b.x, alpha);
    out.z = lerp(a.z, b.z, alpha);
    out.vx = lerp(a.vx, b.vx, alpha);
    out.vz = lerp(a.vz, b.vz, alpha);
    out.yaw = lerpAngle(a.yaw, b.yaw, alpha);
    out.aimYaw = lerpAngle(a.aimYaw, b.aimYaw, alpha);
    out.aimPitch = lerp(a.aimPitch, b.aimPitch, alpha);
  }
  out.hp = lerp(a.hp, b.hp, alpha);
  out.nerve = lerp(a.nerve, b.nerve, alpha);
  out.rage = lerp(a.rage, b.rage, alpha);
  // Phase timers run forward in real time; keep them smooth across the pair.
  if (a.phase === b.phase && a.action === b.action && b.phaseTime >= a.phaseTime) {
    out.phaseTime = lerp(a.phaseTime, b.phaseTime, alpha);
  } else if (near === a) {
    out.phaseTime = a.phaseTime + aheadOfA;
  } else {
    out.phaseTime = Math.max(0, b.phaseTime - (span - aheadOfA));
  }
  return out;
}

function mixUnit(a: SnapUnit, b: SnapUnit, alpha: number, span: number): SnapUnit {
  const near = alpha >= 0.5 ? b : a;
  const out: SnapUnit = { ...near };
  if (a.type === b.type && a.alive === b.alive && !teleported(a.x, a.z, b.x, b.z, span)) {
    out.x = lerp(a.x, b.x, alpha);
    out.z = lerp(a.z, b.z, alpha);
    out.y = lerp(a.y, b.y, alpha);
    out.vx = lerp(a.vx, b.vx, alpha);
    out.vz = lerp(a.vz, b.vz, alpha);
    out.yaw = lerpAngle(a.yaw, b.yaw, alpha);
    out.aimYaw = lerpAngle(a.aimYaw, b.aimYaw, alpha);
    out.aimPitch = lerp(a.aimPitch, b.aimPitch, alpha);
    out.charge = lerp(a.charge, b.charge, alpha);
  }
  return out;
}

export interface SampledState {
  /** The tick the state was sampled for. */
  tick: number;
  /** The newer of the two snapshots used (discrete match state comes from it). */
  snap: Snapshot;
  kaijus: SnapKaiju[];
  units: SnapUnit[];
}

/**
 * The state at `tick`. Before the oldest snapshot it is the oldest; past the newest it is the
 * newest, moved along its velocities for the overshoot (the clock limits how far that can be).
 * Returns null while the buffer is empty.
 */
export function sampleSnapshots(buffer: SnapshotBuffer, tick: number): SampledState | null {
  const snaps = buffer.snaps;
  if (snaps.length === 0) return null;
  const newest = snaps[snaps.length - 1];
  if (tick >= newest.tick || snaps.length === 1) {
    const ahead = Math.max(0, tick - newest.tick) * DT;
    const playing = newest.match.phase === 'playing';
    const kaijus = newest.kaijus.map((k) => ({ ...k }));
    const units = newest.units.map((u) => ({ ...u }));
    if (ahead > 0 && playing) {
      for (const k of kaijus) {
        k.x += k.vx * ahead;
        k.z += k.vz * ahead;
        k.phaseTime += ahead;
      }
      for (const u of units) {
        u.x += u.vx * ahead;
        u.z += u.vz * ahead;
      }
    }
    return { tick, snap: newest, kaijus, units };
  }
  let i = snaps.length - 2;
  while (i > 0 && snaps[i].tick > tick) i--;
  const a = snaps[i];
  const b = snaps[i + 1];
  if (tick <= a.tick) {
    return { tick, snap: a, kaijus: a.kaijus.map((k) => ({ ...k })), units: a.units.map((u) => ({ ...u })) };
  }
  const spanTicks = Math.max(1, b.tick - a.tick);
  const alpha = Math.min(1, Math.max(0, (tick - a.tick) / spanTicks));
  const span = spanTicks * DT;
  const aheadOfA = (tick - a.tick) * DT;
  const kaijus: SnapKaiju[] = [];
  for (let k = 0; k < b.kaijus.length; k++) {
    const ka = a.kaijus[k];
    kaijus.push(ka ? mixKaiju(ka, b.kaijus[k], alpha, span, aheadOfA) : { ...b.kaijus[k] });
  }
  const units: SnapUnit[] = [];
  for (let u = 0; u < b.units.length; u++) {
    const ua = a.units[u];
    units.push(ua ? mixUnit(ua, b.units[u], alpha, span) : { ...b.units[u] });
  }
  return { tick, snap: alpha >= 0.5 ? b : a, kaijus, units };
}
