# UI pictograms

Monster Battle 9001 has a no-reading rule: apart from names and subtitles, nothing on screen is
text. These pictograms are therefore the game's whole language. Each one has to be understood in
under a second by someone who has never played.

- **Files:** `client/public/assets/ui/<name>.svg`, 68 icons and `skyline.svg`. The names are the
  contract in `docs/ASSETS.md` section 5.
- **Format:** hand-written SVG (Scalable Vector Graphics, a drawing written as text). No drawing
  program is involved: to change an icon, edit its file.
- **Pictures of the whole set:** `docs/art/previews/ui_icons.png` (everything),
  `ui_icons_<group>.png` (one group each), `ui_icons_32px.png` and `ui_icons_32px_light.png`
  (the legibility test at 32 pixels), `ui_icons_in_context.png` (a mock-up of the screens) and
  `ui_skyline.png` (the destruction bar).

## How the game uses them

- Every icon is drawn in **one color, `currentColor`**: it takes the text color of whatever
  element it sits in. Set `color` on the parent and the icon follows. For that to work the file
  has to be placed **inline** in the page (the client's `AssetStore.uiSvg(id)` returns the
  markup). Loaded through an `<img>` tag an icon is always black.
- The root has a `viewBox` of `0 0 64 64` and no width or height, so an inline icon fills the
  box it is given. Give the box a size (for example `width: 32px; height: 32px`).
- There are no `id` attributes, no `<style>`, no scripts and no links in any file, so the same
  icon can be inlined many times on one page without clashes.
- After adding, renaming or removing a file, run `npm run assets:manifest`: the client only asks
  for the icons listed in `client/public/assets/manifest.json`.

## Style rules (follow these when adding one)

| Rule | Value |
| --- | --- |
| Grid | 64 × 64. Keep the drawing at least 2 units away from the edge. |
| Lines | **One weight: `stroke-width="5"`**, round ends and round corners (set once on the root). At 32 pixels that is a 2.5 pixel line. |
| Solid shapes | Filled with `currentColor`. Blunt corners are rounded, either by the same 5 stroke or by hand. Gaps and holes are at least 3 units wide so they survive at 32 pixels. |
| Sharp points | Only where the thing itself is sharp: teeth, claws, spines, bursts, the lightning bolt, the star, the play and back arrowheads. Sharp means kaiju or danger; round means human or neutral. |
| Color | None in the file. The game colors the icon: humans cyan `#1ec8e0`, kaiju orange `#ff7a1a`, volley yellow `#ffd91a`, rubble grey `#8d8d94`. |
| Text | Never. Not even a letter. |

**The shapes double the colors**, for colorblind players. The same three shapes appear inside the
icons wherever the idea appears:

| Shape | Means | Where |
| --- | --- | --- |
| Circle | a human unit | `cmd_follow` (the leader), `cmd_holdcharge` and `cmd_fireatwill` (the units), `st_shaken`, `lb_human` |
| Triangle | the kaiju | `lb_kaiju`, `st_spotted` (the pupil), `st_crossfire` (the target), `k_molt` (inside the cocoon) |
| Diamond | a volley | `cmd_holdcharge` (the aim point), `st_charge` |

## The icons

### Commands (the radial wheel)

| File | Meaning | What is drawn |
| --- | --- | --- |
| `cmd_follow` | Follow me | Three chevrons trailing a leader (circle) |
| `cmd_moveto` | Move to this position | An arrow dropping onto a ground marker |
| `cmd_fireatwill` | Fire at will | Shots fanning out from one unit to scattered bursts |
| `cmd_holdcharge` | Hold fire and charge a volley | Three units aiming their beams at one diamond |

`cmd_fireatwill` and `cmd_holdcharge` are a pair on purpose: many targets against one target.

### Kaiju verbs

| File | Meaning | What is drawn |
| --- | --- | --- |
| `k_swipe` | Swipe | Three claws raking an arc |
| `k_stomp` | Stomp with a shockwave | A clawed foot coming down on shock rings |
| `k_grab` | Grab | A three-clawed hand closing around a car |
| `k_throw` | Throw | A car flying off along an arc |
| `k_eat` | Eat (heals) | Jaws closing on a car |
| `k_brace` | Brace against a volley | A raised, clawed forearm on a shield |
| `k_roar` | Roar | A roaring maw with sound waves |
| `k_special` | Special (the Lizard's beam) | A beam from the mouth |
| `k_molt` | Molt | The kaiju (triangle) wrapped in its spiny cocoon |

`k_roar`, `k_special` and `k_eat` share one head so they read as the same creature.

### Status

| File | Meaning | What is drawn |
| --- | --- | --- |
| `st_health` | Health | A heart |
| `st_nerve` | Nerve | A dizzy spiral |
| `st_rage` | Rage (powers the special) | A flame with furious eyes |
| `st_charge` | Volley charge | A lightning bolt in a diamond |
| `st_veteran` | Veteran unit | Rank chevrons under a star |
| `st_spotted` | The kaiju is spotted | An eye with a triangle for a pupil |
| `st_crossfire` | Crossfire | Two arrows from two sides meeting on a triangle |
| `st_callin` | Call-in strike | Shells falling on a ground marker |
| `st_shaken` | Shaken unit | A rattled round face with tremble marks |
| `st_map` | Map view | A folded map |
| `st_camera` | Camera (view toggle, news drone photo) | A photo camera |
| `st_sun` | Day end of the match clock | A sun |
| `st_moon` | Night end of the match clock | A crescent moon |

### Lobby

| File | Meaning | What is drawn |
| --- | --- | --- |
| `lb_kaiju` | The kaiju side | A triangle with a monster's glare and teeth |
| `lb_human` | The human side | A round, helmeted head |
| `lb_ready` | Ready | A check mark |
| `lb_host` | The host of the room | A crown |
| `lb_bot` | A bot fills this slot | A robot head |
| `lb_link` | Invite link | Two chain links |
| `lb_play` | Start the match | A play triangle |
| `lb_back` | Back | A returning arrow |
| `lb_create` | Create a room | A plus inside a room |
| `lb_join` | Join a room | An arrow going into a room |

### Factions

| File | Meaning | What is drawn |
| --- | --- | --- |
| `fac_army` | Army | A tank |
| `fac_air` | Air | A jet seen from above |
| `fac_science` | Super Science | An atom |
| `fac_faith` | Coalition of Faiths | Hands pressed together, with light around them |

`fac_faith` deliberately uses no symbol of any one faith (the tone rule in `CLAUDE.md`).

### Tally pictograms (end screen: what each player flattened)

Solid silhouettes, because they are shown small and in rows.

| File | Meaning | What is drawn |
| --- | --- | --- |
| `tl_car` | Car | A car, side view |
| `tl_kiosk` | Kiosk | A booth: hip roof with a ball, striped awning, serving window, counter |
| `tl_house` | House | A gabled house with a chimney |
| `tl_shop` | Shop | A storefront: sign, awning, window, door |
| `tl_apartment` | Apartment block | A mid-rise with a grid of square windows |
| `tl_office` | Office block | A tall slab with wide windows, a low wing and a mast |
| `tl_tower` | Tower | A stepped skyscraper with a spire |
| `tl_factory` | Factory | A saw-tooth roof and a smoking chimney |
| `tl_bridge` | Bridge | A suspension bridge |
| `tl_landmark` | Landmark | A domed hall with columns and a flag |

### Device glyphs (which button to press)

Drawn as the physical control, never as a letter.

| File | Meaning | What is drawn |
| --- | --- | --- |
| `kb_key` | A keyboard key | A blank keycap. **The letter is added in code** (see below). |
| `ms_left` | Left mouse button | A mouse with the left button filled |
| `ms_right` | Right mouse button | A mouse with the right button filled |
| `ms_middle` | Middle mouse button | A mouse with the wheel filled |
| `ms_move` | Move the mouse | A mouse with arrows on four sides |
| `gp_a` | Gamepad A | The four face buttons, **bottom** one filled |
| `gp_b` | Gamepad B | The four face buttons, **right** one filled |
| `gp_x` | Gamepad X | The four face buttons, **left** one filled |
| `gp_y` | Gamepad Y | The four face buttons, **top** one filled |
| `gp_lb` | Left bumper | A gamepad with a flat bar on its left shoulder |
| `gp_rb` | Right bumper | A gamepad with a flat bar on its right shoulder |
| `gp_lt` | Left trigger | A gamepad with a tall tab above the left bumper |
| `gp_rt` | Right trigger | A gamepad with a tall tab above the right bumper |
| `gp_ls` | Left stick | A gamepad with a dot on its left |
| `gp_rs` | Right stick | A gamepad with a dot on its right |
| `gp_dpad` | Directional pad | A cross with four arrowheads |
| `gp_start` | Start | A small pill button with a triangle pointing **right** |
| `gp_back` | Back | A small pill button with a triangle pointing **left** |

Notes for whoever wires the glyphs:

- The face buttons follow the common layout (A bottom, B right, X left, Y top). The glyph shows a
  position, not a letter, so it stays right on pads that print other symbols there.
- Start and Back are the two small middle buttons. On every common pad Start is the right one
  and Back (also called Select, View or Share) is the left one; the triangle points to that side.
- **Putting the letter on `kb_key`:** the top face of the keycap is centered on **(32, 26.5)** of
  the 64 × 64 box, that is 50% across and 41.4% down. A bold letter about 0.4 of the icon's
  height fits (for example 13 pixels on a 32 pixel icon). Either lay HTML text over the icon at
  that point, or add a text element to the inlined markup at `x="32" y="26.5"` with
  `text-anchor="middle"` and `dominant-baseline="central"`. The keycap only has room for one or
  two characters; keys with long names (Space, Shift) need their own glyphs, which the contract
  does not list yet.

## skyline.svg: the destruction bar

A single-color city silhouette that the UI crumbles from left to right as the bar fills.

- **viewBox `0 0 400 64`.** The ground is `y = 64`. `x` runs with the bar:
  `x = 400 × fill`, where `fill` is the value of `barDisplayFraction()` (0 to 1).
- **Three taller towers stand at the three marks.** Each tower **ends on its mark**, so it is the
  last thing to fall before the mark is passed (the third one ends the bar):

| Mark | Share of the width | Tower spans x | Spire at x | Tower top (spire tip) at y |
| --- | --- | --- | --- | --- |
| 1 | 21% | 68 to 84 | 76 | 12 |
| 2 | 57% | 212 to 228 | 220 | 6 |
| 3 | 100% | 384 to 400 | 392 | 2 |

- The ordinary buildings grow with the match: gabled houses and shops before the first tower,
  mid-rise blocks, a factory and a dome before the second, high-rises before the third. None is
  taller than `y = 28`; only the towers rise above that.
- The file holds two paths, both `currentColor`:
  - `class="sky-city"`: the standing city. **Clip or mask this one from the left.**
  - `class="sky-rubble"`: a low jagged heap (at most 6 units tall) that lies completely inside
    the city's outline. It cannot be seen while the city stands and is what remains where the
    city has been clipped away. Give it the rubble color.

With the file inlined, the whole effect is two style rules (this is what `ui_skyline.png` shows):

```css
.bar .sky-city   { clip-path: inset(0 0 0 34%); }   /* 34% = fill × 100 */
.bar .sky-rubble { color: #8d8d94; }
```

The skyline may be stretched to any width; it was checked at 240, 400 and 800 pixels.

## Checking and previewing

```bash
node tools/art/ui/preview.cjs            # check every icon, then write the pictures to docs/art/previews/
node tools/art/ui/preview.cjs --check    # check only; prints what each icon covers
node tools/art/ui/preview.cjs --out /tmp/mb-scratch/ui-icons --only kaiju   # one group, to a scratch folder
```

It uses the headless Chromium that comes with the pre-installed Playwright (never run
`playwright install`). The checks fail (exit code 1) when a contract name has no file, a file is
not well-formed, the viewBox is wrong, a fill or stroke is anything but `currentColor` or `none`,
a file contains text, an id, a style or a script, a stroke is not the set's weight, or the
drawing is empty or cut off by the edge of its box.

**How to judge an icon.** Open `ui_icons_32px.png`: the top block is the true size, the bottom
block is the same pixels enlarged three times. Cover the name and ask "what does this mean?". If
the answer takes longer than a second, redraw it. Then look at `ui_icons_in_context.png` to see
it in color among the others.

## What was tried and dropped

So the next artist does not repeat it:

- `k_swipe` as three arcs with claw tips read as a wireless signal; tapered slashes read as claws.
- `k_stomp` seen from the front read as a bell; the side view with the heel and three claws
  reads as a foot.
- `k_molt` as a banded pod hanging from a twig read as an acorn or a hive; the kaiju's own
  triangle inside a pod reads as "the kaiju, wrapped up".
- `cmd_fireatwill` as bursts alone read as sparkles; the shots leading to them make it gunfire.
- `tl_office` with plain horizontal stripes read as a document; `tl_apartment` drawn wide read
  as a keyboard.
- `st_callin` as one bomb with fins and speed lines read as a beetle.
