#!/opt/mbtools/venv/bin/python
# mb-family: props_weapons
"""City weapons: six street props the stage 1 kaiju (4.5 m) grabs with one hand and uses.

    /opt/mbtools/venv/bin/python tools/art/props_weapons.py                 build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/props_weapons.py --no-previews   geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/props_weapons.py --only prop_mast
    /opt/mbtools/venv/bin/python tools/art/props_weapons.py --scenes-only   just the two scene shots

Writes (docs/ASSETS.md section 3, "City weapons"; roadmap phase 2, "the city as a weapon"):
    prop_propane      white propane tank on two saddles, flame placard      carried, thrown
    prop_watertank    wooden water tank on four steel legs, conical roof    lifted by the roof, thrown
    prop_antenna      television antenna on a 7 m pole                      a javelin, spike first
    prop_foodsign     a giant burger on a 7.5 m pole                        a club, burger end out
    prop_garagedoor   roll-up garage door in its torn-out frame             a shield
    prop_mast         the radio mast's top 8 m, lying down                  a heavy javelin, lamp first
    client/public/assets/manifest.props_weapons.json
    docs/art/previews/<id>.png, docs/art/concept/<id>.png,
    docs/art/concept/props_weapons_lineup.png      all six on a street beside the old props
    docs/art/concept/props_weapons_held.png        each one in the hatchling's claw

Each file is one mesh node named after the asset, as every prop, plus ONE EMPTY NODE `grip`
under it: the point the hand closes on. Nodes carry no rotation, so how the thing sits in the
hand is written into the manifest entry instead (GRIPS below):

    "grip": {"at": [x, y, z], "tip": [x, y, z], "hold": "carry" | "javelin" | "club" | "shield"}

`at` is the grip node's position and `tip` a unit vector, both in the model's own frame as the
game sees it (meters, y up, front +z). `tip` points from the hand into the business end:
    carry    the way the thing hangs: turn `tip` to point straight down from the hand
    javelin  the way it flies: turn `tip` along the throw
    club     from the hand to the heavy end: swing `tip` through the target
    shield   the way the shield looks: turn `tip` away from the monster's chest

All six are closed on every side (they are held tilted and thrown spinning; the game draws a
face from its front only), stay inside the 80-triangle prop budget and use the city palette.
No kaiju orange, human cyan or volley yellow, no letters anywhere.
"""
import hashlib
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import mb  # noqa: E402
import mb_preview  # noqa: E402
import glb as glbfile  # noqa: E402

FAMILY = "props_weapons"
DECAL = 0.03                    # flat pictures sit this far proud of the surface behind them
BELOW = mb.View("FROM BELOW", azimuth=35, elevation=-35, ortho=True)
SHEET = dict(extra=["top", BELOW])

# How each one is held. "at" and "tip" are in the authoring frame here (x left, -y front, z up)
# and are converted to the game's frame when they are written to the manifest.
GRIPS: dict[str, dict] = {}


def grip(asset: str, at, tip, hold: str) -> None:
    """Make the `grip` empty under the asset's mesh node and remember how it is held."""
    t = mb.V(tip).normalized()
    GRIPS[asset] = dict(at=tuple(at), tip=(t.x, t.y, t.z), hold=hold)
    mb.empty("grip", at=at, parent=asset)


# ---- small helpers (the same ones props.py uses) ------------------------------------------------
def drop(g: mb.Geo, where) -> mb.Geo:
    """A copy of `g` without the selected faces (faces nobody can see cost triangles)."""
    chosen = set(g.select(where))
    out = mb.Geo()
    for i, f in enumerate(g.f):
        if i not in chosen:
            out.face([g.v[k] for k in f], g.col[i], g.mat[i], g.uv[i])
    return out


def plate(w: float, h: float, at, facing: str, color, mat: str = "vcol") -> mb.Geo:
    """One flat rectangle centered on `at`, looking "front" or "back"."""
    x, y, z = at
    pts = [(x - w / 2, y, z - h / 2), (x + w / 2, y, z - h / 2), (x + w / 2, y, z + h / 2), (x - w / 2, y, z + h / 2)]
    if facing == "back":
        pts.reverse()
    return mb.polygon(pts, color=color, mat=mat)


def lit(g: mb.Geo, seed: int = 1, amount: float = 0.03) -> mb.Geo:
    """A little painted-in sky light and facet variation."""
    return g.bake_light(top=1.06, bottom=0.78).jitter(amount, seed=seed)


# ---- propane tank ---------------------------------------------------------------------------------
def propane_geo() -> mb.Geo:
    """Residential propane tank, 2.4 m long, 1.3 m high: a white six-sided capsule lying along
    the model's left-right axis on two saddles, a grey valve cover on top, and on both long
    sides the red flammable placard: a diamond with a pale flame. 80 triangles."""
    r, axis = 0.50, 0.74
    body = mb.lathe([(0, -1.2), (0.36, -1.03), (r, -0.74), (r, 0.74), (0.36, 1.03), (0, 1.2)], n=6,
                    colors=["grey_light", "white", "white", "white", "grey_light"])
    g = body.ry(90).move(0, 0, axis)                       # flats face front and back, a ridge on top
    for x in (-0.66, 0.66):                                # saddles: closed wedges, their tops inside the tank
        g += mb.extrude([(-0.46, 0.0), (0.46, 0.0), (0.0, 0.62)], 0.16, axis="x", at=(x, 0, 0), color="#8a919c")
    g += drop(mb.tapered_box((0.50, 0.40), (0.36, 0.26), 0.19, at=(0, 0, 1.11), color="metal"), "bottom")
    lit(g, seed=21)
    flat = r * math.cos(math.radians(30))                  # distance of the front and back flats from the axis
    for s, facing in ((-1, "front"), (1, "back")):
        y = s * (flat + DECAL)
        d = [(-0.235, y, axis), (0, y, axis - 0.235), (0.235, y, axis), (0, y, axis + 0.235)]
        f = [(-0.085, y + s * 0.01, axis - 0.125), (0.085, y + s * 0.01, axis - 0.125), (0.02 * -s, y + s * 0.01, axis + 0.15)]
        if facing == "back":
            d.reverse()
            f.reverse()
        g += mb.polygon(d, color="red")
        g += mb.polygon(f, color="#fff2c4")
    return g


@mb.asset("prop_propane", sheet=SHEET, concept=dict(azimuth=30, elevation=14))
def prop_propane():
    mb.node("prop_propane", propane_geo())
    grip("prop_propane", (0, 0, 1.30), (0, 0, -1), "carry")        # on the valve cover: it hangs level


# ---- water tank -------------------------------------------------------------------------------------
def watertank_geo() -> mb.Geo:
    """Water tank, 3 m across, 4.5 m to the roof's point: an eight-sided wooden-stave tub with
    one iron hoop and a conical slate roof, on four short steel legs. 80 triangles."""
    g = mb.Geo()
    steel = "#5a616c"
    for sx in (1, -1):
        for sy in (1, -1):                                 # legs splay a little; closed underneath
            g += mb.rod((sx * 1.02, sy * 1.02, 0), (sx * 0.86, sy * 0.86, 1.6), 0.13, 0.11, n=3, color=steel,
                        cap_end=False)
    lit(g, seed=22, amount=0.05)
    tub = mb.prism(8, 1.5, 2.0, at=(0, 0, 1.5), color="wood", cap_top=False)
    tub.paint("wood_dk", where="bottom")
    light = [i for i in tub.select("side")                 # staves: every other face a shade lighter
             if int(round(math.degrees(math.atan2(tub.face_center(i).y, tub.face_center(i).x)) / 45.0 - 0.5)) % 2 == 0]
    tub.paint("wood_lt", where=light)
    g += lit(tub, seed=23, amount=0.04)
    g += mb.lathe([(1.52, 2.36), (1.52, 2.64)], n=8, color="#3d4350", cap_bottom=False, cap_top=False)   # hoop
    roof = mb.cone(8, 1.64, 1.0, at=(0, 0, 3.5), color="bld_slate")
    roof.paint("bld_slate_dk", where="bottom")             # the eaves overhang: closed underneath
    g += lit(roof, seed=24, amount=0.05)
    return g


@mb.asset("prop_watertank", sheet=SHEET, concept=dict(azimuth=30, elevation=8))
def prop_watertank():
    mb.node("prop_watertank", watertank_geo())
    grip("prop_watertank", (0, 0, 4.5), (0, 0, -1), "carry")       # the roof's point: it hangs upright


# ---- television antenna -----------------------------------------------------------------------------
def antenna_geo() -> mb.Geo:
    """Television antenna, 7 m: a steel pole on a concrete foot, ending in a spike, with six
    crossbars in its top third that get shorter toward the tip and alternate between the
    left-right and the front-back axis, so it reads as an antenna from every side and as a
    barbed spear in flight. 72 triangles."""
    g = mb.tapered_box((0.56, 0.56), (0.34, 0.34), 0.30, color="bld_concrete")
    g += mb.lathe([(0.105, 0.28), (0.075, 6.45), (0.0, 7.0)], n=4, colors=["metal", "red"], cap_bottom=False)
    bars = [(4.35, 0.74, "x"), (4.85, 0.66, "y"), (5.30, 0.56, "x"), (5.70, 0.47, "y"), (6.05, 0.37, "x"),
            (6.35, 0.28, "y")]
    for z, half, axis in bars:
        a, b = ((-half, 0, z), (half, 0, z)) if axis == "x" else ((0, -half, z), (0, half, z))
        g += mb.rod(a, b, 0.075, n=3, color="chrome" if axis == "x" else "grey_light")
    return lit(g, seed=25, amount=0.05)


@mb.asset("prop_antenna", sheet=SHEET, concept=dict(azimuth=30, elevation=6))
def prop_antenna():
    mb.node("prop_antenna", antenna_geo())
    grip("prop_antenna", (0, 0, 2.8), (0, 0, 1), "javelin")        # 40% up the pole; the spike leads


# ---- fast-food sign -----------------------------------------------------------------------------------
def foodsign_geo() -> mb.Geo:
    """Fast-food pole sign, 7.5 m: a giant burger on a red pole. Two buns, a dark patty with
    corners of melted cheese hanging over it, a frill of lettuce under the top bun, pale seeds
    on the dome. A picture, no letters. 80 triangles."""
    bun, bun_dk, patty = "#e3a252", "#c98a3e", "#6b3a22"
    g = lit(mb.prism(4, 0.15, 5.75, radius_top=0.12, color="red", cap_top=False), seed=26, amount=0.05)
    r = 1.30
    burger = mb.lathe([(0.0, 5.50), (1.20, 5.66), (r, 6.04), (r, 6.44), (1.52, 6.60), (1.04, 7.18), (0.0, 7.50)],
                      n=6, colors=[bun_dk, bun, patty, "#74d267", bun, bun])
    g += burger.bake_light(top=1.08, bottom=0.8).jitter(0.035, seed=27)
    flat = r * math.cos(math.radians(30)) + DECAL            # cheese: one corner melting down each side of the patty
    for k in range(6):
        a = math.radians(60 * k + 90)
        out, along = mb.V(math.cos(a), math.sin(a), 0), mb.V(-math.sin(a), math.cos(a), 0)
        c = out * flat
        g += mb.tri(c - along * 0.34 + mb.V(0, 0, 6.43), c + mb.V(0, 0, 6.13), c + along * 0.34 + mb.V(0, 0, 6.43),
                    color="taxi_yellow")
    c30 = math.cos(math.radians(30))                         # seeds: on four of the top bun's six slopes
    for k, (t, side) in zip((0, 1, 3, 4), ((0.42, 0.22), (0.6, -0.2), (0.45, -0.25), (0.58, 0.18))):
        a = math.radians(60 * k + 90)
        out, along = mb.V(math.cos(a), math.sin(a), 0), mb.V(-math.sin(a), math.cos(a), 0)
        lo, hi = out * (1.52 * c30) + mb.V(0, 0, 6.60), out * (1.04 * c30) + mb.V(0, 0, 7.18)
        up = (hi - lo).normalized()
        nrm = along.cross(up)
        if nrm.dot(out) < 0:
            nrm = -nrm
        c = lo + (hi - lo) * t + along * side + nrm * DECAL
        g += mb.polygon([c - up * 0.11 - along * 0.075, c - up * 0.11 + along * 0.075, c + up * 0.15]
                        if (along * 1.0).cross(up).dot(nrm) > 0 else
                        [c - up * 0.11 + along * 0.075, c - up * 0.11 - along * 0.075, c + up * 0.15], color="#fff2c4")
    return g


@mb.asset("prop_foodsign", sheet=SHEET, concept=dict(azimuth=30, elevation=4))
def prop_foodsign():
    mb.node("prop_foodsign", foodsign_geo())
    grip("prop_foodsign", (0, 0, 0.7), (0, 0, 1), "club")          # low on the pole; the burger is the head


# ---- garage door --------------------------------------------------------------------------------------
DOOR_W, DOOR_H = 3.2, 2.8


def garagedoor_geo() -> mb.Geo:
    """Roll-up garage door: a 3.2 x 2.8 m ribbed steel panel (eight slats, light and shadow)
    with a dark pull handle low on the front and a grab bar across the back, in the plaster
    frame it was torn out with (broken faces grey). Stands upright; front is the street side.
    78 triangles."""
    g = mb.Geo()
    plaster, broken = "bld_cream", "rubble_grey"
    for sx in (1, -1):
        jamb = drop(mb.box((0.2, 0.3, DOOR_H), at=(sx * (DOOR_W / 2 + 0.1), 0, 0), color=plaster, anchor="bottom"), "top")
        jamb.paint(broken, where="left" if sx > 0 else "right").paint(broken, where="bottom")
        g += jamb
    head = mb.box((DOOR_W + 0.4, 0.3, 0.2), at=(0, 0, DOOR_H), color=plaster, anchor="bottom")
    head.paint(broken, where="top").paint(broken, where="left").paint(broken, where="right")
    g += head
    lit(g, seed=28, amount=0.05)
    slats, t = 8, 0.05
    hi_c, lo_c = "#eef0f2", "#b4bcc6"
    for k in range(slats):
        z0, z1 = DOOR_H * k / slats, DOOR_H * (k + 1) / slats
        zc, hh = (z0 + z1) / 2, z1 - z0
        g += plate(DOOR_W, hh, (0, -t, zc), "front", hi_c if k % 2 else lo_c)
        g += plate(DOOR_W, hh, (0, t, zc), "back", mb.shade(hi_c if k % 2 else lo_c, 0.86))
    g += mb.quad((-DOOR_W / 2, t, 0), (DOOR_W / 2, t, 0), (DOOR_W / 2, -t, 0), (-DOOR_W / 2, -t, 0), color="grey_dark")
    g += drop(mb.box((0.9, 0.09, 0.14), at=(0, -t - 0.045, 0.52), color="grey_dark"), "back")    # pull handle
    g += plate(1.3, 0.2, (0, t + DECAL, DOOR_H / 2), "back", "grey_dark")                         # grab bar
    return g


@mb.asset("prop_garagedoor", sheet=SHEET, concept=dict(azimuth=32, elevation=10))
def prop_garagedoor():
    mb.node("prop_garagedoor", garagedoor_geo())
    grip("prop_garagedoor", (0, 0.05 + DECAL, DOOR_H / 2), (0, -1, 0), "shield")   # back center; the front faces out


# ---- radio mast top -------------------------------------------------------------------------------------
# The numbers of bld_radiomast_a's `top` node (tools/art/city_special.py): the mast's top 8 m.
MAST_RED, MAST_WHITE = "#d7263d", "#f4f2ee"
MAST_LEN = 8.0
MAST_LEG = 0.17                 # the legs are three-sided bars, corners this far from their center line
MAST_BAYS = ((0.0, 4.0, MAST_WHITE, 1), (4.0, 7.45, MAST_RED, 0))     # (from, to, color, zig or zag)


def mast_r(s: float) -> float:
    """Distance of the three legs from the axis, s meters above the break (0.85 to 0.5 m)."""
    return 1.55 + (0.5 - 1.55) * (15.75 + s) / 23.75


def mast_axis(s: float) -> mb.Vector:
    """The axis lying down: the break at the back (+Y), the tip at the front. It drops a
    little toward the thin end so that both lower legs rest on the ground all the way."""
    return mb.V(0, MAST_LEN / 2 - s, 0.5 * mast_r(s) + MAST_LEG * 0.5)


def mast_leg(k: int, s: float) -> mb.Vector:
    a = math.radians(90 + 120 * k)                 # leg 0 on top, legs 1 and 2 on the ground
    return mast_axis(s) + mb.V(math.cos(a), 0, math.sin(a)) * mast_r(s)


def mast_geo() -> mb.Geo:
    """The radio mast's top section lying in the street, 8 m: three legs, zig-zag braces in two
    bays, white then red, the red lamp at the tip (glowing). Tip toward the model's front.
    72 triangles."""
    g = mb.Geo()
    stations = (0.0, 4.0, 7.45)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        out = mb.V(math.cos(a), 0, math.sin(a))
        side = mb.V(0, 1, 0).cross(out)
        rings = []
        for s in stations:
            c = mast_leg(k, s)
            rings.append([c + (out * math.cos(t) + side * math.sin(t)) * MAST_LEG
                          for t in (0.0, 2 * math.pi / 3, 4 * math.pi / 3)])
        g += mb.loft(rings, colors=[MAST_WHITE, MAST_RED])
    for s0, s1, color, zig in MAST_BAYS:
        for k in range(3):
            i, j = (k, (k + 1) % 3) if zig == 0 else ((k + 1) % 3, k)
            pa, pc = mast_leg(i, s0 + 0.1), mast_leg(j, s1 - 0.1)
            mid = (mast_leg(k, s0) + mast_leg((k + 1) % 3, s0)) / 2 - mast_axis(s0)
            nrm = mb.V(mid.x, 0, mid.z).normalized()
            w = nrm.cross(pc - pa).normalized() * 0.085
            q = [pa - w, pc - w, pc + w, pa + w]
            if (q[1] - q[0]).cross(q[2] - q[0]).dot(nrm) < 0:
                q.reverse()
            g += mb.polygon(q, color=color)
            g += mb.polygon([p - nrm * 0.015 for p in reversed(q)], color=mb.shade(color, 0.76))
    g.bake_light(top=1.05, bottom=0.8).jitter(0.03, seed=29)
    c = mast_axis(7.6)                              # the lamp: two three-sided pyramids base to base
    ring = [c + mb.V(math.cos(t), 0, math.sin(t)) * 0.42 for t in (math.radians(a) for a in (90, 210, 330))]
    for k in range(3):
        a, b = ring[k], ring[(k + 1) % 3]
        g += mb.tri(a, b, c + mb.V(0, -0.4, 0), color="glow_red", mat="glow")
        g += mb.tri(b, a, c + mb.V(0, 0.4, 0), color="glow_red", mat="glow")
    return g.on_ground()


@mb.asset("prop_mast", sheet=SHEET, concept=dict(azimuth=38, elevation=14))
def prop_mast():
    g = mast_geo()
    mb.node("prop_mast", g)
    lift = g.bounds()[0].z                                         # on_ground() already applied: 0
    top = mast_leg(0, 3.2) + mb.V(0, 0, MAST_LEG - lift)
    tip = mast_axis(8.0) - mast_axis(0.0)
    grip("prop_mast", (0, top.y, top.z), tip, "javelin")           # on the top leg, 40% along; the lamp leads


# ---- scene shots ------------------------------------------------------------------------------------------
def geo_from_glb(asset: str) -> mb.Geo:
    """Any exported model as loose geometry, to dress a scene with."""
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
                out.face([mb.from_gltf(pts[k]) for k in tri], color, prim.material if prim.material in ("vcol", "glow") else "vcol")
    return out


def glb_point(asset: str, node: str) -> mb.Vector:
    """A node's position in the authoring frame, read from the exported file."""
    data = glbfile.load(mb.contract.model_path(asset))
    return mb.from_gltf(data.node(node).world[:3, 3])


WEAPONS = ["prop_propane", "prop_watertank", "prop_antenna", "prop_foodsign", "prop_garagedoor", "prop_mast"]
CURB = 0.15


def street(length: float = 90.0) -> mb.Geo:
    g = mb.box((length, 16, 0.2), at=(0, 0, 0), anchor="top", color="road")
    for s in (1, -1):
        g += mb.box((length, 30, 0.2 + CURB), at=(0, s * 23.0, CURB), anchor="top", color="sidewalk" if s > 0 else "grass")
    for x in range(-int(length / 2) + 2, int(length / 2), 6):
        g += mb.box((2.8, 0.18, 0.02), at=(x, 0, 0), anchor="bottom", color="white")
    return g


def build_lineup() -> None:
    """All six on the far sidewalk and in the street, beside the props that were already there
    and the hatchling, for scale."""
    mb.reset()
    g = mb.Geo()
    spots = [("prop_lamp", -17.5, 9.0, 0, CURB), ("prop_propane", -14.0, 10.5, 0, CURB),
             ("prop_watertank", -9.0, 11.0, 0, CURB), ("prop_antenna", -5.0, 9.6, 0, CURB),
             ("prop_kiosk", -1.0, 11.0, 0, CURB), ("prop_foodsign", 3.6, 10.0, 0, CURB),
             ("prop_garagedoor", 8.8, 10.4, 0, CURB), ("prop_trafficlight", 12.6, 9.0, 0, CURB),
             ("prop_hydrant", 6.0, 8.8, 0, CURB), ("prop_bench", -11.5, 8.9, 0, CURB),
             ("prop_car_sedan", -11.0, 5.6, -90, 0), ("prop_car_taxi", 9.0, 5.6, -90, 0),
             ("prop_mast", 1.0, 2.2, 78, 0), ("kaiju_lizard_s1", -4.2, 1.4, 20, 0),
             ("prop_tree_a", 17.0, 11.5, 0, CURB)]
    for asset, x, y, heading, z in spots:
        try:
            g += geo_from_glb(asset).rz(heading).move(x, y, z)
        except Exception as err:
            print(f"  lineup: left out {asset} ({type(err).__name__}: {err})")
    mb.node("ground", street().move(0, 0, 0.03))
    mb.node("things", g.move(0, 0, 0.03))


def held(asset: str, hand: mb.Vector, to: mb.Vector, roll: float = 0.0) -> mb.Geo:
    """The prop as the client should hold it: its grip on the hand, its `tip` turned to `to`."""
    info = GRIPS[asset]
    g = geo_from_glb(asset).move(*(-mb.V(info["at"])))
    tip, to = mb.V(info["tip"]).normalized(), mb.V(to).normalized()
    axis = tip.cross(to)
    if axis.length > 1e-6:
        g.rot(axis.normalized(), math.degrees(tip.angle(to)))
    elif tip.dot(to) < 0:
        g.rot(mb.V(1, 0, 0), 180)
    if roll:
        g.rot(to, roll)
    return g.move(*hand)


def build_held() -> None:
    """Six hatchlings in the rest pose, each with one weapon on its `hold` node, turned the
    way its `tip` says: what the grip nodes are for."""
    mb.reset()
    hand = glb_point("kaiju_lizard_s1", "hold")
    liz = geo_from_glb("kaiju_lizard_s1")
    g = mb.Geo()
    poses = [("prop_propane", (0, 0, -1), 0, 0.25), ("prop_watertank", (0, -1, 0.2), 0, 0.6),
             ("prop_antenna", (0, -1, 0.12), 0, 0), ("prop_foodsign", (-0.25, -0.35, 1), 0, 0),
             ("prop_garagedoor", (0, -1, 0), 0, 1.3), ("prop_mast", (0, -1, 0.1), 0, 1.0)]
    for n, (asset, to, roll, lift) in enumerate(poses):
        x = (n - 2.5) * 8.0
        g += liz.copy().move(x, 0, 0)
        g += held(asset, hand + mb.V(0, 0, lift), to, roll).move(x, 0, 0)
    mb.node("ground", mb.box((110, 60, 0.2), at=(0, 0, 0.0), anchor="top", color="road"))
    mb.node("things", g.move(0, 0, 0.02))


SCENE_OPTS = {
    "lineup": dict(backdrop="sky", size=(1500, 760), samples=12, sun_azimuth=-45, sun_elevation=44,
                   view=mb.View("", eye=(1.0, -24.0, 9.5), target=(0.0, 7.0, 2.6), fov=50)),
    "held": dict(backdrop="sky", size=(1700, 700), samples=12, sun_azimuth=-45, sun_elevation=44,
                 view=mb.View("", eye=(-30.0, -46.0, 15.0), target=(-6.5, -2.0, 1.2), fov=50)),
}


def render_scenes(force: bool = False, out_dir: str | None = None) -> None:
    with open(os.path.abspath(__file__), "rb") as f:
        src = hashlib.sha1(f.read()).hexdigest()
    for asset in WEAPONS + ["kaiju_lizard_s1"]:
        path = mb.contract.model_path(asset)
        if os.path.exists(path):
            src += mb._file_sha(path)
    for name, build in (("lineup", build_lineup), ("held", build_held)):
        out = os.path.join(out_dir or mb.CONCEPT, f"props_weapons_{name}.png")
        opts = SCENE_OPTS[name]
        stamp = f"{mb_preview.PREVIEW_VERSION}|{src}|{opts!r}"
        if not force and mb._stamp_ok(out, stamp):
            continue
        build()
        mb.concept(name, out=out, stamp=stamp, **opts)
        print(f"  scene: {os.path.relpath(out, mb.REPO)}")


def measure_grips() -> None:
    """Fill GRIPS from the code without exporting (for --scenes-only)."""
    for a in mb._REGISTRY:
        if a["id"] not in GRIPS:
            mb.reset()
            a["fn"]()


def write_grip_notes() -> None:
    """Add the "grip" object to the manifest entries (positions in the game's frame)."""
    man = mb.Manifest(FAMILY)
    for asset, info in GRIPS.items():
        if asset in man.data.get("models", {}):
            man.data["models"][asset]["grip"] = {
                "at": [round(c, 3) + 0.0 for c in mb.to_gltf(info["at"])],
                "tip": [round(c, 3) + 0.0 for c in mb.to_gltf(info["tip"])],
                "hold": info["hold"],
            }
    man.write()


if __name__ == "__main__":
    argv = sys.argv[1:]
    scenes_only = "--scenes-only" in argv
    argv = [a for a in argv if a != "--scenes-only"]
    code = 0 if scenes_only else mb.run_family(FAMILY, argv)
    if "--list" not in argv:
        measure_grips()
        if not scenes_only:
            write_grip_notes()
    quick = any(a in argv for a in ("--no-previews", "--no-concept", "--list")) or \
        os.environ.get("MB_NO_PREVIEWS") or os.environ.get("MB_NO_CONCEPT")
    partial = any(a == "--only" or a.startswith("--only=") for a in argv)
    if code == 0 and (scenes_only or not (quick or partial)):
        render_scenes(force=scenes_only or "--force" in argv or bool(os.environ.get("MB_FORCE")))
    raise SystemExit(code)
