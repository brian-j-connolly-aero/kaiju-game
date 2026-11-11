/**
 * Building the city and its index takes a few tens of milliseconds, and both are immutable, so
 * one copy per seed is shared by everything in the process (every room on the server, every
 * World in a test run).
 */

import { generateCity } from './generateCity';
import { buildCityIndex, type CityIndex } from './spatialIndex';
import { CITY_SEED, type CityData } from './types';

export interface BuiltCity {
  city: CityData;
  index: CityIndex;
}

const cache = new Map<number, BuiltCity>();

/** The city for a seed together with its spatial index, built once and then reused. */
export function getCity(seed: number = CITY_SEED): BuiltCity {
  let built = cache.get(seed);
  if (!built) {
    const city = generateCity(seed);
    built = { city, index: buildCityIndex(city) };
    cache.set(seed, built);
  }
  return built;
}
