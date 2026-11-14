/** createWorld: builds the complete starting state of a match from a seed and a config. */

import { allStageBounds } from '../city/bounds';
import { getCity, type BuiltCity } from '../city/cache';
import { createCityQuery, createCityState } from '../city/spatialIndex';
import { kaijuStageDef } from '../defs/kaiju/index';
import { createBitset } from '../math/bits';
import { createRng, rngAngle, rngInt } from '../math/rng';
import { computeBarMarks } from './bar';
import type { MatchConfig } from './config';
import { stepWorld } from './pipeline';
import { createKaiju, createSquad, deploySquads, findClearSpot } from './spawn';
import type { InputsByPlayer, World } from './types';
import { createPlayerState, createVoiceState } from './worldOps';

export interface WorldOptions {
  /** Match seed: decides the starting neighborhood and every random roll in the match. */
  seed: number;
  config: MatchConfig;
  /** A prebuilt city, to share or to test with a custom one. Default: the cached city for config.citySeed. */
  city?: BuiltCity;
}

/**
 * Creates a World at the start of the briefing: the kaiju stands at the chosen neighborhood
 * anchor at stage 1, and every squad is deployed fresh at the edge of the stage 1 bounds.
 * Throws on a malformed config (always a caller bug).
 */
export function createWorld(options: WorldOptions): World {
  const { seed, config } = options;
  if (config.players.length === 0) throw new Error('createWorld: no players');
  config.players.forEach((p, i) => {
    if (p.id !== i) throw new Error(`createWorld: player at index ${i} has id ${p.id}`);
  });
  if (!config.players.some((p) => p.role === 'kaiju')) throw new Error('createWorld: no kaiju player');

  const built = options.city ?? getCity(config.citySeed);
  const city = built.city;
  const rng = createRng(seed);

  // Always consume the roll so the rest of the match is the same with or without a fixed anchor.
  const rolled = rngInt(rng, city.anchors.length);
  const anchor = config.anchor >= 0 ? config.anchor : rolled;
  if (!city.anchors[anchor]) throw new Error(`createWorld: no neighborhood anchor ${anchor}`);
  const stageBounds = allStageBounds(city, anchor);

  const state = createCityState(city);
  const world: World = {
    seed,
    config,
    tick: 0,
    rng,
    city,
    cityIndex: built.index,
    cityQuery: createCityQuery(built.index, state),
    structureHp: state.structureHp,
    structureStage: new Uint8Array(city.structures.length),
    propAlive: state.propAlive,
    propWreck: createBitset(city.props.length),
    structureFall: state.structureFall,
    falls: [],
    crates: [],
    nextCrateId: 1,
    supply: { stage: 0, timer: 0, turn: 0 },
    shields: [],
    insuredStructures: [],
    loose: [],
    match: {
      phase: 'briefing',
      stage: 1,
      clock: config.tuning.clock,
      phaseTime: config.tuning.briefing,
      anchor,
      bounds: stageBounds[0],
      stageBounds,
      barPoints: 0,
      marks: computeBarMarks(city, anchor, config.tuning.barScale),
      marksReached: 0,
      winner: 'none',
      endReason: 'none',
      elapsed: 0,
      stageTime: [0, 0, 0],
      breaks: 0,
      kills: 0,
      staticUntil: 0,
    },
    players: config.players.map(createPlayerState),
    kaijus: [],
    squads: [],
    units: [],
    projectiles: [],
    callIns: [],
    nextProjectileId: 1,
    nextCallInId: 1,
    hits: [],
    structureHits: [],
    propHits: [],
    voice: createVoiceState(),
    events: [],
    step(inputs?: InputsByPlayer) {
      return stepWorld(world, inputs);
    },
  };

  const a = city.anchors[anchor];
  const spot = { x: a.x, z: a.z };
  for (const slot of config.players) {
    const player = world.players[slot.id];
    if (slot.role === 'kaiju') {
      const id = world.kaijus.length;
      const radius = kaijuStageDef(slot.kaijuKind, 1).bodyRadius;
      findClearSpot(world.cityQuery, a.x, a.z, radius, stageBounds[0], world.kaijus, spot);
      world.kaijus.push(createKaiju(id, slot, spot.x, spot.z, rngAngle(rng)));
      player.kaijuId = id;
    } else {
      player.squadId = createSquad(world, slot).id;
    }
  }
  deploySquads(world);
  return world;
}
