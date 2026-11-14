# UI pictograms

Monster Battle 9001 has a no-reading rule: apart from names and subtitles, nothing on screen is
text. These user interface (UI) pictograms are therefore the game's whole language. Each one has
to be understood in under a second by someone who has never played.

- **Files:** `client/public/assets/ui/<name>.svg`, 90 icons and `skyline.svg`. The names are the
  contract in `docs/ASSETS.md` section 5.
- **Format:** hand-written SVG (Scalable Vector Graphics, a drawing written as text). No drawing
  program is involved: to change an icon, edit its file.
- **Pictures of the whole set** (all in `docs/art/previews/`):
  - `ui_icons_real_sizes.png`: every icon at the sizes the game really draws it, over the three
    skies. **This is the sheet to judge on.**
  - `ui_icons.png` (everything, large) and `ui_icons_<group>.png` (one group each).
  - `ui_icons_32px.png` and `ui_icons_32px_light.png` (everything at 32 pixels).
  - `ui_icons_in_context.png` (a mock-up of the screens) and `ui_skyline.png` (the destruction
    bar in the game's bar box).
  - `ui_icons_client_fixes.png`: before and after pictures for the changes that have to be made
    in the game's code, not in the art (`docs/art/client-notes-ui-icons.md`).

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

**The sizes that matter.** The contract says "readable at 32 pixels", but the game draws most
icons smaller. These are the sizes in `client/src/styles.css`; an icon is finished when it reads
at its own size here, not at 32:

| Where | Size in pixels | Icons |
| --- | --- | --- |
| Button glyphs on the command wheel | 18 | `gp_*`, `ms_*`, `kb_key` |
| Button glyphs under the verbs | 24 (19 on small screens) | `gp_*`, `ms_*`, `kb_key` |
| Marks under the destruction bar | 18 | `k_molt`, `lb_kaiju` |
| Stage pips | 18, 28, 42 | `lb_kaiju` |
| Meters | 20 | `st_health`, `st_nerve`, `st_rage`, `st_charge`, `st_reload` |
| Clock | 26 and 20 | `st_sun`, `st_moon` |
| End screen tally | 22 | `tl_*` |
| Lobby seats, flags, buttons, notices | 22 to 44 | `lb_*`, `fac_*`, `ui_offline`, `ui_warning`, `ui_copy` |
| Standing orders | 30 | `cmd_*` |
| Verb hints | 32 (26 on small screens) | `k_*`, `cmd_*`, `st_callin`, `st_map`, `st_camera` |
| Command wheel | 40 | `cmd_*` |
| Status pictures | 52 (spotted 30, eliminated 34) | `st_crossfire`, `st_shaken`, `st_nerve`, `st_charge`, `st_callin`, `st_spotted`, `ui_offline`, `ui_skull` |
| End banner | 26 to 67 | `lb_kaiju`, `lb_human`, `ui_trophy`, `tl_tower`, `ui_skull`, `ui_clock` |

## Style rules (follow these when adding one)

| Rule | Value |
| --- | --- |
| Grid | 64 × 64. Keep the drawing at least 2 units away from the edge (inside 2 to 62). The check fails otherwise. |
| Lines | **One weight: `stroke-width="5"`**, round ends and round corners (set once on the root). At 32 pixels that is a 2.5 pixel line. |
| Solid shapes | Filled with `currentColor`. Blunt corners are rounded, either by the same 5 stroke or by hand. Gaps and holes are at least 3 units wide so they survive at 32 pixels. |
| Sharp points | Only where the thing itself is sharp: teeth, claws, spines, bursts, the lightning bolt, the star, the play and back arrowheads. Sharp means kaiju or danger; round means human or neutral. |
| Color | None in the file. The game colors the icon: humans cyan `#1ec8e0`, kaiju orange `#ff7a1a`, volley yellow `#ffd91a`, rubble grey `#8d8d94`. |
| Text | Never. Not even a letter. |
| Signal first | The part that carries the meaning gets the ink. A glyph for a shoulder button is mostly shoulder button, not mostly gamepad. |
| Families | Kaiju verbs and tally pictograms are solid silhouettes. Device glyphs are outlines with the control to press filled solid. |

**The shapes double the colors**, for colorblind players. The same shapes appear inside the icons
wherever the idea appears:

| Shape | Means | Where |
| --- | --- | --- |
| Circle | a human unit | `cmd_follow` (the leader), `cmd_holdcharge` (the units), `st_shaken`, `lb_human` |
| Triangle | the kaiju | `lb_kaiju`, `st_spotted` (the pupil), `st_crossfire` (the target), `k_molt` (inside the cocoon) |
| Diamond | a volley | `cmd_holdcharge` (the aim point), `st_charge` |
| Shell | a shot | `cmd_fireatwill` (three in flight), `st_callin` (two falling), `st_reload` (one, standing) |

Two more things are shared on purpose: the Lizard's head (`k_eat`, `k_roar`, `k_special`) and its
clawed hand (`k_grab` closing, `k_throw` open).

## The icons

### Commands (the radial wheel)

| File | Meaning | What is drawn |
| --- | --- | --- |
| `cmd_follow` | Follow me | Three chevrons trailing a leader (circle) |
| `cmd_moveto` | Move to this position | An arrow dropping onto a ground marker |
| `cmd_fireatwill` | Fire at will | Three shells in flight, staggered, each with a speed tick: everyone shoots when they can |
| `cmd_holdcharge` | Hold fire and charge a volley | Three units aiming their beams at one diamond |

`cmd_fireatwill` and `cmd_holdcharge` are a pair on purpose: three shots each on its own time
against three units holding on one target.

### Kaiju verbs

| File | Meaning | What is drawn |
| --- | --- | --- |
| `k_swipe` | Swipe | Three claws raking an arc |
| `k_stomp` | Stomp with a shockwave | The Lizard's foot, three hooked claws forward and a heel spur, coming down in a ring on the ground with two impact ticks |
| `k_grab` | Grab | A clawed hand reaching in from the corner and closing around a car |
| `k_throw` | Throw | The same hand, open, and a car flying off it along two dots |
| `k_eat` | Eat (heals) | Jaws closing on a car |
| `k_brace` | Brace against a volley | The kaiju's hide as a solid shield with three spines; three shots glance off it |
| `k_roar` | Roar | A roaring maw with sound waves |
| `k_special` | Special (the Lizard's beam) | A beam from the mouth |
| `k_molt` | Molt | The kaiju (triangle) in its cocoon: spines on both sides, the shell cracking across the top |

### Status

| File | Meaning | What is drawn |
| --- | --- | --- |
| `st_health` | Health | A heart |
| `st_nerve` | Nerve | A dizzy spiral |
| `st_rage` | Rage (powers the special) | A flame with furious eyes |
| `st_charge` | Volley charge | A lightning bolt cut out of a solid diamond |
| `st_reload` | Reload; the player's own shot | One shell, standing |
| `st_veteran` | Veteran unit | Rank chevrons under a star |
| `st_spotted` | The kaiju is spotted | An eye with a triangle for a pupil. Wears kaiju orange: the thing spotted is the kaiju |
| `st_crossfire` | Crossfire | Two arrows from opposite sides meeting on a triangle |
| `st_callin` | Call-in strike | Shells falling on a ground marker |
| `st_shaken` | Shaken unit | A rattled round face with a wavering mouth and tremble marks |
| `st_map` | Map view | A folded map |
| `st_camera` | Camera (view toggle, news drone photo) | A photo camera |
| `st_sun` | Day end of the match clock | A sun |
| `st_moon` | Night end of the match clock | A crescent moon |

### Lobby

| File | Meaning | What is drawn |
| --- | --- | --- |
| `lb_kaiju` | The kaiju side | A triangle with a monster's glare. No mouth: at large sizes a grin made it a carved pumpkin |
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
| `fac_science` | Super Science | An atom: two crossed orbits, a heavy nucleus, two electrons |
| `fac_faith` | Coalition of Faiths | Two hands pressed together, seen from the side, a cuff below, light around the fingertips |

- `fac_faith` deliberately uses no symbol of any one faith (the tone rule in `CLAUDE.md`). An
  open palm facing the viewer is a symbol in several traditions, so the hands are shown from the
  side, pressed together.
- `fac_science` has **two** orbits in an X and two electrons, on purpose. Three ellipses at 60
  degrees around a dot, in cyan, is the logo of a well-known software library; never go back to
  that construction.

### Tally pictograms (end screen: what each player flattened)

Solid silhouettes, because they are shown at 22 pixels and in rows. All stand on the same ground
line, `y = 58`.

| File | Meaning | What is drawn |
| --- | --- | --- |
| `tl_car` | Car | A car, side view |
| `tl_kiosk` | Kiosk | A booth: hip roof with a ball, a striped awning over the serving window, a counter |
| `tl_house` | House | A gabled house with a chimney |
| `tl_shop` | Shop | A storefront: sign, scalloped awning, window, door |
| `tl_apartment` | Apartment block | A mid-rise with a grid of square windows |
| `tl_office` | Office block | A tall slab with wide windows, a low wing and a mast |
| `tl_tower` | Tower | A stepped skyscraper (tiers 40, 30 and 20 units wide) with two glass strips and a spire: the shape of the mark towers on the destruction bar |
| `tl_factory` | Factory | A saw-tooth roof and a smoking chimney |
| `tl_bridge` | Bridge | A suspension bridge: solid deck, two solid pylons, one main cable |
| `tl_landmark` | Landmark | A domed hall with columns and a flag |

### Device glyphs (which button to press)

Drawn as the physical control, never as a letter. Shown at 18 to 24 pixels.

| File | Meaning | What is drawn |
| --- | --- | --- |
| `kb_key` | A keyboard key | A blank keycap. **The letter is added in code** (see below). |
| `ms_left` | Left mouse button | A mouse with the left button filled |
| `ms_right` | Right mouse button | A mouse with the right button filled |
| `ms_middle` | Middle mouse button | A mouse with a large solid wheel |
| `ms_move` | Move the mouse | A mouse with arrowheads on four sides |
| `gp_a` | Gamepad A | The four face buttons, **bottom** one filled |
| `gp_b` | Gamepad B | The four face buttons, **right** one filled |
| `gp_x` | Gamepad X | The four face buttons, **left** one filled |
| `gp_y` | Gamepad Y | The four face buttons, **top** one filled |
| `gp_lb` | Left bumper | The top of a gamepad with a solid bar over its **left** shoulder |
| `gp_rb` | Right bumper | The same, bar over the **right** shoulder |
| `gp_lt` | Left trigger | The top of a gamepad, a thin bumper line on the **left** and a solid tab above it |
| `gp_rt` | Right trigger | The same on the **right** |
| `gp_ls` | Left stick | A gamepad with a dot on its left |
| `gp_rs` | Right stick | A gamepad with a dot on its right |
| `gp_dpad` | Directional pad, no direction | A solid cross |
| `gp_dpad_up`, `gp_dpad_right`, `gp_dpad_down`, `gp_dpad_left` | One direction of the directional pad | An outlined cross with that arm filled (the same device as `gp_a` to `gp_y`) |
| `gp_start` | Start | A pill button with three bars, as engraved on most pads |
| `gp_back` | Back | A pill button with two overlapping squares, as engraved on most pads |

Notes for whoever wires the glyphs:

- The face buttons follow the common layout (A bottom, B right, X left, Y top). The glyph shows a
  position, not a letter, so it stays right on pads that print other symbols there.
- Bumper against trigger: a bumper is **one** bar; a trigger is a thin line **plus** a tab above
  it. Left against right: the side the bar sits on.
- The command wheel binds its four commands to the four directions of the directional pad; use
  the four `gp_dpad_<direction>` glyphs there, not `gp_dpad`.
- **Putting the letter on `kb_key`:** the top face of the keycap is centered on **(32, 26.5)** of
  the 64 × 64 box, that is 50% across and 41.4% down. A bold letter about 0.4 to 0.48 of the
  icon's height fits. Either lay web-page (HTML) text over the icon centered on that point (a box with
  `inset: 0 0 17% 0` and its content centered does it), or add a text element to the inlined
  markup at `x="32" y="26.5"` with `text-anchor="middle"` and `dominant-baseline="central"`. The
  keycap only has room for one or two characters.

### System

| File | Meaning | What is drawn |
| --- | --- | --- |
| `ui_offline` | The connection is lost | A radio signal struck through |
| `ui_warning` | Something is wrong (for example the game versions do not match) | A warning sign: a bar and a dot in a rounded triangle outline |
| `ui_copy` | This seat was opened somewhere else | Two sheets, one over the other |
| `ui_skull` | Eliminated; the kaiju was killed | A skull |
| `ui_trophy` | The winner | A trophy cup |
| `ui_clock` | Time ran out | A clock face |
| `ui_newspaper` | The front page | A newspaper page: headline, photo, lines of print |
| `ui_sound` | Sound | A loudspeaker with two waves |
| `ui_asleep` | A lobby seat the start no longer waits for (not ready for a while) | A closed, sleeping eye under a crescent moon (no "Z": that is a letter). Worn in the client's pale blue `#9db8ff` |
| `ui_outdated` | This page is older than the server: reload it | A page inside a turning arrow. Worn in danger red, like the other notices |

### Settings and the drone

| File | Meaning | What is drawn |
| --- | --- | --- |
| `ui_settings` | Open the settings panel | A cog wheel |
| `ui_controls` | Open the controls card (every button of your side) | A card with a solid key on the left and a directional cross on the right |
| `ui_invert` | Turn the up-down look around | An arrow up and an arrow down, side by side |
| `ui_fullscreen` | Full screen | Four corners pushed out to the edges around a solid screen |
| `ui_lowres` | Lower resolution, for slow computers | A ball drawn with big, blocky pixels |
| `ui_rise` | The news drone goes up | The drone (a body under two rotors) with a thick arrow up above it |
| `ui_sink` | The news drone goes down | The same drone with the arrow below it |

`ui_warning` is the one outlined triangle in the set. The kaiju's triangle is always solid.

## skyline.svg: the destruction bar

A single-color city silhouette that the UI crumbles from left to right as the bar fills.

- **viewBox `0 0 400 64`, root attribute `preserveAspectRatio="none"`.** The ground is `y = 64`.
  `x` runs with the bar: `x = 400 × fill`, where `fill` is the value of `barDisplayFraction()`
  (0 to 1).
- **It is drawn to be stretched.** The game's bar is a box about 12 times wider than tall
  (560 × 46 pixels: 1.4 pixels per unit across, 0.72 pixels per unit up). Everything in the file
  is therefore drawn about twice too tall, and comes out right in the bar. Give the inlined
  `<svg>` the full width and height of the bar; do not keep its own proportion. Narrower bars
  (down to about 400 pixels wide at the same height) still read.
- **Three stepped towers stand at the three marks.** Each is 24 units wide (34 pixels in the
  bar), has three tiers and a spire 3 units wide, and **ends on its mark**, so it is the last
  thing to fall before the mark is passed (the third one ends the bar):

| Mark | Share of the width | Tower spans x | Spire spans x | Tower top (spire tip) at y | Height in the 46 pixel bar |
| --- | --- | --- | --- | --- | --- |
| 1 | 21% | 60 to 84 | 70.5 to 73.5 | 12 | 37 pixels |
| 2 | 57% | 204 to 228 | 214.5 to 217.5 | 6 | 42 pixels |
| 3 | 100% | 376 to 400 | 386.5 to 389.5 | 2 | 45 pixels |

- The ordinary buildings: gabled houses and a shop before the first tower; blocks, a factory and
  a dome before the second; blocks and an arched hall before the third. **Every ordinary roof
  stays between `y = 40` and `y = 56`** (6 to 17 pixels tall in the bar), so each tower stands
  more than twice as high as anything else in its stretch. Keep it that way: the towers are the
  marks, and they only read as marks while nothing competes with them.
- The file holds two paths, both `currentColor`:
  - `class="sky-city"`: the standing city, one building per line in the file. **Clip or mask
    this one from the left.** It is never lower than `y = 56`.
  - `class="sky-rubble"`: a low jagged heap (between `y = 56.5` and `y = 60`) that lies
    completely inside the city's outline. It cannot be seen while the city stands and is what
    remains where the city has been clipped away. Give it the rubble color.

With the file inlined, the whole effect is two style rules (this is what `ui_skyline.png` shows):

```css
.bar .sky-city   { clip-path: inset(0 0 0 34%); }   /* 34% = fill × 100 */
.bar .sky-rubble { color: #8d8d94; }
```

## Checking and previewing

```bash
node tools/art/ui/preview.cjs            # check every icon, then write the pictures to docs/art/previews/
node tools/art/ui/preview.cjs --check    # check only; prints what each icon covers
node tools/art/ui/preview.cjs --out /tmp/mb-scratch/ui-icons --only kaiju   # one group, to a scratch folder
```

It uses the headless Chromium that comes with the pre-installed Playwright (never run
`playwright install`). The checks fail (exit code 1) when a contract name has no file, a file is
not well-formed, the viewBox is wrong, a fill or stroke is anything but `currentColor` or `none`,
a file contains text, an id, a style or a script, a stroke is not the set's weight, the drawing
is empty or cut off by the edge of its box, or the drawing comes closer than 2 units to an edge.
The list of names is `GROUPS` at the top of the script; a new icon has to be added there and to
`docs/ASSETS.md` section 5.

**How to judge an icon.** Open `ui_icons_real_sizes.png` and find the strip for the place the
icon is used. The upper picture of each strip is what a player gets, pixel for pixel; the lower
one is the same pixels enlarged three times. Cover the name and ask "what does this mean?" of
the upper picture. If the answer takes longer than a second, redraw it. Check it over all three
skies if it sits straight on the picture, and next to its neighbors: four gamepad glyphs under
four verbs must be told apart without comparing them.

## What was tried and dropped

So the next artist does not repeat it:

- `k_swipe` as three arcs with claw tips read as a wireless signal; tapered slashes read as claws.
- `k_stomp` seen from the front read as a bell. In the side view, a flat-topped vertical leg read
  as a boot, and two arcs under the sole as the blade of an ice skate. A strongly slanted leg
  with long thin claws read as a four-legged animal (the claws became legs). What works: a steep,
  thick leg from the top-left, three thick hooked claws at the front of the foot, one flat ring.
- `k_grab` with a third, middle talon and a wrist stub on top read as a pumpkin or an onion; the
  car needs clear space all around it.
- `k_throw` with a hand drawn as three splayed claws read as an arrowhead pointing the wrong
  way; a car on a dotted arc with no hand read as a car driving a route.
- `k_brace` with a clawed forearm inside a shield outline read as a molar.
- `k_molt` as a banded pod hanging from a twig read as an acorn or a hive; with spines on one
  side only it was lopsided and read as an egg at 18 pixels.
- `cmd_fireatwill` as bursts alone read as sparkles, and as shots fanning out to bursts read as
  a party popper. Shells of one size, flying the same way, read as gunfire.
- `st_reload`: three shells at 20 pixels are a scatter of dots; one shell reads.
- `st_charge` as a bolt inside an outlined diamond turned to mush at 20 pixels; the bolt cut out
  of a solid diamond holds.
- `st_crossfire` with two arrows rising from below read as "merge".
- `st_shaken` with a tight zigzag mouth read as a moustache at 52 pixels.
- `lb_kaiju` with a zigzag grin read as a carved pumpkin from 42 pixels up.
- `fac_science` as three ellipses is a software library's logo (see above).
- `fac_faith` seen from the front (a pointed arch with a seam) read as a rocket, a light bulb or
  a figure with raised arms, and its cuffs as feet; splayed sleeves read as plier handles. The
  side view with a thumb reads as hands.
- `tl_office` with plain horizontal stripes read as a document; `tl_apartment` drawn wide read
  as a keyboard; `tl_bridge` as a line drawing read as a fence; `tl_kiosk` with a row of small
  awning tabs read as a lantern; `tl_shop` with a plain awning read as a printer; `tl_tower`
  narrow with three window slots read as a chess bishop.
- `st_callin` as one bomb with fins and speed lines read as a beetle.
- Gamepad shoulder glyphs that showed the whole pad with a small bar could not be told apart at
  19 pixels; Start and Back as a pill with a triangle read as media buttons.
- The skyline at its own 6.25 to 1 proportion was squashed to half height by the bar, and its
  thin spires vanished.
