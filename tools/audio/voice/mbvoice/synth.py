"""Speech synthesis. `synthesize(text, voice)` is the one function to replace when better
(for example neural) voices become available: it takes the text to speak and a voice description
and returns mono samples and their sample rate. Everything after it (trimming, radio, broadcast
and hall chains, loudness, encoding, checks) does not care where the samples came from.

A voice description is a dict:
  engine   "rhvoice" | "flite" | "pico" | "festival" | "espeak"
  voice    the engine's own voice name (rhvoice: alan, bdl, clb, slt; flite: rms, slt, awb, kal16;
           pico: en-US, en-GB; festival: its default voice; espeak: e.g. "en-us+m3")
  rate     speaking rate, 1.0 = the engine's default, 0.85 = slower
  pitch    pitch asked of the engine, 1.0 = default (flite and festival ignore it)
  shift_st optional: semitones to move pitch and formants together after synthesis (a bigger
           or smaller body), done with a phase vocoder so the length does not change
  pitch_st optional: semitones to move the pitch only (formants kept)
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from . import SCRATCH

ENGINES = ("rhvoice", "flite", "pico", "festival", "espeak")


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
