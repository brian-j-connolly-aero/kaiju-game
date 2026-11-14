# Monster Battle 9001: Requirements

Nov 11, 2026 · @Brian Connolly

## Overview

This is an asymmetric party game for 2 to 8 or more players. One player is a kaiju wrecking a city, and the others lead small army squads trying to kill it before the city falls.

The feel combines Tokyo Wars' arcade punch, Mount & Blade's squad commands, Ace Combat's straight-faced melodrama, and giant-monster films. All kaiju are original, legally distinct designs.

Design pillars:

- **Wacky, played straight.** The world is absurd, and the radio chatter never admits it.
- **One rule set for everyone.** Kaiju, tanks and soldiers share the same damage and nerve system, so kaiju vs kaiju and human vs human need no new mechanics.
- **Collateral is the score.** Every missed shell helps the kaiju win.
- **No reading to play.** Icons, bars and pictures carry the interface. Only names and subtitles are text.
- **Short and replayable.** A match runs about 12 minutes.

## Players and match format

The default match is one kaiju against four human squads, with bots filling any empty human slot.

| Players | Setup |
| --- | --- |
| 2 | One kaiju vs one human squad plus three bot squads, or a kaiju vs kaiju duel |
| 3 to 5 | One kaiju vs four squads, bots filling gaps |
| 6 to 8 | Two kaiju vs up to eight squads, bots filling gaps |
| 9 or more | One more kaiju for every four human squads |

- The kaiju role rotates each match, and a player can volunteer for it.
- Each human picks their own faction. Duplicates are allowed.
- Bot squads follow the same rules as players and can position, charge and fire volleys.
- Friends talk over Discord. The game has no voice chat of its own.

Modes:

- **Base mode.** The kaiju tries to destroy enough of the city. Everything in this doc describes base mode unless noted.
- **Kaiju vs kaiju.** A simple fighting game using the same kaiju controls.
- **Later modes.** Hidden kaiju objectives, human vs human, and a scored end-of-match hearing.

## Winning

The kaiju wins by filling one destruction bar. The humans win by killing the kaiju or running out the clock.

- **The bar fills from all city damage**, no matter who caused it. Human misses count the same as kaiju stomps.
- **Rubble cannot be destroyed twice.** Damage to wrecked ground adds nothing to the bar.
- **The bar has three marks**, at roughly 15, 40 and 70 percent. The first two each unlock a molt. The third is a kaiju win. These numbers are starting values for tuning.
- **A kill at any stage ends the match**, including the first. The humans get three chances to stop the kaiju, one per stage.
- **The clock runs about 12 minutes.** If it expires, the humans win.
- **No rubber banding.** Neither side gets help for falling behind. The only lead that carries between stages is the bar.

## Stages and the molt

The match has three stages. The kaiju grows at each one, and the human armies, map and time of day scale up with it.

| Stage | Kaiju size | What the kaiju can do | Human level | Map bounds | Time of day |
| --- | --- | --- | --- | --- | --- |
| 1. Hatchling | Bus | Wreck cars, kiosks and houses. Hide in the streets. | Infantry scale | Neighborhood | Afternoon |
| 2. Juvenile | Building | Topple buildings. Throw vehicles. | Vehicle platoons | District | Sunset |
| 3. Titan | Skyscraper | Walk through everything. | Companies with off-map call-ins | Whole city | Night |

The molt runs in this order:

1. The bar passes a mark. The kaiju may now cocoon whenever and wherever it chooses.
2. The cocoon lasts about ten seconds and the kaiju is helpless. The humans get no guaranteed shot. They have to find it and reach it.
3. A blast wave clears the area, the camera pulls back, and the map bounds widen.
4. Both sides draft an upgrade in about 20 seconds. The humans redeploy at the new map edge.

What resets at a molt: kaiju health and nerve, and every human squad, which returns fresh at the new level. Eliminated players rejoin.

What carries over: city damage, upgrades, and veteran units.

## Kaiju play

The kaiju is a slow, heavy brawler that shrugs off scattered fire and only breaks under coordinated attack.

**View.** First-person by default, with a third-person toggle. The player sees their own snout and claws.

**Controls.** Four verbs plus one special. The same inputs work against armies and against other kaiju.

| Input | Effect |
| --- | --- |
| Strike, tap | Swipe |
| Strike, hold | Stomp with a shockwave |
| Grab, tap | Pick up and throw a vehicle or building chunk |
| Grab, hold | Eat, which heals |
| Block, hold | Brace against a volley, rooted in place |
| Roar | Shake the nerve of nearby units and reset their volley charge |
| Special | A signature attack per kaiju, powered by rage |

**Rules.**

- Every move is slow and committed. The wind-ups are the tells that humans read.
- **Nerve.** Scattered fire only slows the kaiju. Concentrated or flanking fire breaks its nerve, which staggers it and opens a weak point for real damage.
- **Facing.** The front is tough. The flanks and rear are softer.
- **Rage.** Taking damage and wrecking the city both fill the rage meter.
- **Immunity.** After a freeze or trip ends, the kaiju is briefly immune, so it cannot be locked down forever.
- **Kaiju vs kaiju.** Strike beats grab, grab beats block, and block beats strike.

**Roster.** Four kaiju for the minimum viable product (MVP). Names are placeholders.

| Kaiju | Trait | What it asks of the humans |
| --- | --- | --- |
| Lizard | All-rounder with a beam special | The baseline fight |
| Crab | Heavy front armor, soft back | Get behind it |
| Burrower | Tunnels underground and shows only on a seismograph | Predict where it surfaces |
| Moth | Fast and fragile, with wind gusts that shove units | Hold formation |

## Human play

Each human drives one unit directly and leads three sub-units with simple commands.

**View and handling.** First-person by default, with a third-person toggle. Handling is arcade: cooldowns instead of ammo, with big hit flashes and screen shake.

**Commands.** Given from a radial wheel of pictograms:

- Follow me
- Move to this position
- Fire at will
- Hold fire and charge a volley

**Combat rules.**

- **Volley.** Sub-units on hold build readiness. While charging they are rooted, locked to their firing arc, and show targeting lasers the kaiju can see. The player's own shot is the trigger, and everything fires at that target.
- **Crossfire.** Fire from two widely separated angles multiplies nerve damage. One player can set this up alone by parking the sub-units and driving to another angle.
- **Backstop.** A miss carries on along the line of fire and damages whatever is behind the target. Tank shots fly flat. Artillery arcs over buildings but scatters.
- **Scatter is controllable.** It shrinks with a spotter, a slowed target, and a bigger kaiju.
- **Call-ins.** Artillery and aircraft strikes come from off the map and are placed with a ground marker.

**Map view.** A top-down map can be toggled at any time. The game does not pause, and the player's unit sits idle while it is open.

**Lives.** The squad is the life pool. A player who dies takes over one of their sub-units. When all four units are gone, the player is out until the next molt.

**Reporters.** Eliminated players fly news drones and take photos. The best photo becomes the front page on the end screen. In base mode this is for fun and scores nothing.

**Veterans.** Sub-units that survive a stage return in the next one as veterans with better accuracy.

## Human factions

There are four factions. Every faction can both pin the kaiju and punch it, but each leans one way.

| Faction | Level 1 | Level 2 | Level 3 | Leans toward | Catch |
| --- | --- | --- | --- | --- | --- |
| Army | Rocket infantry | Tank platoon | Tank companies with artillery call-ins | Punch: the biggest volleys | The worst misses |
| Air | Drones | Helicopters | Jet squadron making strafing passes | Spotting and flanking | Fragile, and cannot hold ground |
| Super Science | Lab coats with prototype ray guns | Beam-dish trucks | Half-built mech or orbital laser call-in | Pin: freeze rays, lures and tripwires. Beams never scatter. | Long charge times. Overloaded generators take the block with them. |
| Coalition of Faiths | Clergy and choirs of every faith, on foot together | Processions with bell trucks and shrine floats | Relic superweapon: a pontiff opens the Ark | Nerve: steadies allies and shelters buildings | The relic hits everything in its cone, friends included |

**Coalition of Faiths notes.** Every tradition is visibly present and working side by side. The mechanics below are proposals to confirm:

- Chanted volleys grow stronger the more units charge in unison.
- Sanctuaries reduce damage to nearby buildings, which slows the bar.
- Nearby allies resist the roar.

Tone rule for this faction: the joke is the earnest teamwork and the absurd firepower, never any faith itself. All clergy are fictional characters.

**Mixing factions.** Any mix is allowed, including four of the same.

- Air spotting tightens Army artillery.
- A frozen kaiju takes volleys as if flanked.
- Helicopters can airlift Super Science gadgets into position.

Combos are a bonus. A single-faction team must still be able to win.

## Upgrades and drafts

At each molt, every player drafts one upgrade from an offer of three, so a full match gives each player two upgrades.

- Each human drafts a small upgrade for their own squad. The kaiju drafts one big mutation.
- Offers are equal for both sides, whatever happened in the stage before.
- Half the pool is general and half is specific to a kaiju or faction. Every offer shows at least one of each.
- Upgrades change rules instead of adding raw stats.
- Upgrades are visible. Mutations show on the kaiju's body, and new equipment shows on units, so each side can read the other's pick.
- Upgrade cards are short looping animations of the effect, with no text.
- Starting pool: about six general upgrades, plus three per kaiju and three per faction.

| Side | Upgrade | Effect |
| --- | --- | --- |
| Kaiju | Magnetic hide | Thrown tanks stick to the kaiju as armor |
| Kaiju | Tail club | Strikes also hit behind, punishing flankers |
| Kaiju | Stubby wings | One clumsy hop over a firing line |
| Kaiju | Acid spit | Puddles that block streets |
| Human | Tow cables | Aircraft can trip the kaiju |
| Human | Inflatable decoy kaiju | A lure |
| Human | Insurance rider | The first landmark destroyed adds nothing to the bar |

## The city

The game ships with one handcrafted city that both sides fight over and through.

- **Nested bounds.** The playable area widens at each stage: neighborhood, then district, then whole city. The starting neighborhood is random each match.
- **Destruction.** Buildings break into pre-made chunks instead of using full physics simulation.
- **Rubble.** Destroyed ground turns flat grey, adds nothing more to the bar, and works as a safe backstop.
- **Small breakables.** Cars, kiosks and houses count toward the bar, so the hatchling has things to wreck.
- **Cover.** Intact buildings block sightlines and shots. The kaiju can use them as shields, and removes them as it goes.
- **Open ground.** Parks and the river give the humans places to fight where misses cost nothing.
- **Civilians.** Tiny sprites that flee. No gore, and no effect on play in base mode.

## Presentation

No player should ever have to read a full sentence to play. Spoken dialog is the one place full sentences belong.

**The no-reading rule.** On-screen text is limited to kaiju and faction names and to subtitles. Everything else uses icons, bars, button glyphs and small illustrations.

| Element | Form |
| --- | --- |
| Kaiju and faction select | Portrait, name and three stat bars |
| Commands | Radial wheel of pictograms with button icons |
| Destruction bar | A skyline silhouette that crumbles as it fills, with three towers as the marks |
| Upgrade cards | Looping animation of the effect |
| Tutorial | Playable briefing with ghost demonstrations |
| End screen | Pictogram tally of the buildings each player flattened, and the front-page photo over squiggle newsprint |

**Voice.** Radio chatter and briefings are in English, spoken by generated voices, with subtitles. The delivery is deadly serious.

**Visual style.**

- **World.** 1990s arcade low-poly: flat shading, saturated colors, low-resolution textures. Soldiers and civilians are flat 2D sprites.
- **Effects.** A model-city look: sparkler explosions, buildings that crumble like plaster, jets that wobble as if on wires.
- **Sky and targeting.** Dramatic clouds and thin, clean targeting graphics in the style of Ace Combat.
- **Time of day.** Afternoon, then sunset, then night with fires, searchlights and tracers.
- **Color language.** Humans cyan, kaiju orange, charging volleys yellow, rubble grey. Each color is doubled by a shape for colorblind players.
- **Projectiles.** Big, slow and glowing, so both sides can read and dodge them.
- **Scale.** Street clutter sells size at hatchling scale. Haze and distance sell it at titan scale.

**Audio.** Choir and orchestra that swell with each stage, and one signature roar per kaiju.

**Wrapper.** A briefing before the match, radio chatter during, and a mock hearing and newspaper front page after.

## Platform and networking

Multiplayer starts on Colyseus or a similar game-server framework, with the server as the single source of truth.

- **Server-owned state.** The destruction bar, building states, health, nerve and the clock live on the server.
- **Joining.** Friends join a private room by invite code.
- **Input.** Controller, or mouse and keyboard. Button glyphs match the device in use.
- **Destruction sync.** This is the main technical risk. Pre-made chunks let the server send one state change per building instead of syncing physics.
- **Crowds.** A thousand soldiers on screen must run smoothly, which is why soldiers are sprites.
- **Progression.** Everything is unlocked from the start. Only callsigns and cosmetics are earned.

## Scope

The prototype is one kaiju against four Army squads, built only to prove that stomping and volleying are fun. The MVP is four kaiju and four factions.

| Feature | Prototype | MVP |
| --- | --- | --- |
| Kaiju | Lizard | Lizard, Crab, Burrower, Moth |
| Factions | Army | Army, Air, Super Science, Coalition of Faiths |
| Human squads | Four, bots filling gaps | Four per kaiju, bots filling gaps |
| Stages | Two (proposed) | Three |
| Drafts | None | About six general upgrades, plus three per kaiju and faction |
| Modes | Base mode | Base mode, plus kaiju vs kaiju (to confirm) |
| Presentation | Grey-box art, icons only | Full visual style, voiced chatter, end screen |

The prototype passes if both sides ask for a rematch after a session.

## Open questions

- [ ] What is the game called?
- [ ] With two or more kaiju, do they share one destruction bar or compete?
- [ ] Does the prototype run two stages or all three?
- [ ] Does the first build run in a browser or as a desktop app?
- [ ] Is kaiju vs kaiju part of the MVP or a later mode?
- [ ] Are the proposed Coalition of Faiths mechanics right?
- [ ] How often can the kaiju eat to heal, and what limits it?
- [ ] Are call-ins limited per player or shared by the team?
- [ ] What are the four kaiju named?
