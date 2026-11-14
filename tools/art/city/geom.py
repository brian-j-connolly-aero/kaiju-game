"""Polygons with atlas mapping, plane clipping and convex helpers for the city kit.

A `Mesh` is a list of `Face`s in the authoring frame (Blender: x = the building's left,
-y = its front, z = up; meters). Every face is drawn with the one `city_atlas` material:
faces without a picture map onto the atlas's white swatch and get their color from the
vertex color. Convert with `to_geo()` at export time.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from . import atlas, style

UP = np.array([0.0, 0.0, 1.0])
EPS = 1e-6


def hex_rgb(c) -> tuple:
    if isinstance(c, str):
        h = c.lstrip("#")
        return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return tuple(float(x) for x in c)


@dataclass
class Face:
    pts: list                      # np.array(3) each, counter-clockwise seen from outside
    uv: list | None = None         # Blender UV per corner (v up), or None = white swatch
    col: tuple = (1.0, 1.0, 1.0)   # sRGB 0..1, multiplies the atlas
    tint: bool = False             # COLOR_0 alpha 1: the client may re-tint this face
    region: str | None = None      # atlas region the uv points into
    tag: str = "detail"            # wall | roof | detail | cut | interior | rubble | glass
    cut: bool = False              # damaged state: a bite cut this face (it has an open edge)

    def copy(self) -> "Face":
        return Face([p.copy() for p in self.pts], list(self.uv) if self.uv else None, self.col,
                    self.tint, self.region, self.tag, self.cut)

    @property
    def normal(self) -> np.ndarray:
        n = np.zeros(3)
        k = len(self.pts)
        for i in range(k):
            a, b = self.pts[i], self.pts[(i + 1) % k]
            n += np.cross(a, b)
        ln = np.linalg.norm(n)
        return n / ln if ln > 1e-12 else np.array([0.0, 0.0, 1.0])

    @property
    def area(self) -> float:
        n = np.zeros(3)
        k = len(self.pts)
        for i in range(k):
            n += np.cross(self.pts[i], self.pts[(i + 1) % k])
        return float(np.linalg.norm(n)) / 2

    @property
    def center(self) -> np.ndarray:
        return np.mean(self.pts, axis=0)


@dataclass
class Mesh:
    faces: list = field(default_factory=list)

    def add(self, other) -> "Mesh":
        if isinstance(other, Mesh):
            self.faces.extend(f.copy() for f in other.faces)
        elif isinstance(other, Face):
            self.faces.append(other)
        else:
            self.faces.extend(other)
        return self

    def __iadd__(self, other):
        return self.add(other)

    def copy(self) -> "Mesh":
        return Mesh([f.copy() for f in self.faces])

    @property
    def tris(self) -> int:
        return sum(len(f.pts) - 2 for f in self.faces)

    def points(self) -> np.ndarray:
        return np.array([p for f in self.faces for p in f.pts]) if self.faces else np.zeros((1, 3))

    def bounds(self):
        p = self.points()
        return p.min(axis=0), p.max(axis=0)

    def move(self, x=0.0, y=0.0, z=0.0) -> "Mesh":
        d = np.array([x, y, z], float)
        for f in self.faces:
            f.pts = [p + d for p in f.pts]
        return self

    def transform(self, m3: np.ndarray, about=(0, 0, 0)) -> "Mesh":
        o = np.array(about, float)
        flip = np.linalg.det(m3) < 0
        for f in self.faces:
            f.pts = [m3 @ (p - o) + o for p in f.pts]
            if flip:
                f.pts.reverse()
                if f.uv:
                    f.uv.reverse()
        return self

    def rotz(self, deg: float, about=(0, 0, 0)) -> "Mesh":
        a = math.radians(deg)
        return self.transform(np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]]), about)

    def rotx(self, deg: float, about=(0, 0, 0)) -> "Mesh":
        a = math.radians(deg)
        return self.transform(np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]]), about)

    def roty(self, deg: float, about=(0, 0, 0)) -> "Mesh":
        a = math.radians(deg)
        return self.transform(np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]]), about)

    def mirror_x(self) -> "Mesh":
        return self.transform(np.diag([-1.0, 1.0, 1.0]))

    def paint(self, color, where=None) -> "Mesh":
        c = hex_rgb(color)
        for f in self.faces:
            if where is None or where(f):
                f.col = c
        return self

    def shade(self, k: float, where=None) -> "Mesh":
        for f in self.faces:
            if where is None or where(f):
                f.col = tuple(min(1.0, x * k) for x in f.col)
        return self


# ---- UV helpers --------------------------------------------------------------------------
def white_uv(n: int) -> list:
    r = atlas.region("white")
    u, v = r.uv(r.w / 2, r.h / 2)
    return [(u, v)] * n


def swatch_uv(name: str, n: int) -> list:
    r = atlas.region(name)
    u, v = r.uv(r.w / 2, r.h / 2)
    return [(u, v)] * n


def face_axes(n: np.ndarray):
    """(image right, image up) for a face: walls upright, roofs with up toward the back."""
    if abs(n[2]) < 0.999:
        u = np.cross(UP, n)
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        if abs(n[2]) > 0.7 and n[2] < 0:
            v = -v
        return u, v / np.linalg.norm(v)
    return np.array([1.0, 0.0, 0.0]), np.array([0.0, 1.0 if n[2] > 0 else -1.0, 0.0])


# ---- clipping ----------------------------------------------------------------------------
def clip(face: Face, n, d, keep_below=True) -> Face | None:
    """The part of `face` with n.p <= d (keep_below) or n.p >= d. UVs are interpolated."""
    n = np.asarray(n, float)
    s = 1.0 if keep_below else -1.0
    pts, uvs = face.pts, face.uv
    out_p, out_uv = [], []
    k = len(pts)
    dist = [s * (float(n @ p) - d) for p in pts]
    for i in range(k):
        j = (i + 1) % k
        a, b = dist[i], dist[j]
        if a <= EPS:
            out_p.append(pts[i])
            if uvs:
                out_uv.append(uvs[i])
        if (a < -EPS and b > EPS) or (a > EPS and b < -EPS):
            t = a / (a - b)
            out_p.append(pts[i] + (pts[j] - pts[i]) * t)
            if uvs:
                out_uv.append((uvs[i][0] + (uvs[j][0] - uvs[i][0]) * t, uvs[i][1] + (uvs[j][1] - uvs[i][1]) * t))
    # drop duplicate neighbors
    cp, cu = [], []
    for i, p in enumerate(out_p):
        if cp and np.linalg.norm(p - cp[-1]) < 1e-5:
            continue
        cp.append(p)
        if uvs:
            cu.append(out_uv[i])
    if len(cp) > 1 and np.linalg.norm(cp[0] - cp[-1]) < 1e-5:
        cp.pop()
        if uvs:
            cu.pop()
    if len(cp) < 3:
        return None
    f = Face(cp, cu if uvs else None, face.col, face.tint, face.region, face.tag, face.cut)
    if f.area < 1e-4:
        return None
    return f


def subtract_convex(face: Face, planes) -> list:
    """`face` minus a convex volume given as outward planes [(n, d)] (inside: n.p <= d for all)."""
    out, rest = [], face
    for n, d in planes:
        if rest is None:
            break
        outside = clip(rest, n, d, keep_below=False)
        if outside is not None:
            out.append(outside)
        rest = clip(rest, n, d, keep_below=True)
    return out


def intersect_convex(face: Face, planes) -> Face | None:
    f = face
    for n, d in planes:
        if f is None:
            return None
        f = clip(f, n, d, keep_below=True)
    return f


def box_planes(center, half, rot_deg=0.0, tilt=(0.0, 0.0)):
    """Outward planes of a box (half sizes), turned by rot_deg about z and tilted (x, y)."""
    a = math.radians(rot_deg)
    rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    tx, ty = (math.radians(t) for t in tilt)
    rx = np.array([[1, 0, 0], [0, math.cos(tx), -math.sin(tx)], [0, math.sin(tx), math.cos(tx)]])
    ry = np.array([[math.cos(ty), 0, math.sin(ty)], [0, 1, 0], [-math.sin(ty), 0, math.cos(ty)]])
    m = rz @ rx @ ry
    c = np.asarray(center, float)
    planes = []
    for axis in range(3):
        for sgn in (1.0, -1.0):
            n = m[:, axis] * sgn
            planes.append((n, float(n @ c) + half[axis]))
    return planes, m


def box_faces(center, half, m) -> list:
    """The six faces of a (rotated) box, outward, as point lists."""
    c = np.asarray(center, float)
    hx, hy, hz = half
    corners = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                corners[(sx, sy, sz)] = c + m @ np.array([sx * hx, sy * hy, sz * hz])
    quads = [
        [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)],
        [(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)],
        [(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)],
        [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],
        [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)],
        [(-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)],
    ]
    return [[corners[k] for k in q] for q in quads]


# ---- mapping a planar polygon onto a region ------------------------------------------------
def map_region(pts, region_name: str, *, col=(1, 1, 1), tint=False, tag="wall", origin=None,
               u_axis=None, v_axis=None, unit=None, inset=0.5) -> list:
    """Cut a planar convex polygon at the region's repeats and map every piece.

    unit = (meters per region repeat across, meters per repeat up). Defaults: a facade repeats
    every (bays x 3 m, storeys x 3 m) [pass unit to stretch to whole bays]; a texture every
    (w, h) pixels x 0.1875 m; a picture is stretched once over the polygon.
    origin: the point where the region's bottom-left corner sits (default: the polygon's
    lower left in its own axes), so neighboring walls can line up.
    """
    r = atlas.region(region_name)
    pts = [np.asarray(p, float) for p in pts]
    f0 = Face(pts)
    n = f0.normal
    u_ax, v_ax = face_axes(n)
    if u_axis is not None:
        u_ax = np.asarray(u_axis, float)
    if v_axis is not None:
        v_ax = np.asarray(v_axis, float)
    s = [float(p @ u_ax) for p in pts]
    t = [float(p @ v_ax) for p in pts]
    if origin is not None:
        o = np.asarray(origin, float)
        s0, t0 = float(o @ u_ax), float(o @ v_ax)
    else:
        s0, t0 = min(s), min(t)
    if r.kind == "picture" or r.kind == "swatch":
        su, sv = (max(s) - min(s)) or 1.0, (max(t) - min(t)) or 1.0
        s0, t0 = min(s), min(t)
    elif unit is not None:
        su, sv = unit
    elif r.kind == "facade":
        su, sv = r.bays * style.BAY, r.storeys * (style.STOREY if r.storey_px == 16 else style.GROUND)
    else:
        su, sv = r.w * style.PX, r.h * style.PX
    out = []
    k0, k1 = math.floor((min(s) - s0) / su + 1e-6), math.ceil((max(s) - s0) / su - 1e-6)
    m0, m1 = math.floor((min(t) - t0) / sv + 1e-6), math.ceil((max(t) - t0) / sv - 1e-6)
    base = Face(pts, None, hex_rgb(col), tint, region_name, tag)
    for k in range(k0, max(k1, k0 + 1)):
        strip = clip(base, u_ax, s0 + (k + 1) * su, True)
        strip = clip(strip, u_ax, s0 + k * su, False) if strip else None
        if strip is None:
            continue
        for m in range(m0, max(m1, m0 + 1)):
            piece = clip(strip, v_ax, t0 + (m + 1) * sv, True)
            piece = clip(piece, v_ax, t0 + m * sv, False) if piece else None
            if piece is None:
                continue
            uv = []
            for p in piece.pts:
                fs = (float(p @ u_ax) - s0) / su - k
                ft = (float(p @ v_ax) - t0) / sv - m
                fs, ft = min(max(fs, 0.0), 1.0), min(max(ft, 0.0), 1.0)
                px = inset + fs * (r.w - 2 * inset)
                py = r.h - inset - ft * (r.h - 2 * inset)
                uv.append(r.uv(px, py))
            piece.uv = uv
            out.append(piece)
    return out


def plain(pts, col, tag="detail", tint=False, swatch="white") -> Face:
    pts = [np.asarray(p, float) for p in pts]
    return Face(pts, swatch_uv(swatch, len(pts)), hex_rgb(col), tint, swatch, tag)


def affine_uv(face: Face):
    """A function p -> uv that reproduces the face's own planar mapping (for re-cut pieces)."""
    if not face.uv or len(face.pts) < 3:
        return None
    n = face.normal
    u_ax, v_ax = face_axes(n)
    P = np.array([[float(p @ u_ax), float(p @ v_ax), 1.0] for p in face.pts])
    U = np.array(face.uv)
    coef, *_ = np.linalg.lstsq(P, U, rcond=None)

    def f(p):
        q = np.array([float(p @ u_ax), float(p @ v_ax), 1.0]) @ coef
        return float(q[0]), float(q[1])
    return f


def region_uv_bounds(name: str):
    r = atlas.region(name)
    u0, v1 = r.uv(0.5, 0.5)
    u1, v0 = r.uv(r.w - 0.5, r.h - 0.5)
    return u0, v0, u1, v1


def shift_to_twin(face: Face) -> None:
    """Point a face's texture at its region's damaged twin (same layout)."""
    if not face.region or not face.uv:
        return
    r = atlas.region(face.region)
    if not r.twin:
        return
    tw = atlas.region(r.twin)
    du, dv = (tw.x - r.x) / atlas.W, -(tw.y - r.y) / atlas.H
    face.uv = [(u + du, v + dv) for u, v in face.uv]
    face.region = r.twin


# ---- convex solids -----------------------------------------------------------------------
def hull(points):
    """scipy ConvexHull of points, or None when they are flat."""
    from scipy.spatial import ConvexHull
    pts = np.unique(np.round(np.asarray(points, float), 5), axis=0)
    if len(pts) < 4:
        return None
    try:
        return ConvexHull(pts)
    except Exception:
        return None


def hull_planes(h) -> list:
    """Outward planes (n, d) with inside n.p <= d."""
    planes = []
    seen = []
    for eq in h.equations:
        n, off = eq[:3], eq[3]
        key = np.round(np.append(n, off), 4)
        if any(np.allclose(key, s) for s in seen):
            continue
        seen.append(key)
        planes.append((n.copy(), float(-off)))
    return planes


def convex_intersection(points_a, planes_b, corners_b, planes_a=None):
    """Vertices of hull(points_a) intersected with a convex region (planes_b, its corners)."""
    ha = hull(points_a)
    if ha is None:
        return None
    pa = planes_a or hull_planes(ha)
    va = ha.points[ha.vertices]
    cand = [p for p in va if all(n @ p <= d + 1e-6 for n, d in planes_b)]
    cand += [p for p in corners_b if all(n @ p <= d + 1e-6 for n, d in pa)]
    edges = set()
    for simplex in ha.simplices:
        for i in range(3):
            a, b = sorted((simplex[i], simplex[(i + 1) % 3]))
            edges.add((a, b))
    for a, b in edges:
        p, q = ha.points[a], ha.points[b]
        for n, d in planes_b:
            dp, dq = n @ p - d, n @ q - d
            if dp * dq < 0:
                x = p + (q - p) * (dp / (dp - dq))
                if all(n2 @ x <= d2 + 1e-6 for n2, d2 in planes_b) and all(n2 @ x <= d2 + 1e-6 for n2, d2 in pa):
                    cand.append(x)
    # box edges against hull planes
    cb = np.asarray(corners_b)
    for i in range(len(cb)):
        for j in range(i + 1, len(cb)):
            p, q = cb[i], cb[j]
            if sum(abs(p - q) > 1e-9) != 1:
                continue
            for n, d in pa:
                dp, dq = n @ p - d, n @ q - d
                if dp * dq < 0:
                    x = p + (q - p) * (dp / (dp - dq))
                    if all(n2 @ x <= d2 + 1e-6 for n2, d2 in planes_b) and all(n2 @ x <= d2 + 1e-6 for n2, d2 in pa):
                        cand.append(x)
    if len(cand) < 4:
        return None
    return hull(cand)


def hull_faces(h) -> list:
    """Hull triangles wound outward: [(points, normal)]. Triangles, so never bent."""
    out = []
    for simplex, eq in zip(h.simplices, h.equations):
        n = np.array(eq[:3])
        poly = [h.points[i] for i in simplex]
        if np.cross(poly[1] - poly[0], poly[2] - poly[0]) @ n < 0:
            poly.reverse()
        if np.linalg.norm(np.cross(poly[1] - poly[0], poly[2] - poly[0])) < 1e-6:
            continue
        out.append((poly, n))
    return out
