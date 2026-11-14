"""The army's sounds of phases 1 and 2 (docs/ROADMAP.md): the pick-up weapons (the machine gun and
its rounds landing, the big cannon), the tank's tracks, the supply plane, crates landing and
being opened, the artillery marker's smoke flare, and the ringing ears of a squad stunned by the
monster's roar."""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import TAU, n_
from .registry import sfx


# ---- the machine gun ---------------------------------------------------------------------------
def _report(rng: np.random.Generator, tune: float) -> np.ndarray:
    """One round: the muzzle crack, the punch of the charge, the bolt slamming home."""
    n = n_(0.18)
    crack = dsp.fit(dsp.click(rng, 1200, 11000, 0.003), n) + parts.burst(n, rng, 13000, 1500 * tune, 0.006, 0.04, slope=0.0)
    punch = parts.thump(n, 175 * tune, 78 * tune, 0.012, 0.075, harm=0.3, sat=2.0)
    bolt = parts.modal_kernels(rng, 1, 1300 * tune, 2200 * tune, 0.015, 0.03, ratios=(1.0, 2.31, 3.9), damp=0.5, tick=0.5)[0]
    return dsp.mix((crack, 0.75), (punch, 0.9), (dsp.fit(bolt, n), 0.14, 0.022))


@sfx("mg_burst", "humans", variants=3, level=-19.0, clip=True,
     use="The machine gun pick-up fires: a short burst of three or four rounds and the brass tinkling down. "
         "One per trigger pull; a held trigger makes a long rattle of them.")
def mg_burst(rng, v):
    rounds = (3, 4, 3)[v - 1]
    every = (0.072, 0.064, 0.082)[v - 1]
    base = (1.0, 0.95, 1.06)[v - 1]
    n = n_(every * rounds + 0.5)
    out = np.zeros(n)
    for i in range(rounds):
        t0 = i * every + (rng.uniform(-0.004, 0.004) if i else 0.0)
        dsp.put(out, _report(rng, base * rng.uniform(0.96, 1.04)), t0, 1.0 if i == 0 else rng.uniform(0.8, 0.95))
    brass = parts.debris(n, rng, dsp.env([(0, 0), (0.06, 45), (every * rounds + 0.05, 45), (every * rounds + 0.3, 0)], n),
                         parts.modal_kernels(rng, 4, 2800, 6500, 0.02, 0.06, ratios=(1.0, 2.76, 5.4), damp=0.6, tick=0.2), sigma=0.4)
    dry = dsp.mix((out, 1.0), (brass, 0.03))
    ir = dsp.space_ir(rng, 0.7, pre=0.01, bright=4000, dark=600, echoes=((0.13, 0.25, 1800.0), (0.24, 0.15, 1200.0)), low_cut=80.0)
    return dsp.reverb(dry, ir, 0.16)


@sfx("bullet_hit", "humans", variants=3, level=-25.0, clip=True,
     use="A machine-gun round lands: a chip off concrete, a ricochet whining away, or a dull smack into hide or "
         "earth. Picked at random.")
def bullet_hit(rng, v):
    n = n_(0.36)
    crack = parts.burst(n, rng, 12000, 2600, 0.004, 0.03, slope=0.0)
    dust = parts.unit(dsp.hp(dsp.noise(n, rng), 3500, 2)) * dsp.env([(0, 0), (0.01, 1), (0.3, 0)], n) ** 2
    if v == 1:                                                # a chip of concrete and a spray of grit
        grit = parts.debris(n, rng, dsp.env([(0, 4000), (0.05, 900), (0.25, 0)], n), parts.noise_kernels(rng, 4, 2000, 9000, 0.001, 0.004))
        chip = parts.modal_kernels(rng, 1, 900, 1600, 0.02, 0.04, ratios=(1.0, 2.7, 5.1), damp=0.4, tick=0.6)[0]
        return dsp.mix((crack, 0.8), (grit, 0.04), (dsp.fit(chip, n), 0.4), (dust, 0.03))
    if v == 2:                                                # a ricochet: the round whines away, falling
        m = n_(0.3)
        f = dsp.env([(0, 2900), (0.3, 1500)], m, "exp") * (1 + 0.02 * np.sin(TAU * 31 * dsp.secs(m)))
        whine = dsp.sine(f) * dsp.env([(0, 0), (0.008, 1), (0.12, 0.45), (0.3, 0)], m)
        air = parts.unit(dsp.spectral_shape(dsp.noise(m, rng), lambda fr, tm: dsp.bump(fr, 2200, 0.25), 512))
        air = air * dsp.env([(0, 0), (0.01, 1), (0.3, 0)], m)
        return dsp.mix((crack, 0.7), (whine, 0.22, 0.006), (air, 0.05, 0.006), (dust, 0.02))
    thud = parts.thump(n, 190, 95, 0.01, 0.06)                # a dull smack and a puff of dust
    return dsp.mix((crack, 0.4), (thud, 1.0), (dust, 0.05))


@sfx("cannon_fire", "humans", variants=2, level=-14.5, clip=True,
     use="The big cannon pick-up fires: a deeper boom than the tank gun, a long ring of the barrel and the "
         "report rolling round the streets.")
def cannon_fire(rng, v):
    tune = (1.0, 0.92)[v - 1]
    n = n_(2.3)
    crack = dsp.fit(dsp.click(rng, 600, 8000, 0.008), n) + parts.burst(n, rng, 12000, 700, 0.02, 0.15, slope=0.0)
    boom = parts.thump(n, 82 * tune, 26 * tune, 0.07, 0.95, attack=0.003, harm=0.45, sat=2.6)
    body = parts.burst(n, rng, 4200, 170 * tune, 0.07, 0.8)
    base = 260 * tune
    ring = dsp.modal(n, [base, base * 1.61, base * 2.37, base * 3.2], [0.75, 0.5, 0.35, 0.25], [1.0, 0.6, 0.45, 0.3], rng)
    ring = ring * dsp.decay(n, 0.9, 0.004)
    dry = dsp.mix((crack, 0.6), (boom, 0.9), (body, 1.0), (ring, 0.05, 0.015))
    ir = dsp.space_ir(rng, 1.6, pre=0.02, bright=3500, dark=500, echoes=((0.25, 0.35, 1400.0), (0.45, 0.25, 900.0), (0.7, 0.15, 600.0)),
                      low_cut=50.0)
    return dsp.reverb(dry, ir, 0.24)


# ---- the tank's tracks -------------------------------------------------------------------------
@sfx("tank_tracks_loop", "humans", loop=2.0, level=-24.0,
     use="A tank's tracks on the move (positional, under tank_engine_loop): links clanking over the sprockets, "
         "the road wheels rumbling, a squeal now and then. Silent at a standstill: raise level and rate with speed "
         "(rate about 0.6 slow to 1.3 at full speed).")
def tank_tracks_loop(rng, v):
    n = n_(2.0)
    t = np.arange(n) / n
    links = parts.modal_kernels(rng, 6, 700, 2100, 0.02, 0.05, ratios=(1.0, 2.31, 3.9, 5.2), damp=0.5, tick=0.5)
    events = []
    for i in range(28):                                       # 14 links a second: 28 per pass
        g = rng.uniform(0.5, 0.9) * (1.35 if i % 7 == 0 else 1.0)                 # the sprocket tooth bites hardest
        events.append((i / 14.0 + rng.uniform(0.0, 0.006), links[i % 6], g))
    clank = parts.fold_events(n, events)
    rumble = dsp.circular(lambda z: dsp.lp(z, 220, 2), dsp.noise(n, rng, -6)) * (0.7 + 0.3 * np.sin(TAU * 14 * t))
    gravel = parts.debris_loop(n, rng, 700.0 * (1 + 0.4 * dsp.wander(n, rng, 2.0)), parts.noise_kernels(rng, 5, 900, 5000, 0.002, 0.008))
    m = n_(0.18)
    squeal = []
    for t0 in (0.45, 1.38):                                   # steel rubbing on steel, twice a pass
        f = rng.uniform(1100, 1500)
        s = dsp.fm(dsp.env([(0, f), (0.18, f * 1.06)], m, "exp"), 2.41, 1.6, m) * dsp.hump(m, 0.06, 1.5, 1.5)
        s = s * (0.5 + 0.5 * dsp.saw(90.0 * (1 + 0.2 * dsp.wander(m, rng, 8.0)))) ** 2
        squeal.append((t0, s, rng.uniform(0.6, 1.0)))
    y = parts.norm(clank) + 0.35 * parts.unit(rumble) + 0.25 * parts.norm(gravel) + 0.05 * parts.fold_events(n, squeal)
    return dsp.drive(y * 0.8, 1.4)


# ---- the supply plane and the crates -------------------------------------------------------------
@sfx("supply_drop", "humans", level=-18.0,
     use="A supply plane drops a crate or reinforcements: four propellers droning over and away, and a parachute "
         "snapping open 0.9 s in. The game hears of a drop only as the crate leaves the plane, so the plane is "
         "overhead almost at once.")
def supply_drop(rng, v):
    dur = 4.6
    n = n_(dur)
    t = dsp.secs(n)
    over = 0.8
    along = 95.0 * (t - over)                                 # meters along its track at 95 m/s
    dist = np.sqrt(along ** 2 + 150.0 ** 2)                   # 150 m up at the closest
    doppler = 343.0 / (343.0 + 95.0 * along / dist)
    near = 150.0 / dist
    out = np.zeros(n)
    for f, g in ((66.0, 1.0), (67.3, 0.85), (65.1, 0.7), (68.2, 0.6)):          # four engines, never in step
        fr = f * doppler
        prop = dsp.saw(fr, start=rng.random()) + 0.5 * dsp.saw(fr * 2.0, start=rng.random())
        out += g * prop
    out = parts.unit(dsp.spectral_shape(out, lambda fr, tm: dsp.lowpass_mask(fr, 900.0, 2) * dsp.highpass_mask(fr, 50.0, 2), 2048))
    wash = parts.unit(dsp.bp(dsp.noise(n, rng, -3), 150, 1600)) * (0.7 + 0.3 * dsp.sine(66.0 * doppler))
    drone = (out + 0.4 * wash) * near ** 1.3
    m = n_(1.6)                                               # the chute: cloth snaps open, then flutters as it fills
    snap = parts.burst(m, rng, 3000, 350, 0.02, 0.12) + 0.8 * parts.thump(m, 150, 85, 0.02, 0.12)
    flutter = parts.unit(dsp.bp(dsp.noise(m, rng, -2), 500, 3000)) * (0.5 + 0.5 * dsp.sine(dsp.env([(0, 16), (1.6, 9)], m, "exp"))) ** 2
    flutter = flutter * dsp.env([(0, 0), (0.05, 1), (0.6, 0.4), (1.6, 0)], m)
    chute = dsp.mix((snap, 1.0), (flutter, 0.12))
    dry = dsp.mix((dsp.fade(drone, 0.25, 0.8), 0.5), (chute, 0.8, over + 0.1))
    ir = dsp.space_ir(rng, 1.6, pre=0.03, bright=2500, dark=500, echoes=((0.25, 0.25, 1200.0),), low_cut=50.0)
    return dsp.reverb(dry, ir, 0.2)


@sfx("crate_land", "humans", level=-20.0,
     use="A supply crate lands: a heavy wooden thump, the kit inside knocking, a creak, the parachute settling over it.")
def crate_land(rng, v):
    n = n_(1.0)
    thud = parts.thump(n, 130, 70, 0.02, 0.18)
    wood = np.zeros(n)
    for i, k in enumerate(parts.modal_kernels(rng, 3, 180, 420, 0.04, 0.09, ratios=(1.0, 2.43, 4.1), damp=0.45, tick=0.5)):
        dsp.put(wood, k, 0.004 * i, (1.0, 0.7, 0.5)[i])
    kit = parts.debris(n, rng, dsp.env([(0, 0), (0.02, 60), (0.14, 20), (0.25, 0)], n),
                       parts.modal_kernels(rng, 4, 1500, 3500, 0.012, 0.03, ratios=(1.0, 2.4, 4.6), damp=0.5), sigma=0.4)
    m = n_(0.3)
    creak = dsp.fm(dsp.env([(0, 240), (0.3, 300)], m, "exp"), 2.76, 1.4, m) * dsp.hump(m, 0.08, 1.5, 1.5)
    creak = creak * (0.5 + 0.5 * dsp.saw(55.0 * (1 + 0.2 * dsp.wander(m, rng, 8.0)))) ** 2
    cloth = parts.whoosh(n, rng, [(0, 2400), (1.0, 900)], 0.9, slope=-2.0) * dsp.env([(0, 0), (0.12, 0.0), (0.3, 1.0), (0.95, 0)], n)
    return dsp.mix((thud, 1.0), (parts.norm(wood), 0.5), (kit, 0.12), (creak, 0.04, 0.08), (cloth, 0.04))


@sfx("crate_take", "humans", level=-21.0,
     use="A squad takes a crate: two latches snap open, the lid knocks back, and what was inside is racked ready.")
def crate_take(rng, v):
    n = n_(0.62)
    out = np.zeros(n)
    for t0, f in ((0.0, 2600.0), (0.085, 2300.0)):           # the latches
        k = dsp.modal(n_(0.06), [f, f * 1.52, f * 2.3], [0.03, 0.02, 0.012], [1.0, 0.6, 0.4], rng)
        k[:n_(0.004)] += dsp.fit(dsp.click(rng, 2500, 10000, 0.003), n_(0.004))
        dsp.put(out, k, t0, 0.6)
    lid = parts.thump(n_(0.2), 190, 115, 0.01, 0.09) + 0.6 * dsp.fit(
        parts.modal_kernels(rng, 1, 220, 380, 0.04, 0.07, ratios=(1.0, 2.43, 4.1), damp=0.45, tick=0.5)[0], n_(0.2))
    dsp.put(out, lid, 0.17, 0.8)
    m = n_(0.08)                                              # a bolt pulled back ...
    slide = parts.unit(dsp.bp(dsp.noise(m, rng, -1), 1200, 6000)) * dsp.env([(0, 0), (0.01, 1), (0.07, 0.6), (0.08, 0)], m)
    dsp.put(out, slide, 0.33, 0.25)
    k = dsp.modal(n_(0.15), [950, 1530, 2340, 3400], [0.07, 0.05, 0.035, 0.02], [1.0, 0.7, 0.5, 0.3], rng)
    k[:n_(0.004)] += dsp.fit(dsp.click(rng, 1500, 8000, 0.004), n_(0.004))
    dsp.put(out, k, 0.42, 0.9)                                # ... and slammed home
    dsp.put(out, parts.thump(n_(0.12), 160, 100, 0.01, 0.06), 0.42, 0.5)
    return out


# ---- the artillery marker ----------------------------------------------------------------------
@sfx("flare_pop", "humans", level=-21.0,
     use="An artillery barrage is called: the marker's smoke flare pops and fizzes where the shells will land.")
def flare_pop(rng, v):
    n = n_(2.4)
    pop = parts.thump(n_(0.2), 420, 180, 0.01, 0.07, attack=0.0008) + 0.5 * dsp.fit(dsp.click(rng, 1200, 9000, 0.004), n_(0.2))
    ignite = parts.burst(n_(0.4), rng, 11000, 2200, 0.02, 0.18, slope=0.0)
    hiss = parts.unit(dsp.spectral_shape(dsp.noise(n, rng, -1.0), lambda f, t: dsp.bump(f, 4500, 1.1), 1024))
    hiss = hiss * (0.6 + 0.4 * dsp.wander(n, rng, 18.0)) * dsp.env([(0, 0), (0.06, 0.0), (0.12, 1.0), (1.4, 0.75), (2.4, 0)], n)
    sputter = parts.debris(n, rng, dsp.env([(0, 0), (0.1, 90), (1.4, 60), (2.3, 0)], n),
                           [dsp.click(rng, 1500, 7000, 0.003), dsp.click(rng, 800, 4000, 0.006)], sigma=0.8)
    return dsp.mix((pop, 1.0), (ignite, 0.35, 0.03), (hiss, 0.12), (sputter, 0.05))


# ---- the roar's stun ---------------------------------------------------------------------------
@sfx("stun_ring", "humans", level=-24.0,
     use="The player's own squad is stunned by the roar (2.5 s): the ears ring and the world wobbles and thuds, "
         "muffled. Not positional; once per stun, however many of the squad are stunned.")
def stun_ring(rng, v):
    dur = 2.6
    n = n_(dur)
    t = dsp.secs(n)
    wob = 1 + 0.012 * np.sin(TAU * 3.1 * t) + 0.006 * dsp.wander(n, rng, 2.0)            # dizzy: the pitch will not hold still
    ring = dsp.sine(3520.0 * wob) + 0.5 * dsp.sine(2793.83 * wob * 1.002) + 0.25 * dsp.sine(1760.0 * wob)    # A7, F7, A6: in the key
    ring = ring * dsp.env([(0, 0), (0.03, 1), (0.6, 0.7), (2.0, 0.25), (dur, 0)], n) * (0.8 + 0.2 * np.sin(TAU * 5.0 * t))
    thud = parts.unit(dsp.lp(dsp.noise(n, rng, -6), 260, 2)) * dsp.env([(0, 0), (0.02, 1), (0.4, 0.3), (dur, 0)], n)
    thud = thud * (0.55 + 0.45 * np.sin(TAU * 2.2 * t))                                 # the blood pounding
    return dsp.mix((ring, 0.32), (thud, 0.3))
