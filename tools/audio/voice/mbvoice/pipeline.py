"""One voice line from text to encoded files: synthesize, trim, tame pauses, run the speaker's
chain, normalize loudness, limit, encode to .ogg and .mp3."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from . import OUT_DIR, SCRATCH, SR, asr, dsp
from .chains import apply_chain, chain_config
from .script import spoken_text
from .synth import synthesize

TARGET_LUFS = -16.0
CEILING_DBTP = -1.5
# Encoder settings, chosen by measurement (encode_test.py; table in docs/audio/VOICE.md section 6):
# one step below the first build's 3 and 5. Lower settings are smaller still but are not free on
# the whole script: the recognizer loses more words on the radio voices from Vorbis 1 and MP3 7
# down, and Vorbis 0 overshoots the true-peak limit of the checks.
OGG_QUALITY = "2"          # libvorbis -q:a
MP3_QUALITY = "6"          # libmp3lame -q:a (variable bit rate)

_CODE = ("synth.py", "chains.py", "dsp.py", "pipeline.py")


def code_fingerprint() -> str:
    h = hashlib.sha256()
    here = Path(__file__).resolve().parent
    for name in _CODE:
        h.update((here / name).read_bytes())
    return h.hexdigest()[:16]


def line_plan(line: dict, cast: dict, pron: dict) -> dict:
    """Everything that decides how a line sounds. Its hash is the rebuild key."""
    if line["speaker"] not in cast["speakers"]:
        raise SystemExit(f"cast.json has no speaker {line['speaker']!r} (line {line['id']})")
    sp = cast["speakers"][line["speaker"]]
    voice = dict(sp["voice"])
    chain = sp["chain"]
    plan = {
        "text": spoken_text(line, voice, pron),
        "voice": voice,
        "chain": chain,
        "chain_cfg": chain_config(chain, sp.get("chain_settings")),
        "max_pause_ms": sp.get("max_pause_ms", 320),
        "min_pause_ms": sp.get("min_pause_ms", 0),
        "target_lufs": TARGET_LUFS,
        "ceiling_dbtp": CEILING_DBTP,
        "encode": [OGG_QUALITY, MP3_QUALITY],
        "code": code_fingerprint(),
    }
    plan["hash"] = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()[:20]
    return plan


def raw_speech(text: str, voice: dict, max_pause_ms: float, min_pause_ms: float = 0) -> np.ndarray:
    """Synthesized, trimmed speech at 44.1 kHz with sentence pauses kept within bounds."""
    x, sr = synthesize(text, voice)
    x = dsp.trim(x, sr)
    x = dsp.limit_pauses(x, sr, max_pause_ms, min_pause_ms)
    x = dsp.resample(x, sr, SR)
    return x / (np.max(np.abs(x)) + 1e-12) * 0.8


def master(y: np.ndarray) -> np.ndarray:
    """Gain to the loudness target, then a true-peak limiter; repeated so the result holds both."""
    for _ in range(4):
        y = y * dsp.gain(TARGET_LUFS - dsp.lufs(y, SR))
        if dsp.true_peak_db(y, SR) <= CEILING_DBTP + 0.05:
            break
        y = dsp.limit(y, SR, CEILING_DBTP)
    if dsp.true_peak_db(y, SR) > CEILING_DBTP + 0.05:
        y = dsp.limit(y, SR, CEILING_DBTP)
    return y


def render(line: dict, plan: dict) -> tuple[np.ndarray, np.ndarray, tuple[float, float]]:
    """Returns (raw speech, finished clip, (speech start, speech end) in the finished clip)."""
    raw = raw_speech(plan["text"], plan["voice"], plan["max_pause_ms"], plan["min_pause_ms"])
    seed = int.from_bytes(hashlib.sha256(line["id"].encode()).digest()[:8], "little")
    rng = np.random.default_rng(seed)
    y, span = apply_chain(plan["chain"], raw, plan["chain_cfg"], rng)
    return raw, master(y), span


def encode(y: np.ndarray, line_id: str) -> None:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wav = SCRATCH / "wav" / f"{line_id}.wav"
    wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(wav), y, SR, subtype="PCM_24")
    channels = 1 if y.ndim == 1 else y.shape[1]
    base = OUT_DIR / line_id
    common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-map_metadata", "-1",
              "-ar", str(SR), "-ac", str(channels), "-bitexact"]
    subprocess.run(common + ["-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(base) + ".ogg"], check=True)
    subprocess.run(common + ["-c:a", "libmp3lame", "-q:a", MP3_QUALITY, "-id3v2_version", "0",
                             "-write_xing", "1", str(base) + ".mp3"], check=True)


def decode(path: Path) -> np.ndarray:
    """Decode with ffmpeg at the file's own channel count. Returns (n,) or (n, 2) float64."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                            "stream=channels,sample_rate", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, check=True).stdout.strip().split(",")
    rate, ch = int(probe[0]), int(probe[1])
    if rate != SR:
        raise RuntimeError(f"{path.name}: sample rate {rate}, expected {SR}")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le",
                        "-acodec", "pcm_f32le", "-"], capture_output=True, check=True)
    x = np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
    return x.reshape(-1, ch) if ch > 1 else x


def build_line(job: tuple[dict, dict]) -> dict:
    """Worker: render, encode and transcribe one line. Returns its state record."""
    line, plan = job
    raw, y, span = render(line, plan)
    encode(y, line["id"])
    hyp_raw = asr.transcribe(raw, SR)
    hyp_proc = asr.transcribe(y, SR)
    e_raw, n = asr.word_errors(line["text"], hyp_raw)
    e_proc, _ = asr.word_errors(line["text"], hyp_proc)
    f0 = dsp.f0_track(raw, SR)
    return {
        "id": line["id"],
        "hash": plan["hash"],
        "spoken": plan["text"],
        "duration": round(len(y) / SR, 3),
        "speech": [round(span[0], 3), round(span[1], 3)],
        "words": n,
        "f0_median_hz": round(float(np.median(f0)), 1) if len(f0) else 0.0,
        "raw": {"hyp": hyp_raw, "errors": e_raw},
        "processed": {"hyp": hyp_proc, "errors": e_proc},
    }
