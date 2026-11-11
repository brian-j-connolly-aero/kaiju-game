#!/opt/mbtools/venv/bin/python
"""Casting and chain experiments: how intelligible is each candidate voice setting and each
chain setting, measured as word error rate with pocketsphinx on real script lines.

  experiments.py <group> [<group> ..]     run the named groups (see GROUPS below)
  experiments.py summary                  collect every cached result into docs/audio/voice/experiments.json

Each experiment = (voice, chain, chain settings, set of lines). Results are cached in
$MB_SCRATCH/experiments/ by a hash of all of that, so re-running costs nothing."""

from __future__ import annotations

import hashlib
import json
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import DOC_DIR, SCRATCH, SR, asr, dsp  # noqa: E402
from mbvoice.chains import apply_chain, chain_config  # noqa: E402
from mbvoice.pipeline import master, raw_speech  # noqa: E402
from mbvoice.script import load_lines  # noqa: E402

EXP = SCRATCH / "experiments"


def V(engine, voice, **kw):
    return {"engine": engine, "voice": voice, **kw}


def line_sets() -> dict:
    lines = load_lines()
    radio = [l for l in lines if l["audience"] == "humans"]
    anchor = [l for l in lines if l["speaker"] == "Anchor"]
    chair = [l for l in lines if l["speaker"] == "Chair"]
    return {
        "radio": radio,                              # all 93 military lines
        "anchor": anchor,                            # all 82 news lines
        "chair": chair + anchor[::3],                # the 6 hearing lines plus 28 news lines
        **{s: [l for l in lines if l["speaker"] == s] for s in ("Overlord", "Granite", "Beacon", "Tempest")},
    }


# group name -> list of (label, voice, chain, chain overrides, line set, max pause ms)
GROUPS = {
    "radio_voices": [
        ("bdl", V("rhvoice", "bdl"), "radio", {}, "radio", 320),
        ("bdl rate 0.92 pitch 0.9", V("rhvoice", "bdl", rate=0.92, pitch=0.9), "radio", {}, "radio", 320),
        ("bdl rate 0.88 pitch 0.82", V("rhvoice", "bdl", rate=0.88, pitch=0.82), "radio", {}, "radio", 320),
        ("bdl rate 0.85 pitch 0.75", V("rhvoice", "bdl", rate=0.85, pitch=0.75), "radio", {}, "radio", 320),
        ("bdl rate 0.8 pitch 0.68", V("rhvoice", "bdl", rate=0.8, pitch=0.68), "radio", {}, "radio", 320),
        ("alan", V("rhvoice", "alan"), "radio", {}, "radio", 320),
        ("alan rate 0.9 pitch 0.85", V("rhvoice", "alan", rate=0.9, pitch=0.85), "radio", {}, "radio", 320),
        ("clb", V("rhvoice", "clb"), "radio", {}, "radio", 320),
        ("clb rate 1.06", V("rhvoice", "clb", rate=1.06), "radio", {}, "radio", 320),
        ("rhvoice slt", V("rhvoice", "slt"), "radio", {}, "radio", 320),
        ("rms", V("flite", "rms"), "radio", {}, "radio", 320),
        ("rms shift -1", V("flite", "rms", shift_st=-1.0), "radio", {}, "radio", 320),
        ("rms shift -2", V("flite", "rms", shift_st=-2.0), "radio", {}, "radio", 320),
        ("rms pitch only -2", V("flite", "rms", pitch_st=-2.0), "radio", {}, "radio", 320),
        ("awb", V("flite", "awb"), "radio", {}, "radio", 320),
        ("awb shift -1", V("flite", "awb", shift_st=-1.0), "radio", {}, "radio", 320),
        ("flite slt", V("flite", "slt"), "radio", {}, "radio", 320),
        ("kal16", V("flite", "kal16"), "radio", {}, "radio", 320),
        ("pico en-GB", V("pico", "en-GB"), "radio", {}, "radio", 320),
        ("pico en-US", V("pico", "en-US"), "radio", {}, "radio", 320),
        ("festival slt", V("festival", "cmu_us_slt_arctic_hts"), "radio", {}, "radio", 320),
    ],
    "anchor_voices": [
        ("pico en-US", V("pico", "en-US"), "broadcast", {}, "anchor", 380),
        ("pico en-GB", V("pico", "en-GB"), "broadcast", {}, "anchor", 380),
        ("rhvoice slt", V("rhvoice", "slt"), "broadcast", {}, "anchor", 380),
        ("rhvoice clb", V("rhvoice", "clb"), "broadcast", {}, "anchor", 380),
        ("festival slt", V("festival", "cmu_us_slt_arctic_hts"), "broadcast", {}, "anchor", 380),
        ("rhvoice bdl", V("rhvoice", "bdl"), "broadcast", {}, "anchor", 380),
    ],
    "chair_voices": [
        ("alan", V("rhvoice", "alan"), "hall", {}, "chair", 650),
        ("alan rate 0.88 pitch 0.85", V("rhvoice", "alan", rate=0.88, pitch=0.85), "hall", {}, "chair", 650),
        ("alan rate 0.84 pitch 0.8", V("rhvoice", "alan", rate=0.84, pitch=0.8), "hall", {}, "chair", 650),
        ("alan rate 0.8 pitch 0.72", V("rhvoice", "alan", rate=0.8, pitch=0.72), "hall", {}, "chair", 650),
        ("bdl rate 0.84 pitch 0.8", V("rhvoice", "bdl", rate=0.84, pitch=0.8), "hall", {}, "chair", 650),
        ("rms rate 0.9", V("flite", "rms", rate=0.9), "hall", {}, "chair", 650),
        ("awb rate 0.9", V("flite", "awb", rate=0.9), "hall", {}, "chair", 650),
    ],
}


def key_of(exp) -> str:
    label, voice, chain, over, lines, pause = exp
    blob = json.dumps([voice, chain, chain_config(chain, over) if chain else None, lines, pause], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def run_one(args) -> dict:
    group, exp = args
    label, voice, chain, over, set_name, pause = exp
    EXP.mkdir(parents=True, exist_ok=True)
    cache = EXP / f"{key_of(exp)}.json"
    if cache.exists():
        res = json.loads(cache.read_text())
        res["group"], res["label"] = group, label
        return res
    lines = line_sets()[set_name]
    cfg = chain_config(chain, over)
    e_raw = e_proc = words = 0
    f0s, secs, peaks = [], 0.0, []
    for l in lines:
        raw = raw_speech(l["text"], voice, pause)
        seed = int.from_bytes(hashlib.sha256(l["id"].encode()).digest()[:8], "little")
        y, span = apply_chain(chain, raw, cfg, np.random.default_rng(seed))
        pre_peak = dsp.true_peak_db(y, SR) - dsp.lufs(y, SR)
        y = master(y)
        a, n = asr.word_errors(l["text"], asr.transcribe(raw, SR))
        b, _ = asr.word_errors(l["text"], asr.transcribe(y, SR))
        e_raw += a
        e_proc += b
        words += n
        f = dsp.f0_track(raw, SR)
        if len(f):
            f0s.append(f)
        secs += len(raw) / SR
        peaks.append(pre_peak)
    f0 = np.concatenate(f0s) if f0s else np.array([0.0])
    res = {
        "group": group, "label": label, "voice": voice, "chain": chain, "overrides": over,
        "line_set": set_name, "lines": len(lines), "words": words,
        "wer_raw": round(100 * e_raw / words, 1), "wer_processed": round(100 * e_proc / words, 1),
        "f0_median_hz": round(float(np.median(f0)), 1),
        "words_per_second": round(words / secs, 2),
        "peak_over_loudness_db": round(float(np.mean(peaks)), 1),
    }
    cache.write_text(json.dumps(res))
    return res


def main() -> None:
    names = sys.argv[1:] or ["summary"]
    if names == ["summary"]:
        out = []
        for g, exps in GROUPS.items():
            for exp in exps:
                c = EXP / f"{key_of(exp)}.json"
                if c.exists():
                    r = json.loads(c.read_text())
                    r["group"], r["label"] = g, exp[0]
                    out.append(r)
        DOC_DIR.mkdir(parents=True, exist_ok=True)
        (DOC_DIR / "experiments.json").write_text(json.dumps(out, indent=1) + "\n")
        print("wrote", DOC_DIR / "experiments.json", len(out), "results")
        return
    jobs = [(g, exp) for g in names for exp in GROUPS[g]]
    with Pool(2) as pool:
        for r in pool.imap_unordered(run_one, jobs):
            print(f"{r['group']:14s} {r['label']:28s} {r['line_set']:8s} raw {r['wer_raw']:5.1f}%  "
                  f"{r['chain']:9s} {r['wer_processed']:5.1f}%  F0 {r['f0_median_hz']:6.1f} Hz  "
                  f"{r['words_per_second']:.2f} w/s  peak-loudness {r['peak_over_loudness_db']:.1f} dB", flush=True)


if __name__ == "__main__":
    main()
