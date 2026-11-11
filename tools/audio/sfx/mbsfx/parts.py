"""Building blocks shared by several sounds: thumps, blasts, whooshes, debris, crackle."""
from __future__ import annotations

import numpy as np

from . import dsp
from .dsp import SR, TAU


def norm(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    return x * (peak / (np.max(np.abs(x)) + 1e-12))


def unit(x: np.ndarray) -> np.ndarray:
    """Scale to unit RMS."""
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-12)


def curve(points: list[tuple[float, float]], dur: float, n: int, shape: str = "lin") -> np.ndarray:
    """Break-point curve given in normalised time (0 = start, 1 = dur seconds)."""
    return dsp.env([(u * dur, v) for u, v in points], n, shape)


def thump(n: int, f_start: float, f_end: float, tau: float, t60: float, attack: float = 0.002,
          harm: float = 0.25, sat: float = 1.6) -> np.ndarray:
    """The low body of an impact: a sine that drops in pitch as it decays, with a little
    second and third harmonic and soft saturation so it still reads on small speakers."""
    ph = dsp.phase(dsp.glide(f_start, f_end, n, tau))
    body = np.sin(TAU * ph) + harm * np.sin(TAU * 2 * ph + 0.6) + 0.5 * harm * np.sin(TAU * 3 * ph + 1.1)
    return dsp.drive(body * dsp.decay(n, t60, attack) * 1.2, sat)


def burst(n: int, rng: np.random.Generator, f_open: float, f_close: float, t_close: float, t60: float,
          slope: float = -3.0, attack: float = 0.0005) -> np.ndarray:
    """Noise burst whose low-pass filter closes from f_open to f_close while it decays: the
    broadband part of impacts and blasts (bright crack first, dull roar after)."""
    x = dsp.noise(n, rng, slope)

    def g(f, t):
        return dsp.lowpass_mask(f, f_close + (f_open - f_close) * np.exp(-t / t_close), 1.5)

    return unit(dsp.spectral_shape(x, g, 512)) * dsp.decay(n, t60, attack)


def whoosh(n: int, rng: np.random.Generator, fc, width: float = 0.6, slope: float = -3.0) -> np.ndarray:
    """Noise through a band-pass whose center follows fc (array of n values, or (seconds, Hz)
    break points). Unit RMS; shape the loudness afterwards."""
    if isinstance(fc, list):
        fc = dsp.env(fc, n, "exp")
    tt = dsp.secs(n)
    x = dsp.noise(n, rng, slope)
    return unit(dsp.spectral_shape(x, lambda f, t: dsp.bump(f, np.interp(t, tt, fc), width), 1024))


def noise_kernels(rng: np.random.Generator, count: int, f_lo: float, f_hi: float, t_lo: float,
                  t_hi: float, rel_width: float = 1.5) -> list[np.ndarray]:
    """Short band-limited ticks at random pitches: grit, gravel, sparks."""
    out = []
    for _ in range(count):
        fc = np.exp(rng.uniform(np.log(f_lo), np.log(f_hi)))
        out.append(dsp.click(rng, fc / rel_width, fc * rel_width, rng.uniform(t_lo, t_hi)))
    return out


def modal_kernels(rng: np.random.Generator, count: int, f_lo: float, f_hi: float, t_lo: float,
                  t_hi: float, ratios=(1.0, 2.32, 4.25), damp: float = 0.55, tick: float = 0.25) -> list[np.ndarray]:
    """Small struck objects: a few damped partials each, with a little noise on the attack.
    Heavily damped low ratios sound like plaster or wood, long inharmonic ones like metal."""
    out = []
    for _ in range(count):
        fc = np.exp(rng.uniform(np.log(f_lo), np.log(f_hi)))
        t60 = rng.uniform(t_lo, t_hi)
        fr = [fc * r * rng.uniform(0.96, 1.04) for r in ratios]
        dd = [t60 * damp ** i for i in range(len(ratios))]
        aa = [0.8 ** i for i in range(len(ratios))]
        n = dsp.n_(t60 * 1.4)
        k = dsp.modal(n, fr, dd, aa, rng)
        if tick:
            c = dsp.click(rng, fc * 1.5, min(fc * 8, 16000.0), 0.004)
            k[:len(c)] += tick * c[:len(k)]
        out.append(norm(k))
    return out


def debris(n: int, rng: np.random.Generator, rate, kernels: list[np.ndarray], sigma: float = 0.7) -> np.ndarray:
    """A cloud of small impacts at `rate` events per second (number or array over time)."""
    return dsp.grains(n, rng, rate, kernels, sigma)


def sparkle(n: int, rng: np.random.Generator, rate, f_lo: float = 3500.0, f_hi: float = 15000.0) -> np.ndarray:
    """Sparkler crackle: a dense spray of very short, very bright ticks with a few loud pops."""
    ks = [dsp.click(rng, f_lo, f_hi, 0.0012), dsp.click(rng, f_lo * 1.6, f_hi, 0.0007),
          dsp.click(rng, f_lo * 0.7, f_hi * 0.6, 0.0022)]
    return dsp.grains(n, rng, rate, ks, sigma=1.0)


def comb(x: np.ndarray, delays_ms: list[float], gains: list[float]) -> np.ndarray:
    """Add delayed copies (feed-forward comb): gives whooshes a hollow, flanged colour."""
    out = np.array(x, copy=True)
    for d, g in zip(delays_ms, gains):
        k = dsp.n_(d / 1000.0)
        out[k:] += g * x[:len(x) - k]
    return out


def slapback(x: np.ndarray, echoes: list[tuple[float, float, float]]) -> np.ndarray:
    """Discrete echoes (seconds, gain, low-pass Hz) added after the dry sound: building fronts."""
    n = len(x) + dsp.n_(max(e[0] for e in echoes))
    out = dsp.fit(np.array(x, copy=True), n)
    for delay, g, cut in echoes:
        dsp.put(out, dsp.lp(x, cut, 1), delay, g)
    return out


def fold_events(body: int, events: list[tuple[float, np.ndarray, float]]) -> np.ndarray:
    """Place (seconds, sound, gain) events in a loop of `body` samples; tails wrap around."""
    longest = max(dsp.n_(t) + len(x) for t, x, _ in events)
    buf = np.zeros(max(body, longest))
    for t, x, g in events:
        dsp.put(buf, x, t, g)
    return dsp.fold(buf, body)


def periodic_shape(x: np.ndarray, gain_fn, n_fft: int = 1024) -> np.ndarray:
    """spectral_shape for loop material: gain_fn(f, t) must itself be periodic in len(x)."""
    n = len(x)
    period = n / SR
    y = dsp.spectral_shape(np.concatenate([x, x, x]), lambda f, t: gain_fn(f, t % period), n_fft)
    return y[n:2 * n]

