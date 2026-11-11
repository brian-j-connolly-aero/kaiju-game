"""Engineer's verification of the encoded sound effects, by measurement and by picture.

Every .ogg and .mp3 is decoded with ffmpeg and measured: duration, sample peak and true peak,
loudness (K-weighted), DC offset, clicks at the two ends, spectral centroid and how much of the
energy arrives in the first half second. Families are compared (a stage 1 step must be brighter
and shorter than a stage 3 step, variants of one sound must be equally loud). Loops are checked
across the loop point. Spectrogram contact sheets go to docs/audio/sfx/.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import signal

from . import dsp
from .dsp import SR
from .master import LEAD_IN, MANIFEST, MASTERS, OUT_DIR, REPO, SHIP_PEAK_DB, decode
from .registry import FAMILIES, Spec

DOCS = REPO / "docs/audio/sfx"

# chart colours (the same as the music sheets): one blue ramp, light (quiet) to dark (loud)
SURFACE = (252, 252, 251)
INK = (11, 11, 11)
INK2 = (82, 81, 78)
MUTED = (137, 135, 129)
GRID = (225, 224, 217)
AXIS = (195, 194, 183)
WAVE = (42, 120, 214)
_RAMP = ["#fcfcfb", "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
         "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]
RAMP = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in _RAMP], dtype=float)
DB_FLOOR, DB_TOP = -90.0, -12.0
F_MIN, F_MAX = 25.0, 20000.0


def _font(size: int, bold: bool = False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)
    except OSError:
        return ImageFont.load_default()


def mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1) if x.ndim == 2 else x


# ---- measurements ----------------------------------------------------------------------------
def spectrum_stats(x: np.ndarray) -> dict:
    """Power-weighted spectral centroid, 85% roll-off, and share of energy below 120 Hz."""
    m = mono(x)
    nper = min(len(m), 4096)
    f, p = signal.welch(m, SR, nperseg=nper, noverlap=nper // 2)
    tot = p.sum() + 1e-30
    c = np.cumsum(p) / tot
    return {"centroid_hz": round(float((f * p).sum() / tot), 1),
            "rolloff85_hz": round(float(f[min(len(f) - 1, np.searchsorted(c, 0.85))]), 1),
            "low_share": round(float(p[f < 120.0].sum() / tot), 3)}


def envelope(m: np.ndarray, window: float = 0.005) -> np.ndarray:
    w = max(1, dsp.n_(window))
    return np.sqrt(np.convolve(m ** 2, np.ones(w) / w, mode="same"))


def measure(x: np.ndarray, spec: Spec) -> dict:
    """Numbers for one decoded file (for loops: for the loop body)."""
    m = mono(x)
    pk = float(np.max(np.abs(x)))
    out = {"seconds": round(len(m) / SR, 4), "peak_db": round(dsp.db(pk), 2),
           "true_peak_db": round(dsp.db(dsp.true_peak(x)), 2),
           "rms_db": round(dsp.db(float(np.sqrt(np.mean(m ** 2)))), 1),
           "dc_offset": round(float(np.max(np.abs(np.mean(x, axis=0)))), 6)}
    if spec.loop:
        a, b = dsp.n_(LEAD_IN), dsp.n_(LEAD_IN + spec.loop)
        body = x[a:b]
        out["level_db"] = round(dsp.level_loop(body), 2)
        out.update(spectrum_stats(body))
        e = envelope(mono(body), 0.05)
        out["level_swing_db"] = round(dsp.db(e.max()) - dsp.db(max(e.min(), 1e-9)), 1)
        return out
    out["level_db"] = round(dsp.level_short(x), 2)
    out.update(spectrum_stats(x))
    e = envelope(m)
    out["peak_at_ms"] = round(float(np.argmax(e)) / SR * 1000, 1)
    k = dsp.n_(0.5)
    out["energy_in_500ms"] = round(float(np.sum(m[:k] ** 2) / (np.sum(m ** 2) + 1e-30)), 3)
    # ends: the very first samples and the last 3 ms, relative to the file's peak
    out["start_db"] = round(dsp.db(float(np.max(np.abs(m[:3])))) - dsp.db(pk), 1)
    out["end_db"] = round(dsp.db(float(np.max(np.abs(m[-dsp.n_(0.003):])))) - dsp.db(pk), 1)
    loud = np.nonzero(e > e.max() * dsp.amp(-40.0))[0]
    out["above_minus40_s"] = round(float(loud[-1] - loud[0]) / SR, 3) if len(loud) else 0.0
    if x.ndim == 2:
        l, r = x[:, 0], x[:, 1]
        out["lr_correlation"] = round(float(np.sum(l * r) / (np.sqrt(np.sum(l * l) * np.sum(r * r)) + 1e-30)), 3)
        out["mono_fold_db"] = round(dsp.db(float(np.sqrt(np.mean(m ** 2)))) -
                                    dsp.db(float(np.sqrt(np.mean(x ** 2)))), 2)
    return out


def seam(x: np.ndarray, start: float, end: float, master: np.ndarray | None) -> dict:
    """How continuous is the jump from the loop end back to the loop start?

    repeat_error_db   how closely the audio around the loop end repeats the audio around the
                      loop start (60 ms either side), relative to the signal level
    codec_error_db    the codec's own error against the master in the same windows; the repeat
                      cannot be much closer than this
    step_vs_p99       the sample step across the splice divided by the 99th percentile of the
                      steps within 50 ms of it (a click would be far above 1)
    splice_flux_db    onset energy at the splice relative to the same moment played straight
                      through into the pad after the loop end (0 dB: the jump adds nothing)
    """
    a, b = dsp.n_(start), dsp.n_(end)
    w = dsp.n_(0.06)
    ref, rep = x[a - w:a + w], x[b - w:b + w]
    sig = dsp.db(float(np.sqrt(np.mean(ref ** 2))) + 1e-12)
    out = {"repeat_error_db": round(dsp.db(float(np.sqrt(np.mean((rep - ref) ** 2)))) - sig, 1)}
    if master is not None and len(master) >= b + w:
        err = np.concatenate([x[a - w:a + w] - master[a - w:a + w], x[b - w:b + w] - master[b - w:b + w]])
        out["codec_error_db"] = round(dsp.db(float(np.sqrt(np.mean(err ** 2)))) - sig, 1)
    span = min(b - a, dsp.n_(1.0))
    spliced = np.concatenate([x[b - span:b], x[a:a + span]], axis=0)
    m = mono(spliced)
    diff = np.abs(np.diff(m))
    at = span - 1
    k = dsp.n_(0.05)
    near = np.concatenate([diff[max(0, at - k):at], diff[at + 1:at + k]])
    out["step_vs_p99"] = round(float(diff[at] / (np.percentile(near, 99) + 1e-12)), 2)
    tail = dsp.n_(0.18)
    straight = mono(x[b - span:b + tail])
    jumped = m[:span + tail]
    n_fft, hop = 1024, 128

    def flux_at_splice(s: np.ndarray) -> float:
        z = np.abs(signal.stft(s, SR, nperseg=n_fft, noverlap=n_fft - hop, boundary=None)[2])
        fl = np.sqrt(np.sum(np.diff(z, axis=1).clip(min=0) ** 2, axis=0))
        i = (span - n_fft // 2) // hop
        return float(fl[max(0, i - 6):i + 7].max())

    out["splice_flux_db"] = round(dsp.db(flux_at_splice(jumped)) - dsp.db(flux_at_splice(straight)), 2)
    return out


def spliced_view(x: np.ndarray, start: float, end: float, span: float) -> np.ndarray:
    a, b = dsp.n_(start), dsp.n_(end)
    k = min(b - a, dsp.n_(span))
    return np.concatenate([x[b - k:b], x[a:a + k]], axis=0)


# ---- pictures --------------------------------------------------------------------------------
def _stft_db(m: np.ndarray, n_fft: int, hop: float, frames: int) -> np.ndarray:
    win = np.hanning(n_fft)
    pad = np.concatenate([np.zeros(n_fft // 2), m, np.zeros(n_fft)])
    starts = (np.arange(frames) * hop).astype(int)
    idx = np.arange(n_fft)[None, :] + starts[:, None]
    z = np.abs(np.fft.rfft(pad[idx] * win, axis=1)) / (win.sum() / 2)        # 0 dB: full-scale sine
    return 20 * np.log10(z + 1e-9)


def heat(m: np.ndarray, width: int, height: int, n_fft: int | None = None) -> np.ndarray:
    """Log-frequency spectrogram as an RGB array (low frequencies at the bottom)."""
    if n_fft is None:
        n_fft = 2048 if len(m) > 0.6 * SR else 1024 if len(m) > 0.2 * SR else 512
    z = _stft_db(m, n_fft, len(m) / width, width)
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    edges = np.geomspace(F_MIN, F_MAX, height + 1)
    rows = np.empty((height, width))
    for r in range(height):
        lo, hi = np.searchsorted(freqs, [edges[r], edges[r + 1]])
        if hi <= lo:
            f = np.sqrt(edges[r] * edges[r + 1])
            k = min(len(freqs) - 2, max(0, np.searchsorted(freqs, f) - 1))
            w = (f - freqs[k]) / (freqs[k + 1] - freqs[k])
            rows[r] = z[:, k] * (1 - w) + z[:, k + 1] * w
        else:
            rows[r] = z[:, lo:hi].max(axis=1)
    v = np.clip((rows - DB_FLOOR) / (DB_TOP - DB_FLOOR), 0, 1) * (len(RAMP) - 1)
    i0 = np.minimum(v.astype(int), len(RAMP) - 2)
    frac = (v - i0)[..., None]
    rgb = RAMP[i0] * (1 - frac) + RAMP[i0 + 1] * frac
    return rgb[::-1].astype(np.uint8)


def _y_of(f: float, top: int, height: int) -> int:
    return top + height - int(np.log(f / F_MIN) / np.log(F_MAX / F_MIN) * height)


def _time_ticks(dur: float) -> list[float]:
    step = next(s for s in (0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10) if dur / s <= 6)
    return [round(t, 3) for t in np.arange(0, dur + 1e-9, step)]


def _dash_v(d: ImageDraw.ImageDraw, x: int, y0: int, y1: int, fill) -> None:
    for y in range(y0, y1, 6):
        d.line([(x, y), (x, y + 2)], fill=fill)


def draw_panel(img: Image.Image, d: ImageDraw.ImageDraw, x0: int, y0: int, w: int, h: int, m: np.ndarray,
               title: str, sub: str, marks: list[tuple[float, str]] | None = None,
               axis_labels: bool = True, ticks: list[tuple[float, str]] | None = None) -> None:
    """One sound: title, numbers, waveform strip, spectrogram with axes. (x0, y0) is the top left
    of the plot area; the title sits above it."""
    f_title, f_small = _font(12, True), _font(10)
    wave_h = 26
    d.text((x0, y0 - 45), title, fill=INK, font=f_title)
    d.text((x0, y0 - 30), sub, fill=INK2, font=f_small)
    # waveform strip (peak envelope per pixel)
    n = len(m)
    edges = np.linspace(0, n, w + 1).astype(int)
    mid = y0 - 14 + wave_h // 2
    d.line([(x0, mid), (x0 + w, mid)], fill=GRID)
    for i in range(w):
        seg = m[edges[i]:max(edges[i + 1], edges[i] + 1)]
        hi, lo = float(seg.max()), float(seg.min())
        d.line([(x0 + i, mid - hi * (wave_h / 2 - 1)), (x0 + i, mid - lo * (wave_h / 2 - 1))], fill=WAVE)
    top = y0 + wave_h - 8
    hh = h - wave_h + 8
    img.paste(Image.fromarray(heat(m, w, hh)), (x0, top))
    d.rectangle([x0 - 1, top - 1, x0 + w, top + hh], outline=AXIS)
    for f, lab in [(50, "50"), (200, "200"), (1000, "1k"), (5000, "5k"), (20000, "20k")]:
        y = _y_of(f, top, hh)
        d.line([(x0 - 4, y), (x0 - 1, y)], fill=AXIS)
        if axis_labels:
            d.text((x0 - 6, y), lab, fill=MUTED, font=f_small, anchor="rm")
    dur = n / SR
    if ticks is None:
        ticks = [(t, f"{t:g}") for t in _time_ticks(dur)]
    for t, lab in ticks:
        xx = x0 + int(t / dur * w)
        d.line([(xx, top + hh), (xx, top + hh + 3)], fill=AXIS)
        d.text((xx, top + hh + 5), lab, fill=MUTED, font=f_small, anchor="ma")
    for t, lab in marks or []:
        xx = x0 + int(t / dur * w)
        _dash_v(d, xx, top, top + hh, INK2)
        if lab:
            d.text((xx + 3, top + 3), lab, fill=INK, font=f_small)


def draw_scale(d: ImageDraw.ImageDraw, x: int, top: int, height: int) -> None:
    f_small = _font(10)
    for i in range(height):
        v = (1 - i / (height - 1)) * (len(RAMP) - 1)
        i0 = min(int(v), len(RAMP) - 2)
        c = RAMP[i0] * (1 - (v - i0)) + RAMP[i0 + 1] * (v - i0)
        d.line([(x, top + i), (x + 10, top + i)], fill=tuple(int(k) for k in c))
    d.rectangle([x - 1, top - 1, x + 11, top + height], outline=AXIS)
    for dbv in range(int(DB_TOP), int(DB_FLOOR) - 1, -13):
        y = top + int((DB_TOP - dbv) / (DB_TOP - DB_FLOOR) * (height - 1))
        d.text((x + 15, y), f"{dbv}", fill=MUTED, font=f_small, anchor="lm")
    d.text((x - 2, top - 14), "dB full scale", fill=MUTED, font=f_small)


def sheet(panels: list[dict], path: Path, title: str, subtitle: str, cols: int = 4,
          pw: int = 330, ph: int = 150) -> None:
    """Contact sheet: a grid of panels, one sound each, sharing one frequency axis (Hz, log)
    and one colour scale. Each panel's time axis is its own length in seconds."""
    rows = -(-len(panels) // cols)
    left, top, gap_x, gap_y, right, bottom = 46, 104, 36, 70, 86, 26
    width = left + cols * pw + (cols - 1) * gap_x + right
    height = top + rows * ph + (rows - 1) * gap_y + bottom
    img = Image.new("RGB", (width, height), SURFACE)
    d = ImageDraw.Draw(img)
    d.text((left, 12), title, fill=INK, font=_font(16, True))
    d.text((left, 35), subtitle, fill=INK2, font=_font(11))
    for i, p in enumerate(panels):
        r, c = divmod(i, cols)
        x0 = left + c * (pw + gap_x)
        y0 = top + r * (ph + gap_y)
        draw_panel(img, d, x0, y0, pw, ph, p["x"], p["title"], p["sub"], p.get("marks"),
                   axis_labels=(c == 0), ticks=p.get("ticks"))
    draw_scale(d, width - right + 22, top + 18, ph - 18)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


# ---- the verification run --------------------------------------------------------------------
ORDERED = {
    # group -> ids from small to large: must get longer, lower (centroid) and louder
    "step": ["kaiju_step_s1", "kaiju_step_s2", "kaiju_step_s3"],
    "swipe": ["kaiju_swipe_s1", "kaiju_swipe_s2", "kaiju_swipe_s3"],
    "stomp": ["kaiju_stomp_s1", "kaiju_stomp_s2", "kaiju_stomp_s3"],
    "roar": ["kaiju_roar_lizard_s1", "kaiju_roar_lizard_s2", "kaiju_roar_lizard_s3"],
    "explosion": ["explosion_s", "explosion_m", "explosion_l"],
    "crumble": ["crumble_s", "crumble_m", "crumble_l"],
}


def _sub(m: dict, spec: Spec) -> str:
    if spec.loop:
        return f"loop {spec.loop:g} s · level {m['level_db']:.1f} dB · centroid {m['centroid_hz']:.0f} Hz"
    return (f"{m['seconds']:.2f} s · peak {m['peak_db']:.1f} · level {m['level_db']:.1f} dB · "
            f"centroid {m['centroid_hz']:.0f} Hz")


def run(specs: dict[str, Spec], only: list[str] | None = None, build_info: list[dict] | None = None) -> int:
    manifest = json.loads(MANIFEST.read_text())["sfx"]
    DOCS.mkdir(parents=True, exist_ok=True)
    report_path = DOCS / "measurements.json"
    report: dict = json.loads(report_path.read_text()) if (only and report_path.exists()) else {}
    info = {i["name"]: i for i in build_info or []}
    problems: list[str] = []
    decoded: dict[str, np.ndarray] = {}
    ids = [s for s in specs if (only is None or s in only)]

    for sid in ids:
        spec = specs[sid]
        entry = manifest[sid]
        rec: dict = {"family": spec.family, "target_level_db": spec.level, "files": {}}
        if spec.loop:
            rec["loop"] = entry["loop"]
        for path in entry["variants"]:
            name = path.split("/")[-1]
            wav = MASTERS / f"{name}.wav"
            master = None
            if wav.exists():
                import soundfile as sf
                master, _ = sf.read(wav, dtype="float64", always_2d=False)
            frec: dict = {}
            for ext in ("ogg", "mp3"):
                f = OUT_DIR / f"{name}.{ext}"
                if not f.exists():
                    problems.append(f"{name}.{ext}: missing")
                    continue
                x = decode(f)
                m = measure(x, spec)
                m["bytes"] = f.stat().st_size
                m["channels"] = 2 if x.ndim == 2 else 1
                if master is not None:
                    m["length_error_ms"] = round((len(x) - len(master)) / SR * 1000, 2)
                    k = min(len(x), len(master), dsp.n_(1.5))
                    a, b = mono(x)[:k], mono(master)[:k]
                    corr = signal.correlate(a, b, mode="full")
                    m["offset_samples"] = int(np.argmax(corr) - (k - 1))
                if spec.loop:
                    m["seam"] = seam(x, entry["loop"][0], entry["loop"][1],
                                     master if master is not None and master.shape == x.shape else None)
                if name in info:
                    m["limiter_db"] = info[name]["limiter_db"]
                    m["codec_trim_db"] = info[name]["trim_db"]
                frec[ext] = m
                if ext == "ogg":
                    decoded[name] = x
                # ---- hard checks ----
                tag = f"{name}.{ext}"
                if m["peak_db"] > SHIP_PEAK_DB:
                    problems.append(f"{tag}: peak {m['peak_db']} dB full scale")
                if m["dc_offset"] > 0.002:
                    problems.append(f"{tag}: DC offset {m['dc_offset']}")
                if abs(m["level_db"] - spec.level) > 1.5:
                    problems.append(f"{tag}: level {m['level_db']} dB, target {spec.level}")
                if abs(m.get("length_error_ms", 0.0)) > 30:
                    problems.append(f"{tag}: length differs from master by {m['length_error_ms']} ms")
                if abs(m.get("offset_samples", 0)) > 64:
                    problems.append(f"{tag}: shifted {m['offset_samples']} samples against the master")
                if spec.loop:
                    s = m["seam"]
                    floor = s.get("codec_error_db", -30.0)
                    if s["step_vs_p99"] > 3 or abs(s["splice_flux_db"]) > 3 or s["repeat_error_db"] > floor + 6:
                        problems.append(f"{tag}: loop seam {s}")
                    want = LEAD_IN * 2 + spec.loop
                    if abs(m["seconds"] - want) > 0.03:
                        problems.append(f"{tag}: {m['seconds']} s, expected {want} s")
                else:
                    if m["start_db"] > -20:
                        problems.append(f"{tag}: starts at {m['start_db']} dB below peak (click)")
                    if m["end_db"] > -40:
                        problems.append(f"{tag}: ends at {m['end_db']} dB below peak (cut off)")
            rec["files"][name] = frec
        report[sid] = rec

    # ---- family checks (on the .ogg numbers) ----
    def avg(sid: str, key: str) -> float:
        vals = [f["ogg"][key] for f in report[sid]["files"].values() if "ogg" in f]
        return float(np.mean(vals))

    for sid in ids:
        files = report[sid]["files"]
        if len(files) > 1:
            lv = [f["ogg"]["level_db"] for f in files.values() if "ogg" in f]
            du = [f["ogg"]["seconds"] for f in files.values() if "ogg" in f]
            if max(lv) - min(lv) > 1.0:
                problems.append(f"{sid}: variants differ in level by {max(lv) - min(lv):.1f} dB")
            if max(du) / min(du) > 1.5:
                problems.append(f"{sid}: variants differ in length {du}")
    for group, members in ORDERED.items():
        if not all(m in report for m in members):
            continue
        for a, b in zip(members, members[1:]):
            if not avg(a, "seconds") < avg(b, "seconds"):
                problems.append(f"{group}: {a} is not shorter than {b}")
            if not avg(a, "centroid_hz") > avg(b, "centroid_hz"):
                problems.append(f"{group}: {a} is not brighter than {b} "
                                f"({avg(a, 'centroid_hz'):.0f} vs {avg(b, 'centroid_hz'):.0f} Hz)")
            if not avg(a, "level_db") < avg(b, "level_db") + 0.01:
                problems.append(f"{group}: {a} is louder than {b}")

    report_path.write_text(json.dumps(report, indent=1, sort_keys=True) + "\n")

    # ---- pictures ----
    if only is None or True:
        _sheets(specs, report, decoded, manifest, ids)

    from . import docgen
    docgen.write(specs, report)

    n_files = sum(len(r["files"]) for r in report.values())
    print(f"verified {len(ids)} sound(s); report covers {len(report)} sounds, {n_files} variants "
          f"({n_files * 2} files)")
    if problems:
        print(f"{len(problems)} PROBLEM(S):")
        for p in problems:
            print("  - " + p)
        return 1
    print("all checks passed")
    return 0


def _sheets(specs: dict[str, Spec], report: dict, decoded: dict[str, np.ndarray], manifest: dict,
            ids: list[str]) -> None:
    # every family: all variants, 12 panels per sheet
    for fam in FAMILIES:
        fam_ids = [s for s in specs if specs[s].family == fam]
        if not any(s in ids for s in fam_ids):
            continue
        panels = []
        for sid in fam_ids:
            if sid not in report:
                continue
            for name, f in report[sid]["files"].items():
                x = decoded.get(name)
                if x is None:
                    x = decode(OUT_DIR / f"{name}.ogg")
                    decoded[name] = x
                p = {"x": mono(x), "title": name, "sub": _sub(f["ogg"], specs[sid])}
                if specs[sid].loop:
                    lo, hi = manifest[sid]["loop"]
                    p["marks"] = [(lo, "loop"), (hi, "")]
                panels.append(p)
        for old in DOCS.glob(f"sheet_{fam}_*.png"):
            old.unlink()
        per = 12
        pages = -(-len(panels) // per)
        for i in range(pages):
            sheet(panels[i * per:(i + 1) * per], DOCS / f"sheet_{fam}_{i + 1}.png",
                  f"Sound effects: {fam} ({i + 1} of {pages})",
                  "Decoded .ogg files. Each panel: waveform strip, then spectrogram, 25 Hz to 20 kHz (log); "
                  "time in seconds across each panel's own length.")

    # the signature roar, large, with its three parts marked
    roars = [s for s in ORDERED["roar"] if s in report and s in ids]
    if len(roars) == 3:
        from .kaiju import ROAR_PARTS, ROAR_SECONDS
        panels = []
        for sid in roars:
            x = decoded[sid]
            stage = int(sid[-1])
            d = ROAR_SECONDS[stage]
            m = report[sid]["files"][sid]["ogg"]
            panels.append({"x": mono(x), "title": sid, "sub": _sub(m, specs[sid]),
                           "marks": [(0.0, "rise"), (ROAR_PARTS[0] * d, "tear"), (ROAR_PARTS[1] * d, "falling rumble"),
                                     (d, "tail")]})
        sheet(panels, DOCS / "roar_contour.png", "The signature roar at stages 1, 2 and 3",
              "Same three-part contour (rise, tear, falling rumble), longer and lower at each stage. "
              "Decoded .ogg, 25 Hz to 20 kHz (log).", cols=1, pw=1180, ph=250)

    # loops: one second either side of the splice, as the game will play it
    loops = [s for s in specs if specs[s].loop and s in report and s in ids]
    if loops:
        panels = []
        for sid in loops:
            for ext in ("ogg", "mp3"):
                x = decode(OUT_DIR / f"{sid}.{ext}")
                lo, hi = manifest[sid]["loop"]
                span = min(0.5, specs[sid].loop)
                v = mono(spliced_view(x, lo, hi, span))
                s = report[sid]["files"][sid][ext]["seam"]
                panels.append({"x": v, "title": f"{sid}.{ext}",
                               "sub": (f"step {s['step_vs_p99']:.2f}× · flux {s['splice_flux_db']:+.1f} dB · "
                                       f"repeat {s['repeat_error_db']:.0f} dB (codec {s.get('codec_error_db', 0):.0f})"),
                               "marks": [(span, "splice")],
                               "ticks": [(0, f"end −{span:g} s"), (span, "splice"), (2 * span - 1e-6, f"start +{span:g} s")]})
        for old in DOCS.glob("loop_seams_*.png"):
            old.unlink()
        per = 16
        pages = -(-len(panels) // per)
        for i in range(pages):
            sheet(panels[i * per:(i + 1) * per], DOCS / f"loop_seams_{i + 1}.png",
                  f"Loop splices ({i + 1} of {pages})",
                  "The end of each loop followed directly by its start, as the game plays it. A click would show as "
                  "a vertical line at the splice. Numbers are explained in docs/audio/SFX.md.", cols=4)
