"""Tier 2 sounds: the signature roars of the Crab, the Burrower and the Moth, the sounds of how
they move, and the Air, Super Science and Coalition of Faiths factions.

Every kaiju has its own voice. All four roars follow one plan (three parts, the same lengths,
the same loudness at each stage, the same streets to echo in), so what tells them apart is what
they are made of:

    Lizard    a growl that climbs, a torn scream, a falling rumble        (kaiju.py)
    Crab      claws clattering, a hollow rasping bellow, a hiss of foam
    Burrower  a rumble from below, a drill that spins up, grinding to a stop
    Moth      wings fluttering, a high trilling shriek, a falling shimmer
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage, signal

from . import dsp, parts
from .dsp import SR, TAU, n_
from .kaiju import ROAR_SECONDS, roar_space
from .parts import curve
from .registry import sfx

# where each roar's parts end (share of the voiced length) and what the parts are called
ROAR_SPLITS = {"crab": (0.20, 0.68), "burrower": (0.25, 0.70), "moth": (0.20, 0.65)}
ROAR_PART_NAMES = {"crab": ("clatter", "bellow", "hiss"), "burrower": ("rumble", "bore", "grind-down"),
                   "moth": ("flutter", "shriek", "shimmer")}
ROAR_LEVELS = {1: -15.0, 2: -13.5, 3: -12.0}        # the same ladder as the Lizard

# pitches used by the tonal sounds (Hz): D minor, the key of the music
C3, D3, E3, F3, A3, D4, F4, A4, D5, FS5, A5, D6 = (130.81, 146.83, 164.81, 174.61, 220.0, 293.66, 349.23, 440.0,
                                                    587.33, 739.99, 880.0, 1174.66)


# ---- Krabulon, the Crab ------------------------------------------------------------------------
def _crab_roar(rng: np.random.Generator, stage: int) -> np.ndarray:
    dur = ROAR_SECONDS[stage]
    a, b = ROAR_SPLITS["crab"]
    size = {1: 0.75, 2: 1.0, 3: 1.4}[stage]
    k = 1.0 / size
    n = n_(dur)
    t = dsp.secs(n)

    # clatter: the two claws clack in turn, left and right, faster and faster; they keep ticking
    # quietly under the bellow and slow down again in the hiss
    r0, r1 = 9.0 * k ** 0.5, 30.0 * k ** 0.5
    rate = curve([(0, r0), (a, r1), (b, r1 * 0.8), (1, r0 * 0.6)], dur, n, "exp")
    count = np.floor(np.cumsum(rate) / SR)
    hits = np.nonzero(np.diff(count, prepend=-1.0) > 0)[0]
    loud = curve([(0, 0.5), (a * 0.9, 1.0), (a + 0.04, 0.3), (b, 0.22), (b + 0.05, 0.45), (1, 0.0)], dur, n)
    knocks = parts.modal_kernels(rng, 4, 380 * k, 900 * k, 0.035 * size, 0.07 * size, ratios=(1.0, 1.83, 2.94, 4.3),
                                 damp=0.55, tick=0.9)
    claws = np.zeros((n, 2))
    for i, s in enumerate(hits):
        seg = dsp.pan(knocks[(i % 2) * 2 + int(rng.integers(2))], -0.55 if i % 2 == 0 else 0.55)
        seg = seg * (loud[s] * rng.uniform(0.75, 1.0))
        m = min(len(seg), n - s)
        claws[s:s + m] += seg[:m]

    # bellow: a two-note honk (a tritone apart) and noise, struck into pulses by the rasp of a
    # file dragged over the shell, ringing in a hollow body whose resonances do not move
    base = {1: 185.0, 2: 131.0, 3: 92.0}[stage]
    pitch = base * curve([(0, 0.9), (a, 0.94), (a + 0.05, 1.0), (b, 0.93), (b + 0.1, 0.8), (1, 0.6)], dur, n, "exp")
    pitch = pitch * (1.0 + 0.012 * dsp.wander(n, rng, 7.0))
    honk = (dsp.square(pitch, duty=0.5) + 0.7 * dsp.square(pitch * 1.4142, duty=0.35, start=0.3)
            + 0.5 * dsp.saw(pitch * 0.5, start=0.6))
    strid = {1: 57.0, 2: 41.0, 3: 29.0}[stage]
    srate = strid * curve([(0, 0.7), (a, 0.85), (a + 0.06, 1.0), (b, 0.9), (b + 0.12, 0.55), (1, 0.22)], dur, n, "exp")
    srate = srate * (1.0 + 0.08 * dsp.wander(n, rng, 3.0))
    rasp = (0.5 - 0.5 * dsp.saw(srate, start=rng.random())) ** 2.4            # each tooth: a strike, then it dies
    rasp = np.clip(dsp.lp(rasp, 1200.0, 1), 0.0, 1.0)
    src = (0.8 * honk + 1.1 * dsp.noise(n, rng, -3.0)) * (0.12 + 0.88 * rasp)
    opening = curve([(0, 0.0), (a - 0.03, 0.1), (a + 0.03, 1.0), (b, 0.9), (b + 0.12, 0.3), (1, 0.0)], dur, n)

    def shell(f, tm):
        o = np.interp(tm, t, opening)
        m = (dsp.lorentz(f, k * 250, k * 60) + 0.9 * dsp.lorentz(f, k * 610, k * 90)
             + (0.25 + 0.6 * o) * dsp.lorentz(f, k * 1180, k * 150) + (0.1 + 0.45 * o) * dsp.lorentz(f, k * 2050, k * 260)
             + 0.15 * o * dsp.lorentz(f, k * 3300, k * 500))
        return m * dsp.lowpass_mask(f, k * 5000, 2)

    bellow = parts.unit(dsp.spectral_shape(src, shell, 1024))
    bellow_env = curve([(0, 0.0), (a - 0.05, 0.0), (a - 0.01, 0.25), (a + 0.03, 1.0), (b, 1.0), (b + 0.1, 0.4),
                        (0.9, 0.12), (1, 0.0)], dur, n)
    sub = dsp.sine(pitch * 0.5) * (0.4 + 0.6 * rasp) + 0.8 * parts.unit(dsp.lp(dsp.noise(n, rng, -6.0), 90.0 * k ** 0.5, 2))
    sub_env = curve([(0, 0.0), (a, 0.2), (a + 0.05, 0.8), (b, 1.0), (b + 0.15, 0.6), (1, 0.0)], dur, n)

    # hiss: steam and foam let go when the bellow ends, with bubbles popping in it
    hiss_f = 5200.0 * k ** 0.5
    hiss = parts.unit(dsp.spectral_shape(dsp.noise(n, rng, -1.0),
                                         lambda f, tm: dsp.bump(f, hiss_f, 0.6) + 0.5 * dsp.bump(f, hiss_f * 0.45, 0.5), 512))
    hiss = hiss * (0.7 + 0.3 * dsp.wander(n, rng, 45.0))
    hiss_env = curve([(0, 0.04), (a, 0.1), (b - 0.02, 0.16), (b + 0.03, 1.0), (b + 0.15, 0.7), (1, 0.0)], dur, n)
    foam = np.zeros(n)
    for _ in range(int(40 * dur)):
        t0 = (b + rng.beta(1.1, 2.6) * (1.0 - b)) * dur
        f = np.exp(rng.uniform(np.log(500 * k), np.log(2600 * k)))
        m = n_(rng.uniform(0.012, 0.045) * size)
        bubble = dsp.sine(dsp.sweep(f, f * rng.uniform(1.3, 1.9), m)) * dsp.decay(m, m / SR, 0.002)
        dsp.put(foam, bubble, t0, rng.uniform(0.3, 1.0))

    voiced = (dsp.drive(bellow * bellow_env * 0.5, 2.2) * 2.0 + 0.3 * hiss * hiss_env + 0.12 * foam
              + {1: 0.1, 2: 0.22, 3: 0.32}[stage] * sub * sub_env)
    voiced = dsp.hp(voiced, {1: 60.0, 2: 38.0, 3: 24.0}[stage])
    return roar_space(rng, dsp.fade(0.5 * claws + voiced[:, None], 0.002, 0.01), stage, size)


# ---- Drillmaw, the Burrower --------------------------------------------------------------------
def _teeth(turn: np.ndarray) -> np.ndarray:
    """The drill head as loudness over one turn: one heavy lobe and three cutters. 0..1."""
    return 0.55 * (0.5 + 0.5 * np.cos(TAU * turn)) + 0.45 * (0.5 + 0.5 * np.cos(TAU * 3.0 * turn + 0.7))


def _burrower_roar(rng: np.random.Generator, stage: int) -> np.ndarray:
    dur = ROAR_SECONDS[stage]
    a, b = ROAR_SPLITS["burrower"]
    size = {1: 0.85, 2: 1.15, 3: 1.6}[stage]
    k = 1.0 / size
    n = n_(dur)
    t = dsp.secs(n)

    # the drill: its turns per second and its pitch climb all the way through the bore and fall
    # away after it (the Lizard peaks early and sinks; this one winds up)
    spin = {1: 13.0, 2: 9.5, 3: 7.0}[stage] * curve([(0, 0.45), (a, 1.0), (b, 2.7), (b + 0.07, 2.3), (1, 0.3)], dur, n, "exp")
    teeth = _teeth(dsp.phase(spin, None, rng.random()))
    base = {1: 88.0, 2: 60.0, 3: 40.0}[stage]
    pitch = base * curve([(0, 0.7), (a, 1.0), (b, 2.4), (b + 0.08, 2.0), (1, 0.45)], dur, n, "exp")
    pitch = pitch * (1.0 + 0.015 * dsp.wander(n, rng, 8.0))
    src = dsp.saw(pitch) + 0.6 * dsp.saw(pitch * 0.5, start=0.25) + 0.35 * dsp.saw(pitch * 1.008, start=0.6)
    bite = curve([(0, 0.0), (a, 0.15), (a + 0.05, 0.5), (b, 1.0), (b + 0.1, 0.5), (1, 0.05)], dur, n)
    bit = dsp.fm(pitch * 4.0, 1.41, 1.2 + 2.0 * bite) * bite                 # the bit: metal screaming on rock
    # it starts under the ground (everything muffled) and breaks the surface at the bore
    surface = curve([(0, 150.0), (a - 0.04, 420.0), (a + 0.04, 5200.0 * k), (b, 6500.0 * k), (b + 0.15, 2600.0 * k),
                     (1, 500.0)], dur, n, "exp")

    def throat(f, tm):
        m = (dsp.lorentz(f, k * 210, k * 90) + 0.8 * dsp.lorentz(f, k * 560, k * 140) + 0.5 * dsp.lorentz(f, k * 1350, k * 260)
             + 0.3 * dsp.lorentz(f, k * 2700, k * 500) + 0.5 * dsp.lowpass_mask(f, k * 200, 1.5))
        return m * dsp.lowpass_mask(f, np.interp(tm, t, surface), 2)

    growl = parts.unit(dsp.spectral_shape(src + 0.7 * bit, throat, 2048))
    grind_f = curve([(0, 180.0), (a, 420.0), (b, 2400.0 * k), (b + 0.1, 1500.0 * k), (1, 260.0)], dur, n, "exp")
    grind = parts.whoosh(n, rng, grind_f, 0.9, slope=-2.0)                   # rock being ground to gravel
    rocks = parts.rubble(n, rng, curve([(0, 300), (a, 900), (b, 2600), (b + 0.1, 1500), (0.95, 150), (1, 0)], dur, n),
                         1.6 * size, knocks=0.04)
    low = parts.unit(dsp.lp(dsp.noise(n, rng, -6.0), 85.0 * k ** 0.5, 2)) + 0.9 * dsp.sine(pitch * 0.5)

    depth = curve([(0, 0.35), (a, 0.7), (b, 0.85), (1, 0.6)], dur, n)
    chop = 1.0 - depth * (1.0 - teeth)
    growl_env = curve([(0, 0.25), (a - 0.03, 0.55), (a + 0.03, 1.0), (b, 1.0), (b + 0.1, 0.6), (0.9, 0.2), (1, 0.0)], dur, n)
    grind_env = curve([(0, 0.1), (a, 0.4), (b, 1.0), (b + 0.12, 0.5), (1, 0.0)], dur, n)
    low_env = curve([(0, 0.7), (a, 1.0), (b, 0.8), (b + 0.15, 0.9), (0.92, 0.4), (1, 0.0)], dur, n)
    y = (dsp.drive((growl * growl_env + 0.55 * grind * grind_env) * chop * 0.34, 2.5) * 2.2 + 0.04 * rocks * growl_env
         + {1: 0.2, 2: 0.32, 3: 0.42}[stage] * low * low_env * (0.6 + 0.4 * teeth))
    y = dsp.hp(y, {1: 50.0, 2: 32.0, 3: 22.0}[stage])
    return roar_space(rng, dsp.fade(y, 0.004, 0.01), stage, size)


# ---- Vespera, the Moth -------------------------------------------------------------------------
def _moth_roar(rng: np.random.Generator, stage: int) -> np.ndarray:
    dur = ROAR_SECONDS[stage]
    a, b = ROAR_SPLITS["moth"]
    size = {1: 0.8, 2: 1.0, 3: 1.3}[stage]
    k = 1.0 / size
    n = n_(dur)
    t = dsp.secs(n)

    # flutter: wingbeats, puffs of air (and at the bigger sizes a push of bass with every beat)
    beats = {1: 19.0, 2: 13.0, 3: 9.0}[stage] * curve([(0, 0.8), (a, 1.15), (b, 1.0), (1, 0.7)], dur, n, "exp")
    flap = (0.5 + 0.5 * np.sin(TAU * dsp.phase(beats, None, rng.random()))) ** 3
    wing_f = curve([(0, 300.0), (a, 520.0), (b, 480.0), (1, 280.0)], dur, n, "exp") * k
    wings = parts.whoosh(n, rng, wing_f, 0.9, slope=-3.0) * flap
    push = dsp.sine(62.0 * k * (1.0 + 0.4 * flap)) * flap
    wing_env = curve([(0, 0.6), (a * 0.8, 1.0), (a + 0.05, 0.55), (b, 0.45), (b + 0.1, 0.55), (1, 0.0)], dur, n)

    # shriek: two reedy tones a tritone apart, trilled; it climbs out of the flutter, holds, then
    # slides down while the trill slows and breaks into single chirps
    line = {1: 2900.0, 2: 2250.0, 3: 1700.0}[stage] * curve(
        [(0, 0.5), (a * 0.7, 0.72), (a, 0.96), (a + 0.04, 1.0), (b, 0.93), (b + 0.12, 0.78), (1, 0.4)], dur, n, "exp")
    trate = {1: 31.0, 2: 24.0, 3: 18.0}[stage] * curve([(0, 1.0), (b, 1.0), (b + 0.1, 0.8), (1, 0.4)], dur, n, "exp")
    trill = np.sin(TAU * dsp.phase(trate, None, rng.random()))
    wobble = curve([(0, 0.0), (a, 0.02), (a + 0.04, 0.06), (b, 0.07), (1, 0.1)], dur, n)
    f = line * (1.0 + wobble * trill + 0.006 * dsp.wander(n, rng, 5.0))
    edge = size * curve([(0, 0.4), (a, 1.0), (a + 0.04, 1.9), (b, 1.7), (1, 0.5)], dur, n)
    reed = dsp.fm(f, 2.0, edge) + 0.8 * dsp.fm(f * 1.4142 * (1.0 + 0.004 * dsp.wander(n, rng, 3.0)), 2.0, 0.8 * edge)
    chirp = 1.0 - curve([(0, 0.2), (a, 0.4), (b, 0.6), (b + 0.1, 0.85), (1, 0.95)], dur, n) * (0.5 - 0.5 * trill)
    breath = parts.unit(dsp.spectral_shape(
        dsp.noise(n, rng), lambda fr, tm: dsp.bump(fr, np.interp(tm, t, line), 0.1) + 0.5 * dsp.bump(fr, 1.4142 * np.interp(tm, t, line), 0.1),
        1024))
    chest = dsp.lp(dsp.saw(line / 8.0) + 0.7 * dsp.saw(line / 16.0, start=0.4), 900.0 * k, 2)       # the size of the thing
    shriek_env = curve([(0, 0.0), (a * 0.5, 0.12), (a - 0.02, 0.3), (a + 0.03, 1.0), (b, 1.0), (b + 0.1, 0.6),
                        (0.92, 0.2), (1, 0.0)], dur, n)

    # shimmer: scale dust shaken loose as the shriek falls
    dust_rate = curve([(0, 0), (b - 0.02, 60), (b + 0.05, 1400), (0.9, 300), (1, 0)], dur, n)
    dust = parts.norm(parts.sparkle(n, rng, dust_rate, 5000.0, 15000.0)) * curve([(0, 0.0), (b, 0.5), (b + 0.06, 1.0), (1, 0.0)], dur, n)

    y = (dsp.drive(parts.unit(reed) * chirp * shriek_env * 0.45, 1.6) * 1.6 + 0.3 * breath * chirp * shriek_env
         + {1: 0.1, 2: 0.25, 3: 0.42}[stage] * parts.unit(chest) * chirp * shriek_env
         + 0.5 * wings * wing_env + {1: 0.1, 2: 0.3, 3: 0.5}[stage] * push * wing_env + 0.1 * dust)
    y = dsp.hp(y, {1: 70.0, 2: 45.0, 3: 30.0}[stage])
    return roar_space(rng, dsp.fade(y, 0.004, 0.01), stage, size)


_ROARS = {"crab": (_crab_roar, "claws clatter, a hollow rasping bellow, a hiss of foam"),
          "burrower": (_burrower_roar, "a rumble from below, a drill that spins up, grinding to a stop"),
          "moth": (_moth_roar, "wings flutter, a high trilling shriek, a falling shimmer")}
for _kind, (_fn, _what) in _ROARS.items():
    for _s in (1, 2, 3):
        sfx(f"kaiju_roar_{_kind}_s{_s}", "tier2", level=ROAR_LEVELS[_s], group=f"roar_{_kind}",
            use=f"Roar action at stage {_s}. The {_kind.capitalize()}'s signature: {_what}.")(
            lambda rng, v, fn=_fn, s=_s: fn(rng, s))


@sfx("burrow_loop", "tier2", loop=3.0, level=-20.0,
     use="The Burrower travelling underground (positional, over the seismograph ring): the same drill as its roar, "
         "heard through the earth.")
def burrow_loop(rng, v):
    n = n_(3.0)
    rumble = parts.unit(dsp.circular(lambda z: dsp.lp(z, 110, 2), dsp.noise(n, rng, -6))) * (0.7 + 0.3 * dsp.wander(n, rng, 1.5))
    teeth = _teeth(27.0 * np.arange(n) / n)                    # 9 turns a second: 27 per pass
    grind = dsp.circular(lambda z: dsp.bp(z, 90, 520), dsp.noise(n, rng, -3)) * teeth ** 1.5
    motor = dsp.circular(lambda z: dsp.lp(z, 300, 2), dsp.saw(46.0, n) + 0.6 * dsp.saw(92.0, n, start=0.3)) * (0.7 + 0.3 * teeth)
    rocks = parts.debris_loop(n, rng, 14.0 * (1.0 + 0.6 * dsp.wander(n, rng, 1.0)),
                              parts.modal_kernels(rng, 8, 110, 420, 0.03, 0.09, ratios=(1.0, 2.7, 5.1), damp=0.4, tick=0.3),
                              sigma=0.6)
    y = rumble * 0.8 + parts.unit(grind) * 0.7 + parts.unit(motor) * 0.35 + parts.norm(rocks) * 0.5
    return dsp.circular(lambda z: dsp.lp(z, 700, 2), y)       # under the ground everything is muffled


@sfx("gust", "tier2", level=-17.0,
     use="The Moth's wing gust that shoves units: the wing comes down, a wall of air goes past, grit follows.")
def gust(rng, v):
    n = n_(1.5)
    whump = parts.thump(n, 74, 38, 0.06, 0.5, attack=0.03, harm=0.3, sat=1.6)
    path = dsp.env([(0, 220), (0.22, 1500), (0.6, 700), (1.5, 260)], n, "exp")
    air = parts.whoosh(n, rng, path, 1.0) * dsp.hump(n, 0.24, 1.6, 2.2)
    flap = 0.5 + 0.5 * dsp.sine(dsp.env([(0, 24), (1.5, 11)], n, "exp"))                   # the air it leaves behind flaps
    air = air * (1.0 - 0.5 * dsp.env([(0, 0), (0.25, 0.3), (0.5, 1), (1.5, 0.4)], n) * flap)
    grit = parts.whoosh(n, rng, path * 3.2, 0.6, slope=-1.0) * dsp.hump(n, 0.2, 3.0, 3.0)
    mass = parts.whoosh(n, rng, path * 0.25, 0.7, slope=-6.0) * dsp.hump(n, 0.3, 1.5, 1.6)
    return dsp.mix((whump, 0.6), (air, 1.0), (grit, 0.25), (mass, 0.9))


# ---- Air ---------------------------------------------------------------------------------------
@sfx("drone_loop", "tier2", loop=2.0, level=-26.0,
     use="A drone hovering or flying, including the reporters' camera drones (positional): four small rotors "
         "beating against each other. Raise the playback rate with speed (1.0 to about 1.3).")
def drone_loop(rng, v):
    n = n_(2.0)
    t = np.arange(n) / n
    rotors = np.zeros(n)
    # whole numbers of turns and of wobbles per pass, so every rotor closes its phase at the loop point
    for hz, wobbles, ph in ((186.0, 3, 0.1), (193.5, 5, 0.4), (201.0, 2, 0.7), (208.5, 7, 0.9)):
        rotors += dsp.saw(hz * (1.0 + 0.012 * np.sin(TAU * (wobbles * t + ph))), start=ph)
    rotors = parts.periodic_shape(rotors, lambda f, tm: dsp.highpass_mask(f, 170, 2)
                                  * (dsp.bump(f, 900, 1.3) + 0.5 * dsp.bump(f, 3200, 0.8) + 0.12))
    air = parts.periodic_shape(dsp.noise(n, rng, -1.0), lambda f, tm: dsp.bump(f, 3800, 0.7))
    return parts.unit(rotors) + 0.12 * parts.unit(air) * (0.8 + 0.2 * dsp.wander(n, rng, 4.0))


@sfx("heli_loop", "tier2", loop=2.0, level=-21.0,
     use="A helicopter in flight (positional): blade slap eleven times a second, rotor wash, turbine whine, "
         "tail rotor buzz.")
def heli_loop(rng, v):
    n = n_(2.0)
    t = np.arange(n) / n
    rate = 11.0                                               # blade passes per second: 22 per pass
    events = []
    m = n_(0.085)
    for i in range(int(rate * 2.0)):
        f = 78.0 * rng.uniform(0.97, 1.03)
        thud = dsp.sine(dsp.glide(f * 1.6, f, m, 0.012), m) * dsp.decay(m, 0.075, 0.004)
        slap = parts.norm(dsp.bp(rng.standard_normal(m + 64), 180, 1400)[64:] * dsp.decay(m, 0.045, 0.003))
        events.append((i / rate, thud + 0.6 * slap, (1.0, 0.86)[i % 2] * rng.uniform(0.94, 1.06)))       # two blades, not quite alike
    blades = parts.fold_events(n, events)
    wash = dsp.circular(lambda z: dsp.bp(z, 140, 2400), dsp.noise(n, rng, -3))
    wash = wash * (0.45 + 0.55 * (0.5 + 0.5 * dsp.lfo(n, 22, 0.2)) ** 2)
    whine = np.sin(TAU * 5200 * t + 0.8 * np.sin(TAU * 7 * t)) + 0.5 * np.sin(TAU * 7800 * t + 0.5)        # 2600 and 3900 Hz
    hiss = parts.periodic_shape(dsp.noise(n, rng, -1.0), lambda fr, tm: dsp.bump(fr, 4800, 0.5)) * (0.8 + 0.2 * dsp.wander(n, rng, 6.0))
    tail = dsp.circular(lambda z: dsp.lp(z, 700, 2), dsp.saw(66.0, n)) * (0.7 + 0.3 * dsp.lfo(n, 22, 0.1))
    y = (parts.unit(blades) + 0.45 * parts.unit(wash) + 0.04 * whine + 0.1 * parts.unit(hiss) + 0.18 * parts.unit(tail))
    return dsp.drive(y * 0.6, 1.4)


@sfx("jet_flyby", "tier2", level=-15.0,
     use="A pair of jets on a strafing pass: the whine comes in high, drops as they go over, and the roar rolls "
         "away behind them. Start it about 1.2 s before they cross the target.")
def jet_flyby(rng, v):
    dur = 3.4
    n = n_(dur)
    t = dsp.secs(n)
    out = np.zeros(n)
    for over, gain, tune in ((1.15, 1.0, 1.0), (1.42, 0.85, 1.07)):          # leader, then the wingman
        along = 240.0 * (t - over)                             # metres along the track, at 240 m/s
        dist = np.sqrt(along ** 2 + 70.0 ** 2)                 # 70 m away at the closest point
        closing = -240.0 * along / dist                        # speed toward the listener
        doppler = 343.0 / (343.0 - closing)                    # 3.3 coming, 0.6 going
        near = 70.0 / dist
        behind = 0.5 + 0.5 * np.tanh((t - over) / 0.12)        # 0 ahead of the pass, 1 after it
        # the roar: broadband, brightest when closest (air swallows the highs of anything far away),
        # and louder from behind, where the exhaust points
        cutoff = 350.0 + 9000.0 * near ** 1.3
        roar = parts.unit(dsp.spectral_shape(dsp.noise(n, rng, -3.0),
                                             lambda f, tm, c=cutoff: dsp.lowpass_mask(f, np.interp(tm, t, c), 1.5), 1024))
        roar = roar * near ** 0.9 * (0.55 + 0.45 * behind)
        tear = 1.0 + 0.7 * dsp.wander(n, rng, 45.0) * behind * near ** 0.5                     # the exhaust crackles
        # the whine of the compressor: a pure tone, Doppler-shifted, heard mostly from the front
        f_whine = np.minimum(2100.0 * tune * doppler, 16000.0)
        whine = dsp.sine(f_whine) + 0.5 * dsp.sine(np.minimum(f_whine * 1.5, 18000.0))
        whine = whine * near ** 1.4 * (1.0 - 0.75 * behind)
        rumble = parts.unit(dsp.lp(dsp.noise(n, rng, -6.0), 150.0, 2)) * near ** 0.5 * behind
        out += gain * (roar * tear + 0.22 * whine + 0.5 * rumble)
    ir = dsp.space_ir(rng, 1.4, pre=0.03, bright=3000, dark=500, echoes=((0.22, 0.25, 1500.0), (0.4, 0.18, 900.0)), low_cut=60.0)
    return dsp.reverb(dsp.fade(out, 0.3, 0.6), ir, 0.18)


# ---- Super Science -----------------------------------------------------------------------------
@sfx("freeze_ray", "tier2", level=-19.0,
     use="A lab coat fires a prototype freeze ray: the emitter chirps, the beam tone slides down as its flutter "
         "slows, and frost crackles and rings where it lands.")
def freeze_ray(rng, v):
    n = n_(1.25)
    m = n_(0.09)
    chirp = dsp.fm(dsp.sweep(500, 3400, m), 1.0, 1.5) * dsp.env([(0, 0), (0.004, 1), (0.07, 0.8), (0.09, 0)], m)
    fall = dsp.env([(0, 3200), (0.08, 3000), (0.5, 1300), (1.25, 520)], n, "exp")
    slowing = 0.6 + 0.4 * dsp.sine(dsp.env([(0, 55), (1.25, 9)], n, "exp"))                # everything it touches slows down
    beam = (dsp.sine(fall) + 0.5 * dsp.sine(fall * 1.498) + 0.35 * dsp.sine(fall * 2.76)) * slowing
    beam = beam * dsp.env([(0, 0), (0.07, 0.2), (0.1, 1), (0.5, 0.6), (1.2, 0)], n)
    ice = np.zeros(n)                                          # crystals: pure high partials, few, then many, then few
    for _ in range(80):
        t0 = min(0.1 + rng.gamma(2.2, 0.15), 1.1)
        f = np.exp(rng.uniform(np.log(3200), np.log(11500)))
        d = rng.uniform(0.02, 0.09)
        k = dsp.modal(n_(d * 1.5), [f, f * rng.uniform(1.4, 1.7), f * rng.uniform(2.2, 2.9)], [d, d * 0.6, d * 0.35], [1.0, 0.5, 0.3], rng)
        dsp.put(ice, dsp.fade(k, 0.0003, 0.0), t0, rng.uniform(0.3, 1.0))
    frost = parts.debris(n, rng, dsp.env([(0, 0), (0.1, 200), (0.45, 1800), (1.0, 300), (1.25, 0)], n),
                         parts.noise_kernels(rng, 4, 4000, 12000, 0.001, 0.003))
    cold = parts.whoosh(n, rng, [(0, 7000), (1.25, 3500)], 0.7, slope=0.0) * dsp.hump(n, 0.15, 1.5, 2.0)
    return dsp.mix((chirp, 0.5), (beam, 0.3), (parts.norm(ice), 0.5), (frost, 0.04), (cold, 0.1))


@sfx("dish_beam_loop", "tier2", loop=2.0, level=-21.0,
     use="A beam-dish truck holding its beam on the kaiju (positional): transformer hum, one unwavering tone, "
         "the air sizzling. Beams never scatter, so nothing in it wavers.")
def dish_beam_loop(rng, v):
    n = n_(2.0)
    t = np.arange(n) / n
    # 147 Hz is D3 to within 2 cents and fits the pass a whole number of times; every part is a multiple of it
    hum = dsp.circular(lambda z: dsp.lp(z, 1100, 2), dsp.square(147.0, n))
    tone = np.sin(TAU * 1176 * t + (1.4 + 0.4 * dsp.lfo(n, 1)) * np.sin(TAU * 1764 * t))       # 588 Hz, modulated at 882 Hz
    sizzle = parts.periodic_shape(dsp.noise(n, rng), lambda f, tm: dsp.bump(f, 6500, 0.5))
    sizzle = sizzle * (0.55 + 0.45 * np.sin(TAU * 294 * t)) ** 2
    sub = np.sin(TAU * 147 * t)                                # 73.5 Hz
    y = 0.5 * parts.unit(hum) + 0.6 * parts.unit(tone) + 0.12 * parts.unit(sizzle) + 0.3 * sub
    return y * (0.94 + 0.06 * dsp.lfo(n, 24))


@sfx("generator_overload", "tier2", level=-16.0, clip=True,
     use="A Super Science generator runs away: the whine climbs faster and faster, arcs jump, the breaker blows. "
         "Start it 2.2 s before the generator goes up and play explosion_l as the breaker blows.")
def generator_overload(rng, v):
    blow = 2.2
    n = n_(2.8)
    t = dsp.secs(n)
    u = np.clip(t / blow, 0.0, 1.0)
    live = dsp.env([(0, 0.0), (0.05, 0.25), (blow - 0.015, 1.0), (blow, 0.0)], n)
    f = 110.0 * (2400.0 / 110.0) ** (u ** 1.8)
    whine = dsp.fm(f, 2.0, 0.6 + 2.4 * u) + 0.6 * dsp.saw(f * 0.5)
    shake = 0.6 + 0.4 * dsp.sine(6.0 * (38.0 / 6.0) ** u)                                  # it shakes itself apart
    hum = dsp.lp(dsp.square(100.0, n, duty=0.5), 1200, 2) * (0.5 + 0.5 * u)
    arcs = np.zeros(n)
    for _ in range(16):                                       # arcs: buzzing bursts, more of them toward the end
        t0 = blow * rng.beta(2.6, 1.0)
        m = n_(rng.uniform(0.03, 0.09))
        zzt = dsp.bp(rng.standard_normal(m + 64), 1500, 9000)[64:] * (dsp.square(100.0, m, duty=0.5, start=rng.random()) > 0)
        dsp.put(arcs, dsp.fade(zzt, 0.001, 0.004), t0, (0.4 + 0.6 * t0 / blow) * rng.uniform(0.6, 1.0))
    arcs = arcs * (t < blow)
    sparks = parts.norm(parts.sparkle(n, rng, dsp.env([(0, 20), (blow, 1500), (blow + 0.05, 2500), (blow + 0.5, 0)], n)))
    sparks = sparks * dsp.env([(0, 0.1), (blow, 0.7), (blow + 0.02, 1.0), (blow + 0.5, 0.0)], n)
    m = n - n_(blow)
    bang = parts.burst(m, rng, 13000, 700, 0.02, 0.18, slope=0.0) + 0.8 * parts.thump(m, 160, 50, 0.04, 0.3, harm=0.35, sat=2.2)
    k = n_(0.4)
    dying = dsp.lp(dsp.saw(dsp.sweep(2400, 70, k)), 4000, 2) * dsp.decay(k, 0.35, 0.002)         # the power runs down
    dry = dsp.mix((parts.unit(whine) * shake * live, 0.28), (parts.unit(hum) * shake * live, 0.2), (parts.norm(arcs), 0.3),
                  (sparks, 0.12), (bang, 1.0, blow), (dying, 0.3, blow))
    return dsp.reverb(dry, dsp.space_ir(rng, 0.7, pre=0.012, bright=5000, dark=700, echoes=((0.15, 0.2, 1800.0),), low_cut=80.0), 0.12)


# ---- Coalition of Faiths -----------------------------------------------------------------------
# The choir is wordless: open vowels only, no text of any tradition.
_VOWEL_O, _VOWEL_A = (450.0, 800.0, 2830.0), (700.0, 1150.0, 2600.0)


def _vowel(f, opening, scale: float = 1.0):
    """Formant mask of a sung vowel between "oh" (opening 0) and "ah" (opening 1)."""
    f1, f2, f3 = (scale * (lo + (hi - lo) * opening) for lo, hi in zip(_VOWEL_O, _VOWEL_A))
    return ((dsp.lorentz(f, f1, 90.0) + 0.6 * dsp.lorentz(f, f2, 110.0) + 0.3 * dsp.lorentz(f, f3, 170.0)
             + 0.12 * dsp.lorentz(f, scale * 3400.0, 250.0)) * dsp.lowpass_mask(f, 5000.0, 2))


def _singers(rng: np.random.Generator, line: np.ndarray, count: int, cents: float, periodic: bool) -> np.ndarray:
    """A section singing one line (frequency per sample): each singer a little out of tune, with
    their own vibrato and their own idea of the beat. With periodic=True every voice closes its
    phase over the length of the line, so the section loops."""
    n = len(line)
    t = np.arange(n) / n
    out = np.zeros(n)
    for _ in range(count):
        cycles = int(rng.integers(22, 31)) if periodic else rng.uniform(4.4, 6.2) * n / SR
        f = line * 2.0 ** (rng.normal(0.0, cents) / 1200.0) * (1.0 + rng.uniform(0.004, 0.012) * np.sin(TAU * (cycles * t + rng.random())))
        if periodic:
            total = f.sum() / SR
            f = f * (np.round(total) / total)
        voice = dsp.saw(f, start=rng.random())
        late = int(rng.normal(0.0, 0.018) * SR)
        out += np.roll(voice, late) if periodic else dsp.fit(np.concatenate([np.zeros(max(late, 0)), voice]), n)
    return out / np.sqrt(count)


@sfx("chant_loop", "tier2", loop=5.0, level=-24.0,
     use="A Coalition unit charging a chanted volley (positional): a wordless chant, eight beats at the music's "
         "96 beats a minute, in its key. Play one per charging unit, started on the beat: the more units, the "
         "bigger the choir.")
def chant_loop(rng, v):
    beat = 0.625                                              # 96 beats a minute: two bars per pass
    n = n_(8 * beat)
    line = np.zeros(n)
    opening = np.zeros(n)
    syllable = np.zeros(n)
    for i, (hz, vowel) in enumerate(((D3, 0), (D3, 0), (F3, 1), (E3, 0), (D3, 0), (D3, 0), (C3, 1), (D3, 0))):
        s, e = n_(i * beat), n_((i + 1) * beat)
        line[s:e] = hz
        opening[s:e] = vowel
        x = np.arange(e - s) / (e - s)
        syllable[s:e] = np.minimum(x / 0.1, 1.0) * (1.0 - 0.6 * x ** 2)     # each beat a new push of breath
    smooth = signal.windows.hann(n_(0.06))
    smooth /= smooth.sum()
    line = np.exp(ndimage.convolve1d(np.log(line), smooth, mode="wrap"))    # the pitch slides between notes
    opening = ndimage.convolve1d(opening, smooth, mode="wrap")
    syllable = ndimage.convolve1d(syllable, smooth, mode="wrap")
    tt = dsp.secs(n)

    def section(count: int, octave: float, scale: float) -> np.ndarray:
        raw = _singers(rng, line * octave, count, 9.0, True) + 0.05 * dsp.noise(n, rng, -3.0)
        return parts.unit(parts.periodic_shape(raw, lambda f, tm: _vowel(f, np.interp(tm, tt, opening), scale), 2048))

    choir = (section(7, 1.0, 1.0) + 0.8 * section(5, 1.0, 1.1) + 0.55 * section(5, 2.0, 1.18)) * syllable
    drone = parts.unit(parts.periodic_shape(_singers(rng, np.full(n, D3), 4, 6.0, True), lambda f, tm: _vowel(f, 0.0), 2048))
    staff = parts.fold_events(n, [(i * 4 * beat, parts.thump(n_(0.3), 110, 62, 0.03, 0.2), 1.0) for i in range(2)])
    y = choir + 0.3 * drone + 0.7 * staff                      # staffs strike the ground at the top of each bar
    ir = dsp.space_ir(rng, 1.3, pre=0.02, bright=3500, dark=900, low_cut=150.0)
    return y + 0.4 * dsp.circular(lambda z: signal.fftconvolve(z, ir)[:len(z)], y)


@sfx("bell", "tier2", variants=3, level=-17.0,
     use="A bell truck rings: one heavy bronze bell. The three variants are tuned D, F and A (the music's home "
         "chord), so several trucks together ring in tune with the score.")
def bell(rng, v):
    prime = (D4, F4, A3)[v - 1]
    n = n_(3.6)
    # the partials of a church bell against its strike note: hum, prime, tierce (a minor third:
    # the bell's own sad colour), quint, nominal, and the bright ones that die first
    ratios = (0.5, 1.0, 1.189, 1.5, 2.0, 2.52, 3.01, 4.07, 5.4, 6.8)
    t60s = (3.4, 2.6, 2.0, 1.3, 1.5, 0.9, 0.7, 0.45, 0.3, 0.22)
    amps = (0.55, 1.0, 0.75, 0.35, 0.8, 0.3, 0.3, 0.22, 0.14, 0.1)
    ring = np.zeros(n)
    for r, d, g in zip(ratios, t60s, amps):
        twin = 1.0 + rng.uniform(0.0008, 0.0025)             # no bell is round: every partial is a pair that beats
        ring += dsp.modal(n, [prime * r, prime * r * twin], [d, d * 0.93], [0.6 * g, 0.4 * g], rng)
    clapper = dsp.fit(dsp.click(rng, 900, 6000, 0.008), n) + 0.6 * dsp.fit(parts.thump(n_(0.12), prime * 0.75, prime * 0.5, 0.02, 0.08), n)
    dry = dsp.fade(ring, 0.0015, 0.0) + 0.9 * clapper
    return dsp.reverb(dry, dsp.space_ir(rng, 1.2, pre=0.012, bright=5000, dark=900, echoes=((0.19, 0.2, 2200.0),)), 0.14)


@sfx("relic_open", "tier2", level=-13.0, clip=True,
     use="The pontiff opens the Ark: the lid grinds aside, voices and light swell, then the relic lets go. The "
         "blast is 1.9 s in: start it that long before the cone fires.")
def relic_open(rng, v):
    blast = 1.9
    n = n_(4.3)
    t = dsp.secs(n)
    # the lid: stone dragged over stone, sticking and slipping, then it drops clear
    m = n_(1.0)
    stick = (0.5 + 0.5 * dsp.saw(dsp.env([(0, 14), (0.7, 30), (1.0, 22)], m) * (1.0 + 0.2 * dsp.wander(m, rng, 5.0)))) ** 2
    scrape = parts.whoosh(m, rng, [(0, 260), (0.8, 520), (1.0, 380)], 0.9) * dsp.lp(stick, 500, 1)
    scrape = scrape * dsp.env([(0, 0), (0.05, 0.7), (0.85, 1), (1.0, 0)], m)
    grit = parts.debris(m, rng, dsp.env([(0, 300), (0.9, 700), (1.0, 0)], m), parts.noise_kernels(rng, 5, 700, 3500, 0.003, 0.012))
    clunk = parts.thump(n_(0.5), 105, 52, 0.04, 0.4) + 0.5 * dsp.fit(
        parts.modal_kernels(rng, 1, 240, 330, 0.12, 0.2, ratios=(1.0, 2.7, 5.1), damp=0.4, tick=0.6)[0], n_(0.5))
    lid = dsp.mix((scrape, 0.5), (grit, 0.04), (clunk, 0.8, 1.0))

    # the light: an open fifth of voices swelling, a shimmer climbing, and at the blast the major
    # third arrives (the score is in D minor; this is the one D major chord in the game)
    def voices(freqs, count: int, scale: float) -> np.ndarray:
        raw = sum(_singers(rng, np.full(n, hz), count, 8.0, False) for hz in freqs)
        return parts.unit(dsp.spectral_shape(raw + 0.05 * dsp.noise(n, rng, -3.0), lambda f, tm: _vowel(f, 1.0, scale), 2048))

    swell = dsp.env([(0, 0.0), (0.45, 0.0), (1.2, 0.3), (blast - 0.03, 0.75), (blast + 0.02, 1.0), (blast + 0.6, 0.8), (3.6, 0.2), (4.3, 0.0)], n)
    after = dsp.env([(0, 0.0), (blast - 0.01, 0.0), (blast + 0.03, 1.0), (blast + 0.7, 0.8), (3.6, 0.2), (4.3, 0.0)], n)
    left = voices((D4, A4), 4, 1.0) * swell + 0.8 * voices((FS5, D5), 3, 1.15) * after
    right = voices((A4, D5), 4, 1.08) * swell + 0.8 * voices((FS5, A5), 3, 1.2) * after
    rise = np.clip(t / blast, 0.0, 1.0)
    shimmer = parts.whoosh(n, rng, dsp.env([(0, 2500), (blast, 9000), (4.3, 9000)], n, "exp"), 0.5, slope=0.0) * rise ** 2 * (t < blast)
    glint = parts.norm(parts.sparkle(n, rng, dsp.env([(0, 0), (0.4, 40), (blast, 1600), (blast + 0.1, 2600), (3.4, 200), (4.3, 0)], n)))
    glint = glint * dsp.env([(0, 0), (blast, 0.6), (blast + 0.03, 1.0), (4.3, 0.0)], n)
    riser = dsp.sine(dsp.env([(0, D5), (0.5, D5), (blast, D6), (4.3, D6)], n, "exp")) * rise ** 3 * (t < blast)
    k = n - n_(blast)
    burst = parts.burst(k, rng, 13000, 300, 0.09, 1.2) + parts.thump(k, 82, 28, 0.1, 1.3, attack=0.004, harm=0.4, sat=2.2)
    center = dsp.mix((lid, 0.6), (shimmer, 0.12), (riser, 0.1), (burst, 1.1, blast))
    dry = np.stack([center + 0.45 * left + 0.06 * glint, center + 0.45 * right + 0.06 * np.roll(glint, 441)], axis=1)
    ir = dsp.space_ir(rng, 2.6, pre=0.03, bright=6000, dark=1200, stereo=True, low_cut=120.0)
    return dsp.reverb(dsp.fade(dry, 0.01, 0.3), ir, 0.3)
