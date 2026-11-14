"""mb: the Monster Battle 9001 model-building kit for Blender scripts.

Run scripts with /opt/mbtools/venv/bin/python (Blender 5.2 as the `bpy` module).
Read tools/art/README.md first; this docstring is the short version.

AXES (authoring happens in Blender's frame, the exporter converts):

    Blender (you write this)        glTF / the game (what the file contains)
    up       +Z                     up       +Y
    forward  -Y   (model's nose)    forward  +Z
    left     +X   (model's left)    left     +X

    So a point (x, y, z) you write lands in the file as (x, z, -y).
    Use the constants FWD, BACK, UP, DOWN, LEFT, RIGHT instead of remembering signs.

WORKFLOW:

    g = mb.box((0.4, 0.4, 0.6), at=(0, 0, 0.3), color="red")     # geometry lives in model space
    g += mb.cone(8, 0.2, 0.3, color="red_dk").move(0, 0, 0.6)
    mb.node("prop_hydrant", g)                                    # becomes a named glTF node
    mb.export_glb("prop_hydrant")                                 # client/public/assets/models/
    mb.contact_sheet("prop_hydrant")                              # docs/art/previews/
    mb.concept("prop_hydrant")                                    # docs/art/concept/

    or let the family runner do export, validation, previews and the manifest:

    @mb.asset("prop_hydrant", kind="prop")
    def hydrant(): ...build nodes...
    mb.run_family("props")
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import random
import sys
import time

import bpy
from mathutils import Matrix, Vector

_LIB = os.path.dirname(os.path.abspath(__file__))
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

import contract  # noqa: E402
import glb as glbfile  # noqa: E402
import palette  # noqa: E402
from contract import (ASSETS, CONCEPT, MAT_ATLAS, MAT_GLOW, MAT_VCOL, MATERIALS, MODELS,  # noqa: E402,F401
                      PREVIEWS, REPO, TEXTURES)
from palette import C, PALETTE, mix, shade  # noqa: E402,F401

# ---- directions in the authoring (Blender) frame ----------------------------------------
FWD = Vector((0.0, -1.0, 0.0))      # the way the model faces (glTF +Z)
BACK = Vector((0.0, 1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))        # glTF +Y
DOWN = Vector((0.0, 0.0, -1.0))
LEFT = Vector((1.0, 0.0, 0.0))      # the model's own left (glTF +X)
RIGHT = Vector((-1.0, 0.0, 0.0))

COLOR_ATTR = "Color"                # exported as COLOR_0
UV_LAYER = "UVMap"                  # exported as TEXCOORD_0
ATLAS_GRID = (8, 8)                 # default (cols, rows) of the shared city atlas; the city
                                    # family sets this to the real grid of textures/city_atlas.png

_EPS = 1e-7


def V(*a) -> Vector:
    """Vector from 3 numbers or one sequence."""
    if len(a) == 1:
        a = a[0]
    return Vector((float(a[0]), float(a[1]), float(a[2])))


def to_gltf(p) -> tuple[float, float, float]:
    """Authoring-frame point -> glTF-frame point: (x, y, z) -> (x, z, -y)."""
    return (float(p[0]), float(p[2]), -float(p[1]))


def from_gltf(p) -> Vector:
    """glTF-frame point -> authoring-frame point: (x, y, z) -> (x, -z, y)."""
    return Vector((float(p[0]), -float(p[2]), float(p[1])))


def dist(a, b) -> float:
    return (V(b) - V(a)).length


def lerp(a, b, t: float) -> Vector:
    return V(a).lerp(V(b), t)


@contextlib.contextmanager
def quiet():
    """Silence Blender's console chatter (exporter and renderer logs). MB_VERBOSE=1 keeps it."""
    if os.environ.get("MB_VERBOSE"):
        yield
        return
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    null = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(null, 1)
        os.dup2(null, 2)
        yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        for fd in (*saved, null):
            os.close(fd)


# =========================================================================================
# Geo: polygons in model space, each with a color, a material and optional UVs
# =========================================================================================
class Geo:
    """A bag of flat polygons. Builders return one; `+` merges; transforms chain.

    Everything is in model space (meters), exactly where the part sits in the rest pose.
    Transform methods change the Geo in place and return it, so they chain:
        mb.box((1, 1, 1)).rz(45).move(0, -2, 0.5)
    Use .copy() first if you need to keep the original.
    """

    __slots__ = ("v", "f", "col", "mat", "uv")

    def __init__(self):
        self.v: list[Vector] = []
        self.f: list[tuple[int, ...]] = []
        self.col: list[tuple[float, float, float]] = []   # sRGB 0..1 per face
        self.mat: list[str] = []                           # material name per face
        self.uv: list[list[tuple[float, float]] | None] = []  # per face: one (u, v) per corner

    # ---- construction -------------------------------------------------------------------
    def face(self, points, color="white", mat=MAT_VCOL, uv=None) -> "Geo":
        """Add one polygon from 3 or more points, counter-clockwise seen from outside."""
        pts = [V(p) for p in points]
        keep = []
        for i, p in enumerate(pts):
            if not keep or (p - keep[-1][1]).length > 1e-6:
                keep.append((i, p))
        if len(keep) > 1 and (keep[0][1] - keep[-1][1]).length <= 1e-6:
            keep.pop()
        if len(keep) < 3:
            return self            # collapsed to a line or point (cone tips etc.): skip
        base = len(self.v)
        self.v.extend(p for _, p in keep)
        self.f.append(tuple(range(base, base + len(keep))))
        self.col.append(palette.rgb(color))
        self.mat.append(_check_mat(mat))
        self.uv.append([tuple(uv[i]) for i, _ in keep] if uv is not None else None)
        return self

    def add(self, other: "Geo") -> "Geo":
        """Merge another Geo into this one (in place)."""
        base = len(self.v)
        self.v.extend(p.copy() for p in other.v)
        self.f.extend(tuple(i + base for i in f) for f in other.f)
        self.col.extend(other.col)
        self.mat.extend(other.mat)
        self.uv.extend(list(u) if u is not None else None for u in other.uv)
        return self

    def __iadd__(self, other: "Geo") -> "Geo":
        return self.add(other)

    def __add__(self, other: "Geo") -> "Geo":
        return self.copy().add(other)

    def copy(self) -> "Geo":
        return Geo().add(self)

    # ---- measuring ----------------------------------------------------------------------
    @property
    def tris(self) -> int:
        """Triangle count after triangulation (a polygon with k corners is k - 2 triangles)."""
        return sum(len(f) - 2 for f in self.f)

    def bounds(self) -> tuple[Vector, Vector]:
        if not self.v:
            return Vector((0, 0, 0)), Vector((0, 0, 0))
        xs, ys, zs = zip(*((p.x, p.y, p.z) for p in self.v))
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

    def size(self) -> Vector:
        lo, hi = self.bounds()
        return hi - lo

    def center(self) -> Vector:
        lo, hi = self.bounds()
        return (lo + hi) / 2

    def face_center(self, i: int) -> Vector:
        f = self.f[i]
        c = Vector((0, 0, 0))
        for k in f:
            c += self.v[k]
        return c / len(f)

    def face_normal(self, i: int) -> Vector:
        f = self.f[i]
        n = Vector((0, 0, 0))
        for k in range(len(f)):       # Newell's method: works for any polygon
            a, b = self.v[f[k]], self.v[f[(k + 1) % len(f)]]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))

    def volume(self) -> float:
        """Signed volume. Positive for a closed shape whose faces point outward."""
        vol = 0.0
        for f in self.f:
            a = self.v[f[0]]
            for k in range(1, len(f) - 1):
                vol += a.dot(self.v[f[k]].cross(self.v[f[k + 1]])) / 6.0
        return vol

    def select(self, where=None) -> list[int]:
        """Face indices matching `where`:
        None (all) | "top" "bottom" "front" "back" "left" "right" "side" | a material name |
        a function (center, normal) -> bool | a list of face indices.
        Directions are the model's own: "front" faces have normals pointing forward (-Y)."""
        n = len(self.f)
        if where is None:
            return list(range(n))
        if callable(where):
            return [i for i in range(n) if where(self.face_center(i), self.face_normal(i))]
        if isinstance(where, str):
            if where in MATERIALS:
                return [i for i in range(n) if self.mat[i] == where]
            axes = {"top": UP, "bottom": DOWN, "front": FWD, "back": BACK, "left": LEFT, "right": RIGHT}
            if where == "side":
                return [i for i in range(n) if abs(self.face_normal(i).z) < 0.5]
            if where in axes:
                return [i for i in range(n) if self.face_normal(i).dot(axes[where]) > 0.5]
            raise ValueError(f"unknown face selector {where!r}")
        return [int(i) for i in where]

    # ---- transforms (in place, chainable) -----------------------------------------------
    def transform(self, m: Matrix) -> "Geo":
        """Apply a 4x4 matrix. A mirroring matrix flips the winding so faces stay outward."""
        for i, p in enumerate(self.v):
            self.v[i] = m @ p
        if m.to_3x3().determinant() < 0:
            self.flip()
        return self

    def move(self, *d) -> "Geo":
        d = V(*d)
        for p in self.v:
            p += d
        return self

    def rot(self, axis, degrees: float, about=(0, 0, 0)) -> "Geo":
        """Rotate around an axis ('x', 'y', 'z' or a vector) through the point `about`."""
        ax = {"x": Vector((1, 0, 0)), "y": Vector((0, 1, 0)), "z": Vector((0, 0, 1))}.get(axis) \
            if isinstance(axis, str) else V(axis)
        o = V(about)
        m = Matrix.Translation(o) @ Matrix.Rotation(math.radians(degrees), 4, ax) @ Matrix.Translation(-o)
        return self.transform(m)

    def rx(self, degrees: float, about=(0, 0, 0)) -> "Geo":
        return self.rot("x", degrees, about)

    def ry(self, degrees: float, about=(0, 0, 0)) -> "Geo":
        return self.rot("y", degrees, about)

    def rz(self, degrees: float, about=(0, 0, 0)) -> "Geo":
        return self.rot("z", degrees, about)

    def scale(self, sx: float, sy: float | None = None, sz: float | None = None, about=(0, 0, 0)) -> "Geo":
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        o = V(about)
        m = Matrix.Translation(o) @ Matrix.Diagonal((sx, sy, sz, 1.0)) @ Matrix.Translation(-o)
        return self.transform(m)

    def mirror_x(self) -> "Geo":
        """Mirror left <-> right across the model's center plane (in place)."""
        return self.scale(-1, 1, 1)

    def mirrored(self) -> "Geo":
        """A mirrored copy: build the left part, then  g += left.mirrored()."""
        return self.copy().mirror_x()

    def symmetric(self) -> "Geo":
        """This geometry plus its mirror image (in place)."""
        return self.add(self.mirrored())

    def flip(self) -> "Geo":
        """Reverse every face (turns the shape inside out)."""
        self.f = [tuple(reversed(f)) for f in self.f]
        self.uv = [list(reversed(u)) if u is not None else None for u in self.uv]
        return self

    def along(self, p0, p1, side=LEFT, stretch: bool = True) -> "Geo":
        """Stand a part built along +Z (from z = 0 upward) on the line p0 -> p1.

        Local +Z maps to the direction p0 -> p1, local +X stays as close to `side` as
        possible (default: the model's left, so widths stay widths). With stretch=True the
        part is scaled along its length so its top lands exactly on p1.
        """
        p0, p1 = V(p0), V(p1)
        d = p1 - p0
        length = d.length
        if length < 1e-9:
            return self.move(p0)
        z = d / length
        s = V(side)
        x = s - z * s.dot(z)
        if x.length < 1e-6:
            s = Vector((0, 1, 0)) if abs(z.y) < 0.9 else Vector((0, 0, 1))
            x = s - z * s.dot(z)
        x.normalize()
        y = z.cross(x)
        if stretch:
            top = max((p.z for p in self.v), default=0.0)
            if top > 1e-9:
                for p in self.v:
                    p.z *= length / top
        m = Matrix(((x.x, y.x, z.x, p0.x), (x.y, y.y, z.y, p0.y), (x.z, y.z, z.z, p0.z), (0, 0, 0, 1)))
        return self.transform(m)

    def on_ground(self) -> "Geo":
        """Move straight up or down so the lowest point sits on z = 0."""
        return self.move(0, 0, -self.bounds()[0].z)

    def triangulate(self, where=None) -> "Geo":
        """Split polygons into triangles (quads along the shorter diagonal).

        Same triangle count, but every triangle gets its own facet shading: use it on
        bent quads (lofts, organic shapes) for a crisp crystalline low-poly look.
        """
        chosen = set(self.select(where))
        nf, ncol, nmat, nuv = [], [], [], []
        for i, f in enumerate(self.f):
            if i not in chosen or len(f) == 3:
                tris = [tuple(range(len(f)))]
            elif len(f) == 4:
                d02 = (self.v[f[0]] - self.v[f[2]]).length
                d13 = (self.v[f[1]] - self.v[f[3]]).length
                tris = [(0, 1, 2), (0, 2, 3)] if d02 <= d13 else [(0, 1, 3), (1, 2, 3)]
            else:       # fan: fine for convex polygons
                tris = [(0, k, k + 1) for k in range(1, len(f) - 1)]
            for t in tris:
                nf.append(tuple(f[k] for k in t))
                ncol.append(self.col[i])
                nmat.append(self.mat[i])
                nuv.append([self.uv[i][k] for k in t] if self.uv[i] is not None else None)
        self.f, self.col, self.mat, self.uv = nf, ncol, nmat, nuv
        return self

    # ---- color --------------------------------------------------------------------------
    def paint(self, color, where=None) -> "Geo":
        """Set the color of the selected faces (see select() for `where`)."""
        c = palette.rgb(color)
        for i in self.select(where):
            self.col[i] = c
        return self

    def material(self, mat: str, where=None) -> "Geo":
        """Set the material ("vcol", "glow" or "city_atlas") of the selected faces."""
        mat = _check_mat(mat)
        for i in self.select(where):
            self.mat[i] = mat
        return self

    def glow(self, color=None, where=None) -> "Geo":
        """Make the selected faces glow (material `glow`), optionally recoloring them."""
        if color is not None:
            self.paint(color, where)
        return self.material(MAT_GLOW, where)

    def recolor(self, fn, where=None) -> "Geo":
        """fn(color_rgb, center, normal) -> new color, for each selected face."""
        for i in self.select(where):
            self.col[i] = palette.rgb(fn(self.col[i], self.face_center(i), self.face_normal(i)))
        return self

    def jitter(self, amount: float = 0.05, seed: int = 1, where=None) -> "Geo":
        """Vary each face's brightness by up to +/- amount so facets read as facets."""
        rng = random.Random(seed)
        for i in self.select(where):
            k = 1.0 + rng.uniform(-amount, amount)
            self.col[i] = tuple(min(1.0, c * k) for c in self.col[i])
        return self

    def bake_light(self, top: float = 1.08, bottom: float = 0.78, where=None) -> "Geo":
        """Paint in a little sky light: faces looking up get brighter, faces looking down darker."""
        for i in self.select(where):
            nz = self.face_normal(i).z
            k = 1.0 + (top - 1.0) * max(nz, 0.0) + (bottom - 1.0) * max(-nz, 0.0)
            self.col[i] = tuple(min(1.0, c * k) for c in self.col[i])
        return self

    def gradient(self, color_low, color_high, axis: str = "z", where=None) -> "Geo":
        """Blend two colors along an axis ('x', 'y' or 'z') over the selected faces' extent."""
        sel = self.select(where)
        if not sel:
            return self
        k = "xyz".index(axis)
        vals = [self.face_center(i)[k] for i in sel]
        lo, hi = min(vals), max(vals)
        a, b = palette.rgb(color_low), palette.rgb(color_high)
        for i, val in zip(sel, vals):
            t = (val - lo) / (hi - lo) if hi > lo else 0.0
            self.col[i] = tuple(x + (y - x) * t for x, y in zip(a, b))
        return self

    def stripes(self, color, axis: str = "y", period: float = 1.0, width: float = 0.4,
                offset: float = 0.0, where=None) -> "Geo":
        """Paint bands across an axis: faces whose center falls in a band get `color`."""
        k = "xyz".index(axis)
        c = palette.rgb(color)
        for i in self.select(where):
            if ((self.face_center(i)[k] - offset) / period) % 1.0 < width:
                self.col[i] = c
        return self

    # ---- UVs for the city atlas ---------------------------------------------------------
    def uv_fit(self, rect, where=None, together: bool = False, turns: int = 0, flip_u: bool = False,
               mat: str | None = MAT_ATLAS, color="white") -> "Geo":
        """Map the selected faces onto an atlas rectangle (see atlas_rect()).

        Each face is projected flat: on walls, image-up is world up and image-right is to
        the right of someone looking at the wall from outside; on roofs, image-up is the
        model's back. The face (or, with together=True, the whole selection) is stretched
        to fill `rect`. `turns` rotates the image in quarter turns. By default the faces
        also switch to the `city_atlas` material and turn white (pass mat=None to keep).
        """
        sel = self.select(where)
        if not sel:
            return self
        u0, v0, u1, v1 = rect
        proj: dict[int, list[tuple[float, float]]] = {}
        for i in sel:
            n = self.face_normal(i)
            if abs(n.z) < 0.7:
                ua = UP.cross(n).normalized()
                va = n.cross(ua).normalized()
            else:
                ua = Vector((1, 0, 0))
                va = Vector((0, 1, 0)) if n.z > 0 else Vector((0, -1, 0))
            proj[i] = [(self.v[k].dot(ua), self.v[k].dot(va)) for k in self.f[i]]
        groups = [sel] if together else [[i] for i in sel]
        for grp in groups:
            pts = [p for i in grp for p in proj[i]]
            lo_u, hi_u = min(p[0] for p in pts), max(p[0] for p in pts)
            lo_v, hi_v = min(p[1] for p in pts), max(p[1] for p in pts)
            for i in grp:
                out = []
                for pu, pv in proj[i]:
                    s = (pu - lo_u) / (hi_u - lo_u) if hi_u > lo_u else 0.5
                    t = (pv - lo_v) / (hi_v - lo_v) if hi_v > lo_v else 0.5
                    if flip_u:
                        s = 1.0 - s
                    for _ in range(turns % 4):
                        s, t = 1.0 - t, s
                    out.append((u0 + (u1 - u0) * s, v0 + (v1 - v0) * t))
                self.uv[i] = out
                if mat is not None:
                    self.mat[i] = _check_mat(mat)
                    self.col[i] = palette.rgb(color)
        return self

    # ---- from an existing Blender object ------------------------------------------------
    @staticmethod
    def from_object(obj) -> "Geo":
        """Read a mesh object back into model space (used for mirroring whole nodes)."""
        g = Geo()
        if obj.type != "MESH":
            return g
        me = obj.data
        origin = world_position(obj)
        g.v = [origin + v.co for v in me.vertices]
        colors = me.color_attributes.get(COLOR_ATTR)
        uvl = me.uv_layers.get(UV_LAYER)
        mats = [m.name if m else MAT_VCOL for m in me.materials] or [MAT_VCOL]
        for p in me.polygons:
            g.f.append(tuple(p.vertices))
            li = p.loop_indices[0]
            if colors is not None:
                c = colors.data[li].color
                g.col.append(tuple(palette.linear_to_srgb(x) for x in c[:3]))
            else:
                g.col.append((1.0, 1.0, 1.0))
            g.mat.append(mats[min(p.material_index, len(mats) - 1)])
            g.uv.append([tuple(uvl.data[k].uv) for k in p.loop_indices]
                        if uvl is not None and g.mat[-1] == MAT_ATLAS else None)
        return g


def _check_mat(mat: str) -> str:
    if mat not in MATERIALS:
        raise ValueError(f"material must be one of {MATERIALS}, got {mat!r}")
    return mat


# =========================================================================================
# Builders (all return a new Geo; sizes are meters; (x, y, z) = (width, depth, height))
# =========================================================================================
def _rings(rings, color, mat, cap_start=True, cap_end=True, colors=None) -> Geo:
    """Skin a sequence of rings (lists of points, same count) with outward-facing quads."""
    g = Geo()
    rings = [[V(p) for p in r] for r in rings]
    if len(rings) < 2:
        return g
    n = len(rings[0])

    def centroid(r):
        c = Vector((0, 0, 0))
        for p in r:
            c += p
        return c / len(r)

    def newell(r):
        nrm = Vector((0, 0, 0))
        for k in range(len(r)):
            a, b = r[k], r[(k + 1) % len(r)]
            nrm.x += (a.y - b.y) * (a.z + b.z)
            nrm.y += (a.z - b.z) * (a.x + b.x)
            nrm.z += (a.x - b.x) * (a.y + b.y)
        return nrm

    # Decide once whether the rings run counter-clockwise seen from the far end.
    travel = centroid(rings[-1]) - centroid(rings[0])
    flip = False
    for r in rings:
        nrm = newell(r)
        if nrm.length > 1e-9 and travel.length > 1e-9:
            flip = nrm.dot(travel) < 0
            break
    for s in range(len(rings) - 1):
        a, b = rings[s], rings[s + 1]
        col = colors[s] if colors is not None else color
        for i in range(n):
            j = (i + 1) % n
            quad = [a[i], a[j], b[j], b[i]]
            g.face(reversed(quad) if flip else quad, col, mat)
    if cap_start:
        g.face(rings[0] if flip else list(reversed(rings[0])), colors[0] if colors is not None else color, mat)
    if cap_end:
        g.face(list(reversed(rings[-1])) if flip else rings[-1], colors[-1] if colors is not None else color, mat)
    return g


_ANCHORS = {
    "center": (0, 0, 0), "bottom": (0, 0, 1), "top": (0, 0, -1), "front": (0, 1, 0), "back": (0, -1, 0),
    "left": (-1, 0, 0), "right": (1, 0, 0),
}


def box(size, at=(0, 0, 0), color="white", mat=MAT_VCOL, anchor: str = "center") -> Geo:
    """Axis-aligned box. size = (width x, depth y, height z).

    `anchor` says which part of the box sits on `at`: "center" (default), "bottom" (stands
    on the point), "top", "front", "back", "left", "right".
    """
    sx, sy, sz = (float(s) for s in size)
    ax, ay, az = _ANCHORS[anchor]
    c = V(at) + Vector((ax * sx / 2, ay * sy / 2, az * sz / 2))
    return tapered_box((sx, sy), (sx, sy), sz, at=(c.x, c.y, c.z - sz / 2), color=color, mat=mat)


def tapered_box(bottom, top, height: float, at=(0, 0, 0), offset=(0, 0), color="white",
                mat=MAT_VCOL, cap_bottom: bool = True, cap_top: bool = True) -> Geo:
    """Box whose top rectangle differs from its bottom one. Stands on `at`, grows up +Z.

    bottom, top = (width x, depth y); offset = (x, y) shift of the top rectangle.
    A top of (0, 0) gives a pyramid; (w, 0) or (0, d) gives a roof ridge.
    cap_bottom=False / cap_top=False leave an end open: saves 2 triangles where it is hidden.
    """
    o = V(at)

    def rect(w, d, z, ox=0.0, oy=0.0):
        return [o + Vector((ox - w / 2, oy - d / 2, z)), o + Vector((ox + w / 2, oy - d / 2, z)),
                o + Vector((ox + w / 2, oy + d / 2, z)), o + Vector((ox - w / 2, oy + d / 2, z))]

    return _rings([rect(bottom[0], bottom[1], 0.0), rect(top[0], top[1], height, offset[0], offset[1])],
                  color, mat, cap_bottom, cap_top)


def pyramid(base, height: float, at=(0, 0, 0), color="white", mat=MAT_VCOL) -> Geo:
    """Four-sided pyramid standing on `at`. base = (width x, depth y)."""
    return tapered_box(base, (0, 0), height, at=at, color=color, mat=mat)


def wedge(size, at=(0, 0, 0), high: str = "back", color="white", mat=MAT_VCOL) -> Geo:
    """Ramp: a box cut diagonally. Stands on `at` (center of its footprint).

    size = (width x, depth y, height z); `high` names the tall side: "back", "front",
    "left" or "right". wedge(high="back") slopes down toward the model's front.
    """
    sx, sy, sz = (float(s) for s in size)
    turn = {"back": 0, "left": -90, "front": 180, "right": 90}[high]
    if turn in (90, -90):
        sx, sy = sy, sx          # built with the tall side at the back, then turned
    pts = [(-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0),
           (sx / 2, sy / 2, sz), (-sx / 2, sy / 2, sz)]
    g = Geo()
    for idx in ((0, 3, 2, 1), (0, 1, 4, 5), (2, 3, 5, 4), (1, 2, 4), (3, 0, 5)):
        g.face([pts[i] for i in idx], color, mat)
    return g.rz(turn).move(at)


def ring(n: int, radius, z: float = 0.0, phase: float | None = None, center=(0, 0)) -> list[Vector]:
    """n points on a circle (or ellipse: radius=(rx, ry)) in the horizontal plane at height z.

    Counter-clockwise seen from above. With phase=None a flat side faces the model's front;
    phase is the angle in degrees of the first point, measured from +X toward +Y.
    """
    rx, ry = (radius, radius) if isinstance(radius, (int, float)) else radius
    ph = math.radians(-90.0 + 180.0 / n if phase is None else phase)
    return [Vector((center[0] + rx * math.cos(ph + 2 * math.pi * k / n),
                    center[1] + ry * math.sin(ph + 2 * math.pi * k / n), z)) for k in range(n)]


def prism(n: int, radius, height: float, radius_top=None, at=(0, 0, 0), phase: float | None = None,
          color="white", mat=MAT_VCOL, cap_bottom: bool = True, cap_top: bool = True) -> Geo:
    """Upright n-sided prism standing on `at` (a cylinder for large n).

    radius is the distance from the axis to the corners; give (rx, ry) for an ellipse.
    radius_top makes it a taper; radius_top=0 makes a cone.
    """
    rt = radius if radius_top is None else radius_top
    g = _rings([ring(n, radius, 0.0, phase), ring(n, rt, height, phase)], color, mat, cap_bottom, cap_top)
    return g.move(at)


def cone(n: int, radius, height: float, at=(0, 0, 0), phase: float | None = None, color="white",
         mat=MAT_VCOL, cap_bottom: bool = True) -> Geo:
    """Upright n-sided cone standing on `at`, tip up."""
    return prism(n, radius, height, radius_top=0.0, at=at, phase=phase, color=color, mat=mat,
                 cap_bottom=cap_bottom)


def lathe(profile, n: int = 8, at=(0, 0, 0), phase: float | None = None, color="white", mat=MAT_VCOL,
          colors=None, cap_bottom: bool = True, cap_top: bool = True) -> Geo:
    """Spin a profile around the vertical axis: bottles, domes, hydrants, turrets.

    profile = [(radius, z), ...] from one end to the other. radius 0 closes to a point.
    colors (optional) gives one color per band between profile points.
    """
    rings_ = [ring(n, r, z, phase) for r, z in profile]
    g = _rings(rings_, color, mat, cap_bottom, cap_top, colors)
    return g.move(at)


def sphere(radius, n: int = 8, rings: int = 4, at=(0, 0, 0), color="white", mat=MAT_VCOL) -> Geo:
    """Low-poly ball centered on `at`: n sides around, `rings` bands from pole to pole.

    radius may be (rx, ry, rz) for an ellipsoid. n=8, rings=4 is 48 triangles.
    """
    rx, ry, rz = (radius,) * 3 if isinstance(radius, (int, float)) else radius
    prof = [(math.sin(math.pi * k / rings), -math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    prof[0] = (0.0, -1.0)
    prof[-1] = (0.0, 1.0)
    g = lathe(prof, n, color=color, mat=mat)
    return g.scale(rx, ry, rz).move(at)


def icosphere(radius: float, detail: int = 0, at=(0, 0, 0), color="white", mat=MAT_VCOL) -> Geo:
    """Faceted ball from an icosahedron: detail 0 = 20 triangles, detail 1 = 80."""
    t = (1 + 5 ** 0.5) / 2
    vs = [Vector(p).normalized() for p in (
        (-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
        (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1))]
    fs = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
          (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5),
          (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    tris = [[vs[a], vs[b], vs[c]] for a, b, c in fs]
    for _ in range(detail):
        nxt = []
        for a, b, c in tris:
            ab, bc, ca = (a + b).normalized(), (b + c).normalized(), (c + a).normalized()
            nxt += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        tris = nxt
    g = Geo()
    for tri in tris:
        g.face([p * radius for p in tri], color, mat)
    return g.move(at)


def extrude(outline, depth: float, axis: str = "x", at=(0, 0, 0), color="white", mat=MAT_VCOL,
            cap_color=None) -> Geo:
    """Extrude a 2D outline into a slab, centered on `at` along the extrusion axis.

    axis="x": outline is a side view, points are (y, z), slab is `depth` wide (left-right).
              This is the quick way to a vehicle body or a head profile.
    axis="y": outline is a front view, points are (x, z), slab is `depth` deep.
    axis="z": outline is a top view, points are (x, y), and the slab rises from `at` by
              `depth` (not centered: it stands on the ground like a floor plan).
    The outline may be concave; list its corners in order either way round.
    """
    h = depth / 2.0
    if axis == "x":
        a = [(-h, p[0], p[1]) for p in outline]
        b = [(h, p[0], p[1]) for p in outline]
    elif axis == "y":
        a = [(p[0], -h, p[1]) for p in outline]
        b = [(p[0], h, p[1]) for p in outline]
    elif axis == "z":
        a = [(p[0], p[1], 0.0) for p in outline]
        b = [(p[0], p[1], depth) for p in outline]
    else:
        raise ValueError("axis must be 'x', 'y' or 'z'")
    g = _rings([a, b], color, mat)
    if cap_color is not None:
        n = len(g.f)
        g.paint(cap_color, [n - 2, n - 1])
    return g.move(at)


def loft(rings_, color="white", mat=MAT_VCOL, colors=None, cap_start: bool = True,
         cap_end: bool = True) -> Geo:
    """Skin a row of cross-sections: torsos, tails, snouts, fuselages.

    rings_ is a list of rings; each ring is a list of 3D points, all with the same count
    and the same starting corner. Use section() to make them. A ring whose points coincide
    closes the shape to a tip. colors (optional): one color per band between rings.
    """
    return _rings(rings_, color, mat, cap_start, cap_end, colors)


def section(n: int, width: float, height: float, center, axis: str = "y", phase: float | None = None,
            tilt: float = 0.0) -> list[Vector]:
    """One cross-section for loft(): an n-gon `width` wide (x) and `height` tall.

    axis="y": the section faces along the body (use for torso, tail, snout): `width` is
              left-right, `height` is up-down, center = (x, y, z).
    axis="z": horizontal section (use for upright things): width is x, height is y depth.
    axis="x": section faces sideways (use for arms held out, wings): width is y, height is z.
    n=4 gives a rectangle (corners, not a diamond). tilt leans the section in degrees
    around the model's left-right axis (only for axis="y"), e.g. for a neck curving up.
    """
    c = V(center)
    if n == 4 and phase is None:
        pts2 = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
    else:
        ph = math.radians(-90.0 + 180.0 / n if phase is None else phase)
        pts2 = [(0.5 * math.cos(ph + 2 * math.pi * k / n), 0.5 * math.sin(ph + 2 * math.pi * k / n))
                for k in range(n)]
    out = []
    for a, b in pts2:
        if axis == "y":
            p = Vector((a * width, 0.0, b * height))
            if tilt:
                p = Matrix.Rotation(math.radians(tilt), 3, "X") @ p
        elif axis == "z":
            p = Vector((a * width, b * height, 0.0))
        elif axis == "x":
            p = Vector((0.0, a * width, b * height))
        else:
            raise ValueError("axis must be 'x', 'y' or 'z'")
        out.append(c + p)
    return out


def beam(p0, p1, size0, size1=None, color="white", mat=MAT_VCOL, side=LEFT, cap_start: bool = True,
         cap_end: bool = True) -> Geo:
    """Rectangular bar from p0 to p1: limbs, barrels, posts, struts.

    size0 = (width, thickness) at p0, size1 at p1 (defaults to size0; (0, 0) makes a spike).
    Width runs along `side` (default: the model's left-right axis).
    cap_start=False leaves the p0 end open (saves 2 triangles when it is buried in a body).
    """
    size1 = size0 if size1 is None else size1
    return tapered_box(size0, size1, 1.0, color=color, mat=mat, cap_bottom=cap_start,
                       cap_top=cap_end).along(p0, p1, side=side)


def rod(p0, p1, radius0, radius1=None, n: int = 6, color="white", mat=MAT_VCOL, side=LEFT,
        cap_start: bool = True, cap_end: bool = True) -> Geo:
    """Round (n-sided) bar from p0 to p1: pipes, gun barrels, horns (radius1=0 for a spike).
    cap_start=False / cap_end=False leave an end open where it is hidden."""
    radius1 = radius0 if radius1 is None else radius1
    return prism(n, radius0, 1.0, radius_top=radius1, color=color, mat=mat, cap_bottom=cap_start,
                 cap_top=cap_end).along(p0, p1, side=side)


def quad(a, b, c, d, color="white", mat=MAT_VCOL, two_sided: bool = False, uv_rect=None) -> Geo:
    """One four-cornered face, counter-clockwise seen from its front.

    uv_rect=(u0, v0, u1, v1) maps a..d to the rectangle's bottom-left, bottom-right,
    top-right, top-left and switches the face to the city_atlas material.
    """
    uv = None
    if uv_rect is not None:
        u0, v0, u1, v1 = uv_rect
        uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        mat = MAT_ATLAS
    return polygon([a, b, c, d], color=color, mat=mat, two_sided=two_sided, uv=uv)


def tri(a, b, c, color="white", mat=MAT_VCOL, two_sided: bool = False) -> Geo:
    """One triangle, counter-clockwise seen from its front."""
    return polygon([a, b, c], color=color, mat=mat, two_sided=two_sided)


def polygon(points, color="white", mat=MAT_VCOL, two_sided: bool = False, uv=None) -> Geo:
    """One flat face from 3 or more points. The game draws faces from the front only, so a
    thin fin, flag or sign needs two_sided=True (costs double the triangles)."""
    g = Geo().face(points, color, mat, uv)
    if two_sided:
        g.face(list(reversed(points)), color, mat, list(reversed(uv)) if uv is not None else None)
    return g


def grid_quad(a, b, c, d, nu: int, nv: int, rect_fn, color="white") -> Geo:
    """A four-cornered wall split into nu x nv tiles, each mapped to its own atlas cell.

    a, b, c, d = bottom-left, bottom-right, top-right, top-left seen from outside.
    rect_fn(i, j) -> atlas rectangle for the tile in column i (from the left) and row j
    (from the bottom). Costs 2 * nu * nv triangles: mind the budget.
    """
    a, b, c, d = V(a), V(b), V(c), V(d)
    g = Geo()

    def pt(s, t):
        return a.lerp(b, s).lerp(d.lerp(c, s), t)

    for j in range(nv):
        for i in range(nu):
            s0, s1, t0, t1 = i / nu, (i + 1) / nu, j / nv, (j + 1) / nv
            g.add(quad(pt(s0, t0), pt(s1, t0), pt(s1, t1), pt(s0, t1), color=color,
                       uv_rect=rect_fn(i, j)))
    return g


def from_data(verts, faces, color="white", mat=MAT_VCOL, colors=None) -> Geo:
    """Mesh from raw vertices and faces (index lists, counter-clockwise seen from outside).

    colors (optional) gives one color per face.
    """
    g = Geo()
    for i, f in enumerate(faces):
        g.face([verts[k] for k in f], colors[i] if colors is not None else color, mat)
    return g


# ---- collapse chunks --------------------------------------------------------------------
def shatter_box(lo, hi, cuts=(2, 2, 3), color="bld_cream", inner="rubble_grey_dk", seed: int = 1,
                jitter: float = 0.3, colors=None) -> list[Geo]:
    """Break a box-shaped volume into irregular blocks for a collapse: a list of Geos.

    lo, hi = opposite corners of the volume (the building's bounding box, or one wing).
    cuts = (pieces across x, along y, up z); the cut planes are jittered so the blocks are
    uneven. Faces on the outside of the volume keep `color` (or colors[i], one per block);
    faces that were inside get `inner`, the broken-plaster color. Each block is 12
    triangles. Feed the result to chunk_nodes().
    """
    lo, hi = V(lo), V(hi)
    rng = random.Random(seed)

    def planes(a, b, n):
        step = (b - a) / n
        return [a] + [a + step * (k + rng.uniform(-jitter, jitter)) for k in range(1, n)] + [b]

    xs, ys, zs = planes(lo.x, hi.x, cuts[0]), planes(lo.y, hi.y, cuts[1]), planes(lo.z, hi.z, cuts[2])
    out = []
    for k in range(cuts[2]):
        for j in range(cuts[1]):
            for i in range(cuts[0]):
                a = Vector((xs[i], ys[j], zs[k]))
                b = Vector((xs[i + 1], ys[j + 1], zs[k + 1]))
                col = colors[len(out) % len(colors)] if colors else color
                g = box(b - a, at=(a + b) / 2, color=inner)
                outside = {"left": i == cuts[0] - 1, "right": i == 0, "back": j == cuts[1] - 1,
                           "front": j == 0, "top": k == cuts[2] - 1}
                for side, is_out in outside.items():
                    if is_out:
                        g.paint(col, where=side)
                out.append(g)
    return out


def chunk_nodes(geos, parent=None, start: int = 0) -> list:
    """Turn a list of Geos into chunk_00, chunk_01, ... nodes, each with its origin at its
    own center (so the client can tumble it). Returns the nodes."""
    nodes = []
    for i, g in enumerate(geos):
        if g.tris > contract.BUDGET_CHUNK:
            raise ValueError(f"chunk {start + i} has {g.tris} triangles; the budget is {contract.BUDGET_CHUNK}")
        nodes.append(node(f"chunk_{start + i:02d}", g, pivot=g.center(), parent=parent))
    return nodes


# ---- atlas UV helpers -------------------------------------------------------------------
def atlas_rect(col: int, row: int, grid=None, span=(1, 1), inset: float = 0.02):
    """UV rectangle (u0, v0, u1, v1) of a cell in a texture atlas laid out as a grid.

    col counts from the left, row from the TOP of the image (like reading a page);
    grid = (cols, rows), default mb.ATLAS_GRID; span = (cells wide, cells tall).
    inset pulls the rectangle in by that fraction of a cell so nearest-filtered
    neighbors never bleed. The result is in Blender UV space (v up); the exporter flips
    v for glTF, so the picture comes out the right way up in the game.
    """
    cols, rows = grid or ATLAS_GRID
    cw, ch = 1.0 / cols, 1.0 / rows
    u0 = col * cw + inset * cw
    u1 = (col + span[0]) * cw - inset * cw
    v1 = 1.0 - row * ch - inset * ch
    v0 = 1.0 - (row + span[1]) * ch + inset * ch
    return (u0, v0, u1, v1)


# =========================================================================================
# Scene, materials, nodes
# =========================================================================================
def reset() -> None:
    """Start from a completely empty scene (meters). Call at the top of every asset."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def get_material(name: str):
    """The export material with this contract name (created on first use, no textures)."""
    _check_mat(name)
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_backface_culling = True          # the game draws front faces only
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
        bsdf.inputs["Roughness"].default_value = 1.0
        bsdf.inputs["Metallic"].default_value = 0.0
        if name == MAT_GLOW:
            bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
            bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


def world_position(obj) -> Vector:
    """Model-space position of a node's pivot (rest pose)."""
    p = Vector(obj.location)
    while obj.parent is not None:
        obj = obj.parent
        p += Vector(obj.location)
    return p


def _obj(ref):
    if isinstance(ref, str):
        o = bpy.data.objects.get(ref)
        if o is None:
            raise KeyError(f"no node named {ref!r} in the scene")
        return o
    return ref


def _new_name(name: str) -> str:
    if not contract.valid_node_name(name):
        raise ValueError(f"node name {name!r}: use only letters, digits and underscores")
    if name in bpy.data.objects:
        raise ValueError(f"a node named {name!r} already exists")
    return name


def _mesh_from_geo(name: str, geo: Geo, origin: Vector):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p - origin) for p in geo.v], [], [list(f) for f in geo.f])
    me.update(calc_edges=True)
    me.shade_flat()
    attr = me.color_attributes.new(COLOR_ATTR, "FLOAT_COLOR", "CORNER")
    flat: list[float] = []
    lin_cache: dict[tuple, tuple] = {}
    for p in me.polygons:
        c = geo.col[p.index]
        lin = lin_cache.get(c)
        if lin is None:
            lin = lin_cache[c] = tuple(palette.srgb_to_linear(x) for x in c)
        for _ in p.loop_indices:
            flat.extend((lin[0], lin[1], lin[2], 1.0))
    attr.data.foreach_set("color", flat)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    used = []
    for m in geo.mat:
        if m not in used:
            used.append(m)
    for m in used:
        me.materials.append(get_material(m))
    for p in me.polygons:
        p.material_index = used.index(geo.mat[p.index])
    if any(u is not None for u in geo.uv):
        uvl = me.uv_layers.new(name=UV_LAYER)
        for p in me.polygons:
            uvs = geo.uv[p.index]
            for k, li in enumerate(p.loop_indices):
                uvl.data[li].uv = uvs[k] if uvs is not None else (0.0, 0.0)
    for i, m in enumerate(geo.mat):
        if m == MAT_ATLAS and geo.uv[i] is None:
            raise ValueError(f"node {name!r}: a city_atlas face has no UVs (use uv_fit or quad(uv_rect=...))")
    return me


def node(name: str, geo: Geo | None = None, pivot=(0, 0, 0), parent=None):
    """Create a named glTF node. Returns the Blender object.

    geo:    its mesh, in model space (None makes an empty: a group or an anchor).
    pivot:  where the node's origin sits in model space: put it on the joint the part
            turns around (shoulder, hinge, turret ring). Code rotates the node about it.
    parent: the parent node (object or name).
    Nodes only ever carry a position: rotations and scales are baked into the geometry,
    which is what "apply all transforms" in the contract means.
    """
    name = _new_name(name)
    pv = V(pivot)
    par = _obj(parent) if parent is not None else None
    if geo is not None and geo.f:
        data = _mesh_from_geo(name, geo, pv)
    else:
        data = None
    ob = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(ob)
    if data is None:
        ob.empty_display_type = "PLAIN_AXES"
        ob.empty_display_size = 0.1
    if par is not None:
        ob.parent = par
        ob.location = pv - world_position(par)
    else:
        ob.location = pv
    return ob


def empty(name: str, at=(0, 0, 0), parent=None):
    """An empty node: a group pivot (`root`, `spines`) or an anchor (`cam_fp`, `mouth`,
    `hold`, `muzzle`). Anchors look along the model's forward axis by convention."""
    return node(name, None, pivot=at, parent=parent)


def _swap_lr(name: str) -> str | None:
    for a, b in (("_L", "_R"), ("_R", "_L")):
        if name.endswith(a):
            return name[: -len(a)] + b
        if a + "_" in name:
            return name.replace(a + "_", b + "_", 1)
    return None


def mirror(src, parent=None, recursive: bool = True):
    """Make the right-hand twin of a left-hand node (or the reverse), children included.

    `arm_L` with children `forearm_L`, `hand_L` becomes `arm_R`, `forearm_R`, `hand_R`:
    geometry and pivots are mirrored across the model's center plane and faces stay
    outward. Children without _L/_R in their name are not copied. Returns the new node.
    """
    src = _obj(src)
    new_name = _swap_lr(src.name)
    if new_name is None:
        raise ValueError(f"{src.name!r} has no _L or _R to swap")
    if parent is None:
        parent = src.parent
        twin_parent = _swap_lr(parent.name) if parent is not None else None
        if twin_parent and twin_parent in bpy.data.objects:
            parent = bpy.data.objects[twin_parent]
    p = world_position(src)
    geo = Geo.from_object(src).mirror_x() if src.type == "MESH" else None
    twin = node(new_name, geo, pivot=(-p.x, p.y, p.z), parent=parent)
    if recursive:
        for child in sorted(src.children, key=lambda o: o.name):
            if _swap_lr(child.name) is not None:
                mirror(child, parent=twin, recursive=True)
    return twin


def apply_transforms(objects=None) -> None:
    """Bake any rotation or scale left on nodes into their meshes, keeping pivots in place.

    Nodes made with mb.node() never need this. It is for objects you built with plain
    Blender calls (bpy.ops primitives, modifiers) and then rotated or scaled.
    """
    objs = list(objects) if objects is not None else asset_objects()
    for ob in sorted(objs, key=_depth):      # parents first
        rot_scale = ob.matrix_basis.to_3x3().to_4x4()
        if all(abs(rot_scale[i][j] - (1.0 if i == j else 0.0)) < 1e-9 for i in range(3) for j in range(3)):
            continue
        if ob.type == "MESH":
            if ob.data.users > 1:
                ob.data = ob.data.copy()
            ob.data.transform(rot_scale)
            if rot_scale.determinant() < 0:
                ob.data.flip_normals()
            ob.data.update()
        for child in ob.children:
            child.matrix_basis = rot_scale @ child.matrix_parent_inverse @ child.matrix_basis
            child.matrix_parent_inverse = Matrix.Identity(4)
        loc = ob.location.copy()
        ob.matrix_basis = Matrix.Translation(loc)
    bpy.context.view_layer.update()


def _depth(ob) -> int:
    d = 0
    while ob.parent is not None:
        ob = ob.parent
        d += 1
    return d


def asset_objects() -> list:
    """Every object that belongs to the asset (cameras, lights and preview helpers excluded)."""
    return [o for o in bpy.context.scene.objects
            if o.type in ("MESH", "EMPTY") and not o.get("mb_helper")]


def tri_count(objects=None) -> int:
    """Triangles in the scene (or in the given objects) as the exporter will write them."""
    total = 0
    for ob in (objects if objects is not None else asset_objects()):
        if ob.type == "MESH":
            total += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return total


def scene_bounds(objects=None):
    """(min, max) corners of all asset geometry in model space, current pose."""
    bpy.context.view_layer.update()
    lo = Vector((1e18,) * 3)
    hi = Vector((-1e18,) * 3)
    any_ = False
    for ob in (objects if objects is not None else asset_objects()):
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            p = mw @ v.co
            any_ = True
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    if not any_:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return lo, hi


# =========================================================================================
# Export
# =========================================================================================
def export_glb(asset: str, objects=None, check: bool = True) -> str:
    """Write the asset to client/public/assets/models/<asset>.glb (or to a path).

    Exports with the contract's conventions: meters, +Y up, facing +Z, no textures, no
    animation, flat normals, vertex colors as COLOR_0, materials by name. Refuses to
    export a posed or otherwise transformed scene. Returns the absolute path.
    """
    path = contract.model_path(asset)
    objs = list(objects) if objects is not None else asset_objects()
    if not objs:
        raise RuntimeError("nothing to export: the scene has no nodes")
    if check:
        for ob in objs:
            m = ob.matrix_basis.to_3x3()
            if any(abs(m[i][j] - (1.0 if i == j else 0.0)) > 1e-6 for i in range(3) for j in range(3)):
                raise RuntimeError(
                    f"node {ob.name!r} is rotated or scaled. Clear the pose (mb.clear_pose()) or bake it "
                    f"(mb.apply_transforms()) before exporting: the contract wants position-only nodes.")
            if ob.parent is not None and ob.matrix_parent_inverse != Matrix.Identity(4):
                raise RuntimeError(f"node {ob.name!r} has a parent-inverse matrix; parent it with mb.node(parent=...)")
            if not contract.valid_node_name(ob.name):
                raise RuntimeError(f"node name {ob.name!r}: use only letters, digits and underscores")
            if ob.type == "MESH":
                if ob.data.color_attributes.get(COLOR_ATTR) is None:
                    raise RuntimeError(f"node {ob.name!r} has no '{COLOR_ATTR}' color attribute")
                for mat in ob.data.materials:
                    if mat is None or mat.name not in MATERIALS:
                        raise RuntimeError(f"node {ob.name!r} uses material {mat.name if mat else None!r}; "
                                           f"only {MATERIALS} are allowed")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in objs:
        if ob.type == "MESH":
            ob.data.name = ob.name
            ob.data.color_attributes.active_color = ob.data.color_attributes[COLOR_ATTR]
    bpy.context.view_layer.update()
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    with quiet():
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True, export_yup=True,
            export_apply=False, export_animations=False, export_skins=False, export_morph=False,
            export_cameras=False, export_lights=False, export_extras=False,
            export_materials="EXPORT", export_image_format="NONE",
            export_vertex_color="ACTIVE", export_all_vertex_colors=False,
            export_active_vertex_color_when_no_material=True,
            export_normals=True, export_texcoords=True, export_tangents=False,
            export_draco_mesh_compression_enable=False)
    if not os.path.exists(path):
        raise RuntimeError(f"export failed: {path} was not written")
    return path


def measure(asset: str) -> dict:
    """Facts measured from the exported file: nodes, size [w, h, d], tris, per-node tris."""
    g = glbfile.load(contract.model_path(asset))
    kind = contract.kind_of(asset)
    scope = g.subtree("intact") if kind in ("structure", "landmark") and g.node("intact") else None
    return {
        "nodes": g.node_names(),
        "size": g.size(scope),
        "tris": g.tris(scope),
        "tris_total": g.tris(),
        "bytes": g.byte_size,
    }


# =========================================================================================
# Partial manifests (docs/ASSETS.md section 7)
# =========================================================================================
class Manifest:
    """Writer for client/public/assets/manifest.<family>.json.

    Entries are merged into what is already in the file, so several scripts (or a run with
    --only) can share one family. Sizes, node lists and triangle counts are measured from
    the exported .glb, never typed in.
        man = mb.Manifest("props")
        man.add_model("prop_hydrant", kind="prop")
        man.write()
    """

    def __init__(self, family: str, fresh: bool = False):
        self.family = family
        self.path = os.path.join(ASSETS, f"manifest.{family}.json")
        self.data: dict = {}
        if not fresh and os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)

    def add_model(self, asset: str, kind: str | None = None, rig: str | None = None,
                  chunks: int | None = None) -> dict:
        """Add or replace the "models" entry for an exported asset id. Returns the entry."""
        asset = contract.asset_id(asset)
        path = os.path.join(MODELS, asset + ".glb")
        g = glbfile.load(path)
        kind = kind or contract.kind_of(asset)
        if kind not in contract.KINDS:
            raise ValueError(f"kind must be one of {contract.KINDS}")
        structural = kind in ("structure", "landmark") and g.node("intact") is not None
        scope = g.subtree("intact") if structural else None
        entry: dict = {
            "file": f"models/{asset}.glb",
            "kind": kind,
            "nodes": g.node_names(),
            "size": g.size(scope),
            "tris": g.tris(scope),
        }
        if rig:
            entry["rig"] = rig
        n_chunks = sum(1 for n in g.node_names() if n.startswith("chunk_"))
        if chunks is not None or n_chunks:
            entry["chunks"] = n_chunks if chunks is None else chunks
        self.data.setdefault("models", {})[asset] = entry
        return entry

    def add_texture(self, tex_id: str, tile: bool | None = None, grid=None) -> dict:
        """Add or replace a "textures" entry for client/public/assets/textures/<id>.png."""
        entry: dict = {"file": f"textures/{tex_id}.png"}
        if tile:
            entry["tile"] = True
        if grid:
            entry["grid"] = [int(grid[0]), int(grid[1])]
        self.data.setdefault("textures", {})[tex_id] = entry
        return entry

    def add(self, section: str, entry_id: str, entry: dict) -> dict:
        """Add any other section entry ("sprites", ...) verbatim."""
        self.data.setdefault(section, {})[entry_id] = entry
        return entry

    def prune(self) -> list[str]:
        """Drop model and texture entries whose file no longer exists. Returns removed ids."""
        gone = []
        for section in ("models", "textures"):
            for key, entry in list(self.data.get(section, {}).items()):
                if not os.path.exists(os.path.join(ASSETS, entry.get("file", ""))):
                    del self.data[section][key]
                    gone.append(key)
        return gone

    def write(self) -> str:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        ordered = {sec: dict(sorted(self.data[sec].items())) for sec in sorted(self.data)}
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(_compact_json(ordered))
        return self.path


def _compact_json(obj, indent: int = 0) -> str:
    """JSON with one entry per line group: readable diffs without a line per number."""
    pad = "  " * indent
    if isinstance(obj, dict) and indent < 3:
        if not obj:
            return "{}"
        items = [f'{pad}  {json.dumps(k)}: {_compact_json(v, indent + 1)}' for k, v in obj.items()]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}" + ("\n" if indent == 0 else "")
    return json.dumps(obj, ensure_ascii=False)


# =========================================================================================
# Preview and posing (implemented in mb_preview.py, re-exported here)
# =========================================================================================
from mb_preview import (View, clear_pose, concept, contact_sheet, load_glb, pose, posed,  # noqa: E402,F401
                        render_view, set_preview_atlas)

# =========================================================================================
# Family runner
# =========================================================================================
_REGISTRY: list[dict] = []

# extra contact-sheet cells every building gets: its other states, one per cell
STRUCTURE_STATE_VIEWS = [
    View("DAMAGED", azimuth=35, elevation=20, fov=28, show=("damaged",), frame=("intact",)),
    View("RUBBLE", azimuth=35, elevation=20, fov=28, show=("rubble",), frame=("intact",)),
    View("CHUNKS (spread apart)", azimuth=35, elevation=20, fov=28, show=("chunk_*",), explode=0.45),
]


def asset(asset_id: str, kind: str | None = None, rig: str | None = None, size_class: str | None = None,
          sheet: dict | None = None, concept: dict | list | bool | None = None, budget: int | None = None):
    """Register a function that builds one asset. See run_family().

    kind:       manifest kind; guessed from the id when omitted.
    rig:        manifest "rig" value for kaiju ("lizard", ...).
    size_class: "small" | "medium" | "large" for structures (sets the triangle budget) when
                tools/art/data/archetypes.json does not say.
    budget:     override the triangle budget (rarely needed).
    sheet:      extra options for contact_sheet(), e.g. dict(extra=[mb.View("first person", node="cam_fp")]).
    concept:    options for concept(), a list of option dicts for several shots (give each
                a "name"), or False for no concept shot.
    The function builds the nodes in the (already reset) scene. It may return a dict with
    "sheet" and/or "concept" keys to set those options from inside.
    """
    def deco(fn):
        _REGISTRY.append(dict(id=asset_id, fn=fn, kind=kind, rig=rig, size_class=size_class,
                              sheet=sheet, concept=concept, budget=budget))
        return fn
    return deco


def _file_sha(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def _stamp_ok(png: str, stamp: str) -> bool:
    if not os.path.exists(png):
        return False
    try:
        from PIL import Image
        with Image.open(png) as im:
            return im.info.get("mb_stamp") == stamp
    except Exception:
        return False


def run_family(family: str, argv=None) -> int:
    """Build every asset registered with @mb.asset in this script.

    For each asset: reset the scene, call the build function, export the .glb, validate it
    against the contract, render the contact sheet and concept shot(s), and add the entry
    to client/public/assets/manifest.<family>.json. Previews are skipped when the .glb and
    the options are unchanged since they were last rendered.

    Command line:
        --only ID[,ID]   build just these assets (the manifest keeps the others)
        --list           print the asset ids and exit
        --no-previews    export and validate only (fast iteration on geometry)
        --no-concept     skip the concept shots
        --force          re-render previews even if nothing changed
    Exits non-zero if any asset fails validation, so build_all.sh stops on bad art.
    """
    import validation as validator   # tools/art/lib/validation.py (pure Python)
    import mb_preview

    ap = argparse.ArgumentParser(description=f"Build the '{family}' model family.")
    ap.add_argument("--only", default="", help="comma-separated asset ids to build")
    ap.add_argument("--list", action="store_true", help="print the asset ids and exit")
    ap.add_argument("--no-previews", action="store_true", help="export and validate only")
    ap.add_argument("--no-concept", action="store_true", help="skip the concept shots")
    ap.add_argument("--force", action="store_true", help="re-render previews even if unchanged")
    args = ap.parse_args(argv)
    # build_all.sh passes its switches through the environment
    args.no_previews = args.no_previews or bool(os.environ.get("MB_NO_PREVIEWS"))
    args.no_concept = args.no_concept or bool(os.environ.get("MB_NO_CONCEPT"))
    args.force = args.force or bool(os.environ.get("MB_FORCE"))
    if args.list:
        for a in _REGISTRY:
            print(a["id"])
        return 0
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    unknown = only - {a["id"] for a in _REGISTRY}
    if unknown:
        print(f"unknown asset id(s): {', '.join(sorted(unknown))}")
        return 2
    man = Manifest(family)
    failed: list[str] = []
    rows = []
    t_all = time.time()
    for a in _REGISTRY:
        aid = a["id"]
        if only and aid not in only:
            continue
        t0 = time.time()
        reset()
        ret = a["fn"]() or {}
        path = export_glb(aid)
        kind = a["kind"] or contract.kind_of(aid)
        report = validator.validate_file(path, kind=kind, size_class=a["size_class"], budget=a["budget"])
        ok = report.ok
        if not ok:
            failed.append(aid)
        print(report.format(only_problems=ok))
        entry = man.add_model(aid, kind=kind, rig=a["rig"])
        sheet_opts = dict(a["sheet"] or {})
        sheet_opts.update(ret.get("sheet") or {})
        concept_opts = ret.get("concept", a["concept"])
        if "cam_fp" in entry["nodes"] and "extra" not in sheet_opts:
            sheet_opts["extra"] = [View("FIRST PERSON (cam_fp)", node="cam_fp", fov=80)]
        if kind in ("structure", "landmark") and "intact" in entry["nodes"]:
            # all states sit on top of each other in the file: show them one at a time
            sheet_opts.setdefault("show", ("intact",))
            sheet_opts.setdefault("extra", STRUCTURE_STATE_VIEWS)
            if isinstance(concept_opts, list):
                concept_opts = [{"show": ("intact",), **shot} for shot in concept_opts]
            elif concept_opts is not False:
                concept_opts = {"show": ("intact",), **(concept_opts or {})}
        if not args.no_previews:
            sha = _file_sha(path)
            sheet_png = os.path.join(PREVIEWS, aid + ".png")
            stamp = f"{mb_preview.PREVIEW_VERSION}|{sha}|{sheet_opts!r}"
            loaded = False
            if args.force or not _stamp_ok(sheet_png, stamp):
                load_glb(path)          # previews show the exported file: what ships is what is reviewed
                loaded = True
                contact_sheet(aid, stamp=stamp, **sheet_opts)
            if concept_opts is not False and not args.no_concept:
                shots = concept_opts if isinstance(concept_opts, list) else [concept_opts or {}]
                for shot in shots:
                    shot = dict(shot)
                    name = shot.pop("name", None)
                    png = os.path.join(CONCEPT, aid + (f"_{name}" if name else "") + ".png")
                    stamp = f"{mb_preview.PREVIEW_VERSION}|{sha}|{shot!r}"
                    if args.force or not _stamp_ok(png, stamp):
                        if not loaded:
                            load_glb(path)
                            loaded = True
                        concept(aid, out=png, stamp=stamp, **shot)
        rows.append((aid, entry["tris"], entry["size"], "ok" if ok else "FAILED", time.time() - t0))
    man.prune()
    out = man.write()
    print(f"\n{family}: {len(rows)} asset(s) in {time.time() - t_all:.1f} s")
    for aid, tris, size, status, dt in rows:
        print(f"  {aid:<28} {tris:>5} tris  {size[0]:>7.2f} x {size[1]:>7.2f} x {size[2]:>7.2f} m  "
              f"{status:<6} {dt:5.1f} s")
    print(f"  manifest: {os.path.relpath(out, REPO)}")
    if failed:
        print(f"  VALIDATION FAILED: {', '.join(failed)}")
        return 1
    return 0
