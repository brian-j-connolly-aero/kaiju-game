# Art pipeline: how models get made

Every model in Monster Battle 9001 is built by a Python script, exported as a binary glTF file
(`.glb`, the 3D format the game loads), checked against the art contract, and photographed for
review. This folder holds the kit that does all four. The contract itself is `docs/ASSETS.md`;
this page is how to meet it without thinking about it.

```
tools/art/
  lib/mb.py            the kit: shapes, colors, nodes, export, previews, manifests  (import mb)
  lib/palette.py       the named colors                    (swatches: docs/art/palette.png)
  lib/contract.py      names, budgets, required nodes from ASSETS.md, as data
  lib/glb.py           reads .glb files without Blender
  lib/validation.py    the contract checks
  validate.py          command line: check any .glb or manifest
  preview.py           command line: re-render any .glb
  build_all.sh         rebuild everything, then validate everything
  example.py           the worked example below (prop_hydrant)
  tests/               proofs that the conventions hold (run_all.sh)
```

Run everything with `/opt/mbtools/venv/bin/python` (it has Blender 5.2 as the `bpy` module).
If it is missing, run `tools/setup-asset-tools.sh`.

## 1. Sixty-second start

```bash
/opt/mbtools/venv/bin/python tools/art/example.py      # builds, validates, renders the hydrant
```

It writes four files, which is what every asset produces:

| File | What it is |
| --- | --- |
| `client/public/assets/models/prop_hydrant.glb` | the model the game loads |
| `client/public/assets/manifest.example.json` | its manifest entry, measured from the file |
| `docs/art/previews/prop_hydrant.png` | contact sheet: front, left side, back, three-quarter |
| `docs/art/concept/prop_hydrant.png` | lit beauty shot |

Then look at the two pictures (with the Read tool, or any viewer). Looking is the job: a model
that only passes validation is not finished.

## 2. The rules that never change

**Axes.** You write coordinates in Blender's frame. The exporter converts to the game's frame.

| | You write (Blender) | The file contains (glTF, the game) | Constant |
| --- | --- | --- | --- |
| up | +Z | +Y | `mb.UP` |
| forward (the model's nose) | **-Y** | **+Z** | `mb.FWD` |
| the model's own left | +X | +X | `mb.LEFT` |

A point you write as `(x, y, z)` lands in the file as `(x, z, -y)`. So: snouts, gun barrels and
headlights go toward **negative Y**; tails go toward positive Y; `_L` parts sit at positive X.
This is proved, not assumed: `tests/test_conventions.py` exports a lopsided arrow and checks the
file and the renders, and `tests/three_check.mjs` loads the same file with the game's loader.
See `docs/art/conventions/arrow_from_glb.png`.

**Units** are meters. **Origin** is on the ground under the middle of the model (things that fly,
projectiles and `air_*`, keep the origin at their own middle).

**Rest pose** is a neutral stance. Animation is done in code, so a model is **rigid pieces under
named nodes, each with its pivot on the joint it turns around**. No armatures, no keyframes.

**Nodes carry a position only.** Rotation and scale are baked into the geometry ("apply all
transforms"). With `mb.node()` this is automatic: you never rotate a node, you rotate geometry.

**Three materials, by name, no textures in the file:**

| Name | Meaning | Needs |
| --- | --- | --- |
| `vcol` | lit, colored by vertex color | a color per face (always there) |
| `glow` | unlit, glowing: eyes, weak points, lights | a color per face |
| `city_atlas` | lit, textured from the shared city atlas | texture coordinates (section 9) |

**Flat shading, back faces culled.** Every face has one normal. The game draws a face from its
front only, so a face seen from behind is a hole. Contact sheets paint such faces **hot magenta**.

**Triangle budgets** (ASSETS.md section 3): kaiju stage 1 and 2: 2500, stage 3: 4000; vehicles
500; cars (including bus, truck, wreck) 150; other props 80; structures small 120, medium 250,
large 500 (per state); landmarks 1500; each collapse chunk 30. Not in ASSETS.md, chosen here so
everything has a ceiling: projectiles 80, cocoon and egg 500.

**Names.** Node names use letters, digits and underscores only. A single-mesh asset (every prop,
the tank wreck) is one node named after the asset id. A rigged asset uses the node names in
ASSETS.md exactly.

## 3. Writing a family script

One script per family. Put it at `tools/art/<family>.py` or `tools/art/<folder>/<name>.py`.

```python
#!/opt/mbtools/venv/bin/python
# mb-family: props
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))   # "..", "lib" from a subfolder
import mb


@mb.asset("prop_bench", kind="prop")
def bench():
    g = mb.box((1.6, 0.4, 0.06), at=(0, 0, 0.45), color="wood")           # seat
    g += mb.box((1.6, 0.06, 0.4), at=(0, 0.2, 0.5), color="wood_dk", anchor="bottom")   # back rest
    for x in (-0.7, 0.7):
        g += mb.box((0.08, 0.4, 0.45), at=(x, 0, 0), color="metal_dk", anchor="bottom")  # legs
    mb.node("prop_bench", g)


if __name__ == "__main__":
    raise SystemExit(mb.run_family("props"))
```

- The comment `# mb-family: <family>` in the first lines is what makes `build_all.sh` pick the
  script up. Add `order=10` to run early (texture and atlas generators), default is 50. Nothing
  else has to be registered anywhere.
- `@mb.asset(id, kind=..., rig=..., size_class=..., sheet=..., concept=...)` registers a function
  that builds one asset into an empty scene. `kind` is the manifest kind (`kaiju`, `vehicle`,
  `projectile`, `structure`, `landmark`, `prop`, `misc`); it is guessed from the id if left out.
- `mb.run_family("props")` then, for each asset: empties the scene, calls your function, exports
  the `.glb`, validates it, loads the exported file back and renders the contact sheet and the
  concept shot from it, and writes the entry into `client/public/assets/manifest.props.json`.
  It exits non-zero if any asset fails validation.

Command line of every family script:

```
--only ID[,ID]    build just these (other manifest entries are kept)
--no-previews     export and validate only: about 0.1 s per asset, for geometry iteration
--no-concept      contact sheets only
--force           re-render previews even though the model did not change
--list            print the asset ids
```

Previews are skipped automatically when the `.glb` and the preview options are unchanged, so a
full rebuild only pays for what you touched. A contact sheet takes 1 to 2 seconds, a concept
shot about 10.

## 4. Worked example: the hydrant, end to end

`tools/art/example.py`, in full:

```python
@mb.asset("prop_hydrant", kind="prop", concept=dict(backdrop="sky", azimuth=28, elevation=14))
def hydrant():
    g = mb.Geo()
    # foot and barrel: a lathe spins (radius, height) points around the vertical axis
    g += mb.lathe([(0.20, 0.0), (0.15, 0.09), (0.13, 0.63)], n=6, colors=["red_dk", "red"],
                  cap_bottom=False, cap_top=False)
    # bonnet closing to a point, then the operating nut
    g += mb.lathe([(0.18, 0.63), (0.18, 0.72), (0.0, 0.85)], n=6, colors=["red", "red_lt"],
                  cap_bottom=False)
    g += mb.prism(3, 0.05, 0.09, at=(0, 0, 0.81), color="grey_light", cap_bottom=False)
    # outlets: bars between two points; the hidden end is left open to save triangles
    front = mb.beam((0, -0.08, 0.42), (0, -0.25, 0.42), (0.17, 0.17), (0.14, 0.14), color="red_dk",
                    cap_start=False)
    front.paint("grey_light", where="front")
    g += front
    left = mb.beam((0.08, 0, 0.49), (0.23, 0, 0.49), (0.115, 0.115), (0.095, 0.095), color="red_dk",
                   side=mb.FWD, cap_start=False)
    left.paint("grey_light", where="left")
    g += left
    g += left.mirrored()                       # right outlet = left outlet, mirrored
    g.bake_light(top=1.06, bottom=0.8).jitter(0.035, seed=7)
    mb.node("prop_hydrant", g)                 # one mesh, named after the asset
```

What to notice:

1. Geometry is written where it sits in the finished model: the front outlet is at **negative
   Y**, the left one at positive X, the ground is `z = 0`.
2. The first attempt had 94 triangles and the validator said so (`FAIL budget ... over the
   budget of 80`). The fixes were the usual ones: `cap_bottom=False` / `cap_start=False` on ends
   nobody sees, and fewer bands on the lathe. Now 79.
3. `mb.node("prop_hydrant", g)` with no pivot puts the origin at the model origin: on the
   ground, centered. That is what a prop needs.
4. It is 0.9 m tall because the game says so: `tools/art/data/archetypes.json` (written by
   `npm run export:defs`) lists every prop's height and radius and every building's footprint,
   and the validator compares the model against it (`prop-size`, `archetype`).
5. The manifest entry is measured from the exported file, never typed:

```json
"prop_hydrant": { "file": "models/prop_hydrant.glb", "kind": "prop",
                  "nodes": ["prop_hydrant"], "size": [0.46, 0.9, 0.423], "tris": 79 }
```

Results: `docs/art/previews/prop_hydrant.png` and `docs/art/concept/prop_hydrant.png`.
When the props family lands it should take `prop_hydrant` over (move or rewrite the function in
its own script) and delete `example.py` and `manifest.example.json`, so one id has one owner.

## 5. Shapes

Every builder returns a `Geo`: a bag of flat faces in model space. Join with `+` or `+=`.
Sizes are `(width x, depth y, height z)`. Every builder takes `color=` and `mat=`.

| Builder | Makes | Triangles |
| --- | --- | --- |
| `box(size, at, anchor="center")` | box; `anchor` = which part sits on `at`: `center`, `bottom`, `top`, `front`, `back`, `left`, `right` | 12 |
| `tapered_box(bottom, top, height, at, offset)` | box with a different top rectangle; top `(0, 0)` is a pyramid, `(w, 0)` a roof ridge | 12 or less |
| `pyramid(base, height, at)` | four-sided pyramid | 6 |
| `wedge(size, at, high="back")` | ramp; `high` names the tall side | 8 |
| `prism(n, radius, height, radius_top, at)` | upright n-sided prism or taper; radius is to the corners; a flat side faces front | 4n - 4 |
| `cone(n, radius, height, at)` | upright cone | 2n - 2 |
| `lathe(profile, n, at, colors=)` | spins `[(radius, z), ...]` around the vertical axis; radius 0 closes to a point | 2n per band |
| `sphere(radius, n=8, rings=4, at)` | ball or ellipsoid (`radius=(rx, ry, rz)`) | 2n(rings - 1) |
| `icosphere(radius, detail=0, at)` | faceted ball | 20, or 80 at detail 1 |
| `extrude(outline, depth, axis="x")` | slab from a 2D outline: `"x"` = side view `(y, z)` points, `"y"` = front view `(x, z)`, `"z"` = top view `(x, y)` rising from the ground. Outline may be concave. | 4k - 4 for k points |
| `loft(sections, colors=)` | skin over a row of cross-sections made with `section(n, width, height, center, axis)`: torsos, tails, snouts, fuselages. Coincident points close a tip. | 2n per band |
| `beam(p0, p1, size0, size1)` | rectangular bar between two points: limbs, posts | 12 |
| `rod(p0, p1, r0, r1, n=6)` | n-sided bar between two points: pipes, barrels; `r1=0` is a spike | 4n - 4 |
| `quad`, `tri`, `polygon(points, two_sided=)` | single faces; a thin fin, flag or sign needs `two_sided=True` or it vanishes from behind | |
| `from_data(verts, faces)` | raw vertices and faces (counter-clockwise seen from outside) | |

`cap_bottom=False`, `cap_top=False`, `cap_start=False`, `cap_end=False` leave hidden ends open
and save triangles. `g.tris` is the triangle count of a `Geo`; `mb.tri_count()` of the scene.

**Moving geometry** (changes the `Geo` in place and returns it, so calls chain; `.copy()` first
to keep the original): `.move(x, y, z)`, `.rx(deg)` `.ry(deg)` `.rz(deg)` (optionally
`about=point`), `.scale(sx, sy, sz)`, `.mirror_x()`, `.mirrored()` (a mirrored copy),
`.symmetric()` (itself plus its mirror), `.along(p0, p1)` (stand a part built along +Z on the
line between two points), `.on_ground()`, `.triangulate()` (split bent quads into facets),
`.flip()`.

**Choosing faces** (`where=`): `"top"`, `"bottom"`, `"front"`, `"back"`, `"left"`, `"right"`,
`"side"`, a material name, a function `(center, normal) -> bool`, or a list of face numbers.
Directions are the model's own: `"front"` faces look toward -Y.

## 6. Color

Colors are palette names (`"kaiju_orange"`), hex strings (`"#ff7a1a"`) or `(r, g, b)` tuples in
0..1. The palette is `lib/palette.py`; the picture is `docs/art/palette.png`. Every base color
has a darker `_dk` and a lighter `_lt` shade (`"red_dk"`, `"bld_cream_lt"`); `mb.shade(color,
0.7)` and `mb.mix(a, b, t)` make others. Constants also exist: `mb.C.KAIJU_ORANGE`.

The anchors from ASSETS.md are `human_cyan`, `kaiju_orange`, `volley_yellow`, `rubble_grey`,
`road`, `sidewalk`, `grass`, `water`. Groups: `bld_*` (plaster tones), `army_*`, the kaiju
schemes (`gragnor_*`, `krabulon_*`, `drillmaw_*`, `vespera_*`, `bone`, `maw`), everyday
materials, and `glow_*` for the glow material.

Painting a `Geo`: `.paint(color, where)`, `.gradient(low, high, axis)`, `.stripes(color, axis,
period, width)`, `.recolor(fn)`, `.jitter(amount)` (tiny brightness variation per face so facets
read), `.bake_light(top, bottom)` (a little painted-in sky light), `.glow(color, where)`
(switch faces to the glow material).

Colors are stored in the file as linear light, as glTF requires; the tests check that
`volley_yellow` comes back out of the file as `#ffd91a`.

## 7. Nodes, pivots, mirroring

```python
root  = mb.empty("root")                                             # group at the origin
hips  = mb.node("hips", hips_geo, pivot=(0, 0.3, 1.9), parent=root)  # pivot = the joint
arm   = mb.node("arm_L", arm_geo, pivot=shoulder, parent=torso)
fore  = mb.node("forearm_L", fore_geo, pivot=elbow, parent=arm)
hand  = mb.node("hand_L", hand_geo, pivot=wrist, parent=fore)
mb.mirror(arm)                                   # makes arm_R, forearm_R, hand_R
mb.empty("hold", at=(-0.95, -2.15, 2.5), parent="hand_R")            # anchor: an empty node
```

- Geometry and pivots are all given in **model space**, where the part sits in the rest pose.
  `mb.node` works out the parent-relative offsets.
- `pivot` is the point the game will rotate the node around: shoulder, hinge, turret ring.
- `mb.empty(name, at, parent)` makes anchors (`cam_fp`, `mouth`, `hold`, `muzzle`) and groups
  (`root`, `spines`). Anchors look along the model's forward axis.
- `mb.mirror(node)` builds the opposite side of a `_L` (or `_R`) node and everything under it
  that has `_L`/`_R` in its name, with geometry, pivots and face directions mirrored correctly.
- A complete example with every lizard node is `tests/test_rig.py` (a box lizard, deliberately
  crude). Its pictures: `docs/art/conventions/rig_test_sheet.png`.
- Objects you make with plain Blender calls and then rotate or scale need
  `mb.apply_transforms()` before export. Things made with `mb.node` never do.

## 8. Posing and previews

**Poses** rotate named nodes around their pivots, in the game's axes, the way the animation code
will (three.js Euler angles, degrees):

```python
mb.pose({"jaw": {"x": 25}, "head": {"x": -15}, "tail_1": {"y": 14}, "arm_L": {"x": -55, "z": 25}})
```

| Angle | Positive means |
| --- | --- |
| `x` | nose down (a jaw opens, a head nods, an arm swings back and down) |
| `y` | turn to the model's left (same sign as the game's heading) |
| `z` | roll: left side up |

`"move": (x, y, z)` shifts a node in game axes. `mb.clear_pose()` returns to rest; `export_glb`
refuses a posed scene. Usually you pass `pose=` to a preview instead and it cleans up itself.

**Contact sheet**: `mb.contact_sheet(name, extra=[...], pose=..., show=..., out=...)`

- Default views: front, left side, back (flat views sharing one scale) and a three-quarter view.
- More: `"right"`, `"top"`, `"three_quarter_back"`, or your own camera:
  `mb.View("FIRST PERSON", node="cam_fp", fov=80, pose={...})` sits on a node and looks forward;
  `mb.View("LOW", azimuth=60, elevation=5)` orbits (azimuth 0 = in front, 90 = at the model's
  left, 180 = behind); `mb.View("X", eye=(..), target=(..))` is free.
- Reading it: the horizontal line is the ground, the **yellow triangle is the origin**, the bar
  is the scale, the corner notes say which side is the model's left and which way is front.
  **Magenta = a face seen from behind = a hole in the game.** The dark disc in perspective
  views is centered on the origin.
- Assets with a `cam_fp` node automatically get a first-person cell. Give it a pose with the
  arms raised: the snout and hands must look good from there.

**Concept shot**: `mb.concept(name, backdrop="sky", azimuth=32, elevation=9, fov=32, zoom=1,
pose=..., out=...)`. Backdrops: `"sky"`, `"sunset"`, `"night"`, `"studio"`, or `None` for a
transparent background (portraits: add `size=(512, 512)`). Key light, rim light, sky light, soft
shadow on a checkered floor that fades into the horizon. A low `elevation` looks up at the model
and makes it feel big. Pass a list of option dicts to `@mb.asset(concept=[...])` (each with a
`"name"`) for several shots.

Both functions render **whatever is in the scene**: the model you just built, or a file loaded
with `mb.load_glb("asset_id or path")`. So any `.glb` can be re-rendered by anyone:

```bash
tools/art/preview.py prop_hydrant                          # both pictures to /tmp/mb-scratch/preview/
tools/art/preview.py kaiju_lizard_s1 --pose "jaw.x=25,arm_L.x=-60" --cam cam_fp --backdrop sunset
tools/art/preview.py path/to/any.glb --sheet --extra top
```

While iterating, write to scratch, not to `docs/`: `mb.contact_sheet("x",
out="/tmp/mb-scratch/<task>/x.png")`, or `img, _ = mb.render_view("front")` for a single view.

Rendering uses the Cycles renderer on the processor, capped at 2 threads (`THREADS` in
`lib/mb_preview.py`); it needs absolute output paths, which the kit takes care of. The other
renderers were tried on this machine: the workbench renderer works headless but cannot show the
glow or atlas materials; the real-time renderer needs half a minute to start. Contact sheets do
their lighting in the shader, so they are noise-free and take about a third of a second per view.

## 9. Buildings: states, chunks, atlas

A structure file holds every state on the same spot, as sibling nodes:

```python
mb.node("intact", intact_geo)
mb.node("damaged", damaged_geo)            # same silhouette: holes, scorch, missing corners
mb.node("rubble", rubble_geo)              # low grey pile inside the footprint
mb.chunk_nodes(mb.shatter_box(lo, hi, cuts=(2, 2, 3), color="bld_cream"))   # chunk_00 .. chunk_11
```

- `mb.shatter_box(lo, hi, cuts)` breaks a box-shaped volume into uneven blocks (outside faces
  keep the wall color, broken faces get a rubble color). `mb.chunk_nodes(geos)` turns any list of
  `Geo`s into `chunk_NN` nodes with each origin at the piece's own center, as the contract asks.
  You need 6 to 24 chunks of at most 30 triangles.
- The triangle budget applies to each state separately. The manifest `tris` and `size` of a
  structure are those of `intact`.
- `run_family` renders the sheet with one state per cell (intact views, then damaged, rubble and
  the chunks spread apart) because all states overlap in the file. In your own calls use
  `show=("intact",)` or `mb.View(..., show=("chunk_*",), explode=0.45)`.
- Footprint and height come from `tools/art/data/archetypes.json` (`npm run export:defs`). When
  that file exists the validator compares the model against it and derives the size class by
  the same rule as the game code (bounding volume under 2500 cubic meters small, under 30000
  medium, else large). Until then pass `size_class="small"` to `@mb.asset`.

**Atlas texture coordinates.** `mb.atlas_rect(col, row, grid=(cols, rows))` is the rectangle of
one cell of the atlas image; column 0 is the left, **row 0 is the top row**. Then:

```python
body = mb.box((10, 8, 12), anchor="bottom", color="bld_cream")
body.uv_fit(mb.atlas_rect(1, 0), where="front")      # the whole front wall shows cell (1, 0)
body.uv_fit(mb.atlas_rect(2, 0), where="side")       # each side wall shows cell (2, 0)
```

`uv_fit` switches those faces to the `city_atlas` material. On walls the picture is upright and
not mirrored when seen from outside; on roofs its top is toward the model's back. `quad(...,
uv_rect=)` and `grid_quad(a, b, c, d, nu, nv, rect_fn)` (a wall split into tiles, each with its
own cell) cover the rest. Set `mb.ATLAS_GRID = (cols, rows)` once and drop the `grid=`
argument. An atlas cannot repeat: texture coordinates must stay inside 0..1.

Previews show `client/public/assets/textures/city_atlas.png` on those faces (and
`city_atlas_emissive.png` on the night backdrop). Until it exists they show a colored grid;
`mb.set_preview_atlas("/path/to/draft.png")` uses a draft. Nothing is ever embedded in the
`.glb`. Proof picture with numbered tiles: `docs/art/conventions/structure_test_sheet.png`.

## 10. Validation

```bash
tools/art/validate.py prop_hydrant                       # by asset id
tools/art/validate.py path/to/file.glb --kind vehicle    # any file
tools/art/validate.py client/public/assets/manifest.props.json   # a whole family + stale entries
tools/art/validate.py --all                              # every partial manifest and stray file
```

It parses the `.glb` itself and prints one line per rule. `FAIL` breaks the contract; `WARN` is
probably a mistake; `--strict` treats warnings as failures; `-q` prints only problems.

| Rule | Checks |
| --- | --- |
| `container` | binary glTF 2.0 with everything inside the one file |
| `no-textures` | no images or textures embedded |
| `no-animation` | no keyframes, armatures, morphs, cameras, lights |
| `node-names` | unique, letters/digits/underscore only |
| `transforms` | nodes are position-only |
| `materials`, `attributes` | only `vcol`, `glow`, `city_atlas`; vertex colors and texture coordinates where needed |
| `flat-shading`, `winding`, `inside-out` | one normal per triangle; closed shapes face outward |
| `required-nodes`, `anchors`, `hierarchy` | node names from ASSETS.md; anchors are empties; `weak_point` glows; the lizard tree is wired as drawn |
| `single-mesh` | props are exactly one mesh node |
| `left-right`, `facing` | `_L` on +X and `_R` on -X; `cam_fp`, `mouth`, `muzzle`, `head` toward +Z, tail toward -Z |
| `origin` | stands on y = 0 with the origin inside the footprint (or centered, for flying things) |
| `size`, `true-size`, `archetype`, `prop-size` | plausible meters; lizard stages 4.5 / 32 / 115 m tall (within 10%); egg and cocoon 1 m; structures match their archetype; props match the height and radius the game uses (warning) |
| `budget`, `states`, `chunks` | triangle budgets; damaged/rubble/chunk rules for structures |
| `manifest` | the manifest entry still matches the file |

`facing` can only be checked on models that have a front anchor. For the rest (props,
buildings) look at the FRONT cell of the contact sheet: it must show the model's front.
`tests/test_validator.py` builds 26 broken models and files and proves each rule fires.

## 11. Manifests

`run_family` writes `client/public/assets/manifest.<family>.json` for you. By hand:

```python
man = mb.Manifest("city")                     # loads the existing partial; entries are merged
man.add_model("bld_shop_a", kind="structure") # nodes, size [w, h, d] and tris measured from the .glb
man.add_texture("city_atlas", grid=(8, 8))
man.add_texture("ground_grass", tile=True)
man.write()
```

`size` is `[width, height, depth]` in the game's axes, `tris` the triangle count (of `intact`
for structures), `nodes` every node name in hierarchy order, `chunks` the number of `chunk_NN`
nodes. Never edit `manifest.json`; `npm run assets:manifest` merges the partials.

## 12. Rebuilding and testing

```bash
tools/art/build_all.sh               # every marked script in order, then validate.py --all
tools/art/build_all.sh --no-previews # fast: export and validate only
tools/art/build_all.sh --force       # re-render every preview
tools/art/tests/run_all.sh           # the pipeline's own tests (about 30 s)
```

The tests write their models to `/tmp/mb-scratch/art-tests/` and their proof pictures to
`docs/art/conventions/`. Run them after changing anything in `lib/`.

## 13. Things that will bite you

- **Front is negative Y while you author.** If the FRONT cell shows a back, flip your Y signs.
- **Magenta on the sheet** is a face seen from behind. Either the winding is wrong (list the
  corners counter-clockwise seen from outside, or use the builders) or the face is a thin sheet
  that needs `two_sided=True`.
- **`export_glb` says a node is rotated or scaled**: you left a pose on, or rotated an object
  instead of its geometry. `mb.clear_pose()` or `mb.apply_transforms()`.
- **Over budget**: open the hidden ends (`cap_*=False`), use fewer sides (`n=6` reads as round at
  game distance), fewer lathe bands, and one big shape instead of two small ones.
- **A part does not move with its parent in a pose**: it was parented to the wrong node, or it
  is geometry inside the parent's mesh instead of its own node.
- **Pivot in the wrong place** shows immediately in a posed view: add one to the sheet.
- **Faces between two builders are never merged.** Shapes may overlap and poke into each other
  freely; that is the style, and hidden faces only cost triangles, not correctness.
- **One material per mesh where you can.** Each material on a node is a separate draw call in
  the game, and props are drawn by the thousand.
- The first-person camera's field of view in previews is 80 degrees (horizontal); the game's
  may differ, so judge composition, not exact framing.
- Scratch files go to `/tmp/mb-scratch/<your task>/`, never into the repository.
