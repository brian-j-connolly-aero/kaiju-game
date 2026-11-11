"""Signal-processing toolkit for the sound-effect generators. numpy and scipy only.

Everything works on float64 arrays at 44.1 kHz, mono (n,) or stereo (n, 2), filtering along
axis 0. Times are seconds, levels are decibels relative to full scale.
"""
from __future__ import annotations

import zlib

import numpy as np
from scipy import ndimage, signal

SR = 44100
TAU = 2.0 * np.pi
SEED = 9001


# ---- basics ----------------------------------------------------------------------------------
def n_(seconds: float) -> int:
    return int(round(seconds * SR))


def db(x) -> float:
    return float(20.0 * np.log10(max(float(x), 1e-12)))


def amp(decibels: float) -> float:
    return float(10.0 ** (decibels / 20.0))


def rng_for(name: str, variant: int = 1) -> np.random.Generator:
    """Seeded generator: the same sound and variant always get the same random numbers."""
    return np.random.default_rng([SEED, zlib.crc32(name.encode()), variant])


def secs(n: int) -> np.ndarray:
    return np.arange(n) / SR


def fit(x: np.ndarray, n: int) -> np.ndarray:
    """Pad with silence or cut to exactly n samples."""
    if len(x) >= n:
        return x[:n]
    pad = [(0, n - len(x))] + [(0, 0)] * (x.ndim - 1)
    return np.pad(x, pad)


def mix(*parts: tuple[np.ndarray, float] | np.ndarray, at: list[float] | None = None) -> np.ndarray:
    """Sum signals of different lengths. Each part is an array or (array, gain) or
    (array, gain, start_seconds)."""
    items = []
    for p in parts:
        if isinstance(p, tuple):
            x, g = p[0], p[1]
            t0 = p[2] if len(p) > 2 else 0.0
        else:
            x, g, t0 = p, 1.0, 0.0
        items.append((np.asarray(x, dtype=float), g, n_(t0)))
    n = max(len(x) + s for x, _, s in items)
    stereo = any(x.ndim == 2 for x, _, _ in items)
    out = np.zeros((n, 2)) if stereo else np.zeros(n)
    for x, g, s in items:
        if stereo and x.ndim == 1:
            x = np.stack([x, x], axis=1)
        out[s:s + len(x)] += x * g
    return out


def put(out: np.ndarray, x: np.ndarray, t0: float, gain: float = 1.0) -> None:
    """Add x into out at t0 seconds, clipping at the end of out."""
    s = n_(t0)
    if s >= len(out) or s < 0:
        return
    m = min(len(x), len(out) - s)
    out[s:s + m] += x[:m] * gain


# ---- noise -----------------------------------------------------------------------------------
def noise(n: int, rng: np.random.Generator, slope: float = 0.0, f_lo: float = 25.0) -> np.ndarray:
    """Unit-RMS Gaussian noise with a spectral tilt in dB per octave (0 white, -3 pink,
    -6 brown). Built in the frequency domain, so it is periodic in n: it loops."""
    spec = np.fft.rfft(rng.standard_normal(n))
    if slope:
        f = np.maximum(np.fft.rfftfreq(n, 1.0 / SR), f_lo)
        spec *= (f / 1000.0) ** (slope / 6.0206)
    spec[0] = 0.0
    x = np.fft.irfft(spec, n)
    return x / (x.std() + 1e-12)


def impulses(n: int, rng: np.random.Generator, rate, sigma: float = 0.6) -> np.ndarray:
    """Random impulse train. `rate` is events per second (number or array over time).
    Amplitudes are log-normal with random sign: a few big ones, many small ones."""
    r = np.broadcast_to(np.asarray(rate, dtype=float), (n,))
    hit = rng.random(n) < r / SR
    out = np.zeros(n)
    k = int(hit.sum())
    out[hit] = rng.lognormal(0.0, sigma, k) * rng.choice([-1.0, 1.0], k)
    return out


def grains(n: int, rng: np.random.Generator, rate, kernels: list[np.ndarray], sigma: float = 0.6) -> np.ndarray:
    """A cloud of tiny impacts: impulses convolved with a set of kernels, shared out evenly."""
    out = np.zeros(n)
    r = np.asarray(rate, dtype=float) / len(kernels)
    for k in kernels:
        out += signal.fftconvolve(impulses(n, rng, r, sigma), k)[:n]
    return out


def click(rng: np.random.Generator, f_lo: float, f_hi: float, t60: float) -> np.ndarray:
    """A short band-limited noise tick with an exponential decay, unit peak."""
    n = max(16, n_(t60 * 1.3))
    k = bp(rng.standard_normal(n + 64), f_lo, f_hi)[64:] * decay(n, t60)
    return k / (np.max(np.abs(k)) + 1e-12)


# ---- filters ---------------------------------------------------------------------------------
def _fc(f: float) -> float:
    return float(min(max(f, 5.0), SR * 0.49))


def lp(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, _fc(fc), "low", fs=SR, output="sos"), x, axis=0)


def hp(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, _fc(fc), "high", fs=SR, output="sos"), x, axis=0)


def bp(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, [_fc(lo), _fc(hi)], "band", fs=SR, output="sos"), x, axis=0)


def _biquad(x, b, a):
    return signal.lfilter(np.asarray(b) / a[0], np.asarray(a) / a[0], x, axis=0)


def reson(x: np.ndarray, f: float, q: float) -> np.ndarray:
    """Resonant band-pass (0 dB at the center)."""
    w = TAU * _fc(f) / SR
    al = np.sin(w) / (2 * q)
    return _biquad(x, [al, 0.0, -al], [1 + al, -2 * np.cos(w), 1 - al])


def peak(x: np.ndarray, f: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    a_ = 10 ** (gain_db / 40)
    w = TAU * _fc(f) / SR
    al = np.sin(w) / (2 * q)
    return _biquad(x, [1 + al * a_, -2 * np.cos(w), 1 - al * a_], [1 + al / a_, -2 * np.cos(w), 1 - al / a_])


def shelf(x: np.ndarray, f: float, gain_db: float, high: bool = True) -> np.ndarray:
    a_ = 10 ** (gain_db / 40)
    w = TAU * _fc(f) / SR
    cs, al = np.cos(w), np.sin(w) / np.sqrt(2)
    r = 2 * np.sqrt(a_) * al
    s = 1.0 if high else -1.0
    b = [a_ * ((a_ + 1) + s * (a_ - 1) * cs + r), -s * 2 * a_ * ((a_ - 1) + s * (a_ + 1) * cs),
         a_ * ((a_ + 1) + s * (a_ - 1) * cs - r)]
    a = [(a_ + 1) - s * (a_ - 1) * cs + r, s * 2 * ((a_ - 1) - s * (a_ + 1) * cs), (a_ + 1) - s * (a_ - 1) * cs - r]
    return _biquad(x, b, a)


def circular(fn, x: np.ndarray, reps: int = 3) -> np.ndarray:
    """Run a filter on a periodic signal so the result is periodic too: process three copies
    end to end and keep the last one (the filter has reached its steady state by then)."""
    n = len(x)
    y = fn(np.concatenate([x] * reps, axis=0))
    return y[(reps - 1) * n:reps * n]


def spectral_shape(x: np.ndarray, gain_fn, n_fft: int = 1024) -> np.ndarray:
    """Time-varying filter: multiply the short-time spectrum by gain_fn(f, t), where f is a
    column of frequencies (Hz) and t a row of frame times (s); returns the reshaped signal."""
    hop = n_fft // 4
    f, t, z = signal.stft(x, SR, nperseg=n_fft, noverlap=n_fft - hop)
    g = gain_fn(f[:, None], t[None, :])
    _, y = signal.istft(z * g, SR, nperseg=n_fft, noverlap=n_fft - hop)
    return fit(y, len(x))


def bump(f, fc, width_oct):
    """Bell-shaped pass band on a log-frequency axis (for spectral_shape masks)."""
    return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / fc) / width_oct) ** 2)


def lorentz(f, fc, bw):
    """Resonance peak with bandwidth bw in Hz (for formant masks)."""
    return 1.0 / np.sqrt(1.0 + ((f - fc) / (0.5 * bw)) ** 2)


def lowpass_mask(f, fc, order: float = 2.0):
    return 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))


def highpass_mask(f, fc, order: float = 2.0):
    return 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1e-3)) ** (2 * order))


# ---- envelopes -------------------------------------------------------------------------------
def env(points: list[tuple[float, float]], n: int, shape: str = "lin") -> np.ndarray:
    """Break-point envelope from (seconds, value) pairs. shape 'exp' interpolates in decibels."""
    tp = [p[0] for p in points]
    vp = [p[1] for p in points]
    t = secs(n)
    if shape == "exp":
        return np.exp(np.interp(t, tp, np.log(np.maximum(vp, 1e-5))))
    return np.interp(t, tp, vp)


def decay(n: int, t60: float, attack: float = 0.0) -> np.ndarray:
    """Exponential decay that is 60 dB down after t60 seconds, with an optional smooth attack."""
    t = secs(n)
    e = np.exp(-6.9078 * t / t60)
    if attack > 0:
        a = np.clip(t / attack, 0, 1)
        e = e * (0.5 - 0.5 * np.cos(np.pi * a))
    return e


def hump(n: int, t_peak: float, up: float = 2.0, down: float = 2.0) -> np.ndarray:
    """Swell to 1 at t_peak and back to 0 at the end (powers set the curve shapes)."""
    t = secs(n)
    total = n / SR
    a = np.clip(t / max(t_peak, 1e-6), 0, 1) ** up
    b = np.clip((total - t) / max(total - t_peak, 1e-6), 0, 1) ** down
    return np.where(t < t_peak, a, b)


def fade(x: np.ndarray, t_in: float = 0.0, t_out: float = 0.0) -> np.ndarray:
    """Raised-cosine fades at the two ends."""
    y = np.array(x, dtype=float, copy=True)
    a, b = min(n_(t_in), len(y)), min(n_(t_out), len(y))
    if a > 1:
        w = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
        y[:a] = (y[:a].T * w).T
    if b > 1:
        w = 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
        y[-b:] = (y[-b:].T * w).T
    return y


# ---- oscillators -----------------------------------------------------------------------------
def _freq(freq, n: int | None) -> np.ndarray:
    f = np.asarray(freq, dtype=float)
    if f.ndim == 0:
        if n is None:
            raise ValueError("n is required for a constant frequency")
        f = np.full(n, float(f))
    return f


def glide(f0: float, f1: float, n: int, tau: float) -> np.ndarray:
    """Frequency that starts at f0 and settles exponentially toward f1 (time constant tau)."""
    return f1 + (f0 - f1) * np.exp(-secs(n) / tau)


def sweep(f0: float, f1: float, n: int) -> np.ndarray:
    """Exponential (constant musical speed) sweep from f0 to f1 over the whole length."""
    return f0 * (f1 / f0) ** (np.arange(n) / max(n - 1, 1))


def phase(freq, n: int | None = None, start: float = 0.0) -> np.ndarray:
    """Running phase in cycles."""
    f = _freq(freq, n)
    return start + (np.cumsum(f) - f[0]) / SR


def sine(freq, n: int | None = None, start: float = 0.0) -> np.ndarray:
    return np.sin(TAU * phase(freq, n, start))


def _blep_saw(ph: np.ndarray, dt: np.ndarray) -> np.ndarray:
    y = 2.0 * ph - 1.0
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1.0
    m = ph > 1.0 - dt
    t = (ph[m] - 1.0) / dt[m]
    y[m] -= t * t + t + t + 1.0
    return y


def saw(freq, n: int | None = None, start: float = 0.0) -> np.ndarray:
    """Band-limited (polyBLEP) rising sawtooth."""
    f = _freq(freq, n)
    return _blep_saw(phase(f, None, start) % 1.0, np.maximum(f, 1e-3) / SR)


def square(freq, n: int | None = None, duty: float = 0.5, start: float = 0.0) -> np.ndarray:
    """Band-limited pulse wave (difference of two sawtooths), zero mean."""
    f = _freq(freq, n)
    ph = phase(f, None, start) % 1.0
    dt = np.maximum(f, 1e-3) / SR
    return _blep_saw(ph, dt) - _blep_saw((ph + duty) % 1.0, dt)


def tri(freq, n: int | None = None, start: float = 0.0) -> np.ndarray:
    ph = phase(freq, n, start) % 1.0
    return 4.0 * np.abs(ph - 0.5) - 1.0


def fm(carrier, ratio: float, index, n: int | None = None) -> np.ndarray:
    """Two-operator frequency modulation: a sine at `carrier` Hz whose phase is pushed around by
    a sine at carrier x ratio. Non-integer ratios give metallic, bell-like spectra."""
    fc = _freq(carrier, n)
    ph = phase(fc)
    return np.sin(TAU * ph + np.asarray(index) * np.sin(TAU * ph * ratio))


def modal(n: int, freqs, t60s, amps, rng: np.random.Generator | None = None) -> np.ndarray:
    """Struck-object model: a sum of exponentially decaying sine partials (its modes)."""
    t = secs(n)
    out = np.zeros(n)
    for f, d, a in zip(freqs, t60s, amps):
        if f >= SR * 0.47:
            continue
        ph = rng.uniform(0, TAU) if rng is not None else 0.0
        m = min(n, n_(d * 1.6) + 1)
        out[:m] += a * np.exp(-6.9078 * t[:m] / d) * np.sin(TAU * f * t[:m] + ph)
    return out


def excite(x: np.ndarray, ir: np.ndarray, n: int | None = None) -> np.ndarray:
    """Drive a resonant body (an impulse response) with an excitation signal."""
    y = signal.fftconvolve(x, ir)
    return fit(y, n) if n else y


def drive(x: np.ndarray, amount: float) -> np.ndarray:
    """Soft saturation (tanh), normalised so small signals keep their level."""
    return np.tanh(x * amount) / amount


def resample(x: np.ndarray, ratio: float) -> np.ndarray:
    """Play faster (ratio > 1: shorter and higher) or slower by linear-phase resampling."""
    if abs(ratio - 1.0) < 1e-6:
        return x
    m = max(8, int(round(len(x) / ratio)))
    return signal.resample(x, m, axis=0)


# ---- spaces ----------------------------------------------------------------------------------
def space_ir(rng: np.random.Generator, t60: float, *, pre: float = 0.0, bright: float = 7000.0,
             dark: float = 900.0, echoes: tuple = (), stereo: bool = False, low_cut: float = 120.0,
             build: float = 0.004) -> np.ndarray:
    """Synthetic impulse response of an outdoor or indoor space: exponentially decaying noise
    that loses its highs as it decays, plus optional discrete echoes (seconds, gain, cutoff Hz)
    such as slap-back from building fronts. Unit energy, so `wet` in reverb() is a level ratio."""
    n = n_(pre + t60 * 1.15)
    for e in echoes:
        n = max(n, n_(e[0] + 0.05))

    def one() -> np.ndarray:
        m = n - n_(pre)
        t = secs(m)
        a = lp(rng.standard_normal(m), bright, 1)
        b = lp(rng.standard_normal(m), dark, 2) * 1.8
        u = np.clip(t / (0.55 * t60), 0, 1)
        tail = (a * (1 - u) + b * u) * np.exp(-6.9078 * t / t60) * np.clip(t / build, 0, 1)
        ir = np.concatenate([np.zeros(n - m), hp(tail, low_cut)])
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
        for delay, g, cut in echoes:
            k = n_(0.006)
            burst = lp(rng.standard_normal(k) * decay(k, 0.006), cut, 1)
            burst *= g / (np.sqrt(np.sum(burst ** 2)) + 1e-12)
            s = n_(delay * (1.0 + rng.uniform(-0.02, 0.02)))
            ir[s:s + k] += burst[:max(0, min(k, n - s))]
        return ir

    return np.stack([one(), one()], axis=1) if stereo else one()


def reverb(x: np.ndarray, ir: np.ndarray, wet: float, dry: float = 1.0) -> np.ndarray:
    """Convolve with an impulse response and add to the dry signal. A stereo impulse response
    turns a mono input into a stereo output with the dry sound in the center."""
    if ir.ndim == 2:
        xs = x if x.ndim == 2 else np.stack([x, x], axis=1)
        y = np.stack([signal.fftconvolve(xs[:, c], ir[:, c]) for c in (0, 1)], axis=1)
        out = y * wet
        out[:len(xs)] += xs * dry
        return out
    if x.ndim == 2:
        y = np.stack([signal.fftconvolve(x[:, c], ir) for c in (0, 1)], axis=1)
    else:
        y = signal.fftconvolve(x, ir)
    out = y * wet
    out[:len(x)] += x * dry
    return out


def pan(x: np.ndarray, pos: float) -> np.ndarray:
    """Equal-power pan of a mono signal, pos from -1 (left) to 1 (right)."""
    a = (pos + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2.0)


# ---- loops -----------------------------------------------------------------------------------
def fold(x: np.ndarray, n: int) -> np.ndarray:
    """Wrap everything after n samples back onto the start, so tails ring across the loop point."""
    out = np.zeros((n,) + x.shape[1:])
    for s in range(0, len(x), n):
        seg = x[s:s + n]
        out[:len(seg)] += seg
    return out


def lfo(n: int, cycles: float, start: float = 0.0) -> np.ndarray:
    """Sine with a whole number of cycles in n samples (so it is seamless in a loop)."""
    return np.sin(TAU * (cycles * np.arange(n) / n + start))


def wander(n: int, rng: np.random.Generator, speed: float, periodic: bool = True) -> np.ndarray:
    """Smooth random curve in -1..1 with components up to `speed` Hz; periodic in n."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    spec *= np.exp(-0.5 * (f / speed) ** 2)
    spec[0] = 0
    x = np.fft.irfft(spec, n)
    return x / (np.max(np.abs(x)) + 1e-12)


# ---- measurement and level control -----------------------------------------------------------
def _k_sos() -> np.ndarray:
    """K-weighting (ITU-R BS.1770) for 44.1 kHz: a high shelf and a high-pass."""
    def shelf_coeffs():
        g, q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
        k = np.tan(np.pi * fc / SR)
        vh, vb = 10 ** (g / 20), (10 ** (g / 20)) ** 0.499666774155
        a0 = 1 + k / q + k * k
        return [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
                1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]

    def hp_coeffs():
        q, fc = 0.5003270373253953, 38.13547087613982
        k = np.tan(np.pi * fc / SR)
        a0 = 1 + k / q + k * k
        return [1.0, -2.0, 1.0, 1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]

    return np.array([shelf_coeffs(), hp_coeffs()])


_K = _k_sos()


def k_weight(x: np.ndarray) -> np.ndarray:
    return signal.sosfilt(_K, x, axis=0)


def k_power(x: np.ndarray) -> np.ndarray:
    """K-weighted instantaneous power, averaged over channels."""
    p = k_weight(x) ** 2
    return p.mean(axis=1) if p.ndim == 2 else p


def level_short(x: np.ndarray, window: float = 0.2) -> float:
    """Loudness of a one-shot: K-weighted level of its loudest 200 ms (about the ear's
    integration time), in dB. Sounds shorter than the window are averaged over the window."""
    p = k_power(x)
    w = n_(window)
    p = np.concatenate([np.zeros(w), p, np.zeros(w)])
    c = np.cumsum(p)
    m = (c[w:] - c[:-w]).max() / w
    return float(10 * np.log10(m + 1e-20) - 0.691)


def level_loop(x: np.ndarray) -> float:
    """Loudness of a loop: K-weighted level over one whole pass (steady state), in dB."""
    n = len(x)
    p = k_power(np.concatenate([x, x], axis=0))[n:]
    return float(10 * np.log10(p.mean() + 1e-20) - 0.691)


def true_peak(x: np.ndarray) -> float:
    """Inter-sample peak estimate: 4x oversampled."""
    return float(np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0))))


def soft_clip(x: np.ndarray, ceiling: float, knee: float = 0.5) -> np.ndarray:
    """Soft clipper for impacts: linear up to knee x ceiling, then a tanh curve that never
    passes the ceiling. Unlike a limiter it does not duck what follows the transient, and the
    harmonics it adds to bass peaks help them read on small speakers."""
    t = ceiling * knee
    a = np.abs(x)
    y = np.array(x, dtype=float, copy=True)
    over = a > t
    y[over] = np.sign(x[over]) * (t + (ceiling - t) * np.tanh((a[over] - t) / (ceiling - t)))
    return y


def limiter(x: np.ndarray, ceiling: float, look: float = 0.003, release: float = 0.10) -> tuple[np.ndarray, float]:
    """Look-ahead peak limiter. Gain comes down smoothly just before a peak, never lets a
    sample past the ceiling, and recovers slowly. Returns the signal and the deepest gain
    reduction in dB (0 when the limiter did nothing)."""
    pk = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    if pk.max() <= ceiling * 0.7:
        return x, 0.0
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0))          # peaks between the samples count too
    if up.ndim == 2:
        up = up.max(axis=1)
    pk = np.maximum(pk, up[:4 * len(pk)].reshape(len(pk), 4).max(axis=1))
    if pk.max() <= ceiling:
        return x, 0.0
    block = 16
    nb = -(-len(pk) // block)
    pkb = np.pad(pk, (0, nb * block - len(pk))).reshape(nb, block).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(pkb, 1e-12))
    la = max(1, int(np.ceil(look * SR / block)))
    target = ndimage.minimum_filter1d(need, size=2 * la + 1, mode="nearest")
    g = np.empty(nb)
    cur, a = 1.0, np.exp(-block / (release * SR))
    for i in range(nb):
        t = target[i]
        cur = t if t < cur else t + (cur - t) * a
        g[i] = cur
    g = ndimage.uniform_filter1d(g, size=la + 1, mode="nearest")
    centers = (np.arange(nb) + 0.5) * block
    gs = np.interp(np.arange(len(pk)), centers, g)
    gs = np.minimum(gs, ceiling / np.maximum(pk, 1e-12))       # exact guarantee
    y = (x.T * gs).T
    return y, float(-20 * np.log10(gs.min()))
