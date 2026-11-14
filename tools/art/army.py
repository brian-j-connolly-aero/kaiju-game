#!/opt/mbtools/venv/bin/python
# mb-family: army
"""Army (Tier 1) models: the main battle tank, its burnt wreck and the three projectiles.

    /opt/mbtools/venv/bin/python tools/art/army.py                  build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/army.py --no-previews    geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/army.py --only army_tank
    /opt/mbtools/venv/bin/python tools/art/army.py --scenes-only    just the scene shots and the portrait

Writes, per docs/ASSETS.md section 3 "Army":
    client/public/assets/models/army_tank.glb          nodes hull > (turret > barrel > muzzle), track_L, track_R
    client/public/assets/models/army_tank_wreck.glb    one burnt mesh
    client/public/assets/models/proj_rocket.glb, proj_shell.glb, proj_arty.glb
    client/public/assets/manifest.army.json
    client/public/assets/ui/portrait_army.png          512 px faction portrait (transparent background)
    docs/art/previews/<id>.png, docs/art/concept/<id>.png, docs/art/concept/army_platoon.png,
    docs/art/concept/army_kaiju_eye_sunset.png, army_kaiju_eye_night.png   the kaiju's view of the army
    docs/art/concept/portrait_army.png                 the portrait on the game's panel color, at menu sizes

The tank is a chunky, slightly toy-like main battle tank: olive, with cyan identification
marks that glow (a wide glacis band, turret sides, side skirts) and a solid glowing cyan disc
on the turret roof, so it reads as "human" from a kaiju's eye view high above at sunset and at
night, the only times tanks are on the field (humans are cyan circles in the color language).
The gun tube is khaki, not track-dark, so the kaiju can see where it points against asphalt.
The muzzle sits 2.30 m up, the height the simulation fires shells and lasers from
(shared/src/defs/units.ts, muzzleHeight).

The kaiju can pick a tank or its wreck up, hold it and throw it, so both are closed from every
side: check the FROM BELOW cell of their sheets (magenta = a hole in the game).
Everything is in meters; the front of every model is -Y while authoring (see README.md).
"""
import hashlib
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import mb  # noqa: E402
import mb_preview  # noqa: E402

OLIVE = "army_olive"
OLIVE_DK = "army_olive_dk"
KHAKI = "army_khaki"
STEEL = "army_track"          # tracks, muzzle brake, exhausts
CYAN = "human_cyan"

# Joints of the tank, in model space (authoring frame). The game rotates `turret` around the
# vertical axis through TURRET_PIVOT and `barrel` around the left-right axis through
# BARREL_PIVOT; `muzzle` is where shells leave.
DECK = 1.68                            # height of the hull deck
ROOF = 2.90                            # height of the turret roof
GUN = 2.30                             # height of the bore: the simulation's muzzleHeight for both tank units
TURRET_PIVOT = (0.0, 0.10, DECK)       # center of the turret ring, on the hull deck
BARREL_PIVOT = (0.0, -1.20, GUN)       # trunnion, just inside the turret front
MUZZLE = (0.0, -4.90, GUN)
DECAL = 0.03                           # flat marks sit this far proud of the plate behind them


# ---- small helpers ------------------------------------------------------------------------
KEEP_HIDDEN = False       # the wreck is dented, which opens gaps: there nothing may be left out


def drop(g: mb.Geo, where) -> mb.Geo:
    """A copy of `g` without the selected faces (faces nobody can see cost triangles)."""
    if KEEP_HIDDEN:
        return g
    gone = set(g.select(where))
    out = mb.Geo()
    for i, f in enumerate(g.f):
        if i not in gone:
            out.face([g.v[k] for k in f], g.col[i], g.mat[i], g.uv[i])
    return out


def slab(outline, x0: float, x1: float, color, cap0: bool = True, cap1: bool = True) -> mb.Geo:
    """A side-view outline [(y, z), ...] extruded from x0 to x1 (x1 > x0)."""
    return mb.loft([[(x0, y, z) for y, z in outline], [(x1, y, z) for y, z in outline]], color=color,
                   cap_start=cap0, cap_end=cap1)


def trap(y: float, w_bottom: float, w_top: float, z0: float, z1: float):
    """A cross-section for mb.loft: a trapezoid facing along the body at depth y."""
    return [(-w_bottom / 2, y, z0), (w_bottom / 2, y, z0), (w_top / 2, y, z1), (-w_top / 2, y, z1)]


def finish(g: mb.Geo, seed: int, amount: float = 0.04) -> mb.Geo:
    """Painted-in sky light and a little facet variation, so flat olive still reads as facets."""
    return g.bake_light(top=1.07, bottom=0.74).jitter(amount, seed=seed)


# ---- the tank, as loose geometry (so the wreck and the scene shots can reuse it) --------------
ROAD_WHEELS = (-1.96, -0.98, 0.0, 0.98, 1.96)


def mark(g: mb.Geo, where=None) -> mb.Geo:
    """Turn faces into identification marks: human cyan, glowing, so they still read at night.
    (The anchor color, not glow_cyan or glow_weak: that pale cyan is the kaiju's weak point.)"""
    return g.glow(CYAN, where)


def side_plate(w: float, h: float, at, outward: float, color) -> mb.Geo:
    """A flat rectangle on a side wall, facing the model's left (outward 1) or right (-1)."""
    x, y, z = at
    pts = [(x, y - w / 2, z - h / 2), (x, y + w / 2, z - h / 2), (x, y + w / 2, z + h / 2), (x, y - w / 2, z + h / 2)]
    return mb.polygon(pts if outward > 0 else pts[::-1], color=color)


def wheel(radius: float, outward: float = 1.0, hub: bool = False, n: int = 8, color=OLIVE) -> mb.Geo:
    """A dished disc (a shallow n-sided cone) facing the model's left, or its right, all
    turned the same way; road wheels get a dark hub cap. Its back is open, except on the wreck."""
    g = mb.cone(n, radius, 0.10, color=color, cap_bottom=KEEP_HIDDEN).ry(90 * outward)
    g.bake_light(top=1.10, bottom=0.62).jitter(0.02, seed=4)
    if hub:
        r, x = radius * 0.30, outward * 0.105
        pts = [(x, -r, 0), (x, 0, -r), (x, r, 0), (x, 0, r)]
        g += mb.polygon(pts if outward > 0 else pts[::-1], color=STEEL)
    return g


def track_left(hubs: bool = True) -> mb.Geo:
    """The left track: belt, five road wheels, idler (front) and drive sprocket (rear)."""
    belt = [(-3.02, 0.70), (-2.70, 1.08), (2.64, 1.08), (2.96, 0.72), (2.96, 0.46), (2.48, 0.0),
            (-2.42, 0.0), (-3.02, 0.40)]
    g = slab(belt, 1.10, 1.82, STEEL)
    g.paint(mb.shade(STEEL, 0.72), where="left")
    g.jitter(0.10, seed=3, where=lambda c, n: abs(n.x) < 0.5)   # belt segments differ a little
    for y in ROAD_WHEELS:
        g += wheel(0.43, hub=hubs).move(1.82, y, 0.44)
    for y, z in ((-2.62, 0.70), (2.58, 0.72)):
        g += wheel(0.30, n=6, color=OLIVE_DK).move(1.82, y, z)
    return g


def hull_geo(wreck: bool = False) -> mb.Geo:
    """wreck=True closes the right side (its track and skirt are gone there)."""
    # upper hull: a wedge-nosed slab that sits on the tracks. Two bands of the glacis (0.8 m,
    # right across the nose and round onto the hull sides) are the identification stripe.
    sections = [(-3.10, 3.34, 1.24), (-2.62, 3.60, 1.42), (-2.22, 3.60, 1.56), (-1.85, 3.60, DECK),
                (2.72, 3.60, DECK), (3.00, 3.44, 1.46)]
    rings = [trap(y, w, w, 1.04, top) for y, w, top in sections]
    g = mb.loft(rings, colors=[OLIVE, CYAN, CYAN, OLIVE, OLIVE])
    stripe = g.select(lambda c, n: -2.62 < c.y < -1.85)
    # lower hull between the tracks: only the nose plate, belly and tail plate can be seen. Its
    # top corners stay inside the outline of the tracks, so no gap opens above their sloped ends.
    g += drop(slab([(-2.70, 1.04), (-2.50, 0.44), (2.50, 0.44), (2.64, 1.04)], -1.10, 1.10, OLIVE_DK,
                   cap0=wreck, cap1=wreck), "top")
    # side skirts with an identification stripe each
    marks = mb.Geo()
    for s in ((1,) if wreck else (1, -1)):
        g += drop(mb.box((0.10, 4.5, 0.52), at=(s * 1.87, 0.0, 0.98), color=OLIVE), "right" if s > 0 else "left")
        if not wreck:                    # (burnt off the wreck)
            marks += side_plate(0.60, 0.52, (s * (1.92 + DECAL), -0.45, 0.98), s, CYAN)
    # exhausts on the tail plate
    for x in (-0.95, 0.95):
        g += drop(mb.box((0.36, 0.22, 0.30), at=(x, 3.02, 1.26), color=STEEL), "front")
    finish(g, seed=11)
    mark(g, where=stripe)
    g += mark(marks)
    # engine deck: three louvres, flat on the deck (the gun sweeps over them when it points aft)
    for y in (() if wreck else (1.42, 1.90, 2.38)):
        g += mb.quad((-1.25, y - 0.15, DECK + DECAL), (1.25, y - 0.15, DECK + DECAL), (1.25, y + 0.15, DECK + DECAL),
                     (-1.25, y + 0.15, DECK + DECAL), color=mb.shade(OLIVE, 0.5))
    # tail lights
    for x in (() if wreck else (-1.48, 1.48)):
        lamp = drop(mb.box((0.26, 0.10, 0.16), at=(x, 2.98, 1.24), color=STEEL), "front")
        lamp.glow("glow_red", where="back")
        g += lamp
    # headlights: little housings on the nose with glowing lenses
    for x in (-1.34, 1.34):
        lamp = drop(mb.box((0.38, 0.26, 0.24), at=(x, -2.80, 1.30), color=OLIVE_DK, anchor="bottom"), "bottom")
        lamp.glow("glow_lamp", where="front")
        g += lamp
    return g


CUPOLA = (-0.55, 0.85)                 # the commander's hatch, off to the right rear of the roof disc


def turret_geo(wreck: bool = False) -> mb.Geo:
    z0 = DECK
    rings = [trap(-1.30, 1.80, 1.30, z0, 2.56), trap(-0.60, 2.80, 2.25, z0, ROOF),
             trap(1.05, 2.80, 2.25, z0, ROOF), trap(1.40, 2.80, 2.25, z0, ROOF),
             trap(1.85, 2.20, 1.70, z0, 2.76)]
    # The floor is hidden by the deck, except under the bustle: at some yaws its rear corners
    # hang over the hull sides, so the last two bands keep theirs.
    g = drop(mb.loft(rings, color=OLIVE), lambda c, n: n.z < -0.5 and c.y < 1.05)
    # identification stripe, on the turret sides only: the roof belongs to the disc
    stripe = g.select(lambda c, n: 1.05 < c.y < 1.40 and abs(n.x) > 0.5)
    # stowage box on the bustle
    g += drop(mb.box((1.6, 0.34, 0.40), at=(0, 1.96, 2.32), color=KHAKI), "front")
    # smoke dischargers on the turret cheeks (closed underneath: they hang clear of the turret)
    for sx in (1, -1):
        g += mb.box((0.30, 0.38, 0.30), at=(sx * 1.14, -0.92, 2.36), color=STEEL).rz(-sx * 34, about=(sx * 1.14, -0.92, 2.36))
    finish(g, seed=21)
    mark(g, where=stripe)
    # roof roundel: a solid glowing cyan disc, the first thing the kaiju sees from above. (Not
    # on the wreck: the mark is gone, and so thin a plate would buckle through the roof.)
    if not wreck:
        g += mark(mb.prism(8, 0.98, 0.06, at=(0, 0.40, ROOF), cap_bottom=False))
    cx, cy = CUPOLA
    cup = mb.prism(6, 0.30, 0.36, radius_top=0.25, at=(cx, cy, ROOF - 0.04), color=OLIVE_DK, cap_bottom=wreck)
    cup.paint(OLIVE, where="top")
    g += finish(cup, seed=22)
    if wreck:
        return g                        # machine gun burnt off
    # machine gun: a chunky block on the cupola, pointing forward
    g += finish(mb.box((0.16, 0.80, 0.18), at=(cx, cy - 0.42, ROOF + 0.06 + 0.24), color=STEEL), seed=23)
    return g


def barrel_geo() -> mb.Geo:
    """The gun. The tube is khaki, lighter than the hull and far lighter than the road, and
    thick: from above it is what tells the kaiju where a tank is aiming."""
    z = BARREL_PIVOT[2]
    g = finish(drop(mb.box((1.06, 0.50, 0.50), at=(0, -1.42, z), color=OLIVE_DK), "back"), seed=31)   # mantlet
    g += mb.rod((0, -1.60, z), (0, -4.60, z), 0.20, n=6, color=KHAKI, cap_start=False, cap_end=False)
    g += mb.rod((0, -2.80, z), (0, -3.55, z), 0.28, n=6, color=OLIVE)                    # fume extractor
    brake = mb.rod((0, -4.42, z), (0, MUZZLE[1], z), 0.28, n=6, color=mb.shade(STEEL, 1.35))   # muzzle brake: gunmetal
    brake.paint("black", where="front")
    g += brake
    return g.bake_light(top=1.1, bottom=0.75)


def tank_geos(wreck: bool = False) -> dict:
    global KEEP_HIDDEN
    KEEP_HIDDEN = wreck
    try:
        left = track_left(hubs=not wreck)
        return {"hull": hull_geo(wreck), "turret": turret_geo(wreck), "barrel": barrel_geo(), "track_L": left,
                "track_R": left.mirrored()}
    finally:
        KEEP_HIDDEN = False


def posed_tank(turret_yaw: float = 0.0, barrel_pitch: float = 0.0) -> mb.Geo:
    """The whole tank as one piece of geometry with the turret turned (degrees, positive = to
    its left) and the gun raised (degrees, positive = up). For scene shots and the wreck."""
    p = tank_geos()
    barrel = p["barrel"].rx(-barrel_pitch, about=BARREL_PIVOT)
    top = (p["turret"] + barrel).rz(turret_yaw, about=TURRET_PIVOT)
    return p["hull"] + p["track_L"] + p["track_R"] + top


TANK_POSE = {"turret": {"y": 32}, "barrel": {"x": -14}}
# The kaiju holds and throws tanks and wrecks: their sheets show the underside. (A flat view,
# because the perspective cells stand on a ground disc that would hide it.)
BELOW = mb.View("FROM BELOW", azimuth=35, elevation=-40, ortho=True)


@mb.asset("army_tank", kind="vehicle",
          sheet=dict(extra=["top",
                            mb.View("KAIJU'S EYE VIEW", azimuth=25, elevation=58, fov=24),
                            mb.View("POSED: turret.y = 32, barrel.x = -14", azimuth=-40, elevation=14, fov=28,
                                    pose=TANK_POSE),
                            BELOW,
                            mb.View("FROM BELOW, turret.y = 58", azimuth=215, elevation=-40, ortho=True,
                                    pose={"turret": {"y": 58}})]),
          concept=[dict(backdrop="sunset", azimuth=38, elevation=11, pose={"turret": {"y": -24}, "barrel": {"x": -9}}),
                   dict(name="night", backdrop="night", azimuth=-150, elevation=24,
                        pose={"turret": {"y": -24}, "barrel": {"x": -10}})])
def army_tank():
    """Main battle tank, 8.0 m long with the gun, 3.9 m wide, 2.9 m to the turret roof and 3.3 m
    to the top of the cupola. The gun is 2.30 m up: the simulation's muzzleHeight."""
    p = tank_geos()
    hull = mb.node("hull", p["hull"])
    mb.node("track_L", p["track_L"], pivot=(1.46, 0, 0.54), parent=hull)
    mb.node("track_R", p["track_R"], pivot=(-1.46, 0, 0.54), parent=hull)
    turret = mb.node("turret", p["turret"], pivot=TURRET_PIVOT, parent=hull)
    barrel = mb.node("barrel", p["barrel"], pivot=BARREL_PIVOT, parent=turret)
    mb.empty("muzzle", at=MUZZLE, parent=barrel)


# ---- the wreck --------------------------------------------------------------------------------
def crumple(g: mb.Geo, amount: float, seed: int = 1, rough: float = 0.018) -> mb.Geo:
    """Buckle the geometry. Every point moves by an amount that depends only on where it is, so
    faces that shared a corner still meet. Most of the movement is a slow warp (a few waves two
    to four meters long), so thin plates bend instead of turning inside out; `rough` adds a
    little per-corner denting on top. Bent quads are then split into facets."""
    rng = random.Random(seed)

    def unit():
        return mb.Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()

    waves = [(unit() * rng.uniform(1.6, 3.1), rng.uniform(0.0, math.tau), unit()) for _ in range(5)]

    def push(p):
        d = mb.Vector((0.0, 0.0, 0.0))
        for k, phase, direction in waves:
            d += direction * math.sin(k.dot(p) + phase)
        local = random.Random(f"{seed}:{round(p.x, 3)}:{round(p.y, 3)}:{round(p.z, 3)}")
        dent = mb.Vector((local.uniform(-1, 1), local.uniform(-1, 1), local.uniform(-1, 1)))
        return d * (amount / 2.0) + dent * rough

    for p in g.v:
        p += push(p)
    return g.triangulate()


def burn(g: mb.Geo, hits, seed: int = 1) -> mb.Geo:
    """Repaint as a burnt-out hulk the kaiju can find on dark asphalt: pale warm ash on every
    plate that looks up, grey-brown scorched steel on the sides, rust in patches, and black
    soot only close to `hits`, the points where it was struck. Nothing glows any more and the
    cyan is all but gone: destroyed things are rubble grey in the color language, and cyan
    means a live human."""
    rng = random.Random(seed)
    cyan = mb.palette.rgb(CYAN)
    ash, steel, soot, rust = (mb.palette.rgb(c) for c in ("#b0ada5", "#857f76", "#17130f", "#6a3d24"))

    def blend(a, b, t):
        return tuple(x + (y - x) * t for x, y in zip(a, b))

    def repaint(col, center, normal):
        near = min((center - mb.V(h)).length for h in hits)
        heat = max(0.0, 1.0 - near / 1.6) ** 1.5                       # 1 at a hit, 0 from 1.6 m
        base = blend(steel, ash, max(normal.z, 0.0) ** 0.6)            # ash settles on upward faces
        base = blend(base, rust, 0.8 * rng.random() ** 3.5)            # one roll per face: a rusty patch
        is_cyan = max(abs(a - b) for a, b in zip(col, cyan)) < 0.2
        keep = (0.07 if is_cyan else 0.16) * rng.uniform(0.5, 1.0)     # the ghost of the paint
        out = blend(blend(base, col, keep), soot, min(1.0, heat * 1.3))
        shade = (1.0 - 0.22 * max(-normal.z, 0.0)) * rng.uniform(0.93, 1.05)
        return tuple(min(1.0, c * shade) for c in out)

    g.material("vcol")
    return g.recolor(repaint)


@mb.asset("army_tank_wreck", kind="vehicle", sheet=dict(extra=["top", BELOW]),
          concept=dict(backdrop="sunset", azimuth=-38, elevation=13))
def army_tank_wreck():
    mb.node("army_tank_wreck", wreck_geo())


def wreck_geo() -> mb.Geo:
    """What is left of a tank: turret blown off its ring and dug into the deck, gun on the
    ground, right track thrown, everything burnt. One mesh, about the footprint of the tank."""
    p = tank_geos(wreck=True)
    roll = dict(about=(1.46, 0, 0))                  # the hull has dropped onto its bare right side
    body = (p["hull"] + p["track_L"]).ry(5.0, **roll)
    stubs = mb.Geo()
    for y in ROAD_WHEELS:                            # bare road wheels where the right track was
        stubs += mb.cone(6, 0.43, 0.10, color=OLIVE_DK).ry(-90).move(-1.10, y, 0.44)
    stubs.ry(5.0, **roll)
    # turret and gun: off the ring, twisted, tipped forward and to the right, gun drooping
    top = p["turret"] + p["barrel"].rx(9, about=BARREL_PIVOT)
    top.rz(-48, about=TURRET_PIVOT).ry(15, about=TURRET_PIVOT).rx(9, about=TURRET_PIVOT).move(-0.35, 0.25, -0.22)
    # the thrown track: its belt lies flat along the right side, half under the hull
    belt = [(-3.0, 0.0), (-3.0, 0.10), (0.2, 0.26), (3.05, 0.30), (3.15, 0.16), (2.9, 0.0)]
    thrown = slab(belt, -0.36, 0.36, STEEL).rz(-7).move(-1.72, 0.35, 0)
    g = body + stubs + top + thrown
    crumple(g, 0.11, seed=5)
    burn(g, hits=[(-0.7, -0.2, 2.4), (-1.6, 1.4, 1.2), (0.6, 2.6, 1.6)], seed=7)
    return g.on_ground()


# ---- projectiles: tiny and simple, the glow comes from sprites ----------------------------------
def fins(span: float, root: float, y_tail: float, color, thick: float = 0.06) -> mb.Geo:
    """Four tail fins in a cross. Each is a wedge, `thick` wide where it leaves the body and
    tapering to its tip, so it is never a hairline edge-on: 4 triangles (the root is inside
    the body and left out)."""
    t = thick / 2
    pts = [mb.V(0.0, y_tail - root, -t), mb.V(0.0, y_tail - root, t), mb.V(0.0, y_tail, t), mb.V(0.0, y_tail, -t),
           mb.V(span, y_tail + 0.02, 0.0)]
    middle = sum(pts, mb.V(0, 0, 0)) / len(pts)
    fin = mb.Geo()
    for idx in ((0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)):
        face = [pts[i] for i in idx]
        outward = (face[1] - face[0]).cross(face[2] - face[0]).dot(sum(face, mb.V(0, 0, 0)) / 3 - middle) > 0
        fin.face(face if outward else face[::-1], color)
    g = mb.Geo()
    for k in range(4):
        g += fin.copy().ry(90 * k + 45)
    return g


def spun(profile, colors, n: int = 6) -> mb.Geo:
    """A body of revolution lying along the flight direction: profile is [(radius, along), ...]
    from tail to nose; the nose ends up at -Y, the model's front."""
    return mb.lathe(profile, n=n, colors=colors).rx(90)


@mb.asset("proj_rocket", concept=dict(backdrop="studio", azimuth=55, elevation=18))
def proj_rocket():
    """Shoulder-launched rocket, 1.2 m: thin tail, fat warhead with a pale nose."""
    g = spun([(0.045, -0.60), (0.045, -0.12), (0.115, 0.02), (0.115, 0.26), (0.075, 0.46), (0.0, 0.60)],
             [OLIVE_DK, OLIVE, CYAN, "white", "grey_light"])
    g += fins(0.17, 0.26, 0.60, STEEL)
    mb.node("proj_rocket", g.bake_light(1.08, 0.8))


@mb.asset("proj_shell", concept=dict(backdrop="studio", azimuth=55, elevation=18))
def proj_shell():
    """Tank shell in flight, 0.9 m: no cartridge case (that stayed in the gun), a dark olive
    body with a boat tail and a glowing tracer in its base, cyan driving band, pale nose."""
    g = spun([(0.06, -0.45), (0.10, -0.31), (0.10, -0.03), (0.10, 0.13), (0.065, 0.33), (0.0, 0.45)],
             [OLIVE_DK, OLIVE_DK, CYAN, "white", "grey_light"])
    g.bake_light(1.08, 0.8)
    g.glow("glow_amber", where="back")                 # the tracer: only the base cap looks straight back
    mb.node("proj_shell", g)


@mb.asset("proj_arty", concept=dict(backdrop="studio", azimuth=55, elevation=18))
def proj_arty():
    """Artillery round, 1.5 m: a fat finned bomb that reads as "incoming" in silhouette."""
    g = spun([(0.055, -0.75), (0.055, -0.30), (0.18, -0.04), (0.18, 0.22), (0.115, 0.55), (0.0, 0.75)],
             [STEEL, OLIVE, CYAN, OLIVE, "white"])
    g += fins(0.21, 0.30, 0.75, STEEL)
    mb.node("proj_arty", g.bake_light(1.08, 0.8))


# ---- scene shots: the platoon, the faction portrait, and the kaiju's view of the army -------------
def game_hfov(vertical_fov: float, aspect: float = 16 / 9) -> float:
    """The game gives its cameras a vertical field of view; the kit wants the horizontal one."""
    return math.degrees(2 * math.atan(math.tan(math.radians(vertical_fov) / 2) * aspect))


SCENE_OPTS = {
    "platoon": dict(backdrop="sunset", size=(1280, 720), samples=16, sun_azimuth=-68, sun_elevation=20,
                    view=mb.View("", eye=(-11.0, -29.0, 3.0), target=(0.6, 0.0, 1.9), fov=40)),
    # Low and close from the front left: the hull runs out of the frame, the gun comes out of it
    # past the viewer with the muzzle brake inside the top left corner. The key light is on the
    # side with the wheels; the cyan rim comes square from the camera's left, into the mouth of
    # the gun and onto the nose and the track fronts.
    "portrait": dict(backdrop=None, size=(512, 512), samples=24, sun_azimuth=85, sun_elevation=30,
                     view=mb.View("", eye=(4.476, -6.210, 2.467), target=(0.55, -1.85, 1.85), fov=46)),
    # What the kaiju player sees, at the size the game shows it (1280 x 720, the kaiju camera's
    # 72 degree lens): tanks only exist at sunset (stage 2, eye 28 m up) and at night (stage 3,
    # eye 100 m up), always on asphalt. The cyan must be the first thing seen.
    "eye_sunset": dict(backdrop="sunset", size=(1280, 720), samples=12, sun_azimuth=-60, sun_elevation=24,
                       view=mb.View("", eye=(30.0, -34.0, 28.0), target=(0.0, 3.0, 0.0), fov=game_hfov(72))),
    "eye_night": dict(backdrop="night", size=(1280, 720), samples=12, sun_azimuth=-60, sun_elevation=40,
                      view=mb.View("", eye=(95.0, -105.0, 100.0), target=(0.0, 3.0, 0.0), fov=game_hfov(72))),
}
# The portrait is lit harder than the review shots: warm key, strong cyan rim, and enough fill
# that the gun and the running gear do not sink into the dark panel behind it. The glow is
# turned down so the identification marks print as the anchor cyan, not as white.
PORTRAIT_LIGHT = dict(key=("#ffe2b8", 3.4), rim=("#59e0ff", 6.5), ambient=0.45, glow=1.2)
UI_PANEL = "#0e121e"                   # the panel the portrait sits on in the game


def street(length: float = 400.0) -> mb.Geo:
    """A 15 m road with lane paint, curbs and sidewalks, running away from the camera."""
    road = mb.box((15, length, 0.1), at=(0, 80, 0), anchor="top", color="road")
    for x in (-0.12, 0.12):                                       # double center line
        road += mb.box((0.14, length, 0.02), at=(x * 1.6, 80, 0.0), color="volley_yellow_lt", anchor="bottom")
    for x in (-3.9, 3.9):                                         # dashed lane lines
        for k in range(-9, 40):
            road += mb.box((0.16, 2.6, 0.02), at=(x, k * 6.0, 0.0), color="white", anchor="bottom")
    for s in (1, -1):
        road += mb.box((0.3, length, 0.2), at=(s * 7.65, 80, 0), color="grey_light", anchor="bottom")    # curb
        road += mb.box((5, length, 0.18), at=(s * 10.3, 80, 0), color="sidewalk", anchor="bottom")
    return road


def build_platoon() -> None:
    """Four tanks in a wedge coming down a street at dusk, guns up."""
    mb.reset()
    mb.node("ground", street())
    spots = [((1.6, -7.0), 0, 16, 10), ((-3.3, 2.5), 0, 30, 5), ((3.5, 12.5), 0, -12, 14), ((-4.1, 24.0), 0, 8, 7)]
    for i, ((x, y), heading, yaw, pitch) in enumerate(spots):
        mb.node(f"tank_{i}", posed_tank(yaw, pitch).rz(heading).move(x, y, 0))


def build_portrait() -> None:
    mb.reset()
    mb.node("tank", posed_tank(22, 10))


def build_kaiju_eye() -> None:
    """A tank troop of three and two wrecks on a street: the kaiju's side of the army."""
    mb.reset()
    lift = 0.06                                    # keeps the scene clear of the backdrop's own floor
    ground = street(900.0).move(0, 0, lift)
    ground += mb.box((900, 900, 0.1), at=(0, 80, lift - 0.03), anchor="top", color="grass")
    mb.node("ground", ground)
    spots = [((-3.4, -4.0), 4, 35, 12), ((3.6, -0.5), -3, 20, 20), ((-3.0, 8.5), 0, -40, 8)]
    for i, ((x, y), heading, yaw, pitch) in enumerate(spots):
        mb.node(f"tank_{i}", posed_tank(yaw, pitch).rz(heading).move(x, y, lift))
    mb.node("wreck_0", wreck_geo().rz(28).move(4.2, 12.5, lift))
    mb.node("wreck_1", wreck_geo().rz(-115).move(-1.0, -17.0, lift))


def inset(path: str, zoom: int = 3, part: float = 0.14) -> None:
    """Paste an enlarged copy of the middle of the picture (where the tanks are) into its lower
    left corner, pixel for pixel, so a reviewer can see what a few game pixels hold."""
    from PIL import Image, ImageDraw
    from PIL.PngImagePlugin import PngInfo

    im = Image.open(path)
    meta = PngInfo()
    if im.info.get("mb_stamp"):
        meta.add_text("mb_stamp", im.info["mb_stamp"])
    im = im.convert("RGB")
    w, h = im.size
    cw, ch = round(w * part), round(h * part)
    box = (w // 2 - cw // 2, h // 2 - ch // 2, w // 2 - cw // 2 + cw, h // 2 - ch // 2 + ch)
    big = im.crop(box).resize((cw * zoom, ch * zoom), Image.NEAREST)
    d = ImageDraw.Draw(im)
    d.rectangle(box, outline=(255, 255, 255))
    x, y = 14, h - big.height - 14
    im.paste(big, (x, y))
    d.rectangle((x - 1, y - 1, x + big.width, y + big.height), outline=(255, 255, 255))
    im.save(path, pnginfo=meta)


def review_copy(portrait: str, out: str) -> None:
    """The transparent portrait on the game's panel color at the sizes the menus show it (512,
    216, 128 and 64 px), for docs/art/concept. The game gets the cut-out."""
    from PIL import Image

    fg = Image.open(portrait).convert("RGBA")
    panel = tuple(round(255 * c) for c in mb.palette.hex_to_rgb(UI_PANEL)) + (255,)
    sizes, gap = (512, 216, 128, 64), 20
    sheet = Image.new("RGBA", (sum(sizes) + gap * (len(sizes) + 1), sizes[0] + 2 * gap),
                      tuple(round(255 * c) for c in mb.palette.hex_to_rgb("#161c2b")) + (255,))
    x = gap
    for size in sizes:
        card = Image.new("RGBA", (size, size), panel)
        card.alpha_composite(fg.resize((size, size), Image.LANCZOS))
        sheet.paste(card, (x, gap))
        x += size + gap
    sheet.convert("RGB").save(out)


def render_scenes(force: bool = False) -> None:
    """The platoon shot, the 512 px faction portrait and the two kaiju's-eye shots, skipped
    when up to date."""
    with open(os.path.abspath(__file__), "rb") as f:
        src = hashlib.sha1(f.read()).hexdigest()
    jobs = [("platoon", build_platoon, os.path.join(mb.CONCEPT, "army_platoon.png")),
            ("portrait", build_portrait, os.path.join(mb.ASSETS, "ui", "portrait_army.png")),
            ("eye_sunset", build_kaiju_eye, os.path.join(mb.CONCEPT, "army_kaiju_eye_sunset.png")),
            ("eye_night", build_kaiju_eye, os.path.join(mb.CONCEPT, "army_kaiju_eye_night.png"))]
    studio = dict(mb_preview.BACKDROPS["studio"])
    for name, build, out in jobs:
        opts = SCENE_OPTS[name]
        stamp = f"{mb_preview.PREVIEW_VERSION}|{src}|{opts!r}"
        if not force and mb._stamp_ok(out, stamp):
            continue
        build()
        if name == "portrait":
            mb_preview.BACKDROPS["studio"].update(PORTRAIT_LIGHT)
        try:
            mb.concept(name, out=out, stamp=stamp, **opts)
        finally:
            mb_preview.BACKDROPS["studio"] = dict(studio)
        print(f"  scene: {os.path.relpath(out, mb.REPO)}")
        if name == "portrait":
            review_copy(out, os.path.join(mb.CONCEPT, "portrait_army.png"))
        if name.startswith("eye_"):
            inset(out, zoom=5, part=0.08) if name == "eye_night" else inset(out, zoom=3, part=0.14)


if __name__ == "__main__":
    argv = sys.argv[1:]
    scenes_only = "--scenes-only" in argv
    argv = [a for a in argv if a != "--scenes-only"]
    code = 0 if scenes_only else mb.run_family("army", argv)
    quick = any(a in argv for a in ("--no-previews", "--no-concept", "--list")) or \
        os.environ.get("MB_NO_PREVIEWS") or os.environ.get("MB_NO_CONCEPT")
    partial = any(a == "--only" or a.startswith("--only=") for a in argv)
    if code == 0 and (scenes_only or not (quick or partial)):
        render_scenes(force=scenes_only or "--force" in argv or bool(os.environ.get("MB_FORCE")))
    raise SystemExit(code)
