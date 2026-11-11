"""Speech recognition as a measuring instrument: transcribe a clip with pocketsphinx (generic
US English acoustic model and language model, nothing tuned to our script) and count word errors
against the subtitle text.

Word error rate = (substitutions + deletions + insertions) / words in the reference.
The recognizer is far weaker than a human listener, so the absolute numbers are pessimistic;
they are used to compare voices and processing settings against each other."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from . import SCRATCH, VOICE_DIR
from .dsp import resample

_decoder = None
EXTRA_DICT = VOICE_DIR / "asr_extra.dict"


def _dict_path() -> Path:
    """The stock pronouncing dictionary plus the few script words it lacks (asr_extra.dict)."""
    import pocketsphinx
    base = Path(pocketsphinx.get_model_path()) / "en-us" / "cmudict-en-us.dict"
    if not EXTRA_DICT.exists() or not EXTRA_DICT.read_text().strip():
        return base
    SCRATCH.mkdir(parents=True, exist_ok=True)
    out = SCRATCH / "asr.dict"
    text = base.read_text() + "\n" + EXTRA_DICT.read_text()
    if not out.exists() or out.read_text() != text:
        out.write_text(text)
    return out


def decoder():
    global _decoder
    if _decoder is None:
        from pocketsphinx import Decoder
        _decoder = Decoder(samprate=16000, dict=str(_dict_path()), loglevel="FATAL")
    return _decoder


def known_words() -> set[str]:
    words = set()
    for line in _dict_path().read_text().splitlines():
        if line.strip():
            words.add(re.sub(r"\(\d+\)$", "", line.split()[0]))
    return words


def normalize(text: str) -> list[str]:
    text = text.lower().replace("-", " ")
    text = re.sub(r"\(\d+\)", "", text)
    return re.sub(r"[^a-z' ]+", " ", text).split()


def transcribe(x: np.ndarray, sr: int) -> str:
    if x.ndim == 2:
        x = x.mean(axis=1)
    y = resample(x, sr, 16000)
    peak = np.max(np.abs(y)) + 1e-9
    y = y / peak * 0.7                       # same level for every clip
    pcm = (np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes()
    d = decoder()
    d.reinit_feat()                          # forget the previous clip: results must not depend on order
    d.start_utt()
    d.process_raw(pcm, full_utt=True)
    d.end_utt()
    h = d.hyp()
    return " ".join(normalize(h.hypstr)) if h else ""


def align(ref: list[str], hyp: list[str]) -> tuple[int, list[tuple[str, str | None, str | None]]]:
    """Levenshtein alignment. Returns (errors, [(op, ref word, hyp word)]) with op in
    'ok', 'sub', 'del', 'ins'."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(("ok" if ref[i - 1] == hyp[j - 1] else "sub", ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and d[i, j] == d[i - 1, j] + 1:
            ops.append(("del", ref[i - 1], None))
            i -= 1
        else:
            ops.append(("ins", None, hyp[j - 1]))
            j -= 1
    ops.reverse()
    return int(d[n, m]), ops


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    """(errors, reference word count)."""
    ref = normalize(reference)
    errs, _ = align(ref, normalize(hypothesis))
    return errs, len(ref)


def missed_words(reference: str, hypothesis: str) -> list[str]:
    """Reference words the recognizer did not return (substituted or deleted)."""
    _, ops = align(normalize(reference), normalize(hypothesis))
    return [r for op, r, _ in ops if op in ("sub", "del")]
