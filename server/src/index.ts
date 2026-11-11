/**
 * PLACEHOLDER entry point. The server worker replaces this file with the real server (Express
 * plus a room that owns a World; see docs/ARCHITECTURE.md sections 1 and 4).
 *
 * It exists so the workspace wiring is proven end to end before any server code is written:
 * `npm run dev`, `npm run build` and `npm start` already run this file with '@mb/shared'
 * resolved from source (dev) or bundled in (build).
 */

import { cityChecksum, createMatchConfig, createWorld, DEFAULT_PORT, PROTOCOL_VERSION } from '@mb/shared';

const world = createWorld({ seed: 1, config: createMatchConfig() });
console.log(
  `[server placeholder] @mb/shared is wired: protocol ${PROTOCOL_VERSION}, ` +
    `${world.city.structures.length} structures (checksum ${cityChecksum(world.city)}), ` +
    `${world.units.length} units deployed. The real server (port ${DEFAULT_PORT}) is not built yet.`,
);
