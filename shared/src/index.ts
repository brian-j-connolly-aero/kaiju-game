/**
 * @mb/shared: everything the server and the client have in common. Pure TypeScript: no DOM and
 * no Node APIs. Import from '@mb/shared' only; the folders are an internal layout.
 *
 *   math/   vectors, angles, seeded random numbers, geometry tests
 *   defs/   all tunable data: stages, rules, kaiju, factions, units, weapons, upgrades, voice cues
 *   city/   city data types, archetypes, the generator, the spatial index, stage bounds
 *   sim/    the authoritative simulation: World, systems, events
 *   net/    protocol: input, messages, lobby, the binary snapshot codec
 */

export * from './math/index';
export * from './defs/index';
export * from './city/index';
export * from './sim/index';
export * from './net/index';
