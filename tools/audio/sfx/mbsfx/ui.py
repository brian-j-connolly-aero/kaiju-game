"""Interface sounds: short, clean, slightly retro. Tonal ones sit in D minor, the key of the
music, so they never clash with the score."""
from __future__ import annotations

import numpy as np

from . import dsp, parts
from .dsp import TAU, n_
from .parts import note
from .registry import sfx

# D minor pitches (Hz)
D3, A3, D4, F4, A4, C5, D5, E5, F5, G5, A5, D6, F6, A6, D7 = (146.83, 220.0, 293.66, 349.23, 440.0, 523.25, 587.33, 659.26,
                                                              698.46, 783.99, 880.0, 1174.66, 1396.91, 1760.0, 2349.32)
BB2, EB5, AB5 = 116.54, 622.25, 830.61


def _soft(x: np.ndarray, cutoff: float = 7000.0) -> np.ndarray:
    """Take the glassy top off square waves: retro, not harsh."""
    return dsp.lp(x, cutoff, 2)


def _seq(total: float, events: list[tuple[float, np.ndarray, float]]) -> np.ndarray:
    out = np.zeros(n_(total))
    for t0, x, g in events:
        dsp.put(out, x, t0, g)
    return out


@sfx("ui_click", "ui", level=-27.0, use="Any button press.")
def ui_click(rng, v):
    blip = note(D6, 0.05, "square", 0.035, attack=0.0005, duty=0.4, bend=7.0)
    tick = dsp.click(rng, 2500, 9000, 0.003)
    return _soft(_seq(0.06, [(0.0, blip, 0.5), (0.0, tick, 0.5)]))


@sfx("ui_hover", "ui", level=-34.0, use="Pointer or stick moves onto a control (quiet).")
def ui_hover(rng, v):
    return note(D7, 0.035, "sine", 0.025, attack=0.001)


@sfx("ui_ready", "ui", level=-22.0, use="A player marks ready in the lobby: two rising notes.")
def ui_ready(rng, v):
    a = note(A5, 0.09, "square", 0.1, duty=0.35) + 0.6 * note(A5, 0.09, "tri", 0.1)
    b = note(D6, 0.3, "square", 0.26, duty=0.35) + 0.6 * note(D6, 0.3, "tri", 0.26) + 0.2 * note(D7, 0.3, "sine", 0.15)
    return _soft(_seq(0.4, [(0.0, a, 0.5), (0.085, b, 0.5)]))


@sfx("ui_error", "ui", level=-22.0, use="Action not possible (cooldown, nothing in reach): two low buzzes.")
def ui_error(rng, v):
    def buzz(dur):
        n = n_(dur)
        x = dsp.square(D3, n, duty=0.3) + 0.8 * dsp.square(D3 * 1.0595, n, duty=0.3)        # a semitone apart: sour
        return dsp.fade(x * dsp.env([(0, 0), (0.004, 1), (dur - 0.01, 0.8), (dur, 0)], n), 0.0, 0.004)
    return _soft(_seq(0.3, [(0.0, buzz(0.1), 0.5), (0.14, buzz(0.14), 0.5)]), 3500.0)


@sfx("ui_wheel_open", "ui", level=-25.0, use="The command wheel opens: four quick rising blips and a breath of air.")
def ui_wheel_open(rng, v):
    events = [(0.03 * i, note(f, 0.07, "tri", 0.06, attack=0.001), 0.5 + 0.1 * i) for i, f in enumerate((D5, F5, A5, D6))]
    n = n_(0.2)
    air = parts.whoosh(n, rng, [(0, 1200), (0.2, 5000)], 0.8) * dsp.hump(n, 0.07, 1.5, 2.0)
    return _soft(_seq(0.22, events + [(0.0, air, 0.06)]))


@sfx("ui_wheel_select", "ui", level=-24.0, use="A command is chosen on the wheel: a decisive tock.")
def ui_wheel_select(rng, v):
    tock = note(A5, 0.12, "square", 0.08, attack=0.0005, duty=0.3, bend=-5.0) + 0.7 * note(A4, 0.12, "tri", 0.07)
    return _soft(_seq(0.14, [(0.0, tock, 0.5), (0.0, dsp.click(rng, 1800, 7000, 0.004), 0.5)]))


@sfx("ui_join", "ui", level=-22.0, use="A player joins the room: a warm rising three-note figure.")
def ui_join(rng, v):
    events = []
    for i, f in enumerate((D5, A5, D6)):
        x = note(f, 0.34, "tri", 0.3) + 0.35 * note(f, 0.34, "square", 0.2, duty=0.5) + 0.2 * note(f * 2, 0.34, "sine", 0.15)
        events.append((0.075 * i, x, 0.5))
    return _soft(_seq(0.52, events), 6000.0)


@sfx("ui_tick", "ui", level=-27.0, use="Countdown tick (last ten seconds, draft timer).")
def ui_tick(rng, v):
    return _seq(0.07, [(0.0, note(D6, 0.06, "sine", 0.045, attack=0.0005, bend=5.0), 0.6),
                       (0.0, dsp.click(rng, 2000, 6000, 0.003), 0.3)])


@sfx("ui_match_start", "ui", level=-17.0, use="The match begins: a rising arcade fanfare into a held D minor chord.")
def ui_match_start(rng, v):
    def lead(f, dur, t60):
        return note(f, dur, "square", t60, duty=0.3) + 0.6 * note(f * 1.004, dur, "saw", t60) + 0.4 * note(f / 2, dur, "tri", t60)
    events_l, events_r = [], []
    for i, f in enumerate((D4, A4, D5, F5, A5)):
        x = _soft(lead(f, 0.16, 0.14), 5500.0)
        pos = -0.5 + 0.25 * i
        events_l.append((0.085 * i, x, 0.4 * np.cos((pos + 1) * np.pi / 4)))
        events_r.append((0.085 * i, x, 0.4 * np.sin((pos + 1) * np.pi / 4)))
    for f, g, pos in ((D5, 0.4, -0.4), (A5, 0.34, 0.4), (D6, 0.3, 0.0), (F6, 0.16, 0.2), (D4, 0.3, 0.0)):
        x = _soft(lead(f, 0.85, 0.75), 5500.0)
        events_l.append((0.44, x, g * np.cos((pos + 1) * np.pi / 4)))
        events_r.append((0.44, x, g * np.sin((pos + 1) * np.pi / 4)))
    n = n_(0.9)
    crash = parts.unit(dsp.hp(dsp.noise(n, rng), 3500, 2)) * dsp.decay(n, 0.7, 0.002)
    drum = parts.thump(n, 150, 60, 0.03, 0.3) * 2.0
    both = [(0.44, crash, 0.05), (0.44, drum, 0.5)]
    return np.stack([_seq(1.4, events_l + both), _seq(1.4, events_r + both)], axis=1)


def _static(rng: np.random.Generator, dur: float) -> np.ndarray:
    n = n_(dur)
    x = dsp.bp(dsp.noise(n + 256, rng), 420, 3300)[256:]
    return parts.unit(x) * (0.75 + 0.25 * dsp.wander(n, rng, 60.0))


@sfx("radio_open", "ui", level=-25.0, use="Radio channel opens before a voice line: key click and a rising burst of static.")
def radio_open(rng, v):
    st = _static(rng, 0.13) * dsp.env([(0, 0), (0.01, 0.4), (0.09, 1.0), (0.13, 0)], n_(0.13))
    key = dsp.bp(np.concatenate([dsp.click(rng, 600, 3000, 0.006), np.zeros(n_(0.02))]), 400, 3200)
    return _seq(0.15, [(0.0, key, 1.0), (0.012, st, 0.3)])


@sfx("radio_close", "ui", level=-25.0, use="Radio channel closes after a voice line: static tail, a short over-beep, key click.")
def radio_close(rng, v):
    st = _static(rng, 0.1) * dsp.env([(0, 0.9), (0.06, 1.0), (0.1, 0)], n_(0.1))
    beep = note(1320.0, 0.06, "sine", 0.3, attack=0.003) * dsp.env([(0, 1), (0.05, 1), (0.06, 0)], n_(0.06))
    key = dsp.bp(np.concatenate([dsp.click(rng, 500, 2500, 0.008), np.zeros(n_(0.02))]), 400, 3200)
    return _seq(0.22, [(0.0, st, 0.3), (0.1, beep, 0.35), (0.17, key, 1.0)])


def _stab(freqs, dur: float, t60: float, bright: float = 4500.0, sweep: float = 0.0) -> np.ndarray:
    """A chord of slightly detuned sawtooths with a closing filter: brassy, synthetic."""
    n = n_(dur)
    glide = 2.0 ** (sweep / 12.0 * np.linspace(0, 1, n) ** 0.7)
    x = sum(dsp.saw(f * glide) + dsp.saw(f * 1.006 * glide, start=0.37) + 0.5 * dsp.square(f * 0.5 * glide, duty=0.4) for f in freqs)
    y = dsp.spectral_shape(x, lambda f, t: dsp.lowpass_mask(f, 400 + bright * np.exp(-t / (0.35 * t60)), 2), 512)
    return dsp.fade(y * dsp.decay(n, t60, 0.004), 0.0, 0.02) / len(freqs)


@sfx("sting_crossfire", "ui", level=-18.0,
     use="Crossfire achieved (hits from two wide angles): a tick left, a tick right, then both land together.")
def sting_crossfire(rng, v):
    left = dsp.pan(_soft(note(A5, 0.12, "square", 0.09, duty=0.3)), -0.85)
    right = dsp.pan(_soft(note(D6, 0.12, "square", 0.09, duty=0.3)), 0.85)
    hit = _stab((D5, A5, D6), 0.6, 0.5, 5500.0)
    n = n_(0.6)
    crack = parts.burst(n, rng, 9000, 1500, 0.015, 0.09, slope=0.0)
    thud = parts.thump(n, 150, 62, 0.03, 0.25)
    center = dsp.mix((hit, 0.9), (crack, 0.35), (thud, 1.2))
    out = np.zeros((n_(0.85), 2))
    out[:len(left)] += left * 0.45
    s = n_(0.11)
    out[s:s + len(right)] += right * 0.45
    s = n_(0.22)
    out[s:s + len(center)] += np.stack([center, center], axis=1)[:len(out) - s]
    return out


@sfx("sting_nerve_break", "ui", level=-17.0,
     use="The kaiju's nerve breaks (stagger, weak point open): a crack like glass and a chord sliding down.")
def sting_nerve_break(rng, v):
    n = n_(1.15)
    crack = parts.burst(n, rng, 13000, 2500, 0.012, 0.07, slope=0.0)
    ring = parts.norm(parts.shards(n, rng, 26, 2500, 9000, 0.07, 0.03, 0.14))
    slide = _stab((D5, F5, AB5), 1.05, 0.9, 5000.0, sweep=-6.0)                 # diminished, falling a tritone
    low = parts.thump(n, 120, 45, 0.06, 0.5)
    mono = dsp.mix((crack, 0.5), (slide, 0.9, 0.02), (low, 1.0, 0.02))
    ir = dsp.space_ir(rng, 0.7, pre=0.01, bright=6000, dark=1200, stereo=True, low_cut=200.0)
    out = dsp.reverb(mono, ir, 0.18)
    out[:n] += dsp.pan(ring, 0.0) * 0.25 * np.array([1.0, 0.8])
    return out


@sfx("sting_bar_mark", "ui", level=-17.0,
     use="The destruction bar passes a mark (a tower on the skyline falls): two heavy low brass hits and a bell.")
def sting_bar_mark(rng, v):
    n = n_(1.5)
    a = _stab((D3, A3, D4), 0.5, 0.45, 2600.0)
    b = _stab((BB2, D3 * 1.0, F4 / 2), 1.0, 0.95, 2200.0)                       # falls to B flat: the theme's dark side
    drum = parts.thump(n_(0.6), 95, 42, 0.05, 0.5)
    m = n_(1.1)
    bell = dsp.modal(m, [D5, D5 * 2.0, D5 * 2.76, D5 * 4.07, D5 * 5.4], [1.0, 0.8, 0.55, 0.35, 0.25], [1.0, 0.6, 0.45, 0.25, 0.15])
    mono = _seq(1.5, [(0.0, a, 1.0), (0.0, drum, 1.6), (0.3, b, 1.0), (0.3, drum, 1.9), (0.3, dsp.fade(bell, 0.002, 0.05), 0.16)])
    ir = dsp.space_ir(rng, 1.0, pre=0.015, bright=4000, dark=900, stereo=True, low_cut=150.0)
    return dsp.reverb(mono[:n], ir, 0.2)


@sfx("sting_molt_ready", "ui", level=-19.0,
     use="A molt is available to the kaiju: a double heartbeat and an eerie rising shimmer.")
def sting_molt_ready(rng, v):
    n = n_(1.25)
    t = dsp.secs(n)
    beat = _seq(1.25, [(0.0, parts.thump(n_(0.4), 90, 48, 0.03, 0.3, harm=0.5, sat=2.4), 2.0),
                       (0.22, parts.thump(n_(0.4), 105, 58, 0.03, 0.25, harm=0.5, sat=2.4), 1.4)])
    rise = dsp.env([(0, D5), (0.3, D5), (1.1, A5), (1.25, A5)], n, "exp")
    shimmer = (dsp.fm(rise, 2.0, 1.2, n) + 0.7 * dsp.sine(rise * 1.498) + 0.5 * dsp.sine(rise * 2.0 * (1 + 0.004 * np.sin(TAU * 6 * t))))
    shimmer = shimmer * dsp.env([(0, 0), (0.25, 0.15), (0.95, 1.0), (1.25, 0)], n) * (0.75 + 0.25 * np.sin(TAU * 7.5 * t))
    mono = beat + 0.28 * shimmer
    ir = dsp.space_ir(rng, 0.9, pre=0.01, bright=6000, dark=1500, stereo=True, low_cut=250.0)
    return dsp.reverb(mono, ir, 0.22)


@sfx("camera_shutter", "ui", level=-27.0, use="A reporter drone takes a photo: shutter open, mirror slap, shutter closed.")
def camera_shutter(rng, v):
    def leaf(f):
        k = dsp.modal(n_(0.03), [f, f * 1.7, f * 2.9], [0.02, 0.012, 0.008], [1.0, 0.6, 0.4], rng)
        k[:n_(0.004)] += dsp.fit(dsp.click(rng, 3000, 12000, 0.003), n_(0.004))
        return k
    slap = parts.thump(n_(0.05), 420, 260, 0.01, 0.035)
    return _seq(0.14, [(0.0, leaf(2600), 0.5), (0.008, slap, 0.7), (0.07, leaf(3300), 0.42)])
