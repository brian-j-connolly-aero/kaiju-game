# Client notes: sprites, effects, ground tiles and clouds

For the client engineer. The art director's review of this family (soldiers, civilians, the
effects sheet, the five ground tiles, the two cloud panoramas) found things that only code in
`client/src` can finish. The art side of every note is done and checked; this page says what
to change in the client, with the numbers, and how to check each change. Nothing in
`client/src` was touched by the art work.

- File and line references are to the tree at commit `06c498a` (`client/src` has no
  uncommitted changes there).
- Run `npm run assets:manifest` first if `manifest.json` is stale: the sprite and texture
  entries changed (new fields `blend` and `ring`, four new sprite ids, walk speed).
- Review pictures, all in `docs/art/previews/`, all redrawn by `tools/art/sprites/build.py`:
  `sky_ring.png`, `sky_views.png` (note 1), `fx_blend.png` (note 2), `sprites_in_game.png`,
  `ground_views.png`. The pictures "in the game" are drawn by a small software camera,
  `tools/art/sprites/gameview.py`, which copies the client's ground mapping, sky colors,
  lenses and fog, and implements the cloud mapping asked for in note 1 (function `ring_uv`).
  Use it as the reference when in doubt.
- Axes are the game's: x east, y up, z north; a heading of 0 looks along +z and grows toward
  +x (`aimCamera` in `client/src/game/controllers/types.ts` line 44). Azimuth below is
  measured the same way: `atan2(x, z)`.

Summary, most important first:

| # | What | Where | Severity |
| --- | --- | --- | --- |
| 1 | Clouds: two horizon rings in place of the two overhead planes | `client/src/render/sky.ts` lines 129, 162 to 175, 252 to 256, 273 to 278; `client/src/assets/manifest.ts` line 30 | must |
| 2 | Effects: draw explosion, fire and flash with ordinary alpha blending, glow underneath | `client/src/render/effects.ts` lines 13, 61 to 63, 119 to 122, 164 to 167, 189 to 194, 239; `manifest.ts` line 23; `spriteAtlas.ts` lines 19 and 104 | must |
| 3 | Laser dot and beam glows: stop using the muzzle flash for them | `client/src/render/unitsView.ts` line 280; `client/src/render/kaijuView.ts` lines 237 and 248 | should (follows from 2) |
| 4 | Debris: four one-frame sprites, pick one per particle | `client/src/render/effects.ts` line 74 | nice |
| 5 | Fire and the ground explosion stand on the bottom edge of their cell | `client/src/render/effects.ts` lines 119 and 190 | nice |
| 6 | Nothing to do: walk speed, soldier and civilian sheets, ground scale | | information |
| 7 | Open, not part of this review: `ground_rubble` is never drawn; `ground_plaza` and `ground_far` have no art | `client/src/render/ground.ts` lines 68 and 93 | information |

---

## 1. Clouds on two horizon rings (must)

**What is wrong.** `clouds_a.png` and `clouds_b.png` are side views of cumulus towers standing
on the horizon (512 x 256, wrapping left to right only). `sky.ts` lines 162 to 175 lay them on
two horizontal planes 520 m and 760 m overhead, repeated 5 x 5 and 3 x 3, with fog. Seen from
below the towers become sheared slabs, and everything under about 20 degrees of elevation
dissolves into fog color.

**What to build.** Each panorama goes on the inside of an upright open cylinder (a ring)
that is centered on the camera and follows it in x, y and z. `clouds_b` is drawn first
(behind), `clouds_a` in front. No fog, no scrolling, fully opaque.

The numbers (also in the manifest: `manifest.textures.clouds_a.ring` and `.clouds_b.ring`,
shape `{ "repeats": n, "bottomDeg": degrees, "sunGap": [firstColumn, width] }`):

| | `clouds_a` | `clouds_b` |
| --- | --- | --- |
| repeats around the full circle | 4 | 3 |
| radius R | 6000 m | 6000 m |
| ring height = pi x R / repeats (keeps the 2:1 picture undistorted) | 4712.4 m | 6283.2 m |
| bottom edge, y relative to the camera = R x tan(-5 degrees) | -524.9 m | -524.9 m |
| top edge, y relative to the camera | +4187.5 m (34.9 degrees up) | +5758.3 m (43.8 degrees up) |
| `texture.repeat` | (-4, 1) | (-3, 1) |
| `texture.offset.x` (see "the sun gap" below) | 0.2547 | 0.8756 |
| draw order (`renderOrder`) | -50 | -51 |

R = 6000 keeps the farthest corner of the taller ring at 8316 m, inside the 9000 m far plane
that every lens uses (`setLens(camera, ..., 9000)`, for example `humanController.ts` line 305
and `kaijuController.ts` line 104). The fog ends at 4400 m at most (`FOG` in
`gameRenderer.ts` lines 74 to 78), so the rings must not take fog or they vanish.

In place of the plane loop at `sky.ts` lines 162 to 175:

```ts
const R = 6000;
for (const id of ['clouds_b', 'clouds_a'] as const) {          // b first: it stands behind a
  const fallback = id === 'clouds_a' ? { repeats: 4, bottomDeg: -5, sunGap: [258, 72] } : { repeats: 3, bottomDeg: -5, sunGap: [414, 58] };
  const ring = assets.manifest.textures[id]?.ring ?? fallback;
  const texture = assets.texture(id);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;                   // never repeat it vertically
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.repeat.set(-ring.repeats, 1);                        // negative: seen from inside, the painting must not be mirrored
  texture.offset.set(ringOffset(ring), 0);
  texture.needsUpdate = true;
  const height = (Math.PI * R) / ring.repeats;
  const bottom = R * Math.tan((ring.bottomDeg * Math.PI) / 180);
  const geometry = new THREE.CylinderGeometry(R, R, height, 48, 1, true);
  geometry.translate(0, bottom + height / 2, 0);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = id === 'clouds_b' ? -51 : -50;
  mesh.frustumCulled = false;
  this.clouds.push(mesh);
  this.group.add(mesh);
}
```

Why this is the right mapping in three.js 0.187 (checked in
`node_modules/three/src/geometries/CylinderGeometry.js`): a vertex at angle theta sits at
`x = R sin(theta), z = R cos(theta)`, so theta is the game's azimuth, and its texture
coordinate is `(theta / 2 pi, 1 at the top .. 0 at the bottom)`. The texture transform is
`u' = repeat.x * u + offset.x`. Looking along +z, screen right is -x, so the azimuth falls
toward the right of the screen; `repeat.x` must be negative for the painting to read left to
right as painted (light from the upper left).

**The sun gap.** Each painting has a clear gap meant for the sunset sun (`sunGap`: columns 258
to 329 of `clouds_a`, 414 to 471 of `clouds_b`). Turn each ring so the middle of its gap is at
the azimuth of the sunset sun:

```ts
// azimuth of the sunset sun, from PRESETS.sunset.sunDir (sky.ts line 57): atan2(-0.82, -0.45) = -118.757 degrees
const SUNSET_AZIMUTH = Math.atan2(PRESETS.sunset.sunDir[0], PRESETS.sunset.sunDir[2]);
function ringOffset(ring: { repeats: number; sunGap: [number, number] }): number {
  const middle = (ring.sunGap[0] + ring.sunGap[1] / 2) / 512;             // 0.5742 for a, 0.8652 for b
  const offset = middle + (ring.repeats * SUNSET_AZIMUTH) / (2 * Math.PI);
  return offset - Math.floor(offset);                                    // 0.2547 for a, 0.8756 for b
}
```

The sunset sun is 12.07 degrees up and its disc is 4.0 degrees in radius (`discSize` 420 at
the nominal 6000 m, `sky.ts` lines 65 and 248); the gaps are 12.7 and 13.6 degrees wide at
that height, so the whole disc shows between two towers. The afternoon sun (54 degrees up) and
the moon (51 degrees up) are above both rings.

**Also change:**

- `sky.ts` lines 273 to 278 (`update`): set `mesh.position.copy(camera.position)` for each
  ring (all three axes, so the horizon stays put when a titan stands up) and delete the
  `texture.offset.set(time * ...)` line. The rings must not scroll: the two would drift apart
  (line 275 moves them at different speeds) and the sun gaps would no longer meet. If motion is
  wanted later, turn both rings together by adding the same angle to both, at most 0.004
  degrees per second (1.2 degrees over five minutes), by adding
  `ring.repeats * angle / (2 pi)` to each `offset.x`.
- `sky.ts` lines 252 to 256 (`apply`): keep `material.color` from `cloud`, but set
  `material.opacity = 1`. With the old `cloudOpacity` (0.9, 0.85, 0.55; lines 45, 62, 79) the
  ring behind shows through the ring in front as a ghost. The field can go.
- `client/src/assets/manifest.ts` line 30, `TextureEntry`: add
  `ring?: { repeats: number; bottomDeg: number; sunGap: [number, number] }`.
- The cloud entries no longer carry `"tile": true`, so `assetStore.ts` line 125 prepares them
  without mipmaps and without repeat; the code above sets what the rings need. The stand-in
  path (`assetStore.ts` line 247) treats `clouds_*` as a tile; the code above overrides that
  too. The procedural stand-in picture in `client/src/assets/procedural/textures.ts` is drawn
  for the old planes; if it is kept, give it transparent top and bottom rows.

**How to check.**

1. Stage 1, on a street, look around level: towers stand on the horizon all the way round,
   blue sky shows down to the horizon in several places, nothing is stretched. Compare with
   `sky_views.png` (top row) and `sky_ring.png`.
2. Look up past 45 degrees: clear sky and the sun, no cloud overhead (`sky_views.png`,
   bottom right).
3. Stage 2, face heading -118.8 degrees (`yaw = -2.0727` radians): the sun stands in a clear
   gap with a tower on each side (`sky_views.png`, middle left).
4. Walk 500 m and climb to titan height: the clouds do not move against the horizon.
5. The towers are lit from the upper left, as in `clouds_a.png`. If they are lit from the
   right, `repeat.x` has the wrong sign.

## 2. Effects: alpha blending for the full-color ones (must)

**What is wrong.** `effects.ts` puts the explosion, the fire, the muzzle flash and the sparks
into one additive batch (`this.glow`, line 61; spawns at lines 121, 122, 128, 166, 191). The
explosion, fire and flash are full-color pictures (deep red through orange to a white core).
Added to a bright background, which is all of stage 1, they burn out to white blobs on the sky
and pale cream ghosts on sidewalk and plaster: lower rows of `fx_blend.png`. With ordinary
alpha blending they look right on every background: upper rows. The explosion is also
multiplied by a tint (`color = 0xffd27a`, line 119), which turns its white-hot core orange.

**The rule**, now carried by the manifest as `"blend"` on every `fx_*` sprite:

| `"blend": "alpha"` (ordinary alpha blending) | `"blend": "add"` (added) |
| --- | --- |
| `fx_explosion`, `fx_explosion_ground`, `fx_fire`, `fx_flash` (full color: tint white) | `fx_glow`, `fx_spark`, `fx_laserdot` (white light: tint freely) |
| `fx_smoke`, `fx_dust`, `fx_debris*`, `fx_ring`, `fx_shadow`, `fx_white` (white: tint freely) | |

**What to change.**

1. Carry the field through: add `blend?: 'alpha' | 'add'` to `SpriteEntry` (`manifest.ts`
   line 23) and to `SpriteInfo` (`spriteAtlas.ts` line 19), and set it where the sprite is
   registered (`spriteAtlas.ts` line 104). For sprites without the field (the procedural
   stand-ins) use `'add'` for `fx_glow`, `fx_spark`, `fx_laserdot` and `'alpha'` otherwise.
2. Add a fourth batch for the full-color bursts, drawn over the smoke and under the glow
   (`effects.ts` after line 62, and a `'burst'` member of `Layer`, line 13; pick it at line
   239):
   `this.burst = new QuadBatch(atlas.texture, { mode: 'facing', capacity: MAX_PARTICLES, renderOrder: 15 });`
   Better than hard-coding layers: let `spawn` pick the batch from the sprite's `blend`
   (`'add'` to `glow`; `'alpha'` to `burst` for the four full-color sprites and to `smoke`
   for the white ones).
3. `explosion()` (lines 119 to 141):
   - line 121, the flash: layer `burst`, color `0xffffff` (was `0xfff4d0`).
   - line 122, the explosion frames: layer `burst`, color `0xffffff` always. Do not multiply
     the `color` argument into them.
   - new, before both: the bloom. One `fx_glow` particle in the `glow` layer at the same
     point, size `r * 4.0` (1.5 times the explosion's `r * 2.6`), life 0.35 s, alpha 0.6,
     color `0xff8a1a` (or the `color` argument: this is the place for a tint).
   - line 128, the flying sparks: unchanged (`fx_spark` is `"add"`).
4. `flash()` (lines 164 to 167): layer `burst`, default color `0xffffff` (was `0xffe9a8`).
   See note 3 for its three callers.
5. `fire()` (lines 189 to 194): layer `burst`, color `0xffffff`, alpha 1 (was 0.9).

**How to check.** Stage 1, daylight: set off an explosion against the sky and one on a
sidewalk; hold a fire on a wreck in front of a cream wall. Each must keep its red and orange
rim and its yellow body with a small white core, as in the upper rows of `fx_blend.png`
(afternoon sky and sidewalk bands). A white blob with a pink edge means it is still added.
Then stage 3 at night: they must look as before (bottom band).

## 3. Laser dot and beam glows (should; needed once note 2 is in)

Three callers use `effects.flash()` as a tinted glow. Once the flash is a full-color sprite
with alpha blending, a tint turns it muddy. Give `Effects` a small method for a tinted glow in
the additive layer and use it in these places:

| Caller | Now | Use instead |
| --- | --- | --- |
| `unitsView.ts` line 280, the targeting laser's end | `effects.flash(ex, ey, ez, dot, 0xffd91a, 0.03)` | `fx_laserdot`, layer `glow`, color `0xffd91a` (volley yellow), same size and life. Its uv is already loaded and unused: `dotUv`, lines 109 and 127 |
| `kaijuView.ts` line 237, the beam charging in the mouth | `effects.flash(..., 0xffa040, 0.05)` | `fx_glow`, layer `glow`, color `0xffa040`, size times 1.6 (the glow fades to nothing at its rim; the flash is solid to its tips) |
| `kaijuView.ts` line 248, along the beam | `effects.flash(..., 0xffb060, 0.06)` | `fx_glow`, layer `glow`, color `0xffb060`, size times 1.6 |

Check: the laser's end is a crisp yellow dot with a thin cross flare; the beam glows orange and
does not show eight-pointed stars along its length.

## 4. Debris: one chunk per particle (nice)

`fx_debris` used to be declared as a four-frame animation, and `Effects.update` plays any
multi-frame sprite across the particle's life (line 236), so a flying chunk would have
morphed from cube to slab to shard to gravel. The manifest now has four one-frame sprites,
`fx_debris_1` to `fx_debris_4` (wedge, slab, shard, crumbs), and `fx_debris` remains as a
second name for `fx_debris_1`, so line 74 still resolves. Nothing spawns debris yet; when it
does: pick `fx_debris_${1 + Math.floor(rand() * 4)}` per particle, layer `smoke` (alpha),
tint with the wall color of the building, give it spin and gravity.

## 5. Two effects stand on the bottom edge (nice)

`fx_fire` and `fx_explosion_ground` are drawn standing on the bottom edge of their cell (their
lowest pixels are on the last row). The `facing` batch centers a quad on its point
(`quadBatch.ts`, `MODE_FACING`), so:

- `fire()` (line 190): spawn at `y + size / 2`, so the flames stand on `y` instead of
  straddling it. Half the fire is below the wreck's surface today.
- `explosion()` (line 119): when the burst is on the ground (the same test as the ring at
  line 140, `y < r * 1.5`), use `fx_explosion_ground` in place of `fx_explosion`, centered at
  `y = size / 2` with `size = r * 2.6`, rotation 0. Its sparks fan upward from the ground and
  rain back, where the air burst would bury half of itself.

## 6. Nothing to do

- **Walk speed.** The soldiers' walk now plays at 12 frames per second (was 8), set in the
  manifest; `unitsView.ts` line 227 already reads `anim.fps`. At 6.5 m/s
  (`shared/src/defs/units.ts`) that is 1.08 m per step against a drawn stride of about 0.75 m.
- **Soldier sheet.** Same cells, same ids, same animations. Every frame now carries a cyan
  helmet band, wider armbands and a cyan strip on the pack; the front fire frames show the
  muzzle at chest height (rifle) or the mouth of the tube beside the head (launcher).
- **Civilian sheet.** Same six ids and cells. The six now differ in build (a child of 19
  pixels, a tall one of 27, a stout one) inside the same 24 x 32 cell, so `worldHeight` stays
  2.2 for all of them: do not scale per sprite.
- **Ground scale.** The tiles are drawn for 8 m per tile (`TILE` in `ground.ts` line 12): a
  paving slab is 1 m. Keep `TILE = 8`.

## 7. Open, outside this review

- `ground_rubble` is loaded (`assetStore.ts` `TEXTURE_IDS`) but nothing draws it. The design
  says destroyed ground turns flat grey; the tile is now quiet enough to cover whole blocks
  (`ground_views.png`). When destroyed footprints get a ground patch, draw it like the parks
  (`ground.ts` line 92), one layer above the base.
- `ground_plaza` and `ground_far` (`ground.ts` lines 93 and 68) are not in `docs/ASSETS.md`
  and have no art, only procedural stand-ins. If they are to stay, they need a line in the
  contract and a tile each from the sprites family.
