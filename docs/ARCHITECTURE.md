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
scripts/                  dev.mjs (runs server + client), lint.mjs
shared/                   @mb/shared: pure TypeScript, no DOM and no Node APIs
  src/math/               vectors, angles, seeded random numbers, geometry tests
  src/defs/               all tunable data: stages, kaiju, factions, units, weapons, upgrades, voiceLines.json
  src/city/               handcrafted layout data, generator, archetypes, spatial index, road graph
  src/sim/                the authoritative simulation: World, systems/, bots/, events
  src/net/                protocol: message types, snapshot codec, input type
  test/                   vitest, including full bot-vs-bot matches
  scripts/                export-defs.ts (archetypes for the art tools), sim.ts (the balance harness),
                          botMatch.ts (plays one bot match and reports on it; also used by tests)
server/                   @mb/server: Express + Colyseus room that owns a World
  src/index.ts            entry point: reads the environment, starts the server
  src/config.ts           ServerConfig and every environment variable
  src/crashGuard.ts       the process's safety net: an error nobody caught is logged, not fatal
  src/room/               the room logic, free of any library: lobby, seats, match loop
  src/net/                the only place that imports Colyseus: server, room adapter, Node test client
  src/http/               guard.ts (the front door: size and sanity checks, per-visitor limits) and
                          app.ts (Express: /healthz, the built client, the page fallback)
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
tools/playtest/           Playwright scripts: smoke.mjs (multi-client match on autoplay), shots.mjs (stage
                          screenshots), scripted.mjs (two sessions played with real key and mouse events,
                          every action judged by what the server sent back), driver.mjs (the hands it uses)
tools/build-manifest.mjs  the `assets:manifest` script: merges partial manifests, checks files
Containerfile             the container image (self-hosting; owner's guide: docs/HOSTING.md)
compose.yaml              the game + Cloudflare Tunnel services; settings in .env (.env.example)
host/                     one-command start, stop, update, logs: .cmd + .ps1 for Windows, .sh for Linux and WSL
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
timers (`MatchTuning`; `fastTuning()` is the `MB_FAST` set) and, optionally, bot handicaps
(`bots`: 0 is a bot at its best, 1 leaves it standing still; `idleBots()` for tests; and
`bots.triggerHappy`, a harness profile in which squad bots hold the trigger instead of
charging volleys). Squad
commands that do not travel inside an input are handed over with
`queueCommand(world, player, command)`.

People coming and going is one hook: `setPlayerBot(world, player, bot)`. With `true` a bot takes
the slot over from the next tick, with a blank mind, from whatever state the slot is in (a
dropped player, or a slot nobody ever had). With `false` the slot goes (back) to a person: the
bot lets go of every control at once, and nothing is pressed for them until their own first
input arrives. Any slot can change hands at any time, the kaiju's included; calling it with the
state the slot is already in does nothing.

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
  movement order, fire mode, call-in cooldowns, upgrades and mods, eliminated flag; server-side
  only: the leader's `trail`, `formed`, `volleyReady`, and the order budget (`orderBudget`,
  `pendingOrders`: wheel orders are carried out a few a second, see below).
- `units[]`: id, squad, type, pos (and altitude for aircraft), yaw, aim yaw and pitch, hp,
  members, nerve, shaken timer, charge, weapon cooldown, veteran flag, `rooted` and `arcYaw`
  (the firing arc of a planted unit); server-side only: `nav` (hold point, route, steering
  memory of a sub-unit; `sim/nav.ts`).
- `projectiles[]`: id, type, owner, pos, velocity, flight model (`flat | arc | thrown`), ttl.
- `callIns[]`: artillery missions on their way (marker, timers, shells left, approach direction).
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
  length and blocker). It is server-side only and not in snapshots. So are `kaiju.recentHits`
  (crossfire) and `kaiju.volleyHits` (each squad's latest charged volley hit, for the rule
  that it takes two squads to break its nerve).

Systems run in a fixed order each tick: inputs → kaiju actions → unit orders and sub-unit AI →
bots → movement and collision → weapons and volleys → projectiles → damage and nerve → city
damage and bar → molt and match flow → voice cues. Each system is one file in `systems/`,
operates on `World`, and is covered by tests.

| # | File in `sim/systems/` | Reads | Writes |
| --- | --- | --- | --- |
| 1 | `inputs.ts` | this tick's inputs, queued commands | `player.input` (edges, hold timers), `player.commands`, the driven unit's `control` |
| 2 | `kaijuActions.ts` | `player.input` | the kaiju action state machine, held object, cocoon start; queues hits and city damage, spawns thrown projectiles |
| 3 | `unitOrders.ts` | `player.commands`, the kaiju, the city | spotting, takeover, squad orders, call-in missions, every sub-unit's `control`, `rooted`, `arcYaw`, charge, `state`, `nav` |
| 4 | `bots.ts` | the world | `player.botInput` for the NEXT tick (bots use the same input interface as people); `player.botState` |
| 5 | `movement.ts` | `player.input`, `unit.control` | positions, the kaiju's head aim; queues trample and wade damage to the city |
| 6 | `weapons.ts` | `unit.control.fire`, aim, charge, `callIns` | weapon and call-in cooldowns, projectiles (salvos, volleys, shells), `volley`, the later `callin` phases |
| 7 | `projectiles.ts` | projectiles | flight, impacts; queues hits, structure and prop damage |
| 8 | `damage.ts` | `hits` | hp, nerve, stagger, shaken, deaths, squad elimination, rage; tramples units under a moving kaiju |
| 9 | `cityDamage.ts` | `structureHits`, `propHits` | structure hp and stages, props and wrecks, the bar, tallies, rage, `barMark`, `moltAvailable` |
| 10 | `matchFlow.ts` | the bar marks, hp, the clock, a cocoon that has run its time | phases, the clock, the end of the molt (blast wave, the kaiju's new body, intermission, `beginStage`), the end of the match |
| 11 | `voice.ts` | this tick's events, kaiju hp, the bar | `voice` events with the lines to play (rationed) |

All eleven are implemented; `docs/STATUS.md` lists what is still a stub elsewhere.

How a match runs from start to end (`systems/matchFlow.ts`; rules in `DESIGN.md` section 2):

- `match.phase` goes 'briefing' (timed) -> 'playing' -> 'intermission' (timed) -> 'playing' ->
  'intermission' -> 'playing' -> 'ended'. Every change is a `matchPhase` event. The clock,
  `elapsed` and `stageTime` only count while the phase is 'playing'.
- The end is checked every tick of play, in this order: a kaiju at 0 hp (humans, 'kill'), the
  bar past the third mark (kaiju, 'bar'), the clock at 0 (humans, 'clock'). `matchEnd` carries
  the tallies; after it `world.step` does nothing.
- The molt, on the tick a cocoon has run its time, in this order of events: `moltBlast`; for
  every unit it reaches `unitDestroyed` (inside the kill radius) or `unitShaken` (inside the
  shove radius; those units also get a velocity kick outward); `kaijuAction` (molt, 'idle')
  with the kaiju already at its new stage, size, full hp and nerve; a `projectileHit` with
  target 'none' for everything that was in flight; `callin` 'done' for every running mission;
  `matchPhase` 'intermission' with `duration` and `nextStage`. During the intermission
  `match.stage` and `match.bounds` are still the old ones, only `kaiju.stage` is new, inputs
  do nothing, and thrown units slide to a stop. When it is over: `stageChange` (new stage and
  bounds; squads refilled and redeployed, survivors as veterans) and `matchPhase` 'playing'.
- `beginStage(world, stage)` alone (tests and the sandbox call it to jump to a stage) does the
  last step only: it clears projectiles and missions without events and marks no veterans.

How the bots are put together (`sim/bots/`, numbers in `defs/bots.ts`; behavior in `DESIGN.md`
section 5, "Bots"):

- `systems/bots.ts` calls `kaijuBot` or `squadBot` for every slot with `player.bot` set. Each
  writes `player.botInput` (a plain `PlayerInput`: stick relative to its aim, aim, button bits,
  `wheel`, `marker`), which the input system applies on the next tick exactly as it applies a
  person's. Bots read the World freely but change nothing in it except their own
  `player.botState` and, for a squad leader, the route memory of the unit it drives
  (`unit.nav`, through `steerToward`, the same navigation the sub-units use).
- A squad bot acts on what the humans' map shows (`kaiju.known`), not on where the kaiju is.
- Bots draw their random numbers from `world.rng`, so a match with bots is as reproducible as
  one without. A bot handicapped to 1 draws none and sends neutral inputs.
- `test/bots.test.ts` checks every input a bot sends over a whole match against
  `sanitizeInput`: a bot can do nothing a client could not.

How the radio works (`systems/voice.ts`, rules per cue in `defs/voice.ts`): every cue goes
through `say(world, cue, squad?, player?)`, which applies the cue's minimum gap and the chatter
budget (`VOICE_CUE_RULES`, `VOICE_RULES`), then chooses the lines for both sides from
`voiceLines.json` as it stands (`chooseVoiceLines`) and emits the `voice` event. Clients play
`event.lines.humans` or `event.lines.kaiju` in order (ids are also the audio file names); they
do not choose lines themselves. (`pickVoiceLine` remains for tools that only have a cue.)

How the human side is put together (`DESIGN.md` section 5 has the rules):

- **Orders** (`systems/unitOrders.ts`). Wheel orders are carried out from a per-squad budget
  (`takeOrders`: `SQUAD_RULES.orderBurst` at once, then `ordersPerSecond`; a newer order of
  the same kind replaces one still waiting; one move-to is planned per tick in the whole
  match), so the planning a command costs is bounded whatever a client sends. Call-ins are
  not held up. The driven unit's `control` comes straight from its
  player's input. Every other living unit of the squad is a sub-unit and gets its `control`
  here each tick: where to go (its hold point, or its slot in the column behind the leader),
  where to point its weapon, and whether to fire at will. Hold-and-charge is a per-unit state:
  `rooted` (planted), `arcYaw` (the arc it is locked to), `charge`, `state` 'charging' (which
  is what the snapshot's `laser` flag reports). Squad helpers that bots and clients can use
  are in `sim/squads.ts`: `formationSlot`, `scatterMult` and `kaijuIsSlowed` (both work on
  snapshot data), `arcCovers`, `laserOnKaiju` / `lasersOnKaiju`, `squadCharge`, `markVeterans`.
- **Navigation** (`sim/nav.ts`). `steerToward(world, unit, x, z, tolerance, out)` answers with
  a direction and a throttle: the straight line when the unit's whole width fits
  (`corridorClear`), otherwise along the road graph (onto the nearest street it can reach,
  Dijkstra through the crossroads inside the bounds, off at the point nearest the goal), with
  a look-ahead that steers round walls on every leg. It never moves anything: the movement
  system does, with the same `stepMovement` as everybody. A sub-unit that has dropped out of
  formation gets `nav.hurry` (a multiplier on its top speed); the driven unit never does, so
  client prediction of one's own unit is unaffected.
- **Weapons** (`systems/weapons.ts`). A unit that fires launches one projectile per launcher or
  tank with `spawnProjectile`. The driven unit's shot goes to its aim point
  (`resolveAimPoint` from the eye, kaiju included) and is the volley trigger; sub-units fire
  along their own aim. What a sub-unit's shot in a volley is worth follows its charge
  (`volleyStrength`, `isChargedVolley` in `sim/squads.ts`): ragged below
  `COMBAT_RULES.volleyMinCharge`, a charged volley from there up. A unit's projectile lives
  for `SQUAD_RULES.rangeSlack` times its weapon's range (`ttl`), which is how range limits
  every shot. Aim error is added per projectile from the world's generator. Call-in
  missions live in `world.callIns` and release their shells here.
- **Markers placed with the crosshair** (`resolveMarkerPoint` in `sim/aim.ts`, called by the
  input system for a move-to or a call-in that carries no map marker): the ground under a
  kaiju the crosshair is on, else where the aim ray lands, else a kaiju on the map just
  beside the crosshair, else a short way ahead (move-to) or nothing (call-in). It needs only
  snapshot data, so a client can show where a marker would go.
- **Breaking nerve** (`systems/damage.ts`). A hit carries `volleySquad` when it is part of a
  charged volley; the kaiju remembers each squad's latest one (`volleyHits`) and its nerve
  breaks only while `COMBAT_RULES.breakSquads` squads have landed one within
  `volleyBreakWindow` seconds. Otherwise nerve stops at capacity.
- **Bridge decks.** For bodies a deck is road surface; so it is for everything that flies or
  looks: `castSegment`, `castRay` and `lineOfSight` take a `skipPassable` flag, and projectile
  flight, spotting, lines of fire, corridors and `resolveAimPoint` all set it. A projectile that
  reaches the ground on a standing deck reports the deck as the structure it hit. (The beam is
  the exception: `beamPath` still stops at a deck.)

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
  direction, the length and what stopped the beam. The mouth and the eye are where the model
  has them, ahead of the body's axis along the aim heading (`kaijuMouthPoint`, `kaijuEyePoint`
  in `sim/aim.ts`, from `mouthHeight` / `mouthForward` and `eyeHeight` / `eyeForward` in the
  kind's stage definition); the throw's aim ray starts at the eye. While a special's active phase runs, the
  movement system turns the head only at the special's reduced rate, so the snapshot's
  `aimYaw` / `aimPitch` are the true beam direction.
- **Projectiles** fly along `p0 + v0 t - (0, g t² / 2, 0)` with t counted from the spawn tick
  (`stepProjectile`); a projectile has already flown one step at the end of the tick that
  spawned it. `spawnProjectile(world, init)` is the one way to launch one. The kaiju's throw,
  unit fire, volleys and artillery shells all use it.

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
  capitals; codes use the letters `BCDFGHJKLMNPQRSTVWXZ`, each drawn from the system's random
  generator, so one code says nothing about the next). Both calls take `JoinOptions`
  `{ name?, token?, protocol?, build? }`. There is no other way in: "join any room" is switched
  off.
- A refused create or join fails with an error `code`: 522 (the library's "no such room"),
  `JOIN_ERROR.roomFull` 4401 (every seat is taken, dropped players' seats included),
  `JOIN_ERROR.version` 4402 (the page is from another build of the game than the server, see
  "Build stamp" below), `JOIN_ERROR.serverFull` 4403 (room limit reached), `JOIN_ERROR.busy`
  4404 (this visitor sent too many matchmaking requests in a minute: wait and try again; the
  client's rejoin loop treats it like a network failure and retries). The front door answers
  400 and 413 with those numbers as the code (section 4.4).
- **Build stamp** (`shared/src/net/build.ts`). `JoinOptions.build` is `<rules>.<page>`:
  - `rules` is a fingerprint both sides work out for themselves when first asked: every data
    export of `shared/src/defs` (tuning, id lists, voice lines), the checksum of the generated
    city, `PROTOCOL_VERSION` and `SNAPSHOT_VERSION`. Nobody bumps it; it is the same in
    development, in tests and in the production build, and changes when any of those change.
  - `page` is the file name of the script the page was started from, which in the production
    build carries a hash of all client and shared code. The server reads it from the
    `index.html` it serves (afresh at every join, so a rebuilt client is noticed without a
    restart); the page reads it from its own document. In development it is empty on the
    page's side, and then only the rules are compared.
  - A page whose stamp does not match (`buildsMatch`), or that sends none, is refused with
    `JOIN_ERROR.version`. The page then reloads itself once (remembered in `sessionStorage`
    until a join succeeds, so it cannot loop; the room code is kept in the address) and, if it
    is refused again, fails like any other join (`ClosedReason` `'version'`). The same happens
    when a `welcome` describes a city the page cannot build: it leaves the room instead of
    sitting in the lobby. The server prints one line per refusal: if every page is refused,
    the server is the one that is out of date.
  - `/healthz` and the start-up line show the server's stamp.
- A person in the room has a **seat** (0..4, stable while they stay); the first is the host. In
  a match every connected seat gets a **slot** (player id; slot 0 is the kaiju): `pickKaijuSeat`
  applies the volunteer and rotation rules and `buildMatchConfig` turns the lobby into the
  `MatchConfig` (both in `shared/src/net/lobby.ts`). Bots play every other slot. The lobby
  message carries each seat's slot (`LobbyPlayer.slot`, -1 in the lobby and for a spectator) and
  `lastKaijuSeat` (set when a match starts, so during a match it names the current kaiju seat).
- Someone who joins while a match is running takes over a bot squad if one is free (their name
  replaces the bot's on that slot; a squad nobody has played in this match before one whose
  player is away) and otherwise watches (`welcome.playerId` is -1; this also happens to the
  fifth person when the practice option gives the kaiju to a bot). A newcomer is never given
  the kaiju. Someone who joins on the end screen watches and is sent the result.
- **Session token and reconnecting.** The client makes a random token once (8 to 64 characters
  of `A-Z a-z 0-9 _ -`), keeps it in `localStorage` and sends it with every create and join.
  - A lost connection keeps its seat for a grace period (45 s by default, `MB_GRACE`); in a
    match a bot plays the slot meanwhile and `LobbyPlayer.connected` is false. The seat is kept
    for its owner alone: while all five seats are taken, dropped ones included, a newcomer is
    refused (`JOIN_ERROR.roomFull`), however briefly the owner has been gone.
  - The room library reconnects a dropped socket by itself while the page is alive; the server
    then sends `lobby` and a fresh `welcome` on the same connection.
  - After a page reload, or when the automatic reconnection gives up, the client joins again by
    code with the same token and gets the same seat and slot back. A join whose token already
    holds a seat always wins it: the older connection is closed with `CLOSE_REPLACED` (4101), so
    two tabs of one browser are one player.
  - After the grace period the seat is given up (`CLOSE_SEAT_RELEASED`, 4102, if that connection
    ever returns) and a newcomer may take it. In a match the bot keeps the slot, but the match
    remembers which token played which slot: a player who comes back later with the same token
    gets a new seat and, while a bot still plays it, their old slot, the kaiju included (if
    somebody else took their squad meanwhile they get another free squad, or watch). The room
    lives as long as anybody holds a seat, connected or not.
  - A client must not leave on purpose when the page unloads: an intentional leave gives the
    seat up at once.
- The host role passes to the lowest remaining seat when the host leaves, and to the lowest
  connected seat once the host has been disconnected for 8 s.
- **Starting.** The host may start when everybody else who is connected is ready, or has been
  in the lobby for 20 s without getting ready: the server then sets `LobbyPlayer.waited` on
  them (and sends the lobby again), and `canStartMatch(lobby)` no longer waits for them. The
  20 s start over when a player joins, reconnects, or the room returns from a match. Somebody
  the host starts without is in the match all the same (their squad is there when they come
  back to the keyboard) but is never chosen as the kaiju. A lobby screen should mark a player
  who is connected, not ready and not `waited` as the one being waited for.
- Other close codes a client may see: `CLOSE_JOIN_TIMEOUT` 4103 (the connection never finished
  joining) and `CLOSE_BACKLOG` 4104 (it stopped reading what it was sent). Both mean "join
  again", which the client's rejoin with its token does.

### 4.2 Messages

- Client → server (plain data): lobby actions `setName { name }`, `setRole { wantsKaiju,
  kaijuKind? }`, `setFaction { faction }`, `ready { ready }`, `setOptions { botKaiju? }` (host),
  `start {}` (host; everyone else connected must be ready or `waited`, section 4.1), `toLobby {}`
  (host, on the end screen); in a match `input` (30 Hz):
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
  snapshot, and smooths small corrections. The body is drawn between its last two predicted
  poses, so it moves on every frame and not only on every tick. Everything else is
  interpolated about 100 ms in the past, on a clock that never runs backwards. Attack
  wind-ups start instantly on the local client (the server remains the judge of hits).
- The buttons of an input are everything that was down at any moment since the previous
  input was built, so a click shorter than the gap between two inputs is in exactly one.
- Events that could not be shown for more than two seconds (a hidden tab) are handed to the
  client's own listeners with `MatchSession.catchingUp` set: lasting state is taken over and
  nothing is played back.

### 4.3 The server loop (`server/src/room`)

- One timer per room aims at absolute 30 Hz deadlines and calls `GameRoom.update()`. The
  accumulator (`fixedStep.ts`) turns elapsed time into ticks and cannot spiral: a gap counts for
  at most 250 ms, one update runs at most 4 ticks, and anything owed beyond that is dropped (the
  match runs slow for a moment instead of catching up forever).
- Each tick takes **one input per connected player** from that player's short queue and echoes
  its `seq` as the snapshot acknowledgement. An empty queue means the tick is played on a
  guess, the previous input again with held buttons still held; after 15 such ticks (0.5 s) a
  connected but silent player is brought to a stop. The acknowledgement starts again from 0
  for a new page (token rejoin) and carries on for an automatic reconnection.
- **After a stall** the late inputs arrive all at once. When the queue then holds more than 5,
  it skips inputs back down to 2 to return the player to real time, but only inputs that carry
  no news (`inputQueue.ts`): one whose buttons are the same as in the input before it, and that
  either stands for a tick that was guessed or has none of Strike, Grab and Molt down. An
  input in which a button goes down or comes up, and every input of a hold in progress, is
  kept and played in order, so a tap inside the stall still happens and a hold is as long as
  the player made it. A command wheel pick in a skipped input is carried over. Only a queue of
  more than 20 is cut back regardless (a press is still carried over). What this cannot mend:
  a tap whose release is itself stuck behind a stall of about 0.4 s or more has by then been
  guessed into a hold (`docs/STATUS.md`, known risks).
- If the simulation throws, the match is abandoned and the room returns to the lobby; the
  server keeps running.
- The end screen returns to the lobby when the host sends `toLobby`, or by itself after 120 s
  (20 s with `MB_FAST`, `MB_END_SCREEN` to change, 0 to wait for the host).

### 4.4 Running the server

- HTTP on the same port: `GET /healthz` (JSON: `ok`, `protocol`, `build`, `uptime`, `rooms`,
  `players`, `fast`, `perf`), the built client from `client/dist` when it exists, and the game
  page at the root. Any other page address is redirected (302) to the root, because the page
  finds its script and assets relative to its own address; one that ends in a room code
  (`/BCDF`, `/join/bcdf/`) is redirected to `/#BCDF`, which joins that room. `perf` is the room loop's own timing over the most recent updates of
  running matches, all rooms together (`server/src/room/perf.ts`; a ring of 3000 updates, about
  100 s): `samples`, `updateMs` and `gapMs` (each `mean`, `p99`, `max`, in milliseconds: the time
  inside one update, and the time between two updates, which the timer aims to keep at 33.3) and
  `ticksPerSecond` (30 when the server keeps up). All zero until a match has run. On a busy
  machine `max` mostly shows the operating system pausing the process; read `p99` and
  `ticksPerSecond`. Build files with a content hash in their name are cached for good; everything
  else is revalidated. A missing file is a 404, never the page.
- No absolute address anywhere: the page, the matchmaking requests (`POST /matchmake/...`) and
  the WebSocket (`/<process id>/<room code>`) all go to the origin the page came from, so one
  hostname behind a tunnel or reverse proxy is enough. Failed matchmaking answers with ordinary
  HTTP statuses (404, 500) and the error code in the body, because Cloudflare replaces the
  library's default 52x statuses with its own pages.
- **The front door** (`server/src/http/guard.ts`) stands before everything else on the port,
  the room library's matchmaking included, because the library reads and parses whatever it
  is sent:
  - A request body over 4096 bytes, or one that does not announce its length (chunked), is
    answered 413 before any of it is read. Matchmaking sends three short fields.
  - A `Host` header or request address that is not a plain one is answered 400; a WebSocket
    upgrade like that is dropped; an `X-Forwarded-Proto` other than `http` or `https` is
    removed. The library builds web addresses from these and fails on anything else.
  - Per visitor and minute: 20 rooms created, 60 join requests, 12 wrong room codes (after
    which every join by that visitor is refused for the rest of the minute, so sweeping the
    160,000 codes finds nothing). Over a limit the answer is 429 with `JOIN_ERROR.busy`. A
    visitor is the `CF-Connecting-IP` header when present (behind a Cloudflare Tunnel every
    request arrives from the same local address), otherwise the socket's address; requests
    from the machine itself with no such header (the host's own browser, the development
    proxy, tests) are never limited. `MB_NO_LIMITS=1` switches these three limits off.
- **Things with nobody behind them** are short-lived (`server/src/net/matchRoom.ts`):
  - A room waits 5 s for its creator's connection and a join request 5 s for its own. Rooms
    still waiting for their creator do not count against `MB_MAX_ROOMS`; at most 5 wait at a
    time, a sixth closes the one that has waited longest.
  - The library locks a room at 256 connections and unused join requests together (it was
    12), so requests with no connection behind them cannot shut players out of their room.
  - A connection that has not finished the library's join handshake after 10 s is closed
    (4103) and its seat is free at once.
  - A connection with more than 1 MB waiting to be sent has stopped reading: it is cut
    (4104); the seat is kept for the usual grace period.
  - Every connection is pinged once a second and cut after two unanswered pings, so one that
    died without a word is noticed after 2 to 3 s (the library's defaults: 6 to 9 s).
- **Staying up** (`server/src/crashGuard.ts`, `server/src/index.ts`): an error nobody caught
  and a rejected promise nobody handled are written down, with a plain sentence in front, and
  the server keeps running (the library's own handler, which ends the process on any uncaught
  error, is switched off). `SIGINT` and `SIGTERM` close every room and exit with code 0.
  Failures are printed whatever `MB_QUIET` says; log lines carry the host's local time.
- Hosting: the container image (`Containerfile`: Node 22 on Alpine, non-root, only the server bundle,
  the built client and the server's run-time packages; health check on `/healthz`) and
  `compose.yaml` (the game plus `cloudflared`, quick tunnel by default, named tunnel with a
  token in `.env`) are started by the scripts in `host/`. The owner's guide is `docs/HOSTING.md`.
- Environment (`server/src/config.ts`): `PORT` (2567), `HOST`, `MB_FAST=1` (short match timers
  and a small bar, set as `LobbyOptions.fast`), `MB_LATENCY` (simulated round-trip milliseconds),
  `MB_SPEED` (simulation speed multiplier for headless tests; real clients cannot predict at
  any speed but 1), `MB_GRACE` (seconds a dropped seat is kept), `MB_END_SCREEN`,
  `MB_MAX_ROOMS` (50 rooms with somebody in them), `MB_NO_LIMITS=1` (no per-visitor limits),
  `MB_CLIENT_DIR` (the built client, default `client/dist`), `MB_QUIET=1` (no room chatter;
  failures are still printed). When the tunnel is the only way in, set `HOST=127.0.0.1` so
  that nothing else on the network can reach the port.
- `server/src/net/nodeClient.ts` is a typed headless client for Node (`createRoom`, `joinRoom`),
  used by the integration tests and available to tools. The browser wrapper in
  `client/src/net` follows the same recipe with `@colyseus/sdk`.

`SimEvent` kinds (extend as needed, never rename casually): `projectileSpawn`, `projectileHit`,
`structureStage`, `propsDestroyed`, `kaijuAction`, `kaijuHit`, `kaijuStagger`, `kaijuHeld`,
`nerveBreak`, `crossfire`, `unitHit`, `memberLost`, `unitDestroyed`, `unitShaken`, `takeover`,
`volley`, `roar`, `callin`, `moltAvailable`, `cocoon`, `moltBlast`, `stageChange`, `barMark`,
`matchPhase`, `voice`, `matchEnd`. Every event carries its `tick`; the payloads are defined and
documented in `shared/src/sim/events.ts`.

What clients can rely on from the squad events and the squad part of a snapshot:

- A unit's salvo is one `projectileSpawn` per projectile, all on the same tick, with
  `owner: 'unit'` and the unit's id. `volley: true` marks a charged volley's shots (sub-units
  with at least 60% charge, and the trigger shot); the `volley` event of that tick lists the
  sub-units that fired (not the driven unit), the aim point and their average charge. A
  trigger pulled on less charge fires the sub-units too, raggedly: no `volley` flag, no
  `volley` event. A unit's projectile carries a `ttl` of 1.1 times its weapon's range over
  its speed and ends with a `projectileHit` on target 'none' when that runs out. `test/weapons.test.ts` replays every spawn
  with `stepProjectile` and checks it ends where its `projectileHit` says.
- A targeting laser is a snapshot unit with `laser` set: draw it from the unit's muzzle height
  along its `aimYaw` / `aimPitch` to wherever `resolveAimPoint` (mirrored city, snapshot kaiju)
  says that ray lands, with `charge` for brightness. The flag goes off for one tick when the
  unit fires. `rooted` is true for as long as it is planted.
- `callin` comes three times per mission: 'marked' (the marker is placed; `delay` is the time
  to the first impact, `radius` the scatter to draw), 'inbound' (the first shell is falling)
  and 'done' (the last shell has landed, or the molt's blast called the mission off). Its
  shells are `projectileSpawn` events with `owner: 'callin'` and `ownerId` the mission id.
  `callInCooldowns` in the squad snapshot is the time until the button works.
- `takeover` comes the tick after the `unitDestroyed` of the driven unit; from that tick the
  squad's `driven` (and the unit flag) point at the new unit. An eliminated squad has
  `driven: -1`.
- `kaiju.known` is whether the humans' map may show the kaiju; `kaiju.spotted` whether a
  driven unit has it in sight within the spotting range (it tightens scatter).

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
- Input: keyboard and mouse, and gamepad; button glyphs follow the last device used, and a
  keycap shows the letter the player's own keyboard layout prints on that key. Rules that are
  contracts (how they are kept: `docs/STATUS.md` section 7.4):
  - During a match the mouse is captured (pointer lock). The click that captures it is never
    also a game action, and mouse buttons count only while it is captured. Whatever frees
    the pointer (the map, the settings panel) takes it back when it closes.
  - The default keyboard map binds no modifier key and no function key: a page cannot cancel
    the browser shortcuts they make with the game's other keys (`browserShortcutRisk` in
    `client/src/game/input/actions.ts`; a test holds the defaults to it).
  - The player's settings (master volume, mouse speed, inverted look) live in browser storage
    under `mb.settings`, next to the session token (`mb.token`), the callsign (`mb.name`) and
    stored bindings (`mb.bindings`).
- Sound (`client/src/audio`; as built: `docs/STATUS.md` section 7.6). What the rest of the
  client may call on the `AudioEngine`: `play` and `loop` (effects by manifest id), `playMusic`,
  `say` and `clearVoice` (voice lines), `preload` / `preloadMusic` / `preloadVoice`, `unlock`
  (from a click or key press), `setMuted`, and for the settings panel `setMasterVolume(v)` and
  `getMasterVolume()`: 0 to 1, eased, kept if set before the first click. Everything passes one
  limiter before the master volume, and a sound has a limited number of copies, so callers need
  not ration what they play. During a match `MatchAudio` is handed every simulation event and
  the frame once per frame; it plays the lines a `voice` event names (`event.lines`), and takes
  what should be sounding now (loops, stage music) from the frame, not from events alone.
  `audio.stats()` (through `__mb.internals.ctx.audio`) reports voices and megabytes held.
- Debug and automation hooks (required for automated playtests): `window.__mb` exposes state,
  `renderer.info`, and helpers; `?autoplay=1` makes the client play itself with a simple
  autopilot; `?debug=1` shows an overlay. The server honors `MB_FAST=1` (short timers) and a
  practice option (bot kaiju), see section 4.4. `?sandbox=1|2|3` runs the shared simulation
  inside the page (one player against the bots, starting at that stage) behind the same
  message interface as a room: it is how stages are looked at without a server
  (`tools/playtest/shots.mjs`). All page flags are listed in `client/src/app/params.ts`.
- Client layout and data flow: `docs/STATUS.md` section 7. The rule that keeps it in pieces:
  `net/` knows nothing of three.js or the DOM beyond timers, `render/` knows nothing of the
  network or the HUD (it draws a `FrameState` and is handed events), `ui/` is DOM only, and the
  screens in `app/screens/` are small modules that add an overlay and choose a camera.

## 6. Quality gates

- `npm run check` passes before any task is called done. No skipped tests. It runs, in order:
  `tsc --noEmit` for every workspace; `scripts/lint.mjs` (shared code is pure: no DOM, Node,
  clocks, `Math.random` or `console`; shared, server and client respect the import layering; the
  room library stays inside the two `net/` wrappers; no unexplained `any`; no `@ts-ignore`; no
  `.only` / `.skip` in tests; no network URLs in the client); then every test.
- Headless bot-vs-bot matches (`npm run sim`) finish without errors and print a table: winner,
  match length, time per stage, staggers, units lost, the bar at each stage end, kaiju hp lost
  per stage. These are the balance instrument; `docs/BALANCE.md` says how to read them and
  records every tuning pass. Options: `--seeds N`, `--seed N`, `--unopposed`,
  `--kaiju-handicap H`, `--human-handicap H`, `--trigger-happy` (squads that hold the trigger
  instead of charging volleys), `--fast`, `--anchor N`, `--events`, `--json`; the header of
  `shared/scripts/sim.ts` lists them all.
- The simulation is deterministic and the tests hold it to that: `test/determinism.test.ts`
  plays two matches side by side from one seed and compares a hash of the whole state on every
  tick, and replays recorded inputs; `test/matchSoak.test.ts` plays whole bot matches (three
  full-length, six fast) with every number, bound and entity count checked ten times a second.
- Browser playtest (`tools/playtest`): server + 5 headless clients complete a `MB_FAST` match
  with zero console errors, and screenshots are captured for visual review (`smoke.mjs`).
  `scripted.mjs` plays the kaiju and a squad with real key and mouse events and passes only
  when every action was attempted and the server confirmed each one; an action it could not
  get to is reported as not attempted, never as passed.
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
