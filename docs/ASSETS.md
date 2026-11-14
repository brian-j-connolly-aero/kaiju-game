# Monster Battle 9001: Art and Audio Contract

What art and audio must deliver, in what format, under what names. Code and assets are built in
parallel against this contract; the game runs on procedural placeholders until a file lands, so
**names, node names, sizes and manifest entries here are binding**.

## 1. Tools on the build machine

Recreate with `tools/setup-asset-tools.sh` (keep that script current).

- Blender as a Python module: `/opt/mbtools/venv/bin/python` (`bpy` 5.2, plus numpy, scipy,
  pillow, mido, soundfile, pedalboard, pocketsphinx). Run scripts with that interpreter. glTF
  export works; Cycles on CPU renders previews (use absolute output paths).
- Audio: `fluidsynth` with `/usr/share/sounds/sf2/FluidR3_GM.sf2` (General MIDI: choir, strings,
  brass, timpani), `sox`, `ffmpeg` (Vorbis and MP3 encoders).
- Speech: `RHVoice-test` (voices alan, bdl, clb, slt), `flite` (rms, slt, awb, kal16),
  `pico2wave`, `festival` / `text2wave`, `espeak-ng`. No network speech services.
- Sources of truth are the generator scripts in `tools/art/` and `tools/audio/`. Outputs are
  committed under `client/public/assets/`. Everything must be reproducible by one script per
  family plus `tools/art/build_all.sh` and `tools/audio/build_all.sh`.

## 2. Visual style

1990s arcade low-poly seen through a model-city lens: flat shading, hard edges, saturated colors,
chunky silhouettes that read at a glance, tiny nearest-filtered textures. Buildings look like
painted plaster models; jets look like they hang on wires. Played straight: nothing winks.

Palette anchors: humans cyan `#1ec8e0`, kaiju orange `#ff7a1a`, volley yellow `#ffd91a`, rubble
grey `#8d8d94`, road `#2b3040`, sidewalk `#b9bcc6`, grass `#4fbf5f`, water `#2f7fd6`. Buildings
draw from about a dozen saturated-but-light tones (cream, salmon, sky blue, mint, mustard, brick,
slate, white, teal glass). Army is olive with cyan identification stripes. Each kaiju owns a warm
scheme: Gragnor burnt orange with rust stripes and a cream belly; Krabulon crimson; Drillmaw
ochre and purple-brown; Vespera amber and pink with glowing eyespots. A kaiju's weak point and
the light inside its cocoon glow violet-white `#c9a6ff`: never cyan or yellow, which belong to
the humans and to charging volleys.

## 3. Models (`client/public/assets/models/*.glb`)

- glTF binary, meters, Y up, origin at ground center, **facing +Z in glTF space** (which is
  facing -Y in Blender). Apply all transforms. Flat shading (split normals per face).
- Materials by name only, no embedded textures: `vcol` (lit, uses vertex color `COLOR_0`), `glow`
  (unlit emissive, vertex color: eyes, weak points, lights), `city_atlas` (lit, UVs into the
  shared city atlas). The client swaps in its own shared materials by these names.
- Paint mask (only on models whose manifest entry has `"tint"`: `prop_car_sedan`, `prop_car_van`,
  `prop_bus`, `prop_truck`, `prop_car_wreck`): the body paint is authored near-white and the
  **alpha of `COLOR_0`** says where it is: 1 = paint (multiply the tint color in), 0 = glass,
  tires, lights, trim (leave alone). It is a mask, not opacity: draw these with an opaque
  material. Buildings (`bld_*`, `lm_*`) whose manifest entry has `"tint"` use the same mask
  for wall plaster (`docs/art/CITY_ART.md`). Every other model has alpha 1 throughout.
- Animation is done in code. Models are **rigid segments under named nodes with pivots at the
  joints**; no armatures, no baked animation. Rest pose: neutral stance.
- Triangle budgets: kaiju stage 1 and 2 up to 2500, stage 3 up to 4000; vehicles up to 500;
  cars up to 150, other props up to 80; structures small up to 120, medium up to 250, large up
  to 500, landmarks up to 1500; each collapse chunk up to 30.

### Kaiju

Files `kaiju_<kind>_s<stage>.glb` for stages 1 to 3, authored at true size (heights 4.5, 32,
115 m for the lizard; later stages add spikes, scars and detail, they are not just scaled).

Lizard rig (`kind` = `lizard`), required nodes:

```
root
└ hips
  ├ torso
  │ ├ neck ─ head ─ jaw
  │ │         ├ cam_fp   (empty: first-person camera, between the eyes, looking +Z)
  │ │         └ mouth    (empty: beam origin)
  │ ├ arm_L ─ forearm_L ─ hand_L
  │ ├ arm_R ─ forearm_R ─ hand_R ─ hold (empty: held object anchor)
  │ ├ spines             (optional group)
  │ └ weak_point         (mesh, material glow; shown when staggered)
  ├ leg_L ─ shin_L ─ foot_L
  ├ leg_R ─ shin_R ─ foot_R
  └ tail_1 ─ tail_2 ─ tail_3 ─ tail_4 ─ tail_5
```

The snout and hands must be visible and good-looking from `cam_fp`. Also: `kaiju_cocoon.glb`
and `kaiju_egg.glb` (1 m tall, scaled in code). Tier 2 kinds (`crab`, `burrower`, `moth`) define
their own node lists in their manifest entries, always including `root`, `cam_fp`, `mouth`,
`hold` and `weak_point`.

### Army

- `army_tank.glb`: nodes `hull`, `turret` (yaw pivot), `barrel` (pitch pivot), `muzzle` (empty),
  `track_L`, `track_R`. `army_tank_wreck.glb`: one burnt mesh.
- Projectiles: `proj_rocket.glb`, `proj_shell.glb`, `proj_arty.glb` (tiny; glow comes from sprites).

### Tier 2 vehicles

`air_drone` (`body`, `rotor_1..4`), `air_heli` (`body`, `rotor_main`, `rotor_tail`, `gun`),
`air_jet`, `sci_dishtruck` (`hull`, `dish`, `emitter`), `sci_mech` (segmented, visibly
half-built), `faith_belltruck` (`hull`, `bell`), `faith_float`, `faith_ark` (`base`, `lid`).

### City

- Structure archetypes come from `shared/src/city/archetypes.ts` (exported as JSON for Blender
  by `npm run export:defs` to `tools/art/data/archetypes.json`): id, footprint, height, class.
  One file per archetype, `bld_<id>.glb`, and per landmark, `lm_<id>.glb`, each with nodes
  `intact`, `damaged` (same silhouette, holes, scorch, missing corners), `rubble` (low grey
  pile within the footprint), and `chunk_00`..`chunk_NN` (6 to 24 pieces that together
  approximate `intact`, each with its origin at its own center).
- Shared atlases: `textures/city_atlas.png` (facades, roofs, signs; low resolution, nearest
  filtering) and `textures/city_atlas_emissive.png` (same layout, lit windows and signs for night).
  1024 x 512, 16 px = 3 m; texture coordinates follow glTF (v = 0 at the top of the image).
  Buildings are made with the city kit (`tools/art/city/README.md`): one material
  (`city_atlas`) per building, sizes and states as in `docs/art/CITY_ART.md`.
- Props, one mesh each: `prop_car_sedan`, `prop_car_taxi`, `prop_car_van`, `prop_bus`,
  `prop_truck`, `prop_kiosk`, `prop_tree_a`, `prop_tree_b`, `prop_lamp`, `prop_trafficlight`,
  `prop_bench`, `prop_hydrant`, `prop_billboard`, `prop_busstop`, plus `prop_car_wreck`.
- Ground tiles (64 px, tiling): `textures/ground_asphalt.png`, `ground_sidewalk.png`,
  `ground_grass.png`, `ground_water.png`, `ground_rubble.png`, plus `ground_plaza.png` (the
  city's squares: big pale sandstone flags, 2 m each) and `ground_far.png` (the plain round the
  city out to the fog: muted grey-green, the quietest tile). **One tile covers 8 × 8 m** in
  the game, so a ground pixel is 12.5 cm (a character pixel is 6.9 cm): a paving slab is 8 px.
- Sky: `textures/clouds_a.png`, `clouds_b.png` (dramatic cumulus with alpha, 512 × 256 px).
  These are **horizon panoramas**, side views of clouds standing on the horizon: u runs around
  an upright ring (an open cylinder) centered on the camera, v runs up. They wrap left to right
  only; never lay them on a horizontal plane, never tile them vertically, and draw them
  without fog. Mapping, also carried in the manifest as `"ring"` (section 7): `clouds_a` 4
  repeats around the full circle, `clouds_b` 3 repeats and drawn behind it; each repeat keeps
  the picture's 2:1 shape (ring height = π × radius ÷ repeats); the bottom edge sits 5° below
  the horizon. Each painting has two clear gaps down to the horizon, one of them (`sunGap`)
  for the sunset sun. Details and review pictures: `tools/art/sprites/README.md`.

## 4. Sprites (`client/public/assets/sprites/`)

Pixel art, drawn by script. Sheets are grids of equal cells. Characters are flat billboards with
4 facings (front, left, back, right).

- `army.png`: `soldier_army_rocket`, `soldier_army_rifle` (24 × 32 px cells): idle 1, walk 4,
  fire 2 frames per facing, die 4 frames.
- `civilians.png`: 6 civilian variants: run 4 frames per facing, arms up.
- `fx.png`: sparkler explosion (8 frames), smoke puff (6), dust (6), spark, muzzle flash (3),
  debris bits (4 different chunks, one sprite each), soft glow, laser dot, shockwave ring,
  fire (6). 64 px cells. The explosion, fire and flash are full-color pictures for ordinary
  alpha blending; only glow, spark and laser dot are added (manifest field `"blend"`).
- `markers.png`: the world markers `mk_circle` (humans), `mk_triangle` (the kaiju), `mk_diamond`
  (a charging volley), `mk_chevron`, `mk_cross`, `mk_dot`, one 32 × 32 px cell each in one row
  (`worldHeight` 1). White with a see-through inside and a thin dark edge; the client tints
  each copy.
- Tier 2: `science.png` (lab coats with ray guns), `faith.png` (fictional clergy and choir
  members of many traditions, drawn with warmth and dignity), pilots are not needed.

## 5. UI art (`client/public/assets/ui/`)

Hand-written SVG, 64 × 64 viewBox, single color via `currentColor`, thick strokes, readable at
32 px and at the sizes the client really draws them (down to 18 px for button glyphs and bar
marks). No text inside icons. No third-party icon sets.

- Commands: `cmd_follow`, `cmd_moveto`, `cmd_fireatwill`, `cmd_holdcharge`.
- Kaiju verbs: `k_swipe`, `k_stomp`, `k_grab`, `k_throw`, `k_eat`, `k_brace`, `k_roar`,
  `k_special`, `k_molt`, `k_swim` (swimming: a row of spines over the waves; the HUD shows it
  while the kaiju is under water, and the controls card pairs it with deep water).
- Status: `st_health`, `st_nerve`, `st_rage`, `st_charge`, `st_reload` (one shell: the reload
  meter and the player's own shot), `st_veteran`, `st_spotted`, `st_crossfire`, `st_callin`,
  `st_shaken`, `st_map`, `st_camera`, `st_sun`, `st_moon`, `st_smoke` (a squad's smoke: a
  canister and its cloud), `st_mark` (mark the kaiju: the marker over a kaiju triangle).
- Lobby: `lb_kaiju`, `lb_human`, `lb_ready`, `lb_host`, `lb_bot`, `lb_link`, `lb_play`, `lb_back`,
  `lb_create`, `lb_join`.
- Factions: `fac_army`, `fac_air`, `fac_science`, `fac_faith`.
- Tally pictograms: `tl_car`, `tl_kiosk`, `tl_house`, `tl_shop`, `tl_apartment`, `tl_office`,
  `tl_tower`, `tl_factory`, `tl_bridge`, `tl_landmark`.
- Device glyphs: `kb_key` (blank keycap; the letter is added in code), `ms_left`, `ms_right`,
  `ms_middle`, `ms_move`, `gp_a`, `gp_b`, `gp_x`, `gp_y`, `gp_lb`, `gp_rb`, `gp_lt`, `gp_rt`,
  `gp_ls`, `gp_rs`, `gp_dpad` (no direction), `gp_dpad_up`, `gp_dpad_right`, `gp_dpad_down`,
  `gp_dpad_left` (one direction of the directional pad), `gp_start`, `gp_back`.
- System: `ui_offline`, `ui_warning`, `ui_copy` (this seat was opened somewhere else),
  `ui_skull` (eliminated), `ui_trophy`, `ui_clock` (time ran out), `ui_newspaper`, `ui_sound`,
  `ui_asleep` (a lobby seat the start no longer waits for: not ready after 20 s),
  `ui_outdated` (this page is from an older build than the server: reload it).
- Settings and the drone: `ui_settings` (the settings panel: a cog), `ui_invert` (turn the
  up-down look around), `ui_fullscreen`, `ui_lowres` (lower resolution for slow computers),
  `ui_rise` and `ui_sink` (the news drone up and down), `ui_controls` (open the controls card:
  a card with a key and a directional cross).
- `skyline.svg`: the destruction-bar skyline with three taller towers at 21%, 57% and 100%.
  viewBox 400 × 64, drawn to be stretched into the bar (560 × 46 px; the root carries
  `preserveAspectRatio="none"`). Two paths: `sky-city` (clip it from the left as the bar fills)
  and `sky-rubble` (what is left). Details: `docs/art/UI_ICONS.md`.
- Portraits (PNG, 512 px, rendered from the models): `portrait_<kaiju kind>.png`,
  `portrait_<faction>.png`.

## 6. Audio (`client/public/assets/audio/`)

Every sound ships as both `.ogg` (Vorbis) and `.mp3`, 44.1 kHz. Manifest entries name the path
without extension. Loops declare exact loop points in seconds so they are gapless either way.

### Music (`audio/music/`): choir and orchestra that swell with each stage

All in one key family and tempo grid so layers mix. Base and combat stems of a stage have the
same length and start together; the client fades the combat stem in when the fight is on.

`lobby` (brooding march, 60 to 90 s loop), `briefing` (tense bed, 20 s loop), `stage1_base` and
`stage1_combat` (sparse: low strings, snare, pizzicato, a hint of choir), `stage2_base` and
`stage2_combat` (full strings and brass, choir enters), `stage3_base` and `stage3_combat` (full
choir, orchestra, timpani), `cocoon` (eerie choir, about 12 s; it carries no heartbeat of its
own, because the heartbeat is the positional effect `kaiju_heartbeat_loop`), `intermission`
(build, 20 s), `win_humans` (fanfare, 10 to 15 s), `win_kaiju` (ominous choir, 10 to 15 s),
`hearing` (somber bureaucratic bed, 30 s loop).

### Sound effects (`audio/sfx/`), synthesized, punchy, with 2 to 3 variants where marked *

Kaiju: `kaiju_step_s1*`, `kaiju_step_s2*`, `kaiju_step_s3*`, `kaiju_swipe_s1..s3`,
`kaiju_stomp_s1..s3`, `kaiju_roar_lizard_s1..s3` (one signature roar, growing with stage),
`kaiju_grab`, `kaiju_throw`, `kaiju_eat`, `kaiju_brace`, `kaiju_hurt*`, `kaiju_stagger`,
`kaiju_beam_charge`, `kaiju_beam_loop`, `kaiju_heartbeat_loop`, `kaiju_molt_blast`, `kaiju_death`.

Humans: `rocket_launch*`, `tank_fire*`, `shell_whoosh`, `arty_incoming`, `arty_distant`,
`laser_charge_loop`, `volley_ready`, `volley_fire`, `tank_engine_loop`, `march_loop`,
`unit_destroyed*`, `member_down*`, `shaken`, `takeover`.

World: `explosion_s*`, `explosion_m*`, `explosion_l*`, `structure_hit*`, `crumble_s*`,
`crumble_m*`, `crumble_l*`, `glass*`, `car_crush*`, `prop_break*`, `splash`, `crowd_panic_loop`,
`siren_loop`, `fire_loop`, `amb_day_loop`, `amb_sunset_loop`, `amb_night_loop`, `wind_high_loop`.

UI: `ui_click`, `ui_hover`, `ui_ready`, `ui_error`, `ui_wheel_open`, `ui_wheel_select`,
`ui_join`, `ui_tick`, `ui_match_start`, `radio_open`, `radio_close`, `sting_crossfire`,
`sting_nerve_break`, `sting_bar_mark`, `sting_molt_ready`, `camera_shutter`.

Tier 2: `kaiju_roar_crab_s1..s3`, `kaiju_roar_burrower_s1..s3`, `kaiju_roar_moth_s1..s3`,
`heli_loop`, `jet_flyby`, `drone_loop`, `freeze_ray`, `dish_beam_loop`, `generator_overload`,
`bell*`, `chant_loop`, `relic_open`, `burrow_loop`, `gust`.

### Voice (`audio/voice/<lineId>.ogg|.mp3`)

Script: `shared/src/defs/voiceLines.json`, an array of
`{ "id", "cue", "audience": "humans" | "kaiju" | "all", "speaker", "text" }`, covering every cue
in `DESIGN.md` §8 with at least 3 variants for frequent cues (about 220 lines in total). Lines are
short (12 words or fewer; the hearing lines on the end screen may run to 20), deadly serious, and
never acknowledge that anything is absurd. The writing rules, and how many lines each voice needs
of its own, are in `docs/VOICE_SCRIPT.md`; the voice build checks them.

Cast: **Overlord** (command; stern), three or four squad callsigns with distinct voices, a
**Channel 9 anchor** for the kaiju's news feed, and a **committee chair** for the end-screen
hearing. Radio voices get a radio chain (band-pass, compression, light overdrive, static bed,
squelch at both ends); the anchor gets a broadcast chain; the chair gets a large-room reverb.
Verify intelligibility by round-tripping samples through speech recognition (pocketsphinx).

## 7. Manifests

Each worker writes its own **partial** manifest, `client/public/assets/manifest.<family>.json`
(for example `manifest.kaiju.json`, `manifest.army.json`, `manifest.music.json`), so nobody edits
a shared file. A partial is an object with any of the sections below. `npm run assets:manifest`
deep-merges every partial into `manifest.json`, which the client loads. Never hand-edit
`manifest.json`.

- `"models"`: `{ "<id>": { "file": "models/<id>.glb", "kind": "kaiju" | "vehicle" | "projectile"
  | "structure" | "landmark" | "prop" | "misc", "nodes": [..], "size": [w, h, d], "tris": n,
  "rig"?: "lizard" | .., "chunks"?: n, "tint"?: { "part": "body paint", "mask": "..", "blend":
  "multiply", "colors": ["#rrggbb", ..], "hint"?: ".." }, "poses"?: { "<name>": { "<node>":
  [x, y, z] } } } }` (`tint`: suggested paint colors for the vehicles with a paint mask, see
  section 3; `poses`: see below; buildings add `"base"` to `tint`, the authored wall color, so
  the client multiplies masked faces by color / base, and `"district"`, the archetype's home
  district: `docs/art/client-notes-city.md`)
  - `"poses"` (optional, kaiju only): pose targets the animator blends toward instead of fixed
    joint angles, because each stage has its own proportions. Angles are degrees relative to the
    rest pose, in the game's axes, to be set as `node.rotation.set(x, y, z)` (three.js Euler
    order XYZ). Nodes a pose does not name are left to the animator (walk cycle, look,
    breathing). The lizard stages carry `fp_claws` (both claws up beside the snout: the
    first-person carry, used only in the player's own view), `grab`, `hold`, `eat`, `brace`,
    `throw_windup`, `throw_release`, `swipe_hit` (the end of the rake) and `stagger` (reeling
    back, chest and weak point open: a pose of the body, no hand has to show).
    **First-person contract.** In the player's own view the game locks `head` to the aim and
    lets `arm_L` and `arm_R` ride on `head` instead of `torso`. Snout, claws and camera
    (`cam_fp`, vertical field of view 72 degrees, 16:9, near plane 0.02 body heights) are then
    one rigid assembly, and the picture does not change with where the player looks or with
    what the body does underneath. In that assembly every target but `stagger` puts the acting
    hand in the lower third of the frame, clear of the head and of the crosshair; seen from
    outside (the whole target, arms on the torso) the arms clear the head as well. The art
    build checks both on the exported file (`tools/art/kaiju/poses.py`) and fails if a target
    stops holding. How the client applies the targets:
    `docs/art/client-notes-kaiju-lizard.md`.
- `"sprites"`: `{ "<id>": { "file": "sprites/<sheet>.png", "frame": [w, h], "worldHeight":
  meters, "anims": { "<name>": { "rows": [front, left, back, right] | [row], "col"?: n,
  "frames": n, "fps": n } }, "blend"?: "alpha" | "add" } }`
  - `"blend"` (effect sprites, `fx_*`): how the client must draw the sprite. `"alpha"` is
    ordinary alpha blending (full-color pictures: `fx_explosion`, `fx_explosion_ground`,
    `fx_fire`, `fx_flash`, and everything meant to be tinted: smoke, dust, debris, ring,
    shadow, white); `"add"` adds it to what is behind (`fx_glow`, `fx_spark`, `fx_laserdot`).
    A full-color effect added to a daytime background burns out to white.
  - Debris: `fx_debris_1` to `fx_debris_4` are four different chunks, one frame each (pick
    one per particle); `fx_debris` is kept as a second name for `fx_debris_1`.
- `"textures"`: `{ "<id>": { "file": "textures/<id>.png", "tile"?: true, "grid"?: [cols, rows],
  "ring"?: { "repeats": n, "bottomDeg": degrees, "sunGap": [firstColumn, width] } } }`
  - `"tile"`: repeats in both directions (the ground tiles). `"ring"` (the cloud panoramas,
    which carry no `"tile"`): `repeats` copies around the horizon ring, `bottomDeg` the
    elevation of the bottom edge (negative: below the horizon), `sunGap` the clear gap in
    the painting, in pixels, that the client turns toward the sunset sun (section 3).
- `"music"`: `{ "<id>": { "base": "audio/music/<id>", "loop"?: [start, end], "bpm"?: n,
  "group"?: "stage1", "duration"?: seconds, "mark"?: seconds } }` (an entry without `loop` is a
  one-shot and is never looped; `duration` is the file length; `mark` is the moment in a
  one-shot that is written to land on a game event, so that a file started late still lands on
  time: the hit of `intermission` at 20 s, the cut of `cocoon` at 10 s; see
  `docs/audio/MUSIC.md` section 4)
- `"sfx"`: `{ "<id>": { "variants": ["audio/sfx/<id>_1", ..], "gain": 1, "loop"?: [start, end] } }`
- `"voice"`: `{ "<lineId>": { "base": "audio/voice/<lineId>", "duration": seconds } }`
- `"ui"`: `{ "<name>": { "file": "ui/<name>.svg" | "ui/<name>.png" } }`. Nobody writes this
  section: the merge script fills it in from the files it finds in `ui/` (section 5), so the
  client knows which icons and portraits exist.

Audio `base` and `variants` paths have no extension; both `.ogg` and `.mp3` exist for each.

The merge script (`tools/build-manifest.mjs`, also run by the client build) checks every entry
against the disk: an entry whose file is missing is reported and left out of `manifest.json`,
and the client draws its procedural stand-in for that asset instead of asking the server for a
file that is not there. `npm run assets:manifest -- --check` only says whether `manifest.json`
is up to date. Sprite ids the client draws: `soldier_army_rocket`, `soldier_army_rifle`, every
sprite whose id starts with `civ` (the crowd), and the effect frames `fx_explosion`, `fx_smoke`,
`fx_dust`, `fx_fire`, `fx_debris`, `fx_flash`, `fx_spark`, `fx_glow`, `fx_laserdot`, `fx_ring`,
`fx_shadow`, `fx_white` (each with one animation; the first one is played). Also delivered
and ready to use: `fx_debris_1` to `fx_debris_4` and `fx_explosion_ground` (the burst going
off on the ground; it and `fx_fire` stand on the bottom edge of their cell).

## 8. Review material

Every model family also renders a contact sheet (4 views) to `docs/art/previews/<id>.png` and at
least one lit "concept" beauty shot to `docs/art/concept/`. These are how art gets reviewed
without opening the game, and they feed the progress slides.
