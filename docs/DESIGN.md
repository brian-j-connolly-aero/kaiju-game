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
- **Clock:** 9:36 total (12:00 until the first multiplayer playtest; the owner asked for
  matches about a fifth shorter), counts down during `playing` (including the cocoon), pauses
  during `briefing` and `intermission`. At 0:00 the humans win.
- **Kaiju win:** the destruction bar reaches the third mark. **Human win:** kaiju health reaches 0
  at any stage (including in the cocoon), or the clock expires.
- **No rubber banding** of any kind.
- A dropped player is replaced by a bot and can rejoin their slot with the same link, the
  kaiju player included, for as long as the match runs and a bot still plays that slot. Their
  seat in the room is kept for them alone for 45 s; after that a newcomer may take the seat.
- The host can start when everybody else in the room is ready, or has had 20 s in the lobby to
  get ready. Somebody the host starts without still leads a squad, but is never the kaiju.

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
  `P1 = 0.18 × V(stage 1 bounds)`, `P2 = max(1.6 × P1, 0.125 × V(stage 2 bounds))`,
  `P3 = max(1.6 × P2, 0.29 × V(whole city))`. The three fractions are the pace knob; they were
  tuned with the balance harness in Port Meridian (`docs/BALANCE.md` sections 8 and 9).
- Display: a skyline with three towers. Points 0..P1 map to the first 21% of its width, P1..P2 to
  21..57%, P2..P3 to 57..100% (these are the doc's 15 / 40 / 70 marks, rescaled so the third
  tower is the end of the bar).
- Tuning target (since phase 1: every stage about a fifth shorter than before, the owner's word
  after the first multiplayer playtest): contested stages of about 2:35 / 2:30 / 3:05 and a
  match of about 8:15; a kaiju left alone fills a stage's segment in about two minutes. Measured
  with `npm run sim` (bot against bot, Port Meridian, every start in turn, 40 matches):
  contested stages of about 2:02 / 2:27 / 3:01 and 7:31 on average (stage 1 is shorter than the
  aim because the squad-mates' stray fire fills the bar too); alone 123 / 117 / 164 s for the
  three segments; the kaiju winning 20 of 40. `docs/BALANCE.md` section 9 has the tables.

### The molt

1. When the bar passes mark 1 (or 2), the kaiju gets a molt prompt. It chooses when and where:
   one press of Molt. The cocoon starts and the molt cards are offered (section 4): the kaiju
   picks its next move during the cocoon or the intermission.
2. Cocoon: 10 s. The kaiju is helpless and takes damage as if staggered (see nerve). Humans get
   no marker beyond normal spotting rules; a loud heartbeat sound falls off with distance.
3. Blast wave: units within 3.5 × the new body radius are destroyed, units within 7 × are shoved
   out and shaken. Buildings are not damaged (no free bar).
4. Intermission, 20 s when drafts exist (Tier 2), 8 s otherwise: camera pulls back, bounds widen,
   time of day shifts, humans redeploy at the new edge (squads spread around the perimeter, at
   least 250 m from the kaiju).
5. Resets: kaiju health and nerve to full at the new size; every human squad returns fresh at the
   new level; eliminated players rejoin. Carries over: city damage, upgrades, veterans, rage.

**How the molt runs** (as built; `shared/src/sim/systems/matchFlow.ts`, `sim/spawn.ts`):

- The clock runs through the cocoon and stops for the intermission. A kill in the cocoon, the
  bar passing the third mark or the clock running out all end the match there and then.
- The blast is measured from the cocoon to the near edge of each unit, in body radii of the
  NEW size (kill 3.5, shove 7: 31.5 m and 63 m into stage 2, 91 m and 182 m into stage 3).
  Units it kills count as the kaiju's kills and do not come back as veterans; units it shoves
  are shaken, lose their charge and are thrown just clear of the shove radius (walls and the
  bounds stop them). Everything in flight is gone and running fire missions are called off.
- The kaiju stands up at once at its new size, with full health and nerve, where the cocoon
  was (kept inside the bounds). When that spot is too tight for the new body (a cocoon tucked
  between two tall buildings), it stands up on the nearest ground clear of every wall it
  cannot walk through; what is low enough to trample does not count. Rage and what it has
  wrecked are untouched.
- Intermission: nobody can move, act or give orders; units the blast threw slide to a stop.
  The stage number and the bounds are still the old ones until it is over.
- Then the new stage: every unit alive at that moment is marked a veteran (aim error ×0.7),
  the bounds widen, and every squad returns whole at the new level. Squads deploy one per
  sector of bearings around the kaiju, so that they come at it from every side, each at the
  point of the new perimeter nearest to it that is at least 250 m away (at stage 1 the bounds
  are too small for that: the four squads start near the corners, about 210 m out). A point of
  the perimeter only counts when dry ground lies within 40 m of it and a unit there can drive
  straight out onto a street inside the bounds: no squad arrives out at sea, on a mole or a
  pier, or in a pocket of houses whose only way out is across the quarantine line. Each unit
  stands on dry ground by a street, no nearer the kaiju than its squad's point.
- The starting neighborhood is drawn from the match seed (or fixed by the match config); the
  kaiju hatches at its anchor on the nearest open ground.

**Never alone** (owner's decision after the first multiplayer playtest: a monster with nobody
left to fight should not have to stand about wrecking buildings to reach the next stage). As
built (`shared/src/sim/systems/matchFlow.ts`):

- When every squad in the match has been wiped out during play, the city gives way: over 2.5 s
  (`MATCH_RULES.neverAloneTime`) the standing structures nearest the kaiju inside the bounds
  collapse one after another, through the normal city damage path (they fall on every screen,
  the bar fills and the tally counts them as the kaiju's), until the bar reaches the current
  stage's mark. If the bounds cannot supply that much, the bar is set to the mark.
- Then the cocoon starts by itself where the kaiju stands (it comes up first if it is under
  water, waits out a stagger, and drops what it holds; whatever it was doing is cut short), and
  the molt cards are offered as usual. A kaiju already in its cocoon needs none of this.
- At stage 3 the bar fills to the last mark: the kaiju wins.
- Eliminated squads come back at the next stage, as after any molt. A match that never had a
  squad (the balance harness's `--unopposed`) is not "alone".

## 3. One rule set: health and nerve

Every combatant (kaiju, human unit) has `hp` and `nerve`. All damage goes through one function:
`applyHit(target, { damage, nerve, fromDir, sourceId, kind })`.

**Kaiju (all stages):** hp 1000, nerve capacity 100.

- Damage multiplier by state: normal ×0.12, bracing (hits on the front 120° arc) ×0.04,
  staggered or cocooned ×0.5.
- Facing multiplier (damage and nerve): front (within 60° of facing) ×1.0, flank ×1.35, rear
  (more than 135° off) ×1.7.
- Nerve damage accumulates and leaks away at 7.5 per second, continuously. Crossfire: a hit whose
  direction differs by 60° or more from another unit's hit in the last 2.5 s gets ×1.75 nerve.
  Bracing: ×0.25 nerve on the front arc. Fire-at-will hits from sub-units and bots: ×0.5 nerve.
- While nerve damage is building, speed is reduced by up to 30% (this is "scattered fire only
  slows it").
- At 100 accumulated, **and only under the charged volleys of two squads** (below): **stagger**
  for 5 s (helpless, weak point glows, the ×0.5 multiplier: four times what it otherwise
  takes), then nerve clears and the kaiju cannot take nerve damage for 8 s (long enough that
  four squads cannot keep it stunned).
- **It takes two squads to break it.** Nerve at 100 breaks only while charged volleys (section
  5: sub-units fired with at least 60% charge) from two different squads have hit the kaiju
  within the last 5 s. Until then the nerve stays at 100, "on the brink": the kaiju is as
  slow as nerve damage makes it and easier to hit, and the next pair of volleys breaks it at
  once. Scattered fire, a held trigger, artillery, or one squad's volleys (however many, from
  whatever side, crossed or not) never break it by themselves.
- After any freeze or trip ends (Tier 2), 6 s immunity to both.

**Human units:** hp per the tables below, nerve capacity 100, nerve leaks at 8 per second.
Roar (a move picked at a molt): every unit in radius is stunned for 2.5 s (it cannot move or
fire, does not answer its player or its squad), takes 100 nerve (a full unit's worth: every
unit it reaches is shaken once the stun is over) and always loses its volley charge. Stomp shockwave: 40
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
- The two-squad rule counts squads, not hits: each squad's latest charged volley hit is
  remembered for 5 s, volleys that land during a stagger or the immunity included. The hit
  that takes the nerve to 100 need not be a volley's own, as long as two squads' volleys have
  landed in the last 5 s. A match with a single squad asks for that squad's volley only, and so
  does a match in which every other squad has been wiped out: the rule counts the squads still
  in the fight.
- A shaken unit cannot be shaken further; when it steadies its nerve starts again from 0.
- Trample needs the kaiju to be moving (at least 1 m/s) and the unit's circle to overlap its
  body circle. It deals no nerve damage.
- Units standing on a bridge deck when it collapses fall into the river: 40 damage and shaken.
- A squad that carries the insurance rider upgrade insures the first landmark that takes damage
  after its policy is free: all damage to that landmark adds nothing to the bar.

## 4. The kaiju

View: third person by default, from behind and above the shoulders (owner's decision,
`docs/ROADMAP.md`); V switches to first person from a camera anchor in the head (own snout and
claws visible). The mouse or right stick sets a desired heading; the body turns toward it at the stage
turn rate; the head (camera) can lead the body by up to 50°. Movement is relative to the view.
Both views look exactly where the head looks, with the same limits (up and down 62°, sideways
the head's 50° lead, all the way round as the body turns): the toggle moves the camera from
inside the head to behind and above the shoulders and never changes the look direction. While
the beam drags the head, or the kaiju is staggered, both views ride the head.

**Controls: one move per button** (owner's decision after the first multiplayer playtest,
`docs/ROADMAP.md` phase 1; the input contract is the header of `shared/src/net/input.ts`). No
button means one thing when tapped and another when held. The starting kit is four buttons and
the molt; each molt adds one move, picked from three cards, on one of two move buttons.

| Button (keys) | What it does |
| --- | --- |
| Strike (left mouse) | Swipe. With something in the hand: throw it at the crosshair. |
| Grab (right mouse) | Grab what is in reach. With something in the hand: eat it. With nothing to pick up in reach but something to eat (a kiosk, a wreck): eat that. With neither: the hand closes on nothing. |
| Stomp (Space) | Stomp. |
| First move (Q) | The move picked at the first molt; nothing before it. |
| Second move (E) | The move picked at the second molt; nothing before it. |
| Molt (F) | One press starts the cocoon, when the bar offers a molt. |
| (none) | Swimming is automatic (below); any of the buttons above brings the kaiju up. |

Action timings are the tells. `r` = body radius for the stage.

| Move | Button | Timing (windup / active / recover) | Effect |
| --- | --- | --- | --- |
| Swipe | Strike | 0.45 / 0.15 / 0.5 s | 120° arc, reach 2.5 r. Units: 70 damage, 40 nerve. Structures: 40 / 300 / 2000 by stage. |
| Stomp | Stomp | 0.9 / 0.1 / 0.9 s | Shockwave radius 3.6 r. Units: 100 at center to 30 at edge, knockback. Structures: 55 / 420 / 2600 with falloff. |
| Grab | Grab | 0.4 s | Grabs the nearest car, wreck, live vehicle (stage 2+) or building chunk (stage 2+) in a 100° arc within 2.5 r. |
| Throw | Strike, holding something | 0.3 / 0 / 0.2 s | At the aim point: 25 / 45 / 70 m/s ballistic. Impact: units 120 in radius 4 / 10 / 22 m; structures 60 / 350 / 1500. |
| Eat | Grab, holding something (or nothing to grab but something edible in reach) | 2.0 s, rooted | Heals 80 hp. 10 s cooldown. The meal is consumed. |
| Molt | Molt, one press | 10 s cocoon | Only when a molt is available. The molt cards are offered (below). |

The moves a molt can add (each on the move button of the slot it was put in):

| Move | Timing | Effect |
| --- | --- | --- |
| Beam | 0.8 s windup, 3.0 s beam, 0.4 s recover | Costs 100 rage. Range 60 / 220 / 600 m, width 2.2 / 7.5 / 21 m, turn rate ×0.25. It fights the head: a shake of up to 4° sideways and 1.5° up and down, a pull of 6° to one side and a kick of 4° upward, all growing over the 3 s. Units 150 per second. Structures 60 / 600 / 4000 per second; the beam stops at the first standing structure until it burns through. |
| Roar | 1.2 s, 18 s cooldown | Radius 40 / 110 / 280 m. Every unit inside is stunned for 2.5 s (it cannot move or fire, its charge is lost, a player's own unit does not answer its controls, squad-mates do nothing), then shaken for 4 s (100 nerve). |
| Charge | 0.8 s windup, up to 3.0 s run, 1.2 s stumble; 12 s cooldown from the end of the stumble | The run goes straight ahead, reaching twice the walking top speed in 0.5 s (17 / 28 / 44 m/s) and turning at a quarter of the usual rate. It smashes structures up to 9 / 30 / 70 m (city damage); a taller one stops it dead. Units it runs into: 90 damage, 40 nerve, thrown aside 1.5 r. A second press ends the run. It always ends in the stumble. |
| Tail sweep | 0.35 / 0.15 / 0.45 s, 6 s cooldown | The rear half (180° behind the body), reach 3 r. Units: 60 damage, 30 nerve, knocked outward 1.5 r (half that at the tip). Structures: 40 / 300 / 2000, as a swipe. |
| Brace | while its button is held | Rooted, turn rate ×0.3. Front-arc reductions (section 3). |

Walking over units deals trample damage (40 per second inside the body radius while moving).
Dead at 0 hp. The kaiju sees the yellow targeting lasers of charging units. In either view (it
matters most in first person, where most lasers are beside or behind the head) each squad with
guns charging at it is also a yellow diamond on the screen: over the guns when they are in
view (first person only; third person sees the lasers), otherwise on the screen's edge in
their direction with an arrow pointing out at them. It grows with the squad's charge, pulses
fast from 60% (a volley that counts) and flashes white when the volley is fired
(`client/src/ui/threats.ts`; polish pass 2).

### Molt cards

At each molt the kaiju picks one new move from three cards (pictures, no text). As built
(`shared/src/sim/moltCards.ts`):

- The cards are offered when the cocoon starts. First molt: **beam**, **roar**, **charge**.
  Second molt: the two not taken at the first, plus **brace** or **tail sweep**, drawn with the
  match's random numbers when the offer is made.
- A pick counts from the cocoon's start to the end of the intermission after it. If none is
  made by then, one card of the offer is drawn at random, so every molt ends with a new move.
- The pick goes into the first empty slot at once: the first molt's move on the first move
  button, the second molt's on the second. Moves stay for the rest of the match.
- Rage builds from the start of the match whether or not the beam has been picked, so a beam
  taken at the first molt can be ready at once (the owner's "big early reward").

### The hit volume

As built (`shared/src/sim/kaijuBody.ts`): a few capsules that follow the body, so that a shot at
the head or the tail counts, where it used to pass through a single column round the middle.

- The body: an upright capsule of the body radius from the ground to the kaiju's height.
- The head and neck: one capsule from the neck to the snout along where the head looks, where
  the model has them (stage 1: radius 0.95 m, reaching 2.6 m ahead of the body's axis at 3.3 to
  3.55 m up; stage 2: 4.4 m, 15.6 m ahead at 24 to 25 m; stage 3: 18 m, 55 m ahead at 80 to
  84 m), measured on `kaiju_lizard_s1/s2/s3.glb`.
- The tail: two capsules behind the body along its facing, sloping down to the tip (stage 1:
  from 1.6 m high at 0.9 m behind the axis to 0.6 m high at 3.2 m behind, radius 0.6 then
  0.35 m; stage 2: 12.3 m high at 5.3 m behind to 4.4 m high at 21.6 m behind, radius 3.9 then
  2.3 m; stage 3: 43 m high at 18.9 m behind to 15.5 m high at 81.5 m behind, radius 15.5 then
  9.5 m).
- In the cocoon only the body counts. Swimming, only the spines show, as before.
- Projectiles, blasts and every aim ray (`resolveAimPoint`) use it. A blast reaches the body as
  it always did (a column flat at the bottom, so a shell bursting at its feet counts) and the
  head and tail as their capsules. Where on the body a hit lands changes nothing else: the
  facing multiplier (section 3) is still judged by the direction the hit came from.

**How the verbs resolve** (as built; `shared/src/sim/systems/kaijuActions.ts` and
`shared/src/sim/kaijuEffects.ts`). Per-action movement and turn multipliers are in the kind's
definition.

- Every verb is committed: nothing cancels it but a stagger, death, or the city giving way
  (never alone, section 2); a second press of the charge's button ends its run early. A press
  made during another action is remembered for 0.2 s, and for as long as the button stays
  down; holding a button never repeats its move. Bracing is exclusive (let go of its button to
  act). When several inputs compete the order is molt, brace, first move, second move, stomp,
  strike, grab.
- Attacks are aimed along the head (the view), which leads the body by up to 50°; the tail
  sweep is aimed straight behind the body. The effect lands once, at the end of the wind-up.
- **Swipe:** every unit, structure and prop touching the arc takes the full hit.
- **Stomp:** values fall off linearly from the body center to the rim (structures to 30% at the
  rim). Knockback shoves units outward by up to 1.5 r, less toward the rim; walls stop them.
- **Grab:** the nearest loose object in the arc wins (car, wreck, live vehicle); only when there
  is none does the hand tear a chunk from the nearest building (150 / 1000 structure damage at
  stages 2 / 3). A grabbed car leaves the city at once and counts for the bar. Grabbing from a
  tank troop takes one tank; the unit dies when its last tank is taken and leaves no wreck.
  Grab with nothing to pick up in reach eats instead, when something edible is in reach and
  the meal is off cooldown; otherwise the hand closes on nothing.
- **Throw:** a flat ballistic arc that lands on what the crosshair is on (the aim ray starts at
  the eye, which sits in the head: 1.7 / 11 / 38.5 m ahead of the body's axis and 4.2 / 27.5 /
  90.7 m up, where the model has its camera); beyond reach it flies at 45°; with the
  crosshair on the sky it flies where the head points. The object hits the
  first structure, unit or ground it meets (never its thrower) and damages everything inside
  the impact radius.
- **Eat:** the meal is taken at the first bite and the heal lands when the 2 s are over. Edible
  off the ground: cars, kiosks, car wrecks, tank wrecks. Anything in the hand can be eaten.
  The cooldown counts from the first bite; with something in the hand and the meal on
  cooldown, Grab does nothing.
- **Roar:** the stun, the nerve hit and the charge reset land at the start of the roar. The
  stun freezes a unit where it stands; the shaking the roar brings (100 nerve) starts when the
  stun is over. A unit already shaken is stunned too, and its shaking waits out the stun.
- **Beam:** leaves the mouth along the head's aim, pitch included, so it is aimed like a
  weapon: level it burns what stands at mouth height, pointed down it ends on the ground.
  The mouth is where the model has it: 2.5 / 15 / 51.4 m ahead of the body's axis along the
  aim and 2.9 / 22 / 72 m up, so what stands under a titan's chin is not in the beam.
  While it is on, the head only turns at the beam's reduced rate, and the beam strays about
  where the head is steered: it shakes (a third of the shake at first, all of it by the end),
  pulls to one side (left or right, by the tick it started) and kicks upward, the pull and the
  kick growing evenly to their full size over the 3 s (`beamShake` in `sim/beam.ts`; a pure
  function of time, the same on every machine). The player steers against it. It stops at the first
  standing structure its center or either edge touches and burns only that one; units behind
  a standing building are safe. Units within the beam's width (plus 1 m of slack above and
  below) take the unit damage and 60 nerve per second.
- **Charge:** in the wind-up the kaiju is rooted but turns as usual. The run ignores the stick:
  the body drives straight along its heading, turning toward the crosshair at a quarter of its
  rate (`kaijuMoveInput` in `sim/movement.ts`, which client prediction uses too). Everything it
  walks into up to the charge's smash height falls (cause 'charge'); a taller structure, or
  the edge of the bounds, stops it dead and the stumble starts on the next tick. A titan wades
  through what it cannot smash, as when walking. Each unit it runs into (within 1 m of its
  body) is hit once per charge and thrown aside, to its own side of the path and a little
  forward. In the stumble it is rooted and can do nothing; it slides to a stop. The cooldown
  reads as the whole charge plus 12 s while it runs and is exactly 12 s when the stumble ends.
- **Tail sweep:** the arc is centered straight behind the body (not the head). Everything
  touching it takes the hit once; units are knocked outward from the kaiju.
- **Molt:** one press of Molt starts the cocoon where the kaiju stands; it drops what it holds,
  and the molt cards are offered.

### Swimming (hide and travel)

Owner's note after the second playtest: "all monsters should have some hide/travel mode,
Grognar should be able to swim in the river, still hittable but only a few spines/a bit of
hitbox exposed... Maybe big size doesn't have travel mode." The monster is slower than the army
and has to hide, and wrecking the city takes its cover away: the water is cover that stays.
As built (`shared/src/sim/swim.ts`, numbers in the kind's `swim` definition):

- **Who and where.** The hatchling and the juvenile; the titan is too big for any water and
  wades as before. Water is deep enough where it reaches 0.75 body radii from the kaiju's center
  all round at stage 1 (3.6 m of water across) and 0.35 at stage 2 (6.3 m): the river, the bay
  and the Old Moat (section 7). A bridge deck overhead does not matter: it swims under.
- **No button.** It is automatic, so a new player has nothing to learn: a kaiju that stands or
  walks in deep water without acting goes under in 1 s. Any kaiju button (strike, grab, stomp,
  either move button, molt) brings it up in 0.6 s, and the press is carried out as soon as it is up
  (a roar pressed under water is a roar 0.6 s later). An action, a stagger, or leaving deep
  water also brings it up. After it last acted it stays up 1.5 s before it goes down again, so
  a fight in the river is a fight, not a bob up and down.
- **Under** (and while going down or coming up) it cannot strike, grab, throw, eat, brace,
  roar, breathe its beam or molt, it tramples nobody and wrecks nothing (no destruction, no bar,
  no rage from the city; a bridge deck it swims under is safe). It moves at 1.1 times its land
  top speed with no water slowdown (9.4 m/s at stage 1, against 4.3 wading; 15.4 m/s at stage
  2, against 11.9), and turns at 0.8 of its rate. Nerve still slows it as usual.
- **What shows** is a ridge of spines: the hit volume shrinks to what is above the water, 0.14
  of its height (0.6 m at stage 1, 4.5 m at stage 2) over 0.55 of its radius. It can be hit,
  only by a shot aimed at the spines; a blast catches it only when it reaches what shows.
  Damage and nerve rules are unchanged.
- **Seen.** Squads see it, and spot it (the scatter bonus), only within 0.4 of the usual
  distances (100 m instead of 250, 60 m instead of 150), and only by a sight line to the
  spines. At stage 2 the humans' map, which otherwise always shows the kaiju, shows it while it
  is under only when a unit sees it or it made noise. (The orange marker over the kaiju
  follows the server's `spotted`, so it shows less while it swims; the snapshot carries
  `submerge` for whatever else wants it.)
- **No stalling.** Nothing it does in the water earns anything and the clock runs on: time
  spent hiding is time the humans win by.

**Tier 2 kaiju (same verbs, different numbers and one special each):**

- **Krabulon (Crab):** front 150° arc takes ×0.25 damage and nerve; rear takes ×2.2. Sidesteps at
  full speed, turns slowly. Special: claw clamp that crushes a whole structure or vehicle group.
- **Drillmaw (Burrower):** can burrow (toggle, 1.5 s). Underground it is fast, invisible and
  cannot attack; humans see a seismograph ring whose error grows with distance. Surfacing erupts.
  Special: sinkhole that swallows a block.
- **Vespera (Moth):** hp 650, fast, glides over structures up to half its height. Wing gusts shove
  units out of formation and cancel charge. Special: scale dust cloud that blinds targeting.

## 5. The humans

Each human controls a **squad of 4 units**: one driven directly, and three squad-mates that ride
with it as a loose swarm and shoot on their own. Nobody gives them orders (docs/ROADMAP.md,
phase 1: the command wheel, map orders, smoke, marking and the artillery button are gone). A unit
is one simulated body with a member count (soldiers or vehicles drawn around it); members are
lost as hp drops. View: third person by default, from behind the driven unit; V switches to
first person from the lead member (the same look direction and limits in both: up and down 80°,
all the way round). Two buttons: **Fire** and
**Volley**. Arcade handling: cooldowns, no ammo.

**Speed:** every level is 10 to 20% faster than the kaiju at the same stage (the owner's rule: a
squad can always get away while the kaiju can still throw things at it). Each is about 1.15
times the kaiju's top speed; `shared/test/defs.test.ts` holds every level between 1.1 and 1.2.

### Army (Tier 1)

Damage is normalized so a squad's full salvo is about 38 raw damage at every level. Nerve is
about 20 raw per salvo at levels 1 and 2 (19 to 22, tuned per level): a single squad's
full-charge volley is 54 nerve from the front and 92 from behind or as a one-player crossfire,
most of the way, never all of it. Level 3 is counted per tank, the way a player sees it (the
polish pass after the first playtest): a troop's shell carries 4.5 nerve, so each tank of a
troop is worth nearly what a level 2 tank is (5.4), and a charged volley of about ten tanks
breaks the titan from the front (108 with three of the ten firing as leaders, uncharged).
A full level 3 squad's volley passes 100 by itself. Either way it takes two squads to break the
kaiju while two are in the fight, and the rule in section 3 holds that line whatever one squad
does (a volley from behind that also crosses, or volley after volley, only brings it to the
brink).

| | Level 1: rocket infantry | Level 2: tank platoon | Level 3: tank company |
| --- | --- | --- | --- |
| Unit | section of 10 soldiers (3 launchers) | 1 tank | troop of 3 tanks |
| Unit hp / speed / radius | 100 / 9.8 m/s / 3 m | 100 / 16.1 m/s / 4 m | 300 / 25.3 m/s / 9 m |
| The driven unit handles | relative to the view | a tank: hull turn 75°/s, turret 140°/s | a tank: hull turn 55°/s, turret 110°/s |
| Shot | up to 3 rockets (one per 3.4 members) | 1 shell | up to 3 shells (one per tank) |
| Per projectile: damage / nerve | 3.2 / 1.8 | 9.5 / 5.4 | 3.2 / 4.5 |
| Projectile speed, flight | 55 m/s, flat | 110 m/s, flat | 110 m/s, flat |
| Range / cooldown (a projectile gives out after 1.1 × range) | 160 m / 2.6 s | 420 m / 3.2 s | 600 m / 3.2 s |
| Splash radius / structure damage | 3 m / 3 | 5 m / 25 | 5 m / 25 |
| Squad-mate aim error (fire at will / volley) | 3.5° / 1.2° | 2.5° / 0.9° | 2.5° / 0.9° |

**Tank driving** (the driven unit at stages 2 and 3; squad-mates steer themselves): W and S are
the throttle along the hull (speeding up at 10 m/s², braking at 16, reverse at half the top
speed), A and D turn the hull (on the spot when it stands still), and the turret turns toward
where the player looks at its own pace (the numbers above). The gun's elevation follows the
mouse at once. The tank's shots leave along its turret, not along the view.

**Artillery:** no button calls it any more (docs/ROADMAP.md, phase 1); phase 2 brings it back
as an artillery radio picked up on the ground. The fire mission itself is kept as it was: a
marker on the ground, and after 4 s, 8 arcing shells land over 2 s within a 28 m scatter
radius: each 9 damage, 5 nerve, 14 m splash, 300 structure damage. A whole barrage on target is
half a stagger's worth of nerve: it sets up a volley, it does not replace one (artillery never
counts toward the two squads it takes to break the kaiju).

Smoke and marking (polish pass 2) were removed after the first multiplayer playtest ("too much
already"; docs/ROADMAP.md).

### The two buttons, and the swarm

- **Fire** (left mouse): the driven unit's own weapon, every time it is ready, for as long as
  the button is held.
- **Volley** (right mouse): while it is held, the three squad-mates stop where they are, plant
  (rooted), turn their weapons toward the crosshair, show their targeting lasers and charge from
  0 to 1 over 4.5 s, while the HUD's big meter fills. The leader is never planted and can keep
  moving. Let go: every planted squad-mate with charge fires at the crosshair, the leader's own
  shot goes with them if its weapon is ready, and the squad-mates follow again. Let go early for
  a weak shot. A stunned or shaken squad-mate neither charges nor fires.
- **The swarm:** the squad-mates follow the leader as a loose group around and behind it, keep
  up with it, and fire at will on their own when they have range and a line of fire (half
  nerve, the at-will aim error).

**What a volley is worth:** every planted squad-mate with charge fires at the point the leader's
crosshair lands on, and its charge is spent. Damage ×(1 + charge). Nerve is what the charge is
for, and it only pays when nearly complete:

- Below 60% charge the shot is **ragged**: nerve ×0.5 and the at-will aim error, exactly what
  fire at will is worth. Letting go early is a weak shot.
- From 60% to a full charge it is a **charged volley**: nerve rises evenly from ×0.5 to ×3
  and the aim error falls from the at-will to the volley value. Only charged volleys count
  toward breaking the kaiju's nerve (section 3), so waiting for the charge, and firing
  together with another squad, is how it is broken.

**Backstop:** projectiles are real objects. A miss keeps flying and hits whatever is behind:
structures (adds to the bar), ground, or nothing. No friendly fire between human units.

**Scatter multipliers** (aim error and artillery scatter): ×0.6 if the target is slowed,
staggered or cocooned; ×0.7 if spotted (a player-driven unit has line of sight within 150 m;
the Air faction widens this in Tier 2); ×1.0 / 0.8 / 0.6 by kaiju stage.

**Lives:** when the driven unit dies, the player takes over a surviving squad-mate. When all
four are gone the player is out until the next molt and gets a free-flying news drone camera
(Tier 2: photos for the front page).

**Veterans:** squad-mates that survive a stage come back with aim error ×0.7 and a chevron mark.

**How squads work** (as built; `shared/src/sim/systems/unitOrders.ts`, `systems/weapons.ts`,
`sim/squads.ts`, `sim/nav.ts`, `sim/movement.ts`; the numbers the design left open are
`SQUAD_RULES` in `shared/src/defs/rules.ts`):

- **Driving.** Rocket infantry moves relative to the view and goes any way at once. The tank
  (stages 2 and 3) is driven as above, by throttle and hull turn; its velocity always lies along
  the hull (tracks do not slide; a wall it drives into takes its speed). The input's two stick
  axes are read as a square, so W and D together are full throttle and full turn. The weapon's
  aim is the view for infantry and the turret for a tank. Holding Fire shoots every time the
  weapon is ready. The shots go to the point where the weapon's aim ray from the unit's eye
  lands (a kaiju, a structure, the ground, or far out along the ray); a person's own shots have
  no aim error. A salvo is one projectile per launcher or tank still standing, leaving from
  points spread across the unit.
- **Range** is how far a projectile flies: every shot of a unit, the player's own and a
  volley's as much as fire at will, gives out in the air after 1.1 times the weapon's range.
- **The swarm.** Two squad-mates ride one spacing (two unit widths plus 2 m) behind the leader
  and 0.9 spacings out to either side of its track; the third rides two spacings straight
  behind. Where there is no room for that (half the width is tried next) they close up into
  single file on the leader's track. Places are measured back along the way the leader came,
  so the swarm follows it round corners. A fresh deployment stays where it was placed until the
  leader moves. Behind a leader on the move a squad-mate keeps the leader's pace plus what it
  needs to close up (up to 1.3 times its own top speed), braking in time for its place (a troop
  of tanks at full speed needs some 25 m to stop), and rides along once it is there; one that is
  ahead of its place slows down rather than turning round. A squad-mate more than three
  spacings from its place drives the leader's own way after it (the last 400 m of the leader's
  trail, open to a unit of its size because the leader drove it), skipping any loop it passes
  close to; a tank does that flat out on the straights but brakes in time to take each corner of
  the way at 40% of its top speed (catching up at full speed it would slide past the corner and
  into the houses). Around a stopped leader it settles, and a tank turns to face where its
  leader faces.
- **Fire at will.** A squad-mate shoots when a kaiju is inside its weapon's range and its line
  of fire (to the middle of the body, or else higher or lower on it) is clear, on the move as
  well as standing. It leads a moving target by the flight time, swings its weapon at 270° per
  second, and fires with the at-will aim error. These shots count half for nerve. A bot's own
  driven unit shoots like a squad-mate (at-will error, half nerve) unless its shot goes with a
  charged volley. A planted squad-mate does not fire at will.
- **The volley.** The volley button held (or let go on this very tick): every living squad-mate
  that is neither stunned nor shaken plants where it stands, its laser on (`state` 'charging'),
  its charge growing over 4.5 s, its weapon swinging (270° per second) toward the point the
  view's aim ray from the leader's eye lands on; with the crosshair on a kaiju, toward the
  middle of its body at that height, so that shots from every side connect. On the tick the
  button is let go, each planted squad-mate with charge whose weapon is ready fires at that
  point with the multipliers and aim error its charge has earned, the leader's own shot joins
  if its weapon is ready, and every planted squad-mate is let go, fired or not: its charge is
  spent and it follows again. Only a charged volley is announced (the `volley` event, "volley
  away" on the radio, the player's tally). Nothing checks line of sight for a volley, and range
  only through how far the shots fly: a building in the way is the player's problem, and the
  bar's gain. A squad-mate that is shaken lets go and backs off; when it steadies with the
  button still held, it plants afresh, its charge from 0.
- **Aim error** is one sigma on heading and on elevation, drawn for every projectile, times the
  scatter multipliers of the kaiju being shot at, ×0.7 for veterans. "Slowed" means staggered,
  cocooned, or carrying at least 30% of its nerve capacity in accumulated nerve damage. The
  spotter is the unit somebody drives: a bot squad's leader counts, squad-mates do not.
- **Shaken** units cannot fire or charge and back away from a kaiju within 10 of its body radii
  (at least 60 m). When they steady they go back to the swarm. **Stunned** units (the kaiju's
  roar, section 4) stand frozen: no moving, no firing, no charge.
- **Artillery missions** (`startCallIn` in `systems/weapons.ts`, the entry point for phase 2's
  radio): the marker goes down at once; the shells are real projectiles that fall from 400 m at
  75° above the horizon, coming over the caller's shoulder, timed so the first lands 4 s after
  the marker and the last 2 s later. Each lands inside the scatter radius times the scatter
  multipliers of the kaiju nearest the marker. They can hit a tall building or the kaiju's head
  on the way down. A mission already called finishes even if its squad is wiped out; it is
  dropped when the stage ends.
- **Lives.** The tick after the driven unit dies the player is in the surviving unit nearest to
  where it fell; the stick and trigger do nothing for that one tick. An eliminated squad takes
  no input until the next stage.
- **Veterans.** Every unit alive when a stage ends comes back as a veteran (the driven one too:
  it carries the chevron, and the accuracy matters if a bot drives it). A slot whose unit died
  comes back green.
- **Bridges.** A bridge deck is road surface: units on it stand at ground level, so nothing in
  flight, no sight line and no aim ray is stopped by the deck. A projectile that comes down on
  a standing deck has hit the bridge, and explosions beside it damage it like any structure.

**Map view:** toggles a top-down city map at any time. The game does not pause; the player's
unit idles. Shows bounds, rubble, friendly units, and the kaiju when it is known (always at
stages 2 and 3 unless it is swimming under water, section 4; at stage 1 only while a human unit
has line of sight within 250 m, or for 3 s after it roars, stomps or wrecks something). Nothing
is placed on the map any more.

### Bots

Human bot squads follow the same rules as players: each takes a different bearing around the
kaiju at 60 to 80% of weapon range, holds the volley button there and lets go when charged and
in line of sight, backs off when the kaiju closes, and heads for the cocoon when one is found. The kaiju bot roams toward the densest standing value, mixes swipes and stomps, uses
the moves it picked at its molts (roars when lasers are close, braces against charged volleys,
charges, sweeps its tail), eats when hurt, and molts somewhere out of sight. Bots are
deliberately beatable.

**How the bots play** (as built; `shared/src/sim/bots/`, numbers in `shared/src/defs/bots.ts`).
A bot writes the same input a client sends (stick, aim, buttons), one tick behind what it saw,
and plays any slot it is handed at any moment.

- **Squad bot.** It only knows what the humans' map shows. Loop: drive to a firing position (a
  spot on a street at its own bearing, 50 to 90% of range out, with a line of fire; squads keep
  their bearings 70° apart so their fire crosses), its tank driven by throttle and hull turn
  like a person's; stop; once its squad-mates have come up (or after 6 s), hold the volley
  button so that they plant and charge; keep the crosshair on the kaiju (the visible height of
  its body; ahead of it when it moves); and let go at full charge, waiting up to 2.5 s for a
  neighbor that is nearly charged so the volleys land together, then hold it again. Whenever it
  is not charging it fires at will (the leader shoots when it has the kaiju in range and in its
  line of fire). It moves on when most of its guns have no clear line, lets go early and drives
  away when the kaiju comes within 30% of range, and searches (last known position, then
  around) while a hatchling, or a kaiju under water, is off the map; when the last known
  position is out in the water it goes to the near bank instead and waits there. Its line of
  fire and its crosshair go to what shows of a swimming kaiju (the spines). Into a staggered or
  cocooned kaiju it does not charge: everybody fires as fast as the guns load.
- **Kaiju bot.** It goes for whatever standing structure (or car) pays best for the time it
  takes to reach and bring down, walks through what it tramples, swipes what it must, stomps
  when several things stand around it, and smashes what is in its way. It fights units that
  come close, takes revenge on the nearest squad for 10 s after a stagger, dashes at charging
  guns within reach for a few seconds when lasers are on it (they have to pack up and run),
  throws what is at hand at a squad in range, eats below 70% health (a grab and a second press
  for what it can pick up, a single press for a kiosk), and when the molt is offered looks for
  ground where fewer guns can see it and where its next body will have room, for 16 s at most
  (smashing what stands in its way there, as it does when wrecking), then cocoons with one
  press. In the cocoon it looks at the cards for 1 to 3 s and picks one by a simple preference
  with some randomness (weights beam 4, roar 3, charge 3, tail sweep 2, brace 1.5). With the
  moves it has picked, one press at a time: the beam on units in reach (else on something
  big); the roar at guns charging inside its radius, and then it goes for the units the roar
  froze; the charge at the nearest unit within a run's reach (beyond 2.5 body radii, with
  nothing it cannot smash in between), or toward what it is wrecking when the way there is
  lined with buildings the run would smash (20 / 150 bar points at stages 1 / 2; the titan's
  run smashes nothing its walk would not), ending the run early once it has passed the unit
  it ran at; the tail sweep when what stands behind it (units, buildings) pays better than a
  swipe or a stomp in front; the brace when four charged lasers are on it (2.5 s at most, then
  not again for 6 s). Swimming (stages 1 and 2): when its nerve is 70% full, or it is seen below 40%
  health, and deep water lies within 10 radii (stage 1) or 8 radii (stage 2), it walks in,
  presses nothing (so it goes under) and swims away from the squads, along stretches of deep
  water it can reach in a straight line, for 8 s; then it goes back to work and does not swim
  away again for 30 s. Water farther away cost it more than it gave back in the balance runs
  (it turned its back on the guns to get there): with 45 and 28 radii it won 20% of matches
  instead of about half.
- **Handicap.** `MatchConfig.bots` handicaps either side from 0 (its best) to 1 (stands still):
  in between, the bot idles that share of the time. For the balance harness, tests and
  practice options. `MatchConfig.bots.triggerHappy` makes the squad bots play the lazy way
  (they never charge a volley: they only shoot as the guns load, the squad-mates at will), so
  that the harness can measure what undisciplined fire is worth (`npm run sim -- --trigger-happy`).

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
- The Old Moat (owner's note after the second playtest: "water at all stages"): 20 m of water
  outside the beltway along the west, north and east edges, so every stage 1 and stage 2 square
  has water a kaiju can swim in (section 4, "Swimming") within about 165 m of where the match
  starts, reachable along the streets without breaking anything. No street or building moved
  for it; it took the place of the tree belt outside the beltway (docs/CITY.md section 11).
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

### Controls (as built: `client/src/game/input/actions.ts`)

Bindings are by key position, so WASD is the same four keys on any keyboard layout, and the
keycap glyphs show the letter printed on the player's own keyboard. Nothing is bound to Control,
Alt, Meta, Shift or a function key (with one of those held, a game key becomes a browser
shortcut that a page cannot cancel).

| Control | Keyboard and mouse | Controller (standard mapping) |
| --- | --- | --- |
| Move | W A S D (or the arrows) | Left stick |
| Look | Mouse (captured by a click on the view) | Right stick |
| Kaiju: swipe; with something in the hand, throw it at the crosshair | Left button | RT |
| Kaiju: grab; with something in the hand, eat it (heals; 10 s between meals); nothing to grab but a kiosk or a wreck in reach: eat that | Right button | LT |
| Kaiju: stomp | Space | LB |
| Kaiju: the move picked at the first molt (nothing before it; the brace is held) | Q | Y |
| Kaiju: the move picked at the second molt (nothing before it) | E | RB |
| Kaiju: molt (one press, when the bar offers it) | F | B |
| Kaiju: pick one of the three molt cards (or click it: the pointer is free while they wait) | 1, 2, 3 | D-pad left, up, right |
| Kaiju: swim (stages 1 and 2) | no button: walk into deep water and it goes under; any kaiju button brings it up | the same |
| Squad: fire (holding it keeps firing) | Left button | RT |
| Squad: volley (hold: the three squad-mates plant and charge; let go: they all fire at the crosshair) | Right button | LT |
| Squad, stage 1 (on foot): move relative to the view | W A S D | Left stick |
| Squad, stages 2 and 3 (a tank): throttle forward and back (reverse is slower) | W, S | Left stick up, down |
| Squad, stages 2 and 3: turn the hull (on the spot when stopped) | A, D | Left stick left, right |
| Squad, stages 2 and 3: the turret turns toward where the view looks, at its own pace | Mouse | Right stick |
| Drone: up, down | Space, C | A, B |
| Map | M or Tab | Back |
| Camera (first or third person) | V | Right stick click |
| Settings | Escape | Start |
| Controls card | H or Enter | Left stick click |

**What the monster player sees of its buttons** (docs/ROADMAP.md phase 1: one move per
button; `client/src/ui/kaijuKit.ts`). Bottom right, each picture over its button's glyph: Strike
(the claws; with something in the hand, the throw), Grab (the hand; with something in the hand,
the jaws, darkened while the last meal is under 10 s old) and Stomp; then the two move slots, a
faint egg in a dashed frame until a molt fills it, then the move's picture inside a ring that
fills as it comes ready (its cooldown; for the beam, the rage it needs, glowing when full; the
rage meter itself is shown only once the beam is picked); Molt, only while the bar offers one,
pulsing; the camera. The molt cards (`client/src/ui/moltCards.ts`): when the cocoon starts three
big cards come up in the middle of the screen, each the move's picture moving the way the move
does, over the key or d-pad direction that picks it; above them the move button the pick will go
on, under them a bar that runs down to the end of the intermission. A key, a d-pad press or a
click picks: the pointer is let go while the cards wait (mouse movement under pointer lock plays
no part) and the click takes it back. The picked card flies into its slot. Nobody picked by the
end of the intermission: the card the server drew at random is shown landing there.

**What a squad player can do** (docs/ROADMAP.md phase 1, after the first multiplayer playtest:
two buttons). Fire is the driven unit's own weapon (rockets, a tank gun, a troop's guns; one
per level, nothing to switch). Volley is the squad's: held, the three squad-mates stop, plant,
aim their lasers at the crosshair and charge; let go and they all fire there, the leader's own
shot with them if its gun is loaded. There is no command wheel, no number key, no order on the
map, no smoke, no mark and no artillery button any more (artillery comes back in phase 2 as a
radio picked up on the ground). The right button sends Volley as it is at that moment (and a
press too short to be seen between two inputs once), so letting go reaches the server in the
next input.

**The volley meter** (`client/src/ui/volleyMeter.ts`): a big yellow diamond round the crosshair
while Volley is held, filling from its bottom point as the squad-mates charge (from the newest
snapshot, carried forward between snapshots at the charge's own rate). A white notch across it
marks 60% (`COMBAT_RULES.volleyMinCharge`): below it the fill is a dull amber (let go now and the
shot is ragged), past it the diamond is bright and pulses (the volley counts), full it pulses fast
with a white edge. Letting go flashes it white and blows it outward, or, before the notch, it
fizzles grey. Under it one small picture per squad-mate: a yellow diamond while it charges, a cyan
circle while it follows, red while it is stunned or shaken (it cannot charge), a dim ring once it
is gone. When another squad's charged volley hits the kaiju, a ring round the meter counts down the
five seconds (`COMBAT_RULES.volleyBreakWindow`) in which this squad's charged volley, landing too,
lets the kaiju's nerve break (section 3); it blinks for the last 1.5 s, and bursts when this
squad's lands in time.

**Tank driving on screen** (stages 2 and 3; the rules are section 5): the third-person camera hangs
behind and above the tank along the view, not along the hull (11 m plus 1.4 radii back and 4.6 m
plus half a radius up: the view's center passes over the tank, which sits in the lower third of the
screen, hull and turret in sight). The crosshair stays where the player looks (a volley goes
there); a second, cyan reticle (`client/src/ui/gunReticle.ts`) sits where the gun points now and
its shell would land, sliding onto the crosshair as the turret catches up (a building between the
gun and the crosshair's point holds it short: the camera sees over what the gun, lower down,
cannot); its ring fills as the gun reloads and its ticks turn orange on the kaiju. The turret is predicted the way the simulation
turns it (`predictedTurret`, `client/src/net/prediction.ts`), and the reticle is placed after the
frame's camera, so it moves with the picture. The chase cameras keep out of walls and of tree
crowns and billboards (one in the way brings the camera in, level, over the unit), a unit's
marker fades out within about 30 m of the camera, and a soldier within 3.5 m of it is not drawn
(the squad-mates riding by the camera would otherwise fill the screen).

**The controls card** (`client/src/ui/controlsCard.ts`) teaches all of this without words:
every control of the player's role, each as the button's glyph on the device in use (it
switches when the player picks up a controller) followed by a picture of what it does. A ring
around a glyph means hold it; a small arrow means "then"; the HUD's three growing triangles
mark a control that only exists at some stages (grabbing tanks and pieces of buildings from
stage 2, the molt before stages 2 and 3, swimming at stages 1 and 2, moving on foot at stage 1,
the tank's driving at stages 2 and 3).
Swimming has no button: its tile is the movement keys, an arrow, and the spines-over-waves
picture; the HUD shows the same picture, in water blue, while the kaiju is under. The kaiju's
card: the starting kit (Strike's swipe, and its throw with something in the hand; Grab's grab, its
meal with something in the hand, and a kiosk eaten when nothing is in reach to pick up; Stomp),
the molt with its three cards over the buttons that pick them, the two move buttons as empty
slots with the stages they are filled from, then the five moves a card can give, each beside both
move buttons in a slot frame (the beam after the rage it needs, the roar then a dizzy spiral for
its stun, the brace with a hold ring), swimming, the map, the camera, the settings and the card
itself. The squad's card:
moving on foot, looking, Fire, Volley (the right button with a hold ring, the squad-mates
charging, the meter past its notch, then the volley going off), letting go early (the meter short
of its notch, then a dim volley), the tank's driving (W over S: the tank driving forward and back;
A beside D: the hull turning; the mouse: the turret swinging round), the map, the camera, the news
drone for after the squad is gone, the settings and the card itself.
It has a button in the lobby (for the role picked there) and on the briefing screen, is open
by itself for the whole briefing, and in a match opens and closes with its key while the game
runs on. Its picture and button are always the last of the action pictures at the bottom right,
for every role, and glow for the first 20 seconds of a match so a new player finds them; it takes no mouse input there, so the captured
pointer stays captured. A test fails if an action a player can press is missing from their
card (`ACTION_USERS` in `actions.ts` says who presses what).

### Voice cues (contract between the simulation and the audio)

The simulation emits cue ids; `shared/src/defs/voiceLines.json` maps each cue to one or more
voiced lines with an audience (`humans`, `kaiju`, `all`).

`match.briefing`, `match.start`, `kaiju.spotted`, `kaiju.lost`, `volley.ready`, `volley.fired`,
`crossfire`, `nerve.break`, `stagger.end`, `kaiju.brace`, `kaiju.roar`, `kaiju.special`,
`building.down`, `landmark.down`, `collateral.human`, `unit.lost`, `squad.wiped`,
`player.takeover`, `molt.available`, `cocoon.start`, `molt.blast`, `stage.2`, `stage.3`,
`callin.inbound`, `clock.3min`, `clock.1min`, `clock.10s`, `kaiju.lowhp`, `bar.near`,
`end.humans.kill`, `end.humans.clock`, `end.kaiju`, `hearing.humans.win`, `hearing.kaiju.win`.

**How the radio is kept lively but never spammy** (as built; `shared/src/sim/systems/voice.ts`,
rules per cue in `shared/src/defs/voice.ts`):

- The simulation chooses the lines. A `voice` event carries the line ids to play for each
  side (`lines.humans`, `lines.kaiju`): one line, or the whole sequence for the briefing, or
  none when the script has nothing for that side. The choice is made from whatever
  `voiceLines.json` holds, with the match's own random numbers, so every listener and every
  replay hears the same line. A cue about a squad is spoken in that squad's voice when it has
  lines for it, and never in another squad's; a cue does not play the line it played last time.
- Every cue has a minimum gap (for example 8 s between two "volley away" calls) and one of three
  priorities. Cues the match turns on (briefing, start, nerve break, molt, cocoon, blast,
  stages, clock, landmark, endings) always go out. Important ones (contact, crossfire, the
  special, collateral, a squad wiped out, takeover, artillery, low health, the bar nearly
  full) always go out too and use up chatter budget. Routine chatter (volley ready and fired,
  roar, brace, a unit lost, a building down, stagger over, contact lost) spends a budget of two
  lines that refills at one line per 5 s: a burst when something starts, then a trickle.
- `kaiju.lowhp` is called once per stage, when the kaiju first drops below 25% health;
  `bar.near` once on the way to each mark, at 85% of the way from the last one.
- On top of that, each side has its own say (`VOICE_SIDE_RULES`; polish pass of 14 November,
  after the owner's first game: "the anchor was speaking the whole time"). A cue that passes
  the rules above is always emitted, so the match itself is unchanged; a side that is not to
  hear it gets no line, and no subtitle.
  - The news (the kaiju player) speaks only for: the briefing, the start, a landmark down, the
    molt being ready, stage 2 and 3, one minute and ten seconds left, the ending, and the
    hearing. All the colour commentary (volleys, crossfire, roars, buildings, units, artillery,
    staggers and so on) is off. The lines are still in the script, just not played.
  - The radio (the squads) keeps every cue but repeats a cue only after twice its gap (at least
    8 s; nerve break 24 s, landmark 10 s, artillery 45 s), and routine chatter has its own
    budget of two lines refilling at one per 15 s. Other cues the match turns on are not held.
- Measured over ten whole bot matches (seeds 1 to 10, 115 minutes, briefing not counted): about
  13 cues a minute. Before this pass both sides heard all of them (1,473 news lines, 1,484 radio
  lines). Now the news says 124 (about 1 a minute, 12 times fewer) and the radio 772 (about 6.7
  a minute, 52%). `test/voice.test.ts` holds a whole bot match to these limits.
