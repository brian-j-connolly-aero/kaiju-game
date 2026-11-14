/**
 * Building the city and its index takes a few tens of milliseconds (a few hundred the first
 * time in a fresh process), and both are immutable, so one copy per city and seed is shared by
 * everything in the process (every room on the server, every World in a test run).
 *
 * The game's city is Port Meridian (`generatePortMeridian`, docs/CITY.md). The old placeholder
 * grid (`generateCity`) is still here for tests that want a plain, regular city and as a
 * development option (`npm run sim -- --city placeholder`); nothing in the game uses it.
 */

import { generateCity } from './generateCity';
import { generatePortMeridian } from './meridian/generate';
import { buildCityIndex, type CityIndex } from './spatialIndex';
import { CITY_SEED, type CityData } from './types';

export interface BuiltCity {
  city: CityData;
  index: CityIndex;
}

/** Which generator builds the city: Port Meridian (the game's) or the old placeholder grid. */
export type CityKind = 'meridian' | 'placeholder';
/** The city the game plays in. */
export const DEFAULT_CITY_KIND: CityKind = 'meridian';

const cache = new Map<string, BuiltCity>();

/** Builds a city and its index, without caching. */
export function buildCity(seed: number = CITY_SEED, kind: CityKind = DEFAULT_CITY_KIND): BuiltCity {
  const city = kind === 'placeholder' ? generateCity(seed) : generatePortMeridian(seed);
  return { city, index: buildCityIndex(city) };
}

/** The city for a seed together with its spatial index, built once and then reused. */
export function getCity(seed: number = CITY_SEED, kind: CityKind = DEFAULT_CITY_KIND): BuiltCity {
  const key = `${kind}:${seed}`;
  let built = cache.get(key);
  if (!built) {
    built = buildCity(seed, kind);
    cache.set(key, built);
  }
  return built;
}
