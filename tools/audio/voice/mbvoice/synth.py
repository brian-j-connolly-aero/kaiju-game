"""Speech synthesis. `synthesize(text, voice)` is the one function to replace when better voices
become available: it takes the text to speak and a voice description and returns mono samples
and their sample rate. Everything after it (trimming, radio, broadcast and hall chains, loudness,
encoding, checks) does not care where the samples came from.

A voice description is a dict:
  engine   "kokoro" | "piper" (neural voices, run on the processor with ONNX Runtime) or
           "rhvoice" | "flite" | "pico" | "festival" | "espeak" (the older rule-based and
           statistical synthesizers, kept for comparison)
  voice    the engine's own voice name (kokoro: am_michael, bf_emma, ...; a blend is written
           "am_onyx:7+am_fenrir:3", weights optional; piper: en_GB-alba-medium, ...;
           rhvoice: alan, bdl, clb, slt; flite: rms, slt, awb, kal16; pico: en-US, en-GB;
           festival: its default voice; espeak: e.g. "en-us+m3")
  rate     speaking rate, 1.0 = the engine's default, 0.85 = slower
  pitch    pitch asked of the engine, 1.0 = default (rhvoice, pico and espeak only)
  accent   kokoro only: "us" or "gb" pronunciation (default: from the voice name, b... = gb)
  speaker  piper only: speaker of a multi-speaker voice (name or number)
  noise_scale, noise_w
           piper only: the model's variation in sound and in timing (default: the voice's own)
  shift_st optional: semitones to move pitch and formants together after synthesis (a bigger
           or smaller body), done with a phase vocoder so the length does not change
  pitch_st optional: semitones to move the pitch only (formants kept)

The neural engines download their model files on first use (mbvoice/models.py). Together they
use at most $MB_TTS_THREADS processor threads (default 2: the machine is shared); a tool that
starts worker processes calls split_threads() first so the workers share that budget. Both give
the same samples for the same text every time: Kokoro has no randomness, and Piper's random
generator is seeded from the text and the voice before each line.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import warnings
from pathlib import Path

import numpy as np
import soundfile as sf

from . import SCRATCH

ENGINES = ("kokoro", "piper", "rhvoice", "flite", "pico", "festival", "espeak")
PIPER_SENTENCE_GAP_S = 0.3        # Piper speaks sentence by sentence; this goes between them


# ---------------------------------------------------------------- neural engines (ONNX Runtime)

def tts_threads() -> int:
    """Threads for the speech model in this process."""
    return max(1, int(os.environ.get("MB_TTS_THREADS_EACH") or os.environ.get("MB_TTS_THREADS") or 2))


def split_threads(processes: int) -> None:
    """Share the thread budget ($MB_TTS_THREADS, default 2) among `processes` worker processes.
    Call before starting them; they inherit the setting."""
    total = max(1, int(os.environ.get("MB_TTS_THREADS") or 2))
    os.environ["MB_TTS_THREADS_EACH"] = str(max(1, total // max(1, processes)))


def _session(model: Path):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = tts_threads()
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.log_severity_level = 3
    return ort.InferenceSession(str(model), sess_options=so, providers=["CPUExecutionProvider"])


_KOKORO = None
_G2P: dict[bool, object] = {}


def _kokoro_model():
    global _KOKORO
    if _KOKORO is None:
        from kokoro_onnx import Kokoro
        from .models import path
        _KOKORO = Kokoro.from_session(_session(path("kokoro/kokoro-v1.0.onnx")),
                                      str(path("kokoro/voices-v1.0.bin")))
    return _KOKORO


def _kokoro_g2p(british: bool):
    """misaki, the grapheme-to-phoneme converter Kokoro was trained with: a pronouncing lexicon
    with part-of-speech tags for words spelled alike (spaCy's small English model), and eSpeak NG
    for words the lexicon lacks."""
    if british not in _G2P:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")      # spaCy notes that its English model is one minor version older
            from misaki import en, espeak
            _G2P[british] = en.G2P(trf=False, british=british, fallback=espeak.EspeakFallback(british=british))
    return _G2P[british]


def kokoro_style(spec: str) -> np.ndarray:
    """The style vectors of a Kokoro voice, or the weighted average of several ("a:7+b:3")."""
    k = _kokoro_model()
    parts = []
    for item in spec.split("+"):
        name, _, w = item.strip().partition(":")
        if name not in k.voices:
            raise ValueError(f"kokoro has no voice {name!r}")
        parts.append((k.voices[name].astype(np.float64), float(w or 1.0)))
    total = sum(w for _, w in parts)
    return (sum(v * w for v, w in parts) / total).astype(np.float32)


def kokoro_phonemes(text: str, voice: dict) -> str:
    first = voice["voice"].split("+")[0].strip()
    accent = voice.get("accent") or ("gb" if first.startswith("b") else "us")
    ps, tokens = _kokoro_g2p(accent == "gb")(text)
    unknown = [t.text for t in tokens if t.phonemes and "❓" in t.phonemes]
    if unknown or "❓" in ps:
        raise RuntimeError(f"kokoro: no pronunciation for {unknown or text!r}")
    return ps


def _kokoro(text: str, voice: dict) -> tuple[np.ndarray, int]:
    k = _kokoro_model()
    audio, sr = k.create(kokoro_phonemes(text, voice), voice=kokoro_style(voice["voice"]),
                         speed=float(voice.get("rate", 1.0)), is_phonemes=True, trim=False)
    return np.asarray(audio, dtype=np.float64), int(sr)


def _piper(text: str, voice: dict) -> tuple[np.ndarray, int]:
    import onnxruntime as ort
    from piper import PiperVoice, SynthesisConfig
    from piper.config import PiperConfig
    from .models import path
    name = voice["voice"]
    cfg = PiperConfig.from_dict(json.loads(path(f"piper/{name}.onnx.json").read_text()))
    speaker = voice.get("speaker")
    if isinstance(speaker, str):
        speaker = cfg.speaker_id_map[speaker]
    # Piper draws random numbers for the sound and the timing of each phoneme. Seeding the
    # generator and starting a fresh session per line makes a line come out the same every time,
    # whatever was spoken before it in the same process.
    seed = int.from_bytes(hashlib.sha256(json.dumps([text, voice], sort_keys=True).encode()).digest()[:4], "little")
    ort.set_seed(seed)
    pv = PiperVoice(config=cfg, session=_session(path(f"piper/{name}.onnx")))
    syn = SynthesisConfig(speaker_id=speaker, length_scale=cfg.length_scale / float(voice.get("rate", 1.0)),
                          noise_scale=voice.get("noise_scale"), noise_w_scale=voice.get("noise_w"),
                          normalize_audio=False)
    gap = np.zeros(int(PIPER_SENTENCE_GAP_S * cfg.sample_rate))
    parts = []
    for chunk in pv.synthesize(text, syn):
        if parts:
            parts.append(gap)
        parts.append(chunk.audio_float_array.astype(np.float64))
    if not parts:
        raise RuntimeError(f"piper returned no audio for {text!r}")
    return np.concatenate(parts), int(cfg.sample_rate)


# ---------------------------------------------------------------- older synthesizers (command line)


def _run(cmd: list[str], stdin: str | None = None) -> None:
    r = subprocess.run(cmd, input=stdin, text=True, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed ({r.returncode}): {r.stderr.strip()[:400]}")


def _xml(text: str) -> str:
    return text.replace("&", "and").replace("<", " ").replace(">", " ")


def _engine_wav(text: str, voice: dict, out: Path) -> None:
    engine = voice["engine"]
    name = voice.get("voice", "")
    rate = float(voice.get("rate", 1.0))
    pitch = float(voice.get("pitch", 1.0))
    if engine == "rhvoice":
        _run(["RHVoice-test", "-p", name, "-r", str(int(round(rate * 100))),
              "-t", str(int(round(pitch * 100))), "-o", str(out)], stdin=text + "\n")
    elif engine == "flite":
        _run(["flite", "-voice", name, "--setf", f"duration_stretch={1.0 / rate:.4f}",
              "-t", text, "-o", str(out)])
    elif engine == "pico":
        marked = (f"<pitch level='{int(round(pitch * 100))}'><speed level='{int(round(rate * 100))}'>"
                  f"{_xml(text)}</speed></pitch>")
        _run(["pico2wave", "-l", name, "-w", str(out), marked])
    elif engine == "festival":
        _run(["text2wave", "-eval", f"(Parameter.set 'Duration_Stretch {1.0 / rate:.4f})",
              "-o", str(out)], stdin=text + "\n")
    elif engine == "espeak":
        _run(["espeak-ng", "-v", name, "-s", str(int(round(175 * rate))),
              "-p", str(int(np.clip(round(50 * pitch), 0, 99))), "-w", str(out), text])
    else:
        raise ValueError(f"unknown speech engine {engine!r}")


def synthesize(text: str, voice: dict) -> tuple[np.ndarray, int]:
    """Speak `text` with `voice`. Returns (mono float64 samples in -1..1, sample rate)."""
    if voice["engine"] == "kokoro":
        x, sr = _kokoro(text, voice)
    elif voice["engine"] == "piper":
        x, sr = _piper(text, voice)
    else:
        SCRATCH.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(suffix=".wav", dir=SCRATCH, delete=False) as tmp:
            path = Path(tmp.name)
        try:
            _engine_wav(text, voice, path)
            x, sr = sf.read(str(path), dtype="float64", always_2d=False)
        finally:
            path.unlink(missing_ok=True)
    if x.ndim == 2:
        x = x.mean(axis=1)
    if len(x) == 0:
        raise RuntimeError(f"{voice['engine']} returned no audio for {text!r}")
    shift = float(voice.get("shift_st", 0.0))
    pitch_only = float(voice.get("pitch_st", 0.0))
    if shift or pitch_only:
        from pedalboard import time_stretch
        y = x.astype(np.float32)[None, :]
        if shift:
            y = time_stretch(y, float(sr), 1.0, shift, preserve_formants=False)
        if pitch_only:
            y = time_stretch(y, float(sr), 1.0, pitch_only, preserve_formants=True)
        x = y[0].astype(np.float64)
    return x, int(sr)
