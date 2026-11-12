#!/opt/mbtools/venv/bin/python
# mb-family: city_industry
"""Port Meridian's industry, harbor and bridges.

    bld_factory_b    big steel hall: concrete base, rusty cladding, a roof lantern with vents,
                     a yellow overhead crane running out of its end on a gantry, a lean-to office
    bld_warehouse_a  dock warehouse: blue-grey cladding under a barrel roof, loading dock and
                     canopy with three roller doors
    bld_tank_a       round storage tank, white panels and a coloured belt, conical roof,
                     a spiral stair up the outside and a railed walkway round the roof
    bld_crane_a      harbor gantry crane: four legs on bogies, girder, A-frame, raised boom,
                     machinery house and counterweight; harbor red with white
    bld_container_a  a stack of shipping containers, three high, mixed colors, stepped
    bld_bridge_a     road bridge: deck at ground level, sidewalks, railings, lamps, four
                     stone end pylons with lanterns (the piers)
    bld_bridge_b     the Grand Harbor Bridge: deck at ground level under two rust-red truss
                     arches (36 m), hangers, three high cross braces, stone end piers

Built from the city kit's parts (tools/art/city/README.md); the damaged, rubble and chunk
states come from the kit's one generator. Parts the kit does not have are the small helpers
below (open-ended bars, two-sided bands, voxel stacks, barrel roofs, arch ribbons). They use
only the shared atlas.

Bridges (class "bridge", passable): units drive on the ground plane through the box, so the
deck sits at ground level (road surface at 0.3 m) over the whole length and everything that
stands up stays within the outer metre of each side. The client stretches the model to each
crossing (bridge_a 57 to 82 m long, 16 to 24 m wide): the spans repeat evenly along the length.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from city import kit, style  # noqa: E402
from city.geom import Mesh, hex_rgb, map_region, plain  # noqa: E402

UP = np.array([0.0, 0.0, 1.0])

RUST_CLAD = "#e6b39a"     # multiplies the grey cladding into weathered rust
HARBOR_RED = "#e2533a"
HARBOR_RED_DK = "#b23d2a"
CRANE_YELLOW = "#f0b429"
STEEL = "#4a4e58"
STEEL_LT = "#8a96a8"
CONCRETE = "#c9c4b8"
CONCRETE_DK = "#9c978c"
STONE = "#ddd3bf"
WHITE = "#f2f0ea"
WALK = "#cfcac0"          # sidewalk paving on the bridges
ARCH_RED = "#b5452f"


# ==== helpers the kit does not have ==========================================================
def quad(b, pts, region=None, color="#ffffff", tone=None, unit=None, tag="detail", origin=None,
         two_sided=False):
    """One planar polygon (counter-clockwise seen from its front), on an atlas region or a flat
    color. `tone` multiplies the region; `unit` (m across, m up) is one region repeat."""
    out = []
    polys = [pts]
    if two_sided:
        # the back face sits 3 cm behind the front one, so the two never fight for the same pixels
        from city.geom import Face
        nrm = Face([np.asarray(q, float) for q in pts]).normal * 0.03
        polys.append([np.asarray(q, float) - nrm for q in reversed(pts)])
    for p in polys:
        if region:
            out += map_region(p, region, col=hex_rgb(tone) if tone else (1, 1, 1), tag=tag, unit=unit,
                              origin=origin)
        else:
            out.append(plain(p, color, tag=tag))
    b.intact += out
    return out


def orient(pts, n):
    """The polygon wound so that its front faces direction n."""
    from city.geom import Face
    f = Face([np.asarray(q, float) for q in pts])
    return list(pts) if f.normal @ np.asarray(n, float) >= 0 else list(reversed(pts))


def bar(b, p0, p1, w, d=None, *, color=STEEL, region=None, tone=None, unit=None, caps=(False, False),
        tag="detail", solid=False, shade=True):
    """A square bar between two points with open ends (8 triangles): legs, girders, braces.
    The four sides are shaded a little differently so the bar reads in flat light."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    ax = p1 - p0
    ax /= np.linalg.norm(ax)
    a = np.cross(ax, UP)
    if np.linalg.norm(a) < 1e-6:
        a = np.array([1.0, 0.0, 0.0])
    a /= np.linalg.norm(a)
    c = np.cross(a, ax)
    hw, hd = w / 2, (d or w) / 2
    ring = [a * hw + c * hd, -a * hw + c * hd, -a * hw - c * hd, a * hw - c * hd]
    m = []
    base = hex_rgb(color)
    for k in range(4):
        q = [p0 + ring[k], p0 + ring[(k + 1) % 4], p1 + ring[(k + 1) % 4], p1 + ring[k]]
        out = ring[k] + ring[(k + 1) % 4]
        from city.geom import Face
        if Face(q).normal @ out < 0:
            q.reverse()
        k_sh = (1.0, 0.86, 0.74, 0.9)[k] if shade else 1.0
        col = tuple(min(1.0, x * k_sh) for x in (hex_rgb(tone) if (region and tone) else base))
        if region:
            m += map_region(q, region, col=col, tag=tag, unit=unit)
        else:
            m.append(plain(q, col, tag=tag))
    for end, sgn, on in ((p1, 1.0, caps[1]), (p0, -1.0, caps[0])):
        if not on:
            continue
        q = [end + r for r in ring]
        from city.geom import Face
        if Face(q).normal @ (ax * sgn) < 0:
            q.reverse()
        m.append(plain(q, color, tag=tag))
    b.intact += m
    if solid:
        b.solids.append(np.array([p for f in m for p in f.pts], float))
    return m


def box(b, lo, hi, *, color="#d8d2c4", region=None, tone=None, top=None, top_color=None, sides=None,
        unit=None, tag="detail", solid=False, bottom=False, shade=True):
    """An axis-aligned box. `sides` limits which of front/left/back/right/top are made.
    Flat-colored sides are shaded a little per direction so corners read."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    quads = {
        "front": [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
        "left": [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
        "back": [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
        "right": [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
        "top": [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
    }
    if bottom:
        quads["bottom"] = [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)]
    sh = {"front": 0.95, "left": 0.86, "back": 0.8, "right": 0.9, "top": 1.0, "bottom": 0.6}
    out = []
    for k, q in quads.items():
        if sides is not None and k not in sides:
            continue
        reg = top if (k == "top" and top is not None) else region
        if k == "top" and top_color is not None:
            reg = None
        col = top_color if (k == "top" and top_color) else color
        if reg:
            t = tone if tone else None
            out += quad(b, q, region=reg, tone=t, unit=unit, tag=tag)
        else:
            c = hex_rgb(col)
            if shade:
                c = tuple(x * sh[k] for x in c)
            out += quad(b, q, color=c, tag=tag)
    if solid:
        b.solids.append(np.array([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float))
    return out


def walls(b, x0, x1, y0, y1, z0, z1, region, *, tone=None, skip=(), unit_h=None):
    """The four walls of a box body on one region (facades stretch to whole bays)."""
    blk = kit.Block(x0, x1, y0, y1, z0, z1, region, False, hex_rgb(tone) if tone else (1, 1, 1))
    for name in kit.SIDES:
        if name in skip:
            continue
        a, c, _ = blk.side(name)
        b.wall(a, c, z0, z1, region, tone=hex_rgb(tone) if tone else (1.0, 1.0, 1.0), storey=unit_h)
    return blk


def plain_band(b, x0, x1, y0, y1, z0, z1, region, *, tone=None, skip=()):
    """Four walls on a texture region, each stretched over one picture (2 triangles a side)."""
    blk = kit.Block(x0, x1, y0, y1, z0, z1, region, False, (1, 1, 1))
    for name in kit.SIDES:
        if name in skip:
            continue
        a, c, _ = blk.side(name)
        ln = math.dist(a, c)
        quad(b, [(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], z1), (a[0], a[1], z1)], region=region, tone=tone,
             unit=(ln / max(1, round(ln / 16.0)) + 0.01, z1 - z0 + 0.01), tag="wall", origin=(a[0], a[1], z0))


def solid_box(b, x0, x1, y0, y1, z0, z1):
    b.solids.append(np.array([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float))


def _face_key(f):
    return (tuple(np.round(f.center, 2)), round(f.area, 2))


def remember_intact(b):
    """Keys of the intact faces, so a damage hook can tell which faces the bites clipped."""
    b.intact_keys = {_face_key(f) for f in b.intact.faces}


def group(b, first):
    """Faces added since index `first` stand or fall together in the damaged state (a pylon,
    a lamp): when a bite takes any of them, `drop_broken_groups` takes all."""
    if not hasattr(b, "groups"):
        b.groups = []
        b.group_boxes = []
    faces = b.intact.faces[first:]
    b.groups.append({_face_key(f) for f in faces})
    pts = np.array([p for f in faces for p in f.pts])
    b.group_boxes.append((pts.min(axis=0) - 0.1, pts.max(axis=0) + 0.1))


def drop_broken_groups(b, mesh):
    have = {_face_key(f) for f in mesh.faces}
    dead, boxes = set(), []
    for g, bx in zip(getattr(b, "groups", []), getattr(b, "group_boxes", [])):
        if not g <= have:
            dead |= g
            boxes.append(bx)

    keys = getattr(b, "intact_keys", set())

    def inside(f):     # cut pieces and the broken-open inside of a dropped part go with it
        c = f.center
        if c[2] < 0.5 or (_face_key(f) in keys):
            return False
        return any(np.all(c >= lo) and np.all(c <= hi) for lo, hi in boxes)
    if dead:
        mesh.faces = [f for f in mesh.faces if _face_key(f) not in dead and not inside(f)]


def backface_clipped(b, mesh, regions=None, min_z=0.0, tags=None):
    """Damage hook part: thin parts (bars, ribbons, a tank roof) have no inside. Where a bite
    clipped one of their faces, add the face again reversed 2 cm inside, so the open cut shows
    the part's own inside color instead of a hole."""
    from city import budgets
    keys = getattr(b, "intact_keys", set())
    room = budgets.budget(b.id) - mesh.tris - 4
    extra = []
    for f in mesh.faces:
        if f.tag in ("interior", "rubble") or _face_key(f) in keys or f.center[2] < min_z:
            continue
        if regions is not None and f.region not in regions:
            continue
        if tags is not None and f.tag not in tags:
            continue
        n = f.normal
        back = f.copy()
        back.pts = [p - n * 0.02 for p in reversed(f.pts)]
        if back.uv:
            back.uv = list(reversed(back.uv))
        back.col = tuple(c * 0.55 for c in f.col)
        back.tag = "interior"
        extra.append(back)
    extra.sort(key=lambda f: -f.area)              # the biggest openings first, within the budget
    kept, used = [], 0
    for f in extra:
        if used + len(f.pts) - 2 <= room:
            kept.append(f)
            used += len(f.pts) - 2
    mesh += kept


# ==== factory_b: the big steel hall ===========================================================
def gable_x(b, blk, rise, *, roof="metal", overhang=style.EAVE, end_region="metal_plain", end_tone=None,
            pieces=2):
    """A cheap pitched roof with its ridge along x: two slopes stretched over `pieces` repeats,
    a lowered reversed copy as the underside, fascia boards on the eaves, gable-end triangles."""
    o = overhang
    z0, zr = blk.z1, blk.z1 + rise
    drop = rise * o / (blk.d / 2)
    ze = z0 - drop
    xa, xb, ym = blk.x0 - o, blk.x1 + o, blk.cy
    front = [(xa, blk.y0 - o, ze), (xb, blk.y0 - o, ze), (xb, ym, zr), (xa, ym, zr)]
    back = [(xb, blk.y1 + o, ze), (xa, blk.y1 + o, ze), (xa, ym, zr), (xb, ym, zr)]
    slope = math.hypot(blk.d / 2 + o, rise + drop)
    for q in (front, back):
        quad(b, q, region=roof, unit=((xb - xa) / pieces + 0.01, slope + 0.01), tag="roof")
        low = [np.array(p, float) - UP * 0.22 for p in reversed(q)]
        b.intact += [plain(low, "#7c7a74", tag="underside")]
    for e0, e1, n in ((front[0], front[1], (0, -1, 0)), (back[0], back[1], (0, 1, 0)),
                      (front[0], front[3], (-1, 0, 0)), (back[1], back[2], (-1, 0, 0)),
                      (front[1], front[2], (1, 0, 0)), (back[0], back[3], (1, 0, 0))):
        e0, e1 = np.array(e0, float), np.array(e1, float)
        b.intact += [plain(orient([e0 - UP * 0.25, e1 - UP * 0.25, e1, e0], n), "#e8e4da")]
    ends = [[(blk.x1, blk.y0, z0), (blk.x1, blk.y1, z0), (blk.x1, ym, zr)],
            [(blk.x0, blk.y1, z0), (blk.x0, blk.y0, z0), (blk.x0, ym, zr)]]
    for t in ends:
        quad(b, t, region=end_region, tone=end_tone, unit=(blk.d + 0.01, rise + 0.01), tag="wall")
    b.solids.append(np.array(front + back, float))
    return zr


@kit.building("factory_b", district="industry", tone="concrete", seed=21)
def factory_b(b):
    # Hall: a concrete loading storey, rusty cladding above, a low gable roof running the long
    # way with a glazed lantern along the ridge and vent cowls on it. An overhead crane runs out
    # of the left gable on its gantry (the yard); a flat concrete office along the front.
    hx0, hx1, hy0, hy1 = -21.625, 11.0, -8.25, 14.625
    wall_top = 11.5
    walls(b, hx0, hx1, hy0, hy1, 0.0, style.GROUND, "loading")
    plain_band(b, hx0, hx1, hy0, hy1, style.GROUND, wall_top - 2.6, "metal_plain", tone=RUST_CLAD)
    walls(b, hx0, hx1, hy0, hy1, wall_top - 2.6, wall_top, "metal_clad", tone="#f4f0ea", unit_h=2.6)
    solid_box(b, hx0, hx1, hy0, hy1, 0.0, wall_top)
    blk = kit.Block(hx0, hx1, hy0, hy1, 0.0, wall_top, "metal_clad", False, hex_rgb(RUST_CLAD))
    ridge = gable_x(b, blk, 3.4, roof="metal", end_tone=RUST_CLAD)
    # ridge lantern: glazed sides, metal top, set into the ridge
    ly = (hy0 + hy1) / 2
    lz0, lz1 = ridge - 0.9, ridge + 1.55
    box(b, (hx0 + 3.0, ly - 2.2, lz0), (hx1 - 3.0, ly + 2.2, lz1), region="glass_roof", top="metal",
        unit=(13.5, 2.46), tag="roof", solid=True)
    for x in (-11.0, 3.0):                               # vent cowls on the lantern
        box(b, (x - 0.8, ly - 0.8, lz1), (x + 0.8, ly + 0.8, 18.0), color="#9aa3b0", top_color="#3a3f4a")
    # doors: two loading doors in the right gable, a big crane door in the left gable
    b.door(blk, "right", x=-4.0, kind="door_roller")
    b.door(blk, "right", x=4.0, kind="door_roller")
    b.decal(blk, "left", 0.0, 0.0, 8.0, 8.5, "door_roller", offset=0.04)
    # the gantry yard on the left: a leg and a runway each side, the crane girder across
    gx = 21.4
    for y in (-11.4, 11.4):
        bar(b, (gx, y, 0.0), (gx, y, 10.6), 0.9, color=CRANE_YELLOW, solid=True)
        bar(b, (hx1 - 0.2, y, 10.15), (gx + 0.45, y, 10.15), 0.9, 0.9, color=CRANE_YELLOW, caps=(True, True))
    bar(b, (17.0, -12.4, 11.35), (17.0, 12.4, 11.35), 1.6, 1.5, color="#e8a21e", caps=(True, True))
    solid_box(b, hx1, 21.85, -12.4, 12.4, 6.0, 12.15)       # the yard's crane, for the chunks
    # a flat-roofed concrete office along the front, ribbon windows, against the hall
    ox0, ox1, oy0 = -18.0, 2.0, -14.625
    walls(b, ox0, ox1, oy0, hy0, 0.0, 6.0, "strip_concrete", skip=("back",))
    quad(b, [(ox0, oy0, 6.0), (ox1, oy0, 6.0), (ox1, hy0, 6.0), (ox0, hy0, 6.0)], region="gravel", tag="roof",
         unit=(10.01, 6.4))
    solid_box(b, ox0, ox1, oy0, hy0, 0.0, 6.0)
    off = kit.Block(ox0, ox1, oy0, hy0, 0.0, 6.0, "strip_concrete", False, (1, 1, 1))
    b.door(off, "front", x=-5.0, kind="door_double")
    b.sign(off, "front", "wrench", x=4.5, z=3.3, height=1.5)
    b.bite_hint = (-21.6, -8.0, 14.0)


# ==== warehouse_a: barrel-roofed dock warehouse ===============================================
def barrel(b, x0, x1, y0, y1, z0, rise, *, n=6, overhang=0.375, roof="metal", tone=None, end_region="metal_plain",
           end_tone=None, skylights=()):
    """A barrel (curved) roof spanning y, running along x, with arched gable-end walls."""
    cy, hw = (y0 + y1) / 2, (y1 - y0) / 2
    # points of the arc across y (half-ellipse segment: flatter top)
    prof = []
    for k in range(n + 1):
        t = -1 + 2 * k / n
        prof.append((cy + t * hw, z0 + rise * (1 - t * t)))
    # roof strips along x, plus an eave lip down past the wall each side
    ext = [(prof[0][0] - overhang, prof[0][1] - rise * 4 * overhang / (y1 - y0))] + prof[1:-1] + \
          [(prof[-1][0] + overhang, prof[-1][1] - rise * 4 * overhang / (y1 - y0))]
    for k in range(n):
        (ya, za), (yb, zb) = ext[k], ext[k + 1]
        q = [(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)]
        reg = "glass_roof" if k in skylights else roof
        quad(b, q, region=reg, tone=tone, tag="roof", unit=(x1 - x0 + 0.01, 8.0) if reg == roof else ((x1 - x0) / 2 + 0.01, 8.0))
    for (ya, za) in (ext[0], ext[-1]):            # eave lip underside, seen from the street
        yi = y0 if ya < cy else y1
        q = [(x0, yi, za - 0.02), (x1, yi, za - 0.02), (x1, ya, za - 0.02), (x0, ya, za - 0.02)]
        quad(b, orient(q, (0, 0, -1)), color="#7c7a74", tag="underside")
    # arched gable ends (convex: one polygon each)
    arc = [(y, z) for y, z in prof]
    right = [(x0, y, z) for y, z in arc[::-1]]                     # seen from -x: y runs high to low
    left = [(x1, y, z) for y, z in arc]
    quad(b, orient(right, (-1, 0, 0)), region=end_region, tone=end_tone, tag="wall")
    quad(b, orient(left, (1, 0, 0)), region=end_region, tone=end_tone, tag="wall")
    b.solids.append(np.array([(x, y, z) for x in (x0, x1) for y, z in prof] +
                             [(x, y, z0) for x in (x0, x1) for y in (y0, y1)], float))
    return z0 + rise


@kit.building("warehouse_a", district="harbor", tone="slate", seed=8)
def warehouse_a(b):
    # Blue-grey cladding over a concrete loading storey, a barrel roof, a loading dock along
    # the front with a canopy and three roller doors, a small office door and roof vents.
    x0, x1, y0, y1 = -15.0, 15.0, -6.2, 9.625
    eaves = 7.2
    blue = "#a9c8ee"
    walls(b, x0, x1, y0, y1, 0.0, style.GROUND, "loading")
    walls(b, x0, x1, y0, y1, style.GROUND, eaves, "metal_clad", tone=blue)
    solid_box(b, x0, x1, y0, y1, 0.0, eaves)
    blk = kit.Block(x0, x1, y0, y1, 0.0, eaves, "metal_clad", False, hex_rgb(blue))
    barrel(b, x0, x1, y0, y1, eaves, 11.0 - eaves, n=6, roof="metal", end_tone=blue, skylights=(1, 4))
    for x in (-9.0, 0.0, 9.0):
        b.door(blk, "front", x=x, kind="door_roller", z=1.2)
    b.door(blk, "right", x=-3.0, kind="door_double")
    b.sign(blk, "right", "fish", x=3.0, z=3.0, height=1.6)
    b.door(blk, "back", x=6.0, kind="door_roller")
    # loading dock: a concrete platform, dark bumpers, a canopy on the front wall
    box(b, (x0 + 0.6, -9.9, 0.0), (x1 - 0.6, y0, 1.2), color=CONCRETE, sides=("front", "left", "right", "top"),
        solid=True)
    for x in (-11.0, -7.0, -2.0, 2.0, 7.0, 11.0):              # rubber bumpers on the dock face
        quad(b, [(x - 0.3, -9.94, 0.3), (x + 0.3, -9.94, 0.3), (x + 0.3, -9.94, 1.0), (x - 0.3, -9.94, 1.0)],
             color="#25272d")
    cz = 5.0
    box(b, (x0 + 0.6, -9.9, cz), (x1 - 0.6, y0, cz + 0.35), color="#e3b23c", top="metal", bottom=True,
        sides=("front", "left", "right", "top", "bottom"), unit=(29.0, 4.0))
    for x in (-13.6, 13.6):
        bar(b, (x, -9.3, cz), (x, y0 - 0.1, cz + 2.0), 0.18, color=STEEL)      # canopy ties
    # ridge vents
    for x in (-7.0, 7.0):
        b.roof_box(x, 1.7, 10.55, 2.2, 1.6, 0.6)
    b.bite_hint = (15.0, -6.0, 11.0)


# ==== tank_a: round storage tank ==============================================================
@kit.building("tank_a", district="industry", tone="white", seed=25)
def tank_a(b):
    R, n = 7.2, 10
    pad = 0.4
    top = 12.2
    # concrete pad
    box(b, (-9.0, -9.0, 0.0), (9.0, 9.0, pad), color=CONCRETE, sides=("front", "left", "back", "right", "top"),
        solid=True)
    # the shell: white panels, a coloured belt under the roof
    ring = [(math.cos(math.pi / n + 2 * math.pi * k / n), math.sin(math.pi / n + 2 * math.pi * k / n)) for k in range(n)]
    belt = top - 1.6
    side = 2 * R * math.sin(math.pi / n) + 0.01
    for k in range(n):
        (ax, ay), (bx, by) = ring[k], ring[(k + 1) % n]
        q = [(ax * R, ay * R, pad), (bx * R, by * R, pad), (bx * R, by * R, belt), (ax * R, ay * R, belt)]
        quad(b, q, color="#eef0f2", tag="wall")
        q = [(ax * R, ay * R, belt), (bx * R, by * R, belt), (bx * R, by * R, top), (ax * R, ay * R, top)]
        quad(b, q, color="#e3b23c" if k % 2 else "#d9a62e", tag="wall")
    for k in range(n):                         # the shell's inside, seen once a bite opens it
        (ax, ay), (bx, by) = ring[k], ring[(k + 1) % n]
        r = R - 0.05
        quad(b, [(bx * r, by * r, pad), (ax * r, ay * r, pad), (ax * r, ay * r, top), (bx * r, by * r, top)],
             color="#5b6270", tag="detail")
    b.solids.append(np.array([(x * R, y * R, z) for x, y in ring for z in (pad, top)], float))
    # conical roof, light grey, a hatch at the top
    b.cone((0, 0), R, top, top + 1.25, n=n, color="#d9dde2", phase=math.pi / n)
    box(b, (-0.6, -0.6, top + 1.0), (0.6, 0.6, 14.0), color="#9aa3b0", sides=("front", "left", "back", "right", "top"))
    # railed walkway round the roof edge (two-sided rail band on 8 sides)
    rr, m = R + 0.25, 8
    for k in range(m):
        a0, a1 = 2 * math.pi * (k + 0.5) / m, 2 * math.pi * (k + 1.5) / m
        p0 = (rr * math.cos(a0), rr * math.sin(a0), top)
        p1 = (rr * math.cos(a1), rr * math.sin(a1), top)
        q = [p0, p1, (p1[0], p1[1], top + 1.0), (p0[0], p0[1], top + 1.0)]
        quad(b, q, region="rail_metal", unit=(rr * 2 * math.sin(math.pi / m) + 0.01, 1.0), two_sided=True)
    # spiral stair: flights hugging the shell, rising anticlockwise from the front to the roof
    steps = 5
    a_start, a_end = math.radians(-110), math.radians(150)
    ri, ro = R + 0.05, R + 1.3
    for k in range(steps):
        a0 = a_start + (a_end - a_start) * k / steps
        a1 = a_start + (a_end - a_start) * (k + 1) / steps
        z0 = pad + (top - pad) * k / steps
        z1 = pad + (top - pad) * (k + 1) / steps
        i0 = (ri * math.cos(a0), ri * math.sin(a0), z0)
        o0 = (ro * math.cos(a0), ro * math.sin(a0), z0)
        i1 = (ri * math.cos(a1), ri * math.sin(a1), z1)
        o1 = (ro * math.cos(a1), ro * math.sin(a1), z1)
        quad(b, [o0, o1, i1, i0], color="#5b6270")                                   # flight, top
        # the underside keeps the top's diagonal (o0-i1) so the two never cross, and sits 3 cm
        # below it so they never fight for the same pixels
        nz = np.cross(np.subtract(o1, o0), np.subtract(i1, o0))
        nz = nz / np.linalg.norm(nz) * 0.03
        quad(b, [tuple(np.subtract(p, nz)) for p in (o0, i0, i1, o1)], color="#3a3f4a", tag="underside")
        rail = [o0, o1, (o1[0], o1[1], z1 + 1.0), (o0[0], o0[1], z0 + 1.0)]
        quad(b, rail, color=CRANE_YELLOW, two_sided=True)                            # handrail band
    remember_intact(b)
    b.damage_hook = _tank_damage
    b.bite_hint = (R * 0.7, -R * 0.7, top + 1.2)


def _tank_damage(b, mesh):
    """A tank has no floors: the broken-open inside is the dark shell wall, and the clipped
    roof and shell show their inside faces."""
    for f in mesh.faces:
        if f.tag == "interior" and f.region == "interior":
            f.uv = [(u, v) for u, v in _swatch_uv("dark", len(f.pts))]
            f.region = "dark"
            f.col = (1.0, 1.0, 1.0)


def _swatch_uv(name, n):
    from city.geom import swatch_uv
    return swatch_uv(name, n)


# ==== crane_a: harbor gantry crane ============================================================
@kit.building("crane_a", district="harbor", tone="white", seed=10)
def crane_a(b):
    red, dk = HARBOR_RED, HARBOR_RED_DK
    lx, ly = 7.35, 6.5           # leg positions (x: across the quay, y: along the boom)
    zg = 18.5                    # girder level
    # bogies on the rails and the four legs
    for sx in (-1, 1):
        box(b, (-lx - 0.6, sx * ly - 0.7, 0.0), (lx + 0.6, sx * ly + 0.7, 1.4), color=STEEL)   # bogies on the rails
        for sy in (-1, 1):
            bar(b, (sx * lx, sy * ly, 1.4), (sx * lx, sy * ly, zg - 1.5), 1.2, color=red)
        bar(b, (sx * lx, -ly, 4.4), (sx * lx, ly, 15.8), 0.45, color=dk)              # portal brace
        # chunk solid: the whole portal side as one slab
        b.solids.append(np.array([(sx * lx + dx, y, z) for dx in (-1.0, 1.0) for y in (-ly - 0.6, ly + 0.6)
                                  for z in (0.0, zg)], float))
    for sy in (-1, 1):                                                       # cross beams at the top
        bar(b, (-lx - 0.6, sy * ly, zg - 0.9), (lx + 0.6, sy * ly, zg - 0.9), 1.2, 1.4, color=red, caps=(True, True))
    # the main girder pair, along y, from the hinge back to the counterweight
    gy0, gy1 = -ly - 0.6, 12.6
    for sx in (-1, 1):
        bar(b, (sx * 3.0, gy0, zg + 0.7), (sx * 3.0, gy1, zg + 0.7), 1.2, 1.6, color=red, caps=(True, False))
    # machinery house and counterweight at the back
    box(b, (-4.0, 6.0, zg + 1.5), (4.0, 12.6, zg + 5.0), region="metal_plain", tone="#ffffff", top="white",
        top_color="#d8dbe0", unit=(8.0, 3.5), solid=True)
    box(b, (-4.0, 12.6, zg - 2.4), (4.0, 13.0, zg + 5.0), color="#3a3f4a", sides=("front", "back", "left", "right", "top"),
        bottom=True)
    quad(b, [(-4.0, 6.0, zg + 1.5), (-4.0, 12.6, zg + 1.5), (4.0, 12.6, zg + 1.5), (4.0, 6.0, zg + 1.5)],
         color="#9aa0aa", tag="underside")
    b.solids.append(np.array([(x, y, z) for x in (-4.0, 4.0) for y in (-ly - 1.0, 13.0) for z in (zg - 1.6, zg + 1.5)],
                             float))
    # operator cab under the girder, front left
    box(b, (1.2, -6.0, zg - 3.2), (3.8, -3.6, zg - 0.1), color=WHITE, bottom=True)
    b.decal(kit.Block(1.2, 3.8, -6.0, -3.6, zg - 3.2, zg - 0.1, "x", False, (1, 1, 1)), "front", 0.0, zg - 2.4,
            2.0, 1.3, "glass", offset=0.03)
    # A-frame: two legs a side meeting under a head beam
    apex_z, apex_y = 36.5, 1.0
    for sx in (-1, 1):
        for y in (-ly, ly + 3.0):
            bar(b, (sx * 3.0, y, zg + 1.5), (sx * 2.0, apex_y, apex_z), 0.9, color=red)
    bar(b, (-2.6, apex_y, apex_z + 0.3), (2.6, apex_y, apex_z + 0.3), 1.0, color=red, caps=(True, True))
    b.solids.append(np.array([(x, y, z) for x in (-3.5, 3.5) for y in (-ly, ly + 3.0) for z in (zg + 1.5,)] +
                             [(x, y, apex_z + 0.8) for x in (-2.6, 2.6) for y in (apex_y - 1.5, apex_y + 1.5)], float))
    # raised boom: a red box girder from the hinge up toward the water side, a white tip
    hinge = np.array([0.0, -ly - 0.6, zg + 0.7])
    tip = np.array([0.0, -12.0, 44.8])
    mid = hinge + (tip - hinge) * 0.86
    bar(b, hinge, mid, 2.6, 1.6, color=red, caps=(True, False))
    bar(b, mid, tip, 2.6, 1.6, color=WHITE, caps=(False, True))
    b.solids.append(np.array([hinge + d for d in ((-1.3, -1.6, -0.8), (1.3, -1.6, -0.8), (-1.3, 1.6, 0.8), (1.3, 1.6, 0.8))] +
                             [tip + d for d in ((-1.3, -1.6, -0.8), (1.3, -1.6, -0.8), (-1.3, 1.6, 0.8), (1.3, 1.6, 0.8))], float))
    # stays from the head beam to the boom tip (two-sided strips), beacon on the tip
    for sx in (-1, 1):
        a = np.array([sx * 2.0, apex_y, apex_z])
        t = np.array([sx * 1.1, -11.8, 44.0])
        quad(b, [a - UP * 0.15, t - UP * 0.15, t + UP * 0.15, a + UP * 0.15], color="#e8e4da", two_sided=True)
    b.cone((0.0, -12.0), 0.5, 45.4, 46.0, n=4, region="beacon", tag="detail", phase=math.pi / 4)
    # the spreader parked under the girders on two cables (yellow, the box-lifting frame)
    for sx in (-1, 1):
        quad(b, [(sx * 1.6 - 0.12, -0.9, 7.4), (sx * 1.6 + 0.12, -0.9, 7.4), (sx * 1.6 + 0.12, -0.9, zg - 0.2),
                 (sx * 1.6 - 0.12, -0.9, zg - 0.2)], color="#25272d", two_sided=True)
    box(b, (-3.0, -2.2, 6.6), (3.0, 0.4, 7.4), color=CRANE_YELLOW, bottom=True)
    remember_intact(b)
    b.damage_hook = backface_clipped
    b.bite_hint = (0.0, -12.0, 46.0)


# ==== container_a: a stack of shipping containers =============================================
CONTAINER_COLORS = ["#e07b39", "#2a8f8a", "#c5453a", "#2f62c9", "#e9dfc5", "#3f8f4f", "#e3b23c", "#8a96a8"]


@kit.building("container_a", district="harbor", tone="white", seed=11)
def container_a(b):
    # Five columns of two 12 m containers end to end, stacked up to three high, stepped so the
    # stack has a silhouette. Only the outside faces are made; each container has its own color
    # (one shipping line's boxes often sit on each other: same-colored neighbors share a face).
    cw, cl, ch = 2.6, 12.9, 2.62
    ncol, nrow = 5, 2
    heights = [[3, 3], [3, 3], [2, 3], [3, 3], [3, 1]]       # [column][row] containers high
    pal = CONTAINER_COLORS
    cols = [  # [column][row] colors bottom to top
        [[0, 0, 3], [1, 1, 1]], [[2, 4, 4], [0, 6, 6]], [[3, 3], [5, 5, 2]], [[6, 1, 1], [3, 3, 0]],
        [[5, 2, 2], [4]]]
    color = {(i, j, k): pal[cols[i][j][k]] for i in range(ncol) for j in range(nrow) for k in range(heights[i][j])}

    def filled(i, j, k):
        return 0 <= i < ncol and 0 <= j < nrow and 0 <= k < heights[i][j]
    x0 = -ncol * cw / 2
    y0 = -nrow * cl / 2
    g = 0.0
    rs = np.random.default_rng(7)
    vary = {(i, j): float(rs.uniform(0.9, 1.05)) for i in range(ncol) for j in range(nrow)}
    for i in range(ncol):
        for j in range(nrow):
            xa, xb = x0 + i * cw, x0 + (i + 1) * cw
            ya, yb = y0 + j * cl, y0 + (j + 1) * cl
            kt = heights[i][j] - 1
            c = tuple(min(1.0, v * vary[i, j]) for v in hex_rgb(color[i, j, kt]))
            quad(b, [(xa, ya, (kt + 1) * ch), (xb, ya, (kt + 1) * ch), (xb, yb, (kt + 1) * ch), (xa, yb, (kt + 1) * ch)],
                 color=c, tag="detail")
            # the four sides: runs of same-colored, exposed containers become one face
            for side, di, dj, sh in (("front", 0, -1, 0.8), ("back", 0, 1, 0.74), ("left", 1, 0, 0.88),
                                     ("right", -1, 0, 0.92)):
                k = 0
                while k <= kt:
                    if filled(i + di, j + dj, k):
                        k += 1
                        continue
                    k1 = k
                    while k1 + 1 <= kt and not filled(i + di, j + dj, k1 + 1) and color[i, j, k1 + 1] == color[i, j, k]:
                        k1 += 1
                    za, zb = k * ch, (k1 + 1) * ch - g
                    cc = tuple(min(1.0, x * sh * 1.3 * vary[i, j]) for x in hex_rgb(color[i, j, k]))
                    un = (cw + 0.01, (k1 - k + 1) * ch + 0.01)
                    if side == "front":
                        quad(b, [(xa + g, ya, za), (xb - g, ya, za), (xb - g, ya, zb), (xa + g, ya, zb)],
                             region="metal_plain", tone=cc, unit=un)
                    elif side == "back":
                        quad(b, [(xb - g, yb, za), (xa + g, yb, za), (xa + g, yb, zb), (xb - g, yb, zb)],
                             region="metal_plain", tone=cc, unit=un)
                    else:
                        x = xb if side == "left" else xa
                        q = [(x, ya + g, za), (x, yb - g, za), (x, yb - g, zb), (x, ya + g, zb)]
                        if side == "right":
                            q = [(x, yb - g, za), (x, ya + g, za), (x, ya + g, zb), (x, yb - g, zb)]
                        tone = tuple(min(1.0, v * sh * 1.3 * vary[i, j]) for v in hex_rgb(color[i, j, k]))
                        quad(b, q, region="metal_plain", tone=tone, unit=(cl + 0.01, (k1 - k + 1) * ch + 0.01))
                    k = k1 + 1
    # solids: one per row (the chunks are cut from these)
    for j in range(nrow):
        top = max(heights[i][j] for i in range(ncol)) * ch
        b.solids.append(np.array([(x, y, z) for x in (x0, -x0) for y in (y0 + j * cl, y0 + (j + 1) * cl)
                                  for z in (0.0, top)], float))
    remember_intact(b)
    b.damage_hook = backface_clipped
    b.bite_hint = (x0 + 2 * cw, y0, 3 * ch)


# ==== bridges =================================================================================
def deck(b, W, D, *, curb, road_region="tar", lanes=2, dash=True, sections=4):
    """The deck at ground level: a road surface (top 0.3 m) between two raised sidewalks
    `curb` m wide (top 0.45 m), concrete fascias, centre dashes. Spans repeat evenly."""
    hw, hd = W / 2, D / 2
    zr, zs = 0.3, 0.45
    rx = hw - curb
    seg = D / sections
    # road surface, stretched so one repeat covers one span (no seams in odd places)
    quad(b, [(-rx, -hd, zr), (rx, -hd, zr), (rx, hd, zr), (-rx, hd, zr)], region=road_region,
         unit=(2 * rx + 0.01, seg), tag="roof", origin=(-rx, -hd, zr))
    for sx in (-1, 1):
        xi, xo = sx * rx, sx * hw
        lo, hi = (xi, xo) if sx > 0 else (xo, xi)
        quad(b, [(lo, -hd, zs), (hi, -hd, zs), (hi, hd, zs), (lo, hd, zs)], color=WALK, tag="roof")     # walk
        # curb face toward the road
        if sx > 0:
            quad(b, [(xi, hd, zr), (xi, -hd, zr), (xi, -hd, zs), (xi, hd, zs)], color="#e8e4da")
            quad(b, [(xo, -hd, 0.0), (xo, hd, 0.0), (xo, hd, zs), (xo, -hd, zs)], region="concrete_plain",
                 unit=(D / 2 + 0.01, 2.0), tag="wall")
        else:
            quad(b, [(xi, -hd, zr), (xi, hd, zr), (xi, hd, zs), (xi, -hd, zs)], color="#e8e4da")
            quad(b, [(xo, hd, 0.0), (xo, -hd, 0.0), (xo, -hd, zs), (xo, hd, zs)], region="concrete_plain",
                 unit=(D / 2 + 0.01, 2.0), tag="wall")
    # deck ends (seen when the bridge stands proud of the road a little)
    for sy in (-1, 1):
        y = sy * hd
        quad(b, orient([(-hw, y, 0.0), (hw, y, 0.0), (hw, y, zr), (-hw, y, zr)], (0, sy, 0)), color=CONCRETE_DK)
        for sx in (-1, 1):                                    # the raised walks' ends
            xa, xb = sorted((sx * rx, sx * hw))
            quad(b, orient([(xa, y, zr), (xb, y, zr), (xb, y, zs), (xa, y, zs)], (0, sy, 0)), color=CONCRETE_DK)
    if dash:
        n = int(round(D / 12.0))
        for k in range(n):
            yc = -hd + (k + 0.5) * D / n
            quad(b, [(-0.12, yc - 1.8, zr + 0.02), (0.12, yc - 1.8, zr + 0.02), (0.12, yc + 1.8, zr + 0.02),
                     (-0.12, yc + 1.8, zr + 0.02)], color="#f4f2ea", tag="detail")
        for sx in (() if b.id == "bridge_a" else (-1, 1)):    # solid edge lines (the big bridge)
            x = sx * (rx - 0.5)
            quad(b, [(x - 0.1, -hd, zr + 0.02), (x + 0.1, -hd, zr + 0.02), (x + 0.1, hd, zr + 0.02),
                     (x - 0.1, hd, zr + 0.02)], color="#f4f2ea", tag="detail")
    b.solids.append(np.array([(x, y, z) for x in (-hw, hw) for y in (-hd, hd) for z in (0.0, zs)], float))
    return zs


def lamp(b, x, y, z0, z1):
    """A street lamp: a dark post and a head that glows at night (the atlas's lamp swatch)."""
    first = len(b.intact.faces)
    bar(b, (x, y, z0), (x, y, z1 - 0.45), 0.2, color="#3a3f4a")
    zb, h = z1 - 0.3, 0.3
    c = [(x - h, y - h, zb), (x + h, y - h, zb), (x + h, y + h, zb), (x - h, y + h, zb)]
    low = (x, y, z1 - 0.75)
    for k in range(4):                                        # the glass, a pyramid hanging down
        tri = [c[k], c[(k + 1) % 4], low]
        out = np.mean(np.array(tri, float), axis=0) - np.array([x, y, zb])
        quad(b, orient(tri, out), region="lamp")
    b.cone((x, y), 0.42, z1 - 0.3, z1, n=4, color="#3a3f4a", tag="detail", phase=math.pi / 4)        # hood
    group(b, first)


def pylon(b, x, y, hx, hy, z1, lantern=1.0, cap=0.45):
    """A stone end pylon, a glowing lantern block on it (slightly inset) and a dark pyramid cap
    (20 triangles)."""
    first = len(b.intact.faces)
    box(b, (x - hx, y - hy, 0.0), (x + hx, y + hy, z1), color=STONE, sides=("front", "left", "back", "right"),
        solid=True)
    zl = z1 + lantern
    box(b, (x - hx, y - hy, z1), (x + hx, y + hy, zl), region="lamp", top=None,
        sides=("front", "left", "back", "right"))
    apex = (x, y, zl + cap)
    c = [(x - hx, y - hy, zl), (x + hx, y - hy, zl), (x + hx, y + hy, zl), (x - hx, y + hy, zl)]
    for k in range(4):
        quad(b, [c[k], c[(k + 1) % 4], apex], color="#3a3f4a")
    group(b, first)


@kit.building("bridge_a", district="industry", tone="concrete", seed=27)
def bridge_a(b):
    W, D = b.W, b.D
    hw, hd = W / 2, D / 2
    zs = deck(b, W, D, curb=1.0, sections=4)
    # a solid parapet along both edges: light concrete inside, a white coping, plain concrete
    # outside, between the end pylons
    ya, yb, ph = -hd + 2.0, hd - 2.0, 1.0
    for sx in (-1, 1):
        xo, xi = sx * hw, sx * (hw - 0.35)
        quad(b, orient([(xi, ya, zs), (xi, yb, zs), (xi, yb, zs + ph), (xi, ya, zs + ph)], (-sx, 0, 0)), color="#dcd6ca")
        quad(b, orient([(xo, ya, zs + ph), (xi, ya, zs + ph), (xi, yb, zs + ph), (xo, yb, zs + ph)], (0, 0, 1)),
             color="#f4f2ec")
        quad(b, orient([(xo, ya, 0.0), (xo, yb, 0.0), (xo, yb, zs + ph), (xo, ya, zs + ph)], (sx, 0, 0)),
             region="concrete_plain", unit=((yb - ya) / 2 + 0.01, 2.0), tag="wall")
    # four stone end pylons (the piers) with lanterns
    for sx in (-1, 1):
        for sy in (-1, 1):
            pylon(b, sx * (hw - 0.5), sy * (hd - 1.0), 0.5, 1.0, 6.6, lantern=0.95, cap=0.45)
    # lamps on the parapet at the quarter points, both sides
    for sx in (-1, 1):
        for y in (-hd / 2, hd / 2):
            lamp(b, sx * (hw - 0.3), y, zs + ph, 6.0)
    remember_intact(b)
    b.damage_hook = _bridge_b_damage
    b.bite_hint = (hw, 4.0, 6.2)


def _bridge_scorch(b, mesh):
    """Bridges are low: the generic bite only takes a pylon top. Add scorched craters on the
    road (dark patches just above it) so a damaged deck reads from the air."""
    rng = np.random.default_rng(b.seed)
    hw, hd = b.W / 2, b.D / 2
    for k in range(3):
        cx = rng.uniform(-hw * 0.5, hw * 0.5)
        cy = rng.uniform(-hd * 0.7, hd * 0.7)
        r = rng.uniform(1.6, 2.8)
        pts = [(cx + r * math.cos(a) * rng.uniform(0.7, 1.1), cy + r * math.sin(a) * rng.uniform(0.7, 1.1), 0.33)
               for a in np.linspace(0, 2 * math.pi, 7)[:-1]]
        mesh += map_region(orient(pts, (0, 0, 1)), "rubble", col=(0.3, 0.28, 0.27), tag="interior",
                           unit=(2.4 * r, 2.4 * r))


def arch_ribbon(b, x_out, x_in, y_span, z_up, z_lo, crown, depth, *, n=8, color=ARCH_RED, solid=True):
    """A truss arch drawn as a lattice ribbon (grille) between two parabolic chords, in the
    plane of one bridge side. Faces outward (x_out side) and inward, plus chord tops/bottoms."""
    sgn = 1.0 if x_out > x_in else -1.0
    L = y_span

    def up(y):
        return z_up + (crown - z_up) * (1 - (y / L) ** 2)

    def lo(y):
        L2 = L - depth * 1.4
        return max(z_lo, z_lo + (crown - depth - z_lo) * (1 - (y / L2) ** 2)) if abs(y) < L2 else z_lo
    ys = [-L + 2 * L * k / n for k in range(n + 1)]
    # make the lower chord meet the deck girder at the springing
    pts_u = [(y, up(y)) for y in ys]
    pts_l = [(y, min(lo(y), up(y) - 0.6)) for y in ys]
    tone = color
    lattice = "#ff9a78"                     # lightens the grey grille to a rust red lattice
    for k in range(n):
        (ya, ua), (yb, ub) = pts_u[k], pts_u[k + 1]
        (_, la), (_, lb) = pts_l[k], pts_l[k + 1]
        seg_len = math.hypot(yb - ya, ub - ua)
        outer = [(x_out, ya, la), (x_out, yb, lb), (x_out, yb, ub), (x_out, ya, ua)]
        inner = [(x_in, yb, lb), (x_in, ya, la), (x_in, ya, ua), (x_in, yb, ub)]
        if sgn < 0:
            outer = [(x_out, yb, lb), (x_out, ya, la), (x_out, ya, ua), (x_out, yb, ub)]
            inner = [(x_in, ya, la), (x_in, yb, lb), (x_in, yb, ub), (x_in, ya, ua)]
        ext = max(ua, ub) - min(la, lb) + 0.05
        quad(b, outer, region="grille", tone=lattice, unit=(seg_len + 0.02, ext), tag="wall")
        quad(b, inner, region="grille", tone=tuple(x * 0.88 for x in hex_rgb(lattice)), unit=(seg_len + 0.02, ext),
             tag="wall")
        # top chord (faces up) and bottom chord (faces down)
        xa, xb = (x_in, x_out) if sgn > 0 else (x_out, x_in)
        topq = [(xa, ya, ua), (xb, ya, ua), (xb, yb, ub), (xa, yb, ub)]
        botq = [(xa, yb, lb), (xb, yb, lb), (xb, ya, la), (xa, ya, la)]
        quad(b, topq, color=tone)
        quad(b, botq, color=tuple(x * 0.7 for x in hex_rgb(tone)), tag="underside")
        if solid:
            # a little thicker than the ribbon, so the chunk cutter keeps pieces of the arch
            x_deep = x_out - sgn * 2.2
            b.solids.append(np.array([(x, y, z) for x in (x_deep, x_out) for (y, z) in ((ya, ua), (yb, ub), (ya, la), (yb, lb))],
                                     float))
    return up, pts_l


@kit.building("bridge_b", district="harbor", tone="stone", seed=17)
def bridge_b(b):
    W, D, H = b.W, b.D, b.H
    hw, hd = W / 2, D / 2
    zs = deck(b, W, D, curb=1.25, sections=4)
    girder_h = 1.5
    span = hd - 5.0                                   # the arches spring from the end piers
    for sx in (-1, 1):
        xo, xi = sx * (hw - 0.05), sx * (hw - 0.95)
        # deck girder along the edge: the barrier, rust red, outer face and inner face and top
        lo_x, hi_x = (xi, xo) if sx > 0 else (xo, xi)
        box(b, (lo_x, -span, zs), (hi_x, span, zs + girder_h), color=ARCH_RED, sides=("left" if sx > 0 else "right",
            "right" if sx > 0 else "left", "top"), solid=False)
        up, pts_l = arch_ribbon(b, xo, xi, span, zs + girder_h, zs + girder_h, H - 0.05, 4.2, n=8)
        # hangers from the lower chord to the girder
        for (y, zl) in pts_l[2:-2]:
            xm = (xo + xi) / 2
            if zl > zs + girder_h + 1.0:
                quad(b, [(xm, y - 0.2, zs + girder_h), (xm, y + 0.2, zs + girder_h), (xm, y + 0.2, zl), (xm, y - 0.2, zl)],
                     color="#e8e4da", two_sided=True)
    # three cross braces high between the arches (nothing stands in the roadway)
    for y in (-14.0, 0.0, 14.0):
        z = up(y) - 2.6
        bar(b, (-(hw - 0.5), y, z), ((hw - 0.5), y, z), 0.9, 1.3, color=ARCH_RED)
    # stone end piers (the arches spring from them), each with a lantern
    for sx in (-1, 1):
        for sy in (-1, 1):
            y0, y1 = sorted((sy * (hd - 0.4), sy * (span - 0.6)))
            pylon(b, sx * (hw - 0.55), (y0 + y1) / 2, 0.55, (y1 - y0) / 2, 5.4, lantern=1.1, cap=0.6)
    # keepsake for the rubble: a broken piece of arch lying bent across the heap
    n0 = len(b.intact.faces)
    pts = [(3.0, -20.0, 1.2), (2.0, -6.0, 6.5), (0.5, 6.0, 8.0), (-1.5, 17.0, 4.0)]
    for k in range(3):
        bar(b, pts[k], pts[k + 1], 1.0, 3.2, color=ARCH_RED, caps=(k == 0, k == 2))
    ks = Mesh(b.intact.faces[n0:])
    del b.intact.faces[n0:]
    for f in ks.faces:
        f.tag = "rubble"
    b.keepsake = ks
    remember_intact(b)
    b.damage_hook = _bridge_b_damage
    b.bite_hint = (hw, 4.0, H)


def _bridge_b_damage(b, mesh):
    drop_broken_groups(b, mesh)
    backface_clipped(b, mesh, min_z=2.0)
    _bridge_scorch(b, mesh)


def family_shot(out=None, size=(1600, 900), samples=16):
    """docs/art/concept/city_industry.png: every building of this family at true relative scale
    on a piece of the waterfront, by day: the works and the dock sheds behind the quay street,
    the crane on the quay edge, the Grand Harbor Bridge over the river mouth and an ordinary
    bridge upstream, with cars, the hatchling and soldiers for scale.
    Run with: tools/art/city_industry.py --family-shot"""
    import bpy
    import contract
    import mb
    from mathutils import Quaternion
    from city import sheet

    mb.reset()

    def place(mid, x, y, yaw=0.0):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=contract.model_path(mid))
        new = [o for o in bpy.context.scene.objects if o not in before]
        keep = [o for o in new if o.parent is None and o.name.split(".")[0] in ("intact",)] or \
            [o for o in new if o.parent is None]
        if mid.startswith("bld_"):
            for o in new:
                if o not in keep:
                    bpy.data.objects.remove(o, do_unlink=True)
        for o in keep:
            o.rotation_mode = "QUATERNION"
            q = Quaternion((0, 0, 1), math.radians(yaw)) @ o.rotation_quaternion
            o.rotation_quaternion = q
            o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
        return keep

    river_x = 22.0
    # buildings: the works behind the quay street, the crane on the quay edge, the bridges
    place("bld_factory_b", -150.0, 27.0)
    place("bld_warehouse_a", -106.0, 22.0)
    place("bld_tank_a", -76.0, 21.0)
    place("bld_tank_a", -76.0, 44.0)
    place("bld_container_a", -55.0, 25.0)
    place("bld_container_a", -40.0, 25.0, yaw=180.0)
    place("bld_crane_a", -105.0, -20.0)
    place("bld_crane_a", -72.0, -20.0)
    place("bld_bridge_b", river_x, 0.0, yaw=90.0)
    place("bld_bridge_a", river_x, 75.0, yaw=90.0)
    # the ground: land, the quay apron, the streets, the river and the harbor
    g = mb.Geo()

    def quad(x0, y0, x1, y1, z, col):
        g.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], color=col)

    def poly(pts, z, col):
        g.face([(x, y, z) for x, y in pts], color=col)
    water, land, walk, road, quay = "#2f7fd6", "#a9ab9f", "#b9bcc6", "#3d414d", "#c4c0b4"
    X0, X1, Y0, Y1 = -178.0, 112.0, -40.0, 96.0
    quad(X0, Y0, X1, -30.0, -0.3, water)
    poly([(river_x - 57, -30), (river_x + 57, -30), (river_x + 37, Y1), (river_x - 37, Y1)], -0.3, water)
    poly([(X0, -30), (river_x - 57, -30), (river_x - 37, Y1), (X0, Y1)], 0.0, land)
    poly([(river_x + 57, -30), (X1, -30), (X1, Y1), (river_x + 37, Y1)], 0.0, land)
    quad(X0, -7.0, river_x - 55.0, 7.0, 0.03, road)
    quad(river_x + 55.0, -7.0, X1, 7.0, 0.03, road)
    quad(X0, -30.0, river_x - 56.0, -7.0, 0.1, quay)
    quad(X0, 7.0, river_x - 55.0, 10.0, 0.1, walk)
    quad(river_x + 55.0, 7.0, X1, 10.0, 0.1, walk)
    quad(river_x + 56.0, -30.0, X1, -7.0, 0.1, walk)
    quad(-30.0, 67.0, river_x - 37.0, 83.0, 0.03, road)
    quad(river_x + 37.0, 67.0, X1, 83.0, 0.03, road)
    for k in range(-37, 30):
        if abs(k * 5.0 - river_x) > 56:
            quad(k * 5.0, -0.12, k * 5.0 + 2.6, 0.12, 0.05, "#efe9d8")
    for y in (-26.5, -13.5):                                      # crane rails along the quay
        quad(X0, y - 0.15, river_x - 57.0, y + 0.15, 0.13, "#5b6270")
    mb.node("ground", g)
    # props for scale
    for mid, x, y, yaw in (("prop_truck", -128.0, -3.4, 90.0), ("prop_car_sedan", -60.0, 3.4, -90.0),
                           ("prop_car_van", 0.0, -3.4, 90.0), ("prop_car_taxi", 45.0, 3.4, -90.0),
                           ("prop_bus", 95.0, -3.4, 90.0), ("prop_lamp", -90.0, 8.5, 0.0),
                           ("prop_lamp", -45.0, 8.5, 0.0), ("prop_lamp", 90.0, 8.5, 0.0),
                           ("prop_tree_a", 88.0, 22.0, 0.0), ("prop_tree_b", 100.0, 30.0, 0.0),
                           ("prop_tree_a", 92.0, 44.0, 0.0)):
        if os.path.exists(contract.model_path(mid)):
            place(mid, x, y, yaw)
    if os.path.exists(contract.model_path("kaiju_lizard_s1")):
        place("kaiju_lizard_s1", -88.0, -19.0, 30.0)
    mat = bpy.data.materials.new("mbsheet_olive")
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.08, 1.0)
    for x in (-94.0, -92.8, -91.6):
        for o in sheet._soldier(x, -11.0):
            o.data.materials.append(mat)
    for o in bpy.context.scene.objects:
        o.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    out = out or os.path.join(contract.CONCEPT, "city_industry.png")
    return mb.concept("city_industry", out=out, backdrop="sky", azimuth=8.0, elevation=30.0, fov=30.0, zoom=1.3,
                      size=size, samples=samples, ground=False)


if __name__ == "__main__":
    if "--family-shot" in sys.argv:
        print(family_shot())
        raise SystemExit(0)
    raise SystemExit(kit.run_family("city_industry"))
