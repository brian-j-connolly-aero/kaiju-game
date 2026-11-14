/**
 * The live city state on the wire: the "full structure state as bytes" of the `welcome`
 * message. Structures travel as their visual stage (2 bits each), props as two bitsets (still
 * standing; destroyed but its wreck is still lying there), and the structures that lie fallen
 * over as a list of (id, side). After the welcome, changes arrive as `structureStage`,
 * `structureFall`, `propsDestroyed` and `kaijuHeld` events.
 *
 *   u32 structure count, u32 prop count,
 *   ceil(structures / 4) bytes of stages (structure i in bits 2*(i%4) of byte i/4),
 *   ceil(props / 8) bytes of live-prop bits,
 *   ceil(props / 8) bytes of prop-wreck bits,
 *   u32 fallen count, then per fallen structure (in id order): u32 id, u8 side (`FallSide`),
 *   u16 loose count, then per city weapon lying loose (`world.loose`, phase 2: dropped from the
 *   kaiju's hand, or a fallen radio mast's top; only those still lying there, in id order):
 *   u16 id, u8 prop (PROP_KIND_IDS code), f32 x, z, yaw.
 *
 * The fallen list was appended in phase 2; bytes that end before it (an older server) decode
 * as "nothing has fallen". A structure whose fall has begun but not yet landed is plain rubble
 * here; its `structureFall` event with phase 'landed' arrives in time.
 */

import type { CityState } from '../city/spatialIndex';
import { PROP_KIND_IDS, type CityData, type PropKindId } from '../city/types';
import { idOf } from '../defs/ids';
import type { LooseObject } from '../sim/types';
import type { StructureStage } from '../defs/ids';
import { MATCH_RULES } from '../defs/rules';
import {
  createReader,
  createWriter,
  finishWriter,
  readBytes,
  readF32,
  readU16,
  readU32,
  readU8,
  writeBytes,
  writeF32,
  writeU16,
  writeU32,
  writeU8,
} from './bytes';

export interface DecodedCityState {
  /** Visual stage per structure id (0 intact .. 3 rubble). */
  structureStage: Uint8Array;
  /** Bitset of props still standing. */
  propAlive: Uint8Array;
  /** Bitset of destroyed props whose wreck is still on the ground. */
  propWreck: Uint8Array;
  propCount: number;
  /** Per structure id: 0, or 1 + the side it lies fallen toward (as `CityState.structureFall`). */
  structureFall: Uint8Array;
  /** City weapons lying loose (phase 2): what `looseProp` events with state 'down' would have said. */
  loose: DecodedLoose[];
}

/** A city weapon lying loose, as the welcome carries it. */
export interface DecodedLoose {
  id: number;
  prop: PropKindId;
  x: number;
  z: number;
  yaw: number;
}

export function encodeCityState(
  structureStage: Uint8Array,
  propAlive: Uint8Array,
  propWreck: Uint8Array,
  propCount: number,
  structureFall?: Uint8Array,
  loose?: readonly LooseObject[],
): Uint8Array {
  const n = structureStage.length;
  const propBytes = Math.ceil(propCount / 8);
  const w = createWriter(12 + Math.ceil(n / 4) + propBytes * 2);
  writeU32(w, n);
  writeU32(w, propCount);
  for (let i = 0; i < n; i += 4) {
    let b = 0;
    for (let k = 0; k < 4 && i + k < n; k++) b |= (structureStage[i + k] & 3) << (k * 2);
    writeU8(w, b);
  }
  writeBytes(w, propAlive.subarray(0, propBytes));
  writeBytes(w, propWreck.subarray(0, propBytes));
  let fallen = 0;
  if (structureFall) for (let i = 0; i < n; i++) if (structureFall[i] !== 0) fallen++;
  writeU32(w, fallen);
  if (structureFall && fallen > 0) {
    for (let i = 0; i < n; i++) {
      if (structureFall[i] === 0) continue;
      writeU32(w, i);
      writeU8(w, (structureFall[i] - 1) & 3);
    }
  }
  let down = 0;
  if (loose) for (const o of loose) if (o.state === 'down') down++;
  writeU16(w, Math.min(down, 65535));
  if (loose && down > 0) {
    let written = 0;
    for (const o of loose) {
      if (o.state !== 'down' || written >= 65535) continue;
      writeU16(w, o.id & 0xffff);
      writeU8(w, Math.max(0, PROP_KIND_IDS.indexOf(o.kind)));
      writeF32(w, o.x);
      writeF32(w, o.z);
      writeF32(w, o.yaw);
      written++;
    }
  }
  return finishWriter(w);
}

/** Decodes a city state. Throws on truncated data. */
export function decodeCityState(bytes: Uint8Array): DecodedCityState {
  const r = createReader(bytes);
  const n = readU32(r);
  const propCount = readU32(r);
  const packed = readBytes(r, Math.ceil(n / 4));
  const structureStage = new Uint8Array(n);
  for (let i = 0; i < n; i++) structureStage[i] = (packed[i >> 2] >> ((i & 3) * 2)) & 3;
  const propAlive = readBytes(r, Math.ceil(propCount / 8));
  const propWreck = readBytes(r, Math.ceil(propCount / 8));
  const structureFall = new Uint8Array(n);
  if (r.pos < bytes.length) {
    const fallen = readU32(r);
    for (let k = 0; k < fallen; k++) {
      const id = readU32(r);
      const side = readU8(r) & 3;
      if (id < n) structureFall[id] = side + 1;
    }
  }
  const loose: DecodedLoose[] = [];
  if (r.pos < bytes.length) {
    const count = readU16(r);
    for (let k = 0; k < count; k++) {
      const id = readU16(r);
      const prop = idOf(PROP_KIND_IDS, readU8(r));
      const x = readF32(r);
      const z = readF32(r);
      const yaw = readF32(r);
      loose.push({ id, prop, x, z, yaw });
    }
  }
  return { structureStage, propAlive, propWreck, propCount, structureFall, loose };
}

/**
 * A stand-in hp for a structure known only by its stage: 0 for rubble, otherwise a value inside
 * that stage's hp band. Clients only need "standing or not" (for collision and line of sight)
 * and the stage (for drawing); exact hp stays on the server.
 */
export function hpForStage(maxHp: number, stage: StructureStage | number): number {
  if (stage >= 3) return 0;
  if (stage === 2) return maxHp * MATCH_RULES.structureHeavyAt * 0.5;
  if (stage === 1) return maxHp * (MATCH_RULES.structureDamagedAt + MATCH_RULES.structureHeavyAt) * 0.5;
  return maxHp;
}

/**
 * Client side: turns a decoded city state into the CityState a CityQuery needs, so the client
 * can run stepMovement and line-of-sight checks against the same city the server sees (fallen
 * structures included: `fallen` lists them in id order). Throws when the counts do not match
 * the client's own city (the two builds differ).
 */
export function cityStateFromWire(city: CityData, decoded: DecodedCityState): CityState {
  if (decoded.structureStage.length !== city.structures.length || decoded.propCount !== city.props.length) {
    throw new Error('city state does not match this client\'s city');
  }
  const structureHp = new Float32Array(city.structures.length);
  for (let i = 0; i < structureHp.length; i++) {
    structureHp[i] = hpForStage(city.structures[i].hp, decoded.structureStage[i]);
  }
  const structureFall = decoded.structureFall.slice();
  const fallen: number[] = [];
  for (let i = 0; i < structureFall.length; i++) {
    // Only rubble can lie fallen.
    if (structureFall[i] !== 0 && structureHp[i] > 0) structureFall[i] = 0;
    if (structureFall[i] !== 0) fallen.push(i);
  }
  return { structureHp, propAlive: decoded.propAlive.slice(), structureFall, fallen };
}
