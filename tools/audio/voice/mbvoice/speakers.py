"""How different do the voices on the shared radio channel sound? A speaker-recognition model
(WeSpeaker ResNet34, trained on thousands of real speakers to tell people apart; Apache 2.0) turns
a clip into a voice print, a list of 256 numbers. Two clips of the same person give prints that
point the same way (similarity near 1); two different people give prints far apart (near 0 or
below). Measured on the finished, decoded radio files, so it is what a player hears: the radio
band, the static and the squelch included.

For each radio character the prints of all their lines are averaged. The table compares every
pair of characters, and each character with itself (odd lines against even lines), which is how
close a voice is to itself through the radio: two characters are told apart when their
similarity is well below both of their own."""

from __future__ import annotations

import numpy as np

from .dsp import resample

_SESSION = None


def _session():
    global _SESSION
    if _SESSION is None:
        import onnxruntime as ort
        from .models import path
        from .synth import tts_threads
        so = ort.SessionOptions()
        so.intra_op_num_threads = tts_threads()
        so.inter_op_num_threads = 1
        so.log_severity_level = 3
        _SESSION = ort.InferenceSession(str(path("speaker/voxceleb_resnet34.onnx")), sess_options=so,
                                        providers=["CPUExecutionProvider"])
    return _SESSION


def _mel_banks(num_bins: int = 80, nfft: int = 512, sr: int = 16000, low: float = 20.0) -> np.ndarray:
    """Kaldi's triangular mel filters (the features the model was trained on)."""
    mel = lambda f: 1127.0 * np.log(1.0 + np.asarray(f) / 700.0)
    lo, hi = mel(low), mel(sr / 2)
    delta = (hi - lo) / (num_bins + 1)
    fm = mel(np.arange(nfft // 2) * sr / nfft)
    banks = np.zeros((num_bins, nfft // 2))
    for b in range(num_bins):
        left, center, right = lo + b * delta, lo + (b + 1) * delta, lo + (b + 2) * delta
        up = (fm > left) & (fm <= center)
        down = (fm > center) & (fm < right)
        banks[b, up] = (fm[up] - left) / (center - left)
        banks[b, down] = (right - fm[down]) / (right - center)
    return banks


_BANKS = None


def fbank(x16k: np.ndarray) -> np.ndarray:
    """80 log mel filterbank energies per 10 ms frame, as Kaldi computes them, mean removed."""
    global _BANKS
    if _BANKS is None:
        _BANKS = _mel_banks()
    x = x16k * 32768.0
    n = 1 + (len(x) - 400) // 160
    fr = x[np.arange(400)[None, :] + 160 * np.arange(n)[:, None]].astype(np.float64)
    fr -= fr.mean(axis=1, keepdims=True)
    fr[:, 1:] -= 0.97 * fr[:, :-1].copy()
    fr[:, 0] *= 0.03
    fr *= 0.54 - 0.46 * np.cos(2 * np.pi * np.arange(400) / 399)       # Hamming, as WeSpeaker trains
    power = np.abs(np.fft.rfft(fr, 512)[:, :256]) ** 2
    feats = np.log(np.maximum(power @ _BANKS.T, np.finfo(np.float32).eps))
    return feats - feats.mean(axis=0)


def voice_print(x: np.ndarray, sr: int) -> np.ndarray:
    """Unit-length voice print of a clip."""
    if x.ndim == 2:
        x = x.mean(axis=1)
    y = resample(x, sr, 16000)
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.7
    feats = fbank(y).astype(np.float32)[None]
    e = _session().run(None, {"feats": feats})[0][0].astype(np.float64)
    return e / (np.linalg.norm(e) + 1e-12)


def similarity_table(prints: dict[str, list[np.ndarray]]) -> dict:
    """{"names": [...], "matrix": [[...]]}: cosine similarity of the characters' mean prints; on the
    diagonal, each character's odd lines against its even lines."""
    names = list(prints)
    mean = {}
    for n in names:
        m = np.mean(prints[n], axis=0)
        mean[n] = m / np.linalg.norm(m)
    out = []
    for a in names:
        row = []
        for b in names:
            if a == b and len(prints[a]) < 2:
                row.append(1.0)                       # one line: nothing to compare it with
            elif a == b:
                odd, even = np.mean(prints[a][1::2], axis=0), np.mean(prints[a][0::2], axis=0)
                row.append(round(float(odd @ even / (np.linalg.norm(odd) * np.linalg.norm(even))), 2))
            else:
                row.append(round(float(mean[a] @ mean[b]), 2))
        out.append(row)
    return {"names": names, "matrix": out}
