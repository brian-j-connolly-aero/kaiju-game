"""The three processing chains (ASSETS.md section 6).

  radio      military speakers: band-pass, compression, light overdrive, a quiet static bed,
             squelch clicks at both ends. Mono.
  broadcast  the news anchor: clean, slightly compressed, a faint studio tone. Mono.
  hall       the committee chair: a large-room reverb. Stereo (the room is wide, the voice is
             in the middle).

Every chain takes trimmed speech at 44.1 kHz and returns the finished clip before loudness
normalization, plus (start, end) of the words inside it in seconds. Noise is seeded per line,
so a rebuild gives the same samples."""

from __future__ import annotations

import numpy as np
from scipy import signal

from . import SR
from .dsp import butter, gain, peaking, shelf

DEFAULTS = {
    "radio": {
        "band_hz": [300.0, 3800.0],      # band-pass corners
        "hp_order": 4,
        "lp_order": 6,
        "presence_db": 4.0,              # small-speaker honk around presence_hz
        "presence_hz": 1900.0,
        "comp_threshold_db": -24.0,      # relative to the clip's peak
        "comp_ratio": 6.0,
        "comp_attack_ms": 2.0,
        "comp_release_ms": 90.0,
        "drive_db": 3.0,                 # into a soft clipper: light overdrive
        "static_db": -30.0,              # static bed between the words, relative to the speech level
        "static_duck_db": 10.0,          # how far the bed drops while a word is spoken (the set's gain control)
        "crackle_per_s": 5.0,
        "squelch_db": -5.0,              # squelch bursts, relative to the speech level
        "open_ms": 55.0,                 # key-up click and burst
        "lead_ms": 35.0,                 # bed only, before the first word
        "tail_ms": 45.0,                 # bed only, after the last word
        "close_ms": 95.0,                # squelch tail and key-off click
    },
    "broadcast": {
        "highpass_hz": 75.0,
        "warmth_db": 1.5,                # low shelf at 200 Hz
        "presence_db": 2.5,              # wide bell at 3.8 kHz
        "air_db": 2.0,                   # high shelf at 6.5 kHz
        "comp_threshold_db": -20.0,
        "comp_ratio": 2.5,
        "comp_attack_ms": 6.0,
        "comp_release_ms": 140.0,
        "tone_db": -44.0,                # studio tone (room noise and faint mains hum), relative to speech level
        "hum_hz": 60.0,
        "lead_ms": 40.0,
        "tail_ms": 90.0,
    },
    "hall": {
        "highpass_hz": 70.0,
        "comp_threshold_db": -20.0,
        "comp_ratio": 2.0,
        "comp_attack_ms": 8.0,
        "comp_release_ms": 160.0,
        "predelay_ms": 28.0,
        "rt60_s": 1.9,                   # decay time of the room below 1 kHz
        "rt60_high_s": 1.0,              # decay time above 3 kHz (air and upholstery)
        "early_db": -18.0,               # early reflections relative to the direct voice
        "wet_db": -12.0,                 # late reverberation energy relative to the direct voice
        "duck_db": 12.0,                 # how far the reverberation drops while a word is spoken
        "ring_s": 1.3,                   # how long the room rings after the last word
        "lead_ms": 30.0,
    },
}


def chain_config(chain: str, overrides: dict | None) -> dict:
    cfg = dict(DEFAULTS[chain])
    for k, v in (overrides or {}).items():
        if k not in cfg:
            raise SystemExit(f"cast.json: unknown {chain} chain setting {k!r}")
        cfg[k] = v
    return cfg


def speech_level(x: np.ndarray) -> float:
    """Root mean square of the active part of the speech (frames within 25 dB of the loudest)."""
    w = 882
    n = len(x) // w
    if n == 0:
        return float(np.sqrt(np.mean(x ** 2)) + 1e-12)
    p = np.mean(x[: n * w].reshape(n, w) ** 2, axis=1)
    keep = p[p > p.max() * 10 ** (-25 / 10)]
    return float(np.sqrt(np.mean(keep)) + 1e-12)


def robust_peak(x: np.ndarray) -> float:
    """The level only one sample in 500 of the active speech exceeds: a peak measure that a
    single stray pulse cannot move."""
    w = 882
    n = len(x) // w
    if n == 0:
        return float(np.max(np.abs(x)) + 1e-12)
    fr = x[: n * w].reshape(n, w)
    p = np.mean(fr ** 2, axis=1)
    active = np.abs(fr[p > p.max() * 10 ** (-25 / 10)]).ravel()
    return float(np.percentile(active, 99.8) + 1e-12)


def compress(x: np.ndarray, threshold_db: float, ratio: float, attack_ms: float, release_ms: float,
             lookahead_ms: float = 4.0) -> np.ndarray:
    """Feed-forward compressor with look-ahead (the gain is already down when a word starts, so
    onsets do not punch through). The threshold is relative to the clip's robust peak, so the
    amount of compression does not depend on how loud the synthesizer happened to be. Returns
    the compressed signal scaled so its robust peak is 1."""
    ref = robust_peak(x)
    step = 8                                        # gain computed every 8 samples (0.18 ms)
    n = int(np.ceil(len(x) / step))
    padded = np.zeros(n * step)
    padded[: len(x)] = np.abs(x) / ref
    level = padded.reshape(n, step).max(axis=1)
    la = int(round(SR / step * lookahead_ms / 1000))
    if la > 0:                                      # the detector sees `la` blocks into the future
        from scipy.ndimage import maximum_filter1d
        level = maximum_filter1d(np.concatenate([level, np.zeros(la)]), size=la + 1,
                                 origin=-(la // 2))[: n]
    att = np.exp(-1.0 / (SR / step * attack_ms / 1000))
    rel = np.exp(-1.0 / (SR / step * release_ms / 1000))
    env = np.empty(n)
    cur = 0.0
    for i in range(n):
        v = level[i]
        cur = att * cur + (1 - att) * v if v > cur else rel * cur + (1 - rel) * v
        env[i] = cur
    env_db = 20 * np.log10(np.maximum(env, 1e-6))
    over = np.maximum(0.0, env_db - threshold_db)
    gr_db = -over * (1 - 1 / ratio)
    g = 10 ** (np.interp(np.arange(len(x)), np.arange(n) * step + step / 2, gr_db) / 20)
    y = x * g
    return y / robust_peak(y)


def presence(v: np.ndarray, attack_ms: float = 15.0, release_ms: float = 120.0) -> np.ndarray:
    """0..1 per sample: how much voice there is right now (1 = a word is being spoken, 0 = a
    pause). Rises within `attack_ms`, falls over `release_ms`."""
    step = 64
    n = int(np.ceil(len(v) / step))
    padded = np.zeros(n * step)
    padded[: len(v)] = v
    p = np.sqrt(np.mean(padded.reshape(n, step) ** 2, axis=1))
    level = speech_level(v)
    lev_db = 20 * np.log10(np.maximum(p / level, 1e-6))
    target = np.clip((lev_db + 30.0) / 15.0, 0.0, 1.0)          # -30 dB -> 0, -15 dB -> 1
    att = np.exp(-1.0 / (SR / step * attack_ms / 1000))
    rel = np.exp(-1.0 / (SR / step * release_ms / 1000))
    out = np.empty(n)
    cur = 0.0
    for i in range(n):
        t = target[i]
        cur = att * cur + (1 - att) * t if t > cur else rel * cur + (1 - rel) * t
        out[i] = cur
    return np.interp(np.arange(len(v)), np.arange(n) * step + step / 2, out)


def _noise(rng: np.random.Generator, n: int, lo: float, hi: float) -> np.ndarray:
    w = rng.standard_normal(n + 2000)
    w = butter(w, SR, "bandpass", [lo, hi], 2)[2000:]
    return w / (np.sqrt(np.mean(w ** 2)) + 1e-12)


def _click(rng: np.random.Generator, ms: float = 3.0) -> np.ndarray:
    n = int(SR * ms / 1000)
    t = np.arange(n) / SR
    c = np.sin(2 * np.pi * 1400 * t) * np.exp(-t / 0.0006) + 0.4 * rng.standard_normal(n) * np.exp(-t / 0.0004)
    return c / (np.max(np.abs(c)) + 1e-12)


def radio(x: np.ndarray, cfg: dict, rng: np.random.Generator) -> tuple[np.ndarray, tuple[float, float]]:
    lo, hi = cfg["band_hz"]
    # 1. the voice through the set: band-pass, small-speaker resonance, compressor, soft clip
    v = butter(x, SR, "highpass", lo, cfg["hp_order"])
    v = butter(v, SR, "lowpass", hi, cfg["lp_order"])
    v = peaking(v, SR, cfg["presence_hz"], cfg["presence_db"], 0.9)
    v = compress(v, cfg["comp_threshold_db"], cfg["comp_ratio"], cfg["comp_attack_ms"], cfg["comp_release_ms"])
    # light overdrive: at 0 dB of drive the usual peaks sit in the nearly straight part of
    # the soft clipper (tanh of 0.5); every 6 dB doubles how far they are pushed into the curve
    d = 0.5 * gain(cfg["drive_db"])
    bias = 0.06                                       # slight asymmetry: even harmonics
    v = (np.tanh(d * (v + bias)) - np.tanh(d * bias)) / np.tanh(d)
    v = v - np.mean(v)
    v = butter(v, SR, "highpass", lo, 2)
    v = butter(v, SR, "lowpass", hi * 1.12, 4)        # keep a little of the grit above the corner
    level = speech_level(v)

    n_open = int(SR * cfg["open_ms"] / 1000)
    n_lead = int(SR * cfg["lead_ms"] / 1000)
    n_tail = int(SR * cfg["tail_ms"] / 1000)
    n_close = int(SR * cfg["close_ms"] / 1000)
    total = n_open + n_lead + len(v) + n_tail + n_close
    out = np.zeros(total)
    start = n_open + n_lead
    out[start:start + len(v)] = v

    # 2. static bed for as long as the channel is open: hiss with slow flutter and sparse crackle
    hiss = _noise(rng, total, lo, hi)
    flutter = butter(rng.standard_normal(total + 4000), SR, "lowpass", 6.0, 2)[4000:]
    flutter = flutter / (np.max(np.abs(flutter)) + 1e-12)
    bed = hiss * gain(2.5 * flutter)
    crack = np.zeros(total)
    for _ in range(rng.poisson(cfg["crackle_per_s"] * total / SR)):
        i = int(rng.integers(0, total - 200))
        k = int(rng.integers(20, 120))
        crack[i:i + k] += rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 4)) * rng.uniform(1.5, 4.0)
    duck = np.zeros(total)
    duck[start:start + len(v)] = presence(v)
    fx = (bed + crack) * level * gain(cfg["static_db"] - cfg["static_duck_db"] * duck)

    # 3. squelch: key-up click and a short falling burst; at the end a short squelch tail of
    #    receiver noise that is cut off, and the key-off click
    sq = level * gain(cfg["squelch_db"])
    t = np.arange(n_open) / SR
    fx[:n_open] += sq * _noise(rng, n_open, lo, hi) * np.exp(-t / (cfg["open_ms"] / 1000 / 3.0)) * 1.4
    c = _click(rng)
    fx[: len(c)] += sq * 4.0 * c
    t = np.arange(n_close) / n_close
    shape = np.minimum(1.0, t / 0.12) * (1.0 - 0.35 * t)       # fast rise, slight fall, then cut
    cut = max(2, int(SR * 0.003))
    shape[-cut:] *= np.linspace(1, 0, cut)
    fx[total - n_close:] += sq * _noise(rng, n_close, lo, hi) * shape * 1.25
    c = _click(rng)
    k0 = total - len(c) - int(SR * 0.004)
    fx[k0:k0 + len(c)] += sq * 3.2 * c
    # static and squelch come out of the same small speaker as the voice
    fx = butter(fx, SR, "highpass", lo, cfg["hp_order"])
    fx = butter(fx, SR, "lowpass", hi * 1.12, 4)
    out += fx
    out[:44] *= np.linspace(0, 1, 44)
    out[-132:] *= np.linspace(1, 0, 132)                       # 3 ms: the last sample is zero
    return out, (start / SR, (start + len(v)) / SR)


def broadcast(x: np.ndarray, cfg: dict, rng: np.random.Generator) -> tuple[np.ndarray, tuple[float, float]]:
    v = butter(x, SR, "highpass", cfg["highpass_hz"], 2)
    v = shelf(v, SR, 200.0, cfg["warmth_db"], high=False)
    v = peaking(v, SR, 3800.0, cfg["presence_db"], 0.8)
    v = shelf(v, SR, 6500.0, cfg["air_db"], high=True)
    v = compress(v, cfg["comp_threshold_db"], cfg["comp_ratio"], cfg["comp_attack_ms"], cfg["comp_release_ms"])
    level = speech_level(v)
    n_lead = int(SR * cfg["lead_ms"] / 1000)
    n_tail = int(SR * cfg["tail_ms"] / 1000)
    total = n_lead + len(v) + n_tail
    out = np.zeros(total)
    out[n_lead:n_lead + len(v)] = v
    # studio tone: quiet air-conditioning rumble and hiss with a trace of mains hum
    w = rng.standard_normal(total + 4000)
    room = butter(w, SR, "lowpass", 700.0, 1)[4000:] * 3.0 + butter(w, SR, "bandpass", [700.0, 6000.0], 1)[4000:] * 0.35
    room = room / (np.sqrt(np.mean(room ** 2)) + 1e-12)
    t = np.arange(total) / SR
    hum = np.sin(2 * np.pi * cfg["hum_hz"] * t) + 0.5 * np.sin(2 * np.pi * 2 * cfg["hum_hz"] * t + 0.7) \
        + 0.25 * np.sin(2 * np.pi * 3 * cfg["hum_hz"] * t + 1.9)
    hum = hum / np.sqrt(np.mean(hum ** 2))
    tone = (room + 0.5 * hum) / np.sqrt(1 + 0.25) * level * gain(cfg["tone_db"])
    k_in, k_out = int(SR * 0.02), int(SR * 0.05)
    tone[:k_in] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, k_in))
    tone[-k_out:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k_out))
    out += tone
    return out, (n_lead / SR, (n_lead + len(v)) / SR)


def hall_impulse(cfg: dict, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Impulse responses of the hearing room without the direct sound: (early, late), each
    (n, 2). Early: a dozen discrete reflections off walls, floor and ceiling. Late: decaying
    noise, three bands with their own decay times, left and right uncorrelated."""
    rt, rt_hi = cfg["rt60_s"], cfg["rt60_high_s"]
    n = int(SR * (rt * 1.25 + 0.2))
    pre = int(SR * cfg["predelay_ms"] / 1000)
    early = np.zeros((n, 2))
    # delays in ms after the direct sound for a room about 22 x 14 x 8 m, speaker at a table
    taps = [(11.0, 0.72, -0.5), (17.5, 0.62, 0.6), (23.0, 0.55, -0.8), (31.0, 0.50, 0.3), (38.5, 0.42, 0.9),
            (46.0, 0.40, -0.3), (55.0, 0.34, 0.7), (63.5, 0.30, -0.9), (74.0, 0.26, 0.1), (86.0, 0.22, -0.6),
            (97.0, 0.19, 0.5), (112.0, 0.15, -0.2)]
    for ms, amp, pan in taps:
        i = int(SR * ms / 1000)
        early[i, 0] += amp * np.sqrt(0.5 * (1 - pan)) * (1 if rng.random() > 0.3 else -1)
        early[i, 1] += amp * np.sqrt(0.5 * (1 + pan)) * (1 if rng.random() > 0.3 else -1)
    for ch in range(2):                                # walls absorb treble
        early[:, ch] = butter(early[:, ch], SR, "lowpass", 5200.0, 1)
    t = np.arange(n) / SR
    late = np.zeros((n, 2))
    bands = [("lowpass", 500.0, rt * 1.05), ("bandpass", [500.0, 3000.0], rt), ("highpass", 3000.0, rt_hi)]
    for ch in range(2):
        w = rng.standard_normal(n)
        for kind, f, r in bands:
            late[:, ch] += butter(w, SR, kind, f, 2) * np.exp(-6.908 * t / r)
    # the diffuse field builds up over the first 60 ms after the pre-delay
    build = np.minimum(1.0, np.arange(n) / (SR * 0.06)) ** 1.5
    late *= build[:, None]
    late = np.concatenate([np.zeros((pre, 2)), late])[:n]
    late /= np.sqrt(np.sum(late ** 2) / 2) + 1e-12       # unit energy per channel
    early /= np.sqrt(np.sum(early ** 2) / 2) + 1e-12
    return early, late


def hall(x: np.ndarray, cfg: dict, rng: np.random.Generator) -> tuple[np.ndarray, tuple[float, float]]:
    v = butter(x, SR, "highpass", cfg["highpass_hz"], 2)
    v = compress(v, cfg["comp_threshold_db"], cfg["comp_ratio"], cfg["comp_attack_ms"], cfg["comp_release_ms"])
    early_ir, late_ir = hall_impulse(cfg, rng)
    n_lead = int(SR * cfg["lead_ms"] / 1000)
    n_ring = int(SR * cfg["ring_s"])
    total = n_lead + len(v) + n_ring
    out = np.zeros((total, 2))
    out[n_lead:n_lead + len(v), :] = v[:, None]
    duck = np.zeros(total - n_lead)
    duck[: len(v)] = presence(v, 20.0, 220.0)
    wet_gain = gain(-cfg["duck_db"] * duck)
    for ch in range(2):
        e = signal.fftconvolve(v, early_ir[:, ch])[: total - n_lead]
        l = signal.fftconvolve(v, late_ir[:, ch])[: total - n_lead]
        out[n_lead:n_lead + len(e), ch] += gain(cfg["early_db"]) * e * wet_gain[: len(e)]
        out[n_lead:n_lead + len(l), ch] += gain(cfg["wet_db"]) * l * wet_gain[: len(l)]
    k = int(SR * min(0.5, cfg["ring_s"] * 0.5))           # let the room die away, then close
    out[-k:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k)))[:, None]
    return out, (n_lead / SR, (n_lead + len(v)) / SR)


CHAINS = {"radio": radio, "broadcast": broadcast, "hall": hall}


def apply_chain(chain: str, x: np.ndarray, cfg: dict, rng: np.random.Generator):
    return CHAINS[chain](x, cfg, rng)


