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
  instead of trusting memory**, especially for Colyseus, Vite and three.js. Pin exact versions.
- Colyseus is used for rooms and messaging only. Game state does **not** use Colyseus schema
  sync; it uses our own messages (below). All Colyseus use sits behind `server/src/net/` and
  `client/src/net/` wrappers so the rest of the code never imports it directly.

## 2. Layout and ownership

```
package.json              workspaces: shared, server, client; root scripts
shared/                   @mb/shared: pure TypeScript, no DOM and no Node APIs
  src/math/               vectors, angles, seeded random numbers, geometry tests
  src/defs/               all tunable data: stages, kaiju, factions, units, weapons, upgrades, voiceLines.json
  src/city/               handcrafted layout data, generator, archetypes, spatial index, road graph
  src/sim/                the authoritative simulation: World, systems/, bots/, events
  src/net/                protocol: message types, snapshot codec, input type
  test/                   vitest, including full bot-vs-bot matches
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

## 3. The simulation (`shared/src/sim`)

Pure and deterministic: `World` is created from `{ seed, config }`, advanced with
`world.step(inputsByPlayer)` at 30 Hz, and emits `SimEvent[]` each tick. No timers, no
`Math.random`, no `Date`: use the world's seeded generator and tick counter. The same code runs
on the server, in headless tests, and (movement only) in the client for prediction.

State (plain objects and typed arrays, cheap to snapshot):

- `match`: phase, stage, clock, bar points and marks, winner, per-player tallies.
- `kaijus[]`: id, controlling player, kind, stage, pos, yaw, velocity, hp, nerve, rage, action
  state machine (`idle | windup | active | recover | brace | eat | roar | special | stagger |
  cocoon | dead`, with action id and timer), held object, cooldowns, mods.
- `squads[]`: player or bot, faction, level, 4 unit ids, driven unit index, movement order, fire
  mode, call-in cooldowns, upgrades and mods, eliminated flag.
- `units[]`: id, squad, type, pos (and altitude for aircraft), yaw, aim yaw and pitch, hp,
  members, nerve, shaken timer, charge, weapon cooldown, veteran flag.
- `projectiles[]`: id, type, owner, pos, velocity, flight model (`flat | arc | thrown`), ttl.
- City state: `Float32Array` hp per structure id, bitset of live props.

Systems run in a fixed order each tick: inputs → kaiju actions → unit orders and sub-unit AI →
bots → movement and collision → weapons and volleys → projectiles → damage and nerve → city
damage and bar → molt and match flow → voice cues. Each system is one file in `systems/`,
operates on `World`, and is covered by tests.

Movement uses one shared pure function, `stepMovement(body, input, dt, cityQuery)`, for circle
bodies against oriented-box structures, so the client can predict its own unit exactly.

Everything tunable is data in `shared/src/defs/`. Kaiju kinds, unit types, weapons and upgrades
are registered definitions; systems read definitions and `mods`, never hardcode a kind. Adding a
kaiju or faction is adding definitions plus, at most, one behavior module.

## 4. Networking

- Room lifecycle: create → 4-letter room code (also in the URL hash for one-click joining) →
  lobby → match → end → lobby. Reconnect: a session token in `localStorage` reclaims the slot.
- Client → server messages (JSON): lobby actions (`setName`, `setRole`, `setFaction`, `ready`,
  `start`), `input` (30 Hz): `{ seq, moveX, moveZ, aimYaw, aimPitch, buttons, wheel?, marker? }`,
  `command`, `draftPick`, `ping`.
- Server → client: `welcome` (seed, config, your ids, full structure state as bytes), `lobby`
  (JSON on change), `snap` (binary, 15 Hz: tick, last processed input seq for you, match
  scalars, every kaiju and unit; compact fixed layout from `shared/src/net/snapshot.ts`),
  `events` (JSON array of `SimEvent` with their tick, sent with the snapshot), `pong`.
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
`structureStage`, `propsDestroyed`, `kaijuAction`, `kaijuStagger`, `kaijuHeld`, `nerveBreak`,
`crossfire`, `unitHit`, `memberLost`, `unitDestroyed`, `unitShaken`, `takeover`, `volley`,
`roar`, `callin`, `moltAvailable`, `cocoon`, `moltBlast`, `stageChange`, `barMark`, `voice`,
`matchEnd`.

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

- `npm run check` passes before any task is called done. No skipped tests.
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
