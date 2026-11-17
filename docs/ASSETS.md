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
- Speech: two neural speech engines that run on the processor through ONNX Runtime (Open
  Neural Network Exchange) in the tools' Python: Kokoro-82M (with its pronouncing front end,
  `misaki`) and Piper. They speak every line in the game (`tools/audio/voice/cast.json`). Their
  voice files are not in the repository: the voice build downloads them once into
  `/opt/mbtools/models`, each pinned by its hash, with a second speech recognizer and a
  speaker-recognition model that it measures with (about 1.1 GB in all), and needs no network
  after that (`tools/audio/voice/mbvoice/models.py`). The first, rule-based speech tools are
  still installed for trials: `RHVoice-test` (voices alan, bdl, clb, slt), `flite` (rms, slt,
  awb, kal16), `pico2wave`, `festival` / `text2wave`, `espeak-ng`. No network speech services.
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
  for wall plaster (`docs/art/CITY_ART.md`). Every other model has alpha 1 throughout, except
  the lizard kaiju's stripe mark (below).
- Roof mask (roadmap phase 3, roofs colored by district): ordinary buildings add a third level
  to that mask, **0.5 = roof**, on every roof face in every state (intact, damaged, the collapse
  chunks, the roof piece lying on the rubble). The client reads alpha above 0.75 as wall, 0.25
  to 0.75 as roof and below 0.25 as neither, and multiplies roof faces by the district's roof
  color (`District.roof` in the city data, a few shades apart by structure id) divided by the
  `base` of the manifest entry's `"roof"`. Roof faces are drawn in light neutral greys that
  average that base (`#d9d9d9`, in linear light), patterns such as tiles kept as lighter and
  darker lines. Chimneys, plant rooms, water tanks, parapet tops, skylights, signs and trim
  carry 0. Landmarks, bridges and the three special buildings keep their own roof colors and
  have no 0.5 faces, as do the few ordinary archetypes listed with a reason in
  `tools/art/city/style.py` (`OWN_ROOFS`: the storage tank, the crane, the container stack, the
  glass-roofed `tower_c`, the striped pavilion). How the client draws it:
  `docs/art/client-notes-city.md` section 2; how a building marks its roof:
  `tools/art/README.md` section 9.
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

Stripe mark (roadmap phase 3, "glowing stripes"): on `kaiju_lizard_s1` to `_s3` every face of
the rust zigzag stripes (round the torso and the shoulder hump, the upper and lower arms and
legs, the tail, its tip, and the two bands across the snout) carries **COLOR_0 alpha 0.5**;
the rest of the hide 1. As with the paint mask it is a mask, not opacity. The client reads 0.25
to 0.75 as stripe and makes those faces glow with the monster's rage (150, 161 and 183 stripe
triangles at stages 1, 2, 3). Made in `tools/art/kaiju/parts.py` (`marked`, kept through
painting and shading, written on export); the glb carries nothing else new. How the client
lights it: `docs/art/client-notes-kaiju-lizard.md` section 15.

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
- Special buildings (roadmap phase 2; `tools/art/city_special.py`, pictures in
  `docs/art/previews/bld_<id>.png` and `docs/art/concept/city_special_lineup.png`). Ordinary
  structure files (`intact`, `damaged`, `rubble`, `chunk_NN`, one `city_atlas` material) that
  also carry **anchor nodes for the client's effects**: empties with no mesh, numbered like the
  chunks, so find them by prefix (`/^spark_\d+$/` and so on). Positions are in the building's own
  frame (meters, y up, front +Z).
  - `bld_substation_a` (22 x 16 m, 9 m): fenced yard, two transformers, two steel gantries with
    wires, a control hut. `spark_00`..`spark_05`: the tops of the six ceramic insulators (4.55 m
    up), where sparks crackle.
  - `bld_gasstation_a` (26 x 20 m, 7 m; the pole sign with the flame stays inside the 7 m of the
    archetype, as every building must): red canopy on four pillars over two pump islands, a
    shop, a cage of gas bottles. `light_00`..`light_03`: just above the four pumps (2.67 m up),
    lights to flicker.
  - `bld_radiomast_a` (8 x 8 m, 24 m): three-legged red and white lattice mast (six 4 m bands,
    red on top), concrete pad, equipment hut. `lamp_00` (the top, 23.6 m), `lamp_01` (15.5 m),
    `lamp_02` (8 m), all on the mast's axis: red lamps to blink. `top` is a **mesh** node: a
    spare copy of the mast's top 8 m (16 to 24 m: one white and one red band, the top lamp),
    with its origin on the mast's axis at 16 m where it breaks off. `intact` already contains
    the whole mast, so never draw `top` together with `intact`; draw it when the mast falls
    (the section tumbling away) until the thrown prop `prop_mast` takes over. `prop_mast` is
    to match this node: 8 m long, three legs 0.17 m thick standing 0.85 m from the axis at the
    break and 0.5 m at the tip, zig-zag braces in two 4 m bays, white `#f4f2ee` then red
    `#d7263d`.
- The small buildings of the starting neighborhoods (roadmap phase 3, "more kinds of
  buildings"; `tools/art/city_starts.py`, their atlas pictures in
  `tools/art/city/atlas_extra/homes.py`; pictures in `docs/art/previews/bld_<id>.png`,
  `docs/art/concept/city_starts_scale.png` and `docs/art/concept/city_starts_street.png`).
  Ordinary structure files (`intact`, `damaged`, `rubble`, `chunk_NN`, one `city_atlas`
  material, the wall mask and the roof mask), all in the small class (120 triangles per state),
  front +Z. Signs are pictures: no letters or numbers.
  - `bld_bungalow_a` (10 x 9 m, 5 m; house): one storey of painted boards under one low hipped
    roof that also covers the deep porch across the whole front (four white posts), a red
    door, a brick chimney.
  - `bld_duplex_a` (12 x 10 m, 7 m; house): a semi-detached pair, two mirrored halves under one
    long gable roof, a door at each outer end (one red, one blue) under its own small porch
    roof, a white strip down the shared wall, two chimneys.
  - `bld_garage_a` (8 x 7 m, 4 m; house): a detached two-car garage and workshop, its gable to
    the street over two ribbed roll-up doors (the look of `prop_garagedoor`), a wrench on a
    board in the gable, a window on one side and a door on the other.
  - `bld_diner_a` (16 x 10 m, 5 m; shop): a roadside diner, one long pastel body with rounded
    ends and a band of big windows all the way round (always lit at night), a chrome roof edge
    with a red neon line, and a steaming cup on a board on the roof.
  - `bld_firehouse_a` (14 x 16 m, 9 m; shop): a brick fire station with two tall red engine
    doors and a brass bell between them, a low hipped roof, and a slim hose tower at the back
    corner on the model's left. **The tower stands 12 m tall, 3 m above the archetype's box**
    (the only building that does: `TALL_PARTS` in `tools/art/lib/contract.py`); the game still
    collides with the 9 m box. Its brick keeps its own color (no wall mask); its roofs take
    the district's color.
  - `bld_motel_a` (24 x 10 m, 7 m; shop): a two-storey motel row, a door and a window per room
    on both floors, an open walkway with a railing along the upper floor under one low roof, a
    stair at the model's left end, and a sign on a pole at the right end (a sleeping moon,
    three sparkles and a bed).
- Props, one mesh each: `prop_car_sedan`, `prop_car_taxi`, `prop_car_van`, `prop_bus`,
  `prop_truck`, `prop_kiosk`, `prop_tree_a`, `prop_tree_b`, `prop_lamp`, `prop_trafficlight`,
  `prop_bench`, `prop_hydrant`, `prop_billboard`, `prop_busstop`, plus `prop_car_wreck`.
- City weapons (roadmap phase 2, "the city as a weapon"; `tools/art/props_weapons.py`, pictures
  in `docs/art/previews/prop_<kind>.png`, `docs/art/concept/props_weapons_lineup.png` and
  `props_weapons_held.png`): six props the stage 1 kaiju grabs with one hand. Each is one mesh
  as every prop (material `vcol`; `prop_mast` also has `glow` faces for its lamp), closed on
  every side, at most 80 triangles, **plus one empty node `grip`** under the mesh: the point
  the hand closes on. Nodes carry no rotation, so the manifest entry says how the thing sits in
  the hand: `"grip": { "at": [x, y, z], "tip": [x, y, z], "hold": "carry" | "javelin" | "club"
  | "shield" }`, both vectors in the model's own frame (meters, y up, front +Z). `at` is the
  grip node's position. `tip` is a unit vector from the hand into the business end: for
  `carry` turn it straight down (the thing hangs from the hand), for `javelin` along the throw,
  for `club` it is the direction of the heavy end (swing it through the target), for `shield`
  turn it away from the monster's chest.
  - `prop_propane` (2.4 m long, 1.3 m high, 0.95 m deep): white propane tank lying along x on
    two saddles, grey valve cover, a red diamond with a pale flame on both long sides. Grip on
    the valve cover, top middle; `carry`.
  - `prop_watertank` (3.0 m across, 4.5 m high): wooden tub with an iron hoop and a conical
    slate roof on four steel legs. Grip on the roof's point; `carry`.
  - `prop_antenna` (7 m high, crossbars up to 1.5 m): steel pole on a concrete foot with six
    crossbars in its top third and a red spike. Grip 2.8 m up the pole; `javelin`, the spike
    (the top) leads.
  - `prop_foodsign` (7.5 m high, burger 3.0 m across): a giant burger on a red pole. Grip
    0.7 m up the pole; `club`, the burger is the head.
  - `prop_garagedoor` (panel 3.2 x 2.8 m; 3.6 x 3.0 x 0.3 m with its frame): striped roll-up
    door in the plaster frame it was torn out with; the pull handle is on the front (+Z), a
    grab bar on the back. Grip on the grab bar, back center, 1.4 m up; `shield`, the front
    faces away from the monster.
  - `prop_mast` (8.0 m long, 1.8 m wide, 1.5 m high, lying along z with the lamp at +Z): the
    top section of `bld_radiomast_a` (same legs, braces and colors as its `top` node), resting
    on two of its three legs. Grip on the upper leg, 3.2 m from the broken end (0.8 m behind
    the origin); `javelin`, the lamp leads.
- Supply drop (roadmap phase 2, "army pick-ups"; `tools/art/props_supply.py`, pictures in
  `docs/art/previews/prop_crate.png`, `prop_parachute.png` and
  `docs/art/concept/props_supply_drop.png`): two props, each one mesh (material `vcol`, at most
  80 triangles, drawn right from every side and from below) **plus one empty node**.
  - `prop_crate` (1.6 m wide, 1.63 m high, 1.66 m deep): an olive crate on two wooden skids
    with a lighter lid, two dark straps over the lid, a pale stenciled chevron pointing down on
    the front and back (a picture, no letters, no country's mark) and the army's cyan stripe on
    both sides and across the lid. Origin on the ground under its middle. Empty node `beacon`
    at (0, 1.63, 0), the middle of the lid's top: the light and the smoke go here, and it is
    the point the crate hangs from.
  - `prop_parachute` (canopy 6.1 m across, 6.7 m high in all): a round eight-panel canopy,
    olive and khaki in turn with a cyan cap, dark inside, and eight lines that meet 4.7 m under
    the rim. Empty node `hook` where the lines meet, which is the model's origin (0, 0, 0): the
    canopy stands above it. To hang a crate, put the parachute at the crate's `beacon`; to bring
    a soldier down, put it at the soldier's shoulders. Scale it in code for a soldier if 6 m
    looks too big over one (about 0.6 suits the 1.8 m sprite).
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
marks). No text inside icons. No third-party icon sets. The labels of one or two words that
stand beside the pictures since round 5 ("Strike", "Machine gun", "Mating call") are not art:
the client sets them as text from one table (`client/src/ui/labels.ts`, `DESIGN.md` section 8,
"Labels"), so a picture never needs a word drawn into it and a word can change without new art.

- The squad's controls (phase 1; only placeholders in `client/src/ui/iconArt.ts` so far, art
  wanted): `sq_foot` (a soldier with a launcher: the squad on foot, stage 1), `sq_charge` (three
  squad-mates planted, their lasers meeting at one point: the volley charging), `sq_meter` (the
  volley meter's diamond filled past its notch), `sq_meter_low` (the same short of the notch: a
  weak shot), `sq_burst` (three shots meeting in one burst: the volley fired), `sq_drive` (a
  tank from above with arrows forward and back: W and S), `sq_turn` (a tank from above turning,
  curved arrows: A and D), `sq_turret` (a tank's turret swinging round toward a ring where the
  mouse looks).
  All eight now exist as files in `ui/` (`sq_*.svg`, phase 2) and replace the placeholders the
  same way the `k_*` files do: every file found in `ui/` is listed in the manifest's `"ui"`
  section, and `icon(id)` swaps the placeholder for the file. `sq_drive` shows the arrow beside
  the tank; `sq_turn` shows two curved arrows swinging away from the tank's nose.
- Army pick-ups (phase 2; the HUD and the picture floating over a crate; drawn at 48 px and up):
  `pk_machinegun` (a belt-fed gun on a tripod), `pk_bigcannon` (a tank turret with one fat gun
  and its big shell), `pk_missilepod` (a box of six tubes and a missile leaving it),
  `pk_artilleryradio` (a field radio sending waves, a falling shell cut out of its face),
  `pk_reinforcements` (a soldier coming down under a parachute). The name is `pk_` plus the
  pick-up's id in lower case (`machineGun`, `bigCannon`, `missilePod`, `artilleryRadio`,
  `reinforcements` in `shared/src/defs/ids.ts`).
- Kaiju verbs: `k_swipe`, `k_stomp`, `k_grab`, `k_throw`, `k_eat`, `k_brace`, `k_roar`,
  `k_special`, `k_molt`, `k_swim` (swimming: a row of spines over the waves; the HUD shows it
  while the kaiju is under water), `k_charge`
  (the Lizard's head lowered like a ram with its spines laid back, speed lines behind it) and
  `k_tailsweep` (the spiked tail lashing round in an arc, two motion lines after it). The moves
  a molt card gives use `k_special` (the beam), `k_roar`, `k_charge`, `k_tailsweep` and
  `k_brace`; an empty move slot shows `k_molt`, faint. The city as a weapon and the power surge
  (phase 2; drawn by the weapons client, `client/src/ui/kaijuKit.ts`): `k_club` (the fast-food
  sign swung: a burger on a pole with two arcs of its swing), `k_javelin` (an antenna thrown
  point first: a pole with two crossbars and a sharp point, speed lines behind), `k_shield` (a
  garage door with its slats, shots glancing off its face), `k_drop` (the clawed hand opening
  over the ground, what it held falling out) and `k_surge` (a lightning bolt with sparks).
- Status: `st_health`, `st_nerve`, `st_rage`, `st_charge`, `st_reload` (one shell: the reload
  meter and the player's own shot), `st_veteran`, `st_spotted`, `st_crossfire`, `st_callin`,
  `st_shaken`, `st_map`, `st_camera`, `st_sun`, `st_moon`. (`st_callin` is shown only when an
  artillery mission is on its way; nothing starts one until phase 2's artillery radio. The old
  command wheel's four order icons, `cmd_*`, and the smoke and mark icons, `st_smoke` and
  `st_mark`, were deleted with those controls in phase 1.)
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
- The communication rose and restart (round 4): `ui_rose` (a ring of wedges round a dot: the
  rose's key on the controls card), `ui_restart` (a circular arrow: the settings panel's restart
  button, shown to the room's host). The rose's wedges, `ro_` plus the wedge's id in lower case
  (`shared/src/net/rose.ts`): for the army `ro_panic` (a face with wide eyes and a round open
  mouth), `ro_bravado` (a thumb up), `ro_orders` (a megaphone), `ro_science` (a bubbling flask:
  call the professor), `ro_home` (a house with a heart in it), `ro_food` (a steaming pie),
  `ro_retreat` (a soldier running off, an arrow pointing back), `ro_admire` (a face with hearts
  for eyes); for the monster `ro_roar` (the roaring maw with three waves), `ro_roarshort` (a
  smaller maw, one wave), `ro_snuffle` (a snout drawing in air), `ro_growl` (bared teeth, a
  rattling line), `ro_chomp` (two jaws of teeth snapping), `ro_rumble` (a happy closed-eyed face
  over purring waves), `ro_mating` (two musical notes and a little heart).
- `skyline.svg`: the destruction-bar skyline with three taller towers at 21%, 57% and 100%.
  viewBox 400 × 64, drawn to be stretched into the bar (560 × 46 px; the root carries
  `preserveAspectRatio="none"`). Two paths: `sky-city` (clip it from the left as the bar fills)
  and `sky-rubble` (what is left). Details: `docs/art/UI_ICONS.md`.
- Portraits (PNG, 512 px, rendered from the models): `portrait_<kaiju kind>.png`,
  `portrait_<faction>.png`.

## 6. Audio (`client/public/assets/audio/`)

Every sound ships as both `.ogg` (Vorbis) and `.mp3`, 44.1 kHz. Manifest entries name the path
without extension. Loops declare exact loop points in seconds so they are gapless either way.

### Music (`audio/music/`): orchestra around the match, fast arcade tracks in it

All in one key (D minor). Around the match, choir and orchestra on one tempo grid (96 beats per
minute). In the match (round 4), one loop per stage in late-1990s high-end arcade style, faster
and bigger with each stage, and one for the last minute on the clock; each is a single file that
plays at full level (the base and combat stems of earlier rounds are gone).

`lobby` (brooding march, 60 to 90 s loop), `briefing` (tense bed, 20 s loop), `stage1`
(150 beats per minute, about 2.5 minutes: slap bass, rock drums, square and saw leads, synth
brass, orchestra hits), `stage2` (160 per minute, about 2.5 minutes: distorted guitars, synth
bass, saw lead with the brass section, violins, choir shouts, timpani), `stage3` (168 per
minute, about 2.7 minutes: double kick, guitars, the whole choir, brass, timpani, taiko,
orchestra hits), `final_minute` (168 per minute, exactly 60 s of music: alarm, countdown, the
stage 3 hook climbing a key at a time, a ten-second build; its `mark` is the end of the build,
which the client lands on the clock's zero), `cocoon` (eerie choir, about 12 s; it carries no
heartbeat of its own, because the heartbeat is the positional effect `kaiju_heartbeat_loop`),
`intermission` (build, 20 s), `win_humans` (fanfare, 10 to 15 s), `win_kaiju` (ominous choir,
10 to 15 s), `hearing` (somber bureaucratic bed, 30 s loop). Match tracks are mastered to -17,
-16.5, -16 and -16 LUFS (Loudness Units relative to Full Scale), the other full mixes to -16.

### Sound effects (`audio/sfx/`), synthesized, punchy, with 2 to 4 variants where marked *

Kaiju: `kaiju_step_s1*`, `kaiju_step_s2*`, `kaiju_step_s3*`, `kaiju_swipe_s1..s3*`,
`kaiju_stomp_s1..s3*`, `kaiju_roar_lizard_s1..s3` (one signature roar, growing with stage),
`kaiju_grab`, `kaiju_throw`, `kaiju_eat`, `kaiju_brace`, `kaiju_hurt*`, `kaiju_stagger`,
`kaiju_beam_charge`, `kaiju_beam_loop`, `kaiju_heartbeat_loop`, `kaiju_molt_blast`, `kaiju_death`.
The moves and attack looks of phases 1 and 3, each at the three sizes: `kaiju_rake_s1..s3` (the
two-claw swipe), `kaiju_hop_s1..s3` (the stomp onto both feet), `kaiju_tail_s1..s3`,
`kaiju_charge_s1..s3` (the bellow as the run begins), `kaiju_stumble_s1..s3` (three variants
that are not interchangeable: variant 1, 2 and 3 are the stumble looks 0, 1 and 2, forward onto
a knee, spinning out, sitting down hard), and `kaiju_gulp` (one size, played at the stage's rate).
The communication rose's noises (round 4; the monster has no words), each at the three sizes and
in two versions that the server's pick chooses between (so every screen plays the same one):
`kaiju_rose_roar_s1..s3` (the big roar: two swells and a long falling rumble),
`kaiju_rose_roar_short_s1..s3` (one quick bark), `kaiju_rose_snuffle_s1..s3` (sniffs, a puff of
breath and a snort), `kaiju_rose_growl_s1..s3`, `kaiju_rose_chomp_s1..s3` (a grunt and the jaws
snapping shut twice), `kaiju_rose_rumble_s1..s3` (a contented giant purr) and
`kaiju_rose_mating_s1..s3` (the mating call: a silly warbling tune in the creature's voice with a
soft whistle doubling it). Made with the project's own sound tools
(`tools/audio/sfx/mbsfx/rose.py`, the Lizard's own voice); nothing was downloaded.

Humans: `rocket_launch*`, `tank_fire*`, `shell_whoosh`, `arty_incoming`, `arty_distant`,
`laser_charge_loop`, `volley_ready`, `volley_fire`, `tank_engine_loop`, `march_loop`,
`unit_destroyed*`, `member_down*`, `shaken`, `takeover`. Phases 1 and 2: `mg_burst*` (the
machine gun pick-up), `bullet_hit*`, `cannon_fire*` (the big cannon), `tank_tracks_loop`,
`supply_drop` (the plane and the parachute), `crate_land`, `crate_take`, `flare_pop` (the
artillery marker), `stun_ring` (a squad stunned by the roar).

World: `explosion_s*`, `explosion_m*`, `explosion_l*`, `structure_hit*`, `crumble_s*`,
`crumble_m*`, `crumble_l*`, `glass*`, `car_crush*`, `prop_break*`, `splash`, `crowd_panic_loop`,
`siren_loop`, `fire_loop`, `amb_day_loop`, `amb_sunset_loop`, `amb_night_loop`, `wind_high_loop`.
Phases 2 and 3: `fireball` (a gas station), `propane_blast`, `building_groan` (a building
falling over), `fire_bell` (a firehouse coming down), `substation_hum_loop`, `power_surge`,
`surge_crackle_loop`, `shield_clang*` (the garage door), `club_swing` and `club_hit` (the
fast-food sign), `civ_pop*` (civilians squashed: a soft comic pop, never a cry), and
`speed_wind_loop` (air rushing past at speed).

UI: `ui_click`, `ui_hover`, `ui_ready`, `ui_error`, `ui_wheel_open`, `ui_wheel_select`,
`ui_join`, `ui_tick`, `ui_match_start`, `radio_open`, `radio_close`, `sting_crossfire`,
`sting_nerve_break`, `sting_bar_mark`, `sting_molt_ready`, `camera_shutter`, `radio_static`
(a radio mast falls).

Tier 2: `kaiju_roar_crab_s1..s3`, `kaiju_roar_burrower_s1..s3`, `kaiju_roar_moth_s1..s3`,
`heli_loop`, `jet_flyby`, `drone_loop`, `freeze_ray`, `dish_beam_loop`, `generator_overload`,
`bell*`, `chant_loop`, `relic_open`, `burrow_loop`, `gust`.

### Voice (`audio/voice/<lineId>.ogg|.mp3`)

Since round 4 (`docs/ROADMAP.md`) the game says almost nothing by itself: the automatic radio and
news lines are gone. Two scripts are left:

- `shared/src/defs/voiceLines.json`, an array of
  `{ "id", "cue", "audience": "humans" | "kaiju" | "all", "speaker", "text" }`: only the news
  telling the monster's player that the creature can molt (`molt.available`, two lines,
  `v_molt_available_3` and `_4`). The simulation still emits its other cues; they have no lines
  and nobody hears them.
- `client/src/audio/roseLines.json`: the communication rose's army lines,
  `{ "voices": [the squad callsigns], "army": { "<wedge>": ["line", ...] } }`, with the wedges in
  the order of `ROSE_ARMY` (`shared/src/net/rose.ts`). Every line is spoken in every squad voice,
  as `rose_<voice in lower case>_<wedge>_<number>` (8 wedges of 5 lines in 4 voices: 160 files).
  This data file is what a later voice pass (a commercial voice service) rebuilds from.

The voice build reads, checks, builds and documents both together; a line id is unique across
both. A rose line is one sentence of 12 words or fewer, shouted (it ends with "!"), inane 1950s
monster-movie radio played straight: never mean, nothing gory, nothing about any real faith. The
writing rules are in `docs/VOICE_SCRIPT.md`; the voice build checks them.

Cast: four squad leaders (**Granite**, **Beacon**, **Tempest**, **Anvil**, one per squad, each a
distinct voice) and the **Channel 9 anchor** for the molt line. The squad voices are pushed to
shout: faster, pitched up a semitone or two, extra exclamation marks fed to the speech model,
and a hotter radio chain (narrower band, more compression and overdrive, louder static, squelch
at both ends). The anchor gets a broadcast chain. Intelligibility is checked by two speech
recognizers on every finished file (`docs/audio/VOICE.md`).

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
  [x, y, z] } }, "grip"?: { "at": [x, y, z], "tip": [x, y, z], "hold": ".." } } }` (`grip`: how
  the kaiju holds a city weapon, see section 3; `tint`: suggested paint colors for the vehicles with a paint mask, see
  section 3; `poses`: see below; buildings add `"base"` to `tint`, the authored wall color, so
  the client multiplies masked faces by color / base, and `"district"`, the archetype's home
  district; ordinary buildings with roof faces add `"roof": { "part": "roof", "mask": "..",
  "blend": "multiply", "base": "#d9d9d9", "hint": ".." }`, the roof mask of section 3, whose
  faces the client multiplies by the district's roof color / base:
  `docs/art/client-notes-city.md`)
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
  one-shot and is never looped; `duration` is the file length; `bpm` is the cue's own tempo;
  `group` is unused since round 4; `mark` is the moment in a cue that is written to land on a
  game event, so that a file started late still lands on time: the hit of `intermission` at
  20 s, the cut of `cocoon` at 10 s, the end of the build of the `final_minute` loop at 60.25 s;
  see `docs/audio/MUSIC.md` section 4)
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
