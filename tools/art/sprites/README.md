# Sprites, effects, ground tiles and clouds

Everything flat in Monster Battle 9001 is pixel art drawn by the Python scripts in this
folder: the soldiers, the fleeing civilians, the effects sheet, the world markers, the seven ground tiles and the
two cloud panoramas. No image is edited by hand; to change a picture, change its script and
run the build. The contract is `docs/ASSETS.md` (sections 3, 4 and 7).

```
tools/art/sprites/
  build.py        builds everything, writes the manifest, makes the review pictures, verifies
  pix.py          the pixel kit: a tiny picture class, outlines, sheets, review-picture helpers
  characters.py   soldiers and civilians (24 x 32 pixel cells)
  fx.py           the effects sheet (64 x 64 pixel cells)
  markers.py      the world markers mk_* (32 x 32 pixel cells, white, tinted by the game)
  ground.py       the seven seamless ground tiles (64 x 64)
  clouds.py       the two cloud panoramas (512 x 256)
  gameview.py     a small software camera for the review pictures: it draws tiles, cloud rings
                  and sprites the way the game does (8 m per tile, rings, upright billboards)
```

## Run it

```bash
tools/art/sprites/build.py                # everything, about half a minute
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
| `client/public/assets/textures/ground_*.png` | seven 64 x 64 tiles (plaza and far added for the city squares and the plain round the city) |
| `client/public/assets/sprites/markers.png` | the six world markers, one row of 32 x 32 cells (review: `sprites_markers.png`) |
| `client/public/assets/textures/clouds_a.png`, `clouds_b.png` | two 512 x 256 panoramas |
| `client/public/assets/manifest.sprites.json` | the `sprites` and `textures` manifest sections |
| `docs/art/previews/*.png` | review pictures (list at the end) |

The last step of every build is a check that reads the written files back. It prints `PASS`
or `FAIL` and the exit code follows. What it checks:

- every animation cell named in the manifest exists and is not empty, and no pixel is drawn
  outside the named cells;
- every soldier frame carries at least 25 cyan pixels (15 in the die frames);
- no civilian color comes within 60 steps (summed over the three channels) of human cyan,
  kaiju orange or volley yellow, and no piece of clothing has the color of a ground tile;
- no effect touches the border of its cell (except the two that stand on the bottom edge and
  the white square), and every effect says how it is blended;
- ground tiles are 64 x 64, opaque, seamless, average within 4 steps of their palette anchor
  (rubble 3), and the rubble stays quiet;
- clouds wrap left to right (the seam is compared, in bands of 32 rows, with the 99th
  percentile of the ordinary column steps of the same band; limit 1.5), have at least two
  clear gaps of 40 pixels or more, cover at most 70% of the low bank (rows 150 to 210), have
  no row covered from edge to edge, and the sun gap named in the manifest is clear.

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

**The camera sits a little above the figures**, as in the game. Something pointing away
from the viewer runs up the picture (the launcher in the back view). Something pointing at the
viewer is foreshortened to its end: in the front view the rifle is its dark muzzle with two
pixels of barrel behind it, the launcher is the round mouth of the tube on the shoulder. Those
are the frames the kaiju player sees when being shot at, so the flash sits on the muzzle, at
chest or head height, never at the feet.

**Outline.** Every character has a one-pixel outline in `#15161f`, added automatically around
the silhouette. Inner separations (an arm in front of the body) use the dark shade of the
cloth, not black. Flashes and smoke puffs are drawn over the outline and have none.

**Colors** come from the game palette (`tools/art/lib/palette.py`): army olive `#6b7a3a`,
human cyan `#1ec8e0`, the rocket has the white nose and cyan band of `proj_rocket`, and the
base color of each ground tile is its palette anchor.

**The human color.** Olive alone is camouflage on grass and a dark lump at 80 m. Every soldier
therefore wears cyan in three places: a two-pixel band around the helmet above the brim,
three-pixel armbands, and a strip across the top of the pack. Every frame of every facing has
at least 25 cyan pixels (27 to 43; the build fails below 25). The helmet is one shade darker
than the jacket so the head separates from the body.

**Colors with a meaning stay free.** Cyan is human, orange is kaiju, yellow is a charging
volley. Civilians wear none of them, and nothing they wear has the color of a ground tile
(`check_civilian_colors` in `characters.py`).

## The sheets

`army.png` (cells 24 x 32). Rows 0 to 3 are front, left, back, right.

| Sprite | idle | walk | fire | die |
| --- | --- | --- | --- | --- |
| `soldier_army_rocket` | column 0 | columns 1 to 4 | columns 5, 6 | row 0, columns 14 to 17 |
| `soldier_army_rifle` | column 7 | columns 8 to 11 | columns 12, 13 | row 1, columns 14 to 17 |

Walk (12 frames per second: it is a run, a section moves at 6.5 m/s): frame 1 and 3 are the
strides (the body dips one pixel), 2 and 4 the passing poses. Fire (8 per second): frame 1 has
the flash, frame 2 the recoil and smoke; after firing the launcher's tube is empty. Die has no
facings: hit, falling, down, flat with the helmet rolled off (hold the last frame, then fade).
The rifleman has light skin and brown hair, the launcher man brown skin and black hair. The
rifle leans on the soldier's left shoulder in the front and in the back view; held at chest
height in the side views, with a wooden stock, a magazine and a front sight.

`civilians.png` (cells 24 x 32). Each civilian is a block of 4 columns (run frames) by 4 rows
(front, left, back, right). `civilian_1`, `_2`, `_3` start at columns 0, 4, 8 of row 0;
`civilian_4`, `_5`, `_6` at columns 0, 4, 8 of row 4. Run frames 1 and 3 are strides, 2 and 4
are in the air. The six are six different silhouettes, not one body repainted:

| Sprite | Who | Build | Carries |
| --- | --- | --- | --- |
| `civilian_1` | child in a red T-shirt | 19 pixels tall, big head | |
| `civilian_2` | coral dress, long black hair | standard (25 pixels) | |
| `civilian_3` | office worker, bald, glasses, magenta tie | stout: two pixels wider, a belly | briefcase |
| `civilian_4` | purple hoodie, white cap, khaki shorts | tall and thin: 27 pixels | |
| `civilian_5` | pink top, white skirt, blonde ponytail | standard | shopping bag |
| `civilian_6` | tourist: straw hat, blue shirt, red shorts | standard | camera on a strap |

The prop is in the figure's left hand in the front and back views and in the rear hand in the
side views. The tie is two pixels wide all the way down so that it cannot be read as a letter.

`fx.png` (cells 64 x 64), one animation named `play` per sprite:

| Sprite | Row, columns | Frames | Blend | Notes |
| --- | --- | --- | --- | --- |
| `fx_explosion` | 0, 0 to 7 | 8 at 16 fps | alpha | sparkler burst; pure light, no smoke baked in |
| `fx_smoke` | 1, 0 to 5 | 6 at 8 fps | alpha | near-white: tint it (dark grey for fire smoke) |
| `fx_spark` | 1, 6 | 1 | add | four-point star |
| `fx_glow` | 1, 7 | 1 | add | soft white glow: tint it (orange under an explosion) |
| `fx_dust` | 2, 0 to 5 | 6 at 8 fps | alpha | pale plaster dust, low and wide |
| `fx_laserdot` | 2, 6 | 1 | add | white: tint it cyan |
| `fx_ring` | 2, 7 | 1 | alpha | shockwave ring: scale it up and fade it out |
| `fx_fire` | 3, 0 to 5 | 6 at 10 fps | alpha | loops; stands on the bottom edge of the cell |
| `fx_shadow` | 3, 6 | 1 | alpha | blob shadow drawn white: tint it black |
| `fx_white` | 3, 7 | 1 | alpha | a solid white cell |
| `fx_debris_1` to `fx_debris_4` | 4, 0 to 3 | 1 each | alpha | four different chunks (wedge, slab, shard, crumbs), not an animation: pick one per particle; near-white: tint with the wall color |
| `fx_debris` | 4, 0 | 1 | alpha | the contract id: a second name for `fx_debris_1` |
| `fx_flash` | 4, 4 to 6 | 3 at 20 fps | alpha | muzzle flash |
| `fx_explosion_ground` | 5, 0 to 7 | 8 at 16 fps | alpha | bonus, not in the contract list: the same burst going off on the ground, sparks fanning up from the bottom edge of the cell |

**Blending** is part of the art, and the manifest carries it per sprite (`"blend"`). The
explosion, the ground explosion, the fire and the muzzle flash are full-color pictures (deep
red through orange to a white core). They are drawn with **ordinary alpha blending and a white
tint**. Added to a bright background (the daytime sky, sidewalk, plaster: all of stage 1) they
burn out to white blobs and lose the orange that makes a sparkler read; on a dark background
adding happens to look fine, which is how the mistake hides. Only the glow, the spark and the
laser dot are **added**. For the bloom of an explosion, put an orange-tinted `fx_glow` under
it, added. The white ones (smoke, dust, debris, ring, shadow, white) use alpha blending and are
multiplied by a tint color. `fx_blend.png` among the review pictures shows every bright effect
both ways on every kind of background; look at it whenever an effect is added.

No effect touches the border of its cell: the outer ring of pixels is empty, so a frame is
never cut off flat. The exceptions are deliberate: `fx_fire` and `fx_explosion_ground` stand on
the bottom edge (their lowest pixels are on the last row), and `fx_white` fills its cell.

## Ground tiles

64 x 64, opaque, seamless in both directions: every drawing call in `ground.py` wraps around
the tile edges. **One tile covers 8 x 8 m in the game** (`TILE` in
`client/src/render/ground.ts`), so a ground pixel is 12.5 cm, 1.8 times a character pixel
(6.9 cm): a one-meter paving slab is 8 pixels, and anything drawn bigger than a few pixels is
bigger than a person. The tiles are judged in the game's perspective, not flat: every
`ground_<name>.png` review picture shows the tile from a soldier's eye and from the smallest
kaiju's with people standing on it, and `ground_views.png` shows all five from the four eye
heights of the game.

The average color of each tile is within a few steps of its palette anchor, so a tile seen
from far away (where the game blends it down) keeps the contract color. The seam check
compares the color step across the wrap-around join with the strongest ordinary line inside
the tile; 1.0 or less means the join cannot be told from the rest.

- `ground_sidewalk` is the base land of the whole city and the most-seen texture in the game:
  plain 8-pixel square slabs on a straight grid, one quiet joint line, no bevels, slab
  brightness within 2 percent, so that no lattice shows from above.
- `ground_rubble` is flattened ground, which the design says is flat grey and on which soldiers
  must read: fine grit within ten percent of the anchor, six low-contrast slabs with a
  one-pixel shadow on one side, three small brick flecks.
- `ground_grass` has two tiny flowers (pale green-white and pink). Yellow is reserved.

## Clouds

Two 512 x 256 **horizon panoramas** with alpha: side views of cumulus standing on the
horizon. They wrap seamlessly left to right and never top to bottom; the top rows are clear
sky and the lowest range dissolves toward the bottom edge. `clouds_a` has two great towers,
`clouds_b` an anvil-topped giant and a low bank with a small tower that runs across the wrap.

**How the game must map them** (also in `docs/ASSETS.md` section 3 and in the manifest as
`"ring"`): each panorama is the inside of an upright open cylinder that follows the camera.
u runs around the ring, v runs up; never on a horizontal plane; no fog.

| | repeats around 360 degrees | one repeat spans | ring height | bottom edge | top edge |
| --- | --- | --- | --- | --- | --- |
| `clouds_a` (in front) | 4 | 90 degrees | 0.785 radii | 5 degrees below the horizon | 34.9 degrees up |
| `clouds_b` (behind) | 3 | 120 degrees | 1.047 radii | 5 degrees below the horizon | 43.8 degrees up |

The ring height is pi x radius / repeats, which keeps the picture at its 2:1 shape. The exact
mapping lives in one function, `ring_uv` in `gameview.py`; the instructions for the client are
in `docs/art/client-notes-sprites-textures.md`.

Each painting has two clear gaps that reach from above the towers' shoulders down to the
dissolve rows, so the horizon shows between the cloud groups, and the low bank (rows 150 to
210) is at most 70 percent covered. One gap per painting is the **sun gap** (`SUN_GAP` in
`clouds.py`, `sunGap` in the manifest: columns 258 to 329 of `clouds_a`, 414 to 471 of
`clouds_b`): the client turns both rings so that these gaps meet at the azimuth of the sunset
sun, which then stands between two towers instead of behind a wall.

They are painted in neutral daylight; multiply by a color for sunset and night (the review
pictures use the client's cloud colors). Transparent pixels carry the color of the nearest
cloud pixel so that smaller blended-down copies of the texture do not get a dark fringe.
Changing a tower moves the random numbers of everything drawn after it in the same group, so
each group has its own seed; when a change makes two big lobes meet in a straight vertical
line on the wrap, the seam check fails: nudge the group a few pixels.

## Adding things

- **A civilian:** add a style to `civilian_styles()` in `characters.py` (head, skin, clothes,
  `bottom`: `pants`, `shorts`, `skirt` or `skirt2`, `build`: `adult`, `child`, `tall` or
  `stout`, optionally `prop`: `briefcase`, `bag` or `camera`) and a block to
  `CIVILIAN_BLOCKS` in `build.py`. The sheet has room for four more blocks (columns 12 and
  16). A new build is a line in `BUILDS`, a new prop a small drawing in `PROPS`.
- **A hairstyle or hat:** add a `HAIR_*` dictionary with `front`, `side` and `back` drawings
  and list it in `HEADS` with its three x offsets.
- **A new faction sheet** (science, faith): copy `army_style()`, swap the helmet and weapon
  drawings, and add a sheet builder next to `build_army()`.
- **An effect:** add a generator to `fx.py` and a line to `FX_LAYOUT` in `build.py`, with
  its blend mode. Free cells: row 4 column 7, and all of rows 6 and 7.

Letters in the character drawings: `G H h` hat or helmet (light, mid, dark), `O o d` top,
`P p b` trousers, `S s z` skin, `W w q` webbing, `A a r` hair, `K k` boots, `C c x` cyan
(lit, human cyan, shaded), `M m n` metal, `U u` wood, `T t` rocket nose, `X` outline color,
`e` eye, `.` empty.

## Review pictures (`docs/art/previews/`)

| File | Shows |
| --- | --- |
| `soldier_army_rocket.png`, `soldier_army_rifle.png` | every frame enlarged 8 times, one row per facing (each row is the animation strip), the die strip, all frames at native size and 2x on four ground colors, and six frames at their real screen size from 40 to 160 m on the real tiles |
| `civilian_1.png` to `civilian_6.png` | the same for each civilian |
| `characters_lineup.png` | all six civilians and both soldiers side by side, and their silhouettes |
| `sprites_in_game.png` | the game's perspective: what the smallest kaiju sees of the army and the crowds, and what a soldier sees of the allies' backs |
| `fx.png`, `fx_on_sky.png`, `fx_on_rubble.png` | every effect as a strip, 4x, on three backgrounds |
| `fx_explosion.png`, `fx_explosion_ground.png`, `fx_fire.png` | the two explosions at 8x, the fire loop at 6x |
| `fx_blend.png` | the bright effects blended as the manifest says and the wrong way round, on sky, sidewalk, rubble, grass, asphalt and night |
| `ground_<name>.png` | a 3 x 3 tiling test, one enlarged tile, and the tile in the game from a soldier's and a kaiju's eye |
| `ground_views.png` | all five tiles from the four eye heights of the game |
| `clouds_a.png`, `clouds_b.png` | the paintings: one and a half wraps over afternoon, sunset and night skies |
| `sky_ring.png` | both panoramas on the horizon ring, unrolled over 360 degrees, three times of day, with the sunset sun in its gap |
| `sky_views.png` | the sky as players see it: from the street, from the stage 2 and 3 kaiju, looking up |
| `sheet_army.png`, `sheet_civilians.png`, `sheet_fx.png` | the whole sheets with cell lines and row and column numbers, to check the manifest against |
| `sprites_scene.png` | a flat mock street with everything together (the ground enlarged 1.8 times, as in the game), native size and 3x |

The pictures "in the game" are drawn by `gameview.py`, which copies the client's ground
mapping, sky colors, lenses, fog and sampling, and the ring mapping the client is asked to
use. It approximates the lighting. It is there because a flat mock-up flatters the art: the
first sidewalk looked fine flat and read as a brick wall laid on the ground in the game.
