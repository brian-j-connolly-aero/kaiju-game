"""The egg a kaiju hatches from and the cocoon it molts in. Both are 1 m tall and scaled in
code (docs/ASSETS.md section 3), so they are built at unit size, standing on the ground.

Both keep their glow in a child node of its own, so the game can pulse it with the heartbeat:

    kaiju_egg     shell (vcol)   └ egg_glow     the lit crack
    kaiju_cocoon  husk  (vcol)   └ cocoon_glow  the body glowing through the seams

The husk is hardened hide in the kaiju's own scheme: HUSKS holds one set of colors per kind
(only Gragnor's so far). When the Tier 2 kinds arrive, either add their schemes here and
build one cocoon per kind (build_cocoon("crab") -> kaiju_cocoon_crab), or author the husk
pale and tint it in code. The light inside is the weak-point color (violet-white, see
parts.py), because a cocooned kaiju takes damage as if staggered.
"""
from __future__ import annotations

import math
import os
import random
import sys


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402
from mathutils import Vector  # noqa: E402  (available once bpy is loaded)
import parts  # noqa: E402
from parts import tube, spike  # noqa: E402

CREAM = "gragnor_cream"
CREAM_DK = mb.mix("gragnor_cream", "gragnor_cream_dk", 0.5)
ORANGE = "gragnor_orange"
RUST = "gragnor_rust"
MAW_DK = "maw_dk"
CRACK = mb.mix("glow_amber", "glow_ember", 0.5)        # the light in the egg: the kaiju's own orange heat
# husk colors per kaiju kind: the plates, their lit faces, their edges, the band across them
HUSKS = {
    "lizard": dict(husk=mb.mix("gragnor_rust_dk", "#3a2420", 0.45), lt=mb.mix("gragnor_rust", "gragnor_orange", 0.30),
                   edge=mb.mix("gragnor_orange", "gragnor_cream", 0.25), band=RUST),
}


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
    """A leathery, freckled egg with one rust band and a lit split down the front: something
    in there is awake. Played straight: a reptile's egg, not a painted one."""
    prof = [(0.0, 0.0), (0.21, 0.035), (0.335, 0.17), (0.385, 0.37), (0.36, 0.58), (0.275, 0.79), (0.14, 0.945),
            (0.0, 1.0)]
    n, phase = 9, 10
    shell = mb.lathe(prof, n=n, phase=phase, color=CREAM)
    shell.paint(mb.mix(CREAM_DK, ORANGE, 0.35), where=lambda c, nr: c.z < 0.11)
    shell.paint(CREAM_DK, where=lambda c, nr: 0.11 <= c.z < 0.28)
    # the family marking: one rust zigzag around the belly of the egg; the ring above it is
    # only a shade off the shell (a second full-contrast band made it a harlequin)
    parts.zigzag(shell, (0, 0, 0.37), (0, 0, 1), RUST)
    parts.zigzag(shell, (0, 0, 0.79), (0, 0, 1), mb.mix(CREAM, RUST, 0.15))
    shell.triangulate()
    rng = random.Random(9001)
    plain = mb.palette.rgb(CREAM)
    for i in range(len(shell.f)):                      # freckles, darker toward brown
        if shell.col[i] == plain and rng.random() < 0.30:
            shell.col[i] = mb.palette.rgb(mb.mix(CREAM_DK, RUST, rng.choice((0.22, 0.40))))

    def surface(ang: float, z: float, lift: float = 0.0) -> Vector:
        """A point on the faceted shell (not on the round one its corners lie on)."""
        a = math.radians(ang)
        mid = phase + 180.0 / n + round((ang - phase - 180.0 / n) / (360.0 / n)) * (360.0 / n)   # facet center
        r = _interp(prof, z) * math.cos(math.pi / n) / math.cos(math.radians(ang - mid)) + lift
        return Vector((r * math.cos(a), r * math.sin(a), z))

    # the split: one jagged seam of light from near the top down the front, with a branch,
    # sunk into the shell inside a dark edge, so it reads as a crack in the shell and not as
    # something stuck on it. Amber, the kaiju's own heat: yellow belongs to the volleys.
    out = Vector((0.0, -1.0, 0.22)).normalized()

    def seam(turns, w):
        pts = [surface(ang, z) for ang, z in turns]
        k = len(pts) - 1
        wide = [w * (0.12 if i in (0, k) else 1.0 - 0.10 * i) for i in range(k + 1)]
        light = tube([q + out * 0.004 for q in pts], [(x, 0.012) for x in wide], n=3, up=out, cap0="point",
                     cap1="point", d0=2.0, d1=2.0, color=CRACK)
        dark = tube([q + out * 0.001 for q in pts], [(x * 2.1 + 0.006, 0.008) for x in wide], n=3, up=out,
                    cap0="point", cap1="point", d0=2.0, d1=2.0, color=MAW_DK)
        return light, dark

    glow, edge = seam(((-95, 0.935), (-81, 0.84), (-99, 0.74), (-84, 0.64), (-97, 0.53), (-89, 0.445)), 0.034)
    branch, branch_edge = seam(((-99, 0.74), (-106, 0.69), (-103, 0.635)), 0.024)
    glow += branch
    edge += branch_edge
    glow.paint("glow_ember", where=lambda c, nr: c.z < 0.50 or c.z > 0.90)
    glow.paint("glow_amber", where=lambda c, nr: 0.70 < c.z < 0.78 and c.x > -0.06)    # the hot spot where it forks
    glow.material("glow")
    shell += edge.triangulate()
    shell = parts.finish(shell, seed=3, jitter=0.05, top=1.08, bottom=0.72)
    _fit_unit([shell, glow])
    mb.node("kaiju_egg", shell)
    mb.node("egg_glow", glow, pivot=(0, 0, 0.5), parent="kaiju_egg")


# =========================================================================================
def build_cocoon(kind: str = "lizard") -> None:
    """A hunched pod of hardened hide plates, light pulsing through the seams, bone spines
    poking through the back, roots gripping the ground. `kind` picks the husk colors."""
    scheme = HUSKS[kind]
    HUSK, HUSK_LT, HUSK_EDGE, BAND = scheme["husk"], scheme["lt"], scheme["edge"], scheme["band"]
    prof = [(0.26, 0.0), (0.315, 0.20), (0.345, 0.42), (0.295, 0.66), (0.185, 0.87), (0.05, 1.0)]

    def bend(z: float) -> float:              # the pod hunches forward (toward -Y) near the top
        return -0.13 * max(0.0, z - 0.45) ** 1.6 / 0.55 ** 1.6

    def on_pod(a: float, z: float, k: float = 1.0) -> Vector:
        r = _interp(prof, z) * k
        return Vector((r * math.cos(a), r * math.sin(a) + bend(z), z))

    # the glowing body inside: wide enough to plug the seams between the plates from every
    # angle (a narrower one let the inside of the husk show from above)
    core_prof = [(r * 0.88, z) for r, z in prof[:-1]] + [(0.0, 0.95)]
    core = mb.lathe(core_prof, n=6, phase=15, color=parts.WEAK, mat="glow", cap_bottom=False)
    for q in core.v:
        q.y += bend(q.z)
    core.paint(parts.WEAK_DIM, where=lambda c, nr: c.z < 0.3)
    core.paint(parts.WEAK_HOT, where=lambda c, nr: 0.45 < c.z < 0.7)
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
        parts.bands(g, path[0], path[-1], 3, [HUSK, BAND, None], where=lambda c, nr, o=out: nr.dot(o) > 0.6)
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
        husk += tube([p0, p1, p2], [0.11, 0.075, 0.03], n=3, up=(0, 0, 1), cap0="flat", cap1="point", d1=1.5,
                     color=HUSK)        # closed at the pod end: an open start showed its inside from above
    husk = parts.finish(husk, seed=5, jitter=0.06, top=1.10, bottom=0.70)
    _fit_unit([husk, core])
    mb.node("kaiju_cocoon", husk)
    mb.node("cocoon_glow", core, pivot=(0, 0, 0.5), parent="kaiju_cocoon")
