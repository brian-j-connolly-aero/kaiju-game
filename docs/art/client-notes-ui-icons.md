# Client notes: UI pictograms

For the client engineer. The art director's review of the UI (user interface) pictograms found
things that can only be fixed in `client/src`. The art side is done; this page says what to change in the
client, with the numbers, and how to check each change.

- All file and line references are to the tree at commit `bbaefc5` (`client/src` was the same at
  `2f69ae5`).
- Before and after pictures of notes 3 to 8, under the same numbers:
  `docs/art/previews/ui_icons_client_fixes.png`.
  The bar: `docs/art/previews/ui_skyline.png`. Every icon at the client's sizes:
  `docs/art/previews/ui_icons_real_sizes.png`. All three are redrawn by
  `node tools/art/ui/preview.cjs`.
- What each icon means: `docs/art/UI_ICONS.md`.
- Run `npm run assets:manifest` first: 13 icon files are new (list in note 5).

Summary, most important first:

| # | What | Where | Severity |
| --- | --- | --- | --- |
| 1 | Two stand-in drawings break the legal and tone rules | `client/src/ui/iconArt.ts` lines 54 and 55 | must |
| 2 | The finished skyline is never shown | `client/src/ui/hud.ts` lines 85 to 142 and 273 to 280, `client/src/styles.css` lines 479 to 503 | should |
| 3 | Tally icons overlap by a third | `client/src/styles.css` line 1179 | should |
| 4 | The key letter sits on the keycap's lip | `client/src/styles.css` line 80 | should |
| 5 | Nine icon ids now have art; the reload meter should use the new one | `client/src/ui/hud.ts` lines 167 and 185 | should |
| 6 | The four directions of the directional pad show one glyph | `client/src/game/input/actions.ts` lines 196 to 199 | should |
| 7 | Orange icons vanish against the sunset | `client/src/styles.css` lines 505 to 511, 571 to 585, 621 to 624 | nice |
| 8 | The "spotted" mark wears the wrong color | `client/src/styles.css` line 928 | nice |
| 9 | Mark icons can sit centered under their towers | `client/src/styles.css` line 508, `client/src/ui/hud.ts` line 137 | nice |
| 10 | Button glyphs on the wheel are at the limit of legibility | `client/src/styles.css` line 1000 | nice |

---

## 1. Replace two stand-in drawings (must)

`icon(id)` in `client/src/ui/icons.ts` (line 29) first shows the stand-in from `iconArt.ts` and
swaps in the real file when it has loaded, and it keeps the stand-in whenever a file is missing.
Two stand-ins must not be seen even for a moment:

- `fac_science` (`iconArt.ts` line 54) is three ellipses at 0, 60 and 120 degrees around a dot.
  In cyan that is the logo of the React JavaScript library. The art director's only "must" was to
  get rid of this construction; the real file no longer uses it, the stand-in still does.
- `fac_faith` (`iconArt.ts` line 55) is a cross in a circle. That is a symbol of particular
  faiths. `CLAUDE.md`: for the Coalition of Faiths the joke is "never any faith".

Replace the two lines with these (same helpers `S` and `F` as the rest of that file). They are
rough versions of the real icons: an atom with two crossed orbits and two electrons, and a pair
of pressed hands with light above.

```ts
  fac_science: `<ellipse cx="32" cy="32" rx="27" ry="11" transform="rotate(-45 32 32)" ${S}/><ellipse cx="32" cy="32" rx="27" ry="11" transform="rotate(45 32 32)" ${S}/><circle cx="32" cy="32" r="6" ${F}/><circle cx="13" cy="13" r="4.5" ${F}/><circle cx="51" cy="51" r="4.5" ${F}/>`,
  fac_faith: `<path d="M24 46 L24 26 Q24 14 32 10 Q40 14 40 26 L40 46 Z" ${F}/><path d="M18 55 L46 55" ${S}/><path d="M14 16 L9 10 M50 16 L55 10 M10 30 L4 28 M54 30 L60 28" ${S}/>`,
```

**Check:** in the browser's developer tools, block requests to `assets/ui/fac_science.svg` and
`assets/ui/fac_faith.svg` (or rename the two files for a moment), open a screen that shows the
faction icons, and look at the stand-ins: an X-shaped atom, and hands with rays. No trefoil, no
cross.

## 2. Show `skyline.svg` in the destruction bar (should)

**Now.** `hud.ts` builds the bar from the procedural `skylinePath()` (`iconArt.ts` lines 115 to
134) with the classes `bar-city` and `bar-ruin` (`hud.ts` lines 124 to 132). Nothing loads
`client/public/assets/ui/skyline.svg`.

**The art.** `skyline.svg` was redrawn for the bar box the client already has, so **keep the
box**: `.bar { width: min(560px, 62vw); height: 46px; }` (`styles.css` lines 479 to 484).

| Fact | Value |
| --- | --- |
| viewBox | `0 0 400 64`; the root carries `preserveAspectRatio="none"` |
| Meant to be stretched to | 560 × 46 pixels: 1.4 pixels per unit across, 0.72 pixels per unit up |
| Fill line | `x = 400 × f`, with `f = barDisplayFraction(...)` (0 to 1), the value `hud.ts` line 274 already computes |
| Towers end at | 21%, 57%, 100% of the width (`MATCH_RULES.bar.display`) |
| Tower size in the bar | 34 pixels wide; 37, 42 and 45 pixels tall |
| Everything else | 6 to 17 pixels tall |
| `class="sky-city"` | the standing city: clip it from the left |
| `class="sky-rubble"` | a low heap inside the city's outline (at most 5.4 pixels tall in the bar): color it rubble grey, never clip it |

**Change.**

1. Add a way to get an icon file's markup outside `icon()`. In `client/src/ui/icons.ts`, next to
   `setIconSource` (line 16):

   ```ts
   /** The markup of an art file from ui/, or null when it does not exist. */
   export function uiMarkup(id: string): Promise<string | null> {
     return store ? store.uiSvg(id) : Promise.resolve(null);
   }
   ```

   (`AssetStore.uiSvg`, `client/src/assets/assetStore.ts` line 278, already fetches and caches
   it; `skyline` is in the manifest's `ui` section.)

2. In the `Hud` constructor (`hud.ts` lines 124 to 134) keep building the procedural bar exactly
   as now: it is the fallback. Then ask for the file and swap it in when it arrives:

   ```ts
   void uiMarkup('skyline').then((svg) => {
     if (!svg) return; // no file: the procedural skyline stays
     bar.querySelector('svg')?.remove();
     bar.insertAdjacentHTML('afterbegin', svg); // the inlined <svg> fills the bar: see the style rules below
     this.barEdge = el('div', 'bar-edge-line');
     bar.append(this.barEdge);
     this.barCity = bar.querySelector('.sky-city');
     this.lastBar = -1; // repaint with the new elements
   });
   ```

   (`barCity: SVGPathElement | null = null` and `barEdge: HTMLElement | null = null` are new
   fields. The mark icons, lines 135 to 142, stay as they are; `insertAdjacentHTML('afterbegin')`
   keeps them after the picture.)

3. In `update()` (`hud.ts` lines 275 to 280), when `this.barCity` is set, do this instead of
   moving the two clip rectangles:

   ```ts
   const pct = (f * 100).toFixed(1);
   this.barCity.style.clipPath = `inset(0 0 0 ${pct}%)`;
   this.barEdge!.style.left = `calc(${pct}% - 1.5px)`;
   this.barEdge!.style.display = f > 0 ? '' : 'none';
   ```

4. In `styles.css`, after the `.bar svg` rule (line 486; that rule already gives the inlined
   file `width: 100%; height: 100%` and the drop shadow):

   ```css
   .bar { color: #e9edf7; }                 /* the standing city, same white as .bar-city */
   .bar .sky-rubble { color: var(--rubble); }
   .bar-edge-line { position: absolute; top: 0; bottom: 0; width: 3px; background: var(--kaiju); }
   ```

   Careful: `.bar-mark` (line 510) sets its own color, so the marks are not affected by the new
   `.bar` color.

The percentages of `inset()` are taken from the box of the `sky-city` path, which spans the
whole viewBox width (x 0 to 400), so `N%` is exactly the fill. That is how
`tools/art/ui/preview.cjs` builds `ui_skyline.png`, in Chromium. If another browser misbehaves,
the fallback is the mechanism the bar uses today: a `<clipPath>` with a rectangle from
`x = 400 × f` to 400 (in viewBox units), applied to the `sky-city` path.

**Check:** `docs/art/previews/ui_skyline.png` is the target: at fill 0 a low city with three
stepped towers; as the bar fills the city disappears from the left behind an orange line, and a
thin grey heap remains. At 19% the first tower still stands; at 21% it is gone and the first
mark icon turns orange. With the file blocked or missing the old procedural bar must still work.

## 3. Tally icons: no overlap (should)

**Now.** `styles.css` lines 1177 to 1180: `.tally-icon { font-size: 22px; margin-right: -8px; }`.
The value was tuned for the old placeholder drawings. The finished icons use the full width of
their box, so each one covers a third of the next: cars become a caterpillar, apartment blocks
one slab, bridges a lattice. They cannot be counted.

**Change.** `margin-right: 2px;`.

Row length: `tallyRow()` (`client/src/app/screens/end.ts` lines 14 to 32) shows at most 5 icons
per kind (line 21), then a bar. One kind is now at most 5 × (22 + 2) = 120 pixels wide instead
of 5 × (22 − 8) = 70. `.tally-row` wraps (`flex-wrap: wrap`, line 1167), so nothing breaks; a
player who flattened all ten kinds needs two rows where one was enough. If that is too tall,
shrink the icon to 20 pixels or show at most 4 per kind (`Math.min(count, 4)` on line 21). Do
not go back to overlapping.

**Check:** on the end screen, three cars side by side are three separate cars with a visible
gap. Picture: note 3 in `ui_icons_client_fixes.png`.

## 4. Key letter: on the key's top face (should)

**Now.** `styles.css` lines 78 to 87: `.glyph-label { inset: 0; ... }` centers the letter on the
middle of the icon, 50% down. The top face of `kb_key` is centered on (32, 26.5) of its 64 × 64
box, that is **41.4%** down. The letter sits 5.5 units low (2 pixels at 24 pixels) and its feet
touch the lip of the keycap.

**Change.** Line 80: `inset: 0 0 17% 0;` (the center of a box that ends 17% above the bottom is
at 41.5%). Keep `font-size: 0.48em`.

**Check:** `W`, `M`, `Q`, `1` and the symbols for Space, Shift and Enter (`KEY_LABELS`,
`client/src/game/input/actions.ts` lines 202 to 214) at 19 and 24 pixels: the letter stands
clear of the line under the top face. Picture: note 4 in `ui_icons_client_fixes.png`.

## 5. New icons, and the reload meter (should)

These ids now have art files (run `npm run assets:manifest` so the client finds them):

| Id | Used by the client at | Picture |
| --- | --- | --- |
| `ui_offline` | `hud.ts` line 205, `app.ts` line 37, `lobby.ts` line 109, `home.ts` line 66 | a radio signal struck through |
| `ui_skull` | `hud.ts` line 206, `end.ts` line 12 | a skull |
| `ui_trophy` | `end.ts` line 65 | a trophy cup |
| `ui_newspaper` | `end.ts` line 86 | a newspaper page |
| `ui_warning` | `app.ts` line 36, `home.ts` line 66 | a warning sign |
| `ui_copy` | `app.ts` line 33 | two sheets |
| `ui_clock` | `end.ts` line 12 | a clock face |
| `ui_sound` | nowhere yet | a loudspeaker |
| `st_reload` | **new, see below** | one shell, standing |
| `gp_dpad_up`, `gp_dpad_right`, `gp_dpad_down`, `gp_dpad_left` | **new, see note 6** | a cross with one arm solid |

Nothing has to change for the eight `ui_` ids: the code already asks for them.

**Change for the reload meter.** `hud.ts` line 167:
`this.reload = meter('cmd_fireatwill', 'own-reload');` becomes
`this.reload = meter('st_reload', 'own-reload');`. At 20 pixels the three shells of
`cmd_fireatwill` are a scatter of dots; one shell reads.

**Recommended as well.** `hud.ts` line 185: `fire: hint('cmd_fireatwill', 'fire')` becomes
`fire: hint('st_reload', 'fire')`. That hint is the player's own shot and its dark cover is the
reload time (`hud.ts` line 384). `cmd_fireatwill` then means only one thing on the screen: the
standing order to the squad (`hud.ts` lines 172 and 351, and the wheel).

Optional: add stand-ins for `st_reload` and the four `gp_dpad_` ids to `iconArt.ts`, so that a
missing file gives a sensible drawing instead of the generic tile. For example
`st_reload: \`<path d="M32 6 Q42 18 42 30 L42 46 L22 46 L22 30 Q22 18 32 6 Z M22 52 L42 52 L42 58 L22 58 Z" ${F}/>\``.

**Check:** next to the cyan reload bar there is one upright shell. Picture: note 5 in
`ui_icons_client_fixes.png`.

## 6. Directional pad: one glyph per direction (should)

**Now.** `client/src/game/input/actions.ts` lines 196 to 199 map `PAD.up`, `PAD.down`,
`PAD.left` and `PAD.right` all to `gp_dpad`. The default gamepad bindings put the four commands
on those four buttons (lines 112 to 116), so the command wheel shows the same glyph four times.

**Change.**

```ts
  [PAD.up]: 'gp_dpad_up',
  [PAD.down]: 'gp_dpad_down',
  [PAD.left]: 'gp_dpad_left',
  [PAD.right]: 'gp_dpad_right',
```

`gp_dpad` stays in the set as the directional pad with no direction in particular; nothing uses
it after this change.

**Check:** on a gamepad, open the wheel: the glyph under "follow" has its top arm solid, "move
to" the right arm, "fire at will" the bottom arm, "hold and charge" the left arm. Picture: note 6
in `ui_icons_client_fixes.png`.

## 7. Icons straight on the sky need a dark outline (nice)

**Now.** The meter icons have one soft shadow (`styles.css` line 623:
`filter: drop-shadow(0 1px 1px #000)`); the marks under the bar (lines 505 to 511) and the stage
pips (lines 571 to 585) have none. Kaiju orange `#ff7a1a` on the sunset sky is orange on orange:
the rage icon, the reached marks and the stage pips nearly vanish.

**Change.** Give those three the same outline, two tight black shadows under the existing one:

```css
.meter-icon,
.bar-mark,
.stage-pip {
  filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000) drop-shadow(0 1px 1px #000);
}
```

(Replace the `filter` on line 623; add the rule for the other two. `.clock-moon`, lines 548 to
554, has no shadow either and can take the same rule. `.bar-mark.ready` keeps its pulse.)

**Check:** over the sunset, the orange flame, the orange marks and the orange stage triangles
each have a thin dark edge and read at a glance. Picture: the two rows of note 7 in
`ui_icons_client_fixes.png` (sunset and afternoon).

## 8. `st_spotted` wears kaiju orange (nice)

**Now.** `styles.css` lines 927 to 931: `.status-spotted { color: var(--human); ... }`. The icon
document and the preview sheets tint it kaiju orange: the eye's pupil is the kaiju's triangle,
and the thing that is spotted is the kaiju.

**Change.** Line 928: `color: var(--kaiju);`.

**Check:** the eye that appears while the kaiju is spotted is orange. Picture: note 8 in
`ui_icons_client_fixes.png`.

## 9. Mark icons centered under their towers (nice)

**Now.** `.bar-mark` has `transform: translateX(-100%)` (`styles.css` line 508) and
`left = mark × 100%` (`hud.ts` line 137), so the 18 pixel icon hangs under the right half of its
tower.

The towers are 24 units wide and end on their marks, so each tower's middle is 12 units, **3% of
the bar's width**, left of its mark: at 18%, 54% and 97%.

**Change (optional).** `hud.ts` line 137: `mark.style.left = \`${(at - 0.03) * 100}%\`;` and
`styles.css` line 508: `transform: translateX(-50%);`.

**Check:** each mark icon sits under the spire of its tower.

## 10. Button glyphs on the wheel (nice)

`.wheel-glyph` is 18 pixels (`styles.css` line 1000), the smallest size any icon is drawn at.
The glyphs were redrawn to hold at 18 (see the first strip of `ui_icons_real_sizes.png`), but
there is room: the disc is 84 pixels (line 957) and holds a 40 pixel icon. `font-size: 22px`
makes the solid arm of a directional-pad glyph 8 pixels instead of 6.5; the icon and the glyph
together are then 62 of the disc's 78 inner pixels. Nothing in the art depends on it.

---

## Not checked

- Everything above was judged on static renders made by `tools/art/ui/preview.cjs` in headless
  Chromium, at the sizes and colors read from `client/src/styles.css`. Nothing was run in the
  game, and no other browser was tried.
- `styles.css` calls itself placeholder styling. If its sizes change, change them in
  `sheetRealSizes()` in `tools/art/ui/preview.cjs` too, so the art keeps being judged at the
  sizes the game uses. No icon should be drawn smaller than 18 pixels.
