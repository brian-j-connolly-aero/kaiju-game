#!/opt/mbtools/venv/bin/python
# mb-family: city_homes
"""Homes and shops of Port Meridian: the small buildings of the suburbs, the old town, Temple
Hill and the boardwalk (bld_house_b, bld_house_c, bld_rowhouse_a, bld_shop_a, bld_shop_b,
bld_shop_c, bld_pavilion_a, bld_shrine_a).

Hundreds of each stand in the city, so every one is a few big shapes on the shared atlas,
well inside the 120-triangle budget of the small class (the kit's destruction generator needs
the rest). The sample bld_house_a (tools/art/city_samples.py) sets the look they follow.

Parts the kit has no call for are built here with the kit's own face helpers, on the kit's
atlas regions: open posts, a porch roof, a shed dormer, a front parapet, a mansard, a canvas
tent roof, round drums with flat brims, a hanging bell and pennants.
"""
import math
import os
import sys
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from city import kit, style  # noqa: E402
from city.geom import Face, hex_rgb, map_region, plain  # noqa: E402

TRIM = "#f2efe8"          # white paint, as the kit's boards
UNDER = "#8a8478"         # undersides of roofs and canopies, as the kit's


# ---- damage tidying ---------------------------------------------------------------------------
# A small part made of several faces (an awning, a chimney, a porch roof) is registered with
# `part(b)`: the kit's damage then cuts it at the hole and keeps what is left while at least half
# of it stands, or takes all of it. Ceilings under a bitten roof get an upper side (an attic floor).
def _key(f):
    return tuple(np.round(np.asarray(f.pts, float).ravel(), 3))


def _base(tag):
    return tag.split("|")[0]


@contextmanager
def part(b):
    """with part(b): ...  the faces added inside stand or fall together in the damaged state.
    The faces carry the part's mark in their tag ("detail|p3"), which survives the kit's cuts."""
    i0 = len(b.intact.faces)
    yield
    if not hasattr(b, "parts"):
        b.parts = []
    mark = f"p{len(b.parts)}"
    faces = b.intact.faces[i0:]
    for f in faces:
        f.tag = f"{f.tag}|{mark}"
    b.parts.append(mark)


def tidy(b, m):
    whole = {_key(f) for f in b.intact.faces}
    # a bitten parapet: the pieces of its outer and inner faces never match, so give what is
    # left of its outer face a back side
    for zp, zt, *every in getattr(b, "parapets", []):
        for f in list(m.faces):
            if f.tag == "wall" and zp < f.center[2] < zt and abs(f.normal[2]) < 0.1 and _key(f) not in whole \
                    and (every or (f.region or "").startswith("cornice")):
                m.faces.append(plain([p - f.normal * 0.02 for p in f.pts[::-1]], "#d8d2c4", tag="interior"))
    # broken-open faces inside volumes that are not rooms (a porch, a kiosk cap) go too
    for lo, hi in getattr(b, "no_interior", []):
        m.faces = [f for f in m.faces if not (f.tag == "interior" and np.all(f.center >= lo) and np.all(f.center <= hi))]
    # (the kit gives broken-open faces and cut thin sheets their back sides, within the budget)
    for f in list(m.faces):
        if _key(f) in whole:
            continue
        if _base(f.tag) in ("detail", "underside") and f.normal[2] < -0.95 and f.center[2] > 1.0:
            m.faces.append(plain(f.pts[::-1], "#5d5852", tag="interior"))     # attic floor over a ceiling
    for f in m.faces:
        f.tag = _base(f.tag)


def walls_from(b, i0):
    """Faces added since i0 that the kit would treat as small details (parapet inner faces and
    caps) are cut with the walls instead, so a bitten parapet never shows the back of its wall."""
    for f in b.intact.faces[i0:]:
        if f.tag == "detail":
            f.tag = "wall"


# ---- small helpers on top of the kit ---------------------------------------------------------
def poly(b, pts, color=TRIM, *, region=None, out=None, tag="detail", tint=False, col=None,
         unit=None, origin=None, both=False, solid=False):
    """One flat polygon. `out` (a direction) flips the winding so the face looks that way.
    `region` maps it on the atlas (tinted with the building's tone when `tint`)."""
    pts = [np.asarray(p, float) for p in pts]
    if out is not None and Face(pts).normal @ np.asarray(out, float) < 0:
        pts = pts[::-1]
    if region:
        c = col if col is not None else (b.tone if tint else (1.0, 1.0, 1.0))
        faces = map_region(pts, region, col=c, tint=tint, tag=tag, unit=unit, origin=origin)
    else:
        faces = [plain(pts, color, tag=tag)]
    b.intact += faces
    if both:          # the back side, a hair behind, so neither side ever shows through the other
        back = [p - Face(pts).normal * 0.01 for p in pts[::-1]]
        poly(b, back, color, region=region, tag=tag, tint=tint, col=col, unit=unit, origin=origin)
    if solid:
        b.solids.append(np.array(pts, float))
    return faces


def post(b, x, y, z0, z1, w=0.24, color=TRIM, n=4):
    """An upright post or pole: sides only (its ends are hidden)."""
    r = w / 2 * (math.sqrt(2) if n == 4 else 1.0)
    ring = [(x + r * math.cos(math.pi / n + 2 * math.pi * k / n), y + r * math.sin(math.pi / n + 2 * math.pi * k / n))
            for k in range(n)]
    for k in range(n):
        a, c = ring[k], ring[(k + 1) % n]
        poly(b, [(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], z1), (a[0], a[1], z1)], color)


def ring_pts(cx, cy, r, z, n, phase=None):
    ph = math.pi / n if phase is None else phase
    return [(cx + r * math.cos(ph + 2 * math.pi * k / n), cy + r * math.sin(ph + 2 * math.pi * k / n), z)
            for k in range(n)]


def drum(b, center, r, z0, z1, *, region="plaster_plain", n=8, tint=True, per_side=None, phase=None, solid=True):
    """A round (n-sided) drum wall, sides only. `per_side` = (bays, storey px) maps one facade bay
    on every side (arches round a drum)."""
    lo = ring_pts(center[0], center[1], r, z0, n, phase)
    side = math.dist(lo[0][:2], lo[1][:2])
    for k in range(n):
        a, c = lo[k], lo[(k + 1) % n]
        q = [a, c, (c[0], c[1], z1), (a[0], a[1], z1)]
        unit = (per_side * side, z1 - z0) if per_side else None
        poly(b, q, region=region, tint=tint, tag="wall", unit=unit, origin=a if per_side else None)
    if solid:
        b.solids.append(np.array(lo + [(p[0], p[1], z1) for p in lo], float))


def disc(b, center, r, z, *, n=8, region=None, color=TRIM, up=True, tag="roof", phase=None):
    pts = ring_pts(center[0], center[1], r, z, n, phase)
    poly(b, pts, color, region=region, out=(0, 0, 1 if up else -1), tag=tag)


def slope_z(y, y_eave, z_eave, y_ridge, z_ridge):
    return z_eave + (y - y_eave) * (z_ridge - z_eave) / (y_ridge - y_eave)


def lean_to(b, x0, x1, y_wall, z_wall, y_front, z_front, *, roof="tile_red", board=0.16, side_boards=True):
    """A porch or canopy roof leaning on the front wall (y_wall) down to y_front (< y_wall):
    the slope, its underside, a fascia board and the two side boards."""
    poly(b, [(x0, y_front, z_front), (x1, y_front, z_front), (x1, y_wall, z_wall), (x0, y_wall, z_wall)],
         region=roof, out=(0, -1, 1), tag="roof")
    d = board
    poly(b, [(x0, y_front, z_front - d), (x1, y_front, z_front - d), (x1, y_wall, z_wall - d), (x0, y_wall, z_wall - d)],
         UNDER, out=(0, 0, -1), tag="underside")
    poly(b, [(x0, y_front, z_front - d), (x1, y_front, z_front - d), (x1, y_front, z_front), (x0, y_front, z_front)],
         TRIM, out=(0, -1, 0))
    if side_boards:
        for x, sx in ((x0, -1), (x1, 1)):
            poly(b, [(x, y_front, z_front - d), (x, y_wall, z_wall - d), (x, y_wall, z_wall), (x, y_front, z_front)],
                 TRIM, out=(sx, 0, 0))


def window_on(b, quad_center, along, normal, w=1.5, h=1.875, z=None, region="window_single", tint=True,
              up=(0.0, 0.0, 1.0)):
    """A window picture on any wall or slope: centered at quad_center (bottom edge middle)."""
    c = np.asarray(quad_center, float) + np.asarray(normal, float) * 0.03
    t = np.asarray(along, float)
    u = np.asarray(up, float)
    q = [c - t * w / 2, c + t * w / 2, c + t * w / 2 + u * h, c - t * w / 2 + u * h]
    poly(b, q, region=region, tint=tint, out=normal, tag="detail")


def front_parapet(b, x0, x1, y0, zp, zt, *, region="cornice_white", tint=True, depth=0.3, solid=True,
                  ends=True, cap=True):
    """A parapet along the front only (the front wall goes on up): outer face, back face, cap
    and two ends. Cut with the walls when bitten."""
    poly(b, [(x0, y0, zp), (x1, y0, zp), (x1, y0, zt), (x0, y0, zt)], region=region, tint=tint, out=(0, -1, 0),
         tag="wall")
    yb = y0 + depth
    poly(b, [(x0, yb, zp), (x1, yb, zp), (x1, yb, zt), (x0, yb, zt)], "#d8cfb8", out=(0, 1, 0), tag="wall")
    if cap:
        poly(b, [(x0, y0, zt), (x1, y0, zt), (x1, yb, zt), (x0, yb, zt)], TRIM, out=(0, 0, 1), tag="wall")
    for x, sx in ((x0, -1), (x1, 1)) if ends else ():
        poly(b, [(x, y0, zp), (x, yb, zp), (x, yb, zt), (x, y0, zt)], TRIM, out=(sx, 0, 0))
    if solid:
        b.solids.append(np.array([(x, y, z) for x in (x0, x1) for y in (y0, yb) for z in (zp, zt)], float))
    b.parapets = getattr(b, "parapets", []) + [(zp, zt)]


def gabled_dormer(b, cx, half, yd, slope, *, wall=1.3, pitch=0.6, roof="tile_red"):
    """A small gabled dormer standing on a front roof slope. `slope` = (y_eave, z_eave, y_ridge,
    z_ridge) of that slope; the dormer's front wall stands at yd."""
    ye, ze, yr, zr = slope
    k = (zr - ze) / (yr - ye)

    def y_at(z):
        return ye + (z - ze) / k
    zb = ze + (yd - ye) * k
    zw, za = zb + wall, zb + wall + pitch
    with part(b):
        poly(b, [(cx - half, yd, zb), (cx + half, yd, zb), (cx + half, yd, zw), (cx, yd, za), (cx - half, yd, zw)],
             region="plaster_plain", tint=True, out=(0, -1, 0))
        window_on(b, (cx, yd, zb + 0.08), (1, 0, 0), (0, -1, 0), w=1.1, h=min(1.2, wall - 0.12))
        for sx in (-1, 1):
            x = cx + sx * half
            poly(b, [(x, yd, zb), (x, y_at(zw), zw), (x, yd, zw)], region="plaster_plain", tint=True, out=(sx, 0, 0))
            poly(b, [(x, yd, zw), (cx, yd, za), (cx, y_at(za), za), (x, y_at(zw), zw)], region=roof,
                 out=(sx, 0, 1), tag="detail")


def pennant(b, x, y, z, color="#d7263d", length=1.4, height=0.7, dx=1.0, dy=0.0):
    tip = (x + dx * length, y + dy * length, z - height * 0.5)
    tri = [(x, y, z - height), tip, (x, y, z)]
    poly(b, tri, color, both=True)


# ---- the houses -------------------------------------------------------------------------------
@kit.building("house_b", district="suburb", tone="peach", seed=21)
def house_b(b):
    # A wide bungalow under a steep hipped roof of light clay tiles, a deep front porch on two
    # posts across most of its front, a chimney through the back slope.
    b.damage_hook = tidy
    o = style.EAVE
    body = b.block(b.W - 2 * o, 6.6, 3.4, at=(0.0, b.D / 2 - o - 3.3, 0.0), facade="plaster_sash", roof=False)
    b.hip(body, rise=b.H - 3.4, roof="tile_terra")
    b.door(body, "front", x=0.0, kind="door_green")
    yf = -b.D / 2
    px = 3.75
    with part(b):                                    # porch: deck, two posts, a lean-to roof
        b.box((-px - 0.1, yf + 0.05, 0.0), (px + 0.1, body.y0, 0.32), color="#d8d2c4", top=None)
        for sx in (-1, 1):
            post(b, sx * (px - 0.15), yf + 0.3, 0.32, 2.55, w=0.26)
        lean_to(b, -px, px, body.y0, 2.95, yf, 2.6, roof="tile_terra")
    b.solids.append(np.array([(x, y, z) for x in (-px, px) for y in (yf, body.y0) for z in (0.0, 2.6)], float))
    b.no_interior = [(np.array([-px - 0.2, yf - 0.1, -0.1]), np.array([px + 0.2, body.y0 - 0.05, 3.0]))]
    with part(b):
        b.chimney(-2.6, 2.4, 3.2, b.H - 0.3, w=0.9, d=0.8)
    # a gabled dormer over the door: the attic room, and a mark on the big roof from above
    rise = b.H - 3.4
    drop = rise * o / ((body.d) / 2)
    gabled_dormer(b, 0.0, 1.0, body.y0 + 0.35, (body.y0 - o, body.z1 - drop, body.cy, b.H), roof="tile_terra")
    b.bite_hint = (body.x1 - 1.0, body.y0, b.H)


@kit.building("house_c", district="suburb", tone="sky", seed=33)
def house_c(b):
    # A narrow clapboard cottage, a steep slate gable across the street, a wide dormer with its
    # attic window on the front slope (the half storey), an entry porch with its own roof.
    b.damage_hook = tidy
    o = style.EAVE
    d = 5.5
    y1 = b.D / 2 - o
    body = b.block(b.W - 2 * o, d, 2.6, at=(0.0, y1 - d / 2, 0.0), facade="clapboard", roof=False)
    rise = b.H - 2.6
    b.gable(body, rise=rise, along="x", roof="tile_slate")
    # entry porch on the right of the front, its lean-to roof in slate
    yf = -b.D / 2 + o
    porch = b.block(2.4, body.y0 - yf, 2.3, at=(-1.7, (yf + body.y0) / 2, 0.0), facade="clapboard",
                    sides={"back": None}, roof=None)        # a lid under its roof, for when the roof goes
    with part(b):
        b.shed(porch, rise=0.5, high="back", roof="tile_slate")
    b.door(porch, "front", x=0.0, kind="door_blue")
    # shed dormer on the front slope, on the left
    drop = rise * o / (d / 2)
    ye, ze = body.y0 - o, body.z1 - drop
    yr, zr = body.cy, body.z1 + rise
    x0, x1 = 0.2, 3.1
    yd = body.y0 + 0.35
    zb = slope_z(yd, ye, ze, yr, zr)
    zt = zr - 0.35
    yb = yr - 0.35 * (yr - ye) / (zr - ze)      # where the slope reaches the dormer's top
    with part(b):
        poly(b, [(x0, yd, zb), (x1, yd, zb), (x1, yd, zt), (x0, yd, zt)], region="plaster_plain", tint=True,
             out=(0, -1, 0), tag="detail")
        window_on(b, ((x0 + x1) / 2, yd, zb + 0.15), (1, 0, 0), (0, -1, 0), w=1.5, h=min(1.6, zt - zb - 0.3))
        for x, sx in ((x0, -1), (x1, 1)):
            poly(b, [(x, yd, zb), (x, yb, zt), (x, yd, zt)], region="plaster_plain", tint=True, out=(sx, 0, 0))
        poly(b, [(x0, yd - 0.15, zt), (x1, yd - 0.15, zt), (x1, yb, zt + 0.02), (x0, yb, zt + 0.02)],
             region="tile_slate", out=(0, 0, 1), tag="detail")
        poly(b, [(x0, yd - 0.15, zt - 0.14), (x1, yd - 0.15, zt - 0.14), (x1, yd - 0.15, zt), (x0, yd - 0.15, zt)],
             TRIM, out=(0, -1, 0))
        poly(b, [(x0, yd - 0.15, zt - 0.14), (x1, yd - 0.15, zt - 0.14), (x1, yd, zt - 0.14), (x0, yd, zt - 0.14)],
             UNDER, out=(0, 0, -1), tag="detail")
    with part(b):
        b.chimney(-2.2, body.cy + 1.2, 3.0, b.H - 0.1, w=0.8, d=0.7)
    b.bite_hint = (0.6, body.y0, b.H)            # the middle of the front slope: the gable ends stand


@kit.building("rowhouse_a", district="oldtown", tone="sand", seed=45)
def rowhouse_a(b):
    # A narrow three-storey terraced house: a flat front topped by a white parapet, a flat roof
    # behind it, a chimney stack on each party wall and a two-storey back wing under a lean-to.
    b.damage_hook = tidy
    w = 6.4
    yb = 2.4
    main = b.block(w, yb + 5.0, 8.25, at=(0.0, (yb - 5.0) / 2, 0.0), facade="plaster_sash", roof="tar")
    zp, zt = 8.25, 8.8
    y0 = main.y0
    front_parapet(b, main.x0, main.x1, y0, zp, zt)
    # a two-storey bay window on the right of the door, under its own flat lead top
    bay = b.block(2.7, 0.45, 5.5, at=(1.5, y0 - 0.225, 0.0), facade="plaster_sash", sides={"back": None},
                  roof="tar")
    _ = bay
    poly(b, [(-1.1, -0.9, zp + 0.01), (0.1, -0.9, zp + 0.01), (0.1, 0.3, zp + 0.01), (-1.1, 0.3, zp + 0.01)],
         region="glass_roof", out=(0, 0, 1), tag="roof")                              # roof hatch
    b.door(main, "front", x=-1.6, kind="door_blue")
    b.box((-2.85, -b.D / 2, 0.0), (-0.35, y0, 0.3), color="#d8d2c4", top=None)          # front step
    # chimney stacks on the party walls
    for sx in (-1, 1):
        with part(b):
            b.box((sx * 3.2 - 0.3, -0.4, 6.5), (sx * 3.2 + 0.3, 1.2, b.H - 0.3), region="brick_plain", top="dark",
                  bottom=True, solid=True)
    # back wing
    wing = b.block(3.3, b.D / 2 - style.EAVE - yb, 5.6,
                   at=(-w / 2 + style.EAVE + 1.65, (yb + b.D / 2 - style.EAVE) / 2, 0.0),     # eave flush with the side
                   facade="plaster_sash", sides={"front": None}, roof=False)
    b.shed(wing, rise=0.9, high="front", roof="tile_red")
    b.bite_hint = (main.x1, main.y0, b.H)


# ---- the shops --------------------------------------------------------------------------------
@kit.building("shop_a", district="suburb", tone="mint", seed=52)
def shop_a(b):
    # A one-storey corner shop: big windows on the street and round the corner, a striped awning
    # on both, a picture sign over each, a flat roof with skylights behind a low parapet.
    b.damage_hook = tidy
    aw = 1.5
    x0, x1 = -b.W / 2, b.W / 2 - aw
    y0, y1 = -b.D / 2 + aw, b.D / 2
    i0 = len(b.intact.faces)
    blk = b.block(x1 - x0, y1 - y0, 4.5, at=((x0 + x1) / 2, (y0 + y1) / 2, 0.0), facade="shopfront",
                  sides={"back": (None, "plaster_plain"), "right": (None, "plaster_plain")},
                  parapet=b.H - 4.5, parapet_region="cornice_white", roof="gravel", solid=False)
    walls_from(b, i0)
    b.parapets = [(4.5, b.H, "every face")]
    b.solids.append(np.array([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (0.0, 4.5)], float))
    for xa, xb in ((-4.6, 0.0), (0.0, 4.6)):         # two halves: a bite tears off one
        with part(b):
            b.awning(blk, "front", xa, xb, depth=aw - 0.05, stripes="awning_red")
    with part(b):
        b.awning(blk, "left", -3.9, 1.6, depth=aw - 0.05, stripes="awning_red")
    b.sign(blk, "front", "cone", x=-1.2, z=3.5, height=0.9)
    b.sign(blk, "left", "cup", x=-1.2, z=3.5, height=0.9)
    b.door(blk, "front", x=2.9, kind="door_double")
    b.door(blk, "back", x=2.5, kind="door_green", size=style.DOOR)
    for x, y in ((-2.0, 1.5), (1.6, 1.5)):
        poly(b, [(x - 0.9, y - 1.4, 4.56), (x + 0.9, y - 1.4, 4.56), (x + 0.9, y + 1.4, 4.56), (x - 0.9, y + 1.4, 4.56)],
             region="glass_roof", out=(0, 0, 1), tag="roof")
    b.bite_hint = (blk.x1, blk.y0, b.H)


@kit.building("shop_b", district="oldtown", tone="ochre", seed=64)
def shop_b(b):
    # Two storeys: a deep shop with a shopfront, two green awnings and a low parapet on the
    # street, and the brick flat over its back half under a low red hipped roof, so a little roof
    # terrace looks over the street.
    b.damage_hook = tidy
    o = style.EAVE
    aw = 1.5
    y0, y1 = -b.D / 2 + aw, b.D / 2 - o
    w = b.W - 2 * o
    plain_sides = ("brick_plain", "brick_plain")
    shop = b.block(w, y1 - y0, 4.5, at=(0.0, (y0 + y1) / 2, 0.0), facade="brick_plain", ground="shopfront",
                   sides={"back": plain_sides, "left": plain_sides, "right": plain_sides}, roof="gravel")
    front_parapet(b, shop.x0, shop.x1, shop.y0, 4.5, 5.05, region="cornice", tint=False, solid=False,
                  depth=0.02, ends=False, cap=False)            # a thin sign board over the shopfront
    flat = b.block(w, 6.2, b.H - 0.75 - 4.5, at=(0.0, y1 - 3.1, 4.5), facade="brick_sash", roof=False)
    b.hip(flat, rise=0.75, roof="tile_red")
    b.door(shop, "front", x=0.0, kind="door_double")
    b.door(flat, "front", x=4.9, kind="door_green")                                # onto the terrace
    for xa, xb in ((-6.3, -1.5), (1.5, 6.3)):
        with part(b):
            b.awning(shop, "front", xa, xb, depth=aw - 0.05, stripes="awning_green")
    b.sign(shop, "front", "loaf", x=-3.9, z=3.5, height=0.9)
    b.sign(shop, "front", "loaf", x=3.9, z=3.5, height=0.9)
    with part(b):
        b.chimney(-4.6, flat.cy + 1.2, 6.9, b.H - 0.05, w=0.8, d=0.7)
    b.bite_hint = (shop.x1 + 0.5, shop.y0 - 2.6, 4.8)   # the shop front corner, clear of the flat above


@kit.building("shop_c", district="oldtown", tone="salmon", seed=76)
def shop_c(b):
    # A corner block: shopfront and sign band on stone, a plastered upper storey, a deep white
    # cornice, and a slate mansard with dormer windows (the third storey) on top.
    b.damage_hook = tidy
    c = 0.3
    w = b.W - 2 * c
    blk = b.block(w, w, 7.5, at=(0.0, 0.0, 0.0), facade="plaster_sash", ground="shopfront",
                  sides={"back": ("plinth", "plaster_sash"), "right": ("plinth", "plaster_sash")}, roof=False)
    b.door(blk, "front", x=-3.0, kind="door_double")
    b.sign(blk, "front", "glasses", x=1.6, z=3.45, height=1.0)
    b.sign(blk, "left", "glasses", x=0.0, z=3.45, height=1.0)
    zc0, zc1 = 7.5, 7.95
    b.box((-b.W / 2, -b.W / 2, zc0), (b.W / 2, b.W / 2, zc1), color=TRIM, top="white", bottom=True, solid=True,
          tag="wall")
    # mansard
    zt = b.H
    ri = w / 2 - 1.1
    ro = w / 2
    base = [(-ro, -ro), (ro, -ro), (ro, ro), (-ro, ro)]
    top = [(-ri, -ri), (ri, -ri), (ri, ri), (-ri, ri)]
    for k in range(4):
        a0, a1 = base[k], base[(k + 1) % 4]
        t0, t1 = top[k], top[(k + 1) % 4]
        q = [(a0[0], a0[1], zc1), (a1[0], a1[1], zc1), (t1[0], t1[1], zt), (t0[0], t0[1], zt)]
        poly(b, q, region="tile_slate", tag="roof")
        # two dormer windows on every slope
        e = np.array([a1[0] - a0[0], a1[1] - a0[1], 0.0])
        e /= np.linalg.norm(e)
        nrm = np.array([e[1], -e[0], 0.0])
        up = np.array([-nrm[0] * 1.1, -nrm[1] * 1.1, zt - zc1])
        up /= np.linalg.norm(up)
        mid = np.array([(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, zc1]) + up * 0.25
        n_s = np.cross(e, up)
        for dx in (-2.4, 2.4):
            window_on(b, mid + e * dx, e, n_s, w=1.5, h=1.6, up=up, tint=False)
    poly(b, [(t[0], t[1], zt) for t in top], region="tar", out=(0, 0, 1), tag="roof")
    b.solids.append(np.array([(p[0], p[1], zc1) for p in base] + [(p[0], p[1], zt) for p in top], float))
    b.bite_hint = (blk.x1, blk.y0, b.H)


# ---- the boardwalk pavilion and the wayside shrine ------------------------------------------
def tent(b, x0, x1, y0, y1, z0, rise, region="awning_red", under="#efe6d8"):
    """A canvas hipped roof, its stripes running down every slope, and its underside."""
    zr = z0 + rise
    half = min(x1 - x0, y1 - y0) / 2
    cy = (y0 + y1) / 2
    ra, rb = (x0 + half, cy, zr), (x1 - half, cy, zr)
    faces = [[(x0, y0, z0), (x1, y0, z0), rb, ra], [(x1, y1, z0), (x0, y1, z0), ra, rb],
             [(x1, y0, z0), (x1, y1, z0), rb], [(x0, y1, z0), (x0, y0, z0), ra]]
    slope = math.hypot(half, rise)
    for f in faces:
        span = max(math.dist(f[0][:2], f[1][:2]), 0.1)
        poly(b, f, region=region, unit=(span + 0.01, slope + 0.01), origin=f[0], tag="roof")
    poly(b, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], under, out=(0, 0, -1), tag="underside")
    b.solids.append(np.array([p for f in faces for p in f], float))
    return ra, rb


@kit.building("pavilion_a", district="boardwalk", tone="white", seed=88)
def pavilion_a(b):
    # A seaside pavilion: an arcaded hall under a red-and-white striped canvas roof, two round
    # kiosks with striped cone caps at the front corners, pennants on the ridge.
    b.damage_hook = tidy
    o = 0.6
    hx = 6.2
    y0, y1 = -3.4, b.D / 2 - o
    hall = b.block(2 * hx, y1 - y0, 4.0, at=(0.0, (y0 + y1) / 2, 0.0), facade="arcade", roof=False)
    b.door(hall, "front", x=0.0, kind="door_double")
    ra, rb = tent(b, -hx - o, hx + o, y0 - o, y1 + o, 3.85, b.H - 0.7 - 3.85)
    for p, dx in ((ra, -1.0), (rb, 1.0)):
        with part(b):
            post(b, p[0], p[1], p[2] - 0.2, b.H, w=0.12, color="#f5f2ea", n=3)
            pennant(b, p[0], p[1], b.H - 0.05, color="#2f7fd6" if dx < 0 else "#d7263d", dx=dx, length=1.3)
    # kiosks
    r, rc = 1.45, 1.9
    for sx in (-1, 1):
        cx, cy = sx * (b.W / 2 - rc), -b.D / 2 + rc * math.sin(math.pi / 3)
        drum(b, (cx, cy), r, 0.0, 3.3, region="plaster_plain", n=6, phase=0.0)
        disc(b, (cx, cy), r, 3.3, n=6, color="#d8d2c4", phase=0.0)      # a lid, for when the cap goes
        with part(b):
            disc(b, (cx, cy), rc, 3.3, n=6, color=UNDER, up=False, tag="underside", phase=0.0)
            ring = ring_pts(cx, cy, rc, 3.3, 6, phase=0.0)
            for k in range(6):
                a, c = ring[k], ring[(k + 1) % 6]
                poly(b, [a, c, (cx, cy, 5.6)], region="awning_red", unit=(rc * 2 + 0.01, 3.0), origin=a, tag="roof")
        b.solids.append(np.array(ring + [(cx, cy, 5.6)], float))
        window_on(b, (cx, cy - r * math.sin(math.pi / 3), 1.0), (1, 0, 0), (0, -1, 0), w=1.2, h=1.5)
    b.bite_hint = (hx, y0, b.H)


@kit.building("shrine_a", district="temple", tone="cream", seed=97)
def shrine_a(b):
    # A wayside shrine: three cream drums stacked smaller and smaller, each under a flat
    # terracotta brim, a gold finial, and one bronze bell on a rope under the lowest brim.
    b.damage_hook = tidy
    n = 8
    k = 1 / math.cos(math.pi / n)               # flat-to-flat: the footprint is met by the brim's sides
    tiers = [(3.3, 0.0, 4.2, 5.0), (2.4, 4.2, 6.9, 3.6), (1.6, 6.9, 9.1, 2.5)]
    for i, (r, z0, z1, rb) in enumerate(tiers):
        if i == 0:
            drum(b, (0, 0), r, z0, z1, region="arcade", n=n, per_side=4, tint=True, solid=False)
        else:
            drum(b, (0, 0), r, z0, z1, region="plaster_plain", n=n, solid=False)
            # one lit window on the street side of each upper drum
            ap = r * math.cos(math.pi / n)
            window_on(b, (0.0, -ap, z0 + 0.45), (1, 0, 0), (0, -1, 0), w=1.1, h=1.4)
        R = rb * k
        disc(b, (0, 0), R, z1, n=n, region="tile_terra", up=True)
        disc(b, (0, 0), R, z1 - 0.005, n=n, color="#b9603f", up=False, tag="underside")   # a hair below the top
        # chunk volumes: squares on the flat sides, so every chunk keeps its own wall and roof
        a = r * math.cos(math.pi / n)
        b.solids.append(np.array([(x, y, z) for x in (-a, a) for y in (-a, a) for z in (z0, z1)], float))
        b.solids.append(np.array([(x, y, z) for x in (-rb, rb) for y in (-rb, rb) for z in (z1 - 0.3, z1)], float))
    with part(b):
        b.cone((0, 0), 0.7, 9.1, b.H, n=6, color="#e3b23c")
    b.solids.append(np.array(ring_pts(0, 0, 0.7, 9.1, 6) + [(0.0, 0.0, b.H)], float))
    # the bell
    yb = -4.15
    with part(b):
        post(b, 0.0, yb, 2.8, 4.18, w=0.08, color="#c9b48a", n=3)
        bell = ring_pts(0.0, yb, 0.55, 1.95, 4, phase=math.pi / 4)
        top = ring_pts(0.0, yb, 0.28, 2.85, 4, phase=math.pi / 4)
        for j in range(4):
            poly(b, [bell[j], bell[(j + 1) % 4], top[(j + 1) % 4], top[j]], "#b5813a")
        poly(b, top, "#9a6a2c", out=(0, 0, 1))
        poly(b, bell, "#6b4a22", out=(0, 0, -1))
    b.bite_hint = (1.5, -1.5, b.H)              # the top tier and the finial are knocked off

    def hook(b, m):
        tidy(b, m)
        m.faces = [f for f in m.faces if not (f.tag == "interior" and f.center[2] > 9.2)]
        # the top tier is gone: no sliver of its brim may be left hanging in the air
        m.faces = [f for f in m.faces if f.center[2] < 8.5]
    b.damage_hook = hook


# ---- the family picture ------------------------------------------------------------------------
def family_picture(out=None, size=(1600, 900), samples=16):
    """All the family's buildings on a street corner, by day, at true relative scale, with the
    hatchling, three soldiers and street props: docs/art/concept/city_homes.png.
    Run: tools/art/city_homes.py --family   (about 40 s on 2 threads)"""
    import bpy
    import contract
    import mb
    import mb_preview as P
    from city import sheet

    out = out or os.path.join(contract.CONCEPT, "city_homes.png")

    def place(path, x, y, keep=None, yaw=0.0):
        before = set(bpy.context.scene.objects)
        with P._quiet():
            bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.context.scene.objects if o not in before]
        if keep:
            for o in list(new):
                if o.name.split(".")[0] not in keep and not (o.parent and o.parent.name.split(".")[0] in keep):
                    bpy.data.objects.remove(o, do_unlink=True)
                    new.remove(o)
        for o in new:
            o.rotation_mode = "QUATERNION"
        for o in new:
            if o.parent is None:
                o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
                if yaw:
                    o.rotation_mode = "XYZ"
                    o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                                        o.rotation_euler[2] + math.radians(yaw))
        return new

    def model(mid):
        return contract.model_path(mid)

    mb.reset()


    def place(path, x, y, keep=None, yaw=0.0, helper=False):
        before = set(bpy.context.scene.objects)
        with P._quiet():
            bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.context.scene.objects if o not in before]
        if keep:
            for o in list(new):
                if o.name.split(".")[0] not in keep and not (o.parent and o.parent.name.split(".")[0] in keep):
                    bpy.data.objects.remove(o, do_unlink=True)
                    new.remove(o)
        for o in new:
            o.rotation_mode = "QUATERNION"
            if helper:
                o["mb_helper"] = True
        for o in new:
            if o.parent is None:
                o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
                if yaw:
                    o.rotation_mode = "XYZ"
                    o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1], o.rotation_euler[2] + math.radians(yaw))
        return new


    def model(mid):
        return contract.model_path(mid)


    # ---- a street corner: one row along the main street, one up the side street --------------------
    SW = 3.2                   # sidewalk width
    ROAD = 7.0                 # half the road width
    arch = contract.archetypes()


    def fp(mid):
        a = arch[mid.split("_", 1)[1]]
        return a["footprint"]


    row1 = [("bld_pavilion_a", 3.0), ("bld_shrine_a", 3.0), ("bld_house_c", 3.0), ("bld_house_b", 3.0), ("bld_shop_a", 0.0)]
    y_front = ROAD + SW + 0.4
    lots = []
    GREEN = {"bld_house_c", "bld_house_b", "bld_shrine_a"}
    x = 0.0
    for mid, gap in row1:
        w, d = fp(mid)
        place(model(mid), x + w / 2, y_front + d / 2, keep={"intact"})
        if mid in GREEN:
            lots.append((x - 1.5, x + w + 1.5, y_front, y_front + 14.0))
        x += w + gap
    x_corner = x                                         # the corner shop's left side is on the side street
    xs = x_corner + SW + 0.4 + ROAD                      # side street centre line
    row2 = [("bld_shop_c", 0.0), ("bld_shop_b", 0.0), ("bld_rowhouse_a", 0.0), ("bld_rowhouse_a", 0.0),
            ("bld_rowhouse_a", 0.0)]
    x_front2 = xs + ROAD + SW + 0.4
    y = y_front
    for mid, gap in row2:
        w, d = fp(mid)
        place(model(mid), x_front2 + d / 2, y + w / 2, keep={"intact"}, yaw=-90)
        y += w + gap
    y_end = y

    g = mb.Geo()


    def quad(x0, x1, y0, y1, z, color):
        g.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], color=color)


    X0, X1 = -6.0, x_front2 + 18.0
    Y0, Y1 = -ROAD - SW - 3.0, y_end + 6.0
    YB = y_front + 15.0
    quad(X0, xs - ROAD, Y0, YB + 2 * ROAD, 0.02, "#2b3040")                    # asphalt
    quad(xs - ROAD, X1, Y0, Y1, 0.02, "#2b3040")
    quad(X0, xs - ROAD, ROAD, YB, 0.16, "#b9bcc6")                            # the block behind row 1
    quad(xs + ROAD, X1, ROAD, Y1, 0.16, "#b9bcc6")                            # the block behind row 2
    quad(X0, xs - ROAD, Y0, -ROAD, 0.16, "#b9bcc6")                           # near blocks
    quad(xs + ROAD, X1, Y0, -ROAD, 0.16, "#b9bcc6")
    for x0, x1, y0, y1 in lots:
        quad(x0, x1, y0, y1, 0.17, "#4fbf5f")
    quad(xs + ROAD + SW, X1, Y0, -ROAD - SW, 0.17, "#4fbf5f")                 # a green on the near corner
    for k in range(int((X1 - X0) / 6) + 1):                                    # centre lines
        xa = X0 + k * 6.0
        if not (xs - ROAD - 3.0 < xa < xs + ROAD):
            quad(xa, xa + 3.0, -0.12, 0.12, 0.03, "#e8e4da")
    for k in range(int((Y1 - ROAD) / 6) + 1):
        ya = ROAD + 1.0 + k * 6.0
        quad(xs - 0.12, xs + 0.12, ya, ya + 3.0, 0.03, "#e8e4da")
    for k in range(6):                                                          # a zebra crossing
        xa = xs - ROAD + 1.0 + k * 2.2
        quad(xa, xa + 1.1, -ROAD - 0.0, -ROAD + 3.0, 0.03, "#e8e4da")
    mb.node("street", g)

    for lx in (6.0, 26.0, 46.0):
        place(model("prop_lamp"), lx, ROAD + 1.0)
    for ly in (14.0, 34.0):
        place(model("prop_lamp"), xs + ROAD + 1.0, ly, yaw=-90)
    for tx, ty in ((x_front2 + 6.0, -ROAD - SW - 1.5), (x_front2 + 13.0, -ROAD - SW - 2.0), (21.0, ROAD + 1.6)):
        place(model("prop_tree_a" if tx > 30 else "prop_tree_b"), tx, ty)
    place(model("prop_car_sedan"), 18.0, 2.4, yaw=90)
    place(model("prop_car_taxi"), xs - 2.4, 22.0, yaw=0)
    place(model("prop_bus"), 30.0, -2.6, yaw=-90)
    place(model("kaiju_lizard_s1"), xs - 1.0, -1.0, yaw=30)
    sol = sheet._soldier(xs - 8.0, -4.0) + sheet._soldier(xs - 9.2, -5.0) + sheet._soldier(xs - 7.4, -5.6)
    mat = bpy.data.materials.new("mbsheet_olive")
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.08, 1.0)
    for o in sol:
        o.data.materials.append(mat)
    bpy.context.view_layer.update()

    return mb.concept("city_homes", out=out, backdrop="sky", azimuth=-30, elevation=30, fov=30, zoom=1.2,
                      size=size, samples=samples, sun_azimuth=-40, sun_elevation=48)


if __name__ == "__main__":
    if "--family" in sys.argv:
        print(family_picture())
        raise SystemExit(0)
    raise SystemExit(kit.run_family("city_homes"))
