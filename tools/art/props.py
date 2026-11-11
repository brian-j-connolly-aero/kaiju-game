#!/opt/mbtools/venv/bin/python
# mb-family: props
"""Street props: the model-city clutter that sells the hatchling's scale.

    /opt/mbtools/venv/bin/python tools/art/props.py                  build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/props.py --no-previews    geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/props.py --only prop_bus,prop_truck
    /opt/mbtools/venv/bin/python tools/art/props.py --scenes-only    just the street scene and the tint sheet

Writes, per docs/ASSETS.md section 3 "City" (props only), one mesh each:
    prop_car_sedan, prop_car_taxi, prop_car_van, prop_bus, prop_truck, prop_car_wreck,
    prop_kiosk, prop_tree_a, prop_tree_b, prop_lamp, prop_trafficlight, prop_bench,
    prop_billboard, prop_busstop                       (prop_hydrant belongs to example.py)
    client/public/assets/manifest.props.json
    docs/art/previews/<id>.png, docs/art/concept/<id>.png,
    docs/art/concept/props_street.png, docs/art/concept/props_car_tints.png

Sizes are real-world meters and match the height and crush radius the game uses for each
prop (tools/art/data/archetypes.json): a sedan is 4.4 m long, the bus 12 m.

COLOR VARIANTS ("tint"). Sedan, van, bus and truck are authored with near-white body paint so
the game can multiply a paint color into it. Which faces are paint is stored in the file as
the alpha of the vertex color (COLOR_0): alpha 1 = body paint (tint it), alpha 0 = glass,
tires, lights, trim (never tint). Their manifest entries carry a "tint" object naming the
part, the mask and the suggested colors. Every other model has alpha 1 everywhere and no
"tint" entry. tinted() below is the reference implementation (it is what the scene shots use).
"""
import hashlib
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import mb  # noqa: E402
import mb_preview  # noqa: E402
import glb as glbfile  # noqa: E402

# ---- shared colors ------------------------------------------------------------------------
PAINT = (0.90, 0.90, 0.90)      # tintable body paint: neutral, so a tint multiplies in cleanly
GLASS = "#26374a"               # vehicle glass: dark slate, so windows read on any paint color
GLASS_LT = "#3f5c78"            # windshields catch more sky
TRIM = "#353842"                # bumpers, grilles, skirts
TIRE = "tire"
HUB = "grey_light"
HEADLIGHT = "#fff2c4"
TAILLIGHT = "#d92b2b"
DECAL = 0.03                    # flat details sit this far proud of the surface behind them

# Paint colors the game may tint each vehicle with (sRGB hex). No kaiju orange, human cyan or
# volley yellow: those belong to the color language.
WRECK_NOTE = "use the paint color of the vehicle that was crushed"
TINTS = {
    "prop_car_sedan": ["#e0372f", "#2f62c9", "#f5f5f0", "#3fa652", "#8f6fd0", "#f29b85", "#2a9d8f", "#aab2bc"],
    "prop_car_van": ["#f5f5f0", "#2f62c9", "#e0372f", "#9fe0c0", "#b9a6e0"],
    "prop_bus": ["#d7263d", "#2f62c9", "#3fa652", "#f3e3b3"],
    "prop_truck": ["#2f62c9", "#e0372f", "#3fa652", "#f5f5f0", "#aab2bc"],
}
TAXI_YELLOW = mb.palette.PALETTE["taxi_yellow"]
TINT_NOTE = {
    "part": "body paint",
    "mask": "COLOR_0 alpha: 1 = paint (multiply the tint color in), 0 = never tint",
    "blend": "multiply",
}


# ---- small helpers ------------------------------------------------------------------------
def split(g: mb.Geo, where):
    """(selected faces, the rest) as two new Geos."""
    chosen = set(g.select(where))
    a, b = mb.Geo(), mb.Geo()
    for i, f in enumerate(g.f):
        (a if i in chosen else b).face([g.v[k] for k in f], g.col[i], g.mat[i], g.uv[i])
    return a, b


def drop(g: mb.Geo, where) -> mb.Geo:
    """A copy of `g` without the selected faces (faces nobody can see cost triangles)."""
    return split(g, where)[1]


def slab(outline, x0: float, x1: float, color, cap0: bool = True, cap1: bool = True) -> mb.Geo:
    """A side-view outline [(y, z), ...] extruded from x0 to x1 (x1 > x0)."""
    return mb.loft([[(x0, y, z) for y, z in outline], [(x1, y, z) for y, z in outline]], color=color,
                   cap_start=cap0, cap_end=cap1)


def plate(w: float, h: float, at, facing: str, color, mat: str = "vcol") -> mb.Geo:
    """One flat rectangle centered on `at`, looking "front", "back", "left", "right" or "top".
    w is its width (left-right as you look at it), h its height (depth for "top")."""
    x, y, z = at
    if facing in ("front", "back"):
        pts = [(x - w / 2, y, z - h / 2), (x + w / 2, y, z - h / 2), (x + w / 2, y, z + h / 2), (x - w / 2, y, z + h / 2)]
    elif facing in ("left", "right"):
        pts = [(x, y - w / 2, z - h / 2), (x, y + w / 2, z - h / 2), (x, y + w / 2, z + h / 2), (x, y - w / 2, z + h / 2)]
    elif facing == "top":
        pts = [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)]
    else:
        raise ValueError(facing)
    if facing in ("back", "right"):
        pts.reverse()
    return mb.polygon(pts, color=color, mat=mat)


def flat_top(center, normal) -> bool:
    """Face selector: level faces looking straight up (roofs, not windshields)."""
    return normal.z > 0.95


def lit(g: mb.Geo, seed: int = 1, amount: float = 0.03) -> mb.Geo:
    """A little painted-in sky light and facet variation."""
    return g.bake_light(top=1.06, bottom=0.78).jitter(amount, seed=seed)


# ---- tint: mask in the file, reference implementation for the pictures ------------------------
def tint_node(name: str, paint: mb.Geo, fixed: mb.Geo):
    """Create the prop's single mesh node and write the tint mask into the vertex color alpha:
    1 on the faces of `paint`, 0 on the faces of `fixed`."""
    ob = mb.node(name, paint + fixed)
    n_paint = len(paint.f)
    colors = ob.data.color_attributes[mb.COLOR_ATTR]
    for poly in ob.data.polygons:
        alpha = 1.0 if poly.index < n_paint else 0.0
        for li in poly.loop_indices:
            c = colors.data[li].color
            colors.data[li].color = (c[0], c[1], c[2], alpha)
    return ob


def tinted(paint: mb.Geo, fixed: mb.Geo, color) -> mb.Geo:
    """What the game does with a tint: multiply the paint faces by the color, in linear light."""
    t = mb.palette.linear(color)

    def mul(col, center, normal):
        return tuple(mb.palette.linear_to_srgb(mb.palette.srgb_to_linear(c) * k) for c, k in zip(col, t))

    return paint.copy().recolor(mul) + fixed


# ---- vehicles -------------------------------------------------------------------------------
def axles(positions, radius: float, half_width: float, n: int = 8, hub: float = 0.46) -> mb.Geo:
    """Wheels, a pair per axle position: one tire-colored roller right across the vehicle (its
    middle is hidden by the body) with a small hub on each end."""
    g = mb.Geo()
    z = radius * math.cos(math.pi / n)          # a flat of the tire rests on the ground
    for y in positions:
        g += mb.rod((-half_width, y, z), (half_width, y, z), radius, n=n, color=TIRE).jitter(0.12, seed=2)
        r = radius * hub
        for s in (1, -1):
            x = s * (half_width + 0.015)
            pts = [(x, y, z - r), (x, y + r, z), (x, y, z + r), (x, y - r, z)]
            g += mb.polygon(pts if s > 0 else pts[::-1], color=HUB)
    return g


def sedan_parts(paint=PAINT, taxi: bool = False):
    """(paint, fixed) geometry of the sedan: 4.5 m long, 1.9 m wide, 1.5 m tall."""
    w = 1.78
    body = drop(slab([(-2.1, 0.32), (-2.1, 0.70), (-1.95, 0.88), (-0.95, 0.98), (1.30, 1.00), (2.05, 0.92),
                      (2.1, 0.70), (2.1, 0.32)], -w / 2, w / 2, paint),
                lambda c, n: n.z < -0.5 or (n.z > 0.95 and abs(c.y - 0.175) < 0.2))   # belly, and the deck under the cabin
    cab = mb.tapered_box((w, 2.25), (1.42, 1.50), 0.52, at=(0, 0.175, 0.98), offset=(0, 0.07), color=GLASS,
                         cap_bottom=False)
    cab.paint(GLASS_LT, where=lambda c, n: n.y < -0.5)
    roof, glass = split(cab, flat_top)
    roof.paint(paint)
    for s in (1, -1):                                                         # door pillars across the side glass
        lo, hi = s * (w / 2 + DECAL), s * (0.72 + DECAL)                       # stops just short of the roof
        pts = [(lo, 0.10, 0.98), (lo, 0.30, 0.98), (hi, 0.34, 1.47), (hi, 0.16, 1.47)]
        roof += mb.polygon(pts if s > 0 else pts[::-1], color=paint)
    fixed = lit(glass, seed=3)
    for y in (-2.15, 2.15):                                                   # chunky bumpers
        fixed += drop(mb.box((w, 0.16, 0.22), at=(0, y, 0.41), color=TRIM),
                      lambda c, n, y=y: n.z < -0.5 or n.y * y < -0.5)
    for x in (-0.6, 0.6):
        fixed += plate(0.40, 0.18, (x, -2.1 - DECAL, 0.62), "front", HEADLIGHT)
        fixed += plate(0.38, 0.16, (x, 2.1 + DECAL, 0.70), "back", TAILLIGHT)
    fixed += plate(0.64, 0.14, (0, -2.1 - DECAL, 0.62), "front", TRIM)          # grille
    fixed += axles((-1.32, 1.30), 0.39, 0.94)
    if taxi:
        fixed += drop(mb.box((0.52, 0.20, 0.17), at=(0, 0.25, 1.50), color="white", anchor="bottom"), "bottom")
        for s in (1, -1):                                                     # checker band on the doors
            for y in (-0.52, 0.10, 0.72):
                fixed += plate(0.31, 0.15, (s * (w / 2 + DECAL), y, 0.80), "left" if s > 0 else "right", "black")
    return lit(body + roof, seed=1), fixed


def van_parts(paint=PAINT):
    """(paint, fixed) geometry of the delivery van: 5.0 m long, 2.0 m wide, 2.12 m tall."""
    w = 1.96
    body = drop(slab([(-2.45, 0.32), (-2.45, 0.82), (-2.22, 1.08), (-1.72, 1.14), (2.45, 1.14), (2.45, 0.32)],
                     -w / 2, w / 2, paint), lambda c, n: n.z < -0.5 or (n.z > 0.95 and c.y > -1.0))
    cab = drop(mb.tapered_box((w, 1.30), (1.76, 0.85), 0.98, at=(0, -1.07, 1.14), offset=(0, 0.225), color=GLASS,
                              cap_bottom=False), "back")
    cab.paint(GLASS_LT, where=lambda c, n: n.y < -0.5)
    roof, glass = split(cab, flat_top)
    roof.paint(paint)
    cargo = drop(mb.box((w, 2.87, 0.98), at=(0, 1.015, 1.63), color=paint), "bottom")
    fixed = lit(glass, seed=3)
    for y in (-2.49, 2.49):
        fixed += drop(mb.box((w, 0.16, 0.22), at=(0, y, 0.43), color=TRIM),
                      lambda c, n, y=y: n.z < -0.5 or n.y * y < -0.5)
    for x in (-0.68, 0.68):
        fixed += plate(0.36, 0.18, (x, -2.45 - DECAL, 0.68), "front", HEADLIGHT)
        fixed += plate(0.14, 0.46, (x * 1.26, 2.45 + DECAL, 0.92), "back", TAILLIGHT)
    fixed += plate(0.78, 0.15, (0, -2.45 - DECAL, 0.68), "front", TRIM)
    fixed += plate(1.20, 0.42, (0, 2.45 + DECAL, 1.72), "back", GLASS)          # rear door windows
    for s in (1, -1):                                                         # door mirrors
        fixed += mb.box((0.17, 0.10, 0.25), at=(s * 1.04, -1.58, 1.38), color=TRIM)
    fixed += axles((-1.55, 1.50), 0.40, 1.03)
    return lit(body + roof + cargo, seed=1), fixed


def bus_parts(paint=PAINT):
    """(paint, fixed) geometry of the city bus: 12 m long, 2.55 m wide, 3.2 m tall. Doors are
    on its right side (it drives on the right)."""
    w, length = 2.50, 11.9
    hidden = lambda c, n: abs(n.z) > 0.5                                       # noqa: E731
    body = drop(mb.box((w, length, 0.75), at=(0, 0, 1.075), color=paint), hidden)
    roof = mb.tapered_box((w, length), (w - 0.34, length), 0.45, at=(0, 0, 2.55), color=paint, cap_bottom=False)
    pillars = mb.Geo()
    for y in (-4.25, -2.70, -1.20, 0.30, 1.85, 3.40):
        for s in (1, -1):
            pillars += plate(0.16, 1.10, (s * (w / 2 + DECAL), y, 2.0), "left" if s > 0 else "right", paint)
    skirt = drop(mb.box((w, length, 0.38), at=(0, 0, 0.51), color=TRIM), hidden)
    glass = drop(mb.box((w, length, 1.10), at=(0, 0, 2.0), color=GLASS), hidden)
    glass.paint(GLASS_LT, where="front")
    fixed = lit(skirt + glass, seed=3)
    fixed += drop(mb.box((1.5, 2.6, 0.20), at=(0, 1.2, 3.0), color="grey_light", anchor="bottom"), "bottom")   # roof unit
    for y in (-4.92, -0.45):                                                   # doors, right side
        fixed += plate(1.18, 2.02, (-(w / 2 + 2 * DECAL), y, 1.46), "right", mb.shade(GLASS, 0.75))
    fixed += plate(1.70, 0.26, (0, -length / 2 - DECAL, 2.76), "front", "#ffe9a6")        # destination sign
    for x in (-0.86, 0.86):
        fixed += plate(0.40, 0.20, (x, -length / 2 - DECAL, 0.92), "front", HEADLIGHT)
        fixed += plate(0.30, 0.30, (x * 1.1, length / 2 + DECAL, 1.05), "back", TAILLIGHT)
    fixed += axles((-3.70, 3.30), 0.50, 1.28)
    return lit(body + roof, seed=1) + pillars, fixed


def truck_parts(paint=PAINT):
    """(paint, fixed) geometry of the box truck: 8.5 m long, 2.5 m wide, 3.3 m tall. The cab
    and the stripe round the cargo box take the tint; the box itself stays white."""
    cab = drop(slab([(-4.2, 0.45), (-4.2, 1.40), (-4.02, 2.60), (-2.55, 2.60), (-2.55, 0.45)], -1.2, 1.2, paint),
               "bottom")
    windshield, cab = split(cab, lambda c, n: n.y < -0.5 and c.z > 1.4)
    windshield.paint(GLASS_LT)
    deflector = mb.wedge((2.2, 1.25, 0.62), at=(0, -3.2, 2.60), high="back", color=paint)
    w, y0, y1 = 2.5, -2.55, 4.2
    mid = (y0 + y1) / 2
    sides = lambda c, n: abs(n.z) > 0.5                                        # noqa: E731
    stripe = drop(mb.box((w, y1 - y0, 0.50), at=(0, mid, 2.0), color=paint), sides)
    box = drop(mb.box((w, y1 - y0, 0.70), at=(0, mid, 1.40), color="white"), sides)
    box += drop(mb.box((w, y1 - y0, 1.05), at=(0, mid, 2.775), color="white"), "bottom")
    fixed = lit(box + windshield, seed=3)
    fixed += drop(mb.box((1.1, 6.9, 0.50), at=(0, 0.72, 0.80), color=TRIM), "top")           # chassis
    fixed += drop(mb.box((2.5, 0.18, 0.30), at=(0, -4.27, 0.62), color=TRIM), "back")        # bumper
    for s in (1, -1):
        fixed += plate(0.95, 0.72, (s * (1.2 + DECAL), -3.28, 1.98), "left" if s > 0 else "right", GLASS)
        fixed += plate(0.42, 0.20, (s * 0.86, -4.2 - DECAL, 0.98), "front", HEADLIGHT)
        fixed += plate(0.30, 0.20, (s * 1.0, y1 + DECAL, 1.25), "back", TAILLIGHT)
    fixed += plate(1.0, 0.24, (0, -4.2 - DECAL, 1.0), "front", TRIM)
    fixed += axles((-3.25,), 0.50, 1.25) + axles((2.60,), 0.50, 1.28)
    return lit(cab + deflector + stripe, seed=1), fixed


@mb.asset("prop_car_sedan", sheet=dict(extra=["top"]), concept=dict(azimuth=35, elevation=14))
def prop_car_sedan():
    tint_node("prop_car_sedan", *sedan_parts())


@mb.asset("prop_car_taxi", sheet=dict(extra=["top"]), concept=dict(azimuth=35, elevation=14))
def prop_car_taxi():
    paint, fixed = sedan_parts(paint="taxi_yellow", taxi=True)
    mb.node("prop_car_taxi", paint + fixed)                    # a taxi is always yellow: no tint mask


@mb.asset("prop_car_van", sheet=dict(extra=["top"]), concept=dict(azimuth=35, elevation=14))
def prop_car_van():
    tint_node("prop_car_van", *van_parts())


@mb.asset("prop_bus", sheet=dict(extra=["right", "top"]), concept=dict(azimuth=-40, elevation=14))
def prop_bus():
    tint_node("prop_bus", *bus_parts())


@mb.asset("prop_truck", sheet=dict(extra=["top"]), concept=dict(azimuth=38, elevation=14))
def prop_truck():
    tint_node("prop_truck", *truck_parts())


# ---- the crushed car ----------------------------------------------------------------------------
def crumple(g: mb.Geo, amount: float, seed: int = 1, rough: float = 0.015) -> mb.Geo:
    """Buckle the geometry: a slow warp (waves a couple of meters long, so thin parts bend
    rather than turn inside out) plus a little denting per corner. Points that coincide move
    together, so faces still meet. Bent quads are split into facets."""
    rng = random.Random(seed)

    def unit():
        return mb.Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()

    waves = [(unit() * rng.uniform(2.0, 4.0), rng.uniform(0.0, math.tau), unit()) for _ in range(5)]
    for p in g.v:
        d = mb.Vector((0.0, 0.0, 0.0))
        for k, phase, direction in waves:
            d += direction * math.sin(k.dot(p) + phase)
        local = random.Random(f"{seed}:{round(p.x, 3)}:{round(p.y, 3)}:{round(p.z, 3)}")
        p += d * (amount / 2.0) + mb.Vector((local.uniform(-1, 1), local.uniform(-1, 1), local.uniform(-1, 1))) * rough
    return g.triangulate()


def scorch(g: mb.Geo, seed: int, soot: float = 0.55) -> mb.Geo:
    """Blotchy soot and rust over whatever color is there: some faces nearly clean, some black."""
    rng = random.Random(seed)
    black, rust = mb.palette.rgb("#1d1a18"), mb.palette.rgb("#6a3d24")

    def repaint(col, center, normal):
        t = min(1.0, soot * rng.uniform(0.0, 1.9) ** 1.5)
        dirt = tuple(b + (r - b) * rng.random() ** 2 * 0.7 for b, r in zip(black, rust))
        return tuple(c + (d - c) * t for c, d in zip(col, dirt))

    return g.recolor(repaint)


def wreck_parts():
    """(paint, fixed) geometry of a car that has been stepped on: flat on the road, creased
    across the middle, wheels splayed out, a bumper lying loose. 5 m long, 0.8 m tall. The
    scorched body panels are still paint: tint them with the color of the car that was crushed."""
    w = 1.86
    paint_color = (0.66, 0.66, 0.66)
    seam = lambda c, n: abs(n.y) > 0.9 and abs(c.y + 0.2) < 0.02                      # noqa: E731
    front = drop(slab([(-2.1, 0.05), (-2.1, 0.50), (-1.95, 0.66), (-0.2, 0.36), (-0.2, 0.05)], -w / 2, w / 2,
                      paint_color), seam)
    rear = drop(slab([(-0.2, 0.05), (-0.2, 0.36), (1.4, 0.70), (2.05, 0.64), (2.1, 0.42), (2.1, 0.05)], -w / 2, w / 2,
                     paint_color), seam)
    cab = mb.tapered_box((1.74, 2.2), (1.56, 1.7), 0.17, at=(0, 0.2, 0.0), color="#15181c", cap_bottom=False)
    roof, glass = split(cab, flat_top)
    roof.paint(paint_color)
    for part in (roof, glass):                               # the roof lies caved in on the rear half
        part.rx(-9, about=(0, 0.2, 0)).move(0, 0.1, 0.38)
    paint = scorch(lit(front + rear + roof, seed=1), seed=3, soot=0.5)
    fixed = mb.Geo()
    z = 0.32 * math.cos(math.pi / 6)
    for y, turn, lean in ((-1.34, 12, 6), (1.30, -9, -5)):   # flat tires on axles knocked askew
        fixed += mb.rod((-1.14, y, z), (1.14, y, z), 0.32, n=6, color=TIRE).rz(turn, about=(0, y, z)) \
            .ry(lean, about=(0, y, z))
    fixed += mb.box((1.7, 0.16, 0.20), at=(0.25, -2.55, 0.12), color=TRIM).rz(14, about=(0.25, -2.55, 0.12))
    fixed = scorch(fixed, seed=5, soot=0.3) + glass
    both = paint + fixed                                     # crumple them as one so the pieces still meet
    crumple(both, 0.09, seed=9)
    low = both.bounds()[0].z
    n = paint.tris
    paint, fixed = mb.Geo(), mb.Geo()
    for i, f in enumerate(both.f):
        (paint if i < n else fixed).face([both.v[k] for k in f], both.col[i], both.mat[i])
    return paint.move(0, 0, -low), fixed.move(0, 0, -low)


@mb.asset("prop_car_wreck", sheet=dict(extra=["top"]), concept=dict(azimuth=35, elevation=16))
def prop_car_wreck():
    tint_node("prop_car_wreck", *wreck_parts())


# ---- street furniture -------------------------------------------------------------------------
def kiosk_geo() -> mb.Geo:
    """Newsstand, 2.6 x 2.4 m, 3.1 m to the top of its ball: striped awning over the counter."""
    g = drop(mb.box((2.4, 2.0, 2.2), at=(0, 0.1, 0), color="bld_cream", anchor="bottom"), "bottom")
    g += drop(mb.box((1.9, 0.06, 0.95), at=(0, -0.93, 1.55), color=mb.shade(GLASS, 0.7)), "back")       # serving window
    g += drop(mb.box((2.1, 0.34, 0.10), at=(0, -1.05, 1.02), color="wood"), "back")                     # counter
    g += mb.tapered_box((2.8, 2.4), (1.5, 1.1), 0.52, at=(0, 0.1, 2.2), color="bld_teal_glass", cap_bottom=False)
    lit(g, seed=4)
    # awning: a wedge under the eaves, its sloping top in five red and white stripes
    top, lip, wall = 2.22, 1.92, 1.98
    for i in range(5):
        x0, x1 = -1.2 + 0.48 * i, -0.72 + 0.48 * i
        g += mb.quad((x0, -1.72, lip), (x1, -1.72, lip), (x1, -0.9, top), (x0, -0.9, top),
                     color="red" if i % 2 == 0 else "white")
    g += mb.quad((-1.2, -0.9, wall), (1.2, -0.9, wall), (1.2, -1.72, lip), (-1.2, -1.72, lip), color="red_dk")
    g += mb.tri((1.2, -0.9, wall), (1.2, -0.9, top), (1.2, -1.72, lip), color="red_dk")
    g += mb.tri((-1.2, -0.9, top), (-1.2, -0.9, wall), (-1.2, -1.72, lip), color="red_dk")
    g += plate(0.8, 1.8, (0.45, 1.1 + DECAL, 0.9), "back", "bld_teal_glass_dk")                        # door
    # posters on the side walls, a ball on the roof
    g += plate(0.9, 1.1, (1.2 + DECAL, 0.15, 1.35), "left", "bld_salmon")
    g += plate(0.9, 1.1, (-1.2 - DECAL, 0.15, 1.35), "right", "bld_sky")
    g += mb.icosphere(0.27, at=(0, 0.1, 2.86), color="red").jitter(0.08, seed=5)
    return g


def tree_a_geo() -> mb.Geo:
    """Street tree, 7 m: a round crown of three faceted lumps on a short trunk."""
    g = mb.prism(5, 0.30, 3.0, radius_top=0.18, color="trunk", cap_bottom=False, cap_top=False).jitter(0.08, seed=1)
    crown = mb.icosphere(2.0, at=(0, 0, 4.6), color="leaf").scale(1.0, 1.0, 0.9, about=(0, 0, 4.6))
    crown += mb.icosphere(1.4, at=(0.3, 0.15, 5.75), color="leaf").rz(40, about=(0.3, 0.15, 5.75))
    crown += mb.icosphere(1.3, at=(-0.95, -0.4, 4.25), color="leaf").rz(15, about=(-0.95, -0.4, 4.25))
    crown.gradient("leaf_dk", mb.shade("leaf", 1.18), axis="z").jitter(0.07, seed=6)
    return g + crown


def tree_b_geo() -> mb.Geo:
    """Conifer, 9 m: four tiers of skirts, each turned a little against the one below."""
    g = mb.prism(5, 0.26, 2.4, radius_top=0.18, color="trunk_dk", cap_bottom=False, cap_top=False).jitter(0.08, seed=1)
    dark, light = mb.shade("#2f8f5b", 0.8), "#3fae6c"
    tiers = [(2.25, 1.7, 4.4), (1.85, 3.5, 6.0), (1.40, 5.2, 7.6), (0.95, 6.8, 9.0)]
    for i, (r, z0, z1) in enumerate(tiers):
        cone = mb.cone(6, r, z1 - z0, at=(0, 0, z0), phase=30 * i, color=mb.mix(dark, light, i / 3))
        cone.paint(mb.shade(dark, 0.7), where="bottom")
        g += cone.jitter(0.07, seed=7 + i)
    return g


def lamp_geo() -> mb.Geo:
    """Street lamp, 6 m: two lanterns on a short crossbar. Symmetric, so its heading does not matter."""
    post = "#2f4f4a"
    g = mb.prism(6, 0.22, 0.60, radius_top=0.13, color=post, cap_bottom=False)
    g += mb.prism(5, 0.10, 5.15, radius_top=0.065, at=(0, 0, 0.60), color=post, cap_bottom=False, cap_top=False)
    g += mb.box((0.96, 0.09, 0.09), at=(0, 0, 5.50), color=post)
    g += mb.cone(4, 0.12, 0.32, at=(0, 0, 5.68), color=post, cap_bottom=False)
    lit(g, seed=8, amount=0.05)
    for x in (-0.40, 0.40):
        lantern = mb.tapered_box((0.22, 0.22), (0.36, 0.36), 0.36, at=(x, 0, 5.08), color="glow_lamp", mat="glow")
        lantern.paint(post, where="top").material("vcol", where="top")
        g += lantern
    return g


def trafficlight_geo() -> mb.Geo:
    """Traffic light, 5 m: one four-sided head on a post, so it works at any heading."""
    post, housing = "#3d4350", "#22252d"
    g = mb.prism(6, 0.21, 0.5, radius_top=0.13, color=post, cap_bottom=False)
    g += mb.prism(5, 0.095, 2.95, at=(0, 0, 0.5), color=post, cap_bottom=False, cap_top=False)
    g += mb.box((0.44, 0.44, 1.25), at=(0, 0, 3.45), color=housing, anchor="bottom")
    g += mb.pyramid((0.56, 0.56), 0.30, at=(0, 0, 4.70), color=post)
    lit(g, seed=9, amount=0.05)
    for k, facing in enumerate(("front", "left", "back", "right")):
        for z, color in ((4.44, "glow_red"), (4.07, "glow_amber"), (3.70, "glow_green")):
            at = {"front": (0, -0.22 - 0.02, z), "back": (0, 0.22 + 0.02, z), "left": (0.22 + 0.02, 0, z),
                  "right": (-0.22 - 0.02, 0, z)}[facing]
            g += plate(0.24, 0.24, at, facing, color, mat="glow")
    return g


def bench_geo() -> mb.Geo:
    """Park bench, 1.8 m wide: wooden seat and back on two iron ends. Faces the model's front."""
    iron = "#2f6f5f"
    g = mb.box((1.72, 0.46, 0.07), at=(0, -0.04, 0.45), color="wood")
    g += mb.box((1.72, 0.06, 0.40), at=(0, 0.24, 0.50), color="wood_lt", anchor="bottom").rx(-12, about=(0, 0.24, 0.50))
    side = [(-0.30, 0.0), (-0.30, 0.42), (0.20, 0.42), (0.33, 0.92), (0.40, 0.90), (0.30, 0.0)]
    for x in (-0.78, 0.78):
        g += slab(side, x - 0.035, x + 0.035, iron)
    return lit(g, seed=10, amount=0.05)


def billboard_geo() -> mb.Geo:
    """Billboard, 9 m: a 6.4 x 3.2 m holiday poster (sun, sea, sail) on two legs. No words."""
    steel = "metal_dk"
    g = mb.Geo()
    for x in (-2.1, 2.1):
        g += mb.beam((x, 0.12, 0), (x, 0.12, 5.75), (0.28, 0.28), color=steel, cap_start=False, cap_end=False)
    g += mb.box((6.6, 0.55, 0.10), at=(0, -0.10, 5.62), color=steel)                    # catwalk
    panel = mb.box((6.4, 0.30, 3.2), at=(0, 0.12, 5.75), color="white", anchor="bottom")
    panel.paint("bld_sky", where="front").paint(steel, where="back")
    g += panel
    lit(g, seed=11)
    face = 0.12 - 0.15                                                                # y of the poster surface
    g += plate(6.1, 0.95, (0, face - 0.06, 6.38), "front", "water")                     # sea
    sun = [(1.35 + 0.85 * math.cos(a), face - 0.10, 7.55 + 0.85 * math.sin(a))
           for a in (math.radians(22.5 + 45 * k) for k in range(8))]
    g += mb.polygon(sun, color="#ff8f6b")
    g += mb.tri((-1.75, face - 0.12, 6.45), (-0.55, face - 0.12, 6.45), (-1.75, face - 0.12, 8.25), color="white")   # sail
    g += mb.tri((-1.90, face - 0.12, 6.45), (-1.90, face - 0.12, 7.65), (-2.55, face - 0.12, 6.45), color="bld_salmon")
    g += mb.quad((-2.5, face - 0.12, 6.05), (-0.55, face - 0.12, 6.05), (-0.25, face - 0.12, 6.36), (-2.8, face - 0.12, 6.36),
                 color="red")                                                          # hull
    return g


def busstop_geo() -> mb.Geo:
    """Bus shelter, 4.2 m wide: glass back, poster end wall, bench, and a round stop sign."""
    frame = "blue"
    g = mb.box((4.2, 1.5, 0.12), at=(0, 0, 2.44), color=frame)                         # roof
    g += drop(mb.box((4.0, 0.06, 1.95), at=(0, 0.66, 0.48), color="#a8d2e6", anchor="bottom"),
              lambda c, n: abs(n.z) > 0.5)                                             # glass back
    end = drop(mb.box((0.08, 1.25, 1.95), at=(-1.96, 0.02, 0.48), color=frame, anchor="bottom"), "top")
    end.paint("bld_salmon", where="left").paint("bld_mustard", where="right")
    g += end
    g += mb.beam((1.96, -0.60, 0), (1.96, -0.60, 2.44), (0.08, 0.08), color=frame, cap_start=False, cap_end=False)
    g += drop(mb.box((2.7, 0.40, 0.08), at=(0.25, 0.40, 0.50), color="wood"), "bottom")  # bench
    lit(g, seed=12)
    # stop sign: a disc on a short pole on the roof corner, a bus pictogram on both faces
    g += mb.rod((2.0, -0.60, 2.50), (2.0, -0.60, 2.58), 0.035, n=3, color="grey_dark", cap_start=False, cap_end=False)
    g += mb.rod((2.0, -0.64, 2.86), (2.0, -0.56, 2.86), 0.31, n=6, color=frame).bake_light(1.05, 0.8)
    g += plate(0.34, 0.20, (2.0, -0.64 - 0.012, 2.87), "front", "white")
    g += plate(0.34, 0.20, (2.0, -0.56 + 0.012, 2.87), "back", "white")
    return g


@mb.asset("prop_kiosk", concept=dict(azimuth=32, elevation=12))
def prop_kiosk():
    mb.node("prop_kiosk", kiosk_geo())


@mb.asset("prop_tree_a", concept=dict(azimuth=30, elevation=8))
def prop_tree_a():
    mb.node("prop_tree_a", tree_a_geo())


@mb.asset("prop_tree_b", concept=dict(azimuth=30, elevation=8))
def prop_tree_b():
    mb.node("prop_tree_b", tree_b_geo())


@mb.asset("prop_lamp", concept=dict(backdrop="night", azimuth=30, elevation=6))
def prop_lamp():
    mb.node("prop_lamp", lamp_geo())


@mb.asset("prop_trafficlight", concept=dict(backdrop="sunset", azimuth=30, elevation=6))
def prop_trafficlight():
    mb.node("prop_trafficlight", trafficlight_geo())


@mb.asset("prop_bench", concept=dict(azimuth=32, elevation=16))
def prop_bench():
    mb.node("prop_bench", bench_geo())


@mb.asset("prop_billboard", concept=dict(azimuth=28, elevation=6))
def prop_billboard():
    mb.node("prop_billboard", billboard_geo())


@mb.asset("prop_busstop", concept=dict(azimuth=30, elevation=12))
def prop_busstop():
    mb.node("prop_busstop", busstop_geo())


# ---- scene shots: the street and the paint colors -------------------------------------------------
def geo_from_glb(asset: str) -> mb.Geo:
    """Any exported model as loose geometry, to dress a scene with (the hydrant, for one)."""
    data = glbfile.load(mb.contract.model_path(asset))
    out = mb.Geo()
    for n in data.reachable():
        if n.mesh is None:
            continue
        for prim in data.meshes[n.mesh]:
            pts = prim.positions @ n.world[:3, :3].T + n.world[:3, 3]
            cols = glbfile.linear_to_srgb(prim.colors[:, :3]) if prim.colors is not None else None
            for tri in prim.indices:
                color = tuple(float(c) for c in cols[tri[0]]) if cols is not None else "white"
                out.face([mb.from_gltf(pts[k]) for k in tri], color, prim.material or "vcol")
    return out


def at(g: mb.Geo, x: float, y: float, heading: float = 0.0, z: float = 0.0) -> mb.Geo:
    """Stand a prop in a scene. heading in degrees, counter-clockwise seen from above;
    0 keeps the model facing the camera side (-Y), -90 points it down the street toward -X."""
    return g.rz(heading).move(x, y, z)


CURB = 0.15            # sidewalk height above the road


def street_ground(length: float = 260.0) -> mb.Geo:
    """A 16 m wide street along X with sidewalks, a lawn behind the far one, and paint on the road."""
    g = mb.box((length, 16, 0.2), at=(0, 0, 0), anchor="top", color="road")
    for s in (1, -1):
        g += mb.box((length, 4.6, 0.2 + CURB), at=(0, s * 10.3, CURB), anchor="top", color="sidewalk")
        g += mb.box((length, 0.25, 0.2 + CURB), at=(0, s * 8.0, CURB - 0.005), anchor="top", color="grey_light")
    g += mb.box((length, 46, 0.2 + CURB), at=(0, 35.6, CURB - 0.02), anchor="top", color="grass")
    g += mb.box((3000, 3000, 0.01), at=(0, 1558.5, -0.02), anchor="top", color="water")     # the bay
    g += mb.box((length, 14, 0.2 + CURB), at=(0, -19.6, CURB - 0.02), anchor="top", color="grass")
    for x in range(-int(length / 2) + 2, int(length / 2), 6):                      # dashed center line
        g += mb.box((2.8, 0.18, 0.02), at=(x, 0, 0), anchor="bottom", color="white")
    for s in (1, -1):                                                             # parking lane lines
        g += mb.box((length, 0.14, 0.02), at=(0, s * 5.2, 0), anchor="bottom", color="grey_light")
    for k in range(-7, 8):                                                        # zebra crossing
        g += mb.box((2.8, 0.55, 0.02), at=(1.0, k * 1.0, 0), anchor="bottom", color="white")
    return g


def build_street() -> None:
    """Every prop along one street: the review picture for the whole family."""
    mb.reset()
    sedan, van, bus, truck = sedan_parts, van_parts, bus_parts, truck_parts
    taxi = lambda: mb.Geo().add(sedan_parts(paint="taxi_yellow", taxi=True)[0]).add(      # noqa: E731
        sedan_parts(paint="taxi_yellow", taxi=True)[1])
    cars = mb.Geo()
    # far side: curb lane and driving lane head toward -X (heading -90)
    cars += at(tinted(*sedan(), "#3fa652"), -21.0, 6.6, -90)
    cars += at(taxi(), -13.5, 3.0, -90)
    cars += at(tinted(*bus(), "#d7263d"), 10.0, 6.45, -90)
    cars += at(tinted(*sedan(), "#8f6fd0"), 22.5, 3.1, -90)
    # near side: heads toward +X (heading 90)
    cars += at(tinted(*sedan(), "#e0372f"), -20.0, -3.1, 90)
    cars += at(tinted(*van(), "#9fe0c0"), -10.0, -3.0, 90)
    cars += at(tinted(*truck(), "#2f62c9"), 6.0, -3.1, 90)
    cars += at(tinted(*sedan(), "#f5f5f0"), 18.5, -3.0, 90)
    cars += at(tinted(*sedan(), "#2f62c9"), -3.5, -6.7, 90)
    cars += at(tinted(*van(), "#f5f5f0"), 24.5, -6.6, 90)
    cars += at(tinted(*wreck_parts(), "#f29b85"), 13.0, -6.3, 68)
    furniture = mb.Geo()
    for x, y, make, heading in [
            (-22.5, 8.8, lamp_geo, 0), (-18.0, 10.9, kiosk_geo, 0), (-13.6, 11.6, bench_geo, 0),
            (-8.6, 11.4, tree_a_geo, 20), (-3.0, 10.1, busstop_geo, 0), (2.4, 8.8, trafficlight_geo, 0),
            (16.5, 8.8, lamp_geo, 0), (-0.4, -8.8, trafficlight_geo, 0), (-12.0, -8.8, lamp_geo, 0),
            (9.0, -10.6, bench_geo, 180)]:
        furniture += at(make(), x, y, heading, CURB)
    furniture += at(geo_from_glb("prop_hydrant"), -11.2, 8.7, 0, CURB)
    for x, y, make, heading in [
            (-26.5, 15.0, tree_b_geo, 0), (-15.5, 17.5, tree_a_geo, 100), (-5.5, 16.5, tree_b_geo, 40),
            (3.0, 18.0, tree_a_geo, 200), (10.0, 14.6, billboard_geo, 0), (19.5, 16.5, tree_a_geo, 300),
            (25.0, 14.0, tree_b_geo, 15), (31.0, 17.0, tree_a_geo, 60), (-33.0, 17.5, tree_a_geo, 150)]:
        furniture += at(make(), x, y, heading, CURB - 0.02)
    lift = 0.03                                    # keeps the scene clear of the backdrop's own floor
    mb.node("ground", street_ground().move(0, 0, lift))
    mb.node("cars", cars.move(0, 0, lift))
    mb.node("furniture", furniture.move(0, 0, lift))


def build_tints() -> None:
    """Every vehicle in every suggested paint color, lined up like a toy collection."""
    mb.reset()
    g = mb.Geo()
    rows = [("prop_car_sedan", sedan_parts, -13.0, 2.9), ("prop_car_van", van_parts, -6.0, 3.3),
            ("prop_truck", truck_parts, 3.5, 3.9), ("prop_bus", bus_parts, 17.5, 4.2)]
    for asset_id, parts, y, pitch in rows:
        colors = TINTS[asset_id]
        n = len(colors) + (1 if asset_id == "prop_car_sedan" else 0)
        for i, color in enumerate(colors):
            g += at(tinted(*parts(), color), (i - (n - 1) / 2) * pitch, y, 0)
        if asset_id == "prop_car_sedan":
            paint, fixed = sedan_parts(paint="taxi_yellow", taxi=True)
            g += at(paint + fixed, (n - 1 - (n - 1) / 2) * pitch, y, 0)
    mb.node("vehicles", g)


SCENE_OPTS = {
    "street": dict(backdrop="sky", size=(1600, 800), samples=16, sun_azimuth=-55, sun_elevation=48,
                   view=mb.View("", eye=(7.0, -58.0, 15.5), target=(0.0, 6.0, 3.2), fov=46)),
    "tints": dict(backdrop="studio", size=(1400, 900), samples=14, azimuth=22, elevation=34, fov=30),
}


def render_scenes(force: bool = False) -> None:
    """The street scene and the paint-color sheet, skipped when up to date."""
    with open(os.path.abspath(__file__), "rb") as f:
        src = hashlib.sha1(f.read()).hexdigest()
    hydrant = mb.contract.model_path("prop_hydrant")
    if os.path.exists(hydrant):
        src += mb._file_sha(hydrant)
    jobs = [("street", build_street, os.path.join(mb.CONCEPT, "props_street.png")),
            ("tints", build_tints, os.path.join(mb.CONCEPT, "props_car_tints.png"))]
    for name, build, out in jobs:
        opts = SCENE_OPTS[name]
        stamp = f"{mb_preview.PREVIEW_VERSION}|{src}|{opts!r}"
        if not force and mb._stamp_ok(out, stamp):
            continue
        build()
        mb.concept(name, out=out, stamp=stamp, **opts)
        print(f"  scene: {os.path.relpath(out, mb.REPO)}")


def write_tint_notes() -> None:
    """Add the "tint" object to the manifest entries of the vehicles that take a paint color."""
    man = mb.Manifest("props")
    for asset_id, colors in TINTS.items():
        if asset_id in man.data.get("models", {}):
            man.data["models"][asset_id]["tint"] = dict(TINT_NOTE, colors=colors)
    man.write()


if __name__ == "__main__":
    argv = sys.argv[1:]
    scenes_only = "--scenes-only" in argv
    argv = [a for a in argv if a != "--scenes-only"]
    code = 0 if scenes_only else mb.run_family("props", argv)
    if not scenes_only and "--list" not in argv:
        write_tint_notes()
    quick = any(a in argv for a in ("--no-previews", "--no-concept", "--list")) or \
        os.environ.get("MB_NO_PREVIEWS") or os.environ.get("MB_NO_CONCEPT")
    partial = any(a == "--only" or a.startswith("--only=") for a in argv)
    if code == 0 and (scenes_only or not (quick or partial)):
        render_scenes(force=scenes_only or "--force" in argv or bool(os.environ.get("MB_FORCE")))
    raise SystemExit(code)
