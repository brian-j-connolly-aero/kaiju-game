"""Kaiju sounds: footsteps, swipes, stomps, the signature roar, body sounds, beam, molt, death.

The voice of the Lizard is one model (`voice`) used at three sizes for the roar and re-used for
the hurt, stagger, brace, eat and death sounds, so everything it utters is the same animal.
"""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import TAU, n_
from .parts import curve
from .registry import sfx

# ---- the creature voice ------------------------------------------------------------------------
# The roar has three parts, at the same proportions at every stage:
#   rise            the growl climbs in pitch and opens up
#   tear            full-throated scream, ripped into pulses, with the metallic screech on top
#   falling rumble  everything slides down in pitch into a long low growl
ROAR_PARTS = (0.22, 0.58)                      # end of the rise, end of the tear (share of the length)
ROAR_SECONDS = {1: 1.3, 2: 2.4, 3: 3.7}        # voiced length before the echo tail


def voice(rng: np.random.Generator, dur: float, *, f0, growl, scream, screech, screech_f, scream_f,
          tear, tear_rate: float, mouth, size: float = 1.0, rumble=None, vibrato=None,
          sub: float = 0.55, grit: float = 2.5) -> np.ndarray:
    """One utterance of the creature. Curves are break points over normalised time (0..1).

    f0          growl pitch in Hz (a sawtooth, with a subharmonic an octave below)
    growl       loudness of the growl: formant-filtered sawtooth with vibrato and roughness
    scream      loudness of the scream: noise through moving band-passes
    scream_f    center of the scream band in Hz
    screech     loudness of the metallic screech: a cluster of inharmonic partials
    screech_f   base frequency of the screech in Hz
    tear        how deeply the sound is ripped into pulses (0..1)
    tear_rate   pulses per second of the tear
    mouth       0 closed (dull) .. 1 wide open (bright): moves the formants
    size        scales formants and noise bands: > 1 is a bigger throat (lower)
    rumble      loudness of the sub-bass rumble under the fall
    vibrato     depth of the pitch wobble (share of the pitch)
    """
    n = n_(dur)
    t = dsp.secs(n)
    k = 1.0 / size
    pitch = curve(f0, dur, n, "exp")
    vib = curve(vibrato or [(0, 0.01), (1, 0.035)], dur, n)
    wobble = vib * np.sin(TAU * 5.7 * t + rng.uniform(0, TAU)) + 0.02 * dsp.wander(n, rng, 9.0)
    pitch = pitch * (1.0 + wobble)

    # growl: sawtooth plus subharmonic, made rough, through formants that follow the mouth
    src = dsp.saw(pitch) + sub * dsp.saw(pitch * 0.5, start=0.25) + 0.3 * dsp.saw(pitch * 1.006, start=0.6)
    rough = parts.unit(dsp.bp(dsp.noise(n, rng), 25.0, 90.0))
    src = src * (1.0 + 0.4 * rough)
    opening = curve(mouth, dur, n)

    def formants(f, tm):
        o = np.interp(tm, t, opening)
        m = (1.0 * dsp.lorentz(f, k * (300 + 420 * o), k * 110) + 0.7 * dsp.lorentz(f, k * (900 + 650 * o), k * 160)
             + 0.45 * dsp.lorentz(f, k * (2300 + 600 * o), k * 240) + 0.2 * dsp.lorentz(f, k * 3600, k * 400))
        chest = 0.6 * dsp.lowpass_mask(f, k * 240, 1.5)
        return (m + chest) * dsp.lowpass_mask(f, k * 5200, 2)

    g = parts.unit(dsp.spectral_shape(src, formants, 2048))

    # the tear: a sharp ramp that repeats, slightly irregular
    rate = tear_rate * (1.0 + 0.12 * dsp.wander(n, rng, 3.0))
    rasp = (0.5 + 0.5 * dsp.saw(rate, start=rng.random())) ** 1.6
    depth = curve(tear, dur, n)
    rasp = np.clip(dsp.lp(rasp, 700.0, 1), 0.0, 1.0)             # no clicks: each break takes about a millisecond
    rip = 1.0 - depth * rasp

    # scream: noise through band-passes that follow scream_f
    sf = curve(scream_f, dur, n, "exp") * k

    def scream_bands(f, tm):
        c = np.interp(tm, t, sf)
        return dsp.bump(f, c, 0.45) + 0.7 * dsp.bump(f, c * 2.3, 0.5) + 0.25 * dsp.bump(f, c * 0.5, 0.4)

    s = parts.unit(dsp.spectral_shape(dsp.noise(n, rng, -3.0), scream_bands, 1024)) * (1.0 + 0.3 * rough)

    # screech: inharmonic partials (a bowed-metal spectrum), each with its own flutter
    fs = curve(screech_f, dur, n, "exp") * k ** 0.6 * (1.0 + 0.045 * dsp.wander(n, rng, 4.0))
    sc = np.zeros(n)
    for ratio, w in zip((1.0, 1.47, 2.09, 2.56, 3.39, 4.08), (1.0, 0.75, 0.6, 0.45, 0.3, 0.22)):
        detune = 1.0 + 0.006 * dsp.wander(n, rng, 6.0)
        flutter = (0.65 + 0.35 * dsp.wander(n, rng, 22.0)) * (1.0 + 0.5 * dsp.wander(n, rng, 160.0))   # friction
        sc += w * dsp.sine(fs * ratio * detune, start=rng.random()) * flutter
    sc = parts.unit(sc)

    wet = (g * curve(growl, dur, n) * rip
           + 0.8 * s * curve(scream, dur, n) * (1.0 - 0.8 * depth * rasp)
           + 0.42 * sc * curve(screech, dur, n) * (1.0 - 0.6 * depth * rasp))
    y = dsp.drive(wet * 0.32, grit) * 2.2
    if rumble is not None:
        low = parts.unit(dsp.lp(dsp.noise(n, rng, -6.0), 95.0 * k ** 0.5, 2)) + 0.9 * dsp.sine(pitch * 0.5)
        tremor = 1.0 + 0.45 * dsp.wander(n, rng, 10.0)
        y = y + 0.3 * low * curve(rumble, dur, n) * tremor
    return dsp.fade(y, 0.004, 0.01)


def roar_space(rng: np.random.Generator, y: np.ndarray, stage: int, size: float) -> np.ndarray:
    """The space every roar goes out into: a street, a district, the whole night city. Shared
    by all four kaiju (see tier2.py), so a roar's size is heard the same way whoever makes it."""
    t60 = {1: 0.5, 2: 1.1, 3: 2.0}[stage]
    echoes = {1: ((0.09, 0.25, 3000.0),), 2: ((0.16, 0.3, 2400.0), (0.29, 0.2, 1500.0)),
              3: ((0.24, 0.34, 2000.0), (0.41, 0.26, 1300.0), (0.66, 0.16, 800.0))}[stage]
    ir = dsp.space_ir(rng, t60, pre=0.015 * stage, bright=6000.0 / size, dark=700.0, echoes=echoes, stereo=True,
                      low_cut=90.0)
    return dsp.reverb(y, ir, {1: 0.16, 2: 0.24, 3: 0.32}[stage])


def _roar(rng: np.random.Generator, stage: int) -> np.ndarray:
    dur = ROAR_SECONDS[stage]
    a, b = ROAR_PARTS
    base = {1: 132.0, 2: 80.0, 3: 52.0}[stage]              # growl pitch at the start
    size = {1: 0.72, 2: 1.0, 3: 1.42}[stage]
    y = voice(
        rng, dur, size=size,
        f0=[(0, base), (a * 0.6, base * 1.35), (a, base * 1.9), (a + 0.06, base * 2.0), (b, base * 1.6),
            (b + 0.12, base * 1.05), (0.85, base * 0.6), (1, base * 0.42)],
        growl=[(0, 0.45), (a * 0.5, 0.65), (a, 1.0), (b, 1.0), (b + 0.1, 0.8), (0.86, 0.45), (1, 0.0)],
        mouth=[(0, 0.1), (a * 0.7, 0.45), (a, 0.95), (b, 1.0), (b + 0.14, 0.45), (1, 0.05)],
        scream=[(0, 0.0), (a * 0.6, 0.1), (a - 0.02, 0.35), (a + 0.02, 1.0), (b - 0.03, 1.0), (b + 0.08, 0.3),
                (0.8, 0.05), (1, 0.0)],
        scream_f=[(0, 700), (a, 2100), (a + 0.08, 2400), (b, 1900), (b + 0.15, 1100), (1, 500)],
        screech=[(0, 0.0), (a * 0.4, 0.3), (a, 0.95), (b, 1.0), (b + 0.18, 0.5), (0.9, 0.05), (1, 0.0)],
        screech_f=[(0, 520), (a, 1850), (a + 0.05, 2000), (b, 1500), (b + 0.2, 820), (1, 380)],
        tear=[(0, 0.0), (a - 0.04, 0.08), (a + 0.01, 0.9), (b, 0.85), (b + 0.1, 0.4), (1, 0.2)],
        tear_rate={1: 54.0, 2: 41.0, 3: 30.0}[stage],
        rumble=[(0, 0.0), (a, 0.15), (b, 0.7), (b + 0.12, 1.0), (0.9, 0.5), (1, 0.0)] if stage > 1
        else [(0, 0.0), (b, 0.3), (b + 0.12, 0.45), (1, 0.0)],
        vibrato=[(0, 0.008), (b, 0.02), (1, 0.05)],
        sub={1: 0.35, 2: 0.55, 3: 0.7}[stage],
    )
    y = dsp.hp(y, {1: 60.0, 2: 38.0, 3: 24.0}[stage])
    return roar_space(rng, y, stage, size)


for _s in (1, 2, 3):
    sfx(f"kaiju_roar_lizard_s{_s}", "kaiju", level={1: -15.0, 2: -13.5, 3: -12.0}[_s], group="roar",
        use=f"Roar action at stage {_s}. The Lizard's signature: rise, tear, falling rumble.")(
        lambda rng, v, s=_s: _roar(rng, s))


# ---- footsteps, stomps, swipes -----------------------------------------------------------------
def _ground(n: int, rng: np.random.Generator, rate, stage: int) -> np.ndarray:
    """Asphalt and rubble under the foot: grit at stage 1, cracking slabs at stage 3. Dense
    noisy grit plus a few resonant knocks (rare, so they stay knocks and do not fuse into a tone)."""
    lo, hi = {1: (900.0, 6000.0), 2: (500.0, 4000.0), 3: (280.0, 2600.0)}[stage]
    rate = np.asarray(rate, dtype=float)
    grit = parts.debris(n, rng, rate, parts.noise_kernels(rng, 8, lo, hi, 0.003, 0.008 * stage), sigma=0.6)
    slabs = parts.debris(n, rng, rate * 0.025, parts.modal_kernels(rng, 10, lo * 0.5, lo * 2.5, 0.012 * stage, 0.03 * stage,
                                                                 damp=0.4, tick=0.7), sigma=0.5)
    return grit + 2.5 * slabs


def _step(rng: np.random.Generator, stage: int, v: int) -> np.ndarray:
    tune = (1.0, 0.93, 1.08)[v - 1] * rng.uniform(0.97, 1.03)
    if stage == 1:                                            # a bus-sized animal: a heavy thud
        n = n_(0.42)
        low = parts.thump(n, 125 * tune, 74 * tune, 0.035, 0.2, attack=0.003)
        slap = parts.burst(n, rng, 4500, 900, 0.03, 0.15)
        grit = _ground(n, rng, dsp.env([(0, 2600), (0.05, 900), (0.16, 0)], n), 1)
        claw = np.zeros(n)
        for i in range(3):                                    # three claws tick the asphalt
            dsp.put(claw, dsp.click(rng, 2500, 9000, 0.006), 0.012 + 0.011 * i + rng.uniform(0, 0.004), rng.uniform(0.5, 1))
        return dsp.mix((low, 0.6), (slap, 0.8), (grit, 0.03), (claw, 0.12))
    if stage == 2:                                            # building-sized: a boom that cracks the road
        n = n_(1.0)
        low = parts.thump(n, 70 * tune, 38 * tune, 0.06, 0.5, attack=0.004, harm=0.35, sat=2.0)
        hit = parts.burst(n, rng, 2600, 200, 0.035, 0.24)
        crunch = _ground(n, rng, dsp.env([(0, 2400), (0.12, 900), (0.45, 80), (0.8, 0)], n), 2)
        rumble = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 140, 2)) * dsp.decay(n, 0.7, 0.01)
        dry = dsp.mix((low, 0.7), (hit, 1.0), (crunch, 0.03), (rumble, 0.12))
        return dsp.reverb(dry, dsp.space_ir(rng, 0.6, pre=0.02, bright=3000, dark=500, echoes=((0.14, 0.22, 1200.0),)), 0.16)
    n = n_(2.2)                                               # skyscraper-sized: a seismic boom
    low = parts.thump(n, 48 * tune, 25 * tune, 0.12, 1.25, attack=0.008, harm=0.45, sat=2.2)
    toe = parts.thump(n, 60 * tune, 31 * tune, 0.08, 0.7, attack=0.006, harm=0.35)     # heel, then toe
    hit = parts.burst(n, rng, 1700, 130, 0.07, 0.5, slope=-4.0)
    crack = _ground(n, rng, dsp.env([(0, 2200), (0.25, 1200), (0.9, 150), (1.6, 0)], n), 3)
    shake = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 85, 2)) * dsp.decay(n, 1.7, 0.02) * (1 + 0.5 * dsp.wander(n, rng, 11.0))
    dry = dsp.mix((low, 0.8), (toe, 0.4, 0.085), (hit, 1.0), (crack, 0.05), (shake, 0.16))
    ir = dsp.space_ir(rng, 1.6, pre=0.03, bright=1800, dark=350, echoes=((0.27, 0.3, 700.0), (0.46, 0.2, 450.0)),
                      low_cut=40.0)
    return dsp.reverb(dry, ir, 0.22)


for _s in (1, 2, 3):
    sfx(f"kaiju_step_s{_s}", "kaiju", variants=3, level={1: -22.5, 2: -19.0, 3: -16.5}[_s], group="step", clip=True,
        use=("Each footfall at stage %d: " % _s) + {1: "a heavy thud with claw ticks.", 2: "a boom that cracks the road.",
                                                   3: "a seismic boom with a long ground shake."}[_s])(
        lambda rng, v, s=_s: _step(rng, s, v))


def _stomp(rng: np.random.Generator, stage: int) -> np.ndarray:
    dur = {1: 0.95, 2: 1.7, 3: 3.0}[stage]
    n = n_(dur)
    f_hi, f_lo = {1: (135.0, 55.0), 2: (95.0, 36.0), 3: (70.0, 24.0)}[stage]
    low = parts.thump(n, f_hi, f_lo, 0.05 * stage, {1: 0.4, 2: 0.85, 3: 1.6}[stage], attack=0.002 + 0.002 * stage,
                      harm=0.35, sat=2.2)
    hit = parts.burst(n, rng, {1: 6000, 2: 3500, 3: 2000}[stage], {1: 350, 2: 180, 3: 100}[stage], 0.03 * stage,
                      {1: 0.2, 2: 0.4, 3: 0.75}[stage])
    crack = np.zeros(n)                                       # the ground splits: sharp and bright
    for i in range(2 + stage):
        dsp.put(crack, dsp.click(rng, 1200 / stage, 8000 / stage, 0.02 * stage), rng.uniform(0, 0.03 * stage), rng.uniform(0.5, 1))
    # the shockwave rolls outward: a band of noise sweeping down
    ring_f = dsp.env([(0, {1: 1400, 2: 900, 3: 600}[stage]), (dur * 0.5, {1: 420, 2: 230, 3: 140}[stage]),
                      (dur, {1: 200, 2: 110, 3: 70}[stage])], n, "exp")
    ring = parts.whoosh(n, rng, ring_f, 0.75) * dsp.hump(n, dur * 0.16, 1.2, 2.2)
    rubble = _ground(n, rng, dsp.env([(0, 1200), (dur * 0.25, 500), (dur * 0.7, 80), (dur, 0)], n), stage)
    dry = dsp.mix((low, 1.0), (hit, 0.9), (crack, 0.2), (ring, 0.12), (rubble, 0.035))
    ir = dsp.space_ir(rng, {1: 0.45, 2: 0.9, 3: 1.8}[stage], pre=0.012 * stage, bright=4500 / stage, dark=450,
                      echoes=((0.1 * stage, 0.3, 2400.0 / stage), (0.17 * stage, 0.2, 1500.0 / stage)), low_cut=50.0)
    return dsp.reverb(dry, ir, {1: 0.15, 2: 0.2, 3: 0.26}[stage])


for _s in (1, 2, 3):
    sfx(f"kaiju_stomp_s{_s}", "kaiju", level={1: -16.5, 2: -15.0, 3: -12.5}[_s], group="stomp", clip=True,
        use=f"Stomp impact at stage {_s}: boom, ground crack and the shockwave rolling outward.")(
        lambda rng, v, s=_s: _stomp(rng, s))


def _swipe(rng: np.random.Generator, stage: int) -> np.ndarray:
    dur = {1: 0.42, 2: 0.66, 3: 1.05}[stage]
    tp = {1: 0.11, 2: 0.17, 3: 0.28}[stage]
    n = n_(dur)
    fa, fb, fc_ = {1: (900, 3200, 1000), 2: (480, 1700, 450), 3: (210, 820, 170)}[stage]
    path = dsp.env([(0, fa), (tp, fb), (dur, fc_)], n, "exp")
    air = parts.whoosh(n, rng, path, 0.7) * dsp.hump(n, tp, 2.2, 1.7)
    air = parts.comb(air, [2.1 * stage, 4.7 * stage], [0.7, 0.5])                # three claws: a hollow, flanged cut
    edge = parts.whoosh(n, rng, path * 2.6, 0.4, slope=0.0) * dsp.hump(n, tp, 5.0, 3.5)
    mass = parts.whoosh(n, rng, path * 0.28, 0.6, slope=-6.0) * dsp.hump(n, tp * 1.15, 2.0, 1.5)
    return dsp.mix((air, 1.0), (edge, 0.4), (mass, {1: 0.35, 2: 0.8, 3: 1.3}[stage]))


for _s in (1, 2, 3):
    sfx(f"kaiju_swipe_s{_s}", "kaiju", level={1: -22.0, 2: -19.0, 3: -16.0}[_s], group="swipe",
        use=f"Swipe at stage {_s}: claws through the air. Start it about "
            f"{ {1: 0.11, 2: 0.17, 3: 0.28}[_s]:.2f} s before the hit frame.")(
        lambda rng, v, s=_s: _swipe(rng, s))


# ---- body sounds -------------------------------------------------------------------------------
@sfx("kaiju_grab", "kaiju", level=-19.5, use="Grab: the claw closes on a car, wreck or chunk.")
def kaiju_grab(rng, v):
    n = n_(0.6)
    reach = parts.whoosh(n, rng, [(0, 300), (0.13, 900), (0.3, 250)], 0.7) * dsp.env([(0, 0), (0.11, 1), (0.16, 0.2), (0.3, 0)], n)
    clamp = parts.thump(n, 120, 70, 0.03, 0.16)
    crunch = parts.metal_crunch(rng, n, dsp.env([(0, 1500), (0.08, 600), (0.25, 0)], n)) * dsp.decay(n, 0.32)
    creak = dsp.fm(dsp.env([(0, 310), (0.25, 430)], n, "exp"), 2.76, 1.8, n) * dsp.env([(0, 0), (0.03, 1), (0.2, 0.3), (0.3, 0)], n)
    creak = creak * (0.5 + 0.5 * dsp.saw(70.0 * (1 + 0.2 * dsp.wander(n, rng, 8.0)))) ** 2       # stick and slip
    out = np.zeros(n)
    out += reach * 0.2
    dsp.put(out, clamp, 0.13, 1.0)
    dsp.put(out, crunch, 0.13, 0.12)
    dsp.put(out, creak, 0.16, 0.05)
    return out


@sfx("kaiju_throw", "kaiju", level=-18.0, use="Throw: the heave and the object leaving the hand.")
def kaiju_throw(rng, v):
    n = n_(0.85)
    grunt = voice(rng, 0.34, size=1.0, f0=[(0, 95), (0.3, 150), (1, 85)], growl=[(0, 0.2), (0.2, 1), (0.6, 0.7), (1, 0)],
                  mouth=[(0, 0.3), (0.3, 0.8), (1, 0.2)], scream=[(0, 0.1), (0.3, 0.5), (1, 0)], scream_f=[(0, 900), (1, 1300)],
                  screech=[(0, 0), (1, 0)], screech_f=[(0, 800), (1, 800)], tear=[(0, 0.5), (1, 0.4)], tear_rate=44.0)
    path = dsp.env([(0, 260), (0.16, 1300), (0.4, 800), (0.85, 300)], n, "exp")
    air = parts.whoosh(n, rng, path, 0.65) * dsp.env([(0, 0), (0.15, 1), (0.3, 0.55), (0.85, 0)], n)
    mass = parts.whoosh(n, rng, path * 0.3, 0.6, slope=-6.0) * dsp.hump(n, 0.17, 2, 1.4)
    return dsp.mix((grunt, 0.5), (air, 1.0), (mass, 0.8))


@sfx("kaiju_eat", "kaiju", level=-21.0, use="Eat (2 s, rooted): three crunching bites and a swallow.")
def kaiju_eat(rng, v):
    n = n_(2.1)
    out = np.zeros(n)
    for i, t0 in enumerate((0.03, 0.55, 1.05)):
        m = n_(0.42)
        jaw = parts.thump(m, 150 - 12 * i, 85, 0.02, 0.12)
        crunch = parts.metal_crunch(rng, m, dsp.env([(0, 2200), (0.1, 900), (0.3, 0)], m)) * dsp.decay(m, 0.38)
        wet = parts.whoosh(m, rng, [(0, 1500), (0.2, 700)], 0.6) * dsp.env([(0, 0), (0.015, 1), (0.12, 0.2), (0.25, 0)], m)
        dsp.put(out, jaw, t0, 1.0)
        dsp.put(out, crunch, t0 + 0.005, 0.2 - 0.025 * i)
        dsp.put(out, wet, t0, 0.1)
    hum = voice(rng, 1.5, f0=[(0, 80), (0.5, 88), (1, 70)], growl=[(0, 0), (0.1, 0.6), (0.9, 0.5), (1, 0)],
                mouth=[(0, 0.1), (1, 0.15)], scream=[(0, 0), (1, 0)], scream_f=[(0, 800), (1, 800)], screech=[(0, 0), (1, 0)],
                screech_f=[(0, 800), (1, 800)], tear=[(0, 0.5), (1, 0.5)], tear_rate=26.0)
    dsp.put(out, hum, 0.05, 0.12)
    m = n_(0.3)                                              # the swallow: a pitch that drops through the throat
    gulp = dsp.sine(dsp.env([(0, 330), (0.07, 420), (0.22, 95)], m, "exp")) * dsp.env([(0, 0), (0.02, 1), (0.15, 0.7), (0.26, 0)], m)
    gulp = dsp.reson(gulp + 0.3 * dsp.noise(m, rng, -3) * dsp.env([(0, 0), (0.03, 1), (0.2, 0)], m), 300, 1.2)
    dsp.put(out, gulp, 1.62, 0.35)
    dsp.put(out, parts.thump(n_(0.25), 90, 60, 0.03, 0.2), 1.74, 0.4)
    return out


@sfx("kaiju_brace", "kaiju", level=-18.5, use="Brace: plates lock and the animal digs in with a low growl.")
def kaiju_brace(rng, v):
    n = n_(0.95)
    lock = parts.thump(n, 95, 58, 0.04, 0.3)
    plates = parts.debris(n, rng, dsp.env([(0, 70), (0.12, 40), (0.35, 0)], n),
                          parts.modal_kernels(rng, 5, 220, 900, 0.03, 0.08, ratios=(1.0, 2.71, 5.3), damp=0.4))
    growl = voice(rng, 0.9, f0=[(0, 118), (0.25, 104), (1, 66)], growl=[(0, 0.2), (0.12, 1), (0.6, 0.7), (1, 0)],
                  mouth=[(0, 0.25), (1, 0.05)], scream=[(0, 0.2), (0.2, 0.1), (1, 0)], scream_f=[(0, 700), (1, 500)],
                  screech=[(0, 0), (1, 0)], screech_f=[(0, 700), (1, 700)], tear=[(0, 0.45), (1, 0.6)], tear_rate=33.0,
                  rumble=[(0, 0.3), (0.3, 0.8), (1, 0)])
    return dsp.mix((lock, 1.0), (plates, 0.1), (growl, 0.4, 0.02))


def _hurt(rng, v):
    # three takes on the same bark: plain, short and high, longer and lower with a second push
    tune = (1.0, 1.14, 0.88)[v - 1]
    dur = (0.52, 0.42, 0.66)[v - 1]
    push = [(0, 0.35), (0.07, 1), (0.5, 0.8), (1, 0)] if v < 3 else [(0, 0.35), (0.06, 1), (0.38, 0.5), (0.5, 0.95), (1, 0)]
    y = voice(rng, dur, size=0.95,
              f0=[(0, 165 * tune), (0.14, 265 * tune), (0.5, 205 * tune), (1, 112 * tune)],
              growl=push, mouth=[(0, 0.6), (0.15, 1), (1, 0.3)],
              scream=[(0, 0.6), (0.1, 1), (0.55, 0.35), (1, 0)], scream_f=[(0, 1500), (0.15, 2500), (1, 1100)],
              screech=[(0, 0.5), (0.15, 1), (0.6, 0.4), (1, 0)], screech_f=[(0, 1500 * tune), (0.15, 2300 * tune), (1, 900 * tune)],
              tear=[(0, 0.7), (0.5, 0.75), (1, 0.3)], tear_rate=47.0 * tune, vibrato=[(0, 0.01), (1, 0.03)])
    return dsp.reverb(dsp.hp(y, 50), dsp.space_ir(rng, 0.5, pre=0.01, bright=5000, dark=800, echoes=((0.11, 0.2, 2500.0),)), 0.14)


sfx("kaiju_hurt", "kaiju", variants=3, level=-16.0,
    use="Kaiju takes a heavy hit: a short pained bark. Shift the playback rate by stage (about 1.2, 1.0, 0.8).")(_hurt)


@sfx("kaiju_stagger", "kaiju", level=-15.5, use="Nerve breaks: a crack, then a long dizzy groan as the weak point opens.")
def kaiju_stagger(rng, v):
    y = voice(rng, 1.7,
              f0=[(0, 215), (0.08, 250), (0.45, 150), (1, 68)],
              growl=[(0, 0.4), (0.06, 1), (0.5, 0.85), (0.85, 0.4), (1, 0)], mouth=[(0, 0.7), (0.2, 1), (1, 0.15)],
              scream=[(0, 0.7), (0.1, 0.9), (0.4, 0.25), (1, 0)], scream_f=[(0, 1800), (0.1, 2300), (1, 700)],
              screech=[(0, 0.6), (0.12, 1), (0.6, 0.4), (1, 0)], screech_f=[(0, 1900), (0.1, 2100), (0.6, 1000), (1, 480)],
              tear=[(0, 0.6), (0.4, 0.5), (1, 0.7)], tear_rate=36.0,
              vibrato=[(0, 0.02), (0.3, 0.07), (1, 0.12)], rumble=[(0, 0), (0.4, 0.5), (0.8, 0.6), (1, 0)])
    m = n_(0.3)
    snap = parts.burst(m, rng, 9000, 900, 0.012, 0.07, slope=0.0) + 0.8 * parts.thump(m, 170, 60, 0.03, 0.22)
    dry = dsp.mix((snap, 0.9), (y, 1.0, 0.03))
    return dsp.reverb(dsp.hp(dry, 40), dsp.space_ir(rng, 0.9, pre=0.02, bright=4500, dark=700, echoes=((0.17, 0.25, 2000.0),)), 0.2)


# ---- the beam ----------------------------------------------------------------------------------
@sfx("kaiju_beam_charge", "kaiju", level=-16.0,
     use="Beam wind-up (0.8 s): rising whine and crackle; start kaiju_beam_loop when it ends.")
def kaiju_beam_charge(rng, v):
    n = n_(0.86)
    t = dsp.secs(n)
    rise = dsp.env([(0, 110), (0.8, 880), (0.86, 880)], n, "exp")
    swell = dsp.env([(0, 0.0), (0.05, 0.25), (0.8, 1.0), (0.86, 0.0)], n)
    tone = dsp.fm(rise, 1.5, dsp.env([(0, 0.5), (0.8, 4.0)], n), n) + 0.5 * dsp.saw(rise * 0.5)
    flutter = 0.55 + 0.45 * dsp.sine(dsp.env([(0, 9), (0.8, 46)], n, "exp"))       # the pulse speeds up
    suck = parts.whoosh(n, rng, dsp.env([(0, 500), (0.8, 6500)], n, "exp"), 0.6)
    sparks = parts.sparkle(n, rng, dsp.env([(0, 30), (0.8, 900)], n)) * dsp.env([(0, 0.2), (0.8, 1.0)], n)
    throat = voice(rng, 0.84, f0=[(0, 70), (1, 150)], growl=[(0, 0.2), (1, 1)], mouth=[(0, 0.2), (1, 0.9)],
                   scream=[(0, 0), (1, 0.5)], scream_f=[(0, 900), (1, 2600)], screech=[(0, 0), (1, 0.6)],
                   screech_f=[(0, 700), (1, 2300)], tear=[(0, 0.2), (1, 0.6)], tear_rate=38.0)
    y = dsp.mix((parts.unit(tone) * flutter * swell, 0.5), (suck * swell ** 1.5, 0.45), (sparks, 0.05),
                (dsp.fit(throat, n) * swell, 0.4))
    return dsp.fade(y, 0.0, 0.05)


@sfx("kaiju_beam_loop", "kaiju", loop=2.0, level=-15.0,
     use="Beam held (3 s): a roaring, buzzing stream. Loop while the beam fires.")
def kaiju_beam_loop(rng, v):
    n = n_(2.0)
    buzz = dsp.saw(55.0, n) + 0.8 * dsp.saw(110.5, n) + 0.6 * dsp.saw(165.0, n, start=0.3)      # 0.5 Hz grid: periodic
    buzz = parts.periodic_shape(buzz, lambda f, t: dsp.lorentz(f, 420, 260) + 0.7 * dsp.lorentz(f, 1250, 500)
                                + 0.5 * dsp.lowpass_mask(f, 160, 2))
    whine = dsp.fm(880.0, 1.5, 3.2 + 0.8 * dsp.lfo(n, 13), n) * (0.6 + 0.4 * dsp.lfo(n, 110))
    hiss = dsp.noise(n, rng, -2.0)
    hiss = parts.periodic_shape(hiss, lambda f, t: dsp.bump(f, 1500, 1.3) + 0.5 * dsp.bump(f, 6500, 0.6))
    flutter = 0.62 + 0.38 * dsp.saw(27.5, n) * (0.7 + 0.3 * dsp.lfo(n, 3))
    crackle = dsp.circular(lambda z: dsp.hp(z, 3000), parts.sparkle(n, rng, 500.0))
    y = parts.unit(buzz) * 0.8 * flutter + parts.unit(whine) * 0.22 + parts.unit(hiss) * 0.7 * flutter + crackle * 0.03
    return dsp.drive(y * 0.5, 2.0)


# ---- the molt ----------------------------------------------------------------------------------
@sfx("kaiju_heartbeat_loop", "kaiju", loop=1.68, level=-22.0,
     use="Cocoon (10 s): loud heartbeat, falls off with distance. Two beats per pass.")
def kaiju_heartbeat_loop(rng, v):
    body = n_(1.68)
    events = []
    for i, t0 in enumerate((0.0, 0.84)):
        m = n_(0.5)
        # each beat has a deep push and a knock an octave up, so it survives small speakers
        lub = parts.thump(m, 82, 46, 0.04, 0.46, attack=0.008, harm=0.5, sat=3.0) + 0.5 * parts.thump(m, 170, 96, 0.03, 0.2, attack=0.005)
        dub = parts.thump(m, 100, 58, 0.035, 0.36, attack=0.007, harm=0.5, sat=3.0) + 0.5 * parts.thump(m, 210, 120, 0.03, 0.16, attack=0.005)
        skin = parts.unit(dsp.bp(dsp.noise(m, rng, -3), 90, 420)) * dsp.decay(m, 0.2, 0.008)
        lub, dub = parts.norm(lub), parts.norm(dub)
        g = 1.0 if i == 0 else 0.94
        events += [(t0 + 0.02, lub, g), (t0 + 0.02, skin, 0.12 * g), (t0 + 0.27, dub, 0.62 * g), (t0 + 0.27, skin, 0.08 * g)]
    beat = parts.fold_events(body, events)
    hush = dsp.circular(lambda z: dsp.lp(z, 150, 2), dsp.noise(body, rng, -6)) * (0.7 + 0.3 * dsp.lfo(body, 2, 0.1))
    return beat + 0.012 * parts.unit(hush)


@sfx("kaiju_molt_blast", "kaiju", level=-13.0, clip=True,
     use="The cocoon bursts: a short inward suck, the blast wave, shell fragments, and the bigger animal's first "
         "breath. Start it 0.22 s before the blast frame.")
def kaiju_molt_blast(rng, v):
    pre = 0.22
    n = n_(3.6)
    m = n_(pre)
    suck = parts.whoosh(m, rng, [(0, 300), (pre, 4500)], 0.8) * dsp.env([(0, 0), (pre - 0.03, 1), (pre, 0.0)], m, "lin") ** 2
    low = parts.thump(n, 95, 24, 0.12, 2.0, attack=0.004, harm=0.4, sat=2.4)
    hit = parts.burst(n, rng, 9000, 140, 0.07, 1.1)
    wave_f = dsp.env([(0, 1800), (0.6, 400), (2.2, 90)], n, "exp")
    wave = parts.whoosh(n, rng, wave_f, 0.9) * dsp.hump(n, 0.28, 1.0, 2.6)
    shell = parts.rubble(n, rng, dsp.env([(0, 1500), (0.3, 900), (1.2, 150), (2.4, 0)], n), 0.6, knocks=0.05)
    breath = voice(rng, 1.5, size=1.3, f0=[(0, 60), (0.3, 96), (1, 40)], growl=[(0, 0), (0.25, 1), (0.7, 0.6), (1, 0)],
                   mouth=[(0, 0.2), (0.3, 0.9), (1, 0.2)], scream=[(0, 0), (0.3, 0.6), (1, 0)], scream_f=[(0, 900), (0.3, 1900), (1, 700)],
                   screech=[(0, 0), (0.3, 0.7), (1, 0)], screech_f=[(0, 700), (0.3, 1600), (1, 500)], tear=[(0, 0.3), (0.4, 0.7), (1, 0.3)],
                   tear_rate=31.0, rumble=[(0, 0), (0.5, 1), (1, 0)])
    blast = dsp.mix((low, 1.0), (hit, 0.9), (wave, 0.15), (shell, 0.03), (breath, 0.3, 0.35))
    ir = dsp.space_ir(rng, 2.2, pre=0.03, bright=5000, dark=500, echoes=((0.26, 0.3, 1800.0), (0.45, 0.22, 1100.0)),
                      stereo=True, low_cut=45.0)
    wet = dsp.reverb(blast, ir, 0.28)
    out = np.zeros((m + len(wet), 2))
    out[:m] += (suck * 0.12)[:, None]
    out[m:] += wet
    return out


@sfx("kaiju_death", "kaiju", level=-12.5,
     use="The kaiju dies: the roar breaks up as it sinks, then the body hits the ground.")
def kaiju_death(rng, v):
    dur = 3.9
    n = n_(dur)
    y = voice(rng, dur, size=1.15,
              f0=[(0, 140), (0.07, 190), (0.3, 128), (0.62, 66), (1, 30)],
              growl=[(0, 0.2), (0.05, 1), (0.3, 0.95), (0.6, 0.6), (0.85, 0.3), (1, 0)],
              mouth=[(0, 0.5), (0.1, 1), (0.5, 0.6), (1, 0.05)],
              scream=[(0, 0.4), (0.07, 1), (0.3, 0.6), (0.55, 0.15), (1, 0)], scream_f=[(0, 1500), (0.08, 2300), (1, 500)],
              screech=[(0, 0.3), (0.08, 1), (0.35, 0.7), (0.7, 0.2), (1, 0)], screech_f=[(0, 1500), (0.08, 2000), (0.5, 900), (1, 300)],
              tear=[(0, 0.6), (0.3, 0.7), (0.6, 0.85), (1, 0.9)], tear_rate=30.0,
              vibrato=[(0, 0.01), (0.4, 0.05), (1, 0.1)], rumble=[(0, 0), (0.3, 0.5), (0.7, 1.0), (1, 0.2)], sub=0.7)
    # the breath gives out: slow, deepening, irregular gaps
    gaps = 1.0 - curve([(0, 0), (0.35, 0.1), (0.7, 0.75), (1, 0.9)], dur, n) * (0.5 + 0.5 * dsp.wander(n, rng, 5.0)) ** 2
    y = y * gaps
    fall_at = 0.74 * dur
    m = n_(2.2)
    fall = dsp.mix((parts.thump(m, 52, 24, 0.12, 1.4, attack=0.008, harm=0.4, sat=2.2), 1.0),
                   (parts.burst(m, rng, 1600, 110, 0.06, 0.6, slope=-4.0), 0.7),
                   (_ground(m, rng, dsp.env([(0, 900), (0.4, 400), (1.5, 0)], m), 3), 0.03),
                   (parts.unit(dsp.lp(dsp.noise(m, rng, -6), 85, 2)) * dsp.decay(m, 1.8, 0.02), 0.16))
    dry = dsp.mix((dsp.hp(y, 28), 1.0), (fall, 1.7, fall_at))
    ir = dsp.space_ir(rng, 2.3, pre=0.04, bright=4500, dark=600, echoes=((0.25, 0.32, 1900.0), (0.43, 0.24, 1200.0), (0.7, 0.14, 800.0)),
                      stereo=True, low_cut=60.0)
    return dsp.reverb(dry, ir, 0.3)
