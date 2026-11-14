#!/opt/mbtools/venv/bin/python
"""Casting and chain experiments: how intelligible is each candidate voice setting and each
chain setting, measured as word error rate with pocketsphinx on real script lines.

  experiments.py <group> [<group> ..]     run the named groups (see GROUPS below)
  experiments.py summary                  collect every cached result into docs/audio/voice/experiments.json

Each experiment = (voice, chain, chain settings, set of lines). Results are cached in
$MB_SCRATCH/experiments/ by a hash of all of that, so re-running costs nothing. The recorded
results in docs/audio/voice/experiments.json were measured while the chains were being
developed; running an experiment afresh uses today's chain code and will differ by a few points."""

from __future__ import annotations

import hashlib
import json
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import DOC_DIR, SCRATCH, SR, asr, asr2, dsp, speakers  # noqa: E402
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
    squads = [l for l in lines if l["speaker"] in ("Granite", "Beacon", "Tempest")]
    return {
        "radio": radio,                              # all military lines (93 in the first script)
        "radio sample": radio[::3],                  # every third military line (31 in the first script)
        "anchor": anchor,                            # all news lines (82 in the first script)
        "chair": chair + anchor[::3],                # the 6 hearing lines plus every third news line
        "hearing": chair,                            # the 6 hearing lines only
        "squads": squads,                            # every line of the three squad voices (79)
        "squads sample": squads[::2],                # every other one (40)
        "anchor sample": anchor[::2],                # every other news line (43)
        "Overlord sample": [l for l in lines if l["speaker"] == "Overlord"][::2],   # every other Overlord line (25)
        **{s: [l for l in lines if l["speaker"] == s] for s in ("Overlord", "Granite", "Beacon", "Tempest")},
    }


# The first-pass chains the casting experiments were run through (harsher than the final ones).
# Every setting that differs from today's defaults is spelled out, so these experiments keep
# their meaning (and their cached results) when the defaults in mbvoice/chains.py move.
RADIO_V1 = {"band_hz": [330.0, 3300.0], "drive_db": 7.0, "static_db": -30.0, "static_duck_db": 0.0}
HALL_V1 = {"wet_db": -12.0, "early_db": -9.0, "duck_db": 0.0}
# The second-pass radio chain (what the defaults became).
RADIO_V2 = {"band_hz": [330.0, 3300.0], "drive_db": 3.0, "static_db": -30.0, "static_duck_db": 10.0}

# group name -> list of (label, voice, chain, chain overrides, line set, max pause ms)
GROUPS = {
    "radio_voices": [
        ("bdl", V("rhvoice", "bdl"), "radio", RADIO_V1, "radio", 320),
        ("bdl rate 0.92 pitch 0.9", V("rhvoice", "bdl", rate=0.92, pitch=0.9), "radio", RADIO_V1, "radio", 320),
        ("bdl rate 0.88 pitch 0.82", V("rhvoice", "bdl", rate=0.88, pitch=0.82), "radio", RADIO_V1, "radio", 320),
        ("bdl rate 0.85 pitch 0.75", V("rhvoice", "bdl", rate=0.85, pitch=0.75), "radio", RADIO_V1, "radio", 320),
        ("alan", V("rhvoice", "alan"), "radio", RADIO_V1, "radio", 320),
        ("alan rate 0.92 pitch 0.9", V("rhvoice", "alan", rate=0.92, pitch=0.9), "radio", RADIO_V1, "radio", 320),
        ("clb", V("rhvoice", "clb"), "radio", RADIO_V1, "radio", 320),
        ("clb rate 1.06", V("rhvoice", "clb", rate=1.06), "radio", RADIO_V1, "radio", 320),
        ("rhvoice slt", V("rhvoice", "slt"), "radio", RADIO_V1, "radio", 320),
        ("rms", V("flite", "rms"), "radio", RADIO_V1, "radio", 320),
        ("rms shift -1", V("flite", "rms", shift_st=-1.0), "radio", RADIO_V1, "radio", 320),
        ("rms shift -2", V("flite", "rms", shift_st=-2.0), "radio", RADIO_V1, "radio", 320),
        ("rms pitch only -2", V("flite", "rms", pitch_st=-2.0), "radio", RADIO_V1, "radio", 320),
        ("awb", V("flite", "awb"), "radio", RADIO_V1, "radio", 320),
        ("awb rate 0.92", V("flite", "awb", rate=0.92), "radio", RADIO_V1, "radio", 320),
        ("pico en-US", V("pico", "en-US"), "radio", RADIO_V1, "radio", 320),
    ],
    "anchor_voices": [
        ("rhvoice slt", V("rhvoice", "slt"), "broadcast", {}, "anchor", 380),
        ("rhvoice slt rate 0.94", V("rhvoice", "slt", rate=0.94), "broadcast", {}, "anchor", 380),
        ("rhvoice clb", V("rhvoice", "clb"), "broadcast", {}, "anchor", 380),
        ("pico en-US", V("pico", "en-US"), "broadcast", {}, "anchor", 380),
        ("pico en-US rate 0.92", V("pico", "en-US", rate=0.92), "broadcast", {}, "anchor", 380),
        ("festival slt", V("festival", "cmu_us_slt_arctic_hts"), "broadcast", {}, "anchor", 380),
    ],
    "chair_voices": [
        ("alan", V("rhvoice", "alan"), "hall", HALL_V1, "chair", 650),
        ("alan rate 0.88 pitch 0.85", V("rhvoice", "alan", rate=0.88, pitch=0.85), "hall", HALL_V1, "chair", 650),
        ("alan rate 0.82 pitch 0.78", V("rhvoice", "alan", rate=0.82, pitch=0.78), "hall", HALL_V1, "chair", 650),
        ("awb rate 0.88", V("flite", "awb", rate=0.88), "hall", HALL_V1, "chair", 650),
        ("awb rate 0.88 shift -2", V("flite", "awb", rate=0.88, shift_st=-2.0), "hall", HALL_V1, "chair", 650),
        ("pico en-US rate 0.9 pitch 0.78", V("pico", "en-US", rate=0.9, pitch=0.78), "hall", HALL_V1, "chair", 650),
        ("pico en-GB rate 0.88 pitch 0.75", V("pico", "en-GB", rate=0.88, pitch=0.75), "hall", HALL_V1, "chair", 650),
        ("bdl rate 0.84 pitch 0.8", V("rhvoice", "bdl", rate=0.84, pitch=0.8), "hall", HALL_V1, "chair", 650),
        ("rms rate 0.9", V("flite", "rms", rate=0.9), "hall", HALL_V1, "chair", 650),
    ],
}


def _radio_sweep() -> list:
    voices = [("rms", V("flite", "rms")), ("clb", V("rhvoice", "clb"))]
    settings = [
        ("first pass (drive 7, static -30, not ducked)", {}),
        ("band 300 to 3800 Hz", {"band_hz": [300.0, 3800.0]}),
        ("band 250 to 4200 Hz", {"band_hz": [250.0, 4200.0]}),
        ("band 400 to 3000 Hz", {"band_hz": [400.0, 3000.0]}),
        ("gentler filter slopes", {"hp_order": 2, "lp_order": 4}),
        ("no presence peak", {"presence_db": 0.0}),
        ("no compression", {"comp_ratio": 1.0}),
        ("drive 0 dB", {"drive_db": 0.0}),
        ("drive 12 dB", {"drive_db": 12.0}),
        ("static -40 dB", {"static_db": -40.0}),
        ("static -24 dB", {"static_db": -24.0}),
    ]
    return [(f"{vn}: {label}", v, "radio", {**RADIO_V1, **over}, "radio sample", 320)
            for vn, v in voices for label, over in settings]


GROUPS["sweep_radio"] = _radio_sweep()


def _radio_sweep2() -> list:
    voices = [("rms", V("flite", "rms")), ("clb", V("rhvoice", "clb")), ("alan", V("rhvoice", "alan"))]
    settings = [
        ("second pass (drive 3, static -30 ducked 10)", {}),
        ("static not ducked", {"static_duck_db": 0.0}),
        ("static ducked 16 dB", {"static_duck_db": 16.0}),
        ("static -34 ducked 10", {"static_db": -34.0}),
        ("drive 0 dB", {"drive_db": 0.0}),
        ("drive 6 dB", {"drive_db": 6.0}),
        ("band 300 to 3800 Hz", {"band_hz": [300.0, 3800.0]}),
    ]
    return [(f"{vn}: {label}", v, "radio", {**RADIO_V2, **over}, "radio sample", 320)
            for vn, v in voices for label, over in settings]


def _hall_sweep() -> list:
    voice = V("rhvoice", "alan", rate=0.88, pitch=0.85)
    settings = [
        ("first pass (wet -12, early -9, no ducking)", {}),
        ("ducked 8 dB", {"duck_db": 8.0}),
        ("ducked 14 dB", {"duck_db": 14.0}),
        ("wet -18, early -15", {"wet_db": -18.0, "early_db": -15.0}),
        ("wet -18, early -15, ducked 8 dB", {"wet_db": -18.0, "early_db": -15.0, "duck_db": 8.0}),
        ("wet -15, early -18, ducked 10 dB", {"wet_db": -15.0, "early_db": -18.0, "duck_db": 10.0}),
        ("wet -24, early -20", {"wet_db": -24.0, "early_db": -20.0}),
        ("decay 1.4 s", {"rt60_s": 1.4, "rt60_high_s": 0.8}),
    ]
    return [(f"alan: {label}", voice, "hall", {**HALL_V1, **over}, "chair", 650) for label, over in settings]


def _radio_sweep3() -> list:
    alan = V("rhvoice", "alan")
    settings = [
        ("band 300 to 4200 Hz", alan, {"band_hz": [300.0, 4200.0]}),
        ("band 300 to 4800 Hz", alan, {"band_hz": [300.0, 4800.0]}),
        ("band 200 to 3800 Hz", alan, {"band_hz": [200.0, 3800.0]}),
        ("band 300 to 3800 Hz, no presence peak", alan, {"band_hz": [300.0, 3800.0], "presence_db": 0.0}),
        ("band 300 to 3800 Hz, gentler low-pass", alan, {"band_hz": [300.0, 3800.0], "lp_order": 4}),
        ("band 300 to 3800 Hz, rate 0.94", V("rhvoice", "alan", rate=0.94), {"band_hz": [300.0, 3800.0]}),
    ]
    return [(f"alan: {label}", v, "radio", {**RADIO_V2, **over}, "radio sample", 320) for label, v, over in settings]


def _hall_sweep2() -> list:
    voice = V("pico", "en-US", rate=0.9, pitch=0.78)
    settings = [
        ("wet -14, early -18, ducked 10 dB", {"wet_db": -14.0, "early_db": -18.0, "duck_db": 10.0}),
        ("wet -11, early -18, ducked 12 dB", {"wet_db": -11.0, "early_db": -18.0, "duck_db": 12.0}),
        ("wet -11, early -20, ducked 14 dB", {"wet_db": -11.0, "early_db": -20.0, "duck_db": 14.0}),
        ("wet -8, early -20, ducked 16 dB", {"wet_db": -8.0, "early_db": -20.0, "duck_db": 16.0}),
    ]
    return [(f"pico low: {label}", voice, "hall", {**HALL_V1, **over}, "chair", 650) for label, over in settings]


def _chair_voices2() -> list:
    final_hall = {"wet_db": -12.0, "early_db": -18.0, "duck_db": 12.0}
    cands = [
        ("pico en-US rate 0.9 pitch 0.78", V("pico", "en-US", rate=0.9, pitch=0.78)),
        ("pico en-US rate 0.9, pitch and formants -2 semitones", V("pico", "en-US", rate=0.9, shift_st=-2.0)),
        ("pico en-US rate 0.9, pitch and formants -3 semitones", V("pico", "en-US", rate=0.9, shift_st=-3.0)),
        ("pico en-US rate 0.9, pitch and formants -4 semitones", V("pico", "en-US", rate=0.9, shift_st=-4.0)),
        ("pico en-US rate 0.9, pitch and formants -5 semitones", V("pico", "en-US", rate=0.9, shift_st=-5.0)),
        ("pico en-US rate 0.9 pitch 0.9, pitch and formants -3 semitones",
         V("pico", "en-US", rate=0.9, pitch=0.9, shift_st=-3.0)),
        ("pico en-GB rate 0.9, pitch and formants -4 semitones", V("pico", "en-GB", rate=0.9, shift_st=-4.0)),
        ("alan rate 0.84 pitch 0.8", V("rhvoice", "alan", rate=0.84, pitch=0.8)),
        ("kal16 rate 0.9", V("flite", "kal16", rate=0.9)),
    ]
    return [(label, v, "hall", final_hall, "hearing", 650) for label, v in cands]


GROUPS["chair_voices2"] = _chair_voices2()

# The neural casting rounds: the voices short-listed by `audition.py neural`, each through the
# character's own finished chain (today's defaults; Overlord's own radio settings for Overlord).
OVERLORD_RADIO = {"band_hz": [260.0, 4000.0], "drive_db": 2.0, "static_db": -38.0}


def K(voice, **kw):
    return V("kokoro", voice, **kw)


def P(voice, **kw):
    return V("piper", voice, **kw)


GROUPS["neural_overlord"] = [
    (label, v, "radio", OVERLORD_RADIO, "Overlord", 380) for label, v in [
        ("kokoro am_onyx", K("am_onyx")),
        ("kokoro am_onyx rate 0.9", K("am_onyx", rate=0.9)),
    ]]
GROUPS["neural_overlord2"] = [
    (label, v, "radio", {**OVERLORD_RADIO, **over}, "Overlord sample", 380) for label, v, over in [
        ("am_onyx rate 0.9, Overlord's radio", K("am_onyx", rate=0.9), {}),
        ("am_onyx rate 0.9, presence 7 dB", K("am_onyx", rate=0.9), {"presence_db": 7.0}),
        ("am_onyx rate 0.9, presence 7 dB, band to 4.5 kHz", K("am_onyx", rate=0.9),
         {"presence_db": 7.0, "band_hz": [260.0, 4500.0]}),
        ("am_onyx rate 0.9, presence 9 dB at 2.4 kHz", K("am_onyx", rate=0.9),
         {"presence_db": 9.0, "presence_hz": 2400.0}),
        ("am_echo rate 0.85, Overlord's radio", K("am_echo", rate=0.85), {}),
    ]]
GROUPS["neural_squads"] = [
    (label, v, "radio", {}, "squads sample", 300) for label, v in [
        ("kokoro am_echo rate 0.95", K("am_echo", rate=0.95)),
        ("kokoro am_liam rate 0.9", K("am_liam", rate=0.9)),
        ("kokoro am_michael rate 0.9", K("am_michael", rate=0.9)),
        ("kokoro am_fenrir rate 0.9", K("am_fenrir", rate=0.9)),
        ("piper en_US-bryce-medium", P("en_US-bryce-medium")),
        ("kokoro af_alloy rate 0.9", K("af_alloy", rate=0.9)),
        ("kokoro af_sky rate 0.9", K("af_sky", rate=0.9)),
        ("piper en_GB-alba-medium", P("en_GB-alba-medium")),
    ]]
GROUPS["neural_anchor"] = [
    (label, v, "broadcast", {}, "anchor sample", 380) for label, v in [
        ("kokoro af_heart rate 0.85", K("af_heart", rate=0.85)),
        ("kokoro af_bella rate 0.85", K("af_bella", rate=0.85)),
    ]]
GROUPS["neural_chair"] = [
    (label, v, "hall", {}, "chair", 650) for label, v in [
        ("kokoro bm_george rate 0.85", K("bm_george", rate=0.85)),
        ("kokoro bm_lewis rate 0.85", K("bm_lewis", rate=0.85)),
        ("kokoro bm_fable rate 0.85", K("bm_fable", rate=0.85)),
    ]]
GROUPS["sweep_radio3"] = _radio_sweep3()
GROUPS["sweep_hall2"] = _hall_sweep2()
GROUPS["sweep_radio2"] = _radio_sweep2()
GROUPS["sweep_hall"] = _hall_sweep()


def key_of(exp) -> str:
    # the key is what the experiment spells out, not the resolved settings, so that a new chain
    # setting or a moved default does not orphan the recorded results
    label, voice, chain, over, lines, pause = exp
    blob = json.dumps([voice, chain, over, lines, pause], sort_keys=True)
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
    second = group.startswith("neural")          # the neural casting rounds are also heard by asr2
    e_raw = e_proc = e2 = words = 0
    f0s, secs, peaks, misses, prints = [], 0.0, [], {}, []
    for l in lines:
        raw = raw_speech(l["text"], voice, pause)
        seed = int.from_bytes(hashlib.sha256(l["id"].encode()).digest()[:8], "little")
        y, span = apply_chain(chain, raw, cfg, np.random.default_rng(seed))
        pre_peak = dsp.true_peak_db(y, SR) - dsp.lufs(y, SR)
        y = master(y)
        a, n = asr.word_errors(l["text"], asr.transcribe(raw, SR))
        hyp = asr.transcribe(y, SR)
        b, _ = asr.word_errors(l["text"], hyp)
        if b:
            misses[l["id"]] = hyp
        if second:
            e2 += asr.word_errors(l["text"], asr2.transcribe(y, SR))[0]
            prints.append(speakers.voice_print(y, SR))
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
    if second:
        res["wer2_processed"] = round(100 * e2 / words, 1)
        res["misses"] = misses
        mean = np.mean(prints, axis=0)
        res["print"] = [round(float(v), 5) for v in mean / np.linalg.norm(mean)]   # for comparing candidates
    cache.write_text(json.dumps(res))
    return res


def main() -> None:
    names = sys.argv[1:] or ["summary"]
    if names == ["summary"]:
        # The cache lives in scratch space, so a fresh machine has only what it ran itself: cached
        # results replace the recorded ones of the same experiment, and recorded results that are
        # not cached here are kept, never dropped.
        DOC_DIR.mkdir(parents=True, exist_ok=True)
        target = DOC_DIR / "experiments.json"
        recorded = {(r["group"], r["label"]): r for r in json.loads(target.read_text())} if target.exists() else {}
        out, fresh = [], 0
        for g, exps in GROUPS.items():
            for exp in exps:
                c = EXP / f"{key_of(exp)}.json"
                if c.exists():
                    r = json.loads(c.read_text())
                    r["group"], r["label"] = g, exp[0]
                    r.pop("misses", None)            # kept in the cache for whoever reruns, not in the record
                    r.pop("print", None)
                    out.append(r)
                    fresh += 1
                elif (g, exp[0]) in recorded:
                    out.append(recorded[(g, exp[0])])
        total = sum(len(v) for v in GROUPS.values())
        target.write_text(json.dumps(out, indent=1) + "\n")
        print(f"wrote {target}: {len(out)} of {total} experiments ({fresh} from this machine's cache, "
              f"{len(out) - fresh} as recorded)")
        return
    jobs = [(g, exp) for g in names for exp in GROUPS[g]]
    from mbvoice.synth import split_threads
    split_threads(2)
    asr2.fetch()
    with Pool(2) as pool:
        for r in pool.imap_unordered(run_one, jobs):
            print(f"{r['group']:14s} {r['label']:28s} {r['line_set']:8s} raw {r['wer_raw']:5.1f}%  "
                  f"{r['chain']:9s} {r['wer_processed']:5.1f}%  F0 {r['f0_median_hz']:6.1f} Hz  "
                  f"{r['words_per_second']:.2f} w/s  peak-loudness {r['peak_over_loudness_db']:.1f} dB", flush=True)


if __name__ == "__main__":
    main()
