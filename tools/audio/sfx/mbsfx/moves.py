"""The monster's moves from the molt cards and the attack looks (docs/ROADMAP.md phases 1 and 3):
the two-claw rake, the hop onto both feet, the tail sweep, the charge (its bellow and launch) and
the stumble it ends in (three falls, one per look), and the gulp of a handful of civilians.

Every one comes at the three sizes of the swipe and the stomp (kaiju.py), longer, lower and
louder at each stage, except the gulp, which is one size played at the stage's rate. The voice in
the bellow, the grunts and the groans is the Lizard's own (`voice`), so it is the same animal as
its roar.
"""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import SR, n_
from .kaiju import _ground as ground
from .kaiju import voice
from .registry import sfx

SIZE = {1: 0.72, 2: 1.0, 3: 1.42}                 # throat size, as in the roar


def _space(rng: np.random.Generator, stage: int, x: np.ndarray, wet: float | None = None) -> np.ndarray:
    """The street, the district, the city: the same rooms the stomp rings in."""
    ir = dsp.space_ir(rng, {1: 0.45, 2: 0.9, 3: 1.7}[stage], pre=0.012 * stage, bright=4500 / stage, dark=450,
                      echoes=((0.1 * stage, 0.28, 2400.0 / stage), (0.17 * stage, 0.18, 1500.0 / stage)), low_cut=50.0)
    return dsp.reverb(x, ir, {1: 0.14, 2: 0.19, 3: 0.25}[stage] if wet is None else wet)


def _impact(rng: np.random.Generator, n: int, stage: int, tune: float = 1.0, weight: float = 1.0) -> np.ndarray:
    """A heavy body part meeting the asphalt: the stomp's boom and burst, a size smaller or larger."""
    f_hi, f_lo = {1: (125.0, 52.0), 2: (88.0, 34.0), 3: (64.0, 23.0)}[stage]
    low = parts.thump(n, f_hi * tune, f_lo * tune, 0.05 * stage, {1: 0.36, 2: 0.78, 3: 1.45}[stage] * weight,
                      attack=0.002 + 0.002 * stage, harm=0.35, sat=2.2)
    hit = parts.burst(n, rng, {1: 5500, 2: 3200, 3: 1900}[stage], {1: 330, 2: 170, 3: 95}[stage] * tune, 0.03 * stage,
                      {1: 0.18, 2: 0.36, 3: 0.7}[stage] * weight)
    return low + 0.85 * hit


def _cracks(rng: np.random.Generator, n: int, stage: int, count: int, spread: float) -> np.ndarray:
    out = np.zeros(n)
    for _ in range(count):
        dsp.put(out, dsp.click(rng, 1200 / stage, 8000 / stage, 0.02 * stage), rng.uniform(0, spread), rng.uniform(0.5, 1))
    return out


# ---- the two-claw rake (swipe look 2) ------------------------------------------------------------
# when each whoosh is at its loudest (seconds): the client starts it that long before the strike
RAKE_PEAK = {1: 0.13, 2: 0.2, 3: 0.33}


def _rake(rng: np.random.Generator, stage: int) -> np.ndarray:
    """Both claws raked down together: two of the swipe's flanged cuts a moment apart, pitched
    downward with the stroke, much more body, and a ragged tear of air at the bottom."""
    dur = {1: 0.52, 2: 0.82, 3: 1.3}[stage]
    tp = RAKE_PEAK[stage]
    n = n_(dur)
    fa, fb, fc_ = {1: (1100, 3400, 700), 2: (560, 1800, 320), 3: (250, 860, 130)}[stage]
    gap = 0.05 * stage ** 0.7                                 # one claw, then the other: two cuts, heard as two
    out = np.zeros(n + n_(gap))
    for shift, tune, g in ((0.0, 1.0, 0.9), (gap, 0.88, 1.0)):
        path = dsp.env([(0, fa * tune), (tp, fb * tune), (dur, fc_ * tune)], n, "exp")
        # each cut is short, so that the second is heard as a second cut and not as more of the first
        cut = dsp.env([(0, 0.0), (tp * 0.5, 0.12), (tp, 1.0), (tp + 0.7 * gap, 0.2), (dur, 0.0)], n) ** 1.5
        air = parts.whoosh(n, rng, path, 0.75) * cut
        air = parts.comb(air, [2.3 * stage * tune, 5.1 * stage * tune], [0.7, 0.5])
        edge = parts.whoosh(n, rng, path * 2.4, 0.4, slope=0.0) * cut ** 2
        dsp.put(out, air + 0.4 * edge, shift, g)
    mass = parts.whoosh(n, rng, dsp.env([(0, fa * 0.3), (tp, fb * 0.25), (dur, fc_ * 0.3)], n, "exp"), 0.6, slope=-6.0)
    dsp.put(out, mass * dsp.hump(n, tp * 1.1, 2.0, 1.4), 0.0, {1: 0.5, 2: 1.0, 3: 1.6}[stage])
    m = n_(0.07 * stage)                                       # the tear at the bottom of the stroke
    rate = {1: 70.0, 2: 52.0, 3: 38.0}[stage] * (1.0 + 0.15 * dsp.wander(m, rng, 6.0))
    rip = parts.unit(dsp.bp(dsp.noise(m, rng, -1.5), 700 / stage, 5200 / stage)) * (0.5 + 0.5 * dsp.saw(rate)) ** 2
    dsp.put(out, rip * dsp.hump(m, 0.25 * m / SR, 1.0, 2.0), tp + gap - 0.01, 0.35)
    return out


for _s in (1, 2, 3):
    sfx(f"kaiju_rake_s{_s}", "kaiju", level={1: -20.5, 2: -17.5, 3: -14.5}[_s], group="rake",
        use=f"The two-claw rake at stage {_s} (swipe look 2): two cuts a moment apart, heavier than the swipe. "
            f"Start it about {RAKE_PEAK[_s]:.2f} s before the strike.")(
        lambda rng, v, s=_s: _rake(rng, s))


# ---- the hop (stomp look 2) ----------------------------------------------------------------------
def _hop(rng: np.random.Generator, stage: int) -> np.ndarray:
    """Down on both feet at once: two booms a moment apart (one foot always lands first), the
    ground cracking and the shock rolling out, and the weight of the whole body settling."""
    dur = {1: 1.1, 2: 1.95, 3: 3.3}[stage]
    n = n_(dur)
    gap = {1: 0.045, 2: 0.07, 3: 0.1}[stage]
    out = np.zeros(n)
    for t0, g, tune in ((0.0, 0.75, 1.05), (gap, 1.0, 0.95)):
        dsp.put(out, _impact(rng, n - n_(t0), stage, tune), t0, g)
    settle = parts.unit(dsp.lp(dsp.noise(n, rng, -6), {1: 160, 2: 110, 3: 75}[stage], 2)) * dsp.decay(n, 0.45 * stage, 0.03)
    ring_f = dsp.env([(0, {1: 1300, 2: 850, 3: 560}[stage]), (dur * 0.5, {1: 400, 2: 220, 3: 130}[stage]),
                      (dur, {1: 190, 2: 105, 3: 65}[stage])], n, "exp")
    ring = parts.whoosh(n, rng, ring_f, 0.75) * dsp.hump(n, gap + dur * 0.15, 1.2, 2.2)
    rubble = ground(n, rng, dsp.env([(0, 1400), (dur * 0.25, 600), (dur * 0.7, 90), (dur, 0)], n), stage)
    dry = dsp.mix((out, 1.0), (_cracks(rng, n, stage, 3 + stage, gap + 0.03 * stage), 0.2), (ring, 0.12),
                  (rubble, 0.035), (settle, 0.15))
    return _space(rng, stage, dry)


for _s in (1, 2, 3):
    sfx(f"kaiju_hop_s{_s}", "kaiju", level={1: -16.0, 2: -14.5, 3: -12.0}[_s], group="hop", clip=True,
        use=f"The stomp's hop at stage {_s} (stomp look 2): landing on both feet, two booms a moment apart. "
            "Play it as the stomp lands.")(
        lambda rng, v, s=_s: _hop(rng, s))


# ---- the tail sweep ------------------------------------------------------------------------------
TAIL_PEAK = {1: 0.2, 2: 0.3, 3: 0.45}


def _tail(rng: np.random.Generator, stage: int) -> np.ndarray:
    """The tail lashed round behind: a deep, slow sweep of air from its thick base, the scales
    rasping, and its tip much faster and higher, cracking like a whip where it turns."""
    tp = TAIL_PEAK[stage]
    dur = {1: 0.62, 2: 0.95, 3: 1.45}[stage]
    n = n_(dur)
    lo = {1: (170, 560, 140), 2: (95, 310, 75), 3: (50, 150, 38)}[stage]
    base = parts.whoosh(n, rng, dsp.env([(0, lo[0]), (tp, lo[1]), (dur, lo[2])], n, "exp"), 0.7, slope=-4.0)
    base = base * dsp.hump(n, tp * 1.05, 1.8, 1.6)
    hi = {1: (1500, 5200, 1700), 2: (900, 3300, 950), 3: (520, 1900, 520)}[stage]
    tip = parts.whoosh(n, rng, dsp.env([(0, hi[0]), (tp * 0.95, hi[1]), (tp * 1.1, hi[1] * 0.75), (dur, hi[2])], n, "exp"),
                       0.35, slope=0.0) * dsp.hump(n, tp, 4.0, 4.5)
    rate = {1: 46.0, 2: 34.0, 3: 25.0}[stage] * (1.0 + 0.1 * dsp.wander(n, rng, 4.0))
    rasp = parts.unit(dsp.bp(dsp.noise(n, rng, -2.0), 400 / stage, 2600 / stage)) * (0.5 + 0.5 * dsp.saw(rate)) ** 2
    rasp = rasp * dsp.hump(n, tp * 1.1, 2.5, 2.0)
    snap = np.zeros(n)
    dsp.put(snap, dsp.click(rng, 1600 / stage ** 0.5, 9000 / stage ** 0.5, 0.006 * stage), tp, 1.0)
    return dsp.mix((base, {1: 0.8, 2: 1.1, 3: 1.4}[stage]), (tip, 0.55), (rasp, 0.12), (snap, 0.3))


for _s in (1, 2, 3):
    sfx(f"kaiju_tail_s{_s}", "kaiju", level={1: -21.0, 2: -18.0, 3: -15.0}[_s], group="tail",
        use=f"The tail sweep at stage {_s}: a deep sweep of air with a whip-crack at the tip. "
            f"Start it about {TAIL_PEAK[_s]:.2f} s before the strike.")(
        lambda rng, v, s=_s: _tail(rng, s))


# ---- the charge ----------------------------------------------------------------------------------
def _charge(rng: np.random.Generator, stage: int) -> np.ndarray:
    """The run begins: the hind feet dig in and shove off with a crunch, and the animal bellows as
    it goes, a rush of air building behind. The gallop itself is the footsteps, which the game
    plays harder while it runs."""
    dur = {1: 1.5, 2: 2.3, 3: 3.3}[stage]
    n = n_(dur)
    base = {1: 150.0, 2: 92.0, 3: 60.0}[stage]
    bd = {1: 0.95, 2: 1.45, 3: 2.1}[stage]
    bellow = voice(rng, bd, size=SIZE[stage],
                   f0=[(0, base * 1.25), (0.12, base * 1.8), (0.55, base * 1.6), (1, base * 0.85)],
                   growl=[(0, 0.4), (0.08, 1.0), (0.6, 0.85), (1, 0.0)],
                   mouth=[(0, 0.4), (0.12, 1.0), (0.65, 0.75), (1, 0.1)],
                   scream=[(0, 0.2), (0.1, 0.85), (0.5, 0.55), (1, 0.0)], scream_f=[(0, 1300), (0.12, 2100), (1, 900)],
                   screech=[(0, 0.0), (0.12, 0.55), (0.6, 0.3), (1, 0.0)], screech_f=[(0, 1100), (0.2, 1700), (1, 700)],
                   tear=[(0, 0.4), (0.3, 0.65), (1, 0.3)], tear_rate={1: 50.0, 2: 38.0, 3: 28.0}[stage],
                   rumble=[(0, 0.2), (0.5, 0.6), (1, 0.0)], sub={1: 0.4, 2: 0.55, 3: 0.7}[stage])
    bellow = dsp.hp(bellow, {1: 60.0, 2: 38.0, 3: 24.0}[stage])
    shove = _impact(rng, n, stage, 1.1, 0.7)
    dig = ground(n, rng, dsp.env([(0, 2600), (0.08 * stage, 1500), (0.3 * stage, 200), (0.45 * stage, 0)], n), stage)
    rush = parts.whoosh(n, rng, dsp.env([(0, 300 / stage), (dur * 0.6, 1600 / stage), (dur, 900 / stage)], n, "exp"), 0.9)
    rush = rush * dsp.env([(0, 0.0), (dur * 0.2, 0.3), (dur * 0.65, 1.0), (dur, 0.0)], n)
    dry = dsp.mix((shove, 1.0), (dig, 0.06), (bellow, 0.7, 0.07 * stage), (rush, 0.08))
    return _space(rng, stage, dry)


for _s in (1, 2, 3):
    sfx(f"kaiju_charge_s{_s}", "kaiju", level={1: -15.5, 2: -14.0, 3: -12.5}[_s], group="charge",
        use=f"The charge at stage {_s}, as the run begins: feet digging in, a bellow, a rush of air.")(
        lambda rng, v, s=_s: _charge(rng, s))


# ---- the stumble: three falls, one per look --------------------------------------------------------
STUMBLE_LOOKS = ("pitching forward onto a knee", "spinning out to the side", "sitting down hard on its tail")


def _scrape(rng: np.random.Generator, n: int, stage: int, curve: np.ndarray, bright: float = 1.0) -> np.ndarray:
    """Feet skidding over asphalt: rough noise that sticks and slips, and grit sprayed ahead."""
    rough = parts.unit(dsp.bp(dsp.noise(n, rng, -2.0), 260 * bright / stage, 3200 * bright / stage))
    slip = (0.55 + 0.45 * dsp.wander(n, rng, 28.0 / stage)) ** 2
    grit = ground(n, rng, curve * 2600, stage)
    return (rough * slip + 0.4 * grit) * curve


def _grunt(rng: np.random.Generator, stage: int, dur: float, f0: float, open_: float) -> np.ndarray:
    """A short dazed groan from the creature's own voice."""
    return voice(rng, dur, size=SIZE[stage],
                 f0=[(0, f0 * 1.3), (0.15, f0 * 1.5), (1, f0 * 0.7)], growl=[(0, 0.3), (0.12, 1.0), (0.7, 0.6), (1, 0.0)],
                 mouth=[(0, 0.3), (0.15, open_), (1, 0.1)], scream=[(0, 0.1), (0.15, 0.4), (1, 0.0)],
                 scream_f=[(0, 1100), (1, 700)], screech=[(0, 0.0), (1, 0.0)], screech_f=[(0, 800), (1, 800)],
                 tear=[(0, 0.5), (1, 0.6)], tear_rate={1: 42.0, 2: 32.0, 3: 24.0}[stage],
                 vibrato=[(0, 0.02), (1, 0.08)], sub={1: 0.4, 2: 0.55, 3: 0.7}[stage])


def _stumble(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """v 1: it pitches forward onto a knee: a skid, a heavy thud, a grunt. v 2: it spins out to the
    side: a long skid that slews round, the tail swinging wide, a lighter thud. v 3: it sits down
    hard on its tail: a short skid, the heaviest, deepest thud, the breath knocked out of it.
    The worst of the fall lands about 0.3 s in, where the animation's lurch is deepest."""
    dur = {1: 1.4, 2: 2.25, 3: 3.4}[stage]
    n = n_(dur)
    t = stage ** 0.35                                          # bigger bodies take a little longer to land
    out = np.zeros(n)
    if v == 1:
        land = 0.28 * t
        out += 0.14 * _scrape(rng, n, stage, dsp.env([(0, 0.0), (0.03, 1.0), (land, 0.8), (land + 0.25 * t, 0.0)], n))
        dsp.put(out, _impact(rng, n - n_(land), stage, 1.0), land, 1.0)
        dsp.put(out, _impact(rng, n - n_(land + 0.11 * t), stage, 1.25, 0.6), land + 0.11 * t, 0.45)     # the hands land
        g = _grunt(rng, stage, 0.7 * t, {1: 170.0, 2: 110.0, 3: 72.0}[stage], 0.8)
        dsp.put(out, g, land + 0.05, 0.9)
    elif v == 2:
        land = 0.38 * t
        bend = dsp.env([(0, 1.25), (land, 0.8), (dur, 0.7)], n)                   # the skid slews round
        sk = _scrape(rng, n, stage, dsp.env([(0, 0.0), (0.03, 0.8), (land * 0.8, 1.0), (land + 0.35 * t, 0.0)], n), 1.2)
        out += 0.16 * dsp.fit(dsp.warp(sk, bend), n)
        tail = parts.whoosh(n, rng, dsp.env([(0, 200 / stage), (land, 700 / stage), (dur, 150 / stage)], n, "exp"), 0.7, slope=-3.0)
        out += 0.15 * tail * dsp.hump(n, land * 0.9, 2.0, 2.5)
        dsp.put(out, _impact(rng, n - n_(land), stage, 1.15, 0.7), land, 0.7)
        g = _grunt(rng, stage, 0.55 * t, {1: 200.0, 2: 130.0, 3: 85.0}[stage], 1.0)
        dsp.put(out, g, 0.06, 0.8)
    else:
        land = 0.3 * t
        out += 0.12 * _scrape(rng, n, stage, dsp.env([(0, 0.0), (0.03, 0.7), (land, 0.5), (land + 0.1, 0.0)], n))
        dsp.put(out, _impact(rng, n - n_(land), stage, 0.82, 1.3), land, 1.2)
        shake = parts.unit(dsp.lp(dsp.noise(n, rng, -6), {1: 140, 2: 95, 3: 65}[stage], 2)) * dsp.decay(n, 0.7 * stage, 0.03)
        dsp.put(out, shake[:n - n_(land)], land, 0.25)
        m = n_(0.5 * t)                                         # the breath knocked out of it
        oof = voice(rng, 0.5 * t, size=SIZE[stage], f0=[(0, {1: 140.0, 2: 90.0, 3: 60.0}[stage]), (1, {1: 95.0, 2: 62.0, 3: 42.0}[stage])],
                    growl=[(0, 0.8), (0.3, 0.6), (1, 0.0)], mouth=[(0, 0.5), (1, 0.1)], scream=[(0, 0.5), (1, 0.0)],
                    scream_f=[(0, 900), (1, 500)], screech=[(0, 0.0), (1, 0.0)], screech_f=[(0, 800), (1, 800)],
                    tear=[(0, 0.7), (1, 0.8)], tear_rate={1: 36.0, 2: 28.0, 3: 21.0}[stage])
        dsp.put(out, dsp.fit(oof, m), land + 0.02, 0.8)
    dry = dsp.mix((out, 1.0), (_cracks(rng, n, stage, 2 + stage, 0.4 * t), 0.15))
    return _space(rng, stage, dry)


for _s in (1, 2, 3):
    sfx(f"kaiju_stumble_s{_s}", "kaiju", variants=3, level={1: -16.5, 2: -15.0, 3: -13.0}[_s], group="stumble", clip=True,
        use=f"The stumble that ends a charge at stage {_s}. Not picked at random: variant 1 is the look "
            f"{STUMBLE_LOOKS[0]}, 2 {STUMBLE_LOOKS[1]}, 3 {STUMBLE_LOOKS[2]}. The fall lands about 0.3 s in.")(
        lambda rng, v, s=_s: _stumble(rng, s, v))


# ---- the gulp ------------------------------------------------------------------------------------
@sfx("kaiju_gulp", "kaiju", level=-20.5,
     use="A handful of civilians gulped down (the puff at the mouth): the jaws close, one big comic swallow and a "
         "little bubble. One size: play it at about 1.2, 1.0 and 0.8 for stages 1, 2 and 3.")
def kaiju_gulp(rng, v):
    n = n_(0.52)
    out = np.zeros(n)
    clack = parts.thump(n_(0.1), 300, 170, 0.008, 0.05, attack=0.001) + 0.35 * dsp.fit(dsp.click(rng, 900, 4500, 0.005), n_(0.1))
    dsp.put(out, clack, 0.0, 0.45)
    m = n_(0.3)                                               # the swallow: a blob of air dropping through the throat
    f = dsp.env([(0, 190), (0.045, 280), (0.3, 72)], m, "exp")
    blob = dsp.sine(f) + 0.4 * dsp.sine(f * 2.01) + 0.15 * dsp.sine(f * 3.03)
    wet = parts.unit(dsp.bp(dsp.noise(m, rng, -3), 250, 1400)) * dsp.env([(0, 0), (0.02, 1), (0.12, 0.2), (0.3, 0)], m)
    blob = dsp.reson(blob * dsp.env([(0, 0), (0.015, 1), (0.14, 0.8), (0.3, 0)], m) + 0.12 * wet, 260, 1.3)
    dsp.put(out, parts.norm(blob), 0.07, 1.0)
    dsp.put(out, parts.thump(n_(0.22), 120, 62, 0.02, 0.16), 0.3, 0.5)    # it arrives
    k = n_(0.045)                                             # and a little bubble comes back up
    bub = dsp.sine(dsp.sweep(520, 980, k)) * dsp.decay(k, 0.04, 0.002)
    dsp.put(out, bub, 0.42, 0.22)
    return out
