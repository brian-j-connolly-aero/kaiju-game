# Monster Battle 9001: Architecture

Living contract for everyone working in this repo. Keep it accurate: if you change a contract in
code, update this file in the same change.

## 1. Stack

- **Language:** TypeScript everywhere, strict mode. Node 22. npm workspaces.
- **Client:** Vite + three.js (WebGLRenderer). Vanilla TS with DOM and CSS overlays for all UI.
  No UI framework.
- **Server:** Node + Express 5 (serves the built client) + Colyseus 0.18 (rooms, invite codes,
  reconnect). One process, one port (default 2567), so a single Cloudflare Tunnel hostname
  carries both the page and the WebSocket. The server depends on `@colyseus/core` and
  `@colyseus/ws-transport` directly (plus `@colyseus/schema`, a peer the core requires and we
  do not use), not on the umbrella `colyseus` package, which drags in Redis drivers and admin
  tools. The client side of the same library is `@colyseus/sdk`; keep its version in step with
  the server's (0.18.x).
- **Tests:** vitest for unit and headless simulation tests; Playwright (pre-installed globally,
  `require('playwright')`, do not install it) for multi-client browser playtests.
- Library versions move fast. **Read the installed package's types and README in `node_modules`
  instead of trusting memory**, especially for Colyseus, Vite and three.js. Pin exact versions
  (`.npmrc` sets `save-exact`). The toolchain lives in the root `package.json` and is shared by
  every workspace: TypeScript 7.0.2 (the native compiler; `tsc` is used for type checking only,
  nothing is emitted), vitest 5.1.0, Vite 8.3.8, tsx 4.23.15, esbuild 0.28.2, `@types/node` 22.
- Colyseus is used for rooms and messaging only. Game state does **not** use Colyseus schema
  sync; it uses our own messages (below). All Colyseus use sits behind `server/src/net/` and
  `client/src/net/` wrappers so the rest of the code never imports it directly.

### How `@mb/shared` is consumed: as TypeScript source, never as a build output

There is no build step for the shared package and no project references. `shared/package.json`
exports `./src/index.ts`, npm workspaces link it into `node_modules/@mb/shared`, and every
consumer compiles it together with its own code:

| Consumer | How it gets `@mb/shared` |
| --- | --- |
| Type checking (`tsc --noEmit` per workspace) | Resolves the workspace link to the `.ts` source (`moduleResolution: bundler`). |
| vitest | Vite transforms the source on the fly. |
| Client, dev and build (Vite) | A linked workspace package is treated as source: hot reload reaches into `shared/`. |
| Server, dev | `tsx watch src/index.ts` transpiles the source and restarts when a shared file changes. |
| Server, production | `esbuild --bundle` inlines `@mb/shared` into `server/dist/index.js` (`--alias:@mb/shared=../shared/src/index.ts`) and leaves real npm packages external (`--packages=external`), so `npm start` is plain `node dist/index.js`. |

Rules that keep this boring: import only from `'@mb/shared'` (one entry point, no deep paths);
shared code uses only erasable TypeScript (`erasableSyntaxOnly`: no enums, no namespaces, no
parameter properties) and `import type` for types (`verbatimModuleSyntax`); `shared/src` is
type checked with no DOM and no Node typings, so it cannot touch either by accident.

## 2. Layout and ownership

```
package.json              workspaces: shared, server, client; root scripts; the shared toolchain
tsconfig.base.json        compiler options every workspace extends (strict)
vitest.config.ts          one test run for the repo: <workspace>/test/**/*.test.ts
scripts/                  dev.mjs (runs server + client), lint.mjs, merge-manifests.mjs
shared/                   @mb/shared: pure TypeScript, no DOM and no Node APIs
  src/math/               vectors, angles, seeded random numbers, geometry tests
  src/defs/               all tunable data: stages, kaiju, factions, units, weapons, upgrades, voiceLines.json
  src/city/               handcrafted layout data, generator, archetypes, spatial index, road graph
  src/sim/                the authoritative simulation: World, systems/, bots/, events
  src/net/                protocol: message types, snapshot codec, input type
  test/                   vitest, including full bot-vs-bot matches
  scripts/                export-defs.ts (archetypes for the art tools), sim.ts (headless match)
server/                   @mb/server: Express + Colyseus room that owns a World
  src/index.ts            entry point: reads the environment, starts the server
  src/config.ts           ServerConfig and every environment variable
  src/room/               the room logic, free of any library: lobby, seats, match loop
  src/net/                the only place that imports Colyseus: server, room adapter, Node test client
  src/http/               Express app: /healthz, the built client, the page fallback
  test/                   unit tests (fake clock, fake connections) and real-network integration tests
client/                   @mb/client
  src/app/                screen state machine: boot, home, lobby, briefing, match, end
  src/net/                connection, snapshot interpolation, input sending, prediction
  src/render/             three.js scene: city, kaiju, units, crowds, projectiles, effects, sky
  src/game/               local player controllers (kaiju, human, map view, drone), input devices
  src/ui/                 HUD, command wheel, menus, lobby, draft, end screen, subtitles
  src/audio/              music stems, positional effects, voice queue
  public/assets/          models/ textures/ sprites/ audio/{music,sfx,voice}/ ui/  + manifest.json
tools/art/                Blender Python sources for every model (source of truth for art)
tools/audio/              music, sound-effect and voice generators (source of truth for audio)
tools/playtest/           Playwright scripts: multi-client smoke test, screenshots
deploy/                   Containerfile, compose file with cloudflared, Windows and WSL scripts
docs/                     requirements.md, DESIGN.md, ARCHITECTURE.md, ASSETS.md, art previews
```

Root scripts (must always work): `npm run dev` (server + client with hot reload),
`npm run build`, `npm start` (production: built client served by the server), `npm test`,
`npm run check` (typecheck all workspaces + lint-level sanity + unit tests; the gate every
change must pass), `npm run sim` (headless bot match that prints balance metrics).

Also: `npm run typecheck`, `npm run lint` (the two halves of `check` besides the tests),
`npm run export:defs` (writes `tools/art/data/archetypes.json` from the code; rerun it whenever
`shared/src/city/archetypes.ts` or `props.ts` changes) and `npm run assets:manifest` (merges the
partial asset manifests, `ASSETS.md` section 7).

The root scripts delegate to workspace scripts with `--workspaces --if-present`, so each
workspace only has to provide the ones that apply to it:

| Workspace script | Meaning | Provided by |
| --- | --- | --- |
| `typecheck` | `tsc --noEmit` for the workspace | shared, server, client |
| `dev` | run with hot reload (started side by side by `scripts/dev.mjs`) | server, client |
| `build` | produce `dist/` | server (esbuild bundle), client (`vite build`) |
| `start` | run the production build | server |
| `sim`, `export:defs` | see above | shared |

Tests are not per workspace: `npm test` runs `vitest run` once from the root.
`MB_CLIENT_PORT` overrides the Vite dev port (default 5173).

## 3. The simulation (`shared/src/sim`)

Pure and deterministic: `World` is created with `createWorld({ seed, config })`, advanced with
`world.step(inputsByPlayer)` at 30 Hz, and emits `SimEvent[]` each tick. No timers, no
`Math.random`, no `Date`: use the world's seeded generator and tick counter. The same code runs
on the server, in headless tests, and (movement only) in the client for prediction.

`inputsByPlayer` is an array indexed by player id; a missing entry repeats that player's last
input. `MatchConfig` (`sim/config.ts`) lists the player slots (slot 0 is the kaiju, then the
squads; bots fill empty slots), the city seed, the starting anchor (or -1 for random) and the
timers (`MatchTuning`; `fastTuning()` is the `MB_FAST` set). Squad commands that do not travel
inside an input are handed over with `queueCommand(world, player, command)`; a dropped player is
given to a bot with `setPlayerBot`.

Ids are array indexes: a kaiju id indexes `world.kaijus`, a squad id `world.squads`, a player id
`world.players`, and a unit id `world.units`, where it always equals `squad id * 4 + slot`. The
16 unit slots are stable for the whole match and are refilled with fresh units at each stage.
Per-player tallies live in `world.players[i].tally`.

State (plain objects and typed arrays, cheap to snapshot):

- `match`: phase, stage, clock, bar points and marks, winner, per-player tallies.
- `kaijus[]`: id, controlling player, kind, stage, pos, yaw, velocity, hp, nerve, rage, action
  state machine (`idle | windup | active | recover | brace | eat | roar | special | stagger |
  cocoon | dead`, with action id and timer), held object, cooldowns, mods.
- `squads[]`: player or bot, faction, level, 4 unit ids, driven unit id (-1 when eliminated),
  movement order, fire mode, call-in cooldowns, upgrades and mods, eliminated flag.
- `units[]`: id, squad, type, pos (and altitude for aircraft), yaw, aim yaw and pitch, hp,
  members, nerve, shaken timer, charge, weapon cooldown, veteran flag.
- `projectiles[]`: id, type, owner, pos, velocity, flight model (`flat | arc | thrown`), ttl.
- City state: `Float32Array` hp per structure id (plus the visual stage per structure), bitset
  of live props, bitset of prop wrecks still lying on the ground; `shields` (zones that reduce
  structure damage, Tier 2) and `insuredStructures` (landmarks covered by the insurance rider).
- Queues filled during a tick: `hits` (drained by the damage system through `applyHit`),
  `structureHits` and `propHits` (drained by the city damage system). Systems never change hp
  directly; they queue. Two things are immediate because the object must be gone at once: a
  kaiju taking a prop, a wreck or a vehicle with its hand or mouth (`takeProp`,
  `takePropWreck`, a direct `applyHit`), and healing (`healKaiju`). All hp of combatants
  changes in `systems/damage.ts`, all city hp in `systems/cityDamage.ts`.
- `kaiju.act` is the action system's own memory (which presses are used, the beam's current
  length and blocker). It is server-side only and not in snapshots.

Systems run in a fixed order each tick: inputs → kaiju actions → unit orders and sub-unit AI →
bots → movement and collision → weapons and volleys → projectiles → damage and nerve → city
damage and bar → molt and match flow → voice cues. Each system is one file in `systems/`,
operates on `World`, and is covered by tests.

| # | File in `sim/systems/` | Reads | Writes |
| --- | --- | --- | --- |
| 1 | `inputs.ts` | this tick's inputs, queued commands | `player.input` (edges, hold timers), `player.commands`, the driven unit's `control` |
| 2 | `kaijuActions.ts` | `player.input` | the kaiju action state machine, held object, cocoon start; queues hits and city damage, spawns thrown projectiles |
| 3 | `unitOrders.ts` | `player.commands` | squad orders, every sub-unit's `control`, charge, takeover |
| 4 | `bots.ts` | the world | `player.botInput` for the NEXT tick (bots use the same input interface as people) |
| 5 | `movement.ts` | `player.input`, `unit.control` | positions, the kaiju's head aim; queues trample and wade damage to the city |
| 6 | `weapons.ts` | `unit.control.fire`, charge | projectiles, volleys, call-in missions |
| 7 | `projectiles.ts` | projectiles | flight, impacts; queues hits, structure and prop damage |
| 8 | `damage.ts` | `hits` | hp, nerve, stagger, shaken, deaths, squad elimination, rage; tramples units under a moving kaiju |
| 9 | `cityDamage.ts` | `structureHits`, `propHits` | structure hp and stages, props and wrecks, the bar, tallies, rage, `barMark`, `moltAvailable` |
| 10 | `matchFlow.ts` | the bar marks, hp, the clock | phases, molt, stage changes, the end |
| 11 | `voice.ts` | this tick's events | `voice` events (throttled) |

`docs/STATUS.md` says which of these are implemented and which are still stubs.

How the kaiju's action state machine, the damage rules and the molt hand over to each other:

- **Actions** (`systems/kaijuActions.ts`, effects in `sim/kaijuEffects.ts`). Every verb runs
  wind-up → effect (instant, or an active phase) → recovery with the timings from its
  definition, and emits `kaijuAction` at each phase change, first at the START of the wind-up.
  A phase of d seconds ends on the first tick at which d has fully passed. The button rules are
  in the header of `net/input.ts`.
- **Stagger** is entered by `applyHit` (phase 'stagger', action 'none'), cutting any action
  short; the action system only counts its timer and the damage system ends it. **Death** sets
  phase 'dead' and `alive = false`; the match flow system ends the match.
- **Molt.** The city damage system sets `kaiju.moltAvailable` (and emits `moltAvailable`) while
  the bar is past the mark of the current stage. The action system starts the cocoon when Molt
  is held: phase 'cocoon', action 'molt', `phaseDuration` = the cocoon time, the `cocoon` event.
  The cocoon is over when `phaseTime >= phaseDuration`; from there the match flow system takes
  over (blast wave, intermission, `beginStage`).
- **The beam** is one pure function, `beamPath(cityQuery, kaiju, action)` (`sim/beam.ts`), used
  by the simulation and meant for clients too: it works from snapshot fields (`kind`, `stage`,
  `x`, `z`, `aimYaw`, `aimPitch`) and the client's mirrored city, and returns the mouth, the
  direction, the length and what stopped the beam. While a special's active phase runs, the
  movement system turns the head only at the special's reduced rate, so the snapshot's
  `aimYaw` / `aimPitch` are the true beam direction.
- **Projectiles** fly along `p0 + v0 t - (0, g t² / 2, 0)` with t counted from the spawn tick
  (`stepProjectile`); a projectile has already flown one step at the end of the tick that
  spawned it. `spawnProjectile(world, init)` is the one way to launch one.

Movement uses one shared pure function,
`stepMovement(body, input, dt, cityQuery, params, result?)`, for circle bodies against
oriented-box structures, so the client can predict its own unit exactly. `params` (top speed,
turn rate, steering model, trample height, wading, bounds) comes from `kaijuMoveParams` or
`unitMoveParams`, which need only what a snapshot carries. `stepMovement` never changes the
city: it reports what the body trampled or waded through and the movement system queues the
damage. `test/prediction.test.ts` plays a server and a snapshot-fed client side by side.

The city (`shared/src/city`): `generateCity(seed)` builds `CityData` (structures, props, road
graph, water and park areas, districts, neighborhood anchors) identically on every machine;
`cityChecksum` verifies it. `buildCityIndex` makes the static spatial index; a `CityQuery` is that
index plus one match's live state (structure hp, live props) and is what every query takes:
`structuresInCircle`, `circleHitsStructure`, `propsInCircle`, `castSegment`, `castRay`,
`lineOfSight`, `structureAt`, `bridgeAt`, `inWater`. `getCity(seed)` caches both.
`stageBounds(city, anchor, stage)` gives the playable square for a stage.

Everything tunable is data in `shared/src/defs/`. Kaiju kinds, unit types, weapons and upgrades
are registered definitions; systems read definitions and `mods`, never hardcode a kind. Adding a
kaiju or faction is adding definitions plus, at most, one behavior module.

## 4. Networking

### 4.1 Rooms, seats and slots

- Room lifecycle: create → 4-letter room code (also in the URL hash for one-click joining) →
  lobby → match → end → lobby. `LobbyState.phase` is `lobby`, `match` or `end`.
- The room is registered with the room library under `ROOM_NAME` (`'mb'`). A client creates a
  room with that name and joins an existing one **by id, where the id is the room code** (in
  capitals; codes use the letters `BCDFGHJKLMNPQRSTVWXZ`). Both calls take `JoinOptions`
  `{ name?, token?, protocol? }`. There is no other way in: "join any room" is switched off.
- A refused create or join fails with an error `code`: 522 (the library's "no such room"),
  `JOIN_ERROR.roomFull` 4401, `JOIN_ERROR.version` 4402 (the client sent a different
  `PROTOCOL_VERSION`: reload), `JOIN_ERROR.serverFull` 4403 (room limit reached).
- A person in the room has a **seat** (0..4, stable while they stay); the first is the host. In
  a match every connected seat gets a **slot** (player id; slot 0 is the kaiju): `pickKaijuSeat`
  applies the volunteer and rotation rules and `buildMatchConfig` turns the lobby into the
  `MatchConfig` (both in `shared/src/net/lobby.ts`). Bots play every other slot. The lobby
  message carries each seat's slot (`LobbyPlayer.slot`, -1 in the lobby and for a spectator) and
  `lastKaijuSeat` (set when a match starts, so during a match it names the current kaiju seat).
- Someone who joins while a match is running takes over a bot squad if one is free (their name
  replaces the bot's on that slot) and otherwise watches (`welcome.playerId` is -1; this also
  happens to the fifth person when the practice option gives the kaiju to a bot). Someone who
  joins on the end screen watches and is sent the result.
- **Session token and reconnecting.** The client makes a random token once (8 to 64 characters
  of `A-Z a-z 0-9 _ -`), keeps it in `localStorage` and sends it with every create and join.
  - A lost connection keeps its seat for a grace period (45 s by default, `MB_GRACE`); in a
    match a bot plays the slot meanwhile and `LobbyPlayer.connected` is false.
  - The room library reconnects a dropped socket by itself while the page is alive; the server
    then sends `lobby` and a fresh `welcome` on the same connection.
  - After a page reload, or when the automatic reconnection gives up, the client joins again by
    code with the same token and gets the same seat and slot back. A join whose token already
    holds a seat always wins it: the older connection is closed with `CLOSE_REPLACED` (4101), so
    two tabs of one browser are one player.
  - After the grace period the seat is given up (`CLOSE_SEAT_RELEASED`, 4102, if that connection
    ever returns); in a match the bot keeps the slot to the end. The room lives as long as
    anybody holds a seat, connected or not.
  - A client must not leave on purpose when the page unloads: an intentional leave gives the
    seat up at once.
- The host role passes to the lowest remaining seat when the host leaves, and to the lowest
  connected seat once the host has been disconnected for 8 s.

### 4.2 Messages

- Client → server (plain data): lobby actions `setName { name }`, `setRole { wantsKaiju,
  kaijuKind? }`, `setFaction { faction }`, `ready { ready }`, `setOptions { botKaiju? }` (host),
  `start {}` (host; everyone else connected must be ready), `toLobby {}` (host, on the end
  screen); in a match `input` (30 Hz):
  `{ seq, moveX, moveZ, aimYaw, aimPitch, buttons, wheel?, marker? }` and `command`
  (`SquadCommand`); any time `ping { t }`. `draftPick { card }` is accepted and ignored until
  drafts exist. Payload types: `ClientMessages` in `shared/src/net/protocol.ts`. The server
  ignores anything malformed, unknown or out of turn; it never answers with an error.
- Server → client: `lobby` `{ lobby, you }` (on joining and on every change), `welcome` (seed,
  config, your ids, the tick, the anchor, a city checksum, full structure and prop state as
  bytes), `snap` (binary, 15 Hz: tick, last processed input seq for you, match scalars, every
  kaiju, squad and unit; compact fixed layout from `shared/src/net/snapshot.ts`, about 800
  bytes for a Tier 1 match), `events` (array of `SimEvent` with their tick), `pong { t, tick }`.
  Payload types: `ServerMessages`. `snap` is the only message sent as raw bytes; everything else
  is plain data in the library's own encoding (MessagePack), in which the `cityState` bytes of
  the welcome arrive as a `Uint8Array`.
- **Order and timing**, which clients may rely on:
  - On joining: `lobby`, then, if a match is running or just ended, `welcome`; on the end screen
    also the final `snap` and an `events` message with the `matchEnd` event.
  - When a match starts: `lobby` (phase `match`), then `welcome` with tick 0.
  - `welcome` arrives again in the same match after a reconnection (same seed and config):
    replace the live city state with its bytes rather than rebuilding the world.
  - Every `events` message is followed at once by the `snap` that covers its ticks. A snapshot
    goes out every second tick; after a hitch one snapshot covers all the ticks caught up, and a
    join or reconnection may add one off the usual rhythm. Do not assume a fixed tick spacing.
  - During a match, everything sent after a `welcome` is newer than its tick.
  - When the match ends: the last `events` (with `matchEnd`) and the final `snap`, then `lobby`
    (phase `end`). Back to the lobby: `lobby` (phase `lobby`, everyone's `ready` cleared).
  - A `lobby` message whose phase goes from `match` straight to `lobby`, with no `matchEnd`,
    means the server abandoned the match after an internal failure: show the lobby.
- **Input semantics** are specified in the header of `shared/src/net/input.ts` and nowhere else:
  the client sends raw button state (`Btn` bits: strike, grab, block, roar, special, molt, fire,
  callIn); the simulation derives presses, releases, taps and holds. `moveX` / `moveZ` are
  relative to the view (`moveZ` forward along `aimYaw`, `moveX` to the right). `wheel` is a
  one-shot command wheel pick and `marker` its ground point. The server cleans every input with
  `sanitizeInput` and every command with `sanitizeCommand`.
- Server helpers: `snapshotOfWorld` + `encodeSnapshot` (encode once, then `setSnapshotAck` per
  client), `welcomeFor(world, player)`. Client helpers: `decodeSnapshot`, `decodeCityState` +
  `cityStateFromWire` (the live city state for local queries and prediction).
- Projectiles are **not** in snapshots. Clients spawn them from `projectileSpawn` events and fly
  them locally with the same kinematics; `projectileHit` ends them.
- Structure changes are events (`structureStage { id, stage }` with stage 0 intact, 1 damaged,
  2 heavily damaged, 3 rubble), one message per state change.
- The client predicts its own body with `stepMovement`, replays unacknowledged inputs on each
  snapshot, and smooths small corrections. Everything else is interpolated about 100 ms in the
  past. Attack wind-ups start instantly on the local client (the server remains the judge of
  hits).

### 4.3 The server loop (`server/src/room`)

- One timer per room aims at absolute 30 Hz deadlines and calls `GameRoom.update()`. The
  accumulator (`fixedStep.ts`) turns elapsed time into ticks and cannot spiral: a gap counts for
  at most 250 ms, one update runs at most 4 ticks, and anything owed beyond that is dropped (the
  match runs slow for a moment instead of catching up forever).
- Each tick takes **one input per connected player** from that player's short queue and echoes
  its `seq` as the snapshot acknowledgement. An empty queue repeats the previous input; after
  15 empty ticks (0.5 s) a connected but silent player is brought to a stop. A queue that grows
  past 5 inputs is cut back to the newest 2, which returns the player to real time (a command
  wheel pick in a discarded input is carried over). The acknowledgement starts again from 0 for
  a new page (token rejoin) and carries on for an automatic reconnection.
- If the simulation throws, the match is abandoned and the room returns to the lobby; the
  server keeps running.
- The end screen returns to the lobby when the host sends `toLobby`, or by itself after 120 s
  (20 s with `MB_FAST`, `MB_END_SCREEN` to change, 0 to wait for the host).

### 4.4 Running the server

- HTTP on the same port: `GET /healthz` (JSON: `ok`, `protocol`, `uptime`, `rooms`, `players`,
  `fast`), the built client from `client/dist` when it exists, and the game page for any other
  page address. Build files with a content hash in their name are cached for good; everything
  else is revalidated. A missing file is a 404, never the page.
- No absolute address anywhere: the page, the matchmaking requests (`POST /matchmake/...`) and
  the WebSocket (`/<process id>/<room code>`) all go to the origin the page came from, so one
  hostname behind a tunnel or reverse proxy is enough. Failed matchmaking answers with ordinary
  HTTP statuses (404, 500) and the error code in the body, because Cloudflare replaces the
  library's default 52x statuses with its own pages.
- Environment (`server/src/config.ts`): `PORT` (2567), `HOST`, `MB_FAST=1` (short match timers
  and a small bar, set as `LobbyOptions.fast`), `MB_LATENCY` (simulated round-trip milliseconds),
  `MB_SPEED` (simulation speed multiplier for headless tests; real clients cannot predict at
  any speed but 1), `MB_GRACE` (seconds a dropped seat is kept), `MB_END_SCREEN`,
  `MB_MAX_ROOMS` (50), `MB_CLIENT_DIR` (the built client, default `client/dist`), `MB_QUIET=1`.
- `server/src/net/nodeClient.ts` is a typed headless client for Node (`createRoom`, `joinRoom`),
  used by the integration tests and available to tools. The browser wrapper in
  `client/src/net` follows the same recipe with `@colyseus/sdk`.

`SimEvent` kinds (extend as needed, never rename casually): `projectileSpawn`, `projectileHit`,
`structureStage`, `propsDestroyed`, `kaijuAction`, `kaijuHit`, `kaijuStagger`, `kaijuHeld`,
`nerveBreak`, `crossfire`, `unitHit`, `memberLost`, `unitDestroyed`, `unitShaken`, `takeover`,
`volley`, `roar`, `callin`, `moltAvailable`, `cocoon`, `moltBlast`, `stageChange`, `barMark`,
`matchPhase`, `voice`, `matchEnd`. Every event carries its `tick`; the payloads are defined and
documented in `shared/src/sim/events.ts`.

What clients can rely on from the kaiju and city events:

- The live city can be mirrored from events alone: `structureStage` (stage per structure),
  `propsDestroyed` (the props are gone; cars leave a wreck) and `kaijuHeld` (`source: 'prop'`:
  that prop is gone with no wreck; `'propWreck'`: that wreck is gone; `'unitWreck'`: that dead
  vehicle's wreck is gone, which the snapshot's unit flags also show).
  `shared/test/scenario.test.ts` checks this.
- `kaijuAction` carries an optional `elapsed`: a Swipe wind-up that becomes a Stomp is announced
  as a Stomp wind-up of the full length with the time already spent. An action whose effect is
  instant (grab, throw) still sends its active phase, with duration 0, at the moment it lands.
  A stagger cuts an action short without a closing `kaijuAction`: `kaijuStagger` is the signal.
- Damage that is dealt a little every tick (the beam, being trampled) sends `unitHit` /
  `kaijuHit` only every sixth tick; hp in snapshots is always current.
- `crossfire` is sent at most once a second per kaiju.

Enumerated ids (kaiju kinds, actions, phases, factions, unit types, ...) are `const` arrays in
`shared/src/defs/ids.ts`, and an id's position in its array is its code in the binary snapshot.
**Only append to those arrays.** Reordering or removing an entry, or changing the snapshot
layout, requires bumping `SNAPSHOT_VERSION` / `PROTOCOL_VERSION`.

## 5. Client

- `AssetStore` loads `public/assets/manifest.json`. **Every asset has a procedural fallback**
  (boxes, beeps, text-free placeholder icons) so the game runs before any art or audio lands,
  and a missing file is a console warning, never a crash.
- Rendering style: flat-shaded low-poly, saturated palette, nearest-filtered low-resolution
  textures, fog and haze for scale, no dynamic shadow maps (blob shadows only), additive glow
  sprites for projectiles and lasers. Budget at stage 3 with the whole city in view: under 350
  draw calls and under 1.5 million triangles; use `InstancedMesh` per structure archetype and
  one instanced quad batch for all sprites (soldiers, civilians): 2000 sprites must be cheap.
- Kaiju and vehicles are rigid segmented models (named nodes, see `ASSETS.md`) animated in code:
  walk cycles, wind-ups and recoveries are procedural, driven by the action state and timers.
- Structures: per archetype one instanced mesh per visual state (intact, damaged, rubble).
  Collapse is a client-only effect: spawn that archetype's pre-made chunks, tumble them with
  cheap fake physics, dust, then show rubble.
- UI is DOM over the canvas. The no-reading rule in `DESIGN.md` §8 is binding.
- Input: keyboard and mouse, and gamepad; button glyphs follow the last device used.
- Debug and automation hooks (required for automated playtests): `window.__mb` exposes state,
  `renderer.info`, and helpers; `?autoplay=1` makes the client play itself with a simple
  autopilot; `?debug=1` shows an overlay. The server honors `MB_FAST=1` (short timers) and a
  practice option (bot kaiju), see section 4.4.

## 6. Quality gates

- `npm run check` passes before any task is called done. No skipped tests. It runs, in order:
  `tsc --noEmit` for every workspace; `scripts/lint.mjs` (shared code is pure: no DOM, Node,
  clocks, `Math.random` or `console`; shared, server and client respect the import layering; the
  room library stays inside the two `net/` wrappers; no unexplained `any`; no `@ts-ignore`; no
  `.only` / `.skip` in tests; no network URLs in the client); then every test.
- Headless bot-vs-bot matches (`npm run sim`) finish without errors and print: winner, match
  length, time per stage, breaks, kills. These are the balance instrument.
- Browser playtest (`tools/playtest`): server + 5 headless clients complete a `MB_FAST` match
  with zero console errors, and screenshots are captured for visual review.
- Never commit secrets. Never add a dependency that needs a network service at runtime: the
  game must run fully offline on one PC plus a tunnel.

## 7. Conventions

- Small modules, plain data, no classes where a function does. No `any` without a comment.
- IDs are small integers. Angles are radians. Times are seconds (ticks only inside the sim).
- Comments explain why, not what. No model or tool names in code, comments or commit messages.
- Shared code never imports from client or server. Client and server never import each other.
- No TypeScript enums or namespaces (the compiler option `erasableSyntaxOnly` forbids them): use
  `const` arrays and union types, as `shared/src/defs/ids.ts` does.
- A placeholder that a later task must replace is marked with a comment starting `STUB(<area>):`
  that says what is missing; `npm run lint` prints how many remain, and `docs/STATUS.md` lists them.
