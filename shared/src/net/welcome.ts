/** Builds the `welcome` message for one player from a World (server side). */

import { cityChecksum } from '../city/validate';
import type { PlayerId } from '../sim/config';
import type { World } from '../sim/types';
import { encodeCityState } from './cityState';
import { PROTOCOL_VERSION, type WelcomeMessage } from './protocol';

const checksums = new WeakMap<object, number>();

export function welcomeFor(world: World, playerId: PlayerId): WelcomeMessage {
  let checksum = checksums.get(world.city);
  if (checksum === undefined) {
    checksum = cityChecksum(world.city);
    checksums.set(world.city, checksum);
  }
  const player = world.players[playerId];
  return {
    protocol: PROTOCOL_VERSION,
    seed: world.seed,
    config: world.config,
    playerId: player ? player.id : -1,
    kaijuId: player ? player.kaijuId : -1,
    squadId: player ? player.squadId : -1,
    tick: world.tick,
    anchor: world.match.anchor,
    cityChecksum: checksum,
    cityState: encodeCityState(world.structureStage, world.propAlive, world.propWreck, world.city.props.length, world.structureFall, world.loose),
  };
}
