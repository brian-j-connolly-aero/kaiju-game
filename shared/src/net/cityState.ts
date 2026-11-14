/**
 * The live city state on the wire: the "full structure state as bytes" of the `welcome`
 * message. Structures travel as their visual stage (2 bits each), props as two bitsets (still
 * standing; destroyed but its wreck is still lying there). After the welcome, changes arrive as
 * `structureStage`, `propsDestroyed` and `kaijuHeld` events.
 *
 *   u32 structure count, u32 prop count,
 *   ceil(structures / 4) bytes of stages (structure i in bits 2*(i%4) of byte i/4),
 *   ceil(props / 8) bytes of live-prop bits,
 *   ceil(props / 8) bytes of prop-wreck bits.
 */

import type { CityState } from '../city/spatialIndex';
import type { CityData } from '../city/types';
import type { StructureStage } from '../defs/ids';
import { MATCH_RULES } from '../defs/rules';
import { createReader, createWriter, finishWriter, readBytes, readU32, writeBytes, writeU32, writeU8 } from './bytes';

export interface DecodedCityState {
  /** Visual stage per structure id (0 intact .. 3 rubble). */
  structureStage: Uint8Array;
  /** Bitset of props still standing. */
  propAlive: Uint8Array;
  /** Bitset of destroyed props whose wreck is still on the ground. */
  propWreck: Uint8Array;
  propCount: number;
}

export function encodeCityState(
  structureStage: Uint8Array,
  propAlive: Uint8Array,
  propWreck: Uint8Array,
  propCount: number,
): Uint8Array {
  const n = structureStage.length;
  const propBytes = Math.ceil(propCount / 8);
  const w = createWriter(8 + Math.ceil(n / 4) + propBytes * 2);
  writeU32(w, n);
  writeU32(w, propCount);
  for (let i = 0; i < n; i += 4) {
    let b = 0;
    for (let k = 0; k < 4 && i + k < n; k++) b |= (structureStage[i + k] & 3) << (k * 2);
    writeU8(w, b);
  }
  writeBytes(w, propAlive.subarray(0, propBytes));
  writeBytes(w, propWreck.subarray(0, propBytes));
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
  return { structureStage, propAlive, propWreck, propCount };
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
 * can run stepMovement and line-of-sight checks against the same city the server sees.
 * Throws when the counts do not match the client's own city (the two builds differ).
 */
export function cityStateFromWire(city: CityData, decoded: DecodedCityState): CityState {
  if (decoded.structureStage.length !== city.structures.length || decoded.propCount !== city.props.length) {
    throw new Error('city state does not match this client\'s city');
  }
  const structureHp = new Float32Array(city.structures.length);
  for (let i = 0; i < structureHp.length; i++) {
    structureHp[i] = hpForStage(city.structures[i].hp, decoded.structureStage[i]);
  }
  return { structureHp, propAlive: decoded.propAlive.slice() };
}
