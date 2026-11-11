"""Intonation table for the soundfont.

FluidR3_GM's samples are not all in tune: measured against equal temperament the choir "aah"
is up to half a semitone flat in the men's register, the string ensemble and the timpani
drift by 10 to 20 cents from one sample zone to the next. In unison and octave writing (the
theme is almost always doubled) that is audible as sourness, so every key of every patch is
measured once and the synth corrects each note (see synth.render_part).

The table is generated data (`build.py --measure-tuning`), committed next to this file so a
normal build does not need to redo the measurement. Bells are left alone: their partials are
inharmonic by nature and the strike tone is not the pitch a spectrum fit finds.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

from .orchestra import INSTRUMENTS, Instrument
from .score import BPM, PPQ

SR = 44100
TABLE_PATH = Path(__file__).with_name("tuning_table.json")
STRUCK = {47}                       # timpani: fit the principal partial only
DECAYING = {45, 46, 6, 47, 8}       # plucked or struck: analyse the first half second
SKIP = {14, 9, 116, 119}            # bells, glockenspiel, taiko, reverse cymbal
_table: dict | None = None


def _patch_key(inst: Instrument) -> str:
    return f"{inst.bank}:{inst.program}"


def _estimate(seg: np.ndarray, expect_hz: float, struck: bool) -> tuple[float, float]:
    """Deviation in cents of the sounding pitch from `expect_hz`, and a confidence (how much
    better the best fit is than the average fit)."""
    n = 1 << 18
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    res = SR / n
    cents = np.arange(-70.0, 70.5, 1.0)
    scores = []
    for c in cents:
        f0 = expect_hz * 2 ** (c / 1200)
        harmonics = [1] if struck else [k for k in range(1, 11) if k * f0 < 5000]
        s = 0.0
        for k in harmonics:
            pos = k * f0 / res
            i = int(pos)
            s += (spec[i] * (1 - (pos - i)) + spec[i + 1] * (pos - i)) / np.sqrt(k)
        scores.append(s)
    scores = np.array(scores)
    i = int(np.argmax(scores))
    best = cents[i]
    if 0 < i < len(cents) - 1:                               # parabolic refinement
        a, b, c2 = scores[i - 1], scores[i], scores[i + 1]
        best += 0.5 * (a - c2) / (a - 2 * b + c2 + 1e-12)
    return float(best), float(scores[i] / (np.mean(scores) + 1e-12))


def measure_patch(inst: Instrument, lo: int, hi: int, scratch: Path) -> dict[str, float]:
    """Render every key from lo to hi on its own and measure its pitch."""
    from .synth import SOUNDFONT
    slot_beats = 4.0                                        # 2.5 s per note at 96 BPM
    mid = mido.MidiFile(ticks_per_beat=PPQ)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    ev = [(0, mido.MetaMessage("set_tempo", tempo=int(round(60_000_000 / BPM))))]
    if inst.bank:
        ev.append((0, mido.Message("control_change", channel=0, control=0, value=inst.bank)))
    ev.append((0, mido.Message("program_change", channel=0, program=inst.program)))
    keys = list(range(lo, hi + 1))
    for i, k in enumerate(keys):
        ev.append((int(i * slot_beats * PPQ), mido.Message("note_on", channel=0, note=k, velocity=100)))
        ev.append((int((i * slot_beats + 2.9) * PPQ), mido.Message("note_off", channel=0, note=k, velocity=0)))
    ev.sort(key=lambda e: e[0])
    now = 0
    for tick, msg in ev:
        tr.append(msg.copy(time=tick - now))
        now = tick
    tr.append(mido.MetaMessage("end_of_track", time=int(len(keys) * slot_beats * PPQ) - now))
    scratch.mkdir(parents=True, exist_ok=True)
    base = scratch / f"tune_{inst.bank}_{inst.program}"
    mid.save(str(base) + ".mid")
    subprocess.run(["fluidsynth", "-ni", "-q", "-r", str(SR), "-g", "0.5", "-R", "0", "-C", "0", "-O", "float",
                    "-T", "wav", "-F", str(base) + ".wav", SOUNDFONT, str(base) + ".mid"],
                   check=True, capture_output=True)
    x, _ = sf.read(str(base) + ".wav", dtype="float64", always_2d=True)
    mono = x.mean(axis=1)
    out = {}
    slot = int(slot_beats * 60 / BPM * SR)
    for i, k in enumerate(keys):
        a = i * slot
        if inst.program in DECAYING:
            seg = mono[a + int(0.04 * SR):a + int(0.7 * SR)]
        else:
            seg = mono[a + int(0.4 * SR):a + int(1.7 * SR)]
        hz = 440.0 * 2 ** ((k - 69) / 12)
        cents, conf = _estimate(seg, hz, inst.program in STRUCK)
        out[str(k)] = round(cents, 1) if conf > 1.25 and np.max(np.abs(seg)) > 1e-4 else 0.0
    return out


def measure_all(scratch: Path) -> dict:
    """Measure every pitched patch the orchestra uses, over the union of its instruments' ranges."""
    patches: dict[str, tuple[Instrument, int, int]] = {}
    for inst in INSTRUMENTS.values():
        if inst.drums or not inst.pitched or inst.program in SKIP:
            continue
        key = _patch_key(inst)
        if key in patches:
            _, lo, hi = patches[key]
            patches[key] = (inst, min(lo, inst.lo), max(hi, inst.hi))
        else:
            patches[key] = (inst, inst.lo, inst.hi)
    table = {}
    for key, (inst, lo, hi) in sorted(patches.items()):
        table[key] = measure_patch(inst, lo, hi, scratch)
    TABLE_PATH.write_text(json.dumps(table, indent=0, sort_keys=True) + "\n")
    global _table
    _table = table
    return table


def deviation(inst: Instrument, key: int) -> float:
    """Measured deviation of this key from equal temperament, in cents (0 if unmeasured)."""
    global _table
    if _table is None:
        _table = json.loads(TABLE_PATH.read_text()) if TABLE_PATH.exists() else {}
    return float(_table.get(_patch_key(inst), {}).get(str(key), 0.0))
