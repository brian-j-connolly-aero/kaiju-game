# The city kit: how to make a Port Meridian building

For the five building artists. The look and its rules are `docs/art/CITY_ART.md` (read it
first: sizes, districts, night, states, budgets). The art pipeline underneath is
`tools/art/README.md`. This kit sits on top of it: you write only the intact building; the kit
derives the damaged, rubble and chunk states, exports, checks and photographs.

```
tools/art/city/
  style.py      sizes in meters, the fit tolerance, district color families
  atlas.py      the shared atlas: named regions and the painter (both images)
  atlas_extra/  one file per family that needs its own atlas pictures (_template.py)
  geom.py       faces, atlas mapping, clipping (you rarely touch it)
  kit.py        Building and its parts; @kit.building and kit.run_family
  destruct.py   THE generator for damaged, rubble and chunks (one for every building)
  budgets.py    triangle budget per archetype, and the city's counts
  check.py      the city check (on top of tools/art/validate.py)
  sheet.py      the city contact sheet, and lineup() for beauty shots
  count_city.ts counts the archetypes in the real city (npx tsx tools/art/city/count_city.ts)
tools/art/city_kit.py      builds the atlases (runs first in build_all.sh)
tools/art/city_samples.py  bld_house_a, bld_tower_a, bld_factory_a: worked examples
```

Run everything with `/opt/mbtools/venv/bin/python`.

## 1. A building in ten lines

Make your family script, for example `tools/art/city_homes.py`:

```python
#!/opt/mbtools/venv/bin/python
# mb-family: city_homes
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)
from city import kit

@kit.building("house_b", district="suburb", tone="salmon", seed=11)
def house_b(b):
    body = b.block(10.25, 7.0, 3.4, at=(0, 0.6, 0), facade="plaster_sash", roof=False)
    b.hip(body, rise=2.9, roof="tile_red")
    b.door(body, "front", x=0.0, kind="door_green")
    b.box((-2.5, body.y0 - 1.6, 0), (2.5, body.y0, 0.3), color="#bdb9b0")      # porch floor
    b.chimney(3.0, 1.5, 3.4, 6.9)

if __name__ == "__main__":
    raise SystemExit(kit.run_family("city_homes"))
```

Then `tools/art/city_homes.py --only bld_house_b` writes `client/public/assets/models/bld_house_b.glb`,
its entry in `manifest.city_homes.json` (with the tint colors), and the sheet
`docs/art/previews/bld_house_b.png`. Look at the sheet. Repeat.

## 2. The parts

Coordinates: x = the building's own left, -y = its front (the street side), z = up, meters,
origin in the middle of the footprint on the ground. `b.W`, `b.D`, `b.H` are the archetype's
box. Faces are textured by **atlas region names** (`docs/art/previews/city_kit_atlas.png` shows
them all; `atlas.REGIONS` lists them).

| Call | Makes |
| --- | --- |
| `b.block(w, d, h, at=(x, y, z0), facade=, ground=, ground_h=4.5, sides={}, roof="gravel" / None / False, parapet=0, parapet_region=, tint=, tone=)` | box body: walls in bands (optional 4.5 m ground storey, then the facade), flat top. `sides={"left": "plaster_plain"}` overrides one side, `None` leaves it out (against another block). `roof=False` when a pitched roof covers it. Returns a `Block` (`x0 x1 y0 y1 z0 z1 w d h cx cy`). |
| `b.wall(p0, p1, z0, z1, region)` | one wall (p0 left, p1 right, seen from outside) |
| `b.gable(blk, rise, along="x"/"y", roof=, window=True)` | pitched roof, gable ends, attic window, verge and fascia boards |
| `b.hip(blk, rise, roof=)`, `b.upturns(blk, z)` | hipped roof; turned-up corners for shrines and the temple |
| `b.shed(blk, rise, high="back")` | mono-pitch (lean-to) roof |
| `b.sawtooth(blk, teeth, rise, roof="metal", glass="glass_roof")` | north-light factory roof |
| `b.dome(center, r, z0, height=, region="copper")`, `b.cone(center, r, z0, z1)` | domes; spires and pointed roofs |
| `b.prism(center, r, z0, z1, n=8, region=, radius_top=, tone=, solid=)` | tanks, drums, columns, round chimneys, lighthouse shafts |
| `b.box(lo, hi, color= / region=, top=, bottom=, tone=, solid=)` | anything boxy: canopies, plinths, containers (`region="metal_plain", tone="#e07b39"`) |
| `b.beam(p0, p1, width, color=)` | girders, crane booms, lattice members, legs, wheel spokes |
| `b.door(blk, side, x, kind)` | `door_red/green/blue` replace a whole window bay (snapped); `door_double`, `door_garage`, `door_roller` are laid on the wall |
| `b.decal(blk, side, x, z, w, h, region)` | any picture flat on a wall |
| `b.sign(blk, side, picture, x=, z=, height=, blade=False)` | picture signs (`atlas.SIGNS`: cup, loaf, fish, shoe, scissors, key, glasses, bowl, cone, flower, wrench, book, pill, note, rings, chevron) |
| `b.awning(blk, side, x0, x1, depth=, drop=, stripes="awning_red")` | canvas awning (red, green, blue, gold) |
| `b.balconies(blk, side, storeys, rail="rail_metal")` | a balcony band on each listed storey |
| `b.chimney`, `b.roof_box`, `b.water_tank`, `b.antenna(beacon=True)` | roof clutter; the beacon glows red at night |
| `b.keepsake = Mesh` | what stays recognizable on the rubble (landmarks); position it yourself |
| `b.bite_hint = (x, y, z)` | where the damage bites first (default: a top front corner) |
| `b.damage_hook = fn(b, mesh)` | bespoke extra damage (a bent spire, a fallen mast) |
| `b.holes = n` | how many holes the damage punches through the walls (default 1 to 3 by height); fewer when a hook does the named damage (the station's vault falls in: 1) |
| `b.parts = [mark, ..]` | parts that stand or fall together: their faces carry the mark in their tag (`"detail\|p3"`). A hole cuts a part like anything else; the part goes whole only when the hole takes more than half of it. The families' `part(b)` / `balcony` helpers do this for you |

`solid=True` (blocks and roofs are solid already) tells the kit that a part is a closed volume:
chunks are cut from solids and the holes of the damaged state open into them.

## 3. The checklist

1. **Fit**: the whole intact model, overhangs and masts included, fills the archetype's box
   within max(0.25 m, 2%) on every side and is centered. Make bodies smaller by the overhang
   (eaves 0.375 m) so the roof reaches the box. The kit stops with the numbers if not.
2. **Scale**: whole bays and storeys from the atlas, 3 m storeys, 4.5 m ground storeys; doors
   from `kind=`. No stretched windows.
3. **Budget**: intact, damaged and rubble each within `budgets.BUDGETS`. Leave about a third of
   the budget free: the damage cuts faces and adds the broken interior.
4. **One material**: never `mat="vcol"` or `glow`; glowing things use the swatches `lamp`,
   `beacon`, `neon_pink`, `neon_mint`, `lit_glass`.
5. **Front** is -y: the FRONT cell of the sheet must show the street side.
6. **No magenta** on the sheet (a face seen from behind is a hole in the game); thin sheets
   that are seen from both sides need a second, reversed face. In the damaged and rubble
   states the kit adds the back sides a hole exposes itself (it casts rays from behind every
   face toward the viewer directions and backs what they can see), within the budget.
7. **No words**: signs are pictures. **No real symbols**: no cross (not even a pharmacy's), no
   crescent, no six-pointed star, nothing from a real faith, brand or building.
8. **Night**: look at the NIGHT cells: windows lit, nothing else glowing by accident.
9. **District**: `district=` sets the tint colors; `tone=` the default wall color the file shows.
10. Run the checks (below). Both must PASS.

## 4. Running things

```bash
tools/art/city_kit.py                               # atlases + docs/art/previews/city_kit_atlas.png (3 s)
tools/art/city_samples.py [--only bld_tower_a]      # build, validate, check, sheet (1 s per building,
                                                    #   plus about 7 s for its sheet when it changed)
tools/art/city_samples.py --no-previews             # geometry only, fast iteration
tools/art/city/check.py bld_house_a                 # the city check alone; --all for every building
tools/art/validate.py bld_house_a                   # the pipeline's contract check
tools/art/city/sheet.py bld_house_a --out /tmp/mb-scratch/<you>/x.png   # re-render a sheet
/opt/mbtools/venv/bin/python tools/art/city/budgets.py                # the budget table
npm run assets:manifest                             # merge the manifests for the game
```

A sheet is re-rendered only when the model or the atlas changed (`--force` to insist). It
shows: FRONT (flat, scale bar), THREE-QUARTER, BACK, STREET LEVEL (eye 1.7 m), NIGHT, DAMAGED,
DAMAGED NIGHT, RUBBLE (framed like the building, so you see how low it is), CHUNKS pulled apart,
with a 1.8 m soldier and the 4.5 m hatchling as dark silhouettes at the front right corner.

For a beauty shot of several buildings: `sheet.lineup(["bld_house_a", ...], out=..., backdrop="sky")`
(about 15 s; see `docs/art/concept/city_kit_lineup_sky.png`).

## 5. Your own atlas pictures

Each family has a reserved block of the atlas (`atlas.BLOCKS`: homes, blocks, industry,
landmarks). Copy `atlas_extra/_template.py` to `atlas_extra/<family>.py`, define your regions
inside your block and paint them (pixel by pixel, numpy arrays; the helpers `fill`,
`sash_window`, `brick`, `corrugated`, `roof_tiles`, `light_windows` are in `atlas.py`).
Facades and plain walls get a damaged twin with `twin=(x, y)`; the kit paints it. Then run
`tools/art/city_kit.py` and your building script. Only ever edit your own file: the atlas
is shared by everyone, and the kit's regions never move.

## 6. Notes for particular lists

- **Bridges** (`bridge_a`, `bridge_b`, class `bridge`, passable): units and vehicles drive on
  the ground plane through the box, so the deck sits at ground level (top at about 0.3 m) over
  the whole 74 m or 110 m, and everything that stands up (rails, lamps, arches, trusses) stays
  within the outer metre of each side. Nothing may go below y = 0 (the validator fails it).
- **Landmarks**: budget 1500. Give each a `keepsake` (CITY.md names it: the lantern, the
  green dome shell, the round window frame...), and a `damage_hook` for the named damage
  (a snapped spire, a bent mast) on top of the generic one.
- **Temple Hill**: invented motifs only (tiers, upturned corners, terracotta and gold bands).
- **Tall thin things** (crane, mast, wheel): beams, few of them; leave chunks and damage to
  the kit, and check the CHUNKS cell: a lattice is cut from its `solid` parts only.

## 7. What the client does with all this today

The game already draws these files, with three known gaps (atlas upside down until the client
sets `flipY = false`, every copy the same color until it applies the tint, chunks drawn as
white boxes): `docs/art/client-notes-city.md`. Build to the files, not to the gaps.
