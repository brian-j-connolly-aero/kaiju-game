"""Geometry helpers for kaiju: faceted tubes, spikes, claws, teeth, and a rig collector.

Kaiju are rigid segments (ASSETS.md section 3). Every segment here is a closed, faceted
"tube" whose ends are rounded domes centered on the joints, so a limb can rotate 60 degrees
or more around its pivot without opening a gap: both neighbors always contain a ball around
the joint.

Everything is in the authoring frame of tools/art/lib/mb.py: +Z up, -Y forward, +X left.
"""
from __future__ import annotations

import math
import os
import sys


sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402  (available once bpy is loaded)

V = mb.V
UP, DOWN, FWD, BACK, LEFT, RIGHT = mb.UP, mb.DOWN, mb.FWD, mb.BACK, mb.LEFT, mb.RIGHT


# =========================================================================================
# cross-sections and tubes
# =========================================================================================
def ngon(n: int, phase: float | None = None) -> list[tuple[float, float]]:
    """Unit n-gon filling the box -0.5..0.5 in both directions.

    phase=None puts a flat side on top (local +y); phase=90 puts a corner there (a ridge).
    """
    ph = math.radians(90.0 - 180.0 / n if phase is None else phase)
    pts = [(math.cos(ph + 2 * math.pi * k / n), math.sin(ph + 2 * math.pi * k / n)) for k in range(n)]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    sx, sy = max(xs) - min(xs), max(ys) - min(ys)
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return [((x - cx) / sx, (y - cy) / sy) for x, y in pts]


def frame(tangent: Vector, up=UP) -> tuple[Vector, Vector]:
    """(x, y) axes of a cross-section facing along `tangent`; y is as close to `up` as possible."""
    u = V(up)
    x = u.cross(tangent)
    if x.length < 1e-6:
        u = Vector((0, 1, 0)) if abs(tangent.y) < 0.9 else Vector((1, 0, 0))
        x = u.cross(tangent)
    x.normalize()
    y = tangent.cross(x).normalized()
    return x, y


def tube(path, sizes, n: int = 6, up=UP, phase: float | None = None, prof=None,
         cap0: str = "dome", cap1: str = "dome", d0: float = 1.0, d1: float = 1.0,
         color="white", tip=None) -> mb.Geo:
    """A faceted tube along a path: the building block of limbs, tails, torsos, necks.

    path:   points the tube passes through.
    sizes:  one (width, height) per point (or one number for both). `height` runs along
            `up` (projected), `width` across it.
    prof:   custom unit cross-section [(x, y), ...] within -0.5..0.5 instead of an n-gon.
    cap0, cap1: how the ends close:
            "dome"   two bands, a faceted half ball centered on the end point (use on joints)
            "point"  one band to a tip
            "blunt"  one band to a smaller flat end
            "flat"   a flat cap,   "open"  nothing (hidden inside a neighbor)
    d0, d1: how far the dome or point sticks out, in end radii.
    tip:    close the far end to this exact point instead of cap1 (spikes, claws, teeth).
            With a tip the path may be a single point.
    """
    pts = [V(p) for p in path]
    m = len(pts)
    sz = [(s, s) if isinstance(s, (int, float)) else (s[0], s[1]) for s in sizes]
    tans = []
    for k in range(m):
        if m == 1:
            t = V(tip) - pts[0]
        elif k == 0:
            t = pts[1] - pts[0]
        elif k == m - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[k] - pts[k - 1]).normalized() + (pts[k + 1] - pts[k]).normalized()
        tans.append(t.normalized())
    unit = prof or ngon(n, phase)

    def ring(c, t, w, h):
        x, y = frame(t, up)
        return [c + x * (px * w) + y * (py * h) for px, py in unit]

    def cap(kind, c, t, out, w, h, d):
        r = (w + h) / 4.0
        if kind == "dome":
            return [ring(c + out * (0.62 * r * d), t, w * 0.78, h * 0.78), [c + out * (r * d)] * len(unit)]
        if kind == "point":
            return [[c + out * (r * d)] * len(unit)]
        if kind == "blunt":
            return [ring(c + out * (0.6 * r * d), t, w * 0.6, h * 0.6)]
        return []

    rings = [ring(pts[k], tans[k], *sz[k]) for k in range(m)]
    start = cap(cap0, pts[0], tans[0], -tans[0], sz[0][0], sz[0][1], d0)
    if tip is not None:
        end, cap1 = [[V(tip)] * len(unit)], "tip"
    else:
        end = cap(cap1, pts[-1], tans[-1], tans[-1], sz[-1][0], sz[-1][1], d1)
    all_rings = list(reversed(start)) + rings + end
    return mb.loft(all_rings, color=color, cap_start=cap0 in ("flat", "blunt"), cap_end=cap1 in ("flat", "blunt"))


def limb(p0, p1, s0, s1, n: int = 6, up=FWD, bulge: float = 0.0, bulge_at: float = 0.4, phase=None,
         cap0="dome", cap1="dome", d0=1.0, d1=0.9, color="white") -> mb.Geo:
    """A limb segment from joint p0 to joint p1. bulge > 0 adds a muscle ring in between."""
    p0, p1 = V(p0), V(p1)
    s0 = (s0, s0) if isinstance(s0, (int, float)) else s0
    s1 = (s1, s1) if isinstance(s1, (int, float)) else s1
    if bulge:
        mid = p0.lerp(p1, bulge_at)
        sm = tuple((a + (b - a) * bulge_at) * (1.0 + bulge) for a, b in zip(s0, s1))
        return tube([p0, mid, p1], [s0, sm, s1], n=n, up=up, phase=phase, cap0=cap0, cap1=cap1,
                    d0=d0, d1=d1, color=color)
    return tube([p0, p1], [s0, s1], n=n, up=up, phase=phase, cap0=cap0, cap1=cap1, d0=d0, d1=d1, color=color)


# =========================================================================================
# small parts
# =========================================================================================
def spike(base, tip, w: float, h: float | None = None, n: int = 4, up=UP, color="bone",
          root=None, root_at: float = 0.3, phase=None, closed: bool = False) -> mb.Geo:
    """A spike from `base` to `tip`: base cross-section w x h (n triangles). With `root`
    set, the lowest part gets that color (a darker root makes the spike read as growing
    out of the hide; 3n triangles)."""
    base, tip = V(base), V(tip)
    h = w if h is None else h
    cap0 = "flat" if closed else "open"        # closed: for spikes whose base may show (elbows, plates)
    if root is None:
        return tube([base], [(w, h)], n=n, up=up, phase=phase, cap0=cap0, tip=tip, color=color)
    mid = base.lerp(tip, root_at)
    k = 1.0 - root_at * 0.85
    g = tube([base, mid], [(w, h), (w * k, h * k)], n=n, up=up, phase=phase, cap0=cap0, cap1="open",
             color=root)
    g += tube([mid], [(w * k, h * k)], n=n, up=up, phase=phase, cap0="open", tip=tip, color=color)
    return g


def claw(base, tip, w: float, hook, n: int = 4, color="bone", up=UP, bend: float = 0.28, root=None) -> mb.Geo:
    """A hooked claw: thick at `base`, curving toward `hook` (a direction) on its way to `tip`.
    `root` colors the thick half darker so the claw reads as a shape, not a white blob."""
    base, tip = V(base), V(tip)
    hook = V(hook).normalized()
    length = (tip - base).length
    mid = base.lerp(tip, 0.5) - hook * (length * bend)
    g = tube([base, mid], [w, w * 0.66], n=n, up=up, cap0="flat", tip=tip, color=color)
    if root is not None:
        g.paint(root, where=list(range(n)) + [len(g.f) - 1])       # the thick band and the base cap
    return g


def teeth(p0, p1, count: int, length: float, w: float, direction, color="bone", n: int = 3,
          lean=None, vary: float = 0.25, seed: int = 1) -> mb.Geo:
    """A row of `count` pointed teeth between p0 and p1, pointing along `direction`."""
    import random
    rng = random.Random(seed)
    p0, p1 = V(p0), V(p1)
    d = V(direction).normalized()
    g = mb.Geo()
    side = (p1 - p0).normalized()
    for k in range(count):
        b = p0.lerp(p1, (k + 0.5) / count)
        ln = length * (1.0 + rng.uniform(-vary, vary))
        tp = b + d * ln + (V(lean) * ln if lean is not None else Vector((0, 0, 0)))
        g += tube([b - d * (ln * 0.15)], [(w, w)], n=n, up=side, cap0="open", tip=tp, color=color)
    return g


def scute(center, normal, w: float, length: float, thick: float, along=UP, color="white", top=None,
          taper: float = 0.55, sink: float = 0.35, closed: bool = True) -> mb.Geo:
    """An armor plate: a low frustum lying on a surface. `along` is its length direction.
    closed=False leaves the underside open (2 triangles less) where it can never be seen."""
    c, nrm = V(center), V(normal).normalized()
    g = mb.tapered_box((w, length), (w * taper, length * taper), 1.0, color=color, cap_bottom=closed)
    if top is not None:
        g.paint(top, where="top")
    a = V(along)
    side = a.cross(nrm)
    if side.length < 1e-6:
        side = LEFT
    return g.along(c - nrm * (thick * sink), c + nrm * thick, side=side.normalized())


def sliver(a, b, w: float, h: float, up=UP, color="scar", n: int = 3) -> mb.Geo:
    """A thin spindle lying on a surface between two points: scars, welts, cracks."""
    a, b = V(a), V(b)
    return tube([a, a.lerp(b, 0.5), b], [(w * 0.05, h * 0.05), (w, h), (w * 0.05, h * 0.05)], n=n, up=up,
                cap0="open", cap1="open", color=color)


# =========================================================================================
# painting
# =========================================================================================
def paint_normal(g: mb.Geo, direction, steps) -> mb.Geo:
    """Color faces by how much they look toward `direction`.
    steps = [(min_cosine, color), ...] tried in order; the first that fits wins."""
    d = V(direction).normalized()
    for i in range(len(g.f)):
        c = g.face_normal(i).dot(d)
        for lim, col in steps:
            if c >= lim:
                g.col[i] = mb.palette.rgb(col)
                break
    return g


def bands(g: mb.Geo, p0, p1, count: int, colors, where=None) -> mb.Geo:
    """Cut the stretch p0..p1 into `count` bands and color the selected faces by band:
    colors[k % len(colors)], None keeps the face's color."""
    p0, p1 = V(p0), V(p1)
    axis = p1 - p0
    length2 = axis.length_squared
    for i in g.select(where):
        t = (g.face_center(i) - p0).dot(axis) / length2
        k = int(math.floor(t * count))
        col = colors[k % len(colors)]
        if col is not None:
            g.col[i] = mb.palette.rgb(col)
    return g


def zigzag(g: mb.Geo, center, axis, color, where=None) -> mb.Geo:
    """A zigzag stripe around a tube, centered on the ring that passes through `center`
    (a point on the tube's axis; `axis` is the tube's direction there). Every quad that
    touches that ring is split in two and the half that sits on the ring is painted, so
    the stripe is a row of teeth pointing both ways: a tribal band for free."""
    c0, ax = V(center), V(axis).normalized()
    chosen = set(g.select(where))
    col = mb.palette.rgb(color)
    nf, ncol, nmat, nuv = [], [], [], []
    for i, f in enumerate(g.f):
        done = False
        if i in chosen and len(f) == 4:
            t = [abs((g.v[k] - c0).dot(ax)) for k in f]
            far = max(t)
            on = [k for k in range(4) if t[k] < 0.2 * far]
            if far > 1e-9 and len(on) == 2 and (on[1] - on[0]) in (1, 3):
                a, b = (on[0], on[1]) if on[1] - on[0] == 1 else (on[1], on[0])     # a -> b follows the winding
                c, d = (b + 1) % 4, (b + 2) % 4
                for tri, paint in (((a, b, c), True), ((a, c, d), False)):
                    nf.append(tuple(f[j] for j in tri))
                    ncol.append(col if paint else g.col[i])
                    nmat.append(g.mat[i])
                    nuv.append(None)
                done = True
        if not done:
            nf.append(f)
            ncol.append(g.col[i])
            nmat.append(g.mat[i])
            nuv.append(g.uv[i])
    g.f, g.col, g.mat, g.uv = nf, ncol, nmat, nuv
    return g


def finish(g: mb.Geo, seed: int = 1, jitter: float = 0.045, top: float = 1.07, bottom: float = 0.8) -> mb.Geo:
    """Facet, add painted-in sky light and a little per-facet variation (vcol faces only)."""
    g.triangulate()
    lit = [i for i in range(len(g.f)) if g.mat[i] == mb.MAT_VCOL]
    g.bake_light(top=top, bottom=bottom, where=lit)
    g.jitter(jitter, seed=seed, where=lit)
    return g


# =========================================================================================
# local frames (a head is easier to design lying flat, then pitched into place)
# =========================================================================================
class Local:
    """Maps design coordinates (x left, y FORWARD, z up; unit = `scale`) onto the model:
    rotated `pitch` degrees nose-down around the left-right axis through `origin`."""

    def __init__(self, origin, scale: float = 1.0, pitch: float = 0.0):
        self.o = V(origin)
        self.s = scale
        self.m = Matrix.Rotation(math.radians(pitch), 3, "X")     # +pitch tips -Y (the nose) down

    def p(self, x, y=None, z=None) -> Vector:
        if y is None:
            x, y, z = x
        return self.o + self.m @ Vector((x * self.s, -y * self.s, z * self.s))

    def d(self, x, y=None, z=None) -> Vector:
        """A direction (no translation, no scale)."""
        if y is None:
            x, y, z = x
        return (self.m @ Vector((x, -y, z))).normalized()

    def ring(self, y, levels) -> list[Vector]:
        """A head-style cross-section at forward distance y from [(z, full_width), ...] listed
        from the bottom up: flat bottom, flat top, corners at each level."""
        left = [self.p(w / 2.0, y, z) for z, w in levels]
        right = [self.p(-w / 2.0, y, z) for z, w in reversed(levels)]
        return right[-1:] + left + right[:-1]


# =========================================================================================
# rig collector
# =========================================================================================
class Rig:
    """Collects segments (geometry, pivot, parent) in design units, then scales the whole
    creature to its true height and turns the segments into named nodes."""

    def __init__(self):
        self.names: list[str] = []
        self.geo: dict[str, mb.Geo | None] = {}
        self.pivot: dict[str, Vector] = {}
        self.parent: dict[str, str | None] = {}

    def add(self, name: str, geo: mb.Geo | None, pivot=(0, 0, 0), parent: str | None = None) -> str:
        if name in self.geo:
            raise ValueError(f"segment {name!r} added twice")
        if parent is not None and parent not in self.geo:
            raise ValueError(f"segment {name!r}: parent {parent!r} does not exist yet")
        self.names.append(name)
        self.geo[name] = geo
        self.pivot[name] = V(pivot)
        self.parent[name] = parent
        return name

    def empty(self, name: str, at=(0, 0, 0), parent: str | None = None) -> str:
        return self.add(name, None, at, parent)

    def more(self, name: str, geo: mb.Geo) -> None:
        """Add geometry to an existing segment."""
        if self.geo[name] is None:
            self.geo[name] = mb.Geo()
        self.geo[name].add(geo)

    def mirror_left(self) -> None:
        """Create the _R twin of every _L segment (geometry and pivot mirrored)."""
        for name in list(self.names):
            if not name.endswith("_L"):
                continue
            twin = name[:-2] + "_R"
            if twin in self.geo:
                continue
            par = self.parent[name]
            if par is not None and par.endswith("_L"):
                par = par[:-2] + "_R"
            p = self.pivot[name]
            g = self.geo[name]
            self.add(twin, g.mirrored() if g is not None else None, (-p.x, p.y, p.z), par)

    def tris(self) -> int:
        return sum(g.tris for g in self.geo.values() if g is not None)

    def tri_report(self) -> str:
        rows = [(g.tris, n) for n, g in self.geo.items() if g is not None]
        return ", ".join(f"{n} {t}" for t, n in sorted(rows, reverse=True))

    def bounds(self):
        lo = Vector((1e18,) * 3)
        hi = Vector((-1e18,) * 3)
        for g in self.geo.values():
            if g is None or not g.v:
                continue
            a, b = g.bounds()
            for k in range(3):
                lo[k] = min(lo[k], a[k])
                hi[k] = max(hi[k], b[k])
        return lo, hi

    def fit(self, height: float) -> float:
        """Stand the creature on z = 0 and scale it so it is exactly `height` tall.
        Returns the scale factor that was applied."""
        lo, hi = self.bounds()
        s = height / (hi.z - lo.z)
        for name in self.names:
            g = self.geo[name]
            if g is not None:
                g.move(0, 0, -lo.z).scale(s)
            p = self.pivot[name]
            self.pivot[name] = Vector((p.x * s, p.y * s, (p.z - lo.z) * s))
        return s

    def emit(self) -> None:
        """Create the nodes in the current scene (parents first, as they were added)."""
        for name in self.names:
            mb.node(name, self.geo[name], pivot=self.pivot[name], parent=self.parent[name])
