"""Parts the kit has no call of its own for, shared by the small-building families
(tools/art/city_homes.py, tools/art/city_starts.py): open posts, porch and canopy roofs, a
gabled dormer, a front parapet, round drums and discs, a window on any wall or slope, and the
`part` / `tidy` pair that keeps small parts whole or lets them go together in the damaged state.
All of it is built with the kit's own face helpers on the kit's atlas regions.
"""
import math
from contextlib import contextmanager

import numpy as np

from .geom import Face, map_region, plain

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
