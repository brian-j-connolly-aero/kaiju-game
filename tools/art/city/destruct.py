"""ONE generator for the destruction states of every building, derived from its intact model.

    damaged  the same silhouette with a missing top corner and holes punched through the
             walls; broken-open floors inside; facades swap to their wrecked atlas twins
             (broken glass, soot, cracks, fire in some windows at night); scorched near holes.
             A hole cuts only what it reaches; small parts are cut at its edge (not dropped),
             and what it leaves visible from behind gets a back side (_back_sides)
    rubble   a low grey heap inside the footprint: a broken base, rough mounds, bent beams,
             a few slabs of the building's own facade lying on top, plus the building's
             keepsake (b.keepsake) if it has one
    chunks   6 to 24 pieces that together approximate the intact building: its solids cut
             on a jittered grid, each piece textured from the face it came from, broken faces
             in rubble; each node's origin at its own center (the kit's export does that)

Deterministic: the building's seed decides everything, so a rebuild changes nothing.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import atlas, budgets, style
from .geom import (Face, Mesh, affine_uv, box_faces, box_planes, convex_intersection, face_axes, hex_rgb,
                   hull, hull_faces, hull_planes, intersect_convex, map_region, plain, region_uv_bounds,
                   shift_to_twin, subtract_convex)


@dataclass
class States:
    damaged: Mesh
    rubble: Mesh
    chunks: list


def derive(b) -> States:
    limit = budgets.budget(b.id)
    if b.intact.tris > limit:
        raise RuntimeError(f"{b.model}: intact has {b.intact.tris} triangles, budget {limit}")
    return States(damaged(b, limit), rubble(b, limit), chunks(b))


# ---- damaged -------------------------------------------------------------------------------
def _bites(b, rng, holes: int, scale: float):
    lo, hi = b.intact.bounds()
    w, d, h = hi - lo
    big = max(w, d)
    bites = []
    # the missing top corner
    if b.bite_hint is not None:
        cx, cy, cz = b.bite_hint
    else:
        sx, sy = rng.choice([-1, 1]), -1          # a front corner: the side players look at
        top = _solid_top(b)
        cx, cy, cz = sx * w * 0.5, sy * d * 0.5, top
    hz = min(0.3 * h, 0.55 * big) * scale
    k = 0.42 if h < 15 else 0.32                 # small buildings: a bigger bite, or it does not read
    half = (k * w * scale + 0.4, k * d * scale + 0.4, hz + 0.4)
    bites.append(box_planes((cx, cy, cz), half, rot_deg=rng.uniform(-30, 30),
                            tilt=(rng.uniform(-12, 12), rng.uniform(-12, 12))) + ((cx, cy, cz), half))
    # holes through walls
    sides = ["front", "back", "left", "right"]
    for k in range(holes):
        side = sides[(k + int(rng.integers(4))) % 4]
        zc = lo[2] + h * rng.uniform(0.2, min(0.75, 0.75 * 30 / max(h, 30) + 0.25))
        size = min(big * 0.22, 2.0 + 0.05 * h) * scale + 1.0
        depth = min(big * 0.25, size)
        if side in ("front", "back"):
            x = rng.uniform(lo[0] + size, hi[0] - size) if w > 2 * size else 0.0
            y = lo[1] if side == "front" else hi[1]
            c = (x, y, zc)
            half = (size, depth, size * 0.75)
        else:
            y = rng.uniform(lo[1] + size, hi[1] - size) if d > 2 * size else 0.0
            x = hi[0] if side == "left" else lo[0]
            c = (x, y, zc)
            half = (depth, size, size * 0.75)
        bites.append(box_planes(c, half, rot_deg=rng.uniform(-20, 20), tilt=(rng.uniform(-15, 15), 0)) + (c, half))
    return bites


def _solid_top(b) -> float:
    tops = [s[:, 2].max() for s in b.solids] if b.solids else [b.intact.bounds()[1][2]]
    return float(max(tops))


def _base(tag: str) -> str:
    """A face's kind without a family's part mark ("detail|p3" -> "detail")."""
    return tag.split("|")[0]


def _mark(tag: str) -> str | None:
    return tag.split("|")[-1] if "|" in tag else None


# A part smaller than this (or a "detail" smaller than SMALL_DETAIL) is "small": in the fallback
# mode it is not cut but kept whole when most of it is outside the bite (else it goes).
SMALL, SMALL_DETAIL, SPECK = 1.5, 8.0, 0.02
INSIDE = "#5d5852"              # the inside of a broken sheet (a roof, a canopy, a sign)
OPEN_OK = 0.25                  # m2 of faces seen from behind that a damaged state may leave
BACK_GAP = 0.005                # a back side sits this far behind its face (m): no slit to see through


def _cut_faces(b, bites, mode: str) -> Mesh:
    """The intact faces minus the bites. A face a bite does not reach is kept as it is (not
    split); a face it reaches is cut, and its pieces are flagged `cut` (they have an open
    edge). Small parts: mode "clip" cuts them too; "keep" keeps them whole when most of them
    is outside the bite (else they go); "drop" (the last resort, the cheapest) lets every
    small part the bite touches go with it."""
    m = Mesh()
    for f in b.intact.faces:
        pieces = [f.copy()]
        for planes, _rot, _c, _half in bites:
            nxt = []
            for p in pieces:
                inside = intersect_convex(p, planes)
                if inside is None:
                    nxt.append(p)
                    continue
                if inside.area >= p.area - 1e-4:
                    continue                                  # all of it is in the bite
                small = p.area < SMALL or (_base(p.tag) == "detail" and p.area < SMALL_DETAIL)
                if p.area < SPECK or (small and mode != "clip"):
                    if mode != "drop" and inside.area < 0.5 * p.area:
                        nxt.append(p)                         # mostly outside: it stays whole
                    continue
                for q in subtract_convex(p, planes):
                    q.cut = True
                    nxt.append(q)
            pieces = nxt
        m += pieces
    # a part (its faces carry a mark listed in b.parts: "detail|p3") stands or falls together:
    # it keeps its cut faces while at least half of its surface is left, else all of it goes
    # (in the "drop" mode: unless all of it is left)
    parts = {p[0] if isinstance(p, tuple) else p for p in getattr(b, "parts", [])}
    whole, left = {}, {}
    for f in b.intact.faces:
        k = _mark(f.tag)
        if k in parts:
            whole[k] = whole.get(k, 0.0) + f.area
    for f in m.faces:
        k = _mark(f.tag)
        if k in parts:
            left[k] = left.get(k, 0.0) + f.area
    keep = 0.5 if mode != "drop" else 0.995
    gone = {k for k, a in whole.items() if left.get(k, 0.0) < keep * a - 1e-4}
    if gone:
        m.faces = [f for f in m.faces if _mark(f.tag) not in gone]
    return m


def damaged(b, limit: int) -> Mesh:
    lo, hi = b.intact.bounds()
    h = hi[2] - lo[2]
    holes0 = 1 if h < 12 else (2 if h < 40 else 3)
    if getattr(b, "holes", None) is not None:
        holes0 = b.holes
    attempts = [(holes0, 1.0), (max(0, holes0 - 1), 1.0), (max(0, holes0 - 1), 0.75), (0, 0.75), (0, 0.5)]
    solid_planes = [hull_planes(hh) for hh in (hull(s) for s in b.solids) if hh is not None]
    # Each attempt (holes, size) is tried with the small parts cut at the hole, then kept whole
    # when mostly outside it, then dropped when touched (cheapest). The first that fits the
    # budget and leaves at most OPEN_OK m2 without the back side it needs wins; if none does,
    # the one that leaves the least open does.
    m, best = Mesh(), None
    for holes, scale in attempts:
        for mode in ("clip", "keep", "drop"):
            rng = np.random.default_rng(b.seed * 7919 + 13)
            bites = _bites(b, rng, holes, scale)
            m = _cut_faces(b, bites, mode)
            # broken-open floors and walls inside each bite
            for planes, rot, c, half in bites:
                for quad in box_faces(c, half, rot):
                    inner = Face(list(reversed(quad)))
                    for sp in solid_planes:
                        piece = intersect_convex(inner, sp)
                        if piece is None or piece.area < 0.05:
                            continue
                        n = piece.normal
                        if abs(n[2]) > 0.7:
                            m += map_region(piece.pts, "rubble", col=(0.9, 0.9, 0.9), tag="interior")
                        else:
                            m += map_region(piece.pts, "interior", tag="interior", origin=(0.0, 0.0, 0.0))
            # wrecked twins, soot near the holes
            centers = [np.array(c) for _p, _r, c, _h in bites]
            radii = [max(hh) for _p, _r, _c, hh in bites]
            for f in m.faces:
                if f.tag == "interior":
                    continue
                shift_to_twin(f)
                fc = f.center
                k = 1.0
                for c, r in zip(centers, radii):
                    dist = np.linalg.norm(fc - c) / (r * 1.8)
                    if dist < 1.0:
                        k = min(k, 0.55 + 0.45 * dist)
                if _base(f.tag) == "roof":
                    k *= 0.82
                f.col = tuple(x * k for x in f.col)
            if b.damage_hook is not None:
                b.damage_hook(b, m)
            if m.tris > limit:
                continue
            missing = _back_sides(m, bites, solid_planes, limit)
            m.attempt = (holes, scale, mode, round(missing, 2))      # for the probes
            if missing <= OPEN_OK:
                return m
            if best is None or missing < best[0] - 1e-6:
                best = (missing, m)
    if best is not None:
        return best[1]
    raise RuntimeError(f"{b.model}: damaged state stays over its budget of {limit} triangles "
                       f"({m.tris}); simplify the intact model")


def _flip(seq) -> list:
    """The corners in reverse order, starting from the same corner: the export fans every face
    from its first corner, so a bent face and its back side get the same triangles."""
    seq = list(seq)
    return seq[:1] + seq[:0:-1]


def _view_dirs() -> list:
    """Directions toward a viewer: all round, from street level (5 degrees) to overhead."""
    out = []
    for el in (5, 25, 45, 70, 90):
        for k in range(1 if el == 90 else 12):
            a = math.radians(30 * k + 7 + el)
            e = math.radians(el)
            out.append(np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)]))
    return out


VIEW_DIRS = _view_dirs()


def _seen_from_behind(tree, f: Face) -> bool:
    """Can a player see this face from behind? Rays leave a few points just behind it toward
    every viewer direction on its back side; one that gets out without hitting anything
    means yes."""
    from mathutils import Vector
    n = f.normal
    pts = []
    a = f.pts[0]
    for k in range(1, len(f.pts) - 1):                 # points spread over each triangle
        b, c = f.pts[k], f.pts[k + 1]
        area = float(np.linalg.norm(np.cross(b - a, c - a))) / 2
        q = min(8, 2 + int(math.sqrt(area)))
        for i in range(q):
            for j in range(q - i):
                for u, v in (((i + 1 / 3) / q, (j + 1 / 3) / q), ((i + 2 / 3) / q, (j + 2 / 3) / q)):
                    if u + v <= 1.0:
                        pts.append(a + (b - a) * u + (c - a) * v)
    dirs = [d for d in VIEW_DIRS if float(d @ n) < -0.08]
    for p in pts:
        o = Vector((p - n * 0.002).tolist())       # in front of any back side already there
        for d in dirs:
            if tree.ray_cast(o, Vector(d.tolist()))[2] is None:
                return True
    return False


def _back_sides(m: Mesh, bites, solid_planes, limit: int, same_picture: bool = False) -> float:
    """Back sides where the bites opened something a player can now see from behind, within
    the budget.

    - a thin sheet (a roof's underside, a canopy, an awning, a board, a sign, a balcony slab,
      a wall whose neighbors went): seen through the hole from behind. It gets a reversed copy
      just behind it (BACK_GAP) in the dark inside color;
    - a broken-open face inside a bite: seen from behind wherever a solid has no surface of its
      own (under eaves, in a gable's overhang, an open hall). It gets a reversed copy of itself.
    Whether a face needs one is measured: rays from just behind it toward the viewer directions
    (`_seen_from_behind`). The biggest openings come first; what does not fit the budget is left
    out. Returns the area left out (m2)."""
    from mathutils.bvhtree import BVHTree
    faces = m.faces
    if not faces:
        return 0.0
    verts, tris = [], []
    for f in faces:
        o = len(verts)
        verts += [tuple(float(x) for x in p) for p in f.pts]
        tris += [(o, o + k, o + k + 1) for k in range(1, len(f.pts) - 1)]
    tree = BVHTree.FromPolygons(verts, tris, all_triangles=True, epsilon=0.0)
    extra = []
    for f in faces:
        base = _base(f.tag)
        if base == "interior":
            if f.area > 0.05 and _seen_from_behind(tree, f):
                extra.append(Face(_flip([p - f.normal * BACK_GAP for p in f.pts]), _flip(f.uv) if f.uv else None, f.col,
                                  f.tint, f.region, "interior"))
        elif (same_picture or base != "rubble") and f.area > 0.05 and _seen_from_behind(tree, f):
            if same_picture:
                extra.append(Face(_flip([p - f.normal * BACK_GAP for p in f.pts]), _flip(f.uv) if f.uv else None,
                                  f.col, f.tint, f.region, f.tag))
            else:
                extra.append(plain(_flip([p - f.normal * BACK_GAP for p in f.pts]), INSIDE, tag="interior"))
    extra.sort(key=lambda x: -x.area)
    room = limit - m.tris
    missing = 0.0
    for x in extra:
        t = len(x.pts) - 2
        if t <= room:
            m.faces.append(x)
            room -= t
        else:
            missing += x.area
    return missing


# ---- rubble --------------------------------------------------------------------------------
def _rock(rng, center, half, top_z, base_z=0.0) -> list:
    cx, cy = center
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            pts.append((cx + sx * half[0] * rng.uniform(0.7, 1.1), cy + sy * half[1] * rng.uniform(0.7, 1.1), base_z))
            pts.append((cx + sx * half[0] * rng.uniform(0.15, 0.6), cy + sy * half[1] * rng.uniform(0.15, 0.6),
                        base_z + (top_z - base_z) * rng.uniform(0.55, 1.0)))
    hh = hull(pts)
    return [] if hh is None else hull_faces(hh)


def rubble(b, limit: int) -> Mesh:
    W, D, H = b.W, b.D, b.H
    hh = min(max(0.08 * H + 0.8, 1.0), 9.0, 0.35 * H)
    small = limit <= 130
    for n_rocks, n_slabs, n_beams in ((6, 4, 3), (4, 3, 2), (3, 2, 1), (2, 2, 1), (1, 1, 0)):
        if small:
            n_rocks, n_slabs, n_beams = min(n_rocks, 3), min(n_slabs, 2), min(n_beams, 1)
        rng = np.random.default_rng(b.seed * 104729 + 7)
        m = Mesh()
        # the rubble texture is already grey: vertex colors only vary its brightness a little
        greys = [(1.0, 1.0, 1.0), (0.93, 0.93, 0.94), (1.06, 1.06, 1.06), (0.88, 0.88, 0.9)]
        greys = [tuple(min(1.0, c) for c in g) for g in greys]
        # the broken base: a low frustum of 7 sides inside the footprint
        n = 7
        ring0, ring1 = [], []
        for k in range(n):
            a = 2 * math.pi * (k + rng.uniform(-0.2, 0.2)) / n
            ring0.append((0.46 * W * math.cos(a) * rng.uniform(0.85, 1.0), 0.46 * D * math.sin(a) * rng.uniform(0.85, 1.0), 0.0))
            ring1.append((0.26 * W * math.cos(a) * rng.uniform(0.7, 1.1), 0.26 * D * math.sin(a) * rng.uniform(0.7, 1.1),
                          hh * rng.uniform(0.35, 0.5)))
        base = hull(ring0 + ring1)
        for poly, nrm in hull_faces(base):
            if nrm[2] < -0.5:
                continue
            m += _map_once(poly, "rubble", greys[int(rng.integers(4))])
        # rough mounds
        for _ in range(n_rocks):
            cx, cy = rng.uniform(-0.3, 0.3) * W, rng.uniform(-0.3, 0.3) * D
            half = (rng.uniform(0.1, 0.22) * W, rng.uniform(0.1, 0.22) * D)
            for poly, nrm in _rock(rng, (cx, cy), half, hh * rng.uniform(0.6, 1.0), base_z=hh * 0.15):
                if nrm[2] < -0.5:
                    continue
                m += _map_once(poly, "rubble", greys[int(rng.integers(4))])
        # slabs of the building's own facade lying on the heap
        walls = [f for f in b.intact.faces if f.tag == "wall" and f.region and f.area > 2.0]
        walls.sort(key=lambda f: -f.area)
        for k in range(min(n_slabs, len(walls))):
            src = walls[int(rng.integers(min(len(walls), 8)))]
            m += _slab(src, rng, W, D, hh)
        # bent beams
        for _ in range(n_beams):
            p0 = np.array([rng.uniform(-0.3, 0.3) * W, rng.uniform(-0.3, 0.3) * D, hh * 0.4])
            ang = rng.uniform(0, 2 * math.pi)
            ln = min(W, D) * rng.uniform(0.3, 0.5)
            p1 = p0 + np.array([math.cos(ang) * ln * 0.6, math.sin(ang) * ln * 0.6, ln * rng.uniform(0.4, 0.8)])
            m += _beam(p0, p1, 0.18 + 0.004 * H, style.RUST)
        top = m.bounds()[1][2]
        cap = min(0.33 * H, hh * 1.6)
        if top > cap:                       # squash, so the heap stays a low pile
            k = cap / top
            for f in m.faces:
                f.pts = [np.array([p[0], p[1], p[2] * k]) for p in f.pts]
        if b.keepsake is not None:
            m += b.keepsake.copy()
        # what can be seen from behind (a keepsake's thin frame, a slab's edge) gets a back side
        # with the same picture, within the budget
        if m.tris <= limit:
            _back_sides(m, [], [], limit, same_picture=True)
        lo, hi = m.bounds()
        if m.tris <= limit and lo[0] >= -W / 2 - 0.3 and hi[0] <= W / 2 + 0.3 and lo[1] >= -D / 2 - 0.3 and hi[1] <= D / 2 + 0.3:
            return m
    raise RuntimeError(f"{b.model}: rubble over budget ({m.tris} > {limit}) or outside the footprint")


def _map_once(poly, region, col, tag="rubble") -> list:
    """Map a polygon onto a region once (stretched, no repeats): one face, no extra cuts."""
    f = Face([np.asarray(p, float) for p in poly])
    u, v = face_axes(f.normal)
    s = [float(p @ u) for p in f.pts]
    t = [float(p @ v) for p in f.pts]
    return map_region(f.pts, region, col=col, tag=tag,
                      unit=(max(max(s) - min(s), 0.01) + 0.001, max(max(t) - min(t), 0.01) + 0.001),
                      origin=u * min(s) + v * min(t))


def _slab(src: Face, rng, W, D, hh) -> list:
    """A piece of a wall face (its own texture), lying tilted on the heap; back side grey."""
    u, v = face_axes(src.normal)
    s = [float(p @ u) for p in src.pts]
    t = [float(p @ v) for p in src.pts]
    sw = min(max(s) - min(s), rng.uniform(2.0, 4.5), 0.45 * min(W, D))
    th = min(max(t) - min(t), rng.uniform(1.8, 3.5), 0.4 * min(W, D))
    s0 = rng.uniform(min(s), max(s) - sw)
    t0 = rng.uniform(min(t), max(t) - th)
    origin_plane = src.pts[0] - u * float(src.pts[0] @ u) - v * float(src.pts[0] @ v)
    corners3d = [origin_plane + u * a + v * c for a, c in ((s0, t0), (s0 + sw, t0), (s0 + sw, t0 + th), (s0, t0 + th))]
    fuv = affine_uv(src)
    u0, v0, u1, v1 = region_uv_bounds(src.region)
    uvs = [fuv(p) for p in corners3d]
    uvs = [(min(max(a, u0), u1), min(max(c, v0), v1)) for a, c in uvs]
    # lay it down: local frame, tilted
    yaw = rng.uniform(0, 2 * math.pi)
    tilt = math.radians(rng.uniform(12, 35))
    ex = np.array([math.cos(yaw), math.sin(yaw), 0.0])
    ey = np.array([-math.sin(yaw) * math.cos(tilt), math.cos(yaw) * math.cos(tilt), math.sin(tilt)])
    c = np.array([rng.uniform(-0.25, 0.25) * W, rng.uniform(-0.25, 0.25) * D, hh * rng.uniform(0.45, 0.75)])
    loc = [(-sw / 2, -th / 2), (sw / 2, -th / 2), (sw / 2, th / 2), (-sw / 2, th / 2)]
    pts = [c + ex * a + ey * bb for a, bb in loc]
    top = Face(pts, uvs, tuple(x * 0.9 for x in src.col), src.tint, src.region, "rubble")
    if top.normal[2] < 0:
        top.pts.reverse()
        top.uv.reverse()
    back = Face([p - top.normal * 0.02 for p in reversed(top.pts)])
    out = [top]
    out += map_region(back.pts, "rubble", col=(0.85, 0.85, 0.85), tag="rubble",
                      unit=(sw + 0.01, th + 0.01))
    return out


def _beam(p0, p1, r, color) -> list:
    d = p1 - p0
    d = d / np.linalg.norm(d)
    a = np.cross(d, [0, 0, 1.0])
    if np.linalg.norm(a) < 1e-6:
        a = np.array([1.0, 0, 0])
    a /= np.linalg.norm(a)
    bvec = np.cross(d, a)
    ring = [a * r, bvec * r, -a * r, -bvec * r]
    out = []
    for k in range(4):
        q = [p0 + ring[k], p0 + ring[(k + 1) % 4], p1 + ring[(k + 1) % 4], p1 + ring[k]]
        f = Face(q)
        if f.normal @ (ring[k] + ring[(k + 1) % 4]) < 0:
            q.reverse()
        out.append(plain(q, color, tag="rubble"))
    return out


# ---- chunks -------------------------------------------------------------------------------
def _grid(b, target, rng):
    lo, hi = b.intact.bounds()
    size = hi - lo
    vol = float(np.prod(np.maximum(size, 0.5)))
    s = (vol / target) ** (1 / 3)
    counts = [max(1, int(round(size[i] / s))) for i in range(3)]
    while np.prod(counts) > budgets.CHUNKS[1]:
        i = int(np.argmax([-size[k] / counts[k] if counts[k] > 1 else -1e9 for k in range(3)]))
        counts[i] -= 1
    while np.prod(counts) < budgets.CHUNKS[0]:
        i = int(np.argmax([size[k] / counts[k] for k in range(3)]))
        counts[i] += 1
    cuts = []
    for i in range(3):
        n = counts[i]
        step = size[i] / n
        c = [lo[i]] + [lo[i] + step * (k + rng.uniform(-0.18, 0.18)) for k in range(1, n)] + [hi[i]]
        cuts.append(c)
    return cuts


def chunks(b) -> list:
    rng = np.random.default_rng(b.seed * 31 + 5)
    if b.landmark:
        target = 20
    else:
        lim = budgets.budget(b.id)
        target = 8 if lim <= 120 else (12 if lim <= 250 else 18)
    solids = [s for s in b.solids if hull(s) is not None]
    planes_of = [hull_planes(hull(s)) for s in solids]
    src_faces = [f for f in b.intact.faces if f.area > 0.01]
    src_info = []
    for f in src_faces:
        n = f.normal
        u, v = face_axes(n)
        poly2 = np.array([(float(p @ u), float(p @ v)) for p in f.pts])
        src_info.append((f, n, float(n @ f.pts[0]), u, v, poly2))
    for attempt in range(6):
        cuts = _grid(b, target, rng)
        out = []
        for k in range(len(cuts[2]) - 1):
            for j in range(len(cuts[1]) - 1):
                for i in range(len(cuts[0]) - 1):
                    lo = np.array([cuts[0][i], cuts[1][j], cuts[2][k]])
                    hi = np.array([cuts[0][i + 1], cuts[1][j + 1], cuts[2][k + 1]])
                    piece = _cell(lo, hi, solids, planes_of, src_info)
                    if piece is not None:
                        out.append(piece)
        if budgets.CHUNKS[0] <= len(out) <= budgets.CHUNKS[1]:
            return out
        target = target + 4 if len(out) < budgets.CHUNKS[0] else target - 4
    raise RuntimeError(f"{b.model}: could not cut {budgets.CHUNKS[0]}..{budgets.CHUNKS[1]} chunks (got {len(out)})")


def _cell(lo, hi, solids, planes_of, src_info) -> Mesh | None:
    planes_b = [(np.array([1.0, 0, 0]), hi[0]), (np.array([-1.0, 0, 0]), -lo[0]),
                (np.array([0, 1.0, 0]), hi[1]), (np.array([0, -1.0, 0]), -lo[1]),
                (np.array([0, 0, 1.0]), hi[2]), (np.array([0, 0, -1.0]), -lo[2])]
    corners = [np.array([x, y, z]) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    hulls = []
    for s, pl in zip(solids, planes_of):
        h = convex_intersection(s, planes_b, corners, planes_a=pl)
        if h is not None and h.volume > 0.02 * np.prod(hi - lo) * 0.05 and h.volume > 0.05:
            hulls.append(h)
    if not hulls:
        return None
    total_vol = sum(h.volume for h in hulls)
    if total_vol < 0.04 * float(np.prod(hi - lo)):
        return None

    def build(hs):
        m = Mesh()
        for h in hs:
            for poly, n in hull_faces(h):
                m += _texture(poly, n, src_info)
        return m

    m = build(hulls)
    if m.tris > budgets.CHUNK_TRIS:
        merged = hull(np.vstack([h.points[h.vertices] for h in hulls]))
        m = build([merged]) if merged is not None else m
    if m.tris > budgets.CHUNK_TRIS:
        pts = m.points()
        l2, h2 = pts.min(axis=0), pts.max(axis=0)
        boxh = hull([np.array([x, y, z]) for x in (l2[0], h2[0]) for y in (l2[1], h2[1]) for z in (l2[2], h2[2])])
        m = build([boxh])
    return m


def _texture(poly, n, src_info) -> list:
    c = np.mean(poly, axis=0)
    best, best_d = None, 1e9
    for f, fn, fd, u, v, poly2 in src_info:
        if fn @ n < 0.995 or abs(fn @ c - fd) > 0.08:
            continue
        p2 = np.array([float(c @ u), float(c @ v)])
        if _inside(p2, poly2):
            best, best_d = f, 0.0
            break
        dd = float(np.min(np.linalg.norm(poly2 - p2, axis=1)))
        if dd < best_d:
            best, best_d = f, dd
    if best is None or best_d > 0.6:
        return _map_once(poly, "rubble", (1.0, 1.0, 1.0), tag="cut")
    if best.uv is None or best.region is None:
        return [plain(poly, best.col, tag=best.tag)]
    fuv = affine_uv(best)
    u0, v0, u1, v1 = region_uv_bounds(best.region)
    uvs = [fuv(p) for p in poly]
    uvs = [(min(max(a, u0), u1), min(max(bb, v0), v1)) for a, bb in uvs]
    return [Face([np.asarray(p, float) for p in poly], uvs, best.col, best.tint, best.region, best.tag)]


def _inside(p, poly) -> bool:
    x, y = p
    inside = False
    k = len(poly)
    for i in range(k):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % k]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                inside = not inside
    return inside
