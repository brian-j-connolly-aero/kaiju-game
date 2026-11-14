"""The city's sounds of phases 2 and 3 (docs/ROADMAP.md): the special buildings (the substation's
hum, the power surge and the crackle it leaves on the monster, the gas station's fireball), a
tall building groaning as it falls over, a firehouse's bell, the city weapons (a propane tank going
off, shots clanging off a garage door, the fast-food sign swung and striking), civilians squashed
with a soft comic pop, and air rushing past at speed."""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import TAU, n_
from .registry import sfx
from .world import _air, _stereo

# D minor pitches (Hz): the key of the music, so that tones never clash with the score
A4, D5, F5, A5, D6 = 440.0, 587.33, 698.46, 880.0, 1174.66
MAINS = 110.0                     # the city's hum sits on A, the fifth of D


def _arcs(n: int, rng: np.random.Generator, count: int, at, lo: float = 1500.0, hi: float = 9000.0) -> np.ndarray:
    """Electric arcs: buzzing bursts of noise, gated by the mains hum. `at(rng)` picks a start."""
    out = np.zeros(n)
    for _ in range(count):
        t0 = at(rng)
        m = n_(rng.uniform(0.02, 0.09))
        zzt = dsp.bp(rng.standard_normal(m + 64), lo, hi)[64:] * (dsp.square(MAINS, m, duty=0.5, start=rng.random()) > 0)
        dsp.put(out, dsp.fade(zzt, 0.001, 0.004), t0, rng.uniform(0.5, 1.0))
    return out


# ---- the gas station -----------------------------------------------------------------------------
@sfx("fireball", "world", level=-12.5, clip=True,
     use="A gas station goes up: a deep rolling whoomp, a roar of flame swelling and dying into crackle (about "
         "3 s). fire_loop carries the fire on after it.")
def fireball(rng, v):
    dur = 3.4
    n = n_(dur)
    # the whoomp: all the fuel lights at once, so the pressure comes on over a few hundredths, not in a crack
    whoomp = parts.thump(n, 62, 24, 0.12, 1.1, attack=0.025, harm=0.5, sat=2.6)
    body = parts.burst(n, rng, 3800, 140, 0.09, 1.0, slope=-4.0, attack=0.012)
    roar = parts.whoosh(n, rng, dsp.env([(0, 900), (0.3, 1400), (1.2, 700), (dur, 350)], n, "exp"), 1.2, slope=-4.0)
    roar = roar * (0.55 + 0.45 * dsp.wander(n, rng, 11.0)) * dsp.env([(0, 0), (0.05, 0.6), (0.35, 1.0), (1.4, 0.55),
                                                                      (2.6, 0.15), (dur, 0)], n)
    rate = dsp.env([(0, 0), (0.4, 60), (1.4, 140), (2.6, 120), (dur, 30)], n)
    crackle = parts.debris(n, rng, rate, [dsp.click(rng, 900, 5000, 0.005), dsp.click(rng, 1600, 9000, 0.0025),
                                          dsp.click(rng, 500, 2500, 0.009)]
                           + parts.modal_kernels(rng, 3, 500, 1800, 0.008, 0.02, damp=0.4), sigma=1.0)
    clatter = np.zeros(n)                                     # the canopy and the pumps coming down
    for _ in range(6):
        k = parts.modal_kernels(rng, 1, 300, 1100, 0.06, 0.18, ratios=(1.0, 1.52, 2.26, 3.03), damp=0.7, tick=0.5)[0]
        dsp.put(clatter, k, 0.25 + rng.beta(1.3, 2.0) * 1.2, rng.uniform(0.4, 1.0))
    dry = dsp.mix((whoomp, 1.0), (body, 0.7), (roar, 0.22), (parts.norm(crackle), 0.09), (parts.norm(clatter), 0.06))
    ir = dsp.space_ir(rng, 1.8, pre=0.02, bright=3500, dark=450, echoes=((0.22, 0.3, 1500.0), (0.4, 0.22, 900.0)), low_cut=45.0)
    return dsp.reverb(dry, ir, 0.26)


@sfx("propane_blast", "world", level=-14.0, clip=True,
     use="A propane tank goes off: the bang of the tank bursting and a short roar of burning gas. Crushed underfoot "
         "it is the small bang: play it faster and quieter.")
def propane_blast(rng, v):
    dur = 1.9
    n = n_(dur)
    bang = parts.thump(n, 120, 42, 0.04, 0.45, harm=0.4, sat=2.4)
    crack = dsp.fit(dsp.click(rng, 1500, 12000, 0.004), n) + parts.burst(n, rng, 12000, 900, 0.02, 0.12, slope=0.0)
    fwoosh = parts.whoosh(n, rng, dsp.env([(0, 600), (0.08, 1800), (0.5, 900), (dur, 380)], n, "exp"), 1.1, slope=-3.0)
    fwoosh = fwoosh * dsp.env([(0, 0), (0.025, 1.0), (0.45, 0.45), (1.6, 0.05), (dur, 0)], n) * (0.6 + 0.4 * dsp.wander(n, rng, 13.0))
    shell = dsp.modal(n, [640.0, 1010.0, 1580.0, 2290.0], [0.4, 0.3, 0.2, 0.12], [1.0, 0.7, 0.5, 0.3], rng)     # the tank's steel
    dry = dsp.mix((bang, 1.0), (crack, 0.5), (fwoosh, 0.3), (shell, 0.03, 0.005))
    ir = dsp.space_ir(rng, 1.1, pre=0.015, bright=4000, dark=500, echoes=((0.17, 0.25, 1600.0),), low_cut=60.0)
    return dsp.reverb(dry, ir, 0.2)


# ---- buildings -----------------------------------------------------------------------------------
@sfx("building_groan", "world", level=-17.0,
     use="A tall building tips over (the 2 s of its fall): steel groaning as it bends, concrete cracking, a rumble "
         "building. The crash as it lands is crumble_l.")
def building_groan(rng, v):
    dur = 2.5
    n = n_(dur)
    f = dsp.env([(0, 96), (0.8, 82), (2.0, 56), (dur, 48)], n, "exp") * (1 + 0.03 * dsp.wander(n, rng, 3.0))
    steel = np.zeros(n)
    for r, w in ((1.0, 1.0), (1.47, 0.7), (2.09, 0.55), (2.56, 0.4), (3.39, 0.3), (4.08, 0.2)):   # a bowed-metal spectrum
        steel += w * dsp.sine(f * r * (1 + 0.004 * dsp.wander(n, rng, 6.0)), start=rng.random())
    stick = (0.5 + 0.5 * dsp.saw(dsp.env([(0, 9), (1.0, 15), (2.2, 22)], n) * (1 + 0.25 * dsp.wander(n, rng, 5.0)))) ** 3
    steel = parts.unit(steel) * (0.35 + 0.65 * dsp.lp(stick, 60, 1))
    steel = parts.unit(dsp.spectral_shape(steel, lambda fr, tm: dsp.bump(fr, 260, 0.8) + 0.8 * dsp.bump(fr, 700, 0.6)
                                          + 0.4 * dsp.bump(fr, 1500, 0.5), 2048))
    rub = parts.unit(dsp.bp(dsp.noise(n, rng, -2.0), 250, 2200)) * dsp.lp(stick, 120, 1)      # the friction itself
    steel = steel + 0.45 * rub
    pops = np.zeros(n)                                        # concrete cracking, faster as it goes
    for _ in range(26):
        t0 = dur * rng.beta(2.2, 1.4)
        k = dsp.click(rng, 700, 6000, rng.uniform(0.006, 0.02))
        dsp.put(pops, k, t0, rng.uniform(0.4, 1.0))
    grind = parts.rubble(n, rng, dsp.env([(0, 0), (0.6, 300), (1.8, 1800), (dur, 900)], n), 1.5)
    rumble = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 150, 2)) * (1 + 0.4 * dsp.wander(n, rng, 8.0))
    swell = dsp.env([(0, 0.0), (0.15, 0.35), (1.0, 0.7), (1.95, 1.0), (dur, 0.0)], n)
    dry = dsp.mix((steel * swell, 0.5), (pops, 0.25), (grind * swell, 0.03), (rumble * swell ** 1.5, 0.35))
    ir = dsp.space_ir(rng, 1.2, pre=0.02, bright=3000, dark=500, echoes=((0.2, 0.22, 1200.0),), low_cut=50.0)
    return dsp.reverb(dry, ir, 0.18)


@sfx("fire_bell", "world", level=-21.0,
     use="A firehouse comes down: its alarm bell clangs, then is cut short as the building falls on it.")
def fire_bell(rng, v):
    dur = 1.7
    n = n_(dur)
    m = n_(1.2)
    ratios, t60s, amps = (1.0, 2.0, 2.76, 4.07, 5.4), (0.9, 0.6, 0.45, 0.3, 0.2), (1.0, 0.5, 0.6, 0.3, 0.2)
    strike = dsp.modal(m, [D6 * r for r in ratios], t60s, amps, rng)
    strike[:n_(0.003)] += 0.4 * dsp.fit(dsp.click(rng, 2000, 9000, 0.002), n_(0.003))
    bell = np.zeros(n)
    k = 0
    while k / 17.0 < 0.95:                                    # the clapper, 17 strikes a second
        dsp.put(bell, strike, k / 17.0 + rng.uniform(0.0, 0.003), (1.0, 0.85)[k % 2] * rng.uniform(0.9, 1.0))
        k += 1
    cut = 0.98
    bell = bell * dsp.env([(0, 1.0), (cut, 1.0), (cut + 0.06, 0.04), (dur, 0.0)], n)
    thud = parts.thump(n_(0.6), 120, 55, 0.04, 0.35)          # the wall that silences it
    bits = parts.rubble(n_(0.7), rng, dsp.env([(0, 1500), (0.3, 300), (0.7, 0)], n_(0.7)), 1.2)
    out = dsp.mix((bell, 0.5), (thud, 0.45, cut), (bits, 0.02, cut))
    return dsp.reverb(dsp.fit(out, n), dsp.space_ir(rng, 0.8, pre=0.01, bright=5000, dark=900, echoes=((0.14, 0.2, 2000.0),)), 0.14)


# ---- the power substation ------------------------------------------------------------------------
@sfx("substation_hum_loop", "world", loop=4.0, level=-26.0,
     use="A power substation still standing (positional): the transformers' deep hum, the buzz of the lines and, "
         "now and then, the crackle of a spark jumping.")
def substation_hum_loop(rng, v):
    n = n_(4.0)
    t = np.arange(n) / n
    c = MAINS * 4.0                                           # cycles of the hum in one pass: every part closes its phase
    hum = (np.sin(TAU * c * t) + 0.7 * np.sin(TAU * 2 * c * t + 0.3) + 0.35 * np.sin(TAU * 3 * c * t + 1.0)
           + 0.25 * np.sin(TAU * 4 * c * t + 0.5) + 0.12 * np.sin(TAU * 6 * c * t + 0.2))
    hum = hum * (0.88 + 0.12 * dsp.lfo(n, 3))
    buzz = parts.periodic_shape(dsp.noise(n, rng), lambda f, tm: dsp.bump(f, 5000, 0.6)) * (0.5 + 0.5 * np.sin(TAU * 2 * c * t)) ** 4
    sparks = parts.fold_events(n, [(rng.uniform(0, 4.0), dsp.fade(dsp.bp(rng.standard_normal(n_(0.06) + 64), 1500, 8000)[64:]
                                                                   * (dsp.square(MAINS, n_(0.06), duty=0.5) > 0), 0.001, 0.004),
                                    rng.uniform(0.5, 1.0)) for _ in range(3)])
    return parts.unit(hum) + 0.25 * parts.unit(buzz) + 0.6 * parts.norm(sparks)


@sfx("power_surge", "world", level=-14.0, clip=True,
     use="The monster wrecks a power substation and takes its power: the transformer blows with a crack, arcs "
         "leap to the monster for a second and a half, then the district's power whines down.")
def power_surge(rng, v):
    dur = 3.1
    n = n_(dur)
    t = dsp.secs(n)
    m = n_(0.5)
    bang = (parts.burst(m, rng, 13000, 900, 0.015, 0.14, slope=0.0) + dsp.fit(dsp.click(rng, 1500, 12000, 0.004), m)
            + 0.9 * parts.thump(m, 150, 50, 0.03, 0.3, harm=0.4, sat=2.4))
    zzt = dsp.bp(dsp.noise(n_(0.3), rng), 1200, 8000) * (dsp.square(MAINS, n_(0.3), duty=0.5) > 0) * dsp.decay(n_(0.3), 0.3)
    arcs = _arcs(n, rng, 22, lambda r: 0.05 + 1.5 * r.beta(1.6, 1.8))
    rise = dsp.env([(0, 220), (1.4, 880), (dur, 880)], n, "exp")
    pull = (dsp.fm(rise, 2.0, 1.5, n) + 0.5 * dsp.saw(rise * 0.5)) * dsp.env([(0, 0), (0.2, 0.3), (1.35, 1.0), (1.5, 0.0), (dur, 0)], n)
    k = n - n_(1.5)                                           # the power runs down
    down = dsp.env([(0, 880), (1.5, 55)], k, "exp")
    whine = dsp.lp(dsp.saw(down) + 0.6 * dsp.sine(down * 2), 3000, 2) * dsp.env([(0, 0), (0.03, 1), (1.0, 0.3), (k / dsp.SR, 0)], k)
    hum = dsp.lp(dsp.square(dsp.env([(0, MAINS), (1.5, MAINS * 0.6)], k, "exp"), duty=0.5), 900, 2) * dsp.decay(k, 1.2, 0.03)
    sparks = parts.norm(parts.sparkle(n, rng, dsp.env([(0, 2500), (0.4, 600), (1.5, 200), (1.7, 0)], n)))
    dry = dsp.mix((bang, 1.0), (zzt, 0.25), (parts.norm(arcs), 0.3), (parts.unit(pull), 0.12), (whine, 0.18, 1.5), (hum, 0.1, 1.5),
                  (sparks, 0.08))
    return dsp.reverb(dry, dsp.space_ir(rng, 0.9, pre=0.012, bright=5000, dark=700, echoes=((0.15, 0.2, 1800.0),), low_cut=80.0), 0.14)


@sfx("surge_crackle_loop", "world", loop=2.0, level=-22.0,
     use="The monster in a power surge (positional, while it lasts): electricity crackling over its hide and stripes.")
def surge_crackle_loop(rng, v):
    n = n_(2.0)
    t = np.arange(n) / n
    c = MAINS * 2.0
    buzz = parts.periodic_shape(dsp.noise(n, rng), lambda f, tm: dsp.bump(f, 3200, 0.9)) * (0.5 + 0.5 * np.sin(TAU * 2 * c * t)) ** 4
    buzz = buzz * (0.45 + 0.55 * np.clip(dsp.wander(n, rng, 5.0), 0.0, 1.0))
    zaps = parts.fold_events(n, [(rng.uniform(0, 2.0), dsp.fade(dsp.bp(rng.standard_normal(n_(0.05) + 64), 1500, 9000)[64:]
                                                                 * (dsp.square(MAINS, n_(0.05), duty=0.5, start=rng.random()) > 0), 0.001, 0.004),
                                  rng.uniform(0.4, 1.0)) for _ in range(16)])
    sizzle = parts.periodic_shape(dsp.noise(n, rng), lambda f, tm: dsp.bump(f, 7500, 0.5))
    hum = np.sin(TAU * 2 * c * t)
    return parts.unit(buzz) + 0.9 * parts.norm(zaps) + 0.15 * parts.unit(sizzle) + 0.2 * hum


# ---- the city weapons ----------------------------------------------------------------------------
@sfx("shield_clang", "world", variants=3, level=-20.0, clip=True,
     use="A shot glances off the garage door the monster holds as a shield: a clang and the slats rattling. The "
         "same door thrown and landing, or the radio mast's top coming down: play it lower.")
def shield_clang(rng, v):
    tune = (1.0, 0.86, 1.15)[v - 1]
    n = n_(0.75)
    base = 340.0 * tune * rng.uniform(0.98, 1.02)
    ratios = np.array([1.0, 1.37, 1.93, 2.41, 2.98, 3.62, 4.4, 5.3, 6.6])
    ring = dsp.modal(n, base * ratios, np.linspace(0.38, 0.1, len(ratios)), np.linspace(1.0, 0.35, len(ratios)), rng)
    hit = dsp.fit(dsp.click(rng, 1500, 11000, 0.003), n) + parts.burst(n, rng, 11000, 1800, 0.008, 0.05, slope=0.0)
    rattle = parts.debris(n, rng, dsp.env([(0, 0), (0.02, 0), (0.05, 90), (0.35, 20), (0.5, 0)], n),
                          parts.modal_kernels(rng, 5, 900 * tune, 2400 * tune, 0.01, 0.03, ratios=(1.0, 2.31, 3.9), damp=0.5), sigma=0.5)
    thud = parts.thump(n, 140 * tune, 80 * tune, 0.02, 0.1)
    return dsp.mix((parts.norm(ring), 0.55), (hit, 0.45), (rattle, 0.08), (thud, 0.5))


CLUB_PEAK = 0.24


@sfx("club_swing", "world", level=-19.0,
     use=f"The hatchling swings the fast-food sign: a big flat board pushing through the air, flapping as it goes. "
         f"Start it about {CLUB_PEAK:.2f} s before the strike.")
def club_swing(rng, v):
    dur = 0.78
    n = n_(dur)
    path = dsp.env([(0, 180), (CLUB_PEAK, 720), (dur, 150)], n, "exp")
    push = parts.whoosh(n, rng, path, 0.8, slope=-4.0) * dsp.hump(n, CLUB_PEAK, 2.0, 1.6)
    flap = 0.55 + 0.45 * dsp.sine(dsp.env([(0, 18), (CLUB_PEAK, 34), (dur, 14)], n, "exp"))
    edge = parts.whoosh(n, rng, path * 4.0, 0.35, slope=0.0) * dsp.hump(n, CLUB_PEAK, 4.0, 3.5)
    m = n_(0.2)
    creak = dsp.fm(dsp.env([(0, 420), (0.2, 380)], m, "exp"), 2.76, 1.6, m) * dsp.hump(m, 0.08, 1.5, 1.5)
    creak = creak * (0.5 + 0.5 * dsp.saw(80.0 * (1 + 0.2 * dsp.wander(m, rng, 8.0)))) ** 2
    return dsp.mix((push * flap, 1.0), (edge, 0.3), (creak, 0.05, 0.03))


@sfx("club_hit", "world", level=-17.0, clip=True,
     use="The fast-food sign strikes soldiers: a hollow, wobbling bong of sheet metal and the crack of its plastic face.")
def club_hit(rng, v):
    n = n_(1.1)
    t = dsp.secs(n)
    base = 150.0
    panel = dsp.modal(n, [base, base * 1.52, base * 2.3, base * 3.1, base * 4.4], [0.8, 0.6, 0.45, 0.3, 0.2],
                      [1.0, 0.7, 0.55, 0.35, 0.25], rng)
    bend = 1.0 + 0.06 * np.sin(TAU * 7.0 * t) * dsp.decay(n, 0.9)                       # the sheet wobbles as it rings
    panel = dsp.fit(dsp.warp(panel, bend), n)
    crack = parts.burst(n, rng, 10000, 1800, 0.01, 0.06, slope=0.0)
    thud = parts.thump(n, 130, 65, 0.02, 0.15)
    bits = parts.shards(n, rng, 18, 1800, 6000, 0.05, 0.01, 0.05)                        # plastic, not glass: lower and duller
    return dsp.mix((parts.norm(panel), 0.6), (crack, 0.5), (thud, 0.8), (parts.norm(bits), 0.06, 0.01))


# ---- civilians -----------------------------------------------------------------------------------
POP_NOTES = (D5, F5, A5, A4)


@sfx("civ_pop", "world", variants=4, level=-26.0,
     use="Civilians squashed under the monster (a cartoon puff): a soft comic pop, a bubble bursting with a breath of "
         "air, never a cry. Four pitches, all in the music's key.")
def civ_pop(rng, v):
    f = POP_NOTES[v - 1] * rng.uniform(0.99, 1.01)
    n = n_(0.15)
    t = dsp.secs(n)
    pitch = f * (1.0 + 0.55 * (1.0 - np.exp(-t / 0.01)))     # a bubble: the pitch jumps up as it bursts
    ring = dsp.sine(pitch) * dsp.decay(n, 0.07, 0.001)
    snap = dsp.fit(dsp.click(rng, f * 1.5, min(f * 12.0, 14000.0), 0.0015), n)
    puff = parts.unit(dsp.lp(dsp.noise(n, rng, -3), 1800, 2)) * dsp.env([(0, 0), (0.003, 1), (0.06, 0)], n)
    return dsp.mix((ring, 1.0), (snap, 0.25), (puff, 0.12))


# ---- speed ---------------------------------------------------------------------------------------
@sfx("speed_wind_loop", "world", loop=4.0, level=-25.0,
     use="Air rushing past at speed: the player's own tank or soldier near its top speed, the monster in its "
         "charge. Not positional: raise it with the speed.")
def speed_wind_loop(rng, v):
    n = n_(4.0)

    def side(r: np.random.Generator) -> np.ndarray:
        rush = _air(n, r, 700, 2600, 0.9, 1.1)
        buffet = parts.unit(dsp.circular(lambda z: dsp.lp(z, 140, 2), dsp.noise(n, r, -6))) * (0.5 + 0.5 * dsp.wander(n, r, 6.0)) ** 2
        tt = dsp.secs(n)
        path = 1400.0 * 2.0 ** (0.5 * dsp.wander(n, r, 0.6))
        whistle = parts.periodic_shape(dsp.noise(n, r, -3), lambda f, t: dsp.bump(f, np.interp(t, tt, path), 0.08), 4096)
        return rush + 0.7 * buffet + 0.12 * parts.unit(whistle)

    return _stereo(side, rng)
