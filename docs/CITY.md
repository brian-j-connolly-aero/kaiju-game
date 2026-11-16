# Port Meridian

Port Meridian is the one city of Monster Battle 9001. This document is for the owner (a tour and
the reasons behind the layout) and for the building artists who model it next (every district,
every landmark and every ordinary building type, described so it can be modeled without asking).

Status: **the game plays in Port Meridian** (since 12 November): the server, the client, the
sandbox, the bots and the balance harness all build it through `getCity()`. The placeholder grid
city is kept for tests and as a development option. Section 9 says what the switch did; the
client's part (district tint, draw-call count) was done on 12 November (section 8). Since phase
3 (14 November) the ten starting neighborhoods are packed close, six new kinds of buildings
stand in them, every district has a roof color, and more special buildings stand beyond the
starts (section 13).

![The whole city](city/map.png)

Pictures in `docs/city/` (all drawn by `npx tsx shared/scripts/cityMap.ts --city meridian`;
north is up, east is to the right, exactly like the in-game map):

| Picture | What it shows |
|---|---|
| `map.png` | The whole city, colored by district, buildings shaded by height, landmarks in red, starting neighborhoods as orange dots. |
| `roads.png` | The street network the army's vehicles drive on, with bridges and the ford. |
| `heat.png` | Where the value is: the brighter, the more points a kaiju earns by wrecking it. |
| `anchors.png`, `anchor_<name>.png` | For each starting neighborhood, the stage 1 square (blue) and stage 2 square (orange), with the value inside each; the special buildings are purple dots. The close-ups (2 pixels per meter) color the garages, the back lanes, the diner, the motel, the firehouse and the three special buildings each their own way (legend along the bottom). |
| `district_<name>.png` | A close-up of each district at 1 meter per pixel. |
| `model.png`, `model_downtown.png` | An "architect's model": every building as an extruded box, seen from the south-west. |

The model pictures are drawn by the same script (a small box renderer written for it), not by the
Blender tools under `tools/art/lib`: that was faster to iterate on and needs no 3D software.

---

## 1. A short tour

Port Meridian is a harbor city about 2.1 km across, built on a square of land with the sea to the
south. A wide bay is cut into the south coast. The **River Wend** comes down from the north edge,
bends past Temple Hill, splits around **Chapter Island** (where the cathedral stands) and reaches
the bay between the Old Town on the west bank and the downtown towers on the east bank.

- In the middle stands **Downtown**: a regular grid of glass towers around **Meridian Tower**, the
  tallest building in the city (220 m), with **City Hall** on Founders Plaza at the waterfront and
  **Grand Meridian Station** at the north end.
- Around downtown lie the mid-rise quarters: the crooked **Old Town** across the river, the
  **University** and the **Halcyon Science Park** to the north, **The Cinder Works** (industry and
  the power station) to the east, **The Docks** along the east side of the bay, and **The
  Boardwalk** (stadium, ferris wheel, beach) on the west side of the bay.
- Along the west, north and east edges lie the low-rise neighborhoods where a match starts:
  **Bellhaven**, **Temple Hill** (terraces on a round hill around a temple), **Hollowmere**,
  **Northgate** and **Easter Green**. Where a match starts they are packed close: narrow
  streets, houses up to the pavement, back lanes lined with garages, and a diner, a motel and a
  firehouse on the busier streets (section 13).
- A **beltway** runs all the way round the city edge. It is where army squads arrive in the
  last stage. Outside it, along the west, north and east edges, runs the **Old Moat**, where a
  young Gragnor can swim (section 11).

### Why the city is laid out in three bands

The city is a level first. Three distances shape it:

- **The core.** The towers stand within about 200 m of the center, inside the ring boulevard
  (River Drive, East Ring, Kingsway and the core streets). Every starting neighborhood is 920 m
  from the center, so its stage 2 square (which slides toward downtown) stops at the ring
  boulevard. A juvenile kaiju never gets the towers; they are the titan's prize.
- **The frame.** Avenues at 740 m from the center separate the starting neighborhoods from the
  mid-rise ring. Inside every stage 2 square there is a dense mid-rise "inner ring" quarter
  in the corner nearest downtown, which draws the juvenile toward the towers.
- **The edge.** The beltway at 1070 m is where squads deploy at stage 3.

---

## 2. The districts

Colors are the map tint. So that a district is recognizable from a kaiju's eye as well as on the
map, every district also carries a **building tint** (`District.tint` in the city data, a color
the client multiplies each building's color by: one color per building instance, no extra draw
calls). Each ordinary building type has **one** model for the whole city, made in light, neutral
colors (pale stone, white render, light grey roofs, plain glass); the tint gives it the district's
color family. A white model shows the tint exactly; a dark one hardly changes.

| District | Building tint | Effect on a white wall |
|---|---|---|
| Downtown | `#d8e0ec` | cool blue-grey glass and stone |
| Old Town | `#f4e2c2` | warm sand and ochre |
| Temple Hill | `#f2dad2` | dusty rose plaster |
| Hollowmere, Northgate, Easter Green, Bellhaven | `#f4f2e6`, `#f4f0e4`, `#f6f2e6`, `#f6efe4` | almost white: the pastel suburbs keep their own mixed colors |
| University | `#f0d2c4` | red-brick warmth |
| Halcyon Science Park | `#eef2f6` | clean white and glass |
| The Cinder Works | `#dccec2` | soot brown-grey |
| The Docks | `#d6dee2` | harbor blue-grey |
| The Boardwalk | `#fcf6ee` | whitewash |

The client applies it (`client/src/render/cityView.ts`): a building's wall faces (those its
model masks for paint, `docs/art/client-notes-city.md` section 2) take one of the colors its
model offers, picked by the structure's id, times the tint of the district its center is in.
Roofs take the district's roof color (below); glass, signs and doors keep the art's colors.
Landmarks are one-offs and are modeled in their final colors; the tint is for ordinary
buildings only.

**Roof colors** (phase 3: "roofs colored by district"). Every district also has a **roof color**
(`District.roof` in the city data, beside `District.tint`; the full city checksum covers both).
The models draw their roofs in light neutral greys and mark them in their vertex colors (alpha
0.5; wall paint is 1, the art's own color 0); the client paints those faces the district's roof
color, a few shades apart from building to building (picked by the structure's id), so a street
is not one flat color. One color per instance, no extra draw calls. Landmarks, bridges and the
three special buildings keep their own colors. The client draws it since phase 3 (four shades,
picked by the structure's id; standing, damaged, falling and in the mounds), and the map paints
each district's ground in its roof color, sunk into the dark map. The colors are chosen so that every district,
and so every starting neighborhood, reads as its own place from the monster's height and on the
map: neighbors differ in hue or in lightness. The two starts in Hollowmere (Alder Row,
Dovecote) and the two in Northgate (Ivy Court, Harrow Lane) share their district's roofs.

| District | Roof color | Looks like | Starts |
|---|---|---|---|
| Downtown | `#7c8794` | steel grey flat tops | |
| Old Town | `#b04e36` | old red clay tiles | |
| Temple Hill | `#cf7442` | terracotta | Fennel Hill |
| Hollowmere | `#6b8a46` | moss green | Alder Row, Dovecote |
| Northgate | `#45484f` | charcoal | Ivy Court, Harrow Lane |
| Easter Green | `#9c3530` | brick red | Easter Green |
| Bellhaven | `#55709a` | slate blue | Bellhaven |
| University | `#6e5470` | plum slate | |
| Halcyon Science Park | `#b4bcc4` | pale aluminium | |
| The Cinder Works | `#6a5c52` | soot, a warm brown-grey | Cinder Flats |
| The Docks | `#a65a2c` | rust | Gull Point |
| The Boardwalk | `#5c9c98` | faded teal | Juniper Bay |

(The data: `DISTRICT_ROOFS` in `shared/src/city/meridian/layout.ts`. The art's side: the roof
mask, `docs/art/client-notes-city.md`.)

| District | Map tint | Street pattern | Buildings | Structures | Value |
|---|---|---|---|---|---|
| Downtown | slate blue | regular grid | towers, offices, big apartments | 183 | 42 953 |
| Old Town | warm sand | crooked, irregular | row houses, shops, small apartment blocks | 199 | 8 050 |
| Temple Hill | dusty rose | rings and spokes round the temple | houses, shrines, cloister halls | 345 | 8 987 |
| Hollowmere | pale green | curving suburban streets | detached houses, bungalows, duplexes, garages | 366 | 3 837 |
| Northgate | pale green | grid with a diagonal avenue | houses, row houses, the television mast | 476 | 6 938 |
| Easter Green | pale green | garden suburb round a green | houses, bungalows, a few apartments | 222 | 3 593 |
| Bellhaven | pale green | small grid | houses, duplexes, high street shops | 267 | 3 748 |
| University | lavender | quads | lecture halls, row houses, clock tower | 105 | 7 532 |
| Halcyon Science Park | lavender | grid cut by the diagonal Harrow Road | offices, labs, observatory | 115 | 8 729 |
| The Cinder Works | warm grey-brown | big lots | factories, tanks, power station, workers' rows | 226 | 6 233 |
| The Docks | blue-grey | big lots and a crooked fishing quarter | cranes, containers, warehouses, gasworks | 435 | 12 640 |
| The Boardwalk | peach | small grid and a seafront strip | pavilions, hotels, stadium, ferris wheel | 248 | 6 238 |

(Structures and value counted inside each district polygon, since phase 3. Totals: 3185
structures worth 119 478 points; before phase 3, 2695 structures worth 110 896 points. The
Farewell Light stands on the harbor mole, outside every district.)

**Downtown.** The prize of stage 3. A tight grid of 14 m streets between the 22 m ring avenues,
blocks filled edge to edge with offices and towers (12 to 165 m), Meridian Tower in the middle
next to Exchange Square. Founders Plaza and City Hall face the bay; the Embankment Promenade runs
along the waterfront; Station Square and Grand Meridian Station close the north end. Long straight
avenues give the army volleys and crossfire; the towers block sight lines in between. Glass and
steel, blue-grey with pale stone at the base.

**Old Town.** The west bank opposite downtown. Crooked lanes, small blocks, row houses and shops
three to five stories high, with Market Square (a looped street round a plaza) in the middle and
the Cathedral Close by the river. Warm stone, ochre plaster, red tile roofs. For the juvenile: a
dense, tramplable feast; for the squads, tight quarters with short sight lines.

**Temple Hill.** A round hill north-west of Old Town, built in terraces: ring streets and spokes
around the Temple Gardens and the Sevenfold Temple on top, with small tiered shrines along the
rings and long cloister halls on the outer terraces. Pale plaster, terracotta, rose. Two starting
neighborhoods (Fennel Hill on the west slope, and the Pilgrims Rise high street) lie here. Tanners
Ford, the one marked ford over the river, leads from the hill to the University.

**Hollowmere, Northgate, Easter Green, Bellhaven (the suburbs).** The hatchling's pantry: houses,
bungalows and duplexes close together on narrow streets, back lanes lined with garages (to hide
behind), corner shops, a diner, a motel and a firehouse, parked cars, small greens and plazas
(open spots where squads can catch a hatchling). Hollowmere has curving streets and cul-de-sacs; Northgate is a
plain grid crossed by Harrow Road, with Signal Hill and its mast; Easter Green is a garden suburb
in rings round a round green; Bellhaven is a small grid with a high street. Pastel walls, grey and
red roofs, lots of trees.

**University and Halcyon Science Park.** North of downtown. Quads of long lecture halls round
Scholars Quad and the Founders Clock Tower; then the science park, a grid of mid-rise offices and
labs cut diagonally by Harrow Road, with the Halcyon Observatory on its green hill. Red brick and
pale stone at the university, white and glass in the science park.

**The Cinder Works.** East of downtown. Big lots: sawtooth factories, warehouses, round storage
tanks, and the Kiln Point Power Station with its chimneys at the east edge; workers' row houses
around Cinder Flats in the south-east. Soot brown, rust, grey concrete. The big lots look sparse
on the map (one to five buildings on a 100 x 130 m block): that is deliberate. Their yards must
stay open (section 10: no yard may trap a squad, and buildings a juvenile cannot trample keep
19.5 m apart), and a trial that packed them with container stacks lost almost all of them again
to the yard opener. In 3D the sheds, tanks and chimneys still read as heavy industry.

**The Docks.** The east shore of the bay. A row of gantry cranes along the quay, container stacks,
warehouses, the Number Three Gasworks, and a crooked fishing quarter of small houses around Gull
Point. The Long Mole runs west from the docks into the bay to the Farewell Light. Blue-grey,
rust red, container colors (orange, teal, red).

**The Boardwalk.** The west shore of the bay. Seafront hotels, striped pavilions along Juniper
Strand (the beach), Wheel Plaza with The Tidewheel, a pier, and Anchor Field (the stadium) behind
the Stadium Concourse. Whitewash, candy stripes, sea blue.

---

## 3. The landmarks

Every landmark is its own archetype (one model file `lm_<id>.glb`), with its own name. Positions
are in meters from the city center (east, north). Footprint is width x depth at ground level;
"faces" is the side its front looks to. Landmarks over 70 m (the wheel, the power station, the
mast, Meridian Tower) cannot be trampled even by the titan; the rest fall to its feet. All names
are invented; nothing copies a real place, building, brand or faith.

Damage, for every landmark: the game shows three states (intact, damaged, rubble). Damaged means
broken windows, a missing corner or top, scorch marks and something bent; rubble is a low heap in
the landmark's colors with one recognizable piece sticking out (named below), so players can still
tell what it was.

| Landmark | id | District | Position (E, N) | Footprint | Height | Hit points | Value |
|---|---|---|---|---|---|---|---|
| Meridian Tower | `meridian_tower` | Downtown | -51, -25 | 36 x 36 | 220 | 12 000 | 1 500 |
| City Hall | `city_hall` | Downtown | 0, -292 | 50 x 40 | 45 | 5 000 | 900 |
| Tidewater Cathedral | `tidewater_cathedral` | Old Town (Chapter Island) | -330, -176 | 40 x 72 | 58 | 6 000 | 900 |
| Anchor Field | `anchor_field` | The Boardwalk | -605, -590 | 150 x 120 | 30 | 14 000 | 1 200 |
| The Tidewheel | `tidewheel` | The Boardwalk | -690, -744 | 64 x 14 | 76 | 2 500 | 500 |
| Halcyon Observatory | `halcyon_observatory` | Halcyon Science Park | 408, 568 | 40 x 40 | 24 | 3 000 | 500 |
| Farewell Light | `farewell_light` | the harbor mole | -172, -940 | 12 x 12 | 48 | 1 500 | 350 |
| Kiln Point Power Station | `kiln_point_power` | The Cinder Works | 905, 68 | 110 x 70 | 82 | 12 000 | 1 300 |
| Sevenfold Temple | `sevenfold_temple` | Temple Hill | -590, 460 | 44 x 44 | 52 | 4 000 | 700 |
| Grand Meridian Station | `grand_station` | Downtown | 100, 263 | 110 x 50 | 40 | 7 000 | 900 |
| Signal Hill Mast | `signal_mast` | Northgate | 585, 925 | 16 x 16 | 160 | 3 000 | 500 |
| Number Three Gasworks | `gasworks` | The Docks | 660, -870 | 56 x 56 | 44 | 4 000 | 600 |
| Founders Clock Tower | `founders_clock` | University | -100, 560 | 12 x 12 | 62 | 2 000 | 400 |
| Grand Harbor Bridge | `bridge_b` (bridge) | river mouth | -330, -405 | 22 x 110 | 36 | 4 000 | 400 |

**Meridian Tower** (faces south). The city's compass needle, seen from everywhere. A square
glass shaft that steps in three times as it rises (setbacks at about 80, 140 and 190 m), crowned
by an open steel lantern and a slim spire. Blue-green glass with bright white vertical fins at the
corners; a gold band at each setback that catches the light. A two-story stone podium with a
deep entrance canopy on the south side. Damaged: the spire bent over, a setback broken open with
floors showing. Rubble: the lantern lying on the heap.

**City Hall** (faces south onto Founders Plaza). A wide neoclassical block of pale limestone,
three stories, with a portico of eight columns and a broad flight of steps, carrying a tall
ribbed copper dome (weathered green) on a drum ringed by small columns, topped with a lantern and
flagpole. Two short wings. Damaged: dome caved in on one side, columns snapped. Rubble: the
green dome shell, cracked, on top.

**Tidewater Cathedral** (faces north, on Chapter Island). Long and narrow (72 m), dark grey
stone with a steep slate roof, one tall square bell tower at the north end with a pointed spire,
flying buttresses along both sides and a big round window over the north door. Rows of tall
narrow windows with blue glass. Fictional and of no particular faith: no symbols on the roof or
spire beyond a plain finial. Damaged: spire snapped, buttresses broken off. Rubble: the round
window frame standing upright.

**Anchor Field** (faces north). The stadium. An oval bowl of white concrete tiers with four
tall floodlight masts at the corners and a cantilevered roof over the west stand, bright green
pitch inside, the outer wall banded in sea blue. Damaged: a stand collapsed inward, one mast down.
Rubble: a broken ring with the green pitch still showing.

**The Tidewheel** (faces south, onto the beach). A giant ferris wheel, 76 m, on two A-frame legs,
with about 24 candy-striped gondolas (red, white, sea blue) and a ring of bulbs. A small ticket
pavilion at its foot. The footprint is long and thin (64 x 14): the wheel's face runs east-west,
so from the beach and the sea you see the whole round wheel. Damaged: wheel tilted and buckled, gondolas hanging. Rubble: the wheel on its side,
half rolled.

**Halcyon Observatory** (faces south, on Halcyon Hill). Low and wide: a round white drum with a
big silver dome split by an open shutter slot, a telescope tube poking out, and two smaller
domes on a terrace. Damaged: the big dome cracked open like an egg. Rubble: the telescope tube
pointing at the sky.

**Farewell Light** (faces north, at the end of the Long Mole). A lighthouse, 48 m: a round
tapering tower with red and white bands, a black gallery and a glass lamp room on top, on a
square stone base. Damaged: lamp room smashed, top leaning. Rubble: the red-and-white stump.

**Kiln Point Power Station** (faces west). A huge brick turbine hall with tall arched windows,
four square chimneys rising to 82 m at the corners, a boiler house and a row of transformers.
Dark red-brown brick, black soot streaks on the chimneys. Damaged: a chimney snapped mid-height,
roof holed with steam. Rubble: two chimneys still standing out of the heap.

**Sevenfold Temple** (faces east, at the top of Temple Hill). Seven round drums stacked on a
broad square stone platform with stairs on all four sides, each drum narrower than the one below
and each capped by a flat, wide brim roof (like a stack of hat brims), terracotta and cream, with
thick ropes hung with big bronze bells looping between the brims. Clearly invented: no upturned
eaves, no pagoda or real temple shape, and no symbols. Damaged: top three drums gone, bells
hanging loose. Rubble: the lowest brim on the platform with a bell beside it.

**Grand Meridian Station** (faces south onto Station Square). A long hall of iron and glass: a
barrel-vaulted train shed behind a stone front with a big round clock window over the entrance
and two short towers at the ends. Cream stone, green ironwork, glass roof. Damaged: vault
collapsed in the middle. Rubble: the clock face on the heap.

**Signal Hill Mast** (on Signal Hill). The television mast: 160 m, a slim red-and-white lattice
tower with dishes at two heights, a small equipment house at the foot, blinking lights at the
top. The north side of the city's sky line. Damaged: top third folded over. Rubble: a long bent
lattice lying across the park.

**Number Three Gasworks** (faces west). Two round gas holders in tall green iron frames (columns
and rings), one full and high, one half sunk, next to a brick retort house. Damaged: a frame
twisted, the holder deflated. Rubble: the iron rings.

**Founders Clock Tower** (faces south, on Scholars Quad). A slender square red-brick tower,
62 m, with four big white clock faces near the top, a copper pyramid roof and a small lantern.
Damaged: clock faces shattered, roof gone. Rubble: one clock face leaning on the heap.

**Grand Harbor Bridge** (the river mouth). The one tall bridge, a road deck 24 m wide (the 22 m
River Drive plus a curb each side) under two steel truss arches 36 m high, painted rust red, joining Old Town and downtown along the
waterfront. It is a bridge archetype (passable, it carries roads), not a landmark class.
Damaged: one arch broken. Rubble: the deck sagging into the river.

Spread: every part of the city has one in sight. The tall ones (tower, mast, wheel, chimneys,
cathedral spire, clock tower) are visible across the city; each stage 2 square holds at least one
landmark (section 6). On a 25 m grid of dry land inside the beltway, no point is further than
748 m from a landmark (the far north-west corner, near Alder Row).

Every landmark a juvenile can reach (those in some stage 2 square: all but Meridian Tower, City
Hall and the Farewell Light) has a 20 m apron: no building taller than 12 m (one the juvenile
cannot trample) stands within 20 m of it, so the 18 m wide juvenile never wedges itself into a
notch between a landmark and a block of flats.

---

## 4. The ordinary buildings

49 archetypes in total (the cap is 56 since phase 3, see section 8): the 22 the placeholder city
already had, 18 appended for Port Meridian (6 new ordinary types, one new bridge, 11 new
landmarks), the 3 special buildings of phase 2 (section 12) and the 6 kinds phase 3 added for
the starting neighborhoods (marked *(phase 3)* below; section 13). Size is width x depth x
height in meters. The class decides what the game counts (end-screen tallies).

Rules of thumb for gameplay: houses (5 to 9 m) are the hatchling's food; shops and low blocks
(up to 12 m) get trampled by the juvenile; apartments and offices stop the juvenile; towers above
70 m stop even the titan's trample.

For the artists: one model per id, made in **light, neutral colors** (the district tint in
section 2 adds the color family), with **at most two materials** per model, taken from the shared
ones in `docs/ASSETS.md` (the draw-call budget in section 8 depends on it). Bridge models are
stretched to fit their crossing (section 5): put the piers at the two ends of the deck and make
the middle spans and railings plain and repeating along the length, so a stretch from 57 to
82 m (`bridge_a`) or to 104 m (`bridge_b`) and a little extra width does not look wrong.

| id | Class | Size | Where | Look |
|---|---|---|---|---|
| `house_a` | house | 9 x 10 x 6 | suburbs, Old Town edge | Two-story detached house, pitched gable roof, white render, white trim, light grey slate. |
| `house_b` | house | 11 x 9 x 7 | suburbs, Temple Hill | Wider house with a hipped roof and a porch, pale render, light clay-tile roof (the tint makes it terracotta on Temple Hill). |
| `house_c` | house | 8 x 8 x 5 | suburbs, Boardwalk, Docks | Small cottage, one and a half stories, steep roof, pale clapboard walls, light grey roof. |
| `rowhouse_a` | house | 7 x 11 x 9 | Old Town, University, Cinder Works | Three-story narrow terraced house, flat front with a parapet, light sandstone-colored brick, chimney stack. Placed in rows (the tint turns the rows ochre, brick red or soot brown by district). |
| `shop_a` | shop | 11 x 10 x 5 | suburbs, Boardwalk | One-story corner shop, flat roof, striped awning, big window. |
| `shop_b` | shop | 14 x 11 x 8 | Old Town, Docks, University | Two-story shop with a flat over it, shopfront and awning below, brick above. |
| `shop_c` | shop | 12 x 12 x 10 | Downtown, Old Town | Three-story shop block with a cornice, stone ground floor, sign band. |
| `apartment_a` | apartment | 18 x 14 x 20 | Old Town, suburbs, University | Six-story walk-up, flat roof with water tank, brick, balconies. |
| `apartment_b` | apartment | 16 x 16 x 28 | Old Town, Downtown, Boardwalk | Eight-story block, square, white plaster with balconies and big windows (it reads as a seafront hotel on the Boardwalk). |
| `apartment_c` | apartment | 24 x 14 x 36 | Downtown, Docks | Ten-story slab, long and narrow, concrete with strip windows. |
| `office_a` | office | 20 x 20 x 42 | Downtown, University | Twelve-story office, stone grid facade, flat roof with plant room. |
| `office_b` | office | 24 x 18 x 55 | Downtown | Glass office slab with a setback at the top. |
| `office_c` | office | 22 x 22 x 68 | Downtown | Twenty-story glass and stone office with a crown. |
| `tower_a` | tower | 26 x 26 x 95 | Downtown | Square glass tower, flat top with a mast. |
| `tower_b` | tower | 30 x 30 x 130 | Downtown | Glass tower with chamfered corners and a stepped top. |
| `tower_c` | tower | 28 x 28 x 165 | Downtown | The tallest ordinary tower: dark glass, a slanted roof. |
| `factory_a` | factory | 36 x 24 x 14 | Cinder Works, Docks | Sawtooth-roof factory shed, brick and corrugated metal, one short chimney. |
| `factory_b` | factory | 44 x 30 x 18 | Cinder Works | Big steel hall with a gantry, rusty cladding, roof vents. |
| `warehouse_a` | factory | 30 x 20 x 11 | Cinder Works, Docks | Plain warehouse with a curved roof and loading doors. |
| `bridge_a` | bridge | 16 x 74 x 8 | river crossings | Ordinary road bridge: concrete deck on piers at both ends, railings, lamps. Passable. Stretched to each crossing: 16 to 24 m wide, 57.5 to 81.5 m long. |
| `tank_a` *(new)* | factory | 18 x 18 x 14 | Cinder Works, Docks | Round storage tank, white or silver, with a spiral stair and a ring walkway. |
| `crane_a` *(new)* | factory | 16 x 26 x 46 | Docks quay | Gantry crane on four legs straddling the quay edge, boom raised, harbor red or yellow. |
| `container_a` *(new)* | factory | 13 x 26 x 8 | Docks, Cinder Works | A stack of shipping containers three high in mixed colors. The one low industrial piece (a juvenile walks through it), so it is cheap. |
| `campus_a` *(new)* | office | 44 x 16 x 16 | University, Temple Hill | Long hall with a pitched roof, tall windows above a ground-floor arcade, pale stone walls, light slate roof (lecture hall at the university, pilgrim hall on Temple Hill: the tint does the rest). |
| `pavilion_a` *(new)* | shop | 16 x 12 x 7 | Boardwalk | Striped seaside pavilion (arcade, bandstand, bathhouse) with a canvas roof and flags. |
| `shrine_a` *(new)* | shop | 10 x 10 x 11 | Temple Hill, Old Town | Small wayside shrine in the Sevenfold Temple's invented style: three stacked round drums with flat brim roofs and one bronze bell on a rope, cream and terracotta, no symbols, no upturned eaves. |
| `bridge_b` *(new)* | bridge | 22 x 110 x 36 | river mouth | The Grand Harbor Bridge (section 3). Placed 24 x 103.5 m. |
| `bungalow_a` *(phase 3)* | house | 10 x 9 x 5 | starting neighborhoods, suburbs, the shore | A one-story bungalow with a deep front porch on posts, a low hipped roof and a chimney. Hp 75, value 7. |
| `duplex_a` *(phase 3)* | house | 12 x 10 x 7 | starting neighborhoods, suburbs | A two-story semi-detached pair, mirrored halves, two front doors with small porches under one long gable roof, two chimneys. Hp 110, value 11. |
| `garage_a` *(phase 3)* | house | 8 x 7 x 4 | the back lanes of the starts, back gardens | A detached two-car garage and workshop, two ribbed roll-up doors (the look of `prop_garagedoor`), a low gable roof. Doors face the lane. Hp 40 (one hatchling swipe), value 4. |
| `diner_a` *(phase 3)* | shop | 16 x 10 x 5 | one per start, on an avenue | A roadside diner: a long body with rounded ends in pastel and chrome, a band of big windows, a picture sign on the roof (a steaming cup or a slice of pie, no letters). Hp 130, value 13. |
| `firehouse_a` *(phase 3)* | shop | 14 x 16 x 9 | one per start, on an avenue | A small brick fire station: two tall red engine doors at the front, a slim hose tower at a back corner that may rise to 12 m (the game counts the 9 m body). Hp 200, value 18. |
| `motel_a` *(phase 3)* | shop | 24 x 10 x 7 | one per start, on an avenue | A two-story motel row: doors and windows in a row, an open walkway with a railing along the upper floor, a stair at one end, a picture sign on a pole (a crescent moon and a star, no letters). Hp 170, value 16. |

Ids are append-only: never rename or reorder. Art files are named after them.

---

## 5. Streets, water and crossings

- **Streets**: 636 junctions and 984 street pieces, 75.7 km in all. Arterial avenues (16 to 22 m
  wide) are drawn by hand: the Meridian Beltway round the edge, Kingsway north-south through the
  center, River Drive and East Ring round downtown, the diagonal Harrow Road, Foundry Street, Quay
  Road, Shore Road, Old Post Road, Ironmongers Road, Northern Avenue and Meridian Avenue. Local
  streets (8 to 14 m) grow inside each district in its own pattern. Inside a starting
  neighborhood's stage 1 square they are 9 m wide (the short closes 8 m) and the houses stand
  10 m from their middle line instead of 12 (phase 3, section 13): 323 pieces, 21.7 km.
- **Back lanes** (phase 3, section 13): 82 straight pieces, 6.5 km, through the middle of the
  deeper blocks of the starts, lined with garages. A lane is not a street: it is not in the road
  graph (nothing plans a route along it), it is open ground anyone may cross, and no building
  comes within 5 m of its middle line. The city data lists them for drawing (`CityData.lanes`).
- **The river** is shallow: units wade across it anywhere at half speed. Six bridge decks cross it
  (the Northgate bridge at the north edge, two on the Temple Hill / University reach, two either
  side of Chapter Island, and the Grand Harbor Bridge at the mouth), plus **Tanners Ford**, a
  marked road through the water below Temple Hill. Bridges are the fast choke points; wading is
  the slow way round. Every deck is the road's width plus a meter each side (never narrower than
  the bridge model): 18, 24, 24, 22, 16 and 16 m wide, so no vehicle drives off the edge into the
  water.
- **The sea**: the bay, a working harbor along the east side with two piers, the Long Mole out to
  the Farewell Light, the Boardwalk pier and beach on the west side.
- **The Old Moat** (section 11): 20 m of water outside the beltway along the west, north and
  east edges of the city, from the beach round to the south-east corner.
- **Parks and plazas** (27 in all, named on the map): a green or plaza at every starting
  neighborhood, the Temple Gardens, Scholars Quad, Halcyon Hill, Signal Hill, Wend Gardens along
  the river, Founders Plaza, Exchange Square, Station Square, Market Square, the Stadium
  Concourse, Wheel Plaza, the Embankment Promenade along the downtown waterfront and Juniper
  Strand (the beach).
- **Props** (5575): parked and moving cars, taxis, vans, trucks, buses at stops, kiosks on plazas
  and high streets, trees in parks and along avenues, lamps, traffic lights at junctions,
  benches, hydrants and billboards; and since phase 2 the city weapons by the houses and shops
  of the starts (227: section 12).

---

## 6. The starting neighborhoods (anchors) and fairness

A match starts at one of ten neighborhoods. All lie in low-rise areas 920 m from the center; the
stage 1 square (180 m half-size) holds only houses, shops, cars and kiosks, packed close since
phase 3 (narrow streets, small gardens, back lanes with garages: section 13), and a green or
plaza for squads to catch a hatchling in. The destruction bar marks are fractions of the value
inside these squares, so the value inside them is kept close for every start (measured with the
game's own `stageBounds` and `valueInBounds`):

| Anchor | Position (E, N) | Value in stage 1 square | Value in stage 2 square | Landmarks in the stage 2 square |
|---|---|---|---|---|
| Alder Row | -920, 920 | 1742 | 17 755 | Sevenfold Temple |
| Bellhaven | -920, -240 | 1730 | 18 055 | Tidewater Cathedral |
| Cinder Flats | 920, -235 | 1730 | 18 824 | Kiln Point Power Station |
| Dovecote | -540, 920 | 1721 | 17 851 | Sevenfold Temple, Grand Meridian Station, Founders Clock Tower |
| Easter Green | 920, 380 | 1730 | 19 027 | Kiln Point Power Station |
| Fennel Hill | -928, 328 | 1736 | 19 637 | Tidewater Cathedral, Sevenfold Temple |
| Gull Point | 920, -720 | 1734 | 17 314 | Number Three Gasworks |
| Harrow Lane | 920, 920 | 1738 | 17 681 | Halcyon Observatory, Signal Hill Mast |
| Ivy Court | 240, 920 | 1726 | 18 327 | Halcyon Observatory, Grand Meridian Station, Founders Clock Tower |
| Juniper Bay | -920, -600 | 1731 | 17 324 | Tidewater Cathedral, Anchor Field, The Tidewheel |

(Since phase 3, packed close. Before, with phase 2's special buildings: 1326 to 1415 and 16 923
to 19 168.) Spread: stage 1 within 1.2% (1721 to 1742; the target since phase 3 is about 10%),
stage 2 within 14% (17 314 to 19 637; about 25% allowed). No stage 2 square reaches the
downtown core. The knobs that balance the starts are each start's `tight` settings and its
parked cars (`layout.ts`, section 13).

---

## 7. What was measured

All numbers below were measured on the shared 4-core machine while other work was running
(load average 2.3 to 4.7; another program's headless browser used up to 3.6 cores at times). The
machine was never idle.

**Size** (since phase 3, section 13): 3185 structures, 5575 props, 49 archetypes, 13 landmarks
plus the landmark bridge, 6 bridge decks, 74 special buildings (3 in every start and 44 beyond
them), 82 back lane pieces, 12 districts with their tints and roof colors, 10 anchors, 27 parks
and plazas, and the Old Moat (section 11). (Phase 2: 2664 structures, 5588 props, 43
archetypes, 30 special buildings.)

**Same everywhere**: city checksum (seed 9001, the game's seed) 1022541364, full checksum
(`meridianChecksum`, which also covers streets, areas, districts with their tints and roof
colors, and the back lanes) 894637982. For seed 9002 the city checksum is 2420564289 and the
full checksum 1288996068. (Phase 2's city: 3115597894 and 3365977326, for seed 9002
1387892865 and 973293805. The phase 3 code uses only the same exact arithmetic and passes the
scan; the Chromium run was not repeated. Before phase 2's
special buildings and city weapons: 2695 structures and 5362 props, checksums 3570529651 and
3898350366, for seed 9002 485795498 and 3758613154; Node 22 and headless Chromium 153 computed
exactly the same numbers then, from an esbuild bundle of the generator run in both. The phase 2
code uses only the same exact arithmetic, and the test that scans for anything else passes, but
the Chromium run has not been repeated.) (Before the Old Moat, 14 November: 5541 props, checksums 1739170986 and 1876286051;
for seed 9002, 2320056143 and 424900319. The moat changed nothing but the tree belt outside the
beltway, which it replaced.) The placeholder city is unchanged: 1340881825 from both `generateCity()` and
`getCity()`.

**Build time** (generation plus spatial index):
- Warm engine: 41 to 61 ms (best of five; the test asks under 200 ms).
- First, cold build in a fresh Node process: 166 to 212 ms of processor time on the main thread
  (`process.threadCpuUsage`, 12 runs); on the clock 230 to 580 ms on the busy machine, because
  the build waits for a core. The spatial index is 10 to 20 ms of that. The placeholder: 10 to
  13 ms. Chromium: 270 ms on the clock, busy machine. Sharing one raster between the yard
  passes (done) and a one-sweep flood of the open ground (tried, gave the identical city, saved
  nothing measurable, not kept) did not move the cold number: it is the engine compiling about
  4000 lines of generator code the first time, spread across all steps (yard opening about 80 ms,
  street fronts about 45 ms, props about 23 ms, streets about 15 ms, ground about 14 ms).
- Since phase 3 (section 13), on this machine as it is now (it has become slower: the phase 2
  city's first build measured 337 to 363 ms of processor time under the test runner, against
  the 166 to 212 above): the phase 3 city 310 to 400 ms, median about 330; warm 89 to 105 ms
  (the phase 2 city 80 to 92). Phase 3 sped up the yard opener and the lot search without
  changing what they build, which paid for most of the extra buildings.
- So the cold build is **at the 200 ms budget, not reliably under it**. It happens once, when the
  server starts or the page loads (behind the loading screen). `shared/test/meridianCold.test.ts`
  times that first build on its own and fails over 400 ms of main-thread processor time. If the
  budget must hold cold, the next step is to cache: build once on the server and send the client
  the checksum only, or keep a prebuilt city in the client bundle and check it against the
  checksum (a city's JSON is about 1 MB).

**Bot matches** (`npm run sim -- --city meridian --nav`, before the switch; the tuned numbers
since are in `docs/BALANCE.md` section 8):

| Run | Bar fractions | Kaiju wins | Mean length | Stage times (stage 1 / 2 / 3, when completed) | Navigation |
|---|---|---|---|---|---|
| 20 contested, seeds 101-120 | today's 0.13 / 0.088 / 0.35 | 5 of 20 (25%) | 10:12 | 2:13 / 2:02 / 6:16 | units stuck 0.02% (longest 3.2 s), 2 give-ups in 20 matches, at most 4 units on one bridge deck, kaiju stuck 0.08% (longest 10.5 s) |
| 10 unopposed | 0.18 / 0.13 / 0.30 | 10 of 10 | 7:33 | segment filled after 2:02 / 2:11 / 2:57 | no stuck units |
| 30 contested, seeds 401-430 | 0.18 / 0.13 / 0.30 | 22 of 30 (73%) | 9:13 | 2:48 / 2:47 / 3:38 (seeds 411-430) | units stuck 0.04% (longest 7.5 s), 6 give-ups in 20 matches, kaiju stuck 0.34% (longest 8.5 s) |
| Earlier: placeholder, 20 contested | today's | 7 of 20 (35%) | 10:57 | 3:24 / 3:32 / 3:57 | units stuck 0.00% |
| Earlier: placeholder, 10 unopposed | today's | 10 of 10 | 7:35 | segment filled after 2:07 / 2:06 / 3:00 | |

(The `--bar P1,P2,P3` option of the harness tries other fractions for one run without changing
the rules file. Unopposed matches repeat exactly per start, so 10 unopposed runs cover 8 distinct
starts here.)

What this says:
- Bots navigate the city: no stuck squads, no pile-ups at bridges; units wade 6 to 10% of their
  time, which is the river doing its job. A few route give-ups (0.1 to 0.3 per match) appeared in
  these batches; none were seen in the review's 30 matches. Not investigated.
- At today's fractions the kaiju wins too rarely (25%): stages 1 and 2 are short (about 2:05),
  stage 3 is long (6:16), because the titan starts stage 3 about 720 m from downtown and only
  20% of the city's value lies within 200 m of downtown (placeholder: 23%).
- At 0.18 / 0.13 / 0.30 the kaiju wins too often (73% over 30 matches). Unopposed, stage 3 still
  fills in 2:57, against the 100 to 130 s target. The 408 s kaiju freeze the review found at
  seed 419 (a notch between Anchor Field and a block of flats) is gone: the 20 m landmark apron
  (section 3) removed that building, and seed 419 now plays a normal 7:14 match. The kaiju bot
  itself still has no "back out when stuck" rule (section 9).
- So the retune is still open. The likely direction: p1 and p2 between today's and the trial's,
  p3 near 0.27 to 0.28, then batches of 20 contested and 10 unopposed until the win rate settles.

---

## 8. Budget

- **Archetypes**: 49 of 56 (40 until phase 2's special buildings, 43 until phase 3's six kinds),
  every one from its art file, one material each. The client draws one
  instanced batch per archetype, per damage state (intact, damaged, rubble) and per material of
  its model, and only batches that have instances are drawn (`client/src/render/cityView.ts`),
  plus one draw for all falling collapse pieces. One more archetype would cost up to 3 calls.
  **Measured** (12 November, headless Chromium, stage 3 at night, the whole city in view from
  1.7 km up, `window.__mb.renderer.info()`): every building intact 111 draw calls and 360,000
  triangles; a third of each archetype damaged and a third in rubble (all 120 batches drawn)
  with 480 pieces falling, 166 calls and 367,000 triangles. The most seen in a five-page match:
  130 calls and 462,000 triangles. Budget: 350 and 1.5 million.
- **District tint**: free in draw calls (one color per instance, set once at load).
- **Counts**: 3185 structures (allowed 2500 to 3200), 5575 props (4000 to 6000). Phase 3 added
  about 520 small buildings to the starts (houses, garages: at most 120 triangles each in their
  art, so about 60,000 more triangles with the whole city in view) and 44 special buildings;
  the six new kinds add up to 18 batches (draw calls) when all are drawn in all three states.
- **Phase 3, measured** (14 November, headless Chromium drawing in software, the phase 3 city
  with the roof colors, the back lanes and the hills; `node tools/playtest/shots.mjs --only
  x-city-cost`): in a start at stage 1 from the squad's third-person camera 120 draw calls and
  455,000 triangles, from the hatchling's 120 and 422,000; at stage 3 from the titan's camera 135
  and 449,000; the whole city from 1.7 km up at night 135 and 400,000. Well inside the budget
  (350 and 1.5 million). The roof colors cost no draw call (one more value per instance); the
  hills are one draw call and about 6,300 triangles (measured by hiding them: one call and 6,300
  to 6,500 triangles fewer); the back lanes one draw call and 164 triangles; the sea and the
  river's way north are in the water's own mesh (780 triangles); the gas station's fireball is
  one draw call while it burns (at most 240 puffs of 80 triangles).
- **Phase 3 integration, measured again** on the finished tree (`docs/STATUS.md`, the last
  section): the same `x-city-cost` numbers (120 / 455,000 for the squad and 120 / 422,000 for
  the hatchling at stage 1; 135 / 449,000 for the titan and 134 / 400,000 for the whole city at
  night); the stage visits of `shots.mjs` 126 to 157 calls and 422,000 to 483,000 triangles; the
  most a page drew in two whole five-page and three-page matches, 163 calls and 589,000
  triangles. All well inside the budget.

---

## 9. How to switch the game over to Port Meridian

**Done**: items 1 to 4, 6 and 7 by the city switch, item 5 by the client on 12 November
(section 8 has the measured draw calls). What the switch did, in short: items 1 and 2
as written (the deploy rule, the kaiju bot, `cache.ts`, which now takes `getCity(seed, kind)`);
item 3 was not needed (no archetype changed); item 4: every test listed passes, none loosened
(the clock-end bug was fixed in the simulation, the nav test's missing sub-unit was a navigation
fault on the new city and was fixed with several others, the molt test searches both cities);
items 6 and 7: the documents are updated and the bar fractions were set to 0.18 / 0.125 / 0.31
(`docs/BALANCE.md` section 8 has every batch, and the bot and navigation fixes the new city
needed; sections 9 and 10 how they moved since, to 0.18 / 0.11 / 0.30). The steps as they were planned:

1. **Fix the two bot and spawn problems first** (they show up on this city, and they skew any
   balance numbers taken before they are fixed):
   - *Kaiju bot* (`shared/src/sim` bots): when the kaiju has made no progress for 3 s, back it
     out and choose another target, or smash the building in the way. The city's 20 m landmark
     apron removed the one notch the review found (seed 419, a 408 s freeze), but the city still
     has gaps between tall buildings narrower than a juvenile, so the bot must not depend on the
     city. Add a soak check that fails if the kaiju is stuck for more than 20 s.
   - *Stage 3 deployment* (`shared/src/sim/spawn.ts`): along the south edge the deploy line is
     open sea, and the search for dry ground walks inland to the Long Mole, about 1 km from the
     kaiju (measured from Bellhaven, Cinder Flats and Juniper Bay: one squad leader each on the
     mole at N -954, one unit in the water). Skip a deploy candidate whose dry spot is more than
     about 40 m from its point on the line, or whose nearest street junction is a dead end on the
     mole or a pier, so the squad's sector takes its next point. Add a test that deploys stage 3
     from every start and checks that no squad leader lands more than 40 m inside the line or on
     the mole or the piers.
2. **The one-line change**, in `shared/src/city/cache.ts`: build the city with
   `generatePortMeridian(seed)` (import it from `./meridian/generate`) instead of
   `generateCity(seed)`. `generateCity` itself stays, as the placeholder.
3. **Run `npm run export:defs`** (only needed if archetypes changed since; today
   `tools/art/data/archetypes.json` is in sync).
4. **Tests that assume the placeholder.** A dry run of the whole suite with the city swapped in
   memory (`/tmp/mb-scratch/city-fix/switch/vitest.config.ts`) gave **10 failures in 7 files**
   (the review's earlier dry run gave 11; the extra one, `client/test/session.test.ts`, passed
   this time and looks load-dependent, not city-dependent):
   - `shared/test/meridian.test.ts`: "the placeholder is untouched" expects `getCity()` to be the
     placeholder. Change that half to expect Port Meridian (1739170986); keep the
     `generateCity()` half.
   - `shared/test/city.test.ts`, four tests:
     - "is deterministic, and the seed matters" compares `getCity()` with `generateCity()`
       (not a stored checksum): compare `getCity()` with `generatePortMeridian()` instead.
     - "knows water, parks and bridges" probes a placeholder water spot.
     - "routes across the river over a bridge" and "respects closed edges and reports no route"
       use the placeholder's bridge positions.
     Rewrite the last three against Port Meridian's river and its six bridge decks.
   - `shared/test/flow.test.ts`: squads redeployed at stage 2 came 239.3 m from the kaiju (the
     test asks at least 240). Check `sim/spawn.ts` perimeter points on the new city; probably
     one spawn point or the tolerance.
   - `shared/test/molt.test.ts`: "never leaves a juvenile shaking between walls" fails because
     the test finds no gap of the kind it tries on Port Meridian (it requires at least one).
     Keep it on the placeholder, or let it pass when no such gap exists.
   - `shared/test/nav.test.ts`: "gets every sub-unit to markers dropped anywhere": a sub-unit did
     not arrive at a random marker. **A real issue, not tracked down**: probably a marker dropped
     somewhere the squad cannot reach; check the marker clamping first.
   - `shared/test/prediction.test.ts`: the scripted walk never bumps a wall on the new city;
     move the walk so it does.
   - `shared/test/matchSoak.test.ts`: a match ran 150.033 s against its 150 s clock, exactly one
     tick over (the assertion is that a match never outlasts the clock). That is a clock-end bug
     in the simulation or its report, which the simulation owner must fix; **do not loosen the
     test**. It shows up on this city only because a match happened to end on that tick.
5. **Client** (`client/src/render/cityView.ts`, client owner):
   - Tint each building by its district: once at load, find the district each structure's center
     lies in (point in polygon over `CityData.districts`) and multiply its instance color by
     `District.tint` (absent means white). No extra draw calls.
   - Measure draw calls at stage 3 with buildings in all three damage states
     (`renderer.info.render.calls` in headless Chromium) and write the number in section 8.
6. **Documents that assume the placeholder**: `docs/STATUS.md` (the city section, the bots and
   balance notes), `docs/BALANCE.md` (every measurement and the bar fractions),
   `docs/ARCHITECTURE.md` (the city paragraph names `generateCity`), and this file's status line.
7. **Re-tune** (after item 1): the bar fractions in `shared/src/defs/rules.ts`. Section 7 has the
   numbers: today's fractions give the kaiju 25% of contested matches, the trial 0.18 / 0.13 /
   0.30 gives it 73%, and unopposed stage 3 still takes 2:57 against 100 to 130 s. Try p3 near
   0.27 to 0.28 with p1 and p2 between the two, using `npm run sim -- --city meridian --bar
   P1,P2,P3` (contested, `--seeds 20`, several batches) and `--unopposed --seeds 10`; then write
   the chosen fractions into `rules.ts` and every batch into `docs/BALANCE.md`. The bots' stage 3
   plan (how far the titan walks to downtown) is the next knob if stage 3 stays long.

---

## 10. Where things are (for engineers)

- `shared/src/city/meridian/layout.ts`: the hand-made plan (coast, river, parks, arterial
  streets, landmarks, anchors, districts and their building tints, and the patches that tell the
  generator what to grow).
- `shared/src/city/meridian/*.ts`: the generator (`generate.ts` is the entry,
  `generatePortMeridian(seed)`); `palettes.ts` sets which buildings each patch uses (and the
  packed versions of the starts); `build.ts` places bridge decks (as wide as their road plus a
  meter each side), landmarks (with the 20 m apron), street fronts and yards, then opens every
  yard that would trap a squad; `lanes.ts` the back lanes of the starts and their garages;
  `specials.ts` the special buildings (in the starts and beyond); `starts.ts` the diner, the
  motel and the firehouse of every start; `lots.ts` the search for a lot on a street front they
  share.
- Tests: `shared/test/meridian.test.ts` (the data, the level, the packed starts, identical on
  every machine), `shared/test/specials.test.ts` (the special buildings' rewards, with every size
  of monster),
  `shared/test/meridianPlay.test.ts` (deployment and bot matches), `shared/test/meridianCold.test.ts`
  (the first build's time).
- `shared/scripts/cityMap.ts`: the pictures. `npm run sim`: the
  balance harness, on this city by default (`--nav` adds the navigation summary, `--bar` tries other bar
  fractions).
- Same on every machine: the generator uses only + - * /, `Math.sqrt`, rounding and the
  project's seeded generator; headings come from a fixed table; every final coordinate
  (structures, props, street junctions, and every point of every water, park, plaza and district
  outline) snaps to 1/8 m. A test scans the generator and the shared files it imports
  (`math/rng`, `city/archetypes`, `city/props`, `city/types`, `defs/stages`, `defs/ids`) for
  forbidden math functions.
- Names: all invented, but a few match real places (Signal Hill, Harrow Road, Kingsway,
  Northgate, Temple Hill), and Bellhaven is close to Belhaven, a Scottish town and beer brand.
  Renaming is the owner's call; if Bellhaven goes, "Bellmere" is a ready replacement (the anchor,
  district, common and high street names are in `layout.ts`; the placeholder city has its own
  Bellhaven anchor in `generateCity.ts`).

---

## 11. The Old Moat (14 November, the swim task)

The owner's note after the second playtest: "Grognar should be able to swim in the river...
We may have to update the map to have water at all stages." The monster can now swim, at
stages 1 and 2 (docs/DESIGN.md section 4, "Swimming"), in water that is deep enough for its body:
0.75 of its body radius from its middle all round at stage 1 (3.6 m of water across), 0.35 at
stage 2 (6.3 m).

**What was missing.** Every starting neighborhood lies 920 m from the center, against the
city's edge, and no stage 1 square held any water at all. Of the stage 2 squares, the six on the
west and north reach the river or the bay; Easter Green and Harrow Lane on the east reach no
water, and Cinder Flats and Gull Point only a 28 m sliver of the bay's quay.

**What changed.** One thing: the Old Moat, three water rectangles in `layout.ts` (`MOATS`), 20 m
wide, between the beltway and the city limit (from 1080 to 1100 m out) along the west edge from
the beach, the whole north edge past the mouth of the River Wend, and the whole east edge. Every
stage 1 and stage 2 square touches the city limit, so every one now holds some of it. That strip
held nothing but the beltway's tree belt, so no street and no building moved: the structures,
their values, the streets and the bar marks are exactly what they were. The moat areas are added
after all the others, so no other area's id (which seeds its furnishing) changed either. Only
the 179 trees of the belt are gone (5541 props became 5362) and the checksums changed (section
7). The juvenile fits in the moat with its flanks against the banks (6.3 m of the 20); the river
(68 to 96 m wide) and the bay are far roomier.

A first try widened the east side into a 36 m canal by pulling the beltway in by 22 m. That
reshuffled the whole city (the street ids seed the buildings, so 1778 of 2695 buildings moved)
and broke the fairness and deployment checks; it was dropped for the moat as it is.

**Checked** (`shared/test/swim.test.ts`, "Port Meridian has water to swim in at every start"):
for every start, at stage 1 and at stage 2, a walk from where the match starts (through nothing
taller than the kaiju tramples, so without breaking anything) reaches deep enough water inside
the bounds. Measured: at stage 1, between 5 700 and 11 100 square meters of swimmable water
inside every square, first reached 148 to 165 m from the start; at stage 2, between 7 200 (Easter
Green) and 138 000 (Juniper Bay) square meters, all of it reachable. The city tests (fairness,
deployment on every perimeter point, no squad landing in water) pass unchanged; only the two
checksum values were updated. `map.png` and `anchors.png` are redrawn with the moat; the other
pictures in `docs/city/` do not show it.

---

## 12. The special buildings and the city weapons (14 November, phase 2, the city's simulation task)

`docs/ROADMAP.md`, phase 2: special buildings in every starting neighborhood, each with a
reward, and the city as a weapon for the hatchling. What they do in play: `docs/DESIGN.md`
sections 4 ("The city as a weapon") and 7 ("Special buildings", "City weapons").

**The special buildings** (appended to `shared/src/city/archetypes.ts`; each has a `special`
kind; the models are the art stream's):

| id | Class | Size | Hp, value | Look (model nodes) |
|---|---|---|---|---|
| `substation_a` | factory | 22 x 16 x 9 | 150, 15 | A fenced power substation of transformers and insulator racks; nodes `spark` at the insulator tops. |
| `gasstation_a` | shop | 26 x 20 x 7 | 160, 15 | A gas station with its canopy over the pumps and a shop behind (a thin pole sign may rise to 10 m); nodes `light` at the pumps. |
| `radiomast_a` | factory | 8 x 8 x 24 | 120, 15 | A red and white lattice radio mast; nodes `lamp` (red lamps) and `top`, the top 8 m section (it lies apart once the mast has fallen: the `mast` prop). |

- **Where** (`shared/src/city/meridian/specials.ts`, run after the landmarks and before the
  street fronts; since phase 3 the lot search is `lots.ts`, lots 6 m apart, and more special
  buildings stand beyond the starts: section 13): for every anchor and each of the three in turn,
  every lot along the streets near the anchor's stage 1 square (a front facing the street, at the street's clearance plus a
  meter, plus the tall setback for the mast) is scored: best in the special's own direction
  from the anchor (three directions a third of a turn apart, turned by the seed), about 75 m
  out, with a jitter from the seed; then the best lots are tried in turn until one is wholly
  inside the square (8 m in from its line), 40 to 120 m from the anchor, at least 45 m from the
  start's other specials, clear of the streets, on dry land off parks and plazas, and 4 m from
  any building. As built they stand 58 to 95 m from their anchors. The yard opener never takes a
  special out (like a landmark), and `validateCity` reports a start without its three.
- **The city weapons** (`shared/src/city/meridian/furnish.ts`, after everything else): 5 propane
  tanks and 4 each of water tanks, antennas, fast-food signs and garage doors beside the houses
  and shops of every start's square (a seeded shuffle of them; the signs by the shops first),
  each at the first legal spot of a short list round its building (a tank by the side wall,
  the water tank in the back garden, the antenna pole beside the house, the sign out front by
  the pavement, the garage door at the side by the drive); and about one house or shop in 45
  elsewhere gets one of the five. 230 in all. The `mast` prop kind is never placed: the top of a
  fallen radio mast lies loose in a match instead (`world.loose`).

| Prop | Radius, height | |
|---|---|---|
| `propane` | 1.3, 1.3 | A propane tank on its cradle, about 2.4 m long. |
| `watertank` | 1.6, 4.5 | A water tank on short legs, 3 m across. |
| `antenna` | 0.5, 7 | A television antenna on its pole. |
| `foodsign` | 1.5, 7.5 | A fast-food pole sign. |
| `garagedoor` | 1.8, 2.8 | A roll-up garage door in its frame, 3.2 m wide. |
| `mast` | 4, 1.5 | The radio mast's 8 m top section, lying on its side. |

(Each model has a node `grip` where the hand holds it.)

**Measured**: checksums in section 7. Building it costs no more than before: built side by side
in one process with the city as it was before phase 2 (taken from git), warm builds took 83 to
109 ms against the old city's 83 to 125 ms on the same busy machine (the 41 to 61 ms of section 7
were measured on a quieter one); a profile puts the specials' placement at about 7 ms a build.
`meridianCold.test.ts` (the first build in a fresh process) passed. Nothing else moved: the
streets, the landmarks and the districts are the same.


---

## 13. Phase 3: the starts packed close, six new kinds of buildings, roofs by district, special buildings beyond the starts (14 November, the city's simulation task)

`docs/ROADMAP.md`, phase 3: "more kinds of buildings, packed closer together where the match
starts; roofs colored by district". The owner's reason: the army is 10 to 20% faster than the
monster at every stage, and tighter streets and shorter sight lines keep that fair (a squad can
get out of sight; the monster can still corner one). And `docs/BALANCE.md` section 10: after
stage 1 something new happened to the monster only about every 30 s and to a squad every 33 to
58 s, so more special buildings stand beyond the starts.

![Juniper Bay, packed close](city/anchor_juniper_bay.png)

**The starting neighborhoods, packed close.** Inside every stage 1 square:

- **Narrow streets.** The local streets are 9 m wide (the short closes 8 m; they were 11, at Gull
  Point 10) and the houses stand 10 m from their middle line instead of 12. The street network
  is the one it was (the same junctions and pieces), only narrower. Still wide enough for every
  squad: a tank troop, the last stage's squad, is 18 m wide and has a meter to spare each side;
  a tank or a section of infantry has room to pass. The avenues through and along the squares
  keep their width and their 12 m: they are the army's routes in and out.
- **Houses close to the street and to each other.** Front gardens of half a meter (3 m along the
  avenues), a meter or three between neighbors, and every four or five houses a passage 12 m
  wide through to the gardens behind, so no garden is walled in.
- **Back lanes with garages.** Every block 56 to 130 m deep gets a lane through its middle,
  along its long sides, open to the cross street at both ends, and garages along it with their
  doors to the lane (a 12 m passage every four garages). 82 pieces, 6.5 km in all. A lane is
  open ground, not a street: no route is planned along it, nothing is parked on it, and the
  client draws it as a gravel track (`CityData.lanes`, since phase 3).
- **No more cottages scattered in the gardens**: the blocks hold their rows and their lanes.
- **The new kinds.** The bungalow and the duplex join each start's houses (each start keeps its
  own flavor: suburb, garden suburb, old suburb, terraces, worker rows, harbor village, beach
  village, the temple slope); the garages line the lanes; and every start has a firehouse, a
  roadside motel and a diner, each on an avenue (the beltway or a frame avenue) wholly inside
  its square, 40 m from each other and from the special buildings, about 100 m from the anchor
  (`shared/src/city/meridian/starts.ts`). Every start has at least five of the six kinds
  (Juniper Bay's beach village builds no duplexes); a test asks for four.
- **What a start keeps**: its green or plaza; its three special buildings (now 60 to 88 m from
  the anchor); its 21 city weapons; the streets in one piece; and fairness (section 6: stage 1
  within 1.2%).

| Start | Buildings in the square (phase 2 → now) | Bungalows / duplexes / garages | Back lanes | Median sight line (phase 2 → now) |
|---|---|---|---|---|
| Alder Row | 95 → 149 | 27 / 19 / 22 | 725 m | 88 → 62 m |
| Bellhaven | 116 → 179 | 16 / 14 / 38 | 903 m | 74 → 44 m |
| Cinder Flats | 120 → 176 | 26 / 14 / 25 | 592 m | 78 → 46 m |
| Dovecote | 127 → 176 | 32 / 20 / 29 | 817 m | 60 → 38 m |
| Easter Green | 114 → 162 | 33 / 25 / 13 | 227 m | 74 → 50 m |
| Fennel Hill | 119 → 160 | 23 / 20 / 5 | 285 m | 64 → 48 m |
| Gull Point | 126 → 175 | 39 / 7 / 8 | 507 m | 66 → 48 m |
| Harrow Lane | 116 → 163 | 40 / 13 / 18 | 629 m | 70 → 52 m |
| Ivy Court | 110 → 176 | 14 / 21 / 36 | 772 m | 80 → 52 m |
| Juniper Bay | 123 → 190 | 50 / 0 / 33 | 1068 m | 70 → 46 m |

(Sight lines: from points every 12 m along the streets inside each square, in 16 directions at
3 m above the ground, how far until a building. Over all ten starts the median went from 72 m to
48 m, the mean from 97 m to 79 m, and the share of lines of 100 m or more from 40% to 31%.
Buildings cover about 12% of each square, against 8% before. The ring-and-spoke starts, Easter
Green and Fennel Hill, have few blocks a straight lane fits, so few lanes.)

**Balancing the starts.** Each start's packed version is data (`layout.ts`, the patch's
`tight`): its palette (`palettes.ts`, the `...Tight` ones), how many of its lots are built
(`keep`, 0.735 to 1.11), how many lane lots get a garage (`garages`), and regular passages for
the denser terraces (`rowEvery`, `rowGap`). Their street patterns give some starts much more
street front than others, so the terraces of Ivy Court and Cinder Flats leave more lots empty,
and Alder Row, Dovecote, Easter Green and Harrow Lane keep more parked cars (`cars`), as in
phase 2. Value in the stage 1 squares: 1721 to 1742 (phase 2: 1326 to 1415). The bar's first
mark is a fraction of it, so stage 1 asks for about a quarter more wrecking than in phase 2.

**The rest of the city.** Every street with an end outside the squares is as it was (507 of
507), and 86% of the buildings outside the squares stand exactly where they stood (91% of those
more than 40 m outside one). The others changed where a start's edge meets them (a row along a
street that begins inside a square), round the special buildings beyond the starts, and where
the bungalow, the duplex and the garage joined the suburbs outside the starts (the suburb,
garden suburb, old suburb, harbor and beach village palettes, and the back gardens' cottages).
The gardens' trees and drives and the
scattered city weapons now take their random draws from where their building stands, not from
its place in the list, so a change in one neighborhood no longer reshuffles them elsewhere.

**Roofs by district**: section 2 (the colors, and how the client uses them).

**Special buildings beyond the starts** (`specials.ts`; the numbers are `SPECIAL_SITES` in
`layout.ts`, for a pacing pass to tune):

- For every start, four more along the straight way from its anchor to downtown, at 20, 85, 150
  and 215 m beyond the edge of its stage 1 square, the kinds in turn (each start beginning one
  further on). Each stands on a street front within 75 m of its point, outside every stage 1
  square, wholly inside that start's stage 2 square, 60 m from every landmark and 50 m from any
  other special building. A site is left out where a special building of its kind already
  stands within 90 m of its point (a neighbor's: the stage 2 squares overlap).
- Six more for the titan at stage 3, in the districts round downtown it crosses on its way to
  the towers: the Old Town, Wendside, Halcyon Gate, the Cinder Works, the Customs Quarter and the
  shore hotels.
- 44 in all (74 with the starts' 30). Every stage 2 square holds 10 to 17 outside its stage 1
  square, at least one of each kind (`validateCity` checks this too).
- The rewards are unchanged, and a bigger monster sets them off as it should (tests in
  `shared/test/specials.test.ts`): a juvenile that walks through a substation tramples it and
  gets the surge; a titan whose body reaches over a gas station takes nothing from its fireball
  (it never hurts a monster), while a troop beside it does; a radio mast falls away from a titan
  standing right beside it, its top lands clear of the titan's body, and the static comes.
- **The fallen mast's top** was decided here to stay the hatchling's weapon only. Round 4
  changed that: the owner tried to throw one at stage 2, so every size of monster can now pick it
  up, and its feet spare it (`docs/DESIGN.md` section 4, "Mast"). The five street weapons stay
  "small monster first".
- **Measured** (20 bot matches, seeds 1 to 20, every start twice, the same matches on phase 2's
  city alongside): the monster got a special building's reward 43 / 41 / 32 times at stages 1 /
  2 / 3, at stage 2 one every 60 s of play and at stage 3 one every 119 s (phase 2's city: 41 /
  14 / 8, one every 205 s and 435 s). It came within 60 m of a standing one every 67 s at stage
  2. The goal was one every 30 to 45 s; the placement is not what holds it back. The monster bot
  goes for a special building only while no squad is close (`BOT_RULES.kaiju`: `specialReach`
  220 m and `specialCalm` 110 m at stage 2, not at all at stage 3), and the juvenile spends most
  of stage 2 near the squads. A trial with the sites in a zigzag either side of the way made no
  difference. The levers: `SPECIAL_SITES` and those bot numbers.

**Checked.** `validateCity` (no problems); the city and Port Meridian tests, with the checksums of
section 7; the deployment tests (every perimeter point of every stage of every start, and no
spot along the city edge where a troop could be put and not drive out); and
`npm run sim -- --seeds 10 --every-anchor` twice (seeds 1 to 10 and 11 to 20):

| | Stage 1 | Stage 2 | Stage 3 (completed) | Match | Monster wins | Units stuck | Monster stuck |
|---|---|---|---|---|---|---|---|
| Phase 2's city, seeds 1 to 10 | 2:00 | 2:23 | 2:28 (4) | 7:34 | 4 of 10 | 0.01% (longest 3.0 s), 1 give-up | 0 s |
| Phase 3, seeds 1 to 10 | 2:16 | 1:59 | 2:42 (4) | 7:39 | 4 of 10 | 0.01% (longest 2.0 s), 1 give-up | 0 s |
| Phase 3, seeds 11 to 20 | 2:26 | 2:06 | 3:06 (5) | 7:31 | 5 of 10 | 0.01% (longest 4.2 s), no give-ups | 0.1 s |

No match errored and the monster never stuck. Stage 1 is longer (its square is worth more), and
the squads lose more units there (7.1 and 4.1 a match against 3.8) and break the hatchling's
nerve less often (0.6 and 0.7 against 1.0): the packed streets hide it well. The pace is the
pacing pass's to set (the bar fractions in `shared/src/defs/rules.ts`). (It did: the first
fraction went from 0.18 to 0.145, the special buildings stayed as they are, and the squad bot
learned the packed streets; `docs/BALANCE.md` section 11.)

**What else changed in the generator** (for engineers):

- `tightenStartStreets` (`build.ts`) narrows the local streets of the squares after the street
  plan (`RoadSpec.tight`); `planLanes` and `buildLaneRows` (`lanes.ts`) make the lanes (builder
  streets with `RoadSpec.lane`, left out of the road graph) and their garages; `lots.ts` is the
  lot search the special buildings and the starts' shops share.
- The yard opener: in a start's square even the smallest enclosed speck of ground is opened (the
  packed blocks leave small courtyards a squad could be put down in); the tight streets and,
  except for the troop, the lanes count as open roadway; and the troop's round now asks for the
  9.75 m a troop is deployed with, not 9.25 m (a corridor 19 m wide behind a row of houses had
  read as a way out). It is faster too: each wall is weighed once per try and only near the
  pocket, which builds exactly the same city.
- Build time: the generator reads the functions its hot loops import once per module (under
  the module loaders the game and its tests use, every read of an imported binding goes through
  a getter), the start squares once, and takes the best lots off a heap; all this builds exactly
  the same city. Section 7 has the times.
