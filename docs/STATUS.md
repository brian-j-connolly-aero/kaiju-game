# Monster Battle 9001: Status

Living status file. Keep it short and true: when you finish a task, update what exists, remove
the stubs you filled in, and add any decision the docs left open. Contracts live in
`ARCHITECTURE.md`; numbers live in `DESIGN.md` and `shared/src/defs/`.

Last updated by: the workspace scaffold and shared contracts task.

## 1. How to run things

| Command | What it does today |
| --- | --- |
| `npm install` | Installs the pinned toolchain (47 packages). |
| `npm run check` | Type checks all three workspaces, runs `scripts/lint.mjs`, runs every test. The gate. |
| `npm test` | `vitest run`: 164 tests in `shared/test`, about 2 seconds. |
| `npm run sim` | Headless all-bot match with metrics. Options after `--`: `--seed N --matches N --anchor N --fast --max-minutes N`. |
| `npm run dev` | Starts the server and client `dev` scripts side by side (placeholders today). |
| `npm run build`, `npm start` | Bundles the server, builds the client, runs the server bundle (placeholders today). |
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
  - city damage: structure hp, the four visual stages, bar points, tallies, prop destruction and
    wrecks, `barMark`, rage from wrecking;
  - match flow basics: briefing, clock, the three end conditions, `beginStage`, `endMatch`;
  - spawning: kaiju at the anchor, `deploySquads` around the bounds edge, `refillSquad`;
  - spotting: `kaiju.spotted` and `kaiju.known` from line of sight and noise;
  - voice cues for everything that follows from an event or the clock, with throttling;
  - `resolveAimPoint` (where an aim ray lands), `computeBarMarks`, `barDisplayFraction`.
- **`server/`, `client/`:** placeholder packages only (see section 3).
- **Root scripts:** `scripts/dev.mjs`, `scripts/lint.mjs`, `scripts/merge-manifests.mjs`.

## 3. What is stubbed

Every simulation stub is marked `STUB(sim):` with a header that says exactly what to build and
which fields and helpers to use. `npm run lint` prints how many markers remain (16 today).

| Where | What is missing | For |
| --- | --- | --- |
| `sim/systems/kaijuActions.ts` | The whole action state machine: swipe, stomp, grab, throw, eat, brace, roar, beam, the molt hold; cooldowns; `kaijuAction` / `kaijuHeld` / `roar` events. Today it only advances timers. | Simulation 1 |
| `sim/systems/damage.ts` | `applyHit` (does nothing) and the per-tick damage and nerve rules: multipliers, facing, crossfire, stagger, shaken, nerve leak, trample damage to units, deaths, rage from damage. The system already drains `world.hits`. | Simulation 1 |
| `sim/systems/cityDamage.ts` | Only the extras: the `barPoints` modifier, the insurance rider flag, sanctuaries, units on a falling bridge. The core is real. | Simulation 1 |
| `sim/systems/unitOrders.ts` | Applying squad commands, sub-unit AI and formation, hold-and-charge, shaken behavior, takeover and elimination, unit animation states. Today: spotting plus idle or moving states. | Simulation 2 |
| `sim/systems/weapons.ts` | Firing, aim error and scatter, volleys, call-in missions and cooldowns. Empty. | Simulation 2 |
| `sim/systems/projectiles.ts` | Flight, sweeps against structures, kaiju, units and ground, impact damage, `projectileHit`. Empty. | Simulation 2 |
| `sim/systems/matchFlow.ts` | The molt: `moltAvailable`, cocoon, blast wave, intermission, calling `beginStage`, veterans. | Simulation 3 |
| `sim/systems/bots.ts`, `sim/bots/types.ts` | Bot behavior for squads and for the kaiju. Today bots stand still. `BotState` is a starting shape. | Simulation 3 |
| `sim/systems/voice.ts` | Three cues that need other systems: `volley.ready`, `kaiju.lowhp`, `bar.near`. | Simulation 2 and 3 |
| `shared/scripts/sim.ts` | The balance report beyond the basics. With stub bots every match is a clock win for the humans. | Simulation 3 |

Placeholders (not `STUB`-tagged; each file says so at the top):

- `shared/src/city/generateCity.ts`: a plain grid city (2592 structures, 4303 props, 10 anchors,
  a straight river with 5 bridges, 8 park and plaza blocks, 2 landmark stand-ins). The city task replaces this
  one file behind `generateCity(seed?): CityData` and extends `archetypes.ts`.
- `server/src/index.ts`, `client/src/main.ts`, `client/index.html`, `client/vite.config.ts`:
  a few lines each that prove the wiring. Replace them freely. Neither package has runtime
  dependencies yet (no Express, Colyseus or three.js): add them with exact versions and commit
  the updated `package-lock.json`.

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

## 5. Notes for whoever is next

- **Simulation workers:** build inside the stub files; the system signatures are all
  `(world: World) => void` and the order in `pipeline.ts` is fixed. Never change hp directly:
  push to `world.hits`, `world.structureHits`, `world.propHits`. `test/helpers.ts` builds tiny
  hand-made cities and worlds (`makeTestWorld`) so one rule can be tested in isolation;
  `test/soak.test.ts` hammers the whole pipeline with random inputs and must keep passing.
  Extend `World` by adding fields; if you add something a client must see, add it to the
  snapshot (bump `SNAPSHOT_VERSION`) or to an event, and update `ARCHITECTURE.md`.
- **Server worker:** the loop is `createWorld`, then each tick `world.step(inputs)`; every second
  tick `encodeSnapshot(snapshotOfWorld(world))` once, `setSnapshotAck(bytes, player.input.seq)`
  per client, and send the accumulated events. Use `sanitizeInput`, `sanitizeCommand`,
  `queueCommand`, `setPlayerBot`, `welcomeFor`, and the lobby helpers in `net/lobby.ts`. A
  disconnected player's last input keeps repeating until you call `setPlayerBot` or feed a
  neutral input. Stop stepping once `world.match.phase` is `'ended'`.
- **Client workers:** `test/prediction.test.ts` is the recipe for prediction: build the city with
  `getCity(config.citySeed)`, compare `cityChecksum` with the welcome, mirror the live state with
  `cityStateFromWire`, keep it current from `structureStage` / `propsDestroyed` / `kaijuHeld`
  events (`hpForStage`), and run `stepMovement` with `kaijuMoveParams` or `unitMoveParams` from
  snapshot data. Bounds come from `stageBounds(city, welcome.anchor, snapshot.match.stage)`.
  In dev the page (Vite, port 5173) and the game server (2567) are different origins: decide in
  one place (a Vite proxy is the simplest) so client code always talks to its own origin.
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
