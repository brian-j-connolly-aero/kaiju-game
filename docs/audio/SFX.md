# Monster Battle 9001: Sound Effects

Every sound effect in the game (Tier 1, and the kaiju and factions of Tier 2), what it is for,
and how it was checked. This file is written by `tools/audio/sfx/build.sh`; change the
generators, not this file. What the game code still has to do with these sounds is listed in
`docs/audio/client-notes-sfx.md`.

## What is here

- **91 sounds, 129 variants**, each as `.ogg` (Vorbis) and `.mp3`, 44.1 kHz, in
  `client/public/assets/audio/sfx/`. Total size 8.2 MB for both formats together.
- `client/public/assets/manifest.sfx.json`: the partial manifest (section `"sfx"`). Run
  `npm run assets:manifest` to merge it into `manifest.json`.
- Everything is synthesized from code: no samples, no recordings, nothing to license.

## How to rebuild

```
tools/audio/sfx/build.sh                 # everything: synthesis, both encodings, manifest, checks, pictures, this file
tools/audio/sfx/build.sh 'explosion_*'   # only the sounds that match
tools/audio/sfx/build.sh --no-verify     # skip the checks and pictures
```

It needs the asset tools (`tools/setup-asset-tools.sh`): Python with numpy, scipy, soundfile and
pillow, and `ffmpeg`. A full build takes about a minute and a half on four cores. The build is seeded, so
the same code gives the same sounds. Intermediate WAV files go to `/tmp/mb-scratch/sfx/`.

Source layout (`tools/audio/sfx/mbsfx/`): `dsp.py` (noise, filters, oscillators, envelopes,
synthetic impulse responses, limiter), `parts.py` (shared building blocks: thumps, bursts,
whooshes, debris, crackle), `kaiju.py`, `humans.py`, `world.py`, `ui.py`, `tier2.py` (one small
function per sound), `master.py` (levels, fades, loop layout, encoding), `analyze.py` (the checks
and pictures), `docgen.py` (this file).

## For whoever wires these into the game

- **Names.** A sound marked with variants has files `<id>_1`, `<id>_2`, `<id>_3`; pick one at
  random each time. A sound with one variant is just `<id>`. The manifest lists the paths.
- **Levels are already mixed.** `gain` is 1 for everything: a footstep is already quieter than an
  explosion, an ambience already sits under both. Scale whole groups in the mixer, not files.
  A sound that holds for seconds sits under the voice lines: the beam loop is 3 dB quieter than
  it first was, and the charging tone, which has to be noticed, 6 dB louder. Both changes are
  in the files.
- **Mono and stereo.** Sounds that happen at a place in the world are mono, ready for a
  positional panner. Stereo is used for ambiences, stings, and the set pieces (every roar, the
  molt blast, the death, the Ark opening); those stay intact when summed to mono.
- **One-shots start on the first sample.** An impact is at time zero, so trigger it on the
  frame of the hit. That includes the molt blast: trigger it on the blast frame, as the cocoon
  music stops. Where a sound leads up to its moment, the "loudest at" column says how long
  before the moment to start it: the swipes, `jet_flyby` (1.2 s), `generator_overload` (2.2 s)
  and `relic_open` (1.9 s).
- **Loops.** A loop file is `[0.25 s lead-in][loop body][0.25 s pad]`, the same layout as the
  music. Play from the start and loop between the two times in the manifest (`loop: [start, end]`,
  in seconds). The lead-in is the end of the body faded in and the pad is its beginning, so the
  audio repeats exactly on both sides of both loop points, and a decoder that shifts the audio by
  a few milliseconds still loops cleanly. Playing from 0 gives a 0.17 s fade-in; to start at full
  level instead (the beam after its wind-up), start playback at the loop start, 0.25 s in.
- **Playback rate.** `kaiju_hurt` is one size of animal: play it at about 1.2, 1.0 and 0.8 for
  stages 1, 2 and 3. `laser_charge_loop` is meant to rise with the charge, from 1.0 at empty to
  1.5 at full; `volley_ready` starts on the pitch the loop has reached by then and locks a
  fourth above it. `tank_engine_loop`, `heli_loop` and `drone_loop` speed up with the vehicle.
- **In tune with the music.** The three `bell` variants are three bells (D, F and A, the home
  chord of the score), so picking one at random is right and several trucks ring a chord.
  `chant_loop` is eight beats at the music's 96 beats a minute, in its key: start it on a beat
  of the stage music where that is easy. `relic_open` ends on the only major chord in the game.

## The signature roar

One voice model makes all three roars, and also the hurt, stagger, brace, eating and death
sounds, so everything the Lizard utters is the same animal. The roar has three parts, in the
same proportions at every stage: a **rise** (the growl climbs and the mouth opens), a **tear**
(the full-throated scream, ripped into pulses, with a metallic screech on top) and a **falling
rumble** (everything slides down into a long low growl). Three layers: a growl (a sawtooth with
vibrato and a subharmonic, through moving formant filters), a scream (noise through moving
band-passes) and a screech (a cluster of inharmonic partials, like bowed metal). Each stage is
longer and lower, with a bigger space around it. See `docs/audio/sfx/roar_contour.png`.

| Stage | Length (s) | Spectral centroid (Hz) | Share of energy below 120 Hz | Loudness (dB) |
| --- | --- | --- | --- | --- |
| 1 | 1.67 | 1625 | 11% | -15.2 |
| 2 | 3.25 | 1093 | 34% | -13.7 |
| 3 | 5.31 | 866 | 42% | -12.2 |

The three parts, measured on the decoded files (the build fails unless the tear is the loudest and
brightest part and the fall carries the most bass):

| Stage | Part | Length (s) | Loudness (dB) | Spectral centroid (Hz) | Share of energy below 120 Hz |
| --- | --- | --- | --- | --- | --- |
| 1 | rise | 0.29 | -18.9 | 550 | 6% |
|  | tear | 0.47 | -15.5 | 2620 | 4% |
|  | fall | 0.55 | -20.6 | 682 | 31% |
| 2 | rise | 0.53 | -17.9 | 418 | 36% |
|  | tear | 0.86 | -14.0 | 1829 | 16% |
|  | fall | 1.01 | -18.5 | 449 | 60% |
| 3 | rise | 0.81 | -17.0 | 323 | 54% |
|  | tear | 1.33 | -12.7 | 1376 | 24% |
|  | fall | 1.55 | -17.4 | 409 | 61% |

## The other three roars (Tier 2)

Every kaiju has its own signature. All four follow one plan, so the game treats them alike:
three parts in fixed proportions, the same length at each stage, the same loudness at each
stage, and the same streets to echo in. What tells the animals apart is what the roar is made of:

- **Krabulon, the Crab** (`kaiju_roar_crab_s1..s3`, picture `roar_contour_crab.png`). **Clatter**:
  the two claws clack in turn, left and right, faster and faster, over a low breath being drawn.
  **Bellow**: a hollow two-note honk, rasped into pulses like a file dragged over the shell; the
  shell's resonances stay where they are, where the Lizard's mouth moves. **Hiss**: steam and
  foam let go, with bubbles popping in it.
- **Drillmaw, the Burrower** (`kaiju_roar_burrower_s1..s3`, picture `roar_contour_burrower.png`).
  **Rumble**: it is still under the ground, and everything is muffled. **Bore**: it breaks the
  surface, and the drill and its whine climb all the way through. This roar winds up where the
  Lizard's sinks. **Grind-down**: the drill runs down through gravel.
- **Vespera, the Moth** (`kaiju_roar_moth_s1..s3`, picture `roar_contour_moth.png`). **Flutter**:
  wingbeats, puffs of air. **Shriek**: two reedy tones scraped like an insect's wing, trilled,
  high above everything else in the game. **Shimmer**: the shriek slides down, its trill
  breaking into single chirps, while scale dust falls.

All four at a glance (the Lizard is repeated for comparison):

| Kaiju | Stage | Length (s) | Spectral centroid (Hz) | Share of energy below 120 Hz | Loudness (dB) |
| --- | --- | --- | --- | --- | --- |
| Gragnor, the Lizard | 1 | 1.67 | 1625 | 11% | -15.2 |
|  | 2 | 3.25 | 1093 | 34% | -13.7 |
|  | 3 | 5.31 | 866 | 42% | -12.2 |
| Krabulon, the Crab | 1 | 1.65 | 870 | 5% | -15.1 |
|  | 2 | 3.15 | 657 | 18% | -13.6 |
|  | 3 | 5.16 | 489 | 35% | -12.1 |
| Drillmaw, the Burrower | 1 | 1.65 | 625 | 23% | -15.2 |
|  | 2 | 3.24 | 532 | 41% | -13.7 |
|  | 3 | 5.25 | 478 | 44% | -12.1 |
| Vespera, the Moth | 1 | 1.59 | 3435 | 0% | -15.2 |
|  | 2 | 3.10 | 2676 | 2% | -13.8 |
|  | 3 | 5.08 | 2091 | 10% | -12.2 |

The three parts of each, measured on the decoded files. The build fails unless, for the Crab, the bellow is
the loudest part, the hiss the brightest and the clatter the quietest; for the Burrower, the bore is the
loudest and the rumble the darkest, with the most bass; for the Moth, the shriek is the loudest and
brightest and the flutter the darkest.

| Kaiju | Stage | Part | Length (s) | Loudness (dB) | Spectral centroid (Hz) | Share of energy below 120 Hz |
| --- | --- | --- | --- | --- | --- | --- |
| Krabulon, the Crab | 1 | clatter | 0.26 | -25.9 | 687 | 2% |
|  |  | bellow | 0.62 | -15.5 | 733 | 4% |
|  |  | hiss | 0.42 | -19.6 | 1706 | 5% |
|  | 2 | clatter | 0.48 | -24.7 | 434 | 16% |
|  |  | bellow | 1.15 | -14.4 | 571 | 17% |
|  |  | hiss | 0.77 | -17.9 | 1050 | 28% |
|  | 3 | clatter | 0.74 | -23.3 | 346 | 39% |
|  |  | bellow | 1.78 | -13.1 | 423 | 34% |
|  |  | hiss | 1.18 | -16.7 | 806 | 40% |
| Drillmaw, the Burrower | 1 | rumble | 0.32 | -24.7 | 161 | 41% |
|  |  | bore | 0.59 | -16.0 | 493 | 22% |
|  |  | grind-down | 0.39 | -19.9 | 987 | 18% |
|  | 2 | rumble | 0.60 | -23.7 | 129 | 69% |
|  |  | bore | 1.08 | -15.4 | 492 | 42% |
|  |  | grind-down | 0.72 | -18.1 | 723 | 29% |
|  | 3 | rumble | 0.92 | -22.5 | 152 | 62% |
|  |  | bore | 1.67 | -14.2 | 457 | 46% |
|  |  | grind-down | 1.11 | -16.7 | 587 | 37% |
| Vespera, the Moth | 1 | flutter | 0.26 | -24.8 | 865 | 1% |
|  |  | shriek | 0.59 | -15.7 | 3701 | 0% |
|  |  | shimmer | 0.45 | -22.0 | 2744 | 0% |
|  | 2 | flutter | 0.48 | -22.9 | 748 | 14% |
|  |  | shriek | 1.08 | -14.2 | 2962 | 1% |
|  |  | shimmer | 0.84 | -19.7 | 2150 | 4% |
|  | 3 | flutter | 0.74 | -20.9 | 486 | 22% |
|  |  | shriek | 1.67 | -12.9 | 2393 | 9% |
|  |  | shimmer | 1.29 | -17.8 | 1577 | 9% |

How alike two roars are, as a number: each roar is reduced to a coarse picture (energy in 28 frequency bands
over 40 steps of its length) and the pictures are correlated. 1 means the same sound. Two roars always
share an outline (they swell, hold and die away, and end darker than they began), so unrelated roars still
score about 0.5 to 0.8. The build fails if two kaiju at the same stage score above 0.93.

| Stage | Lizard and Crab | Lizard and Burrower | Lizard and Moth | Crab and Burrower | Crab and Moth | Burrower and Moth |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.76 | 0.70 | 0.68 | 0.83 | 0.65 | 0.55 |
| 2 | 0.77 | 0.75 | 0.75 | 0.86 | 0.73 | 0.67 |
| 3 | 0.78 | 0.78 | 0.74 | 0.88 | 0.74 | 0.74 |

For comparison, one kaiju against itself at another stage:

| Kaiju | Stage 1 and 2 | Stage 2 and 3 | Stage 1 and 3 |
| --- | --- | --- | --- |
| Gragnor, the Lizard | 0.95 | 0.97 | 0.91 |
| Krabulon, the Crab | 0.95 | 0.96 | 0.91 |
| Drillmaw, the Burrower | 0.97 | 0.98 | 0.96 |
| Vespera, the Moth | 0.71 | 0.77 | 0.60 |

## The sounds

Lengths are of the encoded files. "Loudest at" is where the sound peaks, counted from its start.

### Kaiju

| Sound | Variants | Length (s) | Channels | Loop (s) | Loudest at (ms) | Intended use |
| --- | --- | --- | --- | --- | --- | --- |
| `kaiju_roar_lizard_s1` | 1 | 1.67 | stereo |  | 234 | Roar action at stage 1. The Lizard's signature: rise, tear, falling rumble. |
| `kaiju_roar_lizard_s2` | 1 | 3.25 | stereo |  | 1579 | Roar action at stage 2. The Lizard's signature: rise, tear, falling rumble. |
| `kaiju_roar_lizard_s3` | 1 | 5.31 | stereo |  | 2714 | Roar action at stage 3. The Lizard's signature: rise, tear, falling rumble. |
| `kaiju_step_s1` | 3 | 0.24 to 0.26 | mono |  | 8 to 18 | Each footfall at stage 1: a heavy thud with claw ticks. |
| `kaiju_step_s2` | 3 | 0.94 to 1.02 | mono |  | 12 to 24 | Each footfall at stage 2: a boom that cracks the road. |
| `kaiju_step_s3` | 3 | 2.22 to 2.45 | mono |  | 21 to 116 | Each footfall at stage 3: a seismic boom with a long ground shake. |
| `kaiju_stomp_s1` | 1 | 1.05 | mono |  | 7 | Stomp impact at stage 1: boom, ground crack and the shockwave rolling outward. |
| `kaiju_stomp_s2` | 1 | 1.90 | mono |  | 8 | Stomp impact at stage 2: boom, ground crack and the shockwave rolling outward. |
| `kaiju_stomp_s3` | 1 | 3.63 | mono |  | 178 | Stomp impact at stage 3: boom, ground crack and the shockwave rolling outward. |
| `kaiju_swipe_s1` | 1 | 0.42 | mono |  | 111 | Swipe at stage 1: claws through the air. Start it about 0.11 s before the hit frame. |
| `kaiju_swipe_s2` | 1 | 0.69 | mono |  | 186 | Swipe at stage 2: claws through the air. Start it about 0.17 s before the hit frame. |
| `kaiju_swipe_s3` | 1 | 1.06 | mono |  | 348 | Swipe at stage 3: claws through the air. Start it about 0.28 s before the hit frame. |
| `kaiju_grab` | 1 | 0.49 | mono |  | 139 | Grab: the claw closes on a car, wreck or chunk. |
| `kaiju_throw` | 1 | 0.85 | mono |  | 203 | Throw: the heave and the object leaving the hand. |
| `kaiju_eat` | 1 | 1.95 | mono |  | 1057 | Eat (2 s, rooted): three crunching bites and a swallow. |
| `kaiju_brace` | 1 | 0.95 | mono |  | 8 | Brace: plates lock and the animal digs in with a low growl. |
| `kaiju_hurt` | 3 | 0.86 to 1.05 | mono |  | 68 to 377 | Kaiju takes a heavy hit: a short pained bark. Shift the playback rate by stage (about 1.2, 1.0, 0.8). |
| `kaiju_stagger` | 1 | 2.46 | mono |  | 446 | Nerve breaks: a crack, then a long dizzy groan as the weak point opens. |
| `kaiju_beam_charge` | 1 | 0.86 | mono |  | 756 | Beam wind-up (0.8 s): rising whine and crackle; start kaiju_beam_loop when it ends. |
| `kaiju_beam_loop` | 1 | 2 per pass (2.50 file) | mono | 0.25 to 2.25 |  | Beam held (3 s): a roaring, buzzing stream. Loop while the beam fires. It holds for three seconds, so it sits 2 dB under the voice lines, not at the level of an explosion. |
| `kaiju_heartbeat_loop` | 1 | 1.68 per pass (2.18 file) | mono | 0.25 to 1.93 |  | Cocoon (10 s): loud heartbeat, falls off with distance. Two beats per pass. |
| `kaiju_molt_blast` | 1 | 4.04 | stereo |  | 39 | The cocoon bursts: the blast wave (led in by 0.03 s of air rushing inward), shell fragments, and the bigger animal's first breath. Trigger it on the blast frame, the instant the cocoon music stops. |
| `kaiju_death` | 1 | 5.78 | stereo |  | 2900 | The kaiju dies: the roar breaks up as it sinks, then the body hits the ground. |

### Humans

| Sound | Variants | Length (s) | Channels | Loop (s) | Loudest at (ms) | Intended use |
| --- | --- | --- | --- | --- | --- | --- |
| `rocket_launch` | 3 | 0.98 | mono |  | 4 to 6 | Rocket infantry fires: tube pop, ignition, the hiss of the motor leaving. |
| `tank_fire` | 3 | 1.08 to 1.12 | mono |  | 22 to 37 | Tank main gun: crack, boom, the breech ringing, and the report rolling off the buildings. |
| `shell_whoosh` | 1 | 0.75 | mono |  | 344 | A shell or rocket passes close by (the kaiju's ear, or a near miss). |
| `arty_incoming` | 1 | 1.81 | mono |  | 1709 | Artillery shell coming down: a falling whistle that swells until impact (play an explosion as it ends). |
| `arty_distant` | 1 | 2.97 | mono |  | 922 | Off-map battery firing when a call-in is placed: muffled thumps from beyond the city, 4 s before impact. |
| `laser_charge_loop` | 1 | 1 per pass (1.50 file) | mono | 0.25 to 1.25 |  | A sub-unit holding fire and charging: thin electric tone. Raise the playback rate with the charge (1.0 at empty to 1.5 at full, where volley_ready takes over from the same pitch), then keep it at about a third of the level for as long as the charge is held. |
| `volley_ready` | 1 | 0.46 | mono |  | 93 | A sub-unit reaches full charge (the yellow diamond fills): the charging tone whips upward and locks, with a hard tick, into a ringing open fifth. The lock is 0.09 s in. |
| `volley_fire` | 1 | 0.88 | mono |  | 7 | The player triggers a charged volley: a hard crack and rising rush under the salvo itself. |
| `tank_engine_loop` | 1 | 2 per pass (2.50 file) | mono | 0.25 to 2.25 |  | Tank idling and driving (positional). Raise the playback rate with speed (1.0 to about 1.4). |
| `march_loop` | 1 | 2 per pass (2.50 file) | mono | 0.25 to 2.25 |  | Infantry section moving: boots in step at 120 paces a minute with a little gear rattle (positional). |
| `unit_destroyed` | 3 | 1.15 to 1.39 | mono |  | 7 to 35 | A human unit is wiped out: blast, sparkler crackle and metal coming down. |
| `member_down` | 3 | 0.31 to 0.40 | mono |  | 4 to 8 | A unit loses a member (a soldier or one tank of a troop): dull hit, kit clattering, a short falling tone. |
| `shaken` | 1 | 0.95 | mono |  | 98 | A unit's nerve breaks (shaken for 4 s): a wavering, sinking tone with a rattle under it. |
| `takeover` | 1 | 0.62 | mono |  | 158 | The player takes over a surviving sub-unit: swish, click, two rising notes. |

### World

| Sound | Variants | Length (s) | Channels | Loop (s) | Loudest at (ms) | Intended use |
| --- | --- | --- | --- | --- | --- | --- |
| `explosion_s` | 3 | 0.70 to 0.72 | mono |  | 3 to 20 | Explosion, small: rocket hits, small blasts. Boom first, sparkler crackle over and after it. |
| `explosion_m` | 3 | 1.29 to 1.31 | mono |  | 3 to 63 | Explosion, medium: tank shells, thrown cars, vehicles. Boom first, sparkler crackle over and after it. |
| `explosion_l` | 3 | 2.41 to 2.44 | mono |  | 41 to 101 | Explosion, large: artillery, building-sized blasts. Boom first, sparkler crackle over and after it. |
| `structure_hit` | 3 | 0.52 to 0.55 | mono |  | 3 to 7 | A shot or claw hits a building that stays up: smack, plaster crack, a sprinkle of bits. |
| `crumble_s` | 3 | 0.82 to 0.83 | mono |  | 4 to 7 | Collapse of small structures (houses, kiosks): plaster cracking, gravel, chunks knocking down. |
| `crumble_m` | 3 | 1.84 to 1.92 | mono |  | 5 to 19 | Collapse of medium structures (shops, apartments): plaster cracking, gravel, chunks knocking down. |
| `crumble_l` | 3 | 3.75 to 3.84 | mono |  | 10 to 97 | Collapse of towers and landmarks: plaster cracking, gravel, chunks knocking down. |
| `glass` | 3 | 0.56 to 0.57 | mono |  | 9 to 86 | Windows and glass fronts shattering. |
| `car_crush` | 3 | 0.69 to 0.72 | mono |  | 9 to 126 | A car is stepped on, swiped or thrown into something. |
| `prop_break` | 3 | 0.28 to 0.33 | mono |  | 3 to 3 | Street furniture breaks: kiosk, lamp, bench, hydrant, tree. |
| `splash` | 1 | 1.33 | mono |  | 13 | Something heavy goes into the river or the bay. |
| `fire_loop` | 1 | 4 per pass (4.50 file) | mono | 0.25 to 4.25 |  | Burning rubble and vehicles (positional, mostly at night). |
| `crowd_panic_loop` | 1 | 6 per pass (6.50 file) | stereo | 0.25 to 6.25 |  | Civilians fleeing: distant shouting and screaming, no words. Bed under stage 1 and 2 street scenes. |
| `siren_loop` | 1 | 3 per pass (3.50 file) | mono | 0.25 to 3.25 |  | Emergency vehicles and the city alarm: one wail per pass (positional). |
| `amb_day_loop` | 1 | 16 per pass (16.50 file) | stereo | 0.25 to 16.25 |  | Stage 1 ambience (afternoon): city hum, passing traffic, birds. |
| `amb_sunset_loop` | 1 | 16 per pass (16.50 file) | stereo | 0.25 to 16.25 |  | Stage 2 ambience (sunset): thinner traffic, evening wind off the bay, a far foghorn, the first crickets. |
| `amb_night_loop` | 1 | 16 per pass (16.50 file) | stereo | 0.25 to 16.25 |  | Stage 3 ambience (night): crickets, a low electric city hum, far wind. |
| `wind_high_loop` | 1 | 10 per pass (10.50 file) | stereo | 0.25 to 10.25 |  | High-altitude wind for the stage 3 kaiju's head height and the pulled-back camera. |

### Interface and stings

| Sound | Variants | Length (s) | Channels | Loop (s) | Loudest at (ms) | Intended use |
| --- | --- | --- | --- | --- | --- | --- |
| `ui_click` | 1 | 0.06 | mono |  | 3 | Any button press. |
| `ui_hover` | 1 | 0.06 | mono |  | 3 | Pointer or stick moves onto a control (quiet). |
| `ui_ready` | 1 | 0.43 | mono |  | 89 | A player marks ready in the lobby: two rising notes. |
| `ui_error` | 1 | 0.30 | mono |  | 147 | Action not possible (cooldown, nothing in reach): two low buzzes. |
| `ui_wheel_open` | 1 | 0.22 | mono |  | 93 | The command wheel opens: four quick rising blips and a breath of air. |
| `ui_wheel_select` | 1 | 0.12 | mono |  | 3 | A command is chosen on the wheel: a decisive tock. |
| `ui_join` | 1 | 0.50 | mono |  | 80 | A player joins the room: a warm rising three-note figure. |
| `ui_tick` | 1 | 0.07 | mono |  | 3 | Countdown tick (last ten seconds, draft timer). |
| `ui_match_start` | 1 | 1.26 | stereo |  | 452 | The match begins: a rising arcade fanfare into a held D minor chord. |
| `radio_open` | 1 | 0.15 | mono |  | 100 | Radio channel opens before a voice line: key click and a rising burst of static. |
| `radio_close` | 1 | 0.24 | mono |  | 62 | Radio channel closes after a voice line: static tail, a short over-beep, key click. |
| `sting_crossfire` | 1 | 0.75 | stereo |  | 234 | Crossfire achieved (hits from two wide angles): a tick left, a tick right, then both land together. |
| `sting_nerve_break` | 1 | 1.06 | stereo |  | 37 | The kaiju's nerve breaks (stagger, weak point open): a crack like glass and a chord sliding down. |
| `sting_bar_mark` | 1 | 1.46 | stereo |  | 337 | The destruction bar passes a mark (a tower on the skyline falls): two heavy low brass hits and a bell. |
| `sting_molt_ready` | 1 | 2.00 | stereo |  | 10 | A molt is available to the kaiju: a double heartbeat and an eerie rising shimmer. |
| `camera_shutter` | 1 | 0.12 | mono |  | 12 | A reporter drone takes a photo: shutter open, mirror slap, shutter closed. |

### Tier 2: three more kaiju, three more factions

| Sound | Variants | Length (s) | Channels | Loop (s) | Loudest at (ms) | Intended use |
| --- | --- | --- | --- | --- | --- | --- |
| `kaiju_roar_crab_s1` | 1 | 1.65 | stereo |  | 440 | Roar action at stage 1. The Crab's signature: claws clatter, a hollow rasping bellow, a hiss of foam. |
| `kaiju_roar_crab_s2` | 1 | 3.15 | stereo |  | 1642 | Roar action at stage 2. The Crab's signature: claws clatter, a hollow rasping bellow, a hiss of foam. |
| `kaiju_roar_crab_s3` | 1 | 5.16 | stereo |  | 1979 | Roar action at stage 3. The Crab's signature: claws clatter, a hollow rasping bellow, a hiss of foam. |
| `kaiju_roar_burrower_s1` | 1 | 1.65 | stereo |  | 514 | Roar action at stage 1. The Burrower's signature: a rumble from below, a drill that spins up, grinding to a stop. |
| `kaiju_roar_burrower_s2` | 1 | 3.24 | stereo |  | 983 | Roar action at stage 2. The Burrower's signature: a rumble from below, a drill that spins up, grinding to a stop. |
| `kaiju_roar_burrower_s3` | 1 | 5.25 | stereo |  | 1731 | Roar action at stage 3. The Burrower's signature: a rumble from below, a drill that spins up, grinding to a stop. |
| `kaiju_roar_moth_s1` | 1 | 1.59 | stereo |  | 780 | Roar action at stage 1. The Moth's signature: wings flutter, a high trilling shriek, a falling shimmer. |
| `kaiju_roar_moth_s2` | 1 | 3.10 | stereo |  | 774 | Roar action at stage 2. The Moth's signature: wings flutter, a high trilling shriek, a falling shimmer. |
| `kaiju_roar_moth_s3` | 1 | 5.08 | stereo |  | 1364 | Roar action at stage 3. The Moth's signature: wings flutter, a high trilling shriek, a falling shimmer. |
| `burrow_loop` | 1 | 3 per pass (3.50 file) | mono | 0.25 to 3.25 |  | The Burrower travelling underground (positional, over the seismograph ring): the same drill as its roar, heard through the earth. |
| `gust` | 1 | 1.51 | mono |  | 256 | The Moth's wing gust that shoves units: the wing comes down, a wall of air goes past, grit follows. |
| `drone_loop` | 1 | 2 per pass (2.50 file) | mono | 0.25 to 2.25 |  | A drone hovering or flying, including the reporters' camera drones (positional): four small rotors beating against each other. Raise the playback rate with speed (1.0 to about 1.3). |
| `heli_loop` | 1 | 2 per pass (2.50 file) | mono | 0.25 to 2.25 |  | A helicopter in flight (positional): blade slap eleven times a second, rotor wash, turbine whine, tail rotor buzz. |
| `jet_flyby` | 1 | 4.22 | mono |  | 1451 | A pair of jets on a strafing pass: the whine comes in high, drops as they go over, and the roar rolls away behind them. Start it about 1.2 s before they cross the target. |
| `freeze_ray` | 1 | 1.24 | mono |  | 215 | A lab coat fires a prototype freeze ray: the emitter chirps, the beam tone slides down as its flutter slows, and frost crackles and rings where it lands. |
| `dish_beam_loop` | 1 | 2 per pass (2.50 file) | mono | 0.25 to 2.25 |  | A beam-dish truck holding its beam on the kaiju (positional): transformer hum, one unwavering tone, the air sizzling. Beams never scatter, so nothing in it wavers. |
| `generator_overload` | 1 | 2.88 | mono |  | 2205 | A Super Science generator runs away: the whine climbs faster and faster, arcs jump, the breaker blows. Start it 2.2 s before the generator goes up and play explosion_l as the breaker blows. |
| `chant_loop` | 1 | 5 per pass (5.50 file) | mono | 0.25 to 5.25 |  | A Coalition unit charging a chanted volley (positional): a wordless chant, eight beats at the music's 96 beats a minute, in its key. Play one per charging unit, started on the beat: the more units, the bigger the choir. |
| `bell` | 3 | 2.63 to 3.05 | mono |  | 4 to 33 | A bell truck rings: one heavy bronze bell. The three variants are tuned D, F and A (the music's home chord), so several trucks together ring in tune with the score. |
| `relic_open` | 1 | 6.12 | stereo |  | 1943 | The pontiff opens the Ark: the lid grinds aside, voices and light swell, then the relic lets go. The blast is 1.9 s in: start it that long before the cone fires. |

## How it was verified

Nobody listened to these: they were checked by measurement and by reading spectrograms. Every
encoded file is decoded again with `ffmpeg` and measured; the numbers are in
`docs/audio/sfx/measurements.json` and the pictures in `docs/audio/sfx/`.

Checked on every file, in both formats:

- **Peak** below -1 dB full scale (worst file: -1.27 dB, `unit_destroyed_2.ogg`).
- **Loudness** within 1.5 dB of the sound's target, and variants of one sound within 1 dB of
  each other (largest spread: 0.14 dB, `car_crush`). Loudness is measured
  with the broadcast loudness weighting (K-weighting) over the loudest 200 ms of a one-shot, or
  over a whole pass of a loop.
- **No DC offset** (largest: 0.00079 of full scale).
- **No clicks at the ends**: a one-shot starts from silence or straight into its attack (its
  first samples are at least 10 dB below what follows within 10 ms, or 40 dB below the peak), and
  ends at least 40 dB below its peak.
- **On time**: a sound that is started on the frame of its event peaks at once
  (`kaiju_molt_blast`: 39 ms after its start, limit 60 ms).
- **Length and alignment** against the master: at most 0 samples of shift in either
  format. (`ffmpeg`'s Vorbis decoder returns some short files 128 samples short or up to 22 ms
  long; other decoders return the exact length. Either way only silence is affected: every
  one-shot ends with 6 ms of it, and the extra samples are zeros.)

Compared within families (average of the variants, `.ogg`):

| Family | Sound | Length (s) | Spectral centroid (Hz) | Loudness (dB) |
| --- | --- | --- | --- | --- |
| step | `kaiju_step_s1` | 0.25 | 349 | -22.6 |
|  | `kaiju_step_s2` | 0.97 | 195 | -19.1 |
|  | `kaiju_step_s3` | 2.31 | 147 | -16.6 |
| swipe | `kaiju_swipe_s1` | 0.42 | 3031 | -22.3 |
|  | `kaiju_swipe_s2` | 0.69 | 1432 | -19.3 |
|  | `kaiju_swipe_s3` | 1.06 | 582 | -16.1 |
| stomp | `kaiju_stomp_s1` | 1.05 | 372 | -16.5 |
|  | `kaiju_stomp_s2` | 1.90 | 220 | -15.1 |
|  | `kaiju_stomp_s3` | 3.63 | 165 | -12.5 |
| roar | `kaiju_roar_lizard_s1` | 1.67 | 1625 | -15.2 |
|  | `kaiju_roar_lizard_s2` | 3.25 | 1093 | -13.7 |
|  | `kaiju_roar_lizard_s3` | 5.31 | 866 | -12.2 |
| explosion | `explosion_s` | 0.70 | 963 | -18.1 |
|  | `explosion_m` | 1.30 | 450 | -15.1 |
|  | `explosion_l` | 2.42 | 288 | -12.6 |
| crumble | `crumble_s` | 0.83 | 3721 | -20.2 |
|  | `crumble_m` | 1.88 | 837 | -17.1 |
|  | `crumble_l` | 3.78 | 330 | -14.0 |
| roar_crab | `kaiju_roar_crab_s1` | 1.65 | 870 | -15.1 |
|  | `kaiju_roar_crab_s2` | 3.15 | 657 | -13.6 |
|  | `kaiju_roar_crab_s3` | 5.16 | 489 | -12.1 |
| roar_burrower | `kaiju_roar_burrower_s1` | 1.65 | 625 | -15.2 |
|  | `kaiju_roar_burrower_s2` | 3.24 | 532 | -13.7 |
|  | `kaiju_roar_burrower_s3` | 5.25 | 478 | -12.1 |
| roar_moth | `kaiju_roar_moth_s1` | 1.59 | 3435 | -15.2 |
|  | `kaiju_roar_moth_s2` | 3.10 | 2676 | -13.8 |
|  | `kaiju_roar_moth_s3` | 5.08 | 2091 | -12.2 |

Bigger must be longer, darker (lower spectral centroid: the "center of mass" of the spectrum)
and louder. All of these orderings are enforced by the build.

Cues that mean different things must not sound alike. The build compares a coarse picture of
each pair (energy in 28 frequency bands over time; 1 means the same sound, unrelated sounds are
near 0) and fails above the limit:

| Pair | Likeness | Limit |
| --- | --- | --- |
| `ui_ready` and `volley_ready` | 0.30 | 0.6 |

Loops, measured across the loop point as the game will play them:

| Loop | Format | Step | Onset (dB) | Repeat (dB) | Encoder error (dB) |
| --- | --- | --- | --- | --- | --- |
| `fire_loop` | ogg | 0.23 | -0.1 | -14 | -16 |
| `fire_loop` | mp3 | 0.08 | +0.0 | -16 | -18 |
| `crowd_panic_loop` | ogg | 0.69 | +0.3 | -18 | -20 |
| `crowd_panic_loop` | mp3 | 0.01 | -0.0 | -31 | -34 |
| `siren_loop` | ogg | 0.35 | +0.0 | -39 | -40 |
| `siren_loop` | mp3 | 0.32 | +0.0 | -33 | -37 |
| `amb_day_loop` | ogg | 0.22 | +0.0 | -20 | -23 |
| `amb_day_loop` | mp3 | 0.05 | +0.0 | exact | -32 |
| `amb_sunset_loop` | ogg | 0.28 | +0.5 | -21 | -24 |
| `amb_sunset_loop` | mp3 | 0.01 | +0.0 | exact | -41 |
| `amb_night_loop` | ogg | 0.04 | +0.2 | -25 | -28 |
| `amb_night_loop` | mp3 | 0.02 | +0.0 | exact | -40 |
| `wind_high_loop` | ogg | 0.76 | -0.0 | -20 | -23 |
| `wind_high_loop` | mp3 | 0.26 | -0.0 | -46 | -49 |
| `laser_charge_loop` | ogg | 0.94 | +0.1 | -39 | -40 |
| `laser_charge_loop` | mp3 | 0.85 | +0.0 | -40 | -43 |
| `tank_engine_loop` | ogg | 1.00 | -0.1 | -23 | -26 |
| `tank_engine_loop` | mp3 | 1.11 | -0.0 | -38 | -41 |
| `march_loop` | ogg | 0.00 | +0.0 | -19 | -21 |
| `march_loop` | mp3 | 0.00 | -0.2 | -23 | -26 |
| `kaiju_beam_loop` | ogg | 0.05 | +0.1 | -13 | -15 |
| `kaiju_beam_loop` | mp3 | 0.23 | +0.3 | -15 | -18 |
| `kaiju_heartbeat_loop` | ogg | 0.00 | -0.1 | -26 | -30 |
| `kaiju_heartbeat_loop` | mp3 | 0.02 | +0.0 | -53 | -56 |
| `burrow_loop` | ogg | 0.79 | -0.1 | -21 | -24 |
| `burrow_loop` | mp3 | 0.24 | +0.0 | -55 | -57 |
| `drone_loop` | ogg | 0.09 | +0.1 | -15 | -18 |
| `drone_loop` | mp3 | 0.26 | +0.2 | -20 | -23 |
| `heli_loop` | ogg | 0.14 | +0.0 | -16 | -18 |
| `heli_loop` | mp3 | 0.29 | -0.1 | -22 | -26 |
| `dish_beam_loop` | ogg | 0.51 | +0.0 | -20 | -24 |
| `dish_beam_loop` | mp3 | 0.51 | -0.0 | -33 | -36 |
| `chant_loop` | ogg | 0.49 | -0.1 | -27 | -30 |
| `chant_loop` | mp3 | 0.46 | -0.1 | -33 | -36 |

"Step" is the size of the jump between the last sample before the loop end and the first after
the loop start, compared with the ordinary sample-to-sample steps nearby (a click would be many
times larger than 1). "Onset" is how much sudden new energy appears at the splice compared with
playing straight on (0 dB: none). "Repeat" is how closely the audio around the loop end matches
the audio around the loop start; it is normally about as good as the encoder's own error, shown
beside it. "exact" means the two are identical sample for sample (the 16 s loops are a whole
number of MP3 blocks long, so the encoder makes the same decisions both times).

Pictures (decoded `.ogg` unless marked):

- `docs/audio/sfx/loop_seams_1.png`
- `docs/audio/sfx/loop_seams_2.png`
- `docs/audio/sfx/loop_seams_3.png`
- `docs/audio/sfx/roar_contour.png`
- `docs/audio/sfx/roar_contour_burrower.png`
- `docs/audio/sfx/roar_contour_crab.png`
- `docs/audio/sfx/roar_contour_moth.png`
- `docs/audio/sfx/sheet_humans_1.png`
- `docs/audio/sfx/sheet_humans_2.png`
- `docs/audio/sfx/sheet_kaiju_1.png`
- `docs/audio/sfx/sheet_kaiju_2.png`
- `docs/audio/sfx/sheet_kaiju_3.png`
- `docs/audio/sfx/sheet_tier2_1.png`
- `docs/audio/sfx/sheet_tier2_2.png`
- `docs/audio/sfx/sheet_ui_1.png`
- `docs/audio/sfx/sheet_ui_2.png`
- `docs/audio/sfx/sheet_world_1.png`
- `docs/audio/sfx/sheet_world_2.png`
- `docs/audio/sfx/sheet_world_3.png`
- `docs/audio/sfx/sheet_world_4.png`

## Known limits

- No one has heard these. The checks catch technical faults (clipping, clicks, bad loops, wrong length, wrong balance between families) and the spectrograms show that each sound has the intended shape, but whether a sound is pleasing or funny or tiring after an hour is a listening question. A first listening pass by a person is the most valuable next step.
- Large impacts (stage 3 steps and stomps, large explosions, tank guns) carry most of their energy below 120 Hz. They are built with harmonics and a noisy mid layer so they still read on laptop speakers, but they will be noticeably thinner there than on headphones.
- `crowd_panic_loop` is a cloud of synthetic vowel sounds. It reads as a distant crowd in a spectrogram; up close it may sound like a choir warming up. Keep it low in the mix.
- Ambience loops are 16 s long. The bird phrases and the far foghorn (sunset) repeat every pass; if that becomes noticeable, play them quieter or generate longer loops (one number in `world.py`).
- The hurt, stagger and death sounds exist at one size. The roar is the only utterance with a version per stage.
- The Tier 2 sounds were made from the design text, before the kaiju and units that use them exist in the game. Expect to adjust levels and lead times when they are wired in. The Crab, the Burrower and the Moth have a roar each and nothing else of their own yet: their hurt, stagger and death sounds are still the Lizard's.
- `chant_loop` and the voices in `relic_open` are synthetic singers on open vowels, with no words. Like the crowd, they read as a choir in a spectrogram and may sound like an organ stop up close.
- At stage 3 the Crab's and the Burrower's roars are dark sounds held at the same loudness as the others, which leaves their peaks little room: the limiter takes up to 4.0 dB off the loudest moments (`kaiju_roar_burrower_s3`, `kaiju_roar_crab_s3`). The pulses of those roars are a little flatter than designed; nothing clips.
