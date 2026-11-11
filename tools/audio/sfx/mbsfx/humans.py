"""Human-side sounds: rockets, tank guns, shells, artillery, volleys, engines, marching, losses."""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import TAU, n_
from .registry import sfx
from .world import sparkler


@sfx("rocket_launch", "humans", variants=3, level=-18.0, clip=True,
     use="Rocket infantry fires: tube pop, ignition, the hiss of the motor leaving.")
def rocket_launch(rng, v):
    tune = (1.0, 0.9, 1.1)[v - 1]
    n = n_(1.0)
    pop = parts.thump(n, 190 * tune, 95 * tune, 0.02, 0.11) + 0.6 * dsp.fit(dsp.click(rng, 900, 7000, 0.005), n)
    ignite = parts.burst(n, rng, 13000, 2500 * tune, 0.03, 0.13, slope=0.0)
    path = dsp.env([(0, 2400 * tune), (0.07, 5200 * tune), (0.35, 3000 * tune), (1.0, 1500 * tune)], n, "exp")
    swell = dsp.env([(0, 0), (0.015, 1), (0.14, 0.75), (0.5, 0.3), (0.95, 0)], n)
    hiss = parts.whoosh(n, rng, path, 1.0, slope=-1.5) * swell
    motor = parts.unit(dsp.bp(dsp.noise(n, rng, -3), 140, 900)) * swell * (0.6 + 0.4 * dsp.sine(92 * tune, n))    # the burn flutters
    return dsp.mix((pop, 0.8), (ignite, 0.7), (hiss, 0.2), (motor, 0.17))


@sfx("tank_fire", "humans", variants=3, level=-16.0, clip=True,
     use="Tank main gun: crack, boom, the breech ringing, and the report rolling off the buildings.")
def tank_fire(rng, v):
    tune = (1.0, 0.93, 1.07)[v - 1]
    n = n_(1.45)
    crack = dsp.fit(dsp.click(rng, 800, 9000, 0.006), n) + parts.burst(n, rng, 14000, 950, 0.015, 0.12, slope=0.0)
    boom = parts.thump(n, 98 * tune, 37 * tune, 0.05, 0.55, attack=0.002, harm=0.4, sat=2.4)
    body = parts.burst(n, rng, 5200, 260 * tune, 0.05, 0.5)
    base = 410 * tune
    clang = dsp.modal(n, [base, base * 1.59, base * 2.31, base * 3.14, base * 4.43], [0.42, 0.3, 0.26, 0.18, 0.12],
                      [1.0, 0.7, 0.5, 0.35, 0.2], rng) * dsp.decay(n, 0.6, 0.004)
    dry = dsp.mix((crack, 0.6), (boom, 0.7), (body, 1.0), (clang, 0.07, 0.012))
    ir = dsp.space_ir(rng, 1.0, pre=0.015, bright=4500, dark=600, echoes=((0.2, 0.3, 1600.0), (0.36, 0.2, 950.0)), low_cut=60.0)
    return dsp.reverb(dry, ir, 0.2)


@sfx("shell_whoosh", "humans", level=-21.0, use="A shell or rocket passes close by (the kaiju's ear, or a near miss).")
def shell_whoosh(rng, v):
    n = n_(0.75)
    tt = dsp.secs(n)
    path = dsp.env([(0, 2600), (0.3, 2100), (0.42, 1200), (0.75, 800)], n, "exp")          # Doppler: high, then low
    swell = dsp.hump(n, 0.33, 2.5, 1.8)
    air = parts.whoosh(n, rng, path, 0.8) * swell
    whistle = parts.unit(dsp.spectral_shape(dsp.noise(n, rng), lambda f, t: dsp.bump(f, 1.5 * np.interp(t, tt, path), 0.05), 2048))
    return dsp.mix((air, 1.0), (whistle * swell ** 2, 0.45))


@sfx("arty_incoming", "humans", level=-19.0,
     use="Artillery shell coming down: a falling whistle that swells until impact (play an explosion as it ends).")
def arty_incoming(rng, v):
    n = n_(1.8)
    tt = dsp.secs(n)
    fall = dsp.env([(0, 2700), (1.8, 880)], n, "exp") * (1 + 0.012 * np.sin(TAU * 13 * tt))
    swell = dsp.env([(0, 0.0), (0.06, 0.2), (1.3, 0.6), (1.74, 1.0), (1.8, 0.0)], n)
    tone = dsp.sine(fall) + 0.25 * dsp.sine(fall * 2.0)
    breath = parts.unit(dsp.spectral_shape(dsp.noise(n, rng), lambda f, t: dsp.bump(f, np.interp(t, tt, fall), 0.06), 2048))
    rush = parts.whoosh(n, rng, fall * 0.35, 0.9) * swell ** 2
    return dsp.mix((tone * swell, 0.5), (breath * swell, 0.7), (rush, 0.5))


@sfx("arty_distant", "humans", level=-21.0,
     use="Off-map battery firing when a call-in is placed: muffled thumps from beyond the city, 4 s before impact.")
def arty_distant(rng, v):
    n = n_(1.6)
    out = np.zeros(n)
    for i, t0 in enumerate((0.0, 0.31, 0.63, 0.82)):
        m = n_(0.7)
        gun = parts.thump(m, 82 * rng.uniform(0.9, 1.1), 42, 0.05, 0.4, attack=0.006) + 0.9 * parts.burst(m, rng, 1500, 260, 0.05, 0.3, slope=-3.0)
        dsp.put(out, gun, t0 + rng.uniform(0.0, 0.03), 1.0 - 0.12 * i)
    out = dsp.lp(out, 900, 2)
    ir = dsp.space_ir(rng, 1.9, pre=0.06, bright=1200, dark=400, echoes=((0.33, 0.35, 700.0), (0.58, 0.25, 500.0)), low_cut=40.0)
    return dsp.reverb(out, ir, 0.5)


@sfx("laser_charge_loop", "humans", loop=1.0, level=-21.0,
     use="A sub-unit holding fire and charging: thin electric tone. Raise the playback rate with the charge "
         "(1.0 at empty to 1.5 at full, where volley_ready takes over from the same pitch), then keep it at about "
         "a third of the level for as long as the charge is held.")
def laser_charge_loop(rng, v):
    n = n_(1.0)
    t = np.arange(n) / n                                      # whole numbers of cycles: periodic
    tone = np.sin(TAU * 880 * t) + 0.9 * np.sin(TAU * 884 * t) + 0.3 * np.sin(TAU * 1760 * t) + 0.2 * np.sin(TAU * 440 * t)
    shimmer = 0.18 * np.sin(TAU * 3520 * t) * (0.5 + 0.5 * np.sin(TAU * 16 * t))
    edge = 0.12 * dsp.circular(lambda z: dsp.lp(z, 2600, 2), dsp.square(220.0, n, duty=0.2))
    return (tone * (0.85 + 0.15 * np.sin(TAU * 8 * t)) + shimmer + edge) * 0.4


@sfx("volley_ready", "humans", level=-20.0,
     use="A sub-unit reaches full charge (the yellow diamond fills): the charging tone whips upward and locks, "
         "with a hard tick, into a ringing open fifth. The lock is 0.09 s in.")
def volley_ready(rng, v):
    # Not a figure of notes like the lobby's ui_ready: this is the charging laser itself. The tone
    # of laser_charge_loop at full charge (1320 Hz, the loop played at rate 1.5) slides up a fourth
    # in one sweep and locks on A with the fifth above it.
    lock = 0.09
    m = n_(lock)
    f = dsp.sweep(1320.0, 1760.0, m)
    whip = dsp.sine(f) + 0.9 * dsp.sine(f * 1.0045) + 0.3 * dsp.sine(f * 2.0) + 0.2 * dsp.sine(f * 0.5)
    whip = whip * dsp.env([(0, 0.0), (0.006, 0.3), (lock - 0.004, 1.0), (lock, 0.0)], m)
    whip = whip * (0.75 + 0.25 * dsp.sine(dsp.sweep(24.0, 70.0, m)))                       # the shimmer speeds up
    k = n_(0.38)
    t = dsp.secs(k)
    beat = 0.8 + 0.2 * np.cos(TAU * 16.0 * t)                                             # locked, still humming
    ring = (dsp.fm(1760.0, 1.5, 1.2 * dsp.decay(k, 0.07), k) + 0.55 * dsp.sine(2637.02, k) + 0.2 * dsp.sine(3520.0, k)) * beat
    ring = ring * dsp.decay(k, 0.32, 0.0012)
    out = np.zeros(m + k)
    dsp.put(out, whip, 0.0, 0.4)
    dsp.put(out, ring, lock, 1.0)
    dsp.put(out, dsp.click(rng, 2500, 9000, 0.004), lock, 0.6)
    return out


@sfx("volley_fire", "humans", level=-16.0, clip=True,
     use="The player triggers a charged volley: a hard crack and rising rush under the salvo itself.")
def volley_fire(rng, v):
    n = n_(0.9)
    crack = parts.burst(n, rng, 12000, 1600, 0.02, 0.13, slope=0.0) + dsp.fit(dsp.click(rng, 1200, 9000, 0.005), n)
    punch = parts.thump(n, 140, 52, 0.04, 0.28, harm=0.35, sat=2.2)
    m = n_(0.16)
    zap = dsp.saw(dsp.sweep(2000, 240, m)) * dsp.decay(m, 0.14, 0.001)
    rush = parts.whoosh(n, rng, [(0, 700), (0.5, 4800), (0.9, 6000)], 0.9) * dsp.env([(0, 0), (0.03, 0.5), (0.22, 1), (0.85, 0)], n)
    return dsp.mix((crack, 0.6), (punch, 1.0), (dsp.lp(zap, 5000, 2), 0.25), (rush, 0.12))


@sfx("tank_engine_loop", "humans", loop=2.0, level=-23.0,
     use="Tank idling and driving (positional). Raise the playback rate with speed (1.0 to about 1.4).")
def tank_engine_loop(rng, v):
    n = n_(2.0)
    rate = 24.0                                               # firings per second: 48 per pass
    count = int(rate * 2.0)
    pattern = rng.uniform(0.7, 1.0, 6)                        # uneven cylinders give the engine its lope
    events = []
    m = n_(0.09)
    for i in range(count):
        g = pattern[i % 6] * rng.uniform(0.93, 1.07)
        f = 74.0 * rng.uniform(0.97, 1.03)
        fire = (dsp.sine(dsp.glide(f * 1.5, f, m, 0.008), m) * dsp.decay(m, 0.07, 0.002)
                + 0.5 * dsp.lp(rng.standard_normal(m), 600, 2) * dsp.decay(m, 0.03, 0.001))
        events.append((i / rate, fire, g))
    block = parts.fold_events(n, events)
    pulse = 0.55 + 0.45 * dsp.saw(rate, n) ** 2
    exhaust = dsp.circular(lambda z: dsp.bp(z, 90, 700), dsp.noise(n, rng, -3)) * pulse
    k = n_(0.03)
    link = parts.modal_kernels(rng, 4, 900, 2600, 0.012, 0.03, ratios=(1.0, 2.31, 3.9), damp=0.5)
    tracks = parts.fold_events(n, [(i / 11.0 + rng.uniform(0, 0.006), link[i % 4][:k * 2], rng.uniform(0.5, 1.0)) for i in range(22)])
    whine = np.sin(TAU * 2400 * np.arange(n) / n + 0.6 * np.sin(TAU * 12 * np.arange(n) / n))       # 1200 Hz turbo
    return dsp.drive(parts.unit(block) * 0.9 + parts.unit(exhaust) * 0.5 + parts.norm(tracks) * 0.22 + whine * 0.03, 1.5)


@sfx("march_loop", "humans", loop=2.0, level=-25.0,
     use="Infantry section moving: boots in step at 120 paces a minute with a little gear rattle (positional).")
def march_loop(rng, v):
    n = n_(2.0)
    events = []
    gear = parts.modal_kernels(rng, 5, 1800, 5200, 0.01, 0.03, ratios=(1.0, 2.4, 4.6), damp=0.5)
    for step in range(4):
        t0 = 0.04 + step * 0.5
        accent = 1.0 if step % 2 == 0 else 0.85
        for _ in range(10):                                   # ten pairs of boots, never quite together
            m = n_(0.14)
            boot = (parts.thump(m, 170 * rng.uniform(0.85, 1.15), 95, 0.015, 0.07) * 0.8
                    + parts.burst(m, rng, 2800 * rng.uniform(0.7, 1.3), 500, 0.012, 0.055) * 0.6)
            events.append((t0 + abs(rng.normal(0, 0.022)), boot, accent * rng.uniform(0.5, 1.0)))
        for _ in range(4):
            events.append((t0 + rng.uniform(0.02, 0.2), gear[rng.integers(5)], 0.06 * rng.uniform(0.4, 1.0)))
    return parts.fold_events(n, events)


@sfx("unit_destroyed", "humans", variants=3, level=-15.0, clip=True,
     use="A human unit is wiped out: blast, sparkler crackle and metal coming down.")
def unit_destroyed(rng, v):
    tune = (1.0, 0.9, 1.1)[v - 1]
    n = n_(1.8)
    boom = parts.thump(n, 125 * tune, 44 * tune, 0.05, 0.5, harm=0.35, sat=2.2)
    body = parts.burst(n, rng, 9500, 360 * tune, 0.06, 0.7)
    crunch = parts.metal_crunch(rng, n, dsp.env([(0, 2200), (0.1, 1200), (0.35, 0)], n), 200 * tune, 3000 * tune) * dsp.decay(n, 0.5)
    plates = np.zeros(n)
    for _ in range(7):                                        # pieces landing
        t0 = 0.08 + rng.beta(1.2, 1.8) * 1.0
        base = np.exp(rng.uniform(np.log(260), np.log(1400))) * tune
        m = n_(0.5)
        ring = dsp.modal(m, base * np.array([1.0, 1.52, 2.26, 3.03, 4.17]), rng.uniform(0.12, 0.45, 5), [1.0, 0.8, 0.6, 0.4, 0.3], rng)
        ring[:n_(0.02)] += 0.5 * dsp.fit(dsp.click(rng, 1500, 8000, 0.004), n_(0.02))
        dsp.put(plates, ring, t0, rng.uniform(0.35, 1.0) * (1.25 - t0))
    dry = dsp.mix((boom, 1.0), (body, 0.85), (crunch, 0.08), (parts.norm(plates), 0.18), (sparkler(n, rng, 0.9), 0.16))
    return dsp.reverb(dry, dsp.space_ir(rng, 0.8, pre=0.012, bright=5000, dark=600, echoes=((0.16, 0.22, 1700.0),), low_cut=60.0), 0.16)


@sfx("member_down", "humans", variants=3, level=-22.0,
     use="A unit loses a member (a soldier or one tank of a troop): dull hit, kit clattering, a short falling tone.")
def member_down(rng, v):
    tune = (1.0, 1.12, 0.89)[v - 1]
    n = n_(0.55)
    hit = parts.thump(n, 140 * tune, 74 * tune, 0.025, 0.13) + 0.5 * parts.burst(n, rng, 3000, 500, 0.015, 0.06)
    kit = parts.debris(n, rng, dsp.env([(0, 0), (0.03, 70), (0.2, 30), (0.4, 0)], n),
                       parts.modal_kernels(rng, 6, 1200 * tune, 4200 * tune, 0.012, 0.035, ratios=(1.0, 2.4, 4.6), damp=0.5), sigma=0.4)
    m = n_(0.26)
    fall = dsp.tri(dsp.sweep(622 * tune, 311 * tune, m), start=0.25) * dsp.decay(m, 0.24, 0.004)
    return dsp.mix((hit, 0.9), (kit, 0.1), (dsp.lp(fall, 3000, 2), 0.25, 0.04))


@sfx("shaken", "humans", level=-21.0, use="A unit's nerve breaks (shaken for 4 s): a wavering, sinking tone with a rattle under it.")
def shaken(rng, v):
    n = n_(0.95)
    t = dsp.secs(n)
    f = dsp.env([(0, 523.25), (0.2, 493.9), (0.95, 311.1)], n, "exp") * (1 + dsp.env([(0, 0.01), (0.95, 0.07)], n) * np.sin(TAU * 11 * t))
    tone = dsp.tri(f, start=0.25) + 0.7 * dsp.tri(f * 1.0595, start=0.25)          # a semitone apart: uneasy
    tone = tone * dsp.env([(0, 0), (0.01, 1), (0.5, 0.7), (0.95, 0)], n) * (0.7 + 0.3 * np.sin(TAU * 11 * t + 1.0))
    rattle = parts.debris(n, rng, 55.0, parts.noise_kernels(rng, 3, 1500, 5000, 0.004, 0.01), sigma=0.4) * dsp.env([(0, 0.3), (0.3, 1), (0.95, 0)], n)
    return dsp.mix((dsp.lp(tone, 3500, 2), 0.5), (rattle, 0.1))


@sfx("takeover", "humans", level=-20.0, use="The player takes over a surviving sub-unit: swish, click, two rising notes.")
def takeover(rng, v):
    n = n_(0.62)
    m = n_(0.2)
    swish = parts.whoosh(m, rng, [(0, 500), (0.17, 3800), (0.2, 3000)], 0.8) * dsp.env([(0, 0), (0.16, 1), (0.2, 0)], m) ** 2
    out = np.zeros(n)
    dsp.put(out, swish, 0.0, 0.5)
    dsp.put(out, dsp.click(rng, 1500, 7000, 0.005), 0.18, 0.6)
    dsp.put(out, parts.note(587.33, 0.16, "square", 0.14, duty=0.3), 0.19, 0.3)
    dsp.put(out, parts.note(880.0, 0.4, "square", 0.3, duty=0.3) + 0.5 * parts.note(880.0, 0.4, "tri", 0.3), 0.3, 0.3)
    return dsp.lp(out, 6500, 2)
