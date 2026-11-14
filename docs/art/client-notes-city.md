# Client notes: city buildings

**Applied** (12 November, the client's city task): sections 1 to 4 are in the client as
suggested (atlas read unflipped and mipmapped, masked wall tint with a separate damage shade,
the real chunk meshes in one dynamic buffer). The tint also takes the district's building
tint (`docs/CITY.md` section 2); landmarks keep their own colors.

**Applied in phase 3** (14 November, the city client task): roofs colored by district. The
paint mask has three levels, 1 = wall, 0.5 = roof, 0 = neither, and the client reads them as
section 2, "Roofs", suggests: one more per-instance color (`instanceRoof`) beside the wall paint
and the damage shade, the four shades by `hash32(id, 92) % 4`, the falling pieces and the mounds
painted the same way, and the map's district ground taken from the roof color. The six new
buildings of section 8 draw, wreck, fall to pieces and leave mounds like the others.

For the client engineer who comes after the building artists. What the building files
(`bld_*.glb`, `lm_*.glb`, `textures/city_atlas.png`, `textures/city_atlas_emissive.png`) provide,
what the client does with them today (read in `client/src/render/structureGeometry.ts`,
`cityView.ts`, `materials.ts`, `client/src/assets/assetStore.ts`, `rigModel.ts`), and what to change
so they show at their best. Checked in the running client (sandbox, placeholder city, headless
Chromium): `docs/art/previews/city_kit_in_game.png`. The look itself: `docs/art/CITY_ART.md`.

## What a building file holds

- Nodes `intact`, `damaged`, `rubble`, `chunk_00`..`chunk_NN` (6 to 24), all at the origin
  except the chunks, whose node position is the chunk's own center (the mesh is centered on it).
- **One material**, `city_atlas`, on every face. Faces without a picture point at the atlas's
  white swatch; their color is the vertex color.
- `COLOR_0` is RGBA. RGB multiplies the atlas. **Alpha is a paint mask** with three levels:
  1 on wall faces that may take the building's color, 0.5 on roof faces that take the
  district's roof color (ordinary buildings only, section 2), 0 everywhere else (the walls
  follow the same convention as the cars' paint mask). The manifest entry says so:
  `"tint": {"part": "wall plaster", "mask": "...", "blend": "multiply", "base": "#f3e3b3",
  "colors": ["#f3e3b3", "#f2a48b", ...], "hint": "..."}`, plus `"district"`, and on buildings
  with roof faces `"roof": {"part": "roof", "mask": "...", "blend": "multiply",
  "base": "#d9d9d9", "hint": "..."}`.
- `TEXCOORD_0` into the 1024 x 512 atlas, glTF convention (v = 0 is the **top** of the image).

## 1. Must fix: the atlas is sampled upside down (one line)

`AssetStore.preload` loads both city atlases with `THREE.TextureLoader`, which leaves
`texture.flipY = true`. glTF texture coordinates start at the top of the image (GLTFLoader sets
`flipY = false` on its own textures for this reason), so every building samples the mirrored
row of the atlas: by day the walls come out dark grey (they read the reserved grey blocks at
the bottom of the atlas), at night the towers are black. Fix: in `prepareTexture` (or right
after loading) set `texture.flipY = false` for `city_atlas` and `city_atlas_emissive`
(`needsUpdate = true`). Verified in the page by setting exactly that on
`materials.cityAtlas.map` and `.emissiveMap`: walls, roofs, doors, signs and lit windows all
appear as in the contact sheets, at the right place and scale (left column: today; right: fixed).
The procedural stand-in canvases for these two ids would then also be read unflipped, which is
harmless (they are only used when the files are missing).

## 2. Per-building wall colors (tint) and district roof colors (the paint mask)

Today a structure with a real model gets the instance tone white (`cityView.ts`,
`buildStructures`), so all 333 copies of `house_a` are the same cream house. The files carry
what is needed to vary them:

- Use a masked material for structures whose manifest entry has `tint`, as `materials.paint`
  does for cars (`maskInstanceColor`), but on the atlas material. The damage shade
  (`colorFor`: 0.86 and 0.6 for the damaged stages) must still darken the unmasked faces, so
  pass it separately, for example a per-instance float `instanceShade`:
  `vColor.rgb *= mix(vec3(instanceShade), instanceColor.rgb * instanceShade, color.a);`
- The instance color for masked faces is `tint / base` per channel (`base` is the authored wall
  color, in the manifest), so a wall shows the tint exactly and keeps its painted light and
  shade. Values above 1 are expected (a white tint on a cream base); `instanceColor` is a float
  buffer, so that is fine. Pick the tint per structure by `hash32(s.id)` over `tint.colors`.
- `toneOf()` (the map view, chunk colors) should return the tint for real models too, not
  white.
- The masked faces are opaque: never make this material transparent, or alpha-0 faces vanish.

### Roofs: the district's roof color (phase 3, applied)

**In the client** (`client/src/render/materials.ts` `cityTint`, `cityView.ts` `roofPaint`): exactly
as below. The shader reads the mask with the margins given here (`PAINT_MASK`); the roof paint is
a per-instance attribute `instanceRoof` on every building batch (no extra draw call); the
falling pieces take it on their 0.5 faces; the mounds keep the roof slab's mark, so a ruin shows
a patch of its district's color. Roofs never glow at night (the emissive atlas is black under
every grey roof region). Landmarks, bridges and the three special buildings get white (their
models mark no roof faces anyway). The map (`client/src/ui/mapView.ts`) keeps its buildings in
the colors of their state, so the district's roof color goes on the ground under them instead,
sunk into the dark map. Checked in the browser by day, at sunset and at night, from a juvenile's
and a titan's height over three corners of the city, damaged, in rubble, with pieces falling,
and on the map (`node tools/playtest/shots.mjs --only x-city-roofs`).

The roof faces of every ordinary building now carry **alpha 0.5**: pitched and flat roofs,
dormer roofs, small canopy roofs, in every state (intact, damaged, the collapse chunks, and the
first slab lying on the rubble, which is a piece of the roof so a ruin keeps a patch of its
district's color). They are drawn in light neutral grey that averages `#d9d9d9` in linear
light (the atlas's grey roofs: clay tiles, slates, round tiles, a flat membrane, corrugated
metal, a plain grey), so a roof multiplied by `roof color / base` shows the district's color
on average, with its tile, slate or seam pattern as lighter and darker lines. Chimneys, plant
rooms, water tanks, parapet tops, skylights, signs, verge boards and undersides keep 0.

Read the levels with margins: **above 0.75 = wall, 0.25 to 0.75 = roof, below 0.25 =
neither** (the files hold exact floats 0, 0.5 and 1; a copy squeezed into bytes holds 128/255).

What to draw, per instance, still in one batch per archetype and state (no extra draw calls):

- `roofColor` = `District.roof` of the district the structure's center is in (the city data,
  beside `District.tint`), times one of a few shades picked by the structure's id so a street
  is not one flat color. Suggested, and what the picture below uses: four shades,
  `[0.84, 0.92, 1.0, 1.1]` (multipliers on the linear color), picked by
  `hash32(id, 92) % 4`.
- `roofPaint = roofColor / base` per channel, `base` from the entry's `roof` (`#d9d9d9`).
  Values above 1 are fine, as for the wall paint.
- A district without a roof color, or a model without a `roof` entry: `roofPaint = (1, 1, 1)`
  (the second case has no roof faces anyway).

A shader that does both paints and the damage shade:

```glsl
// instanceColor: wall paint (tint / base); instanceRoof: roof paint; instanceShade: damage shade
float wall = step(0.75, color.a);
float roof = step(0.25, color.a) * (1.0 - wall);
vec3 paint = mix(vec3(1.0), instanceColor.rgb, wall) * mix(vec3(1.0), instanceRoof, roof);
vColor.rgb *= paint * instanceShade;
```

- **Falling chunks** carry roof faces too: when a chunk is written into the dynamic buffer,
  multiply its 0.5 faces by its building's roof paint (and its 1 faces by the wall paint), or
  roof pieces fall light grey.
- **The map** sees buildings from above: for a model with a `roof` entry, `toneOf()` could
  return the roof color, which is what the decision asks the map to show.
- **Who has roof faces**: every ordinary building except those listed with a reason in
  `tools/art/city/style.py` (`OWN_ROOFS`): the three special buildings, the storage tank (its
  lid is the tank's own steel), the harbor crane and the container stack (no roof), `tower_c`
  (its slanted roof is dark glass) and the pavilion (a striped canvas tent, painted like the
  awnings). Landmarks and bridges have none. Copper crowns and lanterns (`office_c`,
  `campus_a`), glass roofs and skylights, and the pool and sun-deck roof of `apartment_b` keep
  their own colors too.

Pictures: `docs/art/previews/city_roofs_test.png` (every ordinary building, intact, damaged,
rubble and chunks, roof faces in a loud green: which faces carry the mask) and
`docs/art/previews/city_roofs_districts.png` (one street in four districts' roof colors, then
the Cinder Works and Downtown: what the client should end up drawing; made by
`tools/art/city/roofs.py` with the colors of `shared/src/city/meridian/layout.ts`).

## 3. Collapse chunks: draw the real pieces

`fromModel` turns each `chunk_NN` into a box of its bounding size (`STUB(render)`), and
`addChunk` colors it with the building's tone, white for real models: a collapsing house throws
big white boxes (bottom left of the in-game picture). The files have real chunk meshes (convex
pieces at most 30 triangles each, textured with the wall they came from, broken faces in the
rubble texture). Suggested: keep each archetype's chunk geometries, and draw the falling chunks
as one dynamic geometry with the atlas material, rebuilt each frame from the live chunks
(480 chunks x 30 triangles is 14,400 triangles of CPU transforms: one draw call). The tumbling
physics in `update` can stay as it is; use each chunk's mesh instead of the unit box. Until
then, a cheap improvement: color the box with the tint (section 2) instead of white.

## 4. Distant facades shimmer

The atlas is drawn with `NearestFilter` and no mipmaps (`prepareTexture`, `tile = false`), so
window grids on towers seen from far away alias into moving patterns. Recommended for the two
city atlases: `generateMipmaps = true`, `minFilter = NearestMipmapLinearFilter`, keep
`magFilter = NearestFilter`. Facades, roofs and plain walls are blocks of 64 pixels, so the
first mip levels stay inside them; the small pictures (doors, signs, railings) blur into their
neighbors at a distance, where they are a pixel or two anyway.

## 5. Things that already work (no change needed)

- Night: `materials.setNight` drives `emissiveIntensity` of the atlas material (0 by day, 0.35 at
  sunset, 1 at night); the emissive atlas lights windows, signs and beacons and, on damaged
  buildings, fires in broken windows. Emissive ignores vertex and instance color, which is
  right: the damaged state points at the wrecked twin regions, whose emissive is fire, not lights.
- States: `intact`, `damaged`, `rubble` are drawn in place, same scale (`matrixFor`), on the
  structure's yaw; the models face +Z like the archetypes. Footprints match the simulation
  boxes within max(0.25 m, 2%).
- Draw calls: one material, so one instanced batch per archetype and state. Measured in the
  sandbox: 79 calls in the afternoon at street level, 96 at night over downtown (everything on
  screen), no console warnings.

## 6. Later

- District roof colors: done in the models and in the client (phase 3; a third mask level,
  section 2, "Roofs").
- Bridges (class `bridge`, passable): with a model the client draws it like any building. The
  deck must sit at ground level in the file (units drive on the ground plane) and everything
  above it stays at the outer edges; nothing in the client changes.

## 7. The special buildings (phase 2)

`bld_substation_a`, `bld_gasstation_a` and `bld_radiomast_a` are ordinary building files and
draw correctly with no client change. On top of the usual nodes they carry anchors for effects
(`docs/ASSETS.md` section 3, "Special buildings"):

- `spark_00`..`spark_05` (substation), `light_00`..`light_03` (gas station), `lamp_00`..`lamp_02`
  (radio mast) are **empties**: read their positions (building frame, meters) and put the
  crackle, the flicker or the blinking red glow there. They are numbered, so match by prefix.
  The manifest entry's `nodes` lists them. The lamps and the flame sign already glow a little
  through the emissive atlas at night; the anchors are for the moving part.
- `top` (radio mast) is a mesh on the same `city_atlas` material: a spare copy of the mast's
  top 8 m with its origin at the break (0, 16, 0). `intact` holds the whole mast, so the
  instanced batch needs nothing new; show `top` only for the fall, in place of `intact`'s
  upper part, never beside it.
- Their collapse chunks are hand-made parts (pumps, canopy slabs, transformer tanks, gantry
  posts, mast bays), not grid cuts, and all use the atlas like every other chunk.

## 8. The small buildings of the starting neighborhoods (phase 3)

`bld_bungalow_a`, `bld_duplex_a`, `bld_garage_a`, `bld_diner_a`, `bld_firehouse_a` and
`bld_motel_a` are ordinary building files: they draw correctly with no client change, and take
the wall color and the district's roof color through the same mask as every other building
(section 2). No anchors, no extra nodes. Entries are in `manifest.city_starts.json` (merged into
`manifest.json`), each with `tint`, `district` and `roof`.

| Model | Size (width x depth, height) | Nodes | Triangles (whole / damaged / rubble) | Notes |
| --- | --- | --- | --- | --- |
| `bld_bungalow_a` | 10 x 9 m, 5 m | `intact`, `damaged`, `rubble`, `chunk_00`..`chunk_05` | 70 / 112 / 73 | The porch is open: the hatchling can see through it. Wall color on the boards. |
| `bld_duplex_a` | 12 x 10 m, 7 m | the same, 6 chunks | 76 / 111 / 73 | Two doors, one red and one blue; the small porch roofs take the roof color too. |
| `bld_garage_a` | 8 x 7 m, 4 m | the same, 6 chunks | 40 / 100 / 73 | The lowest building in the city: the hatchling looks over it. |
| `bld_diner_a` | 16 x 10 m, 5 m | the same, 6 chunks | 64 / 120 / 71 | Rounded ends (the collision box is still the 16 x 10 m rectangle). The roof sign stands on the model's right half and reaches the full 5 m; the body is 3.25 m. Every window and the red line under the roof glow at night (emissive atlas). |
| `bld_firehouse_a` | 14 x 16 m, **12 m** | the same, 8 chunks | 50 / 108 / 67 | The hose tower (2.8 m square, at the back corner on the model's left) is 3 m taller than the archetype's 9 m; the manifest `size` says 12. Use the archetype's 9 m for anything about collisions and the model's bounds for anything about drawing (culling, the wobble pivot, falling chunks). Brick: no wall color, by design. |
| `bld_motel_a` | 24 x 10 m, 7 m | the same, 8 chunks | 84 / 102 / 71 | The walkway and stair are thin sheets drawn from both sides (two faces each). The sign's pole stands at the front right corner, inside the footprint. |

The six add no draw calls beyond their own batches (one material, like every building).

**In the client** (phase 3, the city client task): confirmed in the browser (`node
tools/playtest/shots.mjs --only x-city-starts`): each draws whole in its district's roof color,
damaged, falling to pieces and as a mound with its roof slab on top; the firehouse's hose tower
draws at its full 12 m with no change (the instanced batches are never culled by bounds, the
sway turns about the base, and its pieces are placed from the model). Whatever a model lacks, a
box stand-in takes its place through every state (`client/test/city.test.ts`).

