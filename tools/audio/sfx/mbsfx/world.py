"""World sounds: explosions, crumbling model buildings, glass, cars, props, water, and the loops
(crowd, siren, fire, three times of day, high wind)."""
from __future__ import annotations

import numpy as np
from scipy import signal

from . import dsp, parts
from .dsp import SR, TAU, n_
from .registry import sfx

# ---- explosions: boom, then sparkler crackle -------------------------------------------------
_EXPLOSION = {
    # seconds, thump Hz from/to, pitch-drop time, thump decay, burst filter open/close Hz, filter time,
    # burst decay, crackle seconds, space decay, wet level
    "s": dict(dur=0.85, f=(190.0, 70.0), tau=0.03, t60=0.22, open=12000.0, close=950.0, tclose=0.04, bt60=0.36,
              crackle=0.55, rt=0.45, wet=0.1),
    "m": dict(dur=1.7, f=(118.0, 40.0), tau=0.06, t60=0.62, open=8500.0, close=330.0, tclose=0.07, bt60=0.9,
              crackle=1.05, rt=1.0, wet=0.2),
    "l": dict(dur=3.1, f=(86.0, 27.0), tau=0.11, t60=1.35, open=6500.0, close=150.0, tclose=0.12, bt60=1.7,
              crackle=1.9, rt=2.0, wet=0.28),
}


def sparkler(n: int, rng: np.random.Generator, seconds: float, start: float = 0.02) -> np.ndarray:
    """The model-city sparkler: a bright fizz of ticks that thins out into single pops."""
    rate = dsp.env([(0, 0), (start, 300), (start + 0.03, 2800), (0.4 * seconds, 1000), (seconds, 140),
                    (1.25 * seconds, 0)], n)
    loud = dsp.env([(0, 0.0), (start, 0.4), (start + 0.04, 1.0), (seconds, 0.4), (1.25 * seconds, 0.0)], n)
    ticks = parts.sparkle(n, rng, rate) * loud
    pops = parts.debris(n, rng, rate * 0.02, [dsp.click(rng, 1800, 7000, 0.006), dsp.click(rng, 2600, 9000, 0.004)], 0.5) * loud
    fizz = parts.unit(dsp.hp(dsp.noise(n, rng), 5500, 2)) * loud ** 2 * (0.55 + 0.45 * dsp.wander(n, rng, 35.0))
    return parts.norm(ticks) + 0.8 * parts.norm(pops) + 0.12 * fizz


def _explosion(rng: np.random.Generator, size: str, v: int) -> np.ndarray:
    p = _EXPLOSION[size]
    tune = (1.0, 0.92, 1.09)[v - 1] * rng.uniform(0.98, 1.02)
    n = n_(p["dur"])
    low = parts.thump(n, p["f"][0] * tune, p["f"][1] * tune, p["tau"], p["t60"], attack=0.002, harm=0.35, sat=2.2)
    body = parts.burst(n, rng, p["open"], p["close"] * tune, p["tclose"], p["bt60"])
    crack = dsp.fit(dsp.click(rng, 1500, 12000, 0.004), n)
    layers = [(low, {"s": 0.7, "m": 0.7, "l": 0.9}[size]), (body, 1.0), (crack, 0.3), (sparkler(n, rng, p["crackle"]), 0.24)]
    if size != "s":                                           # bigger blasts keep rolling
        roll = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 150, 2)) * dsp.decay(n, p["t60"] * 1.4, 0.03)
        layers.append((roll * (1 + 0.5 * dsp.wander(n, rng, 7.0)), 0.14 if size == "m" else 0.2))
    dry = dsp.mix(*layers)
    echoes = {"s": (), "m": ((0.17, 0.25, 1800.0),), "l": ((0.24, 0.32, 1400.0), (0.43, 0.22, 900.0))}[size]
    ir = dsp.space_ir(rng, p["rt"], pre=0.012, bright=5000, dark=500, echoes=echoes, low_cut=60.0)
    return dsp.reverb(dry, ir, p["wet"])


for _z, _lv, _what in (("s", -18.0, "rocket hits, small blasts"), ("m", -15.0, "tank shells, thrown cars, vehicles"),
                       ("l", -12.5, "artillery, building-sized blasts")):
    sfx(f"explosion_{_z}", "world", variants=3, level=_lv, group="explosion", clip=True,
        use=f"Explosion, {'small' if _z == 's' else 'medium' if _z == 'm' else 'large'}: {_what}. "
            "Boom first, sparkler crackle over and after it.")(lambda rng, v, z=_z: _explosion(rng, z, v))


# ---- buildings -------------------------------------------------------------------------------
@sfx("structure_hit", "world", variants=3, level=-20.0, clip=True,
     use="A shot or claw hits a building that stays up: smack, plaster crack, a sprinkle of bits.")
def structure_hit(rng, v):
    tune = (1.0, 0.9, 1.12)[v - 1]
    n = n_(0.7)
    thud = parts.thump(n, 150 * tune, 72 * tune, 0.03, 0.18)
    smack = parts.burst(n, rng, 7500, 550 * tune, 0.02, 0.12)
    bits = parts.rubble(n, rng, dsp.env([(0, 3200), (0.06, 1300), (0.3, 160), (0.55, 0)], n), 1.0 / tune)
    dust = parts.unit(dsp.hp(dsp.noise(n, rng), 4000, 2)) * dsp.env([(0, 0), (0.04, 1), (0.5, 0)], n) ** 2
    return dsp.mix((thud, 0.8), (smack, 0.9), (bits, 0.04), (dust, 0.02))


def _chunk_thuds(n: int, rng: np.random.Generator, count: int, span: float, f_lo: float, f_hi: float) -> np.ndarray:
    """Big pieces landing: dull knocks with a little low thump, most of them early."""
    out = np.zeros(n)
    for _ in range(count):
        t0 = span * rng.beta(1.3, 2.2)
        f = np.exp(rng.uniform(np.log(f_lo), np.log(f_hi)))
        m = n_(0.3)
        k = (parts.thump(m, f * 1.5, f, 0.02, rng.uniform(0.08, 0.2), attack=0.001)
             + 0.6 * dsp.fit(parts.modal_kernels(rng, 1, f * 2.2, f * 4.5, 0.03, 0.07, ratios=(1.0, 2.7, 5.1), damp=0.4, tick=0.6)[0], m))
        dsp.put(out, k, t0, rng.uniform(0.4, 1.0))
    return out


def _crumble(rng: np.random.Generator, size: str, v: int) -> np.ndarray:
    tune = (1.0, 0.92, 1.1)[v - 1]
    if size == "s":                                           # a kiosk, a porch, a garden wall
        n = n_(0.85)
        crack = parts.burst(n, rng, 6500, 850, 0.02, 0.1)
        bits = parts.rubble(n, rng, dsp.env([(0, 2600), (0.1, 1600), (0.45, 260), (0.78, 0)], n), 1.0 / tune)
        thud = parts.thump(n, 160 * tune, 92 * tune, 0.025, 0.12)
        dust = parts.unit(dsp.hp(dsp.noise(n, rng), 3500, 2)) * dsp.hump(n, 0.12, 1.0, 2.0)
        return dsp.mix((crack, 0.7), (bits, 0.05), (thud, 0.4), (dust, 0.02))
    if size == "m":                                           # a house, a shop: the walls fold
        n = n_(1.75)
        crack = parts.burst(n, rng, 5500, 600, 0.03, 0.14)
        thud = parts.thump(n, 98 * tune, 50 * tune, 0.05, 0.38)
        rumble = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 230, 2)) * dsp.hump(n, 0.3, 1.0, 2.0)
        bits = parts.rubble(n, rng, dsp.env([(0, 1500), (0.25, 3200), (0.8, 1300), (1.4, 220), (1.7, 0)], n), 1.5 / tune)
        chunks = _chunk_thuds(n, rng, 8, 1.2, 130 * tune, 380 * tune)
        dust = parts.unit(dsp.hp(dsp.noise(n, rng), 3000, 2)) * dsp.hump(n, 0.5, 1.0, 2.0)
        dry = dsp.mix((crack, 0.6), (thud, 0.7), (rumble, 0.16), (bits, 0.045), (chunks, 0.3), (dust, 0.02))
        return dsp.reverb(dry, dsp.space_ir(rng, 0.5, pre=0.01, bright=4000, dark=700), 0.1)
    n = n_(3.4)                                               # a tower: floors pancake, then it settles
    crack = parts.burst(n, rng, 5000, 420, 0.04, 0.2)
    thud = parts.thump(n, 72 * tune, 32 * tune, 0.1, 0.85, attack=0.004, harm=0.35, sat=2.0)
    rumble = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 150, 2)) * dsp.hump(n, 0.9, 0.8, 2.2) * (1 + 0.4 * dsp.wander(n, rng, 9.0))
    bits = parts.rubble(n, rng, dsp.env([(0, 1200), (0.5, 3600), (1.3, 2700), (2.4, 520), (3.3, 0)], n), 2.2 / tune)
    chunks = _chunk_thuds(n, rng, 16, 2.6, 70 * tune, 300 * tune)
    dust = parts.unit(dsp.hp(dsp.noise(n, rng), 2500, 2)) * dsp.hump(n, 1.1, 1.0, 2.0)
    dry = dsp.mix((crack, 0.5), (thud, 0.9), (rumble, 0.28), (bits, 0.035), (chunks, 0.35), (dust, 0.02))
    return dsp.reverb(dry, dsp.space_ir(rng, 1.1, pre=0.02, bright=3500, dark=500, echoes=((0.2, 0.2, 1200.0),), low_cut=50.0), 0.16)


for _z, _lv, _what in (("s", -20.0, "small structures (houses, kiosks)"), ("m", -17.0, "medium structures (shops, apartments)"),
                       ("l", -14.0, "towers and landmarks")):
    sfx(f"crumble_{_z}", "world", variants=3, level=_lv, group="crumble", clip=True,
        use=f"Collapse of {_what}: plaster cracking, gravel, chunks knocking down.")(
        lambda rng, v, z=_z: _crumble(rng, z, v))


@sfx("glass", "world", variants=3, level=-22.0, use="Windows and glass fronts shattering.")
def glass(rng, v):
    tune = (1.0, 1.15, 0.88)[v - 1]
    n = n_(0.95)
    hit = dsp.fit(dsp.click(rng, 2500, 13000, 0.005), n) + parts.burst(n, rng, 13000, 3500, 0.01, 0.05, slope=0.0)
    ring = parts.shards(n, rng, 60, 2300 * tune, 11000 * tune, 0.11)
    grit = parts.debris(n, rng, dsp.env([(0, 3000), (0.1, 900), (0.55, 0)], n),
                        parts.noise_kernels(rng, 4, 4000, 13000, 0.001, 0.004))
    return dsp.mix((hit, 0.5), (parts.norm(ring), 1.0), (grit, 0.05))


@sfx("car_crush", "world", variants=3, level=-18.0, clip=True, use="A car is stepped on, swiped or thrown into something.")
def car_crush(rng, v):
    tune = (1.0, 0.88, 1.12)[v - 1]
    n = n_(0.85)
    thud = parts.thump(n, 115 * tune, 58 * tune, 0.03, 0.22)
    crunch = parts.metal_crunch(rng, n, dsp.env([(0, 2600), (0.12, 1500), (0.4, 380), (0.7, 0)], n), 170 * tune, 2500 * tune)
    crunch = crunch * dsp.env([(0, 1), (0.25, 0.7), (0.8, 0)], n)
    m = n_(0.3)
    squeal = dsp.fm(dsp.env([(0, 520 * tune), (0.25, 380 * tune)], m, "exp"), 2.41, 2.2, m)
    squeal = squeal * dsp.hump(m, 0.06, 1.0, 1.5) * (0.5 + 0.5 * dsp.saw(85.0 * (1 + 0.25 * dsp.wander(m, rng, 9.0)))) ** 2
    tinkle = parts.shards(n, rng, 14, 3000, 10000, 0.08, 0.015, 0.06)
    return dsp.mix((thud, 1.0), (crunch, 0.14), (squeal, 0.035, 0.07), (parts.norm(tinkle), 0.04, 0.03))


@sfx("prop_break", "world", variants=3, level=-24.0, clip=True, use="Street furniture breaks: kiosk, lamp, bench, hydrant, tree.")
def prop_break(rng, v):
    tune = (1.0, 1.2, 0.82)[v - 1]
    n = n_(0.5)
    snap = parts.burst(n, rng, 8500, 1300 * tune, 0.008, 0.05, slope=0.0)
    knocks = parts.debris(n, rng, dsp.env([(0, 520), (0.05, 220), (0.3, 0)], n),
                          parts.modal_kernels(rng, 6, 350 * tune, 1600 * tune, 0.02, 0.07, ratios=(1.0, 2.76, 5.4), damp=0.5))
    first = dsp.fit(parts.modal_kernels(rng, 1, 420 * tune, 700 * tune, 0.05, 0.09, ratios=(1.0, 2.76, 5.4), damp=0.5)[0], n)
    thud = parts.thump(n, 190 * tune, 110 * tune, 0.02, 0.09)
    return dsp.mix((snap, 0.7), (first, 0.5), (knocks, 0.15), (thud, 0.7))


@sfx("splash", "world", level=-20.0, use="Something heavy goes into the river or the bay.")
def splash(rng, v):
    n = n_(1.35)
    slap = parts.burst(n, rng, 5500, 450, 0.03, 0.16)
    plunge = parts.thump(n, 95, 48, 0.05, 0.32)
    spray = parts.whoosh(n, rng, [(0, 900), (0.15, 2800), (1.3, 1500)], 1.1, slope=-2.0) * dsp.env([(0, 0), (0.03, 1), (0.3, 0.5), (1.3, 0)], n)
    bubbles = np.zeros(n)
    for _ in range(34):                                       # each bubble is a short rising chirp
        t0 = 0.04 + rng.beta(1.2, 2.5) * 1.0
        f = np.exp(rng.uniform(np.log(380), np.log(2600)))
        m = n_(rng.uniform(0.02, 0.07))
        b = dsp.sine(dsp.sweep(f, f * rng.uniform(1.25, 1.7), m)) * dsp.decay(m, m / SR, 0.002)
        dsp.put(bubbles, b, t0, rng.uniform(0.3, 1.0) * (1.1 - t0))
    spray = spray * (0.65 + 0.35 * dsp.wander(n, rng, 14.0))               # the sheet of water breaks up
    return dsp.mix((slap, 0.8), (plunge, 0.7), (spray, 0.1), (bubbles, 0.15))


# ---- loops -----------------------------------------------------------------------------------
def _stereo(fn, rng: np.random.Generator) -> np.ndarray:
    """Two independent takes of the same texture, left and right."""
    return np.stack([fn(rng), fn(rng)], axis=1)


@sfx("fire_loop", "world", loop=4.0, level=-24.0, use="Burning rubble and vehicles (positional, mostly at night).")
def fire_loop(rng, v):
    n = n_(4.0)
    roar = dsp.circular(lambda z: dsp.lp(z, 420, 2), dsp.noise(n, rng, -6)) * (0.6 + 0.4 * dsp.wander(n, rng, 9.0))
    hiss = parts.periodic_shape(dsp.noise(n, rng, -2), lambda f, t: dsp.bump(f, 3200, 1.2)) * (0.6 + 0.4 * dsp.wander(n, rng, 3.0))
    rate = 22.0 * (1.0 + 0.9 * dsp.wander(n, rng, 1.5)) ** 2
    snaps = parts.debris_loop(n, rng, rate, [dsp.click(rng, 900, 5000, 0.005), dsp.click(rng, 1600, 9000, 0.0025),
                                             dsp.click(rng, 500, 2500, 0.009)]
                              + parts.modal_kernels(rng, 3, 500, 1800, 0.008, 0.02, damp=0.4), sigma=1.0)
    return parts.unit(roar) * 0.6 + parts.unit(hiss) * 0.3 + parts.norm(snaps) * 3.0


_VOWELS = [(730, 1090, 2440), (530, 1840, 2480), (660, 1720, 2410), (570, 840, 2410), (850, 1220, 2810)]


def _shout(rng: np.random.Generator) -> np.ndarray:
    """One far-off voice: a sawtooth through three vowel resonances, pitch arcing up and down."""
    dur = rng.uniform(0.35, 1.3)
    n = n_(dur)
    f0 = rng.choice([230.0, 290.0, 360.0, 430.0, 520.0]) * rng.uniform(0.9, 1.12)
    arc = dsp.env([(0, f0 * 0.82), (dur * rng.uniform(0.15, 0.4), f0 * rng.uniform(1.1, 1.5)), (dur, f0 * rng.uniform(0.7, 1.0))], n, "exp")
    arc = arc * (1 + 0.025 * np.sin(TAU * rng.uniform(5.0, 7.5) * dsp.secs(n)) + 0.02 * dsp.wander(n, rng, 12.0))
    src = dsp.saw(arc) + 0.25 * dsp.noise(n, rng, -3)
    f1, f2, f3 = _VOWELS[rng.integers(len(_VOWELS))]
    k = rng.uniform(1.0, 1.25)
    y = dsp.reson(src, f1 * k, 5.0) + 0.6 * dsp.reson(src, f2 * k, 8.0) + 0.3 * dsp.reson(src, f3 * k, 9.0)
    return parts.unit(y) * dsp.hump(n, dur * rng.uniform(0.1, 0.3), 1.0, 1.5)


@sfx("crowd_panic_loop", "world", loop=6.0, level=-25.0,
     use="Civilians fleeing: distant shouting and screaming, no words. Bed under stage 1 and 2 street scenes.")
def crowd_panic_loop(rng, v):
    n = n_(6.0)
    period = 6.0
    events_l, events_r = [], []
    for _ in range(54):
        s = _shout(rng)
        t0 = rng.uniform(0, period)
        pos = rng.uniform(-1, 1)
        g = rng.uniform(0.25, 1.0)
        a = (pos + 1) * np.pi / 4
        events_l.append((t0, s, g * np.cos(a)))
        events_r.append((t0, s, g * np.sin(a)))
    voices = np.stack([parts.fold_events(n, events_l), parts.fold_events(n, events_r)], axis=1)

    def babble(r):                                            # the mass of voices too far away to pick out
        x = dsp.noise(n, r, -3)
        y = parts.periodic_shape(x, lambda f, t: dsp.bump(f, 650, 0.7) + 0.6 * dsp.bump(f, 1500, 0.6) + 0.25 * dsp.bump(f, 2700, 0.4))
        return parts.unit(y) * (0.55 + 0.45 * dsp.wander(n, r, 5.0))

    bed = _stereo(babble, rng)
    y = parts.unit(voices) * 1.0 + bed * 0.5
    y = dsp.circular(lambda z: dsp.lp(dsp.hp(z, 220, 2), 3800, 2), y)             # distance
    ir = dsp.space_ir(rng, 0.9, pre=0.02, bright=3000, dark=900, stereo=True, low_cut=250.0)
    wet = np.stack([dsp.circular(lambda z, c=c: signal.fftconvolve(z, ir[:, c])[:len(z)], y[:, c]) for c in (0, 1)], axis=1)
    return y + 0.35 * wet


@sfx("siren_loop", "world", loop=3.0, level=-22.0, use="Emergency vehicles and the city alarm: one wail per pass (positional).")
def siren_loop(rng, v):
    n = n_(3.0)
    u = 0.5 - 0.5 * np.cos(TAU * np.arange(n) / n)            # 0 -> 1 -> 0 over the loop
    f = 640.0 * (1260.0 / 640.0) ** u
    cycles = np.sum(f) / SR
    f = f * (np.round(cycles) / cycles)                       # whole number of cycles: the phase closes
    x = dsp.square(f, duty=0.32) + 0.4 * dsp.saw(f)

    def horn(z):                                              # the loudspeaker horn: mid-heavy, nasal
        return dsp.reson(z, 1500, 1.4) + 0.5 * dsp.reson(z, 2700, 2.5) + 0.15 * dsp.lp(z, 900, 1)

    return dsp.circular(horn, x)


def _air(n: int, rng: np.random.Generator, f_lo: float, f_hi: float, speed: float, width: float = 0.8) -> np.ndarray:
    """Moving-air texture: noise through a band that drifts between f_lo and f_hi, periodic."""
    path = np.exp(np.log(f_lo) + (np.log(f_hi) - np.log(f_lo)) * (0.5 + 0.5 * dsp.wander(n, rng, speed)))
    tt = dsp.secs(n)
    y = parts.periodic_shape(dsp.noise(n, rng, -3), lambda f, t: dsp.bump(f, np.interp(t, tt, path), width), 2048)
    return parts.unit(y) * (0.6 + 0.4 * dsp.wander(n, rng, speed * 1.7))


def _city_bed(n: int, rng: np.random.Generator, traffic: float) -> np.ndarray:
    """Far city: low rumble and a wash of distant traffic. One channel."""
    rumble = parts.unit(dsp.circular(lambda z: dsp.lp(z, 170, 2), dsp.noise(n, rng, -6))) * (0.75 + 0.25 * dsp.wander(n, rng, 0.4))
    wash = parts.periodic_shape(dsp.noise(n, rng, -3), lambda f, t: dsp.bump(f, 520, 1.0), 2048)
    wash = parts.unit(wash) * (0.6 + 0.4 * dsp.wander(n, rng, 0.25))
    return rumble * 0.8 + wash * 0.45 * traffic


def _passes(n: int, rng: np.random.Generator, count: int) -> np.ndarray:
    """Cars going by somewhere else: slow swells of mid noise that slide across the stereo field."""
    period = n / SR
    out = np.zeros((n, 2))
    for _ in range(count):
        dur = rng.uniform(2.5, 4.5)
        m = n_(dur)
        fc = rng.uniform(380, 800)
        car = parts.whoosh(m, rng, [(0, fc * 1.12), (dur * 0.5, fc), (dur, fc * 0.85)], 0.8) * dsp.hump(m, dur * 0.5, 2.5, 2.5)
        a0, a1 = rng.permutation([0.15, 0.85]) * np.pi / 2
        ang = np.linspace(a0, a1, m)
        st = np.stack([car * np.cos(ang), car * np.sin(ang)], axis=1) * rng.uniform(0.5, 1.0)
        t0 = rng.uniform(0, period)
        buf = np.zeros((n_(t0) + m, 2))
        buf[n_(t0):] = st
        out += dsp.fold(buf, n)
    return out


def _birds(n: int, rng: np.random.Generator, phrases: int, f_lo: float, f_hi: float, notes=(3, 8)) -> np.ndarray:
    """Small birds: phrases of quick chirps (each a short falling or rising sine glide)."""
    period = n / SR
    out = np.zeros((n, 2))
    for _ in range(phrases):
        t0 = rng.uniform(0, period)
        pos = rng.uniform(-0.9, 0.9)
        f = np.exp(rng.uniform(np.log(f_lo), np.log(f_hi)))
        gap = rng.uniform(0.07, 0.16)
        g = rng.uniform(0.3, 1.0)
        buf = np.zeros(n_(t0 + 3.0))
        for i in range(rng.integers(notes[0], notes[1] + 1)):
            m = n_(rng.uniform(0.03, 0.08))
            bend = rng.choice([0.75, 0.85, 1.2, 1.35])
            chirp = dsp.sine(dsp.sweep(f * rng.uniform(0.9, 1.1), f * bend, m)) * dsp.hump(m, 0.3 * m / SR, 1.0, 1.5)
            dsp.put(buf, chirp, t0 + i * gap * rng.uniform(0.85, 1.15), g)
        out += dsp.fold(dsp.pan(buf, pos), n)
    return out


def _crickets(n: int, rng: np.random.Generator, voices: int) -> np.ndarray:
    """Crickets: each one repeats a burst of three or four fast pulses of a pure high tone."""
    period = n / SR
    out = np.zeros((n, 2))
    for _ in range(voices):
        f = rng.uniform(4000, 5300)
        every = period / rng.integers(int(period / 0.75), int(period / 0.42) + 1)        # whole number of chirps per loop
        pulses = rng.integers(3, 5)
        m = n_(0.016)
        one = dsp.sine(f, m) * np.sin(np.pi * np.arange(m) / m) ** 2
        chirp = np.zeros(n_(0.022 * pulses) + m)
        for i in range(pulses):
            dsp.put(chirp, one, 0.022 * i, 0.6 + 0.4 * i / pulses)
        buf = np.zeros(n + len(chirp))
        phase0 = rng.uniform(0, every)
        k = 0
        while phase0 + k * every < period - 1e-9:
            dsp.put(buf, chirp, phase0 + k * every, 1.0)
            k += 1
        out += dsp.fold(dsp.pan(buf, rng.uniform(-1, 1)), n) * rng.uniform(0.25, 1.0)
    return out


@sfx("amb_day_loop", "world", loop=16.0, level=-29.0, use="Stage 1 ambience (afternoon): city hum, passing traffic, birds.")
def amb_day_loop(rng, v):
    n = n_(16.0)
    bed = _stereo(lambda r: _city_bed(n, r, 1.0), rng)
    air = _stereo(lambda r: _air(n, r, 1200, 3200, 0.3, 1.0), rng)
    return bed * 1.0 + air * 0.1 + parts.unit(_passes(n, rng, 5)) * 0.5 + parts.norm(_birds(n, rng, 9, 2800, 5600)) * 0.55


@sfx("amb_sunset_loop", "world", loop=16.0, level=-29.0,
     use="Stage 2 ambience (sunset): thinner traffic, evening wind off the bay, a far foghorn, the first crickets.")
def amb_sunset_loop(rng, v):
    n = n_(16.0)
    bed = _stereo(lambda r: _city_bed(n, r, 0.55), rng)
    wind = _stereo(lambda r: _air(n, r, 350, 1100, 0.22, 0.9), rng)
    m = n_(2.4)                                               # the foghorn: low, far away, once per pass
    horn = (dsp.saw(146.83, m) + 0.6 * dsp.saw(147.5, m)) * dsp.env([(0, 0), (0.25, 1), (1.8, 0.9), (2.4, 0)], m)
    horn = dsp.lp(horn, 420, 2)
    horn_st = dsp.fold(dsp.reverb(np.concatenate([np.zeros(n_(5.0)), horn]),
                                  dsp.space_ir(rng, 2.5, pre=0.05, bright=1500, dark=400, stereo=True, low_cut=80.0), 0.8, 0.5), n)
    return (bed * 1.0 + wind * 0.5 + parts.unit(_passes(n, rng, 2)) * 0.3 + parts.norm(_birds(n, rng, 3, 2000, 3400, (2, 4))) * 0.3
            + parts.norm(_crickets(n, rng, 4)) * 0.12 + parts.norm(horn_st) * 0.38)


@sfx("amb_night_loop", "world", loop=16.0, level=-29.0, use="Stage 3 ambience (night): crickets, a low electric city hum, far wind.")
def amb_night_loop(rng, v):
    n = n_(16.0)
    bed = _stereo(lambda r: _city_bed(n, r, 0.25), rng)
    wind = _stereo(lambda r: _air(n, r, 250, 700, 0.18, 0.9), rng)
    t = np.arange(n) / n
    hum = (np.sin(TAU * 1600 * t) + 0.5 * np.sin(TAU * 3200 * t + 0.4) + 0.25 * np.sin(TAU * 4800 * t + 1.1))    # 100, 200, 300 Hz
    hum = np.stack([hum * (0.7 + 0.3 * dsp.lfo(n, 3)), hum * (0.7 + 0.3 * dsp.lfo(n, 3, 0.25))], axis=1)
    return (bed * 0.9 + wind * 0.4 + parts.unit(hum) * 0.14 + parts.norm(_crickets(n, rng, 11)) * 0.42)


@sfx("wind_high_loop", "world", loop=10.0, level=-26.0,
     use="High-altitude wind for the stage 3 kaiju's head height and the pulled-back camera.")
def wind_high_loop(rng, v):
    n = n_(10.0)
    gust = 0.7 + 0.3 * dsp.wander(n, rng, 0.35)               # shared by both ears: one wind

    def side(r):
        body = _air(n, r, 260, 900, 0.3, 0.9)
        tt = dsp.secs(n)
        path = 900.0 * 2.0 ** (0.7 * dsp.wander(n, r, 0.4))
        whistle = parts.periodic_shape(dsp.noise(n, r, -3), lambda f, t: dsp.bump(f, np.interp(t, tt, path), 0.07), 4096)
        low = parts.unit(dsp.circular(lambda z: dsp.lp(z, 110, 2), dsp.noise(n, r, -6))) * (0.5 + 0.5 * dsp.wander(n, r, 2.5))
        return body * 1.0 + parts.unit(whistle) * 0.3 * (0.4 + 0.6 * dsp.wander(n, r, 0.5)) ** 2 + low * 0.5

    return _stereo(side, rng) * gust[:, None]
