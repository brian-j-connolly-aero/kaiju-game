#!/opt/mbtools/venv/bin/python
# mb-family: army
"""Army (Tier 1) models: the main battle tank, its burnt wreck and the three projectiles.

    /opt/mbtools/venv/bin/python tools/art/army.py                  build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/army.py --no-previews    geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/army.py --only army_tank
    /opt/mbtools/venv/bin/python tools/art/army.py --scenes-only    just the platoon shot and portrait

Writes, per docs/ASSETS.md section 3 "Army":
    client/public/assets/models/army_tank.glb          nodes hull > (turret > barrel > muzzle), track_L, track_R
    client/public/assets/models/army_tank_wreck.glb    one burnt mesh
    client/public/assets/models/proj_rocket.glb, proj_shell.glb, proj_arty.glb
    client/public/assets/manifest.army.json
    client/public/assets/ui/portrait_army.png          512 px faction portrait (transparent background)
    docs/art/previews/<id>.png, docs/art/concept/<id>.png, docs/art/concept/army_platoon.png

The tank is a chunky, slightly toy-like main battle tank: olive, with cyan identification
stripes (glacis, turret rear, side skirts) and a cyan roundel on the turret roof so it reads
as "human" from a kaiju's eye view high above (humans are cyan circles in the color language).
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
OLIVE_LT = "army_olive_lt"
KHAKI = "army_khaki"
STEEL = "army_track"          # tracks, gun barrel, exhausts
CYAN = "human_cyan"

# Joints of the tank, in model space (authoring frame). The game rotates `turret` around the
# vertical axis through TURRET_PIVOT and `barrel` around the left-right axis through
# BARREL_PIVOT; `muzzle` is where shells leave.
DECK = 1.68                            # height of the hull deck
ROOF = 2.52                            # height of the turret roof
TURRET_PIVOT = (0.0, 0.10, DECK)       # center of the turret ring, on the hull deck
BARREL_PIVOT = (0.0, -1.20, 1.94)      # trunnion, just inside the turret front
MUZZLE = (0.0, -4.90, 1.94)


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


def wheel(radius: float, turn: float = 0.0, outward: float = 1.0) -> mb.Geo:
    """A dished disc (a shallow cone, 6 triangles) facing the model's left, or its right.
    Its back is open, except on the wreck."""
    return mb.cone(6, radius, 0.10, color=OLIVE_DK, cap_bottom=KEEP_HIDDEN).ry(90 * outward).rx(turn).jitter(0.06, seed=4)


def track_left() -> mb.Geo:
    """The left track: belt, five road wheels, idler (front) and drive sprocket (rear)."""
    belt = [(-3.02, 0.70), (-2.70, 1.08), (2.64, 1.08), (2.96, 0.72), (2.96, 0.46), (2.48, 0.0),
            (-2.42, 0.0), (-3.02, 0.40)]
    g = slab(belt, 1.10, 1.82, STEEL)
    g.paint(mb.shade(STEEL, 0.72), where="left")
    g.jitter(0.10, seed=3, where=lambda c, n: abs(n.x) < 0.5)   # belt segments differ a little
    wheels = [(y, 0.44, 0.43) for y in ROAD_WHEELS] + [(-2.62, 0.70, 0.30), (2.58, 0.72, 0.30)]
    for i, (y, z, r) in enumerate(wheels):
        g += wheel(r, turn=30 * (i % 2)).move(1.82, y, z)
    return g


def hull_geo(wreck: bool = False) -> mb.Geo:
    """wreck=True closes the right side (its track and skirt are gone there)."""
    # upper hull: a wedge-nosed slab that sits on the tracks; the second band is the glacis stripe
    sections = [(-3.10, 3.34, 1.24), (-2.62, 3.60, 1.42), (-2.22, 3.60, 1.56), (-1.85, 3.60, DECK),
                (2.72, 3.60, DECK), (3.00, 3.44, 1.46)]
    rings = [trap(y, w, w, 1.04, top) for y, w, top in sections]
    g = mb.loft(rings, colors=[OLIVE, CYAN, OLIVE, OLIVE, OLIVE])
    # lower hull between the tracks: only the nose plate, belly and tail plate can be seen
    g += drop(slab([(-2.92, 1.04), (-2.50, 0.44), (2.50, 0.44), (2.90, 1.04)], -1.10, 1.10, OLIVE_DK,
                   cap0=wreck, cap1=wreck), "top")
    # side skirts with an identification stripe each
    for s in ((1,) if wreck else (1, -1)):
        g += drop(mb.box((0.10, 4.5, 0.52), at=(s * 1.87, 0.0, 0.98), color=OLIVE), "right" if s > 0 else "left")
        g += drop(mb.box((0.05, 0.55, 0.52), at=(s * 1.935, -1.30, 0.98), color=CYAN),
                  "right" if s > 0 else "left")
    # engine deck: three louvres, and the exhausts on the tail plate
    for y in (() if wreck else (1.42, 1.90, 2.38)):
        g += drop(mb.box((2.5, 0.30, 0.10), at=(0, y, DECK), color=mb.shade(OLIVE, 0.55), anchor="bottom"),
                  "bottom")
    for x in (-0.95, 0.95):
        g += drop(mb.box((0.36, 0.22, 0.30), at=(x, 3.02, 1.26), color=STEEL), "front")
    finish(g, seed=11)
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


def turret_geo(wreck: bool = False) -> mb.Geo:
    z0 = DECK
    rings = [trap(-1.30, 1.80, 1.30, z0, 2.18), trap(-0.60, 2.80, 2.25, z0, ROOF),
             trap(1.05, 2.80, 2.25, z0, ROOF), trap(1.40, 2.80, 2.25, z0, ROOF),
             trap(1.95, 2.20, 1.70, z0, 2.40)]
    g = drop(mb.loft(rings, colors=[OLIVE, OLIVE, CYAN, OLIVE]), "bottom")
    # stowage box on the bustle
    g += drop(mb.box((1.6, 0.34, 0.40), at=(0, 2.06, 2.02), color=KHAKI), "front")
    # smoke dischargers on the turret cheeks
    for sx in (1, -1):
        g += drop(mb.box((0.26, 0.34, 0.26), at=(sx * 1.16, -0.92, 2.02), color=STEEL).rz(-sx * 34, about=(sx * 1.16, -0.92, 2.02)),
                  "bottom")
    finish(g, seed=21)
    # roof roundel: a cyan disc with the commander's cupola in its middle
    g += mb.prism(8, 0.80, 0.06, at=(0, 0.20, ROOF), color=CYAN, cap_bottom=wreck)
    cup = mb.prism(6, 0.40, 0.26, radius_top=0.33, at=(0, 0.20, ROOF + 0.06), color=OLIVE_DK, cap_bottom=wreck)
    cup.paint(OLIVE, where="top")
    g += finish(cup, seed=22)
    if wreck:
        return g                        # machine gun and antenna burnt off
    # machine gun on the cupola, antenna on the bustle
    g += mb.rod((0.0, 0.0, ROOF + 0.40), (0.0, -0.95, ROOF + 0.44), 0.05, n=4, color=STEEL)
    g += mb.rod((0.90, 1.56, 2.44), (0.90, 1.70, 3.30), 0.03, 0.012, n=3, color=STEEL, cap_start=False)
    return g


def barrel_geo() -> mb.Geo:
    z = BARREL_PIVOT[2]
    g = finish(drop(mb.box((1.06, 0.50, 0.50), at=(0, -1.42, z), color=OLIVE_DK), "back"), seed=31)   # mantlet
    g += mb.rod((0, -1.60, z), (0, -4.80, z), 0.155, n=6, color=STEEL, cap_start=False, cap_end=False)
    g += mb.rod((0, -2.85, z), (0, -3.55, z), 0.235, n=6, color=OLIVE)                    # fume extractor
    brake = mb.rod((0, -4.48, z), (0, MUZZLE[1], z), 0.215, n=6, color=STEEL)               # muzzle brake
    brake.paint("black", where="front")
    g += brake
    return g.bake_light(top=1.1, bottom=0.75)


def tank_geos(wreck: bool = False) -> dict:
    global KEEP_HIDDEN
    KEEP_HIDDEN = wreck
    try:
        left = track_left()
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


@mb.asset("army_tank", kind="vehicle",
          sheet=dict(extra=["top",
                            mb.View("KAIJU'S EYE VIEW", azimuth=25, elevation=58, fov=24),
                            mb.View("POSED: turret.y = 32, barrel.x = -14", azimuth=-40, elevation=14, fov=28,
                                    pose=TANK_POSE)]),
          concept=dict(backdrop="sky", azimuth=38, elevation=11, pose={"turret": {"y": 18}, "barrel": {"x": -8}}))
def army_tank():
    """Main battle tank, about 7.9 m long with the gun, 3.9 m wide, 2.8 m to the cupola."""
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
    """Repaint as a burnt-out hulk. `hits` are the points where it was struck: black soot
    there, fading to scorched paint further away, with the cyan only a ghost of itself."""
    rng = random.Random(seed)
    cyan = mb.palette.rgb(CYAN)
    burnt, soot, rust = (mb.palette.rgb(c) for c in ("army_burnt", "#17130f", "#6a3d24"))

    def repaint(col, center, normal):
        near = min((center - mb.V(h)).length for h in hits)
        heat = max(0.0, 1.0 - near / 3.2) ** 1.5                       # 1 at a hit, 0 from 3.2 m
        is_cyan = max(abs(a - b) for a, b in zip(col, cyan)) < 0.2
        keep = (0.32 if is_cyan else 0.22) * (1.0 - heat) * rng.uniform(0.6, 1.0)   # paint that survived
        base = tuple(b + (r - b) * 0.55 * rng.random() ** 2 for b, r in zip(burnt, rust))
        base = tuple(b + (s - b) * min(1.0, heat * 1.25) for b, s in zip(base, soot))
        ash = 1.0 + 0.45 * max(normal.z, 0.0) * (1.0 - heat)           # ash settles on upward faces
        return tuple(min(1.0, (b * (1 - keep) + c * keep) * ash) for b, c in zip(base, col))

    g.material("vcol")
    return g.recolor(repaint)


@mb.asset("army_tank_wreck", kind="vehicle", sheet=dict(extra=["top"]),
          concept=dict(backdrop="sky", azimuth=-38, elevation=13))
def army_tank_wreck():
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
    g.on_ground()
    mb.node("army_tank_wreck", g)


# ---- projectiles: tiny and simple, the glow comes from sprites ----------------------------------
def fins(span: float, root: float, y_tail: float, color) -> mb.Geo:
    """Four tail fins in a cross. Each is a closed sliver (a flat triangle with a 2 cm high
    point in the middle of one side): 4 triangles, and it has no back to look into."""
    a, b, c = mb.V(0.0, y_tail - root, 0.0), mb.V(0.0, y_tail, 0.0), mb.V(span, y_tail + 0.02, 0.0)
    peak = (a + b + c) / 3 + mb.V(0, 0, 0.02)
    fin = mb.from_data([a, b, c, peak], [(0, 1, 2), (1, 0, 3), (2, 1, 3), (0, 2, 3)], color=color).move(0, 0, -0.01)
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
    """Tank shell, 0.9 m: brass case, cyan driving band, pale rounded nose."""
    g = spun([(0.09, -0.45), (0.10, -0.04), (0.10, 0.12), (0.065, 0.33), (0.0, 0.45)],
             ["#c9a24a", CYAN, "white", "grey_light"])
    mb.node("proj_shell", g.bake_light(1.08, 0.8))


@mb.asset("proj_arty", concept=dict(backdrop="studio", azimuth=55, elevation=18))
def proj_arty():
    """Artillery round, 1.5 m: a fat finned bomb that reads as "incoming" in silhouette."""
    g = spun([(0.055, -0.75), (0.055, -0.30), (0.18, -0.04), (0.18, 0.22), (0.115, 0.55), (0.0, 0.75)],
             [STEEL, OLIVE, CYAN, OLIVE, "white"])
    g += fins(0.21, 0.30, 0.75, STEEL)
    mb.node("proj_arty", g.bake_light(1.08, 0.8))


# ---- scene shots: the platoon and the faction portrait ------------------------------------------
SCENE_OPTS = {
    "platoon": dict(backdrop="sunset", size=(1280, 720), samples=16, sun_azimuth=-68, sun_elevation=20,
                    view=mb.View("", eye=(-11.0, -29.0, 3.0), target=(0.6, 0.0, 1.9), fov=40)),
    "portrait": dict(backdrop=None, azimuth=40, elevation=5, fov=40, size=(512, 512), samples=24,
                     sun_azimuth=-72, sun_elevation=30),
}
# The portrait is lit harder than the review shots: warm key, strong cyan rim, little fill.
PORTRAIT_LIGHT = dict(key=("#ffe2b8", 3.4), rim=("#59e0ff", 4.2), ambient=0.22)


def build_platoon() -> None:
    """Four tanks in a wedge coming down a street at dusk, guns up."""
    mb.reset()
    road = mb.box((15, 400, 0.1), at=(0, 80, 0), anchor="top", color="road")
    for x in (-0.12, 0.12):                                       # double center line
        road += mb.box((0.14, 400, 0.02), at=(x * 1.6, 80, 0.0), color="volley_yellow_lt", anchor="bottom")
    for x in (-3.9, 3.9):                                         # dashed lane lines
        for k in range(-9, 40):
            road += mb.box((0.16, 2.6, 0.02), at=(x, k * 6.0, 0.0), color="white", anchor="bottom")
    for s in (1, -1):
        road += mb.box((0.3, 400, 0.2), at=(s * 7.65, 80, 0), color="grey_light", anchor="bottom")    # curb
        road += mb.box((5, 400, 0.18), at=(s * 10.3, 80, 0), color="sidewalk", anchor="bottom")
    mb.node("ground", road)
    spots = [((1.6, -7.0), 0, 16, 10), ((-3.3, 2.5), 0, 30, 5), ((3.5, 12.5), 0, -12, 14), ((-4.1, 24.0), 0, 8, 7)]
    for i, ((x, y), heading, yaw, pitch) in enumerate(spots):
        mb.node(f"tank_{i}", posed_tank(yaw, pitch).rz(heading).move(x, y, 0))


def build_portrait() -> None:
    mb.reset()
    mb.node("tank", posed_tank(4, 13))


def render_scenes(force: bool = False) -> None:
    """The platoon concept shot and the 512 px faction portrait, skipped when up to date."""
    with open(os.path.abspath(__file__), "rb") as f:
        src = hashlib.sha1(f.read()).hexdigest()
    jobs = [("platoon", build_platoon, os.path.join(mb.CONCEPT, "army_platoon.png")),
            ("portrait", build_portrait, os.path.join(mb.ASSETS, "ui", "portrait_army.png"))]
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
