"""Verification by measurement. Every .ogg and .mp3 is decoded again with ffmpeg and measured:
length, loudness, true peak, clean edges, bandwidth, and what a speech recognizer hears in it.
Also draws the spectrogram sheets in docs/audio/voice/."""

from __future__ import annotations

import json
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw
from scipy import signal

from . import DOC_DIR, OUT_DIR, SR, asr, dsp
from .pipeline import CEILING_DBTP, TARGET_LUFS, decode, render

MEASUREMENTS = DOC_DIR / "measurements.json"

# limits a finished line must meet (checked on the encoded files)
LUFS_TOLERANCE = 0.8            # loudness within this of the target
PEAK_LIMIT_DBTP = -0.5          # lossy encoding overshoots the -1.5 master ceiling a little
MAX_SECONDS = 8.0               # radio and anchor lines (12 words at most)
MAX_SECONDS_HALL = 13.0         # hearing lines (20 words at most, plus the room's ring)
MAX_SECONDS_PER_WORD = 1.1      # anything slower than this is a synthesizer accident
EDGE_DB = -35.0                 # first and last millisecond, relative to the peak
BAND_LOW, BAND_HIGH = 0.67, 1.3  # radio lines: almost nothing below 0.67 x and above 1.3 x the band corners
BAND_SHARE = 0.015              # "almost nothing": at most 1.5% of the energy on either side


def measure_line(job: tuple[dict, dict, dict]) -> dict:
    line, rec, plan = job
    i = line["id"]
    out = {"id": i, "hash": rec["hash"], "speaker": line["speaker"], "chain": plan["chain"],
           "words": rec["words"], "failures": []}
    fail = out["failures"]
    for ext in ("ogg", "mp3"):
        path = OUT_DIR / f"{i}.{ext}"
        if not path.exists():
            fail.append(f"{i}.{ext} is missing")
            continue
        try:
            x = decode(path)
        except Exception as e:
            fail.append(f"{i}.{ext} does not decode: {e}")
            continue
        ch = 1 if x.ndim == 1 else x.shape[1]
        peak = float(np.max(np.abs(x))) + 1e-12
        lo, hi = plan["chain_cfg"].get("band_hz", [300.0, 3800.0])
        m = {
            "bytes": path.stat().st_size,
            "channels": ch,
            "seconds": round(len(x) / SR, 3),
            "lufs": round(dsp.lufs(x, SR), 2),
            "true_peak_db": round(dsp.true_peak_db(x, SR), 2),
            "first_ms_db": round(dsp.db(np.max(np.abs(x[:44])) / peak), 1),
            "last_ms_db": round(dsp.db(np.max(np.abs(x[-44:])) / peak), 1),
            "share_in_band": round(dsp.band_share(x, SR, lo, hi * 1.12), 4),
            "share_below_band": round(dsp.band_share(x, SR, 0, lo * BAND_LOW), 4),
            "share_above_band": round(dsp.band_share(x, SR, hi * BAND_HIGH, SR / 2), 4),
            "centroid_hz": round(dsp.spectral_centroid(x, SR)),
            "rolloff99_hz": round(dsp.rolloff(x, SR)),
        }
        hyp = asr.transcribe(x, SR)
        e, _ = asr.word_errors(line["text"], hyp)
        m["hyp"] = hyp
        m["errors"] = e
        out[ext] = m
        if plan["chain"] == "radio" and ext == "ogg":
            # squelch and static against the speech they frame (levels over 10 ms)
            a, b = int(rec["speech"][0] * SR), int(rec["speech"][1] * SR)
            env = dsp.envelope_db(x, SR, 10.0)
            loud = float(np.percentile(env[a:b], 90))
            speech_peak = float(np.max(np.abs(x[a:b]))) + 1e-12
            out["squelch"] = {
                "open_click_db": round(dsp.db(np.max(np.abs(x[:a])) / speech_peak), 1),
                "close_click_db": round(dsp.db(np.max(np.abs(x[b:])) / speech_peak), 1),
                "open_burst_db": round(float(env[:a].max()) - loud, 1),
                "close_burst_db": round(float(env[b:].max()) - loud, 1),
                "static_db": round(float(np.median(env[max(0, a - 1300):a - 200])) - loud, 1),
            }
            if out["squelch"]["open_click_db"] > -3.0 or out["squelch"]["close_click_db"] > -3.0:
                fail.append(f"{i}: a squelch click is as loud as the speech peaks ({out['squelch']})")
        want_ch = 2 if plan["chain"] == "hall" else 1
        if ch != want_ch:
            fail.append(f"{i}.{ext}: {ch} channels, expected {want_ch}")
        slack = 0.03 if ext == "ogg" else 0.08       # mp3 frames pad the end
        if abs(m["seconds"] - rec["duration"]) > slack:
            fail.append(f"{i}.{ext}: {m['seconds']} s but the manifest says {rec['duration']} s")
        if abs(m["lufs"] - TARGET_LUFS) > LUFS_TOLERANCE:
            fail.append(f"{i}.{ext}: loudness {m['lufs']} LUFS, target {TARGET_LUFS}")
        if m["true_peak_db"] > PEAK_LIMIT_DBTP:
            fail.append(f"{i}.{ext}: true peak {m['true_peak_db']} dBTP is above {PEAK_LIMIT_DBTP}")
        if ext == "ogg" and (m["first_ms_db"] > EDGE_DB and plan["chain"] != "radio"):
            fail.append(f"{i}.{ext}: starts abruptly ({m['first_ms_db']} dB in the first millisecond)")
        if ext == "ogg" and m["last_ms_db"] > EDGE_DB:
            fail.append(f"{i}.{ext}: ends abruptly ({m['last_ms_db']} dB in the last millisecond)")
        if plan["chain"] == "radio" and (m["share_below_band"] > BAND_SHARE or m["share_above_band"] > BAND_SHARE):
            fail.append(f"{i}.{ext}: radio line is not band-limited ({100 * m['share_below_band']:.1f}% of the "
                        f"energy below {lo * BAND_LOW:.0f} Hz, {100 * m['share_above_band']:.1f}% above {hi * BAND_HIGH:.0f} Hz)")
    limit = MAX_SECONDS_HALL if plan["chain"] == "hall" else MAX_SECONDS
    if rec["duration"] > limit:
        fail.append(f"{i}: {rec['duration']} s is longer than the {limit} s limit")
    speech = rec["speech"][1] - rec["speech"][0]
    out["speech_seconds"] = round(speech, 3)
    out["seconds_per_word"] = round(speech / max(rec["words"], 1), 3)
    if out["seconds_per_word"] > MAX_SECONDS_PER_WORD and rec["words"] >= 3:
        fail.append(f"{i}: {out['seconds_per_word']} s per word; the synthesizer stalled")
    out["lead_s"] = round(rec["speech"][0], 3)
    out["tail_s"] = round(rec["duration"] - rec["speech"][1], 3)
    return out


def verify(lines: list[dict], cast: dict, state: dict, plans: dict, jobs: int = 2) -> dict:
    """Measures every built line (re-using cached measurements of unchanged lines), writes
    docs/audio/voice/measurements.json and the pictures, and returns the report."""
    DOC_DIR.mkdir(parents=True, exist_ok=True)
    cached = {}
    if MEASUREMENTS.exists():
        try:
            cached = {m["id"]: m for m in json.loads(MEASUREMENTS.read_text())["lines"]}
        except Exception:
            cached = {}
    todo, results = [], {}
    for l in lines:
        rec = state["lines"].get(l["id"])
        if rec is None:
            results[l["id"]] = {"id": l["id"], "speaker": l["speaker"], "failures": [f"{l['id']} was never built"]}
            continue
        c = cached.get(l["id"])
        fresh = c and c.get("hash") == rec["hash"] and "ogg" in c and "mp3" in c and not c["failures"]
        if fresh and (c.get("chain") != "radio" or "squelch" in c):
            results[l["id"]] = c
        else:
            todo.append((l, rec, plans[l["id"]]))
    print(f"voice: measuring {len(todo)} lines ({len(lines) - len(todo)} cached)")
    if todo:
        with Pool(max(1, jobs)) as pool:
            for m in pool.imap_unordered(measure_line, todo):
                results[m["id"]] = m
    ordered = [results[l["id"]] for l in lines]
    failures = [f for m in ordered for f in m["failures"]]

    # the script itself: every id must have files and nothing else may be in the folder
    ids = {l["id"] for l in lines}
    extra = sorted(f.name for f in OUT_DIR.iterdir() if f.stem not in ids) if OUT_DIR.exists() else []
    for name in extra:
        failures.append(f"{name} is in the voice folder but not in the script")

    report = {
        "target_lufs": TARGET_LUFS, "ceiling_dbtp": CEILING_DBTP,
        "lines": ordered, "failures": failures,
        "summary": summarize(lines, state, ordered),
    }
    MEASUREMENTS.write_text(json.dumps(report, indent=1) + "\n")
    draw_sheets(lines, cast, plans, state)
    return report


def _rate(errs: int, words: int) -> float:
    return round(100.0 * errs / max(words, 1), 1)


def summarize(lines: list[dict], state: dict, measured: list[dict]) -> dict:
    by_id = {m["id"]: m for m in measured}
    groups: dict[str, dict] = {}

    def add(key: str, l: dict) -> None:
        rec, m = state["lines"].get(l["id"]), by_id[l["id"]]
        if rec is None or "ogg" not in m or "mp3" not in m:
            return
        g = groups.setdefault(key, {"lines": 0, "words": 0, "raw": 0, "processed": 0, "ogg": 0, "mp3": 0,
                                    "seconds": [], "lufs": [], "peak": [], "spw": []})
        g["lines"] += 1
        g["words"] += rec["words"]
        g["raw"] += rec["raw"]["errors"]
        g["processed"] += rec["processed"]["errors"]
        g["ogg"] += m["ogg"]["errors"]
        g["mp3"] += m["mp3"]["errors"]
        g["seconds"].append(rec["duration"])
        g["lufs"] += [m["ogg"]["lufs"], m["mp3"]["lufs"]]
        g["peak"] += [m["ogg"]["true_peak_db"], m["mp3"]["true_peak_db"]]
        g["spw"].append(m["seconds_per_word"])

    for l in lines:
        m = by_id[l["id"]]
        add("speaker:" + l["speaker"], l)
        if "chain" in m:
            add("chain:" + m["chain"], l)
        add("all", l)
    out = {}
    for key, g in groups.items():
        out[key] = {
            "lines": g["lines"], "words": g["words"],
            "wer_raw": _rate(g["raw"], g["words"]),
            "wer_processed": _rate(g["processed"], g["words"]),
            "wer_ogg": _rate(g["ogg"], g["words"]),
            "wer_mp3": _rate(g["mp3"], g["words"]),
            "seconds_min": round(min(g["seconds"]), 2), "seconds_mean": round(float(np.mean(g["seconds"])), 2),
            "seconds_max": round(max(g["seconds"]), 2), "seconds_total": round(sum(g["seconds"]), 1),
            "lufs_min": min(g["lufs"]), "lufs_max": max(g["lufs"]),
            "peak_max": max(g["peak"]),
            "words_per_second": round(1.0 / float(np.mean(g["spw"])), 2),
        }
    return out


# ---------------------------------------------------------------- pictures

_PALETTE = None


def _palette() -> np.ndarray:
    """A dark-to-bright color ramp (black, purple, orange, pale yellow), 256 entries."""
    global _PALETTE
    if _PALETTE is None:
        stops = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66],
                          [245, 125, 21], [250, 193, 39], [252, 255, 164]], dtype=np.float64)
        xs = np.linspace(0, 255, len(stops))
        _PALETTE = np.stack([np.interp(np.arange(256), xs, stops[:, c]) for c in range(3)], axis=1).astype(np.uint8)
    return _PALETTE


def spectrogram_image(x: np.ndarray, width: int, height: int, seconds: float, fmax: float = 8000.0,
                      floor_db: float = -75.0) -> Image.Image:
    """Spectrogram of mono samples at 44.1 kHz, linear frequency 0..fmax, `seconds` across the width."""
    if x.ndim == 2:
        x = x.mean(axis=1)
    f, t, s = signal.stft(x, SR, nperseg=1024, noverlap=1024 - 128, window="hann", padded=True)
    mag = 20 * np.log10(np.abs(s) + 1e-9)
    mag -= mag.max()
    rows = np.searchsorted(f, np.linspace(0, fmax, height))
    rows = np.clip(rows, 0, len(f) - 1)
    cols_t = np.linspace(0, seconds, width)
    cols = np.searchsorted(t, cols_t)
    valid = cols < len(t)
    img = np.full((height, width), floor_db)
    img[:, valid] = mag[np.ix_(rows, cols[valid])]
    img[:, cols_t > len(x) / SR] = floor_db
    norm = np.clip((img - floor_db) / -floor_db, 0, 1)
    rgb = _palette()[(norm * 255).astype(np.uint8)][::-1]
    return Image.fromarray(rgb, "RGB")


def waveform_image(x: np.ndarray, width: int, height: int, seconds: float) -> Image.Image:
    if x.ndim == 2:
        x = x.mean(axis=1)
    img = Image.new("RGB", (width, height), (16, 18, 26))
    d = ImageDraw.Draw(img)
    n = int(seconds * SR)
    per = max(1, n // width)
    mid = height // 2
    d.line([(0, mid), (width, mid)], fill=(50, 54, 70))
    for px in range(width):
        seg = x[px * per:(px + 1) * per]
        if len(seg) == 0:
            break
        lo, hi = float(seg.min()), float(seg.max())
        d.line([(px, mid - int(hi * (mid - 1))), (px, mid - int(lo * (mid - 1)))], fill=(30, 200, 224))
    return img


def draw_sheets(lines: list[dict], cast: dict, plans: dict, state: dict) -> None:
    """One sheet per speaker: three of their lines, unprocessed synthesizer output on the left,
    the finished clip (decoded .ogg) on the right, waveform over spectrogram (0 to 8 kHz)."""
    by_speaker: dict[str, list[dict]] = {}
    for l in lines:
        by_speaker.setdefault(l["speaker"], []).append(l)
    fingerprint = {}
    stamp_file = DOC_DIR / "sheets.json"
    old = json.loads(stamp_file.read_text()) if stamp_file.exists() else {}
    for speaker, ls in by_speaker.items():
        picks = [ls[0], ls[len(ls) // 2], ls[-1]]
        key = "|".join(state["lines"].get(l["id"], {}).get("hash", "?") for l in picks)
        fingerprint[speaker] = key
        target = DOC_DIR / f"sheet_{speaker.lower()}.png"
        if old.get(speaker) == key and target.exists():
            continue
        w, h_wave, h_spec, pad, label = 560, 60, 150, 14, 34
        seconds = max(2.0, max(state["lines"][l["id"]]["duration"] for l in picks if l["id"] in state["lines"]) + 0.1)
        sheet = Image.new("RGB", (2 * w + 3 * pad + 40, len(picks) * (h_wave + h_spec + label + pad) + pad + 20),
                          (10, 11, 16))
        d = ImageDraw.Draw(sheet)
        d.text((pad + 40, 4), f"{speaker}: synthesizer output (left), finished clip decoded from .ogg (right). "
               f"Waveform over spectrogram, 0 to 8 kHz, {seconds:.1f} s across.", fill=(230, 230, 235))
        y = 22
        for l in picks:
            if l["id"] not in state["lines"]:
                continue
            raw, _, _ = render(l, plans[l["id"]])
            done = decode(OUT_DIR / f"{l['id']}.ogg")
            d.text((pad + 40, y), f"{l['id']}: {l['text']}", fill=(255, 217, 26))
            d.text((pad + 40, y + 14), f"heard (finished clip): {state['lines'][l['id']]['processed']['hyp']}",
                   fill=(150, 155, 170))
            y += label
            for col, sig in enumerate((raw / (np.max(np.abs(raw)) + 1e-9) * 0.9, done)):
                x0 = pad + 40 + col * (w + pad)
                sheet.paste(waveform_image(sig, w, h_wave, seconds), (x0, y))
                sheet.paste(spectrogram_image(sig, w, h_spec, seconds), (x0, y + h_wave))
            for khz in (0, 2, 4, 6, 8):
                yy = y + h_wave + h_spec - int(h_spec * khz / 8.0)
                d.text((pad, min(yy - 5, y + h_wave + h_spec - 10)), f"{khz} kHz", fill=(150, 155, 170))
            y += h_wave + h_spec + pad
        sheet.quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(target, optimize=True)
    stamp_file.write_text(json.dumps(fingerprint, indent=1) + "\n")
