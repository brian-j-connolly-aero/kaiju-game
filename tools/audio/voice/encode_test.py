#!/opt/mbtools/venv/bin/python
"""What do lower encoder qualities cost? Encodes the finished masters of the last build at several
Vorbis and MP3 qualities and measures each result against its master.

  encode_test.py run [--jobs 2]     encode and measure every master in $MB_SCRATCH/wav
                                    (run tools/audio/voice/build.sh --force first so they are all there)
  encode_test.py summary            write docs/audio/voice/encoding.json (the table in VOICE.md section 6)

Per setting: total size, bit rate, word error rate of the speech recognizer on the decoded files
(all lines, and the radio lines on their own, which suffer first), the signal-to-noise ratio
against the master, and the highest true peak (lossy encoders overshoot more the fewer bits they
have; the build's limit is -0.5 dBTP). Encoded files go to $MB_SCRATCH/encode_test, never the
repository. The settings the build uses are OGG_QUALITY and MP3_QUALITY in mbvoice/pipeline.py."""

from __future__ import annotations

import json
import subprocess
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import DOC_DIR, SCRATCH, SR, asr, dsp  # noqa: E402
from mbvoice.pipeline import MP3_QUALITY, OGG_QUALITY, decode  # noqa: E402
from mbvoice.script import load_lines  # noqa: E402

WAV = SCRATCH / "wav"
OUT = SCRATCH / "encode_test"
RESULTS = OUT / "results.json"
SETTINGS = [("ogg", q) for q in ("3", "2", "1", "0")] + [("mp3", q) for q in ("5", "6", "7", "8")]
RADIO = ("Overlord", "Granite", "Beacon", "Tempest")


def one(job: tuple[dict, str, str]) -> dict:
    line, ext, q = job
    wav = WAV / f"{line['id']}.wav"
    x, _ = sf.read(str(wav), dtype="float64", always_2d=False)
    ch = 1 if x.ndim == 1 else x.shape[1]
    folder = OUT / f"{ext}{q}"
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / f"{line['id']}.{ext}"
    common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-map_metadata", "-1",
              "-ar", str(SR), "-ac", str(ch), "-bitexact"]
    if ext == "ogg":
        subprocess.run(common + ["-c:a", "libvorbis", "-q:a", q, str(out)], check=True)
    else:
        subprocess.run(common + ["-c:a", "libmp3lame", "-q:a", q, "-id3v2_version", "0", "-write_xing", "1",
                                 str(out)], check=True)
    y = decode(out)
    n = min(len(x), len(y))
    noise = y[:n] - x[:n]
    errors, words = asr.word_errors(line["text"], asr.transcribe(y, SR))
    return {"id": line["id"], "format": ext, "quality": q, "speaker": line["speaker"],
            "bytes": out.stat().st_size, "seconds": len(x) / SR, "words": words, "errors": errors,
            "snr_db": float(10 * np.log10(np.sum(x[:n] ** 2) / (np.sum(noise ** 2) + 1e-20))),
            "true_peak_db": float(dsp.true_peak_db(y, SR))}


def run(jobs: int) -> None:
    lines = [l for l in load_lines() if (WAV / f"{l['id']}.wav").exists()]
    if not lines:
        raise SystemExit(f"no masters in {WAV}: run tools/audio/voice/build.sh --force first")
    todo = [(l, ext, q) for ext, q in SETTINGS for l in lines]
    print(f"encode test: {len(lines)} masters x {len(SETTINGS)} settings")
    with Pool(max(1, jobs)) as pool:
        results = pool.map(one, todo, chunksize=8)
    OUT.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(results) + "\n")
    print(f"wrote {RESULTS}; now run: encode_test.py summary")


def _wer(rs: list[dict]) -> float:
    return round(100.0 * sum(r["errors"] for r in rs) / max(1, sum(r["words"] for r in rs)), 1)


def summary() -> None:
    if not RESULTS.exists():
        raise SystemExit("no results yet: run encode_test.py run")
    results = json.loads(RESULTS.read_text())
    rows = []
    for ext, q in SETTINGS:
        rs = [r for r in results if r["format"] == ext and r["quality"] == q]
        if not rs:
            continue
        size = sum(r["bytes"] for r in rs)
        rows.append({
            "format": ext, "quality": q,
            "shipped": q == (OGG_QUALITY if ext == "ogg" else MP3_QUALITY),
            "lines": len(rs),
            "megabytes": round(size / 1e6, 2),
            "kbit_per_s": round(size * 8 / sum(r["seconds"] for r in rs) / 1000, 1),
            "wer_all": _wer(rs),
            "wer_radio": _wer([r for r in rs if r["speaker"] in RADIO]),
            "wer_by_speaker": {s: _wer([r for r in rs if r["speaker"] == s])
                               for s in sorted({r["speaker"] for r in rs})},
            "snr_median_db": round(float(np.median([r["snr_db"] for r in rs])), 1),
            "snr_min_db": round(min(r["snr_db"] for r in rs), 1),
            "true_peak_max_db": round(max(r["true_peak_db"] for r in rs), 2),
            "lines_above_minus_1_dbtp": sum(1 for r in rs if r["true_peak_db"] > -1.0),
        })
    DOC_DIR.mkdir(parents=True, exist_ok=True)
    (DOC_DIR / "encoding.json").write_text(json.dumps({"settings": rows}, indent=1) + "\n")
    print(f"{'setting':8s} {'MB':>6s} {'kbit/s':>7s} {'WER all':>8s} {'WER radio':>10s} {'SNR med':>8s} {'peak max':>9s}")
    for r in rows:
        print(f"{r['format'] + ' ' + r['quality']:8s} {r['megabytes']:6.2f} {r['kbit_per_s']:7.1f} {r['wer_all']:8.1f} "
              f"{r['wer_radio']:10.1f} {r['snr_median_db']:8.1f} {r['true_peak_max_db']:9.2f}"
              + ("   <- the build uses this" if r["shipped"] else ""))


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("run", "summary"):
        raise SystemExit(__doc__)
    if sys.argv[1] == "run":
        jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 2
        run(jobs)
    else:
        summary()
    return 0


if __name__ == "__main__":
    sys.exit(main())
