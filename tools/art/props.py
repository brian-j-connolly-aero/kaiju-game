#!/opt/mbtools/venv/bin/python
# mb-family: props
"""Street props: the model-city clutter that sells the hatchling's scale.

    /opt/mbtools/venv/bin/python tools/art/props.py                  build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/props.py --no-previews    geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/props.py --only prop_bus,prop_truck
    /opt/mbtools/venv/bin/python tools/art/props.py --scenes-only    just the street, tint and wreck scenes

Writes, per docs/ASSETS.md section 3 "City" (props only), one mesh each:
    prop_car_sedan, prop_car_taxi, prop_car_van, prop_bus, prop_truck, prop_car_wreck,
    prop_kiosk, prop_tree_a, prop_tree_b, prop_lamp, prop_trafficlight, prop_bench,
    prop_billboard, prop_busstop                       (prop_hydrant belongs to example.py)
    client/public/assets/manifest.props.json
    docs/art/previews/<id>.png, docs/art/concept/<id>.png,
    docs/art/concept/props_street.png, docs/art/concept/props_car_tints.png,
    docs/art/concept/props_wrecks.png                  each vehicle beside the stretched wreck it leaves

Sizes are real-world meters and match the height and crush radius the game uses for each
prop (tools/art/data/archetypes.json): a sedan is 4.5 m long, the bus 12 m.

COLOR VARIANTS ("tint"). Sedan, van, bus and truck are authored with near-white body paint so
the game can multiply a paint color into it. Which faces are paint is stored in the file as
the alpha of the vertex color (COLOR_0): alpha 1 = body paint (tint it), alpha 0 = glass,
tires, lights, trim (never tint). Their manifest entries carry a "tint" object naming the
part, the mask and the suggested colors. Every other model has alpha 1 everywhere and no
"tint" entry. tinted() below is the reference implementation (it is what the scene shots use).

GRABBABLE THINGS HAVE NO HIDDEN SIDE. The kaiju picks the five vehicles up, holds them tilted
in its hand and throws them spinning, and the game draws a face from its front only. So every
vehicle and the wreck is closed underneath (dark trim, never tinted), and their contact sheets
carry a FROM BELOW cell: any magenta there is a hole a player will look through. Street
furniture stands on the ground and may stay open underneath, but nothing above a soldier's eye
(1.7 m) may be open from below: eaves, lantern caps, finials.

ONE WRECK FOR FIVE VEHICLES. prop_car_wreck's manifest entry carries tint.wreckScale, the
[width, height, length] factors that stretch it to each vehicle kind (WRECK_SCALE below).
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
SIGN_LIT = "#ffe9a6"            # bus destination sign, taxi roof sign
DECAL = 0.03                    # flat details sit this far proud of the surface behind them

# Headlights, tail lights and the bus sign as glowing faces (material `glow`) instead of lit
# paint. OFF for now: the game multiplies a prop's paint color into every part of the model
# and only the `vcol` part honors the paint mask, so on a blue sedan glowing tail lights
# would turn black. Turn this on once the client leaves the paint color off the `glow` part
# (it costs one more instanced draw per vehicle model). The taxi's roof sign already glows:
# the taxi is never tinted.
LIGHTS_GLOW = False
LAMP_GLOW = {HEADLIGHT: "glow_lamp", TAILLIGHT: "glow_red", SIGN_LIT: "glow_window"}

# Paint colors the game may tint each vehicle with (sRGB hex). No kaiju orange, human cyan or
# volley yellow: those belong to the color language.
TINTS = {
    "prop_car_sedan": ["#e0372f", "#2f62c9", "#f5f5f0", "#3fa652", "#8f6fd0", "#f29b85", "#2a9d8f", "#aab2bc"],
    "prop_car_van": ["#f5f5f0", "#2f62c9", "#e0372f", "#9fe0c0", "#b9a6e0"],
    "prop_bus": ["#d7263d", "#2f62c9", "#3fa652", "#f3e3b3"],
    "prop_truck": ["#2f62c9", "#e0372f", "#3fa652", "#f5f5f0", "#aab2bc"],
}
# The wreck keeps scorched paint: tint it with whatever the crushed vehicle was painted.
TINTS["prop_car_wreck"] = sorted({c for colors in TINTS.values() for c in colors} | {mb.palette.PALETTE["taxi_yellow"]})
TINT_HINTS = {"prop_car_wreck": "use the paint color of the vehicle that was crushed (taxi: #f7c21a); "
                                "wreckScale stretches this one wreck to the vehicle it was: "
                                "[width, height, length] per prop kind, the instance's x, y, z scale"}
# One wreck model stands in for all five vehicles, and a crushed 12 m bus must not pop into a
# 5 m wreck. Scale factors [width, height, length] (the game's x, y, z) per prop kind, written
# into the wreck's manifest entry as tint.wreckScale. The slab shape takes the stretch well:
# see docs/art/concept/props_wrecks.png.
WRECK_SCALE = {
    "car_sedan": [1, 1, 1],
    "car_taxi": [1, 1, 1],
    "car_van": [1.1, 1.3, 1.1],
    "truck": [1.2, 1.7, 1.75],
    "bus": [1.2, 1.8, 2.4],
}
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


def lamp(w: float, h: float, at, facing: str, color) -> mb.Geo:
    """A headlight, tail light or lit sign: a plate() that glows when LIGHTS_GLOW is on."""
    if LIGHTS_GLOW:
        return plate(w, h, at, facing, LAMP_GLOW.get(color, color), mat="glow")
    return plate(w, h, at, facing, color)


def underside(g: mb.Geo):
    """(the downward faces of `g`, painted as dark trim; the rest). The kaiju picks vehicles
    up, holds them tilted and throws them spinning, so every vehicle needs its floor: the game
    draws faces from the front only, and a missing floor is a hole right through the car."""
    belly, rest = split(g, "bottom")
    return belly.paint(TRIM), rest


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
                lambda c, n: n.z > 0.95 and abs(c.y - 0.175) < 0.2)                    # the deck under the cabin
    belly, body = underside(body)
    cab = mb.tapered_box((w, 2.25), (1.42, 1.50), 0.52, at=(0, 0.175, 0.98), offset=(0, 0.07), color=GLASS,
                         cap_bottom=False)
    cab.paint(GLASS_LT, where=lambda c, n: n.y < -0.5)
    roof, glass = split(cab, flat_top)
    roof.paint(paint)
    for s in (1, -1):                                                         # door pillars across the side glass
        lo, hi = s * (w / 2 + DECAL), s * (0.72 + DECAL)                       # stops just short of the roof
        pts = [(lo, 0.10, 0.98), (lo, 0.30, 0.98), (hi, 0.34, 1.47), (hi, 0.16, 1.47)]
        roof += mb.polygon(pts if s > 0 else pts[::-1], color=paint)
    fixed = lit(glass + belly, seed=3)
    for y in (-2.15, 2.15):                                                   # chunky bumpers
        fixed += drop(mb.box((w, 0.16, 0.22), at=(0, y, 0.43), color=TRIM), lambda c, n, y=y: n.y * y < -0.5)
    for x in (-0.6, 0.6):
        fixed += lamp(0.40, 0.16, (x, -2.1 - DECAL, 0.61), "front", HEADLIGHT)
        fixed += lamp(0.38, 0.16, (x, 2.1 + DECAL, 0.61), "back", TAILLIGHT)
    fixed += plate(0.64, 0.14, (0, -2.1 - DECAL, 0.61), "front", TRIM)          # grille
    fixed += axles((-1.32, 1.30), 0.39, 0.94, n=6)
    if taxi:
        # the lit roof sign: safe to glow today, because the taxi is never tinted
        fixed += drop(mb.box((0.52, 0.20, 0.17), at=(0, 0.25, 1.50), anchor="bottom"), "bottom").glow("glow_window")
        for s in (1, -1):                                                     # checker band on the doors
            for y in (-0.52, 0.10, 0.72):
                fixed += plate(0.31, 0.15, (s * (w / 2 + DECAL), y, 0.80), "left" if s > 0 else "right", "black")
    return lit(body + roof, seed=1), fixed


def van_parts(paint=PAINT):
    """(paint, fixed) geometry of the delivery van: 5.0 m long, 2.0 m wide, 2.12 m tall."""
    w = 1.96
    body = drop(slab([(-2.45, 0.32), (-2.45, 0.82), (-2.22, 1.08), (-1.72, 1.14), (2.45, 1.14), (2.45, 0.32)],
                     -w / 2, w / 2, paint), lambda c, n: n.z > 0.95 and c.y > -1.0)     # the deck under the cargo box
    belly, body = underside(body)
    cab = drop(mb.tapered_box((w, 1.30), (1.76, 0.85), 0.98, at=(0, -1.07, 1.14), offset=(0, 0.225), color=GLASS,
                              cap_bottom=False), "back")
    cab.paint(GLASS_LT, where=lambda c, n: n.y < -0.5)
    roof, glass = split(cab, flat_top)
    roof.paint(paint)
    cargo = drop(mb.box((w, 2.87, 0.98), at=(0, 1.015, 1.63), color=paint), "bottom")
    fixed = lit(glass + belly, seed=3)
    for y in (-2.49, 2.49):
        fixed += drop(mb.box((w, 0.16, 0.22), at=(0, y, 0.43), color=TRIM), lambda c, n, y=y: n.y * y < -0.5)
    for x in (-0.68, 0.68):
        fixed += lamp(0.36, 0.18, (x, -2.45 - DECAL, 0.68), "front", HEADLIGHT)
        fixed += lamp(0.14, 0.46, (x * 1.26, 2.45 + DECAL, 0.92), "back", TAILLIGHT)
    fixed += plate(0.78, 0.15, (0, -2.45 - DECAL, 0.68), "front", TRIM)
    fixed += plate(1.20, 0.42, (0, 2.45 + DECAL, 1.72), "back", GLASS)          # rear door windows
    for s in (1, -1):                                                         # door mirrors
        fixed += mb.box((0.17, 0.10, 0.25), at=(s * 1.04, -1.58, 1.38), color=TRIM)
    fixed += axles((-1.55, 1.50), 0.40, 1.03, n=6)
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
    skirt = drop(mb.box((w, length, 0.38), at=(0, 0, 0.51), color=TRIM), "top")      # its bottom is the bus floor
    glass = drop(mb.box((w, length, 1.10), at=(0, 0, 2.0), color=GLASS), hidden)
    glass.paint(GLASS_LT, where="front")
    fixed = lit(skirt + glass, seed=3)
    fixed += drop(mb.box((1.5, 2.6, 0.20), at=(0, 1.2, 3.0), color="grey_light", anchor="bottom"), "bottom")   # roof unit
    for y in (-4.92, -0.45):                                                   # doors, right side
        fixed += plate(1.18, 2.02, (-(w / 2 + 2 * DECAL), y, 1.46), "right", mb.shade(GLASS, 0.75))
    fixed += lamp(1.70, 0.26, (0, -length / 2 - DECAL, 2.76), "front", SIGN_LIT)          # destination sign
    for x in (-0.86, 0.86):
        fixed += lamp(0.40, 0.20, (x, -length / 2 - DECAL, 0.92), "front", HEADLIGHT)
        fixed += lamp(0.30, 0.30, (x * 1.1, length / 2 + DECAL, 1.05), "back", TAILLIGHT)
    fixed += axles((-3.70, 3.30), 0.60, 1.28)
    return lit(body + roof, seed=1) + pillars, fixed


def truck_parts(paint=PAINT):
    """(paint, fixed) geometry of the box truck: 8.5 m long, 2.5 m wide, 3.3 m tall. The cab
    and the stripe round the cargo box take the tint; the box itself stays white."""
    cab = slab([(-4.2, 0.45), (-4.2, 1.40), (-4.02, 2.60), (-2.55, 2.60), (-2.55, 0.45)], -1.2, 1.2, paint)
    floor, cab = underside(cab)
    windshield, cab = split(cab, lambda c, n: n.y < -0.5 and c.z > 1.4)
    windshield.paint(GLASS_LT)
    deflector = mb.wedge((2.2, 1.25, 0.62), at=(0, -3.2, 2.60), high="back", color=paint)
    w, y0, y1 = 2.5, -2.55, 4.2
    mid = (y0 + y1) / 2
    sides = lambda c, n: abs(n.z) > 0.5                                        # noqa: E731
    stripe = drop(mb.box((w, y1 - y0, 0.50), at=(0, mid, 2.0), color=paint), sides)
    box = drop(mb.box((w, y1 - y0, 0.70), at=(0, mid, 1.40), color="white"), "top")
    box.paint(TRIM, where="bottom")                                                     # the cargo floor, seen from below
    box += drop(mb.box((w, y1 - y0, 1.05), at=(0, mid, 2.775), color="white"), "bottom")
    fixed = lit(box + windshield + floor, seed=3)
    fixed += drop(mb.box((1.1, 6.9, 0.50), at=(0, 0.72, 0.80), color=TRIM), "top")           # chassis
    fixed += drop(mb.box((2.4, 0.18, 0.30), at=(0, -4.27, 0.62), color=TRIM), "back")        # bumper
    for s in (1, -1):
        fixed += plate(0.95, 0.72, (s * (1.2 + DECAL), -3.28, 1.98), "left" if s > 0 else "right", GLASS)
        fixed += lamp(0.42, 0.20, (s * 0.86, -4.2 - DECAL, 0.98), "front", HEADLIGHT)
        fixed += lamp(0.30, 0.20, (s * 1.0, y1 + DECAL, 1.25), "back", TAILLIGHT)
    fixed += plate(1.0, 0.24, (0, -4.2 - DECAL, 1.0), "front", TRIM)
    fixed += axles((-3.25,), 0.60, 1.25) + axles((2.60,), 0.60, 1.28)
    return lit(cab + deflector + stripe, seed=1), fixed


# Everything the kaiju can pick up is seen from every side: its sheet shows the underside too
# (magenta there = a missing floor).
BELOW = mb.View("FROM BELOW", azimuth=35, elevation=-35, ortho=True)   # flat: perspective cells have a ground disc


@mb.asset("prop_car_sedan", sheet=dict(extra=["top", BELOW]), concept=dict(azimuth=35, elevation=14))
def prop_car_sedan():
    tint_node("prop_car_sedan", *sedan_parts())


def taxi_geo() -> mb.Geo:
    """The sedan as a cab: yellow, checker band, roof sign. Always yellow, so no tint mask."""
    paint, fixed = sedan_parts(paint="taxi_yellow", taxi=True)
    return paint + fixed


@mb.asset("prop_car_taxi", sheet=dict(extra=["top", BELOW]), concept=dict(azimuth=35, elevation=14))
def prop_car_taxi():
    mb.node("prop_car_taxi", taxi_geo())


@mb.asset("prop_car_van", sheet=dict(extra=["top", BELOW]), concept=dict(azimuth=35, elevation=14))
def prop_car_van():
    tint_node("prop_car_van", *van_parts())


@mb.asset("prop_bus", sheet=dict(extra=["right", "top", BELOW]), concept=dict(azimuth=-40, elevation=14))
def prop_bus():
    tint_node("prop_bus", *bus_parts())


@mb.asset("prop_truck", sheet=dict(extra=["top", BELOW]), concept=dict(azimuth=38, elevation=14))
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


def scorch(g: mb.Geo, seed: int, soot: float = 0.55, crease: float | None = None) -> mb.Geo:
    """Blotchy soot and rust over whatever color is there: some faces nearly clean, some black.
    The dirt is only ever soot or rust (one roll per face, never per color channel, which gave
    green and pink panels). With `crease` (a y position) the soot is thickest along that line
    across the car, where it was stepped on and burned, and thin toward the ends, so the paint
    still shows there; a little more settles on the faces that look up."""
    rng = random.Random(seed)
    black, rust = mb.palette.rgb("#1d1a18"), mb.palette.rgb("#6a3d24")

    def repaint(col, center, normal):
        heat = 1.0 if crease is None else 0.3 + 0.7 * max(0.0, 1.0 - abs(center.y - crease) / 1.7) ** 1.5
        t = min(0.94, soot * heat * (1.0 + 0.35 * max(normal.z, 0.0)) * rng.uniform(0.7, 1.5))
        k = 0.4 * rng.random() ** 4                             # how rusty this patch of dirt is
        dirt = tuple(b + (r - b) * k for b, r in zip(black, rust))
        return tuple(c + (d - c) * t for c, d in zip(col, dirt))

    return g.recolor(repaint)


def wreck_parts():
    """(paint, fixed) geometry of a car that has been stepped on: flat on the road, creased
    across the middle, wheels splayed out, a bumper lying loose. 5 m long, 0.9 m tall. The
    scorched body panels are still paint: tint them with the color of the car that was crushed.
    Untinted it is scorched grey metal. The game stretches it for the bigger vehicles
    (WRECK_SCALE). It is closed underneath, like everything the kaiju may pick up."""
    w = 1.86
    paint_color = (0.70, 0.70, 0.70)
    strips = (-w / 2, -0.31, 0.31, w / 2)                    # three strips across: panels for the soot to break up
    seam = lambda c, n: abs(n.y) > 0.9 and abs(c.y + 0.2) < 0.02                      # noqa: E731
    body = mb.Geo()
    for outline in ([(-2.1, 0.05), (-2.1, 0.50), (-1.95, 0.66), (-1.05, 0.506), (-0.2, 0.36), (-0.2, 0.05)],
                    [(-0.2, 0.05), (-0.2, 0.36), (0.6, 0.53), (1.4, 0.70), (2.05, 0.64), (2.1, 0.42), (2.1, 0.05)]):
        for i in range(3):
            body += drop(slab(outline, strips[i], strips[i + 1], paint_color, cap0=i == 0, cap1=i == 2), seam)
    cab = mb.tapered_box((1.74, 2.2), (1.56, 1.7), 0.17, at=(0, 0.2, 0.0), color="#15181c")   # closed: it lies loose
    roof, glass = split(cab, flat_top)
    roof.paint(paint_color)
    for part in (roof, glass):                               # the roof lies caved in on the rear half
        part.rx(-9, about=(0, 0.2, 0)).move(0, 0.1, 0.38)
    paint = scorch(lit(body + roof, seed=1), seed=3, soot=0.68, crease=-0.2)
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


@mb.asset("prop_car_wreck", sheet=dict(extra=["top", BELOW]), concept=dict(azimuth=35, elevation=16))
def prop_car_wreck():
    tint_node("prop_car_wreck", *wreck_parts())


# ---- street furniture -------------------------------------------------------------------------
def kiosk_geo() -> mb.Geo:
    """Ice-cream kiosk, 2.8 x 2.6 m, 3.5 m to the top of the cone on its roof: striped awning
    over the counter. The roof is slate, not teal: seen from above, cyan belongs to the army."""
    g = drop(mb.box((2.4, 2.0, 2.2), at=(0, 0.1, 0), color="bld_cream", anchor="bottom"),
             lambda c, n: abs(n.z) > 0.5)                                                  # floor and ceiling are hidden
    g += plate(1.9, 0.95, (0, -0.9 - DECAL, 1.55), "front", mb.shade(GLASS, 0.7))          # serving window
    g += drop(mb.box((2.1, 0.34, 0.10), at=(0, -1.05, 1.02), color="wood"), "back")        # counter
    # the eaves overhang the walls at 2.2 m, above a soldier's eye: the roof needs its underside
    g += mb.tapered_box((2.8, 2.4), (1.5, 1.1), 0.42, at=(0, 0.1, 2.2), color="bld_slate")
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
    g += plate(0.8, 1.8, (0.45, 1.1 + DECAL, 0.9), "back", "bld_slate_dk")                              # door
    # posters on the side walls
    g += plate(0.9, 1.1, (1.2 + DECAL, 0.15, 1.35), "left", "bld_salmon")
    g += plate(0.9, 1.1, (-1.2 - DECAL, 0.15, 1.35), "right", "bld_sky")
    # the sign on the roof says what it sells: a waffle cone with a pink scoop, 0.95 m tall
    rim = 2.62 - 0.04 + 0.50
    g += mb.cone(5, 0.27, 0.50, color="wood_lt", cap_bottom=False).ry(180).move(0, 0.1, rim) \
        .bake_light(1.0, 0.82).jitter(0.07, seed=5)
    g += mb.sphere(0.34, n=5, rings=3, at=(0, 0.1, rim + 0.11), color="#ff9db5").bake_light(1.1, 0.78).jitter(0.05, seed=6)
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
    """Street lamp, 6 m: two framed lanterns hung close against the post from a short crossbar.
    Chunky, so it is more than a hairline at 60 m, and each cream lantern sits between a dark
    cap and a dark base so it still reads against a bright afternoon cloud. It stays within
    0.6 m of its axis (the game treats it as a 0.4 m post). Symmetric: any heading works."""
    post = "#2f4f4a"
    g = mb.prism(6, 0.30, 0.60, radius_top=0.18, color=post, cap_bottom=False)
    g += mb.prism(5, 0.16, 5.00, radius_top=0.11, at=(0, 0, 0.60), color=post, cap_bottom=False, cap_top=False)
    g += mb.box((1.00, 0.14, 0.14), at=(0, 0, 5.47), color=post)                       # crossbar
    g += mb.cone(4, 0.17, 0.38, at=(0, 0, 5.58), color=post)                           # finial, closed: seen from below
    for x in (-0.325, 0.325):
        g += mb.pyramid((0.54, 0.54), 0.20, at=(x, 0, 5.27), color=post)               # lantern cap, closed
    lit(g, seed=8, amount=0.05)
    for x in (-0.325, 0.325):
        lantern = drop(mb.tapered_box((0.26, 0.26), (0.44, 0.44), 0.45, at=(x, 0, 4.82), color="glow_lamp", mat="glow"),
                       "top")
        lantern.paint(mb.shade(post, 0.8), where="bottom").material("vcol", where="bottom")
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
    # One lamp is lit per face, as on a real one: green along the street (front and back),
    # red across it (left and right). The other two lamps are dark glass.
    lamps = ((4.44, "glow_red", "#5a1512"), (4.07, "glow_amber", "#5a3d00"), (3.70, "glow_green", "#12431f"))
    for facing in ("front", "left", "back", "right"):
        on = "glow_green" if facing in ("front", "back") else "glow_red"
        for z, lit_color, dark in lamps:
            at = {"front": (0, -0.22 - 0.02, z), "back": (0, 0.22 + 0.02, z), "left": (0.22 + 0.02, 0, z),
                  "right": (-0.22 - 0.02, 0, z)}[facing]
            g += plate(0.24, 0.24, at, facing, lit_color, mat="glow") if lit_color == on else \
                plate(0.24, 0.24, at, facing, dark)
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


def ridge(p0, p1, half_width: float, depth: float, color) -> mb.Geo:
    """A brace lying on a wall that faces the model's back: a bar with a triangular section
    (two sloping faces and two end caps, 6 triangles; the face against the wall is left out)."""
    a, b = mb.V(p0), mb.V(p1)
    along = (b - a).normalized()
    side = along.cross(mb.V(0, 1, 0)).normalized() * half_width
    out = mb.V(0, depth, 0)
    pts = [a - side, a + side, a + out, b - side, b + side, b + out]
    g = mb.Geo()
    middle = (a + b) / 2 + out / 3
    for idx in ((0, 3, 5, 2), (1, 2, 5, 4), (0, 2, 1), (3, 4, 5)):
        face = [pts[i] for i in idx]
        center = sum(face, mb.V(0, 0, 0)) / len(face)
        normal = (face[1] - face[0]).cross(face[2] - face[0])
        g.face(face if normal.dot(center - middle) > 0 else face[::-1], color)
    return g


def billboard_geo() -> mb.Geo:
    """Billboard, 9 m: a 6.4 x 3.2 m holiday poster (sun, sea, sail) on two legs, braced behind.
    No words. The sun is pale cream: orange is the kaiju's color."""
    steel = "metal_dk"
    g = mb.Geo()
    for x in (-2.1, 2.1):
        g += mb.beam((x, 0.12, 0), (x, 0.12, 5.75), (0.28, 0.28), color=steel, cap_start=False, cap_end=False)
    g += mb.box((6.6, 0.55, 0.10), at=(0, -0.10, 5.62), color=steel)                    # catwalk
    panel = mb.box((6.4, 0.30, 3.2), at=(0, 0.12, 5.75), color="white", anchor="bottom")
    panel.paint("bld_sky", where="front").paint("metal", where="back")
    g += panel
    # the back is what one side of every street sees: an A-frame and two rails on bare sheet metal
    back = 0.12 + 0.15
    for sx in (1, -1):
        g += ridge((sx * 2.1, back, 5.80), (sx * 0.25, back, 8.90), 0.13, 0.16, steel)
    for z in (6.55, 8.05):
        reach = 2.1 - (z - 5.80) * (2.1 - 0.25) / (8.90 - 5.80) + 0.55
        g += ridge((-max(reach, 1.4), back, z), (max(reach, 1.4), back, z), 0.10, 0.12, steel)
    lit(g, seed=11)
    face = 0.12 - 0.15                                                                # y of the poster surface
    g += plate(6.1, 0.95, (0, face - 0.06, 6.38), "front", "water")                     # sea
    sun = [(1.35 + 0.85 * math.cos(a), face - 0.10, 7.55 + 0.85 * math.sin(a))
           for a in (math.radians(22.5 + 45 * k) for k in range(8))]
    g += mb.polygon(sun, color="#fff2c4")
    g += mb.tri((-1.75, face - 0.12, 6.45), (-0.55, face - 0.12, 6.45), (-1.75, face - 0.12, 8.25), color="white")   # sail
    g += mb.tri((-1.90, face - 0.12, 6.45), (-1.90, face - 0.12, 7.65), (-2.55, face - 0.12, 6.45), color="bld_salmon")
    g += mb.quad((-2.5, face - 0.12, 6.05), (-0.55, face - 0.12, 6.05), (-0.25, face - 0.12, 6.36), (-2.8, face - 0.12, 6.36),
                 color="red")                                                          # hull
    return g


def busstop_geo() -> mb.Geo:
    """Bus shelter, 4.2 m wide: glazed back with a blue frame, poster end wall, bench, and a
    round stop sign."""
    frame = "blue"
    g = mb.box((4.2, 1.5, 0.12), at=(0, 0, 2.44), color=frame)                         # roof
    g += drop(mb.box((4.0, 0.06, 1.95), at=(0, 0.66, 0.48), color="#8fbfd6", anchor="bottom"),
              lambda c, n: abs(n.z) > 0.5 or n.x < -0.5)                               # glass back (left edge: in the end wall)
    end = drop(mb.box((0.08, 1.25, 1.95), at=(-1.96, 0.02, 0.48), color=frame, anchor="bottom"), "top")
    end.paint("bld_salmon", where="left").paint("bld_mustard", where="right")
    g += end
    g += mb.beam((1.96, -0.60, 0), (1.96, -0.60, 2.44), (0.08, 0.08), color=frame, cap_start=False, cap_end=False)
    g += drop(mb.box((2.7, 0.40, 0.08), at=(0.25, 0.40, 0.53), color="wood"),
              lambda c, n: n.z < -0.5 or n.y > 0.5)                                    # bench (its back is against the glass)
    # the frame that makes the pale slab read as glazing: a mullion on both faces, a sill behind
    g += plate(0.10, 1.95, (0, 0.63 - 0.012, 1.455), "front", frame)
    g += plate(0.10, 1.95, (0, 0.69 + 0.012, 1.455), "back", frame)
    g += plate(4.0, 0.12, (0, 0.69 + 0.012, 0.54), "back", frame)
    lit(g, seed=12)
    # stop sign: a disc on a short pole on the roof corner, a bus pictogram on both faces
    g += mb.rod((2.0, -0.60, 2.48), (2.0, -0.60, 2.70), 0.035, n=3, color="grey_dark", cap_start=False, cap_end=False)
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


@mb.asset("prop_lamp", concept=[dict(backdrop="night", azimuth=30, elevation=6),
                                # stage 1 is afternoon: the lanterns must also read against a bright sky,
                                # from a hatchling's eye (3.8 m)
                                dict(name="day", backdrop="sky",
                                     view=mb.View("", eye=(4.2, -8.5, 3.8), target=(0.0, 0.0, 4.4), fov=38))])
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
    g += mb.box((length, 96, 0.2 + CURB), at=(0, 60.6, CURB - 0.02), anchor="top", color="grass")
    g += mb.box((3000, 3000, 0.01), at=(0, 1608.5, -0.02), anchor="top", color="water")     # the bay
    g += mb.box((length, 14, 0.2 + CURB), at=(0, -19.6, CURB - 0.02), anchor="top", color="grass")
    for x in range(-int(length / 2) + 2, int(length / 2), 6):                      # dashed center line
        g += mb.box((2.8, 0.18, 0.02), at=(x, 0, 0), anchor="bottom", color="white")
    for s in (1, -1):                                                             # parking lane lines
        g += mb.box((length, 0.14, 0.02), at=(0, s * 5.2, 0), anchor="bottom", color="grey_light")
    for k in range(-7, 8):                                                        # zebra crossing
        g += mb.box((2.8, 0.55, 0.02), at=(1.0, k * 1.0, 0), anchor="bottom", color="white")
    return g


# Models this script does not build, placed in the street shot when their files exist:
# (asset, x, y, heading, on the sidewalk). The stage 1 kaiju is there to show the scale.
STREET_GUESTS = [("prop_hydrant", -11.2, 8.7, 0, True), ("kaiju_lizard_s1", 17.2, -2.2, 38, False)]


def build_street() -> None:
    """Every prop along one street: the review picture for the whole family."""
    mb.reset()
    cars = mb.Geo()
    # far side: curb lane and driving lane head toward -X (heading -90)
    cars += at(tinted(*sedan_parts(), "#3fa652"), -21.0, 6.6, -90)
    cars += at(taxi_geo(), -13.5, 3.0, -90)
    cars += at(tinted(*bus_parts(), "#d7263d"), 10.0, 6.45, -90)
    cars += at(tinted(*sedan_parts(), "#8f6fd0"), 22.5, 3.1, -90)
    # near side: heads toward +X (heading 90)
    cars += at(tinted(*sedan_parts(), "#e0372f"), -20.0, -3.1, 90)
    cars += at(tinted(*van_parts(), "#9fe0c0"), -10.0, -3.0, 90)
    cars += at(tinted(*truck_parts(), "#2f62c9"), 6.0, -3.1, 90)
    cars += at(tinted(*sedan_parts(), "#f5f5f0"), 25.0, -3.0, 90)
    cars += at(tinted(*sedan_parts(), "#2f62c9"), -3.5, -6.7, 90)
    cars += at(tinted(*van_parts(), "#f5f5f0"), 31.0, -6.6, 90)
    cars += at(tinted(*wreck_parts(), "#f29b85"), 13.0, -6.3, 68)
    furniture = mb.Geo()
    for guest, x, y, heading, on_sidewalk in STREET_GUESTS:
        try:
            furniture += at(geo_from_glb(guest), x, y, heading, CURB if on_sidewalk else 0.0)
        except Exception as err:           # not built yet, or being rewritten right now: leave it out
            print(f"  street scene: left out {guest} ({type(err).__name__})")
    for x, y, make, heading in [
            (-22.5, 8.8, lamp_geo, 0), (-18.0, 10.9, kiosk_geo, 0), (-13.6, 11.6, bench_geo, 0),
            (-8.6, 11.4, tree_a_geo, 20), (-3.0, 10.1, busstop_geo, 0), (2.4, 8.8, trafficlight_geo, 0),
            (16.5, 8.8, lamp_geo, 0), (-0.4, -8.8, trafficlight_geo, 0), (-12.0, -8.8, lamp_geo, 0),
            (9.0, -10.6, bench_geo, 180)]:
        furniture += at(make(), x, y, heading, CURB)
    for x, y, make, heading in [
            (-26.5, 15.0, tree_b_geo, 0), (-15.5, 17.5, tree_a_geo, 100), (-5.5, 16.5, tree_b_geo, 40),
            (3.0, 18.0, tree_a_geo, 200), (10.0, 14.6, billboard_geo, 0), (19.5, 16.5, tree_a_geo, 300),
            (25.0, 14.0, tree_b_geo, 15), (31.0, 17.0, tree_a_geo, 60), (-33.0, 17.5, tree_a_geo, 150),
            (-38.0, 34.0, tree_b_geo, 0), (-24.0, 38.0, tree_a_geo, 70), (-9.0, 33.0, tree_a_geo, 10),
            (6.0, 40.0, tree_b_geo, 20), (21.0, 34.0, tree_a_geo, 250), (36.0, 39.0, tree_b_geo, 5),
            (48.0, 30.0, tree_a_geo, 120), (-50.0, 46.0, tree_a_geo, 30), (-30.0, 60.0, tree_b_geo, 0),
            (-4.0, 62.0, tree_a_geo, 190), (30.0, 64.0, tree_b_geo, 0), (58.0, 58.0, tree_a_geo, 45)]:
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
            g += at(taxi_geo(), (n - 1 - (n - 1) / 2) * pitch, y, 0)
    mb.node("vehicles", g)


def stretched_wreck(kind: str, color=None) -> mb.Geo:
    """The wreck as the game should draw it for a crushed vehicle of prop kind `kind`: scaled
    by WRECK_SCALE and, with a color, tinted with the vehicle's paint."""
    paint, fixed = wreck_parts()
    g = tinted(paint, fixed, color) if color else paint + fixed
    w, h, length = WRECK_SCALE[kind]
    return g.scale(w, length, h)


def build_wrecks() -> None:
    """Every vehicle, the stretched wreck it leaves in its own paint, and the same wreck
    untinted (what the game draws until wrecks get an instance color). Small in front."""
    mb.reset()
    rows = [("car_sedan", lambda: tinted(*sedan_parts(), "#e0372f"), "#e0372f"),
            ("car_taxi", taxi_geo, mb.palette.PALETTE["taxi_yellow"]),
            ("car_van", lambda: tinted(*van_parts(), "#9fe0c0"), "#9fe0c0"),
            ("truck", lambda: tinted(*truck_parts(), "#2f62c9"), "#2f62c9"),
            ("bus", lambda: tinted(*bus_parts(), "#3fa652"), "#3fa652")]
    g = mb.box((46, 34, 0.1), at=(0, 9.5, 0), anchor="top", color="road")
    for i, (kind, make, color) in enumerate(rows):
        y = i * 5.2
        g += at(make(), -13.5, y, 90, 0.02)
        g += at(stretched_wreck(kind, color), 0.0, y, 90, 0.02)
        g += at(stretched_wreck(kind), 13.5, y, 90, 0.02)
    mb.node("wrecks", g)


SCENE_OPTS = {
    "street": dict(backdrop="sky", size=(1600, 800), samples=16, sun_azimuth=-55, sun_elevation=48,
                   view=mb.View("", eye=(7.0, -56.0, 14.5), target=(0.0, 9.0, 4.2), fov=46)),
    "tints": dict(backdrop="studio", size=(1400, 900), samples=14, azimuth=22, elevation=34, fov=30),
    "wrecks": dict(backdrop="sky", size=(1400, 800), samples=14, sun_azimuth=-50, sun_elevation=46,
                   view=mb.View("", eye=(6.0, -31.0, 23.0), target=(-1.3, 9.6, 0.5), fov=46)),
}


def render_scenes(force: bool = False) -> None:
    """The street scene and the paint-color sheet, skipped when up to date."""
    with open(os.path.abspath(__file__), "rb") as f:
        src = hashlib.sha1(f.read()).hexdigest()
    for guest, *_ in STREET_GUESTS:                         # re-render when a guest model changes
        path = mb.contract.model_path(guest)
        if os.path.exists(path):
            src += mb._file_sha(path)
    jobs = [("street", build_street, os.path.join(mb.CONCEPT, "props_street.png")),
            ("tints", build_tints, os.path.join(mb.CONCEPT, "props_car_tints.png")),
            ("wrecks", build_wrecks, os.path.join(mb.CONCEPT, "props_wrecks.png"))]
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
            note = dict(TINT_NOTE, colors=colors)
            if asset_id in TINT_HINTS:
                note["hint"] = TINT_HINTS[asset_id]
            if asset_id == "prop_car_wreck":
                note["wreckScale"] = WRECK_SCALE
            man.data["models"][asset_id]["tint"] = note
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
