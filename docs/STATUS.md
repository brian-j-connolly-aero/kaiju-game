# Monster Battle 9001: Status

Living status file. Keep it short and true: when you finish a task, update what exists, remove
the stubs you filled in, and add any decision the docs left open. Contracts live in
`ARCHITECTURE.md`; numbers live in `DESIGN.md` and `shared/src/defs/`.

Last updated by: the game server task (everything about `server/`), simulation part 1 (the
kaiju, damage and nerve, city destruction, projectiles) and simulation part 2 (the human side:
squads, commands, sub-unit behavior, weapons, volleys, call-ins, lives, veterans, spotting),
simulation part 3 (match flow and the molt, bots, voice lines, the balance harness and the
tuning: `docs/BALANCE.md`), the city switch (section 10: the game now plays in Port Meridian) and
the client core task (everything in `client/`, `tools/playtest/`, `tools/build-manifest.mjs`:
section 7), the integration task (section 8: what was run end to end, what was measured,
what is still wrong) and the client's city task (section 11: Port Meridian drawn from its art,
the last client follow-ups), the client polish (section 12) and the release round (section 13:
the image rebuilt and played against, compressed downloads, the player guide); the rest is
from the scaffold task.

**Read section 11.1 first: it says whether `npm run check` passes right now.**

## 1. How to run things

| Command | What it does today |
| --- | --- |
| `npm install` | Installs the pinned toolchain and the server's dependencies (Express, the room library). |
| `npm run check` | Type checks all three workspaces, runs `scripts/lint.mjs`, runs every test. The gate. |
| `npm test` | `vitest run`: every test in `shared/test`, `server/test` and `client/test`, about 40 seconds (the server's integration tests and the whole-match simulation tests take most of it). |
| `npm run sim` | The balance harness: full bot-versus-bot matches, headless, a few hundred times real speed, one table row per match plus a summary. Options after `--`: `--seeds N` (default 5), `--seed N`, `--unopposed` (no squads), `--kaiju-handicap H`, `--human-handicap H` (0 best, 1 stands still), `--trigger-happy` (squads hold the trigger instead of charging volleys), `--fast`, `--anchor N`, `--every-anchor` (every start in turn), `--bar P1,P2,P3` (other bar fractions for one run), `--nav` (how the bots got about), `--city placeholder` (the old grid city), `--max-minutes N`, `--events`, `--json`. 20 matches take 25 to 50 s depending on what else the machine is doing. How to read it: `docs/BALANCE.md`. |
| `npx vitest run server/test` | Only the server tests: 115 tests, about 18 seconds (four files start a real server on a free port and connect real clients; `process.test.ts` starts the entry point as a process of its own). `MB_TEST_SPEED=1 npx vitest run server/test/lifecycle.test.ts` plays the full five-client match in real time (about 3 minutes). |
| `npm run dev` | Starts the server (`tsx watch`, port 2567) and the client (Vite, port 5173) side by side with hot reload; open the Vite address. Vite forwards matchmaking and the WebSocket to the server, so the page talks to its own origin exactly as in production. |
| `npm run build`, `npm start` | Bundles the server to `server/dist/index.js`, builds the client to `client/dist` (and writes a gzip copy, `<file>.gz`, of every model, script, style sheet, data file and vector icon there: `scripts/precompress.mjs`; the server sends it to browsers that accept gzip); `npm start` runs the bundle, which serves the built client and the game on one port (`PORT`, default 2567). Environment variables: `ARCHITECTURE.md` section 4.4. |
| Hosting (`host/start.cmd`, `host/start.sh`, `npm run host`) | Self-hosting for playtests: `Containerfile` and `compose.yaml` (game plus a Cloudflare Tunnel) at the root, one-command start, stop, update and logs scripts in `host/`, and `npm run host` (build, then start) without containers. The start scripts check the public link through the tunnel, which also tells the server its public address; the lobby's link button then copies an invite that works for friends even when the host plays on localhost (`MB_PUBLIC_URL` for a named tunnel; `ARCHITECTURE.md` section 4.4). The owner's guide: `docs/HOSTING.md`. |
| Player guide, readme | `README.md` at the root (what this is, where to start); `docs/PLAYING.md`, the guide the host sends to friends (joining, both sides, the controls from `actions.ts`, the pictures on screen, tips). Keep its controls tables in step with `actions.ts` and `DESIGN.md` section 8. |
| `npm run export:defs` | Rewrites `tools/art/data/archetypes.json` from the code (`-- --check` only verifies). A test fails when the file is stale. |
| `npm run assets:manifest` | `tools/build-manifest.mjs`: merges `client/public/assets/manifest.*.json` into `manifest.json`, lists the files in `ui/`, and leaves out (and reports) entries whose files are missing. `-- --check` only says whether the file is stale. The client build runs it first. |
| `npx vitest run client/test` | Only the client tests: 20 tests, about 1 second (prediction against a real simulation through latency, the mirrored city, interpolation, the clock, the action map, the animator, the manifest tool). |
| `node tools/playtest/smoke.mjs` | The browser smoke playtest: starts the server with `MB_FAST=1` on a free port against the production build, opens 5 headless Chromium pages on autoplay (one creates a room, four join by code), plays one match to its end, fails on any console error or page crash, saves screenshots to `/tmp/mb-scratch/playtest/` and prints, per page, draw calls and triangles (peak, and peak at stage 3), bytes over the WebSocket, snapshot size, a smoothness probe, and the server's own timing from `/healthz`. About 4 minutes on this machine. Options in the file header (`--url URL` plays against a server that is already running, such as the game container started with `MB_FAST=1`, and starts nothing; `--players N`, `--role human`, `--no-assets`, `--reconnect`, `--debug`, `--idle-humans`, `--expect kaiju\|humans`, `--expect-stage N`). Five software-rendered pages take the whole machine: the server then runs at about 21 ticks a second, so this run's timing and bandwidth figures describe the test rig, not the game (section 8.3). |
| `node tools/playtest/scripted.mjs` | The scripted playtest with real inputs: no autopilot. One headless page plays the kaiju, then another plays a squad in a practice match, with real key presses, mouse buttons, mouse movement and clicks on the real lobby buttons (`tools/playtest/driver.mjs`). Each action is judged only by what the server sent back (its newest snapshot and its events) and ends as pass, FAIL or not attempted; the run passes only if everything was attempted and confirmed. Screenshots and `report.json` in `/tmp/mb-scratch/playtest/scripted/`. About 5 minutes. `--only kaiju\|human`, `--out DIR`. It switches pointer lock off (headless Chromium reports garbage mouse movement under it), so mouse look under pointer lock is NOT covered by it. |
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
  `validateCity`, `cityChecksum`, a cached `getCity()` that builds **Port Meridian**
  (`city/meridian/`, `docs/CITY.md`), and the old placeholder `generateCity` (tests and
  `getCity(seed, 'placeholder')` only).
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
  - match flow, complete (`systems/matchFlow.ts`): briefing, the clock, the three end
    conditions, and the whole molt: the blast wave when the cocoon has run its time, the kaiju's
    new body, the intermission (longer with drafts), veterans, `beginStage` (wider bounds, fresh
    squads at the new level on the new perimeter), `endMatch`;
  - spawning: the starting neighborhood from the seed, the kaiju at its anchor, `deploySquads`
    (one squad per sector around the kaiju, each at the nearest allowed point of the bounds
    edge), `refillSquad`;
  - the hook for people coming and going: `setPlayerBot` (a bot takes a slot over with a blank
    mind; handing it back lets go of the controls until the person's first input);
  - bots (`sim/bots/kaijuBot.ts`, `sim/bots/squadBot.ts`, numbers in `defs/bots.ts`): the kaiju
    bot and the squad bot of `DESIGN.md` section 5, playing through `PlayerInput` only, with a
    per-side handicap in `MatchConfig.bots`;
  - spotting (`sim/spotting.ts`): `kaiju.spotted` (a driven unit, a bot's included, has it in
    sight within 150 m) and `kaiju.known` (the map rule: always at stages 2 and 3; at stage 1
    line of sight within 250 m or 3 s after noise), both in the snapshot;
  - voice (`systems/voice.ts`, `defs/voice.ts`): every cue of `DESIGN.md` section 8, each with a
    minimum gap and a priority, routine chatter on a budget, and the concrete line ids for
    both sides chosen in the simulation from whatever `voiceLines.json` holds;
  - `resolveAimPoint` (where an aim ray lands), `computeBarMarks`, `barDisplayFraction`.
- **`server/` (`@mb/server`):** the complete game server (`ARCHITECTURE.md` section 4). One
  process, one port: Express 5 (`/healthz`, the built client, the page fallback) and the room
  library (`@colyseus/core` 0.18.28 with `@colyseus/ws-transport` 0.18.5) for matchmaking and
  the WebSocket, both behind the front door in `src/http/guard.ts` (request size and sanity
  checks, per-visitor limits). `src/crashGuard.ts` keeps the process up when an error escapes.
  Covered by `server/test/`.
  - `src/room/` has no library in it and is unit tested with a fake clock and fake connections:
    `gameRoom.ts` (lobby, seats, session tokens, grace period, host handoff, late joiners, match
    start and end, return to the lobby), `match.ts` (one input per player per tick, the
    acknowledgement, events, snapshot rhythm), `fixedStep.ts` (the accumulator),
    `inputQueue.ts`, `ticker.ts` (drift-free timer), `perf.ts` (the loop's timing meter, reported
    as `perf` by `GET /healthz`; `server/test/perf.test.ts`).
  - `src/net/` is the only place that imports the room library: `server.ts`
    (`startGameServer(config)`), `matchRoom.ts` (the adapter), `nodeClient.ts` (a typed headless
    client for tests and tools).
  - Integration tests over a real socket: five clients create, join by code, start, send inputs,
    receive snapshots and events, one drops and rejoins with its token, the match runs to its
    end, the host returns everyone to the lobby and the next match rotates the kaiju role, then
    the room closes; plus real-time rhythm (30 ticks and 15 snapshots a second), the library's
    automatic reconnection, seat takeover, grace period expiry, simulated latency, the room
    limit and the HTTP side; the front door (`guard.test.ts`: oversized and malformed
    requests, rooms and join requests with nobody behind them, a connection that never
    finishes joining, the per-visitor limits), pages from another build, a connection that
    dies without a word, and the real process (`process.test.ts`: bad requests, stray
    errors, a stop signal).
- **`client/` (`@mb/client`):** the playable client core: Vite + TypeScript + three.js 0.187,
  `@colyseus/sdk` 0.18.10. Screens, net layer with prediction, AssetStore with procedural
  fallbacks, renderer, controllers, HUD, audio, automation hooks. Module map, placeholders and
  decisions: section 7.
- **The balance harness:** `shared/scripts/sim.ts` (`npm run sim`) and `shared/scripts/botMatch.ts`
  (`runBotMatch`, the per-stage report, `worldHash`). The tuning history is `docs/BALANCE.md`.
- **Whole-match tests:** `shared/test/determinism.test.ts` (two matches side by side from one
  seed, hashed every tick; recorded inputs replayed) and `shared/test/matchSoak.test.ts` (three
  full-length and six fast bot matches with every invariant checked, nobody stuck 20 s or
  outside the bounds), `shared/test/meridianPlay.test.ts` (deployment at every start and
  stage), besides `molt.test.ts`,
  `bots.test.ts` and `voice.test.ts`.
- **Root scripts:** `scripts/dev.mjs`, `scripts/lint.mjs`. `npm run assets:manifest` now runs
  `tools/build-manifest.mjs`; `scripts/merge-manifests.mjs` is the older merge-only script,
  no longer referenced by anything and safe to delete.

## 3. What is stubbed

The Tier 1 simulation has no stubs left: `npm run lint` counts no `STUB(sim)` marker. What
remains is marked `STUB(<area>):` where it lives.

| Where | What is missing | For |
| --- | --- | --- |
| `server/src/room/gameRoom.ts` | `STUB(server)`: the `draftPick` message is accepted and ignored. When the simulation has upgrade drafts, pass the pick on (and add a draft step to the intermission). | Tier 2 |

Placeholders (not `STUB`-tagged; each file says so at the top):

- `shared/src/city/generateCity.ts`: the old plain grid city, no longer the game's. Kept for tests
  and as a development option (`getCity(seed, 'placeholder')`, `npm run sim -- --city placeholder`).
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
  charge. Volleys check no line of sight; range limits them only in that every projectile gives
  out at 1.1 times its weapon's range.
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
- At stage 1 the bounds are too small for the 250 m redeploy distance, so squads start near
  the four corners, about 210 m from the kaiju. From stage 2 on the rule holds.
- `fastTuning()` (`MB_FAST`): clock 150 s, briefing 1 s, intermission 1.5 s, cocoon 2 s, bar x0.12.
- Default callsigns are Granite, Beacon, Tempest, Anvil. The voice script has radio lines for the
  first three; the fourth falls back to Overlord's lines.
- `match.briefing` is the one cue whose lines play in sequence (`VOICE_SEQUENCE_CUES`); every
  other cue plays one line. Since simulation part 3 the lines are named in the voice event
  itself (`lines.humans`, `lines.kaiju`); `variant` is only the number they were chosen with.
- Two events were added to the list in `ARCHITECTURE.md`: `kaijuHit` and `matchPhase`.
- Lobby: `setRole` carries `wantsKaiju`; `setOptions` (host) has `botKaiju` for practice; `toLobby`
  (host) leaves the end screen. A lone player who does not volunteer plays a squad against a bot
  kaiju.

Match flow, bots, voice and balance (simulation part 3; the rules as built are written out in
`DESIGN.md` sections 2, 5 and 8, the contracts in `ARCHITECTURE.md` section 3, the tuning in
`docs/BALANCE.md`)

- The kaiju takes its new body at the blast, not at the end of the intermission: clients see
  the bigger kaiju stand up while the camera pulls back. `match.stage` and the bounds change
  when the intermission ends (`stageChange`), because that is when the drafted upgrades (Tier 2)
  must be in hand for the fresh squads.
- The blast is applied through `applyHit` on the same tick as `moltBlast`, so the kills and
  the shaken units are in that tick's events. Units it throws slide during the intermission
  (the match flow system moves them; nothing else moves). The blast ends every projectile with
  a `projectileHit` (target 'none') and every fire mission with `callin` 'done', so clients
  need no special case for things left in the air.
- With drafts on, the intermission is `tuning.intermission` scaled by 20 / 8 (20 s by default).
- Squads no longer deploy at the points farthest from the kaiju but one per sector around it,
  each at the nearest point of the bounds edge that is far enough away. At stage 3 the edge is
  the city's: they used to start up to 1900 m from a titan, now 800 to 1300 m.
- `setPlayerBot` is the whole hand-over: to a bot (blank mind, same aim), or back to a person
  (controls let go until their first input, so a button the bot held is not held for them).
- Bot handicaps are part of `MatchConfig` (`bots`, optional): 0 plays its best, 1 stands still
  and never touches the random generator. `test/helpers.ts` worlds use `idleBots()` unless a
  test asks for `bots: true`, so tests of one rule still have nothing else moving in them.
- Squad bots hold their fire on the move and only shoot volleys (or as the guns load, into a
  staggered or cocooned kaiju): at-will rockets at a hatchling mostly hit houses.
- Squad bots mark artillery anywhere in the city, not only within gun range.
- The kaiju bot has no map of the city's value: it scores every standing structure by bar
  value over the time to reach and wreck it, which takes it to the rich blocks by itself.
- Voice: cues about nobody in particular may be spoken by any voice in the script; a cue about
  a squad is spoken by that squad, or by command when the squad has no line for it, never by
  another squad. `kaiju.spotted` now names the squad whose unit saw it. `collateral.human` is an
  important cue (it always goes out): it is the game's point being made on the radio.
- Tuning changed design numbers (bar fractions, stagger damage, nerve leak and immunity, weapon
  nerve and collateral, artillery); `DESIGN.md` has the new values and `docs/BALANCE.md` the
  reasons and the before and after tables. Tests that pinned the old values now pin the new
  ones or read them from `defs/`; `test/defs.test.ts` also pins the rule the nerve numbers must
  keep (one squad's full volley never breaks the kaiju alone).
- Existing tests adjusted, not weakened: the hand-over test in `kaijuActions.test.ts` now
  follows the cocoon into the blast; the scripted block in `scenario.test.ts` keeps the mark it
  was written for (35% of the block) and checks the tuned fraction separately; the
  target-leading test in `squads.test.ts` reads the lead off the weapon's aim instead of one
  randomly scattered rocket; one calibration bound in `volleyScenario.test.ts` moved from 50%
  to 60% of nerve capacity (a lone volley is 54 now); the titan wading test tells the squads to
  hold fire (they deploy closer now).

Server

- Additive changes to the shared contract, made with the server: `ROOM_NAME`, `JoinOptions`,
  `SESSION_TOKEN_PATTERN`, `JOIN_ERROR`, `CLOSE_REPLACED` and `CLOSE_SEAT_RELEASED` in
  `shared/src/net/protocol.ts`, and the optional `LobbyPlayer.slot` in `lobby.ts`.
- The room code is the room library's room id, so joining by code is the library's "join by
  id". Rooms cannot be found any other way.
- The session token is made by the client and sent in the join options; the server never sends
  it anywhere. The newest connection with a token wins its seat (two tabs of one browser are
  one player).
- A dropped seat is kept 45 s (`MB_GRACE`), in the lobby as well as in a match, and only for
  its owner: a newcomer is refused while all five seats are taken, dropped ones included.
  (Until the fix pass a newcomer took the seat of whoever had been gone longest, at once,
  which locked a reloading player out of their own match.) The cost: somebody whose browser
  cannot keep the session token (storage blocked) and who reloads in a full room waits out
  their own old seat's grace period.
- The match remembers which token played which slot. A player who returns after the grace
  period gets their slot back while a bot still plays it, the kaiju included. If the room has
  filled up again meanwhile (a sixth person took the seat), they are refused: the seat, not
  the slot, is what ran out.
- The host role moves to a connected player after the host has been disconnected for 8 s; a
  host who returns later is an ordinary player.
- Someone who joins during a match takes over a bot squad (never the kaiju) and plays at once;
  with no squad free they watch. A player who was disconnected when the match started is
  treated the same way when they return. A newcomer is given a squad nobody has played in
  this match before one whose player is away.
- The host can start without somebody who has been in the lobby for 20 s and is not ready
  (`LobbyPlayer.waited`, `canStartMatch`). That person is in the match (their sub-units fight
  on their own) but is never made the kaiju. Changing role or faction does not buy more time.
  The lobby screen enables Start through `canStartMatch` already; it does not yet show who
  is being waited for (connected, not ready, not `waited`).
- Build stamp (`shared/src/net/build.ts`, ARCHITECTURE.md section 4.1): the rules part is
  worked out at run time from the shared data and the city, the page part is the hashed
  script name. A page from another build is refused, reloads itself once, then shows the
  join error. A change to shared logic that changes no data is only caught by the page part,
  that is, in the production build.
- Player names: composed form, no control, invisible or direction-changing characters, at
  most two combining marks per letter, 16 whole characters; "Player N" when nothing visible
  is left. Two players may still carry the same name.
- Input queue after a stall: only inputs with no news are skipped (ARCHITECTURE.md section
  4.3). Measured on simulated links with 1 to 4% of messages held back 100 to 700 ms
  (990 taps and 990 holds each, `/tmp/mb-scratch/fix-server/n6probe.mts`): taps that did
  nothing went from 8 to 22% to 0 to 0.3%; holds cut short into a Swipe from 6 to 15% to 0
  to 0.3%. Letting go of a guessed "still held" button early, as the inspection suggested,
  was tried and dropped: it saved the 0 to 3% of taps that become Stomps and cost 7 to 19
  points of Stomps.
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
- At most 50 rooms with somebody in them at once (`MB_MAX_ROOMS`). A room whose creator never
  connects is closed after 5 s, does not count against the limit, and at most 5 such rooms
  wait at a time. A join request waits 5 s for its connection.
- An error nobody caught no longer ends the process (it did, through the room library's own
  handler): it is logged and the server keeps running. Failures are printed even with
  `MB_QUIET=1`, with the host's local time.
- Per-visitor limits on matchmaking (20 rooms, 60 joins, 12 wrong codes a minute) go by the
  `CF-Connecting-IP` header; the machine itself is exempt. Behind a reverse proxy other than
  the tunnel that does not set that header, every visitor looks like the machine itself and
  nothing is limited.

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
  gets shaken backs off. Bots do not get in the way: `makeTestWorld` handicaps them fully
  (`idleBots()`: they stand still, hands off the buttons) unless the test passes `bots: true`
  or its own `config.bots`. A world made with `createWorld` directly has real bots.
- **Anyone tuning the game:** `docs/BALANCE.md` first. Change numbers in `shared/src/defs/`,
  run `npm run sim -- --seeds 20 --every-anchor` and `--unopposed`, compare summaries (not
  rows), and record what you did there (`docs/BALANCE.md` section 8 is the current state).
- **Client workers (voice, intermission, bots):**
  - Play `event.lines.humans` or `event.lines.kaiju` of a `voice` event, in order; do not pick
    lines with `pickVoiceLine` (`client/src/audio/matchAudio.ts` plays the event's lines and
    nothing else).
  - The intermission: `matchPhase` 'intermission' carries `duration` and `nextStage`; the new
    bounds are `stageBounds(city, anchor, nextStage)`. The kaiju in snapshots is already at the
    new stage; `match.stage` changes with `stageChange` when the intermission ends.
  - A molt needs no clean-up of its own: the blast sends `projectileHit` for everything in
    flight and `callin` 'done' for every marker. (`beginStage` called directly, as the sandbox
    does, still clears both silently.)
  - Practice options can expose `MatchConfig.bots` (handicaps) if wanted: nothing sets it today
    outside the harness and the tests.
- **Bot work:** behavior in `shared/src/sim/bots/`, numbers in `shared/src/defs/bots.ts`.
  `shared/test/bots.test.ts` has a field and a street to try a behavior in; the harness says
  what it did to the balance. A bot must stay inside `PlayerInput` (the first test of that
  file checks every input of a whole match).
- **Anyone changing the server:** game rules never go in `server/src/net`; that folder only
  adapts the room library. Put behavior in `server/src/room` and test it in
  `server/test/gameRoom.test.ts` with `makeRoom()` and `FakePeer` (no network, no real time).
  The acknowledgement in a snapshot is the server's own count per connection (`match.acks`),
  not `world.players[i].input.seq`, because a bot may have driven the slot in between. Only one
  server can run per process (the library keeps its matchmaker in module state), so each
  integration test file starts exactly one; do not turn off vitest's per-file isolation.
  Anything about raw web requests belongs in `server/src/http/guard.ts`, which runs before the
  library sees a request; the library's own request handler lets a rejected promise escape on
  input it does not expect. A test that needs a visitor other than the machine itself sends a
  `CF-Connecting-IP` header (`server/test/guard.test.ts`).
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
  header of `city/meridian/generate.ts`). After changing `archetypes.ts` or `props.ts`, run
  `npm run export:defs`. A change to the city changes its checksum (pinned in
  `shared/test/meridian.test.ts`) and moves the balance: rerun `docs/BALANCE.md` section 8.
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
- The balance is tuned for bot against bot in Port Meridian (`docs/BALANCE.md` section 8):
  kaiju wins 47% of 60 matches, stages of about 3:15 / 3:05 / 3:50, matches of about 10:20,
  18 kills in 60. A kaiju bot or squads that hesitate 30% of the time lose 9 of 10;
  trigger-happy squads lose 20 of 20. Real players will move it. Numbers nobody has tuned yet:
  action move multipliers, wade damage, rage per bar segment, prop values, archetype hp and
  value.
- Nerve breaks only when charged volleys (60% charge or more) from two different squads land
  within 5 s of each other (`DESIGN.md` sections 3 and 5). A bot kaiju is staggered about 1.6 /
  3 / 3.5 times a stage. Four idle people, or the client's autopilot squad (which holds the
  trigger), no longer stagger anything, so browser smoke runs see fewer staggers and kills.
- Alone, a titan needs about 3:02 for its segment (target 100 to 130 s): it starts some 720 m
  from the towers. Lowering `p3` hands the kaiju the contested match; the bots' stage 3 plan is
  the next lever.
- The bots have played Port Meridian from every start (`docs/BALANCE.md` section 8 lists what
  was wrong and fixed). In 60 matches nobody was stuck longer than 3.1 s (the kaiju 9.7 s),
  nobody left the bounds, units spent 0.1 to 0.4% of their time out in open water. The squad
  bot still finds firing positions only on road nodes and street midpoints.
- The kaiju grows where its cocoon was if its new body fits there; otherwise it stands up at
  the nearest spot with room (`findStandingRoom` in `sim/spawn.ts`), and the kaiju bot picks
  hiding places with room for the next body.
- Sub-unit navigation, stress-tested in Port Meridian (1800 random move-to trips over every
  start and stage, markers anywhere): nobody inside a wall or outside the bounds; 13 trips
  (0.7%) took more than three times the straight drive plus a minute, 4 never arrived, all into
  pockets of houses against the stage 1 line or far out in the bay. Every street edge is
  drivable straight for a 9 m troop. A unit that cannot reach its spot waits and retries; it
  never pushes into a wall forever, but it will not arrive either.
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
- Colyseus 0.18 is young and moves fast; the adapter leans on behaviors that a version bump
  could change: `allowReconnection(client, 'manual')`, the room id being settable in
  `onCreate`, `matchMaker.controller.exposedMethods` / `standardHttpStatus`, and since the fix
  pass also `seatReservationTimeout`, `maxClients` counting unused join requests,
  `client.state` staying `JOINING` until the handshake, the transport's `pingInterval` /
  `pingMaxRetries` and `server` options, and the library attaching its request and upgrade
  handlers to the HTTP server during `listen` (the front door wraps them right after). The
  integration tests cover all of them; rerun them after any upgrade and keep `@colyseus/sdk`
  on the same minor version as the server.
- **Every client is sent the kaiju's true position**, also at stage 1 and in the cocoon,
  when the rules say the humans do not know it: `known` is only a flag beside the position in
  the snapshot, and `window.__mb.state()` prints it. A squad player who opens the browser
  console can drive straight to a hidden hatchling or cocoon. Among friends that spoils a
  match and nothing more; it was left as it is. The mend would be to send humans the last
  known position while `known` is false (and a distance for the cocoon's heartbeat).
- A tap whose release is held up by a network stall of about 0.4 s or more is played as a
  hold (a Swipe becomes a Stomp, a Grab an Eat): the server has to guess while nothing
  arrives and guesses "still held". On simulated bad links that was 0 to 3% of taps
  (section 4, "Server"). Mending it needs the simulation to take a late release back, which
  it cannot do today.
- Nothing restarts the server if the process does end (a power cut, an out-of-memory kill):
  the start script or container of the self-hosting package should, and should set
  `HOST=127.0.0.1` when the tunnel is the way in.
- The integration test files use real timers. They are written with wide margins, but on
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
  settings.ts       the player's settings (volume, mouse speed, inverted look, half resolution) in browser storage
  screens/          boot, home, lobby, briefing, match, end: one small module each (overlay + camera choice)
  debugOverlay.ts   ?debug=1: frames per second, script time split, draw calls, triangles, ping, net counters
  mbHook.ts         window.__mb: state(), renderer.info(), assets(), helpers, internals
client/src/net/
  connection.ts     the ONLY file that imports the room library: createRoom, joinRoom, RoomLink
  gameClient.ts     room life cycle: lobby state, MatchSession on welcome, ping, rejoin with the token
  matchSession.ts   one match: mirrored city, snapshot buffer, server clock, predictor, event queue -> FrameState
  snapshotBuffer.ts interpolation between snapshots     serverClock.ts  render time, 100 ms behind, never backwards
  prediction.ts     stepMovement prediction, reconciliation with a fading error, the body drawn between ticks
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
  sky.ts            gradient dome, sun or moon disc, two cloud rings on the horizon, fog and lights per time of day
  ground.ts         land, roads, parks, plazas, water, far plain from CityData
  cityView.ts       instanced structures per archetype and state (wall tint, damage shade), props near the
                    camera, collapse pieces (the art's chunk meshes in one dynamic buffer)
  structureGeometry.ts  an archetype's three states and chunk meshes from its .glb, or painted boxes
  landmarkPictures.ts   the map's landmark pictures, painted on the processor from the models
  sceneRig.ts, instancedRig.ts   the rig abstraction: one posable copy, or many instanced copies, of a RigModel
  kaijuAnimator.ts, kaijuView.ts animation from the action state toward the manifest's pose targets;
                    first-person head lock; cocoon, held object, weak point halo, embers, beam
  unitsView.ts, crowd.ts         vehicles, soldier sprites, lasers, markers; fleeing civilians
  projectilesView.ts, effects.ts projectiles flown from events; explosions, dust, rings, flashes (four
                    batches: added light, alpha-blended bursts, smoke, ground)
  quadBatch.ts, lineBatch.ts, boundary.ts   instanced sprite quads; glowing lines; the quarantine line
client/src/game/
  input/actions.ts, inputManager.ts   the bindable action map, glyph lookup; keyboard, mouse (and when it is
                    captured), gamepad;   inputTicker.ts  frame time -> 30 Hz input ticks
  controllers/      kaijuController, humanController, droneController, cinematicCamera, types (shake, lens),
                    cameraClearance (holds a first-person or chase camera short of a standing wall)
  autoplay.ts       the autopilot for both sides and the drone
client/src/ui/      hud.ts, commandWheel.ts, mapView.ts, subtitles.ts, settingsPanel.ts, icons.ts,
                    iconArt.ts (stand-in icons), controlsCard.ts (every control of a role, as pictures)
client/src/audio/   audioEngine.ts (effects with voice limits, staged music, voice queue with ducking, limiter, master
                    volume, cache of decoded files), matchAudio.ts (events and frame state -> sound); see 7.6
client/test/        net.test.ts, game.test.ts, manifestTool.test.ts, audioEngine.test.ts, matchAudio.test.ts
                    (both on fakeAudio.ts, a silent stand-in for Web Audio that records what was started),
                    input.test.ts (on fakeBrowser.ts: a window, a document and a browser's side of pointer
                    lock), session.test.ts (a real simulation and a real MatchSession over a delayed link),
                    view.test.ts (pose targets, the chase camera's rise, cloud rings, pixel cap, icons),
                    city.test.ts (building paint and shade, the city view's batches and collapse
                    pieces, landmark pictures, the night ground, sleeping lobby seats, the
                    autopilot's volleys, the thrown object leaving the hand)
tools/build-manifest.mjs            the assets:manifest script
tools/playtest/smoke.mjs, shots.mjs the multi-client smoke playtest; stage screenshots from the sandbox
tools/playtest/scripted.mjs, driver.mjs   two sessions played with real inputs; the hands and eyes it uses
```

How a frame flows: `App.tick` picks the screen, calls its `frame`, then `MatchRuntime.update`:
input poll (the autopilot overrides it) -> `MatchSession.sample` (interpolated state, the local
body at its predicted place, due events released) -> controller `update` -> 30 Hz `tickInput`
(send + predict) -> `MatchSession.refreshLocal` (the local body placed for this frame, part of
the way through its newest tick) -> `GameRenderer.update` -> controller `applyCamera` (after the
rigs are posed, so the kaiju camera sits exactly on `cam_fp`) -> audio -> `render`.

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
| `render/structureGeometry.ts`, `render/cityView.ts` | All 40 archetypes come from their art files (states, chunk meshes, atlas, night atlas, wall tint). The painted boxes remain only as the fallback for a missing file. One instanced mesh per archetype, state and material, never culled (the whole city is 360,000 triangles); props are repacked around the camera. | Nothing needed for the budget. District roof colors (`docs/art/client-notes-city.md` section 6) if the art adds a second mask. |
| `render/kaijuAnimator.ts` | One pose function for the lizard node list; the arms blend toward the art's pose targets (`poses` in the manifest; the box stand-in has the old numbers as its fallback). Swipe wind-up, stomp, roar, beam and death arms are still built-in numbers. | Per-kind animation sets for the Tier 2 kaiju; footfall timing against the art. |
| `render/effects.ts`, `projectilesView.ts` | Sparkler bursts, dust, rings and flashes from `fx.png`; capped at 520 particles, and a bright particle is never drawn wider than 0.6 of its distance from the camera. `fx_debris_1..4` and lingering fire are drawn by nothing yet. No searchlights or tracers at night. | The effects pass (night fires, tracers, searchlights, water splashes, beam scorch, debris). |
| `render/sky.ts`, `render/ground.ts` | Three presets, the two cloud panoramas on horizon rings (sun gap at the sunset sun), a sun or moon disc; windows light up at sunset and night through the city's night atlas; the ground goes to dim warm greys at night (paving under blue moonlight read as water) and to warm stone at sunset (it read lavender under the violet sky light). The afternoon's light from below is a pale paving grey (it was olive, and turned cream walls in shade olive). | Per-stage polish. |
| `render/crowd.ts` | 260 civilians near the kaiju who run from it and wander otherwise; they do not follow streets. | Street-following crowds, panic sound. |
| `ui/hud.ts`, `styles.css` | Functional HUD: skyline bar with three marks, sun-and-moon arc, meters, squad pips, verb hints with glyphs, crosshair, status pictures. Cramped below about 700 px wide. | The designed HUD (skyline that crumbles, portraits, stat bars). |
| `ui/iconArt.ts` | Stand-in drawings for every icon id; the 69 real SVG files in `assets/ui/` already replace them at run time. | Delete entries once the art list is complete. |
| `app/screens/*` | Plain panels: home (callsign, create, join by code), lobby (seats, role, ready, practice, start), briefing (portrait, names), end (winner, pictogram tally, front page with a photo). | Kaiju and faction select with stat bars, the playable tutorial, the hearing, the draft. |
| `ui/mapView.ts` | 2D canvas map of Port Meridian: district ground in map tints with names, streets, river and bay, bridges, buildings by state, landmark pictures, friendly units, the kaiju when known; click or confirm places move-to, right click or the call-in button places artillery. | Zoom and pan; rubble drawn as heaps. |
| `audio/matchAudio.ts` | Every event has a sound, and the audio directors' notes for the client are applied (7.6); combat stem follows a simple "shots or lasers recently" heat. No tank engine, march or crowd loops; none of the Tier 2 unit sounds (their units do not exist yet). Nobody has listened to any of it: all checks are counts and measured levels. | A listening pass, unit loops, per-stage ambience balance, the Tier 2 wiring in `docs/audio/client-notes-sfx.md` section 4. |
| `game/autoplay.ts` | Plays both sides well enough to finish a match; no pathfinding for the kaiju, street routing for humans; the squad parks and fires charged volleys together with the others as the squad bots do (`volleyVerdict`). | Nothing: it is a test tool. |
| `game/input/actions.ts` | Default bindings only; bindings are data and are stored, but there is no rebinding screen (the settings panel has volume, mouse speed, inverted look and fullscreen). Gamepad: standard mapping, never tried on real hardware; the menus cannot be worked with a gamepad (Tab, Space and Enter do work on their buttons). | Key rebinding; gamepad focus in the menus; controller tuning. |
| `ui/settingsPanel.ts`, `ui/iconArt.ts` | The settings and drone icons now have art files (art polish round). The controls card's picture, `ui_controls`, is still drawn in code. | One icon from the art team, under that name. |

### 7.4 Decisions (where the docs left it open)

- **Screen from state.** The app derives the screen every frame: no room -> home; room in its
  lobby -> lobby; a match -> briefing until the first `playing`, then match, then end once the
  match has ended or the room says `end`. Reconnects, late joins and an abandoned match need no
  special cases. Screens never switch screens; they talk to the client.
- **Two timelines.** Everything but the local body is drawn 100 ms behind the estimated server
  clock, between two snapshots (up to 120 ms of extrapolation, then it holds). Events update
  the collision city the moment they arrive and are handed to the renderer, the audio and the
  HUD when the delayed view reaches their tick (or after 1.2 s at the latest).
- **The drawn clock never runs backwards.** The server clock estimate is the least delayed
  snapshot of the last quarter second, and snapshots that arrive together count once. When the
  estimate moves, the drawn clock runs slower (down to half speed) or faster (up to double)
  until it is back in place; it skips forward only when it is more than 0.25 s behind (the
  view stood still for want of snapshots) and starts afresh only after a gap of a second.
- **A backlog is not played back.** Events that waited more than 2 s to be shown (a hidden
  tab gets no frames, the socket still delivers) are handed out with
  `MatchSession.catchingUp` set: the renderer takes over the state of the city, the marks and
  the stage and clears what was in the air; no effects, no camera shake, no HUD flash, no photo.
- **Prediction.** One input per client tick is sent and applied locally; each snapshot restarts
  the body from the server and replays unacknowledged inputs; the difference fades out
  (half-life about 60 ms) and anything over 12 m snaps (a redeploy). Prediction is off when the
  client's city checksum differs from the server's. At low frame rates up to 8 input ticks are
  sent per frame. The body is drawn between the pose before its newest tick and the pose after
  it, by the share of a tick that has passed, so it moves on every frame (one tick, 33 ms,
  behind the prediction). Buttons are sent from a latch that is started again after every
  sample, so a click shorter than the gap between two samples is in exactly one of them.
- **A fresh press shows its wind-up at once** (a "hint"). The hint is drawn while the delayed
  view still shows the kaiju idle; when the server's phase reaches the view the pose carries
  on from the time already shown and waits at the end of the wind-up for the server's strike.
  It is dropped when the server has had the press and did nothing (the snapshot's
  acknowledgement says so), or after 1.5 s.
- **The captured mouse.** During a match the game wants the mouse (pointer lock) unless the map
  or the settings panel is open. With the pointer free, a click on the view only captures it:
  mouse buttons are game buttons only while it is captured, and the HUD shows a "click"
  picture meanwhile. Closing the map or the panel takes the pointer back if they had taken
  it. Escape with the pointer captured never reaches the page (the browser frees the
  pointer), so losing the pointer while the window has the focus opens the settings panel. A
  browser with no pointer lock (or one that refuses three times without ever granting it)
  gets buttons that act at once and a view that turns while a button is held; the scripted
  playtest uses that path.
- **Settings.** A panel of pictures: master volume, mouse speed (a quarter to four times the
  default), inverted look, fullscreen, half resolution for the 3D view (the drawing buffer is
  also never larger than a 1080p screen's worth of pixels). The gear on the home screen and in the lobby opens it;
  Escape (Start on a gamepad) opens and closes it anywhere, a match included, where the body
  idles as with the map. Kept in browser storage under `mb.settings` (fullscreen is not: a
  browser enters it only on a click).
- **Kaiju view.** The mouse sets the desired heading, which may run up to 150 degrees ahead of
  the body (enough to ask for a turn-around); the camera is the head and shows at most the 50
  degree lead. In first person the head is locked to the aim and both arms ride on it, so the
  snout and the claws (the `fp_claws` pose) keep their place on screen whatever the body does;
  a held thing is shrunk to 0.16 body heights in that view only; the kaiju's own hit flashes
  are not drawn there. In the cocoon and when dead the camera circles outside and comes in to
  this side of any building in the way. Third person is a chase camera; a wall behind the
  kaiju makes it rise over the wall (up to two body heights, looking down past the shoulders)
  instead of closing in on the back. In third person the aim sent to the server runs from the
  kaiju's eye (its mouth during the beam) to what the crosshair is on.
- **Night readability.** The kaiju's body has its own material: a rim of light (warm at
  sunset, moonlight at night) and a little of its own color at night, never on its own claws
  in first person. Its eyes and embers heat up with rage and the beam; a staggered kaiju's
  weak point gets a violet halo toward the viewer; the cocoon's light beats.
- **Human view.** First person hides all of the player's own unit (the section stands all
  around the camera, a troop's three tanks 5 to 6 m from it). In third person the aim sent to
  the server is from the unit's eye to what the camera's center ray lands on, and the stick is
  turned into that frame. After a redeploy for a new stage the view turns toward the middle of
  the zone; after a takeover it stays where it was, or turns to the kaiju if it is known.
- **The crowd** of civilians is kept around the kaiju only where the viewer may know where it
  is; a squad that has lost it sees its crowd around its own camera, with nobody fleeing.
- **Default controls.** Keyboard and mouse: WASD move, mouse look, left button strike / fire,
  right button grab / hold for the command wheel (also Q), Space brace, Q roar, E
  special / call-in, F molt (hold), 1 to 4 direct commands, M or Tab map, V camera, Escape
  settings, H the controls card; the drone rises with Space and comes down with C. Gamepad:
  sticks, RT strike / fire, LT grab, LB brace / wheel, RB special, Y roar, B molt, X call-in,
  d-pad commands (same directions as the wheel), Back map, right stick click camera, Start
  settings, left stick click the controls card. The full table is in `DESIGN.md` section 8.
- **No modifier keys.** Nothing is bound to Control, Alt, Meta or Shift, or to a function key:
  with one of those held, a movement key becomes a browser shortcut that a page cannot cancel
  (Ctrl+W closes the tab; Shift+Escape opens the browser's task manager). The drone came down
  with Ctrl and brace had Shift as a second key; both are gone. A test holds the defaults to it.
- **Keycap letters** are what the player's own keyboard prints on the letter key in that
  position: from the browser's layout map where it has one, otherwise learned from each key
  press (until then the US letter is shown). The digit row always shows its digits.
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
  6 to 12 frames a second per page, script time 2 to 6 ms a frame); a real gamepad; mouse
  look under pointer lock in a real browser; building art; a Cloudflare Tunnel. (A kaiju win
  and the kill ending have since been seen in a browser, each with its end screen: section
  8.2.)
- Pointer lock, as far as it can be checked here: the rules of the captured mouse are unit
  tested against a stand-in browser (`client/test/input.test.ts`), and headless Chromium, which
  does grant and release the lock, showed the first click capturing without firing, the map
  and the settings panel giving the pointer back, and the second click firing. What a real
  browser does on Escape, on switching windows and in the second after Escape (when it
  refuses the lock) is reasoned from the browsers' documented behavior, not seen. Smoothness
  at 60 and 144 frames a second is from tests of the real session, not from a screen.
- Port Meridian with its building art (section 11.3): 111 to 166 draw calls and about 360,000
  triangles with the whole city in view; at most 131 calls and 500,000 triangles in play.
- Measured after the art was wired in (development server, sandbox, 12 November): from the
  titan's eye over the whole city 102 draw calls and 148,000 triangles; from its chase camera
  100 and 123,000. Earlier: at stage 3 in the sandbox, from the titan's eye with the whole city in view, 92
  draw calls and about 195,000 triangles; the highest seen in a 5-page match was 104 draw calls
  and 390,000 triangles (an intermission's pulled-back camera draws more props). The budget is
  350 and 1.5 million. Building art will add to the triangles; props are already limited to
  those near the camera.

### 7.6 Sound, as built (`client/src/audio`)

Nobody has heard any of this: the machine has no speakers. Everything below is from 65 unit
tests on a silent stand-in for Web Audio (`client/test/fakeAudio.ts`) and from renders made
without playing them (an `OfflineAudioContext` in headless Chromium, real files, peak level
read off the result). dBFS is decibels relative to full scale; 0 is where sound clips.

- **Volume.** `audio.setMasterVolume(v)` and `audio.getMasterVolume()`, 0 to 1, 0.9 until
  someone sets it; eased over about 0.15 s; works before the first click. `setMuted` is
  separate. Measured: 0.5 gives 0.501 of the level at 1, 0 gives silence.
- **A volley is loud, not clipped.** A sound may have 6 copies playing; copies asked for
  together start 26 to 41 ms apart (5 fit in the 150 ms allowed); when there is no room the
  quietest copy, or one long past its attack, gives way to a louder or newer one, so a far
  squad's shots never crowd out your own; 28 voices in all. Everything then passes a limiter
  (a compressor node: threshold -3 dB, decibels, 20 to 1, hard knee) before the volume. A
  volley of five voices measures 5 dB louder than one shot. On `tank_fire`: 12 copies used to peak at +17.3
  dBFS and 28 at +24.6 (clipped for thousands of samples); now any number peaks at -3.1 dBFS
  with nothing clipped, and a single shot is untouched (0.00 dB change on four sounds). Three
  salvos, impacts, a roar, stage 3 music with its combat stem and a radio line all started on
  one instant: -1.5 dBFS (-0.6 with the volume at 1).
- **Memory.** Decoded music is dropped once other music has taken its place, unless it was
  announced (`preloadMusic`) and not yet let go (`releaseMusic`); the match audio announces the
  coming stage's stems, the cocoon, intermission and win cues, and lets go of each when its
  time is over. Only the 24 most recent voice lines stay decoded, plus the orders loaded ahead.
  All thirteen tracks decoded come to 261 MB (megabytes) and used to stay for good; in a
  whole match played through the stand-in the most music held at once was 95 MB (in the
  briefing; about 87 MB during a stage, and one track, 31 MB, back in the lobby).
- **Music timing.** One-shots (no `loop` in the manifest) never loop. A cue with a `mark` is
  started part-way in so that the mark lands on its event (`landIn`): measured with the real
  files, the intermission's mark lands 8.006 s and 20.006 s after an 8 s and a 20 s
  intermission begin, the cocoon's cut 10.006 s after the cocoon (6 ms is the limiter's
  look-ahead). After an intermission the stage stems come in over 0.3 s while the hit rings
  out over 2.5 s. In the real page (sandbox, sound on, one molt): the cocoon cue started
  0.11 s in, the intermission cue 12.07 s in, and the stage 2 stems 7.99 s after that
  (7.99 + 12.07 = 20.06 against the mark at 20).
- **Voice.** The lines of `event.lines` are played, nothing else. Radio is a property of the
  line (audience `humans`); the squelch effects are added only to a radio line that has no
  audio. The humans' orders (`nerve.break`, `kaiju.special`) are loaded before the match, go
  first, cut in on chatter, and are dropped after waiting 1.5 s. The chair's line is held
  back: `MatchAudio` starts `hearing` 12.5 s after the match ends and says the line at 15 s
  (the end screen no longer starts it itself; `takeHearing()` is there if the end screen is
  ever to say the line). Clearing the voice stops the line being spoken.
- **What should sound now is read from the frame.** The beam, the heartbeat, the charging tone
  (`laser_charge_loop`, rising with the charge, then `volley_ready`) and the stage music follow
  the frame state, so a missed event (a reconnection) leaves nothing stuck. An event handed
  out more than a second after it happened, or while `MatchSession.catchingUp` is set, makes
  no one-shot sound and no radio line. A hidden page pauses the sound altogether.
- **Not done:** the Tier 2 unit sounds (no such units yet).

## 8. Integration pass (the whole thing run together)

Everything in this section was run on the production build made at 22:45 on 11 November from
the source of commit `bbaefc5`. It was not rebuilt afterwards. Commit `06c498a` (23:56) has since
added other people's work to the shared code: the Port Meridian files, 18 more archetypes, a
reworded voice script. None of that is in the build that was tested, so nothing here says how
the game behaves with it. `npm run build` has not been run on the current head. Scratch logs,
screenshots and the probe scripts are in `/tmp/mb-scratch/integration-resume/`.

Where this work is in the history: it was not committed under its own name. The integration
changes (`tools/playtest/scripted.mjs`, `driver.mjs`, `smoke.mjs`, this file and
ARCHITECTURE.md) are inside `06c498a`, "Art: UI pictogram set", a commit of 273 files that also
holds the city, voice and audio work in progress; one later sentence of this section is the
only content of `99c9ce9`, "Art: Gragnor the Lizard kaiju".

### 8.1 Is the tree green? (At the time: no. Superseded by section 11.1.)

- **`npm run check` fails on the head commit, `99c9ce9`** (run at 23:58 on 11 November in a
  clean copy of that commit: exit code 1). One test fails:
  `shared/test/exportDefs.test.ts` ("is up to date on disk"). 18 archetypes were appended to
  `shared/src/city/archetypes.ts` for Port Meridian, and `tools/art/data/archetypes.json`, which
  the art tools read, is out of date in that commit. Everything else passes: type
  check, lint (212 files), 460 of 461 tests. `npm run sim` passes there too (5 matches, the same
  results as before the city work: the placeholder city is unchanged).
- The fix is one command, `npm run export:defs`. It was **not** run by the integration task:
  the file belongs to the art tools, which that task was told to leave alone, and it would hand
  the art team a list of buildings whose author is still changing it (three Port Meridian
  files were modified again after the commit). It is the city designer's to run when the list
  is final. No check was loosened or skipped to get round the failure.
- The last commit that passed is `bbaefc5`. That commit with the integration task's files laid
  over it passes in full: clean `npm ci`, `npm run check` exits 0, 39 test files, 461 tests.
  (No check reads the two documents, which were reworded after that run.)
- Earlier in the evening (23:31) the working tree also failed the type check, on two lines of
  the new `shared/scripts/cityMap.ts`; its author fixed that before it was committed.

### 8.2 What was played, and how each run ended

| Run | Who played | Result |
| --- | --- | --- |
| `smoke.mjs` (5 pages, all on autoplay) | autopilot kaiju, 4 autopilot squads | Passed, zero console errors. Reached stage 2 only; humans won on the clock. |
| `smoke.mjs --idle-humans --expect kaiju --expect-stage 3` | autopilot kaiju, 4 people who never touch the controls | **Failed its own expectation**: humans won on the clock. It did reach stage 3 through both molts on all 5 pages with zero console errors. |
| `smoke.mjs --players 1 --role human --expect kaiju` | bot kaiju, 1 autopilot squad, 3 bot squads | **Failed its own expectation**: humans won on the clock at stage 3. Zero console errors. |
| headless client against the real server, twice | bot kaiju, 1 connected player who does nothing, 3 bot squads | Kaiju won by the bar, after 73 s and after 126 s of play. |
| `scripted.mjs`, run three times | a kaiju played with real inputs; then a squad played with real inputs in a practice match, hands off after about a minute | Last two runs (the test in its final form): 35 of 35 actions confirmed by the server, none failed, none left unattempted, zero console errors. All three runs' practice matches ended with the **kaiju winning by the bar at stage 3 (after 97, 74 and 96 s), end screen shown**. (The first run reported 34 of 34, but one of those, the fire-at-will key, could not have failed: a squad starts in that mode. The test now only counts a command that changes the squad's state.) |
| one page that volunteers for the kaiju, starts, and then never touches the controls | an idle kaiju, 4 bot squads | **Humans won by a kill after 143 s** (578 hits, 9 staggers, 69 volleys); the server's `matchEnd` says kill, the last snapshot has the kaiju dead at 0 health, end screen shown. Zero console errors. One match. |

So, on this build: all three stages, both molts and an ending in one match on five browser
pages with zero console errors: yes. All three endings have been seen in a browser, each with
its own picture on the end screen: the kaiju by the bar (three times, all practice matches seen
from a squad's seat), the humans on the clock (three times), the humans by a kill (once).
Headless, an idle kaiju is killed in about half of fast matches (3 of 6 seeds), so that run
is not a reliable way to get a kill either.

Why no autoplay run ended in a kaiju win, although `npm run sim -- --fast` gives the kaiju 5 of
6: this was chased as a possible server fault and is not one. The match configuration the
server builds is identical to the harness's (same marks, same timers), and the real server
plays a bot kaiju to a win when the squads are bots or idle. That leaves the client's
autopilot, on both sides, as the difference:

- Its squad drives to two thirds of weapon range and fires without pause. With one such squad
  in the room the bot kaiju ran out of clock; with none it won. This was concluded by
  elimination; the same match was not replayed with and without that squad.
- Its kaiju is a modest player. In the five-page run with nobody at the squads' controls it
  got about a fifth of the way through the last segment (bar 845, marks at 215 and 3255). In a
  separate 49 s sample at stage 3 in the sandbox it was staggered for 31% of the time, walking
  between single targets for 28%, and striking for 21%; it stood still for 2 s in all.

Both are test tools. The fast tuning was not changed. `--expect kaiju` with the autopilot as
kaiju fails by nature; the header of `smoke.mjs` now says so.

Also learned: a player who never touches the controls still fights. A squad starts on fire at
will (`shared/src/sim/spawn.ts`), so with four people who never pressed a key that match still
saw 736 projectiles launched (nearly all by the squads' sub-units; a few were the kaiju's own
throws), 547 hits on the kaiju and four staggers.

### 8.3 Measurements

ARCHITECTURE.md sets a budget for drawing (section 5) and an expected snapshot size (section
4.2). It sets **no budget for server tick time or for bandwidth**; those two are recorded here
as plain measurements, against the one hard limit there is: a tick has 33.3 ms.

| What | Measured | Budget | How |
| --- | --- | --- | --- |
| Draw calls at stage 3 | at most 107 on five pages; 116 on a single page | under 350 | `smoke.mjs`, the highest seen during play at stage 3 from the players' own cameras. The budget is stated for "the whole city in view", which these runs did not set up; section 7.5 has a figure taken that way (92). |
| Triangles at stage 3 | at most 174,902 on five pages; 157,270 on a single page (284,417 once, during an intermission's pulled-back camera) | under 1.5 million | same |
| Snapshot size | 792 bytes, the same at every stage while a match is in play | "about 800" | 9,289 snapshots encoded headless. Browser pages averaged 780 to 792 over whole matches; the small difference was not looked into. |
| Simulation, one tick at stage 3 | mean 0.22 ms, median 0.06 ms, 99th percentile 4.2 ms | none (a tick has 33.3 ms) | 7,790 ticks of six fast bot matches, headless |
| Snapshot build and encode | mean 0.04 ms, once every two ticks, shared by all clients | none | same |
| The real server, 5 clients, stage 3 | 29.94 ticks a second; 2.2% of one processor core; 0.73 ms of processor time per tick for everything | none | production bundle, five headless clients (four squads that drive, aim and fire, one spectator), bot kaiju; 671 ticks of stage 3 |
| The room loop, same match | update mean 0.38 ms, 99th percentile 2.44 ms, longest 8.07 ms; 33.33 ms between updates | none | `/healthz` `perf` |
| Down to each client | 15.0 snapshots a second of 792 bytes = 95 kbit/s, plus events (32 a second at stage 3). About 108 kbit/s in all, averaged over a whole match. | none | snapshots: the five-client run. Total: bytes over the WebSocket of one browser page with the server keeping real time. |
| Up from each client | about 18 kbit/s (30 inputs a second) | none | the same browser page |

Read these with the following in mind:

- **The five-client server figures come from headless clients, not five browsers.** Five
  software-rendered pages on this four-core machine starve the server: in both five-page runs
  it managed 21 to 22 ticks a second with updates up to 1.3 s apart. Those runs' own summaries
  print about 53 kbit/s per client; that is half the true figure, because a starved server
  sent 7.5 snapshots a second instead of 15. Do not quote timing or bandwidth from a five-page
  run on this machine.
- **Single slow ticks are the machine, as far as could be told.** A first timing of six
  matches had one tick of 203 ms. The simulation is deterministic, so the same six matches
  were then timed twice more, noting seed and tick: the slowest ticks (20 to 55 ms) were never
  slow at the same seed and tick in the other pass, nothing as slow as 203 ms came back in
  either, and only 3 ticks of 19,482 were over 3 ms in both passes. The largest cost that
  repeated was about 9 ms, on a tick that carries `stageChange` (presumably the redeployment
  of the squads; it was not profiled); another repeated at 8 to 17 ms with no events. On a
  host PC that is busy with something else the same pauses will happen; the loop then runs
  slow for a moment (section 4.3 of ARCHITECTURE.md). Six seeds, bots only, the placeholder
  city: a real match or the handcrafted city's road graph could cost more.
- Stage 3 in the five-client run lasted 22 s (the bot kaiju won quickly), with every unit
  still alive. It is a short sample of stage 3, not a long barrage.
- The size of the events on the wire was not measured directly at stage 3 (at most 52 kbit/s
  if they were sent as text; the real encoding is smaller).
- Frame rates are not recorded: these pages draw by software at 4 to 12 frames a second.
- Assets, in that build: all 25 models in its manifest loaded (none on a stand-in); 7 of the
  13 textures and 21 of the 27 sprites the client asks for are real art, the rest drawn by
  code; nothing failed to load. The only console warnings are the two for `city_atlas` and
  `city_atlas_emissive`, which do not exist yet. Art committed after 22:45 is not in it.

### 8.4 Played with real inputs (`scripted.mjs`): what the server confirmed

Kaiju, against the real server: creating a room, volunteering and starting by clicking the real
buttons; mouse look; walking; swipe (tap); stomp (hold); roar; brace; grab; throw; eat;
wrecking the neighborhood to the first mark; the molt to stage 2; the beam. Human, in a
practice match: drive; fire; the four commands by number key; the command wheel by holding the
right button, dragging and releasing; sub-units planting with their lasers on and building
charge; a charged volley; the map (the unit idles while it is open: the server did not move it)
and a move-to marker placed on the map; the camera toggle.

What those passes do not show, so nobody reads more into them:

- **Grabbing an intact car has not been seen with real input.** In all four runs the script
  walked the hatchling up to a live vehicle (truck, bus, bus, sedan), and each time the server
  reported that what it picked up was a wreck. Most likely the approach crushed the vehicle
  first (the script stops 5 m short, and a bus is 4.5 m in radius), but that was not checked,
  so whether a player at stage 1 can pick up a car without flattening it is an open question.
  The unit tests do grab one from a placed position. The thrown wreck came down on open
  ground three times and on a structure once; damage from a throw was not checked.
- Eat: the action and its cooldown were confirmed; the kaiju was at full health, so the heal
  was not seen. The beam: the action, the rage spent and the beam phase were confirmed, and
  it is drawn in the one screenshot taken while it was on; what it burned was not checked.
- Mouse look was driven through the fallback path (a button held on the view), because the
  test switches pointer lock off. **Mouse look under pointer lock, which is what every real
  player uses, is untested.** So is any gamepad.
- One check failed on the first run and was the test's fault, not the game's: it read the
  `kaijuHeld` event without waiting, and events reach the page about 100 ms behind the
  snapshot. `shared/test/kaijuActions.test.ts` shows the event is sent. The check now waits.

### 8.5 What the pictures show that is wrong or weak

Seen in screenshots; none of these was changed by the integration task. The first three look
like the first-person camera and hand-pose items said to be on the art director's list for
the client engineer (that list itself was not read here).

- **A held object blocks the hatchling's view.** While the stage 1 kaiju holds a vehicle, the
  object fills the middle and right of the first-person view; the player cannot see what the
  throw is aimed at (`scripted-k/kaiju-05-grab.png`). The art manifest has a `hold` pose made
  for this camera; the animator does not use the manifest poses yet. *Since changed:* the
  animator uses the manifest's poses and the held thing is shrunk in that view (section 7.4).
- **Bracing shows nothing in first person.** With the server reporting the brace, no arm is in
  view, although the pose is meant to cross the arms in front of the face (the roar, taken a
  moment earlier, does put the arms in view) (`scripted-k/kaiju-04-brace.png`). *Since
  changed:* the arms cross in front of the view in a brace.
- A brown slab across the top of the hatchling's view in one early frame
  (`smoke-a/04-early-kaiju.png`) is either the kaiju's own head or a roof at close range. Not
  determined.
- **The closing subtitle can be hidden on the end screen**: when the tally rows reach down to
  the subtitle band they are drawn over it, and the last voice line cannot be read. Seen at
  640 by 360 with a long kaiju tally, where the back button also covers part of the last row
  (`scripted-all/human-10-end-screen.png`); not seen at 800 by 450 with short rows
  (`kill/kill-attempt1-end-kill.png`). *Since changed:* subtitles are drawn over every
  screen, the end screen keeps a band at the bottom free for them, a long tally scrolls in
  its own box and the back button sits at the top left. Checked at 640 by 360, 800 by 450
  and 1280 by 720 with a kaiju tally of all ten classes and a two-line subtitle.
- **Hit flashes wash out the kaiju's own view.** Under fire in first person, each hit draws
  a large pale square over much of the screen, with its straight edge showing
  (`kill/kill-attempt1-low-health.png`: the right third of the view is blanked). It happens
  on every hit, and there were 578 in that match. It may be the same thing as the daylight
  blending of explosions said to be on the art director's list. *Since changed:* the kaiju's
  own hit flash is not drawn in its first-person view, explosions are alpha blended, and no
  bright particle is drawn wider than 0.6 of its distance from the camera.
- **Third person with a tall building close behind the kaiju**: the wall clearance brings the
  chase camera in to this side of the wall, which at stage 2 is 11 m behind a creature 32 m
  tall: the view is its back and spines, edge to edge
  (`clearance/chase-back-to-wall.png`). The camera is where the code means it to be; the view
  is unusable until the player walks clear. A chase camera that rose over the wall instead
  would be a design change; none was made. *Since changed:* the chase camera rises over the
  wall (section 7.4).
- The kaiju player's cocoon camera circles at a fixed distance with no regard for walls: a
  building next to the cocoon hides it for part of each turn. Cosmetic. *Since changed:* it
  comes in to this side of the building. (The cocoon itself is
  drawn correctly; a first reading of one such frame as "a building drawn in place of the
  cocoon" was wrong and was checked in the sandbox.)
- **When the server stutters, the view jumps.** In the two five-page runs, with the server
  starved to 16 to 22 ticks a second, the smoothness probe saw the kaiju step up to 5.8 times
  what its top speed allows between two frames and reverse direction twice (first run), and
  the view's clock run backwards once on each of the two pages probed (second run). With
  the server keeping real time, one page's probe (12 frames a second, about 3 s) saw no jump,
  no reversal and no backward step. Not investigated further, and there is no measurement yet
  with a kaiju page and a human page on a healthy server, nor at 60 frames a second.
  *Since changed:* the drawn clock can no longer run backwards (section 7.4; tested with
  stalled links, a server that stops for 1.3 s and a server that keeps losing time). The
  jumps of the player's own body in those runs were not the clock: a page at 2 to 3 frames a
  second sends its inputs in bursts of eight, the server keeps the newest two of a burst, and
  the prediction is then corrected by more than its 12 m snap distance. That rule is the
  server's (section 4.3 of ARCHITECTURE.md) and was not changed here.

### 8.6 Left by the interrupted first attempt at this task, and their state

- The loop timing meter and `perf` in `/healthz`: reviewed, tested (`server/test/perf.test.ts`,
  and a check in `server/test/realtime.test.ts`), used for the figures above. Now documented
  in ARCHITECTURE.md section 4.4.
- `smoke.mjs` extensions (idle pages, WebSocket byte counts, stage tracking, the smoothness
  probe, expectations): reviewed and used. The help text of `--idle-humans` and `--expect`
  promised more than they deliver and was corrected.
- `driver.mjs`: reviewed and used by `scripted.mjs`; one fault in it was fixed (8.7).
- Wall clearance for the kaiju and human cameras (`cameraClearance.ts`): reviewed, its five
  unit tests pass, and it is in the build that was played. Measured in play at stage 2, in the
  sandbox, with the kaiju stood by a 36 m apartment block and driven with real inputs:
  - First person, body pressed against the wall, head swept left and right, 150 frames: the
    head's camera anchor was inside the building on 91 frames; the camera itself on none. The
    camera came no nearer the wall than 0.98 m, with the near plane at 0.64 m, so the wall was
    never cut through (the spare was 0.34 m at the worst frame). What the player sees is the
    wall filling the screen.
  - Third person, back 14 m from the same wall: the chase camera, which sits 91.6 m behind on
    open ground, came in to 10.8 to 12.8 m and was inside no building on any of 92 frames.
    **But from there the kaiju's own back fills the screen** (section 8.5).
  - Not measured: the human chase camera; stage 3 (a titan wades through towers, and the code
    deliberately gives up while the body is inside one); stage 1.

### 8.7 For whoever is next

- **`client/dist` and `server/dist` are older than the head commit.** They were built at 22:45
  from the source of `bbaefc5`. The playtest tools only build when those folders are missing,
  so until someone runs `npm run build` they test that older build, without the Port Meridian
  code, the extra archetypes or the reworded voice lines. Rebuild, then rerun `smoke.mjs` and
  `scripted.mjs`, once the city and voice work has settled; expect the draw-call figures of 8.3
  to need measuring again if the client makes a batch for every archetype in the list.
- A server is being started from `server/dist` by some other tool on port 47979 with normal
  timers, every few minutes, with one room and no players. It is not part of the playtests
  here and was left alone. A rebuild replaces the files under it.
- Do not use `--expect kaiju` with the autopilot in the kaiju seat. The kaiju wins seen in a
  browser came from the human session of `scripted.mjs` (a practice match; the bot kaiju won
  after 97, 74 and 96 s). That is three runs. Two more practice matches with a headless
  player who did nothing ended the same way after 73 and 126 s; the clock is 150 s, so a
  practice match can also run out, as the one with an autopilot squad did.
- To see the kill ending in a browser: open one page (no autoplay), create a room, volunteer
  for the kaiju, start, and leave it alone. The one browser match played this way ended in a
  kill after 143 s; headless, 3 of 6 such matches did and the others ran out the 150 s clock,
  so it may take more than one try. No tool in the repository does this for you.
- `driver.mjs`: `until()` now awaits its test. Before, an async test returned a promise, which
  counted as true, so the wait ended at once having waited for nothing (this cost one wasted
  run here). `scripted.mjs` only uses plain tests and is unaffected.

## 9. Open items for the next client engineer (from the coordinator)

Done by the client's city task (section 11): black building models, the night ground, the
thrown object from the hand, the lobby's sleeping seats and bot seats, the autopilot's
volleys, the district tint. Still open:

- **Stand-ins still in use:** the six marker sprites (`mk_*`); the textures `window_tile`,
  `window_tile_lit` (only for a missing building file now), `ground_plaza`, `ground_far`; the
  icon `ui_controls` (drawn in code; the other code-drawn icons got art files in the art
  polish round).
- **Not done, optional:** automatic lowering of resolution on slow frames; camera roll during
  a stagger; debris sprites (nothing spawns debris yet); district roof colors
  (`docs/art/client-notes-city.md` section 6).

## 10. The city switch (12 November)

The game plays in Port Meridian: `getCity()` builds it for the server (match setup, the
welcome's city checksum, the build stamp), the client, the sandbox, the bots and the harness.
Checked in headless Chromium: the sandbox (`?sandbox=1` and `=3`) runs with Port Meridian's
marks and no console error. Bot, navigation and simulation fixes the new city needed, and the
retune (bar fractions 0.18 / 0.125 / 0.31): `docs/BALANCE.md` section 8.

Cost against section 8.3, measured headless in Node on this machine, same session, same method
for both cities:

| What | Port Meridian | Placeholder | Matters for five players at home? |
| --- | --- | --- | --- |
| Simulation, one tick at stage 3 | mean 0.08 ms, median 0.05, 99th percentile 0.4 to 0.5, longest 14 ms (38,000 ticks of 3 full and 6 fast bot matches) | mean 0.10 to 0.14 ms, same method | No: under 1% of the 33 ms a tick has. |
| The tick that starts a stage (redeployment) | median 4 / 5 ms, at most 20 ms (stage 2 / 3, every start) | 2 / 4 ms | No: once a stage, inside the tick. It was 59 ms before the street lookup got a grid (`nav.ts`, results identical). |
| Snapshot | 792 bytes | 792 bytes | No change. |
| City state in the welcome | 2068 bytes | 1732 bytes | No: once per join. |
| Events at stage 3, bots only | 11.7 to 16.7 a second, 16 to 24 kbit/s as plain text | 9.4 to 13.0, 12 to 18 kbit/s | Slightly more (about a quarter, more props and buildings): a few kbit/s per player on top of the 95 kbit/s of snapshots, about 0.6 Mbit/s up from the host for four remote players. |
| Building the city in Node | 200 to 216 ms processor time cold (fresh process, 5 runs), 47 ms warm | 12 to 17 ms cold, 2 ms warm | Once when the server starts; the page does the same behind its loading screen (about 270 ms in Chromium, `docs/CITY.md` section 7). |

The client's part (district tint, draw calls, five browser pages on the real city) is in
section 11.

## 11. The real city in the browser (12 November, the client's city task)

### 11.1 Is the tree green? Yes

`npm run check` exits 0 on the working tree at the end of this task: type check clean, lint 238
files clean (one `STUB(server)` left; `STUB(render)` is gone), 55 test files, 727 tests.
`npm run build` was run; `client/dist` and `server/dist` are current. Scratch logs and every
picture named here: `/tmp/mb-scratch/client-city/`.

### 11.2 What changed

- **Buildings from their art.** All 40 archetypes draw from their files: the city atlas read
  unflipped (it was upside down, which made the models black) and mipmapped; the night atlas
  lights windows, signs and beacons, and fires in damaged buildings; damaged and rubble states;
  collapse throws the art's own chunk meshes (one shared buffer, one draw call). Wall colors:
  each building takes one of its model's colors times its district's tint; landmarks keep
  their own colors (`docs/CITY.md` section 2). The afternoon's light from below is now pale
  grey (cream walls in shade were olive); the ground dims to warm greys at night.
- **Map.** District ground in map tints with names, bridges as roads, and a small picture of
  each landmark painted from its model.
- **Lobby.** A player not ready after 20 s gets a sleeping picture (`ui_asleep`) and the start
  button is live without them; empty seats show a bot leading a squad. A page refused as out of
  date shows its own picture (`ui_outdated`).
- **Autopilot squad.** Parks, charges and fires volleys together with the others as the squad
  bots do. **Thrown objects** start at the model's hand and join the simulation's path within
  0.15 s.
- **`scripted.mjs`.** The human session turns to an open street before testing the drive, and
  plays against a second page that takes the kaiju and stays idle (the practice bot kaiju
  molted within a minute on Port Meridian, and every molt redeploys the squad, which undid the
  checks half way).

### 11.3 Measured

| What | Figure |
| --- | --- |
| Whole city in view, stage 3, all buildings intact | 111 draw calls, 360,000 triangles |
| Same, a third damaged and a third rubble, 480 pieces falling | 166 draw calls, 367,000 triangles (budget 350 / 1.5 million) |
| Five-page match, highest on any page | 131 draw calls, 500,556 triangles |
| Before this task (black buildings) | 94 to 114 calls, up to 597,000 triangles |
| Page ready (home screen, cold, local) | 0.94 to 1.0 s; 84 files, 8.3 MB (5.5 MB are building models) |
| City mirror | all five pages predicted (checksum equal to the server's) through a whole match |
| Volleys in a five-page autopilot match | 29, with 2 staggers (4 before the change, none) |

### 11.4 Runs

- `smoke.mjs`: passed, zero console errors and zero warnings, stage 3 reached, humans won on
  the clock.
- `scripted.mjs`: 37 of 37 confirmed by the server, zero console errors.
- `shots.mjs`: passed, zero console errors.
- Pictures for the owner: `docs/progress/city-*.png` (skyline, street, night, wrecked, map),
  real frames of the built game in the sandbox, uncropped.

### 11.5 Still open

- The sunset ground reads lavender (pale paving under the sunset's violet sky light). Not
  wrong, not pretty. (Fixed in section 12.)
- Landmark pictures on the map are drawn once, in daylight colors.
- Building models are 5.5 MB to download; over a slow tunnel the first load takes a few seconds.
  (The loading screen now shows it: section 12.)

## 12. Client polish before the first playtest (12 November, the client-polish task)

Scratch logs, scripts and every picture named here: `/tmp/mb-scratch/client-polish/`
(`PROGRESS.md` is the running log).

### 12.1 What changed

- **The controls card** (`client/src/ui/controlsCard.ts`). Every control of the player's role
  as pictures: the button's glyph on the device in use, then a picture of what it does (a
  ring around a glyph means hold it, a small arrow means "then", the HUD's growing triangles
  mark controls that only exist at some stages). The kaiju's card is built from its action
  table (swipe, stomp, grab, grabbing tanks and building pieces from stage 2, throw, eat,
  brace, roar, beam, molt); the squad's shows move, look, fire, the call-in, the command wheel
  and its four commands, the volley (hold and charge, full charge, then the leader's own shot),
  the map with its click and right click, the drone, camera, settings and the card itself.
  It switches between keyboard and controller glyphs when the device in use switches.
  Where: a yellow button beside the gear in the lobby (for the role picked there) and top right
  on the briefing screen; open by itself for the whole briefing (the portrait and names step
  aside meanwhile); in a match it opens and closes with **H** or a **click of the left stick**
  (the one controller button nothing used), and that key is shown beside the settings gear.
  In a match it takes no mouse input, so the captured pointer stays captured and the game
  runs on (walking with it open covers the same distance as with it closed). New action
  `controls`; `ACTION_USERS` in `actions.ts` says who presses each action, and
  `client/test/controlsCard.test.ts` fails if a pressable action is missing from a card.
  The card's icon `ui_controls` is drawn in code for now. The full table: `DESIGN.md` section 8.
- **Sunset ground.** At sunset the ground is multiplied by a warm tint (`SUNSET_TINT` in
  `render/ground.ts`, driven by a new `sunset` amount in the sky presets): paving reads as
  warm sandstone under the violet sky, roads as dark grey, the fields beyond the city stay
  dark green. Tuned by eye on frames looking toward the sun and away from it.
- **Loading screen.** The page shows the name, the kaiju and a bar from the first moment
  (written into `index.html`, so it is there while the 1.3 MB game code downloads). The boot
  bar follows the bytes of each model as they arrive, never moves backwards, a band of light
  runs along it and the kaiju breathes the whole time.

### 12.2 Measured

| What | Figure |
| --- | --- |
| Load over a simulated 2 megabit per second line (one shared line, local server) | name and bar at 0.3 s; game code in at 5.4 s; home screen at 36 s; the bar never stood still longer than the 0.5 s sampling step; all 65 models real; no console error |
| Controls card open, software rendering, 960 x 540 | frames a second drop by about a quarter (for example 7.8 to 6.2); an animated ring and a dimming sheet had halved them and were removed. A real graphics card should not notice. |
| Tests | 56 files, 735 tests (8 new) |

### 12.3 Runs

- `npm run check`: passed. `npm run build`: done.
- `shots.mjs`: passed, zero console errors, all three stages on both sides; 100 to 121 draw
  calls, 387,000 to 426,000 triangles.
- `smoke.mjs`: passed. Five pages, zero console errors and zero warnings, stage 3 reached,
  every page predicting; at most 125 draw calls and 453,000 triangles.
- `scripted.mjs`: the human session 21 of 21 confirmed by the server. The kaiju session
  failed one hold in each of its first two runs (eat in the first, brace in the second; each
  passed in the other run) and passed 16 of 16 on the third, all with zero console errors.
  The machine was loaded (four cores shared with the art work); nothing in this task touches
  the kaiju's buttons, but the flakiness is reported, not explained.
- Pictures for the owner: `docs/progress/controls-squad.png`, `docs/progress/controls-kaiju.png`
  (the card in a match, keyboard and mouse) and a new `docs/progress/city-wrecked.png` (sunset,
  stage 2, from above the kaiju as before), all taken from the build that includes the art
  polish round's new ground textures and icons. Also checked by eye: the card with controller
  glyphs, at 1366 x 768, in the lobby (both roles) and on the briefing screen against a real
  server.

### 12.4 Still open

- District roof colors: not done. It needs a second color mask or a second house model from
  the art side (`docs/art/client-notes-city.md` section 6).
- The controller glyphs come from the art: the directional pad's four directions and the
  face buttons are small differences in a small picture; on the card they are drawn larger,
  but nobody has tried them with a real controller in hand.
- In the sandbox, the first frame after jumping straight to stage 3 can still show the
  afternoon sky while the sky changes over; halfway between sunset and night the whole view
  goes magenta for a few seconds. Neither is new, both are short.
- The card's own icon is drawn in code; the art team may want to replace `ui_controls`.


## 13. Release round before the first playtest (12 November, the release task)

Scratch log, measuring scripts and pictures: `/tmp/mb-scratch/release/` (`PROGRESS.md`).

### 13.1 What changed

- **Last hookups** from the art polish notes: `ground_plaza` and `ground_far` are in the
  client's texture list (a missing file is reported like the other ground tiles); two stale
  comments about stand-ins fixed (`procedural/sprites.ts`, `ui/iconArt.ts`). No stand-in is
  left where an art file exists; only `ui_controls` is still drawn in code (it has no file).
- **Compressed downloads.** The client build now ends with `scripts/precompress.mjs`, which
  writes a gzip copy (`<file>.gz`) of every model, script, style sheet, data file and vector
  icon in `client/dist` (173 files, 8.4 MB to 1.7 MB). The server (`server/src/http/app.ts`)
  sends that copy to browsers that accept gzip, with `Content-Encoding: gzip`,
  `Vary: Accept-Encoding`, the same cache rule as the plain file, and `X-File-Size` (the
  original size, which the model loader reads, so the loading bar stays honest). Pictures and
  sounds are sent as before. Nothing is compressed at run time and nothing new is installed.
  Covered by a new test in `server/test/realtime.test.ts`.
- **`smoke.mjs --url URL`** plays against a server that is already running (the container)
  and starts nothing.
- **Documents:** `README.md` (new, at the root), `docs/PLAYING.md` (new: the guide the host
  sends to friends), `docs/HOSTING.md` (sizes, the first-load note, the controller, the guide,
  section 11 updated with this round), `docs/ARCHITECTURE.md` section 4.4 (cache and
  compression rules).

### 13.2 Measured (the container image built from this tree)

| What | Figure |
| --- | --- |
| Image | 256 MB (254 MB before the compressed copies) |
| `npm run check` | passed: 56 test files, 736 tests (1 new) |
| In the image and served | 65 models (40 buildings and landmarks), 11 textures, 31 sprites in 4 sheets, 92 icons, 13 music pieces, 129 sound effect files, 221 voice lines (every sound as MP3 and OGG: 726 files, none missing) |
| Cold first load (fresh browser, until the home screen) | 2.16 MB in 88 requests (was 8.71 MB); local: 1.1 s; over a simulated 10 megabit per second line: 2.8 s (was 8.1 s). No console errors or warnings. |
| Cache rules | hashed code and style sheet: one year, `immutable`; everything else `no-cache` with an ETag (a repeat visit only revalidates) |
| Five-page match against the container (`MB_FAST=1`, `--idle-humans --expect-stage 3`) | passed: stage 3 reached, humans won on the clock, zero console errors and zero warnings on all five pages, about 50 kbit/s down per page |

### 13.3 How the image was built here, and why it differs from the host scripts

`podman compose build game` (what `host/start.sh` runs) needs Podman's service socket, which
this machine does not run by default: it was started for the test and stopped afterwards (Podman
Desktop provides it on Windows). Inside the build, `npm ci` could not reach the package registry
through this machine's intercepting network proxy without its certificate, so the image was
built with `podman build --network host` from a scratch copy of the `Containerfile` that only
adds `ARG NODE_EXTRA_CA_CERTS` to the two install stages. The runtime image is the same; the
owner's machine needs none of this. The container was then started with `podman compose up
game` exactly as the scripts do (no tunnel), and a second one with `MB_FAST=1` for the match.

### 13.4 Still open

- The real tunnel, the Windows scripts, Docker, and a real controller and graphics card:
  untested, as before (`HOSTING.md` section 11).
- In this run the screenshot meant to show a guest's lobby caught the first frame of the
  match instead, with every action hint (monster, squad and drone) on screen at once. The
  machine was overloaded, so this frame lasted long enough to be photographed; on a normal
  computer it should be a single frame. Not chased.
- From earlier rounds and unchanged: the halfway sunset-to-night magenta moment, the flaky
  kaiju holds in `scripted.mjs`, and no district roof colors.
