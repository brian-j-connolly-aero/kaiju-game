#!/opt/mbtools/venv/bin/python
# mb-family: city_landmarks_b
"""Port Meridian's landmarks, second half (docs/CITY.md section 3).

    lm_kiln_point_power   brick turbine hall, tall arched windows, four square chimneys to 82 m,
                          boiler house, switch houses and a transformer yard
    lm_sevenfold_temple   seven cream drums stacked on a stepped stone platform, each under a wide
                          terracotta brim, festoons of rope hung with bronze bells
    lm_grand_station      cream stone front with a round clock window, two short towers, a great
                          barrel vault of green iron and glass behind
    lm_signal_mast        160 m red-and-white lattice mast, dishes at two heights, beacons on top
    lm_gasworks           two gas holders in green iron frames (one high, one half sunk) beside a
                          brick retort house and its chimney
    lm_founders_clock     slender red-brick tower, four big lit clock faces, copper pyramid, lantern

Built from the city kit's parts (tools/art/city/README.md); the damaged, rubble and chunk states
come from the kit's one generator. Each landmark adds what docs/CITY.md names: where the damage
bites (b.bite_hint), a damage hook for the named damage (a snapped chimney, the top drums gone,
the vault fallen in, the mast folded over, a twisted frame, shattered clocks) and the keepsake
that stays recognizable on the rubble.

Parts the kit has no call for are the helpers below (bars and tubes along any axis, flat discs,
fans and rings in any plane, arched windows, clock faces, bells on ropes, stairs, lattice
sections); they use only the shared atlas: its regions and its swatches with vertex colors.
No new atlas pictures.

    tools/art/city_landmarks_b.py [--only lm_founders_clock] [--no-previews]
    tools/art/city_landmarks_b.py --family-shot     docs/art/concept/city_landmarks_b.png
"""
import math
import os
import sys
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from city import kit  # noqa: E402
from city.geom import Face, Mesh, clip, hex_rgb, map_region, plain, swatch_uv  # noqa: E402

UP = np.array([0.0, 0.0, 1.0])
# SHELL: tag for the panels of round walls and other custom walls. The kit's damage drops a
# "detail" face under 8 m2 whole when a bite touches it, which is right for trim and wrong for a
# drum's panels; a "shell" face is cut by the bites like a wall and never used for a rubble slab.
SHELL = "shell"

# palette (vertex colors on the atlas's white swatch, or multiplying a region)
CREAM = "#efe3c4"
CREAM_DK = "#d9caa6"
STONE = "#e4dccb"
TRIM = "#f2efe8"
UNDER = "#8a8478"
GOLD = "#e3b23c"
BRONZE = "#b9832f"
BRONZE_DK = "#6e4a1c"
TERRA = "#c4552d"
TERRA_DK = "#9a4224"
IRON = "#2f7a4f"          # the green ironwork of the station and the gasworks
IRON_DK = "#225c3b"
STEEL = "#4a4e58"
STEEL_DK = "#2e323a"
BRICK_DK = "#9c6d63"      # multiplies brick to the power station's dark red-brown
SOOT = "#4a4441"
RED = "#d7263d"
WHITE = "#f5f2ea"
HOLDER = "#a9b6b4"        # gas holder bell: pale grey-green steel
COPPER_IN = "#4f8f7a"


# ==== helpers the kit does not have ===========================================================
def _v(p):
    return np.asarray(p, float)


def face(b, pts, col=None, *, region=None, want=None, tag="detail", unit=None, origin=None, tone=None,
         swatch="white", tint=False, u_axis=None, v_axis=None):
    """One planar convex polygon, turned so its normal points along `want` (if given). Plain
    color on a swatch, or mapped onto `region` (multiplied by `tone`)."""
    pts = [_v(p) for p in pts]
    if want is not None and Face(pts).normal @ _v(want) < 0:
        pts = pts[::-1]
    if region:
        c = b.tone if tint else (hex_rgb(tone) if tone else (1, 1, 1))
        out = map_region(pts, region, col=c, tag=tag, unit=unit, origin=origin, tint=tint, u_axis=u_axis,
                         v_axis=v_axis)
        b.intact += out
        return out
    f = plain(pts, col or "#ffffff", tag=tag, swatch=swatch)
    b.intact += f
    return [f]


def frame_of(d):
    d = _v(d) / np.linalg.norm(d)
    a = np.cross(d, UP)
    if np.linalg.norm(a) < 1e-6:
        a = np.array([1.0, 0.0, 0.0])
    a /= np.linalg.norm(a)
    return d, a, np.cross(a, d)


def tube(b, p0, p1, r, n=6, col="#d8d2c4", *, r1=None, region=None, caps=False, tag="detail", solid=False,
         phase=None, tone=None, side=None, swatch="white"):
    """An n-sided bar from p0 to p1 (radius r to the corners, tapering to r1). `side` turns the
    cross-section so a flat side faces that direction (bars of a lattice lie in its faces)."""
    p0, p1 = _v(p0), _v(p1)
    d, a, bb = frame_of(p1 - p0)
    if side is not None:
        s = _v(side) - d * (d @ _v(side))
        if np.linalg.norm(s) > 1e-6:
            a = s / np.linalg.norm(s)
            bb = np.cross(d, a)
    r1 = r if r1 is None else r1
    ph = math.pi / n if phase is None else phase
    ring = [a * math.cos(ph + 2 * math.pi * k / n) + bb * math.sin(ph + 2 * math.pi * k / n) for k in range(n)]
    pts_all = []
    for k in range(n):
        q = [p0 + ring[k] * r, p0 + ring[(k + 1) % n] * r, p1 + ring[(k + 1) % n] * r1, p1 + ring[k] * r1]
        face(b, q, col, region=region, want=ring[k] + ring[(k + 1) % n], tag=tag, tone=tone, swatch=swatch)
        pts_all += q
    if caps:
        if r1 > 1e-6:
            face(b, [p1 + rr * r1 for rr in ring], col, want=d, tag=tag, swatch=swatch)
        face(b, [p0 + rr * r for rr in ring], col, want=-d, tag=tag, swatch=swatch)
    if solid:
        b.solids.append(np.array(pts_all, float))


def bar(b, p0, p1, w, col, *, side=None, caps=False, tag="detail"):
    """A square bar of width w (flat side toward `side`): girders, lattice members, ropes."""
    tube(b, p0, p1, w / math.sqrt(2), n=4, col=col, side=side, phase=math.pi / 4, caps=caps, tag=tag)


def ring_pts(c, nrm, r, n, phase=0.0):
    c = _v(c)
    nrm, a, bb = frame_of(nrm)
    return [c + (a * math.cos(phase + 2 * math.pi * k / n) + bb * math.sin(phase + 2 * math.pi * k / n)) * r
            for k in range(n)]


def disc(b, center, normal, r, n=12, col="#ffffff", *, region=None, phase=0.0, tag="detail", swatch="white",
         tone=None):
    """A flat n-gon facing `normal`."""
    face(b, ring_pts(center, normal, r, n, phase), col, region=region, want=normal, tag=tag, swatch=swatch,
         tone=tone)


def fan(b, center, normal, r, n=12, col="#ffffff", *, phase=0.0, tag="detail", swatch="white"):
    """A flat n-gon made of n triangles round its center (a dial that can shatter piece by piece)."""
    c = _v(center)
    pts = ring_pts(c, normal, r, n, phase)
    for k in range(n):
        face(b, [c, pts[k], pts[(k + 1) % n]], col, want=normal, tag=tag, swatch=swatch)


def annulus(b, center, normal, r0, r1, n=12, col="#ffffff", *, phase=0.0, tag="detail", depth=0.0, back=False):
    """A flat ring facing `normal`; with depth, its outer edge too; `back` adds the far side."""
    c = _v(center)
    nrm = frame_of(normal)[0]
    inner = ring_pts(c, nrm, r0, n, phase)
    outer = ring_pts(c, nrm, r1, n, phase)
    for k in range(n):
        q = [inner[k], inner[(k + 1) % n], outer[(k + 1) % n], outer[k]]
        face(b, q, col, want=nrm, tag=tag)
        if back:
            face(b, [p - nrm * depth for p in q], col, want=-nrm, tag=tag)
        if depth > 0:
            u, w = outer[k] - c, outer[(k + 1) % n] - c
            face(b, [outer[k], outer[(k + 1) % n], outer[(k + 1) % n] - nrm * depth, outer[k] - nrm * depth], col,
                 want=u + w, tag=tag)


def arch_window(b, base_mid, normal, w, h, *, col=None, region="lit_glass", frame=None, segs=4, tag="decal",
                frame_w=0.45):
    """A tall round-headed window (rectangle with a half-circle top) on a wall facing `normal`,
    optionally with a stone surround."""
    nrm, a, _ = frame_of(normal)
    c = _v(base_mid) + nrm * 0.06
    rr = w / 2
    zs = h - rr

    def outline(rad, lift=0.0):
        pts = [c - a * rad - UP * lift, c + a * rad - UP * lift]
        pts += [c + a * rad * math.cos(math.pi * k / segs) + UP * (zs + rad * math.sin(math.pi * k / segs))
                for k in range(segs + 1)]
        return pts
    if frame:
        lift = min(frame_w * 0.6, max(0.0, float(c[2])))
        face(b, [p - nrm * 0.03 for p in outline(rr + frame_w, lift)], frame, want=nrm, tag=tag)
    if col is None:
        face(b, outline(rr), None, want=nrm, tag=tag, swatch=region)
    else:
        face(b, outline(rr), col, want=nrm, tag=tag)


def mark(b) -> int:
    return len(b.intact.faces)


def take(b, start) -> Mesh:
    """Remove the faces added since `start` from the building and return them."""
    m = Mesh(b.intact.faces[start:])
    del b.intact.faces[start:]
    return m


def since(b, start) -> Mesh:
    return Mesh([f.copy() for f in b.intact.faces[start:]])


def rot_matrix(axis, deg):
    axis = _v(axis) / np.linalg.norm(axis)
    a = math.radians(deg)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


def rotate_faces(faces, axis, deg, about):
    R = rot_matrix(axis, deg)
    o = _v(about)
    for f in faces:
        f.pts = [R @ (p - o) + o for p in f.pts]


def move_faces(faces, d):
    d = _v(d)
    for f in faces:
        f.pts = [p + d for p in f.pts]


def remove_faces(mesh, faces):
    ids = {id(f) for f in faces}
    mesh.faces[:] = [f for f in mesh.faces if id(f) not in ids]


def select(mesh, pred):
    return [f for f in mesh.faces if pred(f)]


def clip_split(faces, z):
    """Cut faces at height z: (below, above) as new faces."""
    lo, hi = [], []
    for f in faces:
        g = clip(f, UP, z, keep_below=True)
        if g is not None and g.area > 1e-4:
            lo.append(g)
        g = clip(f, UP, z, keep_below=False)
        if g is not None and g.area > 1e-4:
            hi.append(g)
    return lo, hi


def set_swatch(f, name, col):
    f.uv = swatch_uv(name, len(f.pts))
    f.region = name
    f.col = hex_rgb(col)


def box_solid(b, lo, hi):
    b.solids.append(np.array([(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])],
                             float))


def prism_solid(b, c, r, z0, z1, n=8, r1=None):
    r1 = r if r1 is None else r1
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        pts += [(c[0] + r * math.cos(a), c[1] + r * math.sin(a), z0), (c[0] + r1 * math.cos(a), c[1] + r1 * math.sin(a), z1)]
    b.solids.append(np.array(pts, float))


def drum(b, center, r, z0, z1, *, region="plaster_plain", n=12, tone=None, per_side=None, tag=SHELL, phase=None,
         solid=True, tint=False):
    """A round (n-sided) wall, sides only, each side mapped once (or `per_side` facade bays)."""
    ph = math.pi / n if phase is None else phase
    lo = [(center[0] + r * math.cos(ph + 2 * math.pi * k / n), center[1] + r * math.sin(ph + 2 * math.pi * k / n))
          for k in range(n)]
    side = math.dist(lo[0], lo[1])
    for k in range(n):
        a, c = lo[k], lo[(k + 1) % n]
        q = [(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], z1), (a[0], a[1], z1)]
        unit = (side * (per_side or 1), z1 - z0) if per_side else (side + 1e-3, z1 - z0 + 1e-3)
        mid = ((a[0] + c[0]) / 2 - center[0], (a[1] + c[1]) / 2 - center[1], 0.0)
        face(b, q, None, region=region, want=mid, tag=tag, unit=unit, origin=q[0], tone=tone, tint=tint)
    if solid:
        prism_solid(b, center, r, z0, z1, n)


# ---- damage tidying ---------------------------------------------------------------------------
# The kit cuts big faces and drops small ones that a bite touches. A small part made of several
# faces (a bell, a bar, a clock hand) then loses some faces and keeps others, and the faces left
# show their backs (holes in the game). Parts registered with `part(b)` go all at once instead.
def _key(f):
    """Identity of a face that survives the kit's untouched pass-through (which may re-order or
    re-create a polygon's corners): its center and its area."""
    return tuple(np.round(f.center, 2)) + (round(f.area, 2),)


@contextmanager
def part(b, name=None):
    """with part(b): ... every face added inside goes, or stays, together in the damaged state.
    The faces carry the part's mark in their tag ("detail|p3"), which survives the kit's cuts."""
    i0 = len(b.intact.faces)
    yield
    if not hasattr(b, "parts"):
        b.parts = []
    pm = name or f"p{len(b.parts)}"
    faces = b.intact.faces[i0:]
    for f in faces:
        f.tag = f"{f.tag.split('|')[0]}|{pm}"
    b.parts.append((pm, sum(f.area for f in faces)))


def faces_of(m, name):
    return [f for f in m.faces if f.tag.split("|")[-1] == name]


def tidy(b, m):
    """Drop parts the bites broke, give the kit's broken-open faces a back side, and the remains
    of a bitten slope or a dropped ceiling a lining, so nothing shows its back."""
    # a part is broken when some of its surface is gone (the kit may also split faces it does not
    # cut, along its bites' planes, so faces are compared by area, not one by one)
    have = {}
    for f in m.faces:
        if "|" in f.tag:
            pm = f.tag.split("|")[-1]
            have[pm] = have.get(pm, 0.0) + f.area
    broken = {pm for pm, area in getattr(b, "parts", []) if have.get(pm, 0.0) < area * 0.995 - 1e-4}
    m.faces[:] = [f for f in m.faces if f.tag.split("|")[-1] not in broken]
    whole = {_key(f) for f in b.intact.faces}
    # the holes: the kit's broken-open faces mark where its bites went into the building. Only the
    # cut faces next to them need a lining (the kit also splits faces far from any bite).
    holes = []
    for f in m.faces:
        if f.tag.split("|")[0] == "interior":
            c = f.center
            holes.append((c, max(float(np.linalg.norm(p - c)) for p in f.pts) + 0.6))

    # and the kit's top bite (it opens no room where it only takes a roof): its center and reach,
    # by the same rule as destruct._bites
    lo, hi = b.intact.bounds()
    w, d, h = hi - lo
    if b.bite_hint is not None:
        bc = _v(b.bite_hint)
        k = 0.42 if h < 15 else 0.32
        half = _v((k * w + 0.4, k * d + 0.4, min(0.3 * h, 0.55 * max(w, d)) + 0.4))
        holes.append((bc, float(np.linalg.norm(half)) + 0.6))

    def near_hole(f):
        return any(min(float(np.linalg.norm(p - c)) for p in f.pts) < r for c, r in holes)

    def cut(f):
        return _key(f) not in whole and "|" not in f.tag and near_hole(f)
    for f in list(m.faces):
        base = f.tag.split("|")[0]
        if base == "interior" and getattr(b, "interior_backs", True):
            m.faces.append(Face([p - f.normal * 0.02 for p in f.pts[::-1]], f.uv[::-1] if f.uv else None, f.col, f.tint,
                                f.region, "interior"))
        elif base == "roof" and 0.15 < f.normal[2] < 0.995 and cut(f):
            m.faces.append(plain([p - f.normal * 0.05 for p in f.pts[::-1]], "#5d5852", tag="interior"))
        elif base in ("detail", SHELL) and abs(f.normal[2]) < 0.95 and f.region not in ("interior", "rubble") \
                and cut(f):
            # a cut wall, pier or cornice: what is left is seen from inside through the hole
            m.faces.append(plain([p - f.normal * 0.05 for p in f.pts[::-1]], "#4f4a45", tag="interior"))


def finish_tags(m):
    for f in m.faces:
        f.tag = f.tag.split("|")[0]


def hooked(*fns):
    """The damage hook: tidy first, then the building's own damage, then plain tags."""
    def hook(b, m):
        tidy(b, m)
        for fn in fns:
            fn(b, m)
        finish_tags(m)
    return hook


def steam(b, c, size=3.0, n=3, seed=0):
    """A few pale puffs of steam rising from a hole (flat-shaded octahedra)."""
    rng = np.random.default_rng(seed)
    for k in range(n):
        s = size * (1.0 - 0.18 * k)
        cc = _v(c) + np.array([rng.uniform(-1, 1) * size * 0.4, rng.uniform(-1, 1) * size * 0.4, k * size * 1.25])
        pts = [cc + np.array(v) * s for v in ((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0, -1, 0))]
        top, bot = cc + UP * s * 0.9, cc - UP * s * 0.6
        for i in range(4):
            a, d = pts[i], pts[(i + 1) % 4]
            mid = (a + d) / 2 - cc
            face(b, [a, d, top], "#f4f4f2" if i % 2 else "#e6e7ea", want=mid + UP * 0.3)
            face(b, [d, a, bot], "#cfd0d4", want=mid - UP * 0.3)


# ==== Founders Clock Tower ====================================================================
def clock_face(b, c, nrm, r, *, hands=(-60.0, 75.0), frame=GOLD, shattered=None):
    """A big lit clock: a dial of 12 wedges (lamp swatch: cream by day, glowing at night), a dark
    ring, four hour marks and two hands. Returns nothing; build inside a part()."""
    nrm = frame_of(nrm)[0]
    c = _v(c)
    _, a, bb = frame_of(nrm)
    # a, bb span the dial: make bb point up when the dial is upright
    up = UP - nrm * (UP @ nrm)
    if np.linalg.norm(up) > 1e-6:
        bb = up / np.linalg.norm(up)
        a = np.cross(bb, nrm)
    pts = [c + (a * math.cos(2 * math.pi * k / 12) + bb * math.sin(2 * math.pi * k / 12)) * r for k in range(12)]
    for k in range(12):
        sw, col = ("lamp", "#ffffff")
        if shattered is not None and k in shattered:
            sw, col = ("dark", "#ffffff")
        face(b, [c, pts[k], pts[(k + 1) % 12]], col, want=nrm, swatch=sw)
    annulus(b, c + nrm * 0.02, nrm, r, r + 0.55, n=12, col=frame, depth=0.3)
    for k in range(4):
        d = a * math.cos(math.pi / 2 * k) + bb * math.sin(math.pi / 2 * k)
        e = np.cross(nrm, d)
        p = c + nrm * 0.05 + d * r * 0.78
        face(b, [p - e * 0.22, p + e * 0.22, p + e * 0.22 + d * r * 0.17, p - e * 0.22 + d * r * 0.17], "#22252c",
             want=nrm)
    for ang, ln, wd in ((hands[0], 0.55, 0.32), (hands[1], 0.8, 0.22)):
        t = math.radians(90.0 - ang)
        d = a * math.cos(t) + bb * math.sin(t)
        e = np.cross(nrm, d)
        p = c + nrm * 0.09
        face(b, [p - e * wd - d * 0.4, p + e * wd - d * 0.4, p + d * r * ln], "#22252c", want=nrm)


@kit.building("founders_clock", district="university", tone="stone", seed=61)
def founders_clock(b):
    # A stone plinth with the door; a slender red-brick shaft with corner piers, stone string
    # courses and a column of slit windows; a lighter clock stage with four big lit clock faces;
    # a stone cornice with corner pinnacles, a steep copper pyramid, a small lantern, a finial.
    base = b.block(11.4, 11.4, 4.5, facade="plinth", roof=False)
    b.door(base, "front", x=0.0, kind="door_double")
    b.box((-6.0, -6.0, 4.5), (6.0, 6.0, 5.3), region="cornice", top="white", bottom=True)   # plinth cap, 12 m
    b.intact.faces[-1].col = hex_rgb(STONE)
    S = 4.4                                          # half width of the shaft
    shaft = b.block(2 * S, 2 * S, 37.7, at=(0, 0, 5.3), facade="brick_plain", roof=False)
    for sx in (-1, 1):                               # corner piers run the shaft's height
        for sy in (-1, 1):
            x, y = sx * S, sy * S
            b.box((x - 0.7, y - 0.7, 5.3), (x + 0.7, y + 0.7, 43.0), region="brick_plain", top=None, solid=True)
    for z in (17.0, 30.0):                           # stone string courses
        with part(b):
            b.box((-S - 0.85, -S - 0.85, z), (S + 0.85, S + 0.85, z + 0.6), color=STONE, top="white", bottom=True)
    for side in ("front", "back", "left", "right"):  # slit windows, one over another
        for z in (8.0, 12.5, 20.5, 25.0, 33.5, 38.0):
            b.decal(shaft, side, 0.0, z, 1.1, 2.6, "window_single", offset=0.04)
    # the clock stage: pale stone, a little wider than the shaft
    C = 5.3
    stage = b.block(2 * C, 2 * C, 8.8, at=(0, 0, 43.0), facade="concrete_plain", roof=False)
    for f in b.intact.faces[-8:]:
        if f.region == "concrete_plain":
            f.col = hex_rgb(STONE)
    _ = stage
    with part(b):
        b.box((-C - 0.3, -C - 0.3, 42.4), (C + 0.3, C + 0.3, 43.1), color=STONE, top="white", bottom=True)
    zc = 47.4
    for nrm in ((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0)):
        n3 = _v(nrm)
        if True:      # not a part(): bitten wedges drop one by one, which reads as shattered
            clock_face(b, n3 * (C + 0.05) + UP * zc, n3, 3.4, hands=(-62.0, 58.0))
    b.dial_r = 3.4
    # cornice and pinnacles
    zt = 51.8
    b.box((-6.0, -6.0, zt), (6.0, 6.0, zt + 0.9), region="cornice", top="white")
    b.intact.faces[-1].col = hex_rgb(STONE)
    for sx in (-1, 1):
        for sy in (-1, 1):
            with part(b):
                x, y = sx * 5.15, sy * 5.15
                b.box((x - 0.75, y - 0.75, zt + 0.9), (x + 0.75, y + 0.75, zt + 2.6), color=STONE, top=None)
                b.box((x - 0.85, y - 0.85, zt + 2.6), (x + 0.85, y + 0.85, zt + 2.9), color=GOLD, top=None, bottom=True)
                b.cone((x, y), 0.85 * math.sqrt(2), zt + 2.9, zt + 7.4, n=4, region="copper", phase=math.pi / 4)
                b.box((x - 0.12, y - 0.12, zt + 7.4), (x + 0.12, y + 0.12, zt + 7.9), color=GOLD)
    with part(b):                                  # a gold band where the copper roof starts
        b.box((-5.15, -5.15, zt + 0.9), (5.15, 5.15, zt + 1.3), color=GOLD, top=None)
    # the copper pyramid, lantern, finial
    zr = zt + 0.9
    b.cone((0, 0), 5.0 * math.sqrt(2), zr, 58.6, n=4, region="copper", phase=math.pi / 4)
    b.solids.append(np.array([(x, y, zr) for x in (-5, 5) for y in (-5, 5)] + [(0, 0, 58.6)], float))
    with part(b):
        b.box((-1.3, -1.3, 57.4), (1.3, 1.3, 59.6), region="lit_glass", top=None)
        for sx in (-1, 1):
            for sy in (-1, 1):
                b.box((sx * 1.3 - 0.2, sy * 1.3 - 0.2, 57.4), (sx * 1.3 + 0.2, sy * 1.3 + 0.2, 59.6), color=STONE, top=None)
        b.cone((0, 0), 1.75 * math.sqrt(2), 59.6, 61.2, n=4, region="copper", phase=math.pi / 4)
        disc(b, (0, 0, 59.6), -UP, 1.75 * math.sqrt(2), n=4, col="#4f8f7a", phase=math.pi / 4)
        tube(b, (0, 0, 61.2), (0, 0, 61.75), 0.3, n=4, col=GOLD, r1=0.06)
        b.box((-0.18, -0.18, 61.75), (0.18, 0.18, 62.0), color=GOLD)
    b.bite_hint = (-C, C, 50.0)        # a back corner: the street-side clock stays, shattered

    # rubble: one clock face leaning on the heap
    st = mark(b)
    b.box((-2.2, -0.5, 0.0), (2.2, 0.5, 1.6), region="concrete_plain", top="rubble")
    clock_face(b, (0.0, -0.55, 4.2), (0, -1, 0), 3.4, hands=(-62.0, 58.0), shattered={1, 2, 7})
    face(b, ring_pts((0.0, -0.05, 4.2), (0, 1, 0), 3.95, 12), "#9c958a", want=(0, 1, 0))     # its back
    keep = take(b, st)
    keep.rotx(-24.0, about=(0, 0, 0)).rotz(18.0).move(0.6, -1.4, 1.8)
    for f in keep.faces:
        f.tag = "rubble"
    b.keepsake = keep

    def damage(b, m):
        # the roof, lantern and pinnacles gone: the stage stands open with charred rafters
        remove_faces(m, select(m, lambda f: f.center[2] > zt + 0.95))
        st = mark(b)
        face(b, [(-5.7, -5.7, zt + 0.92), (5.7, -5.7, zt + 0.92), (5.7, 5.7, zt + 0.92), (-5.7, 5.7, zt + 0.92)],
             None, region="rubble", want=UP, tag="interior")
        for (p0, p1) in (((-4.8, -4.0, zt + 0.9), (3.0, 2.0, zt + 5.2)), ((4.6, -3.0, zt + 0.9), (-1.5, 3.5, zt + 3.4)),
                         ((-3.5, 4.6, zt + 0.9), (1.0, -1.0, zt + 4.4))):
            bar(b, p0, p1, 0.45, "#3a3330", caps=True)
        m.faces.extend(take(b, st).faces)
        # every clock face shattered: most of the dial dark, the hands hanging
        for f in m.faces:
            if f.region == "lamp":
                c = f.center
                h = int(abs(c[0] * 7.3 + c[1] * 3.1 + c[2] * 5.7)) % 5
                if h != 0:
                    set_swatch(f, "dark", "#ffffff")
        hands = select(m, lambda f: f.col == hex_rgb("#22252c") and len(f.pts) == 3 and f.center[2] > 45.0)
        for i, f in enumerate(hands):
            n = f.normal
            piv = n * float(n @ f.center) + UP * (zc - n[2] * float(n @ f.center))
            rotate_faces([f], n, 70.0 + 40.0 * (i % 3), piv)
    b.damage_hook = hooked(damage)


# ==== Number Three Gasworks ===================================================================
def holder_frame(b, c, R, z_top, rings, *, n=8, col_w=1.2, braced=(), name="frame"):
    """A gas holder's guide frame: n lattice columns standing on a circle of radius R, girder
    rings at the heights in `rings`, X bracing in the listed bays of the top tier. Each member
    is its own part (bitten members go whole)."""
    cx, cy = c
    pts = [(cx + R * math.cos(2 * math.pi * k / n), cy + R * math.sin(2 * math.pi * k / n)) for k in range(n)]
    for k, (x, y) in enumerate(pts):
        out = (x - cx, y - cy, 0.0)
        with part(b, f"{name}_c{k}"):
            bar(b, (x, y, 0.0), (x, y, z_top), col_w, IRON, side=out, caps=True)
    for j, z in enumerate(rings):
        for k in range(n):
            (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % n]
            mid = ((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy, 0.0)
            with part(b, f"{name}_r{j}_{k}"):
                bar(b, (x0, y0, z), (x1, y1, z), 0.9, IRON_DK if j == len(rings) - 1 else IRON, side=mid, caps=True)
    if braced:
        za, zb = rings[-2], rings[-1]
        for k in braced:
            (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % n]
            mid = ((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy, 0.0)
            with part(b, f"{name}_x{k}"):
                bar(b, (x0, y0, za), (x1, y1, zb), 0.45, IRON, side=mid)
                bar(b, (x1, y1, za), (x0, y0, zb), 0.45, IRON, side=mid)


def holder_bell(b, c, lifts, dome, *, n=12):
    """A telescoping gas holder: lifts [(r, z0, z1), ...] stepping in, a shallow crown on top.
    Returns the crown's (z_rim, z_top)."""
    for i, (r, z0, z1) in enumerate(lifts):
        drum(b, c, r, z0, z1, region="metal_plain", tone=HOLDER, n=n)
        if i + 1 < len(lifts):                     # the step where the next lift rises out of this one
            annulus(b, (c[0], c[1], z1), UP, lifts[i + 1][0], r, n=n, col="#7f8a8a", phase=math.pi / n)
    r, _, zr = lifts[-1]
    rim = ring_pts((c[0], c[1], zr), UP, r, n, math.pi / n)
    top = _v((c[0], c[1], zr + dome))
    for k in range(n):
        face(b, [rim[k], rim[(k + 1) % n], top], "#b9c3c2" if k % 2 else "#aeb9b8", want=UP, tag="roof")
    b.solids.append(np.array(rim + [top], float))
    return zr, zr + dome


@kit.building("gasworks", district="industry", tone="concrete", seed=71)
def gasworks(b):
    # A brick retort house along the street (slate roof with a long louvred ventilator, roller
    # doors, a round brick chimney behind), and behind it two gas holders in green iron guide
    # frames: the big one full and high (three lifts up to 39 m inside a 44 m braced frame), the
    # small one half sunk (one lift showing) inside a lower frame. A red beacon on the big frame.
    rh = b.block(55.25, 13.0, 9.0, at=(0.0, -17.5, 0.0), facade="brick_works", roof=False)
    b.gable(rh, rise=4.6, along="x", roof="tile_slate")
    zr = rh.z1 + 4.6
    with part(b, "vent"):
        b.box((-20.0, rh.cy - 1.3, zr - 1.0), (20.0, rh.cy + 1.3, zr + 1.5), region="vent", top="metal")
    for x in (-18.0, -6.0, 6.0, 18.0):
        b.door(rh, "front", x=x, kind="door_roller")
    b.door(rh, "left", x=0.0, kind="door_double")
    # coal hoppers on the street side: two raised bins on legs
    for x in (-12.0, 12.0):
        with part(b):
            b.box((x - 2.0, rh.y0 - 3.9, 4.0), (x + 2.0, rh.y0 - 0.2, 7.5), region="metal_plain", top="metal",
                  bottom=True, tone="#8f8a7a")
            for lx in (x - 1.7, x + 1.7):
                bar(b, (lx, rh.y0 - 3.6, 0.0), (lx, rh.y0 - 3.6, 4.0), 0.3, STEEL_DK)
    # the round brick chimney behind the house
    b.prism((22.0, -5.5), 1.7, 0.0, 30.0, n=8, region="brick_plain", radius_top=1.25, top=None, solid=True)
    b.prism((22.0, -5.5), 1.42, 30.0, 32.0, n=8, region="brick_plain", radius_top=1.4, top="dark", tone=SOOT)
    # the big holder: full and high
    BIG, SMALL = (-12.6, 12.45), (15.9, 14.95)
    drum(b, BIG, 13.9, 0.0, 2.6, region="brick_plain", n=12)                 # the tank wall
    disc(b, (BIG[0], BIG[1], 2.6), UP, 13.9, n=12, col="#6f7a7a", phase=math.pi / 12, tag="roof")
    holder_bell(b, BIG, [(13.0, 2.6, 13.5), (12.5, 13.5, 24.5), (12.0, 24.5, 35.5)], 3.6)
    holder_frame(b, BIG, 14.5, 43.4, (14.5, 28.5, 42.6), braced=(0, 2, 4, 6), name="big")
    with part(b, "beacon"):
        b.box((BIG[0] + 14.5 - 0.35, BIG[1] - 0.35, 43.4), (BIG[0] + 14.5 + 0.35, BIG[1] + 0.35, 44.0), region="beacon",
              bottom=True)
    # the small holder: half sunk
    drum(b, SMALL, 11.0, 0.0, 2.6, region="brick_plain", n=12)
    disc(b, (SMALL[0], SMALL[1], 2.6), UP, 11.0, n=12, col="#6f7a7a", phase=math.pi / 12, tag="roof")
    holder_bell(b, SMALL, [(10.2, 2.6, 7.8), (9.7, 7.8, 12.2)], 2.6)
    holder_frame(b, SMALL, 11.5, 31.0, (15.5, 30.2), name="small")
    b.bite_hint = (27.6, -27.6, 13.6)

    # rubble: the iron rings of a frame, lying tilted on the heap, a column stub still standing
    st = mark(b)
    for (cx, cy, r, z, rx, rz) in ((-6.0, 4.0, 10.0, 3.6, 9.0, 10.0), (5.0, -3.0, 8.0, 5.4, -14.0, 40.0),
                                   (-2.0, -6.0, 7.0, 2.4, 22.0, 75.0)):
        s0 = mark(b)
        pts = ring_pts((0, 0, 0), UP, r, 8)
        for k in range(8):
            mid = (pts[k] + pts[(k + 1) % 8]) / 2
            bar(b, pts[k], pts[(k + 1) % 8], 0.9, IRON, side=mid, caps=True)
        ring = take(b, s0)
        ring.rotx(rx).rotz(rz).move(cx, cy, z)
        b.intact += ring.faces
    bar(b, (12.0, 12.0, 0.0), (14.5, 13.0, 15.0), 1.2, IRON, side=(1, 0, 0), caps=True)
    keep = take(b, st)
    for f in keep.faces:
        f.tag = "rubble"
    b.keepsake = keep

    def damage(b, m):
        # the big frame twisted: every member's points turn round the holder's axis, more the
        # higher they are, and lean a little away from the street
        cx, cy = BIG
        frame = [f for f in m.faces if f.tag.split("|")[-1].startswith("big_") or f.tag.split("|")[-1] == "beacon"]
        for f in frame:
            new = []
            for p in f.pts:
                t = max(0.0, p[2] - 6.0) / 38.0
                a = math.radians(26.0 * t ** 1.4)
                x, y = p[0] - cx, p[1] - cy
                x, y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
                new.append(np.array([cx + x - 2.2 * t * t, cy + y + 1.0 * t * t, p[2] - 1.5 * t * t]))
            f.pts = new
        # the big holder deflated: the lifts sink into the tank, the crown sags into a dish
        bell = [f for f in m.faces if math.hypot(f.center[0] - cx, f.center[1] - cy) < 13.2 and f.center[2] > 2.7
                and not f.tag.split("|")[-1].startswith("big_")]
        for f in bell:
            new = []
            for p in f.pts:
                z = p[2]
                if z > 2.7:
                    z = 2.6 + (z - 2.6) * 0.42
                    r = math.hypot(p[0] - cx, p[1] - cy)
                    if r < 11.0:
                        z -= 3.2 * (1 - r / 11.0) + 1.4
                new.append(np.array([p[0], p[1], z]))
            f.pts = new
        st = mark(b)
        steam(b, (cx + 2.0, cy - 1.0, 17.0), size=2.6, n=2, seed=3)
        m.faces.extend(take(b, st).faces)
    b.damage_hook = hooked(damage)


# ==== Sevenfold Temple ========================================================================
TEMPLE_STONE = "#eadcbf"


def stairs(b, side, half_w, z_top, edge, run, steps, *, col="#efe5cf", riser="#d6c8a8", cheek=0.9):
    """A flight of steps down from a platform's edge (at distance `edge` from the center) to the
    ground on `side` ("front" = -y, "left" = +x, "back" = +y, "right" = -x), with a sloped cheek
    wall on each side."""
    out = {"front": (0, -1), "left": (1, 0), "back": (0, 1), "right": (-1, 0)}[side]
    o = _v((*out, 0.0))
    t = _v((-out[1], out[0], 0.0))                 # along the edge

    def P(u, v, z):
        return t * u + o * v + UP * z
    rise, tread = z_top / steps, run / steps
    for k in range(steps):
        z = z_top - k * rise
        v0, v1 = edge + k * tread, edge + (k + 1) * tread
        face(b, [P(-half_w, v0, z), P(half_w, v0, z), P(half_w, v1, z), P(-half_w, v1, z)], col, want=UP, tag="roof")
        face(b, [P(-half_w, v1, z), P(half_w, v1, z), P(half_w, v1, z - rise), P(-half_w, v1, z - rise)], riser,
             want=o)
    for s in (-1, 1):
        u0, u1 = s * half_w, s * (half_w + cheek)
        lo, hi = 0.55, z_top + 0.55
        ve = edge + run
        for u, w in ((u1, s), (u0, -s)):
            face(b, [P(u, edge, 0.0), P(u, ve, 0.0), P(u, ve, lo), P(u, edge, hi)], None, region="concrete_plain",
                 tone=TEMPLE_STONE, want=t * w)
        face(b, [P(u0, edge, hi), P(u1, edge, hi), P(u1, ve, lo), P(u0, ve, lo)], GOLD, want=UP + o * 0.5)
        face(b, [P(u0, ve, 0.0), P(u1, ve, 0.0), P(u1, ve, lo), P(u0, ve, lo)], TEMPLE_STONE, want=o)


def brim(b, r_in, R, z, *, n=12, lift=0.75, band=0.65, phase=None, cap=False):
    """A wide flat hat-brim roof round a drum: a gently sloped terracotta ring from the rim
    (R, z) up to the next drum (r_in, z + lift), a gold band at the rim, a flat underside."""
    ph = math.pi / n if phase is None else phase
    outer = ring_pts((0, 0, z), UP, R, n, ph)
    inner = ring_pts((0, 0, z + lift), UP, r_in, n, ph)
    for k in range(n):
        q = [outer[k], outer[(k + 1) % n], inner[(k + 1) % n], inner[k]]
        face(b, q, None, region="tile_terra", want=UP, tag="roof")
        mid = (outer[k] + outer[(k + 1) % n]) / 2
        mid[2] = 0
        face(b, [outer[k] - UP * band, outer[(k + 1) % n] - UP * band, outer[(k + 1) % n], outer[k]], GOLD, want=mid)
    face(b, [p - UP * band for p in outer], TERRA_DK, want=-UP, tag="underside")
    if cap:
        face(b, inner, TERRA_DK, want=UP, tag="roof")
    b.solids.append(np.array(outer + [p - UP * band for p in outer] + inner, float))


def bell(b, top, size=1.0, *, n=5):
    """A big bronze bell hanging from `top`: crown, flared body, dark mouth."""
    t = _v(top)
    tube(b, t, t - UP * 1.55 * size, 0.38 * size, n=n, r1=0.86 * size, col=BRONZE, caps=False)
    disc(b, t - UP * 1.55 * size, -UP, 0.86 * size, n=n, col=BRONZE_DK, phase=math.pi / n)
    disc(b, t, UP, 0.38 * size, n=n, col=BRONZE, phase=math.pi / n)


def festoon(b, a, c, sag, *, size=1.0, out=None):
    """A thick rope slung from point a to point c, sagging `sag` meters, a bell at its lowest point."""
    a, c = _v(a), _v(c)
    m = (a + c) / 2 - UP * sag
    if out is not None:
        m = m + _v(out) * 0.6
    for p, q in ((a, m), (m, c)):
        tube(b, p, q, 0.3, n=3, col="#c9a46a", caps=False)
    bell(b, m + UP * 0.1, size)


@kit.building("sevenfold_temple", district="temple", tone="cream", seed=81)
def sevenfold_temple(b):
    # A square stone platform with a flight of steps on every side; on it seven round drums, each
    # narrower and shorter than the one below, each under a wide, flat terracotta brim edged in
    # gold (a stack of hat brims); the lowest drum an arcade. Thick ropes hung with big bronze
    # bells loop under the first, third and fifth brims. On top an open belfry with the biggest
    # bell, a gold ball and a gold point. Invented: no upturned eaves, no symbols.
    zp = 4.0
    P = 15.0
    for name, nrm in (("front", (0, -1, 0)), ("left", (1, 0, 0)), ("back", (0, 1, 0)), ("right", (-1, 0, 0))):
        n3 = _v(nrm)
        t = np.cross(UP, n3)
        c = n3 * P
        face(b, [c - t * P, c + t * P, c + t * P + UP * zp, c - t * P + UP * zp], None, region="concrete_plain",
             tone=TEMPLE_STONE, want=n3, tag="wall")
        face(b, [c - t * P + UP * zp, c + t * P + UP * zp, c + t * P * 1.0 + UP * (zp + 0.5) + n3 * 0.0,
                 c - t * P + UP * (zp + 0.5)], TERRA, want=n3, tag="wall")
        with part(b, f"stairs_{name}"):
            stairs(b, name, 6.0, zp + 0.5, P, 7.0, 6)
    face(b, [(-P, -P, zp + 0.5), (P, -P, zp + 0.5), (P, P, zp + 0.5), (-P, P, zp + 0.5)], "#efe5cf", want=UP, tag="roof")
    box_solid(b, (-P, -P, 0.0), (P, P, zp + 0.5))
    # the seven drums and their brims
    drums = [(12.2, 6.0, 4.6), (10.4, 5.2, 4.2), (8.8, 4.6, 3.8), (7.4, 4.1, 3.4), (6.1, 3.7, 3.0), (4.9, 3.3, 2.6),
             (3.8, 2.9, 2.2)]
    z = zp + 0.5
    b.tiers = []
    for i, (r, h, ext) in enumerate(drums):
        z0, z1 = z, z + h
        if i == 0:
            drum(b, (0, 0), r, z0, z1, region="arcade", per_side=2, tint=True)
        else:
            drum(b, (0, 0), r, z0, z1, region="plaster_plain", tint=True)
        r_next = drums[i + 1][0] if i + 1 < len(drums) else 1.6
        lift = 0.8 if i < 6 else 1.2
        brim(b, r_next, r + ext, z1 + 0.25, lift=lift, cap=(i == len(drums) - 1))
        b.tiers.append((r, z0, z1, r + ext, z1 + 0.25))
        z = z1 + 0.25 + lift
    # arched windows on the second to fifth drums, on the four main sides
    for i in (1, 3):
        r, z0, z1, _, _ = b.tiers[i]
        ap = r * math.cos(math.pi / 12)
        for k in range(4):
            a = math.pi / 2 * k - math.pi / 2
            n3 = _v((math.cos(a), math.sin(a), 0.0))
            h = (z1 - z0) * 0.62
            arch_window(b, n3 * ap + UP * (z0 + (z1 - z0) * 0.18), n3, min(1.7, h * 0.45), h, frame=GOLD, frame_w=0.3)
    # garlands: thick ropes zig-zag from each brim's rim down to the rim of the brim below, a big
    # bronze bell hanging over the lower rim at every low point (seen from the street and from above)
    b.garlands = []
    for i, count, size in ((0, 6, 1.55), (2, 5, 1.3)):
        _, _, _, R0, zb0 = b.tiers[i]
        _, _, _, R1, zb1 = b.tiers[i + 1]
        for k in range(count):
            au, al, an = (2 * math.pi * (k + o) / count for o in (0.0, 0.5, 1.0))
            up0 = _v((R1 * 0.96 * math.cos(au), R1 * 0.96 * math.sin(au), zb1 - 0.35))
            up1 = _v((R1 * 0.96 * math.cos(an), R1 * 0.96 * math.sin(an), zb1 - 0.35))
            low = _v(((R0 + 0.45) * math.cos(al), (R0 + 0.45) * math.sin(al), zb0 + 0.25))
            with part(b, f"garland_{i}_{k}"):
                for p0 in (up0, up1):
                    tube(b, p0, low, 0.32, n=3, col="#c9a46a", caps=False)
                bell(b, low + _v((math.cos(al), math.sin(al), 0.0)) * 0.5 - UP * 0.1, size)
            b.garlands.append((f"garland_{i}_{k}", up0, al, size))
    # the open belfry on top, its bell, the gold ball and point
    zt = z
    with part(b, "belfry"):
        for k in range(4):
            a = math.pi / 4 + math.pi / 2 * k
            x, y = 1.9 * math.cos(a), 1.9 * math.sin(a)
            bar(b, (x, y, zt - 0.4), (x, y, zt + 4.2), 0.45, TERRA, caps=False)
        bell(b, (0, 0, zt + 4.0), 1.15)
    brim(b, 0.9, 3.4, zt + 4.4, lift=0.9, n=12, cap=True)
    tube(b, (0, 0, zt + 5.2), (0, 0, zt + 6.2), 0.5, n=6, col=GOLD)
    # a faceted gold ball
    rb, zc = 1.25, zt + 7.2
    rings = [(0.0, -1.0), (0.75, -0.66), (1.0, 0.0), (0.75, 0.66), (0.0, 1.0)]
    for j in range(len(rings) - 1):
        (ra, za), (rc, zc2) = rings[j], rings[j + 1]
        A = ring_pts((0, 0, zc + za * rb), UP, ra * rb, 6) if ra > 0 else None
        C = ring_pts((0, 0, zc + zc2 * rb), UP, rc * rb, 6) if rc > 0 else None
        for k in range(6):
            if A is None:
                q = [_v((0, 0, zc + za * rb)), C[(k + 1) % 6], C[k]]
            elif C is None:
                q = [A[k], A[(k + 1) % 6], _v((0, 0, zc + zc2 * rb))]
            else:
                q = [A[k], A[(k + 1) % 6], C[(k + 1) % 6], C[k]]
            face(b, q, GOLD if j % 2 else "#f0c75a", want=np.mean(q, axis=0) - _v((0, 0, zc)))
    tube(b, (0, 0, zc + rb), (0, 0, 52.0), 0.32, n=4, r1=0.0, col=GOLD)
    b.solids.append(np.array([(x, y, zz) for x in (-1.6, 1.6) for y in (-1.6, 1.6) for zz in (zt + 4.4, zc + rb)], float))
    b.bite_hint = (0.0, 0.0, 62.0)      # the kit's top bite only takes what the hook removes anyway

    # rubble: the lowest brim lying on the platform, tilted, a bell beside it
    st = mark(b)
    r, z0, z1, R, zb = b.tiers[0]
    brim(b, r - 1.0, R * 0.9, 1.4, lift=0.7, cap=True)
    b.solids.pop()
    bell(b, (R * 0.5, -R * 0.66, 3.4), 1.7)
    keep = take(b, st)
    keep.rotx(6.0).roty(-4.0).move(0.0, 0.0, 2.0)
    for f in keep.faces:
        f.tag = "rubble"
    b.keepsake = keep

    def damage(b, m):
        # the top three drums gone: the fourth brim stays, round a broken stump of the fifth drum
        r4, z0_4, z1_4, R4, zb4 = b.tiers[3]
        r5, z0_5 = b.tiers[4][0], b.tiers[4][1]
        cut = z0_5 + 0.9
        top = select(m, lambda f: f.center[2] > z0_5 - 0.05 and not f.tag.startswith("interior"))
        stump = [f for f in top if f.tag.split("|")[0] == SHELL and min(p[2] for p in f.pts) < cut]
        below, _ = clip_split(stump, cut)
        remove_faces(m, top)
        m.faces.extend(below)
        m.faces[:] = [f for f in m.faces if not (f.tag.startswith("interior") and f.center[2] > z0_5)]
        st = mark(b)
        disc(b, (0, 0, cut - 0.25), UP, r5 * 1.0, n=12, region="rubble", phase=math.pi / 12, tag="interior")
        for f in below:                            # the stump's inside, seen over its broken edge
            face(b, [p - f.normal * 0.3 for p in f.pts], "#5d5852", want=-f.normal, tag="interior")
        annulus(b, (0, 0, cut), UP, r5 - 0.3, r5 * 1.01, n=12, col="#9a9aa1", phase=math.pi / 12, tag="interior")
        # charred beams and a heap of broken drum on the stump
        bar(b, (-2.6, -2.0, cut - 0.4), (1.2, 1.6, cut + 3.4), 0.45, "#3a3330", caps=True)
        bar(b, (3.2, 0.6, cut - 0.4), (0.2, -1.4, cut + 2.2), 0.45, "#3a3330", caps=True)
        tube(b, (0.8, 1.0, cut - 0.3), (0.4, 0.9, cut + 1.8), 2.6, n=5, r1=0.6, col="#9a9aa1", caps=True)
        m.faces.extend(take(b, st).faces)
        # bells hanging loose: on some garlands the low end has torn off the rim, and the bell hangs
        # straight down on its rope from the brim above
        for name, up0, al, size in [g for g in b.garlands if g[0] in ("garland_0_1", "garland_0_4", "garland_2_2")]:
            remove_faces(m, [f for f in m.faces if f.tag.split("|")[-1] == name])
            st = mark(b)
            low = up0 + _v((math.cos(al), math.sin(al), 0.0)) * 1.4 - UP * 7.5
            tube(b, up0, low, 0.32, n=3, col="#c9a46a", caps=False)
            bell(b, low + UP * 0.1, size)
            m.faces.extend(take(b, st).faces)
    b.damage_hook = hooked(damage)


# ==== Grand Meridian Station ==================================================================
def banded(b, w, d, h, at, *, band=0.9, band_region="cornice", roof="gravel", sides=None, **kw):
    """A flat-roofed block finished by a cornice band with the roof on top of it (reads as a
    parapet without thin inner walls). Returns the Block with z1 = the roof surface."""
    import dataclasses
    blk = b.block(w, d, h, at=at, roof=False, sides=sides, solid=False, **kw)
    for name in kit.SIDES:
        if sides and name in sides and sides[name] is None:
            continue
        a, c, _n = blk.side(name)
        b.wall(a, c, blk.z1, blk.z1 + band, band_region)
    zt = blk.z1 + band
    x0, x1, y0, y1 = blk.x0, blk.x1, blk.y0, blk.y1
    b.intact += map_region([(x0, y0, zt), (x1, y0, zt), (x1, y1, zt), (x0, y1, zt)], roof, tag="roof")
    box_solid(b, (x0, y0, at[2]), (x1, y1, zt))
    return dataclasses.replace(blk, z1=zt, top=zt)


def vault_pts(half, z_spring, z_top, n):
    """(x, z) points of a segmental arch of span 2*half rising from z_spring to z_top."""
    rise = z_top - z_spring
    R = (half * half + rise * rise) / (2 * rise)
    zc = z_top - R
    a = math.asin(half / R)
    return [(R * math.sin(-a + 2 * a * k / n), zc + R * math.cos(-a + 2 * a * k / n)) for k in range(n + 1)]


@kit.building("grand_station", district="downtown", tone="stone", seed=91)
def grand_station(b):
    # A cream stone front range (arcaded ground storey) with a taller central pavilion: three
    # great arched doorways and a big round clock window, a copper barrel roof. Two short towers
    # with copper pyramids at the ends, low wings behind them. Behind it all the train shed: one
    # great segmental barrel vault of glass on green iron ribs, glazed fan ends, platforms and a
    # waiting train inside (they show when the vault falls in).
    HW, Y0, Y1 = 45.0, -11.0, 24.5          # the shed: half width, front and back
    ZS, ZT = 14.0, 39.0                      # springing and crown of the vault (its ribs reach 40)
    ZC = ZT - (HW * HW + (ZT - ZS) ** 2) / (2 * (ZT - ZS))      # the vault's circle center height
    front = banded(b, 2 * HW, 10.0, 13.6, (0.0, -16.0, 0.0), band=0.9, facade="stone_grid", ground="arcade",
                   band_region="cornice")
    for x in (-34.0, -24.0, 24.0, 34.0):
        b.door(front, "front", x=x, kind="door_double")
    for sx in (-1, 1):
        tw = banded(b, 10.0, 10.0, 27.0, (sx * 50.0, -16.0, 0.0), band=1.0, facade="stone_grid", ground="plinth",
                    band_region="cornice")
        b.cone((sx * 50.0, -16.0), 5.4 * math.sqrt(2), tw.z1, 34.6, n=4, region="copper", phase=math.pi / 4)
        disc(b, (sx * 50.0, -16.0, tw.z1), -UP, 5.4 * math.sqrt(2), n=4, col=COPPER_IN, phase=math.pi / 4)
        b.solids.append(np.array([(sx * 50 + dx, -16 + dy, tw.z1) for dx in (-5.4, 5.4) for dy in (-5.4, 5.4)]
                                 + [(sx * 50, -16, 34.6)], float))
        with part(b, f"finial_{sx}"):
            tube(b, (sx * 50.0, -16.0, 34.4), (sx * 50.0, -16.0, 36.4), 0.35, n=4, r1=0.05, col=GOLD)
        b.decal(tw, "front", 0.0, 18.0, 5.0, 2.5, "sign_rings", offset=0.06)
        wing = banded(b, 10.0, 35.5, 8.2, (sx * 50.0, 6.75, 0.0), band=0.8, facade="stone_grid", ground="arcade",
                      ground_h=4.5)
        _ = wing
    # the central pavilion: walls, arched top, copper barrel roof
    PW, PY0, PY1, PZ, PA = 15.0, -21.6, -9.0, 21.0, 5.5
    arc = vault_pts(PW, PZ, PZ + PA, 6)
    for y, nrm in ((PY0, (0, -1, 0)), (PY1, (0, 1, 0))):
        pts = [(-PW, y, 0.0), (PW, y, 0.0)] + [(x, y, z) for x, z in reversed(arc)]
        face(b, pts, None, region="concrete_plain", tone=CREAM, want=nrm, tag="wall")
    for x, nrm in ((-PW, (-1, 0, 0)), (PW, (1, 0, 0))):
        face(b, [(x, PY0, 0.0), (x, PY1, 0.0), (x, PY1, PZ), (x, PY0, PZ)], None, region="concrete_plain", tone=CREAM,
             want=nrm, tag="wall")
    for k in range(len(arc) - 1):
        (xa, za), (xb, zb) = arc[k], arc[k + 1]
        face(b, [(xa, PY0 - 0.4, za), (xb, PY0 - 0.4, zb), (xb, PY1 + 0.4, zb), (xa, PY1 + 0.4, za)], None,
             region="copper", want=(xa + xb, 0, 6.0), tag="roof")
        face(b, [(xa, PY0 - 0.4, za - 0.3), (xb, PY0 - 0.4, zb - 0.3), (xb, PY0 - 0.4, zb), (xa, PY0 - 0.4, za)], GOLD,
             want=(0, -1, 0))
    b.solids.append(np.array([(x, y, 0.0) for x in (-PW, PW) for y in (PY0, PY1)]
                             + [(x, y, z) for x, z in arc for y in (PY0, PY1)], float))
    b.box((-PW - 0.4, PY0 - 0.4, 12.8), (PW + 0.4, PY1, 13.6), color=CREAM_DK, top="white", bottom=True)  # string course
    # three great arched doorways, the clock window over the middle one
    for x in (-8.5, 0.0, 8.5):
        arch_window(b, (x, PY0, 0.0), (0, -1, 0), 5.0, 10.5, frame=CREAM_DK, frame_w=0.6)
        b.decal(kit.Block(x - 3, x + 3, PY0 - 0.08, PY1, 0, 10, "x", False, (1, 1, 1)), "front", 0.0, 0.0, 2.25,
                2.625, "door_double", offset=0.02)
    clock_face(b, (0.0, PY0 - 0.1, 18.4), (0, -1, 0), 4.2, hands=(-50.0, 62.0), frame=IRON)
    # entrance canopy of glass on iron
    with part(b, "canopy"):
        b.box((-13.0, PY0 - 3.6, 5.4), (13.0, PY0, 5.8), color=IRON, top="glass_roof", bottom=True)
        for x in (-12.5, 12.5):
            bar(b, (x, PY0 - 3.3, 0.0), (x, PY0 - 3.3, 5.4), 0.35, IRON)
    # the shed: side walls up to the springing, the vault, ribs, glazed ends
    for x, nrm in ((-HW, (-1, 0, 0)), (HW, (1, 0, 0))):
        face(b, [(x, Y0, 9.0), (x, Y1, 9.0), (x, Y1, ZS), (x, Y0, ZS)], None, region="stone_grid", want=nrm, tag="wall")
    face(b, [(-HW, Y1, 0.0), (HW, Y1, 0.0), (HW, Y1, ZS), (-HW, Y1, ZS)], None, region="arcade", tint=True,
         want=(0, 1, 0), tag="wall", unit=(12.0, ZS))
    pts = vault_pts(HW, ZS, ZT, 10)
    b.vault = pts
    for k in range(10):
        (xa, za), (xb, zb) = pts[k], pts[k + 1]
        out = (xa + xb, 0.0, (za + zb) / 2 + 12.0)
        reg = "glass_roof" if 1 <= k <= 8 else "metal"
        face(b, [(xa, Y0, za), (xb, Y0, zb), (xb, Y1, zb), (xa, Y1, za)], None, region=reg, want=out, tag="roof",
             tone=None if reg == "glass_roof" else "#9fc2b0")
        face(b, [(xa, Y0, za - 0.3), (xb, Y0, zb - 0.3), (xb, Y1, zb - 0.3), (xa, Y1, za - 0.3)], "#3d4a46",
             want=(-out[0], 0, -out[2]), tag=SHELL)
    b.solids.append(np.array([(x, y, z) for x, z in pts for y in (Y0, Y1)] + [(-HW, Y0, 0), (HW, Y0, 0), (-HW, Y1, 0),
                                                                               (HW, Y1, 0)], float))
    for y in (Y0, -2.0, 11.0, Y1):
        th = 1.0 if y in (Y0, Y1) else 0.7
        for k in range(10):
            (xa, za), (xb, zb) = pts[k], pts[k + 1]
            n0 = _v((xa, 0, za - ZC)) / np.linalg.norm((xa, 0, za - ZC))
            n1 = _v((xb, 0, zb - ZC)) / np.linalg.norm((xb, 0, zb - ZC))
            pa, pb = _v((xa, y, za)), _v((xb, y, zb))
            oa, ob = pa + n0 * th, pb + n1 * th
            dy = _v((0, th / 2, 0))
            with part(b, f"rib_{int(y)}_{k}"):
                face(b, [oa - dy, ob - dy, ob + dy, oa + dy], IRON, want=(n0 + n1))
                face(b, [pa - dy, pb - dy, ob - dy, oa - dy], IRON_DK, want=(0, -1, 0))
                face(b, [pa + dy, pb + dy, ob + dy, oa + dy], IRON_DK, want=(0, 1, 0))
                if y in (Y0, Y1):
                    face(b, [pa - dy, pb - dy, pb + dy, pa + dy], IRON_DK, want=-(n0 + n1))
                tg = pb - pa
                if k in (0, 7):            # end caps where a rib can be seen end-on (springing, the gap)
                    face(b, [pa - dy, pa + dy, oa + dy, oa - dy], IRON_DK, want=-tg)
                if k in (2, 9):
                    face(b, [pb - dy, pb + dy, ob + dy, ob - dy], IRON_DK, want=tg)
    for y, nrm, lun in ((Y0 - 0.02, (0, -1, 0), "lun_f"), (Y1 + 0.02, (0, 1, 0), "lun_b")):
        i0 = mark(b)
        fanp = [(x, y, z) for x, z in pts]
        face(b, fanp, None, region="glass_roof", want=nrm, tag="wall")
        face(b, [(x, y - nrm[1] * 0.08, z) for x, z, in pts], "#7d9a92", want=(0, -nrm[1], 0), tag="detail")
        for k in (2, 4, 5, 6, 8):                      # radiating mullions
            x, z = pts[k]
            c0 = _v((0.0, y, ZS))
            p1 = _v((x, y, z))
            d = (p1 - c0) / np.linalg.norm(p1 - c0)
            e = np.cross(_v(nrm), d) * 0.3
            face(b, [c0 - e + _v(nrm) * 0.05, c0 + e + _v(nrm) * 0.05, p1 + e + _v(nrm) * 0.05, p1 - e + _v(nrm) * 0.05],
                 IRON, want=nrm)
        for f in b.intact.faces[i0:]:
            f.tag = f"{f.tag}|{lun}"            # a mark, not a part: the hook finds the fan ends by it
    face(b, [(-HW, Y1 - 0.1, 0.0), (HW, Y1 - 0.1, 0.0), (HW, Y1 - 0.1, ZS), (-HW, Y1 - 0.1, ZS)], "#b9ae98",
         want=(0, -1, 0), tag="detail")              # the back wall seen from inside
    # inside: track bed, three platforms, a waiting train (seen when the vault falls in)
    face(b, [(-HW, Y0, 0.05), (HW, Y0, 0.05), (HW, Y1, 0.05), (-HW, Y1, 0.05)], "#4a4642", want=UP, tag="detail")
    for x in (-27.0, 0.0, 27.0):
        b.box((x - 4.0, Y0, 0.0), (x + 4.0, Y1 - 1.0, 1.0), color="#cfc8b8", top=None)
    with part(b, "train"):
        for k, y0 in enumerate((-12.0, 2.0)):
            b.box((-17.0, y0, 0.2), (-13.4, y0 + 13.0, 4.0), color=IRON if k else "#2f5a43", top="white")
            b.intact.faces[-1].col = hex_rgb("#d9d4c6")
    b.bite_hint = (55.0, -21.0, 34.0)

    # rubble: the clock face on the heap
    st = mark(b)
    b.box((-3.0, -0.6, 0.0), (3.0, 0.6, 2.0), region="concrete_plain", top="rubble")
    clock_face(b, (0.0, -0.65, 5.4), (0, -1, 0), 4.2, hands=(-50.0, 62.0), frame=IRON, shattered={0, 5, 6})
    face(b, ring_pts((0.0, -0.1, 5.4), (0, 1, 0), 4.75, 12), "#6d746f", want=(0, 1, 0))
    keep = take(b, st)
    for f in keep.faces:
        if f.region == "concrete_plain":
            f.col = hex_rgb(CREAM)
    for f in keep.faces:
        f.pts = [p * 1.3 for p in f.pts]
    keep.rotx(-34.0).rotz(-12.0).move(-4.0, -4.0, 1.2)
    s0 = mark(b)                       # a bent rib of the vault, half buried, arching over the heap
    rib = [(x * 0.42, z * 0.0 + (z - ZS) * 0.42) for x, z in vault_pts(HW, ZS, ZT, 6)]
    for (xa, za), (xb, zb) in zip(rib, rib[1:]):
        bar(b, (xa, 0.0, za), (xb, 0.0, zb), 0.8, IRON, caps=True)
    arcm = take(b, s0)
    arcm.rotx(28.0).rotz(14.0).move(14.0, 8.0, 0.5)
    keep.faces.extend(arcm.faces)
    for f in keep.faces:
        f.tag = "rubble"
    b.keepsake = keep

    def damage(b, m):
        # the vault fallen in at the middle: glass and ribs gone over the middle platforms, the
        # broken ribs hanging from both sides, panels of glass lying on the tracks
        gap = 17.0

        def in_gap(f):
            return abs(f.center[0]) < gap and f.center[2] > 16.0 and Y0 + 0.5 < f.center[1] < Y1 + 1.0
        rib_tags = {f.tag.split("|")[-1] for f in m.faces if f.tag.split("|")[-1].startswith("rib_")}
        gone = select(m, lambda f: in_gap(f) and (f.tag.split("|")[0] in ("roof", "underside", SHELL, "interior")
                                                  or f.tag.split("|")[-1].startswith("rib_")))
        remove_faces(m, gone)
        # the panels at the edge of the gap sag into it, hinged on their outer edge
        for sx, k in ((-1, 2), (1, 8)):
            hx, hz = pts[k]
            sag = select(m, lambda f, sx=sx, hx=hx: gap - 0.5 < sx * f.center[0] < abs(hx)
                         and f.center[2] > 16.0 and Y0 - 1.0 < f.center[1] < Y1 + 1.0
                         and f.tag.split("|")[0] in ("roof", SHELL, "interior", "detail")
                         and not f.tag.split("|")[-1].startswith("lun_"))
            rotate_faces(sag, (0, 1, 0), -sx * 26.0, (hx, 0.0, hz))
        # the back fan end broken out above the gap
        for f in [f for f in m.faces if f.tag.endswith("|lun_b")]:
            keep = [clip(f, _v((1, 0, 0)), -gap, True), clip(f, _v((1, 0, 0)), gap, False)]
            mid = clip(f, _v((1, 0, 0)), gap, True)
            mid = clip(mid, _v((1, 0, 0)), -gap, False) if mid else None
            keep.append(clip(mid, _v((0.3, 0, 1)), 0.3 * 0 + 24.0, True) if mid else None)
            remove_faces(m, [f])
            for g in keep:
                if g is not None and g.area > 1e-3:
                    g.tag = f.tag
                    m.faces.append(g)
        # hanging rib ends
        st = mark(b)
        for y in (-2.0, 11.0):
            for sx in (-1, 1):
                k = 3 if sx < 0 else 6
                x, z = pts[k] if sx < 0 else pts[k + 1]
                p0 = _v((x, y, z))
                p1 = p0 + _v((sx * -2.5, 0.0, -9.0))
                bar(b, p0, p1, 0.7, IRON, caps=True)
        for (x, y, rz, tilt) in ((-6.0, 0.0, 20.0, 18.0), (8.0, 9.0, -30.0, 24.0), (-11.0, 15.0, 70.0, 12.0),
                                 (4.0, -9.0, 5.0, 30.0)):
            s0 = mark(b)
            face(b, [(-4.5, -2.5, 0.0), (4.5, -2.5, 0.0), (4.5, 2.5, 0.0), (-4.5, 2.5, 0.0)], None, region="glass_roof",
                 want=UP, tag="interior")
            face(b, [(-4.5, -2.5, -0.1), (4.5, -2.5, -0.1), (4.5, 2.5, -0.1), (-4.5, 2.5, -0.1)], "#3d4a46", want=-UP,
                 tag="interior")
            pane = take(b, s0)
            pane.rotx(tilt).rotz(rz).move(x, y, 2.4)
            b.intact += pane.faces
        steam(b, (2.0, 4.0, 4.0), size=3.5, n=3, seed=5)
        m.faces.extend(take(b, st).faces)
        _ = rib_tags
    b.damage_hook = hooked(damage)


# ==== Kiln Point Power Station ================================================================
def square_shaft(b, c, h0, h1, z0, z1, *, region="brick_plain", tone=None, top=None, tag="wall", tops=None,
                 unit=None):
    """A square, tapering shaft (a chimney) from half width h0 at z0 to h1 at z1. `tops` gives
    the four corner heights of a broken top instead (a stump)."""
    cx, cy = c
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    zt = tops or [z1] * 4
    for k in range(4):
        (ax, ay), (bx, by) = corners[k], corners[(k + 1) % 4]
        ha = h0 + (h1 - h0) * (zt[k] - z0) / max(z1 - z0, 1e-6)
        hb = h0 + (h1 - h0) * (zt[(k + 1) % 4] - z0) / max(z1 - z0, 1e-6)
        q = [(cx + ax * h0, cy + ay * h0, z0), (cx + bx * h0, cy + by * h0, z0),
             (cx + bx * hb, cy + by * hb, zt[(k + 1) % 4]), (cx + ax * ha, cy + ay * ha, zt[k])]
        out = ((ax + bx) / 2, (ay + by) / 2, 0.0)
        if tops:
            # a broken top: split the side so each piece is planar
            face(b, q[:3], None, region=region, tone=tone, want=out, tag=tag)
            face(b, [q[0], q[2], q[3]], None, region=region, tone=tone, want=out, tag=tag)
        else:
            face(b, q, None, region=region, tone=tone, want=out, tag=tag, unit=unit, origin=q[0] if unit else None)
    if top:
        def hw(z):
            return h0 + (h1 - h0) * (z - z0) / max(z1 - z0, 1e-6)
        tp = [(cx + ax * hw(zt[k]), cy + ay * hw(zt[k]), zt[k]) for k, (ax, ay) in enumerate(corners)]
        col, sw = ("#ffffff", "dark") if top == "dark" else (top, "white")
        if tops:
            face(b, tp[:3], col, want=UP, swatch=sw)
            face(b, [tp[0], tp[2], tp[3]], col, want=UP, swatch=sw)
        else:
            face(b, tp, col, want=UP, swatch=sw)
    b.solids.append(np.array([(cx + ax * h0, cy + ay * h0, z0) for ax, ay in corners]
                             + [(cx + ax * h1, cy + ay * h1, z1 if not tops else max(zt)) for ax, ay in corners], float))


def kp_chimney(b, c, name):
    """One of Kiln Point's four chimneys: dark brick, a stone collar at the hall's eaves, a pale
    band near the top and soot-black above it, the open top dark."""
    with part(b, name + "_band"):
        b.box((c[0] - 3.75, c[1] - 3.75, 30.0), (c[0] + 3.75, c[1] + 3.75, 31.4), color=CREAM_DK, top="white",
              bottom=True)
    square_shaft(b, c, 3.5, 2.95, 0.0, 70.0, tone=BRICK_DK, unit=(12.0, 14.0))
    b.solids.pop()
    square_shaft(b, c, 2.95, 2.95, 70.0, 71.6, region="concrete_plain", tone=CREAM)
    b.solids.pop()
    square_shaft(b, c, 2.95, 2.75, 71.6, 82.0, tone=SOOT, top="dark")
    b.solids.pop()
    b.solids.append(np.array([(c[0] + dx, c[1] + dy, z) for dx in (-3.5, 3.5) for dy in (-3.5, 3.5) for z in (0.0, 41.0)],
                             float))
    # the upper solid is drawn a little fat: the kit drops a chunk cell holding less than 4% of its
    # volume, and a true-size chimney top would leave the chunks without their top 27 m
    b.solids.append(np.array([(c[0] + dx, c[1] + dy, z) for dx in (-4.4, 4.4) for dy in (-4.4, 4.4) for z in (41.0, 82.0)],
                             float))


@kit.building("kiln_point_power", district="industry", tone="concrete", seed=101)
def kiln_point_power(b):
    # The turbine hall: a long dark red-brown brick hall with tall round-headed windows, a stone
    # cornice and a slate roof with a long ridge vent; a square chimney at each corner rising to
    # 82 m, stone-collared at the eaves, a pale band and soot-black above it. A lower boiler house
    # behind, switch houses at both ends, a transformer yard behind a low wall on the street side.
    HX, HY, HZ = 42.0, 16.0, 29.0
    b.interior_backs = False        # a big hall: the holes are seen from outside only
    hall = b.block(2 * HX, 2 * HY, HZ, facade="brick_plain", roof=False)
    for f in b.intact.faces:
        if f.region == "brick_plain":
            f.col = hex_rgb(BRICK_DK)
    b.box((-HX - 0.4, -HY - 0.4, HZ), (HX + 0.4, HY + 0.4, HZ + 1.0), color=CREAM_DK, top=None, bottom=True)
    zr = b.gable(hall, rise=7.0, along="x", roof="tile_slate", window=False)
    with part(b, "ridge_vent"):
        for y, nrm in ((-1.6, (0, -1, 0)), (1.6, (0, 1, 0))):
            face(b, [(-30.0, y, zr - 1.2), (30.0, y, zr - 1.2), (30.0, y, zr + 1.6), (-30.0, y, zr + 1.6)], None,
                 region="vent", want=nrm, unit=(7.5, 2.8))
        for x, nrm in ((-30.0, (-1, 0, 0)), (30.0, (1, 0, 0))):
            face(b, [(x, -1.6, zr - 1.2), (x, 1.6, zr - 1.2), (x, 1.6, zr + 1.6), (x, -1.6, zr + 1.6)], "#5d636e", want=nrm)
        face(b, [(-30.6, -2.2, zr + 1.6), (30.6, -2.2, zr + 1.6), (30.6, 2.2, zr + 1.6), (-30.6, 2.2, zr + 1.6)], "#4f5866",
             want=UP, tag="roof")
        face(b, [(-30.6, -2.2, zr + 1.5), (30.6, -2.2, zr + 1.5), (30.6, 2.2, zr + 1.5), (-30.6, 2.2, zr + 1.5)], "#3a3f4a",
             want=-UP)
    # tall round-headed windows, long sides and ends
    for y, nrm in ((-HY, (0, -1, 0)),):              # the back wall is behind the boiler house
        for i in range(8):
            x = -HX + 5.25 + i * 10.5
            arch_window(b, (x, y, 4.0), nrm, 4.6, 21.0, frame=CREAM_DK, frame_w=0.5, segs=3)
    for x, nrm in ((-HX, (-1, 0, 0)), (HX, (1, 0, 0))):
        for y, w, h in ((0.0, 6.0, 24.0), (-8.5, 3.6, 17.0), (8.5, 3.6, 17.0)):
            arch_window(b, (x, y, 3.0), nrm, w, h, frame=CREAM_DK, frame_w=0.5, segs=3)
    # four chimneys at the corners
    b.chimneys = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = (sx * HX, sy * (HY + 0.5))
            name = f"chim_{'l' if sx > 0 else 'r'}{'f' if sy < 0 else 'b'}"
            kp_chimney(b, c, name)
            b.chimneys[name] = c
    # boiler house behind, switch houses at the ends
    boil = banded(b, 70.0, 17.0, 21.0, (0.0, 26.5, 0.0), band=1.0, facade="brick_works", sides={"front": None})
    _ = boil
    for sx in (-1, 1):
        sw = banded(b, 9.0, 26.0, 17.0, (sx * 50.25, 0.0, 0.0), band=0.8, facade="brick_works")
        b.door(sw, "front", x=0.0, kind="door_roller")
    for f in b.intact.faces:
        if f.region == "brick_works":
            f.col = hex_rgb("#c29a8e")
    b.door(hall, "front", x=-26.25, kind="door_roller")
    b.door(hall, "front", x=26.25, kind="door_roller")
    # the transformer yard: four transformers with radiators and insulators, a portal gantry
    # carrying the lines to the hall, a low wall along the street
    for x in (-22.0, 0.0, 22.0):
        with part(b):
            b.box((x - 3.2, -29.0, 0.0), (x + 3.2, -24.0, 5.2), region="metal_plain", top="metal", tone="#8d9a96")
            for sx in (-1, 1):
                x0, x1 = x + sx * 3.2 - (0.9 if sx < 0 else 0.0), x + sx * 3.2 + (0.9 if sx > 0 else 0.0)
                b.box((x0, -28.4, 0.6), (x1, -24.6, 4.6), color="#5d6866", top="#4f5866" if False else None)
                xo = x1 if sx > 0 else x0
                face(b, [(xo + sx * 0.02, -28.4, 0.6), (xo + sx * 0.02, -24.6, 0.6), (xo + sx * 0.02, -24.6, 4.6),
                         (xo + sx * 0.02, -28.4, 4.6)], None, region="grille", want=(sx, 0, 0), unit=(3.8, 4.0))
            for dx in (-1.6, 1.6):
                tube(b, (x + dx, -26.5, 5.2), (x + dx, -26.5, 8.2), 0.32, n=3, col="#e9e4d8", r1=0.2)
    with part(b, "gantry"):
        for x in (-34.0, 34.0):
            bar(b, (x, -26.5, 0.0), (x, -26.5, 12.0), 0.8, STEEL, caps=True)
        bar(b, (-34.5, -26.5, 12.0), (34.5, -26.5, 12.0), 0.9, STEEL, caps=True)
        for x in (-22.0, 22.0):
            bar(b, (x, -26.5, 12.0), (x, -HY, 20.0), 0.25, STEEL_DK, caps=False)
    for x0, x1 in ((-54.0, -5.0), (5.0, 54.0)):
        with part(b):
            face(b, [(x0, -35.0, 0.0), (x1, -35.0, 0.0), (x1, -35.0, 1.8), (x0, -35.0, 1.8)], None, region="concrete_plain",
                 tone="#cfc9bd", want=(0, -1, 0), unit=(x1 - x0, 1.8))
            face(b, [(x0, -34.4, 0.0), (x1, -34.4, 0.0), (x1, -34.4, 1.8), (x0, -34.4, 1.8)], "#bdb7aa", want=(0, 1, 0))
            face(b, [(x0, -35.0, 1.8), (x1, -35.0, 1.8), (x1, -34.4, 1.8), (x0, -34.4, 1.8)], "#e4dfd3", want=UP)
            for x in (x0, x1):
                face(b, [(x, -35.0, 0.0), (x, -34.4, 0.0), (x, -34.4, 1.8), (x, -35.0, 1.8)], "#bdb7aa",
                     want=(1 if x == x1 else -1, 0, 0))
    b.bite_hint = (12.0, 0.0, zr + 1.0)            # the roof holed in the middle

    # rubble: two chimneys still standing out of the heap, their tops broken off
    st = mark(b)
    for (c, tops) in (((HX - 1.0, HY - 1.0), [27.0, 24.5, 26.2, 22.0]), ((-HX + 1.0, HY - 2.0), [17.5, 19.6, 15.8, 18.4])):
        square_shaft(b, c, 3.5, 2.95, 0.0, 70.0, tone=BRICK_DK, top="dark", tops=tops)
        b.solids.pop()
        b.box((c[0] - 3.75, c[1] - 3.75, 9.0), (c[0] + 3.75, c[1] + 3.75, 10.4), color=CREAM_DK, top="white", bottom=True)
    keep = take(b, st)
    for f in keep.faces:
        f.tag = "rubble"
    b.keepsake = keep

    def damage(b, m):
        # the front right chimney snapped mid-height: its top lies across the hall roof
        cx, cy = b.chimneys["chim_rf"]
        snap = 47.0
        ch = select(m, lambda f: abs(f.center[0] - cx) < 4.0 and abs(f.center[1] - cy) < 4.0 and f.center[2] > snap - 3.0)
        below, above = clip_split(ch, snap)
        remove_faces(m, ch)
        m.faces.extend(below)
        st = mark(b)
        square_shaft(b, (cx, cy), 3.12, 3.12, snap, snap, tone=BRICK_DK, top="dark",
                     tops=[snap, snap, snap, snap])
        b.solids.pop()
        brk = take(b, st)
        brk.faces = [f for f in brk.faces if f.normal[2] > 0.5]
        m.faces.extend(brk.faces)
        under = [Face([p.copy() for p in f.pts[::-1]], f.uv[::-1] if f.uv else None, f.col, False, f.region, "interior")
                 for f in brk.faces]                # the fallen top's broken end
        above.extend(under)
        rotate_faces(above, (0.0, 1.0, 0.0), 104.0, (cx + 3.0, cy, snap))
        move_faces(above, (0.0, 2.0, -1.5))
        m.faces.extend(above)
        st = mark(b)
        steam(b, (12.0, 2.0, zr + 1.5), size=4.5, n=3, seed=7)
        steam(b, (cx + 20.0, cy + 6.0, zr - 1.0), size=2.6, n=2, seed=9)
        m.faces.extend(take(b, st).faces)
    b.damage_hook = hooked(damage)


# ==== Signal Hill Mast ========================================================================
MAST_BANDS = 7
MAST_TOP = 140.0


def mast_hw(z):
    """Half width of the lattice (to the leg centers) at height z."""
    return 7.4 - 5.9 * z / MAST_TOP


def dish(b, c, out, r):
    """A white microwave dish on the mast, facing `out`, with a grey back and a mounting arm."""
    c, o = _v(c), _v(out) / np.linalg.norm(out)
    front = c + o * 0.9
    tube(b, c - o * 0.6, front, 0.55, n=8, r1=r, col="#b9bec6", caps=True)
    disc(b, front + o * 0.04, o, r, n=8, col="#f4f5f7", phase=math.pi / 8)


def lattice_strip(b, p0, p1, w, bays, *, col_a=RED, col_b=WHITE, leg=0.9, nrm=(0, 0, 1)):
    """A flat strip of lattice (two legs, rungs, a zig-zag), p0 to p1, w wide: a fallen piece."""
    p0, p1 = _v(p0), _v(p1)
    d = (p1 - p0) / np.linalg.norm(p1 - p0)
    n = _v(nrm) - d * (d @ _v(nrm))
    n /= np.linalg.norm(n)
    s = np.cross(d, n) * (w / 2)
    L = np.linalg.norm(p1 - p0)
    for k in range(bays):
        a, c = p0 + d * L * k / bays, p0 + d * L * (k + 1) / bays
        col = col_a if k % 2 == 0 else col_b
        bar(b, a - s, c - s, leg, col, side=n, caps=True)
        bar(b, a + s, c + s, leg, col, side=n, caps=True)
        bar(b, c - s, c + s, leg * 0.6, col, side=n)
        bar(b, (a - s) if k % 2 else (a + s), (c + s) if k % 2 else (c - s), leg * 0.5, col, side=n)


@kit.building("signal_mast", district="suburb", tone="white", seed=111)
def signal_mast(b):
    # The television mast: a slim square lattice of four legs, girders and zig-zag bracing in
    # seven red and white bands, tapering from 15 m to 3 m at 140 m; galleries with white dishes
    # at 62 and 102 m; a red-and-white antenna to 160 m; red beacons at the top corners and the
    # tip. A small concrete equipment house stands between the legs.
    faces = (((0, -1, 0), (-1, -1), (1, -1)), ((1, 0, 0), (1, -1), (1, 1)), ((0, 1, 0), (1, 1), (-1, 1)),
             ((-1, 0, 0), (-1, 1), (-1, -1)))
    dz = MAST_TOP / MAST_BANDS
    for j in range(MAST_BANDS):
        za, zc = j * dz, (j + 1) * dz
        col = RED if j % 2 == 0 else WHITE
        ha, hc = mast_hw(za), mast_hw(zc)
        for sx in (-1, 1):
            for sy in (-1, 1):
                with part(b, f"leg_{j}_{sx}{sy}"):
                    z0 = max(za, 0.035)
                    bar(b, (sx * mast_hw(z0), sy * mast_hw(z0), z0), (sx * hc, sy * hc, zc), 1.0, col, side=(sx, sy, 0))
        for k, (nrm, (ax, ay), (cx, cy)) in enumerate(faces):
            with part(b, f"brace_{j}_{k}"):
                bar(b, (ax * hc, ay * hc, zc), (cx * hc, cy * hc, zc), 0.6, col, side=nrm)
                zd = max(za, 0.45)
                hd = mast_hw(zd)
                if j % 2 == 0:
                    bar(b, (ax * hd, ay * hd, zd), (cx * hc, cy * hc, zc), 0.42, col, side=nrm)
                else:
                    bar(b, (cx * hd, cy * hd, zd), (ax * hc, ay * hc, zc), 0.42, col, side=nrm)
        b.solids.append(np.array([(sx * ha, sy * ha, za) for sx in (-1, 1) for sy in (-1, 1)]
                                 + [(sx * hc, sy * hc, zc) for sx in (-1, 1) for sy in (-1, 1)], float))
    # a gallery with three dishes at 62 m; at 98 to 104 m the equipment cabin, a white drum with a
    # band of windows (it lights up at night), two dishes on its rim
    g = mast_hw(62.0) + 1.0
    with part(b, "gallery_62"):
        b.box((-g, -g, 61.5), (g, g, 62.0), color="#e8e8e4", top=None, bottom=True)
    for o, r in (((0, -1, 0), 3.4), ((1, 0, 0), 3.4), ((-1, 0, 0), 3.0)):
        o3 = _v(o)
        with part(b):
            dish(b, o3 * (g + 0.4) + UP * (62.0 + r + 0.4), o3, r)
            bar(b, o3 * (g - 0.6) + UP * 62.05, o3 * (g + 0.4) + UP * (62.0 + r + 0.4), 0.3, STEEL, side=o3)
    RC, Z0, Z1 = 5.8, 97.5, 104.0
    drum(b, (0, 0), RC, Z0 + 1.0, Z1 - 1.0, region="strip_concrete", n=8, per_side=None)
    for zz, h, nrm in ((Z0, 1.0, -UP), (Z1 - 1.0, 1.0, UP)):
        drum(b, (0, 0), RC + 0.5, zz, zz + h, region="concrete_plain", n=8, tone="#f1f1ee", solid=False)
        disc(b, (0, 0, zz if nrm[2] < 0 else zz + h), nrm, RC + 0.5, n=8, col="#e8e8e4" if nrm[2] > 0 else "#b9bec6",
             phase=math.pi / 8, tag="roof")
        if nrm[2] < 0:
            annulus(b, (0, 0, zz + h), UP, RC, RC + 0.5, n=8, col="#e8e8e4", phase=math.pi / 8)
        else:
            annulus(b, (0, 0, zz), -UP, RC, RC + 0.5, n=8, col="#b9bec6", phase=math.pi / 8)
    for o, r in (((-1, 0, 0), 2.6), ((0, 1, 0), 2.6)):
        o3 = _v(o)
        with part(b):
            dish(b, o3 * (RC + 1.2) + UP * (Z1 + r * 0.2), o3, r)
    # the top: a deck, beacons at its corners, the striped antenna and its tip beacon
    ht = mast_hw(MAST_TOP) + 0.8
    with part(b, "top"):
        b.box((-ht, -ht, MAST_TOP), (ht, ht, MAST_TOP + 0.6), color="#e8e8e4", top=None, bottom=True)
        for sx in (-1, 1):
            for sy in (-1, 1):
                b.box((sx * ht - 0.55, sy * ht - 0.55, MAST_TOP + 0.6), (sx * ht + 0.55, sy * ht + 0.55, MAST_TOP + 1.6),
                      region="beacon")
        for k, (z0, z1) in enumerate(((140.6, 146.0), (146.0, 151.0), (151.0, 155.5), (155.5, 159.3))):
            tube(b, (0, 0, z0), (0, 0, z1), 0.75 - 0.12 * k, n=6, r1=0.75 - 0.12 * (k + 1),
                 col=RED if k % 2 == 0 else WHITE)
        b.box((-0.5, -0.5, 159.0), (0.5, 0.5, 160.0), region="beacon")
    b.solids.append(np.array([(x, y, z) for x in (-ht, ht) for y in (-ht, ht) for z in (MAST_TOP, 160.0)], float))
    # the equipment house between the legs
    house = b.block(7.0, 5.0, 3.2, at=(0.0, 0.5, 0.0), facade="concrete_plain", roof="gravel")
    b.door(house, "front", x=-1.6, kind="door_double")
    b.sign(house, "front", "note", x=1.8, z=1.4, height=0.9)
    b.bite_hint = (0.0, 0.0, 175.0)            # the kit's top bite only clips what the fold takes anyway

    # rubble: a long bent piece of lattice lying across the heap, the striped antenna beside it
    st = mark(b)
    lattice_strip(b, (-6.2, -5.6, 1.2), (-0.4, 0.4, 7.6), 3.0, 3, nrm=(0.4, -0.4, 1.0))
    lattice_strip(b, (-0.4, 0.4, 7.6), (6.0, 4.4, 2.0), 2.6, 3, col_a=WHITE, col_b=RED, nrm=(-0.3, 0.4, 1.0))
    tube(b, (-6.2, 6.0, 0.8), (1.0, 6.8, 3.2), 0.6, n=6, col=RED)
    keep = take(b, st)
    for f in keep.faces:
        f.tag = "rubble"
    b.keepsake = keep

    def damage(b, m):
        # a lattice has no rooms: no broken-open floors where the bites pass through it
        m.faces[:] = [f for f in m.faces if f.tag.split("|")[0] != "interior"]
        # the top third folded over: everything above 109 m bent down over the street side
        hinge = 109.0
        h = mast_hw(hinge)
        top = select(m, lambda f: max(p[2] for p in f.pts) > hinge)
        below, above = clip_split(top, hinge)
        remove_faces(m, top)
        m.faces.extend(below)
        st = mark(b)
        for sx in (-1, 1):                     # the torn members' ends on the folded part
            for sy in (-1, 1):
                face(b, [(sx * h - 0.55, sy * h - 0.55, hinge), (sx * h + 0.55, sy * h - 0.55, hinge),
                         (sx * h + 0.55, sy * h + 0.55, hinge), (sx * h - 0.55, sy * h + 0.55, hinge)], "#3a3330",
                     want=-UP)
        above.extend(take(b, st).faces)
        rotate_faces(above, (1.0, 0.0, 0.0), 148.0, (0.0, -h, hinge))
        rotate_faces(above, (0.0, 0.0, 1.0), 14.0, (0.0, -h, hinge))
        m.faces.extend(above)
        # the cut members' open ends at the fold: little dark caps
        st = mark(b)
        for sx in (-1, 1):
            for sy in (-1, 1):
                face(b, [(sx * h - 0.55, sy * h - 0.55, hinge), (sx * h + 0.55, sy * h - 0.55, hinge),
                         (sx * h + 0.55, sy * h + 0.55, hinge), (sx * h - 0.55, sy * h + 0.55, hinge)], "#3a3330", want=UP)
        m.faces.extend(take(b, st).faces)
    b.damage_hook = hooked(damage)


# ==== the family picture ======================================================================
FAMILY = (
    # front row, left to right as seen from the street, fronts on the far curb
    (("lm_signal_mast", 0.0), ("lm_founders_clock", 0.0), ("lm_sevenfold_temple", 0.0), ("lm_gasworks", 0.0)),
    # back row, behind a back street
    (("lm_grand_station", 0.0), ("lm_kiln_point_power", 0.0)),
)


def family_shot(out=None, size=(1600, 900), samples=16):
    """docs/art/concept/city_landmarks_b.png: all six at true relative scale on a short piece of
    street, by day, with cars, lamps, trees, the hatchling and soldiers for scale.
    Run with: tools/art/city_landmarks_b.py --family-shot"""
    import bpy
    import contract
    import mb
    from city import sheet

    mb.reset()

    def place(mid, x, y):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=contract.model_path(mid))
        new = [o for o in bpy.context.scene.objects if o not in before]
        keep = [o for o in new if o.parent is None and o.name.split(".")[0] == "intact"] or \
            [o for o in new if o.parent is None]
        if mid.startswith(("bld_", "lm_")):
            for o in new:
                if o not in keep:
                    bpy.data.objects.remove(o, do_unlink=True)
        for o in keep:
            o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
        return keep

    arch = contract.archetypes()
    curb, gap = 10.0, 12.0
    # the model's left is +x and the camera looks from -y: list rows right to left on +x
    y_row = curb
    for r, row in enumerate(FAMILY):
        widths = [arch[m.split("_", 1)[1]]["footprint"][0] for m, _ in row]
        depths = [arch[m.split("_", 1)[1]]["footprint"][1] for m, _ in row]
        total = sum(widths) + gap * (len(row) - 1)
        x = total / 2
        for (mid, dy), w, d in zip(row, widths, depths):
            place(mid, x - w / 2, y_row + d / 2 + dy)
            x -= w + gap
        y_row += max(depths) + 16.0
    front_depth = max(arch[m.split("_", 1)[1]]["footprint"][1] for m, _ in FAMILY[0])
    g = mb.Geo()

    def quad(x0, y0, x1, y1, z, col):
        g.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], color=col)

    L = 150.0
    quad(-L, -7.0, L, 7.0, 0.02, "#2b3040")
    quad(-L, -11.0, L, -7.0, 0.15, "#b9bcc6")
    quad(-L, 7.0, L, curb, 0.15, "#b9bcc6")
    quad(-L, curb, L, curb + front_depth + 4.0, 0.05, "#4fbf5f")
    quad(-L, curb + front_depth + 4.0, L, curb + front_depth + 14.0, 0.02, "#2b3040")
    for k in range(-int(L // 5), int(L // 5)):
        quad(k * 5.0, -0.12, k * 5.0 + 2.6, 0.12, 0.04, "#efe9d8")
    mb.node("street", g)
    for mid, x, y in (("prop_car_sedan", -60.0, -3.2), ("prop_car_taxi", 20.0, 3.4), ("prop_bus", 70.0, -3.4),
                      ("prop_car_van", -20.0, 3.4), ("prop_lamp", -100.0, 8.2), ("prop_lamp", -50.0, 8.2),
                      ("prop_lamp", 0.0, 8.2), ("prop_lamp", 50.0, 8.2), ("prop_lamp", 100.0, 8.2),
                      ("prop_tree_a", -120.0, -9.0), ("prop_tree_b", -70.0, -9.0), ("prop_tree_a", -5.0, -9.0),
                      ("prop_tree_b", 45.0, -9.0), ("prop_tree_a", 115.0, -9.0), ("prop_busstop", 82.0, -9.0)):
        path = contract.model_path(mid)
        if os.path.exists(path):
            place(mid, x, y)
    lizard = contract.model_path("kaiju_lizard_s1")
    if os.path.exists(lizard):
        for o in place("kaiju_lizard_s1", 30.0, -1.0):
            o.rotation_mode = "QUATERNION"
    mat = bpy.data.materials.new("mbsheet_olive")
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.08, 1.0)
    for x in (38.0, 39.4, 40.6):
        for o in sheet._soldier(x, -9.0):
            o.data.materials.append(mat)
    for o in bpy.context.scene.objects:
        o.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    out = out or os.path.join(contract.CONCEPT, "city_landmarks_b.png")
    return mb.concept("city_landmarks_b", out=out, backdrop="sky", azimuth=-22.0, elevation=12.0, fov=34.0, zoom=1.0,
                      size=size, samples=samples)


if __name__ == "__main__":
    if "--family-shot" in sys.argv:
        o = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
        print(family_shot(out=o))
        raise SystemExit(0)
    raise SystemExit(kit.run_family("city_landmarks_b"))
