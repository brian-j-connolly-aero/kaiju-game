"""Signal processing for the mix: hall reverb, filters, loop folding, limiter, loudness.

Everything before the limiter is linear and time-invariant, which is what makes the loops
seamless: a loop is rendered once with its full ring-out, then the part that rings past the
loop end is folded back onto the start. The result is exactly the steady state of the music
playing forever, so the end of the loop flows into its start with the hall still ringing.
"""
from __future__ import annotations

import re
import subprocess

import numpy as np
from scipy import ndimage, signal

SR = 44100


# ---- filters -------------------------------------------------------------------------------
def highpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    if not hz:
        return x
    sos = signal.butter(order, hz, "highpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def lowpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    if not hz:
        return x
    sos = signal.butter(order, hz, "lowpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def _biquad(b0, b1, b2, a0, a1, a2) -> np.ndarray:
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def shelf(x: np.ndarray, hz: float, db: float, kind: str) -> np.ndarray:
    """Low or high shelf (RBJ cookbook), slope 0.7."""
    if not db:
        return x
    a = 10 ** (db / 40)
    w = 2 * np.pi * hz / SR
    cs, sn = np.cos(w), np.sin(w)
    alpha = sn / 2 * np.sqrt((a + 1 / a) * (1 / 0.7 - 1) + 2)
    k = 2 * np.sqrt(a) * alpha
    if kind == "low":
        sos = _biquad(a * ((a + 1) - (a - 1) * cs + k), 2 * a * ((a - 1) - (a + 1) * cs),
                      a * ((a + 1) - (a - 1) * cs - k), (a + 1) + (a - 1) * cs + k,
                      -2 * ((a - 1) + (a + 1) * cs), (a + 1) + (a - 1) * cs - k)
    else:
        sos = _biquad(a * ((a + 1) + (a - 1) * cs + k), -2 * a * ((a - 1) + (a + 1) * cs),
                      a * ((a + 1) + (a - 1) * cs - k), (a + 1) - (a - 1) * cs + k,
                      2 * ((a - 1) - (a + 1) * cs), (a + 1) - (a - 1) * cs - k)
    return signal.sosfilt(sos, x, axis=0)


def peak_eq(x: np.ndarray, hz: float, db: float, q: float = 1.0) -> np.ndarray:
    if not db:
        return x
    a = 10 ** (db / 40)
    w = 2 * np.pi * hz / SR
    alpha = np.sin(w) / (2 * q)
    sos = _biquad(1 + alpha * a, -2 * np.cos(w), 1 - alpha * a,
                  1 + alpha / a, -2 * np.cos(w), 1 - alpha / a)
    return signal.sosfilt(sos, x, axis=0)


def place(x: np.ndarray, pan: float, width: float) -> np.ndarray:
    """Seat a stereo source: narrow it to `width`, then pan the middle (constant power)."""
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5 * width
    ang = (pan + 1) * np.pi / 4
    gl, gr = np.cos(ang) * np.sqrt(2), np.sin(ang) * np.sqrt(2)
    return np.stack([mid * gl + side, mid * gr - side], axis=1)


# ---- the hall ------------------------------------------------------------------------------
_HALL_CACHE: dict[tuple, np.ndarray] = {}


def hall_ir(seconds: float = 3.4, seed: int = 9001) -> np.ndarray:
    """Synthetic concert-hall impulse response, stereo, shape (n, 2, 2): [time, input, output].

    Band-limited noise with a longer decay in the lows and mids than in the highs (about 2.5 s
    at 500 Hz, 1.1 s at 8 kHz), a few early reflections, and 22 ms of pre-delay. A little of
    each input channel reaches the other side so the hall is wide but sources keep their seat.
    Deterministic: the noise comes from a fixed seed.
    """
    key = (seconds, seed)
    if key in _HALL_CACHE:
        return _HALL_CACHE[key]
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    bands = [(90, 2.2, 0.55), (180, 2.6, 0.9), (360, 2.6, 1.0), (720, 2.4, 1.0), (1440, 2.1, 0.95),
             (2880, 1.7, 0.8), (5760, 1.25, 0.6), (11000, 0.8, 0.35)]      # centre Hz, RT60 s, level
    pre = int(0.022 * SR)
    ir = np.zeros((n, 2, 2))
    for i in range(2):
        for o in range(2):
            noise = rng.standard_normal(n)
            tail = np.zeros(n)
            for fc, rt, level in bands:
                lo, hi = fc / np.sqrt(2), min(fc * np.sqrt(2), SR * 0.45)
                sos = signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")
                tail += level * signal.sosfilt(sos, noise) * np.exp(-6.9078 * t / rt)
            tail *= 1 - np.exp(-t / 0.035)             # the diffuse field builds up, it does not snap on
            early = np.zeros(n)
            for k in range(9):                         # sparse early reflections, 9 to 85 ms
                at = int((0.009 + 0.076 * rng.random()) * SR)
                early[at] += (0.9 if i == o else 0.45) * rng.choice([-1, 1]) * (0.75 ** k)
            early = lowpass(early, 6000)
            h = tail / np.sqrt(np.sum(tail ** 2)) + 0.38 * early / np.sqrt(np.sum(early ** 2) + 1e-12)
            h = np.concatenate([np.zeros(pre), h])[:n]
            h *= np.minimum(1.0, (n - np.arange(n)) / (0.25 * SR))      # fade the very end to zero
            ir[:, i, o] = h * (1.0 if i == o else 0.42)
    ir /= np.sqrt(np.sum(ir[:, 0, 0] ** 2) + np.sum(ir[:, 1, 0] ** 2))  # unit energy per output
    _HALL_CACHE[key] = ir
    return ir


def reverb(send: np.ndarray, ir: np.ndarray | None = None) -> np.ndarray:
    """Convolve a stereo send with the hall. Output is len(send) + len(ir) - 1 long."""
    if ir is None:
        ir = hall_ir()
    out = np.zeros((len(send) + len(ir) - 1, 2))
    for o in range(2):
        for i in range(2):
            out[:, o] += signal.fftconvolve(send[:, i], ir[:, i, o])
    return out


# ---- loops ---------------------------------------------------------------------------------
def fold(x: np.ndarray, loop_len: int) -> np.ndarray:
    """Fold everything that rings past the loop end back onto the start (steady-state loop)."""
    out = np.zeros((loop_len, x.shape[1]))
    for k in range(0, len(x), loop_len):
        seg = x[k:k + loop_len]
        out[:len(seg)] += seg
    return out


# ---- dynamics --------------------------------------------------------------------------------
def limiter_gain(peak: np.ndarray, ceiling: float, lookahead_ms: float = 4.0,
                 release_ms: float = 140.0) -> np.ndarray:
    """Gain curve of a look-ahead peak limiter for the given peak envelope (max |sample|).

    Instant gain needed is ceiling / peak. It is held over the look-ahead window, released
    exponentially, and smoothed with a window no longer than the look-ahead, which keeps the
    result at or below the needed gain everywhere: the output can never exceed the ceiling.
    """
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    la = max(1, int(lookahead_ms * 1e-3 * SR))
    held = ndimage.minimum_filter1d(need, size=2 * la + 1, mode="nearest")
    # exponential release, computed on short blocks to stay fast
    blk = 16
    nb = len(held) // blk + 1
    padded = np.concatenate([held, np.ones(nb * blk - len(held))])
    bmin = padded.reshape(nb, blk).min(axis=1)
    coef = 1 - np.exp(-blk / (release_ms * 1e-3 * SR))
    rel = np.empty(nb)
    g = 1.0
    for i in range(nb):
        g = g + (1.0 - g) * coef
        if bmin[i] < g:
            g = bmin[i]
        rel[i] = g
    # a block's gain must also cover its neighbours before it is interpolated back up
    rel = np.minimum(rel, np.minimum(np.roll(rel, 1), np.roll(rel, -1)))
    gain = np.minimum(np.repeat(rel, blk)[:len(held)], held)
    gain = ndimage.uniform_filter1d(gain, size=la, mode="nearest")
    return gain


def true_peak(x: np.ndarray) -> float:
    """Inter-sample peak, by 4x oversampling."""
    up = signal.resample_poly(x, 4, 1, axis=0)
    return float(np.max(np.abs(up)))


def db(v: float) -> float:
    return 20 * np.log10(max(v, 1e-12))


def loudness(x: np.ndarray) -> dict:
    """EBU R128 measurement with ffmpeg's ebur128 filter: integrated loudness (LUFS), loudness
    range (LU) and true peak (dBTP)."""
    data = np.ascontiguousarray(x, dtype="<f4").tobytes()
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR), "-ac", "2",
                        "-i", "-", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       input=data, capture_output=True)
    text = r.stderr.decode(errors="replace")
    summary = text[text.rfind("Summary:"):]
    out = {}
    for key, pat in [("lufs", r"I:\s+(-?[\d.]+|-inf) LUFS"), ("lra", r"LRA:\s+(-?[\d.]+) LU"),
                     ("true_peak_db", r"Peak:\s+(-?[\d.]+|-inf) dBFS")]:
        m = re.search(pat, summary)
        out[key] = float(m.group(1)) if m and m.group(1) != "-inf" else float("-inf")
    return out


# ---- perceptual level (for balance tables and per-bar loudness curves) -----------------------
def k_weight(x: np.ndarray) -> np.ndarray:
    """The K-weighting filter of ITU-R BS.1770 (the curve behind LUFS) at 44.1 kHz."""
    g, q, fc = 4.0, 1 / np.sqrt(2), 1500.0
    a = 10 ** (g / 40)
    w = 2 * np.pi * fc / SR
    al = np.sin(w) / (2 * q)
    cs = np.cos(w)
    sh = _biquad(a * ((a + 1) + (a - 1) * cs + 2 * np.sqrt(a) * al), -2 * a * ((a - 1) + (a + 1) * cs),
                 a * ((a + 1) + (a - 1) * cs - 2 * np.sqrt(a) * al), (a + 1) - (a - 1) * cs + 2 * np.sqrt(a) * al,
                 2 * ((a - 1) - (a + 1) * cs), (a + 1) - (a - 1) * cs - 2 * np.sqrt(a) * al)
    w = 2 * np.pi * 38.0 / SR
    al = np.sin(w) / (2 * 0.5)
    cs = np.cos(w)
    hp = _biquad((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al)
    return signal.sosfilt(np.vstack([sh, hp]), x, axis=0)


def k_level(xk: np.ndarray) -> float:
    """Ungated loudness in LUFS-like units of an already K-weighted stereo signal."""
    if len(xk) == 0:
        return -120.0
    return float(-0.691 + 10 * np.log10(np.sum(np.mean(xk ** 2, axis=0)) + 1e-12))
