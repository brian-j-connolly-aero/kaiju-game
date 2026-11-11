# Monster Battle 9001: Architecture

Living contract for everyone working in this repo. Keep it accurate: if you change a contract in
code, update this file in the same change.

## 1. Stack

- **Language:** TypeScript everywhere, strict mode. Node 22. npm workspaces.
- **Client:** Vite + three.js (WebGLRenderer). Vanilla TS with DOM and CSS overlays for all UI.
  No UI framework.
- **Server:** Node + Express (serves the built client) + Colyseus (rooms, invite codes,
  reconnect). One process, one port (default 2567), so a single Cloudflare Tunnel hostname
  carries both the page and the WebSocket.
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
  of live props, bitset of prop wrecks still lying on the ground.
- Queues filled during a tick: `hits` (drained by the damage system through `applyHit`),
  `structureHits` and `propHits` (drained by the city damage system). Systems never change hp
  directly; they queue.

Systems run in a fixed order each tick: inputs → kaiju actions → unit orders and sub-unit AI →
bots → movement and collision → weapons and volleys → projectiles → damage and nerve → city
damage and bar → molt and match flow → voice cues. Each system is one file in `systems/`,
operates on `World`, and is covered by tests.

| # | File in `sim/systems/` | Reads | Writes |
| --- | --- | --- | --- |
| 1 | `inputs.ts` | this tick's inputs, queued commands | `player.input` (edges, hold timers), `player.commands`, the driven unit's `control` |
| 2 | `kaijuActions.ts` | `player.input` | the kaiju action state machine; queues hits |
| 3 | `unitOrders.ts` | `player.commands` | squad orders, every sub-unit's `control`, charge, takeover |
| 4 | `bots.ts` | the world | `player.botInput` for the NEXT tick (bots use the same input interface as people) |
| 5 | `movement.ts` | `player.input`, `unit.control` | positions; queues trample and wade damage |
| 6 | `weapons.ts` | `unit.control.fire`, charge | projectiles, volleys, call-in missions |
| 7 | `projectiles.ts` | projectiles | queues hits and structure damage |
| 8 | `damage.ts` | `hits` | hp, nerve, stagger, shaken, deaths |
| 9 | `cityDamage.ts` | `structureHits`, `propHits` | structure hp and stages, the bar, `barMark` |
| 10 | `matchFlow.ts` | the bar marks, hp, the clock | phases, molt, stage changes, the end |
| 11 | `voice.ts` | this tick's events | `voice` events (throttled) |

`docs/STATUS.md` says which of these are implemented and which are still stubs.

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

- Room lifecycle: create → 4-letter room code (also in the URL hash for one-click joining) →
  lobby → match → end → lobby. Reconnect: a session token in `localStorage` reclaims the slot.
- Client → server messages (JSON): lobby actions (`setName`, `setRole`, `setFaction`, `ready`,
  `setOptions`, `start`, `toLobby`), `input` (30 Hz):
  `{ seq, moveX, moveZ, aimYaw, aimPitch, buttons, wheel?, marker? }`, `command`, `draftPick`,
  `ping`. Payload types: `ClientMessages` in `shared/src/net/protocol.ts`.
- Server → client: `welcome` (seed, config, your ids, the anchor, a city checksum, full
  structure and prop state as bytes), `lobby` (JSON on change, with your seat), `snap` (binary,
  15 Hz: tick, last processed input seq for you, match scalars, every kaiju, squad and unit;
  compact fixed layout from `shared/src/net/snapshot.ts`, about 800 bytes for a Tier 1 match),
  `events` (JSON array of `SimEvent` with their tick, sent with the snapshot), `pong`. Payload
  types: `ServerMessages`.
- **Input semantics** are specified in the header of `shared/src/net/input.ts` and nowhere else:
  the client sends raw button state (`Btn` bits: strike, grab, block, roar, special, molt, fire,
  callIn); the simulation derives presses, releases, taps and holds. `moveX` / `moveZ` are
  relative to the view (`moveZ` forward along `aimYaw`, `moveX` to the right). `wheel` is a
  one-shot command wheel pick and `marker` its ground point. The server cleans every input with
  `sanitizeInput` and every command with `sanitizeCommand`.
- A person in the lobby has a **seat** (0..4); in a match every seat gets a **slot** (player id):
  `pickKaijuSeat` applies the volunteer and rotation rules and `buildMatchConfig` turns the
  lobby into the `MatchConfig` (both in `shared/src/net/lobby.ts`).
- Server helpers: `snapshotOfWorld` + `encodeSnapshot` (encode once, then `setSnapshotAck` per
  client), `welcomeFor(world, player)`. Client helpers: `decodeSnapshot`, `decodeCityState` +
  `cityStateFromWire` (the live city state for local queries and prediction).
- Projectiles are **not** in snapshots. Clients spawn them from `projectileSpawn` events and fly
  them locally with the same kinematics; `projectileHit` ends them.
- Structure changes are events (`structureStage { id, stage }` with stage 0 intact, 1 damaged,
  2 heavily damaged, 3 rubble), one message per state change.
- The server processes one input per player per tick from a short queue and echoes the last
  processed `seq`. The client predicts its own body with `stepMovement`, replays unacknowledged
  inputs on each snapshot, and smooths small corrections. Everything else is interpolated about
  100 ms in the past. Attack wind-ups start instantly on the local client (the server remains
  the judge of hits).

`SimEvent` kinds (extend as needed, never rename casually): `projectileSpawn`, `projectileHit`,
`structureStage`, `propsDestroyed`, `kaijuAction`, `kaijuHit`, `kaijuStagger`, `kaijuHeld`,
`nerveBreak`, `crossfire`, `unitHit`, `memberLost`, `unitDestroyed`, `unitShaken`, `takeover`,
`volley`, `roar`, `callin`, `moltAvailable`, `cocoon`, `moltBlast`, `stageChange`, `barMark`,
`matchPhase`, `voice`, `matchEnd`. Every event carries its `tick`; the payloads are defined and
documented in `shared/src/sim/events.ts`.

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
  practice option (bot kaiju).

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
