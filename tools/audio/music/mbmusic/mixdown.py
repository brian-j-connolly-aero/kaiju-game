"""Parts -> stems -> mastered loop or one-shot -> .ogg and .mp3.

File layout of a loop (all times exact multiples of one sample at 44.1 kHz):

    [ lead-in 0.25 s ][ loop body: whole bars ][ pad 0.25 s ]
      loop start = 0.25 s                        loop end = 0.25 s + bars * 2.5 s

The lead-in is the last quarter second of the loop (faded in) and the pad is its first quarter
second, so the audio is periodic on both sides of both loop points. A decoder that shifts the
audio by a few milliseconds (MP3 decoders differ in how they trim encoder delay) therefore still
loops without a click, and base and combat stems, which share the same layout, stay aligned.
"""
from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

from . import dsp
from .score import BAR_SECONDS, BPM, Cue, Stem
from .synth import SCRATCH, SR, render_part

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = REPO / "client/public/assets/audio/music"
MANIFEST = REPO / "client/public/assets/manifest.music.json"

LEAD_IN = 0.25            # seconds before the loop start
PAD = 0.25                # seconds after the loop end
DRY_TAIL = 5.0            # seconds allowed for note releases after the last bar
CEILING_DB = -1.5         # limiter ceiling (sample peak) for the sum of a cue's stems
WET_HP = 140.0            # keep the hall out of the bass
SUB_HZ = 80.0             # corner of the low shelf that parts with `sub` get (bass weight)
OGG_QUALITY = "4"         # libvorbis -q:a (about 115 kbit/s for this material)
MP3_QUALITY = "5"         # libmp3lame -q:a (VBR, about 115 kbit/s for this material)


def _section_bounds(cue: Cue) -> list[tuple[int, int]]:
    firsts = [b for b, _ in cue.sections] or [1]
    edges = [int(round((b - 1) * BAR_SECONDS * SR)) for b in firsts] + [int(round(cue.seconds * SR))]
    return list(zip(edges, edges[1:]))


def part_chain(part, x: np.ndarray) -> np.ndarray:
    """One part's own processing, from the dry render to its seat in the mix: level, high-pass
    under the instrument, low-pass, bass shelf, air shelf, stereo position."""
    x = x.astype(np.float64) * 10 ** ((part.inst.trim + part.gain) / 20)
    x = dsp.highpass(x, part.hp)
    x = dsp.lowpass(x, part.lp)
    if part.sub:
        # The samples are thin at the very bottom: the organ's fundamental is 5 to 9 dB under
        # its own octave from C1 to C2, and the bowed basses have none below A1 (measured note
        # by note). The shelf gives some of it back.
        x = dsp.shelf(x, SUB_HZ, part.sub, "low")
    if part.inst.air and not part.lp:
        x = dsp.shelf(x, 6000.0, part.inst.air, "high")
    return dsp.place(x, part.pan, part.width)


def _mix_stem(cue: Cue, stem: Stem, levels: dict) -> np.ndarray:
    """Linear mix of one stem: dry parts plus hall. Length: cue + dry tail + hall tail."""
    tail = DRY_TAIL
    with ThreadPoolExecutor(max_workers=3) as pool:
        dry_parts = list(pool.map(lambda p: render_part(p, cue.beats, tail, cue.name), stem.parts))
    n = len(dry_parts[0])
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for part, x in zip(stem.parts, dry_parts):
        x = part_chain(part, x)
        dry += x
        send += x * part.rev
        xk = dsp.k_weight(x[:int(cue.seconds * SR)])
        levels[f"{stem.name}/{part.name}"] = {
            "role": part.role, "notes": len(part.notes),
            "sections": [round(dsp.k_level(xk[a:b]), 1) for a, b in _section_bounds(cue)],
        }
    wet = dsp.highpass(dsp.reverb(send), WET_HP)
    mix = wet
    mix[:n] += dry
    # master tone: rumble filter, a small cut where the sampled choir, horns and strings pile
    # up (the 350-700 Hz octave), a little air
    mix = dsp.highpass(mix, 30.0)
    mix = dsp.peak_eq(mix, 450.0, -2.0, 0.8)
    mix = dsp.shelf(mix, 7000.0, 2.0, "high")
    return mix


def _limit(stems: list[np.ndarray], loop: bool) -> tuple[list[np.ndarray], dict]:
    """One gain curve for all stems of a cue, computed so that every stem alone and all of them
    together stay under the ceiling (so any fade position of the combat stem is safe)."""
    ceiling = 10 ** (CEILING_DB / 20)
    total = np.sum(stems, axis=0)
    peak = np.max(np.abs(total), axis=1)
    for s in stems:
        peak = np.maximum(peak, np.max(np.abs(s), axis=1))
    n = len(peak)
    if loop:
        g = dsp.limiter_gain(np.tile(peak, 3), ceiling)[n:2 * n]     # steady state of the loop
    else:
        g = dsp.limiter_gain(peak, ceiling)
    stats = {"max_reduction_db": round(-dsp.db(float(g.min())), 2),
             "limited_percent": round(100 * float(np.mean(g < 0.989)), 2)}
    return [s * g[:, None] for s in stems], stats


def _encode(wav: Path, base: Path) -> None:
    common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-map_metadata", "-1",
              "-ar", str(SR), "-ac", "2", "-bitexact"]
    subprocess.run(common + ["-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(base) + ".ogg"], check=True)
    subprocess.run(common + ["-c:a", "libmp3lame", "-q:a", MP3_QUALITY, "-id3v2_version", "0",
                             "-write_id3v1", "0", str(base) + ".mp3"], check=True)


def _print_balance(cue: Cue, levels: dict) -> None:
    """Loudness of every part in every section (K-weighted, before mastering): the mix balance
    read as numbers. '.' means the part is silent there."""
    labels = [lab for _, lab in cue.sections] or ["all"]
    print("    " + " " * 34 + "".join(f"{lab[:11]:>12s}" for lab in labels))
    for k, v in levels.items():
        cells = "".join(f"{x:12.1f}" if x > -90 else f"{'.':>12s}" for x in v["sections"])
        print(f"    {k[:26]:26s} {v['role'][:7]:7s}{cells}")


def render_cue(cue: Cue, encode: bool = True, verbose: bool = True) -> dict:
    """Render, master and encode one cue. Returns the manifest entries and measurements."""
    levels: dict = {}
    mixes = [_mix_stem(cue, stem, levels) for stem in cue.stems]
    body = int(round(cue.seconds * SR))
    for stem, m in zip(cue.stems, mixes):
        mk = dsp.k_weight(m[:body])
        levels[f"{stem.name}/= MIX"] = {"role": "", "notes": 0,
                                        "sections": [round(dsp.k_level(mk[a:b]), 1) for a, b in _section_bounds(cue)]}
    if cue.loop:
        stems = [dsp.fold(m, body) for m in mixes]
    else:
        n = body + int(round(cue.tail_seconds * SR))
        fade = int(0.6 * SR)
        env = np.ones(n)
        env[-fade:] = np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
        stems = [np.pad(m, ((0, max(0, n - len(m))), (0, 0)))[:n] * env[:, None] for m in mixes]

    # loudness: one gain for all stems, set from the full mix; limiter; touch up
    total = np.sum(stems, axis=0)
    gain = 10 ** ((cue.target_lufs - dsp.loudness(total)["lufs"]) / 20)
    stats = {}
    for _ in range(3):
        limited, stats = _limit([s * gain for s in stems], cue.loop)
        err = cue.target_lufs - dsp.loudness(np.sum(limited, axis=0))["lufs"]
        if abs(err) < 0.05:
            break
        gain *= 10 ** (err / 20)
    stems = limited

    lead, pad = int(LEAD_IN * SR), int(PAD * SR)
    result = {"cue": cue.name, "levels": levels, "limiter": stats, "files": {}, "manifest": {}}
    masters = SCRATCH / "masters"
    masters.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stem, x in zip(cue.stems, stems):
        entry = {"base": f"audio/music/{stem.name}"}
        if cue.loop:
            fade_in = np.ones(lead)
            ramp = int(0.15 * SR)
            fade_in[:ramp] = np.sin(np.linspace(0, np.pi / 2, ramp)) ** 2
            fade_out = np.ones(pad)
            ramp = int(0.05 * SR)
            fade_out[-ramp:] = np.cos(np.linspace(0, np.pi / 2, ramp)) ** 2
            out = np.vstack([x[-lead:] * fade_in[:, None], x, x[:pad] * fade_out[:, None]])
            entry["loop"] = [LEAD_IN, round(LEAD_IN + cue.seconds, 6)]
        else:
            out = x
        entry["bpm"] = BPM
        if cue.group:
            entry["group"] = cue.group
        entry["duration"] = round(len(out) / SR, 3)
        if cue.mark is not None:
            entry["mark"] = round(float(cue.mark), 3)
        wav = masters / f"{stem.name}.wav"
        sf.write(str(wav), out, SR, subtype="PCM_24")
        if encode:
            _encode(wav, OUT_DIR / stem.name)
        result["manifest"][stem.name] = entry
        result["files"][stem.name] = {"samples": len(out), "seconds": round(len(out) / SR, 4)}
    (masters / f"{cue.name}.json").write_text(json.dumps(result, indent=1))
    if verbose:
        print(f"[{cue.name}] {cue.bars:g} bars, {cue.seconds:g} s, limiter max {stats['max_reduction_db']} dB "
              f"({stats['limited_percent']}% of the time)")
        _print_balance(cue, levels)
    return result


def write_manifest(entries: dict) -> None:
    """Writes the partial manifest (merged into manifest.json by `npm run assets:manifest`)."""
    order = ["lobby", "briefing", "stage1_base", "stage1_combat", "stage2_base", "stage2_combat",
             "stage3_base", "stage3_combat", "cocoon", "intermission", "win_humans", "win_kaiju", "hearing"]
    music = {k: entries[k] for k in order if k in entries}
    music.update({k: v for k, v in entries.items() if k not in music})
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps({"music": music}, indent=2) + "\n")
