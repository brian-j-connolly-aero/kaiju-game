# Monster Battle 9001: Status

Living status file. Keep it short and true: when you finish a task, update what exists, remove
the stubs you filled in, and add any decision the docs left open. Contracts live in
`ARCHITECTURE.md`; numbers live in `DESIGN.md` and `shared/src/defs/`.

Last updated by: the phase 1 integration (the last section: both sides' phase 1 work run
together, the leftovers of the old controls removed, matches cut by about a fifth, the game
played end to end in the browser), after the phase 1 tasks that came out of the first
multiplayer playtest (`docs/ROADMAP.md`: the monster's new controls and moves and the army's
two buttons, swarm and tank driving, each in the simulation and on screen; the on-foot stutter
fix and third person by default; natural voices, started early) and the polish passes before
them. Earlier: the game server task (everything about `server/`), simulation parts 1 to 3 (the
kaiju, damage and nerve, the city, projectiles; the squads; match flow, bots, voice lines, the
balance harness: `docs/BALANCE.md`), the city switch (section 10: the game plays in Port
Meridian), the client core task (section 7), the integration task (section 8), the client's
city task (section 11), the client polish (section 12), the release round (section 13) and the
last fixes before the first playtest (section 14); the rest is from the scaffold task.

**Read the last section first: it says whether `npm run check` passes right now.**

## 1. How to run things

| Command | What it does today |
| --- | --- |
| `npm install` | Installs the pinned toolchain and the server's dependencies (Express, the room library). |
| `npm run check` | Type checks all three workspaces, runs `scripts/lint.mjs`, runs every test. The gate. |
| `npm test` | `vitest run`: every test in `shared/test`, `server/test` and `client/test`, about 40 seconds (the server's integration tests and the whole-match simulation tests take most of it). |
| `npm run sim` | The balance harness: full bot-versus-bot matches, headless, a few hundred times real speed, one table row per match plus a summary. Options after `--`: `--seeds N` (default 5), `--seed N`, `--unopposed` (no squads), `--kaiju-handicap H`, `--human-handicap H` (0 best, 1 stands still), `--trigger-happy` (squads hold the trigger instead of charging volleys), `--fast`, `--anchor N`, `--every-anchor` (every start in turn), `--bar P1,P2,P3` (other bar fractions for one run), `--clock S` (another match clock for one run), `--nav` (how the bots got about), `--city placeholder` (the old grid city), `--max-minutes N`, `--events`, `--json`. 20 matches take 25 to 50 s depending on what else the machine is doing. How to read it: `docs/BALANCE.md`. |
| `npx vitest run server/test` | Only the server tests: 115 tests, about 18 seconds (four files start a real server on a free port and connect real clients; `process.test.ts` starts the entry point as a process of its own). `MB_TEST_SPEED=1 npx vitest run server/test/lifecycle.test.ts` plays the full five-client match in real time (about 3 minutes). |
| `npm run dev` | Starts the server (`tsx watch`, port 2567) and the client (Vite, port 5173) side by side with hot reload; open the Vite address. Vite forwards matchmaking and the WebSocket to the server, so the page talks to its own origin exactly as in production. |
| `npm run build`, `npm start` | Bundles the server to `server/dist/index.js`, builds the client to `client/dist` (and writes a gzip copy, `<file>.gz`, of every model, script, style sheet, data file and vector icon there: `scripts/precompress.mjs`; the server sends it to browsers that accept gzip); `npm start` runs the bundle, which serves the built client and the game on one port (`PORT`, default 2567). Environment variables: `ARCHITECTURE.md` section 4.4. |
| Hosting (`host/start.cmd`, `host/start.sh`, `npm run host`) | Self-hosting for playtests: `Containerfile` and `compose.yaml` (game plus a Cloudflare Tunnel) at the root, one-command start, stop, update and logs scripts in `host/`, and `npm run host` (build, then start) without containers. The start scripts check the public link through the tunnel, which also tells the server its public address; the lobby's link button then copies an invite that works for friends even when the host plays on localhost (`MB_PUBLIC_URL` for a named tunnel; `ARCHITECTURE.md` section 4.4). The owner's guide: `docs/HOSTING.md`. |
| Player guide, readme | `README.md` at the root (what this is, where to start); `docs/PLAYING.md`, the guide the host sends to friends (joining, both sides, the controls from `actions.ts`, the pictures on screen, tips). Keep its controls tables in step with `actions.ts` and `DESIGN.md` section 8. |
| `npm run export:defs` | Rewrites `tools/art/data/archetypes.json` from the code (`-- --check` only verifies). A test fails when the file is stale. |
| `npm run assets:manifest` | `tools/build-manifest.mjs`: merges `client/public/assets/manifest.*.json` into `manifest.json`, lists the files in `ui/`, and leaves out (and reports) entries whose files are missing. `-- --check` only says whether the file is stale. The client build runs it first. |
| `npx vitest run client/test` | Only the client tests: 20 tests, about 1 second (prediction against a real simulation through latency, the mirrored city, interpolation, the clock, the action map, the animator, the manifest tool). |
| `node tools/playtest/smoke.mjs` | The browser smoke playtest: starts the server with `MB_FAST=1` on a free port against the production build, opens 5 headless Chromium pages on autoplay (one creates a room, four join by code), plays one match to its end, fails on any console error or page crash, saves screenshots to `/tmp/mb-scratch/playtest/` and prints, per page, draw calls and triangles (peak, and peak at stage 3), bytes over the WebSocket, snapshot size, a smoothness probe, and the server's own timing from `/healthz`. About 4 minutes on this machine. Options in the file header (`--url URL` plays against a server that is already running, such as the game container started with `MB_FAST=1`, and starts nothing; `--players N`, `--role human`, `--no-assets`, `--reconnect`, `--debug`, `--idle-humans`, `--expect kaiju\|humans`, `--expect-stage N`). Five software-rendered pages take the whole machine: the server then runs at about 21 ticks a second, so this run's timing and bandwidth figures describe the test rig, not the game (section 8.3). |
| `node tools/playtest/scripted.mjs` | The scripted playtest with real inputs: no autopilot. One headless page plays the kaiju, then another plays a squad in a practice match, then a third drives a tank at stage 2 in the sandbox, with real key presses, mouse buttons, mouse movement and clicks on the real lobby buttons (`tools/playtest/driver.mjs`). Each action is judged only by what the server (for the tank, the sandbox's own simulation) sent back (its newest snapshot and its events) and ends as pass, FAIL or not attempted; the run passes only if everything was attempted and confirmed. Screenshots and `report.json` in `/tmp/mb-scratch/playtest/scripted/`. About 5 to 10 minutes. `--only kaiju\|human\|tank` (human runs the squad and the tank; tank the tank alone), `--out DIR`. It switches pointer lock off (headless Chromium reports garbage mouse movement under it), so mouse look under pointer lock is NOT covered by it. |
| `node tools/playtest/shots.mjs` | Stage screenshots with no server: opens the built client in sandbox mode (`?sandbox=<stage>`, the simulation runs in the page) for stages 1 to 3 on both sides, plus scripted extras (the squad's volley meter from empty to full and its countdown ring, the tank's third-person view with both reticles, the monster's kit, molt cards and moves, the beam, a stagger, swimming). Pictures in `/tmp/mb-scratch/playtest/shots/`; fails on console errors. |

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
  - input intake: edges, hold timers, bot inputs, driven unit control (the squad commands, the
    wheel and the map orders are gone since phase 1);
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
    `sim/nav.ts`; rules in `DESIGN.md` section 5, "How squads work"; rebuilt in phase 1):
    - two buttons: Fire, and Volley (hold to plant the squad-mates, lasers on, charging 0 to 1
      over 4.5 s at the point the leader's crosshair lands on; let go to fire them all, the
      leader's own shot with them), `volley.ready`;
    - the swarm: a loose group around and behind the leader along its trail, single file where
      a street is narrow, keeping up at every stage (hurry, braking to its place, and the
      leader's own way after it when it has fallen behind); navigation (straight line, else the
      road graph inside the bounds, with local steering round walls; rubble, river and bridges
      passable; stuck handling);
    - tank driving for the unit a person drives at stages 2 and 3 (throttle and hull turn, a
      turret that follows the aim at its own rate), predicted exactly by the client;
    - fire at will with range and line-of-fire checks, target leading, weapon traverse;
    - weapons: cooldowns, salvo size from members, the driven unit's exact aim, aim error and
      the scatter multipliers (stage, spotted, slowed, veteran), the volley with charge
      multipliers, `volley`, tallies;
    - the artillery call-in machinery (marker, delay, eight real shells, scatter, `callin`),
      with no button: `startCallIn` is the entry point for phase 2's radio;
    - shaken squad-mates backing off; takeover of the nearest survivor; elimination until the
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
"How squads work", and the numbers the design left open are `SQUAD_RULES` in `defs/rules.ts`.
Phase 1 rebuilt the controls: the bullets marked "Phase 1" replace what stood there before;
the army's phase 1 section at the end of this file has the rest)

- Phase 1: there are no commands. Squad-mates plant only while the volley button is held
  (wherever they are at that moment) and are all let go when it is let go, fired or not; then
  they follow the leader again. A squad can no longer be parked somewhere to make a crossfire
  on its own.
- Phase 1: there is no firing arc. A planted squad-mate turns its weapon toward the aim point
  at its traverse rate and fires with whatever charge it has. Volleys check no line of sight;
  range limits them only in that every projectile gives out at 1.1 times its weapon's range.
- With the crosshair on a kaiju, sub-units aim for the middle of its body at the height the
  player picked (the event's aim point is still where the ray met its skin).
- Aim error is drawn per projectile, on heading and elevation. A person's own shots have none.
  A bot's driven unit shoots with the at-will error and half nerve, except when its shot goes
  with a charged volley (then volley error, full nerve).
- "Slowed", for scatter, is staggered, cocooned, or at least 30% of nerve capacity in
  accumulated nerve damage (`COMBAT_RULES.scatterSlowedNerve`).
- "Spotted" counts the driven unit of every squad, bot squads included (bots play by the same
  rules). This changed the scaffold's behavior, which left bots out.
- Sub-units firing at will lead the target, swing their weapon at 270 degrees per second, and
  look for a clear line of fire to the middle of the body, then higher, then lower.
- Phase 1: the squad-mates move as a swarm, places measured back along the leader's trail
  (two side by side one spacing back, one two spacings back; single file where the street is
  too narrow), so it follows streets by itself. Stragglers catch up at 1.3 times speed
  (`unit.nav.hurry`, squad-mates only), and one more than three spacings behind drives the
  leader's own way after it. There are no hold points and no move-to orders any more.
- Takeover goes to the survivor nearest the unit that died, the tick after it died.
- Every unit alive at the end of a stage is a veteran at the next (the driven one too).
- Artillery shells fall at 75 degrees from 400 m, over the caller's shoulder; the first lands
  `delay` seconds after the marker (within a tick or two). A mission outlives its squad.
- Bridge decks are road surface for projectiles, sight lines, lines of fire and aim rays
  (`skipPassable` on the city casts). The kaiju's aim ray uses it too; the beam does not.
- Tests written when sub-units did nothing were adjusted, not weakened: the kaiju tests keep
  every squad-mate from firing (`holdFire` in `test/helpers.ts`) and use driven units (ids 0, 4,
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
  call `holdFire(world)` (no squad-mate's weapon comes ready until the next stage; since phase 1
  squad-mates always fire at will) or park the squads out of range, and
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
  The acknowledgement in a snapshot is the server's own per connection (`packedAck` in
  `server/src/room/inputQueue.ts`: the inputs played or dropped, and how many more it will
  drop; `ackOf` in `server/test/helpers.ts` reads it), not `world.players[i].input.seq`,
  because a bot may have driven the slot in between. Only one
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
  wind-up animation from `kaijuAction` (phase 'windup', `duration`).
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
- The balance was tuned for bot against bot in Port Meridian before phase 1 (`docs/BALANCE.md`
  section 8). Phase 1 changed both sides' controls and only the pace was cut since (section 9):
  with the 9:36 clock and `p3` 0.29 the kaiju bot wins 20 of 40, stages of about 2:02 / 2:27 /
  3:01, matches of about 7:30, 16 kills in 40. Balance waits for the owner's next playtest; real
  players will move it. Numbers nobody has tuned yet: action move multipliers, wade damage, rage
  per bar segment, prop values, archetype hp and value, and everything new in phase 1.
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
- Sub-unit navigation, stress-tested in Port Meridian before phase 1 (1800 random move-to
  trips over every start and stage, markers anywhere; the move-to order is gone, the same
  navigation now brings a squad-mate back to its leader): nobody inside a wall or outside the bounds; 13 trips
  (0.7%) took more than three times the straight drive plus a minute, 4 never arrived, all into
  pockets of houses against the stage 1 line or far out in the bay. Every street edge is
  drivable straight for a 9 m troop. A unit that cannot reach its spot waits and retries; it
  never pushes into a wall forever, but it will not arrive either.
- Units do not collide with each other or with the kaiju; sub-units only keep apart while
  moving. A parked squad can be walked through.
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
- A release held up by the network is played late: the server has to guess while nothing
  arrives and guesses "still held", so the hold lasts longer by the ticks it guessed (a volley
  charges a little more, a brace lasts a little longer; behind a stall of about 0.4 s or more
  a tap can become a hold). On simulated links one hold in 20 to 30 came out a tick or two
  longer on the worst link, none to two in 100 on the others (the stutter-fix section at the
  end). Mending it needs the simulation to take a late release back, which it cannot do today.
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
client/src/ui/      hud.ts, mapView.ts (view only), subtitles.ts, settingsPanel.ts, icons.ts,
                    iconArt.ts (stand-in icons), controlsCard.ts (every control of a role, as pictures),
                    kaijuKit.ts (the monster's buttons on the HUD: the kit, the two move slots, molt),
                    moltCards.ts (the molt card picker: three cards, picked by key, d-pad or click),
                    volleyMeter.ts (the squad's volley meter round the crosshair), gunReticle.ts (a tank
                    gun's own sight)
client/src/kaiju.css                the monster's HUD kit, card picker and controls-card pieces (next to styles.css)
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


## 14. Last fixes before the first playtest (12 November, the last-fixes task)

Scratch log, scripts and every picture named here: `/tmp/mb-scratch/last-fixes/` (`PROGRESS.md`).

### 14.1 What changed

- **Names.** A friend who opens the invite link for the first time (no name stored in that
  browser) now sees only a name box and a join arrow; Enter joins, and an empty box joins as
  "Player N" (`invitePrompt` in `client/src/app/screens/home.ts`). In the lobby your own name
  is a box you can click and change; Enter or clicking away sends it (the server already had a
  `setName` message that cleans names with `cleanPlayerName`, so no server change). The new
  name is remembered for next time. `docs/PLAYING.md` (Joining, step 2) and `docs/HOSTING.md`
  (step 7) describe it.
- **The magenta moment.** The sky, fog and light colors were blended in a straight line from
  the orange sunset to the blue night, and orange plus blue light makes pink: halfway, the
  sunlight itself was #d5aec4. The change now passes through a dusk (`DUSK` in
  `client/src/render/sky.ts`: a deep blue-violet sky over a slate horizon, a pale low sun).
  `client/test/sky.test.ts` checks every blended color in both directions for pink.
  Before and after, seven frames each: `docs/progress/sunset-to-night.png` (top row old,
  bottom row new). The sunset's own pink glow around the sun still fades out over the first
  third of the change; that is the sunset, not the blend.
- **Afternoon sky after jumping to stage 3.** The renderer showed the first frame of a match
  (a sandbox started at stage 2 or 3, or a player joining a match in progress) by fading from
  the afternoon. That first stage is now shown at once (`stageSeen` in `gameRenderer.ts`).
- **First-frame flash.** The heads-up display (HUD) was put on the page with all three sets of
  action pictures (monster, squad, drone) visible and only sorted out on its first update; when
  the match screen appeared before the first frame of the match, one frame showed them all.
  It now starts hidden and shows itself on its first update (`client/src/ui/hud.ts`).
- **Held buttons.** See 14.3. One real fix in the server: a connected player who goes silent
  (a stalled connection) used to have their held buttons let go after 0.5 s, so a hiccup in the
  middle of a brace, an eat or the molt cut it short and the late inputs then started it again.
  Movement still stops after 0.5 s; held buttons are now kept for 1 s (`STARVED_BUTTON_TICKS`
  in `server/src/room/match.ts`), and the input queue's hard limit went from 20 to 32 so that
  such a hold still fits in whole. Two new tests in `server/test/gameRoom.test.ts` (a brace and
  an eat through a 0.7 to 0.8 s stall) fail with the old rule and pass with the new.
- **The controls card icon.** `client/public/assets/ui/ui_controls.svg`, hand-written in the
  set's style (a card with a solid key and a directional cross), in the manifest, in the
  preview tool's settings group and in `docs/art/UI_ICONS.md` and `docs/ASSETS.md`. The icon
  sheets in `docs/art/previews/` were redrawn. The game uses the file (lobby, briefing, the HUD
  hint, the card itself); the drawing in `iconArt.ts` stays as the fallback, like every other.

### 14.2 Measured

| What | Figure |
| --- | --- |
| `npm run check` | passed: 57 test files, 742 tests (6 new) |
| Pink in the sunset-to-night blend (chroma of the most pink color, 0 to 255) | old: 51 (the sunlight), 37 (the horizon); new: at most 9 on any color |
| Sandbox started at stage 3 | the night sky from the first frame photographed |
| HUD on the page when the match screen appears | 0 of 17 action pictures visible; on the next frame the 8 that belong to the monster |
| Names, three browsers against a real server | first visit by invite: asked, typed "Gertrude", Enter, the host's lobby shows Gertrude; renamed in the lobby to "Gerti the Bold": the host sees it, it is stored; emptied: "Player 2"; a third visitor who only pressed Enter: "Player 3"; no console errors |
| `smoke.mjs`, five pages, `--idle-humans --expect-stage 3` | passed: stage 3, humans won on the clock, zero console errors and warnings on all pages; at most 132 draw calls and 456,672 triangles |
| `shots.mjs` | passed: all three stages, both sides, zero console errors; 100 to 122 draw calls, 385,000 to 437,000 triangles |
| `scripted.mjs` | both sessions twice (37 of 37 the second time; the first time the human page's "the view takes the mouse" check once found a div in the way, see 14.4), the kaiju side three times more: 16 of 16 twice, and with three extra processes eating the processor 15 of 15 (the beam not attempted: rage 66 of 100 at that point, as in earlier runs) |

### 14.3 The flaky held buttons: what it was

Measured with a copy of the script that logged every input message the page sent and every
press and release, over eight kaiju runs with three extra busy processes on the four cores:

- The page kept sending its 30 inputs a second through every hold (the longest gap during a
  hold was 0.2 to 0.58 s), so in these runs neither the client's input queue nor its prediction
  shortened a held button.
- The brace failure from section 12 was the army: its screenshot shows the kaiju staggered (the
  nerve bar at its limit, every action picture greyed out). A staggered kaiju cannot act for five
  seconds; two of the molt failures here were the same (the news line "a glowing weak point").
- The other failures (an eat, and once a grab) were the reach, not the button: the script stops
  walking when the page's predicted position is within 5 m, but the server's body is still
  moving and ends 1 to 2.7 m further on, beside or past the car; the head can only turn 50
  degrees ahead of the body, so a grab given at once can miss. The server's events show the grab
  happening with nothing in reach and the hold then judged with nothing to eat.

So the test now: waits until the server shows the kaiju free (not mid-action, not staggered)
before each hold; waits until the server's kaiju has stopped and faces the car before the grab
and the eat; and gives a hold once more only when the server's own `kaijuStagger` event shows
the army staggered the kaiju during the attempt (said in the result). Everything is still
judged only by what the server sent. The server fix in 14.1 is separate: it is what a player on
a bad connection would have felt, and it was found while looking.

### 14.4 Still open

- In one of the two full `scripted.mjs` runs, the human page's check that the match view takes
  the mouse found a `div` under the middle of the screen the moment the match began; seven more
  runs of that session never repeated it. The check now asks again for up to 2 s and, if
  something is in the way, says which element it was.
- Someone who empties their name keeps being asked for one when they open an invite link.
- From earlier rounds and unchanged: district roof colors, the real tunnel and Windows scripts,
  a real controller and graphics card.

## Polish pass: fewer voice lines (14 November, the voices task)

The owner's note after the first game: "The anchor was speaking the whole time ... cut all the
fluff anchor lines. Army lines were ok but maybe reduce frequency by 2x".

- **Cause.** Every cue the simulation emitted (about 13 a minute in a bot match) gave both sides a
  line: the news anchor narrated every volley, roar, crossfire, building and unit. The rules in
  `VOICE_CUE_RULES` / `VOICE_RULES` throttle the cue, not what each side hears.
- **Change.** `VOICE_SIDE_RULES` (`shared/src/defs/voice.ts`, applied in `say`,
  `shared/src/sim/systems/voice.ts`): the news only speaks for the briefing, start, landmark
  down, molt ready, stages 2 and 3, one minute and ten seconds left, the ending and the hearing;
  the radio keeps every cue with its own longer waits and a slower chatter budget (numbers in
  DESIGN.md section 8). A cue is still emitted with the same random draw, and a side that is not
  to hear it gets an empty list, so the match plays out exactly as before (same winners and
  lengths across seeds 1 to 5 before and after). Subtitles come only from spoken lines, so they
  follow. The client no longer preloads anchor lines it will never play. No audio was added or
  removed; the unused anchor lines stay in the script and the manifest.
- **Measured** (ten bot matches, seeds 1 to 10, briefing not counted, with the tree as it stood):
  news 1,473 lines before, 124 after (12 times fewer, about 1 a minute); radio 1,484 before, 772
  after (52%). A second run later, with other teams' in-progress gameplay changes in the tree:
  1,341 to 111 and 1,353 to 710, the same ratios. In a two-page browser smoke run (short clock,
  150 s of play) the monster's page showed 10 subtitles, all big moments; the army's page 29.
- **Tests.** `shared/test/voice.test.ts`: the news stays quiet for colour cues; the radio waits
  longer than the cue; the radio budget; a silent cue still draws its number; a whole bot match
  held to under 1.6 news lines a minute and 40 to 60% radio. `client/test/matchAudio.test.ts`:
  only news lines it speaks are preloaded.
- **Still open.** The monster player no longer hears warnings such as "the army is preparing a
  volley" or "a strike is inbound"; the pictures on screen carry those. Soldier lines for the
  monster's side are for the later voice-and-art loop.

## Polish pass: the monster's combat feel (14 November, the monster-feel task)

The owner's notes after the first game, as the monster against four bot squads: "a full volley
of ~10 tanks could almost stun me but not quite", "Roar didn't seem to do anything?", and "The
beam breath was AWESOME!!! ... a little wider and even more uncontrollable?".

- **Stagger (note 2). Cause: two things.** (1) At stage 3 a unit is a troop of three tanks, and
  its nerve was normalized per squad, not per tank: each tank's shell carried 1.6 nerve against
  a stage 2 tank's 5.4. Ten tanks in a charged volley, three of them leaders firing uncharged,
  came to 38 nerve from the front (52 from the flank) against the 100 a stagger needs; at
  stages 1 and 2 ten units come to 113 to 130 and break it. (2) The two-squad rule counted every
  squad of the match, wiped out or not, so once only one squad was left it could never break the
  kaiju at all: its volleys stopped at the brink, "almost but not quite".
  **Change.** `army_troop_guns` nerve 1.6 to 4.5 (`shared/src/defs/weapons.ts`), so each tank of
  a troop is worth nearly a stage 2 tank; and `volleysCanBreak` (`sim/systems/damage.ts`) asks
  for two squads only while two are still in the fight. Measured in the simulation (titan
  standing still, facing the squads; scratch probe, then turned into tests):

  | Stage 3, one volley | Before | After |
  | --- | --- | --- |
  | Ten tanks from two squads, front (3 leaders uncharged) | 38 nerve, no stagger | 108, stagger |
  | The same from the flank | 52, no stagger | stagger |
  | Ten tanks, last squad standing | 45, and the rule forbade it | stagger |
  | One full squad (12 tanks) while four are standing | 48 | 135 nerve dealt, held at the brink: no stagger |
  | Six charged tanks from two squads | (not measured) | 63 at most, no stagger |

  Stages 1 and 2 are unchanged (ten units: stagger). Tests: `volleyRules.test.ts` ("a volley of
  about ten tanks"), `defs.test.ts` (level 3 counted per tank). The design's old "one squad's
  volley stays under 100" now holds at levels 1 and 2 only; at level 3 the two-squad rule is what
  stops one squad (DESIGN.md section 5).
- **Roar (note 3). Cause: too weak, and nearly invisible.** It dealt 60 nerve to units whose
  capacity is 100, so a fresh unit was not shaken: it kept moving and firing, and the only real
  effect, its charge wiped, shows only as a yellow diamond going out. On screen it was two flat
  rings on the ground, mostly hidden by the houses. **Change.** Roar nerve 60 to 100: every unit
  inside the radius is shaken (stops firing for 4 s, backs off, flickers). The client now draws a
  shockwave that reads from anywhere: a ground ring plus two rings in the air at a third and
  four fifths of the kaiju's height (over the rooftops), dust thrown up along the spreading
  front, a glow at the mouth, and every shaken unit jolts (dust, flash, ring) as the front
  reaches it (`client/src/render/gameRenderer.ts`, `effects.ts`). Pictures only, no text; the
  roar button's cooldown already darkens on the controls strip.
- **Beam (note 4).** Width 1.5 / 5 / 14 m to 2.2 / 7.5 / 21 m; the head turns at a quarter of the
  body's turn rate instead of 35%; and it fights the head: a shake of up to 4 degrees sideways and
  1.5 up and down, a pull of up to 6 degrees to one side and a kick of up to 4 degrees upward,
  growing over the 3 s burn (`beamShake`, `sim/beam.ts`; the simulation keeps where the player
  steers in `act.beamYaw` / `beamPitch` and adds the shake on top). It stays aimable: everything
  together strays at most 10 degrees, well inside the head's 50 degree lead, and the player
  steers against it. Damage numbers are unchanged. Tests: `kaijuActions.test.ts` (the beam
  "fights the head"; the reach and damage tests run with the shake off).
- **Balance** (`npm run sim -- --seeds 60 --every-anchor`): before, kaiju 28 of 60 (47%), mean
  10:19; after, 28 of 60 (47%), mean 10:33 (seeds 61 to 120: also 28 of 60, 10:34). Stage 3
  staggers 4.0 to 5.1 a match; units lost per match 4.1 / 3.8 / 2.5 to 3.3 / 3.1 / 1.9 (shaken
  units back off instead of dying). No retune needed. Trigger-happy squads (20 matches): they
  now break the titan 0.3 times a match and win 4 of 20 (before: never, 0 of 20); disciplined
  squads break it 5.1 times and win 32 of 60.
- **Checked.** `npm run check`; `npm run build`; `tools/playtest/shots.mjs` (stage 3, monster,
  with a new roar visit: 7 of 8 units round the juvenile shaken, pictures of the shockwave);
  `tools/playtest/scripted.mjs --only kaiju` (16 of 16 actions confirmed by the server,
  roar and beam included).
- **Still open.** Not felt by a person yet: whether the beam's pull is fun or annoying with a
  mouse, and whether shaking every unit in the roar is too strong against people (bots did not
  mind). Levers: `wobbleYaw` / `driftYaw` / `kickPitch` in `defs/kaiju/lizard.ts`, roar
  `unitNerve` (try 80: shakes only units already rattled), troop `nerve`.

## Polish pass: views, the controls card and the command wheel (14 November, the controls-view task)

The owner's notes: "When switching between first and third person the view changed, and some
angles I could only reach by using first person", "Maybe tab or enter something to pull the
controls back up??", and, as a squad, "Commo rose opened but I only ever could use weapon 1".

- **Views (note 5). Cause:** the monster's chase camera did not look where the player looked. It
  looked at a fixed point ahead of the body from a height that only tilted at 60% of the mouse's
  pitch, so it could only look from about 19 degrees down to 7 up (first person: 62 down to 62
  up); and it followed the wanted heading (up to 150 degrees off the body) while first person
  follows the head (at most 50 degrees off). **Change** (`client/src/game/controllers/kaijuController.ts`):
  one look direction (`viewYaw`, `viewPitch`: the wanted heading held to the head's 50 degree
  reach, the mouse's pitch within 62 degrees) for both cameras; the chase camera hangs behind a
  point 1.25 body heights up, back along that direction, and slides along the ground when
  looking up. While the beam drags the head or the kaiju is staggered, both cameras ride the
  head and the mouse's wish goes to the server as it is. The squad's cameras already shared one
  direction and limit (80 degrees); now tested. Tests: `client/test/cameraViews.test.ts`.
- **Controls card (note 6). Cause:** its key was shown only as a tiny card and keycap beside the
  settings gear at the top right. **Change:** Enter (and the keypad's Enter) opens it too, besides
  H; its picture and button are now the last of the action pictures at the bottom right for every
  role (keyboard or controller glyph, whichever is in use), and glow for the first 20 seconds of a
  match. The keyboard's "confirm on the map" moved from Enter to Space (the mouse click is the
  usual way). In the menus Enter and Space on a focused page button only press the button. Tab
  stays the map.
- **Command wheel (note 7). Cause: not a broken wheel but a wheel that looks like a weapon
  picker.** Every entry worked by mouse and by keys, confirmed by the server (below). The design
  has no weapon choice: the leader has the one weapon of its level on Fire, plus artillery at
  stage 3. The wheel's entries are orders to the squad's other three units, but they were drawn
  with keycaps 1 to 4, a rocket picture for fire at will and nothing saying who takes them: a
  weapon wheel, and nothing seemed to change when an entry was picked. **Change**
  (`client/src/ui/commandWheel.ts`, `hud.ts`, `styles.css`): the hub shows the three squad-mates
  as cyan circles; the two orders in force carry a cyan dot; a new order makes the
  standing-orders pictures at the bottom left pop. In headless Chromium with real pointer lock
  the mouse's movement reports are garbage (each step reported as a jump and a jump back), so
  wheel pointing under pointer lock cannot be judged there; the wheel's logic is the same code
  path with or without the lock, and is unit-tested.
- **Checked.** `npm run check`; `npm run build`; `tools/playtest/scripted.mjs --only human`
  (28 of 28 confirmed: all four wheel entries with the right button and two with Q, server-side,
  plus V keeping the look direction and H and Enter opening and closing the card in a running
  match); `--only kaiju` (19 of 19, the view toggle and both card keys included; an earlier
  run of it missed one grab, the kaiju stopping 23 m short of the car, which the rerun did not
  repeat). The view check waits until the kaiju is free and its body has stopped turning: while
  it turns, the head's 50 degree hold moves the view in both cameras alike. `scripted.mjs` now checks every wheel entry, the view
  toggle's direction, and both card keys on both sides.
- **Still open.** Not felt by a person yet: the new chase camera (closer to the classic
  over-the-shoulders view; levers `CHASE_PIVOT`, `CHASE_FLOOR` and the distance in
  `placeChase`). Movement in first person is still relative to the wanted heading, not the
  clamped head, as before. If the owner still wants weapon choice, that is a design change.

## Polish pass 2: wheel and map clicks, smoke and marking, the monster's warnings (14 November, the squad-controls task)

The owner's second set of notes, the squad side and the monster's first-person view. (The
monster's swim and travel mode is another engineer's, in its own section.)

- **Command wheel: the left button picks.** *Cause:* the wheel only took an order when its
  button was let go; a left click while it was open fired the weapon. The "hold and charge"
  picture is always drawn yellow (the volley colour) and the real highlight was a faint cyan
  ring, so it looked as if entry 4 were stuck highlighted. The mouse path under pointer lock was
  checked and works (a unit test feeds `movementX` / `movementY` through the real input manager
  and controller: the highlight moves right, left, up and down). *Change*
  (`client/src/game/controllers/humanController.ts`, `ui/commandWheel.ts`, `styles.css`): while
  the wheel is open the fire button picks the entry pointed at and closes the wheel, and fires
  nothing until it is let go; a quick tap of the wheel button leaves the wheel open to point and
  click; the number keys close it. The entry pointed at grows with a white ring and glow, the
  others fade, and the fire button's glyph sits under the hub. The pointer is a little faster.
- **Map: left click places the order.** A picker at the map's left side (move-to, and the
  artillery from stage 3, with its cooldown) chooses what a left click places; the call-in
  button picks the artillery too, and it goes back to move-to after one call. Right click still
  calls the guns at once; the confirm button places the picked order at the map cursor (on a
  controller: X then A, where X alone used to call the guns).
- **Smoke and marking for every squad** (`shared/src/sim/abilities.ts`, `SQUAD_ABILITIES` in
  `defs/rules.ts`; DESIGN.md section 5, "Smoke and marking"). Not in the owner's design doc
  before this (it gives spotting to the Air faction, Tier 2); nothing of it existed in the code.
  Smoke (G / Y): a cloud at the crosshair that blocks every sight line and hides the guns in it
  from the monster (the bot ignores them; the monster player's picture and map drop their
  markers and lasers), 14 s, every 30 s. Mark (R / RB): with the monster in sight and in the
  crosshair, every squad knows where it is and shoots straighter for 10 s, every 30 s. The
  orange triangle over the monster now shows only while it is marked or a leader has it in
  plain sight. Bots use both. Contract changes: two input buttons, snapshot version 2 (marked
  flag, two cooldowns, the clouds), `smoke` and `mark` events (ARCHITECTURE.md).
- **Monster in first person: warnings of charging guns** (`client/src/ui/threats.ts`): one
  yellow diamond per squad charging at it, over the guns or on the screen's edge with an arrow
  toward them; it grows with the charge, pulses from 60% and flashes when the volley is fired.
- **Checked.** `npm run check`; `npm run build`; new tests `shared/test/abilities.test.ts` and
  `client/test/squadControls.test.ts`; `tools/playtest/scripted.mjs` now also picks wheel
  entries with a left click (held and tapped wheel) and checks that no shot leaves, throws
  smoke, marks the monster, checks the map picker and the left-click marker, and looks for the
  monster's warnings in first person. Balance: see below.
- **Balance** (`npm run sim -- --seeds 60 --every-anchor`; before: monster 47% of 60, about
  10:30). With smoke and marking alone: 29 of 60 (48%), 9:42. With the other engineer's swim
  work also in the tree: 26 of 60 (43%), 9:51; seeds 61 to 120: 31 of 60 (52%), 9:44. After
  the kaiju bot fix below: 23 of 60 (38%), 10:05, and seeds 61 to 120: 30 of 60 (50%), 9:53;
  53 of 120 together (44%). Bots mark about 30 times and smoke about 10 to 18 times a match.
  Within the 8-point band over 120 matches, so no retune; single batches of 60 swing by about
  ten points.
- **Kaiju bot fix** (`shared/src/sim/bots/kaijuBot.ts`): a hurt kaiju bot walking to food with
  a house in the way leaned on the house for the rest of the match (found by the bot-match soak
  test, seed 103, once smoke and marks changed how matches go). It now smashes what stands in
  the way of a meal, as it already did on the way to anything else.
- **Test changes made on purpose.** Ten buttons instead of eight (`net.test.ts`,
  `gameRoom.test.ts`); the wheel test holds the button a moment before letting go in the
  middle (a quick tap now leaves it open); the random-input soak draws the same random numbers
  as before and presses smoke and mark alongside some of them (and now expects smoke); the
  voice test's seed-1 bot match now ends at stage 2, so instead of "more than 5 news lines" it
  checks that the news said every one of its cues that match reached.
- **Still open / not tried in a browser.** Pointer-lock mouse movement (headless browsers garble
  it; covered by the unit test). The map's artillery picker and left-click call at stage 3 (the
  scripted session stays at stage 1; the click rule is unit-tested). A gamepad. The new
  controls card has four more tiles and is crowded at 640 x 360. One run of the human session
  saw the Enter key fail to open the controls card once; the next full run passed it on both
  sides, so it is noted as a possible flaky check, not fixed.

## Polish pass 2: the monster swims (14 November, the swim task)

Owner's note: "all monsters should have some hide/travel mode, Grognar should be able to swim in
the river, still hittable but only a few spines/a bit of hitbox exposed. We may have to update
the map to have water at all stages. Maybe big size doesn't have travel mode."

- **Swimming** (`shared/src/sim/swim.ts`, numbers in `shared/src/defs/kaiju/lizard.ts`, rules in
  docs/DESIGN.md section 4, "Swimming"). Stages 1 and 2; the titan cannot. Automatic, so there is
  no new button to learn: in water deep enough for its body, a monster that is not acting goes
  under in 1 s; any monster button (or an action, a stagger, leaving the deep water) brings it
  up in 0.6 s and the press is then carried out. Under: only the spines show and only they can
  be hit (the hit volume is 0.14 of its height, 0.55 of its radius), it swims at 1.1 times its
  walking speed with no water slowdown, it cannot attack, grab, beam, eat, brace, roar or molt,
  and it tramples and wrecks nothing (no bar, no rage: no stalling). Squads see and spot it only
  within 0.4 of the usual distances, and at stage 2 it drops off the humans' map while it is
  under and unseen.
- **The orange marker over the monster** belongs to the smoke-and-marking engineer and was not
  touched. It already follows the server's `spotted` and `marked`, which now take swimming into
  account; the snapshot also carries `submerge` (0 to 1, the last byte of each kaiju record,
  under the snapshot version that engineer already raised to 2) for anything else that wants it.
- **The city**: the Old Moat, 20 m of water outside the beltway along the west, north and east
  edges (docs/CITY.md section 11). No street or building moved; 179 trees of the beltway's tree
  belt went, and the two city checksums changed (tests and docs updated). Checked: from every
  start, at stage 1 and stage 2, the monster can walk to swimmable water without breaking
  anything (148 to 165 m away at stage 1). The river and the bay were already wide enough.
- **Bots.** The monster bot swims away when its nerve is 70% full, or when it is seen below 40%
  health, if deep water is within 10 body radii (stage 1) or 8 (stage 2): 8 s in the water, away
  from the squads, then back to work, and not again for 30 s. Squad bots aim at what shows (the
  spines), and when they have lost a swimming monster they wait on the near bank instead of
  wading in after it.
- **Picture and sound.** The monster leans forward and sinks until only the top of its head and
  shoulders with their spines show; a splash (picture and sound) as it goes under and comes up,
  rings of foam at its bow and tail as it swims, bubbles when it lies still. In first person the
  eyes stay just above the water, with the snout and claws at the waterline. The HUD shows a
  new picture (spines over two waves, `k_swim`, water blue) while it is under, faint while it
  goes down or comes up; the controls card has a swim tile (the movement keys, an arrow, that
  picture, the stage triangles for 1 and 2) and no button. The client does not show a wind-up
  ahead of the server for a press made under water.
- **Checked.** `npm run check` and `npm run build` pass. New: `shared/test/swim.test.ts` (going
  under and coming up, speed, a press under water carried out once up, no attacks under water,
  the smaller hit volume, nothing wrecked or trampled under a low bridge, lost from the stage 2
  map, the snapshot, the water at every start, the bot swimming away) and a swim tile check in
  `client/test/controlsCard.test.ts`. `tools/playtest/shots.mjs` has three new extras
  (`--only x-kaiju-swim,x-human-swim`): the monster put in the moat at stage 1 and stage 2 goes
  under by itself, swims along it without coming up, comes up for Roar and roars; and a squad's
  view of the spines from the bank. All passed with no console errors; `smoke.mjs` (two players,
  a whole fast match) passed too.
- **Balance** (`npm run sim -- --every-anchor`, 120 matches each, the smoke-and-marking work in
  the tree both times; before both changes: monster 47% of 60, 10:33). With swimming: 53 of 120
  (44%), 9:59 (seeds 1 to 60: 22, seeds 61 to 120: 31). The same tree with swimming switched off:
  60 of 120 (50%), 10:05. An earlier pair: 57 of 120 (48%) with, 61 of 120 (51%) without. Stages
  1 and 2 come out the same; the bot monster swims about 4 s a match, at stage 2 only (at stage
  1 the moat is too far from where it wrecks). Within the noise of the harness, perhaps a few
  points against the bot monster; no retune. A first version of the bot that went for water up
  to 45 radii away won only 20%: running to the water with its back to the guns cost more than
  the swim gave back, which is why the bot now only uses water that is close.
- **Still open / not tried.** Not played by a person: whether the automatic dive feels right, or
  whether a toggle would be wanted after all. The swimming look is the existing model leaned
  forward and sunk (no new art): from close behind a hatchling shows little more than the top
  of its head. The wake is subtle. The other pictures in `docs/city/` (district close-ups,
  heat map, model) do not show the moat. `tools/playtest/scripted.mjs` (being reworked by the
  other engineer) does not swim; the swim checks with real key presses are in `shots.mjs`.

## Phase 1: the monster's new controls and moves (14 November, the monster-simulation task)

The owner's decisions after the first multiplayer playtest (`docs/ROADMAP.md`, phase 1, "The
monster"), built in the simulation and the bots. The screens, keys and animations are the next
task's (the monster client); nothing a player sees changed yet beyond what the old client
already draws.

- **One move per button** (`shared/src/net/input.ts`, `sim/systems/kaijuActions.ts`). Strike:
  swipe, or throw what is in the hand. Grab: grab what is in reach; with something in the hand,
  eat it; with nothing to pick up but something to eat in reach (a kiosk), eat that. Stomp has
  its own button (new bit `Btn.stomp`). Two move buttons (`Btn.move1`, `Btn.move2`) do the moves
  picked at the molts and nothing before. Molt is one press. No button means one thing tapped
  and another held any more; holding a button never repeats its move. The old brace, roar and
  beam bits stay defined (the client still sends them) and the simulation ignores them.
- **Molt cards** (`sim/moltCards.ts`). When the cocoon starts the monster is offered three moves:
  beam, roar, charge at the first molt; the two not taken plus brace or tail sweep (drawn with the
  match's random numbers) at the second. A pick (`PlayerInput.card`, 1 to 3) counts until the
  intermission ends; otherwise one is drawn at random. It lands at once in the first empty slot
  and stays for the match. Rage keeps building whether the beam is owned or not.
- **The five moves.** Beam and brace as before, now picked at a molt. Roar: the same roar plus a
  2.5 s stun on every unit it reaches (it cannot move or fire, loses its charge, a player's own
  unit ignores its controls, squad-mates do nothing), and the shaking only starts after the
  stun. Charge (new): 0.8 s wind-up, rooted but turning; a run of up to 3 s straight ahead at
  twice walking speed, turning at a quarter of the rate, smashing anything up to 9 / 30 / 70 m
  tall (city damage, cause 'charge') and stopped dead by anything taller; units it runs into
  take 90 damage and 40 nerve once and are thrown aside; a second press ends the run; always a
  1.2 s stumble; 12 s cooldown from the end of the stumble. Tail sweep (new): 0.35 s wind-up, the
  rear half within 3 body radii, units 60 damage and 30 nerve knocked outward, buildings a
  swipe's damage, 6 s cooldown.
- **Never alone** (`sim/systems/matchFlow.ts`). With every squad wiped out during play the
  nearest buildings collapse one after another over 2.5 s until the bar reaches the stage's mark
  (topped up if the bounds run out), then the cocoon starts by itself (it surfaces first, waits
  out a stagger, drops what it holds). At stage 3 the bar fills and the monster wins.
- **A hit volume that follows the body** (`sim/kaijuBody.ts`). The body's upright capsule, a
  head-and-neck capsule along where the head looks, and two tail capsules sloping down behind,
  measured on the three lizard models (numbers in `defs/kaiju/lizard.ts`, `hit`). Shells, blasts
  and aim rays all use it; the facing multiplier is unchanged. Swimming keeps the spine volume;
  the cocoon is the body only.
- **The monster bot** presses one button per move, molts with one press, looks at the cards for
  1 to 3 s and picks by weights (beam 4, roar 3, charge 3, tail sweep 2, brace 1.5), roars at
  charging guns close by and then goes for the units the roar froze, charges at a unit within a
  run's reach or through a row of buildings it can smash on the way to its goal, sweeps its tail
  when what is behind pays better than a swipe or stomp in front, braces and beams as before
  when it owns those. In six whole bot matches with the charge and the tail sweep given to it
  from the start (a scratch probe) it charged up to 3 times a stage (never as a titan: squads
  stand off farther than a run), and swept its tail 2 to 5 times a stage.
- **Contracts** (ARCHITECTURE.md sections 3 and 4): button bits 10 to 12, `PlayerInput.card`;
  `PROTOCOL_VERSION` 2 and `SNAPSHOT_VERSION` 3 (bumped once for both phase 1 simulation tasks);
  kaiju record `moves` and `offer`, cooldowns for 'charge' and 'tailSweep'; unit record
  `stunned` and `stun`; events `moltOffer`, `moltPick`, `unitStunned`, `cityCollapse`; ids
  `KAIJU_MOVE_IDS`, verbs 'charge' and 'tailSweep', phases 'charge' and 'stumble', damage kinds
  'charge', 'tailSweep', 'collapse'. The `kaijuAction` event lost its `elapsed` field (it was
  only for a swipe turning into a stomp). Action definitions lost `gesture` and `holdTime`;
  they say `button` ('strike', 'grab', 'stomp', 'molt', or 'slot' for a move) and `whileHeld`.
- **Where the roar stun is guarded** (each line commented "roar stun"; keep them through any
  rewrite): `sim/systems/inputs.ts` (a stunned driven unit ignores its player),
  `sim/movement.ts` `unitMoveParams` (a stunned unit does not move; client prediction gets it
  from the snapshot's `stun`), `sim/systems/weapons.ts` `ready` (no firing),
  `sim/systems/unitOrders.ts` `orderSubUnit` (a stunned squad-mate does nothing, no charge),
  `sim/systems/damage.ts` (the stun counts down before the shaking does).
- **Tests.** Rewritten for the new controls: `kaijuActions.test.ts` (one press per move, the
  stomp's own button, grab and eat, brace, roar and its stun, beam, charge, tail sweep, the
  molt), `molt.test.ts` (one press; the card flow with the random draw; never alone at stages 1
  and 3), `projectiles.test.ts` (a shot at the tail and at the head hits, and misses once the
  body has turned), `prediction.test.ts` (a client predicts the charge's run), `bots.test.ts`
  (legal inputs with cards, picks at both molts, roar then pounce, charge and sweep),
  `swim.test.ts`, `scenario.test.ts`, `damage.test.ts`, `spotting.test.ts`, `defs.test.ts`,
  `net.test.ts` (my fields), `soak.test.ts` (presses the new buttons with moves in the slots),
  `matchSoak.test.ts` (wants the card events). Deleted as obsolete: the tap-versus-hold tests
  (a held Strike becoming a Stomp, a held Grab becoming Eat, the 1 s molt hold) and, in
  `server/test/gameRoom.test.ts`, the two stall tests about a held Strike becoming a Stomp; the
  brace stall test now holds the brace's move button.
- **Measured** (`npm run sim -- --seeds 10 --every-anchor`, twice, with the army builder's work
  changing in the tree at the same time): every match finished without an error. First run:
  monster 4 wins in 10, mean 8:38, stages of about 1:58 / 2:46 / 4:41 when completed. Last
  run: monster 6 wins in 10 (the humans 3 by a kill, 1 by the clock), mean 8:44, stages of
  1:57 / 2:36 / 4:07, staggers 2.0 / 3.1 / 6.5 a match; it reached stage 3 in all ten. In a
  real neighborhood with every squad wiped out at the start of stage 1, 31 buildings fell in
  2.5 s and the cocoon closed at once after. Balance is the next round's job; nothing looks
  broken.
- **Still open.** The client: keys for Stomp and the two move buttons, the card pictures and the
  pick, the slots with their cooldowns on the heads-up display (HUD), rage shown only when the
  beam is owned, the charge and tail sweep animations, the stun on units, prediction through a
  charge (`kaijuMoveInput`), the controls card and `docs/PLAYING.md`. The server's input queue
  still treats Strike, Grab and Molt as buttons whose holding time matters; with one move per
  button only the brace (a held move button) does. Not felt by a person yet: whether the
  charge's slow turn and stumble feel good, and whether a 2.5 s stun is too strong against
  people. Levers: `charge`, `tailSweep`, `roar.stunTime` in `defs/kaiju/lizard.ts`,
  `BOT_RULES.kaiju.chargeReach`, `chargeWorth`, `cardWeights`.

## Phase 1: the on-foot stutter, and third person by default (14 November, the stutter-fix task)

**What was wrong.** The server plays the match in 30 steps a second and plays one input (a
player's keys and mouse) per step. When an input arrived a few milliseconds after its step, the
server played that step by repeating the previous input, and then played the late input on the
next step as well: the body took one step too many and the server fell one more input behind.
After a few of those, more than five inputs were waiting and the server threw four of them away
at once to catch up. The player's own screen had already moved the body for those four, so it
pulled the body back by four steps (0.9 m on foot, 2 m in a tank) over a tenth of a second: the
pause "every few steps". Late inputs need no bad network: the host's browser and the server on
one busy computer, through the container's port forwarder, are enough.

**What changed.**
- The server's input queue (`server/src/room/inputQueue.ts`, `match.ts`, `gameRoom.ts`;
  `ARCHITECTURE.md` section 4.3). Every input gets exactly one step. A step played on a guess
  stands in for the late input, which is dropped when it comes (or, if it carries a press or a
  release, played next and a later input with nothing new dropped instead), so no extra step
  and no growing delay. Each snapshot's acknowledgement now carries two numbers: the inputs
  played and how many the server will drop. The match plays each input one step after it was
  due (built during the briefing, free), so a slightly late input is still in time. Waiting
  inputs that pile up are trimmed only while the body stands still, where nobody can see it.
  Taps, holds and one-shot picks (the molt `card`, the old `wheel` and `marker`) keep their
  guarantees. The buttons whose holding time matters are now the volley and the monster's two
  move buttons (a held brace), as the monster-simulation section above asked.
- The client's prediction (`client/src/net/prediction.ts`, `matchSession.ts`): it leaves out
  the inputs the server will drop, does not predict an input whose step the server already
  played while the page was frozen (and draws that step as an even slide, not a jump and a
  stop), and judges a press as played by the first number. It also drives a monster in its
  charge's run the way the server does (`kaijuMoveInput`), one of the open items above.
- `MB_JITTER` (`server/src/config.ts`, `server/src/net/server.ts`): with `MB_LATENCY`, every
  message is held back a random extra amount each way, still in order, to test an uneven link.
- Third person is the default view for both sides (`client/src/app/params.ts`; `?cam=fp`
  starts in first person, V still switches); `DESIGN.md` sections 4 and 5 and `PLAYING.md` say so.
- Tests: `server/test/inputQueue.test.ts` rewritten for the new queue; in
  `server/test/gameRoom.test.ts` two regression tests on a link that delivers inputs late (the
  first fails on the old queue: the body gains a step the client never counts), and the
  acknowledgement checks read the played number (`ackOf`); `client/test/net.test.ts` gains four
  (no correction when the server's guesses stand in, no double step after a frozen page, the
  even slide, the charge; the first three fail on the old predictor); `client/test/params.test.ts`
  checks the default view; `server/test/latency.test.ts` now also runs with jitter. The server
  test helpers send `PROTOCOL_VERSION` instead of a fixed 1 (it was bumped to 2 this round).

**Measured** with a rig that runs the real server room and the real client session together in
simulated time (`/tmp/mb-scratch/stutter/rig.ts`): pages at 60 frames a second with 3% missed
frames and a 50 to 120 ms freeze every 4 s, the server's timer 0.1 to 1.5 ms late with a 5 to
40 ms hiccup on 5% of steps; links: same machine (0.3 ms), container hop (1 ± 1 ms, spikes of 5
to 30 ms on 3% of messages), tunnel (40 ± 20 ms each way, spikes of 20 to 60 ms on 1%), bad (60
± 30 ms, spikes of 40 to 150 ms on 3%). Three runs of two minutes per row, walking and turning,
with taps, holds and picks. "Wrong" corrections are those over 15 cm that are not just a frozen
page catching up; "stops" are frames where the drawn body moved less than a third of its speed.

| Per minute, before → after | wrong corrections | largest (m) | stops | inputs waiting |
| --- | --- | --- | --- | --- |
| On foot, same machine / container / tunnel / bad | 5.8 / 8.3 / 12.3 / 74 → 0 / 0 / 0 / 0 | 0.87 → 0 | 3.2 / 4.0 / 3.5 / 25 → 0 everywhere | 2.1 to 2.6 → 0.9 to 1.6 |
| Tank, same four | 5.8 / 9.7 / 14.5 / 108 → 0 / 0 / 0 / 2 | 2.0 → 0.28 | 3.3 / 3.5 / 3.8 / 31 → 0 everywhere | 2.0 to 2.6 → 0.9 to 1.6 |
| Monster walking, same four | 6.3 / 7.5 / 16.5 / 99 → 0 / 0 / 0 / 0.2 | 1.13 → 0.19 | 3.0 / 4.5 / 6.5 / 36 → 0 everywhere | |

No press or pick was lost before or after. Holds that came out longer: 3 to 39 in about 210 per
row before, 0 to 10 after (late releases, see known risks). In a real headless browser (the
built game, the real server, 30 s of walking with W held and mouse turns; this machine draws only
8 to 11 frames a second with freezes of up to 2 s), pull-backs over 15 cm went from 44 / 95 / 78
to 0 / 9 / 8 with no delay / 60 ± 30 ms / 100 ± 60 ms simulated (`MB_LATENCY`, `MB_JITTER`).

**Still open.**
- The monster while attacking: the client replays its inputs at the speed of the newest
  snapshot's action, so when an attack begins or ends between that snapshot and the present it
  is a few steps off. With an attack about every second (the old controls) that was 5 to 120
  corrections a minute after, against 48 to 165 before. The mend: replay the action's own
  timeline step by step (`kaijuState` in `matchSession.ts`). A charge that hits a tower stops
  dead on the server and not in the prediction.
- `updateHint` in `client/src/net/matchSession.ts` still knows only the old monster buttons
  (block, special, roar); the monster client work should give it the new ones.
- `tools/playtest/shots.mjs` takes its "first-person" pictures with the default view: it needs
  `cam: 'fp'` in its page address. `docs/requirements.md` (the owner's own document) still says
  first person by default; `docs/ROADMAP.md` supersedes it.
- The monster's chase camera is placed from the body as drawn before the frame's input steps
  (`KaijuController.update`), so it trails the body by one frame: steady, not a stutter.
- The one-step cushion adds 33 ms between a press and the server playing it (before, about 2.5
  inputs waited, about 80 ms).

## Phase 1: the army's new controls, the swarm and tank driving (14 November, the army-simulation task)

The owner's decisions after the first multiplayer playtest (`docs/ROADMAP.md`, phase 1, "The
army"), built in the simulation and the bots. The keys, the volley meter, the tank's turret on
screen, the controls card and `docs/PLAYING.md` are the next task's (the army client). Until
then the old client still compiles and plays, but its wheel, map orders, smoke, mark and
artillery pictures have nothing behind them (section 3), and nothing on it presses Volley yet.

- **Two buttons** (`shared/src/net/input.ts`). Fire (bit 6, unchanged): the leader's own weapon,
  every time it is ready, for as long as it is held. Volley (new bit 13, `Btn.volley`): held,
  it plants the squad-mates where they are (rooted, lasers on, weapons turning toward the point
  the leader's aim ray lands on) and charges them from 0 to 1 over 4.5 s
  (`COMBAT_RULES.chargeTime`); let go, every planted squad-mate with charge fires at that point,
  the leader's shot joins if its weapon is ready, and they all follow again. Ragged below 60%,
  a charged volley from 60% (the rules of what a volley is worth did not change). The leader
  is never planted and keeps moving. The 35-degree firing arc is gone. Stunned or shaken
  squad-mates neither charge nor fire. The old callIn, smoke and mark bits and the `wheel` and
  `marker` fields are still defined and do nothing.
- **The swarm** (`sim/squads.ts`: `swarmSlot`, `swarmWidth`, `trailFollow`;
  `systems/unitOrders.ts`: `followSwarm`). Two squad-mates one spacing behind the leader and out
  to either side of its track, the third two spacings straight behind, single file where the
  street is narrow, all measured back along the leader's trail. A squad-mate keeps the leader's
  pace plus what it needs to close up (up to 1.3 times its own top speed), brakes in time to
  stop at its place, and rides along once there; one more than three spacings behind drives
  the leader's own way after it (the trail now keeps the last 400 m), cutting short any loop it
  passes close to. Settled tanks turn to face where the leader faces. Squad-mates always fire at
  will (half nerve) when they have range and a line of fire, also on the move.
- **Removed:** the four wheel commands, move-to markers and map orders, hold points and the
  order budget (`queueCommand` is now a no-op; the server still accepts the `command` message
  and drops it), smoke and mark (`sim/abilities.ts` and `test/abilities.test.ts` deleted, with
  their rules, snapshot fields, events and bot use), and the artillery button. The fire
  mission itself stays: `startCallIn(world, squad, callIn, x, z)` in `systems/weapons.ts` is
  the one way in for phase 2's radio (`CallInDef.cooldown` and `resolveMarkerPoint` are kept,
  unused, for it). `voiceLines.json` is untouched.
- **Speeds** (`defs/units.ts`): 9.8 / 16.1 / 25.3 m/s at levels 1 / 2 / 3, about 1.15 times
  the kaiju's top speed at each stage; `defs.test.ts` holds every level between 1.1 and 1.2.
- **Tank driving** for the unit a person (or a bot) drives at stages 2 and 3 (`sim/movement.ts`,
  steering model 'tank', `drive` in `defs/units.ts`): `moveZ` is the throttle along the hull and
  `moveX` turns it (right is positive; on the spot when stopped), 75 degrees a second for a tank
  and 55 for a troop; speeding up at 10 m/s², braking at 16, reverse at half speed; the
  velocity always lies along the hull. The turret is the unit's `aimYaw`: it turns toward the
  input's aim at 140 degrees a second (tank) or 110 (troop); the gun's pitch follows the input
  at once; shots leave along the turret. Rocket infantry still moves relative to the view, and
  squad-mates steer themselves as before. `setTankMove` turns a wanted direction into throttle
  and turn (the squad bot uses it; the client's autopilot can). Prediction: `unitMoveParams`
  with the snapshot unit's `driven` flag picks the same steering, the snapshot's unit `yaw` is
  now a 32-bit float, and the turret is the snapshot unit's `aimYaw`; `prediction.test.ts`
  predicts a driven tank exactly.
- **The squad bot** (`sim/bots/squadBot.ts`): no wheel. It drives to a firing position (through
  `setTankMove` when it drives a tank), stops, waits for its squad-mates to come up (all within
  4 spacings, or 6 s at most), holds Volley with the crosshair on the kaiju, and lets go at full
  charge, holding on up to 2.5 s for a neighbor that is nearly charged. It lets go early and
  drives off when the kaiju comes close, and presses Fire whenever it is not charging and has a
  line of fire.
- **Contracts** (`ARCHITECTURE.md` sections 3 and 4): `Btn.volley` (bit 13, `BUTTON_COUNT` 14);
  `PROTOCOL_VERSION` 2 and `SNAPSHOT_VERSION` 3 (one bump shared with the monster's task). The
  snapshot's squad record is now id, player, faction, level, flags and `driven`; the movement
  order, fire mode, move-to point, call-in cooldowns, smoke and mark cooldowns, the kaiju's
  `marked` flag and the smoke clouds are gone; the unit's `yaw` is a 32-bit float. The `smoke`
  and `mark` events are gone. Definitions: `MOVE_ORDERS`, `FIRE_MODES`, `SQUAD_ABILITIES` and
  `FactionLevelDef.callIns` are gone; `TankDriveDef`, `UnitTypeDef.drive` and the steering model
  'tank' are new; `SQUAD_RULES` gained `swarmSide` and `laserSlackRadii` and lost
  `formationStagger`, `arriveRadius`, `markerSkyReach`, `orderBurst` and `ordersPerSecond`. New
  helpers: `volleyMeter(units, squad)` (the squad's charge from snapshot units, for the HUD's
  meter), `volleyAim`, `volleyHeld`, `setTankMove`, `startCallIn`.
- **Tests.** Rewritten or added: `squads.test.ts` (the swarm: places, single file, keeping up at
  every stage from a formed swarm, braking, the trail after a loop, catching up; the volley
  button: planting, charging, aim, letting go, stunned and shaken units; the meter),
  `weapons.test.ts` (volleys through the button, the leader's shot, the driven tank's gun),
  `movement.test.ts` and `prediction.test.ts` (tank driving, and its prediction), `callins.test.ts`
  (`startCallIn`, `resolveMarkerPoint`), `defs.test.ts` (the speed rule, the drive numbers),
  `world.test.ts` (the old buttons, wheel, markers and commands change nothing), `bots.test.ts`
  (the squad bot's volleys and legal inputs), `volleyRules.test.ts`, `volleyScenario.test.ts`,
  `nav.test.ts`, `lives.test.ts`, `flow.test.ts`, `net.test.ts`, `soak.test.ts` (holds Volley
  for seconds at a time), `matchSoak.test.ts` (no `callin` expected, the trail bound) and
  `server/test/gameRoom.test.ts` (an old command is accepted and dropped). Deleted as obsolete:
  `abilities.test.ts` and the tests of the wheel commands, move-to markers, the order budget
  and the firing arc. `shared/scripts/navWatch.ts` (`npm run sim -- --nav`) now also reports
  how long squad-mates spend out of their swarm.
- **Measured** (`npm run sim -- --seeds 10 --every-anchor --nav`, then seeds 11 to 30 the same
  way; the monster's phase 1 work is in the same tree): every match finished without an error.
  Seeds 1 to 10: the kaiju won 4 of 10 (the humans 6, all by a kill), mean match 8:18, stages of
  2:01 / 2:30 / 4:20 when completed, staggers 2.3 / 2.9 / 8.0 a match. Seeds 11 to 30: the kaiju
  won 10 of 20, mean 8:47. Over all 30: units stuck 0.01% of their time (longest 3.1 s), nobody
  outside the bounds, squad-mates more than 6 spacings from their leader 2.2% of their time
  (3.4% before tanks braked for the leader's corners, when the same ten seeds gave the kaiju 6
  wins in 10), the longest such spell 47 s, all the long ones at stage 3: a troop of tanks that
  has fallen behind (a fresh deployment, a corner) gains on its leader at only 0.3 times the
  leader's top speed, and a bot leader does not wait for it. In the tests a squad going flat out
  keeps every squad-mate within 2.5 spacings at every stage.
- **Still open.** The army client: Volley on the right mouse button, the volley meter
  (`volleyMeter`, 0.6 marked), the turret drawn and predicted from the body's `aimYaw`, the
  wheel, map orders, smoke, mark and artillery pictures removed, the controls card and
  `docs/PLAYING.md`; the `command` message, `SquadCommand`, `COMMAND_IDS`, `queueCommand` and
  the unused button bits are to be removed end to end once the client no longer sends them.
  `tools/playtest/scripted.mjs` still checks the old wheel, smoke and mark and will fail until
  it is reworked. A troop of tanks that has fallen behind at stage 3 can take half a minute to
  catch up (see Measured); a leader that slows down, or a little more catch-up speed, would
  close that.
  Squad-mates now fire at will all the time, so more stray shots land in the city; balance is
  not tuned for the new controls (`docs/BALANCE.md` is from before them). Not felt by a person
  yet: whether 4.5 s of charge, the hull and turret rates and the swarm's spacing feel right.
  Levers: `COMBAT_RULES.chargeTime`, `TANK_DRIVE` and `TROOP_DRIVE` in `defs/units.ts`,
  `SQUAD_RULES.swarmSide`, `formationGap`, `catchUpSpeed`, `BOT_RULES.squad.gatherWait`.

## Phase 1: the army's controls on screen: two buttons, the volley meter, tank driving (14 November, the army-client task)

The client side of the army's phase 1 (`docs/ROADMAP.md`, "The army"; the rules are the
army-simulation section above). Two buttons, a big volley meter, real tank driving with two
reticles, and the old squad interface removed.

**What changed**

- **Two buttons** (`client/src/game/input/actions.ts`, `game/controllers/humanController.ts`).
  Left mouse button or the gamepad's right trigger (RT): Fire (holding it keeps firing). Right
  mouse button or the left trigger (LT): Volley, held to charge and let go to fire. Volley goes to the server as it is when each input is built (and once for a
  press too short to fall between two inputs), so letting go reaches the server in the very next
  input; Fire keeps the old latch. Gone from the client: the command wheel
  (`ui/commandWheel.ts` deleted), the number keys, smoke (G), mark (R), the artillery button (E),
  the map's order picker, its clicks and its cursor (the map is a view only), the `confirm`
  action, the HUD's standing-orders pictures, the smoke, mark and artillery pictures and their
  cooldowns, the charge bar (the meter replaces it), the "marked" status picture, the smoke
  screens in the effects, and the client's side of the `command` message (`MatchSession`'s
  `sendCommand`, its callback, the sandbox's handling of it).
- **The input contract** (`shared/src/net/input.ts`). `Btn.callIn`, `Btn.smoke` and `Btn.mark`
  are gone and their bits (7 to 9) free: `sanitizeInput` drops them, as it drops the monster's
  old bits 2 to 4 (the mask and the indexes are worked out from `Btn`, the monster-client
  task's change). `PlayerInput.wheel` and `marker` are gone, and `COMMAND_IDS` with them; the
  bots no longer clear them. The shared tests that sent them were trimmed (`net`, `world`,
  `soak`, `determinism`, `molt`, `bots`); the soak test still makes the random draws it made
  for them, so its chaos is unchanged. One line outside this task's files changed with them:
  `server/test/gameRoom.test.ts` checked a mask with every button bit in use and now checks the
  new one (0x3c63).
- **The volley meter** (`ui/volleyMeter.ts`, `styles.css`): a yellow diamond round the
  crosshair, a third of the screen's height on a small window, filling from its bottom point
  while Volley is held, with a white notch at 60%: dull amber below it, bright and pulsing past
  it, a white edge and a fast pulse at full. Letting go flashes it white and blows it outward,
  or fizzles it grey before the notch. Under it one picture per squad-mate (charging, following,
  stunned or shaken, gone). It reads the newest snapshot (not the view, a tenth of a second
  behind) and carries the charge forward between snapshots at the charge's own rate. When
  another squad's charged volley hits the kaiju (tracked from `projectileSpawn` with `volley`
  and the `projectileHit` on the kaiju), a ring round it counts the five-second window down,
  blinks for the last 1.5 s and bursts when this squad's own lands in time. The HUD's Volley
  picture lights up while the squad charges and glows past the notch.
- **Tank driving** (stages 2 and 3). A tank's stick goes to the server as it is (W and S the
  throttle, A and D the hull's turn); infantry still moves relative to the view. The chase
  camera hangs behind and above along the view (infantry 9 m back and 4.2 m up as before; a tank
  or troop 11 m plus 1.4 radii back and 4.6 m plus half a radius up), so the view's center passes
  over the tank and the hull and turret sit in the lower third, in sight. A second, cyan reticle
  (`ui/gunReticle.ts`) marks where the gun points now (the turret's aim ray from the eye, cast on
  the city and the kaiju's body as the server casts it): it slides onto the crosshair as the
  turret catches up, its ring fills as the gun reloads, its ticks turn orange on the kaiju, and
  off the screen it waits at the edge. It is placed from a new hook, `MatchRuntime.onCamera`,
  run once the frame's camera is in place, so it moves with the picture and not a frame behind.
- **The turret is predicted** (`client/src/net/prediction.ts`: `ServerBody.aimYaw`, the
  predictor's `stepAim` and `errAim`, `predictedTurret`; `matchSession.ts` draws the local tank's
  turret from it instead of the view): restarted from the snapshot's turret and replayed with
  the pending inputs through `stepMovement`, drawn between ticks and with its corrections
  faded like the hull's.
- **Third person** (the default now): the chase camera keeps out of tree crowns and billboards
  as it keeps out of walls (`clearOfProps`; from inside a crown the view was half leaves); a
  unit's marker fades out within about 30 m of the camera (squad-mates riding by a third-person
  camera filled the screen with their circles and diamonds); a soldier within 3.5 m of the camera
  is not drawn. Lasers end on the kaiju's real hit volume (`resolveAimPoint` with the kaijus), as
  does the crosshair's aim.
- **The controls card's squad side** (`ui/controlsCard.ts`): moving on foot (stage 1), looking,
  Fire, Volley (the right button with a hold ring, the squad-mates charging, the meter past its
  notch, the volley going off), letting go early (the meter short of its notch, a dim volley), W
  over S driving and A beside D turning a tank and the mouse swinging its turret (stages 2 and 3;
  a new card part draws one axis of the keys or of the stick), the map, the camera, the drone,
  settings and the card. New placeholder pictures `sq_*` (`ui/iconArt.ts`, listed in
  `docs/ASSETS.md` section 5; art wanted).
- **Autoplay** (`game/autoplay.ts`, `volleyPlan`): parked with a line of fire it holds Volley,
  lets go at full charge (waiting up to 2.5 s for a neighbor that is nearly charged), holds it
  again; it fires its own gun whenever it is not charging, and drives a tank by throttle and hull
  turn (`setTankMove`).
- **Playtests** (`tools/playtest/`): `scripted.mjs`'s squad session reworked (fire; the volley
  held, charged to full and let go; an early let go; the old keys doing nothing; the map as a view
  only; the countdown ring when another squad's volley lands) and a new tank session at stage 2 in
  the sandbox (A and D turn on the spot, W drives along the hull not the view, the turret trails
  the view and the gun's reticle shows it, a shot fired mid-swing leaves along the turret);
  `--only human` runs both, `--only tank` the tank session alone. `shots.mjs` extras
  `x-human-volley` (the meter below the notch, past
  it, full, the flash, the fizzle, the countdown) and `x-human-tank` (third person, the turret
  lagging, the two reticles apart, driving, turning, first person, the troop at stage 3).
  `driver.mjs`'s probe reports the meter, the gun reticle and the turret. Made to hold on a busy
  machine: no pictures while the volley is held (a picture can hold the page still for over a
  second, and the server then lets go of the button for it), the controls card checks wait up
  to 3 s for the page's next frame (a change to the shared `cardChecks`, which the monster's
  session uses too), and the tank's shot is clicked straight after the turn (the view is read
  afterwards).
- **Tests**: `client/test/squadControls.test.ts` rewritten (the two buttons through the real
  input path with the pointer captured, a quick right click, the old keys sending nothing, the
  stick on foot and in a tank, the gun along the turret, the predicted turret against the
  simulation's, the meter's charge and pictures, the five-second window, the kaiju's warnings);
  the wheel tests removed from `cameraViews.test.ts`; `controlsCard.test.ts`, `view.test.ts`,
  `city.test.ts` (the autopilot's `volleyPlan`) and `session.test.ts` updated.
- **Docs**: `DESIGN.md` section 8 (the squad rows of the controls table, what a squad player
  can do, the volley meter, tank driving on screen, the card), `PLAYING.md` (the squad's
  controls, the volley, two squads at once, driving a tank, the pictures, the tips),
  `ARCHITECTURE.md` sections 2, 4.2 and 5, `ASSETS.md` section 5, and the playtest rows of
  section 1 above.
- **Pictures for the owner** (`docs/progress/`): `squad-volley-meter.png` (the volley charging
  past its notch, the three lasers meeting at the crosshair), `squad-tank-reticles.png` (a tank
  from behind, the turret still swinging: the white crosshair where the player looks, the cyan
  sight where the gun points) and `controls-squad.png` (the squad's controls card, redrawn).

**Measured** (on a machine shared with two other builders and a voice job: load average 6 to 15
on 4 cores, so the headless pages drew 2 to 14 frames a second and the server and the sandbox
sometimes ran well under real time)

- `scripted.mjs --only human`, final run. The squad session against the real server: 24 of 24
  checks confirmed. A room created, the practice option on and off, a guest joining by the
  invite address, the start; W drove 6.9 m; the left button fired a rocket; holding the right
  button planted all three squad-mates with their lasers on and brought the meter up with three
  charging pictures; the squad charged to full (1.00 each) and the meter lit past its notch and
  showed full; letting go fired a charged volley (3 squad-mates, charge 1.00, 12 shells marked
  as volley, the leader's among them) and the meter flashed; letting go early at 0.09 fired 9
  ragged shots and no charged volley, and the meter fizzled; the old keys (Q, 1 to 4, G, R, E)
  sent nothing; behind the map the unit idled and a click on the map did nothing; V kept the
  look direction; H and Enter opened and closed the controls card; the match ended (humans won
  by the clock after 150 s); the meter showed its countdown ring while 174 shells of other
  squads' charged volleys hit the kaiju. The tank session (stage 2 in the sandbox; run again on
  its own after its last check was fixed): 9 of 9. A tank driven like one; A turned the hull 55
  degrees on the spot (0.0 m moved) and D 48 degrees back; W drove 8.2 m along the hull, 63
  degrees off the view; the turret trailed a 126-degree turn of the view by up to 47 degrees and
  came round onto it; the gun reticle stood up to 15% of the screen's width off the crosshair
  meanwhile and came back onto it; a shell fired straight after a turn left 65 degrees off the
  view, along the turret still swinging round; H and Enter.
- Earlier runs failed on timing, and the playtest now waits those out: the meter was looked at
  once, 0.4 s after the press; a full charge was waited for while pictures were taken during the
  hold (a picture can hold the page still for over a second, past the server's limit for a
  silent player; no pictures are taken during a hold now); the meter's flash was looked for only
  0.3 s after the volley; the controls card was read 0.4 s after its key; the tank's 8 m drive
  was given 6 s; the tank's shot went off after the turret had come round. Every one of them
  passed in the reruns above.
- `shots.mjs --only x-human-volley,x-human-tank`: no console errors; the meter below its notch,
  past it, full, flashing and fizzling, the countdown ring (another squad's volley landed within
  90 s); the gun reticle out at the screen's edge while the view swung at 200 degrees a second
  and back on the crosshair once it stopped; with the turret held 25 degrees off the view, the
  two reticles apart (`docs/progress/squad-tank-reticles.png`). Seen while looking at the
  pictures: a tank driving at a house has the cyan sight on the house (the gun, lower than the
  camera, would hit it) and the crosshair on the kaiju beyond it, as intended.
- The squad autopilot in the sandbox, 75 s each: stage 1, 4 charged volleys, 27 shots of its own,
  78 by its squad-mates at will, charge reaching full, 333 m driven; stage 2 (a tank driven by
  throttle and turn), 2 charged volleys, 2 shots of its own (a tank's gun reloads slowly, and
  the autopilot holds it while its squad charges) and 23 by its squad-mates, 625 m. No console
  errors.

**Still open**

- For the integrator: nothing in the client sends the `command` message any more. The server
  still accepts and drops it (`server/src/room/gameRoom.ts`, `queueSlotCommand` in
  `server/src/room/match.ts`); with it can go `SquadCommand` and `sanitizeCommand`
  (`shared/src/sim/commands.ts`), `queueCommand` (`shared/src/sim/worldOps.ts`), the message in
  `shared/src/net/protocol.ts`, `GroundMarker` and `sanitizeMarker` (`shared/src/net/input.ts`,
  used only by the commands now) and their tests. The header of
  `server/src/room/inputQueue.ts` still names "the old wheel pick and its marker" among the
  one-shot fields (the code names no field, so nothing breaks).
- `ActionState.pointerY` (`client/src/game/input/actions.ts`, set in `inputManager.ts`) was
  there for the command wheel's pointer; nothing reads it now unless the molt card picker takes
  it up.
- The squad's new card and HUD pictures (`sq_*`) are placeholders drawn in code; art is wanted
  (`docs/ASSETS.md` section 5).
- The sandbox's input queue (`client/src/net/localLink.ts`, the monster-client task's change)
  folds the buttons of inputs it drops into the one it keeps, so in a backed-up sandbox a
  volley's release can come one input late. The real server's queue is not affected.
- Not felt by a person yet: the meter's size and brightness, the chase cameras' distances, the
  gun reticle, holding the right button for a volley. Levers: `--vm` in
  `client/src/styles.css`, `chaseOffset` in `humanController.ts`, `MARKER_HIDE_NEAR` and
  `SPRITE_HIDE_NEAR` in `unitsView.ts`.
- Mouse look and the mouse buttons under real pointer lock are covered only by the unit tests
  (the fake browser); the headless playtests run without pointer lock (driver.mjs).
- A browser that freezes for more than a second while the player holds Volley has the volley
  let go by the server (`STARVED_BUTTON_TICKS`, `server/src/room/match.ts`): the squad fires
  what it had, and the meter flashes when the server's volley arrives. That is the server's
  rule for a silent player, kept as it is; the playtest's pictures caused it on this machine.

## Phase 3, started early: natural-sounding radio and news voices (14 November, the natural-voices task)

The roadmap's "natural-sounding radio and news voices". All 221 voice lines are now spoken by
neural voices (speech models trained on recordings of real people) instead of the rule-based
synthesizers of the first cast. The game is unchanged: same line ids, file names, `.ogg` and
`.mp3`, loudness target (-16 LUFS) and manifest shape; it still runs fully offline and plays
finished files. Full write-up, with every table: `docs/audio/VOICE.md` (generated by the build).

**What changed**

- **The cast** (`tools/audio/voice/cast.json`). Overlord: Kokoro `am_onyx`, the deepest voice,
  at 92% speed. Granite: Kokoro `am_echo`. Beacon: Kokoro `af_sky`. Tempest: Piper
  `en_GB-alba-medium`, a Scottish woman's voice (Tempest was a Scottish man; the only natural
  voice with a Scottish accent is a woman's, and the script never says which Tempest is). Anchor:
  Kokoro `af_heart`, the model's best-rated voice, at 85% speed. Chair: Kokoro `bm_lewis`, a low,
  calm British man. Kokoro-82M is Apache 2.0; the Alba voice is CC BY 4.0 (credit in VOICE.md
  section 1).
- **Orders are spoken faster.** At their grave, slowed pace Overlord's and Beacon's orders for
  the nerve break and the signature attack ran past their 2.5 s window, so a character can now
  have an order speed (`"orders"` in `cast.json`; Overlord 1.05, Beacon 1.1, with shorter pauses).
- **Overlord's radio** is a little wider (to 4.5 kHz) with a stronger presence peak: the dark new
  voice lost fewer words to the recognizer that way.
- **The engines** (`tools/audio/voice/mbvoice/synth.py`): two new branches of `synthesize`,
  `kokoro` (Kokoro-82M through the `kokoro-onnx` package, with misaki, Kokoro's own pronouncing
  front end) and `piper`, both on ONNX Runtime on the processor, at most two threads in all
  (`MB_TTS_THREADS`). Both give the same samples every run (checked), so a rebuild is identical.
- **Model files are not committed.** `mbvoice/models.py` pins every file to a Hugging Face
  revision and a SHA-256 hash; the build downloads what it needs into `/opt/mbtools/models` the
  first time (about 350 MB of voice models and 690 MB of measuring models) and needs no network
  afterwards.
- **Two new measuring instruments**, because the build's recognizer, pocketsphinx, cannot judge
  natural speech: a second, modern recognizer (NVIDIA Parakeet TDT 0.6B v2, `mbvoice/asr2.py`)
  and a speaker-recognition model (WeSpeaker, `mbvoice/speakers.py`) that measures how distinct
  the four radio voices are. Both run in the build's verification and appear in VOICE.md.
- **Tools**: `audition.py neural` (every English Kokoro voice and seven Piper voices on a sample),
  neural casting rounds in `experiments.py` (whose summary now merges with the recorded results
  instead of refusing), `tryline.py --cue` for orders, `build.sh` checks the new packages,
  `tools/setup-asset-tools.sh` installs them (kokoro-onnx, piper-tts, misaki, spaCy with its
  small English model from Hugging Face, sherpa-onnx; no PyTorch). `docs/audio/voice/first_cast.json`
  keeps the first voices' numbers for comparison.

**Measured** (full build of all 221 lines on two worker processes: 10 minutes to speak and encode,
16 with verification; the machine was shared and loaded the whole time)

- The build's own checks: 0 failed. Loudness -16.15 to -15.87 LUFS, highest true peak -0.79 dBTP;
  the humans' orders 1.8 to 2.4 s (limit 2.5); briefings 9.06 s (humans) and 7.94 s (kaiju), limit
  9.2. 743 s of audio (766 before). Files: 6.37 MB of `.ogg` and 6.59 MB of `.mp3` (6.21 and 6.60
  before), same encoder settings.
- Word errors on the shipped `.ogg`, before and after. pocketsphinx: 7.5% before, 15.2% now
  (Overlord 5.0 to 21.2, Granite 9.5 to 14.3, Beacon 5.0 to 15.1, Tempest 9.5 to 38.8, Anchor 7.2 to
  6.9, Chair 19.1 to 18.1). The second recognizer: 1.1% before, 0.8% now (Overlord 2.1 to 0.2,
  Granite 4.2 to 3.0, Beacon 0 to 0, Tempest 0 to 2.5, Anchor 0.7 to 0.6, Chair 0 to 0).
  pocketsphinx was made for careful American read speech; it counts natural rhythm, words run
  together and any accent as errors, and it cannot follow the Scottish voice at all. The second
  recognizer, which hears roughly as a person does, misses fewer words than before.
- How alike the radio voices sound (voice prints of the finished radio files, 1 = the same
  voice): closest pair now Beacon and Tempest at 0.31, Overlord and Granite 0.28; in the first
  cast the closest pair was at 0.53. Each voice against itself: 0.97 to 0.99.
- The neural voices move their pitch within a line one and a half to two times as far as the
  first cast did (the measurable side of not sounding robotic).
- The encoder settings were measured again on the new voices (`encode_test.py`, all 221 lines at
  four settings of each encoder) and stay as they were: every Vorbis setting below the one in use
  now fails the peak check (quality 2 peaks at -0.27 dBTP, the limit is -0.5; quality 0 clips),
  and one step down for MP3 would leave 1.6 times as much of the anchor's spectrum empty.
- `npm run assets:manifest -- --check`: up to date. Voice tests (`shared/test/defs.test.ts`,
  `client/test/matchAudio.test.ts`, `client/test/audioEngine.test.ts`): 90 passed. `npm run
  check`: 818 tests passed (a first run had one timing failure in `shared/test/meridian.test.ts`,
  the city built in 231 ms against a 200 ms limit while the machine was loaded; it passed alone
  and in the second full run).

**Still open**

- Nobody has listened: the build machine has no speakers. What to listen for is in VOICE.md
  section 7, first of all Tempest's Scottish voice through the radio static, and the line
  `v_landmark_down_3` ("That stood for a hundred years."), whose "stood for a" the radio blurs
  for both recognizers. Granite's voice ends some lines with a strong breath, which the
  recognizers hear as an extra "s" ("ways", "parts", "works").
- If the owner wants Tempest to stay a man, a British Kokoro voice is one line in `cast.json`
  (`bm_george` or `bm_fable` at speed 0.95); he would lose the Scottish accent.
- `docs/ASSETS.md` section 1 still lists only the old speech tools on the build machine; it was
  being edited by someone else, so it was left alone. One line would cover it: "Neural speech:
  Kokoro-82M and Piper on ONNX Runtime (tools venv); models downloaded by the voice build into
  `/opt/mbtools/models`".
- pocketsphinx stays the build's recognizer for continuity, but its totals no longer say how clear
  the voices are; if the voices are ever judged by one number, it should be the second
  recognizer's.
- Two small leftovers in files whose every byte is part of the rebuild key (an edit there rebuilds
  all 221 lines, about a quarter of an hour), so they wait for the next change that rebuilds
  anyway: the comment above `OGG_QUALITY` in `tools/audio/voice/mbvoice/pipeline.py` still gives
  the first voices' reasons (VOICE.md section 6 has the current ones), and `synth.py` imports `re`
  without using it.

## Phase 1: the monster's controls on screen: the kit, the molt cards, the new moves (14 November, the monster-client task)

The client side of the monster's phase 1 (`docs/ROADMAP.md`, "The monster"; the rules are the
monster-simulation section above): one move per button, the starting kit on screen, two move buttons
that the molts fill from three cards, and the pictures for the charge, the tail sweep and the roar's
stun.

**What changed**

- **Buttons** (`client/src/game/input/actions.ts`; DESIGN.md section 8). Left mouse button or the
  gamepad's right trigger (RT): Strike (swipe; with something in the hand, throw). Right button or
  the left trigger (LT): Grab (grab; with something in the hand, eat; nothing to grab but a kiosk in
  reach, eat that). Space or the left bumper (LB): Stomp. Q or Y: the first move. E or the right
  bumper (RB): the second move. F or B: Molt, one press. 1, 2, 3 or the directional pad's (d-pad's)
  left, up and right: the molt cards. The old block, roar and special actions are gone, and so are
  their bits in `shared/src/net/input.ts` (bits 2 to 4 stay free). `BUTTON_NAMES`, `BtnIndex`,
  `BUTTON_COUNT` and `BUTTON_MASK` are now worked out from `Btn`, so a button that goes is one line
  (the army-client task then took bits 7 to 9 the same way). Nothing is held any more but the brace.
- **The controller** (`client/src/game/controllers/kaijuController.ts`): sends the new bits. A
  picked card rides on exactly one input (`pickCard`, `InputSample.card`), also outside play
  (`idleSample` in `client/src/app/matchRuntime.ts`: the intermission sends neutral inputs, and a
  pick made then must still go). The chase camera (now the first view a player sees) is placed from
  the body as it is drawn that frame, not a frame behind it, and its lens opens 12 degrees while the
  charge runs (first person too). The wind-up shown ahead of the server follows the new rules
  (`hintVerb` in `client/src/net/matchSession.ts`: molt, brace, first move, second move, stomp,
  strike, grab; an empty slot shows nothing; the roar and eating have no wind-up and show their own
  phase at once).
- **The heads-up display (HUD)** (`client/src/ui/kaijuKit.ts`, in `hud.ts`): Strike, Grab and Stomp
  with their glyphs (the throw and eat pictures while something is in the hand, Grab darkened while
  the last meal is under 10 s old); the two move slots (a faint egg in a dashed frame until a molt
  fills it; then the move's picture in a ring that fills as it comes ready, the beam's ring being
  its rage and glowing when full); the rage meter only once the beam is picked; Molt only while
  offered, pulsing. New icons `k_charge` and `k_tailsweep` (`client/public/assets/ui/`, checked by
  `tools/art/ui/preview.cjs`, listed in `docs/ASSETS.md` and `docs/art/UI_ICONS.md`). Styles in a
  new `client/src/kaiju.css`.
- **The molt cards** (`client/src/ui/moltCards.ts`, wired in `client/src/app/screens/match.ts`):
  three big cards when the cocoon starts (also after the city gave way), each the move's picture
  moving the way the move does (animated in `kaiju.css`), over its key or d-pad glyph; above them
  the move button the pick goes on; under them a bar running down to the end of the intermission.
  The pointer is let go while they wait; a plain click on a card picks it and takes the pointer back
  (no mouse movement under pointer lock is involved). The picked card flies into its slot, which
  flashes; the server's `moltPick` has the last word (a random draw, or a lost pick, is shown
  landing).
- **The controls card** (`client/src/ui/controlsCard.ts`): the kit, throwing and eating (and a kiosk
  eaten), the molt with its three cards, the two move buttons as empty slots with the stages they
  fill from, then the five moves each beside both move buttons in a slot frame (the brace with its
  hold ring, the roar then a dizzy spiral), swimming. The `STUB(client)` is gone. The card now
  shrinks to fit a small window (`fit()`: in a 960 by 540 window the monster's six rows needed 397
  pixels of the 368 there are, and the last row was cut off; from 1280 by 720 up it fits as it is).
- **Taking the pointer back** (`client/src/game/input/inputManager.ts`, outside this task's files,
  one small change): Chromium reports a jump right after the pointer is captured (the cursor put
  back where it was, 480 by 270 pixels in the headless browser), and on a busy page it came half a
  second late, past the 100 ms that were thrown away, so the view leapt up at the sky. The first
  movement after a capture is now thrown away however late it comes. The molt cards let the pointer
  go and take it back twice a match, so this mattered here. Test in `input.test.ts`.
- **Animations and effects** (`kaijuAnimator.ts`, `kaijuView.ts`, `gameRenderer.ts`): the charge's
  wind-up (head down, shoulders low, a foot pawing the ground, dust), its run (low and forward like
  a ram, arms tucked, a longer stride that pounds, a wake of dust behind and a wave of it ahead, the
  view shaking with each footfall for the monster's own player), the stumble (pitching forward, a
  knee buckling, arms thrown out, a burst of dust and a ring ahead, a camera shake nearby); the tail
  sweep (the hips coil and the tail is drawn round, then lashes across behind, dust along its arc);
  the roar's stun: three yellow stars circling over every stunned unit and a pulsing yellow ring
  under it for as long as the stun lasts, sized with distance so a titan reads them across the city;
  never alone: two rings rolling out from the monster and a heavy camera shake (`cityCollapse`), the
  buildings falling as ordinary structure collapses. The roar's shockwave and the beam are
  unchanged. The charge and the tail sweep reuse the stomp and swipe sounds
  (`client/src/audio/matchAudio.ts`, three lines).
- **The autopilot** (`client/src/game/autoplay.ts`): one button per move, one press of Molt, a card
  picked at random about a second after the cards come up, and the moves it owns used (roar near
  soldiers, beam at full rage, charge at a unit straight ahead, tail sweep at one behind, brace
  against charged volleys).
- **Tests**: `client/test/kaijuControls.test.ts` (new: the wind-up rules, the controller's bits and
  its one-shot card, the card outside play, the charge's and the tail sweep's poses, a picture for
  every move); `controlsCard.test.ts` (the kit, the slots, the cards, hold only for the brace),
  `game.test.ts`, `input.test.ts`, `session.test.ts` (the brace on its move button). Shared and
  server tests that used the old bits as plain buttons now use stomp or move1 (`world.test.ts`,
  `kaijuActions.test.ts`, `bots.test.ts`, `net.test.ts`, `server/test/inputQueue.test.ts`,
  `server/test/gameRoom.test.ts`); the "old buttons do nothing" checks went with the bits.
- **The sandbox** (`client/src/net/localLink.ts`): its input queue threw away the inputs of a page
  that fell behind, a quick tap or a molt card among them; the buttons and the card of the inputs it
  drops now ride on the one it keeps (sandbox only; a release can come one input late there).
- **Playtests** (`tools/playtest/`): `scripted.mjs`'s monster session rewritten for the new buttons
  (below); `shots.mjs` extras `x-kaiju-cards` (also: the controls card fits the window, the cards
  let the captured pointer go and a pick by key or by click takes it back, the view does not leap
  when it does), `x-kaiju-charge`, `x-kaiju-sweep`, `x-kaiju-roar` (these three as in a browser
  without pointer lock, so their pictures carry no "click to play" picture), `x-kaiju-beam` and
  `x-kaiju-collapse`; the swim extras now give the monster the roar on Q first.
- **Docs**: `DESIGN.md` section 8 (the monster rows of the controls table, the monster's card, what
  the monster player sees of its buttons), `PLAYING.md` (the monster's controls, growing and the new
  moves, never alone, the tips), `ASSETS.md`, `docs/art/UI_ICONS.md`, `ARCHITECTURE.md` section 5
  (the pointer rule: the molt cards, and the jump thrown away), the module map above, and two
  pictures in `docs/progress/` (`monster-molt-cards.png` new, `controls-kaiju.png` retaken).

**Measured** (on a machine shared with two other builders and a voice job: load average 4 to 20 on 4
cores, so the headless pages drew 2 to 17 frames a second)

- `npm run check`: types, lint (253 files) and 818 tests in 62 files pass.
- `node tools/playtest/scripted.mjs --only kaiju` (the real server with `MB_FAST=1`, real key
  presses and clicks, every check judged by what the server sent back). The last two runs, the
  second on the final build: 32 of 32 confirmed, nothing failed or left unattempted, no console
  errors. Look, walk, swipe, stomp on Space, Q and E doing nothing before a molt, grab and throw;
  the first mark (97 s left on the fast match's 150 s clock); the molt by one press of F (cocoon and
  `moltOffer`: beam, roar, charge); the three cards on screen in the server's order; card 3 (the
  charge) picked with its key (`moltPick` card 3, not drawn at random, the snapshot's first slot the
  charge); the charge on Q (wind-up, run, stumble) and Q again ending its run after 0.83 s; grab and
  eat at stage 2; the second mark, charging through the blocks (46 s left); the second molt (beam,
  roar, tail sweep; the run before had the brace); card 2 (the roar) picked with a click (`moltPick`
  card 2, not random); the roar on E stunning 3 units for 2.5 s each (12 s left; 4 units in the run
  before). Then the sandbox part: the view toggle, the controls card (H and Enter), the warnings of
  charging guns in first person, the beam (rage spent, the beam burning), the tail sweep (4 hits, 10
  units knocked away), the brace (held, then let go) and the roar (4 units stunned and drawn dazed).
- The five runs before those failed only on the script's own timing, and each was fixed in the
  script, not the game: the fast clock ran out before the last checks (the view toggle, the card and
  the warnings moved to the sandbox part; the roar now walks at the squads, which keep their
  distance from a titan, and says "not attempted" if the clock runs out first); the controls card
  was looked at too soon on a page drawing 2 to 5 frames a second (the shared check now waits up to
  3 s, the army-client task's change); a grab was given before the server's body had closed in (the
  reach is now measured on the server's snapshot); a press of F went in while the wrecking's last
  click was still on its way, so it met a swipe (the server keeps a press waiting a fifth of a
  second; the molt now waits until nothing is under way); and in the sandbox the volleys the bot
  squads let go when told to stand still staggered the kaiju in the middle of the beam (the set-up
  now clears its nerve). The throw's check now waits for the thrown wreck's own impact (it took the
  first impact of any shell before).
- `node tools/playtest/shots.mjs --only x-kaiju` (the sandbox; pictures in
  `/tmp/mb-scratch/monster-client/shots`, looked at one by one), no console errors in any of them:
  the kit with its two empty slots; the controls card, all six rows in a 960 by 540 window (355 of
  355 pixels); the pointer captured with a click and the view not turned (0.000 rad); both molts'
  cards in the simulation's order, the pointer let go while they waited, card 1 picked with the key
  1 and card 3 with a click (`moltPick` not random both times), the pointer taken back after each
  with the view not turned; the card flying into its slot and the slot flashing; the charge's
  wind-up, run, stumble and a run seen from inside the head (4 runs and 4 stumbles reached the
  page); the tail sweep's coil and lash (10 of 10 units behind it hit or knocked away; the coil is a
  third of a second and took a second sweep to catch on a page drawing a few frames a second); the
  roar's shockwave and the stars over the stunned units, from behind and from inside the head (8 of
  8 stunned); the beam; never alone (one `cityCollapse`, 28 buildings falling, the cocoon by itself,
  the cards up); swimming at stages 1 and 2, the roar on Q bringing it up. (The beam, never alone
  and swimming ran on the build before the card's fit and the pointer's jump, which do not touch
  them; the rest on the final build.)
- Nobody picks (a scratch check in the sandbox): the server drew card 1 (the beam) at random at the
  end of the intermission (`moltPick` random), the page flew the beam into the first slot and the
  slot showed it. With a wreck in the hand the kit showed the throw and the jaws, the jaws darkened
  while the last meal was under 10 s old.
- The autopilot in the sandbox (a scratch check): stage 1 swiped and stomped; at the first mark it
  pressed Molt once and picked a card itself (card 1, the beam; `moltPick` not random); at stage 2
  with soldiers near and full rage it breathed the beam, then grabbed and threw. No console errors.

**Still open**

- Not felt by a person yet: the chase camera as the first view (it now follows the drawn body
  exactly; at stages 2 and 3 the monster sits low in the frame), the cards' 18 seconds (cocoon and
  intermission) and their animations, the charge's wider lens and its shaking, the size of the daze
  stars from far off, the tail sweep seen from behind (the body hides part of the tail).
- A gamepad was not tried: the d-pad picks and the controller glyphs are covered by tests only.
- The click on a card under real pointer lock was seen in headless Chromium (the lock given back),
  not in a real browser with a person, where the browser might ask for the lock differently.
- In first person a charge through a house shows the house's walls for a moment.
- The charge, the stumble and the tail sweep reuse the stomp and swipe sounds; the stun has no sound
  of its own. New sounds would be the audio team's.
- `ActionState.pointerY` (`client/src/game/input/actions.ts`) stays unused: the card picker needs no
  pointer under pointer lock.
- `scripted.mjs --only kaiju` reaches stage 3 inside the fast match's 150 s clock only just (the
  roar came with 12 s left in the last run). On a slower machine the clock can run out first: the
  roar check then says "not attempted" (the sandbox part still checks the roar's stun).
- A real browser may report its jump after the pointer is captured differently from headless
  Chromium; the first movement after a capture is thrown away either way (a few pixels at worst).


## Phase 1 integration: both sides together, the leftovers gone, matches a fifth shorter (14 November, the integration task)

The four phase 1 builders (the monster's and the army's work, each in the simulation and on
screen) finished in two pairs, beside the stutter fix and the natural voices. This task ran it
all together, removed what the new controls left behind, cut the pace and played the game end
to end in the browser.

**Is the tree green? Yes.** `npm run check` passes: type checks, lint (252 files, one
`STUB(server)`: the Tier 2 draft pick), 815 tests in 62 files. It already passed when this task
started (818 tests): the builders had reconciled the contract files they shared. The three tests
fewer are the old squad commands' (below).

**What changed**

- **Versions.** `PROTOCOL_VERSION` is 2 and `SNAPSHOT_VERSION` 3, each bumped once this phase
  (from 1 and 2). The snapshot's header (`shared/src/net/snapshot.ts`) matches the layout byte
  for byte and now also explains the two numbers packed in the acknowledgement;
  `ARCHITECTURE.md` section 4.2 says what version 3 changed.
- **The old squad orders, gone end to end.** No client sent the `command` message any more, so
  it went: the message type (`shared/src/net/protocol.ts`), the server's handler and
  `queueSlotCommand` (`server/src/room`), `shared/src/sim/commands.ts` (`SquadCommand`,
  `sanitizeCommand`), the no-op `queueCommand`, `GroundMarker` and `sanitizeMarker`, and the
  unused city-size argument of `sanitizeInput`. A page from before that sends one is ignored
  like any unknown message. Their three tests went with them.
- **Other leftovers removed.** `ActionState.pointerY` (the command wheel's pointer); the command
  wheel's four order icons and the smoke and mark icons (the SVG files, their stand-in drawings
  in `client/src/ui/iconArt.ts`, the manifest entries, `docs/ASSETS.md` and
  `docs/art/UI_ICONS.md`, the icon preview tool's list and mock-ups, the orphaned preview sheet
  `docs/art/previews/ui_icons_commands.png`); a controls-card check that the old actions were
  absent; the wheel pick and marker in the input queue's notes. The input bits of the old
  buttons (2 to 4, 7 to 9) and the `wheel`, `marker` and `COMMAND_IDS` were already gone. The
  server's input queue still carries a dropped input's molt card to the next input it keeps (it
  carries any one-shot field without naming it).
- **Kept on purpose** for phase 2's artillery radio: the artillery mission (`startCallIn`,
  `CallInDef`), `resolveMarkerPoint` with `SQUAD_RULES.markerRange` and `markerSnapRadii`, the
  client's call-in picture and effects, and the `callin.inbound` voice lines (never cued now).
- **The roar's stun guards** (the five lines commented "roar stun": `systems/inputs.ts`,
  `movement.ts` `unitMoveParams`, `systems/weapons.ts` `ready`, `systems/unitOrders.ts`
  `orderSubUnit`, `systems/damage.ts`) are all in place, and the tests that hold them pass
  (`kaijuActions.test.ts`: a stunned unit neither moves nor fires; `squads.test.ts`,
  `weapons.test.ts`: a stunned squad-mate neither charges nor fires).
- **Pace: matches a fifth shorter** (`docs/BALANCE.md` section 9). The clock went from 12:00 to
  9:36 (`MATCH_RULES.clock` 720 to 576) and the third bar fraction from 0.31 to 0.29. The
  balance harness gained `--clock S`. Phase 1 had already made stages 1 and 2 shorter by itself
  (the squad-mates' stray fire fills the bar) and stage 3 longer (more volleys and staggers).
- **Docs.** `DESIGN.md` section 2 (the clock, the bar, the pace targets and what was measured),
  `ARCHITECTURE.md` (the command message, the harness options, the playtests in the quality
  gates), `PLAYING.md` and `README.md` (a match is about eight minutes, ten at most; a current
  picture for "What the pictures mean", `docs/progress/art-wired-squad-view.png` retaken),
  `BALANCE.md` section 9, and in this file the stub table, the module map, the known risks and
  the commands table.

**Measured** (on a machine shared with the voice builder's last job; load average up to 35 on 4
cores while five browsers ran)

- `npm run sim -- --seeds 20 --every-anchor`, seeds 1 to 20 and 21 to 40, and `--unopposed`:

  | | Stage 1 | Stage 2 | Stage 3 | Match | Kaiju wins |
  | --- | --- | --- | --- | --- | --- |
  | Before phase 1 (`BALANCE.md` section 8) | 3:15 | 3:05 | 3:50 | 10:20 | 47% of 60 |
  | Phase 1, old clock and bar (40 matches) | 2:02 | 2:27 | 4:41 | 8:30 | 17 of 40 |
  | Phase 1, 9:36 clock and `p3` 0.29 (40 matches) | 2:02 | 2:27 | 3:01 | 7:31 | 20 of 40 |
  | Aim (a fifth off section 8) | 2:35 | 2:30 | 3:05 | 8:15 | |
  | Alone, old bar (segment filled after) | 2:03 | 1:57 | 3:05 | 7:27 | |
  | Alone, `p3` 0.29 | 2:03 | 1:57 | 2:44 | 7:06 | |

  (Contested stage times are for stages the kaiju completed.)

  Every match finished without an error. The kaiju's win rate (50%) is not degenerate, so
  balance was left alone, as the owner asked. Stage 1 stays half a minute under its aim:
  raising `p1` would lengthen it (and stage 2, and the hatchling's time alone) and cost the
  kaiju a third to a half of its wins (tried: `BALANCE.md` section 9).
- `npm run build`: passes.
- `node tools/playtest/smoke.mjs` (five headless pages on the autopilot against the real
  server with `MB_FAST=1`): PASSED. The match reached stage 3 and the humans won on the clock
  after 150 s of play; no console errors on any page; snapshots of 801 to 810 bytes, about
  48.5 kbit/s down per page; the server kept 19.7 ticks a second on the overloaded machine.
- `node tools/playtest/scripted.mjs` (both sessions, real key presses and clicks, every check
  judged by what the server sent back): PASSED, 65 of 65 confirmed, nothing failed or left
  unattempted, no console errors. The monster (32): look, walk, swipe, stomp, the empty move
  buttons, grab and throw, the first mark with 111 s left on the fast clock, the molt on one F,
  the cards in the server's order, the charge picked by key and run (and ended early with Q),
  grab and eat, the second mark with 68 s left, the roar picked by a click and stunning 10 units
  with 54 s left, then the sandbox part (view, controls card, first-person warnings, beam, tail
  sweep, brace, roar). The squad (24): fire, the volley planted, charged to full (1.00) and let
  go (12 volley shells), an early let go (9 ragged shots, no charged volley), the old keys doing
  nothing, the map, the view, the card, the countdown ring, the match end. The tank (9): A and D
  on the spot, W along the hull, the turret trailing the view, the gun's reticle, a shell along
  the turret.
- `node tools/playtest/shots.mjs` (the sandbox, every stage from both sides and every extra):
  PASSED, no console errors anywhere. The volley meter below and past its notch, full, flashing
  and fizzling; the tank's gun reticle at the screen's edge while the view swung and back on the
  crosshair; the monster's cards (the controls card fits, 355 of 355 pixels; the view did not
  turn as the pointer was captured or given back; both picks landed, not at random); 4 charges
  and 4 stumbles; the tail sweep hitting 10 of 10 units behind it; the roar stunning 8 of 8;
  never alone (one `cityCollapse`, 26 buildings falling, the cocoon by itself); swimming at
  stages 1 and 2. Looked at one by one: third person is the first view on both sides, the kit
  and the slots show what the monster owns, the meter and the two reticles read as intended.
- The same extras at 1920 by 1080 pixels (for the slides): PASSED again, no console errors.

**Pictures for the slides** (`docs/progress/`, JPEG, 1920 by 1080, 280 to 390 KB each; the
owner wants a picture-dense development log after phase 3):

| File | One sentence |
| --- | --- |
| `phase1-molt-cards.jpg` | At each molt the monster picks its next move from three picture cards, here the roar, the charge or the brace. |
| `phase1-charge.jpg` | The new charge, seen from the default view behind the monster: head down, a wider lens and a wake of dust down the street. |
| `phase1-roar-stun.jpg` | The roar now freezes every tank and soldier in reach: yellow stars spin over each one. |
| `phase1-tail-sweep.jpg` | The tail sweep throws back a squad that sneaks up behind the monster. |
| `phase1-volley-meter.jpg` | A squad holds the right button: its three tanks plant, aim their lasers at the crosshair and fill the big yellow volley meter. |
| `phase1-tank-reticles.jpg` | Tanks drive like tanks now: the cyan sight shows where the turret points while it swings round to the crosshair on the monster. |

(Taken with `tools/playtest/shots.mjs` at 1920 by 1080, and for the volley and the tank with a
scratch script built from its helpers that puts the squad at the end of a straight street with
the monster at the other end; `/tmp/mb-scratch/integrate/slides/`.)

**Still open**

- Nobody has played phase 1 yet; balance waits for the owner's next playtest. Stage 1 runs half
  a minute under the pace aim (above).
- `docs/requirements.md` (the owner's own document) still says a match runs about 12 minutes and
  first person by default; `docs/ROADMAP.md` supersedes it and it was left as the owner wrote it.
- The icon preview sheets in `docs/art/previews/ui_icons*.png` are from before phase 1: they
  still show the command wheel and lack the charge and tail sweep icons. The preview tool itself
  is up to date and passes its checks (`node tools/art/ui/preview.cjs --check`: 90 of 90);
  running it without `--check` redraws them (not done here).
- The squad's new pictures (`sq_*`) and the charge's and tail sweep's sounds are still
  placeholders (the army-client and monster-client sections above).
- In third person a squad on foot fills the bottom of the screen with its own soldiers when it
  stands close together (seen in the volley pictures at stage 1).
- Everything the four phase 1 sections above list as not yet felt by a person (the charge's
  turn and stumble, the 2.5 s stun, the 4.5 s volley charge, tank turn rates, the chase cameras)
  is still untried by people.
