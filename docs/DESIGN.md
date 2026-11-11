# Monster Battle 9001: Design Spec (concrete rules and numbers)

This file turns `docs/requirements.md` (the owner's design doc, the source of truth for intent)
into concrete, buildable rules. Every number here is a **starting value**; all of them live as
data in `shared/src/defs/` so they can be tuned without touching logic. If this file and the
code disagree, fix whichever is wrong and keep them in sync.

## 0. Scope

**Tier 1 (build first, must be rock solid):** one kaiju (the Lizard, "Gragnor") against four Army
squads, all three stages, the molt, the full city, bots, lobby with invite codes, the no-reading
HUD, music, sound effects, voiced radio chatter, end screen, self-hosting package.

**Tier 2 (content on top of the same systems):** Crab, Burrower, Moth; Air, Super Science,
Coalition of Faiths; upgrade drafts; reporter drones with front-page photos; playable tutorial.

**Later (not in this build):** kaiju vs kaiju duel, two-kaiju matches for 6 to 8 players, hidden
objectives, human vs human. Data structures must not preclude them (kaiju are an array, damage
and nerve are one shared rule set), but nothing is built or tested for them.

Decisions on the doc's open questions: name is **Monster Battle 9001**; all three stages; browser;
multiple kaiju would share one bar (later); kaiju vs kaiju is later; Coalition mechanics as
proposed; eating and call-in limits as specified below; kaiju names: Lizard **Gragnor**, Crab
**Krabulon**, Burrower **Drillmaw**, Moth **Vespera**. The city is **Port Meridian**.

## 1. Conventions

- Units are meters and seconds. Y is up. The ground plane is y = 0.
- Heading `yaw` is in radians; forward = (sin yaw, 0, cos yaw); yaw 0 faces +Z. A three.js object
  authored facing +Z uses `rotation.y = yaw` directly.
- The city is centered on the origin and spans x, z in [-1100, 1100].
- Simulation tick: 30 Hz fixed. Snapshots to clients: 15 Hz.

## 2. Match flow

Phases: `lobby` → `briefing` (voiced, about 10 s) → `playing` (stage 1) → `intermission` →
`playing` (stage 2) → `intermission` → `playing` (stage 3) → `ended` → end screen → back to lobby.

- **Room size:** up to 5 players: 1 kaiju + up to 4 human squads. Bots fill every empty human
  slot. With 1 player, they pick a side and bots play the other (a bot kaiju exists for this and
  for automated testing).
- **Kaiju role:** players can volunteer; otherwise it rotates (never the same player twice in a
  row unless they volunteer). The host (first player in the room) starts the match.
- **Clock:** 12:00 total, counts down during `playing` (including the cocoon), pauses during
  `briefing` and `intermission`. At 0:00 the humans win.
- **Kaiju win:** the destruction bar reaches the third mark. **Human win:** kaiju health reaches 0
  at any stage (including in the cocoon), or the clock expires.
- **No rubber banding** of any kind.
- A dropped player is replaced by a bot and can rejoin their slot with the same link.

### Stages

| | 1. Hatchling | 2. Juvenile | 3. Titan |
| --- | --- | --- | --- |
| Playable bounds (square, half-size) | 180 m neighborhood | 460 m district | 1100 m whole city |
| Kaiju height / body radius | 4.5 m / 2.4 m | 32 m / 9 m | 115 m / 26 m |
| Kaiju top speed / turn rate | 8.5 m/s / 200°/s | 14 m/s / 120°/s | 22 m/s / 75°/s |
| Tramples (walks through and destroys) structures up to | 3.5 m tall (cars, kiosks, props) | 12 m tall (houses, small shops) | 70 m tall |
| Taller structures | block movement | block movement | never block: kaiju wades at 45% speed and deals contact damage |
| Human level | 1 | 2 | 3 |
| Time of day | afternoon | sunset | night |

The starting neighborhood is picked at random from the city's handcrafted neighborhood anchors.
The district bounds contain the neighborhood and lean toward downtown. Bounds are axis-aligned
squares clamped to the city, drawn as a thin glowing quarantine line; nobody can cross them.

### Destruction bar

- Every structure has `hp` and a `value` (points). Damage to it adds `value × hpLost / maxHp`
  points, whoever caused it. At 0 hp it is rubble: flat, passable, worth nothing more, and shots
  that land on it cost nothing.
- Marks are computed per match from the value actually present, so every neighborhood is fair:
  `P1 = 0.35 × V(stage 1 bounds)`, `P2 = max(1.6 × P1, 0.30 × V(stage 2 bounds))`,
  `P3 = max(1.6 × P2, 0.30 × V(whole city))`.
- Display: a skyline with three towers. Points 0..P1 map to the first 21% of its width, P1..P2 to
  21..57%, P2..P3 to 57..100% (these are the doc's 15 / 40 / 70 marks, rescaled so the third
  tower is the end of the bar).
- Tuning target: an unopposed kaiju fills a stage's segment in 100 to 130 s; a typical contested
  stage lasts about 200 to 230 s; a full match about 10 to 12 minutes.

### The molt

1. When the bar passes mark 1 (or 2), the kaiju gets a molt prompt. It chooses when and where:
   hold the Molt input for 1 s.
2. Cocoon: 10 s. The kaiju is helpless and takes damage as if staggered (see nerve). Humans get
   no marker beyond normal spotting rules; a loud heartbeat sound falls off with distance.
3. Blast wave: units within 3.5 × the new body radius are destroyed, units within 7 × are shoved
   out and shaken. Buildings are not damaged (no free bar).
4. Intermission, 20 s when drafts exist (Tier 2), 8 s otherwise: camera pulls back, bounds widen,
   time of day shifts, humans redeploy at the new edge (squads spread around the perimeter, at
   least 250 m from the kaiju).
5. Resets: kaiju health and nerve to full at the new size; every human squad returns fresh at the
   new level; eliminated players rejoin. Carries over: city damage, upgrades, veterans, rage.

## 3. One rule set: health and nerve

Every combatant (kaiju, human unit) has `hp` and `nerve`. All damage goes through one function:
`applyHit(target, { damage, nerve, fromDir, sourceId, kind })`.

**Kaiju (all stages):** hp 1000, nerve capacity 100.

- Damage multiplier by state: normal ×0.12, bracing (hits on the front 120° arc) ×0.04,
  staggered or cocooned ×1.0.
- Facing multiplier (damage and nerve): front (within 60° of facing) ×1.0, flank ×1.35, rear
  (more than 135° off) ×1.7.
- Nerve damage accumulates and leaks away at 9 per second, continuously. Crossfire: a hit whose
  direction differs by 60° or more from another unit's hit in the last 2.5 s gets ×1.75 nerve.
  Bracing: ×0.25 nerve on the front arc. Fire-at-will hits from sub-units and bots: ×0.5 nerve.
- While nerve damage is building, speed is reduced by up to 30% (this is "scattered fire only
  slows it").
- At 100 accumulated: **stagger** for 5 s (helpless, weak point glows, full damage), then nerve
  clears and the kaiju cannot take nerve damage for 6 s.
- After any freeze or trip ends (Tier 2), 6 s immunity to both.

**Human units:** hp per the tables below, nerve capacity 100, nerve leaks at 8 per second.
Roar: 60 nerve to every unit in radius and it always resets volley charge. Stomp shockwave: 40
at the center falling to 10 at the edge. A friendly unit destroyed within 40 m: 15. At 100 a unit
is **shaken** for 4 s: it cannot fire, loses its charge, and bot or sub-unit AI backs off.

**Rage (kaiju):** 0..100. Gains 1 per 12 hp of post-multiplier damage taken, and a stage-scaled
amount per bar point, tuned so a special is ready about every 60 to 80 s of active play. What the
special itself wrecks earns no rage, so one special can never pay for the next.

**Details the rules above leave open** (as built; `shared/src/sim/systems/damage.ts`):

- The facing multiplier applies in every state, staggered and cocooned included. A hit with no
  direction (a blast) counts as frontal and gets nothing from a brace.
- Crossfire is judged between hits from two different units (a hit knows its source unit). The
  later hit gets the multiplier, so once two units are firing from 60° apart every shot from
  both counts. One unit that drives around is not crossfire with itself, and call-in shells
  (no source unit) neither make nor take crossfire.
- Nerve does not build while the kaiju is staggered or cocooned. A stagger cuts whatever the
  kaiju was doing short (a beam, a meal: the heal is lost, and so is rage already spent); it
  keeps what it holds.
- A shaken unit cannot be shaken further; when it steadies its nerve starts again from 0.
- Trample needs the kaiju to be moving (at least 1 m/s) and the unit's circle to overlap its
  body circle. It deals no nerve damage.
- Units standing on a bridge deck when it collapses fall into the river: 40 damage and shaken.
- A squad that carries the insurance rider upgrade insures the first landmark that takes damage
  after its policy is free: all damage to that landmark adds nothing to the bar.

## 4. The kaiju

View: first-person from a camera anchor in the head (own snout and claws visible), third-person
toggle. The mouse or right stick sets a desired heading; the body turns toward it at the stage
turn rate; the head (camera) can lead the body by up to 50°. Movement is relative to the view.

Action timings are the tells. `r` = body radius for the stage.

| Input | Action | Timing (windup / active / recover) | Effect |
| --- | --- | --- | --- |
| Strike tap | Swipe | 0.45 / 0.15 / 0.5 s | 120° arc, reach 2.5 r. Units: 70 damage, 40 nerve. Structures: 40 / 300 / 2000 by stage. |
| Strike hold (0.35 s+) | Stomp | 0.9 / 0.1 / 0.9 s | Shockwave radius 3.6 r. Units: 100 at center to 30 at edge, knockback. Structures: 55 / 420 / 2600 with falloff. |
| Grab tap | Grab, then throw | 0.4 s grab, 0.5 s throw | Grabs the nearest car, wreck, live vehicle (stage 2+) or building chunk (stage 2+) in a 100° arc within 2.5 r. Tap again (or strike) to throw at the aim point: 25 / 45 / 70 m/s ballistic. Impact: units 120 in radius 4 / 10 / 22 m; structures 60 / 350 / 1500. |
| Grab hold (0.5 s+) | Eat | 2.0 s, rooted | Needs a held object or an edible in reach. Heals 80 hp. 10 s cooldown. The meal is consumed. |
| Block hold | Brace | while held | Rooted, turn rate ×0.3. Front-arc reductions above. |
| Roar | Roar | 1.2 s, 18 s cooldown | Radius 40 / 110 / 280 m. Unit nerve and charge reset as above. |
| Special | Lizard: beam | 0.8 s windup, 3.0 s beam | Costs 100 rage. Range 60 / 220 / 600 m, width 1.5 / 5 / 14 m, turn rate ×0.35. Units 150 per second. Structures 60 / 600 / 4000 per second; the beam stops at the first standing structure until it burns through. |
| Molt (hold 1 s) | Cocoon | 10 s | Only when a molt is available. |

Walking over units deals trample damage (40 per second inside the body radius while moving).
Dead at 0 hp. The kaiju sees the yellow targeting lasers of charging units.

**How the verbs resolve** (as built; `shared/src/sim/systems/kaijuActions.ts` and
`shared/src/sim/kaijuEffects.ts`). Per-action movement and turn multipliers are in the kind's
definition.

- Every verb is committed: nothing cancels it but a stagger or death. A press made during
  another action is remembered for 0.2 s. Bracing is exclusive (release Block to act). When
  several inputs compete the order is molt, brace, special, roar, strike, throw, eat, grab.
- Attacks are aimed along the head (the view), which leads the body by up to 50°. The effect
  lands once, at the end of the wind-up.
- **Swipe:** every unit, structure and prop touching the arc takes the full hit.
- **Stomp:** values fall off linearly from the body center to the rim (structures to 30% at the
  rim). Knockback shoves units outward by up to 1.5 r, less toward the rim; walls stop them.
- **Grab:** the nearest loose object in the arc wins (car, wreck, live vehicle); only when there
  is none does the hand tear a chunk from the nearest building (150 / 1000 structure damage at
  stages 2 / 3). A grabbed car leaves the city at once and counts for the bar. Grabbing from a
  tank troop takes one tank; the unit dies when its last tank is taken and leaves no wreck.
- **Throw:** a flat ballistic arc that lands on what the crosshair is on; beyond reach it flies
  at 45°; with the crosshair on the sky it flies where the head points. The object hits the
  first structure, unit or ground it meets (never its thrower) and damages everything inside
  the impact radius.
- **Eat:** the meal is taken at the first bite and the heal lands when the 2 s are over. Edible
  off the ground (when the grab found nothing to pick up): cars, kiosks, car wrecks, tank
  wrecks. Anything in the hand can be eaten. The cooldown counts from the first bite.
- **Roar:** the nerve hit and the charge reset land at the start of the roar.
- **Beam:** leaves the mouth along the head's aim, pitch included, so it is aimed like a
  weapon: level it burns what stands at mouth height, pointed down it ends on the ground.
  While it is on, the head only turns at the beam's reduced rate. It stops at the first
  standing structure its center or either edge touches and burns only that one; units behind
  a standing building are safe. Units within the beam's width (plus 1 m of slack above and
  below) take the unit damage and 60 nerve per second.
- **Molt:** holding Molt for 1 s starts the cocoon where the kaiju stands; it drops what it holds.

**Tier 2 kaiju (same verbs, different numbers and one special each):**

- **Krabulon (Crab):** front 150° arc takes ×0.25 damage and nerve; rear takes ×2.2. Sidesteps at
  full speed, turns slowly. Special: claw clamp that crushes a whole structure or vehicle group.
- **Drillmaw (Burrower):** can burrow (toggle, 1.5 s). Underground it is fast, invisible and
  cannot attack; humans see a seismograph ring whose error grows with distance. Surfacing erupts.
  Special: sinkhole that swallows a block.
- **Vespera (Moth):** hp 650, fast, glides over structures up to half its height. Wing gusts shove
  units out of formation and cancel charge. Special: scale dust cloud that blinds targeting.

## 5. The humans

Each human controls a **squad of 4 units**: one driven directly, three sub-units that take
orders. A unit is one simulated body with a member count (soldiers or vehicles drawn around it);
members are lost as hp drops. View: first-person from the lead member, third-person toggle.
Arcade handling: cooldowns, no ammo.

### Army (Tier 1)

Damage is normalized so a squad's full salvo is about 38 raw damage and 18 raw nerve at every level.

| | Level 1: rocket infantry | Level 2: tank platoon | Level 3: tank company |
| --- | --- | --- | --- |
| Unit | section of 10 soldiers (3 launchers) | 1 tank | troop of 3 tanks |
| Unit hp / speed / radius | 100 / 6.5 m/s / 3 m | 100 / 15 m/s / 4 m | 300 / 15 m/s / 9 m |
| Shot | up to 3 rockets (one per 3.4 members) | 1 shell | up to 3 shells (one per tank) |
| Per projectile: damage / nerve | 3.2 / 1.5 | 9.5 / 4.5 | 3.2 / 1.5 |
| Projectile speed, flight | 55 m/s, flat | 110 m/s, flat | 110 m/s, flat |
| Range / cooldown | 160 m / 2.6 s | 420 m / 3.2 s | 600 m / 3.2 s |
| Splash radius / structure damage | 3 m / 28 | 5 m / 120 | 5 m / 120 |
| Sub-unit aim error (fire at will / volley) | 3.5° / 1.2° | 2.5° / 0.9° | 2.5° / 0.9° |
| Extra | | | Artillery call-in |

**Artillery call-in (level 3):** place a ground marker (crosshair or map). After 4 s, 8 arcing
shells land over 2 s within a 28 m scatter radius: each 14 damage, 10 nerve, 14 m splash, 300
structure damage. 35 s cooldown, per player.

### Commands (radial wheel of four pictograms)

- **Follow me:** sub-units keep formation behind the leader.
- **Move to:** sub-units go to the marked ground point and hold there.
- **Fire at will:** sub-units shoot on their own when they have range and line of sight.
- **Hold fire and charge:** sub-units stop where they are, lock to their firing arc (±35°), show
  targeting lasers, and build charge from 0 to 1 over 6 s.

Movement order (follow / move to) and fire mode (at will / charge) are independent. Charging
units are rooted until they fire or get a new movement order.

**Volley:** when the player fires, every sub-unit with charge fires at the player's aim point
(where the player's aim ray lands). Damage ×(1 + charge), nerve ×(1 + 2 × charge), volley aim
error. Charge resets and starts rebuilding.

**Backstop:** projectiles are real objects. A miss keeps flying and hits whatever is behind:
structures (adds to the bar), ground, or nothing. No friendly fire between human units.

**Scatter multipliers** (aim error and artillery scatter): ×0.6 if the target is slowed,
staggered or cocooned; ×0.7 if spotted (a player-driven unit has line of sight within 150 m; the
Air faction widens this in Tier 2); ×1.0 / 0.8 / 0.6 by kaiju stage.

**Lives:** when the driven unit dies, the player takes over a surviving sub-unit. When all four
are gone the player is out until the next molt and gets a free-flying news drone camera (Tier 2:
photos for the front page).

**Veterans:** sub-units that survive a stage come back with aim error ×0.7 and a chevron mark.

**Map view:** toggles a top-down city map at any time. The game does not pause; the player's
unit idles. Shows bounds, rubble, friendly units, and the kaiju when it is known (always at
stages 2 and 3; at stage 1 only while a human unit has line of sight within 250 m, or for 3 s
after it roars, stomps or wrecks something). Move-to and call-in markers can be placed on the map.

### Bots

Human bot squads follow the same rules as players: each takes a different bearing around the
kaiju at 60 to 80% of weapon range, parks sub-units on hold-and-charge, fires the volley when
charged and in line of sight, backs off when the kaiju closes, and heads for the cocoon when one
is found. The kaiju bot roams toward the densest standing value, mixes swipes and stomps, roars
on cooldown when lasers are on it, braces against charged volleys, eats when hurt, and molts
somewhere out of sight. Bots are deliberately beatable.

### Tier 2 factions

Per `docs/requirements.md`: Air (drones, helicopters, jets: spotting, flanking, fragile),
Super Science (ray guns, beam-dish trucks, mech or orbital laser: freeze, lures, tripwires, beams
never scatter, long charge, generators explode), Coalition of Faiths (clergy and choirs,
processions with bell trucks and shrine floats, relic cone that hits friends too: unison chant
volleys, sanctuaries that shield buildings, roar resistance). Tone rule for the Coalition: the
joke is earnest teamwork and absurd firepower, never any faith. All clergy are fictional.

## 6. Upgrades and drafts (Tier 2)

At each molt every player picks 1 of 3 cards (looping animation, no text). Upgrades change rules
via a modifier table on the kaiju or squad (`mods`), read by the systems; they show on the model.
Pool: about 6 general, 3 per kaiju, 3 per faction, including the doc's examples (magnetic hide,
tail club, stubby wings, acid spit, tow cables, inflatable decoy, insurance rider).

## 7. The city: Port Meridian

One handcrafted layout (data) filled in by deterministic procedural generation (fixed seed), so
server and every client build the identical city from code. No building list goes over the wire.

- 2200 × 2200 m. A river with at least 4 bridges, a bay or harbor edge, parks, plazas.
- Districts with distinct silhouettes: downtown towers, old town, harbor and docks, industrial,
  suburbs, university and science park, boardwalk and stadium, temple hill.
- At least 12 named landmarks (tallest tower, city hall dome, cathedral, stadium, ferris wheel,
  observatory, lighthouse, power plant, and so on). Landmarks are worth more and trigger chatter.
- At least 8 neighborhood anchors in low-rise areas for stage 1 (cars, kiosks, houses in reach).
- Roughly 2500 to 3200 structures and 4000 to 6000 small props (cars, kiosks, trees, lamps).
- Structures collide as oriented boxes; props never block (vehicles and kaiju crush them).
- The river is shallow: ground units wade at 50% speed; bridges are fast crossings and are
  destructible. Parks and water are open ground where misses cost nothing.
- Civilians are client-only fleeing sprites with no effect on play.

## 8. Presentation rules

- **No reading to play.** On-screen text is only names (kaiju, faction, callsigns, the room code)
  and subtitles. Everything else is icons, bars, button glyphs and pictures.
- Color language, each doubled by a shape: humans cyan (circles), kaiju orange (triangles),
  charging volleys yellow (diamonds), rubble grey.
- The match clock is a sun-and-moon arc: the time of day is the timer.
- Voice: deadly serious English radio chatter with subtitles. Humans hear military radio; the
  kaiju player hears a deadpan live news broadcast about its own rampage.
- End screen: mock hearing (voiced), pictogram tally of what each player flattened, newspaper
  front page with a photo over squiggle text.

### Voice cues (contract between the simulation and the audio)

The simulation emits cue ids; `shared/src/defs/voiceLines.json` maps each cue to one or more
voiced lines with an audience (`humans`, `kaiju`, `all`).

`match.briefing`, `match.start`, `kaiju.spotted`, `kaiju.lost`, `volley.ready`, `volley.fired`,
`crossfire`, `nerve.break`, `stagger.end`, `kaiju.brace`, `kaiju.roar`, `kaiju.special`,
`building.down`, `landmark.down`, `collateral.human`, `unit.lost`, `squad.wiped`,
`player.takeover`, `molt.available`, `cocoon.start`, `molt.blast`, `stage.2`, `stage.3`,
`callin.inbound`, `clock.3min`, `clock.1min`, `clock.10s`, `kaiju.lowhp`, `bar.near`,
`end.humans.kill`, `end.humans.clock`, `end.kaiju`, `hearing.humans.win`, `hearing.kaiju.win`.
