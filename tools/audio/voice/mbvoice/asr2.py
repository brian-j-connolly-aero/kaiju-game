"""A second speech recognizer, as a second opinion beside pocketsphinx (asr.py).

pocketsphinx is old and easily thrown: it was made for slow, careful American speech, so it
marks down natural rhythm, an accent or words run together ("we are" heard as "we're") even
where any person would follow. This one is a modern neural recognizer, NVIDIA Parakeet TDT
0.6B v2 (CC BY 4.0), run with sherpa-onnx on the processor. It hears roughly as well as an
attentive listener, so a word it misses is a word worth listening to; a word only pocketsphinx
misses is usually pocketsphinx. It is a measuring instrument only and never touches the audio.

The model files (660 MB) are downloaded on first use (models.py). Word errors are counted the
same way as for pocketsphinx (asr.word_errors)."""

from __future__ import annotations

import numpy as np

from .dsp import resample

_RECOGNIZER = None
_DIR = "asr/parakeet-tdt-0.6b-v2-int8/"
NAME = "Parakeet TDT 0.6B v2"


def _recognizer():
    global _RECOGNIZER
    if _RECOGNIZER is None:
        import sherpa_onnx
        from .models import path
        from .synth import tts_threads
        _RECOGNIZER = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(path(_DIR + "encoder.int8.onnx")), decoder=str(path(_DIR + "decoder.int8.onnx")),
            joiner=str(path(_DIR + "joiner.int8.onnx")), tokens=str(path(_DIR + "tokens.txt")),
            num_threads=tts_threads(), model_type="nemo_transducer", decoding_method="greedy_search")
    return _RECOGNIZER


def fetch() -> None:
    from .models import path
    for name in ("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"):
        path(_DIR + name)


def _spell_numbers(text: str) -> str:
    """The script writes numbers out ("Channel Nine"); this recognizer writes digits."""
    import re
    from num2words import num2words
    return re.sub(r"\d+", lambda m: " " + num2words(int(m.group())) + " ", text)


def transcribe(x: np.ndarray, sr: int) -> str:
    from .asr import normalize
    if x.ndim == 2:
        x = x.mean(axis=1)
    y = resample(x, sr, 16000)
    y = (y / (np.max(np.abs(y)) + 1e-9) * 0.7).astype(np.float32)     # same level for every clip
    rec = _recognizer()
    s = rec.create_stream()
    s.accept_waveform(16000, y)
    rec.decode_stream(s)
    return " ".join(normalize(_spell_numbers(s.result.text)))
