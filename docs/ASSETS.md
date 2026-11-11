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
ochre and purple-brown; Vespera amber and pink with glowing eyespots.

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
  material. Every other model has alpha 1 throughout.
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
- Props, one mesh each: `prop_car_sedan`, `prop_car_taxi`, `prop_car_van`, `prop_bus`,
  `prop_truck`, `prop_kiosk`, `prop_tree_a`, `prop_tree_b`, `prop_lamp`, `prop_trafficlight`,
  `prop_bench`, `prop_hydrant`, `prop_billboard`, `prop_busstop`, plus `prop_car_wreck`.
- Ground tiles (64 px, tiling): `textures/ground_asphalt.png`, `ground_sidewalk.png`,
  `ground_grass.png`, `ground_water.png`, `ground_rubble.png`. Sky: `textures/clouds_a.png`,
  `clouds_b.png` (dramatic cumulus with alpha).

## 4. Sprites (`client/public/assets/sprites/`)

Pixel art, drawn by script. Sheets are grids of equal cells. Characters are flat billboards with
4 facings (front, left, back, right).

- `army.png`: `soldier_army_rocket`, `soldier_army_rifle` (24 × 32 px cells): idle 1, walk 4,
  fire 2 frames per facing, die 4 frames.
- `civilians.png`: 6 civilian variants: run 4 frames per facing, arms up.
- `fx.png`: sparkler explosion (8 frames), smoke puff (6), dust (6), spark, muzzle flash (3),
  debris bits (4), soft glow, laser dot, shockwave ring, fire (6). 64 px cells.
- Tier 2: `science.png` (lab coats with ray guns), `faith.png` (fictional clergy and choir
  members of many traditions, drawn with warmth and dignity), pilots are not needed.

## 5. UI art (`client/public/assets/ui/`)

Hand-written SVG, 64 × 64 viewBox, single color via `currentColor`, thick strokes, readable at
32 px. No text inside icons. No third-party icon sets.

- Commands: `cmd_follow`, `cmd_moveto`, `cmd_fireatwill`, `cmd_holdcharge`.
- Kaiju verbs: `k_swipe`, `k_stomp`, `k_grab`, `k_throw`, `k_eat`, `k_brace`, `k_roar`,
  `k_special`, `k_molt`.
- Status: `st_health`, `st_nerve`, `st_rage`, `st_charge`, `st_veteran`, `st_spotted`,
  `st_crossfire`, `st_callin`, `st_shaken`, `st_map`, `st_camera`, `st_sun`, `st_moon`.
- Lobby: `lb_kaiju`, `lb_human`, `lb_ready`, `lb_host`, `lb_bot`, `lb_link`, `lb_play`, `lb_back`,
  `lb_create`, `lb_join`.
- Factions: `fac_army`, `fac_air`, `fac_science`, `fac_faith`.
- Tally pictograms: `tl_car`, `tl_kiosk`, `tl_house`, `tl_shop`, `tl_apartment`, `tl_office`,
  `tl_tower`, `tl_factory`, `tl_bridge`, `tl_landmark`.
- Device glyphs: `kb_key` (blank keycap; the letter is added in code), `ms_left`, `ms_right`,
  `ms_middle`, `ms_move`, `gp_a`, `gp_b`, `gp_x`, `gp_y`, `gp_lb`, `gp_rb`, `gp_lt`, `gp_rt`,
  `gp_ls`, `gp_rs`, `gp_dpad`, `gp_start`, `gp_back`.
- `skyline.svg`: the destruction-bar skyline with three taller towers at 21%, 57% and 100%.
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
choir, orchestra, timpani), `cocoon` (heartbeat and eerie choir, about 12 s), `intermission`
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
in `DESIGN.md` §8 with at least 3 variants for frequent cues (about 150 lines in total). Lines are
short (12 words or fewer), deadly serious, and never acknowledge that anything is absurd.

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
  "multiply", "colors": ["#rrggbb", ..], "hint"?: ".." } } }` (`tint`: suggested paint colors for
  the vehicles with a paint mask, see section 3)
- `"sprites"`: `{ "<id>": { "file": "sprites/<sheet>.png", "frame": [w, h], "worldHeight":
  meters, "anims": { "<name>": { "rows": [front, left, back, right] | [row], "col"?: n,
  "frames": n, "fps": n } } } }`
- `"textures"`: `{ "<id>": { "file": "textures/<id>.png", "tile"?: true, "grid"?: [cols, rows] } }`
- `"music"`: `{ "<id>": { "base": "audio/music/<id>", "loop"?: [start, end], "bpm"?: n,
  "group"?: "stage1" } }`
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
`fx_shadow`, `fx_white` (each with one animation; the first one is played).

## 8. Review material

Every model family also renders a contact sheet (4 views) to `docs/art/previews/<id>.png` and at
least one lit "concept" beauty shot to `docs/art/concept/`. These are how art gets reviewed
without opening the game, and they feed the progress slides.
