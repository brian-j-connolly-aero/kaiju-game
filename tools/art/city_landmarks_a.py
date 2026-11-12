#!/opt/mbtools/venv/bin/python
# mb-family: city_landmarks_a
"""Port Meridian's landmarks, first half (docs/CITY.md section 3).

    lm_meridian_tower       glass shaft stepping in three times, gold bands, open steel lantern, spire
    lm_city_hall            limestone block, eight-column portico, colonnaded drum, ribbed copper dome
    lm_tidewater_cathedral  long dark nave, flying buttresses, front bell tower and spire, round window
    lm_anchor_field         the stadium: oval bowl, sea-blue band, west roof, four floodlight masts
    lm_tidewheel            the giant wheel on two A-frames, 24 candy-striped gondolas, a ring of lights
    lm_halcyon_observatory  white drum and silver dome with its shutter slot open, telescope, two small domes
    lm_farewell_light       red-and-white lighthouse on a stone base, black gallery, glass lamp room

Built from the city kit's parts (tools/art/city/README.md); the damaged, rubble and chunk states
come from the kit's one generator. Each landmark adds what docs/CITY.md names: a bite where the
damage belongs (b.bite_hint), a damage hook for the named damage (a bent spire, a caved dome,
snapped columns, a fallen mast, a tilted wheel, an egg-cracked dome, a leaning top) and the
keepsake that stays recognizable on the rubble.

Parts the kit does not have are the helpers below (tubes along any axis, flat discs and rings in
any plane, colored domes with a slot, pointed windows, rotating a set of faces); they use only
the shared atlas: its regions and the white swatch with vertex colors. No new atlas pictures.

    tools/art/city_landmarks_a.py [--only lm_city_hall] [--no-previews]
    tools/art/city_landmarks_a.py --family-shot     docs/art/concept/city_landmarks_a.png
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from city import kit, style  # noqa: E402
from city.geom import Face, Mesh, clip, hex_rgb, map_region, plain  # noqa: E402

UP = np.array([0.0, 0.0, 1.0])
# SHELL: the tag for curved and custom walls. The kit's damage drops a "detail" face under 8 m2
# whole when a bite touches it (right for trim, wrong for the panels of a round tower), and its
# rubble cuts slabs from "wall" faces, which fails on panels under 2 m wide (see the report);
# a face tagged "shell" is cut by the bites like a wall and is never used for a slab.
SHELL = "shell"

# palette (vertex colors on the atlas's white swatch, or multiplying a region)
LIMESTONE = "#ebe4d2"
GOLD = "#e3b23c"
FIN = "#f4f5f7"
STEEL = "#4a4e58"
STEEL_DK = "#2e323a"
SLATE_DK = "#3a4256"
CATH = "#868b96"          # dark grey cathedral stone (multiplies concrete_plain)
CATH_TRIM = "#a9adb5"
SEA = "#2f7fd6"
RED = "#d7263d"
WHITE = "#f5f2ea"
COPPER_IN = "#4f8f7a"
GRASS = "#4fbf5f"
GRASS_DK = "#44ab53"
SILVER = "#dde2ea"
BLACK = "#24272e"


# ==== helpers the kit does not have ==========================================================
def _v(p):
    return np.asarray(p, float)


def face(b, pts, col=None, *, region=None, want=None, tag="detail", unit=None, origin=None, tone=None):
    """One planar polygon, turned so its normal points along `want` (if given). Plain color on
    the white swatch, or mapped onto `region` (multiplied by `tone`)."""
    pts = [_v(p) for p in pts]
    if want is not None and Face(pts).normal @ _v(want) < 0:
        pts = pts[::-1]
    if region:
        out = map_region(pts, region, col=hex_rgb(tone) if tone else (1, 1, 1), tag=tag, unit=unit, origin=origin)
        b.intact += out
        return out
    f = plain(pts, col, tag=tag)
    b.intact += f
    return [f]


def frame_of(d):
    d = _v(d) / np.linalg.norm(d)
    a = np.cross(d, UP)
    if np.linalg.norm(a) < 1e-6:
        a = np.array([1.0, 0.0, 0.0])
    a /= np.linalg.norm(a)
    return d, a, np.cross(a, d)


def tube(b, p0, p1, r, n=6, col="#d8d2c4", *, r1=None, region=None, caps=True, tag="detail", solid=False,
         phase=None, tone=None):
    """An n-sided bar from p0 to p1 (radius r, tapering to r1): axles, legs, columns, telescope tubes."""
    p0, p1 = _v(p0), _v(p1)
    d, a, bb = frame_of(p1 - p0)
    r1 = r if r1 is None else r1
    ph = math.pi / n if phase is None else phase
    ring = [a * math.cos(ph + 2 * math.pi * k / n) + bb * math.sin(ph + 2 * math.pi * k / n) for k in range(n)]
    pts_all = []
    for k in range(n):
        q = [p0 + ring[k] * r, p0 + ring[(k + 1) % n] * r, p1 + ring[(k + 1) % n] * r1, p1 + ring[k] * r1]
        face(b, q, col, region=region, want=ring[k] + ring[(k + 1) % n], tag=tag, tone=tone)
        pts_all += q
    if caps:
        face(b, [p1 + rr * r1 for rr in ring], col, want=d, tag=tag)
        face(b, [p0 + rr * r for rr in ring], col, want=-d, tag=tag)
    if solid:
        b.solids.append(np.array(pts_all, float))


def disc(b, center, normal, r, n=12, col="#ffffff", *, region=None, phase=0.0, tag="detail", two_sided=False):
    """A flat n-gon facing `normal` (rose windows, clock faces, pitch circles)."""
    c = _v(center)
    nrm, a, bb = frame_of(normal)
    pts = [c + (a * math.cos(phase + 2 * math.pi * k / n) + bb * math.sin(phase + 2 * math.pi * k / n)) * r
           for k in range(n)]
    face(b, pts, col, region=region, want=nrm, tag=tag)
    if two_sided:
        face(b, pts, col, region=region, want=-nrm, tag=tag)


def annulus(b, center, normal, r0, r1, n=12, col="#ffffff", *, phase=0.0, tag="detail", two_sided=False,
            depth=0.0):
    """A flat ring (window frames, rims) facing `normal`; with depth, its inner and outer edges too."""
    c = _v(center)
    nrm, a, bb = frame_of(normal)
    dirs = [a * math.cos(phase + 2 * math.pi * k / n) + bb * math.sin(phase + 2 * math.pi * k / n) for k in range(n)]
    for k in range(n):
        u, w = dirs[k], dirs[(k + 1) % n]
        q = [c + u * r0, c + w * r0, c + w * r1, c + u * r1]
        face(b, q, col, want=nrm, tag=tag)
        if two_sided:
            face(b, [p - nrm * depth for p in q], col, want=-nrm, tag=tag)
        if depth > 0:
            face(b, [c + u * r1, c + w * r1, c + w * r1 - nrm * depth, c + u * r1 - nrm * depth], col,
                 want=u + w, tag=tag)
            face(b, [c + u * r0, c + w * r0, c + w * r0 - nrm * depth, c + u * r0 - nrm * depth], col,
                 want=-(u + w), tag=tag)


def lancet(b, center_bottom, normal, w, h, col=None, *, region="lit_glass", tag="detail"):
    """A tall pointed window (a pentagon) on a wall facing `normal`."""
    c = _v(center_bottom)
    nrm, a, _bb = frame_of(normal)
    pk = min(w * 0.9, h * 0.3)
    pts = [c - a * w / 2, c + a * w / 2, c + a * w / 2 + UP * (h - pk), c + UP * h, c - a * w / 2 + UP * (h - pk)]
    pts = [p + nrm * 0.05 for p in pts]
    face(b, pts, col, region=region if col is None else None, want=nrm, tag=tag)


def ring_dome(b, center, r, z0, h, n=12, rings=3, *, col=None, region=None, slot=None, slot_col=None,
              tag="roof", solid=True, inner_col=None, keep=None):
    """A faceted dome. `slot` = segment index painted `slot_col` (the observatory's shutter);
    `keep(j, k)` can leave out facets (a cracked shell); `inner_col` adds the inside."""
    cx, cy = center
    prof = [(r * math.cos(math.pi / 2 * j / rings), z0 + h * math.sin(math.pi / 2 * j / rings)) for j in range(rings + 1)]
    pts_all = []
    for j in range(rings):
        (r0, za), (r1, zb) = prof[j], prof[j + 1]
        for k in range(n):
            if keep is not None and not keep(j, k):
                continue
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            p = [(cx + r0 * math.cos(a0), cy + r0 * math.sin(a0), za), (cx + r0 * math.cos(a1), cy + r0 * math.sin(a1), za),
                 (cx + r1 * math.cos(a1), cy + r1 * math.sin(a1), zb), (cx + r1 * math.cos(a0), cy + r1 * math.sin(a0), zb)]
            if r1 < 1e-6:
                p = p[:3]
            out = _v([cx + math.cos((a0 + a1) / 2), cy + math.sin((a0 + a1) / 2), 0]) - _v([cx, cy, 0])
            out = out + UP * 0.5
            if slot is not None and k in (slot if isinstance(slot, (list, tuple, set)) else (slot,)):
                face(b, p, slot_col, want=out, tag=tag)
            elif region:
                face(b, p, None, region=region, want=out, tag=tag, tone=col)
            else:
                face(b, p, col, want=out, tag=tag)
            if inner_col:
                nf = Face([_v(q) for q in p]).normal
                nf = nf if nf @ out > 0 else -nf
                face(b, [_v(q) - nf * 0.03 for q in p], inner_col, want=-out, tag=SHELL)
            pts_all += p
    if solid and pts_all:
        b.solids.append(np.array(pts_all + [(cx, cy, z0)], float))


def mark(b) -> int:
    return len(b.intact.faces)


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


def remove_faces(mesh, faces):
    ids = {id(f) for f in faces}
    mesh.faces[:] = [f for f in mesh.faces if id(f) not in ids]


def select(mesh, pred):
    return [f for f in mesh.faces if pred(f)]


def drop_unpaired_rails(m):
    """Damage hook helper: a two-sided railing panel whose other side the bite took goes too
    (its lone back face would show from outside)."""
    rails = [f for f in m.faces if f.region and f.region.startswith("rail_")]
    lone = [f for f in rails if not any(g is not f and float(g.normal @ f.normal) < -0.95
                                        and np.linalg.norm(g.center - f.center) < 0.6 for g in rails)]
    remove_faces(m, lone)


def reline_roofs(b, m):
    """Damage hook helper (the same idea as city_blocks.py): the kit drops a pitched roof's whole
    underside when a bite opens the slope, so the slope's back would show through the gap.
    Give what is left of such a slope a lowered, reversed lining."""
    def key(f):
        return tuple(np.round(f.center, 2))
    have = {key(g) for g in m.faces if g.tag == "underside"}
    lost = [-f.normal for f in b.intact.faces if f.tag == "underside" and abs(f.normal[2]) < 0.99
            and key(f) not in have]
    if not lost:
        return
    add = []
    for f in m.faces:
        if f.tag == "roof" and any(float(f.normal @ n) > 0.999 for n in lost):
            add.append(plain([p - UP * 0.22 for p in reversed(f.pts)], "#8a8478", tag="interior"))
    m.faces.extend(add)


def banded(b, w, d, h, at, *, band=0.8, band_region="cornice", roof="gravel", sides=None, **kw):
    """A flat-roofed block finished by a cornice band, the roof on top of the band (the same
    idea as city_blocks.py): it reads as a parapet, but has no thin inner walls, whose backs the
    kit's damage would show wherever a bite eats them. Returns the Block (z1 = roof surface)."""
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


def paint_region(b, region, color):
    c = hex_rgb(color)
    for f in b.intact.faces:
        if f.region == region:
            f.col = c


def box_solid(b, lo, hi):
    b.solids.append(np.array([(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])], float))


def clip_faces_above(mesh, faces, z):
    """Cut `faces` at height z and drop what is above (snapped columns, broken stumps)."""
    keep = []
    for f in faces:
        g = clip(f, np.array([0, 0, 1.0]), z, keep_below=True)
        if g is not None:
            keep.append(g)
    remove_faces(mesh, faces)
    mesh.faces.extend(keep)


# ==== Meridian Tower ==========================================================================
def _mt_lantern(b, z0, z1, s):
    """The open steel lantern: four corner posts, two rings, crossed braces, a glowing core."""
    h = s / 2
    zm = (z0 + z1) / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.beam((sx * h, sy * h, z0), (sx * h * 0.8, sy * h * 0.8, z1), 0.9, color=STEEL)
    corners = [(-h, -h), (h, -h), (h, h), (-h, h)]
    for k in range(4):
        (ax, ay), (bx, by) = corners[k], corners[(k + 1) % 4]
        b.beam((ax * 0.8, ay * 0.8, z1), (bx * 0.8, by * 0.8, z1), 0.6, color=STEEL)
        b.beam((ax * 0.9, ay * 0.9, zm), (bx * 0.9, by * 0.9, zm), 0.5, color=GOLD)
        b.beam((ax, ay, z0 + 0.3), (bx * 0.9, by * 0.9, zm), 0.35, color=STEEL)
        b.beam((bx, by, z0 + 0.3), (ax * 0.9, ay * 0.9, zm), 0.35, color=STEEL)
    b.box((-1.2, -1.2, z0), (1.2, 1.2, z1 - 1.6), region="lamp")          # the light inside
    b.box((-h * 0.8, -h * 0.8, z1), (h * 0.8, h * 0.8, z1 + 0.6), color=GOLD, top="dark")


@kit.building("meridian_tower", district="downtown", tone="stone", seed=11)
def meridian_tower(b):
    # Stone podium (two storeys) with a deep entrance canopy on the street side, then a teal
    # glass shaft stepping in at 80, 140 and 190 m, each step a gold band; white fins at the
    # corners; a metal crown, an open steel lantern with a light in it, and a slim spire.
    pod = banded(b, 36.0, 32.0, 9.0, (0.0, 2.0, 0.0), band=0.6, facade="stone_grid", ground="plinth")
    b.door(pod, "front", x=0.0, kind="door_double")
    for x in (-6.0, 6.0):
        b.decal(pod, "front", x, 0.0, 2.25, 2.625, "door_double")
    b.box((-10.0, -18.0, 5.2), (10.0, pod.y0, 5.9), color=SLATE_DK, top="white", bottom=True)    # canopy
    b.intact.faces[-2].col = hex_rgb("#c9c4b8")
    b.box((-10.0, -18.0, 5.9), (10.0, -17.7, 6.4), color=GOLD, top=None)                          # its gold edge
    for x in (-9.4, 9.4):
        b.box((x - 0.3, -17.7, 0.0), (x + 0.3, -17.1, 5.2), color=LIMESTONE, top=None)
    tiers = [(28.0, 9.6, 80.0), (22.0, 81.2, 140.0), (16.0, 141.2, 190.0)]
    for i, (s, z0, z1) in enumerate(tiers):
        b.block(s, s, z1 - z0, at=(0.0, 0.0, z0), facade="glass_teal", roof="tar")
        h = s / 2
        for sx in (-1, 1):
            for sy in (-1, 1):
                # the white corner fins run past each setback and end in a spike: from far away
                # every step of the tower carries a crown of four points
                b.box((sx * h - 0.8, sy * h - 0.8, z0), (sx * h + 0.8, sy * h + 0.8, z1 + 5.0), color=FIN, top=None)
                b.cone((sx * h, sy * h), 1.13, z1 + 5.0, z1 + 9.5, n=4, color=FIN, phase=math.pi / 4)
        g = s / 2 + 0.6
        b.box((-g, -g, z1), (g, g, z1 + 1.2), color=GOLD, top="tar")                           # gold band
    b.block(12.0, 12.0, 6.6, at=(0.0, 0.0, 191.2), facade="metal_clad", roof="tar")
    lan = mark(b)
    _mt_lantern(b, 197.8, 209.0, 10.0)
    lantern = since(b, lan)
    b.solids.append(np.array([(x, y, z) for x in (-5, 5) for y in (-5, 5) for z in (197.8, 209.6)], float))
    sp = mark(b)
    tube(b, (0, 0, 209.6), (0, 0, 219.4), 1.5, n=4, r1=0.12, col=FIN, caps=False)
    b.box((-0.28, -0.28, 219.4), (0.28, 0.28, 220.0), region="beacon")
    _ = sp
    b.bite_hint = (11.0, -11.0, 140.0)

    # rubble: the lantern lying on its side on the heap
    k = lantern.copy()
    k.rotx(84.0, about=(0.0, 0.0, 204.0))
    k.rotz(28.0, about=(0.0, 0.0, 204.0))
    k.move(3.0, 2.0, -204.0 + 9.2)
    b.keepsake = k

    def hook(b, m):
        # the spire bent over, lantern posts left standing
        spire = select(m, lambda f: f.center[2] > 209.3 and abs(f.center[0]) < 1.6 and abs(f.center[1]) < 1.6)
        kink = 212.8
        upper = []
        for f in spire:
            g = clip(f, UP, kink, keep_below=False)
            if g is not None:
                upper.append(g)
        clip_faces_above(m, spire, kink)
        rotate_faces(upper, (0.3, 1.0, 0.0), 78.0, (0.0, 0.0, kink))
        m.faces.extend(upper)
    b.damage_hook = hook


# ==== City Hall ==============================================================================
@kit.building("city_hall", district="downtown", tone="stone", seed=21)
def city_hall(b):
    # Three-storey limestone block with two short wings, a broad flight of steps up to an
    # eight-column portico under a pediment; on the roof a drum ringed by small columns and a
    # tall ribbed copper dome, a lantern and a flagpole.
    body = banded(b, 34.0, 30.0, 11.5, (0.0, 4.6, 0.0), band=1.0, facade="stone_grid", ground="plinth", ground_h=5.5)
    for sx in (-1, 1):
        wing = banded(b, 8.0, 22.0, 8.0, (sx * 21.0, 5.0, 0.0), band=0.8, facade="stone_grid", ground="plinth",
                      sides={("right" if sx > 0 else "left"): None})
        b.door(wing, "front", x=0.0, kind="door_double")
    # steps: four broad treads from the plaza up to the portico floor
    for i in range(4):
        y0 = -20.0 + i * 1.1
        b.box((-13.0 + i * 0.3, y0, 0.0), (13.0 - i * 0.3, body.y0, 0.6 * (i + 1)), color=LIMESTONE, top="white")
        b.intact.faces[-1].col = hex_rgb("#f2ede0")
    box_solid(b, (-13.0, -20.0, 0.0), (13.0, body.y0, 2.4))
    # portico: eight columns, entablature, pediment
    zf, zc = 2.4, 11.5
    cols_x = [-10.5 + 3.0 * i for i in range(8)]
    for x in cols_x:
        tube(b, (x, -14.6, zf), (x, -14.6, zc), 0.62, n=6, col="#f4efe2", caps=False)
    ent = b.block(25.0, 5.6, 1.6, at=(0.0, body.y0 - 2.6, zc), facade="cornice", roof=False)
    ped = kit.Block(ent.x0, ent.x1, ent.y0, ent.y1 + 3.0, zc, zc + 1.6, "plaster_plain", False, (1, 1, 1))
    b.gable(ped, rise=4.2, along="y", roof="tile_slate", end_region="plaster_plain", window=False)
    face(b, [(ent.x0, ent.y0, zc), (ent.x1, ent.y0, zc), (ent.x1, ent.y1, zc), (ent.x0, ent.y1, zc)], "#d9d2c2",
         want=-UP)                                               # the portico's ceiling
    b.decal(body, "front", 0.0, 0.0, 2.25, 2.625, "door_double")
    for x in (-6.0, 6.0):
        b.decal(body, "front", x, 0.0, 2.25, 2.625, "door_double")
    # drum, colonnade, dome, lantern, flag
    cx, cy = 0.0, 6.5
    zt = body.top
    b.prism((cx, cy), 9.6, zt, zt + 1.0, n=12, color="#ded7c6", top="white", top_color="#cfc8b6", solid=True)
    b.prism((cx, cy), 7.6, zt + 1.0, zt + 7.8, n=12, region="stone_grid", top=None, solid=True)
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        x, y = cx + 8.8 * math.cos(a), cy + 8.8 * math.sin(a)
        tube(b, (x, y, zt + 1.0), (x, y, zt + 7.0), 0.38, n=4, col="#f4efe2")
    b.prism((cx, cy), 9.3, zt + 7.0, zt + 8.4, n=12, region="cornice", top="white", top_color="#d8d1c0", solid=True)
    disc(b, (cx, cy, zt + 7.0), (0, 0, -1), 9.3, n=12, col="#cfc8b6", phase=math.pi / 12)
    zd = zt + 8.4
    ring_dome(b, (cx, cy), 8.4, zd, 11.0, n=12, rings=3, region="copper", inner_col=COPPER_IN)
    for k in range(12):                                    # ribs
        a = 2 * math.pi * k / 12
        prev = None
        for j in range(4):
            t = math.pi / 2 * j / 3
            rr, zz = 8.5 * math.cos(t), zd + 11.1 * math.sin(t)
            p = (cx + rr * math.cos(a), cy + rr * math.sin(a), zz)
            if prev is not None and j < 3:
                b.beam(prev, p, 0.32, color="#5fa08a")
            prev = p
    zl = zd + 10.6
    b.prism((cx, cy), 1.9, zl, zl + 3.4, n=8, color="#f4efe2", top="white", top_color="#5fa08a")
    rl = 1.9 * math.cos(math.pi / 8) + 0.04
    for k in range(8):
        a = 2 * math.pi * k / 8
        face(b, [(cx + rl * math.cos(a) - 0.4 * math.sin(a), cy + rl * math.sin(a) + 0.4 * math.cos(a), zl + 0.9),
                 (cx + rl * math.cos(a) + 0.4 * math.sin(a), cy + rl * math.sin(a) - 0.4 * math.cos(a), zl + 0.9),
                 (cx + rl * math.cos(a) + 0.4 * math.sin(a), cy + rl * math.sin(a) - 0.4 * math.cos(a), zl + 2.7),
                 (cx + rl * math.cos(a) - 0.4 * math.sin(a), cy + rl * math.sin(a) + 0.4 * math.cos(a), zl + 2.7)],
             None, region="lit_glass", want=(math.cos(a), math.sin(a), 0))
    b.cone((cx, cy), 2.3, zl + 3.4, zl + 5.6, n=8, region="copper")
    disc(b, (cx, cy, zl + 3.4), -UP, 2.3, n=8, col="#5fa08a", phase=math.pi / 8)
    tube(b, (cx, cy, zl + 5.6), (cx, cy, 44.75), 0.12, n=4, col="#d8dbe0", caps=False)
    b.box((cx - 0.2, cy - 0.2, 44.75), (cx + 0.2, cy + 0.2, 45.0), color=GOLD)
    for side in (1, -1):                                   # the city's flag: sea blue with a gold stripe
        y = cy + 0.03 * side
        face(b, [(cx, y, 41.6), (cx + 3.6, y, 41.6), (cx + 3.6, y, 44.2), (cx, y, 44.2)], SEA, want=(0, side, 0))
        face(b, [(cx, y + 0.01 * side, 42.5), (cx + 3.6, y + 0.01 * side, 42.5), (cx + 3.6, y + 0.01 * side, 43.2),
                 (cx, y + 0.01 * side, 43.2)], GOLD, want=(0, side, 0))
    b.solids.append(np.array([(cx + dx, cy + dy, z) for dx in (-1.9, 3.6) for dy in (-1.9, 1.9)
                              for z in (zl, 45.0)], float))       # lantern, pole and flag: one falling chunk
    b.bite_hint = (25.0, 20.0, 8.0)          # a back corner of the left wing; the dome caves in the hook

    # rubble: the green dome shell, cracked, on the heap
    sh = mark(b)
    ring_dome(b, (0.0, 0.0), 8.4, 0.0, 11.0, n=12, rings=3, region="copper", inner_col=COPPER_IN, solid=False,
              keep=lambda j, k: k not in (4, 5) and not (j == 2 and k in (3, 6, 7)))
    shell = since(b, sh)
    del b.intact.faces[sh:]
    shell.rotx(-16.0).rotz(150.0)
    for f in shell.faces:
        f.pts = [np.array([p[0] * 0.85, p[1] * 0.85, p[2] * 0.85]) for p in f.pts]
    shell.move(-3.0, 3.0, 2.6)
    b.keepsake = shell

    def hook(b, m):
        # two portico columns snapped, their tops lying on the steps
        snapped = (cols_x[1], cols_x[5], cols_x[6])
        for i, x in enumerate(snapped):
            fs = select(m, lambda f, x=x: abs(f.center[0] - x) < 0.7 and abs(f.center[1] + 14.6) < 0.7
                        and zf < f.center[2] < zc)
            zcut = zf + 2.2 + 1.3 * i
            clip_faces_above(m, fs, zcut)
            st = mark(b)
            disc(b, (x, -14.6, zcut), UP, 0.62, n=6, col="#cfc8b6", phase=math.pi / 6)
            m.faces.extend(b.intact.faces[st:])
            del b.intact.faces[st:]
        for i, x in enumerate(snapped[:2]):
            st = mark(b)
            tube(b, (x - 2.6, -17.0 - i * 0.8, 1.6 + 0.6), (x + 2.4, -16.0 - i * 0.6, 2.3 + 0.6), 0.6, n=6,
                 col="#d9d3c4")
            m.faces.extend(b.intact.faces[st:])
            del b.intact.faces[st:]
        # the dome caves in on its street side: the shell over that sector falls inward, its top
        # gone, the ribs there broken off; the dark lining shows through
        def sector(f):
            ang = math.degrees(math.atan2(f.center[1] - cy, f.center[0] - cx))
            return -115.0 < ang < -5.0
        shell_ = select(m, lambda f: zd + 0.3 < f.center[2] < zd + 11.5 and math.hypot(f.center[0] - cx, f.center[1] - cy) < 8.9
                        and sector(f))
        top_ = [f for f in shell_ if f.center[2] > zd + 8.0 or (f.region not in ("copper", "copper_dmg") and f.tag != SHELL)]
        remove_faces(m, top_)
        rest = [f for f in shell_ if not any(f is g for g in top_)]
        for f in rest:
            ang = math.atan2(f.center[1] - cy, f.center[0] - cx)
            hinge = (cx + 8.4 * math.cos(ang), cy + 8.4 * math.sin(ang), zd)
            tilt = 38.0 if f.center[2] > zd + 4.0 else 16.0
            rotate_faces([f], (math.sin(ang), -math.cos(ang), 0.0), tilt, hinge)
        # the lantern's copper roof is blown off with the caved side of the dome; the flagpole,
        # bent, still stands on the lantern (the silhouette keeps its height)
        remove_faces(m, select(m, lambda f: math.hypot(f.center[0] - cx, f.center[1] - cy) < 4.5 and (
            (f.center[2] > zl + 3.45 and f.region in ("copper", "copper_dmg"))
            or (abs(f.center[2] - zl - 3.4) < 0.05 and f.normal[2] < -0.9))))
        pole = select(m, lambda f: f.center[2] > zl + 3.6 and math.hypot(f.center[0] - cx, f.center[1] - cy) < 4.5)
        rotate_faces(pole, (0.0, 1.0, 0.0), -14.0, (cx, cy, zl + 3.4))
    b.damage_hook = hook


# ==== Tidewater Cathedral =====================================================================
@kit.building("tidewater_cathedral", district="oldtown", tone="sand", seed=31)
def tidewater_cathedral(b):
    # Long dark-grey nave with a steep slate roof, lower aisles, seven flying buttresses a side,
    # tall blue pointed windows; at the front (north) a square bell tower with a round window
    # over the door, belfry openings, corner pinnacles and a pointed spire with a plain finial.
    NV = 8.0                       # half width of the nave
    AI = 12.8                      # outer wall of the aisles
    y_back = 36.0
    nave = b.block(2 * NV, y_back + 27.0, 20.0, at=(0.0, (y_back - 27.0) / 2, 0.0), facade="concrete_plain",
                   roof=False, sides={"left": None, "right": None})
    for side in ("left", "right"):                 # clerestory walls above the aisle roofs
        a, c, _n = nave.side(side)
        b.wall(a, c, 10.5, 20.0, "concrete_plain")
    b.gable(nave, rise=14.0, along="y", roof="tile_slate", end_region="concrete_plain", window=False)
    for sx, high in ((1, "right"), (-1, "left")):
        ai = b.block(AI - NV, 60.0, 10.0, at=(sx * (NV + AI) / 2, 3.0, 0.0), facade="concrete_plain", roof=False,
                     sides={("right" if sx > 0 else "left"): None})
        b.shed(ai, 2.2, high=high, roof="tile_slate", end_region="concrete_plain")
    # windows, buttresses
    ys = [-17.0 + 7.5 * i for i in range(7)]
    for sx in (1, -1):
        for i, y in enumerate(ys):
            lancet(b, (sx * AI, y + 3.75, 2.0), (sx, 0, 0), 1.7, 6.2)
            lancet(b, (sx * NV, y + 3.75, 13.2), (sx, 0, 0), 1.5, 5.6)
            px = sx * 19.3
            b.box((px - 0.7, y - 0.8, 0.0), (px + 0.7, y + 0.8, 12.5), region="concrete_plain", top="white",
                  solid=True)
            b.cone((px, y), 0.95, 12.5, 15.2, n=4, region="tile_slate", phase=math.pi / 4)
            b.beam((px - sx * 0.6, y, 11.6), (sx * (NV + 0.2), y, 18.6), 0.6, color=CATH_TRIM)
            b.beam((px - sx * 0.6, y, 8.0), (sx * (AI + 0.1), y, 9.6), 0.6, color=CATH_TRIM)
    for x in (-4.0, 4.0):                           # back gable: two tall windows
        lancet(b, (x, y_back, 4.0), (0, 1, 0), 2.0, 9.0)
    # bell tower at the front
    T = 6.2
    ty = -36.0 + T
    tower = b.block(2 * T, 2 * T, 40.0, at=(0.0, ty, 0.0), facade="concrete_plain", roof="tile_slate", parapet=1.2,
                    parapet_region="concrete_plain")
    _ = tower
    b.box((-T - 0.3, ty - T - 0.3, 26.0), (T + 0.3, ty + T + 0.3, 26.8), color=CATH_TRIM, top="white")   # string course
    for name, nrm, fixed in (("front", (0, -1, 0), ty - T), ("back", (0, 1, 0), ty + T), ("left", (1, 0, 0), T),
                             ("right", (-1, 0, 0), -T)):
        for off in (-2.2, 2.2):
            if name in ("front", "back"):
                c = (off, fixed, 29.0)
            else:
                c = (fixed, ty + off, 29.0)
            lancet(b, c, nrm, 2.4, 8.4, col="#1d1f26")
    # the door and the round window over it
    lancet(b, (0.0, ty - T, 0.0), (0, -1, 0), 3.4, 6.4, col="#3b2a22")
    rw_c = (0.0, ty - T - 0.06, 14.2)
    rw = mark(b)
    disc(b, rw_c, (0, -1, 0), 3.6, n=16, region="lit_glass")
    annulus(b, (0.0, ty - T - 0.12, 14.2), (0, -1, 0), 3.4, 4.3, n=16, col=CATH_TRIM)
    for k in range(6):
        a = math.pi * k / 6
        d = np.array([math.cos(a), 0.0, math.sin(a)])
        nn = np.array([-math.sin(a), 0.0, math.cos(a)]) * 0.18
        c0 = _v(rw_c) + np.array([0, -0.1, 0])
        face(b, [c0 - d * 3.5 - nn, c0 + d * 3.5 - nn, c0 + d * 3.5 + nn, c0 - d * 3.5 + nn], CATH_TRIM, want=(0, -1, 0))
    disc(b, (0.0, ty - T - 0.14, 14.2), (0, -1, 0), 0.9, n=8, col=CATH_TRIM)
    _ = rw
    # pinnacles, spire, finial
    zt = 40.0 + 1.2
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cone((sx * (T - 0.7), ty + sy * (T - 0.7)), 0.8, zt, zt + 4.2, n=4, region="tile_slate", phase=math.pi / 4)
    b.prism((0.0, ty), 4.3, zt - 1.2, zt + 0.6, n=8, region="concrete_plain", top=None)
    b.cone((0.0, ty), 4.3, zt + 0.6, 57.4, n=8, region="tile_slate", phase=math.pi / 8)
    b.solids.append(np.array([(4.3 * math.cos(2 * math.pi * k / 8), ty + 4.3 * math.sin(2 * math.pi * k / 8), zt)
                              for k in range(8)] + [(0, ty, 57.4)], float))
    b.box((-0.3, ty - 0.3, 57.3), (0.3, ty + 0.3, 58.0), color=GOLD)
    paint_region(b, "concrete_plain", CATH)
    b.bite_hint = (20.0, 6.0, 20.0)

    # rubble: the round window's frame standing upright on a stone plinth
    st = mark(b)
    b.box((-2.4, -1.0, 0.0), (2.4, 1.0, 1.4), region="concrete_plain", top="rubble")
    annulus(b, (0.0, 0.0, 5.6), (0, -1, 0), 3.4, 4.3, n=16, col=CATH_TRIM, two_sided=True, depth=0.6)
    for k in range(3):
        a = math.pi * k / 3 + 0.3
        tube(b, (-3.4 * math.cos(a), 0.0, 5.6 - 3.4 * math.sin(a)), (3.4 * math.cos(a), 0.0, 5.6 + 3.4 * math.sin(a)),
             0.2, n=4, col=CATH_TRIM, caps=False)
    disc(b, (0.0, -0.32, 5.6), (0, -1, 0), 0.9, n=8, col=CATH_TRIM)
    disc(b, (0.0, 0.32, 5.6), (0, 1, 0), 0.9, n=8, col=CATH_TRIM)
    for f in b.intact.faces[st:]:
        if f.region == "concrete_plain":
            f.col = hex_rgb(CATH)
    keep = since(b, st)
    del b.intact.faces[st:]
    for f in keep.faces:
        f.pts = [p * 1.55 for p in f.pts]
    keep.rotz(-20.0).move(2.0, -10.0, 3.6)
    b.keepsake = keep

    def hook(b, m):
        # the spire snapped above its base, the broken top hanging over the tower's side
        zs = 47.0
        rs = 4.3 * (57.4 - zs) / (57.4 - (zt + 0.6))
        sp = select(m, lambda f: f.center[2] > zt + 0.6 and abs(f.center[0]) < 4.6 and abs(f.center[1] - ty) < 4.6
                    and f.region in ("tile_slate", "tile_slate_dmg"))
        fin = select(m, lambda f: f.center[2] > 57.0)
        upper = [g for g in (clip(f, UP, zs, keep_below=False) for f in sp) if g is not None] + fin
        remove_faces(m, fin)
        clip_faces_above(m, sp, zs)
        st = mark(b)
        disc(b, (0.0, ty, zs), UP, rs, n=8, region="rubble", phase=math.pi / 8)
        stump = b.intact.faces[st:]
        disc(b, (0.0, ty, zs), -UP, rs, n=8, region="rubble", phase=math.pi / 8)
        upper += b.intact.faces[st + len(stump):]
        del b.intact.faces[st:]
        m.faces.extend(stump)
        rotate_faces(upper, (0.0, 1.0, 0.0), 58.0, (rs, ty, zs))
        for f in upper:
            f.pts = [p + np.array([0.6, 0.0, -2.2]) for p in f.pts]
        m.faces.extend(upper)
        # buttresses broken off on the left side: the flyers of three bays gone
        gone = select(m, lambda f: f.center[0] > NV + 0.5 and f.center[2] > 8.5 and f.region in (None, "white")
                      and -10.0 < f.center[1] < 14.0 and f.center[0] < 18.6)
        remove_faces(m, gone)
        reline_roofs(b, m)
    b.damage_hook = hook


# ==== Anchor Field ===========================================================================
def _ell(a, bb, t, z):
    return np.array([a * math.cos(t), bb * math.sin(t), z])


@kit.building("anchor_field", district="boardwalk", tone="white", seed=41)
def anchor_field(b):
    # An oval bowl: the outer wall in concrete with ribbon windows and a sea-blue band, white
    # upper tier and sea-blue lower tier, a walkway between, a striped green pitch with white
    # lines; a cantilevered roof over the west stand (+x, the building's own left when it faces
    # north) and four floodlight masts standing in the corners.
    A0, B0 = 75.0, 60.0        # outer wall
    A1, B1 = 73.4, 58.4        # rim
    A2, B2 = 65.0, 50.5        # walkway
    A3, B3 = 57.0, 43.0        # pitch wall
    Hs = 17.0
    n = 24
    for k in range(n):
        t0, t1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        o0, o1 = _ell(A0, B0, t0, 0), _ell(A0, B0, t1, 0)
        out = (o0 + o1) / 2
        out[2] = 0
        # outer wall: ribbon windows, sea-blue band, white top
        b.wall(o0[:2], o1[:2], 0.0, 12.0, "strip_concrete")
        face(b, [o0 + UP * 12.0, o1 + UP * 12.0, o1 + UP * 15.0, o0 + UP * 15.0], SEA, want=out, tag="wall")
        face(b, [o0 + UP * 15.0, o1 + UP * 15.0, o1 + UP * Hs, o0 + UP * Hs], WHITE, want=out, tag="wall")
        r0, r1 = _ell(A1, B1, t0, Hs), _ell(A1, B1, t1, Hs)
        face(b, [o0 + UP * Hs, o1 + UP * Hs, r1, r0], "#e9e6dd", want=UP, tag="roof")
        w0, w1 = _ell(A2, B2, t0, 8.6), _ell(A2, B2, t1, 8.6)
        face(b, [r0, r1, w1, w0], "#f1f1ee" if k % 2 else "#e4e6ea", want=UP, tag="roof")       # upper tier
        v0, v1 = _ell(A2 - 0.8, B2 - 0.8, t0, 8.6), _ell(A2 - 0.8, B2 - 0.8, t1, 8.6)
        face(b, [w0, w1, v1, v0], "#c9c6be", want=UP, tag="roof")                               # walkway
        u0, u1 = v0 - UP * 1.3, v1 - UP * 1.3
        face(b, [v0, v1, u1, u0], SEA, want=-out, tag="detail")                                   # balcony front
        p0, p1 = _ell(A3, B3, t0, 1.2), _ell(A3, B3, t1, 1.2)
        face(b, [u0, u1, p1, p0], SEA if k % 2 else "#2a73c2", want=UP, tag="roof")              # lower tier
        face(b, [p0, p1, p1 - UP * 1.2, p0 - UP * 1.2], WHITE, want=-out, tag="detail")         # pitch wall
        b.solids.append(np.array([o0, o1, o0 + UP * Hs, o1 + UP * Hs, p0 - UP * 1.2, p1 - UP * 1.2, p0, p1], float))
    # the pitch: grass oval, mown stripes, white lines
    face(b, [_ell(A3, B3, 2 * math.pi * k / n, 0.05) for k in range(n)], GRASS_DK, want=UP, tag="roof")
    L, Wp = 84.0, 54.0
    for i in range(8):
        x0 = -L / 2 + i * L / 8
        face(b, [(x0, -Wp / 2, 0.1), (x0 + L / 8, -Wp / 2, 0.1), (x0 + L / 8, Wp / 2, 0.1), (x0, Wp / 2, 0.1)],
             GRASS if i % 2 else "#58c968", want=UP, tag="roof")
    lw = 0.45

    def line(x0, y0, x1, y1):
        face(b, [(x0, y0, 0.15), (x1, y0, 0.15), (x1, y1, 0.15), (x0, y1, 0.15)], "#f6f6f2", want=UP)
    line(-L / 2, -Wp / 2, L / 2, -Wp / 2 + lw)
    line(-L / 2, Wp / 2 - lw, L / 2, Wp / 2)
    line(-L / 2, -Wp / 2, -L / 2 + lw, Wp / 2)
    line(L / 2 - lw, -Wp / 2, L / 2, Wp / 2)
    line(-lw / 2, -Wp / 2, lw / 2, Wp / 2)
    for s in (-1, 1):
        xg = s * L / 2
        line(min(xg, xg - s * 14), -16.0, max(xg, xg - s * 14), -16.0 + lw)
        line(min(xg, xg - s * 14), 16.0 - lw, max(xg, xg - s * 14), 16.0)
        xb = xg - s * 14
        line(xb - lw / 2, -16.0, xb + lw / 2, 16.0)
        b.box((xg + s * 0.0 - 0.2, -3.6, 0.0), (xg + 0.2, 3.6, 2.4), color="#ffffff", top="white")   # goal
    annulus(b, (0.0, 0.0, 0.15), (0, 0, 1), 8.6, 9.1, n=16, col="#f6f6f2")
    # the west roof: a white canopy over the whole west stand on raking steel arms
    ks = range(-3, 3)
    for k in ks:
        t0, t1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        q = [_ell(A0, B0, t0, 25.5), _ell(A0, B0, t1, 25.5), _ell(A3 + 1.0, B3 + 1.0, t1, 22.5),
             _ell(A3 + 1.0, B3 + 1.0, t0, 22.5)]
        face(b, q, "#f7f7f4", want=UP, tag="roof")
        face(b, [p - UP * 0.35 for p in q], "#9aa3ad", want=-UP, tag="underside")
        inward = -(q[0] + q[1]) / 2 * np.array([1, 1, 0])
        fq = [q[3], q[2], q[2] - UP * 1.2, q[3] - UP * 1.2]
        face(b, fq, SEA, want=inward)
        face(b, [p - inward / np.linalg.norm(inward) * 0.04 for p in fq], SEA, want=-inward)
        oq = [q[0], q[1], q[1] - UP * 0.6, q[0] - UP * 0.6]
        face(b, oq, WHITE, want=-inward)
        # close the two ends of the canopy (no slit between its top and its underside)
        for e, (ea, eb), tt in ((k == ks[0], (0, 3), t0), (k == ks[-1], (1, 2), t1)):
            if e:
                tang = _ell(A0, B0, tt + (0.01 if tt == t1 else -0.01), 0) - _ell(A0, B0, tt, 0)
                face(b, [q[ea], q[eb], q[eb] - UP * 0.35, q[ea] - UP * 0.35], WHITE, want=tang)
    for k in list(ks) + [3]:
        t = 2 * math.pi * k / n
        top = _ell(A0 - 0.6, B0 - 0.6, t, 27.8)
        b.beam(_ell(A0 - 0.6, B0 - 0.6, t, Hs), top, 0.8, color=STEEL)
        b.beam(top, _ell(A3 + 1.5, B3 + 1.5, t, 22.6), 0.5, color=STEEL)
    b.solids.append(np.array([_ell(a_, b2, 2 * math.pi * k / n, z) for k in (-3, 0, 3) for (a_, b2) in ((A0, B0), (A3 + 1.0, B3 + 1.0))
                              for z in (21.0, 26.0)], float))
    # floodlight masts in the four corners
    masts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 67.0, sy * 53.0
            st = mark(b)
            tube(b, (x, y, 0.0), (x, y, 27.6), 1.2, n=4, r1=0.55, col="#d9dce2", caps=False, solid=True)
            d = -np.array([x, y, 0.0])
            d /= np.linalg.norm(d)
            side = np.array([-d[1], d[0], 0.0])
            c = np.array([x, y, 27.75]) - d * 0.4
            hw, hh = 4.4, 2.2
            back = [c - side * hw - UP * hh, c + side * hw - UP * hh, c + side * hw + UP * hh, c - side * hw + UP * hh]
            frontq = [p + d * 0.9 + UP * 0.2 * (1 if p[2] > c[2] else -1) * 0 for p in back]
            face(b, frontq, None, region="lamp", want=d)
            face(b, back, STEEL, want=-d)
            face(b, [back[0], back[1], frontq[1], frontq[0]], STEEL, want=-UP)
            face(b, [back[3], back[2], frontq[2], frontq[3]], STEEL, want=UP)
            face(b, [back[1], back[2], frontq[2], frontq[1]], STEEL, want=side)
            face(b, [back[0], back[3], frontq[3], frontq[0]], STEEL, want=-side)
            masts.append((x, y, st))
    b.bite_hint = (-18.0, -70.0, 20.0)

    # rubble: a broken ring of the bowl round the green pitch
    st = mark(b)
    face(b, [_ell(30.0, 24.0, 2 * math.pi * k / 12, 3.4) for k in range(12)], GRASS, want=UP, tag="roof")
    for k in range(12):
        t0, t1 = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
        face(b, [_ell(30.0, 24.0, t0, 0.0), _ell(30.0, 24.0, t1, 0.0), _ell(30.0, 24.0, t1, 3.4), _ell(30.0, 24.0, t0, 3.4)],
             "#7b7b82", want=_ell(1, 1, (t0 + t1) / 2, 0))
    face(b, [(-20.0, -7.0, 3.45), (20.0, -7.0, 3.45), (20.0, -6.6, 3.45), (-20.0, -6.6, 3.45)], "#f6f6f2", want=UP)
    face(b, [(-0.2, -16.0, 3.45), (0.2, -16.0, 3.45), (0.2, 16.0, 3.45), (-0.2, 16.0, 3.45)], "#f6f6f2", want=UP)
    for k in range(n):
        if k % 6 in (2, 3) or k % 8 == 5:
            continue                                         # gaps in the ring
        t0, t1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        o0, o1 = _ell(A0 - 2.0, B0 - 2.0, t0, 0), _ell(A0 - 2.0, B0 - 2.0, t1, 0)
        hgt = 3.2 + 2.6 * ((k * 7) % 5) / 4
        out = (o0 + o1) / 2
        out[2] = 0
        b.wall(o0[:2], o1[:2], 0.0, hgt - 1.2, "strip_concrete")
        face(b, [o0 + UP * (hgt - 1.2), o1 + UP * (hgt - 1.2), o1 + UP * hgt, o0 + UP * hgt], SEA, want=out)
        i0, i1 = _ell(A2 - 6.0, B2 - 6.0, t0, 0.8), _ell(A2 - 6.0, B2 - 6.0, t1, 0.8)
        face(b, [o0 + UP * hgt, o1 + UP * hgt, i1, i0], "#e4e6ea", want=UP)
        for kk, oo, ii, sgn in ((k - 1, o0, i0, -1), (k + 1, o1, i1, 1)):
            if kk % 6 in (2, 3) or kk % 8 == 5:                 # a broken end: close it
                tang = _ell(A0, B0, (t0 if sgn < 0 else t1) + sgn * 0.01, 0) - _ell(A0, B0, t0 if sgn < 0 else t1, 0)
                face(b, [oo, oo + UP * hgt, ii, ii - UP * 0.8], "#8d8d94", want=tang)
    keep = since(b, st)
    del b.intact.faces[st:]
    b.keepsake = keep

    def hook(b, m):
        # one floodlight mast down, fallen in across the stand
        x, y, _st = masts[0]
        fs = select(m, lambda f: math.hypot(f.center[0] - x, f.center[1] - y) < 4.5)
        d = -np.array([x, y, 0.0])
        d /= np.linalg.norm(d)
        rotate_faces(fs, (-d[1], d[0], 0.0), 62.0, (x, y, 0.0))
        # the front stand slumps inward where the bite tore it: a V-shaped sag along the bowl
        xc = -14.0
        moved = {id(f) for f in fs}
        for f in m.faces:
            c = f.center
            if c[1] < -30.0 and abs(c[0] - xc) < 40.0 and id(f) not in moved:
                f.pts = [np.array([p[0], p[1] * (1.0 - 0.06 * max(0.0, 1 - abs(p[0] - xc) / 40.0)),
                                   p[2] * (0.38 + 0.62 * min(1.0, abs(p[0] - xc) / 40.0))]) for p in f.pts]
    b.damage_hook = hook


# ==== The Tidewheel ==========================================================================
WHEEL_Z = 44.6
WHEEL_R = 30.4


def _wheel(b, hub, R, n=24, *, segs=None, gondolas=True, spokes=True, lit=True, solid=True, caps=False,
           drop=None):
    """The wheel in the x-z plane round `hub`: a rim with a ring of lights on both faces,
    spokes, a hub, and n candy-striped gondolas hanging from the rim."""
    hub = _v(hub)
    th = 0.8          # half thickness of the rim (y)
    rw = 0.75         # half width of the rim (radial)
    segs = range(n) if segs is None else segs

    def P(r, a, y):
        return hub + np.array([r * math.cos(a), y, r * math.sin(a)])
    for k in segs:
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        ro, ri = R + rw, R - rw
        mid = np.array([math.cos((a0 + a1) / 2), 0, math.sin((a0 + a1) / 2)])
        face(b, [P(ro, a0, -th), P(ro, a1, -th), P(ro, a1, th), P(ro, a0, th)], "#f2f2f4", want=mid)
        face(b, [P(ri, a0, -th), P(ri, a1, -th), P(ri, a1, th), P(ri, a0, th)], "#c9ccd2", want=-mid)
        for yy, sgn in ((-th, -1), (th, 1)):
            face(b, [P(ri, a0, yy), P(ri, a1, yy), P(ro, a1, yy), P(ro, a0, yy)], None if lit else "#f2f2f4",
                 want=(0, sgn, 0), region="lamp" if lit else None)
        if caps:                                    # closed ends (broken wheels only)
            for a_, sg in ((a0, -1), (a1, 1)):
                tng = np.array([-math.sin(a_), 0, math.cos(a_)]) * sg
                face(b, [P(ri, a_, -th), P(ro, a_, -th), P(ro, a_, th), P(ri, a_, th)], "#c9ccd2", want=tng)
        if solid:
            # the chunk generator keeps a piece only if it fills 4% of its cell: the rim alone is too
            # thin, so each solid is a band of rim, spoke ends and gondola (6.5 m deep, 2.4 m thick)
            b.solids.append(np.array([P(r, a, y) for r in (ro, R - 6.0) for a in (a0, a1) for y in (-1.2, 1.2)], float))
    if spokes:
        for k in range(12):
            if segs is not None and (2 * k) not in segs and (2 * k + 1) not in segs:
                continue
            a = 2 * math.pi * k / 12 + math.pi / 24
            y = 0.55 if k % 2 else -0.55
            b.beam(P(2.0, a, y), P(R - rw, a, y * 0.6), 0.32, color="#e8e9ec")
    if gondolas:
        cols = ["awning_red", "awning_blue", "awning_red", "awning_gold"]
        for k in segs:
            a = 2 * math.pi * k / n
            p = P(R, a, 0.0)
            top = p[2] - 0.5
            dz = (drop or {}).get(k, 0.0)
            if dz:                                   # hanging loose on one arm
                b.beam(p, p + np.array([0.6, 0.0, -dz - 0.5]), 0.2, color=STEEL)
                top -= dz
            gx, gy = p[0], p[1]
            reg = cols[k % 4] if k % 3 else "awning_blue"
            lo, hi = (gx - 1.55, gy - 1.3, top - 2.9), (gx + 1.55, gy + 1.3, top)
            b.box(lo, hi, region=reg, top="white", bottom=True)
            b.intact.faces[-2].col = hex_rgb("#f5f2ea")


def _legs(b, bent=False):
    """The two white A-frames and their ties; `bent`: one leg buckled at its knee."""
    for sy in (-1, 1):
        top = np.array([0.0, sy * 3.6, WHEEL_Z + 0.5])
        for sx in (-1, 1):
            foot = np.array([sx * 15.5, sy * 6.2, 0.8])
            if bent and sx > 0 and sy < 0:
                knee = foot + (top - foot) * 0.45 + np.array([2.6, -1.4, -2.0])
                b.beam(top, knee, 1.2, color="#e6e6e8")
                b.beam(knee, foot, 1.2, color="#e6e6e8")
            else:
                b.beam(top, foot, 1.2, color="#f2f2f4")
        b.beam((-11.0, sy * 5.8, 12.0), (11.0 if not (bent and sy < 0) else 9.0, sy * 5.8, 12.0 if not (bent and sy < 0) else 9.5),
               0.7, color="#f2f2f4")


@kit.building("tidewheel", district="boardwalk", tone="white", seed=51)
def tidewheel(b):
    # The wheel faces the beach (front, -y): its face runs east-west. Two white A-frames hold
    # the axle; a striped ticket booth stands at its foot.
    hub = (0.0, 0.0, WHEEL_Z)
    _wheel(b, hub, WHEEL_R)
    tube(b, (0, -2.2, WHEEL_Z), (0, 2.2, WHEEL_Z), 2.3, n=8, col="#e8e9ec", solid=True)
    disc(b, (0, -2.25, WHEEL_Z), (0, -1, 0), 1.3, n=8, col=RED)
    disc(b, (0, 2.25, WHEEL_Z), (0, 1, 0), 1.3, n=8, col=RED)
    tube(b, (0, -4.0, WHEEL_Z), (0, 4.0, WHEEL_Z), 0.7, n=6, col=STEEL, caps=False)
    _legs(b)
    for sy in (-1, 1):
        top = (0.0, sy * 3.6, WHEEL_Z + 0.5)
        for sx in (-1, 1):
            foot = (sx * 15.5, sy * 6.2, 0.8)
            p = np.array(foot) + (np.array(top) - np.array(foot)) * 0.0
            b.solids.append(np.array([np.array(top) + d for d in ((0.6, 0.6, 0), (-0.6, -0.6, 0), (0.6, -0.6, 0), (-0.6, 0.6, 0))]
                                     + [p + d for d in ((0.6, 0.6, 0), (-0.6, -0.6, 0), (0.6, -0.6, 0), (-0.6, 0.6, 0))], float))
        for sx in (-1, 1):
            b.box((sx * 15.5 - 1.6, sy * 6.2 - 0.8, 0.0), (sx * 15.5 + 1.6, sy * 6.2 + 0.8, 1.0), color="#bdb9b0",
                  top="white")
    # boarding deck and the ticket booth
    b.box((-6.0, -4.2, 0.0), (6.0, 4.2, 0.5), color="#c8a878", top="white")
    b.intact.faces[-1].col = hex_rgb("#d9bb8a")
    booth = b.block(5.0, 3.0, 3.0, at=(0.0, -5.1, 0.0), facade="plaster_plain", roof=False, tone=style.TONES["white"])
    b.decal(booth, "front", 0.0, 0.8, 3.2, 1.4, "lit_glass")
    b.hip(booth, rise=1.8, roof="awning_red")
    b.bite_hint = (-14.0, -6.0, 66.0)

    # rubble: the wheel toppled and half rolled into the heap, a broken arc leaning out
    st = mark(b)
    _wheel(b, (0.0, 0.0, -8.5), WHEEL_R, segs=[k for k in range(1, 12) if k not in (4,)], solid=False, caps=True,
           lit=False)
    keep = since(b, st)
    del b.intact.faces[st:]
    keep.rotx(16.0)
    keep.rotz(4.0)
    keep.faces = [f for f in keep.faces if min(p[2] for p in f.pts) > -0.5]
    for f in keep.faces:
        f.pts = [np.array([min(max(p[0], -31.5), 31.5), min(max(p[1], -6.9), 6.9), max(p[2], 0.0)]) for p in f.pts]
    b.keepsake = keep

    def hook(b, m):
        # A frame does not hold holes: the damaged wheel is built here, not cut. Everything but
        # the booth, the deck and the footings is replaced by a broken wheel (a run of the rim
        # torn out, gondolas hanging loose), tilted on its axle and buckled, on bent legs.
        keep = [f for f in m.faces if f.center[2] < 1.05 or (abs(f.center[0]) < 6.5 and f.center[2] < 6.0
                                                              and f.center[1] < -2.0)]
        m.faces[:] = keep
        st = mark(b)
        _wheel(b, (0.0, 0.0, WHEEL_Z), WHEEL_R, segs=[k for k in range(24) if k not in (3, 4, 5)], solid=False,
               caps=True, drop={8: 3.5, 14: 5.0, 20: 2.5}, lit=False)        # the power is out
        tube(b, (0, -2.2, WHEEL_Z), (0, 2.2, WHEEL_Z), 2.3, n=8, col="#d8d9dc")
        wheel = b.intact.faces[st:]
        rotate_faces(wheel, (0.0, 1.0, 0.0), 11.0, (0.0, 0.0, WHEEL_Z))
        rotate_faces(wheel, (1.0, 0.0, 0.0), -6.0, (0.0, 0.0, WHEEL_Z))
        for f in wheel:                                # buckle: the right half bends out of plane
            f.pts = [p + np.array([0.0, -0.08 * max(0.0, p[0]), 0.0]) for p in f.pts]
        st2 = mark(b)
        _legs(b, bent=True)
        tube(b, (0, -4.0, WHEEL_Z), (0, 4.0, WHEEL_Z), 0.7, n=6, col=STEEL, caps=False)
        for f in b.intact.faces[st:]:
            f.col = tuple(c * 0.86 for c in f.col)     # soot
        m.faces.extend(b.intact.faces[st:])
        del b.intact.faces[st:]
        _ = st2
    b.damage_hook = hook


# ==== Halcyon Observatory =====================================================================
@kit.building("halcyon_observatory", district="university", tone="white", seed=61)
def halcyon_observatory(b):
    # A stone terrace with steps; on it a round white drum with two rows of windows under a big
    # silver dome, its shutter slot open toward the south, the telescope tube poking out; two
    # small domes on the front corners of the terrace and a low lab wing behind.
    ter = b.block(40.0, 36.0, 2.6, at=(0.0, 2.0, 0.0), facade="plinth", roof="concrete_plain")
    for i in range(3):
        b.box((-6.0 + i * 0.4, -20.0 + i * 1.3, 0.0), (6.0 - i * 0.4, ter.y0, 0.85 * (i + 1)), color=LIMESTONE,
              top="white")
    box_solid(b, (-6.0, -20.0, 0.0), (6.0, ter.y0, 2.6))
    zt = ter.z1
    wing = banded(b, 26.0, 8.0, 4.5, (0.0, 14.0, zt), band=0.5, band_region="cornice_white", facade="glass_blue",
                  tone=style.TONES["white"])
    _ = wing
    cx, cy, R = 0.0, 2.0, 10.8
    b.prism((cx, cy), R, zt, zt + 9.0, n=16, color="#f3f2ee", top=None, solid=True, tag=SHELL)
    zd = zt + 9.0
    for k in range(16):                              # a ring of tall windows, and the doors at the front
        a = 2 * math.pi * k / 16
        if k in (12,):
            continue
        rr = R * math.cos(math.pi / 16) + 0.03
        c0 = np.array([cx + rr * math.cos(a), cy + rr * math.sin(a), zt + 2.6])
        t = np.array([-math.sin(a), math.cos(a), 0.0])
        face(b, [c0 - t * 0.8, c0 + t * 0.8, c0 + t * 0.8 + UP * 4.2, c0 - t * 0.8 + UP * 4.2], None,
             region="lit_glass", want=(math.cos(a), math.sin(a), 0))
    a = 2 * math.pi * 12 / 16
    rr = R * math.cos(math.pi / 16) + 0.03
    c0 = np.array([cx + rr * math.cos(a), cy + rr * math.sin(a), zt])
    t = np.array([-math.sin(a), math.cos(a), 0.0])
    face(b, [c0 - t * 1.3, c0 + t * 1.3, c0 + t * 1.3 + UP * 2.8, c0 - t * 1.3 + UP * 2.8], None, region="door_double",
         want=(math.cos(a), math.sin(a), 0))
    b.prism((cx, cy), R + 0.5, zd, zd + 0.7, n=16, color="#e9e9ec", top="white", top_color="#d5d8de")
    disc(b, (cx, cy, zd), -UP, R + 0.5, n=16, col="#c9ccd2", phase=math.pi / 16)
    # the dome; its slot faces the front (-y): segments 11 and 12 of 16 (angles 247.5..292.5)
    DH = 9.0
    ring_dome(b, (cx, cy), R, zd + 0.7, DH, n=16, rings=4, col=SILVER, slot=(12,), slot_col="#1d1f26",
              inner_col="#6d7380")
    for a in (2 * math.pi * 12 / 16, 2 * math.pi * 13 / 16):
        prev = None
        for j in range(5):
            t = math.pi / 2 * j / 4
            rr, zz = (R + 0.25) * math.cos(t), zd + 0.7 + (DH + 0.25) * math.sin(t)
            p = (cx + rr * math.cos(a), cy + rr * math.sin(a), zz)
            if prev is not None:
                b.beam(prev, p, 0.45, color="#9aa3ad")
            prev = p
    # the telescope: from inside the dome out through the slot, up toward the southern sky
    a = 2 * math.pi * 12.5 / 16
    d = np.array([math.cos(a) * 0.75, math.sin(a) * 0.75, 0.66])
    d /= np.linalg.norm(d)
    p0 = np.array([cx, cy, zd + 3.0])
    p1 = p0 + d * ((23.1 - p0[2]) / d[2])
    tube(b, p0, p1, 1.05, n=8, col="#f4f5f7", solid=False)
    tube(b, p1 - d * 2.4, p1 + d * 0.1, 1.3, n=8, col=STEEL_DK)
    disc(b, p1 + d * 0.12, d, 0.95, n=8, region="lit_glass")
    # two small domes on the front corners
    for sx in (-1, 1):
        x, y = sx * 14.0, -11.0
        b.prism((x, y), 3.3, zt, zt + 3.4, n=10, region="plaster_plain", top=None, solid=True)
        b.decal(kit.Block(x - 1.0, x + 1.0, y - 3.25, y, zt, zt + 3.4, "plaster_plain", False, (1, 1, 1)), "front",
                0.0, zt, 1.125, 2.25, "door_blue")
        ring_dome(b, (x, y), 3.5, zt + 3.4, 3.4, n=10, rings=2, col=SILVER, slot=(7,), slot_col="#1d1f26")
        disc(b, (x, y, zt + 3.4), -UP, 3.5, n=10, col="#c9ccd2")
    for sx in (-1, 1):                              # terrace railing, two-sided, with a handrail
        x0, x1 = sx * 19.9, sx * 19.8
        q = [(x0, ter.y0, zt), (x0, ter.y1, zt), (x0, ter.y1, zt + 1.0), (x0, ter.y0, zt + 1.0)]
        qi = [(x1, p[1], p[2]) for p in q]
        face(b, q, None, region="rail_metal", want=(sx, 0, 0))
        face(b, qi, None, region="rail_metal", want=(-sx, 0, 0))
        face(b, [q[3], q[2], qi[2], qi[3]], "#d8dbe0", want=UP)
    b.bite_hint = (20.0, 20.0, 4.0)          # a back corner of the terrace and the wing; the dome cracks in the hook

    # rubble: the telescope tube on its mount, still pointing at the sky
    st = mark(b)
    b.box((-1.6, -1.6, 0.0), (1.6, 1.6, 3.6), color="#5a606b", top="dark")
    dd = np.array([0.25, -0.35, 0.9])
    dd /= np.linalg.norm(dd)
    q0 = np.array([0.0, 0.0, 2.6])
    tube(b, q0 - dd * 1.0, q0 + dd * 4.3, 1.05, n=8, col="#f4f5f7")
    tube(b, q0 + dd * 2.9, q0 + dd * 4.7, 1.3, n=8, col=STEEL_DK)
    disc(b, q0 + dd * 4.72, dd, 0.95, n=8, region="lit_glass")
    keep = since(b, st)
    del b.intact.faces[st:]
    keep.move(-2.0, 1.0, 0.3)
    b.keepsake = keep

    def hook(b, m):
        # the big dome cracked open like an egg: its upper half breaks into petals that peel
        # outward, two of them gone; the shutter slot and the telescope stay
        zh = zd + 0.7 + DH * 0.4
        dome = select(m, lambda f: f.tag in ("roof", SHELL) and f.center[2] > zh
                      and math.hypot(f.center[0] - cx, f.center[1] - cy) < R + 0.3)
        gone = []
        for f in dome:
            ang = math.atan2(f.center[1] - cy, f.center[0] - cx) % (2 * math.pi)
            k = int(ang / (2 * math.pi / 16))
            if k in (1, 2, 6):
                gone.append(f)
                continue
            if k in (11, 12, 13):
                continue                                      # the slot side holds
            mid = 2 * math.pi * (k + 0.5) / 16
            rh = R * math.cos(math.asin(min(1.0, (zh - zd - 0.7) / DH)))
            hinge = (cx + rh * math.cos(mid), cy + rh * math.sin(mid), zh)
            rotate_faces([f], (-math.sin(mid), math.cos(mid), 0.0), 30.0 + 12.0 * (k % 3), hinge)
        remove_faces(m, gone)
    b.damage_hook = hook


# ==== Farewell Light ==========================================================================
@kit.building("farewell_light", district="harbor", tone="white", seed=83)
def farewell_light(b):
    # A square granite base with the keeper's door, a round tapering tower in red and white
    # bands, a black gallery with a railing, the glass lamp room and a red cap with a vent.
    base = banded(b, 12.0, 12.0, 5.0, (0.0, 0.0, 0.0), band=0.6, facade="plinth")
    b.door(base, "front", x=0.0, kind="door_green")
    z0, z1 = 5.0, 37.6
    r0, r1 = 4.3, 2.9
    bands = 6
    n = 12
    for i in range(bands):
        za = z0 + (z1 - z0) * i / bands
        zb = z0 + (z1 - z0) * (i + 1) / bands
        ra = r0 + (r1 - r0) * i / bands
        rb = r0 + (r1 - r0) * (i + 1) / bands
        b.prism((0, 0), ra, za, zb, n=n, radius_top=rb, color=RED if i % 2 else WHITE, top=None, phase=0.0,
                tag="shell")       # cut by the damage like a wall (see SHELL)
    b.solids.append(np.array([(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n), z)
                              for k in range(n) for r, z in ((r0, z0), (r1, z1))], float))
    for i, zw in enumerate((10.0, 21.0, 31.5)):         # small windows up the front
        rr = r0 + (r1 - r0) * (zw - z0) / (z1 - z0)
        face(b, [(-0.55, -rr * 0.985 - 0.05, zw), (0.55, -rr * 0.985 - 0.05, zw), (0.55, -rr * 0.985 - 0.05, zw + 1.6),
                 (-0.55, -rr * 0.985 - 0.05, zw + 1.6)], None, region="lit_glass", want=(0, -1, 0))
    # gallery
    b.prism((0, 0), 4.5, z1, z1 + 0.6, n=n, color=BLACK, top="white", top_color="#3a3f4a", phase=0.0)
    disc(b, (0, 0, z1), (0, 0, -1), 4.5, n=n, col=BLACK)                 # the gallery's underside
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        q = [(4.35 * math.cos(a0), 4.35 * math.sin(a0), z1 + 0.6), (4.35 * math.cos(a1), 4.35 * math.sin(a1), z1 + 0.6),
             (4.35 * math.cos(a1), 4.35 * math.sin(a1), z1 + 1.7), (4.35 * math.cos(a0), 4.35 * math.sin(a0), z1 + 1.7)]
        out = (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0)
        face(b, q, None, region="rail_metal", want=out, unit=(2.4, 1.1), origin=q[0])
        qi = [(p[0] * 0.985, p[1] * 0.985, p[2]) for p in q]          # 6 cm inside: no fighting
        face(b, qi, None, region="rail_metal", want=(-out[0], -out[1], 0), unit=(2.4, 1.1), origin=qi[1])
        face(b, [q[3], q[2], qi[2], qi[3]], "#d8dbe0", want=UP)                  # the handrail on top
    zl = z1 + 0.6
    b.prism((0, 0), 2.5, zl, zl + 0.9, n=8, color=BLACK, top="white", top_color=BLACK)
    b.prism((0, 0), 2.3, zl + 0.9, zl + 4.4, n=8, region="lit_glass", top=None, tag=SHELL)
    b.prism((0, 0), 2.24, zl + 0.9, zl + 4.3, n=8, region="dark", top="dark")    # seen when the glass breaks
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        b.beam((2.32 * math.cos(a), 2.32 * math.sin(a), zl + 0.9), (2.32 * math.cos(a), 2.32 * math.sin(a), zl + 4.4),
               0.18, color=BLACK)
    b.solids.append(np.array([(2.5 * math.cos(2 * math.pi * k / 8), 2.5 * math.sin(2 * math.pi * k / 8), z)
                              for k in range(8) for z in (zl, zl + 4.4)], float))
    zc = zl + 4.4
    b.prism((0, 0), 2.8, zc, zc + 0.35, n=8, color=BLACK, top=None)
    disc(b, (0, 0, zc), (0, 0, -1), 2.8, n=8, col=BLACK, phase=math.pi / 8)
    b.cone((0, 0), 2.8, zc + 0.35, zc + 3.0, n=8, color=RED)
    b.solids.append(np.array([(2.8 * math.cos(2 * math.pi * k / 8), 2.8 * math.sin(2 * math.pi * k / 8), zc)
                              for k in range(8)] + [(0, 0, zc + 3.0)], float))
    b.prism((0, 0), 0.55, zc + 2.6, zc + 3.7, n=6, color=BLACK, top="white", top_color=BLACK)
    tube(b, (0, 0, zc + 3.7), (0, 0, 48.0), 0.06, n=4, col=BLACK, caps=False)
    b.bite_hint = (6.0, -6.0, 28.0)

    # rubble: the red-and-white stump with a jagged top (walls 0.5 m thick, dark inside)
    st = mark(b)
    jag = [9.8, 11.8, 9.3, 12.6, 10.2, 9.4, 11.0, 9.6, 12.2, 9.3, 10.6, 9.6]
    ri = r0 - 0.5

    def ring_pt(r, k, z):
        a = 2 * math.pi * k / n
        return (r * math.cos(a), r * math.sin(a), z)
    for k in range(n):
        k1 = (k + 1) % n
        out = (math.cos(2 * math.pi * (k + 0.5) / n), math.sin(2 * math.pi * (k + 0.5) / n), 0)
        for za, zb, c in ((0.0, 4.5, WHITE), (4.5, 9.0, RED), (9.0, 99.0, WHITE)):
            t0, t1 = min(zb, jag[k]), min(zb, jag[k1])
            if t0 <= za + 0.05 and t1 <= za + 0.05:
                continue
            pts = [ring_pt(r0, k, za), ring_pt(r0, k + 1, za)]
            pts += [ring_pt(r0, k + 1, max(za, t1)), ring_pt(r0, k, max(za, t0))]
            pts = [p for i2, p in enumerate(pts) if i2 < 2 or p[2] > za + 0.01]
            face(b, pts, c, want=out)
        face(b, [ring_pt(ri, k, 3.0), ring_pt(ri, k + 1, 3.0), ring_pt(ri, k + 1, jag[k1]), ring_pt(ri, k, jag[k])],
             "#3a3236", want=(-out[0], -out[1], 0))
        face(b, [ring_pt(r0, k, jag[k]), ring_pt(r0, k + 1, jag[k1]), ring_pt(ri, k + 1, jag[k1])], "#9a9aa1", want=UP)
        face(b, [ring_pt(r0, k, jag[k]), ring_pt(ri, k + 1, jag[k1]), ring_pt(ri, k, jag[k])], "#9a9aa1", want=UP)
    disc(b, (0, 0, 3.0), (0, 0, 1), ri, n=n, region="rubble", phase=0.0)
    keep = since(b, st)
    del b.intact.faces[st:]
    keep.rotx(-7.0).move(0.6, 0.4, 0.6)
    b.keepsake = keep

    def hook(b, m):
        # the top leans toward the sea
        # the lamp room smashed: the seaward panes gone, the cap knocked askew
        remove_faces(m, select(m, lambda f: f.region in ("lit_glass", "lit_glass_dmg") and f.center[2] > zl
                               and f.center[1] < 0.6))
        # (the cap stays on: a tilted cap opened gaps under it)
        # and the whole top leans toward the sea
        top = select(m, lambda f: f.center[2] > z1 - 0.2)
        rotate_faces(top, (1.0, 0.25, 0.0), 9.0, (0.0, -2.9, z1 - 2.0))
        drop_unpaired_rails(m)
    b.damage_hook = hook


# ==== the family picture ======================================================================
FAMILY_ROWS = (
    # front row, left to right, fronts on the far curb of the street
    ("lm_farewell_light", "lm_halcyon_observatory", "lm_city_hall", "lm_tidewater_cathedral", "lm_tidewheel"),
    # back row, behind a back street
    ("lm_meridian_tower", "lm_anchor_field"),
)


def family_shot(out=None, size=(1600, 900), samples=16):
    """docs/art/concept/city_landmarks_a.png: all seven at true relative scale on a short piece of
    street, by day, with cars, lamps, trees, the hatchling and soldiers for scale.
    Run with: tools/art/city_landmarks_a.py --family-shot"""
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

    gap = 10.0
    curb = 10.0
    arch = contract.archetypes()
    back_y = None
    front_depth = 0.0
    for r, row in enumerate(FAMILY_ROWS):
        widths = [arch[m.split("_", 1)[1]]["footprint"][0] for m in row]
        depths = [arch[m.split("_", 1)[1]]["footprint"][1] for m in row]
        total = sum(widths) + gap * (len(row) - 1)
        x = -total / 2
        y0 = curb if r == 0 else back_y
        for mid, w, d in zip(row, widths, depths):
            place(mid, x + w / 2, y0 + d / 2)
            x += w + gap
        front_depth = max(depths)
        back_y = curb + front_depth + 18.0
    # the street: asphalt, two curbs and sidewalks, lane dashes; a back street behind the front row
    g = mb.Geo()

    def quad(x0, y0, x1, y1, z, col):
        g.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], color=col)

    L = 150.0
    quad(-L, -7.0, L, 7.0, 0.02, "#4a4d55")
    quad(-L, -11.0, L, -7.0, 0.15, "#b9b5ac")
    quad(-L, 7.0, L, curb, 0.15, "#b9b5ac")
    quad(-L, curb + front_depth + 4.0, L, curb + front_depth + 16.0, 0.02, "#4a4d55")
    for k in range(-int(L // 5), int(L // 5)):
        quad(k * 5.0, -0.12, k * 5.0 + 2.6, 0.12, 0.04, "#efe9d8")
    mb.node("street", g)
    for mid, x, y in (("prop_car_sedan", -70.0, -3.2), ("prop_car_taxi", 30.0, 3.4), ("prop_bus", 75.0, -3.4),
                      ("prop_car_van", -10.0, 3.4), ("prop_lamp", -100.0, 8.2), ("prop_lamp", -50.0, 8.2),
                      ("prop_lamp", 0.0, 8.2), ("prop_lamp", 50.0, 8.2), ("prop_lamp", 100.0, 8.2),
                      ("prop_tree_a", -120.0, -9.0), ("prop_tree_b", -60.0, -9.0), ("prop_tree_a", 10.0, -9.0),
                      ("prop_tree_b", 60.0, -9.0), ("prop_tree_a", 118.0, -9.0)):
        path = contract.model_path(mid)
        if os.path.exists(path):
            place(mid, x, y)
    lizard = contract.model_path("kaiju_lizard_s1")
    if os.path.exists(lizard):
        for o in place("kaiju_lizard_s1", -88.0, 0.5):
            o.rotation_mode = "QUATERNION"
    mat = bpy.data.materials.new("mbsheet_olive")
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.08, 1.0)
    for x in (-80.0, -78.6, -77.4):
        for o in sheet._soldier(x, -9.0):
            o.data.materials.append(mat)
    for o in bpy.context.scene.objects:
        o.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    out = out or os.path.join(contract.CONCEPT, "city_landmarks_a.png")
    return mb.concept("city_landmarks_a", out=out, backdrop="sky", azimuth=24.0, elevation=11.0, fov=30.0, zoom=1.12,
                      size=size, samples=samples)


if __name__ == "__main__":
    if "--family-shot" in sys.argv:
        print(family_shot())
        raise SystemExit(0)
    raise SystemExit(kit.run_family("city_landmarks_a"))
