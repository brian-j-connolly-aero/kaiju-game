"""Raw generator output -> mastered file -> .ogg and .mp3.

One-shots: rumble filter, trim, short fades at both ends, loudness to the sound's target,
look-ahead limiter. The sound starts at the first sample (impacts are on time).

Loops use the same layout as the music (all times whole samples at 44.1 kHz):

    [ lead-in 0.25 s ][ loop body ][ pad 0.25 s ]
      loop start = 0.25 s            loop end = 0.25 s + body

The lead-in is the end of the body (faded in) and the pad is its beginning (faded out), so the
audio is periodic on both sides of both loop points. A decoder that shifts the audio by a few
milliseconds (MP3 decoders differ in how they trim encoder delay) still loops without a click.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from . import dsp
from .dsp import SR
from .registry import Spec

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = REPO / "client/public/assets/audio/sfx"
MANIFEST = REPO / "client/public/assets/manifest.sfx.json"
SCRATCH = Path("/tmp/mb-scratch/sfx")
MASTERS = SCRATCH / "masters"

LEAD_IN = 0.25            # seconds before the loop start
PAD = 0.25                # seconds after the loop end
EDGE_KEEP = 0.08          # seconds next to each loop point that stay unfaded
CEILING_DB = -2.0         # limiter and clipper ceiling for the master
MAX_CLIP_DB = 7.0         # impacts may run this far into the soft clipper, no further
SHIP_PEAK_DB = -1.0       # decoded files must stay under this
RUMBLE_HZ = 20.0          # everything below is removed (also removes any DC offset)
FADE_IN = 0.0008          # one-shots: 35 samples, keeps the transient
FADE_OUT = 0.02
TRIM_DB = -66.0           # one-shots end 30 ms after the tail falls this far below the peak
TAIL_PAD = 0.006          # then a few ms of silence (the Vorbis encoder may drop the last 128 samples)
OGG_QUALITY = "5"         # libvorbis -q:a
MP3_QUALITY = "2"         # libmp3lame -q:a (variable bit rate)


def _rumble(x: np.ndarray) -> np.ndarray:
    return dsp.hp(x, RUMBLE_HZ, 2)


def master_oneshot(x: np.ndarray, spec: Spec) -> tuple[np.ndarray, dict]:
    x = _rumble(np.asarray(x, dtype=float))
    mag = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    above = np.nonzero(mag > mag.max() * dsp.amp(TRIM_DB))[0]
    end = min(len(x), int(above[-1]) + dsp.n_(0.03)) if len(above) else len(x)
    x = x[:max(end, dsp.n_(0.02))]
    x = dsp.fade(x, FADE_IN, min(FADE_OUT, 0.25 * len(x) / SR))
    gain = dsp.amp(spec.level - dsp.level_short(x))
    ceiling = dsp.amp(CEILING_DB)
    y, reduction, over = x * gain, 0.0, 0.0
    for _ in range(6):
        y = x * gain
        over = max(0.0, dsp.db(np.max(np.abs(y))) - CEILING_DB)
        if spec.clip:
            y = dsp.soft_clip(y, ceiling)
        y, reduction = dsp.limiter(y, ceiling)
        err = spec.level - dsp.level_short(y)
        if abs(err) < 0.05 or over > MAX_CLIP_DB or reduction > 9.0:
            break
        gain *= dsp.amp(err)
    y = np.concatenate([y, np.zeros((dsp.n_(TAIL_PAD),) + y.shape[1:])], axis=0)
    return y, {"limiter_db": round(reduction, 2), "clip_db": round(over if spec.clip else 0.0, 2)}


def master_loop(x: np.ndarray, spec: Spec) -> tuple[np.ndarray, dict]:
    body = dsp.n_(spec.loop)
    assert len(x) == body, f"{spec.id}: loop generator returned {len(x)} samples, expected {body}"
    x = dsp.circular(_rumble, np.asarray(x, dtype=float))
    gain = dsp.amp(spec.level - dsp.level_loop(x))
    ceiling = dsp.amp(CEILING_DB)
    y, reduction = x * gain, 0.0
    for _ in range(4):
        tiled, reduction = dsp.limiter(np.concatenate([x * gain] * 3, axis=0), ceiling)
        y = tiled[body:2 * body]
        err = spec.level - dsp.level_loop(y)
        if abs(err) < 0.05 or reduction > 9.0:
            break
        gain *= dsp.amp(err)
    lead, pad = dsp.n_(LEAD_IN), dsp.n_(PAD)
    reps = 1 + max(lead, pad) // body
    ext = np.concatenate([y] * reps, axis=0)
    head = dsp.fade(ext[-lead:], LEAD_IN - EDGE_KEEP, 0.0)      # end of the body, faded in
    tail = dsp.fade(ext[:pad], 0.0, PAD - EDGE_KEEP)            # start of the body, faded out
    out = np.concatenate([head, y, tail], axis=0)
    return out, {"limiter_db": round(reduction, 2), "clip_db": 0.0}


def loop_points(spec: Spec) -> list[float]:
    return [LEAD_IN, round(LEAD_IN + spec.loop, 6)]


def _encode(wav: Path, base: Path, channels: int) -> None:
    common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-map_metadata", "-1",
              "-ar", str(SR), "-ac", str(channels), "-bitexact"]
    subprocess.run(common + ["-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(base) + ".ogg"], check=True)
    subprocess.run(common + ["-c:a", "libmp3lame", "-q:a", MP3_QUALITY, "-id3v2_version", "0",
                             "-write_id3v1", "0", str(base) + ".mp3"], check=True)


def decode(path: Path) -> np.ndarray:
    """Decode with ffmpeg at the file's own channel count. Returns (n,) or (n, 2) float64."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                            "stream=channels,sample_rate", "-of", "json", str(path)],
                           capture_output=True, check=True, text=True)
    st = json.loads(probe.stdout)["streams"][0]
    ch = int(st["channels"])
    assert int(st["sample_rate"]) == SR, f"{path.name}: sample rate {st['sample_rate']}"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le",
                        "-ar", str(SR), "-ac", str(ch), "-"], capture_output=True, check=True)
    x = np.frombuffer(r.stdout, dtype="<f4").astype(np.float64)
    return x.reshape(-1, 2) if ch == 2 else x


def render(spec: Spec, variant: int, encode: bool = True) -> dict:
    """Generate, master and encode one variant of one sound. Returns what was done."""
    name = spec.names()[variant - 1]
    raw = spec.fn(dsp.rng_for(spec.id, variant), variant)
    assert np.all(np.isfinite(raw)), f"{name}: generator produced non-finite samples"
    y, info = master_loop(raw, spec) if spec.loop else master_oneshot(raw, spec)
    MASTERS.mkdir(parents=True, exist_ok=True)
    wav = MASTERS / f"{name}.wav"
    channels = 2 if y.ndim == 2 else 1
    info.update({"name": name, "id": spec.id, "seconds": round(len(y) / SR, 4), "channels": channels,
                 "trim_db": 0.0})
    if not encode:
        sf.write(wav, y, SR, subtype="PCM_24")
        return info
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = OUT_DIR / name
    trim = 0.0
    for _ in range(4):
        sf.write(wav, y * dsp.amp(-trim), SR, subtype="PCM_24")
        _encode(wav, base, channels)
        worst = max(dsp.db(np.max(np.abs(decode(Path(str(base) + ext))))) for ext in (".ogg", ".mp3"))
        if worst <= SHIP_PEAK_DB - 0.05:
            break
        trim += worst - (SHIP_PEAK_DB - 0.05) + 0.15          # codec overshoot: turn the master down a little
    info["trim_db"] = round(trim, 2)
    return info


def write_manifest(specs: list[Spec]) -> None:
    """The partial manifest: every sound with its variant paths (no extension) and loop points."""
    entries = {}
    for spec in specs:
        e = {"variants": [f"audio/sfx/{name}" for name in spec.names()], "gain": 1}
        if spec.loop:
            e["loop"] = loop_points(spec)
        entries[spec.id] = e
    MANIFEST.write_text(json.dumps({"sfx": entries}, indent=2) + "\n")
