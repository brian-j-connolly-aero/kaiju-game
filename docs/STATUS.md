# Monster Battle 9001: Status

Living status file. Keep it short and true: when you finish a task, update what exists, remove
the stubs you filled in, and add any decision the docs left open. Contracts live in
`ARCHITECTURE.md`; numbers live in `DESIGN.md` and `shared/src/defs/`.

Last updated by: the game server task (everything about `server/`), simulation part 1 (the
kaiju, damage and nerve, city destruction, projectiles) and simulation part 2 (the human side:
squads, commands, sub-unit behavior, weapons, volleys, call-ins, lives, veterans, spotting),
simulation part 3 (match flow and the molt, bots, voice lines, the balance harness and the
tuning: `docs/BALANCE.md`) and
the client core task (everything in `client/`, `tools/playtest/`, `tools/build-manifest.mjs`:
section 7), and the integration task (section 8: what was run end to end, what was measured,
what is still wrong); the rest is from the scaffold task.

**Read section 8.1 first: it says whether `npm run check` passes right now.**

## 1. How to run things

| Command | What it does today |
| --- | --- |
| `npm install` | Installs the pinned toolchain and the server's dependencies (Express, the room library). |
| `npm run check` | Type checks all three workspaces, runs `scripts/lint.mjs`, runs every test. The gate. |
| `npm test` | `vitest run`: every test in `shared/test`, `server/test` and `client/test`, about 40 seconds (the server's integration tests and the whole-match simulation tests take most of it). |
| `npm run sim` | The balance harness: full bot-versus-bot matches, headless, a few hundred times real speed, one table row per match plus a summary. Options after `--`: `--seeds N` (default 5), `--seed N`, `--unopposed` (no squads), `--kaiju-handicap H`, `--human-handicap H` (0 best, 1 stands still), `--fast`, `--anchor N`, `--max-minutes N`, `--events`, `--json`. 20 matches take 25 to 50 s depending on what else the machine is doing. How to read it: `docs/BALANCE.md`. |
| `npx vitest run server/test` | Only the server tests: 62 tests, about 15 seconds (three files start a real server on a free port and connect real clients). `MB_TEST_SPEED=1 npx vitest run server/test/lifecycle.test.ts` plays the full five-client match in real time (about 3 minutes). |
| `npm run dev` | Starts the server (`tsx watch`, port 2567) and the client (Vite, port 5173) side by side with hot reload; open the Vite address. Vite forwards matchmaking and the WebSocket to the server, so the page talks to its own origin exactly as in production. |
| `npm run build`, `npm start` | Bundles the server to `server/dist/index.js`, builds the client to `client/dist`; `npm start` runs the bundle, which serves the built client and the game on one port (`PORT`, default 2567). Environment variables: `ARCHITECTURE.md` section 4.4. |
| `npm run export:defs` | Rewrites `tools/art/data/archetypes.json` from the code (`-- --check` only verifies). A test fails when the file is stale. |
| `npm run assets:manifest` | `tools/build-manifest.mjs`: merges `client/public/assets/manifest.*.json` into `manifest.json`, lists the files in `ui/`, and leaves out (and reports) entries whose files are missing. `-- --check` only says whether the file is stale. The client build runs it first. |
| `npx vitest run client/test` | Only the client tests: 20 tests, about 1 second (prediction against a real simulation through latency, the mirrored city, interpolation, the clock, the action map, the animator, the manifest tool). |
| `node tools/playtest/smoke.mjs` | The browser smoke playtest: starts the server with `MB_FAST=1` on a free port against the production build, opens 5 headless Chromium pages on autoplay (one creates a room, four join by code), plays one match to its end, fails on any console error or page crash, saves screenshots to `/tmp/mb-scratch/playtest/` and prints, per page, draw calls and triangles (peak, and peak at stage 3), bytes over the WebSocket, snapshot size, a smoothness probe, and the server's own timing from `/healthz`. About 4 minutes on this machine. Options in the file header (`--players N`, `--role human`, `--no-assets`, `--reconnect`, `--debug`, `--idle-humans`, `--expect kaiju\|humans`, `--expect-stage N`). Five software-rendered pages take the whole machine: the server then runs at about 21 ticks a second, so this run's timing and bandwidth figures describe the test rig, not the game (section 8.3). |
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
  the WebSocket. Covered by `server/test/`.
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
    limit and the HTTP side.
- **`client/` (`@mb/client`):** the playable client core: Vite + TypeScript + three.js 0.187,
  `@colyseus/sdk` 0.18.10. Screens, net layer with prediction, AssetStore with procedural
  fallbacks, renderer, controllers, HUD, audio, automation hooks. Module map, placeholders and
  decisions: section 7.
- **The balance harness:** `shared/scripts/sim.ts` (`npm run sim`) and `shared/scripts/botMatch.ts`
  (`runBotMatch`, the per-stage report, `worldHash`). The tuning history is `docs/BALANCE.md`.
- **Whole-match tests:** `shared/test/determinism.test.ts` (two matches side by side from one
  seed, hashed every tick; recorded inputs replayed) and `shared/test/matchSoak.test.ts` (three
  full-length and six fast bot matches with every invariant checked), besides `molt.test.ts`,
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
  gets shaken backs off. Bots do not get in the way: `makeTestWorld` handicaps them fully
  (`idleBots()`: they stand still, hands off the buttons) unless the test passes `bots: true`
  or its own `config.bots`. A world made with `createWorld` directly has real bots.
- **Anyone tuning the game:** `docs/BALANCE.md` first. Change numbers in `shared/src/defs/`,
  run `npm run sim -- --seeds 20` and `--unopposed`, compare summaries (not rows), and record
  what you did there. When the handcrafted city lands, rerun all of it: start with the bar
  fractions (`MATCH_RULES.bar`), which set the pace.
- **Client workers (voice, intermission, bots):**
  - Play `event.lines.humans` or `event.lines.kaiju` of a `voice` event, in order; do not pick
    lines with `pickVoiceLine` any more (`client/src/audio/matchAudio.ts` still does: it works,
    but it can choose a different line than the event names, and it ignores the "never another
    squad's voice" rule).
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
- The balance is tuned for bot against bot in the placeholder grid city (`docs/BALANCE.md`):
  kaiju wins 52% of 60 matches, stages of about 3:00 to 3:35, matches of about 10 minutes.
  It is sensitive: a bot that hesitates 30% of the time loses 10 of 10 on either side, and one
  batch of 20 seeds ranged from 35% to 60%. The handcrafted city and real players will both
  move it. Numbers nobody has tuned yet: action move multipliers, wade damage, rage per bar
  segment, prop values, archetype hp and value.
- Stage 1 runs a little short of the 200 to 230 s target (about 3:05) and is the stage where
  squads matter least (1.5 staggers on average); stage 3 is where kaiju die (14 of 17 kills).
- A bot kaiju at stage 3 is staggered about 7 times a stage. With a person in that seat it may
  feel like too much time spent stunned; `staggerNerveImmunity` and the troop gun's nerve are
  the numbers to look at.
- The bots have only played the placeholder city. The squad bot finds firing positions on road
  nodes and street midpoints and the kaiju bot steers by feel (it smashes or walks round what
  is in its way); both have stuck handling, neither has been tried in a city with dead ends,
  curved streets or a harbor.
- The kaiju grows where its cocoon was. In a street narrower than its new body it is pushed
  clear by collision on the first ticks of the next stage and tramples whatever low
  structures it overlaps (a few free points; tall ones push it out).
- `client/src/audio/matchAudio.ts` still picks voice lines itself from `variant` instead of
  playing `event.lines`: both sides hear a valid line, but not necessarily the one the
  simulation named.
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
  controllers/      kaijuController, humanController, droneController, cinematicCamera, types (shake, lens),
                    cameraClearance (holds a first-person or chase camera short of a standing wall)
  autoplay.ts       the autopilot for both sides and the drone
client/src/ui/      hud.ts, commandWheel.ts, mapView.ts, subtitles.ts, icons.ts, iconArt.ts (stand-in icons)
client/src/audio/   audioEngine.ts (effects, staged music, voice queue with ducking), matchAudio.ts (events -> sound)
client/test/        net.test.ts, game.test.ts, manifestTool.test.ts
tools/build-manifest.mjs            the assets:manifest script
tools/playtest/smoke.mjs, shots.mjs the multi-client smoke playtest; stage screenshots from the sandbox
tools/playtest/scripted.mjs, driver.mjs   two sessions played with real inputs; the hands and eyes it uses
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
  lock; building art; a Cloudflare Tunnel. (A kaiju win and the kill ending have since been
  seen in a browser, each with its end screen: section 8.2.)
- Measured: at stage 3 in the sandbox, from the titan's eye with the whole city in view, 92
  draw calls and about 195,000 triangles; the highest seen in a 5-page match was 104 draw calls
  and 390,000 triangles (an intermission's pulled-back camera draws more props). The budget is
  350 and 1.5 million. Building art will add to the triangles; props are already limited to
  those near the camera.

## 8. Integration pass (the whole thing run together)

Everything in this section was run on the production build made from the source of commit
`bbaefc5` (server bundle and client built at 22:45 on 11 November). Nothing in the committed
simulation, server or client code has changed since. Other people's uncommitted work has: the
city files (8.1) and, from 23:32, the voice script `shared/src/defs/voiceLines.json`. None of
that is in the build that was tested, and the build was deliberately not remade on top of
unfinished work. Scratch logs, screenshots and the probe scripts are in
`/tmp/mb-scratch/integration-resume/`.

### 8.1 Is the tree green? Not quite, and not because of the game

- **`npm run check` fails on the working tree as last checked (23:55 on 11 November)**, on one
  test: `shared/test/exportDefs.test.ts` ("is up to date on disk"). 18 archetypes were appended
  to `shared/src/city/archetypes.ts` for Port Meridian and `tools/art/data/archetypes.json` has
  not been regenerated. The fix is one command, `npm run export:defs`, and it is the city
  designer's to run when the list is final: the file is the hand-off to the art tools.
  Everything else passes: type check, lint (212 files), 460 of 461 tests.
- Half an hour earlier (23:31) the type check failed too, on two lines of the new
  `shared/scripts/cityMap.ts` (constructor parameter properties, which `erasableSyntaxOnly`
  forbids). Its author has since fixed that.
- The integration task changed neither file, regenerated nothing under `tools/art`, and did not
  loosen any check to get round the failure.
- **The last commit plus the integration task's own changes passes**: `git archive` of
  `bbaefc5` with `tools/playtest/smoke.mjs`, `scripted.mjs`, `driver.mjs`, `docs/STATUS.md` and
  `docs/ARCHITECTURE.md` laid over it, after a clean `npm ci`: `npm run check` exits 0, 39 test
  files, 461 tests. `npm run sim` passes.

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
plays a bot kaiju to a win when the squads are bots or idle. What stops the kaiju in the
browser runs is the client autopilot's squad, which drives to two thirds of weapon range and
fires without pause; and the client autopilot's own kaiju, which at stage 3 was staggered for
about a third of the time, walked between single targets for more than a quarter of it, and
got a quarter of the way through the last segment. Both are test tools. The fast tuning was not
changed. `--expect kaiju` with the autopilot as kaiju fails by nature; the header of
`smoke.mjs` now says so.

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
| Draw calls at stage 3 | at most 107 on five pages; 116 on a single page | under 350 | `smoke.mjs`, peak while stage 3 was on screen |
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
- **Single slow ticks are the machine, as far as could be told.** Isolated ticks of 20 to 55 ms,
  and one of 203 ms, were measured headless. The simulation is deterministic, so the same six
  matches were timed twice: none of those slow ticks was slow at the same seed and tick the
  second time, and only 3 ticks of 19,482 were over 3 ms in both passes. The largest cost that
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
- Assets: every model the art team has delivered loads (25 real, none on stand-ins); 7 of 13
  textures and 21 of 27 sprites are real; nothing failed to load. The only console warnings
  are the two for `city_atlas` and `city_atlas_emissive`, which do not exist yet.

### 8.4 Played with real inputs (`scripted.mjs`): what the server confirmed

Kaiju, against the real server: creating a room, volunteering and starting by clicking the real
buttons; mouse look; walking; swipe (tap); stomp (hold); roar; brace; grab; throw; eat;
wrecking the neighborhood to the first mark; the molt to stage 2; the beam. Human, in a
practice match: drive; fire; the four commands by number key; the command wheel by holding the
right button, dragging and releasing; sub-units planting with their lasers on and building
charge; a charged volley; the map (the unit idles while it is open: the server did not move it)
and a move-to marker placed on the map; the camera toggle.

What those passes do not show, so nobody reads more into them:

- Grab and throw were of a **car wreck** each time (the hatchling had already crushed the car).
  Grabbing a live car with real input was not exercised. The throw landed on open ground.
- Eat: the action and its cooldown were confirmed; the kaiju was at full health, so the heal
  was not seen. The beam: the action, the rage spent and the beam phase were confirmed, and
  the beam is drawn; what it burned was not checked.
- Mouse look was driven through the fallback path (a button held on the view), because the
  test switches pointer lock off. **Mouse look under pointer lock, which is what every real
  player uses, is untested.** So is any gamepad.
- One check failed on the first run and was the test's fault, not the game's: it read the
  `kaijuHeld` event without waiting, and events reach the page about 100 ms behind the
  snapshot. `shared/test/kaijuActions.test.ts` shows the event is sent. The check now waits.

### 8.5 What the pictures show that is wrong or weak

Seen in screenshots; none of these was changed by the integration task. The first three belong
to the first-person camera and hand-pose work listed for the client engineer.

- **A held object blocks the hatchling's view.** While the stage 1 kaiju holds a vehicle, the
  object fills the middle and right of the first-person view; the player cannot see what the
  throw is aimed at (`scripted-k/kaiju-05-grab.png`). The art manifest has a `hold` pose made
  for this camera; the animator does not use the manifest poses yet.
- **Bracing shows nothing in first person.** With the server reporting the brace, no arm is in
  view, although the pose is meant to cross the arms in front of the face (the roar, taken a
  moment earlier, does put the arms in view) (`scripted-k/kaiju-04-brace.png`).
- A brown slab across the top of the hatchling's view in one early frame
  (`smoke-a/04-early-kaiju.png`) is either the kaiju's own head or a roof at close range. Not
  determined.
- **The closing subtitle can be hidden on the end screen**: when the tally rows reach down to
  the subtitle band they are drawn over it, and the last voice line cannot be read. Seen at
  640 by 360 with a long kaiju tally, where the back button also covers part of the last row
  (`scripted-all/human-10-end-screen.png`); not seen at 800 by 450 with short rows
  (`kill/kill-attempt1-end-kill.png`).
- **Hit flashes wash out the kaiju's own view.** Under fire in first person, each hit draws
  a large pale square over much of the screen, with its straight edge showing
  (`kill/kill-attempt1-low-health.png`: the right third of the view is blanked). It happens
  on every hit, and there were 578 in that match. This is the explosion blending the art
  director has already listed for the client engineer.
- **Third person with a tall building close behind the kaiju**: the wall clearance brings the
  chase camera in to this side of the wall, which at stage 2 is 11 m behind a creature 32 m
  tall: the view is its back and spines, edge to edge
  (`clearance/chase-back-to-wall.png`). The camera is where the code means it to be; the view
  is unusable until the player walks clear. A chase camera that rose over the wall instead
  would be a design change; none was made.
- The kaiju player's cocoon camera circles at a fixed distance with no regard for walls: a
  building next to the cocoon hides it for part of each turn. Cosmetic. (The cocoon itself is
  drawn correctly; a first reading of one such frame as "a building drawn in place of the
  cocoon" was wrong and was checked in the sandbox.)
- **When the server stutters, the view jumps.** With the server starved to 16 to 22 ticks a
  second, the smoothness probe saw the kaiju step up to 5.8 times what its top speed allows
  between two frames, reverse direction twice, and the view's clock run backwards once. With
  the server keeping real time, one page's probe (12 frames a second, about 3 s) saw no jump,
  no reversal and no backward step. Not investigated further, and there is no measurement yet
  with a kaiju page and a human page on a healthy server, nor at 60 frames a second.

### 8.6 Left by the interrupted first attempt at this task, and their state

- The loop timing meter and `perf` in `/healthz`: reviewed, tested (`server/test/perf.test.ts`,
  and a check in `server/test/realtime.test.ts`), used for the figures above. Now documented
  in ARCHITECTURE.md section 4.4.
- `smoke.mjs` extensions (idle pages, WebSocket byte counts, stage tracking, the smoothness
  probe, expectations): reviewed and used. The help text of `--idle-humans` and `--expect`
  promised more than they deliver and was corrected.
- `driver.mjs`: reviewed and used by `scripted.mjs`.
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
