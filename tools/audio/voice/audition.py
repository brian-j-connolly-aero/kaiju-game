#!/opt/mbtools/venv/bin/python
"""Audition of every installed synthesizer voice on the real script.

  audition.py raw                 every main voice on all lines, unprocessed
  audition.py espeak              every espeak-ng variant on a 24-line sample
  audition.py summary             collect the per-voice results into docs/audio/voice/audition.json

For each voice: synthesize, trim, transcribe with pocketsphinx, count word errors against the
subtitle text; also pitch, speaking rate and bandwidth. Results are cached per voice in
$MB_SCRATCH/audition/ so an interrupted run resumes."""

from __future__ import annotations

import json
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import DOC_DIR, SCRATCH, asr, dsp  # noqa: E402
from mbvoice.script import load_lines  # noqa: E402
from mbvoice.synth import synthesize  # noqa: E402

AUD = SCRATCH / "audition"

MAIN = {
    "rhvoice alan": {"engine": "rhvoice", "voice": "alan"},
    "rhvoice bdl": {"engine": "rhvoice", "voice": "bdl"},
    "rhvoice clb": {"engine": "rhvoice", "voice": "clb"},
    "rhvoice slt": {"engine": "rhvoice", "voice": "slt"},
    "rhvoice evgeniy-eng": {"engine": "rhvoice", "voice": "evgeniy-eng"},
    "flite rms": {"engine": "flite", "voice": "rms"},
    "flite slt": {"engine": "flite", "voice": "slt"},
    "flite awb": {"engine": "flite", "voice": "awb"},
    "flite kal16": {"engine": "flite", "voice": "kal16"},
    "pico en-US": {"engine": "pico", "voice": "en-US"},
    "pico en-GB": {"engine": "pico", "voice": "en-GB"},
    "festival slt (hts)": {"engine": "festival", "voice": "cmu_us_slt_arctic_hts"},
    "espeak en-us": {"engine": "espeak", "voice": "en-us"},
    "espeak en-gb": {"engine": "espeak", "voice": "en-gb"},
    "espeak en-gb-x-rp": {"engine": "espeak", "voice": "en-gb-x-rp"},
    "espeak en-gb-scotland": {"engine": "espeak", "voice": "en-gb-scotland"},
}


def espeak_variants() -> dict:
    import subprocess
    out = subprocess.run(["espeak-ng", "--voices=variant"], capture_output=True, text=True).stdout
    names = []
    for row in out.splitlines()[1:]:
        cols = row.split()
        if len(cols) >= 5 and cols[4].startswith("!v/"):
            names.append(cols[4][3:])
    return {f"espeak en-us+{n}": {"engine": "espeak", "voice": f"en-us+{n}"} for n in sorted(set(names))}


def audition_one(args) -> dict:
    name, voice, lines = args
    AUD.mkdir(parents=True, exist_ok=True)
    cache = AUD / (name.replace(" ", "_").replace("+", "-").replace("/", "_") + f"_{len(lines)}.json")
    if cache.exists():
        return json.loads(cache.read_text())
    errs = words = 0
    f0s, durs, rolls = [], [], []
    per_line = {}
    failed = 0
    for line in lines:
        try:
            x, sr = synthesize(line["text"], voice)
        except Exception as e:  # an engine that cannot speak a line is itself a finding
            failed += 1
            per_line[line["id"]] = {"error": str(e)[:200]}
            words += len(asr.normalize(line["text"]))
            errs += len(asr.normalize(line["text"]))
            continue
        x = dsp.trim(x, sr)
        hyp = asr.transcribe(x, sr)
        e, n = asr.word_errors(line["text"], hyp)
        errs += e
        words += n
        f = dsp.f0_track(x, sr)
        if len(f):
            f0s.append(f)
        durs.append((len(x) / sr, n))
        rolls.append(dsp.rolloff(x, sr, 0.99))
        per_line[line["id"]] = {"hyp": hyp, "errors": e, "words": n, "seconds": round(len(x) / sr, 3)}
    f0 = np.concatenate(f0s) if f0s else np.array([0.0])
    res = {
        "name": name, "voice": voice, "lines": len(lines), "failed": failed,
        "wer": round(errs / max(words, 1), 4), "errors": errs, "words": words,
        "f0_median_hz": round(float(np.median(f0)), 1),
        "f0_p10_hz": round(float(np.percentile(f0, 10)), 1),
        "f0_p90_hz": round(float(np.percentile(f0, 90)), 1),
        "words_per_second": round(sum(n for _, n in durs) / max(sum(d for d, _ in durs), 1e-9), 2),
        "sample_rate": sr if durs else 0,
        "rolloff99_hz": round(float(np.median(rolls)), 0) if rolls else 0,
        "per_line": per_line,
    }
    cache.write_text(json.dumps(res))
    return res


def run(cands: dict, lines: list[dict], procs: int = 2) -> list[dict]:
    jobs = [(n, v, lines) for n, v in cands.items()]
    out = []
    with Pool(procs) as pool:
        for res in pool.imap_unordered(audition_one, jobs):
            print(f"{res['name']:28s} WER {100 * res['wer']:5.1f}%  F0 {res['f0_median_hz']:6.1f} Hz  "
                  f"{res['words_per_second']:.2f} words/s  top {res['rolloff99_hz']:.0f} Hz  failed {res['failed']}",
                  flush=True)
            out.append(res)
    return out


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "raw"
    lines = load_lines()
    sample = lines[::8][:24]
    if mode == "raw":
        run(MAIN, lines)
    elif mode == "espeak":
        run(espeak_variants(), sample)
    elif mode == "summary":
        res = {"main": [], "espeak_variants": []}
        for r in run(MAIN, lines, 1):
            r.pop("per_line")
            res["main"].append(r)
        for r in run(espeak_variants(), sample, 1):
            r.pop("per_line")
            res["espeak_variants"].append(r)
        res["main"].sort(key=lambda r: r["wer"])
        res["espeak_variants"].sort(key=lambda r: r["wer"])
        DOC_DIR.mkdir(parents=True, exist_ok=True)
        (DOC_DIR / "audition.json").write_text(json.dumps(res, indent=1) + "\n")
        print("wrote", DOC_DIR / "audition.json")


if __name__ == "__main__":
    main()
