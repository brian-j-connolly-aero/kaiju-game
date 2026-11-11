# Monster Battle 9001: Status

Living status file. Keep it short and true: when you finish a task, update what exists, remove
the stubs you filled in, and add any decision the docs left open. Contracts live in
`ARCHITECTURE.md`; numbers live in `DESIGN.md` and `shared/src/defs/`.

Last updated by: the game server task (everything about `server/`), simulation part 1 (the
kaiju, damage and nerve, city destruction, projectiles) and simulation part 2 (the human side:
squads, commands, sub-unit behavior, weapons, volleys, call-ins, lives, veterans, spotting) and
the client core task (everything in `client/`, `tools/playtest/`, `tools/build-manifest.mjs`:
section 7); the rest is from the scaffold task.

## 1. How to run things

| Command | What it does today |
| --- | --- |
| `npm install` | Installs the pinned toolchain and the server's dependencies (Express, the room library). |
| `npm run check` | Type checks all three workspaces, runs `scripts/lint.mjs`, runs every test. The gate. |
| `npm test` | `vitest run`: every test in `shared/test`, `server/test` and `client/test`, about 20 seconds (the server's integration tests take most of it). |
| `npm run sim` | Headless all-bot match with metrics. Options after `--`: `--seed N --matches N --anchor N --fast --max-minutes N`. |
| `npx vitest run server/test` | Only the server tests: 62 tests, about 15 seconds (three files start a real server on a free port and connect real clients). `MB_TEST_SPEED=1 npx vitest run server/test/lifecycle.test.ts` plays the full five-client match in real time (about 3 minutes). |
| `npm run dev` | Starts the server (`tsx watch`, port 2567) and the client (Vite, port 5173) side by side with hot reload; open the Vite address. Vite forwards matchmaking and the WebSocket to the server, so the page talks to its own origin exactly as in production. |
| `npm run build`, `npm start` | Bundles the server to `server/dist/index.js`, builds the client to `client/dist`; `npm start` runs the bundle, which serves the built client and the game on one port (`PORT`, default 2567). Environment variables: `ARCHITECTURE.md` section 4.4. |
| `npm run export:defs` | Rewrites `tools/art/data/archetypes.json` from the code (`-- --check` only verifies). A test fails when the file is stale. |
| `npm run assets:manifest` | `tools/build-manifest.mjs`: merges `client/public/assets/manifest.*.json` into `manifest.json`, lists the files in `ui/`, and leaves out (and reports) entries whose files are missing. `-- --check` only says whether the file is stale. The client build runs it first. |
| `npx vitest run client/test` | Only the client tests: 20 tests, about 1 second (prediction against a real simulation through latency, the mirrored city, interpolation, the clock, the action map, the animator, the manifest tool). |
| `node tools/playtest/smoke.mjs` | The browser smoke playtest: starts the server with `MB_FAST=1` on a free port against the production build, opens 5 headless Chromium pages on autoplay (one creates a room, four join by code), plays one match to its end, fails on any console error or page crash, saves screenshots to `/tmp/mb-scratch/playtest/` and prints draw calls and triangles per page. About 2 to 4 minutes on this machine. Options in the file header (`--players N`, `--role human`, `--no-assets`, `--reconnect`, `--debug`). |
| `node tools/playtest/shots.mjs` | Stage screenshots with no server: opens the built client in sandbox mode (`?sandbox=<stage>`, the simulation runs in the page) for stages 1 to 3 on both sides, plus scripted extras (command wheel, charging lasers, two molts, the beam, a stagger). Pictures in `/tmp/mb-scratch/playtest/shots/`; fails on console errors. |

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
    `spawnProjectile` launches one. Bridge decks do not stop anything in flight; a projectile
    that comes down on one has hit it;
  - the human side (`systems/unitOrders.ts`, `systems/weapons.ts`, `sim/squads.ts`,
    `sim/nav.ts`; rules in `DESIGN.md` section 5, "How squads work"):
    - the four wheel commands with independent movement order and fire mode, from an input or
      a `command` message;
    - follow: a staggered column along the leader's trail that closes up in narrow streets;
    - move to: a hold point per sub-unit on reachable open ground, and navigation to it
      (straight line, else the road graph inside the bounds, with local steering round walls;
      rubble, river and bridges passable; stuck handling);
    - hold-and-charge: planted units, firing arcs, lasers (`state` 'charging'), charge 0 to 1,
      `volley.ready`;
    - fire at will with range and line-of-fire checks, target leading, weapon traverse;
    - weapons: cooldowns, salvo size from members, the driven unit's exact aim, aim error and
      the scatter multipliers (stage, spotted, slowed, veteran), the volley on the player's
      shot with charge multipliers, `volley`, tallies;
    - the artillery call-in: marker, delay, eight real shells, scatter, cooldown, `callin`;
    - shaken sub-units backing off; takeover of the nearest survivor; elimination until the
      next stage; `markVeterans`;
  - city damage: structure hp, the four visual stages, bar points with partial credit, tallies
    by class, prop destruction and wrecks, props taken by the kaiju, `barMark`, the molt prompt
    (`moltAvailable`), rage from wrecking, the `barPoints` modifier, the insurance rider,
    shields (sanctuaries), units falling with a collapsing bridge;
  - match flow basics: briefing, clock, the three end conditions, `beginStage`, `endMatch`;
  - spawning: kaiju at the anchor, `deploySquads` around the bounds edge, `refillSquad`;
  - spotting (`sim/spotting.ts`): `kaiju.spotted` (a driven unit, a bot's included, has it in
    sight within 150 m) and `kaiju.known` (the map rule: always at stages 2 and 3; at stage 1
    line of sight within 250 m or 3 s after noise), both in the snapshot;
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
- **`client/` (`@mb/client`):** the playable client core: Vite + TypeScript + three.js 0.187,
  `@colyseus/sdk` 0.18.10. Screens, net layer with prediction, AssetStore with procedural
  fallbacks, renderer, controllers, HUD, audio, automation hooks. Module map, placeholders and
  decisions: section 7.
- **Root scripts:** `scripts/dev.mjs`, `scripts/lint.mjs`. `npm run assets:manifest` now runs
  `tools/build-manifest.mjs`; `scripts/merge-manifests.mjs` is the older merge-only script,
  no longer referenced by anything and safe to delete.

## 3. What is stubbed

Every simulation stub is marked `STUB(sim):` with a header that says exactly what to build and
which fields and helpers to use. `npm run lint` prints how many markers remain (6 `STUB(sim)`
today).

| Where | What is missing | For |
| --- | --- | --- |
| `sim/systems/matchFlow.ts` | The END of the molt: blast wave, intermission, calling `markVeterans` and `beginStage`. The prompt and the cocoon start are real, so today a kaiju that cocoons stays in the cocoon until the match ends. | Simulation 3 |
| `sim/systems/bots.ts`, `sim/bots/types.ts` | Bot behavior for squads and for the kaiju. Today bots stand still. `BotState` is a starting shape. | Simulation 3 |
| `sim/systems/voice.ts` | Two cues that need other systems: `kaiju.lowhp`, `bar.near`. | Simulation 3 |
| `shared/scripts/sim.ts` | The balance report beyond the basics. With stub bots nobody moves, so a match is a clock win for the humans unless the squads deploy within range of the kaiju (then their sub-units shoot it where it stands). | Simulation 3 |
| `server/src/room/gameRoom.ts` | `STUB(server)`: the `draftPick` message is accepted and ignored. When the simulation has upgrade drafts, pass the pick on (and add a draft step to the intermission). | Tier 2 |

Placeholders (not `STUB`-tagged; each file says so at the top):

- `shared/src/city/generateCity.ts`: a plain grid city (2592 structures, 4303 props, 10 anchors,
  a straight river with 5 bridges, 8 park and plaza blocks, 2 landmark stand-ins). The city task replaces this
  one file behind `generateCity(seed?): CityData` and extends `archetypes.ts`.
- The client's placeholders (boxes for buildings, the functional HUD, stand-in icons and
  sounds) are listed in section 7.3 with what a specialist should put in their place.

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

Human squads (simulation part 2; the rules as built are written out in `DESIGN.md` section 5,
"How squads work", and the numbers the design left open are `SQUAD_RULES` in `defs/rules.ts`)

- "Hold fire and charge" means "hold here and charge": the command parks sub-units where they
  stand (or leaves them their move-to spots). The design says charging units are rooted "until
  they fire or get a new movement order"; as built, firing spends the charge and the unit plants
  itself again on its spot the next tick with a fresh arc, so a parked squad stays parked
  through volley after volley (this is what makes the one-player crossfire work). "Follow me"
  un-parks them and they do not plant again until the hold command is repeated.
- With the order 'moveTo', hold-and-charge does not stop sub-units on their way: they go on to
  their spots and plant there.
- A sub-unit whose firing arc does not cover the aim point sits a volley out and keeps its
  charge. Volleys check neither range nor line of sight.
- With the crosshair on a kaiju, sub-units aim for the middle of its body at the height the
  player picked (the event's aim point is still where the ray met its skin).
- Aim error is drawn per projectile, on heading and elevation. A person's own shots have none.
  A bot's driven unit shoots with the at-will error and half nerve, except when its shot
  triggers a volley (then volley error, full nerve).
- "Slowed", for scatter, is staggered, cocooned, or at least 30% of nerve capacity in
  accumulated nerve damage (`COMBAT_RULES.scatterSlowedNerve`).
- "Spotted" counts the driven unit of every squad, bot squads included (bots play by the same
  rules). This changed the scaffold's behavior, which left bots out.
- Sub-units firing at will lead the target, swing their weapon at 270 degrees per second, and
  look for a clear line of fire to the middle of the body, then higher, then lower.
- Formation is a staggered column along the leader's trail, not a wedge: it follows streets by
  itself. Stragglers catch up at 1.3 times speed (`unit.nav.hurry`, sub-units only).
- Hold points are chosen on open ground with 2 m to spare that can be reached straight from a
  street, so a marker on a roof or in a back yard sends units to the nearest sensible spot.
- Takeover goes to the survivor nearest the unit that died, the tick after it died.
- Every unit alive at the end of a stage is a veteran at the next (the driven one too).
- Artillery shells fall at 75 degrees from 400 m, over the caller's shoulder; the first lands
  `delay` seconds after the marker (within a tick or two). A mission outlives its squad.
- Bridge decks are road surface for projectiles, sight lines, lines of fire and aim rays
  (`skipPassable` on the city casts). The kaiju's aim ray uses it too; the beam does not.
- Tests written when sub-units did nothing were adjusted, not weakened: the kaiju tests order
  every squad to hold fire (`holdFire` in `test/helpers.ts`) and use driven units (ids 0, 4,
  8, 12) where a target must not move, and the one assertion that said "sub-units stay put
  (their AI is not built yet)" now checks that they follow.

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
- **Anyone writing simulation tests:** sub-units now act. A test about something else should
  call `holdFire(world)` (every squad on hold-and-charge) or park the squads out of range, and
  use a squad's driven unit (ids 0, 4, 8, 12) for a target that must stay put: a sub-unit that
  gets shaken backs off. Bot leaders stand still only until the bots exist.
- **Simulation 3 (match flow, bots, balance):**
  - Veterans: call `markVeterans(world)` when the stage is over (after the blast wave, before
    `beginStage`). `beginStage` itself does not, because tests call it directly.
  - Bots give squad orders the way people do: `botInput.wheel` (and `marker`), `Btn.fire`,
    `Btn.callIn`. The loop that works: order 'follow' and drive to a firing position, stop,
    'holdCharge' (sub-units plant where they stand, arcs on the kaiju), wait for
    `squad.volleyReady` (or `squadCharge(world, squad)`), aim at the kaiju and press Fire; to
    back off, 'follow' again (that un-parks them) and re-issue 'holdCharge' at the new spot.
    A kaiju that leaves the arcs is not followed: re-issue 'holdCharge' (charge starts over).
  - For the kaiju bot: `lasersOnKaiju(world, k)` counts the lasers on it,
    `laserOnKaiju(world, unit, k)` tests one, `arcCovers(unit, x, z)` says whether a planted
    unit can fire at a point. `scatterMult(stage, kaiju)` is the humans' current accuracy.
  - A bot's own trigger shots are fire at will (half nerve, at-will error) unless they trigger
    a volley. Sub-units of every squad fire at will by default from the moment a kaiju is in
    range with a clear line: with stub bots, the three sub-units of one squad that happened to
    deploy in range killed a titan that stood still in about ten minutes (anchor 0, 592 s).
  - Balance, measured in the scripted scenarios (`test/volleyScenario.test.ts`): one squad's
    full-charge volley is 45 nerve from the front (60.75 flank, 76.5 rear, about 77 as a
    one-player crossfire); four squads from the front break the kaiju (180). Because nerve is
    x(1 + 2 x charge), firing at every weapon cooldown with half charge delivers more nerve per
    second than waiting for full charge; only the burst size (against the 9 per second leak)
    rewards waiting. At-will fire at a hatchling beyond about 60 m mostly misses (3.5 degrees).
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
- Until the match flow system ends the cocoon a kaiju that molts sits in its cocoon for the
  rest of the match (covered by tests only through inputs injected by hand).
- Sub-unit navigation was tuned and stress-tested against the placeholder grid city (3600
  random move-to trips across the three stages all arrived, nobody ever inside a wall). The
  handcrafted city will have other shapes: it needs a road graph whose edges are drivable for
  a 9 m radius body at stage 3, and the stress should be rerun against it
  (`test/nav.test.ts` has a small version). A unit that cannot reach its spot waits and
  retries; it never pushes into a wall forever, but it will not arrive either.
- Units do not collide with each other or with the kaiju; sub-units only keep apart while
  moving. A parked squad can be walked through.
- Hold-and-charge deviates from the letter of the design in one place (firing does not release
  a parked unit; see section 4). If the owner wants squads to regroup on their leader after a
  volley instead, it is one branch in `orderSubUnit`.
- The snapshot does not carry `arcYaw`: a client can draw each laser but not the 35 degree arc
  a planted unit is locked to. Adding it means a snapshot layout change.
- The beam still treats a bridge deck as a wall while projectiles and sight lines pass it: a
  hatchling standing on a bridge and firing its beam level burns the deck it stands on.
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

## 7. The client (`client/`, `tools/playtest/`, `tools/build-manifest.mjs`)

A playable, ugly-but-correct game in the browser, split so specialists can deepen one area at a
time. Everything here was run in headless Chromium (software rendering); see 7.5 for what was
and was not verified.

### 7.1 Module map

```
client/index.html, vite.config.ts   the page (a canvas and an overlay root); dev proxy to the game server
client/src/main.ts, styles.css      entry point; placeholder styling for every screen and the HUD
client/src/app/
  app.ts            creates the services, runs the frame loop, picks the screen from room and match state
  context.ts        AppContext (the services) and the Screen interface
  params.ts         the page address flags (?autoplay, ?debug, ?sandbox, ... listed in the file header)
  matchRuntime.ts   one match: 30 Hz input ticks, session sampling, controller, renderer, audio, event routing
  screens/          boot, home, lobby, briefing, match, end: one small module each (overlay + camera choice)
  debugOverlay.ts   ?debug=1: frames per second, script time split, draw calls, triangles, ping, net counters
  mbHook.ts         window.__mb: state(), renderer.info(), assets(), helpers, internals
client/src/net/
  connection.ts     the ONLY file that imports the room library: createRoom, joinRoom, RoomLink
  gameClient.ts     room life cycle: lobby state, MatchSession on welcome, ping, rejoin with the token
  matchSession.ts   one match: mirrored city, snapshot buffer, server clock, predictor, event queue -> FrameState
  snapshotBuffer.ts interpolation between snapshots     serverClock.ts  render time, 100 ms behind
  prediction.ts     stepMovement prediction and reconciliation with a fading error
  cityMirror.ts     live city from the welcome bytes, kept current from events
  session.ts        session token, callsign, room code in the address
  localLink.ts      sandbox: runs the shared simulation in the page behind the same RoomLink
client/src/assets/
  assetStore.ts     loads manifest.json; models, textures, sprite atlas, ui art, audio addresses; fallbacks
  manifest.ts, rigModel.ts (a model as named nodes + parts), spriteAtlas.ts (all sheets in one texture)
  procedural/       geo.ts, models.ts (box stand-in for every model id), textures.ts, sprites.ts
client/src/render/
  gameRenderer.ts   scene, per-frame update from a FrameState, simulation events -> visuals, stats
  materials.ts      vcol / glow / city_atlas shared materials, paint-mask tint, placeholder building material
  sky.ts            gradient dome, sun or moon disc, cloud layers, fog and lights for afternoon / sunset / night
  ground.ts         land, roads, parks, plazas, water, far plain from CityData
  cityView.ts       instanced structures per archetype and state, props near the camera, collapse chunks
  structureGeometry.ts  an archetype's three states from its .glb, or painted boxes
  sceneRig.ts, instancedRig.ts   the rig abstraction: one posable copy, or many instanced copies, of a RigModel
  kaijuAnimator.ts, kaijuView.ts procedural animation from the action state; cocoon, held object, beam
  unitsView.ts, crowd.ts         vehicles, soldier sprites, lasers, markers; fleeing civilians
  projectilesView.ts, effects.ts projectiles flown from events; explosions, dust, rings, flashes
  quadBatch.ts, lineBatch.ts, boundary.ts   instanced sprite quads; glowing lines; the quarantine line
client/src/game/
  input/actions.ts, inputManager.ts   the bindable action map, glyph lookup; keyboard, mouse, gamepad
  controllers/      kaijuController, humanController, droneController, cinematicCamera, types (shake, lens)
  autoplay.ts       the autopilot for both sides and the drone
client/src/ui/      hud.ts, commandWheel.ts, mapView.ts, subtitles.ts, icons.ts, iconArt.ts (stand-in icons)
client/src/audio/   audioEngine.ts (effects, staged music, voice queue with ducking), matchAudio.ts (events -> sound)
client/test/        net.test.ts, game.test.ts, manifestTool.test.ts
tools/build-manifest.mjs            the assets:manifest script
tools/playtest/smoke.mjs, shots.mjs the multi-client smoke playtest; stage screenshots from the sandbox
```

How a frame flows: `App.tick` picks the screen, calls its `frame`, then `MatchRuntime.update`:
input poll (the autopilot overrides it) -> `MatchSession.sample` (interpolated state, the local
body at its predicted place, due events released) -> controller `update` -> 30 Hz `tickInput`
(send + predict) -> `GameRenderer.update` -> controller `applyCamera` (after the rigs are posed,
so the kaiju camera sits exactly on `cam_fp`) -> audio -> `render`.

### 7.2 Automation hooks

- `window.__mb.state()`: screen, link, room code, seat, lobby, role, controller, match scalars,
  the kaiju, the local body, event counts, net counters, frame statistics (`fps` is frames
  actually shown, `ms` is script time), `matchesEnded` and `lastResult` (kept after the room
  returns to its lobby). `__mb.renderer.info()`: draw calls, triangles, sprites, props,
  particles, chunks, projectiles. `__mb.assets()`: what is real and what is a stand-in.
  `__mb.helpers`: `dropConnection()`, `screenshot()`, `setMuted()`, `toggleCamera()`.
  `__mb.internals.ctx` is the app's services for poking at (not a stable interface);
  `ctx.client.local` is the sandbox simulation (`world`, `toStage(n)`).
- Page flags: `?autoplay=1` (with `role=kaiju|human`, `start=N` players before the host starts,
  `practice=1`, `loop=1`), `?debug=1`, `?sandbox=1|2|3`, `?assets=none`, `?mute=1`, `?res=0.5`,
  `?fps=30`, `?cam=tp`, `?name=`, `?profile=` (separate stored token: two players in one browser).
- Headless WebGL on this machine: Chromium has no GPU and draws with SwiftShader, its software
  renderer; the flags are `--use-angle=swiftshader --enable-unsafe-swiftshader
  --ignore-gpu-blocklist` (plus `--autoplay-policy=no-user-gesture-required` so audio runs).
  They are exported as `CHROMIUM_ARGS` from `tools/playtest/smoke.mjs`. Pages of one browser
  share one GPU process, which under software rendering serializes them down to about 2 frames
  a second, so the smoke test launches one browser per page.

### 7.3 Placeholders a specialist should replace

| Where | What is there now | What it should become |
| --- | --- | --- |
| `render/structureGeometry.ts` | No `bld_*` / `lm_*` models exist yet, so every structure is a painted box: repeating window tile, gable roofs on houses, a scorched version, a grey heap. The loader for real files (nodes `intact`, `damaged`, `rubble`, `chunk_NN`) is written but has never met a real file. `STUB(render)`: collapse draws every chunk as a box of the chunk's size. | Real building art through the same function; draw the real `chunk_NN` meshes. |
| `render/cityView.ts` | One instanced mesh per archetype, state and material, never culled; props are repacked around the camera (radius grows with camera height). Bridges are drawn as a low road slab with side trusses. | District chunking or level of detail if the real models push triangles past the budget. |
| `render/kaijuAnimator.ts` | One pose function for the lizard node list; reads well, tuned by eye on stage 1 to 3 art. | Per-kind animation sets for the Tier 2 kaiju; footfall timing against the art. |
| `render/effects.ts`, `projectilesView.ts` | Sparkler bursts, dust, rings and flashes from `fx.png`; capped at 520 particles. No fire that lingers on ruins, no searchlights or tracers at night. | The effects pass (night fires, tracers, searchlights, water splashes, beam scorch). |
| `render/sky.ts` | Three presets, two scrolling cloud planes, a sun or moon disc; windows light up at sunset and night through the placeholder building material. | Per-stage polish; emissive city atlas when it exists. |
| `render/crowd.ts` | 260 civilians near the kaiju who run from it and wander otherwise; they do not follow streets. | Street-following crowds, panic sound. |
| `ui/hud.ts`, `styles.css` | Functional HUD: skyline bar with three marks, sun-and-moon arc, meters, squad pips, verb hints with glyphs, crosshair, status pictures. Cramped below about 700 px wide. | The designed HUD (skyline that crumbles, portraits, stat bars). |
| `ui/iconArt.ts` | Stand-in drawings for every icon id; the 69 real SVG files in `assets/ui/` already replace them at run time. | Delete entries once the art list is complete. |
| `app/screens/*` | Plain panels: home (callsign, create, join by code), lobby (seats, role, ready, practice, start), briefing (portrait, names), end (winner, pictogram tally, front page with a photo). | Kaiju and faction select with stat bars, the playable tutorial, the hearing, the draft. |
| `ui/mapView.ts` | 2D canvas map: bounds, streets, buildings by state, friendly units, the kaiju when known; click or confirm places move-to, right click or the call-in button places artillery. | Styled map, district names, rubble tint. |
| `audio/matchAudio.ts` | Every event has a sound; combat stem follows a simple "shots or lasers recently" heat. No tank engine, march or crowd loops. | Mix pass, unit loops, per-stage ambience balance. |
| `game/autoplay.ts` | Plays both sides well enough to finish a match; no pathfinding for the kaiju, street routing for humans. | Nothing: it is a test tool. |
| `game/input/actions.ts` | Default bindings only; bindings are data and are stored, but there is no rebinding screen. Gamepad: standard mapping, never tried on real hardware. | Settings screen; controller tuning. |

### 7.4 Decisions (where the docs left it open)

- **Screen from state.** The app derives the screen every frame: no room -> home; room in its
  lobby -> lobby; a match -> briefing until the first `playing`, then match, then end once the
  match has ended or the room says `end`. Reconnects, late joins and an abandoned match need no
  special cases. Screens never switch screens; they talk to the client.
- **Two timelines.** Everything but the local body is drawn 100 ms behind the estimated server
  clock, between two snapshots (up to 120 ms of extrapolation, then it holds). Events update
  the collision city the moment they arrive and are handed to the renderer, the audio and the
  HUD when the delayed view reaches their tick (or after 1.2 s at the latest).
- **Prediction.** One input per client tick is sent and applied locally; each snapshot restarts
  the body from the server and replays unacknowledged inputs; the difference fades out
  (half-life about 60 ms) and anything over 12 m snaps (a redeploy). Prediction is off when the
  client's city checksum differs from the server's. At low frame rates up to 8 input ticks are
  sent per frame. A fresh press shows its wind-up at once (a "hint", dropped as soon as the
  server's own phase arrives or after 0.35 s).
- **Kaiju view.** The mouse sets the desired heading, which may run up to 150 degrees ahead of
  the body (enough to ask for a turn-around); the camera is the head and shows at most the 50
  degree lead. In the cocoon and when dead the camera circles outside. Third person is a chase
  camera with no wall avoidance.
- **Human view.** First person hides the player's own infantry section (it stands all around
  the camera) and the vehicle the camera sits in. In third person the aim sent to the server is
  from the unit's eye to what the camera's center ray lands on, and the stick is turned into
  that frame. After a redeploy or a takeover the view turns toward the middle of the zone.
- **Default controls.** Keyboard and mouse: WASD move, mouse look, left button strike / fire,
  right button grab / hold for the command wheel (also Q), Space or Shift brace, Q roar, E
  special / call-in, F molt (hold), 1 to 4 direct commands, M or Tab map, V camera. Gamepad:
  sticks, RT strike / fire, LT grab, LB brace / wheel, RB special, Y roar, B molt, X call-in,
  d-pad commands (same directions as the wheel), Back map, right stick click camera.
- **Command wheel layout.** Follow up, move-to right, fire-at-will down, hold-and-charge left.
- **Map.** North is up: +Z up the screen, +X to the left (a true view from above). The kaiju
  player's map shows only units whose lasers are on.
- **Markers.** A cyan circle floats over every unit, a yellow diamond over a charging one, an
  orange triangle over a known kaiju when it is far away; they grow with distance so a squad is
  findable from a titan's eye.
- **Asset manifest.** `manifest.json` gained a `ui` section that the script fills from the files
  in `assets/ui/`, and the script drops entries whose files are missing, so the client never
  requests a file that is not there (a 404 would be a console error). Civilians are every
  sprite whose id starts with `civ`. Sprite ids the client draws are listed in `ASSETS.md` 7.
- **Sandbox.** `?sandbox=N` runs the shared simulation in the page (one player against the
  bots, starting at stage N) through the same message interface as a real room. It is a test
  and screenshot tool, not a game mode.
- **Autoplay** plays one match and then rests in the lobby (so a playtest ends cleanly);
  `?loop=1` keeps going.
- **Dependencies.** `three` 0.187.0, `@colyseus/sdk` 0.18.10 (the server's version),
  `@types/three` 0.187.0, all exact. The root `assets:manifest` script line was repointed.

### 7.5 What was verified, and what was not

- Verified by running: type check and lint of all workspaces, the 20 client tests,
  `npm run build`; `npm run dev` (the page through Vite's proxy creates a room and plays); the
  5-page smoke playtest (create, join by code, start, play, end, zero console errors; the last
  runs went through both molts and intermissions to stage 3 and ended on the clock, because the
  simulation's molt landed meanwhile); a 2-page run with a dropped connection
  (the library reconnected, the client resynchronized); late joiners taking over bot squads, a
  fifth person watching as a spectator with the drone, a sixth refused, a reloaded page getting
  its slot back; the sandbox at stages 1 to 3 on both sides including two forced stage changes;
  the same on procedural fallbacks only (`--no-assets`).
- NOT verified: a real GPU (frame rates here are software rendering on a loaded machine: about
  6 to 12 frames a second per page, script time 2 to 6 ms a frame); a real gamepad; pointer
  lock; building art; a Cloudflare Tunnel; a kaiju win and the kill ending on the same build
  as the three-stage runs (earlier builds ended by a kill in the cocoon).
- Measured: at stage 3 in the sandbox, from the titan's eye with the whole city in view, 92
  draw calls and about 195,000 triangles; the highest seen in a 5-page match was 104 draw calls
  and 390,000 triangles (an intermission's pulled-back camera draws more props). The budget is
  350 and 1.5 million. Building art will add to the triangles; props are already limited to
  those near the camera.
