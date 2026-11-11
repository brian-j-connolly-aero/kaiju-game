/**
 * The path of a beam special (the Lizard's breath), as one pure function that the simulation
 * and the clients both use, so the beam is drawn exactly where it burns.
 *
 * The beam leaves the mouth, at the stage's mouth height above the body center, along the
 * head's aim (`aimYaw`, `aimPitch`). It ends at the first standing structure, at the ground, or
 * at its range, whichever comes first. A beam has width: it is stopped by the first structure
 * that its center line or either of its two edges touches.
 *
 * While the special's active phase runs, the movement system turns the head toward the
 * player's aim only at the special's reduced turn rate, so `aimYaw` / `aimPitch` in a snapshot
 * are the true beam direction.
 */

import { castRay, createCityCastHit, type CityQuery } from '../city/spatialIndex';
import type { KaijuKindId, StageId } from '../defs/ids';
import { perStage } from '../defs/ids';
import { kaijuStageDef } from '../defs/kaiju/index';
import type { BeamSpecialDef } from '../defs/schema';
import type { Vec3 } from '../math/vec';

/** The parts of a kaiju's state that fix its beam. Kaiju and snapshot kaiju both satisfy it. */
export interface BeamSource {
  kind: KaijuKindId;
  stage: StageId;
  x: number;
  z: number;
  aimYaw: number;
  aimPitch: number;
}

export interface BeamPath {
  /** Origin: the mouth. */
  ox: number;
  oy: number;
  oz: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  dz: number;
  /** Distance from the mouth to where the beam ends. */
  length: number;
  /** The end point. */
  ex: number;
  ey: number;
  ez: number;
  /** What stopped it. */
  end: 'structure' | 'ground' | 'range';
  /** The structure it is burning through, or -1. */
  blocker: number;
}

export function createBeamPath(): BeamPath {
  return { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, length: 0, ex: 0, ey: 0, ez: 0, end: 'range', blocker: -1 };
}

const hit = createCityCastHit();
const origin: Vec3 = { x: 0, y: 0, z: 0 };
const dir: Vec3 = { x: 0, y: 0, z: 0 };

/** Computes where a kaiju's beam goes right now, against the city in its current state. */
export function beamPath(city: CityQuery, k: BeamSource, action: BeamSpecialDef, out: BeamPath = createBeamPath()): BeamPath {
  const st = kaijuStageDef(k.kind, k.stage);
  const range = perStage(action.range, k.stage);
  const halfWidth = perStage(action.width, k.stage) / 2;
  const cp = Math.cos(k.aimPitch);
  const sy = Math.sin(k.aimYaw);
  const cy = Math.cos(k.aimYaw);
  out.ox = k.x;
  out.oy = st.mouthHeight;
  out.oz = k.z;
  out.dx = sy * cp;
  out.dy = Math.sin(k.aimPitch);
  out.dz = cy * cp;

  let length = range;
  out.end = 'range';
  out.blocker = -1;
  if (out.dy < 0) {
    const t = out.oy / -out.dy;
    if (t < length) {
      length = t;
      out.end = 'ground';
    }
  }
  dir.x = out.dx;
  dir.y = out.dy;
  dir.z = out.dz;
  // Center line, then the two edges (offset sideways: the right vector of a heading is (-cos, sin)).
  for (let i = 0; i < 3; i++) {
    const side = i === 0 ? 0 : i === 1 ? halfWidth : -halfWidth;
    origin.x = out.ox - cy * side;
    origin.y = out.oy;
    origin.z = out.oz + sy * side;
    if (castRay(city, origin, dir, length, hit) && hit.t < length) {
      length = hit.t;
      out.end = 'structure';
      out.blocker = hit.structure;
    }
  }
  out.length = length;
  out.ex = out.ox + out.dx * length;
  out.ey = out.end === 'ground' ? 0 : out.oy + out.dy * length;
  out.ez = out.oz + out.dz * length;
  return out;
}
