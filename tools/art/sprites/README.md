# Sprites, effects, ground tiles and clouds

Everything flat in Monster Battle 9001 is pixel art drawn by the Python scripts in this
folder: the soldiers, the fleeing civilians, the effects sheet, the five ground tiles and the
two cloud panoramas. No image is edited by hand; to change a picture, change its script and
run the build. The contract is `docs/ASSETS.md` (sections 3, 4 and 7).

```
tools/art/sprites/
  build.py        builds everything, writes the manifest, makes the review pictures, verifies
  pix.py          the pixel kit: a tiny picture class, outlines, sheets, review-picture helpers
  characters.py   soldiers and civilians (24 x 32 pixel cells)
  fx.py           the effects sheet (64 x 64 pixel cells)
  ground.py       the five seamless ground tiles (64 x 64)
  clouds.py       the two cloud panoramas (512 x 256)
```

## Run it

```bash
tools/art/sprites/build.py                # everything, about 10 seconds
tools/art/sprites/build.py --no-previews  # sheets, textures and manifest only, about 2 seconds
tools/art/sprites/build.py --check        # only verify the files on disk against the manifest
```

It needs `/opt/mbtools/venv/bin/python` (pillow, numpy, scipy; no Blender). `tools/art/build_all.sh`
picks the script up by its `# mb-family: sprites` marker. The build is deterministic: every
random choice comes from a fixed seed, so two runs give byte-identical pictures.

What it writes:

| File | What it is |
| --- | --- |
| `client/public/assets/sprites/army.png` | 512 x 128: both soldiers |
| `client/public/assets/sprites/civilians.png` | 512 x 256: six civilians |
| `client/public/assets/sprites/fx.png` | 512 x 512: all effects (the two bottom rows are free) |
| `client/public/assets/textures/ground_*.png` | five 64 x 64 tiles |
| `client/public/assets/textures/clouds_a.png`, `clouds_b.png` | two 512 x 256 panoramas |
| `client/public/assets/manifest.sprites.json` | the `sprites` and `textures` manifest sections |
| `docs/art/previews/*.png` | review pictures (list at the end) |

The last step of every build is a check that reads the written files back: every animation
cell named in the manifest exists and is not empty, no pixel is drawn outside the named cells,
ground tiles are 64 x 64, opaque and seamless, clouds wrap left to right. It prints `PASS` or
`FAIL` and the exit code follows.

## Conventions

**Grid.** A sheet is a grid of equal cells. Column 0 is at the left, **row 0 at the top**.
An animation in the manifest is `{ "rows": [...], "col": first column, "frames": n, "fps": n }`:
its frames run left to right from `col`, and `fps` is its speed in frames per second. `rows`
has four entries for a character with facings, in the order **front, left, back, right**, or
one entry for something that looks the same from every side. The layout tables at the top of `build.py` are the single source of truth for both
the sheets and the manifest.

**Facings.** "Front" is the figure walking toward the viewer (you see the face), "back" walking
away, "left" and "right" walking toward that side of the screen. Side views are drawn facing
right and mirrored for left.

**Character cells** are 24 x 32 pixels. The figure is centered on x = 11.5; the soles stand on
row 30 and the outline fills row 31, so the bottom middle of the cell is where the figure
touches the ground. `worldHeight` is the height of the whole cell in meters: 2.2, which makes
a soldier (26 pixels from helmet to sole) 1.8 m tall and a civilian about 1.65 m. Headroom
above the helmet is for raised arms and launcher tips.

**Effect cells** are 64 x 64 pixels with `worldHeight` 1: the game scales each particle.
Effects are centered in their cell, except `fx_fire` and `fx_explosion_ground`, which stand on
the bottom edge of the cell (anchor them at the bottom middle).

**The camera sits a little above the figures**, as in the game. Something pointing at the
viewer runs down the picture (the launcher in the front view), something pointing away runs up
(the launcher in the back view).

**Outline.** Every character has a one-pixel outline in `#15161f`, added automatically around
the silhouette. Inner separations (an arm in front of the body) use the dark shade of the
cloth, not black. Flashes and smoke puffs are drawn over the outline and have none.

**Colors** come from the game palette (`tools/art/lib/palette.py`): army olive `#6b7a3a`,
the armband is human cyan `#1ec8e0`, the rocket has the white nose and cyan band of
`proj_rocket`, and the base color of each ground tile is its palette anchor.

## The sheets

`army.png` (cells 24 x 32). Rows 0 to 3 are front, left, back, right.

| Sprite | idle | walk | fire | die |
| --- | --- | --- | --- | --- |
| `soldier_army_rocket` | column 0 | columns 1 to 4 | columns 5, 6 | row 0, columns 14 to 17 |
| `soldier_army_rifle` | column 7 | columns 8 to 11 | columns 12, 13 | row 1, columns 14 to 17 |

Walk: frame 1 and 3 are the strides (the body dips one pixel), 2 and 4 the passing poses.
Fire: frame 1 has the flash, frame 2 the recoil and smoke. Die has no facings: hit, falling,
down, flat with the helmet rolled off (hold the last frame, then fade).

`civilians.png` (cells 24 x 32). Each civilian is a block of 4 columns (run frames) by 4 rows
(front, left, back, right). `civilian_1`, `_2`, `_3` start at columns 0, 4, 8 of row 0;
`civilian_4`, `_5`, `_6` at columns 0, 4, 8 of row 4. Run frames 1 and 3 are strides, 2 and 4
are in the air. The six: red shirt, yellow dress, office worker, purple hoodie, pink top,
tourist. None of them wears cyan or kaiju orange.

`fx.png` (cells 64 x 64), one animation named `play` per sprite:

| Sprite | Row, columns | Frames | Notes |
| --- | --- | --- | --- |
| `fx_explosion` | 0, 0 to 7 | 8 at 16 fps | sparkler burst; pure light, no smoke baked in |
| `fx_smoke` | 1, 0 to 5 | 6 at 8 fps | near-white: tint it (dark grey for fire smoke) |
| `fx_spark` | 1, 6 | 1 | four-point star |
| `fx_glow` | 1, 7 | 1 | soft white glow for additive blending |
| `fx_dust` | 2, 0 to 5 | 6 at 8 fps | pale plaster dust, low and wide |
| `fx_laserdot` | 2, 6 | 1 | white: tint it cyan |
| `fx_ring` | 2, 7 | 1 | shockwave ring: scale it up and fade it out |
| `fx_fire` | 3, 0 to 5 | 6 at 10 fps | loops; base on the bottom edge of the cell |
| `fx_shadow` | 3, 6 | 1 | blob shadow drawn white: tint it black |
| `fx_white` | 3, 7 | 1 | a solid white cell |
| `fx_debris` | 4, 0 to 3 | 4 | four different chunks, not an animation; near-white: tint with the wall color |
| `fx_flash` | 4, 4 to 6 | 3 at 20 fps | muzzle flash |
| `fx_explosion_ground` | 5, 0 to 7 | 8 at 16 fps | bonus, not in the contract list: the same burst going off on the ground, sparks fanning up from the bottom edge of the cell |

The bright effects (explosion, fire, flash, spark) contain only light colors on transparent,
so they look right with ordinary alpha blending and with additive blending. The white ones
(glow, laser dot, ring, shadow, white, smoke, dust, debris) are meant to be multiplied by a
tint color.

## Ground tiles

64 x 64, opaque, seamless in both directions: every drawing call in `ground.py` wraps around
the tile edges. The average color of each tile is within a few steps of its palette anchor, so
a tile seen from far away (where the game blends it down) keeps the contract color. The check
compares the color step across the wrap-around join with the strongest ordinary line inside
the tile; 1.0 or less means the join cannot be told from the rest.

## Clouds

Two 512 x 256 panoramas with alpha. Both wrap seamlessly left to right; the top rows are clear
sky and the lowest cloud range dissolves toward the bottom edge, so a panorama can stand on
the horizon or be repeated around a sky dome (`"tile": true` in the manifest). `clouds_a` has
two great towers, `clouds_b` a long bank with one anvil-topped giant. They are painted in
neutral daylight; multiply by a color for sunset and night (the review pictures show
1.00, 0.74, 0.60 and 0.30, 0.36, 0.56). Transparent pixels carry the color of the nearest
cloud pixel so that the smaller blended-down copies the game makes of the texture do not get
a dark fringe.

## Adding things

- **A civilian:** add a style to `civilian_styles()` in `characters.py` (head, skin, clothes,
  `bottom`: `pants`, `shorts`, `skirt` or `skirt2`) and a block to `CIVILIAN_BLOCKS` in
  `build.py`. The sheet has room for four more blocks (columns 12 and 16).
- **A hairstyle or hat:** add a `HAIR_*` dictionary with `front`, `side` and `back` drawings
  and list it in `HEADS` with its three x offsets.
- **A new faction sheet** (science, faith): copy `army_style()`, swap the helmet and weapon
  drawings, and add a sheet builder next to `build_army()`.
- **An effect:** add a generator to `fx.py` and a line to `FX_LAYOUT` in `build.py`. Free
  cells: row 4 column 7, and all of rows 6 and 7.

Letters in the character drawings: `G H h` hat or helmet (light, mid, dark), `O o d` top,
`P p b` trousers, `S s z` skin, `W w q` webbing, `A a r` hair, `K k` boots, `C c` armband,
`M m n` metal, `U u` wood, `T t` rocket nose, `e` eye, `.` empty.

## Review pictures (`docs/art/previews/`)

| File | Shows |
| --- | --- |
| `soldier_army_rocket.png`, `soldier_army_rifle.png` | every frame enlarged 8 times, one row per facing (each row is the animation strip), the die strip, and all frames at native size and 2x on four ground colors |
| `civilian_1.png` to `civilian_6.png` | the same for each civilian |
| `fx.png`, `fx_on_sky.png`, `fx_on_rubble.png` | every effect as a strip, 4x, on three backgrounds |
| `fx_explosion.png`, `fx_explosion_ground.png`, `fx_fire.png` | the two explosions at 8x, the fire loop at 6x |
| `ground_<name>.png` | a 3 x 3 tiling test next to one enlarged tile |
| `clouds_a.png`, `clouds_b.png` | one and a half wraps over afternoon, sunset and night skies |
| `sheet_army.png`, `sheet_civilians.png`, `sheet_fx.png` | the whole sheets with cell lines and row and column numbers, to check the manifest against |
| `sprites_scene.png` | a mock street with everything together, native size and 3x |
