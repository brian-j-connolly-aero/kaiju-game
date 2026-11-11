"""Signal helpers: resampling, filters, loudness (ITU-R BS.1770), true peak, silence handling."""

from __future__ import annotations

from math import gcd

import numpy as np
from scipy import signal


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype(np.float64)
    g = gcd(int(sr_in), int(sr_out))
    return signal.resample_poly(x.astype(np.float64), sr_out // g, sr_in // g, axis=0)


def db(v: float) -> float:
    return 20.0 * np.log10(max(float(v), 1e-12))


def gain(dbv: float) -> float:
    return 10.0 ** (dbv / 20.0)


def butter(x: np.ndarray, sr: int, kind: str, freq, order: int = 4) -> np.ndarray:
    """Zero-latency (causal) Butterworth filter. kind: 'highpass', 'lowpass' or 'bandpass'."""
    sos = signal.butter(order, freq, btype=kind, fs=sr, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def peaking(x: np.ndarray, sr: int, freq: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    """One peaking equalizer band (audio EQ cookbook)."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2 * np.pi * freq / sr
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    den = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(np.array(b) / den[0], np.array(den) / den[0], x, axis=0)


def shelf(x: np.ndarray, sr: int, freq: float, gain_db: float, high: bool = True) -> np.ndarray:
    """Low or high shelf (audio EQ cookbook, slope 1)."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2 * np.pi * freq / sr
    cs, sn = np.cos(w0), np.sin(w0)
    alpha = sn / 2 * np.sqrt(2.0)
    s = 2 * np.sqrt(a) * alpha
    if high:
        b = [a * ((a + 1) + (a - 1) * cs + s), -2 * a * ((a - 1) + (a + 1) * cs), a * ((a + 1) + (a - 1) * cs - s)]
        den = [(a + 1) - (a - 1) * cs + s, 2 * ((a - 1) - (a + 1) * cs), (a + 1) - (a - 1) * cs - s]
    else:
        b = [a * ((a + 1) - (a - 1) * cs + s), 2 * a * ((a - 1) - (a + 1) * cs), a * ((a + 1) - (a - 1) * cs - s)]
        den = [(a + 1) + (a - 1) * cs + s, -2 * ((a - 1) + (a + 1) * cs), (a + 1) + (a - 1) * cs - s]
    return signal.lfilter(np.array(b) / den[0], np.array(den) / den[0], x, axis=0)


# ---------------------------------------------------------------- loudness (ITU-R BS.1770-4)

def _k_weight(x: np.ndarray, sr: int) -> np.ndarray:
    # stage 1: high shelf +4 dB at 1682 Hz; stage 2: high-pass at 38 Hz (coefficients derived
    # for any sample rate from the analog prototypes of the standard)
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / sr)
    vh = 10.0 ** (g / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    b = [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    y = signal.lfilter(b, a, x, axis=0)
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / sr)
    a0 = 1.0 + k / q + k * k
    b = [1.0, -2.0, 1.0]
    a = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    return signal.lfilter(b, a, y, axis=0)


def lufs(x: np.ndarray, sr: int) -> float:
    """Integrated loudness in LUFS (Loudness Units relative to Full Scale), with both gates.
    Accepts (n,) mono or (n, 2) stereo. Clips shorter than one 400 ms block are measured whole."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    y = _k_weight(x, sr)
    block = int(round(0.4 * sr))
    hop = int(round(0.1 * sr))
    if len(y) < block:
        z = np.sum(np.mean(y ** 2, axis=0))
        return -0.691 + 10 * np.log10(max(z, 1e-12))
    zs = []
    for i in range(0, len(y) - block + 1, hop):
        zs.append(np.sum(np.mean(y[i:i + block] ** 2, axis=0)))
    zs = np.array(zs)
    l = -0.691 + 10 * np.log10(np.maximum(zs, 1e-12))
    keep = zs[l > -70.0]
    if len(keep) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(keep)) - 10.0
    keep = zs[(l > -70.0) & (l > rel)]
    if len(keep) == 0:
        return -70.0
    return float(-0.691 + 10 * np.log10(np.mean(keep)))


def true_peak_db(x: np.ndarray, sr: int) -> float:
    """True peak in dBTP (decibels true peak), 4 times oversampled."""
    if len(x) == 0:
        return -120.0
    y = signal.resample_poly(np.asarray(x, dtype=np.float64), 4, 1, axis=0)
    return db(np.max(np.abs(y)))


def limit(x: np.ndarray, sr: int, ceiling_db: float = -1.5, lookahead_ms: float = 3.0,
          release_ms: float = 60.0) -> np.ndarray:
    """Look-ahead peak limiter. Stereo is limited with one shared gain."""
    x = np.asarray(x, dtype=np.float64)
    c = gain(ceiling_db)
    mono = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    # measure on a 4 times oversampled envelope so the ceiling holds for true peaks as well
    over = signal.resample_poly(x, 4, 1, axis=0)
    env4 = np.max(np.abs(over), axis=1) if over.ndim == 2 else np.abs(over)
    n = len(mono)
    env = np.maximum(mono, env4[: 4 * n].reshape(n, 4).max(axis=1))
    need = np.minimum(1.0, c / np.maximum(env, 1e-12))
    la = max(1, int(sr * lookahead_ms / 1000))
    # the gain must already be down `la` samples before the peak: running minimum over a window
    pad = np.concatenate([need, np.ones(la)])
    from scipy.ndimage import minimum_filter1d
    held = minimum_filter1d(pad, size=la + 1, origin=-(la // 2))[:n]
    held = np.minimum(held, need)
    # smooth the recovery
    rel = np.exp(-1.0 / (sr * release_ms / 1000))
    g = np.empty(n)
    cur = 1.0
    for i in range(n):
        t = held[i]
        cur = t if t < cur else rel * cur + (1 - rel) * t
        g[i] = cur
    # short smoothing of the attack edge
    k = max(1, la // 2)
    g = np.minimum(g, np.convolve(g, np.ones(k) / k, mode="same"))
    g = np.minimum(g, held)
    return x * (g[:, None] if x.ndim == 2 else g)


# ---------------------------------------------------------------- silence handling

def envelope_db(x: np.ndarray, sr: int, win_ms: float = 10.0) -> np.ndarray:
    """Short-time level in dB per sample (moving root mean square)."""
    m = np.mean(x, axis=1) if x.ndim == 2 else x
    w = max(1, int(sr * win_ms / 1000))
    p = np.convolve(m ** 2, np.ones(w) / w, mode="same")
    return 10 * np.log10(np.maximum(p, 1e-14))


def speech_bounds(x: np.ndarray, sr: int, floor_db: float = -42.0) -> tuple[int, int]:
    """First and last sample above `floor_db` relative to the loudest 10 ms."""
    e = envelope_db(x, sr)
    idx = np.nonzero(e > e.max() + floor_db)[0]
    if len(idx) == 0:
        return 0, len(x)
    return int(idx[0]), int(idx[-1]) + 1


def trim(x: np.ndarray, sr: int, floor_db: float = -42.0, lead_ms: float = 8.0,
         tail_ms: float = 25.0) -> np.ndarray:
    """Cut leading and trailing silence, leaving a few milliseconds and fading the cut edges."""
    a, b = speech_bounds(x, sr, floor_db)
    a = max(0, a - int(sr * lead_ms / 1000))
    b = min(len(x), b + int(sr * tail_ms / 1000))
    y = np.array(x[a:b], dtype=np.float64)
    fade(y, sr, 4.0, 12.0)
    return y


def fade(x: np.ndarray, sr: int, in_ms: float, out_ms: float) -> np.ndarray:
    """In-place raised-cosine fades at both ends."""
    ni = min(len(x), int(sr * in_ms / 1000))
    no = min(len(x), int(sr * out_ms / 1000))
    if ni > 1:
        w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, ni))
        x[:ni] = x[:ni] * (w[:, None] if x.ndim == 2 else w)
    if no > 1:
        w = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, no))
        x[-no:] = x[-no:] * (w[:, None] if x.ndim == 2 else w)
    return x


def find_pauses(x: np.ndarray, sr: int, floor_db: float = -40.0, min_ms: float = 80.0) -> list[tuple[int, int]]:
    """Internal stretches quieter than `floor_db` (relative to the loudest 10 ms) of at least `min_ms`."""
    e = envelope_db(x, sr)
    quiet = e < e.max() + floor_db
    out = []
    n = len(quiet)
    i = 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if i > 0 and j < n and (j - i) >= sr * min_ms / 1000:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


def limit_pauses(x: np.ndarray, sr: int, max_ms: float, min_ms: float = 0.0) -> np.ndarray:
    """Shorten every internal pause longer than `max_ms` to `max_ms` (removing its middle with a
    5 ms crossfade) and stretch pauses shorter than `min_ms` (sentence pauses only: at least
    150 ms long) up to `min_ms` by inserting silence."""
    pauses = find_pauses(x, sr)
    if not pauses:
        return x
    xf = int(sr * 0.005)
    parts = []
    pos = 0
    for a, b in pauses:
        length = b - a
        want = length
        if length > sr * max_ms / 1000:
            want = int(sr * max_ms / 1000)
        elif min_ms and length >= sr * 0.15 and length < sr * min_ms / 1000:
            want = int(sr * min_ms / 1000)
        if want == length:
            continue
        mid = (a + b) // 2
        if want < length:
            cut = length - want
            c0 = mid - cut // 2
            c1 = c0 + cut
            seg = np.array(x[pos:c0], dtype=np.float64)
            nxt = np.array(x[c1:], dtype=np.float64)
            # crossfade the seam
            k = min(xf, len(seg), len(nxt))
            if k > 1:
                w = np.linspace(0, 1, k)
                seg[-k:] = seg[-k:] * (1 - w) + x[c1 - k:c1] * w
            parts.append(seg)
            pos = c1
        else:
            parts.append(np.array(x[pos:mid], dtype=np.float64))
            parts.append(np.zeros(want - length))
            pos = mid
    parts.append(np.array(x[pos:], dtype=np.float64))
    return np.concatenate(parts)


def f0_track(x: np.ndarray, sr: int, fmin: float = 50.0, fmax: float = 400.0) -> np.ndarray:
    """Pitch of the voiced 40 ms frames (autocorrelation), in Hz."""
    x = resample(x, sr, 16000)
    sr = 16000
    x = x - np.mean(x)
    win, hop = int(0.04 * sr), int(0.01 * sr)
    lo, hi = int(sr / fmax), int(sr / fmin)
    peak = np.max(np.abs(x)) + 1e-9
    out = []
    hann = np.hanning(win)
    for i in range(0, len(x) - win, hop):
        fr = x[i:i + win]
        if np.sqrt(np.mean(fr ** 2)) < 0.03 * peak:
            continue
        fr = fr * hann
        spec = np.fft.rfft(fr, 2 * win)
        ac = np.fft.irfft(np.abs(spec) ** 2)[:win]
        ac = ac / (ac[0] + 1e-12)
        seg = ac[lo:hi]
        k = int(np.argmax(seg))
        if seg[k] > 0.5:
            thr = 0.9 * seg[k]
            for j in range(1, len(seg) - 1):
                if seg[j] > thr and seg[j] >= seg[j - 1] and seg[j] >= seg[j + 1]:
                    k = j
                    break
            out.append(sr / (lo + k))
    return np.array(out)


def band_share(x: np.ndarray, sr: int, lo: float, hi: float) -> float:
    """Fraction of the signal energy between lo and hi Hz."""
    m = np.mean(x, axis=1) if x.ndim == 2 else x
    f, p = signal.welch(m, sr, nperseg=min(4096, len(m)))
    tot = np.sum(p) + 1e-20
    return float(np.sum(p[(f >= lo) & (f < hi)]) / tot)


def spectral_centroid(x: np.ndarray, sr: int) -> float:
    m = np.mean(x, axis=1) if x.ndim == 2 else x
    f, p = signal.welch(m, sr, nperseg=4096)
    return float(np.sum(f * p) / (np.sum(p) + 1e-20))


def rolloff(x: np.ndarray, sr: int, share: float = 0.99) -> float:
    """Frequency below which `share` of the energy lies."""
    m = np.mean(x, axis=1) if x.ndim == 2 else x
    f, p = signal.welch(m, sr, nperseg=4096)
    c = np.cumsum(p) / (np.sum(p) + 1e-20)
    return float(f[min(len(f) - 1, int(np.searchsorted(c, share)))])
