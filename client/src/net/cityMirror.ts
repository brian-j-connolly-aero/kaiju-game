/**
 * The client's copy of the live city: which structures stand (and their visual stage), which
 * props are alive, which wrecks lie around. It starts from the bytes in the welcome message
 * and is kept current from events alone (ARCHITECTURE.md section 4), so the client can run the
 * shared movement and line-of-sight code against the same city the server sees.
 */

import {
  bitClear,
  bitGet,
  bitSet,
  cityChecksum,
  cityStateFromWire,
  createCityQuery,
  decodeCityState,
  getCity,
  hpForStage,
  PROP_KINDS,
  type CityData,
  type CityIndex,
  type CityQuery,
  type SimEvent,
} from '@mb/shared';

export interface CityMirror {
  city: CityData;
  index: CityIndex;
  /** For stepMovement, casts and line of sight. */
  query: CityQuery;
  /** Visual stage per structure id (0 intact .. 3 rubble). */
  structureStage: Uint8Array;
  /** Bitset of destroyed props whose wreck still lies on the ground. */
  propWreck: Uint8Array;
  /** False when this client's city differs from the server's: it must not predict. */
  trusted: boolean;
}

const checksums = new Map<number, number>();

function checksumOf(seed: number, city: CityData): number {
  let sum = checksums.get(seed);
  if (sum === undefined) {
    sum = cityChecksum(city);
    checksums.set(seed, sum);
  }
  return sum;
}

/** Builds the mirror from a welcome message's seed, checksum and city state bytes. */
export function createCityMirror(citySeed: number, serverChecksum: number, cityState: Uint8Array): CityMirror {
  const { city, index } = getCity(citySeed);
  const decoded = decodeCityState(cityState);
  const state = cityStateFromWire(city, decoded);
  return {
    city,
    index,
    query: createCityQuery(index, state),
    structureStage: decoded.structureStage.slice(),
    propWreck: decoded.propWreck.slice(),
    trusted: checksumOf(citySeed, city) === serverChecksum,
  };
}

/** A second welcome in the same match: take the server's state over in place. */
export function resyncCityMirror(mirror: CityMirror, cityState: Uint8Array): void {
  const decoded = decodeCityState(cityState);
  const state = cityStateFromWire(mirror.city, decoded);
  mirror.query.structureHp.set(state.structureHp);
  mirror.query.propAlive.set(state.propAlive);
  mirror.structureStage.set(decoded.structureStage);
  mirror.propWreck.set(decoded.propWreck);
}

/** Applies one event to the mirror. Returns true when it changed the city. */
export function applyCityEvent(mirror: CityMirror, e: SimEvent): boolean {
  switch (e.type) {
    case 'structureStage': {
      const s = mirror.city.structures[e.id];
      if (!s) return false;
      mirror.structureStage[e.id] = e.stage;
      mirror.query.structureHp[e.id] = hpForStage(s.hp, e.stage);
      return true;
    }
    case 'propsDestroyed': {
      for (const id of e.ids) {
        const p = mirror.city.props[id];
        if (!p) continue;
        bitClear(mirror.query.propAlive, id);
        if (PROP_KINDS[p.kind].leavesWreck) bitSet(mirror.propWreck, id);
      }
      return true;
    }
    case 'kaijuHeld': {
      if (e.source === 'prop' && mirror.city.props[e.sourceId]) {
        bitClear(mirror.query.propAlive, e.sourceId);
        return true;
      }
      if (e.source === 'propWreck' && mirror.city.props[e.sourceId]) {
        bitClear(mirror.propWreck, e.sourceId);
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

export function propAlive(mirror: CityMirror, id: number): boolean {
  return bitGet(mirror.query.propAlive, id);
}

export function propWrecked(mirror: CityMirror, id: number): boolean {
  return bitGet(mirror.propWreck, id);
}
