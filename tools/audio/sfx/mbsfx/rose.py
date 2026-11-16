"""The monster's communication rose (docs/ROADMAP.md, round 4): no words, only noises. A player
holds the rose key, picks a wedge, and every screen hears it from the monster.

Seven noises, each at the three sizes of the monster and in two versions (the server's pick
chooses the version, so every screen plays the same one): a big roar, a short roar, snuffles, a
growl, a chomp, a contented rumble, and a little musical mating call (a silly warbling tune).
The voice is the Lizard's own (`kaiju.voice`), so it is the same animal as its attack roar; each
size is lower, longer and louder than the one before.
"""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import n_
from .kaiju import roar_space, voice
from .registry import sfx

SIZE = {1: 0.72, 2: 1.0, 3: 1.42}              # throat size, as in the roar
STAGES = (1, 2, 3)


def _tune(v: int) -> float:
    return (1.0, 0.9)[v - 1]


# ---- the big roar --------------------------------------------------------------------------
def _roar(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """Two swells, a tear through both, and a long falling rumble: the creature showing off."""
    dur = {1: 1.5, 2: 2.3, 3: 3.3}[stage] * (1.0, 1.08)[v - 1]
    b = {1: 140.0, 2: 88.0, 3: 56.0}[stage] * _tune(v)
    y = voice(
        rng, dur, size=SIZE[stage],
        f0=[(0, b * 0.9), (0.15, b * 1.7), (0.3, b * 2.0), (0.42, b * 1.7), (0.55, b * 2.15), (0.75, b * 1.4), (1, b * 0.5)],
        growl=[(0, 0.4), (0.12, 1.0), (0.8, 0.9), (1, 0.0)],
        mouth=[(0, 0.2), (0.15, 0.9), (0.4, 0.75), (0.55, 1.0), (0.85, 0.5), (1, 0.1)],
        scream=[(0, 0.0), (0.12, 0.6), (0.3, 1.0), (0.42, 0.6), (0.55, 1.0), (0.7, 0.5), (1, 0.0)],
        scream_f=[(0, 800), (0.3, 2200), (0.55, 2400), (1, 600)],
        screech=[(0, 0.0), (0.25, 0.7), (0.55, 0.9), (0.8, 0.2), (1, 0.0)],
        screech_f=[(0, 600), (0.3, 1900), (0.55, 2100), (1, 400)],
        tear=[(0, 0.1), (0.2, 0.8), (0.6, 0.85), (1, 0.3)],
        tear_rate={1: 56.0, 2: 42.0, 3: 31.0}[stage] * _tune(v),
        rumble=[(0, 0.0), (0.3, 0.4), (0.7, 1.0), (1, 0.0)],
        vibrato=[(0, 0.01), (1, 0.05)],
        sub={1: 0.35, 2: 0.55, 3: 0.7}[stage],
    )
    return roar_space(rng, dsp.hp(y, {1: 60.0, 2: 38.0, 3: 24.0}[stage]), stage, SIZE[stage])


# ---- the short roar ------------------------------------------------------------------------
def _roar_short(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """One quick bark of a roar: up, over, down."""
    dur = {1: 0.55, 2: 0.8, 3: 1.15}[stage] * (1.0, 1.1)[v - 1]
    b = {1: 150.0, 2: 95.0, 3: 60.0}[stage] * _tune(v)
    y = voice(
        rng, dur, size=SIZE[stage],
        f0=[(0, b), (0.25, b * 1.9), (0.6, b * 1.5), (1, b * 0.6)],
        growl=[(0, 0.5), (0.15, 1.0), (0.7, 0.8), (1, 0.0)],
        mouth=[(0, 0.4), (0.2, 1.0), (1, 0.2)],
        scream=[(0, 0.3), (0.2, 1.0), (0.7, 0.4), (1, 0.0)],
        scream_f=[(0, 1200), (0.25, 2300), (1, 800)],
        screech=[(0, 0.2), (0.25, 0.8), (0.7, 0.3), (1, 0.0)],
        screech_f=[(0, 900), (0.25, 2000), (1, 600)],
        tear=[(0, 0.5), (0.3, 0.85), (1, 0.4)],
        tear_rate={1: 52.0, 2: 40.0, 3: 30.0}[stage],
        rumble=[(0, 0.0), (0.5, 0.6), (1, 0.0)],
        vibrato=[(0, 0.01), (1, 0.03)],
        sub={1: 0.35, 2: 0.55, 3: 0.7}[stage],
    )
    return roar_space(rng, dsp.hp(y, {1: 60.0, 2: 38.0, 3: 24.0}[stage]), stage, SIZE[stage])


# ---- snuffles --------------------------------------------------------------------------------
def _snuffle(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """Three or four sniffs through big nostrils, a puff of breath out, and a little snort."""
    k = SIZE[stage]
    sniffs = (3, 4)[v - 1]
    one = 0.13 * k ** 0.8
    gap = 0.06 * k ** 0.8
    lo, hi = 1100.0 / k, 5200.0 / k
    total = sniffs * (one + gap) + 0.55 * k
    out = np.zeros(n_(total + 0.3))
    t = 0.0
    for i in range(sniffs):
        m = n_(one * rng.uniform(0.85, 1.15))
        air = parts.unit(dsp.bp(dsp.noise(m, rng, -1.0), lo * rng.uniform(0.9, 1.1), hi))
        shape = dsp.env([(0, 0.0), (one * 0.7, 1.0), (one, 0.0)], m) ** 1.5      # an inhale swells, then stops
        dsp.put(out, air * shape, t, rng.uniform(0.7, 1.0) * (1.0 if i < sniffs - 1 else 1.2))
        t += one + gap * rng.uniform(0.8, 1.3)
    m = n_(0.3 * k)                                                             # the puff out
    puff = parts.unit(dsp.bp(dsp.noise(m, rng, -3.0), 300.0 / k, 2500.0 / k)) * dsp.env([(0, 0.0), (0.02, 1.0), (0.3 * k, 0.0)], m)
    dsp.put(out, puff, t + 0.04, 0.8)
    snort = voice(rng, 0.22 * k, size=k, f0=[(0, 120 / k), (1, 80 / k)], growl=[(0, 0.0), (0.2, 1.0), (1, 0.0)],
                  mouth=[(0, 0.05), (1, 0.05)], scream=[(0, 0.3), (1, 0.0)], scream_f=[(0, 500), (1, 400)],
                  screech=[(0, 0.0), (1, 0.0)], screech_f=[(0, 500), (1, 500)], tear=[(0, 0.9), (1, 0.9)],
                  tear_rate=34.0 / k ** 0.5)
    dsp.put(out, parts.norm(snort), t + 0.02, 0.5)
    return roar_space(rng, out, stage, k)


# ---- the growl -------------------------------------------------------------------------------
def _growl(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """Low, closed-mouthed and rattling: a warning, not an attack."""
    dur = {1: 1.2, 2: 1.7, 3: 2.4}[stage] * (1.0, 1.12)[v - 1]
    b = {1: 95.0, 2: 62.0, 3: 40.0}[stage] * _tune(v)
    y = voice(
        rng, dur, size=SIZE[stage],
        f0=[(0, b * 0.8), (0.2, b), (0.5, b * (1.0, 1.12)[v - 1]), (0.75, b * 0.92), (1, b * 0.7)],
        growl=[(0, 0.0), (0.1, 1.0), (0.85, 0.9), (1, 0.0)],
        mouth=[(0, 0.05), (0.5, 0.3), (1, 0.05)],
        scream=[(0, 0.0), (0.3, 0.15), (1, 0.0)],
        scream_f=[(0, 600), (1, 500)],
        screech=[(0, 0.0), (1, 0.0)], screech_f=[(0, 500), (1, 500)],
        tear=[(0, 0.6), (0.5, 0.85), (1, 0.7)],
        tear_rate={1: 38.0, 2: 29.0, 3: 22.0}[stage],
        rumble=[(0, 0.3), (0.5, 0.8), (1, 0.0)],
        vibrato=[(0, 0.01), (1, 0.02)],
        sub={1: 0.45, 2: 0.6, 3: 0.75}[stage],
    )
    return roar_space(rng, dsp.hp(y, {1: 45.0, 2: 32.0, 3: 22.0}[stage]), stage, SIZE[stage])


# ---- the chomp -------------------------------------------------------------------------------
def _chomp(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """A grunt, then the jaws snapping shut twice on nothing: clack, clack."""
    k = SIZE[stage]
    dur = {1: 0.7, 2: 0.95, 3: 1.3}[stage]
    out = np.zeros(n_(dur + 0.2))
    grunt = voice(rng, 0.25 * k, size=k, f0=[(0, 130 / k), (0.4, 170 / k), (1, 100 / k)],
                  growl=[(0, 0.3), (0.3, 1.0), (1, 0.0)], mouth=[(0, 0.3), (0.4, 0.8), (1, 0.1)],
                  scream=[(0, 0.3), (1, 0.0)], scream_f=[(0, 1200), (1, 700)], screech=[(0, 0.0), (1, 0.0)],
                  screech_f=[(0, 600), (1, 600)], tear=[(0, 0.6), (1, 0.6)], tear_rate=44.0 / k ** 0.5)
    dsp.put(out, parts.norm(grunt), 0.0, 0.45)
    snaps = (0.2 * k ** 0.7, (0.47, 0.42)[v - 1] * k ** 0.7)
    for i, t0 in enumerate(snaps):
        m = n_(0.25 * k)
        jaw = parts.thump(m, {1: 260.0, 2: 170.0, 3: 110.0}[stage], {1: 150.0, 2: 95.0, 3: 60.0}[stage], 0.01 * k, 0.08 * k,
                          attack=0.0008, harm=0.5, sat=2.4)
        teeth = dsp.fit(dsp.click(rng, 1800.0 / k ** 0.5, 7000.0 / k ** 0.5, 0.012 * k), m)
        crunch = parts.burst(m, rng, 6000.0 / k, 900.0 / k, 0.012, 0.05 * k)
        dsp.put(out, jaw + 0.6 * teeth + 0.35 * crunch, t0, (1.0, 0.85)[i])
    return roar_space(rng, out, stage, k)


# ---- the contented rumble ----------------------------------------------------------------------
def _rumble(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """A giant purr: two slow breaths of it, out and in, with a pleased lilt at the end."""
    dur = {1: 1.6, 2: 2.2, 3: 3.0}[stage] * (1.0, 1.1)[v - 1]
    b = {1: 70.0, 2: 46.0, 3: 30.0}[stage] * _tune(v)
    y = voice(
        rng, dur, size=SIZE[stage],
        f0=[(0, b * 0.95), (0.45, b), (0.5, b * 0.9), (0.85, b * 1.0), (0.93, b * 1.25), (1, b * 1.1)],
        growl=[(0, 0.0), (0.08, 0.9), (0.42, 0.8), (0.5, 0.35), (0.58, 0.85), (0.9, 0.9), (1, 0.0)],
        mouth=[(0, 0.02), (0.85, 0.05), (0.95, 0.3), (1, 0.1)],
        scream=[(0, 0.0), (1, 0.0)], scream_f=[(0, 400), (1, 400)],
        screech=[(0, 0.0), (1, 0.0)], screech_f=[(0, 400), (1, 400)],
        tear=[(0, 0.85), (0.9, 0.85), (1, 0.4)],
        tear_rate={1: 24.0, 2: 19.0, 3: 15.0}[stage],
        rumble=[(0, 0.2), (0.5, 0.5), (1, 0.0)],
        vibrato=[(0, 0.005), (0.85, 0.01), (1, 0.03)],
        sub={1: 0.5, 2: 0.65, 3: 0.8}[stage],
        grit=1.6,
    )
    return roar_space(rng, dsp.hp(y, {1: 35.0, 2: 26.0, 3: 20.0}[stage]), stage, SIZE[stage])


# ---- the mating call --------------------------------------------------------------------------
# Two silly little tunes in a major pentatonic, semitones above the stage's base note, with how
# long each note lasts (seconds at stage 2; a bigger monster sings slower).
MATING_TUNES = {
    1: ([0, 4, 7, 12, 7, 12, 16], [0.18, 0.18, 0.18, 0.36, 0.15, 0.15, 0.62]),
    2: ([7, 12, 9, 7, 4, 7, 12], [0.16, 0.16, 0.16, 0.16, 0.16, 0.3, 0.66]),
}


def _mating(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    """A warbling, wobbling tune sung by the creature, with a soft whistle doubling it an octave
    up so it reads as music: earnest and ridiculous."""
    notes, lengths = MATING_TUNES[v]
    slow = {1: 0.85, 2: 1.0, 3: 1.25}[stage]
    lengths = [d * slow for d in lengths]
    dur = sum(lengths)
    base = {1: 220.0, 2: 147.0, 3: 98.0}[stage]
    f0, loud, mouth = [], [], []
    t = 0.0
    glide = 0.03
    for i, (semi, d) in enumerate(zip(notes, lengths)):
        f = base * 2.0 ** (semi / 12.0)
        a, z = t / dur, (t + d) / dur
        f0 += [(a, f), (max(a, z - glide / dur), f)]
        loud += [(a, 0.35), (a + 0.25 * glide / dur, 1.0), (max(a, z - 1.5 * glide / dur), 0.85)]
        open_ = 0.35 + 0.6 * semi / 16.0
        mouth += [(a, open_ * 0.7), (min(z, a + 0.4 * (z - a)), open_)]
        t += d
    f0.append((1.0, f0[-1][1] * 0.94))
    loud.append((1.0, 0.0))
    mouth.append((1.0, 0.2))
    n = n_(dur)
    y = voice(
        rng, dur, size=SIZE[stage] * 0.8,
        f0=f0, growl=loud, mouth=mouth,
        scream=[(0, 0.08), (1, 0.05)], scream_f=[(0, 1600), (1, 1400)],
        screech=[(0, 0.12), (1, 0.12)], screech_f=[(0, base * 4), (1, base * 4)],
        tear=[(0, 0.12), (1, 0.12)], tear_rate=60.0,
        vibrato=[(0, 0.045), (1, 0.065)],
        sub=0.2, grit=1.4,
    )
    pitch = parts.curve(f0, dur, n, "exp") * (1.0 + 0.05 * np.sin(2 * np.pi * 6.2 * dsp.secs(n)))
    whistle = dsp.sine(pitch * 2.0) * parts.curve(loud, dur, n) ** 1.5
    y = dsp.fit(y, n) + 0.22 * parts.norm(whistle)
    return roar_space(rng, dsp.fade(dsp.hp(y, 70.0), 0.01, 0.05), stage, SIZE[stage])


SOUNDS = {
    "roar": (_roar, {1: -15.0, 2: -13.5, 3: -12.0}, "the big roar: two swells and a long falling rumble"),
    "roar_short": (_roar_short, {1: -16.0, 2: -14.5, 3: -13.0}, "a short roar: one quick bark"),
    "snuffle": (_snuffle, {1: -22.0, 2: -20.5, 3: -19.0}, "snuffles: sniffs, a puff of breath and a snort"),
    "growl": (_growl, {1: -18.0, 2: -16.5, 3: -15.0}, "a low, rattling growl"),
    "chomp": (_chomp, {1: -18.0, 2: -16.5, 3: -15.0}, "a grunt and the jaws snapping shut twice"),
    "rumble": (_rumble, {1: -21.0, 2: -19.5, 3: -18.0}, "a contented rumble: a giant purr with a pleased lilt"),
    "mating": (_mating, {1: -18.0, 2: -16.5, 3: -15.0}, "the mating call: a silly warbling tune"),
}

for _name, (_fn, _levels, _what) in SOUNDS.items():
    for _s in STAGES:
        sfx(f"kaiju_rose_{_name}_s{_s}", "kaiju", variants=2, level=_levels[_s], group=f"rose_{_name}",
            clip=_name == "chomp",
            use=f"Communication rose, stage {_s}: {_what}. Two versions; the server's pick chooses one, so every "
                f"screen plays the same.")(lambda rng, v, f=_fn, s=_s: f(rng, s, v))
