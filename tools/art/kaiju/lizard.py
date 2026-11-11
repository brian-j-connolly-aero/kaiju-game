"""Gragnor, the Lizard kaiju: one parametric builder for all three stages.

    build(stage) -> Rig        stage 1 hatchling, 2 juvenile, 3 titan

The three stages are the same character at three ages: the same construction code runs for
each, driven by the proportion table STAGES below (joint positions and thicknesses in
fractions of the creature's height, counts and sizes of spines, teeth, armor and scars).
The result is scaled to the true height (4.5, 32, 115 m) at the end.

Design notes (so the three stay one character):
  - silhouette: hunched brawler; shoulders and a row of bone spines are the high point, the
    head hangs low and forward on a short neck, forearms are bigger than upper arms, the
    legs are short, a thick tail balances the lot.
  - face: heavy underbite jaw with two tusks, a V-shaped brow over glowing yellow eyes.
  - colors: burnt orange hide, rust stripes across back, tail and limbs, cream belly plates,
    bone claws, teeth and spines, and a cyan glowing organ in a dark socket on the chest
    (the weak point; the socket stays visible when the game hides the glow).

Authoring frame: +Z up, -Y forward, +X the creature's left. See tools/art/README.md.
"""
from __future__ import annotations

import math
import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402
import parts  # noqa: E402
from parts import BACK, DOWN, FWD, LEFT, UP, Local, Rig, V, tube, limb, spike, claw  # noqa: E402,F401

# ---- colors -----------------------------------------------------------------------------
ORANGE = "gragnor_orange"
ORANGE_LT = mb.mix("gragnor_orange", "gragnor_orange_lt", 0.45)
ORANGE_DK = mb.mix("gragnor_orange", "gragnor_orange_dk", 0.55)
RUST = "gragnor_rust"
RUST_DK = "gragnor_rust_dk"
CREAM = "gragnor_cream"
CREAM_DK = mb.mix("gragnor_cream", "gragnor_cream_dk", 0.45)
BONE = "bone"
BONE_DK = mb.mix("bone", "bone_dk", 0.6)
MAW = "maw"
MAW_DK = "maw_dk"
TONGUE = "tongue"
SCAR = mb.mix("scar", "tongue", 0.35)
ARMOR = mb.mix("gragnor_rust_dk", "#3b2a2a", 0.35)
ARMOR_LT = mb.mix("gragnor_rust", "gragnor_rust_dk", 0.5)
EYE = "glow_eye"
WEAK = "glow_weak"
WEAK_HOT = "#d9fdff"
SOCKET = mb.mix("maw_dk", "#1b1d24", 0.4)

HEIGHT = {1: 4.5, 2: 32.0, 3: 115.0}

# ---- proportions ------------------------------------------------------------------------
# Lengths are fractions of the creature's height before the final fit; (x, y, z) points are
# x to the creature's left, y to its BACK (forward is negative), z up from the ground.
STAGES = {
    # ---------------------------------------------------------------- 1: hatchling
    1: dict(
        sides=6,
        hip=(0.14, 0.06, 0.31), knee=(0.215, -0.06, 0.19), ankle=(0.215, 0.04, 0.075),
        thigh=(0.20, 0.22), knee_size=0.14, shin_end=0.115, foot_w=0.19, toe_y=-0.10, heel_y=0.12,
        toe_len=0.07, toe_claw=0.06, heel_spur=0.0,
        pelvis=(0, 0.055, 0.32), hip_size=(0.40, 0.26), hip_len=0.10,
        spine=[(0, 0.045, 0.355), (0, 0.02, 0.44), (0, -0.015, 0.525), (0, -0.05, 0.60)],
        torso=[(0.37, 0.31), (0.43, 0.37), (0.44, 0.35), (0.30, 0.25)],
        hump=0.0,
        shoulder=(0.245, -0.115, 0.59), elbow=(0.325, -0.06, 0.445), wrist=(0.31, -0.235, 0.335),
        arm=(0.145, 0.11), forearm=(0.12, 0.105), fore_bulge=0.36, hand=0.125, hand_drop=18,
        finger=0.065, hand_claw=0.085,
        neck=(0, -0.035, 0.60), neck_size=(0.27, 0.24),
        head=dict(at=(0, -0.055, 0.635), L=0.46, pitch=2, skull_w=0.90, skull_h=0.48, snout_w=0.68,
                  snout_h=0.27, brow_y=0.42, snout_y=0.56, jaw_w=1.04, jaw_h=0.23, underbite=0.04,
                  snarl=5.5, tusk=0.14, teeth_up=4, teeth_lo=3, tooth=0.055, eye=0.25, eye_slant=8,
                  pupil=True, brow=0.05, crown=[(0.30, 0.12, 62), (0.12, 0.10, 80)], cheek_spikes=0,
                  chin_spikes=0, nose_horn=0.0, snout_scutes=1),
        tail=[(0, 0.13, 0.305), (0, 0.25, 0.25), (0, 0.365, 0.195), (0, 0.47, 0.145), (0, 0.565, 0.11),
              (0, 0.65, 0.095)],
        tail_w=[0.29, 0.24, 0.185, 0.13, 0.085, 0.035],
        spines=[(0.45, 0.055), (0.66, 0.08), (0.86, 0.085), (1.04, 0.06)], spine_w=1.0, side_spines=0.0,
        tail_spines=[0.05, 0.04, 0.0, 0.0, 0.0], tail_club=0,
        stripes=dict(torso=3, tail=2, limb=False), stripe_color=mb.mix("gragnor_rust", "gragnor_orange", 0.25),
        weak=dict(t=0.42, r=0.058), armor=False, scars=False, elbow_spike=0.0, knee_spike=0.0,
    ),
    # ---------------------------------------------------------------- 2: juvenile
    2: dict(
        sides=6,
        hip=(0.115, 0.05, 0.385), knee=(0.18, -0.075, 0.235), ankle=(0.185, 0.04, 0.08),
        thigh=(0.18, 0.215), knee_size=0.125, shin_end=0.10, foot_w=0.155, toe_y=-0.09, heel_y=0.105,
        toe_len=0.06, toe_claw=0.065, heel_spur=0.04,
        pelvis=(0, 0.045, 0.39), hip_size=(0.31, 0.20), hip_len=0.09,
        spine=[(0, 0.04, 0.43), (0, 0.02, 0.525), (0, -0.005, 0.62), (0, -0.04, 0.715), (0, -0.085, 0.795)],
        torso=[(0.25, 0.21), (0.29, 0.245), (0.37, 0.29), (0.43, 0.31), (0.29, 0.23)],
        hump=0.7,
        shoulder=(0.23, -0.075, 0.745), elbow=(0.315, -0.02, 0.55), wrist=(0.295, -0.195, 0.385),
        arm=(0.145, 0.105), forearm=(0.125, 0.105), fore_bulge=0.45, hand=0.105, hand_drop=20,
        finger=0.07, hand_claw=0.095,
        neck=(0, -0.10, 0.73), neck_size=(0.22, 0.20),
        head=dict(at=(0, -0.17, 0.74), L=0.315, pitch=5, skull_w=0.78, skull_h=0.36, snout_w=0.60,
                  snout_h=0.22, brow_y=0.33, snout_y=0.46, jaw_w=1.10, jaw_h=0.28, underbite=0.06,
                  snarl=7, tusk=0.28, teeth_up=4, teeth_lo=3, tooth=0.085, eye=0.18, eye_slant=22,
                  pupil=False, brow=0.07, crown=[(0.30, 0.30, 50), (0.17, 0.24, 66), (0.0, 0.20, 78)],
                  cheek_spikes=0, chin_spikes=0, nose_horn=0.0, snout_scutes=2),
        tail=[(0, 0.11, 0.375), (0, 0.235, 0.32), (0, 0.36, 0.255), (0, 0.48, 0.19), (0, 0.595, 0.135),
              (0, 0.70, 0.105)],
        tail_w=[0.26, 0.225, 0.18, 0.135, 0.09, 0.035],
        spines=[(0.22, 0.085), (0.40, 0.12), (0.58, 0.16), (0.76, 0.20), (0.93, 0.165), (1.06, 0.11)],
        spine_w=1.1, side_spines=0.0,
        tail_spines=[0.085, 0.07, 0.055, 0.04, 0.0], tail_club=0,
        stripes=dict(torso=5, tail=2, limb=True), stripe_color=RUST,
        weak=dict(t=0.50, r=0.048), armor=False, scars=False, elbow_spike=0.05, knee_spike=0.0,
    ),
    # ---------------------------------------------------------------- 3: titan
    3: dict(
        sides=8,
        hip=(0.125, 0.05, 0.385), knee=(0.20, -0.08, 0.235), ankle=(0.205, 0.045, 0.08),
        thigh=(0.215, 0.25), knee_size=0.15, shin_end=0.12, foot_w=0.185, toe_y=-0.09, heel_y=0.115,
        toe_len=0.065, toe_claw=0.07, heel_spur=0.05,
        pelvis=(0, 0.045, 0.39), hip_size=(0.37, 0.235), hip_len=0.10,
        spine=[(0, 0.04, 0.43), (0, 0.02, 0.52), (0, -0.005, 0.61), (0, -0.045, 0.70), (0, -0.095, 0.775)],
        torso=[(0.31, 0.26), (0.36, 0.30), (0.46, 0.345), (0.53, 0.36), (0.34, 0.26)],
        hump=1.0,
        shoulder=(0.285, -0.08, 0.73), elbow=(0.39, -0.015, 0.54), wrist=(0.365, -0.205, 0.375),
        arm=(0.185, 0.13), forearm=(0.155, 0.13), fore_bulge=0.45, hand=0.125, hand_drop=20,
        finger=0.08, hand_claw=0.11,
        neck=(0, -0.11, 0.71), neck_size=(0.25, 0.22),
        head=dict(at=(0, -0.185, 0.715), L=0.30, pitch=6, skull_w=0.80, skull_h=0.36, snout_w=0.64,
                  snout_h=0.23, brow_y=0.33, snout_y=0.46, jaw_w=1.16, jaw_h=0.33, underbite=0.09,
                  snarl=7.5, tusk=0.36, teeth_up=5, teeth_lo=4, tooth=0.09, eye=0.16, eye_slant=26,
                  pupil=False, brow=0.085,
                  crown=[(0.36, 0.44, 24), (0.33, 0.52, 46), (0.21, 0.46, 64), (0.0, 0.40, 76)],
                  cheek_spikes=3, chin_spikes=2, nose_horn=0.15, snout_scutes=3),
        tail=[(0, 0.115, 0.375), (0, 0.25, 0.32), (0, 0.385, 0.255), (0, 0.515, 0.19), (0, 0.64, 0.135),
              (0, 0.76, 0.105)],
        tail_w=[0.30, 0.26, 0.21, 0.16, 0.115, 0.06],
        spines=[(0.16, 0.10), (0.32, 0.14), (0.48, 0.19), (0.64, 0.24), (0.80, 0.27), (0.95, 0.22),
                (1.08, 0.15)],
        spine_w=1.15, side_spines=0.55,
        tail_spines=[0.12, 0.10, 0.085, 0.065, 0.05], tail_club=4,
        stripes=dict(torso=5, tail=2, limb=True), stripe_color=RUST,
        weak=dict(t=0.50, r=0.046), armor=True, scars=True, elbow_spike=0.09, knee_spike=0.065,
    ),
}


class P:
    """Attribute access to one stage's proportions."""

    def __init__(self, stage: int):
        self.stage = stage
        for k, v in STAGES[stage].items():
            setattr(self, k, v)
        self.h = dict(self.head)


# ---- small helpers ----------------------------------------------------------------------
def _path_at(path, t: float):
    """(point, tangent) at parameter t along a polyline; t in 0..1 over the whole path,
    values outside extrapolate along the first or last stretch."""
    pts = [V(p) for p in path]
    lens = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(lens)
    d = t * total
    if d <= 0:
        tan = (pts[1] - pts[0]).normalized()
        return pts[0] + tan * d, tan
    acc = 0.0
    for i, ln in enumerate(lens):
        if d <= acc + ln or i == len(lens) - 1:
            tan = (pts[i + 1] - pts[i]).normalized()
            return pts[i] + tan * (d - acc), tan
        acc += ln
    raise AssertionError


def _size_at(sizes, path, t: float):
    pts = [V(p) for p in path]
    lens = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(lens)
    d = min(max(t, 0.0), 1.0) * total
    acc = 0.0
    for i, ln in enumerate(lens):
        if d <= acc + ln or i == len(lens) - 1:
            k = (d - acc) / ln
            a, b = sizes[i], sizes[i + 1]
            return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)
        acc += ln
    return sizes[-1]


def _dorsal(tan: Vector) -> Vector:
    """Unit vector pointing out of the back for a spine running along `tan`."""
    x, y = parts.frame(tan, BACK)
    return y


def _skin(g: mb.Geo, belly_dir=None, belly=(0.80, 0.42), seed=1) -> mb.Geo:
    """Base hide colors: cream where the surface looks toward belly_dir, shaded cream on
    the bevels next to it."""
    if belly_dir is not None:
        parts.paint_normal(g, belly_dir, [(belly[0], CREAM), (belly[1], CREAM_DK)])
    return g


# =========================================================================================
# the builder
# =========================================================================================
def build(stage: int) -> Rig:
    p = P(stage)
    rig = Rig()
    n = p.sides
    stripe = p.stripe_color
    rig.empty("root")

    # ------------------------------------------------------------------ hips
    pel = V(p.pelvis)
    hw, hh = p.hip_size
    g = tube([pel + Vector((0, -p.hip_len * 0.5, 0.012)), pel + Vector((0, p.hip_len * 0.5, -0.008))],
             [(hw, hh), (hw * 0.92, hh * 0.95)], n=8, up=UP, cap0="dome", cap1="dome", d0=0.75, d1=0.75,
             color=ORANGE)
    parts.paint_normal(g, (0, -0.45, -1), [(0.80, CREAM)])
    rig.add("hips", parts.finish(g, seed=11), pel, "root")

    # ------------------------------------------------------------------ torso
    sp = [V(q) for q in p.spine]
    g = tube(sp, p.torso, n=8, up=BACK, cap0="dome", cap1="dome", d0=0.7, d1=0.55, color=ORANGE)
    # belly plates: the front facet and its bevels, in alternating bands
    front = V((0, -1, -0.28)).normalized()
    parts.paint_normal(g, front, [(0.84, CREAM)])
    nb = (len(sp) - 1) * 2
    parts.bands(g, sp[0], sp[-1], nb, [None, mb.mix(CREAM, CREAM_DK, 0.55)],
                where=lambda c, nr: nr.dot(front) > 0.84)
    # stripes across the back
    back = -front
    count = p.stripes["torso"]
    if count:
        s0, s1 = sp[0] + (sp[0] - sp[1]) * 0.25, sp[-1]
        parts.bands(g, s0, s1, count * 2, [None, stripe], where=lambda c, nr: nr.dot(back) > 0.30)
        ax = (s1 - s0)

        def flank(c, nr):
            t = (c - s0).dot(ax) / ax.length_squared * count * 2
            return abs(nr.dot(back)) <= 0.30 and int(math.floor(t)) % 2 == 1 and 0 <= t <= count * 2
        parts.sawtooth(g, flank, stripe, which=0)
    torso_g = g

    # trapezius hump between the shoulders: the brawler's hunch
    sh = V(p.shoulder)
    if p.hump:
        k = p.hump
        top_pt, top_tan = _path_at(sp, 0.78)
        dz = _size_at(p.torso, sp, 0.78)[1]
        crest = top_pt + _dorsal(top_tan) * (dz * 0.30) + V((0, 0, 0.02 * k))
        hw_, hd_ = 0.15 + 0.035 * k, 0.13 + 0.03 * k
        g = tube([Vector((-sh.x * 0.80, sh.y + 0.035, sh.z + 0.01)), crest, Vector((sh.x * 0.80, sh.y + 0.035, sh.z + 0.01))],
                 [(hw_, hd_), (hw_ * 1.45, hd_ * 1.30), (hw_, hd_)], n=6, up=UP, cap0="point", cap1="point",
                 d0=0.7, d1=0.7, color=ORANGE)
        parts.bands(g, (-sh.x * 0.8, 0, 0), (sh.x * 0.8, 0, 0), 4, [stripe, None, None, stripe],
                    where=lambda c, nr: nr.z > 0.15 or nr.y > 0.4)
        torso_g += g

    # chest socket: a dark, ribbed hollow that holds the glowing organ
    wk_c, wk_tan = _path_at(sp, p.weak["t"])
    wk_depth = _size_at(p.torso, sp, p.weak["t"])[1]
    ventral = -_dorsal(wk_tan)
    wk_surface = wk_c + ventral * (wk_depth * 0.5)
    r = p.weak["r"]
    side = LEFT
    rim = mb.lathe([(r * 1.75, 0.0), (r * 1.45, r * 0.55), (r * 1.0, r * 0.38)], n=6, color=CREAM_DK,
                   cap_bottom=False, cap_top=True)
    rim.paint(SOCKET, where="top")
    rim.paint(mb.mix(BONE, CREAM_DK, 0.5), where=lambda c, nr: nr.z > 0.2 and c.z > r * 0.4 and
              (c.x ** 2 + c.y ** 2) ** 0.5 > r * 1.02)
    rim.along(wk_surface - ventral * (r * 0.30), wk_surface + ventral * (r * 0.42), side=side, stretch=True)
    torso_g += rim
    rig.add("torso", parts.finish(torso_g, seed=12), sp[0], "hips")

    core = mb.lathe([(r * 0.95, 0.0), (r * 0.78, r * 0.42), (0.0, r * 0.95)], n=6, color=WEAK, mat="glow",
                    cap_bottom=False)
    core.paint(WEAK_HOT, where=lambda c, nr: c.z > r * 0.42)
    core.along(wk_surface - ventral * (r * 0.05), wk_surface + ventral * (r * 0.80), side=side)
    rig.add("weak_point", core.triangulate(), wk_surface, "torso")

    # ------------------------------------------------------------------ dorsal spines
    sg = mb.Geo()
    for i, (t, ln) in enumerate(p.spines):
        c, tan = _path_at(sp, t)
        dz = _size_at(p.torso, sp, t)[1]
        dors = _dorsal(tan)
        if p.hump and 0.62 < t < 1.0:
            dz *= 1.0 + 0.30 * p.hump * (1.0 - abs(t - 0.82) / 0.2) if abs(t - 0.82) < 0.2 else 1.0
        base = c + dors * (dz * 0.5 - ln * 0.12)
        lean = (dors * 0.80 + tan * -0.10 + V((0, 0.10, 0.50))).normalized()
        w = ln * 0.50 * p.spine_w
        sg += spike(base, base + lean * ln, w * 0.78, w, n=4, up=tan, color=BONE, root=BONE_DK, phase=90)
        if p.side_spines and 0.3 < t < 1.0:
            for sx in (-1, 1):
                wt = _size_at(p.torso, sp, t)[0]
                b2 = c + dors * (dz * 0.40) + V((sx * wt * 0.24, 0, 0))
                l2 = ln * p.side_spines
                lean2 = (dors * 0.8 + tan * -0.3 + V((sx * 0.55, 0.15, 0.15))).normalized()
                sg += spike(b2 - lean2 * (l2 * 0.15), b2 + lean2 * l2, l2 * 0.42, l2 * 0.5, n=4, up=tan,
                            color=BONE, root=BONE_DK, phase=90)
    rig.add("spines", parts.finish(sg, seed=13, jitter=0.03), _path_at(sp, 0.7)[0], "torso")

    # ------------------------------------------------------------------ neck
    nk = V(p.neck)
    hd = p.h
    hp = V(hd["at"])
    g = limb(nk, hp, p.neck_size, (p.neck_size[0] * 0.92, p.neck_size[1] * 0.92), n=n, up=UP, d0=0.9, d1=0.7,
             color=ORANGE)
    parts.paint_normal(g, (0, -0.25, -1), [(0.72, CREAM), (0.30, CREAM_DK)])
    rig.add("neck", parts.finish(g, seed=14), nk, "torso")

    # ------------------------------------------------------------------ head and jaw
    _head(rig, p, stripe)

    # ------------------------------------------------------------------ arms (left, mirrored later)
    el, wr = V(p.elbow), V(p.wrist)
    a0, a1 = p.arm
    g = limb(sh, el, (a0, a0 * 1.04), (a1, a1), n=n, up=FWD, bulge=0.10, bulge_at=0.3, d0=1.0, d1=0.9,
             color=ORANGE)
    out = V((1, -0.25, 0.3)).normalized()
    if p.stripes["limb"]:
        parts.sawtooth(g, lambda c, nr: nr.dot(out) > 0.1 and 0.12 < (c - sh).dot(el - sh) / (el - sh).length_squared < 0.95,
                       stripe)
    if p.armor:
        g += _pauldron(sh, a0, stripe)
    rig.add("arm_L", parts.finish(g, seed=21), sh, "torso")

    f0, f1 = p.forearm
    g = limb(el, wr, (f0, f0), (f1 * 0.9, f1 * 0.82), n=n, up=UP, bulge=p.fore_bulge, bulge_at=0.38, d0=1.0,
             d1=0.85, color=ORANGE)
    fdir = (wr - el).normalized()
    topd = (UP - fdir * UP.dot(fdir)).normalized()
    if p.stripes["limb"]:
        parts.bands(g, el, wr, 5, [None, stripe, None, stripe, None],
                    where=lambda c, nr: nr.dot(topd) > -0.15 and nr.dot(fdir) < 0.8)
    if p.elbow_spike:
        g += spike(el + topd * (f0 * 0.1), el - fdir * (f0 * 0.5 + p.elbow_spike) +
                   topd * (p.elbow_spike * 0.45), f0 * 0.55, n=4, up=topd, color=BONE, root=BONE_DK)
    if p.armor:
        for k, t in enumerate((0.22, 0.48, 0.72)):
            c = el.lerp(wr, t)
            rad = f0 * (1.0 + p.fore_bulge * (1.0 - abs(t - 0.38) * 1.6)) * 0.5
            nrm = (topd * 0.75 + V((0.65, 0, 0))).normalized()
            g += parts.scute(c + nrm * rad * 0.93, nrm, f0 * 0.62, f0 * 0.52, f0 * 0.16, along=fdir,
                             color=ARMOR, top=ARMOR_LT)
    rig.add("forearm_L", parts.finish(g, seed=22), el, "arm_L")
    rig.add("hand_L", parts.finish(_hand(p, el, wr), seed=23), wr, "forearm_L")

    # ------------------------------------------------------------------ legs (left, mirrored later)
    hip, kn, an = V(p.hip), V(p.knee), V(p.ankle)
    tw, td = p.thigh
    ks = p.knee_size
    g = limb(hip, kn, (tw, td), (ks, ks * 1.05), n=n, up=FWD, bulge=0.06, bulge_at=0.35, d0=1.0, d1=0.9,
             color=ORANGE)
    outl = V((1, -0.45, 0.2)).normalized()
    if p.stripes["limb"]:
        parts.sawtooth(g, lambda c, nr: nr.dot(outl) > 0.1 and 0.05 < (c - hip).dot(kn - hip) / (kn - hip).length_squared < 0.95,
                       stripe)
    if p.knee_spike:
        kd = (kn - hip).normalized()
        g += spike(kn + V((0, -ks * 0.35, 0.0)), kn + V((0, -ks * 0.5 - p.knee_spike, p.knee_spike * 0.25)),
                   ks * 0.5, n=4, up=UP, color=BONE, root=BONE_DK)
    rig.add("leg_L", parts.finish(g, seed=31), hip, "hips")

    se = p.shin_end
    g = limb(kn, an, (ks * 0.96, ks), (se, se * 1.05), n=n, up=FWD, bulge=0.08, bulge_at=0.3, d0=1.0, d1=0.8,
             color=ORANGE)
    if p.stripes["limb"]:
        parts.bands(g, kn, an, 3, [None, stripe, None], where=lambda c, nr: nr.y > -0.2)
    if p.armor:
        sd = (an - kn).normalized()
        for t in (0.25, 0.6):
            c = kn.lerp(an, t)
            g += parts.scute(c + V((0, -ks * 0.47, 0)), FWD, ks * 0.62, ks * 0.55, ks * 0.14, along=sd,
                             color=ARMOR, top=ARMOR_LT)
    rig.add("shin_L", parts.finish(g, seed=32), kn, "leg_L")
    rig.add("foot_L", parts.finish(_foot(p, an), seed=33), an, "shin_L")

    # ------------------------------------------------------------------ tail
    tp = [V(q) for q in p.tail]
    parent = "hips"
    for i in range(5):
        a, b = tp[i], tp[i + 1]
        w0, w1 = p.tail_w[i], p.tail_w[i + 1]
        last = i == 4
        g = tube([a, a.lerp(b, 0.5), b], [(w0, w0 * 0.98), ((w0 + w1) / 2,) * 2, (w1, w1)], n=n, up=UP,
                 cap0="dome", cap1="point" if last else "dome", d0=0.9, d1=1.6 if last else 0.75, color=ORANGE)
        parts.paint_normal(g, DOWN, [(0.80, CREAM)])
        cnt = p.stripes["tail"]
        if cnt:
            parts.bands(g, a, b, cnt * 2, [None, stripe], where=lambda c, nr: nr.z > -0.2)
        tan = (b - a).normalized()
        up_t = (UP - tan * UP.dot(tan)).normalized()
        ln = p.tail_spines[i]
        if ln:
            for t in ((0.2, 0.7) if i < 3 else (0.4,)):
                c = a.lerp(b, t)
                wd = w0 + (w1 - w0) * t
                k = 1.0 - 0.25 * t
                base = c + up_t * (wd * 0.5 - ln * 0.15)
                g += spike(base, base + (up_t * 0.9 + tan * 0.42).normalized() * (ln * k), ln * 0.5 * k * 0.8,
                           ln * 0.5 * k, n=4, up=tan, color=BONE, root=BONE_DK, phase=90)
        if last and p.tail_club:
            for k in range(p.tail_club):
                ang = math.radians(45 + 90 * k)
                d = (LEFT * math.cos(ang) + up_t * math.sin(ang)).normalized()
                c = a.lerp(b, 0.62)
                wd = w0 + (w1 - w0) * 0.62
                g += spike(c + d * (wd * 0.3), c + (d * 0.92 + tan * 0.4).normalized() * (wd * 0.5 + 0.07),
                           wd * 0.62, n=4, up=tan, color=BONE, root=BONE_DK)
        name = f"tail_{i + 1}"
        rig.add(name, parts.finish(g, seed=40 + i), a, parent)
        parent = name

    # ------------------------------------------------------------------ titan extras
    if p.armor:
        _back_armor(rig, p, sp)
    if p.scars:
        _scars(rig, p, sp)

    # ------------------------------------------------------------------ mirror, anchors
    rig.mirror_left()
    hold = _hand_frame(p, V(p.elbow), V(p.wrist))
    hpos = hold["wrist"] + hold["f"] * (p.hand * 0.75) - hold["u"] * (p.hand * 0.42)
    rig.empty("hold", (-hpos.x, hpos.y, hpos.z), "hand_R")
    return rig


# =========================================================================================
# head
# =========================================================================================
def _head(rig: Rig, p: P, stripe) -> None:
    """Head and jaw, designed lying flat in head units (1 = head length, y forward) and
    pitched into place by Local. Also places the cam_fp and mouth anchors."""
    hd = p.h
    L = hd["L"]
    lf = Local(hd["at"], scale=L, pitch=hd["pitch"])
    sw, sh_ = hd["skull_w"], hd["skull_h"]
    nw, nh = hd["snout_w"], hd["snout_h"]
    y2, y3 = hd["brow_y"], hd["snout_y"]
    ym = (y3 + 0.80) / 2
    lip = -0.10                               # the mouth line (upper lip), head units
    up_h, fwd_h = lf.d(0, 0, 1), lf.d(0, 1, 0)

    # ---- upper head: skull, brow, snout, nose
    rings = [
        lf.ring(-0.16, [(-0.03, sw * 0.30), (0.03, sw * 0.42), (sh_ * 0.45, sw * 0.40), (sh_ * 0.66, sw * 0.22)]),
        lf.ring(-0.04, [(lip + 0.02, sw * 0.70), (0.0, sw * 0.86), (sh_ * 0.52, sw * 0.82), (sh_ * 0.90, sw * 0.46)]),
        lf.ring(0.12, [(lip, sw * 0.84), (0.0, sw), (sh_ * 0.52, sw * 0.95), (sh_, sw * 0.56)]),
        lf.ring(y2, [(lip, sw * 0.82), (0.0, sw * 0.93), (sh_ * 0.50, sw * 0.90), (sh_ * 0.98, sw * 0.60)]),
        lf.ring(y3, [(lip, nw * 0.94), (-0.03, nw), (nh * 0.50, nw * 0.92), (nh, nw * 0.58)]),
        lf.ring(ym, [(lip, nw * 0.88), (-0.03, nw * 0.94), (nh * 0.48, nw * 0.86), (nh, nw * 0.56)]),
        lf.ring(0.80, [(lip + 0.01, nw * 0.80), (-0.03, nw * 0.86), (nh * 0.45, nw * 0.78), (nh, nw * 0.53)]),
        lf.ring(0.91, [(lip + 0.03, nw * 0.62), (-0.03, nw * 0.68), (nh * 0.30, nw * 0.60), (nh * 0.70, nw * 0.40)]),
    ]
    g = mb.loft(rings, color=ORANGE, cap_start=True, cap_end=True)
    g.paint(MAW, where=lambda c, nr: nr.dot(up_h) < -0.9)                 # palate: inside of the mouth
    g.paint(ORANGE_DK, where=lambda c, nr: nr.dot(fwd_h) > 0.9)           # nose pad
    top = lambda c, nr: nr.dot(up_h) > 0.55  # noqa: E731
    parts.bands(g, lf.p(0, -0.04, 0), lf.p(0, y2, 0), 2, [stripe, None], where=top)
    parts.bands(g, lf.p(0, y3, 0), lf.p(0, 0.91, 0), 3, [None, stripe, None],
                where=lambda c, nr: 0.15 < nr.dot(up_h) < 0.9)
    g.paint(ORANGE_LT, where=lambda c, nr: nr.dot(up_h) > 0.9 and (c - lf.p(0, y3, 0)).dot(fwd_h) > 0)
    g.paint(ORANGE_LT, where=lambda c, nr: abs(nr.dot(LEFT)) > 0.55 and (c - lf.p(0, y3, 0)).dot(fwd_h) > 0
            and nr.dot(up_h) < 0.2 and nr.dot(up_h) > -0.5)

    # ---- eyes and brows sit on the facet that drops from the skull to the snout
    es = hd["eye"] * L
    bt = hd["brow"] * L
    for sx in (1, -1):
        A = lf.p(sx * sw * 0.45, y2, sh_ * 0.50)
        B = lf.p(sx * sw * 0.30, y2, sh_ * 0.98)
        C = lf.p(sx * nw * 0.29, y3, nh)
        D = lf.p(sx * nw * 0.46, y3, nh * 0.50)
        nrm = (C - A).cross(D - B).normalized()
        if nrm.dot(lf.d(sx, 0.4, 0.4)) < 0:
            nrm = -nrm
        axis = ((D - A).normalized() + (C - B).normalized()).normalized()      # along the brow, front end lower
        c = (A + B + C + D) / 4 + (A + D - B - C) * 0.06
        eh = es * (0.66 if hd["pupil"] else 0.44)
        eye = mb.tapered_box((es, eh), (es * 0.70, eh * 0.62), 1.0, color=EYE, mat="glow", cap_bottom=False)
        g += eye.along(c - nrm * (es * 0.25), c + nrm * (es * 0.20), side=axis)
        if hd["pupil"]:
            pu = mb.tapered_box((es * 0.16, eh * 0.60), (es * 0.12, eh * 0.52), 1.0, color="black", cap_bottom=False)
            g += pu.along(c + nrm * (es * 0.13), c + nrm * (es * 0.235), side=axis)
        # brow ridge: a wedge from the outer corner of the skull down to the middle of the
        # stop, so the two together make an angry V over the eyes
        b0 = lf.p(sx * sw * 0.40, y2 - 0.015, sh_ * 0.93)
        b1 = lf.p(sx * nw * 0.10, y3 + 0.03, nh + 0.02)
        g += mb.beam(b0, b1, (bt * 1.7, bt * 1.25), (bt * 1.05, bt * 0.7), color=RUST, side=lf.d(sx * 0.45, 0.9, 0.0))
    # ---- nostrils: two bumps on the nose, dark on the front
    for sx in (1, -1):
        nb = mb.tapered_box((0.085 * L, 0.12 * L), (0.04 * L, 0.05 * L), 0.042 * L, offset=(0, -0.02 * L),
                            color=ORANGE_DK)
        nb.paint(MAW_DK, where="front")
        g += nb.rx(hd["pitch"]).move(lf.p(sx * min(nw * 0.165, 0.092), 0.805, nh * 0.93))
    # ---- scutes down the bridge of the snout (this is what the player looks at all game)
    ns = hd["snout_scutes"]
    for i in range(ns):
        y = y3 + 0.075 + (0.74 - y3 - 0.075) * (i / max(ns - 1, 1) if ns > 1 else 0.35)
        k = 1.0 - 0.22 * i
        g += parts.scute(lf.p(0, y, nh * 0.97), up_h, 0.15 * L * k * (nw / 0.5), 0.11 * L * k, 0.035 * L, along=fwd_h,
                         color=RUST, top=RUST, taper=0.5)
    if hd["nose_horn"]:
        hn = hd["nose_horn"] * L
        base = lf.p(0, 0.80, nh * 0.86)
        g += spike(base, base + lf.d(0, 0.30, 1) * hn, hn * 0.60, hn * 0.80, n=4, up=fwd_h, color=BONE,
                   root=BONE_DK, phase=90)
    # ---- upper teeth along the lip
    tl = hd["tooth"] * L
    down = lf.d(0, 0, -1)
    for sx in (1, -1):
        a = lf.p(sx * nw * 0.455, y3 + 0.01, lip + 0.012)
        b = lf.p(sx * nw * 0.385, 0.81, lip + 0.02)
        g += parts.teeth(a, b, hd["teeth_up"], tl, tl * 0.62, down, seed=3 + sx)
    g += parts.teeth(lf.p(nw * 0.30, 0.895, lip + 0.035), lf.p(-nw * 0.30, 0.895, lip + 0.035), 3, tl * 0.9,
                     tl * 0.62, down, seed=5)
    # ---- crown: spikes sweeping back from the rim of the skull
    for (cx, ln, ang) in hd["crown"]:
        for sx in ((1, -1) if cx else (1,)):
            a = math.radians(ang)
            base = lf.p(sx * cx * sw * 1.02, -0.02, sh_ * (0.95 - cx * 1.15))
            d = lf.d(sx * math.cos(a) * 0.9 * (1 if cx else 0), -0.62 - 0.3 * (1 - math.cos(a)), math.sin(a))
            w = ln * 0.36 * L
            g += spike(base - d * (ln * 0.25 * L), base + d * (ln * L), w, w * 1.25, n=4, up=lf.d(0, 1, 0.2),
                       color=BONE, root=BONE_DK if ln > 0.3 else None, phase=90)
    rig.add("head", parts.finish(g, seed=15), hd["at"], "neck")

    # ---- jaw: heavy, wider than the snout, jutting forward, tusks at the front corners
    jw = hd["jaw_w"]
    jh = hd["jaw_h"]
    ub = hd["underbite"]
    top_z = lip - 0.035
    hinge = (0.0, 0.02, lip - 0.02)
    jx = 0.91 + ub
    jr = [
        lf.ring(-0.10, [(top_z - jh * 0.42, sw * 0.36 * jw), (top_z - jh * 0.30, sw * 0.62 * jw),
                        (top_z - jh * 0.12, sw * 0.74 * jw), (top_z, sw * 0.60 * jw)]),
        lf.ring(0.14, [(top_z - jh * 0.68, sw * 0.46 * jw), (top_z - jh * 0.44, sw * 0.80 * jw),
                       (top_z - jh * 0.16, sw * 0.93 * jw), (top_z, sw * 0.84 * jw)]),
        lf.ring(y3 + 0.02, [(top_z - jh * 0.92, nw * 0.60 * jw), (top_z - jh * 0.58, nw * 0.92 * jw),
                            (top_z - jh * 0.22, nw * 1.02 * jw), (top_z, nw * 0.96 * jw)]),
        lf.ring(0.80 + ub * 0.6, [(top_z - jh * 1.0, nw * 0.56 * jw), (top_z - jh * 0.62, nw * 0.84 * jw),
                                  (top_z - jh * 0.22, nw * 0.92 * jw), (top_z, nw * 0.84 * jw)]),
        lf.ring(jx, [(top_z - jh * 0.80, nw * 0.42 * jw), (top_z - jh * 0.50, nw * 0.62 * jw),
                     (top_z - jh * 0.15, nw * 0.70 * jw), (top_z + 0.0, nw * 0.62 * jw)]),
    ]
    j = mb.loft(jr, color=ORANGE, cap_start=True, cap_end=True)
    j.paint(MAW, where=lambda c, nr: nr.dot(up_h) > 0.9)
    parts.paint_normal(j, lf.d(0, 0.10, -1), [(0.80, CREAM), (0.30, CREAM_DK)])
    j.paint(CREAM_DK, where=lambda c, nr: nr.dot(fwd_h) > 0.9)
    # tongue
    tw_ = L * nw / 0.5
    j += tube([lf.p(0, 0.22, top_z + 0.005), lf.p(0, 0.56, top_z + 0.022), lf.p(0, jx - 0.15, top_z + 0.012)],
              [(0.25 * tw_, 0.04 * L), (0.23 * tw_, 0.05 * L), (0.11 * tw_, 0.03 * L)],
              n=4, up=up_h, cap0="open", cap1="point", d1=1.2, color=TONGUE)
    # lower teeth and the tusks
    upv = lf.d(0, -0.05, 1)
    tk = hd["tusk"]
    for sx in (1, -1):
        a = lf.p(sx * nw * 0.455 * jw, y3 + 0.06, top_z - 0.005)
        b = lf.p(sx * nw * 0.40 * jw, 0.79 + ub * 0.5, top_z - 0.005)
        j += parts.teeth(a, b, hd["teeth_lo"], tl * 0.95, tl * 0.62, upv, seed=7 + sx)
        tb = lf.p(sx * nw * 0.325 * jw, jx - 0.085, top_z - 0.03)
        tt = lf.p(sx * nw * 0.37 * jw, jx - 0.05, top_z + tk)
        j += claw(tb, tt, tk * 0.36 * L, lf.d(sx * 0.4, -1, 0), n=4, color=BONE, up=fwd_h, bend=0.16)
    j += parts.teeth(lf.p(nw * 0.17 * jw, jx - 0.035, top_z - 0.005), lf.p(-nw * 0.17 * jw, jx - 0.035, top_z - 0.005),
                     2, tl * 0.8, tl * 0.58, upv, seed=9)
    for k in range(hd["chin_spikes"]):
        for sx in (1, -1):
            b0 = lf.p(sx * nw * 0.20 * jw, jx - 0.06 - 0.22 * k, top_z - jh * 0.80)
            j += spike(b0, b0 + lf.d(sx * 0.25, 0.45, -1) * (0.13 * L), 0.075 * L, n=4, up=fwd_h, color=BONE)
    for k in range(hd["cheek_spikes"]):
        for sx in (1, -1):
            b0 = lf.p(sx * sw * (0.46 - 0.02 * k) * jw, 0.10 + 0.13 * k, top_z - jh * (0.28 + 0.06 * k))
            ln = (0.20 - 0.035 * k) * L
            j += spike(b0 - lf.d(sx, -0.3, -0.1) * (ln * 0.2), b0 + lf.d(sx * 1.0, -0.62, -0.18) * ln, ln * 0.42,
                       n=4, up=fwd_h, color=BONE)
    # the rest pose is a slight snarl: mouth a little open so both rows of teeth show
    hinge_m = lf.p(*hinge)
    j.rot(LEFT, -hd["snarl"], about=hinge_m)
    rig.add("jaw", parts.finish(j, seed=16), hinge_m, "head")

    # ---- anchors: the camera sits just above the stop of the snout, between the eyes
    rig.empty("cam_fp", lf.p(0, y3 + 0.01, nh + hd.get("cam_up", 0.06)), "head")
    rig.empty("mouth", lf.p(0, 0.93, lip - 0.06), "head")


# =========================================================================================
# hands and feet
# =========================================================================================
def _hand_frame(p: P, el: Vector, wr: Vector) -> dict:
    """Axes of the left hand: f along the fingers, u out of the back of the hand, s across
    the palm toward the body's center line (the thumb side)."""
    fd = (wr - el).normalized()
    side = fd.cross(UP).normalized()
    drop = math.radians(p.hand_drop)
    f = (fd * math.cos(drop) - side.cross(fd).normalized() * math.sin(drop)).normalized()
    u = side.cross(f).normalized()
    if u.z < 0:
        u = -u
    s = f.cross(u).normalized()
    if s.x > 0:
        s = -s
    return dict(wrist=wr, f=f, u=u, s=s)


def _hand(p: P, el: Vector, wr: Vector) -> mb.Geo:
    """Left hand: palm, three clawed fingers and a thumb. Pivot is the wrist."""
    fr = _hand_frame(p, el, wr)
    f, u, s = fr["f"], fr["u"], fr["s"]
    hs = p.hand
    pw, ph = hs * 1.30, hs * 0.74
    g = tube([wr, wr + f * (hs * 0.62)], [(pw * 0.80, ph), (pw, ph * 0.92)], n=6, up=u, cap0="dome", cap1="blunt",
             d0=0.8, d1=0.75, color=ORANGE)
    parts.paint_normal(g, -u, [(0.7, CREAM_DK)])
    digit = RUST if p.stripes["limb"] else ORANGE_DK
    fl, cl = p.finger, p.hand_claw
    fw = hs * 0.42
    for k in (-1, 0, 1):
        splay = (f + s * (-k * 0.28) - u * 0.12).normalized()
        base = wr + f * (hs * 0.55) + s * (-k * pw * 0.31)
        knuckle = base + splay * (fl + hs * 0.25)
        g += tube([base, knuckle], [(fw, fw * 0.95), (fw * 0.88, fw * 0.82)], n=4, up=u, cap0="flat", cap1="flat",
                  color=digit)
        tip = knuckle + (splay * 0.84 - u * 0.55).normalized() * cl
        g += claw(knuckle - splay * (fl * 0.25), tip, fw * 0.72, -u, n=4, color=BONE, up=u, root=BONE_DK)
    tdir = (f * 0.45 + s * 0.85 - u * 0.25).normalized()
    base = wr + f * (hs * 0.36) + s * (pw * 0.36)
    kn = base + tdir * (fl * 0.8)
    g += tube([base, kn], [(fw, fw), (fw * 0.86, fw * 0.8)], n=4, up=u, cap0="flat", cap1="flat", color=digit)
    g += claw(kn - tdir * (fl * 0.2), kn + (tdir * 0.8 + f * 0.35 - u * 0.45).normalized() * (cl * 0.8), fw * 0.70, -u,
              n=4, color=BONE, up=u, root=BONE_DK)
    return g


def _foot(p: P, an: Vector) -> mb.Geo:
    """Left foot: flat-soled wedge, three clawed toes, heel. Pivot is the ankle."""
    fw = p.foot_w
    h = an.z
    sole = [(-0.5, -0.5), (0.5, -0.5), (0.5, -0.05), (0.26, 0.5), (-0.26, 0.5), (-0.5, -0.05)]
    x = an.x
    y_toe, y_heel = an.y + p.toe_y - 0.06, an.y + p.heel_y - 0.06
    hz = h * 0.95
    g = tube([(x, y_heel, hz * 0.36), (x, an.y + 0.01, hz * 0.62), (x * 1.04, y_toe, hz * 0.34)],
             [(fw * 0.62, hz * 0.72), (fw * 0.94, hz * 1.24), (fw * 1.10, hz * 0.68)],
             prof=sole, up=UP, cap0="blunt", cap1="flat", d0=0.8, color=ORANGE)
    g.paint(ORANGE_DK, where="bottom")
    # ankle ball, so the shin can swing without a gap
    g += tube([an + V((0, 0.0, -h * 0.25)), an + V((0, 0, h * 0.10))], [p.shin_end * 1.04, p.shin_end * 1.0], n=6,
              up=FWD, cap0="flat", cap1="point", d1=0.9, color=ORANGE)
    digit = RUST if p.stripes["limb"] else ORANGE_DK
    tl, cl = p.toe_len, p.toe_claw
    tw = fw * 0.42
    for k in (-1, 0, 1):
        d = V((k * 0.30, -1, 0)).normalized()
        base = V((x * 1.04 + k * fw * 0.34, y_toe + 0.012, hz * 0.31))
        end = base + d * tl + V((0, 0, -hz * 0.06))
        g += tube([base, end], [(tw, hz * 0.62), (tw * 0.88, hz * 0.50)], n=4, up=UP, cap0="flat", cap1="flat",
                  color=digit)
        g += claw(end - d * (tl * 0.3) + V((0, 0, hz * 0.02)), end + d * cl + V((0, 0, -hz * 0.19)), tw * 0.78, DOWN,
                  n=4, color=BONE, up=UP, bend=0.22, root=BONE_DK)
    if p.heel_spur:
        b0 = V((x, y_heel + 0.005, hz * 0.42))
        g += spike(b0 - V((0, 0.02, 0)), b0 + V((0, p.heel_spur, hz * 0.10)), tw * 0.8, n=4, up=UP, color=BONE)
    return g


# =========================================================================================
# titan extras: armor and scars
# =========================================================================================
def _pauldron(sh: Vector, a0: float, stripe) -> mb.Geo:
    """Layered shoulder plates with a spike: the titan's armor."""
    g = mb.Geo()
    out = V((0.80, 0.05, 0.60)).normalized()
    for k, (t, s) in enumerate(((0.0, 1.0), (0.42, 0.78))):
        c = sh + out * (a0 * 0.44) + V((0.012 * k, 0, -a0 * t * 0.8))
        g += parts.scute(c, (out + V((0.25 * k, 0, -0.3 * k))).normalized(), a0 * 0.95 * s, a0 * 1.0 * s, a0 * 0.20,
                         along=FWD, color=ARMOR, top=ARMOR_LT, taper=0.6, closed=True)
    g += spike(sh + out * (a0 * 0.50), sh + out * (a0 * 0.50) + (out * 0.9 + V((0.25, 0.1, 0.3))).normalized() * (a0 * 0.62),
               a0 * 0.34, n=4, up=FWD, color=BONE, root=BONE_DK)
    return g


def _back_armor(rig: Rig, p: P, sp) -> None:
    """Rows of dark scutes down the titan's back, either side of the spines."""
    g = mb.Geo()
    for t in (0.20, 0.36, 0.52, 0.68, 0.84):
        c, tan = _path_at(sp, t)
        w, d = _size_at(p.torso, sp, t)
        dors = _dorsal(tan)
        for sx in (-1, 1):
            nrm = (dors * 0.80 + V((sx * 0.60, 0, 0))).normalized()
            pos = c + dors * (d * 0.385) + V((sx * w * 0.335, 0, 0))
            g += parts.scute(pos, nrm, w * 0.20, w * 0.17, w * 0.045, along=tan, color=ARMOR, top=ARMOR_LT)
    rig.more("torso", parts.finish(g, seed=51))


def _scars(rig: Rig, p: P, sp) -> None:
    """Old wounds: claw marks across the chest, a slash through the left brow, a broken spine tip."""
    g = mb.Geo()
    c, tan = _path_at(sp, 0.43)
    w, d = _size_at(p.torso, sp, 0.43)
    ventral = -_dorsal(tan)
    for k in range(3):
        a = c + ventral * (d * 0.44) + V((-w * 0.30, 0, 0)) + tan * (0.035 * k - 0.045)
        b = c + ventral * (d * 0.515) + V((w * 0.10, 0, 0)) + tan * (0.035 * k - 0.085)
        b2 = c + ventral * (d * 0.44) + V((w * 0.30, 0, 0)) + tan * (0.035 * k - 0.120)
        g += parts.sliver(a, b, 0.016, 0.022, up=ventral, color=SCAR)
        g += parts.sliver(b, b2, 0.014, 0.020, up=ventral, color=SCAR)
    rig.more("torso", parts.finish(g, seed=52, jitter=0.02))


# =========================================================================================
# poses (degrees, in the game's axes: x+ nose down, y+ turn left, z+ left side up)
# =========================================================================================
def _arms(x, y, z, fore, hand=0.0) -> dict:
    """Both arms raised the same way (y and z mirror for the right arm)."""
    return {"arm_L": {"x": x, "y": y, "z": z}, "arm_R": {"x": x, "y": -y, "z": -z},
            "forearm_L": {"x": fore}, "forearm_R": {"x": fore}, "hand_L": {"x": hand}, "hand_R": {"x": hand}}


# Claws up in front of the face: what the player sees of their own hands. The head hangs
# low and forward, so the hands only enter the view when the arms are thrown forward: swing
# up (x), turn the elbow out (y), bring the hands together (z), straighten the elbow.
# Found by inverse kinematics for each stage's proportions (left arm; the right mirrors).
FP_POSE = {
    1: _arms(-112, 46, -9, 60, -25),
    2: _arms(-75, 46, -24, 25, -25),
    3: _arms(-59, 47, -40, 19, -25),
}

POSES = {
    "fp": FP_POSE[2],
    "roar": {"hips": {"x": -4}, "torso": {"x": -12}, "neck": {"x": -16}, "head": {"x": -22}, "jaw": {"x": 30},
             "arm_L": {"x": 18, "z": 34}, "arm_R": {"x": 18, "z": -34}, "forearm_L": {"x": -38},
             "forearm_R": {"x": -38}, "hand_L": {"x": -20}, "hand_R": {"x": -20},
             "tail_1": {"y": 10, "x": -6}, "tail_2": {"y": 12}, "tail_3": {"y": 14}, "tail_4": {"y": 16},
             "tail_5": {"y": 16}, "leg_L": {"x": -16}, "shin_L": {"x": 14}, "foot_L": {"x": 2},
             "leg_R": {"x": 12}, "shin_R": {"x": 4}, "foot_R": {"x": -16}},
    "swipe": {"hips": {"y": -10}, "torso": {"y": -28, "x": 10}, "neck": {"y": 12}, "head": {"y": 14, "x": -6},
              "jaw": {"x": 16}, "arm_R": {"x": -80, "y": 30, "z": -10}, "forearm_R": {"x": -30},
              "hand_R": {"x": -25}, "arm_L": {"x": 30, "z": 22}, "forearm_L": {"x": -50},
              "tail_1": {"y": -12}, "tail_2": {"y": -14}, "tail_3": {"y": -14}, "tail_4": {"y": -12},
              "leg_R": {"x": -30}, "shin_R": {"x": 26}, "leg_L": {"x": 14}, "shin_L": {"x": 6}, "foot_L": {"x": -20}},
    # every joint bent hard, to check that no gap opens
    "torture": {"torso": {"x": 25, "y": 25}, "neck": {"y": 40}, "head": {"y": 50, "x": -20}, "jaw": {"x": 40},
                "arm_L": {"x": -60, "z": 30}, "forearm_L": {"x": -60}, "hand_L": {"x": -60},
                "arm_R": {"x": 60, "z": -40}, "forearm_R": {"x": 60}, "hand_R": {"x": 60},
                "leg_L": {"x": -60}, "shin_L": {"x": 60}, "foot_L": {"x": -40},
                "leg_R": {"x": 50}, "shin_R": {"x": -30}, "foot_R": {"x": 40},
                "tail_1": {"y": 30}, "tail_2": {"y": 40}, "tail_3": {"y": 50}, "tail_4": {"y": 60}, "tail_5": {"y": 60}},
}
