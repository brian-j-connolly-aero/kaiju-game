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
GLASS = "#33526f"               # vehicle glass: dark, so windows read on any paint color
GLASS_LT = "#4f7ba3"            # windshields catch more sky
TRIM = "#353842"                # bumpers, grilles, skirts
TIRE = "tire"
HUB = "grey_light"
HEADLIGHT = "#fff2c4"
TAILLIGHT = "#d92b2b"
DECAL = 0.03                    # flat details sit this far proud of the surface behind them

# Paint colors the game may tint each vehicle with (sRGB hex). No kaiju orange, human cyan or
# volley yellow: those belong to the color language.
TINTS = {
    "prop_car_sedan": ["#e0372f", "#2f62c9", "#f5f5f0", "#3fa652", "#8f6fd0", "#f29b85", "#2a9d8f", "#4a4d57"],
    "prop_car_van": ["#f5f5f0", "#2f62c9", "#e0372f", "#9fe0c0", "#b9a6e0"],
    "prop_bus": ["#d7263d", "#2f62c9", "#3fa652", "#f3e3b3"],
    "prop_truck": ["#2f62c9", "#e0372f", "#3fa652", "#f5f5f0", "#4a4d57"],
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
    """(paint, fixed) geometry of the sedan: 4.4 m long, 1.8 m wide, 1.42 m tall."""
    w = 1.76
    body = drop(slab([(-2.2, 0.30), (-2.2, 0.62), (-2.05, 0.80), (-0.85, 0.90), (1.35, 0.92), (2.15, 0.84),
                      (2.2, 0.62), (2.2, 0.30)], -w / 2, w / 2, paint), "bottom")
    cab = mb.tapered_box((1.66, 2.15), (1.36, 1.45), 0.50, at=(0, 0.225, 0.90), offset=(0, 0.05), color=GLASS,
                         cap_bottom=False)
    cab.paint(GLASS_LT, where=lambda c, n: n.y < -0.5)
    roof, glass = split(cab, flat_top)
    roof.paint(paint)
    fixed = lit(glass, seed=3)
    for y in (-2.25, 2.25):                                                   # chunky bumpers
        fixed += drop(mb.box((1.86, 0.16, 0.20), at=(0, y, 0.37), color=TRIM),
                      lambda c, n, y=y: n.z < -0.5 or n.y * y < -0.5)
    for x in (-0.6, 0.6):
        fixed += plate(0.38, 0.16, (x, -2.2 - DECAL, 0.54), "front", HEADLIGHT)
        fixed += plate(0.36, 0.14, (x, 2.2 + DECAL, 0.60), "back", TAILLIGHT)
    fixed += plate(0.66, 0.13, (0, -2.2 - DECAL, 0.54), "front", TRIM)          # grille
    fixed += axles((-1.36, 1.34), 0.34, 0.93)
    if taxi:
        fixed += drop(mb.box((0.50, 0.20, 0.17), at=(0, 0.25, 1.40), color="white", anchor="bottom"), "bottom")
        for s in (1, -1):                                                     # checker band on the doors
            for y in (-0.62, 0.0, 0.62):
                fixed += plate(0.31, 0.15, (s * (w / 2 + DECAL), y, 0.70), "left" if s > 0 else "right", "black")
    return lit(body + roof, seed=1), fixed


def van_parts(paint=PAINT):
    """(paint, fixed) geometry of the delivery van: 5.0 m long, 2.0 m wide, 2.12 m tall."""
    w = 1.96
    body = drop(slab([(-2.45, 0.32), (-2.45, 0.82), (-2.22, 1.08), (-1.72, 1.14), (2.45, 1.14), (2.45, 0.32)],
                     -w / 2, w / 2, paint), lambda c, n: n.z < -0.5 or (n.z > 0.95 and c.y > -1.0))
    cab = drop(mb.tapered_box((1.90, 1.30), (1.74, 0.85), 0.98, at=(0, -1.07, 1.14), offset=(0, 0.225), color=GLASS,
                              cap_bottom=False), "back")
    cab.paint(GLASS_LT, where=lambda c, n: n.y < -0.5)
    roof, glass = split(cab, flat_top)
    roof.paint(paint)
    cargo = drop(mb.box((w, 2.87, 0.98), at=(0, 1.015, 1.63), color=paint), lambda c, n: n.z < -0.5 or n.y < -0.5)
    fixed = lit(glass, seed=3)
    for y in (-2.49, 2.49):
        fixed += drop(mb.box((2.04, 0.16, 0.22), at=(0, y, 0.42), color=TRIM),
                      lambda c, n, y=y: n.z < -0.5 or n.y * y < -0.5)
    for x in (-0.68, 0.68):
        fixed += plate(0.36, 0.18, (x, -2.45 - DECAL, 0.68), "front", HEADLIGHT)
        fixed += plate(0.14, 0.46, (x * 1.26, 2.45 + DECAL, 0.92), "back", TAILLIGHT)
    fixed += plate(0.78, 0.15, (0, -2.45 - DECAL, 0.68), "front", TRIM)
    fixed += plate(1.20, 0.42, (0, 2.45 + DECAL, 1.72), "back", GLASS)          # rear door windows
    for s in (1, -1):                                                         # door mirrors
        fixed += drop(mb.box((0.16, 0.08, 0.22), at=(s * 1.05, -1.62, 1.36), color=TRIM), "right" if s > 0 else "left")
    fixed += axles((-1.55, 1.50), 0.36, 1.02)
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
            pillars += plate(0.16, 1.10, (s * w / 2, y, 2.0), "left" if s > 0 else "right", paint)
    skirt = drop(mb.box((w, length, 0.38), at=(0, 0, 0.51), color=TRIM), hidden)
    glass = drop(mb.box((w - 0.08, length - 0.08, 1.10), at=(0, 0, 2.0), color=GLASS), hidden)
    glass.paint(GLASS_LT, where="front")
    fixed = lit(skirt + glass, seed=3)
    fixed += drop(mb.box((1.5, 2.6, 0.20), at=(0, 1.2, 3.0), color="grey_light", anchor="bottom"), "bottom")   # roof unit
    for y in (-4.92, -0.45):                                                   # doors, right side
        fixed += plate(1.18, 2.02, (-(w / 2 + DECAL), y, 1.46), "right", mb.shade(GLASS, 0.75))
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
               lambda c, n: n.z < -0.5 or n.y > 0.5)
    windshield, cab = split(cab, lambda c, n: n.y < -0.5 and c.z > 1.4)
    windshield.paint(GLASS_LT)
    deflector = mb.wedge((2.2, 1.25, 0.62), at=(0, -3.2, 2.60), high="back", color=paint)
    w, y0, y1 = 2.5, -2.45, 4.2
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
    tint_node("prop_car_taxi", mb.Geo(), paint + fixed)        # a taxi is always yellow: nothing to tint


@mb.asset("prop_car_van", sheet=dict(extra=["top"]), concept=dict(azimuth=35, elevation=14))
def prop_car_van():
    tint_node("prop_car_van", *van_parts())


@mb.asset("prop_bus", sheet=dict(extra=["right", "top"]), concept=dict(azimuth=-40, elevation=14))
def prop_bus():
    tint_node("prop_bus", *bus_parts())


@mb.asset("prop_truck", sheet=dict(extra=["top"]), concept=dict(azimuth=38, elevation=14))
def prop_truck():
    tint_node("prop_truck", *truck_parts())


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
        x0, x1 = -1.25 + 0.5 * i, -0.75 + 0.5 * i
        g += mb.quad((x0, -1.72, lip), (x1, -1.72, lip), (x1, -0.9, top), (x0, -0.9, top),
                     color="red" if i % 2 == 0 else "white")
    g += mb.quad((-1.25, -0.9, wall), (1.25, -0.9, wall), (1.25, -1.72, lip), (-1.25, -1.72, lip), color="red_dk")
    g += mb.tri((1.25, -0.9, wall), (1.25, -0.9, top), (1.25, -1.72, lip), color="red_dk")
    g += mb.tri((-1.25, -0.9, top), (-1.25, -0.9, wall), (-1.25, -1.72, lip), color="red_dk")
    # posters on the side walls, a ball on the roof
    g += plate(0.9, 1.1, (1.2 + DECAL, 0.15, 1.35), "left", "bld_salmon")
    g += plate(0.9, 1.1, (-1.2 - DECAL, 0.15, 1.35), "right", "bld_sky")
    g += mb.icosphere(0.27, at=(0, 0.1, 2.86), color="red").jitter(0.08, seed=5)
    return g


def tree_a_geo() -> mb.Geo:
    """Street tree, 7 m: a round crown of three faceted lumps on a short trunk."""
    g = mb.prism(5, 0.24, 3.0, radius_top=0.15, color="trunk", cap_bottom=False, cap_top=False).jitter(0.08, seed=1)
    crown = mb.icosphere(2.0, at=(0, 0, 4.55), color="leaf").scale(1.0, 1.0, 0.92, about=(0, 0, 4.55))
    crown += mb.icosphere(1.45, at=(0.55, 0.35, 5.5), color="leaf").rz(40, about=(0.55, 0.35, 5.5))
    crown += mb.icosphere(1.25, at=(-0.75, -0.45, 5.15), color="leaf").rz(15, about=(-0.75, -0.45, 5.15))
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
    g = mb.prism(6, 0.20, 0.55, radius_top=0.11, color=post, cap_bottom=False, cap_top=False)
    g += mb.prism(5, 0.075, 5.25, radius_top=0.05, at=(0, 0, 0.55), color=post, cap_bottom=False)
    g += mb.box((1.0, 0.07, 0.07), at=(0, 0, 5.45), color=post)
    g += mb.cone(4, 0.09, 0.22, at=(0, 0, 5.78), color=post, cap_bottom=False)
    lit(g, seed=8, amount=0.05)
    for x in (-0.42, 0.42):
        lantern = mb.tapered_box((0.20, 0.20), (0.30, 0.30), 0.30, at=(x, 0, 5.08), color="glow_lamp", mat="glow")
        lantern.paint(post, where="top").material("vcol", where="top")
        g += lantern
    return g


def trafficlight_geo() -> mb.Geo:
    """Traffic light, 5 m: one four-sided head on a post, so it works at any heading."""
    post, housing = "#3d4350", "#22252d"
    g = mb.prism(6, 0.19, 0.5, radius_top=0.10, color=post, cap_bottom=False, cap_top=False)
    g += mb.prism(5, 0.075, 2.95, at=(0, 0, 0.5), color=post, cap_bottom=False, cap_top=False)
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
    steel = "grey_dark"
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
    g += drop(mb.box((4.0, 0.06, 1.95), at=(0, 0.66, 0.48), color="#a8d2e6", anchor="bottom"), "top")   # glass back
    end = drop(mb.box((0.08, 1.25, 1.95), at=(-1.96, 0.02, 0.48), color=frame, anchor="bottom"), "top")
    end.paint("bld_salmon", where="left").paint("bld_mustard", where="right")
    g += end
    g += mb.beam((1.96, -0.60, 0), (1.96, -0.60, 2.44), (0.08, 0.08), color=frame, cap_start=False, cap_end=False)
    g += mb.box((2.7, 0.40, 0.08), at=(0.25, 0.40, 0.50), color="wood")                  # bench
    lit(g, seed=12)
    # stop sign: a disc on a pole at the open end, a bus pictogram on both faces
    g += mb.rod((2.02, -0.60, 2.44), (2.02, -0.60, 2.50), 0.035, n=4, color="grey_dark", cap_start=False)
    for facing, y in (("front", -0.63), ("back", -0.57)):
        disc = [(2.02 + 0.30 * math.cos(a), y, 2.56 + 0.30 * math.sin(a))
                for a in (math.radians(22.5 + 45 * k) for k in range(8))]
        g += mb.polygon(disc if facing == "front" else disc[::-1], color=frame)
        g += plate(0.34, 0.20, (2.02, y - 0.012 if facing == "front" else y + 0.012, 2.57), facing, "white")
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


if __name__ == "__main__":
    argv = sys.argv[1:]
    code = mb.run_family("props", argv)
    man = mb.Manifest("props")
    for asset_id, colors in TINTS.items():
        if asset_id in man.data.get("models", {}):
            man.data["models"][asset_id]["tint"] = dict(TINT_NOTE, colors=colors)
    man.write()
    raise SystemExit(code)
