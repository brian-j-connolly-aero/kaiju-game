# Monster Battle 9001: Status

Living status file. Keep it short and true: when you finish a task, update what exists, remove
the stubs you filled in, and add any decision the docs left open. Contracts live in
`ARCHITECTURE.md`; numbers live in `DESIGN.md` and `shared/src/defs/`.

Last updated by: the game server task (everything about `server/`) and simulation part 1 (the
kaiju, damage and nerve, city destruction, projectiles); the rest is from the scaffold task.

## 1. How to run things

| Command | What it does today |
| --- | --- |
| `npm install` | Installs the pinned toolchain and the server's dependencies (Express, the room library). |
| `npm run check` | Type checks all three workspaces, runs `scripts/lint.mjs`, runs every test. The gate. |
| `npm test` | `vitest run`: every test in `shared/test` and `server/test`, about 20 seconds (the server's integration tests take most of it). |
| `npm run sim` | Headless all-bot match with metrics. Options after `--`: `--seed N --matches N --anchor N --fast --max-minutes N`. |
| `npx vitest run server/test` | Only the server tests: 62 tests, about 15 seconds (three files start a real server on a free port and connect real clients). `MB_TEST_SPEED=1 npx vitest run server/test/lifecycle.test.ts` plays the full five-client match in real time (about 3 minutes). |
| `npm run dev` | Starts the server (`tsx watch`, port 2567) and the client `dev` script side by side (the client is still a placeholder). |
| `npm run build`, `npm start` | Bundles the server to `server/dist/index.js`, builds the client to `client/dist`; `npm start` runs the bundle, which serves the built client and the game on one port (`PORT`, default 2567). Environment variables: `ARCHITECTURE.md` section 4.4. |
| `npm run export:defs` | Rewrites `tools/art/data/archetypes.json` from the code (`-- --check` only verifies). A test fails when the file is stale. |
| `npm run assets:manifest` | Merges `client/public/assets/manifest.*.json` into `manifest.json`. |

## 2. What exists

Everything below is in `shared/` (`@mb/shared`) unless it says otherwise, is covered by tests in
`shared/test/`, and is imported only through `'@mb/shared'`.

- **Workspace:** npm workspaces, strict TypeScript 7, vitest 5, exact pinned versions. The shared
  package is consumed as source everywhere (see `ARCHITECTURE.md` section 1). Verified: vitest,
  `tsx watch` (server dev), the esbuild server bundle run by plain Node, `vite` dev in headless
  Chromium, and `vite build`.
- **`math/`:** scalars, angles, `Vec2 { x, z }` / `Vec3`, the seeded generator (`createRng`,
  `rngFloat`, `hash32`, ...; integer math only, identical on every engine), bitsets, and geometry:
  circle against oriented box with push-out, box against box, segment and ray against box prisms
  with height, segment and ray against upright capsules, ground segments against circles, arcs
  (point, circle, box) and 3D cones.
- **`defs/`:** id lists (`ids.ts`), schemas (`schema.ts`), `MATCH_RULES` and `COMBAT_RULES`
  (`rules.ts`), the three stages, the Lizard with all nine verbs, the Army at levels 1 to 3 with
  its weapons and projectile types, the artillery call-in, the mods and upgrades schema with an
  empty pool, and the voice cue list with a typed, validating loader for `voiceLines.json`.
- **`city/`:** `CityData` types, 22 starter archetypes, 14 prop kinds, the spatial index and its
  queries (`CityIndex` / `CityQuery`), stage bounds, road graph helpers (`findRoadPath`),
  `validateCity`, `cityChecksum`, a cached `getCity()`, and the **placeholder** `generateCity`.
- **`net/`:** the input contract (`input.ts`, with the meaning of every button), all client and
  server message types (`protocol.ts`), lobby state and the seat, role and config rules
  (`lobby.ts`), the binary snapshot codec (`snapshot.ts`, `worldSnapshot.ts`), the city state
  codec (`cityState.ts`), `welcomeFor`, byte and base64 helpers.
- **`sim/`:** the full Tier 1 `World` shape (`types.ts`), the `SimEvent` union (`events.ts`),
  `MatchConfig` (`config.ts`), `createWorld`, `world.step`, the eleven-system pipeline
  (`pipeline.ts`, one file per system in `systems/`), and these real parts:
  - input intake: edges, hold timers, wheel and call-in commands, bot inputs, driven unit control;
  - `stepMovement` and the movement system: collision, bounds, trample, wade, water, bridges,
    kaiju and unit movement under player input, props crushed by kaiju and vehicles;
  - the kaiju (`systems/kaijuActions.ts`, effects in `sim/kaijuEffects.ts`, the beam's path in
    `sim/beam.ts`): the action state machine with every Tier 1 verb: swipe, stomp (tap or hold
    from button timing), grab and throw with a held-object model (cars, wrecks, live vehicles,
    building chunks), eat, brace, roar, the beam special with rage spend, the molt hold that
    starts the cocoon; cooldowns, input buffering, `kaijuAction` events from the start of every
    wind-up, `kaijuHeld`, `roar`, `cocoon`;
  - damage and nerve (`systems/damage.ts`): `applyHit` for every combatant (state and facing
    multipliers, brace, fire-at-will, crossfire, nerve leak, slow-down, stagger and the immunity
    after it, rage from damage, death; unit hp, members, nerve, the shaken state, wrecks, nerve
    loss when a friend dies, squad elimination), trample of units, `healKaiju`;
  - projectiles (`systems/projectiles.ts`): flight for all three flight models, sweeps against
    structures, kaiju, units and the ground, splash, the backstop rule, `projectileHit`;
    `spawnProjectile` launches one. The kaiju's throw uses it; nothing fires for the humans yet;
  - city damage: structure hp, the four visual stages, bar points with partial credit, tallies
    by class, prop destruction and wrecks, props taken by the kaiju, `barMark`, the molt prompt
    (`moltAvailable`), rage from wrecking, the `barPoints` modifier, the insurance rider,
    shields (sanctuaries), units falling with a collapsing bridge;
  - match flow basics: briefing, clock, the three end conditions, `beginStage`, `endMatch`;
  - spawning: kaiju at the anchor, `deploySquads` around the bounds edge, `refillSquad`;
  - spotting: `kaiju.spotted` and `kaiju.known` from line of sight and noise;
  - voice cues for everything that follows from an event or the clock, with throttling;
  - `resolveAimPoint` (where an aim ray lands), `computeBarMarks`, `barDisplayFraction`.
- **`server/` (`@mb/server`):** the complete game server (`ARCHITECTURE.md` section 4). One
  process, one port: Express 5 (`/healthz`, the built client, the page fallback) and the room
  library (`@colyseus/core` 0.18.28 with `@colyseus/ws-transport` 0.18.5) for matchmaking and
  the WebSocket. Covered by `server/test/`.
  - `src/room/` has no library in it and is unit tested with a fake clock and fake connections:
    `gameRoom.ts` (lobby, seats, session tokens, grace period, host handoff, late joiners, match
    start and end, return to the lobby), `match.ts` (one input per player per tick, the
    acknowledgement, events, snapshot rhythm), `fixedStep.ts` (the accumulator),
    `inputQueue.ts`, `ticker.ts` (drift-free timer).
  - `src/net/` is the only place that imports the room library: `server.ts`
    (`startGameServer(config)`), `matchRoom.ts` (the adapter), `nodeClient.ts` (a typed headless
    client for tests and tools).
  - Integration tests over a real socket: five clients create, join by code, start, send inputs,
    receive snapshots and events, one drops and rejoins with its token, the match runs to its
    end, the host returns everyone to the lobby and the next match rotates the kaiju role, then
    the room closes; plus real-time rhythm (30 ticks and 15 snapshots a second), the library's
    automatic reconnection, seat takeover, grace period expiry, simulated latency, the room
    limit and the HTTP side.
- **`client/`:** placeholder package only (see section 3).
- **Root scripts:** `scripts/dev.mjs`, `scripts/lint.mjs`, `scripts/merge-manifests.mjs`.

## 3. What is stubbed

Every simulation stub is marked `STUB(sim):` with a header that says exactly what to build and
which fields and helpers to use. `npm run lint` prints how many markers remain (9 `STUB(sim)`
today).

| Where | What is missing | For |
| --- | --- | --- |
| `sim/systems/unitOrders.ts` | Applying squad commands, sub-unit AI and formation, hold-and-charge, what a shaken unit does, takeover, unit animation states. Today: spotting plus idle or moving states. (Shaking a unit, counting the timer down and marking a squad eliminated are done by the damage system.) | Simulation 2 |
| `sim/systems/weapons.ts` | Firing, aim error and scatter, volleys, call-in missions and cooldowns. Empty: the humans cannot shoot yet. | Simulation 2 |
| `sim/systems/matchFlow.ts` | The END of the molt: blast wave, intermission, calling `beginStage`, veterans. The prompt and the cocoon start are real, so today a kaiju that cocoons stays in the cocoon until the match ends. | Simulation 3 |
| `sim/systems/bots.ts`, `sim/bots/types.ts` | Bot behavior for squads and for the kaiju. Today bots stand still. `BotState` is a starting shape. | Simulation 3 |
| `sim/systems/voice.ts` | Three cues that need other systems: `volley.ready`, `kaiju.lowhp`, `bar.near`. | Simulation 2 and 3 |
| `shared/scripts/sim.ts` | The balance report beyond the basics. With stub bots every match is a clock win for the humans. | Simulation 3 |
| `server/src/room/gameRoom.ts` | `STUB(server)`: the `draftPick` message is accepted and ignored. When the simulation has upgrade drafts, pass the pick on (and add a draft step to the intermission). | Tier 2 |

Placeholders (not `STUB`-tagged; each file says so at the top):

- `shared/src/city/generateCity.ts`: a plain grid city (2592 structures, 4303 props, 10 anchors,
  a straight river with 5 bridges, 8 park and plaza blocks, 2 landmark stand-ins). The city task replaces this
  one file behind `generateCity(seed?): CityData` and extends `archetypes.ts`.
- `client/src/main.ts`, `client/index.html`, `client/vite.config.ts`: a few lines each that
  prove the wiring. Replace them freely. The client has no runtime dependencies yet (no
  three.js, no `@colyseus/sdk`): add them with exact versions and commit the updated
  `package-lock.json`. Use `@colyseus/sdk` 0.18.10, the version the server's tests already run
  against (it is a development dependency of `server/`).

## 4. Decisions made here (where the docs left it open)

Workspace

- Shared code is consumed as TypeScript source; the server is bundled with esbuild for
  production. No project references, no build order.
- "Lint-level sanity" is a small dependency-free script (`scripts/lint.mjs`) that enforces the
  architecture rules, not a general linter.
- `shared/src` is type checked without DOM or Node typings; tests and scripts get Node typings
  through `shared/tsconfig.tools.json`.

Input and actions

- The client sends raw button state; the simulation derives taps and holds. Strike starts the
  swipe wind-up on the press and becomes a stomp if still held at 0.35 s, keeping the elapsed
  time, so there is no input delay. Grab starts on the press and rolls into eat if still held at
  0.5 s; with an object in hand, release throws and a 0.5 s hold eats. Full rules: the header of
  `shared/src/net/input.ts`.
- Per-action movement and turn multipliers were not in the design; starting values are in
  `defs/kaiju/lizard.ts` (`moveMult`, `turnMult`). Grab is 0.4 s; throw is 0.3 s wind-up plus
  0.2 s recovery.
- The Lizard moves at 70% speed sideways and 60% backward relative to its body.
- Tanks drive along their hull and turn toward where they want to go; infantry moves freely.

Kaiju combat (simulation part 1; the rules as built are written out in `DESIGN.md` sections 3 and 4)

- Every verb is committed; bracing is exclusive; input priority is molt, brace, special, roar,
  strike, throw, grab, eat; each Grab hold is judged once. A press is remembered for 0.2 s and
  for as long as the button stays down.
- Attacks follow the head's aim, not the body heading. A swipe hits everything in its arc once,
  for full damage each.
- Grab prefers loose objects over building chunks. Taking a tank from a troop removes one tank,
  not the unit. A grabbed or eaten prop counts for the bar and the tally at once and leaves no
  wreck; clients learn of it from `kaijuHeld`, not `propsDestroyed`.
- Eat: the meal is gone at the first bite, the heal lands at the end, a stagger loses it.
  Infantry cannot be eaten.
- The beam is aimed in three dimensions from the mouth along the head's aim, and the head turns
  at the beam's reduced rate while it is on. It burns one structure at a time: the first one
  its center line or either edge meets.
- Rage: what the special itself wrecks earns none.
- Crossfire needs two different source units; the later hit gets the multiplier; call-ins never
  count. The `crossfire` event is rate limited to one a second.
- A stagger keeps the held object and loses any rage already spent on a special.
- Stomp knockback is a velocity kick, so the movement system stops shoved units at walls.
- Thrown objects and all other projectiles follow one kinematic rule (`stepProjectile`), exact
  on tick boundaries. Human projectiles pass over human units; kaiju projectiles hit units.
- A projectile's hit direction is against its travel when it flies flatter than 45 degrees,
  otherwise from the target toward the impact point (shells from above).
- Splash is all or nothing inside the radius, for structures, kaiju, units and props alike.
- Continuous damage (beam, trample) reports `unitHit` / `kaijuHit` every sixth tick only.
- No new damage kinds were added: a grab that kills and a torn-out chunk report cause 'swipe'.
- Insurance rider: the first landmark to take damage while a policy is free is the insured one
  (so the bar never has to go down). Shields do not stack; trample ignores them.
- A collapsing bridge deck costs the ground units on it 40 hp and shakes them.
- The molt prompt is a state check (bar past the current stage's mark), so a bar that is
  already past mark 2 when stage 2 begins offers the next molt at once. The kaiju drops what
  it holds when the cocoon closes.

City and bar

- Cars and kiosks are props with a small bar value (sedan 2, kiosk 4, bus 6); trees and street
  furniture are worth 0. V(bounds) counts structures by center plus props.
- Bridges are structures of class `bridge` with `passable: true`: nobody collides with the deck,
  bodies on a standing deck are not in water, and a deck is trampled like any structure when it
  is not taller than the walker's trample height (the hatchling crosses, the juvenile breaks it).
- Water slows the kaiju by stage: 50%, 85%, 100% of speed (`waterSpeedMult`); units 50%.
- A wading titan deals 900 damage per second to each tall structure it touches.
- Visual stages change at 66% and 33% hp. A destroyed car leaves a wreck (`world.propWreck`).
- Rage for wrecking: filling one whole stage segment of the bar gives 150 rage, counted only for
  damage the kaiju itself caused. Starting formula; tune in `COMBAT_RULES`.
- Bar marks have a floor of 1 point so a degenerate city cannot end a match at once.

Match

- Slot 0 is the kaiju, slots 1 to 4 the squads. Unit id is `squad * 4 + slot`, stable all match.
- At stage 1 the bounds are too small for the 250 m redeploy distance, so squads start in the
  four corners, about 225 m from the kaiju. From stage 2 on the rule holds.
- `fastTuning()` (`MB_FAST`): clock 150 s, briefing 1 s, intermission 1.5 s, cocoon 2 s, bar x0.12.
- Default callsigns are Granite, Beacon, Tempest, Anvil. The voice script has radio lines for the
  first three; the fourth falls back to Overlord's lines.
- `match.briefing` is the one cue whose lines play in sequence (`VOICE_SEQUENCE_CUES`); every
  other cue plays one line chosen by the `variant` number in the voice event.
- Two events were added to the list in `ARCHITECTURE.md`: `kaijuHit` and `matchPhase`.
- Lobby: `setRole` carries `wantsKaiju`; `setOptions` (host) has `botKaiju` for practice; `toLobby`
  (host) leaves the end screen. A lone player who does not volunteer plays a squad against a bot
  kaiju.

Server

- Additive changes to the shared contract, made with the server: `ROOM_NAME`, `JoinOptions`,
  `SESSION_TOKEN_PATTERN`, `JOIN_ERROR`, `CLOSE_REPLACED` and `CLOSE_SEAT_RELEASED` in
  `shared/src/net/protocol.ts`, and the optional `LobbyPlayer.slot` in `lobby.ts`.
- The room code is the room library's room id, so joining by code is the library's "join by
  id". Rooms cannot be found any other way.
- The session token is made by the client and sent in the join options; the server never sends
  it anywhere. The newest connection with a token wins its seat (two tabs of one browser are
  one player).
- A dropped seat is kept 45 s (`MB_GRACE`), in the lobby as well as in a match. When the room
  is full, a newcomer takes the seat of whoever has been disconnected the longest.
- The host role moves to a connected player after the host has been disconnected for 8 s; a
  host who returns later is an ordinary player.
- Someone who joins during a match takes over a bot squad (never the kaiju) and plays at once;
  with no squad free they watch. A player who was disconnected when the match started is
  treated the same way when they return.
- `lastKaijuSeat` is set when a match starts, not when it ends.
- The end screen returns to the lobby by itself after 120 s (20 s with `MB_FAST`) so nobody is
  stuck behind an absent host.
- `MB_FAST=1` only shortens game timers (and the end screen). It does not shorten the grace
  period, so a playtest that reloads a page still gets its seat back on a slow machine.
- `MB_SPEED` (simulation speed) exists for headless tests: the full-match integration test runs
  at 12 times real speed so it takes about 12 s instead of 150 s. Real clients must use speed 1.
- The server depends on `@colyseus/core` and `@colyseus/ws-transport`, not the umbrella
  `colyseus` package (Redis drivers, monitor, playground: none of it wanted offline).
- If the simulation throws during a match, the room logs the error and returns to the lobby
  instead of taking the server down.
- At most 50 rooms at once (`MB_MAX_ROOMS`); a room whose creator never connects is closed by
  the library after 15 s.

## 5. Notes for whoever is next

- **Simulation workers:** build inside the stub files; the system signatures are all
  `(world: World) => void` and the order in `pipeline.ts` is fixed. Never change hp directly:
  push to `world.hits`, `world.structureHits`, `world.propHits`. `test/helpers.ts` builds tiny
  hand-made cities and worlds (`makeTestWorld`) so one rule can be tested in isolation, and has
  `placeKaiju`, `placeUnit`, `parkUnits`, `eventsOf` and `valueDestroyed` for combat tests;
  `test/soak.test.ts` hammers the whole pipeline with random inputs and must keep passing.
  Extend `World` by adding fields; if you add something a client must see, add it to the
  snapshot (bump `SNAPSHOT_VERSION`) or to an event, and update `ARCHITECTURE.md`.
- **Simulation 2 (human squads):**
  - Launch every projectile with `spawnProjectile(world, { ... })`. The projectile system
    already flies it and resolves the impact; read its header before changing it. Set
    `owner: 'unit'` and `ownerId` to the firing unit's id (that id is the crossfire source),
    `owner: 'callin'` for artillery (never crossfire), `atWill` for fire-at-will shots, and put
    the charge multipliers into `damage` / `nerve` before launching. Human projectiles do not
    collide with human units.
  - `applyHit` already does everything a hit on the kaiju or a unit should do. Do not add
    multipliers at the call site other than the attacker's own (charge, mods).
  - A unit with `unit.shaken > 0` must not fire and should back off; the damage system sets and
    clears it (and `state: 'shaken'`), zeroes `charge`, but leaves `rooted` alone: un-root in the
    orders system if a shaken charging unit should move.
  - `squad.eliminated` and `squad.driven = -1` are set by the damage system when the last unit
    dies. Takeover (the driven unit died, others live) is still to do, in the orders system.
  - Dead vehicles keep `unit.wreck = true` until the kaiju takes the wreck or the stage refills.
  - The roar already zeroes `unit.charge` through the hit (`resetsCharge`); stomps shove units
    by setting `unit.vx / vz` (`shoveUnit`), so do not overwrite velocities in the orders system.
  - `volley.ready` is the one voice cue left for this task.
- **Simulation 3 (match flow, bots, balance):**
  - The cocoon is over when a kaiju has `phase === 'cocoon'` and `phaseTime >= phaseDuration`
    (the action system keeps counting; nothing else happens until the match flow system acts).
    From there: blast wave, intermission, `beginStage`. For the blast, queue hits with
    `kind: 'blast'`: `damage: Infinity` destroys, `nerve: COMBAT_RULES.unitNerveCapacity` shakes,
    `shoveUnit(unit, dirX, dirZ, meters)` pushes. `beginStage` already resets the kaiju's phase.
  - `moltAvailable` is set and announced by the city damage system; do not set it again.
  - A kaiju bot presses the same buttons: `findGrabTarget`, `findEdible`, `beamPath` and
    `throwAngle` are exported for it. To throw at a point it must look at it (aim yaw and
    pitch); the beam goes along the aim from the mouth, so aim down at ground units.
  - Balance, measured with a naive scripted kaiju that walks to the nearest building and
    alternates swipes and stomps, unopposed, in the placeholder city: it fills 65% of the
    stage 1 segment, 31% of stage 2 and 38% of stage 3 in 300 s, far slower than the 100 to
    130 s target. Expect to tune structure hp and value or the bar fractions.
  - `kaiju.lowhp` and `bar.near` are the voice cues left for this task.
- **Anyone changing the server:** game rules never go in `server/src/net`; that folder only
  adapts the room library. Put behavior in `server/src/room` and test it in
  `server/test/gameRoom.test.ts` with `makeRoom()` and `FakePeer` (no network, no real time).
  The acknowledgement in a snapshot is the server's own count per connection (`match.acks`),
  not `world.players[i].input.seq`, because a bot may have driven the slot in between. Only one
  server can run per process (the library keeps its matchmaker in module state), so each
  integration test file starts exactly one; do not turn off vitest's per-file isolation.
- **Client net worker (`client/src/net`):** the recipe is `server/src/net/nodeClient.ts`.
  - `new Client(origin)` from `@colyseus/sdk`, then `client.create(ROOM_NAME, options)` or
    `client.joinById(CODE.toUpperCase(), options)` with `options = { name, token, protocol:
    PROTOCOL_VERSION }`. A refusal rejects with `error.code` (522 no such room, `JOIN_ERROR.*`).
  - `room.onMessage('snap', bytes => decodeSnapshot(bytes))`; `lobby`, `welcome`, `events` and
    `pong` arrive as plain objects (`welcome.cityState` is a `Uint8Array`). Register all five
    handlers right after the join resolves; nothing arrives before that.
  - Send `input` every 33 ms with `seq` counting up from 1 on each page load.
  - The library reconnects a dropped socket by itself (`room.onDrop`, `room.onReconnect`); it
    only tries when the room has been joined for 5 s (`room.reconnection.minUptime`). When
    `room.onLeave(code)` fires with a code other than 4000 (you left) or `CLOSE_REPLACED`, join
    again by code with the same token; 522 then means the room is gone.
  - Keep the token per browser in `localStorage`. Two tabs then share one seat (the newer tab
    wins), which is right for players; for testing several players in one browser use separate
    profiles or private windows, or let a query parameter pick a different storage key.
  - Do not call `room.leave()` when the page unloads: that gives the seat up at once.
  - A second `welcome` in the same match (after a reconnection) means "resync the city state",
    not "start over". Snapshots can come at any tick spacing; never assume two.
- **Dev origins:** in dev the page (Vite, port 5173) and the game server (2567) are different
  origins. Either point the SDK at the server directly in dev
  (`${location.protocol}//${location.hostname}:2567`; the server allows any origin), or proxy
  in `vite.config.ts`: `'/matchmake'` and `'/healthz'` to `http://localhost:2567`, and the
  WebSocket path (`/<process id>/<room code>?sessionId=...`) with the regular-expression key
  `'^/[A-Za-z0-9_-]+/[A-Z]{4}(\\?|$)'` to `ws://localhost:2567` with `ws: true` (checked
  against the real server with Vite 8.3.8). In production the page and the game share one
  origin and need nothing.
- **Playtest and deploy workers:** `MB_FAST=1 PORT=<port> npm start` after `npm run build` is
  the server for automated playtests; `GET /healthz` says when it is up and how many rooms and
  players it has. `SIGINT` and `SIGTERM` close every room and exit cleanly. A port already in
  use makes the server exit with code 1 and a plain message.
- **Client workers (kaiju and effects):** `ARCHITECTURE.md` section 4 lists what the kaiju and
  city events guarantee. Draw the beam with `beamPath(cityQuery, snapshotKaiju,
  kaijuKindDef(kind).actions.special)` while the kaiju's phase is 'special'. Fly projectiles
  with `stepProjectile` from `projectileSpawn` until `projectileHit`; `beginStage` clears the
  server's projectiles without events, so drop all local ones on `stageChange`. Start a
  wind-up animation from `kaijuAction` (phase 'windup', `duration`, optional `elapsed`).
- **Client workers:** `test/prediction.test.ts` is the recipe for prediction: build the city with
  `getCity(config.citySeed)`, compare `cityChecksum` with the welcome, mirror the live state with
  `cityStateFromWire`, keep it current from `structureStage` / `propsDestroyed` / `kaijuHeld`
  events (`hpForStage`), and run `stepMovement` with `kaijuMoveParams` or `unitMoveParams` from
  snapshot data. Bounds come from `stageBounds(city, welcome.anchor, snapshot.match.stage)`.
- **City worker:** keep `validateCity` clean and the generator engine-independent (see the
  header of `generateCity.ts`). After changing `archetypes.ts` or `props.ts`, run
  `npm run export:defs`. Tests that hard-code facts about the placeholder (counts, the straight
  river) are in `shared/test/city.test.ts` and are written against the contract, not the layout;
  adjust the few numeric ranges if the handcrafted city differs.
- **Audio:** `shared/test/defs.test.ts` fails if `voiceLines.json` has a line with an unknown
  cue or audience, a duplicate or non-file-safe id, or if a cue has no line at all.

## 6. Known risks

- TypeScript 7 is the new native compiler. It is used only for `--noEmit` type checking; if a
  tool that needs the old JavaScript compiler API is ever added, it will need its own pin.
- Client prediction is exact in tests against the same engine. Between Node and a browser,
  `Math.sin` and friends may differ in the last bit; movement tolerates that (corrections are
  tiny and smoothed), but the city generator must never branch on such a value.
- The snapshot holds at most 255 units and uses one byte for unit ids: fine for Tier 1 (16) and
  for the 8-squad future (32).
- Balance numbers added here (action move multipliers, wade damage, rage per bar segment, prop
  values, archetype hp and value) are untested starting values.
- Until the weapon system exists nothing can hurt the kaiju in a real match, and until the match
  flow system ends the cocoon a kaiju that molts sits in its cocoon for the rest of the match.
  Both are covered by tests only through hits and inputs injected by hand.
- The beam is aimed with pitch. Looking level, a titan's beam passes over everything shorter
  than its mouth (88 m): right for a first-person view, but bots and the HUD must account for it.
- `kaijuAction` and the hit events are the only way clients learn of tells and impacts; a
  client that drops an `events` message misses them (snapshots still carry phase and timers).
- The server has only been driven by Node clients so far, never by a browser and never through
  an actual Cloudflare Tunnel. The single-origin design and the plain HTTP statuses are there
  for the tunnel, but the first real tunnel test is still to come.
- Colyseus 0.18 is young and moves fast; the adapter leans on three of its behaviors that a
  version bump could change: `allowReconnection(client, 'manual')`, the room id being settable
  in `onCreate`, and `matchMaker.controller.exposedMethods` / `standardHttpStatus`. The
  integration tests cover all three; rerun them after any upgrade and keep `@colyseus/sdk` on
  the same minor version as the server.
- The three integration test files use real timers. They are written with wide margins, but on
  a machine that is starved of CPU a timing assertion in `server/test/realtime.test.ts` could
  fail without the server being wrong; rerun before digging.
- Every refused join prints one `ServerError` line from the room library on the server's
  standard error. It is noise, not a fault.
