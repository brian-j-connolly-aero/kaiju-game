"""Engineer's verification of the encoded soundtrack, by measurement and by picture.

For every .ogg and .mp3: decode with ffmpeg, check duration against the score, peak and true
peak, silence, integrated loudness (EBU R128, ffmpeg ebur128). For loops: how well the audio
repeats across the loop points, how large the step is at the splice compared with the steps
around it, and a spectrogram of the last two seconds followed by the first two. For stage
stems: the sum of base and combat is checked for clipping and loudness, and both stems are
checked against the beat grid. Spectrograms of every cue go to docs/audio/music/.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import signal

from . import dsp
from .mixdown import LEAD_IN, MANIFEST, OUT_DIR, REPO
from .score import BAR_SECONDS, SEC_PER_BEAT, Cue
from .synth import SCRATCH, SR

DOCS = REPO / "docs/audio/music"

# chart colours: one blue ramp, light (quiet) to dark (loud), on a light surface
SURFACE = (252, 252, 251)
INK = (11, 11, 11)
INK2 = (82, 81, 78)
MUTED = (137, 135, 129)
GRID = (225, 224, 217)
AXIS = (195, 194, 183)
SERIES = [(42, 120, 214), (235, 104, 52)]
_RAMP = ["#fcfcfb", "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
         "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]
RAMP = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in _RAMP], dtype=float)
DB_FLOOR, DB_TOP = -96.0, -18.0


def _font(size: int, bold: bool = False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)
    except OSError:
        return ImageFont.load_default()


def decode(path: Path) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le",
                        "-ar", str(SR), "-ac", "2", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype="<f4").reshape(-1, 2).astype(np.float64)


# ---- spectrogram ---------------------------------------------------------------------------
def _stft_db(mono: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    win = np.hanning(n_fft)
    pad = np.concatenate([np.zeros(n_fft // 2), mono, np.zeros(n_fft)])
    n_frames = 1 + (len(mono) - 1) // hop
    idx = np.arange(n_fft)[None, :] + (np.arange(n_frames) * hop)[:, None]
    spec = np.abs(np.fft.rfft(pad[idx] * win, axis=1)) / (win.sum() / 2)     # 0 dB = full-scale sine
    return 20 * np.log10(spec + 1e-9)


def _heat(mono: np.ndarray, width: int, height: int, n_fft: int, fmin: float, fmax: float) -> np.ndarray:
    hop = max(1, len(mono) // width)
    spec = _stft_db(mono, n_fft, hop)[:width]                                # frames x bins
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    edges = np.geomspace(fmin, fmax, height + 1)
    rows = np.empty((height, spec.shape[0]))
    for r in range(height):
        lo, hi = np.searchsorted(freqs, [edges[r], edges[r + 1]])
        if hi <= lo:                                 # band narrower than one bin: interpolate
            f = np.sqrt(edges[r] * edges[r + 1])
            k = min(len(freqs) - 2, max(0, np.searchsorted(freqs, f) - 1))
            w = (f - freqs[k]) / (freqs[k + 1] - freqs[k])
            rows[r] = spec[:, k] * (1 - w) + spec[:, k + 1] * w
        else:
            rows[r] = spec[:, lo:hi].max(axis=1)
    v = np.clip((rows - DB_FLOOR) / (DB_TOP - DB_FLOOR), 0, 1) * (len(RAMP) - 1)
    i0 = np.minimum(v.astype(int), len(RAMP) - 2)
    frac = (v - i0)[..., None]
    rgb = RAMP[i0] * (1 - frac) + RAMP[i0 + 1] * frac
    return rgb[::-1].astype(np.uint8)                # low frequencies at the bottom


def spectrogram(x: np.ndarray, path: Path, title: str, *, subtitle: str = "", t0: float = 0.0,
                sections: list[tuple[float, str]] | None = None, ticks: list[tuple[float, str]] | None = None,
                edge_marks: list[tuple[float, str]] | None = None, n_fft: int = 4096,
                width: int = 1240, height: int = 400, wave: tuple[np.ndarray, str] | None = None) -> None:
    """Log-frequency spectrogram (30 Hz to 16 kHz) with a dB scale. `sections` draws labelled
    dividers, `edge_marks` puts markers in the margins only (so they never cover the data),
    `wave` adds a zoomed waveform panel under the plot."""
    mono = x.mean(axis=1)
    fmin, fmax = 30.0, 16000.0
    left, right, top, bottom = 62, 92, 58, 38
    wave_h = 150 if wave is not None else 0
    img = Image.new("RGB", (left + width + right, top + height + bottom + wave_h), SURFACE)
    heat = _heat(mono, width, height, n_fft, fmin, fmax)
    img.paste(Image.fromarray(heat), (left, top))
    d = ImageDraw.Draw(img)
    f_title, f_lab, f_small = _font(15, True), _font(12), _font(11)
    d.text((left, 10), title, fill=INK, font=f_title)
    if subtitle:
        d.text((left, 31), subtitle, fill=INK2, font=f_small)
    # frequency axis
    for f, lab in [(50, "50"), (100, "100"), (200, "200"), (500, "500"), (1000, "1k"), (2000, "2k"),
                   (5000, "5k"), (10000, "10k")]:
        y = top + height - int(np.log(f / fmin) / np.log(fmax / fmin) * height)
        d.line([(left - 4, y), (left - 1, y)], fill=AXIS)
        d.text((left - 8, y), lab, fill=MUTED, font=f_small, anchor="rm")
    d.text((14, top + height // 2), "Hz", fill=MUTED, font=f_small, anchor="mm")
    # time axis
    dur = len(mono) / SR
    if ticks is None:
        step = next(s for s in (0.5, 1, 2, 5, 10, 20) if dur / s <= 12)
        ticks = [(t, f"{t0 + t:g}") for t in np.arange(0, dur + 1e-6, step)]
    for t, lab in ticks:
        xx = left + int(t / dur * width)
        d.line([(xx, top + height), (xx, top + height + 4)], fill=AXIS)
        d.text((xx, top + height + 7), lab, fill=MUTED, font=f_small, anchor="ma")
    d.text((left + width, top + height + 22), "seconds", fill=MUTED, font=f_small, anchor="ra")
    d.rectangle([left - 1, top - 1, left + width, top + height], outline=AXIS)
    for t, lab in sections or []:
        xx = left + int(t / dur * width)
        if t > 0:
            for y in range(top, top + height, 6):          # dashed hairline, mostly transparent
                d.line([(xx, y), (xx, y + 2)], fill=INK2)
        d.text((xx + 3, top - 14), lab, fill=INK2, font=f_small)
    for t, lab in edge_marks or []:
        xx = left + int(t / dur * width)
        d.polygon([(xx - 5, top - 9), (xx + 5, top - 9), (xx, top - 1)], fill=INK)
        d.polygon([(xx - 5, top + height + 9), (xx + 5, top + height + 9), (xx, top + height + 1)], fill=INK)
        d.text((xx, top - 12), lab, fill=INK, font=f_small, anchor="mb")
    # dB scale
    sx = left + width + 26
    for i in range(height):
        v = (1 - i / (height - 1)) * (len(RAMP) - 1)
        i0 = min(int(v), len(RAMP) - 2)
        c = RAMP[i0] * (1 - (v - i0)) + RAMP[i0 + 1] * (v - i0)
        d.line([(sx, top + i), (sx + 12, top + i)], fill=tuple(int(k) for k in c))
    d.rectangle([sx - 1, top - 1, sx + 13, top + height], outline=AXIS)
    for dbv in range(int(DB_TOP), int(DB_FLOOR) - 1, -13):
        y = top + int((DB_TOP - dbv) / (DB_TOP - DB_FLOOR) * (height - 1))
        d.text((sx + 18, y), f"{dbv}", fill=MUTED, font=f_small, anchor="lm")
    d.text((sx + 6, top - 14), "dBFS", fill=MUTED, font=f_small, anchor="ma")
    if wave is not None:
        seg, label = wave
        y0 = top + height + bottom + 8
        h = wave_h - 30
        d.text((left, y0 - 4), label, fill=INK2, font=f_small)
        mid = y0 + 14 + h // 2
        d.line([(left, mid), (left + width, mid)], fill=GRID)
        scale = (h / 2 - 2) / max(1e-6, np.max(np.abs(seg)))
        n = len(seg)
        for ch in (0, 1):
            pts = [(left + i / (n - 1) * width, mid - seg[i, ch] * scale) for i in range(n)]
            d.line(pts, fill=SERIES[ch], width=2)
        xx = left + width // 2
        d.polygon([(xx - 5, y0 + 6), (xx + 5, y0 + 6), (xx, y0 + 13)], fill=INK)
        d.text((left + width + 8, mid - 9), "left", fill=INK2, font=f_small)
        d.line([(left + width + 36, mid - 3), (left + width + 54, mid - 3)], fill=SERIES[0], width=2)
        d.text((left + width + 8, mid + 5), "right", fill=INK2, font=f_small)
        d.line([(left + width + 40, mid + 11), (left + width + 58, mid + 11)], fill=SERIES[1], width=2)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


# ---- measurements ----------------------------------------------------------------------------
def _seam(x: np.ndarray, start: float, end: float, master: np.ndarray | None = None) -> dict:
    """How continuous is the jump from loop end back to loop start?

    repeat_error_db   how closely the audio around the loop end repeats the audio around the
                      loop start (100 ms either side), relative to the signal level
    codec_error_db    the codec's own error against the master in the same windows: the repeat
                      cannot be closer than about this plus 3 dB, because the two windows are
                      two separate encodings of identical audio
    step_vs_p99       the sample step across the splice divided by the 99th percentile of the
                      steps within 50 ms of it (a click would be far above 1)
    splice_flux_db    onset energy at the splice, relative to the same moment played straight
                      through into the pad after the loop end (0 dB = the jump adds nothing)
    """
    a, b = int(round(start * SR)), int(round(end * SR))
    w = int(0.1 * SR)
    ref = x[a - w:a + w]
    rep = x[b - w:b + w]
    sig = dsp.db(float(np.sqrt(np.mean(ref ** 2))) + 1e-12)
    out = {"repeat_error_db": round(dsp.db(float(np.sqrt(np.mean((rep - ref) ** 2)))) - sig, 1)}
    if master is not None:
        err = np.concatenate([x[a - w:a + w] - master[a - w:a + w], x[b - w:b + w] - master[b - w:b + w]])
        out["codec_error_db"] = round(dsp.db(float(np.sqrt(np.mean(err ** 2)))) - sig, 1)
    spliced = np.vstack([x[b - 2 * SR:b], x[a:a + 2 * SR]])
    mono = spliced.mean(axis=1)
    diff = np.abs(np.diff(mono))
    at = 2 * SR - 1
    near = np.concatenate([diff[at - 2205:at], diff[at + 1:at + 2205]])
    out["step_vs_p99"] = round(float(diff[at] / (np.percentile(near, 99) + 1e-12)), 2)
    tail = int(0.18 * SR)
    straight = x[b - 2 * SR:b + tail].mean(axis=1)             # played through into the pad
    jumped = mono[:2 * SR + tail]
    n_fft, hop = 1024, 128

    def flux_at_splice(sig_: np.ndarray) -> float:
        spec = np.abs(signal.stft(sig_, SR, nperseg=n_fft, noverlap=n_fft - hop, boundary=None)[2])
        fl = np.sqrt(np.sum(np.diff(spec, axis=1).clip(min=0) ** 2, axis=0))
        k = (2 * SR - n_fft // 2) // hop
        return float(fl[k - 6:k + 7].max())

    out["splice_flux_db"] = round(dsp.db(flux_at_splice(jumped)) - dsp.db(flux_at_splice(straight)), 2)
    out["spliced"] = spliced
    return out


def _grid_offset_ms(x: np.ndarray, start: float) -> float:
    """Median distance of the strongest onsets from the nearest sixteenth-note grid line."""
    mono = dsp.highpass(x.mean(axis=1), 150.0)
    hop = 64
    env = np.sqrt(np.convolve(mono ** 2, np.ones(256) / 256, mode="same"))[::hop]
    flux = np.diff(env).clip(min=0)
    thr = np.percentile(flux, 99.5)
    peaks, _ = signal.find_peaks(flux, height=thr, distance=int(0.08 * SR / hop))
    t = peaks * hop / SR - start
    step = SEC_PER_BEAT / 4
    off = (t + step / 2) % step - step / 2
    return float(np.median(off) * 1000) if len(off) else float("nan")


def _bar_levels(x: np.ndarray, start: float, bars: int) -> list[float]:
    xk = dsp.k_weight(x)
    out = []
    for b in range(bars):
        a = int(round((start + b * BAR_SECONDS) * SR))
        out.append(round(dsp.k_level(xk[a:a + int(BAR_SECONDS * SR)]), 1))
    return out


BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


def _octave_bands(x: np.ndarray) -> list[float]:
    """Long-term average spectrum in octave bands, dB relative to the 500 Hz band."""
    f, p = signal.welch(x.mean(axis=1), SR, nperseg=8192)
    out = []
    for fc in BANDS:
        sel = (f >= fc / np.sqrt(2)) & (f < fc * np.sqrt(2))
        out.append(10 * np.log10(p[sel].sum() + 1e-20))
    ref = out[BANDS.index(500)]
    return [round(v - ref, 1) for v in out]


def measure_file(path: Path, expect_seconds: float, loop: list[float] | None,
                 master: np.ndarray | None = None) -> tuple[dict, np.ndarray]:
    x = decode(path)
    m = {"file": path.name, "bytes": path.stat().st_size, "seconds": round(len(x) / SR, 4),
         "duration_error_ms": round((len(x) / SR - expect_seconds) * 1000, 2),
         "peak_db": round(dsp.db(float(np.max(np.abs(x)))), 2), "true_peak_db": round(dsp.db(dsp.true_peak(x)), 2)}
    m.update(dsp.loudness(x))
    win = int(0.4 * SR)
    rms = np.sqrt(np.mean(x[:len(x) // win * win].reshape(-1, win, 2) ** 2, axis=(1, 2)))
    m["quietest_400ms_db"] = round(dsp.db(float(rms[:-1].min())), 1)
    m["loudest_400ms_db"] = round(dsp.db(float(rms.max())), 1)
    m["dc_offset"] = round(float(np.abs(x.mean(axis=0)).max()), 6)
    m["left_right_db"] = round(dsp.db(float(np.sqrt(np.mean(x[:, 0] ** 2)))) - dsp.db(float(np.sqrt(np.mean(x[:, 1] ** 2)))), 2)
    if loop:
        s = _seam(x, loop[0], loop[1], master)
        s.pop("spliced")
        m["seam"] = s
    return m, x


def run(cues: list[Cue]) -> int:
    manifest = json.loads(MANIFEST.read_text())["music"]
    DOCS.mkdir(parents=True, exist_ok=True)
    report = {}
    problems = []
    for cue in cues:
        decoded = {}
        for stem in cue.stems:
            entry = manifest[stem.name]
            loop = entry.get("loop")
            master, _ = sf_read(SCRATCH / "masters" / f"{stem.name}.wav")
            rec = {"bars": cue.bars, "loop": loop, "expected_seconds": entry["duration"]}
            for ext in ("ogg", "mp3"):
                m, x = measure_file(OUT_DIR / f"{stem.name}.{ext}", entry["duration"], loop, master)
                # alignment and fidelity against the master
                n = min(len(x), len(master))
                seg = slice(SR, min(n, 6 * SR))
                corr = signal.correlate(x[seg, 0], master[seg, 0], mode="full")
                m["offset_samples"] = int(np.argmax(corr) - (seg.stop - seg.start - 1))
                rec[ext] = m
                decoded[(stem.name, ext)] = x
                if abs(m["duration_error_ms"]) > 30:
                    problems.append(f"{m['file']}: duration off by {m['duration_error_ms']} ms")
                if m["true_peak_db"] > -0.1:
                    problems.append(f"{m['file']}: true peak {m['true_peak_db']} dBTP")
                if m["loudest_400ms_db"] < -45:
                    problems.append(f"{m['file']}: silent")
                if loop:
                    sm = m["seam"]
                    if (sm["step_vs_p99"] > 3 or abs(sm["splice_flux_db"]) > 3
                            or sm["repeat_error_db"] > sm["codec_error_db"] + 6):
                        problems.append(f"{m['file']}: loop seam {sm}")
            x = decoded[(stem.name, "ogg")]
            start = loop[0] if loop else 0.0
            rec["bar_levels"] = _bar_levels(x, start, int(cue.bars))
            rec["octave_bands_db"] = _octave_bands(x)
            if loop:
                rec["grid_offset_ms"] = round(_grid_offset_ms(x, start), 2)
            report[stem.name] = rec
            # pictures: the whole file, and for loops the splice
            secs = [((b - 1) * BAR_SECONDS + start, lab) for b, lab in cue.sections]
            sub = (f"{cue.title}  ·  {cue.bars:g} bars at 96 beats per minute  ·  "
                   f"{rec['ogg']['lufs']:.1f} LUFS, true peak {rec['ogg']['true_peak_db']:.1f} dBTP (.ogg)")
            spectrogram(x, DOCS / f"{stem.name}.png", f"{stem.name}", subtitle=sub, sections=secs)
            if loop:
                for ext in ("ogg", "mp3"):
                    xx = decoded[(stem.name, ext)]
                    s = _seam(xx, loop[0], loop[1])
                    a, b = int(round(loop[0] * SR)), int(round(loop[1] * SR))
                    zoom = np.vstack([xx[b - 441:b], xx[a:a + 441]])
                    spectrogram(s["spliced"], DOCS / f"{stem.name}_seam_{ext}.png",
                                f"{stem.name}.{ext}: loop splice",
                                subtitle="last 2 s before the loop end, then the first 2 s after the loop start; "
                                         "the markers show the splice",
                                ticks=[(0, "end -2 s"), (1, "end -1 s"), (2, "splice"), (3, "start +1 s"),
                                       (4, "start +2 s")],
                                edge_marks=[(2.0, "")], n_fft=2048,
                                wave=(zoom, "waveform, 10 ms either side of the splice"))
        # stage stems: check the pair together
        if len(cue.stems) > 1:
            for ext in ("ogg", "mp3"):
                parts = [decoded[(s.name, ext)] for s in cue.stems]
                n = min(len(p) for p in parts)
                total = np.sum([p[:n] for p in parts], axis=0)
                rec = {"peak_db": round(dsp.db(float(np.max(np.abs(total)))), 2),
                       "true_peak_db": round(dsp.db(dsp.true_peak(total)), 2)}
                rec.update(dsp.loudness(total))
                report.setdefault(f"{cue.name}_sum", {})[ext] = rec
                if rec["true_peak_db"] > -0.1:
                    problems.append(f"{cue.name} base+combat ({ext}): true peak {rec['true_peak_db']} dBTP")
            total = np.sum([decoded[(s.name, "ogg")][:n] for s in cue.stems], axis=0)
            loop = manifest[cue.stems[0].name]["loop"]
            report[f"{cue.name}_sum"]["bar_levels"] = _bar_levels(total, loop[0], int(cue.bars))
            report[f"{cue.name}_sum"]["octave_bands_db"] = _octave_bands(total)
            secs = [((b - 1) * BAR_SECONDS + loop[0], lab) for b, lab in cue.sections]
            spectrogram(total, DOCS / f"{cue.name}_sum.png", f"{cue.name}: base + combat",
                        subtitle=f"{cue.title}  ·  both stems summed at full level  ·  "
                                 f"{report[f'{cue.name}_sum']['ogg']['lufs']:.1f} LUFS, true peak "
                                 f"{report[f'{cue.name}_sum']['ogg']['true_peak_db']:.1f} dBTP", sections=secs)
    out = DOCS / "measurements.json"
    existing = json.loads(out.read_text()) if out.exists() else {}
    existing.update(report)
    out.write_text(json.dumps(existing, indent=1, sort_keys=True) + "\n")
    print_report(report)
    for p in problems:
        print("PROBLEM:", p)
    print(f"{len(problems)} problem(s); spectrograms and measurements.json in {DOCS}")
    return 1 if problems else 0


def sf_read(path: Path):
    import soundfile as sf
    return sf.read(str(path), dtype="float64", always_2d=True)


def print_report(report: dict) -> None:
    print(f"\n{'file':22s} {'sec':>8s} {'err ms':>7s} {'LUFS':>6s} {'LRA':>5s} {'peak':>6s} {'TP':>6s} "
          f"{'kB':>6s} {'ofs':>4s}  seam: repeat dB / codec dB / step / splice flux dB")
    for name, rec in report.items():
        for ext in ("ogg", "mp3"):
            m = rec.get(ext)
            if not m:
                continue
            if "file" not in m:
                print(f"{name + ' ' + ext:22s} {'':8s} {'':7s} {m['lufs']:6.1f} {m['lra']:5.1f} {m['peak_db']:6.2f} "
                      f"{m['true_peak_db']:6.2f}")
                continue
            seam = m.get("seam")
            st = (f"  {seam['repeat_error_db']:6.1f} / {seam['codec_error_db']:6.1f} / {seam['step_vs_p99']:5.2f} / "
                  f"{seam['splice_flux_db']:+.2f}") if seam else ""
            print(f"{m['file']:22s} {m['seconds']:8.3f} {m['duration_error_ms']:7.2f} {m['lufs']:6.1f} {m['lra']:5.1f} "
                  f"{m['peak_db']:6.2f} {m['true_peak_db']:6.2f} {m['bytes'] / 1000:6.0f} {m['offset_samples']:4d}{st}")
        if "bar_levels" in rec:
            lv = rec["bar_levels"]
            print("    per bar (LUFS-like): " + " ".join(f"{v:.0f}" for v in lv))
        if "octave_bands_db" in rec:
            print("    octave bands 31-16k: " + " ".join(f"{v:+.0f}" for v in rec["octave_bands_db"]))
