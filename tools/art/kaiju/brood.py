"""The egg a kaiju hatches from and the cocoon it molts in. Both are 1 m tall and scaled in
code (docs/ASSETS.md section 3), so they are built at unit size, standing on the ground.

Both keep their glow in a child node of its own, so the game can pulse it with the heartbeat:

    kaiju_egg     shell (vcol)   └ egg_glow     the lit crack
    kaiju_cocoon  husk  (vcol)   └ cocoon_glow  the body glowing through the seams

The husk is dark, neutral hide so the same cocoon serves every kaiju kind; its light is the
weak-point color, because a cocooned kaiju takes damage as if staggered.
"""
from __future__ import annotations

import math
import os
import random
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402
import parts  # noqa: E402
from parts import V, tube, spike  # noqa: E402

CREAM = "gragnor_cream"
CREAM_DK = mb.mix("gragnor_cream", "gragnor_cream_dk", 0.5)
ORANGE = "gragnor_orange"
RUST = "gragnor_rust"
HUSK = mb.mix("gragnor_rust_dk", "#3a2420", 0.45)
HUSK_LT = mb.mix("gragnor_rust", "gragnor_orange", 0.30)
HUSK_EDGE = mb.mix("gragnor_orange", "gragnor_cream", 0.25)


def _interp(profile, z: float) -> float:
    """Radius of a (radius, z) profile at height z."""
    for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0) if z1 > z0 else r0
    return profile[-1][0]


def _fit_unit(geos) -> None:
    """Stand the parts on the ground and make them exactly 1 m tall together."""
    lo = min(g.bounds()[0].z for g in geos)
    hi = max(g.bounds()[1].z for g in geos)
    for g in geos:
        g.move(0, 0, -lo).scale(1.0 / (hi - lo))


# =========================================================================================
def build_egg() -> None:
    """A leathery speckled egg with a lit crack down the front: something in there is awake."""
    prof = [(0.0, 0.0), (0.21, 0.035), (0.335, 0.17), (0.385, 0.37), (0.36, 0.58), (0.275, 0.79), (0.14, 0.945),
            (0.0, 1.0)]
    n = 9
    shell = mb.lathe(prof, n=n, phase=10, color=CREAM)
    shell.paint(mb.mix(CREAM_DK, ORANGE, 0.35), where=lambda c, nr: c.z < 0.11)
    shell.paint(CREAM_DK, where=lambda c, nr: 0.11 <= c.z < 0.28)
    # the family markings: a rust zigzag around the belly of the egg, a paler one above it
    parts.zigzag(shell, (0, 0, 0.37), (0, 0, 1), RUST)
    parts.zigzag(shell, (0, 0, 0.79), (0, 0, 1), mb.mix(ORANGE, CREAM, 0.25))
    shell.triangulate()
    rng = random.Random(9001)
    plain = mb.palette.rgb(CREAM)
    for i in range(len(shell.f)):                      # a few freckles
        if shell.col[i] == plain and rng.random() < 0.16:
            shell.col[i] = mb.palette.rgb(mb.mix(CREAM, ORANGE, rng.choice((0.35, 0.6))))
    shell = parts.finish(shell, seed=3, jitter=0.05, top=1.08, bottom=0.72)

    # the crack: a jagged line of light from near the top down the front
    glow = mb.Geo()
    pts = []
    for ang, z in ((-96, 0.93), (-78, 0.83), (-101, 0.73), (-84, 0.63), (-99, 0.52), (-88, 0.44)):
        a = math.radians(ang)
        r = _interp(prof, z) + 0.004
        pts.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    for i in range(len(pts) - 1):
        out = Vector((pts[i].x, pts[i].y, 0.15)).normalized()
        w = 0.05 * (1.0 - 0.12 * i)
        glow += parts.sliver(pts[i], pts[i + 1], w, 0.03, up=out, color="glow_eye" if i % 2 == 0 else "glow_amber")
    # a side branch
    out = Vector((pts[2].x, pts[2].y, 0.15)).normalized()
    a = math.radians(-128)
    r = _interp(prof, 0.66) + 0.004
    glow += parts.sliver(pts[2], Vector((r * math.cos(a), r * math.sin(a), 0.66)), 0.035, 0.03, up=out,
                         color="glow_amber")
    glow.material("glow")
    _fit_unit([shell, glow])
    mb.node("kaiju_egg", shell)
    mb.node("egg_glow", glow, pivot=(0, 0, 0.5), parent="kaiju_egg")


# =========================================================================================
def build_cocoon() -> None:
    """A hunched pod of hardened hide plates, light pulsing through the seams, bone spines
    poking through the back, roots gripping the ground."""
    prof = [(0.26, 0.0), (0.315, 0.20), (0.345, 0.42), (0.295, 0.66), (0.185, 0.87), (0.05, 1.0)]

    def bend(z: float) -> float:              # the pod hunches forward (toward -Y) near the top
        return -0.13 * max(0.0, z - 0.45) ** 1.6 / 0.55 ** 1.6

    def on_pod(a: float, z: float, k: float = 1.0) -> Vector:
        r = _interp(prof, z) * k
        return Vector((r * math.cos(a), r * math.sin(a) + bend(z), z))

    # the glowing body inside
    core_prof = [(r * 0.82, z) for r, z in prof[:-1]] + [(0.0, 0.95)]
    core = mb.lathe(core_prof, n=6, phase=15, color="glow_weak", mat="glow", cap_bottom=False)
    for q in core.v:
        q.y += bend(q.z)
    core.paint("#3fd0e6", where=lambda c, nr: c.z < 0.3)
    core.paint("#d9fdff", where=lambda c, nr: 0.45 < c.z < 0.7)
    core.triangulate()

    husk = mb.Geo()
    # lower plates: five broad petals from the ground to past the middle
    for i in range(5):
        a = math.radians(72 * i + 54)
        zs = (0.0, 0.22, 0.46, 0.70)
        path = [on_pod(a, z, k) for z, k in zip(zs, (1.02, 1.03, 1.05, 1.20))]
        span = (0.80, 0.82, 0.80, 0.34)
        sizes = [(2 * _interp(prof, z) * math.tan(math.radians(33.5)) * s, 0.06) for z, s in zip(zs, span)]
        out = Vector((math.cos(a), math.sin(a), 0.0))
        g = tube(path, sizes, n=4, up=out, cap0="flat", cap1="point", d1=2.2, color=HUSK)
        g.paint(HUSK_LT, where=lambda c, nr, o=out: nr.dot(o) > 0.6)
        parts.bands(g, path[0], path[-1], 3, [HUSK, RUST, None], where=lambda c, nr, o=out: nr.dot(o) > 0.6)
        g.paint(HUSK_EDGE, where=lambda c, nr, o=out: abs(nr.dot(o)) < 0.35 and abs(nr.z) < 0.6)
        husk += g
    # upper plates: four narrower petals that close over the top, tucked under the lower ones
    for i in range(4):
        a = math.radians(90 * i + 10)
        zs = (0.42, 0.62, 0.82, 0.965)
        path = [on_pod(a, z, k) for z, k in zip(zs, (0.95, 0.98, 1.0, 1.25))]
        span = (0.70, 0.80, 0.80, 0.55)
        sizes = [(2 * _interp(prof, z) * math.tan(math.radians(42)) * s, 0.05) for z, s in zip(zs, span)]
        out = Vector((math.cos(a), math.sin(a), 0.35)).normalized()
        g = tube(path, sizes, n=4, up=out, cap0="flat", cap1="point", d1=2.0, color=HUSK)
        g.paint(HUSK_LT, where=lambda c, nr, o=out: nr.dot(o) > 0.6)
        g.paint(HUSK_EDGE, where=lambda c, nr, o=out: abs(nr.dot(o)) < 0.35 and abs(nr.z) < 0.7)
        husk += g
    # spines pushing out through the back seam
    for z, ln in ((0.50, 0.12), (0.64, 0.15), (0.78, 0.13), (0.90, 0.09)):
        base = on_pod(math.radians(90), z, 0.9)
        d = Vector((0, 0.75, 0.66)).normalized()
        husk += spike(base, base + d * (ln + 0.05), ln * 0.55, ln * 0.7, n=4, up=(0, 0, 1), color="bone",
                      root=mb.mix("bone", "bone_dk", 0.6), phase=90)
    # roots: the husk grips the street
    for i in range(5):
        a = math.radians(72 * i + 18)
        p0 = on_pod(a, 0.13, 0.9)
        p1 = Vector((0.40 * math.cos(a), 0.40 * math.sin(a), 0.035))
        p2 = Vector((0.50 * math.cos(a + 0.25), 0.50 * math.sin(a + 0.25), 0.012))
        husk += tube([p0, p1, p2], [0.11, 0.075, 0.03], n=3, up=(0, 0, 1), cap0="open", cap1="point", d1=1.5,
                     color=HUSK)
    husk = parts.finish(husk, seed=5, jitter=0.06, top=1.10, bottom=0.70)
    _fit_unit([husk, core])
    mb.node("kaiju_cocoon", husk)
    mb.node("cocoon_glow", core, pivot=(0, 0, 0.5), parent="kaiju_cocoon")
