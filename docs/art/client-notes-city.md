# Client notes: city buildings

**Applied** (12 November, the client's city task): sections 1 to 4 are in the client as
suggested (atlas read unflipped and mipmapped, masked wall tint with a separate damage shade,
the real chunk meshes in one dynamic buffer). The tint also takes the district's building
tint (`docs/CITY.md` section 2); landmarks keep their own colors. Section 6 is still open.

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
- `COLOR_0` is RGBA. RGB multiplies the atlas. **Alpha is a tint mask**: 1 on wall faces that
  may take the building's color, 0 everywhere else (the same convention as the cars' paint
  mask). The manifest entry says so:
  `"tint": {"part": "wall plaster", "mask": "...", "blend": "multiply", "base": "#f3e3b3",
  "colors": ["#f3e3b3", "#f2a48b", ...], "hint": "..."}`, plus `"district"`.
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

## 2. Per-building wall colors (tint)

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

- District roof colors (CITY.md: `house_b` has terracotta roofs on Temple Hill, red tile
  elsewhere) need a second choice per instance. The cheapest route is two models (`house_b`
  and a district variant) or a second mask channel (`COLOR_0` RGB of the roof faces set to a
  marker); not done.
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

