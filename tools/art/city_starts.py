#!/opt/mbtools/venv/bin/python
# mb-family: city_starts
"""The six small buildings of the starting neighborhoods and the low-rise suburbs
(bld_bungalow_a, bld_duplex_a, bld_garage_a, bld_diner_a, bld_firehouse_a, bld_motel_a).

The small monster (4.5 m) meets these first and the squads fight among them, so each one is
a few big shapes that say what it is from the monster's height and from the street: a porch
under one low roof, two doors under one long gable, two ribbed doors, a chrome pill with a cup
on top, red engine doors and a hose tower, a row of doors behind a railing and a moon on a pole.
All are in the small class (120 triangles per state). Their own atlas pictures are in
tools/art/city/atlas_extra/homes.py; the parts shared with the other small buildings in
tools/art/city/parts.py.

    tools/art/city_starts.py [--only bld_diner_a] [--no-previews]    build, check, sheet
    tools/art/city_starts.py --pictures     docs/art/concept/city_starts_scale.png (each one whole
                                            and damaged beside house_a, shop_a and apartment_a) and
                                            docs/art/concept/city_starts_street.png (a street of
                                            them in three districts' wall and roof colors); 1 minute
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from city import atlas, kit, style  # noqa: E402
from city.parts import TRIM, UNDER, part, poly, post, tidy, window_on  # noqa: E402

atlas.load_extensions()   # the pictures of tools/art/city/atlas_extra/homes.py

DARK = "#3a3f4a"          # dark painted metal: rails, poles


def box_pts(x0, x1, y0, y1, z0, z1):
    return np.array([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float)


def roof_block(b, x0, x1, y0, y1, z):
    """A wall-less block: what a roof sits on when it covers more than the walls (a porch)."""
    return kit.Block(x0, x1, y0, y1, 0.0, z, "plaster_plain", True, b.tone)


# ---- the houses -------------------------------------------------------------------------------
@kit.building("bungalow_a", district="suburb", tone="lime", seed=111)
def bungalow_a(b):
    # One storey of painted boards under one low hipped roof that also covers the deep porch
    # across the whole front: four white posts, a red door, a brick chimney.
    b.damage_hook = tidy
    o = style.EAVE
    deep = 2.6                                           # the porch
    y1 = b.D / 2 - o
    yp = -b.D / 2 + o                                    # the roof's front wall line (no wall there)
    body = b.block(b.W - 2 * o, y1 - (yp + deep), 3.0, at=(0.0, (y1 + yp + deep) / 2, 0.0), facade="clapboard",
                   roof=False)
    b.hip(roof_block(b, body.x0, body.x1, yp, y1, 3.0), rise=b.H - 0.25 - 3.0, roof="tile_red")
    b.door(body, "front", x=0.0, kind="door_red")
    with part(b):                                        # the deck and the posts stand or fall together
        b.box((body.x0, yp - 0.2, 0.0), (body.x1, body.y0, 0.3), color="#d8d2c4")
        for x, w in ((body.x0 + 0.2, 0.3), (-1.4, 0.24), (1.4, 0.24), (body.x1 - 0.2, 0.3)):
            post(b, x, yp + 0.05, 0.3, 2.86, w=w)
    b.no_interior = [(np.array([body.x0 - 0.2, yp - 0.4, -0.1]), np.array([body.x1 + 0.2, body.y0 - 0.05, 2.9]))]
    with part(b):
        b.chimney(2.9, 2.2, 3.0, b.H, w=0.9, d=0.8)
    b.bite_hint = (body.x1 - 0.8, yp + 0.6, b.H)


@kit.building("duplex_a", district="suburb", tone="cream", seed=123)
def duplex_a(b):
    # A semi-detached pair: two mirrored halves under one long gable, a door at each outer end
    # (one red, one blue: the neighbors do not agree) under its own small porch roof on a post,
    # a white strip down the party wall, a chimney for each half.
    b.damage_hook = tidy
    o = style.EAVE
    yf = -b.D / 2
    y0, y1 = yf + 1.3, b.D / 2 - o
    body = b.block(b.W - 2 * o, y1 - y0, 5.6, at=(0.0, (y0 + y1) / 2, 0.0), facade="plaster_sash", roof=False)
    b.gable(body, rise=1.2, along="x", roof="tile_slate")
    poly(b, [(-0.15, y0 - 0.03, 0.0), (0.15, y0 - 0.03, 0.0), (0.15, y0 - 0.03, 5.5), (-0.15, y0 - 0.03, 5.5)],
         TRIM, out=(0, -1, 0))                           # the party wall
    for sx, kind in ((-1, "door_red"), (1, "door_blue")):
        b.door(body, "front", x=sx * 4.2, kind=kind)
        xa, xb = sorted((sx * 2.9, sx * 5.55))
        with part(b):                                    # the porch roof: a thin sheet on one post
            sheet = [(xa, yf + 0.05, 2.7), (xb, yf + 0.05, 2.7), (xb, y0, 3.05), (xa, y0, 3.05)]
            poly(b, sheet, region="tile_slate", out=(0, 0, 1), tag="roof")
            poly(b, [(p[0], p[1], p[2] - 0.02) for p in sheet], UNDER, out=(0, 0, -1), tag="underside")
            post(b, sx * 3.1, yf + 0.25, 0.0, 2.7, w=0.2, n=3)
        with part(b):
            b.chimney(sx * 2.6, body.cy + 1.4, 5.7, b.H, w=0.9, d=0.7)
    b.no_interior = [(np.array([body.x0 - 0.5, yf - 0.1, -0.1]), np.array([body.x1 + 0.5, y0 - 0.05, 3.1]))]
    b.bite_hint = (body.x1 - 0.5, body.y0, b.H)


@kit.building("garage_a", district="suburb", tone="white", seed=135)
def garage_a(b):
    # A detached two-car garage and workshop: its gable to the street over two ribbed roll-up
    # doors, a wrench on a board in the gable, a window on one side and a door on the other.
    b.damage_hook = tidy
    o = style.EAVE
    body = b.block(b.W - 2 * o, b.D - 2 * o, 2.6, at=(0.0, 0.0, 0.0), facade="plaster_plain", roof=False)
    b.gable(body, rise=b.H - 2.6, along="y", roof="tile_red", window=False)
    for x in (-1.75, 1.75):
        b.decal(body, "front", x, 0.0, 3.0, 2.25, "door_rollup")
    b.decal(body, "front", 0.0, 2.75, 1.2, 0.6, "sign_wrench", offset=0.06)
    window_on(b, (body.x1, 0.6, 0.45), (0, 1, 0), (1, 0, 0))
    b.door(body, "right", x=1.6, kind="door_green", size=style.DOOR)
    b.bite_hint = (body.x1, body.y0, b.H)


# ---- the shops --------------------------------------------------------------------------------
def stadium(cx, r, z, n_end=4):
    """The outline of a body with rounded ends: two half circles of radius r (n_end sides each)
    around (-cx, 0) and (cx, 0), counter-clockwise from the front left corner."""
    pts = []
    for sx, a0 in ((1, -90.0), (-1, 90.0)):
        for k in range(n_end + 1):
            a = math.radians(a0 + 180.0 * k / n_end)
            pts.append((sx * cx + r * math.cos(a), r * math.sin(a), z))
    return pts


@kit.building("diner_a", district="suburb", tone="rose", seed=147)
def diner_a(b):
    # A roadside diner: one long pastel body with rounded ends and a band of big lit windows
    # all the way round, a chrome roof edge with a red neon line, and a steaming cup on a board
    # on the roof.
    b.damage_hook = tidy
    lip = 0.4
    r_roof = b.D / 2
    cx = b.W / 2 - r_roof
    r = r_roof - lip
    hw, rim = 2.9, 0.35
    ring = stadium(cx, r, 0.0)
    n = len(ring)
    for k in range(n):
        a, c = ring[k], ring[(k + 1) % n]
        seg = math.dist(a, c)
        bays = 3 if abs(a[1] - c[1]) < 1e-6 else 1         # the two long sides; one window per end side
        poly(b, [a, c, (c[0], c[1], hw), (a[0], a[1], hw)], region="diner_wall", tint=True, tag="wall",
             unit=(4 * seg / bays + 0.01, hw + 0.01), origin=a)
    b.solids.append(np.array(ring + [(p[0], p[1], hw) for p in ring], float))
    b.decal(kit.Block(-cx, cx, -r, r, 0.0, hw, "diner_wall", True, b.tone), "front", 0.0, 0.0, 2.0, 2.45,
            "door_double")
    # the roof slab: chrome edge, the top in the district's roof color, a ceiling under the lip
    lo = stadium(cx, r_roof, hw)
    hi = [(p[0], p[1], hw + rim) for p in lo]
    for k in range(n):
        a, c = lo[k], lo[(k + 1) % n]
        poly(b, [a, c, hi[(k + 1) % n], hi[k]], region="diner_chrome", tag="wall",
             unit=(6.0, rim + 0.01), origin=a)
    poly(b, hi, region="metal", out=(0, 0, 1), tag="roof")
    poly(b, lo, UNDER, out=(0, 0, -1), tag="underside")
    b.solids.append(np.array(lo + hi, float))
    with part(b):                                        # the sign: a board standing on the roof
        z0 = hw + rim
        sx = -2.6                                        # over the left half: the bite takes the right end
        poly(b, [(sx - 1.75, -1.6, z0), (sx + 1.75, -1.6, z0), (sx + 1.75, -1.6, b.H), (sx - 1.75, -1.6, b.H)],
             region="diner_sign",
             out=(0, -1, 0), both=True)
    b.bite_hint = (b.W / 2, -r, hw + rim)


@kit.building("firehouse_a", district="oldtown", tone="sand", seed=159)
def firehouse_a(b):
    # A small brick fire station: two tall red engine doors with a brass bell between them, a
    # low hipped roof, and a slim hose tower at the back corner that stands 3 m above the
    # archetype's box (contract.TALL_PARTS: the game collides with the 9 m box).
    b.damage_hook = tidy
    o = style.EAVE
    hw = 7.5
    body = b.block(b.W - 2 * o, b.D - 2 * o, hw, at=(0.0, 0.0, 0.0), facade="brick_sash",
                   sides={"front": "fire_front"}, roof=False)
    b.hip(body, rise=b.H - hw, roof="tile_slate")
    b.door(body, "left", x=-4.5, kind="door_green", size=style.DOOR)
    # the hose tower: brick, louvres under a pointed cap
    t = 2.8
    x1, y1 = b.W / 2 - 0.2, b.D / 2 - 0.2                # the cap's eaves reach the box
    x0, y0 = x1 - t, y1 - t
    zt = b.top - 1.1
    b.box((x0, y0, 0.0), (x1, y1, zt), region="brick_plain", top="dark", tag="wall", solid=True)
    tower = kit.Block(x0, x1, y0, y1, 0.0, zt, "brick_plain", False, (1, 1, 1))
    for side in ("front", "left"):
        b.decal(tower, side, 0.0, zt - 1.5, 1.6, 0.9, "vent")
    e = 0.2
    cap = [(x0 - e, y0 - e, zt), (x1 + e, y0 - e, zt), (x1 + e, y1 + e, zt), (x0 - e, y1 + e, zt)]
    apex = ((x0 + x1) / 2, (y0 + y1) / 2, b.top)
    with part(b):
        for k in range(4):
            poly(b, [cap[k], cap[(k + 1) % 4], apex], region="tile_slate", tag="roof")
        poly(b, cap, UNDER, out=(0, 0, -1), tag="underside")
    b.solids.append(np.array(cap + [apex], float))
    b.bite_hint = (body.x0 + 0.5, body.y0, b.H)          # the front corner away from the tower


@kit.building("motel_a", district="suburb", tone="seafoam", seed=171)
def motel_a(b):
    # A two-storey motel row: a door and a window per room on both floors, an open walkway
    # with a railing along the upper floor under one low roof, a stair at its own left end (+x), and
    # a sleeping moon on a pole at the other.
    b.damage_hook = tidy
    yf = -b.D / 2
    xs = b.W / 2                                         # the stair's outer edge
    x0, x1 = -b.W / 2 + 2.4, xs - 1.7                    # the rooms
    y0, y1 = yf + 1.7, b.D / 2 - 0.3
    hw = 6.0
    body = b.block(x1 - x0, y1 - y0, hw, at=((x0 + x1) / 2, (y0 + y1) / 2, 0.0), facade="plaster_sash",
                   sides={"front": "motel_front", "left": "plaster_plain", "right": "plaster_plain"}, roof=False)
    # one low roof, rising to the street, over the rooms and the walkway
    rx0, rx1 = x0 - 0.3, x1 + 0.3
    zb, zf = hw + 0.05, b.H

    def zr(y):
        return zb + (b.D / 2 - y) * (zf - zb) / b.D
    slope = [(rx0, yf, zf), (rx1, yf, zf), (rx1, -yf, zb), (rx0, -yf, zb)]
    poly(b, slope, region="metal", out=(0, 0, 1), tag="roof", origin=slope[0])
    d = 0.2
    poly(b, [(p[0], p[1], p[2] - d) for p in slope], UNDER, out=(0, 0, -1), tag="underside")
    poly(b, [(rx0, yf, zf - d), (rx1, yf, zf - d), (rx1, yf, zf), (rx0, yf, zf)], TRIM, out=(0, -1, 0))
    poly(b, [(rx0, -yf, zb - d), (rx1, -yf, zb - d), (rx1, -yf, zb), (rx0, -yf, zb)], TRIM, out=(0, 1, 0))
    for x, sx in ((rx0, -1), (rx1, 1)):
        poly(b, [(x, yf, zf - d), (x, -yf, zb - d), (x, -yf, zb), (x, yf, zf)], TRIM, out=(sx, 0, 0))
    b.solids.append(np.array(slope + [(p[0], p[1], p[2] - d) for p in slope], float))
    # the walls up to the roof: a strip over the front wall, a wedge on each end wall
    poly(b, [(x0, y0, hw), (x1, y0, hw), (x1, y0, zr(y0) - d), (x0, y0, zr(y0) - d)], region="plaster_plain",
         tint=True, out=(0, -1, 0), tag="wall")
    for x, sx in ((x0, -1), (x1, 1)):
        poly(b, [(x, y0, hw), (x, y1, hw), (x, y0, zr(y0) - d)], region="plaster_plain", tint=True, out=(sx, 0, 0),
             tag="wall")
    # the walkway: slab, railing, a post at each end from the ground to the roof
    zw = 3.0
    with part(b):
        poly(b, [(x0, yf + 0.05, zw), (xs, yf + 0.05, zw), (xs, y0, zw), (x0, y0, zw)], "#ebe8e0", out=(0, 0, 1))
        poly(b, [(x0, yf + 0.05, zw - d), (xs, yf + 0.05, zw - d), (xs, y0, zw - d), (x0, y0, zw - d)], "#9a968c",
             out=(0, 0, -1), tag="underside")
        poly(b, [(x0, yf + 0.05, zw - d), (xs, yf + 0.05, zw - d), (xs, yf + 0.05, zw), (x0, yf + 0.05, zw)], TRIM,
             out=(0, -1, 0))
        rail = [(x0, yf + 0.08, zw), (xs, yf + 0.08, zw), (xs, yf + 0.08, zw + style.RAIL), (x0, yf + 0.08, zw + style.RAIL)]
        poly(b, rail, region="rail_metal", out=(0, -1, 0), both=True, unit=(12.0, style.RAIL + 0.01), origin=rail[0])
        for x, sx in ((x0, -1), (xs, 1)):                # the slab's two ends
            poly(b, [(x, yf + 0.05, zw - d), (x, y0, zw - d), (x, y0, zw), (x, yf + 0.05, zw)], TRIM, out=(sx, 0, 0))
    for x in (x0 + 0.15, x1 - 0.1):
        with part(b):
            post(b, x, yf + 0.25, 0.0, zr(yf + 0.25) - d, w=0.22, n=3)
    b.no_interior = [(np.array([x0 - 0.1, yf - 0.1, -0.1]), np.array([xs + 0.1, y0 - 0.05, hw + 1.0]))]
    # the stair: up along the end wall, from the back to the walkway
    ya = y0 + 6.0
    with part(b):
        poly(b, [(x1 + 0.1, ya, 0.0), (xs, ya, 0.0), (xs, y0, zw), (x1 + 0.1, y0, zw)], region="steps",
             out=(0, 1, 1), both=True)
    # the sign on its pole
    px, py = -b.W / 2 + 1.0, yf + 0.6
    with part(b):
        post(b, px, py, 0.0, 4.0, w=0.24, color=DARK, n=3)
        poly(b, [(px - 1.0, py, 4.0), (px + 1.0, py, 4.0), (px + 1.0, py, b.H), (px - 1.0, py, b.H)],
             region="motel_sign", out=(0, -1, 0), both=True)
    b.bite_hint = (xs, yf, b.H)                          # the stair end goes first: the sign stays up


# ---- the pictures -----------------------------------------------------------------------------
NEW = ["bld_bungalow_a", "bld_duplex_a", "bld_garage_a", "bld_diner_a", "bld_firehouse_a", "bld_motel_a"]
OLD = ["bld_house_a", "bld_shop_a", "bld_apartment_a"]


def _figures(x, y):
    """The hatchling and a soldier (the real models) standing at (x, y)."""
    import bpy
    import contract
    import mb_preview as P
    from city import sheet
    before = set(bpy.context.scene.objects)
    with P._quiet():
        bpy.ops.import_scene.gltf(filepath=os.path.join(contract.MODELS, "kaiju_lizard_s1.glb"))
    for ob in bpy.context.scene.objects:
        if ob not in before:
            ob.rotation_mode = "QUATERNION"
            if ob.parent is None:
                ob.location = (ob.location[0] + x, ob.location[1] + y, ob.location[2])
    sol = sheet._soldier(x + 4.0, y - 1.0)
    mat = bpy.data.materials.new("mbsheet_olive")
    bsdf = next(nd for nd in mat.node_tree.nodes if nd.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.08, 1.0)
    for ob in sol:
        ob.data.materials.append(mat)
    bpy.context.view_layer.update()


def scale_picture(out=None, size=(1800, 1000), samples=12):
    """Each new building whole (front row) and damaged (behind it), beside house_a, shop_a and
    apartment_a, with the hatchling and a soldier: docs/art/concept/city_starts_scale.png."""
    import contract
    import mb
    from city import roofs
    out = out or os.path.join(contract.CONCEPT, "city_starts_scale.png")
    arch = contract.archetypes()
    mb.reset()
    x = 0.0
    gap = 4.0
    for mid in OLD + NEW:
        w, dd = arch[mid.split("_", 1)[1]]["footprint"]
        roofs._import(contract.model_path(mid), x + w / 2, 0.0, keep=("intact",), tag=mid)
        if mid in NEW:
            roofs._import(contract.model_path(mid), x + w / 2, 22.0, keep=("damaged",), tag=mid + "_d")
        x += w + gap
    roofs._street(-3.0, x - 1.0, -8.0, 46.0, road=4.0).location = (0.0, -14.0, 0.0)
    _figures(40.0, -9.0)
    return mb.concept("city_starts_scale", out=out, backdrop="sky", azimuth=-14, elevation=22, fov=24, zoom=1.16,
                      size=size, samples=samples, sun_azimuth=-45, sun_elevation=46)


def street_picture(out=None, cell=(1500, 560)):
    """A street of the new buildings among the old ones in three districts' wall and roof
    colors, drawn the way the game paints them: docs/art/concept/city_starts_street.png."""
    import json
    import contract
    import mb
    import mb_preview as P
    from PIL import Image, ImageDraw
    from city import atlas, roofs, sheet
    out = out or os.path.join(contract.CONCEPT, "city_starts_street.png")
    with open(os.path.join(contract.ASSETS, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f).get("models", {})
    colors = roofs.city_colors("DISTRICT_ROOFS") or roofs.FALLBACK_ROOFS
    tints = roofs.city_colors("DISTRICT_TINTS")
    north = ["bld_bungalow_a", "bld_garage_a", "bld_duplex_a", "bld_diner_a", "bld_firehouse_a", "bld_motel_a"]
    south = ["bld_house_a", "bld_duplex_a", "bld_shop_a", "bld_bungalow_a", "bld_garage_a", "bld_house_c"]
    wanted = [d for d in ("Hollowmere", "Bellhaven", "Temple Hill") if d in colors] or list(colors)[:3]
    cells = []
    mb.reset()
    placed, (hx, hy) = roofs._place_rows(north, south, gap=3.5)
    roofs._street(-hx, hx, -hy, hy)
    frame = tuple(f"bld_{i:02d}_*" for _o, _m, i in placed)
    for dist in wanted:
        color = colors[dist]
        roofs._paint(placed, manifest, color, tints.get(dist, 0xffffff), atlas.ROOF_BASE)
        v = P.View(f"{dist}: roofs #{color:06x}", azimuth=16, elevation=30, fov=30, zoom=1.02, frame=frame)
        img, cam = sheet._render(v, cell, False, None)
        c = P._decorate_cell(img, v, cam, cell)
        ImageDraw.Draw(c).rectangle([cell[0] - 58, 10, cell[0] - 12, 34], fill=f"#{color:06x}", outline=(236, 238, 242))
        cells.append(c)
    img = Image.new("RGB", (cell[0], len(cells) * (cell[1] + 4)), (24, 26, 33))
    for i, c in enumerate(cells):
        img.paste(c.convert("RGB"), (0, i * (cell[1] + 4)))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    return out


if __name__ == "__main__":
    if "--pictures" in sys.argv:
        dest = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
        print(scale_picture(os.path.join(dest, "city_starts_scale.png") if dest else None))
        print(street_picture(os.path.join(dest, "city_starts_street.png") if dest else None))
        raise SystemExit(0)
    raise SystemExit(kit.run_family("city_starts"))
