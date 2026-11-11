"""Renders one part to audio with fluidsynth and FluidR3_GM. Renders are cached by content."""
from __future__ import annotations

import hashlib
import io
import os
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from . import tuning
from .score import SEC_PER_BEAT, Part

SR = 44100
SOUNDFONT = os.environ.get("MB_SOUNDFONT", "/usr/share/sounds/sf2/FluidR3_GM.sf2")
SCRATCH = Path(os.environ.get("MB_SCRATCH", "/tmp/mb-scratch/music"))
SYNTH_GAIN = 0.5


def _render_midi(mid, n: int, label: str) -> np.ndarray:
    buf = io.BytesIO()
    mid.save(file=buf)
    key = hashlib.sha1(buf.getvalue() + f"|{SYNTH_GAIN}|{SR}|{n}".encode()).hexdigest()[:20]
    cache = SCRATCH / "parts"
    cache.mkdir(parents=True, exist_ok=True)
    wav = cache / f"{key}.wav"
    if not wav.exists():
        midi_path = cache / f"{key}.mid"
        midi_path.write_bytes(buf.getvalue())
        tmp = cache / f"{key}.tmp.wav"
        cmd = ["fluidsynth", "-ni", "-q", "-r", str(SR), "-g", str(SYNTH_GAIN), "-R", "0", "-C", "0",
               "-O", "float", "-T", "wav", "-o", "synth.polyphony=512", "-F", str(tmp),
               SOUNDFONT, str(midi_path)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not tmp.exists():
            raise RuntimeError(f"fluidsynth failed for {label}: {r.stderr[-400:]}")
        tmp.rename(wav)
    x, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    assert sr == SR
    if len(x) < n:
        x = np.vstack([x, np.zeros((n - len(x), 2), dtype=np.float32)])
    return x[:n]


def render_part(part: Part, total_beats: float, tail_seconds: float, seed_text: str) -> np.ndarray:
    """Dry stereo render of one part: exactly (total_beats + tail) long, float32, no effects.

    The soundfont's samples are not all in tune (see tuning.py), so the part's notes are
    grouped by the correction their key needs and each group is rendered with that fine-tune
    offset; the groups are then summed."""
    n = int(round((total_beats * SEC_PER_BEAT + tail_seconds) * SR))
    out = np.zeros((n, 2), dtype=np.float32)
    if not part.notes:
        return out
    beats = total_beats + tail_seconds / SEC_PER_BEAT
    groups: dict[int, list] = {}
    for note in part.timed_notes(seed_text):
        cents = part.tune
        if part.inst.pitched and not part.inst.drums:
            cents -= tuning.deviation(part.inst, note[2])
        groups.setdefault(int(round(cents)), []).append(note)
    for cents, notes in sorted(groups.items()):
        out += _render_midi(part.to_midi(beats, notes, cents), n, part.name)
    return out
