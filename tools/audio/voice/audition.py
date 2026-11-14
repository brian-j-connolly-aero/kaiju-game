#!/opt/mbtools/venv/bin/python
"""Audition of every installed synthesizer voice on the real script.

  audition.py neural              every neural voice (Kokoro, Piper) and the first cast's voices on
                                  a 32-line sample, unprocessed
  audition.py raw                 every older synthesizer voice on all lines, unprocessed
  audition.py espeak              every espeak-ng variant on a 24-line sample
  audition.py summary             collect the per-voice results into docs/audio/voice/audition.json
                                  (a group whose results are not cached here keeps its recorded ones)

For each voice: synthesize, trim, transcribe with pocketsphinx, count word errors against the
subtitle text; also pitch, how much the pitch moves within a line, speaking rate and bandwidth.
Results are cached per voice in $MB_SCRATCH/audition/ so an interrupted run resumes."""

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

# Neural voices: every English Kokoro voice, the Piper voices whose recordings and base model are
# public domain, CC0 or CC BY 4.0 (mbvoice/models.py), and the six voices of the first cast at their
# cast settings, for comparison on the same sample.
_KOKORO_EN = ["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_alloy", "af_nova",
              "af_sky", "af_jessica", "af_river", "am_fenrir", "am_michael", "am_puck", "am_echo", "am_eric",
              "am_liam", "am_onyx", "am_santa", "am_adam", "bf_emma", "bf_isabella", "bf_alice", "bf_lily",
              "bm_fable", "bm_george", "bm_lewis", "bm_daniel"]
_PIPER_EN = ["en_GB-alba-medium", "en_GB-cori-high", "en_US-bryce-medium", "en_US-john-medium",
             "en_US-norman-medium", "en_US-joe-medium", "en_US-mike-medium"]
NEURAL = {
    **{f"kokoro {v}": {"engine": "kokoro", "voice": v} for v in _KOKORO_EN},
    **{f"piper {v}": {"engine": "piper", "voice": v} for v in _PIPER_EN},
    "first cast: Overlord (rhvoice bdl)": {"engine": "rhvoice", "voice": "bdl", "rate": 0.85, "pitch": 0.72},
    "first cast: Granite (flite rms)": {"engine": "flite", "voice": "rms", "rate": 1.06},
    "first cast: Beacon (rhvoice clb)": {"engine": "rhvoice", "voice": "clb", "rate": 1.15},
    "first cast: Tempest (rhvoice alan)": {"engine": "rhvoice", "voice": "alan"},
    "first cast: Anchor (rhvoice slt)": {"engine": "rhvoice", "voice": "slt", "rate": 0.94},
    "first cast: Chair (pico en-US)": {"engine": "pico", "voice": "en-US", "rate": 0.9, "pitch": 0.9, "shift_st": -3.0},
}


def neural_sample(lines: list[dict]) -> list[dict]:
    return lines[::7]


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
    import re
    cache = AUD / (re.sub(r"[^A-Za-z0-9_.-]+", "_", name.replace("+", "-")) + f"_{len(lines)}.json")
    if cache.exists():
        return json.loads(cache.read_text())
    errs = words = 0
    f0s, durs, rolls, spreads = [], [], [], []
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
        if len(f) >= 10:            # how far the pitch moves within the line: 10th to 90th percentile
            spreads.append(12 * np.log2(np.percentile(f, 90) / np.percentile(f, 10)))
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
        "f0_spread_st": round(float(np.median(spreads)), 1) if spreads else 0.0,
        "words_per_second": round(sum(n for _, n in durs) / max(sum(d for d, _ in durs), 1e-9), 2),
        "sample_rate": sr if durs else 0,
        "rolloff99_hz": round(float(np.median(rolls)), 0) if rolls else 0,
        "per_line": per_line,
    }
    cache.write_text(json.dumps(res))
    return res


def run(cands: dict, lines: list[dict], procs: int = 2) -> list[dict]:
    from mbvoice.synth import split_threads
    split_threads(procs)
    jobs = [(n, v, lines) for n, v in cands.items()]
    out = []
    with Pool(procs) as pool:
        for res in pool.imap_unordered(audition_one, jobs):
            print(f"{res['name']:28s} WER {100 * res['wer']:5.1f}%  F0 {res['f0_median_hz']:6.1f} Hz  "
                  f"{res['words_per_second']:.2f} words/s  top {res['rolloff99_hz']:.0f} Hz  failed {res['failed']}",
                  flush=True)
            out.append(res)
    return out


def cached(cands: dict, lines: list[dict]) -> list[dict] | None:
    """The cached results of every candidate, or None if any is missing."""
    import re
    out = []
    for name in cands:
        c = AUD / (re.sub(r"[^A-Za-z0-9_.-]+", "_", name.replace("+", "-")) + f"_{len(lines)}.json")
        if not c.exists():
            return None
        r = json.loads(c.read_text())
        r.pop("per_line", None)
        out.append(r)
    return sorted(out, key=lambda r: r["wer"])


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "raw"
    lines = load_lines()
    sample = lines[::8][:24]
    if mode == "neural":
        run(NEURAL, neural_sample(lines))
    elif mode == "raw":
        run(MAIN, lines)
    elif mode == "espeak":
        run(espeak_variants(), sample)
    elif mode == "summary":
        target = DOC_DIR / "audition.json"
        res = json.loads(target.read_text()) if target.exists() else {}
        for key, cands, ls in (("neural", NEURAL, neural_sample(lines)), ("main", MAIN, lines),
                               ("espeak_variants", espeak_variants(), sample)):
            got = cached(cands, ls)
            if got is not None:
                res[key] = got
            elif key in res:
                print(f"{key}: not every result is cached in {AUD}; keeping the recorded ones")
            else:
                print(f"{key}: no results; run audition.py {'raw' if key == 'main' else key.split('_')[0]} first")
        DOC_DIR.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(res, indent=1) + "\n")
        print("wrote", target)


if __name__ == "__main__":
    main()
